/**
 * DeepSeek 用量面板 — 宿主半（静态 Cordis 插件，随 DSH 进程自动挂载）。
 *
 * 当前发布版不依赖动态沙箱的 `harness.handle`：
 *  1) 使用 `TypertRemoteService` + `@Remote`
 *     注册服务 `usage`，浏览器半经 `connection.rpc.call('/api', 'usage/*', ... )`
 *     调用，不依赖生成式 Client Remote contribution。
 *  2) 插件形态：包主入口 `export default` 一个继承 TypertRemoteService 的类；
 *     cordis 以 `new Plugin(ctx, config)` 实例化（fiber.js），构造器里
 *     `super(ctx, 'usage')` 注册服务，`[Service.init]`（构造后运行）里做
 *     订阅/轮询等启动逻辑；`static inject` 声明的服务经 `this.ctx.<name>` 访问。
 *
 * 已核实的部署事实（profiles/node_modules 内装版本）：
 *  - `TypertRemoteService` / `Remote` 来自 `@deepseek-ai/dsh-typert-protocol`
 *    （不是 dsh-api-remotes；后者只导出 agent-lookup 与 apply）。
 *  - TypertRemoteService 构造签名 `(ctx, serviceKey, options?)`：serviceKey 既是
 *    Cordis 服务键也是 Typert 默认 wire 命名空间，`super(ctx, 'usage')` 即
 *    `ctx.usage` + `usage/*` Gateway endpoint。
 *  - 类插件生命周期：fiber 构造 `new Plugin(ctx, config)` → `instance[Service.init]?.()`
 *    → fiber 卸载时自动释放构造/init 期间注册的 ctx.on / ctx.interval 效果。
 *  - 注入服务在构造/init 期间经 `this.ctx.<name>`（ctx 是带注入的代理）访问。
 *
 * 对外 Remote 方法：snapshot / getConfig / setConfig / resetLocal / refresh。
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Service } from '@deepseek-ai/cordis';
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
// ---- 常量 ----
const POLL_PLATFORM_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 30 * 1000;
const DEEPSEEK_PLATFORM_BASE = 'https://platform.deepseek.com';
const DEEPSEEK_API_BASE = 'https://api.deepseek.com';
const DEFAULT_PRICE = { cacheHit: 0.07, cacheMiss: 0.27, output: 1.10 };
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
// ---- Remote 服务：浏览器半通过 usage/* Gateway endpoint 调用 ----
let UsageService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _snapshot_decorators;
    let _getConfig_decorators;
    let _setConfig_decorators;
    let _resetLocal_decorators;
    let _refreshRemote_decorators;
    return class UsageService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            __esDecorate(this, null, _snapshot_decorators, { kind: "method", name: "snapshot", static: false, private: false, access: { has: obj => "snapshot" in obj, get: obj => obj.snapshot }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _getConfig_decorators, { kind: "method", name: "getConfig", static: false, private: false, access: { has: obj => "getConfig" in obj, get: obj => obj.getConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setConfig_decorators, { kind: "method", name: "setConfig", static: false, private: false, access: { has: obj => "setConfig" in obj, get: obj => obj.setConfig }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _resetLocal_decorators, { kind: "method", name: "resetLocal", static: false, private: false, access: { has: obj => "resetLocal" in obj, get: obj => obj.resetLocal }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _refreshRemote_decorators, { kind: "method", name: "refreshRemote", static: false, private: false, access: { has: obj => "refreshRemote" in obj, get: obj => obj.refreshRemote }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['timer'];
        config = (__runInitializers(this, _instanceExtraInitializers), { token: '', apiKey: '' });
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
            super(ctx, 'usage');
        }
        get credentialsApi() {
            return this.ctx.get('credentials');
        }
        get timerCtx() {
            return this.ctx;
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
        // ---- Remote 方法（浏览器半经 connection.rpc.call 调用）----
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
        // ---- 启动逻辑：构造后由 fiber 调用（ctx.on/ctx.interval 随 fiber 释放）----
        [(_snapshot_decorators = [Remote('snapshot')], _getConfig_decorators = [Remote('getConfig')], _setConfig_decorators = [Remote('setConfig')], _resetLocal_decorators = [Remote('resetLocal')], _refreshRemote_decorators = [Remote('refresh')], Service.init)]() {
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
            this.timerCtx.interval(() => { void this.refresh(); }, POLL_PLATFORM_MS);
            void this.refresh();
        }
    };
})();
export { UsageService };
export default UsageService;
//# sourceMappingURL=index.js.map