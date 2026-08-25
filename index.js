// Host half of @gehennawu/dsh-service
// 「服务控制」：版本信息 + 检查更新 + 一键重启 dsh web
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { constants as fsConstants, existsSync, readFileSync } from 'node:fs'
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import z from '@deepseek-ai/schemastery'

const require = createRequire(import.meta.url)
const name = 'dsh-service'
const inject = ['connection']
const DSH_PACKAGE = '@deepseek-ai/dsh'
const PLUGIN_PACKAGE = '@gehennawu/dsh-service'
const SETTINGS_NAMESPACE = 'dsh-service'
const DEFAULT_FEATURE_SETTINGS = Object.freeze({
  modelUsage: true,
  quotaLookup: true,
  backupMaintenance: true,
  taskNotifications: true,
  healthz: true,
  skillManager: true,
})
const FeatureSettingsSchema = z.object({
  modelUsage: z.boolean().default(true),
  quotaLookup: z.boolean().default(true),
  backupMaintenance: z.boolean().default(true),
  taskNotifications: z.boolean().default(true),
  healthz: z.boolean().default(true),
  skillManager: z.boolean().default(true),
})
const NPM_REGISTRY = 'https://registry.npmjs.org/'
const MAX_NPM_RESPONSE_BYTES = 256 * 1024
const MAX_BACKUP_TRANSFER_BYTES = 128 * 1024 * 1024
const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const backupIdSecret = randomBytes(32)
const BACKUP_NAME = /^dsh-backup-\d{8}-\d{6}\.tar\.gz$/
const USAGE_INDEX_VERSION = 5
const USAGE_INDEX_FILE = 'dsh-service-usage-index.json'

// 技能管理（v0.22）：来源 rank 表复制自 @deepseek-ai/dsh-skill-filesystem 0.1.1-rc.2
// 常量，只用于展示与同名遮蔽判定；官方升级改值时此处同步。
const SKILL_SOURCE_RANK = Object.freeze({ 'project-dsh': 100, 'project-agents': 200, custom: 300, 'user-dsh': 400, 'user-agents': 500, bundled: 600 })
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SKILLS_INDEX_VERSION = 2
const SKILLS_INDEX_FILE = 'dsh-service-skills-index.json'
const MAX_SKILL_FILE_BYTES = 512 * 1024
const SKILL_DESCRIBE_TIMEOUT_MS = 90 * 1000
const SKILL_DESCRIBE_MAX_TOKENS = 2000
const SKILL_DESCRIBE_ATTEMPTS = 3
const SKILL_DESCRIPTION_MAX_CHARS = 200
const SKILL_USAGE_MAX_CHARS = 300
const skillsIdSecret = randomBytes(32)
// 官方解析器整条剔除的 legacy 调用键 → 规范键与语义换算。invert:true 表示 legacy 真值
// 等价规范键「不写行」（如 modelInvocable:true ≡ 无 disable-model-invocation）。
const SKILL_LEGACY_KEYS = {
  disableModelInvocation: { canonical: 'disable-model-invocation', invert: false },
  modelInvocable: { canonical: 'disable-model-invocation', invert: true },
  userInvocable: { canonical: 'user-invocable', invert: true },
}

// 远端额度（v0.18）：kind 白名单与节律参数。节律数值只在此处与 TODO.md 里程碑两处出现。
const QUOTA_CONFIG_VERSION = 1
const QUOTA_CONFIG_FILE = 'dsh-service-quota.json'
// kind 注册表：新增供应商方言只改这一处（此前散在 5 张表里，加 kind 要改 5 处）。
// parser 是归一化函数（函数声明有提升，可在定义之前引用）；
// 归一化窗口可选字段 remaining:true 表示 percentage 原生就是「剩余百分比」（如 MiniMax 的
// remaining_percent）——客户端据此把「已用」切换为「剩余」，进度条预警阈值反向；缺省按已用口径。
// endpoints 是宿主常量候选链——按序尝试，401/403 换下一候选（智谱双域 Key 不互通），
// 其余错误终止；缺省走 {baseURL}/usage 约定（baseURL 为空时链为空 → 稳定错误码 no-base-url）。
// keyHints 是 Key 发现线索名（settings 声明 → DSH 凭据库 → 环境变量，含旧名兼容）；
// hosts 供 baseURL 唯一命中自动推断（0 条或歧义都不猜）。
const KIND_REGISTRY = {
  'opencode-go': {
    parser: normalizeOpencodeUsage,
    keyHints: ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
    hosts: ['opencode.ai'],
    // 官网用户页（卡片标题外链；宿主常量，零浏览器输入）。
    usageUrl: 'https://opencode.ai/',
  },
  'zai-coding-cn': {
    parser: normalizeZaiCodingUsage,
    endpoints: [
      'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
      'https://api.z.ai/api/monitor/usage/quota/limit',
    ],
    keyHints: ['ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'],
    hosts: ['open.bigmodel.cn', 'bigmodel.cn'],
    usageUrl: 'https://open.bigmodel.cn/coding-plan/personal/usage',
  },
  openrouter: {
    parser: normalizeOpenRouterCredits,
    endpoints: ['https://openrouter.ai/api/v1/credits'],
    keyHints: ['OPENROUTER_API_KEY'],
    hosts: ['openrouter.ai'],
  },
  kimi: {
    parser: normalizeKimiBalance,
    endpoints: ['https://api.moonshot.cn/v1/users/me/balance'],
    keyHints: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    hosts: ['moonshot.cn', 'kimi.com'],
  },
  siliconflow: {
    parser: normalizeSiliconFlowInfo,
    endpoints: ['https://api.siliconflow.cn/v1/user/info'],
    keyHints: ['SILICONFLOW_API_KEY'],
    hosts: ['siliconflow.cn'],
  },
  // DeepSeek 开放平台官方余额（v0.25）：GET /user/balance，Bearer 即 API key。
  // balance_infos[] 每项一个币种（文档枚举 CNY/USD），金额是字符串，total = granted + topped_up。
  deepseek: {
    parser: normalizeDeepseekBalance,
    endpoints: ['https://api.deepseek.com/user/balance'],
    keyHints: ['DEEPSEEK_API_KEY'],
    hosts: ['api.deepseek.com', 'deepseek.com'],
    usageUrl: 'https://platform.deepseek.com/usage',
  },
  // CLIProxyAPI（router-for-me/CLIProxyAPI）管理面：查它托管的 OAuth 上游账号官方额度。
  // 无固定 endpoints / 全局 hosts——每个部署一个域名，保存适配时把 settings baseURL 的
  // hostname 钉进配置 allowedHosts[provider]（见 quota-config 写入口），外呼前复验精确命中。
  // managementPlane:true 表示凭据是 remote-management.secret-key（线索 CPA_MANAGEMENT_KEY），
  // 绝不使用也不回退 settings 的 apiKeyEnv——那是代理 key，发去管理面等于拿错钥匙撞 fail2ban
  // （CPA 内建：管理面错 key 满 5 次封 IP 30 分钟，源码核实）。
  cliproxy: {
    fetcher: fetchCliproxyUsage,
    fetcherGuard: cliproxyFetchGuard,
    keyHints: ['CPA_MANAGEMENT_KEY', 'CLIPROXY_MANAGEMENT_KEY'],
    hosts: [],
    managementPlane: true,
  },
}
const QUOTA_KINDS = Object.keys(KIND_REGISTRY)
const QUOTA_UPSTREAM_TIMEOUT_MS = 15000
const QUOTA_PROVIDER_DEADLINE_MS = 50 * 1000
const QUOTA_SUCCESS_TTL_MS = 60000
const QUOTA_MIN_INTERVAL_MS = 15000
const QUOTA_MANUAL_COOLDOWN_MS = 5000
const QUOTA_BACKOFF_BASE_MS = 30000
const QUOTA_BACKOFF_MAX_MS = 15 * 60 * 1000
const QUOTA_CONFIG_STAT_TTL_MS = 5000
const QUOTA_MAX_CONCURRENCY = 4
const MAX_QUOTA_RESPONSE_BYTES = 64 * 1024
const MAX_QUOTA_CONFIG_BYTES = 256 * 1024
const MAX_QUOTA_PROVIDERS = 256
const MAX_QUOTA_PROVIDER_NAME = 128
const MAX_QUOTA_RESET_CARDS = 500
const MAX_QUOTA_RESET_CARDS_PER_PROVIDER = 10
const MAX_QUOTA_ERROR_DETAIL = 256
// CLIProxyAPI 编排参数（v0.24）：账号数 / api-call 总次数（antigravity 候选 URL 也计入）/
// 并发 / 窗口总数上限。数值只在此处与 TODO.md 里程碑两处出现。
const MAX_QUOTA_CPA_ACCOUNTS = 8
const MAX_QUOTA_CPA_CALLS = 12
const QUOTA_CPA_CONCURRENCY = 3
const MAX_QUOTA_CPA_WINDOWS = 32

// 升级目标白名单：命令与包名全部来自宿主常量，浏览器不传任何输入。
// TARGET_RE 与 dsh-market 同源：只放行「包名@版本」这一种形状的字符集。
const TARGET_RE = /^[A-Za-z0-9@:./_#+~^=-]+$/
const RELEASE_AGE_OVERRIDE = '--config.minimumReleaseAge=0'
const FETCH_TIMEOUT_OVERRIDE = '--config.fetchTimeout=600000'
// 当前正在运行的插件源码目录：定位「本插件由哪个 profile 挂载」时与磁盘副本做 realpath 匹配。
const loadedPluginDir = dirname(fileURLToPath(import.meta.url))

// 读取当前 dsh 版本。DSH 包由宿主安装，不作为插件依赖打包进来。
let dshVersion = 'unknown'
let pluginVersion = 'unknown'
try { pluginVersion = require('./package.json').version } catch (_) {}
try {
  dshVersion = require(`${DSH_PACKAGE}/package.json`).version
} catch (_) {
  try {
    dshVersion = require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version
  } catch (__) {}
}

// Node 最低要求只读 package.json engines 一处（与版本号同源），启动时解析一次。
let requiredNodeMajor = 22
try {
  const enginesNode = require('./package.json').engines?.node || ''
  requiredNodeMajor = parseInt(enginesNode.replace(/[^0-9].*$/, ''), 10) || 22
} catch (_) {}

function isSemverIdentifier(value) {
  if (value.length === 0) return false
  return [...value].every((char) => (char >= '0' && char <= '9') || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '-')
}

function isNumericSemverIdentifier(value) {
  return value.length > 0 && [...value].every((char) => char >= '0' && char <= '9')
}

function parseSemver(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const buildParts = trimmed.split('+')
  if (buildParts.length > 2 || (buildParts.length === 2 && !buildParts[1].split('.').every((part) => isSemverIdentifier(part)))) return null
  const versionPart = buildParts[0]
  const dashIndex = versionPart.indexOf('-')
  const corePart = dashIndex === -1 ? versionPart : versionPart.slice(0, dashIndex)
  const prereleasePart = dashIndex === -1 ? '' : versionPart.slice(dashIndex + 1)
  if (dashIndex !== -1 && prereleasePart.length === 0) return null
  const core = corePart.split('.')
  if (core.length !== 3 || !core.every((part) => isNumericSemverIdentifier(part) && (part.length === 1 || !part.startsWith('0')))) return null
  const prerelease = prereleasePart === '' ? [] : prereleasePart.split('.')
  if (!prerelease.every((part) => isSemverIdentifier(part) && !(isNumericSemverIdentifier(part) && part.length > 1 && part.startsWith('0')))) return null
  return { major: Number(core[0]), minor: Number(core[1]), patch: Number(core[2]), prerelease }
}

function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (index >= a.prerelease.length) return -1
    if (index >= b.prerelease.length) return 1
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === rightPart) continue
    const leftNumeric = /^[0-9]+$/.test(leftPart)
    const rightNumeric = /^[0-9]+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

function atLeastSemver(current, target) {
  if (parseSemver(current) && parseSemver(target)) return compareSemver(current, target) >= 0
  return current === target
}

