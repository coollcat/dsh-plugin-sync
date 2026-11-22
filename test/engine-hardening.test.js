import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngine } from '../lib/engine.js'
import { configRecord } from '../lib/config.js'
import { evaluate, defaultPolicy } from '../lib/policy.js'
import { resourceHash } from '../lib/protocol.js'

function resource(fields) { return { ...fields, contentHash: resourceHash(fields) } }
function plugin(key, enabled = true, version = '1.0.0') {
  return resource({ kind: 'plugin', key, enabled, source: { type: 'registry', package: key, version } })
}
const config = (value, entryId = 'row') => configRecord({ entryId, bundle: 'package-a', config: { updates: { 'literal.key': value, other: 'PRIVATE' }, token: 'SECRET' } })
const field = ['updates', 'literal.key']
const shared = { include: ['row'], configFields: { row: [field] } }

function node(deviceId, values = {}, transport) {
  const store = { read() { return structuredClone(this.value) }, write(next) { this.value = structuredClone(next) } }
  const data = { plugin: [], config: [], ...values }
  const calls = []
  const credentials = new Map()
  const adapters = {
    profileId: deviceId, label: deviceId,
    collectInventory: async () => structuredClone(data.plugin),
    collectConfig: async () => structuredClone(data.config),
    getSecret: async (key) => credentials.get(key), putSecret: async (key, secret) => credentials.set(key, secret),
    install: async (source) => {
      calls.push('install')
      data.plugin.push(plugin(source.package, false, source.version))
    },
    upgrade: async (source) => {
      calls.push('upgrade')
      data.plugin = data.plugin.map((entry) => entry.key === source.package ? plugin(entry.key, entry.enabled, source.version) : entry)
    },
    setEnabled: async (key, enabled) => {
      calls.push(enabled ? 'enable' : 'disable')
      data.plugin = data.plugin.map((entry) => entry.key === key ? plugin(key, enabled, entry.source.version) : entry)
    },
    writeConfig: async (payload) => { calls.push(payload); data.config = [config(payload.config.updates['literal.key'])] },
  }
  const engine = createEngine({ store, adapters, transport, deviceId })
  const setPolicy = (patch, caps) => {
    const current = engine.publicState().policy
    assert.equal(engine.setPolicy({ ...current, ...patch, caps: { ...current.caps, ...caps } }).ok, true)
  }
  return { engine, store, data, calls, setPolicy, adapters }
}

function link(listener, hook = (_, value) => value) {
  return { async send(url, { token, body }) {
    const method = new URL(url).pathname.split('/').at(-1)
    const handlers = { hello: 'handleHello', state: 'handleGetState', proposals: 'handleSubmitProposal' }
    return hook(method, await listener[handlers[method]]({ token, ...body }), body)
  } }
}

const ENDPOINT = 'http://127.0.0.1:3000'
function approve(engine, plan, selection = plan.operations) {
  return engine.approve({ planId: plan.planId, actor: 'user', opIds: selection.map(({ opId }) => opId) })
}

test('check(all) has isolated approvals and apply binds the active policy', async () => {
  const center = node('center', { plugin: [plugin('package-a')], config: [config('remote')] })
  center.setPolicy(shared)
  await center.engine.pairCenter({ initSource: 'local' })
  const member = node('member', { config: [config('base')] }, link(center.engine))
  member.setPolicy(shared, { install: true, configSet: true })
  await member.engine.joinCenter({ url: ENDPOINT, token: center.engine.createInvitation().token })
  const { plan, configPlan } = await member.engine.check({ kind: 'all' })
  assert.deepEqual([plan.operations.length, configPlan.operations.length], [2, 1])
  // Each domain carries its own approval: approving the config plan does not
  // authorize the plugin plan, and vice versa.
  assert.equal(approve(member.engine, configPlan).ok, true)
  assert.equal((await member.engine.apply({ planId: plan.planId })).status, 'unauthorized')
  assert.deepEqual(member.calls, [])
  assert.equal((await member.engine.apply({ planId: configPlan.planId })).status, 'ok')
  assert.deepEqual(member.calls[0].fields, [field])
  assert.equal(member.calls[0].bundle, 'package-a')
  assert.equal(member.calls[0].expectedHash, configPlan.operations[0].fromHash)
  assert.deepEqual(member.calls[0].config, { updates: { 'literal.key': 'remote' } })
  assert.equal(approve(member.engine, plan).ok, true)
  member.setPolicy({ direction: 'push' })
  assert.equal((await member.engine.apply({ planId: plan.planId })).status, 'unauthorized')
  assert.equal(member.calls.includes('install'), false)
})

