import test from 'node:test'
import assert from 'node:assert/strict'

test('built client registers, polls through RPC and mounts both UI slots', async () => {
  let handoff
  const styles = []
  const storage = new Map([
    ['dsh-usage.config', JSON.stringify({ token: 'saved-token', apiKey: '', position: 'bottom-right' })],
  ])
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  }
  globalThis.document = {
    createElement: tag => ({ tag, dataset: {}, textContent: '' }),
    head: { appendChild: node => styles.push(node) },
  }
  const windowListeners = new Map()
  const windowTimers = new Map()
  let nextTimer = 0
  globalThis.window = {
    __ModuleLoader__: { load: value => { handoff = value } },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    removeEventListener: name => windowListeners.delete(name),
    setTimeout: listener => { const id = ++nextTimer; windowTimers.set(id, listener); return id },
    clearTimeout: id => windowTimers.delete(id),
  }
  const flushWindowTimers = () => {
    for (const listener of [...windowTimers.values()]) listener()
    windowTimers.clear()
  }

  await import(`../lib/client.js?test=${Date.now()}`)
  assert.equal(handoff.id, 'dsh-usage-panel')

  const hooks = new Map()
  let currentComponent = ''
  let hookCursor = 0
  const render = (component, props) => {
    currentComponent = component.name
    hookCursor = 0
    return component(props)
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: value => {
      const key = `${currentComponent}:${hookCursor++}`
      if (!hooks.has(key)) hooks.set(key, typeof value === 'function' ? value() : value)
      return [hooks.get(key), next => hooks.set(key, typeof next === 'function' ? next(hooks.get(key)) : next)]
    },
    useEffect() {},
    useRef: value => {
      const key = `${currentComponent}:ref:${hookCursor++}`
      if (!hooks.has(key)) hooks.set(key, { current: value })
      return hooks.get(key)
    },
    Fragment: Symbol('Fragment'),
  }
  const client = handoff.factory((specifier) => {
    assert.equal(specifier, 'react')
    return { default: React, ...React }
  })
  assert.deepEqual(client.inject, ['slots', 'timer', 'connection'])

  const calls = []
  let configHasToken = true
  const injected = new Map()
  const registered = new Map()
  const intervals = []
  const ctx = {
    get: name => {
      assert.equal(name, 'connection')
      return {
        rpc: {
          call: async (channel, endpoint, payload) => {
            calls.push({ channel, endpoint, payload })
            if (endpoint === 'usage/snapshot') {
              return { ok: false, error: { code: 'host-not-ready' } }
            }
            if (endpoint === 'usage/getConfig') {
              return { ok: true, value: { hasToken: configHasToken, hasApiKey: false, tokenLength: configHasToken ? 11 : 0, apiKeyLength: 0 } }
            }
            return { ok: true, value: { ok: true } }
          },
        },
      }
    },
    interval: callback => intervals.push(callback),
    slots: {
      inject: (name, mount) => injected.set(name, mount),
      register: (options, component) => {
        registered.set(options.id, component)
        return () => {}
      },
    },
  }

  client.apply(ctx)
  injected.get('conversation.composer.dock')()
  injected.get('shell.overlay')()
  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(typeof registered.get('usage'), 'function')
  assert.equal(typeof registered.get('usage-float'), 'function')
  assert.equal(styles.length, 1)
  assert.equal(styles[0].dataset.plugin, 'dsh-usage-panel')
  assert.ok(calls.some(call => call.endpoint === 'usage/snapshot'))
  assert.ok(calls.some(call => call.endpoint === 'usage/getConfig'))
  assert.deepEqual(calls.find(call => call.endpoint === 'usage/setConfig')?.payload, {
    args: { cfg: { token: 'saved-token', apiKey: '' } },
  })

  const Dock = registered.get('usage')
  const Float = registered.get('usage-float')
  assert.equal(render(Dock), null)
  const initialFloat = render(Float)
  assert.equal(initialFloat.props.style.left, '1200px')
  assert.equal(JSON.parse(storage.get('dsh-usage.config')).position, 'float')

  initialFloat.props.onMouseEnter()
  assert.equal(cardPresent(render(Float)), false)
  flushWindowTimers()
  const expandedFloat = render(Float)
  assert.equal(cardPresent(expandedFloat), true)
  const detail = flatChildren(expandedFloat).find(node => node.type?.name === 'Detail')
  assert.ok(detail)
  assert.doesNotThrow(() => render(detail.type, detail.props))
  expandedFloat.props.onMouseLeave()
  assert.equal(cardPresent(render(Float)), true)
  flushWindowTimers()
  assert.equal(cardPresent(render(Float)), false)

  const draggableFloat = render(Float)
  const whale = flatChildren(draggableFloat).find(node => node.props?.className === 'dshup-whale-btn')
  assert.ok(whale)
  whale.props.onMouseDown({
    button: 0,
    clientX: 100,
    clientY: 100,
    preventDefault() {},
    stopPropagation() {},
  })
  windowListeners.get('mousemove')({ clientX: 160, clientY: 130 })
  const movedFloat = render(Float)
  assert.equal(movedFloat.props.style.left, '1240px')
  assert.match(movedFloat.props.className, /dshup-dragging/)
  windowListeners.get('mouseup')({})
  assert.equal(windowListeners.has('mousemove'), false)
  const saved = JSON.parse(storage.get('dsh-usage.config'))
  assert.equal(saved.floatX, 1240)
  assert.equal(saved.floatY, 690)

  configHasToken = false
  const beforeReplay = calls.filter(call => call.endpoint === 'usage/setConfig').length
  intervals[1]()
  await new Promise(resolve => setTimeout(resolve, 10))
  const replays = calls.filter(call => call.endpoint === 'usage/setConfig')
  assert.ok(replays.length > beforeReplay)
  assert.deepEqual(replays.at(-1).payload, {
    args: { cfg: { token: 'saved-token', apiKey: '' } },
  })
})

function flatChildren(node) {
  const result = []
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (value && typeof value === 'object') {
      result.push(value)
      visit(value.children)
    }
  }
  visit(node?.children)
  return result
}

function cardPresent(node) {
  return flatChildren(node).some(child => child.props?.className === 'dshup-card')
}
