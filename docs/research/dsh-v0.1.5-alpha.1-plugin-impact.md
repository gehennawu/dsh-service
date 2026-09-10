# DSH `0.1.5-alpha.1` 对 `@gehennawu/dsh-service` 的兼容性影响评估

> 调研日期：2026-09-09（本次环境 `date -I`）；前序报告：[alpha.2 影响评估](./dsh-v0.1.3-alpha.2-plugin-impact.md)。  
> 研究范围：官方 `dsh-v0.1.3-alpha.2...dsh-v0.1.5-alpha.1` **完整 Git 差异**——发布正文的 Full Changelog 正是这个区间，期间没有 0.1.3 稳定版、也没有 0.1.4 release（版本号直接从 0.1.3-alpha.2 跳到 0.1.5-alpha.1），因此上一份报告的目标 commit 就是本次的天然基线。  
> 上游基线：`82a5fd61a7cf5c293cec4bdff68f455398d685e9`（alpha.2）；目标：`5dda764ed3aa172535a7967b06ff95d9cbfe536a`（0.1.5-alpha.1）。  
> 本仓库基线：`d77c1d2ce7`，`package.json` 版本 **1.4.11**；研究期间未修改业务代码、composition、版本号或构建产物。  
> **已确认**＝固定 tag/commit 源码、官方发布数据或本次实际命令直接证明；**推断**＝源码与插件调用链推导；**未实测**＝未在目标 0.1.5-alpha.1 隔离实例做 Host/Web E2E、真实迁移/恢复、代理出网或性能测量。源码层确认不等于目标运行兼容。  
> **后继沿革（2026-09-09 适配轮补记）**：本报告收口后官方发布 `dsh-v0.1.5-alpha.2`（`b2e3b2a`，262 commits，承载 rc 前主体变化）与 `dsh-v0.1.5-rc.1`（`183f08e`；alpha.2→rc.1 仅 17 commits）。适配轮已对 **rc.1 树**逐项复核本报告全部插件消费面契约——persistence 公共面/handle.read 信封、layout rightbar 语义、StatsPills（`data-composer-stats`）、V3 事件词汇、`reasoningEfforts`/THINKING_LEVELS、`readSession` 形状、`subagents` 服务全部与本报告结论一致；适配实现见仓库 TODO.md「DSH 0.1.3-alpha.1 兼容适配」节完成标记。

## 结论摘要

**0.1.5-alpha.1 没有解除任何既有阻断——旧 persistence seam 依旧缺席（公共面逐 blob 相同），本版不是可解除版本限制的 rc；同时本窗口给下一 rc 适配清单新增了两块必须覆盖的契约：会话格式 V3 与 Web 外壳 layout 的 Details→Rightbar 改造。**

1. **P0 原样继承：**公共 `SessionPersistence` 仍只有 `create/open/flush/stat/list`；`handle.read()` 仍返回 `{eventState:'detached'|'shared-frozen', events}` 信封、`inheritedEventCount` 仍在 handle 上。JSONL 的多代 resolver、prepare-first、migration worker、private `locate` 全部是 alpha.2 已交付机制的**沿用**（本窗口 src 仅 `format.ts` +12/−1 与 `lease.ts` +4/−14），不得描述为本版新增。插件 `listSnapshots/readFrom/readRaw` 六处调用点继续是升级阻断项。
2. **新增契约（会话格式 V3）：**current version 2→3；系统提示词从 `request/header.data.header.system` 改为持久 `system/message` 事件；surface replace 坐标 `{start,end}`→`{startSeq,endSeq}`；`tool/code-dispatch(-start)`→`tool/ptc-dispatch(-start)`、`agentPreset:'code'→'ptc'`；未知且未标 `ignorable` 的第三方持久化事件**拒绝迁移**。对本插件是传递性内容变化：query/persistence 公共 API 形状零变化，**插件只读浏览（listSessions/readTitleSnapshots/readSession/filterEvents）不触发迁移写盘**（只有 `open(id,'write')` 才发布 successor）；详情视图会出现空白 `system/message` 卡片；ZIP 导出日志名变 `session.v3.jsonl`；**升级后的会话不可被旧版 DSH 读取**（备份跨版本降级路径死亡）。
3. **新增硬断裂（客户端）：**官方 layout 移除 Detail 列——`ctx.layout.openDetails/closeDetails` 删除（改 `openRightbar(track,fullscreen)/closeRightbar`）、`data-details-collapsed` 删除（改 `data-rightbar-collapsed/fullscreen/instant`）、`detailsCol`→`rightbarCol`。mobileAdaptation 的详情列状态机被系统性污染（`state.detailsOpen` 恒 true）、自愈 `closeDetails()` 静默失效（try/catch 吞掉）；StatsLine 被 StatsPills 整体替换（同槽同位、根节点改 `data-composer-stats`、双 pill 按钮 + portal 对话框），插件的 `NDN2W_root` 横滑规则无论哈希是否漂移都已落空；官方右侧栏（`ui-sidebar-right`）提供稳定 `data-sidebar-right-*` 属性族，但插件右缘手势目前只认第三方 better-sidebar，0.1.5 上无法驱动官方右栏。
4. **生态 breaking、本插件零命中：**`ctx.agent` 动态 accessor 移除（`AgentSetup` 改 `(agentCtx, agent)`、显式传 `parentAgent`）、`Inbox` 类型接口化（`hasPending/claim` 转 loop-private）、`CommandContribution.description` 改 `() => string`——本插件对三者均无调用。continuable 子代理退出 scheduler roots，但 **`sessionQuery.listSessions` 仍全量合并、无 root 过滤**——插件会话清单与用量索引范围不变。
5. **LLM/基础服务面平静：**llm-pi-ai `config.ts` 零 diff（`reasoningEfforts`/THINKING_LEVELS 7 档/协议白名单原样，pi-ai 维持 `^0.85.1`）；`systemPromptUpdate:'in-history'` 是 **llm core 模型元数据**（`LlmResolvedModelInfo` 新可选字段），不在 pi-ai settings schema 里；llm-deepseek 仅目录条目新增该可选声明，默认 V4 模型未声明；settings/credentials/webServer/timer/loader/pluginInventory/subprocess/http-proxy 均 src 零变化。会话锁 `fs-ext`→预编译 `@deepseek-ai/node-addon-system/flock`（N-API8）是纯部署利好。静态证据：插件宿主的普通 `fetch()` 会继承进程级 undici 代理策略（动态实测仍缺，见 §6.4）。
6. **当前产品决定仍有效：**`DSH_NOT_SUPPORTED_FROM='0.1.3-alpha.1'` 不动（src/client.js:2668）；适配清单在 alpha.2 报告五项之上扩充 V3 夹具、rightbar/StatsPills 真机回归、`system/message` 入噪声清单等项（§7）。

