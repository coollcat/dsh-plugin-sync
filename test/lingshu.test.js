import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createEngine } from '../lib/engine.js'
import { resourceHash, validateLingshuRecord } from '../lib/protocol.js'
import { canonicalNode, collectLingshu, lingshuCatalogue, resolveBridge, writeLingshu, MAX_TOTAL_BYTES } from '../lib/lingshu.js'
import { defaultPolicy, evaluate } from '../lib/policy.js'
import { buildLingshuPlan } from '../lib/planner.js'

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-sync-')) }
function memoryStore(seed = null) { let value = seed; return { read: () => value, write: (next) => { value = next } } }

const NODE = `---
access_count: 444
condition_space: {"observation_position": "dsh-hook/user-message", "time_window": [1795226836, 1795226836]}
confidence: 0.6
created_at: 1795226836.128472
edges: []
id: "mem_test_1"
importance: 0.35
last_access: 1795248993.2123795
layer: "contextual"
sensitivity: "internal"
session: "session-local"
tags: ["dsh", "user"]
verification_basis: null
verification_state: "unverified"
writer: "dsh-memory"
---
今天讨论的发布窗口是每周三。
`

function writeNode(root, layer, id, text) {
  fs.mkdirSync(path.join(root, layer), { recursive: true })
  fs.writeFileSync(path.join(root, layer, `${id}.md`), text)
}

function memoryAdapter(nodes, calls = []) {
  return {
    async collectLingshu() { return structuredClone(nodes) },
    async writeLingshu(payload) { calls.push(payload); return { restartDetail: 'memoryWrite:applied' } },
  }
}

test('canonical projection drops volatile fields and the rolling time window', () => {
  const canonical = canonicalNode(NODE, { filename: 'mem_test_1.md' })
  assert.equal(canonical.ok, true)
  assert.equal(canonical.layer, 'contextual')
  assert.equal(canonical.sensitivity, 'internal')
  assert.ok(!canonical.content.includes('access_count'))
  assert.ok(!canonical.content.includes('last_access'))
  assert.ok(!canonical.content.includes('session:'))
  assert.ok(!canonical.content.includes('edges:'))
  assert.ok(!canonical.content.includes('time_window'))
  assert.ok(canonical.content.includes('observation_position'))
  assert.ok(canonical.content.includes('tags:'))
  assert.ok(canonical.content.endsWith('今天讨论的发布窗口是每周三。\n'))

  const volatileOnly = NODE.replace('access_count: 444', 'access_count: 999')
    .replace('last_access: 1795248993.2123795', 'last_access: 1')
    .replace('time_window: [1795226836, 1795226836]', 'time_window: [1, 2]')
  assert.equal(canonicalNode(volatileOnly, { filename: 'mem_test_1.md' }).content, canonical.content)
  assert.notEqual(canonicalNode(NODE.replace('每周三', '每周五'), { filename: 'mem_test_1.md' }).content, canonical.content)
})

test('canonical projection rejects unsafe or unreadable nodes', () => {
  assert.equal(canonicalNode('no front matter').ok, false)
  assert.equal(canonicalNode(NODE, { filename: '../escape.md' }).ok, false)
  assert.equal(canonicalNode(NODE.replace('"contextual"', '"persona"'), { filename: 'mem_test_1.md' }).ok, false)
  assert.equal(canonicalNode(NODE.replace('sensitivity: "internal"', 'sensitivity: "top-secret"'), { filename: 'mem_test_1.md' }).ok, false)
  assert.equal(canonicalNode(`${NODE.split('\n---\n')[0]}\n---\n\n`, { filename: 'mem_test_1.md' }).ok, false)
  assert.equal(canonicalNode(`${NODE.split('\n---\n')[0]}\n---\n<!-- mdcg-enc:v1:abc -->\n`, { filename: 'mem_test_1.md' }).ok, false)
})

