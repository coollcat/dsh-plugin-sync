/**
 * http.js —— 静音开关的 HTTP 外壳（GUI 小面板的读写入口）。
 *
 * 这里**只做**：鉴权（宿主 connection.admit）、CSRF、同源、content-type、体限、
 * 参数校验、以及「当前会话 → 工作区路径」的解析。**所有判定**都转发给
 * lib/mute_state.js（判据单点），本文件绝不另写一套匹配语义。
 *
 * 路由（挂在 webServer 的 prefix 上）：
 *   GET  /plugins/lingshu-mute/meta                          → {ok, csrf, state, gate, config}
 *   GET  /plugins/lingshu-mute/state?session=<sid>&cwd=<abs> → 静音状态
 *   GET  /plugins/lingshu-mute/list                           → 静音清单（会话/工作区/静态项）
 *   POST /plugins/lingshu-mute/toggle                        → {scope,action,sessionId?,cwd?} → 新状态
 *     action: 'on'(静音) | 'noread'(不读记忆) | 'off'(恢复)
 *
 * `list` 与 `toggle(off)` 的放宽（2026-11 追加）：设置面板没有当前会话上下文，只能按
 * **静音表里已经存在的条目**解除；`action:'on'` 的安全边界一点没放松。
 *
 * 安全纪律：
 *   · 读请求也要过 `connection.admit(req)`（拿不到该服务时降级为**同源校验**并 warn 一次）；
 *   · POST 额外要求 `x-lingshu-csrf`（timingSafeEqual）、同源、`application/json`、≤16 KB；
 *   · **工作区开关只允许作用于服务端按 sid 查到的工作区**（客户端自报路径一律拒绝）——
 *     否则「静音任意路径」就变成一个能吞掉别人记忆的写口。
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
    normalizeWorkspacePath, resolveGate, sessionCwdOf, setSessionMute,
    setWorkspaceMute, snapshot, workspaceMuteInfo,
} from './mute_state.js';

/** 路由前缀（index.js 用它注册 webServer prefix）。 */
export const MUTE_HTTP_PREFIX = '/plugins/lingshu-mute';
/** 服务端模块版本标记（**热更新探针**：401/`/meta` 里都带，reload 后变化即说明模块真的被重载）。 */
export const MODULE_VERSION = '2026-11-22T13:55+08:00';
/** POST 体上限：16 KB（远大于任何合法请求）。 */
const MAX_BODY_BYTES = 16 * 1024;

/** 写响应（一致的头：no-store / nosniff / 同源引用策略）。 */
function reply(res, status, body, type = 'application/json; charset=utf-8') {
    try {
        res.writeHead(status, {
            'Content-Type': type,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'same-origin',
        });
        res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
    }
    catch { /* 连接已断：忽略 */ }
}

/** 读取 JSON 体（超限 413、非 JSON 400）。 */
async function readJsonBody(req) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BODY_BYTES) {
            const err = new Error(`请求体超过 ${MAX_BODY_BYTES / 1024} KB`);
            err.status = 413;
            throw err;
        }
        chunks.push(chunk);
    }
    try {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return {};
        return JSON.parse(text);
    }
    catch {
        const err = new Error('请求必须是有效 JSON');
        err.status = 400;
        throw err;
    }
}

/**
 * 解析「当前会话 → 工作区路径」。
 * 宿主事实：`Session.header.cwd`（绝对路径）由 `sessions` 服务按会话 id 提供；
 * 服务未就绪 / 会话查不到时退回请求参数里的 cwd（GET 可用；POST 的工作区开关要求
 * `fromHost=true`，否则「任意路径」就能被静音）。
 */
export function resolveHostSession(getSessions, sessionId, fallbackCwd) {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
    let fromHost = false;
    let cwd = '';
    if (sid) {
        try {
            const store = typeof getSessions === 'function' ? getSessions() : getSessions;
            const session = store && typeof store.get === 'function' ? store.get(sid) : undefined;
            const header = session && typeof session === 'object' ? session.header : undefined;
            if (header && typeof header === 'object' && typeof header.cwd === 'string' && header.cwd.trim()) {
                cwd = header.cwd.trim();
                fromHost = true;
            }
        }
        catch { /* 宿主服务未就绪：退回请求参数（仅 GET 有意义） */ }
    }
    if (!cwd && typeof fallbackCwd === 'string') cwd = fallbackCwd.trim();
    return { sessionId: sid, cwd, fromHost };
}

