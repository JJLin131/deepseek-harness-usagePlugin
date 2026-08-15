/**
 * DeepSeek 用量面板 — 宿主半（静态 Cordis 插件，随 DSH 进程自动挂载）。
 *
 * 当前发布版不依赖动态沙箱的 `harness.handle`：
 *  1) 在 Harness Connection 的 `/api` channel 上直接认领 `usage/*`，浏览器半经
 *     `connection.rpc.call('/api', 'usage/*', ...)` 调用。这里不使用模块私有的
 *     `@Remote` marker，因而同时兼容 npm 构建版与 `tsx` 源码 checkout。
 *  2) 插件形态：包主入口 `export default` 一个 Cordis Service 类；cordis 以
 *     `new Plugin(ctx, config)` 实例化，在 `[Service.init]` 中注册 RPC、事件与轮询。
 *
 * 已核实的部署事实（profiles/node_modules 内装版本）：
 *  - 类插件生命周期：fiber 构造 `new Plugin(ctx, config)` → `instance[Service.init]?.()`
 *    → fiber 卸载时自动释放构造/init 期间注册的 ctx.on / ctx.interval 效果。
 *  - Host Web composition 提供 `connection`；RPC interceptor 的 disposer 由调用时的
 *    Cordis fiber 自动认领，插件卸载时同步撤销。
 *
 * 对外 Remote 方法：snapshot / getConfig / setConfig / resetLocal / refresh。
 */