// 只请求固定的 npm registry 包元数据：不接受来自浏览器的 URL 或包名，避免 SSRF。
function fetchPublishedVersions(packageName) {
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

    const url = NPM_REGISTRY + encodeURIComponent(packageName)
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
          const distTags = data?.['dist-tags'] || {}
          const normalizeTag = (value) => {
            const version = typeof value === 'string' ? value.trim() : ''
            return parseSemver(version) === null ? null : version
          }
          const tags = {
            latest: normalizeTag(distTags.latest),
            next: normalizeTag(distTags.next),
          }
          const versions = [tags.latest, tags.next].filter((version) => parseSemver(version) !== null)
          if (versions.length === 0) {
            fail(new Error('npm 响应中没有有效的 latest 或 next 版本'))
            return
          }
          const latest = versions.reduce((selected, version) => compareSemver(version, selected) > 0 ? version : selected)
          succeed({ latest, tags })
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

async function restoreBackup(ctx, dshHome, id) {
  if (typeof id !== 'string' || id.length === 0) return undefined
  const snapshot = await listBackups(dshHome)
  const item = snapshot.items.find((candidate) => candidate.id === id)
  if (item === undefined) return undefined
  const staging = join(dshHome, 'backups', `.restore-${randomUUID()}`)
  await mkdir(staging, { recursive: true, mode: 0o700 })
  try {
    await runTar(ctx, join(dshHome, 'backups'), ['-xzf', basename(item.name), '-C', staging])
    const extractedSessions = join(staging, 'sessions')
    if (await pathExists(extractedSessions)) {
      const targetSessions = join(dshHome, 'sessions')
      await rm(targetSessions, { recursive: true, force: true })
      await cp(extractedSessions, targetSessions, { recursive: true })
    }
    const extractedConfig = join(staging, 'config')
    if (await pathExists(extractedConfig)) {
      for (const file of ['settings.yaml', 'cordis.patch.yml', 'AGENTS.md']) {
        const source = join(extractedConfig, file)
        if (await pathExists(source)) await cp(source, join(dshHome, file), { recursive: true })
      }
    }
    const extractedProfiles = join(staging, 'profiles')
    if (await pathExists(extractedProfiles)) {
      const targetProfiles = join(dshHome, 'profiles')
      for (const entry of await readdir(extractedProfiles, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const manifest = join(extractedProfiles, entry.name, 'package.json')
        if (!(await pathExists(manifest))) continue
        const target = join(targetProfiles, entry.name)
        await mkdir(target, { recursive: true })
        await cp(manifest, join(target, 'package.json'))
      }
    }
    return { restoredFrom: item.name }
  } finally {
    await rm(staging, { recursive: true, force: true })
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

async function exportBackup(dshHome, downloadTokens, id) {
  if (typeof id !== 'string' || id.length === 0) return undefined
  const snapshot = await listBackups(dshHome)
  const item = snapshot.items.find((candidate) => candidate.id === id)
  if (item === undefined) return undefined
  const token = randomUUID()
  downloadTokens.set(token, { name: item.name, path: join(dshHome, 'backups', basename(item.name)), expires: Date.now() + 60000 })
  return { name: item.name, url: `/dsh-backup-download?token=${token}` }
}

async function importBackup(dshHome, name, encoded) {
  if (typeof name !== 'string' || !BACKUP_NAME.test(name) || typeof encoded !== 'string' || encoded.length === 0) return undefined
  const data = Buffer.from(encoded, 'base64')
  if (data.length === 0 || data.length > MAX_BACKUP_TRANSFER_BYTES) return undefined
  const backupDir = join(dshHome, 'backups')
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  const target = join(backupDir, basename(name))
  if (basename(name) !== name || await pathExists(target)) return undefined
  const temporary = join(backupDir, `.${name}.${randomUUID()}.import`)
  try {
    await writeFile(temporary, data, { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
  return listBackups(dshHome)
}

function usageHour(time) {
  return new Date(time).toISOString().slice(0, 13)
}

function localDayForHour(hour, timezoneOffsetMinutes = 0) {
  const offset = Number.isFinite(Number(timezoneOffsetMinutes)) ? Math.max(-840, Math.min(840, Number(timezoneOffsetMinutes))) : 0
  const utcTime = Date.parse(`${hour}:00:00.000Z`)
  return new Date(utcTime - offset * 60 * 1000).toISOString().slice(0, 10)
}

function emptyUsageTotals() {
  return { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

function addUsageTotals(target, source) {
  target.steps += source.steps || 0
  target.inputTokens += source.inputTokens || 0
  target.outputTokens += source.outputTokens || 0
  target.cacheReadTokens += source.cacheReadTokens || 0
  target.cacheWriteTokens += source.cacheWriteTokens || 0
  return target
}

function cacheHitRate(totals) {
  const denominator = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  return denominator === 0 ? 0 : totals.cacheReadTokens / denominator
}

function projectForCwd(ctx, cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return { id: 'ungrouped', title: 'Ungrouped', path: null }
  const registry = ctx.get('workspaceRegistry')
  let workspaces = []
  if (registry !== undefined) {
    try {
      const listed = registry.list()
      workspaces = Array.isArray(listed) ? listed : [...listed]
    } catch (_) {}
  }
  const absoluteCwd = resolve(cwd)
  let selected
  for (const workspace of workspaces) {
    const workspacePath = resolve(String(workspace.path))
    const child = relative(workspacePath, absoluteCwd)
    if (child === '..' || child.startsWith(`..${sep}`) || resolve(workspacePath, child) !== absoluteCwd) continue
    if (selected === undefined || workspacePath.length > selected.path.length) {
      selected = { id: String(workspace.id), title: String(workspace.title || workspace.id), path: workspacePath }
    }
  }
  return selected || { id: `cwd:${absoluteCwd}`, title: basename(absoluteCwd) || absoluteCwd, path: absoluteCwd }
}

function revisionKey(revision) {
  return typeof revision === 'string' ? revision : JSON.stringify(revision)
}

function createUsageIndex() {
  return { version: USAGE_INDEX_VERSION, updatedAt: 0, sessions: {} }
}

async function loadUsageIndex(dshHome) {
  try {
    const parsed = JSON.parse(await readFile(join(dshHome, USAGE_INDEX_FILE), 'utf8'))
    if (parsed?.version !== USAGE_INDEX_VERSION || typeof parsed.sessions !== 'object' || parsed.sessions === null) return createUsageIndex()
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return createUsageIndex()
    return createUsageIndex()
  }
}

async function saveUsageIndex(dshHome, index) {
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, USAGE_INDEX_FILE)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(index), { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

// ── 远端额度（v0.18）：kind 映射存取、方言解析、节流状态机 ─────────────

function createEmptyQuotaConfig() {
  return { version: QUOTA_CONFIG_VERSION, kinds: {}, resetCards: [], allowedHosts: {} }
}

/** 钉住表主机名归一：小写、去尾点；拒绝 IP 字面量与非法形状。合法返回归一值，否则 undefined。 */
function normalizeQuotaHostname(value) {
  if (typeof value !== 'string') return undefined
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  if (host.length === 0 || host.length > 253) return undefined
  if (host.includes(':')) return undefined
  // IP 字面量的全部数值编码一并拒收：getaddrinfo 对十六进制（0x7f000001 / 0x7f.0.0.1）、纯整数
  // （2130706433）、八进制（0177.0.0.1）标签都会解析成 IP——「每个标签都是纯数字或 0x 十六进制」
  // 即按 IP 对待；数字标签混在真域名里（如 127.0.0.1.nip.io）不受影响。
  if (host.split('.').every((label) => /^(0x[0-9a-f]+|\d+)$/.test(label))) return undefined
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) return undefined
  return host
}

/** 解析磁盘上的 allowedHosts（cliproxy 等「每部署一个域名」kind 的钉住表）：
 * provider 键沿用 kinds 白名单形状，每家最多 4 条去重主机名；非法条目整键丢弃。 */
function normalizeQuotaAllowedHosts(raw) {
  if (typeof raw !== 'object' || raw === null) return {}
  const out = {}
  let count = 0
  for (const [provider, hosts] of Object.entries(raw)) {
    if (count >= MAX_QUOTA_PROVIDERS) break
    if (typeof provider !== 'string' || provider.length === 0 || provider.length > MAX_QUOTA_PROVIDER_NAME) continue
    if (!Array.isArray(hosts)) continue
    const normalized = []
    for (const candidate of hosts) {
      if (normalized.length >= 4) break
      const host = normalizeQuotaHostname(candidate)
      if (host !== undefined && !normalized.includes(host)) normalized.push(host)
    }
    if (normalized.length > 0) {
      out[provider] = normalized
      count += 1
    }
  }
  return out
}

/**
 * 校验手录的重置卡条目（v0.19 过渡方案：官方无 API Key 可查的端点，用户手填）。
 * v0.20 起免次数、每 provider 可多条：provider 必填，label/expiresAt 可选；id 缺失时按
 * 原始位置合成稳定 id（老数据兼容），写入口生成的 id 原样保留。
 */
function normalizeResetCards(raw) {
  if (!Array.isArray(raw)) return []
  const cards = []
  const perProvider = new Map()
  for (let index = 0; index < raw.length && cards.length < MAX_QUOTA_RESET_CARDS; index += 1) {
    const card = raw[index]
    if (card === null || typeof card !== 'object') continue
    const provider = typeof card.provider === 'string' && card.provider.trim() !== '' ? card.provider.trim().slice(0, MAX_QUOTA_PROVIDER_NAME) : ''
    if (provider === '') continue
    const providerCount = perProvider.get(provider) ?? 0
    if (providerCount >= MAX_QUOTA_RESET_CARDS_PER_PROVIDER) continue
    const normalized = { id: typeof card.id === 'string' && card.id.trim() !== '' ? card.id.trim().slice(0, 64) : `legacy-${index}`, provider }
    if (typeof card.label === 'string' && card.label.trim() !== '') normalized.label = card.label.trim().slice(0, 40)
    if (typeof card.expiresAt === 'string' && card.expiresAt.trim() !== '') normalized.expiresAt = card.expiresAt.trim().slice(0, 32)
    cards.push(normalized)
    perProvider.set(provider, providerCount + 1)
  }
  return cards
}

/** 解析磁盘上的 kind 映射：损坏/版本不符回退空映射，未知 kind 条目丢弃（白名单外不认）。 */
function parseQuotaConfigText(text) {
  const fallback = createEmptyQuotaConfig()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (_) {
    return fallback
  }
  if (parsed?.version !== QUOTA_CONFIG_VERSION || typeof parsed.kinds !== 'object' || parsed.kinds === null) return fallback
  const kinds = {}
  let kindCount = 0
  for (const [provider, kind] of Object.entries(parsed.kinds)) {
    if (kindCount >= MAX_QUOTA_PROVIDERS) break
    // null = 显式停用（即使 baseURL 可自动推断也不外呼），必须保留。
    if (typeof provider === 'string' && provider.length > 0 && provider.length <= MAX_QUOTA_PROVIDER_NAME && (kind === null || QUOTA_KINDS.includes(kind))) {
      kinds[provider] = kind
      kindCount += 1
    }
  }
  return { version: QUOTA_CONFIG_VERSION, kinds, resetCards: normalizeResetCards(parsed.resetCards), allowedHosts: normalizeQuotaAllowedHosts(parsed.allowedHosts) }
}

async function loadQuotaConfig(dshHome) {
  try {
    const target = join(dshHome, QUOTA_CONFIG_FILE)
    const info = await stat(target)
    if (info.size > MAX_QUOTA_CONFIG_BYTES) return createEmptyQuotaConfig()
    return parseQuotaConfigText(await readFile(target, 'utf8'))
  } catch (_) {
    return createEmptyQuotaConfig()
  }
}

async function saveQuotaConfig(dshHome, config) {
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, QUOTA_CONFIG_FILE)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(config), { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

function copyQuotaConfig(config) {
  const allowedHosts = {}
  for (const [provider, hosts] of Object.entries(config?.allowedHosts ?? {})) {
    allowedHosts[provider] = Array.isArray(hosts) ? [...hosts] : []
  }
  return {
    version: QUOTA_CONFIG_VERSION,
    kinds: { ...(config?.kinds ?? {}) },
    resetCards: Array.isArray(config?.resetCards) ? config.resetCards.map((card) => ({ ...card })) : [],
    allowedHosts,
  }
}

/** settings llm-pi-ai 段 → provider 行；无 settings 服务、段落缺失或形状不符返回空表。 */
function readLlmProviders(settings) {
  let section
  try {
    section = typeof settings?.get === 'function' ? settings.get('llm-pi-ai') : undefined
  } catch (_) {
    return []
  }
  const providers = section?.providers
  if (typeof providers !== 'object' || providers === null) return []
  return Object.entries(providers)
    .filter(([providerName]) => typeof providerName === 'string' && providerName.length > 0 && providerName.length <= MAX_QUOTA_PROVIDER_NAME)
    .slice(0, MAX_QUOTA_PROVIDERS)
    .map(([providerName, profile]) => ({
      name: providerName,
      displayName: typeof profile?.displayName === 'string' && profile.displayName.length > 0 ? profile.displayName.slice(0, 128) : providerName,
      baseURL: typeof profile?.baseURL === 'string' ? profile.baseURL.trim().replace(/\/+$/, '') : '',
      apiKeyEnv: typeof profile?.apiKeyEnv === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(profile.apiKeyEnv) ? profile.apiKeyEnv : '',
    }))
}

/**
 * 运行时 LLM 渠道别名表（v0.25）：DSH 有 settings 之外的内置 LLM 渠道（如 dsh-llm-deepseek
 * 注册的 deepseek-official 路由），它们不出现在 llm-pi-ai.providers 清单里，额度查询却同样适用。
 * 只有「kind 固定端点 + keyHints 齐备」的渠道才允许进表——进表即自证兼容（官方域名、凭据线索
 * 宿主常量），延续零意外外呼口径：不在表内的运行时渠道一概不产生行。
 */
const QUOTA_RUNTIME_CHANNEL_KINDS = {
  'deepseek-official': 'deepseek',
}

/** 运行时 llm 服务已注册渠道 → 合成 provider 行（runtimeKind 标记别名来源）。服务缺席/异常返回空表。
 * 注意 listProviders() 的真实契约（dsh-llm 源码核实）：下发 [{id,name,…}] 对象数组、注册顺序，
 * 不是字符串——v0.25 首版按字符串过滤导致全部条目被静默跳过（测试假桩喂字符串掩盖了 bug）。 */
function readRuntimeQuotaChannels(llm) {
  if (llm === undefined || llm === null || typeof llm.listProviders !== 'function') return []
  let providers
  try {
    providers = llm.listProviders()
  } catch (_) {
    return []
  }
  if (!Array.isArray(providers)) return []
  const channels = []
  for (const entry of providers) {
    const id = typeof entry === 'string' ? entry : entry !== null && typeof entry === 'object' ? entry.id : undefined
    if (typeof id !== 'string' || id.length === 0 || id.length > MAX_QUOTA_PROVIDER_NAME) continue
    if (!Object.prototype.hasOwnProperty.call(QUOTA_RUNTIME_CHANNEL_KINDS, id)) continue
    const kind = QUOTA_RUNTIME_CHANNEL_KINDS[id]
    if (KIND_REGISTRY[kind] === undefined) continue
    const displayName = typeof entry === 'object' && entry !== null && typeof entry.name === 'string' && entry.name.trim() !== ''
      ? entry.name.trim().slice(0, 128)
      : id
    channels.push({ name: id, displayName, baseURL: '', apiKeyEnv: '', runtimeKind: kind })
  }
  return channels
}

/** 额度查询的供应商清单 = settings 路由在前 + 运行时别名渠道殿后（settings 同名条目优先）。 */
function readQuotaProfiles(settings, llm) {
  const profiles = readLlmProviders(settings)
  const known = new Set(profiles.map((profile) => profile.name))
  for (const channel of readRuntimeQuotaChannels(llm)) {
    if (!known.has(channel.name)) profiles.push(channel)
  }
  return profiles
}

/**
 * opencode-go 方言 → 统一窗口形状。真实端点只有 percent 与 resetsAt（ISO），
 * 没有金额字段：percent 是一等公民，缺字段/非数字跳过该窗口，percent 截到 [0,100]。
 */
function normalizeOpencodeUsage(payload) {
  const windows = []
  const usage = payload?.usage
  if (typeof usage !== 'object' || usage === null) return { windows }
  for (const id of ['rolling', 'weekly', 'monthly']) {
    const window = usage[id]
    if (typeof window !== 'object' || window === null) continue
    if (typeof window.percent !== 'number' || !Number.isFinite(window.percent)) continue
    windows.push({
      id,
      percent: Math.max(0, Math.min(100, Math.round(window.percent))),
      ...(typeof window.resetsAt === 'string' && window.resetsAt.length > 0 ? { resetsAt: window.resetsAt } : {}),
    })
  }
  return { windows }
}

function quotaHostnameMatches(hostname, registeredHost) {
  const actual = String(hostname || '').toLowerCase().replace(/\.$/, '')
  const expected = String(registeredHost || '').toLowerCase().replace(/\.$/, '')
  return actual === expected || actual.endsWith(`.${expected}`)
}

function safeQuotaBaseUrl(kind, baseURL) {
  const registered = KIND_REGISTRY[kind]
  if (registered === undefined || !Array.isArray(registered.hosts) || registered.hosts.length === 0) return undefined
  let parsed
  try { parsed = new URL(String(baseURL ?? '').trim()) } catch (_) { return undefined }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined
  if (parsed.port !== '' && parsed.port !== '443') return undefined
  if (!registered.hosts.some((host) => quotaHostnameMatches(parsed.hostname, host))) return undefined
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed
}

/** kind → 上游查询端点候选数组：注册表登记的 kind 用宿主常量链；动态端点仅接受 HTTPS + 注册 host。 */
function quotaEndpointFor(kind, baseURL) {
  const registered = KIND_REGISTRY[kind]
  if (registered !== undefined && Array.isArray(registered.endpoints)) return [...registered.endpoints]
  const base = safeQuotaBaseUrl(kind, baseURL)
  if (base === undefined) return []
  base.pathname = `${base.pathname}/usage`.replace(/\/{2,}/g, '/')
  return [base.toString()]
}

/** 由 baseURL 推断 kind：按 URL hostname 精确/子域匹配；0 条或歧义都不猜。 */
function inferQuotaKind(baseURL) {
  let parsed
  try { parsed = new URL(String(baseURL || '').trim()) } catch (_) { return undefined }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined
  const hits = Object.entries(KIND_REGISTRY).filter(([, registered]) =>
    (registered.hosts ?? []).some((host) => quotaHostnameMatches(parsed.hostname, host)))
  return hits.length === 1 ? hits[0][0] : undefined
}

/** 保存适配时的钉住派生（服务端从 settings baseURL 取值，浏览器零输入）：
 * 仅接受 HTTPS、无 userinfo、默认端口、DNS 域名（拒 IP 字面量）；不合格返回 undefined。 */
function cliproxyPinHostFromBaseURL(baseURL) {
  let parsed
  try { parsed = new URL(String(baseURL ?? '').trim()) } catch (_) { return undefined }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined
  if (parsed.port !== '' && parsed.port !== '443') return undefined
  return normalizeQuotaHostname(parsed.hostname)
}

/**
 * CLIProxyAPI 管理面 origin 守卫：baseURL 必须整体 HTTPS，且 hostname 与保存适配时
 * 钉入 allowedHosts[provider] 的记录**精确相等**——不做子串/子域猜测，管理密钥只发往
 * 用户钉过的那个域；settings 里改了 baseURL 就必须重新保存适配才恢复外呼。
 * 返回规范化 origin（scheme://host[:443]，无路径）或 undefined。
 */
function safeCliproxyOrigin(baseURL, pinnedHosts) {
  if (!Array.isArray(pinnedHosts) || pinnedHosts.length === 0) return undefined
  let parsed
  try { parsed = new URL(String(baseURL ?? '').trim()) } catch (_) { return undefined }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined
  if (parsed.port !== '' && parsed.port !== '443') return undefined
  const host = normalizeQuotaHostname(parsed.hostname)
  if (host === undefined || !pinnedHosts.includes(host)) return undefined
  return parsed.origin
}

/** fetcher 类 kind 的外呼前置守卫：返回稳定错误码或 null（放行）。在解凭据之前跑，省一次凭据查找。 */
function cliproxyFetchGuard(profile, config) {
  const base = String(profile?.baseURL ?? '').trim()
  if (base === '') return 'no-base-url'
  const pinned = Array.isArray(config?.allowedHosts?.[profile.name]) ? config.allowedHosts[profile.name] : []
  return safeCliproxyOrigin(base, pinned) === undefined ? 'host-not-pinned' : null
}

/**
 * 单个 provider 的 kind 解析（quota 与 quota-refresh 共用）。
 * 优先序：配置显式 kind > 配置 null（手动停用，永不外呼）> baseURL 自动推断 >
 * 运行时渠道别名（readRuntimeQuotaChannels 合成的行带 runtimeKind）；未命中返回空对象。
 */
function resolveQuotaKind(config, profile) {
  if (Object.prototype.hasOwnProperty.call(config.kinds, profile.name)) {
    const configured = config.kinds[profile.name]
    if (configured === null) return {}
    if (KIND_REGISTRY[configured] !== undefined) return { kind: configured, kindSource: 'config' }
    return {}
  }
  const inferred = inferQuotaKind(profile.baseURL)
    ?? (profile.runtimeKind !== undefined && KIND_REGISTRY[profile.runtimeKind] !== undefined ? profile.runtimeKind : undefined)
  if (inferred !== undefined && KIND_REGISTRY[inferred] !== undefined) return { kind: inferred, kindSource: 'auto' }
  return {}
}

/** 百分比归一：调用方（zai 等）的 percentage 与反推值都是 0-100 口径，只做截断取整；非法 → null。
 * 注意不做「≤1 视为小数比例」启发式——zai 原生 percentage:1 就是 1%，放大会得到 100%。 */
function normalizePercentValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(100, Math.round(n))
}

/** 重置时刻归一：ISO 字符串 / unix 秒 / unix 毫秒 → ISO 字符串；非法 → undefined。 */
function normalizeResetTimestamp(value) {
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return new Date(n > 1e12 ? n : n * 1000).toISOString()
}

/**
 * 凭据线索名清单（与发现链同一顺序）：settings 声明的 apiKeyEnv 在前、kind keyHints 殿后，去重。
 * 凭据填写窗口（quota-credential-set/unset）只接受这份清单里的名字——零输入拼接：浏览器传来的
 * 名字必须命中宿主派生的白名单，顺带保证 CredentialRef 文法（POSIX shell 标识符）合法。
 */
function quotaCredentialHintNames(kind, profile) {
  const names = []
  // 管理面 kind（cliproxy）的凭据独立于模型代理 key：settings 的 apiKeyEnv 指向代理 key，
  // 发去管理面等于拿错钥匙撞 fail2ban（CPA 错 5 次封 IP 30 分钟）——不尝试、不回退。
  if (KIND_REGISTRY[kind]?.managementPlane !== true && profile.apiKeyEnv !== '') names.push(profile.apiKeyEnv)
  for (const name of KIND_REGISTRY[kind]?.keyHints ?? []) {
    if (!names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Key 发现链：settings 声明的 apiKeyEnv → DSH 凭据库按 kind 线索名 → 环境变量（含旧名兼容）。
 * 全部落空返回 undefined（调用方转为 credential-missing）；settings 显式声明了 apiKeyEnv
 * 但凭据服务缺席且环境变量也兜不住时抛 credentials-unavailable——有明确意图却无处取 key，
 * 与「从未配置」的 credential-missing 区分。
 */
async function discoverQuotaCredential(ctx, kind, profile) {
  const attempted = quotaCredentialHintNames(kind, profile)
  const envHas = (name) => typeof process.env[name] === 'string' && process.env[name].trim() !== ''
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    for (const name of attempted) {
      try {
        const hit = await Promise.resolve(credentials.resolve(name))
        if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') return `Bearer ${hit.value}`
      } catch (_) {}
    }
  } else if (profile.apiKeyEnv !== '' && !attempted.some(envHas)) {
    throw new Error('credentials-unavailable')
  }
  for (const name of attempted) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim() !== '') return `Bearer ${value.trim()}`
  }
  return undefined
}

/**
 * zai-coding-cn（智谱 GLM Coding Plan）方言 → 统一窗口形状。
 * 端点返回 data.limits[]，每项一个额度窗口：
 * - TOKENS_LIMIT unit:3 number:5 = 5 小时滚动 Token 窗口——无调用时官方不返回 nextResetTime；
 * - TOKENS_LIMIT unit:6 number:1 = 每周 Token 额度；TIME_LIMIT = MCP 月度配额。
 * id 用 type+unit+number 组合保证稳定；unit/number 缺失时回退 type-index。
 * percentage 是一等公民；currentValue/usage 等绝对值字段可选且多数窗口不下发，不造数。
 */
// zai 窗口展示序：Token 窗（5 小时/本周）在前、点数窗次之、MCP 月度垫底。
// 上游固定把 TIME_LIMIT 放首个，而用户最关心编码 Token 窗（GUI 反馈点名 MCP 放第三排）。
const ZAI_WINDOW_TYPE_ORDER = { 'tokens-limit': 0, 'credit-limit': 1, 'time-limit': 2 }
function normalizeZaiCodingUsage(payload) {
  const windows = []
  const limits = payload?.data?.limits
  if (!Array.isArray(limits)) return { windows }
  for (const [index, limit] of limits.entries()) {
    if (limit === null || typeof limit !== 'object') continue
    // percentage 缺失时用 currentValue/usage 反推（CREDIT_LIMIT 新版套餐常见形态）。
    let percent = typeof limit.percentage === 'number' && Number.isFinite(limit.percentage)
      ? limit.percentage
      : (Number(limit.usage) > 0 && Number.isFinite(Number(limit.currentValue))
          ? (Number(limit.currentValue) / Number(limit.usage)) * 100
          : NaN)
    percent = normalizePercentValue(percent)
    if (percent === null) continue
    const type = typeof limit.type === 'string' && limit.type.length > 0 ? limit.type.toLowerCase().replace(/[^a-z0-9]+/g, '-') : `limit-${index}`
    const hasShape = Number.isFinite(limit.unit) && Number.isFinite(limit.number)
    const id = hasShape ? `${type}-u${limit.unit}-n${limit.number}` : `${type}-${index}`
    windows.push({
      id,
      percent,
      ...(normalizeResetTimestamp(limit.nextResetTime) !== undefined ? { resetsAt: normalizeResetTimestamp(limit.nextResetTime) } : {}),
    })
  }
  // stable sort：同类型内保持上游相对顺序（5 小时窗仍在本周窗前），未知类型排最后。
  const orderOf = (id) => ZAI_WINDOW_TYPE_ORDER[String(id).split('-').slice(0, 2).join('-')] ?? 3
  windows.sort((a, b) => orderOf(a.id) - orderOf(b.id))
  return { windows }
}

/** OpenRouter credits（{data:{total_credits,total_usage}}）→ 单百分比窗口。 */
function normalizeOpenRouterCredits(payload) {
  const d = payload?.data !== null && typeof payload?.data === 'object' ? payload.data : payload
  const total = Number(d?.total_credits ?? d?.credits)
  const used = Number(d?.total_usage ?? d?.usage)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return { windows: [] }
  const percent = Math.max(0, Math.min(100, Math.round((used / total) * 100)))
  return { windows: [{ id: 'credits', percent }] }
}

/** Kimi / Moonshot 余额（{available_balance:<分>}）→ 文本窗口（无总量不适合百分比）。 */
function normalizeKimiBalance(payload) {
  const raw = payload?.available_balance ?? payload?.balance ?? payload?.cash_balance ?? payload?.data?.available_balance
  const fen = Number(raw)
  if (!Number.isFinite(fen) || fen < 0) return { windows: [] }
  const yuan = fen >= 100 ? fen / 100 : fen
  return { windows: [{ id: 'balance', text: `¥${(Math.round(yuan * 100) / 100).toFixed(2)}` }] }
}

/** SiliconFlow 用户信息（{data:{balance}}）→ 文本窗口。 */
function normalizeSiliconFlowInfo(payload) {
  const d = payload?.data !== null && typeof payload?.data === 'object' ? payload.data : payload
  const raw = d?.balance ?? d?.amount ?? d?.remain ?? d?.remaining
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return { windows: [] }
  return { windows: [{ id: 'balance', text: `¥${(Math.round(n * 100) / 100).toFixed(2)}` }] }
}

/**
 * DeepSeek 官方余额（v0.25）：{is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}
 * → 文本窗口。每币种一行总额；赠金 > 0 时追加一行（官方口径：granted 是未过期赠金，total 含赠金+充值）。
 * currency 作为 label（纯数据，多币种区分），窗口名走客户端词典（双语教义：宿主不拼用户可见句子，
 * 货币符号 ¥/$ 属于数字格式化惯例，与 kimi 解析器同口径）。is_available 不改写金额——余额为 0 时
 * 数字本身已说明问题，不伪造状态文案。
 */
function normalizeDeepseekBalance(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  const windows = []
  const seenCurrencies = new Set()
  for (const info of infos) {
    if (info === null || typeof info !== 'object') continue
    const rawCurrency = typeof info.currency === 'string' ? info.currency.trim().toUpperCase() : ''
    // 文档枚举 CNY/USD；其他三~八字母码照收（上游扩展不炸），形状不对的条目丢弃。
    const currency = /^[A-Z]{3,8}$/.test(rawCurrency) ? rawCurrency : ''
    if (currency === '' || seenCurrencies.has(currency)) continue
    const total = normalizeDeepseekMoney(info.total_balance)
    if (total === null) continue
    seenCurrencies.add(currency)
    const idSuffix = currency.toLowerCase()
    windows.push({ id: `balance-${idSuffix}`, text: deepseekMoneyText(total, currency), label: currency, kindKey: 'balance' })
    const granted = normalizeDeepseekMoney(info.granted_balance)
    if (granted !== null && Number(granted) > 0) {
      windows.push({ id: `granted-${idSuffix}`, text: deepseekMoneyText(granted, currency), label: currency, kindKey: 'granted-balance' })
    }
  }
  return { windows }
}

/** DeepSeek 金额字段归一：字符串/数字均可（官方下发字符串），负数或非有限值拒绝；
 * 空白串也拒绝——Number('') 是 0，会把上游缺数据伪装成 ¥0.00。保留两位小数。 */
function normalizeDeepseekMoney(value) {
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return (Math.round(n * 100) / 100).toFixed(2)
}

function deepseekMoneyText(amount, currency) {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  return symbol === '' ? `${amount} ${currency}` : `${symbol}${amount}`
}

// ─── CLIProxyAPI（cliproxy）管理面编排 ──────────────────────────────────────
// 上游官方额度端点注册表（经 CPA api-call 代调，header 的 $TOKEN$ 由 CPA 替换为对应账号凭据）。
// 形状来源：muyouzhi6/astrbot_plugin_cliproxy_stats + CPA main 分支源码（2026-08 核实）；
// 全部折算成统一「已用 %」口径（remainingFraction 类字段做纯 clamp，不做 ≤1 启发式——教训见 KNOWLEDGE.md）。
const CLIPROXY_CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CLIPROXY_GEMINI_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const CLIPROXY_ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
]
const CLIPROXY_SUPPORTED_ACCOUNT_KINDS = new Set(['codex', 'gemini', 'gemini-cli', 'antigravity'])

/** Codex 窗口长度 → 展示桶位代码：按上游下发的实际秒数判，绝不按 primary/secondary 位置猜
 * （真实部署里主槽位完全可能就是周额度——2026-08-25 用户实测踩中）。 */
function codexWindowCode(key, window) {
  const seconds = Number(window.limit_window_seconds)
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds <= 6 * 3600) return 'codex-5h'
    if (seconds <= 24 * 3600) return 'codex-day'
    if (seconds <= 8 * 24 * 3600) return 'codex-week'
    return 'codex-month'
  }
  // 上游没带窗口长度时的位置兜底：primary 常见为短周期、secondary 为长周期。
  return key === 'primary_window' ? 'codex-primary' : 'codex-secondary'
}

/** Codex wham/usage 的 rate_limit → 窗口（used_percent 已用口径；reset_at 为 unix 秒）。
 * secondary_window 可为 null（真实上游行为）；窗口名由 limit_window_seconds 推导。 */
function normalizeCodexRateLimit(rateLimit) {
  const windows = []
  if (rateLimit === null || typeof rateLimit !== 'object') return windows
  for (const key of ['primary_window', 'secondary_window']) {
    const window = rateLimit[key]
    if (window === null || typeof window !== 'object') continue
    const percent = normalizePercentValue(window.used_percent)
    if (percent === null) continue
    const code = codexWindowCode(key, window)
    const resetsAt = normalizeResetTimestamp(window.reset_at)
    windows.push({ id: code, kindKey: code, percent, ...(resetsAt !== undefined ? { resetsAt } : {}) })
  }
  // 已用多的排前面（与 gemini/antigravity 解析器同一关注序）。
  return windows.sort((a, b) => b.percent - a.percent)
}

/** GeminiCLI retrieveUserQuota 的 buckets → 窗口（remainingFraction∈[0,1] 折算为已用 %）。 */
function normalizeGeminiBuckets(buckets) {
  const windows = []
  if (!Array.isArray(buckets)) return windows
  for (const bucket of buckets) {
    if (bucket === null || typeof bucket !== 'object') continue
    const modelId = typeof bucket.modelId === 'string' && bucket.modelId.trim() !== '' ? bucket.modelId.trim() : ''
    const remaining = Number(bucket.remainingFraction)
    if (modelId === '' || !Number.isFinite(remaining)) continue
    const fraction = Math.max(0, Math.min(1, remaining))
    const resetsAt = normalizeResetTimestamp(bucket.resetTime)
    windows.push({
      id: modelId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model',
      kindKey: modelId,
      percent: Math.round((1 - fraction) * 100),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    })
  }
  // 剩得最少的排前面（最值得关注）：已用 % 降序。
  return windows.sort((a, b) => b.percent - a.percent)
}

/** Antigravity fetchAvailableModels 的 models{} → 窗口（quotaInfo.remainingFraction 折算已用 %）。 */
function normalizeAntigravityModels(models) {
  const windows = []
  if (models === null || typeof models !== 'object') return windows
  for (const [modelId, entry] of Object.entries(models)) {
    if (entry === null || typeof entry !== 'object') continue
    const info = entry.quotaInfo !== null && typeof entry.quotaInfo === 'object' ? entry.quotaInfo
      : entry.quota_info !== null && typeof entry.quota_info === 'object' ? entry.quota_info : null
    if (info === null) continue
    const remaining = Number(info.remainingFraction ?? info.remaining_fraction)
    if (!Number.isFinite(remaining)) continue
    const fraction = Math.max(0, Math.min(1, remaining))
    const resetsAt = normalizeResetTimestamp(info.resetTime ?? info.reset_time)
    windows.push({
      id: String(modelId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model',
      kindKey: modelId,
      percent: Math.round((1 - fraction) * 100),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    })
  }
  // 剩得最少的排前面（最值得关注）：已用 % 降序。
  return windows.sort((a, b) => b.percent - a.percent)
}

/** api-call 信封解包：{status_code:int, body:string|object} → {statusCode, payload}。 */
function unwrapCliproxyApiCallEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object') return { statusCode: 0, payload: null }
  const rawStatus = Number(envelope.status_code)
  let payload = envelope.body
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload) } catch (_) { payload = null }
  }
  if (payload === null || typeof payload !== 'object') payload = null
  return { statusCode: Number.isFinite(rawStatus) ? rawStatus : 0, payload }
}

/** GeminiCLI project 提取：优先 auth-files 条目的 project_id 字段，回落文件名 gemini-{email}-{project}.json。 */
function cliproxyProjectFor(entry) {
  const direct = typeof entry?.project_id === 'string' ? entry.project_id.trim() : ''
  if (direct !== '') return direct
  const name = typeof entry?.name === 'string' ? entry.name.trim().replace(/\.json$/i, '') : ''
  if (/^gemini-[^@]+@/.test(name)) {
    const afterAt = name.slice(name.lastIndexOf('@') + 1)
    const dash = afterAt.indexOf('-')
    if (dash > 0 && dash + 1 < afterAt.length) return afterAt.slice(dash + 1)
  }
  return ''
}

/** auth-files 条目 → api-call 计划；不支持的类型或缺关键参数（如 project 推不出）返回 null 跳过。 */
function buildCliproxyAccountPlan(entry) {
  const provider = String(entry?.provider ?? entry?.type ?? '').toLowerCase()
  if (!CLIPROXY_SUPPORTED_ACCOUNT_KINDS.has(provider)) return null
  const baseHeaders = { Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json' }
  if (provider === 'codex') {
    return { provider, calls: [{ method: 'GET', url: CLIPROXY_CODEX_USAGE_URL, header: baseHeaders, data: '' }] }
  }
  if (provider === 'antigravity') {
    // 候选 URL 顺试到首个成功；每次尝试都计入 api-call 预算。
    return {
      provider,
      calls: CLIPROXY_ANTIGRAVITY_QUOTA_URLS.map((url) => ({
        method: 'POST',
        url,
        header: { ...baseHeaders, 'User-Agent': 'antigravity/1.11.5 windows/amd64' },
        data: '{}',
      })),
    }
  }
  const project = cliproxyProjectFor(entry)
  if (project === '') return null
  return {
    provider,
    calls: [{ method: 'POST', url: CLIPROXY_GEMINI_QUOTA_URL, header: baseHeaders, data: JSON.stringify({ project }) }],
  }
}

/** 按账号类型分发上游 payload 解析。 */
function parseCliproxyUpstream(provider, payload) {
  if (provider === 'codex') return normalizeCodexRateLimit(payload?.rate_limit)
  if (provider === 'antigravity') {
    const models = payload?.models
    return models !== null && typeof models === 'object' ? normalizeAntigravityModels(models) : []
  }
  return normalizeGeminiBuckets(payload?.buckets)
}

/**
 * CLIProxyAPI 编排：auth-files 列账号 → 小并发池逐账号 api-call 代调上游官方额度 → 合并窗口。
 * 预算：账号 ≤8、api-call 总次数 ≤12、并发 3、窗口总数 ≤32；部分账号失败不拖垮整行
 * （有成功窗口即返回），全部失败抛首个稳定错误码。守卫与凭据由 kickQuotaRefresh 先行完成。
 */
async function fetchCliproxyUsage({ profile, config, authorization, signal }) {
  const pinned = Array.isArray(config?.allowedHosts?.[profile.name]) ? config.allowedHosts[profile.name] : []
  const origin = safeCliproxyOrigin(profile.baseURL, pinned)
  if (origin === undefined) throw new Error('host-not-pinned')
  let filesPayload
  try {
    filesPayload = await requestQuotaJson(`${origin}/v0/management/auth-files`, { authorization, signal })
  } catch (error) {
    // 管理路由未注册（secret-key 为空）时 CPA 整体 404——单独成码，别让用户猜。
    // 注意用完整 message 比较：quotaErrorCode 会把 http-status:404 截成 http-status。
    if (error?.message === 'http-status:404') throw new Error('mgmt-disabled')
    throw error
  }
  const files = Array.isArray(filesPayload?.files) ? filesPayload.files : []
  const accounts = []
  for (const entry of files) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.disabled === true || entry.unavailable === true) continue
    if (typeof entry.auth_index !== 'string' || entry.auth_index.trim() === '') continue
    const plan = buildCliproxyAccountPlan(entry)
    if (plan === null) continue
    const label = typeof entry.email === 'string' && entry.email.trim() !== '' ? entry.email.trim()
      : typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name.trim() : ''
    const slugSource = `${label !== '' ? label : plan.provider}-${accounts.length}`
    const slug = slugSource.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `acct-${accounts.length}`
    accounts.push({ authIndex: entry.auth_index, provider: plan.provider, label, slug, calls: plan.calls })
    if (accounts.length >= MAX_QUOTA_CPA_ACCOUNTS) break
  }
  if (accounts.length === 0) return []

  const windows = []
  const failures = []
  const seenWindowIds = new Set()
  let callBudget = MAX_QUOTA_CPA_CALLS
  const runAccount = async (account) => {
    for (const call of account.calls) {
      if (callBudget <= 0 || signal?.aborted === true) return
      callBudget -= 1
      let envelope
      try {
        envelope = await requestQuotaJson(`${origin}/v0/management/api-call`, {
          method: 'POST',
          authorization,
          signal,
          body: JSON.stringify({ auth_index: account.authIndex, method: call.method, url: call.url, header: call.header, data: call.data }),
        })
      } catch (error) {
        failures.push(quotaErrorCode(error))
        return
      }
      const { statusCode, payload } = unwrapCliproxyApiCallEnvelope(envelope)
      const parsed = statusCode === 200 && payload !== null ? parseCliproxyUpstream(account.provider, payload) : []
      if (parsed.length > 0) {
        for (const window of parsed) {
          if (windows.length >= MAX_QUOTA_CPA_WINDOWS) return
          // 窗口 id 必须全局唯一：同账号两窗撞码（如 codex primary/secondary 恰好同秒长度折算同桶）
          // 或不同模型名 slug 化撞名，都会复制出重复的 React key/testid——后缀 ~ 保持唯一；
          // kindKey 不动，展示名仍按窗口码本地化。
          let windowId = `${account.slug}-${window.id}`
          while (seenWindowIds.has(windowId)) windowId += '~'
          seenWindowIds.add(windowId)
          windows.push({
            id: windowId,
            kindKey: window.kindKey ?? window.id,
            ...(account.label !== '' ? { label: account.label } : {}),
            percent: window.percent,
            ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
          })
        }
        return
      }
      failures.push(statusCode === 200 ? 'bad-payload:shape' : `upstream-status:${statusCode}`)
      // antigravity 候选链：当前候选失败换下一个；其余单调用类型直接结束该账号。
      if (account.provider !== 'antigravity') return
    }
  }
  const queue = [...accounts]
  await Promise.all(Array.from({ length: Math.min(QUOTA_CPA_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0 && signal?.aborted !== true && windows.length < MAX_QUOTA_CPA_WINDOWS) {
      await runAccount(queue.shift())
    }
  }))
  if (signal?.aborted === true) throw new Error('cancelled')
  if (windows.length === 0 && failures.length > 0) throw new Error(failures[0])
  return windows
}

/** 稳定错误码提取：fetchProviderUsage 抛错时 message 即错误码（可带 :detail）。 */
function quotaErrorCode(error) {
  const raw = typeof error?.message === 'string' && error.message.length > 0 ? error.message : String(error ?? '')
  const colon = raw.indexOf(':')
  return colon === -1 ? raw : raw.slice(0, colon)
}

function sanitizeQuotaErrorDetail(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_QUOTA_ERROR_DETAIL)
}

// 瞬时网络错误码白名单（Cloudflare/CDN 间歇断连等）：值得自动重试。
const QUOTA_TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_READ_ERROR',
])

