#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertWebProfile, readPatch, uninstallRoster, writePatch } from './profile.mjs'

export async function uninstall({ profileDir } = {}) {
  const profile = await assertWebProfile(profileDir)
  const patch = await readPatch(profile)
  const result = uninstallRoster(patch.source, patch.patchPath)
  const write = result.changed
    ? await writePatch({ ...patch, output: result.output })
    : {}
  return { profileDir: profile, ...result, ...write }
}

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
}

if (isMain()) {
  uninstall().then((result) => {
    console.log(result.changed
      ? `已从 web profile 移除 dsh-usage-panel：${result.profileDir}`
      : `web profile 中没有 dsh-usage-panel，无需修改：${result.profileDir}`)
    if (result.backupPath) console.log(`原配置备份：${result.backupPath}`)
    console.log('包文件仍保留；如需删除，请在 profile 中执行 pnpm remove dsh-usage-panel。')
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
