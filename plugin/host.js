/**
 * DeepSeek Usage Panel — HOST half (server side). v6
 *
 * Runs inside the DSH dynamic-plugin sandbox as the body of an async function.
 * IMPORTANT: in the real sandbox only `console` / `harness` / `btoa` / `atob` /
 * TextEncoder / TextDecoder exist as free variables — `ctx` exists solely as the
 * `apply(ctx)` parameter. Every function that touches `ctx` (shell, credentials,
 * timers, events) must therefore be defined INSIDE `apply(ctx)` so it closes over
 * the parameter; a module-level function referencing `ctx` throws
 * `ctx is not defined` the first time it runs.
 *
 * What it does:
 *  1. Pulls DeepSeek Open-Platform usage for the current month from the (private)
 *     dashboard endpoints /api/v0/usage/amount and /api/v0/usage/cost using the
 *     platform `userToken` (browser session token). Returns per-day series (days)
 *     and pre-computed range aggregates (today / yesterday / this week / this
 *     month) with per-model breakdown, for the time-range selector UI.
 *  2. Pulls the account balance from https://api.deepseek.com/user/balance using the
 *     DSH-resolved DEEPSEEK_API_KEY (or the token as a fallback).
 *  3. Aggregates DSH's OWN live consumption from `session/event`
 *     (`assistant/message` carries TokenUsage at `event.data.usage`) — requests,
 *     input, cache-read, output — with an estimated USD cost at DeepSeek list
 *     prices, plus per-hour buckets (last 48h) for the hourly chart.
 *
 * RPC surface (browser half calls these through host.call):
 *   snapshot    -> current aggregated view (JSON-safe)
 *   getConfig   -> { hasToken, hasApiKey, apiKeySource, tokenLength, apiKeyLength }
 *   setConfig   -> { token?, apiKey? } ('' clears); stores in memory, refreshes
 *   resetLocal  -> zero the DSH-session aggregation counters
 *   refresh     -> force an immediate platform refresh
 */

// ---- Configuration ----
const POLL_PLATFORM_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 30 * 1000
const FETCH_MAX_STDOUT_BYTES = 8 * 1024 * 1024

const DEEPSEEK_PLATFORM_BASE = 'https://platform.deepseek.com'
const DEEPSEEK_API_BASE = 'https://api.deepseek.com'

const PRICES_USD_PER_M = {
  'deepseek-chat': { cacheHit: 0.07, cacheMiss: 0.27, output: 1.10 },
  'deepseek-reasoner': { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
}
const DEFAULT_PRICE = { cacheHit: 0.07, cacheMiss: 0.27, output: 1.10 }

// ---- State (module scope, lives as long as the host half runs) ----
let config = { token: '', apiKey: '' }
let refreshing = false
let refreshQueued = false

const localAgg = { requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, since: Date.now() }
// 'YYYY-MM-DD|HH' -> { requests, input, cacheHit, output } (DSH session hourly buckets)
const localHours = new Map()

let platformCache = null
let balanceCache = null
let errorCache = null
let snapshot = null

// ---- Small helpers (pure, no ctx — safe at module scope) ----
function pad2(n) { return n < 10 ? '0' + n : '' + n }
function errText(e) {
  const m = e && e.message ? e.message : String(e)
  return String(m).slice(0, 500)
}
function localDateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
function hourKeyOf(d) {
  return localDateKey(d) + '|' + pad2(d.getHours())
}
function hourKeyAt(ms) {
  return hourKeyOf(new Date(ms))
}

function emptyAgg() {
  return { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0, models: {} }
}
function mergeAgg(into, from) {
  if (!from) return
  into.requests += from.requests
  into.cacheHit += from.cacheHit
  into.cacheMiss += from.cacheMiss
  into.output += from.output
  into.cost += from.cost
  for (const model of Object.keys(from.models)) {
    const fm = from.models[model]
    if (!into.models[model]) into.models[model] = { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0 }
    const im = into.models[model]
    im.requests += fm.requests
    im.cacheHit += fm.cacheHit
    im.cacheMiss += fm.cacheMiss
    im.output += fm.output
    im.cost += fm.cost
  }
}

// Fold one endpoint's `total`/`days[].data` rows into an aggregate. `isCost`
// selects the cost endpoint (sums amounts as money) vs the amount endpoint.
function addRows(agg, rows, isCost) {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const model = typeof row.model === 'string' && row.model ? row.model : 'unknown'
    const usage = Array.isArray(row.usage) ? row.usage : []
    for (const u of usage) {
      if (!u || typeof u !== 'object') continue
      const n = Number(u.amount)
      if (!Number.isFinite(n)) continue
      if (!agg.models[model]) agg.models[model] = { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0 }
      const m = agg.models[model]
      if (isCost) {
        agg.cost += n
        m.cost += n
        continue
      }
      if (u.type === 'REQUEST') { agg.requests += n; m.requests += n }
      else if (u.type === 'PROMPT_CACHE_HIT_TOKEN') { agg.cacheHit += n; m.cacheHit += n }
      else if (u.type === 'PROMPT_CACHE_MISS_TOKEN') { agg.cacheMiss += n; m.cacheMiss += n }
      else if (u.type === 'RESPONSE_TOKEN') { agg.output += n; m.output += n }
    }
  }
}

