# dsh-plugin-sync（DSH 设备同步）

在多个 DSH profile 之间同步第三方插件的版本/启停状态和明确选择的插件配置字段。支持一个中心管理多个设备，或两台设备点对点交换。远端提供候选状态，本机策略和审批决定是否写入。

当前版本：**0.4.5**。已核验的宿主版本：**DSH 0.2.3-alpha.2**。运行代码为已提交的 JavaScript，无运行时 npm 依赖、无安装构建脚本。

## 安装与入口

GitHub 仓库根就是可安装包根。在 DSH **插件 → 添加插件** 中填写：

```text
github:coollcat/dsh-plugin-sync
```

CLI 使用同一个来源，把 `<profile>` 换成正在使用的 profile 名称：

```sh
dsh plugin --profile <profile> add github:coollcat/dsh-plugin-sync
```

Web 的 profile 常用 `web`，桌面常用 `desktop`，应以实际实例为准。安装到另一个 profile 不会改变当前页面。安装结果为 `applied` 后刷新页面；若显示 `restart-required`，重启对应 DSH 实例后再刷新。

安装启用后只有一个入口：

- **插件 → 设备同步**：配对、建议、同步范围、差异计划、审批、结果与离线快照都在这一个面板里，左下角「设置」不再重复放一份。

首次打开时面板会显示连接指引：选「中心模式 / 去中心化（点对点）」「创建网络 / 接入现有网络」「局域网 / SSH 隧道 / 公网」，点「填好并继续」即把对应预设填进「连接」卡（高亮相应按钮，或展开接入表单）。点「我自己来」关掉，之后可在「连接」卡右上「重新打开指引」找回。指引只在首次打开出现，选择记在本机 localStorage。配对选错了可以用「连接」卡右上的「重置同步」回到未配对，再重新选一次；已勾选的同步范围会保留。

整体排版为窄屏单列、宽屏两列：左列「先配好」（建议、同步范围、同步），右列「连接与工具」（连接、更多），高级设置只保留自动应用与检查间隔。所有文本输入框都有明显的边框和聚焦高亮。

面板顶部显示设备名、角色和连接状态；未配对时不显示暂停。配对后「同步」卡按角色给按钮：成员（设备或已连上对端的点对点端）显示「看差异」「发给对方」，中心或点对点监听端显示「发布本机改动」。

需要固定版本时，把安装来源写成 `github:coollcat/dsh-plugin-sync#<完整提交 SHA>`。更新仍使用同一个仓库来源；替换已加载的宿主代码应按 DSH 给出的重启提示处理。

## 目录结构

仓库根就是包根：`index.js` 是宿主入口，`client.js` 是「插件 → 设备同步」页的面板，`lib/` 是引擎、策略、协议、计划器、配置投影、快照、传输、SSH 与审计等运行模块，`cordis.patch.yml`、`locale/`、`icon.svg` 是 bundle 与显示元数据，`test/` 与 `scripts/` 是回归测试和发布门禁，`docs/` 是使用说明与审计记录。记忆同步模块 `lib/memory.js` 已在 0.3.0 删除。

## 第一次使用

1. 在中心和设备的实际 profile 中安装插件。
2. 打开设置，在「建议」里点「让 agent 给建议」会开一个新对话，带上本机插件清单让 AI 给建议（IM / 记忆 / 灵枢等绑定本机或独立同步域的插件会被排除）；在「同步范围」里勾选要同步的插件，规则与允许同步的改动也收在这里。要把某个插件的**全部配置**一起同步，直接在插件列表里勾「同步设置」；没有单独的配置项页面或逐字段勾选。勾选即保存，没有单独的保存按钮。
3. 未配对时在「连接」里选网络（局域网可用明文 `http://`，公网用 `https://`，SSH 走密钥隧道），再选「让别的设备连我 / 我去连别的设备 / 两台设备直连」。同步流量默认走独立端口 3081；反向代理也可把 `/plugin-sync/hello|state|proposals` 转到该端口，此时填写带路径的基础地址（如 `https://deeplab.icu/ds/`），不会追加 `:3081`。主机侧邀请区提供项目下载 / 安装链接，先填邀请设置（SSH 只填主机、用户、端口，不需要私钥），再生成含一次性 token 的邀请链接。接入侧粘贴链接即自动解析，缺失的 SSH 字段保留手填值，「验证链接」成功后才能「连接」；配对后还可点「确认连接」主动验证已保存的路由。邀请 24 小时过期；请私下传递。
4. 成员（设备或已连上对端的点对点端）在「同步」里「看差异」，处理冲突，勾选要应用的操作，再一次点击「把这 N 项改到本机」。需要把自己的改动交给对方时用「发给对方」；中心或点对点监听端没有上游可拉，用「发布本机改动」把当前范围写成新的期望状态。
5. 结果会区分已应用、需重启、失败、冲突和部分完成。安装与升级默认不勾选，需逐项确认。

