# DSH `0.1.2-alpha.3` 对 `dsh-service` 的兼容性影响评估

> 调研日期：2026-08-31
> 目标版本：`dsh-v0.1.2-alpha.3`（prerelease，tag commit `dd6322d604e00eec1ba5e0c8541159906a21094a`）
> 对比基线：`dsh-v0.1.2-alpha.2`（tag commit `0a53fb55bea101816fa226bb964ae2bed71c343b`）
> 范围：官方 alpha.3 release、GitHub compare/commit、官方 tag 源码与 manifest，以及本仓库 `index.js`、`src/client.js`、`package.json`、`cordis.patch.yml`。
> 结论分级：**已确认**=一手来源直接证实；**推断**=根据当前插件调用面推导；**实机未见影响**=已在现有实例升级后进行基本浏览与功能检查，未观察到插件回归；**未覆盖**=尚未执行某些专门的故障注入、迁移或全量 E2E 场景。

## 结论摘要

**alpha.3 没有发现需要立即修改 `dsh-service` 业务代码的已知 breaking change；当前工作区的 Client inject 已经是 alpha.3 所需的精简形状。** 本插件当前 `package.json` 只声明 `@deepseek-ai/dsh-client-connection` 与 `@deepseek-ai/dsh-api-remotes`，没有 alpha.2 时代曾造成等待问题的 `@deepseek-ai/dsh-client-runtime`。Host/Client 继续使用 generic Connection RPC、单层 `/dsh-service` channel、已有结构化 RPC failure envelope，接口方向与 alpha.3 一致。

**唯一需要按 P0 处理的变化是持久化后端移除：alpha.3 删除了可选 SQLite Session persistence backend，官方只随包交付 JSONL persistence provider。** 这对插件的业务功能预计是低风险，因为插件消费的是后端无关的 `ctx.sessionPersistence`/`ctx.sessionQuery` seam；但插件的备份、用量索引、会话删除定位依赖 `locate()` 返回物理文件路径，必须确认部署使用 JSONL provider，而不能再假设 SQLite persistence 具备文件产物。

alpha.3 还带来三类对插件有益但需回归的变化：

1. 长会话右侧 rail 可以预览并跳转尚未载入的轮次；这不改变本插件自有的逐条「上一条用户回复」箭头，两者应继续共存。
2. Connection 后端卡顿不再轻易被误判为断开；本插件的 `connection/reset` 通知基线与轮询行为应做一次重连回归。
3. 代码高亮改为更懒的 viewport 处理、窄视口 Schedule 标题修复与图片队列/持续子代理图片支持，均不直接触碰本插件的 settings/maintenance RPC，但需要验证自有移动端 overlay、turn-tail 与会话管理 UI 没有视觉遮挡。

## 总体状态表

