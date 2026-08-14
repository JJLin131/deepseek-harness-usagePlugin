/**
 * DeepSeek Usage Panel — CLIENT half (browser).
 *
 * Runs as the body of an async function in the page; closure symbols are
 * React, console, styles, host (no imports, no JSX, no global timers).
 *
 * Two placement modes, user-selectable and remembered in localStorage:
 *   - 'float' -> a whale-badge floating widget you can DRAG anywhere with the
 *                mouse; its position (left/top) is persisted. Hovering the
 *                widget auto-expands the full detail card; clicking the badge
 *                toggles it too (drag is suppressed so dragging never toggles).
 *   - 'dock'  -> a readout line in the band under the composer
 *                (slot `conversation.composer.dock`).
 * The floating widget lives in the frame-wide `shell.overlay` slot (root
 * scope: visible with or without a session).
 *
 * The host half owns all network access; this half polls
 * `host.call('snapshot')` every 2s, keeps the user's platform userToken /
 * API key / position in localStorage, and pushes secrets to the host with
 * `host.call('setConfig', …)`.
 */

// ---- store: snapshot + config facts + placement + input drafts ----
let state = {
  data: null,
  config: { hasToken: false, hasApiKey: false, apiKeySource: 'credentials', tokenLength: 0, apiKeyLength: 0 },
  position: 'float', // float (draggable) | dock
  floatPos: null, // { x, y } px (left/top); null = default corner
  dragging: false,
  draft: { token: '', apiKey: '' }, // input drafts, survive collapse/expand
  status: 'loading', // loading | ok | error
  message: null,
}
const listeners = new Set()

function setState(patch) {
  state = Object.assign({}, state, patch)
  for (const fn of listeners) fn()
}
function setDraft(patch) {
  setState({ draft: Object.assign({}, state.draft, patch) })
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
    if (cfg && typeof cfg === 'object') {
      setState({ config: cfg })
      // Self-heal: if the host lost the token (e.g. the host half restarted),
      // re-send the saved config from the browser.
      const saved = readSaved()
      if (!cfg.hasToken && (saved.token || saved.apiKey)) {
        host.call('setConfig', { token: saved.token || '', apiKey: saved.apiKey || '' }).catch(() => {})
      }
    }
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
  if (pos !== 'float' && pos !== 'dock') return
  writeSaved({ position: pos })
  setState({ position: pos })
}
// Default corner when the user has never dragged the widget: right edge.
function defaultFloatPos() {
  const w = window.innerWidth || 1280
  const h = window.innerHeight || 800
  return { x: Math.max(8, w - 80), y: Math.max(8, h - 140) }
}
function savedFloatPos() {
  const saved = readSaved()
  if (typeof saved.floatX === 'number' && typeof saved.floatY === 'number') {
    return { x: saved.floatX, y: saved.floatY }
  }
  return null
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
/* floating widget (draggable) */
.dshup-float {
  position: fixed; z-index: 900; pointer-events: auto;
  font-size: 12px; color: var(--dsw-alias-label-secondary);
  display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
  cursor: grab; touch-action: none;
}
.dshup-float.dshup-dragging { cursor: grabbing; }
/* Near the bottom of the viewport the detail card opens upward (above the pill). */
.dshup-float.dshup-open-up { flex-direction: column-reverse; }
.dshup-whale-btn {
  display: flex; align-items: center; justify-content: center;
  padding: 4px; cursor: grab; user-select: none;
}
.dshup-whale-btn svg { filter: drop-shadow(0 2px 6px rgba(0, 0, 0, .28)); }
.dshup-float.dshup-dragging .dshup-whale-btn { cursor: grabbing; }
.dshup-whale { position: relative; display: flex; align-items: center; flex: none; }
.dshup-whale .dshup-dot {
  position: absolute; right: -2px; bottom: -1px; width: 10px; height: 10px;
  border: 2px solid var(--dsw-alias-bg-base);
}
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

// Official DeepSeek whale mark (cdn.deepseek.com/favicon.svg), inline SVG.
function WhaleIcon(props) {
  const size = props && props.size ? props.size : 20
  return React.createElement('svg', {
    viewBox: '0 0 50 50', width: size, height: size, 'aria-hidden': true, focusable: 'false',
  },
    React.createElement('path', {
      d: 'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z',
      fill: '#4D6BFE', fillRule: 'nonzero',
    }))
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
      React.createElement('span', null, '费用 ', React.createElement('b', { className: 'dshup-accent' }, fmtMoney(t.cost, p.currency))),
      React.createElement('span', { className: 'dshup-hint' }, '（' + p.month + '）'),
    )
  }
  if (l && l.requests > 0) {
    return React.createElement(React.Fragment, null,
      React.createElement('span', null, 'DSH 实时 ', React.createElement('b', { className: 'dshup-num' }, fmtInt(l.requests)), ' 次'),
      React.createElement('span', null, '估算 ', React.createElement('b', { className: 'dshup-accent' }, '$' + (l.estimatedCostUsd || 0).toFixed(4))),
    )
  }
  if (status === 'ok') {
    // Show the REAL reason the platform section is empty (missing token vs a
    // failed/unauthorized fetch) instead of always claiming "not configured".
    const err = data && data.error
    if (err && err.indexOf('未配置平台 Token') !== 0) {
      return React.createElement('span', { className: 'dshup-err', title: err },
        '平台数据获取失败：' + (err.length > 42 ? err.slice(0, 42) + '…' : err))
    }
    return React.createElement('span', { className: 'dshup-hint' }, '未配置平台 Token，点击展开配置')
  }
  return React.createElement('span', { className: 'dshup-hint' }, '加载中…')
}

