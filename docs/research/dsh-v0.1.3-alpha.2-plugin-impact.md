# DSH `0.1.3-alpha.2` 对 `@gehennawu/dsh-service` 的兼容性影响评估

> 调研日期：2026-09-08（本次环境 `date -I`）；前序报告：[alpha.1 影响评估](./dsh-v0.1.3-alpha.1-plugin-impact.md)。  
> 研究范围：官方 `dsh-v0.1.3-alpha.1...dsh-v0.1.3-alpha.2` **完整 Git 差异**，重点 persistence、性能、查询、子代理，结合当前仓库源码重新判断；旧报告只作待复核风险清单。  
> 上游基线：`d347e703908d0406b7a7ef80e3a0e594d86b2215`（alpha.1）；目标：`82a5fd61a7cf5c293cec4bdff68f455398d685e9`（alpha.2）。  
> 本仓库基线：`d43d161f080bb45c44d7cd5c22947a369affb8a1`，`package.json` 版本 **1.4.11**；研究期间未修改业务代码、composition、版本号或构建产物。  
> **已确认**＝固定 tag/commit 源码、官方发布数据或本次实际命令直接证明；**推断**＝源码与插件调用链推导；**未实测**＝未在目标 alpha.2 隔离实例做 Host/Web E2E、性能测量或故障注入。源码层确认不等于目标运行兼容。

## 结论摘要

**alpha.2 确实针对 alpha.1 的长会话卡顿进行了多层优化，但没有恢复旧 persistence API，而且新增了 `SessionHandle.read()` 返回形状变化。当前插件仍不支持该版本，不应因为 release 写了性能改善就解除版本限制。**

1. **旧风险继承：**当前 `index.js` 仍调用 `listSnapshots()` / `readFrom()`；alpha.2 公共 persistence 仍是 `create/open/flush/stat/list`。用量刷新会被旧入口阻断，诊断会报错，标题 revision 缓存退 TTL，备份走物理整树回退。
2. **新增契约：**alpha.1 `handle.read()` 返回事件数组；alpha.2 返回 **`{ eventState, events }`**。旧报告提出的 alpha.1 适配方案不能不经复核照抄到 alpha.2；精确 inherited cut 仍在 handle 上，不在 `read` 结果中。
3. **已修复/改变的机制：**历史读取变为 preparation-first；read-only open 只准备逻辑当前代，write open 才发布后继 generation。流式迁移、共享冻结事件、避免重复 stream replay、live observation 懒快照和逐 Agent 的 freeze 复用减少重复工作。官方性能改进有具体代码与合成 benchmark 支撑，**本插件实际提升幅度未实测**。
4. **必须纠正旧报告两处过度判断：**公共 `locate()` 移除不等于 JSONL 实例运行时一定没有同名方法；官方统计也并非一概忽略 `assistant/attempt` 中的 usage。详见 §3.3、§5.3。
5. **当前产品决定仍有效：**`src/client.js` 已声明 `DSH_NOT_SUPPORTED_FROM = '0.1.3-alpha.1'`；`TODO.md` 明确等下一 rc 一起适配。alpha.2 是 alpha，不是该 rc；本报告提供后续适配依据，**不建议现在改变支持口径或动业务代码**。

## 1. 一手来源与完整差异覆盖

### 1.1 发布事实

[官方 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.3-alpha.2) / [release API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.1.3-alpha.2) 返回 prerelease、非 draft，发布时间 `2026-09-07T13:59:29Z`，没有 release assets。正文列出 pi-ai 0.85.1、Workspace “Open in”、continuable 子代理队列/编辑/删除/Steer/Stop、PTC 命令详情、断线恢复、自动贴底、Windows Python 启动与进程清理、长会话性能、引用溢出内容按需读取、消息 Sending、设置样式、独立反馈，以及 persona 拆分、普通 subprocess handle 去 pid、默认编辑工具调整。

发布正文不是契约清单的替代物：例如 `SessionHandle.read` 的返回类型变化须从源码 diff 才能发现。

### 1.2 获取方法和范围保证

使用临时目录 `/tmp/dsh-alpha2-research` 克隆官方 Git 仓库并 checkout 固定目标 tag，**没有读取/修改运行中 DSH 作为目标源码替代品，也没有启动替代 Web 服务**。实际执行：

