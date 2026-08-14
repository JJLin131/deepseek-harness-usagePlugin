/**
 * Generates install/define-payload.json — the complete cordis_define argument
 * set for the DeepSeek Usage Panel, with plugin/host.js and plugin/client.js
 * embedded as the code.host / code.client strings.
 *
 * Run:  node install/build-payload.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const hostSource = readFileSync(join(root, 'plugin', 'host.js'), 'utf8')
const clientSource = readFileSync(join(root, 'plugin', 'client.js'), 'utf8')

const payload = {
  plugin: { kind: 'new', idPrefix: 'usage' },
  name: 'DeepSeek 用量面板',
  purpose:
    '在 DSH 页面实时显示 DeepSeek 开放平台的 API 请求次数、Token 消耗（输入命中缓存 / 输入未命中缓存 / 输出）'
    + '与消费金额（当月/今日/按模型），以及账户余额；同时叠加显示 DSH 本次会话的实时用量。'
    + '支持右下角 / 右上角悬浮（悬停展开完整信息）或输入框下方两种显示位置，可随时切换。',
  code: { host: hostSource, client: clientSource },
}

const out = join(root, 'install', 'define-payload.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
console.log('wrote ' + out)
console.log('host bytes:   ' + Buffer.byteLength(hostSource))
console.log('client bytes: ' + Buffer.byteLength(clientSource))
