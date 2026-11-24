// Local orchestration. Network handlers never call mutation adapters.
import {
  hash, id, safeEqual, signChangeset, verifyChangesetMac, token as randomToken,
  validateChangeset, validateIdentity, validateResourceRecord, validateStatePayload,
  withinPayloadLimit, resourceHash, MAX_RESOURCES,
} from './protocol.js'
import { configFieldsFor, defaultPolicy, evaluate, lingshuBundle, policyHash, validatePolicy } from './policy.js'
import { buildPlan, buildConfigPlan, buildLingshuPlan, inventoryHash } from './planner.js'
import { getPath, projectConfig } from './config.js'
import { analyzePlugins, isDeviceLocal, validateAdopted } from './advisor.js'
import { exportSnapshot, parseSnapshot } from './snapshot.js'
import { createSshTransport } from './ssh-transport.js'
import { createApproval, verifyApproval } from './authorizer.js'
import { compareClocks, nextRevision, revisionHash } from './versioning.js'
import { createAudit } from './audit.js'
import { createTransport, TransportError, bearerFrom } from './transport.js'

const MAX_STATE_BYTES = 16 * 1024 * 1024
const MAX_PENDING_PROPOSALS = 64
const MAX_PROPOSALS = 256
const MAX_QUEUED_OFFERS = 32
const CAPACITY_ERROR = 'state-capacity-exceeded'
const stateBytes = (value) => Buffer.byteLength(JSON.stringify(value))
const INVITE_TTL_MS = 24 * 60 * 60 * 1000
const DOMAIN = {
  plugin: { record: 'plugin', expected: 'expected', plan: 'lastPlan', baselines: 'pluginBaselines', results: 'lastResults', status: 'lastStatus', output: 'plan', build: buildPlan },
  config: { record: 'pluginConfig', expected: 'expectedConfig', plan: 'lastConfigPlan', baselines: 'configBaselines', results: 'lastConfigResults', status: 'lastConfigStatus', output: 'configPlan', build: buildConfigPlan },
  lingshu: { record: 'lingshuNode', expected: 'expectedLingshu', plan: 'lastLingshuPlan', baselines: 'lingshuBaselines', results: 'lastLingshuResults', status: 'lastLingshuStatus', output: 'lingshuPlan', build: buildLingshuPlan },
}
const AUTO_ACTIONS = new Set(['enable', 'disable', 'configSet'])
const SUCCESS = new Set(['applied', 'needsRestart'])
const sameIdentity = (a, b) => Boolean(a && b && a.deviceId === b.deviceId && a.profileId === b.profileId)
const getOwn = (object, key) => Object.hasOwn(object ?? {}, key) ? object[key] : undefined
const byKey = (records) => new Map(records.map((item) => [item.key, item]))
const fail = (reason) => ({ ok: false, reason })
export const PUBLIC_ERRORS = new Set([
  'aborted', 'already-paired', 'bad-http', 'bad-json', 'bad-sync-url', 'bad-token', 'bad-url', 'connection-revoked', 'device-already-paired',
  'direction-blocked:pull', 'direction-blocked:push', 'invalid-changeset', 'invalid-identity', 'invalid-invitation',
  'invalid-mac', 'invalid-pair-options', 'invalid-peer-state', 'invalid-published-state', 'invalid-remote-state', 'invalid-ssh-host-or-user',
  'invalid-ssh-port', 'invalid-ssh-timeout', 'invitation-expired', 'invitation-token-required', 'memory-bridge-unavailable', 'memory-needs-review',
  'memory-write-denied', 'memory-write-failed', 'network', 'no-shareable-resources',
  'origin-mismatch', 'payload-too-large', 'peer-already-connected', 'profile-mismatch', 'remote-error',
  'remote-state-failed', 'requires-center-or-peer-role', 'role-mismatch', 'ssh-failed',
  'ssh-requires-absolute-identity-and-known-hosts-paths', 'stale-center-revision', 'stale-parent', 'stale-peer-revision',
  'suspended', 'timeout', 'unauthorized', 'verify-failed', 'queue-full', CAPACITY_ERROR,
  // Transport/diagnostic codes surfaced to the Web panel so a failed connection
  // explains itself instead of collapsing into "operation failed".
  'ssh-client-not-found', 'invalid-peer-token', 'invalid-remote-port', 'unsafe-remote-path',
  'ssh-transport-only-for-loopback-endpoints', 'ssh-transport-method-not-allowed',
  'bad-response', 'request-failed', 'ssh-detail', 'pick-file-unavailable', 'pick-file-failed',
])
const safeError = (error, fallback) => {
  const code = error?.code ?? error?.message ?? error
  return typeof code === 'string' && (PUBLIC_ERRORS.has(code) || /^http-[1-5]\d{2}$/.test(code)) ? code : fallback
}

function domains(kind) {
  if (kind === 'all' || kind === 'both') return ['plugin', 'config']
  if (kind === 'lingshu') return ['lingshu']
  return Object.hasOwn(DOMAIN, kind) ? [kind] : []
}

function transportFor(client, ssh) {
  return ssh?.kind === 'ssh' ? createSshTransport(ssh) : client
}

function endpointFor(url, ssh) {
  return ssh?.kind === 'ssh' ? `http://127.0.0.1:${ssh.remotePort ?? 3081}${new URL(url).pathname.replace(/\/$/, '')}` : url.replace(/\/$/, '')
}