/** 静音状态（GET /state 与 POST /toggle 的**同一返回体**）。 */
export function muteStatus(sessionId, cwd) {
    const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
    const effectiveCwd = cwd || (sid ? sessionCwdOf(sid) : '');
    const gate = resolveGate({ sessionId: sid, cwd: effectiveCwd });
    const ws = workspaceMuteInfo(effectiveCwd);
    const sessionMuted = gate.scope === 'session';
    return {
        ok: true,
        sessionId: sid || null,
        workspacePath: gate.workspacePath ?? null,
        muted: gate.muted,
        mode: gate.muted ? gate.mode : null,
        noRead: !!gate.noRead,
        scope: gate.scope,
        session: {
            muted: sessionMuted,
            mode: sessionMuted ? gate.mode : null,
            reason: sessionMuted ? 'muted_session' : null,
        },
        workspace: {
            muted: ws.muted,
            mode: ws.muted ? ws.mode : null,
            reason: ws.reason,
            path: ws.path,
            runtime: ws.runtime,
            static: ws.static,
        },
    };
}

/** 安全读取「最近活跃会话」（失败/未提供 → null）。 */
function safeActive(getActiveSession) {
    try {
        const row = typeof getActiveSession === 'function' ? getActiveSession() : null;
        return row && typeof row === 'object' ? row : null;
    }
    catch {
        return null;
    }
}

/** 宿主工作区注册表 → `[{id,title,path,sessionIds}]`（拿不到服务时返回空数组，绝不抛）。 */
export function workspaceRegistryRows(getWorkspaceRegistry) {
    try {
        const registry = typeof getWorkspaceRegistry === 'function' ? getWorkspaceRegistry() : undefined;
        if (!registry || typeof registry.list !== 'function') return [];
        const rows = [];
        for (const entity of registry.list() || []) {
            if (!entity || typeof entity !== 'object') continue;
            const path = normalizeWorkspacePath(entity.path ?? '');
            if (!path) continue;
            const title = typeof entity.title === 'string' && entity.title.trim() ? entity.title.trim() : (path.split('/').filter(Boolean).pop() || path);
            rows.push({
                id: typeof entity.id === 'string' ? entity.id : path,
                title,
                path,
                sessionIds: Array.isArray(entity.sessionIds) ? entity.sessionIds.slice(0, 200) : [],
            });
        }
        return rows;
    }
    catch {
        return [];
    }
}

/** 请求路径是否命中「宿主注册表里的某个工作区目录」（精确相等；返回注册表里的写法）。 */
export function registeredWorkspacePath(getWorkspaceRegistry, requested) {
    const want = normalizeWorkspacePath(requested);
    if (!want) return '';
    for (const row of workspaceRegistryRows(getWorkspaceRegistry)) {
        if (row.path === want) return row.path;
    }
    const folded = process.platform === 'win32' ? want.toLowerCase() : want;
    for (const row of workspaceRegistryRows(getWorkspaceRegistry)) {
        const candidate = process.platform === 'win32' ? row.path.toLowerCase() : row.path;
        if (candidate === folded) return row.path;
    }
    return '';
}

/** 请求里的工作区路径 → 静音表里**实际存在**的键（找不到返回空串）。
 *
 *  只做「已在表里」的确认，不做前缀扩散：解除只能删掉真正命中的那一条。
 *  Windows 大小写不敏感的口径与 mute_state 一致（这里只按精确/折叠两种写法比）。 */
