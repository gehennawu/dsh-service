# DSH/Cordis agents/jobs/session 事件与客户端会话订阅调研

> 范围：本机安装的 `@deepseek-ai/dsh@0.1.1-rc.2` 及其一方 `@deepseek-ai/*` 包产物；辅查当前 `/workspace/projects/dsh-service`。仅读源码/包内 README；未修改功能代码。
>
> 说明：本机安装包主要只带编译后的 `lib/` 与类型声明，没有对应包的 `src/` 源目录；以下行号以已安装产物为准。

## 结论摘要

1. 客户端 `ctx.sessions.list` 是一个 `ObservableSnapshot<SessionListState>`，不是数组；用 `getSnapshot()` 读，用 `subscribe(listener)` 订阅，返回取消订阅函数。
2. 客户端列表行明确有父子识别：`parentId?: SessionId` 与 `origin?: 'subagent'`。普通根会话通常无这两个字段；`origin` 是粗粒度子代理来源分类，`parentId` 是直接父会话。不要依赖标题、ID 前缀或缩进。
3. Host 的 `session.list` 使用同一信息的 wire 名：`parentSessionId?` 与 `origin?: 'subagent'`；`host/session-added` 也携带这两个字段。运行状态另由 `host/session-status` 推送。
4. DSH 的子代理创建同时写入 durable `SessionHeader.parentSession`、`origin: 'subagent'`、`delegationDepth`；`subagent/descriptor` 事件再区分 `one-shot`/`continuable`。因此可以可靠区分根/子代理及子代理模式。
5. Agent 运行时还有另一条“根”概念：`AgentRegistry.roots()` 按运行时 owner 是否存在判断，而不是按 durable `parentSession`；源码明确说 resumed fork 仍可能是 runtime root。做根/子代理策略时应先选择 durable lineage 还是 runtime ownership。
6. jobs 不以独立 Cordis `job/*` 事件暴露；通过 `ctx.jobs.onJobsChanged()`/`onJobDone()` 观察，再由 Host mux 转成 `session/jobs` 全量快照。`JobView` 的 frame 外层 `sessionId` 是关联键；`kind: 'subagent'` 只是生产者类型，不能单独证明会话是子代理。
7. `agents/jobs/session` 不在应用的通用 Host-event 转发白名单中，不能通过 `ctx.remote.$on` 收到这些 Host 事件；客户端只能用 sessions runtime 的两条事件流及其列表快照。

## 1. 客户端 `ctx.sessions.list` 契约与字段

### 1.1 对外类型与订阅协议

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/contract/sessions.d.ts:19-24`

```ts
export interface ISessions {
  readonly list: ObservableSnapshot<SessionListState>;
  readonly currentProvideInfo: HostObservable<SessionMaybeProvideInfo>;
}
```

`ObservableSnapshot` 的最小协议见
`.../dsh-client-runtime/lib/types/client/contract/store.d.ts:3-6`：

```ts
getSnapshot(): T;
subscribe(fn: () => void): () => void;
```

**文件** `.../dsh-client-runtime/lib/types/client/sessions/service.d.ts:67-85`

```ts
export interface SessionListState {
  ids: SessionId[];
  byId: Record<SessionId, SessionSummary>;
  current: SessionId | undefined;
  phase: SessionListPhase;
  subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>;
  jobsBySession: Readonly<Record<SessionId, readonly JobView[]>>;
  currentAddress: SubagentAddress | undefined;
}
```

同文件 `:29-60` 的客户端 `SessionSummary` 字段：

- `id`
- `title?`
- `displayTitle`
- `cwd?`
- `agentPreset?`
- `parentId?`
- `origin?: 'subagent'`
- `running`
- `pendingInteraction?: 'approval' | 'plan-review' | 'question'`
- `completed?`
- `blank`
- `updatedAt`
- `projectionValues?`

`parentId` 注释是“直接父会话”；`origin` 注释是“粗粒度 durable origin，用于导航过滤，不是 continuation capability”。

### 1.2 Host 行到客户端行的字段投影

**Host wire 契约** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/sessions.d.ts:176-221`：

- `sessionId`
- `updatedAt`
- `running`
- `blank`
- `parentSessionId?`
- `origin?: 'subagent'`
- `cwd?`
- `agentPreset?`
- `projections?`

**Host schema** `.../dsh-host-apiproxy/lib/types/api/sessions.schema.js:30-40` 同样严格允许 `parentSessionId` 和 `origin`。