## 1. 一手来源与完整差异覆盖

### 1.1 发布事实

[官方 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-alpha.1) / [release API](https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.1.5-alpha.1) 返回 prerelease、非 draft、immutable，发布时间 `2026-09-08T16:16:04Z`，无 assets。正文要点：动态修改系统提示词且不破坏 KV Cache（模型需显式声明支持）；实验性右侧 Sidebar（多标签/分栏/全屏）并**移除原 Detail 面板**；composer 菜单层级/提示文字优化与**会话统计改为两个可展开摘要**（轮次与速度、精确 Token 用量与缓存命中）；斜杠命令说明中文化；Codex 0.153.4 / Claude Code 2.1.263；发送按钮与 Enter 行为统一；本地图片路径渲染；空消息拒绝；`fs-ext` 本地编译修复。Chores 三条 breaking：**会话格式 V3**（明确写了「自定义日志读取器需适配新格式；升级后的会话不支持降级读取」）、**移除 `ctx.agent`**、**Inbox 改类型接口**。

发布正文不是契约清单的替代物：`data-details-collapsed` 属性删除、StatsLine→StatsPills 组件替换、V3 事件形状、`CommandContribution.description` 签名变化等都必须从固定 diff 才能完整得知。

### 1.2 获取方法和范围保证

