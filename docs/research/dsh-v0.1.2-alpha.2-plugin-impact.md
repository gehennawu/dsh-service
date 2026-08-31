# DSH `0.1.2-alpha.2` 对 `dsh-service` 的独立兼容性研究

> 调研对象：宿主本机 `@deepseek-ai/dsh@0.1.1-rc.2` 与官方 npm `@deepseek-ai/dsh@0.1.2-alpha.2`。
>
> 调研范围：官方 GitHub release/tag/compare、官方仓库源码/raw、npm package metadata，以及本仓库 `index.js`、`src/client.js`、`package.json`、`cordis.patch.yml`。
>
> 调研结论不是对未执行的 alpha.2 实机启动测试的替代；“已确认”指源码/manifest/release 直接证据，“推断/待测”指对本插件的工程影响。

## 结论摘要

**已确认存在一个会阻断当前 Client 挂载的高风险兼容性问题。** 本插件 `package.json` 的 `dsh.client.inject` 仍声明 `@deepseek-ai/dsh-client-runtime`；而 alpha.2 官方 `dsh-web-app` 的浏览器 roster 已移除该包，且 npm registry 没有发布 `@deepseek-ai/dsh-client-runtime@0.1.2-alpha.2`。因此在 alpha.2 下，当前 Client 很可能因等待不存在的 inject supplier 而停留在 waiting/无法挂载。**升级前应先移除该 inject，并对新的 alpha.2 composition 做完整回归验证**（本次按要求只更新研究文档，没有改代码）。

除上述阻断点外，本插件没有导入或调用已移除的旧 ApiProxy API；Host/Client 均使用通用 `Connection.rpc`，RPC channel `/dsh-service` 符合官方单层绝对路径约束。alpha.2 release 还明确新增统一 `RemoteError` 封装，但它主要影响 Remote 网关调用方；本插件的自有 unary RPC 已在 Host 端返回结构化 failure envelope，并由 Client wrapper 归一化错误。

不过不能把它当作无风险 patch：

* **P0 阻断：先移除 `@deepseek-ai/dsh-client-runtime` inject。** 这是基于 alpha.2 官方 web roster 与 npm registry 的明确证据作出的高概率判断，移除后仍须 clean-profile 实机验证 Client 是否 active，以及 `connection`、`locale`、`sessions`、slots、React seed 等实际依赖是否由新组合提供。
* **P0：RemoteError/strict RPC 错误路径。** alpha.2 的 generic RPC client 仍要求 `{ok:false,error:{code,message,details}}`；裸字符串不能作为 server response。当前 Host 的 `rpcFailure()` 已符合这一要求，但 transport failure 仍需在浏览器中确认 UI 文案。
* **P0：RemoteError/strict RPC 错误路径。** alpha.2 的 generic RPC client 仍要求 `{ok:false,error:{code,message,details}}`；裸字符串不能作为 server response。当前 Host 的 `rpcFailure()` 已符合这一要求，但 transport failure 仍需在浏览器中确认 UI 文案。
* **P1：连接异常、自动重试和重连。** alpha.2 release 新增连接异常展示、自动重试和立即重连。插件监听 `connection/reset` 并重建通知基线，方向相容，但需验证轮询、首次快照和 reset 时序。
* **P1：session/persistence/query 与官方会话 UI 的变更。** 本插件大量依赖可选 Host services；API 名称和返回形状需按 alpha.2 manifests/source 复核，尤其是 `sessionPersistence.locate/readRaw/listSnapshots`、`sessionQuery.listSessions/readSession/filterEvents/readTitleSnapshots`。
* **P2：slots/settings.section 与布局回归。** alpha.2 release 主要改进会话/输入界面、长历史和 token 展示；没有证据表明现有 `settings.section` 被移除，但设置导航、composer 锚点、窄屏 portal 需回归。

## 结论状态定义

本文后续每个主题统一使用三种状态，避免把“源码未发现变化”和“已完成运行时验证”混为一谈：

* **已确认**：直接由本地插件源码、alpha.2 官方 release/tag/raw、官方 npm metadata/manifest 或 compare API 得到；或明确确认本插件没有该依赖。
* **未确认**：官方材料显示可能相关，但本次没有安装 alpha.2、没有 clean profile 启动或没有执行浏览器/端到端测试，因此不能宣称兼容。
* **无影响**：经调用面核对，该主题不是本插件的直接依赖，或已有兼容性隔离/可选降级；这不等于整个升级已通过。

