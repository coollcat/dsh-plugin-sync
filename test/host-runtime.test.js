import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { Readable } from 'node:stream'
import { profileScope, createStore, createHostAudit, credentialAddress, createCredentialAdapter, archiveDecisions, unwrap, readBody } from '../lib/host-runtime.js'
import { apply, inject, createInventoryAdapter, resourceCatalogue } from '../index.js'

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sync-host-'))
const validState = () => ({ version: 1, identity: {}, policy: {}, audit: [] })
function scope(home = temporary(), name = 'web') { return profileScope({ home, name, dir: path.join(home, 'profiles', name) }) }
function row(id = 'third-party', name = 'third-party') { return { entry: { options: { id, name, config: { nested: { value: 1, password: 'local-password', local: 'keep' }, outside: 8 } }, fiber: { state: 2 } }, inherited: { inheritedOnly: 4 }, override: {} } }

test('profile and credential identities isolate home, profile and caller key', async () => {
  const home = temporary(), a = scope(home, 'a'), b = scope(home, 'b')
  assert.notEqual(a.dir, b.dir)
  assert.notEqual(credentialAddress(a, 'center'), credentialAddress(b, 'center'))
  assert.notEqual(credentialAddress(a, 'center'), credentialAddress(a, 'snapshot'))
  const records = new Map()
  const ctx = { get: () => ({ modifyRecord: async (k, f) => records.set(k, f()), readRecord: async k => records.get(k) }) }
  const x = createCredentialAdapter(ctx, a), y = createCredentialAdapter(ctx, b)
  await x.putSecret('center', 'one'); await x.putSecret('snapshot', 'two'); await y.putSecret('center', 'three')
  assert.equal(await x.getSecret('center'), 'one'); assert.equal(await x.getSecret('snapshot'), 'two'); assert.equal(await y.getSecret('center'), 'three')
})
test('credential adapter deletes scoped records and tolerates a service without deleteRecord', async () => {
  const currentScope = scope()
  const records = new Map([[credentialAddress(currentScope, 'center'), { key: 'stored-secret' }]])
  const ctx = { get: () => ({
    readRecord: async key => records.get(key),
    modifyRecord: async () => {},
    deleteRecord: async key => { records.delete(key) },
  }) }
  const adapter = createCredentialAdapter(ctx, currentScope)
  assert.equal(await adapter.getSecret('center'), 'stored-secret')
  await adapter.deleteSecret('center')
  assert.equal(await adapter.getSecret('center'), null)
  const limited = { get: () => ({ readRecord: async () => ({ key: 'still-there' }) }) }
  await createCredentialAdapter(limited, currentScope).deleteSecret('center')
  assert.equal(await createCredentialAdapter(limited, currentScope).getSecret('center'), 'still-there')
})
test('store fails closed, refuses symlinks, writes private compact atomic snapshots', () => {
  const dir = path.join(temporary(), 'state'), store = createStore(dir), file = path.join(dir, 'state.json')
  assert.equal(store.read(), null)
  store.write(validState()); assert.deepEqual(store.read(), validState())
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(fs.readdirSync(dir), ['state.json'])
  fs.writeFileSync(file, '{broken'); assert.throws(() => store.read(), /state-read-failed/)
  fs.writeFileSync(file, JSON.stringify({ ...validState(), version: 99 })); assert.throws(() => store.read(), /state-read-failed/)
  fs.writeFileSync(file, JSON.stringify(validState())); fs.linkSync(file, path.join(dir, 'hardlink'))
  assert.throws(() => store.read(), /unsafe-state-file/); fs.unlinkSync(path.join(dir, 'hardlink'))
  fs.unlinkSync(file); fs.symlinkSync(path.join(dir, 'missing'), file)
  assert.throws(() => store.read(), /unsafe-state-file/); assert.throws(() => store.write(validState()), /unsafe-state-file/)
  const root = temporary(); fs.symlinkSync(dir, path.join(root, 'link'))
  assert.throws(() => createStore(path.join(root, 'link', 'child')), /unsafe-state-directory/)
})
test('bounded audit sequence survives rollover and restart without caller override', () => {
  const audit = createHostAudit({ limit: 2 })
  for (let i = 0; i < 8; i++) audit.append({ seq: 0, token: 'secret' })
  assert.deepEqual(audit.entries().map(x => x.seq), [7, 8])
  assert.equal(audit.entries()[0].token, '[redacted]')
  const next = createHostAudit({ limit: 2 }); next.replaceLoaded(audit.entries()); assert.equal(next.append({}).seq, 9)
  assert.throws(() => next.replaceLoaded([{ seq: 2 }, { seq: 2 }]), /invalid-audit-sequence/)
})
test('manager failure, override, warnings and update restoration are not success', async () => {
  for (const application of ['failed', 'overridden', 'cancelled']) assert.throws(() => unwrap({ application }, 'install'))
  assert.throws(() => unwrap({ application: 'applied', warnings: ['inactive'] }, 'enable'))
  let options
  const manager = { installBundle: async (_, value) => { options = value; return { application: 'applied' } }, updateBundle: async () => ({ step: 'install', result: { application: 'restart-required' } }) }
  const adapter = createInventoryAdapter({ get: () => manager }, scope())
  await adapter.install({ type: 'registry', package: 'example', version: '1.0.0' }); assert.equal(options.enabled, false)
  assert.equal((await adapter.upgrade({ type: 'registry', package: 'example', version: '1.1.0' })).restartRequired, true)
  manager.updateBundle = async () => ({ step: 'install', result: { application: 'failed' }, restore: { application: 'applied' } })
  await assert.rejects(adapter.upgrade({ type: 'registry' }))
})
test('config collection rejects duplicate inactive self official rows and uses effective config', async () => {
  const keep = row(), duplicate = row('dupe'), inactive = row('inactive'), official = row('official', '@deepseek-ai/official'), self = row('self', '@local/dsh-plugin-sync')
  inactive.entry.fiber.state = 0
  let rows = [keep, duplicate, row('dupe'), inactive, official, self], saved
  const editor = { configuration: () => rows, edit: async (entry, update) => { saved = update({ ...entry.options.config, lateLocal: 9 }) } }
  const adapter = createInventoryAdapter({ get: service => service === 'configEditor' ? editor : { listBundles: async () => [{ name: 'third-party-bundle', installed: true, enabled: true, rows: [{ rowId: 'third-party', moduleName: 'third-party' }] }] } }, scope())
  const collected = await adapter.collectConfig(); assert.equal(collected.length, 1); assert.equal(collected[0].config.inheritedOnly, undefined)
  await adapter.writeConfig({ entryId: 'third-party', bundle: 'third-party-bundle', fields: [['nested']], config: { nested: { value: 2, password: 'remote-password', token: 'remote-token' }, outside: 0 } })
  assert.equal(saved.nested.value, 2); assert.equal(saved.nested.password, 'local-password'); assert.equal(saved.nested.token, undefined)
  assert.equal(saved.outside, 8); assert.equal(saved.lateLocal, 9)
  await assert.rejects(adapter.writeConfig({ entryId: 'third-party', bundle: 'different', fields: [['nested']], config: {} }))
  keep.entry.fiber.state = 0
  await assert.rejects(adapter.writeConfig({ entryId: 'third-party', bundle: 'third-party-bundle', fields: [['nested']], config: {} }))
})
test('config ownership rejects official bundles and ambiguous bundle row ownership', async () => {
  const entry = row()
  const owner = { name: 'innocent-bundle', installed: true, enabled: true, rows: [{ rowId: 'third-party', moduleName: 'third-party' }] }
  let bundles = [{ ...owner, official: true }]
  const editor = { configuration: () => [entry], edit: async () => assert.fail('unwritable entry reached editor') }
  const adapter = createInventoryAdapter({ get: name => name === 'configEditor' ? editor : { listBundles: async () => bundles } }, scope())
  assert.deepEqual(await adapter.collectConfig(), [])
  await assert.rejects(adapter.writeConfig({ entryId: 'third-party', bundle: owner.name, fields: [['nested']], config: {} }))
  bundles = [owner, { ...owner, name: 'second-owner' }]
  assert.deepEqual(await adapter.collectConfig(), [])
  await assert.rejects(adapter.writeConfig({ entryId: 'third-party', bundle: owner.name, fields: [['nested']], config: {} }))
})
test('config callback rechecks live row and projected baseline under editor lock', async () => {
  const entry = row()
  const owner = { name: 'third-party-bundle', installed: true, enabled: true, rows: [{ rowId: 'third-party', moduleName: 'third-party' }] }
  let saved
  const editor = { configuration: () => [entry], edit: async (_, update) => { saved = update(entry.entry.options.config) } }
  const adapter = createInventoryAdapter({ get: name => name === 'configEditor' ? editor : { listBundles: async () => [owner] } }, scope())
  const args = { entryId: 'third-party', bundle: owner.name, config: { nested: { value: 2 } }, fields: [['nested', 'value']] }
  await assert.rejects(adapter.writeConfig({ ...args, expectedHash: 'stale' }), /config-baseline-changed/)
  assert.equal(saved, undefined)
  await assert.rejects(adapter.writeConfig({ ...args, expectedHash: null }), /config-baseline-changed/)
  assert.equal(saved, undefined)
  editor.edit = async (_, update) => { entry.entry.fiber.state = 0; saved = update(entry.entry.options.config) }
  await assert.rejects(adapter.writeConfig(args), /config-entry-not-addressable/)
  assert.equal(saved, undefined)
})
test('local resource catalogue contains only selectable addresses and no values', async () => {
  const catalogue = await resourceCatalogue({
    collectInventory: async () => [{ key: 'example', enabled: true, source: { private: 'never-return' } }],
    collectConfig: async () => [{ key: 'entry', entryId: 'entry', bundle: 'example', config: { nested: { value: 'never-return', password: 'never-return' }, 'literal.key': true } }],
  })
  assert.equal(JSON.stringify(catalogue).includes('never-return'), false)
  assert.deepEqual(catalogue.plugins, [{ key: 'example', enabled: true }])
  assert.deepEqual(catalogue.configs[0].fields, [['nested', 'value'], ['literal.key']])
  assert.equal('memories' in catalogue, false)
})
test('manual proposal archival writes and verifies a private backup before queue removal', () => {
  const currentScope = scope()
  const records = { proposals: [{ id: 'example', status: 'accepted' }], conflicts: [] }
  const result = archiveDecisions(currentScope, records)
  assert.match(result.archiveId, /^proposals-[0-9]+-[a-f0-9]{16}\.json$/)
  const file = path.join(currentScope.dir, 'archives', result.archiveId)
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).proposals, records.proposals)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})
test('HTTP body enforces bytes, object JSON, and a finite deadline', async () => {
  await assert.rejects(readBody(Object.assign(Readable.from(['"éé"']), { headers: {} }), { maxBytes: 5 }), /payload-too-large/)
  await assert.rejects(readBody(Object.assign(Readable.from(['[]']), { headers: {} })), /invalid-body/)
  const stalled = new Readable({ read() {} }); stalled.headers = {}
  await assert.rejects(readBody(stalled, { timeoutMs: 10 }), /body-timeout/); stalled.destroy()
})

