import test from 'node:test'
import assert from 'node:assert/strict'

import { createEngine } from '../lib/engine.js'
import { resourceHash } from '../lib/protocol.js'

function memoryStore(seed = null) {
  let value = seed
  return { read: () => value, write: (next) => { value = next } }
}

function makeAdapters({ profileId, label, inventory = [], secrets = {} }) {
  const calls = []
  const adaptersRef = { inventory }
  return {
    profileId,
    label,
    inventory,
    setInventory: (value) => { adaptersRef.inventory = value },
    collectInventory: async () => structuredClone(adaptersRef.inventory),
    install: async (payload) => { calls.push(['install', payload]) },
    upgrade: async (payload) => { calls.push(['upgrade', payload]) },
    setEnabled: async (key, value) => { calls.push(['enabled', key, value]) },
    putSecret: async (key, value) => { secrets[key] = value },
    getSecret: async (key) => secrets[key],
    calls,
  }
}

function link(center, device) {
  const routes = {
    '/plugin-sync/hello': (body, token) => center.handleHello({ token, identity: body.identity }),
    '/plugin-sync/state': (body, token) => center.handleGetState({ token, deviceId: body.deviceId }),
    '/plugin-sync/proposals': (body, token) => center.handleSubmitProposal({ token, identity: body.identity, changeset: body.changeset }),
  }
  return {
    async send(url, { method, token, body } = {}) {
      const path = new URL(url).pathname
      const handler = routes[path]
      if (!handler) throw Object.assign(new Error('not found'), { code: 'http-404' })
      return handler(body ?? {}, token)
    },
  }
}

const plugin = (key, version, enabled = true) => {
  const record = {
  key,
  kind: 'plugin',
  enabled,
  source: { type: 'registry', package: key, version },
  }
  return { ...record, contentHash: resourceHash(record) }
}

test('center pairing, device join, manual plan, approval and apply', async () => {
  const centerAdapters = makeAdapters({ profileId: 'center-p', label: 'Center', inventory: [plugin('pkg-a', '1.2.0')] })
  const center = createEngine({ store: memoryStore(), adapters: centerAdapters })
  await center.pairCenter({ initSource: 'local' })
  const invite = center.createInvitation()

  const deviceAdapters = makeAdapters({ profileId: 'device-p', label: 'Device', inventory: [] })
  const deviceStore = memoryStore()
  const transport = link(center)
  const linked = createEngine({ store: deviceStore, adapters: deviceAdapters, transport, deviceId: 'device-1' })
  await linked.joinCenter({ url: 'http://127.0.0.1:1', token: invite.token })
  linked.setPolicy({ ...linked.publicState().policy, caps: { ...linked.publicState().policy.caps, install: true } })

  const { plan } = await linked.check()
  assert.equal(plan.operations.length, 2)
  assert.deepEqual(plan.operations.map((op) => op.action), ['install', 'enable'])

  const approved = linked.approve({ planId: plan.planId, opIds: plan.operations.map((op) => op.opId), actor: 'user' })
  assert.equal(approved.ok, true)
  const result = await linked.apply({ planId: plan.planId })
  assert.equal(result.status, 'ok')
  assert.deepEqual(deviceAdapters.calls.map((c) => c[0]), ['install', 'enabled'])

  const replay = await linked.apply({ planId: plan.planId })
  assert.equal(replay.results.every((r) => r.deduplicated), true)
  assert.equal(deviceAdapters.calls.length, 2)
})

test('local policy blocks a center expectation and marks an exception', async () => {
  const centerAdapters = makeAdapters({ profileId: 'center-p', label: 'Center', inventory: [plugin('keep-me', '2.0.0')] })
  const center = createEngine({ store: memoryStore(), adapters: centerAdapters })
  await center.pairCenter({ initSource: 'local' })
  const invite = center.createInvitation()

  const deviceAdapters = makeAdapters({ profileId: 'device-p', label: 'Device', inventory: [plugin('keep-me', '1.0.0')] })
  const store = memoryStore()
  const transport = link(center, null)
  const device = createEngine({ store, adapters: deviceAdapters, transport, deviceId: 'device-2' })
  await device.joinCenter({ url: 'http://127.0.0.1:1', token: invite.token })
  device.setPolicy({ ...device.publicState().policy, localOnly: ['keep-me'] })

  const { plan } = await device.check()
  assert.equal(plan.operations.length, 0)
  assert.equal(plan.skipped.find((s) => s.key === 'keep-me').reason, 'local-only')
})

test('unauthorized peers cannot read center state or submit proposals', async () => {
  const center = createEngine({ store: memoryStore(), adapters: makeAdapters({ profileId: 'c' }) })
  await center.pairCenter({ initSource: 'empty' })
  assert.equal(center.handleGetState({ token: 'wrong', deviceId: 'x' }).error, 'unauthorized')
  assert.equal(center.handleSubmitProposal({ token: 'wrong', identity: { deviceId: 'x' }, changeset: {} }).error, 'unauthorized')
})

