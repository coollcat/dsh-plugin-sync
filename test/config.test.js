import test from 'node:test'
import assert from 'node:assert/strict'

import { splitSecrets, mergeWithLocalSecrets, configRecord, configHash, isSecretKey } from '../lib/config.js'
import { buildConfigPlan } from '../lib/planner.js'
import { defaultPolicy } from '../lib/policy.js'
import { createEngine } from '../lib/engine.js'
import { signChangeset } from '../lib/protocol.js'

const selection = { include: ['row-1'], configFields: { 'row-1': [['value'], ['other']] } }
const cfg = (key, value, extra = {}) => ({
  kind: 'pluginConfig',
  key,
  entryId: key,
  bundle: 'third-party',
  config: { value, other: 1 },
  secretKeys: [],
  fields: [['value'], ['other']],
  contentHash: configHash({ value, other: 1 }),
  ...extra,
})

test('secret keys are removed from the synced projection', () => {
  const config = { url: 'https://example.test', apiKey: 'secret', nested: { password: 'p', keep: 1 } }
  const { safe, secretPaths } = splitSecrets(config)
  assert.equal(safe.url, 'https://example.test')
  assert.equal(safe.apiKey, undefined)
  assert.equal(safe.nested.password, undefined)
  assert.equal(safe.nested.keep, 1)
  assert.deepEqual(secretPaths, [['apiKey'], ['nested', 'password']])
})

test('local secrets are preserved when a remote config is applied', () => {
  const remote = { url: 'https://new.test', apiKey: '[redacted]' }
  const local = { url: 'https://old.test', apiKey: 'local-secret' }
  const merged = mergeWithLocalSecrets(remote, local, [['apiKey']])
  assert.equal(merged.url, 'https://new.test')
  assert.equal(merged.apiKey, 'local-secret')
})

test('config record carries only safe values', () => {
  const record = configRecord({ entryId: 'row-1', bundle: 'third-party', config: { token: 'abc', n: 1 }, origin: 'center' })
  assert.equal(record.config.token, undefined)
  assert.equal(record.config.n, 1)
  assert.deepEqual(record.secretKeys, [['token']])
})

test('config plan detects a concurrent change', () => {
  const policy = defaultPolicy({ ...selection, caps: { configSet: true } })
  const expected = [cfg('row-1', 'center')]
  const local = [cfg('row-1', 'local')]
  const plan = buildConfigPlan({ expected, local, baselines: { 'row-1': configHash({ value: 'base', other: 1 }) }, policy })
  assert.equal(plan.operations.length, 0)
  assert.equal(plan.conflicts[0].kind, 'concurrent-config-change')
})

test('config plan creates an operation when only the center changed', () => {
  const policy = defaultPolicy({ ...selection, caps: { configSet: true } })
  const plan = buildConfigPlan({
    expected: [cfg('row-1', 'center')],
    local: [cfg('row-1', 'base')],
    baselines: { 'row-1': configHash({ value: 'base', other: 1 }) },
    policy,
  })
  assert.equal(plan.operations.length, 1)
  assert.equal(plan.operations[0].action, 'configSet')
})

test('config capability is off by default', () => {
  const plan = buildConfigPlan({ expected: [cfg('row-1', 'center')], local: [], policy: defaultPolicy(selection) })
  assert.equal(plan.operations.length, 0)
  assert.equal(plan.skipped[0].reason, 'cap-disabled:configSet')
})

