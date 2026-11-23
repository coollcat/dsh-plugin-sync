// Host half of the device sync plugin. All mutations go through the engine;
// this file only adapts DSH services and exposes HTTP routes.

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import { spawn } from 'node:child_process'

import { createEngine, PUBLIC_ERRORS } from './lib/engine.js'
import { configRecord, projectConfig, mergeConfigFields, configHash, validFieldPath, isSecretKey, MIN_CONFIG_FIELDS } from './lib/config.js'
import { hash, validateIdentity, validateChangeset, validateLingshuRecord, resourceHash, LINGSHU_LAYERS } from './lib/protocol.js'
import { bearerFrom } from './lib/transport.js'
import { profileScope, createStore, createHostAudit, createCredentialAdapter, archiveDecisions, unwrap, HostError, jsonRequestGate, readBody, businessStatus } from './lib/host-runtime.js'
import { collectLingshu, lingshuCatalogue, resolveMemoryRoot, resolveBridge, canonicalNode, writeLingshu } from './lib/lingshu.js'
// Merged in from the standalone `lingshu-mute` plugin (2026-11-21). Its apply()
// installs the lingshu write gate, the /plugins/lingshu-mute HTTP surface and the
// /mute command. All of it is effect-scoped to this plugin's ctx, so disposal on
// recomposition tears the routes/hooks down with the sync plugin.
import { apply as applyLingshuMute } from './lib/mute/index.js'

export const inject = ['pluginManager', 'configEditor', 'webServer', 'credentials', 'connection', 'tools', 'profileContext']

