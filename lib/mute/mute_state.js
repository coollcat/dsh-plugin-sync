/**
 * mute_state.js —— 「本次对话不记记忆 / 本工作区不记记忆」的**静音表**（独立插件 lingshu-mute）
 *
 * 本模块只回答一个问题：「这个会话 / 这个工作区现在是否静音」，**不碰任何记忆写入逻辑**。
 * 写入闸口在 lib/index.js（MdcgClient/LingshuBridge 的原型拦截）、注入闸口在同一文件的
 * system-prompt/assemble 监听里——行为单点可审计。
 *
 * 与灵枢内置版本（0.9.18 的 lib/lib/mute_state.ts）的关键差异：
 *   · **零灵枢依赖**：不再 import `./datapath.js` 的 stateRoot()，状态根按
 *     `MDCG_MUTE_FILE` → `$DSH_HOME` → `~/.dsh` 自行解析（见 muteFilePath()）；
 *   · 增加 `workspaces` 桶的容量上限（与 sessions 同一个 500 条 / 按 at 淘汰）；
 *   · 日志走可注入的 logger（`configureMute({ logger })`），宿主 ctx.logger 缺省回落 console。
 *
 * 状态文件（version 1）：
 * ```json
 * {
 *   "version": 1,
 *   "sessions":   { "<sid>": { "at": "ISO", "cwd": "/abs" } },
 *   "workspaces": { "/abs":  { "at": "ISO" } },
 *   "updatedAt": "ISO"
 * }
 * ```
 *
 * 纪律（逐条对应验收项）：
 *   ① **原子写**：同目录 `<file>.<pid>.<rand>.tmp` + `rename`（读者永不看到半截 JSON）；
 *   ② **读失败 / 坏 JSON → 当空**（fail-open：**不静音**，宁可多记不可静默丢记忆），
 *      同一类告警同进程只打一次（防每事件刷屏）；
 *   ③ **写串行**：进程内 Promise 链，后写排队等前写落盘（不允许两次 rename 乱序）；
 *   ④ **mtime 缓存**：同进程读多写少——`statSync` 按 RECHECK_MS 节流，`mtime+size`
 *      未变就不重读；运行时开关在本进程直接改内存并落盘，GUI 点完立刻生效；
 *   ⑤ **有界**：sessions / workspaces 各 500 条（超出按 at 淘汰最旧）；会话条目
 *      30 天过期（加载时惰性清理，有变化则写回）；
 *   ⑥ **路径匹配**：`path.resolve` 规范化、去尾斜杠；命中 = 相等 或 `条目 + 分隔符`
 *      开头（`/a/b` 命中 `/a/b/c` 但**不**命中 `/a/bc`）；空串 / `/` / `C:\` 一律忽略；
 *      Windows 上大小写不敏感（win32 折平），POSIX 保持大小写敏感。
 *
 * 边界（如实，勿当保证读）：
 *   · 多进程同时写**同一** mute.json 时以最后一次 rename 为准；跨进程外部修改靠 mtime
 *     节流感知（最多 RECHECK_MS 延迟）；
 *   · 会话静音按 **sid 精确匹配**（不按 cwd 扩散）；工作区静音对所有 `header.cwd`
 *     落在该前缀下的会话生效（含子会话）；
 *   · 匹配是**字面前缀**，不做 realpath / 符号链接解析；
 *   · 本模块**不判定权限**：静音是使用者对自己记忆的显式暂停，不是安全边界。
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * 静音模式（version 1 的条目**可选** `mode` 字段；缺省 = 'mute'，向后兼容旧状态文件）：
 *   · 'mute'    = 记忆关：不写入、不注入；仍允许主动读（cg/stg 读 op、recall 等）。
 *   · 'no_read' = 不读记忆：在静音基础上再禁掉**一切**记忆读取（注入 + 工具面读调用）。
 */
export const MODE_MUTE = 'mute';
export const MODE_NO_READ = 'no_read';
const VALID_MODES = new Set([MODE_MUTE, MODE_NO_READ]);

