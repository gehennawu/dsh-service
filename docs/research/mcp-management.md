# MCP 管理功能调研

> 调研问题：`@gehennawu/dsh-service` 若要增加「MCP 管理」功能，实现难度如何、需要提供哪些功能。
>
> 调研范围：本机安装的 DSH `@deepseek-ai/dsh@0.1.2-rc.1` 产物（重点：`@deepseek-ai/dsh-mcp-client` 包与其 README）、本机实际部署的 profile 组合（`/home/node/.dsh/profiles/web/`）、MCP 官方规范站点。本文只做调研，不修改功能实现、不写 TODO 里程碑。
>
> 结论先行：**MCP 协议实现与工具桥接这两块最难的工作宿主已经内置完成，插件侧只需要做「管理面板」**；真正的难点不在协议，而在「配置写回的安全教义口径」与「YAML 保真写回」两个设计决策。

## 结论摘要

1. DSH 0.1.2-rc.1 自带官方 MCP 客户端桥接插件 `@deepseek-ai/dsh-mcp-client`：连接外部 MCP 服务器、把服务器工具注册成原生工具（`mcp__<serverName>__<tool>`）、断线自动重连、工具列表变更自动同步。**插件一行业务协议代码都不用写。**
2. 配置形态是 profile 组合里的 loader 行（写在 `cordis.patch.yml`，DSH `watchUserPatches` 监视热重载，改完原地重载连接、无需重启）。当前部署**一条 MCP 配置都没有**，功能上是空地。
3. 插件侧功能分层：**T1 只读体检（难度低）→ T2 生命周期操作（难度低-中）→ T3 配置编辑（难度中-高）**。前两层全部走已验证的数据源（`loader.entries()` + fiber，v1.3 插件体检同款模式）；第三层动工前必须先定安全口径。
4. 两个硬骨头都在 T3：①「添加 MCP 服务器」本质是接受浏览器提交的任意命令行，与 AGENTS.md「零输入拼接 / 命令白名单写死」教义正面冲突；② `cordis.patch.yml` 含手写注释与 `!!js` 表达式，js-yaml load→dump 无损往返不存在，写回策略需要专门设计。
5. 宿主不暴露任何 MCP 连接态服务（`dsh-mcp-client` 不 provide service），细粒度健康（重连中、第几次尝试）只能从 loader fiber 与错误推断；要更细数据得向官方提需求。

---

## 1. MCP 是什么（30 秒版）

MCP（Model Context Protocol）是 Anthropic 2024 年底发起的开放协议，现为行业事实标准，用于**标准化 AI 应用连接外部能力**：

- **MCP 服务器**：一个提供能力的程序——本机子进程（`stdio` 传输）或远程 HTTP 服务（`streamable-http` 传输）。
- 对外暴露三类能力：**工具**（模型可调用的函数）、**资源**（可读数据）、**Prompt 模板**。
- **DSH 桥接只接工具**。resources 与 prompts 官方明确未做（`dsh-mcp-client` README「已知限制」第一条：「Resources 与 Prompts 没有 harness 消费机制，暂缓实现」），因此面板能管的也只有工具这一类。

命名惯例 `mcp__<serverName>__<rawName>`（如 `mcp__github__create_issue`），与 Claude Code、Codex 同形态。

> 澄清：本插件「额度查询」里智谱的「MCP 月度配额」窗口是智谱计费体系的窗口名（`TIME_LIMIT u5n1`），与本文话题无关。

## 2. 关键事实：宿主已内置 MCP 客户端桥接

包：`@deepseek-ai/dsh-mcp-client@0.1.2-rc.1`（DSH 依赖树内，本机路径 `/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/`）。每台 MCP 服务器 = 一条 loader 配置行：

```yaml
- id: mcp-github                      # loader 行 id（任意唯一）
  name: '@deepseek-ai/dsh-mcp-client' # 固定包名，一行一台服务器
  config:
    serverName: github                # 工具 namespace
    transport: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-github']
    env:
      GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN   # 密钥官方推荐引用环境变量，不落明文
```

### 2.1 config 字段表（README「最小配置」节核实）