function checkedUrl(url) {
  if (!/^https?:\/\//.test(url ?? '')) throw new Error('bad-sync-url')
  const parsed = new URL(url)
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('bad-sync-url')
  // Plain HTTP is intentionally allowed on any host for direct LAN links.
  // The invitation token is the boundary control for those links.
  return parsed.href.replace(/\/$/, '')
}

function revisionAfter(current, other) {
  const revision = nextRevision(current.revision, current.identity.deviceId, other)
  return { ...revision, hash: revisionHash(revision) }
}

// Only this function assembles records for the wire. Re-project stored records
// too: changing the local policy must take effect without republishing.
function scopedRecord(record, policy, direction) {
  // Layer-wide memory patterns match on the synthetic bundle name, so the
  // stored record (which has no bundle field) must be projected first.
  const scoped = record?.kind === 'lingshuNode' ? { ...record, bundle: lingshuBundle(record.layer) } : record
  if (validateResourceRecord(record).length || !evaluate(policy, scoped, direction).allowed) return null
  if (record.kind === 'plugin') {
    const { key, enabled, kind, source } = record
    let cleanSource
    if (source.type === 'registry') cleanSource = { type: source.type, package: source.package, version: source.version }
    else if (source.type === 'git') {
      if (source.url.startsWith('https://') && (new URL(source.url).search || new URL(source.url).hash)) return null
      cleanSource = { type: source.type, url: source.url, commit: source.commit }
    } else cleanSource = { type: source.type, name: source.name, sha256: source.sha256 }
    const projected = { key, enabled, kind, source: cleanSource }
    return { ...projected, contentHash: resourceHash(projected) }
  }
  if (record.kind === 'lingshuNode') {
    const { key, layer, content, sensitivity, title } = record
    const projected = { kind: 'lingshuNode', key, layer, content, sensitivity, title }
    return { ...projected, contentHash: resourceHash(projected) }
  }
  return configProjection(record, configFieldsFor(policy, record.entryId))
}

function configProjection(record, allowlist) {
  const declared = Array.isArray(record.fields) ? new Set(record.fields.map((path) => JSON.stringify(path))) : null
  const fields = allowlist.filter((path) => !declared || declared.has(JSON.stringify(path)))
  const config = projectConfig(record.config, fields)
  const present = fields.filter((path) => getPath(config, path) !== undefined)
  if (!present.length) return null
  const projected = { kind: 'pluginConfig', key: record.key, entryId: record.entryId, bundle: record.bundle, fields: present, config, secretKeys: [] }
  return { ...projected, contentHash: resourceHash(projected) }
}

function scopeRecords(records, policy, direction) {
  return [...byKey((records ?? []).map((record) => scopedRecord(record, policy, direction)).filter(Boolean)).values()]
}

function publishedState(current) {
  const response = {
    identity: { ...current.identity }, revision: current.revision,
  }
  for (const { expected } of Object.values(DOMAIN)) {
    response[expected] = scopeRecords(current[expected], current.policy, 'push')
    response[`${expected}Hash`] = hash(response[expected])
  }
  return response
}

function publicResource({ content, ...record }) { return record }

export function createEngine({ store, adapters, transport = createTransport(), audit = createAudit(), now = () => new Date().toISOString(), deviceId = null }) {
  let state = store.read() ?? null
  let tail = Promise.resolve()
  let pauseEpoch = 0
  let reservedStateBytes = 0

  function serialize(task) {
    return (...args) => {
      const epoch = pauseEpoch
      const run = tail.then(() => epoch !== pauseEpoch ? fail('suspended') : task(...args)).catch((error) => {
        if (error.message === CAPACITY_ERROR) return fail(CAPACITY_ERROR)
        throw error
      })
      tail = run.catch(() => {})
      return run
    }
  }

  function commit(next) {
    if (stateBytes(next) + reservedStateBytes > MAX_STATE_BYTES) throw new Error(CAPACITY_ERROR)
    store.write(next)
    state = next
    return next
  }

  function migrate(value) {
    if (!value || value.version !== 1) return value
    let changed = false
    const next = { ...value }
    for (const key of ['expectedMemory', 'memoryBaselines', 'lastMemoryPlan', 'lastMemoryResults', 'lastMemoryStatus']) {
      if (Object.hasOwn(next, key)) { delete next[key]; changed = true }
    }
    if (next.pendingSnapshot && Object.hasOwn(next.pendingSnapshot, 'expectedMemory')) {
      const { expectedMemory, ...rest } = next.pendingSnapshot
      next.pendingSnapshot = rest
      changed = true
    }
    if (next.policy?.caps && Object.hasOwn(next.policy.caps, 'memWrite')) {
      const { memWrite, ...caps } = next.policy.caps
      next.policy = { ...next.policy, caps }
      changed = true
    }
    if (Array.isArray(next.suggestions) && next.suggestions.some((item) => item && (Object.hasOwn(item, 'adapterId') || Object.hasOwn(item, 'relativePath')))) {
      next.suggestions = next.suggestions.filter((item) => !(item && (Object.hasOwn(item, 'adapterId') || Object.hasOwn(item, 'relativePath'))))
      changed = true
    }
    // 0.4.0 adds a third resource domain. Older states must gain its slots so
    // every read path can address them without an undefined branch.
    const defaults = {
      expectedLingshu: [], lingshuBaselines: {}, lastLingshuPlan: null,
      lastLingshuResults: [], lastLingshuStatus: null,
    }
    for (const [key, value] of Object.entries(defaults)) {
      if (!Object.hasOwn(next, key)) { next[key] = value; changed = true }
    }
    if (next.policy && Object.hasOwn(next.policy, 'ai')) {
      const { ai, ...policy } = next.policy
      next.policy = policy
      changed = true
    }
    if (next.policy && !Object.hasOwn(next.policy, 'lingshu')) {
      next.policy = defaultPolicy({ ...next.policy })
      changed = true
    }
    return changed ? next : value
  }

  function ensure() {
    if (state?.version === 1) {
      const migrated = migrate(state)
      return migrated === state ? state : commit(migrated)
    }
    return commit({
      version: 1,
      identity: { deviceId: deviceId ?? randomToken().slice(0, 32), profileId: adapters.profileId ?? 'unknown', label: adapters.label ?? 'Unnamed profile', role: 'unpaired' },
      topology: 'center', policy: defaultPolicy(), center: null, peers: {}, invitations: {},
      expected: [], expectedConfig: [], expectedLingshu: [],
      pluginBaselines: {}, configBaselines: {}, lingshuBaselines: {},
      revision: { number: 0, author: null, clock: {}, hash: null },
      proposals: [], conflicts: [], outbox: [], remoteState: null, applied: {}, approvals: {},
      lastPlan: null, lastConfigPlan: null, lastLingshuPlan: null,
      lastResults: [], lastConfigResults: [], lastLingshuResults: [], lastStatus: null, lastConfigStatus: null, lastLingshuStatus: null,
      suggestions: [], pendingSnapshot: null, suspended: false, audit: [],
    })
  }

  function publicState() {
    const current = ensure()
    const { invitations, outbox, remoteState, applied, archivedRejections, ...visible } = current
    const redactLink = (link) => { const { tokenHash, credentialKey, ...rest } = link; return rest }
    return structuredClone({
      ...visible,
      policy: defaultPolicy(current.policy),
      pendingSnapshot: current.pendingSnapshot ? { ...current.pendingSnapshot } : null,
      proposals: current.proposals.map((proposal) => ({ ...proposal, resources: proposal.resources.map(publicResource) })),
      conflicts: (current.conflicts ?? []).map(({ local, remote, ...conflict }) => ({ ...conflict, local: publicResource(local), remote: publicResource(remote) })),
      peers: Object.fromEntries(Object.entries(current.peers).map(([key, peer]) => [key, redactLink(peer)])),
      center: current.center ? redactLink(current.center) : null,
      invitationCount: Object.values(invitations).filter((invite) => invite.status === 'active' && Date.parse(invite.expiresAt) > Date.now()).length,
    })
  }

  function record(event) {
    audit.append(event)
    try { commit({ ...ensure(), audit: audit.entries() }) }
    catch (error) { if (error.message !== CAPACITY_ERROR) throw error }
  }

  function requireActive(current = ensure()) {
    if (current.suspended) throw new Error('suspended')
    return current
  }

  function allowStateOwner(current) {
    return ['center', 'peer'].includes(current.identity.role)
  }

  function allowDirection(policy, direction) {
    return ['both', direction].includes(defaultPolicy(policy).direction)
  }

  async function collect(kind) {
    if (kind === 'config') return (await adapters.collectConfig?.()) ?? []
    if (kind === 'lingshu') return (await adapters.collectLingshu?.()) ?? []
    return adapters.collectInventory()
  }

  async function collectShared(kinds, direction) {
    const records = {}
    for (const kind of kinds) records[kind] = scopeRecords(await collect(kind), requireActive().policy, direction)
    return records
  }

  async function pairCenter({ initSource = 'empty', label, topology = 'center' } = {}) {
    const initial = requireActive()
    if (initial.identity.role !== 'unpaired') throw new Error('already-paired')
    if (!['empty', 'local'].includes(initSource) || !['center', 'p2p'].includes(topology)) throw new Error('invalid-pair-options')
    const identity = { ...initial.identity, role: topology === 'p2p' ? 'peer' : 'center', label: label ?? initial.identity.label }
    if (validateIdentity(identity).length) throw new Error('invalid-identity')
    const epoch = pauseEpoch
    const collected = initSource === 'local' ? await collectShared(domains('all'), 'push') : {}
    const current = requireActive()
    if (epoch !== pauseEpoch) throw new Error('suspended')
    const next = { ...current, identity, topology, policy: defaultPolicy({ ...current.policy, topology }) }
    for (const [kind, { expected }] of Object.entries(DOMAIN)) {
      const records = scopeRecords(collected[kind], current.policy, 'push')
      if (records.length > MAX_RESOURCES) return fail(CAPACITY_ERROR)
      next[expected] = records
    }
    commit({ ...next, revision: revisionAfter(next) })
    record({ kind: 'pair', role: identity.role, initSource, actor: 'user' })
    return publicState()
  }

  async function join({ url, token, label, ssh } = {}, topology) {
    const current = requireActive()
    if (current.identity.role !== 'unpaired') throw new Error('already-paired')
    const epoch = pauseEpoch
    url = checkedUrl(url)
    if (typeof token !== 'string' || !token) throw new Error('invitation-token-required')
    const identity = { ...current.identity, role: topology === 'p2p' ? 'peer' : 'device', label: label ?? current.identity.label }
    if (validateIdentity(identity).length) throw new Error('invalid-identity')
    let response
    try {
      response = await transportFor(transport, ssh).send(`${endpointFor(url, ssh)}/plugin-sync/hello`, { method: 'POST', token, body: { identity } })
    } catch (error) {
      throw new Error(safeError(error, 'pair-failed'))
    }
    if (response?.error || response?.ok === false) throw new Error(safeError(response.error ?? response.reason, 'pair-failed'))
    if (validateIdentity(response?.center).length || response.center.deviceId === identity.deviceId ||
        response.center.role !== (topology === 'p2p' ? 'peer' : 'center') || response.topology !== topology) throw new Error('bad-remote-identity')
    requireActive()
    if (epoch !== pauseEpoch) throw new Error('suspended')
    const credentialKey = topology === 'p2p' ? 'plugin-sync/peer' : 'plugin-sync/center'
    await adapters.putSecret(credentialKey, token)
    const next = requireActive()
    if (epoch !== pauseEpoch) throw new Error('suspended')
    const link = { ...response.center, url, tokenHash: hash(token), credentialKey, transport: ssh ?? null, lastSeen: now(), status: 'connected' }
    const paired = { ...next, identity, topology, policy: defaultPolicy({ ...next.policy, topology }), center: link }
    if (topology === 'p2p') {
      paired.peers = { [link.deviceId]: { ...response.center, tokenHash: link.tokenHash, lastSeen: link.lastSeen, status: link.status } }
      paired.revision = revisionAfter(paired)
    } else {
      const errors = validateStatePayload({ ...publishedState(paired), revision: response.revision })
      if (errors.length) throw new Error('invalid-remote-revision')
      paired.revision = response.revision
    }
    commit(paired)
    record({ kind: 'pair', role: identity.role, center: link.deviceId, actor: 'user' })
    return publicState()
  }

  // Read-only pre-connection check. The token proves the invitation is valid
  // before the user commits to a topology or stores any credential.
  async function verifyInvitation({ url, token, ssh } = {}) {
    const current = requireActive()
    if (current.identity.role !== 'unpaired') throw new Error('already-paired')
    if (typeof token !== 'string' || !token) throw new Error('invitation-token-required')
    const epoch = pauseEpoch
    url = checkedUrl(url)
    const identity = current.identity
    let response
    try {
      response = await transportFor(transport, ssh).send(`${endpointFor(url, ssh)}/plugin-sync/hello`, {
        method: 'POST', token, body: { verify: true, identity },
      })
    } catch (error) {
      throw new Error(safeError(error, 'verify-failed'))
    }
    if (response?.error || response?.ok === false) throw new Error(safeError(response.error ?? response.reason, 'verify-failed'))
    if (response?.verified !== true) throw new Error('verify-failed')
    requireActive()
    if (epoch !== pauseEpoch) throw new Error('suspended')
    // Bind exactly as join() does. Verification has no requested topology, so
    // use the role advertised by the remote to derive the expected topology.
    const remoteRole = response?.center?.role
    const expectedTopology = remoteRole === 'peer' ? 'p2p' : remoteRole === 'center' ? 'center' : null
    if (validateIdentity(response?.center).length || response.center.deviceId === identity.deviceId ||
        !expectedTopology || response.topology !== expectedTopology) throw new Error('bad-remote-identity')
    return { ok: true, verified: true, center: response.center, topology: response.topology }
  }

  function createInvitation() {
    const current = requireActive()
    if (!allowStateOwner(current)) throw new Error('requires-center-or-peer-role')
    if (current.identity.role === 'peer' && (current.center || Object.values(current.peers).some((peer) => peer.status === 'connected'))) throw new Error('peer-already-connected')
    const token = randomToken()
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString()
    commit({ ...current, invitations: { ...current.invitations, [hash(token)]: { expiresAt, status: 'active' } } })
    record({ kind: 'invitation-created', expiresAt, actor: 'user' })
    return { token, expiresAt }
  }

  function handleHello({ token, identity, verify } = {}) {
    const current = ensure()
    if (current.suspended) return { error: 'suspended' }
    if (!allowStateOwner(current)) return { error: 'requires-center-or-peer-role' }
    if (validateIdentity(identity).length || identity.deviceId === current.identity.deviceId) return { error: 'invalid-identity' }
    const expectedRole = current.identity.role === 'peer' ? 'peer' : 'device'
    // A verification probe comes from an unpaired profile, before it has
    // chosen the role it will pair as. Only the read-only verify path accepts
    // that role; the real pairing path keeps the original strict check.
    if (identity.role !== expectedRole && !(verify === true && identity.role === 'unpaired')) return { error: 'role-mismatch' }
    if (current.identity.role === 'peer' && (current.center || Object.values(current.peers).some((peer) => peer.status === 'connected'))) return { error: 'peer-already-connected' }
    const key = typeof token === 'string' ? hash(token) : ''
    const invitation = getOwn(current.invitations, key)
    if (!invitation || invitation.status !== 'active') return { error: 'invalid-invitation' }
    if (Date.parse(invitation.expiresAt) < Date.now()) return { error: 'invitation-expired' }
    if (getOwn(current.peers, identity.deviceId)?.status === 'connected') return { error: 'device-already-paired' }
    // Verification validates every pairing precondition but is read-only: the
    // invitation stays active and no peer is added to the profile.
    if (verify === true) return { ok: true, verified: true, center: current.identity, topology: current.topology, revision: current.revision }
    const peer = { deviceId: identity.deviceId, profileId: identity.profileId, label: identity.label, role: identity.role, tokenHash: key, lastSeen: now(), status: 'connected' }
    commit({ ...current, peers: { ...current.peers, [peer.deviceId]: peer }, invitations: { ...current.invitations, [key]: { ...invitation, status: 'used', peerId: peer.deviceId } } })
    record({ kind: 'peer-paired', deviceId: peer.deviceId, profileId: peer.profileId })
    return { center: current.identity, topology: current.topology, revision: current.revision }
  }

  function peerFromRequest(token, deviceId) {
    const current = ensure()
    const peer = getOwn(current.peers, deviceId)
    return allowStateOwner(current) && peer?.status === 'connected' && typeof token === 'string' && safeEqual(peer.tokenHash, hash(token)) ? peer : null
  }

  function handleGetState({ token, deviceId, offer, acknowledgedOffers = [] }) {
    const current = ensure()
    if (current.suspended) return { error: 'suspended' }
    const peer = peerFromRequest(token, deviceId)
    if (!peer) return { error: 'unauthorized' }
    if (offer != null) {
      if (current.identity.role !== 'peer' || !sameIdentity(offer.identity, peer) || offer.identity.role !== 'peer' || validateStatePayload(offer).length) return { error: 'invalid-peer-state' }
      const last = current.remoteState
      if (last && compareClocks(offer.revision.clock, last.revision.clock) === -1) return { error: 'stale-peer-revision' }
    }
    if (!Array.isArray(acknowledgedOffers) || acknowledgedOffers.length > 32 || acknowledgedOffers.some((value) => !/^cs_[a-f0-9]{24}$/.test(value))) return { error: 'invalid-offer-acknowledgment' }
    const updated = { ...current, peers: { ...current.peers, [deviceId]: { ...peer, lastSeen: now() } } }
    if (offer && allowDirection(current.policy, 'pull')) updated.remoteState = inboundState(offer, current.policy)
    const response = publishedState(updated)
    if (validateStatePayload(response).length) return { error: 'invalid-published-state' }
    if (current.identity.role === 'peer') {
      response.offers = []
      updated.outbox = (current.outbox ?? []).filter(({ peerId, changeset }) => {
        if (peerId !== peer.deviceId) return true
        const resources = Object.values(DOMAIN).flatMap(({ record }) => scopeRecords(changeset.resources.filter((item) => item.kind === record), current.policy, 'push'))
        if (!resources.length) return true
        const projected = { ...changeset, id: id('cs', { original: changeset.id, resources }), resources }
        if (acknowledgedOffers.includes(projected.id)) return false
        const signed = { ...projected, mac: signChangeset(projected, token) }
        if (withinPayloadLimit({ ...response, offers: [...response.offers, signed] })) response.offers.push(signed)
        return true
      })
    }
    commit(updated)
    return response
  }

  function inboundState(response, policy) {
    const result = { identity: response.identity, revision: response.revision }
    for (const { expected } of Object.values(DOMAIN)) result[expected] = scopeRecords(response[expected], policy, 'pull')
    return result
  }

  function scopedChangeset(changeset, policy) {
    return Object.values(DOMAIN).flatMap(({ record }) => scopeRecords(changeset.resources.filter((item) => item.kind === record), policy, 'pull'))
  }

  function receiveProposal({ peer, identity, token, changeset }) {
    const current = ensure()
    if (!sameIdentity(identity, peer)) return { error: 'profile-mismatch' }
    if (!allowDirection(current.policy, 'pull')) return { error: 'direction-blocked:pull' }
    const errors = validateChangeset(changeset)
    if (errors.length || !withinPayloadLimit(changeset)) return { error: 'invalid-changeset', detail: errors }
    if (changeset.origin.deviceId !== identity.deviceId) return { error: 'origin-mismatch' }
    if (changeset.origin.profileId !== peer.profileId) return { error: 'profile-mismatch' }
    if (!verifyChangesetMac(changeset, token)) return { error: 'invalid-mac' }
    if (current.proposals.some((proposal) => proposal.id === changeset.id)) return { status: 'duplicate', proposalId: changeset.id }
    const parentMatches = changeset.parents.includes(current.revision.hash)
    if (current.identity.role === 'center') {
      if (!parentMatches) return { error: 'stale-parent' }
      const archived = current.archivedRejections
      if (archived?.parent === current.revision.hash && archived.ids.includes(changeset.id)) return { status: 'duplicate', proposalId: changeset.id }
    }
    if (current.proposals.length >= MAX_PROPOSALS || current.proposals.filter(({ status }) => status === 'pending').length >= MAX_PENDING_PROPOSALS) {
      return { error: 'queue-full' }
    }
    const resources = scopedChangeset(changeset, current.policy)
    if (!resources.length) return { error: 'no-shareable-resources' }
    const proposal = {
      id: changeset.id, origin: changeset.origin, resources, parent: changeset.parents, receivedAt: now(),
      status: 'pending', baseRevision: current.revision.hash, peerRevision: current.remoteState?.revision ?? null,
    }
    const conflicts = current.identity.role === 'peer' && !parentMatches ? resources.flatMap((remote) => {
      const domain = Object.values(DOMAIN).find(({ record }) => record === remote.kind)
      const local = current[domain.expected]?.find((item) => item.key === remote.key)
      if (!local || local.contentHash === remote.contentHash) return []
      return [{ id: id('conflict', { proposal: proposal.id, kind: remote.kind, key: remote.key }), proposalId: proposal.id, key: remote.key, local, remote, status: 'open', detectedAt: now() }]
    }) : []
    proposal.conflict = conflicts.length > 0
    commit({ ...current, proposals: [...current.proposals, proposal], conflicts: [...(current.conflicts ?? []), ...conflicts] })
    record({ kind: 'proposal-received', proposalId: proposal.id, deviceId: peer.deviceId })
    return { status: proposal.conflict ? 'conflict' : 'pending', proposalId: proposal.id }
  }

  function handleSubmitProposal({ token, identity, changeset }) {
    if (ensure().suspended) return { error: 'suspended' }
    const peer = peerFromRequest(token, identity?.deviceId)
    return peer ? receiveProposal({ peer, identity, token, changeset }) : { error: 'unauthorized' }
  }

  function handleListProposals() {
    const current = ensure()
    if (!allowStateOwner(current)) return { error: 'requires-center-or-peer-role' }
    return { proposals: publicState().proposals.map((proposal) => ({ ...proposal, resourceCount: proposal.resources.length, keys: proposal.resources.map(({ key }) => key) })) }
  }

  function handleAcceptProposal({ proposalId, actor, installLocally = false }) {
    const current = ensure()
    if (current.suspended) return { error: 'suspended' }
    if (!allowStateOwner(current) || actor !== 'user') return { error: 'user-required' }
    const proposal = current.proposals.find((item) => item.id === proposalId)
    if (!proposal) return { error: 'proposal-not-found' }
    if (proposal.status !== 'pending') return { error: 'proposal-not-pending', status: proposal.status }
    if (getOwn(current.peers, proposal.origin.deviceId)?.status !== 'connected') return { error: 'peer-revoked' }
    if (proposal.baseRevision !== current.revision.hash) return { error: 'stale-parent' }
    if (proposal.peerRevision && current.remoteState?.identity.deviceId === proposal.origin.deviceId &&
        current.remoteState.revision.hash !== proposal.peerRevision.hash) return { error: 'stale-peer-revision' }
    if (!allowDirection(current.policy, 'pull')) return { error: 'direction-blocked:pull' }
    const conflicts = (current.conflicts ?? []).filter((item) => item.proposalId === proposalId)
    if (conflicts.some((item) => item.status === 'open')) return { error: 'unresolved-conflict', keys: conflicts.filter((item) => item.status === 'open').map(({ key }) => key) }
    const next = { ...current }
    for (const { record: kind, expected } of Object.values(DOMAIN)) {
      const map = byKey(current[expected] ?? [])
      for (const resource of proposal.resources.filter((item) => item.kind === kind)) {
        const projected = scopedRecord(resource, current.policy, 'pull')
        if (!projected || projected.contentHash !== resource.contentHash || hash(projected.fields ?? []) !== hash(resource.fields ?? [])) return { error: 'proposal-policy-changed' }
        const decision = conflicts.find((item) => item.key === resource.key && item.remote.kind === kind)
        if (decision?.choice !== 'local') map.set(resource.key, projected)
      }
      if (map.size > MAX_RESOURCES) return { error: CAPACITY_ERROR }
      next[expected] = [...map.values()]
    }
    const revision = revisionAfter(current, proposal.peerRevision)
    // Centre accepts the plugin into authoritative expectations. Whether the
    // centre itself installs it is a separate, local decision recorded on the
    // proposal: publishing to peers and installing here are independent.
    const localInstall = proposal.resources.some((item) => item.kind === 'plugin') ? Boolean(installLocally) : null
    commit({ ...next, revision, proposals: current.proposals.map((item) => item.id === proposalId ? {
      ...item, status: 'accepted', actor, decidedAt: now(), localInstall,
    } : item) })
    record({ kind: 'proposal-accepted', proposalId, actor, revision: revision.number, localInstall })
    return { status: 'accepted', revision: revision.number, localInstall }
  }

  // Centre-only convenience: accept a device's plugin proposal into the
  // authoritative state AND install it on this centre too. The install still
  // goes through the normal check -> approve -> apply chain, so the local
  // caps.install gate, policy scope and approval binding all apply. Other
  // peers are unaffected: they receive the published expectation either way.
  async function acceptAndInstall({ proposalId, actor }) {
    const before = ensure()
    const proposal = before.proposals.find((item) => item.id === proposalId)
    const keys = new Set((proposal?.resources ?? []).filter((item) => item.kind === 'plugin').map((item) => item.key))
    const accepted = handleAcceptProposal({ proposalId, actor, installLocally: true })
    if (accepted.error || accepted.status !== 'accepted') return { ...accepted, install: 'not-accepted' }
    const checked = await check({ kind: 'plugin' })
    if (checked.status !== 'ok') return { ...accepted, install: 'check-failed', detail: checked.status }
    const plan = checked.plan
    const installs = plan.operations.filter((op) => op.action === 'install' && keys.has(op.key))
    if (!installs.length) return { ...accepted, install: 'no-install', planId: plan.planId,
      detail: 'cap-or-policy-or-already-installed' }
    // Approve every operation for the accepted plugin keys: install lands
    // disabled, and the matching enable belongs to the same user decision.
    const opIds = plan.operations.filter((op) => keys.has(op.key)).map((op) => op.opId)
    const approved = approvePlan({ planId: plan.planId, opIds, actor })
    if (!approved.ok) return { ...accepted, install: 'approval-failed', reason: approved.reason, planId: plan.planId }
    const result = await apply({ planId: plan.planId })
    const installed = result.results?.some((item) => item.action === 'install' && SUCCESS.has(item.status))
    record({ kind: 'local-install-from-proposal', proposalId, actor, status: result.status })
    return { ...accepted, install: installed ? 'ok' : result.status, planId: plan.planId, results: result.results }
  }

  function resolveConflict({ conflictId, choice, actor }) {
    const current = ensure()
    if (current.suspended) return fail('suspended')
    if (actor !== 'user') return fail('user-required')
    const conflict = (current.conflicts ?? []).find((item) => item.id === conflictId && item.status === 'open')
    if (!conflict) return fail('conflict-not-found')
    const proposal = current.proposals.find((item) => item.id === conflict.proposalId)
    if (proposal?.status !== 'pending' || proposal.baseRevision !== current.revision.hash) return fail('stale-parent')
    if (!['remote', 'local'].includes(choice)) return fail('bad-choice')
    commit({ ...current, conflicts: current.conflicts.map((item) => item.id === conflictId ? { ...item, status: 'resolved', choice, actor, resolvedAt: now() } : item) })
    record({ kind: 'conflict-resolved', conflictId, choice, actor })
    return { ok: true }
  }

  function rejectProposal({ proposalId, actor }) {
    const current = ensure()
    if (current.suspended) return fail('suspended')
    if (!allowStateOwner(current) || actor !== 'user') return fail('user-required')
    if (!current.proposals.some((item) => item.id === proposalId && item.status === 'pending')) return fail('proposal-not-pending')
    commit({ ...current, proposals: current.proposals.map((item) => item.id === proposalId ? { ...item, status: 'rejected', actor, decidedAt: now() } : item) })
    record({ kind: 'proposal-rejected', proposalId, actor })
    return { status: 'rejected' }
  }

  async function archiveDecisions({ actor } = {}) {
    const current = ensure()
    if (actor !== 'user') return fail('user-required')
    if (current.suspended) return fail('suspended')
    if (!allowStateOwner(current)) return fail('requires-center-or-peer-role')
    if (typeof adapters.archiveDecisions !== 'function') return fail('archive-unavailable')

    const proposals = current.proposals.filter(({ status }) => status === 'accepted' || status === 'rejected')
    if (!proposals.length) return fail('no-decisions-to-archive')
    const proposalIds = new Set(proposals.map(({ id }) => id))
    // Rejection can close a whole proposal without a decision on each conflict.
    const conflicts = (current.conflicts ?? []).filter(({ proposalId }) => proposalIds.has(proposalId))
    const epoch = pauseEpoch
    let archiveId
    try {
      const result = await adapters.archiveDecisions(structuredClone({ proposals, conflicts }))
      if (result?.ok === false || result?.error || typeof result?.archiveId !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(result.archiveId)) return fail('archive-failed')
      archiveId = result.archiveId
    } catch {
      return fail('archive-failed')
    }

    const latest = ensure()
    if (latest.suspended || epoch !== pauseEpoch) return fail('suspended')
    const next = {
      ...latest,
      proposals: latest.proposals.filter(({ id }) => !proposalIds.has(id)),
      conflicts: (latest.conflicts ?? []).filter(({ proposalId }) => !proposalIds.has(proposalId)),
    }
    if (latest.identity.role === 'center') {
      const parent = latest.revision.hash
      const previous = latest.archivedRejections?.parent === parent ? latest.archivedRejections.ids : []
      const rejected = proposals.filter((proposal) => proposal.status === 'rejected' && proposal.parent.includes(parent)).map(({ id }) => id)
      next.archivedRejections = { parent, ids: [...new Set([...previous, ...rejected])].slice(-MAX_PROPOSALS) }
    }
    try {
      commit(next)
    } catch {
      return fail('archive-state-write-failed')
    }
    record({ kind: 'decisions-archived', count: proposals.length, archiveId, actor })
    return { status: 'archived', count: proposals.length, archiveId }
  }

  function revokePeer({ deviceId }) {
    const current = ensure()
    const peer = getOwn(current.peers, deviceId) ?? (current.center?.deviceId === deviceId ? current.center : null)
    if (!peer || peer.status === 'revoked') return fail('peer-not-connected')
    const revoked = { ...peer, status: 'revoked', tokenHash: null }
    if (revoked.credentialKey) delete revoked.credentialKey
    commit({ ...current, peers: { ...current.peers, [deviceId]: revoked },
      center: current.center?.deviceId === deviceId ? null : current.center,
      remoteState: current.remoteState?.identity.deviceId === deviceId ? null : current.remoteState,
      approvals: {}, outbox: (current.outbox ?? []).filter((item) => item.peerId !== deviceId),
      proposals: current.proposals.map((item) => item.origin.deviceId === deviceId && item.status === 'pending' ? { ...item, status: 'rejected' } : item),
    })
    record({ kind: 'peer-revoked', deviceId, actor: 'user' })
    return { status: 'revoked' }
  }

  async function publishLocal({ kind = 'all' } = {}) {
    const current = requireActive()
    if (!allowStateOwner(current)) return fail('requires-center-or-peer-role')
    if (!allowDirection(current.policy, 'push')) return fail('direction-blocked:push')
    const kinds = domains(kind)
    if (!kinds.length) return fail('bad-kind')
    const epoch = pauseEpoch
    const collected = await collectShared(kinds, 'push')
    const next = requireActive()
    if (epoch !== pauseEpoch) return fail('suspended')
    if (!allowDirection(next.policy, 'push')) return fail('direction-blocked:push')
    const updated = { ...next }
    for (const name of kinds) {
      const records = scopeRecords(collected[name], next.policy, 'push')
      if (records.length > MAX_RESOURCES) return fail(CAPACITY_ERROR)
      updated[DOMAIN[name].expected] = records
    }
    const revision = revisionAfter(next)
    commit({ ...updated, revision })
    record({ kind: 'local-published', revision: revision.number, actor: 'user' })
    return { status: 'published', revision: revision.number }
  }

  function updateLink(link, status) {
    const current = ensure()
    if (current.center?.credentialKey !== link.credentialKey || current.center?.deviceId !== link.deviceId) return
    const details = status === 'connected' ? { status, lastSeen: now() } : { status }
    const peer = getOwn(current.peers, link.deviceId)
    commit({ ...current, center: { ...current.center, ...details },
      peers: peer ? { ...current.peers, [link.deviceId]: { ...peer, ...details } } : current.peers })
  }

  async function fetchRemote({ exchange = true } = {}) {
    const initial = requireActive()
    const link = initial.center
    const epoch = pauseEpoch
    const secret = await adapters.getSecret(link.credentialKey)
    if (!secret || ensure().center?.deviceId !== link.deviceId) throw new Error('connection-revoked')
    const current = requireActive()
    if (epoch !== pauseEpoch) throw new Error('suspended')
    const p2p = current.identity.role === 'peer'
    const offer = p2p && exchange && allowDirection(current.policy, 'push') ? publishedState(current) : undefined
    if (offer && validateStatePayload(offer).length) throw new Error('invalid-published-state')
    const acknowledgedOffers = p2p && exchange ? current.proposals
      .filter((proposal) => proposal.origin.deviceId === link.deviceId && /^cs_[a-f0-9]{24}$/.test(proposal.id))
      .slice(-32).map((proposal) => proposal.id) : []
    const response = await transportFor(transport, link.transport).send(`${endpointFor(link.url, link.transport)}/plugin-sync/state`, {
      method: 'POST', token: secret, body: { deviceId: current.identity.deviceId, ...(offer ? { offer } : {}), ...(acknowledgedOffers.length ? { acknowledgedOffers } : {}) },
    })
    if (response?.error || response?.ok === false) throw new Error(safeError(response.error ?? response.reason, 'remote-state-failed'))
    if (!sameIdentity(response?.identity, link) || response.identity.role !== link.role || validateStatePayload(response).length) throw new Error('invalid-remote-state')
    if (!ensure().center || ensure().center.deviceId !== link.deviceId) throw new Error('connection-revoked')
    const active = requireActive()
    if (epoch !== pauseEpoch) throw new Error('suspended')
    const remote = inboundState(response, active.policy)
    if (p2p) {
      if (active.remoteState && compareClocks(remote.revision.clock, active.remoteState.revision.clock) === -1) throw new Error('stale-peer-revision')
      if (exchange && allowDirection(active.policy, 'pull')) {
        commit({ ...active, remoteState: remote })
        for (const changeset of Array.isArray(response.offers) ? response.offers : []) receiveProposal({ peer: link, identity: response.identity, token: secret, changeset })
      }
    } else if (remote.revision.number < active.revision.number) throw new Error('stale-center-revision')
    updateLink(link, 'connected')
    return selectPeerTarget(ensure(), remote)
  }

    function selectPeerTarget(current, remote) {
    if (current.identity.role !== 'peer') return remote
    const relation = compareClocks(current.revision.clock, remote.revision?.clock)
    const preferred = relation === 1 ? current : remote
    const target = {
      identity: preferred.identity,
      revision: preferred.revision,
    }
    for (const { expected } of Object.values(DOMAIN)) {
      const records = new Map((remote[expected] ?? []).map((record) => [record.key, record]))
      for (const record of current[expected] ?? []) {
        if (relation === 1 || !records.has(record.key)) records.set(record.key, record)
      }
      target[expected] = [...records.values()]
    }
    return target
  }

  function localSource(current, sourceMode) {
    if (sourceMode === 'snapshot') return current.pendingSnapshot
    if (current.identity.role === 'peer') return current.remoteState ? selectPeerTarget(current, current.remoteState) : null
    return current
  }

  function sourceName(current, sourceMode, revision) {
    return `${sourceMode === 'snapshot' ? 'snapshot:' : current.identity.role === 'peer' ? 'peer:rev' : 'center:rev'}${revision?.number ?? 0}`
  }

  function inputRecords(kind, targetState, localRaw, policy) {
    const raw = targetState[DOMAIN[kind].expected] ?? []
    if (kind !== 'config') return {
      expected: raw.filter((item) => !validateResourceRecord(item).length),
      local: localRaw.filter((item) => item.kind === DOMAIN[kind].record && !validateResourceRecord(item).length),
    }
    const expected = scopeRecords(raw, policy, 'pull')
    const targets = byKey(expected)
    const local = localRaw.filter((item) => item.kind === 'pluginConfig' && !validateResourceRecord(item).length)
      .map((item) => targets.has(item.key) ? configProjection(item, targets.get(item.key).fields) : null).filter(Boolean)
    return { expected, local }
  }

  function sourceFingerprint(current, sourceMode, source) {
    return sourceMode === 'snapshot' ? hash(source) : source.revision?.hash ?? null
  }

  function planPatch(current, plan, domain) {
    const approvals = { ...current.approvals }
    const prior = current[domain.plan]
    if (prior && prior.planId !== plan.planId) delete approvals[prior.planId]
    return { [domain.plan]: plan, [domain.results]: [], [domain.status]: null, approvals }
  }

  function makePlan(kind, current, sourceMode, target, records, resolutions = []) {
    const domain = DOMAIN[kind]
    const snapshot = sourceMode === 'snapshot'
    const baselines = { ...(snapshot ? {} : current[domain.baselines]) }
    const local = byKey(records.local)
    if (!snapshot) for (const item of records.expected) {
      if (evaluate(current.policy, item, 'pull').allowed && local.get(item.key)?.contentHash === item.contentHash) {
        Object.defineProperty(baselines, item.key, { value: item.contentHash, enumerable: true, writable: true, configurable: true })
      }
    }
    const divergent = !snapshot && current.identity.role === 'peer' && compareClocks(current.revision.clock, target.revision?.clock) === null
    const plan = domain.build({ ...records, baselines, policy: current.policy, source: sourceName(current, sourceMode, target.revision),
      revision: target.revision?.number, sourceHash: sourceFingerprint(current, sourceMode, target), now: now(), resolutions, divergent })
    return { plan, baselines }
  }

  async function check({ kind = 'plugin', source: sourceMode = 'live' } = {}) {
    const current = ensure()
    if (current.suspended) return { status: 'suspended' }
    const kinds = domains(kind)
    if (!kinds.length || !['live', 'snapshot'].includes(sourceMode)) return { status: 'invalid-check' }
    const epoch = pauseEpoch
    const fromWire = sourceMode === 'live' && current.center
    let target
    if (fromWire) {
      try { target = await fetchRemote() }
      catch (error) {
        if (ensure().suspended || epoch !== pauseEpoch) return { status: 'suspended' }
        updateLink(current.center, 'offline')
        const status = error instanceof TransportError ? safeError(error, 'offline') : 'offline'
        const detail = safeError(error, 'sync-error')
        record({ kind: 'check-failed', code: status, detail })
        return { status, detail }
      }
    } else target = localSource(current, sourceMode)
    if (!target) return { status: sourceMode === 'snapshot' ? 'no-snapshot' : 'peer-state-unavailable' }
    if (current.identity.role === 'unpaired' && sourceMode === 'live') return { status: 'unpaired' }
    const collected = {}
    for (const name of kinds) collected[name] = await collect(name)
    const latest = ensure()
    if (latest.suspended || epoch !== pauseEpoch) return { status: 'suspended' }
    if (fromWire && latest.center?.deviceId !== current.center.deviceId) return { status: 'offline', detail: 'connection-revoked' }
    if (!fromWire) target = localSource(latest, sourceMode)
    if (!target) return { status: 'source-changed' }
    // A center member's cached state is for display and proposal parent binding.
    // A P2P node retains its own published state and revision separately.
    let next = latest
    if (fromWire && latest.identity.role === 'device') next = { ...latest, ...Object.fromEntries(Object.values(DOMAIN).map(({ expected }) => [expected, target[expected]])), revision: target.revision }
    const output = { status: 'ok', plan: null, configPlan: null }
    for (const name of kinds) {
      const domain = DOMAIN[name]
      const records = inputRecords(name, target, collected[name], next.policy)
      const { plan, baselines } = makePlan(name, next, sourceMode, target, records)
      next = { ...next, ...planPatch(next, plan, domain), ...(sourceMode === 'live' ? { [domain.baselines]: baselines } : {}) }
      output[domain.output] = plan
    }
    commit(next)
    for (const plan of Object.values(output).filter((item) => item?.planId)) record({ kind: 'plan-created', planId: plan.planId, domain: plan.kind, operations: plan.operations.length, conflicts: plan.conflicts.length })
    return structuredClone(output)
  }

  function findPlan(current, planId) {
    const result = Object.entries(DOMAIN).find(([, domain]) => current[domain.plan]?.planId === planId)
    return result ? { kind: result[0], domain: result[1], plan: current[result[1].plan] } : null
  }

  function approvePlan({ planId, opIds, actor }, auto = false) {
    const current = ensure()
    if (current.suspended) return fail('suspended')
    if (!auto && actor !== 'user') return fail('user-required')
    const found = findPlan(current, planId)
    if (!found) return fail('plan-not-found')
    const { plan } = found
    if (plan.policyHash !== policyHash(current.policy)) return fail('policy-changed')
    if (auto && (!canAuto(current, plan) || !Array.isArray(opIds) || opIds.some((id) => !autoOperations(plan).some((op) => op.opId === id)))) return fail('auto-forbidden')
    const created = createApproval(plan, { actor: auto ? 'auto:managed' : actor, opIds, at: now() })
    if (!created.ok) return created
    commit({ ...current, approvals: { ...current.approvals, [planId]: created.approval } })
    record({ kind: 'plan-approved', planId, actor: created.approval.actor, opIds: created.approval.opIds })
    return structuredClone(created)
  }

  async function targetFor(current, sourceMode, exchange = false) {
    return sourceMode === 'live' && current.center ? fetchRemote({ exchange }) : localSource(current, sourceMode)
  }

  function resolveSource(plan) {
    return plan.source.startsWith('snapshot:') ? 'snapshot' : 'live'
  }

  function matchesSource(current, sourceMode, target, plan, expected) {
    return Boolean(target && sourceFingerprint(current, sourceMode, target) === plan.sourceHash &&
      target.revision?.number === plan.sourceRevision && inventoryHash(expected) === plan.targetBaseline)
  }

  async function resolvePlanConflict({ planId, key, choice }) {
    const current = ensure()
    if (current.suspended) return fail('suspended')
    if (!['local', 'remote'].includes(choice)) return fail('bad-choice')
    const found = findPlan(current, planId)
    if (!found) return fail('plan-not-found')
    const { plan, kind, domain } = found
    if (!plan.conflicts.some((item) => item.key === key && item.kind.startsWith('concurrent-'))) return fail('conflict-not-found')
    const epoch = pauseEpoch
    const sourceMode = resolveSource(plan)
    let target
    try { target = await targetFor(current, sourceMode) }
    catch (error) { return fail(safeError(error, 'source-unavailable')) }
    const local = await collect(kind)
    const latest = ensure()
    if (latest.suspended || epoch !== pauseEpoch) return fail('suspended')
    if (plan.policyHash !== policyHash(latest.policy)) return fail('policy-changed')
    if (!current.center || sourceMode === 'snapshot') target = localSource(latest, sourceMode)
    if (!target || !findPlan(latest, planId) || (current.center && latest.center?.deviceId !== current.center.deviceId)) return fail('stale-plan')
    const records = inputRecords(kind, target, local, latest.policy)
    if (!matchesSource(latest, sourceMode, target, plan, records.expected) || inventoryHash(records.local) !== plan.localBaseline) return fail('stale-plan')
    const resolutions = [...(plan.resolutions ?? []).filter((entry) => entry.key !== key), { key, choice }]
    const rebuilt = makePlan(kind, latest, sourceMode, target, records, resolutions).plan
    const patch = planPatch(latest, rebuilt, domain)
    delete patch.approvals[planId]
    commit({ ...latest, ...patch })
    record({ kind: 'plan-conflict-resolved', planId, replacement: rebuilt.planId, key, choice, actor: 'user' })
    return { ok: true, plan: structuredClone(rebuilt) }
  }

  function finish(domain, status, extra = {}) {
    const result = { status, results: [], ...extra }
    if (domain) commit({ ...ensure(), [domain.results]: result.results, [domain.status]: { status, reason: extra.reason ?? null, unapproved: extra.unapproved ?? 0 } })
    return result
  }

  function planGuard(current, initial, plan, target, records, epoch, approval) {
    if (current.suspended || epoch !== pauseEpoch) return 'suspended'
    if (current.center?.deviceId !== initial.center?.deviceId) return 'connection-revoked'
    if (policyHash(current.policy) !== plan.policyHash) return 'policy-changed'
    if (!findPlan(current, plan.planId) || current.approvals[plan.planId] !== approval) return 'approval-changed'
    const sourceMode = resolveSource(plan)
    const liveTarget = initial.center && sourceMode === 'live' ? target : localSource(current, sourceMode)
    if (!matchesSource(current, sourceMode, liveTarget, plan, records.expected)) return 'center-revision-changed'
    return null
  }

  function withoutCompleted(records, completedKeys) {
    return records.filter((record) => !completedKeys.has(record.key))
  }

  function permittedOperation(policy, op, target) {
    if (!target || op.action !== op.requiresCap) return false
    const resource = target.kind === 'lingshuNode' ? { ...target, bundle: lingshuBundle(target.layer), requiresCap: op.requiresCap } : { ...target, requiresCap: op.requiresCap }
    const capability = evaluate(policy, resource, 'pull')
    return capability.allowed && target.contentHash === op.toHash
  }

  function canAuto(current, plan = null) {
    return !current.suspended && current.policy.mode === 'managed' && current.policy.autoApply &&
      (!plan || (resolveSource(plan) === 'live' && !plan.requiresExtraApproval))
  }

  function autoOperations(plan) {
    return plan.operations.filter((op) => AUTO_ACTIONS.has(op.action) && op.risk === 'normal' && !op.after)
  }

  async function executeOperation(op) {
    if (op.action === 'configSet') return adapters.writeConfig(op.payload)
    if (op.action === 'memoryWrite') return adapters.writeLingshu(op.payload)
    if (op.action === 'install') return adapters.install(op.payload)
    if (op.action === 'upgrade') return adapters.upgrade(op.payload)
    if (op.action === 'enable' || op.action === 'disable') return adapters.setEnabled(op.key, op.action === 'enable')
    throw new Error(`unsupported-action:${op.action}`)
  }

  function predictedHash(op, target, actual) {
    if (op.action === 'install') return resourceHash({ ...target, enabled: false })
    if (op.action === 'disable' && actual) return resourceHash({ ...actual, enabled: false })
    if (op.action === 'upgrade') return resourceHash({ ...target, enabled: actual?.enabled ?? false })
    return op.toHash
  }

  async function apply({ planId }) {
    const initial = ensure()
    const found = findPlan(initial, planId)
    if (initial.suspended) return finish(found?.domain, 'suspended')
    if (!found) return finish(null, 'plan-not-found')
    const { plan, domain, kind } = found
    const approval = initial.approvals[planId]
    const authorization = verifyApproval(plan, approval, policyHash(initial.policy))
    if (!authorization.ok) return finish(domain, 'unauthorized', { reason: authorization.reason })
    const auto = approval.actor === 'auto:managed'
    if (auto && !canAuto(initial, plan)) return finish(domain, 'unauthorized', { reason: 'auto-forbidden' })
    const epoch = pauseEpoch
    const sourceMode = resolveSource(plan)
    let target
    try { target = await targetFor(initial, sourceMode) }
    catch (error) { return finish(domain, 'offline', { reason: safeError(error, 'source-unavailable') }) }
    if (!target) return finish(domain, 'expired', { reason: 'source-unavailable' })
    const localRaw = await collect(kind)
    const records = inputRecords(kind, target, localRaw, ensure().policy)
    const guard = planGuard(ensure(), initial, plan, target, records, epoch, approval)
    if (guard) return finish(domain, guard === 'suspended' ? guard : 'expired', { reason: guard })
    const targetMap = byKey(records.expected)
    const localMap = byKey(records.local)
    const progress = getOwn(initial.applied, planId) ?? { successes: {}, initial: records.local }
    const completed = new Map(Object.values(progress.successes).map((result) => [result.key, result]))
    // Compare untouched keys against the original plan. A retry tolerates only
    // the original or recorded resulting hash for each successfully changed key.
    if (inventoryHash(progress.initial) !== plan.localBaseline ||
        inventoryHash(withoutCompleted(records.local, completed)) !== inventoryHash(withoutCompleted(progress.initial, completed)) ||
        [...completed].some(([key, result]) => ![result.actualHash, result.postHash].includes(localMap.get(key)?.contentHash ?? null))) {
      return finish(domain, 'expired', { reason: 'local-baseline-changed' })
    }
    const authorized = new Set(authorization.authorized)
    const installed = new Map(Object.entries(progress.successes))
    const results = []
    let unapproved = 0
    for (const op of plan.operations) {
      const result = { opId: op.opId, key: op.key, action: op.action }
      const stop = planGuard(ensure(), initial, plan, target, records, epoch, approval)
      if (stop) return finish(domain, stop === 'suspended' ? stop : 'expired', { reason: stop, results, unapproved })
      if (!authorized.has(op.opId)) {
        unapproved += 1
        results.push({ ...result, status: 'rejected', detail: 'not-approved' })
        continue
      }
      if (!permittedOperation(ensure().policy, op, targetMap.get(op.key)) || (auto && !autoOperations(plan).includes(op))) {
        results.push({ ...result, status: 'rejected', detail: 'policy-rejected' })
        continue
      }
      if (installed.has(op.opId)) {
        results.push({ ...installed.get(op.opId), deduplicated: true })
        continue
      }
      if (op.after && !installed.has(op.after)) {
        results.push({ ...result, status: 'conflict', detail: 'dependency-failed' })
        continue
      }
      const localNow = inputRecords(kind, target, await collect(kind), ensure().policy).local.find((record) => record.key === op.key)
      const afterCollection = planGuard(ensure(), initial, plan, target, records, epoch, approval)
      if (afterCollection) return finish(domain, afterCollection === 'suspended' ? afterCollection : 'expired', { reason: afterCollection, results, unapproved })
      const latestHash = localNow?.contentHash ?? null
      const priorForKey = [...installed.values()].findLast((entry) => entry.key === op.key)
      if (![localMap.get(op.key)?.contentHash ?? null, priorForKey?.postHash].includes(latestHash)) {
        results.push({ ...result, status: 'conflict', detail: 'local-baseline-changed' })
        continue
      }
      const persistSuccess = (current, success) => {
        const successes = Object.fromEntries(installed)
        const applied = { ...current.applied, [planId]: { initial: progress.initial, successes: { ...successes, [op.opId]: success } } }
        const next = { ...current, applied }
        if (sourceMode === 'live' && (kind !== 'plugin' || !plan.operations.some((item) => item.key === op.key && item.after === op.opId))) {
          next[domain.baselines] = { ...next[domain.baselines], [op.key]: op.toHash }
        }
        return next
      }
      const progressHashes = { actualHash: latestHash, postHash: predictedHash(op, targetMap.get(op.key), localNow) }
      const current = ensure()
      const largestSuccess = { ...result, ...progressHashes, status: 'needsRestart', detail: op.action }
      const projectedState = persistSuccess(current, largestSuccess)
      if (stateBytes(projectedState) > MAX_STATE_BYTES) return { status: CAPACITY_ERROR, results, unapproved }
      // Prevent concurrent inbound commits from taking the space needed to
      // persist this operation while the adapter call is outstanding.
      reservedStateBytes = Math.max(0, stateBytes(projectedState) - stateBytes(current))
      try {
        const outcome = await executeOperation(op)
        if (outcome?.ok === false || outcome?.error) throw new Error(outcome.error?.message ?? outcome.error ?? outcome.reason ?? 'adapter-failed')
        result.status = outcome?.restartRequired ? 'needsRestart' : 'applied'
        result.detail = op.action
      } catch (error) {
        result.status = 'compensationFailed'
        result.detail = safeError(error, 'operation-failed')
      } finally {
        reservedStateBytes = 0
      }
      if (SUCCESS.has(result.status)) {
        const success = { ...result, ...progressHashes }
        commit(persistSuccess(ensure(), success))
        installed.set(op.opId, success)
      }
      results.push(result)
      record({ kind: 'operation', ...result })
    }
    const status = results.every((result) => SUCCESS.has(result.status)) ? 'ok' : 'partial'
    return finish(domain, status, { results, unapproved })
  }

  async function autoSync() {
    if (!canAuto(ensure())) return { status: 'skipped', reason: 'managed-auto-disabled' }
    const epoch = pauseEpoch
    const checked = await check({ kind: 'all' })
    if (checked.status !== 'ok') return checked
    const results = []
    for (const [kind, domain] of Object.entries(DOMAIN)) {
      if (epoch !== pauseEpoch) return { status: 'suspended', results }
      const plan = ensure()[domain.plan]
      // A domain that was not part of this check (e.g. Lingshu memory, which is
      // never automatic) has no plan; it is skipped rather than treated as full.
      if (!plan) { results.push({ kind, status: 'skipped', applied: 0 }); continue }
      const operations = autoOperations(plan)
      if (!operations.length || !canAuto(ensure(), plan) || ensure().approvals[plan.planId]?.actor === 'user') {
        results.push({ kind, status: 'skipped', applied: 0 })
        continue
      }
      const approved = approvePlan({ planId: plan.planId, opIds: operations.map((op) => op.opId) }, true)
      const result = approved.ok ? await apply({ planId: plan.planId }) : { status: 'approval-failed', reason: approved.reason }
      results.push({ kind, status: result.status, applied: (result.results ?? []).filter((item) => SUCCESS.has(item.status)).length, reason: result.reason })
    }
    return { status: results.some((item) => !['ok', 'skipped'].includes(item.status)) ? 'partial' : 'ok', results }
  }

  async function suggest() {
    const initial = ensure()
    if (initial.suspended) return fail('suspended')
    const epoch = pauseEpoch
    const records = (await collect('plugin')).filter((record) => !validateResourceRecord(record).length)
    const current = ensure()
    if (current.suspended || epoch !== pauseEpoch) return fail('suspended')
    const suggestions = analyzePlugins(records, current.policy)
    if (ensure().suspended || epoch !== pauseEpoch) return fail('suspended')
    commit({ ...ensure(), suggestions })
    record({ kind: 'advisor-suggestions', count: suggestions.length })
    return structuredClone({ suggestions })
  }

  // Import an agent-produced suggestion array. The agent has no authority to
  // change policy: rows become advisory suggestions that a human adopts.
  async function importSuggestions({ text, actor } = {}) {
    const current = ensure()
    if (current.suspended) return fail('suspended')
    if (actor !== 'user') return fail('user-required')
    let parsed
    try { parsed = typeof text === 'string' ? JSON.parse(text) : text } catch { return fail('invalid-json') }
    if (!Array.isArray(parsed) || parsed.length > 256) return fail('invalid-json')
    const records = (await collect('plugin')).filter((record) => !validateResourceRecord(record).length)
    const byKey = new Map(records.map((record) => [record.key, record]))
    const included = new Set(Array.isArray(current.policy.include) ? current.policy.include : [])
    const imported = []
    const skipped = []
    for (const item of parsed) {
      const key = item?.key
      const action = item?.action
      const record = typeof key === 'string' ? byKey.get(key) : null
      const reason = typeof item?.reason === 'string' && item.reason.trim() ? item.reason.trim().slice(0, 200) : '从 JSON 导入'
      if (!record || !['sync', 'localOnly', 'skip'].includes(action) || included.has(key)
          || isDeviceLocal(key) || isDeviceLocal(record?.source?.package)) {
        skipped.push(typeof key === 'string' ? key : '(invalid)')
        continue
      }
      imported.push({ id: id('sug', { key, action, reason }), key, action, reason, enabled: record.enabled !== false, source: 'import' })
    }
    const epoch = pauseEpoch
    if (ensure().suspended || epoch !== pauseEpoch) return fail('suspended')
    const existing = new Map((ensure().suggestions ?? []).map((item) => [item.key, item]))
    for (const item of imported) existing.set(item.key, item)
    commit({ ...ensure(), suggestions: [...existing.values()] })
    record({ kind: 'suggestions-imported', count: imported.length, actor })
    return { imported, skipped }
  }

  function adoptSuggestions({ ids, actor }) {
    const current = ensure()
    if (current.suspended) return fail('suspended')
    if (actor !== 'user') return fail('user-required')
    const adopted = validateAdopted(current.suggestions, ids)
    if (!adopted.length) return fail('no-suggestion-adopted')
    const include = [...new Set([...current.policy.include, ...adopted.filter((item) => item.action === 'sync').map(({ key }) => key)])]
    const localOnly = [...new Set([...current.policy.localOnly, ...adopted.filter((item) => item.action === 'localOnly').map(({ key }) => key)])]
    const policy = defaultPolicy({ ...current.policy, include, localOnly })
    commit({ ...current, policy, approvals: {}, suggestions: current.suggestions.filter((item) => !adopted.some(({ id }) => id === item.id)) })
    record({ kind: 'suggestions-adopted', actor, count: adopted.length })
    return { ok: true, policy: structuredClone(policy), adopted: adopted.map(({ key }) => key) }
  }

  async function snapshotSecret(current) {
    return adapters.getSecret?.(current.center?.credentialKey ?? 'plugin-sync/snapshot')
  }

  async function createSnapshot() {
    const initial = ensure()
    if (initial.suspended) return fail('suspended')
    if (!allowDirection(initial.policy, 'push')) return fail('direction-blocked:push')
    const epoch = pauseEpoch
    const secret = await snapshotSecret(initial)
    const current = ensure()
    if (current.suspended || epoch !== pauseEpoch) return fail('suspended')
    if (!allowDirection(current.policy, 'push')) return fail('direction-blocked:push')
    if (current.center?.deviceId !== initial.center?.deviceId) return fail('connection-revoked')
    return exportSnapshot(publishedState(current), { now, secret })
  }

  async function loadSnapshot(text) {
    const initial = ensure()
    if (initial.suspended) return fail('suspended')
    if (!allowDirection(initial.policy, 'pull')) return fail('direction-blocked:pull')
    const epoch = pauseEpoch
    const parsed = parseSnapshot(text, await snapshotSecret(initial))
    const current = ensure()
    if (current.suspended || epoch !== pauseEpoch) return fail('suspended')
    if (!allowDirection(current.policy, 'pull')) return fail('direction-blocked:pull')
    if (current.center?.deviceId !== initial.center?.deviceId) return fail('connection-revoked')
    if (!parsed.ok) return parsed
    const { snapshot, trust } = parsed
    if (trust === 'authenticated' && current.center && !sameIdentity(snapshot.identity, current.center)) return fail('snapshot-identity-mismatch')
    commit({ ...current, pendingSnapshot: { ...snapshot, trust } })
    record({ kind: 'snapshot-loaded', revision: snapshot.revision?.number ?? null, trust })
    return { ok: true, revision: snapshot.revision?.number ?? null, trust }
  }

  function setPolicy(input) {
    const current = ensure()
    const errors = validatePolicy(input)
    if (errors.length) return { ok: false, errors }
    if (current.identity.role !== 'unpaired' && input.topology !== current.topology) return fail('topology-bound-to-role')
    const policy = defaultPolicy(structuredClone(input))
    if (policyHash(policy) !== policyHash(current.policy)) {
      commit({ ...current, policy, topology: policy.topology, approvals: {} })
      record({ kind: 'policy-updated', actor: 'user', topology: policy.topology })
    }
    return { ok: true, policy: structuredClone(policy) }
  }

  function suspend(value) {
    const current = ensure()
    if (value && !current.suspended) pauseEpoch += 1
    commit({ ...current, suspended: Boolean(value) })
    record({ kind: value ? 'suspended' : 'resumed', actor: 'user' })
    return publicState()
  }

  // Escape hatch for a profile stuck with the wrong topology or link. The
  // user's policy is preserved, but topology returns to the default so a new
  // pairing can be chosen from scratch.
  async function resetSync() {
    const current = ensure()
    commit({
      version: 1,
      identity: { ...current.identity, role: 'unpaired' },
      topology: 'center',
      policy: defaultPolicy({ ...current.policy, topology: 'center' }),
      center: null, peers: {}, invitations: {},
      expected: [], expectedConfig: [], expectedLingshu: [],
      pluginBaselines: {}, configBaselines: {}, lingshuBaselines: {},
      revision: { number: 0, author: null, clock: {}, hash: null },
      proposals: [], conflicts: [], outbox: [], remoteState: null, applied: {}, approvals: {},
      lastPlan: null, lastConfigPlan: null, lastLingshuPlan: null,
      lastResults: [], lastConfigResults: [], lastLingshuResults: [], lastStatus: null, lastConfigStatus: null, lastLingshuStatus: null,
      suggestions: [], pendingSnapshot: null, suspended: false,
      audit: current.audit,
    })
    for (const key of ['plugin-sync/center', 'plugin-sync/peer']) {
      try { await adapters.deleteSecret?.(key) } catch { /* absent credentials are expected */ }
    }
    record({ kind: 'sync-reset', actor: 'user' })
    return publicState()
  }

  async function submitProposal({ kind = 'plugin' } = {}) {
    const initial = ensure()
    if (initial.suspended) return fail('suspended')
    if (!['peer', 'device'].includes(initial.identity.role)) return fail('requires-device-or-peer-role')
    if (!allowDirection(initial.policy, 'push')) return fail('direction-blocked:push')
    const kinds = domains(kind)
    if (!kinds.length) return fail('bad-kind')
    const peer = initial.center ?? Object.values(initial.peers).find((item) => item.status === 'connected')
    if (!peer) return fail('peer-not-connected')
    const epoch = pauseEpoch
    const collected = await collectShared(kinds, 'push')
    const secret = initial.center ? await adapters.getSecret(peer.credentialKey) : null
    const current = ensure()
    if (current.suspended || epoch !== pauseEpoch) return fail('suspended')
    if (initial.center ? current.center?.deviceId !== peer.deviceId || !secret : getOwn(current.peers, peer.deviceId)?.status !== 'connected') return fail('connection-revoked')
    if (!allowDirection(current.policy, 'push')) return fail('direction-blocked:push')
    const resources = kinds.flatMap((name) => scopeRecords(collected[name], current.policy, 'push'))
    if (!resources.length) return fail('no-shareable-resources')
    const origin = current.identity
    const parents = [current.identity.role === 'peer' ? current.remoteState?.revision.hash : current.revision.hash].filter(Boolean)
    const changeset = { id: id('cs', { origin, resources, parents }), schemaVersion: 1, origin, parents, resources, issuedAt: now(), mac: '' }
    if (!withinPayloadLimit(changeset)) return fail('payload-too-large')
    if (!current.center) {
      const queue = (current.outbox ?? []).filter((item) => item.changeset.id !== changeset.id)
      if (queue.length >= MAX_QUEUED_OFFERS) return fail('queue-full')
      commit({ ...current, outbox: [...queue, { peerId: peer.deviceId, changeset }] })
      record({ kind: 'proposal-queued', proposalId: changeset.id, deviceId: peer.deviceId })
      return { status: 'queued', proposalId: changeset.id }
    }
    changeset.mac = signChangeset(changeset, secret)
    try {
      const response = await transportFor(transport, peer.transport).send(`${endpointFor(peer.url, peer.transport)}/plugin-sync/proposals`, {
        method: 'POST', token: secret, body: { identity: current.identity, changeset },
      })
      if (response?.error || response?.ok === false) return fail(safeError(response.error ?? response.reason, 'proposal-failed'))
      if (!['pending', 'conflict', 'duplicate'].includes(response?.status) || response.proposalId !== changeset.id) return fail('invalid-proposal-response')
      if (ensure().suspended || epoch !== pauseEpoch) return fail('suspended')
      if (ensure().center?.deviceId !== peer.deviceId) return fail('connection-revoked')
      updateLink(peer, 'connected')
      record({ kind: 'proposal-submitted', proposalId: changeset.id, status: response.status })
      return response
    } catch (error) { return fail(safeError(error, 'proposal-failed')) }
  }

  function peerHandler(handler) {
    return (...args) => {
      try { return handler(...args) }
      catch (error) {
        if (error.message === CAPACITY_ERROR) return { error: CAPACITY_ERROR }
        throw error
      }
    }
  }

  return {
    publicState, pairCenter: serialize(pairCenter), joinCenter: serialize((args) => join(args, 'center')), connectPeer: serialize((args) => join(args, 'p2p')),
    verifyInvitation: serialize(verifyInvitation), resetSync,
    createInvitation, handleHello: peerHandler(handleHello), handleGetState: peerHandler(handleGetState),
    handleSubmitProposal: peerHandler(handleSubmitProposal), handleListProposals, handleAcceptProposal: peerHandler(handleAcceptProposal),
    acceptAndInstall: serialize(acceptAndInstall),
    rejectProposal, handleRejectProposal: rejectProposal, resolveConflict, revokePeer, archiveDecisions: serialize(archiveDecisions),
    publishLocal: serialize(publishLocal), check: serialize(check), resolvePlanConflict: serialize(resolvePlanConflict), approve: (args) => approvePlan(args),
    apply: serialize(apply), autoSync: serialize(autoSync), setPolicy, suspend,
    suggest: serialize(suggest), adoptSuggestions, importSuggestions: serialize(importSuggestions),
    createSnapshot: serialize(createSnapshot), loadSnapshot: serialize(loadSnapshot), submitProposal: serialize(submitProposal),
    bearer: (request, header) => bearerFrom(header) ?? request?.token ?? null,
  }
}