test('collection filters layers, sensitivity, secrets and symlinks', () => {
  const root = temporary()
  writeNode(root, 'contextual', 'mem_ok_1', NODE)
  writeNode(root, 'knowledge', 'mem_know_1', NODE.replace('"contextual"', '"knowledge"').replace('mem_test_1', 'mem_know_1'))
  writeNode(root, 'contextual', 'mem_private_1', NODE.replace('sensitivity: "internal"', 'sensitivity: "private"').replace('mem_test_1', 'mem_private_1'))
  writeNode(root, 'contextual', 'mem_secret_1', `${NODE.replace('mem_test_1', 'mem_secret_1')}\nAPI key sk-live-abcdefghijklmnopqrstuvwx\n`)
  fs.writeFileSync(path.join(path.dirname(root), 'policy.json'), JSON.stringify({ forbidden: ['\\bsk-[A-Za-z0-9_\\-]{20,}'] }))
  const outside = path.join(root, '..', 'outside.md')
  fs.writeFileSync(outside, NODE)
  fs.symlinkSync(outside, path.join(root, 'contextual', 'mem_link_1.md'))

  const collected = collectLingshu({ root, layers: ['contextual'], maxSensitivity: 'internal' })
  assert.deepEqual(collected.records.map((record) => record.key), ['mem_ok_1'])
  const reasons = new Map(collected.skipped.map((item) => [path.basename(item.key), item.reason]))
  assert.equal(reasons.get('mem_private_1.md'), 'memory-sensitivity-above-policy')
  assert.equal(reasons.get('mem_secret_1.md'), 'secret-pattern')
  assert.ok(![...reasons.keys()].includes('mem_link_1.md'), 'symlinks are not followed')
  assert.ok(collected.records[0].content.includes('每周三'))
  assert.equal(validateLingshuRecord(collected.records[0]).length, 0)

  const catalogue = lingshuCatalogue({ root, layers: ['contextual'], maxSensitivity: 'internal' })
  assert.equal(catalogue.available, true)
  assert.equal(catalogue.layers.find((item) => item.layer === 'contextual').eligible, 1)
  assert.ok(catalogue.eligibleBytes > 0 && catalogue.eligibleBytes < MAX_TOTAL_BYTES)
})

test('policy requires explicit include and enforces layer/sensitivity caps', () => {
  const record = { kind: 'lingshuNode', layer: 'contextual', sensitivity: 'internal', key: 'mem_a' }
  const base = defaultPolicy({ include: [], caps: { memoryWrite: true } })
  assert.equal(evaluate(base, record, 'pull').reason, 'memory-not-explicitly-included')
  const included = defaultPolicy({ include: ['lingshu:contextual'], caps: { memoryWrite: true } })
  assert.equal(evaluate(included, { ...record, bundle: 'lingshu:contextual' }, 'pull').allowed, true)
  const wrongLayer = defaultPolicy({ include: ['lingshu:knowledge'], caps: { memoryWrite: true } })
  assert.equal(evaluate(wrongLayer, { ...record, layer: 'knowledge', bundle: 'lingshu:knowledge' }, 'pull').reason, 'memory-layer-not-in-scope')
  const privateNode = { ...record, sensitivity: 'private', bundle: 'lingshu:contextual' }
  assert.equal(evaluate(included, privateNode, 'pull').reason, 'memory-sensitivity-above-policy')
  const noCap = defaultPolicy({ include: ['lingshu:contextual'] })
  assert.equal(evaluate(noCap, { ...record, bundle: 'lingshu:contextual', requiresCap: 'memoryWrite' }, 'pull').reason, 'cap-disabled:memoryWrite')
})

test('planner emits one high-risk memoryWrite and keeps both sides on a concurrent change', () => {
  const target = { kind: 'lingshuNode', key: 'mem_a', layer: 'contextual', sensitivity: 'internal', content: '---\n---\nA\n', title: 'A' }
  target.contentHash = resourceHash(target)
  const localSame = { ...target }
  const policy = defaultPolicy({ include: ['lingshu:contextual'], caps: { memoryWrite: true } })

  const fresh = buildLingshuPlan({ expected: [target], local: [], baselines: {}, policy, source: 'center:rev1', sourceHash: 'sha256:x', revision: 1 })
  assert.equal(fresh.operations.length, 1)
  assert.equal(fresh.operations[0].action, 'memoryWrite')
  assert.equal(fresh.operations[0].risk, 'high')
  assert.equal(fresh.operations[0].requiresCap, 'memoryWrite')
  assert.equal(fresh.conflicts.length, 0)

  const unchanged = buildLingshuPlan({ expected: [target], local: [localSame], baselines: {}, policy })
  assert.equal(unchanged.operations.length, 0)

  const baseline = 'sha256:' + 'b'.repeat(64)
  const localChanged = { ...localSame, content: '---\n---\nLOCAL\n', contentHash: 'sha256:' + 'c'.repeat(64) }
  const conflict = buildLingshuPlan({ expected: [target], local: [localChanged], baselines: { mem_a: baseline }, policy })
  assert.equal(conflict.operations.length, 0)
  assert.equal(conflict.conflicts[0].kind, 'concurrent-lingshu-change')
  assert.equal(conflict.conflicts[0].resolution, 'manual')

  const localOnly = buildLingshuPlan({ expected: [], local: [localSame], baselines: {}, policy })
  assert.equal(localOnly.operations.length, 0)
  assert.equal(localOnly.skipped[0].reason, 'absent-not-delete')
})

