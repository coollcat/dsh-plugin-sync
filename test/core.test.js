import test from 'node:test'
import assert from 'node:assert/strict'

import { resourceHash, safeEqual, validateChangeset } from '../lib/protocol.js'
import { defaultPolicy, evaluate } from '../lib/policy.js'
import { buildPlan, compareSource } from '../lib/planner.js'
import { createApproval, verifyApproval } from '../lib/authorizer.js'
import { redact } from '../lib/audit.js'

const registry = (pkg, version) => ({ type: 'registry', package: pkg, version })
const record = (key, version, enabled = true) => ({
  key,
  kind: 'plugin',
  source: registry(key, version),
  enabled,
  contentHash: resourceHash({ kind: 'plugin', key, source: registry(key, version), enabled }),
})

test('policy protection priority', () => {
  const policy = defaultPolicy({
    protected: ['@local/dsh-plugin-sync'],
    localOnly: ['ax*'],
    include: ['ab*'],
    exclude: ['*'],
    default: 'deny',
  })
  assert.equal(evaluate(policy, { key: '@local/dsh-plugin-sync' }).reason, 'system-protected')
  assert.equal(evaluate(policy, { key: 'axc' }).reason, 'local-only')
  assert.equal(evaluate(policy, { key: 'abd' }).reason, 'excluded:*')
  assert.equal(evaluate(policy, { key: 'zzz' }).reason, 'excluded:*')
})

test('capability gate denies install by default', () => {
  const policy = defaultPolicy()
  assert.equal(evaluate(policy, { key: 'x', requiresCap: 'install' }).reason, 'cap-disabled:install')
  assert.equal(evaluate(policy, { key: 'x', requiresCap: 'enable' }).allowed, true)
})

test('version ordering and downgrade conflict', () => {
  assert.equal(compareSource(registry('x', '1.2.0'), registry('x', '1.1.9')), 'upgrade')
  assert.equal(compareSource(registry('x', '1.1.0'), registry('x', '1.2.0')), 'downgrade')
  assert.equal(compareSource(registry('x', '1.2.0'), registry('x', '1.2.0')), 'same')
})

test('plan: install and enable, with policy skips', () => {
  const policy = defaultPolicy({ caps: { install: true } })
  const plan = buildPlan({
    expected: [record('pkg-a', '1.0.0'), record('@local/dsh-plugin-sync', '1.0.0')],
    local: [],
    policy,
    source: 'center:rev2',
    revision: 2,
  })
  assert.deepEqual(plan.operations.map((op) => op.action), ['install', 'enable'])
  assert.equal(plan.skipped.find((s) => s.key === '@local/dsh-plugin-sync').reason, 'system-protected')
  const noEnable = buildPlan({ expected: [record('pkg-b', '1.0.0')], local: [], policy: defaultPolicy({ caps: { install: true, enable: false } }) })
  assert.ok(noEnable.skipped.some((s) => s.action === 'enable' && s.reason === 'cap-disabled:enable'))
})

test('plan: absence of a local plugin is never a delete', () => {
  const plan = buildPlan({
    expected: [],
    local: [record('extra', '1.0.0')],
    policy: defaultPolicy(),
  })
  assert.equal(plan.operations.length, 0)
  assert.equal(plan.skipped[0].reason, 'absent-not-delete')
})

test('plan: downgrade is a conflict, not an automatic operation', () => {
  const plan = buildPlan({
    expected: [record('x', '1.0.0')],
    local: [record('x', '2.0.0')],
    policy: defaultPolicy(),
  })
  assert.equal(plan.operations.length, 0)
  assert.equal(plan.conflicts[0].kind, 'downgrade-blocked')
})

test('plan: localOnly and exclude block center expectations', () => {
  const policy = defaultPolicy({ localOnly: ['keep*'], exclude: ['no*'] })
  const plan = buildPlan({
    expected: [record('keep-me', '2.0.0'), record('no-me', '2.0.0')],
    local: [record('keep-me', '1.0.0'), record('no-me', '1.0.0')],
    policy,
  })
  assert.equal(plan.operations.length, 0)
  assert.deepEqual(plan.skipped.map((s) => s.reason).sort(), ['excluded:no*', 'local-only'])
  assert.equal(evaluate(policy, { key: 'keep-me', requiresCap: 'upgrade' }).reason, 'local-only')
})

test('plan: batch of five operations needs extra approval', () => {
  const expected = Array.from({ length: 5 }, (_, i) => record(`p${i}`, '1.0.0'))
  const plan = buildPlan({ expected, local: [], policy: defaultPolicy({ caps: { install: true } }) })
  assert.equal(plan.requiresExtraApproval, true)
  assert.ok(plan.operations.every((op) => op.risk === 'high'))
})

test('approval binds plan id, content and operation list', () => {
  const policy = defaultPolicy({ caps: { install: true, enable: true } })
  const plan = buildPlan({ expected: [record('a', '1.0.0')], local: [], policy })
  const created = createApproval(plan, { actor: 'user', opIds: plan.operations.map((op) => op.opId), at: 'now' })
  assert.equal(created.ok, true)
  assert.equal(verifyApproval(plan, created.approval).ok, true)

  const changed = structuredClone(plan)
  changed.operations[0].effects = ['different']
  assert.equal(verifyApproval(changed, created.approval).reason, 'plan-content-changed')

  const empty = createApproval(plan, { actor: 'user', opIds: [], at: 'now' })
  assert.equal(verifyApproval(plan, empty.approval).reason, 'no-operation-approved')
  const partial = createApproval(plan, { actor: 'user', opIds: [plan.operations[0].opId], at: 'now' })
  assert.deepEqual(verifyApproval(plan, partial.approval).authorized, [plan.operations[0].opId])
})

test('changeset schema rejects non-reproducible sources', () => {
  const payload = {
    schemaVersion: 1,
    id: 'cs_1',
    origin: { deviceId: 'd1', profileId: 'p1', label: 'Laptop' },
    parents: [],
    resources: [{ key: 'x', kind: 'plugin', enabled: true, contentHash: 'sha256:a', source: { type: 'registry', package: 'x' } }],
    issuedAt: '2026-01-01T00:00:00Z',
    mac: 'hmac-sha256:00',
  }
  assert.ok(validateChangeset(payload).some((e) => e.includes('exact version')))
})

test('audit redaction removes secret-like fields', () => {
  const result = redact({ token: 'abc', authorization: 'Bearer x', nested: { api_key: 'k', title: 'ok' } })
  assert.equal(result.token, '[redacted]')
  assert.equal(result.nested.api_key, '[redacted]')
  assert.equal(result.nested.title, 'ok')
})

test('constant-time token comparison', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abcd'), false)
})
