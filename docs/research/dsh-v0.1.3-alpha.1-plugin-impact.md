# DSH `0.1.3-alpha.1` 对 `@gehennawu/dsh-service` 的兼容性影响评估

> 调研日期：2026-09-05  
> 目标版本：`dsh-v0.1.3-alpha.1`（tag commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`）  
> 对比基线：`dsh-v0.1.2-rc.1`（tag commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`；当前安装包版本为 `0.1.2-rc.1`）  
> 调研范围：官方 release/compare、目标 tag 与基线 tag 源码、目标 composition、以及本仓库的 `package.json`、`cordis.patch.yml`、`index.js`、`src/client.js`、兼容性扫描器和测试。  
> 结论分级：**已确认**=由目标/基线一手源码或 manifest 直接证明；**推断**=由一手源码与本插件调用面推导；**未验证**=尚未在目标版本实际挂载实例上完成故障注入或完整 E2E。

## 结论摘要

**`0.1.3-alpha.1` 不能标记为“完全兼容、无需关注”。最重要的新 breaking change 是 Session persistence 从旧的服务级读写方法改为生命周期持有的 `SessionHandle`；本插件仍直接调用旧 persistence 方法，因此会影响用量刷新、诊断、会话标题缓存、会话大小/删除计划和备份优化路径。**

同时，本次静态审计也确认：

1. 本插件当前代码已经优先使用 `snapshotEvents()`，并对 `read.inheritedEventCount` 做了兼容优先级处理；因此 alpha.4 时代的 `Session.events`、`seedLength` 迁移**不会再以旧报告所描述的同样方式直接击穿当前代码**。但用量刷新仍先调用已经移除的 `listSnapshots()`/`readFrom()`，必须先完成 persistence seam 迁移，后续 inherited-cut 逻辑才真正能运行。
2. 目标 Session format v2 会把 Assistant stream 聚合到一次 `assistant/message` 或 `assistant/attempt` settlement；目标代码与插件现有“只从 `assistant/message.usage` 统计”的方向一致，但实时流、失败/重试/取消和旧 v0/v1 日志迁移必须补回归。
3. 官方 release 明确声明存在影响部分 historical-session loading responsiveness 的已知性能回退；release 没有给出根因。目标源码显示冷读、旧 generation 迁移、标题投影和缓存 revision 是相关热路径，但下面的性能归因只能写成**可能贡献因素**，不能冒充官方根因。
4. Client inject 当前只有 `@deepseek-ai/dsh-client-connection` 与 `@deepseek-ai/dsh-api-remotes`，目标 Web roster 仍提供两者；现有槽键和稳定 `data-*` 钩子在目标源码中仍存在，未发现新的直接 Client 断裂。目标 tag 没有提交可直接核对的 `lib/client.js`，CSS hash 只能按规则复算，不能把复算值当作发行 bundle 证据。
5. `COMPAT_BREAKS` 不应新增 Session 方法名、`Session.events`、`seedLength`、`assistant/chunk` 或复算 CSS hash。现有清单继续只保留可静态、已确认的旧 package/DOM 标识。

**本次只创建本调研文档，未修改任何业务代码、版本号、README、`plugin-compat.js` 或根目录 `client.js`。**

## 总体状态表