**Host 生成摘要** `.../dsh-host-apiproxy/lib/types/api-proxy.js:380-402`：

```js
function sessionListFields(header, events = []) {
  return {
    ...header.parentSession === undefined ? {} : { parentSessionId: header.parentSession },
    ...header.origin === undefined ? {} : { origin: header.origin },
    ...header.cwd === undefined ? {} : { cwd: header.cwd },
    ...agentPreset === undefined ? {} : { agentPreset },
  };
}
```

`summarize()` 在 `:393-402` 将其并入 `session.list` row。

**客户端投影** `.../dsh-client-runtime/lib/client.js:9216-9237` 将 wire 字段复制为列表行：

```js
parentId: entry.parentSessionId,
origin: entry.origin,
running: entry.running,
pendingInteraction: entry.pendingInteraction,
```

（实际代码对 optional 字段使用条件展开。）这证明 `ctx.sessions.list.getSnapshot().byId[id].origin` / `.parentId` 是官方投影，不是插件自行推导。

### 1.3 列表层级不是靠 origin 单独推导

**文件** `.../dsh-client-runtime/lib/client.js:5593-5634` 的 `flattenLineage()`：

- 先按 `sessionId` 建索引；
- 只要 `parentSessionId` 存在且父 ID 在当前摘要集合，就挂到 `children`；
- 无父或父缺失的行作为根；
- 输出 `depth`，根为 0；
- 有环时警告并停止该支路。

所以普通 fork 也可能按 `parentSessionId` 形成列表树；“子代理来源”仍应看 `origin === 'subagent'`。包 README 进一步说明 `indexSubagentDescendants()` 只沿不间断的 `origin: 'subagent'` 链统计（`.../dsh-client-runtime/README.md:31`）。

### 1.4 客户端订阅/通知实现

**文件** `.../dsh-client-runtime/lib/client.js:5637-5718` 的 `Notifier`：

- `subscribe(listener)` 把 listener 放入 `Set`，返回删除该 listener 的 disposer（`:5651-5659`）；
- `markDirty()` 标脏并安排 microtask（`:5661-5667`）；
- `notifyNow()` 取消已排程并立即 flush（`:5675-5684`）；
- `ensureFresh()` 在未订阅读取前同步重建 snapshot（`:5685-5693`）；
- flush 时重建 snapshot，再逐个调用 listeners（`:5709-5718`）。

`SessionRuntime` 构造与发布：

- `.../dsh-client-runtime/lib/client.js:8897-8948` 创建 `list` store，初始字段含 `ids/byId/current/phase/subagentsByParent/jobsBySession/currentAddress`；manager 变更会 `projectList()`；list 变更会跟随当前会话并发布 provide projection；最后 `rootCtx.reflect.provide('sessions', this, void 0)`。
- `.../dsh-client-runtime/lib/client.js:9216-9284` 的 `projectList()` 从 manager snapshot 生成 `ids/byId`，同时合并当前 catalog-addressed child，之后调用 `this.list.set(...)`。
- `.../dsh-client-runtime/lib/client.js:8247-8261` 的 `recordMutation()` 立即修改 manager 摘要并标脏；`subscribe()` 是对 manager notifier 的直接入口。

包内 README (`.../dsh-client-runtime/README.md:1-5,17-35`) 也明确：runtime 将 Host stream 分发到 Session/Workspace owner；`ctx.sessions.list` 是 metadata/list mirror；domain 包通过 owner events 决定缓存失效。

## 2. Host 事件与客户端两条订阅流

