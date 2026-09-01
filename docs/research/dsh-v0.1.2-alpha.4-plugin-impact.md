# DSH `0.1.2-alpha.4` 对 `@gehennawu/dsh-service` 的兼容性影响评估

> 调研日期：2026-09-01  
> 目标版本：`dsh-v0.1.2-alpha.4`（tag commit `4e84901e6471b79ec0338099867ebb4606d12bb5`）  
> 对比基线：`dsh-v0.1.2-alpha.3`（tag commit `dd6322d604e00eecba5e0c8541159906a21094a`）  
> 调研范围：官方 alpha.4 release/compare、官方 tag 源码与文档，以及本仓库的 `package.json`、`cordis.patch.yml`、`index.js`、`src/client.js`、构建产物和测试。  
> 结论分级：**已确认**=一手源码或 manifest 直接证明；**推断**=由插件当前调用面推导；**未验证**=尚未在 alpha.4 运行实例执行对应故障注入或完整 E2E。

## 结论摘要

**alpha.4 对本插件不是“完全兼容、无需关注”：发现两处已确认的直接业务兼容问题，均位于 `index.js` 的 Host 代码；同时确认 Client inject、generic RPC、会话查询的 `events` 返回值和现有 UI slot 仍可继续使用。**

两处直接问题：

1. `lastSubagentTurn()` 仍读取 `parent.session.events`（本仓库 `index.js` 约 3189 行）。alpha.4 从公共 `Session` 移除了 `events` getter，改为 `eventAt()`、`snapshotEvents()`、`ownEvents()` 等按需读取 API。因此子代理创建本身通常仍会成功（该扫描位于 fail-open 的派发记录逻辑），但 `turn` 可能不再写入 `subagent-dispatches` 记录，导致回合尾的子代理模型行和按回合过滤失去数据。
2. 用量索引仍把 `record.header.seedLength` 当作公共 header 字段（约 1750、1753、1851 行）。alpha.4 的公共 `SessionHeader` 要求 `isSeeded: boolean`，并明确拒绝输入 header 中的 `seedLength`；精确继承前缀改由 body-bearing persistence/query 返回的 `inheritedEventCount` 提供。因此 seeded/fork 会话的增量起点与继承事件过滤可能错误，表现为重复计费、漏计费或错误的 `lastSeq`。

这两处不是当前任务内直接修复：本次只完成影响调研和文档，不修改业务代码、版本号、README badge 或 composition。**升级 alpha.4 前应把上述两项作为必须跟进的修复/回归项，而不能仅凭 `npm test` 全绿判定兼容。**

## 总体状态表

