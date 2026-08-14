# 安装到当前 DSH（实时显示）

本插件是一个 **双半（host + browser）动态 Cordis 插件**，通过 DSH 自带的
`cordis_define` + `cordis_run` 工具在**运行时**安装到当前 DSH 实例，无需重启、
无需修改任何配置文件。

安装后显示一个 **DeepSeek 小鲸鱼悬浮窗**：鼠标**按住鲸鱼可拖到任意位置**（位置自动记住），
**悬停自动展开**完整用量信息；也可在面板内切换为**输入框下方**（对话栏）模式。

---

## 一、准备 platform Token（可选，但推荐）

平台用量与消费金额来自 DeepSeek 开放平台控制台的私有接口，需要你登录平台后
浏览器里保存的 `userToken`（不是 `sk-...` API Key）：

1. 用浏览器打开 https://platform.deepseek.com 并登录。
2. 按 `F12` → **Application / 应用** → **Local Storage** → `https://platform.deepseek.com`。
3. 找到 `userToken`，复制它的 **value**（一长串，形如 `eyJhbGci...`）。

> 余额接口是官方公开接口：`GET https://api.deepseek.com/user/balance`，插件会自动
> 使用 DSH 已配置的 `DEEPSEEK_API_KEY`（凭据），无需手动输入。只有当你不用 DSH
> 的凭据时才需要在面板里另填 API Key。

---

## 二、定义并运行插件

> 前置条件：`cordis_define` / `cordis_run` 工具只在 **「创造模式」（cordis）agent preset**
> 中启用（标准模式没有这些工具）。请先在 DSH 页面新建一个会话，把它的 agent 预设切换为
> **创造模式**（General 设置里有 Agent 预设选择；新建会话时也会应用默认预设）。

### 方式 A（推荐）：让 DSH 的 agent 执行

在「创造模式」会话中，对 DSH 的 agent 说（或直接发送）：

> 请读取文件 `D:\IntelliJ_IDEA_U\Projects\dsh-UsagePlugin\install\define-payload.json`，
> 用其中的内容作为 `cordis_define` 的参数定义一个插件（code.host / code.client 取该文件里的字符串），
> 然后用返回的 pluginId / packageId 执行 `cordis_run`（mode: "run"）。

DSH 会依次调用 `cordis_define` → `cordis_run`。

### 方式 B：手动调用工具

1. 打开 `install/define-payload.json`，把 `plugin` / `name` / `purpose` / `code` 四个字段
   完整填入一次 `cordis_define` 调用（code.host 填 `plugin/host.js` 的内容，
   code.client 填 `plugin/client.js` 的内容）。
2. `cordis_define` 返回 `pluginId` 与 `packageId`。
3. 调用 `cordis_run`，参数：

   ```json
   { "pluginId": "<返回的 pluginId>", "packageId": "<返回的 packageId>", "mode": "run" }
   ```

### 批准运行

`cordis_run` 涉及浏览器侧 UI，会在 DSH 页面弹出**运行确认**，点击“允许/运行”即可。
随后出现 **DeepSeek 小鲸鱼悬浮窗**（默认在右下角附近）。

> 失败排查：若运行失败，让 DSH agent 用 `cordis_inspect_self` 读取诊断并修正后
> 重新 `cordis_define`（同一 pluginId 追加新 package）再 `cordis_run`。

---

## 三、配置与使用

1. **拖动**：鼠标按住鲸鱼悬浮窗可把它拖到页面任意位置（位置自动记住）；拖动不会展开面板。
2. **查看**：鼠标移到鲸鱼悬浮窗上 → 自动展开完整面板；移开自动收起；点击也可手动展开/收起。
3. 面板内：
   - **平台**：当月请求次数、输入（缓存命中/未命中）、输出、缓存命中率、消费金额（¥/CNY，平台实际计费），
     以及**今日**数据与**按模型**明细表。
   - **账户余额**：自动使用 DSH 凭据（`DEEPSEEK_API_KEY`）查询。
   - **DSH 实时**：本会话从面板启用起的请求次数、输入/输出 Token、估算费用（USD，按 DeepSeek 列表价）。
   - **显示位置**：悬浮窗（可拖动）/ 输入框下方，切换即时生效并记住。
   - **配置**：粘贴 platform 的 `userToken`（可选 API Key）→ 保存并刷新。Token 只保存在
     本机浏览器 `localStorage` 与 DSH 内存中，不会写入对话。
4. 数据刷新：平台数据每 60 秒拉取一次，面板每 2 秒刷新展示；DSH 实时用量即时累计。

---

## 四、卸载与重启后的恢复

- 卸载：在「创造模式」会话让 DSH agent 执行 `cordis_stop` / `cordis_undefine`
  （具体工具名以 `cordis_inspect_list` 为准）即可停止并移除插件；浏览器里的
  `localStorage["dsh-usage.config"]` 可手动清除。
- 重启后：动态插件跑在内存里，DSH 重启后可能不会自动恢复。重启后进入「创造模式」
  会话，用 `cordis_inspect_self` 查看定义是否保留：保留则直接 `cordis_run`
  （mode: "run"）重新激活；未保留则按第二步重新 define + run。Token/位置等配置
  存在浏览器 localStorage 中，无需重新输入。

---

## 五、已知边界

- 平台用量接口（`/api/v0/usage/amount|cost`）是控制台私有接口，可能随时变动；
  若接口变动，面板会显示错误信息（不会崩溃），届时可按新接口格式更新 `plugin/host.js`。
- 平台 `userToken` 会过期（平台登出后失效），失效后重新登录平台并更新 Token 即可。
- “DSH 实时”按 DeepSeek 公开列表价估算费用（USD），与平台实际账单可能有差异；
  平台费用以平台接口返回的金额（¥）为准。