| 主题 | 状态 | 对插件的影响 | 建议 |
|---|---|---|---|
| Session persistence 服务级 API → `SessionHandle` | **已确认直接影响（P0）** | 目标公共服务只有 `create/open/flush/stat/list`；插件仍调用 `listSnapshots/readFrom/locate/readRaw/supportsRawArtifacts`。用量刷新会失败，诊断报错，删除定位失效，备份 seam 降级为物理整树复制 | 迁移到 `list/stat`、`open(id, 'read').read()`、`handle.inheritedEventCount`、`handle.close()`，路径解析改用目标后端公开的合适能力；补目标形状测试 |
| v2 generation 与备份/删除 | **已确认行为变化；需回归** | 目标 JSONL 使用 `session.v2.jsonl[.zstd]` 等相邻 generation；旧 generation 打开时可能发布当前后继。插件失去 raw-artifact seam 后会复制会话目录中的全部文件，删除则当前直接拿不到目录 | 在隔离 profile 测 v0/v1→v2 后备份、恢复、大小展示、归档删除；明确是否保留全部 generation，避免只备份/删除单一旧文件 |
| `Session.events` → `snapshotEvents()` | **当前无新增直接影响** | `lastSubagentTurn()` 已先调用 `snapshotEvents()`，旧 getter 只作为旧 runtime/test double 的回退 | 保持 feature-detect；目标实例回归派发 `turn`、回合尾路由与按回合过滤 |
| `seedLength` → `isSeeded` + `inheritedEventCount` | **当前处理方向正确；被 persistence breaking 阻断** | `inheritedEventCountFor()` 已优先读 `read.inheritedEventCount`，仅向旧 `meta/header.seedLength` 回退；但 `refreshUsageIndex()` 仍进不了目标 `list/read` 新路径 | 改完 handle seam 后，验证 seeded/unseeded、增量 watermark、继承 prefix 不重复计费 |
| `readSession().events` | **无影响（源码已确认）** | 目标 `readSession()` 仍返回 `session`、`inheritedEventCount`、`events`；插件详情分页/搜索只取 `snapshot.events` | 不做无根据的全局 `events` 替换；补 v2/attempt fixture |
| v2 Assistant stream settlement | **需回归；无已确认调用签名断裂** | 目标把流式 chunk 收拢到 `assistant/message` 或失败尝试 `assistant/attempt`；usage 仍随 `assistant/message`，插件当前只统计该事件，因此失败 attempt 不计 usage 是预期方向，settlement 前实时 usage 可能延后 | 测成功、max-tokens、取消、重试、stream error、硬中断，以及 usage/search/title 行为 |
| `agentLoop.create()` 异步、Session 单进程锁 | **无直接命中；需回归** | 插件包装的是 `ctx.subagents.start/startContinuable`，不是 `agentLoop.create()`；目标子代理方法名仍存在，但创建/冷恢复拥有新的 handle/ownership 时序 | 测 one-shot、continuable、父子消息、冷恢复、单进程锁冲突；检查 dispatch route/turn 记录 |
| historical-session loading 性能回退 | **已确认官方存在；根因未验证** | release 明确说部分历史会话加载响应变慢；插件的标题读取、详情、搜索会触发目标 cold read，且旧 persistence seam 失效后 title revision 缓存会退回 TTL | 先做基线/目标 benchmark；不要把 `17f49f6` 或某一条冷读路径宣称为官方根因 |
| HTTP proxy 对插件 quota `https.request` | **推断/未验证** | 目标 proxy 的全局 dispatcher 明确覆盖 plain `fetch`；目标文档又明确 `node:http` telemetry 按设计直连。插件 quota 使用 `https.get/request`，未发现被目标源码 monkey-patch 的证据 | 明确产品要求是“quota 也必须走代理”还是“沿 Node HTTPS 直连”；对 HTTP proxy、NO_PROXY、失败回退做真实出网测试 |
| Client inject roster | **无影响（已确认）** | 插件 manifest 只声明 connection/api-remotes；目标 roster 仍有两者，且目标平台 seed 不含旧 `dsh-client-runtime` | 不改 `package.json` 的 inject |
| UI slots / stable DOM hooks | **无新的已确认影响** | `conversation.chat.turnTail`、`conversation.composer.dock`、`settings.section`、`sidebar.settings` 及 `data-phase`、`data-conversation-scroll`、`data-composer-seat`、`data-chat-flow-kind`、`data-turn-tail` 在目标源码中仍存在 | 做窗口调宽、长会话分页、流式回合尾和窄屏视觉回归；不写死复算 CSS hash |
| 当前测试 | **基线测试通过，不等于目标兼容** | `node --test` 通过 328/328；测试替身仍主要按旧 persistence seam，不能证明 target handle API 已兼容 | 新增 target-shaped handle/list/stat fixture 后再运行完整升级验证；本次未运行会重建 `client.js` 的 `npm test` |

## 1. 官方 `0.1.3-alpha.1` 变化概览

### 1.1 Release 与 compare

目标 release 的一手 API 返回为：

- [目标 release API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.1.3-alpha.1)
- [目标 release 页面](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.1)
- [基线 → 目标 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-rc.1...dsh-v0.1.3-alpha.1)

Release 正文明确列出：通用文件上传、启动环境代理、图片直接渲染、模型 discovery 扩展，以及以下与本插件相关的变更：

- **Breaking：**Session persistence API 改为生命周期持有的 `SessionHandle`；`agentLoop.create()` 改为异步；新增同一 Session 至多由一个进程持有的 Session lock。
- Session format 升级到 v2；旧 v0/v1 日志通过不可变相邻 generation 迁移；Assistant stream 按 attempt 聚合到持久 settlement；Web 保持实时增量显示。
- **Known regression：**部分 historical session 加载响应速度可能回退，下个版本修复。
- Agent Team `send_message` 统一采用 steer 语义，并在跨 Agent 和冷恢复投递中保留发送者归属与顺序。

