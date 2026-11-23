# 变更记录

## 未发布

- 「建议」卡新增「导入 JSON」：把 agent 返回的 `[{key,action,reason}]` 数组粘贴进来，校验后转成建议（未安装、IM/记忆/灵枢等本机专属插件会被过滤），再由用户逐条或一键采纳；agent 永远不直接改策略。
- 「规则」从多行文本框改成可视化标签：每条规则一个可删除 chip，输入框回车或点「添加」写入，支持插件名补全与 `*` 通配。记忆目录读取中显示「正在读取记忆目录」，不再闪现「没找到灵枢」；导入/导出按钮移到记忆块之前，避免误认为记忆控件。
- 同步协议脱离 Web GUI 的 3080，改用独立监听端口（默认 3081，可配 `syncPort` / `syncHost`）。3080 只保留同源的浏览器 action；3081 只接受 `/hello`、`/state`、`/proposals`，且三条路由都必须带 token，未配对前拒绝任何状态或提案查询。SSH 转发的远端端口同步改为 3081。
- 邀请界面只保留邀请链接：链接本身内含一次性 token，去掉单独展示和输入邀请码的字段；接入方粘贴链接→解析→验证→连接不变。私钥字段仍是绝对路径，新增「选择文件」按钮由 DSH 宿主弹本机文件对话框填入（浏览器拿不到绝对路径），支持 `~` 展开；ssh 找不到时给出 `ssh-client-not-found` 而不是笼统失败。
- 报错细化：后端不再把所有引擎异常压成 `request-failed`，白名单内的错误码（如 `verify-failed`、`ssh-failed`、`ssh-client-not-found`、`already-paired`）原样送到面板，未知码在界面以原码显示，便于定位 Windows 等环境的连接失败。
- 「让 agent 给建议」改为通过 `uiWorkspace.startSession` 开一个新对话，预填本机插件清单并要求忽略 IM/聊天/记忆/灵枢等绑定本机或独立同步域的插件。删除模型复核（`policy.ai`、`askModel`、`fromModel` 与相关设置），旧状态加载时迁移掉 `ai` 字段。
- 「允许同步的改动」和「规则」从高级设置移到「同步范围」；高级设置只剩自动应用和检查间隔。
- 新增回归：HTTP 双监听器的路由隔离与 token 门禁、错误码透传、新对话预填、私钥文件选择按钮、规则位置。全套 118 项、`check`、`check:public` 通过。

- 配置同步加门控：插件只有在本机暴露 ≥2 个非密钥配置字段（`MIN_CONFIG_FIELDS`）时才会出现「同步设置」勾选框；目录用 `eligible` 标记，客户端勾选/导入和引擎 `evaluate` 三处共用同一门槛，单字段配置不再能把设置外发。`USAGE.md` 同步说明。
- 本地插件进入同步范围：`parseSource` 认 `link:`/`file:` bundle，映射为内容寻址的 `file` 源（`name` + `sha256`，不含本机绝对路径），可同步装没装/启停与设置；跨设备安装仍按 `source-not-supported:file` 拒绝，安装适配器仍只接受 registry。
- 中心对设备推送的插件增加「安装/不安装」选择：提案卡新增「接受并本机安装」，走 `acceptAndInstall`（接受 → check → approve → apply），仍受本机 `caps.install`、策略与审批约束；普通「接受并发布」只写权威态、不在中心安装。提案记录 `localInstall` 决定供审计。
- 新增 `test/task-gating-install.test.js`：7 项覆盖门控、本地源、中心安装选择与对抗场景；全套 114 项、`check`、`check:public` 通过。

- SSH 连接表单简化：用户只需填 SSH 主机、用户、私钥路径和 SSH 端口（默认 22），不再要求手填 `known_hosts` 路径；远端 DSH HTTP 端口固定 3080。传输改用 `StrictHostKeyChecking=accept-new`，首次连接自动把主机指纹写入系统默认 `~/.ssh/known_hosts`，之后指纹变化仍拒绝，保留 host key 校验、无关闭校验快捷模式。邀请链接的 `ssh://` URL 带 `port` 参数以便对端还原。
- 建议卡按插件性质分类：普通插件仍建议「纳入同步」，设备专属插件（IM / 记忆 / 聊天类，账号或状态绑定本机）建议「留本机」且其设置不同步；系统/停用/已纳入规则不变。`analyzePlugins` 增加 `isDeviceLocal` 判定，`docs/USAGE.md` 同步说明。

## 0.4.0 — 2026-11-21

加入灵枢（LINGSHU / `@furongjun1999/dsh-memory`）记忆节点同步，作为第三类资源域；写入走灵枢自己的库层，不绕过复核闸。

