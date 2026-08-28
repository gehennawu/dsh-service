# 通知功能是否可以不通知子代理的完成任务

> 调研范围：`@gehennawu/dsh-service` 当前工作区代码，以及本机安装的 DSH `0.1.1-rc.2` 运行时源码。结论针对“任务完成通知”这一类，不等同于屏蔽所有子代理相关状态通知。

## 结论

**可以实现，但当前版本还没有实现。**

当前插件的完成通知逻辑会对 `ctx.sessions.list` 中观察到的所有会话执行 `running → idle` 边沿检测；条件中没有检查 `origin`、`parentId` 或其他子代理标记。因此，`origin: 'subagent'` 的子代理从运行中变为空闲时，当前代码也会发出“任务完成”浏览器通知。

实现“主会话完成才通知、子代理完成不通知”不需要新增 Host RPC、修改 DSH 事件转发白名单或改变会话状态源。DSH 客户端会话快照已经提供稳定的子代理身份字段：

```js
summary.origin === 'subagent'
summary.parentId // 直接父会话 ID（如需展示或进一步策略）
```

最小修改是在**完成通知**这一条边沿上增加 `summary.origin !== 'subagent'` 门控；授权、计划审阅和问题通知可以继续保持现有行为：

```js
if (
  prev.running && !next.running &&
  summary.origin !== 'subagent' &&
  featureEnabled('taskNotifications') && notifyEnabled && notifyDone
) {
  fireNotification(/* 任务完成文案 */)
}
```

这里的 `summary` 就是 `Object.entries(snapshot.byId)` 当前迭代得到的列表行；不需要另加 Host RPC 或维护会话 ID→父子关系缓存。只把门控放在这一个 `running → idle` 分支，就能保留下面的 `pendingInteraction` 分支及其 approval/plan-review/question 文案。

如果产品意图是“子代理的任何通知都不发”，则应把同一门控同时加到 `pendingInteraction` 通知分支；但这比“只不通知完成任务”更强，不应默认混用。

## 当前插件行为证据

### 完成通知未过滤子代理

`client.js` 的会话观察器从 `ctx.sessions.list.getSnapshot()` 读取 `snapshot.byId`，为每个会话保存 `running` 和 `pendingInteraction` 两个边沿字段：

- `/workspace/projects/dsh-service/client.js:1825-1847`：订阅会话列表，构造运行会话集合，并为每个会话建立边沿观察状态。
- `/workspace/projects/dsh-service/client.js:1831-1845`：每次快照更新都会把 `summary.running` 和 `summary.pendingInteraction` 保存为下一次边沿比较的状态；`summary.origin`、`summary.parentId` 没有被保存或判断。
- `/workspace/projects/dsh-service/client.js:1835-1837`：当 `prev.running && !next.running` 时发送完成通知。该条件只检查功能开关和完成通知开关，**没有检查 `summary.origin` 或 `summary.parentId`**；因此 `origin: 'subagent'` 的子代理也会命中此分支。
- `/workspace/projects/dsh-service/client.js:1838-1842`：授权/提问通知是独立分支，同样目前不检查会话是否为子代理。

当前自动化测试只验证普通会话的完成和交互边沿：

- `/workspace/projects/dsh-service/test/client.test.js:1853-1885`：普通会话 `s1` 从运行中变为空闲时断言收到“任务完成”，随后断言 question/approval 文案。
- `/workspace/projects/dsh-service/test/client.test.js:1887-1923`：总开关和完成/交互子开关门控。
- `/workspace/projects/dsh-service/test/client.test.js:355-363,418-424`：测试桩确认 `ctx.sessions.list` 通过 `getSnapshot()` 读取并由 `subscribe()` 推送快照变化；因此该测试位置可以直接加入带 `origin: 'subagent'` 的列表行。

因此，现有测试没有覆盖“`origin: 'subagent'` 的完成不通知”，不能把当前行为误认为已支持该选项。

## DSH 已提供的子代理识别字段

### 客户端 `ctx.sessions.list` 的公开契约

DSH 客户端运行时的 `SessionSummary` 定义已经把父子关系暴露给会话列表消费者：

- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/sessions/service.d.ts:29-60`
  - `parentId?: SessionId`
  - `origin?: 'subagent'`
  - `running: boolean`
  - `pendingInteraction?: ...`
  - `completed?: boolean`
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/contract/sessions.d.ts:20-23`：`ctx.sessions.list` 是会话服务向功能包暴露的标准可观察快照。

DSH 的客户端投影会把 Host 会话摘要中的字段复制到 `byId`：

- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:9216-9237`：`projectList()` 将每行的 `entry.parentSessionId` 投影为 `parentId`，将 `entry.origin` 投影为 `origin`，同时保留 `running`、`pendingInteraction` 等字段。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:5593-5633`：会话列表按 `parentSessionId` 构造父子层级；子代理不是靠标题、ID 前缀或显示缩进猜测。

这意味着插件应直接读取 `summary.origin`，不要通过标题、`displayTitle`、会话 ID 格式或列表缩进推断。

### Host 会话列表和流式状态也保留该字段

DSH Host 的会话摘要 schema 明确允许子代理字段：

- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/sessions.schema.js:30-40`：`sessionSummarySchema` 包含 `parentSessionId` 与 `origin: 'subagent'`。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/events.schema.js:60-72`：`host/session-added` 帧同样包含 `parentSessionId` 与 `origin`，`host/session-status` 帧按会话 ID推送运行状态。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:381-402`：Host 从 session header 投影 `parentSessionId` 和 `origin` 到摘要。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:3161-3190`：Host 通过 `session/created` 发布会话元数据，并通过 `agent/status` 发布运行状态；这为现有客户端快照更新提供输入。

### 一次性和可续子代理都能被识别

子代理运行时在创建子会话时写入统一的持久元数据：

- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/child-agent.js:64-93`：`childSessionMeta()` 同时写入 `parentSession` 和 `origin: 'subagent'`。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/list-children.js:42-49`：子代理列表按 `header.parentSession === parentSessionId && header.origin === 'subagent'` 识别直接子代理。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/list-children.d.ts:21-52`：一次性 child 和 continuable child 都属于该统一的 `origin: 'subagent'` 分类。

所以用 `origin !== 'subagent'` 过滤，不依赖子代理是一次性、后台还是可续派生，覆盖面比只检查某一个 Agent 注册表更完整。

## 推荐落地方式

### 1. 只过滤完成通知（与当前需求最匹配）

修改 `/workspace/projects/dsh-service/client.js:1835` 对应的条件：

```js
if (
  prev.running && !next.running &&
  summary.origin !== 'subagent' &&
  featureEnabled('taskNotifications') && notifyEnabled && notifyDone
) {
  // 主会话完成才通知
}
```

不要移除现有的：

- 首次快照基线逻辑（`client.js:1824-1829`）；
- `connection/reset` 后重建基线逻辑（`client.js:1853-1867`）；
- `pendingInteraction` 的独立通知分支（除非另有产品要求）。

这些逻辑负责避免刷新/重连时把历史状态误报成新完成事件，与子代理过滤是两个正交问题。

### 2. 补充回归测试

建议在现有 `session edges notify...` 测试附近增加至少三项断言：

1. 普通会话 `{ running: true } → { running: false }` 仍发送完成通知；
2. 子代理 `{ origin: 'subagent', parentId: 'parent-1', running: true } → { origin: 'subagent', parentId: 'parent-1', running: false }` 不发送完成通知；
3. 父会话仍按普通会话规则发送完成通知，证明过滤没有把整个父子树一并静默。

如保留授权/提问通知，再增加：子代理出现 `pendingInteraction` 时仍按现有策略发送（或者按产品决定明确禁止）。测试应显式写出这一策略，避免未来维护者把“完成过滤”扩大成“所有子代理事件过滤”。

## 边界和风险

- `origin` 是可选字段；普通主会话通常没有该字段。因此条件应使用 `summary.origin !== 'subagent'`，不要写成要求 `origin === undefined`，以免未来出现其他合法 origin 分类时误屏蔽。
- `completed` 字段是 DSH 侧边栏的完成提醒投影，不是插件必须改用的完成事件源。当前插件使用自己的 `running → idle` 边沿检测；过滤应放在通知动作处，避免改变共享状态或额度轮询逻辑。
- 插件和 DSH 都会观察会话状态。`client.js:1811-1874` 的订阅同时给额度轮询使用；不要为了屏蔽通知而移除整个 `sessions.list` 订阅，否则可能误伤运行中供应商额度刷新。
- 当前插件还会把所有运行会话加入 `sessionActivity.runningSessionIds`（`client.js:1822-1823`），这与通知过滤无关。子代理是否参与额度轮询是另一项产品策略，不应顺手改变。
- 这是客户端可见的过滤，不会阻止 DSH 内部事件、父代理接收子代理结果或会话列表中的完成状态，只会阻止该插件创建对应的浏览器 `Notification`。

## 最终判断

| 问题 | 判断 |
| --- | --- |
| 当前版本是否已经不通知子代理完成？ | **否**，完成分支没有子代理过滤。 |
| 是否能可靠区分子代理？ | **能**，`ctx.sessions.list.byId[id].origin === 'subagent'`，并可辅以 `parentId`。 |
| 是否需要新增 Host seam/RPC？ | **不需要**，已有会话快照和订阅足够。 |
| 是否能只屏蔽子代理“完成”而保留授权/提问？ | **能**，只在 `running → idle` 分支加门控。 |
| 是否覆盖一次性与可续子代理？ | **能**，二者都由 DSH 写入 `origin: 'subagent'`。 |

## 精确证据索引

### 仓库源码

- `/workspace/projects/dsh-service/client.js:1785-1786`：通知语义和事实源——`running→idle` 表示任务结束，`pendingInteraction` 表示需要确认，首个快照/重连快照只建立基线。
- `/workspace/projects/dsh-service/client.js:1814-1829`：`ctx.sessions.list.subscribe()`、`getSnapshot()`、首次基线，以及 `runningSessionIds` 的派生。
- `/workspace/projects/dsh-service/client.js:1831-1845`：完成与交互两条独立边沿分支；当前没有读取 `origin`。
- `/workspace/projects/dsh-service/client.js:1853-1874`：停止/重置/重建订阅；该订阅同时服务额度轮询。
- `/workspace/projects/dsh-service/test/client.test.js:1853-1885`：普通会话完成、question、approval 的现有回归用例。
- `/workspace/projects/dsh-service/test/client.test.js:1887-1923`：总开关和完成/交互子开关门控用例。
- `/workspace/projects/dsh-service/index.js:28,42`：`taskNotifications` 默认值和配置 schema；通知动作本身在客户端而非 Host。

### DSH 安装源码/类型声明

- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/sessions/service.d.ts:29-60`：客户端 `SessionSummary` 的 `parentId`、`origin?: 'subagent'`、`running`、`pendingInteraction`、`completed` 字段。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/contract/store.d.ts:3-7`：快照源的 `getSnapshot()` + `subscribe()` 协议。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/types/client/contract/sessions.d.ts:20-23`：`ctx.sessions.list` 的公开类型。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:9216-9237`：Host wire 的 `parentSessionId`/`origin` 到客户端 `parentId`/`origin` 的投影。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/sessions.d.ts:176-200`：Host `SessionSummary` 的 `parentSessionId` 与 `origin`。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:380-402`：Host 从 durable header 投影父会话和 origin。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/events.d.ts:147-177`：`host/session-added` 携带 lineage/origin，`host/session-status` 携带 running 状态。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/index.js:530-540`：子代理创建时写入 `parentSession`、`origin: 'subagent'`、`delegationDepth`。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/index.d.ts:77-95`：`subagent/start` 与 `subagent/end` 的生命周期契约。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-subagent/lib/types/continuation.d.ts:7-19`：可续子代理的 settlement 不应由外部 `subagent/end` listener 独立推断。
- `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-api-remotes/lib/types/remote-events.d.ts:9-16`：Host remote-event allowlist；不包含 `session/*`、`agent/*`、`job/*`。

本调研没有修改功能代码；若要落地，下一步是修改 `client.js`、补 `test/client.test.js` 回归用例，并按项目惯例同步中英文 README/TODO（如果该行为作为用户可配置功能发布）。本次仅更新了本调研 Markdown，使“当前会通知 `origin: 'subagent'`”及“只过滤完成、保留 approval/question”的结论与当前源码行号明确对应。
