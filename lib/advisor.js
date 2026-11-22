// Suggestion-only advisor. It never writes policy or files; a human adopts a
// suggestion through the explicit adoption API.
import { id } from './protocol.js'
import { defaultPolicy, evaluate } from './policy.js'

// Bundles whose state is bound to one machine (IM accounts, credentials,
// session state) or to a separate sync domain (Lingshu memory) stay local by
// default. Memory data has its own opt-in resource domain; the dsh-memory
// *plugin* itself is still device-bound. Extend this list — or policy.localOnly
// — when another device-bound plugin appears.
const DEVICE_LOCAL = [
  /(?:^|[-@/])(?:dsh-)?im(?:$|[-@/])/i,
  /(?:^|[-@/])(?:dsh-)?memory(?:$|[-@/])/i,
  /lingshu/i,
  /chat|messenger|telegram|whatsapp|feishu|dingtalk|wecom|wechat|slack|discord|matrix/i,
]

export function isDeviceLocal(key) {
  return typeof key === 'string' && DEVICE_LOCAL.some((pattern) => pattern.test(key))
}

// Recommendations are derived from the local plugin inventory and the current
// policy. A model, when enabled, may re-rank the same metadata; it cannot add
// keys that are not in the local inventory.
export function analyzePlugins(records = [], policy = null) {
  const effective = defaultPolicy(policy ?? {})
  const included = new Set(Array.isArray(effective.include) ? effective.include : [])
  const out = []
  for (const record of records) {
    const key = record?.key
    if (typeof key !== 'string' || !key) continue
    if (included.has(key)) continue
    const decision = evaluate(effective, record, 'push')
    let action = 'sync'
    let reason = '已启用的插件，建议一起同步'
    if (decision.reason === 'system-protected') {
      action = 'localOnly'
      reason = '系统插件，保持本机'
    } else if (decision.reason === 'local-only') {
      action = 'localOnly'
      reason = '已标记为只留本机'
    } else if (record.enabled === false) {
      action = 'skip'
      reason = '已停用，先不纳入'
    } else if (isDeviceLocal(key) || isDeviceLocal(record?.source?.package)) {
      action = 'localOnly'
      reason = '设备专属插件（IM / 记忆等），账号或状态绑定本机，先留本机；其设置也不同步'
    }
    out.push({ id: id('sug', { key, action, reason }), key, action, reason, enabled: record.enabled !== false })
  }
  return out
}

export function validateAdopted(suggestions, ids) {
  const wanted = new Set(ids ?? [])
  return suggestions.filter((item) => wanted.has(item.id) && ['sync', 'localOnly', 'skip'].includes(item.action))
}
