/**
 * DeepSeek Usage Panel — CLIENT half (browser).
 *
 * Runs as the body of an async function in the page; closure symbols are
 * React, console, styles, host (no imports, no JSX, no global timers).
 *
 * Placement is user-selectable and remembered in localStorage:
 *   - 'dock'       -> a readout line in the band under the composer
 *                     (slot `conversation.composer.dock`)
 *   - 'top-right'  -> a floating widget pinned to the top-right corner
 *   - 'bottom-right' -> a floating widget pinned to the bottom-right corner
 * The floating widget lives in the frame-wide `shell.overlay` slot (root
 * scope: visible with or without a session) and the component returns null
 * unless its position matches, so only one surface renders at a time.
 *
 * The host half owns all network access; this half polls
 * `host.call('snapshot')` every 2s, keeps the user's platform userToken /
 * API key / position in localStorage, and pushes secrets to the host with
 * `host.call('setConfig', …)`.
 */

// ---- store: snapshot + config facts + placement, version-proof React binding ----
let state = {
  data: null,
  config: { hasToken: false, hasApiKey: false, apiKeySource: 'credentials' },
  position: 'bottom-right', // dock | top-right | bottom-right
  status: 'loading', // loading | ok | error
  message: null,
}
const listeners = new Set()

function setState(patch) {
  state = Object.assign({}, state, patch)
  for (const fn of listeners) fn()
}
function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function getState() { return state }

let polling = false
async function refresh() {
  if (polling) return
  polling = true
  try {
    const data = await host.call('snapshot')
    setState({ data, status: 'ok', message: null })
  } catch (e) {
    setState({ status: 'error', message: String(e && e.message || e) })
  } finally {
    polling = false
  }
}
async function refreshConfig() {
  try {
    const cfg = await host.call('getConfig')
    if (cfg && typeof cfg === 'object') setState({ config: cfg })
  } catch (e) {
    // non-fatal
  }
}

