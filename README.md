# dsh-usage-panel

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面的第三方用量面板。安装后随 `pnpm dsh web` 自动加载，不需要修改 Harness 源码、手写 YAML、创建 junction/symlink 或重新打包 client。

## 功能

- 悬浮鲸鱼按钮，可拖动并记住位置，也可切换到输入框下方的 dock 模式
- 今日、昨日、本周、本月用量
- 缓存命中／未命中 Token、输出 Token、请求次数、模型与成本统计
- DeepSeek 平台用量、账户余额和本地 DSH Session 实时用量
- `userToken` / API Key 设置、刷新、重置本地统计和 localStorage 持久化

## 要求

- DeepSeek Harness `0.1.0-rc.5` 或兼容版本
- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm
- 已创建 `~/.dsh/profiles/web`；通常首次运行 Harness Web 后即存在

## GitHub 安装

当前 GitHub-only 阶段推荐在 Harness Web profile 中安装：

```bash
cd ~/.dsh/profiles/web
pnpm add github:JJLin131/deepseek-harness-usagePlugin
node node_modules/dsh-usage-panel/scripts/cli.mjs install
pnpm dsh web
```

也可以直接调用随包发布的脚本：

```bash
node node_modules/dsh-usage-panel/scripts/install.mjs
```

安装器会验证包确实位于当前 Web profile 的 `node_modules`，再安全更新 `cordis.patch.yml`。已有配置和其他插件不会被覆盖；发生修改时会在同目录创建带时间戳的备份。重复运行不会产生重复 entry。

## 安装后的使用方式

1. 在 Harness Web profile 中启动 Web 界面：

   ```bash
   cd ~/.dsh/profiles/web
   pnpm dsh web
   ```

2. 打开终端输出的 Web 地址。页面右下角会出现 DeepSeek 鲸鱼按钮；悬停约 350 毫秒或单击按钮即可展开用量面板，按住按钮可以拖动位置。
3. 首次使用时打开面板右上角的设置：

   - 不配置任何密钥时，仍可查看当前 DSH 进程内的 Session 请求数和 Token 估算。
   - 若要查看 DeepSeek 平台的今日、昨日、本周和本月用量，请填写 `platform.deepseek.com` 的 `userToken`。
   - DeepSeek API Key 是可选项，仅用于查询账户余额；留空时插件会尝试使用 Harness 的 `DEEPSEEK_API_KEY` credentials。

4. 获取 `userToken`：登录 `platform.deepseek.com`，打开浏览器开发者工具，进入 **Application → Local Storage → platform.deepseek.com**，复制 `userToken` 字段的值，粘贴到面板后点击“保存并刷新”。面板内的 `?` 按钮也提供相同步骤。
5. 设置页可以将面板切换为“悬浮窗”或“输入框下方”。面板支持立即刷新、清零本次 Host 进程内的本地统计，以及按时间范围查看平台数据。

如果安装后没有看到鲸鱼按钮，先重启 `pnpm dsh web`，再运行：

```bash
node "$HOME/.dsh/profiles/web/node_modules/dsh-usage-panel/scripts/cli.mjs" doctor
```

上面的命令可以从任意目录运行；不要在 Harness 仓库根目录直接使用相对路径 `node_modules/dsh-usage-panel/...`，因为插件安装在 Web profile 而不是 Harness 仓库中。`doctor` 中所有项目均应显示 `PASS`；若仍有问题，请保留输出用于排查，但不要公开粘贴 Token 或 API Key。

## npm 发布后的单命令安装

包发布到 npm 后可从任意目录执行：

```bash
pnpm dlx dsh-usage-panel install
```

CLI 会在缺包时把当前版本安装到 `~/.dsh/profiles/web`，然后完成 profile 注册。若要指定 Git 或其他包规格：

```bash
pnpm dlx dsh-usage-panel install --package <package-spec>
```

## 升级

GitHub 版本：

```bash
cd ~/.dsh/profiles/web
pnpm update dsh-usage-panel
node node_modules/dsh-usage-panel/scripts/cli.mjs install
```

更新后重启 `pnpm dsh web`。仓库提交了可运行的 `lib/index.js`、`lib/client.js` 及 source map，普通用户不需要运行构建命令。

## 诊断

```bash
node "$HOME/.dsh/profiles/web/node_modules/dsh-usage-panel/scripts/cli.mjs" doctor
```

