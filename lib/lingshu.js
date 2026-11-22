// Lingshu (灵枢) cognition-graph adapter.
//
// Read side: the node .md files are Lingshu's only truth source, so a bounded
// filesystem scan is enough and never needs the Python brain.
// Write side: never touch a .md directly. The running brain keeps its index in
// _index.json plus shard logs; a foreign byte write would be invisible until a
// rebuild or split the index from disk. Writes therefore go through
// lib/lingshu-bridge.py (MdCGSecure.add), which keeps node locks, field
// inheritance and the tiered review gate in force.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  hash, LINGSHU_LAYERS, LINGSHU_SENSITIVITY, LINGSHU_NODE_ID, MAX_NODE_BYTES,
} from './protocol.js'

export const MAX_NODES = 256
export const MAX_TOTAL_BYTES = 192 * 1024
export const ENCRYPTED_PREFIX = '<!-- mdcg-enc:v1:'

// Fields that local reads/maintenance rewrite. Comparing or transferring them
// would produce a permanent diff on every device and could resurrect a stale
// access counter, session id or protection flag.
export const VOLATILE_KEYS = new Set([
  // Local bookkeeping rewritten by reads/maintenance (md_cg §2.2 A/B).
  'access_count', 'last_access', 'importance', 'importance_components', 'importance_source',
  'confidence', 'session', 'writer', 'harness', 'freshness',
  'evidence_count', 'positive_evidence', 'negative_evidence', 'evidence_log', 'verified_at',
  'verification_history', 'merge_count', 'merge_sources', 'merge_source_ids', 'consolidation_batch',
  'consolidation_of', 'consistency', 'untrusted', 'untrusted_markers', 'temporal_anchor',
  'expired_at', 'bucket', 'bucket_zh', 'big_domain', 'semantic', 'semantic_oov', 'content_hash',
  'has_neg_conditions', 'postcondition_terms', 'rejection_terms', 'uncertain_refs', 'subgraph',
  // Local-authority fields: never overwritten from another device.
  'protected', 'immutable', 'protection_reason', 'lifecycle_state', 'verification_state',
  // Sensitivity is carried as its own field so a remote copy can never downgrade
  // a local classification by changing the canonical body.
  'sensitivity',
  // Graph edges are rebuilt locally; the bridge preserves the local value.
  'edges',
])
const SENSITIVITY_RANK = { public: 0, internal: 1, restricted: 2, private: 3, secret: 4 }
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*):/

export function expandHome(value, home = os.homedir()) {
  if (typeof value !== 'string' || !value) return null
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(home, value.slice(2))
  return value
}

export function stateRoot({ env = process.env, home = os.homedir() } = {}) {
  if (env.MDCG_STATE_ROOT) return path.resolve(expandHome(env.MDCG_STATE_ROOT, home))
  const dshHome = env.DSH_HOME ? path.resolve(expandHome(env.DSH_HOME, home)) : path.join(home, '.dsh')
  return path.join(dshHome, '.dsh-memory')
}

// Same precedence as @furongjun1999/dsh-memory: env, then paths.json, then the
// plugin config, then <state root>/data/mdcg.
export function resolveMemoryRoot({ env = process.env, home = os.homedir(), configured = null } = {}) {
  const state = stateRoot({ env, home })
  if (env.MDCG_ROOT) return { root: path.resolve(expandHome(env.MDCG_ROOT, home)), source: 'env:MDCG_ROOT' }
  let paths = null
  try { paths = JSON.parse(fs.readFileSync(path.join(state, 'paths.json'), 'utf8')) } catch { paths = null }
  if (paths && typeof paths.root === 'string' && paths.root) {
    const resolved = path.resolve(expandHome(paths.root, home))
    return { root: resolved, source: 'paths.json' }
  }
  if (typeof configured === 'string' && configured.trim()) {
    return { root: path.resolve(expandHome(configured.trim(), home)), source: 'plugin-config' }
  }
  const dataRoot = paths && typeof paths.data_root === 'string' && paths.data_root
    ? path.resolve(expandHome(paths.data_root, home))
    : env.MDCG_DATA_ROOT ? path.resolve(expandHome(env.MDCG_DATA_ROOT, home)) : path.join(state, 'data')
  return { root: path.join(dataRoot, 'mdcg'), source: 'default' }
}

export function splitFrontMatter(text) {
  if (typeof text !== 'string') return null
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return null
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) return null
  return { head: normalized.slice(4, end), body: normalized.slice(end + 5) }
}

function keyBlocks(head) {
  const blocks = []
  for (const line of head.split('\n')) {
    if (!blocks.length || KEY_LINE.test(line)) blocks.push([line])
    else blocks[blocks.length - 1].push(line)
  }
  return blocks
}

