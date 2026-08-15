import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { register } from 'node:module'

const nodeModules = resolve(
  process.env.DSH_RC5_NODE_MODULES
    ?? join(homedir(), '.dsh', 'profiles', 'node_modules'),
)
const protocolManifest = JSON.parse(await readFile(
  join(nodeModules, '@deepseek-ai', 'dsh-typert-protocol', 'package.json'),
  'utf8',
))
if (protocolManifest.version !== '0.1.0-rc.5') {
  throw new Error(`test:compat:rc5 需要 Typert 0.1.0-rc.5，实际为 ${protocolManifest.version}`)
}

register('./harness-compat-loader.mjs', import.meta.url, { data: { nodeModules } })
console.log(`rc.5 compatibility source: ${nodeModules}`)
