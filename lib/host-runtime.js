import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { createAudit } from './audit.js'

export function profileScope(profile, env = process.env) {
  if (!profile || typeof profile.name !== 'string' || !profile.name || typeof profile.dir !== 'string') throw new Error('profile-context-required')
  const home = path.resolve(profile.home || env.DSH_HOME || path.join(os.homedir(), '.dsh'))
  const digest = createHash('sha256').update(JSON.stringify([home, profile.name, path.resolve(profile.dir)])).digest('hex')
  return { name: profile.name, home, digest, dir: path.join(home, 'plugin-sync', digest) }
}
function assertDirectory(dir) {
  const absolute = path.resolve(dir)
  let current = path.parse(absolute).root
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try { fs.mkdirSync(current, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
    if (!fs.lstatSync(current).isDirectory()) throw new Error('unsafe-state-directory')
  }
  fs.chmodSync(absolute, 0o700)
}
function assertFile(file) {
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('unsafe-state-file')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
export function createStore(dir) {
  assertDirectory(dir)
  const file = path.join(dir, 'state.json')
  return {
    read() {
      assertFile(file)
      let fd
      try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
        const stat = fs.fstatSync(fd)
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32 * 1024 * 1024) throw new Error('unsafe-state-file')
        const state = JSON.parse(fs.readFileSync(fd, 'utf8'))
        if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1 || !state.identity || !state.policy || !Array.isArray(state.audit)) throw new Error('invalid-state')
        fs.fchmodSync(fd, 0o600)
        return state
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw new Error('state-read-failed', { cause: error })
      } finally { if (fd !== undefined) fs.closeSync(fd) }
    },
    write(state) {
      assertDirectory(dir); assertFile(file)
      const temp = path.join(dir, `.state-${randomBytes(16).toString('hex')}.tmp`)
      let fd
      try {
        fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
        fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd)
        fs.closeSync(fd); fd = undefined
        assertFile(file); fs.renameSync(temp, file)
      } finally {
        if (fd !== undefined) fs.closeSync(fd)
        try { fs.unlinkSync(temp) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
    },
  }
}
// Host state persists the same bounded audit implementation used by the engine.
export const createHostAudit = createAudit

export function archiveDecisions(scope, records) {
  const dir = path.join(scope.dir, 'archives')
  assertDirectory(dir)
  const archiveId = `proposals-${Date.now()}-${randomBytes(8).toString('hex')}.json`
  const file = path.join(dir, archiveId)
  const body = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), ...records })
  if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error('archive-too-large')
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600)
  try { fs.writeFileSync(fd, body); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  const actual = fs.readFileSync(file, 'utf8')
  if (actual !== body) throw new Error('archive-verification-failed')
  return { archiveId }
}
export function credentialAddress(scope, key) {
  if (typeof key !== 'string' || !key || key.length > 256) throw new Error('invalid-credential-key')
  const digest = createHash('sha256').update(JSON.stringify([scope.digest, key])).digest('hex')
  return `plugin-sync/secret-${digest}`
}
export function createCredentialAdapter(ctx, scope) {
  return {
    async putSecret(key, value) {
      if (typeof value !== 'string' || !value) throw new Error('invalid-credential-value')
      await ctx.get('credentials').modifyRecord(credentialAddress(scope, key), async () => ({ kind: 'api-key', key: value }))
    },
    async getSecret(key) { return (await ctx.get('credentials').readRecord(credentialAddress(scope, key)))?.key ?? null },
    async deleteSecret(key) { await ctx.get('credentials').deleteRecord?.(credentialAddress(scope, key)) },
  }
}
export function unwrap(result, stage) {
  const value = result && typeof result === 'object' && 'ok' in result ? (result.ok ? result.value : null) : result
  if (!value || !['applied', 'restart-required'].includes(value.application) || value.error || value.warnings?.length || (value.packageResult && value.packageResult.exitCode !== 0)) throw new Error(`${stage}-not-applied`)
  return { restartRequired: value.application === 'restart-required', detail: `${stage}:${value.application}` }
}
export class HostError extends Error {
  constructor(code, status = 400) { super(code); this.status = status }
}
export function jsonRequestGate(req, { local = false, protocol = 'http:' } = {}) {
  if (req.method !== 'POST') throw new HostError('post-required', 405)
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')) throw new HostError('json-required', 415)
  if (local) {
    const site = req.headers?.['sec-fetch-site']
    if (site && site !== 'same-origin' && site !== 'none') throw new HostError('same-origin-required', 403)
    const origin = req.headers?.origin
    if (origin) {
      let parsed, expected
      try { parsed = new URL(origin); expected = new URL(`${protocol}//${req.headers?.host}`).origin } catch { throw new HostError('same-origin-required', 403) }
      if (parsed.origin !== expected) throw new HostError('same-origin-required', 403)
    }
  }
}
export async function readBody(req, { maxBytes = 512 * 1024, timeoutMs = 10000 } = {}) {
  const declared = req.headers?.['content-length']
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new HostError('payload-too-large', 413)
  let timer
  const read = async () => {
    const chunks = []; let size = 0
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.length
      if (size > maxBytes) throw new HostError('payload-too-large', 413)
      chunks.push(bytes)
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HostError('invalid-json') }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HostError('invalid-body')
    return body
  }
  try {
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => { req.pause?.(); reject(new HostError('body-timeout', 408)) }, timeoutMs) })])
  } finally { clearTimeout(timer) }
}
export function businessStatus(result) {
  if (result?.error) {
    const code = typeof result.error === 'string' ? result.error : ''
    if (/unauthor|token|invitation|revoked|expired/.test(code)) return 401
    if (/too-large/.test(code)) return 413
    if (/not-found/.test(code)) return 404
    if (/forbidden|denied|permission|suspended|mismatch/.test(code)) return 403
    if (/conflict|stale/.test(code)) return 409
    return 400
  }
  if (result?.ok === false) {
    const reason = typeof result.reason === 'string' ? result.reason : ''
    if (/user-required|permission|denied/.test(reason)) return 403
    if (/not-found/.test(reason)) return 404
    return 409
  }
  if (result?.status === 'offline' || /^http-5\d\d$/.test(result?.status ?? '') || ['network', 'bad-json'].includes(result?.status)) return 502
  if (result?.status === 'invalid-check') return 400
  if (result?.status === 'suspended') return 403
  if (['failed', 'denied', 'conflict', 'stale', 'blocked', 'partial', 'no-snapshot', 'peer-state-unavailable', 'unpaired', 'source-changed'].includes(result?.status)) return 409
  return 200
}