function blockKey(block) { return KEY_LINE.exec(block[0] ?? '')?.[1] ?? null }

function scalar(field, head) {
  const pattern = new RegExp(`^${field}:[ \\t]*"?([^"\\n]*)"?[ \\t]*$`, 'm')
  return pattern.exec(head)?.[1]?.trim() ?? null
}

// condition_space carries semantic conditions plus a rolling time_window that
// every write recomputes. Drop only the window so the rest stays comparable.
function canonConditionSpace(block) {
  const value = block[0].slice(block[0].indexOf(':') + 1).trim()
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const { time_window: _window, ...rest } = parsed
    const keys = Object.keys(rest).sort()
    return [`condition_space: ${JSON.stringify(Object.fromEntries(keys.map((key) => [key, rest[key]])))}`]
  } catch {
    return null
  }
}

// Canonical form used for hashing and for cross-device comparison. Formatting of
// kept fields is preserved byte for byte so both devices agree without a YAML
// dependency on the JavaScript side.
export function canonicalNode(text, { id = null, filename = null } = {}) {
  const parts = splitFrontMatter(text)
  if (!parts) return { ok: false, reason: 'bad-front-matter' }
  const nodeId = id ?? filename?.replace(/\.md$/i, '') ?? scalar('id', parts.head)
  if (!nodeId || !LINGSHU_NODE_ID.test(nodeId) || nodeId.includes('..')) return { ok: false, reason: 'bad-node-id' }
  if (parts.body.includes(ENCRYPTED_PREFIX)) return { ok: false, reason: 'encrypted' }
  const layer = scalar('layer', parts.head)
  if (!LINGSHU_LAYERS.includes(layer)) return { ok: false, reason: 'bad-layer' }
  const sensitivity = scalar('sensitivity', parts.head) ?? 'internal'
  if (!LINGSHU_SENSITIVITY.includes(sensitivity)) return { ok: false, reason: 'bad-sensitivity' }
  const kept = []
  for (const block of keyBlocks(parts.head)) {
    const key = blockKey(block)
    if (!key || VOLATILE_KEYS.has(key) || key === 'id' || key === 'layer') continue
    if (key === 'condition_space') {
      const canonical = canonConditionSpace(block)
      if (canonical) kept.push(...canonical)
      continue
    }
    kept.push(...block)
  }
  const trimmed = parts.body.replace(/\s+$/, '')
  if (!trimmed) return { ok: false, reason: 'empty-body' }
  const head = kept.join('\n')
  const body = `${trimmed}\n`
  const content = `---\n${head}${head ? '\n' : ''}---\n${body}`
  const title = body.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0, 160) ?? nodeId
  return { ok: true, id: nodeId, layer, sensitivity, content, title }
}

export function nodeRecord(canonical) {
  const record = {
    kind: 'lingshuNode', key: canonical.id, layer: canonical.layer,
    content: canonical.content, sensitivity: canonical.sensitivity, title: canonical.title,
  }
  return { ...record, contentHash: hash({ layer: record.layer, content: record.content }) }
}

function readRegularFile(file, maxBytes) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('not-a-regular-file')
    if (stat.size > maxBytes) throw new Error('file-too-large')
    return fs.readFileSync(fd, 'utf8')
  } finally { fs.closeSync(fd) }
}

function walkLayer(root, relative, out, depth = 0) {
  if (out.length >= MAX_NODES || depth > 3) return out
  let entries
  try { entries = fs.readdirSync(path.join(root, ...relative.split('/')), { withFileTypes: true }) } catch { return out }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_NODES) break
    if (entry.isSymbolicLink()) continue
    const child = `${relative}/${entry.name}`
    if (entry.isDirectory()) walkLayer(root, child, out, depth + 1)
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child)
  }
  return out
}

// Lingshu's own write-gate patterns live in <data>/policy.json. Reusing them
// here means memory egress cannot undercut the local admission rules.
export function loadForbiddenPatterns(root) {
  const file = path.join(path.dirname(root), 'policy.json')
  try {
    const stat = fs.statSync(file)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(parsed?.forbidden)) return { patterns: [], file, mtime: stat.mtimeMs }
    const patterns = parsed.forbidden.flatMap((source) => {
      try { return [{ source, re: new RegExp(source) }] } catch { return [] }
    })
    return { patterns, file, mtime: stat.mtimeMs }
  } catch { return { patterns: [], file, mtime: 0 } }
}

function sensitivityAllowed(record, maxSensitivity) {
  const max = SENSITIVITY_RANK[maxSensitivity] ?? SENSITIVITY_RANK.internal
  return (SENSITIVITY_RANK[record.sensitivity] ?? 99) <= max
}

