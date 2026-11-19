// Host half of the device sync plugin. All mutations go through the engine;
// this file only adapts DSH services and exposes HTTP routes.

import { createEngine } from './lib/engine.js'
import { configRecord, projectConfig, mergeConfigFields, configHash, validFieldPath, isSecretKey } from './lib/config.js'
import { collectMemory, writeMemory, getMemoryAdapters } from './lib/memory.js'
import { hash, validateIdentity, validateChangeset } from './lib/protocol.js'
import { bearerFrom } from './lib/transport.js'
import { profileScope, createStore, createHostAudit, createCredentialAdapter, archiveDecisions, unwrap, HostError, jsonRequestGate, readBody, businessStatus } from './lib/host-runtime.js'

export const inject = ['pluginManager', 'configEditor', 'webServer', 'credentials', 'connection', 'tools', 'profileContext']

const PLUGIN_NAME = '@local/dsh-plugin-sync'
const ROUTE_PREFIX = '/plugin-sync'
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
    collectMemory: async () => collectMemory({ adapters: getMemoryAdapters(scope.home), home: scope.home, owner: scope.name }),
    writeMemory: async (payload) => writeMemory({ ...payload, adapters: getMemoryAdapters(scope.home), home: scope.home, owner: scope.name }),
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
  const configs = (await adapters.collectConfig()).map(({ key, entryId, bundle, config }) => ({ key, entryId, bundle, fields: paths(config) }))
  const memories = (await adapters.collectMemory()).records.map(({ key, adapterId, relativePath }) => ({ key, adapterId, relativePath }))
  return { plugins, configs, memories }
}

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  if (status === 408 || status === 413) res.setHeader('connection', 'close')
  res.end(JSON.stringify(payload))
}

export function apply(ctx) {
  const scope = profileScope(ctx.get('profileContext'))
  const store = createStore(scope.dir)
  const loaded = store.read()
  const audit = createHostAudit()
  audit.replaceLoaded(loaded?.audit ?? [])
  let engine = null
  let optionalLlm = null
  ctx.inject(['llm'], llmContext => {
    optionalLlm = llmContext.get('llm')
    llmContext.effect(() => () => { optionalLlm = null }, 'device-sync: optional llm')
  })
  const askModel = async (records) => {
    const config = engine?.publicState().policy.ai
    if (!config?.enabled || !config.provider || !config.model) return null
    const llm = optionalLlm
    if (!llm) return null
    const prompt = [
      'Classify each memory resource as sync, localOnly or skip.',
      'Return a JSON array only: [{"key":"...","action":"sync|localOnly|skip","reason":"..."}]',
      'Resources:',
      ...records.map((r) => `- ${r.key} (${r.adapterId}:${r.relativePath})`),
    ].join('\n')
    let text = ''
    for await (const chunk of llm.stream({
      provider: config.provider, model: config.model, maxTokens: config.maxTokens ?? 800,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })) {
      if (chunk?.type === 'text-delta') text += chunk.text ?? ''
    }
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
      const parsed = JSON.parse(match[0])
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.key === 'string') : []
    } catch {
      return []
    }
  }
  const adapters = {
    ...createInventoryAdapter(ctx, scope),
    ...createCredentialAdapter(ctx, scope),
    askModel,
    archiveDecisions: records => archiveDecisions(scope, records),
  }
  engine = createEngine({ store, adapters, audit })
  engine.publicState()

  const localAction = async (name, args) => {
    args = { ...args, actor: 'user' }
    switch (name) {
      case 'state': return engine.publicState()
      case 'inventory': return resourceCatalogue(adapters)
      case 'archiveDecisions': return engine.archiveDecisions({ actor: 'user' })
      case 'connectPeer': return engine.connectPeer(args)
      case 'publishLocal': return engine.publishLocal({ kind: args.kind ?? 'plugin', actor: 'user' })
      case 'revokePeer': return engine.revokePeer({ deviceId: args.deviceId, actor: 'user' })
      case 'rejectProposal': return engine.rejectProposal({ proposalId: args.proposalId, actor: 'user' })
      case 'resolvePlanConflict': return engine.resolvePlanConflict({ planId: args.planId, key: args.key, choice: args.choice, actor: 'user' })
      case 'pairCenter': return engine.pairCenter(args)
      case 'joinCenter': return engine.joinCenter(args)
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
      case 'suggest': return engine.suggestMemory()
      case 'adopt': return engine.adoptSuggestions({ ids: args.ids, actor: 'user' })
      case 'acceptProposal': return engine.handleAcceptProposal({ proposalId: args.proposalId, actor: 'user' })
      case 'resolveConflict': return engine.resolveConflict({ conflictId: args.conflictId, choice: args.choice, actor: 'user' })
      case 'proposals': return engine.handleListProposals()
      default: throw new Error(`unknown-action:${name}`)
    }
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = url.pathname
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
      if ([`${ROUTE_PREFIX}/hello`, `${ROUTE_PREFIX}/state`, `${ROUTE_PREFIX}/proposals`].includes(pathname)) {
        jsonRequestGate(req)
        const body = await readBody(req)
        validateRemoteBody(pathname, body)
        const token = bearerFrom(req.headers?.authorization)
        let result
        if (pathname === `${ROUTE_PREFIX}/hello`) result = await engine.handleHello({ token, identity: body.identity })
        else if (pathname === `${ROUTE_PREFIX}/state`) result = await engine.handleGetState({ token, deviceId: body.deviceId, offer: body.offer, acknowledgedOffers: body.acknowledgedOffers })
        else result = await engine.handleSubmitProposal({ token, identity: body.identity, changeset: body.changeset })
        return sendJson(res, businessStatus(result), result)
      }
      return sendJson(res, 404, { error: 'not-found' })
    } catch (error) {
      // Provider/config/parser errors can embed credentials; only our fixed
      // boundary codes are safe to return to an HTTP caller.
      return sendJson(res, error instanceof HostError ? error.status : 400, { error: error instanceof HostError ? error.message : 'request-failed' })
    }
  }

  const webServer = ctx.get('webServer')
  if (!webServer) throw new Error('webServer service is required for device sync')
  ctx.effect(() => webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler }), 'device-sync: routes')

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
          kind: { type: 'string', enum: ['plugin', 'config', 'memory', 'both', 'all'], description: 'Resource kind for check and proposal' },
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
}

// Agent inspection receives metadata only, including on direct check/proposals
// results that have not passed through the browser's public state projection.
function agentView(value) {
  if (Array.isArray(value)) return value.map(agentView)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !['content', 'snippet', 'config', 'payload', 'pendingSnapshot', 'tokenHash', 'credentialKey', 'mac'].includes(key))
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