function aggToJson(agg) {
  const input = agg.cacheHit + agg.cacheMiss
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
    .slice(0, 8)
  return {
    requests: agg.requests,
    cacheHit: agg.cacheHit,
    cacheMiss: agg.cacheMiss,
    output: agg.output,
    input,
    cost: agg.cost,
    cacheHitRate: input > 0 ? Math.round((agg.cacheHit / input) * 1000) / 10 : 0,
    byModel,
  }
}

function localEstimateUsd() {
  const p = DEFAULT_PRICE
  return (localAgg.cacheReadTokens / 1e6) * p.cacheHit
    + (localAgg.inputTokens / 1e6) * p.cacheMiss
    + (localAgg.outputTokens / 1e6) * p.output
}

function localToJson() {
  const nowMs = Date.now()
  const floor = hourKeyAt(nowMs - 48 * 3600 * 1000)
  const hours = Array.from(localHours.entries())
    .filter((pair) => pair[0] >= floor)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((pair) => {
      const sep = pair[0].indexOf('|')
      return {
        date: pair[0].slice(0, sep),
        h: pair[0].slice(sep + 1),
        requests: pair[1].requests,
        input: pair[1].input,
        cacheHit: pair[1].cacheHit,
        output: pair[1].output,
      }
    })
  return {
    requests: localAgg.requests,
    inputTokens: localAgg.inputTokens,
    cacheReadTokens: localAgg.cacheReadTokens,
    cacheMissTokens: localAgg.inputTokens,
    outputTokens: localAgg.outputTokens,
    estimatedCostUsd: Math.round(localEstimateUsd() * 10000) / 10000,
    since: localAgg.since,
    hours,
  }
}

function configFacts() {
  return {
    hasToken: !!config.token,
    hasApiKey: !!config.apiKey,
    apiKeySource: config.apiKey ? 'user' : 'credentials',
    tokenLength: config.token ? config.token.length : 0,
    apiKeyLength: config.apiKey ? config.apiKey.length : 0,
  }
}

// ---- Snapshot assembly (pure, module-safe) ----
function publish() {
  snapshot = {
    platform: platformCache,
    local: localToJson(),
    balance: balanceCache,
    config: configFacts(),
    lastUpdated: Date.now(),
    error: errorCache,
  }
  return snapshot
}

