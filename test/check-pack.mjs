import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { runPnpm } from '../scripts/cli.mjs'

function readTarEntries(buffer) {
  const entries = []
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const text = (start, length) => header.subarray(start, start + length)
      .toString('utf8').replace(/\0.*$/s, '')
    const name = text(0, 100)
    const prefix = text(345, 155)
    const size = Number.parseInt(text(124, 12).trim() || '0', 8)
    const mode = Number.parseInt(text(100, 8).trim() || '0', 8)
    entries.push({ name: prefix ? `${prefix}/${name}` : name, mode })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

const root = join(import.meta.dirname, '..')
const destination = await mkdtemp(join(tmpdir(), 'dsh-usage-panel-pack-'))
try {
  const result = runPnpm(['pack', '--pack-destination', destination], root, 'pipe')
  assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message)
  const tarball = (await readdir(destination)).find(name => name.endsWith('.tgz'))
  assert.ok(tarball, 'pnpm pack did not create a tarball')
  const entries = readTarEntries(gunzipSync(await readFile(join(destination, tarball))))
  const names = entries.map(entry => entry.name).sort()
  assert.deepEqual(names, [
    'package/LICENSE',
    'package/README.md',
    'package/lib/client.js',
    'package/lib/client.js.map',
    'package/lib/index.js',
    'package/lib/index.js.map',
    'package/package.json',
    'package/scripts/cli.mjs',
    'package/scripts/doctor.mjs',
    'package/scripts/install.mjs',
    'package/scripts/profile.mjs',
    'package/scripts/uninstall.mjs',
  ].sort())
  const cli = entries.find(entry => entry.name === 'package/scripts/cli.mjs')
  assert.ok((cli.mode & 0o111) !== 0, 'CLI tar entry must be executable')
  console.log(`PASS  tarball contains ${names.length} expected runtime files and an executable CLI`)
} finally {
  await rm(destination, { recursive: true, force: true })
}