| 主题 | 状态 | 对插件的影响 | 建议 |
|---|---|---|---|
| `Session.events` → snapshot API | **已影响** | `lastSubagentTurn()` 读不到事件，派发记录可能缺 `turn`；子代理派发本身由 fail-open 逻辑保护，未必失败 | 迁移到 `snapshotEvents()`（或在能精确界定范围时使用 `eventAt()`），并加入 alpha.4 回归测试 |
| `seedLength` → `isSeeded` + `inheritedEventCount` | **已影响** | 用量索引的 fork cut 读取过时；seeded 会话可能重复/漏计 usage | 按 alpha.4 persistence 返回值改造 `foldUsageEvents`/`refreshUsageIndex`，使用精确 `inheritedEventCount` 与 branded offset 语义 |
| Session query `readSession().events` | **无影响** | 插件 `viewSessionPage()` 使用的 `snapshot.events` 仍存在；alpha.4 只是给 snapshot 增加 `inheritedEventCount` | 不要把所有 `events` 字段都判为删除；只修 live `Session.events` 访问 |
| persistence `listSnapshots()` / `readFrom()` / `locate()` / `readRaw()` | **可能影响** | 备份、定位和会话管理主要 seam 仍存在；`readFrom()` 返回 richer suffix | 现有调用必须适配并测试新的 `readFrom()` 返回字段与 seeded offset 语义 |
| Client inject roster | **无影响** | 当前只注入 connection + api-remotes，没有 alpha.2 已移除的 client-runtime | 保持 `package.json` 现状 |
| Generic Connection RPC | **无影响** | `/dsh-service` 单层 channel、strict response envelope 和客户端调用方式未见变化 | 保持现有 channel；仍建议回归未知 endpoint、错误 envelope、慢连接 |
| 子代理 `start` / `startContinuable` | **可能影响** | 官方继续暴露创建方法；continuable follow-up 从单向 followup/report 统一为邻接 Agent 双向 `sendMessage`/steer | 插件的 start 包装无需因方法名立即改动，但要回归子代理后续消息、结算通知和模型路由记录 |
| 自定义模型 discovery | **无影响** | alpha.4 在官方 `llm-pi-ai` 内部复用配置 Profile headers/credentials；插件只消费 `llm.listProviders()`、模型列表和可选解析信息 | 不复制官方 discovery 实现；验证 custom route / subagent route 只需做功能回归 |
| `conversation.chat.turnTail` / `turn-process` | **需运行验证** | slot owner 仍为 `{turn, seq, openFile}`；插件的 `owner.turn.data.get('turn-process')` 读取方式仍成立，但 keyed source/渲染时序尚未在 alpha.4 实机确认 | 保持 slot 注册；检查官方新 keyed source 下 turn data 更新时序 |
| conversation / composer slots | **需运行验证** | `conversation.composer.dock` 仍为 session list slot；插件使用的 settings/turn-tail 入口未被删除，但流式/窄屏布局尚未实测 | 不改注册协议；做窄屏与流式渲染视觉回归 |
| DOM stable hooks | **需运行验证** | alpha.4 主要加入 keyed chat sources、memoization、scroll sampling；静态上未发现插件当前稳定 data 属性/后缀被删除 | 不向 `COMPAT_BREAKS` 增加语义 API 名；执行真实页面回归 |
| Web tool defaults | **无影响** | `web_fetch` 默认开放范围扩大，Web PTC 默认不暴露 generic `workflow`；插件不注册/调用这些模型工具 | 仅在子代理/工具组合 E2E 中确认页面文案与工具列表符合预期 |
| 本仓库现有测试 | **需运行验证** | `npm test` 当前 311 tests 全部通过，但 fixture 仍含 `session.events` 和 `seedLength` 的 alpha.3 形状 | 把测试 fixture/API 迁移列入后续修复；不要把本次全绿写成 alpha.4 全面通过 |

## 1. alpha.4 官方变化概览

alpha.4 release 主要包含：

- 父 Agent 与 continuable child Agent 的邻接双向 follow-up，统一通过 `send_message`/steer；
- 自定义模型发现复用已配置 Profile 的 request headers 与 credentials；
- 模型目录搜索/筛选；
- UI 圆角、边框、turn navigation、阴影和长会话渲染性能改进；
- Python SDK、Headless、ACP 与 custom Profiles 默认启用 `web_fetch`；
- Web PTC 默认不再暴露 generic `workflow`；
- Session 读取模型重构：`Session.events` 改为按需 `eventAt()`、`snapshotEvents()`、`ownEvents()`；
- `SessionSeq` 与 `SessionLogOffset` 分离为不同 branded types；
- seed lineage 从公共 header 的 `seedLength` 改为 `isSeeded` 加独立的 `inheritedEventCount`。

完整发布说明见 [alpha.4 官方 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.4)，提交范围见 [alpha.3 → alpha.4 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.3...dsh-v0.1.2-alpha.4)。本次对比范围较大，关键迁移由以下提交落地：

