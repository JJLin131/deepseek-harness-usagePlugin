/**
 * DeepSeek Usage Panel — HOST half (server side).
 *
 * Runs inside the DSH dynamic-plugin sandbox as the body of an async function.
 * Closure symbols available here: ctx, harness, console (+ btoa/atob, TextEncoder/Decoder).
 * No fetch / require / setTimeout / process — network goes through ctx.shell running a
 * tiny node subprocess, timers through ctx.interval (inject 'timer'), and the DeepSeek
 * API key (optional, for balance) through ctx.credentials.
 *
 * What it does:
 *  1. Pulls DeepSeek Open-Platform usage for the current month from the (private)
 *     dashboard endpoints /api/v0/usage/amount and /api/v0/usage/cost using the
 *     platform `userToken` (browser session token) the user configures from the UI.
 *     These return the exact breakdown the panel shows: request_count,
 *     input cache-hit tokens, input cache-miss tokens, output tokens, and billed cost.
 *  2. Pulls the account balance from https://api.deepseek.com/user/balance using the
 *     DSH-resolved DEEPSEEK_API_KEY (or the token as a fallback).
 *  3. Always aggregates DSH's OWN live consumption from `session/event`
 *     (`assistant/message` carries TokenUsage) — requests, input, cache-read, output —
 *     with an estimated USD cost at DeepSeek list prices.
 *
 * RPC surface (browser half calls these through host.call):
 *   snapshot    -> current aggregated view (JSON-safe)
 *   getConfig   -> { hasToken, hasApiKey, apiKeySource } (never echoes secrets)
 *   setConfig   -> { token?, apiKey? } ('' clears); stores in memory, refreshes
 *   resetLocal  -> zero the DSH-session aggregation counters
 */

// ---- Configuration ----
const POLL_PLATFORM_MS = 60 * 1000 // how often the host re-fetches platform data
const FETCH_TIMEOUT_MS = 30 * 1000
const FETCH_MAX_STDOUT_BYTES = 8 * 1024 * 1024

const DEEPSEEK_PLATFORM_BASE = 'https://platform.deepseek.com'
const DEEPSEEK_API_BASE = 'https://api.deepseek.com'

// USD list prices per 1M tokens (used only for the LOCAL estimate; the platform
// endpoint reports the real billed cost and currency). Edit freely.
const PRICES_USD_PER_M = {
  'deepseek-chat': { cacheHit: 0.07, cacheMiss: 0.27, output: 1.10 },
  'deepseek-reasoner': { cacheHit: 0.14, cacheMiss: 0.55, output: 2.19 },
}
const DEFAULT_PRICE = { cacheHit: 0.07, cacheMiss: 0.27, output: 1.10 }

// ---- State ----
let config = { token: '', apiKey: '' }
let refreshing = false
let refreshQueued = false

const localAgg = { requests: 0, inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, since: Date.now() }

// Caches filled by refresh(); assembled into `snapshot` by publish().
let platformCache = null
let balanceCache = null
let errorCache = null

// The JSON-safe view the browser polls.
let snapshot = null

// ---- Small helpers ----
function pad2(n) { return n < 10 ? '0' + n : '' + n }
function errText(e) {
  const m = e && e.message ? e.message : String(e)
  return String(m).slice(0, 500)
}

// ---- HTTP through a node subprocess ----
// ctx.shell on Windows runs `pwsh -Command <command>`; the command is one argv
// element, so the -e payload must not contain double quotes or `$`. The request
// rides in the DSHUP_REQ environment entry as JSON (no shell quoting involved).
const NODE_FETCH_E =
  'node -e "const r=JSON.parse(process.env.DSHUP_REQ);'
  + 'const h=Object.assign({accept:\'application/json\'},r.headers||{});'
  + 'fetch(r.url,{method:r.method||\'GET\',headers:h})'
  + '.then(async x=>{const t=await x.text();if(!x.ok){console.error(\'HTTP \'+x.status+\' \'+t.slice(0,400));process.exit(1)}process.stdout.write(t)})'
  + '.catch(e=>{console.error(\'NET \'+String(e&&e.message||e));process.exit(2)})"'

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

