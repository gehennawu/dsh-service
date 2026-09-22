// Host deep module: model-configuration workbench (v1.10, ported from work/models-runtime).
//
// 为什么是独立文件而不是 index.js 里的又一段（2026-09 重实现决定）：v0.43 的工作台在旧
// 分支里是 2750 行宿主代码、与 quota/skill/session 端点交错写在同一个 `apply()` 里；
// main 之后已把各功能域拆成 `*-routes.js`，工作台按同一惯例成域——`index.js` 只做 RPC
// 装配与共享工具注入，本文件持有领域逻辑。深模块 seam（与 docs/planning/model-workbench.md
// 的定稿一致）：Catalog / ProfileRepository / 仲裁 / 侧车仓库（Undo+Bindings+Validations+
// Recovery）/ RouteProvisioner / Validator / Candidates。
//
// 与旧分支的差异（重实现时按 0.1.6-alpha.2 装机源码逐条核对，非机械搬运）：
//   ① 数据源只剩 pi-ai 内置目录（旧分支头的 product 决定：models.dev 已移除——pi-ai 目录
//      本就是它的已消化生成物，主流渠道零损失）。遗留的 models-dev 适配器**不再移植**。
//   ② 模型 id 契约放宽：`dsh-llm-pi-ai` 只要求非空字符串，插件仅拒控制字符与超长。
//   ③ 内置渠道的能力字段由目录继承，展示判定走 looseCapabilities（写路径仍全量严格）。
//
// 安全教义（每个端点都要过一遍）：
//   - 零输入拼接：不接受来自浏览器的 URL、包名、命令、路径。在线发现只请求宿主从
//     settings 读出的 baseURL，经 `probeBaseURLCheck` 公网护栏；模型 id/显示名等字符串
//     只作为数据写入 settings（走 llm-pi-ai 自身 schema 校验），绝不进 shell/路径/命令。
//   - 客户端只回传服务端自己签发的标识（sid / planId / inspectId / draftId）：所有取值
//     由服务端按清单重放，客户端无法伪造字段值（`applySuggestions` 对未知 sid 整体拒绝）。
//   - 先记录后变更：破坏性写入前把可回滚状态（写前完整 profile 快照）持久化到侧车，
//     两段式确认由客户端承载，宿主侧以 fingerprint 复检拒绝并发覆盖。

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lookup as dnsLookup } from 'node:dns/promises'
import { brotliDecompress, gunzip } from 'node:zlib'
import https from 'node:https'

/** DSH 包名（目录定位用；DSH 由宿主安装，不作为插件依赖打包）。 */
const DSH_PACKAGE = '@deepseek-ai/dsh'
/** pi-ai 内置目录相对 DSH 包根的路径（data/*.json 每文件一个渠道）。 */
const PI_AI_DATA_SUBPATH = ['node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data']

/** 侧车（写前快照 / 绑定 / 验证摘要）单文件分区；schemaVersion 不匹配即 fail-closed。 */
const WORKBENCH_SIDECAR_VERSION = 1
const WORKBENCH_SIDECAR_FILE = 'dsh-service-model-workbench.json'
/** 计划/检查句柄 TTL：30 分钟无活动过期（与定稿一致，无计时器，按时间戳判定）。 */
const WORKBENCH_PLAN_TTL_MS = 30 * 60 * 1000
/** 句柄 Map 上限：超限淘汰最旧一条（内存只放未消费的短命句柄）。 */
const WORKBENCH_MAX_HANDLES = 32

// ── P3.5 补充源：modelparams.dev（仅思考档位与输出上限，不表态容量/视觉）─────────
// 定位：pi-ai 内置目录是主源（本机 DSH 已消化生成物），modelparams.dev 只补「目录未表态」
// 的思考档位。它不参与 contextWindow/input 的仲裁——那两处口径以 pi-ai 与运行时实测为准。
// 网络纪律：快照式、ETag 条件刷新、动作驱动（进页零网络）、8MB 上限、0600 原子写。
/** 补充目录接口（固定域名常量，浏览器不参与拼装）。 */
const MODEL_PARAMS_API_URL = 'https://modelparams.dev/api/v1/models.json'
const MODEL_PARAMS_CATALOG_FILE = 'dsh-service-modelparams.json'
const MODEL_PARAMS_CATALOG_VERSION = 1
const MAX_MODELS_CATALOG_BYTES = 8 * 1024 * 1024
const MODELS_CATALOG_TIMEOUT_MS = 15000
/** 失败退避：30 分钟内同会话不再自动重试（手动 force 不受限）。 */
const MODELS_CATALOG_BACKOFF_MS = 30 * 60 * 1000
/** 会话内单飞的会话槽上限（超出淘汰最旧）。 */
const MAX_FRESH_SESSIONS = 8
/** modelparams.dev 中表达「档位式思考」的参数路径（其余 thinking.* 为 toggle/预算制，不表态）。 */
const MODEL_PARAMS_EFFORT_PATHS = new Set(['reasoning_effort', 'output_config.effort', 'reasoning.effort'])

/** 在线发现（{baseURL}/models）与响应上限。 */
const MODELS_PROBE_TIMEOUT_MS = 10000
const MAX_MODELS_PROBE_BYTES = 4 * 1024 * 1024
/** 解压后上限：与传输上限分开，防压缩炸弹（与目录抓取同一口径）。 */
const MAX_MODELS_PROBE_INFLATED_BYTES = 8 * 1024 * 1024
/** 模型表上限与字段上限（写前自检用；超出即拒绝而非静默截断）。 */
const MAX_MODELS_PROFILE_ROWS = 200
const MAX_MODEL_ID_LENGTH = 256
/** 临时密钥上限（新路由事务的 key 只进内存，验证后经凭据事务落盘）。 */
const MAX_MODELS_KEY_LENGTH = 4096

/** DSH 思考等级固定 7 档（pi-ai ThinkingLevel 类型锁死）——超档值只能丢弃。 */
const THINKING_LEVELS_SET = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
/** 官方 LISTABLE_PROTOCOLS 同款：只有这两个协议有可读的 {baseURL}/models 列表。 */
const MODELS_PROBE_PROTOCOLS = new Set(['openai-completions', 'openai-responses'])
/** 自定义路由可声明的协议白名单（llm-pi-ai supportedProtocols 同款）。 */
const MODELS_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
/** 官方 CustomProviderCard 同款 route 正则。 */
const MODELS_ROUTE_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
/** 凭据 ref 文法 = POSIX shell 标识符（credentials 服务同款校验）。 */
const MODELS_KEY_REF_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
/** 模型 id 契约（v0.43 放宽）：上游 wire id 原样保留，仅拒控制字符与超长。
 * 旧白名单正则会拒掉 amazon.nova-*:0、@cf/*、*:free 等真实 ID（实测 pi-ai 目录 84 个不匹配）。 */
const MODEL_ID_RE = /^[^\p{Cc}]{1,256}$/u

/** 写路径的模型字段全集（仲裁只对这些字段产出建议）。 */
const META_FIELDS = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts']
/** 建议条目上的内部键：重放到 models 数组时必须剥掉，绝不写进 settings。 */
const SUGGESTION_INTERNAL_KEYS = new Set(['inexpressible', 'selected', 'source'])

