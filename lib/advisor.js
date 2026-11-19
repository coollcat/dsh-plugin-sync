// Suggestion-only advisor. It never writes memory, policy or files; a human
// adopts a suggestion through the explicit adoption API.

import { id } from './protocol.js'

const LOCAL_MARKERS = /(machine|device|host|hostname|private|secret|token|credential|local|本机|设备|密钥|私有)/i
const IDENTITY_ADAPTERS = new Set(['persona', 'soul'])

function snippet(content) {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

export function analyzeMemory(records = [], options = {}) {
  return records.map((record) => {
    const key = record.key
    const path = `${record.adapterId}:${record.relativePath}`
    let action = 'sync'
    let reason = '普通记忆文件，可同步'
    if (IDENTITY_ADAPTERS.has(record.adapterId)) {
      action = 'localOnly'
      reason = '人格/规则文件默认仅本机，需人工确认后才可同步'
    } else if (LOCAL_MARKERS.test(path)) {
      action = 'localOnly'
      reason = '路径含设备或私密标记，建议保留在本机'
    } else if (LOCAL_MARKERS.test(snippet(record.content))) {
      action = 'localOnly'
      reason = '正文含设备或私密信息，建议保留在本机'
    } else if (String(record.content ?? '').length === 0) {
      action = 'skip'
      reason = '空文件，无需同步'
    }
    return {
      id: id('sug', { key, action, reason }),
      key,
      adapterId: record.adapterId,
      relativePath: record.relativePath,
      action,
      reason,
      snippet: snippet(record.content),
    }
  })
}

export function validateAdopted(suggestions, ids) {
  const wanted = new Set(ids ?? [])
  return suggestions.filter((item) => wanted.has(item.id) && ['sync', 'localOnly', 'skip'].includes(item.action))
}
