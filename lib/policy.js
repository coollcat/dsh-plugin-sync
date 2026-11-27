// Local policy evaluation. Pure, and never taken from a remote snapshot.

import { hash, CAPS, LINGSHU_DEFAULT_LAYERS, LINGSHU_LAYERS, LINGSHU_SENSITIVITY } from './protocol.js'
import { isSecretKey, validFieldPath, MIN_CONFIG_FIELDS, settingsLocalOnly } from './config.js'

export const SYSTEM_PROTECTED = ['@local/dsh-plugin-sync', '@deepseek-ai/*']

export const MODES = ['managed', 'selective', 'manual']

export const DEFAULT_CAPS = {
  install: false,
  upgrade: false,
  enable: true,
  disable: true,
  configSet: false,
  // Memory is its own sync domain: the layer list below is the opt-in, and a
  // memory write always needs its own approval, so this cap can default open.
  memoryWrite: true,
  tombstone: false,
}

// Memory defaults live in policy.lingshu so they can be audited with the rest of
// the policy. Caps still gate the write itself.
export const DEFAULT_LINGSHU = {
  layers: [...LINGSHU_DEFAULT_LAYERS],
  maxSensitivity: 'internal',
}

export const SENSITIVITY_RANK = { public: 0, internal: 1, restricted: 2, private: 3, secret: 4 }

export function defaultPolicy(overrides = {}) {
  const base = {
    mode: 'manual',
    topology: 'center',
    direction: 'both',
    include: [],
    exclude: [],
    localOnly: [],
    protected: [...SYSTEM_PROTECTED],
    configFields: {},
    lingshu: { ...DEFAULT_LINGSHU },
    default: 'allow',
    caps: { ...DEFAULT_CAPS },
    autoApply: false,
    intervalMs: 300000,
    conflictStrategy: 'manual',
  }
  return {
    ...base,
    ...overrides,
    protected: [...new Set([...SYSTEM_PROTECTED, ...(Array.isArray(overrides.protected) ? overrides.protected : [])])],
    caps: { ...base.caps, ...(overrides.caps ?? {}) },
    lingshu: { ...base.lingshu, ...(overrides.lingshu ?? {}) },
  }
}

export function matches(pattern, key) {
  if (pattern === key) return true
  if (typeof pattern !== 'string' || !pattern.endsWith('*')) return false
  const prefix = pattern.slice(0, -1)
  return key.startsWith(prefix)
}

function firstMatch(patterns, key) {
  if (!Array.isArray(patterns)) return null
  return patterns.find((pattern) => matches(pattern, key)) ?? null
}

export function configFieldsFor(policy, key) {
  const fields = policy?.configFields
  return fields && Object.hasOwn(fields, key) && Array.isArray(fields[key])
    ? fields[key].filter((path) => validFieldPath(path) && !path.some(isSecretKey)) : []
}

// Layer and sensitivity limits are evaluated locally, before any include match.
// An explicit include can narrow the layer list but never widen it past
// policy.lingshu.layers, and never past maxSensitivity.
export function lingshuScope(policy, record) {
  const settings = defaultPolicy(policy ?? {}).lingshu
  const layers = Array.isArray(settings.layers) ? settings.layers : DEFAULT_LINGSHU.layers
  const layer = record?.layer
  if (!LINGSHU_LAYERS.includes(layer)) return { allowed: false, reason: 'memory-layer-unsupported', source: 'lingshu' }
  if (!layers.includes(layer)) return { allowed: false, reason: 'memory-layer-not-in-scope', source: 'lingshu' }
  const max = SENSITIVITY_RANK[settings.maxSensitivity] ?? SENSITIVITY_RANK[DEFAULT_LINGSHU.maxSensitivity]
  const rank = SENSITIVITY_RANK[record?.sensitivity]
  if (rank === undefined || rank > max) return { allowed: false, reason: 'memory-sensitivity-above-policy', source: 'lingshu' }
  return { allowed: true, reason: 'memory-in-scope', source: 'lingshu' }
}

export function lingshuBundle(layer) { return `lingshu:${layer}` }

