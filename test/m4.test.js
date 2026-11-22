import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import os from 'node:os'
import path from 'node:path'

import { exportSnapshot, parseSnapshot, verifySnapshot } from '../lib/snapshot.js'
import { createSshTransport } from '../lib/ssh-transport.js'
import { createEngine } from '../lib/engine.js'
import { hash, resourceHash } from '../lib/protocol.js'
import { buildConfigPlan } from '../lib/planner.js'
import { defaultPolicy } from '../lib/policy.js'

const state = {
  identity: { deviceId: 'offline-center', profileId: 'fixture' },
  revision: { number: 3, hash: 'rev:3' },
  expected: [pluginRecord()],
  expectedConfig: [], expectedMemory: [],
}

test('snapshot round-trips with a checksum and rejects tampering', () => {
  const snapshot = exportSnapshot(state)
  assert.equal(verifySnapshot(snapshot).ok, true)
  assert.equal(parseSnapshot(JSON.stringify(snapshot)).ok, true)
  const tampered = structuredClone(snapshot)
  tampered.expected[0].enabled = false
  assert.equal(verifySnapshot(tampered).reason, 'digest-mismatch')
  assert.equal(parseSnapshot('[]').reason, 'not-a-snapshot')
})

test('snapshot import feeds plans instead of writing directly', async () => {
  const calls = []
  const adapters = {
    profileId: 'd', label: 'D',
    collectInventory: async () => [], collectConfig: async () => [],
    collectMemory: async () => ({ records: [], skipped: [] }),
    install: async (p) => { calls.push(p) }, upgrade: async () => ({}), setEnabled: async () => ({}),
    writeConfig: async () => ({}), writeMemory: async () => ({}),
    putSecret: async () => {}, getSecret: async () => null,
  }
  const engine = createEngine({ store: { read: () => null, write: () => {} }, adapters })
  await engine.pairCenter({ initSource: 'empty' })
  engine.setPolicy({ ...engine.publicState().policy, caps: { ...engine.publicState().policy.caps, install: true } })
  const loaded = await engine.loadSnapshot(JSON.stringify(exportSnapshot(state)))
  assert.equal(loaded.ok, true)
  const { plan } = await engine.check({ kind: 'plugin', source: 'snapshot' })
  assert.equal(plan.source.startsWith('snapshot:'), true)
  assert.equal(plan.operations.length, 2)
  assert.equal(calls.length, 0)
  engine.approve({ planId: plan.planId, opIds: plan.operations.map((op) => op.opId), actor: 'user' })
  const result = await engine.apply({ planId: plan.planId })
  assert.equal(result.status, 'ok')
  assert.equal(calls.length, 1)
})

test('p2p peer merges non-conflicting changes and records conflicts', async () => {
  const center = createEngine({ store: { read: () => null, write: () => {} }, adapters: {
    profileId: 'c', label: 'C', collectInventory: async () => [], collectConfig: async () => [],
    collectMemory: async () => ({ records: [], skipped: [] }),
    install: async () => ({}), upgrade: async () => ({}), setEnabled: async () => ({}),
    writeConfig: async () => ({}), writeMemory: async () => ({}),
    putSecret: async () => {}, getSecret: async () => null,
  } })
  await center.pairCenter({ initSource: 'empty', topology: 'p2p' })
  const invite = center.createInvitation()
  const secrets = {}
  const routes = {
    '/plugin-sync/hello': (body, token) => center.handleHello({ token, identity: body.identity }),
    '/plugin-sync/state': (body, token) => center.handleGetState({ token, deviceId: body.deviceId }),
    '/plugin-sync/proposals': (body, token) => center.handleSubmitProposal({ token, identity: body.identity, changeset: body.changeset }),
  }
  const transport = { async send(url, { token, body } = {}) {
    return routes[new URL(url).pathname](body ?? {}, token)
  } }
  const device = createEngine({ store: { read: () => null, write: () => {} }, transport, adapters: {
    profileId: 'd', label: 'D', collectInventory: async () => [], collectConfig: async () => [],
    collectMemory: async () => ({ records: [], skipped: [] }),
    install: async () => ({}), upgrade: async () => ({}), setEnabled: async () => ({}),
    writeConfig: async () => ({}), writeMemory: async () => ({}),
    putSecret: async (k, v) => { secrets[k] = v }, getSecret: async (k) => secrets[k],
  }, deviceId: 'peer-1' })
  await device.connectPeer({ url: 'http://127.0.0.1:1', token: invite.token })
  const changeset = {
    id: 'cs-p2p', schemaVersion: 1,
    origin: { deviceId: 'peer-1', profileId: 'd', label: 'D' },
    parents: [center.publicState().revision.hash].filter(Boolean),
    resources: [pluginRecord()],
    issuedAt: '2026-01-01T00:00:00Z', mac: '',
  }
  const { signChangeset } = await import('../lib/protocol.js')
  changeset.mac = signChangeset(changeset, invite.token)
  const result = center.handleSubmitProposal({ token: invite.token, identity: changeset.origin, changeset })
  assert.equal(result.status, 'pending')
  const accepted = center.handleAcceptProposal({ proposalId: result.proposalId, actor: 'user' })
  assert.equal(accepted.status, 'accepted')
  assert.equal(center.publicState().expected.length, 1)
})