## 总体状态表

| 主题 | 状态 | 结论 |
|---|---|---|
| APIProxy 移除 | **无影响**（直接调用面） | `index.js`/`src/client.js` 没有 ApiProxy、`ctx.api`、旧 API map 或 `dsh-host-apiproxy` 导入；使用 generic Connection RPC。 |
| RemoteError | **已确认**（release 变化）/ **未确认**（本插件运行结果） | alpha.2 release 明确新增统一封装；本插件业务 RPC 不走 Remote gateway，现有 failure envelope 已是结构化 JSON，但真实 Remote/transport 错误展示仍需测试。 |
| Connection/RPC | **已确认**（接口形状）/ **未确认**（重连） | alpha.2 client RPC 仍接受 `/dsh-service` 及合法 endpoint；连接异常自动重试/立即重连的交互与插件 reset 基线尚未实测。 |
| slots / `settings.section` | **已确认**（现有调用契约未见删除）/ **未确认**（视觉/布局） | 插件仍按 `ctx.slots.inject` 注册；alpha.2 UI 改动可能造成导航、composer、portal 几何回归。 |
| session / persistence / query | **已确认**（插件调用及 optional 降级）/ **未确认**（alpha.2 返回形状） | 调用均来自 `ctx.get()` 且做能力检查；`SessionRecord`、raw artifact、事件文档形状及长历史时序需 clean profile 核对。 |
| webServer | **已确认**（插件注册方式）/ **未确认**（认证策略） | `/healthz`、备份下载是自定义路由，不应假定自动继承 Connection/RPC 认证；GET/HEAD/下载必须实测。 |
| subprocess | **无影响**（release 未声明 breaking change）/ **未确认**（实际 service contract） | 使用固定命令白名单；需验证 `resolveExecutable`、`spawn`、`done`、stderr 与 teardown。 |
| workspace | **已确认**（调用点）/ **未确认**（alpha.2 归档行为） | 使用 `list`、`archivedSessionIds`、`archiveSession`；归档持久化/幂等/unknown id 仍需运行验证。 |
| agents / jobs / terminals | **已确认**（调用点和可选降级）/ **未确认**（活动状态时序） | 用于健康与重启 guard；需验证活动任务存在时仍阻止重启/升级。 |
| npm manifest / tarball | **已确认**（版本与官方 manifest 入口）/ **未确认**（下载包逐项差异） | 已确认本机版本和 alpha.2 目标版本；尚未把两版 npm tarball 解包后逐项 diff，不能声称文件/依赖完全一致。 |
| `index.js` / `src/client.js` 实际调用 | **已确认** | 本文第 2、8 节逐项列出调用；没有代码修改。 |

## 1. 版本、npm metadata 与官方比较证据

### 1.1 本机宿主

本机读取 `/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json`：

* name：`@deepseek-ai/dsh`
* version：`0.1.1-rc.2`
* repository：`deepseek-ai/deepseek-harness`
* directory：`apps/cli`
* 运行时依赖包含 `@deepseek-ai/dsh-web-app@^0.1.1-rc.2` 及一组 host/client/session/terminal/job 包。

### 1.2 npm 目标包

官方 npm registry metadata 入口：

