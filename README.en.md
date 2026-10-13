# 🛠️ dsh-service

[中文](./README.md)

An operations plugin for DeepSeek Harness (DSH) Web: restart and upgrades, health diagnostics, model usage and quota lookup, model configuration, backups, skills and session management.

[![Version](https://img.shields.io/badge/version-2.0.8-3b82f6.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](LICENSE)
[![DSH Compatibility](https://img.shields.io/badge/DSH-%E2%89%A50.1.1--rc.2%20%C2%B7%200.2.1--alpha.2-6366f1.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

![Overview](./screenshots/overview_en.png)

[Installation](#installation) · [Features](#features) · [Automatic restart](#automatic-restart) · [Important notes](#important-notes) · [FAQ](#faq)

## Installation

Requires Node.js ≥22 and DSH `>=0.1.1-rc.2 <0.2.1-alpha.3`. **Linux + Docker** is the primary verified environment; compatibility on other platforms is not guaranteed.

### Plugin manager (recommended)

1. Open DSH **Plugins → Add plugin**.
2. Enter `@gehennawu/dsh-service@2.0.8`, choose an installation source and install.
3. Restart DSH, reload the page and open **Service Control** in Settings. On Desktop, quit and reopen the application.

You can also enter the GitHub URL `https://github.com/gehennawu/dsh-service` or a local plugin directory.

### Command line

```sh
dsh plugin --profile web add @gehennawu/dsh-service@2.0.8
```

For GitHub or local development:

```sh
dsh plugin --profile web add github:gehennawu/dsh-service
dsh plugin --profile web add link:/path/to/dsh-service
```

Restart your existing DSH process and reload the page after installation; do not start an additional Web instance.

> Pin an exact version: pnpm's release-age policy may select an older version when installing without a version or using `@latest`.

## Features

Settings → Service Control contains **Overview, Model stats, Quota lookup, Model configuration, Health, Maintenance and Configuration**. Feature switches apply immediately; Restart, Quota lookup and Sessions can have optional settings-sidebar shortcuts.

### Version and updates

View DSH and plugin versions, read release notes, check stable and preview releases, and upgrade in one click. Upgrades require a restart; manually launched environments keep running and show instructions. On Desktop, update through the application's plugin manager.

### Model statistics

![Model statistics](./screenshots/model-usage_en.png)

- View input, output and cache tokens, cache hit rates and errors by project, model and date.
- Includes a 7-day trend, daily heatmap and hourly distribution; entering the page syncs automatically, with manual refresh available.
- Indexed history remains after deleting sessions or projects. Usage not reported by a provider cannot be counted; unreadable sessions are reported and retried on the next sync.

### Quota lookup

![Quota lookup](./screenshots/quota-lookup_en.png)

View balances, plan windows and reset times; the composer quota entry follows the current model's provider. Cards can be reordered, hidden or manually assigned an adapter type.

Supports DeepSeek, Zhipu GLM Coding Plan, OpenCode Go, OpenRouter, Kimi, SiliconFlow, StepFun balance / Step Plan, Xiaomi MiMo Token Plan, Command Code and CLIProxyAPI.

Enter or change credentials in each card's **Config** area: API keys for regular providers, the **management key** for CLIProxyAPI, a console cookie for Xiaomi, and `Oasis-Token` for Step Plan. Command Code reuses its inference key. Stored credentials are never echoed back.

Queries run when you open the quota page, expand the composer quota entry or refresh manually. Credential errors and expired plans pause automatic retries; retry manually after correcting the configuration.

### Model configuration

> **Screenshot pending: provider and model configuration.**
<!-- Screenshot placeholder: model-configuration.png / model-configuration_en.png. Add both assets before linking. -->

- Add and edit providers, models and credentials; enable or disable providers and models. Enter model IDs manually or explicitly fetch them online.
- Edit names, context windows, maximum output, image input and reasoning levels. Capacity fields accept `256K`, `1M` and similar values; advanced settings not shown remain unchanged.
- Smart fill provides parameter suggestions only. Confirming fills the draft; you still need to save. Metadata does not verify API capabilities.
- Basic call tests **may incur charges** and verify text calls only, not every capability.
- Deletion checks main-chat and subagent references. Deleting a provider keeps credentials; configuration can be restored, but old key values cannot.

Older hosts without configuration revision support are view-only. Online discovery requires a public HTTPS endpoint allowed by the security policy; local or HTTP providers can still be saved with manually entered models.

### Subagent model

![Subagent model](./screenshots/subagent-model_en.png)

Under **Model configuration → Subagent routing**, choose Default, Follow main model or Custom, with optional reasoning effort and ordered fallback models. Explicit provider/model values in a delegation take priority. Switching modes preserves saved custom settings. A line below the composer can show the models actually used by the session's subagents.

### Health diagnostics

![Health diagnostics](./screenshots/health-diagnostics_en.png)

Checks runtime, session storage, backups, usage index, notification permissions and file permissions. Plugin health checks list failed plugins and missing dependencies; failed plugins can be reloaded after confirmation. Manually disabled plugins are not anomalies, and disposed or unknown states are informational only. File-permission repairs require a second confirmation.

### Session manager

![Session manager](./screenshots/session-manager_en.png)

- Browse sessions by project or time, search their contents and jump to matches; filter subagents separately.
- Export complete ZIPs, archive and unarchive individually or in batches (unarchiving requires DSH ≥0.1.6).
- **Only archived sessions can be deleted**; running sessions cannot be deleted. A confirmation lists the affected sessions. Deletion records contain no transcript and cannot restore a session.

Entry: Maintenance → Sessions.

### Skills management

![Skills management](./screenshots/skill-manager_en.png)

Manage auto-loaded, manual-only and disabled skills, and repair legacy frontmatter keys. Bundled skills are read-only. AI fill drafts individual or batch descriptions; confirmed descriptions go into the plugin index without rewriting skill-file bodies.

### Backup management

![Backup management](./screenshots/backup-management_en.png)

Create, download, import, delete and restore archives of sessions, configuration and plugin-profile manifests. Old backups are never pruned automatically.

- Filenames include the DSH version at backup time (`dsh-backup-YYYYMMDD-HHmmss-dsh…tar.gz`); version information is also recorded in `meta/backup.json`.
- **Integrity inspection** must pass before **Restore preflight** shows full session replacement, configuration changes and target profiles for confirmation. Commit rechecks the archive SHA-256 and target fingerprint; changes abort the restore.
- Choose a local target profile; restoring under a different name does not overwrite its plugin manifest by default. Credentials, attachments and node_modules are not replaced.
- Newer session formats cannot be restored into an older DSH version. Managed environments restart after a successful restore; manual launches and Desktop show restart instructions.

### Safe restart

![Safe restart](./screenshots/restart_en.png)

Maintenance → Restart lists active agents, background jobs and terminals before confirmation. The conversation command `/restart` refuses while work is running. Web detects the new process and reloads automatically; on Desktop, quit and reopen the application.

**The plugin does not relaunch the process.** Configure [automatic restart](#automatic-restart) first.

### Task notifications and configuration

![Configuration](./screenshots/configuration_en.png)

- Notifications fire when a main session finishes a task, or when a main session / subagent needs approval, plan review or an answer. Subagent completion is silent.
- Enable the master notification switch and grant system permission; the composer bell provides a quick toggle.
- Configuration groups feature switches, notifications and settings-navigation order / visibility. Preferences sync across devices.

### Other features

- **Mobile adaptation**: off by default; enables narrow-screen navigation, drawer gestures and scroll-to-read immersion.
- **Provider icons**: provider marks in model buttons, model lists and quota cards, including custom aliases such as Cline. Unknown names can use the adapter type manually chosen on the quota page. Icons work offline; see the [icon catalog](docs/model-icons.html).
- **Right-sidebar file editing**: click Edit in a file preview. Supports `Ctrl/Cmd + S`, reload and undo save; respects session sandbox rules and concurrent-change protection. Maximum file size: 2 MiB.
- **External liveness probe**: `GET` / `HEAD /healthz` returns an empty 200 for Uptime Kuma or container health checks.

## Automatic restart

Web restart exits the process and requires an external process manager to relaunch it. A directly launched `dsh web` will not recover automatically.

Docker Compose:

```yaml
services:
  dsh:
    restart: unless-stopped
```

systemd (add to your existing service):

```ini
[Service]
Restart=on-failure
RestartSec=2
```

Or use pm2:

```sh
pm2 start "dsh web --host 127.0.0.1" --name dsh-web
```

If detection is inaccurate, set `DSH_SERVICE_RUNTIME_ENV=managed|manual|desktop` explicitly. This variable does not install or configure a process manager for you.

## Important notes

- Operational capabilities are exposed through loopback RPC only; `/healthz` reveals no runtime information.
- Keys go into the DSH credential store and are never echoed to the browser. Do not publish configuration, credentials or unchecked screenshots.
- Deletion, restore, credential replacement and permission repairs preview consequences. Configuration and file saves reject concurrent overwrites.
- Icon sources: [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT) and [Simple Icons](https://github.com/simple-icons/simple-icons) (CC0). Brand marks belong to their respective owners.

## FAQ

**Still on an old version after installation?** Pin `@gehennawu/dsh-service@2.0.8` or use the one-click upgrade in Service Control, then restart DSH and reload the page.

**Did not recover after restart?** Check your process manager and restart policy. The plugin only exits the process; it does not launch a new one.

**No notifications?** Check the master switch and browser / system permissions. On Desktop, clicking a notification may not restore a hidden window; open it from the tray.

**Quota credentials rejected?** Update the key or console session in the card's Config area. Repeated CLIProxyAPI authentication failures may ban the egress IP; wait for expiry or change the egress IP before retrying. Management-plane bans do not affect model inference.

## Feedback and license

Submit bugs and suggestions through [Issues](https://github.com/gehennawu/dsh-service/issues). Pull requests are welcome.

[MIT](./LICENSE)
