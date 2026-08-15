#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import crossSpawn from 'cross-spawn'
import { doctor } from './doctor.mjs'
import { install } from './install.mjs'
import { assertWebProfile, readInstalledPackage, resolveProfileDir } from './profile.mjs'
import { uninstall } from './uninstall.mjs'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const ownManifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))

function usage() {
  console.log(`dsh-usage-panel <command> [options]

Commands:
  install       安装包（需要时）并注册到 web profile
  uninstall     只移除 loader entry，不删除包和用户文件
  doctor        检查安装、产物、bundle ID 与旧配置

Options:
  --profile <path>   指定 web profile（默认 ~/.dsh/profiles/web）
  --package <spec>   install 缺包时交给 pnpm add 的包规格
  --no-add           缺包时只提示，不自动执行 pnpm add
  -h, --help         显示帮助`)
}

function parseArgs(argv) {
  if (argv[0] === '--help' || argv[0] === '-h') return { help: true }
  const options = { command: argv[0] }
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--profile' || arg === '--package') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${arg} 缺少参数`)
      options[arg === '--profile' ? 'profileDir' : 'packageSpec'] = value
      index += 1
    } else if (arg === '--no-add') {
      options.noAdd = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  return options
}

async function ensureInstalled(profileDir, packageSpec, noAdd) {
  try {
    await readInstalledPackage(profileDir)
    return
  } catch (error) {
    if (noAdd) throw error
  }
  const spec = packageSpec ?? `dsh-usage-panel@${ownManifest.version}`
  console.log(`正在安装 ${spec} 到 ${profileDir} ...`)
  const result = runPnpm(['add', '--', spec], profileDir, 'inherit')
  if (result.error) throw new Error(`无法启动 pnpm：${result.error.message}`)
  if (result.status !== 0) throw new Error(`pnpm add 失败，退出码 ${result.status}`)
  await readInstalledPackage(profileDir)
}

/** 通过 cross-spawn 解析 Windows .cmd shim，始终以参数数组执行，避免 shell 注入。 */
export function runPnpm(args, cwd, stdio = 'inherit') {
  return crossSpawn.sync('pnpm', args, { cwd, stdio })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || options.command === undefined) {
    usage()
    return
  }

  if (options.command === 'install') {
    const profileDir = await assertWebProfile(resolveProfileDir(options.profileDir))
    await ensureInstalled(profileDir, options.packageSpec, options.noAdd)
    const result = await install({ profileDir })
    console.log(result.changed ? '安装完成；loader entry 已写入。' : '安装已是最新状态，无需重复写入。')
    if (result.backupPath) console.log(`原配置备份：${result.backupPath}`)
    for (const legacy of result.legacyLinks) console.warn(`旧开发安装未删除：${legacy.path}`)
    console.log('请重启 pnpm dsh web。')
    return
  }

  if (options.command === 'uninstall') {
    const result = await uninstall({ profileDir: options.profileDir })
    console.log(result.changed ? '已移除 loader entry。' : '未发现 loader entry，无需修改。')
    if (result.backupPath) console.log(`原配置备份：${result.backupPath}`)
    console.log(`如需删除包：cd ${result.profileDir} && pnpm remove dsh-usage-panel`)
    return
  }

  if (options.command === 'doctor') {
    const result = await doctor({ profileDir: options.profileDir })
    for (const check of result.checks) {
      console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`)
    }
    if (!result.ok) process.exitCode = 1
    return
  }

  throw new Error(`未知命令：${options.command}`)
}

function isMain() {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
}

if (isMain()) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