// ---- Plugin ----
return {
  name: 'dsh-usage-panel-host',
  inject: ['shell', 'timer', 'credentials'],
  apply(ctx) {
    // HTTP through a node subprocess (ctx.shell on Windows runs pwsh).
    const NODE_FETCH_E =
      'node -e "const r=JSON.parse(process.env.DSHUP_REQ);'
      + 'const h=Object.assign({accept:\'application/json\'},r.headers||{});'
      + 'fetch(r.url,{method:r.method||\'GET\',headers:h})'
      + '.then(async x=>{const t=await x.text();if(!x.ok){console.error(\'HTTP \'+x.status+\' \'+t.slice(0,400));process.exitCode=1}else{process.stdout.write(t)}})'
      + '.catch(e=>{console.error(\'NET \'+String(e&&e.message||e));process.exitCode=2})"'

    async function httpGet(url, bearer) {
      const req = { url, headers: bearer ? { Authorization: 'Bearer ' + bearer } : {} }
      const result = await ctx.shell.run(ctx.shell.resolve({
        command: NODE_FETCH_E,
        env: { DSHUP_REQ: JSON.stringify(req) },
        timeoutMs: FETCH_TIMEOUT_MS,
        stdoutMaxBytes: FETCH_MAX_STDOUT_BYTES,
      }))
      if (result.exitCode !== 0) {
        const detail = result.stderr && result.stderr.text ? result.stderr.text.trim().slice(0, 300) : ''
        throw new Error('HTTP ' + url + ' failed (exit ' + result.exitCode + ')' + (detail ? ': ' + detail : ''))
      }
      const text = result.stdout && result.stdout.text ? result.stdout.text : ''
      if (text.length === 0) throw new Error('HTTP ' + url + ' returned an empty body')
      return text
    }

    function assertPlatformOk(j, label) {
      if (j && typeof j === 'object' && typeof j.code === 'number' && j.code !== 0) {
        const msg = j.msg || j.message || ''
        throw new Error(label + ' 平台返回 code=' + j.code + (msg ? ': ' + msg : ''))
      }
    }

    async function fetchPlatform(token) {
      const now = new Date()
      const month = now.getMonth() + 1
      const year = now.getFullYear()
      const amountUrl = DEEPSEEK_PLATFORM_BASE + '/api/v0/usage/amount?month=' + month + '&year=' + year
      const costUrl = DEEPSEEK_PLATFORM_BASE + '/api/v0/usage/cost?month=' + month + '&year=' + year

      const [amountText, costText] = await Promise.all([httpGet(amountUrl, token), httpGet(costUrl, token)])
      const amt = JSON.parse(amountText)
      const cst = JSON.parse(costText)
      assertPlatformOk(amt, 'usage/amount')
      assertPlatformOk(cst, 'usage/cost')

      const amtData = amt && amt.data && amt.data.biz_data
      const cstBiz = Array.isArray(cst && cst.data && cst.data.biz_data) ? cst.data.biz_data[0] : undefined

      const totals = emptyAgg()
      addRows(totals, amtData ? amtData.total : undefined, false)
      addRows(totals, cstBiz ? cstBiz.total : undefined, true)

      const todayKey = localDateKey(now)

      // Per-day aggregates (kept with per-model detail for range sums).
      const dayMap = new Map()
      function addDay(date, rows, isCost) {
        if (!date || !Array.isArray(rows)) return
        let a = dayMap.get(date)
        if (!a) { a = emptyAgg(); dayMap.set(date, a) }
        addRows(a, rows, isCost)
      }
      if (amtData && Array.isArray(amtData.days)) {
        for (const d of amtData.days) { if (d && typeof d.date === 'string') addDay(d.date, d.data, false) }
      }
      if (cstBiz && Array.isArray(cstBiz.days)) {
        for (const d of cstBiz.days) { if (d && typeof d.date === 'string') addDay(d.date, d.data, true) }
      }

      const dayKeys = Array.from(dayMap.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

      // Daily series for the token-consumption chart (last 31 days).
      const days = dayKeys.slice(-31).map((key) => {
        const g = aggToJson(dayMap.get(key))
        return {
          date: key.slice(5), // MM-DD (chart x label)
          full: key, // YYYY-MM-DD (used to scope the week/month chart)
          requests: g.requests,
          input: g.input,
          cacheHit: g.cacheHit,
          cacheMiss: g.cacheMiss,
          output: g.output,
          cost: Math.round(g.cost * 100) / 100,
        }
      })

      // Range summaries: today / yesterday / this calendar week / this month.
      const yesterdayKey = localDateKey(new Date(now.getTime() - 86400000))
      const dow = (now.getDay() + 6) % 7 // Monday=0
      const mondayKey = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow))
      function sumRange(keys) {
        const a = emptyAgg()
        for (const k of keys) { const d = dayMap.get(k); if (d) mergeAgg(a, d) }
        return aggToJson(a)
      }
      const ranges = {
        today: sumRange([todayKey]),
        yesterday: sumRange([yesterdayKey]),
        week: sumRange(dayKeys.filter((k) => k >= mondayKey && k <= todayKey)),
        month: aggToJson(totals),
      }

      return {
        month: year + '-' + pad2(month),
        monthPrefix: year + '-' + pad2(month), // current month 'YYYY-MM' for chart scoping
        weekStart: mondayKey, // Monday of this week
        weekEnd: todayKey,
        currency: (cstBiz && cstBiz.currency) || 'CNY',
        totals: aggToJson(totals),
        days,
        ranges,
      }
    }

    async function fetchBalance() {
      let key = config.apiKey || ''
      let source = 'user'
      if (!key) {
        try {
          const cred = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
          if (cred && cred.value) { key = cred.value; source = 'credentials' }
        } catch (e) {
          // credentials service unavailable or reference missing — user key only
        }
      }
      if (!key && config.token) { key = config.token; source = 'token' }
      if (!key) return null
      const text = await httpGet(DEEPSEEK_API_BASE + '/user/balance', key)
      const j = JSON.parse(text)
      const infos = Array.isArray(j && j.balance_infos) ? j.balance_infos : []
      return {
        source,
        available: !!j.is_available,
        infos: infos.map((i) => ({
          currency: i.currency || 'CNY',
          total: Number(i.total_balance) || 0,
          granted: Number(i.granted_balance) || 0,
          toppedUp: Number(i.topped_up_balance) || 0,
        })),
      }
    }

    async function refresh() {
      if (refreshing) {
        refreshQueued = true
        return
      }
      refreshing = true
      try {
        if (config.token) {
          try {
            platformCache = await fetchPlatform(config.token)
            errorCache = null
          } catch (e) {
            platformCache = null
            errorCache = '平台用量获取失败: ' + errText(e)
          }
        } else {
          platformCache = null
          errorCache = '未配置平台 Token：展开面板粘贴 platform.deepseek.com 的 userToken 后可显示平台用量与金额'
        }
        try {
          balanceCache = await fetchBalance()
        } catch (e) {
          balanceCache = null
        }
      } catch (e) {
        errorCache = '刷新失败: ' + errText(e)
      } finally {
        refreshing = false
        publish()
        if (refreshQueued) {
          refreshQueued = false
          refresh()
        }
      }
    }

    // Live DSH consumption. NOTE: the appended SessionEvent is
    // { type, seq, time, data }, and TokenUsage lives at event.data.usage
    // ({ inputTokens, outputTokens, cacheReadTokens, ... }).
    ctx.on('session/event', (session, event) => {
      try {
        if (!event || event.type !== 'assistant/message') return
        const data = event.data || {}
        const u = data.usage
        localAgg.requests += 1
        const input = (u && u.inputTokens) || 0
        const cacheHit = (u && u.cacheReadTokens) || 0
        const output = (u && u.outputTokens) || 0
        localAgg.inputTokens += input
        localAgg.cacheReadTokens += cacheHit
        localAgg.outputTokens += output
        const hk = hourKeyOf(new Date())
        let b = localHours.get(hk)
        if (!b) { b = { requests: 0, input: 0, cacheHit: 0, output: 0 }; localHours.set(hk, b) }
        b.requests += 1
        b.input += input
        b.cacheHit += cacheHit
        b.output += output
        publish()
      } catch (e) {
        console.error('usage aggregation failed:', e)
      }
    })

    // RPC surface for the browser half.
    harness.handle('snapshot', () => publish())
    harness.handle('getConfig', () => configFacts())
    harness.handle('setConfig', (cfg) => {
      const c = cfg && typeof cfg === 'object' ? cfg : {}
      const token = typeof c.token === 'string' ? c.token.trim() : ''
      const apiKey = typeof c.apiKey === 'string' ? c.apiKey.trim() : ''
      config = { token, apiKey }
      errorCache = null
      publish()
      refresh()
      return { ok: true }
    })
    harness.handle('resetLocal', () => {
      localAgg.requests = 0
      localAgg.inputTokens = 0
      localAgg.cacheReadTokens = 0
      localAgg.outputTokens = 0
      localAgg.since = Date.now()
      localHours.clear()
      publish()
      return { ok: true }
    })
    harness.handle('refresh', () => {
      refresh()
      return { ok: true }
    })

    publish()
    ctx.interval(refresh, POLL_PLATFORM_MS)
    refresh()
  },
}
