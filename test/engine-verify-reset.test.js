import test from 'node:test'
import assert from 'node:assert/strict'

import { createEngine } from '../lib/engine.js'

const ENDPOINT = 'http://192.0.2.10:3080/'
const LAN_URL = 'http://192.0.2.10:3080/plugin-sync/hello'

function memoryStore(seed = null) {
  let value = seed
  return { read: () => value, write: (next) => { value = next } }
}

function adapters({ profileId = 'profile', label = 'Profile', secrets = {}, deleted = [] } = {}) {
  return {
    profileId,
    label,
    collectInventory: async () => [],
    collectConfig: async () => [],
    putSecret: async (key, value) => { secrets[key] = value },
    getSecret: async (key) => secrets[key] ?? null,
    deleteSecret: async (key) => { deleted.push(key); delete secrets[key] },
  }
}

// Routes hello requests through the real server-side handler, forwarding the
// verify flag so both verification and pairing use the same code path.
function link(center, seen = []) {
  return {
    async send(url, { token, body } = {}) {
      seen.push({ url, token, body })
      const path = new URL(url).pathname
      if (path.endsWith('/hello')) return center.handleHello({ token, identity: body.identity, verify: body.verify })
      if (path.endsWith('/state')) return center.handleGetState({ token, deviceId: body.deviceId })
      throw new Error(`unexpected-route:${path}`)
    },
  }
}

async function pairedCenter(secrets) {
  const engine = createEngine({ store: memoryStore(), adapters: adapters({ profileId: 'center-p', label: 'Center', secrets }) })
  await engine.pairCenter({ initSource: 'empty' })
  return engine
}

test('plain HTTP on a non-loopback host verifies successfully through the token-gated hello route', async () => {
  const center = await pairedCenter()
  const invite = center.createInvitation()
  const seen = []
  const device = createEngine({
    store: memoryStore(),
    adapters: adapters({ profileId: 'device-p', label: 'Device' }),
    transport: link(center, seen),
    deviceId: 'lan-device',
  })

  const verified = await device.verifyInvitation({ url: ENDPOINT, token: invite.token })

  assert.deepEqual(verified, { ok: true, verified: true, center: center.publicState().identity, topology: 'center' })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, LAN_URL)
  assert.equal(seen[0].token, invite.token)
  assert.equal(seen[0].body.verify, true)
  assert.equal(seen[0].body.identity.deviceId, 'lan-device')
})

test('verification is read-only: it does not pair, store a credential or consume the invitation', async () => {
  const secrets = {}
  const center = await pairedCenter()
  const invite = center.createInvitation()
  const device = createEngine({
    store: memoryStore(),
    adapters: adapters({ profileId: 'device-p', label: 'Device', secrets }),
    transport: link(center),
    deviceId: 'verify-device',
  })

  const verified = await device.verifyInvitation({ url: ENDPOINT, token: invite.token })
  assert.equal(verified.verified, true)
  assert.equal(device.publicState().identity.role, 'unpaired')
  assert.equal(device.publicState().center, null)
  assert.deepEqual(secrets, {})
  assert.equal(center.publicState().invitationCount, 1)
  assert.deepEqual(center.publicState().peers, {})

  // Re-checking proves the invitation was not marked used, and a wrong token
  // is refused by the same verification path.
  assert.equal((await device.verifyInvitation({ url: ENDPOINT, token: invite.token })).verified, true)
  await assert.rejects(device.verifyInvitation({ url: ENDPOINT, token: 'not-the-token' }), /invalid-invitation/)

  // The same token still performs the real pairing afterwards.
  const joined = await device.joinCenter({ url: ENDPOINT, token: invite.token })
  assert.equal(joined.identity.role, 'device')
  assert.equal(joined.center.deviceId, center.publicState().identity.deviceId)
  assert.equal(secrets['plugin-sync/center'], invite.token)
  assert.equal(center.publicState().invitationCount, 0)
  assert.equal(Object.keys(center.publicState().peers).length, 1)
})

test('hello verify still enforces every pairing precondition before answering', async () => {
  const center = await pairedCenter()
  const invite = center.createInvitation()
  const identity = { deviceId: 'visitor', profileId: 'visitor-p', label: 'Visitor', role: 'device' }

  assert.equal(center.handleHello({ token: 'wrong', identity, verify: true }).error, 'invalid-invitation')
  assert.equal(center.handleHello({ token: invite.token, identity: { ...identity, role: 'peer' }, verify: true }).error, 'role-mismatch')

  const verified = center.handleHello({ token: invite.token, identity, verify: true })
  assert.equal(verified.verified, true)
  assert.equal(verified.center.deviceId, center.publicState().identity.deviceId)
  assert.equal(center.publicState().invitationCount, 1)
  assert.deepEqual(center.publicState().peers, {})

  // The normal path still consumes the invitation and adds the peer.
  const paired = center.handleHello({ token: invite.token, identity })
  assert.equal(paired.center.deviceId, center.publicState().identity.deviceId)
  assert.equal(center.publicState().invitationCount, 0)
  assert.equal(Object.keys(center.publicState().peers).length, 1)

  // A fresh token cannot verify an already-connected device.
  const second = center.createInvitation()
  assert.equal(center.handleHello({ token: second.token, identity, verify: true }).error, 'device-already-paired')
})

