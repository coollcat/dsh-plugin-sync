/**
 * lingshu-mute —— 给「灵枢」记忆插件（@furongjun1999/dsh-memory）加两个开关的**独立插件**：
 *   ① 本次对话不记记忆（按会话 id 静音）
 *   ② 本工作区不记记忆（按会话 header.cwd 前缀静音）
 *
 * ## 为什么是「独立插件 + 源码级拦截」而不是改灵枢
 * 灵枢包的**所有写入**都收敛在两个类上（本机实测 0.9.17）：
 *   · `lib/lib/mdcg_client.js` 的 `MdcgClient`：`remember / write / writeNode /
 *     writeRole / writeTranscript / recentAdd / read`；
 *   · `lib/bridge.js` 的 `LingshuBridge.callTool(name, args, signal)`：工具面
 *     （ctx.tools 注册的 mdcg_* 工具）与上面所有方法的最终出口。
 * 写入调用都把会话标识放在 `extra.session` / `meta.session` / `args.session`
 * （hooks.ts 的 sessionTag、session_state.ts 的写归因注入）。因此**在原型上拦一层**
 * 就能覆盖全部写入面，且不改灵枢包内任何文件。
 *
 * 关键前提（已实测）：灵枢包是**真实目录**（非 symlink），本插件用**绝对 file URL**
 * 动态 import 这两个模块，与灵枢自身 `./lib/mdcg_client.js` 的 ESM 模块实例**同一个**
 * ——patch 到的就是灵枢正在用的那个原型。
 *
 * ## 三层闸口（全部 fail-open，且只 warn 一次）
 *   1. **写入拦截**（本文件 installWriteGate）：命中静音 → 返回「成功但没写」的合成回执，
 *      不触达桥（不 spawn/不请求 Python 侧）；
 *   2. **注入拦截**（system-prompt/assemble）：命中静音 → 从 assembly.contexts 里
 *      剔掉 `lingshu:*` 块（自动召回 / 会话窗口 / 逢十轮提醒 / 身份锚点）；
 *   3. **GUI / 命令**：`/plugins/lingshu-mute/{meta,state,toggle}`（lib/http.js）与
 *      斜杠命令 `/mute on|off|status [session|workspace]`。
 *
 * ## 已知边界（README 有完整版）
 *   · 源码级 monkey-patch 对灵枢**升级敏感**（方法名/签名变则降级为仅注入过滤 + 开关）；
 *   · 角色扮演（roleplay）写入不带 DSH 会话标识 → 不受「本次对话」静音影响；
 *   · `/lingshu` 控制台的手动写入（GUI 里点「记住」）走同一条 MdcgClient 出口，
 *     会被拦；但**直接调用灵枢 CLI / MCP 子进程**的写入不经过本进程，拦不到。
 *
 * @module lingshu-mute
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    configureMute, lastObservedSession, MODE_NO_READ, muteFilePath, noteSessionCwd,
    normalizeWorkspacePath, resetMuteState, resolveGate, resolveGateForSession,
    setSessionMute, setWorkspaceMute, snapshot, workspaceMuteInfo,
} from './mute_state.js';
import {
    createMuteHandler, MUTE_HTTP_PREFIX, MODULE_VERSION, registeredWorkspacePath, workspaceRegistryRows,
} from './http.js';

/** 插件名（cordis 插件行的 name 字段；与包名一致）。 */
export const name = 'lingshu-mute';
/** 不声明 inject：宿主服务（webServer/commands/sessions/connection）一律
 *  `ctx.get(...)` 可选获取 + `ctx.inject([...], cb)` 迟到挂载，
 *  避免与灵枢争激活顺序、也避免服务缺失时整个插件不启动。 */
export const inject = [];

/** 被拦截的灵枢包名。 */
const LINGSHU_PACKAGE = '@furongjun1999/dsh-memory';
/** 灵枢内部模块相对包根的路径（**必须**用这两个路径导入才能命中同一 ESM 实例）。 */
const MDCG_CLIENT_REL = 'lib/lib/mdcg_client.js';
const BRIDGE_REL = 'lib/bridge.js';
/** 原型 patch 记录的全局键（Symbol.for 与模块实例无关：HMR 重装不叠加 patch）。 */
const PATCH_SYMBOL = Symbol.for('lingshu-mute.patch');
/** 注入块名前缀（灵枢的四个上下文块都以此开头）。 */
const LINGSHU_CONTEXT_PREFIX = 'lingshu:';

/** 进程级告警去重（每类一次，防日志刷屏）。 */
const warnedKeys = new Set();

/** 是否只读调用（读类放行）——读写判定的**唯一实现**（与灵枢 console_web 同源口径）。
 *
 *  未知工具 / 未知 op **一律按写处理**（保守：宁可多拦一次，不可漏写）。
 *  @param {string} tool MCP 工具名（`cg` / `stg` / `mdcg_remember` …）
 *  @param {object} args 调用参数
 *  @returns {boolean} true = 只读（不拦）
 */
export function isReadOnlyCall(tool, args = {}) {
    const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    const unsafe = UNSAFE_ARG_KEYS.some((key) => a[key] !== undefined);
    if (tool === 'stg') return !unsafe && STG_READ_OPS.includes(a.op);
    if (tool === 'cg') return !unsafe && (READ_OPS.has(a.op) || READ_ACTIONS[a.op]?.includes(a.action) === true);
    return READ_TOOL_NAMES.has(tool);
}