### 2.1 API 事件流契约

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/events.d.ts:43-60`

```ts
mux(request, signal): AsyncIterable<RpcRequest<MuxFrame>>;
host(request, signal): AsyncIterable<RpcRequest<HostFrame>>;
```

- `mux`：全会话聚合流。打开时对每个 attached session 发送 subscribed 控制帧，并重放仍 pending 的 approval/question；v1 的 `since` 被忽略，重连靠重开流 + history refetch。
- `host`：Host-level 信息流，承载 session create/destroy、running-status flip、agent failure（无 turn position）。

**Mux frame 类型** `.../events.d.ts:63-145`：

- `session/event { sessionId, event, view? }`
- `session/subscribed { sessionId, lastSeq }`
- approval/question requested/resolved
- `session/queue { sessionId, items }`
- `session/jobs { sessionId, jobs }`
- `session/projection { sessionId, key, value, seq }`

**Host frame 类型** `.../events.d.ts:147-194`：

- `host/session-added { sessionId, blank, parentSessionId?, origin?, cwd?, agentPreset? }`
- `host/session-removed { sessionId }`
- `host/session-status { sessionId, running }`
- `host/agent-error { sessionId, message }`

Schema 也逐字段确认：`.../dsh-host-apiproxy/lib/types/api/events.schema.js:33-58` 和 `:59-83`。

### 2.2 Host 如何把 Cordis/Service 事件转成流

**文件** `.../dsh-host-apiproxy/lib/types/api-proxy.js:305-333`：`frame(payload)` 为 push 生成 rpcId；`subscribeSession()` 用 `session.seq - 1` 发送 `session/subscribed`。

**mux 打开和基线** `.../api-proxy.js:3056-3097`：

- 注册 `FrameQueue`；
- 遍历 `ctx.sessions.list()` 为每个 live session 发送 subscribed；
- replay pending questions/approvals；
- 对 inbox pending 的 agent 发送 `session/queue`；
- 对 `ctx.jobs` 存在时发送非空 `session/jobs` baseline。

**mux 事件监听** `.../api-proxy.js:3098-3159`：

- `ctx.on('session/event', ...)`：缓存 tool call args，生成 view，再推 `session/event` (`:3103-3120`)；
- `ctx.on('session/created', ...)`：推 `session/subscribed`，并为新 session 补非空 jobs baseline (`:3122-3131`)；
- `ctx.on('session/disposed', ...)`：清理 open-call table (`:3133-3135`)；
- `jobs.onJobsChanged(owner)`：owner 非空只推该 owner 的 `session/jobs`；unowned job 变化则遍历所有 session 推送各自可见集合 (`:3136-3153`)；
- `FrameQueue.iterate(signal, disposer)` 在流关闭时移除 queue、执行上述 disposers (`:3155-3159`)。

**host 流监听** `.../api-proxy.js:3161-3190`：

```js
ctx.on('session/created', session => host/session-added);
ctx.on('session/disposed', session => host/session-removed);
ctx.on('agent/status', ({agent, status}) => host/session-status);
ctx.on('agent/error', ({agent, error}) => host/agent-error);
```

`host/session-added` 的字段由 `sessionListFields(session.header, session.events)`（`:3171-3180`）提供，故父子字段在 session-created 事件当场就会推给客户端。

**客户端 stream wiring** `.../dsh-client-runtime/lib/client.js:10489-10531`：

```js
const sessions = new SessionRuntime(ctx, connection.api, ctx.remote, conversation);
const loop = connection.start({
  onMuxEnvelope: envelope => sessions.handleMuxEnvelope(envelope),
  onHostEnvelope: envelope => {
    sessions.handleHostEnvelope(envelope);
    workspaces.handleHostEnvelope(envelope);
    if (frame.type === 'host/remote-event') ctx.remote.$dispatch(...);
  },
  onConnected: () => { sessions.handleConnected(); ... },
  onStateChange: state => { if (state === 'reconnecting') sessions.handleDisconnected(); }
});
```

`.../dsh-client-connection/lib/client.js:25-31,74-95` 说明 ConnectionController 同时 pump 两条流、断线重连，并把帧送到两个 sink。

**客户端 manager 消费** `.../dsh-client-runtime/lib/client.js:8294-8353`：

- `session/event` 更新活动时间并转给已实例化 Session；未实例化的非 pending 帧丢弃，打开时由 history 回填；
- `session/projection` 更新 per-session projection store；
- `session/jobs` last-wins 更新 `jobsBySession`，空数组删除 key；
- `session/subscribed` 清 projection/jobs mirror 并清理 queued baseline；
- approval/question 更新 `pendingInteractions`。

`.../client.js:8355-8423` 消费 Host 帧：

- `host/session-added` upsert row，复制 parent/origin/cwd/agentPreset；若是 subagent 还标记父 catalog 可展开并安排刷新 (`:8362-8375`)；
- `host/session-removed`：普通会话移除，durable subagent 保留 row 但 `running:false`，清 jobs/interactions (`:8377-8408`)；
- `host/session-status` 更新 running 和 catalog activity (`:8410-8417`)；
- `host/agent-error` 写入 Session error (`:8419-8421`)。

## 3. Session / Agent / Jobs 的事件与观察接口

### 3.1 `dsh-session` durable session events

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts:28-76` 声明 Cordis Events：

- `session/created(session)`：发布时 creation announcement；scope-filtered；同步 listener 可 veto。
- `session/disposed(session)`：已 announce 的 session 离开 store；包含 rollback disposal。
- `session/event(session, event)`：post-commit append feed，事件已提交后 fire-and-forget；scope-filtered。
- `session/flush(session)`：并行等待的 durability checkpoint。

