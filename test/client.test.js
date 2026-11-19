import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { createRequire } from 'node:module'

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const depsRoot = process.env.DSH_SYNC_TEST_DEPS
const require = createRequire(depsRoot ? path.join(path.resolve(depsRoot), 'package.json') : import.meta.url)
let React, Renderer
try {
  React = require('react')
  Renderer = require('react-test-renderer')
} catch (error) {
  if (depsRoot || error.code !== 'MODULE_NOT_FOUND') throw error
}

function register(react, transport, language = 'en') {
  let loaded, dictionaries
  const registrations = []
  const effects = []
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (module) => { loaded = module } } },
    fetch: transport, AbortController, setTimeout, clearTimeout,
    console: new Proxy({}, { get() { return () => assert.fail('client wrote to console') } }),
  })
  assert.equal(loaded.id, manifest.name)
  const module = loaded.factory((name) => {
    assert.equal(name, 'react')
    return react
  })
  assert.deepEqual(Array.from(module.inject), ['slots', 'locale'])
  module.apply({
    effect(fn, label) { effects.push(label); return fn() },
    locale: {
      register(ns, value) { dictionaries = value; return () => {} },
      bind() { return (key) => dictionaries[language][key] ?? key },
    },
    slots: {
      inject(key, callback) { return callback() },
      register(options, component) { registrations.push({ options, component }) },
    },
  })
  return { registrations, effects, dictionaries }
}

test('client manifest resolves and registers the two documented DSH slots', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.ok(manifest.exports['./locale/*.json'])
  const { registrations, effects, dictionaries } = register({}, undefined)
  assert.deepEqual(registrations.map(({ options }) => [options.name, options.id, options.label()]), [
    ['plugins.tab', 'device-sync', 'Device sync'], ['settings.section', 'device-sync', 'Device sync settings'],
  ])
  assert.ok(registrations.every(({ component }) => typeof component === 'function'))
  assert.ok(effects.includes('device-sync: dictionaries'))
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort())
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(fs.readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(locale), ['meta'])
  }
})