test('engine applies a config plan and records the new baseline', async () => {
  const centerAdapters = {
    profileId: 'c', label: 'Center',
    collectInventory: async () => [],
    collectConfig: async () => [],
    install: async () => ({}), upgrade: async () => ({}), setEnabled: async () => ({}),
    putSecret: async () => {}, getSecret: async () => null, writeConfig: async () => ({}),
  }
  const center = createEngine({ store: { read: () => null, write: () => {} }, adapters: centerAdapters })
  await center.pairCenter({ initSource: 'empty' })
  center.setPolicy({ ...center.publicState().policy, ...selection })
  const invite = center.createInvitation()

  let configValue = 'base'
  const writes = []
  const secrets = {}
  const deviceAdapters = {
    profileId: 'd', label: 'Device',
    collectInventory: async () => [],
    collectConfig: async () => [cfg('row-1', configValue)],
    install: async () => ({}), upgrade: async () => ({}), setEnabled: async () => ({}),
    putSecret: async (key, value) => { secrets[key] = value },
    getSecret: async (key) => secrets[key],
    writeConfig: async (payload) => { writes.push(payload); configValue = payload.config.value; return { detail: 'configSet:done' } },
  }
  const routes = {
    '/plugin-sync/hello': (body, token) => center.handleHello({ token, identity: body.identity }),
    '/plugin-sync/state': (body, token) => center.handleGetState({ token, deviceId: body.deviceId }),
    '/plugin-sync/proposals': (body, token) => center.handleSubmitProposal({ token, identity: body.identity, changeset: body.changeset }),
  }
  const transport = {
    async send(url, { token, body } = {}) {
      const handler = routes[new URL(url).pathname]
      if (!handler) throw new Error('unknown route')
      return handler(body ?? {}, token)
    },
  }
  const device = createEngine({ store: { read: () => null, write: () => {} }, adapters: deviceAdapters, transport, deviceId: 'device-config' })
  await device.joinCenter({ url: 'http://127.0.0.1:1', token: invite.token })
  const identity = { deviceId: 'device-config', profileId: 'd', label: 'Device' }
  const changeset = {
    id: 'cs-config-seed', schemaVersion: 1, origin: identity,
    parents: [center.publicState().revision.hash].filter(Boolean),
    resources: [cfg('row-1', 'center')], issuedAt: '2026-01-01T00:00:00Z', mac: '',
  }
  changeset.mac = signChangeset(changeset, invite.token)
  const submitted = center.handleSubmitProposal({ token: invite.token, identity, changeset })
  assert.equal(submitted.status, 'pending')
  center.handleAcceptProposal({ proposalId: submitted.proposalId, actor: 'user' })

  device.setPolicy({ ...device.publicState().policy, ...selection, caps: { ...device.publicState().policy.caps, configSet: true } })
  const { configPlan } = await device.check({ kind: 'config' })
  assert.equal(configPlan.operations.length, 1)
  device.approve({ planId: configPlan.planId, opIds: configPlan.operations.map((op) => op.opId), actor: 'user' })
  const result = await device.apply({ planId: configPlan.planId })
  assert.equal(result.status, 'ok')
  assert.equal(writes.length, 1)
  assert.equal(writes[0].entryId, 'row-1')
  assert.equal(device.publicState().configBaselines['row-1'], configPlan.operations[0].toHash)
})

test('managed auto sync never approves install or upgrade', async () => {
  const adapters = {
    profileId: 'c', label: 'Center',
    inventory: [cfg('row-1', 'center')],
    setInventory(value) { this.inventory = value },
    collectInventory() { return Promise.resolve([]) },
    collectConfig() { return Promise.resolve([]) },
    install() { throw new Error('must-not-install') },
    upgrade() { throw new Error('must-not-upgrade') },
    setEnabled() { return Promise.resolve({}) },
    putSecret() {}, getSecret() { return null }, writeConfig() { return Promise.resolve({}) },
  }
  const store = { read: () => null, write: () => {} }
  const engine = createEngine({ store, adapters })
  await engine.pairCenter({ initSource: 'local' })
  adapters.setInventory([])
  engine.setPolicy({ ...engine.publicState().policy, mode: 'managed', autoApply: true,
    caps: { ...engine.publicState().policy.caps, install: true } })
  const result = await engine.autoSync()
  assert.equal(result.status, 'ok')
  assert.equal(result.results.some((r) => r.kind === 'plugin' && r.applied > 0), false)
  assert.equal(engine.publicState().lastResults.some((r) => r.action === 'install'), false)
})

test('secret detection covers camelCase and suffix variants', () => {
  for (const key of ['secretValue', 'passwordHash', 'credentials2', 'sessionData', 'macAddress', 'saltValue', 'authed']) {
    assert.equal(isSecretKey(key), true, key)
  }
})

test('dotted key names keep their secret path intact', () => {
  const local = { svc: { 'api.secret': 'X', keep: 1 } }
  const { safe, secretPaths } = splitSecrets(local)
  assert.deepEqual(secretPaths, [['svc', 'api.secret']])
  const merged = mergeWithLocalSecrets({ svc: { keep: 2, 'api.secret': 'remote' } }, local, [])
  assert.equal(merged.svc['api.secret'], 'X')
  assert.equal(merged.svc.keep, 2)
})

test('remote secret-looking values are dropped even when secretKeys is empty', () => {
  const local = { apiKey: 'local-secret', other: 1 }
  const merged = mergeWithLocalSecrets({ apiKey: 'remote-secret', other: 2 }, local, [])
  assert.equal(merged.apiKey, 'local-secret')
  assert.equal(merged.other, 2)
})