const PLUGIN_NAME = '@local/dsh-plugin-sync'
const ROUTE_PREFIX = '/plugin-sync'
// Local link:/file: bundles are reproducible on their own device only: the
// absolute path differs per machine, so a cross-device install would be wrong.
// Represent them as a content-addressed file source (name + sha256 of the
// bundle identity) so they join the inventory for enable/disable and config
// sync, but the planner still refuses cross-device install (source-not-supported).
// Never transmit the local filesystem path.
function parseSource(bundle) {
  const version = bundle.version
  const source = bundle.source ?? ''
  if (/^\d+\.\d+\.\d+/.test(version ?? '') && (!source || source === bundle.name || source.startsWith(`${bundle.name}@`))) {
    return { type: 'registry', package: bundle.name, version }
  }
  const match = /(?:^|[#/])([0-9a-f]{40})(?:$|[^0-9a-f])/.exec(source)
  if (match && bundle.update === 'git') {
    return { type: 'git', url: source.replace(/#[0-9a-f]{40}.*$/, ''), commit: match[1] }
  }
  if (/^(?:link|file):/i.test(source)) {
    // name must be a basename without separators (protocol.js file source rules).
    const name = String(bundle.name).split(/[\\/]/).filter(Boolean).pop() ?? ''
    if (!name || name.length > 300 || name.includes('\\')) return null
    return { type: 'file', name, sha256: hash({ local: bundle.name, version: version ?? null }) }
  }
  return null
}

export function createInventoryAdapter(ctx, scope) {
  const profileName = scope.name
  return {
    profileId: profileName ?? 'unknown',
    label: profileName ?? 'Unnamed profile',
    async collectInventory() {
      const manager = ctx.get('pluginManager')
      if (!manager) throw new Error('plugin-manager-service-unavailable')
      const bundles = await manager.listBundles()
      const value = bundles?.ok ? bundles.value : bundles
      if (!Array.isArray(value)) throw new Error('bundle-list-unavailable')
      const records = []
      for (const bundle of value) {
        if (!bundle.installed || bundle.official || bundle.name.startsWith('@deepseek-ai/') || bundle.name === PLUGIN_NAME) continue
        const source = parseSource(bundle)
        if (!source) continue
        const enabled = Boolean(bundle.enabled)
        records.push({
          key: bundle.name,
          kind: 'plugin',
          enabled,
          source,
          contentHash: hash({ name: bundle.name, source, enabled }),
        })
      }
      return records
    },
    async install(payload) {
      if (payload?.type !== 'registry') throw new Error('only-registry-install-is-supported')
      const result = await ctx.get('pluginManager').installBundle(`${payload.package}@${payload.version}`, { enabled: false, saveExact: true, expected: { name: payload.package, version: payload.version } })
      return unwrap(result, 'install')
    },
    async upgrade(payload) {
      if (payload?.type !== 'registry') throw new Error('only-registry-upgrade-is-supported')
      const result = await ctx.get('pluginManager').updateBundle(payload.package, payload.version, {})
      const update = result && 'ok' in result ? (result.ok ? result.value : null) : result
      if (!update || update.step !== 'install' || update.restore) throw new Error('upgrade-not-applied')
      return unwrap(update.result, 'upgrade')
    },
    async setEnabled(name, enabled) {
      const result = await ctx.get('pluginManager').setBundleEnabled(name, enabled)
      return unwrap(result, enabled ? 'enable' : 'disable')
    },
    async collectConfig() {
      const editor = ctx.get('configEditor')
      if (!editor) return []
      const bundles = await bundleInventory(ctx)
      const rows = addressableConfigRows(editor, bundles)
      return rows.map(({ entry, bundle }) => configRecord({ entryId: entry.options.id, bundle, config: entry.options.config ?? {} }))
    },
    async writeConfig({ entryId, bundle, config, fields, expectedHash }) {
      const editor = ctx.get('configEditor')
      if (!editor) throw new Error('config-editor-service-unavailable')
      const bundles = await bundleInventory(ctx)
      const validate = () => {
        const rows = addressableConfigRows(editor, bundles).filter(({ entry }) => entry.options.id === entryId)
        if (rows.length !== 1) throw new Error('config-entry-not-addressable')
        if (!bundle || rows[0].bundle !== bundle) throw new Error('config-bundle-mismatch')
        return rows[0].entry
      }
      const entry = validate()
      await editor.edit(entry, current => {
        if (validate() !== entry) throw new Error('config-entry-changed')
        const projectedCurrent = projectConfig(current, fields)
        if ((expectedHash === null && Object.keys(projectedCurrent).length > 0) || (expectedHash !== undefined && expectedHash !== null && configHash(projectedCurrent) !== expectedHash)) throw new Error('config-baseline-changed')
        return mergeConfigFields(current, config, fields)
      })
      return { restartRequired: true, detail: 'configSet:saved' }
    },
  }
}

// Lingshu memory adapter. Reads are bounded filesystem scans (the node .md files
// are Lingshu's only truth source). Writes always go through the Python brain so
// node locks, field inheritance and the tiered review gate stay authoritative —
// a raw byte write would be invisible to the running process until a rebuild.
const MEMORY_LAYERS = LINGSHU_LAYERS.filter((layer) => !['self', 'anchor'].includes(layer))

export function createLingshuAdapter(ctx, config = {}, getPolicy = () => null) {
  const memory = resolveMemoryRoot({ configured: config.root ?? null })
  const bridge = resolveBridge({
    python: config.python ?? null, packagePath: config.packagePath ?? null,
    profileDir: ctx.get('profileContext')?.dir ?? null,
  })
  const settings = () => {
    const lingshu = getPolicy()?.lingshu ?? {}
    const layers = Array.isArray(lingshu.layers)
      ? lingshu.layers.filter((layer) => MEMORY_LAYERS.includes(layer))
      : MEMORY_LAYERS.slice(0, 3)
    return { layers, maxSensitivity: lingshu.maxSensitivity ?? 'internal' }
  }
  const status = () => ({
    root: memory.root, source: memory.source, bridge: Boolean(bridge),
    python: bridge?.python ?? null, packagePath: bridge?.packagePath ?? null,
    writable: Boolean(bridge), scopeLayers: settings().layers, maxSensitivity: settings().maxSensitivity,
  })
  const adapter = {
    lingshuStatus: status,
    async collectLingshu() {
      const { layers, maxSensitivity } = settings()
      return collectLingshu({ root: memory.root, layers, maxSensitivity }).records
    },
    async lingshuCatalogue() {
      const { layers, maxSensitivity } = settings()
      return { ...status(), ...lingshuCatalogue({ root: memory.root, layers, maxSensitivity }) }
    },
    async writeLingshu(payload) {
      if (!bridge) return { ok: false, reason: 'memory-bridge-unavailable' }
      const record = { kind: 'lingshuNode', key: payload?.key, layer: payload?.layer, content: payload?.content, sensitivity: payload?.sensitivity, title: '' }
      let contentHash
      try { contentHash = resourceHash(record) } catch { return { ok: false, reason: 'memory-write-failed' } }
      record.contentHash = contentHash
      if (validateLingshuRecord(record).length) return { ok: false, reason: 'memory-write-failed' }
      // The engine checked the baseline before dispatch; re-read inside the
      // adapter so a write that raced another writer cannot overwrite it.
      let currentHash = null
      const file = path.join(memory.root, record.layer, `${record.key}.md`)
      try {
        const canonical = canonicalNode(fs.readFileSync(file, 'utf8'), { filename: `${record.key}.md` })
        if (!canonical.ok) return { ok: false, reason: 'memory-write-failed', detail: 'unreadable-local-node' }
        currentHash = resourceHash({ ...record, content: canonical.content, sensitivity: canonical.sensitivity })
      } catch (error) {
        if (error.code !== 'ENOENT') return { ok: false, reason: 'memory-write-failed', detail: 'unreadable-local-node' }
        currentHash = null
      }
      if ((payload?.expectedHash ?? null) !== currentHash) return { ok: false, reason: 'memory-write-failed', detail: 'baseline-changed' }
      const outcome = await writeLingshu({ root: memory.root, nodes: [record], bridge, writeGate: config.writeGate ?? 'inherit', clearance: getPolicy()?.lingshu?.maxSensitivity ?? 'internal' })
      const first = outcome?.results?.[0]
      if (!outcome?.ok || first?.ok === false) {
        const code = first?.error ?? outcome?.error ?? 'lingshu-write-failed'
        if (code === 'write-gate-requires-review') return { ok: false, reason: 'memory-needs-review' }
        if (code === 'lingshu-bridge-unavailable') return { ok: false, reason: 'memory-bridge-unavailable' }
        return { ok: false, reason: 'memory-write-failed', detail: String(code).slice(0, 120) }
      }
      return { restartRequired: false, detail: 'memoryWrite:applied' }
    },
  }
  return adapter
}

// FiberState.ACTIVE is 2 in the installed Cordis contract. Entries without an
// active Fiber cannot be edited by configEditor.edit and never leave the host.
async function bundleInventory(ctx) {
  const result = await ctx.get('pluginManager').listBundles()
  const bundles = result && 'ok' in result ? (result.ok ? result.value : null) : result
  if (!Array.isArray(bundles)) throw new Error('bundle-list-unavailable')
  return bundles
}
function addressableConfigRows(editor, bundles) {
  const rows = editor.configuration()
  const counts = new Map()
  for (const { entry } of rows) counts.set(entry.options?.id, (counts.get(entry.options?.id) ?? 0) + 1)
  return rows.flatMap(({ entry }) => {
    const { id, name, config, disabled } = entry.options ?? {}
    const active = typeof id === 'string' && id && counts.get(id) === 1 && typeof name === 'string'
      && !name.startsWith('@deepseek-ai/') && name !== PLUGIN_NAME
      && !disabled && !entry.disabled && entry.fiber?.state === 2
      && (config == null || (typeof config === 'object' && !Array.isArray(config)))
    if (!active) return []
    const owners = bundles.filter(bundle => bundle.rows?.some(row => row.rowId === id && row.moduleName === name))
    if (owners.length !== 1) return []
    const owner = owners[0]
    if (!owner.installed || !owner.enabled || owner.official || owner.name.startsWith('@deepseek-ai/') || owner.name === PLUGIN_NAME || owner.error) return []
    return [{ entry, bundle: owner.name }]
  })
}

export async function resourceCatalogue(adapters) {
  const paths = (value, prefix = [], output = []) => {
    if (output.length >= 256 || prefix.length > 20) return output
    if (value !== null && typeof value === 'object' && Object.keys(value).length) {
      for (const [key, item] of Object.entries(value)) {
        if (!isSecretKey(key) && validFieldPath([...prefix, key])) paths(item, [...prefix, key], output)
      }
    } else if (prefix.length) output.push(prefix)
    return output
  }
  const plugins = (await adapters.collectInventory()).map(({ key, enabled }) => ({ key, enabled }))
  const configs = (await adapters.collectConfig()).map(({ key, entryId, bundle, config }) => {
    const fields = paths(config)
    return { key, entryId, bundle, fields, eligible: fields.length >= MIN_CONFIG_FIELDS }
  })
  let lingshu = null
  try { lingshu = adapters.lingshuCatalogue ? await adapters.lingshuCatalogue() : null } catch { lingshu = null }
  return { plugins, configs, lingshu }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  if (status === 408 || status === 413) res.setHeader('connection', 'close')
  res.end(JSON.stringify(payload))
}

// The device-sync wire protocol lives on its own listener, away from the Web
// GUI port. Nothing is served there until /hello completes a token handshake;
// state and proposal queries are authorized against that paired peer.
export function syncServerConfig(config = {}, fallbackHost = '127.0.0.1') {
  const port = Number.isInteger(config.syncPort) ? config.syncPort : 3081
  // 0 requests an OS-assigned port, used by the HTTP harness.
  if (port < 0 || port > 65535) throw new Error('invalid-sync-port')
  const host = typeof config.syncHost === 'string' && config.syncHost ? config.syncHost : fallbackHost
  if (!/^[A-Za-z0-9.:\[\]]{1,253}$/.test(host)) throw new Error('invalid-sync-host')
  return { host, port }
}

// Only closed, known codes cross the HTTP boundary. Provider messages and raw
// exceptions can carry paths or credentials, so everything else is generic;
// the browser maps these codes to readable text in both locales.
export function publicErrorCode(error) {
  if (error instanceof HostError) return error.message
  const code = error?.code ?? error?.message ?? error
  if (typeof code === 'string' && (PUBLIC_ERRORS.has(code) || /^http-[1-5]\d{2}$/.test(code))) return code
  return 'request-failed'
}

function runDialog(command, args) {
  return new Promise((resolve, reject) => {
    let child
    try { child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { reject(new HostError('pick-file-unavailable')); return }
    const out = []
    let size = 0
    let settled = false
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill('SIGKILL'); reject(new HostError('pick-file-failed')) } }, 60000)
    child.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > 8192) { if (!settled) { settled = true; child.kill('SIGKILL'); reject(new HostError('pick-file-failed')) } }
      else out.push(chunk)
    })
    child.stderr.on('data', () => {})
    child.on('error', () => { if (!settled) { settled = true; clearTimeout(timer); reject(new HostError('pick-file-unavailable')) } })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) { reject(new HostError('pick-file-failed')); return }
      const value = Buffer.concat(out).toString('utf8').split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
      resolve(value || null)
    })
  })
}