- 新资源域：`kind:'lingshuNode'`（`key` 为节点 id）、动作与能力 `memoryWrite`、状态槽 `expectedLingshu/lingshuBaselines/lastLingshuPlan/lastLingshuResults/lastLingshuStatus`；`policy.lingshu = {layers, maxSensitivity}`。旧状态加载时补齐槽位，默认 `layers: ['contextual','goals','unresolved']`、`maxSensitivity: 'internal'`、`memoryWrite: false`。
- canonical 投影：节点 `.md` 的 front-matter 按「本机易变 / 派生 / 语义」分类，访问计数、`last_access`、`importance*`、`confidence`、`session`、`writer`、`harness`、证据计数、`merge_*`、`bucket*`、`consistency`、`untrusted*`、`protected/immutable`、`lifecycle_state`、`verification_state`、`sensitivity`、`edges` 都不参与跨端比较；`condition_space.time_window` 单独剔除。语义字段与正文逐字保留，两侧按同一投影比较，读数稳定。
- 读取：层目录的受限扫描（深度 ≤3、单节点 ≤32 KiB、整批 ≤192 KiB、≤256 节点、拒绝软链/非普通文件/硬链/加密节点）。不读索引、日志、锁、`hippocampus/`、`trash/`、`_protected_history/`、`_keys.json`。
- 写入：`lib/lingshu-bridge.py` 以子进程调 `MdCGSecure.add()`，继承本机未提供的字段，覆写时显式保留本机 `edges`，`sensitivity` 只对新节点上送，`consistency=False`；写入后读回做 canonical 比对，不一致即 `lingshu-verify-failed`。桥不可用时如实返回 `memory-bridge-unavailable`，不降级为裸写文件。
- 安全：`evaluate()` 对 `lingshuNode` 要求显式纳入（层模式 `lingshu:<layer>` 或节点 id），并叠加层白名单与密级上限；导出侧复用灵枢 `data/policy.json` 的 `forbidden` 模式拦下疑似凭据。`memoryWrite` 永不自动应用，操作固定 `risk:'high'`。
- 冲突与删除：双方都改 → `concurrent-lingshu-change`，默认保留本机，可由人工选择采用对方；对端缺席永不删除；快照不包含记忆节点。
- 设置页：「同步范围」新增「记忆（灵枢）」块（按层勾选与节点数、桥不可用时禁用），「同步」里按作用域显示记忆计划卡；字典中英同步。
- 测试：新增 9 项（投影稳定性与拒绝面、层/密级/禁写模式过滤、策略与计划器、中心-设备端到端、复核闸拒绝、真实 Python 桥写入与覆写保留 `edges`/`sensitivity`），全量 102 项通过；`check`、`check:public` 通过。
- 真实宿主验证：两套隔离 `DSH_HOME` 实例（3997 中心 / 3996 设备）完成 46 个情景节点发布→检查→批准→应用，B 侧落盘 46 并建索引；重复检查 0 操作；A 单方面改文并发布后 B 侧报冲突且不覆盖；人工选「采用对方」后单项应用成功；知识层节点被灵枢拒写，插件报 `memory-needs-review` 且未落盘。B 侧用灵枢自身 `get()`/`search()` 能读到同步后的节点。
- 同期合入独立插件 `lingshu-mute` 的宿主面（`lib/mute/`）：会话/工作区静音开关、`/mute` 命令与 `/plugins/lingshu-mute` 路由；其写入拦截对灵枢升级敏感，失败时降级为仅注入过滤。该合并的详细行为以源码注释与面板为准。
- 未验证项：跨 WAN、Windows/macOS、灵枢复核通道可用时的知识层写入、长驻 Python worker 的收益（本版按批起进程）。

## 0.3.0 — 2026-11-20

移除记忆同步域，建议与设置页围绕插件/配置重做，范围语义改为白名单。