test('a center publishes memory and a device applies it after approval', async () => {
  const target = { kind: 'lingshuNode', key: 'mem_a', layer: 'contextual', sensitivity: 'internal', content: '---\nconfidence: 0.6\n---\n记忆正文\n', title: '记忆正文' }
  target.contentHash = resourceHash(target)
  const include = ['lingshu:contextual']
  const calls = []
  const center = createEngine({
    store: memoryStore(),
    adapters: { profileId: 'center-p', label: 'Center', collectInventory: async () => [], collectConfig: async () => [],
      async collectLingshu() { return [target] }, putSecret: async () => {}, getSecret: async () => 'secret' },
  })
  center.setPolicy(defaultPolicy({ include, caps: { memoryWrite: true } }))
  await center.pairCenter({ initSource: 'local', label: 'center' })
  const published = await center.publishLocal({ kind: 'lingshu' })
  assert.equal(published.status, 'published')

  const invite = center.createInvitation()
  const deviceCalls = []
  const secrets = {}
  const device = createEngine({
    store: memoryStore(),
    adapters: { profileId: 'device-p', label: 'Device', collectInventory: async () => [], collectConfig: async () => [],
      async collectLingshu() { return [] },
      putSecret: async (key, value) => { secrets[key] = value }, getSecret: async (key) => secrets[key] ?? null,
      async writeLingshu(payload) { deviceCalls.push(payload); return { restartRequired: false, detail: 'memoryWrite:applied' } } },
    transport: {
      async send(url, { token, body } = {}) {
        const route = new URL(url).pathname
        if (route.endsWith('/hello')) return center.handleHello({ token, identity: body.identity })
        if (route.endsWith('/state')) return center.handleGetState({ token, deviceId: body.deviceId })
        if (route.endsWith('/proposals')) return center.handleSubmitProposal({ token, identity: body.identity, changeset: body.changeset })
        throw Object.assign(new Error('not found'), { code: 'http-404' })
      },
    },
  })
  device.setPolicy(defaultPolicy({ include, caps: { memoryWrite: true } }))
  const joined = await device.joinCenter({ url: 'http://127.0.0.1:3080', token: invite.token, label: 'device' })
  assert.ok(joined.identity)
  const checked = await device.check({ kind: 'lingshu' })
  assert.equal(checked.status, 'ok')
  assert.equal(checked.lingshuPlan.operations.length, 1)
  const planId = checked.lingshuPlan.planId
  const approved = device.approve({ planId, opIds: checked.lingshuPlan.operations.map((op) => op.opId), actor: 'user' })
  assert.equal(approved.ok, true)
  const applied = await device.apply({ planId })
  assert.equal(applied.status, 'ok')
  assert.equal(deviceCalls.length, 1)
  assert.equal(deviceCalls[0].key, 'mem_a')
  assert.equal(deviceCalls[0].expectedHash, null)
  const state = device.publicState()
  assert.equal(state.lingshuBaselines.mem_a, target.contentHash)
  assert.equal(center.publicState().expectedLingshu.length, 1)
})