/** 单次上游 GET：15s 超时、64KB 上限、Bearer 可选；支持 Fiber 销毁时 abort。 */
function fetchProviderUsageOnce(endpoint, authorization, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (code, transient = false) => {
      if (settled) return
      settled = true
      const error = new Error(code)
      error.quotaTransient = transient
      reject(error)
    }
    if (options.signal?.aborted === true) { fail('cancelled'); return }
    const request = https.get(endpoint, {
      timeout: QUOTA_UPSTREAM_TIMEOUT_MS,
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        'user-agent': `dsh-service/${pluginVersion} (DeepSeek Harness plugin)`,
        ...(authorization === '' ? {} : { Authorization: authorization }),
      },
    }, (response) => {
      const status = response.statusCode || 0
      if (status < 200 || status >= 300) {
        response.resume()
        fail(`http-status:${status}`)
        return
      }
      let body = ''
      let bytes = 0
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_QUOTA_RESPONSE_BYTES) {
          fail('bad-payload:oversize')
          request.destroy()
          return
        }
        body += chunk
      })
      response.on('error', () => fail('network'))
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (_) {
          fail('bad-payload:json')
        }
      })
    })
    request.on('error', (error) => {
      const code = error?.cause?.code ?? error?.code
      if (options.signal?.aborted === true || code === 'ABORT_ERR') { fail('cancelled'); return }
      fail(typeof code === 'string' && QUOTA_TRANSIENT_CODES.has(code) ? 'network-transient' : 'network',
        typeof code === 'string' && QUOTA_TRANSIENT_CODES.has(code))
    })
    request.on('timeout', () => {
      request.destroy()
      fail('timeout', true)
    })
  })
}

function abortableDelay(delay, signal) {
  if (signal?.aborted === true) return Promise.reject(new Error('cancelled'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delay)
    function done() {
      signal?.removeEventListener?.('abort', aborted)
      resolve()
    }
    function aborted() {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', aborted)
      reject(new Error('cancelled'))
    }
    signal?.addEventListener?.('abort', aborted, { once: true })
  })
}

/** 瞬时错误退避重试骨架：共 3 次尝试、300/600ms 退避，仅 quotaTransient 错误续命；支持整体取消。 */
async function retryQuotaTransient(attempt, signal) {
  let lastError
  for (let attemptNo = 1; attemptNo <= 3; attemptNo++) {
    if (attemptNo > 1) await abortableDelay(300 * (attemptNo - 1), signal)
    try {
      return await attempt()
    } catch (error) {
      lastError = error
      if (error?.quotaTransient !== true) break
    }
  }
  throw lastError
}

/** 带重试的上游 GET：仅瞬时网络错误退避重试（共 3 次尝试，300/600ms），支持整体取消。 */
async function fetchProviderUsage(endpoint, authorization, options = {}) {
  return retryQuotaTransient(() => fetchProviderUsageOnce(endpoint, authorization, options), options.signal)
}

/**
 * 单次 JSON 请求（GET/POST，POST 带 JSON body）：CLIProxyAPI 管理面专用（GET auth-files +
 * POST api-call）。与 GET 版同样的 15s 超时、64KB 上限、瞬时错误白名单；body 只接受已序列化字符串。
 */
function requestQuotaJsonOnce(endpoint, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (code, transient = false) => {
      if (settled) return
      settled = true
      const error = new Error(code)
      error.quotaTransient = transient
      reject(error)
    }
    if (options.signal?.aborted === true) { fail('cancelled'); return }
    const body = typeof options.body === 'string' ? options.body : ''
    const request = https.request(endpoint, {
      method: options.method === 'POST' ? 'POST' : 'GET',
      timeout: QUOTA_UPSTREAM_TIMEOUT_MS,
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        'user-agent': `dsh-service/${pluginVersion} (DeepSeek Harness plugin)`,
        ...(body === '' ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
        ...(options.authorization === undefined || options.authorization === '' ? {} : { Authorization: options.authorization }),
      },
    }, (response) => {
      const status = response.statusCode || 0
      if (status < 200 || status >= 300) {
        response.resume()
        fail(`http-status:${status}`)
        return
      }
      let payload = ''
      let bytes = 0
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_QUOTA_RESPONSE_BYTES) {
          fail('bad-payload:oversize')
          request.destroy()
          return
        }
        payload += chunk
      })
      response.on('error', () => fail('network'))
      response.on('end', () => {
        try {
          resolve(JSON.parse(payload))
        } catch (_) {
          fail('bad-payload:json')
        }
      })
    })
    request.on('error', (error) => {
      const code = error?.cause?.code ?? error?.code
      if (options.signal?.aborted === true || code === 'ABORT_ERR') { fail('cancelled'); return }
      fail(typeof code === 'string' && QUOTA_TRANSIENT_CODES.has(code) ? 'network-transient' : 'network',
        typeof code === 'string' && QUOTA_TRANSIENT_CODES.has(code))
    })
    request.on('timeout', () => {
      request.destroy()
      fail('timeout', true)
    })
    if (body !== '') request.write(body)
    request.end()
  })
}

/** 带重试的 JSON 请求：与 GET 版同一套瞬时错误白名单退避。 */
async function requestQuotaJson(endpoint, options = {}) {
  return retryQuotaTransient(() => requestQuotaJsonOnce(endpoint, options), options.signal)
}

/**
 * 每 provider 节流状态机（内存态，重启清零）。一切来源共用同一判定，优先序：
 * 单飞去重 > 失败指数退避（30s ×2 封顶 15min）> 成功 TTL 60s > 最小上游间隔 15s——
 * 与 attempt() 的实际判定序一致（inflight > backoff > fresh > interval）。
 * now 由调用方注入，测试可推进假时钟。
 */
