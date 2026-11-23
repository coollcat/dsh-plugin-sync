// Browser half. DSH supplies React and owns both slots.
window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-sync',
  factory(require) {
    const { createElement: h, useState, useEffect, useCallback, useRef } = require('react')
    const NS = 'pluginSync'
    const en = {
      tab: 'Device sync', settings: 'Device sync',
      loading: 'Reading device sync…', retry: 'Retry', loadingFailed: 'Could not read device sync settings.',
      busy: 'Working…', done: 'Done', failed: 'The operation failed.', saved: 'Saved',
      network: 'Network unavailable. Check the connection and retry.', offline: 'The remote request failed.',
      unauthorized: 'Not authorized.', 'not-found': 'Sync service unavailable.', suspended: 'Sync is paused.',
      expired: 'Plan expired. Compare again.', 'plan-not-found': 'Plan unavailable. Compare again.',
      'no-snapshot': 'No snapshot is loaded.', 'direction-blocked': 'This operation is blocked by the sync direction.',
      'invalid-policy': 'The settings were rejected.', 'peer-state-unavailable': 'Wait for the paired device to compare once; this side has not received its shared state yet.',
      peerQueue: 'This side queues changes until the paired device checks again.',
      'invalid-invitation': 'Invalid invitation.', 'invitation-expired': 'Invitation expired.',
      'https-required-outside-loopback': 'Use HTTPS for non-loopback addresses.', 'unresolved-conflict': 'Resolve conflicts first.',
      'invalid-json': 'Invalid JSON.', 'payload-too-large': 'The data exceeds the size limit.',
      'digest-mismatch': 'Snapshot integrity check failed.', 'invalid-snapshot': 'The snapshot was rejected.',
      'signature-required': 'A verified signature is required.', 'already-paired': 'This profile is already paired.',
      'no-approval': 'Approve selected operations first.', 'no-operation-approved': 'Approve at least one operation.',
      'bad-response': 'The sync service returned an invalid response.', 'topology-bound-to-role': 'The connection type is fixed for this paired profile.',
      unpaired: 'Not paired', center: 'Center', device: 'Device', peer: 'Peer',
      waitingForPeer: 'Waiting for the other device', unconfirmed: 'Connection not yet confirmed',
      recentSuccess: 'Last request succeeded', recentFailure: 'Last request failed',
      refresh: 'Refresh', pause: 'Pause sync', resume: 'Resume sync',
      peerLimit: 'This peer endpoint already has a device. Revoke it before inviting another.',
      createCenter: 'Let another device connect to me', joinCenter: 'I connect to another device', listenPeer: 'Direct between two devices',
      revoke: 'Revoke', revoked: 'Access revoked', invite: 'Invite a new device', hideInvite: 'Hide',
      inviteExpires: 'Expires', inviteHint: 'Send this link to the other device. It works once and expires in 24 hours.',
      joinUrl: 'Address', joinKind: 'The other device is a', ssh: 'Use an SSH tunnel (optional)',
      sshHost: 'SSH host', sshUser: 'User', sshIdentity: 'Private key file', sshPort: 'SSH port',
      sshHint: 'Uses the system OpenSSH client with the private key path below. The host key is verified on first connection and remembered; the plugin never stores your key.',
      secureHint: 'Use HTTPS on public networks, plain HTTP only on a trusted LAN, or an SSH tunnel. Anyone with the invitation link can use it.',
      advice: 'Suggestions', adviceHint: 'Based on this device, applied in one click',
      notIncluded: 'plugins are not in the sync scope', adoptAll: 'Add all', allIncluded: 'All included',
      askAgent: 'Ask the agent for suggestions', regenerate: 'Regenerate', showList: 'Show', hideList: 'Hide',
      adviceScope: 'Suggested: include {sync}, keep local {local}', adviceEmpty: 'Nothing to suggest',
      adopt: 'Include', keepLocal: 'Keep local', dismiss: 'Not now',
      scope: 'Sync scope', scopeHint: 'What moves between this device and the other one',

      direction: 'Direction', both: 'Both ways', push: 'Push only', pull: 'Pull only',
      plugins: 'Plugins', selectedCount: 'selected {n} of {m}', selectAll: 'Select all', selectNone: 'Select none',
      reload: 'Reload', search: 'Search plugins', more: '{n} more, show all', showLess: 'Show less',
      noneWarn: 'No plugin is selected. Nothing will sync after saving.',
      importJson: 'Import JSON', exportJson: 'Export JSON', imported: 'Imported and applied.',
      importFailed: 'That file is not an export from this page.',
      configTitle: 'Config fields',
      memoryTitle: 'Memory (Lingshu)', memoryLayers: 'Memory layers', memoryHint: 'Only the layers you tick are copied. Writes still go through Lingshu\'s own review gate: a refused node is reported as needing local review, never forced.',
      memoryUnavailable: 'No Lingshu store or Python bridge found on this device', memoryEmpty: 'Nothing eligible in these layers',
      memoryWrite: 'Write memory', memoryWriteUnsupported: 'This layer needs local review before it can be written',
      memoryTierHint: 'Knowledge and structural nodes need a Lingshu review channel; without one the write is refused locally and shown as needing review.',
      memoryLayerContextual: 'Contextual', memoryLayerGoals: 'Goals', memoryLayerUnresolved: 'Unresolved',
      memoryLayerKnowledge: 'Knowledge', memoryLayerStructural: 'Structural',
      sync: 'Sync', syncHint: 'Compare first, then choose what to apply',
      incoming: 'Incoming changes', from: 'from', accept: 'Accept and publish', acceptInstall: 'Accept and install here', reject: 'Reject',
      noIncoming: 'Nothing waiting', conflict: 'Conflict', conflictHint: 'Only version fingerprints are shown, never config values.',
      keepMine: 'Keep mine', useTheirs: 'Use theirs', bothChanged: 'Both sides changed',
      compare: 'Compare', sendTheirs: 'Send to the other device', publishLocal: 'Publish local changes', applySelected: 'Apply {n} to this device',
      waiting: '{n} waiting for you', lastResult: 'Last result: {text}', appliedN: '{n} applied', restartN: '{n} need a restart',
      skippedN: '{n} skipped', noPlan: 'Not compared yet',
      highRisk: 'Needs your approval', applyFailedHere: 'Failed', conflictBlocked: 'Resolve the conflict first',
      connections: 'Connections', connectionsHint: 'Which devices exchange this content',
      online: 'Online', offlineState: 'Offline', lastContact: 'Last contact', noPeers: 'No device connected yet.',
      joinDifferent: 'Connect to another device', setupHint: 'Choose how to connect first.',
      moreCard: 'More', snapshot: 'Offline snapshot', snapshotHint: 'One file that carries the current scope',
      exportSnapshot: 'Export', importSnapshot: 'Import', snapshotText: 'Snapshot JSON',
      unsigned: 'This snapshot is unsigned; its source is untrusted. Review every operation before applying.',
      snapshotApproval: 'This plan comes from an offline snapshot. Review every operation before applying.',
      snapshotLoaded: 'Snapshot loaded and compared.', archive: 'Archive processed',
      archiveHint: 'Back up accepted and rejected proposals before clearing them.',
      archived: 'Archived', activity: 'Recent activity',
      advanced: 'Advanced', autoApply: 'Apply safe changes automatically (enable, disable, write config)',
      autoApplyHint: 'Install, upgrade and conflicts still wait for you. When off, nothing happens until you compare and apply.',
      interval: 'Check every', minutes: 'min', hours: 'hour', days: 'day',
      allowed: 'Changes allowed to sync', install: 'Install new plugins', upgrade: 'Upgrade plugins',
      enable: 'Enable plugins', disable: 'Disable plugins', configSet: 'Write plugin config',
      rules: 'Rules', excludeLabel: 'Never sync these (one per line, * allowed)', localOnlyLabel: 'Keep only on this device (one per line)',
      noProtected: 'Protected system plugins are never synced.',
      heroTitle: 'Device sync',
      heroHint: 'First choose how this device connects, then decide what moves between devices. Changes save as you go.',
      groupSetup: '1 · Set up',
      groupConnect: '2 · Connect & tools',
      guideTitle: 'First time here? Pick a connection preset',
      guideHint: 'Choose a network mode and whether to create or join, then fill in the preset in one click. You can change it later.',
      guideMode: 'Network mode',
      guideAction: 'What I want to do',
      modeCenter: 'Hub (center)', modeCenterDesc: 'One device hosts the network; the others connect to it.',
      modePeer: 'Peer to peer', modePeerDesc: 'Two devices connect directly; neither is a host.',
      actionCreate: 'Create a network', actionCreateDesc: 'Start a center or listen here, then invite the other device.',
      actionJoin: 'Join a network', actionJoinDesc: 'Enter the other device’s address and invitation code.',
      guideApply: 'Fill it in and continue', guideSkip: 'Set up myself',
      guideReopen: 'Show the guide again', guideSkipHint: 'You can reopen this guide from Connections.',
      presetBanner: 'Preset applied: {mode} · {action}. {hint}',
      presetCreateHint: 'The matching button below is highlighted — click it to finish.',
      presetJoinHint: 'The join form is open — fill in the address and invitation code.',
      modeCenterShort: 'Hub', modePeerShort: 'Peer to peer', actionCreateShort: 'create', actionJoinShort: 'join',
      syncSettings: 'Sync settings', syncSettingsHint: 'Include this plugin’s whole config (all non-secret fields)',
      guideNetwork: 'Connection path',
      netLan: 'LAN', netLanDesc: 'Direct http:// over a trusted local network',
      netSsh: 'SSH tunnel', netSshDesc: 'Key-based access; the remote side listens only locally',
      netPublic: 'Public network', netPublicDesc: 'HTTPS address with an invitation link; keep the link private',
      lanHint: 'LAN uses http://IP:3081. The invitation link is the only credential — send it privately.',
      sshModeHint: 'SSH uses your key as the credential. Fill in the SSH host, user, key path and port (default 22).',
      publicHint: 'Public access must use https:// on the sync port and an invitation link. Anyone with the link can join.',
      inviteLink: 'Invitation link', inviteLinkHint: 'Paste the full link shared by the other device',
      parseLink: 'Parse link', linkParsed: 'Link parsed. Verify it before connecting.',
      verifyLink: 'Verify link', verified: 'Verified',
      'verify-failed': 'The link or token could not be verified.',
      'ssh-client-not-found': 'No system ssh client found. Install OpenSSH and make sure ssh is on PATH.',
      'pick-file-unavailable': 'The host cannot open a file dialog. Type the absolute key path instead.',
      'pick-file-failed': 'Could not read the selected path. Type the absolute key path instead.',
      'request-failed': 'The sync service rejected the request.',
      pickFile: 'Browse', askAgentHint: 'Opens a new chat with your installed plugin list.',
      copyLink: 'Copy link', copied: 'Link copied.', 'copy-failed': 'Could not copy the link.',
      hostAddress: 'Address other devices use to reach me',
      resetSync: 'Reset sync', resetConfirm: 'Confirm reset', cancel: 'Cancel',
      resetDone: 'Sync reset. Choose a connection again.',
      resetHint: 'Reset clears pairing and returns here to unpaired. Your scope choices are kept.',
    }
    const zh = {
      tab: '设备同步', settings: '设备同步',
      loading: '正在读取设备同步…', retry: '重试', loadingFailed: '无法读取设备同步设置。',
      busy: '正在处理…', done: '完成', failed: '操作失败。', saved: '已保存',
      network: '网络不可用，请检查连接后重试。', offline: '对端请求失败。',
      unauthorized: '未获授权。', 'not-found': '同步服务不可用。', suspended: '同步已暂停。',
      expired: '计划已过期，请重新比对。', 'plan-not-found': '计划不可用，请重新比对。',
      'no-snapshot': '还没有导入快照。', 'direction-blocked': '当前方向不允许此操作。',
      'invalid-policy': '设置未通过校验。', 'peer-state-unavailable': '请先让对方比对一次，本端还没收到它共享的状态。',
      peerQueue: '本端的变更会排队，等对方下次比对时送达。',
      'invalid-invitation': '邀请码无效。', 'invitation-expired': '邀请码已过期。',
      'https-required-outside-loopback': '非本机地址必须用 HTTPS。', 'unresolved-conflict': '请先处理冲突。',
      'invalid-json': 'JSON 格式不对。', 'payload-too-large': '数据超出大小限制。',
      'digest-mismatch': '快照完整性校验失败。', 'invalid-snapshot': '快照未通过校验。',
      'signature-required': '这里要求验证签名。', 'already-paired': '本设备已经配对。',
      'no-approval': '请先批准选中的操作。', 'no-operation-approved': '至少要批准一项操作。',
      'bad-response': '同步服务返回了无效响应。', 'topology-bound-to-role': '已配对设备的连接类型不能再改。',
      unpaired: '未配对', center: '中心', device: '设备', peer: '点对点',
      waitingForPeer: '等待对方连接', unconfirmed: '连接还没确认',
      recentSuccess: '最近请求成功', recentFailure: '最近请求失败',
      refresh: '刷新', pause: '暂停同步', resume: '恢复同步',
      peerLimit: '这里已经配对了一台设备，撤销后才能邀请另一台。',
      createCenter: '让别的设备连我', joinCenter: '我去连别的设备', listenPeer: '两台设备直连',
      revoke: '撤销', revoked: '已撤销', invite: '邀请新设备', hideInvite: '收起',
      inviteExpires: '到期', inviteHint: '把邀请链接发给对方，24 小时内有效，用一次就失效。',
      joinUrl: '对方地址', joinKind: '对方是', ssh: '走 SSH 隧道（可选）',
      sshHost: 'SSH 主机', sshUser: '用户', sshIdentity: '私钥文件', sshPort: 'SSH 端口',
      sshHint: '用下面填写的私钥路径调用系统 OpenSSH；首次连接自动记录主机指纹，之后指纹变化会拒绝。插件不保存你的私钥。',
      secureHint: '公网用 HTTPS，可信局域网才用明文 HTTP，或用 SSH 隧道。拿到邀请链接的人就能连，请私下发送。',
      advice: '建议', adviceHint: '按这台设备的现状给出，点一下就应用',
      notIncluded: '个插件还没纳入同步', adoptAll: '全部纳入', allIncluded: '都已纳入',
      askAgent: '让 agent 给建议', regenerate: '重新生成', showList: '查看', hideList: '收起',
      adviceScope: '建议纳入 {sync} 个，留本机 {local} 个', adviceEmpty: '没有可建议的内容',
      adopt: '纳入', keepLocal: '留本机', dismiss: '先不用',
      scope: '同步范围', scopeHint: '决定这台设备和对方之间传什么',

      direction: '方向', both: '双向', push: '只推送', pull: '只拉取',
      plugins: '插件', selectedCount: '已选 {n} 个 · 共 {m} 个', selectAll: '全部勾选', selectNone: '全部不勾',
      reload: '重新读取', search: '搜索插件', more: '还有 {n} 个，显示全部', showLess: '收起',
      noneWarn: '一个插件都没勾，保存后不会同步插件。',
      importJson: '导入 JSON', exportJson: '导出 JSON', imported: '已导入并生效。',
      importFailed: '这个文件不是本页导出的格式。',
      configTitle: '配置项',
      memoryTitle: '记忆（灵枢）', memoryLayers: '记忆层', memoryHint: '只同步勾选的层。写入仍走灵枢自己的复核闸：被拒的节点标为「需本机复核」，不会绕过。',
      memoryUnavailable: '本机没找到灵枢记忆库或 Python 桥', memoryEmpty: '这些层里没有可同步的节点',
      memoryWrite: '写入记忆', memoryWriteUnsupported: '该层需要本机复核后才能写入',
      memoryTierHint: '知识层与结构层的写入需要灵枢的复核通道；没有通道时会被本机拒绝，计划里会标成「需本机复核」。',
      memoryLayerContextual: '情景', memoryLayerGoals: '目标', memoryLayerUnresolved: '未解',
      memoryLayerKnowledge: '知识', memoryLayerStructural: '结构',
      sync: '同步', syncHint: '先看差异，再决定改哪些',
      incoming: '对方发来的变更', from: '来自', accept: '接受并发布', acceptInstall: '接受并本机安装', reject: '拒绝',
      noIncoming: '暂时没有', conflict: '冲突', conflictHint: '只显示版本指纹，不显示配置内容。',
      keepMine: '保留本机', useTheirs: '采用对方', bothChanged: '两边都改过',
      compare: '看差异', sendTheirs: '发给对方', publishLocal: '发布本机改动', applySelected: '把这 {n} 项改到本机',
      waiting: '{n} 项等你确认', lastResult: '上次结果：{text}', appliedN: '{n} 项已应用', restartN: '{n} 项需重启生效',
      skippedN: '{n} 项跳过', noPlan: '还没比对',
      highRisk: '要你确认', applyFailedHere: '失败', conflictBlocked: '先处理冲突',
      connections: '连接', connectionsHint: '和哪些设备交换内容',
      online: '在线', offlineState: '离线', lastContact: '最近联系', noPeers: '还没有连上设备。',
      joinDifferent: '我去连别的设备', setupHint: '先选一种连接方式。',
      moreCard: '更多', snapshot: '离线快照', snapshotHint: '一个文件，带走当前同步内容',
      exportSnapshot: '导出', importSnapshot: '导入', snapshotText: '快照 JSON',
      unsigned: '快照没签名，来源不可信。应用前请逐项确认。',
      snapshotApproval: '这份计划来自离线快照。应用前请逐项确认。',
      snapshotLoaded: '已导入快照并完成比对。', archive: '处理过的提案',
      archiveHint: '先把接受过和拒绝过的提案备份，再清空列表。',
      archived: '已归档', activity: '最近活动',
      advanced: '高级设置', autoApply: '自动应用安全的变更（启用、停用、写插件配置）',
      autoApplyHint: '安装、升级和冲突仍要你确认。关掉时，只有你点「看差异」再点应用才会改动。',
      interval: '多久检查一次', minutes: '分钟', hours: '小时', days: '天',
      allowed: '允许同步的改动', install: '安装新插件', upgrade: '升级插件',
      enable: '启用插件', disable: '停用插件', configSet: '写入插件配置',
      rules: '规则', excludeLabel: '不同步这些（每行一条，可用 * 通配）', localOnlyLabel: '只留在这台设备（每行一条）',
      noProtected: '系统插件始终不同步。',
      heroTitle: '设备同步',
      heroHint: '先决定这台设备怎么连，再决定同步什么。改动点选即保存。',
      groupSetup: '一 · 先配好',
      groupConnect: '二 · 连接与工具',
      guideTitle: '第一次用？选一种连接方式',
      guideHint: '选网络模式，再选创建还是接入，点一下就把预设填好。之后随时可以改。',
      guideMode: '网络模式',
      guideAction: '我要做的',
      modeCenter: '中心模式', modeCenterDesc: '一台设备做中心，其它设备连它。',
      modePeer: '去中心化（点对点）', modePeerDesc: '两台设备地位相同，直接相连。',
      actionCreate: '创建网络', actionCreateDesc: '在本机建中心或监听，再邀请对方。',
      actionJoin: '接入现有网络', actionJoinDesc: '填对方地址和邀请码就能连。',
      guideApply: '填好并继续', guideSkip: '我自己来',
      guideReopen: '重新打开指引', guideSkipHint: '随时可以在「连接」里重新打开。',
      presetBanner: '已按「{mode} · {action}」填好。{hint}',
      presetCreateHint: '下面对应的按钮已高亮，点它就能完成。',
      presetJoinHint: '接入表单已展开，填地址和邀请码即可。',
      modeCenterShort: '中心', modePeerShort: '点对点', actionCreateShort: '创建', actionJoinShort: '接入',
      syncSettings: '同步设置', syncSettingsHint: '把这个插件的全部配置（非密钥字段）一起纳入同步',
      guideNetwork: '走哪条网络',
      netLan: '局域网', netLanDesc: '可信内网里直接用 http:// 地址',
      netSsh: 'SSH 隧道', netSshDesc: '用密钥登录，远端只监听本机',
      netPublic: '公网', netPublicDesc: 'HTTPS 地址加邀请链接，链接不要外传',
      lanHint: '局域网用 http://设备IP:3081（同步独立端口）。邀请链接是唯一凭据，请私下发送。',
      sshModeHint: 'SSH 用你的私钥作凭据，填好 SSH 主机、用户、密钥路径和端口（默认 22）。',
      publicHint: '公网请用 https:// 同步端口地址并带邀请链接，拿到链接的人就能连。',
      inviteLink: '邀请链接', inviteLinkHint: '粘贴对方发来的完整链接',
      parseLink: '解析链接', linkParsed: '链接已解析，连接前请先验证。',
      verifyLink: '验证链接', verified: '已验证',
      'verify-failed': '链接或邀请码验证失败。',
      'ssh-client-not-found': '没找到系统 ssh 客户端，请安装 OpenSSH 并确保 ssh 在 PATH 中。',
      'pick-file-unavailable': '本机无法打开文件选择框，请直接填写私钥绝对路径。',
      'pick-file-failed': '读取所选路径失败，请直接填写私钥绝对路径。',
      'request-failed': '同步服务拒绝了这次请求。',
      pickFile: '选择文件', askAgentHint: '开一个新对话，带上本机插件清单让 AI 给建议。',
      copyLink: '复制链接', copied: '链接已复制。', 'copy-failed': '复制失败。',
      hostAddress: '其他设备访问本机的地址',
      resetSync: '重置同步', resetConfirm: '确认重置', cancel: '取消',
      resetDone: '同步已重置，请重新选择连接方式。',
      resetHint: '重置会清除配对并回到未配对状态，已勾选的同步范围会保留。',
    }
    const css = `
.ps-wrap{display:flex;flex-direction:column;gap:12px;padding:4px 0 24px;color:var(--dsw-alias-label-primary,#16181d);min-width:0}
.ps-card{border:1px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1,#e6e8ee));border-radius:var(--dsw-radius-lg,12px);padding:14px 16px;background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-card-fill,#fff));min-width:0;overflow-wrap:anywhere}
.ps-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px}
.ps-hd h3{font-size:13px;font-weight:600;margin:0}
.ps-hd .hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b9097)}
.ps-hd .sp{flex:1}
.ps-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:13px}
.ps-row+.ps-row{margin-top:10px}
.ps-btn{border:1px solid var(--dsw-alias-border-l2,#e0e3e9);background:var(--dsw-alias-card-fill,#fff);color:var(--dsw-alias-label-primary,#16181d);border-radius:var(--dsw-radius-md,8px);padding:5px 10px;font-size:12.5px;cursor:pointer;white-space:nowrap}
.ps-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f2f4f7)}
.ps-btn.primary{background:var(--dsw-alias-state-business-primary,#2b6cff);color:var(--dsw-alias-label-on-color,#fff);border-color:transparent}
.ps-btn.quiet{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);padding:4px 7px}
.ps-btn.quiet:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);color:var(--dsw-alias-label-primary,#16181d)}
.ps-btn:disabled{opacity:.4;cursor:not-allowed}
.ps-note{margin:8px 0 0;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b9097);line-height:1.55}
.ps-note.warn{color:var(--dsw-alias-state-warn-primary,#9a5b00)}
.ps-split{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f4);flex-wrap:wrap}
.ps-split:last-child{border-bottom:0;padding-bottom:0}
.ps-split .txt{flex:1;min-width:170px;font-size:12.5px}
.ps-badge{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;border:1px solid var(--dsw-alias-border-l2,#e0e3e9);color:var(--dsw-alias-label-secondary,#61666b);white-space:nowrap}
.ps-badge.ok{color:var(--dsw-alias-state-success-primary,#137d3d);border-color:transparent;background:var(--dsw-alias-card-tile-fill,#f3f5f8)}
.ps-badge.warn{color:var(--dsw-alias-state-warn-primary,#9a5b00);border-color:transparent;background:var(--dsw-alias-card-tile-fill,#f3f5f8)}
.ps-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#137d3d);display:inline-block}
.ps-dot.off{background:var(--dsw-alias-label-tertiary,#8b9097)}
.ps-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:2px 0 12px}
.ps-preset{display:flex;gap:8px;align-items:flex-start;padding:9px 11px;border:1px solid var(--dsw-alias-border-l2,#e0e3e9);border-radius:var(--dsw-radius-md,9px);cursor:pointer;background:transparent}
.ps-preset input{margin:2px 0 0;accent-color:var(--dsw-alias-state-business-primary,#2b6cff)}
.ps-preset.on{border-color:var(--dsw-alias-state-business-primary,#2b6cff);background:var(--dsw-alias-interactive-bg-hover-accent,#f2f7ff)}
.ps-preset .t{display:block;font-size:12.5px;font-weight:600}
.ps-preset .d{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b);line-height:1.45;margin-top:2px}
.ps-field{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:12.5px}
.ps-field>span{font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b)}
.ps-input{border:1.5px solid var(--dsw-alias-border-l3,#b9c0cb);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#16181d);padding:6px 9px;font-size:12.5px;box-sizing:border-box;width:100%;max-width:100%;min-height:32px;box-shadow:0 1px 2px rgba(16,24,40,.05);transition:border-color .15s,box-shadow .15s}
.ps-input:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#2b6cff)}
.ps-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#2b6cff);box-shadow:0 0 0 3px var(--dsw-alias-state-business-primary-alpha,rgba(43,108,255,.18))}
.ps-input:disabled{opacity:.55;box-shadow:none}
textarea.ps-input{width:100%;resize:vertical;font-size:12px;line-height:1.5;min-height:64px}
.ps-code{display:block;border:1.5px dashed var(--dsw-alias-border-l3,#b9c0cb);border-radius:var(--dsw-radius-md,8px);padding:7px 9px;background:var(--dsw-alias-card-tile-fill,#f5f7fa);overflow-wrap:anywhere}
.ps-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 8px}
.ps-pick .count{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b)}
.ps-pick .count b{color:var(--dsw-alias-label-primary,#16181d)}
.ps-pick .sp{flex:1}
.ps-search{width:100%;margin-bottom:8px}
.ps-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px;font-size:12.5px}
.ps-list li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);flex-wrap:wrap}
.ps-list li:hover{background:var(--dsw-alias-interactive-bg-hover,#f5f7fa)}
.ps-list .name{flex:1;min-width:140px;overflow-wrap:anywhere}
.ps-list .name small{color:var(--dsw-alias-label-tertiary,#8b9097);font-size:11px;margin-left:6px}
.ps-list input[type=checkbox]{accent-color:var(--dsw-alias-state-business-primary,#2b6cff);flex:0 0 auto}
.ps-plugin-settings{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b);border:1px solid var(--dsw-alias-border-l2,#d5dae2);border-radius:999px;padding:2px 8px;cursor:pointer;white-space:nowrap}
.ps-plugin-settings input{margin:0}
.ps-plugin-settings:has(input:checked){color:var(--dsw-alias-state-business-primary,#2b6cff);border-color:var(--dsw-alias-state-business-primary,#2b6cff);background:var(--dsw-alias-interactive-bg-hover-accent,#eef5ff)}
.ps-adv{border:1px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l1,#e6e8ee));border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-settings-card-fill,#fff)}
.ps-adv>summary{list-style:none;cursor:pointer;padding:12px 16px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px}
.ps-adv>summary::-webkit-details-marker{display:none}
.ps-adv>summary::after{content:"›";margin-left:auto;color:var(--dsw-alias-label-tertiary,#8b9097);transform:rotate(90deg);transition:transform .15s}
.ps-adv[open]>summary::after{transform:rotate(-90deg)}
.ps-adv[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f4)}
.ps-adv-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:16px}
.ps-sub{font-size:12px;font-weight:600;margin-bottom:6px}
.ps-check{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer}
.ps-check input{accent-color:var(--dsw-alias-state-business-primary,#2b6cff)}
.ps-ops{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.ps-ops li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-card-tile-fill,#f5f7fa);font-size:12px}
.ps-ops .sp{flex:1}
.ps-plan{border:1px solid var(--dsw-alias-border-l1,#eef0f4);border-radius:var(--dsw-radius-md,10px);padding:12px 14px}
.ps-plan .ps-hd{margin-bottom:0}
.ps-plan h4{margin:0;font-size:12.5px;font-weight:600}
.ps-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.ps-hero{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;padding:4px 2px 2px}
.ps-hero .ps-intro{flex:1;min-width:210px}
.ps-hero h2{font-size:15px;font-weight:600;margin:0 0 3px}
.ps-hero p{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b9097);margin:0;line-height:1.5}
.ps-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:start}
.ps-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.ps-col-label{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:600;letter-spacing:.08em;color:var(--dsw-alias-label-tertiary,#8b9097);padding:2px 2px 0;text-transform:uppercase}
.ps-col-label::after{content:"";height:1px;flex:1;background:var(--dsw-alias-border-l1,#eef0f4)}
.ps-guide{border:1.5px solid var(--dsw-alias-state-business-primary,#2b6cff);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-interactive-bg-hover-accent,#f5f9ff);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.ps-guide h3{font-size:14px;font-weight:600;margin:0}
.ps-guide .ps-guide-hint{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b);line-height:1.55;margin:0}
.ps-guide-step{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:600}
.ps-guide-step>span{color:var(--dsw-alias-label-tertiary,#8b9097);font-size:11px;font-weight:500}
.ps-guide-opts{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}
.ps-guide-opt{display:flex;gap:9px;align-items:flex-start;padding:10px 11px;border:1.5px solid var(--dsw-alias-border-l2,#d5dae2);border-radius:var(--dsw-radius-md,9px);cursor:pointer;background:var(--dsw-alias-bg-base,#fff)}
.ps-guide-opt input{margin:2px 0 0;accent-color:var(--dsw-alias-state-business-primary,#2b6cff);flex:0 0 auto}
.ps-guide-opt.on{border-color:var(--dsw-alias-state-business-primary,#2b6cff);background:var(--dsw-alias-interactive-bg-hover-accent,#eef5ff)}
.ps-guide-opt .t{display:block;font-size:12.5px;font-weight:600}
.ps-guide-opt .d{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary,#61666b);line-height:1.45;margin-top:2px}
.ps-guide-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l1,#e4e9f2);padding-top:11px}
.ps-guide-actions .sp{flex:1}
.ps-guide-set{font-size:12px;color:var(--dsw-alias-label-secondary,#61666b);line-height:1.5;margin:0}
.ps-preset-banner{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--dsw-alias-state-business-primary,#2b6cff);border-radius:var(--dsw-radius-md,9px);background:var(--dsw-alias-interactive-bg-hover-accent,#f5f9ff);padding:8px 10px;font-size:12px;line-height:1.5;margin-bottom:10px}
.ps-preset-banner .txt{flex:1;min-width:0}
.ps-net-modes{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px}
@media (max-width:880px){.ps-grid{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.ps-card{padding:12px}.ps-hd .hint{display:none}.ps-guide{padding:12px}.ps-guide-opt{padding:8px}}
`
    let startAdviceChat = () => {}
    const caps = ['install', 'upgrade', 'enable', 'disable', 'configSet', 'memoryWrite']
    const listFields = ['exclude', 'localOnly']
    const GUIDE_KEY = 'dsh-plugin-sync:guide-dismissed:v1'
    const defaultConnection = () => ({
      setup: null, preset: null, mode: 'lan', link: '', verified: false, host: '',
      form: { kind: 'joinCenter', url: '', token: '', ssh: false, host: '', user: '', identityFile: '', port: '22', remotePort: '3081' },
    })
    function parseInviteLink(raw) {
      try {
        const text = String(raw ?? '').trim()
        const question = text.indexOf('?')
        if (question < 0) return null
        const base = text.slice(0, question).replace(/\/plugin-sync\/join\/?$/, '')
        const query = {}
        for (const part of text.slice(question + 1).split('&')) {
          const [name, value = ''] = part.split('=')
          query[decodeURIComponent(name)] = decodeURIComponent(value)
        }
        const token = query.invite || query.token
        if (!base || !token) return null
        if (/^ssh:\/\//i.test(base)) {
          const parsed = new URL(base)
          const remotePort = Number(query.remote) >= 1 && Number(query.remote) <= 65535 ? query.remote : '3081'
          const port = Number(query.port) >= 1 && Number(query.port) <= 65535 ? query.port : '22'
          return {
            url: `http://127.0.0.1:${remotePort}`, token,
            ssh: true, host: parsed.hostname, user: parsed.username || '', port, remotePort,
          }
        }
        if (!/^https?:\/\//i.test(base)) return null
        return { url: base, token, ssh: false }
      } catch { return null }
    }
    function originHint() {
      try { return typeof location !== 'undefined' && location.origin ? location.origin : '' } catch { return '' }
    }
    function guideDismissed() {
      try { return typeof localStorage !== 'undefined' && localStorage.getItem(GUIDE_KEY) === '1' } catch { return false }
    }
    function rememberGuide(dismissed) {
      try {
        if (typeof localStorage === 'undefined') return
        if (dismissed) localStorage.setItem(GUIDE_KEY, '1')
        else localStorage.removeItem(GUIDE_KEY)
      } catch { /* Storage is best effort; the guide still works in-memory. */ }
    }
    const kinds = [
      { key: 'plugin', plan: 'lastPlan', results: 'lastResults', status: 'lastStatus', title: 'sync', label: 'plugins' },
      { key: 'config', plan: 'lastConfigPlan', results: 'lastConfigResults', status: 'lastConfigStatus', title: 'configTitle', label: 'configTitle' },
      { key: 'lingshu', plan: 'lastLingshuPlan', results: 'lastLingshuResults', status: 'lastLingshuStatus', title: 'memoryTitle', label: 'memoryTitle' },
    ]

    function fmt(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (_, key) => Object.hasOwn(values ?? {}, key) ? String(values[key]) : `{${key}}`)
    }
    const safeLabels = new Set(Object.keys(zh))
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
      const ok = {
        check: ['ok'], apply: ['ok', 'partial', 'needsRestart'], proposal: ['pending', 'duplicate', 'conflict', 'queued'],
        acceptProposal: ['accepted', 'published', 'ok'], acceptAndInstall: ['accepted'], rejectProposal: ['rejected', 'ok'],
        publishLocal: ['published', 'updated', 'queued', 'ok'], revokePeer: ['revoked', 'ok'], archiveDecisions: ['archived'],
        suggest: ['ok'], adopt: ['ok'],
      }
      return status && ok[action] && !ok[action].includes(status) ? status : null
    }
    // Neither server messages nor raw network exceptions are displayed.
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
        throw { code: 'network' }
      } finally {
        clearTimeout(timeout)
      }
      let payload
      try { payload = JSON.parse(raw) } catch { /* HTTP status still carries meaning. */ }
      const value = payload?.value
      const error = normalizeCode(responseError(value) ?? actionStatusError(action, value?.status) ?? responseError(payload))
      if (error) throw { code: error }
      if (!response.ok) {
        throw { code: response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 404 ? 'not-found' : 'failed' }
      }
      if (payload?.ok !== true || !Object.hasOwn(payload, 'value')) throw { code: 'bad-response' }
      if (action === 'state' && (!value?.policy || !value.identity)) throw { code: 'bad-response' }
      return value
    }

    function useController() {
      const [state, setState] = useState(null)
      const [inventory, setInventory] = useState(null)
      const [load, setLoad] = useState({ busy: true })
      const [busy, setBusy] = useState(null)
      const [feedback, setFeedback] = useState({})
      const active = useRef(null)
      const seq = useRef(0)
      const refresh = useCallback(async () => {
        const id = ++seq.current
        setLoad((prior) => ({ busy: true, error: prior.error }))
        try {
          const next = await call('state')
          if (id === seq.current) setState(next)
          return next
        } catch (error) {
          if (id === seq.current) setLoad({ busy: false, error: error?.code ?? 'failed' })
          return null
        } finally {
          if (id === seq.current) setLoad((prior) => prior.busy ? { busy: false, error: prior.error } : prior)
        }
      }, [])
      const readInventory = useCallback(async () => {
        try {
          const value = await call('inventory')
          const keyed = (item) => item && typeof item.key === 'string' && item.key
          if (!value || !Array.isArray(value.plugins) || !Array.isArray(value.configs)) throw { code: 'bad-response' }
          const lingshu = value.lingshu && typeof value.lingshu === 'object' && Array.isArray(value.lingshu.layers)
            ? {
                available: Boolean(value.lingshu.available), writable: Boolean(value.lingshu.writable),
                root: typeof value.lingshu.root === 'string' ? value.lingshu.root : null,
                layers: value.lingshu.layers.filter((item) => item && typeof item.layer === 'string')
                  .map((item) => ({ layer: item.layer, eligible: Number(item.eligible) || 0 })),
              }
            : null
          setInventory({
            plugins: value.plugins.filter(keyed).map((item) => ({ key: item.key, enabled: Boolean(item.enabled) })),
            configs: value.configs.filter((item) => keyed(item) && typeof item.entryId === 'string' && Array.isArray(item.fields))
              .map((item) => ({
                key: item.key, entryId: item.entryId, bundle: item.bundle ?? '',
                fields: item.fields.filter((path) => Array.isArray(path) && path.length > 0 && path.every((seg) => typeof seg === 'string' && seg)),
                eligible: item.eligible === true,
              })),
            lingshu,
          })
        } catch (error) {
          setFeedback((prior) => ({ ...prior, inventory: { error: error?.code ?? 'failed' } }))
        }
      }, [])
      useEffect(() => {
        void Promise.all([refresh(), readInventory()])
        return () => { seq.current++ }
      }, [refresh, readInventory])
      const run = async (area, task, { reload = true, success = 'done' } = {}) => {
        if (active.current !== null) return null
        active.current = area
        setBusy(area)
        setFeedback((prior) => ({ ...prior, [area]: null }))
        try {
          const value = await task()
          setFeedback((prior) => ({ ...prior, [area]: { text: typeof success === 'function' ? success(value) : success } }))
          return value
        } catch (error) {
          setFeedback((prior) => ({ ...prior, [area]: { error: error?.code ?? 'failed' } }))
          return null
        } finally {
          if (reload) await refresh()
          active.current = null
          setBusy(null)
        }
      }
      return { state, inventory, load, busy, feedback, refresh, readInventory, run }
    }

    const row = (...children) => h('div', { className: 'ps-row' }, ...children)
    const note = (text, tone) => h('p', { className: `ps-note${tone ? ` ${tone}` : ''}`, role: tone === 'warn' ? 'alert' : undefined }, text)
    function Card({ title, hint, actions, children }) {
      return h('section', { className: 'ps-card' },
        h('div', { className: 'ps-hd' }, h('h3', {}, title), hint && h('span', { className: 'hint' }, hint), h('span', { className: 'sp' }), actions),
        children)
    }
    function Button({ children, onClick, disabled, primary, quiet }) {
      return h('button', { type: 'button', className: `ps-btn${primary ? ' primary' : ''}${quiet ? ' quiet' : ''}`, onClick, disabled }, children)
    }
    function Badge({ children, tone }) {
      return h('span', { className: `ps-badge${tone ? ` ${tone}` : ''}` }, children)
    }
    function Feedback({ area, ctl, t }) {
      const entry = ctl.feedback[area]
      if (ctl.busy === area) return note(t('busy'))
      // Unknown codes keep the machine-readable reason visible: a bare
      // "operation failed" hides exactly the detail needed to fix a link.
      if (entry?.error) return note(safeLabels.has(entry.error) ? t(entry.error) : `${t('failed')} (${entry.error})`, 'warn')
      if (entry?.text) return note(statusText(t, entry.text, 'done'))
      return null
    }
    const act = (ctl, area, name, args, options) => () => ctl.run(area, () => call(name, args), options)

    function useDraft(ctl) {
      const server = ctl.state?.policy
      const [draft, setDraft] = useState(null)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)
      const last = useRef(null)
      const timer = useRef(null)
      useEffect(() => {
        if (!server) return
        const key = JSON.stringify(server)
        if (last.current === key) return
        clearTimeout(timer.current)
        last.current = key
        setDraft(draftFrom(server, ctl.inventory))
      }, [server, ctl.inventory])
      useEffect(() => () => clearTimeout(timer.current), [])
      const save = useCallback(async (next) => {
        const current = ctl.state
        if (!current) return
        setSaving(true)
        setError(null)
        try {
          const value = await call('policy', { policy: payloadFrom(next, current, ctl.inventory) })
          if (value?.policy) last.current = JSON.stringify(value.policy)
          await ctl.refresh()
        } catch (err) {
          setError(err?.code ?? 'failed')
          setDraft(draftFrom(current.policy, ctl.inventory))
        } finally {
          setSaving(false)
        }
      }, [ctl])
      const update = useCallback((patch, immediate = false) => {
        setDraft((prior) => {
          if (!prior) return prior
          const next = { ...prior, ...(typeof patch === 'function' ? patch(prior) : patch) }
          clearTimeout(timer.current)
          if (immediate) void save(next)
          else timer.current = setTimeout(() => void save(next), 600)
          return next
        })
      }, [save])
      return { draft, update, saving, error }
    }

    function draftFrom(policy, inventory) {
      const known = pluginKeys(inventory)
      return {
        selected: (policy.include ?? []).filter((key) => known.has(key)),
        direction: policy.direction,
        autoApply: Boolean(policy.autoApply),
        intervalMs: policy.intervalMs ?? 300000,
        caps: { ...policy.caps },
        exclude: (policy.exclude ?? []).join('\n'),
        localOnly: (policy.localOnly ?? []).join('\n'),
        configFields: structuredCloneSafe(policy.configFields ?? {}),
        configIncluded: (policy.include ?? []).filter((key) => Object.hasOwn(policy.configFields ?? {}, key) &&
          (!(inventory?.configs ?? []).length || (inventory.configs).some((entry) => entry.entryId === key && entry.eligible))),
        memoryLayers: [...(policy.lingshu?.layers ?? [])],
      }
    }
    function structuredCloneSafe(value) {
      try { return JSON.parse(JSON.stringify(value)) } catch { return {} }
    }
    function pluginKeys(inventory) {
      return new Set((inventory?.plugins ?? []).map((item) => item.key))
    }
    function payloadFrom(draft, state, inventory) {
      const policy = state.policy
      const known = pluginKeys(inventory)
      const configIds = new Set((inventory?.configs ?? []).map((entry) => entry.entryId))
      // Memory layer patterns are rebuilt from draft.memoryLayers below; keeping
      // stale ones would make unchecking a layer impossible.
      const keep = (policy.include ?? []).filter((key) => !known.has(key) && !configIds.has(key) && !key.startsWith('lingshu:'))
      const memoryLayers = [...new Set((draft.memoryLayers ?? []).filter((layer) => typeof layer === 'string'))]
      const include = [...new Set([...keep, ...(draft.configIncluded ?? []), ...(draft.selected ?? []), ...memoryLayers.map((layer) => `lingshu:${layer}`)])]
      const caps = { ...policy.caps, ...draft.caps, configSet: (draft.configIncluded ?? []).length > 0, memoryWrite: memoryLayers.length > 0 }
      return {
        ...policy,
        lingshu: { ...(policy.lingshu ?? {}), layers: memoryLayers, maxSensitivity: policy.lingshu?.maxSensitivity ?? 'internal' },
        include,
        exclude: lines(draft.exclude),
        localOnly: lines(draft.localOnly),
        caps,
        configFields: draft.configFields,
        direction: draft.direction,
        intervalMs: Math.max(60000, Math.min(86400000, Number(draft.intervalMs) || 300000)),
        autoApply: Boolean(draft.autoApply),
        mode: draft.autoApply ? 'managed' : 'selective',
        default: 'deny',
      }
    }
    function lines(text) {
      return [...new Set(String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean))]
    }

    function Status({ ctl, t }) {
      const { state } = ctl
      const role = state.identity.role
      const paired = role !== 'unpaired'
      const peer = Object.values(state.peers ?? {})[0]
      const contact = state.center ?? peer
      const connected = Boolean(contact?.lastContact)
      return h('div', { className: 'ps-row', style: { fontSize: 13 } },
        h('strong', {}, state.identity.label),
        h(Badge, {}, t(role)),
        paired && h('span', { className: `ps-dot${connected || state.suspended ? '' : ' off'}` }),
        paired && h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
          state.suspended ? t('suspended') : connected ? t('recentSuccess') : t('waitingForPeer')),
        h('span', { style: { flex: 1 } }),
        h(Button, { quiet: true, onClick: ctl.refresh, disabled: Boolean(ctl.busy) }, t('refresh')),
        paired && h(Button, { quiet: true, onClick: act(ctl, 'status', 'suspend', { value: !state.suspended }) },
          state.suspended ? t('resume') : t('pause')))
    }

    function Guide({ t, onApply, onSkip }) {
      const [mode, setMode] = useState('center')
      const [action, setAction] = useState('create')
      const [network, setNetwork] = useState('lan')
      const choice = (name, value, checked, onChange, title, desc) => h('label', { className: `ps-guide-opt${checked ? ' on' : ''}` },
        h('input', { type: 'radio', name, checked, onChange }),
        h('span', {}, h('span', { className: 't' }, title), h('span', { className: 'd' }, desc)))
      return h('section', { className: 'ps-guide' },
        h('h3', {}, t('guideTitle')),
        h('p', { className: 'ps-guide-hint' }, t('guideHint')),
        h('div', { className: 'ps-guide-step', role: 'radiogroup' },
          h('span', {}, t('guideMode')),
          h('div', { className: 'ps-guide-opts' },
            choice('ps-guide-mode', 'center', mode === 'center', () => setMode('center'), t('modeCenter'), t('modeCenterDesc')),
            choice('ps-guide-mode', 'peer', mode === 'peer', () => setMode('peer'), t('modePeer'), t('modePeerDesc')))),
        h('div', { className: 'ps-guide-step', role: 'radiogroup' },
          h('span', {}, t('guideAction')),
          h('div', { className: 'ps-guide-opts' },
            choice('ps-guide-action', 'create', action === 'create', () => setAction('create'), t('actionCreate'), t('actionCreateDesc')),
            choice('ps-guide-action', 'join', action === 'join', () => setAction('join'), t('actionJoin'), t('actionJoinDesc')))),
        h('div', { className: 'ps-guide-step', role: 'radiogroup' },
          h('span', {}, t('guideNetwork')),
          h('div', { className: 'ps-guide-opts' },
            choice('ps-guide-network', 'lan', network === 'lan', () => setNetwork('lan'), t('netLan'), t('netLanDesc')),
            choice('ps-guide-network', 'ssh', network === 'ssh', () => setNetwork('ssh'), t('netSsh'), t('netSshDesc')),
            choice('ps-guide-network', 'public', network === 'public', () => setNetwork('public'), t('netPublic'), t('netPublicDesc')))),
        h('div', { className: 'ps-guide-actions' },
          h(Button, { primary: true, onClick: () => onApply({ mode, action, network }) }, t('guideApply')),
          h(Button, { quiet: true, onClick: onSkip }, t('guideSkip')),
          h('span', { className: 'sp' }),
          h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary,#8b9097)' } }, t('guideSkipHint'))))
    }

    function Advice({ ctl, t, draftCtl }) {
      const { state, inventory } = ctl
      const include = state.policy.include ?? []
      const missing = (inventory?.plugins ?? []).filter((item) => !include.includes(item.key))
      const suggestions = Array.isArray(state.suggestions) ? state.suggestions : []
      const [open, setOpen] = useState(false)
      const addAll = () => draftCtl.update({ selected: [...new Set([...(draftCtl.draft?.selected ?? []), ...missing.map((item) => item.key)])] }, true)
      const ask = () => {
        const plugins = (inventory?.plugins ?? []).map((item) => `- ${item.key} (${item.enabled ? 'enabled' : 'disabled'})`).join('\n')
        const prompt = [
          'Analyze the plugins installed on this device and suggest which should join cross-device sync and which must stay local.',
          'Ignore IM/chat/memory/Lingshu plugins and anything bound to one machine or already in its own sync domain; do not emit suggestions for them.',
          'Return a JSON array only: [{"key":"...","action":"sync|localOnly|skip","reason":"..."}]',
          'Installed plugins:',
          plugins || '(none)',
        ].join('\n')
        startAdviceChat(prompt)
      }
      const adopt = (ids) => ctl.run('advice', async () => { await call('adopt', { ids }) }, { success: 'saved' })
      const syncCount = suggestions.filter((item) => item.action === 'sync').length
      const localCount = suggestions.filter((item) => item.action === 'localOnly').length
      const actions = []
      if (suggestions.length) actions.push(h(Button, { key: 'toggle', quiet: true, onClick: () => setOpen((value) => !value) }, t(open ? 'hideList' : 'showList')))
      actions.push(h(Button, { key: 'ask', onClick: ask }, t('askAgent')))
      return h(Card, { title: t('advice'), hint: t('adviceHint'), actions },
        h('div', { className: 'ps-split' },
          h('span', { className: 'txt' }, missing.length
            ? h('span', {}, h('b', {}, String(missing.length)), ' ', t('notIncluded'))
            : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, t('allIncluded'))),
          missing.length > 0 && h(Button, { onClick: addAll, disabled: Boolean(ctl.busy) }, t('adoptAll'))),
        note(t('askAgentHint')),
        suggestions.length > 0 && h('div', { className: 'ps-split' },
          h('span', { className: 'txt' }, fmt(t('adviceScope'), { sync: syncCount, local: localCount })),
          h(Button, { quiet: true, onClick: () => setOpen((value) => !value) }, t(open ? 'hideList' : 'showList'))),
        open && suggestions.length > 0 && h('ul', { className: 'ps-list', style: { marginTop: 8 } },
          suggestions.map((item) => h('li', { key: item.id },
            h('span', { className: 'name' }, item.key),
            h(Badge, { tone: item.action === 'sync' ? 'ok' : item.action === 'localOnly' ? 'warn' : '' },
              t(item.action === 'sync' ? 'adopt' : item.action === 'localOnly' ? 'keepLocal' : 'dismiss')),
            h('span', { style: { width: '100%', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' } }, item.reason),
            h(Button, { quiet: true, onClick: () => adopt([item.id]), disabled: Boolean(ctl.busy) },
              t(item.action === 'localOnly' ? 'keepLocal' : 'adopt'))))),
        h(Feedback, { area: 'advice', ctl, t }))
    }

    function layerLabel(t, layer) {
      const key = 'memoryLayer' + layer.charAt(0).toUpperCase() + layer.slice(1)
      return safeLabels.has(key) ? t(key) : layer
    }

    // Memory scope lives here because it is a resource selection, not a plugin
    // property. Only layers Lingshu itself lets a reviewer-less writer touch are
    // offered; the write gate still decides each node at apply time.
    function MemoryScope({ t, inventory, draft, update, disabled }) {
      const memory = inventory?.lingshu
      const layers = memory?.layers ?? []
      const chosen = new Set(draft.memoryLayers ?? [])
      const toggle = (layer, on) => update({
        memoryLayers: on ? [...new Set([...(draft.memoryLayers ?? []), layer])] : (draft.memoryLayers ?? []).filter((item) => item !== layer),
      }, true)
      const offered = layers.filter((item) => ['contextual', 'goals', 'unresolved', 'knowledge', 'structural'].includes(item.layer)
        && ((item.eligible ?? 0) > 0 || chosen.has(item.layer)))
      return h('div', { style: { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--dsw-alias-border-l1,#eef0f4)' } },
        h('div', { className: 'ps-sub' }, t('memoryTitle')),
        h('p', { className: 'ps-note' }, t('memoryHint')),
        !memory || !memory.available ? note(t('memoryUnavailable')) : null,
        memory?.available && offered.length === 0 ? note(t('memoryEmpty')) : null,
        memory?.available && offered.length > 0 && h('div', { className: 'ps-row' },
          offered.map((item) => h('label', { key: item.layer, className: 'ps-check' },
            h('input', {
              type: 'checkbox', checked: chosen.has(item.layer), disabled: disabled || !memory.writable,
              onChange: (event) => toggle(item.layer, event.target.checked),
            }),
            `${layerLabel(t, item.layer)} (${item.eligible ?? 0})`))),
        memory?.available && !memory.writable ? note(t('memoryUnavailable'), 'warn') : null,
        memory?.available && memory.writable ? note(t('memoryTierHint')) : null)
    }

    function Scope({ ctl, t, draftCtl }) {
      const { state, inventory } = ctl
      const { draft, update, saving, error } = draftCtl
      const [search, setSearch] = useState('')
      const [expanded, setExpanded] = useState(false)
      if (!draft) return null
      const disabled = Boolean(ctl.busy)
      const all = inventory?.plugins ?? []
      const selected = draft.selected ?? []
      const term = search.trim().toLowerCase()
      const visible = all.filter((item) => !term || item.key.toLowerCase().includes(term))
      const shown = term || expanded ? visible : visible.slice(0, 8)
      const hidden = visible.length - shown.length
      const setSelected = (next, immediate = true) => update({ selected: [...new Set(next)] }, immediate)
      const exportJson = () => {
        try {
          const blob = new Blob([JSON.stringify({ version: 1, plugins: selected, config: draft.configIncluded ?? [] }, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = 'device-sync-scope.json'
          anchor.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch { /* download is best effort */ }
      }
      const importJson = () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json'
        input.addEventListener('change', () => {
          const file = input.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            let data = null
            try { data = JSON.parse(String(reader.result)) } catch { data = null }
            if (!data || !Array.isArray(data.plugins)) { update({ selected }, true); return }
            const known = pluginKeys(inventory)
            const configIds = new Set((inventory?.configs ?? []).filter((entry) => entry.eligible).map((entry) => entry.entryId))
            const configIncluded = (Array.isArray(data.config) ? data.config : []).filter((key) => typeof key === 'string' && configIds.has(key))
            const configFields = structuredCloneSafe(draft.configFields ?? {})
            for (const entry of inventory?.configs ?? []) {
              if (configIncluded.includes(entry.entryId)) configFields[entry.entryId] = (entry.fields ?? []).filter((path) => Array.isArray(path) && path.length)
              else delete configFields[entry.entryId]
            }
            const imported = data.plugins.filter((key) => typeof key === 'string' && known.has(key))
            update({ selected: [...new Set(imported)], configFields, configIncluded, caps: { ...draft.caps, configSet: configIncluded.length > 0 } }, true)
          }
          reader.readAsText(file)
        })
        input.click()
      }
      // Only configs with multiple non-secret fields offer "同步设置". A single
      // field is a tweak, not a switchable settings surface (matches engine gate).
      const configsFor = (pluginKey) => (inventory?.configs ?? []).filter((entry) =>
        entry.eligible && (entry.bundle === pluginKey || entry.key === pluginKey))
      const settingsOn = (pluginKey) => configsFor(pluginKey).some((entry) =>
        (draft.configFields?.[entry.entryId] ?? []).length > 0 && (draft.configIncluded ?? []).includes(entry.entryId))
      const toggleSettings = (pluginKey, on) => {
        const configFields = { ...draft.configFields }
        const included = new Set(draft.configIncluded ?? [])
        for (const entry of configsFor(pluginKey)) {
          if (on) {
            configFields[entry.entryId] = (entry.fields ?? []).filter((path) => Array.isArray(path) && path.length)
            included.add(entry.entryId)
          } else {
            delete configFields[entry.entryId]
            included.delete(entry.entryId)
          }
        }
        update({ configFields, configIncluded: [...included], caps: { ...draft.caps, configSet: included.size > 0 } }, true)
      }
      return h(Card, { title: t('scope'), hint: t('scopeHint'), actions: saving ? h('span', { className: 'hint' }, t('busy')) : null },
        h('div', { className: 'ps-row', style: { marginBottom: 10 } },
          h('label', { className: 'ps-field' }, h('span', {}, t('direction')),
            h('select', { className: 'ps-input', value: draft.direction, disabled, onChange: (event) => update({ direction: event.target.value }, true) },
              ['both', 'push', 'pull'].map((value) => h('option', { key: value, value }, t(value)))))),
        h('div', { className: 'ps-pick' },
          h('span', { className: 'count' }, fmt(t('selectedCount'), { n: selected.length, m: all.length })),
          h('span', { className: 'sp' }),
          h(Button, { quiet: true, disabled, onClick: () => setSelected([...selected, ...all.map((item) => item.key)]) }, t('selectAll')),
          h(Button, { quiet: true, disabled, onClick: () => setSelected([]) }, t('selectNone')),
          h(Button, { quiet: true, disabled, onClick: () => ctl.readInventory() }, t('reload'))),
        h('input', { className: 'ps-input ps-search', type: 'search', value: search, placeholder: t('search'), disabled, onChange: (event) => setSearch(event.target.value) }),
        h('ul', { className: 'ps-list' },
          shown.map((item) => {
            const found = configsFor(item.key)
            return h('li', { key: item.key },
              h('input', { type: 'checkbox', checked: selected.includes(item.key), disabled, onChange: (event) => setSelected(event.target.checked ? [...selected, item.key] : selected.filter((key) => key !== item.key)) }),
              h('span', { className: 'name' }, item.key, !item.enabled && h('small', {}, t('disable'))),
              found.length > 0 && h('label', { className: 'ps-plugin-settings', title: t('syncSettingsHint') },
                h('input', { type: 'checkbox', checked: settingsOn(item.key), disabled, onChange: (event) => toggleSettings(item.key, event.target.checked) }),
                t('syncSettings')))
          })),
        hidden > 0 && h(Button, { quiet: true, onClick: () => setExpanded(true) }, fmt(t('more'), { n: hidden })),
        expanded && all.length > 8 && h(Button, { quiet: true, onClick: () => setExpanded(false) }, t('showLess')),
        h('div', { style: { marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--dsw-alias-border-l1,#eef0f4)' } },
          h('div', { className: 'ps-sub' }, t('allowed')),
          h('div', { className: 'ps-row' },
            caps.map((cap) => h('label', { key: cap, className: 'ps-check' },
              h('input', { type: 'checkbox', checked: Boolean(draft.caps?.[cap]), disabled, onChange: (event) => update({ caps: { ...draft.caps, [cap]: event.target.checked } }, true) }),
              t(cap)))),
          note(t('noProtected')),
          h('div', { className: 'ps-sub', style: { marginTop: 10 } }, t('rules')),
          h('div', { className: 'ps-row', style: { alignItems: 'flex-start' } },
            h('label', { className: 'ps-field', style: { flex: '1 1 200px' } }, h('span', {}, t('excludeLabel')),
              h('textarea', { className: 'ps-input', rows: 3, value: draft.exclude, disabled, onChange: (event) => update({ exclude: event.target.value }) })),
            h('label', { className: 'ps-field', style: { flex: '1 1 200px' } }, h('span', {}, t('localOnlyLabel')),
              h('textarea', { className: 'ps-input', rows: 3, value: draft.localOnly, disabled, onChange: (event) => update({ localOnly: event.target.value }) })))),
        h(MemoryScope, { t, inventory, draft, update, disabled }),
        all.length > 0 && selected.length === 0 && note(t('noneWarn'), 'warn'),
        h('div', { className: 'ps-row', style: { marginTop: 12 } },
          h(Button, { quiet: true, onClick: importJson, disabled }, t('importJson')),
          h(Button, { quiet: true, onClick: exportJson, disabled: !selected.length }, t('exportJson'))),
        error && note(statusText(t, error), 'warn'),
        h(Feedback, { area: 'scope', ctl, t }))
    }

    function Plan({ ctl, t, kind }) {
      const { state } = ctl
      const plan = state[kind.plan]
      const results = state[kind.results] ?? []
      const status = state[kind.status]?.status
      const [chosen, setChosen] = useState(null)
      const ops = plan?.operations ?? []
      const conflicts = plan?.conflicts ?? []
      const idle = ctl.busy
      const role = state.identity.role
      const canPush = !state.suspended && state.policy.direction !== 'pull'
      // Only a member with an upstream has something to compare against.
      const canPull = Boolean(state.center) && !state.suspended && state.policy.direction !== 'push'
      const canPropose = (role === 'device' || (role === 'peer' && Boolean(state.center))) && canPush
      const canPublish = (role === 'center' || (role === 'peer' && !state.center)) && canPush
      const selected = plan && chosen?.planId === plan.planId ? chosen.ids : defaultOps(ops)
      const toggle = (opId) => setChosen({ planId: plan.planId, ids: selected.includes(opId) ? selected.filter((id) => id !== opId) : [...selected, opId] })
      const blocked = conflicts.length > 0
      const summary = []
      if (results.length) {
        const applied = results.filter((item) => ['applied', 'needsRestart'].includes(item.status)).length
        const restart = results.filter((item) => item.status === 'needsRestart').length
        const failed = results.filter((item) => item.status === 'failed' || item.status === 'compensationFailed').length
        if (applied) summary.push(fmt(t('appliedN'), { n: applied }))
        if (restart) summary.push(fmt(t('restartN'), { n: restart }))
        if (failed) summary.push(t('applyFailedHere') + ` ${failed}`)
      }
      const skipped = (plan?.skipped ?? []).length
      const applyNow = () => ctl.run(kind.key, async () => {
        await call('approve', { planId: plan.planId, opIds: selected, actor: 'user' })
        return call('apply', { planId: plan.planId })
      }, { success: (value) => value?.status === 'ok' ? 'done' : value?.status ?? 'done' })
      return h('div', { className: 'ps-plan' },
        h('div', { className: 'ps-hd' },
          h('h4', {}, t(kind.label)),
          plan && h(Badge, { tone: plan.operations.length ? '' : 'ok' }, fmt(t(plan.operations.length ? 'waiting' : 'noIncoming'), { n: plan.operations.length })),
          h('span', { className: 'sp' }),
          canPull && h(Button, { quiet: true, disabled: Boolean(idle), onClick: act(ctl, kind.key, 'check', { kind: kind.key }) }, t('compare')),
          canPropose && h(Button, { quiet: true, disabled: Boolean(idle), onClick: act(ctl, kind.key, 'proposal', { kind: kind.key }, { success: (value) => value?.status ?? 'done' }) }, t('sendTheirs')),
          canPublish && h(Button, { quiet: true, disabled: Boolean(idle), onClick: act(ctl, kind.key, 'publishLocal', { kind: kind.key }, { success: (value) => value?.status ?? 'done' }) }, t('publishLocal'))),
        conflicts.length > 0 && h('div', {},
          note(t('conflictHint')),
          h('ul', { className: 'ps-list' }, conflicts.map((conflict) => h('li', { key: conflict.key },
            h('span', { className: 'name' }, conflict.key),
            h(Button, { quiet: true, disabled: Boolean(idle), onClick: act(ctl, kind.key, 'resolvePlanConflict', { planId: plan.planId, key: conflict.key, choice: 'local' }) }, t('keepMine')),
            h(Button, { quiet: true, disabled: Boolean(idle), onClick: act(ctl, kind.key, 'resolvePlanConflict', { planId: plan.planId, key: conflict.key, choice: 'remote' }) }, t('useTheirs')))))),
        ops.length > 0 && !blocked && h('ul', { className: 'ps-ops' },
          ops.map((op) => h('li', { key: op.opId },
            h('input', { type: 'checkbox', checked: selected.includes(op.opId), disabled: Boolean(idle), onChange: () => toggle(op.opId) }),
            h('span', { className: 'sp' }, `${t(op.action)} ${op.key}`),
            op.risk === 'high' && h(Badge, { tone: 'warn' }, t('highRisk'))))),
        ops.length > 0 && !blocked && h('div', { className: 'ps-row', style: { marginTop: 8 } },
          h(Button, { primary: true, disabled: Boolean(idle) || !canPull || selected.length === 0, onClick: applyNow }, fmt(t('applySelected'), { n: selected.length }))),
        blocked && note(t('conflictBlocked')),
        skipped > 0 && note(fmt(t('skippedN'), { n: skipped })),
        summary.length > 0 && note(fmt(t('lastResult'), { text: summary.join(' · ') })),
        h(Feedback, { area: kind.key, ctl, t }))
    }
    function defaultOps(ops) {
      return ops.filter((op) => !['install', 'upgrade'].includes(op.action)).map((op) => op.opId)
    }

    function Sync({ ctl, t }) {
      const { state } = ctl
      const proposals = (state.proposals ?? []).filter((item) => item.status === 'pending')
      const conflicts = (state.conflicts ?? []).filter((item) => item.status === 'open')
      return h(Card, { title: t('sync'), hint: t('syncHint') },
        proposals.length === 0 && conflicts.length === 0 ? null : h('div', { style: { marginBottom: 10 } },
          proposals.map((proposal) => h('div', { key: proposal.id, className: 'ps-split' },
            h('span', { className: 'txt' },
              h('b', {}, t('incoming')), ' ', t('from'), ' ', proposal.origin?.label ?? '—',
              h('br'), h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11.5 } }, (proposal.keys ?? []).join('、'))),
            h(Button, { primary: true, disabled: Boolean(ctl.busy), onClick: act(ctl, 'incoming', 'acceptProposal', { proposalId: proposal.id }, { success: (value) => value?.status ?? 'done' }) }, t('accept')),
            (proposal.resources ?? []).some((entry) => entry.kind === 'plugin') && h(Button, { quiet: true, disabled: Boolean(ctl.busy), onClick: act(ctl, 'incoming', 'acceptAndInstall', { proposalId: proposal.id }, { success: (value) => value?.status ?? 'done' }) }, t('acceptInstall')),
            h(Button, { quiet: true, disabled: Boolean(ctl.busy), onClick: act(ctl, 'incoming', 'rejectProposal', { proposalId: proposal.id }, { success: 'rejected' }) }, t('reject')))),
          conflicts.map((conflict) => h('div', { key: conflict.id, className: 'ps-split' },
            h('span', { className: 'txt' }, h('b', {}, t('conflict')), ' · ', conflict.key),
            h(Button, { quiet: true, disabled: Boolean(ctl.busy), onClick: act(ctl, 'incoming', 'resolveConflict', { conflictId: conflict.id, choice: 'local' }) }, t('keepMine')),
            h(Button, { quiet: true, disabled: Boolean(ctl.busy), onClick: act(ctl, 'incoming', 'resolveConflict', { conflictId: conflict.id, choice: 'remote' }) }, t('useTheirs'))))),
        h(Feedback, { area: 'incoming', ctl, t }),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          kinds.filter((kind) => kind.key === 'plugin'
            || (kind.key === 'config' && state.policy.caps?.configSet)
            || (kind.key === 'lingshu' && (state.policy.lingshu?.layers ?? []).length > 0))
            .map((kind) => h(Plan, { key: kind.key, ctl, t, kind }))))
    }

    function Connections({ ctl, t, connection, setConnection, onReopen, onReset }) {
      const { state } = ctl
      const syncPort = state.syncPort ?? 3081
      const role = state.identity.role
      const paired = role !== 'unpaired'
      const host = role === 'center' || (role === 'peer' && !state.center)
      const [invite, setInvite] = useState(null)
      const [confirmReset, setConfirmReset] = useState(false)
      const { setup, form, preset, mode, link, verified } = connection
      const patch = (values) => setConnection((prior) => ({ ...prior, ...values }))
      const setSetup = (value) => patch({ setup: value })
      const setForm = (value) => patch({ form: value, verified: false })
      const setMode = (next) => setConnection((prior) => {
        const updated = { ...prior.form }
        if (next === 'ssh') { updated.ssh = true; updated.url = `http://127.0.0.1:${syncPort}` }
        else {
          updated.ssh = false
          if (updated.url === `http://127.0.0.1:${syncPort}`) updated.url = ''
        }
        return { ...prior, mode: next, verified: false, form: updated }
      })
      const peers = Object.values(state.peers ?? {})
      const peerLimit = role === 'peer' && (Boolean(state.center) || peers.some((peer) => peer.status === 'connected'))
      const disabled = Boolean(ctl.busy)
      const sshArgs = () => form.ssh ? { kind: 'ssh', host: form.host.trim(), user: form.user.trim(), identityFile: form.identityFile.trim(), port: Number(form.port) || 22, remotePort: Number(form.remotePort) || syncPort } : undefined
      const createInvite = () => ctl.run('connection', async () => {
        const value = await call('invite')
        if (typeof value?.token !== 'string' || !value.token) throw { code: 'bad-response' }
        setInvite(value)
      }, { reload: false })
      const pair = (topology) => ctl.run('connection', async () => {
        await call('pairCenter', { topology, initSource: 'local', label: state.identity.label })
      }, { success: 'done' })
      const useLink = () => ctl.run('link', async () => {
        const parsed = parseInviteLink(link)
        if (!parsed) throw { code: 'invalid-invitation' }
        patch({ link, verified: false, form: { ...form, ...parsed } })
      }, { reload: false, success: 'linkParsed' })
      const verify = () => ctl.run('verify', async () => {
        const value = await call('verify', { url: form.url.trim(), token: form.token.trim(), ssh: sshArgs() })
        if (!value?.verified) throw { code: 'verify-failed' }
        patch({ verified: true })
      }, { reload: false, success: 'verified' })
      const join = () => ctl.run('connection', async () => {
        await call(form.kind, { url: form.url.trim(), token: form.token.trim(), ssh: sshArgs() })
      }, { success: 'done' })
      const reset = () => ctl.run('connection', async () => {
        await call('reset')
        setInvite(null)
        setConfirmReset(false)
        if (onReset) onReset()
      }, { success: 'resetDone' })
      const inviteLink = () => {
        if (!invite?.token) return ''
        const token = encodeURIComponent(invite.token)
        if (mode === 'ssh') {
          const user = form.user.trim() ? `${form.user.trim()}@` : ''
          return `ssh://${user}${form.host.trim() || 'host'}/plugin-sync/join?invite=${token}&remote=${form.remotePort || syncPort}&port=${form.port || '22'}`
        }
        const raw = (connection.host || originHint() || `http://127.0.0.1:${syncPort}`).replace(/\/$/, '')
        const withScheme = /^https?:\/\//i.test(raw) ? raw : `${mode === 'public' ? 'https://' : 'http://'}${raw}`
        const base = withScheme.replace(/^(https?:\/\/(?:\[[^\]]+\]|[^/?#:]+))(?:\:\d+)?/, `$1:${syncPort}`)
        return `${base.replace(/\/$/, '')}/plugin-sync/join?invite=${token}`
      }
      const pickFile = () => ctl.run('pickFile', async () => {
        const value = await call('pickFile')
        if (value?.path) setForm({ ...form, identityFile: value.path })
      }, { reload: false, success: 'done' })
      const copyLink = () => ctl.run('copy', async () => {
        try {
          if (typeof navigator === 'undefined' || !navigator.clipboard) throw { code: 'copy-failed' }
          await navigator.clipboard.writeText(inviteLink())
        } catch { throw { code: 'copy-failed' } }
      }, { reload: false, success: 'copied' })
      const actions = confirmReset
        ? h('span', { className: 'ps-row', style: { gap: 4 } },
          h(Button, { quiet: true, disabled, onClick: reset }, t('resetConfirm')),
          h(Button, { quiet: true, onClick: () => setConfirmReset(false) }, t('cancel')))
        : h('span', { className: 'ps-row', style: { gap: 4 } },
          onReopen && h(Button, { quiet: true, onClick: onReopen }, t('guideReopen')),
          h(Button, { quiet: true, disabled, onClick: () => setConfirmReset(true) }, t('resetSync')))
      return h(Card, { title: t('connections'), hint: t('connectionsHint'), actions },
        preset && h('div', { className: 'ps-preset-banner' },
          h('span', { className: 'txt' }, fmt(t('presetBanner'), {
            mode: t(preset.mode === 'center' ? 'modeCenterShort' : 'modePeerShort'),
            action: t(preset.action === 'create' ? 'actionCreateShort' : 'actionJoinShort'),
            hint: t(preset.action === 'create' ? 'presetCreateHint' : 'presetJoinHint'),
          }))),
        h('div', { className: 'ps-net-modes', role: 'group' },
          [['lan', 'netLan'], ['ssh', 'netSsh'], ['public', 'netPublic']].map(([value, label]) =>
            h(Button, { key: value, primary: mode === value, onClick: () => setMode(value) }, t(label)))),
        note(t(mode === 'lan' ? 'lanHint' : mode === 'ssh' ? 'sshModeHint' : 'publicHint'), mode === 'public' ? 'warn' : undefined),
        !paired && h('div', {},
          note(t('setupHint')),
          row(h(Button, { primary: setup === 'center', onClick: () => pair('center') }, t('createCenter')),
            h(Button, { primary: setup === 'peer', onClick: () => pair('p2p') }, t('listenPeer')),
            h(Button, { primary: setup === 'join', onClick: () => setSetup(setup === 'join' ? null : 'join') }, t('joinCenter')))),
        !paired && setup === 'join' && h('div', { style: { marginTop: 10 } },
          h('label', { className: 'ps-field' }, h('span', {}, t('inviteLink')),
            h('div', { className: 'ps-row' },
              h('input', { className: 'ps-input', value: link, placeholder: t('inviteLinkHint'), onChange: (event) => patch({ link: event.target.value, verified: false }) }),
              h(Button, { disabled: disabled || !link.trim(), onClick: useLink }, t('parseLink')))),
          h('div', { className: 'ps-row', style: { marginTop: 8 } },
            h('label', { className: 'ps-field', style: { flex: '1 1 200px' } }, h('span', {}, t('joinKind')),
              h('select', { className: 'ps-input', value: form.kind, onChange: (event) => setForm({ ...form, kind: event.target.value }) },
                h('option', { value: 'joinCenter' }, t('center')), h('option', { value: 'connectPeer' }, t('peer')))),
            h('label', { className: 'ps-field', style: { flex: '1 1 240px' } }, h('span', {}, t('joinUrl')),
              h('input', { className: 'ps-input', value: form.url, onChange: (event) => setForm({ ...form, url: event.target.value }), placeholder: mode === 'public' ? `https://sync.example.com:${syncPort}` : `http://192.0.2.10:${syncPort}` }))),
          h('details', { style: { marginTop: 8 }, open: mode === 'ssh' }, h('summary', { style: { fontSize: 12, cursor: 'pointer' } }, t('ssh')),
            h('div', { className: 'ps-row', style: { marginTop: 8 } },
              h('label', { className: 'ps-check' }, h('input', { type: 'checkbox', checked: form.ssh, onChange: (event) => setForm({ ...form, ssh: event.target.checked }) }), t('ssh')),
              ['host', 'user', 'port'].map((key) => h('label', { key, className: 'ps-field', style: { flex: '1 1 150px' } },
                h('span', {}, t(key === 'host' ? 'sshHost' : key === 'user' ? 'sshUser' : 'sshPort')),
                h('input', { className: 'ps-input', value: form[key], disabled: !form.ssh, onChange: (event) => setForm({ ...form, [key]: event.target.value }) }))),
              h('label', { className: 'ps-field', style: { flex: '1 1 240px' } }, h('span', {}, t('sshIdentity')),
                h('div', { className: 'ps-row' },
                  h('input', { className: 'ps-input', style: { flex: 1 }, value: form.identityFile, disabled: !form.ssh, onChange: (event) => setForm({ ...form, identityFile: event.target.value }) }),
                  h(Button, { quiet: true, disabled: disabled || !form.ssh, onClick: pickFile }, t('pickFile'))))),
            note(t('sshHint'))),
          h('div', { className: 'ps-row', style: { marginTop: 10 } },
            h(Button, { disabled: disabled || !form.url.trim() || !form.token.trim(), onClick: verify }, t('verifyLink')),
            verified && h(Badge, { tone: 'ok' }, t('verified')),
            h(Button, { primary: true, disabled: disabled || !verified || !form.url.trim() || !form.token.trim(), onClick: join }, t('joinCenter'))),
          h(Feedback, { area: 'link', ctl, t }),
          h(Feedback, { area: 'pickFile', ctl, t }),
          h(Feedback, { area: 'verify', ctl, t })),
        paired && h('div', {},
          peers.length === 0 && !state.center ? note(t('noPeers')) : h('ul', { className: 'ps-list' },
            state.center && h('li', {},
              h('span', { className: 'name' }, state.center.label ?? t('center'),
                h('small', {}, state.center.lastContact ? `${t('lastContact')} ${state.center.lastContact}` : t('unconfirmed'))),
              h(Badge, { tone: state.center.lastContact ? 'ok' : '' }, t(state.center.lastContact ? 'online' : 'unconfirmed'))),
            peers.map((peer) => h('li', { key: peer.deviceId },
              h('span', { className: 'name' }, peer.label ?? peer.deviceId.slice(0, 12),
                h('small', {}, [peer.profileId, peer.lastContact].filter(Boolean).join(' · '))),
              h(Badge, { tone: peer.status === 'connected' ? 'ok' : '' }, t(peer.status === 'revoked' ? 'revoked' : peer.status === 'connected' ? 'online' : 'offlineState')),
              host && peer.status !== 'revoked' && h(Button, { quiet: true, disabled: Boolean(ctl.busy), onClick: act(ctl, 'connection', 'revokePeer', { deviceId: peer.deviceId }, { success: 'revoked' }) }, t('revoke'))))),
          host && h('div', { style: { marginTop: 10 } },
            h('div', { className: 'ps-row' },
              h(Button, { disabled: disabled || peerLimit, onClick: createInvite }, t('invite')),
              invite && h(Button, { quiet: true, onClick: () => setInvite(null) }, t('hideInvite'))),
            invite && h('div', { style: { marginTop: 8 } },
              h('label', { className: 'ps-field' }, h('span', {}, t('hostAddress')),
                h('input', { className: 'ps-input', value: connection.host || originHint(), placeholder: `http://192.0.2.10:${syncPort}`, onChange: (event) => patch({ host: event.target.value }) })),
              h('label', { className: 'ps-field', style: { marginTop: 8 } }, h('span', {}, t('inviteLink')),
                h('code', { className: 'ps-mono ps-code' }, inviteLink())),
              h('div', { className: 'ps-row', style: { marginTop: 8 } },
                h(Button, { quiet: true, disabled, onClick: copyLink }, t('copyLink'))),
              note(`${t('inviteExpires')} ${invite.expiresAt ?? '—'}`)),
            peerLimit && note(t('peerLimit')),
            note(t('secureHint')))),
        note(t('resetHint')),
        h(Feedback, { area: 'connection', ctl, t }),
        h(Feedback, { area: 'copy', ctl, t }))
    }

    function More({ ctl, t }) {
      const { state } = ctl
      const [snapshot, setSnapshot] = useState('')
      const exportSnapshot = () => ctl.run('snapshot', async () => {
        const value = await call('snapshot')
        if (value?.kind !== 'plugin-sync-snapshot') throw { code: 'bad-response' }
        setSnapshot(JSON.stringify(value, null, 2))
      }, { reload: false })
      const importSnapshot = () => ctl.run('snapshot', async () => {
        await call('loadSnapshot', { text: snapshot })
        await call('check', { kind: 'all', source: 'snapshot' })
      }, { success: 'snapshotLoaded' })
      const audit = (state.audit ?? []).slice(-5).reverse()
      return h(Card, { title: t('moreCard') },
        h('details', {},
          h('summary', { style: { fontSize: 12.5, cursor: 'pointer' } }, `${t('snapshot')} · ${t('snapshotHint')}`),
          h('div', { style: { marginTop: 8 } },
            h('textarea', { className: 'ps-input', rows: 3, value: snapshot, placeholder: t('snapshotText'), onChange: (event) => setSnapshot(event.target.value), disabled: Boolean(ctl.busy) }),
            h('div', { className: 'ps-row', style: { marginTop: 8 } },
              h(Button, { quiet: true, disabled: Boolean(ctl.busy), onClick: exportSnapshot }, t('exportSnapshot')),
              h(Button, { quiet: true, disabled: Boolean(ctl.busy) || !snapshot.trim(), onClick: importSnapshot }, t('importSnapshot'))),
            state.pendingSnapshot && note(t('unsigned'), 'warn'),
            h(Feedback, { area: 'snapshot', ctl, t }))),
        h('div', { className: 'ps-split' },
          h('span', { className: 'txt' }, t('archive'), h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, ' · ' + t('archiveHint'))),
          h(Button, { quiet: true, disabled: Boolean(ctl.busy), onClick: act(ctl, 'archive', 'archiveDecisions', {}, { success: 'archived' }) }, t('archive'))),
        h(Feedback, { area: 'archive', ctl, t }),
        audit.length > 0 && h('div', { style: { marginTop: 6 } },
          h('div', { className: 'ps-sub' }, t('activity')),
          h('ul', { className: 'ps-list' }, audit.map((entry) => h('li', { key: entry.seq },
            h('span', { className: 'name' }, entry.kind),
            h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11.5 } }, entry.at))))))
    }

    function Advanced({ ctl, t, draftCtl }) {
      const { draft, update, saving, error } = draftCtl
      if (!draft) return null
      const disabled = Boolean(ctl.busy)
      const units = [60000, 300000, 900000, 3600000, 86400000]
      const intervalText = (ms) => ms >= 3600000 ? `${ms / 3600000} ${t('hours')}` : `${Math.round(ms / 60000)} ${t('minutes')}`
      return h('details', { className: 'ps-adv' },
        h('summary', {}, t('advanced'), saving ? h('span', { className: 'hint', style: { fontWeight: 400 } }, t('saved')) : null),
        h('div', { className: 'ps-adv-body' },
          h('div', {},
            h('div', { className: 'ps-sub' }, t('autoApply')),
            h('label', { className: 'ps-check' },
              h('input', { type: 'checkbox', checked: draft.autoApply, disabled, onChange: (event) => update({ autoApply: event.target.checked }, true) }),
              t('autoApply')),
            note(t('autoApplyHint')),
            draft.autoApply && h('div', { className: 'ps-row', style: { marginTop: 8 } },
              h('label', { className: 'ps-field' }, h('span', {}, t('interval')),
                h('select', { className: 'ps-input', value: draft.intervalMs, disabled, onChange: (event) => update({ intervalMs: Number(event.target.value) }, true) },
                  units.map((ms) => h('option', { key: ms, value: ms }, intervalText(ms))))))),
          error && note(statusText(t, error), 'warn'),
          h(Feedback, { area: 'policy', ctl, t })))
    }

    function SyncTab({ t }) {
      const ctl = useController()
      const draftCtl = useDraft(ctl)
      const [connection, setConnection] = useState(defaultConnection)
      const [guideOpen, setGuideOpen] = useState(() => !guideDismissed())
      const { state, load } = ctl
      if (!state) {
        return h('div', { className: 'ps-wrap' }, h('style', {}, css),
          h(Card, { title: t('settings') },
            load.error ? note(`${t('loadingFailed')} ${statusText(t, load.error)}`, 'warn') : note(t('loading')),
            load.error && row(h(Button, { quiet: true, onClick: ctl.refresh }, t('retry')))))
      }
      const paired = state.identity.role !== 'unpaired'
      const applyPreset = (preset) => {
        const network = preset.network ?? 'lan'
        setConnection((prior) => {
          const form = {
            ...prior.form,
            kind: preset.mode === 'center' ? 'joinCenter' : 'connectPeer',
            ssh: network === 'ssh',
            url: network === 'ssh' ? `http://127.0.0.1:${state.syncPort ?? 3081}` : prior.form.url,
          }
          return {
            ...prior, preset, mode: network, verified: false, form,
            setup: preset.action === 'join' ? 'join' : preset.mode === 'center' ? 'center' : 'peer',
          }
        })
        setGuideOpen(false)
        rememberGuide(true)
      }
      const skipGuide = () => { setGuideOpen(false); rememberGuide(true) }
      const reopenGuide = () => { setGuideOpen(true); rememberGuide(false) }
      const resetSync = () => {
        setConnection(defaultConnection())
        setGuideOpen(true)
        rememberGuide(false)
      }
      return h('div', { className: 'ps-wrap' }, h('style', {}, css),
        h('header', { className: 'ps-hero' },
          h('div', { className: 'ps-intro' }, h('h2', {}, t('heroTitle')), h('p', {}, t('heroHint'))),
          h(Status, { ctl, t })),
        !paired && guideOpen && h(Guide, { t, onApply: applyPreset, onSkip: skipGuide }),
        h('div', { className: 'ps-grid' },
          h('div', { className: 'ps-col' },
            h('div', { className: 'ps-col-label' }, t('groupSetup')),
            h(Advice, { ctl, t, draftCtl }),
            h(Scope, { ctl, t, draftCtl }),
            paired && h(Sync, { ctl, t })),
          h('div', { className: 'ps-col' },
            h('div', { className: 'ps-col-label' }, t('groupConnect')),
            h(Connections, { key: paired ? 'paired' : 'unpaired', ctl, t, connection, setConnection, onReopen: reopenGuide, onReset: resetSync }),
            h(More, { ctl, t }))),
        h(Advanced, { ctl, t, draftCtl }))
    }


    // === merged from standalone lingshu-mute plugin (2026-11-21) ===
    // Own function scope so its `module`/`h`/helpers cannot collide with sync's
    // bindings. Returns the mute module.exports (inject + apply), wired below.
    function lingshuMuteClientFactory(require) {
        var module = { exports: {} };
        var React = require('react');
        var h = React.createElement;

        var PREFIX = '/plugins/lingshu-mute';
        var SLOT_TOGGLE = 'conversation.input.left';   // 输入行左组末尾 = 权限控件右侧（见 DESIGN-button.md §1.2）
        var TOGGLE_ORDER = 10;
        var TOGGLE_ID = 'lingshu-mute-toggle';
        var SLOT_SETTINGS = 'settings.section';
        var SLOT_SETTINGS_ICON = 'settings.section.icon';
        var ENTRY_ID = 'lingshu-mute';
        var SETTINGS_LABEL = '记忆';
        /** 状态点配色：绿=记录中、红=已静音、橙=不读记忆、灰=未知。 */
        var DOT_COLOR = { ok: '#4cc38a', muted: '#ff6b6b', noread: '#ffa940', unknown: '#9aa0a6' };

        /** 设置页配色：**必须走宿主主题变量**（`--dsw-alias-*`）。
         *  旧版写的是 `--dsh-text-primary` 这类不存在的变量，回落值又是深色主题的
         *  #e6e6e6 —— 浅色主题下整页文字接近背景色，看起来像「控件全灰了/坏了」。 */
        var C = {
            text: 'var(--dsw-alias-label-primary, #e6e6e6)',
            muted: 'var(--dsw-alias-label-secondary, #9aa0a6)',
            border: 'var(--dsw-alias-border-l3, rgba(127,127,127,0.28))',
            bg: 'var(--dsw-alias-bg-layer-1, #1f2023)',
            hover: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.10))',
            danger: 'var(--dsw-alias-state-error-primary, #ff6b6b)',
            ok: 'var(--dsw-alias-state-success-primary, #4cc38a)',
            warn: 'var(--dsw-alias-state-warning-primary, #ffa940)',
        };

        /** 部署 origin 兜底：桌面 App 的页面在 `dsh-app://` 下时，某些运行环境不给自定义 scheme
         *  发 fetch（表现为 `TypeError: Failed to fetch`）；若 `location.origin` 是 http(s) 就再试一次。 */
        function httpOriginUrl(path) {
            try {
                var origin = typeof location !== 'undefined' ? String(location.origin || '') : '';
                if (/^https?:\/\//.test(origin)) return origin + path;
            }
            catch (_) { /* 无 location：忽略 */ }
            return '';
        }

        /** 把 `/plugins/...` 解析到当前文档的 base 上（部署前缀 / dsh-app:// 都吃 document.baseURI）。 */
        function urlOf(path) {
            try {
                if (typeof document !== 'undefined' && document && document.baseURI) {
                    return new URL(path, document.baseURI).href;
                }
            }
            catch (_) { /* 无 document / 非法 base：退回相对路径 */ }
            return path;
        }

        /** 统一 JSON 请求（错误带上 status，便于 403 后刷新凭证重试一次）。 */

        /** 请求层（两个入口共用；CSRF 惰性获取 + 403 自动重取一次）。 */

        /** 大脑图标：两条半球 + 中线；静音时加斜杠并降低不透明度。 */
        function BrainIcon(props) {
            var size = props.size || 16;
            var muted = !!props.muted;
            return h('svg', {
                width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
                stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
                'aria-hidden': true, style: { opacity: muted ? 0.5 : 1, display: 'block' },
            },
                h('path', { d: 'M11 4.6a3.1 3.1 0 0 0-3.1 3.1 2.8 2.8 0 0 0-.6 5.3A2.9 2.9 0 0 0 11 16.8V4.6z' }),
                h('path', { d: 'M13 4.6a3.1 3.1 0 0 1 3.1 3.1 2.8 2.8 0 0 1 .6 5.3A2.9 2.9 0 0 1 13 16.8V4.6z' }),
                h('path', { d: 'M12 4.6v14.2' }),
                h('path', { d: 'M9.2 19.4h5.6' }),
                muted ? h('path', { d: 'M4.2 20.2 19.8 4.6', stroke: C.danger, strokeWidth: 1.9 }) : null
            );
        }

        /** 开关（无依赖的小组件）。 */

        /** 面板里的一行开关。 */

        /** 小号文字按钮（解除 / 全部解除）。 */

        /** 清单里的一行：主文案 + 副文案 + 右侧操作。 */

        /** 生效来源（**不含**「当前来源：」前缀，由调用点统一拼）。 */

        /** 两个入口共用的小面板。mode: 'session'（会话开关）| 'manage'（静音清单）。 */

        /** 状态点（行内用；不再有输入框圆点这套东西）。 */
        function StatusDot(props) {
            var state = (props.state === 'muted' || props.state === 'noread' || props.state === 'unknown')
                ? props.state : 'ok';
            var size = props.size || 8;
            return h('span', {
                'data-lingshu-mute-state': state,
                'aria-hidden': true,
                style: {
                    display: 'inline-block', width: size, height: size, borderRadius: 999,
                    background: DOT_COLOR[state] || DOT_COLOR.unknown, position: 'relative', flex: '0 0 auto',
                },
            }, state === 'muted' ? h('span', {
                style: {
                    position: 'absolute', left: -1, top: '45%', width: size + 2, height: 1.5,
                    background: '#fff', transform: 'rotate(-45deg)', display: 'block', opacity: 0.9,
                },
            }) : null);
        }

        function basename(path) {
            var text = String(path || '').replace(/[\\/]+$/, '');
            var parts = text.split(/[\\/]/);
            return parts[parts.length - 1] || text;
        }

        function shortId(id) {
            return String(id || '').replace(/^session-/, '').slice(0, 8);
        }

        /** 失败 → 可读文案（带通道名与错误名/HTTP 状态）。 */
        function describeError(err, where) {
            if (!err) return '失败：' + where;
            var name = err.name || 'Error';
            var message = err.message || String(err);
            var extra = err.status ? ('HTTP ' + err.status + '：' + message) : (name + '：' + message);
            return '失败：' + where + '（' + extra + '）';
        }

        /** HTTP 取 JSON（**仅兜底**）：网络失败重试一次，再失败换 http(s) origin 再试一次。 */
        function fetchJson(url, init, attempt) {
            var tries = attempt || 0;
            return fetch(url, init).then(function (res) {
                return res.json().then(function (data) { return data; }, function () { return null; }).then(function (data) {
                    if (!res.ok || !data || data.ok === false) {
                        var err = new Error((data && data.error) || ('HTTP ' + res.status));
                        err.status = res.status;
                        throw err;
                    }
                    return data;
                });
            }, function (err) {
                if (tries === 0) {
                    return new Promise(function (resolve) { setTimeout(resolve, 200); })
                        .then(function () { return fetchJson(url, init, 1); });
                }
                if (tries === 1 && String(url).indexOf('://') < 0) {
                    var alt = '';
                    try {
                        var origin = typeof location !== 'undefined' ? String(location.origin || '') : '';
                        if (/^https?:\/\//.test(origin)) alt = origin + url;
                    }
                    catch (_) { alt = ''; }
                    if (alt) return new Promise(function (resolve) { setTimeout(resolve, 200); })
                        .then(function () { return fetchJson(alt, init, 2); });
                }
                err.url = String(url);
                throw err;
            });
        }

        /** HTTP 兜底通道（老宿主 / 纯浏览器）。 */
        function createHttpApi() {
            var csrf = '';
            function ensureCsrf() {
                if (csrf) return Promise.resolve();
                return fetchJson(urlOf(PREFIX + '/meta')).then(function (meta) { csrf = String((meta && meta.csrf) || ''); });
            }
            function post(body) {
                var doPost = function () {
                    return fetchJson(urlOf(PREFIX + '/toggle'), {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'x-lingshu-csrf': csrf },
                        body: JSON.stringify(body),
                    });
                };
                return ensureCsrf().then(doPost).catch(function (err) {
                    if (!err || err.status !== 403) throw err;
                    csrf = '';
                    return ensureCsrf().then(doPost);
                });
            }
            return {
                name: 'http',
                list: function () { return fetchJson(urlOf(PREFIX + '/list')); },
                meta: function () { return fetchJson(urlOf(PREFIX + '/meta')); },
                // 省略 sessionId = 服务端认定的最近活跃会话（设置页没有会话上下文时用）
                state: function (sessionId) {
                    var url = PREFIX + '/state' + (sessionId ? ('?session=' + encodeURIComponent(sessionId)) : '');
                    return fetchJson(urlOf(url));
                },
                toggle: post,
            };
        }

        /** 把宿主回执拆成 `{face, error, value}`（**七种形状都要认**，见 DESIGN/测试）。
         *
         *  ① {ok:true,value:{result:{kind:'success',text}}}  ② {ok:true,value:{result:{kind:'error',text}}}
         *  ③ {ok:false,error}   ④ {ok:false,value:{error}}   ⑤ {text}（裸体）
         *  ⑥ undefined（未知命令）  ⑦ text 不是 JSON
         */
        function commandEnvelope(result) {
            if (typeof result === 'string') return { face: { text: result }, error: null, value: null };
            if (!result || typeof result !== 'object') return { face: null, error: null, value: null };
            var value = result.value !== undefined ? result.value : null;
            var face = null;
            if (value && typeof value === 'object' && value.result !== undefined) face = value.result;
            else if (result.result !== undefined) face = result.result;
            else if (typeof result.text === 'string') face = { text: result.text };
            // `ok:false` 时错误可能在 result.error 或 result.value.error（后者老实现会丢 code）
            var error = result.error && typeof result.error === 'object' ? result.error : null;
            if (!error && value && typeof value === 'object' && value.error && typeof value.error === 'object') error = value.error;
            if (!error && face && face.error && typeof face.error === 'object') error = face.error;
            return { face: face, error: error, value: value };
        }

        /** 命令回执的纯文本（成功路径用；`kind:'error'` 不走这里，改抛错）。 */
        function commandText(result) {
            var envelope = commandEnvelope(result);
            if (envelope.error && typeof envelope.error.message === 'string' && !envelope.face) return '';
            if (envelope.face && typeof envelope.face.text === 'string') return envelope.face.text;
            if (envelope.value && typeof envelope.value.text === 'string') return envelope.value.text;
            return '';
        }

        /** 候选宿主会话：优先给定的会话，其次按 updatedAt 倒序取最近的若干个。
         *
         *  为什么要「多个候选」：命令总要落进某一条会话的日志，而会话被**另一个 DSH 实例**
         *  持有时网关直接拒（`session/writer-held`）。设置页没有会话上下文，旧实现取
         *  `Object.keys(byId)[0]`——那是一条随便的会话，本机 278 条会话里经常正好被别的
         *  实例占着 ⇒ 命令通道恒失败 ⇒ 设置页永远回落 HTTP，看起来就是「记忆开关失效」。
         */
        function commandHostCandidates(ctx, preferred, max) {
            var out = [];
            function push(id) {
                if (typeof id === 'string' && id && out.indexOf(id) === -1) out.push(id);
            }
            push(preferred);
            try {
                var snap = ctx && ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.getSnapshot === 'function'
                    ? ctx.sessions.list.getSnapshot() : null;
                var byId = (snap && snap.byId) || {};
                var ids = Object.keys(byId);
                ids.sort(function (a, b) {
                    var ta = (byId[a] && byId[a].updatedAt) || 0;
                    var tb = (byId[b] && byId[b].updatedAt) || 0;
                    return tb - ta;
                });
                for (var i = 0; i < ids.length && out.length < (max || 6); i += 1) push(ids[i]);
            }
            catch (_) { /* ignore */ }
            return out;
        }

        /** 可重试的拒绝码（会话写权不在本实例 / 会话已不在）：换一条会话再试。 */
        function retryableSessionCode(code) {
            return code === 'session/writer-held' || code === 'session/locked'
                || code === 'session/not-found' || code === 'session/unknown';
        }

        /** 命令通道（**主通道**）：`ctx.remote.commands.execute(sid, '/mute … --json', [])`。
         *  `sid` 可以是**任意可执行命令的会话**（服务端会自己认定「当前对话」，不依赖它）。 */
        function createCommandChannel(ctx) {
            return {
                name: 'command',
                available: function () {
                    return !!(ctx && ctx.remote && ctx.remote.commands && typeof ctx.remote.commands.execute === 'function');
                },
                run: function (targetSessionId, line) {
                    var commands = ctx && ctx.remote ? ctx.remote.commands : null;
                    if (!commands || typeof commands.execute !== 'function') {
                        return Promise.reject(new Error('宿主命令通道不可用（ctx.remote.commands.execute 缺失）'));
                    }
                    var candidates = commandHostCandidates(ctx, targetSessionId, 6);
                    if (candidates.length === 0) return Promise.reject(new Error('没有可用于执行命令的会话'));
                    function attempt(index) {
                        return Promise.resolve(commands.execute(candidates[index], line, [])).then(function (result) {
                            var envelope = commandEnvelope(result);
                            // ③④ 网关拒绝：错误体可能在 result.error 或 result.value.error（都要读，别丢 code）
                            if (result && result.ok === false) {
                                var detail = envelope.error;
                                var code = (detail && detail.code) || 'command/rejected';
                                // 会话写权在别的实例手里：换候选会话重试，别把整条通道判死
                                if (retryableSessionCode(code) && index + 1 < candidates.length) return attempt(index + 1);
                                var refusal = new Error(
                                    (detail && detail.code ? detail.code + '：' : '')
                                    + ((detail && detail.message) || (typeof detail === 'string' ? detail : '命令执行被拒绝'))
                                );
                                refusal.code = code;
                                throw refusal;
                            }
                            // ② 命令自身 error：**直接抛，不做 JSON.parse**
                            if (envelope.face && envelope.face.kind === 'error') {
                                var failed = new Error(String(envelope.face.text || '命令执行失败'));
                                failed.code = 'mute/error';
                                throw failed;
                            }
                            var text = commandText(result);
                            if (!text) throw new Error('命令没有返回内容（宿主 /mute 版本不匹配？）');
                            var data;
                            try { data = JSON.parse(text); }
                            catch (_) { throw new Error('命令返回不是 JSON（宿主里的 /mute 还是旧版本？）'); }
                            if (data && data.ok === false) {
                                var failure = new Error(String(data.error || '命令失败'));
                                failure.code = 'mute/error';
                                throw failure;
                            }
                            return data;
                        }, function (err) {
                            var code = err && (err.code || (err.cause && err.cause.code) || (err.details && err.details.code));
                            if (retryableSessionCode(code) && index + 1 < candidates.length) return attempt(index + 1);
                            throw err;
                        });
                    }
                    return attempt(0);
                },
            };
        }

        /** 任意可执行命令的会话（只用来绑命令；**当前对话由服务端认定**）。 */
        function commandHostSession(ctx) {
            var list = commandHostCandidates(ctx, '', 1);
            return list.length > 0 ? list[0] : '';
        }

        // ── 宿主前端服务读取（只用来拿**名字**，不再用来猜当前会话） ────────────

        function readWorkspaceRows(ctx, fallbackRows) {
            var rows = [];
            try {
                var snap = ctx.workspaces && ctx.workspaces.list && typeof ctx.workspaces.list.getSnapshot === 'function'
                    ? ctx.workspaces.list.getSnapshot() : null;
                var items = snap && Array.isArray(snap.items) ? snap.items : [];
                for (var i = 0; i < items.length; i += 1) {
                    var it = items[i] || {};
                    var path = typeof it.path === 'string' ? it.path : '';
                    var title = typeof it.title === 'string' && it.title.trim() ? it.title.trim() : basename(path);
                    if (!path && !it.workspaceId) continue;
                    rows.push({
                        id: typeof it.workspaceId === 'string' ? it.workspaceId : (it.id || path),
                        title: title || path,
                        path: path,
                        sessionIds: Array.isArray(it.sessionIds) ? it.sessionIds : [],
                    });
                }
            }
            catch (_) { rows = []; }
            if (rows.length === 0 && Array.isArray(fallbackRows)) {
                for (var j = 0; j < fallbackRows.length; j += 1) {
                    var row = fallbackRows[j] || {};
                    if (!row.path) continue;
                    rows.push({ id: row.id || row.path, title: row.title || basename(row.path), path: row.path, sessionIds: [] });
                }
            }
            return rows;
        }

        function readSessionRows(ctx, limit) {
            var max = limit || 20;
            var rows = [];
            try {
                var snap = ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.getSnapshot === 'function'
                    ? ctx.sessions.list.getSnapshot() : null;
                var ids = snap && Array.isArray(snap.ids) ? snap.ids.slice() : (snap && snap.byId ? Object.keys(snap.byId) : []);
                for (var i = 0; i < ids.length; i += 1) {
                    var id = ids[i];
                    var summary = snap.byId ? snap.byId[id] : null;
                    if (!summary) continue;
                    if (summary.origin === 'subagent') continue;
                    rows.push({
                        id: id,
                        title: typeof summary.displayTitle === 'string' && summary.displayTitle ? summary.displayTitle : shortId(id),
                        cwd: typeof summary.cwd === 'string' ? summary.cwd : '',
                        updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
                        running: summary.running === true,
                    });
                }
            }
            catch (_) { rows = []; }
            rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
            return rows.slice(0, max);
        }

        function workspaceTitleOfPath(cwd, workspaces) {
            var best = null;
            for (var i = 0; i < workspaces.length; i += 1) {
                var ws = workspaces[i];
                if (!ws.path) continue;
                if (cwd === ws.path || cwd.indexOf(ws.path.replace(/[\\/]+$/, '') + '/') === 0) {
                    if (!best || ws.path.length > best.path.length) best = ws;
                }
            }
            return best ? best.title : '';
        }

        /** 数据层：命令通道优先（**服务端认定当前对话**）→ HTTP 兜底；带 pending / 结果文字。 */
        function useMuteData(options) {
            var opts = options || {};
            var ctx = opts.ctx || {};
            // ⚠ 通道对象必须按实例缓存（与 useMemoryToggle 同一个教训）：每次 render 新建
            //   会让 refresh 的依赖每次变化 → useEffect 反复重装 → /list+/meta 轮询风暴
            //   （实机现象：设置页每秒上百次请求、按钮状态被反复重置）。
            var channelsRef = React.useRef(null);
            if (channelsRef.current === null) {
                channelsRef.current = { command: createCommandChannel(ctx), http: createHttpApi() };
            }
            var command = channelsRef.current.command;
            var http = channelsRef.current.http;
            // ctx 也用 ref 持有：只用于「执行命令用哪个会话」这类即时读取，
            // 不参与 useCallback 依赖，否则又会把 refresh 的身份绑到每次 render 上。
            var ctxRef = React.useRef(ctx);
            ctxRef.current = ctx;

            var payloadState = React.useState(null);
            var busyState = React.useState('');
            var noticeState = React.useState({});
            var channelState = React.useState('');
            var errorState = React.useState('');
            var payload = payloadState[0], setPayload = payloadState[1];
            var busy = busyState[0], setBusy = busyState[1];
            var notice = noticeState[0], setNotice = noticeState[1];
            var channel = channelState[0], setChannel = channelState[1];
            var error = errorState[0], setError = errorState[1];

            function markNotice(key, text) {
                setNotice(function (prev) {
                    var next = {};
                    Object.keys(prev || {}).forEach(function (k) { next[k] = prev[k]; });
                    if (text) next[key] = text;
                    else delete next[key];
                    return next;
                });
            }

            /** 只读拉取：命令通道 `/mute list --json` → 失败回落 HTTP `/list` + `/meta` + `/state`。 */
            var refresh = React.useCallback(function () {
                setError('');
                return Promise.resolve()
                    .then(function () {
                        if (!command.available()) throw new Error('命令通道不可用');
                        var host = commandHostSession(ctxRef.current);
                        return command.run(host, '/mute list --json').then(function (data) {
                            setChannel('command');
                            setPayload(data);
                            return data;
                        });
                    })
                    .catch(function (cmdErr) {
                        var firstFailure = describeError(cmdErr, '命令 /mute list --json');
                        return http.list().then(function (list) {
                            return http.meta().then(function (meta) {
                                // /state 省略 session = 服务端认定的最近活跃会话。
                                // 旧版这里直接写 `active: null`，于是「当前对话」永远显示
                                // 「还没有活跃对话」——设置页根本设不了当前对话。
                                return http.state().then(function (st) { return st; }, function () { return null; })
                                    .then(function (st) {
                                        var mutedWorkspaces = {};
                                        (list.workspaces || []).forEach(function (w) {
                                            if (w && w.path) mutedWorkspaces[w.path] = w.mode || 'mute';
                                        });
                                        var active = null;
                                        if (st && st.sessionId) {
                                            active = {
                                                id: st.sessionId,
                                                muted: !!st.muted,
                                                mode: (st.session && st.session.mode) || (st.muted ? st.mode : null) || null,
                                                cwd: st.workspacePath || '',
                                            };
                                        }
                                        setChannel('http');
                                        setPayload({
                                            ok: true,
                                            version: meta && meta.v ? meta.v : '',
                                            active: active,
                                            // 已静音的工作区按 /list 的 workspaces 标注（含 mode）；
                                            // 旧版一律 muted:false，点完「静音」刷新后又显示「记录中」。
                                            workspaces: (list.registry || []).map(function (row) {
                                                var mode = (row && row.path) ? mutedWorkspaces[row.path] : undefined;
                                                return { title: row.title, path: row.path, muted: !!mode, mode: mode || null, mutedCount: 0 };
                                            }),
                                            sessions: list.sessions || [],
                                            staticWorkspaces: list.staticWorkspaces || [],
                                            channelNote: firstFailure,
                                        });
                                        return list;
                                    });
                            });
                        });
                    })
                    .catch(function (httpErr) {
                        setError(describeError(httpErr, 'HTTP /list 与 /meta'));
                        return null;
                    });
            }, [command, http]);

            React.useEffect(function () {
                refresh();
                return function () { /* 卸载无需清理 */ };
            }, [refresh]);

            /** 切换：命令通道优先（`/mute on|off session|workspace … --json`），失败回落 HTTP。 */
            function toggle(key, target) {
                if (busy) return Promise.resolve(false);
                if (!target) return Promise.resolve(false);
                var isWorkspace = target.scope === 'workspace';
                if (isWorkspace && !target.cwd) { setError('缺少工作区路径'); return Promise.resolve(false); }
                var line = isWorkspace
                    ? ('/mute ' + target.action + ' workspace ' + target.cwd + ' --json')
                    : ('/mute ' + target.action + ' session --json');
                setBusy(key);
                setError('');
                markNotice(key, '');
                var failures = [];
                return Promise.resolve()
                    .then(function () {
                        if (!command.available()) throw new Error('命令通道不可用');
                        // 会话切换：优先在**目标会话**上执行命令（服务端会改用该会话）；否则用任意会话 + 服务端认定的当前对话
                        var host = (!isWorkspace && target.sessionId) ? target.sessionId : commandHostSession(ctx);
                        return command.run(host, line).then(function (data) {
                            setChannel('command');
                            setPayload(data);
                            return { channel: 'command' };
                        });
                    })
                    .catch(function (cmdErr) {
                        failures.push(describeError(cmdErr, '命令 ' + line.replace(' --json', '')));
                        var body = isWorkspace
                            ? { scope: 'workspace', action: target.action, cwd: target.cwd }
                            : { scope: 'session', action: target.action, sessionId: target.sessionId || undefined };
                        return http.toggle(body).then(function () { return { channel: 'http' }; });
                    })
                    .catch(function (httpErr) {
                        failures.push(describeError(httpErr, 'HTTP /toggle'));
                        setError('');
                        markNotice(key, failures.join('；'));
                        return { channel: '', failed: true };
                    })
                    .then(function (result) {
                        setBusy('');
                        if (result && result.failed) return false;
                        var actionWord = target.action === 'noread' ? '不读记忆' : (target.action === 'on' ? '静音' : '恢复');
                        markNotice(key, '已' + actionWord + '（通道 ' + (result.channel || channel || 'command') + '）');
                        return refresh().then(function () { return true; });
                    });
            }

            function releaseAll() {
                if (busy) return Promise.resolve();
                var mutedSessions = (payload && payload.sessions) || [];
                var mutedWorkspaces = ((payload && payload.workspaces) || []).filter(function (w) { return w.muted; });
                if (mutedSessions.length === 0 && mutedWorkspaces.length === 0) return Promise.resolve();
                setBusy('all');
                var chain = Promise.resolve();
                mutedSessions.forEach(function (row) {
                    chain = chain.then(function () { return toggle('all', { scope: 'session', action: 'off', sessionId: row.id }); });
                });
                mutedWorkspaces.forEach(function (row) {
                    chain = chain.then(function () { return toggle('all', { scope: 'workspace', action: 'off', cwd: row.mutedKey || row.path }); });
                });
                return chain.then(function () { setBusy(''); markNotice('all', '已全部恢复'); return refresh(); });
            }

            var active = payload && payload.active ? payload.active : null;
            return {
                payload: payload,
                active: active,
                error: error,
                busy: busy,
                notice: notice,
                channel: channel,
                version: payload && payload.version ? payload.version : '',
                refresh: refresh,
                toggle: toggle,
                releaseAll: releaseAll,
            };
        }

        // ── 版式零件（工作区 / 对话 / 当前对话**同一种行**） ──────────────────────

        function SectionTitle(props) {
            return h('div', {
                style: { fontSize: 11.5, color: C.muted, letterSpacing: 0.2, margin: props.first ? '0 0 6px' : '18px 0 6px' },
            }, props.children);
        }
        function Hint(props) {
            return h('div', { style: { fontSize: 11, color: C.muted, lineHeight: 1.6 } }, props.children);
        }
        var cardStyle = {
            border: '1px solid ' + C.border, borderRadius: 8, padding: '6px 12px',
            background: 'rgba(255,255,255,0.02)',
        };
        function TextButton(props) {
            return h('button', {
                type: 'button', disabled: !!props.disabled,
                onClick: props.disabled ? undefined : props.onClick,
                title: props.title || '',
                style: {
                    flex: '0 0 auto', fontSize: 11.5, padding: '3px 10px', borderRadius: 6,
                    cursor: props.disabled ? 'not-allowed' : 'pointer',
                    border: '1px solid ' + (props.danger ? 'rgba(255,107,107,0.5)' : C.border),
                    background: 'transparent', color: props.danger ? C.danger : C.text,
                    opacity: props.disabled ? 0.45 : 1,
                },
            }, props.children);
        }

        /** 统一一行：状态点 + 名称 + 小字 + 状态文字 + 右侧循环按钮（记录中→静音→不读→恢复）+ 行内结果文字。 */
        function MemoryRow(props) {
            var muted = !!props.muted;
            var mode = muted ? (props.mode || 'mute') : null;
            var noread = mode === 'no_read';
            var pending = !!props.pending;
            var notice = props.notice || '';
            var stateLabel = pending ? '处理中…' : (noread ? '不读记忆' : (muted ? '已静音' : '记录中'));
            var buttonLabel = pending ? '…' : (noread ? '恢复' : (muted ? '不读' : '静音'));
            var buttonTitle = noread ? '恢复记录' : (muted ? '设为不读记忆' : '静音');
            var stateColor = muted ? (noread ? C.warn : C.danger) : C.muted;
            return h('div', { 'data-lingshu-mute-row': props.kind || 'row', style: { borderTop: '1px solid rgba(255,255,255,0.05)' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0' } },
                    h(StatusDot, { state: noread ? 'noread' : (muted ? 'muted' : (props.state || 'ok')), size: 8 }),
                    h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
                        h('div', {
                            title: props.title || '',
                            style: { fontSize: 12.5, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                        }, props.title),
                        h('div', {
                            title: props.subtitle || '',
                            style: { fontSize: 10.5, color: C.muted, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'ltr' },
                        }, props.subtitle || '')
                    ),
                    h('span', { style: { fontSize: 10.5, color: stateColor, whiteSpace: 'nowrap' } }, stateLabel),
                    h(TextButton, {
                        danger: muted && !noread,
                        disabled: pending || !!props.disabled,
                        title: buttonTitle,
                        onClick: props.onToggle,
                    }, buttonLabel)
                ),
                notice ? h('div', { style: { fontSize: 10.5, color: /失败/.test(notice) ? C.danger : C.muted, padding: '0 0 6px 16px' } }, notice) : null
            );
        }

        /** 当前行的下一态动作：记录中→静音(on)、静音(mute)→不读(noread)、不读→恢复(off)。 */
        function nextMuteAction(muted, mode) {
            if (!muted) return 'on';
            return mode === 'no_read' ? 'off' : 'noread';
        }

        /** 设置页正文（**唯一界面**）：当前对话 → 工作区 → 对话(最近 20) → 已静音清单 → 静态排除。 */
        function SettingsSection(props) {
            var ctx = (props && props.ctx) || {};
            var data = useMuteData({ ctx: ctx });
            var payload = data.payload || { workspaces: [], sessions: [], active: null };
            var workspaceRows = readWorkspaceRows(ctx, payload.workspaces || []);
            var sessionRows = readSessionRows(ctx, 20);
            var mutedModes = {};
            (payload.sessions || []).forEach(function (row) { if (row && row.id) mutedModes[row.id] = row.mode || 'mute'; });
            var serverWorkspaces = payload.workspaces || [];
            var statics = payload.staticWorkspaces || [];
            var mutedWorkspaceRows = serverWorkspaces.filter(function (w) { return w.muted; });
            var active = data.active;

            function serverWorkspaceOf(path) {
                for (var i = 0; i < serverWorkspaces.length; i += 1) {
                    if (serverWorkspaces[i].path === path) return serverWorkspaces[i];
                }
                return null;
            }

            /** 当前对话一行：用服务端 payload.active（标题取客户端 sessions 里的 displayTitle）。 */
            function activeRow() {
                if (!active || !active.id) {
                    return h('div', cardStyle, h(Hint, null, '还没有活跃对话，先发一条消息。'));
                }
                var title = active.title;
                for (var i = 0; i < sessionRows.length; i += 1) {
                    if (sessionRows[i].id === active.id) { title = sessionRows[i].title; break; }
                }
                var wsTitle = active.workspaceTitle || workspaceTitleOfPath(active.cwd || '', workspaceRows);
                var sub = [wsTitle, active.cwd].filter(Boolean).join(' · ');
                var mode = active.mode || null;
                return h('div', cardStyle, h(MemoryRow, {
                    kind: 'active',
                    title: (title || shortId(active.id)) + '（' + shortId(active.id) + '）',
                    subtitle: sub || '（未记录工作区）',
                    muted: !!active.muted,
                    mode: mode,
                    pending: data.busy === 'active',
                    notice: data.notice.active,
                    onToggle: function () {
                        data.toggle('active', { scope: 'session', action: nextMuteAction(!!active.muted, mode), sessionId: active.id });
                    },
                }));
            }

            return h('div', { style: { display: 'flex', flexDirection: 'column', padding: '2px 0 24px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 } },
                    h(StatusDot, {
                        state: active ? (active.muted ? (active.mode === 'no_read' ? 'noread' : 'muted') : 'ok') : 'unknown',
                        size: 8,
                    }),
                    h('div', { style: { fontSize: 13.5, color: C.text } }, SETTINGS_LABEL),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h(TextButton, { disabled: !!data.busy, title: '重新读取', onClick: function () { data.refresh(); } }, '刷新')
                ),
                h(Hint, null,
                    '通道 ' + (data.channel || '读取中')
                    + (data.version ? (' · 服务端 ' + data.version) : '')
                    + '。三态循环：记录中 → 静音（不写入/不注入）→ 不读记忆（再禁一切读取）→ 恢复。不改灵枢包本身，也不删除已写入的记忆。'),

                h(SectionTitle, { first: true }, '当前对话'),
                activeRow(),

                h(SectionTitle, null, '工作区'),
                workspaceRows.length === 0
                    ? h('div', cardStyle, h(Hint, null, '没有读到工作区列表（宿主工作区注册表为空或服务未就绪）。'))
                    : h('div', cardStyle, workspaceRows.map(function (ws) {
                        var server = serverWorkspaceOf(ws.path);
                        var muted = !!(server && server.muted);
                        var count = server ? (server.mutedCount || 0) : 0;
                        var key = 'w:' + ws.path;
                        var mode = muted ? (server && server.mode) || 'mute' : null;
                        return h(MemoryRow, {
                            key: key,
                            kind: 'workspace',
                            title: ws.title,
                            subtitle: ws.path + (count > 0 ? ('　·　' + count + ' 个对话已静音') : ''),
                            muted: muted,
                            mode: mode,
                            pending: data.busy === key,
                            notice: data.notice[key],
                            onToggle: function () {
                                data.toggle(key, {
                                    scope: 'workspace',
                                    action: nextMuteAction(muted, mode),
                                    cwd: muted && server && server.mutedKey ? server.mutedKey : ws.path,
                                });
                            },
                        });
                    })),

                h(SectionTitle, null, '对话（最近 20 个）'),
                sessionRows.length === 0
                    ? h('div', cardStyle, h(Hint, null, '没有读到对话列表（宿主会话服务未就绪）。'))
                    : h('div', cardStyle, sessionRows.map(function (row) {
                        var mode = mutedModes[row.id] || null;
                        var muted = !!mode;
                        var wsTitle = workspaceTitleOfPath(row.cwd, workspaceRows);
                        var key = 's:' + row.id;
                        return h(MemoryRow, {
                            key: key,
                            kind: 'session',
                            title: row.title,
                            subtitle: (wsTitle ? wsTitle + ' · ' : '') + (row.cwd || '（无工作区）'),
                            muted: muted,
                            mode: mode,
                            state: row.running ? 'ok' : 'unknown',
                            pending: data.busy === key,
                            notice: data.notice[key],
                            onToggle: function () {
                                data.toggle(key, { scope: 'session', action: nextMuteAction(muted, mode), sessionId: row.id });
                            },
                        });
                    })),

                h('div', { style: { display: 'flex', alignItems: 'center' } },
                    h('div', { style: { flex: '1 1 auto' } }, h(SectionTitle, null, '已静音 / 不读的会话 / 工作区')),
                    h(TextButton, {
                        danger: true,
                        disabled: !!data.busy || ((payload.sessions || []).length === 0 && mutedWorkspaceRows.length === 0),
                        title: '全部恢复',
                        onClick: data.releaseAll,
                    }, '全部恢复')
                ),
                data.notice.all ? h('div', { style: { fontSize: 10.5, color: C.muted, margin: '0 0 4px' } }, data.notice.all) : null,
                ((payload.sessions || []).length === 0 && mutedWorkspaceRows.length === 0)
                    ? h('div', cardStyle, h(Hint, null, '当前没有任何静音。'))
                    : h('div', cardStyle,
                        (payload.sessions || []).map(function (row) {
                            var title = row.title;
                            for (var i = 0; i < sessionRows.length; i += 1) {
                                if (sessionRows[i].id === row.id) { title = sessionRows[i].title; break; }
                            }
                            var key = 'ms:' + row.id;
                            var mode = row.mode || 'mute';
                            return h(MemoryRow, {
                                key: key,
                                kind: 'muted-session',
                                title: title || shortId(row.id),
                                subtitle: row.cwd || '（未记录工作区）',
                                muted: true,
                                mode: mode,
                                pending: data.busy === key,
                                notice: data.notice[key],
                                onToggle: function () { data.toggle(key, { scope: 'session', action: nextMuteAction(true, mode), sessionId: row.id }); },
                            });
                        }),
                        mutedWorkspaceRows.map(function (w) {
                            var key = 'mw:' + w.path;
                            var mode = w.mode || 'mute';
                            return h(MemoryRow, {
                                key: key,
                                kind: 'muted-workspace',
                                title: w.title,
                                subtitle: w.path,
                                muted: true,
                                mode: mode,
                                pending: data.busy === key,
                                notice: data.notice[key],
                                onToggle: function () { data.toggle(key, { scope: 'workspace', action: nextMuteAction(true, mode), cwd: w.mutedKey || w.path }); },
                            });
                        })
                    ),

                h('details', { style: { marginTop: 18 } },
                    h('summary', { style: { fontSize: 11.5, color: C.muted, cursor: 'pointer' } },
                        '静态排除（memory.excludeWorkspaces，只读）'),
                    h('div', { style: { ...cardStyle, marginTop: 6 } },
                        statics.length === 0
                            ? h(Hint, null, '未配置静态排除的工作区。')
                            : statics.map(function (p) {
                                return h('div', { key: 'x:' + p, style: { fontSize: 11.5, color: C.muted, direction: 'ltr', wordBreak: 'break-all' } }, p);
                            })
                    )
                ),

                data.error ? h('div', { role: 'alert', style: { marginTop: 10, fontSize: 11.5, color: C.danger, wordBreak: 'break-word' } }, String(data.error)) : null
            );
        }

        /** 设置导航图标（按 section id 匹配）。 */
        function SettingsIcon(props) {
            var size = (props && props.size) || 16;
            return h('span', { style: { display: 'inline-flex', color: props && props.active ? C.text : C.muted } },
                h(BrainIcon, { size: size, muted: false }));
        }


        // ═══════════════════════════════════════════════════════════════════════
        // 「记忆开关」按钮（conversation.input.left，权限控件右侧）
        //  四态：绿=记忆开 / 红+斜杠=记忆关 / 橙=不读记忆 / 灰虚线环=故障；形状与颜色双编码。
        //  点击循环：记忆开 → 记忆关 → 不读记忆 → 记忆开。
        //  规格见 DESIGN-button.md（28px 高、8px 圆角、13px/500、图标 14×14）。
        // ═══════════════════════════════════════════════════════════════════════

        var TOGGLE_TEXTS = {
            ok: { label: '记忆开', tip: '正在记录（点击→静音）' },
            muted: { label: '记忆关', tip: '已静音：不写入、不注入（点击→不读记忆）' },
            noread: { label: '不读记忆', tip: '不写入、不注入、且禁一切记忆读取（点击→恢复）' },
            fault: { label: '记忆故障', tip: '记忆状态读取/切换失败（点击重试）' },
            none: { label: '记忆关', tip: '还没有活跃对话，先发一条消息' },
        };

        /** 宿主 token + 兜底 hex（浅/深色由 token 自动切换）。 */
        var TOGGLE_TOKENS = {
            green: 'var(--dsw-alias-state-success-primary, #22c55e)',
            red: 'var(--dsw-alias-state-error-primary, #ec1313)',
            orange: 'var(--dsw-alias-state-warning-primary, #ffa940)',
            gray: 'var(--dsw-alias-label-dimmed, #e1e5ee)',
            text: 'var(--dsw-alias-label-secondary, #61666b)',
            textDim: 'var(--dsw-alias-label-tertiary, #61666b)',
            hover: 'var(--dsw-alias-interactive-bg-hover, #2631480f)',
            active: 'var(--dsw-alias-interactive-bg-active, #2631481f)',
            ring: 'var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4f7cff))',
            radius: 'var(--dsw-radius-sm, 8px)',
            font: 'var(--dsw-font-family, inherit)',
        };

        /** 样式表只注入一次（:hover / :focus-visible / 窄屏折叠 只能靠 CSS）。 */
        function ensureToggleStyle() {
            try {
                if (typeof document === 'undefined' || !document.head) return;
                if (document.querySelector('style[data-plugin="lingshu-mute-toggle"]')) return;
                var style = document.createElement('style');
                style.dataset.plugin = 'lingshu-mute-toggle';
                style.textContent = [
                    '.lm-toggle{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;height:28px;min-width:28px;',
                    'padding:0 8px;border:none;outline:none;background:transparent;border-radius:var(--dsw-radius-sm,8px);',
                    'color:var(--dsw-alias-label-secondary,#61666b);font-family:var(--dsw-font-family,inherit);',
                    'font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;cursor:pointer}',
                    '.lm-toggle[data-state="ok"] .lm-toggle__dot{background:var(--dsw-alias-state-success-primary,#22c55e)}',
                    '.lm-toggle[data-state="muted"] .lm-toggle__dot{background:var(--dsw-alias-state-error-primary,#ec1313)}',
                    '.lm-toggle[data-state="noread"] .lm-toggle__dot{background:var(--dsw-alias-state-warning-primary,#ffa940)}',
                    '.lm-toggle[data-state="fault"] .lm-toggle__dot{background:transparent;box-shadow:inset 0 0 0 1.5px var(--dsw-alias-label-dimmed,#e1e5ee)}',
                    '.lm-toggle[data-state="fault"]{color:var(--dsw-alias-label-tertiary,#61666b)}',
                    '.lm-toggle__dot{position:relative;width:8px;height:8px;border-radius:999px;flex:none;display:inline-block}',
                    '.lm-toggle__dot[data-slash="1"]::after{content:"";position:absolute;left:-1px;top:50%;width:10px;height:1.5px;',
                    'background:var(--dsw-alias-label-primary-inverted,#fff);transform:rotate(-45deg);border-radius:1px}',
                    '.lm-toggle__label{max-width:96px;overflow:hidden;text-overflow:ellipsis}',
                    /* pending 用**静态**样式：不加圆环、不加动画（用户要求：全部去掉动画/过渡）。 */
                    '.lm-toggle[data-pending="1"]{cursor:progress}',
                    '.lm-toggle[data-pending="1"] .lm-toggle__dot{outline:2px solid currentColor;outline-offset:2px}',
                    '@media (hover:hover){.lm-toggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}}',
                    '.lm-toggle:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active,#2631481f)}',
                    '.lm-toggle:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4f7cff))}',
                    '.lm-toggle:disabled{color:var(--dsw-alias-label-dimmed,#e1e5ee);cursor:default;opacity:.55}',
                    '.lm-toggle[data-narrow="1"]{width:28px;padding:0;justify-content:center;gap:0}',
                    '.lm-toggle[data-narrow="1"] .lm-toggle__label{display:none}',
                    '@media (max-width:560px){.lm-toggle{width:28px;padding:0;justify-content:center;gap:0}',
                    '.lm-toggle .lm-toggle__label{display:none}}',
                ].join('');
                document.head.appendChild(style);
            }
            catch (_) { /* 无 DOM：忽略（单测环境） */ }
        }

        /** 窄屏判定（≤560px 与宿主容器断点一致）。 */
        function isNarrowViewport(width) {
            var w = typeof width === 'number' ? width : (typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1024);
            return w <= 560;
        }

        /** 失败分类：'fault'（算故障，进灰）| 'refusal'（正常拒绝，不算故障）。 */
        function classifyFailure(input) {
            var code = '';
            var message = '';
            if (input && typeof input === 'object') {
                code = String(input.code || (input.error && input.error.code) || '');
                message = String(input.message || (input.error && input.error.message) || '');
            }
            else {
                message = String(input || '');
            }
            var text = (code + ' ' + message).toLowerCase();
            // 命令自身拒绝（服务端明确回绝：无活跃会话 / 工作区未注册 / 其它业务拒绝）→ 正常拒绝
            if (/^mute\/error$/.test(code) || /command\/rejected/.test(code)) return 'refusal';
            if (/^mute\//.test(code)) return 'refusal';
            // 正常拒绝：没有活跃会话 / 工作区未注册 / 显式 mute 拒绝
            if (/no-active-session|no active session|拿不到当前会话标识|not-registered-workspace|不是宿主的真实工作区/.test(text)) return 'refusal';
            // 故障：网关契约/内部错误、未知命令、非 JSON、网络、401/403/404、字段缺失
            if (/gateway\/|arguments-invalid|internal|unavailable|not json|不是 json|没有返回内容|failed to fetch|network|econn|401|403|404|missing|缺失/.test(text)) return 'fault';
            return 'fault';
        }

        /** 连续读失败 ≥2 才进灰（第一次保留原态，避免闪灰）。 */
        function shouldEnterFault(readFailures, writeFailed) {
            if (writeFailed) return true;
            return Number(readFailures || 0) >= 2;
        }

        /** 轮询该不该在这一拍读（页面隐藏 → 跳过，等 visibilitychange 补读）。 */
        function pollTick(input) {
            return input && input.hidden ? 'skip' : 'read';
        }

        /** 一次读的结果如何影响退避计数：成功清零，失败 +1。 */
        function retryAttemptAfter(verdict, attempt) {
            var current = Math.max(0, Number(attempt || 0));
            return verdict === 'ok' ? 0 : current + 1;
        }

        /** 读状态走哪条通道：命令可用（且不在 5 分钟 HTTP 窗口内）→ command，否则 http。 */
        function readPath(input) {
            var info = input || {};
            if (!info.commandAvailable) return 'http';
            if (info.httpOnlyUntil && Number(info.now || 0) < Number(info.httpOnlyUntil)) return 'http';
            if (!info.bindSession) return 'http';
            return 'command';
        }

        /** 退避：2s → 4s → 8s → 16s → 30s（封顶）。 */
        function backoffDelay(attempt) {
            var table = [2000, 4000, 8000, 16000, 30000];
            var index = Math.max(0, Math.min(table.length - 1, Number(attempt || 0)));
            return table[index];
        }

        /** 视觉状态：三态 + 文案 + aria。缺字段/无活跃会话一律灰，**绝不默认绿**。 */
        function computeToggleVisual(input) {
            var info = input || {};
            var active = info.active || null;
            var hasActive = !!(active && typeof active.id === 'string' && active.id);
            var mutedField = hasActive && active ? active.muted : undefined;
            var fault = shouldEnterFault(info.readFailures, info.writeFailed);
            var state;
            var reason = info.reason || '';
            if (fault) state = 'fault';
            else if (!hasActive) state = 'none';
            else if (typeof mutedField !== 'boolean') state = 'fault';
            else if (mutedField) state = (active && active.mode === 'no_read') ? 'noread' : 'muted';
            else state = 'ok';
            if (state === 'none' && info.pending) state = 'none';
            var kind = state === 'fault' ? 'fault' : (state === 'none' ? 'muted' : state);
            var text = TOGGLE_TEXTS[state] || TOGGLE_TEXTS.fault;
            var label = state === 'fault'
                ? ('记忆开关：状态未知' + (reason ? ('（' + reason + '）') : '') + '。点击重试')
                : state === 'none'
                    ? '记忆开关：还没有活跃对话。点击重试'
                    : state === 'muted'
                        ? '记忆开关：当前对话已静音。点击设为不读记忆'
                        : state === 'noread'
                            ? '记忆开关：当前对话不读任何记忆。点击恢复记录'
                            : '记忆开关：当前对话已开启记录。点击静音';
            return {
                state: kind,              // 'ok' | 'muted' | 'noread' | 'fault'（none 复用 muted 的红点）
                semantic: state,          // 'ok' | 'muted' | 'noread' | 'fault' | 'none'
                label: text.label,
                tip: text.tip + (reason && state === 'fault' ? ('：' + reason) : ''),
                ariaLabel: label,
                ariaPressed: state === 'ok' ? 'true' : ((state === 'muted' || state === 'noread') ? 'false' : undefined),
                clickable: true,          // 灰态也可点 = 重试
                slash: state === 'muted' || state === 'none',
                dashed: state === 'fault',
            };
        }

        /** 按钮（纯展示，props 驱动，便于单测）。 */
        function ToggleButton(props) {
            var visual = props.visual || computeToggleVisual({});
            var pending = !!props.pending;
            var narrow = !!props.narrow;
            var disabled = !!props.disabled;
            ensureToggleStyle();
            var dotState = visual.state;
            return h('button', {
                type: 'button',
                className: 'lm-toggle',
                'data-lingshu-mute-toggle': 'left',
                'data-state': dotState,
                'data-narrow': narrow ? '1' : '0',
                'aria-label': visual.ariaLabel,
                'aria-pressed': visual.ariaPressed,
                'aria-busy': pending ? 'true' : 'false',
                'data-pending': pending ? '1' : '0',
                'aria-disabled': disabled ? 'true' : undefined,
                role: visual.ariaPressed === undefined ? 'button' : 'switch',
                tabIndex: disabled ? -1 : 0,
                disabled: disabled,
                title: pending ? '处理中：' + visual.tip : visual.tip,
                onClick: disabled || pending ? undefined : props.onClick,
                onKeyDown: function (event) {
                    if (disabled || pending) return;
                    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                        if (typeof event.preventDefault === 'function') event.preventDefault();
                        props.onClick && props.onClick(event);
                    }
                },
                style: {
                    boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: narrow ? 0 : 6,
                    height: 28, minWidth: 28, width: narrow ? 28 : undefined, padding: narrow ? 0 : '0 8px',
                    border: 'none', outline: 'none', background: 'transparent',
                    borderRadius: TOGGLE_TOKENS.radius,
                    color: dotState === 'fault' ? TOGGLE_TOKENS.textDim : TOGGLE_TOKENS.text,
                    fontFamily: TOGGLE_TOKENS.font, fontSize: 13, fontWeight: 500, lineHeight: '20px',
                    whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer',
                    justifyContent: narrow ? 'center' : undefined,
                    opacity: disabled ? 0.55 : 1,
                    pointerEvents: pending ? 'none' : undefined,
                },
            },
                h('span', { className: 'lm-toggle__dot', 'data-slash': visual.slash ? '1' : '0', 'aria-hidden': true }),
                narrow
                    ? null
                    : h('span', { className: 'lm-toggle__label' }, pending ? '处理中' : visual.label)
            );
        }

        /** 窄屏 hook：`matchMedia('(max-width:560px)')` 订阅 + resize 兜底，驱动重渲染。 */
        function useNarrowViewport() {
            var state = React.useState(isNarrowViewport());
            React.useEffect(function () {
                function apply(value) { state[1](!!value); }
                var mq = null;
                try {
                    mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width:560px)') : null;
                }
                catch (_) { mq = null; }
                function sync() { apply(isNarrowViewport()); }
                if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', sync);
                else if (mq && typeof mq.addListener === 'function') mq.addListener(sync);
                if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', sync);
                sync();
                return function () {
                    if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', sync);
                    else if (mq && typeof mq.removeListener === 'function') mq.removeListener(sync);
                    if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', sync);
                };
            }, []);
            return state[0];
        }

        /** 输入行工具行按钮：状态机 + 展示。 */
        function MemoryToggle(props) {
            var ctx = ctxRef(props);
            var sessionId = typeof props.sessionId === 'string' ? props.sessionId : '';
            var toggle = useMemoryToggle({ ctx: ctx, sessionId: sessionId });
            var narrow = useNarrowViewport();
            return h(ToggleButton, {
                visual: toggle.visual,
                pending: toggle.pending,
                disabled: toggle.disabled,
                narrow: narrow,
                onClick: toggle.onClick,
            });
        }

        /** 从 slot inject 里取 ctx（宿主只传 sessionId，ctx 由注册闭包给）。 */
        var __toggleCtx = null;
        function ctxRef(props) {
            return (props && props.ctx) || __toggleCtx || {};
        }

        /** 命令绑定会话：优先 slot 给的 sessionId；没有就用宿主会话列表里的任一个（只用于执行命令）。 */
        function commandBindSession(ctx, sessionId) {
            if (sessionId) return sessionId;
            try {
                var snap = ctx.sessions && ctx.sessions.list && typeof ctx.sessions.list.getSnapshot === 'function'
                    ? ctx.sessions.list.getSnapshot() : null;
                if (snap && Array.isArray(snap.ids) && snap.ids.length > 0) return snap.ids[0];
                if (snap && snap.byId) {
                    var ids = Object.keys(snap.byId);
                    if (ids.length > 0) return ids[0];
                }
            }
            catch (_) { /* ignore */ }
            return '';
        }

        /** 状态机 hook（**无 React 依赖的纯逻辑部分都抽成上面的纯函数，便于单测**）：
         *  命令优先 → HTTP 兜底；8s 轮询 + hidden 暂停 + focus 补读；点击乐观更新、
         *  以服务端 active.muted 为准、失败回滚；读失败 ≥2 进灰、写失败立即灰；退避 2/4/8/16/30s。 */
        function useMemoryToggle(options) {
            var opts = options || {};
            var ctx = opts.ctx || {};
            var sessionId = typeof opts.sessionId === 'string' ? opts.sessionId : '';
            // ⚠ 通道对象必须按实例缓存：每次 render 新建会让 useCallback/useEffect 的依赖每次变化，
            //   导致 effect 反复重装 → 轮询风暴（实机级 bug，别改回去）。
            var channelsRef = React.useRef(null);
            if (channelsRef.current === null) {
                channelsRef.current = { command: createCommandChannel(ctx), http: createHttpApi() };
            }
            var command = channelsRef.current.command;
            var http = channelsRef.current.http;
            var httpOnlyRef = React.useRef(0);
            var mountedRef = React.useRef(true);

            var activeState = React.useState(null);
            var failuresState = React.useState(0);
            var writeFailedState = React.useState(false);
            var pendingState = React.useState(false);
            var reasonState = React.useState('');
            var optimisticState = React.useState(null);
            var active = activeState[0], setActive = activeState[1];
            var readFailures = failuresState[0], setReadFailures = failuresState[1];
            var writeFailed = writeFailedState[0], setWriteFailed = writeFailedState[1];
            var pending = pendingState[0], setPending = pendingState[1];
            var reason = reasonState[0], setReason = reasonState[1];
            var optimistic = optimisticState[0], setOptimistic = optimisticState[1];

            function commandAllowed() {
                return command.available() && Date.now() >= httpOnlyRef.current;
            }

            /** 读一次状态。返回 'ok' | 'refusal' | 'fault'（决定退避与灰态计数）。 */
            var read = React.useCallback(function () {
                var bind = commandBindSession(ctx, sessionId);
                return Promise.resolve()
                    .then(function () {
                        if (true) {
                            // 2026-11-13：轮询固定走 HTTP。走宿主命令 /mute status --json 会在当前会话里
                            // 留下一条命令记录，每 8 秒一条，把对话刷满 "mute {...}"。写操作（on/off）仍走命令。
                            var skipped = new Error('命令通道已停用（轮询走 HTTP）');
                            skipped.code = 'lingshu/command-skipped';
                            throw skipped;
                        }
                        if (!commands_ready(command)) throw new Error('命令通道不可用');
                        if (!bind) throw new Error('没有可用于执行命令的会话');
                        return command.run(bind, '/mute status --json');
                    })
                    .then(function (data) {
                        if (!data || (data.active !== null && data.active !== undefined && typeof data.active !== 'object')) {
                            throw new Error('缺字段：active');
                        }
                        var nextActive = data.active || null;
                        if (nextActive && typeof nextActive.muted !== 'boolean') throw new Error('缺字段：active.muted');
                        if (!mountedRef.current) return 'ok';
                        setActive(nextActive);
                        setReadFailures(0);
                        setWriteFailed(false);
                        setReason(nextActive ? '' : '还没有活跃对话，先发一条消息');
                        return 'ok';
                    })
                    .catch(function (cmdErr) {
                        if (cmdErr && cmdErr.code === 'lingshu/command-skipped') return readViaHttp();
                        var kind = classifyFailure(cmdErr);
                        if (kind === 'fault') httpOnlyRef.current = Date.now() + 5 * 60 * 1000;
                        return readViaHttp(describeError(cmdErr, '命令 /mute status --json'));
                    });
            }, [command, http, ctx, sessionId]);

            /** HTTP 兜底（/state 省略 session = 服务端活跃会话）。 */
            function readViaHttp(cmdProblem) {
                return Promise.resolve()
                    .then(function () { return httpToggleFallbackRead(http, sessionId); })
                    .then(function (state) {
                        if (!state || typeof state !== 'object') throw new Error('HTTP /state 返回空');
                        var hasSession = typeof state.sessionId === 'string' && state.sessionId;
                        var muted = state.session && state.session.muted;
                        if (hasSession && typeof muted !== 'boolean') throw new Error('缺字段：session.muted');
                        if (!mountedRef.current) return 'ok';
                        var mode = (state.session && state.session.mode) || (state.muted ? state.mode : null) || null;
                        setActive(hasSession ? { id: state.sessionId, muted: !!muted, mode: mode, cwd: state.workspacePath || '' } : null);
                        setReadFailures(0);
                        setWriteFailed(false);
                        setReason(hasSession ? '' : '还没有活跃对话，先发一条消息');
                        return 'ok';
                    })
                    .catch(function (httpErr) {
                        if (!mountedRef.current) return 'fault';
                        setReadFailures(function (n) { return n + 1; });
                        var pieces = [];
                        if (cmdProblem) pieces.push(cmdProblem);
                        pieces.push(describeError(httpErr, 'HTTP /state'));
                        setReason(pieces.join('；').replace(/^失败：/, ''));
                        return 'fault';
                    });
            }

            /** 切换：记录中→静音→不读→恢复，乐观更新 → 命令 → 以服务端返回为准；失败回滚。 */
            function toggle_() {
                if (pending) return Promise.resolve(false);
                var current = active || {};
                var action = nextMuteAction(!!current.muted, current.mode);
                var next = {
                    action: action,
                    muted: action !== 'off',
                    mode: action === 'noread' ? 'no_read' : (action === 'on' ? 'mute' : null),
                };
                var bind = commandBindSession(ctx, sessionId);
                setPending(true);
                setOptimistic(next);
                setWriteFailed(false);
                var line = '/mute ' + action + ' session --json';
                return Promise.resolve()
                    .then(function () {
                        if (!commandAllowed()) {
                            var skipped = new Error('命令通道暂不可用（5 分钟内走 HTTP）');
                            skipped.code = 'lingshu/command-skipped';
                            throw skipped;
                        }
                        if (!commands_ready(command)) throw new Error('命令通道不可用');
                        if (!bind) throw new Error('没有可用于执行命令的会话');
                        return command.run(bind, line);
                    })
                    .then(function (data) {
                        var nextActive = data && data.active ? data.active : null;
                        if (!nextActive || typeof nextActive.muted !== 'boolean') throw new Error('缺字段：active.muted');
                        if (!mountedRef.current) return true;
                        setActive(nextActive);
                        setOptimistic(null);
                        setReadFailures(0);
                        setWriteFailed(false);
                        setReason('');
                        return true;
                    })
                    .catch(function (cmdErr) {
                        if (cmdErr && cmdErr.code === 'lingshu/command-skipped') return toggleViaHttp(next, current, null);
                        var kind = classifyFailure(cmdErr);
                        var problem = describeError(cmdErr, '命令 ' + line.replace(' --json', ''));
                        if (kind === 'fault') httpOnlyRef.current = Date.now() + 5 * 60 * 1000;
                        return toggleViaHttp(next, current, problem);
                    })
                    .then(function (ok) {
                        if (mountedRef.current) setPending(false);
                        return ok;
                    });
            }

            function toggleViaHttp(next, current, cmdProblem) {
                return Promise.resolve()
                    .then(function () {
                        return http.toggle({ scope: 'session', action: next.action, sessionId: sessionId || undefined });
                    })
                    .then(function () {
                        if (!mountedRef.current) return true;
                        setActive({ id: (current && current.id) || sessionId, muted: next.muted, mode: next.mode, cwd: (current && current.cwd) || '' });
                        setOptimistic(null);
                        setWriteFailed(false);
                        setReadFailures(0);
                        setReason('');
                        return true;
                    })
                    .catch(function (httpErr) {
                        if (!mountedRef.current) return false;
                        setOptimistic(null);      // 回滚
                        setWriteFailed(true);     // 写失败立即灰
                        var pieces = [];
                        if (cmdProblem) pieces.push(cmdProblem);
                        pieces.push(describeError(httpErr, 'HTTP /toggle'));
                        setReason(pieces.join('；').replace(/^失败：/, ''));
                        return false;
                    });
            }

            React.useEffect(function () {
                mountedRef.current = true;
                read();
                var stopped = false;
                var timer = null;
                var attempt = 0;
                function schedule() {
                    if (stopped) return;
                    var delay = attempt > 0 ? backoffDelay(attempt) : 8000;
                    timer = setTimeout(function () {
                        var hidden = typeof document !== 'undefined' && document.hidden === true;
                        if (pollTick({ hidden: hidden }) === 'skip') { schedule(); return; }
                        read().then(function (verdict) {
                            attempt = retryAttemptAfter(verdict, attempt);
                            schedule();
                        });
                    }, delay);
                }
                schedule();
                function onVisible() {
                    if (typeof document !== 'undefined' && !document.hidden) { attempt = 0; read(); }
                }
                function onFocus() { attempt = 0; read(); }
                if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', onVisible);
                if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('focus', onFocus);
                return function () {
                    stopped = true;
                    mountedRef.current = false;
                    if (timer) clearTimeout(timer);
                    if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('visibilitychange', onVisible);
                    if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('focus', onFocus);
                };
            }, [read]);

            var visualActive = optimistic === null
                ? active
                : { id: (active && active.id) || sessionId, muted: optimistic.muted, mode: optimistic.mode, cwd: (active && active.cwd) || '' };
            var visual = computeToggleVisual({
                active: visualActive,
                readFailures: readFailures,
                writeFailed: writeFailed,
                pending: pending,
                reason: reason,
            });
            return {
                visual: visual,
                pending: pending,
                disabled: false,          // 灰态也可点 = 重试（设计 §2.2）
                onClick: toggle_,
            };
        }

        /** 命令通道是否具备执行条件（单个函数便于 mock）。 */
        function commands_ready(command) {
            try { return command.available(); } catch (_) { return false; }
        }

        /** HTTP 兜底读状态（/state 省略 session = 服务端活跃会话）。 */
        function httpToggleFallbackRead(http, sessionId) {
            try {
                var url = sessionId
                    ? (PREFIX + '/state?session=' + encodeURIComponent(sessionId))
                    : (PREFIX + '/state');
                return fetchJson(urlOf(url));
            }
            catch (_) {
                return Promise.reject(new Error('HTTP /state 不可用'));
            }
        }

        module.exports = {
            // 只声明真正用到的宿主服务：sessions/workspaces 用来取**名字**，remote 是主通道。
            // ⚠`remote.commands` 必须**单独列出**：DSH 0.2.2-rc.1 起客户端按服务名做注入闸门，
            //   只声明 'remote' 时读取 ctx.remote.commands 会抛
            //   「cannot get property "remote.commands" without inject」→ 命令通道恒失败、
            //   设置页永远回落 HTTP（表现为「通道 http」「当前对话：还没有活跃对话」）。
            inject: ['slots', 'sessions', 'workspaces', 'remote', 'remote.commands'],
            /** 仅供单测（不属于对外 ABI）。 */
            __urlOf: urlOf,
            __describeError: describeError,
            __readWorkspaceRows: readWorkspaceRows,
            __readSessionRows: readSessionRows,
            __createCommandChannel: createCommandChannel,
            __computeToggleVisual: computeToggleVisual,
            __classifyFailure: classifyFailure,
            __shouldEnterFault: shouldEnterFault,
            __backoffDelay: backoffDelay,
            __isNarrowViewport: isNarrowViewport,
            __useNarrowViewport: useNarrowViewport,
            __pollTick: pollTick,
            __retryAttemptAfter: retryAttemptAfter,
            __readPath: readPath,
            __ToggleButton: ToggleButton,
            __TOGGLE_ORDER: TOGGLE_ORDER,
            __SLOT_TOGGLE: SLOT_TOGGLE,

            apply: function (ctx) {
                try {
                    if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return;
                    __toggleCtx = ctx;
                    ctx.slots.inject(SLOT_TOGGLE, function () {
                        return ctx.slots.register({
                            name: SLOT_TOGGLE,
                            id: TOGGLE_ID,
                            order: TOGGLE_ORDER,
                            label: '记忆开关',
                            inject: function (sessionId) {
                                return { sessionId: typeof sessionId === 'string' ? sessionId : '', ctx: ctx };
                            },
                        }, MemoryToggle);
                    });
                    ctx.slots.inject(SLOT_SETTINGS, function () {
                        return ctx.slots.register({
                            name: SLOT_SETTINGS,
                            id: ENTRY_ID,
                            order: 70,
                            label: SETTINGS_LABEL,
                            inject: function () { return { ctx: ctx }; },
                        }, SettingsSection);
                    });
                    ctx.slots.inject(SLOT_SETTINGS_ICON, function () {
                        return ctx.slots.register({
                            name: SLOT_SETTINGS_ICON,
                            id: ENTRY_ID,
                            order: 70,
                            label: SETTINGS_LABEL,
                        }, SettingsIcon);
                    });
                }
                catch (err) {
                    try { console.warn('lingshu-mute: 客户端注册入口失败:', err); } catch (_) { /* ignore */ }
                }
            },
        };

        return module.exports;
    }
    var __muteClient = null;
    try { __muteClient = lingshuMuteClientFactory(require); }
    catch (err) { console.warn('lingshu-mute: merged client factory failed', err); }
    return {
      inject: ['slots', 'locale', 'sessions', 'workspaces', 'remote', 'remote.commands', 'uiWorkspace'],
      apply(ctx) {
        // --- device sync's own UI ---
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'device-sync: dictionaries')
        const t = ctx.locale.bind(NS)
        // uiWorkspace is declared in inject, so the Client guard exposes it as a
        // direct property; ctx.get() would be rejected without the declaration.
        const workspace = ctx.uiWorkspace ?? null
        startAdviceChat = (prompt) => {
          if (!workspace || typeof workspace.startSession !== 'function') return false
          workspace.startSession(undefined, { prompt, whenDraftExists: 'append' })
          return true
        }
        const name = 'plugins.tab'
        ctx.slots.inject(name, () => ctx.slots.register({
          name, id: 'device-sync', order: 20, label: () => t('tab'), locale: NS,
        }, (props) => h(SyncTab, { t: props?.t ?? t })))
        // --- merged lingshu-mute UI (memory toggle + settings page) ---
        try {
          if (__muteClient && typeof __muteClient.apply === 'function') __muteClient.apply(ctx)
        } catch (err) {
          console.warn('lingshu-mute: merged client apply failed', err)
        }
      },
    }
  },
})
