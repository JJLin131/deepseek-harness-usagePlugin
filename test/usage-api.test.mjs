import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageApi } from '../src/client/usage-api.ts'

test('RPC adapter sends exact Gateway endpoint and named args payloads', async () => {
  const calls = []
  const values = new Map([
    ['usage/snapshot', { data: true }],
    ['usage/getConfig', { hasToken: false }],
    ['usage/setConfig', { ok: true }],
    ['usage/resetLocal', { ok: true }],
    ['usage/refresh', { ok: true }],
  ])
  const ctx = {
    get(name) {
      assert.equal(name, 'connection')
      return {
        rpc: {
          async call(channel, endpoint, payload) {
            calls.push({ channel, endpoint, payload })
            return { ok: true, value: values.get(endpoint) }
          },
        },
      }
    },
  }

  const api = createUsageApi(ctx)
  assert.deepEqual(await api.snapshot(), { data: true })
  assert.deepEqual(await api.getConfig(), { hasToken: false })
  assert.deepEqual(await api.setConfig({ token: 'token-value', apiKey: 'key-value' }), { ok: true })
  assert.deepEqual(await api.resetLocal(), { ok: true })
  assert.deepEqual(await api.refresh(), { ok: true })

  assert.deepEqual(calls, [
    { channel: '/api', endpoint: 'usage/snapshot', payload: { args: {} } },
    { channel: '/api', endpoint: 'usage/getConfig', payload: { args: {} } },
    {
      channel: '/api',
      endpoint: 'usage/setConfig',
      payload: { args: { cfg: { token: 'token-value', apiKey: 'key-value' } } },
    },
    { channel: '/api', endpoint: 'usage/resetLocal', payload: { args: {} } },
    { channel: '/api', endpoint: 'usage/refresh', payload: { args: {} } },
  ])
})

test('RPC adapter rejects failed envelopes without exposing remote details', async () => {
  const ctx = {
    get: () => ({
      rpc: {
        call: async () => ({
          ok: false,
          error: { code: 'internal', message: 'secret-value must not escape' },
        }),
      },
    }),
  }
  await assert.rejects(createUsageApi(ctx).snapshot(), (error) => {
    assert.match(error.message, /usage\/snapshot failed \(internal\)/)
    assert.doesNotMatch(error.message, /secret-value/)
    return true
  })
})

test('RPC adapter fails clearly when Connection is unavailable', () => {
  assert.throws(
    () => createUsageApi({ get: () => undefined }),
    /connection RPC service is unavailable/,
  )
})