test('pair, proposal, state, and snapshot share only policy-selected resources and config fields', async () => {
  const values = { plugin: [plugin('package-a'), plugin('private'), plugin('excluded'), plugin('@local/dsh-plugin-sync'), plugin('@deepseek-ai/official')],
    config: [config('public'), config('not-opted-in', 'other-row')] }
  const sender = node('sender', values)
  sender.setPolicy({ localOnly: ['private'], exclude: ['excluded'], protected: [] })
  await sender.engine.pairCenter({ initSource: 'local' })
  assert.deepEqual(sender.engine.publicState().expected.map(({ key }) => key), ['package-a'])
  assert.equal(sender.engine.publicState().expectedConfig.length, 0)
  sender.setPolicy(shared)
  await sender.engine.publishLocal()
  const snap = await sender.engine.createSnapshot()
  assert.deepEqual(snap.expectedConfig.map(({ key }) => key), ['row'])
  assert.deepEqual(snap.expectedConfig[0].config, { updates: { 'literal.key': 'public' } })
  assert.deepEqual(snap.expectedConfig[0].secretKeys, [])
  assert.doesNotMatch(JSON.stringify(snap), /PRIVATE|SECRET|not-opted-in/)
  let wire
  const member = node('member', values, link(sender.engine, (method, response, body) => { if (method === 'proposals') wire = body.changeset; return response }))
  member.setPolicy({ ...shared, localOnly: ['private'], exclude: ['excluded'] })
  const invite = sender.engine.createInvitation()
  await member.engine.joinCenter({ url: ENDPOINT, token: invite.token })
  assert.equal((await member.engine.submitProposal({ kind: 'all' })).status, 'pending')
  assert.deepEqual(wire.resources.map(({ key }) => key), ['package-a', 'row'])
  assert.doesNotMatch(JSON.stringify(wire), /PRIVATE|SECRET|not-opted-in/)
  sender.setPolicy({ localOnly: ['package-a', 'row'] })
  const state = sender.engine.handleGetState({ token: invite.token, deviceId: 'member' })
  assert.deepEqual([state.expected, state.expectedConfig], [[], []])
  member.setPolicy({ direction: 'pull' })
  assert.deepEqual(await member.engine.submitProposal(), { ok: false, reason: 'direction-blocked:push' })
  assert.equal((await member.engine.createSnapshot()).ok, false)
})

test('unknown capability and protected entry aliases fail closed', () => {
  assert.equal(evaluate(defaultPolicy({ caps: { unknown: true } }), { key: 'normal', requiresCap: 'unknown' }, 'pull').allowed, false)
  for (const bundle of ['@local/dsh-plugin-sync', '@deepseek-ai/official']) {
    const policy = defaultPolicy({ ...shared, protected: [], caps: { configSet: true } })
    assert.equal(evaluate(policy, { kind: 'pluginConfig', key: 'row', bundle, requiresCap: 'configSet' }, 'pull').reason, 'system-protected')
  }
})

test('partial approval needs install and successful install survives adapter failure and process restart', async () => {
  const center = node('center', { plugin: [plugin('package-a')] })
  await center.engine.pairCenter({ initSource: 'local' })
  center.setPolicy({}, { install: true })
  center.data.plugin = []
  const { plan } = await center.engine.check()
  const install = plan.operations.find(({ action }) => action === 'install')
  const enable = plan.operations.find(({ action }) => action === 'enable')
  approve(center.engine, plan, [enable])
  const unapproved = await center.engine.apply({ planId: plan.planId })
  assert.deepEqual(unapproved.results.map(({ status }) => status), ['rejected', 'conflict'])
  assert.deepEqual(center.calls, [])
  approve(center.engine, plan, [install, enable])
  const originalEnable = center.adapters.setEnabled
  center.adapters.setEnabled = async () => {
    assert.equal(center.store.value.applied[plan.planId].successes[install.opId].status, 'applied')
    return { ok: false, error: 'temporary' }
  }
  assert.equal((await center.engine.apply({ planId: plan.planId })).status, 'partial')
  center.adapters.setEnabled = originalEnable
  const restarted = createEngine({ store: center.store, adapters: center.adapters })
  const results = await Promise.all([restarted.apply({ planId: plan.planId }), restarted.apply({ planId: plan.planId })])
  assert.equal(results[0].results[0].deduplicated, true)
  assert.equal(results[1].results.every(({ deduplicated }) => deduplicated), true)
  assert.deepEqual(center.calls, ['install', 'enable'])
})

