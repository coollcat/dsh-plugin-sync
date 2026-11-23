import test from 'node:test'
import assert from 'node:assert/strict'

import { createEngine } from '../lib/engine.js'
import { analyzePlugins, validateAdopted } from '../lib/advisor.js'
import { defaultPolicy, validatePolicy } from '../lib/policy.js'
import { resourceHash } from '../lib/protocol.js'

const legacyMemoryRecord = {
  kind: 'memory', key: 'memory:note.md', adapterId: 'memory', relativePath: 'note.md',
  content: 'legacy note body', schemaVersion: 1, contentHash: `sha256:${'a'.repeat(64)}`,
}

// State written by the release that still had the memory domain.
function legacyState() {
  return {
    version: 1,
    identity: { deviceId: 'legacy-device', profileId: 'legacy-profile', label: 'Legacy', role: 'center' },
    topology: 'center',
    policy: defaultPolicy({ caps: { memWrite: true } }),
    center: null, peers: {}, invitations: {},
    expected: [], expectedConfig: [], expectedMemory: [legacyMemoryRecord],
    pluginBaselines: {}, configBaselines: {}, memoryBaselines: { 'memory:note.md': legacyMemoryRecord.contentHash },
    revision: { number: 3, author: 'legacy-device', clock: { 'legacy-device': 3 }, hash: 'rev:3' },
    proposals: [], conflicts: [], outbox: [], remoteState: null, applied: {}, approvals: {},
    lastPlan: null, lastConfigPlan: null, lastMemoryPlan: { planId: 'plan_legacy' },
    lastResults: [], lastConfigResults: [], lastMemoryResults: [{ opId: 'mem-op', status: 'applied' }],
    lastStatus: null, lastConfigStatus: null, lastMemoryStatus: { status: 'ok' },
    suggestions: [
      { id: 'sug_memory', key: 'memory:note.md', action: 'sync', reason: 'legacy memory suggestion', adapterId: 'memory', relativePath: 'note.md' },
      { id: 'sug_plugin', key: 'package-a', action: 'sync', reason: 'plugin suggestion' },
    ],
    pendingSnapshot: {
      identity: { deviceId: 'legacy-center', profileId: 'legacy-profile' },
      revision: { number: 2, hash: 'rev:2', clock: {} },
      expected: [], expectedConfig: [], expectedMemory: [legacyMemoryRecord], trust: 'untrusted',
    },
    suspended: false,
    audit: [{ seq: 1, kind: 'legacy-created' }],
  }
}

test('legacy state drops every memory field on load and stays a valid policy', () => {
  const removed = ['expectedMemory', 'memoryBaselines', 'lastMemoryPlan', 'lastMemoryResults', 'lastMemoryStatus']
  const store = { value: legacyState(), read() { return structuredClone(this.value) }, write(next) { this.value = structuredClone(next) } }
  const engine = createEngine({ store, adapters: { profileId: 'legacy-profile', label: 'Legacy' } })

  const state = engine.publicState()
  for (const key of removed) assert.equal(key in state, false, `${key} must not be exposed by publicState`)
  assert.equal('expectedMemory' in state.pendingSnapshot, false)
  assert.equal('memWrite' in state.policy.caps, false)
  assert.deepEqual(state.suggestions.map(({ id }) => id), ['sug_plugin'])
  assert.deepEqual(validatePolicy(state.policy), [])
  assert.equal(engine.setPolicy(state.policy).ok, true)

  // The migration is persisted, not just projected.
  for (const key of removed) assert.equal(key in store.value, false, `${key} must be removed from persisted state`)
  assert.equal('expectedMemory' in store.value.pendingSnapshot, false)
  assert.equal('memWrite' in store.value.policy.caps, false)
  assert.deepEqual(store.value.suggestions.map(({ id }) => id), ['sug_plugin'])
  assert.deepEqual(store.value.expected, [])
})

function pluginRecord(key, enabled = true) {
  const record = { key, kind: 'plugin', enabled, source: { type: 'registry', package: key, version: '1.0.0' } }
  return { ...record, contentHash: resourceHash(record) }
}