/** 模式归一：未知/缺省一律 'mute'（fail-open 到较宽松的那档）。 */
function normalizeMode(raw) {
    return VALID_MODES.has(raw) ? raw : MODE_MUTE;
}

/** 状态文件版本（结构变更必须升版本；非本版本按空态处理，fail-open）。 */
const VERSION = 1;
/** 状态文件名（位于 `<状态根>/.dsh-memory/` 下）。 */
const FILE_NAME = 'mute.json';
/** 状态根目录名（与灵枢既有的用户级状态根同名，便于人工排查）。 */
const STATE_DIR_NAME = '.dsh-memory';
/** sessions / workspaces 各自的容量上限（超出按 at 淘汰最旧）。 */
const MAX_SESSIONS = 500;
const MAX_WORKSPACES = 500;
/** 会话静音条目自动过期时长：30 天。 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** mtime 复检节流（毫秒）：同进程读多写少，每事件都 stat 不值得。 */
const RECHECK_MS = 1000;
/** 会话 → cwd 的进程内缓存上限（也用于「最近观测会话」的回落判据）。 */
const MAX_CWD_CACHE = 1000;
/** 静态配置里的工作区条目上限（防配置失手写进几万条）。 */
const MAX_STATIC = 200;
/** 单条路径最大长度（防异常输入把文件撑大）。 */
const MAX_PATH_CHARS = 4096;

/** 空态（一律深拷贝新对象，绝不共享引用）。 */
function emptyState() {
    return { version: VERSION, sessions: {}, workspaces: {}, updatedAt: '' };
}

/** 可注入 logger（宿主 ctx.logger；缺省 console）。 */
let logger = null;
/** 显式 statePath 覆盖（configureMute 传入，测试 / 自定义部署用）。 */
let statePathOverride = '';
/** 静态配置（工作区前缀，来源 config.excludeWorkspaces）。 */
let staticWorkspaces = [];
/** 进程内状态（null = 尚未加载）。 */
let state = null;
/** 是否已尝试过加载（区分「没读过」与「读过但是空」）。 */
let loaded = false;
/** 上次 stat 复检时间（节流用）。 */
let lastCheck = 0;
/** 已加载盘面的签名（mtimeMs:size）；用它判断是否需要重读。 */
let lastSignature = '';
/** 已告警过的键（同一类告警同进程只打一次，防日志刷屏）。 */
const warned = new Set();
/** 写操作串行链（Promise 链：后写排队等前写完成）。 */
let writeChain = Promise.resolve();
/** sid → cwd 的进程内缓存（Map 插入序 = LRU 顺序；末尾 = 最近观测）。 */
const cwdCache = new Map();

/** 状态根目录（`MDCG_MUTE_FILE` 直接给文件；否则按 DSH_HOME / ~/.dsh 拼）。 */
export function stateRootDir() {
    const fromEnv = readEnv('MDCG_MUTE_FILE');
    if (fromEnv) return dirname(resolve(fromEnv));
    const home = readEnv('DSH_HOME');
    if (home) return join(resolve(home), STATE_DIR_NAME);
    return join(homedir(), '.dsh', STATE_DIR_NAME);
}

/** 当前状态文件路径（`configureMute({ statePath })` 供测试 / 自定义部署覆盖）。 */
export function muteFilePath() {
    if (statePathOverride) return statePathOverride;
    const fromEnv = readEnv('MDCG_MUTE_FILE');
    if (fromEnv) return resolve(fromEnv);
    return join(stateRootDir(), FILE_NAME);
}

function readEnv(name) {
    try {
        const v = process.env?.[name];
        return typeof v === 'string' && v.trim() ? v.trim() : '';
    }
    catch {
        return '';
    }
}

/** 同类告警同进程只打一次（防刷屏；静音表本身必须继续工作）。 */
function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    try {
        if (logger && typeof logger.warn === 'function') logger.warn(message);
        else console.warn(message);
    }
    catch { /* 日志面不可用时忽略 */ }
}

