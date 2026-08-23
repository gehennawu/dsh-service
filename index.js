// Host half of @gehennawu/dsh-service
// 「服务控制」：版本信息 + 检查更新 + 一键重启 dsh web
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { constants as fsConstants, existsSync, readFileSync } from 'node:fs'
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const require = createRequire(import.meta.url)
const name = 'dsh-service'
const inject = ['connection']
const DSH_PACKAGE = '@deepseek-ai/dsh'
const PLUGIN_PACKAGE = '@gehennawu/dsh-service'
const NPM_REGISTRY = 'https://registry.npmjs.org/'
const MAX_NPM_RESPONSE_BYTES = 256 * 1024
const MAX_BACKUP_TRANSFER_BYTES = 128 * 1024 * 1024
const instanceId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
const backupIdSecret = randomBytes(32)
const BACKUP_NAME = /^dsh-backup-\d{8}-\d{6}\.tar\.gz$/
const USAGE_INDEX_VERSION = 5
const USAGE_INDEX_FILE = 'dsh-service-usage-index.json'

// 远端额度（v0.18）：kind 白名单与节律参数。节律数值只在此处与 TODO.md 里程碑两处出现。
const QUOTA_CONFIG_VERSION = 1
const QUOTA_CONFIG_FILE = 'dsh-service-quota.json'
const QUOTA_KINDS = ['opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow']
// 非 {baseURL}/usage 约定的 kind 在此登记查询端点候选链（宿主常量白名单，浏览器零输入）：
// 按序尝试；401/403 换下一候选（智谱国内/国际双域 Key 不互通），其余错误终止。
const QUOTA_ENDPOINT_OVERRIDES = {
  'zai-coding-cn': [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
  ],
  openrouter: ['https://openrouter.ai/api/v1/credits'],
  kimi: ['https://api.moonshot.cn/v1/users/me/balance'],
  siliconflow: ['https://api.siliconflow.cn/v1/user/info'],
}
// Key 发现线索（每 kind 有序候选名）：settings 声明 → DSH 凭据库 → 环境变量（含旧名兼容）。
const QUOTA_KEY_HINTS = {
  'opencode-go': ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
  'zai-coding-cn': ['ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  kimi: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
  siliconflow: ['SILICONFLOW_API_KEY'],
}
const QUOTA_UPSTREAM_TIMEOUT_MS = 15000
const QUOTA_SUCCESS_TTL_MS = 60000
const QUOTA_MIN_INTERVAL_MS = 15000
const QUOTA_BACKOFF_BASE_MS = 30000
const QUOTA_BACKOFF_MAX_MS = 15 * 60 * 1000
const MAX_QUOTA_RESPONSE_BYTES = 64 * 1024

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
  return { version: QUOTA_CONFIG_VERSION, kinds: {}, resetCards: [] }
}

/**
 * 校验手录的重置卡条目（v0.19 过渡方案：官方无 API Key 可查的端点，用户手填）。
 * provider 与数字 remaining 为必填；label/expiresAt 可选；不合格条目整条丢弃。
 */