// ---- persistence (browser-local; secrets never leave this origin except to the host) ----
function readSaved() {
  try {
    const raw = localStorage.getItem('dsh-usage.config')
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}
function writeSaved(patch) {
  const next = Object.assign(readSaved(), patch)
  try {
    localStorage.setItem('dsh-usage.config', JSON.stringify(next))
  } catch (e) { /* storage unavailable */ }
  return next
}
function setPosition(pos) {
  if (pos !== 'dock' && pos !== 'top-right' && pos !== 'bottom-right') return
  writeSaved({ position: pos })
  setState({ position: pos })
}

// ---- formatting ----
function fmtInt(n) {
  const v = Math.round(Number(n) || 0)
  return ('' + v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
function fmtTokens(n) {
  const v = Number(n) || 0
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return '' + Math.round(v)
}
function fmtMoney(n, currency) {
  const v = Number(n) || 0
  return (currency === 'CNY' ? '¥' : '$') + v.toFixed(2)
}
function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0')
}

// ---- CSS (theme variables, removed automatically on unload) ----
const CSS = `
.dshup-row {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-secondary);
  cursor: pointer; user-select: none; padding: 2px 0; flex-wrap: wrap;
}
.dshup-row:hover { color: var(--dsw-alias-label-primary); }
.dshup-title { font-weight: 600; color: var(--dsw-alias-label-primary); white-space: nowrap; }
.dshup-num { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshup-accent { color: var(--dsw-alias-brand-primary); font-variant-numeric: tabular-nums; }
.dshup-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.dshup-dot-ok { background: var(--dsw-alias-state-success-primary); }
.dshup-dot-warn { background: var(--dsw-alias-state-error-primary); }
.dshup-caret { opacity: .6; }
.dshup-panel {
  margin: 6px 0 4px; padding: 10px 12px; border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  font-size: 12px; color: var(--dsw-alias-label-secondary); max-height: 60vh; overflow: auto;
}
.dshup-sec { margin: 8px 0 2px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 4px 12px; }
.dshup-grid div { display: flex; justify-content: space-between; gap: 8px; }
.dshup-grid b { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; font-weight: 600; }
.dshup-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11.5px; }
.dshup-table th, .dshup-table td { text-align: right; padding: 2px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); font-variant-numeric: tabular-nums; }
.dshup-table th:first-child, .dshup-table td:first-child { text-align: left; }
.dshup-table th { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.dshup-err { color: var(--dsw-alias-state-error-primary); margin-top: 4px; word-break: break-all; }
.dshup-form { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.dshup-form label { display: flex; flex-direction: column; gap: 2px; }
.dshup-form input, .dshup-form select {
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 5px 8px; font-size: 12px;
}
.dshup-btn {
  align-self: flex-start; cursor: pointer; font-size: 12px; padding: 4px 12px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
}
.dshup-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.dshup-hint { opacity: .75; font-size: 11px; }
/* floating widget */
.dshup-float {
  position: fixed; z-index: 900; pointer-events: auto;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
}
.dshup-float-tr { top: 14px; right: 18px; }
.dshup-float-br { bottom: 18px; right: 18px; flex-direction: column-reverse; }
.dshup-pill {
  display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none;
  padding: 6px 12px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .12);
  white-space: nowrap;
}
.dshup-pill:hover { border-color: var(--dsw-alias-brand-primary); }
.dshup-card {
  padding: 10px 12px; border-radius: 10px; width: min(430px, calc(100vw - 36px));
  background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .18); max-height: min(70vh, 620px); overflow: auto;
}
`

// ---- React components ----
function useStore() {
  const [, force] = React.useState(0)
  React.useEffect(() => subscribe(() => force(n => n + 1)), [])
  return getState()
}

function StatusDot(props) {
  return React.createElement('span', {
    className: 'dshup-dot ' + (props.error ? 'dshup-dot-warn' : 'dshup-dot-ok'),
    title: props.error || '',
  })
}

function CompactBody(props) {
  const { data, status } = props
  const p = data && data.platform
  const l = data && data.local
  if (p) {
    const t = p.totals
    return React.createElement(React.Fragment, null,
      React.createElement('span', null, '请求 ', React.createElement('b', { className: 'dshup-num' }, fmtInt(t.requests))),
      React.createElement('span', null, '输入 ', React.createElement('b', { className: 'dshup-num' }, fmtTokens(t.input)),
        ' · 缓存 ', React.createElement('b', { className: 'dshup-num' }, t.cacheHitRate + '%')),
      React.createElement('span', null, '输出 ', React.createElement('b', { className: 'dshup-num' }, fmtTokens(t.output))),
      React.createElement('span', null, '费用 ', React.createElement('b', { className: 'dshup-accent' }, fmtMoney(t.cost, p.currency))),
      React.createElement('span', { className: 'dshup-hint' }, '（' + p.month + '）'),
    )
  }
  if (l && l.requests > 0) {
    return React.createElement(React.Fragment, null,
      React.createElement('span', null, 'DSH 实时 ', React.createElement('b', { className: 'dshup-num' }, fmtInt(l.requests)), ' 次'),
      React.createElement('span', null, '输入 ', React.createElement('b', { className: 'dshup-num' }, fmtTokens(l.inputTokens)),
        ' · 缓存 ', React.createElement('b', { className: 'dshup-num' }, fmtTokens(l.cacheReadTokens))),
      React.createElement('span', null, '输出 ', React.createElement('b', { className: 'dshup-num' }, fmtTokens(l.outputTokens))),
      React.createElement('span', null, '估算 ', React.createElement('b', { className: 'dshup-accent' }, '$' + (l.estimatedCostUsd || 0).toFixed(4))),
    )
  }
  if (status === 'ok') {
    return React.createElement('span', { className: 'dshup-hint' }, '未配置平台 Token，点击展开配置（DSH 实时用量将自动统计）')
  }
  return React.createElement('span', { className: 'dshup-hint' }, '加载中…')
}

function Detail(props) {
  const { data, config, position } = props
  const [token, setToken] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [saved, setSaved] = React.useState(false)
  const p = data && data.platform
  const l = data && data.local
  const b = data && data.balance

  const save = () => {
    writeSaved({ token, apiKey })
    host.call('setConfig', { token, apiKey }).then(() => {
      setSaved(true)
      refresh()
      setTimeout(() => setSaved(false), 2000)
    }).catch(() => {})
  }
  const resetLocal = () => { host.call('resetLocal').then(() => refresh()).catch(() => {}) }

  const rows = []
  if (p) {
    rows.push(React.createElement('div', { key: 'sec-p', className: 'dshup-sec' },
      '平台（' + p.month + '，' + p.currency + '）'))
    rows.push(React.createElement('div', { key: 'g-p', className: 'dshup-grid' },
      React.createElement('div', null, React.createElement('span', null, '请求次数'), React.createElement('b', null, fmtInt(p.totals.requests))),
      React.createElement('div', null, React.createElement('span', null, '输入·缓存命中'), React.createElement('b', null, fmtTokens(p.totals.cacheHit))),
      React.createElement('div', null, React.createElement('span', null, '输入·缓存未命中'), React.createElement('b', null, fmtTokens(p.totals.cacheMiss))),
      React.createElement('div', null, React.createElement('span', null, '输出'), React.createElement('b', null, fmtTokens(p.totals.output))),
      React.createElement('div', null, React.createElement('span', null, '缓存命中率'), React.createElement('b', null, p.totals.cacheHitRate + '%')),
      React.createElement('div', null, React.createElement('span', null, '消费金额'), React.createElement('b', { className: 'dshup-accent' }, fmtMoney(p.totals.cost, p.currency))),
    ))
    rows.push(React.createElement('div', { key: 'sec-t', className: 'dshup-sec' }, '今日'))
    rows.push(React.createElement('div', { key: 'g-t', className: 'dshup-grid' },
      React.createElement('div', null, React.createElement('span', null, '请求次数'), React.createElement('b', null, fmtInt(p.today.requests))),
      React.createElement('div', null, React.createElement('span', null, '输入·缓存命中'), React.createElement('b', null, fmtTokens(p.today.cacheHit))),
      React.createElement('div', null, React.createElement('span', null, '输入·缓存未命中'), React.createElement('b', null, fmtTokens(p.today.cacheMiss))),
      React.createElement('div', null, React.createElement('span', null, '输出'), React.createElement('b', null, fmtTokens(p.today.output))),
      React.createElement('div', null, React.createElement('span', null, '消费金额'), React.createElement('b', { className: 'dshup-accent' }, fmtMoney(p.today.cost, p.currency))),
    ))
    if (p.totals.byModel && p.totals.byModel.length > 0) {
      rows.push(React.createElement('div', { key: 'sec-m', className: 'dshup-sec' }, '按模型'))
      rows.push(React.createElement('table', { key: 'tbl', className: 'dshup-table' },
        React.createElement('thead', null, React.createElement('tr', null,
          React.createElement('th', null, '模型'),
          React.createElement('th', null, '请求'),
          React.createElement('th', null, '缓存命中'),
          React.createElement('th', null, '缓存未命中'),
          React.createElement('th', null, '输出'),
          React.createElement('th', null, '金额'))),
        React.createElement('tbody', null, p.totals.byModel.map((m) =>
          React.createElement('tr', { key: m.model },
            React.createElement('td', null, m.model),
            React.createElement('td', null, fmtInt(m.requests)),
            React.createElement('td', null, fmtTokens(m.cacheHit)),
            React.createElement('td', null, fmtTokens(m.cacheMiss)),
            React.createElement('td', null, fmtTokens(m.output)),
            React.createElement('td', null, fmtMoney(m.cost, p.currency)))))))
    }
  } else {
    rows.push(React.createElement('div', { key: 'sec-no', className: 'dshup-sec' }, '平台数据'))
    rows.push(React.createElement('div', { key: 'no', className: 'dshup-hint' },
      data && data.error ? data.error : '配置平台 Token 后显示 DeepSeek 开放平台的请求次数 / Token 消耗 / 消费金额。'))
  }

  if (b && b.infos.length > 0) {
    rows.push(React.createElement('div', { key: 'sec-b', className: 'dshup-sec' },
      '账户余额' + (b.source === 'credentials' ? '（DSH 凭据）' : b.source === 'user' ? '（手动配置）' : '（平台 Token）')))
    rows.push(React.createElement('div', { key: 'g-b', className: 'dshup-grid' },
      b.infos.map((i) =>
        React.createElement('div', { key: i.currency },
          React.createElement('span', null, i.currency + ' 总额'),
          React.createElement('b', { className: 'dshup-accent' }, fmtMoney(i.total, i.currency))))))
  }

  rows.push(React.createElement('div', { key: 'sec-l', className: 'dshup-sec' }, 'DSH 实时（本会话，从面板启用起）'))
  rows.push(React.createElement('div', { key: 'g-l', className: 'dshup-grid' },
    React.createElement('div', null, React.createElement('span', null, '请求次数'), React.createElement('b', null, fmtInt(l.requests))),
    React.createElement('div', null, React.createElement('span', null, '输入（未命中缓存）'), React.createElement('b', null, fmtTokens(l.inputTokens))),
    React.createElement('div', null, React.createElement('span', null, '输入（命中缓存）'), React.createElement('b', null, fmtTokens(l.cacheReadTokens))),
    React.createElement('div', null, React.createElement('span', null, '输出'), React.createElement('b', null, fmtTokens(l.outputTokens))),
    React.createElement('div', null, React.createElement('span', null, '费用（估算 USD）'), React.createElement('b', { className: 'dshup-accent' }, '$' + (l.estimatedCostUsd || 0).toFixed(4))),
  ))
  rows.push(React.createElement('div', { key: 'reset', className: 'dshup-form' },
    React.createElement('button', { key: 'rb', className: 'dshup-btn', onClick: resetLocal }, '清零本会话计数')))

  rows.push(React.createElement('div', { key: 'sec-pos', className: 'dshup-sec' }, '显示位置'))
  rows.push(React.createElement('div', { key: 'pos', className: 'dshup-form' },
    React.createElement('select', { value: position, onChange: (e) => setPosition(e.target.value) },
      React.createElement('option', { value: 'bottom-right' }, '右下角浮窗'),
      React.createElement('option', { value: 'top-right' }, '右上角浮窗'),
      React.createElement('option', { value: 'dock' }, '输入框下方（对话栏）'))))

  rows.push(React.createElement('div', { key: 'sec-c', className: 'dshup-sec' }, '配置'))
  rows.push(React.createElement('div', { key: 'cfg', className: 'dshup-form' },
    React.createElement('label', null,
      React.createElement('span', null, 'platform.deepseek.com 的 userToken' + (config.hasToken ? '（已配置）' : '（未配置）')),
      React.createElement('input', {
        type: 'password', placeholder: '登录 platform.deepseek.com 后：F12 → Application → Local Storage → userToken',
        value: token, onChange: (e) => setToken(e.target.value),
      })),
    React.createElement('label', null,
      React.createElement('span', null, 'DeepSeek API Key（可选，仅用于余额；留空则用 DSH 凭据）'),
      React.createElement('input', {
        type: 'password', placeholder: 'sk-…', value: apiKey, onChange: (e) => setApiKey(e.target.value),
      })),
    React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      React.createElement('button', { className: 'dshup-btn', onClick: save }, saved ? '已保存 ✓' : '保存并刷新'),
      React.createElement('span', { className: 'dshup-hint' },
        'Token 仅保存在本机浏览器与 DSH 内存中，不会写入对话。'),
    )))

  rows.push(React.createElement('div', { key: 'meta', className: 'dshup-hint' },
    '更新于 ' + fmtTime(data.lastUpdated) + (data.error ? ' · 上次错误：' + data.error : '')))

  return React.createElement('div', { className: 'dshup-panel' }, rows)
}

// Dock variant: a readout line under the composer.
function UsageDock() {
  const s = useStore()
  const [expanded, setExpanded] = React.useState(false)
  if (s.position !== 'dock') return null
  const children = [React.createElement('div', { key: 'line', className: 'dshup-row', onClick: () => setExpanded(!expanded) },
    React.createElement(StatusDot, { error: s.data && s.data.error }),
    React.createElement('span', { className: 'dshup-title' }, 'API 用量'),
    React.createElement(CompactBody, { data: s.data, status: s.status }),
    React.createElement('span', { className: 'dshup-caret' }, expanded ? '▾' : '▸'),
  )]
  if (expanded) {
    children.push(React.createElement(Detail, { key: 'detail', data: s.data, config: s.config, position: s.position }))
  }
  return React.createElement('div', null, children)
}

// Floating variant: a corner pill that auto-expands the full card on hover.
// The whole container (pill + card) owns the hover so moving from the pill to
// the card never collapses it; clicking the pill toggles as well (touch users).
function UsageFloat() {
  const s = useStore()
  const [expanded, setExpanded] = React.useState(false)
  if (s.position !== 'top-right' && s.position !== 'bottom-right') return null
  const corner = s.position === 'top-right' ? 'dshup-float-tr' : 'dshup-float-br'
  const children = []
  if (expanded) {
    children.push(React.createElement('div', { key: 'card', className: 'dshup-card' },
      React.createElement(Detail, { data: s.data, config: s.config, position: s.position })))
  }
  children.push(React.createElement('div', {
    key: 'pill', className: 'dshup-pill', onClick: () => setExpanded(!expanded),
  },
    React.createElement(StatusDot, { error: s.data && s.data.error }),
    React.createElement('span', { className: 'dshup-title' }, 'API 用量'),
    React.createElement(CompactBody, { data: s.data, status: s.status }),
    React.createElement('span', { className: 'dshup-caret' }, expanded ? '▾' : '▸'),
  ))
  return React.createElement('div', {
    className: 'dshup-float ' + corner,
    onMouseEnter: () => setExpanded(true),
    onMouseLeave: () => setExpanded(false),
  }, children)
}

// ---- plugin ----
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    // styles.insert returns a disposer; unload cleans everything anyway.
    styles.insert(CSS)

    // Restore saved config: position locally, secrets pushed to the host.
    const saved = readSaved()
    if (saved.position === 'dock' || saved.position === 'top-right' || saved.position === 'bottom-right') {
      setState({ position: saved.position })
    }
    if (saved.token || saved.apiKey) {
      host.call('setConfig', { token: saved.token || '', apiKey: saved.apiKey || '' }).catch(() => {})
    }

    refresh()
    refreshConfig()
    ctx.interval(refresh, 2000)
    ctx.interval(refreshConfig, 30 * 1000)

    // Dock readout (visible inside a conversation).
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'usage', order: 50, label: 'API 用量' },
      UsageDock,
    ))

    // Floating corner widget (frame-wide, session-independent).
    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'usage-float', order: 50, label: 'API 用量浮窗' },
      UsageFloat,
    ))
  },
}