设备也可提交提案；中心接受后只发布新的期望修订，不会替设备绕过本机批准。详见 [使用说明](docs/USAGE.md)。

## 记忆（灵枢）同步

第三类可同步资源是**灵枢认知图节点**（`@furongjun1999/dsh-memory`，Python 包 `md_cg`）。它和 0.2.0 被删掉的通用记忆域不是一回事：只认灵枢，写入不绕过灵枢自己的闸门。

- **只同步层目录里真实的节点**：`contextual / goals / unresolved` 默认可用，`knowledge / structural` 需在设置里勾选且写入时仍受灵枢复核闸约束；`self / anchor` 不提供。索引、日志、锁、`hippocampus/`、`trash/`、`_protected_history/`、`_keys.json` 一律不读不写。
- **读走文件，写走库**：读取是层目录的受限扫描（节点 `.md` 是灵枢唯一真源）；写入必须经 `lib/lingshu-bridge.py` 调 `MdCGSecure.add()`——直接写字节不会同步索引，运行中的灵枢会看到撕裂的库（实测：`get()` 见新值、`search` 见旧值）。
- **不绕过复核闸**：`knowledge/structural/self/anchor` 在没有复核通道时会被灵枢拒写。插件如实把结果标成「需本机复核」，不重试、不降档、不伪造 reviewers。
- **本机权威字段不迁**：`sensitivity`、`access_count`、`last_access`、`importance`、`session`、`writer`、`protected`、`edges` 等字段由本机维护，跨设备比较与写入都不带上（`edges` 在覆写时显式保留本机值）。密级高于 `internal` 的节点默认不外发，命中灵枢自己 `policy.json` 禁写模式的节点也会被拦。
- **人工批准**：`memoryWrite` 永远不进自动应用，必须逐次批准；双方都改过的节点进入冲突，默认保留本机。
- **前置**：本机要能用同一套 Python 解释器 import 到灵枢包（默认从 profile 的 `node_modules/@furongjun1999/dsh-memory` 找，可用 `lingshu.packagePath` / `MDCG_PACKAGE_PATH` 指定）。找不到时只显示目录、不提供写入。

## 从 0.2.0 升级

- 记忆同步域已移除：不再读写任何记忆/人格文件。`memWrite` 能力、记忆资源类型和记忆计划/提案/快照字段都不再存在；远端若发来记忆资源，会以 `unsupported resource kind` 拒绝。
- 0.4.0 重新加入的是**灵枢专用**域（`lingshuNode` / `memoryWrite`），与 0.2.0 的通用记忆域不同：它不扫任意目录，只认灵枢的层与节点 id。
- 旧状态在首次加载时自动迁移并落盘：删除 `expectedMemory`、`memoryBaselines`、`lastMemoryPlan/lastMemoryResults/lastMemoryStatus`、`pendingSnapshot.expectedMemory`、`caps.memWrite`，以及带 `adapterId/relativePath` 的旧建议。旧状态不会因为多出这些字段而校验失败。
- 建议改为扫插件：升级后需要重新生成建议；采纳只修改 `include`/`localOnly`，且必须由用户逐条点击。
- 同步范围改为白名单：设置页保存时一律写 `default:'deny'`，`mode` 随自动应用写成 `managed`/`selective`。旧版 `default:'allow'` 下“清空 include 等于全同步”的语义已消除。迁移不会静默改写旧策略：升级后请到「同步范围」确认并触发一次保存（勾选或取消任意插件即可）；在保存前，旧状态里的 `default` 仍按原值生效。一个都不勾就不同步。
- 状态与凭据路径不变，不需要重新配对；0.1.0 开发版的共享状态目录仍不自动迁入。

## 默认安全边界

