// Unknown plugin schemas are opt-in by explicit field paths. Name/value
// classification is defense in depth, not proof that arbitrary text is safe.
import { hash } from './protocol.js'

const SECRET_KEY = /(token|secret|password|passwd|pwd|apikey|authorization|auth|cookie|credential|privatekey|accesskey|refresh|session|salt|mac)/i
const GENERIC_SECRET_KEYS = new Set(['key', 'pass', 'pem', 'certificate'])
const UNSAFE_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor'])

export function isSecretKey(key) {
  const normalized = String(key).replace(/[-_.]/g, '').toLowerCase()
  return SECRET_KEY.test(normalized) || GENERIC_SECRET_KEYS.has(normalized)
}

function looksLikeSecretValue(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/.test(text)) return true
  if (/^Bearer\s+\S+/i.test(text)) return true
  if (/^(?:sk-|rk-|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}$/i.test(text)) return true
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) return true
  try {
    const url = new URL(text)
    if (url.username || url.password) return true
    for (const key of url.searchParams.keys()) if (isSecretKey(key)) return true
  } catch {}
  return false
}

export function validFieldPath(path) {
  return Array.isArray(path) && path.length > 0 && path.length <= 20 && path.every((part) =>
    typeof part === 'string' && part.length > 0 && part.length <= 300 && !part.includes('\u0000') && !UNSAFE_SEGMENTS.has(part))
}

function defineValue(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, configurable: true, writable: true })
}

function walk(value, path, secretPaths) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item, index) => {
    const next = [...path, String(index)]
    if (looksLikeSecretValue(item)) { secretPaths.push(next); return null }
    return walk(item, next, secretPaths)
  })
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    const next = [...path, key]
    if (UNSAFE_SEGMENTS.has(key)) continue
    if (isSecretKey(key) || looksLikeSecretValue(item)) { secretPaths.push(next); continue }
    defineValue(out, key, walk(item, next, secretPaths))
  }
  return out
}

export function splitSecrets(config) {
  const secretPaths = []
  return { safe: walk(config ?? {}, [], secretPaths), secretPaths }
}

export function configHash(config) { return hash({ config }) }

export function getPath(object, path) {
  let current = object
  for (const part of path ?? []) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined
    current = current[part]
  }
  return current
}

export function setPath(object, path, value) {
  if (!validFieldPath(path)) throw new Error('unsafe-config-path')
  let current = object
  for (let index = 0; index < path.length - 1; index++) {
    const part = path[index]
    if (!Object.hasOwn(current, part) || current[part] === null || typeof current[part] !== 'object') {
      defineValue(current, part, /^\d+$/.test(path[index + 1]) ? [] : {})
    }
    current = current[part]
  }
  defineValue(current, path.at(-1), structuredClone(value))
}

export function projectConfig(config, fields = []) {
  const safe = splitSecrets(config ?? {}).safe
  const output = {}
  for (const path of fields) {
    if (!validFieldPath(path) || path.some(isSecretKey)) continue
    const value = getPath(safe, path)
    if (value !== undefined) setPath(output, path, value)
  }
  return output
}

function overlay(local, remote) {
  if (remote === null || typeof remote !== 'object' || Array.isArray(remote)) return structuredClone(remote)
  const output = local && typeof local === 'object' && !Array.isArray(local) ? structuredClone(local) : {}
  for (const [key, value] of Object.entries(remote)) {
    if (!UNSAFE_SEGMENTS.has(key)) defineValue(output, key, overlay(Object.hasOwn(output, key) ? output[key] : undefined, value))
  }
  return output
}

// The remote secret path list is informational only, never an authority.
export function mergeWithLocalSecrets(remoteConfig, localConfig) {
  const result = overlay(localConfig ?? {}, splitSecrets(remoteConfig ?? {}).safe)
  for (const path of splitSecrets(localConfig ?? {}).secretPaths) {
    const value = getPath(localConfig, path)
    if (value !== undefined && validFieldPath(path)) setPath(result, path, value)
  }
  return result
}

export function mergeConfigFields(current, remote, fields = []) {
  const projected = projectConfig(remote, fields)
  const result = structuredClone(current ?? {})
  for (const path of fields) {
    if (!validFieldPath(path) || path.some(isSecretKey)) continue
    const incoming = getPath(projected, path)
    if (incoming === undefined) continue // No implicit deletion.
    const local = getPath(current, path)
    const safeValue = (incoming && typeof incoming === 'object')
      ? mergeWithLocalSecrets(incoming, local && typeof local === 'object' ? local : {})
      : incoming
    setPath(result, path, safeValue)
  }
  return mergeWithLocalSecrets(result, current ?? {})
}

export function configRecord({ entryId, bundle, config, origin, fields }) {
  const projection = fields ? projectConfig(config, fields) : splitSecrets(config).safe
  return {
    kind: 'pluginConfig', key: entryId, entryId, bundle, config: projection,
    secretKeys: splitSecrets(config).secretPaths, ...(origin ? { origin } : {}),
    ...(fields ? { fields: structuredClone(fields) } : {}), contentHash: configHash(projection),
  }
}