/** cg 的只读 op。 */
const READ_OPS = new Set(['info', 'read', 'route', 'help', 'edges', 'status', 'audit']);
/** cg 的「只读 op + action」组合（与灵枢 console_web 的 READ_ACTIONS 同源）。 */
const READ_ACTIONS = {
    // `cg(op=session, action=recall)` = 灵枢的「会话续接包」读取（md_cg 的 session_recall），
    // 纯读：静音期间照常放行（注入块会被 assemble 闸口剔掉，见 installAssembleGate）。
    session: ['recall'],
    goal: ['list'],
    task: ['list', 'get', 'find', 'session'],
    recent: ['list'],
    identity: ['profile'],
    self_state: ['snapshot'],
    metacognition: ['report'],
    review: ['list', 'records'],
    protect: ['stats'],
    evolution: ['summary'],
    sustain: ['status'],
    maintain: ['stat'],
    ref: ['stat'],
    theory: ['check'],
    link: ['ls'],
    whitebox: ['ping'],
};
/** 「有副作用」的入参键：出现任一即按写操作处理。 */
const UNSAFE_ARG_KEYS = ['content', 'text', 'goal', 'set', 'apply', 'write', 'force', 'override', 'auto_flywheel'];
/** stg 的只读 op（其余 op 一律按写处理）。 */
const STG_READ_OPS = ['relation', 'timeline', 'anchors', 'consistency', 'state_chain'];
/** 只读工具名集合（多态工具 cg / stg 由上方 op/action 表细化；未知工具按写处理）。 */
const READ_TOOL_NAMES = new Set([
    'mdcg_recall', 'mdcg_search', 'mdcg_get', 'mdcg_review_list', 'mdcg_review_records',
    'mdcg_forgetting_history', 'mdcg_health', 'mdcg_whoami', 'mdcg_service_info',
    'mdcg_rejected', 'mdcg_unresolved', 'mdcg_watermarks',
    'mdcg_timeline', 'mdcg_recent',
]);

/** 最近一次写入门安装结果（供 `/meta` 的 `gate` 诊断字段：日志不可见时也能确认是否接管）。 */
let lastGateResult = { patched: false, reason: 'not-installed-yet' };

/** 写入门诊断快照（**只读**；`/plugins/lingshu-mute/meta` 的 `gate` 字段）。 */
export function gateStatus() {
    const rec = patchRecord();
    const result = lastGateResult && typeof lastGateResult === 'object' ? lastGateResult : {};
    return {
        patched: rec.installed === true,
        methods: Array.isArray(rec.methods) ? rec.methods.slice() : [],
        lingshuDir: typeof rec.dir === 'string' ? rec.dir : '',
        reason: typeof result.reason === 'string' ? result.reason : null,
        already: result.already === true,
    };
}

/** 插件主入口：apply 永不抛（fail-open；异常只 warn 一次并降级）。 */
export function apply(ctx, config) {
    const logger = safeLogger(ctx);
    const cfg = config && typeof config === 'object' ? config : {};
    try {
        configureMute({
            logger,
            excludeWorkspaces: Array.isArray(cfg.excludeWorkspaces) ? cfg.excludeWorkspaces : [],
            ...(typeof cfg.statePath === 'string' && cfg.statePath.trim() ? { statePath: cfg.statePath.trim() } : {}),
        });
    }
    catch (err) {
        logger.warn(`lingshu-mute: 静音表初始化失败（按“未静音”运行）: ${err?.message ?? err}`);
    }

    // ① 会话观测：session/event 与 session/created 都顺手记 sid→header.cwd
    observeSessions(ctx, logger);
    // ② 注入拦截：system-prompt/assemble（waterfall）里剔掉 lingshu:* 块
    installAssembleGate(ctx, logger);
    // ③ 写入拦截：原型 patch（异步：需要动态 import 灵枢内部模块）
    const patchPromise = installWriteGate({ logger, resolve: defaultGate })
        .then((result) => {
            lastGateResult = result && typeof result === 'object' ? result : { patched: false, reason: 'unknown' };
            return result;
        })
        .catch((err) => {
            logger.warn(`lingshu-mute: 写入门安装异常（已降级为仅注入过滤 + 状态开关）: ${err?.message ?? err}`);
            lastGateResult = { patched: false, reason: 'exception' };
            return lastGateResult;
        });
    // ④ HTTP（GUI 开关）+ ⑤ 斜杠命令
    mountHttp(ctx, logger, cfg);
    mountCommand(ctx, logger);

    try {
        logger.info(`lingshu-mute: 静音表就绪（${muteFilePath()}）`);
    }
    catch { /* 日志面不可用忽略 */ }
    return patchPromise;
}

// ── 日志 / 上下文工具 ────────────────────────────────────────────────────────

/** 取 ctx.logger，缺失时回落 console（**永不抛**）。 */
function safeLogger(ctx) {
    const raw = ctx && typeof ctx === 'object' ? ctx.logger : null;
    const wrap = (level) => (msg) => {
        try {
            if (raw && typeof raw[level] === 'function') raw[level](msg);
            else if (level === 'warn' || level === 'error') console.warn(msg);
        }
        catch { /* 日志面不可用时忽略：闸口本身必须继续工作 */ }
    };
    return { info: wrap('info'), warn: wrap('warn'), error: wrap('error') };
}

/** 同类告警同进程只打一次。 */
function warnOnce(logger, key, message) {
    const k = `lingshu-mute:${key}`;
    if (warnedKeys.has(k)) return;
    warnedKeys.add(k);
    logger.warn(message);
}

/** `ctx.get(name)` 的安全包装（cordis 的 get(strict) 在服务未就绪时会抛）。 */
function safeGet(ctx, service) {
    try {
        if (!ctx || typeof ctx.get !== 'function') return undefined;
        const value = ctx.get(service);
        return value ?? undefined;
    }
    catch { return undefined; }
}

/** `ctx.effect(fn, label)` 的安全包装（没有 effect 时直接执行并返回其清理函数）。 */
function safeEffect(ctx, fn, label) {
    try {
        if (ctx && typeof ctx.effect === 'function') return ctx.effect(fn, label);
    }
    catch { /* 落到下面的直接执行 */ }
    try {
        return fn();
    }
    catch {
        return undefined;
    }
}

// ── ① 会话观测 ──────────────────────────────────────────────────────────────

/** 从宿主 Session 取 `{sessionId, cwd}`（字段口径与 mute_state.resolveGateForSession 一致）。 */
export function sessionFields(session) {
    const raw = session && typeof session === 'object' ? session : null;
    const header = raw?.header && typeof raw.header === 'object' ? raw.header : null;
    const id = raw?.id ?? raw?.sessionId;
    return {
        sessionId: typeof id === 'string' ? id.trim() : '',
        cwd: header && typeof header.cwd === 'string' ? header.cwd.trim() : '',
    };
}