Compare API 报告 `ahead_by=328`；接口返回受限于最多 250 条 commits/300 个 files，因此本报告不把 API 返回条数当作完整提交清单。关键迁移提交包括：

- [`bec6805d6a`：handle-based persistence seam](https://github.com/deepseek-ai/deepseek-harness/commit/bec6805d6af1cbb2a61f75c863d10a57371a58b3)
- [`c58097a826`：cross-process write-ownership lease](https://github.com/deepseek-ai/deepseek-harness/commit/c58097a8267ef299e03494f26801d76c1ba73ca)
- [`d1521ea783`：released format migration](https://github.com/deepseek-ai/deepseek-harness/commit/d1521ea7838f19a78a9cca7b4a93622d301149bb)
- [`f99b06eaed`：embed Assistant streams in format v2](https://github.com/deepseek-ai/deepseek-harness/commit/f99b06eaed81d6fe4fc64d44687450e18ef68a67)
- [`17f49f6191`：keep cold listing body-free](https://github.com/deepseek-ai/deepseek-harness/commit/17f49f6191548b0d37fc15ed46e07d62306cae07)
- [`6f7e30ed3b`：follow the HTTP proxy release](https://github.com/deepseek-ai/deepseek-harness/commit/6f7e30ed3b307eda74a0f2b298898e557787a514)

### 1.2 目标 composition 与安装基线

目标 base composition 仍挂载 JSONL persistence：[`packages/bundle/base/cordis.patch.yml`](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/bundle/base/cordis.patch.yml#L107-L114) 的 `session-persistence-jsonl` 行配置到 `dshHome/sessions`。因此这里不是“官方没有 persistence 服务”，而是**服务存在但公共契约已换代**。

当前安装基线版本来自 [`/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json`](file:///usr/local/lib/node_modules/@deepseek-ai/dsh/package.json)，其 `version` 为 `0.1.2-rc.1`。本报告使用的基线 tag commit 为 `a66e4702047846cdaa10c66c9d3df3951f5ea70d`。

## 2. 已确认直接影响：Session persistence 旧 seam 已移除

### 2.1 目标与基线公共契约对照

基线 `SessionPersistence` 仍同时公开：

- `locate(meta)` 与 `supportsRawArtifacts`；
- `readRaw(id)`；
- `create(meta, inheritedEventCount)` / `append(id, events)`；
- `prepare/load/inspect/borrowSession/readFrom/list/listSnapshots`。

见 [基线 persistence 定义](https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/session/session-persistence/src/index.ts#L104-L305)。

目标公共服务则只有四类职责：

- `create(header, options?) -> Promise<SessionHandle>`；
- `open(id, 'read'|'write', options?) -> Promise<SessionHandle>`；
- 服务级 `flush()`；
- metadata-only `stat(id)` 与 `list()`。

见 [目标 persistence 定义](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence/src/index.ts#L134-L197)。`SessionHandle` 的 `header`、`inheritedEventCount`、`read(offset,length)`、`append`、`flush`、`close` 见 [目标 handle 定义](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence/src/handle.ts#L34-L105)。

目标 JSONL provider 的 `create/open/stat/list` 实现也直接遵循新契约：

- `create` 返回 handle，且可延迟物化；
- `open` 区分 read/write，write 要取得 ownership；
- `stat/list` 返回 header、revision 与物理大小；
- 旧 generation 由 backend 内部解析/迁移，`resolveLog(id)` 是 provider 内部可用的异步路径解析辅助，而不是旧 `SessionPersistence.locate(meta)` 公共方法。

见 [目标 JSONL provider](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/index.ts#L146-L237)、[stat/list](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/index.ts#L317-L381) 和 [resolveLog](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/index.ts#L540-L554)。目标 JSONL 的说明明确记录 v0/v1/v2 相邻文件与“最高规范 generation”选择规则，见 [README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/README.zh.md#L54-L78)。

### 2.2 插件调用点与后果

| 插件位置 | 旧调用 | 目标行为/后果 |
|---|---|---|
| [`index.js`](../../index.js#L599-L610) | `listSnapshots()` → `locate(header)` | 目标 persistence 没有这些公共方法；备份的专用 seam 探测为 false，进入物理会话树回退 |
| [`index.js`](../../index.js#L613-L642) | `readRaw(id)` | 只有旧 seam 成功时才会进入；目标下通常不会调用，回退 `copyStableFile` |
| [`index.js`](../../index.js#L679-L706) | 检查 `supportsRawArtifacts/listSnapshots/readRaw/locate` | 目标服务下 `persistenceSeam=false`，备份仍可能工作，但不再获得稳定 raw 读取/按会话进度语义 |
| [`index.js`](../../index.js#L1869-L1891) | `listSnapshots()`、`readFrom(id, fromSeq)` | `refreshUsageIndex()` 会在目标服务上调用不存在的方法并失败；`usage-refresh` 不能正常刷新 |
| [`index.js`](../../index.js#L2250-L2254) | 诊断调用 `listSnapshots()` | 异常被捕获，`session-storage` 检查报告 error，而不是正常返回会话数 |
| [`index.js`](../../index.js#L3482-L3491) | `listSnapshots()` 取 title revision | 调用不存在后 catch 为 `null`，标题缓存退回 TTL，而不是按 revision 精确命中 |
| [`index.js`](../../index.js#L3430-L3447) | `locate(header)` 后扫描目录 | optional chaining 得不到 path，返回 `null`；会话大小显示无法取得 |
| [`index.js`](../../index.js#L3751-L3780) | `locate(header)` 生成删除计划 | 找不到 path 时直接返回 `undefined`，删除计划对持久化会话不可用；不是安全地删除了错误文件，而是功能降级为 `session-not-found` |

删除路径尤其值得单独说明：`resolveSessionForDelete()` 先要求 `locate(header)` 得到 path，缺失时不会产生 `plan.dir`；因此目标下目前不是简单的“`rm(undefined)`”，而是删除计划提前不可用。执行阶段仍保留 archived/live 二次复检和先写 deleted sidecar 再 `rm` 的安全顺序，见 [`index.js`](../../index.js#L5375-L5439)。

### 2.3 推荐适配方向

建议把适配集中在一个小的 persistence adapter，而不是在每个 RPC 中散落版本判断：

1. 列表/诊断/title revision：优先使用 `persistence.list()`；如需要物理大小，使用 `snapshot.sizeBytes`，不要从 `locate()` 推目录。
2. 用量增量：按目标 `list()` 或 `stat()` 得到 revision，再 `open(id, 'read')`；读取 `handle.read(fromSeq, undefined)`，始终在 `finally` 中 `await handle.close()`；首次读取从 handle 的 `inheritedEventCount` 获取精确 cut。
3. 备份：不要把 provider 私有 `resolveLog()` 当成抽象 persistence API。应决定是使用目标官方导出/备份能力，还是把“按会话 raw artifact”改成由插件自有、受白名单约束的物理树复制；如果复制物理树，必须明确相邻 generation、`.jsonl`/`.jsonl.zstd` 以及恢复时最高 generation 的语义。
4. 删除：不能凭 header 反推路径；应引入经过目标后端授权的 artifact/path 能力，或调整删除策略为官方尚未提供的明确受控物理目录管理，并重新验证路径越界与 generation 选择。
5. 保留旧版本兼容时，使用 feature detection；不要仅用 `header.isSeeded ? 0 : ...` 代替 inherited cut，因为 `isSeeded` 不携带前缀长度。

## 3. alpha.4 语义迁移在当前插件中的实际状态

### 3.1 `Session.events`：当前已先走 snapshot API

目标 `Session` 的实时读取 API 是 `eventAt()`、`snapshotEvents()`、`ownEvents()`，不再提供公开 `events` getter；见 [目标 Session source](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/index.ts#L617-L646)。

但当前插件的 `lastSubagentTurn()` 已经是：

- 先判断并调用 `parent.session.snapshotEvents()`；
- 只有不存在或返回非数组时，才回退读取 `parent.session.events`；
- 对尾部最多 `scanLimit` 个事件反向寻找数字 `data.turn`。

见 [`index.js`](../../index.js#L3224-L3243)。因此在目标 runtime 上，旧 getter 不会被走到，不能把该位置继续报告成 alpha.1 新的直接故障。需要保留的回归是派发记录仍有正确 `turn`，而不是把 `events` 全局替换成 `ownEvents()`。

### 3.2 `seedLength`：当前归一化已经优先使用精确 cut

当前 [`index.js`](../../index.js#L1754-L1767) 的 `inheritedEventCountFor(record, read)` 顺序是：

1. `read.inheritedEventCount`；
2. 旧 runtime 的 `read.meta.seedLength`；
3. 更旧形状的 `record.header.seedLength`；
4. 都没有时为 `0`。

目标 v2 header 的逻辑字段是 `isSeeded`，精确 inherited cut 与 body-bearing read 一起返回；目标 v2 physical header 也要求 `isSeeded`，见 [目标 JSONL format](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/format.ts#L74-L105)。旧 v0/v1 codec 仍可读取历史 physical `seedLength` 并转换成逻辑 `isSeeded/inheritedEventCount`，见 [目标 v0/v1 codec](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-format-v0-to-v1/src/codec.ts#L76-L124)。

因此当前风险不是再把 `seedLength` 直接当成目标 header 使用，而是 `refreshUsageIndex()` 仍卡在旧 persistence 方法上。迁移完成后必须确保首次 handle read 的 `inheritedEventCount` 进入 `foldUsageEvents()`，并且增量读取从上次 `lastSeq + 1` 开始。

### 3.3 `readSession().events`：目标仍保留

目标 `SessionQueryEngine.readSession()` 返回：

```text
{ session, inheritedEventCount, events }
```

见 [目标 session-query source](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/index.ts#L177-L196)。当前插件的 `viewSessionPage()` 使用 `snapshot.events` 做分页和命中窗口切片，见 [`index.js`](../../index.js#L3613-L3684)，这一路没有因 v2 直接失效。不要把 live `Session.events` 的删除误扩展成 query snapshot `events` 的删除。

## 4. v2 Assistant stream 与子代理行为

### 4.1 目标事件语义

目标 `SessionHeader`/event map 把：

- 成功模型步骤写成 `assistant/message`，携带组装后的 message、紧凑 embedded `stream`，可选 `usage`；
- 失败、重试、取消或 stream error 的无 surface 尝试写成 `assistant/attempt`，携带 embedded stream，不产生模型可见 message；
- 顶层逐 chunk 的 `assistant/chunk` 不再是 v2 的持久事件。

见 [目标 event types](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/types.ts#L282-L319) 与 [目标 agent loop settlement](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/agent-loop/src/agent.ts#L364-L466)。目标说明还明确：实时 `agent/assistant-stream` frame 是进程内展示数据，必须在 committed end frame 前先完成 durable settlement；settlement 前进程硬中断时不会留下 durable attempt stream，见 [目标 Agent README](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/agent/README.zh.md#L60-L70)。

### 4.2 对插件用量、搜索和标题的影响

当前插件：

- `foldUsageEvents()` 只统计 `assistant/message` 且要求 `event.data.usage` 存在，见 [`index.js`](../../index.js#L1778-L1811)；
- `sessionEventText()` 只把 `assistant/message` 的内容作为可搜索文本，见 [`index.js`](../../index.js#L3418-L3425)；
- 目标官方语义提取也让 `assistant/attempt` 返回空文本，见 [目标 extraction](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/extraction.ts#L15-L43)。

所以没有证据表明需要把 `assistant/attempt` 当成普通 assistant message 统计或展示；这样做反而会把失败尝试错误地纳入模型历史/usage。真正需要回归的是：

- 流式成功时，usage 在一个最终 `assistant/message` 上出现一次，不因 embedded stream 被重复统计；
- retry 产生 `assistant/attempt` 后最终成功 message 只计一次；
- 取消有可见文本时可能是 `assistant/message(interrupted:true)`，无可见文本时是 `assistant/attempt`；
- 实时 UI 的 transient chunk 期间，插件的持久 usage/搜索是否按产品预期延迟到 settlement。

### 4.3 子代理创建与 continuation

目标 `SubagentService` 仍提供 `start()` 和 `startContinuable()`，见 [目标 subagent source](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/subagent/src/index.ts#L220-L240) 与 [`start`](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/subagent/src/index.ts#L545-L575)。本插件包装这些方法并记录 `agent/created`，没有调用已重构的 `agentLoop.create()` 或旧的 follow-up API，因此没有发现新的静态签名断裂。

但目标 continuation 会在 parent ownership、persistence.stat、cold resume、`agents.resume` 与相邻 Agent steer 之间协调；见 [目标 continuation source](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/subagent/src/continuation.ts#L438-L521) 和 [cold resume](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/subagent/src/continuation.ts#L1061-L1121)。应把它列为行为回归，而不是直接修 method name：one-shot、continuable、父子双向消息、settlement notice、冷恢复和 Session lock 冲突都要覆盖。

## 5. historical-session loading 性能：官方已确认回退，根因未确认

### 5.1 官方确认的范围

目标 release 正文只确认“存在可能影响部分 historical-session loading responsiveness 的 known performance regression，并将在下个版本修复”。它没有指向唯一 commit 或唯一 hot path。因此本报告不把以下任何一项写成已确认根因。

### 5.2 一手源码显示的可能贡献因素

1. **SessionQuery 冷观察：**目标 `observation.ts` 以 `stat` revision 做 bounded LRU；cache miss 需要完整 `readColdSessionLog`，即 `open(id,'read') → handle.read(0, undefined) → close()`，然后做 unpublished preparation。见 [目标 observation](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/observation.ts#L65-L145) 与 [目标 cold-read](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/cold-read.ts#L17-L48)。
2. **旧 generation 迁移：**目标 JSONL 打开旧 v0/v1 generation 时会完整读取/转换并发布当前 v2 后继；migration 要建立旧 seq 到新 seq 的映射，不能当作只读一个 header 的常数时间路径。见 [目标 generation 读取](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/index.ts#L387-L408) 与 [generation migration](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/generation.ts#L268-L319)。
3. **标题/搜索/详情的 full-log demand：**目标 `readTitleSnapshots()` 通过 `corpus.projectMany()` 对冷会话做投影；`filterEvents()` 和 `readSession()` 也需要加载完整逻辑日志。当前插件虽然有持久化 title cache，但在目标 persistence API 下 revision 查询会先降级为 TTL，适配前后都要观察是否造成额外 cold read。见 [目标 readTitleSnapshots](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/index.ts#L241-L259) 与 [目标 corpus](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/corpus.ts#L57-L124)。
4. **body-free listing 是目标中的修复/约束，而非本报告的根因结论：**`17f49f6191` 将 API session list 的冷会话列表改为只用 metadata/projection hints，不再为每个冷会话做小 body probe；目标代码见 [session-controller list](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/api/session-controller/src/list.ts#L121-L157)。这证明历史上 body probe 曾是已识别性能面，但不能证明 release note 所说回退就是该路径。

### 5.3 必做性能回归

至少建立以下矩阵：空会话/短会话/长会话、当前 v2/历史 v0/v1、zstd/none、cold 首次加载/LRU 命中/修改后 miss、列表/标题/详情/搜索、单会话/多会话并发。记录首个可交互时间、RPC p50/p95、事件数、迁移后文件数和内存峰值。没有目标实例实测前，状态只能是“官方回退已确认，插件具体暴露程度未验证”。

## 6. HTTP proxy 与插件固定出网

### 6.1 目标 proxy 的真实覆盖边界

目标 launcher 在首个插件挂载前安装 proxy policy：

- 全局 undici dispatcher 覆盖 Node `fetch`；
- `applyPolicyEnv` 发布 `HTTP_PROXY/HTTPS_PROXY/NO_PROXY` 等值；
- subprocess runtime 将解析后的 proxy 环境与 `NODE_USE_ENV_PROXY=1` 传给合适的子进程。

见 [目标 launcher](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/apps/cli/src/profile-boot.ts#L210-L226)、[目标 proxy install](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/util/http-proxy/src/install.ts#L62-L87) 和 [目标 subprocess env](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subprocess/subprocess/src/index.ts#L60-L77)。

但目标 proxy README 明确写出：通过 `node:http` 投递的 telemetry 按设计直连；全局 dispatcher 不会自动改变所有自建 `http.Agent`/`node:https` transport。见 [目标 proxy README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/util/http-proxy/README.zh.md#L30-L48) 和 [已知限制](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/util/http-proxy/README.zh.md#L102-L114)。

### 6.2 插件实际出网面

插件 Host 的 npm registry、quota GET、quota JSON GET/POST 均使用固定 endpoint 和 `https.get/request`：

- npm metadata：[`index.js`](../../index.js#L279-L334)；
- provider quota：[`index.js`](../../index.js#L1359-L1455)；
- CLIProxy/Xiaomi/StepFun 管理面：[`index.js`](../../index.js#L1457-L1524) 与 [`quota-adapters.js`](../../quota-adapters.js#L354-L1008)。

插件没有浏览器传 URL 的通用出网入口；CLIProxy 的动态 host 仍由 pinned HTTPS origin 约束。目标 release 的“all outbound requests honor proxy”是官方总体目标，但从目标实现和文档不能确认本插件 `https.request` 是否会被当前 Node 版本的 `proxyEnv` 语义覆盖。因此这里必须标为**推断/未验证**：如果用户要求 quota 请求也走代理，应增加真实 loopback proxy egress test；如果产品接受 Node HTTPS 直连，则需在文档中明确它与 DSH fetch/proxy 的差异。

## 7. Client inject、slots 与 DOM 影响

### 7.1 Client inject

本插件 [`package.json`](../../package.json#L54-L64) 的 `dsh.client.inject` 只有：

```json
[
  "@deepseek-ai/dsh-client-connection",
  "@deepseek-ai/dsh-api-remotes"
]
```

目标 Web roster 仍挂载 `connection` 与 `api-remotes`，同时新增/保留 file-upload 等官方行；见 [目标 web composition](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/bundle/web-app/cordis.patch.yml#L151-L220)。目标 browser seed 是有限的静态 platform table，不含旧 `dsh-client-runtime`；见 [目标 seed](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/web/src/seed.ts#L20-L36)。因此当前 manifest 没有新 supplier 断裂。

### 7.2 稳定槽和属性仍在

目标源码仍确认：

- `ConversationRoot` 保留 `data-phase`、`data-composer-seat`、`data-conversation-scroll`，见 [目标 ConversationRoot](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx#L355-L377)；
- `ChatNodeSeat` 保留 `data-chat-flow-kind`，见 [目标 ChatNodeSeat](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx#L126-L136)；
- Turn tail 保留 `data-turn-tail`，并继续有 `conversation.chat.turnTail` chain slot，见 [目标 TurnTailNodeView](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx#L25-L42) 和 [目标 ui-chat slots](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-chat/src/client/contract/slots.ts#L217-L227)；
- `conversation.composer.dock` 仍为 session list slot，见 [目标 conversation slots](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-conversation/src/client/contract/slots.ts#L152-L161)；
- `settings.section` 与 `sidebar.settings` 仍在目标 settings/sidebar contract，见 [目标 settings slot](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-settings/src/client/contract/slots.ts#L45-L54)、[目标 sidebar slot](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-sidebar/src/client/contract/slots.ts#L37-L41)。

因此现有 `src/client.js` 的槽注册和属性选择器没有发现 alpha.1 新的静态断裂。目标 tag 只提交了可读源码，没有 committed `lib/client.js`；npm registry 也没有可直接安装的 `0.1.3-alpha.1` plugin bundle。目标 CSS Modules 规则确实是 `[hash]_[local]`，但 hash 依赖构建 filename/path；即使按本地绝对路径复算出若干前缀，也只能归为**推断/可复算线索**，不能当作发行 bundle 的已确认字符串。现有插件已经使用属性和可读 stem 后缀优先，不应把复算 hash 写死到兼容清单。

## 8. `COMPAT_BREAKS` 建议

**本次不新增 `COMPAT_BREAKS` 条目。** 当前 [`plugin-compat.js`](../../plugin-compat.js#L53-L84) 的清单继续是：

- manifest：`@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-session-persistence-sqlite`；
- code：`Md3f7G_`、`FJxK0a_`、`data-time-hover-root`。

不建议加入：

- `listSnapshots`、`readFrom`、`locate`、`readRaw`、`supportsRawArtifacts`：虽然这些旧方法在目标公共 persistence seam 被移除，但它们是通用语义 API 名称，加入当前 scanner 会产生跨对象/跨库误报；真正修复应靠 target-shaped API 测试和版本适配，而不是静态 token 告警。
- `Session.events`、`seedLength`、`assistant/chunk`：它们是语义/事件格式迁移，不是当前 scanner 能可靠判断“使用方式是否正确”的静态 identifier。
- 目标 CSS hash（例如本地复算前缀）：目标 tag 没有发行 bundle 证据，且 hash 随构建 filename 变化；应继续扫描已确认的旧 hash，而不列新 hash。

## 9. 回归与行动清单

以下五项是升级前必须处理或至少完成回归的项目：

1. **必须修复：迁移 persistence adapter（P0）。** 覆盖 `usage-refresh`、diagnostics、title revision、session bytes/delete、backup seam；目标 handle 必须在所有异常路径关闭，且首次读使用 `handle.inheritedEventCount`。
2. **必须修复/回归：v2 generation 的备份、恢复、大小和删除（P0/P1）。** 用 v0、v1、v2、zstd/none、迁移后相邻文件 fixture 验证：备份不会漏 generation；恢复后目标选择最高规范 generation；删除只作用于经过白名单和归档/非 live 复检的会话目录。
3. **必须回归：usage 与 Assistant attempt settlement（P1）。** 验证成功/重试/取消/max-tokens/stream error 的事件序列；`assistant/attempt` 不被计为模型 message 或 usage，最终 `assistant/message.usage` 只计一次；seeded 会话继承 prefix 不重复计费。
4. **必须回归：historical-session loading 性能（P1）。** 对列表、标题、详情、搜索和冷恢复做 v0/v1/v2、短/长日志、首次/memo hit/miss 的 p50/p95；在目标已知回退尚未有官方修复前，不应只凭 `npm test` 通过就宣称可升级。
5. **必须回归：proxy 下的 quota 出网边界（P1）。** 通过 loopback HTTP proxy 分别验证插件固定 `https.get/request`、目标 plain `fetch`、NO_PROXY loopback、子进程 npm/curl；明确 quota 是否必须与 DSH model/web fetch 同样走代理。

## 10. 当前测试结果与边界

在本工作区运行的是不触发 `pretest`/`build:client` 的：

```text
node --test
1..328
# tests 328
# pass 328
# fail 0
```

这说明当前实现与现有 test doubles 一致；不能证明目标 `SessionHandle` API、v2 generation、跨进程 Session lock、历史加载性能或 proxy runtime 已兼容。特别是现有 host fixtures 仍直接提供 `listSnapshots/readFrom/locate/readRaw` 形状，且旧/新 fork fixture 主要通过 fallback 覆盖；应在修复提交中加入 target-shaped handle/list/stat fixtures。

本调研没有在目标 alpha.1 runtime 上运行插件完整 Host/Web E2E，也没有运行会自动重写根 `client.js` 的 `npm test`。因此“已确认”仅表示源码/manifest 事实，不表示目标线上实例已经完成验证。

## 11. 最终建议

- **不要把 alpha.1 标为无影响。** Persistence handle seam 是当前插件新的高优先级兼容断点；它比 UI hook 或子代理方法名更值得先修。
- **先迁移 persistence，再验证 usage/backup/delete。** 当前 inherited-cut 与 snapshot API 的兼容代码方向是对的，但被旧 `listSnapshots/readFrom` 入口挡住；不能只修 `seedLength` 文本引用。
- **把官方性能回退写入升级门槛，但不要虚构根因。** 目标冷读、旧 generation migration、标题/搜索 full-log projection 都是可能贡献因素；只有目标实例 benchmark 或官方后续修复才能确认责任路径。
- **保持当前 Client manifest、RPC channel、slot 注册和稳定 DOM selectors。** 没有目标源码证据要求改动这些部分；不因不可直接核对的 CSS hash 改兼容清单。
- **升级前完成五项行动清单，并在隔离 profile 先验证。** 尤其是已有历史会话、seeded/fork 会话、归档删除和代理环境；当前测试全绿不能替代这些回归。

## 12. 官方与本仓库来源索引

1. [目标 release API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.1.3-alpha.1)
2. [目标 release 页面](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.1)
3. [基线 → 目标 compare](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.2-rc.1...dsh-v0.1.3-alpha.1)
4. [目标 SessionPersistence](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence/src/index.ts#L134-L197)
5. [基线 SessionPersistence](https://github.com/deepseek-ai/deepseek-harness/blob/a66e4702047846cdaa10c66c9d3df3951f5ea70d/packages/session/session-persistence/src/index.ts#L104-L305)
6. [目标 SessionHandle](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence/src/handle.ts#L34-L105)
7. [目标 JSONL persistence](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/index.ts#L146-L237)
8. [目标 JSONL layout/README](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/README.zh.md#L54-L78)
9. [目标 v2 format](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence-jsonl/src/format.ts#L74-L105)
10. [目标 v0/v1 codec](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-format-v0-to-v1/src/codec.ts#L76-L124)
11. [目标 v1→v2 migration](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-format-v1-to-v2/src/migration.ts#L33-L105)
12. [目标 Session core](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/index.ts#L617-L646)
13. [目标 Session event types](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/src/types.ts#L282-L319)
14. [目标 agent settlement](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/agent-loop/src/agent.ts#L364-L466)
15. [目标 session-query](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/index.ts#L177-L196)
16. [目标 session-query observation](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/observation.ts#L65-L145)
17. [目标 session-query cold read](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session-query/session-query/src/cold-read.ts#L17-L48)
18. [目标 session-controller list](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/api/session-controller/src/list.ts#L121-L157)
19. [目标 proxy install](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/util/http-proxy/src/install.ts#L62-L87)
20. [目标 proxy README](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/util/http-proxy/README.zh.md#L102-L114)
21. [目标 CLI profile boot](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/apps/cli/src/profile-boot.ts#L210-L226)
22. [目标 Web composition](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/bundle/web-app/cordis.patch.yml#L151-L220)
23. [目标 browser seed](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/web/src/seed.ts#L20-L36)
24. [目标 ConversationRoot](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx#L355-L377)
25. [目标 ChatNodeSeat](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx#L126-L136)
26. [目标 TurnTailNodeView/slots](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx#L25-L42)
27. [本仓库 package.json](../../package.json)
28. [本仓库 index.js](../../index.js)
29. [本仓库 src/client.js](../../src/client.js)
30. [本仓库 plugin-compat.js](../../plugin-compat.js)
31. [本仓库 host tests](../../test/host.test.js)
32. [本仓库 client tests](../../test/client.test.js)
