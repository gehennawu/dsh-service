// Host half of @gehennawu/dsh-service
// 「服务控制」：版本信息 + 检查更新 + 一键重启 dsh web
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { constants as fsConstants, existsSync, readFileSync } from 'node:fs'
import { access, chmod, cp, link, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import https from 'node:https'
import { brotliCompress, constants as zlibConstants, gzip, zstdCompress } from 'node:zlib'
import { promisify } from 'node:util'
import { ServerResponse as NodeServerResponse } from 'node:http'
import z from '@deepseek-ai/schemastery'
import { createBackupIntegrity } from './backup-integrity.js'
import { collectPluginCompat, pluginCompatCheckItem } from './plugin-compat.js'
import { collectPluginHealth, pluginCheckItem, restartPluginEntry } from './plugin-health.js'
import {
  buildCliproxyAccountPlan as buildCliproxyAccountPlanAdapter,
  cliproxyFetchGuard as cliproxyFetchGuardAdapter,
  cliproxyPinHostFromBaseURL as cliproxyPinHostFromBaseURLAdapter,
  cliproxyProjectFor as cliproxyProjectForAdapter,
  createQuotaAdapterCatalog,
  fetchCliproxyUsage as fetchCliproxyAdapterUsage,
  fetchStepFunStepPlanUsage as fetchStepFunStepPlanAdapterUsage,
  fetchXiaomiTokenPlanUsage as fetchXiaomiTokenPlanAdapterUsage,
  normalizeAntigravityModels as normalizeAntigravityModelsAdapter,
  normalizeAntigravityQuotaSummary as normalizeAntigravityQuotaSummaryAdapter,
  normalizeCodexRateLimit as normalizeCodexRateLimitAdapter,
  normalizeDeepseekBalance as normalizeDeepseekBalanceAdapter,
  normalizeGeminiBuckets as normalizeGeminiBucketsAdapter,
  normalizeKimiBalance as normalizeKimiBalanceAdapter,
  normalizeOpencodeUsage as normalizeOpencodeUsageAdapter,
  normalizeOpenRouterCredits as normalizeOpenRouterCreditsAdapter,
  normalizeSiliconFlowInfo as normalizeSiliconFlowInfoAdapter,
  normalizeStepfunBalance as normalizeStepfunBalanceAdapter,
  normalizeStepFunStepPlanUsage as normalizeStepFunStepPlanUsageAdapter,
  normalizeXiaomiTokenPlanUsage as normalizeXiaomiTokenPlanUsageAdapter,
  normalizeZaiCodingUsage as normalizeZaiCodingUsageAdapter,
  prepareQuotaAdapterConfig,
  quotaAdapterEndpoints,
  quotaAdapterUsageUrl,
  quotaErrorCode as quotaAdapterErrorCode,
  recognizeQuotaAdapter,
  safeCliproxyOrigin as safeCliproxyOriginAdapter,
  sanitizeQuotaErrorDetail as sanitizeQuotaErrorDetailAdapter,
  stepfunWebIdFromToken as stepfunWebIdFromTokenAdapter,
  unwrapCliproxyApiCallEnvelope as unwrapCliproxyApiCallEnvelopeAdapter,
  unwrapXiaomiConsoleEnvelope as unwrapXiaomiConsoleEnvelopeAdapter,
} from './quota-adapters.js'

const require = createRequire(import.meta.url)
const name = 'dsh-service'
const inject = ['connection']
const DSH_PACKAGE = '@deepseek-ai/dsh'
const PLUGIN_PACKAGE = '@gehennawu/dsh-service'
const SETTINGS_NAMESPACE = 'dsh-service'
const DEFAULT_FEATURE_SETTINGS = Object.freeze({
  healthDiagnostics: true,
  modelUsage: true,
  quotaLookup: true,
  backupMaintenance: true,
  taskNotifications: true,
  healthz: true,
  skillManager: true,
  subagentRoute: true,
  // v1.2：输入框底部常驻子代理模型累计行（独立于路由功能，可在子代理页单独关闭）。
  subagentModelsDock: true,
  // v0.31 用户点名：移动端适配默认改为关闭（需要时到插件配置卡打开）。
  mobileAdaptation: false,
  // v0.35：会话管理（查看/导出/归档/搜索/删除）。
  sessionManager: true,
})
const FeatureSettingsSchema = z.object({
  healthDiagnostics: z.boolean().default(true),
  modelUsage: z.boolean().default(true),
  quotaLookup: z.boolean().default(true),
  backupMaintenance: z.boolean().default(true),
  taskNotifications: z.boolean().default(true),
  healthz: z.boolean().default(true),
  skillManager: z.boolean().default(true),
  subagentRoute: z.boolean().default(true),
  subagentModelsDock: z.boolean().default(true),
  mobileAdaptation: z.boolean().default(false),
  sessionManager: z.boolean().default(true),
})
const NPM_REGISTRY = 'https://registry.npmjs.org/'
const MAX_NPM_RESPONSE_BYTES = 256 * 1024
const MAX_BACKUP_TRANSFER_BYTES = 256 * 1024 * 1024
const MAX_BACKUP_COMPRESSED_BYTES = 512 * 1024 * 1024
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

// 已删除会话的插件侧记录（官方无删除 API）：删除 = 删会话目录 + 记此清单，
// 供「已删除」筛选展示与归档视图过滤死条目；不存内容、不可恢复。
const SESSIONS_DELETED_VERSION = 1
const SESSIONS_DELETED_FILE = 'dsh-service-sessions-deleted.json'
const SESSIONS_VIEW_PAGE_SIZE = 100
// v0.37 搜索命中窗口：center 模式围绕命中 seq 前后各取 N 条（直接切片已缓存快照，不另 readEvent）。
const SESSIONS_VIEW_CONTEXT = 15
const SESSIONS_SEARCH_PER_SESSION_LIMIT = 5
const SESSIONS_SEARCH_TOTAL_LIMIT = 50
const SESSIONS_DELETE_PLAN_TTL_MS = 5 * 60 * 1000
// sessions-bytes 宿主缓存（v0.36 懒加载：去掉「—」占位、行体积按需拉取）：apply() 状态，
// 宿主不重启就在，浏览器刷新/面板重开直接命中不重扫。
const SESSIONS_BYTES_TTL_MS = 5 * 60 * 1000
const SESSIONS_BYTES_MAX_IDS = 200
const SESSIONS_BYTES_MAX_ENTRIES = 1000
// 详情快照缓存（v0.36 查看渲染优化）：live 会话 30s 后重读保新鲜，冷会话长期复用至槽位失效/删除。
const SESSIONS_VIEW_LIVE_TTL_MS = 30 * 1000
// 会话标题缓存（v1.1.3 列表加载优化）：0.1.2-alpha.3 的 readTitleSnapshots 经 SessionCorpus.
// projectMany → persistence.inspect 对每个冷会话全量解析整份 JSONL 日志且零官方缓存——会话一多，
// 每次 sessions-list 都是整库日志重读，远贵于体积 stat。标题按 revision（stat 指纹，跨重启稳定）
// 键控缓存：冷会话文件不变标题不变，只对新增/revision 变更/live 超时条目重读；缓存持久化到
// DSH_HOME（仅标题+revision，不含内容），宿主重启后首个列表加载同样命中。
const SESSIONS_TITLE_FILE = 'dsh-service-session-titles.json'
const SESSIONS_TITLE_VERSION = 1
const SESSIONS_TITLE_MAX_ENTRIES = 2000
const SESSIONS_TITLE_LIVE_TTL_MS = 30 * 1000
const SESSIONS_TITLE_COLD_TTL_MS = 5 * 60 * 1000
// 详情/检索里视为「机制性噪声」的事件类型：折叠展示计数，用户可展开。
const SESSION_NOISE_TYPES = new Set([
  'turn/start', 'step/start', 'step/end', 'assistant/chunk', 'request/header',
  'token/meter', 'compaction', 'session/created', 'goal/status',
])

// 远端额度（v0.18）：Adapter seam——每个具体渠道只通过统一 interface 被调用：
// {kind, recognize, credentialPolicy, fetchUsage, normalize}；新增渠道只扩充 quota-adapters.js，
// index.js 负责节流、生命周期、RPC 装配，不识别方言形状。
const QUOTA_CONFIG_VERSION = 1
const QUOTA_CONFIG_FILE = 'dsh-service-quota.json'
const QUOTA_ADAPTERS = createQuotaAdapterCatalog()
const QUOTA_ADAPTER_BY_KIND = new Map(QUOTA_ADAPTERS.map((adapter) => [adapter.kind, adapter]))
const QUOTA_KINDS = [...QUOTA_ADAPTER_BY_KIND.keys()]
const QUOTA_UPSTREAM_TIMEOUT_MS = 15000
const QUOTA_PROVIDER_DEADLINE_MS = 50 * 1000
const QUOTA_SUCCESS_TTL_MS = 60000
const QUOTA_MIN_INTERVAL_MS = 15000
const QUOTA_MANUAL_COOLDOWN_MS = 5000
const QUOTA_BACKOFF_BASE_MS = 30000
const QUOTA_BACKOFF_MAX_MS = 15 * 60 * 1000
const QUOTA_CONFIG_STAT_TTL_MS = 5000
const QUOTA_MAX_CONCURRENCY = 4
const MAX_QUOTA_RESPONSE_BYTES = 1024 * 1024
const MAX_QUOTA_CONFIG_BYTES = 256 * 1024
const MAX_QUOTA_PROVIDERS = 256
const MAX_QUOTA_PROVIDER_NAME = 128
const MAX_QUOTA_RESET_CARDS = 500
const MAX_QUOTA_RESET_CARDS_PER_PROVIDER = 10
// 子代理路由（v0.27）三态常量：inherit=不干预 / follow=读父会话最近请求路由注入 / custom=固定路由。
const SUBAGENT_ROUTE_VERSION = 1
const SUBAGENT_ROUTE_FILE = 'dsh-service-subagent-route.json'
const SUBAGENT_ROUTE_MODES = ['inherit', 'follow', 'custom']
const MAX_SUBAGENT_ROUTE_BYTES = 64 * 1024
const MAX_SUBAGENT_ROUTE_FIELD = 256
// 子代理回退（v1.1）：候选上限；「额度态不可服务」的 lastError 码集——配置/凭据/上游 4xx 类
// 「已知现在不能用」；network/timeout/5xx 等瞬态不在此列（回退要的是确定性故障而非一次抖动）。
const SUBAGENT_ROUTE_FALLBACK_MAX = 10
// 子代理派发记录（v1.2）：内存环形上限与端点单页上限。记录不落盘——宿主进程重启即清，
// 页面刷新不丢（记录在宿主内存）；客户端按 (parentSessionId, turn) 匹配回合尾行。
// 单页上限 = 环形容量：一次请求即可取回环内全部记录，客户端无需分页
// （超出环容量的记录本就被环形淘汰，不存在「静默少计」窗口）。
const SUBAGENT_DISPATCH_MAX = 400
const SUBAGENT_DISPATCH_PAGE_DEFAULT = 50
const SUBAGENT_DISPATCH_PAGE_MAX = 400
const QUOTA_UNUSABLE_ERROR_RE = /^(credential-missing|credential-rejected|credentials-unavailable|no-base-url|no-subscription|host-not-pinned|mgmt-disabled|transport-unavailable|bad-payload)/i
const QUOTA_UNUSABLE_STATUS_RE = /^(?:http-status|upstream-status):4\d\d$/i

// 升级目标白名单：命令与包名全来自宿主常量，浏览器不传任何输入；
// TARGET_RE 与 dsh-market 同源，只放行「包名@版本」字符集。
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
            alpha: normalizeTag(distTags.alpha),
          }
          const versions = [tags.latest, tags.next, tags.alpha].filter((version) => parseSemver(version) !== null)
          if (versions.length === 0) {
            fail(new Error('npm 响应中没有有效的 latest、next 或 alpha 版本'))
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
  return configured ? resolve(configured) : join(homedir(), '.dsh')
}