/** 探测 DNS 解析的可替换 holder（默认 node:dns/promises lookup；测试注入假解析，生产不变）。 */
export const modelsProbeLookup = { impl: dnsLookup }

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ─────────────────────────────────────────────────────────────────────────────
// 规范化与指纹
// ─────────────────────────────────────────────────────────────────────────────

/** 键排序的稳定序列化：任何字段漂移都会改变指纹（含未知字段，保真读取的基线）。 */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** 完整 route profile 的规范化 SHA-256（settings revision 缺失时的冲突检测基线）。 */
export function profileFingerprint(profile) {
  return createHash('sha256').update(stableStringify(profile ?? null)).digest('hex')
}

/** 确定性建议 id：值变则 id 变，服务端重算可复现（客户端只回传 sid，无法伪造取值）。 */
export function suggestionId({ route, modelId, kind, field, from, to }) {
  const text = stableStringify([route, modelId, kind, field ?? null, from ?? null, to ?? null])
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** 计划 id 的 HMAC：随机盐进程级，客户端拿到也无法自己造一个合法 planId。 */
const planSecret = randomBytes(32)
export function planIdFor(text) {
  return createHmac('sha256', planSecret).update(text).digest('hex').slice(0, 32)
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog：settings 读面 + pi-ai 内置目录
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 保真读取 llm-pi-ai.providers（**不做字段裁剪**）。
 *
 * 与 index.js 的 `readLlmProviders`（配额用投影，只留 name/displayName/baseURL/apiKeyEnv）
 * 分开是刻意的：工作台的读-改-写必须拿完整 profile 当基线，任何裁剪都会在下一次写回时
 * 静默抹掉 input/reasoningEfforts/compat/未知键（旧版投影的真实事故）。
 */
export function readLlmProfiles(settings) {
  let section
  try {
    section = typeof settings?.get === 'function' ? settings.get('llm-pi-ai') : undefined
  } catch (_) {
    return []
  }
  const providers = section?.providers
  if (typeof providers !== 'object' || providers === null) return []
  return Object.entries(providers)
    .filter(([route]) => typeof route === 'string' && route.length > 0 && route.length <= 128)
    .slice(0, 256)
    .map(([route, profile]) => ({
      route,
      displayName: typeof profile?.displayName === 'string' && profile.displayName.length > 0 ? profile.displayName.slice(0, 128) : route,
      api: typeof profile?.api === 'string' ? profile.api.slice(0, 64) : '',
      baseURL: typeof profile?.baseURL === 'string' ? profile.baseURL.trim().slice(0, 2048) : '',
      apiKeyEnv: typeof profile?.apiKeyEnv === 'string' ? profile.apiKeyEnv : '',
      // 模型条目原样浅拷贝（保留 input/reasoningEfforts/compat/未知键），绝不裁剪截断。
      models: Array.isArray(profile?.models)
        ? profile.models.map((model) => (isPlainObject(model) ? { ...model } : model))
        : [],
    }))
    .filter((profile) => profile.route !== '')
}

/** 官方 deriveKeyRef 同款：route 大写化、非字母数字→`_`。 */
export function deriveKeyRefFor(route) {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** 路由查询面 baseURL：settings 显式值优先；空值时回落 pi-ai 内置渠道同名条目的 baseUrl
 * （内置渠道的 baseUrl 常只在注册表数据里，settings 不写）。仍为空 → 上层报 no-base-url。 */
export function resolveLlmProfileBaseURL(profile, piIndex) {
  const explicit = typeof profile?.baseURL === 'string' ? profile.baseURL.trim() : ''
  if (explicit !== '') return explicit
  const channels = Array.isArray(piIndex?.channels) ? piIndex.channels : []
  const channel = channels.find((candidate) => candidate.id === profile?.route)
  return typeof channel?.baseUrl === 'string' && channel.baseUrl !== '' ? channel.baseUrl : ''
}

/** URL → 规范化 hostname（小写、去尾点）；非 HTTPS 或非法返回 undefined。 */
export function hostnameOf(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  let parsed
  try {
    parsed = new URL(raw.trim())
  } catch (_) {
    return undefined
  }
  if (parsed.protocol !== 'https:') return undefined
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  return host === '' ? undefined : host
}

/** 路由 baseURL 规范化：去尾斜杠、容忍尾部 /v1 差异（匹配用）。 */
export function normalizeBaseURLForMatch(raw) {
  if (typeof raw !== 'string') return ''
  let value = raw.trim().replace(/\/+$/, '')
  if (/\/v1$/i.test(value)) value = value.replace(/\/v1$/i, '')
  return value.toLowerCase()
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch (_) {
    return null
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '')
  } catch (_) {
    return ''
  }
}

/**
 * pi-ai 的 thinkingLevelMap → DSH 的 reasoningEfforts（零推导，越档丢弃）。
 *
 * `off` 语义坑（pi-ai 目录与 llm-pi-ai 约定不一致）：llm-pi-ai 要求 dict 显式写 `off:`
 * （空值/null）才声明「支持关闭」，未声明会被钉成 null（= 不支持关闭）；而 pi-ai 目录里
 * off 缺省即「支持关闭」。故只要有任一非 off 档就补 `off: null`。
 */
export function piAiReasoningEfforts(thinkingLevelMap, reasoning) {
  if (reasoning !== true || !isPlainObject(thinkingLevelMap)) return undefined
  const map = {}
  let hasLevel = false
  for (const level of THINKING_LEVELS_SET) {
    const wire = thinkingLevelMap[level]
    if (wire === undefined) continue
    if (wire === null) {
      if (level === 'off') map.off = null
      continue
    }
    if (typeof wire !== 'string' || wire === '') continue
    map[level] = wire
    if (level !== 'off') hasLevel = true
  }
  if (!hasLevel) return undefined
  if (!('off' in map)) map.off = null
  return map
}

/**
 * pi-ai 内置目录（data/*.json）→ 索引。texts = {渠道名: 文件文本}，纯函数便于测试。
 *
 * 产出：channels（去重后的渠道+地址）、channelIds、byHost、byModelId（跨渠道同名模型候选）、
 * whiteHosts。`{location}` 型模板地址不可能是任何路由的事实源，不进 channels/whiteHosts，
 * 但仍保留 channelIds（内置渠道判定与地址无关）。
 */
export function buildPiAiIndex(texts) {
  const channels = []
  const channelIds = new Set()
  const byHost = new Map()
  const byModelId = new Map()
  const whiteHosts = new Set()
  for (const [channel, text] of Object.entries(texts)) {
    if (channel === '' || channel.startsWith('.')) continue
    let data
    try {
      data = JSON.parse(text)
    } catch (_) {
      continue
    }
    const seenHosts = new Set()
    let channelHasEntry = false
    for (const group of Object.values(data ?? {})) {
      if (!isPlainObject(group)) continue
      for (const entry of Object.values(group)) {
        if (!isPlainObject(entry)) continue
        channelHasEntry = true
        const baseUrl = typeof entry.baseUrl === 'string' && entry.baseUrl.trim() !== '' ? entry.baseUrl.trim() : ''
        const host = hostnameOf(baseUrl)
        if (host !== undefined && !host.includes('{')) {
          whiteHosts.add(host)
          if (!seenHosts.has(host)) {
            seenHosts.add(host)
            channels.push({ id: channel, name: channel, baseUrl, host })
            if (!byHost.has(host)) byHost.set(host, [])
            byHost.get(host).push({ id: channel, name: channel, baseUrl, host })
          }
        }
        const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : ''
        if (id === '') continue
        const record = {
          channel,
          provider: typeof entry.provider === 'string' ? entry.provider : channel,
          name: typeof entry.name === 'string' ? entry.name : id,
          baseUrl,
          reasoning: entry.reasoning === true,
          contextWindow: Number.isInteger(entry.contextWindow) ? entry.contextWindow : undefined,
          maxTokens: Number.isInteger(entry.maxTokens) ? entry.maxTokens : undefined,
          input: Array.isArray(entry.input) && entry.input.length > 0
            ? entry.input.filter((mode) => mode === 'text' || mode === 'image').slice(0, 2)
            : undefined,
          reasoningEfforts: piAiReasoningEfforts(entry.thinkingLevelMap, entry.reasoning),
        }
        if (!byModelId.has(id)) byModelId.set(id, [])
        byModelId.get(id).push(record)
      }
    }
    if (channelHasEntry) channelIds.add(channel)
  }
  return { channels, channelIds, byHost, byModelId, whiteHosts }
}

/** 定位 @deepseek-ai/dsh 包入口：require.resolve → 向上扫 node_modules → 常见全局目录。 */
export function locateDshPackageJson() {
  try {
    return import.meta.resolve?.(`${DSH_PACKAGE}/package.json`)
  } catch (_) {
    // 继续：import.meta.resolve 在部分宿主不可用
  }
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const candidate = join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const base of ['/usr/local/lib/node_modules', '/usr/lib/node_modules']) {
    const candidate = join(base, '@deepseek-ai', 'dsh', 'package.json')
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** 读取 pi-ai 内置目录；布局漂移或未安装时返回空索引（调用方降级，不判失败）。 */
export async function loadPiAiCatalog() {
  const dshEntry = locateDshPackageJson()
  if (dshEntry === null) return buildPiAiIndex({})
  // import.meta.resolve 可能给 file:// URL，统一成路径再拼子路径。
  const entryPath = typeof dshEntry === 'string' && dshEntry.startsWith('file://') ? fileURLToPath(dshEntry) : dshEntry
  const piDir = join(dirname(entryPath), ...PI_AI_DATA_SUBPATH)
  try {
    const files = await readdir(piDir)
    const texts = {}
    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue
      const channel = file.slice(0, -5)
      if (channel.includes('.bak')) continue
      try {
        texts[channel] = await readFile(join(piDir, file), 'utf8')
      } catch (_) {
        // 单文件读取失败跳过，其余照常（部分目录可用优于整体失败）
      }
    }
    return buildPiAiIndex(texts)
  } catch (_) {
    return buildPiAiIndex({})
  }
}

/** 目录元数据候选（统一形状，供仲裁）：一个模型 id 可能跨多个渠道存在。 */
export function modelMetaCandidates(piIndex, modelId) {
  const metas = []
  for (const record of piIndex?.byModelId?.get(modelId) ?? []) {
    metas.push({
      source: 'pi-ai',
      providerId: record.channel,
      name: record.name,
      baseUrl: record.baseUrl,
      reasoning: record.reasoning === true,
      contextWindow: record.contextWindow,
      maxTokens: record.maxTokens,
      input: record.input,
      reasoningEfforts: record.reasoningEfforts,
      dropped: [],
    })
  }
  return metas
}

/** 多源共识字段（逐字段收集各来源表态）。 */
const CONSENSUS_FIELDS = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts']

/**
 * 字段级多来源共识：对一组带 source/providerId 的候选元数据，逐字段收集「表态」来源。
 * 全部一致 → `{status:'agreed', value, sources}`；存在不一致 → `{status:'split', sources}`
 * （value 缺省，客户端必须逐源选择，不武断给单一建议）；无来源表态 → 该字段缺席。
 * 候选顺序即优先级（同渠道 pi-ai → 跨渠道 pi-ai → modelparams → runtime 实测）。
 */
export function consensusFields(candidates) {
  const result = {}
  for (const field of CONSENSUS_FIELDS) {
    const sources = []
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const value = candidate?.[field]
      if (value === undefined) continue
      const entry = {
        source: candidate.source,
        ...(typeof candidate.providerId === 'string' && candidate.providerId !== '' ? { providerId: candidate.providerId } : {}),
        value,
      }
      if (!sources.some((existing) => (
        existing.source === entry.source
        && existing.providerId === entry.providerId
        && stableStringify(existing.value) === stableStringify(entry.value)
      ))) sources.push(entry)
    }
    if (sources.length === 0) continue
    const first = stableStringify(sources[0].value)
    const agreed = sources.every((entry) => stableStringify(entry.value) === first)
    result[field] = agreed ? { status: 'agreed', value: sources[0].value, sources } : { status: 'split', sources }
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 公网护栏与在线发现
// ─────────────────────────────────────────────────────────────────────────────

const PRIVATE_IPV4_CIDRS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['198.18.0.0', 15],
  ['192.0.2.0', 24], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]

function ipv4ToInt(address) {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value << 8) | octet
  }
  return value >>> 0
}

