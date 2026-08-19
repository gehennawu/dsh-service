// Host half of @gehennawu/dsh-service
// 「服务控制」：版本信息 + 检查更新 + 一键重启 dsh web
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
import https from 'node:https'

const require = createRequire(import.meta.url)
const name = 'dsh-service'
const inject = ['connection']
const DSH_PACKAGE = '@deepseek-ai/dsh'
const NPM_REGISTRY = 'https://registry.npmjs.org/'
const MAX_NPM_RESPONSE_BYTES = 256 * 1024
const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const backupIdSecret = randomBytes(32)
const BACKUP_NAME = /^dsh-backup-\d{8}-\d{6}\.tar\.gz$/

// 读取当前 dsh 版本。DSH 包由宿主安装，不作为插件依赖打包进来。
let dshVersion = 'unknown'
try {
  dshVersion = require(`${DSH_PACKAGE}/package.json`).version
} catch (_) {
  try {
    dshVersion = require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version
  } catch (__) {}
}

// 只请求固定的 npm registry 包元数据：不接受来自浏览器的 URL 或包名，避免 SSRF。
function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const succeed = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const url = NPM_REGISTRY + encodeURIComponent(DSH_PACKAGE)
    const request = https.get(url, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'dsh-service',
      },
    }, (response) => {
      const status = response.statusCode || 0
      if (status < 200 || status >= 300) {
        response.resume()
        fail(new Error(`npm registry 返回 HTTP ${status}`))
        return
      }

      let body = ''
      let bytes = 0
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_NPM_RESPONSE_BYTES) {
          fail(new Error('npm registry 响应过大'))
          request.destroy()
          return
        }
        body += chunk
      })
      response.on('error', fail)
      response.on('end', () => {
        if (settled) return
        try {
          const data = JSON.parse(body)
          const latest = data?.['dist-tags']?.latest
          if (typeof latest !== 'string' || latest.length === 0) {
            fail(new Error('npm 响应中没有 latest 版本'))
            return
          }
          succeed(latest)
        } catch (_) {
          fail(new Error('解析 npm 响应失败'))
        }
      })
    })
    request.on('error', fail)
    request.on('timeout', () => {
      request.destroy()
      fail(new Error('请求 npm registry 超时'))
    })
  })
}

function resolveDshHome() {
  const configured = process.env.DSH_HOME?.trim()
  return configured ? configured : join(homedir(), '.dsh')
}

