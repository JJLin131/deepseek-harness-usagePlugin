#!/usr/bin/env node
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertWebProfile,
  inspectLegacyLinks,
  installRoster,
  readInstalledPackage,
  readPatch,
  writePatch,
} from './profile.mjs'

export async function install({ profileDir } = {}) {
  const profile = await assertWebProfile(profileDir)
  await readInstalledPackage(profile)
  const patch = await readPatch(profile)
  const result = installRoster(patch.source, patch.patchPath)
  const write = result.changed
    ? await writePatch({ ...patch, output: result.output })
    : {}
  return {
    profileDir: profile,
    ...result,
    ...write,
    legacyLinks: await inspectLegacyLinks(profile),
  }
}

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
}

if (isMain()) {
  install().then((result) => {
    console.log(result.changed
      ? `已注册 dsh-usage-panel：${result.profileDir}`
      : `dsh-usage-panel 已注册，无需修改：${result.profileDir}`)
    if (result.backupPath) console.log(`原配置备份：${result.backupPath}`)
    for (const legacy of result.legacyLinks) {
      console.warn(`检测到会抢先加载的旧开发安装，请先移除并重启 Harness：${legacy.path}`)
    }
    console.log('请重启 pnpm dsh web 使插件清单生效。')
  }).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