- [`27bf1039db`：区分 event seq 与 log offset](https://github.com/deepseek-ai/deepseek-harness/commit/27bf1039dbb974be00cce8bd17d813c032fba6fb)；
- [`ec493c2db8`：统一邻接 Agent delivery on steer](https://github.com/deepseek-ai/deepseek-harness/commit/ec493c2db871e07b647c6b1db148b992b5e63f2d)；
- [`5257c75092`：model discovery 复用 Profile headers](https://github.com/deepseek-ai/deepseek-harness/commit/5257c75092)；
- [`5660f44d29`：分离 indexed 与 snapshot log reads](https://github.com/deepseek-ai/deepseek-harness/commit/5660f44d29f47fca2612c92ecffe6fb699c486f1)；
- [`577f0cf7d9`：renderer 绑定 keyed chat sources](https://github.com/deepseek-ai/deepseek-harness/commit/577f0cf7d9f4f88c794c3d2d82c61e3550827b62)；
- [`e32437d18b`：节流 scroll geometry sampling](https://github.com/deepseek-ai/deepseek-harness/commit/e32437d18b4aa2c9c4feda530b9cdda49dcb75f6)。

## 2. 已确认直接影响：live `Session.events` 已移除

### 2.1 官方契约

alpha.3 的 `Session` 仍提供 `get events(): readonly SessionEvent[]`。alpha.4 删除该 getter，改为：

- `eventAt(seq)`：读取一个精确事件；
- `snapshotEvents(fromSeq?, toSeqExclusive?)`：读取稳定快照/范围；
- `ownEvents()`：读取 fork cut 之后的 child-owned 事件；
- `seq`：下一个事件的 `SessionLogOffset`。

官方源码还把 `requestHeader()` 的实现说明从 `foldRequestHeader(session.events)` 改为 `foldRequestHeader(session.snapshotEvents())`，表明这是实际 public API 迁移而不是仅类型注释变化。

来源：[alpha.4 Session core source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/core/session/src/index.ts)，以及 [alpha.3 → alpha.4 Session diff](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.3...dsh-v0.1.2-alpha.4#diff-c55cc5fb6a)。

### 2.2 插件命中位置与运行后果

本仓库 [`index.js`](../../index.js) 的 `lastSubagentTurn()` 目前是：

```js
const events = parent?.session?.events
if (!Array.isArray(events)) return undefined
```

它由 `buildSubagentDispatchRecord()` 调用；该记录随后进入 `subagent-dispatches` RPC，客户端在 [`src/client.js`](../../src/client.js) 中按 `record.turn` 建立 `turn` 索引。alpha.4 下 `parent.session.events` 为 `undefined`（或 getter 不存在），函数直接返回 `undefined`，因此：

- 子代理创建和路由注入仍有机会成功，因为记录失败被包在 try/catch 中，设计为不影响派发本体；
- 派发记录可能缺少 `turn`；
- 回合尾 `turn-process` 仍可识别有子代理，但按回合拿不到对应 route record，子代理模型行可能消失或不完整；
- 会话级累计模型行会继续显示有 `turn` 的其他记录，但缺 turn 的记录只能进入 raw list，无法被回合尾关联。

### 2.3 推荐修复方向

建议在 Host 侧用 alpha.4 可用的 `parent.session.snapshotEvents()` 替代直接 getter，并保留当前 bounded reverse scan。实现时仍应防御旧宿主/测试 double：

```js
const events = typeof parent?.session?.snapshotEvents === 'function'
  ? parent.session.snapshotEvents()
  : parent?.session?.events
if (!Array.isArray(events)) return undefined
```

若插件仍需兼容旧版本，这个 feature-detect 回退比无条件调用更安全；如果目标明确锁定 alpha.4，则直接用 `snapshotEvents()` 并更新 fixture。不要用 `ownEvents()`：本扫描需要依据父会话最近一次 `data.turn`，而不只读 child-owned prefix。

## 3. 已确认直接影响：`seedLength` 公共字段退出 header

### 3.1 官方 `SessionHeader` 与验证逻辑

alpha.4 `SessionHeader` 定义 `isSeeded: boolean`，并把 exact fork prefix length 放在 `Session.inheritedEventCount` / body-bearing persistence result 中。`validateSessionHeader()`：

- 如果输入对象含 `seedLength`，直接抛 `session header has invalid field "seedLength"`；
- 如果 `isSeeded` 不是 boolean，抛 `session header isSeeded must be a boolean`。

来源：[alpha.4 Session types](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/core/session/src/types.ts)、[alpha.4 Session source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/core/session/src/index.ts)。

### 3.2 persistence/query 返回形状

alpha.4 persistence seam 将：

- `SessionInspection` 扩展为 `{ meta, inheritedEventCount, events }`；
- `SessionEventSuffix` 定义为 `{ meta, inheritedEventCount, fromSeq, events }`；
- `readFrom(id, fromSeq)` 的参数改为 `SessionLogOffset`，返回 `SessionEventSuffix`；
- `listSnapshots()` 仍返回 `{ header, revision }`，但 `header` 是逻辑 `SessionHeader`，不含 `seedLength`。

`sessionQuery.readSession(id)` **仍返回** `{ session, inheritedEventCount, events }`；这里 `events` 没有被删，只是 snapshot 多了 inherited metadata。插件 `viewSessionPage()` 读取 `snapshot.events` 的方向仍然正确。

来源：[alpha.4 persistence Service Definition](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session/session-persistence/src/index.ts)、[alpha.4 `SessionQueryEngine.readSession`](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session-query/session-query/src/index.ts)、[alpha.4 query types](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session-query/session-query/src/types.ts)。

### 3.3 插件命中位置与风险

本仓库用量索引在三处依赖 `record.header.seedLength`：

```js
const session = previous || {
  lastSeq: Math.max(0, record.header.seedLength || 0) - 1,
  ...
}

if (event.seq < (record.header.seedLength || 0)) continue

const fromSeq = previous === undefined
  ? Math.max(0, record.header.seedLength || 0)
  : previous.lastSeq + 1
```

alpha.4 的 `listSnapshots()` 仍保留 header/revision，但没有精确 cut；精确 cut 只在 body-bearing read 返回。对此处不能简单把 `header.isSeeded ? 0 : ...` 当替换，因为 `isSeeded` 只表示“存在 fork 前缀”，不表示前缀长度。

推荐方向：

1. 首次建立索引时调用 `readFrom(id, SessionLogOffset(0))`，从其返回的 `inheritedEventCount` 得到精确 cut；
2. 从 `inheritedEventCount` 开始折叠，跳过 `event.seq < inheritedEventCount` 的继承事件；
3. 后续按 revision 读取 `previous.lastSeq + 1`，把数值转换为 alpha.4 语义要求的 `SessionLogOffset`（运行时 brand 是数字，仍应按公开 contract 传合法非负 safe integer）；
4. 如要把 `readFrom` 返回的 `fromSeq`、`meta`、`inheritedEventCount` 一起作为一致性校验，优先使用返回字段，不从 header 或 event 数量推断 seeded cut。

> 注意：alpha.4 JSONL provider 的**物理磁盘 header 仍可以写 `seedLength`**，用于保持 v0 字节兼容；读取时会转换为逻辑 `meta.isSeeded` 和 `inheritedEventCount`。因此不能把“任何源码中出现 seedLength”写成 JSONL 物理格式删除；本插件读的是 `listSnapshots()` 的逻辑 header，命中的是公共 API 迁移。

来源：[alpha.4 JSONL format source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session/session-persistence-jsonl/src/format.ts)、[alpha.4 JSONL README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session/session-persistence-jsonl/README.zh.md)。

## 4. persistence 与会话管理的其余影响

### 4.1 `readFrom()` 返回 richer suffix：需检查而不是误判为断裂

本插件已有 `readFrom()` 调用，alpha.4 的主要变化是签名与返回值：旧形状是 `{ meta, events }`，新形状是 `{ meta, inheritedEventCount, fromSeq, events }`，且 offset 参数属于 `SessionLogOffset`。

当前插件只取 `read.events`，所以在 JavaScript 运行时即便没有类型检查也能继续拿到事件；但它仍使用旧 `header.seedLength` 做起始位置，正是上节的实际问题。新返回的 `inheritedEventCount` 应进入索引逻辑，并加入 seeded fixture。

`listSnapshots()`、`locate()` 和 `readRaw()` 的方法名及职责仍保留。alpha.4 JSONL provider 继续用 `locate(meta)` 给出物理路径，`readRaw()` 返回带 `meta`、`inheritedEventCount` 的 raw artifact。备份代码可以继续只取 `.content`，会话目录定位继续只取 `.path`。

### 4.2 会话 query 的完整快照保持 `events`

本插件的会话详情、搜索和标题缓存使用 `sessionQuery.readSession()`/`filterEvents()` 等后端无关 seam。官方 `readSession()` 仍把经过 replay 校验的完整原始事件数组放在 `events`；新增的 `inheritedEventCount` 不会让当前 `viewSessionPage()` 失效。`filterEvents()` 同样继续从已加载事件建立语义文档。

所以迁移时应精确修改 live Session 直接访问和 seeded offset，不要做无根据的全局 `events` 替换。

## 5. 子代理 continuation 与插件路由 seam

alpha.4 将 continuable child 与父 Agent 的消息传递统一成邻接 Agent 的双向 `sendMessage(sender, targetId, content, options)`，运行中的目标使用 steer，在 idle 目标启动下一轮；原 alpha.3 的 `followup(parent, childId, ...)` 与 `reportFrom(child, ...)` 不再是同一套公开方向。官方 `start()` 与 `startContinuable()` 仍存在，continuable provider 的创建流程仍由 `startContinuable()` 处理。

本插件的子代理功能是包装 `ctx.subagents.start` 和 `ctx.subagents.startContinuable`，在创建请求未显式指定 provider/model/reasoning effort 时做路由注入，并监听 `agent/created` 记录实际路由。它没有直接调用 `followup`、`reportFrom` 或 `sendMessage`，因此没有发现需要改方法名的直接代码命中。

但行为关联仍然存在：

- alpha.4 的 continuable child 会把后续 Agent message 与 settlement notice 统一接入 steer/inbox；
- 官方工具描述明确说明 continuable background child 可在完成后继续用 `send_message` 交互；
- 插件 turn-tail/dispatch record 依赖子代理创建回合与 `turn-process` 数据的时序。

建议验收：创建 one-shot 与 continuable child；父→子发送后续消息；子→父发送 message；子结算后父收到 notice；页面刷新/冷恢复后再次发送；同时检查 `subagent-dispatches` 的 provider/model/turn 记录。插件不应自行新增 `tool-subagent-report` 或模拟官方 continuation。

来源：[alpha.4 Subagent Service source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/subagent/subagent/src/index.ts)、[alpha.4 continuation source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/subagent/subagent/src/continuation.ts)、[alpha.4 tool-subagent source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/subagent/tool-subagent/src/index.ts)、[unified messaging commit](https://github.com/deepseek-ai/deepseek-harness/commit/ec493c2db871e07b647c6b1db148b992b5e63f2d)。

## 6. 模型发现、RPC 与 Client inject

### 6.1 自定义模型 discovery

alpha.4 的 [`5257c75092`](https://github.com/deepseek-ai/deepseek-harness/commit/5257c75092) 改动官方 `llm-pi-ai` discovery：已配置 route 的 profile headers 会合并进 `GET /models`，stored credential 仍惰性解析，表单临时输入的 key 优先。此变化属于官方模型配置页面与 `llm-pi-ai` 内部 seam。

本插件只使用 `ctx.get('llm')` 的 provider/model 列表、可选 `resolveModelInfo()`，并在子代理路由创建层注入选项；没有直接调用 `ctx.llm.discoverModels()`，所以没有直接兼容改动。模型清单或 credentials 缺席时，既有 feature-gate/错误降级仍应工作。

来源：[alpha.4 `llm-pi-ai` discovery diff](https://github.com/deepseek-ai/deepseek-harness/commit/5257c75092)、[alpha.4 `llm-pi-ai` README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/llm/llm-pi-ai/README.zh.md)。

### 6.2 Generic Connection RPC

官方 alpha.4 的 client Connection RPC 仍：

- 校验单层 channel 与 endpoint；
- POST `${channel}/${endpoint}`；
- 校验 `{type:'server-response', rpcId, result}`；
- `ok:false` 需要结构化 `{code, message, details}` error。

本插件 Host 继续用 `ctx.connection.rpc.handle('/dsh-service', dispatchRpc, { authority: 'loopback' })`，Client 继续调用 `ctx.connection.rpc.call('/dsh-service', endpoint, payload)`。因此没有发现 alpha.4 对现有 channel 或 failure envelope 的新 breaking change。

来源：[alpha.4 Connection RPC source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/client/connection/src/client/rpc.ts)、本仓库 [`index.js`](../../index.js) 和 [`src/client.js`](../../src/client.js)。

### 6.3 Client inject 与 composition

本仓库 [`package.json`](../../package.json) 的 `dsh.client.inject` 只有：

```json
[
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-api-remotes"
]
```

alpha.4 官方 Web composition 继续挂载这两个供应商，未发现旧 `@deepseek-ai/dsh-client-runtime` 重新出现或当前 inject supplier 被删除。`cordis.patch.yml` 仍只是插入本插件 Host/Client row，未依赖需更新的官方 row id。

来源：[alpha.4 web composition](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/bundle/web-app/cordis.patch.yml)、本仓库 [`package.json`](../../package.json) 与 [`cordis.patch.yml`](../../cordis.patch.yml)。

## 7. UI slots、keyed chat source 与 DOM 影响

### 7.1 `turnTail` 与 `turn-process`

alpha.4 `ui-chat` 仍声明：

```text
conversation.chat.turnTail: { kind: 'chain', scope: 'session', owner: TurnTailOwnerProps }
TurnTailOwnerProps = { turn, seq, openFile }
```

alpha.4 也仍保留 `conversation.composer.dock` 为 session-scoped list slot。alpha.4 的相关变化是给 chat node 与 turn-process 增加 keyed source、按源细分订阅并复用稳定 projection，属于性能与重渲染边界调整；没有移除插件使用的 slot 或 `owner.turn.data.get('turn-process')`。

本插件 `src/client.js`：

- 在 `conversation.chat.turnTail` 注册回合尾模型行；
- 在 `conversation.composer.dock` 注册会话级累计模型行；
- 使用稳定 data 属性和后缀选择器进行滚动/按钮定位，而非 alpha.4 新增的内部 keyed source API。

因此静态契约兼容，但需回归 streaming publication、turn-tail 显隐、长会话分页和窗口调宽。

来源：[alpha.4 ui-chat slot contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/client/ui-chat/src/client/contract/slots.ts)、[alpha.4 conversation contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/client/ui-conversation/src/client/contract/conversation.ts)、本仓库 [`src/client.js`](../../src/client.js)。

### 7.2 `COMPAT_BREAKS` 不新增 alpha.4 条目

本仓库 [`plugin-compat.js`](../../plugin-compat.js) 的扫描器只针对可静态发现的具体已移除 package/DOM identifier（如 `@deepseek-ai/dsh-client-runtime`、旧 CSS hash、`data-time-hover-root`）。alpha.4 的两处直接问题是语义 API 字段变化，不是本插件入口中能由旧标识扫描可靠发现的“旧包/旧 DOM token”。因此本次不新增扫描项；将 `Session.events`/`seedLength` 作为 scanner 条目会产生误报或无法证明迁移正确。

## 8. 测试与升级验收

### 8.1 当前测试结果

在本工作区运行 `npm test`：

```text
1..311
# tests 311
# suites 0
# pass 311
# fail 0
# cancelled 0
# skipped 0
```

这证明当前 alpha.3-era test doubles 与本插件现有代码一致，但不证明 alpha.4 contract 兼容；当前 fixtures 中仍可见：

- `test/host.test.js` 的 dispatch fixture 使用 `parent.session.events`；
- fork usage fixture 使用 `header.seedLength`。

### 8.2 必须追加的 alpha.4 回归用例（修复时执行）

1. **Dispatch turn**：session 只提供 `snapshotEvents()` 的 alpha.4-shaped parent；创建派发记录后必须保留正确 `turn`，并确认旧 fixture fallback（如仍支持 alpha.3）不破坏。
2. **Usage unseeded**：`isSeeded:false`、`inheritedEventCount:0`，首次/增量读取不丢事件、不重复累计。
3. **Usage seeded**：`isSeeded:true` 且 `inheritedEventCount > 0`，继承 prefix 不计入 child usage；revision 变化时从 `lastSeq + 1` 读取且不重新计 inherited prefix。
4. **Persistence suffix**：stub `readFrom()` 返回 `{ meta, inheritedEventCount, fromSeq, events }`，确认插件只使用事件后缀并按新 cut 折叠。
5. **Session detail**：`readSession()` 返回新增 inherited field 但仍有 `events`，详情/搜索/标题缓存不回归。
6. **Continuable messaging**：覆盖父→子、子→父、idle/waking/steer、settlement notice 与 cold resume。
7. **UI**：覆盖 desktop long session、older pagination、官方 turn rail 与插件 arrow 共存、窄屏 composer/settings overlay、streaming turn-tail。

### 8.3 推荐升级顺序

- 升级前备份 `$DSH_HOME`；若从更旧版本迁移，确认 JSONL persistence 可读；
- 先在隔离 profile 验证插件 Host/Client fiber active 与 `dsh.client.inject` supplier；
- 先验证 `sessions-list/view/search/export`、backup、usage，尤其 seeded/fork 会话；
- 再验证 one-shot/continuable subagent 及 `subagent-dispatches`；
- 最后做长会话桌面与窄屏 UI、慢连接/真实断线回归。

## 9. 最终建议

- **不要把 alpha.4 标为无影响。** 当前静态审计已经找到 `Session.events` 与 `header.seedLength` 两处直接业务命中。
- **本次不修改业务代码**，但应尽快安排一个兼容修复提交：优先修复 `lastSubagentTurn()`，再迁移 usage index 的 seeded cut 读取与 `readFrom()` 返回结构；同时更新相关测试 fixture。
- `readSession().events` 不需要删除或替换；JSONL 物理 header 中仍可能有 `seedLength`，但公共逻辑 header 不再有该字段，二者必须区分。
- 不改当前 inject roster、`/dsh-service` channel、turn-tail/composer slot 注册或稳定 DOM selector；不向 `COMPAT_BREAKS` 添加未经验证的 alpha.4 token。
- `npm test` 已通过 311/311，但在上述 API 迁移完成并执行 alpha.4-shaped tests 前，不应宣称端到端兼容。

## 10. 官方来源索引

1. [alpha.4 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.4)
2. [alpha.3 → alpha.4 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-alpha.3...dsh-v0.1.2-alpha.4)
3. [alpha.4 Session core source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/core/session/src/index.ts)
4. [alpha.4 Session types](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/core/session/src/types.ts)
5. [alpha.4 persistence Service Definition](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session/session-persistence/src/index.ts)
6. [alpha.4 JSONL format source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session/session-persistence-jsonl/src/format.ts)
7. [alpha.4 JSONL persistence README](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session/session-persistence-jsonl/README.zh.md)
8. [alpha.4 session-query source](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session-query/session-query/src/index.ts)
9. [alpha.4 session-query types](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/session-query/session-query/src/types.ts)
10. [alpha.4 Connection RPC](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/client/connection/src/client/rpc.ts)
11. [alpha.4 Subagent Service](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/subagent/subagent/src/index.ts)
12. [alpha.4 continuation manager](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/subagent/subagent/src/continuation.ts)
13. [alpha.4 tool-subagent](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/subagent/tool-subagent/src/index.ts)
14. [alpha.4 ui-chat slot contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/client/ui-chat/src/client/contract/slots.ts)
15. [alpha.4 conversation contract](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/client/ui-conversation/src/client/contract/conversation.ts)
16. [alpha.4 web composition](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/dsh-v0.1.2-alpha.4/packages/bundle/web-app/cordis.patch.yml)
17. [commit `27bf1039db`](https://github.com/deepseek-ai/deepseek-harness/commit/27bf1039dbb974be00cce8bd17d813c032fba6fb)
18. [commit `ec493c2db8`](https://github.com/deepseek-ai/deepseek-harness/commit/ec493c2db871e07b647c6b1db148b992b5e63f2d)
19. [commit `5257c75092`](https://github.com/deepseek-ai/deepseek-harness/commit/5257c75092)
20. [commit `5660f44d29`](https://github.com/deepseek-ai/deepseek-harness/commit/5660f44d29f47fca2612c92ecffe6fb699c486f1)
21. [commit `577f0cf7d9`](https://github.com/deepseek-ai/deepseek-harness/commit/577f0cf7d9f4f88c794c3d2d82c61e3550827b62)
22. [commit `e32437d18b`](https://github.com/deepseek-ai/deepseek-harness/commit/e32437d18b4aa2c9c4feda530b9cdda49dcb75f6)
23. [本仓库 package.json](../../package.json)
24. [本仓库 cordis.patch.yml](../../cordis.patch.yml)
25. [本仓库 index.js](../../index.js)
26. [本仓库 src/client.js](../../src/client.js)
27. [本仓库 plugin-compat.js](../../plugin-compat.js)
28. [本仓库 test/host.test.js](../../test/host.test.js)