`doctor` 只输出非敏感的安装事实，检查 profile、包名、loader entry、Host/Client 构建产物、client bundle ID 与旧版配置。它不会打印 Token、API Key 或配置内容，也不会删除检测到的旧开发 junction。

如果 `doctor` 明确报告 `legacy development junction ... (link)`，这个旧开发链接可能会优先于 Web profile 中的正式包。先停止 Harness，然后只移除报告中的链接；Windows 默认 profile 可执行：

```bash
cmd.exe /d /c rmdir "%USERPROFILE%\.dsh\profiles\node_modules\dsh-usage-panel"
```

不要添加 `/s`，也不要删除链接所指向的源码目录。移除后重新运行 `doctor`，确认全部 `PASS`，再启动 `pnpm dsh web`。

## 卸载

```bash
cd ~/.dsh/profiles/web
node node_modules/dsh-usage-panel/scripts/cli.mjs uninstall
pnpm remove dsh-usage-panel
```

也可在包已从 profile 删除后运行：

```bash
pnpm dlx dsh-usage-panel uninstall
```

`uninstall` 只移除本插件的 loader entry，不删除其他配置或用户文件；重复执行是安全的。修改前同样会创建备份。

## 配置与安全

- `platform.deepseek.com` 的 `userToken` 与手工输入的 DeepSeek API Key 保存在浏览器 origin 的 localStorage 键 `dsh-usage.config` 中，以便重启浏览器后恢复。它们不会写入 `cordis.yml` 或 `cordis.patch.yml`。
- Host 仅通过 RPC 接收设置，`snapshot` / `getConfig` 只返回是否配置、长度等非敏感事实，不回传密钥。
- 若没有手工 API Key，Host 会尝试读取 Harness 的 `DEEPSEEK_API_KEY` credentials；credentials 服务不可用时余额功能降级为空，不影响面板其他功能。
- 网络请求只把鉴权值放在 HTTPS Authorization header 中。错误日志不会输出请求头、Token、API Key 或远端响应正文。
- DeepSeek 平台用量接口是控制台私有接口，平台变更时平台统计可能暂时不可用；本地 Session 统计与其他 Harness 功能不受影响。

## 工作原理

Host 入口 `lib/index.js` 注册 Cordis `usage` 服务，并在 Harness Connection 的 `/api` channel 上直接认领：

- `usage/snapshot`
- `usage/getConfig`
- `usage/setConfig`
- `usage/resetLocal`
- `usage/refresh`

浏览器端把所有调用集中在 `src/client/usage-api.ts`，使用 Harness Connection 的兼容调用：

```js
connection.rpc.call('/api', 'usage/setConfig', {
  args: { cfg }
})
```

`lib/client.js` 加载时主动注册 `window.__ModuleLoader__.load({ id: 'dsh-usage-panel', ... })`。包名、loader name、bundle ID 与 `<style data-plugin>` 均统一为 `dsh-usage-panel`。

Host 不依赖 `@Remote` 装饰器的模块私有 marker，因此在 npm 构建版 Harness 和通过 `node --import tsx/esm` 运行的源码 checkout 中都能注册同一组 RPC。

## 开发

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm test:package
pnpm test:pack
```

`prepack` 会重新构建并检查发布产物。仓库仍直接提交 `lib/`，以保证 Git dependency 安装不依赖用户环境执行构建。

若本机已安装 Harness rc.5，可运行 `pnpm test:compat:rc5` 使用其真实 Typert 包复测 Host；也可用 `DSH_RC5_NODE_MODULES` 指向其他 Harness `node_modules`。

项目结构：

```text
src/index.ts               Host Usage Service
src/client.ts              Usage Panel UI 与 Client 插件入口
src/client/usage-api.ts    Connection RPC adapter
scripts/                   install / uninstall / doctor / CLI
lib/                       已构建的发布产物
test/                      RPC、安装器、Host 与 package 验收测试
```

## 已知兼容性限制

- 当前实现按 Harness `0.1.0-rc.5` 的 `connection.rpc.call('/api', endpoint, { args })`、Typert Gateway SRC fallback 和 `dsh.client` 模块加载规范验证。若 Harness 在后续正式版更改这些公开面，需要发布对应插件版本。
- 安装或卸载后必须重启 Web 进程，因为 Harness 会缓存插件包元数据和 client graph。
- 安装器只管理默认 Web profile；高级部署可用 `--profile <path>` 指定其他兼容 profile。

除安装包并运行 install 命令外，不再需要手工修改 DeepSeek Harness。