function formatBackupTimestamp(date) {
  const digits = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${digits(date.getMonth() + 1)}${digits(date.getDate())}-${digits(date.getHours())}${digits(date.getMinutes())}${digits(date.getSeconds())}`
}

function backupId(name) {
  return createHmac('sha256', backupIdSecret).update(name).digest('base64url')
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function listBackups(dshHome) {
  const backupDir = join(dshHome, 'backups')
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  const entries = await readdir(backupDir, { withFileTypes: true })
  const items = []
  for (const entry of entries) {
    if (!entry.isFile() || !BACKUP_NAME.test(entry.name)) continue
    const info = await stat(join(backupDir, entry.name))
    items.push({
      id: backupId(entry.name),
      name: entry.name,
      sizeBytes: info.size,
      createdAt: info.mtime.toISOString(),
    })
  }
  items.sort((a, b) => b.name.localeCompare(a.name))
  return { items, totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0) }
}

async function runTar(ctx, cwd, argv) {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('subprocess-unavailable')
  const executable = await subprocess.resolveExecutable('tar')
  const handle = subprocess.spawn({
    argv: [executable, ...argv],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 16 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 5000,
  })
  const outcome = await handle.done
  const stderr = handle.collected.stderr?.readFrom(0).text || ''
  if (outcome.exitCode !== 0 || outcome.signal !== null) {
    throw new Error(`tar-failed: ${stderr.trim() || outcome.signal || outcome.exitCode}`)
  }
}

async function createBackup(ctx, dshHome) {
  const backupDir = join(dshHome, 'backups')
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  const workspace = join(backupDir, `.staging-${randomUUID()}`)
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  try {
    const sessions = join(dshHome, 'sessions')
    if (await pathExists(sessions)) await cp(sessions, join(workspace, 'sessions'), { recursive: true })
    else await mkdir(join(workspace, 'sessions'), { recursive: true })

    const configDir = join(workspace, 'config')
    await mkdir(configDir, { recursive: true })
    for (const file of ['settings.yaml', 'cordis.patch.yml', 'AGENTS.md']) {
      const source = join(dshHome, file)
      if (await pathExists(source)) await cp(source, join(configDir, file))
    }

    const profilesSource = join(dshHome, 'profiles')
    const profilesTarget = join(workspace, 'profiles')
    await mkdir(profilesTarget, { recursive: true })
    if (await pathExists(profilesSource)) {
      for (const entry of await readdir(profilesSource, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const manifest = join(profilesSource, entry.name, 'package.json')
        if (!(await pathExists(manifest))) continue
        const target = join(profilesTarget, entry.name)
        await mkdir(target, { recursive: true })
        await cp(manifest, join(target, 'package.json'))
      }
    }

    const name = `dsh-backup-${formatBackupTimestamp(new Date())}.tar.gz`
    if (await pathExists(join(backupDir, name))) throw new Error('backup-name-collision')
    const temporary = join(backupDir, `.${name}.${randomUUID()}.tmp`)
    try {
      await runTar(ctx, workspace, ['-czf', temporary, 'sessions', 'config', 'profiles'])
      await rename(temporary, join(backupDir, name))
    } finally {
      await rm(temporary, { force: true })
    }
    const snapshot = await listBackups(dshHome)
    return { item: snapshot.items.find((item) => item.name === name), ...snapshot }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

async function deleteBackup(dshHome, id) {
  if (typeof id !== 'string' || id.length === 0) return undefined
  const snapshot = await listBackups(dshHome)
  const item = snapshot.items.find((candidate) => candidate.id === id)
  if (item === undefined) return undefined
  await unlink(join(dshHome, 'backups', basename(item.name)))
  return listBackups(dshHome)
}

function modeString(mode) {
  return '0' + (mode & 0o777).toString(8).padStart(3, '0')
}

async function runFixedCommand(ctx, argv) {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('subprocess-unavailable')
  const executable = await subprocess.resolveExecutable(argv[0])
  const handle = subprocess.spawn({
    argv: [executable, ...argv.slice(1)],
    cwd: '/',
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 16 * 1024 },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 5000,
  })
  const outcome = await handle.done
  const stderr = handle.collected.stderr?.readFrom(0).text || ''
  if (outcome.exitCode !== 0 || outcome.signal !== null) {
    throw new Error(`${argv[0]}-failed: ${stderr.trim() || outcome.signal || outcome.exitCode}`)
  }
}

async function permissionSnapshot(ctx, dshHome, plans) {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function' || typeof process.getgid !== 'function') {
    return { supported: false }
  }
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const entries = [{ label: 'DSH_HOME', path: dshHome }]
  if (workspaceRegistry !== undefined) {
    for (const workspace of workspaceRegistry.list()) {
      if (entries.some((entry) => entry.path === workspace.path)) continue
      entries.push({ label: String(workspace.title || workspace.id), path: String(workspace.path) })
    }
  }
  const items = []
  for (const entry of entries) {
    try {
      const info = await stat(entry.path)
      if (!info.isDirectory()) continue
      items.push({
        label: entry.label,
        path: entry.path,
        owner: `${info.uid}:${info.gid}`,
        mode: modeString(info.mode),
      })
    } catch (error) {
      items.push({
        label: entry.label,
        path: entry.path,
        owner: 'unavailable',
        mode: '----',
        error: error?.code || error?.message || String(error),
      })
    }
  }
  const planId = randomUUID()
  plans.clear()
  plans.set(planId, items.filter((item) => item.error === undefined).map((item) => item.path))
  return {
    supported: true,
    planId,
    targetOwner: `${process.getuid()}:${process.getgid()}`,
    items,
  }
}

async function repairPermissions(ctx, dshHome, plans, planId) {
  if (typeof planId !== 'string') return undefined
  const paths = plans.get(planId)
  if (paths === undefined) return undefined
  plans.delete(planId)
  const owner = `${process.getuid()}:${process.getgid()}`
  for (const path of paths) {
    await runFixedCommand(ctx, ['chown', '-R', owner, '--', path])
    await runFixedCommand(ctx, ['find', path, '-type', 'd', '-exec', 'chmod', '755', '{}', '+'])
    await runFixedCommand(ctx, ['find', path, '-type', 'f', '-exec', 'chmod', '644', '{}', '+'])
  }
  return permissionSnapshot(ctx, dshHome, plans)
}

async function collectHealth(ctx) {
  const sessionsService = ctx.get('sessions')
  const sessionQueryService = ctx.get('sessionQuery')
  const activity = collectActiveWork(ctx)
  const sessionRecords = sessionQueryService === undefined ? [] : await sessionQueryService.listSessions()
  const memory = process.memoryUsage()

  return {
    uptimeSeconds: process.uptime(),
    rssBytes: memory.rss,
    liveSessions: sessionsService === undefined ? 0 : sessionsService.list().length,
    persistedSessions: sessionRecords.filter((record) => record.persisted === true).length,
    activeAgents: activity.items.filter((item) => item.type === 'agent').length,
    activeJobs: activity.items.filter((item) => item.type === 'job').length,
  }
}

function collectActiveWork(ctx) {
  const agentsService = ctx.get('agents')
  const jobsService = ctx.get('jobs')
  const terminalsService = ctx.get('terminals')
  const agents = agentsService === undefined ? [] : agentsService.list()
  const items = []

  for (const agent of agents) {
    if (agent.status !== 'running') continue
    const id = String(agent.id)
    items.push({ type: 'agent', id, label: id, status: 'running' })
  }

  if (jobsService !== undefined) {
    const jobsById = new Map()
    for (const caller of [undefined, ...agents]) {
      for (const job of jobsService.list(caller)) {
        if (job.status !== 'running' && job.status !== 'stopping') continue
        jobsById.set(String(job.id), job)
      }
    }
    for (const job of jobsById.values()) {
      items.push({
        type: 'job',
        id: String(job.id),
        label: String(job.label || job.id),
        status: job.status,
        ...(job.ownerSession === undefined ? {} : { ownerSession: String(job.ownerSession) }),
      })
    }
  }

  if (terminalsService !== undefined) {
    for (const owner of agents) {
      for (const terminal of terminalsService.list(owner)) {
        if (terminal.status?.kind !== 'running') continue
        const id = String(terminal.sessionId)
        items.push({
          type: 'terminal',
          id,
          label: String(terminal.name || `${terminal.type} terminal`),
          status: 'running',
          ownerSession: String(owner.id),
        })
      }
    }
  }

  return { hasActive: items.length > 0, items }
}

function apply(ctx) {
  const dshHome = resolveDshHome()
  const permissionPlans = new Map()
  ctx.effect(() => () => permissionPlans.clear(), 'dsh-service permission plans')
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/healthz',
      handler: (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405)
          res.end()
          return
        }
        res.writeHead(200)
        res.end()
      },
    }), 'dsh-service healthz route')
  }

  // DSH 的 Connection RPC channel 只能是单层绝对路径；子功能放在 endpoint 中。
  // 合法示例：channel=/dsh-service，endpoint=version/check-update/activity/web。
  ctx.connection.rpc.handle('/dsh-service', async (endpoint, payload) => {
    if (endpoint === 'version') {
      return { ok: true, value: { current: dshVersion, instanceId } }
    }

    if (endpoint === 'check-update') {
      try {
        const latest = await fetchLatestVersion()
        return {
          ok: true,
          value: { current: dshVersion, latest, upToDate: dshVersion === latest },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'activity') {
      return { ok: true, value: collectActiveWork(ctx) }
    }

    if (endpoint === 'health') {
      try {
        return { ok: true, value: await collectHealth(ctx) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'permissions-plan') {
      try {
        return { ok: true, value: await permissionSnapshot(ctx, dshHome, permissionPlans) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'permissions-repair') {
      try {
        const value = await repairPermissions(ctx, dshHome, permissionPlans, payload?.planId)
        if (value === undefined) return { ok: false, error: 'unknown-permission-plan' }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-list') {
      try {
        return { ok: true, value: await listBackups(dshHome) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-create') {
      try {
        return { ok: true, value: await createBackup(ctx, dshHome) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-delete') {
      try {
        const value = await deleteBackup(dshHome, payload?.id)
        if (value === undefined) return { ok: false, error: 'unknown-backup' }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'web') {
      const activity = collectActiveWork(ctx)
      if (activity.hasActive && payload?.force !== true) {
        return { ok: false, error: 'active-work', value: activity }
      }

      const doExit = () => {
        try {
          // 退出码 42 交给 Docker/systemd/pm2 的重启策略处理。
          process.exit(42)
        } catch (error) {
          console.error('dsh-service: exit failed', error?.message || error)
        }
      }
      const timer = ctx.get('timer')
      if (timer !== undefined) timer.timeout(doExit, 500)
      else doExit()
      return {
        ok: true,
        value: {
          message: '重启指令已发出，进程将在 0.5 秒后退出',
          instanceId,
        },
      }
    }

    return { ok: false, error: 'unknown endpoint: ' + String(endpoint) }
  }, { authority: 'loopback' })
}

export { apply, inject, name }
export default { apply, inject, name }