test('equal baselines preserve local-only edits and AI suggestions require a fresh human decision', async () => {
  const center = node('center', { config: [config('base')] })
  center.setPolicy(shared)
  await center.engine.pairCenter({ initSource: 'local' })
  const member = node('member', { config: [config('base')] }, link(center.engine))
  member.setPolicy({ ...shared, conflictStrategy: 'ai-suggest' }, { configSet: true })
  await member.engine.joinCenter({ url: ENDPOINT, token: center.engine.createInvitation().token })
  assert.equal((await member.engine.check({ kind: 'config' })).configPlan.operations.length, 0)
  assert.equal(member.engine.publicState().configBaselines.row, configRecord({ ...config('base'), fields: [field] }).contentHash)
  member.data.config = [config('local')]
  const unilateral = (await member.engine.check({ kind: 'config' })).configPlan
  assert.equal(unilateral.operations.length, 0)
  assert.equal(unilateral.skipped[0].reason, 'local-changed')
  center.data.config = [config('center')]
  await center.engine.publishLocal({ kind: 'config' })
  const conflict = (await member.engine.check({ kind: 'config' })).configPlan
  assert.equal(conflict.conflicts[0].suggestion, 'manual-review')
  assert.equal(conflict.operations.length, 0)
  approve(member.engine, conflict)
  const decision = await member.engine.resolvePlanConflict({ planId: conflict.planId, key: 'row', choice: 'remote' })
  assert.equal(decision.ok, true)
  assert.notEqual(decision.plan.planId, conflict.planId)
  assert.equal(decision.plan.operations[0].risk, 'high')
  assert.equal((await member.engine.apply({ planId: decision.plan.planId })).status, 'unauthorized')
  approve(member.engine, decision.plan)
  assert.equal((await member.engine.apply({ planId: decision.plan.planId })).status, 'ok')
})

test('two peers exchange both ways, retain divergent versions and resolve only at acceptance', async () => {
  const p1 = node('p1', { plugin: [plugin('package-a', true, '1.0.0')] })
  await p1.engine.pairCenter({ initSource: 'local', topology: 'p2p' })
  const p2 = node('p2', { plugin: [plugin('package-b')] }, link(p1.engine))
  const invite = p1.engine.createInvitation()
  await p2.engine.connectPeer({ url: ENDPOINT, token: invite.token })
  await p2.engine.publishLocal()
  assert.equal((await p2.engine.check({ kind: 'all' })).status, 'ok')
  assert.equal((await p1.engine.check({ kind: 'all' })).status, 'ok')
  assert.equal((await p2.engine.submitProposal()).status, 'pending')
  const queued = await p1.engine.submitProposal()
  assert.equal(queued.status, 'queued')
  await p2.engine.check()
  const outbound = p2.engine.publicState().proposals[0]
  assert.equal(outbound.resources[0].key, 'package-a')
  assert.equal(p2.engine.handleAcceptProposal({ proposalId: outbound.id, actor: 'user' }).status, 'accepted')
  const stale = p1.engine.publicState().proposals[0]
  p1.data.plugin = [plugin('package-a', true, '2.0.0')]
  await p1.engine.publishLocal()
  assert.equal(p1.engine.handleAcceptProposal({ proposalId: stale.id, actor: 'user' }).error, 'stale-parent')
  assert.equal(p1.engine.rejectProposal({ proposalId: stale.id, actor: 'user' }).status, 'rejected')
  p2.data.plugin = [plugin('package-a', true, '3.0.0')]
  const submitted = await p2.engine.submitProposal()
  assert.equal(submitted.status, 'conflict')
  const open = p1.engine.publicState().conflicts.find(({ proposalId }) => proposalId === submitted.proposalId)
  const revision = p1.engine.publicState().revision.hash
  assert.equal(p1.engine.resolveConflict({ conflictId: open.id, choice: 'remote', actor: 'user' }).ok, true)
  assert.equal(p1.engine.publicState().revision.hash, revision)
  assert.equal(p1.engine.publicState().expected[0].source.version, '2.0.0')
  assert.equal(p1.engine.handleAcceptProposal({ proposalId: submitted.proposalId, actor: 'user' }).status, 'accepted')
  assert.equal(p1.engine.publicState().expected[0].source.version, '3.0.0')
  assert.equal(p1.engine.revokePeer({ deviceId: 'p2' }).status, 'revoked')
  assert.equal((await p2.engine.check()).status, 'offline')
  assert.equal(typeof p1.engine.createInvitation().token, 'string')
})

