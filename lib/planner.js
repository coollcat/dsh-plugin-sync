// Diff authoritative expectations against local inventory, then apply local policy.
// Pure functions only; no Host calls.

import { hash, id } from './protocol.js'
import { evaluate, policyHash } from './policy.js'

export function inventoryMap(records) {
  const map = new Map()
  for (const record of records ?? []) map.set(record.key, record)
  return map
}

function sourceIdentity(record) {
  const s = record?.source ?? {}
  if (s.type === 'registry') return `${s.package}@${s.version}`
  if (s.type === 'git') return `${s.url}#${s.commit}`
  if (s.type === 'file') return `${s.name}@${s.sha256}`
  return JSON.stringify(s)
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/.exec(value ?? '')
  return match ? { digits: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') ?? [] } : null
}

// Only explicit versions are comparable. Anything else is a change, not an upgrade.
export function compareSource(expected, local) {
  if (!expected || !local || expected.type !== local.type) return 'change'
  if (expected.type === 'registry') {
    if (expected.package !== local.package) return 'change'
    const a = parseVersion(expected.version)
    const b = parseVersion(local.version)
    if (a && b) {
      for (let i = 0; i < a.digits.length; i++) {
        if (a.digits[i] !== b.digits[i]) return a.digits[i] > b.digits[i] ? 'upgrade' : 'downgrade'
      }
      if (Boolean(a.pre.length) !== Boolean(b.pre.length)) return a.pre.length ? 'downgrade' : 'upgrade'
      for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        const left = a.pre[i]
        const right = b.pre[i]
        if (left === right) continue
        if (left === undefined || right === undefined) return left === undefined ? 'downgrade' : 'upgrade'
        const numericLeft = /^\d+$/.test(left)
        const numericRight = /^\d+$/.test(right)
        if (numericLeft !== numericRight) return numericLeft ? 'downgrade' : 'upgrade'
        const greater = numericLeft ? BigInt(left) > BigInt(right) : left > right
        return greater ? 'upgrade' : 'downgrade'
      }
    }
  }
  return sourceIdentity({ source: expected }) === sourceIdentity({ source: local }) ? 'same' : 'change'
}

function makeOp(action, target, current, source, payload, effects, after = null) {
  const op = {
    action, key: target.key, fromHash: current?.contentHash ?? null, toHash: target.contentHash,
    requiresCap: action, risk: 'normal', source, payload, effects, after,
  }
  return { ...op, opId: id('op', op) }
}

function pluginOperations(target, current, source, skipped, conflicts) {
  const { key } = target
  const operations = []
  const changing = current && compareSource(target.source, current.source)
  if (changing === 'downgrade') {
    conflicts.push({ key, kind: 'downgrade-blocked', center: sourceIdentity(target), local: sourceIdentity(current) })
    return operations
  }
  if (!current || changing !== 'same') {
    const action = current ? 'upgrade' : 'install'
    if (target.source?.type !== 'registry') {
      skipped.push({ key, action, reason: `source-not-supported:${target.source?.type ?? 'unknown'}`, source })
      return operations
    }
    if (current?.enabled && !target.enabled) {
      operations.push(makeOp('disable', target, current, source, null, [`停用 ${key}`]))
    }
    operations.push(makeOp(action, target, current, source, target.source, [`${current ? '更新' : '安装'} ${key}（${sourceIdentity(target)}）`], operations[0]?.opId))
  }
  if (!operations.some((op) => op.action === 'disable') && target.enabled !== (current?.enabled ?? false)) {
    const action = target.enabled ? 'enable' : 'disable'
    operations.push(makeOp(action, target, current, source, null, [`${target.enabled ? '启用' : '停用'} ${key}`], operations[0]?.opId))
  }
  return operations
}

export function inventoryHash(records) {
  return hash([...records].sort((a, b) => a.key.localeCompare(b.key)))
}

