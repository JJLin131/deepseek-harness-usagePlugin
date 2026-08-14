# dsh-UsagePlugin — DeepSeek 用量面板（DSH 动态插件）

在 DSH（DeepSeek Harness）页面里**实时**展示 DeepSeek API 的消耗情况：

- **请求次数**
- **Token 消耗拆分**：输入（命中缓存）、输入（未命中缓存）、输出
- **消费金额**（平台实际计费，¥/CNY；DSH 本会话为 USD 估算）
- **账户余额**（自动使用 DSH 的 `DEEPSEEK_API_KEY` 凭据）
- **缓存命中率**、**按模型明细**、**今日/当月**统计
- **DSH 实时用量**（本会话，无需任何配置，从启用面板起累计）

显示为可自定义的悬浮框：**鼠标悬停自动展开**完整信息；可切换
**右下角 / 右上角 / 输入框下方** 三种位置。

---

## 数据来源

| 数据 | 接口 | 鉴权 |
|---|---|---|
| 平台用量（请求数、tokens、金额、按模型） | `https://platform.deepseek.com/api/v0/usage/amount`、`/usage/cost`（控制台私有接口） | 平台登录后的 `userToken`（浏览器 localStorage） |
| 账户余额 | `https://api.deepseek.com/user/balance`（[官方公开接口](https://api-docs.deepseek.com/api/get-user-balance/)） | DSH 凭据 `DEEPSEEK_API_KEY`，或手动 API Key，或平台 Token |
| DSH 本会话实时用量 | DSH `session/event`（`assistant/message` 携带 `TokenUsage`） | 无需鉴权 |

平台接口结构取自公开资料（[CodexBar deepseek 文档](https://github.com/steipete/CodexBar/blob/main/docs/deepseek.md)、
[deepseek-usage skill](https://github.com/OpenMinis/MinisSkills/tree/main/deepseek-usage)）。

---

## 目录结构

```
plugin/
  host.js      Host 半：抓取平台用量/余额 + 聚合 DSH 会话用量 + RPC（harness.handle）
  client.js    Browser 半：右下/右上悬浮框（悬停展开）+ 输入框下方两种 UI + 配置表单
install/
  INSTALL.md   安装到当前 DSH 的图文步骤（cordis_define + cordis_run）
  define-payload.json   cordis_define 的完整参数（已生成）
  build-payload.mjs     重新生成 define-payload.json
test/
  host.test.mjs      Host 半集成测试（桩 ctx.shell/credentials，用真实接口格式 fixture）
  client.smoke.mjs   Client 半冒烟测试（桩 React/host/localStorage，验证槽位注册与悬停展开）
```

## 工作原理（双半插件）

- **Host 半**（服务端，`node:vm` 沙箱内）：
  - 用 `ctx.shell` 启动一个 `node` 子进程做 HTTP（沙箱无 `fetch`），请求体经环境变量传入，无引号转义问题；
  - 每 60 秒拉取当月 `usage/amount` + `usage/cost`（容错解析 `biz_data.total/days`），并聚合出
    请求次数、缓存命中/未命中、输出、金额（¥）与缓存命中率；
  - 经 `ctx.credentials` 解析 `DEEPSEEK_API_KEY` 查询余额；
  - 监听 `session/event` 累计 DSH 本会话的 `TokenUsage`（输入/缓存读/输出），并按列表价估算 USD；
  - 通过 `harness.handle` 暴露 `snapshot` / `getConfig` / `setConfig` / `resetLocal` 四个 RPC。
- **Browser 半**（页面内闭包）：
  - 注册 `shell.overlay`（根级浮层，全局可见）与 `conversation.composer.dock`（对话栏）两个槽位，
    按位置设置只渲染其一；
  - 每 2 秒 `host.call('snapshot')` 轮询；`userToken`/API Key 存于本机 `localStorage` 并推给 host，
    host 从不把密钥回传页面（`getConfig` 只返回布尔事实）；
  - 悬浮胶囊容器 `onMouseEnter`/`onMouseLeave` 自动展开/收起完整卡片（移动到卡片不闪烁）。

## 测试

```bash
node test/host.test.mjs      # Host 半：解析聚合、余额、失败路径、RPC 边界
node test/client.smoke.mjs   # Client 半：槽位注册、悬停展开/收起、位置切换、持久化
```

## 安装

见 [install/INSTALL.md](install/INSTALL.md) —— 运行时安装到当前 DSH：
`cordis_define`（参数见 `install/define-payload.json`）→ `cordis_run` → 页面批准 → 完成。

## 注意

- 平台用量接口为控制台私有接口，可能变更；接口失败时面板显示错误但不会影响 DSH。
- 费用估算（DSH 实时）按 DeepSeek 公开列表价，仅供参考；平台金额以平台接口为准。
- `platform.deepseek.com` 的 `userToken` 会随登录态过期，过期后需重新获取。