/** IPv4 保留段判定（每点分段按十进制解析，`0x`/前导零的十进制解释已在段正则里拒绝）。 */
export function isPrivateIpv4(address) {
  const value = ipv4ToInt(address)
  if (value === null) return false
  for (const [network, bits] of PRIVATE_IPV4_CIDRS) {
    const base = ipv4ToInt(network)
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if ((value & mask) === (base & mask)) return true
  }
  return false
}

/** 私网/保留地址判定（IPv4 段 + IPv6 回环/链路本地/唯一本地/组播/文档段）。 */
export function isPrivateIpAddress(address) {
  if (typeof address !== 'string' || address === '') return false
  const bare = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  // IPv4 映射形态 ::ffff:1.2.3.4 按其 IPv4 部分判定
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(bare)
  if (mapped !== null) return isPrivateIpv4(mapped[1])
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) return isPrivateIpv4(bare)
  const lower = bare.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true
  if (/^2001:db8:/.test(lower)) return true
  return false
}

/** 拒绝 DNS 解析到的私网/保留地址：任一解析结果落在保留段即整体拒绝（防 rebinding）。 */
export async function assertPublicHost(host) {
  const results = await modelsProbeLookup.impl(host, { all: true })
  const rows = Array.isArray(results) ? results : [results]
  if (rows.length === 0) throw new Error('probe-dns-empty')
  for (const row of rows) {
    const address = typeof row?.address === 'string' ? row.address : ''
    if (address === '' || isPrivateIpAddress(address)) throw new Error('probe-not-public')
  }
  return rows
}

/**
 * 在线发现的地址护栏（v0.43：任意公网 HTTPS，取消 pi-ai 白名单——白名单使任意中转网关
 * 无法在线发现）。SSRF 面由 HTTPS-only + 端口空或 443 + 拒 IP 字面量/模板 + DNS 保留段
 * 拒绝 + 钉住直连 IP 带 Host 头兜住。非公网/HTTP/非 443 地址仍允许保存与手填，只是禁在线发现。
 */
