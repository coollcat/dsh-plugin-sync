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

function register(react, transport, language = 'en', storage = new Map(), extra = {}) {
  let loaded, dictionaries
  const registrations = []
  const effects = []
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (module) => { loaded = module } } },
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    fetch: transport, AbortController, setTimeout, clearTimeout,
    Blob: class { constructor(parts) { this.parts = parts } },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    FileReader: class {},
    document: { createElement: () => ({ click() {}, addEventListener() {}, set type(value) {}, set accept(value) {}, files: [] }) },
    console: new Proxy({}, { get() { return () => assert.fail('client wrote to console') } }),
  })
  assert.equal(loaded.id, manifest.name)
  const module = loaded.factory((name) => {
    assert.equal(name, 'react')
    return react
  })
  // The merged lingshu-mute host also injects conversation services; the panel
  // must still work when only slots and locale are provided.
  assert.ok(['slots', 'locale'].every((name) => module.inject.includes(name)))
  module.apply({
    ...extra,
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
  return { registrations, effects, dictionaries, storage }
}

test('client registers the plugin tab only and ships matching dictionaries', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'], './client.js')
  const { registrations, effects, dictionaries } = register({}, undefined)
  const tabs = registrations.filter(({ options }) => options.name === 'plugins.tab')
  assert.deepEqual(tabs.map(({ options }) => [options.name, options.id, options.label()]), [
    ['plugins.tab', 'device-sync', 'Device sync'],
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
function policy(overrides = {}) {
  return {
    mode: 'selective', topology: 'center', direction: 'both', autoApply: false, intervalMs: 300000,
    include: [], exclude: [], localOnly: [], configFields: {}, protected: ['@local/dsh-plugin-sync', '@deepseek-ai/*'], default: 'deny',
    caps: { install: false, upgrade: false, enable: true, disable: true, configSet: false, tombstone: false },
    ai: { enabled: false, provider: '', model: '', maxTokens: 800 },
    ...overrides,
  }
}
function state(role = 'unpaired', data = {}) {
  return {
    identity: { role, label: 'Profile', deviceId: 'd1', profileId: 'p1' },
    policy: policy(), approvals: {}, center: null, peers: {}, proposals: [], conflicts: [],
    suggestions: [], audit: [], suspended: false, lastPlan: null, lastConfigPlan: null,
    lastResults: [], lastConfigResults: [], lastStatus: null, lastConfigStatus: null,
    revision: { number: 1 }, expected: [], expectedConfig: [], ...data,
  }
}
const PLUGINS = [
  { key: 'alpha', enabled: true },
  { key: 'beta', enabled: true },
  { key: 'gamma', enabled: false },
]
const INVENTORY = { plugins: PLUGINS, configs: [{ key: 'alpha-config', entryId: 'alpha-config', bundle: 'alpha', fields: [['theme'], ['density']], eligible: true }] }
const response = (payload, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(payload) })
const success = (value) => response({ ok: true, value })
function text(node) {
  if (node?.type === 'style') return ''
  return (node.children ?? []).map((child) => typeof child === 'object' && child !== null ? text(child) : String(child ?? '')).join(' ')
}
async function mount(t, start, respond, { slot = 'plugins.tab', language = 'en', storage = new Map(), extra = {} } = {}) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const requests = []
  let current = start
  const { registrations } = register(React, async (url, options) => {
    assert.equal(url, '/plugin-sync/api/action')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.method, 'POST')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.signal instanceof AbortSignal, true)
    const body = JSON.parse(options.body)
    requests.push(body)
    const result = respond?.(body, current)
    return (await result) ?? success(current)
  }, language, storage, extra)
  const Component = registrations.find(({ options }) => options.name === slot).component
  let rendered
  await React.act(async () => { rendered = Renderer.create(React.createElement(Component)) })
  t.after(async () => { await React.act(async () => rendered.unmount()); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
  const flush = () => React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const pick = (nodes, label) => {
    const node = nodes.find((element) => text(element).trim() === label)
    assert.ok(node, `missing ${label}`)
    return node
  }
  const button = (label) => pick(rendered.root.findAllByType('button'), label)
  const hasButton = (label) => rendered.root.findAllByType('button').some((element) => text(element).trim() === label)
  const all = () => text(rendered.root)
  return {
    requests, button, hasButton, all, flush,
    inputValues: () => rendered.root.findAllByType('input').map((element) => element.props.value),
    nthInput: async (label, index, checked) => {
      await React.act(async () => {
        const row = rendered.root.findAllByType('li').find((element) => text(element).includes(label))
        assert.ok(row, `missing row ${label}`)
        row.findAllByType('input')[index].props.onChange({ target: { checked } })
      })
      await flush()
    },
    fillTextarea: async (placeholder, value) => {
      await React.act(async () => {
        const node = rendered.root.findAllByType('textarea').find((element) => element.props.placeholder === placeholder)
        assert.ok(node, `missing textarea ${placeholder}`)
        node.props.onChange({ target: { value } })
      })
      await flush()
    },
    fill: async (placeholder, value) => {
      await React.act(async () => {
        const input = rendered.root.findAllByType('input').find((element) => element.props.placeholder === placeholder)
        assert.ok(input, `missing input ${placeholder}`)
        input.props.onChange({ target: { value } })
      })
      await flush()
    },
    click: async (label) => {
      await React.act(async () => {
        const node = button(label)
        assert.ok(!node.props.disabled, `disabled ${label}`)
        await node.props.onClick()
      })
      await flush()
    },
    checkbox: async (key, checked) => {
      await React.act(async () => {
        const row = rendered.root.findAllByType('li').find((element) => text(element).includes(key))
        assert.ok(row, `missing row ${key}`)
        row.findAllByType('input')[0].props.onChange({ target: { checked } })
      })
      await flush()
    },
    toggleLabel: async (needle, checked) => {
      await React.act(async () => {
        const label = rendered.root.findAllByType('label').find((element) => text(element).includes(needle))
        assert.ok(label, `missing label ${needle}`)
        label.findByType('input').props.onChange({ target: { checked } })
      })
      await flush()
    },
    radio: async (label) => {
      await React.act(async () => {
        const preset = rendered.root.findAllByType('label').find((element) => text(element).includes(label))
        assert.ok(preset, `missing preset ${label}`)
        preset.findByType('input').props.onChange({ target: { checked: true } })
      })
      await flush()
    },
  }
}
const answer = (start, extra = {}) => (body) => {
  if (body.action === 'state') return success(start)
  if (body.action === 'inventory') return success(INVENTORY)
  if (Object.hasOwn(extra, body.action)) return extra[body.action](body)
  return success({ status: 'ok' })
}

hookTest('a failed load shows the mapped error, never the raw one, and retries in place', async (t) => {
  let fail = true
  const ui = await mount(t, state(), (body) => {
    if (body.action === 'state' && fail) throw new Error('test-secret-network-error')
    if (body.action === 'inventory') return success(INVENTORY)
    return success(state('unpaired'))
  })
  assert.ok(ui.all().includes('Network unavailable'), ui.all())
  assert.ok(!ui.all().includes('test-secret-network-error'))
  fail = false
  await ui.click('Retry')
  assert.ok(ui.all().includes('Sync scope'), ui.all())
})

hookTest('the plugin list comes from inventory and unchecking writes scope with default deny', async (t) => {
  const start = state('center', { policy: policy({ include: ['alpha', 'beta'] }) })
  const ui = await mount(t, start, answer(start))
  assert.ok(ui.all().includes('alpha'))
  assert.ok(ui.all().includes('gamma'))
  await ui.checkbox('beta', false)
  const written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.ok(written, 'no policy write')
  assert.deepEqual(written.policy.include, ['alpha'])
  assert.equal(written.policy.default, 'deny')
  assert.equal(written.policy.caps.memWrite, undefined)
})

hookTest('memory layers come from the lingshu catalogue and save with the write cap', async (t) => {
  const start = state('center', { policy: policy({ include: [] }) })
  const inventory = {
    ...INVENTORY,
    lingshu: {
      available: true, writable: true, root: '/tmp/memory', source: 'default',
      layers: [
        { layer: 'contextual', eligible: 3, nodes: [] },
        { layer: 'knowledge', eligible: 1, nodes: [] },
        { layer: 'anchor', eligible: 1, nodes: [] },
      ],
    },
  }
  const ui = await mount(t, start, (body) => {
    if (body.action === 'inventory') return success(inventory)
    if (body.action === 'state') return success(start)
    return success({ status: 'ok' })
  })
  assert.ok(ui.all().includes('Memory (Lingshu)'), ui.all())
  assert.ok(ui.all().includes('Contextual (3)'))
  assert.ok(ui.all().includes('Knowledge (1)'))
  assert.ok(!ui.all().includes('Anchor'), 'self and anchor layers are never offered')
  await ui.toggleLabel('Contextual (3)', true)
  let written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.ok(written, 'no policy write')
  assert.ok(written.policy.include.includes('lingshu:contextual'), JSON.stringify(written.policy.include))
  assert.deepEqual(written.policy.lingshu.layers, ['contextual'])
  assert.equal(written.policy.caps.memoryWrite, true)
  await ui.toggleLabel('Contextual (3)', false)
  written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.deepEqual(written.policy.lingshu.layers, [])
  assert.equal(written.policy.caps.memoryWrite, false)
  assert.ok(!written.policy.include.some((key) => key.startsWith('lingshu:')), JSON.stringify(written.policy.include))
})

hookTest('select all and the plugin-list settings switch update the same policy draft', async (t) => {
  const start = state('center')
  const ui = await mount(t, start, answer(start))
  await ui.click('Select all')
  let written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.deepEqual(new Set(written.policy.include), new Set(['alpha', 'beta', 'gamma']))
  await ui.nthInput('alpha', 1, true)
  written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.equal(written.policy.caps.configSet, true)
  assert.deepEqual(written.policy.configFields['alpha-config'], [['theme'], ['density']])
})

hookTest('advice adds missing plugins and adopts a suggestion through the API', async (t) => {
  const start = state('center', { suggestions: [{ id: 's1', key: 'alpha', action: 'sync', reason: 'enabled' }] })
  const ui = await mount(t, start, answer(start, { Suggest: (body) => success({ suggestions: start.suggestions }) }))
  await ui.click('Add all')
  let written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.deepEqual(new Set(written.policy.include), new Set(['alpha', 'beta', 'gamma']))
  await ui.click('Show')
  await ui.click('Include')
  const adopted = ui.requests.filter((item) => item.action === 'adopt').at(-1)
  assert.deepEqual(adopted.ids, ['s1'])
})

hookTest('an incoming proposal can be accepted or rejected from the sync card', async (t) => {
  const start = state('center', {
    center: { deviceId: 'c1', label: 'Office', lastContact: '2026-01-01T00:00:00.000Z' },
    proposals: [{ id: 'p1', status: 'pending', origin: { label: 'Office' }, keys: ['alpha'] }],
  })
  const ui = await mount(t, start, answer(start))
  assert.ok(ui.all().includes('Office'))
  await ui.click('Accept and publish')
  assert.equal(ui.requests.filter((item) => item.action === 'acceptProposal').length, 1)
})

hookTest('applying a plan approves the selected operations and then applies it', async (t) => {
  const start = state('center', {
    center: { deviceId: 'c1', label: 'Office', lastContact: '2026-01-01T00:00:00.000Z' },
    lastPlan: {
      planId: 'plan1', kind: 'plugin', operations: [
        { opId: 'op1', key: 'alpha', action: 'enable', risk: 'normal' },
        { opId: 'op2', key: 'beta', action: 'install', risk: 'high' },
      ], skipped: [], conflicts: [],
    },
  })
  const ui = await mount(t, start, answer(start))
  assert.ok(ui.all().includes('alpha'))
  await ui.click('Apply 1 to this device')
  const calls = ui.requests.map((item) => item.action)
  assert.deepEqual(calls.filter((name) => ['approve', 'apply'].includes(name)), ['approve', 'apply'])
  const approve = ui.requests.find((item) => item.action === 'approve')
  assert.deepEqual(approve.opIds, ['op1'])
})

hookTest('the center publishes local changes while a member compares and proposes', async (t) => {
  const centerState = state('center')
  const center = await mount(t, centerState, answer(centerState))
  assert.equal(center.hasButton('Compare'), false)
  assert.equal(center.hasButton('Send to the other device'), false)
  await center.click('Publish local changes')
  const published = center.requests.filter((item) => item.action === 'publishLocal')
  assert.equal(published.length, 1)
  assert.equal(published[0].kind, 'plugin')

  const memberState = state('device', { center: { deviceId: 'c1', label: 'Office' } })
  const member = await mount(t, memberState, answer(memberState))
  assert.equal(member.hasButton('Compare'), true)
  assert.equal(member.hasButton('Send to the other device'), true)
  assert.equal(member.hasButton('Publish local changes'), false)
})

hookTest('a point-to-point listener can create an invitation until a peer connects', async (t) => {
  const listenerState = state('peer')
  const ui = await mount(t, listenerState, answer(listenerState, { invite: () => success({ token: 'tok-1', expiresAt: '2026-01-02' }) }))
  const invite = ui.button('Invite a new device')
  assert.equal(invite.props.disabled, false)
  await ui.click('Invite a new device')
  assert.equal(ui.requests.filter((item) => item.action === 'invite').length, 1)
  assert.ok(ui.all().includes('tok-1'))
})

hookTest('invitations render the token and never leak configuration values', async (t) => {
  const start = state('center', { center: { deviceId: 'c1', label: 'Office' } })
  const ui = await mount(t, start, answer(start, { invite: () => success({ token: 'invite-token-123', expiresAt: '2026-01-02' }) }))
  await ui.click('Invite a new device')
  assert.ok(ui.all().includes('invite-token-123'))
  assert.ok(!ui.all().includes('SECRET-VALUE'))
})

hookTest('a rejected policy shows the mapped reason and keeps the previous values', async (t) => {
  const start = state('center')
  const ui = await mount(t, start, (body) => {
    if (body.action === 'state') return success(start)
    if (body.action === 'inventory') return success(INVENTORY)
    if (body.action === 'policy') return success({ ok: false, errors: ['bad'] })
    return success({ status: 'ok' })
  })
  await ui.checkbox('alpha', true)
  assert.ok(ui.all().includes('The settings were rejected'), ui.all())
  assert.ok(!ui.all().includes('errors'))
})

hookTest('the first-open guide fills a connection preset and only shows once', async (t) => {
  const storage = new Map()
  const start = state('unpaired')
  const ui = await mount(t, start, answer(start), { storage })
  assert.ok(ui.all().includes('First time here? Pick a connection preset'), ui.all())
  await ui.radio('Peer to peer')
  await ui.radio('Join a network')
  await ui.click('Fill it in and continue')
  assert.equal(storage.get('dsh-plugin-sync:guide-dismissed:v1'), '1')
  assert.ok(!ui.all().includes('First time here?'), ui.all())
  assert.ok(ui.all().includes('Preset applied: Peer to peer · join'), ui.all())
  assert.ok(ui.all().includes('Invitation link'), ui.all())
  const next = await mount(t, start, answer(start), { storage })
  assert.ok(!next.all().includes('First time here?'), next.all())
  await ui.click('Show the guide again')
  assert.ok(ui.all().includes('First time here? Pick a connection preset'), ui.all())
})

hookTest('the plugin list includes a whole plugin config with one toggle', async (t) => {
  const start = state('center')
  const ui = await mount(t, start, answer(start))
  await ui.nthInput('alpha', 1, true)
  const written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.ok(written, 'no policy write')
  assert.ok(written.policy.include.includes('alpha-config'))
  assert.deepEqual(written.policy.configFields['alpha-config'], [['theme'], ['density']])
  assert.equal(written.policy.caps.configSet, true)
  await ui.nthInput('alpha', 1, false)
  const after = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.equal(after.policy.include.includes('alpha-config'), false)
  assert.equal(after.policy.caps.configSet, false)
})

hookTest('reset sync returns to unpaired and reopens the guide', async (t) => {
  let current = state('center', { center: { deviceId: 'c1', label: 'Office' } })
  const ui = await mount(t, current, (body) => {
    if (body.action === 'state') return success(current)
    if (body.action === 'inventory') return success(INVENTORY)
    if (body.action === 'reset') { current = state('unpaired'); return success(current) }
    return success({ status: 'ok' })
  })
  assert.equal(ui.all().includes('First time here?'), false)
  await ui.click('Reset sync')
  await ui.click('Confirm reset')
  assert.equal(ui.requests.filter((item) => item.action === 'reset').length, 1)
  assert.ok(ui.all().includes('First time here? Pick a connection preset'), ui.all())
})

hookTest('an invitation link is parsed and the connection stays locked until verified', async (t) => {
  const start = state('unpaired')
  const ui = await mount(t, start, answer(start, { verify: () => success({ verified: true, center: { deviceId: 'c1', role: 'center' }, topology: 'center' }) }))
  await ui.click('I connect to another device')
  await ui.fill('Paste the full link shared by the other device', 'http://192.0.2.10:3080/plugin-sync/join?invite=tok-123')
  await ui.click('Parse link')
  await ui.click('Verify link')
  const verified = ui.requests.filter((item) => item.action === 'verify').at(-1)
  assert.equal(verified.url, 'http://192.0.2.10:3080')
  assert.equal(verified.token, 'tok-123')
  assert.ok(ui.all().includes('Verified'), ui.all())
})

hookTest('agent advice opens a new chat prefilled with the installed plugin list', async (t) => {
  const start = state('center')
  const started = []
  const ui = await mount(t, start, answer(start), {
    extra: { uiWorkspace: { startSession: (id, options) => started.push({ id, options }) } },
  })
  await ui.click('Ask the agent for suggestions')
  assert.equal(started.length, 1)
  assert.equal(started[0].id, undefined)
  assert.equal(started[0].options.whenDraftExists, 'append')
  assert.match(started[0].options.prompt, /alpha/)
  assert.match(started[0].options.prompt, /Lingshu/)
  assert.equal(ui.requests.some((item) => item.action === 'suggest'), false)
})

hookTest('SSH key path has a host-side picker and no separate invitation code field', async (t) => {
  const start = state('unpaired')
  const ui = await mount(t, start, answer(start, { pickFile: () => success({ path: 'C:\\keys\\id_ed25519' }) }))
  await ui.click('I connect to another device')
  await ui.click('SSH tunnel')
  assert.ok(ui.hasButton('Browse'))
  await ui.click('Browse')
  assert.equal(ui.requests.filter((item) => item.action === 'pickFile').length, 1)
  assert.ok(ui.inputValues().includes('C:\\keys\\id_ed25519'))
  assert.equal(ui.all().includes('Invitation code'), false)
})

hookTest('scope owns rules and allowed changes, advanced no longer offers model review', async (t) => {
  const ui = await mount(t, state('center'), answer(state('center')))
  assert.ok(ui.all().includes('Changes allowed to sync'))
  assert.ok(ui.all().includes('Never sync these'))
  assert.ok(ui.all().includes('No rules'))
  assert.equal(ui.all().includes('Use a model to review suggestions'), false)
})


hookTest('agent advice imports an agent JSON array and adopts it', async (t) => {
  const start = state('center', { suggestions: [] })
  let current = start
  const importedRows = [{ id: 's1', key: 'alpha', action: 'sync', reason: 'from AI', source: 'import' }]
  const ui = await mount(t, start, (body) => {
    if (body.action === 'state') return success(current)
    if (body.action === 'inventory') return success(INVENTORY)
    if (body.action === 'importSuggestions') {
      current = { ...start, suggestions: importedRows }
      return success({ imported: importedRows, skipped: ['unknown'] })
    }
    if (body.action === 'adopt') return success({ ok: true })
    return success({ status: 'ok' })
  })
  await ui.click('Import JSON')
  await ui.fillTextarea('Paste the JSON array returned by the agent.', '[{"key":"alpha","action":"sync","reason":"from AI"}]')
  await ui.click('Import suggestions')
  const imported = ui.requests.filter((item) => item.action === 'importSuggestions').at(-1)
  assert.equal(imported.text, '[{"key":"alpha","action":"sync","reason":"from AI"}]')
  assert.ok(ui.all().includes('Imported 1 suggestions.'), ui.all())
  assert.ok(ui.all().includes('Imported'))
  await ui.click('Adopt all')
  assert.deepEqual(ui.requests.filter((item) => item.action === 'adopt').at(-1).ids, ['s1'])
})

hookTest('rules are added as GUI chips instead of raw textareas', async (t) => {
  const start = state('center', { policy: policy({ exclude: ['alpha'], localOnly: ['beta'] }) })
  const ui = await mount(t, start, answer(start))
  await ui.fill('Plugin name or * pattern', 'gamma*')
  await ui.click('Add')
  const written = ui.requests.filter((item) => item.action === 'policy').at(-1)
  assert.ok(written.policy.exclude.includes('gamma*'))
  assert.ok(ui.all().includes('gamma*'))
  assert.equal(ui.all().includes('one per line'), false)
})

hookTest('device-bound memory settings never render a sync-settings switch', async (t) => {
  const start = state('center', { policy: policy({ include: ['alpha'] }) })
  const inventory = {
    plugins: [{ key: 'alpha', enabled: true }, { key: '@furongjun1999/dsh-memory', enabled: true }],
    configs: [
      { key: 'alpha-config', entryId: 'alpha-config', bundle: 'alpha', fields: [['theme'], ['density']], eligible: true },
      { key: 'mem-config', entryId: 'mem-config', bundle: '@furongjun1999/dsh-memory', fields: [['root'], ['python']], eligible: true },
    ],
  }
  const ui = await mount(t, start, (body) => {
    if (body.action === 'state') return success(start)
    if (body.action === 'inventory') return success(inventory)
    return success({ status: 'ok' })
  })
  assert.ok(ui.all().includes('@furongjun1999/dsh-memory'))
  // Only the ordinary plugin row offers the switch; the memory row does not.
  assert.equal(ui.all().split('Sync settings').length - 1, 1, ui.all())
})

hookTest('agent advice is a visible three-step round trip with an always-on import box', async (t) => {
  const start = state('center', { policy: policy({ include: [] }) })
  const calls = []
  const ui = await mount(t, start, answer(start), {
    extra: { uiWorkspace: { startSession: (id, options) => { calls.push(options); return {} } } },
  })
  // The three steps and the paste box are on screen before any click.
  assert.ok(ui.all().includes('The agent answers with a JSON array'), ui.all())
  assert.ok(ui.all().includes('Paste that JSON here and import'), ui.all())
  await ui.fillTextarea('Paste the JSON array returned by the agent.', '')
  await ui.click('Ask the agent for suggestions')
  assert.equal(calls.length, 1)
  assert.ok(calls[0].prompt.includes('Return a JSON array only'))
  assert.ok(calls[0].prompt.includes('- alpha (enabled)'))
})

hookTest('a surface without a chat shows the fallback instead of failing silently', async (t) => {
  const start = state('center', { policy: policy({ include: [] }) })
  const ui = await mount(t, start, answer(start))
  await ui.click('Ask the agent for suggestions')
  assert.ok(ui.all().includes('This surface cannot open a chat'), ui.all())
})