// Rules may match either an entry ID or its owning bundle. Sensitive types
// still require an explicit match on the concrete resource key.
export function evaluate(policy, resource, direction = null) {
  const effective = defaultPolicy(policy ?? {})
  const { key = '', bundle, requiresCap: cap } = resource ?? {}
  const keys = [key, bundle, resource?.source?.package].filter((value) => typeof value === 'string')
  const match = (patterns) => keys.map((name) => firstMatch(patterns, name)).find((value) => value !== null)
  const deny = (reason, source) => ({ allowed: false, reason, source })
  if (match(effective.protected)) return deny('system-protected', 'protected')
  if (match(effective.localOnly)) return deny('local-only', 'localOnly')
  if (direction && !['both', direction].includes(effective.direction)) return deny(`direction-blocked:${direction}`, 'direction')
  const included = firstMatch(effective.include, key)
  const explicitlyIncluded = Boolean(included || match(effective.include))
  const excluded = match(effective.exclude)
  // Rules are guardrails, not suggestions: an exclusion always wins over a
  // checklist include, for plugins, configs and memory nodes alike.
  if (excluded) return deny(`excluded:${excluded}`, 'exclude')
  if (resource?.kind === 'pluginConfig') {
    if (!included) return deny('config-not-explicitly-included', 'config-safety')
    // Device-bound settings (Lingshu memory) are never a remote write target,
    // even when a hand-edited policy names their entry: the UI never offers the
    // switch, so accepting it would make one device silently unrunnable.
    if (keys.some(settingsLocalOnly)) return deny('config-device-bound', 'config-safety')
    // Only plugins with a real settings surface (multiple non-secret fields)
    // may sync settings. A lone field is not a switchable component.
    if (configFieldsFor(effective, key).length < MIN_CONFIG_FIELDS) return deny('config-fields-insufficient', 'config-safety')
  }
  if (resource?.kind === 'lingshuNode') {
    // Lingshu memory is deliberately kept out of the plugin whitelist: its
    // opt-in is policy.lingshu.layers, and `include` patterns are optional
    // aliases. Files never flow anywhere else, and each write is approved.
    const scope = lingshuScope(effective, resource)
    if (!scope.allowed) return deny(scope.reason, scope.source)
    if (cap != null && !CAPS.includes(cap)) return deny(`unknown-cap:${cap}`, 'caps')
    if (cap != null && effective.caps[cap] !== true) return deny(`cap-disabled:${cap}`, 'caps')
    return { allowed: true, reason: 'memory-layer-in-scope', source: 'lingshu' }
  }
  if (!explicitlyIncluded && effective.default !== 'allow') return deny('default-deny', 'default')
  if (cap != null && !CAPS.includes(cap)) return deny(`unknown-cap:${cap}`, 'caps')
  if (cap != null && effective.caps[cap] !== true) return deny(`cap-disabled:${cap}`, 'caps')
  return explicitlyIncluded ? { allowed: true, reason: 'explicit-include', source: 'include' }
    : { allowed: true, reason: 'default-allow', source: 'default' }
}

export function policyHash(policy) {
  return hash(defaultPolicy(policy))
}

export function validatePolicy(policy) {
  const out = []
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return ['policy must be an object']
  if (!MODES.includes(policy.mode)) out.push(`mode must be one of ${MODES.join(',')}`)
  if (!['center', 'p2p'].includes(policy.topology)) out.push('topology must be center or p2p')
  if (!['push', 'pull', 'both'].includes(policy.direction)) out.push('direction must be push, pull or both')
  for (const field of ['include', 'exclude', 'localOnly', 'protected']) {
    if (!Array.isArray(policy[field]) || policy[field].some((v) => typeof v !== 'string' || !v)) {
      out.push(`${field} must be an array of non-empty strings`)
    }
  }
  const fields = policy.configFields ?? {}
  if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.entries(fields).some(([key, paths]) =>
    !key || ['__proto__', 'constructor', 'prototype'].includes(key) || !Array.isArray(paths) ||
    paths.some((path) => !validFieldPath(path) || path.some(isSecretKey)))) {
    out.push('configFields must map entry IDs to safe key segment arrays')
  }
  if (!['allow', 'deny'].includes(policy.default)) out.push('default must be allow or deny')
  const lingshu = policy.lingshu ?? {}
  if (typeof lingshu !== 'object' || Array.isArray(lingshu)) out.push('lingshu must be an object')
  else {
    if (!Array.isArray(lingshu.layers) || lingshu.layers.some((layer) => !LINGSHU_LAYERS.includes(layer))) {
      out.push(`lingshu.layers must be an array of ${LINGSHU_LAYERS.join(',')}`)
    }
    if (!LINGSHU_SENSITIVITY.includes(lingshu.maxSensitivity)) out.push('lingshu.maxSensitivity is not supported')
  }
  if (typeof policy.autoApply !== 'boolean') out.push('autoApply must be boolean')
  if (!policy.caps || typeof policy.caps !== 'object' || Array.isArray(policy.caps)) out.push('caps must be an object')
  for (const cap of CAPS) {
    if (typeof policy.caps?.[cap] !== 'boolean') out.push(`caps.${cap} must be boolean`)
  }
  for (const key of Object.keys(policy.caps ?? {})) {
    if (!CAPS.includes(key)) out.push(`caps.${key} is not supported`)
  }
  if (!['manual', 'center-wins', 'local-wins', 'ai-suggest'].includes(policy.conflictStrategy)) {
    out.push('conflictStrategy must be manual, center-wins, local-wins or ai-suggest')
  }
  if (!Number.isInteger(policy.intervalMs) || policy.intervalMs < 60000 || policy.intervalMs > 86400000) {
    out.push('intervalMs must be an integer between 60000 and 86400000')
  }
  return out
}