test('host activation and real HTTP harness preserve auth, origin, exact routes and business errors', async t => {
  assert.ok(inject.includes('profileContext'))
  const home = temporary(), effects = [], registrations = [], toolRecords = []
  const services = {
    profileContext: { name: 'isolated', home, dir: path.join(home, 'profiles', 'isolated') },
    connection: { requestRejection: req => req.headers['x-test-auth'] === 'owner' ? undefined : 401 },
    webServer: { protocol: 'http:', register: r => { registrations.push(r); return () => {} } },
    tools: { register: tool => { toolRecords.push(tool); return () => {} } },
    pluginManager: { listBundles: async () => [] }, configEditor: { configuration: () => [] }, credentials: {},
  }
  const ctx = { get(name) { if (!inject.includes(name)) throw new Error(`undeclared-service:${name}`); return services[name] }, inject() {}, effect(fn) { effects.push(fn()) } }
  // The merged lingshu-mute host returns an async install promise; await it so
  // the test does not end with a pending promise.
  await apply(ctx)
  t.after(() => effects.forEach(clean => typeof clean === 'function' && clean()))
  // The merged lingshu-mute host registers its own prefix; the sync prefix must
  // still be the one this test drives.
  const syncRoute = registrations.find((entry) => entry.path === '/plugin-sync')
  assert.ok(syncRoute && typeof syncRoute.handler === 'function')
  const server = http.createServer(syncRoute.handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const request = async (route, body = { action: 'state' }, headers = {}, method = 'POST') => {
    const response = await fetch(base + route, { method, headers: { 'content-type': 'application/json', 'x-test-auth': 'owner', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json() }
  }
  assert.equal((await request('/plugin-sync/api/action', {}, { 'x-test-auth': '' })).status, 401)
  assert.equal((await request('/plugin-sync/api/action', {}, { origin: 'https://attacker.invalid' })).status, 403)
  assert.equal((await request('/plugin-sync/api/action', {}, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await request('/plugin-sync/api/action', {}, {}, 'GET')).status, 405)
  assert.equal((await request('/plugin-sync/api/action/extra')).status, 404)
  assert.equal((await request('/plugin-sync-evil/api/action')).status, 404)
  const state = await request('/plugin-sync/api/action'); assert.equal(state.status, 200); assert.equal(state.body.value.identity.profileId, 'isolated')
  assert.equal((await request('/plugin-sync/api/action', { action: 'pairCenter', label: 'harness' })).status, 200)
  const rejectedMissing = await request('/plugin-sync/api/action', { action: 'rejectProposal', proposalId: 'absent', actor: 'agent' })
  assert.equal(rejectedMissing.status, 409)
  assert.equal(rejectedMissing.body.value.reason, 'proposal-not-pending')
  assert.equal((await request('/plugin-sync/hello', { identity: { deviceId: 'fake', profileId: 'isolated', label: 'test', role: 'device' } })).status, 401)
  assert.equal((await request('/plugin-sync/state', { deviceId: 5 })).status, 400)
  const secret = await request('/plugin-sync/api/action', { action: 'unknown-secret-test' }); assert.equal(secret.body.error, 'request-failed')
  assert.deepEqual(await toolRecords[0].execute({ action: 'autoSync' }), { ok: false, error: 'action-not-allowed-for-agent' })
  const malformed = await new Promise(resolve => syncRoute.handler({ url: 'http://[', headers: {} }, { setHeader() {}, end(text) { resolve(JSON.parse(text)) } }))
  assert.equal(malformed.error, 'request-failed')
  const dir = profileScope(services.profileContext).dir; assert.equal(fs.existsSync(path.join(dir, 'state.json')), true)
  const verify = await request('/plugin-sync/api/action', { action: 'verify', token: 'fake-token', url: 'http://192.0.2.10:3080' })
  assert.equal(verify.status, 400); assert.equal(verify.body.error, 'request-failed')
  const reset = await request('/plugin-sync/api/action', { action: 'reset' })
  assert.equal(reset.status, 200); assert.equal(reset.body.value.identity.role, 'unpaired')
})
