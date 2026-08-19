# @dsh-nas/restart-dsh

DSH Web 插件：在设置页提供服务控制、版本信息和更新检查。

> 本项目只负责向当前 DSH Web 进程发送退出信号；真正的自动重启由外层进程管理器负责。

## 功能

- **版本信息**：显示当前宿主 DSH 版本。
- **检查更新**：从固定的 npm registry 地址读取 `@deepseek-ai/dsh` 的 `latest` 版本。
- **一键重启**：两段式确认后，以退出码 `42` 退出当前进程，让 Docker、systemd 或 pm2 的重启策略接管。
- **回环 RPC**：重启与版本接口只注册为 loopback channel，不接受外部网络请求。
- **新版 RPC 兼容**：使用单层 `/restart-dsh` channel，并以 `version`、`check-update`、`web` 作为 endpoint。
- **生命周期安全**：优先使用 DSH 的 `timer` 服务调度退出，插件停止或更新时由 Fiber 自动清理；没有 timer 时才立即退出。

## 安全说明

- 插件不接收 URL、包名、命令或文件路径等用户输入。
- 更新检查只访问 `https://registry.npmjs.org/@deepseek-ai%2Fdsh`，并限制响应大小为 256 KiB、超时为 10 秒。
- 插件不包含 token、密码、私钥或持久化凭据。
- 重启操作会中断正在执行的任务；请只授予可信用户访问 DSH Web 的权限。
- 退出码本身不会自动拉起进程。若没有进程管理器，点击重启后服务会停止。

## 安装

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:gehennawu/restart-dsh
```

安装或更新后重启 DSH Web，使 Host 和 Client 两半重新加载：

```sh
dsh web
```

### 本地开发

```sh
dsh plugin --profile web add link:/path/to/restart-dsh
```

## 自动重启配置

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

## 使用

打开 DSH Web 的设置页，进入 **服务控制**：

1. 查看当前 DSH 版本；
2. 点击 **检查更新** 查看 npm 上的最新版本；
3. 点击 **重启 dsh web**，再次确认后执行重启。

## 开发与验证

本项目是 DSH 的双端插件：

- `index.js`：Host 半，注册 loopback RPC；
- `client.js`：Browser 半，注册设置页 UI；
- `cordis.patch.yml`：将插件插入 DSH 的插件树。

基础检查：

```sh
node --check index.js
node --check client.js
git diff --check
```

## 许可证

[MIT](./LICENSE)