| 字段 | 默认值 | 含义 |
|---|---|---|
| `transport` | 必填 | `stdio` 或 `streamable-http`（**无旧版 SSE-only 支持**） |
| `serverName` | 必填 | 工具 namespace；`[A-Za-z0-9_-]{1,32}`，注册作用域内唯一；重复时后加载行明确报错 |
| `command` / `args` / `env` / `cwd` | — | stdio：可执行文件、参数、合并到清洗环境之上的额外环境变量、工作目录 |
| `url` / `headers` | — | streamable-http：端点 URL 与额外请求标头 |
| `toolCallTimeoutMs` | `60000` | 每次 `tools/call` 超时 |
| `failOnStartupError` | `false` | 初始连接/工具同步失败时是否拒绝插件激活（默认仅记错误、工具不出现，harness 照常启动） |
| `reconnect.enabled` | `true` | 断线自动重连总开关 |
| `reconnect.initialDelayMs` | `500` | 首次重连延迟，逐次翻倍 |
| `reconnect.maxDelayMs` | `30000` | 退避上限；同时是重置尝试预算所需稳定运行时长 |
| `reconnect.maxAttempts` | `10` | 每次中断连续失败上限，超出后注销该服务器工具、停止重连，直至重载配置或重启 |

### 2.2 运行行为要点（README 核实）

- **工具命名**：`mcp__<serverName>__<rawName>`；namespace 是本地配置，绝不采用远程 `serverInfo.name`。两服务器可同名工具共存；同一服务器重复工具名 → 整个列表被拒、上一组工具保持；工具更新与现有名称冲突 → 整代拒绝（绝无部分工具集）。
- **重连**：只在传输关闭时触发（stdio 子进程崩溃会触发）；streamable-http 失败按请求走 SDK 自身恢复，不经 supervisor。预算耗尽后工具注销；稳定连接超过 `maxDelayMs` 重置预算。
- **热更新**：编辑配置行**原地重载**连接，未变的公开工具名保持不变（会话历史与权限规则因此跨重载有效）。
- **环境清洗（stdio）**：子进程环境 = `scrubbedParentEnv()`（删除匹配 `/KEY|PASSWORD|SECRET|TOKEN/i` 的名称与全部 `DSH_*`）+ 配置 `env` 合并，显式覆盖保留。
- **Token 成本**：工具描述与输入 schema 进入每次模型请求；重同步是整代替换而非累积。
- **结果桥接**：图片（PNG/JPEG/WebP/GIF）是唯一持久丰富结果；音频与嵌入资源只有有界诊断文本；资源链接仅文本（名称+URI）；MCP `isError` 明确失败，不伪装成功。
- **其余限制**：初始化/发现超时继承 MCP SDK（60s，不可配），无响应服务器会拖慢激活；要求 task-based execution 扩展的工具调用时抛错；不受支持的 `outputSchema` 词汇回退为不校验的 `JsonValue`。

## 3. 配置落点与热生效

- Profile 根 `/home/node/.dsh/profiles/web/cordis.yml` 当前是空数组 `[]`（注释明说「Edit cordis.patch.yml, not this file」）。组合顺序 = `package.json` 的 `dsh.profile.bundles` 各层 → `cordis.patch.yml` → `--patch` overlay。
- 即：**MCP 行的用户编辑层就是 `cordis.patch.yml`**。
- 热重载证据：`/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/profile-boot-BTzzdrGY.js:279` 调用 `watchUserPatches(ctx, …)`（自 `@deepseek-ai/dsh-app-boot` 导入）——DSH 监视用户 patch 文件并热重载组合树；与 README「编辑配置项会在原地重载服务器连接」互相印证。
- **当前部署现状**：`cordis.yml` 与 `cordis.patch.yml` 中 `dsh-mcp-client` 出现次数均为 0——没有任何 MCP 服务器被配置。

## 4. 插件侧可观测数据源

| 数据 | 来源 | 状态 |
|---|---|---|
| MCP 配置行清单 | `ctx.get('loader').entries()` 过滤 `options.name === '@deepseek-ai/dsh-mcp-client'`，行含 `id` / `options.config`（serverName、transport、command/url、env 键名）/ `disabled` | ✅ v1.3 插件体检已核实形状并产出过同模式功能 |
| 加载状态 | 行内 `fiber.state`（0 pending / 1 loading / 2 active / 3 failed / 4 disposed / 5 unloading）、`fiber._error`、`fiber.inject` / `fiber.store`（缺失依赖键） | ✅ 同上 |
| 单服务器重启 | `fiber.restart()`（dispose + 重载） | ✅ v1.3 已核实存在 |
| 当前注册的 MCP 工具清单 | 共享工具注册表 `ctx.tools`，实测存在 `register` / `schemas` / `get` / `presentAs` / `executionMode` 方法 | ⚠️ 方法名已核实；`schemas` 返回形状与按名 `get` 的行为**待实现时核实** |
| 连接中间态（重连中/第几次尝试/预算余量） | 无。`dsh-mcp-client` 不 provide 任何 service（实测其 lib 只消费 `ctx.logger` / `ctx.tools` / `ctx.effect` / `ctx.root`） | ❌ 只能从 fiber + 错误推断；细化需向官方提需求 |
| serverInfo / 能力协商结果 | 无暴露 | ❌ 同上 |