test('a review-gate refusal is reported, never retried as success', async () => {
  const target = { kind: 'lingshuNode', key: 'mem_gate', layer: 'knowledge', sensitivity: 'internal', content: '---\n---\n受控内容\n', title: '受控内容' }
  target.contentHash = resourceHash(target)
  const include = ['lingshu:knowledge']
  const secrets = {}
  const center = createEngine({
    store: memoryStore(),
    adapters: { profileId: 'c', label: 'C', collectInventory: async () => [], collectConfig: async () => [],
      async collectLingshu() { return [target] }, putSecret: async () => {}, getSecret: async () => 'secret' },
  })
  center.setPolicy(defaultPolicy({ include, caps: { memoryWrite: true }, lingshu: { layers: ['knowledge'], maxSensitivity: 'internal' } }))
  await center.pairCenter({ initSource: 'empty', label: 'c' })
  await center.publishLocal({ kind: 'lingshu' })
  const invite = center.createInvitation()
  const device = createEngine({
    store: memoryStore(),
    adapters: { profileId: 'd', label: 'D', collectInventory: async () => [], collectConfig: async () => [],
      async collectLingshu() { return [] },
      putSecret: async (key, value) => { secrets[key] = value }, getSecret: async (key) => secrets[key] ?? null,
      async writeLingshu() { return { ok: false, reason: 'memory-needs-review' } } },
    transport: {
      async send(url, { token, body } = {}) {
        const route = new URL(url).pathname
        if (route.endsWith('/hello')) return center.handleHello({ token, identity: body.identity })
        if (route.endsWith('/state')) return center.handleGetState({ token, deviceId: body.deviceId })
        throw Object.assign(new Error('not found'), { code: 'http-404' })
      },
    },
  })
  const policy = defaultPolicy({ include, caps: { memoryWrite: true }, lingshu: { layers: ['knowledge'], maxSensitivity: 'internal' } })
  device.setPolicy(policy)
  await device.joinCenter({ url: 'http://127.0.0.1:3080', token: invite.token, label: 'd' })
  const checked = await device.check({ kind: 'lingshu' })
  assert.equal(checked.lingshuPlan.operations.length, 1)
  const planId = checked.lingshuPlan.planId
  device.approve({ planId, opIds: checked.lingshuPlan.operations.map((op) => op.opId), actor: 'user' })
  const applied = await device.apply({ planId })
  assert.equal(applied.status, 'partial')
  assert.equal(applied.results[0].status, 'compensationFailed')
  assert.equal(applied.results[0].detail, 'memory-needs-review')
  assert.equal(device.publicState().lingshuBaselines.mem_gate, undefined)
})

test('the python bridge writes a real node and the store verifies it', async (t) => {
  const source = path.join(os.homedir(), '.dsh', '.dsh-memory', 'data', 'mdcg')
  const bridge = resolveBridge({ profileDir: path.join(os.homedir(), '.dsh', 'profiles', 'web') })
  if (!bridge || !fs.existsSync(source)) { t.skip('lingshu package or store unavailable'); return }
  const root = temporary()
  fs.cpSync(source, root, { recursive: true })
  const collected = collectLingshu({ root, layers: ['contextual'], maxSensitivity: 'internal' })
  if (!collected.records.length) { t.skip('no contextual nodes to copy'); return }
  const node = collected.records[0]
  const updated = { ...node, content: node.content.replace(/\n[^\n]*\n$/, '\n桥接写入验证正文\n') }
  updated.contentHash = resourceHash(updated)
  const outcome = await writeLingshu({ root, nodes: [updated], bridge })
  assert.equal(outcome.ok, true)
  const after = collectLingshu({ root, layers: ['contextual'], maxSensitivity: 'internal' }).records.find((record) => record.key === node.key)
  assert.equal(after.contentHash, updated.contentHash)
  assert.ok(after.content.includes('桥接写入验证正文'))
})

test('the bridge preserves local edges, sensitivity and bookkeeping on overwrite', async (t) => {
  const source = path.join(os.homedir(), '.dsh', '.dsh-memory', 'data', 'mdcg')
  const bridge = resolveBridge({ profileDir: path.join(os.homedir(), '.dsh', 'profiles', 'web') })
  if (!bridge || !fs.existsSync(source)) { t.skip('lingshu package or store unavailable'); return }
  const root = temporary()
  fs.cpSync(source, root, { recursive: true })
  const collected = collectLingshu({ root, layers: ['contextual'], maxSensitivity: 'internal' })
  if (!collected.records.length) { t.skip('no contextual nodes to copy'); return }
  const node = collected.records[0]
  const file = path.join(root, 'contextual', `${node.key}.md`)
  // Give the local node a graph edge.
  const original = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, original.replace(/^edges: \[.*\]$/m, 'edges: [["mem_other", "depends_on"]]'))
  const before = fs.readFileSync(file, 'utf8')
  const localEdges = /^edges: (.+)$/m.exec(before)?.[1]
  const updated = { ...node, content: node.content.replace(/\n[^\n]*\n$/, '\n桥接覆写后的正文\n') }
  updated.contentHash = resourceHash(updated)
  const outcome = await writeLingshu({ root, nodes: [updated], bridge })
  assert.equal(outcome.ok, true)
  const after = fs.readFileSync(file, 'utf8')
  assert.equal(/^edges: (.+)$/m.exec(after)?.[1], localEdges, 'local graph edges survive an overwrite')
  assert.match(after, /^sensitivity: "internal"$/m, 'sensitivity is inherited locally, never taken from the peer record')
  assert.match(after, /^session: /m)
  assert.match(after, /桥接覆写后的正文/)
})