function formatBackupTimestamp(date) {
  const digits = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}${digits(date.getUTCMonth() + 1)}${digits(date.getUTCDate())}-${digits(date.getUTCHours())}${digits(date.getUTCMinutes())}${digits(date.getUTCSeconds())}`
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

async function backupItemForId(dshHome, id) {
  if (typeof id !== 'string' || id.length === 0) return undefined
  const snapshot = await listBackups(dshHome)
  const item = snapshot.items.find((candidate) => candidate.id === id)
  if (item === undefined) return undefined
  return { ...item, path: join(dshHome, 'backups', basename(item.name)), mtimeMs: Date.parse(item.createdAt) }
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
  let spawnArgv = [executable, ...argv]
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const shell = await subprocess.resolveExecutable('cmd.exe')
    spawnArgv = [shell, '/d', '/s', '/c', executable, ...argv]
  }
  const handle = subprocess.spawn({
    argv: spawnArgv,
    cwd,
    env: { ...process.env, TAR_OPTIONS: undefined, GZIP: undefined },
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
    const detail = stderr.trim() || outcome.signal || outcome.exitCode
    const error = new Error(/file changed|file removed|cannot stat|No such file or directory/i.test(stderr) ? 'backup-source-changed' : `tar-failed: ${detail}`)
    error.code = /file changed|file removed|cannot stat|No such file or directory/i.test(stderr) ? 'backup-source-changed' : 'tar-failed'
    throw error
  }
}

function isRetryableBackupError(error) {
  if (error?.code === 'backup-source-changed') return true
  return ['EINTR', 'ENOENT', 'EBUSY'].includes(error?.code)
}

function markBackupError(error, fallback = 'backup-failed') {
  if (error instanceof Error && typeof error.code === 'string') return error
  const wrapped = new Error(error?.message || String(error) || fallback)
  wrapped.code = fallback
  return wrapped
}

const RPC_TECHNICAL_FAILURE = Symbol('dsh-service.rpc-technical-failure')

function rpcFailure(error) {
  const normalized = markBackupError(error)
  const message = normalized.message || normalized.code || 'internal-error'
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

function rpcTechnicalFailure(error, extras = {}) {
  const result = { ...rpcFailure(error), ...extras }
  Object.defineProperty(result, RPC_TECHNICAL_FAILURE, { value: error })
  return result
}

function validateRpcPayload(payload) {
  // 兼容既有 optional-chaining 语义：无载荷与 primitive 都按空对象处理；数组/对象保留给端点 validator。
  if (payload === undefined || payload === null || (typeof payload !== 'object' && typeof payload !== 'function')) return {}
  return payload
}

function strictRpcResult(result) {
  if (result === null || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new Error('invalid-rpc-response')
  if (result.ok === true) return result
  const error = result.error
  if (
    error !== null && typeof error === 'object'
    && error.code === 'internal'
    && typeof error.message === 'string'
    && error.details !== null && typeof error.details === 'object' && !Array.isArray(error.details)
  ) return result
  return { ...result, error: rpcFailure(error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'internal-error')).error }
}

function rpcErrorMessage(result) {
  if (result?.ok !== false) return undefined
  if (typeof result.error === 'string') return result.error
  if (result.error !== null && typeof result.error === 'object' && typeof result.error.message === 'string') return result.error.message
  return 'internal-error'
}

function createRpcDispatcher({ endpoints, featureEnabled = () => true, logger, now = Date.now }) {
  const registry = new Map(Object.entries(endpoints))
  const logTechnicalError = (endpoint, error) => {
    try {
      logger?.error?.(`dsh-service: rpc technical error endpoint=${endpoint}: ${error?.stack || error?.message || String(error)}`)
    } catch (_) {}
  }
  return async (endpoint, payload) => {
    const definition = typeof endpoint === 'string' ? registry.get(endpoint) : undefined
    if (definition === undefined) return rpcFailure(new Error('unknown-endpoint'))
    const startedAt = now()
    const audit = (outcome, result) => {
      if (definition.audit !== true) return
      const code = rpcErrorMessage(result)
      try {
        logger?.info?.(`dsh-service: rpc audit endpoint=${endpoint} outcome=${outcome} durationMs=${Math.max(0, now() - startedAt)}${code === undefined ? '' : ` code=${code}`}`)
      } catch (_) {}
    }
    if (definition.feature !== undefined && !featureEnabled(definition.feature)) {
      const result = rpcFailure(new Error('feature-disabled'))
      audit('rejected', result)
      return result
    }
    let normalizedPayload
    try {
      normalizedPayload = (definition.validate ?? validateRpcPayload)(payload)
    } catch (error) {
      const result = rpcFailure(error)
      audit('rejected', result)
      return result
    }
    try {
      const result = strictRpcResult(await definition.handle(normalizedPayload, endpoint))
      const technicalError = result[RPC_TECHNICAL_FAILURE]
      if (technicalError !== undefined) logTechnicalError(endpoint, technicalError)
      audit(technicalError !== undefined ? 'failed' : result.ok ? 'ok' : 'rejected', result)
      return result
    } catch (error) {
      logTechnicalError(endpoint, error)
      const result = rpcFailure(error)
      audit('failed', result)
      return result
    }
  }
}

async function assertSafeBackupTree(path) {
  const info = await lstat(path)
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
  if (info.isFile()) return
  for (const entry of await readdir(path, { withFileTypes: true })) {
    await assertSafeBackupTree(join(path, entry.name))
  }
}

async function copyStableFile(source, target, onCopied) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await lstat(source)
    if (!before.isFile() || before.isSymbolicLink()) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
    await cp(source, target)
    const after = await lstat(source)
    if (before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs) {
      if (typeof onCopied === 'function') onCopied(before.size)
      return
    }
    await rm(target, { force: true })
  }
  throw Object.assign(new Error('backup-source-changed'), { code: 'backup-source-changed' })
}

async function copyBackupTree(source, target, onFile) {
  const info = await lstat(source)
  if (info.isSymbolicLink() || !info.isDirectory()) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
  await mkdir(target, { recursive: true, mode: 0o700 })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourceChild = join(source, entry.name)
    const targetChild = join(target, entry.name)
    const childInfo = await lstat(sourceChild)
    if (childInfo.isSymbolicLink()) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
    if (childInfo.isDirectory()) await copyBackupTree(sourceChild, targetChild, onFile)
    else if (childInfo.isFile()) await copyStableFile(sourceChild, targetChild, onFile)
    else throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
  }
}

// 备份进度的总量预估：与复制同口径的只读 stat 走树（链接/特殊文件计 0，复制阶段会拒绝）。
async function sumBackupTree(path) {
  let info
  try { info = await lstat(path) } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return info.isFile() ? info.size : 0
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) total += await sumBackupTree(join(path, entry.name))
  return total
}

// —— 会话目录持久化 seam（v0.45.1）——
// 活跃 agent 会话的 .jsonl.zstd 持续追加，文件复制 + stat 前后校验必然失败（backup-source-changed）。
// 会话读取改走 sessionPersistence 的承诺前缀 seam：readRaw 内部 stat-读-stat 自循环等待稳定窗口，
// 永不因写入失败；内容写回时按后端物理格式重编码（node:zlib 原生 zstd、校验和帧、
// 首帧=恰一行 header，与 dsh-session-persistence-jsonl 的写入布局一致）。
const zstdCompressAsync = promisify(zstdCompress)
const zstdFrameOptions = { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } }

async function compressZstdFrame(input) {
  return zstdCompressAsync(input, zstdFrameOptions)
}

// 列出持久化会话的合法归档相对路径（同步到 locate 输出的物理路径，越界即跳过）。
async function locatePersistedSessions(persistence, sessionsRoot) {
  const entries = []
  for (const snapshot of await persistence.listSnapshots()) {
    let location
    try { location = persistence.locate(snapshot.header) } catch (_) { continue }
    if (typeof location?.path !== 'string') continue
    const rel = relative(sessionsRoot, location.path)
    if (rel === '' || rel.startsWith('..') || rel.startsWith(sep) || rel.includes('\\') || /^[A-Za-z]:/.test(rel) || rel.includes('\0')) continue
    entries.push({ id: String(snapshot.header.id), path: location.path, rel })
  }
  return entries
}

// 把持久化会话写入暂存树：readRaw 稳定读取 → zstd 重编码（header 独立首帧）→ 逐会话上报进度；
// 损坏日志回退物理字节复制（旧语义：逐字节保真，由恢复后后端自行裁决）。
async function stagePersistedSessions(persistence, sessionsRoot, targetRoot, entries, onCopied) {
  for (const entry of entries) {
    const target = join(targetRoot, entry.rel)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    let content
    try {
      const raw = await persistence.readRaw(entry.id)
      content = typeof raw?.content === 'string' ? raw.content : undefined
    } catch (_) { content = undefined }
    if (content === undefined) {
      await copyStableFile(entry.path, target)
      try { const info = await stat(target); onCopied(info.size) } catch (_) {}
      continue
    }
    const newline = content.indexOf('\n')
    let encoded
    if (newline < 0) {
      encoded = await compressZstdFrame(content)
    } else {
      const header = content.slice(0, newline + 1)
      const body = content.slice(newline + 1)
      const frames = [await compressZstdFrame(header)]
      if (body.length > 0) frames.push(await compressZstdFrame(body))
      encoded = Buffer.concat(frames)
    }
    await writeFile(target, encoded, { mode: 0o600 })
    onCopied(encoded.length)
  }
}

async function publishBackupExclusively(source, target) {
  try {
    await link(source, target)
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('backup-name-collision')
    throw error
  }
  await unlink(source)
}

async function createBackupAttempt(ctx, dshHome, backupDir, name, validateArchive, onProgress = () => {}) {
  // 会话目录优先走持久化 seam（稳定读取，v0.45.1）；不可用（旧宿主/后端缺失/读取失败）时回退
  // fs.cp 整树复制 + stat 前后校验，第二次整次重试兜底，失败不发布不完整归档。
  const workspace = join(backupDir, `.staging-${randomUUID()}`)
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  const temporary = join(backupDir, `.${name}.${randomUUID()}.tmp`)
  try {
    // 进度：复制阶段按真实字节上报；打包/校验阶段上报归档体积（大小 ≈ 源字节，zstd 数据近不可压缩）。
    const sessionsSource = join(dshHome, 'sessions')
    const configNames = ['settings.yaml', 'cordis.patch.yml', 'AGENTS.md']
    let configBytes = 0
    for (const file of configNames) configBytes += await sumBackupTree(join(dshHome, file))
    let profilesBytes = 0
    const profilesRoot = join(dshHome, 'profiles')
    if (await pathExists(profilesRoot)) {
      for (const entry of await readdir(profilesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        try {
          const manifestInfo = await lstat(join(profilesRoot, entry.name, 'package.json'))
          if (manifestInfo.isFile()) profilesBytes += manifestInfo.size
        } catch (_) {}
      }
    }
    // seam 探测 + 会话条目定位（失败即整体回退文件复制）。
    const persistence = ctx.get('sessionPersistence')
    let persistedEntries
    const persistenceSeam = persistence !== undefined && persistence.supportsRawArtifacts === true
      && typeof persistence.listSnapshots === 'function' && typeof persistence.readRaw === 'function'
      && typeof persistence.locate === 'function'
    if (persistenceSeam) {
      try { persistedEntries = await locatePersistedSessions(persistence, sessionsSource) } catch (_) { persistedEntries = undefined }
    }
    let sessionsBytes = 0
    if (persistedEntries !== undefined) {
      for (const entry of persistedEntries) {
        try { const info = await lstat(entry.path); if (info.isFile()) sessionsBytes += info.size } catch (_) {}
      }
    } else if (await pathExists(sessionsSource)) sessionsBytes = await sumBackupTree(sessionsSource)
    const totalBytes = sessionsBytes + configBytes + profilesBytes
    let copiedBytes = 0
    // 快照形状恒定：任何阶段都带全部字段，客户端轮询无需按阶段判形。
    const report = (phase, archiveBytes) => onProgress({ phase, copiedBytes, totalBytes, archiveBytes })
    const onCopied = (bytes) => {
      copiedBytes += bytes
      report('copy', 0)
    }
    report('copy', 0)

    const sessionsTarget = join(workspace, 'sessions')
    if (persistedEntries !== undefined) {
      await mkdir(sessionsTarget, { recursive: true, mode: 0o700 })
      await stagePersistedSessions(persistence, sessionsSource, sessionsTarget, persistedEntries, onCopied)
    } else {
      if (await pathExists(sessionsSource)) {
        const info = await lstat(sessionsSource)
        if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
        await copyBackupTree(sessionsSource, sessionsTarget, onCopied)
      } else await mkdir(sessionsTarget, { recursive: true })
    }

    const configDir = join(workspace, 'config')
    await mkdir(configDir, { recursive: true })
    for (const file of configNames) {
      const source = join(dshHome, file)
      if (await pathExists(source)) {
        const info = await lstat(source)
        if (!info.isFile() || info.isSymbolicLink()) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
        await copyStableFile(source, join(configDir, file), onCopied)
      }
    }

    const profilesSource = join(dshHome, 'profiles')
    const profilesTarget = join(workspace, 'profiles')
    await mkdir(profilesTarget, { recursive: true })
    if (await pathExists(profilesSource)) {
      const info = await lstat(profilesSource)
      if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
      for (const entry of await readdir(profilesSource, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === '.' || entry.name === '..' || entry.name.includes('/') || entry.name.includes('\\')) continue
        const manifest = join(profilesSource, entry.name, 'package.json')
        if (!(await pathExists(manifest))) continue
        const manifestInfo = await lstat(manifest)
        if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw Object.assign(new Error('backup-source-unsafe'), { code: 'backup-source-unsafe' })
        const target = join(profilesTarget, entry.name)
        await mkdir(target, { recursive: true })
        await copyStableFile(manifest, join(target, 'package.json'), onCopied)
      }
    }

    await assertSafeBackupTree(workspace)
    onProgress({ phase: 'archive', copiedBytes, totalBytes, archiveBytes: 0 })
    // 打包阶段采样临时归档体积（500ms best-effort）：tar 结束即停；停标后完成的采样不再上报，避免阶段回跳。
    let sampling = false
    let sampleArchive = null
    try {
      sampling = true
      sampleArchive = (async () => {
        while (sampling) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          if (!sampling) break
          try {
            const info = await stat(temporary)
            if (!sampling) break
            onProgress({ phase: 'archive', copiedBytes, totalBytes, archiveBytes: info.size })
          } catch (_) {}
        }
      })()
      await runTar(ctx, workspace, ['-czf', temporary, 'sessions', 'config', 'profiles'])
    } finally {
      sampling = false
      if (sampleArchive !== null) await sampleArchive.catch(() => {})
    }
    const archiveInfo = await stat(temporary)
    if (typeof validateArchive === 'function') {
      onProgress({ phase: 'validate', copiedBytes, totalBytes, archiveBytes: archiveInfo.size })
      if (archiveInfo.size <= 0 || archiveInfo.size > MAX_BACKUP_COMPRESSED_BYTES) throw Object.assign(new Error('backup-size-limit'), { code: 'backup-size-limit' })
      const report = await validateArchive({ id: backupId(name), name, path: temporary, sizeBytes: archiveInfo.size, mtimeMs: archiveInfo.mtimeMs })
      if (report?.validForRestore !== true) {
        const issue = report?.issues?.[0]?.code
        const error = Object.assign(new Error(issue || 'backup-archive-invalid'), { code: issue || 'backup-archive-invalid' })
        throw error
      }
    }
    const finalPath = join(backupDir, name)
    if (await pathExists(finalPath)) throw new Error('backup-name-collision')
    onProgress({ phase: 'publish', copiedBytes, totalBytes, archiveBytes: archiveInfo.size })
    await publishBackupExclusively(temporary, finalPath)
    try { await chmod(finalPath, 0o600) } catch (_) {}
  } finally {
    await rm(temporary, { force: true })
    await rm(workspace, { recursive: true, force: true })
  }
}

async function createBackup(ctx, dshHome, backupDir, name, validateArchive, onProgress = () => {}) {
  const snapshot = await listBackups(dshHome)
  if (snapshot.items.some((item) => item.name === name)) throw new Error('backup-name-collision')
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await createBackupAttempt(ctx, dshHome, backupDir, name, validateArchive, onProgress)
      const result = await listBackups(dshHome)
      return { item: result.items.find((item) => item.name === name), ...result }
    } catch (error) {
      lastError = error
      if (attempt === 0 && isRetryableBackupError(error)) continue
      throw error
    }
  }
  throw lastError
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

async function importBackup(dshHome, name, encoded, validatePath) {
  if (typeof name !== 'string' || !BACKUP_NAME.test(name) || typeof encoded !== 'string' || encoded.length === 0) return undefined
  if (encoded.length > Math.ceil(MAX_BACKUP_TRANSFER_BYTES / 3) * 4 + 8 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return undefined
  const data = Buffer.from(encoded, 'base64')
  if (data.length === 0 || data.length > MAX_BACKUP_TRANSFER_BYTES || data.toString('base64') !== encoded) return undefined
  const backupDir = join(dshHome, 'backups')
  await mkdir(backupDir, { recursive: true, mode: 0o700 })
  const target = join(backupDir, basename(name))
  if (basename(name) !== name) return undefined
  const temporary = join(backupDir, `.${name}.${randomUUID()}.import`)
  if (await pathExists(target)) return undefined
  try {
    await writeFile(temporary, data, { mode: 0o600 })
    if (typeof validatePath === 'function') {
      const report = await validatePath({ id: backupId(name), name, path: temporary, sizeBytes: data.length, mtimeMs: Date.now() })
      if (report?.validForRestore !== true) throw Object.assign(new Error('backup-archive-invalid'), { code: 'backup-archive-invalid' })
    }
    if (await pathExists(target)) return undefined
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

// allowedHosts 解析：provider 键沿用 kinds 白名单形状，每家至多 4 条去重主机名；非法条目整键丢弃。
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

// 重置卡条目（v0.19 手填过渡方案：官方无 API Key 可查的端点）：provider 必填，label/expiresAt 可选；
// id 缺失时按原始位置合成稳定 id（老数据兼容），写入口生成的 id 原样保留。
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

// 运行时 llm 渠道 → Adapter.recognize 判定是否形成额度行。listProviders() 真实契约是
// [{id,name,…}] 对象数组（dsh-llm 源码核实），字符串条目仅向后兼容；渠道别名表由 Adapter 持有。
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
    const profile = { name: id, baseURL: '', apiKeyEnv: '', runtimeChannel: id }
    const adapter = recognizeQuotaAdapter(QUOTA_ADAPTERS, profile)
    if (adapter === undefined) continue
    const displayName = typeof entry === 'object' && entry !== null && typeof entry.name === 'string' && entry.name.trim() !== ''
      ? entry.name.trim().slice(0, 128)
      : id
    channels.push({ ...profile, displayName, runtimeKind: adapter.kind })
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

// opencode-go 方言 → 窗口：真实端点只有 percent 与 resetsAt（ISO），无金额字段；
// percent 一等公民，缺字段/非数字跳过该窗口，percent 截到 [0,100]。
const normalizeOpencodeUsage = normalizeOpencodeUsageAdapter

/** kind → 上游端点候选数组（兼容既有纯函数测试；事实与校验都由 Adapter 持有）。 */
function quotaEndpointFor(kind, baseURL) {
  return quotaAdapterEndpoints(QUOTA_ADAPTER_BY_KIND.get(kind), { baseURL })
}

/** 由 profile 形状唯一识别 Adapter；0 条或歧义都不猜。 */
function inferQuotaKind(baseURL) {
  return recognizeQuotaAdapter(QUOTA_ADAPTERS, { baseURL })?.kind
}

// 兼容既有公共导出：实现与配置安全事实已经归入 quota-adapters.js。
const cliproxyPinHostFromBaseURL = cliproxyPinHostFromBaseURLAdapter
const safeCliproxyOrigin = safeCliproxyOriginAdapter
const cliproxyFetchGuard = cliproxyFetchGuardAdapter

// 单 provider 的 kind 解析（quota 与 quota-refresh 共用）：
// 配置显式 kind > 配置 null（手动停用，永不外呼）> baseURL 自动推断 > 运行时渠道别名；未命中返回空对象。
function resolveQuotaKind(config, profile) {
  if (Object.prototype.hasOwnProperty.call(config.kinds, profile.name)) {
    const configured = config.kinds[profile.name]
    if (configured === null) return {}
    const adapter = QUOTA_ADAPTER_BY_KIND.get(configured)
    return adapter === undefined ? {} : { adapter, kind: adapter.kind, kindSource: 'config' }
  }
  const adapter = recognizeQuotaAdapter(QUOTA_ADAPTERS, profile)
  return adapter === undefined ? {} : { adapter, kind: adapter.kind, kindSource: 'auto' }
}

// 凭据线索与写入口策略（与发现链同序）：settings apiKeyEnv 在前、kind hints 殿后，去重。
// quota-credential-* 只收这份白名单——零输入拼接：浏览器传来的名字必须命中宿主派生清单，
// 顺带保证 CredentialRef 文法（POSIX shell 标识符）合法。
function quotaCredentialPolicy(kind, profile = {}) {
  const adapter = QUOTA_ADAPTER_BY_KIND.get(kind)
  return adapter === undefined
    ? { hints: [], entryKey: 'edit', format: (value) => `Bearer ${value}` }
    : adapter.credentialPolicy(profile)
}

function quotaCredentialHintNames(kind, profile) {
  return [...quotaCredentialPolicy(kind, profile).hints]
}

// Key 发现链：settings apiKeyEnv → 凭据库按 kind 线索名 → 环境变量（含旧名兼容）。
// 全落空 → undefined（credential-missing）；显式声明了 apiKeyEnv 却取不到 → credentials-unavailable
// （有明确意图却无处取 key，与「从未配置」区分）。
async function discoverQuotaCredential(ctx, kind, profile) {
  const policy = quotaCredentialPolicy(kind, profile)
  const attempted = [...policy.hints]
  const formatCredential = (value) => policy.format(value)
  const envHas = (name) => typeof process.env[name] === 'string' && process.env[name].trim() !== ''
  const credentials = ctx.get('credentials')
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    for (const name of attempted) {
      try {
        const hit = await Promise.resolve(credentials.resolve(name))
        if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') {
          return formatCredential(hit.value)
        }
      } catch (_) {}
    }
  } else if (profile.apiKeyEnv !== '' && !attempted.some(envHas)) {
    throw new Error('credentials-unavailable')
  }
  for (const name of attempted) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim() !== '') return formatCredential(value.trim())
  }
  return undefined
}

// 凭据可用性探测（v0.31：自动识别的 DeepSeek 行在 API KEY 未配置时整行不下发）。
// 走与真实查询相同的发现链，发现即视为配置完成；任何异常按未配置处理——调用方静默隐藏该行，
// 绝不外呼、绝不下发错误提示（进入余额查询标签页自动识别一次、失败不提示）。
async function quotaCredentialConfigured(ctx, kind, profile) {
  try {
    return typeof (await discoverQuotaCredential(ctx, kind, profile)) === 'string'
  } catch (_) {
    return false
  }
}

// zai-coding-cn（智谱 GLM Coding Plan）方言：data.limits[] 每项一个窗口。
// TOKENS_LIMIT unit:3/6 = 5h 滚动/每周 Token 窗口（unit:3 无调用时官方不返回 nextResetTime）；
// TIME_LIMIT = MCP 月度配额；id=type+unit+number 保证稳定，缺失回退 type-index。
// percentage 一等公民；绝对值字段可选且多数不下发，不造数。
// 展示序：Token 窗在前、点数次之、MCP 垫底（上游固定 TIME_LIMIT 首位，用户最关心编码 Token 窗）。
function normalizeZaiCodingUsage(payload) {
  return normalizeZaiCodingUsageAdapter(payload)
}

/** OpenRouter credits（{data:{total_credits,total_usage}}）→ 单百分比窗口。 */
function normalizeOpenRouterCredits(payload) {
  return normalizeOpenRouterCreditsAdapter(payload)
}

/** Kimi / Moonshot 余额（{available_balance:<分>}）→ 文本窗口（无总量不适合百分比）。 */
function normalizeKimiBalance(payload) {
  return normalizeKimiBalanceAdapter(payload)
}

/** SiliconFlow 用户信息（{data:{balance}}）→ 文本窗口。 */
function normalizeSiliconFlowInfo(payload) {
  return normalizeSiliconFlowInfoAdapter(payload)
}

// DeepSeek 官方余额：balance_infos 每币种一行总额，赠金>0 追加一行（granted 未过期，total 含赠金+充值）。
// currency 作 label（纯数据，多币种区分），窗口名走客户端词典（宿主不拼用户可见句子）；
// is_available 不改写金额——0 余额数字本身已说明问题，不伪造状态文案。
function normalizeDeepseekBalance(payload) {
  return normalizeDeepseekBalanceAdapter(payload)
}

// Adapter 侧金额归一：字符串/数字均可，负数/非有限/空白串拒绝——Number('') 是 0，
// 会把上游缺数据伪装成 ¥0.00；保留两位小数。
// StepFun 余额：{type, balance, total_cash_balance, total_voucher_balance} → 文本窗口。
// 控制台按人民币计费（无币种字段）；total_voucher_balance 赠金>0 追加一行（kindKey 复用 granted-balance）；
// balance 缺失/非法丢弃整条（不伪造 ¥0.00——Number('') 是 0 的坑见 normalizeDeepseekMoney 注释）。
function normalizeStepfunBalance(payload) {
  return normalizeStepfunBalanceAdapter(payload)
}

// StepFun 金额归一同款坑（官方文档 float，兼容字符串下发）：负数/非有限/空白串拒绝（Number('') 是 0）。
// ─── 小米 MiMo Token Plan（xiaomi-token-plan-cn）控制台查询 ─────────────────
// 数据源是控制台同源 API（platform.xiaomimimo.com SPA bundle 核实）：前端统一走
// `/api/v1` 前缀 + same-origin Cookie，无任何 API-key 查询端点。两个 GET 都是宿主常量，
// Cookie 凭据只发往这两个固定地址。「套餐使用情况」页 = detail（套餐名/有效期）+ usage（额度桶）。
// 控制台信封 {code,message,data} 解包：code∈{0,200} 成功（与控制台前端同一口径）；
// code=401（登录态失效）→ credential-rejected；其余非零 → bad-payload 透出 message。
function unwrapXiaomiConsoleEnvelope(payload) {
  return unwrapXiaomiConsoleEnvelopeAdapter(payload)
}

// usage.items[] → 窗口：percent(0..1 小数) ×100 截断（控制台同款 min(100,max(0,100p))），
// 缺 percent 的桶跳过（不显示假进度）；compensation_total_token 在 limit===0 时丢弃（控制台不渲染）。
// used/limit 原值随窗口下发、客户端做 K/M/B 缩写——数字不是文案，宿主不拼句子。
// detail.planName 有值 → 文本窗口置顶；currentPeriodEnd 未过期时作 resetsAt（订阅清零点，失效不挂未来时刻）。
function normalizeXiaomiTokenPlanUsage(detailData, usageData) {
  return normalizeXiaomiTokenPlanUsageAdapter(detailData, usageData)
}

// 小米 Token Plan 编排：detail + usage 两次固定 GET，Cookie 认证——查询平面与 settings baseURL
// 完全无关（无候选链、无钉住域）。credential 是裸 Cookie（容错 `Cookie:` 前缀）；
// HTTP 401/403 与信封 code:401 统一归一 credential-rejected（Cookie 失效是唯一常见故障）。
async function fetchXiaomiTokenPlanUsage({ credential, signal }) {
  return fetchXiaomiTokenPlanAdapterUsage({ credential, signal, requestJson: requestQuotaJson })
}


// ─── StepFun Step Plan（stepfun-step-plan）控制台 BFF 查询 ───────────────────
// 数据源是控制台同源 Connect-JSON BFF（platform.stepfun.com SPA bundle 核实）：方法
// POST /api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit，body {}，认证走
// Oasis-Token + Oasis-Webid 头（web_id 必须等于 token JWT 的 device_id）。无候选链、
// 无钉住域——查询平面与 settings baseURL 完全无关。
// Oasis-Webid 从 Oasis-Token 解出：device_id 在 JWT payload；`access...refresh` 对取 refresh 半（CodexBar 同款）。
function stepfunWebIdFromToken(token) {
  return stepfunWebIdFromTokenAdapter(token)
}

// QueryStepPlanRateLimit 响应 → 窗口（v0.38）。status!==1 返回空（fetcher 转 bad-payload）。
// 两代计费并存，先按形状判别：旧版 Token Plan = reset_time 有活值（>0），窗口字段 0/缺省表示
// 「无窗口未配置」而非「用光」，绝不把 0 当耗尽；新版 Credit 月池（plan_family=2）的额度在
// plan_credit_rate_limit：subscription/topup 剩余比例（0..1）+ credit_buckets（绝对 Credit 数），
// buckets 全有效按 total 加权合成一窗（CodexBar totalCreditLeftRate 同款），否则回退两比例窗；
// resetsAt 取 subscription_credit_reset_time（月池清零时刻）。
function normalizeStepFunStepPlanUsage(payload) {
  return normalizeStepFunStepPlanUsageAdapter(payload)
}

// StepFun Step Plan 编排：单次固定 POST（Connect-JSON，body {}）。credential 是裸 Oasis-Token，
// web_id 由 token 派生（无独立凭据位）。HTTP 401/403 统一归一 credential-rejected（登录态失效/
// 令牌与 web_id 不匹配是唯一常见故障）；status!==1 归 bad-payload 透出 desc；
// status==1 但无任何窗口 → no-subscription（未订阅 Step Plan）。
async function fetchStepFunStepPlanUsage({ credential, signal }) {
  return fetchStepFunStepPlanAdapterUsage({ credential, signal, requestJson: requestQuotaJson })
}


// ─── CLIProxyAPI（cliproxy）管理面编排 ──────────────────────────────────────
// 上游官方额度端点注册表（经 CPA api-call 代调，header 的 $TOKEN$ 由 CPA 替换为对应账号凭据）。
// 形状来源：muyouzhi6/astrbot_plugin_cliproxy_stats + CPA main 分支源码（2026-08 核实）；
// 全部折算成统一「已用 %」口径（remainingFraction 类字段做纯 clamp，不做 ≤1 启发式——教训见 KNOWLEDGE.md）。
// Codex rate_limit → 窗口（used_percent 已用口径；reset_at unix 秒）；secondary_window 可为 null；
// 窗口名由 limit_window_seconds 推导。
function normalizeCodexRateLimit(rateLimit) {
  return normalizeCodexRateLimitAdapter(rateLimit)
}

/** GeminiCLI retrieveUserQuota 的 buckets → 窗口（remainingFraction∈[0,1] 折算为已用 %）。 */
function normalizeGeminiBuckets(buckets) {
  return normalizeGeminiBucketsAdapter(buckets)
}

/** Antigravity fetchAvailableModels 的 models{} → 窗口（quotaInfo.remainingFraction 折算已用 %）。 */
function normalizeAntigravityModels(models) {
  return normalizeAntigravityModelsAdapter(models)
}

/** Antigravity retrieveUserQuotaSummary 的 groups[] → 窗口（池化配额已用 %）。 */
function normalizeAntigravityQuotaSummary(groups) {
  return normalizeAntigravityQuotaSummaryAdapter(groups)
}

/** api-call 信封解包：{status_code:int, body:string|object} → {statusCode, payload}。 */
function unwrapCliproxyApiCallEnvelope(envelope) {
  return unwrapCliproxyApiCallEnvelopeAdapter(envelope)
}

/** GeminiCLI project 提取：优先 auth-files 条目的 project_id 字段，回落文件名 gemini-{email}-{project}.json。 */
function cliproxyProjectFor(entry) {
  return cliproxyProjectForAdapter(entry)
}

/** auth-files 条目 → api-call 计划；不支持的类型或缺关键参数（如 project 推不出）返回 null 跳过。 */
function buildCliproxyAccountPlan(entry) {
  return buildCliproxyAccountPlanAdapter(entry)
}

// CLIProxyAPI 编排：auth-files 列账号 → 并发池逐账号 api-call 代调上游官方额度 → 合并窗口。
// 预算：账号≤8、调用≤12、并发 3、窗口≤32；部分失败不拖垮整行（有成功窗口即返回），
// 全失败抛首个稳定错误码；守卫、凭据策略与编排都由 Adapter 自己完成。
async function fetchCliproxyUsage({ profile, config, credential, signal }) {
  return fetchCliproxyAdapterUsage({ profile, config, credential, signal, requestJson: requestQuotaJson })
}

/** 稳定错误码提取：fetchProviderUsage 抛错时 message 即错误码（可带 :detail）。 */
function quotaErrorCode(error) {
  return quotaAdapterErrorCode(error)
}

function sanitizeQuotaErrorDetail(value) {
  return sanitizeQuotaErrorDetailAdapter(value)
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

// 单次 JSON 请求（GET/POST）：CLIProxyAPI 管理面专用，与 GET 版同超时/上限/瞬时错误白名单。
// options.cookie（小米控制台）：Cookie 头直发登录态，与 Authorization 互斥；
// options.headers（StepFun）：附加自定义头（宿主常量构造，浏览器零输入），放默认头之后可覆盖。
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
    const extraHeaders = options.headers !== null && typeof options.headers === 'object' ? options.headers : {}
    const request = https.request(endpoint, {
      method: options.method === 'POST' ? 'POST' : 'GET',
      timeout: QUOTA_UPSTREAM_TIMEOUT_MS,
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        'user-agent': `dsh-service/${pluginVersion} (DeepSeek Harness plugin)`,
        ...(body === '' ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
        ...(options.authorization === undefined || options.authorization === '' ? {} : { Authorization: options.authorization }),
        ...(typeof options.cookie === 'string' && options.cookie !== '' ? { Cookie: options.cookie } : {}),
        ...extraHeaders,
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

// 每 provider 节流状态机（内存态，重启清零）。一切来源共用同一判定，优先序：
// 单飞去重 > 失败指数退避（30s×2 封顶 15min）> 成功 TTL 60s > 最小上游间隔 15s（与 attempt()
// 判定序一致）；now 由调用方注入，测试可推进假时钟。
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
    /** 只读侦察（不建条目）：无状态返回 undefined——子代理回退用它过滤「额度态不可服务」候选，不污染节流表。 */
    peek(provider) {
      const entry = entries.get(provider)
      if (entry === undefined) return undefined
      return {
        refreshing: entry.inflight,
        windows: entry.windows,
        fetchedAt: entry.fetchedAt > 0 ? entry.fetchedAt : undefined,
        lastError: entry.lastError,
        lastErrorDetail: entry.lastErrorDetail,
      }
    },
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
    // 凭据/适配变更后的闸门重置（保存 key/Cookie、改适配类型时调用）：旧失败是旧配置造成的，
    // 填完就该立刻重试，不傻等最长 15min 的指数退避（GUI 反馈点名）；单飞在途不抢占。
    // 与 force() 的区别：本方法只由宿主写入口触发，可以连硬冷却一并清掉。
    resetGates(provider) {
      const entry = entryOf(provider)
      if (entry.inflight) return { ok: false, reason: 'inflight', nextAllowedAt: null }
      entry.failures = 0
      entry.backoffUntil = 0
      entry.lastManualAt = 0
      entry.lastUpstreamAt = 0
      entry.lastSuccessAt = 0
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

function validSessionOffset(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) ? value : undefined
}

// alpha.4 moves the fork cut out of SessionHeader and into body-bearing reads;
// older DSH releases expose it as header/meta.seedLength. Keep this normalization
// at the persistence seam so the usage fold never has to know which runtime spoke.
function inheritedEventCountFor(record, read) {
  const fromRead = validSessionOffset(read?.inheritedEventCount)
  if (fromRead !== undefined) return fromRead
  const fromMeta = validSessionOffset(read?.meta?.seedLength)
  if (fromMeta !== undefined) return fromMeta
  const fromHeader = validSessionOffset(record?.header?.seedLength)
  return fromHeader ?? 0
}

function usageReadStart(previous) {
  return previous === undefined ? 0 : Math.max(0, previous.lastSeq + 1)
}

function usageReadEvents(read) {
  return Array.isArray(read?.events) ? read.events : []
}

function foldUsageEvents(ctx, record, previous, events, inheritedEventCount = 0) {
  const project = projectForCwd(ctx, record.header.cwd)
  const cut = validSessionOffset(inheritedEventCount) ?? 0
  const session = previous || { revision: '', lastSeq: cut - 1, project, currentModel: null, hours: {} }
  session.project = project
  for (const event of events) {
    if (event.seq < cut) continue
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
    const fromSeq = usageReadStart(previous)
    const read = await persistence.readFrom(record.header.id, fromSeq)
    const inheritedEventCount = inheritedEventCountFor(record, read)
    const next = foldUsageEvents(ctx, record, previous, usageReadEvents(read), inheritedEventCount)
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

  // v1.3 插件健康检查：只检查异常——loader 缺席降级为 info 检查项、不带异常行数组；
  // 停用条目（无论内置/自定义）一律不算异常，正常插件不下发（官方设置页已有完整清单与开关）。
  let pluginReport
  try {
    pluginReport = await collectPluginHealth(ctx)
  } catch (error) {
    pluginReport = { available: false, total: 0, issues: [] }
  }
  if (!pluginReport.available) add('plugins', 'info', 'unavailable')
  else {
    const pluginCheck = pluginCheckItem(pluginReport)
    if (pluginCheck.status === 'info') pluginCheck.advisory = true
    checks.push(pluginCheck)
  }

  // v1.3 插件兼容性：对照已核实的 alpha 破坏面清单（client-runtime 供应商移除、SQLite
  // persistence 移除、聊天/统计条 CSS 哈希漂移、data-time-hover-root 删除）扫描启用插件的
  // 清单与入口代码；loader 缺席降级为 info 检查项、不带扫描结果。
  let compatReport
  try {
    compatReport = await collectPluginCompat(ctx)
  } catch (error) {
    compatReport = { available: false, scanned: 0, issues: [], declaredOnly: [], unknown: [] }
  }
  if (!compatReport.available) add('plugin-compat', 'info', 'unavailable')
  else checks.push(pluginCompatCheckItem(compatReport))

  let status = 'ok'
  // advisory 警告（手动启动环境的黄色提示）只做行内呈现：不把 overall 拉成 warning。
  if (checks.some((check) => check.status === 'error')) status = 'error'
  else if (checks.some((check) => check.status === 'warning' && check.advisory !== true)) status = 'warning'
  return {
    status,
    checkedAt: Date.now(),
    checks,
    ...(pluginReport.available ? { pluginIssues: pluginReport.issues } : {}),
    ...(compatReport.available
      ? { pluginCompat: { scanned: compatReport.scanned, issues: compatReport.issues, declaredOnly: compatReport.declaredOnly, unknown: compatReport.unknown } }
      : {}),
  }
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

// 保守解析 frontmatter 顶层字段：只承诺管理动作需要的简单标量；块标量/嵌套结构归 complex
// （展示用拼接文本），绝不假装理解完整 YAML——官方解析器若因复杂结构得出不同结论，
// 条目会以 invalid 或只读形态出现，不会误写。
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

// 启停开关：model → 规范键 disable-model-invocation（禁用行值 true）；user → user-invocable（禁用行值 false）。
// enable=true 删键行（缺席即允许），enable=false 原位写入或改值。
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

/** 批量候选：非 invalid、非遮蔽；未注释或正文已变的进候选，已注释（正文未变）单列待确认覆盖。 */
function selectSkillBatchCandidates(entries, index) {
  const candidates = []
  const annotated = []
  const skipped = []
  for (const entry of entries) {
    if (entry.invalid !== undefined) skipped.push({ id: entry.id, name: entry.name ?? '', reason: entry.invalid })
    else if (entry.shadowed === true) skipped.push({ id: entry.id, name: entry.name, reason: 'shadowed' })
    else {
      const record = index[entry.path]
      if (record?.note !== undefined && record.bodyHash === entry.bodyHash) annotated.push({ id: entry.id, name: entry.name, source: entry.source })
      else candidates.push({ id: entry.id, name: entry.name, source: entry.source })
    }
  }
  return { candidates, annotated, skipped }
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

// 补全输出语言白名单：只认 'zh'，其余一切输入（含缺省/伪造）一律按 'en' 处理——
// 与 DSH locale 服务的 en 兜底语义一致；语言是枚举开关，浏览器永远送不进自由文本。
function normalizeSkillDescribeLang(value) {
  return value === 'zh' ? 'zh' : 'en'
}

function skillDescribeSystemPrompt(lang) {
  // 输出语言跟随 DSH 界面语言（客户端下发 effective locale 枚举）：中文环境出简体中文，
  // 英文环境出英文；无论哪种，都不跟随技能正文自身的语言。
  const languageRule = lang === 'zh'
    ? '"description" and "whenToUse" MUST be written in Simplified Chinese regardless of the skill body language'
    : '"description" and "whenToUse" MUST be written in English regardless of the skill body language'
  return [
    'You write catalog metadata for agent-harness skills.',
    'Reply with STRICT JSON only, no markdown fences, no extra keys, no commentary:',
    '{"description":"...","whenToUse":"..."}',
    'Rules: ' + languageRule + '; "description" is ONE routing sentence (max ' + SKILL_DESCRIPTION_MAX_CHARS + ' characters) saying what the skill does and when to pick it; "whenToUse" is short usage guidance (max ' + SKILL_USAGE_MAX_CHARS + ' characters); never use line breaks inside either value.',
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
      system: skillDescribeSystemPrompt(normalizeSkillDescribeLang(options.lang)),
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
      const text = await collectLlmText(llm, { provider, model, prompt, onEvent, maxTokens: SKILL_DESCRIBE_MAX_TOKENS * Math.pow(4, attempt), signal: options.signal, lang: options.lang })
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

// 适配器私有 reasoning metadata → 可下发 JSON：efforts 只留 id/name/非空 description，去重保序；
// defaultEffort 非空才保留；无效则 undefined——绝不把适配器内部对象或函数发到 Web。
function publicSubagentReasoning(reasoning) {
  if (reasoning === null || typeof reasoning !== 'object') return undefined
  const source = Array.isArray(reasoning.efforts) ? reasoning.efforts : []
  const efforts = []
  const seen = new Set()
  for (const entry of source) {
    if (entry === null || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' ? entry.id : ''
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const name = typeof entry.name === 'string' && entry.name !== '' ? entry.name : id
    const description = typeof entry.description === 'string' && entry.description !== '' ? entry.description : undefined
    efforts.push(description !== undefined ? { id, name, description } : { id, name })
  }
  const defaultEffort = typeof reasoning.defaultEffort === 'string' && reasoning.defaultEffort !== '' ? reasoning.defaultEffort : undefined
  if (efforts.length === 0 && defaultEffort === undefined) return undefined
  return { ...(efforts.length > 0 ? { efforts } : {}), ...(defaultEffort !== undefined ? { defaultEffort } : {}) }
}

// 子代理模型清单：沿用 skills-models 的 provider/model 白名单口径，为每个模型附加
// publicSubagentReasoning 裁剪的 reasoning metadata；resolveModelInfo 缺席或单模型解析失败
// 时保留原有目录项（不让整个快照失败）。
async function listSubagentModels(llm, agentDefaultModel) {
  const catalog = await listSkillModels(llm, agentDefaultModel)
  const resolve = llm !== undefined && typeof llm.resolveModelInfo === 'function'
    ? (provider, model) => llm.resolveModelInfo(provider, model)
    : null
  const models = []
  for (const item of catalog.models) {
    let reasoning
    if (resolve !== null) {
      try {
        const info = await resolve(item.provider, item.id)
        const publicReasoning = info !== null && typeof info === 'object' ? publicSubagentReasoning(info.reasoning) : undefined
        if (publicReasoning !== undefined) reasoning = publicReasoning
      } catch (_) {}
    }
    models.push(reasoning !== undefined ? { ...item, reasoning } : item)
  }
  return { ...catalog, models }
}

/** 子代理路由配置的空档（inherit）：与未安装本功能的原生行为完全一致。 */
function createEmptySubagentRoute() {
  return { version: SUBAGENT_ROUTE_VERSION, mode: 'inherit' }
}

/** 解析磁盘上的子代理路由配置：损坏/版本不符/未知模式回退 inherit（零侵入，不因坏配置破坏派生）。 */
function parseSubagentRouteText(text) {
  const fallback = createEmptySubagentRoute()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (_) {
    return fallback
  }
  if (parsed?.version !== SUBAGENT_ROUTE_VERSION || !SUBAGENT_ROUTE_MODES.includes(parsed.mode)) return fallback
  // 回退列表（v1.1）custom/follow 共用：逐条 trim+截断、剔除空字段与重复路由（同 provider+model 只留首个）。
  const fallbacks = []
  if (Array.isArray(parsed.fallbacks)) {
    for (const entry of parsed.fallbacks) {
      if (fallbacks.length >= SUBAGENT_ROUTE_FALLBACK_MAX) break
      if (entry === null || typeof entry !== 'object') continue
      const provider = typeof entry.provider === 'string' ? entry.provider.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD) : ''
      const model = typeof entry.model === 'string' ? entry.model.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD) : ''
      if (provider === '' || model === '') continue
      const reasoningEffort = typeof entry.reasoningEffort === 'string' ? entry.reasoningEffort.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD) : ''
      if (fallbacks.some((item) => item.provider === provider && item.model === model)) continue
      fallbacks.push({ provider, model, ...(reasoningEffort !== '' ? { reasoningEffort } : {}) })
    }
  }
  if (parsed.mode === 'inherit') return { version: SUBAGENT_ROUTE_VERSION, mode: parsed.mode }
  if (parsed.mode !== 'custom') {
    return fallbacks.length > 0
      ? { version: SUBAGENT_ROUTE_VERSION, mode: parsed.mode, fallbacks }
      : { version: SUBAGENT_ROUTE_VERSION, mode: parsed.mode }
  }
  const provider = typeof parsed.provider === 'string' ? parsed.provider.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD) : ''
  const model = typeof parsed.model === 'string' ? parsed.model.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD) : ''
  if (provider === '' || model === '') return fallback
  // reasoningEffort 是可选的 adapter 自有等级 ID：只有字符串、trim 后非空才保留（空串视为默认）。
  const reasoningEffort = typeof parsed.reasoningEffort === 'string' ? parsed.reasoningEffort.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD) : ''
  return { version: SUBAGENT_ROUTE_VERSION, mode: 'custom', provider, model, ...(reasoningEffort !== '' ? { reasoningEffort } : {}), ...(fallbacks.length > 0 ? { fallbacks } : {}) }
}

async function loadSubagentRoute(dshHome) {
  try {
    const target = join(dshHome, SUBAGENT_ROUTE_FILE)
    const info = await stat(target)
    if (info.size > MAX_SUBAGENT_ROUTE_BYTES) return createEmptySubagentRoute()
    return parseSubagentRouteText(await readFile(target, 'utf8'))
  } catch (_) {
    return createEmptySubagentRoute()
  }
}

async function saveSubagentRoute(dshHome, config) {
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, SUBAGENT_ROUTE_FILE)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(config), { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

// 额度态「不可服务」判定（子代理回退候选过滤用）：lastError 命中配置/凭据/上游 4xx 码集，
// 或任一显示窗口 percent≥100（已用尽）。无数据 / 刷新中 / 瞬态错误视为可用——fail-open，
// 不因额度数据缺席或一次网络抖动误伤正常渠道。
function quotaProviderUnusable(view) {
  if (view === undefined || view === null) return false
  if (view.refreshing === true) return false
  if (typeof view.lastError === 'string' && view.lastError !== '') {
    if (QUOTA_UNUSABLE_ERROR_RE.test(view.lastError) || QUOTA_UNUSABLE_STATUS_RE.test(view.lastError)) return true
  }
  if (Array.isArray(view.windows)) {
    for (const window of view.windows) {
      if (window !== null && typeof window === 'object' && typeof window.percent === 'number' && window.percent >= 100) return true
    }
  }
  return false
}

// 子代理派生注入（seam 核心，纯函数便于测试）：
// - 请求已显式携带 provider/model → 不干预（显式永远赢，含预设钉死与其他插件注入）；
// - custom → 候选序 = [配置路由, ...回退]；follow → [父会话最新路由, ...回退]；inherit → 无候选；
// - 取第一个「llm 注册表可路由 且 额度态可用」的候选注入；全不可用 → undefined（回落原生继承，
//   不让派生失败）。options.note 用于宿主侧记录跳过原因（main 日志调试用）。
function resolveSubagentInjection(request, config, options = {}) {
  const agentOptions = request?.agentOptions
  const explicitProvider = typeof agentOptions?.provider === 'string' && agentOptions.provider !== ''
  const explicitModel = typeof agentOptions?.model === 'string' && agentOptions.model !== ''
  if (explicitProvider || explicitModel) return undefined
  const candidates = []
  if (config?.mode === 'follow') {
    let header
    try {
      header = options.readParentHeader?.(request?.parent)
    } catch (_) {
      header = undefined
    }
    if (typeof header?.provider === 'string' && header.provider !== '' && typeof header?.model === 'string' && header.model !== '') {
      candidates.push({ provider: header.provider, model: header.model })
    }
  } else if (config?.mode === 'custom' && typeof config.provider === 'string' && config.provider !== '' && typeof config.model === 'string' && config.model !== '') {
    const reasoningEffort = typeof config.reasoningEffort === 'string' && config.reasoningEffort !== '' ? config.reasoningEffort : undefined
    candidates.push({ provider: config.provider, model: config.model, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) })
  }
  // 回退只属于 follow/custom：inherit 保持零干预（磁盘解析也会丢弃，这里是纯函数层的纵深防御）。
  if ((config?.mode === 'follow' || config?.mode === 'custom') && Array.isArray(config?.fallbacks)) {
    for (const entry of config.fallbacks) {
      if (entry === null || typeof entry !== 'object') continue
      const provider = typeof entry.provider === 'string' ? entry.provider : ''
      const model = typeof entry.model === 'string' ? entry.model : ''
      if (provider === '' || model === '') continue
      const reasoningEffort = typeof entry.reasoningEffort === 'string' && entry.reasoningEffort !== '' ? entry.reasoningEffort : undefined
      candidates.push({ provider, model, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) })
    }
  }
  for (const candidate of candidates) {
    if (options.isRoutable !== undefined && !options.isRoutable(candidate.provider)) {
      options.note?.(`${candidate.provider}/${candidate.model} skipped (not routable)`)
      continue
    }
    if (typeof options.isQuotaHealthy === 'function' && options.isQuotaHealthy(candidate.provider) === false) {
      options.note?.(`${candidate.provider}/${candidate.model} skipped (quota-unusable)`)
      continue
    }
    return candidate
  }
  return undefined
}

// ── 子代理派发记录（v1.2）：创建时「实际生效路由」快照 ────────────────────────
// 数据面三态：routed=插件注入 / inherited=父会话最近请求路由 / default=agent-default-model。
// 纯函数便于测试；错误一律 fail-closed——记录失败绝不影响子代理派生本体。

/** 子代理派发记录：childId 去重键 + 生效路由 + 父会话创建时所在回合。 */
function buildSubagentDispatchRecord(agent, parent, dispatch, options = {}) {
  const childId = agent?.id
  const parentId = parent?.session?.id
  if (typeof childId !== 'string' || childId === '' || typeof parentId !== 'string' || parentId === '') return undefined
  const providedProvider = typeof dispatch?.provider === 'string' && dispatch.provider !== '' ? dispatch.provider : undefined
  const providedModel = typeof dispatch?.model === 'string' && dispatch.model !== '' ? dispatch.model : undefined
  const providedSource = providedProvider !== undefined && providedModel !== undefined ? (dispatch?.source === 'explicit' ? 'explicit' : 'routed') : undefined
  const reasoningEffort = typeof dispatch?.reasoningEffort === 'string' && dispatch.reasoningEffort !== '' ? dispatch.reasoningEffort : undefined
  let provider = providedProvider
  let model = providedModel
  let source = providedSource
  if (source === undefined) {
    let header
    try {
      header = options.readParentHeader?.(parent)
    } catch (_) {
      header = undefined
    }
    if (typeof header?.provider === 'string' && header.provider !== '' && typeof header?.model === 'string' && header.model !== '') {
      provider = header.provider
      model = header.model
      source = 'inherited'
    }
  }
  if (source === undefined) {
    let selection
    try {
      selection = options.readDefaultSelection?.()
    } catch (_) {
      selection = undefined
    }
    if (typeof selection?.provider === 'string' && selection.provider !== '' && typeof selection?.model === 'string' && selection.model !== '') {
      provider = selection.provider
      model = selection.model
      source = 'default'
    }
  }
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return undefined
  const record = { childId, parentId, provider, model, source, at: Date.now() }
  let turn
  try {
    turn = lastSubagentTurn(parent, options.scanLimit)
  } catch (_) {
    turn = undefined
  }
  if (typeof turn === 'number' && Number.isFinite(turn)) record.turn = turn
  if (reasoningEffort !== undefined) record.reasoningEffort = reasoningEffort
  return record
}

/** 父会话事件尾向上扫最近一条带数字 `data.turn` 的事件（≤scanLimit 条）；无则 undefined。 */
function lastSubagentTurn(parent, scanLimit = 50) {
  let events
  try {
    if (typeof parent?.session?.snapshotEvents === 'function') events = parent.session.snapshotEvents()
  } catch (_) {
    events = undefined
  }
  if (!Array.isArray(events)) {
    try { events = parent?.session?.events } catch (_) { events = undefined }
  }
  if (!Array.isArray(events)) return undefined
  const limit = Number.isFinite(scanLimit) && scanLimit > 0 ? scanLimit : 50
  const from = Math.max(0, events.length - limit)
  for (let index = events.length - 1; index >= from; index -= 1) {
    const data = events[index]?.data
    if (data !== null && typeof data === 'object' && typeof data.turn === 'number' && Number.isFinite(data.turn)) return data.turn
  }
  return undefined
}

/** 派发记录环形容器：childId 去重、超限丢最旧。返回是否新插入。 */
function pushSubagentDispatchRecord(ring, record, max = SUBAGENT_DISPATCH_MAX) {
  const order = ring.order
  const byChild = ring.byChild
  if (order.length >= max && !byChild.has(record.childId)) {
    const oldest = order.shift()
    if (oldest !== undefined) byChild.delete(oldest)
  }
  if (byChild.has(record.childId)) return false
  byChild.set(record.childId, record)
  order.push(record.childId)
  return true
}

/** 只读过滤：按父会话/回合截取 newest-first 页面。 */
function listSubagentDispatches(ring, payload = {}) {
  const parentId = typeof payload?.parentId === 'string' && payload.parentId !== '' ? payload.parentId : undefined
  const turn = typeof payload?.turn === 'number' && Number.isFinite(payload.turn) ? payload.turn : undefined
  const limit = Math.min(
    SUBAGENT_DISPATCH_PAGE_MAX,
    typeof payload?.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0 ? Math.floor(payload.limit) : SUBAGENT_DISPATCH_PAGE_DEFAULT,
  )
  const records = []
  const order = ring.order
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const record = ring.byChild.get(order[index])
    if (record === undefined) continue
    if (parentId !== undefined && record.parentId !== parentId) continue
    if (turn !== undefined && record.turn !== turn) continue
    records.push(record)
    if (records.length >= limit) break
  }
  return records
}


// ── 移动端适配·宿主半（v0.30）：大 JSON 响应透明压缩 ─────────────────────────
// 长会话的 history JSON 可达数十 MB，手机网络下首屏极慢。给 http.ServerResponse.prototype
// 打补丁：JSON 响应延迟到 end 收尾，按请求 Accept-Encoding 选 br > gzip 异步压缩；
// 小体积与其他 content-type 字节级透传。插件卸载或功能关闭时经 disposer 还原原型。
// 设计边界：ndjson / event-stream 这类增量流即使带 json 字样也绝不缓冲；
// 不经 writeHead 显式带头对象的响应（statusCode + setHeader、Node 隐式头）识别不到，
// 一律透传。

/** 不值得压缩的下限：更小的 JSON 按原始头字节级回放。 */
const MOBILE_COMPRESS_MIN_BYTES = 4 * 1024
/** 超过该体积跳过压缩：避免「原文 + 压缩结果」双份内存尖峰。 */
const MOBILE_COMPRESS_MAX_BYTES = 64 * 1024 * 1024
const MOBILE_BROTLI_QUALITY = 5
const MOBILE_GZIP_LEVEL = 6

// content-type 是否值得走延迟压缩：JSON 且非增量流。
function isCompressibleJsonType(contentType) {
  const value = String(contentType ?? '').toLowerCase()
  if (!value.includes('json')) return false
  // ndjson / event-stream 是持续增量流，整体缓冲会破坏消费语义。
  return !value.includes('ndjson') && !value.includes('event-stream')
}

// Accept-Encoding 选编解码器：br 优先于 gzip；都不接受返回 null（透传）。
function pickCompressionEncoding(acceptEncoding) {
  const accepted = String(acceptEncoding ?? '').toLowerCase()
  if (/\bbr\b/.test(accepted)) return 'br'
  if (/\bgzip\b/.test(accepted)) return 'gzip'
  return null
}

// ── 会话管理（v0.35）：查看/导出/归档/搜索/删除 ─────────────────────────
// 官方能力边界见 AGENTS.md「会话管理官方能力全貌」：官方有 sessionQuery（listSessions/
// readTitleSnapshots/filterSessions/filterEvents 文本谓词）、workspaceRegistry.archiveSession、
// /api/session.export；官方 sqlite 全文搜索默认禁用（openAt:never）；官方无会话删除 API。
// 本插件的搜索走 filterEvents 语义文本谓词（不依赖 sqlite）；删除 = 删会话目录 + 插件侧
// 已删除清单（不动官方存储，残留 archivedSessionIds 死 id 无 UI 影响）。

/** 已删除会话清单：{version, items: [{id, title, cwd, deletedAt}]} */
function createEmptyDeletedSessions() {
  return { version: SESSIONS_DELETED_VERSION, items: [] }
}

async function loadDeletedSessions(dshHome) {
  try {
    const parsed = JSON.parse(await readFile(join(dshHome, SESSIONS_DELETED_FILE), 'utf8'))
    if (parsed?.version !== SESSIONS_DELETED_VERSION || !Array.isArray(parsed.items)) return createEmptyDeletedSessions()
    return { version: SESSIONS_DELETED_VERSION, items: parsed.items.filter((item) => item && typeof item.id === 'string') }
  } catch (_) {
    return createEmptyDeletedSessions()
  }
}

async function saveDeletedSessions(dshHome, data) {
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, SESSIONS_DELETED_FILE)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

// 标题缓存磁盘持久化：{version, items: {id: {title, revision?, live}}}——只存标题与指纹，
// 不含任何会话内容；损坏/版本不符整体丢弃（回退全量拉取，宁慢勿错）。at 不落盘：
// 加载后按 0 处理，revision 对不上或缺失时自然判定过期重读。
function createEmptySessionTitles() {
  return { version: SESSIONS_TITLE_VERSION, items: {} }
}

async function loadSessionTitles(dshHome) {
  try {
    const parsed = JSON.parse(await readFile(join(dshHome, SESSIONS_TITLE_FILE), 'utf8'))
    if (parsed?.version !== SESSIONS_TITLE_VERSION || typeof parsed.items !== 'object' || parsed.items === null) return new Map()
    const entries = new Map()
    for (const [id, entry] of Object.entries(parsed.items)) {
      if (typeof id !== 'string' || id === '') continue
      if (typeof entry?.title !== 'string' || typeof entry.revision !== 'string') continue
      entries.set(id, { title: entry.title, revision: entry.revision, live: entry.live === true, at: 0 })
    }
    return entries
  } catch (_) {
    return new Map()
  }
}

async function saveSessionTitles(dshHome, cache) {
  const items = {}
  for (const [id, entry] of cache) {
    if (typeof entry?.title !== 'string') continue
    items[id] = { title: entry.title, ...(typeof entry.revision === 'string' ? { revision: entry.revision } : {}), live: entry.live === true }
  }
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, SESSIONS_TITLE_FILE)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ version: SESSIONS_TITLE_VERSION, items }), { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** 单个会话的事件文本（与官方 extractSessionEventText 语义一致，不依赖官方内部包）。 */
function sessionEventText(event) {
  if (typeof event !== 'object' || event === null) return ''
  const data = event.data
  if (typeof data !== 'object' || data === null) return ''
  const joinText = (parts) => parts
    .filter((part) => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
  const blockText = (block) => {
    if (typeof block !== 'object' || block === null) return []
    switch (block.type) {
      case 'text': return typeof block.text === 'string' ? [block.text] : []
      case 'tool-call': return [block.name, block.arguments]
      case 'tool-result': return Array.isArray(block.content) ? block.content.flatMap(blockText) : []
      case 'reasoning':
      case 'image':
      default: return []
    }
  }
  const contentText = (content) => joinText(Array.isArray(content) ? content.flatMap(blockText) : [])
  const turnEndText = (reason) => {
    switch (reason?.kind) {
      case 'error': return joinText(['error', reason.error?.message])
      case 'aborted': return 'aborted'
      case 'max-tokens':
      case 'interrupted': return reason.kind
      case 'completed':
      default: return ''
    }
  }
  switch (event.type) {
    case 'user/message': return contentText(data.content)
    case 'assistant/message': return contentText(data.message?.content)
    case 'tool/call': return joinText([data.name, data.arguments])
    case 'tool/result': return joinText([contentText(data.message?.content), data.error?.name, data.error?.code])
    case 'todo/write': return joinText(Array.isArray(data.todos) ? data.todos.flatMap((todo) => [todo.status, todo.content]) : [])
    case 'turn/end': return turnEndText(data.reason)
    default: return ''
  }
}

/** 会话目录大小（字节）；会话档案或定位缺失时返回 null。 */
async function sessionDirectoryBytes(ctx, header) {
  try {
    const sessionPersistence = ctx.get('sessionPersistence')
    const location = sessionPersistence?.locate?.(header)
    const dir = typeof location?.path === 'string' ? dirname(location.path) : undefined
    if (dir === undefined) return null
    let total = 0
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) continue
      try {
        const info = await stat(join(dir, entry.name))
        total += info.isFile() ? info.size : 0
      } catch (_) {}
    }
    return total
  } catch (_) {
    return null
  }
}

// 标题缓存条目是否仍新鲜：有 revision 源（sessionPersistence.listSnapshots 可用）时按指纹
// 精确判定——文件没变标题就不变，冷会话永久命中；快照清单里缺席的 id（纯内存 live 会话）
// 及 revision 源不可用时按 TTL 兜底。宁重读不展示旧标题。
function sessionTitleFresh(entry, record, revisions, now) {
  if (entry === undefined) return false
  if (revisions !== null) {
    const revision = revisions.get(record.header.id)
    if (revision !== undefined) return entry.revision === revision
    return now - entry.at < SESSIONS_TITLE_LIVE_TTL_MS
  }
  const ttl = record.live === true ? SESSIONS_TITLE_LIVE_TTL_MS : SESSIONS_TITLE_COLD_TTL_MS
  return now - entry.at < ttl
}

// 会话管理列表：live + 冷会话合并，标注归档/已删除，补标题。列表不携带体积——
// 体积走 sessions-bytes 懒加载（v0.36：全量下发意味着打开/切换就要逐个 readdir+stat）。
// v1.1.3：readTitleSnapshots 对每个冷会话全量解析整份日志（官方零缓存），改为 revision
// 键控缓存——列表加载只对新增/变更条目重读，重复加载/面板重开零整库扫描；listing 与
// 已删除清单并行获取。
async function listSessionsForManage(ctx, dshHome, scope = 'all', titleCache = null) {
  const sessionQuery = ctx.get('sessionQuery')
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const available = sessionQuery !== undefined && typeof sessionQuery.listSessions === 'function'
  if (!available) {
    return { available: false, items: [], archivedIds: [], deleted: [] }
  }
  if (scope === 'deleted') {
    return { available: true, items: [], archivedIds: [], deleted: (await loadDeletedSessions(dshHome)).items }
  }
  const now = Date.now()
  // revision 源：缓存启用时尽早并行拉取（一次 header-only 目录遍历 + 每会话一次 stat，
  // 与 listSessions 内部同量级）；不可用/失败回落 null → TTL 兜底。
  const sessionPersistence = titleCache !== null ? ctx.get('sessionPersistence') : undefined
  const revisionsPromise = sessionPersistence !== undefined && typeof sessionPersistence.listSnapshots === 'function'
    ? sessionPersistence.listSnapshots().then((snapshots) => {
      const revisions = new Map()
      for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        if (typeof snapshot?.header?.id === 'string' && typeof snapshot.revision === 'string') revisions.set(snapshot.header.id, snapshot.revision)
      }
      return revisions
    }).catch(() => null)
    : Promise.resolve(null)
  const [records, deletedSnapshot] = await Promise.all([
    sessionQuery.listSessions(),
    loadDeletedSessions(dshHome),
  ])
  const deleted = deletedSnapshot.items
  const revisions = await revisionsPromise
  const archivedIds = workspaceRegistry !== undefined && Array.isArray(workspaceRegistry.archivedSessionIds)
    ? [...workspaceRegistry.archivedSessionIds]
    : []
  const archivedSet = new Set(archivedIds)
  const deletedSet = new Set(deleted.map((item) => item.id))
  // scope=archived 只保留归档条目（含 live 会话被归档的情况）；此时仍需标题。
  const recordsInScope = scope === 'archived'
    ? records.filter((record) => archivedSet.has(record.header.id))
    : records
  // 标题折叠（缓存优先）：只重读新增/revision 变更/live 超时的条目；fulfilled 才入缓存
  //（rejected 留空且不缓存，下次自动重试）。缓存条目按插入序 LRU 式淘汰封顶。
  const staleRecords = []
  if (titleCache !== null) {
    for (const record of recordsInScope) {
      if (deletedSet.has(record.header.id)) continue
      if (!sessionTitleFresh(titleCache.get(record.header.id), record, revisions, now)) staleRecords.push(record)
    }
  } else {
    for (const record of recordsInScope) {
      if (!deletedSet.has(record.header.id)) staleRecords.push(record)
    }
  }
  const titles = new Map()
  if (typeof sessionQuery.readTitleSnapshots === 'function' && staleRecords.length > 0) {
    const observed = await sessionQuery.readTitleSnapshots(staleRecords.map((record) => record.header.id))
    for (const entry of observed) {
      if (entry?.sessionId !== undefined && entry?.status === 'fulfilled' && entry.value?.title?.title !== undefined) {
        titles.set(entry.sessionId, entry.value.title.title)
      }
    }
    if (titleCache !== null) {
      const recordById = new Map(staleRecords.map((record) => [record.header.id, record]))
      for (const [id, title] of titles) {
        const record = recordById.get(id)
        if (record === undefined) continue
        titleCache.set(id, { title, revision: revisions !== null ? revisions.get(id) : undefined, at: now, live: record.live === true })
      }
      while (titleCache.size > SESSIONS_TITLE_MAX_ENTRIES) {
        const oldest = titleCache.keys().next().value
        if (oldest === undefined) break
        titleCache.delete(oldest)
      }
      // 落盘随 RPC 收敛（不留在 Fiber 外）：仅本次确实重读过标题才写，原子替换 0600。
      if (titles.size > 0) {
        try { await saveSessionTitles(dshHome, titleCache) } catch (_) {}
      }
    }
  }
  const items = []
  for (const record of recordsInScope) {
    const id = record.header.id
    if (deletedSet.has(id)) continue
    items.push({
      id,
      title: titles.get(id) ?? (titleCache !== null ? titleCache.get(id)?.title : undefined) ?? '',
      cwd: record.header.cwd ?? null,
      createdAt: record.header.createdAt ?? 0,
      live: record.live === true,
      persisted: record.persisted === true,
      archived: archivedSet.has(id),
    })
  }
  items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return { available: true, items, archivedIds, deleted }
}

// 批量取会话体积（sessions-bytes 用）：命中缓存秒回、不碰磁盘；未命中再做一次
// listSessions 定位 + 目标目录 stat。缓存键=会话 id（live 体积随增长变化，TTL 兜底、
// 删除主动失效）；未知会话返回 null（不缓存，列表里本就不该出现）。
async function resolveSessionBytesForIds(ctx, ids, cache) {
  const bytes = {}
  const misses = []
  const now = Date.now()
  for (const id of ids) {
    const hit = cache.get(id)
    if (hit !== undefined && now - hit.at < SESSIONS_BYTES_TTL_MS) bytes[id] = hit.bytes
    else misses.push(id)
  }
  if (misses.length === 0) return bytes
  const sessionQuery = ctx.get('sessionQuery')
  let headerById = null
  if (sessionQuery !== undefined && typeof sessionQuery.listSessions === 'function') {
    headerById = new Map()
    try {
      for (const record of await sessionQuery.listSessions()) {
        if (record?.header?.id !== undefined) headerById.set(record.header.id, record.header)
      }
    } catch (_) {
      headerById = null
    }
  }
  // 未命中目录 stat 并发执行（8 路封顶）：首个列表加载的 stat 风暴从串行排队压成小批并行。
  const SESSIONS_BYTES_STAT_CONCURRENCY = 8
  let statCursor = 0
  const statWorkers = Array.from({ length: Math.min(SESSIONS_BYTES_STAT_CONCURRENCY, misses.length) }, async () => {
    while (statCursor < misses.length) {
      const id = misses[statCursor++]
      const header = headerById === null ? undefined : headerById.get(id)
      if (header === undefined) {
        bytes[id] = null
        continue
      }
      const value = await sessionDirectoryBytes(ctx, header)
      cache.set(id, { bytes: value, at: Date.now() })
      if (cache.size > SESSIONS_BYTES_MAX_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      bytes[id] = value
    }
  })
  await Promise.all(statWorkers)
  return bytes
}

// 分页读取会话事件：readSession 全量后按 seq 游标切片，单槽位宿主缓存（v0.36：冷会话
// 文件不变长期复用、live 会话 30s TTL 兜底新鲜度）；v0.37 center 模式忽略 cursor，围绕命中
// seq ±SESSIONS_VIEW_CONTEXT 条窗口（命中行不一定居中，被行首/行尾裁剪），回传实际 centerSeq，
// nextCursor 指向窗口末条可继续翻页。
async function viewSessionPage(ctx, id, cursor, cacheRef, limit = SESSIONS_VIEW_PAGE_SIZE, center) {
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined || typeof sessionQuery.readSession !== 'function') return { ok: false, error: 'session-query-unavailable' }
  const live = sessionIsLive(ctx, id)
  const hit = cacheRef !== null && cacheRef.id === id && cacheRef.snapshot !== null && (!cacheRef.live || Date.now() - cacheRef.at < SESSIONS_VIEW_LIVE_TTL_MS)
  let snapshot
  if (hit) {
    snapshot = cacheRef.snapshot
  } else {
    try {
      snapshot = await sessionQuery.readSession(id)
    } catch (error) {
      if (error?.code === 'SESSION_QUERY_NOT_FOUND' || /not found/i.test(String(error?.message || error))) return { ok: false, error: 'session-not-found' }
      return { ok: false, error: error?.message || String(error) }
    }
    // 单槽位：详情同一时刻只浏览一个会话，直接整槽替换；live 只对当前快照记 live 标志。
    cacheRef.id = id
    cacheRef.snapshot = snapshot
    cacheRef.at = Date.now()
    cacheRef.live = live
  }
  const events = Array.isArray(snapshot.events) ? snapshot.events : []
  const total = events.length
  let start
  let centerSeq
  if (center !== undefined && Number.isSafeInteger(center) && total > 0) {
    // v0.37 命中窗口：以命中 seq 为中心前后各 SESSIONS_VIEW_CONTEXT 条；越界 seq 钳制到
    // 事件范围，centerSeq 回传钳制后的实际位置（客户端按它定位/高亮）。
    const clampedCenter = Math.min(Math.max(Number(center), 0), total - 1)
    start = Math.max(0, clampedCenter - SESSIONS_VIEW_CONTEXT)
    limit = Math.min(total, clampedCenter + SESSIONS_VIEW_CONTEXT + 1) - start
    centerSeq = clampedCenter
  } else {
    if (cursor === undefined) {
      start = 0
    } else {
      const nextIndex = events.findIndex((event) => Number(event.seq) > Number(cursor))
      start = nextIndex === -1 ? total : nextIndex
    }
  }
  const slice = events.slice(start, start + limit)
  const items = slice.map((event) => {
    const seq = Number(event.seq)
    const isNoise = SESSION_NOISE_TYPES.has(event.type)
    return {
      seq,
      type: event.type,
      time: typeof event.time === 'number' ? event.time : undefined,
      text: sessionEventText(event),
      noise: isNoise,
    }
  })
  const lastSeq = items.length > 0 ? items[items.length - 1].seq : (cursor ?? -1)
  return {
    ok: true,
    value: {
      session: {
        id: snapshot.session?.id ?? id,
        title: undefined,
        cwd: snapshot.session?.cwd ?? null,
        createdAt: snapshot.session?.createdAt ?? 0,
      },
      items,
      nextCursor: lastSeq < total - 1 ? lastSeq : undefined,
      total,
      ...(centerSeq !== undefined ? { centerSeq } : {}),
    },
  }
}

// 内容搜索：逐会话 filterEvents 文本谓词（语义、大小写不敏感、空白灵活），带预算约束。
async function searchSessionsContent(ctx, dshHome, query, scope = 'all', titleCache = null) {
  const sessionQuery = ctx.get('sessionQuery')
  const result = { available: sessionQuery !== undefined && typeof sessionQuery.filterEvents === 'function', query, scope, hits: [] }
  if (!result.available) return result
  const q = typeof query === 'string' ? query.trim() : ''
  if (q === '') return result
  const listed = await listSessionsForManage(ctx, dshHome, 'all', titleCache)
  if (!listed.available) return result
  // scope=all 搜全部会话（含 live，readSession/filterEvents 均支持 live 快照）；archived 只搜归档冷会话。
  const targets = scope === 'archived'
    ? listed.items.filter((item) => item.archived && !item.live)
    : listed.items
  const scopeSet = new Set(targets.map((item) => item.id))
  const titleById = new Map(listed.items.map((item) => [item.id, item.title]))
  let total = 0
  for (const item of targets) {
    if (total >= SESSIONS_SEARCH_TOTAL_LIMIT) break
    let docs
    try {
      const filters = [{ kind: 'text', text: q }]
      docs = await sessionQuery.filterEvents(item.id, filters)
    } catch (_) {
      continue
    }
    const remaining = SESSIONS_SEARCH_TOTAL_LIMIT - total
    const bounded = (Array.isArray(docs) ? docs : []).slice(0, Math.min(SESSIONS_SEARCH_PER_SESSION_LIMIT, remaining))
    if (bounded.length === 0) continue
    result.hits.push({
      sessionId: item.id,
      title: titleById.get(item.id) ?? '',
      items: bounded.map((doc) => ({
        seq: Number(doc.seq),
        type: doc.type,
        snippet: typeof doc.snippet === 'string' ? doc.snippet : typeof doc.text === 'string' ? doc.text : sessionEventText(doc),
      })),
    })
    total += bounded.length
  }
  return result
}

/** 会话是否存在（live 或 persistence）；缺失返回 false。 */
async function sessionExists(ctx, id) {
  const sessions = ctx.get('sessions')
  if (sessions?.get?.(id) !== undefined) return true
  const sessionQuery = ctx.get('sessionQuery')
  try {
    const record = (await sessionQuery.listSessions()).find((entry) => entry.header?.id === id)
    return record !== undefined
  } catch (_) {
    return false
  }
}

/** 会话当前是否 live（运行中，删除必须拒绝）。 */
function sessionIsLive(ctx, id) {
  return ctx.get('sessions')?.get?.(id) !== undefined
}

/** 定位一个持久化会话的目录（供删除）。 */

// 轻量定位单个会话（sessions-delete-plan 用）：一次 listSessions 找 header + 一次 stat 目标
// 目录，不扫其他会话；返回删除确认清单记录（title/cwd/bytes/archived/live/dir）。
async function resolveSessionForDelete(ctx, id) {
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined || typeof sessionQuery.listSessions !== 'function') return undefined
  const records = await sessionQuery.listSessions()
  const found = records.find((entry) => entry.header?.id === id)
  if (found === undefined) return undefined
  const header = found.header
  const sessionPersistence = ctx.get('sessionPersistence')
  const location = sessionPersistence?.locate?.(header)
  if (typeof location?.path !== 'string') return undefined
  const dir = dirname(location.path)
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const archived = workspaceRegistry !== undefined && Array.isArray(workspaceRegistry.archivedSessionIds) && workspaceRegistry.archivedSessionIds.includes(id)
  // 标题：readTitleSnapshots 单查（存在时）；失败留空（删除确认清单的标题尽力而为）。
  let title = ''
  if (typeof sessionQuery.readTitleSnapshots === 'function') {
    try {
      const observed = await sessionQuery.readTitleSnapshots([id])
      if (observed[0]?.status === 'fulfilled' && observed[0].value?.title?.title !== undefined) title = observed[0].value.title.title
    } catch (_) {}
  }
  return {
    id,
    title,
    cwd: header.cwd ?? null,
    bytes: await sessionDirectoryBytes(ctx, header),
    archived,
    live: sessionIsLive(ctx, id),
    dir,
  }
}

// 向既有 Vary 值追加 token；已有（大小写不敏感）则原样返回。
function appendVaryToken(existing, token) {
  const current = existing === null || existing === undefined ? '' : String(existing)
  if (current.toLowerCase().includes(token.toLowerCase())) return current
  return current === '' ? token : `${current}, ${token}`
}

// zlib 异步压缩完整 body（不阻塞事件循环）。
function compressBodyAsync(body, encoding) {
  return new Promise((resolvePromise, rejectPromise) => {
    const settle = (error, result) => (error ? rejectPromise(error) : resolvePromise(result))
    if (encoding === 'br') {
      brotliCompress(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: MOBILE_BROTLI_QUALITY } }, settle)
    } else {
      gzip(body, { level: MOBILE_GZIP_LEVEL }, settle)
    }
  })
}

// 把 write/end 缓冲期收到的 chunk 归一化为 Buffer 追加进 pending。
function bufferPendingChunk(pending, chunk, encoding) {
  if (chunk === null || chunk === undefined) return
  if (Buffer.isBuffer(chunk)) pending.chunks.push(chunk)
  else if (ArrayBuffer.isView(chunk)) pending.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  else if (typeof chunk === 'string') pending.chunks.push(Buffer.from(chunk, encoding || 'utf8'))
  else pending.chunks.push(Buffer.from(String(chunk)))
}

// 解析 Node write/end 的可选参数序列（encoding 字符串 / callback）。
function parseStreamRestArgs(rest) {
  const parsed = { callbacks: [] }
  for (const item of rest) {
    if (typeof item === 'string') parsed.encoding = item
    else if (typeof item === 'function') parsed.callbacks.push(item)
  }
  return parsed
}

// 以暂存的原始实参回放 writeHead（透传路径：头集合与调用方所写完全一致）。
function replayStoredWriteHead(res, originalWriteHead, storedArgs) {
  if (storedArgs.length === 0) return originalWriteHead.call(res, 200)
  return originalWriteHead.apply(res, storedArgs)
}

// 回放 writeHead，但把头集合替换为压缩路径的最终头对象。
function replayStoredWriteHeadWithHeaders(res, originalWriteHead, storedArgs, headers) {
  const args = storedArgs.slice()
  if (typeof args[1] === 'string') args[2] = headers
  else args[1] = headers
  return originalWriteHead.apply(res, args)
}

// 安装大 JSON 响应透明压缩补丁。进程内单例：重复安装返回既有 disposer。
function installMobileResponseCompression() {
  const proto = NodeServerResponse.prototype
  // 已装补丁的守卫放在 ensure 层；此处仍做二次防御，避免测试直调时叠加。
  if (proto.writeHead?.name === 'mobileCompressWriteHead') return () => {}
  const originalWriteHead = proto.writeHead
  const originalWrite = proto.write
  const originalEnd = proto.end

  /** @type {WeakMap<import('node:http').ServerResponse, object>} 每响应延迟状态，仅 JSON 响应收尾前存在。 */
  const pendingByResponse = new WeakMap()

  function mobileCompressWriteHead(...args) {
    try {
      const headerArg = typeof args[1] === 'string' ? args[2] : args[1]
      // 只有「显式携带头对象」的 writeHead 才考虑延迟：Node 的隐式头路径
      // (_implicitHeader → writeHead(statusCode)) 也走这里，若延迟会让原始
      // end 在未发头的 socket 上直写 body，破坏线上的帧结构。
      // setHeader 风格的响应因此保持透传（fail-open）。
      if (headerArg === undefined || headerArg === null || typeof headerArg !== 'object') {
        return originalWriteHead.apply(this, args)
      }
      // 判定用头集合 = 当前已 setHeader 的 + 本次 writeHead 实参里的（后者覆盖前者），
      // 让「setHeader 后再 writeHead(200, {…})」这类写法也能被识别。
      const merged = { ...this.getHeaders(), ...headerArg }
      const encoding = pickCompressionEncoding(this.req?.headers?.['accept-encoding'])
      if (
        encoding === null ||
        merged['content-encoding'] !== undefined ||
        !isCompressibleJsonType(merged['content-type'])
      ) return originalWriteHead.apply(this, args)
      // 延迟收尾：先不发头、不落盘，等 end 时按实际体积决定压缩还是原样回放。
      pendingByResponse.set(this, { writeHeadArgs: args.slice(), chunks: [], encoding })
      return this
    } catch (_) {
      // 判定阶段的任何意外都退回透传，不影响宿主原有响应行为。
      return originalWriteHead.apply(this, args)
    }
  }

  function mobileCompressWrite(chunk, ...rest) {
    const pending = pendingByResponse.get(this)
    if (pending === undefined) return originalWrite.call(this, chunk, ...rest)
    const { encoding, callbacks } = parseStreamRestArgs(rest)
    bufferPendingChunk(pending, chunk, encoding)
    // 缓冲期的 write 回调立即以成功触发：这些 JSON 路由无人依赖背压/drain 时序，
    // 与其让调用方挂在一个永不触发的回调上，不如语义上视作「已接收」。
    for (const callback of callbacks) {
      try { callback(null) } catch (_) {}
    }
    return true
  }

  function mobileCompressEnd(chunk, ...rest) {
    const pending = pendingByResponse.get(this)
    if (pending === undefined) {
      return chunk === undefined
        ? originalEnd.apply(this, rest)
        : originalEnd.call(this, chunk, ...rest)
    }
    pendingByResponse.delete(this)
    if (chunk !== undefined) bufferPendingChunk(pending, chunk, parseStreamRestArgs(rest).encoding)
    const [endCallback] = parseStreamRestArgs(rest).callbacks
    const body = Buffer.concat(pending.chunks)

    // 透传收尾：原始 writeHead 实参 + 原始 body，字节级等价于未打补丁的行为。
    const finishPassthrough = () => {
      replayStoredWriteHead(this, originalWriteHead, pending.writeHeadArgs)
      if (body.length === 0) return originalEnd.call(this, endCallback)
      return originalEnd.call(this, body, endCallback)
    }

    if (body.length < MOBILE_COMPRESS_MIN_BYTES || body.length > MOBILE_COMPRESS_MAX_BYTES) return finishPassthrough()

    // 最终头集合 = 已 setHeader 的 + 暂存 writeHead 实参里的（后者覆盖前者，符合
    // Node writeHead 语义）。注意补丁延迟了原始 writeHead，getHeaders() 里不会有
    // 实参头的身影，必须显式并进来；writeHead 之后又 setHeader 的路径同样兼容。
    const storedHeaderArg = typeof pending.writeHeadArgs[1] === 'string' ? pending.writeHeadArgs[2] : pending.writeHeadArgs[1]
    const finalHeaders = {
      ...this.getHeaders(),
      ...(storedHeaderArg && typeof storedHeaderArg === 'object' ? storedHeaderArg : {}),
    }
    if (!isCompressibleJsonType(finalHeaders['content-type'])) return finishPassthrough()

    finalHeaders['content-encoding'] = pending.encoding
    delete finalHeaders['content-length']
    finalHeaders.vary = appendVaryToken(finalHeaders.vary, 'Accept-Encoding')

    compressBodyAsync(body, pending.encoding).then((compressed) => {
      finalHeaders['content-length'] = compressed.length
      replayStoredWriteHeadWithHeaders(this, originalWriteHead, pending.writeHeadArgs, finalHeaders)
      originalWrite.call(this, compressed)
      originalEnd.call(this, endCallback)
    }, finishPassthrough)
    return this
  }

  proto.writeHead = mobileCompressWriteHead
  proto.write = mobileCompressWrite
  proto.end = mobileCompressEnd
  return () => {
    if (proto.writeHead === mobileCompressWriteHead) proto.writeHead = originalWriteHead
    if (proto.write === mobileCompressWrite) proto.write = originalWrite
    if (proto.end === mobileCompressEnd) proto.end = originalEnd
  }
}

let activeMobileCompressionDispose = null

// 单例入口：确保补丁处于安装状态，返回独立托管 disposer——任一包装释放都会真正还原补丁
// 并清掉单例标记，后续再 ensure 会重新安装（绝不出现「标记还在、补丁已摘」的假活状态）。
function ensureMobileResponseCompression() {
  if (activeMobileCompressionDispose === null) activeMobileCompressionDispose = installMobileResponseCompression()
  const inner = activeMobileCompressionDispose
  let released = false
  return () => {
    if (released || activeMobileCompressionDispose === null) return
    released = true
    activeMobileCompressionDispose = null
    inner()
  }
}


// quota-credential-set / quota-credential-unset 共用处理器：两个端点只差「写/清」一步，
// provider 白名单、kind 解析与 hint 校验全同——单一实现防止双份拷贝漂移。
async function quotaCredentialEndpoint(ctx, refreshQuotaConfig, throttle, payload, rpcEndpoint) {
  try {
    const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
    const profileForProvider = readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).find((candidate) => candidate.name === providerName)
    if (profileForProvider === undefined) return { ok: false, error: 'unknown-provider' }
    const config = await refreshQuotaConfig()
    const { kind } = resolveQuotaKind(config, profileForProvider)
    if (kind === undefined) return { ok: false, error: 'not-adapted' }
    const name = typeof payload?.name === 'string' ? payload.name : ''
    if (!quotaCredentialHintNames(kind, profileForProvider).includes(name)) return { ok: false, error: 'unknown-hint' }
    const credentials = ctx.get('credentials')
    if (credentials === undefined) return { ok: false, error: 'credentials-unavailable' }
    if (rpcEndpoint === 'quota-credential-set') {
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
      // 新凭据落库即清掉该 provider 的退避/冷却闸门：旧失败是旧凭据造成的，
      // 客户端紧随其后的 quota-refresh 应立刻发上游，而不是干等退避走完。
      throttle.resetGates(providerName)
      return { ok: true }
    }
    if (typeof credentials.unset !== 'function') return { ok: false, error: 'credentials-unavailable' }
    try {
      await credentials.unset(name)
    } catch (error) {
      return { ok: false, error: 'credential-write-failed', detail: sanitizeQuotaErrorDetail(error?.message) }
    }
    throttle.resetGates(providerName)
    return { ok: true }
  } catch (error) {
    return rpcTechnicalFailure(error)
  }
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
  let backupOperation = Promise.resolve()
  const withBackupLock = (operation) => {
    const current = backupOperation.then(operation, operation)
    backupOperation = current.catch(() => {})
    return current
  }
  // 备份创建进度快照（v0.45）：单飞（withBackupLock 串行）所以单对象足够；一律整体替换字段。
  const backupProgress = { active: false }
  const setBackupProgress = (value) => {
    for (const key of Object.keys(backupProgress)) delete backupProgress[key]
    Object.assign(backupProgress, { active: true, ...value })
  }
  const clearBackupProgress = () => {
    for (const key of Object.keys(backupProgress)) delete backupProgress[key]
    backupProgress.active = false
  }
  const backupIntegrity = createBackupIntegrity({
    dshHome,
    resolveBackup: (id) => backupItemForId(dshHome, id),
    getActiveWork: () => collectActiveWork(ctx),
    isEnabled: () => featureEnabled('backupMaintenance'),
    runtimeEnv,
    previousInstanceId: instanceId,
    scheduleRestart: () => scheduleRestart(ctx),
  })
  // 会话管理（v0.35）：删除两段式计划（planId → {id, path, bytes}），TTL 过期自动驱逐。
  const sessionDeletePlans = new Map()
  // 会话体积懒加载缓存（v0.36）：宿主进程不重启就一直在——浏览器刷新/面板重开直接命中，
  // 不用重新 readdir+stat（归档冷会话体积不变；live 会话靠 TTL 兜底、删除时主动失效）。
  const sessionBytesCache = new Map()
  // 会话标题缓存（v1.1.3）：revision 键控 + 磁盘持久化，宿主启动即异步预加载，
  // 首个 sessions-list 前等待填充完成（失败静默回落全量拉取）。
  const sessionTitleCache = new Map()
  const sessionTitlesReady = loadSessionTitles(dshHome).then((entries) => {
    for (const [id, entry] of entries) sessionTitleCache.set(id, entry)
  }).catch(() => {})
  // 会话详情快照缓存（v0.36）：单槽位只留最近打开的会话，翻页零重复 readSession。
  const sessionViewCache = { id: null, snapshot: null, at: 0, live: false }
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
  // ── 子代理路由（v0.27）：三态配置 + subagents seam ─────────────────────
  // 内存态即 seam 读取的事实源：保存端点落盘成功后原地替换，派生路径零读盘。
  let subagentRouteConfig = createEmptySubagentRoute()
  const subagentRouteLoadPromise = Promise.resolve().then(async () => {
    subagentRouteConfig = await loadSubagentRoute(dshHome)
  })
  // 配置写串行化（quota-config 同款）：所有写先等首次加载完成再从同一内存快照复制，
  // 避免与启动加载竞态把磁盘回退成 inherit。
  let subagentRouteWrites = Promise.resolve()
  const serializeSubagentRouteWrite = (work) => {
    const result = subagentRouteWrites.then(async () => {
      await subagentRouteLoadPromise
      const current = { ...subagentRouteConfig }
      const outcome = await work(current)
      if (outcome?.save === false) return outcome.value
      await saveSubagentRoute(dshHome, current)
      subagentRouteConfig = current
      return outcome.value
    })
    subagentRouteWrites = result.then(() => undefined, () => undefined)
    return result
  }
  // seam 是否已挂上（宿主 subagents 服务存在时由下面的 inject 置真）：快照端点据此告知客户端。
  let subagentSeamInstalled = false
  // 子代理派发记录环（v1.2）：apply 级持有，RPC 端点与 seam 共同读写（seam 写入、端点只读）。
  const dispatchRing = { order: [], byChild: new Map() }
  // 只包装宿主 subagents 注册表的两个入口（start / startContinuable，spawn/fork/acp 全走这
  // 两个口）：未显式指定模型的派生按配置注入 agentOptions，其余原样透传。Fiber 销毁还原
  // 原方法——包装挂在服务实例上，disposer 期间新派生恢复原生行为。
  ctx.inject(['subagents'], (scope) => {
    const subagents = scope.subagents
    if (subagents === undefined || typeof subagents.start !== 'function' || typeof subagents.startContinuable !== 'function') return
    const isRoutable = (provider) => {
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.listProviders !== 'function') return false
      try {
        return llm.listProviders().some((entry) => entry?.id === provider)
      } catch (_) {
        return false
      }
    }
    const readParentHeader = (parent) => parent?.session?.requestHeader?.()?.config
    // reasoningEffort 不属于 AgentOptions，不能塞进 subagents.start() 的 options。
    // 用 AsyncLocalStorage 把「本次创建上下文」带进同步派发的 agent/created 监听器（v1.2：
    // 载荷 = 注入路由（有则）+ 父 agent 引用；记录构建与既有 effort 绑定都从这里取）：
    // - effort 绑定：WeakMap<agent, target> 绑定到该 child；agent/request waterfall 在最终
    //   proposal 阶段补入。绑定是一次性的：首个请求结算后即消费（无论补标成功与否），之后交给
    //   请求自身/会话内状态，避免官方模型选择装配层刻意剥离继承值后我们在后续请求上反复复活旧等级。
    // - 派发记录：childId → {provider, model, reasoningEffort?, source, turn, at} 环形快照，
    //   供客户端对话页「回合尾子代理模型行」读取（subagent-dispatches 端点）。
    const pendingDispatchStorage = new AsyncLocalStorage()
    const managedEfforts = new WeakMap()
    const isSubagentManaged = (agent) => agent !== null && typeof agent === 'object' && managedEfforts.has(agent)
    // 运行时等级复审缓存：`${provider}\u0000${model}` → Promise<Set<supportedIds> | null>。
    // null 表示无法判定（resolveModelInfo 缺席/失败/中止），按 fail-open 放行保持原行为；
    // 只有「证实不支持」才丢弃。Promise 共享以合并并发派生的重复查询；结果仅在 fiber 存续期内有效。
    const effortSupportCache = new Map()
    const resolveSupportedEfforts = (provider, model, signal) => {
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.resolveModelInfo !== 'function') return null
      const key = `${provider}\u0000${model}`
      let cached = effortSupportCache.get(key)
      if (cached === undefined) {
        cached = Promise.resolve()
          .then(() => llm.resolveModelInfo(provider, model, signal))
          .then(
            (info) => new Set((info !== null && typeof info === 'object' ? publicSubagentReasoning(info.reasoning)?.efforts ?? [] : []).map((entry) => entry.id)),
            () => null,
          )
        effortSupportCache.set(key, cached)
      }
      return cached
    }
    // 候选路由的额度态闸（v1.1）：额度查询标记该 provider「不可服务」时跳过（回退生效场景）。
    // 无额度数据/功能关闭一律放行（fail-open）——额度态只是候选过滤器，绝不让派生失败。
    const isQuotaHealthy = (provider) => {
      if (!featureEnabled('quotaLookup')) return undefined
      const view = quotaThrottle.peek(provider)
      if (view === undefined) return undefined
      return quotaProviderUnusable(view) === false
    }
    const applyInjection = (request) => {
      // 功能关闭：零记录（完全静默，与原生行为一致）——记录是 subagentRoute 功能的一部分。
      if (!featureEnabled('subagentRoute')) return { request, dispatch: undefined }
      const injected = resolveSubagentInjection(request, subagentRouteConfig, {
        isRoutable,
        readParentHeader,
        isQuotaHealthy,
        note: (message) => ctx.logger?.info?.(`dsh-service: subagent route ${message}`),
      })
      // 显式路由（本插件不干预的派生，如官方 subagent-model-selection 开启时 LLM 主动选的模型）
      // 也带进派发记录：source='explicit'，显示时不误标「继承」；显式携带的思考等级一并记录，
      // 否则回合尾行会漏掉 (effort)。
      const explicitProvider = typeof request?.agentOptions?.provider === 'string' && request.agentOptions.provider !== '' ? request.agentOptions.provider : undefined
      const explicitModel = typeof request?.agentOptions?.model === 'string' && request.agentOptions.model !== '' ? request.agentOptions.model : undefined
      const explicitEffort = typeof request?.agentOptions?.reasoningEffort === 'string' && request.agentOptions.reasoningEffort !== '' ? request.agentOptions.reasoningEffort : undefined
      if (injected === undefined) {
        if (explicitProvider !== undefined && explicitModel !== undefined) {
          return { request, dispatch: { parent: request?.parent, source: 'explicit', provider: explicitProvider, model: explicitModel, ...(explicitEffort !== undefined ? { reasoningEffort: explicitEffort } : {}) } }
        }
        return { request, dispatch: { parent: request?.parent } }
      }
      const { reasoningEffort, ...agentPatch } = injected
      if (injected.provider !== undefined && injected.model !== undefined) {
        ctx.logger?.info?.(`dsh-service: subagent route seam applied ${injected.provider}/${injected.model} to a subagent without an explicit route`)
      }
      const decorated = { ...request, agentOptions: { ...(request?.agentOptions ?? {}), ...agentPatch } }
      const effort = typeof reasoningEffort === 'string' && reasoningEffort !== '' ? reasoningEffort : undefined
      return { request: decorated, dispatch: { parent: request?.parent, provider: injected.provider, model: injected.model, ...(effort !== undefined ? { reasoningEffort: effort } : {}) } }
    }
    const runWithDispatch = (dispatch, work) => {
      if (dispatch === undefined) return work()
      return pendingDispatchStorage.run(dispatch, work)
    }
    const originalStart = subagents.start
    const originalStartContinuable = subagents.startContinuable
    subagents.start = (name, request) => {
      const { request: decorated, dispatch } = applyInjection(request)
      return runWithDispatch(dispatch, () => originalStart.call(subagents, name, decorated))
    }
    subagents.startContinuable = (spec) => {
      const { request: decorated, dispatch } = applyInjection(spec.request)
      return runWithDispatch(dispatch, () => originalStartContinuable.call(subagents, { ...spec, request: decorated }))
    }
    // agent/created（同步派发在创建栈内）：记录派发路由 + 绑定等级（仅当确有非空等级）。
    // agent/request：最终 proposal 阶段补入 reasoningEffort；已建立的值（提案自带/其他插件）永不覆盖。
    // 补标前按 proposal 实际 provider/model 复审等级仍受支持（适配器元数据漂移即丢弃并告警），
    // 与 isRoutable 的「实时判定、不让派生失败」契约同 philosophy。绑定无论结果如何都消费一次。
    // 注册在插件根 ctx：任何作用域标记的 agent 事件都会被未打标的根监听器全局收到（dsh-scope filter）。
    const disposeCreated = typeof ctx.on === 'function' ? ctx.on('agent/created', ({ agent }) => {
      const dispatch = pendingDispatchStorage.getStore()
      if (dispatch !== undefined) {
        try {
          const record = buildSubagentDispatchRecord(agent, dispatch.parent, dispatch, {
            readParentHeader,
            readDefaultSelection: () => {
              const service = ctx.get('agentDefaultModel')
              if (service === undefined || typeof service.currentSelection !== 'function') return undefined
              return service.currentSelection()
            },
          })
          if (record !== undefined) {
            pushSubagentDispatchRecord(dispatchRing, record)
            ctx.logger?.info?.(`dsh-service: subagent dispatch recorded ${record.childId} ${record.provider}/${record.model} (${record.source})`)
          }
        } catch (error) {
          ctx.logger?.warn?.(`dsh-service: subagent dispatch record failed: ${error?.message ?? String(error)}`)
        }
      }
      const effort = dispatch?.reasoningEffort
      if (typeof effort === 'string' && effort !== '' && agent !== null && typeof agent === 'object') managedEfforts.set(agent, effort)
    }) : null
    const disposeRequest = typeof ctx.on === 'function' ? ctx.on('agent/request', async (payload, next) => {
      const proposal = await next()
      const agent = payload?.agent
      if (!isSubagentManaged(agent)) return proposal
      const effort = managedEfforts.get(agent)
      managedEfforts.delete(agent)
      if (!featureEnabled('subagentRoute')) return proposal
      if (proposal === null || typeof proposal !== 'object') return proposal
      if (!(typeof effort === 'string' && effort !== '') || proposal.reasoningEffort !== undefined) return proposal
      const targetProvider = typeof proposal.provider === 'string' ? proposal.provider : ''
      const targetModel = typeof proposal.model === 'string' ? proposal.model : ''
      if (targetProvider === '' || targetModel === '') return proposal
      const supported = await resolveSupportedEfforts(targetProvider, targetModel, payload?.signal)
      if (supported !== null && !supported.has(effort)) {
        ctx.logger?.warn?.(`dsh-service: subagent route reasoning effort "${effort}" is no longer supported by ${targetProvider}/${targetModel}; dropped`)
        return proposal
      }
      return { ...proposal, reasoningEffort: effort }
    }) : null
    subagentSeamInstalled = true
    scope.effect(() => () => {
      subagents.start = originalStart
      subagents.startContinuable = originalStartContinuable
      if (typeof disposeCreated === 'function') disposeCreated()
      if (typeof disposeRequest === 'function') disposeRequest()
      effortSupportCache.clear()
      subagentSeamInstalled = false
    }, 'dsh-service subagent route seam teardown')
  })
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
  // 远端额度：后台补拉一次。index.js 只提供节流/生命周期/受控传输 context；所有方言、
  // 端点、凭据策略与编排都通过同一 Adapter interface 执行，不再区分 parser/fetcher 形状。
  const kickQuotaRefresh = (profile, adapter, config) => {
    const decision = quotaThrottle.attempt(profile.name)
    if (!decision.ok) return
    const queued = enqueueQuotaWork(async () => {
      const controller = new AbortController()
      quotaAbortControllers.add(controller)
      const deadline = setTimeout(() => controller.abort(), QUOTA_PROVIDER_DEADLINE_MS)
      let credentialPromise
      try {
        if (adapter === undefined) throw new Error('bad-payload:kind')
        const context = Object.freeze({
          profile: Object.freeze({ ...profile }),
          config: Object.freeze({
            ...config,
            kinds: Object.freeze({ ...(config?.kinds ?? {}) }),
            allowedHosts: Object.freeze(Object.fromEntries(
              Object.entries(config?.allowedHosts ?? {}).map(([provider, hosts]) => [provider, Object.freeze([...(hosts ?? [])])]),
            )),
          }),
          signal: controller.signal,
          fetchJson: fetchProviderUsage,
          requestJson: requestQuotaJson,
          sanitizeErrorDetail: sanitizeQuotaErrorDetail,
          credential() {
            credentialPromise ??= discoverQuotaCredential(ctx, adapter.kind, profile)
            return credentialPromise
          },
        })
        const payload = await adapter.fetchUsage(context)
        const normalized = adapter.normalize(payload)
        if (!Array.isArray(normalized?.windows)) throw new Error('bad-payload:shape')
        if (!quotaDisposed) quotaThrottle.settle(profile.name, { ok: true, windows: normalized.windows })
      } catch (error) {
        if (!quotaDisposed) {
          const detail = sanitizeQuotaErrorDetail(error?.detail)
          quotaThrottle.settle(profile.name, {
            ok: false,
            code: quotaErrorCode(error),
            ...(detail !== undefined ? { detail } : {}),
          })
        }
      } finally {
        clearTimeout(deadline)
        quotaAbortControllers.delete(controller)
      }
    })
    if (!queued && !quotaDisposed) quotaThrottle.settle(profile.name, { ok: false, code: 'cancelled' })
  }
  ctx.effect(() => () => permissionPlans.clear(), 'dsh-service permission plans')
  ctx.effect(() => () => { backupIntegrity.dispose().catch(() => {}) }, 'dsh-service backup restore plans')
  ctx.effect(() => () => sessionDeletePlans.clear(), 'dsh-service session delete plans')
  ctx.effect(() => () => sessionBytesCache.clear(), 'dsh-service session bytes cache')
  ctx.effect(() => () => sessionTitleCache.clear(), 'dsh-service session title cache')
  ctx.effect(() => { sessionViewCache.id = null; sessionViewCache.snapshot = null }, 'dsh-service session view cache')
  ctx.effect(() => () => {
    quotaDisposed = true
    quotaPending.length = 0
    for (const controller of quotaAbortControllers) controller.abort()
    quotaAbortControllers.clear()
  }, 'dsh-service quota upstream disposal')
  // ── 移动端适配（v0.30）：大 JSON 响应压缩随功能开关热挂卸 ────────────────
  let mobileCompressionDispose = null
  const syncMobileCompression = () => {
    if (featureEnabled('mobileAdaptation')) {
      if (mobileCompressionDispose === null) mobileCompressionDispose = ensureMobileResponseCompression()
    } else if (mobileCompressionDispose !== null) {
      mobileCompressionDispose()
      mobileCompressionDispose = null
    }
  }
  ctx.effect(() => {
    featureSettingsListeners.add(syncMobileCompression)
    syncMobileCompression()
    return () => {
      featureSettingsListeners.delete(syncMobileCompression)
      if (mobileCompressionDispose !== null) {
        mobileCompressionDispose()
        mobileCompressionDispose = null
      }
    }
  }, 'dsh-service mobile response compression')
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

  // DSH 的 Connection RPC channel 只能是单层绝对路径；子功能统一登记在内部注册表。
  const rpcEndpoints = {
    'version': { handle: async (payload, rpcEndpoint) => {
      // runtimeEnv 随进程身份（instanceId）一起返回：概览展示、升级前置确认与重启警告共用，
      // 客户端对缺字段的老宿主静默降级。
      return { ok: true, value: { current: dshVersion, pluginVersion, instanceId, runtimeEnv } }

    } },
    'check-update': { handle: async (payload, rpcEndpoint) => {
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
          : { current: dshVersion, latest: null, tags: { latest: null, next: null, alpha: null }, upToDate: null, status: 'unavailable', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' }
        const pluginError = pluginResult.status === 'rejected' ? String(pluginResult.reason?.message || pluginResult.reason) : ''
        const plugin = pluginResult.status === 'fulfilled'
          ? { current: pluginVersion, latest: pluginResult.value.latest, tags: pluginResult.value.tags, upToDate: atLeastSemver(pluginVersion, pluginResult.value.latest), status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' }
          : { current: pluginVersion, latest: null, tags: { latest: null, next: null, alpha: null }, upToDate: null, status: pluginError.includes('HTTP 404') ? 'unpublished' : 'unavailable', url: 'https://github.com/gehennawu/dsh-service/releases' }
        if (dsh.status === 'unavailable' && plugin.status === 'unavailable') throw dshResult.reason
        const value = { checkedAt: now, cached: false, dsh, plugin }
        updateCache = { ok: true, value, checkedAt: now, ttl: 10 * 60 * 1000 }
        return { ok: true, value }
      } catch (error) {
        const message = error?.message || String(error)
        updateCache = { ok: false, error: message, checkedAt: now, ttl: 60 * 1000 }
        return { ok: false, error: message, cached: false }
      }

    } },
    'upgrade': { audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await upgradePlugin(ctx, dshHome, runtimeEnv) }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'activity': { handle: async (payload, rpcEndpoint) => {
      return { ok: true, value: collectActiveWork(ctx) }

    } },
    'health': { handle: async (payload, rpcEndpoint) => {
      return { ok: true, value: await collectHealth(ctx) }

    } },
    'diagnostics': { feature: 'healthDiagnostics', handle: async (payload, rpcEndpoint) => {
      return { ok: true, value: await collectDiagnostics(ctx, dshHome, runtimeEnv) }

    } },
    'plugin-restart': { feature: 'healthDiagnostics', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const result = await restartPluginEntry(ctx, payload?.entryId)
        if (result.ok) return { ok: true, value: {} }
        // 稳定业务码（unknown-plugin / loader-unavailable / plugin-disabled / not-failed /
        // restart-failed）走严格 RPC 归一（strictRpcResult），客户端词典映射；restart-failed
        // 的底层错误原文并入 message（码: 详情 后缀语义）。
        return rpcFailure(new Error(result.code === 'restart-failed' ? `restart-failed: ${result.error}` : result.code))
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'usage': { feature: 'modelUsage', handle: async (payload, rpcEndpoint) => {
      return { ok: true, value: publicUsage(await usageIndexPromise, payload?.timezoneOffsetMinutes) }

    } },
    'usage-refresh': { feature: 'modelUsage', handle: async (payload, rpcEndpoint) => {
      if (usageRefreshPromise === undefined) {
        usageRefreshPromise = usageIndexPromise.then((index) => refreshUsageIndex(ctx, dshHome, index)).finally(() => { usageRefreshPromise = undefined })
      }
      return { ok: true, value: publicUsage(await usageRefreshPromise, payload?.timezoneOffsetMinutes) }

    } },
    'permissions-plan': { feature: 'healthDiagnostics', audit: true, handle: async (payload, rpcEndpoint) => {
      return { ok: true, value: await permissionSnapshot(ctx, dshHome, permissionPlans) }

    } },
    'permissions-deep': { feature: 'healthDiagnostics', handle: async (payload, rpcEndpoint) => {
      const value = await deepCheckPermissions(dshHome, permissionPlans, payload?.planId)
      if (value === undefined) return { ok: false, error: 'unknown-permission-plan' }
      return { ok: true, value }

    } },
    'permissions-repair': { feature: 'healthDiagnostics', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const value = await repairPermissions(ctx, dshHome, permissionPlans, payload?.planId)
        if (value === undefined) return { ok: false, error: 'unknown-permission-plan' }
        return { ok: true, value }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'backup-list': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await listBackups(dshHome) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-progress': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      return { ok: true, value: { ...backupProgress } }

    } },
    'backup-create': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await withBackupLock(() => {
          const name = `dsh-backup-${formatBackupTimestamp(new Date())}.tar.gz`
          return createBackup(ctx, dshHome, join(dshHome, 'backups'), name, async (source) => {
            const validator = createBackupIntegrity({ dshHome, resolveBackup: async () => source })
            try { return await validator.inspectBackup(source.id) } finally { await validator.dispose() }
          }, setBackupProgress).finally(clearBackupProgress)
        }) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-export': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const value = await exportBackup(dshHome, downloadTokens, payload?.id)
        if (value === undefined) return rpcFailure(new Error('unknown-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-delete': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const value = await deleteBackup(dshHome, payload?.id)
        if (value === undefined) return rpcFailure(new Error('unknown-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-inspect': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      try {
        const value = await backupIntegrity.inspectBackup(payload?.id)
        if (value === undefined) return rpcFailure(new Error('unknown-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-restore-prepare': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await backupIntegrity.prepareRestore(payload?.id) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-restore-commit': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await backupIntegrity.commitRestore(payload?.planId) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-restore': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      return rpcFailure(new Error('restore-preflight-required'))

    } },
    'backup-import': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const value = await importBackup(dshHome, payload?.name, payload?.data, async (source) => {
          const validator = createBackupIntegrity({ dshHome, resolveBackup: async () => source })
          try { return await validator.inspectBackup(source.id) } finally { await validator.dispose() }
        })
        if (value === undefined) return rpcFailure(new Error('invalid-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'skills-list': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
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
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-models': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
      try {
        return { ok: true, value: await listSkillModels(llm, ctx.get('agentDefaultModel')) }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-toggle': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const field = payload?.field === 'model' || payload?.field === 'user' ? payload.field : null
      if (field === null) return { ok: false, error: 'invalid-field' }
      if (typeof payload?.enable !== 'boolean') return { ok: false, error: 'invalid-enable' }
      try {
        const index = await skillsIndexPromise
        const outcome = await mutateSkillEntryById(ctx, dshHome, index, payload?.id, false, (raw) => ({ text: setSkillInvocationKey(raw, field, payload.enable) }))
        if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) }
        return { ok: true, value: { entry: outcome.entry } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-fix-keys': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const index = await skillsIndexPromise
        const outcome = await mutateSkillEntryById(ctx, dshHome, index, payload?.id, true, (raw) => {
          const fixed = fixLegacySkillInvocationKeys(raw)
          return { text: fixed.text }
        })
        if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) }
        return { ok: true, value: { entry: outcome.entry } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-describe': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
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
          const draft = await describeSkillDraft(llm, entry.name ?? '', raw, provider, model, (code, params) => job.push(code, params), { signal: call.signal, lang: normalizeSkillDescribeLang(payload?.lang) })
          return { ok: true, value: { draft } }
        } finally {
          call.done()
        }
      } catch (error) {
        return rpcTechnicalFailure(error, error?.message === 'describe-timeout' ? { detail: 'timeout' } : {})
      }

    } },
    'skills-describe-log': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
      const job = describeJobs.get(typeof payload?.id === 'string' ? payload.id : '')
      return { ok: true, value: { logs: job ? [...job.logs] : [] } }

    } },
    'skills-note-save': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
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
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-note-clear': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
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
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-batch-plan': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
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
        const { candidates, annotated, skipped } = selectSkillBatchCandidates(entries, index)
        const planId = randomUUID()
        // 已注释条目也进计划（单列待客户端确认），体积估算含两者——确认后整批运行。
        const planIds = new Set([...candidates, ...annotated].map((candidate) => candidate.id))
        skillsBatch = { phase: 'planned', planId, provider, model, candidates, annotated, items: candidates, total: candidates.length + annotated.length, done: 0, failures: [], aborted: false, running: false, current: null, logs: [], estBytes: entries.filter((entry) => planIds.has(entry.id)).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) }
        return { ok: true, value: { planId, candidates, annotated, skipped, estBytes: skillsBatch.estBytes } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-batch-run': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      if (skillsBatch === null || skillsBatch.planId !== payload?.planId) return { ok: false, error: 'unknown-batch-plan' }
      if (skillsBatch.running || skillsBatch.phase === 'done' || skillsBatch.phase === 'cancelled') return { ok: false, error: 'batch-already-' + (skillsBatch.running ? 'running' : skillsBatch.phase) }
      // 已注释条目的强制覆盖确认闸：计划含已注释条目时，客户端必须显式确认
      // （forceAnnotated: true）才允许启动——注释过不等于永远不能再次补全，但覆盖旧注释要有确认。
      const planAnnotated = Array.isArray(skillsBatch.annotated) ? skillsBatch.annotated : []
      if (planAnnotated.length > 0 && payload?.forceAnnotated !== true) return { ok: false, error: 'annotated-confirm-required' }
      // 确认后新注释覆盖旧注释：候选 + 已注释合并成一个运行清单，进度口径随之更新。
      skillsBatch.items = [...(skillsBatch.candidates ?? []), ...planAnnotated]
      skillsBatch.total = skillsBatch.items.length
      skillsBatch.phase = 'running'
      skillsBatch.running = true
      // 补全语言在 run 时刻定格（而非 plan 时刻）：计划确认前切换界面语言，按新语言补全。
      skillsBatch.lang = normalizeSkillDescribeLang(payload?.lang)
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
            const draft = await describeSkillDraft(llm, entry.name ?? '', raw, skillsBatch.provider, skillsBatch.model, batchLog, { signal: batchCall.signal, lang: skillsBatch.lang })
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

    } },
    'skills-batch-status': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
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

    } },
    'skills-batch-cancel': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      if (skillsBatch !== null) skillsBatch.aborted = true
      // 立即中断在途 LLM 调用：不等当前条目跑满 90s 超时/重试链。
      for (const call of skillsActiveControllers) {
        try { call.abort(new Error('batch-cancelled')) } catch (_) {}
      }
      return { ok: true, value: { phase: skillsBatch?.phase ?? 'idle' } }

    } },
    'quota': { feature: 'quotaLookup', handle: async (payload, rpcEndpoint) => {
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
          const { adapter, kind, kindSource } = resolveQuotaKind(config, profile)
          if (adapter === undefined || kind === undefined) {
            // 未适配（无 kind/已停用/白名单外且不可推断）：灰色行，宿主绝不主动外呼。
            rows.push({ provider: profile.name, displayName: profile.displayName, adapted: false })
            continue
          }
          // 某些自动识别 Adapter 在凭据未配置时应整行静默隐藏；可见性属于 Adapter 凭据策略，
          // index.js 只消费统一 policy，不再按 kind 写特例。显式适配仍照常显示填写入口。
          const credentialPolicy = adapter.credentialPolicy(profile)
          if (kindSource === 'auto' && credentialPolicy.autoVisibility === 'credential-gated'
            && !(await quotaCredentialConfigured(ctx, kind, profile))) continue
          if (refreshAll || requestedProviders.has(profile.name)) kickQuotaRefresh(profile, adapter, config)
          const view = quotaThrottle.view(profile.name)
          const windows = Array.isArray(view.windows) ? view.windows : []
          // 「凭据类」错误 = 填/换一份凭据就能恢复的状态，客户端按 unconfigured 渲染填写表单。
          // credential-rejected（v0.29 修复）：Cookie/key 被上游拒绝时恰恰最需要重新填入——
          // 漏掉它会把卡片锁死在错误态，用户找不到任何入口（GUI 反馈「失效后无法再次填入」）。
          const credentialClass = view.lastError === 'credential-missing' || view.lastError === 'no-base-url' || view.lastError === 'credentials-unavailable' || view.lastError === 'credential-rejected'
          const providerResetCards = resetCardsByProvider.get(profile.name) ?? []
          // 凭据填写窗口的数据源：仅对「缺凭据」的未配置行附带候选线索名的配置状态（describe 只回
          // 配置与否/来源/可写，绝不带值）；凭据服务缺席时省略字段——客户端隐藏窗口退回文案指引。
          let credentialHints
          if (credentialClass && !view.refreshing && view.lastError !== 'no-base-url') {
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
            // 凭据入口语义由 Adapter policy 下发稳定键，客户端只负责本地化，不再对 kind 重复分支。
            credentialEntryKey: adapter.credentialPolicy(profile).entryKey,
            // 官网用户页余额网址由具体 Adapter 持有（宿主常量白名单；无则缺省）。
            ...(typeof quotaAdapterUsageUrl(adapter) === 'string' && quotaAdapterUsageUrl(adapter) !== '' ? { usageUrl: quotaAdapterUsageUrl(adapter) } : {}),
          })
        }
        return { ok: true, value: { providers: rows, serverTime: Date.now() } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'quota-refresh': { feature: 'quotaLookup', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        // 手动刷新入口：provider 过白名单且 kind 已适配；清掉节流闸后立即 kick。
        // 单飞仍生效（在途时本次点击为 no-op）；上游结果经后续 quota 快照带出，不在此等待。
        const providerName = typeof payload?.provider === 'string' ? payload.provider : ''
        const profile = readQuotaProfiles(ctx.get('settings'), ctx.get('llm')).find((candidate) => candidate.name === providerName)
        if (profile === undefined) return { ok: false, error: 'unknown-provider' }
        const config = await refreshQuotaConfigCache()
        const { adapter } = resolveQuotaKind(config, profile)
        if (adapter === undefined) return { ok: false, error: 'not-adapted' }
        const forced = quotaThrottle.force(providerName)
        if (!forced.ok) {
          if (forced.reason === 'inflight') return { ok: true }
          return { ok: false, error: forced.reason === 'cooldown' ? 'refresh-cooldown' : 'refresh-backoff', nextAllowedAt: forced.nextAllowedAt }
        }
        kickQuotaRefresh(profile, adapter, config)
        return { ok: true }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'quota-config': { feature: 'quotaLookup', audit: true, handle: async (payload, rpcEndpoint) => {
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
            const adapter = kind === null ? undefined : QUOTA_ADAPTER_BY_KIND.get(kind)
            if (kind !== null && adapter === undefined) return { save: false, value: { ok: false, error: 'unknown-kind' } }
            if (adapter === undefined) {
              // 显式停用不保留任何 Adapter 私有安全状态。
              delete config.allowedHosts[providerName]
            } else {
              // 配置校验/钉住派生由具体 Adapter 决定；index.js 只应用统一结果。
              const prepared = prepareQuotaAdapterConfig(adapter, profileForProvider)
              if (prepared.ok !== true) return { save: false, value: { ok: false, error: prepared.error } }
              if (Array.isArray(prepared.allowedHosts) && prepared.allowedHosts.length > 0) {
                config.allowedHosts[providerName] = [...prepared.allowedHosts]
              } else {
                delete config.allowedHosts[providerName]
              }
            }
            config.kinds[providerName] = kind
          }
          // 适配变更即清闸（v0.29 用户反馈：填完凭据/改完类型就该立刻重试，不继承旧失败的退避）。
          quotaThrottle.resetGates(providerName)
          return { value: { ok: true } }
        })
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'quota-credential-set': { feature: 'quotaLookup', audit: true, handle: (payload, rpcEndpoint) => quotaCredentialEndpoint(ctx, refreshQuotaConfigCache, quotaThrottle, payload, rpcEndpoint) },
    'quota-credential-unset': { feature: 'quotaLookup', audit: true, handle: (payload, rpcEndpoint) => quotaCredentialEndpoint(ctx, refreshQuotaConfigCache, quotaThrottle, payload, rpcEndpoint) },
    'quota-reset-card': { feature: 'quotaLookup', audit: true, handle: async (payload, rpcEndpoint) => {
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
        return rpcTechnicalFailure(error)
      }

    } },
    'web': { audit: true, handle: async (payload, rpcEndpoint) => {
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

    } },
    'subagent-route': { feature: 'subagentRoute', handle: async (payload, rpcEndpoint) => {
      try {
        await subagentRouteLoadPromise
        const llm = ctx.get('llm')
        // 模型清单沿用 skills-models 的白名单口径（llm.listProviders × listModels，单渠道失败跳过），
        // 并对每个精确模型附加 adapter 的 reasoning metadata（resolveModelInfo 缺席时保留原目录项）；
        // llm 服务缺席时清单为空——自定义模式在保存端也会被拒（llm-unavailable），快照仍可下发。
        let models = []
        let current
        if (llm !== undefined && typeof llm.listProviders === 'function') {
          const catalog = await listSubagentModels(llm, ctx.get('agentDefaultModel'))
          models = catalog.models
          current = catalog.current
        }
        const config = subagentRouteConfig
        return {
          ok: true,
          value: {
            available: subagentSeamInstalled,
            mode: config.mode,
            ...(config.mode === 'custom' ? {
              provider: config.provider,
              model: config.model,
              ...(typeof config.reasoningEffort === 'string' && config.reasoningEffort !== '' ? { reasoningEffort: config.reasoningEffort } : {}),
            } : {}),
            ...(Array.isArray(config.fallbacks) && config.fallbacks.length > 0 ? { fallbacks: config.fallbacks } : {}),
            models,
            ...(current !== undefined ? { current } : {}),
          },
        }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    // v1.2：子代理派发记录（对话页回合尾模型行的事实源）。只读快照，按父会话/回合过滤，
    // newest-first 分页。记录随宿主进程存续，重启即清——客户端页面刷新不丢（记录在宿主内存）。
    'subagent-dispatches': { feature: 'subagentRoute', handle: async (payload, rpcEndpoint) => {
      try {
        const records = listSubagentDispatches(dispatchRing, payload)
        return { ok: true, value: { records } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'subagent-route-save': { feature: 'subagentRoute', audit: true, handle: async (payload, rpcEndpoint) => {
      const mode = payload?.mode
      if (!SUBAGENT_ROUTE_MODES.includes(mode)) return { ok: false, error: 'unknown-mode' }
      try {
        let whitelist
        const loadWhitelist = async () => {
          if (whitelist === undefined) {
            const llm = ctx.get('llm')
            if (llm === undefined || typeof llm.stream !== 'function') return null
            whitelist = await listSubagentModels(llm, ctx.get('agentDefaultModel'))
          }
          return whitelist
        }
        const primary = { mode }
        if (mode === 'custom') {
          const provider = typeof payload?.provider === 'string' ? payload.provider.trim() : ''
          const model = typeof payload?.model === 'string' ? payload.model.trim() : ''
          if (provider === '' || model === '') return { ok: false, error: 'invalid-model-route' }
          const catalog = await loadWhitelist()
          if (catalog === null) return { ok: false, error: 'llm-unavailable' }
          // 与 skills-describe 同一道闸：provider/model 必须命中运行时清单白名单；同时取该
          // exact model 的 adapter reasoning metadata 用于校验 reasoningEffort 是否受支持。
          const modelEntry = catalog.models.find((item) => item.provider === provider && item.id === model)
          if (modelEntry === undefined) return { ok: false, error: 'invalid-model-route' }
          const rawEffort = payload?.reasoningEffort
          if (rawEffort !== undefined && rawEffort !== '') {
            if (typeof rawEffort !== 'string') return { ok: false, error: 'invalid-reasoning-effort' }
            const effort = rawEffort.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD)
            if (effort !== '') {
              if (!(modelEntry.reasoning?.efforts ?? []).some((entry) => entry.id === effort)) return { ok: false, error: 'invalid-reasoning-effort' }
              primary.reasoningEffort = effort
            }
          }
          primary.provider = provider.slice(0, MAX_SUBAGENT_ROUTE_FIELD)
          primary.model = model.slice(0, MAX_SUBAGENT_ROUTE_FIELD)
        }
        // 回退列表（v1.1）：custom 与 follow 共用；每条与主路由同一道白名单闸，条目非法整体拒绝。
        const fallbacks = []
        const rawFallbacks = Array.isArray(payload?.fallbacks) ? payload.fallbacks : []
        if (rawFallbacks.length > 0 && mode !== 'inherit') {
          const catalog = await loadWhitelist()
          if (catalog === null) return { ok: false, error: 'llm-unavailable' }
          for (const entry of rawFallbacks) {
            if (fallbacks.length >= SUBAGENT_ROUTE_FALLBACK_MAX) break
            if (entry === null || typeof entry !== 'object') return { ok: false, error: 'invalid-fallback-route' }
            const provider = typeof entry.provider === 'string' ? entry.provider.trim() : ''
            const model = typeof entry.model === 'string' ? entry.model.trim() : ''
            const modelEntry = catalog.models.find((item) => item.provider === provider && item.id === model)
            if (modelEntry === undefined) return { ok: false, error: 'invalid-fallback-route' }
            let effort = ''
            const rawEffort = entry.reasoningEffort
            if (rawEffort !== undefined && rawEffort !== '') {
              if (typeof rawEffort !== 'string') return { ok: false, error: 'invalid-fallback-route' }
              const trimmed = rawEffort.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD)
              if (trimmed !== '' && !(modelEntry.reasoning?.efforts ?? []).some((candidate) => candidate.id === trimmed)) return { ok: false, error: 'invalid-fallback-route' }
              effort = trimmed
            }
            const normalized = { provider: provider.slice(0, MAX_SUBAGENT_ROUTE_FIELD), model: model.slice(0, MAX_SUBAGENT_ROUTE_FIELD), ...(effort !== '' ? { reasoningEffort: effort } : {}) }
            if (fallbacks.some((candidate) => candidate.provider === normalized.provider && candidate.model === normalized.model)) continue
            fallbacks.push(normalized)
          }
        }
        return await serializeSubagentRouteWrite(async (config) => {
          config.mode = mode
          if (mode === 'custom') {
            config.provider = primary.provider
            config.model = primary.model
            // 先删旧值，只有新值非空时才写入：空/未提供代表「使用模型默认」。
            delete config.reasoningEffort
            if (primary.reasoningEffort !== undefined) config.reasoningEffort = primary.reasoningEffort
          } else {
            // follow / inherit：不保留 custom 字段，重置回干净形状。
            delete config.provider
            delete config.model
            delete config.reasoningEffort
          }
          if (fallbacks.length > 0) config.fallbacks = fallbacks
          else delete config.fallbacks
          return { value: { ok: true, mode: config.mode, ...(config.mode === 'custom' ? {
            provider: config.provider,
            model: config.model,
            ...(typeof config.reasoningEffort === 'string' && config.reasoningEffort !== '' ? { reasoningEffort: config.reasoningEffort } : {}),
          } : {}), ...(Array.isArray(config.fallbacks) && config.fallbacks.length > 0 ? { fallbacks: config.fallbacks } : {}) } }
        })
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-list': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const scope = payload?.scope === 'archived' || payload?.scope === 'deleted' ? payload.scope : 'all'
      try {
        await sessionTitlesReady
        const value = await listSessionsForManage(ctx, dshHome, scope, sessionTitleCache)
        // 已删除记录独立下发（供「已删除」筛选）：字段只为展示，绝不包含内容。
        return { ok: true, value }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-bytes': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const raw = Array.isArray(payload?.ids) ? payload.ids : []
      const ids = []
      const seen = new Set()
      for (const id of raw) {
        if (typeof id !== 'string' || id === '' || seen.has(id)) continue
        seen.add(id)
        ids.push(id)
        if (ids.length >= SESSIONS_BYTES_MAX_IDS) break
      }
      if (ids.length === 0) return { ok: false, error: 'invalid-session-ids' }
      try {
        // 安全教义：id 只用来在宿主 listSessions 结果里查找头信息，定位/统计路径全部来自
        // 宿主侧记录（locate），浏览器不提供任何路径。
        return { ok: true, value: { bytes: await resolveSessionBytesForIds(ctx, ids, sessionBytesCache) } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-view': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      const cursor = typeof payload?.cursor === 'number' && Number.isFinite(payload.cursor) ? payload.cursor : undefined
      const center = typeof payload?.center === 'number' && Number.isSafeInteger(payload.center) ? payload.center : undefined
      try {
        return await viewSessionPage(ctx, id, cursor, sessionViewCache, SESSIONS_VIEW_PAGE_SIZE, center)
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-search': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const query = typeof payload?.query === 'string' ? payload.query : ''
      const scope = payload?.scope === 'archived' ? 'archived' : 'all'
      try {
        await sessionTitlesReady
        return { ok: true, value: await searchSessionsContent(ctx, dshHome, query, scope, sessionTitleCache) }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-export': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      try {
        if (!(await sessionExists(ctx, id))) return { ok: false, error: 'session-not-found' }
        // 复用官方 ZIP 导出路由：浏览器半下载同源 URL（含子代理+附件），宿主不自己拼包。
        const url = `/api/session.export?sessionId=${encodeURIComponent(id)}&includeDescendants=true`
        return { ok: true, value: { url, includesDescendants: true } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-archive': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      const workspaceRegistry = ctx.get('workspaceRegistry')
      if (workspaceRegistry === undefined || typeof workspaceRegistry.archiveSession !== 'function') return { ok: false, error: 'workspace-unavailable' }
      try {
        await workspaceRegistry.archiveSession(id)
        return {
          ok: true,
          value: {
            archived: true,
            archivedSessionIds: Array.isArray(workspaceRegistry.archivedSessionIds) ? [...workspaceRegistry.archivedSessionIds] : [id],
          },
        }
      } catch (error) {
        if (error?.name === 'WorkspaceUnknownSessionError') return { ok: false, error: 'session-not-found' }
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-delete-plan': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      try {
        // 安全教义：只接受宿主列表返回的 id（白名单校验），且必须已归档、非 live。
        // 只定位目标会话 + stat 目标目录，不做全量列表重扫（v0.35 用户反馈：此前
        // 复用 listSessionsForManage 会对每个会话 readdir+stat，会话多时确认要等好几秒）。
        const record = await resolveSessionForDelete(ctx, id)
        if (record === undefined) return { ok: false, error: 'session-not-found' }
        if (record.live) return { ok: false, error: 'live-session-rejected' }
        if (!record.archived) return { ok: false, error: 'session-not-archived' }
        const planId = randomUUID()
        sessionDeletePlans.set(planId, { id, title: record.title, cwd: record.cwd, dir: record.dir, bytes: record.bytes, expires: Date.now() + SESSIONS_DELETE_PLAN_TTL_MS })
        return {
          ok: true,
          value: {
            planId,
            session: {
              id,
              title: record.title,
              cwd: record.cwd,
              bytes: record.bytes,
              archived: true,
            },
            // 归档会话早已从官方侧栏隐藏；删除只移除其日志，保留 archivedSessionIds 死 id。
            consequences: ['deletes-session-log'],
          },
        }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-delete': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const planId = typeof payload?.planId === 'string' ? payload.planId : ''
      const plan = sessionDeletePlans.get(planId)
      if (plan === undefined) return { ok: false, error: 'unknown-delete-plan' }
      sessionDeletePlans.delete(planId)
      if (Date.now() > plan.expires) return { ok: false, error: 'delete-plan-expired' }
      try {
        // 执行前复检：计划期间会话可能被拉起或从归档集合移除，两种情况都拒绝。
        if (sessionIsLive(ctx, plan.id)) return { ok: false, error: 'live-session-rejected' }
        const archivedIds = ctx.get('workspaceRegistry')?.archivedSessionIds
        if (!Array.isArray(archivedIds) || !archivedIds.includes(plan.id)) return { ok: false, error: 'session-not-archived' }
        // 先持久化删除记录，再执行不可逆 rm；侧车写失败时日志保持原样。
        const deleted = await loadDeletedSessions(dshHome)
        const previousDeleted = { version: deleted.version, items: [...deleted.items] }
        deleted.items = deleted.items.filter((item) => item.id !== plan.id)
        deleted.items.push({ id: plan.id, title: plan.title, cwd: plan.cwd ?? null, deletedAt: Date.now() })
        await saveDeletedSessions(dshHome, deleted)
        try {
          await rm(plan.dir, { recursive: true, force: true })
        } catch (error) {
          try {
            await saveDeletedSessions(dshHome, previousDeleted)
          } catch (rollbackError) {
            throw new Error(`${error?.message || String(error)}; deleted-record rollback failed: ${rollbackError?.message || String(rollbackError)}`)
          }
          throw error
        }
        sessionBytesCache.delete(plan.id)
        if (sessionViewCache.id === plan.id) sessionViewCache.id = null
        return { ok: true, value: { deleted: true, id: plan.id } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }
    } },
    'sessions-clear-deleted': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const all = payload?.all === true
      const raw = Array.isArray(payload?.ids) ? payload.ids : []
      const ids = []
      const seen = new Set()
      for (const id of raw) {
        if (typeof id !== 'string' || id.trim() === '') continue
        const cleanId = id.trim()
        if (seen.has(cleanId)) continue
        seen.add(cleanId)
        ids.push(cleanId)
      }
      if (!all && ids.length === 0) return rpcFailure(new Error('invalid-session-ids'))
      try {
        const deleted = await loadDeletedSessions(dshHome)
        let removedCount = 0
        const removedIds = []
        if (all) {
          removedCount = deleted.items.length
          for (const item of deleted.items) removedIds.push(item.id)
          deleted.items = []
        } else {
          const targetSet = new Set(ids)
          const remaining = []
          for (const item of deleted.items) {
            if (targetSet.has(item.id)) {
              removedCount++
              removedIds.push(item.id)
            } else {
              remaining.push(item)
            }
          }
          deleted.items = remaining
        }
        if (removedCount > 0) {
          await saveDeletedSessions(dshHome, deleted)
        }
        if (sessionTitleCache !== null) {
          for (const id of removedIds) sessionTitleCache.delete(id)
        }
        return { ok: true, value: { cleared: true, count: removedCount, ids: removedIds } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }
    } },
  }
  const dispatchRpc = createRpcDispatcher({ endpoints: rpcEndpoints, featureEnabled, logger: ctx.logger })
  ctx.connection.rpc.handle('/dsh-service', dispatchRpc, { authority: 'loopback' })
}

export {
  SKILL_SOURCE_RANK,
  appendVaryToken,
  apply,
  buildCliproxyAccountPlan,
  buildSubagentDispatchRecord,
  cliproxyFetchGuard,
  cliproxyPinHostFromBaseURL,
  cliproxyProjectFor,
  createQuotaThrottle,
  detectRuntimeEnv,
  ensureMobileResponseCompression,
  evaluateSkillFile,
  extractSkillDraftJson,
  fetchCliproxyUsage,
  fetchProviderUsage,
  fetchStepFunStepPlanUsage,
  fetchXiaomiTokenPlanUsage,
  fixLegacySkillInvocationKeys,
  inferQuotaKind,
  inject,
  installMobileResponseCompression,
  isCompressibleJsonType,
  lastSubagentTurn,
  listSessionsForManage,
  listSubagentModels,
  listSubagentDispatches,
  locateSkillFrontmatter,
  name,
  normalizeAntigravityModels,
  normalizeAntigravityQuotaSummary,
  normalizeCodexRateLimit,
  normalizeDeepseekBalance,
  normalizeGeminiBuckets,
  normalizeKimiBalance,
  normalizeOpencodeUsage,
  normalizeOpenRouterCredits,
  normalizeSiliconFlowInfo,
  normalizeStepfunBalance,
  normalizeStepFunStepPlanUsage,
  normalizeXiaomiTokenPlanUsage,
  normalizeZaiCodingUsage,
  parseQuotaConfigText,
  parseSkillFrontmatterData,
  parseSubagentRouteText,
  pickCompressionEncoding,
  publicSubagentReasoning,
  pushSubagentDispatchRecord,
  quotaCredentialConfigured,
  quotaCredentialHintNames,
  quotaEndpointFor,
  quotaErrorCode,
  quotaProviderUnusable,
  readLlmProviders,
  resolveSessionForDelete,
  resolveSkillInvocationState,
  resolveSubagentInjection,
  runtimeEnvCheck,
  safeCliproxyOrigin,
  sanitizeSkillDraftText,
  searchSessionsContent,
  selectSkillBatchCandidates,
  sessionEventText,
  setSkillInvocationKey,
  skillIdFor,
  stepfunWebIdFromToken,
  unwrapCliproxyApiCallEnvelope,
  unwrapXiaomiConsoleEnvelope,
  viewSessionPage,
}
export default {
  SKILL_SOURCE_RANK,
  appendVaryToken,
  apply,
  buildCliproxyAccountPlan,
  cliproxyFetchGuard,
  cliproxyPinHostFromBaseURL,
  cliproxyProjectFor,
  createQuotaThrottle,
  detectRuntimeEnv,
  ensureMobileResponseCompression,
  evaluateSkillFile,
  extractSkillDraftJson,
  fetchCliproxyUsage,
  fetchProviderUsage,
  fetchStepFunStepPlanUsage,
  fetchXiaomiTokenPlanUsage,
  fixLegacySkillInvocationKeys,
  inferQuotaKind,
  inject,
  installMobileResponseCompression,
  isCompressibleJsonType,
  lastSubagentTurn,
  listSessionsForManage,
  listSubagentModels,
  listSubagentDispatches,
  locateSkillFrontmatter,
  name,
  normalizeAntigravityModels,
  normalizeAntigravityQuotaSummary,
  normalizeCodexRateLimit,
  normalizeDeepseekBalance,
  normalizeGeminiBuckets,
  normalizeKimiBalance,
  normalizeOpencodeUsage,
  normalizeOpenRouterCredits,
  normalizeSiliconFlowInfo,
  normalizeStepfunBalance,
  normalizeStepFunStepPlanUsage,
  normalizeXiaomiTokenPlanUsage,
  normalizeZaiCodingUsage,
  parseQuotaConfigText,
  parseSkillFrontmatterData,
  parseSubagentRouteText,
  pickCompressionEncoding,
  publicSubagentReasoning,
  pushSubagentDispatchRecord,
  quotaCredentialConfigured,
  quotaCredentialHintNames,
  quotaEndpointFor,
  quotaErrorCode,
  quotaProviderUnusable,
  readLlmProviders,
  resolveSessionForDelete,
  resolveSkillInvocationState,
  resolveSubagentInjection,
  runtimeEnvCheck,
  safeCliproxyOrigin,
  sanitizeSkillDraftText,
  searchSessionsContent,
  selectSkillBatchCandidates,
  sessionEventText,
  setSkillInvocationKey,
  skillIdFor,
  stepfunWebIdFromToken,
  unwrapCliproxyApiCallEnvelope,
  unwrapXiaomiConsoleEnvelope,
  viewSessionPage,
}