test('advisor classifies plugin suggestions and adoption edits include and localOnly', async () => {
  const records = [
    pluginRecord('@local/dsh-plugin-sync'),
    pluginRecord('@deepseek-ai/official'),
    pluginRecord('pinned-plugin'),
    pluginRecord('disabled-plugin', false),
    pluginRecord('enabled-plugin'),
    pluginRecord('@xmanrui/dsh-im'),
    pluginRecord('@furongjun1999/dsh-memory'),
    pluginRecord('dsh-telegram'),
    pluginRecord('already-included'),
  ]
  const policy = defaultPolicy({ include: ['already-included'], localOnly: ['pinned-plugin'] })
  const suggestions = analyzePlugins(records, policy)
  const actionOf = (key) => suggestions.find((item) => item.key === key)?.action
  assert.equal(actionOf('@local/dsh-plugin-sync'), 'localOnly')
  assert.equal(actionOf('@deepseek-ai/official'), 'localOnly')
  assert.equal(actionOf('pinned-plugin'), 'localOnly')
  assert.equal(actionOf('disabled-plugin'), 'skip')
  // Ordinary plugins are suggested for sync; device-bound ones are hidden.
  assert.equal(actionOf('enabled-plugin'), 'sync')
  assert.equal(actionOf('@xmanrui/dsh-im'), undefined)
  assert.equal(actionOf('@furongjun1999/dsh-memory'), undefined)
  assert.equal(actionOf('dsh-telegram'), undefined)
  assert.equal(actionOf('already-included'), undefined)
  assert.deepEqual(validateAdopted(suggestions, ['unknown-suggestion']), [])

  const store = { read: () => null, write() {} }
  const engine = createEngine({ store, adapters: {
    profileId: 'advisor', label: 'Advisor',
    collectInventory: async () => structuredClone(records), collectConfig: async () => [],
  } })
  engine.setPolicy({ ...engine.publicState().policy, include: ['already-included'], localOnly: ['pinned-plugin'] })
  const scanned = await engine.suggest()
  assert.deepEqual(scanned.suggestions.map(({ key, action }) => [key, action]), [
    ['@local/dsh-plugin-sync', 'localOnly'],
    ['@deepseek-ai/official', 'localOnly'],
    ['pinned-plugin', 'localOnly'],
    ['disabled-plugin', 'skip'],
    ['enabled-plugin', 'sync'],
  ])
  // Suggestions stay advisory until a human adopts them.
  assert.deepEqual(engine.publicState().policy.include, ['already-included'])
  assert.deepEqual(engine.publicState().policy.localOnly, ['pinned-plugin'])

  const ids = scanned.suggestions.filter(({ action }) => action !== 'skip').map(({ id }) => id)
  assert.deepEqual(engine.adoptSuggestions({ ids, actor: 'agent' }), { ok: false, reason: 'user-required' })
  const adopted = engine.adoptSuggestions({ ids, actor: 'user' })
  assert.equal(adopted.ok, true)
  const next = engine.publicState().policy
  assert.deepEqual([...next.include].sort(), ['already-included', 'enabled-plugin'])
  assert.deepEqual([...next.localOnly].sort(), [
    '@deepseek-ai/official', '@local/dsh-plugin-sync', 'pinned-plugin',
  ])
  assert.equal(next.include.includes('disabled-plugin'), false)
  assert.equal(next.localOnly.includes('disabled-plugin'), false)
  assert.deepEqual(engine.publicState().suggestions.map(({ key }) => key), ['disabled-plugin'])
})


test('JSON suggestions are validated, filtered and stay advisory until adopted', async () => {
  const records = [pluginRecord('alpha'), pluginRecord('beta'), pluginRecord('@xmanrui/dsh-im')]
  const store = { read: () => null, write() {} }
  const engine = createEngine({ store, adapters: {
    profileId: 'import', label: 'Import',
    collectInventory: async () => structuredClone(records), collectConfig: async () => [],
  } })
  const text = JSON.stringify([
    { key: 'alpha', action: 'sync', reason: 'portable' },
    { key: 'beta', action: 'localOnly', reason: 'local' },
    { key: '@xmanrui/dsh-im', action: 'sync', reason: 'IM must stay local' },
    { key: 'unknown', action: 'sync', reason: 'not installed' },
    { key: 'gamma', action: 'bogus', reason: 'bad action' },
  ])
  const result = await engine.importSuggestions({ text, actor: 'user' })
  assert.deepEqual(result.imported.map((item) => [item.key, item.action, item.source]), [
    ['alpha', 'sync', 'import'], ['beta', 'localOnly', 'import'],
  ])
  assert.equal(result.skipped.length, 3)
  assert.deepEqual(engine.publicState().policy.include, [])
  assert.deepEqual(engine.publicState().policy.localOnly, [])
  const ids = result.imported.map((item) => item.id)
  assert.equal(engine.adoptSuggestions({ ids, actor: 'agent' }).reason, 'user-required')
  assert.equal(engine.adoptSuggestions({ ids, actor: 'user' }).ok, true)
  assert.deepEqual(engine.publicState().policy.include, ['alpha'])
  assert.deepEqual(engine.publicState().policy.localOnly, ['beta'])
  assert.equal((await engine.importSuggestions({ text: '{', actor: 'user' })).reason, 'invalid-json')
})