test('ssh transport keeps host-key checking on and never sends raw secrets in argv', async () => {
  let captured = null
  let stdinData = ''
  const fakeSpawn = (command, args) => {
    captured = { command, args }
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end(value) { stdinData = value?.toString() ?? '' }, on() {} }
    child.getStdin = () => stdinData
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{"ok":true}'))
      child.emit('close', 0)
    })
    return child
  }
  const transport = createSshTransport({
    host: 'example.test', user: 'sync', identityFile: '/keys/id_ed25519', spawnImpl: fakeSpawn,
  })
  const result = await transport.send('http://127.0.0.1:3080/plugin-sync/state', { method: 'POST', token: 'secret-token', body: { a: 1 } })
  assert.deepEqual(result, { ok: true })
  assert.equal(captured.command, 'ssh')
  assert.ok(captured.args.includes('StrictHostKeyChecking=accept-new'))
  const knownHostsArg = captured.args.find((a) => a.startsWith('UserKnownHostsFile='))
  assert.equal(knownHostsArg, `UserKnownHostsFile=${path.join(os.homedir(), '.ssh', 'known_hosts')}`)
  assert.equal(captured.args[captured.args.indexOf('-p') + 1], '22')
  assert.ok(captured.args.includes('BatchMode=yes'))
  assert.equal(captured.args.join(' ').includes('secret-token'), false)
  assert.equal(captured.args.join(' ').includes(Buffer.from('secret-token').toString('base64')), false)
  assert.ok(captured.args.includes('-W'))
  assert.match(stdinData, /Authorization: Bearer secret-token/i)
  await assert.rejects(transport.send('https://public.example/path'), /loopback/)
  await assert.rejects(transport.send('http://127.0.0.1/x', { method: 'GET; echo PWN' }), /method-not-allowed/)
})

test('center-wins strategy resolves a config conflict into an operation', () => {
  const record = (value) => ({ kind: 'pluginConfig', key: 'row-1', entryId: 'row-1', bundle: 'third-party', config: { value }, fields: [['value']], secretKeys: [], contentHash: resourceHash({ kind: 'pluginConfig', config: { value } }) })
  const policy = defaultPolicy({ include: ['row-1'], configFields: { 'row-1': [['value']] }, caps: { configSet: true }, conflictStrategy: 'center-wins' })
  const plan = buildConfigPlan({
    expected: [record('center')], local: [record('local')],
    baselines: { 'row-1': record('base').contentHash }, policy,
  })
  assert.equal(plan.conflicts.length, 1)
  assert.equal(plan.conflicts[0].resolution, 'center-wins')
  assert.equal(plan.operations.length, 1)
  assert.equal(plan.operations[0].risk, 'high')
  assert.ok(plan.operations[0].source.includes('center-wins'))
})

test('p2p concurrent changes stay as conflicts until a human resolves them', async () => {
  const center = createEngine({ store: { read: () => null, write: () => {} }, adapters: {
    profileId: 'c', label: 'C', collectInventory: async () => [pluginRecord()], collectConfig: async () => [],
    collectMemory: async () => ({ records: [], skipped: [] }),
    install: async () => ({}), upgrade: async () => ({}), setEnabled: async () => ({}),
    writeConfig: async () => ({}), writeMemory: async () => ({}),
    putSecret: async () => {}, getSecret: async () => null,
  } })
  await center.pairCenter({ initSource: 'local', topology: 'p2p' })
  const invite = center.createInvitation()
  const { signChangeset } = await import('../lib/protocol.js')
  const identity = { deviceId: 'peer-x', profileId: 'd', label: 'D', role: 'peer' }
  const changeset = {
    id: 'cs-conflict', schemaVersion: 1, origin: identity,
    parents: ['rev:9:stale'],
    resources: [pluginRecord('2.0.0')],
    issuedAt: '2026-01-01T00:00:00Z', mac: '',
  }
  changeset.mac = signChangeset(changeset, invite.token)
  // Register the peer through the normal hello flow.
  center.handleHello({ token: invite.token, identity })
  const result = center.handleSubmitProposal({ token: invite.token, identity, changeset })
  assert.equal(result.status, 'conflict')
  assert.equal(center.handleAcceptProposal({ proposalId: result.proposalId, actor: 'user' }).error, 'unresolved-conflict')
  const conflict = center.publicState().conflicts.find((c) => c.status === 'open')
  assert.ok(conflict)
  assert.equal(center.resolveConflict({ conflictId: conflict.id, choice: 'remote', actor: 'user' }).ok, true)
  assert.equal(center.handleAcceptProposal({ proposalId: result.proposalId, actor: 'user' }).status, 'accepted')
})

function pluginRecord(value = '1.0.0') {
  const record = { key: 'a', kind: 'plugin', enabled: true, source: { type: 'registry', package: 'a', version: value } }
  return { ...record, contentHash: resourceHash(record) }
}

test('signed snapshot rejects a forged body with a recomputed plain digest', () => {
  const signed = exportSnapshot(state, { secret: 'shared-peer-token' })
  assert.equal(signed.manifest.algorithm, 'hmac-sha256')
  assert.equal(parseSnapshot(JSON.stringify(signed), 'shared-peer-token').ok, true)
  assert.equal(parseSnapshot(JSON.stringify(signed), 'wrong-token').reason, 'digest-mismatch')
  const forged = structuredClone(signed)
  forged.expected[0].enabled = false
  const { manifest: _ignored, ...forgedBody } = forged
  forged.manifest.digest = hash(forgedBody) // plain hash cannot replace an HMAC
  assert.equal(parseSnapshot(JSON.stringify(forged), 'shared-peer-token').reason, 'digest-mismatch')
})
