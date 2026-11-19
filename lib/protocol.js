// Bounded, data-only wire schema shared by online state, proposals and snapshots.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const SCHEMA_VERSION = 1
export const MAX_PAYLOAD_BYTES = 512 * 1024
export const MAX_RESOURCES = 512
export const RESOURCE_KINDS = ['plugin', 'pluginConfig', 'memory']
export const ACTIONS = ['install', 'upgrade', 'enable', 'disable', 'configSet', 'memWrite', 'tombstone']
export const CAPS = [...ACTIONS]
const HASH_RE = /^sha256:[a-f0-9]{64}$/
const UNSAFE = new Set(['__proto__', 'prototype', 'constructor'])

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonical(item) ?? 'null').join(',')}]`
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
export function hash(value) { return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}` }
export function id(prefix, value) { return `${prefix}_${hash(value).slice(7, 31)}` }
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
export function token() { return randomBytes(32).toString('hex') }
export function byteSize(value) { return Buffer.byteLength(canonical(value) ?? '', 'utf8') }
export function withinPayloadLimit(value) { try { return byteSize(value) <= MAX_PAYLOAD_BYTES } catch { return false } }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function string(value, max = 512) { return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\u0000') }
function check(out, condition, message) { if (!condition) out.push(message) }
function safeData(value, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 20000 || depth > 25) return false
  if (value === null || ['string','boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return value === undefined
  for (const [key, item] of Object.entries(value)) if (UNSAFE.has(key) || !safeData(item, depth + 1, budget)) return false
  return true
}
function fieldPath(value) { return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(part => string(part, 300) && !UNSAFE.has(part)) }
function packageName(value) { return typeof value === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value) && value.length <= 214 }
function relative(value) { return string(value, 500) && !/^(?:[A-Za-z]:|[\\/])/.test(value) && !value.includes('\\') && value.split('/').every(part => part && part !== '.' && part !== '..') }

export function resourceHash(record) {
  if (record?.kind === 'plugin') return hash({ name: record.key, source: record.source, enabled: record.enabled })
  if (record?.kind === 'pluginConfig') return hash({ config: record.config })
  if (record?.kind === 'memory') return hash({ adapterId: record.adapterId, relativePath: record.relativePath, content: record.content })
  throw new Error('unsupported-resource-kind')
}
export function validateIdentity(value) {
  if (!plain(value)) return ['identity must be an object']
  const out = []
  check(out, string(value.deviceId, 128) && !UNSAFE.has(value.deviceId), 'identity.deviceId is required')
  check(out, string(value.profileId, 128) && !UNSAFE.has(value.profileId), 'identity.profileId is required')
  check(out, string(value.label, 200), 'identity.label is required')
  return out
}
export function validatePluginSource(source) {
  if (!plain(source)) return ['source must be an object']
  const out = []
  check(out, ['registry', 'git', 'file'].includes(source.type), 'source.type must be registry, git or file')
  if (source.type === 'registry') {
    check(out, packageName(source.package), 'registry source needs a valid package name')
    check(out, typeof source.version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(source.version), 'registry source needs exact version')
  } else if (source.type === 'git') {
    let allowed = false
    try { const url = new URL(source.url); allowed = url.protocol === 'https:' && !url.username && !url.password } catch { allowed = /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.url ?? '') }
    check(out, allowed, 'git source needs a credential-free HTTPS or github URL')
    check(out, /^[0-9a-f]{40}$/.test(source.commit ?? ''), 'git source needs full 40-char commit')
  } else if (source.type === 'file') {
    check(out, string(source.name, 300) && !source.name.includes('/') && !source.name.includes('\\'), 'file source needs basename')
    check(out, HASH_RE.test(source.sha256 ?? ''), 'file source needs sha256 digest')
  }
  return out
}
function common(record, kind) {
  if (!plain(record)) return ['resource must be an object']
  const out = []
  check(out, record.kind === kind, `resource.kind must be ${kind}`)
  check(out, string(record.key, 500) && !UNSAFE.has(record.key), 'resource.key is required')
  check(out, HASH_RE.test(record.contentHash ?? ''), 'resource.contentHash must be a sha256 digest')
  check(out, safeData(record), 'resource contains unsafe, deep or excessive data')
  check(out, withinPayloadLimit(record), 'resource exceeds payload limit')
  return out
}
function verifyContent(out, record) {
  try { check(out, safeEqual(record.contentHash, resourceHash(record)), 'resource.contentHash mismatch') } catch { out.push('resource cannot be hashed') }
  return out
}
export function validatePluginRecord(record) {
  const out = common(record, 'plugin')
  if (!plain(record)) return out
  check(out, packageName(record.key), 'plugin key must be a package name')
  check(out, typeof record.enabled === 'boolean', 'resource.enabled must be boolean')
  out.push(...validatePluginSource(record.source))
  if (record.source?.type === 'registry') check(out, record.source.package === record.key, 'package must match resource.key')
  return verifyContent(out, record)
}
export function validateConfigRecord(record) {
  const out = common(record, 'pluginConfig')
  if (!plain(record)) return out
  check(out, string(record.entryId, 300) && record.entryId === record.key, 'entryId must match resource.key')
  check(out, string(record.bundle, 300), 'resource.bundle is required')
  check(out, plain(record.config), 'resource.config must be an object')
  check(out, Array.isArray(record.secretKeys) && record.secretKeys.length <= 1024 && record.secretKeys.every(fieldPath), 'secretKeys must be an array of safe path arrays')
  if (record.fields !== undefined) check(out, Array.isArray(record.fields) && record.fields.length <= 256 && record.fields.every(fieldPath), 'fields must be safe field paths')
  return verifyContent(out, record)
}
export function validateMemoryRecord(record) {
  const out = common(record, 'memory')
  if (!plain(record)) return out
  check(out, string(record.adapterId, 120) && /^[a-z][a-z0-9-]*$/.test(record.adapterId), 'resource.adapterId is required')
  check(out, relative(record.relativePath), 'resource.relativePath must be a safe relative path')
  check(out, record.key === `${record.adapterId}:${record.relativePath}`, 'memory key must match its adapter and path')
  check(out, record.schemaVersion === 1, 'unsupported memory schemaVersion')
  check(out, typeof record.content === 'string' && Buffer.byteLength(record.content, 'utf8') <= 256 * 1024, 'memory content must be bounded text')
  return verifyContent(out, record)
}
export function validateResourceRecord(record) {
  if (record?.kind === 'plugin') return validatePluginRecord(record)
  if (record?.kind === 'pluginConfig') return validateConfigRecord(record)
  if (record?.kind === 'memory') return validateMemoryRecord(record)
  return ['unsupported resource kind']
}
function validateResources(records, kind = null) {
  if (!Array.isArray(records) || records.length > MAX_RESOURCES) return ['resources must be an array within limit']
  const out = [], seen = new Set()
  for (const record of records) {
    if (kind && record?.kind !== kind) out.push(`unexpected resource kind in ${kind} collection`)
    out.push(...validateResourceRecord(record))
    const key = `${record?.kind}:${record?.key}`
    if (seen.has(key)) out.push('duplicate resource key')
    seen.add(key)
  }
  return out
}
export function validateRevision(value) {
  if (!plain(value)) return ['revision must be an object']
  const out = []
  check(out, Number.isSafeInteger(value.number) && value.number >= 0, 'revision.number must be a nonnegative integer')
  check(out, plain(value.clock ?? {}) && Object.keys(value.clock ?? {}).length <= 128 && Object.entries(value.clock ?? {}).every(([key,count]) => string(key,128) && !UNSAFE.has(key) && Number.isSafeInteger(count) && count >= 0), 'invalid revision clock')
  check(out, value.hash === null || string(value.hash, 4096), 'revision.hash must be a reference')
  return out
}
export function validateStatePayload(value) {
  if (!plain(value)) return ['state must be an object']
  const out = []
  check(out, withinPayloadLimit(value) && safeData(value), 'state exceeds limits or contains unsafe data')
  if (!plain(value.identity) || !string(value.identity.deviceId,128) || !string(value.identity.profileId,128)) out.push('state identity missing')
  out.push(...validateRevision(value.revision))
  out.push(...validateResources(value.expected, 'plugin'), ...validateResources(value.expectedConfig, 'pluginConfig'), ...validateResources(value.expectedMemory, 'memory'))
  for (const [field,digest] of [['expected','expectedHash'],['expectedConfig','expectedConfigHash'],['expectedMemory','expectedMemoryHash']]) {
    if (value[digest] !== undefined && hash(value[field]) !== value[digest]) out.push(`${digest} mismatch`)
  }
  return out
}
function macPayload(changeset) { return canonical({ id: changeset.id, schemaVersion: changeset.schemaVersion, origin: changeset.origin, parents: changeset.parents, resources: changeset.resources, issuedAt: changeset.issuedAt }) }
export function signChangeset(changeset, secret) { return `hmac-sha256:${createHmac('sha256',secret).update(macPayload(changeset)).digest('hex')}` }
export function verifyChangesetMac(changeset, secret) { return typeof secret === 'string' && !!secret && safeEqual(changeset?.mac,signChangeset(changeset,secret)) }
export function validateChangeset(value) {
  if (!plain(value)) return ['changeset must be an object']
  const out = []
  check(out, withinPayloadLimit(value) && safeData(value), 'changeset exceeds limits or contains unsafe data')
  check(out, value.schemaVersion === SCHEMA_VERSION, `schemaVersion must be ${SCHEMA_VERSION}`)
  out.push(...validateIdentity(value.origin))
  check(out, string(value.id,128), 'changeset.id is required')
  check(out, Array.isArray(value.parents) && value.parents.length <= 128 && value.parents.every(parent => string(parent,4096)), 'parents must be an array of references')
  out.push(...validateResources(value.resources))
  check(out, string(value.issuedAt,40) && Number.isFinite(Date.parse(value.issuedAt)), 'issuedAt is required')
  check(out, typeof value.mac === 'string' && /^hmac-sha256:[a-f0-9]{64}$/.test(value.mac), 'mac must be a peer HMAC')
  return out
}
export function validatePlan(value) {
  if (!plain(value)) return ['plan must be an object']
  const out=[]
  for(const field of ['planId','source','targetBaseline','localBaseline']) check(out,string(value[field],4096),`plan.${field} is required`)
  for(const field of ['operations','skipped','conflicts']) check(out,Array.isArray(value[field]),`plan.${field} must be an array`)
  for(const op of value.operations??[]) {
    check(out,plain(op) && string(op.opId,120) && string(op.key,500) && ACTIONS.includes(op.action) && ['normal','high'].includes(op.risk), 'invalid operation')
  }
  return out
}
