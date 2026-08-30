# DSH v0.1.2-alpha.1 对 dsh-service 的影响评估

> 调研日期：2026-08-28
> 目标版本：`dsh-v0.1.2-alpha.1`（prerelease，commit `cd5ef8148158c3a752a658978873241fdf8e2bbc`）
> 对比基线：`dsh-v0.1.1-rc.2`（GitHub compare API 的基线 commit `b150a551`）
> 范围：只读官方 release/source 与当前插件源码；本次不修改功能代码，也未在本机安装目标 DSH 版本。
>
> 证据级别：标为“已确认”的内容直接来自 alpha.1 官方 release、tag source、package manifest 或 commit diff；“工程影响”和“待验证”是基于这些事实对本插件的推断，不代表官方作出的兼容承诺。

## 结论摘要

**当前没有证据表明必须立刻修改插件功能代码。** `dsh-service` 的 Client 通过官方 `ctx.connection.rpc.call('/dsh-service', endpoint, payload)` 使用通用 Connection 传输，Host 通过同一单层 channel 注册 RPC；这条调用形状仍被 alpha.1 的 Connection 客户端支持。现有 `rpcFailure()` 已返回 strict RPC 所需的 `{ok:false,error:{code,message,details}}` envelope，因而与新客户端的响应校验相容。

但 alpha.1 不是可无条件宣称兼容的普通 patch，建议把兼容性分成两层：

- **P0 / 必测：网络访问认证与下载链路。** alpha.1 给 Web 控制面增加了 launch URL 一次性 token、authority-bound HttpOnly cookie、Host/Origin/Fetch-Metadata 信任栅栏。插件的普通 RPC 大概率由 Connection 自动承载认证；插件自己的 session ZIP 下载则绕过 Connection，使用直接 `HEAD` 和 `<a href>` 请求，必须在升级后的真实 Web 进程中验证。
- **P1 / 建议观察：Connection generation/reconnect 时序。** 插件已经监听 `connection/reset`，并在重连后重建通知基线；这与新 generation 在 ready 后才发布的语义方向一致，但需要验证首次连接、认证失败、断线重连和页面恢复时没有额外误报或轮询风暴。
- **P2 / 低风险：官方 UI/能力重叠与视觉回归。** provider 登录配置、第三方语言、模型/子代理选择、会话 token 用量和折叠导航是官方新增能力。它们不直接改变插件 RPC/slot 合约，但可能改变设置页可用空间、会话 DOM 几何、模型配置的职责边界。

建议先做 alpha.1 集成验收，再决定是否把 README 的兼容性下限从 `>=0.1.1-rc.2` 改为经过实际验证的版本；不要只凭 release notes 提前抬高版本要求。

## 1. 官方版本与变更证据

官方 release 明确列出以下与插件相关的变更：

- 网络访问 Web 界面要求 launch URL 中的一次性 token。
- 旧版 ApiProxy 调用接口完成迁移并移除，统一使用 `@Remote` 网关。
- 网关发送 WebSocket heartbeat，改善空闲连接保持。
- 官方模型设置页支持 provider 登录配置；支持第三方 UI 语言；子代理可以选择 provider/model/reasoning effort/max output；会话流新增精确 token 用量、折叠过程内容和紧凑回合导航。
- 官方 DeepSeek adapter 默认携带已启用插件包名与版本，并增加默认关闭的 Session 日志增量上传。

来源：

- [官方 alpha.1 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)
- [官方 rc.2 → alpha.1 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.2-alpha.1)

### 1.1 “ApiProxy 移除”不是当前插件的直接破坏性变更

当前插件没有直接依赖 ApiProxy。Host 端使用：

```js
ctx.connection.rpc.handle('/dsh-service', async (endpoint, payload) => { ... })
```

Client 端使用：

```js
ctx.connection.rpc.call('/dsh-service', endpoint, payload)
```

`@deepseek-ai/dsh-api-gateway` 的 alpha.1 README 仍明确说明 generic unary Remote 最终通过 `ctx.connection.rpc.call(channel, endpoint, payload)` 发送，并要求 channel 为单层绝对路径；这与插件现有 `/dsh-service` 形状一致。插件没有使用 `ctx.api`、`ApiProxyService` 或旧的 API map。

