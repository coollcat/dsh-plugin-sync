// Lingshu/memory settings are device state: they must never be offered as a
// switchable settings surface, and a hand-edited policy must not turn them into
// a remote write target. The gate has to agree in all three places — catalogue
// (what the UI may offer), policy (what the engine allows) and the planner
// (what a plan actually contains).
import test from 'node:test'
import assert from 'node:assert/strict'

import { defaultPolicy, evaluate } from '../lib/policy.js'
import { configRecord, settingsLocalOnly } from '../lib/config.js'
import { buildConfigPlan } from '../lib/planner.js'
import { resourceCatalogue } from '../index.js'

test('device-bound settings are recognised by bundle, entry ID and product name', () => {
  assert.equal(settingsLocalOnly('@furongjun1999/dsh-memory'), true)
  assert.equal(settingsLocalOnly('include:furongjun1999-dsh-memory'), true)
  assert.equal(settingsLocalOnly('dsh-memory'), true)
  assert.equal(settingsLocalOnly('@local/lingshu-graph'), true)
  assert.equal(settingsLocalOnly('dsh-free-search'), false)
  assert.equal(settingsLocalOnly('@xmanrui/dsh-im'), false) // IM settings stay selectable, off by default
  assert.equal(settingsLocalOnly(undefined), false)
})

test('the catalogue never marks a memory entry eligible, whatever its field count', async () => {
  const catalogue = await resourceCatalogue({
    collectInventory: async () => [
      { key: '@furongjun1999/dsh-memory', enabled: true },
      { key: 'pkg', enabled: true },
    ],
    collectConfig: async () => [
      { key: 'mem-config', entryId: 'mem-config', bundle: '@furongjun1999/dsh-memory', config: { root: '/srv/memory', python: '/usr/bin/python3' } },
      { key: 'two', entryId: 'two', bundle: 'pkg', config: { theme: 'dark', density: 2 } },
    ],
  })
  const byId = Object.fromEntries(catalogue.configs.map((entry) => [entry.entryId, entry]))
  assert.equal(byId['mem-config'].fields.length, 2)
  assert.equal(byId['mem-config'].eligible, false)
  assert.equal(byId.two.eligible, true)
})

test('a policy that names a memory entry is refused and produces no write', () => {
  const memory = configRecord({
    entryId: 'mem-config', bundle: '@furongjun1999/dsh-memory',
    config: { root: '/srv/memory', python: '/usr/bin/python3' },
  })
  const policy = defaultPolicy({
    include: ['mem-config'],
    configFields: { 'mem-config': [['root'], ['python']] },
    caps: { configSet: true },
  })
  const decision = evaluate(policy, { ...memory, requiresCap: 'configSet' }, 'pull')
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'config-device-bound')
  const plan = buildConfigPlan({ expected: [memory], local: [], baselines: {}, policy })
  assert.equal(plan.operations.length, 0)
  assert.ok(plan.skipped.some((item) => item.reason === 'config-device-bound'))
})
