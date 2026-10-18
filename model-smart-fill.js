// Host deep module：智能填充来源与证据模型（P2，规格 docs/planning/model-config-smart-fill.md §4/§5）。
//
// 定位：这一层只做「证据 → 候选 → 分组建议」的纯逻辑与受控取数，不写配置、不碰密钥、不探测渠道。
// 宿主路由拿它回答两个问题：
//   1) 某渠道/协议/模型在**固定来源**里到底有什么可引用的资料；
//   2) 开关 OFF 时零网络、ON 时按固定白名单做条件请求并给出分组建议与来源状态。
//
// 与 model-workbench.js 的关系：复用其中的**纯函数**（stableStringify / piAiReasoningEfforts /
// THINKING_LEVELS_SET / MODEL_ID_RE / MAX_MODEL_ID_LENGTH）避免两处漂移；网络原语**不复用**
// `fetchDocText`——它只校验 HTTPS 与 host 非空、且把 304 当重定向拒绝（research §8 明确列为
// 本次必须修正的缺口），而固定来源白名单与条件请求 304 都是本层的硬要求，因此在本模块内
// 结构化强制（`assertSourceAllowed` + `createSourceFetcher` + `createMetadataCache`）。
//
// 安全不变量（每个导出都要过一遍）：
//   - 固定来源白名单写死在 SOURCE_WHITELIST：origin + 路径（或路径前缀）+ 允许的查询键三重匹配，
//     任何其它 URL 一律拒绝（拒绝码不含输入回显）。查询键必须单值有界；值不得含 `/` `\` 或 `..`
//     （含百分号编码形态，路径按解码后判定）。模型 ID 只作为查询参数值经 encodeURIComponent，
//     绝不进 shell/路径/命令。
//   - 取数有界：HTTPS-only、端口空或 443、禁 URL 凭据、禁重定向、**整次请求墙钟上限**、传输与
//     解压后双重体积上限（解压走 zlib `maxOutputLength`，引擎侧截断而非先分配后检查）、
//     失败/过期可见（staleError），不宣称最新。
//   - 元数据来源**永不应收到凭据**：请求头走固定闭集 METADATA_HEADER_ALLOWLIST，Authorization /
//     Cookie / X-Api-Key 等敏感头（含大小写变体）与集合外的新头一律在发请求前拒绝。
//   - 不做任何渠道探测、不读取真实配置/密钥、不发推理请求。测试注入 transport 即可离线运行。
//
// 语义红线（规格 §5 表格，逐条对应实现）：
//   - pi-ai 索引保留 **渠道 + api + 模型 ID** 三元身份；同渠道同 ID 跨 api 是不同记录，绝不合并。
//   - reasoning 三态：true / false / **未声明（undefined）**，未声明绝不塌成 false。
//   - 模态按集合比较，数组顺序差异不是冲突。
//   - wire（reasoningEfforts）与 compat 只有「当前渠道 + 当前协议」的精确目录条目可建议；
//     同渠道跨 api / 跨渠道 / 外部档案一律只读参考，需手填。
//   - name / contextWindow / maxTokens / input 跨渠道只作参考，可逐组**明确**采纳。
//   - modelparams 记录保留 provider/authType/apiSurface/model/wireId 独立身份，不做跨记录并集；
//     其 effort values/default 是「来源声明」，不是当前渠道 wire/默认；range.max 只读，绝不填 maxTokens。
//     逐条语义漂移（非法 ID / 缺 path / range 非整数边界…）只跳该条并计入 skipped/skippedDetail，
//     绝不抛出去打崩整条来源，也绝不静默当成「无资料」。
//   - 运行时 reasoning.efforts 只返回 id/name/description，没有 wire value，**不能按 ID 捏造 wire**；
//     defaultMaxTokens/defaultEffort 是 adapter 调用默认，不是模型能力上限或远端默认。
//   - OpenRouter 同名多作者必须保留全部匹配，绝不默认取首条；单模型详情端点的 `data` 是**对象**
//     （`/api/v1/model/{author}/{slug}`），解析与匹配两层同形处理，不进「取首条」逻辑。
//   - 来源绑定（`resolveSourceBinding`）只登记「哪条候选对应 route+api+model+地址」的身份指纹；
//     不携带 wire/compat 值，地址或身份变化即待复核/失效，绝不按关联跨来源采纳。
//   - 资料缺席不是「不支持」，不生成否定结论。

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import https from 'node:https'
import { brotliDecompress, gunzip, inflate } from 'node:zlib'

import {
  MAX_MODEL_ID_LENGTH,
  MODEL_ID_RE,
  THINKING_LEVELS_SET,
  piAiReasoningEfforts,
  stableStringify,
} from './model-workbench.js'

// ─────────────────────────────────────────────────────────────────────────────
// 常量：模式、来源白名单、上限
// ─────────────────────────────────────────────────────────────────────────────

/** 智能填充开关档位：每次进页默认 OFF，OFF 绝不发起任何外部请求。 */
export const SMART_FILL_MODES = Object.freeze({ OFF: 'off', ON: 'on' })

/** 用户在 UI 上看到的固定来源集合（可闭集：不含 models.dev、不含任意 URL、不含网页搜索）。 */
export const SMART_FILL_SOURCE_IDS = Object.freeze(['pi-ai', 'modelparams', 'openrouter', 'runtime'])

/** 元数据请求统一 UA（固定字符串，不含任何用户/渠道信息）。 */
export const SMART_FILL_USER_AGENT = 'dsh-service-smart-fill'
/** **整次请求的墙钟上限**（不是 socket 空闲超时；慢速持续吐字节也会被它截断）。 */
export const METADATA_TIMEOUT_MS = 10000
/** 传输体上限（解压前）。 */
export const MAX_METADATA_BYTES = 4 * 1024 * 1024
/** 解压后上限：与传输上限分开，防压缩炸弹。传给 zlib 的 maxOutputLength，引擎侧截断。 */
export const MAX_METADATA_INFLATED_BYTES = 8 * 1024 * 1024
/** OpenRouter 搜索 limit 的硬上界（`/api/v1/models` 只接受有界十进制）。 */
export const MAX_OPENROUTER_SEARCH_LIMIT = 50

/**
 * 元数据请求允许的头部闭集（小写）。元数据来源**永远不能收到凭据**：Authorization /
 * Cookie / X-Api-Key / Proxy-Authorization 等一律不在集合内；集合外的新键直接拒绝，
 * 因此调用方无法把任意头（含敏感头）塞进对第三方资料站的请求。
 */
export const METADATA_HEADER_ALLOWLIST = Object.freeze(['accept', 'accept-encoding', 'user-agent', 'if-none-match'])

/** 敏感头名（小写，含常见变体）；命中即拒，错误码 forbidden-header 且不回显键名。 */
const SENSITIVE_HEADER_NAMES = Object.freeze([
  'authorization', 'proxy-authorization', 'cookie', 'cookie2', 'set-cookie',
  'x-api-key', 'api-key', 'apikey', 'x-auth-token', 'x-access-token', 'x-api-token',
  'authentication', 'www-authenticate', 'proxy-authenticate',
])

/** 查询值里不允许出现的路径/控制形状（模型 ID 只作数据参数，绝不表达路径）。 */
const QUERY_VALUE_FORBIDDEN_RE = /[\u0000-\u001f\u007f/\\]/
/** 单次扫描/索引的记录上限（防御性，不静默截断语义）。 */
export const MAX_PI_RECORDS = 50000
export const MAX_MODELPARAMS_RECORDS = 200000
/** 单模型保留的候选上限（超出保留前 N 并记录 overflow，不假装完整）。 */
export const MAX_OPTIONS_PER_GROUP = 24
export const MAX_OPENROUTER_MATCHES = 20

/** modelparams.dev 中表达「档位式思考」的参数路径；其余 thinking.* 是 toggle/预算制，不表态。 */
export const MODELPARAMS_EFFORT_PATHS = Object.freeze(['reasoning_effort', 'output_config.effort', 'reasoning.effort'])

/**
 * 别名归一允许剥离的「思考档后缀」受控词表（`gemini-3.8-flash-high` 这类渠道约定）。
 * 只取档位词、且排除 `off`：通用剥 `-fast`/`-pro`/`-flashx` 会把独立型号并成基座，禁止。
 */
const ALIAS_THINKING_SUFFIXES = Object.freeze(
  [...THINKING_LEVELS_SET].filter((level) => level !== 'off').sort((a, b) => b.length - a.length),
)

/** scope 前缀只认字母（`cn:`/`us:`/`openai:` 这类渠道/区域约定）；带数字/连字符的前段视为型号本体。 */
const ALIAS_SCOPE_PREFIX_RE = /^([a-z]{2,8}):(.+)$/
/**
 * 变体词黑名单：防止 `foo:free` 被反向拆成候选 `free`（OpenRouter `q=free` 会命中
 * `openrouter/free`「Free Models Router」，属语义级误配）。这些词只可能是变体/档位，不是型号。
 */
const ALIAS_VARIANT_WORDS = Object.freeze([
  'free', 'batch', 'beta', 'extended', 'thinking', 'preview', 'high', 'low', 'medium', 'minimal',
  'xhigh', 'max', 'off', 'on', 'auto', 'latest',
])

/**
 * 固定来源白名单。三重匹配：origin host + 路径（精确或前缀）+ 允许的查询键。
 * `paths` 与 `pathPrefixes` 互斥使用；前缀必须在 `length > prefix.length` 时才算命中
 * （`/api/v1/model/` 后面必须还有段）。
 */
export const SOURCE_WHITELIST = Object.freeze([
  Object.freeze({
    id: 'modelparams',
    origin: 'https://modelparams.dev',
    paths: Object.freeze(['/api/v1/models.json']),
    queryKeys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'openrouter-model',
    origin: 'https://openrouter.ai',
    pathPrefixes: Object.freeze(['/api/v1/model/']),
    queryKeys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'openrouter-search',
    origin: 'https://openrouter.ai',
    paths: Object.freeze(['/api/v1/models']),
    queryKeys: Object.freeze(['q', 'limit']),
  }),
])

/** OpenRouter 单模型/搜索两条**固定** URL（浏览器永远不参与拼装，模型 ID 只作查询值编码）。 */
export function modelParamsRequest() {
  return { sourceId: 'modelparams', url: 'https://modelparams.dev/api/v1/models.json' }
}

/** 查询值编码：整个值经 encodeURIComponent（查询里 `/` 无结构含义，安全且最保守）。 */
function encodeQueryValue(value) {
  return encodeURIComponent(value)
}

/**
 * 路径段编码：只转义**会改变路径结构或控制语义**的字符，其余按 RFC 3986 pchar 原样保留
 * （保留 `@`、`:`、`.`、`~`、子分隔符 `!$&'()*+,;=`）。理由：`%40`/`%2F` 这类多余转义对
 * 不解码百分号的源站就是另一个字符串——`%2F` 实测直接 404；上游模型 ID 本身含 `@`（如
 * `@cf/...`）与 `.`，过度编码会把合法 ID 变成查不到的 ID。
 * 转义集：控制字符/DEL/空格、`"` `<` `>` `\` `^` `` ` `` `{` `|` `}`、以及 `?` `#` `%`
 * （前两者会截断路径进入 query/fragment，后者会开启百分号解码歧义）。`/` 不经过本函数
 * （调用方按 `/` 切段），因此路径分隔语义恒定。
 */
function encodePathSegment(segment) {
  const text = typeof segment === 'string' ? segment : ''
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code <= 0x20 || code === 0x7f || '?<>\\^`{|}%"#'.includes(char)) {
      out += encodeURIComponent(char)
    } else {
      out += char
    }
  }
  return out
}

/**
 * OpenRouter 两条固定 URL（浏览器永远不参与拼装，模型 ID 只作数据）。
 *
 * **路径段逐段编码**（实测 2026-10-12，代理匿名）：
 * `/api/v1/model/{author}/{slug}` 对**字面**斜杠返回 200，对 `%2F` 一律 404
 * （`/api/v1/model/anthropic/claude-haiku-5.5` → 200；同 URL 的 `%2F` 形态 → 404）。
 * 因此模型 ID 必须按 `/` 切成段、逐段做结构安全编码再拼回：`@cf/meta/llama` 这类多段 ID
 * 保留路径分隔语义，段内的空白/`?`/`#`/`%` 仍被转义，不可能改写路径结构或注入查询。
 * 查询形态（无 `/` 的裸 ID）只在 `q` 值里编码。
 */