const hookTest = (name, body) => test(name, { skip: !Renderer && 'Install React 19 and react-test-renderer 19 and set DSH_SYNC_TEST_DEPS' }, body)
function policy() {
  return {
    mode: 'manual', topology: 'center', direction: 'both', autoApply: false, intervalMs: 300000,
    include: [], exclude: [], localOnly: [], configFields: {}, protected: ['@local/dsh-plugin-sync'], default: 'allow',
    caps: { install: false, upgrade: false, enable: true, disable: true, configSet: false, memWrite: false, tombstone: false },
    ai: { enabled: false, provider: '', model: '', maxTokens: 800 },
  }
}
function state(role = 'unpaired', data = {}) {
  return { identity: { role, label: 'Profile' }, policy: policy(), approvals: {}, ...data }
}
const response = (payload, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(payload) })
const success = (value) => response({ ok: true, value })
function text(node) {
  return (node.children ?? []).map((child) => typeof child === 'object' && child !== null ? text(child) : String(child ?? '')).join(' ')
}
async function mount(t, start, respond, { slot = 'settings.section', language = 'en' } = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const requests = []
  let current = start
  const update = (next) => { current = next }
  const { registrations } = register(React, async (url, options) => {
    assert.equal(url, '/plugin-sync/api/action')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.method, 'POST')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.signal instanceof AbortSignal, true)
    const body = JSON.parse(options.body)
    requests.push(body)
    const result = respond?.(body, current, update)
    return (await result) ?? success(current)
  }, language)
  const Component = registrations.find(({ options }) => options.name === slot).component
  let rendered
  await React.act(async () => { rendered = Renderer.create(React.createElement(Component)) })
  t.after(async () => { await React.act(async () => rendered.unmount()); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const pick = (nodes, label) => {
    const node = nodes.find((element) => text(element).trim() === label)
    assert.ok(node, `missing ${label}`)
    return node
  }
  const button = (label) => pick(rendered.root.findAllByType('button'), label)
  const field = (name, type) => {
    const label = rendered.root.findAllByType('label').find((element) => element.children.filter((child) => typeof child === 'string').join('') === name)
    assert.ok(label, `missing ${name}`)
    return label.findByType(type)
  }
  return {
    requests, button, text: () => text(rendered.root),
    click: async (label) => React.act(async () => {
      const node = button(label)
      assert.ok(!node.props.disabled, `disabled ${label}`)
      await node.props.onClick()
    }),
    change: async (label, value, type = 'input') => React.act(async () => {
      field(label, type).props.onChange({ target: { value, checked: value } })
    }),
  }
}

hookTest('settings load error exits loading and retries in place', async (t) => {
  let unavailable = true
  const ui = await mount(t, state(), () => {
    if (unavailable) throw Error('test-secret-network-error')
  })
  assert.match(ui.text(), /Could not load.*Network unavailable/)
  assert.doesNotMatch(ui.text(), /test-secret|Loading device sync/)
  unavailable = false
  await ui.click('Retry')
  assert.match(ui.text(), /Device sync settings/)
  assert.doesNotMatch(ui.text(), /Could not load/)
  assert.deepEqual(ui.requests, [{ action: 'state' }, { action: 'state' }])
})

hookTest('settings save validates literal field paths and all policy controls', async (t) => {
  const ui = await mount(t, state(), ({ action, policy }, prior, update) => {
    if (action !== 'policy') return
    update({ ...prior, policy })
    return success({ ok: true, policy })
  })
  await ui.change('Allowed configuration fields (JSON)', '[]', 'textarea')
  await ui.click('Save policy')
  assert.match(ui.text(), /Enter a JSON object/)
  assert.ok(!ui.requests.some(({ action }) => action === 'policy'))
  await ui.change('Allowed configuration fields (JSON)', '{"entry":[["root","a.b"]]}', 'textarea')
  await ui.change('Include', 'config:entry\nmemory:persona/notes.md\nconfig:entry', 'textarea')
  await ui.change('Exclude', 'excluded-device', 'textarea')
  await ui.change('Local only', 'my-local-plugin', 'textarea')
  await ui.change('Mode', 'managed', 'select')
  await ui.change('Direction', 'pull', 'select')
  await ui.change('Check interval (ms)', '62000')
  await ui.change('Automatic reconciliation (managed only)', true)
  for (const name of ['Install', 'Upgrade', 'Enable', 'Disable', 'Write plugin config', 'Write memory']) {
    await ui.change(name, name !== 'Disable')
  }
  await ui.change('Enable model suggestions', true)
  await ui.change('AI provider ID', 'example-provider')
  await ui.change('AI model ID', 'example-model')
  await ui.click('Save policy')
  const saved = ui.requests.find(({ action }) => action === 'policy').policy
  assert.deepEqual(saved, { ...policy(), mode: 'managed', direction: 'pull', intervalMs: 62000, autoApply: true,
    caps: { ...policy().caps, install: true, upgrade: true, disable: false, configSet: true, memWrite: true },
    include: ['config:entry', 'memory:persona/notes.md'], exclude: ['excluded-device'], localOnly: ['my-local-plugin'],
    configFields: { entry: [['root', 'a.b']] }, ai: { ...policy().ai, enabled: true, provider: 'example-provider', model: 'example-model' },
  })
  assert.match(ui.text(), /Policy saved/)
})

hookTest('listener generates invitations only on demand and administers peers and proposals', async (t) => {
  const ui = await mount(t, state(), (body, prior, update) => {
    if (body.action === 'pairCenter') {
      update(state('peer', { topology: 'p2p', peers: { one: { deviceId: 'one', label: 'Phone', status: 'pending' } },
        proposals: [{ id: 'p1', status: 'pending' }] }))
      return success(prior)
    }
    if (body.action === 'invite') return success({ token: 'example-only', expiresAt: '2099-01-01' })
    if (body.action === 'acceptProposal') return response({ error: 'unresolved-conflict', detail: 'paired-secret' }, 409)
    if (body.action === 'rejectProposal') return success({ status: 'rejected' })
    if (body.action === 'publishLocal') return success({ status: 'published' })
    if (body.action === 'revokePeer') return success({ status: 'revoked' })
  })
  await ui.change('Connection', 'listenPeer', 'select')
  await ui.click('Create peer invitation endpoint')
  assert.ok(!ui.requests.some(({ action }) => action === 'invite'))
  assert.match(ui.text(), /Waiting for an incoming request/)
  await ui.click('Generate invitation')
  assert.match(ui.text(), /example-only/)
  await ui.click('Hide invitation')
  assert.doesNotMatch(ui.text(), /example-only/)
  await ui.click('Accept and publish')
  assert.match(ui.text(), /Resolve conflicts before continuing/)
  assert.doesNotMatch(ui.text(), /paired-secret/)
  await ui.click('Reject proposal')
  await ui.click('Publish selected local resources')
  await ui.click('Revoke peer access')
  assert.deepEqual(ui.requests.filter(({ action }) => action !== 'state'), [
    { action: 'pairCenter', initSource: 'empty', topology: 'p2p' }, { action: 'invite' },
    { action: 'acceptProposal', proposalId: 'p1' }, { action: 'rejectProposal', proposalId: 'p1' },
    { action: 'publishLocal', kind: 'all' }, { action: 'revokePeer', deviceId: 'one' },
  ])
})

hookTest('peer join, memory operations and plan error feedback work through the Plugins slot', async (t) => {
  const ui = await mount(t, state(), (body, prior, update) => {
    if (body.action === 'connectPeer') {
      update(state('peer', { topology: 'p2p', center: { deviceId: 'remote' }, lastStatus: { status: 'expired' },
        lastConfigStatus: { status: 'ok' }, lastConfigResults: [{ opId: 'conf', status: 'needsRestart' }] }))
      return success(prior)
    }
    if (body.action === 'check') return success({ status: 'network', detail: 'remote-secret' })
    if (body.action === 'proposal') return success({ status: 'queued' })
  }, { slot: 'plugins.tab' })
  await ui.change('Connection', 'connectPeer', 'select')
  await ui.change('Remote URL', 'https://example.invalid')
  await ui.change('Invitation token', 'example-token')
  await ui.change('SSH host', 'example.internal')
  await ui.change('SSH user', 'ssh-user')
  await ui.change('Remote port', '8123')
  await ui.click('Connect to peer')
  assert.match(ui.text(), /Connection not yet confirmed/)
  assert.match(ui.text(), /Plugin plan.*Plan expired.*Plugin configuration plan.*Restart required.*Memory plan/)
  await ui.click('Check memory differences')
  assert.match(ui.text(), /Memory plan.*Network unavailable/)
  assert.doesNotMatch(ui.text(), /remote-secret|example-token/)
  await ui.click('Submit memory proposal')
  assert.match(ui.text(), /Memory plan.*Queued/)
  assert.deepEqual(ui.requests.filter(({ action }) => action !== 'state'), [
    { action: 'connectPeer', url: 'https://example.invalid', token: 'example-token',
      ssh: { kind: 'ssh', host: 'example.internal', user: 'ssh-user', remotePort: 8123 } },
    { action: 'check', kind: 'memory' }, { action: 'proposal', kind: 'memory' },
  ])
})

hookTest('snapshot import immediately checks all kinds and resolves a safe diff before approval', async (t) => {
  const op = { opId: 'cfg', key: 'config:entry', action: 'configSet', payload: { config: { secret: 'never-render' } }, risk: 'high' }
  const plan = { planId: 'plan-old', source: 'snapshot:2', operations: [], skipped: [], conflicts: [
    { key: 'config:entry', center: 'a'.repeat(64), local: 'b'.repeat(64), baseline: 'never-render', detail: 'never-render' },
  ] }
  const ui = await mount(t, state(), (body, prior, update) => {
    if (body.action === 'loadSnapshot') return success({ ok: true })
    if (body.action === 'check') {
      update({ ...prior, pendingSnapshot: { trust: 'untrusted', manifest: { algorithm: 'hmac-sha256' } }, lastConfigPlan: plan })
      return success({ status: 'ok' })
    }
    if (body.action === 'resolvePlanConflict') {
      const newPlan = { ...plan, planId: 'plan-new', operations: [op], conflicts: [] }
      update({ ...prior, lastConfigPlan: newPlan })
      return success({ ok: true, plan: newPlan })
    }
    if (body.action === 'approve') {
      update({ ...prior, approvals: { [body.planId]: { opIds: body.opIds } } })
      return success({ ok: true })
    }
    if (body.action === 'apply') {
      update({ ...prior, lastConfigStatus: { status: 'ok' }, lastConfigResults: [{ opId: 'cfg', status: 'needsRestart' }] })
      return success({ status: 'ok' })
    }
  }, { language: 'zh' })
  await ui.change('快照 JSON', '{"mock":true}', 'textarea')
  await ui.click('导入并检查差异')
  assert.match(ui.text(), /快照未签名，来源不可信/)
  assert.match(ui.text(), /传入版本 a{12}…/)
  assert.doesNotMatch(ui.text(), /never-render/)
  await ui.click('采用传入版本')
  assert.equal(ui.button('应用已批准操作').props.disabled, true)
  await ui.change('写入插件配置 config:entry', true)
  await ui.click('批准所选操作')
  await ui.click('应用已批准操作')
  assert.match(ui.text(), /需重启/)
  assert.doesNotMatch(ui.text(), /never-render/)
  assert.deepEqual(ui.requests.filter(({ action }) => action !== 'state'), [
    { action: 'loadSnapshot', text: '{"mock":true}' }, { action: 'check', kind: 'all', source: 'snapshot' },
    { action: 'resolvePlanConflict', planId: 'plan-old', key: 'config:entry', choice: 'remote' },
    { action: 'approve', actor: 'user', planId: 'plan-new', opIds: ['cfg'] }, { action: 'apply', planId: 'plan-new' },
  ])
})

hookTest('HTTP, JSON and nested business failures stay local and retain loaded settings', async (t) => {
  let failure = 'parse'
  const initial = state('device', { center: { deviceId: 'remote', status: 'offline', lastSeen: '2026-01-01' } })
  const ui = await mount(t, initial, (body) => {
    if (body.action === 'policy') {
      if (failure === 'parse') return { ok: true, status: 200, text: async () => '{invalid-private-value-json' }
      if (failure === 'html') return { ok: false, status: 403, text: async () => '<html>secret</html>' }
      if (failure === 'business') return response({ ok: false, value: { ok: false, reason: 'direction-blocked:push', detail: 'secret' } }, 409)
      if (failure === 'host') return response({ error: 'request-failed' }, 400)
    }
    if (body.action === 'state' && failure === 'refresh') throw Error('secret-refresh-failed')
  })
  assert.match(ui.text(), /Last request failed/)
  await ui.click('Save policy')
  assert.match(ui.text(), /invalid response/)
  failure = 'html'
  await ui.click('Save policy')
  assert.match(ui.text(), /Not authorized/)
  failure = 'business'
  await ui.click('Save policy')
  assert.match(ui.text(), /blocked by the sync direction/)
  failure = 'host'
  await ui.click('Save policy')
  assert.match(ui.text(), /The operation failed/)
  failure = 'refresh'
  await ui.click('Refresh status')
  assert.match(ui.text(), /Could not load/)
  assert.match(ui.text(), /Device sync settings.*Allowed configuration fields/)
  assert.doesNotMatch(ui.text(), /private-value|secret-refresh-failed|Loading device sync/)
  failure = ''
  await ui.click('Retry')
  assert.doesNotMatch(ui.text(), /Could not load/)
})

hookTest('busy operations block duplicate invocation and recover after rejection', async (t) => {
  let rejectOperation
  let resolveStarted
  const started = new Promise((resolve) => { resolveStarted = resolve })
  const ui = await mount(t, state('center'), (body) => {
    if (body.action === 'publishLocal') {
      resolveStarted()
      return new Promise((_resolve, reject) => { rejectOperation = reject })
    }
  })
  const button = ui.button('Publish selected local resources')
  let ongoing
  await React.act(async () => {
    ongoing = button.props.onClick()
    await started
  })
  assert.match(ui.text(), /Working…/)
  assert.equal(ui.button('Publish selected local resources').props.disabled, true)
  await React.act(async () => {
    await button.props.onClick()
    rejectOperation(Error('private-value-error'))
    await ongoing
  })
  assert.equal(ui.requests.filter(({ action }) => action === 'publishLocal').length, 1)
  assert.equal(ui.button('Publish selected local resources').props.disabled, false)
  assert.match(ui.text(), /Network unavailable/)
  assert.doesNotMatch(ui.text(), /private-value-error/)
})

hookTest('archive button invokes only archiveDecisions and reports failure without stale success', async (t) => {
  let failArchive = false
  const ui = await mount(t, state('center', { proposals: [{ id: 'pending', status: 'pending', origin: { label: 'Pending phone' } }] }), (body) => {
    if (body.action !== 'archiveDecisions') return
    if (failArchive) return response({ ok: false, value: { ok: false, reason: 'archive-failed' } }, 409)
    return success({ status: 'archived', count: 3, archiveId: 'proposals-1234-abcdef0123456789.json' })
  })
  await ui.click('Archive processed proposals')
  assert.match(ui.text(), /Archived 3 · proposals-1234-abcdef0123456789.json/)
  assert.match(ui.text(), /Pending phone/)
  failArchive = true
  await ui.click('Archive processed proposals')
  assert.match(ui.text(), /Archiving failed. The proposals remain/)
  assert.match(ui.text(), /Pending phone/)
  assert.doesNotMatch(ui.text(), /Archived 3|proposals-1234-abcdef0123456789.json/)
  assert.deepEqual(ui.requests.filter(({ action }) => action !== 'state'), [{ action: 'archiveDecisions' }, { action: 'archiveDecisions' }])
})

hookTest('local resource inventory loads on demand and selections remain an unsaved draft', async (t) => {
  let failInventory = true
  const ui = await mount(t, state(), (body, prior, update) => {
    if (body.action === 'inventory') {
      if (failInventory) throw Error('inventory-private-value')
      return success({
        plugins: [{ key: 'example-plugin', enabled: true, values: 'never-display-private-value' }],
        configs: [{ key: 'actual-entry', entryId: 'actual-entry', bundle: 'bundle-name', fields: [['parent', 'a.b'], ['region']], content: 'never-display-private-value' }],
        memories: [{ key: 'memory:persona/notes.md', adapterId: 'persona', relativePath: 'notes.md', content: 'never-display-private-value' }],
      })
    }
    if (body.action === 'policy') {
      update({ ...prior, policy: body.policy })
      return success({ ok: true, policy: body.policy })
    }
  })
  assert.ok(!ui.requests.some(({ action }) => action === 'inventory'))
  await ui.click('View selectable local resources')
  assert.match(ui.text(), /Network unavailable/)
  failInventory = false
  await ui.click('View selectable local resources')
  assert.match(ui.text(), /actual-entry.*Configuration path \["parent","a.b"\]/)
  assert.doesNotMatch(ui.text(), /never-display-private-value|inventory-private-value/)
  await ui.change('example-plugin', true)
  await ui.change('memory:persona/notes.md', true)
  await ui.change('Configuration path ["parent","a.b"]', true)
  assert.ok(!ui.requests.some(({ action }) => action === 'policy'))
  await ui.click('Save policy')
  const saved = ui.requests.find(({ action }) => action === 'policy').policy
  assert.deepEqual(saved.include, ['example-plugin', 'memory:persona/notes.md', 'actual-entry'])
  assert.deepEqual(saved.configFields, { 'actual-entry': [['parent', 'a.b']] })
  assert.equal(saved.caps.configSet, false)
  assert.equal(saved.caps.memWrite, false)
  assert.equal(ui.requests.filter(({ action }) => action === 'inventory').length, 2)
})

hookTest('connected peer listener can check and queue memory proposals', async (t) => {
  const ui = await mount(t, state('peer', { peers: { p: { deviceId: 'p', status: 'connected', lastSeen: '2026-01-01' } } }), (body) => {
    if (body.action === 'check') return response({ ok: false, value: { status: 'peer-state-unavailable' } }, 409)
    if (body.action === 'proposal') return success({ status: 'queued', proposalId: 'queue-1' })
  })
  assert.equal(ui.button('Generate invitation').props.disabled, true)
  assert.match(ui.text(), /already has a peer/)
  await ui.click('Check memory differences')
  assert.match(ui.text(), /Wait for the paired device/)
  await ui.click('Submit memory proposal')
  assert.match(ui.text(), /Memory plan.*Queued/)
  assert.deepEqual(ui.requests.filter(({ action }) => action !== 'state'), [
    { action: 'check', kind: 'memory' }, { action: 'proposal', kind: 'memory' },
  ])
})

hookTest('snapshot validation failure never triggers its check step', async (t) => {
  const ui = await mount(t, state(), ({ action }) => {
    if (action === 'loadSnapshot') return response({ ok: false, value: { ok: false, reason: 'digest-mismatch' } }, 409)
  })
  await ui.change('Snapshot JSON', '{"bad":"digest"}', 'textarea')
  await ui.click('Import and check differences')
  assert.match(ui.text(), /Snapshot integrity check failed/)
  assert.ok(!ui.requests.some(({ action }) => action === 'check'))
})