/**
 * 工作区路径规范化（**匹配判据单点**）：
 *   · 非字符串 / trim 后空串 / 超长 → 空串（= 不参与匹配）；
 *   · `/`、`\`、`C:`、`C:\` 等**根**一律忽略（否则一条静音会把整机吞掉）；
 *   · 其余 `path.resolve` 规范化并去尾分隔符（根除外）；非法输入 → 空串。
 * 规范化是**幂等**的：`normalize(normalize(x)) === normalize(x)`。
 */
export function normalizeWorkspacePath(raw) {
    if (typeof raw !== 'string') return '';
    const value = raw.trim();
    if (!value || value.length > MAX_PATH_CHARS) return '';
    if (/^[A-Za-z]:[\\/]?$/.test(value)) return '';
    if (value === '/' || value === '\\') return '';
    let resolved;
    try {
        resolved = resolve(value);
    }
    catch {
        return '';
    }
    if (!resolved) return '';
    while (resolved.length > 1 && (resolved.endsWith('/') || resolved.endsWith('\\'))) {
        const trimmed = resolved.slice(0, -1);
        if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) {
            resolved = trimmed;
            break;
        }
        resolved = trimmed;
    }
    if (resolved === '/' || resolved === '\\') return '';
    if (/^[A-Za-z]:[\\/]?$/.test(resolved)) return '';
    return resolved;
}

/** win32 上路径大小写不敏感（NTFS 默认）——判据折叠用；POSIX 保持原样。 */
function foldPath(p) {
    return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * 「cwd 是否落在 entry 这个工作区内」——**前缀边界单点**。
 * 相等 → 命中；`entry + 分隔符` 开头 → 命中。因此 `/a/b` 命中 `/a/b`、`/a/b/c`，
 * 但**不**命中 `/a/bc`。空 cwd / 空 entry → 不命中。
 */
export function pathInWorkspace(cwd, entry) {
    const a = normalizeWorkspacePath(cwd);
    const b = normalizeWorkspacePath(entry);
    if (!a || !b) return false;
    const fa = foldPath(a);
    const fb = foldPath(b);
    if (fa === fb) return true;
    return fa.startsWith(fb + '/') || fa.startsWith(fb + '\\');
}

/** 盘面内容 → 状态（**不信任盘面**：逐字段校验，形态不符的条目丢弃）。 */
function sanitizeState(raw) {
    const s = emptyState();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
    // 版本不认识 → 按空态（fail-open：宁可多记，不可因结构升级而静默静音）。
    if (raw.version !== undefined && raw.version !== VERSION) return s;
    const sessions = raw.sessions;
    if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
        for (const [sid, item] of Object.entries(sessions)) {
            if (typeof sid !== 'string' || !sid.trim() || sid.length > 512) continue;
            if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
            const at = typeof item.at === 'string' ? item.at : '';
            if (!Number.isFinite(Date.parse(at))) continue;
            const cwd = normalizeWorkspacePath(item.cwd);
            const entry = cwd ? { at, cwd } : { at };
            // 只有非缺省模式才落字段，避免给存量文件平白写入一堆 `mode:'mute'`。
            if (normalizeMode(item.mode) === MODE_NO_READ) entry.mode = MODE_NO_READ;
            s.sessions[sid.trim()] = entry;
        }
    }
    const workspaces = raw.workspaces;
    if (workspaces && typeof workspaces === 'object' && !Array.isArray(workspaces)) {
        for (const [path, item] of Object.entries(workspaces)) {
            const normalized = normalizeWorkspacePath(path);
            if (!normalized) continue;
            const at = item && typeof item === 'object' && typeof item.at === 'string' ? item.at : '';
            const entry = { at: Number.isFinite(Date.parse(at)) ? at : new Date(0).toISOString() };
            if (normalizeMode(item && item.mode) === MODE_NO_READ) entry.mode = MODE_NO_READ;
            s.workspaces[normalized] = entry;
        }
    }
    if (typeof raw.updatedAt === 'string') s.updatedAt = raw.updatedAt;
    return s;
}

