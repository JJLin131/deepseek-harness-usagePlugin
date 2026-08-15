/**
 * 从动态版 plugin/client.js 机械生成静态版 static-plugin/src/client.ts。
 *
 * 变换规则（与动态版逐字同构，仅替换调用点）：
 *  - 头部：换为静态版说明 + `import React from 'react'`（react 是平台模块，打包时 external，
 *    运行时由浏览器 loader 的模块表提供）。
 *  - RPC：`host.call('name'[, args])` -> `api.name(args)`；`api` 是模块级句柄，
 *    在 apply() 里从 `ctx.get('connection').api.usage` 取得（Typert wire 命名空间 = serviceKey 'usage'）。
 *  - CSS：`styles.insert(CSS)`（动态沙箱自由变量）-> `injectStyles(CSS)`（自建 <style data-plugin> 注入，
 *    静态客户端没有 styles 服务；system.ts 的 claimStyles 会认领 data-plugin 标签）。
 *  - 尾部：`return { inject: [...], apply(ctx) {...} }` -> `export const inject` + `export function apply(ctx)`
 *    （bundle 的 module.exports 就是 { inject, apply }，clientModules 以此挂载）。
 *
 * 用法：node install/gen-static-client.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'plugin', 'client.js'), 'utf8')

// ---- 1. 头部 ---- 
const headStart = src.indexOf('/**')
const headEnd = src.indexOf('*/', headStart) + 2
const oldHead = src.slice(headStart, headEnd)
const newHead = `/**
 * DeepSeek 用量面板 — 浏览器半（静态 dsh.client web 插件，随 DSH 启动自动注入页面）。
 *
 * 由 install/gen-static-client.mjs 从动态版 plugin/client.js 机械生成，面板主体逐字一致。
 * 与动态版的差异（唯一允许的差异点）：
 *  - RPC：host.call('x'[, args]) -> api.x(args)，api = ctx.get('connection').api.usage
 *    （对应 host.ts 的 TypertRemoteService 服务 usage，wire 命名空间 = serviceKey）。
 *  - CSS：styles.insert(CSS)（动态沙箱自由变量）-> injectStyles(CSS)（模块内 <style> 注入，
 *    带 data-plugin 标签，卸载时由 clientModules 认领/清理）。
 *  - 导出形态：export const inject + export function apply(ctx)（静态客户端插件契约）。
 *  - React 来自平台模块 'react'（external），不 import 任何 @deepseek-ai 值。
 */`
let out = src.replace(oldHead, newHead)

// ---- 2. 插入 React 导入 ----
out = out.replace(newHead, newHead + "\n\nimport React from 'react'")

// ---- 3. 模块级 api 句柄 + CSS 注入辅助（插在 store 段之前）----
const storeMarker = "// ---- store: snapshot + config facts + placement + input drafts ----"
const helpers = `// ---- 静态版接线：Remote 句柄 + CSS 注入（host.call / styles.insert 的替代）----
let api = null
let cssInjected = false
function injectStyles(css) {
  if (cssInjected || typeof document === 'undefined') return
  cssInjected = true
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-usage-panel'
  tag.textContent = css
  document.head.appendChild(tag)
}

`
if (!out.includes(storeMarker)) throw new Error('store marker not found')
out = out.replace(storeMarker, helpers + storeMarker)

// ---- 4. host.call -> api.<name> ----
let rpcCount = 0
out = out.replace(/host\.call\('([^']+)'(?:,\s*([^)]+))?\)/g, (_m, name, args) => {
  rpcCount++
  return 'api.' + name + '(' + (args ? args.trim() : '') + ')'
})

// ---- 5. styles.insert(CSS) -> injectStyles(CSS) ----
let cssCount = 0
out = out.replace(/styles\.insert\(CSS\)/g, () => { cssCount++; return 'injectStyles(CSS)' })

// ---- 6. 尾部：return { inject, apply } -> export const inject + export function apply ----
const tailMarker = "// ---- plugin ----"
const tailIdx = out.indexOf(tailMarker)
if (tailIdx < 0) throw new Error('tail marker not found')
const tailBlock = out.slice(tailIdx)
const newTail = `// ---- 静态插件导出：bundle 的 module.exports = { inject, apply }，clientModules 挂载 ----
export const inject = ['slots', 'timer', 'connection']

export function apply(ctx) {
  // 浏览器半 RPC 通路：宿主 Remote 服务 usage（host.ts 的 TypertRemoteService, serviceKey 'usage'）
  const connection = ctx.get('connection')
  api = connection.api.usage

  injectStyles(CSS)

  const saved = readSaved()
  let position = saved.position
  if (position !== 'float' && position !== 'dock') {
    position = 'float'
    writeSaved({ position })
  }
  setState({
    position,
    floatPos: savedFloatPos(),
    draft: { token: saved.token || '', apiKey: saved.apiKey || '' },
  })
  if (saved.token || saved.apiKey) {
    api.setConfig({ token: saved.token || '', apiKey: saved.apiKey || '' }).catch(() => {})
  }

  refresh()
  refreshConfig()
  ctx.interval(refresh, 2000)
  ctx.interval(refreshConfig, 30 * 1000)

  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(
    { name: 'conversation.composer.dock', id: 'usage', order: 50, label: 'API 用量' },
    UsageDock,
  ))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'usage-float', order: 50, label: 'API 用量浮窗' },
    UsageFloat,
  ))
}
`
out = out.replace(tailBlock, newTail)

const dest = join(root, 'static-plugin', 'src', 'client.ts')
writeFileSync(dest, out, 'utf8')
console.log('written', dest)
console.log('lines:', out.split('\n').length)
console.log('host.call substitutions:', rpcCount)
console.log('styles.insert substitutions:', cssCount)