/**
 * **最近活跃会话**（服务端认定，进程内；reload 重建可接受）。
 *
 * 客户端不再猜「当前会话」——`uiWorkspace.selection` / 唯一 running 会话都不可靠。
 * 触发点：`session/event`、`session/created`；跳过子代理（`header.origin==='subagent'`
 * 或 `delegationDepth>0`）与空 sid。
 */
const activeState = { id: '', cwd: '', at: '', title: '' };

/** 判断一个会话是否算「用户主对话」（排除子代理）。 */
export function isPrimarySession(session) {
    const raw = session && typeof session === 'object' ? session : null;
    if (!raw) return false;
    const header = raw.header && typeof raw.header === 'object' ? raw.header : null;
    const origin = (header && typeof header.origin === 'string' ? header.origin : '') || (typeof raw.origin === 'string' ? raw.origin : '');
    if (origin === 'subagent') return false;
    const depth = raw.delegationDepth ?? (header ? header.delegationDepth : undefined);
    if (typeof depth === 'number' && depth > 0) return false;
    const parent = raw.parentId ?? raw.parentSessionId ?? (header ? header.parentSessionId : undefined);
    if (typeof parent === 'string' && parent.length > 0) return false;
    return true;
}

/** 记录最近活跃会话（供命令 / HTTP / 测试调用）。返回当前值。 */
export function noteActiveSession(session) {
    const { sessionId, cwd } = sessionFields(session);
    if (!sessionId) return { ...activeState };
    if (!isPrimarySession(session)) return { ...activeState };
    const raw = session && typeof session === 'object' ? session : {};
    const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : activeState.id === sessionId ? activeState.title : '';
    activeState.id = sessionId;
    activeState.cwd = cwd || (activeState.id === sessionId ? activeState.cwd : '');
    activeState.at = new Date().toISOString();
    activeState.title = title;
    return { ...activeState };
}

/** 读最近活跃会话（空对象字段 = 还没有）。 */
export function getActiveSession() {
    return { ...activeState };
}

/** 仅测试：清空最近活跃会话。 */
export function resetActiveSession() {
    activeState.id = '';
    activeState.cwd = '';
    activeState.at = '';
    activeState.title = '';
}

/** 注册会话观测：`session/event`（宿主事实：session.header.cwd 为绝对工作目录）。 */
function observeSessions(ctx, logger) {
    const observe = (session) => {
        try {
            const { sessionId, cwd } = sessionFields(session);
            if (sessionId && cwd) noteSessionCwd(sessionId, cwd);
            noteActiveSession(session);
        }
        catch { /* 观测失败不影响主流程 */ }
    };
    for (const event of ['session/event', 'session/created']) {
        try {
            if (typeof ctx.on !== 'function') break;
            ctx.on(event, (session) => observe(session));
        }
        catch (err) {
            warnOnce(logger, `observe:${event}`, `lingshu-mute: 无法监听 ${event}（工作区静音将依赖请求自报 cwd）: ${err?.message ?? err}`);
        }
    }
}

// ── ② 注入拦截 ──────────────────────────────────────────────────────────────

/**
 * 从 `assembly.contexts` 就地剔掉 `lingshu:*` 块（**原地 splice**：宿主其余监听者
 * 拿的是同一个对象引用）。返回剔掉的条数。
 */
export function stripLingshuBlocks(container) {
    const list = container && Array.isArray(container.contexts) ? container.contexts : null;
    if (!list) return 0;
    let removed = 0;
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const entry = list[i];
        const blockName = entry && typeof entry.name === 'string' ? entry.name : '';
        if (blockName.startsWith(LINGSHU_CONTEXT_PREFIX)) {
            list.splice(i, 1);
            removed += 1;
        }
    }
    return removed;
}

/** 从 assemble 的 `context` 参数解析「这是哪个会话」（优先 context.agent.session）。 */
export function gateForAssembleContext(context) {
    try {
        const agent = context && typeof context === 'object' ? context.agent : null;
        const session = agent && typeof agent === 'object' ? agent.session : null;
        const direct = resolveGateForSession(session);
        if (direct.sessionId) return direct;
        // 兜底：context.scope 可能是会话作用域键（session 作用域 slot 用 sid 作 key）。
        const scope = context && typeof context === 'object' && typeof context.scope === 'string' ? context.scope.trim() : '';
        const sid = scope.replace(/^session[:/]/, '');
        if (sid) {
            const cached = safeGate({ sessionId: sid });
            if (cached.sessionId) return cached;
        }
        return direct;
    }
    catch {
        return { muted: false, sessionId: '', scope: null };
    }
}

function safeGate(input) {
    try {
        return resolveGate(input);
    }
    catch {
        return { muted: false, sessionId: '', scope: null };
    }
}

/** 安装注入拦截（命中静音 → 剔块；`next()` 先跑完，确保下游 push 的块也被剔掉）。 */
function installAssembleGate(ctx, logger) {
    safeEffect(ctx, () => {
        const listener = async (assembly, context, next) => {
            const result = await next();
            try {
                const gate = gateForAssembleContext(context);
                if (!gate || !gate.muted) return result;
                let removed = stripLingshuBlocks(result);
                if (result !== assembly) removed += stripLingshuBlocks(assembly);
                if (removed > 0) {
                    warnOnceIn(logger, gate, `lingshu-mute: 已剔除 ${removed} 个灵枢注入块（${gate.reason}）`);
                }
            }
            catch (err) {
                warnOnce(logger, 'assemble-strip', `lingshu-mute: 注入块剔除失败（本轮照常注入）: ${err?.message ?? err}`);
            }
            return result;
        };
        if (typeof ctx.on !== 'function') return undefined;
        return ctx.on('system-prompt/assemble', listener);
    }, 'lingshu-mute: system-prompt/assemble gate');
}

/** 剔除日志去重键按「原因 + 会话」区分，同会话只打一次（防每步一次刷屏）。 */
function warnOnceIn(logger, gate, message) {
    const key = `strip:${gate.reason}:${gate.sessionId || gate.workspacePath || ''}`;
    if (warnedKeys.has(`lingshu-mute:${key}`)) return;
    warnedKeys.add(`lingshu-mute:${key}`);
    try { logger.info(message); } catch { /* ignore */ }
}