function Detail(props) {
  const { data } = props
  const s = useStore()
  const config = s.config
  const position = s.position
  const draft = s.draft
  const [saved, setSaved] = React.useState(false)
  const [saveMsg, setSaveMsg] = React.useState('')
  const p = data && data.platform
  const l = data && data.local
  const b = data && data.balance

  const save = () => {
    writeSaved({ token: draft.token, apiKey: draft.apiKey })
    host.call('setConfig', { token: draft.token, apiKey: draft.apiKey }).then(() => {
      setSaved(true)
      setSaveMsg('')
      refresh()
      setTimeout(() => setSaved(false), 2000)
    }).catch((e) => {
      setSaveMsg('保存失败（与 Host 通信出错）：' + String(e && e.message || e))
    })
  }
  const forceRefresh = () => { host.call('refresh').then(() => refresh()).catch(() => refresh()) }
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
      React.createElement('option', { value: 'float' }, '悬浮窗（可拖动）'),
      React.createElement('option', { value: 'dock' }, '输入框下方（对话栏）'))))

  rows.push(React.createElement('div', { key: 'sec-c', className: 'dshup-sec' }, '配置'))
  rows.push(React.createElement('div', { key: 'host-state', className: 'dshup-hint' },
    'Host 状态：' + (config.hasToken
      ? '已收到平台 Token（长度 ' + (config.tokenLength || 0) + '）'
      : '尚未收到平台 Token')
    + (config.hasApiKey ? '；已收到 API Key' : '') + '。'))
  rows.push(React.createElement('div', { key: 'cfg', className: 'dshup-form' },
    React.createElement('label', null,
      React.createElement('span', null, 'platform.deepseek.com 的 userToken' + (config.hasToken ? '（已配置）' : '（未配置）')),
      React.createElement('input', {
        type: 'password', placeholder: '登录 platform.deepseek.com 后：F12 → Application → Local Storage → userToken',
        value: draft.token, onChange: (e) => setDraft({ token: e.target.value }),
      })),
    React.createElement('label', null,
      React.createElement('span', null, 'DeepSeek API Key（可选，仅用于余额；留空则用 DSH 凭据）'),
      React.createElement('input', {
        type: 'password', placeholder: 'sk-…', value: draft.apiKey, onChange: (e) => setDraft({ apiKey: e.target.value }),
      })),
    React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      React.createElement('button', { className: 'dshup-btn', onClick: save }, saved ? '已保存 ✓' : '保存并刷新'),
      React.createElement('button', { className: 'dshup-btn', onClick: forceRefresh }, '立即刷新'),
      React.createElement('span', { className: 'dshup-hint' },
        'Token 仅保存在本机浏览器与 DSH 内存中，不会写入对话。'),
    ),
    saveMsg ? React.createElement('div', { className: 'dshup-err' }, saveMsg) : null,
  ))

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
    children.push(React.createElement(Detail, { key: 'detail', data: s.data }))
  }
  return React.createElement('div', null, children)
}