test('accepted P2P listener config becomes a local apply plan without republishing', async () => {
  const key = 'row'
  const policy = { include: [key], configFields: { row: [field] } }
  const listener = node('listener')
  listener.setPolicy(policy)
  await listener.engine.pairCenter({ topology: 'p2p' })
  const joiner = node('joiner', {}, link(listener.engine))
  joiner.setPolicy(policy, { configSet: true })
  await joiner.engine.connectPeer({ url: ENDPOINT, token: listener.engine.createInvitation().token })

  // Establish the listener's cached view of the joiner's state before publishing.
  assert.equal((await joiner.engine.check()).status, 'ok')
  listener.data.config = [config('new note from listener')]
  assert.equal((await listener.engine.submitProposal({ kind: 'config' })).status, 'queued')
  assert.deepEqual(listener.engine.publicState().expectedConfig, [])
  assert.deepEqual(joiner.data.config, [])

  // The joiner pulls the queued offer, accepts it, then plans against its newer
  // causal revision rather than the listener's intentionally stale publication.
  assert.equal((await joiner.engine.check()).status, 'ok')
  const proposal = joiner.engine.publicState().proposals.find(({ status }) => status === 'pending')
  assert.ok(proposal)
  assert.equal(joiner.engine.handleAcceptProposal({ proposalId: proposal.id, actor: 'user' }).status, 'accepted')
  assert.equal(listener.engine.publicState().expectedConfig.length, 0)
  assert.equal(joiner.engine.publicState().expectedConfig[0].key, key)

  const checked = await joiner.engine.check({ kind: 'config' })
  assert.equal(checked.configPlan.operations.length, 1, JSON.stringify({ local: joiner.engine.publicState().revision, remote: joiner.engine.publicState().peers.listener, expected: joiner.engine.publicState().expectedConfig, last: joiner.engine.publicState().lastConfigPlan }))
  approve(joiner.engine, checked.configPlan)
  assert.equal((await joiner.engine.apply({ planId: checked.configPlan.planId })).status, 'ok')
  assert.equal(joiner.data.config[0].config.updates['literal.key'], 'new note from listener')
  const second = await joiner.engine.check({ kind: 'config' })
  assert.equal(second.configPlan.operations.length, 0)
  assert.deepEqual(listener.engine.publicState().expectedConfig, [])
})


test('peer business errors, wrong identity, and pause cannot start a successful flow', async () => {
  const p1 = node('p1')
  await p1.engine.pairCenter({ topology: 'p2p' })
  const invite = p1.engine.createInvitation()
  const p2 = node('p2', { plugin: [plugin('package-a')] }, link(p1.engine, (method, response) =>
    method === 'state' ? { ...response, identity: { ...response.identity, profileId: 'wrong' } } : response))
  await assert.rejects(p2.engine.joinCenter({ url: ENDPOINT, token: invite.token }), /role-mismatch/)
  await p2.engine.connectPeer({ url: ENDPOINT, token: invite.token })
  assert.equal((await p2.engine.check()).detail, 'invalid-remote-state')
  p1.engine.suspend(true)
  assert.deepEqual(await p1.engine.check(), { status: 'suspended' })
  assert.deepEqual(await p1.engine.createSnapshot(), { ok: false, reason: 'suspended' })
  assert.equal((await p2.engine.submitProposal()).reason, 'suspended')
  assert.throws(() => p1.engine.createInvitation(), /suspended/)
})

