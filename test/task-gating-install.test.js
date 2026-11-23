// Regressions for three behaviours added after 0.4.0:
//  (1) settings sync is gated on a multi-field config surface, and local
//      link:/file: bundles join the inventory (file source, no path leak);
//  (2) the centre can accept a pushed plugin and optionally install it here;
//  (3) adversarial combinations of the above stay closed.
import test from 'node:test'
import assert from 'node:assert/strict'

import { createInventoryAdapter, resourceCatalogue } from '../index.js'
import { MIN_CONFIG_FIELDS, configRecord } from '../lib/config.js'
import { evaluate, defaultPolicy } from '../lib/policy.js'
import { validatePluginSource, validateResourceRecord, resourceHash, signChangeset } from '../lib/protocol.js'
import { buildConfigPlan } from '../lib/planner.js'
import { createEngine } from '../lib/engine.js'

function memoryStore(seed = null) {
  let value = seed
  return { read: () => value, write: (next) => { value = next } }
}
function plugin(key, version, enabled = true, source = null) {
  const record = { kind: 'plugin', key, enabled,
    source: source ?? { type: 'registry', package: key, version } }
  return { ...record, contentHash: resourceHash(record) }
}
function baseAdapters(inventory) {
  const calls = []
  return {
    profileId: 'c', label: 'Center',
    collectInventory: async () => structuredClone(inventory),
    collectConfig: async () => [],
    install: async (payload) => { calls.push(['install', payload]) },
    upgrade: async () => { calls.push(['upgrade']) },
    setEnabled: async () => {},
    putSecret: async () => {}, getSecret: async () => null,
    writeConfig: async () => ({}), calls,
  }
}
async function pairedCenter(inventory = []) {
  const adapters = baseAdapters(inventory)
  const center = createEngine({ store: memoryStore(), adapters })
  await center.pairCenter({ initSource: 'empty' })
  const invite = center.createInvitation()
  const identity = { deviceId: 'd', profileId: 'd', label: 'Device', role: 'device' }
  // Register the peer the same way a real join does, so its token authenticates.
  assert.equal(center.handleHello({ token: invite.token, identity }).error, undefined)
  return { center, adapters, invite, identity }
}
function pushProposal(center, invite, identity, changesetId, resources) {
  const changeset = { id: changesetId, schemaVersion: 1, origin: identity,
    parents: [center.publicState().revision.hash].filter(Boolean),
    resources, issuedAt: '2026-01-01T00:00:00Z', mac: '' }
  changeset.mac = signChangeset(changeset, invite.token)
  return center.handleSubmitProposal({ token: invite.token, identity, changeset })
}

test('MIN_CONFIG_FIELDS gate: single-field config cannot sync settings end to end', () => {
  assert.equal(MIN_CONFIG_FIELDS, 2)
  const one = configRecord({ entryId: 'one', bundle: 'pkg', config: { theme: 'dark' } })
  const two = configRecord({ entryId: 'two', bundle: 'pkg', config: { theme: 'dark', density: 2 } })
  const policy = defaultPolicy({ include: ['one', 'two'],
    configFields: { one: [['theme']], two: [['theme'], ['density']] }, caps: { configSet: true } })
  assert.equal(evaluate(policy, { ...one, requiresCap: 'configSet' }, 'pull').reason, 'config-fields-insufficient')
  assert.equal(evaluate(policy, { ...two, requiresCap: 'configSet' }, 'pull').allowed, true)
  // A planner built from a single-field policy emits no config write.
  const plan = buildConfigPlan({ expected: [one], local: [], baselines: {}, policy })
  assert.equal(plan.operations.length, 0)
  assert.ok(plan.skipped.some((item) => item.reason === 'config-fields-insufficient'))
})

test('resourceCatalogue marks eligibility from non-secret field count', async () => {
  const catalogue = await resourceCatalogue({
    collectInventory: async () => [{ key: 'pkg', enabled: true }],
    collectConfig: async () => [
      { key: 'one', entryId: 'one', bundle: 'pkg', config: { theme: 'dark' } },
      { key: 'two', entryId: 'two', bundle: 'pkg', config: { theme: 'dark', density: 2 } },
      { key: 'sec', entryId: 'sec', bundle: 'pkg', config: { theme: 'dark', password: 'x' } },
    ],
  })
  const byId = Object.fromEntries(catalogue.configs.map((entry) => [entry.entryId, entry]))
  assert.equal(byId.one.eligible, false)
  assert.equal(byId.two.eligible, true)
  assert.equal(byId.sec.eligible, false) // secret field is not a switchable component
  assert.equal(JSON.stringify(catalogue).includes('dark'), false)
})