* [npm registry metadata：`@deepseek-ai/dsh`](https://registry.npmjs.org/@deepseek-ai%2Fdsh)
* [npm package 页面](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.2-alpha.2)

目标版本为 `0.1.2-alpha.2` prerelease。官方 GitHub release API 返回该 tag 的 release 为非 draft、非稳定版 prerelease，发布时间为 2026-08-30；release 的目标 tag 为 `dsh-v0.1.2-alpha.2`。

### 1.3 官方 release/tag/compare

* [alpha.2 release notes](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2)
* [rc.2 → alpha.2 官方 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.2-alpha.2)
* [compare API（对应 base/head commit）](https://api.github.com/repos/deepseek-ai/deepseek-harness/compare/b150a551...0a53fb5)
* [alpha.2 根 package.json raw](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/package.json)

alpha.2 release 明确列出：连接异常状态、自动重试/立即重连；会话标题的活动定时计划；会话/输入菜单、滚动条、文件链接、diff 统计改进；长会话与高密度实时消息性能改进；回答末尾 token 用量与耗时；Node.js 24.0–24.11.1 启动/HMR 修复；恢复 `SessionEvent.ignorable`；以及“Remote 网关提供统一的 RemoteError 调用异常封装”。

官方 compare API 显示从 rc.2 基线 commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 到 alpha.2 head `0a53fb5`；网页 compare 在此次抓取中提示比较规模过大，因此变更判断同时以 release、tag raw 源码和 API diff 入口为证据，不把网页未渲染部分误当作“无变更”。

## 2. 本插件实际调用面

### 2.1 Host `index.js`

本地源码关键事实：

* `const inject = ['connection']`；其他服务均通过 `ctx.get()` 可选获取。
* 注册 RPC：`ctx.connection.rpc.handle('/dsh-service', dispatchRpc, { authority: 'loopback' })`（本地 `index.js` 约第 5065 行）。
* `subprocess`：解析 `tar`、执行受控命令，使用 `resolveExecutable()`、`spawn()`、`handle.done`。
* `sessionPersistence`：备份场景使用 `supportsRawArtifacts`、`listSnapshots()`、`locate()`、`readRaw()`；会话删除/文件定位使用 `locate()`。
* `sessionQuery`：使用 `listSessions()`、`readSession()`、`readTitleSnapshots()`、`filterEvents()`；服务缺席时多数功能降级为 unavailable。
* `workspaceRegistry`：使用 `list()`、`archivedSessionIds`、`archiveSession(id)`。
* `agents`、`jobs`、`terminals`：用于健康/重启安全检查，统计活动工作并阻止破坏性操作。
* `webServer`：注册 `/healthz` 与备份下载等顶层 exact route；注册 disposer 归属当前 fiber。
* 没有 `ctx.api`、`ApiProxyService`、旧 API map 或直接导入 `dsh-host-apiproxy`。

### 2.2 Client `src/client.js`

本地源码关键事实：

* `window.__ModuleLoader__.load({ id, factory })` 工厂形式，无 TypeScript/JSX。
* RPC wrapper 调用 `ctx.connection.rpc.call('/dsh-service', endpoint, payload)`。
* 使用 `ctx.locale.register/bind/getSnapshot/subscribe`。
* 使用 `ctx.sessions.list.getSnapshot/subscribe` 作为活跃会话事实源。
* 使用 `ctx.slots.inject('settings.section', ...)` 注册设置导航/面板；还使用会话输入相关 slot，并对 `settings.section` 做注销/重注册控制可见性。
* portal 场景通过 `require('react-dom')` 获取官方共享实例。
* session export 等流程在拿到宿主返回 URL 后，存在直接 `fetch(HEAD)` 与 anchor 下载路径，不能假定它和 RPC 享有完全相同的 carrier 行为。

本仓库 `package.json` 的 client inject 当前为：

```json
[
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-api-remotes"
]
```

`cordis.patch.yml` 只插入一个宿主插件行，没有自行声明旧 ApiProxy。

### 2.3 已确认的 Client inject 阻断点

当前仓库 `package.json` 的 `dsh.client.inject` 明确包含 `@deepseek-ai/dsh-client-runtime`。对 alpha.2 的进一步核查确认：

1. alpha.2 官方 `dsh-web-app` 的浏览器 roster 已不再包含 `@deepseek-ai/dsh-client-runtime`；
2. npm registry 的 alpha.2 版本元数据/包名查询没有 `@deepseek-ai/dsh-client-runtime@0.1.2-alpha.2` 这一发布物；
3. 因而当前插件在 alpha.2 组合中很可能找不到该 inject supplier，并在 Client 激活阶段等待或无法挂载，而不是“仅某项功能降级”。

这是本次升级的**明确阻断点/高概率失败点**。处理顺序应为：先从插件的 `dsh.client.inject` 移除该旧 runtime 声明，再依据 alpha.2 实际 roster 与各模块 manifest 核对是否需要补充新的、真实存在的 supplier；不能机械地把旧包名替换成名称相似的新包。完成后必须在隔离 profile 中确认 Client fiber 进入 active，且 `connection`、`locale`、`sessions`、slots、React seed 与本插件实际调用均可用。

证据：

* [alpha.2 dsh-web-app 浏览器 roster（官方 raw cordis.patch.yml）](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/bundle/web-app/cordis.patch.yml)
* [alpha.2 dsh-web-app 目录（官方 tag）](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages/bundle/web-app)
* [npm registry：`@deepseek-ai/dsh-client-runtime`](https://registry.npmjs.org/@deepseek-ai%2fdsh-client-runtime)
* [npm registry：`@deepseek-ai/dsh@0.1.2-alpha.2`](https://registry.npmjs.org/@deepseek-ai%2fdsh/0.1.2-alpha.2)
* [本仓库 `package.json`](../../package.json)，其中 `dsh.client.inject` 仍列出该包。

## 3. APIProxy 移除与 RemoteError

### 3.1 ApiProxy 移除的直接影响

alpha.2 的前序迁移及 release 线索涉及旧 ApiProxy/Remote 网关架构，但当前插件没有依赖旧对象：

* Host 不是调用 `ApiProxy`，而是 `connection.rpc.handle`。
* Client 不是调用 `ctx.api` 或旧 API map，而是 `connection.rpc.call`。
* channel 是 `/dsh-service`，没有嵌套 slash；业务 endpoint（如 version、health、sessions、backup、models）作为第二参数传输。
* authority 固定为 `loopback`，符合本仓库安全约定。

因此“ApiProxy 移除”对本插件是**间接兼容性检查项，不是已确认的源码迁移项**。

官方 alpha.2 RPC client raw：

* [packages/client/connection/src/client/rpc.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/client/connection/src/client/rpc.ts)

该实现仍使用单层 channel 正则 `^/[A-Za-z0-9._~-]+$`，endpoint 各段禁止空段、`.`、`..`，通过同源 `POST` 发送 `client-request`，并验证 `server-response`、rpcId 与 result envelope。`/dsh-service` 满足约束。

### 3.2 RemoteError

alpha.2 release 明确说 Remote 网关统一封装 `RemoteError`。这意味着使用 `ctx.remote`/Remote gateway 的插件不应再依赖裸 transport error 或各包自定义错误形状；应按 alpha.2 gateway contract 捕获/展示统一错误。

本插件的业务调用不是 Remote gateway：自有 `/dsh-service` 使用 generic unary Connection RPC。当前 Host：

```js
function rpcFailure(error) {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}
```

并通过 `strictRpcResult()` 把异常和旧式错误归一化；Client wrapper 再把结构化 error 还原为既有字符串语义。因此 alpha.2 的结构化 RPC 校验与当前实现相容。

风险点：如果未来把某些 endpoint 改成 Remote 调用，不要把 `RemoteError` 实例、Error 对象或 live Cordis 对象跨 JSON 边界；只传 lossless JSON 的 code/message/details。现有 `api-remotes` 仅负责官方白名单事件转发，本插件并未依靠它接收自己的业务事件。

官方 alpha.2 Remote source：

* [packages/api/remotes/src/index.ts](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/api/remotes/src/index.ts)

该文件显示 `api-remotes` 注册到 `typertGateway`，对 allowlist event 做 JSON 参数断言；它不是业务 RPC service，也不证明任意插件事件会自动转发。

## 4. Connection/RPC、连接异常与重连

官方 alpha.2 新增 UI 连接失败状态、自动重试和立即重连。这是相对 rc.2 的用户可见变化，可能改变页面在 transport failure 期间的 mounted/unmounted 时序，但不改变本插件 channel 语法。

当前插件已有相容设计：

* Host handler 生命周期属于 connection fiber。
* Client 初始 `ctx.sessions.list` 快照只建立通知基线，不响铃。
* 监听 `connection/reset` 后清除 observed 状态并重新等待基线，避免重连造成“任务完成/需要输入”误报。
* quota/health/session 请求均通过自有 RPC wrapper，失败归一化，不把 transport exception 直接抛入渲染树。

待测项目：

1. 首次 Connection 尚未 ready 时插件 factory/slot 是否过早启动 RPC。
2. alpha.2 的立即重连按钮是否会触发一次或多次 `reset`，插件是否重复注册 slot/监听器。
3. 401/403/网络断开时定时器是否快速重试形成风暴。
4. Connection 恢复后 `ctx.sessions.list` 的首次 snapshot 是否能重新建立基线。
5. RPC response 中的 `error.details` 是否仍为普通 object；禁止恢复成裸字符串。

## 5. slots、`settings.section` 与模块注入

### 5.1 `settings.section`

本插件直接注册：

```js
ctx.slots.inject('settings.section', () => ({
  name: 'settings.section',
  id: 'dsh-service',
  order: 99,
  label: () => t('nav.label'),
}))
```

并按 feature/localStorage 状态注册或注销其他入口。当前没有证据表明 alpha.2 移除了 `settings.section`；alpha.2 主要是设置/会话体验和焦点行为修复，而官方 settings slot 合约仍是通用第三方扩展路径。

官方可参考的 alpha.2 源码入口：

* [client UI settings 源码目录](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages/client/ui-settings)
* [官方 raw slot contract（若文件随版本调整，以 tag 目录为准）](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/client/ui-settings/src/client/contract/slots.ts)

风险不是 API 删除，而是布局变化：官方新增/调整设置内容可能改变导航高度、滚动祖先和小屏宽度。应验证第三方条目的 label、order、卸载 disposer 和页面内滚动。

### 5.2 module loader / inject

alpha.2 根 manifest 的 Node engines 为 `^22.19.0 || >=24.0.0`，且 release 特别修复 Node 24.0–24.11.1 启动与 HMR。这对宿主进程有利，但不等于插件 inject 图不变。

**本项现已从“待确认风险”升级为明确阻断点：** alpha.2 官方 `dsh-web-app` cordis.patch.yml 的浏览器 roster 已移除 `@deepseek-ai/dsh-client-runtime`，同时 npm registry 没有 `@deepseek-ai/dsh-client-runtime@0.1.2-alpha.2`。当前插件仍在 `dsh.client.inject` 声明该包，因此当前 Client 很可能因找不到 supplier 而停留在 waiting/无法挂载。应先移除该 inject，再回归验证；本次不在研究阶段直接改代码。

移除后仍需确认：

* 新 session/controller/UI 包是否提供本插件实际使用的 Client services；
* `ctx.sessions`、`ctx.locale`、slots、React seed 是否仍由 alpha.2 组合提供；
* 插件 fiber 是否 active，而不是 waiting 或 composition error。

不能仅凭包名相似机械替换 inject。应以 alpha.2 的 composition 与各包 manifest 的 `dsh.client.inject`/peerDependencies 为准。

证据：

* [alpha.2 dsh-web-app 浏览器 roster（官方 raw cordis.patch.yml）](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/bundle/web-app/cordis.patch.yml)
* [npm registry：`@deepseek-ai/dsh-client-runtime`](https://registry.npmjs.org/@deepseek-ai%2fdsh-client-runtime)
* [本仓库 `package.json`](../../package.json)

## 6. session / persistence / query

### 6.1 sessionQuery

本插件使用 `sessionQuery`：

* `listSessions()`：列表、归档过滤、健康统计；
* `readSession(id)`：详情事件快照；
* `readTitleSnapshots(ids)`：补标题；
* `filterEvents(id, filters)`：内容检索。

所有读取都经 `ctx.get('sessionQuery')` 并做 method existence 检查；缺席时返回 unavailable 或空状态。因此即使 alpha.2 composition 暂时不提供某个 query service，主要失败模式是功能降级而非整个插件无法激活。

但如果 alpha.2 改了 `SessionRecord`/`SessionLogSnapshot` 字段或事件种类，需要检查：

* `header.id`、`header.cwd`、`header.parentSession` 是否仍存在；
* 标题批量接口是否仍返回按 id 可关联的 snapshot；
* text filter document 的 `kind/text/seq` 是否保持；
* 长历史分页/压缩事件是否改变本插件的噪声类型和命中窗口。

官方 session/query 相关 tag 入口：

* [dsh-session-query package](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages/session/query)
* [官方包列表搜索入口](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages)

### 6.2 sessionPersistence

本插件把 persistence 当 optional seam 使用：

* `supportsRawArtifacts === true` 才尝试用 `listSnapshots/locate/readRaw` 备份会话；
* 不可用或读取失败回退物理文件复制；
* `locate(header)` 返回路径后仍做 sessions root 越界校验；
* active session 写入时使用稳定读取/重编码策略。

alpha.2 release 提到减少会话加载不必要的文件系统检查、改善长历史效率。该变化可能影响时序/性能，但不是已知 API 删除。真正需要验证的是 `readRaw` 返回值是否仍含 `{content}`、`locate` 是否仍接受 header、`listSnapshots()` 是否仍有 `header`。

不要把官方新的内部文件缓存/投影当作可直接读取的稳定 API；本插件应继续优先调用 persistence contract，失败时保持安全降级。

### 6.3 官方查询/删除边界

官方仍没有通用“删除会话”业务 API 的证据；本插件只允许已归档会话，并在 plan 与执行阶段复核 `workspaceRegistry.archivedSessionIds`、会话存在性和 live 状态。alpha.2 的会话 UI 改进不应被解读为新增删除/恢复 API。

## 7. webServer / subprocess / workspace / agents / jobs / terminals

### 7.1 webServer

本插件通过 `ctx.get('webServer')` 注册：

* `/healthz`：空 body 状态端点；
* `/dsh-backup-download`：一次性 token 下载。

官方 webServer 仍应视为路由注册服务，而非自动获得 Connection RPC 的认证/authority。alpha.2 若增强 browser auth、Host/Origin trust fence 或 API route 保护，不能假定自定义顶层 route 自动共享全部策略。升级后应实测 GET/HEAD/POST 状态、同源 cookie 和外部监控可达性。

参考：[官方 webserver 包目录](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages/host/webserver)

### 7.2 subprocess

本插件用 subprocess：

* 解析固定白名单 `tar`、`cmd.exe` 等可执行文件；
* `spawn({argv,cwd,env,stdio,graceMs})`；
* 读取 `handle.done` 和受限 stderr；
* 不接受浏览器传入命令/路径。

alpha.2 release 没有列出 subprocess API breaking change；官方 compare 中 subprocess 有持续安全/ teardown 优化的迹象。兼容性验收应覆盖 tar 可用、退出码/信号、stderr collector、Windows `.cmd/.bat` 分支和 stop/update disposer。

参考：[官方 subprocess 相关搜索](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages)

### 7.3 workspaceRegistry

本插件使用 `list()` 选择 cwd 所属 workspace，读取 `archivedSessionIds`，并调用 `archiveSession(id)`。这些调用均有 optional check；未知 session 错误被归一化。需要验证 alpha.2 是否仍保持归档集合持久化、archive 幂等以及 unknown id 错误语义。

### 7.4 agents/jobs/terminals

健康页/重启 guard 读取：

* `agents.list()`；
* `jobs.list(caller)`，对 agents 和 undefined caller 去重；
* `terminals.list(owner)`，共享服务和 owner scope 均尝试。

这些服务是可选的；缺席时活动数为零或功能降级。alpha.2 长会话/实时消息性能改进可能改变 live agent/job 更新时序，必须验证“有活动工作时禁止重启/升级”仍成立，尤其是服务返回 Iterable 而非 Array、状态字段名称或 owner scope 改变时。

## 8. `index.js` / `src/client.js` 逐项兼容判断

| 范围 | 当前调用 | alpha.2 证据判断 | 风险/动作 |
|---|---|---|---|
| ApiProxy | 无直接调用 | 无直接迁移项 | 不改；确认没有间接 `ctx.api` 依赖 |
| RemoteError | 非 Remote 业务调用；自有 RPC envelope | alpha.2 统一 RemoteError | 保持 JSON error；测试异常映射 |
| Connection/RPC | `handle('/dsh-service')` / `call('/dsh-service', endpoint, payload)` | alpha.2 client 仍接受 channel/endpoint 形状 | P0 实测 reset、401、strict failure |
| slots | `settings.section`、conversation input slots 等 | 未见移除证据 | P1 验证注册、卸载、滚动/portal |
| settings.section | order 99/动态注销 | 仍是第三方扩展的预期入口 | 验证官方新设置导航和小屏 |
| sessionQuery | list/read/title/filterEvents | 可能受 projection/长历史性能变更影响 | 核对 contract 与事件形状 |
| sessionPersistence | snapshots/locate/readRaw | 未见删除证据 | 核对 raw 返回形状和稳定读取 |
| webServer | healthz/backup download routes | route owner 与 RPC 分离 | 验证 auth、HEAD/GET、监控 |
| subprocess | resolveExecutable/spawn/done | 无 release breaking change | 验证 tar、signal、collector |
| workspace | list/archive/archived ids | 预期保持 | 验证归档持久化/未知 id |
| agents/jobs/terminals | activity guard/health | 服务可能继续可选 | 验证 live 状态与重启 guard |
| client inject | connection/runtime/api-remotes | **alpha.2 已确认 roster 移除 runtime，且 npm 无 alpha.2 包；当前 Client 很可能等待不存在 supplier** | **先移除 `@deepseek-ai/dsh-client-runtime` inject，再做 clean-profile 回归；不机械替换** |

## 9. 验收清单

### Host/RPC

1. 在 alpha.2 clean profile 挂载当前插件，确认 Host fiber 激活。
2. 调用 `version`、`health`、`sessions-list`、`sessions-view`、`backup-list`、`models2-snapshot` 等代表 endpoint。
3. 验证所有 failure 是结构化 `{ok:false,error:{code,message,details}}`，没有裸字符串。
4. 测试未知 endpoint、非法 payload、feature disabled、unknown id、expired plan。
5. 验证 `/healthz` GET/HEAD/POST 状态与空 body。
6. 验证 backup download token 的首次成功、重复失败、过期失败。

### Connection/Client

1. 由 alpha.2 官方启动 URL打开页面，确认 cookie/auth carrier 正常。
2. 断网/恢复网络，观察 connection failure UI、自动重试、立即重连。
3. 确认 `connection/reset` 后通知基线重建且不重复响铃。
4. 确认 `ctx.sessions.list`、locale subscription、slot registration 不重复。
5. **先移除 `@deepseek-ai/dsh-client-runtime` inject，再确认 Client fiber 进入 active；** alpha.2 roster 已移除该 supplier，当前声明很可能造成 waiting/failed。随后对照 alpha.2 composition 回归 `connection`、`locale`、`sessions`、slots 与 React seed。

### Session/UI

1. 冷会话/活跃会话 list、详情、全文搜索、归档、删除 guard。
2. 长历史、压缩日志、密集实时事件；检查 token/耗时官方新增 UI 不遮挡插件。
3. 桌面、窄屏、窗口旋转：`settings.section`、composer left/right、portal、外点关闭。
4. session export 的 HEAD 与 anchor 下载，确认同源认证；backup export 也单测。
5. 切换 zh/en/浏览器语言，确认插件 locale fallback。

### Runtime capability

1. subprocess `tar` 成功与失败路径。
2. workspace archive/id persistence。
3. agents/jobs/terminals 有工作时重启 guard 阻断，无工作时允许。
4. Node 22.19+ 与 Node 24.0–24.11.1 的 alpha.2 启动/HMR。

## 10. npm manifest / tarball 差异与建议命令

### 10.1 已确认的 manifest 差异

* 本机宿主 manifest 是已安装包 `/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json`，版本 `0.1.1-rc.2`，Node 相关依赖及各 DSH 子包版本线为 `^0.1.1-rc.2`。
* alpha.2 官方根仓库 manifest raw 显示根工作区版本为 `0.1.2-alpha.2`，package manager 为 `pnpm@11.7.0`，Node engines 为 `^22.19.0 || >=24.0.0`；根包是 private workspace root，不等同于 npm CLI 包的发布 manifest。
* 因此不能用根 `package.json` 直接断言 npm `@deepseek-ai/dsh@0.1.2-alpha.2` 的最终 files/dependencies；必须读取 npm registry version metadata 中 `versions["0.1.2-alpha.2"]`、其 `dist.tarball` 和 tarball 内 `package/package.json`。

### 10.2 tarball 差异状态

**未确认**：本次研究没有在不改变当前宿主安装的前提下下载并解包 alpha.2 tarball，也没有对 rc.2 与 alpha.2 的发布文件清单做逐项 hash/diff。因此本文不声称 `lib/*.js`、`config`、依赖树或新增/删除文件完全一致。重点要检查：

* npm tarball 的 `package.json` `files`、`main`、`bin`、`dependencies`、`engines`；
* `lib/bin.js` 及 CLI 启动所需的 `lib/*.js` 是否齐全；
* `@deepseek-ai/dsh-web-app`、Connection、Remote gateway、session/persistence/query、webServer、subprocess、workspace、agents/jobs/terminals 相关包版本是否改变；
* 是否仍包含/挂载 `@deepseek-ai/dsh-client-runtime`，以及 alpha.2 web composition 对其是否仍有 supplier；
* tarball 中的 package metadata 是否与 GitHub tag 源码版本对应。

### 10.3 建议验证命令（下载到临时目录，不改仓库/当前宿主）

```bash
set -eu
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
npm view @deepseek-ai/dsh@0.1.1-rc.2 version dist.tarball dist.integrity engines dependencies --json
npm view @deepseek-ai/dsh@0.1.2-alpha.2 version dist.tarball dist.integrity engines dependencies --json
npm pack --pack-destination "$TMP" @deepseek-ai/dsh@0.1.1-rc.2
npm pack --pack-destination "$TMP" @deepseek-ai/dsh@0.1.2-alpha.2
mkdir "$TMP/rc2" "$TMP/a2"
tar -xzf "$TMP"/*dsh-0.1.1-rc.2.tgz -C "$TMP/rc2"
tar -xzf "$TMP"/*dsh-0.1.2-alpha.2.tgz -C "$TMP/a2"
diff -u "$TMP/rc2/package/package.json" "$TMP/a2/package/package.json" || true
( cd "$TMP/rc2/package" && find . -type f -print | sort > "$TMP/rc2.files" )
( cd "$TMP/a2/package" && find . -type f -print | sort > "$TMP/a2.files" )
diff -u "$TMP/rc2.files" "$TMP/a2.files" || true
```

对 alpha.2 clean profile 的建议命令（需在具备 alpha.2 包和隔离 `$DSH_HOME` 的环境执行）：

```bash
DSH_HOME="$(mktemp -d)" npx --yes @deepseek-ai/dsh@0.1.2-alpha.2 web --help
DSH_HOME="$(mktemp -d)" npx --yes @deepseek-ai/dsh@0.1.2-alpha.2 web --patch /path/to/cordis.patch.yml
npm test
```

其中第二条应改用实际可加载的 profile/patch 配置；不要把 alpha.2 安装覆盖当前 `/usr/local/lib/node_modules/@deepseek-ai/dsh@0.1.1-rc.2`。运行后应检查插件 fiber 是否 active、inject 是否 waiting、RPC/slot 是否注册，并执行第 9 节的端到端清单。

## 11. 最终建议

* **本次研究不改任何代码或配置；只新增并补充本文件。**
* 不因 alpha.2 release 中的 ApiProxy/RemoteError 文字自动修改 RPC；当前 `/dsh-service` 通道已走新式 generic Connection。
* **先移除 `dsh.client.inject` 中的 `@deepseek-ai/dsh-client-runtime`，再进行隔离 DSH_HOME 的 clean-profile 实测。** 该包已从 alpha.2 dsh-web-app 浏览器 roster 移除，且 npm registry 没有 `0.1.2-alpha.2` 发布物；当前 Client 很可能因等待不存在的 supplier 而不挂载。回归时尤其核对 Client fiber active 状态及 alpha.2 composition 提供的替代 services。
* 若仅出现 Remote/transport 错误，优先修正错误 carrier/认证或调用 contract，不把 token/cookie 复制到插件 payload。
* 若 session API 改名/改形状，再针对实际 alpha.2 manifest/source 增加兼容适配；保留 optional service 降级策略。
* 在实机验收通过前，不抬高插件 README 的 DSH 最低兼容版本，也不宣称 alpha.2 已完全支持。

## 官方来源索引

1. [alpha.2 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2)
2. [rc.2 → alpha.2 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.2-alpha.2)
3. [compare API](https://api.github.com/repos/deepseek-ai/deepseek-harness/compare/b150a551...0a53fb5)
4. [alpha.2 root manifest raw](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/package.json)
5. [npm registry metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh)
6. [npm `@deepseek-ai/dsh@0.1.2-alpha.2`](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.2-alpha.2)
7. [alpha.2 Connection RPC raw](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/client/connection/src/client/rpc.ts)
8. [alpha.2 API remotes raw](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/api/remotes/src/index.ts)
9. [alpha.2 settings package](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages/client/ui-settings)
10. [alpha.2 package tree](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.2/packages)
11. [本仓库 `index.js`](../../index.js)
12. [本仓库 `src/client.js`](../../src/client.js)
13. [本仓库 `package.json`](../../package.json)
