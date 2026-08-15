import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import UsageService from '../lib/index.js'
import { createUsageApi } from '../src/client/usage-api.ts'

/** Harness rc.5 Gateway SRC fallback 的最小派发契约：marker + JS 参数名 + exact args。 */
async function invokeSrc(service, endpoint, payload) {
  const [namespace, exportName] = endpoint.split('/')
  assert.equal(namespace, service.typertRemote.namespace)
  assert.deepEqual(Object.keys(payload), ['args'])
  const marker = remoteMethods(service).find(candidate => (candidate.exportName ?? candidate.method) === exportName)
  assert.ok(marker, `missing Remote marker for ${endpoint}`)
  const implementation = service[marker.method]
  const source = Function.prototype.toString.call(implementation)
  const parameters = source.slice(source.indexOf('(') + 1, source.indexOf(')'))
    .split(',').map(value => value.trim()).filter(Boolean)
  assert.deepEqual(Object.keys(payload.args).sort(), parameters.sort())
  return Reflect.apply(implementation, service, parameters.map(name => payload.args[name]))
}

test('Host service binds usage namespace and exposes all five Remote endpoints', async () => {
  const ctx = new Context()
  const service = new UsageService(ctx, {})
  assert.deepEqual(service.typertRemote, {
    service,
    serviceKey: 'usage',
    namespace: 'usage',
  })
  assert.deepEqual(remoteMethods(service), [
    { method: 'snapshot', invocation: { kind: 'direct' } },
    { method: 'getConfig', invocation: { kind: 'direct' } },
    { method: 'setConfig', invocation: { kind: 'direct' } },
    { method: 'resetLocal', invocation: { kind: 'direct' } },
    { method: 'refreshRemote', exportName: 'refresh', invocation: { kind: 'direct' } },
  ])
  await ctx.fiber.dispose()
})

test('Host snapshots expose configuration facts but never echo secrets', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'must not be read' })
  const ctx = new Context()
  try {
    const service = new UsageService(ctx, {})
    service.setConfig({ token: 'platform-secret', apiKey: 'sk-secret-value' })
    const config = service.getConfig()
    assert.deepEqual(config, {
      hasToken: true,
      hasApiKey: true,
      apiKeySource: 'user',
      tokenLength: 15,
      apiKeyLength: 15,
    })
    const snapshot = JSON.stringify(service.snapshot())
    assert.doesNotMatch(snapshot, /platform-secret|sk-secret-value/)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.doesNotMatch(JSON.stringify(service.snapshot()), /platform-secret|sk-secret-value/)
  } finally {
    globalThis.fetch = originalFetch
    await ctx.fiber.dispose()
  }
})

test('Host never exposes a successful HTTP response body when JSON parsing fails', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html>remote-secret-sentinel</html>',
  })
  const ctx = new Context()
  try {
    const service = new UsageService(ctx, {})
    service.setConfig({ token: 'configured-token', apiKey: '' })
    await new Promise(resolve => setTimeout(resolve, 10))
    const snapshot = JSON.stringify(service.snapshot())
    assert.match(snapshot, /返回了无效 JSON/)
    assert.doesNotMatch(snapshot, /remote-secret-sentinel/)
  } finally {
    globalThis.fetch = originalFetch
    await ctx.fiber.dispose()
  }
})

test('rc.5 SRC fallback contract dispatches all five endpoints with named arguments', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => '' })
  const ctx = new Context()
  try {
    const service = new UsageService(ctx, {})
    const api = createUsageApi({
      get: name => name === 'connection' ? {
        rpc: {
          call: async (channel, endpoint, payload) => {
            assert.equal(channel, '/api')
            return { ok: true, value: await invokeSrc(service, endpoint, payload) }
          },
        },
      } : undefined,
    })
    assert.equal(typeof await api.snapshot(), 'object')
    assert.equal(typeof await api.getConfig(), 'object')
    assert.deepEqual(await api.setConfig({ token: 'token', apiKey: 'key' }), { ok: true })
    assert.deepEqual(await api.resetLocal(), { ok: true })
    assert.deepEqual(await api.refresh(), { ok: true })
  } finally {
    globalThis.fetch = originalFetch
    await ctx.fiber.dispose()
  }
})