// ---- Platform usage aggregation ----
function emptyAgg() {
  return { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0, models: {} }
}

// Fold one endpoint's `total`/`days[].data` rows into an aggregate. `isCost`
// selects the cost endpoint (sums amounts as money) vs the amount endpoint
// (token/request counts by type).
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
      if (isCost) {
        agg.cost += n
        if (!agg.models[model]) agg.models[model] = { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0 }
        agg.models[model].cost += n
        continue
      }
      if (!agg.models[model]) agg.models[model] = { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, cost: 0 }
      const m = agg.models[model]
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

function localDateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
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

  const amtData = amt && amt.data && amt.data.biz_data
  const cstBiz = Array.isArray(cst && cst.data && cst.data.biz_data) ? cst.data.biz_data[0] : undefined

  const totals = emptyAgg()
  addRows(totals, amtData ? amtData.total : undefined, false)
  addRows(totals, cstBiz ? cstBiz.total : undefined, true)

  const today = emptyAgg()
  const todayKey = localDateKey(now)
  if (amtData && Array.isArray(amtData.days)) {
    for (const d of amtData.days) { if (d && d.date === todayKey) addRows(today, d.data, false) }
  }
  if (cstBiz && Array.isArray(cstBiz.days)) {
    for (const d of cstBiz.days) { if (d && d.date === todayKey) addRows(today, d.data, true) }
  }

  return {
    month: year + '-' + pad2(month),
    currency: (cstBiz && cstBiz.currency) || 'CNY',
    totals: aggToJson(totals),
    today: aggToJson(today),
  }
}

// ---- Balance ----
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

// ---- Local (DSH session) aggregation ----
function localEstimateUsd() {
  const p = DEFAULT_PRICE
  return (localAgg.cacheReadTokens / 1e6) * p.cacheHit
    + (localAgg.inputTokens / 1e6) * p.cacheMiss
    + (localAgg.outputTokens / 1e6) * p.output
}

function localToJson() {
  return {
    requests: localAgg.requests,
    inputTokens: localAgg.inputTokens,
    cacheReadTokens: localAgg.cacheReadTokens,
    cacheMissTokens: localAgg.inputTokens,
    outputTokens: localAgg.outputTokens,
    estimatedCostUsd: Math.round(localEstimateUsd() * 10000) / 10000,
    since: localAgg.since,
  }
}

function configFacts() {
  return {
    hasToken: !!config.token,
    hasApiKey: !!config.apiKey,
    apiKeySource: config.apiKey ? 'user' : 'credentials',
  }
}

// ---- Snapshot assembly ----
function publish() {
  const local = localToJson()
  snapshot = {
    platform: platformCache,
    local,
    balance: balanceCache,
    config: configFacts(),
    lastUpdated: Date.now(),
    error: errorCache,
  }
  return snapshot
}

// ---- Platform refresh (network) ----
async function refresh() {
  // A refresh already in flight would read the stale config; queue one more
  // run so a setConfig arriving mid-flight still picks up the new token/key.
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
      // Balance is a bonus; do not let its failure replace the main error.
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

// ---- Plugin ----
return {
  name: 'dsh-usage-panel-host',
  inject: ['shell', 'timer', 'credentials'],
  apply(ctx) {
    // Live DSH consumption: assistant/message events carry per-request TokenUsage.
    ctx.on('session/event', (session, event) => {
      try {
        if (!event || event.type !== 'assistant/message' || !event.usage) return
        const u = event.usage
        localAgg.requests += 1
        localAgg.inputTokens += u.inputTokens || 0
        localAgg.cacheReadTokens += u.cacheReadTokens || 0
        localAgg.outputTokens += u.outputTokens || 0
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
      publish()
      return { ok: true }
    })

    // Initial state, then periodic platform refresh.
    publish()
    ctx.interval(refresh, POLL_PLATFORM_MS)
    refresh()
  },
}