/** 过期清理 + 容量淘汰（sessions / workspaces 各自 500 条）。返回是否发生删除。 */
function pruneState(now = Date.now()) {
    let changed = false;
    for (const [sid, item] of Object.entries(state.sessions)) {
        const at = Date.parse(item.at);
        if (!Number.isFinite(at) || now - at > SESSION_TTL_MS) {
            delete state.sessions[sid];
            changed = true;
        }
    }
    for (const [bucket, max] of [['sessions', MAX_SESSIONS], ['workspaces', MAX_WORKSPACES]]) {
        const keys = Object.keys(state[bucket]);
        if (keys.length <= max) continue;
        keys.sort((a, b) => Date.parse(state[bucket][a].at) - Date.parse(state[bucket][b].at));
        for (const key of keys.slice(0, keys.length - max)) {
            delete state[bucket][key];
            changed = true;
        }
    }
    return changed;
}

/** 把内存态落盘（原子写；串行；失败只告警）。返回 Promise（测试可 await）。
 *
 * `allowEmpty`：允许写入「空表」（显式解除最后一项时用）。
 * **默认拒绝用空表覆盖非空盘面**——进程内状态可能是旧的/被 reset 过的（热重载会再 apply 一次，
 * 极端情况下多个模块实例各有内存态），一次空写就会把用户的静音清单抹掉（2026-11-08 真实发生过）。
 */
function persist(allowEmpty = false) {
    const file = muteFilePath();
    if (!allowEmpty && isEmptyState(state) && fileHasEntries(file)) {
        warnOnce('empty-overwrite', 'lingshu-mute: 拒绝用空表覆盖非空的静音状态文件（防误清空）');
        return Promise.resolve();
    }
    const body = JSON.stringify(state, null, 2) + '\n';
    const run = () => {
        try {
            mkdirSync(dirname(file), { recursive: true });
            const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
            writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
            renameSync(tmp, file);
            try {
                const st = statSync(file);
                lastSignature = `${st.mtimeMs}:${st.size}`;
            }
            catch { /* 签名读失败不影响写入成功 */ }
            lastCheck = Date.now();
        }
        catch (err) {
            warnOnce('write', `lingshu-mute: 静音状态写入失败（运行期静音仍生效，重启后会丢失）: ${err?.message ?? err}`);
        }
    };
    writeChain = writeChain.then(run, run);
    return writeChain;
}

/** 内存态是否为空（没有任何会话/工作区静音）。 */
function isEmptyState(candidate) {
    try {
        const sessions = candidate && candidate.sessions ? Object.keys(candidate.sessions).length : 0;
        const workspaces = candidate && candidate.workspaces ? Object.keys(candidate.workspaces).length : 0;
        return sessions === 0 && workspaces === 0;
    }
    catch {
        return false;
    }
}

/** 盘面当前是否有条目（读不到/坏 JSON 一律当作「有」，宁可拒绝写也不误清空）。 */
function fileHasEntries(file) {
    try {
        const parsed = JSON.parse(readFileSync(file, 'utf8'));
        const sessions = parsed && parsed.sessions ? Object.keys(parsed.sessions).length : 0;
        const workspaces = parsed && parsed.workspaces ? Object.keys(parsed.workspaces).length : 0;
        return sessions > 0 || workspaces > 0;
    }
    catch {
        return false;
    }
}

/** 从盘面读一份（失败/坏 JSON → 空态 + 告警一次）。 */
function readDisk() {
    const file = muteFilePath();
    try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        return sanitizeState(raw);
    }
    catch (err) {
        warnOnce('bad-json', `lingshu-mute: 静音状态文件损坏（按“未静音”处理，下次写入会重建）: ${file} ${err?.message ?? err}`);
        return emptyState();
    }
}

