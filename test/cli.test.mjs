import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPnpm } from '../scripts/cli.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('pnpm runner resolves the platform command shim without a shell', () => {
  const result = runPnpm(['--version'], root, 'pipe')
  assert.ok(result.error == null)
  assert.equal(result.status, 0)
  assert.match(result.stdout.toString(), /^\d+\.\d+\.\d+/)
})