来源：[alpha.1 `@deepseek-ai/dsh-api-gateway` README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/api/gateway/README.zh.md)

## 2. P0：Connection RPC 与浏览器认证

### 2.1 普通插件 RPC：预期由 Connection 透明承载

alpha.1 的 Connection client `createWebConnectionRpc()`：

- 仍接受单层 `/name` channel；
- 将 endpoint 放入 `${channel}/${endpoint}`；
- 发送 `POST` JSON `client-request`；
- 校验 `server-response`、rpcId 与 strict failure envelope；
- 使用页面 origin 作为请求基址。

因此 `client.js` 的 `/dsh-service` 与几十个 endpoint（`version`、`health`、`sessions-*`、`backup-*`、`models2-*` 等）不需要因为 channel 或 endpoint 语法变化而改写。

来源：[alpha.1 Connection RPC source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/connection/src/client/rpc.ts)

### 2.2 新增 browser-session authentication 的影响

alpha.1 的 browser-auth 实现规定：

1. `GET /?token=<launch-token>` 且 token 正确时，服务端签发按请求 authority 命名、签名且绑定 authority 的 HttpOnly/SameSite=Strict cookie，并重定向到干净的 `/`。
2. 后续 Host 请求必须携带有效、未过期且 authority 匹配的 cookie。
3. 缺少或错误认证返回 401；静态资源仍是公开资源，但 Host API/RPC 受保护。
4. cookie 不是由插件 Client 自己拼接；正常从 DSH 打印的 URL 打开页面即可由浏览器保存并随同源请求发送。

