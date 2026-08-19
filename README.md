# dsh-service

[English](./README.en.md)

面向自托管 DSH Web 的服务控制与运维插件。当前版本提供安全重启与自动恢复、更新提示、健康诊断、精确增量模型用量图表、容器探活、备份管理和 Linux 文件权限维护。

> 项目仍处于早期开发阶段。目前主要在 **Linux + Docker** 环境验证；重启后的自动拉起必须由 Docker、systemd、pm2 等外部进程管理器负责。

## 开发进度

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 当前版本 `0.7.1` | ✅ 功能完成 | v0.3–v0.7 路线功能均已实现并通过自动化测试；权限修复已保护凭据文件 0600 |
| v0.3 安全与体验 | ✅ 已实现 | 重启安全网、重启后自动恢复、更新脚标与详情浮层、zh+en 动态切换 |
| v0.4 可观测性 | ✅ 已实现 | 健康面板、仅返回状态码的 `/healthz` 探活端点 |
| v0.5 数据与维护 | ✅ 已实现 | 会话/配置/插件清单备份、备份列表与删除、Linux 文件权限查看与受控修复 |
| v0.6 面板与用量 | ✅ 已实现 | 版本置顶、完整健康检查、精确增量模型统计、供应商/模型与项目筛选、可切换图表、折叠维护详情 |
| v0.7 错误统计与界面 | ✅ 已实现 | 最近 24 小时模型/工具错误、路径归一化、默认折叠错误详情、卡片分区与语义按钮颜色 |

暂缓功能：一键升级 DSH、定时重启、宿主机系统指标历史。

## 当前功能

- **宿主版本**：显示当前安装的 `@deepseek-ai/dsh` 版本。
- **检查更新**：从固定 npm registry 地址读取 `@deepseek-ai/dsh` 的 `latest` 版本。
- **安全重启**：重启前检测活跃 agent、后台 job 和终端；Terminal 服务按 Agent scoped realm 读取并兼容共享 fallback。发现运行中工作时展示清单并要求显式强制，随后以退出码 `42` 结束当前 DSH Web 进程。
- **回环 RPC**：使用单层 `/dsh-service` channel，提供 `version`、`check-update`、`web` endpoint，仅接受 loopback 调用。
- **自动恢复**：重启后通过 `shell.overlay` 显示全局状态，退避探测新的进程实例并自动刷新；60 秒未恢复时提供手动刷新。
- **双语界面**：设置页、活动警告和恢复浮层跟随 DSH 的中文/英文语言设置动态切换。
- **更新脚标**：设置页打开时静默检查 DSH 更新；有新版本时在侧边栏底部显示提示，点击后通过全局浮层查看当前与最新版本。registry 不可达时不打扰用户。
- **健康面板与完整诊断**：显示 uptime、内存 RSS、存活/持久化会话、活跃 Agent 和后台任务；轻量指标每 5 秒刷新。文件权限检查与查看/深检/修复操作统一收纳在健康卡片内；自动浅检或手动诊断出现 warning/error 时显示醒目的「健康提醒」。手动健康检查另外验证会话存储、工作区注册表、DSH_HOME、备份目录和 tar。
- **精确模型用量图表**：按 Host 本地自然日统计成功模型步骤、输入 Token、输出 Token、缓存 Token 和缓存命中率，可切换全部项目或单个工作区，并以 `provider/model` 展示供应商前缀。首次索引顺序读取历史会话，以后用会话 revision 和 `lastSeq` 只折叠新增事件；索引不保存消息、Prompt 或 Tool 内容。
- **续聊与 Fork 口径**：恢复旧会话沿用同一 session ID，因此后续产生的 Token 会按实际日期增量补入且不会重复；Fork 会跳过 `seedLength` 以内继承的父会话历史，Subagent 默认计入其实际项目。
- **模型报错统计**：从 `llm/retry` 与最终失败回合中提取 provider 错误，按 `provider/model + code + HTTP status` 归类，只保留滚动最近 24 小时并按次数从高到低排列；取消、最大 Token 和 Tool 错误不计入。详情默认折叠并跟随项目筛选。
- **工具报错统计**：统计直接 Tool 调用和 `run_code` 内子调用产生的失败，包括命令、读取、写入、编辑与搜索错误。优先使用稳定 `error.code`，缺失时归一化为 `FS_NOT_OBSERVED`、`OLD_STRING_NOT_FOUND`、`PATH_NOT_FOUND`、命令退出码等稳定口径；不同文件路径合并计数，索引和界面只保存/展示 `<path>` 级脱敏代表信息。只保留最近 24 小时、按次数降序、默认折叠并跟随项目筛选。
- **卡片式面板**：版本、健康、模型使用、维护和重启各自使用独立背景卡片；指标、图表、诊断结果与错误列表再使用不同底色的展示框。检查/刷新使用蓝色信息按钮，主要选择使用品牌色，修复/删除/重启保留危险色。
- **外部存活探针**：`GET` / `HEAD /healthz` 返回空的 HTTP 200；其他方法返回 405，不暴露版本、计数或其他 DSH 信息。它适合供另一台服务器上的 Uptime Kuma、Docker、Kubernetes 或其他监控程序检查 DSH Web 进程和 HTTP 服务是否仍可达；未配置外部消费者时不会自行产生作用，也不替代面板中的完整健康诊断。若 DSH 仅监听 `127.0.0.1`，应通过现有 Nginx/Caddy/Traefik 反向代理暴露该路径，不建议直接开放 3080 端口。
- **备份管理**：在 `$DSH_HOME/backups/` 创建会话、配置和插件 profile 清单归档；列表默认折叠，可查看文件名、大小、时间和总体积，并通过两段式确认删除。备份不限份数且不会自动清理，磁盘占用由用户自行管理；归档不包含凭据或 `node_modules`。
- **Linux 文件权限**：打开面板时在健康卡片内自动浅检查 DSH_HOME 与全部工作区根目录并直接显示异常摘要，路径详情默认折叠；手动深度检查递归扫描属主、目录 755、普通文件 644，并将 `$DSH_HOME/.credentials.yaml` 作为敏感例外强制要求 600。修复仍需两段式确认，先处理一般目录/文件，再显式恢复凭据文件 600，避免 DSH 凭据插件因权限过宽而拒绝启动。非 Linux 不显示此功能。容器内若以 root 运行 DSH，目标仍是 root，因此该修复不能降权为普通用户。
- **生命周期清理**：优先使用 DSH `timer` 服务延迟退出与调度恢复探测，使未完成的定时动作可随插件 Fiber 清理。

