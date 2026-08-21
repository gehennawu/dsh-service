# dsh-service

[中文](./README.md)

A service-control and operations plugin for self-hosted DSH Web. Provides safe restart, version management and one-click upgrade, health diagnostics, model-usage statistics, backup management, task notifications, and Linux file-permission maintenance.

![Overview](./screenshots/overview_en.png)

## Features

### Version and updates

- Displays current DSH and plugin versions with links to GitHub Releases
- Automatically checks npm registry for stable and preview releases, shows update status
- One-click plugin upgrade with automatic restart after completion

### Safe restart

- Detects active agents, background jobs, and terminals before restart; lists them and requires explicit confirmation
- `/restart` command also available in conversations; automatically refuses when active work is detected
- Automatically probes for the new process after restart and reloads the page; manual reload available after 60 seconds
- Optional `Restart` entry at the bottom of the settings left navigation, enabled by a switch in the Restart tab (off by default), sharing the exact same confirmation flow as the Restart tab

### Health diagnostics

- Shows uptime, memory, session count, active agents, and background jobs
- Full diagnostics check session storage, workspace registry, backup storage, tar availability, and file permissions
- File-permission deep scan and repair: checks whether the Agent can read/write DSH_HOME and workspaces; repair requires two-step confirmation

### Model statistics

- 7-day stacked bar chart of input/output/cache tokens with blue/orange/teal legend
- Filter by project; hover for exact values
- Model breakdown sorted by steps: `x times · Cache hit x% · Input xM token · Output xM token`
- Last-24-hour model/tool error statistics, collapsed by default

### Backup management

- Creates `.tar.gz` archives of sessions, configuration, and plugin profile manifests
- Export: download backup to browser
- Restore: extract and overwrite to corresponding paths, two-step confirmation followed by automatic restart
- Import: upload a `.tar.gz` file to the backup directory
- Delete requires two-step confirmation; backups are unlimited and never auto-pruned

### Task notifications

- Browser notification when a session finishes its turn, or when your approval, plan review, or answer is needed
- Three toggle switches: master switch, task completion, and approvals & questions, each controlled independently
- Bell icon in the conversation input bar toggles the master switch quickly
- All toggles persist across page reloads

### External liveness probe

- `GET` / `HEAD /healthz` returns empty HTTP 200; other methods return 405
- Suitable for Uptime Kuma, Docker, Kubernetes, or other external monitors

## Installation

### Install from npm (recommended)

```sh
dsh plugin --profile web add @gehennawu/dsh-service
```

### Install from GitHub

```sh
dsh plugin --profile web add github:gehennawu/dsh-service
```

Restart DSH Web after installation or updates:

```sh
dsh web
```

Open DSH Web Settings and select **Service Control**.

### Local development install

```sh
dsh plugin --profile web add link:/path/to/dsh-service
```

## Automatic restart configuration

The plugin only sends an exit signal; it does not start the process again. Without a process manager, selecting restart stops DSH Web.

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

## Platform support

| Environment | Plugin features | Automatic recovery | Verification |
| --- | --- | --- | --- |
| Linux + Docker Compose | Supported | Supported with a restart policy | Verified |
| Linux + systemd / pm2 | Expected to work | Managed externally | Not separately tested |
| macOS / Windows + pm2 or similar | Not blocked by the code | Managed externally | Not tested |
| Direct `dsh web` execution | Supported | Not supported | Expected behavior |

Requirements: Node.js `>=22`, and a DSH Web installation capable of loading both Host and Client plugin halves. Update checks require access to `registry.npmjs.org`; network failures do not affect other features.

## Security design

- The browser cannot supply URLs, package names, commands, or file paths
- Update checks only access fixed npm registry endpoints
- The RPC channel is loopback-only
- The model-usage index stores no messages, prompts, tool arguments, or credentials
- Destructive operations (restart, delete, permission repair) all require two-step confirmation

## License

[MIT](./LICENSE)
