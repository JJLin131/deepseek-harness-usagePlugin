import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PLUGIN_ID,
  assertWebProfile,
  inspectLegacyLinks,
  inspectRoster,
  readInstalledPackage,
  readPatch,
  resolveProfileDir,
} from './profile.mjs'

async function exists(path) {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** Run non-secret installation checks and return actionable findings. */
export async function doctor({ profileDir } = {}) {
  const profile = resolveProfileDir(profileDir)
  const checks = []
  let packageDir

  try {
    await assertWebProfile(profile)
    checks.push({ name: 'web profile', ok: true, detail: profile })
  } catch (error) {
    checks.push({ name: 'web profile', ok: false, detail: error.message })
    return { ok: false, profileDir: profile, checks }
  }

  try {
    const installed = await readInstalledPackage(profile)
    packageDir = installed.packageDir
    checks.push({ name: 'package name', ok: true, detail: installed.manifest.version ?? 'unknown version' })
  } catch (error) {
    checks.push({ name: 'package installed', ok: false, detail: error.message })
  }

  const patch = await readPatch(profile)
  try {
    const roster = inspectRoster(patch.source, patch.patchPath)
    checks.push({
      name: 'loader roster',
      ok: roster.current === 1 && roster.total === 1,
      detail: `current=${roster.current}, legacy=${roster.legacy}, total=${roster.total}`,
    })
    if (roster.legacy > 0) {
      checks.push({ name: 'legacy package id', ok: false, detail: '运行 install 可安全迁移 @dsh-usage-panel' })
    }
  } catch (error) {
    checks.push({ name: 'loader roster', ok: false, detail: error.message })
  }

  if (packageDir !== undefined) {
    const hostPath = join(packageDir, 'lib', 'index.js')
    const clientPath = join(packageDir, 'lib', 'client.js')
    checks.push({ name: 'lib/index.js', ok: await exists(hostPath), detail: hostPath })
    const clientExists = await exists(clientPath)
    checks.push({ name: 'lib/client.js', ok: clientExists, detail: clientPath })
    if (clientExists) {
      const bundle = await readFile(clientPath, 'utf8')
      const registration = `id: ${JSON.stringify(PLUGIN_ID)}`
      checks.push({
        name: 'client bundle id',
        ok: bundle.includes(registration),
        detail: bundle.includes(registration) ? PLUGIN_ID : `未注册 ${PLUGIN_ID}`,
      })
    }
  }

  for (const legacy of await inspectLegacyLinks(profile)) {
    checks.push({
      name: 'legacy development junction',
      ok: false,
      detail: `${legacy.path}${legacy.link ? ' (link)' : ''}；doctor 不会删除它`,
    })
  }

  return { ok: checks.every(check => check.ok), profileDir: profile, checks }
}