function createQuotaThrottle(options = {}) {
  const successTtlMs = options.successTtlMs ?? QUOTA_SUCCESS_TTL_MS
  const minIntervalMs = options.minIntervalMs ?? QUOTA_MIN_INTERVAL_MS
  const manualCooldownMs = options.manualCooldownMs ?? QUOTA_MANUAL_COOLDOWN_MS
  const backoffBaseMs = options.backoffBaseMs ?? QUOTA_BACKOFF_BASE_MS
  const backoffMaxMs = options.backoffMaxMs ?? QUOTA_BACKOFF_MAX_MS
  const entries = new Map()
  const entryOf = (provider) => {
    let entry = entries.get(provider)
    if (entry === undefined) {
      entry = { lastSuccessAt: 0, lastUpstreamAt: 0, lastManualAt: 0, backoffUntil: 0, failures: 0, inflight: false, windows: undefined, fetchedAt: 0, lastError: undefined, lastErrorDetail: undefined }
      entries.set(provider, entry)
    }
    return entry
  }
  return {
    /** 只读快照：缓存窗口、是否刷新中、下次允许发起上游的时间（null=进行中未知）。 */
    view(provider, now = Date.now()) {
      const entry = entryOf(provider)
      return {
        refreshing: entry.inflight,
        windows: entry.windows,
        fetchedAt: entry.fetchedAt > 0 ? entry.fetchedAt : undefined,
        lastError: entry.lastError,
        lastErrorDetail: entry.lastErrorDetail,
        nextAllowedAt: entry.inflight
          ? null
          : Math.max(entry.backoffUntil, entry.lastUpstreamAt + minIntervalMs, entry.lastSuccessAt + successTtlMs),
      }
    },
    /** 申请一次上游调用。允许则置单飞并返回 ok；拒绝时给出稳定原因与 nextAllowedAt（优先序：单飞 > 退避 > 成功 TTL > 最小间隔）。 */
    attempt(provider, now = Date.now()) {
      const entry = entryOf(provider)
      if (entry.inflight) return { ok: false, reason: 'inflight', nextAllowedAt: null }
      if (now < entry.backoffUntil) return { ok: false, reason: 'backoff', nextAllowedAt: entry.backoffUntil }
      if (now - entry.lastSuccessAt < successTtlMs) {
        return { ok: false, reason: 'fresh', nextAllowedAt: entry.lastSuccessAt + successTtlMs }
      }
      if (entry.lastUpstreamAt > 0 && now - entry.lastUpstreamAt < minIntervalMs) {
        return { ok: false, reason: 'interval', nextAllowedAt: entry.lastUpstreamAt + minIntervalMs }
      }
      entry.inflight = true
      entry.lastUpstreamAt = now
      return { ok: true }
    },
    /** 上游落定：成功清退避并缓存窗口；失败按失败次数指数退避（封顶 15min）。 */
    settle(provider, outcome, now = Date.now()) {
      const entry = entryOf(provider)
      entry.inflight = false
      if (outcome.ok === true) {
        entry.lastSuccessAt = now
        entry.failures = 0
        entry.backoffUntil = 0
        entry.windows = outcome.windows ?? []
        entry.fetchedAt = now
        entry.lastError = undefined
        entry.lastErrorDetail = undefined
        return
      }
      entry.failures += 1
      const delay = Math.min(backoffBaseMs * 2 ** (entry.failures - 1), backoffMaxMs)
      entry.backoffUntil = now + delay
      entry.lastError = typeof outcome.code === 'string' ? outcome.code : 'unknown'
      entry.lastErrorDetail = typeof outcome.detail === 'string' && outcome.detail !== '' ? outcome.detail : undefined
    },
    /** 手动刷新：允许绕过成功 TTL，但保留失败退避，并有不可绕过的硬冷却；单飞仍优先。 */
    force(provider, now = Date.now()) {
      const entry = entryOf(provider)
      if (entry.inflight) return { ok: false, reason: 'inflight', nextAllowedAt: null }
      if (now < entry.backoffUntil) return { ok: false, reason: 'backoff', nextAllowedAt: entry.backoffUntil }
      if (entry.lastManualAt > 0 && now - entry.lastManualAt < manualCooldownMs) {
        return { ok: false, reason: 'cooldown', nextAllowedAt: entry.lastManualAt + manualCooldownMs }
      }
      entry.lastManualAt = now
      entry.lastSuccessAt = 0
      entry.lastUpstreamAt = 0
      return { ok: true }
    },
    prune(activeProviders) {
      const active = activeProviders instanceof Set ? activeProviders : new Set(activeProviders ?? [])
      for (const [provider, entry] of entries) {
        if (!active.has(provider) && entry.inflight !== true) entries.delete(provider)
      }
    },
  }
}

function usageFailure(event) {
  if (event.type === 'llm/retry') return event.data?.failure
  if (event.type === 'turn/end' && event.data?.reason?.kind === 'error') return event.data.reason.error
  return undefined
}

function recentErrorTime(time) {
  return Number.isFinite(time) && time >= Date.now() - 24 * 60 * 60 * 1000
}

function addUsageError(session, event, model) {
  const failure = usageFailure(event)
  if (failure === undefined) return false
  if (!recentErrorTime(event.time)) return true
  if (session.modelErrors === undefined) session.modelErrors = {}
  const provider = event.type === 'llm/retry' && typeof event.data?.provider === 'string' ? event.data.provider : model.provider
  const errorModel = provider === model.provider ? model.model : 'unknown'
  const code = typeof failure.code === 'string' && failure.code.length > 0 ? failure.code : 'UNKNOWN'
  const status = Number.isSafeInteger(failure.status) ? failure.status : null
  const key = `${provider}/${errorModel}|${code}|${status === null ? '-' : status}`
  const current = session.modelErrors[key] || { key, provider, model: errorModel, code, status, message: String(failure.message || code), recentTimes: [] }
  current.recentTimes.push(event.time)
  session.modelErrors[key] = current
  return true
}

function toolResultBlock(event) {
  if (event.type !== 'tool/result') return undefined
  const content = event.data?.message?.content
  return Array.isArray(content) ? content.find((block) => block?.type === 'tool-result') : undefined
}

function toolFailureCode(tool, code, message) {
  const value = String(code || '').trim()
  if (/ABORT|CANCEL/i.test(value) || /aborted|cancelled|canceled/i.test(message)) return undefined
  if (value && value !== 'UNKNOWN' && value !== 'Error') return value
  if (/requires reading\b/i.test(message)) return 'FS_NOT_OBSERVED'
  if (/cannot read[^\n]*as an image/i.test(message)) return 'IMAGE_NOT_SUPPORTED'
  if (/old_string was not found/i.test(message)) return 'OLD_STRING_NOT_FOUND'
  if (/no such file or directory|path[^\n]*not found/i.test(message)) return 'PATH_NOT_FOUND'
  if (/file access denied|permission denied|EACCES/i.test(message)) return 'PERMISSION_DENIED'
  if (/timed out|timeout/i.test(message)) return 'TOOL_TIMEOUT'
  const exit = message.match(/\[exit code:\s*(-?\d+)\]/i)
  if (tool === 'bash' && exit) return `EXIT_${exit[1]}`
  return 'TOOL_ERROR'
}

function toolFailureMessage(tool, code) {
  if (code === 'FS_NOT_OBSERVED') return `${tool} requires reading <path> first — read the file, then retry`
  if (code === 'IMAGE_NOT_SUPPORTED') return `${tool} failed: the current model does not support image input; switch to an image-capable model`
  if (code === 'OLD_STRING_NOT_FOUND') return `${tool}: old_string was not found in <path>`
  if (code === 'PATH_NOT_FOUND') return `${tool} search failed: <path> not found`
  if (code === 'PERMISSION_DENIED') return `${tool} failed: permission denied for <path>`
  if (code === 'TOOL_TIMEOUT') return `${tool} timed out`
  if (code.startsWith('EXIT_')) return `${tool} command exited with code ${code.slice(5)}`
  return `${tool} failed (${code})`
}

function addToolError(session, event) {
  let tool
  let code
  let message
  if (event.type === 'tool/call') {
    if (session.toolCalls === undefined) session.toolCalls = {}
    session.toolCalls[String(event.data?.callId)] = String(event.data?.name || 'unknown')
    return true
  }
  if (event.type === 'tool/result') {
    if (event.surfaceOp !== 'append') return true
    const block = toolResultBlock(event)
    const callId = String(block?.toolCallId || '')
    tool = session.toolCalls?.[callId] || 'unknown'
    if (session.toolCalls !== undefined) delete session.toolCalls[callId]
    const textBlock = Array.isArray(block?.content) ? block.content.find((item) => item?.type === 'text') : undefined
    message = String(textBlock?.text || '')
    const exitFailure = tool === 'bash' && /\[exit code:\s*-?\d+\]/i.test(message)
    if (block?.isError !== true && !exitFailure) return true
    code = toolFailureCode(tool, event.data?.error?.code, message)
  } else if (event.type === 'tool/code-dispatch') {
    tool = String(event.data?.name || 'unknown')
    const textBlock = Array.isArray(event.data?.content) ? event.data.content.find((item) => item?.type === 'text') : undefined
    message = String(textBlock?.text || '')
    const exitFailure = tool === 'bash' && /\[exit code:\s*-?\d+\]/i.test(message)
    if (event.data?.isError !== true && !exitFailure) return true
    code = toolFailureCode(tool, undefined, message)
  } else {
    return false
  }
  if (code === undefined || !recentErrorTime(event.time)) return true
  if (session.toolErrors === undefined) session.toolErrors = {}
  const key = `${tool}|${code}`
  const current = session.toolErrors[key] || { key, tool, code, message: toolFailureMessage(tool, code), recentTimes: [] }
  current.recentTimes.push(event.time)
  session.toolErrors[key] = current
  return true
}

function pruneSessionErrors(session, cutoff) {
  for (const field of ['modelErrors', 'toolErrors']) {
    for (const [key, error] of Object.entries(session[field] || {})) {
      error.recentTimes = (error.recentTimes || []).filter((time) => time >= cutoff)
      if (error.recentTimes.length === 0) delete session[field][key]
    }
  }
}

function foldUsageEvents(ctx, record, previous, events) {
  const project = projectForCwd(ctx, record.header.cwd)
  const session = previous || { revision: '', lastSeq: Math.max(0, record.header.seedLength || 0) - 1, project, currentModel: null, hours: {} }
  session.project = project
  for (const event of events) {
    if (event.seq < (record.header.seedLength || 0)) continue
    session.lastSeq = Math.max(session.lastSeq, event.seq)
    if (event.type === 'request/header') {
      const provider = event.data?.header?.config?.provider
      const model = event.data?.header?.config?.model
      if (typeof provider === 'string' && typeof model === 'string') session.currentModel = { provider, model, id: `${provider}/${model}` }
      continue
    }
    const model = session.currentModel || { provider: 'unknown', model: 'unknown', id: 'unknown/unknown' }
    if (addToolError(session, event)) continue
    if (addUsageError(session, event, model)) continue
    if (event.type !== 'assistant/message') continue
    // 提供方未上报 token 用量的步骤直接忽略：不计步骤、不建模型桶、不提示。
    if (event.data?.usage === undefined) continue
    const hour = usageHour(event.time)
    const bucket = session.hours[hour] || (session.hours[hour] = { totals: emptyUsageTotals(), models: {} })
    const modelBucket = bucket.models[model.id] || (bucket.models[model.id] = { id: model.id, provider: model.provider, model: model.model, totals: emptyUsageTotals() })
    const usage = event.data.usage
    const delta = emptyUsageTotals()
    delta.steps = 1
    delta.inputTokens = Number(usage.inputTokens) || 0
    delta.outputTokens = Number(usage.outputTokens) || 0
    delta.cacheReadTokens = Number(usage.cacheReadTokens) || 0
    delta.cacheWriteTokens = Number(usage.cacheWriteTokens) || 0
    addUsageTotals(bucket.totals, delta)
    addUsageTotals(modelBucket.totals, delta)
  }
  return session
}

function publicUsage(index, timezoneOffsetMinutes = 0) {
  const result = { updatedAt: index.updatedAt, indexedSessions: Object.keys(index.sessions).length, totals: emptyUsageTotals(), days: {}, errors: { models: [], tools: [] } }
  const projects = new Map()
  const modelErrors = new Map()
  const toolErrors = new Map()
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const session of Object.values(index.sessions)) {
    projects.set(session.project.id, session.project)
    pruneSessionErrors(session, recentCutoff)
    for (const error of Object.values(session.modelErrors || {})) {
      const count = error.recentTimes.length
      const key = `${session.project.id}|${error.key}`
      const aggregate = modelErrors.get(key) || { key: error.key, provider: error.provider, model: error.model, code: error.code, status: error.status, message: error.message, count: 0, projectId: session.project.id, projectTitle: session.project.title }
      aggregate.count += count
      modelErrors.set(key, aggregate)
    }
    for (const error of Object.values(session.toolErrors || {})) {
      const count = error.recentTimes.length
      const key = `${session.project.id}|${error.key}`
      const aggregate = toolErrors.get(key) || { key: error.key, tool: error.tool, code: error.code, message: error.message, count: 0, projectId: session.project.id, projectTitle: session.project.title }
      aggregate.count += count
      toolErrors.set(key, aggregate)
    }
    for (const [hour, source] of Object.entries(session.hours || {})) {
      const day = localDayForHour(hour, timezoneOffsetMinutes)
      const dayBucket = result.days[day] || (result.days[day] = { totals: emptyUsageTotals(), projects: new Map() })
      addUsageTotals(dayBucket.totals, source.totals)
      addUsageTotals(result.totals, source.totals)
      const projectBucket = dayBucket.projects.get(session.project.id) || { ...session.project, totals: emptyUsageTotals(), models: new Map() }
      addUsageTotals(projectBucket.totals, source.totals)
      for (const model of Object.values(source.models)) {
        const modelBucket = projectBucket.models.get(model.id) || { id: model.id, provider: model.provider, model: model.model, totals: emptyUsageTotals() }
        addUsageTotals(modelBucket.totals, model.totals)
        projectBucket.models.set(model.id, modelBucket)
      }
      dayBucket.projects.set(session.project.id, projectBucket)
    }
  }
  const errorSort = (a, b) => b.count - a.count || a.key.localeCompare(b.key) || a.projectId.localeCompare(b.projectId)
  result.errors.models = [...modelErrors.values()].sort(errorSort)
  result.errors.tools = [...toolErrors.values()].sort(errorSort)
  const finishTotals = (totals) => ({ ...totals, cacheHitRate: cacheHitRate(totals) })
  result.totals = finishTotals(result.totals)
  result.projects = [...projects.values()].sort((a, b) => a.title.localeCompare(b.title))
  for (const bucket of Object.values(result.days)) {
    bucket.totals = finishTotals(bucket.totals)
    bucket.projects = [...bucket.projects.values()].map((project) => ({
      ...project,
      totals: finishTotals(project.totals),
      models: [...project.models.values()].map((model) => ({ ...model, totals: finishTotals(model.totals) })).sort((a, b) => a.id.localeCompare(b.id)),
    })).sort((a, b) => a.title.localeCompare(b.title))
  }
  return result
}

async function refreshUsageIndex(ctx, dshHome, index) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) throw new Error('session-persistence-unavailable')
  const snapshots = await persistence.listSnapshots()
  const liveIds = new Set(snapshots.map((record) => String(record.header.id)))
  for (const id of Object.keys(index.sessions)) if (!liveIds.has(id)) delete index.sessions[id]
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const session of Object.values(index.sessions)) pruneSessionErrors(session, recentCutoff)
  for (const record of snapshots) {
    const id = String(record.header.id)
    const revision = revisionKey(record.revision)
    const previous = index.sessions[id]
    if (previous?.revision === revision) continue
    const fromSeq = previous === undefined ? Math.max(0, record.header.seedLength || 0) : previous.lastSeq + 1
    const read = await persistence.readFrom(record.header.id, fromSeq)
    const next = foldUsageEvents(ctx, record, previous, read.events)
    next.revision = revision
    index.sessions[id] = next
  }
  index.updatedAt = Date.now()
  await saveUsageIndex(dshHome, index)
  return index
}

function modeString(mode) {
  return '0' + (mode & 0o777).toString(8).padStart(3, '0')
}

async function runFixedCommand(ctx, argv) {
  const result = await runCommandResult(ctx, argv)
  if (result.exitCode !== 0 || result.signal !== null) {
    throw new Error(`${argv[0]}-failed: ${(result.stderr || '').trim() || result.signal || result.exitCode}`)
  }
}

// 非抛出的命令执行：返回退出码/信号/stdout/stderr，供升级流程做失败分类与一次性恢复。
async function runCommandResult(ctx, argv) {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('subprocess-unavailable')
  const executable = await subprocess.resolveExecutable(argv[0])
  let spawnArgv = [executable, ...argv.slice(1)]
  // Windows 上白名单命令（如 npm/dsh）经 PATHEXT 解析为 .cmd/.bat 脚本；subprocess 服务的
  // spawn 不带 shell，Node 对 .cmd/.bat 一律抛 EINVAL，无法直接执行。固定包一层
  // cmd.exe /d /s /c + 已解析的绝对路径，全部参数仍是宿主白名单常量，无输入拼接。
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const shell = await subprocess.resolveExecutable('cmd.exe')
    spawnArgv = [shell, '/d', '/s', '/c', executable, ...argv.slice(1)]
  }
  const handle = subprocess.spawn({
    argv: spawnArgv,
    // '/' 不是合法的 Windows 目录路径；固定改用系统目录，POSIX 保持根目录。
    cwd: process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\Windows') : '/',
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 64 * 1024 },
      stderr: { maxBytes: 512 * 1024 },
    },
    graceMs: 5000,
  })
  const outcome = await handle.done
  const stderr = handle.collected.stderr?.readFrom(0).text || ''
  const stdout = handle.collected.stdout?.readFrom(0).text || ''
  return { exitCode: outcome.exitCode ?? 1, signal: outcome.signal, stdout, stderr }
}

// 定位「安装了本插件的 profile」。只读扫描 DSH_HOME/profiles/*/package.json，浏览器不传
// 任何路径/名字；多候选时优先匹配当前正在运行的插件源码目录（realpath），避免同秒竞态。
async function resolveUpgradeProfile(dshHome) {
  const profilesDir = join(dshHome, 'profiles')
  let entries
  try {
    entries = await readdir(profilesDir, { withFileTypes: true })
  } catch (_) {
    throw new Error('no-profile-found')
  }
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const dir = join(profilesDir, entry.name)
    let manifest
    try {
      manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    } catch (_) {
      continue
    }
    const spec = manifest?.dependencies?.[PLUGIN_PACKAGE]
    if (typeof spec !== 'string') continue
    candidates.push({ name: entry.name, dir, spec })
  }
  if (candidates.length === 0) throw new Error('no-profile-found')
  let loadedReal = null
  try { loadedReal = await realpath(loadedPluginDir) } catch (_) {}
  const matches = []
  if (loadedReal !== null) {
    for (const candidate of candidates) {
      let installedReal = null
      try { installedReal = await realpath(join(candidate.dir, 'node_modules', PLUGIN_PACKAGE)) } catch (_) {}
      if (installedReal === loadedReal) matches.push(candidate)
    }
  }
  const selected = matches.length === 1 ? matches[0] : (candidates.length === 1 ? candidates[0] : null)
  if (selected === null) throw new Error('ambiguous-profile')
  let workspace = false
  try { workspace = (await stat(join(selected.dir, 'pnpm-workspace.yaml'))).isFile() } catch (_) {}
  return { name: selected.name, dir: selected.dir, spec: selected.spec, workspace }
}

async function readInstalledPluginVersion(profile) {
  try {
    const manifest = JSON.parse(await readFile(join(profile.dir, 'node_modules', PLUGIN_PACKAGE, 'package.json'), 'utf8'))
    const version = typeof manifest?.version === 'string' ? manifest.version : ''
    return version === '' ? null : version
  } catch (_) {
    return null
  }
}

// pnpm 失败分类：dsh plugin 转发 pnpm 时只报「pnpm failed in profile directory」，不报原因；
// 必须按输出特征识别真实失败（踩坑见 KNOWLEDGE.md「pnpm 失败模式识别与自动恢复」）。
function classifyUpgradeFailure(output) {
  const text = String(output || '')
  if (text.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
    return { code: 'hoist-pattern-diff', recoverable: true, message: 'hoist-pattern-diff' }
  }
  if (text.includes('ERR_PNPM_ADDING_TO_ROOT')) {
    return { code: 'adding-to-root', recoverable: false, message: 'adding-to-root' }
  }
  if (/--workspace-root may only be used inside a workspace/i.test(text)) {
    return { code: 'not-a-workspace', recoverable: false, message: 'not-a-workspace' }
  }
  if (text.includes('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION') || text.includes('ERR_PNPM_NO_MATURE_MATCHING_VERSION')) {
    return { code: 'release-age-violation', recoverable: true, message: 'release-age-violation' }
  }
  if (text.includes('ERR_PNPM_IGNORED_BUILDS')) {
    return { code: 'ignored-builds', recoverable: false, message: 'ignored-builds' }
  }
  if (/ERR_PNPM_FETCH_5\d\d|ERR_PNPM_META_FETCH_FAIL|FetchError|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|network timeout/i.test(text)) {
    return { code: 'transient-network', recoverable: true, message: 'transient-network' }
  }
  if (/operation was aborted due to timeout|TimeoutError|error \(23\)/i.test(text)) {
    return { code: 'fetch-timeout', recoverable: true, message: 'fetch-timeout' }
  }
  if (text.includes('pnpm not found on PATH')) {
    return { code: 'pnpm-missing', recoverable: false, message: 'pnpm-missing' }
  }
  return null
}