来源：[alpha.1 `browser-auth.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/connection/src/browser-auth.ts)

**对 `dsh-service` 的判断：**

- `rpcCall()` 不需要增加 token 参数，也不应把 launch token 复制进插件 RPC payload。认证属于 Connection/HTTP carrier 层。
- 使用 `ctx.connection.rpc.call()` 的 health、quota、usage、settings-like mutation、backup action、session action 都应共享官方认证。
- 旧页面若不是由带 token 的 launch URL 打开，RPC 失败可能从业务错误变成 transport HTTP 401；当前 wrapper 会把 transport 异常归一为 `{ok:false,error:<message>}`，UI 至少不会因异常未捕获而崩溃，但应在真实浏览器中确认错误文案与重连行为。

### 2.3 Host/Origin/Fetch-Metadata trust fence

alpha.1 对 `/api` 请求增加 Host/Origin/Fetch-Metadata 信任栅栏：Host 必须是 loopback 或配置的 trusted host；`Sec-Fetch-Site: cross-site` 被拒；携带 Origin 时必须与 Host authority 相同；这层与认证分开。

来源：[alpha.1 `api-request-trust.ts`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/connection/src/api-request-trust.ts)

当前插件有以下相关事实：

- RPC channel 是 `/dsh-service`，不是自定义 HTTP `/api` 路由。
- 插件注册的 `/healthz` 和 `/dsh-backup-download` 属于 `webServer.register()` 的顶层 exact route。
- `/healthz` 只返回空 200/405。
- `/dsh-backup-download` 返回一次性 opaque token 对应的备份内容。

官方 webserver 本身仍是普通路由注册表，不提供服务器级认证或来源策略；认证/来源策略由 Connection 等 route owner 负责。因此不能仅凭 webserver README 断言插件顶层路由自动获得 `/api` trust fence。

来源：[alpha.1 webserver README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/host/webserver/README.zh.md)

## 3. P0：session 导出是当前最值得实测的断点

`client.js` 的 session 导出流程不是全程 RPC：

1. 先调用 `rpcCall('sessions-export', { id })`；
2. Host 返回一次性 URL；
3. Client 对该 URL 做直接 `fetch(url, { method: 'HEAD' })`；
4. 再创建 `<a href=url download=...>` 触发 ZIP 下载。

当前实现位置：`client.js:5847-5867`。

这条链路的重要差异是：它不使用 `ctx.connection.rpc.call()`，也不显式设置任何认证 header。alpha.1 官方 API gateway README 说明标准 session export 属于 `/api` HTTP fetch handler；browser-auth source 则说明同源浏览器请求应依靠 cookie，而不是插件手工传 token。因此升级后有两种可能：

- **预期正常：** URL 在同一 DSH authority 下，浏览器自动发送 authority-bound cookie，HEAD 与 anchor 下载都通过。
- **需要修复：** 插件目前 Host 返回的 URL 若仍是旧的顶层 `/dsh-backup-download` 或某个未受官方认证路由保护的地址，可能出现 401/403、下载未携带 cookie、或新路由策略不允许该路径。

本仓库当前 Host 的 session export implementation 返回官方 session export URL（而备份 export 返回本插件自己的 `/dsh-backup-download?token=...`）。两类都应在 alpha.1 真实 Web 页面测试：

- session export：`HEAD` 状态、anchor 下载、包含子代理与附件；
- backup export：一次性 URL 首次 GET 成功、重复 GET 失败、过期 token 失败；
- 直接访问 `/healthz`：保持监控所需的 GET/HEAD 200、POST 405，确认是否被认证/信任策略影响。

**重要安全判断：** 不要为了绕过认证把 launch token、cookie 值或任意 auth header 从 Client 传给 Host 自定义 endpoint。若失败，应优先把下载整合到官方受保护的 fetch/Remote seam，或由 Connection/Host 提供受支持的下载能力，而不是复制认证协议。

## 4. P1：generation/reset 与插件现有初始化

alpha.1 Connection controller 的语义是：generation source 必须先挂好增量 listener，再调用 `ready(host)`；只有 ready 后才发布 generation 并触发 connected；首项不是 ready、stream error、异常结束都会结束当前 generation 并退避重连；重连时 generation 变为 undefined。

来源：[alpha.1 Connection generation source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/connection/src/client/connection.ts)

插件当前已经采用适配该语义的模式：

- 任务通知与 quota 后台轮询共同依赖 `ctx.sessions.list`；
- 首个快照只建立通知基线，不响铃；
- 监听 `connection/reset` 后清空 observed 状态并把 `baselined=false`；
- 下一次 sessions snapshot 到达后重新建立基线，避免重连导致“任务完成/需要输入”误报。

这说明 alpha.1 的 reset 方向与现有代码设计相容。仍需实测：

- 首次 `ready` 前插件是否过早读取 `ctx.sessions.list` 并发出额外 RPC；
- 401/403 是否触发预期 reset/reconnect，而不是无限快速重试；
- 重连期间 quota/session/health 定时器是否继续排队；
- reconnect 后 feature flag 与导航 slot 是否重复注册。

没有源码证据要求插件改为使用 `ctx.remote.$on()`：官方事件转发白名单仍不包含本插件自己的业务事件，而本插件当前设计明确使用自己的 loopback RPC 与 `ctx.sessions.list` 事实源。

来源：[alpha.1 API Remotes source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/api/remotes/src/index.ts)

## 5. P2：官方 UI 和插件职责重叠

### 5.1 模型设置与 provider 登录

alpha.1 官方 Models 设置页新增 provider sign-in controls，并完善第三方 provider/model 配置。插件自己的 quota credential forms 仍有不同目标：它们写入固定 provider quota 查询所需的凭据（例如控制台 Cookie、Oasis-Token、API key），不是通用模型配置 UI。

因此当前不建议删除 quota credential 流程。但要检查：

- 同一 provider 的 API key/登录配置是否让官方 credentials 状态变化，从而使插件 quota card 显示更准确或产生重复入口；
- `llm-pi-ai` 的模型配置页面是否覆盖插件“自定义模型”入口，是否应在后续版本中改为链接/互补，而不是重复编辑器；
- DeepSeek 官方 provider 现在是独立模型配置路径，不能假设它等同于插件的 `llm-pi-ai` 自定义路由。

来源：[alpha.1 Models settings README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/ui-settings-models/README.zh.md)

### 5.2 Slot、模块加载与 runtime 拆分

alpha.1 的官方 slot README 仍把 `ctx.slots.inject` 作为生命周期归属的注册入口。逐项对照官方合约，插件当前实际使用的 `settings.section`、`settings.plugin.item`、`sidebar.footer.action`、`shell.overlay`、`conversation.input.left` 与 `conversation.input.right` 仍存在；因此没有确认需要改名或迁移的 slot。alpha.1 还新增 Models 页的 `settings.models.provider-card`（按 `settingsNs` keyed）与 `settings.models.footer`（list），这是可选的新扩展能力，不是现有 slot 的替代。

alpha.1 Web static module seed 新增显式 `@deepseek-ai/dsh-client-store`，并继续包含插件现用的 `react`、`react-dom`、`@deepseek-ai/cordis` 与 `@deepseek-ai/dsh-client-ui-primitives`。插件没有直接 `require('@deepseek-ai/dsh-client-store')`，所以 seed 增量本身不是必改项。

但依赖图有一个**必须优先核实的高风险差异**：compare diff 显示 alpha.1 删除 `packages/client/runtime/package.json`，官方 web-app composition 不再挂载 `@deepseek-ai/dsh-client-runtime`；其职责已拆入 `@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-client-ui-renderer` 等包。当前插件 `package.json` 仍把 `@deepseek-ai/dsh-client-runtime` 写入 `dsh.client.inject`。这不是“已确认运行失败”（尚未安装 alpha.1 实测），但在新 composition 中可能导致依赖解析或注入等待失败；应在升级前从 alpha.1 profile 的 clean install 启动验证，并根据实际模块需求移除旧 inject 或改为新包，不能仅凭名称相似直接替换。

官方模块系统还要求客户端 bundle 预先产出 `lib/client.js`，`dsh.client.external` 必须有精确 supplier；缺失 bundle、missing supplier、自请求、循环等会在组合/激活阶段明确失败。当前插件无 `external`，且仓库是直接发布已纳入 `files` 的 `client.js`，所以要重点检查的是新 DSH 下该文件的加载、inject 图和 package peer/dependency，而不是增加 external。

来源：

- [alpha.1 ui-settings Slot contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/ui-settings/src/client/contract/slots.ts)
- [alpha.1 ui-conversation Slot contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/ui-conversation/src/client/contract/slots.ts)
- [alpha.1 ui-layout Slot contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/ui-layout/src/client/index.ts)
- [alpha.1 Models extension Slot contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/ui-settings-models/src/client/slot-contract.ts)
- [alpha.1 client modules README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/modules/README.zh.md)
- [alpha.1 client module manifest source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/client/modules/src/client/manifest.ts)
- [alpha.1 web-app composition](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.1/packages/bundle/web-app/cordis.patch.yml)
- [rc.2 → alpha.1 runtime deletion diff](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.2-alpha.1#files_bucket)

### 5.3 会话 UI 几何与 token 用量

官方新增会话折叠过程、精确 token usage、紧凑回合导航，并大幅拆分 conversation UI。插件有两类潜在影响：

- 插件 quota ring 挂在 `conversation.input.right`，依赖移动端 portal 与 composer 几何；官方会话输入区改动可能导致 portal 锚点、遮罩层、外点关闭或窄屏定位回归。
- 插件自己的 usage index 读取 Host `sessionPersistence` 的事件，不依赖官方 UI token usage 组件；官方新增显示不应改变插件索引口径，但应检查日志压缩/增量事件变化是否让 `request/header`、`token/meter`、`assistant/message` 关联仍成立。

这部分目前是回归风险，不是已确认破坏。建议在真实 alpha.1 UI 做桌面、窄屏、语言切换和长会话检查，并运行既有 `npm test`。

## 6. Host-side compatibility checklist

### 已确认相容

- `index.js` 的硬依赖仍只有 `connection`；其余服务通过 `ctx.get()` 作为 optional services 获取。
- `ctx.connection.rpc.handle('/dsh-service', ...)` 仍符合单层 channel 规范。
- `rpcFailure()` 已输出 strict structured error envelope。
- `/healthz` 与 backup route 使用 official `webServer.register()`，并由 `ctx.effect()` 管理 disposer。
- 插件未依赖 ApiProxy、旧 API map 或未列入 allowlist 的 Remote event。

### 需要特别注意的依赖事实

- alpha.1 的官方 Connection package 已移除对旧 `@deepseek-ai/dsh-host-apiproxy`/`ws` 的 Connection 内部依赖，并由 Connection 自持 RPC contract；当前插件没有直接导入这些旧符号，因此没有直接 ApiProxy 迁移项。
- 相反，当前插件仍在 `package.json` 的 client inject 声明中写有 `@deepseek-ai/dsh-client-runtime`，而 alpha.1 官方 web composition 不再挂载该包。是否因此导致插件加载失败必须用 alpha.1 clean profile 验证；这是本次影响评估的首要依赖风险。
- 若实测需要迁移，优先按 alpha.1 的职责拆分选择 `dsh-api-session-controller`、`dsh-client-ui-session`、`dsh-client-ui-renderer` 等真实服务，并以其 package manifest 的 `dsh.client.inject`/peerDependencies 为准；不要把旧包名机械替换为某个“runtime”相似名称。

### 需要在 alpha.1 验证

1. `/dsh-service` 每类代表 endpoint：`version`、`health`、`sessions-list`、`backup-export`、`models2-snapshot`。
2. 认证流程：从 DSH 打印的 token URL 打开；刷新；新标签页；过期/错误 token；错误 authority/Host。
3. session export 与 backup export 的 HEAD/GET/anchor 下载。
4. `healthz` 在默认 loopback 和配置网络 host 下的状态、空 body 与监控可用性。
5. 断线重连：Connection reset、通知基线、quota 轮询和恢复 overlay。
6. 备份/会话操作的 strict error：unknown id、失效 plan、feature disabled、transport 401/403。
7. `npm test` 全量通过。

## 7. Client-side compatibility checklist

1. Client plugin factory 能在 alpha.1 module loader 中求值；`react-dom` 和 ui primitives 仍返回同源实例。
2. `dsh-client-runtime` 旧 inject 不会令插件 fiber 停留在 waiting/failed；如失败，确认所需能力是否已由 alpha.1 的 session-controller/ui-session/ui-renderer 提供，再调整 inject。
3. 每个现有 slot 只注册一次，卸载/reload 后 disposer 能清干净。
4. `ctx.sessions.list` 首次快照、reset 后快照、重连期间快照的边沿通知没有误报。
5. alpha.1 官方 Models/settings 页面同时存在时，插件设置导航仍可见，窄屏不溢出。
6. quota ring 的 composer portal 在官方新会话布局、移动视口、窗口旋转和外点关闭下正常。
7. session export 的直接 `fetch` 与 `<a>` 下载携带同源 cookie；backup export 一次性 token 行为保持不变。
8. 官方语言切换后插件 zh/en 文案仍同步，第三方语言下有合理回退。

## 8. 建议的后续顺序

### 第一阶段：只做验证，不改代码

- 在隔离 DSH_HOME 安装 alpha.1，挂载当前插件源码或 tarball；先确认官方 web composition 不再提供 `dsh-client-runtime` 时，插件的旧 inject 是否会被拒绝或一直等待。
- 从官方打印的带 token URL 进入 Web；逐项执行第 6、7 节 checklist。
- 保持当前本机安装版本不变，避免把未验证 prerelease 当成最低兼容版本。

### 第二阶段：若实测失败，按失败类型修复

- **RPC 401/403：** 先确认页面确实通过 token URL 打开、Host/Origin authority 一致；不要在插件 payload 中复制认证信息。
- **session/backup download 失败：** 记录实际 URL、状态与响应路径；优先采用官方认证 fetch/Remote seam，不实现第二套 cookie/token 协议。
- **generation 误报或轮询风暴：** 以 `connection/reset` 为唯一重连边沿，确保 timer/subscribe 由当前 Fiber 管理，并对初始 snapshot 保持基线语义。
- **slot/视觉回归：** 只按 alpha.1 实际 slot contract 和稳定 data 属性调整；不要依赖新 CSS module hash。
- **模型配置重复：** 保留 quota 专用 credential/query 流程，必要时减少与官方 Models 页重复的自定义模型入口，不在本次兼容性调查中贸然删除功能。

## 9. 当前决策

截至本调研：

- **不修改 `index.js`、`client.js`、`cordis.patch.yml` 或 `package.json`。**
- **不改变 README 兼容性 badge。** 当前 badge 是 `DSH >=0.1.1-rc.2`，在 alpha.1 真实安装验证前保持原样。
- **唯一新增输出是本研究文档。**
- 目标版本为 prerelease，且本机当前仍安装 `@deepseek-ai/dsh@0.1.1-rc.2`；因此本记录中的认证、下载与 UI 项目明确标为“需运行时验证”，不把推测写成已修复或已兼容事实。