/** 读取当前签名（文件不存在 → 空串）。 */
function signatureOf() {
    try {
        const st = statSync(muteFilePath());
        return `${st.mtimeMs}:${st.size}`;
    }
    catch {
        return '';
    }
}

/** 确保内存态已加载且与盘面同步（mtime 节流）。force=true 无视节流。 */
function ensureLoaded(force = false) {
    const now = Date.now();
    if (loaded && !force && now - lastCheck < RECHECK_MS) return state;
    lastCheck = now;
    const signature = signatureOf();
    if (loaded && signature === lastSignature) return state;
    lastSignature = signature;
    state = signature ? readDisk() : emptyState();
    loaded = true;
    if (pruneState(now)) {
        state.updatedAt = new Date(now).toISOString();
        void persist();
    }
    return state;
}

/**
 * 配置（插件 apply 时调用；热重载会再调一次 = 覆盖）。
 *
 * - `excludeWorkspaces`：工作区前缀数组（空串 / 根目录条目**忽略并告警**）；
 * - `statePath`：覆盖状态文件路径（测试 / 自定义部署；空串 = 回到默认解析）；
 * - `logger`：宿主 ctx.logger（缺省 console）。
 *
 * 返回当前快照（便于启动日志留痕）。
 */
export function configureMute(options = {}) {
    if (options && typeof options.logger === 'object' && options.logger) logger = options.logger;
    if (options && typeof options.statePath === 'string') {
        statePathOverride = options.statePath.trim();
        // 换文件 = 换数据源：清空进程内缓存，下次读重新加载。
        state = null;
        loaded = false;
        lastSignature = '';
        lastCheck = 0;
    }
    if (options && options.excludeWorkspaces !== undefined) {
        const list = Array.isArray(options.excludeWorkspaces) ? options.excludeWorkspaces : [];
        const next = [];
        for (const raw of list) {
            if (next.length >= MAX_STATIC) {
                warnOnce('static-limit', `lingshu-mute: excludeWorkspaces 条目超过 ${MAX_STATIC} 条，其余忽略`);
                break;
            }
            const normalized = normalizeWorkspacePath(raw);
            if (!normalized) {
                warnOnce(`static-bad:${String(raw)}`, `lingshu-mute: excludeWorkspaces 条目被忽略（空串 / 根目录 / 非法路径）: ${String(raw)}`);
                continue;
            }
            if (!next.includes(normalized)) next.push(normalized);
        }
        staticWorkspaces = next;
    }
    return snapshot();
}

/** 记录一次「会话 → cwd」观测（不落盘；Map 插入序即 LRU）。 */
export function noteSessionCwd(sid, cwd) {
    if (typeof sid !== 'string' || !sid.trim()) return;
    const normalized = normalizeWorkspacePath(cwd);
    if (!normalized) return;
    const key = sid.trim();
    cwdCache.delete(key);
    cwdCache.set(key, normalized);
    while (cwdCache.size > MAX_CWD_CACHE) {
        const oldest = cwdCache.keys().next().value;
        if (oldest === undefined) break;
        cwdCache.delete(oldest);
    }
}

/** 取进程内缓存的会话 cwd（空串 = 未观测到）。 */
export function sessionCwdOf(sid) {
    if (typeof sid !== 'string') return '';
    return cwdCache.get(sid.trim()) ?? '';
}

/** 最近一次观测到的会话 id（空串 = 未观测到任何会话）。 */
export function lastObservedSession() {
    let last = '';
    for (const key of cwdCache.keys()) last = key;
    return last;
}

/** 这个会话是否被静音（只判会话表）。 */
export function isMutedSession(sid) {
    if (typeof sid !== 'string' || !sid.trim()) return false;
    ensureLoaded();
    return Object.prototype.hasOwnProperty.call(state.sessions, sid.trim());
}

/** 这个工作区是否被静音（运行时表 + 静态配置**同等对待**）。 */
export function isMutedWorkspace(cwd) {
    return workspaceMuteInfo(cwd).muted;
}

