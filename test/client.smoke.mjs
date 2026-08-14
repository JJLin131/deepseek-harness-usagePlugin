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
storage.set('dsh-usage.config', JSON.stringify({ token: 'tok-saved', apiKey: 'sk-saved', position: 'bottom-right' }))

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
  Fragment: Symbol('Fragment'),
}

const SNAPSHOT = {
  platform: {
    month: '2026-08', currency: 'CNY',
    totals: { requests: 1212, cacheHit: 100686720, cacheMiss: 1305432, output: 656338, input: 101992152, cost: 4.63, cacheHitRate: 98.7, byModel: [{ model: 'deepseek-v4-flash', requests: 1212, cacheHit: 100686720, cacheMiss: 1305432, output: 656338, cost: 4.63 }] },
    today: { requests: 33, cacheHit: 500000, cacheMiss: 20000, output: 9000, input: 520000, cost: 0.0334, cacheHitRate: 96.2, byModel: [] },
  },
  local: { requests: 1, inputTokens: 100, cacheReadTokens: 80, cacheMissTokens: 100, outputTokens: 20, estimatedCostUsd: 0.0001, since: 1 },
  balance: { source: 'credentials', available: true, infos: [{ currency: 'CNY', total: 110, granted: 0, toppedUp: 110 }] },
  config: { hasToken: true, hasApiKey: false, apiKeySource: 'credentials' },
  lastUpdated: Date.now(),
  error: null,
}

const hostCalls = []
const hostStub = {
  call: async (method, args) => {
    hostCalls.push({ method, args })
    if (method === 'snapshot') return SNAPSHOT
    if (method === 'getConfig') return SNAPSHOT.config
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

  console.log('· default placement (bottom-right)')
  check('dock renders null', render(Dock) === null, true)
  const f0 = render(Float)
  check('float renders', f0 !== null && f0.type === 'div', true)

  console.log('· hover wiring on the floating widget')
  check('mouseenter expands', typeof f0.props.onMouseEnter, 'function')
  check('mouseleave collapses', typeof f0.props.onMouseLeave, 'function')
  f0.props.onMouseEnter()
  const f1 = render(Float)
  check('card appears on hover', flatChildren(f1).some(c => c.props && c.props.className === 'dshup-card'), true)
  f1.props.onMouseLeave()
  const f2 = render(Float)
  check('card hides on leave', flatChildren(f2).some(c => c.props && c.props.className === 'dshup-card'), false)

  console.log('· position switch to dock')
  const f3 = render(Float)
  f3.props.onMouseEnter()
  const f4 = render(Float)
  // Detail is a function component the stub does not auto-render; render it once
  // to reach the position <select>.
  const detailEl = flatChildren(f4).find(c => c.type && c.type.name === 'Detail')
  check('detail element present when hovered', detailEl !== undefined, true)
  const detail = renderWith(detailEl.type, { data: SNAPSHOT, config: SNAPSHOT.config, position: 'bottom-right' })
  const select = findSelect(detail)
  check('position select rendered', select !== null, true)
  select.props.onChange({ target: { value: 'dock' } })
  check('dock renders after switch', render(Dock) !== null, true)
  check('float null after switch', render(Float) === null, true)
  check('position persisted', JSON.parse(storage.get('dsh-usage.config') || '{}').position, 'dock')

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