function storedWorkspaceKey(requested) {
    const want = normalizeWorkspacePath(requested);
    if (!want) return '';
    let snap;
    try {
        snap = snapshot();
    }
    catch {
        return '';
    }
    const keys = Object.keys(snap.workspaces ?? {});
    for (const key of keys) {
        if (key === want) return key;
    }
    const folded = process.platform === 'win32' ? want.toLowerCase() : want;
    for (const key of keys) {
        const candidate = process.platform === 'win32' ? key.toLowerCase() : key;
        if (candidate === folded) return key;
    }
    return '';
}

/** 同源判据（桌面 dsh-app 代理会移除 Origin；宿主 admission 仍验证浏览器登录）。 */
function isCrossOrigin(req) {
    const headers = req?.headers && typeof req.headers === 'object' ? req.headers : {};
    const origin = headers.origin;
    const host = headers.host;
    if (headers['sec-fetch-site'] === 'cross-site') return true;
    if (!origin) return false;
    if (origin === 'dsh-app://app') return false;
    try {
        return new URL(origin).host !== host;
    }
    catch {
        return true;
    }
}

/** CSRF 比对（长度不同直接失败，避免 timingSafeEqual 抛错）。 */
function csrfMatches(supplied, expected) {
    const a = String(supplied ?? '');
    if (a.length !== expected.length) return false;
    try {
        return timingSafeEqual(Buffer.from(a), Buffer.from(expected));
    }
    catch {
        return false;
    }
}

/**
 * 创建 HTTP handler。
 *
 * @param {object} options
 * @param {() => any} [options.getConnection] 每次请求实时取 `connection` 服务（服务晚到能自愈）
 * @param {() => any} [options.getSessions] 每次请求实时取 `sessions` 服务（SessionStore）
 * @param {{info:Function,warn:Function}} [options.logger]
 * @param {() => any} [options.getGate] 可选：写入门诊断快照（日志不可见时的「是否已接管」证据）
 * @param {{excludeWorkspaces?: string[]}} [options.config]
 * @returns {(req:any, res:any) => Promise<void>}
 */