test('link:/file: bundles enter inventory as content-addressed file sources without leaking paths', async () => {
  const manager = {
    listBundles: async () => ({ ok: true, value: [
      { name: 'dsh-fairy-skin', version: '0.3.15', enabled: true, installed: true, source: 'link:/opt/plugins/dsh-fairy-skin' },
      { name: 'dsh-phone-panel', version: '0.2.0', enabled: true, installed: true, source: 'file:/opt/plugins/dsh-phone-panel' },
      { name: 'normal-pkg', version: '1.0.0', enabled: true, installed: true, source: 'normal-pkg@1.0.0' },
    ] }),
  }
  const adapter = createInventoryAdapter({ get: () => manager }, { name: 'p' })
  const records = await adapter.collectInventory()
  assert.equal(records.length, 3)
  const local = records.find((item) => item.key === 'dsh-fairy-skin')
  assert.equal(local.source.type, 'file')
  assert.equal(local.source.name, 'dsh-fairy-skin')
  assert.match(local.source.sha256, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(validatePluginSource(local.source), [])
  assert.deepEqual(validateResourceRecord(local), [])
  assert.equal(JSON.stringify(records).includes('/opt/plugins'), false)
  assert.equal(records.find((item) => item.key === 'normal-pkg').source.type, 'registry')
  // install still refuses non-registry sources: a local path is not portable.
  await assert.rejects(adapter.install(local.source), /only-registry-install/)
})

test('centre accepts a pushed plugin without installing locally by default', async () => {
  const { center, adapters, invite, identity } = await pairedCenter()
  const submitted = pushProposal(center, invite, identity, 'cs-accept', [plugin('pkg-x', '1.0.0')])
  assert.equal(submitted.status, 'pending')
  const accepted = center.handleAcceptProposal({ proposalId: submitted.proposalId, actor: 'user' })
  assert.equal(accepted.status, 'accepted')
  assert.equal(accepted.localInstall, false)
  assert.equal(center.publicState().expected.length, 1)
  assert.equal(adapters.calls.length, 0, 'acceptance alone must not install on the centre')
})

test('centre accept-and-install publishes and installs here through the guarded chain', async () => {
  const { center, adapters, invite, identity } = await pairedCenter()
  center.setPolicy({ ...center.publicState().policy, caps: { ...center.publicState().policy.caps, install: true } })
  const submitted = pushProposal(center, invite, identity, 'cs-install', [plugin('pkg-y', '2.0.0')])
  assert.equal(submitted.status, 'pending')
  const result = await center.acceptAndInstall({ proposalId: submitted.proposalId, actor: 'user' })
  assert.equal(result.status, 'accepted')
  assert.equal(result.localInstall, true)
  assert.equal(result.install, 'ok')
  assert.equal(center.publicState().expected.length, 1)
  assert.deepEqual(adapters.calls.map((item) => item[0]), ['install'])
  // A second accept is rejected: the proposal is no longer pending.
  const repeat = await center.acceptAndInstall({ proposalId: submitted.proposalId, actor: 'user' })
  assert.equal(repeat.install, 'not-accepted')
  assert.ok(repeat.error)
  assert.equal(adapters.calls.length, 1, 'replay does not install twice')
})

test('accept-and-install respects the install capability gate', async () => {
  const { center, adapters, invite, identity } = await pairedCenter() // install cap stays off
  const submitted = pushProposal(center, invite, identity, 'cs-cap', [plugin('pkg-z', '1.0.0')])
  const result = await center.acceptAndInstall({ proposalId: submitted.proposalId, actor: 'user' })
  assert.equal(result.status, 'accepted')
  assert.equal(result.install, 'no-install')
  assert.equal(center.publicState().expected.length, 1, 'still published to peers')
  assert.equal(adapters.calls.length, 0, 'cap off means no local install')
})

test('adversarial: forged single-field policy, missing proposal and wrong actor stay closed', async () => {
  const adapters = baseAdapters([])
  const center = createEngine({ store: memoryStore(), adapters })
  await center.pairCenter({ initSource: 'empty' })
  assert.equal(center.handleAcceptProposal({ proposalId: 'missing', actor: 'user' }).error, 'proposal-not-found')
  assert.equal((await center.acceptAndInstall({ proposalId: 'missing', actor: 'user' })).install, 'not-accepted')
  assert.equal(center.handleAcceptProposal({ proposalId: 'x', actor: 'agent' }).error, 'user-required')
  assert.equal((await center.acceptAndInstall({ proposalId: 'x', actor: 'agent' })).install, 'not-accepted')
  // validatePolicy still accepts a single-field map (catalogue/UI gate it), but
  // evaluation alone denies it — no written config leaves the device.
  const policy = defaultPolicy({ include: ['row'], configFields: { row: [['theme']] }, caps: { configSet: true } })
  const record = configRecord({ entryId: 'row', bundle: 'pkg', config: { theme: 'dark' } })
  assert.equal(evaluate(policy, { ...record, requiresCap: 'configSet' }, 'pull').allowed, false)
})
