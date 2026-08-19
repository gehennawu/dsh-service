# dsh-service

[English](./README.en.md)

面向自托管 DSH Web 的服务控制与运维插件。当前版本提供宿主版本查看、DSH 更新检查和安全重启，并计划逐步加入重启保护、运行状态、备份与 Linux 文件权限维护。

> 项目仍处于早期开发阶段。目前主要在 **Linux + Docker** 环境验证；重启后的自动拉起必须由 Docker、systemd、pm2 等外部进程管理器负责。

## 开发进度

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| 当前版本 `0.2.1` | ✅ 可用 | 包名与 RPC 统一为 `@gehennawu/dsh-service` / `/dsh-service`；显示 DSH 版本、检查 DSH 更新、两段式确认重启、loopback RPC、中英文文档 |
| v0.3 安全与体验 | 🚧 开发中 | ✅ 重启前检测活跃 agent / 后台 job / 终端并要求显式强制；待完成：重启后自动恢复、更新提示脚标、界面 zh+en 双语 |
| v0.4 可观测性 | 📋 计划中 | uptime、内存 RSS、会话与任务计数；仅返回状态码的 `/healthz` 探活端点 |
| v0.5 数据与维护 | 📋 计划中 | 会话/配置/插件清单备份；备份列表与删除；Linux 下查看并修复 DSH_HOME 与工作区文件权限 |

暂缓功能：一键升级 DSH、定时重启、token 聚合、系统指标历史趋势。

## 当前功能

- **宿主版本**：显示当前安装的 `@deepseek-ai/dsh` 版本。
- **检查更新**：从固定 npm registry 地址读取 `@deepseek-ai/dsh` 的 `latest` 版本。
- **安全重启**：重启前检测活跃 agent、后台 job 和终端；发现运行中工作时展示清单并要求显式强制，随后以退出码 `42` 结束当前 DSH Web 进程。
- **回环 RPC**：使用单层 `/dsh-service` channel，提供 `version`、`check-update`、`web` endpoint，仅接受 loopback 调用。
- **生命周期清理**：优先使用 DSH `timer` 服务延迟退出，使未完成的定时动作可随插件 Fiber 清理。

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

## 安全设计

- 浏览器端不能传入 URL、包名、命令或文件路径。
- 更新检查只访问 `https://registry.npmjs.org/@deepseek-ai%2Fdsh`。
- npm 响应限制为 256 KiB，请求超时为 10 秒。
- RPC channel 仅注册为 loopback，不对外部网络开放控制接口。
- 插件不保存 token、密码、私钥或其他凭据。
- 重启会中断正在运行的任务；插件会先展示活动清单，只有显式确认「仍要重启」才会强制执行。

## 项目结构

- `index.js`：Host 半；读取版本、检查更新、注册重启 RPC。
- `client.js`：Browser 半；在设置页注册服务控制界面。
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