// ── ③ 写入拦截（MdcgClient / LingshuBridge 原型 patch）─────────────────────

/** 进程级 patch 记录（Symbol.for：跨 HMR 的模块实例共享同一份）。 */
export function patchRecord() {
    const store = globalThis;
    let rec = store[PATCH_SYMBOL];
    if (!rec || typeof rec !== 'object') {
        rec = {
            installed: false,
            mdcgProto: null,
            bridgeProto: null,
            methods: [],
            dir: '',
            resolve: null,
            logger: null,
        };
        try {
            Object.defineProperty(store, PATCH_SYMBOL, {
                value: rec, configurable: true, writable: true, enumerable: false,
            });
        }
        catch {
            store[PATCH_SYMBOL] = rec;
        }
    }
    return rec;
}

/** 解析灵枢包目录（install 位置 → $DSH_HOME → ~/.dsh）。返回 `{dir, from}` 或 null。 */
export function resolveLingshuDir() {
    const candidates = [];
    // 1) 显式覆盖（测试 / 自定义部署）
    const override = typeof process.env?.LINGSHU_PACKAGE_DIR === 'string' ? process.env.LINGSHU_PACKAGE_DIR.trim() : '';
    if (override) candidates.push({ dir: override, from: 'env' });
    // 2) 与已安装的 lingshu-mute 同级：<profile>/node_modules/@furongjun1999/dsh-memory
    try {
        const here = fileURLToPath(import.meta.url);
        candidates.push({ dir: join(here, '..', '..', '..', LINGSHU_PACKAGE), from: 'sibling' });
    }
    catch { /* 极端环境：忽略 */ }
    // 3) createRequire 从本模块解析（包目录在 <profile>/node_modules 下时才成功）
    try {
        const req = createRequire(import.meta.url);
        const pkg = req.resolve(`${LINGSHU_PACKAGE}/package.json`);
        candidates.push({ dir: join(pkg, '..'), from: 'require' });
    }
    catch { /* exports 未导出 package.json 的包：走下面的路径候选 */ }
    // 4) $DSH_HOME/profiles/web/node_modules/...
    const dshHome = typeof process.env?.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
    if (dshHome) {
        candidates.push({ dir: join(dshHome, 'profiles', 'web', 'node_modules', LINGSHU_PACKAGE), from: 'DSH_HOME' });
    }
    // 5) ~/.dsh/profiles/web/node_modules/...
    try {
        candidates.push({ dir: join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', LINGSHU_PACKAGE), from: 'home' });
    }
    catch { /* homedir 取不到：忽略 */ }
    for (const candidate of candidates) {
        try {
            if (candidate.dir && existsSync(join(candidate.dir, MDCG_CLIENT_REL))) return candidate;
        }
        catch { /* 继续下一个候选 */ }
    }
    return null;
}

/** 动态 import 灵枢的两个内部模块（**绝对 file URL**：与灵枢自身导入同一 ESM 实例）。 */
export async function resolveLingshuModules() {
    const found = resolveLingshuDir();
    if (!found) return null;
    const mdcgUrl = pathToFileURL(join(found.dir, MDCG_CLIENT_REL)).href;
    const bridgeUrl = pathToFileURL(join(found.dir, BRIDGE_REL)).href;
    const [mdcgMod, bridgeMod] = await Promise.all([import(mdcgUrl), import(bridgeUrl)]);
    const MdcgClient = mdcgMod?.MdcgClient ?? mdcgMod?.default?.MdcgClient;
    const LingshuBridge = bridgeMod?.LingshuBridge ?? bridgeMod?.default?.LingshuBridge;
    if (typeof MdcgClient !== 'function' || typeof LingshuBridge !== 'function') return null;
    return { dir: found.dir, from: found.from, MdcgClient, LingshuBridge };
}

/** 合成回执里的静音原因文案。 */
function muteReasonText(gate) {
    if (!gate) return '本次对话';
    if (gate.scope === 'session') return '本次对话';
    if (gate.scope === 'workspace') return gate.static && !gate.runtime ? '本工作区（静态配置排除）' : '本工作区';
    return '本次对话';
}

/** MdcgClient 原型上要 patch 的方法（每项：取会话标识 + 命中回执）。
 *
 *  会话标识口径与灵枢调用点一致：`extra.session` / `meta.session` / `args.session`。
 *  `fallbackToRecent`：仅 `remember` 启用（hooks 的 sessionTag 在**未观测到会话**时会写
 *  `unassigned` 占位，故缺省时回落「最近观测到的会话」；其余方法一律**拿不到就放行**，
 *  避免把角色扮演等无 DSH 会话的写入误杀）。
 */
const MDCG_METHOD_SPECS = [
    {
        key: 'remember',
        extract: (args) => ({ ...callContext(args[1]), fallbackToRecent: true }),
        hit: () => ({ ok: true, verdict: 'DROP', muted: true }),
    },
    {
        key: 'writeNode',
        extract: (args) => callContext(args[0]),
        hit: () => ({ ok: true, verdict: 'DROP', muted: true }),
    },
    {
        key: 'write',
        extract: (args) => callContext(args[1]),
        hit: () => ({ ok: true, verdict: 'DROP', muted: true }),
    },
    {
        key: 'writeRole',
        extract: (args) => callContext(args[2]),
        hit: () => ({ ok: true, verdict: 'DROP', muted: true }),
    },
    {
        key: 'writeTranscript',
        extract: (args) => callContext(args[4]),
        hit: () => ({ ok: true, verdict: 'DROP', muted: true }),
    },
    {
        key: 'recentAdd',
        extract: (args) => callContext(args[2]),
        hit: () => ({ ok: true, skipped: true }),
    },
    {
        key: 'read',
        extract: (args) => callContext(args[1]),
        hit: () => ({ ok: true, skipped: true }),
    },
];

/** 会话标识归一（string + trim；否则空串）。 */
function asSession(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/** 从调用点的 extra/meta/args 里取「会话标识 + 可选 cwd」（灵枢只写 session，
 *  cwd 是某些调用方（工具面 / 外部集成）可能附带的附加线索，有就用）。 */
function callContext(extra) {
    const bag = extra && typeof extra === 'object' ? extra : {};
    return {
        sessionId: asSession(bag.session),
        cwd: typeof bag.cwd === 'string' ? bag.cwd : '',
    };
}

/** 从 `args.tags`（数组）里取 `session:<id>`（桥接面没有 args.session 时的兜底）。 */
function sessionFromTags(tags) {
    if (!Array.isArray(tags)) return '';
    for (const tag of tags) {
        if (typeof tag !== 'string') continue;
        const m = /^session:(.+)$/.exec(tag.trim());
        if (m && m[1]) return m[1].trim();
    }
    return '';
}

/** 桥调用的会话标识：`args.session` → `args.meta.session` → `args.tags` 里的 session:<id>。 */
function sessionOfToolCall(args) {
    const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
    return asSession(a.session) || asSession(a.meta?.session) || sessionFromTags(a.tags);
}

/** 闸口调用：统一走 mute_state.resolveGate（判据单点）+ 最近观测会话回落。 */
function gateOf(ref, input) {
    const fn = ref?.resolve;
    if (typeof fn !== 'function') return { muted: false, sessionId: '', scope: null };
    try {
        return fn(input) || { muted: false, sessionId: '', scope: null };
    }
    catch {
        return { muted: false, sessionId: '', scope: null };
    }
}

/** 默认闸口（installWriteGate 前 / patch 记录被外部清掉时的兜底）。 */
function defaultGate(input = {}) {
    const sessionId = asSession(input?.sessionId) || (input?.fallbackToRecent ? lastObservedSession() : '');
    if (!sessionId && !input?.cwd) return { muted: false, sessionId: '', scope: null };
    return safeGate({ sessionId, cwd: input?.cwd ? String(input.cwd) : '' });
}

/**
 * 安装写入拦截（幂等：同一原型只 patch 一次；HMR 重装只刷新闸口函数）。
 *
 * @param {{logger?: object, resolve?: Function}} options
 * @returns {Promise<{patched: boolean, already?: boolean, reason?: string, methods?: string[], dir?: string}>}
 */
export async function installWriteGate(options = {}) {
    const logger = options.logger ?? safeLogger(undefined);
    const rec = patchRecord();
    // 闸口：用户提供的优先（index.js 的 apply 会传入带最近观测回落的版本）
    rec.resolve = typeof options.resolve === 'function' ? options.resolve : defaultGate;
    rec.logger = logger;

    let modules = null;
    try {
        modules = await resolveLingshuModules();
    }
    catch (err) {
        warnOnce(logger, 'import', `lingshu-mute: 无法导入灵枢内部模块（已降级为仅注入过滤 + 状态开关）: ${err?.message ?? err}`);
        return { patched: false, reason: 'import-failed' };
    }
    if (!modules) {
        warnOnce(logger, 'modules', 'lingshu-mute: 未找到灵枢包（@furongjun1999/dsh-memory）——已降级为仅注入过滤 + 状态开关');
        return { patched: false, reason: 'package-not-found' };
    }

    const { MdcgClient, LingshuBridge, dir } = modules;
    rec.dir = dir;
    if (rec.installed && rec.mdcgProto === MdcgClient.prototype && rec.bridgeProto === LingshuBridge.prototype) {
        return { patched: true, already: true, methods: rec.methods.slice(), dir };
    }

    const patchedMethods = [];
    // MdcgClient：每个方法一层包装（命中 → 合成回执，**不触达**内部调用）
    const proto = MdcgClient.prototype;
    for (const spec of MDCG_METHOD_SPECS) {
        try {
            const original = proto[spec.key];
            if (typeof original !== 'function') continue;
            const wrapper = async function lingshuMuteGuarded(...args) {
                try {
                    const gate = gateOf(rec, spec.extract(args));
                    if (gate && gate.muted) return spec.hit(gate);
                }
                catch { /* 闸口异常 → 放行（fail-open） */ }
                return original.apply(this, args);
            };
            try {
                Object.defineProperty(wrapper, 'name', { value: spec.key, configurable: true });
                Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true });
            }
            catch { /* name/length 属性不可写：无功能影响 */ }
            proto[spec.key] = wrapper;
            patchedMethods.push(`MdcgClient.${spec.key}`);
        }
        catch (err) {
            warnOnce(logger, `patch:${spec.key}`, `lingshu-mute: 无法接管 MdcgClient.${spec.key}（该方法的写入不受拦，其余照常）: ${err?.message ?? err}`);
        }
    }

    // LingshuBridge.callTool：工具面 + cg/stg 直调的最终出口
    try {
        const bridgeProto = LingshuBridge.prototype;
        const originalCallTool = bridgeProto.callTool;
        if (typeof originalCallTool === 'function') {
            bridgeProto.callTool = async function lingshuMuteGuardedCallTool(toolName, args, signal) {
                try {
                    const gate = gateOf(rec, { sessionId: sessionOfToolCall(args) });
                    if (gate && gate.muted) {
                        const readOnly = isReadOnlyCall(toolName, args);
                        // 记忆关：放行只读工具（靠注入闸口剔块，不剥夺主动回忆能力）。
                        // 不读记忆：连只读工具一起拒——「不读任何记忆」的字面语义。
                        if (gate.noRead || !readOnly) {
                            const text = gate.noRead
                                ? `灵枢记忆处于「不读」模式（原因：${muteReasonText(gate)}），已拒绝该记忆${readOnly ? '读取' : '写入'}`
                                : `灵枢记忆已静音（原因：${muteReasonText(gate)}），已拒绝该写入`;
                            return { content: [{ type: 'text', text }], isError: false };
                        }
                    }
                }
                catch { /* 闸口异常 → 放行 */ }
                return originalCallTool.call(this, toolName, args, signal);
            };
            try {
                Object.defineProperty(bridgeProto.callTool, 'name', { value: 'callTool', configurable: true });
            }
            catch { /* 忽略 */ }
            patchedMethods.push('LingshuBridge.callTool');
        }
    }
    catch (err) {
        warnOnce(logger, 'patch:callTool', `lingshu-mute: 无法接管 LingshuBridge.callTool（工具面写入不受拦，其余照常）: ${err?.message ?? err}`);
    }

    rec.installed = patchedMethods.length > 0;
    rec.mdcgProto = proto;
    rec.bridgeProto = LingshuBridge.prototype;
    rec.methods = patchedMethods;

    if (rec.installed) {
        logger.info(`lingshu-mute: 已接管灵枢写入门（${patchedMethods.join(', ')}；包目录 ${dir}）`);
        return { patched: true, methods: patchedMethods, dir };
    }
    warnOnce(logger, 'no-method', 'lingshu-mute: 灵枢写入门接管失败（未找到可 patch 的方法）——已降级为仅注入过滤 + 状态开关');
    return { patched: false, reason: 'no-method' };
}

/** 测试用：清掉 patch 记录与告警去重（**不还原原型**——进程内测试专用）。 */
export function resetGateForTests() {
    try {
        delete globalThis[PATCH_SYMBOL];
    }
    catch {
        globalThis[PATCH_SYMBOL] = undefined;
    }
    warnedKeys.clear();
    try { resetMuteState(); } catch { /* ignore */ }
}

// ── ④ HTTP（GUI 开关）──────────────────────────────────────────────────────

/** 挂载 `/plugins/lingshu-mute` 前缀路由（webServer 迟到也能自愈）。 */
function mountHttp(ctx, logger, cfg) {
    const handler = createMuteHandler({
        getConnection: () => safeGet(ctx, 'connection'),
        getSessions: () => safeGet(ctx, 'sessions'),
        logger,
        getGate: gateStatus,
        getWorkspaceRegistry: () => safeGet(ctx, 'workspaceRegistry'),
        getActiveSession: () => getActiveSession(),
        config: { excludeWorkspaces: Array.isArray(cfg.excludeWorkspaces) ? cfg.excludeWorkspaces : [] },
    });
    const register = (web, label) => {
        try {
            if (!web || typeof web.register !== 'function') return undefined;
            const dispose = web.register({ kind: 'prefix', path: MUTE_HTTP_PREFIX, handler });
            logger.info(`lingshu-mute: 已挂载 ${MUTE_HTTP_PREFIX}（${label}）`);
            return dispose;
        }
        catch (err) {
            warnOnce(logger, 'http-register', `lingshu-mute: 挂载 ${MUTE_HTTP_PREFIX} 失败（GUI 开关不可用，斜杠命令仍可用）: ${err?.message ?? err}`);
            return undefined;
        }
    };
    const immediate = safeGet(ctx, 'webServer');
    if (immediate) {
        safeEffect(ctx, () => register(immediate, 'immediate'), 'lingshu-mute: http route');
        return;
    }
    // 服务晚到：ctx.inject 等 webServer 就绪后再挂（cordis 的服务感知子上下文）
    try {
        if (typeof ctx.inject === 'function') {
            ctx.inject(['webServer'], (scoped) => {
                const web = safeGet(scoped, 'webServer');
                if (web) safeEffect(scoped, () => register(web, 'late'), 'lingshu-mute: http route');
            });
            return;
        }
    }
    catch { /* 落到下面的告警 */ }
    warnOnce(logger, 'no-web', 'lingshu-mute: webServer 服务不可用——GUI 静音开关不可用（斜杠命令 /mute 仍可用）');
}

// ── ⑤ 斜杠命令 ─────────────────────────────────────────────────────────────

/** 挂载 `/mute` 命令（GUI 之外的兜底通道）。 */
function mountCommand(ctx, logger) {
    const register = (scoped) => {
        const commands = safeGet(scoped, 'commands');
        if (!commands || typeof commands.register !== 'function') return undefined;
        try {
            const dispose = commands.register({
                name: 'mute',
                description: '切换灵枢记忆状态：/mute on|off|noread|status|list [session|workspace] [path] [--json]（on=静音 / noread=不读记忆 / off=恢复）',
                handler: (invocation) => handleMuteCommand(invocation, {
                    getWorkspaceRegistry: () => safeGet(scoped, 'workspaceRegistry'),
                    getSessions: () => safeGet(scoped, 'sessions'),
                }),
            });
            logger.info('lingshu-mute: 已注册斜杠命令 /mute');
            return dispose;
        }
        catch (err) {
            warnOnce(logger, 'command-register', `lingshu-mute: 注册 /mute 命令失败: ${err?.message ?? err}`);
            return undefined;
        }
    };
    const immediate = safeGet(ctx, 'commands');
    if (immediate) {
        safeEffect(ctx, () => register(ctx), 'lingshu-mute: /mute command');
        return;
    }
    try {
        if (typeof ctx.inject === 'function') {
            ctx.inject(['commands'], (scoped) => {
                if (safeGet(scoped, 'commands')) safeEffect(scoped, () => register(scoped), 'lingshu-mute: /mute command');
            });
        }
    }
    catch { /* 无 commands 服务：静默（本命令只是兜底通道） */ }
}

/** 命令结果的 JSON 模式：单行 JSON（**这就是隐藏的数据通道**：`command/run` 是 log-only，不刷聊天）。 */
const JSON_FLAG = '--json';

/** 解析 `/mute` 的机器可读参数：`status|list|on|off|noread [session|workspace] [path...] [--json]`。
 *  on = 静音（记忆关）；noread = 不读记忆（在静音基础上再禁读）；off = 恢复（记忆开）。 */
export function parseMuteCommand(rawInput) {
    const raw = typeof rawInput === 'string' ? rawInput : '';
    // 容忍 `/mute …`、`/mute   …`、`mute …` 三种入口写法（命令面一般给 rawInput 不带斜杠，但手输会带）
    const stripped = raw.replace(/^\s*\/?mute\b/i, '').trim();
    const tokens = stripped.length > 0 ? stripped.split(/\s+/).filter(Boolean) : [];
    const verbs = new Set(['on', 'off', 'noread', 'status', 'list']);
    const scopes = new Set(['session', 'workspace']);
    const positional = [];
    let json = false;
    for (const token of tokens) {
        if (token === JSON_FLAG) { json = true; continue; }
        if (token.startsWith('--')) return { action: '', scope: 'session', path: '', json, error: `未知参数「${token}」` };
        positional.push(token);
    }
    // verb = 首个非 `--` token（`/mute on session --json`、`/mute  off workspace /x --json` 都吃）
    let action = 'status';
    let index = 0;
    if (positional.length > 0) {
        const first = positional[0].toLowerCase();
        if (verbs.has(first)) { action = first; index = 1; }
        else return { action: '', scope: 'session', path: '', json, error: `无法识别的参数「${positional[0]}」——用法：/mute on|off|noread|status|list [session|workspace] [path] [--json]` };
    }
    let scope = 'session';
    if (positional.length > index && scopes.has(positional[index].toLowerCase())) {
        scope = positional[index].toLowerCase();
        index += 1;
    }
    const path = positional.slice(index).join(' ').trim();
    return { action, scope, path, json };
}

/** 组装机器可读状态：会话 / 当前工作区 / 工作区清单（含 title 与已静音数）/ 已静音会话。 */
export function muteCommandPayload(runtime, sessionLike) {
    const runtimeApi = runtime && typeof runtime === 'object' ? runtime : {};
    const fields = sessionFields(sessionLike);
    const gate = safeGate({ sessionId: fields.sessionId, cwd: fields.cwd });
    const snapshotState = snapshot();
    const mutedSessions = snapshotState.sessions || {};
    const mutedPaths = Object.keys(snapshotState.workspaces || {});
    const registryRows = workspaceRegistryRows(typeof runtimeApi.getWorkspaceRegistry === 'function' ? runtimeApi.getWorkspaceRegistry : () => undefined);

    const mutedCountOf = (path) => {
        if (!path) return 0;
        let n = 0;
        for (const [sid, entry] of Object.entries(mutedSessions)) {
            const cwd = (entry && entry.cwd) || '';
            if (cwd && (cwd === path || cwd.indexOf(path.replace(/[\\/]+$/, '') + '/') === 0)) n += 1;
        }
        return n;
    };

    const workspaceTitleOf = (cwd) => {
        let best = '';
        let bestLen = -1;
        for (const row of registryRows) {
            const base = row.path.replace(/[\\/]+$/, '');
            if (cwd === row.path || cwd.indexOf(base + '/') === 0) {
                if (base.length > bestLen) { best = row.title; bestLen = base.length; }
            }
        }
        return best;
    };

    const mutedWorkspaceState = (path) => {
        for (const key of mutedPaths) if (key === path) return { muted: true, key };
        for (const key of mutedPaths) {
            const base = key.replace(/[\\/]+$/, '');
            if (path && path.indexOf(base + '/') === 0) return { muted: true, key };
        }
        return { muted: false, key: '' };
    };

    const modeOfWorkspaceState = (path) => {
        for (const key of mutedPaths) {
            const base = key.replace(/[\\/]+$/, '');
            if (key === path || (path && path.indexOf(base + '/') === 0)) {
                return (snapshotState.workspaces?.[key]?.mode) || 'mute';
            }
        }
        return 'mute';
    };

    const workspaces = registryRows.map((row) => {
        const wsState = mutedWorkspaceState(row.path);
        return {
            title: row.title,
            path: row.path,
            muted: wsState.muted,
            mode: wsState.muted ? modeOfWorkspaceState(row.path) : null,
            mutedKey: wsState.key,
            mutedCount: mutedCountOf(row.path),
            sessionCount: Array.isArray(row.sessionIds) ? row.sessionIds.length : 0,
        };
    });

    const sessions = Object.keys(mutedSessions).map((sid) => {
        const entry = mutedSessions[sid] || {};
        const cwd = entry.cwd || '';
        return {
            id: sid,
            cwd,
            at: entry.at || '',
            muted: true,
            mode: entry.mode || 'mute',
            title: null,
            workspaceTitle: cwd ? workspaceTitleOf(cwd) : '',
        };
    });

    const workspace = normalizeWorkspacePath(fields.cwd)
        ? (() => {
            const state = mutedWorkspaceState(normalizeWorkspacePath(fields.cwd));
            return {
                path: normalizeWorkspacePath(fields.cwd),
                muted: state.muted,
                mode: state.muted ? modeOfWorkspaceState(normalizeWorkspacePath(fields.cwd)) : null,
                mutedKey: state.key,
            };
        })()
        : null;

    const activeRow = getActiveSession();
    const activeGate = activeRow.id ? safeGate({ sessionId: activeRow.id, cwd: activeRow.cwd }) : null;
    const activeMuted = !!activeGate && activeGate.scope === 'session';
    const sessionMuted = gate.scope === 'session';

    return {
        ok: true,
        version: MODULE_VERSION,
        active: activeRow.id
            ? {
                id: activeRow.id,
                cwd: activeRow.cwd || '',
                at: activeRow.at || '',
                muted: activeMuted,
                mode: activeMuted ? activeGate.mode : null,
                title: activeRow.title || null,
                workspaceTitle: activeRow.cwd ? workspaceTitleOf(activeRow.cwd) : '',
            }
            : null,
        session: {
            id: fields.sessionId || null,
            muted: sessionMuted,
            mode: sessionMuted ? gate.mode : null,
            reason: gate.reason || null,
            cwd: normalizeWorkspacePath(fields.cwd) || null,
        },
        workspace,
        workspaces,
        sessions,
        staticWorkspaces: snapshotState.staticWorkspaces || [],
        updatedAt: snapshotState.updatedAt || '',
    };
}

/** `/mute` 命令实现（GUI 的**主通道**）：人类可读输出 + `--json` 单行 JSON。
 *
 *  JSON 模式给客户端用（App 里 `fetch('/plugins/…')` 被 scheme/CORS 挡掉，见 README §4.2）。
 *  `runtime` 由 index.js 的 mountCommand 注入（`getWorkspaceRegistry` / `getSessions`）。
 */
export async function handleMuteCommand(invocation, runtime) {
    const parsed = parseMuteCommand(typeof invocation?.rawInput === 'string' ? invocation.rawInput : '');
    if (parsed.error) {
        return parsed.json
            ? { kind: 'success', text: JSON.stringify({ ok: false, error: parsed.error }) }
            : { kind: 'error', text: parsed.error };
    }
    const invocationSession = invocation?.agent?.session;
    const invocationFields = sessionFields(invocationSession);
    const activeRow = getActiveSession();
    // 命令没带会话（很多客户端 RPC 场景就是空的）→ 落到服务端认定的「最近活跃会话」
    const sessionLike = invocationFields.sessionId
        ? invocationSession
        : (activeRow.id ? { id: activeRow.id, header: { cwd: activeRow.cwd } } : invocationSession);
    const fields = sessionFields(sessionLike);
    const runtimeApi = runtime && typeof runtime === 'object' ? runtime : {};

    const respond = (payload, humanText) => ({
        kind: 'success',
        text: parsed.json ? JSON.stringify(payload) : humanText,
    });
    const fail = (message) => {
        if (parsed.json) return { kind: 'success', text: JSON.stringify({ ok: false, error: message }) };
        return { kind: 'error', text: message };
    };

    if ((parsed.action === 'status' || parsed.action === 'list') && parsed.path) {
        return fail(`无法识别的参数「${parsed.path}」——用法：/mute on|off|noread|status|list [session|workspace] [path] [--json]`);
    }
    if (parsed.action === 'status' || parsed.action === 'list') {
        const payload = muteCommandPayload(runtimeApi, sessionLike);
        if (parsed.json) return respond(payload, '');
        const lines = [];
        if (parsed.action === 'status') {
            const activeId = payload.active && payload.active.id ? String(payload.active.id) : '';
            const activeShort = activeId.replace(/^session-/, '').slice(0, 8);
            const labelOf = (row) => (row.mode === MODE_NO_READ ? '不读记忆' : '已静音');
            lines.push(activeId
                ? `当前对话：${activeShort}（${payload.active.muted ? labelOf(payload.active) : '记录中'}）`
                : '当前对话：（还没有活跃对话）');
            lines.push(`本次对话：${payload.session.muted ? labelOf(payload.session) : '正常'}`);
            lines.push(`当前工作区：${payload.workspace ? (payload.workspace.path + (payload.workspace.muted ? '（' + labelOf(payload.workspace) + '）' : '')) : '（无）'}`);
        }
        lines.push('工作区：');
        for (const ws of payload.workspaces) lines.push(`  ${ws.title} — ${ws.path}${ws.muted ? (ws.mode === MODE_NO_READ ? ' [不读记忆]' : ' [静音中]') : ''}${ws.mutedCount ? `（${ws.mutedCount} 个对话已静音）` : ''}`);
        lines.push(`已静音会话：${payload.sessions.length} 个`);
        for (const row of payload.sessions) lines.push(`  ${row.workspaceTitle || '（无工作区）'} · ${String(row.id).slice(0, 8)}`);
        lines.push(`状态文件：${muteFilePath()}`);
        return { kind: 'success', text: lines.join('\n') };
    }

    if (parsed.action !== 'on' && parsed.action !== 'off' && parsed.action !== 'noread') {
        return fail('用法：/mute on|off|noread|status|list [session|workspace] [path] [--json]');
    }
    const turnOn = parsed.action !== 'off';
    const mode = parsed.action === 'noread' ? MODE_NO_READ : 'mute';
    const actionLabel = parsed.action === 'noread' ? '不读记忆' : (turnOn ? '静音' : '恢复');

    if (parsed.scope === 'session') {
        if (!fields.sessionId) return fail('拿不到当前会话标识，无法切换静音（GUI 开关同样依赖会话 id）');
        await setSessionMute(fields.sessionId, turnOn, fields.cwd, mode);
        const payload = muteCommandPayload(runtimeApi, sessionLike);
        if (parsed.json) return respond(payload, '');
        return { kind: 'success', text: `本次对话已设为「${actionLabel}」。\n${statusText(fields)}` };
    }

    // workspace：on 只允许「注册表里的真实工作区」或当前会话 cwd；off 允许表里已存在的路径
    const requested = normalizeWorkspacePath(parsed.path)
        || normalizeWorkspacePath(fields.cwd)
        || '';
    if (!turnOn) {
        if (requested) {
            await setWorkspaceMute(requested, false);
            const payload = muteCommandPayload(runtimeApi, sessionLike);
            if (parsed.json) return respond(payload, '');
            return { kind: 'success', text: `已恢复本工作区的记忆（${requested}）。\n${statusText(fields)}` };
        }
        return fail('缺少工作区路径：/mute off workspace <path> --json');
    }
    const registered = requested
        ? registeredWorkspacePath(typeof runtimeApi.getWorkspaceRegistry === 'function' ? runtimeApi.getWorkspaceRegistry : () => undefined, requested)
        : '';
    if (!registered) {
        return fail(requested
            ? `「${requested}」不是宿主的真实工作区，拒绝静音（安全边界）`
            : '拿不到工作区路径：/mute on workspace <path> --json');
    }
    await setWorkspaceMute(registered, true, mode);
    const payload = muteCommandPayload(runtimeApi, sessionLike);
    if (parsed.json) return respond(payload, '');
    return { kind: 'success', text: `本工作区已设为「${actionLabel}」（${registered}）。\n${statusText(fields)}` };
}

/** 人类可读的两行状态（非 JSON 模式用）。 */
function statusText(fields) {
    const gate = safeGate({ sessionId: fields.sessionId, cwd: fields.cwd });
    const ws = workspaceMuteInfo(fields.cwd);
    const modeLabel = (m) => (m === MODE_NO_READ ? '不读记忆' : '静音中');
    const sessionLine = `本次对话：${gate.scope === 'session' ? modeLabel(gate.mode) : '正常'}`;
    const wsLine = `本工作区（${ws.path || fields.cwd || '未知路径'}）：${ws.muted ? modeLabel(ws.mode) : (ws.static ? '静态配置排除' : '正常')}`;
    return `${sessionLine}\n${wsLine}\n状态文件：${muteFilePath()}`;
}

/** 供 HTTP / 测试复用的快照（与 mute_state.snapshot 同一对象）。 */
export { snapshot };
