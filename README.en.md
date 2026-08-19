# dsh-service

[中文](./README.md)

A service-control and operations plugin for self-hosted DSH Web. The current release provides safe restart and recovery, update notifications, health monitoring, container liveness, backup management, and Linux file-permission maintenance.

> This project is still in early development and is currently verified mainly with **Linux + Docker**. Docker, systemd, pm2, or another external process manager must restart DSH Web after the plugin exits the process.

## Development status

| Stage | Status | Scope |
| --- | --- | --- |
| Current `0.5.0` | ✅ Feature complete | The v0.3–v0.5 roadmap is implemented and covered by automated tests |
| v0.3 Safety and UX | ✅ Implemented | Restart guard, automatic post-restart recovery, update badge/details overlay, dynamic zh/en UI |
| v0.4 Observability | ✅ Implemented | Health panel and status-code-only `/healthz` endpoint |
| v0.5 Data and maintenance | ✅ Implemented | Session/config/plugin-manifest backups, backup listing/deletion, and controlled Linux permission inspection/repair |

Deferred ideas: one-click DSH upgrades, scheduled restarts, token aggregation, and historical system metrics.

## Current features

- **Host version**: displays the installed `@deepseek-ai/dsh` version.
- **Update check**: reads the `latest` version of `@deepseek-ai/dsh` from a fixed npm registry URL.
- **Safe restart**: checks active agents, background jobs, and terminals, reading Terminal services from each Agent-scoped realm with a shared-service fallback; it lists active work, requires an explicit force action, and then exits DSH Web with code `42`.
- **Loopback RPC**: uses the single-level `/dsh-service` channel with `version`, `check-update`, and `web` endpoints, available only to loopback callers.
- **Automatic recovery**: shows a global `shell.overlay` after restart, probes for a new process instance with backoff, reloads automatically, and offers manual reload after 60 seconds.
- **Bilingual UI**: the Settings page, active-work warning, and recovery overlay switch dynamically with DSH's Chinese/English locale preference.
- **Update badge**: silently checks for DSH updates when the Settings page mounts; shows a sidebar-footer badge when a newer version exists, and opens a global overlay with current/latest versions. Registry failures stay silent.
- **Health panel**: shows uptime, memory RSS, live/persisted sessions, active agents, and background jobs; refreshes every 5 seconds while the Settings page is mounted and stops when it closes.
- **Container liveness**: `GET` / `HEAD /healthz` returns an empty HTTP 200; other methods return 405, with no DSH version, counts, or other information exposed.
- **Linux file permissions**: shows the owner and directory mode for DSH_HOME and every registered workspace; after two-step confirmation, recursively repairs ownership to the process uid:gid, directories to 755, and files to 644. The section is hidden outside Linux. If DSH runs as root in a container, the target is still root, so this cannot downgrade ownership to an unprivileged user.
- **Backup management**: creates archives under `$DSH_HOME/backups/` containing sessions, configuration, and plugin profile manifests; lists file name, size, time, and total usage; and requires two-step confirmation before deletion. Backups are unlimited and never auto-pruned, so disk usage is the user's responsibility. Credentials and `node_modules` are excluded.
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

> Automated coverage plus Host and real Chromium checks on the current Linux + Docker deployment are complete. The standard preset does not mount a Terminal backend, and the container exposes no root, CAP_CHOWN, Docker socket, or user namespace; those unproducible branches are covered by scoped-service regression tests and real-subprocess temporary-directory tests.

## Security design

- The browser cannot supply URLs, package names, commands, or file paths.
- Update checks only access `https://registry.npmjs.org/@deepseek-ai%2Fdsh`.
- npm responses are limited to 256 KiB with a 10-second timeout.
- The RPC channel is loopback-only and does not expose control operations to external network callers.
- The plugin stores no tokens, passwords, private keys, or other credentials.
- Restarting interrupts active work; the plugin lists active work first and only proceeds after an explicit **Force restart** action.

## Project structure

- `index.js`: Host half; version/update checks, activity guard, health metrics, liveness, backups, and permission-maintenance RPC.
- `client.js`: Browser half; Settings page, update badge, and global status overlays.
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