| 主题 | 状态 | 对本插件的影响 | 建议 |
|---|---|---|---|
| Client inject roster | **已确认/实机未见影响** | 当前 package.json 只有 connection + api-remotes；不再依赖 alpha.2 已移除的 `dsh-client-runtime`；升级后基本浏览未见 Client 挂载回归 | 保持现状；故障注入仍可另行回归 |
| Generic Connection RPC | **已确认接口兼容/基本实机未见影响** | `/dsh-service` 仍是单层 channel；strict failure 仍要求结构化 error object；升级后插件基本功能可用 | 不改 channel；慢连接、真实断线和 strict failure 仍未全量覆盖 |
| Session persistence | **已确认有 breaking 变化/实机未见影响** | SQLite persistence backend 被删除；JSONL 成为官方唯一一方 persistence provider。本实例实际使用 JSONL，升级后既有会话仍可用，插件 raw artifact/locate 路径策略保持适配 | 保留升级前备份；旧 SQLite 迁移风险仅适用于使用过该后端的部署 |
| Session query / SQLite FTS | **已确认未移除/未验证** | `session-query-sqlite` 仍存在，且与 persistence SQLite 是不同包；插件当前不用 `searchSessions/searchEvents`，而用 `listSessions` + `filterEvents` | 不把「移除 SQLite persistence」误判成移除 SQLite query backend；回归搜索与大日志读取 |
| Long-session turn rail | **已确认增强/推断无冲突** | 官方 rail 现在可导航未加载轮次；插件自有箭头仍按已加载 user 行逐条回退并触发 older 分页 | 保持共存；验证 older 分页、rail 显隐与箭头位置 |
| `conversation.chat.turnTail` | **已确认契约延续/未验证 alpha.3 DOM** | 官方仍保留 turn-tail chain owner；插件注册 `conversation.chat.turnTail` 且只在 `turn-process` 的 subagentCount>0 时认领 | 不改 selector；检查 alpha.3 slot contract 与 turn data |
| Connection stall handling | **已确认修复/未验证** | 慢 Host 连接不应再被过早 reset；插件可能少收 reset，属于预期改善 | 验证通知基线不重置、轮询不风暴、不重复通知 |
| Schedule narrow viewport | **已确认官方修复/推断无直接影响** | 修复发生在会话标题 Schedule catalog；插件没有 Schedule selector | 只做窄屏视觉验收 |
| Lazy code highlighting / memory | **已确认优化/推断无直接影响** | 影响官方 Markdown/code renderer，不改变插件 React/DOM 合约 | 检查 session detail/overlay 中自有样式没有遮盖官方高亮 |
| Queued/follow-up images | **已确认修复/无直接调用面** | 插件不调用 prompt/queue admission；仅可能改变官方会话树高度与 turn-tail 附近布局 | 做图片队列和持续子代理会话的视觉回归 |
| Web routes/auth | **未发现 alpha.3 新 breaking/未验证** | `/healthz` 与 backup download 是插件自有 webServer 路由，认证/同源策略仍不能从 release notes 推断 | 验证 GET/HEAD/POST、token 下载、session export |
| Host services | **未发现删除/未验证** | `sessionQuery`、`workspaceRegistry`、`subprocess` 等均通过 `ctx.get()` 可选消费 | clean profile 检查 service manifest、错误和降级 |

## 1. 官方 alpha.3 版本变化

### 1.1 Release notes

官方 alpha.3 发布说明列出：

- 长会话右侧导航支持预览、跳转全部分页轮次，包括尚未载入的轮次；
- 改善长会话渲染的内存开销和代码高亮流畅度；
- 优化权限标签多语言表达；
- 修复运行中追加/排队图片的回显与投递，持续子代理后续消息支持图片；
- `read_image` 可以按文件内容识别没有扩展名的图片附件；
- 命令菜单打开时 Tab 补全当前高亮 slash command；
- 修复后端卡顿被误判为网络断开；
- 修复窄视口会话标题 Schedule 列表偏移/越界；
- 移除可选 SQLite Session persistence backend；已有内容不会删除，官方建议使用旧版本导出。

来源：[alpha.3 官方 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3)。完整提交范围见：[alpha.2 → alpha.3 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.2...dsh-v0.1.2-alpha.3)。

### 1.2 npm 发布物

官方 npm metadata 显示 `@deepseek-ai/dsh@0.1.2-alpha.3` 已发布，tarball 为 `dsh-0.1.2-alpha.3.tgz`，发布日期为 2026-08-31；当前 dist-tags 中 alpha 指向 alpha.3，而 latest/next 仍指向 `0.1.1-rc.2`。alpha.2 与 alpha.3 CLI tarball 的文件清单相同，只有 package metadata 有微小差异；不能因此替代真实 Web 启动验证。