具体 store 生命周期见 `.../dsh-session/lib/index.js:1672-1829`：`enter()` 只挂载不 announce；`announce()` 发 `session/created`；detach 后 `session/disposed`；`flush()` 通过 captured scope carrier 调度 `session/flush`；`list()` 返回当前 live sessions (`:1824-1829`)。

`session/event` 的持久化约定写在 `.../dsh-session/lib/types/index.d.ts:1-4`：持久化插件订阅 `session/event`，在 `session/flush` drain。

### 3.2 `dsh-agent` live runtime events

**文件** `.../dsh-agent/lib/types/runtime-types.d.ts:134-321`：

- `agent/created`, `agent/disposed`, `agent/status` (`idle`⇄`running`)；
- inbox `agent/inbox/inserted`, `agent/inbox/claimed`, `agent/inbox/discarded`；
- `agent/session-start`（startup/resume/clear/compact）；
- `agent/pre-step`（waterfall）、`agent/request`（waterfall）、`agent/request-error`（waterfall）、`agent/turn-stopping`（serial）；
- `agent/error`（含 `agent`, `turn`, `step`, `error`）。

这些事件均是 `this: Scoped<Agent>` 并以 payload `agent` 为 subject；`.../dsh-agent/lib/types/dispatch.d.ts:17-53,74-101` 说明 `agentEvents()` 将 agent subject 与 scope carrier 融合，避免 subject 和 scope key 不一致。

Agent 运行状态实际由 `dsh-agent-loop` 发出：`.../dsh-agent-loop/lib/index.js:380-389` 在 status 翻转时 `dispatch.emit('agent/status', {status})`；`throwError()` 在 `:466-475` 发 `agent/error`。

### 3.3 jobs：服务观察器，不是 `ctx.on('job/*')`

**抽象服务契约** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-jobs/lib/types/index.d.ts:45-142`：

- `start(spec)`、`list(caller?)`、`get/read/kill/wait`；
- `onJobDone(listener)`：完成时通知；
- `onJobsChanged(listener)`：每次可见集合改变通知；
- `attachController(name)`。

**本地实现** `.../dsh-jobs-local/lib/index.js:261-270` 将两个监听器分别挂到 effect-scoped layer；`settle()` 先提交 terminal record、通知 waiters/changed，再调用 onJobDone (`:357-386`)。

**owner 隔离** `.../dsh-jobs/lib/types/types.d.ts:85-145`：`JobSnapshot.ownerSession?` 是授权/关联字段；`JobsChangedListener` 接收 exact owner 或 unowned `undefined`。本地实现 `.../dsh-jobs-local/lib/index.js:309-345` 按 owner 的 session id 做访问和监听层级隔离。

**wire view** `.../dsh-host-apiproxy/lib/types/api/jobs.d.ts:1-35`：`JobView` 仅包含 `id/kind/label/status/detail?/startedAt/finishedAt?`。注释明确 `ownerSession` 被省略，因为 frame 自带 `sessionId`；`reported`、`outputLimitBytes` 也被省略。

因此客户端 `jobsBySession` 只应按 `session/jobs.sessionId` 关联到会话；缺 key 表示空集合。包 README `.../dsh-client-runtime/README.md:33` 说明 `session/jobs` 是 last-wins 全量快照，`session/subscribed` 与 `host/session-removed` 都会清除镜像。

## 4. 根会话 / 子代理区分字段和事件

### 4.1 Durable SessionHeader（最可靠的 lineage 字段）

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts:40-77`：

- `parentSession?: SessionId`：从哪个会话 fork/seed；根会话通常无此字段；
- `seedLength?`：前缀继承边界；
- `origin?: 'subagent'`：子代理粗分类，明确“不是 proof that child is continuable”；
- `delegationDepth?`：顶层 absent/zero，子代理为父 depth + 1，持久化以跨重启保留递归预算；
- `agentPreset?`。

Host 将上述 lineage 的 `parentSession`/`origin` 投影为 `parentSessionId`/`origin`（见第 1.2 节）。客户端再投影为 `parentId`/`origin`。