// Host-side OS file dialog: browsers cannot expose an absolute local path,
// so the button asks the host that runs the Web GUI to choose one.
export async function pickKeyFilePath() {
  let value
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.OpenFileDialog',
      '$d.Title = "Select SSH private key"',
      '$d.Filter = "All files|*.*"',
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output -NoEnumerate $d.FileName }',
    ].join('; ')
    value = await runDialog('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script])
  } else if (process.platform === 'darwin') {
    value = await runDialog('osascript', ['-e', 'POSIX path of (choose file)'])
  } else {
    value = await runDialog('zenity', ['--file-selection', '--title=Select SSH private key'])
  }
  if (value === null) return null
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\r\n\0]/.test(value) ||
      !(path.isAbsolute(value) || /^[~]/.test(value))) throw new HostError('pick-file-failed')
  return value
}

export function apply(ctx, config) {
  // Merged lingshu-mute host. Its write gate must be installed as early as possible;
  // every hook/route it registers is effect-scoped to this plugin's fiber. Failures
  // are contained so sync stays healthy even if lingshu is absent or upgraded.
  try {
    applyLingshuMute(ctx, config ?? {})
  } catch (error) {
    ctx.logger?.warn?.('device-sync: merged lingshu-mute host failed to initialise', error)
  }
  const scope = profileScope(ctx.get('profileContext'))
  const store = createStore(scope.dir)
  const loaded = store.read()
  const audit = createHostAudit()
  audit.replaceLoaded(loaded?.audit ?? [])
  let engine = null
  const adapters = {
    ...createInventoryAdapter(ctx, scope),
    ...createCredentialAdapter(ctx, scope),
    ...createLingshuAdapter(ctx, config?.lingshu ?? {}, () => engine?.publicState().policy ?? null),
    archiveDecisions: records => archiveDecisions(scope, records),
  }
  engine = createEngine({ store, adapters, audit })
  engine.publicState()

  const syncServer = syncServerConfig(config, ctx.get('webServer')?.host)

  const localAction = async (name, args) => {
    args = { ...args, actor: 'user' }
    switch (name) {
      case 'state': return { ...engine.publicState(), syncPort: syncServer.port }
      case 'pickFile': return { path: await pickKeyFilePath() }
      case 'inventory': return resourceCatalogue(adapters)
      case 'archiveDecisions': return engine.archiveDecisions({ actor: 'user' })
      case 'connectPeer': return engine.connectPeer(args)
      case 'publishLocal': return engine.publishLocal({ kind: args.kind ?? 'plugin', actor: 'user' })
      case 'revokePeer': return engine.revokePeer({ deviceId: args.deviceId, actor: 'user' })
      case 'rejectProposal': return engine.rejectProposal({ proposalId: args.proposalId, actor: 'user' })
      case 'resolvePlanConflict': return engine.resolvePlanConflict({ planId: args.planId, key: args.key, choice: args.choice, actor: 'user' })
      case 'pairCenter': return engine.pairCenter(args)
      case 'joinCenter': return engine.joinCenter(args)
      case 'verify': return engine.verifyInvitation(args)
      case 'reset': return engine.resetSync()
      case 'invite': return engine.createInvitation()
      case 'policy': return engine.setPolicy(args.policy)
      case 'check': return engine.check({ kind: args.kind ?? 'plugin', source: args.source ?? 'live' })
      case 'autoSync': return engine.autoSync()
      case 'approve': return engine.approve(args)
      case 'apply': return engine.apply(args)
      case 'suspend': return engine.suspend(args.value)
      case 'proposal': return engine.submitProposal({ kind: args.kind ?? 'plugin' })
      case 'snapshot': return engine.createSnapshot()
      case 'loadSnapshot': return engine.loadSnapshot(args.text)
      case 'suggest': return engine.suggest()
      case 'adopt': return engine.adoptSuggestions({ ids: args.ids, actor: 'user' })
      case 'acceptProposal': return engine.handleAcceptProposal({ proposalId: args.proposalId, actor: 'user', installLocally: args.installLocally === true })
      case 'acceptAndInstall': return engine.acceptAndInstall({ proposalId: args.proposalId, actor: 'user' })
      case 'resolveConflict': return engine.resolveConflict({ conflictId: args.conflictId, choice: args.choice, actor: 'user' })
      case 'proposals': return engine.handleListProposals()
      default: throw new Error(`unknown-action:${name}`)
    }
  }

  const errorResponse = (res, error) => sendJson(
    res, error instanceof HostError ? error.status : 400, { error: publicErrorCode(error) })

  // Web GUI listener: same-origin browser actions only.
  const localHandler = async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      if ([`${ROUTE_PREFIX}/api/action`, `${ROUTE_PREFIX}/api/state`].includes(pathname)) {
        const connection = ctx.get('connection')
        if (!connection) return sendJson(res, 403, { error: 'local-access-required' })
        const rejection = connection.requestRejection(req)
        if (rejection) return sendJson(res, rejection, { error: 'local-access-required' })
        jsonRequestGate(req, { local: true, protocol: ctx.get('webServer')?.protocol ?? 'http:' })
        const body = await readBody(req)
        if (typeof body.action !== 'string' || !body.action) throw new HostError('action-required')
        const result = await localAction(body.action, body)
        const status = businessStatus(result)
        return sendJson(res, status, { ok: status === 200, value: result ?? null })
      }
      return sendJson(res, 404, { error: 'not-found' })
    } catch (error) {
      return errorResponse(res, error)
    }
  }

  // Dedicated sync listener: three routes, all token-gated. `/hello` is the
  // handshake; state and proposal routes are refused until that peer is paired.
  const remoteHandler = async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      if (![`${ROUTE_PREFIX}/hello`, `${ROUTE_PREFIX}/state`, `${ROUTE_PREFIX}/proposals`].includes(pathname)) {
        return sendJson(res, 404, { error: 'not-found' })
      }
      jsonRequestGate(req)
      const token = bearerFrom(req.headers?.authorization)
      if (typeof token !== 'string' || !token) return sendJson(res, 401, { error: 'unauthorized' })
      const body = await readBody(req)
      validateRemoteBody(pathname, body)
      let result
      if (pathname === `${ROUTE_PREFIX}/hello`) result = await engine.handleHello({ token, identity: body.identity })
      else if (pathname === `${ROUTE_PREFIX}/state`) result = await engine.handleGetState({ token, deviceId: body.deviceId, offer: body.offer, acknowledgedOffers: body.acknowledgedOffers })
      else result = await engine.handleSubmitProposal({ token, identity: body.identity, changeset: body.changeset })
      return sendJson(res, businessStatus(result), result)
    } catch (error) {
      return errorResponse(res, error)
    }
  }

  const webServer = ctx.get('webServer')
  if (!webServer) throw new Error('webServer service is required for device sync')
  ctx.effect(() => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: localHandler }), 'device-sync: local routes')

  const server = http.createServer(remoteHandler)
  server.on('error', (error) => ctx.logger?.warn?.('device-sync: sync listener error', error))
  ctx.effect(() => {
    server.listen(syncServer.port, syncServer.host)
    return () => { server.close(); server.closeAllConnections?.() }
  }, 'device-sync: sync listener')

  // Read-only / proposal actions only. Approval, policy changes and apply stay
  // user-only actions in the Web panel.
  const tools = ctx.get('tools')
  if (tools) {
    ctx.effect(() => tools.register({
      name: 'device_sync',
      description: 'Inspect or refresh device sync state. Read-only and proposal actions only; approval and apply require the Web panel.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['state', 'check', 'proposals', 'proposal'], description: 'Action to run' },
          kind: { type: 'string', enum: ['plugin', 'config', 'lingshu', 'both', 'all'], description: 'Resource kind for check and proposal' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, value: { type: 'object' } } },
        render: (result) => [{ type: 'text', text: JSON.stringify(result) }],
      },
      async execute(args) {
        if (!['state', 'check', 'proposals', 'proposal'].includes(args?.action)) {
          return { ok: false, error: 'action-not-allowed-for-agent' }
        }
        const value = await localAction(args.action, args)
        return { ok: businessStatus(value) === 200, value: agentView(value) }
      },
    }), 'device-sync: agent tool')
  }

  ctx.effect(() => {
    let stopped = false
    let handle = null
    const tick = async () => {
      if (stopped) return
      try {
        await engine.autoSync()
      } catch {
        // A failed automatic pass never disables the local instance.
      }
      if (stopped) return
      const delay = Math.max(60000, engine.publicState().policy.intervalMs ?? 300000)
      handle = setTimeout(tick, delay)
      handle.unref?.()
    }
    handle = setTimeout(tick, Math.max(60000, engine.publicState().policy.intervalMs ?? 300000))
    handle.unref?.()
    return () => { stopped = true; if (handle) clearTimeout(handle) }
  }, 'device-sync: scheduler')

  // Returned for the HTTP harness: two listeners with distinct trust planes.
  return { localHandler, remoteHandler, server, syncServer }
}

