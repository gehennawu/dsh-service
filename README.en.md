# dsh-service

[中文](./README.md)

A service-control and operations plugin for self-hosted DSH Web. Provides safe restart, version management and one-click upgrade, health diagnostics, model-usage statistics, remote quota, backup management, task notifications, and Linux file-permission maintenance.

![Overview](./screenshots/overview_en.png)

## Features

The Settings panel "Service Control" page has seven top-level tabs: **Overview, Notifications, Health, Model stats, Quota lookup, Backups, Restart**; the Restart and Quota lookup tabs can each enable a quick entry at the bottom of the settings left navigation (off by default).

### Version and updates

- Displays current DSH and plugin versions with links to GitHub Releases
- Automatically checks npm registry for stable and preview releases; when a new version exists, the right-side status text (chevron + `New version`) is clickable to expand/collapse, showing the current/latest versions and both dist-tag versions inline, each with npmjs and npmmirror links (npmjs.com is blocked on some networks; npmmirror serves as the mirror entry)
- One-click plugin upgrade with automatic restart after completion; when no process manager is detected (for example, a manual launch from a Windows terminal), the upgrade first confirms the consequences, then keeps the process running and shows manual-restart instructions

### Safe restart

- Detects active agents, background jobs, and terminals before restart; lists them and requires explicit confirmation
- `/restart` command also available in conversations; automatically refuses when active work is detected
- Automatically probes for the new process after restart and reloads the page; manual reload available after 60 seconds
- When a manual terminal launch is suspected, the restart confirmation flow warns that nothing will bring the process back, and Health diagnostics marks it with a yellow inline caution
- Optional `Restart` entry at the bottom of the settings left navigation, enabled by a switch in the Restart tab (off by default), sharing the exact same confirmation flow as the Restart tab

### Health diagnostics

- Shows uptime, memory, session count, active agents, and background jobs
- The "Process and runtime" card shows platform, architecture, and Node version
- Full diagnostics check session storage, workspace registry, backup storage, tar availability, file permissions, runtime environment, and Node runtime version; a manual launch is marked with a yellow inline caution (no restart assurance) that does not trigger the health alert banner, the service-control reminder, or the tab ⚠; an unrecognized environment and an empty backup list are informational only — all can be declared explicitly via `DSH_SERVICE_RUNTIME_ENV`
- Having no backups is an informational note, not a warning, and does not light the Health tab ⚠
- File-permission deep scan and repair: checks whether the Agent can read/write DSH_HOME and workspaces; repair requires two-step confirmation

### Model statistics

- 7-day stacked bar chart of input/output/cache tokens with blue/orange/teal legend
- Filter by project; hover for exact values
- Model breakdown as horizontal stacked bars (same legend colors), sorted by total tokens, largest first; each row keeps `x times · Cache hit x% · Input xM token · Output xM token`
- Steps whose provider reports no token usage are excluded from the statistics
- Last-24-hour model/tool error statistics, collapsed by default

### Quota lookup

- A dedicated "Quota lookup" tab shows adapted providers as separate cards, each window rendered as a percentage with its own bar and a reset countdown on its own line, plus a refresh icon beside the updated time that force-refreshes that provider on click (bypassing the poll interval); unadapted providers take no space — a "Manual adapt" row at the bottom enables one by picking its type, and each card's footer can switch type, fall back to auto-detect, or disable lookup at any time
- A quota ring inside the conversation composer follows the provider selected by the current session and shows the tightest budget window as a percentage (green below 80%, amber at or above); clicking opens a panel headed by the provider name, with a bar and used percentage for each window and reset times on their own lines
- A "Show a remote quota entry in the settings left navigation" switch lives in the Quota lookup tab (off by default), mirroring the Restart entry
- Built-in adaptations: **OpenCode Go** (`{baseURL}/usage`), **Zhipu GLM Coding Plan / zai-coding-cn** (official monitor `quota/limit` endpoint with three windows — 5-hour rolling tokens, weekly tokens, monthly MCP quota; an idle 5-hour window hides its reset time, matching the official console), **OpenRouter** (credits used %), **Kimi/Moonshot** and **SiliconFlow** (CNY balance text); dialects that natively report remaining percentage flip the panel word to "Remaining" and invert the warn threshold; transient network errors retry automatically and the Zhipu dual-domain candidate chain switches automatically; the provider-to-kind mapping lives in `DSH_HOME/dsh-service-quota.json`, and known services are auto-detected from their baseURL (e.g. opencode.ai, bigmodel.cn) with no manual picking; no upstream request is ever made for unadapted or disabled providers; disabling can be done via "Disable" in a card's footer or by writing `"<provider>": null` in the config file (both are equivalent). Zhipu reset cards have no API-key-queryable endpoint yet — you can add any number of them via each provider card's "Add reset card" button on the tab (name plus expiry time, down to the minute), and remove each one independently — the ring panel shows them too (stored in the same config file); expired cards are flagged automatically
- Anti-rate-limit pacing is enforced by the host: successful results are cached for 60 seconds (shared across tabs), failures back off exponentially (30 s doubling, capped at 15 minutes), upstream timeout is 15 s; the panel can set auto query to manual only / 1 / 2 / 5 / 10 minutes (manual only by default), paused automatically while the page is hidden
- API keys are resolved and used only inside the host process — the browser receives normalized percentages only; data flows through the plugin's own loopback RPC with no webServer routes exposed

### Backup management

- Creates `.tar.gz` archives of sessions, configuration, and plugin profile manifests
- Export: download backup to browser
- Restore: extract and overwrite to corresponding paths, two-step confirmation followed by automatic restart
- Import: upload a `.tar.gz` file to the backup directory
- Delete requires two-step confirmation; backups are unlimited and never auto-pruned

### Task notifications

- Notification settings live in the top-level Notifications tab: browser notification when a session finishes its turn, or when your approval, plan review, or answer is needed
- Clicking a notification focuses the DSH page and closes the popup
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

The plugin passively detects whether a process manager is present (environment variables, `/.dockerenv`, `/proc/1/cgroup`, terminal TTY): with Docker/systemd/pm2/supervisord/Kubernetes detected it restarts as usual; when nothing is detected and stdin/stdout are an interactive terminal, it treats the environment as a likely manual launch, flags it in Health diagnostics with a yellow caution, and switches one-click upgrade to keep the process running with manual-restart instructions. Heuristics cannot cover redirected output or wrappers like NSSM/WinSW; set `DSH_SERVICE_RUNTIME_ENV=managed|manual` to declare it explicitly.

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

When launched directly from a terminal (PowerShell/CMD/bash), the panel labels the environment as a likely manual launch and the one-click upgrade no longer exits the process automatically.

Requirements: Node.js `>=22`, and a DSH Web installation capable of loading both Host and Client plugin halves. Update checks require access to `registry.npmjs.org`; network failures do not affect other features.

## Security design

- The browser cannot supply URLs, package names, commands, or file paths
- Update checks only access fixed npm registry endpoints
- The RPC channel is loopback-only
- The model-usage index stores no messages, prompts, tool arguments, or credentials
- Destructive operations (restart, delete, permission repair) all require two-step confirmation

## License

[MIT](./LICENSE)