function buildResourcePlan(kind, {
  expected = [], local = [], baselines = {}, policy, source = 'center', revision = null,
  sourceHash = null, now = null, resolutions = [], divergent = false,
}) {
  const expectedMap = inventoryMap(expected)
  const localMap = inventoryMap(local)
  const operations = []
  const skipped = []
  const conflicts = []

  for (const [key, target] of expectedMap) {
    const current = localMap.get(key)
    const resource = { ...target, kind: kind === 'config' ? 'pluginConfig' : kind }
    const scope = evaluate(policy, resource, 'pull')
    if (!scope.allowed) {
      skipped.push({ key, action: null, reason: scope.reason, source: scope.source })
      continue
    }
    if (current?.contentHash === target.contentHash) continue
    const baseline = Object.hasOwn(baselines, key) ? baselines[key] : null
    if (baseline && target.contentHash === baseline) {
      skipped.push({ key, action: null, reason: 'local-changed', source: 'baseline' })
      continue
    }
    let highRisk = false
    let opSource = source
    if ((baseline && current?.contentHash !== baseline) || (divergent && current)) {
      const choice = resolutions.find((entry) => entry.key === key)?.choice
      const strategy = policy?.conflictStrategy ?? 'manual'
      const resolution = choice ?? (strategy === 'ai-suggest' ? 'manual' : strategy)
      conflicts.push({ key, kind: `concurrent-${kind}-change`, center: target.contentHash, local: current?.contentHash ?? null,
        baseline, resolution, ...(strategy === 'ai-suggest' && !choice ? { suggestion: 'manual-review' } : {}) })
      if (resolution !== 'center-wins' && resolution !== 'remote') continue
      highRisk = true
      opSource = `${source}:${resolution}`
    }

    let choices
    if (kind === 'plugin') choices = pluginOperations(target, current, opSource, skipped, conflicts)
    else if (kind === 'config') choices = [makeOp('configSet', target, current, opSource, {
      entryId: target.entryId, bundle: target.bundle, config: target.config, fields: target.fields ?? [],
      expectedHash: current?.contentHash ?? null,
    }, [`设置 ${key} 的共享配置字段`])]
    else choices = [makeOp('memWrite', target, current, opSource, {
      adapterId: target.adapterId, relativePath: target.relativePath, content: target.content,
      expectedHash: current?.contentHash ?? null,
    }, [`写入记忆文件 ${key}`])]

    for (const op of choices) {
      const decision = evaluate(policy, { ...resource, requiresCap: op.requiresCap }, 'pull')
      if (decision.allowed && (!op.after || operations.some(({ opId }) => opId === op.after))) {
        if (highRisk) op.risk = 'high'
        operations.push(op)
      } else {
        skipped.push({ key, opId: op.opId, action: op.action, reason: decision.allowed ? 'dependency-denied' : decision.reason, source: decision.source })
      }
    }
  }
  for (const [key, current] of localMap) {
    if (expectedMap.has(key)) continue
    const decision = evaluate(policy, current, 'pull')
    skipped.push({ key, action: null, reason: decision.allowed ? 'absent-not-delete' : decision.reason, source: decision.allowed ? 'protocol' : decision.source })
  }

  const requiresExtraApproval = operations.length >= 5 || resolutions.length > 0
  if (requiresExtraApproval) for (const op of operations) op.risk = 'high'
  const plan = {
    kind, source, sourceRevision: revision, sourceHash, policyHash: policyHash(policy),
    targetBaseline: inventoryHash(expected), localBaseline: inventoryHash(local),
    operations, skipped, conflicts, requiresExtraApproval, resolutions, createdAt: now,
  }
  return { ...plan, planId: id('plan', planContent(plan)) }
}

export const buildPlan = (input) => buildResourcePlan('plugin', input)
export const buildConfigPlan = (input) => buildResourcePlan('config', input)
export const buildMemoryPlan = (input) => buildResourcePlan('memory', input)

export function planContent(plan) {
  const { createdAt, ...content } = plan
  return content
}