function normalizeResetCards(raw) {
  if (!Array.isArray(raw)) return []
  const cards = []
  for (const card of raw) {
    if (card === null || typeof card !== 'object') continue
    const provider = typeof card.provider === 'string' && card.provider.trim() !== '' ? card.provider.trim() : ''
    const remaining = Number(card.remaining)
    if (provider === '' || !Number.isFinite(remaining)) continue
    const normalized = { provider, remaining: Math.max(0, Math.round(remaining)) }
    if (typeof card.label === 'string' && card.label.trim() !== '') normalized.label = card.label.trim()
    if (typeof card.expiresAt === 'string' && card.expiresAt.trim() !== '') normalized.expiresAt = card.expiresAt.trim()
    cards.push(normalized)
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
  for (const [provider, kind] of Object.entries(parsed.kinds)) {
    // null = 显式停用（即使 baseURL 可自动推断也不外呼），必须保留。
    if (typeof provider === 'string' && provider.length > 0 && (kind === null || QUOTA_KINDS.includes(kind))) kinds[provider] = kind
  }
  return { version: QUOTA_CONFIG_VERSION, kinds, resetCards: normalizeResetCards(parsed.resetCards) }
}

async function loadQuotaConfig(dshHome) {
  try {
    return parseQuotaConfigText(await readFile(join(dshHome, QUOTA_CONFIG_FILE), 'utf8'))
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
  return Object.entries(providers).map(([providerName, profile]) => ({
    name: providerName,
    displayName: typeof profile?.displayName === 'string' && profile.displayName.length > 0 ? profile.displayName : providerName,
    baseURL: typeof profile?.baseURL === 'string' ? profile.baseURL.replace(/\/+$/, '') : '',
    apiKeyEnv: typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : '',
  }))
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

/** kind → 解析器分发表；新增供应商方言时在此登记并同步 QUOTA_KINDS 白名单。
 * 窗口可选字段 remaining:true 表示 percentage 原生就是「剩余百分比」（如 MiniMax 的
 * remaining_percent）——客户端据此把头部「已用」切换为「剩余」，进度条预警阈值反向；
 * 缺省一律按已用口径处理。
 */
const QUOTA_PARSERS = {
  'opencode-go': normalizeOpencodeUsage,
  'zai-coding-cn': (payload) => normalizeZaiCodingUsage(payload),
  openrouter: normalizeOpenRouterCredits,
  kimi: normalizeKimiBalance,
  siliconflow: normalizeSiliconFlowInfo,
}

/** kind → 上游查询端点候选数组：默认 [{baseURL}/usage]，覆盖表登记的 kind 用宿主常量链。 */
function quotaEndpointFor(kind, baseURL) {
  const override = QUOTA_ENDPOINT_OVERRIDES[kind]
  return override !== undefined ? [...override] : [`${baseURL}/usage`]
}

// 自动推断规则（宿主常量）：baseURL 命中且唯一才自动适配——视为供应商自证兼容，
// 用户仍可在配置文件对该 provider 显式写 kind:null 停用。
const QUOTA_KIND_INFERENCE = [
  { kind: 'opencode-go', hosts: ['opencode.ai'] },
  { kind: 'zai-coding-cn', hosts: ['open.bigmodel.cn', 'bigmodel.cn'] },
  { kind: 'openrouter', hosts: ['openrouter.ai'] },
  { kind: 'kimi', hosts: ['moonshot.cn', 'kimi.com'] },
  { kind: 'siliconflow', hosts: ['siliconflow.cn'] },
]

/** 由 baseURL 推断 kind：恰好命中一条规则返回该 kind，否则 undefined（0 条或歧义都不猜）。 */
function inferQuotaKind(baseURL) {
  const url = String(baseURL || '').toLowerCase()
  const hits = QUOTA_KIND_INFERENCE.filter((rule) => rule.hosts.some((host) => url.includes(host)))
  return hits.length === 1 ? hits[0].kind : undefined
}

/** 百分比归一：0-1 视为小数比例，>=1 视为已是百分数；非法 → null。 */
function normalizePercentValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(100, Math.round((n <= 1 ? n * 100 : n)))
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
 * Key 发现链：settings 声明的 apiKeyEnv → DSH 凭据库按 kind 线索名 → 环境变量（含旧名兼容）。
 * 全部落空返回 undefined（调用方转为 credential-missing）。
 */
async function discoverQuotaCredential(ctx, kind, profile) {
  const hints = QUOTA_KEY_HINTS[kind] ?? []
  const attempted = []
  if (profile.apiKeyEnv !== '') attempted.push(profile.apiKeyEnv)
  for (const name of hints) {
    if (attempted.includes(name)) continue
    attempted.push(name)
  }
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    for (const name of attempted) {
      try {
        const hit = await Promise.resolve(credentials.resolve(name))
        if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') return `Bearer ${hit.value}`
      } catch (_) {}
    }
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

/** 稳定错误码提取：fetchProviderUsage 抛错时 message 即错误码（可带 :detail）。 */
function quotaErrorCode(error) {
  const raw = typeof error?.message === 'string' && error.message.length > 0 ? error.message : String(error ?? '')
  const colon = raw.indexOf(':')
  return colon === -1 ? raw : raw.slice(0, colon)
}

// 瞬时网络错误码白名单（Cloudflare/CDN 间歇断连等）：值得自动重试。
const QUOTA_TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH',
  'ENETUNREACH', 'EPIPE', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_READ_ERROR',
])

/** 单次上游 GET：15s 超时、64KB 上限、Bearer 可选。失败抛 Error（message=稳定错误码），瞬时错误带 quotaTransient 标记。 */
function fetchProviderUsageOnce(endpoint, authorization) {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (code, transient = false) => {
      if (settled) return
      settled = true
      const error = new Error(code)
      error.quotaTransient = transient
      reject(error)
    }
    const request = https.get(endpoint, {
      timeout: QUOTA_UPSTREAM_TIMEOUT_MS,
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
      fail(typeof code === 'string' && QUOTA_TRANSIENT_CODES.has(code) ? 'network-transient' : 'network',
        typeof code === 'string' && QUOTA_TRANSIENT_CODES.has(code))
    })
    request.on('timeout', () => {
      request.destroy()
      fail('timeout', true)
    })
  })
}

