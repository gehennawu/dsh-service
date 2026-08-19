# dsh-service

[中文](./README.md)

A DSH Web plugin (package: `@gehennawu/dsh-service`) that provides service controls, version information, and update checks in Settings.

> This project only sends an exit signal to the current DSH Web process. Automatic recovery is the responsibility of an external process manager.

## Scope and platform support

### Summary

The plugin itself is **not Linux-only**. Version display, update checks, the Settings UI, and RPC use cross-platform DSH/Node.js capabilities and should theoretically work on Linux, macOS, and Windows.

However, the project is currently verified only with **Linux + Docker**. Whether the service starts again after an exit depends on the configured process manager, not on this plugin alone.

| Platform / runtime | Plugin loading, version display, update check | Restart button | Automatic recovery after exit | Verification |
| --- | --- | --- | --- | --- |
| Linux + Docker Compose | Supported | Supported | Supported with `restart: unless-stopped` / `always` | Verified |
| Linux + systemd | Supported | Supported | Supported with `Restart=on-failure` / `always` | Mechanism confirmed; not separately tested here |
| Linux / macOS / Windows + pm2 | Supported | Supported | Managed by pm2 | Depends on pm2 configuration; not separately tested |
| Windows / macOS + another process manager | Supported | Supported | Supported if the manager restarts the DSH command after exit code `42` | Not separately tested |
| Direct `dsh web` execution without a process manager | Supported | Process exits | No automatic recovery | Expected behavior |

### Requirements

- Node.js must satisfy the version in package.json (currently `>=22`).
- DSH Web must be able to load both the Host and Client halves of the plugin.
- Update checks require access to `registry.npmjs.org`. Network failures only affect update checks, not plugin loading.
- The restart button exits the DSH Web process with code `42`. Docker, systemd, pm2, launchd, or another external process manager must restart it.

### Windows and macOS

Windows and macOS are not blocked by the code, but neither platform has received a full regression test. Validate the following on a test instance first:

1. The process manager observes exit code `42`.
2. The manager starts the same `dsh web` command again.
3. Both the Host and Client plugin halves load correctly.

## Features

- **Version information**: displays the installed DSH version.
- **Update check**: reads the `latest` version of `@deepseek-ai/dsh` from a fixed npm registry URL.
- **One-click restart**: after a two-step confirmation, exits with code `42` and lets Docker, systemd, or pm2 take over.
- **Loopback RPC**: restart and version interfaces are registered only on a loopback channel and do not accept external network requests.
- **Current RPC layout**: uses a single-level `/dsh-service` channel with `version`, `check-update`, and `web` endpoints.
- **Lifecycle safety**: prefers the DSH `timer` service for scheduling the exit so Fiber disposal can clean it up; exits immediately only when the service is unavailable.

## Security

- The plugin does not accept user-provided URLs, package names, commands, or file paths.
- Update checks only access `https://registry.npmjs.org/@deepseek-ai%2Fdsh`, with a 256 KiB response limit and a 10-second timeout.
- The plugin contains no tokens, passwords, private keys, or persistent credentials.
- Restarting interrupts active work. Only trusted users should have access to DSH Web.
- Exit code `42` does not restart the process by itself. Without a process manager, the service stops after restart is requested.

## Installation

### Install from GitHub

```sh
dsh plugin --profile web add github:gehennawu/dsh-service
```

Restart DSH Web after installing or updating so both plugin halves are loaded:

```sh
dsh web
```

### Local development

```sh
dsh plugin --profile web add link:/path/to/dsh-service
```

### Migrating from restart-dsh

The package name, Client module ID, Cordis plugin ID, and RPC channel now consistently use dsh-service. Remove the old package and reinstall from the same repository:

```sh
dsh plugin --profile web remove @dsh-nas/restart-dsh
dsh plugin --profile web add github:gehennawu/dsh-service
```

Restart `dsh web` after migrating. This rename does not migrate or delete sessions, workspaces, or other DSH data.

## Automatic restart configuration

The following configurations only restart the process after it exits. The plugin does not install or modify system services.

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

## Usage

Open DSH Web Settings and select **Service Control**:

1. View the current DSH version.
2. Select **Check for updates** to see the latest npm version.
3. Select **Restart dsh web**, then confirm to restart the service.

## Development and validation

This project is a two-sided DSH plugin:

- `index.js`: Host half; registers loopback RPC.
- `client.js`: Browser half; registers the Settings UI.
- `cordis.patch.yml`: inserts the plugin into the DSH plugin tree.

Basic checks:

```sh
node --check index.js
node --check client.js
```

## License

[MIT](./LICENSE)