export function createMuteHandler(options = {}) {
    const getConnection = typeof options.getConnection === 'function' ? options.getConnection : () => undefined;
    const getSessions = typeof options.getSessions === 'function' ? options.getSessions : () => undefined;
    const getActiveSession = typeof options.getActiveSession === 'function' ? options.getActiveSession : () => null;
    const logger = options.logger && typeof options.logger === 'object' ? options.logger : null;
    const config = options.config && typeof options.config === 'object' ? options.config : {};
    const getGate = typeof options.getGate === 'function' ? options.getGate : () => null;
    const getWorkspaceRegistry = typeof options.getWorkspaceRegistry === 'function' ? options.getWorkspaceRegistry : () => undefined;
    const csrf = randomBytes(32).toString('hex');
    let warnedAdmit = false;
    let warnedOrigin = false;
    const warn = (onceKey, message) => {
        try {
            if (!logger || typeof logger.warn !== 'function') return;
            if (onceKey === 'admit' && warnedAdmit) return;
            if (onceKey === 'origin' && warnedOrigin) return;
            if (onceKey === 'admit') warnedAdmit = true;
            if (onceKey === 'origin') warnedOrigin = true;
            logger.warn(message);
        }
        catch { /* 日志面不可用忽略 */ }
    };

    /** 鉴权：connection.admit(req)；服务缺失 → 同源校验（降级并 warn 一次）。 */
    const admit = (req, res) => {
        let connection = null;
        try {
            connection = getConnection();
        }
        catch { connection = null; }
        if (connection && typeof connection.admit === 'function') {
            try {
                const admission = connection.admit(req);
                if (admission && typeof admission === 'object' && 'rejection' in admission) {
                    const status = Number(admission.rejection) || 403;
                    reply(res, status, {
                        ok: false,
                        v: MODULE_VERSION,
                        error: status === 401 ? '未登录，请返回 DSH 登录' : '请求来源不可信',
                    });
                    return false;
                }
                return true;
            }
            catch (err) {
                warn('admit', `lingshu-mute: 宿主鉴权调用失败（降级为同源校验）: ${err?.message ?? err}`);
            }
        }
        else {
            warn('admit', 'lingshu-mute: connection 服务不可用——HTTP 开关降级为同源校验（仅本机单用户场景可接受）');
        }
        if (isCrossOrigin(req)) {
            warn('origin', 'lingshu-mute: 拒绝跨源请求（降级模式下只接受同源）');
            reply(res, 403, { ok: false, v: MODULE_VERSION, error: '仅允许同源界面调用' });
            return false;
        }
        return true;
    };

    return async function muteHandler(req, res) {
        try {
            const url = new URL(String(req?.url ?? '/'), 'http://localhost');
            const path = url.pathname;
            const method = String(req?.method ?? 'GET').toUpperCase();
            if (path !== MUTE_HTTP_PREFIX && !path.startsWith(`${MUTE_HTTP_PREFIX}/`)) {
                reply(res, 404, { ok: false, error: '页面不存在' });
                return;
            }
            if (!admit(req, res)) return;
            const tail = path.slice(MUTE_HTTP_PREFIX.length) || '/';

            if (method === 'GET' && (tail === '/' || tail === '/meta')) {
                let gate = null;
                try {
                    gate = getGate() ?? null;
                }
                catch { gate = null; }
                reply(res, 200, {
                    ok: true,
                    v: MODULE_VERSION,
                    csrf,
                    state: snapshot(),
                    gate,
                    workspaces: workspaceRegistryRows(getWorkspaceRegistry),
                    config: { excludeWorkspaces: Array.isArray(config.excludeWorkspaces) ? config.excludeWorkspaces.slice() : [] },
                });
                return;
            }
            if (method === 'GET' && tail === '/list') {
                // 只读清单：设置面板（无会话上下文）据此列出「已静音的会话/工作区」并逐项解除。
                const snap = snapshot();
                const sessions = Object.entries(snap.sessions)
                    .map(([id, item]) => ({ id, at: item.at, cwd: item.cwd ?? '', mode: item.mode || 'mute' }))
                    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
                const workspaces = Object.entries(snap.workspaces)
                    .map(([path, item]) => ({ path, at: item.at, mode: item.mode || 'mute' }))
                    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
                // 静态排除项：优先用静音表里已规范化的那一份；表还没配过时回落到本 handler 的配置
                // （生产里两者同源，index.js 的 apply 会把 config.excludeWorkspaces 交给 configureMute）。
                const statics = (Array.isArray(snap.staticWorkspaces) && snap.staticWorkspaces.length > 0)
                    ? snap.staticWorkspaces.slice()
                    : (Array.isArray(config.excludeWorkspaces) ? config.excludeWorkspaces.slice() : []);
                reply(res, 200, {
                    ok: true,
                    v: MODULE_VERSION,
                    sessions,
                    workspaces,
                    registry: workspaceRegistryRows(getWorkspaceRegistry),
                    staticWorkspaces: statics,
                });
                return;
            }
            if (method === 'GET' && tail === '/state') {
                const activeRow = safeActive(getActiveSession);
                const requestedSession = url.searchParams.get('session') ?? '';
                const resolved = resolveHostSession(
                    getSessions,
                    requestedSession || (activeRow && activeRow.id ? activeRow.id : ''),
                    url.searchParams.get('cwd') ?? (activeRow && activeRow.cwd ? activeRow.cwd : ''),
                );
                reply(res, 200, muteStatus(resolved.sessionId, resolved.cwd));
                return;
            }
            if (method === 'POST' && tail === '/toggle') {
                if (isCrossOrigin(req)) {
                    reply(res, 403, { ok: false, error: '仅允许同源界面调用' });
                    return;
                }
                const headers = req?.headers && typeof req.headers === 'object' ? req.headers : {};
                if (!csrfMatches(headers['x-lingshu-csrf'], csrf)) {
                    reply(res, 403, { ok: false, error: '页面凭证已过期，请刷新页面' });
                    return;
                }
                if (!String(headers['content-type'] ?? '').startsWith('application/json')) {
                    reply(res, 415, { ok: false, error: '需要 application/json' });
                    return;
                }
                let body;
                try {
                    body = await readJsonBody(req);
                }
                catch (err) {
                    reply(res, err?.status ?? 400, { ok: false, error: String(err?.message ?? err) });
                    return;
                }
                const scope = body?.scope === 'workspace' ? 'workspace' : body?.scope === 'session' ? 'session' : '';
                const verb = body?.action;
                // on = 静音；noread = 不读记忆（静音 + 禁一切读取）；off = 恢复。
                const action = (verb === 'on' || verb === 'noread') ? true : verb === 'off' ? false : null;
                const mode = verb === 'noread' ? 'no_read' : 'mute';
                if (!scope) {
                    reply(res, 400, { ok: false, error: 'scope 必须是 session 或 workspace' });
                    return;
                }
                if (action === null) {
                    reply(res, 400, { ok: false, error: 'action 必须是 on、noread 或 off' });
                    return;
                }
                const activeRow = safeActive(getActiveSession);
                const requestedSessionId = body?.sessionId ?? (activeRow && activeRow.id ? activeRow.id : '');
                const resolved = resolveHostSession(getSessions, requestedSessionId, body?.cwd ?? (activeRow && activeRow.cwd ? activeRow.cwd : ''));
                if (scope === 'session') {
                    if (!resolved.sessionId) {
                        reply(res, 400, { ok: false, error: '缺少会话标识（sessionId）' });
                        return;
                    }
                    await setSessionMute(resolved.sessionId, action, resolved.cwd, mode);
                    reply(res, 200, muteStatus(resolved.sessionId, resolved.cwd));
                    return;
                }
                // ── 解除（off）：允许对**静音表里已存在**的路径直接解除 ──
                // 设置面板没有会话上下文，只能按清单里的路径解除；这不会放开「静音任意路径」
                // （那是 on 的风险），因为只有已经在表里的路径才会被接受。
                if (action === false) {
                    const requested = normalizeWorkspacePath(body?.cwd);
                    const stored = requested ? storedWorkspaceKey(requested) : '';
                    if (stored) {
                        await setWorkspaceMute(stored, false);
                        reply(res, 200, muteStatus(resolved.sessionId, stored));
                        return;
                    }
                    if (!requested && !resolved.fromHost) {
                        reply(res, 400, { ok: false, error: '缺少工作区路径（cwd），无法解除' });
                        return;
                    }
                }
                // ── 静音（on）：路径必须是「宿主的真实工作区」之一 ──
                //   ① 当前会话 header.cwd（旧口径）；或 ② 工作区注册表里的某个 path（设置页按工作区
                //   列表开关时走这条）。两者都不是的任意路径一律 400 —— 安全边界只放宽到 registry。
                const requestedOn = normalizeWorkspacePath(body?.cwd);
                const registeredOn = requestedOn ? registeredWorkspacePath(getWorkspaceRegistry, requestedOn) : '';
                if (registeredOn) {
                    await setWorkspaceMute(registeredOn, true, mode);
                    reply(res, 200, muteStatus(resolved.sessionId, registeredOn));
                    return;
                }
                if (!resolved.fromHost || !normalizeWorkspacePath(resolved.cwd)) {
                    reply(res, 400, { ok: false, error: '无法解析当前会话的工作区路径，请刷新页面后重试' });
                    return;
                }
                if (typeof body?.cwd === 'string' && body.cwd.trim()
                    && normalizeWorkspacePath(body.cwd) !== normalizeWorkspacePath(resolved.cwd)) {
                    reply(res, 400, { ok: false, error: '工作区路径与服务端会话不一致' });
                    return;
                }
                await setWorkspaceMute(resolved.cwd, action, mode);
                reply(res, 200, muteStatus(resolved.sessionId, resolved.cwd));
                return;
            }
            if (method !== 'GET' && method !== 'POST') {
                reply(res, 405, { ok: false, error: '不支持的请求方法' });
                return;
            }
            reply(res, method === 'POST' ? 405 : 404, { ok: false, error: '接口不存在' });
        }
        catch (err) {
            reply(res, Number(err?.status) || 500, { ok: false, error: String(err?.message ?? err) });
        }
    };
}