/** 工作区静音的**明细**（GUI 要区分「运行时可关」与「静态配置不可关」）。
 *  mode：命中多条运行时条目时取**最严**的（no_read 优先），静态配置恒为 mute。 */
export function workspaceMuteInfo(cwd) {
    const path = normalizeWorkspacePath(cwd);
    if (!path) return { muted: false, mode: null, noRead: false, path: null, runtime: false, static: false, reason: null };
    ensureLoaded();
    let runtime = false;
    let mode = MODE_MUTE;
    for (const entry of Object.keys(state.workspaces)) {
        if (pathInWorkspace(path, entry)) {
            runtime = true;
            if (normalizeMode(state.workspaces[entry]?.mode) === MODE_NO_READ) mode = MODE_NO_READ;
        }
    }
    let fixed = false;
    for (const entry of staticWorkspaces) {
        if (pathInWorkspace(path, entry)) {
            fixed = true;
            break;
        }
    }
    const muted = runtime || fixed;
    return {
        muted, mode: muted ? mode : null, noRead: muted && mode === MODE_NO_READ,
        path, runtime, static: fixed, reason: muted ? 'muted_workspace' : null,
    };
}

/**
 * **总闸判据单点**：给定会话标识与工作区路径，回答「要不要静音、按什么原因」。
 *
 * 优先级：会话 > 运行时工作区 > 静态 excludeWorkspaces（同时命中时报最精确的那个）。
 * `cwd` 缺失时回落进程内 noteSessionCwd 缓存；**会话静音绝不因 cwd 缺失而漏判**。
 */
export function resolveGate(input = {}) {
    const sessionId = typeof input?.sessionId === 'string' ? input.sessionId.trim() : '';
    const explicitCwd = typeof input?.cwd === 'string' ? input.cwd : '';
    const cwd = normalizeWorkspacePath(explicitCwd) || (sessionId ? sessionCwdOf(sessionId) : '');
    ensureLoaded();
    if (sessionId && Object.prototype.hasOwnProperty.call(state.sessions, sessionId)) {
        const mode = normalizeMode(state.sessions[sessionId]?.mode);
        return {
            muted: true, mode, noRead: mode === MODE_NO_READ, scope: 'session', reason: 'muted_session',
            sessionId, workspacePath: cwd || null, runtime: true, static: false,
        };
    }
    const ws = workspaceMuteInfo(cwd);
    if (ws.muted) {
        return {
            muted: true, mode: ws.mode, noRead: ws.noRead, scope: 'workspace', reason: 'muted_workspace',
            sessionId, workspacePath: ws.path, runtime: ws.runtime, static: ws.static,
        };
    }
    return {
        muted: false, mode: null, noRead: false, scope: null, reason: null,
        sessionId, workspacePath: cwd || null, runtime: false, static: false,
    };
}

/**
 * 直接从**宿主 Session 对象**解析闸口（注入面 / 命令面共用）。
 * 字段口径：`Session.id`（或 `sessionId`）与 `Session.header.cwd`；任一缺失按空处理。
 * **无 sid → 一定不静音**（fail-open：拿不到会话就不拦，不猜）。
 */
export function resolveGateForSession(session) {
    const raw = session && typeof session === 'object' ? session : null;
    const header = raw?.header && typeof raw.header === 'object' ? raw.header : null;
    const id = raw?.id ?? raw?.sessionId;
    const sessionId = typeof id === 'string' ? id.trim() : '';
    const cwd = header && typeof header.cwd === 'string' ? header.cwd.trim() : '';
    return resolveGate({ sessionId, cwd });
}

/** 设置 / 取消**会话**静音（`cwd` 可选，仅用于留痕与后续工作区判据回落）。
 *  `mode` 可选：'mute'（缺省）| 'no_read'；仅非缺省模式落盘，且保留原 `at`（避免改模式重置 TTL）。 */