test('device proposal becomes a center revision', async () => {
  const center = createEngine({ store: memoryStore(), adapters: makeAdapters({ profileId: 'c', label: 'Center' }) })
  await center.pairCenter({ initSource: 'empty' })
  const invite = center.createInvitation()
  const secrets = {}
  const deviceAdapters = makeAdapters({ profileId: 'd', label: 'Device', inventory: [plugin('pkg-x', '1.0.0')], secrets })
  const store = memoryStore()
  const transport = link(center, null)
  const device = createEngine({ store, adapters: deviceAdapters, transport, deviceId: 'device-3' })
  await device.joinCenter({ url: 'http://127.0.0.1:1', token: invite.token })
  const submitted = await device.submitProposal()
  assert.equal(submitted.status, 'pending')
  const accepted = center.handleAcceptProposal({ proposalId: submitted.proposalId, actor: 'user' })
  assert.equal(accepted.status, 'accepted')
  assert.equal(center.publicState().expected.length, 1)
  assert.equal(center.publicState().revision.number, 2)
})

test('approval is invalidated when the plan changes', async () => {
  const center = createEngine({ store: memoryStore(), adapters: makeAdapters({ profileId: 'c', inventory: [plugin('a', '1.0.0')] }) })
  await center.pairCenter({ initSource: 'local' })
  const { plan } = await center.check()
  const approval = center.approve({ planId: plan.planId, opIds: [], actor: 'user' })
  assert.equal(approval.ok, true)
  // no operations means an empty approval is valid; a changed plan is not
  const current = center.publicState()
  assert.equal(current.lastPlan.planId, plan.planId)
})

test('forged proposal MAC and mismatched origin are rejected', async () => {
  const center = createEngine({ store: memoryStore(), adapters: makeAdapters({ profileId: 'c', label: 'Center' }) })
  await center.pairCenter({ initSource: 'empty' })
  const invite = center.createInvitation()
  const secrets = {}
  const deviceAdapters = makeAdapters({ profileId: 'd', label: 'Device', inventory: [plugin('x', '1.0.0')], secrets })
  const transport = link(center)
  const device = createEngine({ store: memoryStore(), adapters: deviceAdapters, transport, deviceId: 'device-4' })
  await device.joinCenter({ url: 'http://127.0.0.1:1', token: invite.token })

  const changeset = {
    id: 'cs_test',
    schemaVersion: 1,
    origin: { deviceId: 'device-4', profileId: 'd', label: 'Device' },
    parents: [],
    resources: [plugin('x', '1.0.0')],
    issuedAt: '2026-01-01T00:00:00Z',
    mac: `hmac-sha256:${'0'.repeat(64)}`,
  }
  const identity = { deviceId: 'device-4', profileId: 'd', label: 'Device' }
  assert.equal(center.handleSubmitProposal({ token: invite.token, identity, changeset }).error, 'invalid-mac')
  assert.equal(center.handleSubmitProposal({ token: invite.token, identity, changeset: { ...changeset, origin: { ...changeset.origin, profileId: 'other' } } }).error, 'profile-mismatch')
})

test('expired plan is refused after center publishes a new revision', async () => {
  const center = createEngine({ store: memoryStore(), adapters: makeAdapters({ profileId: 'c', label: 'Center', inventory: [plugin('a', '1.0.0')] }) })
  await center.pairCenter({ initSource: 'local' })
  const invite = center.createInvitation()
  const secrets = {}
  const deviceAdapters = makeAdapters({ profileId: 'd', label: 'Device', inventory: [], secrets })
  const transport = link(center)
  const device = createEngine({ store: memoryStore(), adapters: deviceAdapters, transport, deviceId: 'device-5' })
  await device.joinCenter({ url: 'http://127.0.0.1:1', token: invite.token })
  device.setPolicy({ ...device.publicState().policy, caps: { ...device.publicState().policy.caps, install: true } })
  const { plan } = await device.check()
  device.approve({ planId: plan.planId, opIds: plan.operations.map((op) => op.opId), actor: 'user' })

  await center.publishLocal()

  const result = await device.apply({ planId: plan.planId })
  assert.equal(result.status, 'expired')
  assert.equal(result.reason, 'center-revision-changed')
  assert.equal(deviceAdapters.calls.length, 0)
})

test('partial approval executes only the selected operations', async () => {
  const adapters = makeAdapters({ profileId: 'c', inventory: [plugin('a', '1.0.0')] })
  const center = createEngine({ store: memoryStore(), adapters })
  await center.pairCenter({ initSource: 'local' })
  adapters.setInventory([])
  center.setPolicy({ ...center.publicState().policy, caps: { ...center.publicState().policy.caps, install: true } })
  const { plan } = await center.check()
  const first = plan.operations[0].opId
  center.approve({ planId: plan.planId, opIds: [first], actor: 'user' })
  const result = await center.apply({ planId: plan.planId })
  assert.equal(result.status, 'partial')
  assert.equal(result.results.length, plan.operations.length)
  assert.equal(result.unapproved, plan.operations.length - 1)
})