// Floating variant: a draggable whale badge. Hover expands the card (suppressed
// while dragging); dragging never toggles; the position persists on mouseup.
function UsageFloat() {
  const s = useStore()
  const [expanded, setExpanded] = React.useState(false)
  const dragRef = React.useRef({ sx: 0, sy: 0, ox: 0, oy: 0, moved: false })
  if (s.position !== 'float') return null

  const pos = s.floatPos || defaultFloatPos()
  const openUp = pos.y > (window.innerHeight || 800) / 2

  const onPillMouseDown = (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    const base = s.floatPos || defaultFloatPos()
    const d = dragRef.current
    d.sx = e.clientX
    d.sy = e.clientY
    d.ox = base.x
    d.oy = base.y
    d.moved = false
    setState({ dragging: true })
    const vw = () => window.innerWidth || 2000
    const vh = () => window.innerHeight || 1500
    const onMove = (ev) => {
      const dx = ev.clientX - d.sx
      const dy = ev.clientY - d.sy
      if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true
      setState({
        floatPos: {
          x: Math.max(4, Math.min(vw() - 40, d.ox + dx)),
          y: Math.max(4, Math.min(vh() - 30, d.oy + dy)),
        },
      })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setState({ dragging: false })
      if (dragRef.current.moved && state.floatPos) {
        writeSaved({ floatX: state.floatPos.x, floatY: state.floatPos.y })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const children = []
  if (expanded) {
    children.push(React.createElement('div', { key: 'card', className: 'dshup-card' },
      React.createElement(Detail, { data: s.data })))
  }
  // A lone whale badge: no pill, no text — just the icon (plus a tiny status
  // dot at its corner). Hover expands the card; drag moves the widget.
  children.push(React.createElement('div', {
    key: 'btn',
    className: 'dshup-whale-btn',
    onMouseDown: onPillMouseDown,
    onClick: () => { if (!dragRef.current.moved) setExpanded(!expanded) },
    title: 'DeepSeek API 用量（悬停查看，按住拖动）',
  },
    React.createElement('span', { className: 'dshup-whale' },
      React.createElement(WhaleIcon, { size: 40 }),
      React.createElement(StatusDot, { error: s.data && s.data.error }),
    ),
  ))

  return React.createElement('div', {
    className: 'dshup-float' + (s.dragging ? ' dshup-dragging' : '') + (openUp ? ' dshup-open-up' : ''),
    style: { left: pos.x + 'px', top: pos.y + 'px' },
    onMouseEnter: () => { if (!s.dragging) setExpanded(true) },
    onMouseLeave: () => setExpanded(false),
  }, children)
}

// ---- plugin ----
return {
  inject: ['slots', 'timer'],
  apply(ctx) {
    // styles.insert returns a disposer; unload cleans everything anyway.
    styles.insert(CSS)

    // Restore saved config: position locally, secrets pushed to the host, and
    // input drafts prefilled so collapse/expand never loses what was typed.
    const saved = readSaved()
    let position = saved.position
    if (position !== 'float' && position !== 'dock') {
      // Legacy corner presets migrate to the draggable float mode.
      position = 'float'
      writeSaved({ position })
    }
    setState({
      position,
      floatPos: savedFloatPos(),
      draft: { token: saved.token || '', apiKey: saved.apiKey || '' },
    })
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

    // Floating whale badge (frame-wide, session-independent, draggable).
    ctx.slots.inject('shell.overlay', () => ctx.slots.register(
      { name: 'shell.overlay', id: 'usage-float', order: 50, label: 'API 用量浮窗' },
      UsageFloat,
    ))
  },
}
