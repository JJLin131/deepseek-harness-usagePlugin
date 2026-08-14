/**
 * Local integration test for plugin/host.js — evaluates the host half against a
 * stubbed cordis context and asserts parsing/aggregation against realistic
 * DeepSeek platform payloads (shapes taken from CodexBar's parser tests).
 *
 * Run:  node test/host.test.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const hostSource = readFileSync(join(root, 'plugin', 'host.js'), 'utf8')

const AMOUNT_FIXTURE = {
  code: 0, msg: '',
  data: {
    biz_code: 0, biz_msg: '',
    biz_data: {
      total: [
        { model: 'deepseek-v4-flash', usage: [
          { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '100686720' },
          { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '1305432' },
          { type: 'RESPONSE_TOKEN', amount: '656338' },
          { type: 'REQUEST', amount: '1212' },
        ] },
      ],
      days: [
        { date: todayKey(), data: [
          { model: 'deepseek-v4-flash', usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '500000' },
            { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '20000' },
            { type: 'RESPONSE_TOKEN', amount: '9000' },
            { type: 'REQUEST', amount: '33' },
          ] },
        ] },
      ],
    },
  },
}

const COST_FIXTURE = {
  code: 0, msg: '',
  data: {
    biz_code: 0, biz_msg: '',
    biz_data: [{
      total: [
        { model: 'deepseek-v4-flash', usage: [
          { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '2.0137344000000000' },
          { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '1.3054320000000000' },
          { type: 'RESPONSE_TOKEN', amount: '1.3126760000000000' },
          { type: 'REQUEST', amount: '0' },
        ] },
      ],
      days: [
        { date: todayKey(), data: [
          { model: 'deepseek-v4-flash', usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '0.010000' },
            { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '0.005400' },
            { type: 'RESPONSE_TOKEN', amount: '0.018000' },
            { type: 'REQUEST', amount: '0' },
          ] },
        ] },
      ],
      currency: 'CNY',
    }],
  },
}

const BALANCE_FIXTURE = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '0.00', topped_up_balance: '110.00' },
  ],
}

function todayKey() {
  const d = new Date()
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function pad(n) { return n < 10 ? '0' + n : '' + n }

let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log('  ok  ' + name)
  } else {
    failures++
    console.error('  FAIL ' + name + '\n    expected ' + e + '\n    actual   ' + a)
  }
}
function approx(name, actual, expected, tol = 1e-6) {
  if (Math.abs(actual - expected) <= tol) {
    console.log('  ok  ' + name)
  } else {
    failures++
    console.error('  FAIL ' + name + ' — expected ~' + expected + ', got ' + actual)
  }
}

async function main() {
  const harnessHandlers = {}
  const capturedShell = []
  const eventHandlers = {}
  const intervals = []

  const stubCtx = {
    on: (name, fn) => { eventHandlers[name] = fn; return () => {} },
    interval: (fn) => { intervals.push(fn); return () => {} },
    credentials: { resolve: async (ref) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-test-123', source: 'env' } : undefined) },
    shell: {
      resolve: (req) => req,
      run: async (req) => {
        capturedShell.push(req)
        const payload = req.env.DSHUP_REQ ? JSON.parse(req.env.DSHUP_REQ) : {}
        const url = payload.url || ''
        const auth = (payload.headers && payload.headers.Authorization) || ''
        let text = ''
        if (auth.includes('FAIL')) return { exitCode: 1, stdout: { text: '', truncated: false }, stderr: { text: 'HTTP 401 unauthorized' } }
        if (auth.includes('tok-bad')) text = JSON.stringify({ code: 40003, msg: 'Authorization Failed (invalid token)', data: null })
        else if (url.includes('/usage/amount')) text = JSON.stringify(AMOUNT_FIXTURE)
        else if (url.includes('/usage/cost')) text = JSON.stringify(COST_FIXTURE)
        else if (url.includes('/user/balance')) text = JSON.stringify(BALANCE_FIXTURE)
        return { exitCode: 0, stdout: { text, truncated: false }, stderr: { text: '' } }
      },
    },
  }
  const stubHarness = { handle: (method, fn) => { harnessHandlers[method] = fn } }
  const stubConsole = { log: () => {}, error: (m) => console.error('  [host console.error]', m) }

  // Evaluate exactly like the REAL host sandbox: only `harness` and `console`
  // exist as free variables — `ctx` must NOT be one. A module-level function
  // referencing `ctx` (the bug that produced "ctx is not defined" in the real
  // panel) therefore throws here instead of shipping.
  const factory = new Function('harness', 'console', `return (async () => {\n${hostSource}\n})()`)
  const plugin = await factory(stubHarness, stubConsole)
  plugin.apply(stubCtx)

  const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms))

  console.log('· plugin shape')
  check('plugin has name', plugin.name, 'dsh-usage-panel-host')
  check('injects shell/timer/credentials', plugin.inject, ['shell', 'timer', 'credentials'])
  check('handlers registered', Object.keys(harnessHandlers).sort(), ['getConfig', 'refresh', 'resetLocal', 'setConfig', 'snapshot'])
  check('session/event subscribed', typeof eventHandlers['session/event'], 'function')

  console.log('· initial state (no token, but DSH credentials resolve a key)')
  await tick()
  let snap = harnessHandlers.snapshot()
  check('platform null without token', snap.platform, null)
  check('error mentions token', snap.error !== null && snap.error.includes('Token'), true)
  check('balance from credentials', snap.balance !== null && snap.balance.source, 'credentials')

  console.log('· platform usage + balance via token (credentials key)')
  harnessHandlers.setConfig({ token: 'tok-abc', apiKey: '' })
  await tick()
  snap = harnessHandlers.snapshot()
  check('platform loaded', snap.platform !== null, true)
  const t = snap.platform.totals
  check('requests', t.requests, 1212)
  check('cacheHit', t.cacheHit, 100686720)
  check('cacheMiss', t.cacheMiss, 1305432)
  check('output', t.output, 656338)
  check('input', t.input, 101992152)
  approx('cacheHitRate', t.cacheHitRate, 98.7, 0.1)
  approx('total cost CNY', t.cost, 2.0137344 + 1.305432 + 1.312676, 1e-9)
  check('currency', snap.platform.currency, 'CNY')
  check('month label', snap.platform.month, new Date().getFullYear() + '-' + pad(new Date().getMonth() + 1))
  check('byModel row', t.byModel.length, 1)
  check('today requests', snap.platform.ranges.today.requests, 33)
  check('today cost', Math.round(snap.platform.ranges.today.cost * 100000) / 100000, 0.010000 + 0.0054 + 0.018)
  check('balance from credentials', snap.balance !== null && snap.balance.source, 'credentials')
  check('balance total', snap.balance.infos[0].total, 110)
  check('error cleared', snap.error, null)
  check('config facts', snap.config, {
    hasToken: true, hasApiKey: false, apiKeySource: 'credentials', tokenLength: 7, apiKeyLength: 0,
  })

  console.log('· local DSH aggregation from session/event')
  // NOTE: the appended SessionEvent is { type, seq, time, data }; TokenUsage
  // lives at event.data.usage ({ inputTokens, outputTokens, cacheReadTokens }).
  eventHandlers['session/event'](null, { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80 } } })
  eventHandlers['session/event'](null, { type: 'assistant/chunk', chunk: { type: 'text-delta', text: 'x' } })
  snap = harnessHandlers.snapshot()
  check('local requests', snap.local.requests, 1)
  check('local inputTokens', snap.local.inputTokens, 100)
  check('local cacheReadTokens', snap.local.cacheReadTokens, 80)
  check('local outputTokens', snap.local.outputTokens, 20)
  approx('local estimate USD', snap.local.estimatedCostUsd, Math.round((80 / 1e6 * 0.07 + 100 / 1e6 * 0.27 + 20 / 1e6 * 1.10) * 10000) / 10000, 1e-12)

  console.log('· resetLocal')
  harnessHandlers.resetLocal()
  snap = harnessHandlers.snapshot()
  check('local reset', snap.local.requests, 0)

  console.log('· platform failure path')
  harnessHandlers.setConfig({ token: 'FAIL' })
  await tick()
  snap = harnessHandlers.snapshot()
  check('platform null on failure', snap.platform, null)
  check('error surfaces http status', snap.error !== null && snap.error.includes('401'), true)
  check('local survives failure', typeof snap.local.requests, 'number')

  console.log('· platform business error (invalid token -> code 40003)')
  harnessHandlers.setConfig({ token: 'tok-bad' })
  await tick()
  snap = harnessHandlers.snapshot()
  check('platform null on 40003', snap.platform, null)
  check('error surfaces 40003', snap.error !== null && snap.error.includes('40003'), true)

  console.log('· getConfig never echoes secrets')
  const cfg = harnessHandlers.getConfig()
  check('no token in getConfig', JSON.stringify(cfg).includes('tok-abc'), false)
  check('getConfig reports token length', cfg.tokenLength, 7)

  console.log('· setConfig stores trimmed values')
  harnessHandlers.setConfig({ token: '  tok-xyz  ', apiKey: ' sk-1 ' })
  await tick()
  snap = harnessHandlers.snapshot()
  check('hasToken true', snap.config.hasToken, true)
  check('apiKeySource user', snap.config.apiKeySource, 'user')

  console.log('· HTTP helper command is shell-safe (no $ or double quotes)')
  const req = capturedShell[0]
  const code = req.command
  check('no $ in -e payload', code.includes('$'), false)
  check('no backticks', code.includes('`'), false)
  check('node -e used', code.startsWith('node -e'), true)

  console.log('· harness handler returns are JSON-safe')
  const j = JSON.parse(JSON.stringify(harnessHandlers.snapshot()))
  check('snapshot serializes', typeof j.lastUpdated, 'number')

  if (failures === 0) {
    console.log('\nALL PASS')
    process.exit(0)
  } else {
    console.error(`\n${failures} FAILURE(S)`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('test crashed:', e)
  process.exit(2)
})