export function openRouterRequest(modelId) {
  const id = typeof modelId === 'string' ? modelId : ''
  if (id.includes('/')) {
    const encodedPath = id.split('/').map(encodePathSegment).join('/')
    return {
      sourceId: 'openrouter-model',
      url: `https://openrouter.ai/api/v1/model/${encodedPath}`,
      kind: 'model',
      href: `https://openrouter.ai/models/${encodedPath}`,
    }
  }
  return {
    sourceId: 'openrouter-search',
    kind: 'search',
    url: `https://openrouter.ai/api/v1/models?q=${encodeQueryValue(id)}&limit=${MAX_OPENROUTER_SEARCH_LIMIT}`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 基础工具（本地实现，避免与既有模块耦合到非导出行为）
// ─────────────────────────────────────────────────────────────────────────────

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const str = (value) => (typeof value === 'string' ? value : '')

const positiveInt = (value) => (Number.isInteger(value) && value > 0 ? value : undefined)

const finiteInt = (value) => (Number.isInteger(value) ? value : undefined)

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** 元数据错误统一带稳定 code，错误信息只含来源自己的码，不回显 URL/输入。 */
function metadataError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

/** 稳定候选 ID：值变则 ID 变，宿主可重算复现；客户端只能回传服务端签发的 ID。 */
function candidateIdFor(parts) {
  return createHash('sha256').update(stableStringify(parts)).digest('hex').slice(0, 16)
}

// ─────────────────────────────────────────────────────────────────────────────
// 白名单与受控取数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 固定来源白名单校验。返回 `{ok:true, sourceId, url}` 或 `{ok:false, code}`。
 * 拒绝码：bad-url / insecure / credentials-in-url / bad-port / bad-host / bad-path /
 *         bad-query / source-not-whitelisted。
 *
 * 查询面加固（三道）：① 键必须在来源声明的集合内且**不重复**（重复键的取值歧义在宿主侧
 * 无法表达，直接拒）；② 值是单个、有界的字符串（拒控制字符，长度不超过模型 ID 上限）；
 * ③ 值不得含 `/` `\`（含 `%2f` 解码后）或 `..`（含 `%2e%2e` 解码后），杜绝编码型路径穿越。
 * 模型 ID 只经 encodeURIComponent 变成查询值，绝不进 path / shell / 命令。
 */
export function assertSourceAllowed(rawUrl) {
  let parsed
  try {
    parsed = new URL(String(rawUrl ?? ''))
  } catch (_) {
    return { ok: false, code: 'bad-url' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, code: 'insecure' }
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, code: 'credentials-in-url' }
  if (parsed.port !== '' && parsed.port !== '443') return { ok: false, code: 'bad-port' }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === '') return { ok: false, code: 'bad-host' }
  // 路径按**解码后**判定：`%2e%2e%2f` 这类编码穿越在 URL 层不会被归一化，必须显式解码。
  // 解码失败的畸形百分号序列本身也不该进入白名单匹配，直接拒。
  let path
  try {
    path = decodeURIComponent(parsed.pathname)
  } catch (_) {
    return { ok: false, code: 'bad-path' }
  }
  if (path === '' || path.includes('..') || path.includes('\\') || /[\u0000-\u001f]/.test(path)) return { ok: false, code: 'bad-path' }
  for (const source of SOURCE_WHITELIST) {
    let originHost = ''
    try {
      originHost = new URL(source.origin).hostname.toLowerCase()
    } catch (_) {
      continue
    }
    if (originHost !== host) continue
    const exact = (source.paths ?? []).includes(path)
    const prefix = (source.pathPrefixes ?? []).some((candidate) => path.startsWith(candidate) && path.length > candidate.length)
    if (!exact && !prefix) continue
    const allowedKeys = source.queryKeys ?? []
    const seenKeys = new Set()
    for (const [key, value] of parsed.searchParams) {
      if (!allowedKeys.includes(key)) return { ok: false, code: 'bad-query' }
      // 重复键：同一参数出现两次（?limit=50&limit=50、?q=a&q=b）一律拒绝。
      if (seenKeys.has(key)) return { ok: false, code: 'bad-query' }
      seenKeys.add(key)
      if (value === '' || value.length > MAX_MODEL_ID_LENGTH) return { ok: false, code: 'bad-query' }
      if (QUERY_VALUE_FORBIDDEN_RE.test(value) || value.includes('..')) return { ok: false, code: 'bad-query' }
    }
    if (source.id === 'openrouter-search' && parsed.searchParams.has('limit')) {
      // limit 必须是**数值**且有界：只接受 1..50 的十进制整数（手拼的 051、99999 全拒）。
      const rawLimit = parsed.searchParams.get('limit')
      if (!/^\d{1,2}$/.test(rawLimit)) return { ok: false, code: 'bad-query' }
      if (Number(rawLimit) > MAX_OPENROUTER_SEARCH_LIMIT) return { ok: false, code: 'bad-query' }
    }
    return { ok: true, sourceId: source.id, url: parsed.toString() }
  }
  return { ok: false, code: 'source-not-whitelisted' }
}

/**
 * 默认传输：HTTPS 直连、禁重定向（3xx 由调用方判定）、有界超时、传输与解压双上限。
 *
 * 有界性的两点硬要求（旧实现都在检查之后才分配，等于没限住）：
 * - **解压带 `maxOutputLength`**：zlib 在引擎侧边解边截断，不会先解出整个 bomb 再判大小。
 *   解压结果仍做一次字节复核，覆盖「zlib 截断行为与版本差异」。
 * - **整次请求的墙钟上限**：`timeout` 选项只统计 socket 空闲，攻击者持续慢速吐字节即可
 *   无限期占用。这里用 `Date.now()` 死线 + `AbortSignal` + 保险计时器，超时一律 abort。
 * - 三个上限（timeoutMs / maxBytes / maxInflatedBytes）缺省都回落到模块常量，绝不出现
 *   `NaN` 死线或 `undefined` 上限。
 *
 * 网络面为什么**不做 IP 钉住**（与 model-workbench 的在线发现有意不同）：
 * - 本层没有「用户输入的 host」这条攻击面：URL 只能来自 SOURCE_WHITELIST 的三个固定
 *   origin，用户可控的只有模型 ID，且它只作为查询值/路径段经结构安全编码。
 *   DNS rebinding 需要攻击者控制域名或解析，这里两者都不存在。
 * - 本机出网由 `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` 走 DSH 的进程级 http 代理（实测
 *   `https.request` 因此命中代理；loopback 被 NO_PROXY 强制直连）。若把连接钉到解析出的
 *   公网 IP，HTTPS 的 CONNECT/SNI 目标会变成裸 IP，代理侧虚拟主机路由与 TLS 身份都会
 *   失配——即「为堵一个不存在的洞而破坏现有可用来源」。
 * - 因此网络面加固落在别处：单来源固定 origin、HTTPS-only、禁重定向、禁凭据、固定头部
 *   闭集、双重体积上限与整次墙钟上限。
 *
 * 导出说明：`defaultTransport` 是**不校验白名单的传输原语**（调用方默认是
 * `createSourceFetcher`，白名单在那层强制）。导出它是为了让回归测试能把原语指向本地
 * HTTPS 测试服务器，验证真实 socket 路径的墙钟死线/解压上限/错误码分类；**它不是来源
 * 边界**，业务代码不要直接调用。
 */
export function defaultTransport(rawUrl, { headers, timeoutMs, maxBytes, maxInflatedBytes, signal }) {
  return new Promise((resolve, reject) => {
    // 缺省兜底：`timeoutMs` 未给时必须回落模块常量。否则 deadline 会是 NaN，
    // `failIfExpired()` 在首块数据到达时就把正常响应误判成超时。
    const limitMs = positiveInt(timeoutMs) ?? METADATA_TIMEOUT_MS
    const inflatedLimit = positiveInt(maxInflatedBytes) ?? MAX_METADATA_INFLATED_BYTES
    const byteLimit = positiveInt(maxBytes) ?? MAX_METADATA_BYTES
    const deadline = Date.now() + limitMs
    let finished = false
    let timer
    let aborted = false
    // 「是否因墙钟死线而失败」必须显式记账：用 Date.now() 反推会把死线之后才发现的
    // 坏压缩流误报成 timeout。
    let timedOut = false
    const abortController = new AbortController()
    const abortOnce = () => {
      if (aborted) return
      aborted = true
      abortController.abort()
    }
    if (signal !== undefined && signal !== null) {
      if (signal.aborted) abortOnce()
      else signal.addEventListener('abort', abortOnce, { once: true })
    }
    const settle = (fn, value) => {
      if (finished) return
      finished = true
      if (timer !== undefined) clearTimeout(timer)
      fn(value)
    }
    // abort/超限都先**落定**再断连接：否则紧随其后的 request 'error' 会把错误归类成
    // network，把有界性失败伪装成普通网络故障。
    const fail = (code) => {
      settle(reject, metadataError(code))
      abortOnce()
    }
    const expired = () => Date.now() >= deadline
    const failIfExpired = () => {
      if (!expired()) return false
      timedOut = true
      fail('timeout')
      return true
    }
    let request
    try {
      request = https.request(rawUrl, { method: 'GET', headers, timeout: limitMs, signal: abortController.signal }, (response) => {
        const status = response.statusCode ?? 0
        const chunks = []
        let received = 0
        response.on('data', (chunk) => {
          // 已落定（超限/超时）后不再累积：abort 关连接前可能还有几块数据到达。
          if (finished) return
          if (failIfExpired()) return
          received += chunk.length
          if (received > byteLimit) {
            fail('too-large')
            return
          }
          chunks.push(chunk)
        })
        response.on('error', (error) => {
          if (finished) return
          settle(reject, metadataError(error?.code === 'ABORT_ERR' || aborted ? 'timeout' : 'network'))
        })
        response.on('end', () => {
          if (finished) return
          if (failIfExpired()) return
          const encoding = String(response.headers['content-encoding'] || '').toLowerCase()
          const body = Buffer.concat(chunks)
          // 未压缩正文的最终判据在这里；压缩正文由 zlib maxOutputLength 引擎侧截断后再复核。
          if (received > byteLimit || body.length > byteLimit) {
            fail('too-large')
            return
          }
          const finish = (text) => {
            if (finished) return
            if (failIfExpired()) return
            if (Buffer.byteLength(text, 'utf8') > Math.min(byteLimit, inflatedLimit)) fail('too-large')
            else settle(resolve, { status, headers: response.headers, body: text })
          }
          // zlib 的 maxOutputLength 截断报 ERR_BUFFER_TOO_LARGE：这是**有界性**命中，
          // 不是坏压缩流；真实坏流才是 bad-<encoding>。
          const onDecoded = (kind) => (error, decoded) => {
            if (finished) return
            if (error) fail(error?.code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : (timedOut ? 'timeout' : `bad-${kind}`))
            else finish(decoded.toString('utf8'))
          }
          if (status === 304) {
            settle(resolve, { status, headers: response.headers, body: '' })
          } else if (encoding === 'gzip' || encoding === 'x-gzip') {
            gunzip(body, { maxOutputLength: inflatedLimit }, onDecoded('gzip'))
          } else if (encoding === 'br') {
            brotliDecompress(body, { maxOutputLength: inflatedLimit }, onDecoded('br'))
          } else if (encoding === 'deflate') {
            inflate(body, { maxOutputLength: inflatedLimit }, onDecoded('deflate'))
          } else {
            finish(body.toString('utf8'))
          }
        })
      })
    } catch (_) {
      settle(reject, metadataError('network'))
      return
    }
    timer = setTimeout(() => {
      timedOut = true
      fail('timeout')
    }, limitMs)
    // abort 后 socket 错误事件仍可能到达：此时已完成落定，绝不让它升级成 unhandled error。
    request.on('error', (error) => {
      if (finished) return
      settle(reject, metadataError(error?.code === 'ABORT_ERR' || aborted ? 'timeout' : 'network'))
    })
    timer.unref?.()
    // socket 空闲超时是墙钟死线之外的补充，不是替代：它抓不到「一直有字节但不结束」。
    request.on('timeout', () => {
      fail('timeout')
    })
    request.end()
  })
}

/**
 * 元数据请求头白名单校验。元数据来源是**外部第三方**，永不应收到本机凭据：
 * - 任何敏感头（Authorization / Proxy-Authorization / Cookie / X-Api-Key …，含常见变体）→
 *   `forbidden-header`（先于白名单判定，错误信息不回显键名/值）；
 * - 白名单外的任意头 → `unknown-header`（默认拒绝，新增元数据头必须显式进闭集）。
 * 名字大小写不敏感，全部归一为小写（http 层同名同义，杜绝大小写变体绕过）。
 */
function normalizeMetadataHeaders(headers) {
  const normalized = {}
  if (headers === undefined || headers === null) return normalized
  if (!isPlainObject(headers)) throw metadataError('bad-headers')
  for (const key of Object.keys(headers)) {
    const name = key.toLowerCase()
    if (SENSITIVE_HEADER_NAMES.includes(name)) throw metadataError('forbidden-header')
    if (!METADATA_HEADER_ALLOWLIST.includes(name)) throw metadataError('unknown-header')
    const value = headers[key]
    if (typeof value !== 'string' && typeof value !== 'number') throw metadataError('bad-header-value')
    const text = String(value)
    // CR/LF 注入与超长值在进入 http 层之前就拒（http 层虽也拒，但这里要给稳定码）。
    if (/[\r\n\u0000]/.test(text) || text.length > 1024) throw metadataError('bad-header-value')
    normalized[name] = text
  }
  return normalized
}

/**
 * 受控取数器：先过白名单，再发条件请求。
 * `transport` 可注入（测试完全离线）；默认实现见 defaultTransport。
 * 头部走固定闭集：元数据来源**永远收不到凭据**（`forbidden-header` / `unknown-header`）。
 * 注入 transport 也套**整次请求墙钟上限**：注入实现不尊重 timeout 时不会无限挂住。
 * 返回 `{status:200, body, etag, sourceId}` 或 `{status:304, etag, body:'', sourceId}`；
 * 失败抛带 code 的 Error（redirect / http-status:N / too-large / timeout / network / bad-*）。
 */
export function createSourceFetcher({ transport, limits = {} } = {}) {
  const impl = typeof transport === 'function' ? transport : defaultTransport
  const maxBytes = positiveInt(limits.maxBytes) ?? MAX_METADATA_BYTES
  const maxInflatedBytes = positiveInt(limits.maxInflatedBytes) ?? MAX_METADATA_INFLATED_BYTES
  const timeoutMs = positiveInt(limits.timeoutMs) ?? METADATA_TIMEOUT_MS
  const callTransport = (url, options) => {
    // 注入实现与默认实现一视同仁：整次请求有墙钟死线，不是只有 socket 空闲超时。
    // 手写 race（不用 Promise.race）：超时后到达的 resolve/reject 都被吞掉，绝不产生
    // unhandledRejection；abort 信号同时兜住支持 signal 的实现。
    return new Promise((resolve, reject) => {
      let settled = false
      let timer
      const controller = new AbortController()
      const settle = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      timer = setTimeout(() => {
        controller.abort()
        settle(reject, metadataError('timeout'))
      }, timeoutMs)
      timer.unref?.()
      Promise.resolve()
        .then(() => impl(url, { ...options, signal: controller.signal }))
        .then(
          (response) => settle(resolve, response),
          (error) => settle(reject, error?.code !== undefined ? error : metadataError('network')),
        )
    })
  }
  return async function fetchSource(rawUrl, { etag = '', headers = {} } = {}) {
    const allowed = assertSourceAllowed(rawUrl)
    if (!allowed.ok) throw metadataError(allowed.code)
    const requestHeaders = {
      accept: 'application/json',
      'accept-encoding': 'gzip, br',
      'user-agent': SMART_FILL_USER_AGENT,
      ...normalizeMetadataHeaders(headers),
    }
    if (typeof etag === 'string' && etag !== '') {
      if (/[\r\n\u0000]/.test(etag) || etag.length > 1024) throw metadataError('bad-etag')
      requestHeaders['if-none-match'] = etag
    }
    const response = await callTransport(allowed.url, { method: 'GET', headers: requestHeaders, timeoutMs, maxBytes, maxInflatedBytes })
    const status = Number(response?.status ?? 0)
    // 304 必须先于重定向判定（条件请求命中就在 3xx 区间）。
    if (status === 304) {
      const nextEtag = str(response?.headers?.etag) || etag
      return { status: 304, etag: nextEtag, body: '', sourceId: allowed.sourceId, url: allowed.url }
    }
    if (status >= 300 && status < 400) throw metadataError('redirect')
    if (status < 200 || status >= 300) throw metadataError(`http-status:${status}`)
    const body = typeof response?.body === 'string' ? response.body : ''
    // 注入 transport 的字符串正文：传输上限与解压后上限取更严者（默认实现里解压分支
    // 已由 zlib maxOutputLength 引擎侧截断，这里覆盖注入实现与默认实现两条路径）。
    if (Buffer.byteLength(body, 'utf8') > Math.min(maxBytes, maxInflatedBytes)) throw metadataError('too-large')
    return { status: 200, etag: str(response?.headers?.etag), body, sourceId: allowed.sourceId, url: allowed.url }
  }
}

/** 从来源载荷里取上游时间（modelparams 的 generatedAt 存在时）；无法解析返回 undefined。 */
export function upstreamAtOf(sourceId, payload) {
  if (sourceId !== 'modelparams' || !isPlainObject(payload)) return undefined
  const raw = payload.generatedAt
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000
  if (typeof raw === 'string' && raw !== '') {
    const parsed = Date.parse(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

/**
 * 元数据缓存 + 单飞 + 条件请求。
 * - 同 key 的并发 `get` 合并成一次请求（含 force）；
 * - 已有缓存且未 force → 直接返回 `status:'cached'`（先展示，宿主可再 force 更新）；
 * - force 时带 etag 条件请求，304 只续期 fetchedAt（零等待）；
 * - 失败**不 reject**：有旧载荷返回 `status:'stale'` 并带 staleError；无载荷返回 `status:'error'`。
 *   失败/过期是可见状态，绝不宣称最新。
 */
export function createMetadataCache({ fetcher, now = Date.now, maxEntries = 16 } = {}) {
  if (typeof fetcher !== 'function') throw new Error('smart-fill: fetcher required')
  const entries = new Map()
  const inFlight = new Map()
  const keyOf = (sourceId, url) => `${sourceId}\u0000${url}`
  const remember = (key, entry) => {
    entries.set(key, entry)
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value)
  }
  return {
    async get({ sourceId, url, force = false, parse } = {}) {
      const key = keyOf(String(sourceId ?? ''), String(url ?? ''))
      const pending = inFlight.get(key)
      if (pending !== undefined) return pending
      const existing = entries.get(key)
      if (!force && existing !== undefined) {
        return { ...existing, status: existing.status === 'ok' ? 'cached' : existing.status, fromCache: true }
      }
      const flight = (async () => {
        try {
          const response = await fetcher(url, { etag: existing?.etag ?? '' })
          if (response.status === 304) {
            const next = {
              sourceId,
              url,
              status: 'ok',
              fetchedAt: now(),
              upstreamAt: existing?.upstreamAt,
              etag: response.etag ?? existing?.etag ?? '',
              payload: existing?.payload,
              conditional: true,
            }
            remember(key, next)
            return next
          }
          const payload = typeof parse === 'function' ? parse(response.body) : response.body
          const next = {
            sourceId,
            url,
            status: 'ok',
            fetchedAt: now(),
            upstreamAt: upstreamAtOf(sourceId, payload),
            etag: response.etag ?? '',
            payload,
            conditional: false,
          }
          remember(key, next)
          return next
        } catch (error) {
          const message = error?.code || error?.message || 'network'
          const stale = {
            sourceId,
            url,
            status: existing?.payload !== undefined ? 'stale' : 'error',
            fetchedAt: existing?.fetchedAt,
            upstreamAt: existing?.upstreamAt,
            etag: existing?.etag ?? '',
            payload: existing?.payload,
            staleError: message,
            lastErrorAt: now(),
          }
          remember(key, stale)
          return stale
        }
      })()
      inFlight.set(key, flight)
      flight.then(() => inFlight.delete(key), () => inFlight.delete(key))
      return flight
    },
    drop(sourceId, url) {
      const key = keyOf(String(sourceId ?? ''), String(url ?? ''))
      entries.delete(key)
      inFlight.delete(key)
    },
    peek(sourceId, url) {
      return entries.get(keyOf(String(sourceId ?? ''), String(url ?? '')))
    },
    size() {
      return entries.size
    },
  }
}

/**
 * 载荷解析：形状不合就抛带 code 的错（缓存会记录为可见失败，而不是当成「无建议」）。
 * 解析零条数据也算失败——来源 schema 漂移必须显示失败，不能静默声称「无建议」。
 *
 * 零条判据：`models` 必须是**非空**数组。空数组只有两种解释（来源整体下线 / 字段被改名），
 * 都不是「该模型无资料」；若放行，选择器会展示「无建议」，把 schema 漂移伪装成正常结果。
 */
export function parseModelParamsPayload(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (_) {
    throw metadataError('bad-json')
  }
  if (!isPlainObject(data) || !Array.isArray(data.models) || data.models.length === 0) throw metadataError('bad-shape')
  return data
}

/**
 * OpenRouter 载荷解析。两条真实形状：
 * - `/api/v1/models`（目录/搜索）→ `{data: [model, ...]}`（本模块只接受这一种批量形状）；
 * - `/api/v1/model/{author}/{slug}`（单模型详情）→ **`{data: model}` 对象**，且部分镜像/版本
 *   直接返回裸 model 对象（顶层即 `{id, name, context_length, ...}`）。
 *
 * 这里不做任何「取第一条」的语义选择：单模型对象原样包成单元素数组返回，歧义由
 * `openRouterMatches` 保留全部候选交用户选择。非对象元素（字符串/数字等）按坏形状拒绝，
 * 避免下游把垃圾当模型行。
 */
export function parseOpenRouterPayload(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (_) {
    throw metadataError('bad-json')
  }
  // 目录/搜索：只有数组形态才是行集合（`{data:[]}` 合法空集，代表该查询无结果）。
  if (isPlainObject(data) && Array.isArray(data.data)) return { data: data.data }
  if (Array.isArray(data)) return { data }
  // 单模型详情：`{data:{...}}` 或裸 `{...}`；以字符串 id 作为「这是模型行」的最小身份判据。
  const wrapped = isPlainObject(data) && isPlainObject(data.data) ? data.data : data
  if (isPlainObject(wrapped) && typeof wrapped.id === 'string' && wrapped.id !== '') return { data: [wrapped] }
  throw metadataError('bad-shape')
}

// ─────────────────────────────────────────────────────────────────────────────
// 模态集合比较
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 归一为模态集合（只收宿主可表达的 text/image），按固定顺序返回。
 * 空数组/非数组/只有未知模态 → undefined（= 未声明，不是「不支持」）。
 */
export function modalitySet(value) {
  if (!Array.isArray(value)) return undefined
  const set = new Set()
  for (const mode of value) {
    if (mode === 'text' || mode === 'image') set.add(mode)
  }
  if (set.size === 0) return undefined
  return [...set].sort()
}

/** 模态集合比较：'equal' / 'different' / 'undeclared'。数组顺序差异不算冲突。 */
export function compareModalitySets(a, b) {
  const left = modalitySet(a)
  const right = modalitySet(b)
  if (left === undefined || right === undefined) return 'undeclared'
  if (left.length !== right.length) return 'different'
  return left.every((mode, index) => mode === right[index]) ? 'equal' : 'different'
}

// ─────────────────────────────────────────────────────────────────────────────
// pi-ai 证据索引：保留渠道 + api + 模型 ID 三元身份
// ─────────────────────────────────────────────────────────────────────────────

const exactKeyOf = (channel, api, modelId) => `${channel}\u0000${api}\u0000${modelId}`
const channelModelKeyOf = (channel, modelId) => `${channel}\u0000${modelId}`

function baseUrlKindOf(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') return 'empty'
  return baseUrl.includes('{') ? 'template' : 'exact'
}

/**
 * pi-ai 内置目录（data/*.json 文本 → {渠道文件名: 文本}）→ 证据索引。
 *
 * **关键差异（相对 model-workbench.buildPiAiIndex）**：记录保留 `api`，并按
 * `channel + api + modelId` 建 byExactKey。同渠道同 ID 跨 api 是**不同记录**（研究 §4：5 对
 * 且能力值不同），旧索引丢 api 会合并不该合并的候选。这里绝不合并，碰撞原样保留并计入 audit。
 */
export function buildPiEvidence(texts, { maxRecords = MAX_PI_RECORDS } = {}) {
  const records = []
  const byExactKey = new Map()
  const byChannelModel = new Map()
  const byModelId = new Map()
  const channelIds = new Set()
  const channels = new Map()
  let skipped = 0
  let truncated = false

  const push = (record) => {
    records.push(record)
    const exact = exactKeyOf(record.channel, record.api, record.modelId)
    if (!byExactKey.has(exact)) byExactKey.set(exact, [])
    byExactKey.get(exact).push(record)
    const pair = channelModelKeyOf(record.channel, record.modelId)
    if (!byChannelModel.has(pair)) byChannelModel.set(pair, [])
    byChannelModel.get(pair).push(record)
    if (!byModelId.has(record.modelId)) byModelId.set(record.modelId, [])
    byModelId.get(record.modelId).push(record)
  }

  for (const [channel, text] of Object.entries(texts ?? {})) {
    if (channel === '' || channel.startsWith('.')) continue
    let data
    try {
      data = JSON.parse(text)
    } catch (_) {
      skipped += 1
      continue
    }
    if (!isPlainObject(data)) {
      skipped += 1
      continue
    }
    let channelHasEntry = false
    for (const [api, group] of Object.entries(data)) {
      if (!isPlainObject(group)) continue
      const apiId = api === '' ? 'unknown' : api
      for (const entry of Object.values(group)) {
        if (!isPlainObject(entry)) continue
        const modelId = typeof entry.id === 'string' && entry.id !== '' ? entry.id : ''
        if (modelId === '' || modelId.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_RE.test(modelId)) {
          skipped += 1
          continue
        }
        if (records.length >= maxRecords) {
          truncated = true
          continue
        }
        channelHasEntry = true
        const thinkingLevelMap = isPlainObject(entry.thinkingLevelMap) ? entry.thinkingLevelMap : undefined
        const reasoningDeclared = entry.reasoning === true ? true : entry.reasoning === false ? false : undefined
        // reasoningEfforts 只在目录**明确声明 reasoning:true** 且有可表达档位时才产出 wire；
        // 缺席不等于 false，所以 reasoningDeclared===undefined 时既不产出 wire 也不产出 false。
        const reasoningEfforts = reasoningDeclared === true ? piAiReasoningEfforts(thinkingLevelMap, true) : undefined
        push({
          sourceId: 'pi-ai',
          channel,
          api: apiId,
          modelId,
          name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : undefined,
          provider: typeof entry.provider === 'string' && entry.provider !== '' ? entry.provider : channel,
          baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : '',
          baseUrlKind: baseUrlKindOf(entry.baseUrl),
          contextWindow: positiveInt(entry.contextWindow),
          maxTokens: positiveInt(entry.maxTokens),
          input: modalitySet(entry.input),
          inputDeclared: modalitySet(entry.input) !== undefined,
          // 三态：true / false / undefined（未声明）。未声明绝不塌成 false。
          reasoningDeclared,
          thinkingLevelMapDeclared: thinkingLevelMap !== undefined,
          reasoningEfforts,
          // compat 原样保留（写入前还要过协议门），不在这里做可写性判断。
          compat: isPlainObject(entry.compat) ? clone(entry.compat) : undefined,
          compatDeclared: isPlainObject(entry.compat),
        })
      }
    }
    if (channelHasEntry) {
      channelIds.add(channel)
      if (!channels.has(channel)) channels.set(channel, new Set())
      for (const api of Object.keys(data)) channels.get(channel).add(api)
    }
  }
  return { records, byExactKey, byChannelModel, byModelId, channels, channelIds, skipped, truncated }
}

/** 读取一个 pi-ai data 目录（*.json）→ 证据索引；目录缺失返回空索引（降级，不判失败）。 */
export async function loadPiEvidenceFromDir(dir) {
  const texts = {}
  try {
    const files = await readdir(dir)
    for (const file of files) {
      if (!file.endsWith('.json') || file.startsWith('.') || file.includes('.bak')) continue
      try {
        texts[file.slice(0, -5)] = await readFile(join(dir, file), 'utf8')
      } catch (_) {
        // 单文件失败跳过，其余照常（部分可用优于整体失败）
      }
    }
  } catch (_) {
    return buildPiEvidence({})
  }
  return buildPiEvidence(texts)
}

/**
 * 按目标身份取证据，三类分开、绝不合并：
 * - exact：渠道 + api + 模型 ID 全等（唯一可作 wire/compat 建议的来源）；
 * - sameChannelOtherApi：同渠道同 ID 不同 api（协议不同，wire 不代填）；
 * - crossChannel：其它渠道的同名模型（能力/输入/名称仅参考）。
 */
export function piEvidenceFor(index, { channel, api, modelId } = {}) {
  const exact = index?.byExactKey?.get(exactKeyOf(str(channel), str(api), str(modelId))) ?? []
  const sameChannelOtherApi = (index?.byChannelModel?.get(channelModelKeyOf(str(channel), str(modelId))) ?? [])
    .filter((record) => record.api !== api)
  const crossChannel = (index?.byModelId?.get(str(modelId)) ?? []).filter((record) => record.channel !== channel)
  return { exact, sameChannelOtherApi, crossChannel }
}

/**
 * 索引自检（扫描脚本与测试共用）：不依赖任何硬编码规模。
 * 校验身份完整、exact 键可回查、reasoning 三态合法、wire 只在声明 true 时出现、模态值合法；
 * 并输出跨 api / 重复 exact 的碰撞清单（碰撞是保留事实，不是错误）。
 */
export function auditPiEvidence(index) {
  const problems = []
  const collisions = []
  for (const [pair, records] of index?.byChannelModel ?? []) {
    if (records.length <= 1) continue
    const apis = [...new Set(records.map((record) => record.api))].sort()
    collisions.push({
      channel: records[0].channel,
      modelId: records[0].modelId,
      pair,
      apis,
      count: records.length,
      kind: apis.length > 1 ? 'same-channel-cross-api' : 'duplicate-exact-key',
    })
  }
  const counts = { records: index?.records?.length ?? 0, channels: index?.channelIds?.size ?? 0, models: index?.byModelId?.size ?? 0, reasoningTrue: 0, reasoningFalse: 0, reasoningUndeclared: 0 }
  for (const record of index?.records ?? []) {
    if (record.channel === '' || record.api === '' || record.modelId === '') problems.push('identity-missing')
    if (!index?.byExactKey?.has(exactKeyOf(record.channel, record.api, record.modelId))) problems.push('exact-key-missing')
    if (record.reasoningDeclared === true) counts.reasoningTrue += 1
    else if (record.reasoningDeclared === false) counts.reasoningFalse += 1
    else counts.reasoningUndeclared += 1
    if (record.reasoningEfforts !== undefined && record.reasoningDeclared !== true) problems.push('wire-without-declared-true')
    if (record.input !== undefined) {
      for (const mode of record.input) {
        if (mode !== 'text' && mode !== 'image') problems.push('bad-modality')
      }
    }
    if (record.baseUrlKind === 'exact' && (record.baseUrl === '' || record.baseUrl.includes('{'))) problems.push('base-url-kind-mismatch')
  }
  return {
    ok: problems.length === 0,
    problems: [...new Set(problems)],
    collisions,
    counts: { ...counts, collisions: collisions.length, skipped: index?.skipped ?? 0, truncated: index?.truncated === true },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// modelparams.dev：独立记录身份，不做并集
// ─────────────────────────────────────────────────────────────────────────────

/**
 * modelparams 目录 → 独立记录数组。
 * 每条记录的**身份是 provider + authType + apiSurface + model + wireId**；同一裸 ID 不同
 * authType/apiSurface 是不同记录（研究 §5：59 组 default 可能不同）。这里绝不求并集、
 * 绝不贴第一条 provider 标签。
 *
 * 逐条容错 + 漂移留证（本函数**永不抛**）：
 * - 单条 entry 里的任何异常都只让该条被跳过（`continue`），不中断整个来源，也不冒泡成
 *   「整个来源失败」——调用方（`querySmartFill`) 的 per-source 兜底只负责网络/解析失败；
 * - 语义漂移（model/id 形状非法、params 非数组、path 缺失、range 声明了却不是整数边界）
 *   全部计入 `skipped` 与 `skippedDetail`（截断后的 model 标识 + 稳定 reason），
 *   供扫描/接口显示，绝不静默当成「无资料」。
 */
export function indexModelParamsRecords(catalog, { maxRecords = MAX_MODELPARAMS_RECORDS } = {}) {
  const records = []
  const byModelId = new Map()
  const skippedDetail = []
  const bump = (value, reason) => {
    if (skippedDetail.length < 200) skippedDetail.push({ model: String(value).slice(0, MAX_MODEL_ID_LENGTH), reason })
  }
  const models = Array.isArray(catalog?.models) ? catalog.models : []
  let truncated = false
  outer: for (const entry of models) {
    try {
      if (!isPlainObject(entry)) {
        bump(entry === null ? null : typeof entry, 'entry-not-object')
        continue
      }
      const modelId = typeof entry.model === 'string' ? entry.model.trim() : ''
      if (modelId === '') {
        bump(entry.model ?? '', 'model-missing')
        continue
      }
      if (modelId.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_RE.test(modelId)) {
        bump(modelId, 'model-id-invalid')
        continue
      }
      const identity = {
        provider: str(entry.provider),
        authType: str(entry.authType) || 'unknown',
        apiSurface: str(entry.apiSurface),
        model: modelId,
        wireId: str(entry.wireId),
      }
      const shared = {
        status: str(entry.status),
        replacement: str(entry.replacement) || undefined,
        shutdownOn: str(entry.shutdownOn) || undefined,
      }
      const params = Array.isArray(entry.params) ? entry.params : []
      if (params.length === 0) {
        if (entry.params !== undefined && !Array.isArray(entry.params)) bump(modelId, 'params-not-array')
        const record = { sourceId: 'modelparams', index: records.length, ...identity, paramPath: '', values: [], ...shared }
        records.push(record)
        if (!byModelId.has(modelId)) byModelId.set(modelId, [])
        byModelId.get(modelId).push(record)
        continue
      }
      for (const param of params) {
        if (!isPlainObject(param)) {
          bump(modelId, 'param-not-object')
          continue
        }
        const paramPath = typeof param.path === 'string' ? param.path : ''
        if (paramPath === '') {
          bump(modelId, 'param-path-missing')
          continue
        }
        // range 语义校验：声明了 range 就要求对象 + 整数边界（true/1.5/"8192" 都是漂移）。
        const declaredRange = param.range !== undefined && param.range !== null
        if (declaredRange && !isPlainObject(param.range)) bump(modelId, 'range-not-object')
        else if (isPlainObject(param.range)) {
          if (param.range.min !== undefined && finiteInt(param.range.min) === undefined) bump(modelId, 'range-min-not-integer')
          if (param.range.max !== undefined && finiteInt(param.range.max) === undefined) bump(modelId, 'range-max-not-integer')
        }
        if (param.values !== undefined && !Array.isArray(param.values)) bump(modelId, 'values-not-array')
        const values = Array.isArray(param.values)
          ? param.values.filter((value) => typeof value === 'string' && value !== '').slice(0, 64)
          : []
        const record = {
          sourceId: 'modelparams',
          index: records.length,
          ...identity,
          paramPath,
          values,
          defaultValue: param.default !== undefined && ['string', 'number', 'boolean'].includes(typeof param.default) ? param.default : undefined,
          rangeMin: finiteInt(param?.range?.min),
          rangeMax: finiteInt(param?.range?.max),
          ...shared,
        }
        records.push(record)
        if (!byModelId.has(modelId)) byModelId.set(modelId, [])
        byModelId.get(modelId).push(record)
        if (records.length >= maxRecords) {
          truncated = true
          break outer
        }
      }
    } catch (_) {
      // 兜底：即便上面的字段访问出现意外（代理对象、getter 抛错），也只跳该条。
      bump(entry?.model ?? '', 'entry-invalid')
    }
  }
  return { records, byModelId, skipped: skippedDetail.length, skippedDetail, truncated }
}

/**
 * 某模型的 modelparams 参考面：保持每条记录独立，不聚合、不并集、不推断 wire。
 * - requestRanges：`range.max` 是 **API 参数取值上限**，只读，映射不到任何模型字段；
 * - effortValues：来源声明的档位名（`wire:false`），不是当前渠道 wire；
 * - defaults：来源默认，不是当前远端默认。
 */
export function modelParamsReference(index, modelId) {
  const records = index?.byModelId?.get(str(modelId)) ?? []
  const requestRanges = []
  const effortValues = []
  const defaults = []
  for (const record of records) {
    const identity = {
      provider: record.provider,
      authType: record.authType,
      apiSurface: record.apiSurface,
      model: record.model,
      wireId: record.wireId,
    }
    if (record.rangeMax !== undefined) {
      requestRanges.push({
        paramPath: record.paramPath,
        rangeMax: record.rangeMax,
        rangeMin: record.rangeMin,
        identity,
        readOnly: true,
        kind: 'request-parameter-ceiling',
        note: 'API 参数取值上限，不是模型最大输出能力；不生成 maxTokens 建议',
      })
    }
    if (MODELPARAMS_EFFORT_PATHS.includes(record.paramPath) && record.values.length > 0) {
      effortValues.push({
        paramPath: record.paramPath,
        values: [...record.values],
        identity,
        wire: false,
        kind: 'source-declared-effort-values',
        note: '来源声明的档位名，不是当前渠道 wire，不能据此生成 wire 映射',
      })
    }
    if (record.defaultValue !== undefined) {
      defaults.push({
        paramPath: record.paramPath,
        value: record.defaultValue,
        identity,
        kind: 'source-declared-default',
        note: '来源默认，不是当前远端默认值',
      })
    }
  }
  return {
    sourceId: 'modelparams',
    modelId: str(modelId),
    records,
    // 来源漂移留证：被跳过的条目与原因随参考面一起回传，调用方才能区分
    // 「该模型无资料」与「来源 schema 漂移」。
    skipped: index?.skipped ?? 0,
    skippedDetail: index?.skippedDetail ?? [],
    identities: [...new Set(records.map((record) => `${record.provider}\u0000${record.authType}\u0000${record.apiSurface}\u0000${record.wireId}`))]
      .map((key) => {
        const [provider, authType, apiSurface, wireId] = key.split('\u0000')
        return { provider, authType, apiSurface, wireId, model: str(modelId) }
      }),
    requestRanges,
    effortValues,
    defaults,
    note: 'provider 名称文本相同不等于 DSH route 相同；每条记录保留独立身份',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter：保留全部匹配，绝不取首条
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 载荷 → 行数组。与 `parseOpenRouterPayload` 同一套形状判据（两处必须同步，否则解析通过、
 * 匹配为空，会把「单模型详情」静默变成「零命中」）：
 * 数组 / `{data:[...]}` / `{models:[...]}` → 批量；`{data:{...}}` 或裸 `{id,...}` → 单模型一行。
 * 无身份的对象（没有字符串 id）不算行，返回空数组。
 */
function normalizeOpenRouterRows(payload) {
  if (Array.isArray(payload)) return payload
  if (isPlainObject(payload) && Array.isArray(payload.data)) return payload.data
  if (isPlainObject(payload) && Array.isArray(payload.models)) return payload.models
  const wrapped = isPlainObject(payload) && isPlainObject(payload.data) ? payload.data : payload
  if (isPlainObject(wrapped) && typeof wrapped.id === 'string' && wrapped.id !== '') return [wrapped]
  return []
}

/**
 * 从 OpenRouter 返回里挑出与输入 ID 相关的**全部**匹配（按匹配强度排序，但都保留）。
 * 绝不返回「唯一一条真值」：同名多作者必须由用户选择。
 * 匹配规则（与既有 pickOpenRouterMatch 同向，但保留全部）：
 *   exact id / canonical_slug / hugging_face_id → id 后缀（排除 :variant 变体与其它作者同名）
 *   → canonical_slug 后缀 → hugging_face_id 大小写不敏感。
 */
export function openRouterMatches(modelId, payload, { maxMatches = MAX_OPENROUTER_MATCHES } = {}) {
  const id = str(modelId)
  const rows = normalizeOpenRouterRows(payload)
  const matches = []
  const push = (row, matchKind) => {
    if (!isPlainObject(row) || matches.some((match) => match.row === row)) return
    matches.push({ row, matchKind })
  }
  // 只对**对象行**做属性访问：批量载荷可能混入 null/字符串（上游轮换字段时出现过），
  // 直接读 row.id 会对 null 抛类型错误，把整条来源变成不可用。
  const bounded = rows.slice(0, 500).filter((row) => isPlainObject(row))
  for (const row of bounded) {
    if (row.id === id || row.canonical_slug === id || row.hugging_face_id === id) push(row, 'exact')
  }
  for (const row of bounded) {
    if (typeof row.id === 'string' && id !== '' && row.id.endsWith('/' + id)) push(row, 'id-suffix')
  }
  for (const row of bounded) {
    if (typeof row.canonical_slug === 'string' && id !== '' && row.canonical_slug.endsWith('/' + id)) push(row, 'canonical-suffix')
  }
  for (const row of bounded) {
    if (typeof row.hugging_face_id === 'string' && id !== '' && row.hugging_face_id.toLowerCase() === id.toLowerCase()) push(row, 'hf-id')
  }
  const sliced = matches.slice(0, maxMatches)
  return { matches: sliced, ambiguous: sliced.length > 1, searched: rows.length, total: matches.length, truncated: matches.length > sliced.length }
}

/**
 * OpenRouter 命中 → 参考事实。**只确认模型档案身份**，不确认自定义中转渠道保留 OpenRouter
 * 的 wire/compat；支持的档位名与默认档位只是来源声明，不是当前渠道 wire/默认。
 */
export function openRouterReference(match) {
  const row = isPlainObject(match) && isPlainObject(match.row) ? match.row : match
  if (!isPlainObject(row)) return undefined
  const id = str(row.id)
  const parts = id.includes('/') ? id.split('/') : []
  const rawInput = Array.isArray(row?.architecture?.input_modalities) ? row.architecture.input_modalities : []
  const input = modalitySet(rawInput)
  const inexpressible = [...new Set(rawInput.filter((mode) => typeof mode === 'string' && mode !== 'text' && mode !== 'image'))].slice(0, 8)
  const efforts = Array.isArray(row?.reasoning?.supported_efforts)
    ? row.reasoning.supported_efforts.filter((value) => typeof value === 'string' && value !== '').slice(0, 32)
    : []
  return {
    sourceId: 'openrouter',
    identity: {
      id,
      canonicalSlug: str(row.canonical_slug),
      author: parts.length === 2 ? parts[0] : '',
      slug: parts.length === 2 ? parts[1] : '',
      huggingFaceId: str(row.hugging_face_id),
    },
    matchKind: isPlainObject(match) && typeof match.matchKind === 'string' ? match.matchKind : 'provided',
    name: str(row.name) || undefined,
    contextWindow: positiveInt(row.context_length),
    maxTokens: positiveInt(row?.top_provider?.max_completion_tokens),
    input,
    inputInexpressible: inexpressible,
    supportedEfforts: efforts,
    defaultEffort: str(row?.reasoning?.default_effort) || undefined,
    supportedParameters: Array.isArray(row.supported_parameters)
      ? row.supported_parameters.filter((value) => typeof value === 'string').slice(0, 64)
      : [],
    evidence: 'external-reference',
    note: '外部档案只确认模型身份；不确认当前渠道 wire/compat，也不代表匿名访问长期可用',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 模型 ID 别名归一：只在原始 ID 于固定来源无记录时回退，且永不宣称精确身份
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 渠道配置里的模型 ID 可能带渠道自己的前缀/变体（真机实例：`workbuddy` 的
 * `cn:deepseek-v4.1-flash`、`cline` 的 `cline-pass/deepseek-v4.1-flash`、
 * OpenRouter 风格的 `...:free`）。固定来源只认规范化 ID，因此原始 ID 精确查不到时
 * 按下面的形态给出**别名候选**（顺序即优先级，去重、有界）：
 *   - scope-prefix  ：`cn:deepseek-v4.1-flash` → `deepseek-v4.1-flash`（渠道/区域前缀）
 *   - variant-suffix：`inclusionai/ling-3.1-flash:free` → `inclusionai/ling-3.1-flash`（变体后缀）
 *   - provider-slug ：`cline-pass/deepseek-v4.1-flash` → `deepseek-v4.1-flash`（中转渠道前缀）
 *   - 组合形态：对一级结果再剥离另一类（如 `provider:author/slug:variant`）。
 *
 * 保守约束（宁可漏认，不可误拆）：
 *   - scope 前缀段只允许 2–8 位**纯字母**，因此 Bedrock 的 `amazon.nova-2-lite-v1:0`、
 *     `anthropic.claude-...-v1:0` 这类**真正带冒号**的 ID 不会被拆；`gpt-4o:free` 也不会被
 *     反向拆出 `free`（变体词黑名单再次兜底，避免撞上 `openrouter/free` 这类语义完全不同的条目）；
 *   - variant 后缀必须以字母开头且 ≤16 位，且基段要有分隔结构（`-`/`.`/`/` 或 ≥8 字符）；
 *   - provider slug 必须是最后一段、长度 ≥6 且含 `-`/`.`（拒绝 `free` 这类短词）。
 * 候选只作**来源查询键**：不自动采纳、不生成 wire/compat、不宣称与原始 ID 同一身份。
 */
export function modelIdAliasCandidates(modelId) {
  const id = str(modelId)
  if (id === '' || id.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_RE.test(id)) return []
  const MAX_ALIAS_CANDIDATES = 6
  const out = []
  const seen = new Set([id])
  const take = (value, kind) => {
    const next = str(value)
    if (next === '' || next.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_RE.test(next) || seen.has(next)) return ''
    // 任何一条剥离路径都不许把「变体词」当成型号候选：`free-high` 剥档位后是 `free`、
    // `foo:free` 反过来是 `free`——它们会命中 `openrouter/free`（Free Models Router）这类
    // 语义完全不同的条目，属比漏认更糟的误配。
    if (ALIAS_VARIANT_WORDS.includes(next.toLowerCase())) return ''
    seen.add(next)
    out.push({ id: next, kind })
    return next
  }
  const scopeOf = (value) => {
    const match = ALIAS_SCOPE_PREFIX_RE.exec(value)
    if (match === null) return ''
    const rest = match[2]
    // `foo:free` 的 `free` 是变体词，不是型号：拒绝该方向，交给 variant-suffix 处理。
    return ALIAS_VARIANT_WORDS.includes(rest.toLowerCase()) ? '' : rest
  }
  const suffixOf = (value) => {
    const match = /^(.+):([a-z][a-z0-9_-]{0,15})$/.exec(value)
    if (match === null) return ''
    const base = match[1]
    return base.includes('-') || base.includes('.') || base.includes('/') || base.length >= 8 ? base : ''
  }
  const tailOf = (value) => {
    const slash = value.lastIndexOf('/')
    if (slash < 0 || slash === value.length - 1) return ''
    const tail = value.slice(slash + 1)
    return tail.length >= 6 && (tail.includes('-') || tail.includes('.')) ? tail : ''
  }
  // 思考档后缀是**受控词表**（`gemini-3.8-flash-high` 这类渠道约定），只剥档位词，
  // 绝不通用剥 `-fast`/`-pro`/`-flashx` 等兄弟型号（真机证据：它们是独立型号/定价）。
  const thinkingOf = (value) => {
    for (const level of ALIAS_THINKING_SUFFIXES) {
      if (!value.endsWith('-' + level)) continue
      const base = value.slice(0, -(level.length + 1))
      if (base.length >= 3) return base
    }
    return ''
  }
  const first = []
  for (const [kind, value] of [['scope-prefix', scopeOf(id)], ['variant-suffix', suffixOf(id)], ['provider-slug', tailOf(id)], ['thinking-suffix', thinkingOf(id)]]) {
    if (value === '') continue
    const added = take(value, kind)
    if (added !== '') first.push([kind, added])
  }
  for (const [kind, base] of first) {
    for (const [nextKind, value] of [['scope-prefix', scopeOf(base)], ['variant-suffix', suffixOf(base)], ['provider-slug', tailOf(base)], ['thinking-suffix', thinkingOf(base)]]) {
      if (out.length >= MAX_ALIAS_CANDIDATES) return out
      if (value !== '' && value !== base) take(value, kind + '+' + nextKind)
    }
  }
  return out
}

/**
 * 目标模型 ID 的「来源身份」：**精确 ID 永远优先**。
 * 只有精确 ID 在本地来源（pi-ai 目录 / modelparams 索引）没有任何记录、且 OpenRouter
 * 精确查询也没有命中时，才按 `modelIdAliasCandidates` 的顺序挑候选：
 *   - 优先挑**被本地来源认出**的第一个候选（`recognizedBy` 留证）；
 *   - 都认不出时暂取第一个候选（`recognizedBy:[]`），由调用方在 OpenRouter 回退命中后
 *     补认；仍无命中则调用方会退回精确身份，不用猜测值出建议。
 * 返回 `via:'exact'` 时 `modelId` 与 `requestedModelId` 相同。
 */
export function resolveSmartFillIdentity(modelId, { piIndex, modelParamsIndex, openRouterMatchesCount = 0 } = {}) {
  const requested = str(modelId)
  const countFor = (index, value) => index?.byModelId?.get(value)?.length ?? 0
  const exactPi = countFor(piIndex, requested)
  const exactModelParams = countFor(modelParamsIndex, requested)
  const recognized = []
  if (exactPi > 0) recognized.push('pi-ai')
  if (exactModelParams > 0) recognized.push('modelparams')
  if (openRouterMatchesCount > 0) recognized.push('openrouter')
  if (requested === '' || recognized.length > 0) {
    return { requestedModelId: requested, modelId: requested, via: 'exact', kind: '', recognizedBy: recognized }
  }
  const candidates = modelIdAliasCandidates(requested)
  if (candidates.length === 0) {
    return { requestedModelId: requested, modelId: requested, via: 'exact', kind: '', recognizedBy: [] }
  }
  let chosen = candidates[0]
  const recognizedBy = []
  for (const candidate of candidates) {
    const pi = countFor(piIndex, candidate.id)
    const modelParams = countFor(modelParamsIndex, candidate.id)
    if (pi === 0 && modelParams === 0) continue
    chosen = candidate
    if (pi > 0) recognizedBy.push('pi-ai')
    if (modelParams > 0) recognizedBy.push('modelparams')
    break
  }
  return { requestedModelId: requested, modelId: chosen.id, via: 'alias', kind: chosen.kind, recognizedBy }
}

/**
 * 两次 OpenRouter 读取（原始 ID + 别名回退）合并成一条来源状态：客户端只显示一条
 * `openrouter`，`identityFallback` 留证哪次生效、另一次的状态码是什么。
 */
function mergeOpenRouterFallback(sources, detail) {
  const indices = []
  for (let index = 0; index < sources.length; index += 1) {
    if (sources[index].sourceId === 'openrouter') indices.push(index)
  }
  if (indices.length === 0) return
  if (indices.length === 1) {
    sources[indices[0]].identityFallback = detail
    return
  }
  const exact = sources[indices[0]]
  const fallback = sources[indices[1]]
  const usable = (entry) => entry.status === 'ok' || entry.status === 'cached' || entry.status === 'provided'
  const chosen = usable(fallback) ? fallback : exact
  const merged = {
    ...chosen,
    identityFallback: {
      ...detail,
      exactStatus: exact.status,
      exactError: exact.error ?? null,
      fallbackStatus: fallback.status,
      fallbackError: fallback.error ?? null,
    },
  }
  for (const index of [...indices].sort((a, b) => b - a)) sources.splice(index, 1)
  sources.push(merged)
}

// ─────────────────────────────────────────────────────────────────────────────
// 运行时：只解释生效投影，不从 effort ID 捏造 wire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `llm.resolveModelInfo` 返回 → 运行时参考。**没有 wire value**：
 * `reasoningWireAvailable:false`、不产出 `{effortId: wire}` 映射（旧 simpleModelObserved 的
 * `wire = value || id` fallback 被明确禁止）。defaultMaxTokens/defaultEffort 标为 adapter
 * 调用默认/预算，不是模型能力上限或远端默认。
 */
export function runtimeReference(info) {
  const input = modalitySet(info?.input ?? info?.modalities?.input)
  const effortIds = []
  const effortNames = []
  const efforts = info?.reasoning?.efforts
  if (Array.isArray(efforts)) {
    for (const effort of efforts) {
      const id = typeof effort?.id === 'string' ? effort.id : ''
      if (id === '') continue
      effortIds.push(id)
      if (typeof effort?.name === 'string' && effort.name !== '') effortNames.push(effort.name)
    }
  }
  return {
    sourceId: 'runtime',
    evidence: 'runtime-effective',
    input: input ?? undefined,
    inputDeclared: input !== undefined,
    contextWindow: positiveInt(info?.contextWindow),
    reasoningEffortIds: [...new Set(effortIds)],
    reasoningEffortNames: [...new Set(effortNames)],
    // 关键：即使 ID 恰好等于 DSH 档位名，也不推断 wire。
    reasoningWire: null,
    reasoningWireAvailable: false,
    defaultMaxTokens: positiveInt(info?.defaultMaxTokens),
    defaultMaxTokensKind: 'adapter-budget',
    defaultEffort: str(info?.defaultEffort) || undefined,
    declared: {
      input: input !== undefined,
      reasoning: Array.isArray(efforts) && efforts.length > 0,
      contextWindow: positiveInt(info?.contextWindow) !== undefined,
    },
    note: '当前 adapter 投影，不是独立测量；未返回不等于不支持',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// compat 协议门（写死当前 dsh-llm-pi-ai 的 disposition；offer 才可写）
// ─────────────────────────────────────────────────────────────────────────────

const gate = (entries) => Object.freeze(entries)

/**
 * 每个协议的 compat 键门。`offer` = 宿主当前协议可写（可建议）；`withhold` = 目录可能含但
 * 宿主明确不可写（只读解释，绝不暗自写入）。与装机 dsh-llm-pi-ai COMPAT_GATES 对照。
 */
export const COMPAT_PROTOCOL_GATE = Object.freeze({
  'openai-completions': gate({
    supportsStore: 'offer',
    supportsDeveloperRole: 'offer',
    supportsReasoningEffort: 'offer',
    supportsUsageInStreaming: 'offer',
    supportsFinishReason: 'offer',
    maxTokensField: 'offer',
    requiresToolResultName: 'offer',
    requiresAssistantAfterToolResult: 'offer',
    requiresThinkingAsText: 'offer',
    requiresReasoningContentOnAssistantMessages: 'offer',
    thinkingFormat: 'offer',
    chatTemplateKwargs: 'offer',
    chatTemplateArgs: 'offer',
    supportsThinkingTokenBudget: 'offer',
    thinkingTokenBudgetField: 'offer',
    vllmPriority: 'offer',
    supportsStrictMode: 'offer',
    cacheControlFormat: 'offer',
    supportsLongCacheRetention: 'offer',
    openRouterRouting: 'withhold',
    vercelGatewayRouting: 'withhold',
    zaiToolStream: 'withhold',
    supportsOpenAIGrammarTools: 'withhold',
    sendSessionAffinityHeaders: 'withhold',
    supportsMidConvoSystemMessages: 'withhold',
    supportsMidConvoToolAdditions: 'withhold',
    sessionAffinityFormat: 'withhold',
  }),
  'openai-responses': gate({
    supportsDeveloperRole: 'offer',
    supportsMaxOutputTokens: 'offer',
    supportsStrictMode: 'offer',
    supportsLongCacheRetention: 'offer',
    sessionAffinityFormat: 'withhold',
    supportsOpenAIGrammarTools: 'withhold',
    supportsAdditionalTools: 'withhold',
    supportsToolSearch: 'withhold',
    supportsExplicitPromptCacheMode: 'withhold',
    supportsMidConvoSystemMessages: 'withhold',
  }),
  'anthropic-messages': gate({
    supportsEagerToolInputStreaming: 'offer',
    supportsLongCacheRetention: 'offer',
    supportsCacheControlOnTools: 'offer',
    supportsTemperature: 'offer',
    forceAdaptiveThinking: 'offer',
    allowEmptySignature: 'offer',
    supportsStrictTools: 'offer',
    sendSessionAffinityHeaders: 'withhold',
    sessionAffinityFormat: 'withhold',
    supportsMidConvoSystemMessages: 'withhold',
    supportsMidConvoToolChanges: 'withhold',
    supportsMidConvoEffort: 'withhold',
    allowedFallbackModels: 'withhold',
  }),
  'mistral-conversations': gate({ supportsMidConvoSystemMessages: 'withhold' }),
  'bedrock-converse-stream': gate({ supportsStrictMode: 'offer' }),
})

const WRITABLE_PROTOCOLS = Object.freeze(['openai-completions', 'openai-responses', 'anthropic-messages'])

/** 协议是否属于当前宿主可配置写面（与 llm-pi-ai supportedProtocols 同向）。 */
export function isWritableProtocol(api) {
  return WRITABLE_PROTOCOLS.includes(str(api))
}

// ─────────────────────────────────────────────────────────────────────────────
// 分组建议：字段级选项，逐组明确采纳，缺席有理由
// ─────────────────────────────────────────────────────────────────────────────

const CAPABILITY_FIELDS = Object.freeze(['name', 'contextWindow', 'maxTokens', 'input'])

const SOURCE_LABELS = Object.freeze({
  'pi-ai': '本机 pi-ai 目录',
  modelparams: 'modelparams.dev',
  openrouter: 'OpenRouter',
  runtime: '运行时 adapter',
})

function normalizeTarget(target) {
  const raw = isPlainObject(target) ? target : {}
  return {
    channel: str(raw.channel),
    api: str(raw.api),
    modelId: str(raw.modelId),
    modelOnly: raw.modelOnly === true,
    current: isPlainObject(raw.current) ? raw.current : {},
  }
}

function piRef(record) {
  return {
    source: 'pi-ai',
    channel: record.channel,
    api: record.api,
    modelId: record.modelId,
    baseUrl: record.baseUrl,
    baseUrlKind: record.baseUrlKind,
  }
}

function fieldValueFromPi(record, field) {
  if (field === 'name') return record.name
  if (field === 'contextWindow') return record.contextWindow
  if (field === 'maxTokens') return record.maxTokens
  if (field === 'input') return record.input
  return undefined
}

function fieldValueFromOpenRouter(reference, field) {
  if (field === 'name') return reference.name
  if (field === 'contextWindow') return reference.contextWindow
  if (field === 'maxTokens') return reference.maxTokens
  if (field === 'input') return reference.input
  return undefined
}

function makeOption(field, spec) {
  const hasValue = spec.hasValue !== false && spec.value !== undefined
  const candidateId = candidateIdFor([
    field,
    spec.source,
    spec.evidence,
    spec.key ?? null,
    spec.kind ?? null,
    hasValue ? spec.value : null,
    spec.sourceRef ?? null,
  ])
  return {
    candidateId,
    field,
    ...(spec.key !== undefined ? { key: spec.key } : {}),
    ...(hasValue ? { value: spec.value } : {}),
    source: spec.source,
    sourceLabel: SOURCE_LABELS[spec.source] ?? spec.source,
    evidence: spec.evidence,
    confidence: spec.confidence,
    adoptable: spec.adoptable === true,
    readOnly: spec.readOnly === true,
    // 任何选项都只能被显式勾选写入，没有自动勾选。
    requiresExplicitAdoption: true,
    ...(spec.kind !== undefined ? { kind: spec.kind } : {}),
    ...(spec.sourceRef !== undefined ? { sourceRef: spec.sourceRef } : {}),
    ...(spec.note !== undefined ? { note: spec.note } : {}),
  }
}

function currentOf(target, field) {
  const value = target.current?.[field]
  return { declared: value !== undefined, value: value === undefined ? undefined : clone(value) }
}

function comparisonFor(field, current, options) {
  if (current === undefined) return { state: 'empty', equal: false, note: '空字段=未声明/继承，不是 false/null/空列表' }
  if (field === 'input') {
    if (modalitySet(current) === undefined) return { state: 'undeclared', equal: false, note: '空模态数组=未声明' }
    for (const option of options) {
      if (compareModalitySets(current, option.value) === 'equal') return { state: 'match', equal: true, note: '模态按集合比较，顺序差异不算冲突' }
    }
    return { state: 'differs', equal: false, note: '模态按集合比较，顺序差异不算冲突' }
  }
  for (const option of options) {
    const candidate = option.key !== undefined ? { [option.key]: option.value } : option.value
    if (stableStringify(current) === stableStringify(candidate)) return { state: 'match', equal: true }
  }
  return { state: 'differs', equal: false }
}

function optionOverflow(options) {
  if (options.length <= MAX_OPTIONS_PER_GROUP) return { options, overflow: 0 }
  return { options: options.slice(0, MAX_OPTIONS_PER_GROUP), overflow: options.length - MAX_OPTIONS_PER_GROUP }
}

function capabilityGroup(field, target, pi, openRouter) {
  const collected = []
  const seen = new Set()
  const add = (option) => {
    if (seen.has(option.candidateId)) return
    seen.add(option.candidateId)
    collected.push(option)
  }
  for (const record of pi.exact) {
    const value = fieldValueFromPi(record, field)
    if (value === undefined) continue
    add(makeOption(field, {
      value,
      source: 'pi-ai',
      evidence: 'exact-channel-protocol',
      confidence: 'high',
      adoptable: true,
      sourceRef: piRef(record),
      note: '当前渠道与协议精确匹配',
    }))
  }
  for (const record of pi.sameChannelOtherApi) {
    const value = fieldValueFromPi(record, field)
    if (value === undefined) continue
    add(makeOption(field, {
      value,
      source: 'pi-ai',
      evidence: 'same-channel-other-protocol',
      confidence: 'reference',
      adoptable: true,
      sourceRef: piRef(record),
      note: '同渠道不同协议的目录条目，按组明确采纳后才写入',
    }))
  }
  for (const record of pi.crossChannel) {
    const value = fieldValueFromPi(record, field)
    if (value === undefined) continue
    add(makeOption(field, {
      value,
      source: 'pi-ai',
      evidence: 'cross-channel-reference',
      confidence: 'reference',
      adoptable: true,
      sourceRef: piRef(record),
      note: '跨渠道资料仅参考，按组明确采纳后才写入',
    }))
  }
  for (const reference of openRouter?.references ?? []) {
    const value = fieldValueFromOpenRouter(reference, field)
    if (value === undefined) continue
    add(makeOption(field, {
      value,
      source: 'openrouter',
      evidence: 'external-reference',
      confidence: 'reference',
      adoptable: true,
      sourceRef: { source: 'openrouter', ...reference.identity },
      note: '外部档案只确认模型身份，跨渠道仅参考',
    }))
  }
  const { options, overflow } = optionOverflow(collected)
  const anyEvidence = pi.exact.length + pi.sameChannelOtherApi.length + pi.crossChannel.length > 0
  return {
    field,
    scope: 'model',
    current: currentOf(target, field),
    comparison: comparisonFor(field, target.current?.[field], options),
    options,
    overflow,
    readOnly: false,
    adoptable: options.some((option) => option.adoptable),
    // 缺席理由：没有资料 vs 资料未表态。两者都不是「不支持」。
    absentReason: options.length === 0 ? (anyEvidence ? 'source-undeclared' : 'no-local-evidence') : undefined,
    unsupported: false,
    notes: options.length === 0
      ? ['资料缺席不是「不支持」，可合法手填']
      : ['无自动勾选；✓ 才写入草稿'],
  }
}

function reasoningGroup(target, pi, runtime) {
  const collected = []
  const seen = new Set()
  const add = (option) => {
    if (seen.has(option.candidateId)) return
    seen.add(option.candidateId)
    collected.push(option)
  }
  const records = target.modelOnly ? [...pi.exact].sort((a, b) => Number(b.reasoningEfforts !== undefined) - Number(a.reasoningEfforts !== undefined)) : pi.exact
  for (const record of records) {
    if (record.reasoningEfforts !== undefined) {
      add(makeOption('reasoningEfforts', {
        value: record.reasoningEfforts,
        source: 'pi-ai',
        evidence: 'exact-channel-protocol',
        confidence: 'high',
        adoptable: true,
        sourceRef: piRef(record),
        note: '当前渠道与协议精确匹配的 wire 映射',
      }))
    } else if (record.reasoningDeclared === false) {
      add(makeOption('reasoningEfforts', {
        value: false,
        source: 'pi-ai',
        evidence: 'exact-channel-protocol',
        confidence: 'high',
        adoptable: true,
        sourceRef: piRef(record),
        note: '目录**明确声明**不支持推理（未声明不会到这里）',
      }))
    }
    // reasoningDeclared === undefined：既不产出 wire，也不产出 false。
  }
  // 同渠道跨 api / 跨渠道的 wire 只读参考：协议不同，wire 不可代填。
  for (const record of [...pi.sameChannelOtherApi, ...pi.crossChannel]) {
    if (record.reasoningEfforts === undefined) continue
    add(makeOption('reasoningEfforts', {
      value: record.reasoningEfforts,
      source: 'pi-ai',
      evidence: record.channel === target.channel ? 'same-channel-other-protocol' : 'cross-channel-reference',
      confidence: 'read-only',
      adoptable: false,
      readOnly: true,
      kind: 'foreign-wire',
      sourceRef: piRef(record),
      note: '协议/渠道不同，wire 映射不可代填，需手填',
    }))
  }
  const { options, overflow } = optionOverflow(collected)
  const anyEvidence = pi.exact.length + pi.sameChannelOtherApi.length + pi.crossChannel.length > 0
  let absentReason
  if (options.length === 0) absentReason = anyEvidence ? 'source-undeclared' : 'no-local-evidence'
  return {
    field: 'reasoningEfforts',
    scope: 'model',
    supported: [...pi.exact, ...pi.sameChannelOtherApi, ...pi.crossChannel].some((record) => record.reasoningDeclared === true),
    current: currentOf(target, 'reasoningEfforts'),
    comparison: comparisonFor('reasoningEfforts', target.current?.reasoningEfforts, options),
    options,
    overflow,
    readOnly: false,
    adoptable: options.some((option) => option.adoptable),
    absentReason,
    unsupported: false,
    notes: [
      'wire 只来自当前渠道+协议；运行时档位 ID 不能捏造 wire',
      'reasoning 未声明与明确 false 是两回事，不合并展示',
    ],
  }
}

const SDK_WITHHELD_NOTE = 'withhold 键在当前协议不可写，只读解释，不丢弃也不暗自写入'

function compatGroup(target, pi) {
  const collected = []
  const seen = new Set()
  const inexpressible = []
  const add = (option) => {
    if (seen.has(option.candidateId)) return
    seen.add(option.candidateId)
    collected.push(option)
  }
  const protocolGate = COMPAT_PROTOCOL_GATE[target.api]
  for (const record of pi.exact) {
    if (!isPlainObject(record.compat)) continue
    for (const [key, value] of Object.entries(record.compat)) {
      const disposition = protocolGate?.[key]
      if (disposition === 'offer') {
        add(makeOption('compat', {
          key,
          value,
          source: 'pi-ai',
          evidence: 'exact-channel-protocol',
          confidence: 'high',
          adoptable: true,
          sourceRef: piRef(record),
          note: `协议 ${target.api} 的可写键`,
        }))
      } else {
        inexpressible.push({
          key,
          value: clone(value),
          reason: disposition === 'withhold' ? 'protocol-withholds-key' : isWritableProtocol(target.api) ? 'unknown-key' : 'unknown-protocol',
          note: '目录含该键但当前协议不可写，只读解释，不暗自写入',
        })
      }
    }
  }
  for (const record of pi.sameChannelOtherApi) {
    if (!isPlainObject(record.compat)) continue
    for (const [key, value] of Object.entries(record.compat)) {
      add(makeOption('compat', {
        key,
        value,
        source: 'pi-ai',
        evidence: 'same-channel-other-protocol',
        confidence: 'read-only',
        adoptable: false,
        readOnly: true,
        kind: 'foreign-compat',
        sourceRef: piRef(record),
        note: '同渠道不同协议的 compat，跨协议只参考/手填',
      }))
    }
  }
  for (const record of pi.crossChannel) {
    if (!isPlainObject(record.compat)) continue
    for (const [key, value] of Object.entries(record.compat)) {
      add(makeOption('compat', {
        key,
        value,
        source: 'pi-ai',
        evidence: 'cross-channel-reference',
        confidence: 'read-only',
        adoptable: false,
        readOnly: true,
        kind: 'foreign-compat',
        sourceRef: piRef(record),
        note: '跨渠道 compat 只参考/手填',
      }))
    }
  }
  const { options, overflow } = optionOverflow(collected)
  const anyEvidence = pi.exact.length + pi.sameChannelOtherApi.length + pi.crossChannel.length > 0
  return {
    field: 'compat',
    scope: 'model',
    keyed: true,
    current: currentOf(target, 'compat'),
    // compat 是按 key 逐键确认，不存在单一「整对象比较」的 match/differs。
    comparison: { state: 'keyed', equal: false },
    options,
    overflow,
    inexpressible,
    readOnly: false,
    adoptable: options.some((option) => option.adoptable),
    // 有目录键但当前协议全部不可写时，理由是「协议不可写」而不是「无资料」。
    absentReason: options.length === 0
      ? (inexpressible.length > 0 ? 'not-writable-under-protocol' : anyEvidence ? 'source-undeclared' : 'no-local-evidence')
      : undefined,
    unsupported: false,
    notes: [
      'compat 按具体可写键逐键确认；目录全部键 ≠ 宿主全部可写键',
      SDK_WITHHELD_NOTE,
    ],
  }
}

function modelParamsGroups(target, modelParams) {
  if (modelParams === undefined) return []
  const groups = []
  if (modelParams.requestRanges.length > 0) {
    const options = modelParams.requestRanges.map((range) => makeOption('paramRangeMax', {
      value: range.rangeMax,
      source: 'modelparams',
      evidence: 'source-declaration',
      confidence: 'read-only',
      adoptable: false,
      readOnly: true,
      kind: 'request-parameter-ceiling',
      sourceRef: { source: 'modelparams', ...range.identity, paramPath: range.paramPath },
      note: range.note,
    }))
    groups.push({
      field: 'paramRangeMax',
      scope: 'request-parameter',
      // 明确映射不到模型字段：不给 maxTokens 生成建议。
      mapsToModelField: null,
      current: currentOf(target, 'maxTokens'),
      comparison: { state: 'reference-only', equal: false },
      options,
      readOnly: true,
      adoptable: false,
      absentReason: undefined,
      unsupported: false,
      notes: ['range.max 是 API 参数取值上限，只读；不填模型 maxTokens'],
    })
  }
  if (modelParams.effortValues.length > 0) {
    const options = modelParams.effortValues.map((entry) => makeOption('sourceEffortValues', {
      value: entry.values,
      source: 'modelparams',
      evidence: 'source-declaration',
      confidence: 'read-only',
      adoptable: false,
      readOnly: true,
      kind: 'source-effort-names',
      sourceRef: { source: 'modelparams', ...entry.identity, paramPath: entry.paramPath },
      note: entry.note,
    }))
    groups.push({
      field: 'sourceEffortValues',
      scope: 'source-reference',
      current: { declared: false, value: undefined },
      comparison: { state: 'reference-only', equal: false },
      options,
      readOnly: true,
      adoptable: false,
      unsupported: false,
      notes: ['来源档位名不等于当前渠道 wire；每条记录独立，不做并集'],
    })
  }
  if (modelParams.defaults.length > 0) {
    const options = modelParams.defaults.map((entry) => makeOption('sourceDefaults', {
      value: entry.value,
      source: 'modelparams',
      evidence: 'source-declaration',
      confidence: 'read-only',
      adoptable: false,
      readOnly: true,
      kind: 'source-declared-default',
      sourceRef: { source: 'modelparams', ...entry.identity, paramPath: entry.paramPath },
      note: entry.note,
    }))
    groups.push({
      field: 'sourceDefaults',
      scope: 'source-reference',
      current: { declared: false, value: undefined },
      comparison: { state: 'reference-only', equal: false },
      options,
      readOnly: true,
      adoptable: false,
      unsupported: false,
      notes: ['来源默认不是当前远端默认值'],
    })
  }
  return groups
}

function runtimeGroups(runtime) {
  if (runtime === undefined) return []
  const groups = []
  const defaults = []
  if (runtime.defaultMaxTokens !== undefined) {
    defaults.push(makeOption('adapterDefaults', {
      value: runtime.defaultMaxTokens,
      source: 'runtime',
      evidence: 'runtime-effective',
      confidence: 'read-only',
      adoptable: false,
      readOnly: true,
      kind: 'adapter-budget',
      sourceRef: { source: 'runtime' },
      note: 'adapter 调用默认/预算，不是模型能力上限',
    }))
  }
  if (runtime.defaultEffort !== undefined) {
    defaults.push(makeOption('adapterDefaults', {
      value: runtime.defaultEffort,
      source: 'runtime',
      evidence: 'runtime-effective',
      confidence: 'read-only',
      adoptable: false,
      readOnly: true,
      kind: 'adapter-default-effort',
      sourceRef: { source: 'runtime' },
      note: 'adapter 默认档位，不是远端默认',
    }))
  }
  if (defaults.length > 0) {
    groups.push({
      field: 'adapterDefaults',
      scope: 'adapter',
      current: { declared: false, value: undefined },
      comparison: { state: 'reference-only', equal: false },
      options: defaults,
      readOnly: true,
      adoptable: false,
      unsupported: false,
      notes: ['adapter 调用默认/预算只读展示，不当模型能力上限或远端默认'],
    })
  }
  if (runtime.reasoningEffortIds.length > 0) {
    groups.push({
      field: 'runtimeEfforts',
      scope: 'runtime',
      wireAvailable: false,
      // 这里是运行时**生效投影**，不是模型的显式声明值；比较状态固定 reference-only。
      current: { declared: true, value: [...runtime.reasoningEffortIds] },
      comparison: { state: 'reference-only', equal: false },
      options: [makeOption('runtimeEfforts', {
        value: { ids: runtime.reasoningEffortIds, names: runtime.reasoningEffortNames },
        source: 'runtime',
        evidence: 'runtime-effective',
        confidence: 'read-only',
        adoptable: false,
        readOnly: true,
        kind: 'effort-ids-no-wire',
        sourceRef: { source: 'runtime' },
        note: runtime.note,
      })],
      readOnly: true,
      adoptable: false,
      unsupported: false,
      notes: ['运行时只返回 id/name/description，没有 wire value；不能按 ID 捏造同名 wire'],
    })
  }
  if (runtime.input !== undefined) {
    groups.push({
      field: 'runtimeInput',
      scope: 'runtime',
      current: { declared: runtime.inputDeclared === true, value: clone(runtime.input) },
      comparison: { state: 'reference-only', equal: false },
      options: [makeOption('runtimeInput', {
        value: runtime.input,
        source: 'runtime',
        evidence: 'runtime-effective',
        confidence: 'read-only',
        adoptable: false,
        readOnly: true,
        kind: 'effective-input',
        sourceRef: { source: 'runtime' },
        note: '运行时生效投影，不是独立佐证',
      })],
      readOnly: true,
      adoptable: false,
      unsupported: false,
      notes: ['生效投影不等于来源证据，不整份写回显式配置'],
    })
  }
  return groups
}

/**
 * 证据 → 分组建议。纯函数，不触网。
 * `piIndex`、`modelParams`、`openRouter`（{matches, ambiguous, references}）、`runtime` 都可缺席。
 * 所有选项 `requiresExplicitAdoption:true`；readOnly 组永不 adoptable；缺席带 absentReason 且
 * `unsupported:false`（资料缺席不是不支持）。
 */
export function buildSmartFillGroups({ target, piIndex, modelParams, openRouter, runtime } = {}) {
  const normalized = normalizeTarget(target)
  const pi = piIndex !== undefined && piIndex !== null
    ? piEvidenceFor(piIndex, normalized)
    : { exact: [], sameChannelOtherApi: [], crossChannel: [] }
  if (normalized.modelOnly) {
    pi.exact = [...pi.exact, ...pi.sameChannelOtherApi, ...pi.crossChannel]
      .sort((a, b) => [a.channel, a.api, a.modelId].join('/').localeCompare([b.channel, b.api, b.modelId].join('/')))
    pi.sameChannelOtherApi = []
    pi.crossChannel = []
  }
  const groups = []
  for (const field of CAPABILITY_FIELDS) groups.push(capabilityGroup(field, normalized, pi, openRouter))
  groups.push(reasoningGroup(normalized, pi, runtime))
  groups.push(compatGroup(normalized, pi))
  groups.push(...modelParamsGroups(normalized, modelParams))
  groups.push(...runtimeGroups(runtime))
  if (normalized.modelOnly) {
    for (const group of groups) {
      for (const option of group.options ?? []) {
        if (option.evidence === 'exact-channel-protocol') {
          option.evidence = 'model-identity'
          option.confidence = 'reference'
          option.note = '按模型身份匹配的资料建议，不代表当前渠道实测能力'
        }
      }
      if (group.field === 'reasoningEfforts') group.notes = ['思考映射按模型身份匹配；资料未声明时不猜测协议值']
    }
  }

  const notes = []
  if (pi.exact.length === 0 && pi.sameChannelOtherApi.length === 0 && pi.crossChannel.length === 0) {
    notes.push('本机 pi-ai 目录没有该模型记录：缺席不是「不支持」')
  }
  if (openRouter?.ambiguous === true) {
    notes.push(normalized.modelOnly ? 'OpenRouter 命中多个同名条目：保留候选，模型页按稳定来源顺序展示建议，填入需统一确认' : 'OpenRouter 命中多个同名条目：保留全部候选，由用户选择，不默认取首条')
  }
  return { groups, notes }
}

// ─────────────────────────────────────────────────────────────────────────────
// 来源候选绑定：身份指纹 + 关联复核（只登记关联，绝不把来源 wire 带过渠道）
// ─────────────────────────────────────────────────────────────────────────────

/** 绑定指纹版本：判据变化时递增，旧绑定自然失效而不是被误判为同一身份。 */
export const SOURCE_BINDING_VERSION = 1

function normalizeAddress(baseUrl, kind) {
  if (kind === 'empty' || kind === 'template') return ''
  if (typeof baseUrl !== 'string') return ''
  return baseUrl.trim().toLowerCase().replace(/\/+$/, '').replace(/:(443)(?=\/|$)/, '')
}

/**
 * 路由身份指纹。返回两个摘要：
 * - `fingerprint`：**不含地址**的稳定身份（channel + api + modelId），是绑定的主键——
 *   地址变化时它不变，绑定因此能被识别为「同一条 binding 待复核」而不是凭空消失；
 * - `identityFingerprint`：**含地址**的完整身份，用来判定地址是否漂移（地址变化按规格是
 *   `address-changed` 待复核，不是自动沿用）。
 * `includeAddress` 只影响 `fingerprint`（true 时等价于 `identityFingerprint`），
 * 供调用方需要「换地址即整条失效」语义时使用。
 */
export function routeIdentityFingerprint(target, { includeAddress = false } = {}) {
  const normalized = normalizeTarget(target)
  const kind = typeof target?.baseUrlKind === 'string' ? target.baseUrlKind : baseUrlKindOf(target?.baseUrl)
  const address = normalizeAddress(target?.baseUrl, kind)
  const baseParts = [SOURCE_BINDING_VERSION, normalized.channel, normalized.api, normalized.modelId]
  const addressParts = [kind, address]
  const identityFingerprint = createHash('sha256').update(stableStringify([...baseParts, ...addressParts])).digest('hex').slice(0, 16)
  return {
    channel: normalized.channel,
    api: normalized.api,
    modelId: normalized.modelId,
    address,
    addressKind: kind,
    fingerprint: includeAddress ? identityFingerprint : createHash('sha256').update(stableStringify(baseParts)).digest('hex').slice(0, 16),
    identityFingerprint,
    addressBound: address !== '',
    addressFingerprint: address !== ''
      ? createHash('sha256').update(stableStringify([SOURCE_BINDING_VERSION, normalized.channel, address])).digest('hex').slice(0, 16)
      : '',
  }
}

/** 候选来源侧的同一套身份指纹（`baseUrlKind` 可选，缺省由 baseUrl 推断）。 */
export function sourceCandidateFingerprint(candidate) {
  const raw = isPlainObject(candidate) ? candidate : {}
  return routeIdentityFingerprint({
    channel: raw.channel,
    api: raw.api,
    modelId: raw.modelId,
    baseUrl: raw.baseUrl,
    baseUrlKind: raw.baseUrlKind,
  })
}

/**
 * 来源绑定解析：把**当前路由身份**与候选来源逐条对齐，并说明旧关联是否需要复核。
 *
 * 语义边界（规格 §5/§6）：
 * - 只登记「哪条目录记录对应这条 route + api + model」。**不携带任何 wire/compat 值**，
 *   也不产出凭关联就能采纳的候选；关联不等于能力实测，也不等于确定中转透传。
 * - `previous` 是上次登记的绑定（本函数上一次的产物）。指纹不同 → `invalid` 并给
 *   `fingerprint-changed`；只有地址部分变化 → `address-changed`（待复核）。
 * - 候选的 `state`：`match`（route 身份全等）/ `address-unresolved`（来源地址为空或模板，
 *   不能当当前渠道事实）/ `address-mismatch`（同 route 身份但地址不同）/
 *   `identity-mismatch`（渠道、api 或模型 ID 不同）。
 * - 绝不做「跨来源求并集」或「按关联改写值」：每个候选保持自己的身份与地址。
 *
 * 返回值可安全序列化给宿主路由；`linked` 只是**候选索引**，不是采纳动作。
 */
export function resolveSourceBinding({ target, candidateSources = [], previous } = {}) {
  const route = routeIdentityFingerprint(target)
  const candidates = []
  let matchIndex = -1
  for (const [index, raw] of (Array.isArray(candidateSources) ? candidateSources : []).entries()) {
    const candidate = isPlainObject(raw) ? raw : {}
    const fingerprint = sourceCandidateFingerprint(candidate)
    let state
    let reason
    if (fingerprint.channel !== route.channel || fingerprint.api !== route.api || fingerprint.modelId !== route.modelId) {
      state = 'identity-mismatch'
      reason = 'route-identity-differs'
    } else if (!fingerprint.addressBound) {
      state = 'address-unresolved'
      reason = fingerprint.addressKind === 'template' ? 'template-address' : 'empty-address'
    } else if (!route.addressBound || fingerprint.addressFingerprint !== route.addressFingerprint) {
      state = 'address-mismatch'
      reason = 'address-differs'
    } else {
      state = 'match'
      reason = undefined
      if (matchIndex === -1) matchIndex = index
    }
    candidates.push({
      index,
      sourceId: str(candidate.sourceId),
      channel: fingerprint.channel,
      api: fingerprint.api,
      modelId: fingerprint.modelId,
      address: fingerprint.address,
      addressKind: fingerprint.addressKind,
      fingerprint: fingerprint.fingerprint,
      addressFingerprint: fingerprint.addressFingerprint,
      addressBound: fingerprint.addressBound,
      state,
      reason,
    })
  }
  const previousRoute = previous !== undefined && previous !== null && isPlainObject(previous.route) ? previous.route : undefined
  let linked = matchIndex === -1 ? null : { index: matchIndex, sourceId: candidates[matchIndex].sourceId }
  let state
  let reason
  let rereviewRequired = false
  const sameBaseIdentity = previousRoute !== undefined
    && previousRoute.fingerprint !== undefined
    && previousRoute.fingerprint === route.fingerprint
  if (previousRoute === undefined) {
    state = 'new'
    reason = linked === null ? 'no-matching-source' : 'matched'
  } else if (sameBaseIdentity && previousRoute.identityFingerprint === route.identityFingerprint) {
    state = 'stable'
    reason = linked === null ? 'no-matching-source' : 'matched'
    // 上一条绑定指向的候选在这次列表里已不存在（目录改版/条目消失）：保留旧索引但标待复核。
    const previousLinkedIndex = finiteInt(previous?.linked?.index)
    if (previousLinkedIndex !== undefined && previousLinkedIndex !== matchIndex) {
      rereviewRequired = true
      reason = 'linked-source-moved'
      linked = linked === null ? null : { ...linked, previousIndex: previousLinkedIndex }
    }
  } else if (sameBaseIdentity) {
    // 只有地址变：规格要求「地址变化使来源关联待复核」，而不是悄悄沿用旧关联。
    state = 'review'
    reason = 'address-changed'
    rereviewRequired = true
  } else {
    state = 'invalid'
    reason = 'fingerprint-changed'
    rereviewRequired = true
  }
  return {
    version: SOURCE_BINDING_VERSION,
    route,
    previousRoute: previousRoute ?? null,
    candidates,
    links: candidates.filter((candidate) => candidate.state === 'match').map((candidate) => candidate.index),
    ...(linked === null ? {} : { linked }),
    ...(previous?.linked !== undefined && previous?.linked !== null && state !== 'invalid' && state !== 'review'
      ? { previousLinked: previous.linked }
      : {}),
    state,
    reason: reason ?? 'no-matching-source',
    // 关联待复核时必须由用户重新确认，绝不自动沿用旧关联。
    rereviewRequired,
    // 关联只表示「这条记录对应这条 route」；不携带 wire/compat，也绝不跨来源/渠道采纳。
    adoptionScope: 'candidate-identity-only',
    wireCarryover: false,
    note: '关联只登记身份，不代表能力实测或确定透传；wire/compat 只在当前渠道+协议精确匹配时才可建议',
  }
}

/**
 * 采纳单个候选：只有显式给出 candidateId 且该选项 `adoptable && !readOnly` 才通过。
 * 返回 `{ok:true, field, key, value}` 或 `{ok:false, error}`；绝不自动选择任何候选。
 */
export function adoptCandidate(groups, candidateId) {
  const id = String(candidateId ?? '')
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const option of group?.options ?? []) {
      if (option.candidateId !== id) continue
      if (option.adoptable !== true || option.readOnly === true) return { ok: false, error: 'not-adoptable', candidateId: id }
      return {
        ok: true,
        candidateId: id,
        field: group.field,
        ...(option.key !== undefined ? { key: option.key } : {}),
        value: clone(option.value),
        source: option.source,
        evidence: option.evidence,
      }
    }
  }
  return { ok: false, error: 'unknown-candidate', candidateId: id }
}

/**
 * 把一组**显式选定**的候选写入草稿副本：只提交手改 + 已采纳，未决建议不写入。
 * 任何未知/只读 candidateId → 整体拒绝（防伪造，且不产生半套状态）。
 * compat 按 key 合并进草稿 compat 对象。
 */
export function applyAdoption(draft, groups, candidateIds) {
  const next = isPlainObject(draft) ? clone(draft) : {}
  const applied = []
  for (const candidateId of Array.isArray(candidateIds) ? candidateIds : []) {
    const adopted = adoptCandidate(groups, candidateId)
    if (!adopted.ok) return { ok: false, error: adopted.error, candidateId: adopted.candidateId }
    if (adopted.key !== undefined) {
      next.compat = isPlainObject(next.compat) ? next.compat : {}
      next.compat[adopted.key] = adopted.value
    } else {
      next[adopted.field] = adopted.value
    }
    applied.push(adopted.candidateId)
  }
  return { ok: true, draft: next, applied }
}

// ─────────────────────────────────────────────────────────────────────────────
// 查询编排：OFF 零网络 / ON 固定来源 + 运行时
// ─────────────────────────────────────────────────────────────────────────────

async function readViaCache(cache, { sourceId, url, force, parse, sources, label }) {
  const entry = await cache.get({ sourceId, url, force, parse })
  const status = entry.status === 'ok' ? 'ok' : entry.status === 'cached' ? 'cached' : entry.status
  sources.push({
    sourceId: label ?? sourceId,
    status,
    url,
    network: true,
    fetchedAt: entry.fetchedAt ?? null,
    upstreamAt: entry.upstreamAt ?? null,
    etag: entry.etag || '',
    // 失败/过期可见，不宣称最新。
    error: entry.staleError ?? null,
  })
  return entry.payload ?? null
}

/**
 * 路由查询入口。**OFF 分支在取任何来源之前返回**：不读缓存、不触网、不发推理请求，
 * 返回值里 `network:false`、`groups:[]`。
 *
 * ON 分支：本地 pi-ai 目录总是可用（无网）；modelparams / OpenRouter 走注入的
 * `cache`（条件请求 + 单飞）或直接给的载荷；runtime 走 `runtimeInfo`。任何来源失败都在
 * `sources[].error` 可见，且不阻断其它来源。
 *
 * @param {object} options
 * @param {'off'|'on'} options.mode
 * @param {{channel:string, api:string, modelId:string, current?:object}} options.target
 * @param {object} [options.piIndex]  buildPiEvidence 产物
 * @param {object} [options.modelParamsIndex] indexModelParamsRecords 产物
 * @param {object} [options.modelParamsCatalog] 直接给目录（会内部建索引）
 * @param {object} [options.openRouterPayload] 直接给 OpenRouter 载荷（测试/离线）
 * @param {object} [options.runtimeInfo]  llm.resolveModelInfo 返回
 * @param {object} [options.cache] createMetadataCache 实例
 * @param {boolean} [options.forceRefresh] true=带 etag 条件刷新
 */
export async function querySmartFill(options = {}) {
  const mode = options.mode === SMART_FILL_MODES.ON ? SMART_FILL_MODES.ON : SMART_FILL_MODES.OFF
  if (mode === SMART_FILL_MODES.OFF) {
    // OFF：先于一切来源返回。这里绝不调用 cache/fetch/网络。
    return {
      mode: 'off',
      network: false,
      groups: [],
      runtime: null,
      sources: [{ sourceId: 'smart-fill', status: 'off', network: false, error: null }],
      notes: ['开关关闭：不访问外部资料、不探测渠道、不发推理请求'],
    }
  }

  const target = normalizeTarget(options.target)
  const sources = []
  const notes = []
  let attemptedNetwork = false

  // 1) 本机 pi-ai 目录（本地，不触网）
  const piIndex = options.piIndex ?? null
  sources.push({ sourceId: 'pi-ai', status: piIndex === null ? 'unavailable' : 'ok', network: false, error: null })

  // 2) modelparams：优先用直接给的索引/目录，否则走缓存条件请求
  let modelParamsIndex = options.modelParamsIndex ?? null
  if (modelParamsIndex !== null) {
    sources.push({ sourceId: 'modelparams', status: 'provided', network: false, error: null })
  } else if (isPlainObject(options.modelParamsCatalog)) {
    modelParamsIndex = indexModelParamsRecords(options.modelParamsCatalog)
    sources.push({ sourceId: 'modelparams', status: 'provided', network: false, error: null })
  } else if (options.cache !== undefined) {
    attemptedNetwork = true
    const request = modelParamsRequest()
    const payload = await readViaCache(options.cache, {
      sourceId: request.sourceId,
      url: request.url,
      force: Boolean(options.forceRefresh),
      parse: parseModelParamsPayload,
      sources,
    })
    if (payload !== null) modelParamsIndex = indexModelParamsRecords(payload)
  } else if (modelParamsIndex === null) {
    sources.push({ sourceId: 'modelparams', status: 'skipped', network: false, error: 'no-source' })
  }
  // 来源语义漂移留证：被跳过的条目数随来源状态回传（绝不静默当成「无资料」）。
  if (modelParamsIndex !== null && modelParamsIndex.skipped > 0) {
    const entry = sources.find((source) => source.sourceId === 'modelparams')
    if (entry !== undefined) {
      entry.skipped = modelParamsIndex.skipped
      entry.skippedDetail = modelParamsIndex.skippedDetail.slice(0, 20)
    }
  }

  // 3) OpenRouter：先用**原始 ID**查询（精确身份优先）；仅在原始 ID 于本地来源无记录、
  //    且精确查询也没有命中时，按别名候选回退**一次**（不级联，最多多一次请求）。
  let openRouterPayload = null
  if (options.openRouterPayload !== undefined) {
    openRouterPayload = options.openRouterPayload
    sources.push({ sourceId: 'openrouter', status: 'provided', network: false, error: null })
  } else if (options.cache !== undefined && target.modelId !== '') {
    attemptedNetwork = true
    const request = openRouterRequest(target.modelId)
    openRouterPayload = await readViaCache(options.cache, {
      sourceId: request.sourceId,
      url: request.url,
      force: Boolean(options.forceRefresh),
      parse: parseOpenRouterPayload,
      sources,
      label: 'openrouter',
    })
  } else {
    sources.push({ sourceId: 'openrouter', status: 'skipped', network: false, error: 'no-source' })
  }
  const exactMatches = openRouterPayload !== null ? openRouterMatches(target.modelId, openRouterPayload) : undefined
  let identity = resolveSmartFillIdentity(target.modelId, {
    piIndex,
    modelParamsIndex,
    openRouterMatchesCount: exactMatches?.matches?.length ?? 0,
  })
  let matches = exactMatches
  let identityFallback = null
  if (identity.via === 'alias' && options.cache !== undefined) {
    attemptedNetwork = true
    const request = openRouterRequest(identity.modelId)
    const fallbackPayload = await readViaCache(options.cache, {
      sourceId: request.sourceId,
      url: request.url,
      force: Boolean(options.forceRefresh),
      parse: parseOpenRouterPayload,
      sources,
      label: 'openrouter',
    })
    mergeOpenRouterFallback(sources, { requestedModelId: identity.requestedModelId, matchedModelId: identity.modelId, kind: identity.kind })
    matches = fallbackPayload !== null ? openRouterMatches(identity.modelId, fallbackPayload) : undefined
    identityFallback = { attempted: true, modelId: identity.modelId, kind: identity.kind, matched: matches?.matches?.length ?? 0 }
    if (matches !== undefined && matches.matches.length > 0) {
      identity.recognizedBy = [...new Set([...identity.recognizedBy, 'openrouter'])]
    }
  }
  // 别名只有在至少一个来源真的认出它时才启用；纯猜测不产生任何建议，退回精确身份。
  if (identity.via === 'alias' && identity.recognizedBy.length === 0) {
    identity = { requestedModelId: identity.requestedModelId, modelId: identity.requestedModelId, via: 'exact', kind: '', recognizedBy: [] }
    matches = exactMatches
  }
  const effectiveTarget = identity.via === 'alias' ? { ...target, modelId: identity.modelId } : target

  // 4) 运行时（本地投影，不触网、不发推理）
  const runtime = options.runtimeInfo !== undefined ? runtimeReference(options.runtimeInfo) : undefined
  sources.push({ sourceId: 'runtime', status: runtime === undefined ? 'unavailable' : 'ok', network: false, error: null })

  const modelParams = modelParamsIndex !== null ? modelParamsReference(modelParamsIndex, effectiveTarget.modelId) : undefined
  const references = matches !== undefined
    ? matches.matches.map((match) => openRouterReference(match)).filter((reference) => reference !== undefined)
    : []
  const built = buildSmartFillGroups({
    target: effectiveTarget,
    piIndex,
    modelParams,
    openRouter: matches !== undefined ? { matches: matches.matches, ambiguous: matches.ambiguous, references } : undefined,
    runtime,
  })

  if (matches !== undefined && matches.ambiguous) notes.push('OpenRouter 命中多个同名条目：保留全部候选，由用户选择')
  if (identity.via === 'alias') {
    // 别名只用于取资料：证据一律降级为「模型身份参考」。models3-fill 恒传 modelOnly，
    // buildSmartFillGroups 已降级过一遍；这里再兜底其它调用方，避免别名身份冒充精确渠道证据。
    for (const group of built.groups) {
      for (const option of group.options ?? []) {
        if (option.evidence === 'exact-channel-protocol') {
          option.evidence = 'model-identity'
          option.confidence = 'reference'
        }
        if (option.evidence === 'model-identity') {
          option.note = '用于查询的 ID「' + identity.requestedModelId.slice(0, 128) + '」无来源记录；按别名「' + identity.modelId.slice(0, 128) + '」匹配，仅作模型身份参考'
        }
      }
    }
    notes.push('用于查询的模型 ID 在固定来源没有记录：已按别名查询，建议仅作模型身份参考，需逐项确认')
  }
  return {
    mode: 'on',
    network: attemptedNetwork,
    groups: built.groups,
    sources,
    runtime: runtime ?? null,
    notes: [...notes, ...built.notes],
    // 身份留证：客户端据此提示「按别名查询」，原始 ID 与匹配 ID 都返回但不作任何写入默认。
    identity: {
      requestedModelId: identity.requestedModelId,
      modelId: identity.modelId,
      via: identity.via,
      kind: identity.kind,
      recognizedBy: [...identity.recognizedBy],
      ...(identityFallback !== null ? { openRouterFallback: identityFallback } : {}),
    },
  }
}