// Agent inspection receives metadata only, including on direct check/proposals
// results that have not passed through the browser's public state projection.
function agentView(value) {
  if (Array.isArray(value)) return value.map(agentView)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['content', 'snippet', 'title', 'config', 'payload', 'pendingSnapshot', 'tokenHash', 'credentialKey', 'mac'].includes(key))
    .map(([key, item]) => [key, agentView(item)]))
}

function validateRemoteBody(route, body) {
  const identity = body.identity
  if (route.endsWith('/state')) {
    if (typeof body.deviceId !== 'string' || !body.deviceId || body.deviceId.length > 256) throw new HostError('invalid-device-id')
    if (body.offer !== undefined && (!body.offer || typeof body.offer !== 'object' || Array.isArray(body.offer))) throw new HostError('invalid-offer')
    if (body.acknowledgedOffers !== undefined && (!Array.isArray(body.acknowledgedOffers) || body.acknowledgedOffers.length > 512 || body.acknowledgedOffers.some(id => typeof id !== 'string' || !id || id.length > 128))) throw new HostError('invalid-acknowledged-offers')
  } else {
    if (validateIdentity(identity).length) throw new HostError('invalid-identity')
    if (route.endsWith('/proposals') && validateChangeset(body.changeset).length) throw new HostError('invalid-changeset')
  }
}