export function collectLingshu({ root, layers = LINGSHU_LAYERS, maxSensitivity = 'internal', budgetBytes = MAX_TOTAL_BYTES, forbidden = null } = {}) {
  const records = [], skipped = []
  if (!root) return { records, skipped: [{ key: '*', reason: 'lingshu-root-unavailable' }] }
  let realRoot
  try { realRoot = fs.realpathSync(root) } catch { return { records, skipped: [{ key: '*', reason: 'lingshu-root-unavailable' }] } }
  const patterns = forbidden ?? loadForbiddenPatterns(root).patterns
  let total = 0
  for (const layer of LINGSHU_LAYERS) {
    if (!layers.includes(layer)) continue
    const files = walkLayer(realRoot, layer, [])
    for (const relative of files) {
      if (total >= budgetBytes) { skipped.push({ key: relative, reason: 'memory-budget-exceeded' }); continue }
      const absolute = path.join(realRoot, ...relative.split('/'))
      const resolved = path.resolve(absolute)
      if (!resolved.startsWith(realRoot + path.sep)) { skipped.push({ key: relative, reason: 'path-escape' }); continue }
      let text
      try { text = readRegularFile(resolved, MAX_NODE_BYTES) } catch (error) {
        skipped.push({ key: relative, reason: error.message === 'file-too-large' ? 'file-too-large' : 'unreadable' })
        continue
      }
      const canonical = canonicalNode(text, { filename: path.basename(relative) })
      if (!canonical.ok) { skipped.push({ key: relative, reason: canonical.reason }); continue }
      if (canonical.layer !== layer) { skipped.push({ key: relative, reason: 'layer-mismatch' }); continue }
      if (!sensitivityAllowed(canonical, maxSensitivity)) { skipped.push({ key: relative, reason: 'memory-sensitivity-above-policy' }); continue }
      if (patterns.some(({ re }) => re.test(canonical.content))) { skipped.push({ key: relative, reason: 'secret-pattern' }); continue }
      const bytes = Buffer.byteLength(canonical.content, 'utf8')
      if (total + bytes > budgetBytes) { skipped.push({ key: relative, reason: 'memory-budget-exceeded' }); continue }
      total += bytes
      records.push(nodeRecord(canonical))
    }
  }
  return { records, skipped }
}

// Metadata for the settings panel: counts per layer and per-node keys, never the
// node body.
export function lingshuCatalogue({ root, layers = LINGSHU_LAYERS, maxSensitivity = 'internal' } = {}) {
  const collected = collectLingshu({ root, layers, maxSensitivity })
  const byLayer = new Map(LINGSHU_LAYERS.map((layer) => [layer, { layer, total: 0, eligible: 0, nodes: [] }]))
  let size = 0
  for (const record of collected.records) {
    const bytes = Buffer.byteLength(record.content, 'utf8')
    size += bytes
    const entry = byLayer.get(record.layer)
    entry.eligible += 1
    if (entry.nodes.length < 200) entry.nodes.push({ key: record.key, layer: record.layer, size: bytes, title: record.title, sensitivity: record.sensitivity })
  }
  return {
    available: Boolean(root),
    root: root ?? null,
    layers: [...byLayer.values()],
    skipped: collected.skipped.slice(0, 50),
    eligibleBytes: size,
  }
}

function bridgePath() { return fileURLToPath(new URL('./lingshu-bridge.py', import.meta.url)) }

export function packageCandidates({ profileDir = null, env = process.env, home = os.homedir() } = {}) {
  const out = []
  if (env.MDCG_PACKAGE_PATH) out.push(env.MDCG_PACKAGE_PATH)
  if (profileDir) out.push(path.join(profileDir, 'node_modules', '@furongjun1999', 'dsh-memory'))
  const dshHome = env.DSH_HOME ? path.resolve(expandHome(env.DSH_HOME, home)) : path.join(home, '.dsh')
  try {
    for (const name of fs.readdirSync(path.join(dshHome, 'profiles')).sort()) {
      out.push(path.join(dshHome, 'profiles', name, 'node_modules', '@furongjun1999', 'dsh-memory'))
    }
  } catch { /* no profiles directory */ }
  return out
}

// The front matter is re-parsed by the bridge with YAML, so only whole key
// blocks that survived canonicalization are sent. id/layer travel separately.
export function fieldsFromContent(content) {
  const parts = splitFrontMatter(content)
  if (!parts) return {}
  return { frontMatter: parts.head, body: parts.body }
}