// 一键升级：走「dsh plugin --profile <p> add <pkg>@<版本>」，落在 DSH 真正读取的 profile
// node_modules，替代旧的无升级语义的 npm install -g。命令、包名、版本全部宿主白名单常量。
// 安全教义守卫：活动工作拒用、link/file 拒绝、latest 不高于当前版本拒绝（防降级）一律先于网络。
// runtimeEnv 来自 apply() 的 detectRuntimeEnv()：疑似终端手动启动时安装成功不调度 exit(42)。
async function upgradePlugin(ctx, dshHome, runtimeEnv) {
  const activity = collectActiveWork(ctx)
  if (activity.hasActive) throw new Error('active-work')

  const profile = await resolveUpgradeProfile(dshHome)
  if (profile.spec.startsWith('link:')) throw new Error('link-install')
  if (profile.spec.startsWith('file:')) throw new Error('file-install')

  const published = await fetchPublishedVersions(PLUGIN_PACKAGE)
  const targetVersion = published.latest
  if (parseSemver(targetVersion) !== null && parseSemver(pluginVersion) !== null && compareSemver(targetVersion, pluginVersion) <= 0) {
    throw new Error('no-newer-version')
  }
  const target = `${PLUGIN_PACKAGE}@${targetVersion}`
  if (!TARGET_RE.test(PLUGIN_PACKAGE) || !TARGET_RE.test(target) || !/^[A-Za-z0-9][A-Za-z0-9._+\-]*$/.test(targetVersion)) {
    throw new Error('invalid-upgrade-target')
  }

  const addArgs = profile.workspace ? ['add', '-w'] : ['add']
  const dshArgs = ['dsh', 'plugin', '--profile', profile.name]
  const run = (extra) => runCommandResult(ctx, [...dshArgs, ...extra])
  const ok = (result) => result.exitCode === 0 && result.signal === null

  // pnpm 中断（signal 非 null）表示进程被终止，不做自动恢复。
  let result = await run([...addArgs, target])
  if (!ok(result) && result.signal === null) {
    const failure = classifyUpgradeFailure(`${result.stderr}\n${result.stdout}`)
    if (failure !== null) {
      if (failure.code === 'hoist-pattern-diff') {
        const rebuild = await run(['install', '--no-frozen-lockfile'])
        if (ok(rebuild)) result = await run([...addArgs, target])
      } else if (failure.code === 'release-age-violation' || failure.code === 'fetch-timeout') {
        const override = failure.code === 'release-age-violation' ? RELEASE_AGE_OVERRIDE : FETCH_TIMEOUT_OVERRIDE
        if (!addArgs.includes(override)) result = await run([addArgs[0], override, ...addArgs.slice(1), target])
      } else if (failure.code === 'transient-network') {
        result = await run([...addArgs, target])
      } else {
        throw new Error(failure.code)
      }
    }
  }

  if (!ok(result)) {
    const failure = classifyUpgradeFailure(`${result.stderr}\n${result.stdout}`)
    throw new Error(failure !== null ? failure.code : `dsh-failed: ${(result.stderr || '').trim().slice(-400) || result.signal || result.exitCode}`)
  }

  // pnpm 干净退出 ≠ 真升级：minimumReleaseAge 会静默保住旧版。重读磁盘安装版本确认变化，只在其进了才重启。
  const installed = await readInstalledPluginVersion(profile)
  if (installed === null) throw new Error('installed-version-unreadable')
  const advanced = parseSemver(installed) !== null && parseSemver(pluginVersion) !== null
    ? compareSemver(installed, pluginVersion) > 0
    : installed !== pluginVersion
  if (!advanced) throw new Error('upgrade-stale')

  // 手动终端启动环境没有进程管理器拉起 exit(42)：保持旧版本继续服务，把重启时机交给用户。
  // requiresManualRestart 让客户端改走「手动重启指引」而不是恢复轮询（不会有新实例）。
  if (runtimeEnv !== undefined && runtimeEnv !== null && runtimeEnv.manualStartLikely === true) {
    return { result: 'upgraded', profile: profile.name, previous: pluginVersion, installed, requiresManualRestart: true }
  }

  scheduleRestart(ctx)
  return { result: 'upgraded', profile: profile.name, previous: pluginVersion, installed }
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
        writable: await hasAgentAccess(entry.path, true),
      })
    } catch (error) {
      items.push({
        label: entry.label,
        path: entry.path,
        owner: 'unavailable',
        mode: '----',
        writable: false,
        error: error?.code || error?.message || String(error),
      })
    }
  }
  const planId = randomUUID()
  plans.set(planId, items.filter((item) => item.error === undefined).map((item) => item.path))
  return {
    supported: true,
    planId,
    targetOwner: `${process.getuid()}:${process.getgid()}`,
    items,
  }
}