### 4.2 子代理创建时确实写入这些字段

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js:486-540`：

- `resolveChildDepth()` 按 parent depth + 1 (`:486-490`)；
- `childSessionMeta()` 返回 `parentSession: parentHeader.id`, `origin: 'subagent'`, `delegationDepth: childDepth`，并可含 `seedLength` (`:530-540`)。

直接子代理枚举：

- `.../dsh-subagent/lib/index.js:1715-1718` 过滤 `record.header.parentSession === parentSessionId && record.header.origin === 'subagent'`；
- `.../dsh-subagent/lib/types/list-children.d.ts:21-79` 说明只有 durable header `origin:'subagent'` 的 candidate 才解释为 child；direct parent 是 `parentId`，并区分 `one-shot`/`continuable`。

### 4.3 `subagent/descriptor` 事件：区分子代理模式

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/descriptor.d.ts:1-78`：

- `subagent/descriptor` 是 model-hidden、durable、只追加一次的 session event (`:25-35`)；
- shared fields：`version`, `mode: 'one-shot'|'continuable'`, `provider` (`:43-52`)；
- one-shot 可有 `label`；continuable 必有 `label`，并可存 provider/model/persona/toolFilter (`:53-75`)。

该事件是“已判为子代理后，识别模式/续接组成”的 durable seam，不应取代 `parentSession`/`origin` 做根判断。

### 4.4 Runtime Agent 的“根”是另一维度

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/types/index.d.ts:298-370`：

- `AgentRegistry.enter(agent, owner)` 的 `owner` 是创建该运行时 agent 的 live parent agent；注释明确这是 runtime ownership，不是 resumed session 的 durable parent lineage (`:317-331`)；
- `roots()` 返回 `owner === undefined` 的 live agents；注释明确 durable lineage 不影响该结果，resumed fork 仍可能是 runtime root (`:360-370`)。

实现见 `.../dsh-agent/lib/index.js:601-716`：entry 保存 `owner`，`isOwnedBy()` 按 exact owner 比较，`roots()` 过滤 `entry.owner === void 0`。

这意味着：

- 若要“用户看到的主会话/子代理”，使用 client list `origin`/`parentId`；
- 若要“当前进程内谁由谁创建/授权”，使用 Agent runtime owner / `isOwnedBy()`；
- 两者不能互换。

### 4.5 Client scope 也沿 session/agent 1:1

**文件** `.../dsh-client-runtime/lib/types/client/contract/sessions.d.ts:103-126`：

- `scope(id)` 返回以 session id 为键的 `AgentContext`；
- `scopeOf(ctx)` 在 root context 返回 `undefined`，在 Agent-scoped context 返回 session id；
- `sessionOf(ctx)` 返回对应 SessionFace。

`.../dsh-client-runtime/lib/types/client/sessions/service.d.ts:2-15` 说明 client agent scope 是“一 session 一个 scope，agent id === session id”。这适合判断当前代码是否位于 session scope，但不是 Host durable lineage 的替代。

## 5. Host 通用 remote-event 白名单限制

**文件** `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-remotes/lib/types/remote-events.js:9-28`：

```js
export const API_REMOTE_FORWARDED_EVENTS = [
  'agent-preset/selected', 'commands/change',
  'credentials/reference-updated', 'cordis/request-run', ...,
  'settings/document-updated'
];
```

列表没有 `session/*`、`agent/*`、`job/*`。`.../dsh-host-apiproxy/lib/types/api/events.d.ts:196-203` 说明只有 allowlisted Host Cordis events 会包装为 `host/remote-event`，在客户端落到 `ctx.remote.$on`；因此 sessions/agents/jobs 不应尝试用 `ctx.remote.$on` 订阅，使用 sessions list / mux / host stream。

## 6. 当前插件侧佐证（未修改）

当前 `/workspace/projects/dsh-service/index.js:1824-1895` 是 quota HTTP 请求，无 agents/jobs/session 逻辑；插件真正使用 client list 的观察器在
`/workspace/projects/dsh-service/client.js:1825-1888`（已有仓库调研记录 `docs/research/notification-subagent-completion.md:32-47`）。该观察器读取 `ctx.sessions.list.getSnapshot()` 并订阅 `ctx.sessions.list.subscribe()`；已有记录正确指出当前插件完成通知没有按 `summary.origin` 过滤。

## 路径访问说明

- 可访问：`/workspace/projects/dsh-service` 及 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*` 的已安装 `lib/`、`.d.ts`、包内 README。
- 不可见/不存在：上述已安装包对应的 TypeScript `src/` 目录（对各相关包执行路径 glob 均无结果）；因此不能提供未打包源码行号，只能引用发行包编译产物及类型声明。
- 未使用外网；本报告没有引用第三方文章或非官方二手资料。