export function resolveBridge({ python = null, packagePath = null, profileDir = null, env = process.env } = {}) {
  if (packagePath && fs.existsSync(path.join(packagePath, 'md_cg', 'mdcos.py'))) {
    return { packagePath, python: python || env.MDCG_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), bridge: bridgePath() }
  }
  for (const candidate of packageCandidates({ profileDir, env })) {
    try {
      if (candidate && fs.existsSync(path.join(candidate, 'md_cg', 'mdcos.py'))) {
        return { packagePath: candidate, python: python || env.MDCG_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), bridge: bridgePath() }
      }
    } catch { /* keep looking */ }
  }
  return null
}

function classifyBridgeError(error) {
  const text = String(error ?? '')
  if (text.includes('复核') || /write.?gate/i.test(text)) return 'write-gate-requires-review'
  if (/AccessDenied|PermissionError|无权/.test(text)) return 'lingshu-write-denied'
  return 'lingshu-write-failed'
}

function runBridge({ bridge, python, job, timeoutMs }) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(python, [bridge], { stdio: ['pipe', 'pipe', 'pipe'], env: job.env, windowsHide: true })
    } catch (error) {
      resolve({ ok: false, error: 'lingshu-bridge-unavailable', detail: String(error?.message ?? error).slice(0, 300) })
      return
    }
    let stdout = '', stderr = '', settled = false
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value) } }
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* already gone */ } finish({ ok: false, error: 'lingshu-bridge-timeout' }) }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk; if (stdout.length > 4 * 1024 * 1024) finish({ ok: false, error: 'lingshu-bridge-output-too-large' }) })
    child.stderr.on('data', (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk })
    child.on('error', (error) => finish({ ok: false, error: 'lingshu-bridge-unavailable', detail: String(error?.message ?? error).slice(0, 300) }))
    child.on('close', (code) => {
      const line = stdout.split('\n').filter((item) => item.startsWith('RESULT_JSON:')).pop()
      if (!line) {
        finish({ ok: false, error: code === 0 ? 'lingshu-bridge-bad-output' : classifyBridgeError(stderr), detail: stderr.slice(0, 400) })
        return
      }
      let parsed
      try { parsed = JSON.parse(line.slice('RESULT_JSON:'.length)) } catch {
        finish({ ok: false, error: 'lingshu-bridge-bad-output', detail: stderr.slice(0, 400) })
        return
      }
      finish({ ok: parsed.ok !== false, ...parsed, stderr: parsed.ok === false ? stderr.slice(0, 400) : undefined })
    })
    child.stdin.on('error', () => { /* the close handler reports the failure */ })
    child.stdin.end(`${JSON.stringify(job.payload)}\n`)
  })
}

// One Python process per apply batch: index load dominates, so nodes are
// batched. Each write is verified by re-reading the canonical file.
export async function writeLingshu({ root, nodes, bridge, writeGate = 'inherit', clearance = 'internal', timeoutMs = 120000, env = process.env } = {}) {
  if (!Array.isArray(nodes) || !nodes.length) return { ok: true, results: [] }
  if (!bridge) return { ok: false, error: 'lingshu-bridge-unavailable', results: nodes.map((node) => ({ key: node.key, ok: false, error: 'lingshu-bridge-unavailable' })) }
  const operations = nodes.map((node) => {
    const fields = fieldsFromContent(node.content)
    return { id: node.key, layer: node.layer, sensitivity: node.sensitivity, body: fields.body ?? '', frontMatter: fields.frontMatter ?? '' }
  })
  const payload = {
    root, packagePath: bridge.packagePath, actor: 'plugin-sync', clearance,
    operations,
  }
  const childEnv = { ...env, MDCG_ROOT: root, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
  if (writeGate === 'warn') childEnv.MDCG_WRITE_GATE = 'warn'
  const outcome = await runBridge({ bridge: bridge.bridge, python: bridge.python, job: { payload, env: childEnv }, timeoutMs })
  if (outcome.ok === false && !Array.isArray(outcome.results)) {
    return { ok: false, error: outcome.error, detail: outcome.detail, results: nodes.map((node) => ({ key: node.key, ok: false, error: outcome.error })) }
  }
  const byKey = new Map((outcome.results ?? []).map((item) => [item.key, item]))
  const results = []
  for (const node of nodes) {
    const item = byKey.get(node.key)
    if (!item || item.ok === false) {
      results.push({ key: node.key, ok: false, error: item?.error ?? 'lingshu-write-failed', detail: item?.detail })
      continue
    }
    // Verify on disk: the store must hold exactly the canonical content we sent.
    let verified = false
    try {
      const file = path.join(root, node.layer, `${node.key}.md`)
      verified = canonicalNode(readRegularFile(file, MAX_NODE_BYTES), { filename: `${node.key}.md` }).content === node.content
    } catch { verified = false }
    results.push(verified ? { key: node.key, ok: true } : { key: node.key, ok: false, error: 'lingshu-verify-failed' })
  }
  return { ok: results.every((item) => item.ok), results }
}
