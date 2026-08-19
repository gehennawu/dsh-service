# dsh-service

[中文](./README.md)

A service-control and operations plugin for self-hosted DSH Web. The current release provides safe restart and recovery, update notifications, deep health diagnostics, exact incremental model-usage charts, container liveness, backup management, and Linux file-permission maintenance.

> This project is still in early development and is currently verified mainly with **Linux + Docker**. Docker, systemd, pm2, or another external process manager must restart DSH Web after the plugin exits the process.

## Development status

| Stage | Status | Scope |
| --- | --- | --- |
| Current `0.6.0` | ✅ Feature complete | The v0.3–v0.6 roadmap is implemented and covered by automated tests |
| v0.3 Safety and UX | ✅ Implemented | Restart guard, automatic post-restart recovery, update badge/details overlay, dynamic zh/en UI |
| v0.4 Observability | ✅ Implemented | Health panel and status-code-only `/healthz` endpoint |
| v0.5 Data and maintenance | ✅ Implemented | Session/config/plugin-manifest backups, backup listing/deletion, and controlled Linux permission inspection/repair |
| v0.6 Panel and usage | ✅ Implemented | Version-first layout, deep health check, exact incremental model usage, provider/model and project filters, switchable charts, and collapsed maintenance details |

Deferred ideas: one-click DSH upgrades, scheduled restarts, and historical host-system metrics.

## Current features

- **Host version**: displays the installed `@deepseek-ai/dsh` version.
- **Update check**: reads the `latest` version of `@deepseek-ai/dsh` from a fixed npm registry URL.
- **Safe restart**: checks active agents, background jobs, and terminals, reading Terminal services from each Agent-scoped realm with a shared-service fallback; it lists active work, requires an explicit force action, and then exits DSH Web with code `42`.
- **Loopback RPC**: uses the single-level `/dsh-service` channel with `version`, `check-update`, and `web` endpoints, available only to loopback callers.
- **Automatic recovery**: shows a global `shell.overlay` after restart, probes for a new process instance with backoff, reloads automatically, and offers manual reload after 60 seconds.
- **Bilingual UI**: the Settings page, active-work warning, and recovery overlay switch dynamically with DSH's Chinese/English locale preference.
- **Update badge**: silently checks for DSH updates when the Settings page mounts; shows a sidebar-footer badge when a newer version exists, and opens a global overlay with current/latest versions. Registry failures stay silent.
- **Health panel and deep diagnostics**: shows uptime, memory RSS, live/persisted sessions, active agents, and background jobs, with lightweight metrics refreshed every 5 seconds. A manual health check additionally verifies session storage, workspace registry, DSH_HOME, backup storage, tar, and root-path permissions.
- **Exact model-usage charts**: groups successful model steps, input tokens, output tokens, cache tokens, and cache hit rate by the Host's local calendar day. The UI can switch between all projects and individual workspaces and displays models as `provider/model`. The first build reads historical sessions sequentially; later refreshes fold only new events using each session revision and `lastSeq`. The index stores no messages, prompts, or tool content.
- **Resume and fork semantics**: reopening an old conversation keeps the same session ID, so newly produced tokens are appended to their actual day without double counting. Forks skip the inherited prefix below `seedLength`; subagent usage is included in its actual project by default.
- **Model error statistics**: extracts provider failures from `llm/retry` and final failed turns, groups them by `provider/model + code + HTTP status`, and shows both all-time and rolling last-24-hour counts in descending order. Cancellations, max-token endings, and tool errors are excluded.
- **External liveness probe**: `GET` / `HEAD /healthz` returns an empty HTTP 200; other methods return 405, with no DSH version, counts, or other information exposed. It is intended for Uptime Kuma on another server, Docker, Kubernetes, or another monitor to verify that DSH Web and its HTTP server remain reachable. It does nothing unless an external consumer is configured and does not replace the panel's deep diagnostics. When DSH listens only on `127.0.0.1`, expose this path through the existing Nginx/Caddy/Traefik reverse proxy rather than opening port 3080 directly.
- **Linux file permissions**: automatically performs a shallow check of DSH_HOME and all workspace roots when the panel opens and shows the summary immediately, with paths collapsed by default. A manual deep check recursively scans ownership, directory mode 755, and file mode 644 with bounded anomaly samples. Repair still requires two-step confirmation. The section is hidden outside Linux. If DSH runs as root in a container, the target is still root, so this cannot downgrade ownership to an unprivileged user.
- **Backup management**: creates archives under `$DSH_HOME/backups/` containing sessions, configuration, and plugin profile manifests; keeps the record list collapsed by default; and requires two-step confirmation before deletion. Backups are unlimited and never auto-pruned, so disk usage is the user's responsibility. Credentials and `node_modules` are excluded.
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
- The model-usage index stores only session revisions/watermarks and numeric aggregates by day, project, and provider/model. It stores no messages, prompts, tool arguments, passwords, private keys, or other credentials; it is fixed at `$DSH_HOME/dsh-service-usage-index.json` with mode 0600.
- Restarting interrupts active work; the plugin lists active work first and only proceeds after an explicit **Force restart** action.

## Project structure

- `index.js`: Host half; version/update checks, activity guard, health metrics and diagnostics, incremental usage index, liveness, backups, and permission-maintenance RPC.
- `client.js`: Browser half; Settings layout, switchable usage charts, update badge, and global status overlays.
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
