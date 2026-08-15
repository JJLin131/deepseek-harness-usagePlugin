import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

test('package identity and public entries are publishable', async () => {
  assert.equal(manifest.name, 'dsh-usage-panel')
  assert.equal(manifest.main, './lib/index.js')
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.bin['dsh-usage-panel'], './scripts/cli.mjs')
  assert.equal(manifest.dependencies['cross-spawn'], '7.0.6')
  assert.deepEqual(manifest.dsh.client.inject, ['slots', 'timer', 'connection'])
  for (const file of ['lib/index.js', 'lib/client.js', 'lib/client.js.map', 'scripts/install.mjs', 'scripts/uninstall.mjs']) {
    assert.equal((await stat(join(root, file))).isFile(), true, file)
  }
})

test('client bundle registers the exact package id', async () => {
  const bundle = await readFile(join(root, 'lib', 'client.js'), 'utf8')
  assert.match(bundle, /__ModuleLoader__\.load\(\{\s*id: "dsh-usage-panel"/)
  assert.doesNotMatch(bundle, /id: "@dsh-usage-panel"/)
})

test('business source contains no legacy package specifier or obsolete RPC path', async () => {
  const sources = await Promise.all([
    'src/index.ts',
    'src/client.ts',
    'src/client/usage-api.ts',
    'tsdown.config.ts',
    'package.json',
  ].map(file => readFile(join(root, file), 'utf8')))
  const text = sources.join('\n')
  assert.doesNotMatch(text, /@dsh-usage-panel/)
  assert.doesNotMatch(text, /connection\.api\.usage/)
})
