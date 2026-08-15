import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import UsageService from '../lib/index.js'

class ConnectionStub extends Service {
  registration
  rpc = {
    intercept: (channel, claims, dispatch, options) => {
      this.registration = { channel, claims, dispatch, options }
    },
  }

  constructor(ctx) {
    super(ctx, 'connection')
  }
}

test('Host service owns the usage key and never requires Typert module-private markers', async () => {
  const ctx = new Context()
  const service = new UsageService(ctx, {})
  assert.equal(service.name, 'usage')
  assert.equal('typertRemote' in service, false)
  await ctx.fiber.dispose()
})

test('Host plugin mounts through a real Cordis fiber and dispatches all five RPC endpoints', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(ConnectionStub)
    await ctx.plugin(UsageService, {})
    assert.ok(ctx.get('usage') instanceof UsageService)
    const registration = ctx.get('connection').registration
    assert.equal(registration.channel, '/api')
    assert.deepEqual(registration.options, { authority: 'trusted-host' })

    for (const endpoint of ['usage/snapshot', 'usage/getConfig', 'usage/setConfig', 'usage/resetLocal', 'usage/refresh']) {
      assert.equal(registration.claims(endpoint), true)
    }
    assert.equal(registration.claims('usage/unknown'), false)
    assert.equal(registration.claims('other/snapshot'), false)

    const snapshot = await registration.dispatch('usage/snapshot', { args: {} })
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.value.local.requests, 0)
    assert.deepEqual(await registration.dispatch('usage/getConfig', { args: {} }), {
      ok: true,
      value: { hasToken: false, hasApiKey: false, apiKeySource: 'credentials', tokenLength: 0, apiKeyLength: 0 },
    })
    assert.deepEqual(await registration.dispatch('usage/setConfig', { args: { cfg: { token: ' token ' } } }), {
      ok: true,
      value: { ok: true },
    })
    assert.deepEqual(await registration.dispatch('usage/resetLocal', { args: {} }), {
      ok: true,
      value: { ok: true },
    })
    assert.deepEqual(await registration.dispatch('usage/refresh', { args: {} }), {
      ok: true,
      value: { ok: true },
    })
    assert.equal((await registration.dispatch('usage/setConfig', { args: {} })).ok, false)
  } finally {
    await ctx.fiber.dispose()
  }
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
