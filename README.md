# dsh-service

[English](./README.en.md)

面向自托管 DSH Web 的服务控制与运维插件。当前版本提供安全重启与自动恢复、更新提示、健康监控、容器探活、备份管理和 Linux 文件权限维护。

> 项目仍处于早期开发阶段。目前主要在 **Linux + Docker** 环境验证；重启后的自动拉起必须由 Docker、systemd、pm2 等外部进程管理器负责。

## 开发进度

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 当前版本 `0.5.0` | ✅ 功能完成 | v0.3–v0.5 路线功能均已实现并通过自动化测试 |
| v0.3 安全与体验 | ✅ 已实现 | 重启安全网、重启后自动恢复、更新脚标与详情浮层、zh+en 动态切换 |
| v0.4 可观测性 | ✅ 已实现 | 健康面板、仅返回状态码的 `/healthz` 探活端点 |
| v0.5 数据与维护 | ✅ 已实现 | 会话/配置/插件清单备份、备份列表与删除、Linux 文件权限查看与受控修复 |

暂缓功能：一键升级 DSH、定时重启、token 聚合、系统指标历史趋势。

## 当前功能

- **宿主版本**：显示当前安装的 `@deepseek-ai/dsh` 版本。
- **检查更新**：从固定 npm registry 地址读取 `@deepseek-ai/dsh` 的 `latest` 版本。
- **安全重启**：重启前检测活跃 agent、后台 job 和终端；Terminal 服务按 Agent scoped realm 读取并兼容共享 fallback。发现运行中工作时展示清单并要求显式强制，随后以退出码 `42` 结束当前 DSH Web 进程。
- **回环 RPC**：使用单层 `/dsh-service` channel，提供 `version`、`check-update`、`web` endpoint，仅接受 loopback 调用。
- **自动恢复**：重启后通过 `shell.overlay` 显示全局状态，退避探测新的进程实例并自动刷新；60 秒未恢复时提供手动刷新。
- **双语界面**：设置页、活动警告和恢复浮层跟随 DSH 的中文/英文语言设置动态切换。
- **更新脚标**：设置页打开时静默检查 DSH 更新；有新版本时在侧边栏底部显示提示，点击后通过全局浮层查看当前与最新版本。registry 不可达时不打扰用户。
- **健康面板**：显示 uptime、内存 RSS、存活/持久化会话、活跃 Agent 和后台任务；设置页打开时每 5 秒刷新，关闭即停止。
- **容器探活**：`GET` / `HEAD /healthz` 返回空的 HTTP 200；其他方法返回 405，不暴露版本、计数或其他 DSH 信息。
- **备份管理**：在 `$DSH_HOME/backups/` 创建会话、配置和插件 profile 清单归档，可查看文件名、大小、时间和总体积，并通过两段式确认删除。备份不限份数且不会自动清理，磁盘占用由用户自行管理；归档不包含凭据或 `node_modules`。
- **Linux 文件权限**：查看 DSH_HOME 与全部已注册工作区的属主和目录权限；经两段式确认后，递归修复为进程自身 uid:gid、目录 755、文件 644。非 Linux 不显示此功能。容器内若以 root 运行 DSH，目标仍是 root，因此该修复不能降权为普通用户。
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
- 插件不保存 token、密码、私钥或其他凭据。
- 重启会中断正在运行的任务；插件会先展示活动清单，只有显式确认「仍要重启」才会强制执行。

## 项目结构

- `index.js`：Host 半；版本/更新、活动保护、健康指标、探活、备份和权限维护 RPC。
- `client.js`：Browser 半；设置页、更新脚标和全局状态浮层。
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
