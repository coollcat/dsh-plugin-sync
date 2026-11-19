// Browser half. DSH supplies React and owns both slots.
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-sync',
  factory(require) {
    const { createElement: h, useState, useEffect, useCallback, useRef } = require('react')
    const NS = 'pluginSync'
    const en = {
      tab: 'Device sync', settings: 'Device sync settings', loading: 'Loading device sync…', retry: 'Retry',
      loadingFailed: 'Could not load device sync settings.', busy: 'Working…', done: 'Completed',
      failed: 'The operation failed.', network: 'Network unavailable. Check the connection and retry.',
      offline: 'The remote request failed.', unauthorized: 'Not authorized.', 'not-found': 'Sync service unavailable.',
      suspended: 'Sync is paused.', expired: 'Plan expired. Check differences again.',
      'plan-not-found': 'Plan unavailable. Check differences again.', 'no-snapshot': 'No snapshot is loaded.',
      'direction-blocked': 'This operation is blocked by the sync direction.', 'invalid-policy': 'The policy was rejected.',
      'peer-state-unavailable': 'Wait for the paired device to check differences once; this endpoint has not received its shared state yet.',
      peerQueue: 'This endpoint sends queued proposals when the paired device next checks differences.',
      'invalid-invitation': 'Invalid invitation.', 'invitation-expired': 'Invitation expired.',
      'https-required-outside-loopback': 'Use HTTPS for non-loopback addresses.',
      'unresolved-conflict': 'Resolve conflicts before continuing.', 'invalid-json': 'Invalid JSON.',
      'payload-too-large': 'The data exceeds the size limit.', 'digest-mismatch': 'Snapshot integrity check failed.',
      'invalid-snapshot': 'The snapshot was rejected.', 'signature-required': 'A verified signature is required.',
      'already-paired': 'This profile is already paired.', 'no-approval': 'Approve selected operations first.',
      'no-operation-approved': 'Approve at least one operation.', 'bad-response': 'The sync service returned an invalid response.',
      unpaired: 'Not paired', center: 'Center', device: 'Device', peer: 'Peer', connection: 'Connection',
      waitingForPeer: 'Waiting for an incoming request', unconfirmed: 'Connection not yet confirmed',
      recentSuccess: 'Last request succeeded', recentFailure: 'Last request failed', lastSeen: 'Last contact',
      revision: 'Revision', refresh: 'Refresh status', pause: 'Pause sync', resume: 'Resume sync', paused: 'Paused', nodes: 'Nodes',
      peerLimit: 'This point-to-point endpoint already has a peer. Revoke its access before inviting another.',
      createCenter: 'Create center', joinCenter: 'Join center', listenPeer: 'Create peer invitation endpoint',
      connectPeer: 'Connect to peer', initLocal: 'Start from this profile', initEmpty: 'Start empty',
      endpoint: 'Remote URL', invitation: 'Invitation token', generateInvite: 'Generate invitation',
      hideInvite: 'Hide invitation', inviteExpires: 'Expires', label: 'Profile label',
      secureHint: 'Use HTTPS or a loopback SSH tunnel. Anyone who has the invitation token can use it; share it privately.',
      sshHint: 'The system OpenSSH client uses strict host verification. This plugin does not store your private key.',
      sshHost: 'SSH host', sshUser: 'SSH user', sshIdentity: 'Private key file path', sshKnownHosts: 'known_hosts path', sshRemotePort: 'Remote port',
      check: 'Check plugin differences', checkConfig: 'Check config differences', checkMemory: 'Check memory differences',
      submit: 'Submit plugin proposal', submitConfig: 'Submit config proposal', submitMemory: 'Submit memory proposal',
      proposals: 'Device proposals', refreshProposals: 'Refresh proposals', noProposals: 'No pending proposals',
      publish: 'Accept and publish', reject: 'Reject proposal', revoke: 'Revoke peer access', revoked: 'Access revoked',
      publishLocal: 'Publish selected local resources', from: 'From', resources: 'Resources', openConflicts: 'Proposal conflicts',
      plan: 'Plugin plan', configPlan: 'Plugin configuration plan', memoryPlan: 'Memory plan', noPlan: 'No plan yet',
      status: 'Status', noChanges: 'No applicable changes', pending: 'Awaiting approval', approved: 'Approved',
      approve: 'Approve selected operations', apply: 'Apply approved operations', operations: 'Operations', skipped: 'Skipped',
      conflicts: 'Conflicts', base: 'Baseline', local: 'Local', remote: 'Incoming', resolveLocal: 'Keep local', resolveRemote: 'Use incoming',
      conflictHint: 'Only fingerprints are shown. They indicate which versions differ without displaying configuration values or memory text.',
      needsRestart: 'Restart required', applied: 'Applied', partial: 'Partially applied', rejected: 'Rejected',
      compensationFailed: 'Failed', conflict: 'Conflict', accepted: 'Accepted', duplicate: 'Already submitted',
      published: 'Published', queued: 'Queued', updated: 'Updated', highRisk: 'High risk',
      localOnlyReason: 'Local only', excludedReason: 'Excluded', protectedReason: 'System protected',
      capReason: 'Capability disabled', absentReason: 'Absent is not a delete',
      mode: 'Mode', manual: 'Manual', selective: 'Selective', managed: 'Managed', auto: 'Automatic reconciliation (managed only)',
      interval: 'Check interval (ms)', direction: 'Direction', both: 'Push and pull', push: 'Push only', pull: 'Pull only',
      install: 'Install', upgrade: 'Upgrade', enable: 'Enable', disable: 'Disable', configSet: 'Write plugin config', memWrite: 'Write memory',
      include: 'Include', exclude: 'Exclude', localOnly: 'Local only', configFields: 'Allowed configuration fields (JSON)',
      keysHint: 'Enter one exact resource key per line, for example a package, config or memory key as shown in its plan. A trailing * in an existing rule matches a prefix.',
      fieldsHint: 'Use {"entryId":[["parent","field"]]}. Each path is an array of literal key segments. For unknown schemas, names cannot identify all secrets. Select only fields you know are safe to share.',
      fieldsInvalid: 'Enter a JSON object mapping entry IDs to arrays of nonempty key paths.',
      intervalInvalid: 'Enter a whole interval between 60000 and 86400000 ms.',
      settingsHint: 'Policy applies to this profile. Configuration and memory are excluded from export by default.',
      noDelete: 'Uninstall is not propagated.', autoHint: 'Auto-apply is limited to low-risk enable, disable and config writes. Memory, installation and upgrades require approval.',
      savePolicy: 'Save policy', saved: 'Policy saved', aiProvider: 'AI provider ID', aiModel: 'AI model ID', aiEnabled: 'Enable model suggestions',
      costHint: 'Model suggestions send resource metadata to the configured provider and may incur charges.',
      scanSuggestions: 'Scan for suggestions', suggestions: 'Memory suggestions', noSuggestions: 'No suggestions',
      adoptSync: 'Add to sync scope', adoptLocal: 'Keep local only',
      snapshot: 'Offline snapshot', exportSnapshot: 'Export snapshot', importSnapshot: 'Import and check differences',
      snapshotText: 'Snapshot JSON', unsigned: 'Unsigned snapshot. Its source is untrusted. Review and approve each operation before applying.',
      snapshotApproval: 'Offline snapshot. Review and approve each operation before applying.', snapshotLoaded: 'Snapshot loaded and plans checked.',
      activity: 'Recent activity', inventory: 'View selectable local resources', inventoryLoaded: 'Local resource list loaded',
      inventoryHint: 'Loaded only when requested. Select keys and individual configuration paths to edit this draft, then save the policy. Capabilities still control what may be applied.',
      inventoryEmpty: 'No selectable local resources', fieldPath: 'Configuration path',
      archiveDecisions: 'Archive processed proposals', archived: 'Archived',
      'archive-failed': 'Archiving failed. The proposals remain in the current list.',
      'archive-unavailable': 'Local proposal archiving is unavailable.', 'no-decisions-to-archive': 'No accepted or rejected proposals to archive.',
      archiveHint: 'Back up accepted and rejected proposals in this profile before removing them from the current list. Pending proposals are kept.',
    }
    const zh = {
      tab: '设备同步', settings: '设备同步设置', loading: '正在读取设备同步设置…', retry: '重试',
      loadingFailed: '无法读取设备同步设置。', busy: '正在处理…', done: '操作完成',
      failed: '操作失败。', network: '网络不可用，请检查连接后重试。',
      offline: '对端请求失败。', unauthorized: '未获授权。', 'not-found': '同步服务不可用。',
      suspended: '同步已暂停。', expired: '计划已过期，请重新检查差异。',
      'plan-not-found': '计划不可用，请重新检查差异。', 'no-snapshot': '还没有导入快照。',
      'direction-blocked': '当前同步方向不允许此操作。', 'invalid-policy': '策略未通过校验。',
      'peer-state-unavailable': '请先让已配对的另一端检查一次差异，本端尚未收到它的共享状态。',
      peerQueue: '本端提案会排队，等另一端下次检查差异时送达。',
      'invalid-invitation': '邀请无效。', 'invitation-expired': '邀请已过期。',
      'https-required-outside-loopback': '非回环地址必须使用 HTTPS。',
      'unresolved-conflict': '请先处理冲突。', 'invalid-json': 'JSON 格式错误。',
      'payload-too-large': '数据超出大小限制。', 'digest-mismatch': '快照完整性校验失败。',
      'invalid-snapshot': '快照未通过校验。', 'signature-required': '此处要求验证签名。',
      'already-paired': '本 profile 已配对。', 'no-approval': '请先批准选中的操作。',
      'no-operation-approved': '请至少批准一项操作。', 'bad-response': '同步服务返回了无效响应。',
      unpaired: '未配对', center: '中心', device: '设备', peer: '点对点设备', connection: '连接状态',
      waitingForPeer: '尚未收到对端请求', unconfirmed: '连接尚未确认',
      recentSuccess: '最近请求成功', recentFailure: '最近请求失败', lastSeen: '最近联系',
      revision: '修订', refresh: '刷新状态', pause: '暂停同步', resume: '恢复同步', paused: '已暂停', nodes: '节点列表',
      peerLimit: '此点对点端已配对。撤销现有设备的访问权限后，可以邀请另一台设备。',
      createCenter: '建立中心', joinCenter: '加入中心', listenPeer: '建立点对点邀请端',
      connectPeer: '连接点对点设备', initLocal: '从本 profile 的资源开始', initEmpty: '从空状态开始',
      endpoint: '对端地址', invitation: '邀请令牌', generateInvite: '生成邀请', hideInvite: '隐藏邀请',
      inviteExpires: '到期时间', label: '本 profile 名称',
      secureHint: '使用 HTTPS 或本机 SSH 隧道。持有邀请令牌即可使用，请私下分享。',
      sshHint: '系统 OpenSSH 严格验证主机身份。插件不保存私钥。',
      sshHost: 'SSH 主机', sshUser: 'SSH 用户', sshIdentity: '私钥文件路径', sshKnownHosts: 'known_hosts 路径', sshRemotePort: '远端端口',
      check: '检查插件差异', checkConfig: '检查配置差异', checkMemory: '检查记忆差异',
      submit: '提交插件提案', submitConfig: '提交配置提案', submitMemory: '提交记忆提案',
      proposals: '设备提案', refreshProposals: '刷新提案', noProposals: '没有待审提案',
      publish: '接受并发布', reject: '拒绝提案', revoke: '撤销设备访问权限', revoked: '访问权限已撤销',
      publishLocal: '发布纳入同步范围的本机资源', from: '来源', resources: '资源数', openConflicts: '提案冲突',
      plan: '插件计划', configPlan: '插件配置计划', memoryPlan: '记忆计划', noPlan: '还没有计划',
      status: '状态', noChanges: '没有可应用的变更', pending: '等待批准', approved: '已批准',
      approve: '批准所选操作', apply: '应用已批准操作', operations: '操作', skipped: '跳过',
      conflicts: '冲突', base: '基线', local: '本机版本', remote: '传入版本', resolveLocal: '保留本机版本', resolveRemote: '采用传入版本',
      conflictHint: '这里只显示内容指纹。可据此比较版本，不会显示配置值或记忆正文。',
      needsRestart: '需重启', applied: '已应用', partial: '部分完成', rejected: '已拒绝',
      compensationFailed: '失败', conflict: '冲突', accepted: '已接受', duplicate: '已提交过',
      published: '已发布', queued: '已排队', updated: '已更新', highRisk: '高风险',
      localOnlyReason: '本机专属', excludedReason: '规则排除', protectedReason: '系统保护',
      capReason: '能力未开启', absentReason: '缺席不等于删除',
      mode: '模式', manual: '手动同步', selective: '选择性同步', managed: '完全托管', auto: '自动对账（仅完全托管模式）',
      interval: '检查间隔（毫秒）', direction: '同步方向', both: '双向', push: '只推送', pull: '只拉取',
      install: '安装', upgrade: '升级', enable: '启用', disable: '停用', configSet: '写入插件配置', memWrite: '写入记忆',
      include: '纳入同步', exclude: '排除同步', localOnly: '本机专属', configFields: '允许同步的配置字段（JSON）',
      keysHint: '每行输入一个精确资源键。插件包名、配置键和记忆键可从对应计划查看。已有规则里，末尾的 * 表示前缀匹配。',
      fieldsHint: '格式为 {"entryId":[["父键","字段"]]}。每条路径是原始键段组成的数组。对未知 schema，仅凭字段名不能识别全部秘密。请只选确认可分享的字段。',
      fieldsInvalid: '请输入 JSON 对象。每个条目 ID 对应路径数组，路径由非空键段组成。',
      intervalInvalid: '请输入 60000 到 86400000 之间的整数毫秒。',
      settingsHint: '策略仅用于本 profile。配置和记忆默认不导出。', noDelete: '卸载不传播。',
      autoHint: '自动应用仅覆盖低风险的启用、停用和配置写入。记忆写入、安装和升级仍需批准。',
      savePolicy: '保存策略', saved: '策略已保存', aiProvider: 'AI 供应商 ID', aiModel: 'AI 模型 ID', aiEnabled: '启用模型建议',
      costHint: '模型建议会把资源元数据发送给所配置的供应商，可能产生费用。',
      scanSuggestions: '扫描并生成建议', suggestions: '记忆同步建议', noSuggestions: '没有建议',
      adoptSync: '纳入同步范围', adoptLocal: '标记为本机专属',
      snapshot: '离线快照', exportSnapshot: '导出快照', importSnapshot: '导入并检查差异',
      snapshotText: '快照 JSON', unsigned: '快照未签名，来源不可信。应用前仍需逐项查看并批准。',
      snapshotApproval: '此计划来自离线快照。应用前仍需逐项查看并批准。', snapshotLoaded: '已导入快照并检查差异。',
      activity: '最近活动', inventory: '查看本机可选资源', inventoryLoaded: '已读取本机可选资源',
      inventoryHint: '仅点击时读取。勾选资源键或单个配置路径只改当前草稿，保存策略后生效；应用仍受能力开关控制。',
      inventoryEmpty: '没有可选的本机资源', fieldPath: '配置路径',
      archiveDecisions: '归档已处理提案', archived: '已归档',
      'archive-failed': '归档失败，提案仍保留在当前队列。',
      'archive-unavailable': '本机提案归档暂不可用。', 'no-decisions-to-archive': '没有已接受或已拒绝的提案可归档。',
      archiveHint: '先在本 profile 私有目录备份已接受、已拒绝提案，再移出当前队列；待审提案不受影响。',
    }
    const css = `
.ps-wrap{display:flex;flex-direction:column;gap:12px;padding:4px 0 24px;color:var(--dsw-alias-label-primary)}
.ps-card{border:1px solid var(--dsw-alias-stroke-secondary);border-radius:10px;padding:14px 16px;background:var(--dsw-alias-bg-secondary);min-width:0;overflow-wrap:anywhere}
.ps-title{font-size:14px;font-weight:600;margin:0 0 10px}
.ps-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px}
.ps-row+.ps-row,.ps-spaced{margin-top:10px}
.ps-note{margin:8px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5}
.ps-muted{color:var(--dsw-alias-label-tertiary);font-size:12px}
.ps-badge{display:inline-flex;align-items:center;border-radius:999px;padding:2px 9px;font-size:11px;border:1px solid var(--dsw-alias-stroke-secondary)}
.ps-badge.ok{color:var(--dsw-alias-state-success)}
.ps-badge.warn,.ps-card [role="alert"]{color:var(--dsw-alias-state-warning)}
.ps-button{border:1px solid var(--dsw-alias-stroke-primary);background:var(--dsw-alias-bg-tertiary);color:var(--dsw-alias-label-primary);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}
.ps-button.primary{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-on-primary);border-color:transparent}
.ps-button:disabled{opacity:.45;cursor:not-allowed}
.ps-input{border:1px solid var(--dsw-alias-stroke-primary);border-radius:7px;background:var(--dsw-alias-bg-primary);color:var(--dsw-alias-label-primary);padding:6px 9px;font-size:13px;box-sizing:border-box;max-width:100%}
.ps-field{display:flex;flex-direction:column;gap:4px;max-width:100%;min-width:0;font-size:13px}
.ps-grow{flex:1 1 190px}
.ps-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13px}
.ps-item{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px 12px;padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-tertiary)}
`
    const caps = ['install', 'upgrade', 'enable', 'disable', 'configSet', 'memWrite']
    const listFields = ['include', 'exclude', 'localOnly']
    const kinds = [
      { key: 'plugin', suffix: '', title: 'plan', check: 'check', submit: 'submit' },
      { key: 'config', suffix: 'Config', title: 'configPlan', check: 'checkConfig', submit: 'submitConfig' },
      { key: 'memory', suffix: 'Memory', title: 'memoryPlan', check: 'checkMemory', submit: 'submitMemory' },
    ]
    function uiError(code) { return { code } }
    const safeLabels = new Set(Object.keys(en))
    const statusText = (t, code, fallback = 'failed') => t(safeLabels.has(code) ? code : fallback)
    function normalizeCode(code) {
      if (typeof code !== 'string') return null
      if (code.startsWith('direction-blocked:')) return 'direction-blocked'
      if (/^http-\d{3}$/.test(code)) return ['http-401', 'http-403'].includes(code) ? 'unauthorized' : 'offline'
      if (code === 'local-access-required') return 'unauthorized'
      return code
    }
    function responseError(payload) {
      if (typeof payload?.error === 'string') return payload.error
      if (payload?.error?.code) return payload.error.code
      if (payload?.ok === false) return payload.reason ?? payload.status ?? (payload.errors ? 'invalid-policy' : null)
      return null
    }
    function actionStatusError(action, status) {
      const statuses = {
        check: ['ok'], apply: ['ok', 'partial', 'needsRestart'], proposal: ['pending', 'duplicate', 'conflict', 'queued'],
        acceptProposal: ['accepted', 'published', 'ok'], rejectProposal: ['rejected', 'ok'],
        publishLocal: ['published', 'updated', 'queued', 'ok'], revokePeer: ['revoked', 'ok'], archiveDecisions: ['archived'],
      }
      if (status && statuses[action] && !statuses[action].includes(status)) return status
      return null
    }
    // Neither arbitrary server error messages nor raw network exceptions are displayed.
    async function call(action, args = {}) {
      let response
      let raw
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), action === 'state' ? 15000 : 120000)
      try {
        response = await fetch('/plugin-sync/api/action', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...args }),
        })
        raw = await response.text()
      } catch {
        throw uiError('network')
      } finally {
        clearTimeout(timeout)
      }
      let payload
      try { payload = JSON.parse(raw) } catch { /* HTTP status still has meaning without JSON. */ }
      const value = payload?.value
      const error = normalizeCode(responseError(value) ?? actionStatusError(action, value?.status) ?? responseError(payload))
      if (error) throw uiError(error)
      if (!response.ok) {
        throw uiError(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 404 ? 'not-found' : 'failed')
      }
      if (payload?.ok !== true || !Object.hasOwn(payload, 'value')) throw uiError('bad-response')
      if (action === 'state' && (!value?.policy || !value.identity)) throw uiError('bad-response')
      return value
    }

    // A failed reload retains the previous view. Fetching state and reporting the
    // outcome of a mutation are independent to avoid treating a reload failure
    // as proof that a mutation did not happen.
    function useController() {
      const [state, setState] = useState(null)
      const [load, setLoad] = useState({ busy: true })
      const [busy, setBusy] = useState(null)
      const [feedback, setFeedback] = useState({})
      const active = useRef(null)
      const loadSeq = useRef(0)
      const refresh = useCallback(async () => {
        const seq = ++loadSeq.current
        setLoad({ busy: true })
        try {
          const next = await call('state')
          if (seq === loadSeq.current) {
            setState(next)
            setLoad({ busy: false })
          }
          return next
        } catch (error) {
          if (seq === loadSeq.current) setLoad({ busy: false, error: error?.code ?? 'failed' })
          return null
        }
      }, [])
      useEffect(() => {
        void refresh()
        return () => { loadSeq.current++ }
      }, [refresh])
      const run = async (area, task, { reload = true, success = 'done' } = {}) => {
        if (active.current !== null) return
        active.current = area
        setBusy(area)
        setFeedback((previous) => ({ ...previous, [area]: null }))
        try {
          const value = await task()
          setFeedback((previous) => ({ ...previous, [area]: { text: typeof success === 'function' ? success(value) : success } }))
        } catch (error) {
          setFeedback((previous) => ({ ...previous, [area]: { error: error?.code ?? 'failed' } }))
        } finally {
          if (reload) await refresh()
          active.current = null
          setBusy(null)
        }
      }
      return { state, load, busy, feedback, refresh, run }
    }

    const row = (...children) => h('div', { className: 'ps-row' }, ...children)
    const note = (text, role) => h('p', { className: 'ps-note', role }, text)
    function Card({ title, children }) {
      return h('section', { className: 'ps-card' }, title && h('h3', { className: 'ps-title' }, title), children)
    }
    function Button({ children, onClick, disabled, primary }) {
      return h('button', { type: 'button', className: `ps-button${primary ? ' primary' : ''}`, onClick, disabled }, children)
    }
    function Badge({ children, tone = '' }) {
      return h('span', { className: `ps-badge ${tone}` }, children)
    }
    function Feedback({ area, ctl, t }) {
      const entry = ctl.feedback[area]
      if (ctl.busy === area) return note(t('busy'), 'status')
      if (entry?.error) return note(statusText(t, entry.error), 'alert')
      if (entry?.text) return note(statusText(t, entry.text, 'done'), 'status')
      return null
    }
    function action(ctl, area, name, args, options) {
      return () => ctl.run(area, () => call(name, args), options)
    }
    const businessStatus = (value) => value?.status === 'ok' ? 'done' : value?.status ?? 'done'
    function Field({ label, value, onChange, as = 'input', options, grow = false, ...props }) {
      return h('label', { className: `ps-field${grow ? ' ps-grow' : ''}` }, label,
        h(as, { className: 'ps-input', value, onChange: (event) => onChange(event.target.value), ...props },
          options?.map(([key, text]) => h('option', { key, value: key }, text))))
    }
    function Toggle({ label, checked, onChange, disabled }) {
      return h('label', { className: 'ps-row' }, h('input', {
        type: 'checkbox', checked: Boolean(checked), disabled, onChange: (event) => onChange(event.target.checked),
      }), label)
    }

    function Pairing({ ctl, t }) {
      const [mode, setMode] = useState('pairCenter')
      const [form, setForm] = useState({ label: '', initSource: 'empty', url: '', token: '', sshRemotePort: '3080' })
      const [invitation, setInvitation] = useState(null)
      const role = ctl.state.identity.role
      const listener = isHost(ctl.state)
      const peerLimit = role === 'peer' && Object.values(ctl.state.peers ?? {}).some((peer) => peer.status === 'connected')
      const disabled = Boolean(ctl.busy) || ctl.state.suspended
      const area = 'pairing'
      const input = (key, text = key, type = 'text') => h(Field, {
        label: t(text), value: form[key] ?? '', onChange: (value) => setForm((prior) => ({ ...prior, [key]: value })), type, disabled,
        ...(key === 'token' ? { autoComplete: 'off' } : {}),
      })
      const modes = [['pairCenter', 'createCenter'], ['joinCenter', 'joinCenter'], ['listenPeer', 'listenPeer'], ['connectPeer', 'connectPeer']]
      const creating = mode === 'pairCenter' || mode === 'listenPeer'
      const submit = () => ctl.run(area, async () => {
        const label = form.label.trim() || undefined
        if (creating) {
          await call('pairCenter', { initSource: form.initSource, label, topology: mode === 'listenPeer' ? 'p2p' : 'center' })
          return
        }
        await call(mode, {
          label, url: form.url.trim(), token: form.token.trim(),
          ssh: form.sshHost ? { kind: 'ssh', host: form.sshHost, user: form.sshUser, identityFile: form.sshIdentity,
            knownHostsFile: form.sshKnownHosts, remotePort: Number(form.sshRemotePort) } : undefined,
        })
        setForm((prior) => ({ ...prior, token: '' }))
      })
      if (role !== 'unpaired' && !listener) return null
      const generate = () => ctl.run(area, async () => {
        const value = await call('invite')
        if (typeof value?.token !== 'string' || !value.token) throw uiError('bad-response')
        setInvitation(value)
      }, { reload: false })
      return h(Card, { title: t(listener ? 'invitation' : 'unpaired') },
        note(t('secureHint')),
        listener ? h('div', { className: 'ps-spaced' },
          row(h(Button, { onClick: generate, disabled: disabled || peerLimit, primary: true }, t('generateInvite')),
            invitation && h(Button, { onClick: () => setInvitation(null) }, t('hideInvite'))),
          peerLimit && note(t('peerLimit')),
          invitation && !peerLimit && row(h('code', {}, invitation.token), invitation.expiresAt && h('span', {}, `${t('inviteExpires')} ${invitation.expiresAt}`))) :
          h('div', { className: 'ps-spaced' },
            row(h(Field, { as: 'select', label: t('connection'), value: mode, onChange: setMode, disabled,
              options: modes.map(([key, text]) => [key, t(text)]) }), input('label')),
            creating ? row(h(Field, { as: 'select', label: t('from'), value: form.initSource, disabled,
              onChange: (initSource) => setForm((prior) => ({ ...prior, initSource })), options: [['empty', t('initEmpty')], ['local', t('initLocal')]] })) :
              h('div', { className: 'ps-spaced' }, row(input('url', 'endpoint', 'url'), input('token', 'invitation', 'password')),
                h('details', { className: 'ps-spaced' }, h('summary', {}, 'SSH'), note(t('sshHint')),
                  row(input('sshHost'), input('sshUser'), input('sshIdentity'), input('sshKnownHosts'), input('sshRemotePort', 'sshRemotePort', 'number')))),
            h('div', { className: 'ps-spaced' }, h(Button, { primary: true, onClick: submit, disabled: disabled || (!creating && (!form.url.trim() || !form.token.trim())) },
              t(modes.find(([key]) => key === mode)[1])))),
        h(Feedback, { area, ctl, t }))
    }

    function policyDraft(policy) {
      return {
        ...policy, intervalMs: String(policy.intervalMs ?? 300000),
        ...Object.fromEntries(listFields.map((key) => [key, (policy[key] ?? []).join('\n')])),
        configFields: JSON.stringify(policy.configFields ?? {}, null, 2),
      }
    }
    function parseConfigFields(text) {
      let fields
      try { fields = JSON.parse(text) } catch { throw uiError('fieldsInvalid') }
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.entries(fields).some(([id, paths]) =>
        !id || !Array.isArray(paths) || paths.some((path) => !Array.isArray(path) || !path.length || path.some((segment) => typeof segment !== 'string' || !segment)))) {
        throw uiError('fieldsInvalid')
      }
      return fields
    }
    function policyPayload(draft) {
      const intervalMs = Number(draft.intervalMs)
      if (!Number.isInteger(intervalMs) || intervalMs < 60000 || intervalMs > 86400000) throw uiError('intervalInvalid')
      const fields = parseConfigFields(draft.configFields)
      return {
        ...draft, intervalMs, configFields: fields,
        ...Object.fromEntries(listFields.map((key) => [key, [...new Set(draft[key].split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]])),
      }
    }
    function Resources({ ctl, t, draft, setDraft }) {
      const [inventory, setInventory] = useState(null)
      const disabled = Boolean(ctl.busy)
      const included = draft.include.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      const include = (key, checked) => [...new Set(checked ? [...included, key] : included.filter((item) => item !== key))].join('\n')
      let selectedFields = null
      try { selectedFields = parseConfigFields(draft.configFields) } catch { /* Preserve malformed drafts for correction. */ }
      const scan = () => ctl.run('inventory', async () => {
        const value = await call('inventory')
        if (!value || !['plugins', 'configs', 'memories'].every((key) => Array.isArray(value[key]))) throw uiError('bad-response')
        const keyed = (entry) => entry && typeof entry.key === 'string' && entry.key.length > 0
        setInventory({
          plugins: value.plugins.filter(keyed).map(({ key }) => ({ key })),
          configs: value.configs.filter((entry) => keyed(entry) && typeof entry.entryId === 'string' && Array.isArray(entry.fields))
            .map(({ key, entryId, fields }) => ({ key, entryId, fields: fields.filter((path) => Array.isArray(path) && path.length > 0 && path.every((segment) => typeof segment === 'string' && segment.length > 0)) })),
          memories: value.memories.filter(keyed).map(({ key }) => ({ key })),
        })
      }, { reload: false, success: 'inventoryLoaded' })
      const selectField = (entry, path, checked) => {
        const paths = Object.hasOwn(selectedFields, entry.entryId) ? selectedFields[entry.entryId] : []
        const samePath = (candidate) => JSON.stringify(candidate) === JSON.stringify(path)
        const next = checked ? (paths.some(samePath) ? paths : [...paths, path]) : paths.filter((candidate) => !samePath(candidate))
        setDraft({
          configFields: JSON.stringify({ ...selectedFields, [entry.entryId]: next }, null, 2),
          ...(checked ? { include: include(entry.key, true) } : {}),
        })
      }
      const resource = (entry, kind) => h('li', { className: 'ps-item', key: `${kind}:${entry.key}` },
        h('div', {}, h(Toggle, { label: entry.key, disabled, checked: included.includes(entry.key),
          onChange: (checked) => setDraft({ include: include(entry.key, checked) }) }),
        kind === 'config' && h('ul', { className: 'ps-list' }, entry.fields.map((path) => {
          const paths = selectedFields && Object.hasOwn(selectedFields, entry.entryId) ? selectedFields[entry.entryId] : []
          return h('li', { key: JSON.stringify(path) }, h(Toggle, { label: `${t('fieldPath')} ${JSON.stringify(path)}`,
            disabled: disabled || !selectedFields, checked: paths.some((candidate) => JSON.stringify(candidate) === JSON.stringify(path)),
            onChange: (checked) => selectField(entry, path, checked) }))
        }))))
      return h('div', { className: 'ps-spaced' },
        h(Button, { disabled, onClick: scan }, t('inventory')),
        h(Feedback, { area: 'inventory', ctl, t }),
        inventory && h('div', {}, note(t('inventoryHint')),
          !selectedFields && note(t('fieldsInvalid'), 'alert'),
          inventory.plugins.length + inventory.configs.length + inventory.memories.length === 0 ? note(t('inventoryEmpty')) :
            h('ul', { className: 'ps-list', style: { maxHeight: 260, overflowY: 'auto' } },
              inventory.plugins.map((entry) => resource(entry, 'plugin')),
              inventory.configs.map((entry) => resource(entry, 'config')),
              inventory.memories.map((entry) => resource(entry, 'memory')))))
    }
    function Policy({ ctl, t }) {
      const policy = ctl.state.policy
      const version = JSON.stringify(policy)
      const [edited, setEdited] = useState(null)
      const draft = edited?.version === version ? edited.value : policyDraft(policy)
      const disabled = Boolean(ctl.busy)
      const set = (patch) => setEdited({ version, value: { ...draft, ...patch } })
      const select = (key, values) => h(Field, { as: 'select', label: t(key), value: draft[key], disabled,
        onChange: (value) => set({ [key]: value }), options: values.map((value) => [value, t(value)]) })
      const save = () => ctl.run('policy', async () => {
        const result = await call('policy', { policy: policyPayload(draft) })
        if (!result?.policy) throw uiError('bad-response')
        setEdited({ version, value: policyDraft(result.policy) })
      }, { success: 'saved' })
      return h(Card, { title: t('settings') },
        note(t('settingsHint')), note(`${t('noDelete')} ${t('autoHint')}`),
        h('div', { className: 'ps-spaced' },
          row(select('mode', ['manual', 'selective', 'managed']), select('direction', ['both', 'push', 'pull']),
            h(Field, { label: t('interval'), type: 'number', min: 60000, max: 86400000, step: 1, value: draft.intervalMs, disabled,
              onChange: (intervalMs) => set({ intervalMs }) }),
            h(Toggle, { label: t('auto'), checked: draft.autoApply, disabled: disabled || draft.mode !== 'managed', onChange: (autoApply) => set({ autoApply }) })),
          row(...caps.map((cap) => h(Toggle, { key: cap, label: t(cap), checked: draft.caps?.[cap], disabled,
            onChange: (checked) => set({ caps: { ...draft.caps, [cap]: checked } }) }))),
          note(t('keysHint')),
          h(Resources, { ctl, t, draft, setDraft: set }),
          row(...listFields.map((key) => h(Field, { key, label: t(key), as: 'textarea', grow: true, rows: 3,
            value: draft[key], disabled, onChange: (value) => set({ [key]: value }) }))),
          note(t('fieldsHint')),
          row(h(Field, { label: t('configFields'), as: 'textarea', grow: true, rows: 4,
            value: draft.configFields, disabled, onChange: (configFields) => set({ configFields }) })),
          note(t('costHint')),
          row(h(Toggle, { label: t('aiEnabled'), checked: draft.ai?.enabled, disabled, onChange: (enabled) => set({ ai: { ...draft.ai, enabled } }) }),
            ...['provider', 'model'].map((key) => h(Field, { key, label: t(key === 'provider' ? 'aiProvider' : 'aiModel'),
              value: draft.ai?.[key] ?? '', disabled, onChange: (value) => set({ ai: { ...draft.ai, [key]: value } }) }))),
          row(h(Button, { disabled, primary: true, onClick: save }, t('savePolicy')))),
        h(Feedback, { area: 'policy', ctl, t }))
    }

    function isHost(state) {
      return state.identity.role === 'center' || (state.identity.role === 'peer' && !state.center)
    }
    function fingerprint(value) {
      return typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/i.test(value) ? `${value.replace(/^sha256:/i, '').slice(0, 12)}…` : '—'
    }
    function skipText(t, reason) {
      if (reason === 'local-only') return t('localOnlyReason')
      if (reason === 'system-protected') return t('protectedReason')
      if (reason === 'absent-not-delete') return t('absentReason')
      if (String(reason).startsWith('cap-disabled')) return t('capReason')
      return t('excludedReason')
    }
    function isUnsigned(state) {
      const snapshot = state.pendingSnapshot
      if (!snapshot) return true
      const trust = snapshot.trust ?? state.snapshotTrust
      if (trust !== undefined) return trust !== 'authenticated'
      return true
    }
    function Plan({ ctl, t, kind }) {
      const { state } = ctl
      const area = kind.key
      const field = `last${kind.suffix}`
      const plan = state[`${field}Plan`]
      const results = state[`${field}Results`] ?? []
      const status = state[`${field}Status`]?.status
      const approval = state.approvals?.[plan?.planId]
      const [selection, setSelection] = useState(null)
      const chosen = selection?.planId === plan?.planId ? selection?.opIds ?? [] : []
      const disabled = Boolean(ctl.busy)
      const operations = plan?.operations ?? []
      const conflicts = plan?.conflicts ?? []
      const skipped = plan?.skipped ?? []
      const snapshotPlan = String(plan?.source ?? '').startsWith('snapshot:')
      const hasRestart = status === 'needsRestart' || results.some((result) => result.status === 'needsRestart')
      const effectiveStatus = status === 'ok' ? (hasRestart ? 'needsRestart' : 'applied') : status
      const canPull = !state.suspended && state.policy.direction !== 'push'
      const canPush = !state.suspended && state.policy.direction !== 'pull'
      const hasRemote = Boolean(state.center) || (state.identity.role === 'peer' && Object.values(state.peers ?? {}).some((peer) => peer.status === 'connected'))
      const toggle = (id) => setSelection({ planId: plan.planId,
        opIds: chosen.includes(id) ? chosen.filter((value) => value !== id) : [...chosen, id],
      })
      const selectedOps = operations.filter((op) => chosen.includes(op.opId)).map((op) => op.opId)
      return h(Card, { title: t(kind.title) },
        hasRemote && row(
          h(Button, { disabled: disabled || !canPull, onClick: action(ctl, area, 'check', { kind: kind.key }) }, t(kind.check)),
          h(Button, { disabled: disabled || !canPush, onClick: action(ctl, area, 'proposal', { kind: kind.key }, { success: businessStatus }) }, t(kind.submit))),
        hasRemote && state.identity.role === 'peer' && !state.center && note(t('peerQueue')),
        h(Feedback, { area, ctl, t }),
        effectiveStatus && note(`${t('status')} · ${statusText(t, effectiveStatus)}`, 'status'),
        !plan && note(t('noPlan')),
        plan && h('div', { className: 'ps-spaced' },
          snapshotPlan && note(t(isUnsigned(state) ? 'unsigned' : 'snapshotApproval')),
          row(h(Badge, {}, `${t('operations')} ${operations.length}`), h(Badge, {}, `${t('skipped')} ${skipped.length}`),
            conflicts.length > 0 && h(Badge, { tone: 'warn' }, `${t('conflicts')} ${conflicts.length}`),
            !effectiveStatus && !conflicts.length && h(Badge, {}, t(approval ? 'approved' : operations.length ? 'pending' : 'noChanges'))),
          conflicts.length > 0 && h('div', {}, note(t('conflictHint')), h('ul', { className: 'ps-list' }, conflicts.map((conflict) =>
            h('li', { className: 'ps-item', key: conflict.key },
              h('div', {}, h('strong', {}, conflict.key), row(...[['base', conflict.baseline], ['local', conflict.local], ['remote', conflict.center ?? conflict.remote]].map(([label, value]) =>
                h('span', { key: label, className: 'ps-muted' }, `${t(label)} ${conflictSummary(conflict.kind, conflict.key, value)}`)))),
              row(...['local', 'remote'].map((choice) => h(Button, { key: choice, disabled: disabled || !canPull,
                onClick: action(ctl, area, 'resolvePlanConflict', { planId: plan.planId, key: conflict.key, choice }) }, t(choice === 'local' ? 'resolveLocal' : 'resolveRemote')))))))),
          operations.length > 0 && h('ul', { className: 'ps-list' }, operations.map((op) =>
            h('li', { className: 'ps-item', key: op.opId },
              h(Toggle, { label: `${statusText(t, op.action, 'operations')} ${op.key}`, checked: chosen.includes(op.opId), disabled: disabled || !canPull || Boolean(conflicts.length), onChange: () => toggle(op.opId) }),
              ['install', 'upgrade'].includes(op.action) && op.payload?.type === 'registry' && h('span', {}, versionText(op.payload.version)),
              ['configSet', 'memWrite'].includes(op.action) && h('span', { className: 'ps-muted' }, `${fingerprint(op.fromHash)} → ${fingerprint(op.toHash)}`),
              op.risk === 'high' && h(Badge, { tone: 'warn' }, t('highRisk')),
              approval?.opIds?.includes(op.opId) && h(Badge, { tone: 'ok' }, t('approved'))))),
          skipped.length > 0 && note(skipped.map((entry) => `${entry.key} · ${skipText(t, entry.reason)}`).join(' / ')),
          operations.length > 0 && h('div', { className: 'ps-spaced' }, row(
            h(Button, { primary: true, disabled: disabled || !canPull || Boolean(conflicts.length) || !selectedOps.length,
              onClick: action(ctl, area, 'approve', { planId: plan.planId, opIds: selectedOps, actor: 'user' }, { success: 'approved' }) }, t('approve')),
            h(Button, { disabled: disabled || !canPull || Boolean(conflicts.length) || !approval?.opIds?.length,
              onClick: action(ctl, area, 'apply', { planId: plan.planId }, { success: businessStatus }) }, t('apply'))))),
        results.length > 0 && h('ul', { className: 'ps-list' }, results.map((result) =>
          h('li', { className: 'ps-item', key: result.opId },
            h('span', {}, result.key ?? operations.find((op) => op.opId === result.opId)?.key ?? String(result.opId ?? '').slice(0, 18)),
            h(Badge, { tone: result.status === 'applied' ? 'ok' : 'warn' }, statusText(t, result.status))))))
    }

    function Proposals({ ctl, t }) {
      const { state } = ctl
      const area = 'proposals'
      const canPublish = !ctl.busy && !state.suspended && state.policy.direction !== 'pull'
      const pending = (state.proposals ?? []).filter((proposal) => proposal.status === 'pending')
      const conflicts = (state.conflicts ?? []).filter((conflict) => conflict.status === 'open')
      const [archived, setArchived] = useState(null)
      const archive = () => {
        setArchived(null)
        return ctl.run('archive', async () => {
          const value = await call('archiveDecisions')
          if (value?.status !== 'archived' || !Number.isSafeInteger(value.count) || value.count < 0 ||
              typeof value.archiveId !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(value.archiveId)) throw uiError('bad-response')
          setArchived({ count: value.count, id: value.archiveId })
        }, { success: 'archived' })
      }
      return h(Card, { title: t('proposals') },
        row(h(Button, { disabled: Boolean(ctl.busy), onClick: action(ctl, area, 'proposals') }, t('refreshProposals')),
          h(Button, { disabled: !canPublish, onClick: action(ctl, area, 'publishLocal', { kind: 'all' }, { success: businessStatus }) }, t('publishLocal'))),
        h(Feedback, { area, ctl, t }),
        note(t('archiveHint')),
        h('div', { className: 'ps-spaced' }, h(Button, { disabled: Boolean(ctl.busy) || state.suspended, onClick: archive }, t('archiveDecisions'))),
        h(Feedback, { area: 'archive', ctl, t }),
        archived && note(`${t('archived')} ${archived.count} · ${archived.id}`, 'status'),
        pending.length ? h('ul', { className: 'ps-list' }, pending.map((proposal) =>
          h('li', { className: 'ps-item', key: proposal.id },
            h('div', {}, `${t('from')} · ${proposal.origin?.label ?? proposal.origin?.profileId ?? '—'}`,
              note(`${t('resources')} ${proposal.resourceCount ?? 0} · ${(proposal.keys ?? []).join(', ')}`)),
            row(h(Button, { primary: true, disabled: Boolean(ctl.busy) || state.suspended || state.policy.direction === 'push' || conflicts.some((entry) => entry.proposalId === proposal.id),
              onClick: action(ctl, area, 'acceptProposal', { proposalId: proposal.id }, { success: businessStatus }) }, t('publish')),
            h(Button, { disabled: Boolean(ctl.busy), onClick: action(ctl, area, 'rejectProposal', { proposalId: proposal.id }, { success: 'rejected' }) }, t('reject')))))) : note(t('noProposals')),
        conflicts.length > 0 && h('div', {}, note(t('openConflicts')), h('ul', { className: 'ps-list' }, conflicts.map((conflict) =>
          h('li', { className: 'ps-item', key: conflict.id }, h('span', {}, conflict.key),
            row(...['local', 'remote'].map((choice) => h(Button, { key: choice, disabled: Boolean(ctl.busy) || state.suspended || state.policy.direction === 'push',
              onClick: action(ctl, area, 'resolveConflict', { conflictId: conflict.id, choice }) }, t(choice === 'local' ? 'resolveLocal' : 'resolveRemote')))))))) )
    }
    function versionText(value) {
      return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]{1,64})?$/.test(value) ? value : '—'
    }
    function conflictSummary(kind, key, value) {
      if (kind === 'downgrade-blocked' && typeof value === 'string' && value.startsWith(`${key}@`)) {
        return versionText(value.slice(key.length + 1))
      }
      return fingerprint(value)
    }
    function contactStatus(node) {
      const contact = node?.lastContact ?? node?.lastSeen
      const status = node?.lastConnectionStatus ?? node?.status
      if (status && !['ok', 'connected', 'success', 'online', 'unconfirmed', 'pending', 'connecting'].includes(status)) return 'recentFailure'
      if (contact) return 'recentSuccess'
      return 'unconfirmed'
    }
    function Nodes({ ctl, t }) {
      const { state } = ctl
      const area = 'nodes'
      return h(Card, { title: t('nodes') },
        h(Feedback, { area, ctl, t }),
        h('ul', { className: 'ps-list' }, state.center && h('li', { className: 'ps-item' },
          h('span', {}, `${t(state.topology === 'p2p' ? 'peer' : 'center')} · ${String(state.center.deviceId ?? '').slice(0, 12)}`),
          h(Badge, {}, t(contactStatus(state.center)))),
        ...Object.values(state.peers ?? {}).map((peer) => h('li', { className: 'ps-item', key: peer.deviceId },
          h('span', {}, [peer.label, peer.profileId, peer.lastSeen].filter(Boolean).join(' · ')),
          h(Badge, {}, t(peer.status === 'revoked' ? 'revoked' : contactStatus(peer))),
          isHost(state) && peer.status !== 'revoked' && h(Button, { disabled: Boolean(ctl.busy),
            onClick: action(ctl, area, 'revokePeer', { deviceId: peer.deviceId }, { success: 'revoked' }) }, t('revoke'))))))
    }
    function Snapshot({ ctl, t }) {
      const [text, setText] = useState('')
      const area = 'snapshot'
      const importAndCheck = () => ctl.run(area, async () => {
        await call('loadSnapshot', { text })
        await call('check', { kind: 'all', source: 'snapshot' })
        setText('')
      }, { success: 'snapshotLoaded' })
      const exportSnapshot = () => ctl.run(area, async () => {
        const value = await call('snapshot')
        if (value?.kind !== 'plugin-sync-snapshot') throw uiError('bad-response')
        setText(JSON.stringify(value, null, 2))
      }, { reload: false })
      return h(Card, { title: t('snapshot') },
        row(h(Field, { as: 'textarea', rows: 4, grow: true, label: t('snapshotText'), value: text, onChange: setText, disabled: Boolean(ctl.busy) })),
        row(h(Button, { disabled: Boolean(ctl.busy), onClick: exportSnapshot }, t('exportSnapshot')),
          h(Button, { primary: true, disabled: Boolean(ctl.busy) || !text.trim() || ctl.state.suspended || ctl.state.policy.direction === 'push', onClick: importAndCheck }, t('importSnapshot'))),
        ctl.state.pendingSnapshot && note(t(isUnsigned(ctl.state) ? 'unsigned' : 'snapshotApproval')),
        h(Feedback, { area, ctl, t }))
    }
    function Suggestions({ ctl, t }) {
      const area = 'suggestions'
      return h(Card, { title: t('suggestions') }, ctl.state.policy.ai?.enabled && note(t('costHint')),
        h('div', { className: 'ps-spaced' }, h(Button, { disabled: Boolean(ctl.busy), onClick: action(ctl, area, 'suggest') }, t('scanSuggestions'))),
        h(Feedback, { area, ctl, t }),
        ctl.state.suggestions?.length ? h('ul', { className: 'ps-list' }, ctl.state.suggestions.map((item) =>
          h('li', { className: 'ps-item', key: item.id }, h('span', {}, item.key),
            ['sync', 'localOnly'].includes(item.action) && h(Button, { disabled: Boolean(ctl.busy),
              onClick: action(ctl, area, 'adopt', { ids: [item.id] }) }, t(item.action === 'localOnly' ? 'adoptLocal' : 'adoptSync'))))) : note(t('noSuggestions')))
    }
    function SyncTab({ t, settingsFirst = false }) {
      const ctl = useController()
      const { state, load } = ctl
      const role = state?.identity.role
      const host = state && isHost(state)
      const latestPeer = state && Object.values(state.peers ?? {}).filter((peer) => peer.status !== 'revoked')
        .sort((a, b) => String(b.lastContact ?? b.lastSeen ?? '').localeCompare(String(a.lastContact ?? a.lastSeen ?? '')))[0]
      const connection = !state ? null : state.suspended ? 'paused' : role === 'unpaired' ? 'unpaired' : host
        ? latestPeer && contactStatus(latestPeer) !== 'unconfirmed' ? contactStatus(latestPeer) : 'waitingForPeer'
        : contactStatus(state.center)
      return h('div', { className: 'ps-wrap' }, h('style', {}, css),
        load.error && h(Card, {}, note(`${t('loadingFailed')} ${statusText(t, load.error)}`, 'alert'),
          h('div', { className: 'ps-spaced' }, h(Button, { disabled: Boolean(ctl.busy), onClick: ctl.refresh }, t('retry')))),
        !state && load.busy && note(t('loading'), 'status'),
        state && h(Card, {},
          row(h('strong', {}, state.identity.label), h(Badge, {}, statusText(t, role, 'unpaired')),
            h(Badge, { tone: connection === 'recentSuccess' ? 'ok' : 'warn' }, `${t('connection')} · ${t(connection)}`),
            h(Badge, {}, `${t('revision')} ${state.revision?.number ?? 0}`)),
          state.center && (state.center.lastContact || state.center.lastSeen) && note(`${t('lastSeen')} · ${state.center.lastContact ?? state.center.lastSeen}`),
          row(h(Button, { disabled: Boolean(ctl.busy) || load.busy, onClick: ctl.refresh }, t('refresh')),
            h(Button, { disabled: Boolean(ctl.busy), onClick: action(ctl, 'connection', 'suspend', { value: !state.suspended }) }, t(state.suspended ? 'resume' : 'pause'))),
          load.busy && ctl.busy === null && note(t('loading'), 'status'),
          h(Feedback, { area: 'connection', ctl, t })),
        state && settingsFirst && h(Policy, { ctl, t }),
        state && h(Pairing, { ctl, t }),
        state && host && h(Proposals, { ctl, t }),
        state && kinds.map((kind) => h(Plan, { key: kind.key, ctl, t, kind })),
        state && h(Snapshot, { ctl, t }),
        state && !settingsFirst && h(Policy, { ctl, t }),
        state && h(Suggestions, { ctl, t }),
        state && (state.center || Object.keys(state.peers ?? {}).length > 0) && h(Nodes, { ctl, t }),
        state?.audit?.length > 0 && h(Card, { title: t('activity') },
          h('ul', { className: 'ps-list' }, state.audit.slice(-8).reverse().map((entry) =>
            h('li', { className: 'ps-item', key: entry.seq }, h('span', {}, entry.kind), h('time', {}, entry.at))))))
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'device-sync: dictionaries')
        const t = ctx.locale.bind(NS)
        for (const [name, order, label] of [['plugins.tab', 20, 'tab'], ['settings.section', 60, 'settings']]) {
          ctx.slots.inject(name, () => ctx.slots.register({
            name, id: 'device-sync', order, label: () => t(label), locale: NS,
          }, (props) => h(SyncTab, { t: props?.t ?? t, settingsFirst: name === 'settings.section' })))
        }
      },
    }
  },
})
