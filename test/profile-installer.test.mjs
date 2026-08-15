import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { install } from '../scripts/install.mjs'
import { uninstall } from '../scripts/uninstall.mjs'
import { inspectRoster, installRoster, uninstallRoster } from '../scripts/profile.mjs'

async function profileFixture(patch) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-panel-'))
  const profileDir = join(root, '.dsh', 'profiles', 'web')
  const packageDir = join(profileDir, 'node_modules', 'dsh-usage-panel')
  await mkdir(join(packageDir, 'lib'), { recursive: true })
  await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }))
  await writeFile(join(profileDir, 'cordis.patch.yml'), patch)
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'dsh-usage-panel', version: '1.0.0' }))
  await writeFile(join(packageDir, 'lib', 'index.js'), 'export default class {}\n')
  await writeFile(
    join(packageDir, 'lib', 'client.js'),
    'window.__ModuleLoader__.load({ id: "dsh-usage-panel", factory: () => ({}) })\n',
  )
  return profileDir
}

test('install is idempotent, preserves unrelated YAML and creates one backup', async () => {
  const original = `# existing user comment
- insert:
    - id: another-plugin
      name: another-plugin
      config:
        enabled: true
- id: another-plugin
  config:
    theme: dark
`
  const profileDir = await profileFixture(original)

  const first = await install({ profileDir })
  assert.equal(first.changed, true)
  assert.equal(first.count, 1)
  assert.ok(first.backupPath)

  const afterFirst = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')
  assert.match(afterFirst, /# existing user comment/)
  const parsed = parse(afterFirst)
  assert.deepEqual(parsed[0].insert[0], {
    id: 'another-plugin',
    name: 'another-plugin',
    config: { enabled: true },
  })
  assert.deepEqual(parsed[1], { id: 'another-plugin', config: { theme: 'dark' } })
  assert.deepEqual(inspectRoster(afterFirst), { current: 1, legacy: 0, total: 1 })

  const second = await install({ profileDir })
  assert.equal(second.changed, false)
  assert.equal(second.count, 1)
  const files = await readdir(profileDir)
  assert.equal(files.filter(name => name.startsWith('cordis.patch.yml.backup-')).length, 1)
})

test('install safely migrates legacy id and removes duplicate roster entries', () => {
  const source = `- insert:
    - id: dsh-usage-panel
      name: '@dsh-usage-panel'
      config:
        retained: true
    - id: '@dsh-usage-panel'
      name: '@dsh-usage-panel'
      config: {}
    - id: keep-me
      name: keep-me
`
  const result = installRoster(source)
  assert.equal(result.changed, true)
  assert.equal(result.migratedLegacy, true)
  assert.equal(result.count, 1)
  assert.doesNotMatch(result.output, /name: ['"]?@dsh-usage-panel/)
  const parsed = parse(result.output)
  assert.deepEqual(parsed[0].insert[0], {
    id: 'dsh-usage-panel',
    name: 'dsh-usage-panel',
    config: { retained: true },
  })
  assert.deepEqual(parsed[0].insert[1], { id: 'keep-me', name: 'keep-me' })
})

test('uninstall is idempotent and removes only this plugin', async () => {
  const profileDir = await profileFixture(`- insert:
    - id: keep-me
      name: keep-me
    - id: dsh-usage-panel
      name: dsh-usage-panel
      config: {}
`)
  const first = await uninstall({ profileDir })
  assert.equal(first.changed, true)
  assert.equal(first.removed, 1)
  const afterFirst = await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')
  assert.deepEqual(parse(afterFirst), [{ insert: [{ id: 'keep-me', name: 'keep-me' }] }])

  const second = await uninstall({ profileDir })
  assert.equal(second.changed, false)
  assert.equal(second.removed, 0)
  assert.deepEqual(parse(second.output), [{ insert: [{ id: 'keep-me', name: 'keep-me' }] }])
})

test('pure uninstall handles legacy entries without touching adjacent configuration', () => {
  const source = `- insert:
    - id: '@dsh-usage-panel'
      name: '@dsh-usage-panel'
- id: user-setting
  config:
    value: 1
`
  const result = uninstallRoster(source)
  assert.equal(result.removed, 1)
  assert.deepEqual(parse(result.output), [{ id: 'user-setting', config: { value: 1 } }])
})

test('invalid YAML reports only a location and never echoes source secrets', () => {
  const source = `- insert:\n    - id: keep\n      config: [secret-token-value\n`
  assert.throws(() => installRoster(source, 'cordis.patch.yml'), (error) => {
    assert.match(error.message, /cordis\.patch\.yml 不是有效 YAML/)
    assert.match(error.message, /第 \d+ 行，第 \d+ 列/)
    assert.doesNotMatch(error.message, /secret-token-value/)
    return true
  })
})

test('profile validation rejects a directory without the Harness web marker', async () => {
  const profileDir = await profileFixture('[]\n')
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'unrelated-project' }))
  await assert.rejects(install({ profileDir }), /未找到可用的 DeepSeek Harness web profile/)
})

test('atomic patch replacement preserves restrictive POSIX permissions', {
  skip: process.platform === 'win32',
}, async () => {
  const profileDir = await profileFixture('[]\n')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  await chmod(patchPath, 0o600)
  await install({ profileDir })
  assert.equal((await stat(patchPath)).mode & 0o777, 0o600)
})
