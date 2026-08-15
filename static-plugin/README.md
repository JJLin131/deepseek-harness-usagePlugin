# 静态部署（随 DSH 自动启动，无需对话安装/二次激活）

动态版（`plugin/` + `cordis_define/cordis_run`）需要用户在「创造模式」会话里让 agent 安装，
且 **DSH 重启后定义即丢失**，每次重启都要重新安装。本目录提供**静态双面插件**：
安装一次后随 DSH 启动自动加载，**不再需要对话、不再需要每次批准/二次启动**。

## 原理（DSH 双轨机制，源码依据）

- **浏览器半（web 插件）**：`dsh-client-modules` 服务在启动时扫描宿主 Loader 的每条配置，
  对声明了 `dsh.client` 的包读取 `exports["./client"]` 构建产物并注入
  `window.__DSH_BOOT__`；页面加载即激活。产物必须是**闭包工厂**
  （`window.__ModuleLoader__.load({ id, factory })`，物化时 `factory(require)` →
  `module.exports = { inject, apply }`）。参考 `packages/client/modules/src/`。
- **宿主半**：包作为宿主组合的一行（cordis.yml 行 → Loader entry），随进程启动挂载；
  通过 **Remote 服务**（`TypertRemoteService` + `@Remote`）向浏览器半供 RPC，
  浏览器半用 `connection.api.usage.<method>()` 调用。参考
  `packages/feedback/message-feedback/src/index.ts`。
- 静态插件是部署自带的受信代码，**没有每次运行的批准环节**。

> DSH 没有"下载文件夹即用"：Loader 只组合**配置里声明的行**。
> 安装 = 把包放进 DSH 工作区（node_modules 可解析）+ 在宿主组合加一行；
> 此后每次启动自动加载。

## 已核实的部署事实（2026-02，profiles/node_modules 内装版本）

- `TypertRemoteService` / `Remote` 来自 **`@deepseek-ai/dsh-typert-protocol`**
  （不是 `dsh-api-remotes`——后者只导出 agent-lookup 与 `apply`）。
- TypertRemoteService 构造签名 `(ctx, serviceKey, options?)`：serviceKey 既是 Cordis
  服务键也是 Typert 默认 wire 命名空间；`super(ctx, 'usage')` 即 `ctx.usage` +
  `connection.api.usage.*`。
- 类插件生命周期（cordis fiber.js）：`new Plugin(ctx, config)` →
  `instance[Service.init]?.()` → fiber 卸载时自动释放构造/init 期间注册的
  `ctx.on` / `ctx.interval`。`static inject` 声明的服务经 `this.ctx.<name>` 访问。
- **装饰器必须编译**：Node 24（DSH 实际运行时）不解析字面 `@` 装饰器语法。
  宿主半用 **tsc** 编译（标准装饰器 → `__esDecorate`），与官方包一致；
  tsdown/rolldown 0.22.2 没有装饰器转换选项，**只用于浏览器半**。
- 浏览器 loader 模块表（CLIENT_EXTERNALS）= `packages/client/tsdown.client.ts` 的
  `PLATFORM_MODULES`：react / react-dom / @deepseek-ai/cordis / ui-slots / web-react /
  ui-primitives / ui-attachment / schema-form。bundle 只允许 require 表内模块
  （本插件只 `require("react")`）。
- 浏览器半**没有 `styles` 服务**（动态沙箱才有）；CSS 改为模块内
  `injectStyles()` 自建 `<style data-plugin>` 注入，clientModules 的 claimStyles 会认领。
- 客户端 `connection` 服务存在（平台 connection 插件）；`ctx.slots` / `ctx.interval`
  在 `inject: ['slots','timer','connection']` 下可用。

## 动态 → 静态 替换表

| 动态版（plugin/） | 静态版（static-plugin/src/） |
|---|---|
| 函数体 `return { inject, apply(ctx){…} }` | 模块 `export const inject` + `export function apply(ctx)` |
| `harness.handle('snapshot', fn)` | `@Remote('snapshot')` 方法（类 `extends TypertRemoteService`） |
| `host.call('snapshot')` | `api.snapshot()`（`api = ctx.get('connection').api.usage`） |
| `host.call('getConfig')` | `api.getConfig()` |
| `host.call('setConfig', x)` | `api.setConfig(x)` |
| `host.call('resetLocal')` | `api.resetLocal()` |
| `host.call('refresh')` | `api.refresh()` |
| `styles.insert(CSS)` | `injectStyles(CSS)`（模块内 <style> 注入） |
| 沙箱规避（ctx 只存在于 apply 内） | 无需规避：静态模块可直接 import node 能力 |

面板 UI（Detail / TokenChart / Meter / ModelRows / UsageFloat / UsageDock / CSS）与
`plugin/client.js` **逐字一致**（由 `install/gen-static-client.mjs` 机械生成，
改动态版后运行 `node install/gen-static-client.mjs` 重新生成）。

## 目录

```
static-plugin/
  package.json        dsh.client 声明（platform: web, immediately: true）+ exports["./client"]
  tsconfig.host.json  宿主半 tsc 编译配置（装饰器 → __esDecorate）
  tsdown.config.ts    浏览器半打包：lib/client.js（闭包工厂，仅 require react）
  cordis-row.yml      宿主组合行（追加到部署的 cordis.yml / 用户补丁层）
  src/index.ts        宿主半：class UsageService extends TypertRemoteService（export default）
  src/client.ts       浏览器半：store/轮询/槽位接线（面板 UI 与 plugin/client.js 一致）
```

## 构建

```sh
node <deepseek-harness>\node_modules\typescript\bin\tsc -p static-plugin\tsconfig.host.json   # → lib/index.js
node <deepseek-harness>\node_modules\tsdown\dist\run.mjs                                      # → lib/client.js
```

（本地构建需要 `static-plugin/node_modules/` 下可解析 tsdown / @deepseek-ai / react，
可用 junction 指到 harness 的 node_modules 与 DSH 部署的 profiles/node_modules。）

## 安装到当前部署（一次性，此后自动加载）

针对本机部署 `C:\Users\PC\.dsh\profiles\web`（用户级补丁层，非升级覆盖区）：

1. **让 Loader 可解析包**：在 `profiles\node_modules\@dsh-usage-panel` 建 junction →
   `D:\IntelliJ_IDEA_U\Projects\dsh-UsagePlugin\static-plugin`
   （Loader 用 `import(name)` 解析，Node 从 `profiles\web` 沿 node_modules 链向上查找）。
2. **宿主组合加一行**：把 `cordis-row.yml` 的 insert 追加到
   `profiles\web\cordis.patch.yml`（该文件就是给用户补丁用的，升级不覆盖）。
3. **重启 DSH**：Host 半随进程挂载；clientModules 扫描到新行 → 浏览器半注入页面。
   之后 **无需任何对话或批准**；DSH 重启也自动恢复。
4. （可选）Token 配置仍在浏览器 localStorage 自动记忆。

## 已知风险/注意

- `dsh.client.inject` 是**图元数据**（信息性），激活顺序由客户端插件自身的
  `inject: ['slots','timer','connection']` 服务依赖决定。
- clientModules 对包元数据有进程内缓存：**插件集变更需重启 DSH 才生效**；
  bundle 内容变更也需重启（或触发 ClientModuleRegistry.rebuilt 的 HMR 路径）。
- 若部署升级更换了 `cordis-plugin-loader` / `dsh-client-modules` / `dsh-typert-protocol`
  的接口，需按新版本核对本 README 的"已核实事实"。