import { Service } from '@deepseek-ai/cordis';
// ---- 常量 ----
const POLL_PLATFORM_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 30 * 1000;
const DEEPSEEK_PLATFORM_BASE = 'https://platform.deepseek.com';
const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
const DEFAULT_PRICE = { cacheHit: 0.07, cacheMiss: 0.27, output: 1.10 };
const RPC_CHANNEL = '/api';
const RPC_NAMESPACE = 'usage';
const RPC_METHODS = new Set(['snapshot', 'getConfig', 'setConfig', 'resetLocal', 'refresh']);
// ---- 纯工具（无 ctx，模块级安全）----
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function safeErrorText(e, secrets) {
    let message = String(e?.message ?? e);
    for (const secret of secrets) {
        if (secret.length >= 4)
            message = message.split(secret).join('[REDACTED]');
    }
    return message
        .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]')
        .slice(0, 500);
}
function localDateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function hourKeyOf(d) { return localDateKey(d) + '|' + pad2(d.getHours()); }
function hourKeyAt(ms) { return hourKeyOf(new Date(ms)); }
function emptyAgg() {
    return { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0, models: {} };
}
function mergeAgg(into, from) {
    into.requests += from.requests;
    into.cacheHit += from.cacheHit;
    into.cacheMiss += from.cacheMiss;
    into.output += from.output;
    into.cost += from.cost;
    for (const model of Object.keys(from.models)) {
        const fm = from.models[model];
        const im = (into.models[model] ??= { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0 });
        im.requests += fm.requests;
        im.cacheHit += fm.cacheHit;
        im.cacheMiss += fm.cacheMiss;
        im.output += fm.output;
        im.cost += fm.cost;
    }
}
function addRows(agg, rows, isCost) {
    if (!Array.isArray(rows))
        return;
    for (const row of rows) {
        if (!row || typeof row !== 'object')
            continue;
        const model = typeof row.model === 'string' && row.model ? row.model : 'unknown';
        const usage = Array.isArray(row.usage) ? row.usage : [];
        for (const u of usage) {
            if (!u || typeof u !== 'object')
                continue;
            const n = Number(u.amount);
            if (!Number.isFinite(n))
                continue;
            const m = (agg.models[model] ??= { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0 });
            if (isCost) {
                agg.cost += n;
                m.cost += n;
                continue;
            }
            if (u.type === 'REQUEST') {
                agg.requests += n;
                m.requests += n;
            }
            else if (u.type === 'PROMPT_CACHE_HIT_TOKEN') {
                agg.cacheHit += n;
                m.cacheHit += n;
            }
            else if (u.type === 'PROMPT_CACHE_MISS_TOKEN') {
                agg.cacheMiss += n;
                m.cacheMiss += n;
            }
            else if (u.type === 'RESPONSE_TOKEN') {
                agg.output += n;
                m.output += n;
            }
        }
    }
}
function aggToJson(agg) {
    const input = agg.cacheHit + agg.cacheMiss;
    const byModel = Object.keys(agg.models)
        .map((model) => ({
        model,
        requests: agg.models[model].requests,
        cacheHit: agg.models[model].cacheHit,
        cacheMiss: agg.models[model].cacheMiss,
        output: agg.models[model].output,
        cost: agg.models[model].cost,
    }))
        .sort((a, b) => b.cost - a.cost || b.requests - a.requests)
        .slice(0, 8);
    return {
        requests: agg.requests,
        cacheHit: agg.cacheHit,
        cacheMiss: agg.cacheMiss,
        output: agg.output,
        input,
        cost: agg.cost,
        cacheHitRate: input > 0 ? Math.round((agg.cacheHit / input) * 1000) / 10 : 0,
        byModel,
    };
}
function localEstimateUsd(localAgg) {
    const p = DEFAULT_PRICE;
    return (localAgg.cacheReadTokens / 1e6) * p.cacheHit
        + (localAgg.inputTokens / 1e6) * p.cacheMiss
        + (localAgg.outputTokens / 1e6) * p.output;
}
function localToJson(localAgg, localHours) {
    const floor = hourKeyAt(Date.now() - 48 * 3600 * 1000);
    const hours = Array.from(localHours.entries())
        .filter((pair) => pair[0] >= floor)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map((pair) => {
        const sep = pair[0].indexOf('|');
        return {
            date: pair[0].slice(0, sep),
            h: pair[0].slice(sep + 1),
            requests: pair[1].requests,
            input: pair[1].input,
            cacheHit: pair[1].cacheHit,
            output: pair[1].output,
        };
    });
    return {
        requests: localAgg.requests,
        inputTokens: localAgg.inputTokens,
        cacheReadTokens: localAgg.cacheReadTokens,
        cacheMissTokens: localAgg.inputTokens,
        outputTokens: localAgg.outputTokens,
        estimatedCostUsd: Math.round(localEstimateUsd(localAgg) * 10000) / 10000,
        since: localAgg.since,
        hours,
    };
}
function configFacts(config) {
    return {
        hasToken: !!config.token,
        hasApiKey: !!config.apiKey,
        apiKeySource: config.apiKey ? 'user' : 'credentials',
        tokenLength: config.token ? config.token.length : 0,
        apiKeyLength: config.apiKey ? config.apiKey.length : 0,
    };
}
function parseJsonResponse(text, label) {
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(label + ' 返回了无效 JSON');
    }
}
// ---- Host 服务：浏览器半通过 Connection RPC 的 usage/* endpoint 调用 ----
export class UsageService extends Service {
    static inject = ['connection'];
    config = { token: '', apiKey: '' };
    refreshing = false;
    refreshQueued = false;
    localAgg = {
        requests: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        since: Date.now(),
    };
    localHours = new Map();
    platformCache = null;
    balanceCache = null;
    errorCache = null;
    constructor(ctx, _config) {
        super(ctx, RPC_NAMESPACE);
    }
    get credentialsApi() {
        return this.ctx.get('credentials');
    }
    get connectionApi() {
        const connection = this.ctx.get('connection');
        if (connection?.rpc?.intercept === undefined) {
            throw new Error('dsh-usage-panel: Host connection RPC service is unavailable');
        }
        return connection;
    }
    /** 'session/event' 不在 cordis 基础 Events 映射内（由 dsh-session 类型增强声明），断言放宽类型。 */
    get eventCtx() {
        return this.ctx;
    }
    async httpGet(url, bearer) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await fetch(url, {
                headers: {
                    accept: 'application/json',
                    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
                },
                signal: controller.signal,
            });
            if (!response.ok)
                throw new Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
            const text = await response.text();
            if (text.length === 0)
                throw new Error(`HTTP response was empty for ${new URL(url).pathname}`);
            return text;
        }
        catch (error) {
            if (controller.signal.aborted)
                throw new Error(`HTTP request timed out for ${new URL(url).pathname}`);
            throw error;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    assertPlatformOk(j, label) {
        if (j && typeof j.code === 'number' && j.code !== 0) {
            throw new Error(label + ' 平台返回 code=' + j.code);
        }
    }
    async fetchPlatform(token) {
        const now = new Date();
        const month = now.getMonth() + 1;
        const year = now.getFullYear();
        const [amountText, costText] = await Promise.all([
            this.httpGet(DEEPSEEK_PLATFORM_BASE + '/api/v0/usage/amount?month=' + month + '&year=' + year, token),
            this.httpGet(DEEPSEEK_PLATFORM_BASE + '/api/v0/usage/cost?month=' + month + '&year=' + year, token),
        ]);
        const amt = parseJsonResponse(amountText, 'usage/amount');
        const cst = parseJsonResponse(costText, 'usage/cost');
        this.assertPlatformOk(amt, 'usage/amount');
        this.assertPlatformOk(cst, 'usage/cost');
        const amtData = amt.data?.biz_data;
        const cstBiz = Array.isArray(cst.data?.biz_data) ? cst.data.biz_data[0] : undefined;
        const totals = emptyAgg();
        addRows(totals, amtData?.total, false);
        addRows(totals, cstBiz?.total, true);
        const todayKey = localDateKey(now);
        const dayMap = new Map();
        const addDay = (date, rows, isCost) => {
            if (!Array.isArray(rows))
                return;
            let a = dayMap.get(date);
            if (!a) {
                a = emptyAgg();
                dayMap.set(date, a);
            }
            addRows(a, rows, isCost);
        };
        for (const d of amtData?.days ?? []) {
            if (d && typeof d.date === 'string')
                addDay(d.date, d.data, false);
        }
        for (const d of cstBiz?.days ?? []) {
            if (d && typeof d.date === 'string')
                addDay(d.date, d.data, true);
        }
        const dayKeys = Array.from(dayMap.keys()).sort();
        const days = dayKeys.slice(-31).map((key) => {
            const g = aggToJson(dayMap.get(key));
            return {
                date: key.slice(5),
                full: key,
                requests: g.requests,
                input: g.input,
                cacheHit: g.cacheHit,
                cacheMiss: g.cacheMiss,
                output: g.output,
                cost: Math.round(g.cost * 100) / 100,
            };
        });
        const yesterdayKey = localDateKey(new Date(now.getTime() - 86400000));
        const dow = (now.getDay() + 6) % 7;
        const mondayKey = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow));
        const sumRange = (keys) => {
            const a = emptyAgg();
            for (const k of keys) {
                const d = dayMap.get(k);
                if (d)
                    mergeAgg(a, d);
            }
            return aggToJson(a);
        };
        const ranges = {
            today: sumRange([todayKey]),
            yesterday: sumRange([yesterdayKey]),
            week: sumRange(dayKeys.filter((k) => k >= mondayKey && k <= todayKey)),
            month: aggToJson(totals),
        };
        return {
            month: year + '-' + pad2(month),
            monthPrefix: year + '-' + pad2(month),
            weekStart: mondayKey,
            weekEnd: todayKey,
            currency: cstBiz?.currency || 'CNY',
            totals: aggToJson(totals),
            days,
            ranges,
        };
    }
    async fetchBalance() {
        let key = this.config.apiKey || '';
        let source = 'user';
        if (!key) {
            try {
                const cred = await this.credentialsApi?.resolve('DEEPSEEK_API_KEY');
                if (cred?.value) {
                    key = cred.value;
                    source = 'credentials';
                }
            }
            catch { /* 忽略 */ }
        }
        if (!key && this.config.token) {
            key = this.config.token;
            source = 'token';
        }
        if (!key)
            return null;
        const j = parseJsonResponse(await this.httpGet(DEEPSEEK_API_BASE + '/user/balance', key), 'user/balance');
        return {
            source,
            available: !!j.is_available,
            infos: (j.balance_infos ?? []).map((i) => ({
                currency: i.currency || 'CNY',
                total: Number(i.total_balance) || 0,
                granted: Number(i.granted_balance) || 0,
                toppedUp: Number(i.topped_up_balance) || 0,
            })),
        };
    }
    async refresh() {
        if (this.refreshing) {
            this.refreshQueued = true;
            return;
        }
        this.refreshing = true;
        try {
            if (this.config.token) {
                try {
                    this.platformCache = await this.fetchPlatform(this.config.token);
                    this.errorCache = null;
                }
                catch (e) {
                    this.platformCache = null;
                    this.errorCache = '平台用量获取失败: ' + safeErrorText(e, [this.config.token, this.config.apiKey]);
                }
            }
            else {
                this.platformCache = null;
                this.errorCache = '未配置平台 Token：展开面板粘贴 platform.deepseek.com 的 userToken 后可显示平台用量与金额';
            }
            try {
                this.balanceCache = await this.fetchBalance();
            }
            catch {
                this.balanceCache = null;
            }
        }
        catch (e) {
            this.errorCache = '刷新失败: ' + safeErrorText(e, [this.config.token, this.config.apiKey]);
        }
        finally {
            this.refreshing = false;
            if (this.refreshQueued) {
                this.refreshQueued = false;
                void this.refresh();
            }
        }
    }
    publish() {
        return {
            platform: this.platformCache,
            local: localToJson(this.localAgg, this.localHours),
            balance: this.balanceCache,
            config: configFacts(this.config),
            lastUpdated: Date.now(),
            error: this.errorCache,
        };
    }
    // ---- RPC 业务方法（浏览器半经 connection.rpc.call 调用）----
    snapshot() { return this.publish(); }
    getConfig() { return configFacts(this.config); }
    setConfig(cfg) {
        this.config = {
            token: typeof cfg?.token === 'string' ? cfg.token.trim() : '',
            apiKey: typeof cfg?.apiKey === 'string' ? cfg.apiKey.trim() : '',
        };
        this.errorCache = null;
        void this.refresh();
        return { ok: true };
    }
    resetLocal() {
        this.localAgg.requests = 0;
        this.localAgg.inputTokens = 0;
        this.localAgg.cacheReadTokens = 0;
        this.localAgg.outputTokens = 0;
        this.localAgg.since = Date.now();
        this.localHours.clear();
        return { ok: true };
    }
    refreshRemote() { void this.refresh(); return { ok: true }; }
    async dispatchRpc(endpoint, payload) {
        try {
            if (!isPlainRecord(payload) || !isPlainRecord(payload.args))
                return rpcInvalid();
            const method = endpoint.slice(RPC_NAMESPACE.length + 1);
            if (method === 'snapshot' && hasExactKeys(payload.args, [])) {
                return { ok: true, value: this.snapshot() };
            }
            if (method === 'getConfig' && hasExactKeys(payload.args, [])) {
                return { ok: true, value: this.getConfig() };
            }
            if (method === 'setConfig' && hasExactKeys(payload.args, ['cfg']) && isPlainRecord(payload.args.cfg)) {
                return { ok: true, value: this.setConfig(payload.args.cfg) };
            }
            if (method === 'resetLocal' && hasExactKeys(payload.args, [])) {
                return { ok: true, value: this.resetLocal() };
            }
            if (method === 'refresh' && hasExactKeys(payload.args, [])) {
                return { ok: true, value: this.refreshRemote() };
            }
            return rpcInvalid();
        }
        catch {
            return {
                ok: false,
                error: { code: 'internal', message: 'dsh-usage-panel: RPC 处理失败', details: {} },
            };
        }
    }
    // ---- 启动逻辑：构造后由 fiber 调用（ctx.on/ctx.interval 随 fiber 释放）----
    [Service.init]() {
        this.connectionApi.rpc.intercept(RPC_CHANNEL, endpoint => {
            const prefix = `${RPC_NAMESPACE}/`;
            return endpoint.startsWith(prefix) && RPC_METHODS.has(endpoint.slice(prefix.length));
        }, (endpoint, payload) => this.dispatchRpc(endpoint, payload), { authority: 'trusted-host' });
        // DSH 本会话实时用量：事件是 { type, seq, time, data }，TokenUsage 在 event.data.usage
        this.eventCtx.on('session/event', (_session, rawEvent) => {
            try {
                const event = rawEvent;
                if (!event || event.type !== 'assistant/message')
                    return;
                const u = event.data?.usage;
                this.localAgg.requests += 1;
                const input = u?.inputTokens || 0;
                const cacheHit = u?.cacheReadTokens || 0;
                const output = u?.outputTokens || 0;
                this.localAgg.inputTokens += input;
                this.localAgg.cacheReadTokens += cacheHit;
                this.localAgg.outputTokens += output;
                const hk = hourKeyOf(new Date());
                let b = this.localHours.get(hk);
                if (!b) {
                    b = { requests: 0, input: 0, cacheHit: 0, output: 0 };
                    this.localHours.set(hk, b);
                }
                b.requests += 1;
                b.input += input;
                b.cacheHit += cacheHit;
                b.output += output;
            }
            catch {
                console.error('dsh-usage-panel: usage aggregation failed');
            }
        });
        this.ctx.effect(() => {
            const timer = setInterval(() => { void this.refresh(); }, POLL_PLATFORM_MS);
            return () => clearInterval(timer);
        }, 'dsh-usage-panel.platform-poll');
        void this.refresh();
    }
}
function isPlainRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(value, expected) {
    const keys = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}
function rpcInvalid() {
    return {
        ok: false,
        error: { code: 'invalid-request', message: 'dsh-usage-panel: RPC 参数无效', details: {} },
    };
}
export default UsageService;
//# sourceMappingURL=index.js.map