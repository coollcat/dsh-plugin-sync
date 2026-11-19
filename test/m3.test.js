import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { collectMemory, writeMemory, safePath } from '../lib/memory.js'
import { resourceHash } from '../lib/protocol.js'
import { analyzeMemory, validateAdopted } from '../lib/advisor.js'
import { buildMemoryPlan } from '../lib/planner.js'
import { defaultPolicy } from '../lib/policy.js'
import { createEngine } from '../lib/engine.js'

const adapters = [{ id: 'memory', root: '~/.dsh/memory', extensions: ['.md'], maxBytes: 4096 }]

test('memory adapter rejects traversal, absolute paths and symlink escape', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-mem-'))
  const file = path.join(home, '.dsh', 'memory', 'ok.md')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'hello')
  assert.throws(() => safePath(home, adapters[0], '../outside.md'), /path-escape|absolute-path/)
  assert.throws(() => safePath(home, adapters[0], '/etc/passwd'), /absolute-path/)
  const outside = path.join(home, 'outside.md')
  const link = path.join(home, '.dsh', 'memory', 'link.md')
  fs.writeFileSync(outside, 'secret')
  fs.symlinkSync(outside, link)
  assert.throws(() => safePath(home, adapters[0], 'link.md'), /symlink-escape/)
})

test('memory collection and write use bounded, hashed records', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-mem-'))
  const root = path.join(home, '.dsh', 'memory')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'a.md'), 'alpha')
  const { records } = collectMemory({ home, adapters })
  assert.equal(records.length, 1)
  assert.equal(records[0].key, 'memory:a.md')
  writeMemory({ home, adapters, adapterId: 'memory', relativePath: 'a.md', content: 'beta', expectedHash: records[0].contentHash })
  assert.equal(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), 'beta')
  assert.throws(() => writeMemory({ home, adapters, adapterId: 'memory', relativePath: 'a.md', content: 'x', expectedHash: records[0].contentHash }), /baseline-changed/)
})

test('advisor is suggestion-only and classifies identity files as local', () => {
  const records = [
    { key: 'memory:notes.md', adapterId: 'memory', relativePath: 'notes.md', content: 'plain note' },
    { key: 'soul:SOUL.md', adapterId: 'soul', relativePath: 'SOUL.md', content: 'persona text' },
    { key: 'memory:host-info.md', adapterId: 'memory', relativePath: 'host-info.md', content: 'x' },
  ]
  const suggestions = analyzeMemory(records)
  assert.equal(suggestions.find((s) => s.key === 'memory:notes.md').action, 'sync')
  assert.equal(suggestions.find((s) => s.key === 'soul:SOUL.md').action, 'localOnly')
  assert.equal(suggestions.find((s) => s.key === 'memory:host-info.md').action, 'localOnly')
  assert.deepEqual(validateAdopted(suggestions, ['nope']), [])
})

test('adoption updates local policy but never writes memory files', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-mem-'))
  const root = path.join(home, '.dsh', 'memory')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'a.md'), 'alpha')
  const store = { value: null, read() { return this.value }, write(v) { this.value = v } }
  const engine = createEngine({ store, adapters: {
    profileId: 'p', label: 'P', collectInventory: async () => [],
    collectConfig: async () => [], collectMemory: async () => (collectMemory({ home, adapters })),
    install: async () => ({}), upgrade: async () => ({}), setEnabled: async () => ({}),
    writeConfig: async () => ({}), writeMemory: async () => { throw new Error('must-not-write') },
    putSecret: async () => {}, getSecret: async () => null,
  } })
  const { suggestions } = await engine.suggestMemory()
  const target = suggestions.find((s) => s.key === 'memory:a.md')
  const result = await engine.adoptSuggestions({ ids: [target.id], actor: 'user' })
  assert.equal(result.ok, true)
  assert.ok(result.policy.include.includes('memory:a.md'))
  assert.equal(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), 'alpha')
})

test('memory plan keeps concurrent edits as conflicts', () => {
  const record = (content) => {
    const value = { kind: 'memory', schemaVersion: 1, key: 'memory:a.md', adapterId: 'memory', relativePath: 'a.md', content }
    return { ...value, contentHash: resourceHash(value) }
  }
  const plan = buildMemoryPlan({
    expected: [record('center')], local: [record('local')],
    baselines: { 'memory:a.md': record('base').contentHash },
    policy: defaultPolicy({ include: ['memory:a.md'], caps: { memWrite: true } }),
  })
  assert.equal(plan.operations.length, 0)
  assert.equal(plan.conflicts[0].kind, 'concurrent-memory-change')
})

test('memory writes refuse a path owned by another profile', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-owner-'))
  const root = path.join(home, '.dsh', 'memory')
  fs.mkdirSync(root, { recursive: true })
  const target = path.join(root, 'shared.md')
  fs.writeFileSync(target, 'shared')
  fs.writeFileSync(`${target}.owner`, 'other-profile')
  assert.throws(() => writeMemory({
    home, adapters, adapterId: 'memory', relativePath: 'shared.md', content: 'x', owner: 'this-profile',
  }), /owned-by-other-profile/)
  assert.equal(fs.readFileSync(target, 'utf8'), 'shared')
  writeMemory({ home, adapters, adapterId: 'memory', relativePath: 'shared.md', content: 'y', owner: 'other-profile' })
  assert.equal(fs.readFileSync(target, 'utf8'), 'y')
})

test('memory write rejects a symlinked parent directory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sync-parent-'))
  const root = path.join(home, '.dsh', 'memory')
  fs.mkdirSync(root, { recursive: true })
  const outside = path.join(home, 'outside')
  fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(root, 'sub'))
  assert.throws(() => writeMemory({
    home, adapters, adapterId: 'memory', relativePath: 'sub/escape.md', content: 'PWN', owner: 'p',
  }), /symlink-escape/)
  assert.equal(fs.existsSync(path.join(outside, 'escape.md')), false)
})
