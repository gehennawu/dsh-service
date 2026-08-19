# dsh-service

[中文](./README.md)

A service-control and operations plugin for self-hosted DSH Web. The current release provides host version information, DSH update checks, and safe process restarts, with restart protection, runtime status, backups, and Linux file-permission maintenance planned for later releases.

> This project is still in early development and is currently verified mainly with **Linux + Docker**. Docker, systemd, pm2, or another external process manager must restart DSH Web after the plugin exits the process.

## Development status

| Stage | Status | Scope |
| --- | --- | --- |
| Current `0.2.1` | ✅ Available | Package and RPC identities unified as `@gehennawu/dsh-service` / `/dsh-service`; DSH version display, DSH update check, two-step restart confirmation, loopback RPC, Chinese and English documentation |
| v0.3 Safety and UX | 🚧 Awaiting integration tests | ✅ Detect active work and require an explicit force action; ✅ identify a new process and reload after restart; ✅ switch the UI dynamically between zh and en; the update badge is paused because DSH has no third-party Settings navigation API yet |
| v0.4 Observability | 🚧 In progress | ✅ Health panel; remaining: a status-code-only `/healthz` endpoint |
| v0.5 Data and maintenance | 📋 Planned | Session/config/plugin-list backups; backup listing and deletion; Linux permission inspection and repair for DSH_HOME and workspaces |

Deferred ideas: one-click DSH upgrades, scheduled restarts, token aggregation, and historical system metrics.

## Current features

- **Host version**: displays the installed `@deepseek-ai/dsh` version.
- **Update check**: reads the `latest` version of `@deepseek-ai/dsh` from a fixed npm registry URL.
- **Safe restart**: checks for active agents, background jobs, and terminals, displays a warning list when work is active, requires an explicit force action, and then exits DSH Web with code `42`.
- **Loopback RPC**: uses the single-level `/dsh-service` channel with `version`, `check-update`, and `web` endpoints, available only to loopback callers.
- **Automatic recovery**: shows a global `shell.overlay` after restart, probes for a new process instance with backoff, reloads automatically, and offers manual reload after 60 seconds.
- **Bilingual UI**: the Settings page, active-work warning, and recovery overlay switch dynamically with DSH's Chinese/English locale preference.
- **Health panel**: shows uptime, memory RSS, live/persisted sessions, active agents, and background jobs; refreshes every 5 seconds while the Settings page is mounted and stops when it closes.
- **Lifecycle cleanup**: uses the DSH `timer` service for delayed exit and recovery probes so pending work can be disposed with the plugin Fiber.

## Installation

### Install from GitHub

```sh
dsh plugin --profile web add github:gehennawu/dsh-service
```

Restart DSH Web after installation or updates so both the Host and Client plugin halves are reloaded:

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

- The browser cannot supply URLs, package names, commands, or file paths.
- Update checks only access `https://registry.npmjs.org/@deepseek-ai%2Fdsh`.
- npm responses are limited to 256 KiB with a 10-second timeout.
- The RPC channel is loopback-only and does not expose control operations to external network callers.
- The plugin stores no tokens, passwords, private keys, or other credentials.
- Restarting interrupts active work; the plugin lists active work first and only proceeds after an explicit **Force restart** action.

## Project structure

- `index.js`: Host half; reads the version, checks for updates, and registers restart RPC.
- `client.js`: Browser half; registers the Service Control page in Settings.
- `cordis.patch.yml`: inserts the Host and Client plugin into the DSH Web profile.
- `README.md`: Chinese documentation.

Basic checks:

```sh
npm test
node --check index.js
node --check client.js
npm pack --dry-run
```

## License

[MIT](./LICENSE)