- 移除记忆同步：删除 `lib/memory.js`、`memWrite` 能力、记忆资源类型、记忆计划/提案/快照字段和适配器读写。`RESOURCE_KINDS` 只剩 `plugin`、`pluginConfig`；远端 `kind:'memory'` 以 `unsupported resource kind` 拒绝。本插件不再读取、写入或导出任何记忆/人格文件；0.2.0 记录中的记忆同步条目已在本版移除。
- 加载旧状态时自动迁移并落盘：删除 `expectedMemory`、`memoryBaselines`、`lastMemoryPlan/lastMemoryResults/lastMemoryStatus`、`pendingSnapshot.expectedMemory`、`caps.memWrite` 和带 `adapterId/relativePath` 的旧建议。旧状态不会因多余字段校验失败。
- 建议改为扫插件：`analyzePlugins` 对系统插件给 `localOnly`、已停用给 `skip`、已启用给 `sync`、已在 `include` 里的不再建议；`suggest` 只写建议，`adopt` 由用户触发才写 `include`/`localOnly`。模型复核只接收插件元数据（key、enabled、kind）。
- 设置页重做：顶部状态与暂停/恢复、建议置顶、同步范围（两个预设、方向、自动读取可搜索插件清单、勾选即保存、配置字段勾选、范围 JSON 本地导入/导出）、同步（按角色的「发布本机改动」或「看差异」「发给对方」、对方变更接受/拒绝、冲突、勾选后一次点击完成批准和应用）、连接（设备撤销、邀请、可选 SSH 隧道）、更多（快照、归档、最近活动）、高级折叠；界面改用宿主真实主题令牌并带降级值，避免变量缺失时卡片不渲染。
- 同步范围改为白名单：设置页保存时固定写 `default:'deny'`，`mode` 随自动应用写 `managed`/`selective`；一个都不勾就不同步。旧版 `default:'allow'` 下清空 `include` 等于全同步的语义已消除。
- 入口去重：面板只注册「插件 → 设备同步」，不再在左下角「设置」里重复放一份； locales 的展示描述同步更新。
- 首次打开指引：未配对时按「中心 / 点对点」×「创建 / 接入」四种组合一键填好连接预设（高亮创建按钮或展开接入表单并选好对方类型），关闭状态记在本机 localStorage，可在「连接」卡重新打开。
- 排版重做：顶部状态区 + 宽屏两列（左：建议/范围/同步，右：连接/更多）+ 底部高级；窄屏单列。文本输入框改用明显边框和聚焦外圈高亮。
- 同步范围可在插件清单里一键设置：带配置条目的插件多一个「同步设置」勾选框，勾上即把该插件全部非密钥配置字段写入 `configFields` 并加入 `include`、开启 `configSet`；取消即移除。范围 JSON 导入/导出同步带上配置条目。按用户要求移除独立的「插件 + 配置」预设和配置项逐字段勾选界面，`configSet` 完全由「同步设置」勾选结果决定。
- 「重置同步」：连接卡右上角新增带确认的重置，清除配对、对端、邀请与连接凭据并回到未配对，已勾选的同步范围保留，可重新选中心/点对点与网络；首次指引随之重新出现。首次指引增加「局域网 / SSH 隧道 / 公网」一档。
- 配对流程改为网络适配 + token 验证：局域网允许明文 `http://`，公网用 HTTPS，SSH 走密钥隧道；主机侧生成含邀请码的邀请链接，接入侧粘贴链接->解析->「验证链接」（只读 hello 探测，不消费邀请）后才能连接。所有外发仍带 token。
- 本地测试调整为 93 项全绿：新增 6 项后端验证/重置用例、3 项界面回归（整插件设置、重置、链接验证），并更新 HTTP 传输的 LAN 断言。CI 配置仍为 Node 22/24 矩阵。
- 未验证项不变：没有真实付费模型调用、没有跨 WAN 实测、没有覆盖所有桌面端与移动端导航。

## 0.2.0 — 2026-11-19

安全复核与首次独立 GitHub 包格式。

- 将同步状态、审计和凭据隔离到实际 home/profile 作用域；损坏状态拒绝启动，私有原子存储拒绝危险文件路径。
- 所有外发入口遵守本机范围和方向。配置/记忆默认不导出；配置采用明确字段路径白名单，写入时保留当前本机秘密与未选择字段。
- 批准绑定策略、来源与基线。三类计划和审批隔离，补齐全部资源检查、手工冲突决定、失败重试、依赖执行和单项结果持久化。
- 修复点对点角色/路由断路；实现双端状态交换、监听端提案队列、接收确认、撤权与拒绝提案。点对点限一对设备，多设备使用中心。
- 修复离线快照入口参数、类型/地址/哈希校验、未签名来源提示和导入后的三域检查。
- SSH 改为系统 OpenSSH 直接 TCP forwarding，修复原远端 curl 目标缺失及 shell 展开后 bearer 出现在远端 argv 的问题；保留严格 host key 校验和超时/字节边界。
- 记忆写入增加类型、根目录与 owner sidecar 校验、写入锁、创建基线检查及备份；扫描不创建不存在的目录。
- 完善设置页、三域计划与结果、策略配置、按需资源目录、邀请管理、状态重试及失败反馈；移除根据已配对状态伪造实时在线的显示。
- 合并重复审计实现；统一资源计划器与有界状态；删除未接线帮助代码、重复 locale UI 副本及无界 JSONL 副本写入。
- 补公开说明、安全说明、发布门禁、CI、开发依赖锁文件和明确的 DSH 兼容范围。运行包无构建脚本和运行时 npm 依赖。

升级提示：0.1.0 开发版共享状态目录不自动迁移；在新 profile 作用域重新选择范围并配对。旧数据不会自动删除。

## 0.1.0 — 开发基线

早期中心/设备同步实现，后加入配置、记忆、点对点、快照及 SSH 的原型。此版本的局部测试不能作为 0.2.0 安全与真实部署验收的替代。