## 5. 功能分层与难度评估

| 层次 | 功能 | 难度 | 说明 |
|---|---|---|---|
| **T1 只读体检** | 列出全部 MCP 行（serverName、传输、stdio 命令或 HTTP 端点、env 键名清单——**不显示值**）、启用状态、fiber 状态与启动错误、（若 `ctx.tools.schemas` 可用）当前注册的 `mcp__*` 工具清单 | **低** | 数据源全部现成，复用 v1.3「插件体检」模式；一个常规小里程碑的量级 |
| **T2 生命周期操作** | 单服务器重启（`fiber.restart()`）；启用/停用某行 | **低-中** | 重启走 fiber API；启/停涉及写配置（见 T3）；两段式确认按既有教义 |
| **T3 配置编辑** | 面板内增删改 MCP 服务器：表单校验 → 写回 `cordis.patch.yml` → 热生效 | **中-高** | 难点不在代码量，在 §6 的两个设计决策；需要独立立项 + 动工前定口径 |

不做且不需要做的：MCP 协议实现、工具桥接、重连策略——宿主已内置。

## 6. T3 的两个硬骨头（动工前必须定案）

### 6.1 安全教义正面冲突

「添加 MCP 服务器」= 接受浏览器提交的**任意命令行**（`npx -y <任意包>`）+ 任意 URL + 环境变量。AGENTS.md 教义是「零输入拼接：命令白名单写死在宿主代码里」。候选口径：

1. **目录制**：插件内置精选服务器清单（有先例：models.dev 目录 + 探测白名单的做法），用户只从清单选 + 填参数，不接受自由命令。教义兼容最好，覆盖面受限。
2. **完全只读**：面板只做 T1+T2（重启除外），添加/编辑展示「请把这段 YAML 粘贴进 cordis.patch.yml」的指引。成本最低、零教义冲突。
3. **放开 + 重确认**：结构化表单（serverName 正则、transport 枚举、args 数组逐项校验、URL https-only 白名单化）+ YAML 发射器写入（绝无字符串拼接）+ 展示完整后果清单的两段式确认。教义上最激进，需要用户明确拍板这是「设置页 = owner」信任模型内的已接受风险。

无论哪条：env 值永不回显（参照额度查询「API key 全程不出宿主半」口径），推荐引导 `!!js process.env.X` 引用而非明文。

### 6.2 YAML 保真

`cordis.patch.yml` 含手写注释与 `!!js` 表达式；js-yaml 的 load→dump **不保注释**、`!!js` 值重序列化行为不可靠——整文件重写会毁用户手写内容。候选写回策略：

- **托管区块**：文件尾维护插件专属注释包裹的区块，只重写区块内行（需处理用户手改区块外的健壮性）；
- **行级/条目级操作**：按 `- id:` 条目边界做文本级插入删除（需自写小型 YAML 结构感知）；
- **另起 overlay 文件**：若 `--patch` overlay 支持多文件自动加载则最干净——**此点未核实**，动工前需确认 overlay 的加载机制（`loadOverlayPatches` 签名与来源）。

## 7. 与本插件现有资产的衔接

- 「插件体检」（v1.3）已建立 loader entries 读取、fiber 状态映射、异常条目下发口径——T1 直接继承。
- 「一键升级」（v0.13.2）已建立 profile 定位（`DSH_HOME/profiles/*/`、realpath 消歧）——T3 写文件需要同样的定位逻辑。
- 「插件配置页」的 settings namespace + feature 门控模式（`feature-disabled` 稳定错误码、标签隐藏）——MCP 管理作为第九个可选功能时照搬。
- RPC 错误规约（strict 校验、`rpcFailure` 形状）与设置面板子标签结构（v0.42 models 双子标签先例）可直接复用。

## 8. 参考链接

- 本机：`/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/README.zh.md`（字段表、行为语义、已知限制的一手来源）
- 本机：`/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/profile-boot-BTzzdrGY.js`（`watchUserPatches` 热重载证据）
- 本机部署：`/home/node/.dsh/profiles/web/cordis.yml` / `cordis.patch.yml`（组合层次与「当前零配置」现状）
- MCP 官方规范（2025-11-25 版传输定义）：[Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- MCP 官方注册表（生态目录，安全扫描依赖生态侧）：[The MCP Registry](https://modelcontextprotocol.io/registry/about)
- GitHub MCP Registry（安装/管理 MCP 服务器的生态参照）：[github.blog](https://github.blog/ai-and-ml/generative-ai/how-to-find-install-and-manage-mcp-servers-with-the-github-mcp-registry/)
