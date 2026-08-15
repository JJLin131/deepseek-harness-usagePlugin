/**
 * tsdown 打包配置：本包只产浏览器半（lib/client.js）。
 * 宿主半由 tsc 编译（见 tsconfig.host.json → lib/index.js）：
 *  官方同款做法 —— tsc 会把标准装饰器 @Remote 编译为 __esDecorate，
 *  Node 24（DSH 运行时的实际 Node）不解析字面 @ 装饰器语法，必须转换；
 *  当前 tsdown/rolldown 0.22.x 没有装饰器转换选项，故宿主半不走 tsdown。
 *
 * 浏览器半必须是"闭包工厂"产物（与官方 packages/client/tsdown.client.ts 一致）：
 *  执行 bundle 只调用 window.__ModuleLoader__.load({ id, factory }) 注册工厂；
 *  物化时 factory(require) → module.exports = { inject, apply }，clientModules 以此挂载。
 *  外部依赖（deps.neverBundle）必须等于浏览器 loader 的模块表（PLATFORM_MODULES），
 *  表外的 @deepseek-ai/* 值导入是构建错误（跨插件值导入会被拒绝）——本插件只用服务，不 import。
 *
 * 注：tsdown 0.22.x 中 `external` 已废弃，改用 `deps.neverBundle`。
 */
import { defineConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-usage-panel'

/** 浏览器 loader 模块表（平台模块）：与 deepseek-harness packages/client/tsdown.client.ts 的 CLIENT_EXTERNALS 一致。 */
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

export default defineConfig({
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  deps: { neverBundle: CLIENT_EXTERNALS },
  dts: false,
  clean: false,
  sourcemap: true,
  outExtensions: () => ({ js: '.js' }),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