## 安装

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:gehennawu/dsh-service
```

安装或更新后重启 DSH Web，使 Host 与 Client 两半插件重新加载：

```sh
dsh web
```

打开 DSH Web 设置页，进入 **服务控制**。

### 本地开发安装

```sh
dsh plugin --profile web add link:/path/to/dsh-service
```

## 自动重启配置

插件只发送退出信号，不负责重新启动进程。没有进程管理器时，点击重启会直接停止 DSH Web。

### Docker Compose

```yaml
services:
  dsh:
    restart: unless-stopped
```

### systemd

```ini
[Service]
ExecStart=/usr/local/bin/dsh web --host 127.0.0.1
Restart=on-failure
RestartSec=2
```

### pm2

```sh
pm2 start "dsh web --host 127.0.0.1" --name dsh-web
```

## 平台支持

| 环境 | 插件功能 | 重启后自动拉起 | 验证状态 |
| --- | --- | --- | --- |
| Linux + Docker Compose | 支持 | 配置 restart policy 后支持 | 已验证 |
| Linux + systemd / pm2 | 预期支持 | 由进程管理器负责 | 未单独验证 |
| macOS / Windows + pm2 等 | 代码未限制 | 由进程管理器负责 | 未验证 |
| 直接运行 `dsh web` | 支持 | 不支持 | 预期行为 |

运行要求：Node.js `>=22`，且 DSH Web 能加载 Host 和 Client 两半插件。检查更新需要访问 `registry.npmjs.org`；网络失败不会影响其他功能。

> 自动化测试以及当前 Linux + Docker 的 Host/真实 Chromium 验证已完成。当前 standard preset 未挂载 Terminal backend，容器也不提供 root、CAP_CHOWN、Docker socket 或 user namespace，因此这两种不可制造的环境分支通过隔离服务回归测试和真实 subprocess 临时目录测试覆盖。

## 安全设计

- 浏览器端不能传入 URL、包名、命令或文件路径。
- 更新检查只访问 `https://registry.npmjs.org/@deepseek-ai%2Fdsh`。
- npm 响应限制为 256 KiB，请求超时为 10 秒。
- RPC channel 仅注册为 loopback，不对外部网络开放控制接口。
- 模型用量索引仅保存 session revision/watermark、按日期/项目/provider/model 聚合的数字，以及最近 24 小时脱敏错误的稳定 code、计数、时间戳和 `<path>` 代表信息；不保存消息、Prompt、Tool 参数、原始文件路径、密码、私钥或其他凭据。索引固定写入 `$DSH_HOME/dsh-service-usage-index.json` 并使用 0600 权限。
- 重启会中断正在运行的任务；插件会先展示活动清单，只有显式确认「仍要重启」才会强制执行。

## 项目结构

- `index.js`：Host 半；版本/更新、活动保护、健康指标与诊断、增量用量索引、探活、备份和权限维护 RPC。
- `client.js`：Browser 半；设置页布局、可切换用量图表、更新脚标和全局状态浮层。
- `cordis.patch.yml`：将 Host 与 Client 插件插入 DSH Web profile。
- `README.en.md`：英文文档。

基础检查：

```sh
npm test
node --check index.js
node --check client.js
npm pack --dry-run
```

## 许可证

[MIT](./LICENSE)