export function probeBaseURLCheck(baseURL) {
  let parsed
  try {
    parsed = new URL(typeof baseURL === 'string' ? baseURL.trim() : '')
  } catch (_) {
    return { ok: false, code: 'bad-base-url' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, code: 'probe-insecure' }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, code: 'probe-credentials' }
  if (parsed.port !== '' && parsed.port !== '443') return { ok: false, code: 'probe-bad-port' }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === '' || host.includes('{')) return { ok: false, code: 'probe-bad-host' }
  // 拒 IP 字面量：钉住直连的前提是「域名 → DNS → 公网地址」，字面量绕过整条链。
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare) || bare.includes(':')) return { ok: false, code: 'probe-ip-literal' }
  return { ok: true, parsed, host }
}

/**
 * 取一次 {baseURL}/models 列表：DNS 全地址公网校验 → 钉住首个解析地址直连（带 Host 头，
 * 防 DNS rebinding）→ 不跟随重定向 → 10s 超时 → 传输 ≤4MB 且解压后 ≤8MB。
 * 列表解析产出 {id, name, contextWindow, maxTokens}，超长/重复 id 跳过不截断。
 */
export async function fetchModelsProbe(baseURL, apiKey) {
  const checked = probeBaseURLCheck(baseURL)
  if (!checked.ok) throw new Error(checked.code)
  const parsed = checked.parsed
  const addresses = await assertPublicHost(checked.host)
  const pinned = typeof addresses[0]?.address === 'string' ? addresses[0].address : ''
  if (pinned === '') throw new Error('probe-dns-empty')
  const path = `${parsed.pathname.replace(/\/+$/, '')}/models${parsed.search}`
  const headers = { host: parsed.hostname, accept: 'application/json' }
  if (typeof apiKey === 'string' && apiKey !== '') headers.authorization = `Bearer ${apiKey}`
  const body = await new Promise((resolve, reject) => {
    const request = https.request(
      {
        host: pinned, port: 443, path, method: 'GET', headers, timeout: MODELS_PROBE_TIMEOUT_MS,
        // 证书按 Host 头校验的目标域名验证，直连 IP 不改变 TLS 身份。
        servername: parsed.hostname,
      },
      (response) => {
        const status = response.statusCode ?? 0
        // 不跟随重定向：3xx 视为失败（拦 SSRF 跳板）。
        if (status >= 300 && status < 400) {
          response.resume()
          reject(new Error(`probe-redirect:${status}`))
          return
        }
        if (status < 200 || status >= 300) {
          response.resume()
          reject(new Error(`probe-status:${status}`))
          return
        }
        const chunks = []
        let received = 0
        response.on('data', (chunk) => {
          received += chunk.length
          if (received > MAX_MODELS_PROBE_BYTES) {
            request.destroy(new Error('probe-too-large'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        response.on('error', reject)
      },
    )
    request.on('timeout', () => request.destroy(new Error('probe-timeout')))
    request.on('error', reject)
    request.end()
  })
  if (Buffer.byteLength(body, 'utf8') > MAX_MODELS_PROBE_INFLATED_BYTES) throw new Error('probe-too-large')
  return parseModelListing(body)
}

/** {baseURL}/models 响应 → 规范化候选行（宽容各家字段名，id 必需）。 */
export function parseModelListing(body) {
  let payload
  try {
    payload = JSON.parse(body)
  } catch (_) {
    throw new Error('probe-bad-json')
  }
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.models) ? payload.models
        : []
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (!isPlainObject(row)) continue
    const rawId = typeof row.id === 'string' ? row.id.trim() : typeof row.name === 'string' ? row.name.trim() : ''
    // 超长/重复 id 跳过而不截断：截断会造成前缀碰撞，把两个模型压成一个。
    if (rawId === '' || rawId.length > MAX_MODEL_ID_LENGTH || seen.has(rawId)) continue
    seen.add(rawId)
    const contextWindow = Number.isInteger(row.context_window) ? row.context_window
      : Number.isInteger(row.context_length) ? row.context_length
        : Number.isInteger(row.contextWindow) ? row.contextWindow : undefined
    const maxTokens = Number.isInteger(row.max_output_tokens) ? row.max_output_tokens
      : Number.isInteger(row.max_tokens) ? row.max_tokens
        : Number.isInteger(row.maxTokens) ? row.maxTokens : undefined
    const entry = { id: rawId }
    if (typeof row.name === 'string' && row.name.trim() !== '') entry.name = row.name.trim().slice(0, 128)
    if (contextWindow !== undefined && contextWindow > 0) entry.contextWindow = contextWindow
    if (maxTokens !== undefined && maxTokens > 0) entry.maxTokens = maxTokens
    out.push(entry)
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// P3.5 补充源：modelparams.dev 快照、刷新与索引
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 动作驱动的补充源新鲜度（无 TTL + 会话内单飞）。
 * - freshKey 同名（同一客户端会话）共享一次条件请求（在途合并、成功后复用同一 Promise）；
 * - 缺失/非法 freshKey 由调用方给唯一键，绝不共享；
 * - 30 分钟失败退避（force=true 不受限，但在途请求仍单飞合并；无快照同样生效）；
 * - 失败保留旧快照继续（result.staleError 供调用方提示），refresh 永不 reject 外漏；
 * - 退避状态（lastError/lastAttemptAt）由本管理器写入 state——调用方只读展示。
 */
export function createFreshnessManager(getState, refresh, { backoffMs = MODELS_CATALOG_BACKOFF_MS, maxSessions = MAX_FRESH_SESSIONS } = {}) {
  const settled = new Map()
  const inFlight = new Map()
  return {
    refreshed(freshKey, force = false) {
      const pending = inFlight.get(freshKey)
      if (pending !== undefined) return pending
      if (!force && settled.has(freshKey)) return settled.get(freshKey)
      const state = getState()
      if (!force && state.lastError !== null && Date.now() - state.lastAttemptAt < backoffMs) {
        const stale = Promise.resolve({ snapshot: state.snapshot, source: 'snapshot', staleError: state.lastError })
        settled.set(freshKey, stale)
        if (settled.size > maxSessions) settled.delete(settled.keys().next().value)
        return stale
      }
      state.lastAttemptAt = Date.now()
      const flight = refresh().then(
        (value) => {
          state.lastError = null
          return value
        },
        (error) => {
          const message = error?.message || String(error)
          state.lastError = message
          return { snapshot: state.snapshot, source: 'snapshot', staleError: message }
        },
      )
      inFlight.set(freshKey, flight)
      flight.then((value) => {
        inFlight.delete(freshKey)
        if (value?.staleError === undefined) {
          settled.set(freshKey, flight)
          if (settled.size > maxSessions) settled.delete(settled.keys().next().value)
        }
      }, () => {})
      return flight
    },
    drop(freshKey) {
      settled.delete(freshKey)
      inFlight.delete(freshKey)
    },
  }
}

/** 读快照：缺文件/非法 JSON/schemaVersion 不匹配/结构非法/非法 fetchedAt → null（fail-closed）。 */
export async function loadModelParamsSnapshot(dshHome) {
  const target = join(dshHome, MODEL_PARAMS_CATALOG_FILE)
  try {
    const info = await stat(target)
    // 磁盘上限放宽一倍（保存的是已解析结构，可能比传输体略大），过大即判损坏。
    if (info.size > MAX_MODELS_CATALOG_BYTES * 2) return null
    const raw = JSON.parse(await readFile(target, 'utf8'))
    if (raw?.schemaVersion !== MODEL_PARAMS_CATALOG_VERSION) return null
    if (!isPlainObject(raw?.catalog)) return null
    if (typeof raw.fetchedAt !== 'number' || !Number.isFinite(raw.fetchedAt)) return null
    return { fetchedAt: raw.fetchedAt, etag: typeof raw.etag === 'string' ? raw.etag : '', catalog: raw.catalog }
  } catch (_) {
    return null
  }
}

/** 0600 原子写（临时文件 + rename）。 */
export async function saveModelParamsSnapshot(dshHome, snapshot) {
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, MODEL_PARAMS_CATALOG_FILE)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ schemaVersion: MODEL_PARAMS_CATALOG_VERSION, ...snapshot }), { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** 条件请求补充目录：304 续期、200 换内容、传输 ≤8MB 且解压后 ≤8MB、根必须是 object。 */
export function fetchModelParamsApi(etag, { userAgent = 'dsh-service', timeoutMs = MODELS_CATALOG_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(MODEL_PARAMS_API_URL, {
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, br',
        'user-agent': userAgent,
        ...(typeof etag === 'string' && etag !== '' ? { 'If-None-Match': etag } : {}),
      },
    }, (response) => {
      const status = response.statusCode || 0
      if (status === 304) {
        response.resume()
        resolve({ status: 304, etag: response.headers.etag || etag || '' })
        return
      }
      if (status < 200 || status >= 300) {
        response.resume()
        reject(new Error(`http-status:${status}`))
        return
      }
      const chunks = []
      let bytes = 0
      response.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > MAX_MODELS_CATALOG_BYTES) {
          request.destroy()
          reject(new Error('catalog-too-large'))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', () => reject(new Error('network')))
      response.on('end', () => {
        const encoding = String(response.headers['content-encoding'] || '').toLowerCase()
        const body = Buffer.concat(chunks)
        const finish = (text) => {
          try {
            const data = JSON.parse(text)
            // 根必须是普通 object 且含 models 数组；解压后体积同样封顶（防压缩炸弹）。
            if (!isPlainObject(data)) reject(new Error('bad-payload:shape'))
            else if (!Array.isArray(data.models)) reject(new Error('bad-payload:shape'))
            else if (Buffer.byteLength(text, 'utf8') > MAX_MODELS_CATALOG_BYTES) reject(new Error('catalog-too-large'))
            else resolve({ status: 200, etag: response.headers.etag || '', data })
          } catch (_) {
            reject(new Error('bad-payload:json'))
          }
        }
        if (encoding === 'gzip') {
          gunzip(body, (error, decoded) => {
            if (error) reject(new Error('bad-payload:gzip'))
            else finish(decoded.toString('utf8'))
          })
        } else if (encoding === 'br') {
          brotliDecompress(body, (error, decoded) => {
            if (error) reject(new Error('bad-payload:br'))
            else finish(decoded.toString('utf8'))
          })
        } else {
          finish(body.toString('utf8'))
        }
      })
    })
    request.on('error', (error) => {
      reject(new Error(error?.code === 'ABORT_ERR' ? 'cancelled' : 'network'))
    })
    request.on('timeout', () => {
      request.destroy()
      reject(new Error('timeout'))
    })
    request.end()
  })
}

/** 刷新快照：304 只续期 fetchedAt（零等待），200 换内容；保存成功才替换内存快照。 */
export async function refreshModelParamsSnapshot(dshHome, state, options = {}) {
  if (state.snapshot === null) state.snapshot = await loadModelParamsSnapshot(dshHome)
  const result = await fetchModelParamsApi(state.snapshot?.etag ?? '', options)
  if (result.status === 304) {
    const next = { ...state.snapshot, fetchedAt: Date.now(), etag: result.etag }
    await saveModelParamsSnapshot(dshHome, next)
    state.snapshot = next
    return { snapshot: next, source: 'conditional' }
  }
  const next = { fetchedAt: Date.now(), etag: result.etag, catalog: result.data }
  await saveModelParamsSnapshot(dshHome, next)
  state.snapshot = next
  return { snapshot: next, source: 'network' }
}

/**
 * 补充目录 → byModelId：`{provider, authType, effortValues[], maxTokensMax?}`。
 * 只收 effort 变体参数；`max_tokens` 类的 range.max 作为输出上限参考。形状不合规跳过。
 */
export function indexModelParamsDev(catalog, { maxModelIdLength = MAX_MODEL_ID_LENGTH } = {}) {
  const byModelId = new Map()
  const models = Array.isArray(catalog?.models) ? catalog.models : []
  for (const entry of models) {
    if (!isPlainObject(entry)) continue
    const id = typeof entry.model === 'string' ? entry.model.trim() : ''
    if (id === '' || id.length > maxModelIdLength || !MODEL_ID_RE.test(id)) continue
    const provider = typeof entry.provider === 'string' ? entry.provider : ''
    const params = Array.isArray(entry.params) ? entry.params : []
    const effortValues = []
    let maxTokensMax
    for (const param of params) {
      if (!isPlainObject(param)) continue
      const path = typeof param.path === 'string' ? param.path : ''
      if (MODEL_PARAMS_EFFORT_PATHS.has(path) && Array.isArray(param.values)) {
        for (const value of param.values) {
          if (typeof value === 'string' && !effortValues.includes(value)) effortValues.push(value)
        }
      }
      if (/^(max_tokens|max_completion_tokens|inferenceConfig\.maxTokens|generationConfig\.maxOutputTokens)$/.test(path)) {
        const max = param?.range?.max
        if (Number.isInteger(max) && max > 0 && (maxTokensMax === undefined || max > maxTokensMax)) maxTokensMax = max
      }
    }
    if (provider === '' || effortValues.length === 0) continue
    if (!byModelId.has(id)) byModelId.set(id, [])
    byModelId.get(id).push({
      provider,
      authType: typeof entry.authType === 'string' ? entry.authType : 'api_key',
      apiSurface: typeof entry.apiSurface === 'string' ? entry.apiSurface : '',
      ...(effortValues.length > 0 ? { effortValues } : {}),
      ...(maxTokensMax !== undefined ? { maxTokensMax } : {}),
    })
  }
  return byModelId
}

/** 补充记录们 → reasoningEfforts：合并全部 effort values，none→off(null)，只留 DSH 7 档内档位；
 * 无任何可表达档位返回 undefined（toggle/预算制不表态）。 */
export function modelParamsDevEfforts(records) {
  const map = {}
  let hasLevel = false
  for (const record of Array.isArray(records) ? records : []) {
    for (const raw of record?.effortValues ?? []) {
      const level = raw === 'none' ? 'off' : raw
      if (!THINKING_LEVELS_SET.has(level)) continue
      if (level === 'off') map.off = null
      else {
        map[level] = level
        hasLevel = true
      }
    }
  }
  if (!hasLevel) return undefined
  if (!('off' in map)) map.off = null
  return map
}

/** 补充源候选项（统一形状，供共识仲裁；只表态 reasoningEfforts 与 maxTokens 上限）。 */
export function modelParamsCandidates(catalog, modelId) {
  const records = indexModelParamsDev(catalog).get(modelId)
  if (records === undefined || records.length === 0) return []
  const efforts = modelParamsDevEfforts(records)
  const maxTokens = records[0].maxTokensMax
  return [{
    source: 'modelparams',
    providerId: records[0].provider,
    ...(efforts !== undefined ? { reasoningEfforts: efforts } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  }]
}

// ─────────────────────────────────────────────────────────────────────────────
// 写前自检
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 模型表全量自检（与 llm-pi-ai 的 assertServiceable 同向但更早失败，稳定错误码）。
 *
 * looseCapabilities：展示判定专用。内置渠道的能力字段由目录继承（官方 resolveRouteModels
 * 对缺失/空值回落目录 base），空值/null/省略都不构成「配置有误」；写路径一律严格。
 */
export function selfCheckModelsPatch(models, { looseCapabilities = false } = {}) {
  const errors = []
  if (!Array.isArray(models) || models.length === 0) return { ok: false, errors: ['empty-models'] }
  const seen = new Set()
  for (const [index, model] of models.entries()) {
    const label = `#${index + 1}`
    const id = model?.id
    if (typeof id !== 'string' || id.trim() === '' || id.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_RE.test(id)) {
      errors.push(`${label}:${model?.id ?? ''}|bad-id`)
      continue
    }
    if (seen.has(id)) {
      errors.push(`${label}:${id}|duplicate`)
      continue
    }
    seen.add(id)
    if (model.name !== undefined && (typeof model.name !== 'string' || model.name.length > 128)) errors.push(`${label}:${id}|bad-name`)
    if (model.contextWindow !== undefined && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) errors.push(`${label}:${id}|bad-context`)
    if (model.maxTokens !== undefined && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) errors.push(`${label}:${id}|bad-max-tokens`)
    if (looseCapabilities) continue
    if (model.input !== undefined) {
      if (!Array.isArray(model.input) || model.input.length === 0 || model.input.some((mode) => mode !== 'text' && mode !== 'image')) {
        errors.push(`${label}:${id}|bad-input`)
      }
    }
    if (model.reasoningEfforts !== undefined && model.reasoningEfforts !== false) {
      const efforts = model.reasoningEfforts
      if (!isPlainObject(efforts)) {
        errors.push(`${label}:${id}|bad-efforts`)
      } else {
        let hasLevel = false
        for (const [level, wire] of Object.entries(efforts)) {
          if (!THINKING_LEVELS_SET.has(level)) {
            errors.push(`${label}:${id}|bad-efforts`)
            break
          }
          // off 宽容：null 或空串都表示「支持关闭、不发送参数」（schemastery 归一化可能给空串）。
          if (wire !== null && !(level === 'off' && wire === '')) {
            if (typeof wire !== 'string' || wire.length === 0) {
              errors.push(`${label}:${id}|bad-efforts`)
              break
            }
            if (level !== 'off') hasLevel = true
          }
        }
        if (!hasLevel) errors.push(`${label}:${id}|no-effort-level`)
      }
    }
  }
  if (models.length > MAX_MODELS_PROFILE_ROWS) errors.push('too-many-models')
  return { ok: errors.length === 0, errors }
}

/** 目录条目 → settings 模型补丁（零推导）。 */
export function modelPatchFromPiAi(record) {
  return {
    id: record.id ?? '',
    ...(typeof record.name === 'string' && record.name !== '' ? { name: record.name } : {}),
    ...(Number.isInteger(record.contextWindow) ? { contextWindow: record.contextWindow } : {}),
    ...(Number.isInteger(record.maxTokens) ? { maxTokens: record.maxTokens } : {}),
    ...(Array.isArray(record.input) && record.input.length > 0 ? { input: [...record.input] } : {}),
    ...(record.reasoningEfforts !== undefined ? { reasoningEfforts: { ...record.reasoningEfforts } } : {}),
  }
}

/** 新建路由的 profile（凭据先行：storesKey 为真才写 apiKeyEnv 引用）。 */
export function buildRouteCreateProfile({ route, displayName, api, baseURL, models, storesKey }) {
  return {
    ...(typeof displayName === 'string' && displayName !== '' ? { displayName: displayName.slice(0, 128) } : {}),
    ...(storesKey ? { apiKeyEnv: deriveKeyRefFor(route) } : {}),
    api,
    baseURL,
    models,
  }
}

/** 显示名 → kebab-case route 建议；不合法回落 'provider'，与 taken 冲突时追加 -2/-3…。 */
export function suggestRouteId(displayName, taken = []) {
  const takenSet = new Set(Array.isArray(taken) ? taken : [])
  const baseRaw = String(displayName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  const base = MODELS_ROUTE_RE.test(baseRaw) ? baseRaw : 'provider'
  let candidate = base
  let counter = 2
  while (takenSet.has(candidate)) {
    candidate = `${base}-${counter}`
    counter += 1
  }
  return candidate
}

// ─────────────────────────────────────────────────────────────────────────────
// 仲裁：现有配置 × 网关实时列表 × 目录元数据 → 分类建议清单
// ─────────────────────────────────────────────────────────────────────────────

const valueEquals = (a, b) => stableStringify(a) === stableStringify(b)

function sourceOf(meta) {
  return {
    source: meta.source,
    providerId: meta.providerId,
    ...(typeof meta.baseUrl === 'string' ? { baseUrl: meta.baseUrl } : {}),
    confidence: meta.confidence,
    via: meta.via,
  }
}

/**
 * 单路由检查仲裁。
 * - safeFill：已配置模型缺失字段且有目录值 → 高置信默认勾选、低置信 needsConfirm 不勾；
 *   **同渠道内置目录已提供的字段跳过**——运行时对缺失字段回落目录 base（缺失 ≠ 能力缺失，
 *   修复 opencode-go 误报「需补思考等级」）。
 * - conflict：已配置模型与来源值不同 → 默认不勾；歧义匹配（多候选无法精确定位）时只有
 *   目录达成共识才敢建议（cpa gpt-5.6-sol 曾被空 baseUrl 的 azure 模板渠道建议改成 off/xhigh/max）。
 * - addition：未配置模型 → 默认不勾；dropped 等级挂 inexpressible。
 * - unknown：已配置但在线列表未返回 → 保留不动，**绝不建议删除**（缺席 ≠ 不支持）。
 * 置信度：目录提供方 baseURL 与路由精确同 host+路径 → high；有持久化绑定 → high；
 * 跨提供方同名且无绑定 → low（needsConfirm）。
 */
export function arbitrateModelSuggestions({ route, routeBaseURL, currentModels, gatewayModels, resolveModelMeta, bindings = {} }) {
  const suggestions = []
  const currentById = new Map(
    (Array.isArray(currentModels) ? currentModels : [])
      .map((model) => [typeof model?.id === 'string' ? model.id : '', model])
      .filter(([id]) => id !== ''),
  )
  const gatewayIds = new Set(
    (Array.isArray(gatewayModels) ? gatewayModels : [])
      .map((row) => (typeof row?.id === 'string' ? row.id : ''))
      .filter((id) => id !== ''),
  )
  const routeHost = hostOf(routeBaseURL)
  const routePath = pathOf(routeBaseURL)

  /** 带地址候选池：有非空 baseUrl 候选时只留它们（模板渠道不能当路由事实源），全空才回退全部。 */
  const hostedPool = (candidates) => {
    const hosted = candidates.filter((candidate) => typeof candidate?.baseUrl === 'string' && candidate.baseUrl !== '')
    return hosted.length > 0 ? hosted : candidates
  }

  const pickMeta = (candidates, modelId) => {
    if (candidates.length === 0) return undefined
    const binding = bindings[modelId]
    if (binding !== undefined) {
      const bound = candidates.find((candidate) => candidate.source === binding.source && candidate.providerId === binding.providerId)
      if (bound !== undefined) return { ...bound, confidence: 'high', via: 'binding' }
    }
    const pool = hostedPool(candidates)
    const exactPath = pool.filter((candidate) => {
      if (hostOf(candidate.baseUrl) !== routeHost) return false
      const candidatePath = pathOf(candidate.baseUrl)
      return candidatePath !== '' && candidatePath === routePath
    })
    if (exactPath.length === 1) return { ...exactPath[0], confidence: 'high', via: 'exact-route' }
    if (pool.length === 1) {
      const single = pool[0]
      const sameHost = hostOf(single.baseUrl) === routeHost
      return { ...single, confidence: sameHost ? 'high' : 'low', via: sameHost ? 'single-host' : 'single' }
    }
    return { ...pool[0], confidence: 'low', via: 'ambiguous' }
  }

  /** 目录共识：给定字段在所有「定义了该字段」的候选里取值是否唯一一致（未定义的候选不表态）。 */
  const consensusOn = (candidates, field) => {
    let agreedValue
    let any = false
    for (const candidate of hostedPool(candidates)) {
      if (candidate[field] === undefined) continue
      if (!any) {
        agreedValue = candidate[field]
        any = true
        continue
      }
      if (!valueEquals(candidate[field], agreedValue)) return undefined
    }
    return any ? agreedValue : undefined
  }

  for (const [modelId, model] of currentById) {
    const candidates = (resolveModelMeta(modelId) ?? []).filter(isPlainObject)
    const meta = pickMeta(candidates, modelId)
    if (meta === undefined) {
      suggestions.push({ sid: suggestionId({ route, modelId, kind: 'unknown' }), modelId, kind: 'unknown', selected: false })
      continue
    }
    // 同渠道内置目录（providerId === route）：运行时对缺失字段回落目录 base——这些字段是
    // 「继承生效」而非「缺失」。reasoningEfforts 的继承依据是目录记录本身（reasoning:true
    // 即运行时继承思考能力，无 thinkingLevelMap 也成立）。
    const inheritedFields = new Set(META_FIELDS.filter((field) => candidates.some((candidate) => (
      candidate.source === 'pi-ai' && candidate.providerId === route
      && (candidate[field] !== undefined || (field === 'reasoningEfforts' && candidate.reasoning === true))
    ))))
    for (const field of META_FIELDS) {
      const to = meta[field]
      if (to === undefined) continue
      const from = model[field]
      if (from === undefined || from === null) {
        if (inheritedFields.has(field)) continue
        const selected = meta.confidence === 'high'
        suggestions.push({ sid: suggestionId({ route, modelId, kind: 'safeFill', field, from, to }), modelId, kind: 'safeFill', field, from, to, selected, source: sourceOf(meta) })
      } else if (!valueEquals(from, to)) {
        const consensus = meta.via === 'ambiguous' ? consensusOn(candidates, field) : undefined
        if (meta.via === 'ambiguous' && consensus === undefined) continue
        const toValue = consensus !== undefined ? consensus : to
        suggestions.push({ sid: suggestionId({ route, modelId, kind: 'conflict', field, from, to: toValue }), modelId, kind: 'conflict', field, from, to: toValue, selected: false, source: sourceOf(meta) })
      }
    }
    if (!gatewayIds.has(modelId)) {
      suggestions.push({ sid: suggestionId({ route, modelId, kind: 'unknown' }), modelId, kind: 'unknown', selected: false })
    }
  }

  const seenIds = new Set(currentById.keys())
  for (const row of Array.isArray(gatewayModels) ? gatewayModels : []) {
    const modelId = typeof row?.id === 'string' ? row.id : ''
    if (modelId === '' || seenIds.has(modelId)) continue
    seenIds.add(modelId)
    const candidates = (resolveModelMeta(modelId) ?? []).filter(isPlainObject)
    const meta = pickMeta(candidates, modelId)
    const draft = { id: modelId }
    if (typeof row.name === 'string' && row.name !== '') draft.name = row.name
    if (Number.isInteger(row.contextWindow) && row.contextWindow > 0) draft.contextWindow = row.contextWindow
    if (Number.isInteger(row.maxTokens) && row.maxTokens > 0) draft.maxTokens = row.maxTokens
    if (meta !== undefined) {
      if (draft.name === undefined && typeof meta.name === 'string' && meta.name !== '') draft.name = meta.name
      if (draft.contextWindow === undefined && meta.contextWindow !== undefined) draft.contextWindow = meta.contextWindow
      if (draft.maxTokens === undefined && meta.maxTokens !== undefined) draft.maxTokens = meta.maxTokens
      if (meta.input !== undefined) draft.input = meta.input
      if (meta.reasoningEfforts !== undefined) draft.reasoningEfforts = meta.reasoningEfforts
    }
    suggestions.push({
      sid: suggestionId({ route, modelId, kind: 'addition' }),
      modelId,
      kind: 'addition',
      selected: false,
      draft,
      ...(meta !== undefined ? { source: sourceOf(meta) } : {}),
      ...(Array.isArray(meta?.dropped) && meta.dropped.length > 0 ? { inexpressible: meta.dropped } : {}),
    })
  }
  return suggestions
}

// ─────────────────────────────────────────────────────────────────────────────
// 补丁重放与 diff
// ─────────────────────────────────────────────────────────────────────────────

/** 把选中的建议重放到「当前」模型数组：set 只改具名字段（未知键/未选字段原样保留），
 * addition 追加清洗后的草稿。任何 sid 不在清单中 → 整体拒绝（防伪造）。 */
export function applySuggestions(currentModels, suggestions, selectedSids) {
  const bySid = new Map((Array.isArray(suggestions) ? suggestions : []).map((row) => [row.sid, row]))
  const selected = (Array.isArray(selectedSids) ? selectedSids : []).map(String)
  const unknown = selected.filter((sid) => !bySid.has(sid))
  if (unknown.length > 0) throw new Error(`unknown-suggestion:${unknown.join(',')}`)
  const next = (Array.isArray(currentModels) ? currentModels : []).map((model) => (isPlainObject(model) ? { ...model } : model))
  for (const sid of selected) {
    const suggestion = bySid.get(sid)
    if (suggestion.kind === 'addition') {
      const draft = {}
      for (const [key, value] of Object.entries(suggestion.draft ?? {})) {
        if (!SUGGESTION_INTERNAL_KEYS.has(key) && value !== undefined) draft[key] = value
      }
      if (typeof draft.id !== 'string' || draft.id === '') continue
      next.push(draft)
      continue
    }
    const target = next.find((model) => model.id === suggestion.modelId)
    if (target === undefined) continue
    target[suggestion.field] = suggestion.to
  }
  return next
}

/** 两份模型清单的字段级 diff（计划预览用）：changes 逐字段、added/removed 按模型。 */
export function diffModelLists(beforeModels, afterModels) {
  const before = new Map((Array.isArray(beforeModels) ? beforeModels : []).map((model) => [model?.id, model]))
  const after = new Map((Array.isArray(afterModels) ? afterModels : []).map((model) => [model?.id, model]))
  const changes = []
  for (const [id, model] of after) {
    const previous = before.get(id)
    if (previous === undefined || !isPlainObject(previous)) continue
    const fields = new Set([...Object.keys(previous), ...Object.keys(model)])
    for (const field of fields) {
      if (field === 'id') continue
      if (!valueEquals(previous[field], model[field])) {
        changes.push({
          modelId: id,
          field,
          ...(previous[field] === undefined ? {} : { from: previous[field] }),
          ...(model[field] === undefined ? {} : { to: model[field] }),
        })
      }
    }
  }
  const added = [...after.keys()].filter((id) => !before.has(id) && typeof id === 'string')
  const removed = [...before.keys()].filter((id) => !after.has(id) && typeof id === 'string')
  return { changes, added, removed }
}

/** 撤销预览：快照（写前状态）vs 当前。restorable = 本次应用造成的字段差异；addedSince/
 * removedSince = 应用之后发生的增删（默认保留）。 */
export function undoPreviewModels(snapshotModels, currentModels) {
  const snapshot = new Map((Array.isArray(snapshotModels) ? snapshotModels : []).map((model) => [model?.id, model]))
  const current = new Map((Array.isArray(currentModels) ? currentModels : []).map((model) => [model?.id, model]))
  const restorable = []
  for (const [id, model] of current) {
    const previous = snapshot.get(id)
    if (previous === undefined || !isPlainObject(previous)) continue
    const fields = new Set([...Object.keys(previous), ...Object.keys(model)])
    for (const field of fields) {
      if (field === 'id') continue
      if (!valueEquals(previous[field], model[field])) {
        restorable.push({
          modelId: id,
          field,
          current: model[field],
          ...(previous[field] === undefined ? { remove: true } : { restoreTo: previous[field] }),
        })
      }
    }
  }
  return {
    restorable,
    addedSince: [...current.keys()].filter((id) => !snapshot.has(id) && typeof id === 'string'),
    removedSince: [...snapshot.keys()].filter((id) => !current.has(id) && typeof id === 'string'),
  }
}

function currentHasId(currentModels, id) {
  return (Array.isArray(currentModels) ? currentModels : []).some((model) => model?.id === id)
}

/** 撤销重放：从当前配置出发只回滚快照能证明的字段差异；post-apply 增删按旗标处理。
 * 快照是完整写前状态——两侧都存在的模型精确回到快照形状，应用后新增的字段随恢复移除。 */
export function applyUndo(snapshotModels, currentModels, { dropAdded = false, restoreRemoved = false } = {}) {
  const snapshot = new Map((Array.isArray(snapshotModels) ? snapshotModels : []).map((model) => [model?.id, model]))
  const kept = []
  for (const raw of Array.isArray(currentModels) ? currentModels : []) {
    const previous = snapshot.get(raw?.id)
    if (previous === undefined || !isPlainObject(previous)) {
      if (dropAdded) continue
      kept.push(isPlainObject(raw) ? { ...raw } : raw)
      continue
    }
    kept.push({ ...previous })
  }
  if (restoreRemoved) {
    for (const [, model] of snapshot) {
      if (!currentHasId(currentModels, model?.id) && isPlainObject(model)) kept.push({ ...model })
    }
  }
  return kept
}

// ─────────────────────────────────────────────────────────────────────────────
// 侧车仓库：providers / bindings / validations / undo / recovery
// ─────────────────────────────────────────────────────────────────────────────

export function emptyWorkbenchSidecar() {
  return { schemaVersion: WORKBENCH_SIDECAR_VERSION, providers: {}, bindings: {}, validations: {}, undo: {}, recovery: {} }
}

/** 读侧车：缺文件/非法 JSON/schemaVersion 不匹配/分区非对象 → 整体 fail-closed 为空仓。 */
export async function loadWorkbenchSidecar(dshHome) {
  try {
    const raw = JSON.parse(await readFile(join(dshHome, WORKBENCH_SIDECAR_FILE), 'utf8'))
    if (!isPlainObject(raw) || raw.schemaVersion !== WORKBENCH_SIDECAR_VERSION) return emptyWorkbenchSidecar()
    const restored = emptyWorkbenchSidecar()
    for (const key of ['providers', 'bindings', 'validations', 'undo', 'recovery']) {
      if (isPlainObject(raw[key])) restored[key] = raw[key]
    }
    return restored
  } catch (_) {
    return emptyWorkbenchSidecar()
  }
}

/** 0600 原子写（临时文件 + rename）；失败不留下半套状态。 */
export async function saveWorkbenchSidecar(dshHome, sidecar) {
  await mkdir(dshHome, { recursive: true })
  const target = join(dshHome, WORKBENCH_SIDECAR_FILE)
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify({ schemaVersion: WORKBENCH_SIDECAR_VERSION, ...sidecar }), { mode: 0o600 })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

/** 写串行化容器：所有分区写从同一内存快照复制、保存成功后才替换快照——并发写互不覆盖，
 * 保存失败时内存与磁盘保持一致（失败即抛，不产生半套状态）。 */
export function createWorkbenchStore(dshHome) {
  let state = null
  let writes = Promise.resolve()
  const load = async () => {
    if (state === null) state = await loadWorkbenchSidecar(dshHome)
    return state
  }
  const mutate = (work) => {
    const result = writes.then(async () => {
      const current = { ...(await load()) }
      const outcome = await work(current)
      await saveWorkbenchSidecar(dshHome, current)
      state = current
      return outcome
    })
    writes = result.then(() => undefined, () => undefined)
    return result
  }
  return { load, mutate }
}

// ─────────────────────────────────────────────────────────────────────────────
// 句柄表：检查 / 计划 / 草稿（内存短命句柄，超限淘汰最旧）
// ─────────────────────────────────────────────────────────────────────────────

function rememberHandle(map, key, value, max = WORKBENCH_MAX_HANDLES) {
  map.set(key, value)
  while (map.size > max) map.delete(map.keys().next().value)
}

/** 只接受携带未过期句柄的请求；取出即消费（一次性，防重放）。 */
function takeHandle(map, key) {
  const handle = map.get(key)
  if (handle === undefined) return undefined
  map.delete(key)
  return handle
}

const handleExpired = (handle, now) => now > handle.expires

export {
  WORKBENCH_SIDECAR_VERSION,
  WORKBENCH_SIDECAR_FILE,
  WORKBENCH_PLAN_TTL_MS,
  WORKBENCH_MAX_HANDLES,
  MODELS_PROBE_TIMEOUT_MS,
  MAX_MODELS_PROBE_BYTES,
  MAX_MODELS_PROBE_INFLATED_BYTES,
  MAX_MODELS_PROFILE_ROWS,
  MAX_MODEL_ID_LENGTH,
  MAX_MODELS_KEY_LENGTH,
  THINKING_LEVELS_SET,
  MODELS_PROBE_PROTOCOLS,
  MODELS_PROTOCOLS,
  MODELS_ROUTE_RE,
  MODELS_KEY_REF_RE,
  MODEL_ID_RE,
  META_FIELDS,
  rememberHandle,
  takeHandle,
  handleExpired,
}