test('a suspended in-flight apply commits its completed adapter result and stops later writes', async () => {
  const center = node('center', { plugin: [plugin('package-a')] })
  await center.engine.pairCenter({ initSource: 'local' })
  center.setPolicy({}, { install: true })
  center.data.plugin = []
  const { plan } = await center.engine.check()
  approve(center.engine, plan)
  const started = Promise.withResolvers()
  const release = Promise.withResolvers()
  const install = center.adapters.install
  center.adapters.install = async (payload) => {
    started.resolve()
    await release.promise
    return install(payload)
  }
  const applying = center.engine.apply({ planId: plan.planId })
  await started.promise
  const queuedCheck = center.engine.check()
  center.engine.suspend(true)
  center.engine.suspend(false)
  release.resolve()
  assert.equal((await applying).status, 'suspended')
  assert.deepEqual(await queuedCheck, { ok: false, reason: 'suspended' })
  assert.deepEqual(center.calls, ['install'])
  const retry = await center.engine.apply({ planId: plan.planId })
  assert.equal(retry.status, 'ok')
  assert.equal(retry.results[0].deduplicated, true)
  assert.deepEqual(center.calls, ['install', 'enable'])
})

test('upgrade preserves disabled baseline through failure and retries enable after restart', async () => {
  const center = node('center', { plugin: [plugin('package-a', true, '2.0.0')] })
  await center.engine.pairCenter({ initSource: 'local' })
  center.setPolicy({}, { upgrade: true })
  center.data.plugin = [plugin('package-a', false, '1.0.0')]
  const { plan } = await center.engine.check()
  assert.deepEqual(plan.operations.map(({ action }) => action), ['upgrade', 'enable'])
  approve(center.engine, plan)
  const enable = center.adapters.setEnabled
  center.adapters.setEnabled = async () => { throw new Error('sensitive diagnostic /private/path synthetic-secret') }
  const first = await center.engine.apply({ planId: plan.planId })
  assert.deepEqual(first.results.map(({ status, detail }) => [status, detail]), [['applied', 'upgrade'], ['compensationFailed', 'operation-failed']])
  assert.doesNotMatch(JSON.stringify(center.engine.publicState()), /synthetic-secret|\/private\/path/)
  assert.deepEqual(center.data.plugin, [plugin('package-a', false, '2.0.0')])
  center.adapters.setEnabled = enable
  const restarted = createEngine({ store: center.store, adapters: center.adapters })
  const retry = await restarted.apply({ planId: plan.planId })
  assert.equal(retry.status, 'ok')
  assert.equal(retry.results[0].deduplicated, true)
  assert.deepEqual(center.calls, ['upgrade', 'enable'])
  assert.deepEqual(center.data.plugin, [plugin('package-a', true, '2.0.0')])
})

test('proposal queues reject overflow and preserve earlier queued proposals', async () => {
  const center = node('center')
  await center.engine.pairCenter()
  const member = node('member', {}, link(center.engine))
  await member.engine.joinCenter({ url: ENDPOINT, token: center.engine.createInvitation().token })
  for (let i = 0; i < 64; i++) {
    member.data.plugin = [plugin(`plugin-${i}`)]
    assert.equal((await member.engine.submitProposal()).status, 'pending')
  }
  member.data.plugin = [plugin('overflow')]
  assert.deepEqual(await member.engine.submitProposal(), { ok: false, reason: 'queue-full' })
  assert.equal(center.engine.publicState().proposals.length, 64)
  assert.equal(center.engine.publicState().proposals[0].resources[0].key, 'plugin-0')

  const listener = node('listener')
  await listener.engine.pairCenter({ topology: 'p2p' })
  const joiner = node('joiner', {}, link(listener.engine))
  await joiner.engine.connectPeer({ url: ENDPOINT, token: listener.engine.createInvitation().token })
  for (let i = 0; i < 32; i++) {
    listener.data.plugin = [plugin(`plugin-${i}`)]
    assert.equal((await listener.engine.submitProposal()).status, 'queued')
  }
  listener.data.plugin = [plugin('overflow')]
  assert.deepEqual(await listener.engine.submitProposal(), { ok: false, reason: 'queue-full' })
  await joiner.engine.check()
  assert.equal(joiner.engine.publicState().proposals.length, 32)
  assert.equal(joiner.engine.publicState().proposals[0].resources[0].key, 'plugin-0')
  await joiner.engine.check()
  assert.equal((await listener.engine.submitProposal()).status, 'queued')
})