/** 带重试的上游 GET：仅瞬时网络错误退避重试（共 3 次尝试，300/600ms），每次尝试新建请求与超时。 */
async function fetchProviderUsage(endpoint, authorization) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt - 1)))
    try {
      return await fetchProviderUsageOnce(endpoint, authorization)
    } catch (error) {
      lastError = error
      if (error?.quotaTransient !== true) break
    }
  }
  throw lastError
}

/**
 * 每 provider 节流状态机（内存态，重启清零）。一切来源共用同一判定，优先序：
 * 单飞去重 > 失败指数退避（30s ×2 封顶 15min）> 最小上游间隔 15s > 成功 TTL 60s。
 * now 由调用方注入，测试可推进假时钟。
 */
function createQuotaThrottle(options = {}) {
  const successTtlMs = options.successTtlMs ?? QUOTA_SUCCESS_TTL_MS
  const minIntervalMs = options.minIntervalMs ?? QUOTA_MIN_INTERVAL_MS
  const backoffBaseMs = options.backoffBaseMs ?? QUOTA_BACKOFF_BASE_MS
  const backoffMaxMs = options.backoffMaxMs ?? QUOTA_BACKOFF_MAX_MS
  const entries = new Map()
  const entryOf = (provider) => {
    let entry = entries.get(provider)
    if (entry === undefined) {
      entry = { lastSuccessAt: 0, lastUpstreamAt: 0, backoffUntil: 0, failures: 0, inflight: false, windows: undefined, fetchedAt: 0, lastError: undefined, lastErrorDetail: undefined }
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
        return
      }
      entry.failures += 1
      const delay = Math.min(backoffBaseMs * 2 ** (entry.failures - 1), backoffMaxMs)
      entry.backoffUntil = now + delay
      entry.lastError = typeof outcome.code === 'string' ? outcome.code : 'unknown'
      entry.lastErrorDetail = typeof outcome.detail === 'string' && outcome.detail !== '' ? outcome.detail : undefined
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

function apply(ctx) {
  const dshHome = resolveDshHome()
  // 进程运行环境在生命周期内不变：挂载时探测一次，version RPC 与升级分支共用。
  const runtimeEnv = detectRuntimeEnv()
  const permissionPlans = new Map()
  const downloadTokens = new Map()
  let usageIndexPromise = loadUsageIndex(dshHome)
  let usageRefreshPromise
  let updateCache
  let updatePromise
  const quotaThrottle = createQuotaThrottle()
  // 远端额度：后台补拉一次。是否真的发上游由节流器判定；fire-and-forget，落定写回状态机。
  const kickQuotaRefresh = (profile, kind) => {
    const decision = quotaThrottle.attempt(profile.name)
    if (!decision.ok) return
    const parser = QUOTA_PARSERS[kind]
    Promise.resolve()
      .then(async () => {
        if (parser === undefined) throw new Error('bad-payload:kind')
        // Key 发现链：settings 声明 → 凭据库线索名 → 环境变量 → CLI 登录态；全落空即凭据缺失。
        const authorization = await discoverQuotaCredential(ctx, kind, profile)
        if (authorization === undefined) throw new Error('credential-missing')
        // 端点候选链：401/403 换下一候选（智谱双域 Key 不互通）；解析成功立即返回；
        // 200 但业务信封失败的 detail 单独保留并最终优先抛出，避免被后续候选的传输错误盖住。
        const candidates = quotaEndpointFor(kind, profile.baseURL)
        let lastError = null
        let parseFailure = null
        for (const endpoint of candidates) {
          let payload
          try {
            payload = await fetchProviderUsage(endpoint, authorization)
          } catch (error) {
            lastError = error
            if (error.message.startsWith('http-status:40') && candidates.length > 1) continue
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
              && Number(payload.code) !== 0 && typeof payload.msg === 'string' ? payload.msg : null
            parseFailure ??= Object.assign(new Error('bad-payload'), { detail: envelope ?? undefined })
            lastError = parseFailure
            continue
          }
          return parsed.windows
        }
        throw parseFailure ?? lastError ?? new Error('bad-payload')
      })
      .then((windows) => {
        quotaThrottle.settle(profile.name, { ok: true, windows })
      })
      .catch((error) => {
        quotaThrottle.settle(profile.name, {
          ok: false,
          code: quotaErrorCode(error),
          ...(typeof error?.detail === 'string' && error.detail !== '' ? { detail: error.detail } : {}),
        })
      })
  }
  ctx.effect(() => () => permissionPlans.clear(), 'dsh-service permission plans')
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
      try {
        return { ok: true, value: publicUsage(await usageIndexPromise, payload?.timezoneOffsetMinutes) }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'usage-refresh') {
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

    if (endpoint === 'backup-export') {
      try {
        const value = await exportBackup(dshHome, downloadTokens, payload?.id)
        if (value === undefined) return { ok: false, error: 'unknown-backup' }
        return { ok: true, value }
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

    if (endpoint === 'backup-restore') {
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
      try {
        const value = await importBackup(dshHome, payload?.name, payload?.data)
        if (value === undefined) return { ok: false, error: 'invalid-backup' }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'quota') {
      try {
        const providers = readLlmProviders(ctx.get('settings'))
        const config = await loadQuotaConfig(dshHome)
        const allResetCards = Array.isArray(config.resetCards) ? config.resetCards : []
        const rows = []
        for (const profile of providers) {
          // kind 解析优先序：配置显式 kind > 配置 null（手动停用，永不外呼）> baseURL 自动推断。
          let kind
          let kindSource
          if (Object.prototype.hasOwnProperty.call(config.kinds, profile.name)) {
            const configured = config.kinds[profile.name]
            if (configured === null) {
              kind = undefined
            } else if (QUOTA_PARSERS[configured] !== undefined) {
              kind = configured
              kindSource = 'config'
            }
          } else {
            const inferred = inferQuotaKind(profile.baseURL)
            if (inferred !== undefined && QUOTA_PARSERS[inferred] !== undefined) {
              kind = inferred
              kindSource = 'auto'
            }
          }
          if (kind === undefined || QUOTA_PARSERS[kind] === undefined) {
            // 未适配（无 kind/已停用/白名单外且不可推断）：灰色行，宿主绝不主动外呼。
            rows.push({ provider: profile.name, displayName: profile.displayName, adapted: false })
            continue
          }
          kickQuotaRefresh(profile, kind)
          const view = quotaThrottle.view(profile.name)
          const windows = Array.isArray(view.windows) ? view.windows : []
          const credentialClass = view.lastError === 'credential-missing' || view.lastError === 'no-base-url' || view.lastError === 'credentials-unavailable'
          const providerResetCards = allResetCards.filter((card) => card.provider === profile.name)
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
          })
        }
        return { ok: true, value: { providers: rows, serverTime: Date.now() } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'quota-config') {
      try {
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        // 三种写法，语义对齐配置文件解析（显式 kind > 显式 null 停用 > 自动推断）：
        // {clear:true} 删掉覆盖键回退自动推断；{kind:null} 存显式停用（baseURL 可推断也不外呼）；{kind:<name>} 指定适配。
        if (!readLlmProviders(ctx.get('settings')).some((candidate) => candidate.name === providerName)) {
          return { ok: false, error: 'unknown-provider' }
        }
        const config = await loadQuotaConfig(dshHome)
        if (payload?.clear === true) {
          delete config.kinds[providerName]
        } else {
          const kind = payload?.kind
          if (kind !== null && !QUOTA_KINDS.includes(kind)) return { ok: false, error: 'unknown-kind' }
          config.kinds[providerName] = kind
        }
        await saveQuotaConfig(dshHome, config)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'quota-reset-card') {
      try {
        // 手录重置卡（v0.19 过渡方案）的面板写入口：provider 过宿主清单白名单，
        // remaining 数字必填、label/expiresAt 截断限长；每个 provider 仅保留一张卡。
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        if (!readLlmProviders(ctx.get('settings')).some((candidate) => candidate.name === providerName)) {
          return { ok: false, error: 'unknown-provider' }
        }
        const config = await loadQuotaConfig(dshHome)
        const others = (Array.isArray(config.resetCards) ? config.resetCards : []).filter((card) => card.provider !== providerName)
        if (payload?.remove === true) {
          config.resetCards = others
        } else {
          const remaining = Number(payload?.remaining)
          if (!Number.isFinite(remaining) || remaining < 0) return { ok: false, error: 'invalid-remaining' }
          const card = { provider: providerName, remaining: Math.max(0, Math.round(remaining)) }
          if (typeof payload?.label === 'string' && payload.label.trim() !== '') card.label = payload.label.trim().slice(0, 40)
          if (typeof payload?.expiresAt === 'string' && payload.expiresAt.trim() !== '') card.expiresAt = payload.expiresAt.trim().slice(0, 32)
          config.resetCards = [...others, card]
        }
        await saveQuotaConfig(dshHome, config)
        return { ok: true }
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
  apply,
  createQuotaThrottle,
  detectRuntimeEnv,
  fetchProviderUsage,
  inferQuotaKind,
  inject,
  name,
  normalizeKimiBalance,
  normalizeOpenRouterCredits,
  normalizeOpencodeUsage,
  normalizeSiliconFlowInfo,
  normalizeZaiCodingUsage,
  parseQuotaConfigText,
  quotaEndpointFor,
  quotaErrorCode,
  readLlmProviders,
  runtimeEnvCheck,
}
export default {
  apply,
  createQuotaThrottle,
  detectRuntimeEnv,
  fetchProviderUsage,
  inferQuotaKind,
  inject,
  name,
  normalizeKimiBalance,
  normalizeOpenRouterCredits,
  normalizeOpencodeUsage,
  normalizeSiliconFlowInfo,
  normalizeZaiCodingUsage,
  parseQuotaConfigText,
  quotaEndpointFor,
  quotaErrorCode,
  readLlmProviders,
  runtimeEnvCheck,
}