使用完整克隆 `/tmp/dsh-alpha15-research` 固定两 tag（同 alpha.2 报告方法），**没有读取/修改运行中 DSH，也没有启动替代 Web 服务**。实际执行：`git rev-parse` 两 tag、`rev-list --count`（含 `--no-merges`）、`log --no-merges --oneline`、`diff --name-status/shortstat`、全量 `git diff` 存 `/tmp/dsh-alpha15-full.diff`（9.9MB，按家族分发，不整读）。GitHub compare 只返回截断结果，不作为覆盖依据；永久入口为[固定两 commit compare](https://github.com/deepseek-ai/deepseek-harness/compare/82a5fd61a7cf5c293cec4bdff68f455398d685e9...5dda764ed3aa172535a7967b06ff95d9cbfe536a)。

结果：**563 commits（380 非 merge）、2,552 files、+78,538/−12,512**（alpha.2 窗口为 316 commits/3,790 files——本窗口 commit 更多、文件更少）。全量路径归类：`packages` 1,550、`snapshots` 303、`.agents` 207、`apps` 193、**`native` 97（新顶级目录）**、`docs` 96、`scripts` 60、`benchmarks` 14、`.github` 14、`python` 5、`website` 1、根配置 4。大数字主要含 notes 归档、文档与批量版本更新，不能等同运行时破坏点。**packages/ 下本窗口没有任何整包删除**（唯一删除是 `native/landlock-run` 工作区重组为 `native/system`），manifest 层无新增移除包。

### 1.3 完整差异分流矩阵

| 差异家族 | 本次处理 | 对当前插件判断 |
|---|---|---|
| session-format V3（新包 `session-format-v2-to-v3` 20 文件、catalog/admission/references） | 逐条追 migration/validation/payload 契约与只读路径 | 内容传递变化；query/persistence API 形状不变；写时才发布 |
| session-persistence(-jsonl) | 公共面 blob 对比 + src diff 归因（仅 format/lease） | P0 继承；机制沿用；锁换预编译 flock |
| session-query / log-export / telemetry | 公共面与 archive blob 对比 | 零 API 变化；ZIP 文件名随版本变 v3；telemetry 透传 V3 body |
| ui-layout Details→Rightbar / 新包 ui-sidebar-right(-files/-textpreview)/ui-dockkit | 逐文件追 service/AppFrame/columns/RightbarSeat | **本插件最大新断裂**；mobileAdaptation 需迁移语义 |
| 新增 workspace-files / client-resources（remotes `workspaceFiles` namespace、Host row 挂载、`dsh-resource://file` provider） | 新服务 wiring 核对（`remotes/src/client/index.ts:5-26,142-160`、`cordis.patch.yml:108-111`） | 插件零消费；为官方右栏文件/资源面服务 |
| ui-chat StatsLine→StatsPills / composer / 槽位契约 | 契约 diff + 组件替换核对 | 横滑 CSS 落空；turnTail/dock/input/settings 槽全保留 |
| web seed / platform modules / primitives MarkdownText | 成员 diff + labels 契约对比 | 8→9 纯增量；labels 契约不变；`pathImages` 可选新增 |
| agent/agent-loop/subagent（ctx.agent、Inbox、continuable 归属） | 逐 setup/enter/descriptor/corpus 证据 | 生态 breaking 零命中；会话列表可见性不变 |
| llm-pi-ai / llm-deepseek / llm core / token-meter | config/catalog/adapter/usage-projection diff | 零 schema 变化；`systemPromptUpdate` 为 core 元数据新增 |
| subprocess / native(node-addon-system) | types/src diff + workspace 重组 | subprocess src 零变化；锁预编译化（部署利好） |
| settings/credentials/webserver/timer/loader/plugin-inventory | blob 对比 | 全部 src 零变化 |
| connection / client modules / gateway / remotes / session-controller | 注入结构与 wire event 对比 | `rpc.call` 形状不变；wire 严格 admission 属官方客户端内部；gateway identity 改信任 invocation source 的 scoped `agentId`（`gateway/src/types.ts:29-37`）——插件零消费，第三方代发事件须防伪造 |
| persona / system-prompt / feedback / spill / web-search / http-proxy | blob 对比 | persona 本窗口无新变化；spill 仅事件词汇改名；proxy 零 src 变化 |
| snapshots/.agents/docs/apps/scripts/CI/bench | 目录分流 | 不是插件消费面 |

## 2. 当前仓库状态：不能沿用旧报告的「当前」

当前直接证据：[`package.json`](../../package.json)、[`index.js`](../../index.js)、[`src/client.js`](../../src/client.js)、[`TODO.md`](../../TODO.md)。

- 版本 **1.4.11** @ `d77c1d2ce7`（alpha.2 报告基线 `d43d161` 之后新增两个提交：subagent 模式切换保留路由草稿 + 配套测试）。`node --test` **332/332 绿**（上一轮 330；+2 来自这两个提交）。
- persistence 旧 seam 原样：`index.js:602,682,1872,2253,3490` 的 `listSnapshots`、`1883` 的 `readFrom`、`682` 的 `readRaw` 能力门、`1761` `inheritedEventCountFor`、`1774` `usageReadEvents(.events)`、`1778` `foldUsageEvents`（只计 `assistant/message.data.usage`）、`3235` `snapshotEvents()` 优先、`3394` `sessionEventText` 固定白名单归一化、`3448-3456` 其 default 分支、`148-152` `SESSION_NOISE_TYPES`。
- **mobileAdaptation 对外壳 layout 的依赖比 alpha.2 报告时显著加深**（v1.4.10–11 边缘手势：`ctx.layout.toggleSidebar`、`data-sidebar-collapsed`、better-sidebar 开关钮缝、frame 属性观察）——因此 0.1.5 的 Details→Rightbar 对本插件是历次生态变更里直接命中面最大的一次（§4）。
- `DSH_NOT_SUPPORTED_FROM='0.1.3-alpha.1'`（src/client.js:2668）；TODO.md「等下一 rc 一次适配」决定与五项验收清单继续有效。
- `plugin-compat.js` 现有 `COMPAT_BREAKS` 5 条（manifest：client-runtime / session-persistence-sqlite；code：`Md3f7G_` / `FJxK0a_` / `data-time-hover-root`）；本窗口无新移除包、无新增已证实通用破坏标识（§7 给出维护建议）。
- **两个缓存认知被本轮纠正**（写入报告并建议回修 AGENTS.md）：① platform seed 在 alpha.2 已是 **8 成员**（`@deepseek-ai/dsh-client-store` 已在列），0.1.5 变 9（+`ui-dockkit`）——「7 成员」是 0.1.2 时代缓存；② 官方 `turn-process` 的 9 段编码串**在 alpha.2 之前的公共祖先就已改为对象直存**（B/T 均为 `conversation-nodes/turn-process.ts` 对象、9 字段含义不变），插件按 9 段串解码 `subagentCount` 的前提属存量漂移，需在适配轮一并重审，**不是 0.1.5 新增断裂**。

## 3. Persistence：P0 原样继承；本窗口真正的新增量是会话格式 V3

### 3.1 公共方法没有回滚，机制全部沿用

【已确认｜基线=目标】`packages/session/session-persistence/src/index.ts:46-59,135-198` 仍只声明 `create/open/flush/stat/list`，`listSnapshots/readFrom/readRaw` 依旧缺席；`src/handle.ts:22-31` `read()` 仍返回 `{eventState, events}` 信封，`:59-83` `inheritedEventCount` 仍在 handle 上；`stat/list` 仍是轻量观察（`sizeBytes`=所选物理 artifact、opaque revision 只保证同 service+session 内「相等即可视作未变」）。

【已确认｜基线=目标】JSONL 的多代 resolver（`session-persistence-jsonl/src/index.ts:1368-1405`，按数值版本选最高 generation）、read prepare / write publish 分离（`:336-387,494-526`）、migration worker 发布物（`package.json` files 含 `lib/worker.cjs`）、TS private `locate`（`:289-295`）、revision 公式 `dev:ino:size:mtimeNs:ctimeNs`（`:173-182`）全部为 alpha.2 已交付机制沿用。本窗口该包 src 仅 `format.ts`（+12/−1，V3 接线）与 `lease.ts`（+4/−14，锁实现替换，§6.3）；其余 16 个变更文件全是测试与 README。

| 当前调用 | 0.1.5-alpha.1 状态 | 风险分类 |
|---|---|---|
| `index.js:602,1872` 用量刷新 `listSnapshots/readFrom` | 调用不存在的旧方法，入口先失败 | **已确认，继承 P0** |
| `index.js:2253` session-storage 诊断 | 异常转 error 项 | **已确认，继承** |
| `index.js:3490` 标题 revision 源 | 显式探测缺席 → TTL 兜底 | **已确认，继承性能降级** |
| `index.js:682` 备份 `readRaw` 能力门 | false → 物理整树 tar 回退 | **已确认，继承**（V3 使 tar 更大，§3.4） |
| `index.js:3433/3759` size/delete `locate` | private 方法仍在 | **契约风险继承，未实测** |

### 3.2 V3 契约逐条

【已确认】catalog `session-format-catalog/src/generated.ts:9-30`：currentVersion 2→3，链 `[v0→v1, v1→v2, v2→v3]`，新包 `session-format-v2-to-v3/src/migration.ts:11-22,24-42` 定义该边（header `version:2→3`、`agentPreset:'code'→'ptc'`）。

- **系统提示词入史：**每个 session 首个 `step/start` 后插入 `system/message`（即使 step abort）；`request/header.data.header.system` 变化时在该 header 前插入/替换 system head，**`system` 字段从 request/header 删除**。事件 `data={turn,step,message}`、role=`system`、空 prompt `content:[]`、source 固定 `{kind:'plugin', plugin:'@deepseek-ai/dsh-system-prompt'}`、确定性 id `v2-to-v3-system-`+SHA256（`migration.ts:50-74,109-136`、README:65-74）。
- **surface 坐标：**canonical `{op:'replace',start,end}` → `{op:'replace',startSeq,endSeq}`，四种 surface 强制 surfaceOp，assistant 禁 `sourceEventSeqs`、其余必须非空唯一且指向前序（`payload.ts:300-370`、README:103-110）。
- **PTC 词汇：**`tool/code-dispatch-start`→`tool/ptc-dispatch-start`、`tool/code-dispatch`→`tool/ptc-dispatch`；仅五个 message slot 中 `source.kind==='plugin' && plugin==='tools-code-mode'` 改 `'tools-ptc'`；不改 run_code/参数/id（`migration.ts:139-172`、README:92-101）。spill-policy 本体仅约 2 行事件词汇注释同步（code→ptc），监听事件（`tools/ptc-dispatch-log`）与算法/策略零变化【已确认 非行为变化】；durable call-id 词汇（`parent-1:code:1`→`parent-1:ptc:1`）随 PTC 改名发生在派发侧，非 spill 策略本体。
- **严格 admission（拒绝而非静默）：**未知事件、未审计成员、未知 content kind、坏 block、step 前引用、step 外 prompt 变化、id 冲突等 → **拒绝迁移、源文件不动、无 successor**（`validation.ts:24-119`、README:117-136）。JSONL scanner 在既有 recovery 分支**前**定向调用 `assertV3RowAdmission`（`format.ts:476-510`）：这是有意的 fail-closed unsupported-generation 兼容策略——obsolete/未审计代际行拒绝，普通 malformed EOF 仍走原 recoverable-tail 语义（目标测试刻意覆盖两种路径）。assistant/attempt embedded stream 仅审计不改字节，V3 不新增 usage 载点（README:120-134）。
- 【已确认·运行时 durable contract】V3 不止迁移期校验：`core/session/src/index.ts` 的 adopt/load/append 路径做 event-local payload 与 surface metadata 校验（新增 system/message 的 role/plugin-source 检查与 strict envelope 保护，`src/index.ts:166-185,198-239,302-353,690-730`），invariant 要求 system/message 位于 open step 内（`src/invariant.ts:133-154`），request-header canonical/equality 删除 `header.system`（prompt 改由 surface 派生，`request-header.ts:14-52`）。本插件只读、从不 append 会话事件，零改动；第三方若自行 append Session event 需按新契约。
- 【已确认·机制】迁移链的 inherited cut 输入由 `number` 放宽为 `number | undefined`（`session-format/src/types.ts:51-69`、`chain.ts:79-119,202-231`、`catalog.ts:130-151`）——允许在 body 解码完成后才校验/确定 cut，服务 V3 头部插入 `system/message` 后 target cut 不可预知的多代 streaming migration；【未实测】大日志/导出路径的实测行为。
- **生态含义：**第三方插件往会话里写的自定义持久化事件若不在 known set 且未标 `ignorable:true`，升级后该会话将**迁移失败**。dsh-service 不写任何自定义会话事件（turn-process key 是客户端内存 keyed store，非持久化事件），【已确认】无此风险；但这是兼容性扫描器未来值得记录的生态破坏面。（调研过程中曾怀疑「request/header `startsSeries` 在 tools 变化时漏置位」为上游契约不一致，经主会话独立复核源码与时序后判定**不成立**：`systemPrompt.project()` 的 toolsChanged 替换提交先于 `buildRequest` 执行并推高 `surface.replaceGeneration`，`buildRequest`（`agent.ts:568-580`）比较的正是该代数，admission spec 的 `tools` 用例因此满足——**已核验不构成 finding**，不入风险账。）

### 3.3 迁移时机：插件只读浏览不触发迁移写盘

【已确认】`list/stat` 只读所选 generation 的 header/revision/size（`:425-489,975-1061`）；`requireStoredLog` 对冷读只做内存 prepare（`:494-526` → `generation.ts:940-1000` 返回显式幂等 `publish()`）；**只有 `open(id,'write')` 取得写 claim/lease 后才 `publishStoredMigration`**（`:363-387,642-664`；临时文件→隔离 worker 校验→源 identity 重检→独占 hard-link 发布，`generation.ts:879-938`，源 generation 保留）。因此插件的 `listSessions`（corpus 只调 persistence listing，不读 body）、`readTitleSnapshots`、`readSession`、`filterEvents` 全部**不产生迁移写盘**；【推断】用户在官方界面继续该会话（write open）才会在磁盘出现 `session.v3.jsonl`。【未实测】目标实例上的真实磁盘副作用。

### 3.4 多代并存、备份与降级读取

- 【已确认】目录内 `session.v2.jsonl[.zstd]` 与 successor `session.v3.jsonl[.zstd]` 并存是设计（resolver 选最高数值版本）；官方 `stat/list` 只计所选 artifact，插件目录求和口径的偏差在多代目录下进一步扩大（本插件「目录字节」包含两代文件 + lock 等）。
- 【已确认｜推断】插件物理整树 tar 备份会一并带走两代文件；**降级读取断裂**：旧版 DSH 的 resolver 同样选最高代 → 选中 v3 但无 V3 codec → 拒绝（catalog B 无 v3；`refuseForeignFormatVersion` 仍在）——即使 v2 原文件还在，也不能把升级后的备份恢复回旧版当可读降级。README:197 明确不提供已写 V3 文件的兼容/修复。**「备份恢复到旧版 DSH」自 0.1.5 起不再是可行降级方案**，适配轮的备份说明与验收须按此更新。
- 【已确认】删除路径不受新影响：仍以 private `locate` 取目录 + 整目录 rm，且保留「已归档、非 live」双重复检门槛。

### 3.5 query、搜索、详情、ZIP 与用量

- 【已确认】session-query 公共面零变化：exports/engine/返回形状 blob 相同（`index.ts:61-391`、`types.ts:23-288`），唯一 src diff 是 `tracing.ts` 类型断言简化；`readSession` 仍返回 `{session, inheritedEventCount, events}` 普通数组（`:178-195`），不是 handle envelope；cold-read/observation 的 live-first/revision LRU/lazy snapshot 语义不变。
- 【已确认】搜索：`extraction.ts:15-43` 无 `system/message` 分支（基线=目标）→ `filterEvents` 语义文本**不索引**迁移后的系统提示词——插件搜索行为不变，也符合「系统提示词不算对话文本」的口径。
- 【已确认】详情：插件宿主的 `sessionEventText`（index.js:3394-3456）是固定类型白名单归一化（`user/message`/`assistant/message`/`tool/call`/`tool/result`/`todo/write`/`turn/end`），`system/message` 落 default 返回空串且不在 `SESSION_NOISE_TYPES`（index.js:148-152）→ 详情视图会出现**空白非噪声卡片**（不崩）。适配轮把它加入噪声清单即可。（官方客户端 `SessionWireEvent` 的严格 envelope admission 是官方消费路径的内部约束，不适用于插件自有 RPC 投影。）
- 【已确认】ZIP 导出：`session-log-export` handler 与 `archive.ts` blob 不变（GET/HEAD、`sessionId` 必填、`includeDescendants` 仅 `'true'|'false'`、先 flush live、404/500 语义、fflate 流式、附件去重）；因 `SESSION_FORMAT_VERSION=3`，entry 名 `session.v2.jsonl`→`session.v3.jsonl`，且旧 v2 日志经 read handle 内存迁移后按 **V3 逻辑 header/events** 序列化。插件客户端直连下载链路不受影响。【推断】部署若解包分析 ZIP 需按 V3 解读。
- 【已确认·本插件不消费】`session-log-deepseek`（0.1.2 起的可选官方增量上传）本窗口有实质变化：① wire canonicalization——`wireEvent` 从所有事件统一可选 `surfaceOp/sourceEventSeqs` 改为**按事件类型分支**（`system/message`/`user/message`/`tool/result` 必带 `surfaceOp`，`assistant/message` 可带 `surfaceOp` 但禁 `sourceEventSeqs`，log-only 事件不携二者，未知但 `ignorable:true` 事件保留不透明 metadata），replacement 字段 `{start,end}`→`{startSeq,endSeq}`，`types.ts` 的 wire event 改为按 type 的 discriminated union（`src/index.ts:71-110`、`types.ts:20-56`）；② replay/checkpoint 窗口——delivery marker/checkpoint 在 accept 后才落，2xx 后崩溃可重复发送 suffix，服务端需按 at-least-once 幂等，且 `acceptedThrough()` 按格式版本匹配、旧 V2 marker 不作当前代 watermark（`src/index.ts:166-188`）。自建 DeepSeek API extension 解析器/fixture 的第三方需适配；本插件不解析该 extension，零消费。【未实测】真实 2xx/crash/replay 与服务端严格性。
- 【已确认】用量：`usage-projection.ts:77-86,110-150` 语义不变（`assistant/message.data.usage` 优先，message/attempt embedded stream 兜底），V3 无新载点——插件既有口径（不计失败 attempt）维持 alpha.2 报告 §5.3 的判定，非本版新引入。同族内部重构【已确认·零消费】：token-meter 其余实现（`estimate.ts` 的 `estimateSystemMessage`、`breakdown-projection.ts` stateVersion 2→4 改 retained-surface nodes 驱动、`index.ts` assistant anchor 改 commit 前 surface、`surface-fold/surface-projection` 改 V3 坐标）转为 durable surface 驱动计费；本插件不经 token-meter projection 取数（grep `contextBreakdown/breakdown/stateVersion/systemTokens` 零命中，用量折算直接读原始事件），无需动作。

## 4. Web 外壳：Details→Rightbar、StatsPills 与缓存认知纠正

### 4.1 layout 硬断裂（本插件最大新断裂）

【已确认】对比证据：

| 面 | alpha.2（基线） | 0.1.5（目标） |
|---|---|---|
| `ILayout` | `toggleSidebar/openDetails/closeDetails`（`ui-layout/src/client/service.ts:23-30,47-60`） | `toggleSidebar/openRightbar(track,fullscreen)/closeRightbar`（`service.ts:23-35,53-66`），**Details 两方法删除** |
| AppFrame slot/grid | `details` slot、`detailsCol`、grid `sidebar|center|details`（`AppFrame.tsx:24-27,35-38,175-215`） | `rightbar` slot、`rightbarCol`+`data-rightbar-col`、grid `sidebar|center|rightbar`（`AppFrame.tsx:29-46,193-245`） |
| frame 属性 | `data-details-collapsed`（`:181-182`） | **删除**；改 `data-rightbar-collapsed/fullscreen/instant`（`:202-204`） |
| 几何 | CENTER_MIN=640、DETAILS 300–520/default 360（`columns.ts:16-39,52-76`） | CENTER_MIN=400、RIGHTBAR_MIN=300、最大 70vw、首次偏好 45%，track 可为 0 而面板悬浮 center 边缘（`columns.ts:7-29,42-56`） |
| 保留 | `data-sidebar-collapsed`（T `:201-205`）、`[data-shell-overlay]`（T `:238-240`） | 均保留 |

插件命中点【已确认】：`src/client.js:7930-7937` 调 `layout.closeDetails()`（try/catch 吞掉→自愈静默失效）；`:7983-7987` 读 `data-details-collapsed`→**`state.detailsOpen` 恒 true**（属性永不存在）；`:8773-8775` 查/标 `detailsCol`（永不匹配）；`:8846-8853` attributeFilter 里的 `data-details-collapsed` 永不再触发；`:8948-8953` 清理 `data-dshsvc-details` 标记（永无对象）。左抽屉手势链路（`data-sidebar-collapsed` + `toggleSidebar`）不受影响；chat 相位包裹层上溯（`8028-8047`）与 `[data-conversation-scroll]` 所有权不变。

### 4.2 官方右侧栏：稳定属性族与右缘手势缺口

【已确认】新包 `ui-sidebar-right`（及 `ui-sidebar-files`/`ui-sidebar-textpreview`）：`RightbarSeat` 取 `shown/track/fullscreen` 并经 layout 上报（`SidebarRight.tsx:348-421`），**<768px 自动 fullscreen**（`:358-367`）；panel 稳定属性 `data-sidebar-right-panel='fullscreen|push'`、`data-sidebar-right-open`、`aria-hidden`，float 形态 portal 到 body（`data-sidebar-right-float-host`，`:287-339`）；展开钮 `data-sidebar-right-expand`（`ExpandButton.tsx:35-43`）、toggle `data-sidebar-right-toggle`（`:270-277`）。

【已确认+推断】插件右缘手势目前仅按第三方 better-sidebar 的 `data-dsh-panel-host`/`data-dsh-sidebar-collapsed` 识别右栏（`src/client.js:7987-7995`）→ 0.1.5 上**不会识别官方右栏**，右缘手势对它无效。适配方向：识别语义从「第三方插件存在性」扩展为「官方 rightbar 或第三方 panel 任一」，开合控制缝官方侧走 `data-sidebar-right-toggle`（或 `ctx.layout.openRightbar/closeRightbar`），第三方侧维持既有程序化 click。

### 4.3 StatsLine→StatsPills：横滑规则落空与交互冲突

【已确认】`conversation.composer.dock` 槽位/id/order 不变（`ui-chat/apply.ts:155-158`→`:165-168`），occupant 由 StatsLine 换成 StatsPills：根节点 `data-composer-stats`、两个 pill、互斥展开、pill 是 `aria-haspopup=dialog` 按钮、展开内容 portal 到 `document.body`（`StatsPills.tsx:174-306,311-353`；`stat-dialog.module.css` fixed z1100）。

- 插件移动端横滑规则 `html[data-dshsvc-mobile] [class*="NDN2W_root"]{overflow-x:auto...}`（src/client.js:7776-7787）在目标**必然落空**（组件已替换）；且对新交互**不应**简单把规则改挂 `data-composer-stats`——对一排按钮容器强制 `overflow-x:auto` 会与 pill 点击/展开冲突。适配方向：窄屏先验证 StatsPills 自身是否已放得下（InputBar 有 `:has([data-composer-stats])` 让位样式），确需横滑再按官方结构做，且排除 button/dialog。
- 【已确认·方法论教训】**生成 CSS hash 不能从源码推导**：本轮回推基线 StatsLine 哈希得 `oUIkGq_`，与真机 alpha.2 观察的 `-NDN2W_` 不符——哈希是构建产物事实，今后所有哈希类结论一律以真机 bundle 为准并标未实测。插件的 StatsLine 精确哈希选择器（`:7780`）本就是技术债，此次适配应换成稳定属性/词干。
- composer 其余：`conversation.input.left/right` 注册面保留（`ui-conversation/contract/slots.ts:164-185`）；模型选择弹层官方也迁到 body portal（`ui-model-selection/ModelSelect.tsx:261-299`）——印证插件既有 portal 策略；`uV2eYG_*` 旧词干哈希兼容性未实测。

### 4.4 保留面与缓存认知纠正

【已确认】以下全部保留：`settings.section` 契约（id/order/label/only，`ui-settings/contract/slots.ts:42-54`）与 188px 导航；`conversation.chat.turnTail` chain 槽（`ui-chat/contract/slots.ts:206-212`，owner 仅新增可选 `openFile(path,{line})`，插件不消费）；`data-chat-flow-kind`/`data-turn-tail`/`data-turn-process-*` 与 ChatNodeSeat；`*_toBottomSlot`/`*_toBottom`/`*_older` 词干与 TurnNavigator 双门控；`ctx.locale` register/bind；`ctx.connection.rpc.call` 形状（channel 单层绝对路径+endpoint）。

【已确认】MarkdownText：labels 契约不变（`code.copyLabel/copiedLabel`+`footnotes` 仍必填），新增**可选** `pathImages` 与本地路径图片改写词表——插件详情视图不传 `pathImages`，本地图片不渲染（特性缺口，非断裂）。

【已确认】seed 8→9（+`ui-dockkit`，纯增量，插件 `require('ui-primitives')` 不受影响）；`CommandContribution.description: string → () => string`（`ui-commands/contract.ts:46-54`，字符串注册在目标会 TypeError）——本插件零注册零消费，生态项；connection 宿主半 webServer 改可选注入（carrier-neutral，常规部署 `/plugins` bundle 路由不变）；斜杠命令中文化仅官方内置文案。

## 5. 子代理与 Agent API：生态 breaking，插件零命中

- **`ctx.agent` 移除**【已确认】：仅动态 accessor 消失——`AgentSetup` 改 `(agentCtx, agent)`（`core/agent/src/index.ts:44-53`）、`Create/Resume` 显式 `parentAgent`（`:62-66,125-129`）、`agents.enter(agent, parentAgent)`（`agent-loop/src/index.ts:667`，基线为 `enter(agent, ownerCtx.agent)`）；`Agent.ctx`/`ctx.agents`/agent 事件保留；`agent/created` payload 仍 `{agent}`。本插件不使用 `ctx.agent`（grep 零命中），零影响。
- **Inbox 类型接口化**【已确认】：公共 `Inbox` interface 无 `hasPending/claim`（`runtime-types.ts:47-100`），实现转 loop-private（`agent-loop/src/inbox.ts:74-115`），session controller 改从 projection onChanged 发 queue（`session-controller/src/control.ts:26-41`），subagent inbox 改列表长度判断（`subagent/src/inbox.ts:37-39`）。本插件不消费 Inbox。
- **continuable 归属修正**【已确认】：create/resume 显式 `parentAgent: parent`（`continuation-activation.ts:580-606`），child 不再进 scheduler roots；**但 `sessionQuery.listSessions` 仍全量合并 persisted+live、无 root 过滤**（`session-query/src/corpus.ts:61-79`），客户端 `ctx.sessions.list` 同样全量（`manager.ts:452-467`，另有独立 child catalog）→【推断】插件会话清单内容与用量索引范围不变。
- **`subagents` 服务与包装兼容**【已确认】：`Context.subagents`/manager/projections 保留（`subagent/src/index.ts:131-134,196-213,225-226,551-563`）；`ContinuableStartSpec`/返回 blob 相同（`types.ts:31-58`）；descriptor version 仍 3、字段相同（`descriptor.ts:48,60-85`）；coldResume fold 不变（`continuation.ts:396-448`）。tool-subagent 的 `subagent-model-selection`（enabled/allowedModels/list_subagent_models/preflight）保留，策略采样从按 Agent 改按 Session（`tool-subagent/src/index.ts:620-645`），本插件走自己的创建层注入、不依赖该 lookup。
- **`agent/request` waterfall：payload 不变、时序有变**【已确认+推断】：payload 仍 `{agent, turn, step, signal}`（`runtime-types.ts:340-347`），官方 `installModelSelection` 的「先 `next()`→剥 `_inheritedEffort`→写 selection」也不变（`model-selection.ts:91-105`）——插件「仅缺值时补+一次性消费+按 proposal 复审」纪律仍成立。但目标把 request admission（waterfall→`llm.prepareCall`）移到**当轮 system/user durable commit 之前**，request messages 改由 `session.deriveMessages()` 重建/freeze、`options.system` 不再下传（`agent-loop/src/agent.ts:352-379,500-617`；基线旧顺序 `:295-301,346-364,545-550`）。插件现实现（首轮仅补路由字段）兼容；但 waterfall 内**不得**读取当轮刚 append 的消息、不得依赖 `request.system`——未来扩展时按新时序复核。【未实测】真实多轮/冷恢复场景。
- 【已确认】Codex 0.149.1→0.153.4、Claude SDK 0.3.241→0.3.263 / CLI 2.1.263，显式模型配置语义保留、Codex 未配置用上游默认——不影响插件 wrapper。
- 【继承】alpha.2 报告 §6 记录的 wrapper 技术债（`index.js:4157` 过时注释、effort 注入与官方创建参数不等价的边界）仍待适配轮处理，本窗口无新增相关变化。

## 6. LLM 配置、进程、部署与出网

### 6.1 llm-pi-ai / pi-ai / llm-deepseek

- 【已确认】`llm-pi-ai/src/config.ts` 零 diff：路由级字段全集、模型条目 `id/name/contextWindow/maxTokens/input/reasoningEfforts/compat`、`reasoningEfforts` 规则（省略=继承、`false`=禁用、空 map 拒绝、仅 `off` 可 null、显式 map 至少一个非 off）、协议白名单 `{openai-completions,openai-responses,anthropic-messages}`（`provider.ts:47-63`）、THINKING_LEVELS 七档 drift gate（`catalog.ts:68-85`）全部原样；pi-ai 维持 `^0.85.1`（package.json+lock 均未动）。插件额度/模型目录消费（`resolveModelInfo().reasoning.efforts`、`llm.stream/listProviders`）零契约变化。
- 【已确认】动态系统提示词的落点：**不在** pi-ai settings schema，而是 llm core 模型元数据 `SystemPromptUpdate='in-history'` / `LlmResolvedModelInfo.systemPromptUpdate?`（`llm/src/types.ts:339-357`，校验在 `llm/src/index.ts:771-802`）；llm-pi-ai 唯一实质实现变化是 `context.ts:131-161` 新增 `splitSystemPrompt()`（首个 history system 提升为 pi-ai `systemPrompt` 槽，后置 system 折叠为 user 保序）——这是**能力边界而非路由缺陷**：通用 pi-ai 适配器无 `systemPromptUpdate` 元数据，agent-loop 只对显式声明 `in-history` 的适配器在缓存历史后追加 mid-history system；`llm.stream({system, messages})` 一次性调用形状兼容。llm-deepseek 目录条目新增可选 `systemPromptUpdate: z.const('in-history')`（`index.ts:172-176`，动态校验 `:262-275`），默认 V4 三模型未声明。
- 【推断】插件若在适配轮读 `resolveModelInfo`，对 `systemPromptUpdate` 按缺省=「仅 leading system 生效」降级；不要把该字段写进 pi-ai settings schema；也不要把任意 adapter 的 `in-history` 声明当可信输入（误报会改变 prompt 追加位置与指令作用域，`llm/src/types.ts:339-357`）。

### 6.2 subprocess 与 native 部署

- 【已确认】subprocess 全家（types/local/E2B/PTY）src 零变化（仅 README/版本）；pid 移除是 alpha.2 的事。补充语义确认：`SubprocessOutcome` 只有 `exitCode/signal`，非零退出是 resolved outcome 而非 `done` rejection；spawn/provider 失败才 reject；`done` ≠ 后代进程已完全退出——插件备份/删除前的进程清理判断继续沿用 `terminate/waitForExit` 语义纪律。
- 【已确认】`native/landlock-run` → `native/system`（0.1.1→0.1.2）：entry 包不再提供旧根 export，公开 `./landlock-run`、`./flock` 子路径；新增 N-API8 POSIX flock（异步 `flock(LOCK_EX|LOCK_NB)`，EAGAIN/EWOULDBLOCK 映射竞争）；JSONL `lease.ts` 由 `fs-ext` 换 `tryLockExclusive`，保留 inode/dev 校验、3 次重试、Windows 分支。预编译矩阵覆盖 Linux glibc/musl + macOS x64/arm64——**受支持平台安装不再需要编译工具链**（发布说明「fs-ext 本地编译修复」的实体）。插件只用 `subprocess` 服务、不 import 旧 landlock/fs-ext 包，零动作；锁行为本身（`session.lock` 非阻塞 flock）不变，重启安全网与备份期行为不受影响。

### 6.3 基础服务

【已确认】settings（register/get/watch/update/replace/mutate、命名空间串行写、revision/last-good）、settings-file（watch/debounce/非法 reload 保 last-good）、credentials（resolve/describe/set/unset、env>file>.env 优先级、env 遮蔽）、webServer（exact/prefix 路由、disposer 语义）、timer、loader（`entries()` 顺序与 fiber 语义）、pluginInventory（直读 loader 快照）全部 src 零变化。`client/modules` 的 webServer 改可选注入 + 新增无 Web 宿主时的 `fetchBundle` 兜底——常规部署插件 bundle 装载路径不变。

【已确认·目标新增·部署风险】`/api/file`（`session-controller/src/media-references.ts:62-75`，基线无此 endpoint；范围内经 `b52966922`/`7a715e791`/`cb3df20cf` 逐步放宽并移除旧限制文档）为本地图片渲染而设：authenticated GET/HEAD 按绝对路径读取 regular file，`fs.resolve` 仅规范化、**无 workspace containment**（`fs-local/src/index.ts:59-64`），边界完全依赖 connection 全局认证——且宽访问是**设计选择**，不应预期上游收窄。含义：① 它不是 workspace-only media API，插件不应引导用户把它当受限读取面，也不要额外拼装/外发该 URL；② 部署若经 trustedHosts/反代把已认证远端放进来，等效放开「宿主进程可读的任意文件」——本插件安全教义「仅 loopback RPC」的边界叙述在 0.1.5 部署里更要用同一把尺子衡量官方自身端点。

### 6.4 出网与代理（继承未决项取得静态证据）

【已确认】`http-proxy` 实现本窗口零 src 变化；策略在首个插件 mount 前安装、进程级 undici global dispatcher，按 `http_proxy/https_proxy/all_proxy/no_proxy`（大小写）处理、loopback/NO_PROXY bypass。【确认的静态推论】宿主插件里不指定 dispatcher 的普通 `globalThis.fetch()`（即插件 quota 查询的路径）会**继承该 dispatcher**，受代理环境变量管辖；例外面：显式自建 transport/Agent、`web-fetch-http` 的 direct pinning 分支、OTel（走 `node:http`，有测试断言不走代理）、worker thread（独立 global）、浏览器端 fetch。【推断+未实测】插件 quota HTTPS 出网在代理环境下的真实行为仍需动态验证，但性质从「完全未决」收敛为「静态证据明确、待实测确认」。

## 7. 风险账本与后续验收

| 事项 | 相对 alpha.2 报告 | 当前判定/动作 |
|---|---|---|
| listSnapshots/readFrom/readRaw 旧 seam | **继承，未修**（公共面 blob 相同） | P0，继续支持上限；下一 rc 统一 adapter |
| handle.read 信封 / cut 在 handle | **继承**（形状未再变化） | 适配按 `{eventState,events}` + `handle.inheritedEventCount`，alpha.2 方案可复核沿用 |
| JSONL 机制（多代/prepare-first/worker/locate） | **澄清为沿用**（alpha.2 已交付） | 不再当作 0.1.5 变化；口径按基线=目标 |
| 会话格式 V3 | **新增** | 内容传递变化+写时发布+严格 admission；插件浏览不迁移用户日志 |
| 降级读取 | **新增断裂** | 升级后备份不可回旧版恢复；备份文档与验收更新 |
| 详情空白 `system/message` 卡 | **新增（轻微）** | 加入 SESSION_NOISE_TYPES；详情不崩【已确认】 |
| 搜索/用量口径 | **无新断裂** | extraction 无 system 分支；usageOf 语义不变 |
| ZIP 导出 | **无断裂，内容变化** | 文件名 v3；下载链路不变 |
| ctx.layout Details→Rightbar | **新增硬断裂** | mobileAdaptation 状态机/观察器/标记全面迁移 rightbar 语义 |
| 官方右侧栏识别 | **新增缺口** | 右缘手势接入 `data-sidebar-right-*`/openRightbar 缝 |
| StatsLine→StatsPills | **新增断裂** | 横滑规则重设计；哈希一律真机验证；避免对按钮容器强推 overflow |
| turn-process 9 段串 | **纠正缓存** | 对象直存发生在更早版本；解码链路适配轮重审，非 0.1.5 新增 |
| ctx.agent / Inbox / CommandContribution.description | **新增生态 breaking，零命中** | 不改本插件；兼容扫描器可记录为生态面 |
| continuable 子代理可见性 | **澄清** | scheduler 排除但列表全量——插件清单/用量范围不变 |
| llm-pi-ai schema / THINKING_LEVELS / llm-deepseek | **零变化** | models.dev 配置流与额度别名不受阻 |
| subprocess / 基础服务 | **零 src 变化** | 既有调用保留 |
| fs-ext→node-addon-system | **部署利好** | 无需编译工具链；插件零动作 |
| HTTPS quota 代理 | **静态证据收敛，仍待实测** | 普通 fetch 继承进程级 dispatcher；动态验证保留在验收单 |

### 下一 rc 适配轮的最小验收矩阵（在 alpha.2 报告五项上扩充）

1. **契约夹具**（原第 1 项照旧：旧 rc/alpha.2 envelope/缺席服务/泄漏与 cut 精确）＋ 新增 V3 夹具：v2 源→读 open 只 prepare、写 open 发布 v3 successor、v0/v1 两跳链、拒绝路径（未知事件/坏 block）源文件不动。
2. **目录与迁移**（原第 2 项）＋ 新增：多代并存目录的 size 口径展示、tar 含两代的恢复目标只能 ≥0.1.5、删除仍仅归档非 live。
3. **查询/性能**（原第 3 项）＋ 新增：迁移后 `system/message` 在详情为空白卡且可被噪声清单吸收、`filterEvents` 不命中系统提示词、标题 revision 缓存在 V3 successor 发布后按新文件 revision 失效。
4. **usage/子代理**（原第 4 项）＋ 新增：continuable child 不在 scheduler roots 但仍在插件清单/用量中的断言；`subagents.start/startContinuable` 包装在 0.1.5 冒烟。
5. **Web/进程/出网**（原第 5 项）＋ 新增：rightbar 语义下移动引擎全量回归（detailsOpen 不再依赖已删属性、自愈改 rightbar 缝、右缘手势驱动官方右栏、better-sidebar 并存）、StatsPills 窄屏表现与交互不冲突、真机 bundle 复核全部哈希类选择器；代理环境下 quota 出网动态实测。

`COMPAT_BREAKS` 维护建议：本窗口**不新增**通用 code token（`data-details-collapsed`/`closeDetails`/`NDN2W` 等是本插件自用 seam 或构建产物哈希，扫描器无接收者语义、误报风险同 alpha.2 报告 §8 的结论）；manifest 层无新移除包。官方 V3 对第三方持久化事件的 admission 拒绝值得作为生态面记录在文档，但同样不适合现有扫描器的匹配模型。

## 8. 本次验证与交付边界

当前仓库实际执行 **`node --test`：332/332 pass，0 fail，0 skip，退出码 0，约 6.6 秒**（该命令不触发 pretest/build:client，未重写根 `client.js`）。官方仓库只做固定 tag 的只读 git 操作；全量 diff 与文件清单存放于临时目录，不是交付文件。

未执行：0.1.5-alpha.1 运行实例挂载、真实历史迁移/恢复、浏览器 E2E（rightbar/StatsPills/哈希）、代理出网动态验证、迁移/导出的性能测量；生成 CSS 哈希均标注未实测（本轮已证实源码推导哈希不可靠）。本报告由四路并行只读调研（会话 V3/persistence、客户端 UI、子代理 API、LLM/基础服务）+ 主会话交叉复核（承重结论逐条独立验证）合成，所有引用固定在 `82a5fd6...`/`5dda764...` 两 commit。

**最终建议：维持「暂不支持 ≥0.1.3-alpha.1，等下一 rc 一次适配」的既有决定。0.1.5-alpha.1 的增量让适配轮的清单变长（V3 夹具、rightbar/StatsPills 真机、事件白名单），但也带来两类确定性收益：V3 迁移对只读消费无害且写时才发布、锁与部署链路去编译化。不宜因 release 正文强调体验优化而提前解除版本限制。**