test('state capacity gate leaves persisted and in-memory state unchanged', async () => {
  const center = node('center')
  await center.engine.pairCenter()
  center.data.plugin = [plugin('package-a')]
  const baseSize = Buffer.byteLength(JSON.stringify({ ...center.store.value, existingData: '' }))
  center.store.value.existingData = 'x'.repeat(16 * 1024 * 1024 - baseSize)
  const engine = createEngine({ store: center.store, adapters: center.adapters })
  assert.deepEqual(await engine.publishLocal(), { ok: false, reason: 'state-capacity-exceeded' })
  assert.deepEqual(engine.publicState().expected, [])
  assert.deepEqual(center.store.value.expected, [])
})

test('archival requires a user and a backup, preserves pending proposals, and reopens a full queue', async () => {
  const center = node('center')
  await center.engine.pairCenter()
  let initialWire
  const member = node('member', { plugin: [plugin('archive-first')] }, link(center.engine, (method, response, body) => {
    if (method === 'proposals') initialWire ??= body
    return response
  }))
  const invitation = center.engine.createInvitation()
  await member.engine.joinCenter({ url: ENDPOINT, token: invitation.token })
  const first = await member.engine.submitProposal()
  assert.equal(center.engine.rejectProposal({ proposalId: first.proposalId, actor: 'user' }).status, 'rejected')
  member.data.plugin = [plugin('pending')]
  const pending = await member.engine.submitProposal()
  const original = center.store.read()
  const rejected = original.proposals.find(({ id }) => id === first.proposalId)
  original.proposals.push(...Array.from({ length: 254 }, (_, i) => ({ ...rejected, id: `archive-fixture-${i}` })))
  center.store.write(original)
  const engine = createEngine({ store: center.store, adapters: center.adapters })
  const nextMember = node('next-member', { plugin: [plugin('after-archive')] }, link(engine))
  await nextMember.engine.joinCenter({ url: ENDPOINT, token: engine.createInvitation().token })
  assert.equal((await nextMember.engine.submitProposal()).reason, 'queue-full')
  assert.equal((await engine.archiveDecisions({ actor: 'scheduler' })).reason, 'user-required')
  assert.equal((await engine.archiveDecisions({ actor: 'user' })).reason, 'archive-unavailable')
  center.adapters.archiveDecisions = async () => { throw new Error('private backup path') }
  assert.equal((await engine.archiveDecisions({ actor: 'user' })).reason, 'archive-failed')
  assert.equal(engine.publicState().proposals.length, 256)

  const write = center.store.write
  center.adapters.archiveDecisions = async ({ proposals, conflicts }) => {
    assert.equal(proposals.length, 255)
    assert.equal(proposals.every(({ status }) => status === 'rejected'), true)
    assert.deepEqual(conflicts, [])
    assert.equal(engine.publicState().proposals.length, 256)
    return { archiveId: 'archive-fixture.json' }
  }
  center.store.write = () => { throw new Error('disk full') }
  assert.equal((await engine.archiveDecisions({ actor: 'user' })).reason, 'archive-state-write-failed')
  assert.equal(engine.publicState().proposals.length, 256)
  assert.equal(center.store.read().proposals.length, 256)
  center.store.write = write
  assert.deepEqual(await engine.archiveDecisions({ actor: 'user' }), { status: 'archived', count: 255, archiveId: 'archive-fixture.json' })
  assert.deepEqual(engine.publicState().proposals.map(({ id, status }) => ({ id, status })), [{ id: pending.proposalId, status: 'pending' }])
  assert.equal((await nextMember.engine.submitProposal()).status, 'pending')
  const replay = () => engine.handleSubmitProposal({ ...initialWire, token: invitation.token })
  assert.equal(replay().status, 'duplicate')
  assert.equal(engine.handleAcceptProposal({ proposalId: pending.proposalId, actor: 'user' }).status, 'accepted')
  assert.equal(replay().error, 'stale-parent')
})