这只是 CLI tarball 的结论，不代表所有 workspace 子包都没有文件变化。例如 `@deepseek-ai/dsh-client-ui-primitives@0.1.2-alpha.3` registry metadata 报告 81 files / 495,672 bytes，而 alpha.2 报告 80 files / 478,499 bytes；这与 alpha.3 lazy highlighting 增加源码/构建产物的结论一致。见 [alpha.3 ui-primitives npm metadata](https://registry.npmjs.org/%40deepseek-ai%2Fdsh-client-ui-primitives/0.1.2-alpha.3)。

来源：[npm registry metadata](https://registry.npmjs.org/@deepseek-ai%2Fdsh)；[alpha.3 npm page](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.2-alpha.3)。

## 2. 对 `dsh-service` 的直接调用面核对

### 2.1 Client inject 已不再有 alpha.2 的阻断项

本仓库当前 [`package.json`](../../package.json) 的 `dsh.client.inject` 为：

```json
["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-api-remotes"]
```

当前没有 `@deepseek-ai/dsh-client-runtime`。因此 alpha.2 研究中记录的「官方 roster 已移除 runtime、插件仍等待该 supplier」问题在当前工作树已被消除。仍需在 alpha.3 的 clean profile 看到 Client fiber active；不要仅因 manifest 形状正确就宣称端到端兼容。

### 2.2 Generic RPC 与错误 envelope

Host 在 [`index.js`](../../index.js) 通过 `ctx.connection.rpc.handle('/dsh-service', dispatchRpc, { authority: 'loopback' })` 注册单层绝对 channel；Client 在 [`src/client.js`](../../src/client.js) 通过 `ctx.connection.rpc.call('/dsh-service', endpoint, payload)` 调用。alpha.3 Connection RPC 源码仍以 `${channel}/${endpoint}` 组织请求，并保留 strict server-response 校验；失败响应的结构化 error object 仍是兼容形状。

本插件的 `normalizeRpcResult()` 将结构化 error 映射为既有字符串语义，避免业务 UI 需要改动。升级不要把 token/cookie 或 RemoteError 对象复制到插件 payload。

来源：[alpha.3 Connection RPC](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/connection/src/client/rpc.ts)；本仓库 [`index.js`](../../index.js) 与 [`src/client.js`](../../src/client.js)。

### 2.3 Host 服务调用

插件 Host 侧使用的服务都通过 `ctx.get()` 并带可选检查：

- `sessionPersistence`：`listSnapshots`、`readFrom`、`locate`、`readRaw`；
- `sessionQuery`：`listSessions`、`readSession`、`readTitleSnapshots`、`filterEvents`；
- `workspaceRegistry`：`list`、`archivedSessionIds`、`archiveSession`；
- `subprocess`：固定白名单 executable 的解析与 spawn；
- `webServer`：`/healthz` 与备份下载路由。

因此单项服务暂时缺席时主要是健康、备份、搜索或会话维护降级，而不是 Client 注入整体等待。例外是 persistence：备份若无法定位 raw artifact 会回退物理目录复制；会话删除依赖 `locate()`，没有文件型 provider 时会安全拒绝，不会猜路径。

## 3. P0：SQLite persistence backend 移除

### 3.1 已确认的变化

alpha.2 的 `packages/session/session-persistence-sqlite` 仍存在，并将 SQLite 作为可互换 persistence backend；alpha.3 的 session package mapping 只列出 `session-persistence` 与 `session-persistence-jsonl`，没有 `session-persistence-sqlite`。alpha.3 的删除提交标题是 `refactor(session)!: remove SQLite persistence backend`。

来源：[alpha.2 session package directory](https://api.github.com/repos/deepseek-ai/deepseek-harness/contents/packages/session?ref=dsh-v0.1.2-alpha.2)；[alpha.3 session package directory](https://api.github.com/repos/deepseek-ai/deepseek-harness/contents/packages/session?ref=dsh-v0.1.2-alpha.3)；[移除提交 `4553c9d`](https://github.com/deepseek-ai/deepseek-harness/commit/4553c9d957ec09c1e92660ca4d549cfcef84eda9)。

alpha.3 JSONL 文档明确说它是随产品交付的唯一 Session persistence provider，以每会话一份 `.jsonl.zstd` 产物提供 `locate(meta)`。抽象 service 仍保留 `listSnapshots()`、`readFrom()`、`locate()` 等能力，接口没有被改为 SQLite 专属。alpha.2→alpha.3 的 JSONL provider 实现没有行为性 diff，因此当前插件的 JSONL seam 调用不需要改名或改参数。

来源：[alpha.3 session persistence seam](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session/session-persistence/src/index.ts)；[alpha.2 session persistence seam](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/session/session-persistence/src/index.ts)；[alpha.3 JSONL provider](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session/session-persistence-jsonl/README.md)；[alpha.3 JSONL implementation](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session/session-persistence-jsonl/src/index.ts)。

### 3.2 与本插件的关系

本插件此前已经按「后端无关 seam + JSONL raw artifact」设计：

- 备份进度创建使用 `supportsRawArtifacts`、`listSnapshots`、`locate`、`readRaw`，定位失败则回退整树复制；
- 用量索引使用 `listSnapshots` 的 opaque `revision` 和 `readFrom` 做增量折叠；
- 会话管理使用 `sessionQuery.listSessions()` 找 header，再以 `sessionPersistence.locate(header)` 得到会话目录；
- 会话删除只允许已归档且非 live，并在执行前再次确认归档状态和 live 状态。

因此从 SQLite persistence 迁移到官方 JSONL 的预期影响是：

1. **正面：** JSONL 的物理产物与插件备份/删除模型一致，不再需要为 DB-only persistence 设计「无法按会话定位文件」分支。
2. **风险：** 旧 SQLite persistence 数据不会因为升级自动转换；alpha.3 release 明确建议用旧版本导出。升级前若部署曾使用 SQLite persistence，应先导出/迁移并确认 `sessionQuery.listSessions()` 可见，不能把 `.db` 文件直接当作 `sessions/<project>/<id>/...` 目录。
3. **不应做的修改：** 不要把 `sessionPersistence` 强制注入为 JSONL，不要在插件中引入或猜测 SQLite schema，不要把 session query SQLite backend 与 persistence SQLite 混为一谈。

### 3.3 Session query SQLite 不是同一个东西

alpha.3 仍发布 [`@deepseek-ai/dsh-session-query-sqlite`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session-query/session-query-sqlite/package.json)，它是独立的 SQLite FTS5 派生索引后端；它搜索 `ctx.sessionQuery.searchSessions/searchEvents`，不打开 session-persistence 数据库。alpha.3 Web composition 的 `session-query-sqlite` 仍可配置为 `path: ':memory:'`、`openAt: never`。

本插件没有直接调用这两个全文方法，而是使用 `filterEvents()` 的字面文本筛选。因此官方搜索后端是否打开不会阻断插件会话搜索；如果未来插件改用全文 search，必须处理 `SESSION_QUERY_SEARCH_DISABLED`。

来源：[alpha.3 SQLite query README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session-query/session-query-sqlite/README.zh.md)；[alpha.3 web composition](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/bundle/web-app/cordis.patch.yml)。

## 4. Client UI / Slot / DOM 影响

### 4.1 长会话 rail 与自有箭头

alpha.3 的 `ui-chat` 源码说明：官方 TurnNavigator 把已加载 Turn 与宿主 `turnOutline` 投影合并，每个已开始的 Turn 都有固定刻度；点击未加载刻度会先加载到对应 `turn/start` seq，再落到目标行。没有 `dsh-session-turn-outline` 时回退到已加载 Turn。

本插件的自有箭头不是回合级 rail，而是在官方 to-bottom slot 上注入的「上一条用户回复」逐条按钮：

- 官方目标仍由 `[data-chat-flow-kind="user"]` 行提供；
- 目标不存在时点 `[class*="_older"] button` 加载更早历史后短窗重试；
- 官方 TurnNavigator 仍不参与显隐判断，二者语义、位置不同。

因此 alpha.3 的未加载轮次导航不会使插件箭头失效，也不应重新加入「rail 可见即让位」。但官方 rail 和插件箭头都可能出现在同一桌面宽屏会话，必须检查位置不重叠；窄屏官方 rail 仍受容器宽度门控，插件箭头应继续独立工作。alpha.3 的 rail CSS 新增仅属于 rail 自身的 `.scroller`（内部 `overflow-y:auto` 与 `overscroll-behavior:contain`）；alpha.3 `ConversationRoot` 仍提供 `[data-phase]`、`[data-conversation-scroll]`、`[data-composer-seat]`，所以不会改变插件外层 scrollport 的参照系。

来源：[alpha.3 TurnNavigator source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/ui-chat/src/client/chat/TurnNavigator.tsx)；[alpha.3 TurnNavigator CSS](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/ui-chat/src/client/chat/TurnNavigator.module.css)；[alpha.3 ConversationRoot](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx)；本仓库 [`src/client.js`](../../src/client.js) 的 `createConversationNav`/`createUserJump`。

### 4.2 turn-tail 子代理模型行

alpha.3 仍保留 `conversation.chat.turnTail` chain slot 与 TurnTail owner contract；本插件在该 slot 注册 `dsh-service-subagent-models`，selector 读取官方 `turn-process` 数据的第 9 段 `subagentCount`，只有存在子代理时才认领。alpha.3 ChatView 新增 `loadThrough` 是官方导航分页能力，不改变现有 turn-tail owner 的消费方式。

风险主要是回合尾行附近高度和显隐变化：官方 alpha.3 更积极地按已加载/未加载 Turn 渲染导航与折叠过程，插件组件不应依赖某个 CSS hash 或把官方 rail 当作唯一滚动容器。当前插件只使用 slot props 与稳定 data 属性，方向正确；需用 alpha.3 bundle 重新确认 slot registration contract。

来源：[alpha.3 TurnTail/Chat slot contract（见 ui-chat 源码）](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/ui-chat/src/client/contract/slots.ts)；[alpha.3 ChatView](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/ui-chat/src/client/chat/ChatView.tsx)。

### 4.3 Schedule、图片与代码高亮

Schedule 窄视口修复属于官方会话标题区域，插件没有 Schedule DOM selector；其 commit 为 [`faa977f`](https://github.com/deepseek-ai/deepseek-harness/commit/faa977fb2960521c30e80612442796b7677aadd2)。官方实现采用 body portal/fixed 定位，修复 containing-block/overflow 裁剪。当前插件 quota popup 已有同类窄屏 `react-dom.createPortal` → `document.body` 路径（[`src/client.js`](../../src/client.js) lines 3042–3055、3169–3229），因此不需要改代码，但要实测官方 Schedule 与 quota popup 同时打开时的几何。

图片队列/持续子代理 follow-up 修复属于官方 Session Controller、attachment 与 QueueDock；lazy code highlighting 属于 ui-primitives Markdown/CodeBlock。它们不改变当前插件的 RPC endpoint、settings.section、shell.overlay 或 conversation input slot contract。

仍需回归：

- 设置模态在窄屏的 overlay/portal 是否仍完整可用；
- 会话页上箭头、沉浸把手、`conversation.chat.turnTail` 是否与官方新增/懒加载节点错位；
- 会话详情与搜索命中窗口中的文本/图片/代码是否能安全展示。

## 5. Connection stall 修复的插件影响

alpha.3 Connection 实现把 readiness timeout 作为诊断告警，而不是在慢 generation 上直接失败；release 同时说明后端卡顿不应再误判为网络断开。这样会减少虚假的 `connection/reset`，属于预期行为。

本插件在客户端：

- 订阅 `ctx.sessions.list` 做会话 running/pendingInteraction 的事实源；
- 监听 `connection/reset`，清空通知边沿基线，避免重连后重复响铃；
- 对 skills batch、quota、restart recovery 等使用自有 RPC/轮询。

因此要验证的是时序而不是 API 迁移：慢 Host 时不应提前把会话标记为断开；真实断线后 reset 仍应触发，恢复后基线只建立一次；轮询不能因少一次 reset 而停死，也不能在 repeated reset 下风暴。

来源：[alpha.3 Connection client RPC](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/connection/src/client/rpc.ts)；[alpha.3 connection commit `49bf26a`](https://github.com/deepseek-ai/deepseek-harness/commit/49bf26a794e8d8bf0cb75c725a6ac05297a61b41)；[alpha.3 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3)。

## 6. 建议的升级验收顺序

### P0：先确认安装/启动与数据安全

1. 用隔离 `DSH_HOME` 安装或运行 `@deepseek-ai/dsh@0.1.2-alpha.3`，不要覆盖当前宿主。
2. 检查 Web composition：JSONL persistence provider 已挂载；不要配置已删除的 `@deepseek-ai/dsh-session-persistence-sqlite`。
3. 若旧部署使用 SQLite persistence，升级前用旧版本导出；升级后确认新会话以 JSONL `.jsonl.zstd` 物理产物出现，备份/删除/用量索引均能工作。
4. 确认本插件 Host fiber active、Client fiber active，`dsh.client.inject` 没有 waiting supplier。

### P1：代表性 RPC 与服务回归

1. 调用 `version`、`health`、`sessions-list`、`sessions-view`、`sessions-search`、`sessions-export`、`backup-list`、`backup-create`、`models2-snapshot`。
2. 覆盖成功、未知 endpoint、非法 payload、feature disabled、unknown id、expired plan；每个 failure 都必须保持 strict structured envelope。
3. 验证 `/healthz` GET/HEAD=空 200、其他方法=空 405；备份下载 token 一次成功、重放/过期失败；官方 `session.export` 下载同源可达。
4. 验证 persistence `listSnapshots`/`readFrom` 增量索引，raw artifact 备份，以及 archived-only delete 的双重检查。

### P2：浏览器与移动端

1. 桌面长会话：官方未加载 Turn rail 预览/跳转、插件自有逐条上箭头、插件 turn-tail 模型行三者共存。
2. 窄屏：官方 Schedule、插件设置 modal、composer left/right、shell overlay、沉浸隐藏/把手、上箭头。
3. 慢 Host、真实断线、恢复：观察 connection failure UI、`connection/reset`、通知基线、quota/skills/restart 轮询。
4. 图片队列和 continuable subagent follow-up：确认官方图片回显/投递不改变插件布局。

## 7. 实机升级结果

用户已将当前运行实例升级到 DSH `0.1.2-alpha.3`，并完成基本浏览与功能检查；反馈为“看了一圈没什么影响”。结合此前确认的运行环境：该实例使用 JSONL persistence，已有会话位于 `$DSH_HOME/sessions/**/session.jsonl.zstd`，不存在会话用 SQLite 数据库。因此：

- 原有会话无需 SQLite→JSONL 迁移，升级后可直接复用 JSONL 会话目录；
- 当前插件的 Host/Client 挂载、核心界面与已浏览功能未观察到回归；
- 不需要因为 alpha.3 修改 `index.js`、`src/client.js`、`package.json` 或 `cordis.patch.yml`；
- 结论从“静态兼容性较高”更新为：**已完成基本实机兼容检查，未见实际影响**；
- 这不是全量 E2E 或故障注入证明，仍建议保留升级前 `$DSH_HOME` 备份，并在后续使用中留意长会话分页、备份恢复、归档删除、移动端布局和断线恢复。

当前运行实例核验记录：

- `DSH_HOME=/home/node/.dsh`；
- DSH 运行版本为 `@deepseek-ai/dsh@0.1.2-alpha.3`；
- 会话文件为 `sessions/**/session.jsonl.zstd`；
- `DSH_HOME` 下未发现会话用 `*.db`、`*.sqlite` 或 `*.sqlite3` 文件；
- `.pnpm-store/v11/index.db` 是 pnpm 缓存索引，不是 DSH Session persistence 数据库；
- `session-query-sqlite` 配置为 `path: ':memory:'`、`openAt: never`，属于可选全文查询索引，不是 Session persistence。

## 8. 导出后的迁移边界

### 8.1 先区分三种“导出文件”

| 文件/入口 | 能否直接迁移到 alpha.3 | 说明 |
|---|---|---|
| 官方 Session log `.zip`（Session Header 的 `Session log` 或 `/export`） | **不能直接导入；SQLite 下甚至无法生成** | JSONL 等支持 raw artifact 的后端才会生成这个浏览器下载包，内容包含 `session.jsonl`、子会话和附件；官方只定义 download，不提供用户级 import/restore 入口。alpha.2 SQLite provider 的导出请求会因 `supportsRawArtifacts=false` 直接返回 HTTP 501。 |
| `dsh-service` 备份 `.tar.gz` | **可以恢复，但有前提** | 插件的 `backup-import`/`backup-restore` 只接受本插件自己的归档布局（`sessions/`、允许的配置、`profiles/*/package.json`）。源会话必须已经是 JSONL 文件型 persistence；它不是 SQLite 数据库转换器。 |
| alpha.2 SQLite persistence `.db` | **不能被 alpha.3 直接读取** | alpha.3 已移除 SQLite persistence provider；复制数据库文件或把它放入 `sessions/` 目录都不会让 JSONL provider 识别。 |

官方 `session-log-export` 文档还明确要求随产品交付的 JSONL provider 提供逐 Session 原始产物；alpha.2 的导出路由在 `!supportsRawArtifacts` 时明确返回 HTTP 501，SQLite provider 的 `locate(meta)` 返回 `undefined` 且不支持 raw artifacts。因此如果旧实例实际使用 SQLite persistence，不能把官方 Session log 下载当作可靠的 SQLite→JSONL 迁移手段。

来源：[官方 Session log export 文档](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session-query/session-log-export/README.zh.md)；[alpha.2 SQLite persistence 文档](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.2/packages/session/session-persistence-sqlite/README.zh.md)；本插件 [README 备份格式](../../README.md)。

### 8.2 旧 SQLite 数据的可靠迁移路线

如果你确实使用过 alpha.2 的 SQLite persistence，推荐保留旧 alpha.2 和数据库不动，做一次**后端 API 级迁移**，而不是依赖 ZIP 解包或数据库文件复制：

1. 停止写入旧数据库，先复制数据库/整个旧 `DSH_HOME` 做不可变备份。
2. 在 alpha.2 composition 中读取旧 provider，用 `list()` 枚举会话，并逐个 `load(id)` 得到 `{ meta, events }`。
3. 在单独的 alpha.3 composition 中挂载 JSONL provider，对每个会话执行 `create(meta)`，然后按原顺序执行 `append(id, events)`。
4. 对 alpha.3 JSONL 根目录逐个 `list()`/`load()` 验证会话数量、ID、事件连续性和关键历史内容，再切换正式实例。
5. 迁移确认前保留旧数据库；不要让两个 provider 同时继续写同一个逻辑会话，以免形成两份分叉历史。

官方 alpha.2 SQLite 文档给出的跨后端范式就是：源端 `load`，目标端 `create(meta)` + `append(id, events)`；由于一个 composition 只有一个 `ctx.sessionPersistence`，两端应分两次运行或分两个进程。伪代码如下：

```js
// source: alpha.2 + SQLite
for (const meta of await source.list()) {
  const loaded = await source.load(meta.id)

  // target: alpha.3 + JSONL（另一 composition / 进程）
  await target.create(loaded.meta)
  await target.append(loaded.meta.id, loaded.events)
}
```

这条路线迁移的是逻辑 Session header/event log。附件文件、子会话树的媒体文件、`workspaceRegistry.archivedSessionIds` 等不一定由这段 persistence API 自动覆盖，需要另行核对；旧环境必须保留到 UI 和恢复流程验收通过。

### 8.3 如果手里只有官方 Session ZIP

目前没有官方的一键导入路径。要把它变成 alpha.3 可用会话，需要自行编写一次性转换器：读取根 `session.jsonl` 与 `subagents/`，校验 header、事件 `seq` 连续性，再通过 alpha.3 JSONL provider 的 `create`/`append` 写入新根；`media/` 附件还要按 alpha.3 的附件服务/目录约定另行处理。不能直接把 ZIP 解压到 `$DSH_HOME/sessions`，也不能把它交给本插件的 `backup-import`。

### 8.4 如果旧实例本来就是 JSONL

不需要做 SQLite 迁移。可以在停机后保留同一 JSONL 会话根，或使用本插件生成的 `.tar.gz` 备份在 alpha.3 导入并恢复；仍建议先复制 `$DSH_HOME`，并验证会话列表、详情、导出和插件备份恢复。

## 9. 最终建议

- **当前不改业务代码。** alpha.3 的直接变化没有命中插件必须迁移的 API；工作区 package.json 已移除旧 runtime inject。
- **把 SQLite persistence removal 作为升级说明和数据迁移风险。** 这是对部署配置/历史数据的风险，不是当前插件代码的立即破坏。
- **不要修改当前稳定 DOM 后缀选择器或重新让位 TurnNavigator。** alpha.3 的 rail 增强与插件箭头职责不同；现有 `[data-conversation-scroll]`、`[class*="_toBottomSlot"]`、`[class*="_older"]`、`data-chat-flow-kind` 方案仍是正确兼容方向。
- **不要把 session-query-sqlite 移除误写成 SQLite 全部移除。** alpha.3 仍有独立 FTS5 查询 provider，且本插件当前走 `filterEvents()`。
- 基本实机检查已完成且未见插件回归；仍不要把它扩大表述为覆盖所有故障注入、迁移和全量 E2E 场景的“完全兼容”证明。

## 10. 官方来源索引

1. [alpha.3 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.3)
2. [alpha.2 → alpha.3 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.2...dsh-v0.1.2-alpha.3)
3. [alpha.3 Connection RPC](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/connection/src/client/rpc.ts)
4. [alpha.3 connection readiness fix](https://github.com/deepseek-ai/deepseek-harness/commit/49bf26a794e8d8bf0cb75c725a6ac05297a61b41)
5. [alpha.3 session persistence seam](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session/session-persistence/src/index.ts)
6. [alpha.3 JSONL persistence](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session/session-persistence-jsonl/README.zh.md)
7. [SQLite persistence removal](https://github.com/deepseek-ai/deepseek-harness/commit/4553c9d957ec09c1e92660ca4d549cfcef84eda9)
8. [alpha.3 session group mapping](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session/README.zh.md)
9. [alpha.3 session-query SQLite](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/session-query/session-query-sqlite/README.zh.md)
10. [alpha.3 ui-chat README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/ui-chat/README.zh.md)
11. [alpha.3 TurnNavigator](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.3/packages/client/ui-chat/src/client/chat/TurnNavigator.tsx)
12. [alpha.3 Schedule fix](https://github.com/deepseek-ai/deepseek-harness/commit/faa977fb2960521c30e80612442796b7677aadd2)
13. [alpha.3 lazy code highlighting](https://github.com/deepseek-ai/deepseek-harness/commit/faa61ada74bfb937f802e353057254b173f7e80)
14. [本仓库 package.json](../../package.json)
15. [本仓库 index.js](../../index.js)
16. [本仓库 src/client.js](../../src/client.js)
