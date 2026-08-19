# @dsh-nas/restart-dsh

设置页「服务控制」：一键重启 dsh web。

重启机制：`process.exit(42)` 退出进程，由进程管理器（Docker restart 策略 / systemd / pm2 等）自动重新拉起。

## 特性

- 两段式确认按钮，防止误触
- loopback-only RPC，外部网络无法触发
- 延迟 500ms 退出，确保 RPC 响应先到达浏览器

## 安装

```sh
dsh plugin --profile web add github:gehennawu/restart-dsh
```

## 兼容性

需要进程管理器配置自动重启策略：
- Docker: `restart: unless-stopped` / `always`
- systemd: `Restart=on-failure` 或 `Restart=always`
- pm2: 默认自动重启