test('resetSync clears link, peers, invitations and credentials, then allows a different topology', async () => {
  const centerSecrets = {}
  const centerDeleted = []
  const center = createEngine({
    store: memoryStore(),
    adapters: adapters({ profileId: 'center-p', label: 'Center', secrets: centerSecrets, deleted: centerDeleted }),
  })
  await center.pairCenter({ initSource: 'empty' })
  const invite = center.createInvitation()
  // Seed both known credential addresses directly; reset must clear both.
  centerSecrets['plugin-sync/center'] = 'center-token'
  centerSecrets['plugin-sync/peer'] = 'peer-token'

  const deviceSecrets = {}
  const deviceDeleted = []
  const deviceStore = memoryStore()
  const device = createEngine({
    store: deviceStore,
    adapters: adapters({ profileId: 'device-p', label: 'Device', secrets: deviceSecrets, deleted: deviceDeleted }),
    transport: link(center),
    deviceId: 'reset-device',
  })
  device.setPolicy({ ...device.publicState().policy, mode: 'selective', include: ['keep-me'] })
  await device.joinCenter({ url: ENDPOINT, token: invite.token })
  assert.equal(deviceSecrets['plugin-sync/center'], invite.token)
  assert.equal(device.publicState().center?.deviceId, center.publicState().identity.deviceId)

  const reset = await device.resetSync()
  assert.equal(reset.identity.role, 'unpaired')
  assert.equal(reset.topology, 'center')
  assert.equal(reset.center, null)
  assert.deepEqual(reset.peers, {})
  assert.equal(reset.revision.number, 0)
  assert.deepEqual(reset.expected, [])
  assert.deepEqual(reset.expectedConfig, [])
  assert.deepEqual(reset.proposals, [])
  assert.deepEqual(deviceStore.read().outbox, [])
  assert.deepEqual(deviceStore.read().invitations, {})
  assert.equal(deviceStore.read().remoteState, null)
  assert.equal(reset.policy.mode, 'selective')
  assert.deepEqual(reset.policy.include, ['keep-me'])
  assert.equal(reset.policy.topology, 'center')
  assert.deepEqual(deviceSecrets, {})
  assert.deepEqual(deviceDeleted.sort(), ['plugin-sync/center', 'plugin-sync/peer'])
  assert.ok(reset.audit.some((event) => event.kind === 'sync-reset' && event.actor === 'user'))

  // A fresh pairing can now choose another topology.
  const repaired = await device.pairCenter({ topology: 'p2p', initSource: 'empty' })
  assert.equal(repaired.identity.role, 'peer')
  assert.equal(repaired.topology, 'p2p')
  assert.equal(repaired.center, null)

  // The center-side reset clears invitations and connected peers as well.
  const centerReset = await center.resetSync()
  assert.equal(centerReset.identity.role, 'unpaired')
  assert.equal(centerReset.invitationCount, 0)
  assert.deepEqual(centerReset.peers, {})
  assert.deepEqual(centerSecrets, {})
  assert.deepEqual(centerDeleted.sort(), ['plugin-sync/center', 'plugin-sync/peer'])
})

test('verify rejects absent tokens, malformed links, paired profiles and mismatched remotes', async () => {
  const center = await pairedCenter()
  const invite = center.createInvitation()
  const device = createEngine({
    store: memoryStore(),
    adapters: adapters({ profileId: 'device-p', label: 'Device' }),
    transport: link(center),
    deviceId: 'guarded-device',
  })
  await assert.rejects(device.verifyInvitation({ url: ENDPOINT }), /invitation-token-required/)
  await assert.rejects(device.verifyInvitation({ url: 'ftp://192.0.2.10', token: invite.token }), /bad-sync-url/)
  await device.joinCenter({ url: ENDPOINT, token: invite.token })
  await assert.rejects(device.verifyInvitation({ url: ENDPOINT, token: invite.token }), /already-paired/)

  const unpaired = createEngine({
    store: memoryStore(),
    adapters: adapters(),
    transport: { async send() {
      return { ok: true, verified: true, center: { deviceId: 'remote', profileId: 'remote-p', label: 'Remote', role: 'center' }, topology: 'p2p' }
    } },
    deviceId: 'mismatch-device',
  })
  await assert.rejects(unpaired.verifyInvitation({ url: ENDPOINT, token: invite.token }), /bad-remote-identity/)
})

test('resetSync ignores credential deletion failures', async () => {
  const failingAdapters = { ...adapters(), deleteSecret: async () => { throw new Error('no-such-record') } }
  const engine = createEngine({ store: memoryStore(), adapters: failingAdapters })
  await engine.pairCenter({ initSource: 'empty' })
  const reset = await engine.resetSync()
  assert.equal(reset.identity.role, 'unpaired')
  assert.equal(reset.topology, 'center')
})