export function setSessionMute(sid, on, cwd, mode) {
    if (typeof sid !== 'string' || !sid.trim()) return Promise.resolve(snapshot());
    const key = sid.trim();
    ensureLoaded(true);
    if (on) {
        const prev = state.sessions[key];
        const entry = { at: (prev && prev.at) || new Date().toISOString() };
        const normalized = normalizeWorkspacePath(cwd) || sessionCwdOf(key) || (prev && prev.cwd) || '';
        if (normalized) entry.cwd = normalized;
        if (normalizeMode(mode) === MODE_NO_READ) entry.mode = MODE_NO_READ;
        state.sessions[key] = entry;
        if (normalized) noteSessionCwd(key, normalized);
    }
    else {
        delete state.sessions[key];
    }
    state.updatedAt = new Date().toISOString();
    pruneState();
    return persist(true).then(() => snapshot());
}

/** 设置 / 取消**工作区**静音（路径非法 → 空操作，返回当前快照）。`mode` 语义同 setSessionMute。 */
export function setWorkspaceMute(cwd, on, mode) {
    const normalized = normalizeWorkspacePath(cwd);
    if (!normalized) return Promise.resolve(snapshot());
    ensureLoaded(true);
    if (on) {
        const prev = state.workspaces[normalized];
        const entry = { at: (prev && prev.at) || new Date().toISOString() };
        if (normalizeMode(mode) === MODE_NO_READ) entry.mode = MODE_NO_READ;
        state.workspaces[normalized] = entry;
    }
    else {
        // 同一真实工作区可能因尾斜杠/写法差异留下多条：把**语义等价**的条目一并删掉。
        for (const entry of Object.keys(state.workspaces)) {
            if (foldPath(entry) === foldPath(normalized)) delete state.workspaces[entry];
        }
    }
    state.updatedAt = new Date().toISOString();
    pruneState();
    return persist(true).then(() => snapshot());
}

/** 状态快照（只读副本；**不含任何敏感信息**——只有 sid、路径与时间戳）。 */
export function snapshot() {
    ensureLoaded();
    const sessions = {};
    for (const [sid, item] of Object.entries(state.sessions)) sessions[sid] = { ...item };
    const workspaces = {};
    for (const [path, item] of Object.entries(state.workspaces)) workspaces[path] = { ...item };
    return {
        version: VERSION,
        sessions,
        workspaces,
        staticWorkspaces: staticWorkspaces.slice(),
        updatedAt: state.updatedAt,
        file: muteFilePath(),
    };
}

/**
 * 清空进程内缓存（**仅供测试**与「状态文件被外部整体替换」的自愈场景）。
 *
 * ⚠️ 返回的是**空态快照**而不是「重新读一遍盘面」：读盘会被 RECHECK_MS 节流，
 * 若在这里顺手读一次，调用方随后改写盘面（测试写 fixture、或人工替换文件）
 * 会在节流窗口内读到旧值——这正是「reset 之后仍看不到新文件」的坑。
 * 下一次判定（isMutedSession / isMutedWorkspace / resolveGate / snapshot）会自己重新加载。
 */
export function resetMuteState() {
    state = null;
    loaded = false;
    lastSignature = '';
    lastCheck = 0;
    writeChain = Promise.resolve();
    cwdCache.clear();
    staticWorkspaces = [];
    statePathOverride = '';
    logger = null;
    warned.clear();
    return {
        version: VERSION,
        sessions: {},
        workspaces: {},
        staticWorkspaces: [],
        updatedAt: '',
        file: muteFilePath(),
    };
}

/** 导出内部常量（测试断言边界值用；不属于对外稳定 ABI）。 */
export const MUTE_LIMITS = Object.freeze({
    VERSION, MAX_SESSIONS, MAX_WORKSPACES, SESSION_TTL_MS, RECHECK_MS, MAX_STATIC, MAX_CWD_CACHE,
});

/** 供测试断言「规范化是否保留了绝对路径语义」（不属于对外稳定 ABI）。 */
export function isAbsoluteWorkspacePath(p) {
    const normalized = normalizeWorkspacePath(p);
    return !!normalized && isAbsolute(normalized);
}
