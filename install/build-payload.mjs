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
    + '与消费金额，支持今日/昨日/本周/本月时间范围切换（每范围含完整指标、按模型明细与 Token 消耗图表：'
    + '日范围按小时、周/月按天），以及账户余额与 DSH 本会话实时用量；设置与配置教程独立于用量信息。',
  code: { host: hostSource, client: clientSource },
}

const out = join(root, 'install', 'define-payload.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
console.log('wrote ' + out)
console.log('host bytes:   ' + Buffer.byteLength(hostSource))
console.log('client bytes: ' + Buffer.byteLength(clientSource))
