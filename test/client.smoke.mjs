/**
 * Smoke test for plugin/client.js — evaluates the browser half against stub
 * React / host / styles / localStorage and checks slot registration, position
 * switching, and hover-expand wiring.
 *
 * Run:  node test/client.smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'plugin', 'client.js'), 'utf8')

let failures = 0
function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) console.log('  ok  ' + name)
  else { failures++; console.error('  FAIL ' + name + '\n    expected ' + e + '\n    actual   ' + a) }
}

// ---- stub surface ----
const storage = new Map()
const localStorageStub = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}
// The client half references the bare `localStorage` global (like the browser);
// make it resolvable from the evaluated closure's scope.
globalThis.localStorage = localStorageStub
// Seed a previously-saved config so apply() must replay it to the host.
// position 'bottom-right' is a legacy corner preset — apply() must migrate it.
storage.set('dsh-usage.config', JSON.stringify({ token: 'tok-saved', apiKey: 'sk-saved', position: 'bottom-right' }))

// window stub: innerWidth/innerHeight for the default float position, captured
// timers (the client uses window.setTimeout for the delayed hover-expand), and
// event-listener capture so the drag handlers can be driven manually.
const winListeners = {}
const winTimers = new Map()
let winTimerId = 0
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: (type, fn) => { winListeners[type] = fn },
  removeEventListener: (type) => { delete winListeners[type] },
  setTimeout: (fn) => { const id = ++winTimerId; winTimers.set(id, fn); return id },
  clearTimeout: (id) => { winTimers.delete(id) },
}
function flushTimers() {
  for (const fn of [...winTimers.values()]) fn()
  winTimers.clear()
}

// A minimal stateful React stub: useState persists per (component, hook index)
// so repeated component invocations behave like re-renders. `render(fn)` resets
// the hook cursor for one top-level render pass.
const hookStore = new Map()
let currentComponent = ''
let hookCursor = 0
function render(fn) {
  currentComponent = fn.name
  hookCursor = 0
  return fn()
}
function renderWith(fn, props) {
  currentComponent = fn.name
  hookCursor = 0
  return fn(props)
}
const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => {
    const key = currentComponent + ':' + hookCursor++
    if (!hookStore.has(key)) hookStore.set(key, typeof init === 'function' ? init() : init)
    const set = (x) => { hookStore.set(key, typeof x === 'function' ? x(hookStore.get(key)) : x) }
    return [hookStore.get(key), set]
  },
  useEffect: () => {},
  useRef: (init) => {
    const key = currentComponent + ':ref:' + hookCursor++
    if (!hookStore.has(key)) hookStore.set(key, { current: init })
    return hookStore.get(key)
  },
  Fragment: Symbol('Fragment'),
}

const SNAPSHOT = {
  platform: {
    month: '2026-08', monthPrefix: '2026-08', currency: 'CNY',
    weekStart: '2026-07-27', weekEnd: '2026-08-02',
    totals: { requests: 1212, cacheHit: 100686720, cacheMiss: 1305432, output: 656338, input: 101992152, cost: 4.63, cacheHitRate: 98.7, byModel: [{ model: 'deepseek-v4-flash', requests: 1212, cacheHit: 100686720, cacheMiss: 1305432, output: 656338, cost: 4.63 }] },
    days: [{ date: '07-27', full: '2026-07-27', requests: 5, input: 1000, cacheHit: 900, cacheMiss: 100, output: 200, cost: 0.1 }],
    ranges: {
      today: { requests: 33, cacheHit: 500000, cacheMiss: 20000, output: 9000, input: 520000, cost: 0.0334, cacheHitRate: 96.2, byModel: [] },
      yesterday: { requests: 0, cacheHit: 0, cacheMiss: 0, output: 0, input: 0, cost: 0, cacheHitRate: 0, byModel: [] },
      week: { requests: 5, cacheHit: 900, cacheMiss: 100, output: 200, input: 1000, cost: 0.1, cacheHitRate: 90, byModel: [] },
      month: { requests: 1212, cacheHit: 100686720, cacheMiss: 1305432, output: 656338, input: 101992152, cost: 4.63, cacheHitRate: 98.7, byModel: [{ model: 'deepseek-v4-flash', requests: 1212, cacheHit: 100686720, cacheMiss: 1305432, output: 656338, cost: 4.63 }] },
    },
  },
  local: { requests: 1, inputTokens: 100, cacheReadTokens: 80, cacheMissTokens: 100, outputTokens: 20, estimatedCostUsd: 0.0001, since: 1, hours: [] },
  balance: { source: 'credentials', available: true, infos: [{ currency: 'CNY', total: 110, granted: 0, toppedUp: 110 }] },
  config: { hasToken: true, hasApiKey: false, apiKeySource: 'credentials', tokenLength: 7, apiKeyLength: 0 },
  lastUpdated: Date.now(),
  error: null,
}

const hostCalls = []
const hostStub = {
  getConfigResult: SNAPSHOT.config,
  call: async (method, args) => {
    hostCalls.push({ method, args })
    if (method === 'snapshot') return SNAPSHOT
    if (method === 'getConfig') return hostStub.getConfigResult
    if (method === 'setConfig') return { ok: true }
    return null
  },
}

const styleTags = []
const stylesStub = { insert: (css) => { styleTags.push(css); return () => {} } }
const consoleStub = { log: () => {}, error: (m) => console.error('  [client console.error]', m) }
const trap = () => { throw new Error('trap hit') }

const slots = {}
const ctxStub = {
  interval: (fn) => { ctxStub.intervals.push(fn) },
  intervals: [],
  slots: {
    components: {},
    register: (options, component) => {
      ctxStub.slots.components[options.id || options.name] = component
      return () => {}
    },
    inject: (name, fn) => { slots[name] = () => fn() },
  },
}

async function main() {
  const factory = new Function(
    'React', 'console', 'styles', 'host', 'harness',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'require', 'process', 'Buffer',
    `return (async () => {\n${source}\n})()`,
  )
  const plugin = await factory(ReactStub, consoleStub, stylesStub, hostStub, {}, trap, trap, trap, trap, trap, trap, undefined, undefined)

  console.log('· plugin shape')
  check('injects slots/timer', plugin.inject, ['slots', 'timer'])

  plugin.apply(ctxStub)

  console.log('· slot registration')
  check('composer.dock registered', typeof slots['conversation.composer.dock'], 'function')
  check('shell.overlay registered', typeof slots['shell.overlay'], 'function')
  check('css inserted', styleTags.length >= 1, true)

  // Fire the inject callbacks like the real slot system does when the owner
  // declarations go live; each one calls ctx.slots.register -> components map.
  slots['conversation.composer.dock']()
  slots['shell.overlay']()

  console.log('· polling starts')
  check('interval scheduled', ctxStub.intervals.length >= 2, true)
  check('snapshot polled', hostCalls.some(c => c.method === 'snapshot'), true)

  // force the first poll to settle so the store has data
  await new Promise(r => setTimeout(r, 30))

  const Dock = ctxStub.slots.components['usage']
  const Float = ctxStub.slots.components['usage-float']
  check('dock component captured', typeof Dock, 'function')
  check('float component captured', typeof Float, 'function')

  console.log('· default placement (legacy corner preset migrates to draggable float)')
  check('dock renders null', render(Dock) === null, true)
  const f0 = render(Float)
  check('float renders', f0 !== null && f0.type === 'div', true)
  check('position migrated to float', JSON.parse(storage.get('dsh-usage.config') || '{}').position, 'float')
  check('default float position near right edge', f0.props.style.left, '1200px')

  console.log('· delayed hover: expands after timer; close has a 250ms grace (shared hover)')
  check('mouseenter schedules expand', typeof f0.props.onMouseEnter, 'function')
  check('mouseleave schedules grace close', typeof f0.props.onMouseLeave, 'function')
  f0.props.onMouseEnter()
  check('hover does NOT expand instantly', cardPresent(render(Float)), false)
  flushTimers()
  const f1 = render(Float)
  check('card appears after hover delay', cardPresent(f1), true)
  f1.props.onMouseLeave()
  // the card must stay open while the pointer is between pill and card
  check('card stays open during close grace', cardPresent(render(Float)), true)
  flushTimers()
  check('card hides after close grace', cardPresent(render(Float)), false)

  console.log('· press cancels pending hover (press = intent to drag)')
  const fHover = render(Float)
  const btnHover = flatChildren(fHover).find(c => c.props && c.props.className === 'dshup-whale-btn')
  fHover.props.onMouseEnter()
  check('hover timer scheduled', winTimers.size, 1)
  btnHover.props.onMouseDown({ button: 0, clientX: 10, clientY: 10, preventDefault() {}, stopPropagation() {} })
  check('mousedown cancels pending hover timer', winTimers.size, 0)
  flushTimers()
  check('no expand after cancelled hover + timer flush', cardPresent(render(Float)), false)
  winListeners.mouseup({}) // close the press without movement; nothing persists

  console.log('· drag: mousedown -> mousemove -> mouseup moves and persists the position')
  const fDrag = render(Float)
  const whaleBtn = flatChildren(fDrag).find(c => c.props && c.props.className === 'dshup-whale-btn')
  check('whale button present', whaleBtn !== undefined, true)
  check('whale icon rendered', flatChildren(whaleBtn).some(c => c.type && c.type.name === 'WhaleIcon'), true)
  check('whale button has mousedown handler', typeof whaleBtn.props.onMouseDown, 'function')
  whaleBtn.props.onMouseDown({ button: 0, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} })
  check('window mousemove listener attached', typeof winListeners.mousemove, 'function')
  winListeners.mousemove({ clientX: 160, clientY: 130 })
  const fMoved = render(Float)
  // x is clamped to viewport width - 40: 1200 + 60 = 1260 -> 1240.
  check('position updated while dragging', fMoved.props.style.left, '1240px')
  check('dragging class applied', fMoved.props.className.includes('dshup-dragging'), true)
  // bottom half (y ≈ 690): the card opens upward
  check('bottom-half position opens card upward', fMoved.props.className.includes('dshup-oc-up'), true)
  // Drag the widget to the top half of the viewport: the card must flip to
  // open downward so it never runs off-screen.
  winListeners.mousemove({ clientX: 160, clientY: -500 })
  const fTop = render(Float)
  check('top-half position opens card downward', fTop.props.className.includes('dshup-oc-down'), true)
  winListeners.mouseup({})
  check('listeners cleaned up', winListeners.mousemove === undefined, true)
  const saved = JSON.parse(storage.get('dsh-usage.config') || '{}')
  check('position persisted on mouseup', saved.floatX, 1240)
  check('position persisted on mouseup (y)', saved.floatY, 60)
  // A drag must not toggle the expanded card.
  const fAfterDrag = render(Float)
  check('drag did not expand', cardPresent(fAfterDrag), false)
  whaleBtn.props.onClick()
  check('click after drag still suppressed (moved flag)', cardPresent(render(Float)), false)

  console.log('· settings view (gear): 显示位置 lives there, not in the info view')
  const f3 = render(Float)
  f3.props.onMouseEnter()
  flushTimers()
  const f4 = render(Float)
  // Detail is a function component the stub does not auto-render; render it once
  // to reach the info view (no position select), then open settings via gear.
  const detailEl = flatChildren(f4).find(c => c.type && c.type.name === 'Detail')
  check('detail element present when hovered', detailEl !== undefined, true)
  const info = renderWith(detailEl.type, { data: SNAPSHOT })
  check('info view has no position select', findSelect(info) === null, true)
  const gear = flatChildren(info).find(c => c.props && c.props.className === 'dshup-gear')
  check('gear button present', gear !== undefined, true)
  gear.props.onClick()
  const settings = renderWith(detailEl.type, { data: SNAPSHOT })
  const select = findSelect(settings)
  check('position select rendered in settings view', select !== null, true)
  select.props.onChange({ target: { value: 'dock' } })
  check('dock renders after switch', render(Dock) !== null, true)
  check('float null after switch', render(Float) === null, true)
  check('position persisted', JSON.parse(storage.get('dsh-usage.config') || '{}').position, 'dock')

  console.log('· self-heal: host without token gets the saved config re-sent')
  hostStub.getConfigResult = { hasToken: false, hasApiKey: false, apiKeySource: 'credentials', tokenLength: 0, apiKeyLength: 0 }
  const before = hostCalls.filter(c => c.method === 'setConfig').length
  ctxStub.intervals[1]() // refreshConfig
  await new Promise(r => setTimeout(r, 20))
  const resent = hostCalls.filter(c => c.method === 'setConfig')
  check('setConfig re-sent when host lost token', resent.length > before, true)
  check('re-sent with saved token', resent[resent.length - 1].args.token, 'tok-saved')

  console.log('· saved config replayed to host on apply')
  check('setConfig called at least once', hostCalls.filter(c => c.method === 'setConfig').length >= 1, true)

  if (failures === 0) {
    console.log('\nALL PASS')
    process.exit(0)
  } else {
    console.error(`\n${failures} FAILURE(S)`)
    process.exit(1)
  }
}

function flatChildren(node) {
  // Stub createElement(...children) nests an array-of-children one level deeper
  // than React's flattening; walk element trees recursively.
  const out = []
  const walk = (n) => {
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    if (n && typeof n === 'object') {
      out.push(n)
      if (n.children !== undefined) walk(n.children)
    }
  }
  walk(node.children)
  return out
}

function cardPresent(node) {
  return flatChildren(node).some((c) => c.props && c.props.className === 'dshup-card')
}

function findSelect(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'select') return node
  if (Array.isArray(node)) {
    for (const n of node) { const r = findSelect(n); if (r) return r }
    return null
  }
  if (node.children) {
    for (const n of flatChildren(node)) { const r = findSelect(n); if (r) return r }
  }
  return null
}

main().catch((e) => {
  console.error('smoke crashed:', e)
  process.exit(2)
})