- 安装、升级、配置写入和自动应用默认关闭；启用/停用能力可生成手动审批计划。
- 同步范围是白名单：插件和配置都要勾选，设置页保存时固定写 `default:'deny'`；一个插件都不勾就不同步插件。未知配置 schema 默认不外发，配置只能在插件列表里按「同步设置」整包纳入；键名/值的秘密识别只是额外防线。
- 系统包与同步器自身不可由同步计划修改。本机专属规则优先于其他选择；缺席不会变成卸载或文件删除。
- 批准绑定计划内容、来源修订、本机基线和本机策略。改变其中任一条件，必须重新检查和批准。
- 托管自动应用只覆盖低风险启停与配置字段写入。安装、升级、冲突覆盖、离线快照和高风险批次仍需人工批准。
- 非回环地址必须 HTTPS。SSH 使用系统 OpenSSH 的直接 TCP 转发，主机密钥走 `accept-new`：首次连接自动记录指纹、之后变化即拒绝，不需手填 `known_hosts`；凭据经加密通道输入流传递，无远端 shell/curl，也不把 bearer 放进 argv。
- 不同步会话、模型凭据、配对密钥或整个 profile。灵枢记忆只在显式勾选层后按节点同步，正文受本机策略与密级上限约束，审计与提案列表只留 key/层/哈希。状态和凭据按 home/profile 隔离。撤销设备会立即停止该设备后续访问。

## 支持范围与限制

同步应用支持精确 registry 版本的安装/升级以及已识别插件的启停。无法复现的本地目录/来源不会伪装成 registry 包；Git/file 来源不会被自动安装。插件本身可通过上面的 GitHub 来源直装，这与同步安装其他插件是两件事。

点对点模式目前是一对设备；成员侧提交提案，对方接受后才发布。多设备使用中心模式，无自动选主、传递信任或全网网状路由。

同步由三类资源组成：插件清单、配置字段和灵枢记忆节点，各自保存计划、批准和结果。灵枢域默认关闭，未勾选任何层时不产生计划，也不进快照。

离线快照有完整性校验；有本机可识别的共享密钥时使用 HMAC。未签名快照会明确标记来源不可信。签名不提供加密，共享密钥持有方均能生成有效签名。所有快照只生成计划，不直接写入、不提升同步基线。

记忆同步不搬运灵枢的索引/日志，覆写后由运行中的灵枢在下一次读面重载索引；`knowledge/structural` 的写入取决于本机复核通道，没有通道时会被拒。本插件不承诺跨包管理器、配置编辑器、文件系统的全局事务，也不承诺撤销第三方插件的外部副作用。收费模型调用、跨两台物理主机的网络连通性和各操作系统组合须按自己的部署环境验证。0.3.0 未做新的外部渗透测试；本版验证是回归、静态审查和单机实测。

## 开发与审计

```sh
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

这些步骤只用于开发与发布检查，普通使用者直接通过 DSH 安装即可。开发依赖 React/renderer 只用于界面回归；运行时 React 由 DSH 提供。`npm test` 当前 137 项；`npm run check:public` 扫描工作树与全部可达 Git 历史，是公开发布门禁。

- [完整使用说明](docs/USAGE.md)
- [安全边界与问题报告](SECURITY.md)
- [本版审计与验收记录](docs/AUDIT.md)
- [变更记录](CHANGELOG.md)

This bundle provides policy-controlled DSH profile synchronization. Installation, settings and limitations are documented above; the Web UI also includes English labels.

---

## 工作区说明（workspace）

- **工程名（目录）**：`dsh-plugin-sync`（包名 `@local/dsh-plugin-sync`）
- **用途**：策略控制的 DSH profile 同步——本机审批、插件范围白名单、配置字段白名单与灵枢记忆节点同步。
- **引用关系（~/.dsh/profiles/web）**：**被引用（github 来源，非 link/file）**。`package.json` 依赖 `@local/dsh-plugin-sync: github:coollcat/dsh-plugin-sync`，且列在 `dsh.profile.bundles`；本地工作副本即本仓库根目录，与 remote 对应。
- **构建 / 验证命令**：package.json scripts：`npm run verify`（check + test + check:public）、`npm test`（`node --test test/*.test.js`）、`npm run check`、`npm run check:public`。
- **Git**：remote `origin` = https://github.com/coollcat/dsh-plugin-sync.git；当前状态 = 既有仓库，有未提交改动（含本 README），未新增提交。
