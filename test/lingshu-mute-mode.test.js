import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  configureMute, resetMuteState, resolveGate, setSessionMute, setWorkspaceMute,
  snapshot, workspaceMuteInfo, MODE_NO_READ, MODE_MUTE,
} from '../lib/mute/mute_state.js'
import { parseMuteCommand } from '../lib/mute/index.js'

function freshState() {
  const dir = mkdtempSync(join(tmpdir(), 'lingshu-mute-mode-'))
  const file = join(dir, 'mute.json')
  resetMuteState()
  configureMute({ statePath: file })
  return file
}

test('no_read mode persists on a session and resolves as muted + noRead', async () => {
  const file = freshState()
  await setSessionMute('session-a', true, '/ws/project', MODE_NO_READ)
  const gate = resolveGate({ sessionId: 'session-a', cwd: '/ws/project' })
  assert.equal(gate.muted, true)
  assert.equal(gate.scope, 'session')
  assert.equal(gate.mode, MODE_NO_READ)
  assert.equal(gate.noRead, true)
  const snap = snapshot()
  assert.equal(snap.sessions['session-a'].mode, MODE_NO_READ)
  // 原 at 在改模式时保留
  const at = snap.sessions['session-a'].at
  await setSessionMute('session-a', true, '/ws/project', MODE_MUTE)
  const after = snapshot().sessions['session-a']
  assert.equal(after.at, at)
  assert.equal(after.mode, undefined) // 缺省 'mute' 不落字段
  assert.equal(resolveGate({ sessionId: 'session-a' }).noRead, false)
  await setSessionMute('session-a', false)
  assert.equal(resolveGate({ sessionId: 'session-a' }).muted, false)
})

test('no_read mode works on workspaces and is the strictest matching entry', async () => {
  freshState()
  await setWorkspaceMute('/ws/project', true, MODE_NO_READ)
  const info = workspaceMuteInfo('/ws/project/sub')
  assert.equal(info.muted, true)
  assert.equal(info.mode, MODE_NO_READ)
  assert.equal(info.noRead, true)
  const gate = resolveGate({ cwd: '/ws/project/sub' })
  assert.equal(gate.mode, MODE_NO_READ)
  await setWorkspaceMute('/ws/project', false)
  assert.equal(workspaceMuteInfo('/ws/project/sub').muted, false)
})

test('legacy state files without mode load as plain mute (fail-open)', async () => {
  const file = freshState()
  writeFileSync(file, JSON.stringify({
    version: 1,
    sessions: { 'old-sid': { at: new Date().toISOString(), cwd: '/ws/old' } },
    workspaces: { '/ws/old': { at: new Date().toISOString() } },
    updatedAt: '',
  }))
  resetMuteState()
  configureMute({ statePath: file })
  const gate = resolveGate({ sessionId: 'old-sid' })
  assert.equal(gate.muted, true)
  assert.equal(gate.mode, MODE_MUTE)
  assert.equal(gate.noRead, false)
})

test('/mute noread parses as a third action and keeps scope/path/json', () => {
  assert.deepEqual(parseMuteCommand('/mute noread session --json'), {
    action: 'noread', scope: 'session', path: '', json: true,
  })
  assert.deepEqual(parseMuteCommand('/mute noread workspace /ws/project --json'), {
    action: 'noread', scope: 'workspace', path: '/ws/project', json: true,
  })
  assert.deepEqual(parseMuteCommand('/mute on session --json'), {
    action: 'on', scope: 'session', path: '', json: true,
  })
  assert.deepEqual(parseMuteCommand('/mute off session --json'), {
    action: 'off', scope: 'session', path: '', json: true,
  })
})