```sh
git rev-parse dsh-v0.1.3-alpha.1 dsh-v0.1.3-alpha.2
git rev-list --count dsh-v0.1.3-alpha.1..dsh-v0.1.3-alpha.2
git log --no-merges --oneline dsh-v0.1.3-alpha.1..dsh-v0.1.3-alpha.2
git diff --name-status dsh-v0.1.3-alpha.1 dsh-v0.1.3-alpha.2
git diff --shortstat dsh-v0.1.3-alpha.1 dsh-v0.1.3-alpha.2
git diff dsh-v0.1.3-alpha.1 dsh-v0.1.3-alpha.2
```

结果：**316 commits（236 非 merge）、3,790 files、46,421 insertions、15,866 deletions**。全量 diff 与文件目录存放在临时文件 `/tmp/dsh-alpha2-full.diff`、`/tmp/dsh-alpha2-files.txt` 供研究使用，不是交付文件，也不是报告引用的唯一证据；永久可复核入口为[固定两 commit compare](https://github.com/deepseek-ai/deepseek-harness/compare/d347e703908d0406b7a7ef80e3a0e594d86b2215...82a5fd61a7cf5c293cec4bdff68f455398d685e9)。GitHub compare API 只返回 250 commits/300 files，首批 files 几乎全是 Agent Notes，**不能据该截断结果声称已看完整发布差异**。

全量路径归类：`.agents` 2,322、`packages` 1,089、`snapshots` 129、`docs` 101、`apps` 45、`scripts` 36、`benchmarks` 30、`.github` 20、`python` 10，另外 9 个根文件；路径中含 `/src/` 且不含 `/testing/` 的文件 199 个（含声明/注释/类型变化，并非全部是业务改动）。大数字主要包含 notes 归档、文档路径更新、批量版本更新，不能等同 3,790 个运行时破坏点。

### 1.3 完整差异分流矩阵

| 差异家族 | 本次处理 | 对当前插件判断 |
|---|---|---|
| Session format / persistence / restore / observation | 逐链追公共契约、JSONL 实现、调用方与测试 | 旧 seam 仍断裂；新 read envelope；read/write migration 分离 |
| Assistant stream / token-meter / stats / Agent request | 核对 compact-record 读取、restore 与 freeze 路径 | 性能改善与统计口径区别；不要求插件展开 stream |
| 子代理/inbox/controller/provider | 核对 start/startContinuable、路由/队列/冷恢复 | 入口保留，增加交互能力与回归面 |
| subprocess/native containment/PTY/Windows runtime | 核对 handle 类型和本仓库使用字段 | 去 pid 未命中本插件，done/collected 路径需回归 |
| Web connection/chat/queue/settings/primitives/open-in-app | 核对公开槽、seed、核心属性及本仓库选择器 | 未发现新的 slot/inject 断裂；重连/贴底/失败尾行需真机 |
| persona/system prompt/default compositions | 核对配置与常量迁移 | persona 对使用者 breaking；本插件不配置它 |
| pi-ai/model compat/replay | 核对版本与新增配置字段 | 模型目录/思考协议可能变化；不是 quota API 变更 |
| session-reference/spill/feedback/telemetry | 检查新增行为与数据边界 | 引用可追回截断内容；显式反馈出网语义改变；插件不调用反馈 |
| manifest/boot/loader | 核对类型集中化与绝对路径处理 | 当前 manifest 不需迁移 |
| 其余 SDK/ACP/headless/python/工具、CI、bench、notes、snapshot、docs、版本 | 全量目录/提交分流，确认是否命中插件消费面 | 不是漏项；未发现当前插件直接契约命中，不把上游测试改动宣称为本插件测试证据 |

## 2. 当前仓库状态：不能沿用旧报告的“当前”

当前直接证据：[`package.json`](../../package.json#L1-L10)、[`index.js`](../../index.js)、[`src/client.js`](../../src/client.js)、[`TODO.md`](../../TODO.md#L900-L920)。

- 版本为 **1.4.11**；客户端保留 connection/api-remotes 两个 `dsh.client.inject`（package.json 59–62）。
- `refreshUsageIndex` 1872/1883 仍为 `listSnapshots/readFrom`，并没有已完成的 handle adapter。
- `usageReadEvents` 1774–1775 已接受对象 `.events`；但这不是 handle 适配已完成的证据，因为前面的调用入口仍旧，`inheritedEventCountFor` 也不会自动从 handle 读 cut。
- `lastSubagentTurn` 3224 起优先 `snapshotEvents()`；因此不是重新出现“Session.events getter 被删除”的直接断裂。
- 标题 revision 源 3483 是 `typeof listSnapshots === 'function'` 的显式探测，缺席时**不调用再 catch**，直接 `Promise.resolve(null)` 进入 TTL。
- 版本卡常量与判断在 src/client.js 2664–2699，alpha.2 自然落在“暂不支持”范围；这是**展示性声明，不是禁止升级的强制安全门**。TODO 918–920 的下一 rc 适配决定仍应遵循。
- 客户端并非全用稳定属性/stem：`src/client.js` 7787/7794 仍有 `[class*="NDN2W_root"]` 精确 StatsLine hash，必须保留构建/真机验证项，不因目标源文件无 diff 就宣称 hash 已验证。

## 3. Persistence：继承断点与 alpha.2 新断点

### 3.1 公共方法没有回滚

alpha.2 [SessionPersistence](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence/src/index.ts) 对比 alpha.1 只有新增导出的 `SessionHandleReadResult`，公共 `create/open/flush/stat/list` 仍在，旧 `listSnapshots/readFrom/readRaw/supportsRawArtifacts` 没有恢复。

| 当前调用 | alpha.2 状态 | 风险分类 |
|---|---|---|
| `index.js:1872,1883` 用量刷新 | 调用不存在的旧方法，入口先失败 | **已确认，继承 P0** |
| `index.js:2253` session-storage 诊断 | 异常转 error 项，不是正常会话数 | **已确认，继承** |
| `index.js:3483–3491` title revision | 明确 fallback null → TTL | **已确认，继承性能降级** |
| `index.js:681–684` raw backup seam | capability gate 为 false → 物理树回退 | **已确认，继承；不是备份必失败** |
| `index.js:3433,3759` size/delete `locate` | 依赖非公共 JSONL 实现细节，见下文纠错 | **契约风险继承，不能断言必不可用** |

### 3.2 新增：`handle.read()` 不再直接返回数组

[alpha.1 handle](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/session/session-persistence/src/handle.ts#L67-L73) 与 [alpha.2 handle](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence/src/handle.ts#L22-L32) / [read 签名](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence/src/handle.ts#L75-L83)：

```text
alpha.1: read(...) -> Promise<readonly SessionEvent[]>
alpha.2: read(...) -> Promise<{ eventState: 'detached' | 'shared-frozen', events: readonly SessionEvent[] }>
```

这是**已确认新增 breaking**，不是可忽略的类型重命名。alpha.2 官方 [cold-read](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session-query/session-query/src/cold-read.ts#L30-L57) 和 [export](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session-query/session-log-export/src/archive.ts#L150-L170) 均已解包 `.events`。

后续适配至少需要：列表用 `list()`；read 使用 `open(id,'read')`、`read.events`；cut 取 `handle.inheritedEventCount`；所有正常/异常分支关闭 handle。若保留 alpha.1 与旧 rc 兼容，adapter 才需要分别归一数组/对象/旧 `readFrom` 三形状。**不要伪造 `eventState`，也不要修改共享冻结的事件对象**：插件统计只读消费，不需要进入 Session ownership-transfer 协议。

另一个上游迁移是 `SessionStore.prepare` 的 `seedSource:'persistence'` → `eventState`、`Session.fromRestore` 增加 eventState 参数，见 [Session types](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/core/session/src/types.ts#L159-L184)。当前插件没有使用这两者；它是生态契约漂移，不是当前直接断点。

### 3.3 纠正 alpha.1 报告：`locate` 公共移除不等于 JS 实例不存在

alpha.2 JSONL [index.ts 288–295](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/src/index.ts#L288-L295) 仍有 **TypeScript `private locate(meta)`**；不是 ECMAScript `#locate`。alpha.1 同样保留该 private 方法。因此，旧报告从“抽象 API 不公开”推导“size 必返回 null / 删除计划必 session-not-found”的力度过强，应在本报告纠正，而不是沿用。

**已确认：**它不是受支持的公共 artifact API；`locate` 按当前 JSONL `root/cwd/id/compression` 算当前代路径。当前插件只拿 `dirname(location.path)` 再扫描/删除整个会话目录，而非要求该当前代文件已经存在。

**推断：**通常 TS 输出下方法仍可被 JavaScript 的 optional call 访问，现有 size/delete 因而可能继续工作；不能宣称已验证目标发布实例。若换后端、封装代理或将来真正私有化，它仍会失效。后续要确定受控 artifact 能力/物理目录策略，不能把 private seam 当稳定契约。

注意 `list/stat.sizeBytes` 是**所选物理 artifact 的大小**，见 [stat/list](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/src/index.ts#L418-L490)；插件当前展示的是目录内所有普通文件之和。相邻 generation 与 lock 等文件存在时两者口径不同，不能为了去掉 locate 就悄悄替换成不同统计。

## 4. 性能与迁移：不是单一缓存修复

### 4.1 历史只读与写恢复分离（已确认行为改变）

[JSONL open](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/src/index.ts#L329-L387)：read open 调 `requireStoredLog`，历史格式得到 `status:'prepared'` 并 priming handle；write open 先取 write claim/lease，再 `publishStoredMigration`。因此相对 alpha.1 的“打开历史就发布后继”，alpha.2 普通只读浏览**不再为了读取必先发布当前 generation**；这不等于绝无文件系统副作用，例如 open 仍会执行 `ensureRootEncoding`。

后端 [495–639](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/src/index.ts#L495-L639) 按 source path/revision 合并历史 preparation；多个 waiter 共享工作，单个取消不会中止其他 waiter，最后一个离开才 abort。成功结果进入 bounded memo；本地 mutation 失效、外部修改依靠 stat revision miss。此处不是新增全部缓存：alpha.1 已有冷日志/observation 缓存，本次扩展了历史准备与 ownership 复用。

**对插件推断：**将来标题/搜索/用量采用 read handle 后，读取历史不会直接触发昂贵发布/磁盘换代；随后的写恢复仍可能发布和改变 revision。备份必须覆盖“只准备未发布”“写打开已发布”“旧/新相邻 generation 并存”三态，不可再以“打开过就一定存在 v2 文件”为前提。

### 4.2 流式 migration + 分离验证

[session-format chain](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-format/src/chain.ts)、[v1→v2 migration](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-format-v1-to-v2/src/migration.ts) 与 [generation.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/src/generation.ts#L879-L1007) 实现流式相邻迁移、分块编码/写入暂存文件、验证后排他发布；源变更、目标冲突与清理仍有显式错误路径。不是“跳过校验直接改旧文件”，也不是“全流程恒定内存”：逻辑事件与当前代缓存仍需持有。

[migration-verifier](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/src/migration-verifier.ts#L20-L94) 将发布验证放到 worker，并有进程级 **最多 2 个 verifier** 的调度限制。目标新打包文件 `worker.cjs` 的存在/加载由上游 [built-migration-worker E2E](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/tests/built-migration-worker.e2e.ts) 覆盖；本次未运行该测试，隔离安装验证仍应含这一发布物路径。

### 4.3 减少重复复制、冻结与 compact stream 展开

- JSONL [freezeStoredEvents](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence-jsonl/src/index.ts#L149-L154) 建立 shared-frozen event graph；handle 返回调用者拥有的外层 slice，底层事件允许共享。
- [Session restore](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/core/session/src/index.ts#L493-L560) 不再复制/重复冻结 adoptable events；运行时必需字段仍验证，embedded stream 不在这个恢复边界反复 replay。
- [Agent buildRequest](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/core/agent-loop/src/agent.ts#L579-L600) 用每 Agent WeakSet 记已完整冻结的 message identity，header 每次冻结、AbortSignal 保持活性；不是全局保留所有历史。
- [Assistant stream helpers](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/llm/llm/src/assistant-stream.ts) 新增逐 compact record 读取；token-meter、session-stats、子代理输出与客户端避免为了取最后 usage/首次 token/settled message 把整个 stream 全量展开。不能泛化成所有读取都 early exit，也不代表流式增量 UI 被取消。

对应实现提交：[流式迁移](https://github.com/deepseek-ai/deepseek-harness/commit/46196d6f9)、[publication/verification](https://github.com/deepseek-ai/deepseek-harness/commit/ec2f63dbd)、[preparation-first](https://github.com/deepseek-ai/deepseek-harness/commit/a3e5edbdb)、[frozen transfer](https://github.com/deepseek-ai/deepseek-harness/commit/9b78f99de)、[compact readers](https://github.com/deepseek-ai/deepseek-harness/commit/165cc31eb)、[request freeze reuse](https://github.com/deepseek-ai/deepseek-harness/commit/73edce1ae)。以上短 commit 链接指向固定提交，不是浮动 master。

### 4.4 官方性能证据与本次未实测边界

目标新增/集中管理 `session-open`、`agent-continuation`、`conversation-fold`、`long-session-browser`、`active-stream-reconnect` benchmarks。例如 [session-open](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/benchmarks/session-open/session-open.bench.ts#L28-L72) 的合成输入是 **200 turns / 127,400 released-v0 events**，普通场景每次新进程共 5 次取 median，另测 128 MB old-space；阶段包含 open/read/restore/projection、first-history、agent-resume，并分别测首次旧代和升级后 fresh-process reopen。

文件中的 `EXPECTED_MS`、CI scaling/headroom 和校准样本是**上游基准预算/证据**，不是本机 p50/p95、不是本插件性能测量、也不是全量真实历史日志无回归证明。结论应由旧报告“官方已知回退待修”更新为：**官方已交付明确改善机制和基准门槛；本插件收益及剩余回退未实测**。

## 5. Session Query、标题、搜索和用量

### 5.1 公共 query 形状未新增断裂

目标 [session-query/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session-query/session-query/src/index.ts) 与 alpha.1 **无 diff**；`listSessions`、`readSession`、`readTitleSnapshots`、`filterEvents` 等仍在。`readSession` 返回 snapshot 的 `.events` 没有变成 handle envelope；不要混淆这两层 API。

实质变化集中在 [cold-read](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session-query/session-query/src/cold-read.ts) 与 [observation](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session-query/session-query/src/observation.ts)：冷读把 `eventState/events` 交给 prepare，删除额外 `structuredClone` 每条事件；live observation 先捕获 `session.seq`，首次访问 `.events` 才 materialize **该固定 cursor 前缀**，不只是延迟拿一个可能已增长的新快照。只读 header/cursor/projections 的消费者不复制整条日志。对应 [lazy observation commit](https://github.com/deepseek-ai/deepseek-harness/commit/5b91dbfba)。

### 5.2 性能改善不会自动修复插件 revision adapter

当前管理列表仍会对 stale title 调 `readTitleSnapshots`；详情与本地文本搜索仍要求 body。lazy observation 的收益主要在消费者不读取 events 时，不能推导“插件搜索变成 metadata-only / 自动数据库索引”。`session-query-sqlite` 本次运行时实现没有变化（只有文档/版本/测试适配），没有证据把默认禁用的全文检索宣称自动启用。

因此应分开两个层次：**上游单次冷读/恢复少做重复工作**，但**插件旧 listSnapshots 探测缺席仍让跨重启 revision 缓存退 TTL**。旧代码注释“官方零缓存”也不再适合作为目标事实；alpha.1 已有 bounded cache、alpha.2 又继续优化。后续需要实测 cache hit/miss/TTL expiry、多会话超过 bounded cache 容量、外部 append 后失效。另须注意 [公共 stat 契约](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence/src/index.ts#L174-L190) 的 opaque revision 仅保证同 service instance、同 id 内可比较；JSONL 的 stat 派生值跨重启稳定是特定 provider 事实，不是所有 backend 都承诺落盘 title revision 可跨重启复用。

### 5.3 纠正旧报告：attempt 的“非模型消息”不等于“永无用量”

插件 [`foldUsageEvents`](../../index.js#L1778-L1811) 仍只统计 `assistant/message.data.usage`。alpha.2 [usage-projection `usageOf`](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/llm/token-meter/src/usage-projection.ts#L80-L88) 明确对 `assistant/message` **和 `assistant/attempt`** 从 embedded stream 提取 usage；alpha.1 已有相同语义，只是本次由 expand 改成 `lastAssistantStreamChunk`。

故旧报告“把 attempt 统计就会错误计费”的说法不足以成立。**已确认：这是既有口径差异而非 alpha.2 新引入。推断：存在提供方失败尝试上报 usage 时，插件累计值可能与官方 attempt-aware 统计不同。未实测：具体 provider、retry/cancel 下的差额。**本次不改变产品统计口径；后续明确计费目标后再处理，不能因为 attempt 不形成 surface message 就断言它没有资源消耗。

搜索文本是否纳入失败流是另一问题：当前插件只把 assistant message 作为回复文本，不需为性能修复强行添加失败 attempt 文本。

## 6. 子代理、路由与进程生命周期

目标仍保留 `subagents.start()` / `startContinuable()`，本插件 wrapper 的这两个入口未消失。alpha.2 新增 continuable human inbox queue/edit/delete/Steer/Stop，并拆分 continuation 内部职责；应区分新增业务能力与旧方法破坏，不能因为文件拆分就判断插件包装失效。

**已确认行为修复：**新 [inbox.ts:30–54](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subagent/subagent/src/inbox.ts#L30-L54) 读取真实 `agent.inbox.hasPending`，而不只依赖 manager 自维护 accepted-id 集合；queue 调 followup、steer 调 steer。模型 send_message 在 alpha.1 已是 steer，不是本版首次支持。[continuation-activation:677–742](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subagent/subagent/src/continuation-activation.ts#L677-L742) 自然结算先等待 idle、锁内检查 inbox/child ownership，final flush 后重新检查 poke/seq，并通过 maintenance 拿稳定 idle，避免期间接纳的工作/新子代理被误结算。对应 [新增竞争测试](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subagent/subagent/tests/continuation.spec.ts#L1051-L1231) 是上游测试源码证据，本次未执行。

**新增 RPC 契约：**人类 `subagent.prompt` 要求 `delivery:'queue'|'steer'`，见 [control schema](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subagent/subagent/src/control.ts#L21-L26)。旧调用缺字段会校验失败是源码推断；当前插件不直接调用该 RPC，不是本插件新直接断点。

**当前 wrapper 的既有技术债（不是 alpha.2 新回归）：**`index.js:4157` 的“reasoningEffort 不属于 AgentOptions”注释已过时。4217 从 creation patch 剥去 effort、4267–4284 只首轮 waterfall 补值；目标 [child-agent:98–118](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subagent/subagent/src/child-agent.ts#L98-L118) 接受该字段，[continuation:112–123](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subagent/subagent/src/continuation.ts#L112-L123) 从 creation options 写 durable descriptor，[coldResume:399–448](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subagent/subagent/src/continuation.ts#L399-L448) 从 descriptor 恢复，不再进入两个 start wrapper。alpha.1 [runtime-types:33](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/agent/src/runtime-types.ts#L25-L36) 已支持 effort、[continuation:450–465](https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/subagent/subagent/src/continuation.ts#L450-L465) 已持久化它，因此不能归因本次升级。**推断：**插件配置 effort 与官方创建参数选 effort 不等价，后续 request/冷恢复可能回默认或继承值，dispatch 展示与实际值可能分离。**未实测：**具体 route/model-selection waterfall 的最终表现。下一适配轮需分别测首轮/次轮/冷恢复，不能把创建策略宣称每次续聊动态重路由。

普通 subprocess handle 去 `pid` 是发布明确 breaking，[目标 types](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/subprocess/subprocess/src/types.ts) 中 PTY/terminal handle 不同。当前 `index.js` 没有 `.pid` 消费；`runTar` 407–435 / `runCommandResult` 1906–1933 只依赖 `spawn`、`done`、`collected.*.readFrom(0)`。因此**已确认无该字段直接命中**。但目标 `done` 也可能因 provider failure 拒绝，`terminate/waitForExit` 转向 provider-managed range 语义；当前 `await done` 会继续向外传播错误，不能据此宣称后代进程已全部清零。native containment 是否在当前 Docker 实际生效未探测，fallback 也不是逃离进程组后代的完整保证。后续须测 tar/npm 的超时/取消/provider failure 与用户可见错误、重启安全网和清理，不承诺未验证平台。

## 7. 客户端、加载和其他发布变化

### 7.1 槽/seed 维持，行为需回归

alpha.1..alpha.2 以下文件无 diff：[ui-chat slots](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/ui-chat/src/client/contract/slots.ts)、[ui-conversation slots](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/ui-conversation/src/client/contract/slots.ts)、[ui-settings slots](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/ui-settings/src/client/contract/slots.ts)、[web seed](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/web/src/seed.ts)。现有 turnTail/dock/settings 注入不需要因为本版改名。

[ChatView](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/ui-chat/src/client/chat/ChatView.tsx) 修复 pinned scroll 交付与近底部真实手势；`scrollerOf` 仍定位 `[data-conversation-scroll]`。turn-process/turn-tail 避免展开 attempt，不移除公开 tail slot。长历史加载、程序化贴底、用户手势、窗口调宽和插件“上一条用户回复”需一起测，不能仅“属性还在”就判行为完全一致。

[connection](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/connection/src/client/connection.ts) 修复 stalled handshake 与持续重试，新增/改名 recovery config；本插件 `rpcCall` 只使用 rpc.call，不调用 connection.start 或直接使用该配置类型。因而是预期改善而非当前调用破坏；断网恢复后的轮询/待决 RPC 仍未实测。

### 7.2 设置原语、hash 与 manifest

primitives 新增共享 Tag/Switch、调整 Pill/StateDot，并统一官方设置样式；不要求当前插件重写自有控件。Markdown/StatsLine 实现本次无变化；**目标 tag 源码检查不是目标发行 bundle 的 CSS hash 验证**，尤其当前仍有 `[class*="NDN2W_root"]`。

[package-manifest types](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/util/package-manifest/src/types.ts#L40-L55) 把声明集中化，`dsh.client.inject` 仍是 package-name metadata，不是 Cordis service inject；[modules](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/modules/src/index.ts) 只是改用共享类型、原 validation 仍由 reader 管理。当前 manifest 不要求迁移。

### 7.3 其余变更的真实影响边界

- **persona breaking：**自定义 persona 从 text/单 section 改 prefix/suffix、system prompt 配置与常量同步拆分。当前插件未提供 persona 配置，不是当前直接断裂；不能对使用自定义 preset 的整个部署宣称无影响。[persona source](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/preset/persona/src/index.ts)、[system-prompt](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/core/system-prompt/src/index.ts)。
- **pi-ai 0.85.1：**新增 `thinkingTokenBudgetField`、`vllmPriority`、`supportsMaxOutputTokens`、`thinking.budget` compat，另有 replay 修正；不是提供方 quota/余额 API 更新，不应推导插件固定 quota 请求要换 endpoint。[config](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/llm/llm-pi-ai/src/config.ts#L258-L273)、[catalog](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/llm/llm-pi-ai/src/catalog.ts)。
- **反馈与出网：**显式反馈成为持久事件并可独立上报相关上下文；普通聊天不是这类反馈上传触发器。当前插件不调用它，备份/导出仍应容纳新事件，而不是擅自触发反馈。[feedback source](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/feedback/message-feedback/src/index.ts)、[telemetry](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-telemetry-otel/src/index.ts)。
- **session-reference/spill：**长引用被截断的剩余内容可从 spill 按需读，预算依选中模型，不是 session-query 数据被截断或插件搜索 API 改形状。[session-reference](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/context/session-reference/src/index.ts)、[spill](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/context/session-reference/src/spill.ts)。
- **proxy 旧风险继承：**`packages/util/http-proxy` 本次只有版本变化；没有新增证据让插件 `https.get/request` 自动等同 DSH fetch 的 undici dispatcher。quota 代理/NO_PROXY 出网边界继续未实测，不把该问题标为 alpha.2 修复。
- **Open in、PTC、默认工具：**新增官方 workspace 打开入口、PTC 子调用终端详情、SDK/headless/ACP 默认 read/write/edit；当前插件不是这些工具/handle 消费者。与运维功能共存，不要求迁移本插件 RPC。

## 8. 风险账本与后续验收

| 事项 | 相对旧报告 | 当前判定/动作 |
|---|---|---|
| listSnapshots/readFrom 等旧 seam | **继承，未修** | P0，继续支持上限；下一 rc 统一 adapter |
| handle.read 数组→对象 | **新增 breaking** | 未来 adapter 必按最终 rc shape 复核，不能照搬 alpha.1 |
| locate 必不存在/删除必不可用 | **纠正旧报告** | private 同名方法尚在；公共契约风险仍有，目标 JS 运行未实测 |
| 只读即发布 generation | **上游改变/改善** | read preparation / write publish 分离；重写迁移前后回归矩阵 |
| 历史加载已知回退 | **上游交付改善，不代表插件验收** | 多层性能代码与 benchmarks，插件 p50/p95/RSS 未测 |
| snapshotEvents/inherited cut | **当前方向维持** | getter风险未重新出现；handle cut接入仍待做 |
| query readSession.events | **无新断裂** | 保持详情/搜索消费，不做全局替换 |
| attempt 不计费用量是必然正确 | **纠正旧报告** | 官方 attempt-aware；插件既有口径差异需明确 |
| 子代理队列/Steer/Stop | **新增行为** | 创建包装保留；归属/持久化/冷恢复回归 |
| subprocess pid / persona | **新增生态 breaking，无当前直接命中** | 不改本插件，只记录部署边界 |
| Client slots / seed / inject | **无新已确认断裂** | 保持；重连、贴底、尾行、hash需 E2E |
| HTTPS quota proxy | **继承，未验证** | alpha.2 未改 proxy 实现，仍需真实 egress 测试 |

### 下一 rc 适配轮的最小验收矩阵（不是本次改代码指令）

1. **契约夹具：**旧 rc、alpha.1 read-array、alpha.2 read-envelope、缺席服务、read/open/close 各失败路径；同时证明无 handle 泄漏、inherited cut 精确且不重复计费。
2. **目录与迁移：**v0/v1/v2、zstd/none、只读未发布/写恢复发布/相邻 generation、源变更/目标冲突/取消；备份恢复完整且删除仍仅对归档非 live 白名单目录；区分目录字节与所选文件字节。
3. **查询/性能：**列表/标题/详情/全文扫描分别测 cold 首次、memo hit、revision miss、TTL expiry；短长日志与超 cache 容量多会话，记录 RPC p50/p95、主线程响应、RSS/heap 与磁盘变化。上游合成预算不代替本插件基线。
4. **usage/子代理：**成功、usage-bearing attempt、重试、取消、硬中断、seeded fork；one-shot/continuable、排队/Steer/Stop、父子双向消息、冷恢复、路由来源与 dispatch turn。
5. **Web/进程/出网：**断线重连、活动流恢复、设置轮询、窄屏、调宽、滚动/历史按钮、StatsLine hash、备份 tar 取消及清理；固定 quota HTTPS 与 fetch/NO_PROXY 分开验证。

`COMPAT_BREAKS` 本次不建议新增通用方法 token（`read/listSnapshots/pid/persona` 等）：当前扫描器没有接收者/类型语义，容易误报；新标识也不是要检测的“旧破坏标识”。应以最终 rc 契约夹具和升级支持边界来管理，保留现有已确认 package/DOM 旧标识清单。

## 9. 本次验证与交付边界

当前仓库实际执行 **`node --test`：330/330 pass，0 fail，0 skip，退出码 0，约 6.735 秒**。这是本轮重新跑的结果，不是照搬旧报告的 328/328；该命令不触发 `pretest/build:client`，没有重写根 `client.js`。

未执行 alpha.2 运行实例挂载、真实历史迁移/恢复、浏览器 E2E、代理出网或上游 benchmark；本报告不声称这些验证通过。未运行会重建客户端的 `npm test`，未修改运行中 DSH，也未升级当前部署。

**最终建议：维持“暂不支持 ≥0.1.3-alpha.1，等下一 rc 一次适配”的既有决定；alpha.2 的性能工作值得关注，但 persistence 仍是升级阻断项，且 read 返回值再次变化证明等待并以最终固定源码重审是必要的。**