function isAtOrUnderPath(ancestor, path) {
  const child = relative(ancestor, path)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`))
}

// 只有宿主自己的凭据文档使用 owner-only 契约；工作区里的同名文件按 Agent 可写性检查。
function isCredentialsDocument(path, dshHome) {
  return path === join(dshHome, '.credentials.yaml')
}

async function hasAgentAccess(path, directory) {
  try {
    await access(path, directory ? fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK : fsConstants.R_OK | fsConstants.W_OK)
    return true
  } catch (_) {
    return false
  }
}

async function deepCheckPermissions(dshHome, plans, planId) {
  if (typeof planId !== 'string') return undefined
  const paths = plans.get(planId)
  if (paths === undefined) return undefined
  const startedAt = Date.now()
  const result = { scanned: 0, ownerIssues: 0, directoryModeIssues: 0, fileModeIssues: 0, unreadable: 0, samples: [] }
  const visit = async (path) => {
    let info
    try {
      info = await lstat(path)
      result.scanned += 1
    } catch (error) {
      result.unreadable += 1
      if (result.samples.length < 50) result.samples.push({ path, issue: 'unreadable', detail: error?.code || error?.message || String(error) })
      return
    }
    const issues = []
    const mode = info.mode & 0o777
    if (isCredentialsDocument(path, dshHome)) {
      const accessible = await hasAgentAccess(path, false)
      if ((mode & 0o077) !== 0 || !accessible) { result.fileModeIssues += 1; issues.push('file-access') }
      if (issues.length > 0 && result.samples.length < 50) result.samples.push({ path, issue: issues.join(','), detail: modeString(info.mode) })
      return
    }
    if (info.isDirectory()) {
      if (!(await hasAgentAccess(path, true))) { result.directoryModeIssues += 1; issues.push('directory-access') }
    } else if (info.isFile() && !(await hasAgentAccess(path, false))) {
      result.fileModeIssues += 1
      issues.push('file-access')
    }
    if (issues.length > 0 && result.samples.length < 50) result.samples.push({ path, issue: issues.join(','), detail: modeString(info.mode) })
    if (!info.isDirectory()) return
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) } catch (error) {
      result.unreadable += 1
      if (result.samples.length < 50) result.samples.push({ path, issue: 'unreadable', detail: error?.code || error?.message || String(error) })
      return
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue
      await visit(join(path, entry.name))
    }
  }
  // 工作区注册表常含嵌套路径（如 /workspace 与 /workspace/projects/<x>）：被其他根
  // 覆盖的路径只随外层根扫描一次，否则同一批文件会被 stat 两到三次，异常也被重复计数。
  const roots = []
  for (const path of [...paths].sort((a, b) => a.length - b.length)) {
    if (roots.some((root) => isAtOrUnderPath(root, path))) continue
    roots.push(path)
  }
  for (const path of roots) await visit(path)
  result.durationMs = Date.now() - startedAt
  return result
}

async function repairPermissions(ctx, dshHome, plans, planId) {
  if (typeof planId !== 'string') return undefined
  const paths = plans.get(planId)
  if (paths === undefined) return undefined
  plans.delete(planId)
  const owner = `${process.getuid()}:${process.getgid()}`
  const roots = []
  for (const path of [...paths].sort((a, b) => a.length - b.length)) {
    if (roots.some((root) => isAtOrUnderPath(root, path))) continue
    roots.push(path)
  }
  for (const path of roots) {
    // 先逐个恢复目录遍历能力；使用 `{} ;` 让 find 在进入子目录前立即 chmod，且完整跳过 .git。
    await runFixedCommand(ctx, ['find', path, '-name', '.git', '-prune', '-o', '-type', 'd', '-exec', 'chmod', 'u+rwx', '{}', ';'])
    await runFixedCommand(ctx, ['find', path, '-name', '.git', '-prune', '-o', '-exec', 'chown', '-h', owner, '--', '{}', '+'])
    await runFixedCommand(ctx, ['find', path, '-name', '.git', '-prune', '-o', '-type', 'f', '-exec', 'chmod', 'u+rw', '{}', '+'])
  }
  try {
    const credentials = join(dshHome, '.credentials.yaml')
    const info = await lstat(credentials)
    if (info.isFile()) await runFixedCommand(ctx, ['chmod', '600', '--', credentials])
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return permissionSnapshot(ctx, dshHome, plans)
}

// 运行环境检查（v0.17）：managed/declared → ok；疑似手动启动 → warning 但带 advisory 标记
//（黄色行内提示，不参与 overall 聚合、不点亮标签 ⚠ 与顶部提醒——用户复核口径）；unknown →
// info。detail 是客户端映射词典的令牌。
function runtimeEnvCheck(runtimeEnv) {
  if (runtimeEnv === undefined || runtimeEnv === null) return null
  if (runtimeEnv.manualStartLikely === true) return { id: 'runtime-env', status: 'warning', detail: 'manual', advisory: true }
  if (runtimeEnv.supervisorKind === 'declared') return { id: 'runtime-env', status: 'ok', detail: 'declared' }
  if (typeof runtimeEnv.supervisorKind === 'string' && runtimeEnv.supervisorKind.length > 0) {
    return { id: 'runtime-env', status: 'ok', detail: runtimeEnv.supervisorKind }
  }
  return { id: 'runtime-env', status: 'info', detail: 'unknown' }
}

async function collectDiagnostics(ctx, dshHome, runtimeEnv) {
  const checks = []
  const add = (id, status, detail) => checks.push({ id, status, ...(detail === undefined ? {} : { detail: String(detail) }) })

  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) add('session-storage', 'error', 'unavailable')
  else {
    try { add('session-storage', 'ok', (await persistence.listSnapshots()).length) } catch (error) { add('session-storage', 'error', error?.message || error) }
  }

  const registry = ctx.get('workspaceRegistry')
  let workspaceCount = 0
  if (registry === undefined) add('workspace-registry', 'warning', 'unavailable')
  else {
    try {
      const listed = registry.list()
      workspaceCount = Array.isArray(listed) ? listed.length : [...listed].length
      add('workspace-registry', 'ok', workspaceCount)
    } catch (error) { add('workspace-registry', 'error', error?.message || error) }
  }

  try {
    const info = await stat(dshHome)
    add('dsh-home', info.isDirectory() ? 'ok' : 'error', modeString(info.mode))
  } catch (error) { add('dsh-home', 'error', error?.code || error?.message || error) }

  try {
    const backups = await listBackups(dshHome)
    // 没有备份不算警告（v0.14 口径的落地）：空列表是信息级提示，不点亮标签 ⚠、不影响 overall。
    add('backup-storage', backups.items.length === 0 ? 'info' : 'ok', `${backups.items.length}:${backups.totalBytes}`)
  } catch (error) { add('backup-storage', 'error', error?.code || error?.message || error) }

  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) add('tar', 'error', 'subprocess-unavailable')
  else {
    try { add('tar', 'ok', await subprocess.resolveExecutable('tar')) } catch (error) { add('tar', 'error', error?.message || error) }
  }

  if (process.platform === 'linux' && typeof process.getuid === 'function' && typeof process.getgid === 'function') {
    try {
      const snapshot = await permissionSnapshot(ctx, dshHome, new Map())
      const abnormal = snapshot.items.filter((item) => item.writable === false).length
      add('permissions', abnormal === 0 ? 'ok' : 'warning', abnormal)
    } catch (error) { add('permissions', 'warning', error?.message || error) }
  }

  const runtimeCheck = runtimeEnvCheck(runtimeEnv)
  if (runtimeCheck !== null) checks.push(runtimeCheck)

  // Node 运行时版本检查：低于 package.json engines 的最低 major 时告警。
  // detail 形如 "v22.14.0:22"（当前版本:要求 major），客户端按 backup-storage 同款分隔符解析。
  const nodeMajor = parseInt(process.versions.node, 10)
  add('node-version', Number.isFinite(nodeMajor) && nodeMajor >= requiredNodeMajor ? 'ok' : 'warning', `${process.version}:${requiredNodeMajor}`)

  let status = 'ok'
  // advisory 警告（手动启动环境的黄色提示）只做行内呈现：不把 overall 拉成 warning。
  if (checks.some((check) => check.status === 'error')) status = 'error'
  else if (checks.some((check) => check.status === 'warning' && check.advisory !== true)) status = 'warning'
  return { status, checkedAt: Date.now(), checks }
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
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    liveSessions: sessionsService === undefined ? 0 : sessionsService.list().length,
    persistedSessions: sessionRecords.filter((record) => record.persisted === true).length,
    activeAgents: activity.items.filter((item) => item.type === 'agent').length,
    activeJobs: activity.items.filter((item) => item.type === 'job').length,
  }
}

function collectActiveWork(ctx) {
  const agentsService = ctx.get('agents')
  const jobsService = ctx.get('jobs')
  const sharedTerminalsService = ctx.get('terminals')
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

  const terminalsById = new Map()
  for (const owner of agents) {
    let terminalsService = sharedTerminalsService
    try {
      terminalsService = owner.ctx?.get('terminals') ?? sharedTerminalsService
    } catch (_) {}
    if (terminalsService === undefined) continue
    try {
      for (const terminal of terminalsService.list(owner)) {
        if (terminal.status?.kind !== 'running') continue
        const id = String(terminal.sessionId)
        terminalsById.set(id, { terminal, owner })
      }
    } catch (_) {}
  }
  for (const { terminal, owner } of terminalsById.values()) {
    items.push({
      type: 'terminal',
      id: String(terminal.sessionId),
      label: String(terminal.name || `${terminal.type} terminal`),
      status: 'running',
      ownerSession: String(owner.id),
    })
  }

  return { hasActive: items.length > 0, items }
}

// ---- 运行环境探测（v0.16：Windows 终端手动启动场景，用户点名）----
// 重启 = process.exit(42)，依赖外层进程管理器拉起（见 AGENTS.md）；PowerShell/CMD 手动
// 启动时没有任何东西会把它拉起来。这里只用跨平台被动信号（env + 固定路径 fs + Node 自带
// isTTY，零 spawn、浏览器零输入）把环境分成三态：
//   supervisorKind 非 null —— 检测到管理器，exit 后会被自动拉起，维持自动重启；
//   manualStartLikely=true —— 无管理器且 stdin/stdout 双 TTY（终端直启特征），升级后宿主
//                            不自动退出，客户端改示手动重启指引；
//   其余 —— unknown（输出重定向、NSSM/WinSW 等包装器），维持现状不折腾。
// 探测不到的包装器可用 DSH_SERVICE_RUNTIME_ENV=managed|manual 由用户显式声明。
const RUNTIME_SUPERVISOR_ENV = [
  ['pm2', ['pm_id', 'PM2_HOME', 'pm_uptime']],
  ['systemd', ['INVOCATION_ID', 'JOURNAL_STREAM', 'NOTIFY_SOCKET']],
  ['supervisord', ['SUPERVISOR_ENABLED', 'SUPERVISOR_PROCESS_NAME']],
  ['kubernetes', ['KUBERNETES_SERVICE_HOST']],
]

function detectRuntimeEnv(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const stdinIsTTY = options.stdinIsTTY ?? (process.stdin ? process.stdin.isTTY === true : false)
  const stdoutIsTTY = options.stdoutIsTTY ?? (process.stdout ? process.stdout.isTTY === true : false)
  // 默认探测器只在未被注入时执行；win32 直接短路（/.dockerenv 与 /proc 不存在），单测全部显式传原语。
  const dockerEnvExists = options.dockerEnvExists ?? (platform === 'win32' ? false : (() => { try { return existsSync('/.dockerenv') } catch (_) { return false } })())
  const cgroupText = options.cgroupText ?? (platform === 'win32' ? '' : (() => { try { return readFileSync('/proc/1/cgroup', 'utf8') } catch (_) { return '' } })())

  const forced = typeof env.DSH_SERVICE_RUNTIME_ENV === 'string' ? env.DSH_SERVICE_RUNTIME_ENV.trim().toLowerCase() : ''
  if (forced === 'manual') return { platform, supervisorKind: null, manualStartLikely: true }
  if (forced === 'managed') return { platform, supervisorKind: 'declared', manualStartLikely: false }

  for (const [kind, keys] of RUNTIME_SUPERVISOR_ENV) {
    if (keys.some((key) => env[key] !== undefined && env[key] !== '')) {
      return { platform, supervisorKind: kind, manualStartLikely: false }
    }
  }
  // /.dockerenv 与 /proc 只在 POSIX 内核上存在；win32 原生进程不做这两个探测。
  if (platform !== 'win32') {
    if (dockerEnvExists === true) return { platform, supervisorKind: 'docker', manualStartLikely: false }
    if (/docker/i.test(cgroupText)) return { platform, supervisorKind: 'docker', manualStartLikely: false }
    if (/containerd|kubepods|lxc|podman/i.test(cgroupText)) return { platform, supervisorKind: 'container', manualStartLikely: false }
  }
  if (stdinIsTTY === true && stdoutIsTTY === true) return { platform, supervisorKind: null, manualStartLikely: true }
  return { platform, supervisorKind: null, manualStartLikely: false }
}

function scheduleRestart(ctx) {
  const doExit = () => {
    try {
      // 退出码 42 交给 Docker/systemd/pm2 的重启策略处理。
      process.exit(42)
    } catch (error) {
      console.error('dsh-service: exit failed', error?.message || error)
    }
  }
  const timer = ctx.get('timer')
  if (timer !== undefined) return timer.timeout(doExit, 500)
  return doExit()
}

// ─── 技能管理（v0.22）：扫描 / frontmatter 手术 / AI 补全 ─────────────────────
// 管理事实源是文件扫描而非运行时注册表：要能看到被同名遮蔽的候选、无效条目，
// 且不依赖 preset standing mount。启停与补全全部落在 frontmatter 行级手术上。

function skillIdFor(path) {
  return createHmac('sha256', skillsIdSecret).update(path).digest('base64url')
}

function bodyHashOf(raw, bodyStart) {
  return createHash('sha256').update(raw.slice(bodyStart)).digest('hex')
}

/** 定位 frontmatter：返回内部区间索引；无 frontmatter 返回 undefined。 */
function locateSkillFrontmatter(raw) {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return undefined
  let lineStart = firstLineEnd + 1
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { headStart: firstLineEnd + 1, headEnd: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

function unquoteScalar(text) {
  const trimmed = text.trim()
  if (trimmed.length >= 2) {
    const quote = trimmed[0]
    if ((quote === '"' || quote === '\'') && trimmed.endsWith(quote)) return trimmed.slice(1, -1)
  }
  return trimmed
}

/** 官方解析器同款宽松布尔：true/false、yes/no、on/off、1/0；其余 undefined。 */
function parseLooseBoolean(value) {
  if (typeof value !== 'string') return undefined
  switch (value.trim().toLowerCase()) {
    case 'true': case 'yes': case 'on': case '1': return true
    case 'false': case 'no': case 'off': case '0': return false
    default: return undefined
  }
}

/**
 * 保守解析 frontmatter 顶层字段。只承诺管理动作需要的简单标量；块标量/嵌套结构
 * 归入 complex（展示用拼接文本），绝不假装理解完整 YAML——官方解析器若因复杂
 * 结构得出不同结论，条目会以 invalid 或只读形态出现，不会误写。
 */
function parseSkillFrontmatterData(raw) {
  const located = locateSkillFrontmatter(raw)
  if (located === undefined) return undefined
  const inner = raw.slice(located.headStart, located.headEnd)
  const lines = inner.split(/\r?\n/)
  const fields = new Map()
  const TOP_LEVEL = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]*(.*))?$/
  for (let index = 0; index < lines.length;) {
    const match = lines[index].match(TOP_LEVEL)
    if (match === null) { index += 1; continue }
    const key = match[1]
    let rest = typeof match[2] === 'string' ? match[2].trim() : ''
    index += 1
    let complex = false
    let text = rest
    if (rest === '' || rest === '|' || rest === '>' || rest.startsWith('|') || rest.startsWith('>') || rest.startsWith('[') || rest.startsWith('{')) {
      complex = true
      const collected = []
      if (rest !== '' && rest !== '|' && rest !== '>') collected.push(rest.replace(/^[|>][+-]?[0-9]*$/, '').trim())
      while (index < lines.length && lines[index].match(TOP_LEVEL) === null) {
        collected.push(lines[index].replace(/^[ \t]+/, ''))
        index += 1
      }
      text = collected.filter((part) => part !== '').join(' ')
    } else if (rest.startsWith('"') && !rest.endsWith('"')) {
      complex = true
      const collected = [rest]
      while (index < lines.length && !lines[index].endsWith('"')) { collected.push(lines[index].trim()); index += 1 }
      text = collected.join(' ')
    }
    fields.set(key, { value: complex ? text : unquoteScalar(rest), complex })
  }
  return { fields, inner, headStart: located.headStart, headEnd: located.headEnd, bodyStart: located.bodyStart }
}

/** 由解析出的字段求调用位状态；官方语义：缺席即允许，宽松布尔失败按允许处理。 */
function resolveSkillInvocationState(parsed) {
  const legacyKeys = Object.keys(SKILL_LEGACY_KEYS).filter((key) => parsed.fields.has(key))
  const disable = parsed.fields.get('disable-model-invocation')
  const userKey = parsed.fields.get('user-invocable')
  return {
    modelInvocable: parseLooseBoolean(disable?.value) !== true,
    userInvocable: parseLooseBoolean(userKey?.value) !== false,
    legacyKeys,
  }
}

/** 单文件评估：产出列表条目核心（不含来源/可写等扫描上下文）。 */
function evaluateSkillFile(raw) {
  const parsed = parseSkillFrontmatterData(raw)
  if (parsed === undefined) return { invalid: 'missing-frontmatter' }
  const invocation = resolveSkillInvocationState(parsed)
  const nameField = parsed.fields.get('name')
  const descriptionField = parsed.fields.get('description')
  const usageField = parsed.fields.get('whenToUse')
  const name = String(nameField?.value ?? '')
  if (name === '') return { invalid: 'missing-name', invocation }
  if (!SKILL_NAME_RE.test(name)) return { invalid: 'invalid-name', invocation }
  if (invocation.legacyKeys.length > 0) return { name, description: String(descriptionField?.value ?? ''), invocation, invalid: 'legacy-invocation-key:' + invocation.legacyKeys.join(',') }
  const description = String(descriptionField?.value ?? '')
  if (description === '') return { invalid: 'missing-description', invocation }
  return {
    name,
    description,
    usage: usageField !== undefined ? String(usageField.value ?? '') : '',
    invocation,
  }
}

/** 在 frontmatter 内做顶层行级手术的原语：返回新的完整文件文本。 */
function rewriteFrontmatterInner(raw, located, nextLines) {
  return raw.slice(0, located.headStart) + nextLines.join('\n') + '\n' + raw.slice(located.headEnd)
}

function splitHeaderLines(located, raw) {
  const lines = raw.slice(located.headStart, located.headEnd).split(/\r?\n/)
  // 收尾空串来自「关闭 --- 前的换行」，不还原会在每次手术时累积空行。
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 启停开关：kind 'model' 规范键 disable-model-invocation（禁用行值为 true），
 * kind 'user' 规范键 user-invocable（禁用行值为 false）。enable=true 删除键行
 * （缺席即允许），enable=false 原位写入或改值。
 */
function setSkillInvocationKey(raw, kind, enable) {
  const located = locateSkillFrontmatter(raw)
  if (located === undefined) throw new Error('missing-frontmatter')
  const canonical = kind === 'model' ? 'disable-model-invocation' : 'user-invocable'
  const disabledLine = kind === 'model' ? 'disable-model-invocation: true' : 'user-invocable: false'
  const lines = splitHeaderLines(located, raw)
  const matcher = new RegExp('^' + canonical + ':(?:[ \t].*)?$')
  const next = []
  let existing = false
  for (const line of lines) {
    if (matcher.test(line)) {
      existing = true
      if (!enable) next.push(disabledLine)
      continue
    }
    next.push(line)
  }
  if (!existing && !enable) next.unshift(disabledLine)
  return rewriteFrontmatterInner(raw, located, next)
}

/** legacy 调用键一键修复：换算为规范键或删除默认真值行；不可解析的布尔保持原样。 */
function fixLegacySkillInvocationKeys(raw) {
  const located = locateSkillFrontmatter(raw)
  if (located === undefined) throw new Error('missing-frontmatter')
  const lines = splitHeaderLines(located, raw)
  const next = []
  const renamed = []
  for (const line of lines) {
    const legacy = Object.keys(SKILL_LEGACY_KEYS).find((key) => line.startsWith(key + ':'))
    if (legacy === undefined) { next.push(line); continue }
    const { canonical, invert } = SKILL_LEGACY_KEYS[legacy]
    const value = parseLooseBoolean(line.slice(legacy.length + 1))
    if (value === undefined) { next.push(line); continue }
    // 换算语义：legacy 值等价于「该调用位被禁用」时才保留规范禁用行，否则删行。
    const disabled = invert ? !value : value
    renamed.push(legacy)
    if (disabled) next.push(canonical === 'disable-model-invocation' ? 'disable-model-invocation: true' : 'user-invocable: false')
  }
  return { text: rewriteFrontmatterInner(raw, located, next), changed: renamed.length > 0, renamed }
}

/** 扫描根固定五类；工作区路径精确去重（权限面板同口径）。custom 来源 v1 不扫。 */
function buildSkillRoots(ctx, dshHome) {
  const roots = []
  const seenProjects = new Set()
  const workspaceRegistry = ctx.get('workspaceRegistry')
  if (workspaceRegistry !== undefined && Array.isArray(workspaceRegistry.list())) {
    for (const workspace of workspaceRegistry.list()) {
      const projectRoot = String(workspace?.path ?? '')
      if (projectRoot === '' || seenProjects.has(projectRoot)) continue
      seenProjects.add(projectRoot)
      roots.push({ source: 'project-dsh', dir: join(projectRoot, '.dsh', 'skills'), writable: true })
      roots.push({ source: 'project-agents', dir: join(projectRoot, '.agents', 'skills'), writable: true })
    }
  }
  const agentsHome = process.env.DSH_AGENTS_HOME?.trim() || join(homedir(), '.agents')
  roots.push({ source: 'user-dsh', dir: join(dshHome, 'skills'), writable: true })
  roots.push({ source: 'user-agents', dir: join(agentsHome, 'skills'), writable: true })
  const bundledDir = process.env.DSH_BUNDLED_SKILL_DIR?.trim()
  if (bundledDir !== undefined && bundledDir !== '') roots.push({ source: 'bundled', dir: bundledDir, writable: false })
  return roots
}

/** 全量扫描：一层深度发现目录 bundle 与扁平 .md，逐文件评估并标注同名遮蔽。 */
async function scanSkillEntries(ctx, dshHome) {
  const roots = []
  const entries = []
  // 同一物理目录可能被两条根规则同时命中（典型：HOME 本身注册为工作区时，
  // ~/.agents/skills 既是 user-agents 又是该工作区的 project-agents）。按解析路径
  // 去重、保留 rank 最高（数字最小）的来源标签，否则整个目录的候选都会双份并互相标遮蔽。
  const effectiveRoots = new Map()
  for (const def of buildSkillRoots(ctx, dshHome)) {
    let dirInfo
    try {
      dirInfo = await stat(def.dir)
    } catch (_) { continue }
    if (!dirInfo.isDirectory()) continue
    let resolvedDir
    try {
      resolvedDir = await realpath(def.dir)
    } catch (_) { resolvedDir = def.dir }
    const previous = effectiveRoots.get(resolvedDir)
    if (previous === undefined || (SKILL_SOURCE_RANK[def.source] ?? 999) < previous.rank) {
      effectiveRoots.set(resolvedDir, { ...def, dir: resolvedDir })
    }
  }
  for (const def of effectiveRoots.values()) {
    const dirWritable = def.writable && await hasAgentAccess(def.dir, true)
    roots.push({ source: def.source, dir: def.dir, writable: dirWritable })
    let dirents
    try {
      dirents = await readdir(def.dir, { withFileTypes: true })
    } catch (error) {
      roots[roots.length - 1].error = error?.code || error?.message || String(error)
      continue
    }
    for (const dirent of [...dirents].sort((left, right) => left.name.localeCompare(right.name))) {
      const bundlePath = join(def.dir, dirent.name)
      const path = dirent.isDirectory() ? join(bundlePath, 'SKILL.md') : dirent.isFile() && dirent.name.endsWith('.md') ? bundlePath : undefined
      if (path === undefined) continue
      const base = { id: skillIdFor(path), path, source: def.source, rank: SKILL_SOURCE_RANK[def.source] ?? 999, dir: def.dir, writable: dirWritable && await hasAgentAccess(path, false) }
      try {
        const info = await stat(path)
        if (info.size > MAX_SKILL_FILE_BYTES) { entries.push({ ...base, invalid: 'too-large' }); continue }
        const raw = await readFile(path, 'utf8')
        const evaluated = evaluateSkillFile(raw)
        entries.push({ ...base, ...evaluated, bodyHash: bodyHashOf(raw, locateSkillFrontmatter(raw)?.bodyStart ?? 0), bytes: info.size })
      } catch (error) {
        entries.push({ ...base, invalid: 'read-error:' + (error?.code || error?.message || String(error)).slice(0, 80) })
      }
    }
  }
  const winners = new Map()
  for (const entry of entries) {
    if (entry.invalid !== undefined) continue
    const current = winners.get(entry.name)
    const better = current === undefined
      || entry.rank < current.rank
      || (entry.rank === current.rank && (entry.path < current.path))
    if (better) winners.set(entry.name, entry)
  }
  for (const entry of entries) {
    if (entry.invalid === undefined && winners.get(entry.name) !== entry) entry.shadowed = true
  }
  entries.sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name) || (left.path < right.path ? -1 : 1))
  return { roots, entries }
}

async function loadSkillsIndex(dshHome) {
  try {
    const parsed = JSON.parse(await readFile(join(dshHome, SKILLS_INDEX_FILE), 'utf8'))
    if (parsed?.version !== SKILLS_INDEX_VERSION || typeof parsed.entries !== 'object' || parsed.entries === null) return {}
    const entries = {}
    for (const [path, record] of Object.entries(parsed.entries)) {
      if (typeof path !== 'string' || typeof record?.bodyHash !== 'string') continue
      // v2 起记录携带 AI 注释本体（仅面板展示，不写技能文件）；无 note 的记录视为无效丢弃。
      const note = record.note
      if (note === undefined || note === null) continue
      if (typeof note.description !== 'string' || note.description === '' || typeof note.usage !== 'string') continue
      entries[path] = { bodyHash: record.bodyHash, note: { description: note.description, usage: note.usage }, ...(typeof record.model === 'string' ? { model: record.model } : {}), ...(typeof record.at === 'number' ? { at: record.at } : {}) }
    }
    return entries
  } catch (_) { return {} }
}

async function saveSkillsIndex(dshHome, entries) {
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, SKILLS_INDEX_FILE)
  const temporary = `${target}.tmp-${randomUUID()}`
  await writeFile(temporary, JSON.stringify({ version: SKILLS_INDEX_VERSION, entries }), { mode: 0o600 })
  await rename(temporary, target)
}

/** 批量候选：可写、非 invalid、非遮蔽、且侧车记录缺失或正文哈希过期。 */
function selectSkillBatchCandidates(entries, index) {
  const candidates = []
  const skipped = []
  for (const entry of entries) {
    if (entry.invalid !== undefined) skipped.push({ id: entry.id, name: entry.name ?? '', reason: entry.invalid })
    else if (entry.shadowed === true) skipped.push({ id: entry.id, name: entry.name, reason: 'shadowed' })
    else {
      const record = index[entry.path]
      if (record?.note !== undefined && record.bodyHash === entry.bodyHash) skipped.push({ id: entry.id, name: entry.name, reason: 'annotated-current' })
      else candidates.push({ id: entry.id, name: entry.name, source: entry.source })
    }
  }
  return { candidates, skipped }
}

function publicSkillEntry(entry, index) {
  const record = entry.path !== undefined ? index[entry.path] : undefined
  const noteFresh = record !== undefined && record.bodyHash === entry.bodyHash && record.note !== undefined
  return {
    id: entry.id,
    name: entry.name ?? '',
    description: entry.description ?? '',
    usage: entry.usage ?? '',
    invocation: {
      model: entry.invocation?.modelInvocable !== false,
      user: entry.invocation?.userInvocable !== false,
    },
    source: entry.source,
    writable: entry.writable === true,
    shadowed: entry.shadowed === true,
    ...(entry.invalid !== undefined ? { invalid: entry.invalid } : {}),
    ...(record?.note !== undefined ? { note: { ...record.note, stale: !noteFresh }, model: record.model, at: record.at } : {}),
    annotated: noteFresh,
  }
}

/** 变更类动作共用通道：重扫定位签名 ID（浏览器零路径输入），校验后执行手术。 */
async function mutateSkillEntryById(ctx, dshHome, index, id, allowInvalid, mutate) {
  if (typeof id !== 'string' || id === '') return { ok: false, error: 'unknown-skill' }
  const { entries } = await scanSkillEntries(ctx, dshHome)
  const entry = entries.find((candidate) => candidate.id === id)
  if (entry === undefined) return { ok: false, error: 'unknown-skill' }
  if (entry.invalid !== undefined && !(allowInvalid === true && entry.invalid.startsWith('legacy-invocation-key:'))) return { ok: false, error: 'invalid-skill', detail: entry.invalid }
  if (entry.writable !== true) return { ok: false, error: 'read-only-source' }
  const raw = await readFile(entry.path, 'utf8')
  const outcome = mutate(raw, entry)
  if (outcome.text !== raw) await writeFile(entry.path, outcome.text, 'utf8')
  const evaluated = evaluateSkillFile(outcome.text)
  const freshLocated = locateSkillFrontmatter(outcome.text)
  const fresh = { ...entry, ...evaluated, bodyHash: bodyHashOf(outcome.text, freshLocated?.bodyStart ?? 0) }
  if (evaluated.invalid === undefined) delete fresh.invalid
  return { ok: true, entry: publicSkillEntry(fresh, index), entryPath: entry.path }
}

function skillDescribeSystemPrompt() {
  return [
    'You write catalog metadata for agent-harness skills.',
    'Reply with STRICT JSON only, no markdown fences, no extra keys, no commentary:',
    '{"description":"...","whenToUse":"..."}',
    'Rules: "description" and "whenToUse" MUST be written in Simplified Chinese regardless of the skill body language; "description" is ONE routing sentence (max ' + SKILL_DESCRIPTION_MAX_CHARS + ' characters) saying what the skill does and when to pick it; "whenToUse" is short usage guidance (max ' + SKILL_USAGE_MAX_CHARS + ' characters); never use line breaks inside either value.',
  ].join(' ')
}

function sanitizeSkillDraftText(value, maxChars) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex -- 控制字符按不可信输入剔除
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .slice(0, maxChars)
}

function extractSkillDraftJson(text) {
  // 模型输出按不可信数据处理：先剥掉会破坏 JSON.parse 的裸控制字符（保留换行/回车/制表）。
  const cleaned = String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no-json-object')
  const parsed = JSON.parse(cleaned.slice(start, end + 1))
  const description = sanitizeSkillDraftText(parsed?.description, SKILL_DESCRIPTION_MAX_CHARS)
  if (description === '') throw new Error('empty-description')
  return { description, usage: sanitizeSkillDraftText(parsed?.whenToUse, SKILL_USAGE_MAX_CHARS) }
}

// 日志事件为结构化 {code, params}：宿主只发稳定代码，本地化文案由客户端词典渲染，
// 宿主侧不拼任何用户可见语言（AGENTS.md 双语约束）。
async function collectLlmText(llm, options) {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => controller.abort(new Error('describe-timeout')), SKILL_DESCRIBE_TIMEOUT_MS)
  // 外部取消（批量取消 / Fiber 销毁）级联到本地 controller，立即中断在途流。
  const onExternalAbort = () => controller.abort(new Error('batch-cancelled'))
  if (options.signal !== undefined) options.signal.addEventListener('abort', onExternalAbort)
  // 等待首包/长输出的可观测性：每 10 秒向日志回调报告一次已等待时长。
  const startedAt = Date.now()
  const waitTicker = options.onEvent === undefined ? undefined : setInterval(() => {
    options.onEvent('wait', { secs: Math.round((Date.now() - startedAt) / 1000) })
  }, 10 * 1000)
  try {
    let text = ''
    let reasoningChars = 0
    let finishKind = null
    let blockText
    const stream = llm.stream({
      provider: options.provider,
      model: options.model,
      system: skillDescribeSystemPrompt(),
      messages: [createSkillDescribeMessage(options.prompt)],
      maxTokens: options.maxTokens ?? SKILL_DESCRIBE_MAX_TOKENS,
      signal: controller.signal,
    })
    let firstChunkSeen = false
    let receivedChars = 0
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        if (!firstChunkSeen) {
          firstChunkSeen = true
          options.onEvent?.('first-delta')
        }
        receivedChars += chunk.text.length
        if (chunk.text.length > 0 && receivedChars % 200 < chunk.text.length) options.onEvent?.('progress', { chars: receivedChars })
        text += chunk.text
      } else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        // 推理流不进正文，但要计数并在日志里可见：推理耗尽预算正是「正文 0 字符」的头号原因。
        if (!firstChunkSeen) {
          firstChunkSeen = true
          options.onEvent?.('first-reasoning')
        }
        reasoningChars += chunk.text.length
      } else if (chunk?.type === 'block-end' && chunk.block !== undefined && chunk.block !== null && chunk.block.type === 'text' && typeof chunk.block.text === 'string') {
        // 个别适配器不发 text-delta，只在整块里给正文：先存着，流结束后正文仍为空时兜底。
        if (blockText === undefined) blockText = chunk.block.text
      } else if (chunk?.type === 'finish' && chunk.reason !== undefined && chunk.reason !== null) {
        finishKind = typeof chunk.reason === 'object' ? String(chunk.reason.kind ?? '') : String(chunk.reason)
        if (finishKind === '') finishKind = null
      }
    }
    if (text === '' && finishKind !== null) {
      options.onEvent?.(reasoningChars > 0 ? 'finish-reasoning-only' : 'finish-empty', { kind: finishKind, ...(reasoningChars > 0 ? { chars: reasoningChars } : {}) })
    }
    if (text === '' && typeof blockText === 'string' && blockText !== '') {
      options.onEvent?.('block-extract', { chars: blockText.length })
      text = blockText
    }
    if (text === '') {
      // 空输出给出带结束码的明确错误，不再落进误导性的 no-json-object。
      throw new Error('empty-output' + (finishKind !== null ? ':' + finishKind : ''))
    }
    return text
  } finally {
    clearTimeout(timeoutHandle)
    if (waitTicker !== undefined) clearInterval(waitTicker)
    if (options.signal !== undefined) options.signal.removeEventListener('abort', onExternalAbort)
  }
}

// dsh-llm 的消息构造走 createUserMessage；此处只依赖其形状，避免拉起可选依赖。
function createSkillDescribeMessage(prompt) {
  return { role: 'user', content: [{ type: 'text', text: prompt }] }
}

async function describeSkillDraft(llm, entryName, rawContent, provider, model, onEvent, options = {}) {
  const prompt = 'Skill name: ' + entryName + '\n\nSkill file content:\n' + rawContent.slice(0, 16000)
  let lastError
  for (let attempt = 0; attempt < SKILL_DESCRIBE_ATTEMPTS; attempt += 1) {
    // 外部取消（批量取消 / Fiber 销毁）不重试：立即以稳定错误码出栈。
    if (options.signal?.aborted) throw new Error('batch-cancelled')
    try {
      onEvent?.('attempt', { n: attempt + 1, total: SKILL_DESCRIBE_ATTEMPTS, route: provider + '/' + model })
      // 重试时逐级放大输出预算：推理型模型可能耗尽配额却产不出正文。
      const text = await collectLlmText(llm, { provider, model, prompt, onEvent, maxTokens: SKILL_DESCRIBE_MAX_TOKENS * Math.pow(4, attempt), signal: options.signal })
      onEvent?.('received', { chars: text.length })
      const draft = extractSkillDraftJson(text)
      onEvent?.('parsed')
      return draft
    } catch (error) {
      if (options.signal?.aborted) throw new Error('batch-cancelled')
      const message = String((error && error.message) || error).slice(0, 120)
      onEvent?.(attempt < SKILL_DESCRIBE_ATTEMPTS - 1 ? 'failed-retry' : 'failed', { message })
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 模型清单白名单：describe/批量运行时以此复核 provider/model 组合。 */
async function listSkillModels(llm, agentDefaultModel) {
  const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
  const models = []
  const seen = new Set()
  for (const provider of Array.isArray(providers) ? providers : []) {
    if (typeof provider?.id !== 'string') continue
    let providerModels
    try {
      providerModels = await llm.listModels(provider.id)
    } catch (_) { continue }
    for (const model of Array.isArray(providerModels) ? providerModels : []) {
      if (typeof model?.id !== 'string') continue
      const key = provider.id + '\u0000' + model.id
      if (seen.has(key)) continue
      seen.add(key)
      models.push({ provider: provider.id, providerName: typeof provider.name === 'string' ? provider.name : provider.id, id: model.id, name: typeof model.name === 'string' ? model.name : model.id })
    }
  }
  let current
  try {
    const selection = agentDefaultModel?.currentSelection?.()
    if (typeof selection?.provider === 'string' && typeof selection?.model === 'string') current = { provider: selection.provider, model: selection.model }
  } catch (_) {}
  return { models, ...(current !== undefined ? { current } : {}) }
}

function apply(ctx) {
  const dshHome = resolveDshHome()
  let featureSettings = DEFAULT_FEATURE_SETTINGS
  const featureSettingsListeners = new Set()
  const publishFeatureSettings = () => {
    for (const listener of featureSettingsListeners) listener(featureSettings)
  }
  ctx.inject(['settings'], (settingsCtx) => {
    try {
      const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, FeatureSettingsSchema, { base: DEFAULT_FEATURE_SETTINGS })
      featureSettings = scope.get()
      publishFeatureSettings()
      if (typeof scope.watch === 'function') settingsCtx.effect(() => scope.watch((value) => {
        featureSettings = value ?? scope.get()
        publishFeatureSettings()
      }), 'dsh-service feature settings watch')
    } catch (error) {
      ctx.logger?.warn?.(`dsh-service: feature settings unavailable: ${error?.message || error}`)
    }
  })
  const featureEnabled = (key) => featureSettings?.[key] !== false
  // 进程运行环境在生命周期内不变：挂载时探测一次，version RPC 与升级分支共用。
  const runtimeEnv = detectRuntimeEnv()
  const permissionPlans = new Map()
  const downloadTokens = new Map()
  let usageIndexPromise = loadUsageIndex(dshHome)
  let usageRefreshPromise
  let updateCache
  let updatePromise
  const quotaThrottle = createQuotaThrottle()
  // 技能管理（v0.22）：侧车索引缓存 + 批量补全状态。批量随 Fiber 销毁中止。
  let skillsIndexPromise = loadSkillsIndex(dshHome)
  let skillsBatch = null
  // 单条补全的运行日志环形缓冲：客户端在「生成中」期间轮询展示。
  // 条目是结构化 {at, code, params}，本地化文案由客户端词典渲染。
  const describeJobs = new Map()
  const makeDescribeJobLogger = (jobKey) => {
    if (!describeJobs.has(jobKey) && describeJobs.size >= 20) describeJobs.delete(describeJobs.keys().next().value)
    const job = { logs: [] }
    job.push = (code, params = {}) => {
      job.logs.push({ at: Date.now(), code, params })
      if (job.logs.length > 60) job.logs.shift()
    }
    describeJobs.set(jobKey, job)
    return job
  }
  // 侧车索引写串行化（quota-config 同款）：所有写从同一内存快照复制、保存成功后替换快照，
  // 避免单条注释保存与批量循环的读改写交错互相覆盖（丢注释或把磁盘回退到旧快照）。
  let skillsIndexWrites = Promise.resolve()
  const serializeSkillsIndexWrite = (work) => {
    const result = skillsIndexWrites.then(async () => {
      const current = { ...(await skillsIndexPromise) }
      const outcome = await work(current)
      if (outcome?.save === false) return outcome?.value
      await saveSkillsIndex(dshHome, current)
      skillsIndexPromise = Promise.resolve(current)
      return outcome?.value
    })
    skillsIndexWrites = result.then(() => undefined, () => undefined)
    return result
  }
  // 在途 LLM 调用注册表：批量取消与 Fiber 销毁都从这里立即 abort（规格承诺的 AbortController 取消）。
  const skillsActiveControllers = new Set()
  const registerSkillCall = () => {
    const call = new AbortController()
    skillsActiveControllers.add(call)
    return { signal: call.signal, done: () => skillsActiveControllers.delete(call) }
  }
  ctx.effect(() => () => {
    if (skillsBatch !== null) skillsBatch.aborted = true
    for (const call of skillsActiveControllers) {
      try { call.abort(new Error('batch-cancelled')) } catch (_) {}
    }
    skillsActiveControllers.clear()
  }, 'dsh-service skills batch teardown')
  let quotaConfig = createEmptyQuotaConfig()
  let quotaConfigLoaded = false
  let quotaConfigLoadPromise
  let quotaConfigLastCheckedAt = 0
  let quotaConfigMtimeMs = 0
  const quotaConfigPath = join(dshHome, QUOTA_CONFIG_FILE)
  const refreshQuotaConfigCache = async (force = false) => {
    const now = Date.now()
    if (!force && quotaConfigLoaded && now - quotaConfigLastCheckedAt < QUOTA_CONFIG_STAT_TTL_MS) return quotaConfig
    if (quotaConfigLoadPromise !== undefined) return quotaConfigLoadPromise
    quotaConfigLoadPromise = Promise.resolve().then(async () => {
      quotaConfigLastCheckedAt = now
      let mtimeMs = 0
      try {
        const info = await stat(quotaConfigPath)
        if (info.size > MAX_QUOTA_CONFIG_BYTES) {
          quotaConfig = createEmptyQuotaConfig()
          quotaConfigLoaded = true
          quotaConfigMtimeMs = info.mtimeMs
          return quotaConfig
        }
        mtimeMs = info.mtimeMs
      } catch (_) {}
      if (force || !quotaConfigLoaded || mtimeMs !== quotaConfigMtimeMs) {
        quotaConfig = await loadQuotaConfig(dshHome)
        quotaConfigLoaded = true
        quotaConfigMtimeMs = mtimeMs
      }
      return quotaConfig
    }).finally(() => { quotaConfigLoadPromise = undefined })
    return quotaConfigLoadPromise
  }
  // 配置写串行化：所有写都从同一内存快照复制，保存成功后再替换快照，避免并发覆盖和热路径重复读盘。
  let quotaConfigWrites = Promise.resolve()
  const serializeQuotaConfigWrite = (work) => {
    const result = quotaConfigWrites.then(async () => {
      const current = copyQuotaConfig(await refreshQuotaConfigCache(true))
      const outcome = await work(current)
      if (outcome?.save === false) return outcome.value
      await saveQuotaConfig(dshHome, current)
      quotaConfig = current
      quotaConfigLoaded = true
      quotaConfigLastCheckedAt = Date.now()
      try { quotaConfigMtimeMs = (await stat(quotaConfigPath)).mtimeMs } catch (_) {}
      return outcome?.value
    })
    quotaConfigWrites = result.then(() => undefined, () => undefined)
    return result
  }
  const quotaAbortControllers = new Set()
  let quotaDisposed = false
  let quotaActiveCount = 0
  const quotaPending = []
  const runNextQuotaWork = () => {
    while (!quotaDisposed && quotaActiveCount < QUOTA_MAX_CONCURRENCY && quotaPending.length > 0) {
      const work = quotaPending.shift()
      quotaActiveCount += 1
      Promise.resolve().then(work).finally(() => {
        quotaActiveCount = Math.max(0, quotaActiveCount - 1)
        runNextQuotaWork()
      })
    }
  }
  const enqueueQuotaWork = (work) => {
    if (quotaDisposed) return false
    quotaPending.push(work)
    runNextQuotaWork()
    return true
  }
  // 远端额度：后台补拉一次。是否真的发上游由节流器判定；跨 provider 经小型并发池调度。
  // config 供 fetcher 类 kind（cliproxy）做钉住域守卫；经典 kind 忽略该参数。
  const kickQuotaRefresh = (profile, kind, config) => {
    const decision = quotaThrottle.attempt(profile.name)
    if (!decision.ok) return
    const registered = KIND_REGISTRY[kind]
    const queued = enqueueQuotaWork(async () => {
      try {
        if (registered === undefined || (registered.parser === undefined && registered.fetcher === undefined)) throw new Error('bad-payload:kind')
        if (registered.fetcher !== undefined) {
          // 编排类 kind（cliproxy）：端点守卫 → 凭据 → fetcher 合并多账号窗口，无候选链。
          const guard = registered.fetcherGuard?.(profile, config) ?? null
          if (guard !== null) throw new Error(guard)
          const authorization = await discoverQuotaCredential(ctx, kind, profile)
          if (authorization === undefined) throw new Error('credential-missing')
          const controller = new AbortController()
          quotaAbortControllers.add(controller)
          const deadline = setTimeout(() => controller.abort(), QUOTA_PROVIDER_DEADLINE_MS)
          let produced
          try {
            produced = await registered.fetcher({ profile, config, authorization, signal: controller.signal })
          } finally {
            clearTimeout(deadline)
            quotaAbortControllers.delete(controller)
          }
          if (!Array.isArray(produced)) throw new Error('bad-payload:shape')
          if (!quotaDisposed) quotaThrottle.settle(profile.name, { ok: true, windows: produced })
          return
        }
        const parser = registered.parser
        // 端点候选链先于凭据解析：baseURL 缺失是更明确的配置错误（也省一次凭据查找）。
        const candidates = quotaEndpointFor(kind, profile.baseURL)
        if (candidates.length === 0) throw new Error('no-base-url')
        const authorization = await discoverQuotaCredential(ctx, kind, profile)
        if (authorization === undefined) throw new Error('credential-missing')
        const controller = new AbortController()
        quotaAbortControllers.add(controller)
        const deadline = setTimeout(() => controller.abort(), QUOTA_PROVIDER_DEADLINE_MS)
        let windows
        try {
          let lastError = null
          let parseFailure = null
          for (const endpoint of candidates) {
            let payload
            try {
              payload = await fetchProviderUsage(endpoint, authorization, { signal: controller.signal })
            } catch (error) {
              lastError = error
              if ((error.message === 'http-status:401' || error.message === 'http-status:403') && candidates.length > 1) continue
              throw error
            }
            const parsed = parser(payload)
            if (!Array.isArray(parsed?.windows)) {
              parseFailure ??= new Error('bad-payload:shape')
              lastError = parseFailure
              continue
            }
            if (parsed.windows.length === 0) {
              const envelope = payload !== null && typeof payload === 'object'
                && Number(payload.code) !== 0 && typeof payload.msg === 'string' ? sanitizeQuotaErrorDetail(payload.msg) : undefined
              parseFailure ??= Object.assign(new Error('bad-payload'), { detail: envelope })
              lastError = parseFailure
              continue
            }
            windows = parsed.windows
            break
          }
          if (windows === undefined) throw parseFailure ?? lastError ?? new Error('bad-payload')
        } finally {
          clearTimeout(deadline)
          quotaAbortControllers.delete(controller)
        }
        if (!quotaDisposed) quotaThrottle.settle(profile.name, { ok: true, windows })
      } catch (error) {
        if (!quotaDisposed) {
          const detail = sanitizeQuotaErrorDetail(error?.detail)
          quotaThrottle.settle(profile.name, {
            ok: false,
            code: quotaErrorCode(error),
            ...(detail !== undefined ? { detail } : {}),
          })
        }
      }
    })
    if (!queued && !quotaDisposed) quotaThrottle.settle(profile.name, { ok: false, code: 'cancelled' })
  }
  ctx.effect(() => () => permissionPlans.clear(), 'dsh-service permission plans')
  ctx.effect(() => () => {
    quotaDisposed = true
    quotaPending.length = 0
    for (const controller of quotaAbortControllers) controller.abort()
    quotaAbortControllers.clear()
  }, 'dsh-service quota upstream disposal')
  const commands = ctx.get('commands')
  if (commands !== undefined) {
    ctx.effect(() => commands.register({
      name: 'restart',
      description: 'Restart the DSH Web process after checking active work',
      handler: async (invocation) => {
        if (invocation.rawInput.trim() !== '') return { kind: 'error', text: '/restart does not accept arguments.' }
        const activity = collectActiveWork(ctx)
        if (activity.hasActive) return { kind: 'error', text: `Restart refused: ${activity.items.length} active item(s) detected. Use the Service Control restart tab to review them.` }
        scheduleRestart(ctx)
        return { kind: 'success', text: 'Restart scheduled. The DSH Web process will exit in 0.5 seconds.' }
      },
    }), 'dsh-service restart command')
  }
  const webServer = ctx.get('webServer')
  if (webServer !== undefined) {
    let healthzDispose = null
    const syncHealthzRoute = () => {
      if (healthzDispose !== null) {
        healthzDispose()
        healthzDispose = null
      }
      if (!featureEnabled('healthz')) return
      healthzDispose = webServer.register({
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
      })
    }
    syncHealthzRoute()
    featureSettingsListeners.add(syncHealthzRoute)
    ctx.effect(() => () => {
      featureSettingsListeners.delete(syncHealthzRoute)
      if (healthzDispose !== null) healthzDispose()
    }, 'dsh-service healthz route')
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/dsh-backup-download',
      handler: async (req, res) => {
        const url = new URL(req.url, 'http://localhost')
        const token = url.searchParams.get('token')
        if (!token) { res.writeHead(400); res.end(); return }
        const entry = downloadTokens.get(token)
        if (!entry || Date.now() > entry.expires) { downloadTokens.delete(token); res.writeHead(404); res.end(); return }
        downloadTokens.delete(token)
        try {
          const data = await readFile(entry.path)
          res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${entry.name}"`, 'Content-Length': data.length })
          res.end(data)
        } catch (_) {
          res.writeHead(500)
          res.end()
        }
      },
    }), 'dsh-service backup download route')
  }

  // DSH 的 Connection RPC channel 只能是单层绝对路径；子功能放在 endpoint 中。
  // 合法示例：channel=/dsh-service，endpoint=version/check-update/activity/web。
  ctx.connection.rpc.handle('/dsh-service', async (endpoint, payload) => {
    if (endpoint === 'version') {
      // runtimeEnv 随进程身份（instanceId）一起返回：概览展示、升级前置确认与重启警告共用，
      // 客户端对缺字段的老宿主静默降级。
      return { ok: true, value: { current: dshVersion, pluginVersion, instanceId, runtimeEnv } }
    }

    if (endpoint === 'check-update') {
      const now = Date.now()
      if (updateCache && now - updateCache.checkedAt < updateCache.ttl) {
        return updateCache.ok
          ? { ok: true, value: Object.assign({}, updateCache.value, { cached: true }) }
          : { ok: false, error: updateCache.error, cached: true }
      }
      try {
        if (updatePromise === undefined) {
          updatePromise = Promise.allSettled([
            fetchPublishedVersions(DSH_PACKAGE),
            fetchPublishedVersions(PLUGIN_PACKAGE),
          ]).finally(() => { updatePromise = undefined })
        }
        const [dshResult, pluginResult] = await updatePromise
        const dsh = dshResult.status === 'fulfilled'
          ? { current: dshVersion, latest: dshResult.value.latest, tags: dshResult.value.tags, upToDate: atLeastSemver(dshVersion, dshResult.value.latest), status: 'available', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' }
          : { current: dshVersion, latest: null, tags: { latest: null, next: null }, upToDate: null, status: 'unavailable', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' }
        const pluginError = pluginResult.status === 'rejected' ? String(pluginResult.reason?.message || pluginResult.reason) : ''
        const plugin = pluginResult.status === 'fulfilled'
          ? { current: pluginVersion, latest: pluginResult.value.latest, tags: pluginResult.value.tags, upToDate: atLeastSemver(pluginVersion, pluginResult.value.latest), status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' }
          : { current: pluginVersion, latest: null, tags: { latest: null, next: null }, upToDate: null, status: pluginError.includes('HTTP 404') ? 'unpublished' : 'unavailable', url: 'https://github.com/gehennawu/dsh-service/releases' }
        if (dsh.status === 'unavailable' && plugin.status === 'unavailable') throw dshResult.reason
        const value = { checkedAt: now, cached: false, dsh, plugin }
        updateCache = { ok: true, value, checkedAt: now, ttl: 10 * 60 * 1000 }
        return { ok: true, value }
      } catch (error) {
        const message = error?.message || String(error)
        updateCache = { ok: false, error: message, checkedAt: now, ttl: 60 * 1000 }
        return { ok: false, error: message, cached: false }
      }
    }

    if (endpoint === 'upgrade') {
      try {
        return { ok: true, value: await upgradePlugin(ctx, dshHome, runtimeEnv) }
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

    if (endpoint === 'diagnostics') {
      try {
        return { ok: true, value: await collectDiagnostics(ctx, dshHome, runtimeEnv) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'usage') {
      if (!featureEnabled('modelUsage')) return { ok: false, error: 'feature-disabled' }
      try {
        return { ok: true, value: publicUsage(await usageIndexPromise, payload?.timezoneOffsetMinutes) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'usage-refresh') {
      if (!featureEnabled('modelUsage')) return { ok: false, error: 'feature-disabled' }
      try {
        if (usageRefreshPromise === undefined) {
          usageRefreshPromise = usageIndexPromise.then((index) => refreshUsageIndex(ctx, dshHome, index)).finally(() => { usageRefreshPromise = undefined })
        }
        return { ok: true, value: publicUsage(await usageRefreshPromise, payload?.timezoneOffsetMinutes) }
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

    if (endpoint === 'permissions-deep') {
      try {
        const value = await deepCheckPermissions(dshHome, permissionPlans, payload?.planId)
        if (value === undefined) return { ok: false, error: 'unknown-permission-plan' }
        return { ok: true, value }
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
      if (!featureEnabled('backupMaintenance')) return { ok: false, error: 'feature-disabled' }
      try {
        return { ok: true, value: await listBackups(dshHome) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-create') {
      if (!featureEnabled('backupMaintenance')) return { ok: false, error: 'feature-disabled' }
      try {
        return { ok: true, value: await createBackup(ctx, dshHome) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-export') {
      if (!featureEnabled('backupMaintenance')) return { ok: false, error: 'feature-disabled' }
      try {
        const value = await exportBackup(dshHome, downloadTokens, payload?.id)
        if (value === undefined) return { ok: false, error: 'unknown-backup' }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-delete') {
      if (!featureEnabled('backupMaintenance')) return { ok: false, error: 'feature-disabled' }
      try {
        const value = await deleteBackup(dshHome, payload?.id)
        if (value === undefined) return { ok: false, error: 'unknown-backup' }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-restore') {
      if (!featureEnabled('backupMaintenance')) return { ok: false, error: 'feature-disabled' }
      try {
        const value = await restoreBackup(ctx, dshHome, payload?.id)
        if (value === undefined) return { ok: false, error: 'unknown-backup' }
        scheduleRestart(ctx)
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'backup-import') {
      if (!featureEnabled('backupMaintenance')) return { ok: false, error: 'feature-disabled' }
      try {
        const value = await importBackup(dshHome, payload?.name, payload?.data)
        if (value === undefined) return { ok: false, error: 'invalid-backup' }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-list') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      try {
        const index = await skillsIndexPromise
        const { roots, entries } = await scanSkillEntries(ctx, dshHome)
        return {
          ok: true,
          value: {
            roots: roots.map(({ source, dir, writable }) => ({ source, dir, writable })),
            entries: entries.map((entry) => publicSkillEntry(entry, index)),
            llmAvailable: ctx.get('llm') !== undefined,
          },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-models') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
      try {
        return { ok: true, value: await listSkillModels(llm, ctx.get('agentDefaultModel')) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-toggle') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      const field = payload?.field === 'model' || payload?.field === 'user' ? payload.field : null
      if (field === null) return { ok: false, error: 'invalid-field' }
      if (typeof payload?.enable !== 'boolean') return { ok: false, error: 'invalid-enable' }
      try {
        const index = await skillsIndexPromise
        const outcome = await mutateSkillEntryById(ctx, dshHome, index, payload?.id, false, (raw) => ({ text: setSkillInvocationKey(raw, field, payload.enable) }))
        if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) }
        return { ok: true, value: { entry: outcome.entry } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-fix-keys') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      try {
        const index = await skillsIndexPromise
        const outcome = await mutateSkillEntryById(ctx, dshHome, index, payload?.id, true, (raw) => {
          const fixed = fixLegacySkillInvocationKeys(raw)
          return { text: fixed.text }
        })
        if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) }
        return { ok: true, value: { entry: outcome.entry } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-describe') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
      const provider = typeof payload?.provider === 'string' ? payload.provider : ''
      const model = typeof payload?.model === 'string' ? payload.model : ''
      if (provider === '' || model === '') return { ok: false, error: 'invalid-model-route' }
      try {
        // provider/model 必须命中白名单；条目必须能被签名 ID 重新定位。
        const whitelist = await listSkillModels(llm, ctx.get('agentDefaultModel'))
        if (!whitelist.models.some((item) => item.provider === provider && item.id === model)) return { ok: false, error: 'invalid-model-route' }
        const index = await skillsIndexPromise
        const { entries } = await scanSkillEntries(ctx, dshHome)
        const entry = entries.find((candidate) => candidate.id === payload?.id)
        if (entry === undefined) return { ok: false, error: 'unknown-skill' }
        if (entry.invalid !== undefined) return { ok: false, error: 'invalid-skill', detail: entry.invalid }
        const raw = await readFile(entry.path, 'utf8')
        const job = makeDescribeJobLogger(entry.id)
        job.push('located', { name: entry.name ?? '', chars: raw.length })
        // 注册进活动调用表：Fiber 销毁时立即中断，不再僵尸到 90s 超时。
        const call = registerSkillCall()
        try {
          const draft = await describeSkillDraft(llm, entry.name ?? '', raw, provider, model, (code, params) => job.push(code, params), { signal: call.signal })
          return { ok: true, value: { draft } }
        } finally {
          call.done()
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error), ...(error?.message === 'describe-timeout' ? { detail: 'timeout' } : {}) }
      }
    }

    if (endpoint === 'skills-describe-log') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      const job = describeJobs.get(typeof payload?.id === 'string' ? payload.id : '')
      return { ok: true, value: { logs: job ? [...job.logs] : [] } }
    }

    if (endpoint === 'skills-note-save') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      const description = sanitizeSkillDraftText(payload?.patch?.description, SKILL_DESCRIPTION_MAX_CHARS)
      const usage = sanitizeSkillDraftText(payload?.patch?.usage ?? '', SKILL_USAGE_MAX_CHARS)
      if (description === '') return { ok: false, error: 'invalid-description' }
      try {
        // 注释只进插件侧车索引，绝不写回技能文件；因此不要求条目可写，只要求能被签名 ID 定位。
        const { entries } = await scanSkillEntries(ctx, dshHome)
        const entry = entries.find((candidate) => candidate.id === payload?.id)
        if (entry === undefined) return { ok: false, error: 'unknown-skill' }
        const index = await serializeSkillsIndexWrite((current) => {
          current[entry.path] = {
            bodyHash: entry.bodyHash,
            note: { description, usage },
            ...(typeof payload?.model === 'string' ? { model: payload.model.slice(0, 120) } : {}),
            at: Date.now(),
          }
          return { value: current }
        })
        return { ok: true, value: { entry: publicSkillEntry({ ...entry }, index) } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-note-clear') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      try {
        const { entries } = await scanSkillEntries(ctx, dshHome)
        const entry = entries.find((candidate) => candidate.id === payload?.id)
        if (entry === undefined) return { ok: false, error: 'unknown-skill' }
        const index = await serializeSkillsIndexWrite((current) => {
          delete current[entry.path]
          return { value: current }
        })
        return { ok: true, value: { entry: publicSkillEntry(entry, index) } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-batch-plan') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      // 覆盖竞态守卫：运行中生成新计划会让在途循环错位到新清单，直接拒绝。
      if (skillsBatch !== null && (skillsBatch.running || skillsBatch.phase === 'running')) return { ok: false, error: 'batch-already-running' }
      const provider = typeof payload?.provider === 'string' ? payload.provider : ''
      const model = typeof payload?.model === 'string' ? payload.model : ''
      if (provider === '' || model === '') return { ok: false, error: 'invalid-model-route' }
      try {
        // 与单条 describe 同款白名单：批量路由必须命中 skills-models 清单。
        const llm = ctx.get('llm')
        if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
        const whitelist = await listSkillModels(llm, ctx.get('agentDefaultModel'))
        if (!whitelist.models.some((item) => item.provider === provider && item.id === model)) return { ok: false, error: 'invalid-model-route' }
        const index = await skillsIndexPromise
        const { entries } = await scanSkillEntries(ctx, dshHome)
        const { candidates, skipped } = selectSkillBatchCandidates(entries, index)
        const planId = randomUUID()
        skillsBatch = { phase: 'planned', planId, provider, model, items: candidates, total: candidates.length, done: 0, failures: [], aborted: false, running: false, current: null, logs: [], estBytes: entries.filter((entry) => candidates.some((candidate) => candidate.id === entry.id)).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) }
        return { ok: true, value: { planId, candidates, skipped, estBytes: skillsBatch.estBytes } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'skills-batch-run') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      if (skillsBatch === null || skillsBatch.planId !== payload?.planId) return { ok: false, error: 'unknown-batch-plan' }
      if (skillsBatch.running || skillsBatch.phase === 'done' || skillsBatch.phase === 'cancelled') return { ok: false, error: 'batch-already-' + (skillsBatch.running ? 'running' : skillsBatch.phase) }
      skillsBatch.phase = 'running'
      skillsBatch.running = true
      // 批量级 AbortController：取消/销毁时立即中断在途 LLM 调用（不只等当前条目自然结束）。
      const batchCall = registerSkillCall()
      // 有意不 await：批量在后台顺序执行，客户端轮询 skills-batch-status 取进度。
      void (async () => {
        // 扫描一次建立 id→条目映射；逐条只重读目标文件校验新鲜度，不再每条全量重扫五类根。
        let byId = new Map()
        try {
          const { entries } = await scanSkillEntries(ctx, dshHome)
          byId = new Map(entries.map((entry) => [entry.id, entry]))
        } catch (_) {}
        for (let cursor = 0; cursor < skillsBatch.items.length; cursor += 1) {
          const item = skillsBatch.items[cursor]
          if (skillsBatch.aborted) break
          skillsBatch.current = item.name
          const batchLog = (code, params = {}) => {
            skillsBatch.logs.push({ at: Date.now(), name: item.name, code, params })
            if (skillsBatch.logs.length > 120) skillsBatch.logs.shift()
          }
          batchLog('item-start')
          try {
            const llm = ctx.get('llm')
            if (llm === undefined) throw new Error('llm-unavailable')
            const entry = byId.get(item.id)
            if (entry === undefined || entry.invalid !== undefined) throw new Error('entry-changed')
            let raw
            try {
              raw = await readFile(entry.path, 'utf8')
            } catch (_) {
              throw new Error('entry-changed')
            }
            const evaluated = evaluateSkillFile(raw)
            if (evaluated.invalid !== undefined) throw new Error('entry-changed')
            const located = locateSkillFrontmatter(raw)
            const draft = await describeSkillDraft(llm, entry.name ?? '', raw, skillsBatch.provider, skillsBatch.model, batchLog, { signal: batchCall.signal })
            // 注释只进侧车索引：文件零改动，正文哈希取当前内容（正文再变更即自动回到待补全）。
            await serializeSkillsIndexWrite((current) => {
              current[entry.path] = { bodyHash: bodyHashOf(raw, located?.bodyStart ?? 0), note: { description: draft.description, usage: draft.usage }, model: skillsBatch.provider + '/' + skillsBatch.model, at: Date.now() }
              return {}
            })
            skillsBatch.done += 1
          } catch (error) {
            // 取消导致的失败不是条目失败：直接跳出，由循环外的 phase 落定。
            if (skillsBatch.aborted || batchCall.signal.aborted) break
            skillsBatch.failures.push({ name: item.name, reason: String(error?.message || error).slice(0, 160) })
          } finally {
            skillsBatch.current = null
          }
        }
        batchCall.done()
        skillsBatch.phase = skillsBatch.aborted || batchCall.signal.aborted ? 'cancelled' : 'done'
        skillsBatch.running = false
      })()
      return { ok: true, value: { started: true, total: skillsBatch.total } }
    }

    if (endpoint === 'skills-batch-status') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      if (skillsBatch === null) return { ok: true, value: { phase: 'idle', total: 0, done: 0, failures: [] } }
      return {
        ok: true,
        value: {
          phase: skillsBatch.phase,
          total: skillsBatch.total,
          done: skillsBatch.done,
          failures: [...skillsBatch.failures],
          current: skillsBatch.current,
          estBytes: skillsBatch.estBytes,
          logs: skillsBatch.logs.slice(-30),
        },
      }
    }

    if (endpoint === 'skills-batch-cancel') {
      if (!featureEnabled('skillManager')) return { ok: false, error: 'feature-disabled' }
      if (skillsBatch !== null) skillsBatch.aborted = true
      // 立即中断在途 LLM 调用：不等当前条目跑满 90s 超时/重试链。
      for (const call of skillsActiveControllers) {
        try { call.abort(new Error('batch-cancelled')) } catch (_) {}
      }
      return { ok: true, value: { phase: skillsBatch?.phase ?? 'idle' } }
    }

    if (endpoint === 'quota') {
      if (!featureEnabled('quotaLookup')) return { ok: false, error: 'feature-disabled' }
      try {
        const providers = readQuotaProfiles(ctx.get('settings'), ctx.get('llm'))
        quotaThrottle.prune(new Set(providers.map((profile) => profile.name)))
        const config = await refreshQuotaConfigCache()
        const allResetCards = Array.isArray(config.resetCards) ? config.resetCards : []
        const resetCardsByProvider = new Map()
        for (const card of allResetCards) {
          const bucket = resetCardsByProvider.get(card.provider) ?? []
          bucket.push(card)
          resetCardsByProvider.set(card.provider, bucket)
        }
        const requestedProviders = Array.isArray(payload?.providers)
          ? new Set(payload.providers.filter((provider) => typeof provider === 'string' && provider.length <= MAX_QUOTA_PROVIDER_NAME))
          : null
        const refreshAll = payload?.scope === 'all' || requestedProviders === null
        const rows = []
        for (const profile of providers) {
          // kind 解析优先序：配置显式 kind > 配置 null（手动停用，永不外呼）> baseURL 自动推断。
          const { kind, kindSource } = resolveQuotaKind(config, profile)
          if (kind === undefined || KIND_REGISTRY[kind] === undefined) {
            // 未适配（无 kind/已停用/白名单外且不可推断）：灰色行，宿主绝不主动外呼。
            rows.push({ provider: profile.name, displayName: profile.displayName, adapted: false })
            continue
          }
          if (refreshAll || requestedProviders.has(profile.name)) kickQuotaRefresh(profile, kind, config)
          const view = quotaThrottle.view(profile.name)
          const windows = Array.isArray(view.windows) ? view.windows : []
          const credentialClass = view.lastError === 'credential-missing' || view.lastError === 'no-base-url' || view.lastError === 'credentials-unavailable'
          const providerResetCards = resetCardsByProvider.get(profile.name) ?? []
          // 凭据填写窗口的数据源：仅对「缺凭据」的未配置行附带候选线索名的配置状态（describe 只回
          // 配置与否/来源/可写，绝不带值）；凭据服务缺席时省略字段——客户端隐藏窗口退回文案指引。
          let credentialHints
          if (credentialClass && !view.refreshing && (view.lastError === 'credential-missing' || view.lastError === 'credentials-unavailable')) {
            const credentials = ctx.get('credentials')
            if (credentials !== undefined && typeof credentials.describe === 'function') {
              const described = []
              for (const name of quotaCredentialHintNames(kind, profile)) {
                try {
                  const info = await Promise.resolve(credentials.describe(name))
                  described.push({
                    name,
                    configured: info?.configured === true,
                    ...(typeof info?.source === 'string' ? { source: info.source } : {}),
                    ...(info?.writable === false ? { writable: false } : {}),
                  })
                } catch (_) {
                  described.push({ name, configured: false })
                }
              }
              credentialHints = described
            }
          }
          rows.push({
            provider: profile.name,
            displayName: profile.displayName,
            adapted: true,
            kind,
            ...(kindSource !== undefined ? { kindSource } : {}),
            refreshing: view.refreshing,
            status: credentialClass && !view.refreshing ? 'unconfigured' : view.lastError !== undefined && windows.length === 0 ? 'error' : 'ok',
            ...(windows.length > 0 ? { windows, fetchedAt: view.fetchedAt } : {}),
            ...(view.lastError !== undefined ? { errorCode: view.lastError } : {}),
            ...(view.lastErrorDetail !== undefined ? { errorDetail: view.lastErrorDetail } : {}),
            nextAllowedAt: view.nextAllowedAt,
            ...(providerResetCards.length > 0 ? { resetCards: providerResetCards } : {}),
            ...(credentialHints !== undefined ? { credentialHints } : {}),
            // 官网用户页余额网址（宿主常量白名单随 kind 下发；无则缺省）。
            ...(typeof KIND_REGISTRY[kind].usageUrl === 'string' && KIND_REGISTRY[kind].usageUrl !== '' ? { usageUrl: KIND_REGISTRY[kind].usageUrl } : {}),
          })
        }
        return { ok: true, value: { providers: rows, serverTime: Date.now() } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'quota-refresh') {
      if (!featureEnabled('quotaLookup')) return { ok: false, error: 'feature-disabled' }
      try {
        // 手动刷新入口：provider 过白名单且 kind 已适配；清掉节流闸后立即 kick。
        // 单飞仍生效（在途时本次点击为 no-op）；上游结果经后续 quota 快照带出，不在此等待。
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        const profile = readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).find((candidate) => candidate.name === providerName)
        if (profile === undefined) return { ok: false, error: 'unknown-provider' }
        const config = await refreshQuotaConfigCache()
        const { kind } = resolveQuotaKind(config, profile)
        if (kind === undefined) return { ok: false, error: 'not-adapted' }
        const forced = quotaThrottle.force(providerName)
        if (!forced.ok) {
          if (forced.reason === 'inflight') return { ok: true }
          return { ok: false, error: forced.reason === 'cooldown' ? 'refresh-cooldown' : 'refresh-backoff', nextAllowedAt: forced.nextAllowedAt }
        }
        kickQuotaRefresh(profile, kind, config)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'quota-config') {
      if (!featureEnabled('quotaLookup')) return { ok: false, error: 'feature-disabled' }
      try {
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        // 三种写法，语义对齐配置文件解析（显式 kind > 显式 null 停用 > 自动推断）：
        // {clear:true} 删掉覆盖键回退自动推断；{kind:null} 存显式停用（baseURL 可推断也不外呼）；{kind:<name>} 指定适配。
        const profileForProvider = readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).find((candidate) => candidate.name === providerName)
        if (profileForProvider === undefined) return { ok: false, error: 'unknown-provider' }
        return await serializeQuotaConfigWrite(async (config) => {
          if (payload?.clear === true) {
            delete config.kinds[providerName]
            delete config.allowedHosts[providerName]
          } else {
            const kind = payload?.kind
            if (kind !== null && !QUOTA_KINDS.includes(kind)) return { save: false, value: { ok: false, error: 'unknown-kind' } }
            if (kind !== null && KIND_REGISTRY[kind]?.managementPlane === true) {
              // 管理面 kind：把 settings baseURL 的 host 钉进本条目（服务端派生，浏览器零输入）。
              // 外呼时复验同一张表——之后改 baseURL 必须重新保存适配才恢复外呼。
              const host = cliproxyPinHostFromBaseURL(profileForProvider.baseURL)
              if (host === undefined) {
                return { save: false, value: { ok: false, error: profileForProvider.baseURL === '' ? 'no-base-url' : 'unsafe-provider-endpoint' } }
              }
              config.allowedHosts[providerName] = [host]
            } else {
              if (kind !== null && Array.isArray(KIND_REGISTRY[kind]?.endpoints) === false && quotaEndpointFor(kind, profileForProvider.baseURL).length === 0) {
                return { save: false, value: { ok: false, error: 'unsafe-provider-endpoint' } }
              }
              // 非管理面 kind（含显式停用/清除）不保留钉住记录，避免陈旧域残留。
              delete config.allowedHosts[providerName]
            }
            config.kinds[providerName] = kind
          }
          return { value: { ok: true } }
        })
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    // 凭据填写窗口（v0.24）：面板输入密钥 → 宿主写进凭据提供方（dsh-credentials-local 即
    // $DSH_HOME/.credentials.yaml 的 refs 分节，热生效无需重启）。名字只收宿主派生的线索白名单，
    // 值只在写入方向流动——describe/快照永远不回传密钥内容。unset 供清除文件层存量。
    if (endpoint === 'quota-credential-set' || endpoint === 'quota-credential-unset') {
      if (!featureEnabled('quotaLookup')) return { ok: false, error: 'feature-disabled' }
      try {
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        const profileForProvider = readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).find((candidate) => candidate.name === providerName)
        if (profileForProvider === undefined) return { ok: false, error: 'unknown-provider' }
        const config = await refreshQuotaConfigCache()
        const { kind } = resolveQuotaKind(config, profileForProvider)
        if (kind === undefined) return { ok: false, error: 'not-adapted' }
        const name = typeof payload?.name === 'string' ? payload.name : ''
        if (!quotaCredentialHintNames(kind, profileForProvider).includes(name)) return { ok: false, error: 'unknown-hint' }
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return { ok: false, error: 'credentials-unavailable' }
        if (endpoint === 'quota-credential-set') {
          if (typeof credentials.set !== 'function') return { ok: false, error: 'credentials-unavailable' }
          // 去掉粘贴带入的首尾空白；空值与超长值在宿主侧拦下（凭据库本身也拒绝空串）。
          const value = typeof payload?.value === 'string' ? payload.value.trim() : ''
          if (value === '' || value.length > 4096) return { ok: false, error: 'invalid-value' }
          try {
            await credentials.set(name, value)
          } catch (error) {
            // 典型拒绝：进程环境层正在遮蔽该名字（describe().writable=false）——seam 契约的显式报错。
            return { ok: false, error: 'credential-write-failed', detail: sanitizeQuotaErrorDetail(error?.message) }
          }
          return { ok: true }
        }
        if (typeof credentials.unset !== 'function') return { ok: false, error: 'credentials-unavailable' }
        try {
          await credentials.unset(name)
        } catch (error) {
          return { ok: false, error: 'credential-write-failed', detail: sanitizeQuotaErrorDetail(error?.message) }
        }
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'quota-reset-card') {
      if (!featureEnabled('quotaLookup')) return { ok: false, error: 'feature-disabled' }
      try {
        // 手录重置卡（v0.19 过渡方案；v0.20 免次数、每 provider 可多条）的面板写入口：
        // provider 过宿主清单白名单；{remove:true,id} 删除宿主下发 id 对应的那一条，
        // 其余载荷为追加一条（label/expiresAt 截断限长），单 provider 上限 10 条防配置膨胀。
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        if (!readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).some((candidate) => candidate.name === providerName)) {
          return { ok: false, error: 'unknown-provider' }
        }
        return await serializeQuotaConfigWrite(async (config) => {
          const allCards = Array.isArray(config.resetCards) ? config.resetCards : []
          if (payload?.remove === true) {
            const cardId = typeof payload?.id === 'string' ? payload.id : ''
            config.resetCards = allCards.filter((card) => !(card.provider === providerName && card.id === cardId))
          } else {
            if (allCards.length >= MAX_QUOTA_RESET_CARDS || allCards.filter((card) => card.provider === providerName).length >= MAX_QUOTA_RESET_CARDS_PER_PROVIDER) {
              return { save: false, value: { ok: false, error: 'too-many-cards' } }
            }
            const card = { id: `rc-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`, provider: providerName }
            if (typeof payload?.label === 'string' && payload.label.trim() !== '') card.label = payload.label.trim().slice(0, 40)
            if (typeof payload?.expiresAt === 'string' && payload.expiresAt.trim() !== '') card.expiresAt = payload.expiresAt.trim().slice(0, 32)
            config.resetCards = [...allCards, card]
          }
          return { value: { ok: true } }
        })
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'web') {
      const activity = collectActiveWork(ctx)
      if (activity.hasActive && payload?.force !== true) {
        return { ok: false, error: 'active-work', value: activity }
      }

      scheduleRestart(ctx)
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

export {
  SKILL_SOURCE_RANK,
  apply,
  buildCliproxyAccountPlan,
  cliproxyFetchGuard,
  cliproxyPinHostFromBaseURL,
  cliproxyProjectFor,
  createQuotaThrottle,
  detectRuntimeEnv,
  evaluateSkillFile,
  extractSkillDraftJson,
  fetchCliproxyUsage,
  fetchProviderUsage,
  fixLegacySkillInvocationKeys,
  inferQuotaKind,
  inject,
  locateSkillFrontmatter,
  name,
  normalizeAntigravityModels,
  normalizeCodexRateLimit,
  normalizeDeepseekBalance,
  normalizeGeminiBuckets,
  normalizeKimiBalance,
  normalizeOpencodeUsage,
  normalizeOpenRouterCredits,
  normalizeSiliconFlowInfo,
  normalizeZaiCodingUsage,
  parseQuotaConfigText,
  parseSkillFrontmatterData,
  quotaCredentialHintNames,
  quotaEndpointFor,
  quotaErrorCode,
  readLlmProviders,
  resolveSkillInvocationState,
  runtimeEnvCheck,
  safeCliproxyOrigin,
  sanitizeSkillDraftText,
  selectSkillBatchCandidates,
  setSkillInvocationKey,
  skillIdFor,
  unwrapCliproxyApiCallEnvelope,
}
export default {
  SKILL_SOURCE_RANK,
  apply,
  buildCliproxyAccountPlan,
  cliproxyFetchGuard,
  cliproxyPinHostFromBaseURL,
  cliproxyProjectFor,
  createQuotaThrottle,
  detectRuntimeEnv,
  evaluateSkillFile,
  extractSkillDraftJson,
  fetchCliproxyUsage,
  fetchProviderUsage,
  fixLegacySkillInvocationKeys,
  inferQuotaKind,
  inject,
  locateSkillFrontmatter,
  name,
  normalizeAntigravityModels,
  normalizeCodexRateLimit,
  normalizeDeepseekBalance,
  normalizeGeminiBuckets,
  normalizeKimiBalance,
  normalizeOpencodeUsage,
  normalizeOpenRouterCredits,
  normalizeSiliconFlowInfo,
  normalizeZaiCodingUsage,
  parseQuotaConfigText,
  parseSkillFrontmatterData,
  quotaCredentialHintNames,
  quotaEndpointFor,
  quotaErrorCode,
  readLlmProviders,
  resolveSkillInvocationState,
  runtimeEnvCheck,
  safeCliproxyOrigin,
  sanitizeSkillDraftText,
  selectSkillBatchCandidates,
  setSkillInvocationKey,
  skillIdFor,
  unwrapCliproxyApiCallEnvelope,
}
