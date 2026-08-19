# @dsh-nas/restart-dsh

设置页「服务控制」：DSH 版本信息 + 检查更新 + 一键重启。

## 功能

- **版本信息**：进入设置页自动显示当前 DSH 版本号
- **检查更新**：从 npm registry 获取最新版本，显示是否有新版本可用
- **兼容新版 RPC**：使用单层 `/restart-dsh` channel，`version`、`check-update`、`web` 作为 endpoint，符合 DSH 0.1.0-rc.7 的 channel 规则
- **一键重启**：两段式确认，`process.exit(42)` 退出，由进程管理器自动拉起

## 安装

```sh
dsh plugin --profile web add github:gehennawu/restart-dsh
```

## 兼容性

需要进程管理器配置自动重启策略：
- Docker: `restart: unless-stopped` / `always`
- systemd: `Restart=on-failure` 或 `Restart=always`
- pm2: 默认自动重启
