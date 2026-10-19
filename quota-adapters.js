// Quota Adapter seam for @gehennawu/dsh-service.
//
// Every concrete Adapter exposes exactly the same small interface:
// { kind, recognize(profile), credentialPolicy(profile), fetchUsage(context), normalize(payload) }.
// Adapter-owned endpoint, credential, recognition, normalization, and configuration facts stay here;
// the host caller owns only throttling, lifecycle, bounded transports, and RPC orchestration.

const ADAPTER_METADATA = new WeakMap()
const MAX_QUOTA_PROVIDER_NAME = 128
const MAX_QUOTA_ERROR_DETAIL = 256
const MAX_QUOTA_CPA_ACCOUNTS = 8
const MAX_QUOTA_CPA_CALLS = 12
const QUOTA_CPA_CONCURRENCY = 3
const MAX_QUOTA_CPA_WINDOWS = 64

// 稳定错误码（客户端词典键）。传输层状态码是「具体原因」本身——401 凭据被拒 / 402 欠费 /
// 404 路径变更 / 429 限流 / 5xx 上游故障互不相同，故 http-status/upstream-status 保留
// `:状态码` 后缀原样下发（客户端取首段查词典、后缀单独展示；子代理「不可服务」判定
// QUOTA_UNUSABLE_STATUS_RE 依赖 4xx 后缀）。其余码的 `:detail` 只是内部说明，仍按首段归一。
function quotaErrorCode(error) {
  const raw = typeof error?.message === 'string' && error.message.length > 0 ? error.message : String(error ?? '')
  const colon = raw.indexOf(':')
  if (colon === -1) return raw
  const family = raw.slice(0, colon)
  return family === 'http-status' || family === 'upstream-status' ? raw : family
}

// 业务错误信封（HTTP 200 + `{code,msg,success:false}`）里的错误码不是「响应格式异常」。
// 上游把「凭据被拒 / 套餐失效 / 服务自身故障」都塞进 200 信封，只看 HTTP 状态会把三者
// 一律误报成格式问题（智谱开放平台实测：凭据有效、订阅生效，配额端点仍回
// `{"code":500,"msg":"内部服务器错误","success":false}`；同一凭据的推理端点正常回 1308 限流）。
// 码表取自智谱《错误码》文档，只对语义明确的码定族；未知码仍走 bad-payload 并透出上游原话——不猜。
// 归属：凭据类码走与 HTTP 401/403 同一条路（换候选 → 链尾归 credential-rejected，行回 unconfigured
// 以便就地重填）；套餐失效 = no-subscription；服务故障 = upstream-error（5xx 语义，不进
// QUOTA_UNUSABLE_ERROR_RE，故不会因配额服务抖动把渠道从子代理路由里摘掉——推理平面是好的）。
const QUOTA_ENVELOPE_AUTH_CODES = new Set([401, 403, 1000, 1001, 1003, 1005])
const QUOTA_ENVELOPE_NO_SUBSCRIPTION_CODES = new Set([1309, 1314])
const QUOTA_ENVELOPE_CREDENTIAL_CODES = new Set([1315])
const QUOTA_ENVELOPE_UPSTREAM_CODES = new Set([500, 1200, 1230, 1234])

/** 业务信封错误码 → 稳定错误码族（auth 由调用方按 401 处理）；无映射返回 undefined。 */
function quotaEnvelopeErrorFamily(code) {
  const value = Number(code)
  if (!Number.isFinite(value)) return undefined
  if (QUOTA_ENVELOPE_AUTH_CODES.has(value)) return 'auth'
  if (QUOTA_ENVELOPE_NO_SUBSCRIPTION_CODES.has(value)) return 'no-subscription'
  if (QUOTA_ENVELOPE_CREDENTIAL_CODES.has(value)) return 'credential-rejected'
  if (QUOTA_ENVELOPE_UPSTREAM_CODES.has(value)) return 'upstream-error'
  return undefined
}

function sanitizeQuotaErrorDetail(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' ? undefined : cleaned.slice(0, MAX_QUOTA_ERROR_DETAIL)
}

// ─── 统一错误详情（errorDetail）─────────────────────────────────────────────
// 各渠道的上游错误只有「原话」不同，取词规则一致：常见 message 字段优先，非 JSON
// （CDN/网关 HTML 错误页）去标签退化。宿主绝不在详情里拼用户可见句子——状态码走错误码
// 后缀、端点/账号走结构化字段，客户端按词典统一渲染。
const QUOTA_ERROR_MESSAGE_KEYS = ['message', 'msg', 'detail', 'error_description', 'description', 'error']

/** 上游错误载荷（对象或 JSON/纯文本）→ 一句人话；取不到返回 undefined。 */
function quotaUpstreamErrorMessage(payload, depth = 0) {
  if (typeof payload === 'string') {
    const text = payload.trim()
    if (text === '') return undefined
    try {
      const parsed = JSON.parse(text)
      const fromJson = quotaUpstreamErrorMessage(parsed, depth + 1)
      if (fromJson !== undefined) return fromJson
    } catch (_) {}
    // 非 JSON：去标签去空白，绝不把整页 HTML 塞进提示。
    const flattened = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return flattened === '' ? undefined : flattened
  }
  if (depth > 3 || payload === null || typeof payload !== 'object') return undefined
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = quotaUpstreamErrorMessage(item, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const key of QUOTA_ERROR_MESSAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue
    const found = quotaUpstreamErrorMessage(payload[key], depth + 1)
    if (found !== undefined) return found
  }
  return undefined
}

/** 详情脱敏：上游可能把请求头原样回显，凭据字面量（整头值与裸值）一律抹成 ***。 */
function quotaRedactCredentialText(value, secrets) {
  let redacted = typeof value === 'string' ? value : ''
  for (const secret of Array.isArray(secrets) ? secrets : []) {
    if (typeof secret !== 'string') continue
    const whole = secret.trim()
    if (whole.length < 8) continue
    const bare = whole.replace(/^\S+\s+/, '')
    for (const variant of new Set([whole, bare])) {
      if (variant.length < 8) continue
      redacted = redacted.split(variant).join('***')
    }
  }
  return redacted
}

/** 上游错误正文 → 可直接下发的 errorDetail：归一成人话 + 凭据脱敏 + 长度上限。 */
function quotaErrorDetailFromText(raw, secrets) {
  const message = quotaUpstreamErrorMessage(raw)
  if (message === undefined) return undefined
  return sanitizeQuotaErrorDetail(quotaRedactCredentialText(message, secrets))
}

function quotaHostnameMatches(hostname, registeredHost) {
  const actual = String(hostname || '').toLowerCase().replace(/\.$/, '')
  const expected = String(registeredHost || '').toLowerCase().replace(/\.$/, '')
  return actual === expected || actual.endsWith(`.${expected}`)
}

function normalizePinnedHostname(value) {
  if (typeof value !== 'string') return undefined
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  if (host.length === 0 || host.length > 253 || host.includes(':')) return undefined
  if (host.split('.').every((label) => /^(0x[0-9a-f]+|\d+)$/.test(label))) return undefined
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) return undefined
  return host
}

function safeBaseUrl(baseURL, hosts) {
  if (!Array.isArray(hosts) || hosts.length === 0) return undefined
  let parsed
  try { parsed = new URL(String(baseURL ?? '').trim()) } catch (_) { return undefined }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined
  if (parsed.port !== '' && parsed.port !== '443') return undefined
  if (!hosts.some((host) => quotaHostnameMatches(parsed.hostname, host))) return undefined
  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed
}

function cliproxyPinHostFromBaseURL(baseURL) {
  let parsed
  try { parsed = new URL(String(baseURL ?? '').trim()) } catch (_) { return undefined }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined
  if (parsed.port !== '' && parsed.port !== '443') return undefined
  return normalizePinnedHostname(parsed.hostname)
}

function pinnedHostFromProfile(profile) {
  const baseURL = String(profile?.baseURL ?? '').trim()
  if (baseURL === '') return { ok: false, error: 'no-base-url' }
  const host = cliproxyPinHostFromBaseURL(baseURL)
  return host === undefined ? { ok: false, error: 'unsafe-provider-endpoint' } : { ok: true, allowedHosts: [host] }
}

function credentialPolicy(options, profile) {
  const hints = []
  if (options.includeProfileHint !== false && typeof profile?.apiKeyEnv === 'string' && profile.apiKeyEnv !== '') {
    hints.push(profile.apiKeyEnv)
  }
  for (const name of options.keyHints ?? []) {
    if (!hints.includes(name)) hints.push(name)
  }
  const format = options.format === 'raw' ? (value) => value : (value) => `Bearer ${value}`
  return Object.freeze({
    hints: Object.freeze(hints),
    entryKey: options.entryKey ?? 'edit',
    autoVisibility: options.autoVisibility ?? 'always',
    format,
  })
}

function defineQuotaAdapter(definition, metadata = {}) {
  const adapter = Object.freeze({
    kind: definition.kind,
    recognize: definition.recognize,
    credentialPolicy: definition.credentialPolicy,
    fetchUsage: definition.fetchUsage,
    normalize: definition.normalize,
  })
  ADAPTER_METADATA.set(adapter, Object.freeze({
    configuration: metadata.configuration ?? 'fixed',
    endpoints: Object.freeze([...(metadata.endpoints ?? [])]),
    hosts: Object.freeze([...(metadata.hosts ?? [])]),
    routeIds: Object.freeze([...(metadata.routeIds ?? [])]),
    defaultBaseURL: typeof metadata.defaultBaseURL === 'string' && metadata.defaultBaseURL !== '' ? metadata.defaultBaseURL : undefined,
    usageUrl: metadata.usageUrl,
    usageBasePathname: typeof metadata.usageBasePathname === 'function' ? metadata.usageBasePathname : undefined,
    realmCaps: metadata.realmCaps,
  }))
  return adapter
}

/** 未声明端点的 profile 是否就是本 Adapter 的自有渠道：名字即身份（settings 路由键 / 运行时渠道 id）。
 * DSH 内置渠道（pi-ai 注册表渠道）被官方「模型」页启用时只写 apiKeyEnv——上游 baseUrl 只在注册表里，
 * settings 不写（`llm-pi-ai` schema 甚至拒绝空串 baseURL，「没写」才是唯一形态）→ 宿主读到的 profile
 * baseURL 为空，只能靠路由 id 认领。声明了端点却不在白名单的 profile 一律不认领（凭据不得改道）。 */
function adapterOwnsUndeclaredRoute(routeIds, profile) {
  return String(profile?.baseURL ?? '').trim() === '' && routeIds.includes(profile?.name)
}

function adapterRecognizesProfile(kind, hosts, runtimeChannels, routeIds, profile) {
  if (profile?.runtimeKind === kind) return true
  if (typeof profile?.runtimeChannel === 'string' && runtimeChannels.includes(profile.runtimeChannel)) return true
  const declared = String(profile?.baseURL ?? '').trim()
  if (declared === '') return adapterOwnsUndeclaredRoute(routeIds, profile)
  let parsed
  try { parsed = new URL(declared) } catch (_) { return false }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return false
  if (parsed.port !== '' && parsed.port !== '443') return false
  return hosts.some((host) => quotaHostnameMatches(parsed.hostname, host))
}

function adapterEndpoints(adapter, profile) {
  const metadata = ADAPTER_METADATA.get(adapter)
  if (metadata === undefined) return []
  if (metadata.endpoints.length > 0) return [...metadata.endpoints]
  const declared = String(profile?.baseURL ?? '').trim()
  // 内置渠道的 profile 不带端点 → 用 Adapter 自带的注册表默认端点；两路都经 safeBaseUrl 过
  // https/主机白名单，默认端点不是绕过校验的后门。
  const base = declared === ''
    ? (adapterOwnsUndeclaredRoute(metadata.routeIds, profile) ? safeBaseUrl(metadata.defaultBaseURL, metadata.hosts) : undefined)
    : safeBaseUrl(declared, metadata.hosts)
  if (base === undefined) return []
  // 适配器可对「显式 baseURL」声明用量路径归一（如 opencode-go 的协议组 baseUrl 不带 /v1，
  // 通用 /usage 拼接会打到上游 404 网页）；钩子返回 undefined 时走通用 /usage 拼接。
  if (typeof metadata.usageBasePathname === 'function') {
    const derived = metadata.usageBasePathname(base)
    if (derived !== undefined) return [derived.toString()]
  }
  base.pathname = `${base.pathname}/usage`.replace(/\/{2,}/g, '/')
  return [base.toString()]
}

function payloadWindows(normalized) {
  return Array.isArray(normalized?.windows) ? normalized.windows : undefined
}

function createEndpointAdapter(options) {
  let adapter
  adapter = defineQuotaAdapter({
    kind: options.kind,
    recognize(profile) {
      return adapterRecognizesProfile(options.kind, options.hosts ?? [], options.runtimeChannels ?? [], options.routeIds ?? [], profile)
    },
    credentialPolicy(profile) {
      return credentialPolicy(options, profile)
    },
    async fetchUsage(context) {
      const candidates = adapterEndpoints(adapter, context.profile)
      if (candidates.length === 0) throw new Error('no-base-url')
      const authorization = await context.credential()
      if (authorization === undefined) throw new Error('credential-missing')
      let lastError = null
      let parseFailure = null
      // 多候选链（zai 国内/国际双域、stepfun 双域）才有「哪个域失败了」的歧义；单候选的端点
      // 恒等于该 kind 唯一端点，附上只是噪音。状态码与上游原话由传输层挂在 error 上。
      const annotate = (error, endpoint) => {
        if (candidates.length > 1 && error !== null && typeof error === 'object' && error.endpoint === undefined) {
          try { error.endpoint = new URL(endpoint).hostname } catch (_) {}
        }
        return error
      }
      for (const endpoint of candidates) {
        let payload
        try {
          payload = await context.fetchJson(endpoint, authorization, { signal: context.signal })
        } catch (error) {
          lastError = annotate(error, endpoint)
          // 401/403 换下一个候选（智谱双域 Key 不互通）；单候选或已是最后一个候选时不在此抛出，
          // 一并交给链尾统一归入凭据类（错 key 要能就地重新填写，而不是丢一个状态码让用户猜）。
          if (error?.status === 401 || error?.status === 403
            || error?.message === 'http-status:401' || error?.message === 'http-status:403') continue
          throw lastError
        }
        const normalized = adapter.normalize(payload)
        const windows = payloadWindows(normalized)
        if (windows === undefined) {
          parseFailure ??= annotate(new Error('bad-payload:shape'), endpoint)
          lastError = parseFailure
          continue
        }
        if (windows.length === 0) {
          const sanitize = context.sanitizeErrorDetail ?? sanitizeQuotaErrorDetail
          // 业务信封（`{code!==0, msg}`）与 OpenAI 风格错误（`{error:{message}}`）两族；
          // 只认这两族，成功信封里的 `message:"OK"` 之类不当错误原因透出。
          const envelopeMessage = payload !== null && typeof payload === 'object'
            && Number(payload.code) !== 0 && typeof payload.msg === 'string'
            ? payload.msg
            : undefined
          const upstreamMessage = payload !== null && typeof payload === 'object'
            ? quotaUpstreamErrorMessage(payload.error)
            : undefined
          const detail = sanitize(envelopeMessage ?? upstreamMessage)
          // 信封错误码定族：凭据类与 HTTP 401/403 同路（换候选，链尾归 credential-rejected）。
          const family = payload !== null && typeof payload === 'object'
            ? quotaEnvelopeErrorFamily(payload.code)
            : undefined
          const error = new Error(family === undefined || family === 'auth' ? 'bad-payload' : family)
          if (family === 'auth') error.status = 401
          if (detail !== undefined) error.detail = detail
          parseFailure ??= annotate(error, endpoint)
          lastError = parseFailure
          continue
        }
        return payload
      }
      const failure = parseFailure ?? lastError ?? new Error('bad-payload')
      // 上游 401/403 = 凭据本身被拒（key 写错/已失效/不属于该账号），与 Cookie 类渠道同一语义：
      // 归入凭据类，行回 unconfigured 以便就地重新填写；上游原话与失败端点原样保留在详情里。
      if (failure?.status === 401 || failure?.status === 403) {
        const rejected = new Error('credential-rejected')
        if (typeof failure.detail === 'string' && failure.detail !== '') rejected.detail = failure.detail
        if (typeof failure.endpoint === 'string' && failure.endpoint !== '') rejected.endpoint = failure.endpoint
        throw rejected
      }
      throw failure
    },
    normalize: options.normalize,
  }, {
    configuration: options.endpoints === undefined ? 'recognized' : 'fixed',
    endpoints: options.endpoints,
    hosts: options.hosts,
    routeIds: options.routeIds,
    defaultBaseURL: options.defaultBaseURL,
    usageUrl: options.usageUrl,
    usageBasePathname: options.usageBasePathname,
  })
  return adapter
}

function createComposedAdapter(options) {
  return defineQuotaAdapter({
    kind: options.kind,
    recognize(profile) {
      return adapterRecognizesProfile(options.kind, options.hosts ?? [], options.runtimeChannels ?? [], options.routeIds ?? [], profile)
    },
    credentialPolicy(profile) {
      return credentialPolicy(options, profile)
    },
    async fetchUsage(context) {
      const guard = options.guard?.(context.profile, context.config) ?? null
      if (guard !== null) throw new Error(guard)
      const credential = await context.credential()
      if (credential === undefined) throw new Error('credential-missing')
      return options.fetch({
        profile: context.profile,
        config: context.config,
        credential,
        signal: context.signal,
        requestJson: context.requestJson,
      })
    },
    normalize(payload) {
      const windows = Array.isArray(payload) ? payload : payloadWindows(payload)
      return { windows: Array.isArray(windows) ? windows : [] }
    },
  }, {
    configuration: options.configuration ?? 'fixed',
    hosts: options.hosts,
    routeIds: options.routeIds,
    defaultBaseURL: options.defaultBaseURL,
    usageUrl: options.usageUrl,
    realmCaps: options.realmCaps,
  })
}

function normalizePercentValue(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.min(100, Math.round(n))
}

function normalizeResetTimestamp(value) {
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return new Date(n > 1e12 ? n : n * 1000).toISOString()
}

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

const ZAI_WINDOW_TYPE_ORDER = { 'tokens-limit': 0, 'credit-limit': 1, 'time-limit': 2 }
function normalizeZaiCodingUsage(payload) {
  const windows = []
  const limits = payload?.data?.limits
  if (!Array.isArray(limits)) return { windows }
  for (const [index, limit] of limits.entries()) {
    if (limit === null || typeof limit !== 'object') continue
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
    const resetsAt = normalizeResetTimestamp(limit.nextResetTime)
    windows.push({ id, percent, ...(resetsAt !== undefined ? { resetsAt } : {}) })
  }
  const orderOf = (id) => ZAI_WINDOW_TYPE_ORDER[String(id).split('-').slice(0, 2).join('-')] ?? 3
  windows.sort((a, b) => orderOf(a.id) - orderOf(b.id))
  return { windows }
}

function normalizeOpenRouterCredits(payload) {
  const data = payload?.data !== null && typeof payload?.data === 'object' ? payload.data : payload
  const total = Number(data?.total_credits ?? data?.credits)
  const used = Number(data?.total_usage ?? data?.usage)
  if (!Number.isFinite(total) || !Number.isFinite(used)) return { windows: [] }
  // 未充值/免费渠道 key：官方 credits 端点照常 200，但 total_credits 为 0——这不是「响应格式异常」，
  // 而是余额确为零；百分比在 0/0 上无意义，改给可读余额文本（与其它余额型 provider 同一形态）。
  if (total <= 0) return { windows: [{ id: 'credits', text: `$${Math.max(0, total - used).toFixed(2)}` }] }
  return { windows: [{ id: 'credits', percent: Math.max(0, Math.min(100, Math.round((used / total) * 100))) }] }
}

function normalizeKimiBalance(payload) {
  const raw = payload?.available_balance ?? payload?.balance ?? payload?.cash_balance ?? payload?.data?.available_balance
  const fen = Number(raw)
  if (!Number.isFinite(fen) || fen < 0) return { windows: [] }
  const yuan = fen >= 100 ? fen / 100 : fen
  return { windows: [{ id: 'balance', text: `¥${(Math.round(yuan * 100) / 100).toFixed(2)}` }] }
}

function normalizeSiliconFlowInfo(payload) {
  const data = payload?.data !== null && typeof payload?.data === 'object' ? payload.data : payload
  const raw = data?.balance ?? data?.amount ?? data?.remain ?? data?.remaining
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0) return { windows: [] }
  return { windows: [{ id: 'balance', text: `¥${(Math.round(amount * 100) / 100).toFixed(2)}` }] }
}

function normalizeDeepseekMoney(value) {
  if (typeof value === 'string' && value.trim() === '') return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return (Math.round(amount * 100) / 100).toFixed(2)
}

function deepseekMoneyText(amount, currency) {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : ''
  return symbol === '' ? `${amount} ${currency}` : `${symbol}${amount}`
}

function normalizeDeepseekBalance(payload) {
  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
  const windows = []
  const seenCurrencies = new Set()
  for (const info of infos) {
    if (info === null || typeof info !== 'object') continue
    const rawCurrency = typeof info.currency === 'string' ? info.currency.trim().toUpperCase() : ''
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

function normalizeStepfunMoney(value) {
  if (typeof value === 'string' && value.trim() === '') return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return (Math.round(amount * 100) / 100).toFixed(2)
}

function normalizeStepfunBalance(payload) {
  const balance = normalizeStepfunMoney(payload?.balance)
  if (balance === null) return { windows: [] }
  const windows = [{ id: 'balance', text: `¥${balance}`, kindKey: 'balance' }]
  const voucher = normalizeStepfunMoney(payload?.total_voucher_balance)
  if (voucher !== null && Number(voucher) > 0) {
    windows.push({ id: 'granted-balance', text: `¥${voucher}`, kindKey: 'granted-balance' })
  }
  return { windows }
}

const XIAOMI_TOKEN_PLAN_DETAIL_URL = 'https://platform.xiaomimimo.com/api/v1/tokenPlan/detail'
const XIAOMI_TOKEN_PLAN_USAGE_URL = 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage'

function unwrapXiaomiConsoleEnvelope(payload) {
  if (payload === null || typeof payload !== 'object') throw new Error('bad-payload')
  const code = Number(payload.code)
  if (!Number.isFinite(code)) throw new Error('bad-payload')
  if (code === 0 || code === 200) return payload.data !== null && typeof payload.data === 'object' ? payload.data : {}
  const detail = sanitizeQuotaErrorDetail(typeof payload.message === 'string' ? payload.message : undefined)
  const error = new Error(code === 401 ? 'credential-rejected' : 'bad-payload')
  if (detail !== undefined) error.detail = detail
  throw error
}

function normalizeXiaomiTokenPlanUsage(detailData, usageData) {
  const windows = []
  const planName = typeof detailData?.planName === 'string' ? detailData.planName.trim().slice(0, MAX_QUOTA_PROVIDER_NAME) : ''
  if (planName !== '') windows.push({ id: 'plan', kindKey: 'plan-name', text: planName })
  const periodEnd = detailData?.expired === true ? undefined : normalizeResetTimestamp(detailData?.currentPeriodEnd)
  const items = Array.isArray(usageData?.usage?.items) ? usageData.usage.items : []
  const seenNames = new Set()
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (name === '' || seenNames.has(name)) continue
    if (name === 'compensation_total_token' && Number(item.limit) === 0) continue
    const fraction = Number(item.percent)
    if (!Number.isFinite(fraction)) continue
    seenNames.add(name)
    const used = Number(item.used)
    const limit = Number(item.limit)
    windows.push({
      id: name,
      kindKey: name,
      percent: Math.max(0, Math.min(100, Math.round(fraction * 100))),
      ...(Number.isFinite(used) && used >= 0 ? { used } : {}),
      ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
      ...(periodEnd !== undefined ? { resetsAt: periodEnd } : {}),
    })
  }
  return windows
}

async function fetchXiaomiTokenPlanUsage({ credential, signal, requestJson }) {
  if (typeof requestJson !== 'function') throw new Error('transport-unavailable')
  const cookie = String(credential ?? '').trim().replace(/^cookie:\s*/i, '')
  if (cookie === '') throw new Error('credential-missing')
  const fetchEnvelope = async (url) => {
    try {
      return unwrapXiaomiConsoleEnvelope(await requestJson(url, { cookie, signal }))
    } catch (error) {
      if (error?.message === 'http-status:401' || error?.message === 'http-status:403') throw new Error('credential-rejected')
      throw error
    }
  }
  const detailData = await fetchEnvelope(XIAOMI_TOKEN_PLAN_DETAIL_URL)
  const usageData = await fetchEnvelope(XIAOMI_TOKEN_PLAN_USAGE_URL)
  const hasPlan = typeof detailData?.planCode === 'string' && detailData.planCode.trim() !== ''
  const windows = normalizeXiaomiTokenPlanUsage(detailData, usageData)
  if (!hasPlan && windows.length === 0) throw new Error('no-subscription')
  return windows
}

const STEPFUN_STEP_PLAN_RATE_LIMIT_URL = 'https://platform.stepfun.com/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit'

function stepfunJwtDeviceId(jwt) {
  const parts = String(jwt ?? '').split('.')
  if (parts.length < 2) return undefined
  let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  while (payload.length % 4 !== 0) payload += '='
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    return typeof json?.device_id === 'string' && json.device_id !== '' ? json.device_id : undefined
  } catch (_) {
    return undefined
  }
}

function stepfunWebIdFromToken(token) {
  const halves = String(token ?? '').split('...')
  for (let index = halves.length - 1; index >= 0; index--) {
    const deviceId = stepfunJwtDeviceId(halves[index])
    if (deviceId !== undefined) return deviceId
  }
  return undefined
}

function pickQuotaField(target, snake, camel) {
  if (target === null || typeof target !== 'object') return undefined
  return target[snake] !== undefined ? target[snake] : target[camel]
}

function pushStepFunRateWindow(windows, id, rawRate, rawReset) {
  const rate = Number(rawRate)
  if (!Number.isFinite(rate)) return
  const fraction = Math.max(0, Math.min(1, rate))
  const resetsAt = rawReset === undefined ? undefined : normalizeResetTimestamp(rawReset)
  windows.push({
    id,
    kindKey: id,
    percent: Math.round((1 - fraction) * 100),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  })
}

function normalizeStepFunStepPlanUsage(payload) {
  const windows = []
  if (payload === null || typeof payload !== 'object' || Number(payload.status) !== 1) return windows
  const fiveHourReset = Number(pickQuotaField(payload, 'five_hour_usage_reset_time', 'fiveHourUsageResetTime') ?? 0)
  const weeklyReset = Number(pickQuotaField(payload, 'weekly_usage_reset_time', 'weeklyUsageResetTime') ?? 0)
  if (fiveHourReset > 0 || weeklyReset > 0) {
    pushStepFunRateWindow(windows, 'five-hour',
      pickQuotaField(payload, 'five_hour_usage_left_rate', 'fiveHourUsageLeftRate'),
      pickQuotaField(payload, 'five_hour_usage_reset_time', 'fiveHourUsageResetTime'))
    pushStepFunRateWindow(windows, 'weekly',
      pickQuotaField(payload, 'weekly_usage_left_rate', 'weeklyUsageLeftRate'),
      pickQuotaField(payload, 'weekly_usage_reset_time', 'weeklyUsageResetTime'))
    return windows
  }
  const credit = pickQuotaField(payload, 'plan_credit_rate_limit', 'planCreditRateLimit')
  if (credit === undefined || typeof credit !== 'object') return windows
  const resetAt = normalizeResetTimestamp(pickQuotaField(credit, 'subscription_credit_reset_time', 'subscriptionCreditResetTime'))
  const buckets = pickQuotaField(credit, 'credit_buckets', 'creditBuckets')
  const entries = Array.isArray(buckets) ? buckets : []
  let totalSum = 0
  let residualSum = 0
  let bucketsValid = entries.length > 0
  for (const bucket of entries) {
    if (bucket === null || typeof bucket !== 'object') { bucketsValid = false; break }
    const total = Number(pickQuotaField(bucket, 'credit_total', 'creditTotal'))
    const residual = Number(pickQuotaField(bucket, 'credit_residual', 'creditResidual'))
    if (!Number.isFinite(total) || !Number.isFinite(residual) || total <= 0 || residual < 0 || residual > total) {
      bucketsValid = false
      break
    }
    totalSum += total
    residualSum += residual
  }
  if (bucketsValid && totalSum > 0) {
    windows.push({
      id: 'credit-pool',
      kindKey: 'credit-pool',
      percent: Math.max(0, Math.min(100, Math.round((1 - residualSum / totalSum) * 100))),
      ...(resetAt !== undefined ? { resetsAt: resetAt } : {}),
    })
  } else {
    pushStepFunRateWindow(windows, 'credit-pool',
      pickQuotaField(credit, 'subscription_credit_left_rate', 'subscriptionCreditLeftRate'),
      pickQuotaField(credit, 'subscription_credit_reset_time', 'subscriptionCreditResetTime'))
    pushStepFunRateWindow(windows, 'topup-credit',
      pickQuotaField(credit, 'topup_credit_left_rate', 'topupCreditLeftRate'))
  }
  return windows
}

async function fetchStepFunStepPlanUsage({ credential, signal, requestJson }) {
  if (typeof requestJson !== 'function') throw new Error('transport-unavailable')
  const token = String(credential ?? '').trim().replace(/^oasis-token:\s*/i, '').replace(/^cookie:\s*/i, '')
  if (token === '') throw new Error('credential-missing')
  const webId = stepfunWebIdFromToken(token)
  if (webId === undefined) throw new Error('credential-rejected')
  let payload
  try {
    payload = await requestJson(STEPFUN_STEP_PLAN_RATE_LIMIT_URL, {
      method: 'POST',
      body: '{}',
      signal,
      headers: {
        'Oasis-Token': token,
        'Oasis-Webid': webId,
        'Oasis-appID': '10300',
        'Oasis-Platform': 'web',
      },
    })
  } catch (error) {
    if (error?.message === 'http-status:401' || error?.message === 'http-status:403') throw new Error('credential-rejected')
    throw error
  }
  if (payload === null || typeof payload !== 'object' || Number(payload.status) !== 1) {
    const detail = sanitizeQuotaErrorDetail(payload !== null && typeof payload === 'object' && typeof payload.desc === 'string' ? payload.desc : undefined)
    const error = new Error('bad-payload')
    if (detail !== undefined) error.detail = detail
    throw error
  }
  const windows = normalizeStepFunStepPlanUsage(payload)
  if (windows.length === 0) throw new Error('no-subscription')
  return windows
}

// ─── Command Code（command-goat）账号额度 ────────────────────────────────────
// 数据源是 Command Code 的账号额度面（官方 CLI `cmd /usage` 与 Studio 用量页同一组端点，
// 全部是宿主常量、无 baseURL 派生）：`GET /alpha/whoami`（取 org.id，个人号 org 为 null）→
// `GET /alpha/billing/credits?orgId=`（credits 三源 + windowLimits.fiveHour/weekly 的 used/cap/resetAt）→
// `GET /alpha/billing/subscriptions?orgId=`（planId/status/currentPeriodStart/currentPeriodEnd）→
// `GET /alpha/usage/summary?orgId=&since=`（本计费周期 totalCost/totalCount/totalTokens）。
// 认证与推理同 key（Bearer <CMD_API_KEY>，`user_*` 前缀）。归一化口径与 Studio 用量页一致：
// 余额窗 = monthlyCredits + purchasedCredits + freeCredits，另出「本周期已用」与「套餐」两个文本窗；
// 窗口 used/cap 是 Credit 数（非 0..1 比例）→ 折算已用百分比，绝对数原样下发（客户端做缩写）；
// resetAt 是毫秒时间戳。
const COMMAND_CODE_WHOAMI_URL = 'https://api.commandcode.ai/alpha/whoami'
const COMMAND_CODE_CREDITS_URL = 'https://api.commandcode.ai/alpha/billing/credits'
const COMMAND_CODE_SUBSCRIPTIONS_URL = 'https://api.commandcode.ai/alpha/billing/subscriptions'
const COMMAND_CODE_USAGE_URL = 'https://api.commandcode.ai/alpha/usage/summary'

/** 金额归一到两位小数字符串：负数/非有限/空值拒绝。两个「数值化陷阱」都要堵：
 * `Number('')` 与 `Number(null)` 都是 0——上游缺字段会被伪装成 $0.00 余额。 */
function normalizeCommandCodeMoney(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return (Math.round(amount * 100) / 100).toFixed(2)
}

/** Command Code 窗口（五小时/周）→ 已用百分比窗口。used/cap 是绝对 Credit 数，
 * 折算成已用 % 并保留绝对数；cap<=0 或 used 缺失/非法时跳过该窗（不伪造 0%）。
 * `unit:'usd'` 声明绝对数的量纲：Command Code 的 Credit 与美元 1:1（实测
 * `monthlyCredits + fiveHour.used` 恰等于该计划总额 70），故两列都该带 `$`——
 * 缺量纲时客户端按 token 数缩写渲染，`14` 会被误读成别的量。 */
function pushCommandCodeWindow(windows, id, entry) {
  if (entry === null || typeof entry !== 'object') return
  // `Number(null) === 0` 同款坑：缺 used/cap 时先显式挡掉，否则会造出「已用 0 / 上限 0」的假窗。
  if (entry.used === null || entry.used === undefined || entry.cap === null || entry.cap === undefined) return
  const used = Number(entry.used)
  const cap = Number(entry.cap)
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(cap) || cap <= 0) return
  const resetsAt = normalizeResetTimestamp(entry.resetAt)
  windows.push({
    id,
    kindKey: id,
    percent: Math.max(0, Math.min(100, Math.round((used / cap) * 100))),
    used: Math.round(used * 100) / 100,
    limit: Math.round(cap * 100) / 100,
    unit: 'usd',
    ...(resetsAt !== undefined ? { resetsAt } : {}),
  })
}

/** 四端点原始载荷 → 窗口。credits 响应自带嵌套信封 `{credits:{monthlyCredits,…},windowLimits}`、
 * subscriptions 是 `{success,data:{planId,…}}`、summary 与 whoami 是平铺对象——各自按真实形状取。
 * 文本窗口只放可读金额与套餐标识（宿主不拼句子，窗口名走客户端词典）；
 * summary 缺席时「本周期已用」整行不下发，绝不拿剩余冒充总额。 */
function normalizeCommandCodeQuota(payload) {
  const windows = []
  if (payload === null || typeof payload !== 'object') return { windows }
  const rawCredits = payload.credits !== null && typeof payload.credits === 'object' ? payload.credits : null
  const creditSources = rawCredits?.credits !== null && typeof rawCredits?.credits === 'object' ? rawCredits.credits : null
  if (creditSources !== null) {
    const monthly = normalizeCommandCodeMoney(creditSources.monthlyCredits)
    const purchased = normalizeCommandCodeMoney(creditSources.purchasedCredits)
    const free = normalizeCommandCodeMoney(creditSources.freeCredits)
    if (monthly !== null || purchased !== null || free !== null) {
      const remaining = Number(monthly ?? 0) + Number(purchased ?? 0) + Number(free ?? 0)
      windows.push({ id: 'balance', kindKey: 'balance', text: `$${remaining.toFixed(2)}` })
    }
  }
  const rawSummary = payload.summary !== null && typeof payload.summary === 'object' ? payload.summary : null
  const spent = rawSummary === null ? null : normalizeCommandCodeMoney(rawSummary.totalCost)
  if (spent !== null) windows.push({ id: 'period-spend', kindKey: 'period-spend', text: `$${spent}` })
  const subscription = payload.subscription?.data !== null && typeof payload.subscription?.data === 'object'
    ? payload.subscription.data
    : payload.subscription !== null && typeof payload.subscription === 'object' ? payload.subscription : null
  const rawPlan = typeof subscription?.planId === 'string' ? subscription.planId.trim() : ''
  if (rawPlan !== '') {
    const periodEnd = normalizeResetTimestamp(subscription?.currentPeriodEnd)
    windows.push({
      id: 'plan',
      kindKey: 'plan-name',
      text: rawPlan.replace(/[_-]+/g, ' ').trim().slice(0, MAX_QUOTA_PROVIDER_NAME),
      ...(periodEnd !== undefined ? { resetsAt: periodEnd } : {}),
    })
  }
  const limits = rawCredits?.windowLimits !== null && typeof rawCredits?.windowLimits === 'object' ? rawCredits.windowLimits : null
  if (limits !== null) {
    pushCommandCodeWindow(windows, 'five-hour', limits.fiveHour)
    pushCommandCodeWindow(windows, 'weekly', limits.weekly)
  }
  return { windows }
}

/** Command Code 编排：whoami 取 orgId（认证失败即止，不再打后续端点）→ credits/subscriptions
 * 并发取 → usage/summary 带上订阅周期起点（官方 CLI 同序，让花费口径锚在当个计费周期）。
 * 个人号 org=null，orgId 为空时端点不带查询参数；401/403 一律归一 credential-rejected
 * （错 key 要能就地重填）。三段额度面独立失败不拖垮整行——有任一段可用即展示，
 * 全不可用才抛首个端点的稳定错误码（原话随 detail 透出）。 */
async function fetchCommandCodeQuota({ credential, signal, requestJson }) {
  if (typeof requestJson !== 'function') throw new Error('transport-unavailable')
  const raw = String(credential ?? '').trim()
  if (raw === '') throw new Error('credential-missing')
  // 发现链已按 policy.format 加了 Bearer；粘贴带回的 `Authorization: Bearer x` 整头也容错。
  const token = raw.replace(/^authorization:\s*/i, '').replace(/^bearer\s+/i, '')
  if (token === '') throw new Error('credential-missing')
  const authorization = `Bearer ${token}`
  const blocking = (error) => error?.message === 'http-status:401' || error?.message === 'http-status:403'
  const get = async (endpoint) => {
    try {
      return { ok: true, value: await requestJson(endpoint, { authorization, signal }) }
    } catch (error) {
      if (blocking(error)) {
        // 错 key 归凭据类（行回 unconfigured 以便就地重填），但上游原话照旧透出——
        // 统一失败信封要求「为什么被拒」可读，不能只剩一个家族码。
        const rejected = new Error('credential-rejected')
        if (typeof error?.detail === 'string' && error.detail !== '') rejected.detail = error.detail
        throw rejected
      }
      return { ok: false, error }
    }
  }
  const whoami = await get(COMMAND_CODE_WHOAMI_URL)
  if (whoami.ok !== true) {
    // 认证面都拿不到：orgId 无处可取，后三个端点必然同样失败，直接如实报首个错误。
    throw whoami.error
  }
  const orgId = typeof whoami.value?.org?.id === 'string' && whoami.value.org.id.trim() !== '' ? whoami.value.org.id.trim() : ''
  const query = orgId === '' ? '' : `?orgId=${encodeURIComponent(orgId)}`
  const [creditsResult, subscriptionResult] = await Promise.all([
    get(`${COMMAND_CODE_CREDITS_URL}${query}`),
    get(`${COMMAND_CODE_SUBSCRIPTIONS_URL}${query}`),
  ])
  const subscription = subscriptionResult.ok === true ? subscriptionResult.value : null
  const periodStart = typeof subscription?.data?.currentPeriodStart === 'string' ? subscription.data.currentPeriodStart.trim() : ''
  const summaryParams = periodStart === ''
    ? query
    : `${query === '' ? '?' : `${query}&`}since=${encodeURIComponent(periodStart)}`
  const summaryResult = await get(`${COMMAND_CODE_USAGE_URL}${summaryParams}`)
  const failures = [creditsResult, subscriptionResult, summaryResult].filter((result) => result.ok !== true)
  const windows = normalizeCommandCodeQuota({
    credits: creditsResult.ok === true ? creditsResult.value : null,
    subscription,
    summary: summaryResult.ok === true ? summaryResult.value : null,
  }).windows
  if (windows.length === 0) {
    const first = failures[0]
    if (first !== undefined) throw first.error
    throw new Error('bad-payload:shape')
  }
  return windows
}

const CLIPROXY_CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CLIPROXY_GEMINI_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
// antigravity 额度候选（v1.4.8 修订 + 复核收敛为 daily-only）：CPA 的 antigravity 流量默认全打
// daily-cloudcode-pa（executor 源码 "Consumer credentials default to daily"），真实用量只在 daily
// 池。prod（cloudcode-pa）是独立配额池：对同一账号返回 200+合法形状但数字近乎全空（2026-09-04
// 真机实测 daily 5h≈38% vs prod 5h=0%，周窗锚点 23:56 vs 13:48 两池各异），且管理面 auth-files
// 不回传企业自定义 base_url（存在 auth 文件 metadata 里），插件无法识别「该查 prod」的部署——
// 错池数字一经展示即成「数据不对」，比窗口缺席更糟，故 prod 候选整段移除，daily 失败诚实报错。
// 层内顺序：summary（组级 5h/周）→ fetchAvailableModels（模型级）→ retrieveUserQuota（项目级）。
const CLIPROXY_ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
]
const CLIPROXY_SUPPORTED_ACCOUNT_KINDS = new Set(['codex', 'gemini', 'gemini-cli', 'antigravity'])
const CODEX_WINDOW_ORDER = new Map([
  ['codex-5h', 0],
  ['codex-day', 1],
  ['codex-week', 2],
  ['codex-month', 3],
  ['codex-primary', 4],
  ['codex-secondary', 5],
])
const ANTIGRAVITY_WINDOW_ORDER = new Map([
  ['gemini-5h', 0],
  ['gemini-week', 1],
  ['claude-5h', 2],
  ['claude-week', 3],
])

function safeCliproxyOrigin(baseURL, pinnedHosts) {
  if (!Array.isArray(pinnedHosts) || pinnedHosts.length === 0) return undefined
  let parsed
  try { parsed = new URL(String(baseURL ?? '').trim()) } catch (_) { return undefined }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return undefined
  if (parsed.port !== '' && parsed.port !== '443') return undefined
  const host = normalizePinnedHostname(parsed.hostname)
  if (host === undefined || !pinnedHosts.includes(host)) return undefined
  return parsed.origin
}

function cliproxyFetchGuard(profile, config) {
  const base = String(profile?.baseURL ?? '').trim()
  if (base === '') return 'no-base-url'
  const pinned = Array.isArray(config?.allowedHosts?.[profile.name]) ? config.allowedHosts[profile.name] : []
  return safeCliproxyOrigin(base, pinned) === undefined ? 'host-not-pinned' : null
}

function stableTextCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortCliproxyWindows(windows) {
  return windows
    .map((window, index) => ({ window, index, key: String(window.kindKey ?? window.id ?? '').toLowerCase() }))
    .sort((left, right) => stableTextCompare(left.key, right.key) || left.index - right.index)
    .map(({ window }) => window)
}

function sortCodexWindows(windows) {
  return windows
    .map((window, index) => ({ window, index, key: String(window.kindKey ?? window.id ?? '').toLowerCase() }))
    .sort((left, right) => {
      const leftRank = CODEX_WINDOW_ORDER.get(String(left.window.kindKey ?? '')) ?? Number.MAX_SAFE_INTEGER
      const rightRank = CODEX_WINDOW_ORDER.get(String(right.window.kindKey ?? '')) ?? Number.MAX_SAFE_INTEGER
      return leftRank - rightRank || stableTextCompare(left.key, right.key) || left.index - right.index
    })
    .map(({ window }) => window)
}

function codexWindowCode(key, window) {
  const seconds = Number(window.limit_window_seconds)
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds <= 6 * 3600) return 'codex-5h'
    if (seconds <= 24 * 3600) return 'codex-day'
    if (seconds <= 8 * 24 * 3600) return 'codex-week'
    return 'codex-month'
  }
  return key === 'primary_window' ? 'codex-primary' : 'codex-secondary'
}

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
  return sortCodexWindows(windows)
}

function parseCodexSignals(quota) {
  const signals = quota?.signals
  if (signals === null || typeof signals !== 'object') return []
  const windows = []
  const pUsed = normalizePercentValue(signals['X-Codex-Primary-Used-Percent'] ?? signals['x-codex-primary-used-percent'])
  const pReset = normalizeResetTimestamp(signals['X-Codex-Primary-Reset-At'] ?? signals['x-codex-primary-reset-at'])
  if (pUsed !== null) {
    windows.push({ id: 'codex-5h', kindKey: 'codex-5h', percent: pUsed, ...(pReset !== undefined ? { resetsAt: pReset } : {}) })
  }
  const sUsed = normalizePercentValue(signals['X-Codex-Secondary-Used-Percent'] ?? signals['x-codex-secondary-used-percent'])
  const sReset = normalizeResetTimestamp(signals['X-Codex-Secondary-Reset-At'] ?? signals['x-codex-secondary-reset-at'])
  if (sUsed !== null) {
    windows.push({ id: 'codex-week', kindKey: 'codex-week', percent: sUsed, ...(sReset !== undefined ? { resetsAt: sReset } : {}) })
  }
  return sortCodexWindows(windows)
}

/** 快照回退窗口（v1.3.1 复核修订）：auth-files 内嵌 quota.signals 是 CPA 上次代调时缓存的
 * 快照，age 无上界（实测部署可停在昨天）——只在对应账号实时 api-call 失败时代用。两道处理：
 * ① 重置点已过的窗口是死数据（快照描述的窗口已结束），直接丢弃，绝不显示「重置时间在过去」；
 * ② 其余窗口保留但打 stale 标记，客户端渲染「缓存」徽标，与实时窗口可区分。 */
function cliproxFallbackWindows(account, now = Date.now()) {
  const usable = []
  for (const window of account.fallbackWindows ?? []) {
    const resetMs = typeof window.resetsAt === 'string' ? Date.parse(window.resetsAt) : Number(window.resetsAt)
    if (Number.isFinite(resetMs) && resetMs <= now) continue
    usable.push({ ...window, stale: true })
  }
  return usable
}

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
  return windows.sort((a, b) => b.percent - a.percent)
}

function normalizeAntigravityQuotaSummary(groups) {
  const windows = []
  if (!Array.isArray(groups)) return windows
  for (const group of groups) {
    if (group === null || typeof group !== 'object' || !Array.isArray(group.buckets)) continue
    const isGemini = String(group.displayName ?? '').toLowerCase().includes('gemini')
    for (const bucket of group.buckets) {
      if (bucket === null || typeof bucket !== 'object') continue
      const windowType = String(bucket.window ?? bucket.bucketId ?? '').toLowerCase()
      const is5h = windowType.includes('5h')
      const code = isGemini
        ? (is5h ? 'gemini-5h' : 'gemini-week')
        : (is5h ? 'claude-5h' : 'claude-week')
      const remaining = Number(bucket.remainingFraction)
      if (!Number.isFinite(remaining)) continue
      const fraction = Math.max(0, Math.min(1, remaining))
      const resetsAt = normalizeResetTimestamp(bucket.resetTime)
      windows.push({
        id: code,
        kindKey: code,
        percent: Math.round((1 - fraction) * 100),
        ...(resetsAt !== undefined ? { resetsAt } : {}),
      })
    }
  }
  return windows.sort((a, b) => {
    const rankA = ANTIGRAVITY_WINDOW_ORDER.get(a.id) ?? 99
    const rankB = ANTIGRAVITY_WINDOW_ORDER.get(b.id) ?? 99
    return rankA - rankB
  })
}

function normalizeAntigravityModels(models) {
  const windows = []
  if (models === null || typeof models !== 'object') return windows
  const entries = Array.isArray(models)
    ? models.map((item) => [String(item?.name ?? item?.modelId ?? item?.id ?? item?.model ?? ''), item])
    : Object.entries(models)
  for (const [rawModelId, entry] of entries) {
    if (entry === null || typeof entry !== 'object') continue
    if (entry.isInternal === true || entry.is_internal === true) continue
    const modelId = String(rawModelId || entry.name || entry.modelId || entry.id || entry.model || '').trim()
    if (modelId === '') continue
    const info = entry.quotaInfo !== null && typeof entry.quotaInfo === 'object' ? entry.quotaInfo
      : entry.quota_info !== null && typeof entry.quota_info === 'object' ? entry.quota_info
      : entry
    const remaining = Number(info.remainingFraction ?? info.remaining_fraction ?? entry.remainingFraction ?? entry.remaining_fraction)
    if (!Number.isFinite(remaining)) continue
    const fraction = Math.max(0, Math.min(1, remaining))
    const resetsAt = normalizeResetTimestamp(info.resetTime ?? info.reset_time ?? entry.resetTime ?? entry.reset_time)
    windows.push({
      id: String(modelId).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model',
      kindKey: modelId,
      percent: Math.round((1 - fraction) * 100),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    })
  }
  return windows.sort((a, b) => b.percent - a.percent)
}

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

function buildCliproxyAccountPlan(entry) {
  const provider = String(entry?.provider ?? entry?.type ?? '').toLowerCase()
  if (!CLIPROXY_SUPPORTED_ACCOUNT_KINDS.has(provider)) return null
  const baseHeaders = { Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json' }
  if (provider === 'codex') {
    return { provider, calls: [{ method: 'GET', url: CLIPROXY_CODEX_USAGE_URL, header: baseHeaders, data: '' }] }
  }
  if (provider === 'antigravity') {
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

function parseCliproxyUpstream(provider, payload) {
  if (provider === 'codex') return normalizeCodexRateLimit(payload?.rate_limit)
  if (provider === 'antigravity') {
    if (Array.isArray(payload?.groups)) return normalizeAntigravityQuotaSummary(payload.groups)
    if (Array.isArray(payload?.buckets)) return normalizeGeminiBuckets(payload.buckets)
    const models = payload?.models
    return models !== null && typeof models === 'object' ? normalizeAntigravityModels(models) : []
  }
  return normalizeGeminiBuckets(payload?.buckets)
}

// 管理面 403 的三种语义（上游 `internal/api/handlers/management/handler.go` 原文）：
//   · `IP banned due to too many failed attempts. Try again in 29m10s` —— fail2ban 封禁（实测 2026-10-10）
//   · `remote management disabled` / `remote management key not set` —— 管理面没开或没配密钥
// 三者与「密钥填错」（401 `invalid management key`）完全不同，必须分开归类，否则用户对着一句
// 状态码猜：填错要给重填入口，封禁/未开启给重填入口是误导。
const CLIPROXY_BANNED_DETAIL_RE = /IP banned due to too many failed attempts/i
const CLIPROXY_MGMT_OFF_DETAIL_RE = /remote management (?:disabled|key not set)/i

/** CPA 管理面失败归类：401/403 = 管理密钥被拒（与其余 11 个 kind 同款，行回 unconfigured 就地重填）；
 *  封禁 → mgmt-banned（专属码，给等待/换出口 IP 的指引）；远程管理未开启 → mgmt-disabled。 */
function cliproxyManagementFailure(error) {
  const detail = sanitizeQuotaErrorDetail(error?.detail)
  if (detail !== undefined && CLIPROXY_BANNED_DETAIL_RE.test(detail)) {
    const banned = new Error('mgmt-banned')
    banned.detail = detail
    return banned
  }
  if (detail !== undefined && CLIPROXY_MGMT_OFF_DETAIL_RE.test(detail)) {
    const disabled = new Error('mgmt-disabled')
    disabled.detail = detail
    return disabled
  }
  const message = typeof error?.message === 'string' ? error.message : ''
  if (message === 'http-status:401' || message === 'http-status:403') {
    const rejected = new Error('credential-rejected')
    if (detail !== undefined) rejected.detail = detail
    return rejected
  }
  return error
}

async function fetchCliproxyUsage({ profile, config, credential, signal, requestJson }) {
  if (typeof requestJson !== 'function') throw new Error('transport-unavailable')
  const pinned = Array.isArray(config?.allowedHosts?.[profile.name]) ? config.allowedHosts[profile.name] : []
  const origin = safeCliproxyOrigin(profile.baseURL, pinned)
  if (origin === undefined) throw new Error('host-not-pinned')
  let filesPayload
  try {
    filesPayload = await requestJson(`${origin}/v0/management/auth-files`, { authorization: credential, signal })
  } catch (error) {
    // secret-key 为空时管理路由整体不注册 → 404（既有口径，先于其余归类）。
    if (error?.message === 'http-status:404') throw new Error('mgmt-disabled')
    throw cliproxyManagementFailure(error)
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
    const fallbackWindows = plan.provider === 'codex' ? parseCodexSignals(entry.quota) : []
    accounts.push({ authIndex: entry.auth_index, provider: plan.provider, label, slug, calls: plan.calls, fallbackWindows })
    if (accounts.length >= MAX_QUOTA_CPA_ACCOUNTS) break
  }
  if (accounts.length === 0) return []

  const accountResults = new Map()
  const failures = []
  let callBudget = MAX_QUOTA_CPA_CALLS
  // 失败条目携带「哪个账号 + 具体原因」：CPA 一行多账号，只回一个家族码用户无从下手。
  const pushFailure = (accountIndex, code, extra) => {
    const account = accounts[accountIndex]
    const label = typeof account?.label === 'string' && account.label !== '' ? account.label : undefined
    failures.push({ index: accountIndex, code, ...(label !== undefined ? { account: label } : {}), ...extra })
  }
  const runAccount = async (account, accountIndex) => {
    for (const call of account.calls) {
      if (callBudget <= 0 || signal?.aborted === true) return
      callBudget -= 1
      let envelope
      try {
        envelope = await requestJson(`${origin}/v0/management/api-call`, {
          method: 'POST',
          authorization: credential,
          signal,
          body: JSON.stringify({ auth_index: account.authIndex, method: call.method, url: call.url, header: call.header, data: call.data }),
        })
      } catch (error) {
        // 管理面自身失败（密钥被拒 / 封禁 / 管理面未开）：与账号级上游失败（HTTP 200 信封里的
        // status_code）严格分开。密钥在 api-call 途中失效或撞上封禁时，整行必须给出可行动指引，
        // 而不是一个 upstream-status 家族码。
        const failure = cliproxyManagementFailure(error)
        const detail = sanitizeQuotaErrorDetail(failure?.detail)
        pushFailure(accountIndex, quotaErrorCode(failure), detail !== undefined ? { detail } : {})
        const fallback = cliproxFallbackWindows(account)
        if (fallback.length > 0) {
          accountResults.set(accountIndex, fallback)
        }
        return
      }
      const { statusCode, payload } = unwrapCliproxyApiCallEnvelope(envelope)
      const parsed = statusCode === 200 && payload !== null ? parseCliproxyUpstream(account.provider, payload) : []
      if (parsed.length > 0) {
        accountResults.set(accountIndex, parsed)
        return
      }
      // 官方额度接口的错误原话（payload 里的 message/error.message 等）随失败条目带上，
      // 200 但形状不认识时同样透出，别让用户对着一个状态码猜。
      const upstreamDetail = quotaErrorDetailFromText(payload)
      pushFailure(accountIndex, statusCode === 200 ? 'bad-payload:shape' : `upstream-status:${statusCode}`,
        upstreamDetail !== undefined ? { detail: upstreamDetail } : {})
      if (account.provider !== 'antigravity') {
        const fallback = cliproxFallbackWindows(account)
        if (fallback.length > 0) {
          accountResults.set(accountIndex, fallback)
        }
        return
      }
    }
    const fallback = cliproxFallbackWindows(account)
    if (fallback.length > 0) {
      accountResults.set(accountIndex, fallback)
    } else {
      accountResults.set(accountIndex, [])
    }
  }
  const queue = accounts.map((account, index) => ({ account, index }))
  await Promise.all(Array.from({ length: Math.min(QUOTA_CPA_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0 && signal?.aborted !== true) {
      const item = queue.shift()
      await runAccount(item.account, item.index)
    }
  }))
  if (signal?.aborted === true) throw new Error('cancelled')

  const windows = []
  const seenWindowIds = new Set()
  for (const [accountIndex, account] of accounts.entries()) {
    for (const window of accountResults.get(accountIndex) ?? []) {
      if (windows.length >= MAX_QUOTA_CPA_WINDOWS) break
      let windowId = `${account.slug}-${window.id}`
      while (seenWindowIds.has(windowId)) windowId += '~'
      seenWindowIds.add(windowId)
      windows.push({
        id: windowId,
        kindKey: window.kindKey ?? window.id,
        ...(account.label !== '' ? { label: account.label } : {}),
        percent: window.percent,
        ...(window.resetsAt !== undefined ? { resetsAt: window.resetsAt } : {}),
        ...(window.stale === true ? { stale: true } : {}),
      })
    }
  }
  if (windows.length === 0 && failures.length > 0) {
    failures.sort((left, right) => left.index - right.index)
    const first = failures[0]
    const error = new Error(first.code)
    if (typeof first.detail === 'string' && first.detail !== '') error.detail = first.detail
    if (typeof first.account === 'string' && first.account !== '') error.account = first.account
    throw error
  }
  return windows
}

// Non-monetary points retain decimal strings instead of implying a currency or quota denominator.
function normalizePoePoints(payload) {
  const raw = payload?.current_point_balance
  const text = typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''
  if (text.length > 64 || !/^-?\d+(?:\.\d+)?$/.test(text)) return { windows: [] }
  return { windows: [{ id: 'points', kindKey: 'points', text: `${text} points`, unit: 'points' }] }
}

function normalizeVercelCredits(payload) {
  // The API declares USD decimal strings. Lifetime spend is not a quota denominator.
  const balance = payload?.balance
  if (typeof balance !== 'string' || balance.length > 64 || !/^\d+(?:\.\d+)?$/.test(balance)
    || !Number.isFinite(Number(balance)) || Number(balance) > Number.MAX_SAFE_INTEGER) return { windows: [] }
  return { windows: [{ id: 'balance', kindKey: 'balance', text: `$${balance}`, unit: 'usd' }] }
}

function normalizeClinePassUsage(payload) {
  if (payload?.success !== true || !Array.isArray(payload?.data?.limits)) return { windows: [] }
  const windows = []
  for (const [type, id] of [['five_hour', 'five-hour'], ['weekly', 'weekly'], ['monthly', 'monthly']]) {
    const matches = payload.data.limits.filter((entry) => entry?.type === type)
    if (matches.length > 1) return { windows: [] }
    const entry = matches[0]
    if (typeof entry?.percentUsed !== 'number' || !Number.isFinite(entry.percentUsed) || entry.percentUsed < 0) continue
    const resetsAt = typeof entry.resetsAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(entry.resetsAt)
      ? normalizeResetTimestamp(entry.resetsAt) : undefined
    windows.push({ id, percent: Math.min(100, Math.round(entry.percentUsed)), ...(resetsAt !== undefined ? { resetsAt } : {}) })
  }
  return { windows }
}

// ─── WorkBuddy2API 面板（workbuddy）用量 API ───────────────────────────────
// 查询面是网关自己的**面板用量 API**（不是 OpenAI 标准 /usage，/status 是账号池状态也不查）：
//   GET <渠道 baseURL 同源>/panel/api/usage?hours=24
//   Authorization: Bearer <网关 API Key>
// 返回 totals（请求/错误/输入输出总 Token/积分/缓存/平均延迟）+ by_realm + by_account + by_model
// + series（小时桶）。`hours` 同时收窄全部汇总（2026-10-18 真 key 实测：hours=1 时 totals、
// by_realm、by_account、by_model 同步变成 1 小时口径），缺省即 24h，这里显式钉住。
//
// **本渠道只能手动适配**：渠道 baseURL 是中转地址，主机名不构成服务身份（同一个中转域名可以
// 代理任何上游），自动识别会把「恰好指向该主机的任意渠道」错误认领——故 Adapter 不声明
// hosts/routeIds，用户在额度页「手动适配」里显式选择本类型。端点取所选渠道 baseURL 的
// **同源**（中转网关与面板 API 同域：推理是 `…/v1`，面板在根路径 `/panel/api/usage`），
// 换中转域名无需改代码；baseURL 为空/非法时如实报错，绝不回退到写死的主机。
//
// 面板用量只回答「用了多少」，没有剩余额度/套餐窗口；本卡片的百分比只来自区域油表（分母是
// 每日模型量），其余行按文本窗口下发（宿主只出数字与 K/M/B、s、% 这类语言中立单位）。
// 总量统计（请求/错误/输入输出 Token/积分/延迟/缓存命中率）不上卡：面板网页就看得到，卡片
// 顶部改为**限流台账**——`GET <同源>/panel/api/overview` 的
// `accounts[].rate_limited_models[]`（模型级 6004；`reset_at` 是上游原始重置墙钟，`until` 是
// 网关自己的路由解锁时刻）与账号级 `cooling`/`until`/`reason`。限流台账是附加信息：拉不到
// （旧面板没有该端点/权限不足）就不出限流行，绝不影响用量与油表。
// 时间窗：面板「用量」默认档是 72h（`TRANGE_DEFAULT = '72'`），但用户实测 72h 与面板
// 账号表仍有出入（面板侧可能另有口径），**明确要求改回 24 小时**。窗口是单一常量，
// 改档只动这里；服务端对流式窗口按整点对齐（24h 覆盖「当前整点−23h」到此刻）。
const WORKBUDDY_USAGE_PATH = '/panel/api/usage?hours=24'
const WORKBUDDY_OVERVIEW_PATH = '/panel/api/overview'
const MAX_WORKBUDDY_REALMS = 4
const MAX_WORKBUDDY_ACCOUNTS = 6
const MAX_WORKBUDDY_LIMIT_REALMS = 4
const MAX_WORKBUDDY_LIMIT_MODELS = 2
const MAX_WORKBUDDY_COOLING_ACCOUNTS = 2
const WORKBUDDY_USAGE_WINDOW_LABEL = '24h'
// 两个区的**每日模型量**上限（CodeBuddy 账号口径，用户提供）：cn 200M / global 100M。
// 这两个数是画油表唯一需要的分母——面板 API 本身只回用量、不回上限。
// **可在额度页的「配置」区按 provider 覆盖**（写进 `$DSH_HOME/dsh-service-quota.json` 的
// `realmCaps` 区块）；这里是未配置时的默认值。未登记上限的区只出文字行、不画进度（不编分母）。
const WORKBUDDY_DEFAULT_REALM_CAPS = Object.freeze({ cn: 200000000, global: 100000000 })
const MAX_QUOTA_REALM_CAPS = 8

/** 非负有限数；其它（null/布尔/空串/负数/NaN）一律 undefined，不猜 0。
 * 注意 Number(null)/Number('')/Number(false) 都是 0——必须先按类型拒掉，否则「缺失」
 * 会被渲染成「0 请求 / 0 Token」的假数据。 */
function workbuddyNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : undefined
  }
  return undefined
}

/** 与客户端 formatCompactCount 同一套 K/M/B 档位（语言中立单位，宿主可安全拼进文本）。 */
function workbuddyCompactCount(value) {
  if (value >= 1e9) return `${Math.round(value / 1e8) / 10}B`
  if (value >= 1e6) return `${Math.round(value / 1e5) / 10}M`
  if (value >= 1e3) return `${Math.round(value / 1e2) / 10}K`
  return String(Math.round(value))
}

/** 积分等小数量：两位小数（与面板同口径），不引入本地化千分位。 */
function workbuddyDecimalText(value) {
  return (Math.round(value * 100) / 100).toFixed(2)
}

/** 面板时间（`reset_at`/`until`）归一成 ISO：只有可解析的字符串才收，其余 undefined。
 * 归一化阶段**不按「现在」过滤**（宿主时钟/浏览器时钟差不该让台账凭空消失），
 * 倒计时是否显示由客户端按自己的时钟判断。 */
function workbuddyIsoTime(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

/** 账号/区域标签是纯数据：去控制字符、压空白、限长；空值返回 undefined（不造占位文案）。 */
function workbuddyLabel(value, maxLength) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned === '' ? undefined : cleaned.slice(0, maxLength)
}

/** 汇总行的「请求 / Token / 积分」三段：缺哪段就少哪段，全缺返回空数组（调用方跳过整行）。 */
function workbuddyUsageParts(row) {
  const parts = []
  const requests = workbuddyNumber(row?.requests)
  if (requests !== undefined) parts.push({ kindKey: 'requests', text: String(Math.round(requests)) })
  const tokens = workbuddyNumber(row?.total_tokens)
  if (tokens !== undefined) parts.push({ kindKey: 'tokens', text: workbuddyCompactCount(tokens) })
  const credits = workbuddyNumber(row?.credits)
  if (credits !== undefined) parts.push({ kindKey: 'credits', text: workbuddyDecimalText(credits) })
  return parts
}

/** 面板余额台账（`/panel/api/overview` 的 `accounts[].credits` / `credits_total`）：
 *  key = 账号 uid，与用量 `by_account[].key` 同值（2026-10-19 真机核对）。返回
 *  `Map<uid, {credits, total}>`；没有余额字段的账号不进表——宁可回落「本窗口消耗积分」，
 *  也不把未知余额渲染成 0。 */
function workbuddyCreditBalances(limits) {
  const balances = new Map()
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits) || !Array.isArray(limits.accounts)) return balances
  for (const account of limits.accounts) {
    if (account === null || typeof account !== 'object' || Array.isArray(account)) continue
    const uid = workbuddyLabel(account.uid, 64)
    const credits = workbuddyNumber(account.credits)
    if (uid === undefined || credits === undefined) continue
    balances.set(uid, { credits, total: workbuddyNumber(account.credits_total) })
  }
  return balances
}

/** 剩余积分文本：面板积分是整数；有总额度时给「剩余 / 总额」，否则只给剩余。 */
function workbuddyCreditBalanceText(balance) {
  const credits = String(Math.round(balance.credits))
  return balance.total !== undefined && balance.total > 0 ? `${credits} / ${String(Math.round(balance.total))}` : credits
}

/** 限流行：把面板限流台账（`/panel/api/overview`）转成文字窗口。
 *  - 模型级（上游 6004）：按域一行，段 = 模型 + 上游重置时刻（`reset_at`；缺失退 `until`）；
 *  - 账号级冷却（429/5xx 等）：每号一行（≤2），段 = 原因 + 恢复时刻；
 *  - 台账可用但当前无锁 → 一行「—」明确「现在是通的」；台账不可用（null）→ 不出行。
 * 时间一律下发 ISO（part 的 `iso` 字段），由客户端按浏览器时区格式化——宿主时区可能是
 * UTC，直接拼「HH:mm」会让用户看到错的时间。 */
function workbuddyLimitWindows(limits, realmOrder) {
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits) || !Array.isArray(limits.accounts)) return []
  const accounts = limits.accounts
  const byRealm = new Map()
  const cooling = []
  for (const account of accounts) {
    if (account === null || typeof account !== 'object' || Array.isArray(account)) continue
    const realm = workbuddyLabel(account.realm, 32)
    const listed = Array.isArray(account.rate_limited_models) ? account.rate_limited_models : []
    for (const entry of listed) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      // 只收「配额限流」：11102 model_unavailable 是模型不存在/不可用，不是额度，重试时间也不该
      // 被读成「配额重置」。
      if (typeof entry.kind === 'string' && entry.kind !== '' && entry.kind !== 'rate_limit') continue
      const model = workbuddyLabel(entry.model, 64)
      if (model === undefined) continue
      const at = workbuddyIsoTime(entry.reset_at) ?? workbuddyIsoTime(entry.until)
      const key = realm ?? ''
      if (!byRealm.has(key)) byRealm.set(key, new Map())
      const bucket = byRealm.get(key)
      const previous = bucket.get(model)
      // 同一模型可能挂在多个账号上：取最早的重置时刻（先恢复的那个）。
      if (previous === undefined || (at !== undefined && (previous === undefined || Date.parse(at) < Date.parse(previous)))) bucket.set(model, at)
    }
    if (account.cooling === true) {
      const parts = []
      const reason = workbuddyLabel(account.reason, 48)
      if (reason !== undefined) parts.push({ kindKey: 'reason', text: reason })
      const until = workbuddyIsoTime(account.until)
      if (until !== undefined) parts.push({ kindKey: 'reset-at', iso: until })
      if (parts.length === 0) continue
      const label = workbuddyLabel(account.nickname, 48) ?? realm
      cooling.push({ ...(label !== undefined ? { label } : {}), parts, ...(until !== undefined ? { resetsAt: until } : {}) })
    }
  }
  const windows = []
  const rank = (key) => {
    const index = realmOrder.indexOf(key)
    return index === -1 ? realmOrder.length : index
  }
  const keys = [...byRealm.keys()].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_WORKBUDDY_LIMIT_REALMS)
  for (const key of keys) {
    const parts = []
    let shown = 0
    let hidden = 0
    let earliest
    for (const [model, at] of byRealm.get(key)) {
      if (shown >= MAX_WORKBUDDY_LIMIT_MODELS) { hidden += 1; continue }
      shown += 1
      parts.push({ kindKey: '', text: model })
      if (at !== undefined) {
        parts.push({ kindKey: 'reset-at', iso: at })
        if (earliest === undefined || Date.parse(at) < Date.parse(earliest)) earliest = at
      }
    }
    if (hidden > 0) parts.push({ kindKey: '', text: `+${hidden}` })
    windows.push({
      id: key === '' ? `limit-${windows.length}` : `limit-${key}`,
      kindKey: 'limit-models',
      ...(key === '' ? {} : { label: key }),
      parts,
      ...(earliest !== undefined ? { resetsAt: earliest } : {}),
    })
  }
  for (const entry of cooling.slice(0, MAX_WORKBUDDY_COOLING_ACCOUNTS)) {
    windows.push({ id: `cooling-${windows.length}`, kindKey: 'account-cooling', ...entry })
  }
  if (windows.length === 0) windows.push({ id: 'limit', kindKey: 'rate-limits', text: '—' })
  return windows
}

function normalizeWorkbuddyUsage(payload, realmCaps, limits) {
  const caps = realmCaps !== null && typeof realmCaps === 'object' && !Array.isArray(realmCaps) ? realmCaps : WORKBUDDY_DEFAULT_REALM_CAPS
  const windows = []
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { windows }
  const totals = payload.totals
  const hasTotals = totals !== null && typeof totals === 'object' && !Array.isArray(totals)
  const realms = (Array.isArray(payload.by_realm) ? payload.by_realm : [])
    .filter((realm) => realm !== null && typeof realm === 'object' && !Array.isArray(realm))
    .slice(0, MAX_WORKBUDDY_REALMS)
  const accounts = (Array.isArray(payload.by_account) ? payload.by_account : [])
    .filter((account) => account !== null && typeof account === 'object' && !Array.isArray(account))
    .sort((a, b) => (workbuddyNumber(b.total_tokens) ?? 0) - (workbuddyNumber(a.total_tokens) ?? 0))
    .slice(0, MAX_WORKBUDDY_ACCOUNTS)
  // 面板返回既没有 totals 也没有任何汇总 → 形状不认识（fetcher 转 bad-payload:shape，不谎报成功）。
  if (!hasTotals && realms.length === 0 && accounts.length === 0) return { windows }
  // 统计口径行：下面区域油表与账号行都是这个滚动窗口内的数字。
  windows.push({ id: 'usage-window', kindKey: 'usage-window', text: WORKBUDDY_USAGE_WINDOW_LABEL })
  // 限流台账（用户要求：卡片顶部只展示限流相关信息，总量统计不再上卡）。
  const realmOrder = realms.map((realm) => workbuddyLabel(realm.key, 32)).filter((key) => key !== undefined)
  windows.push(...workbuddyLimitWindows(limits, realmOrder))

  // 区域行画成**百分比窗口**（油表/进度条）：分母 = 该区每日模型量上限。这是本渠道唯一
  // 有真实分母的量——账号行没有上限，只能出文字行（不编分母）。
  // percent 截到 100，`used`/`limit` 原值下发，客户端显示「100% · 200.7M / 200M」
  // （超上限时仍看得见真实用量，不是假的刚好 100%）。
  for (const realm of realms) {
    const key = workbuddyLabel(realm.key, 32)
    if (key === undefined) continue
    const cap = Object.prototype.hasOwnProperty.call(caps, key) ? Number(caps[key]) : undefined
    const tokens = workbuddyNumber(realm.total_tokens)
    if (cap === undefined || tokens === undefined || cap <= 0) {
      // 没上限的区退回文字行（请求 / Token / 积分），不画进度。
      const parts = workbuddyUsageParts(realm)
      if (parts.length > 0) windows.push({ id: `realm-${key}`, kindKey: 'realm-usage', label: key, parts })
      continue
    }
    windows.push({
      id: `realm-${key}`,
      kindKey: 'realm-daily-tokens',
      label: key,
      percent: Math.min(100, Math.round((tokens / cap) * 100)),
      used: tokens,
      limit: cap,
    })
  }

  const balances = workbuddyCreditBalances(limits)
  accounts.forEach((account, index) => {
    const parts = workbuddyUsageParts(account)
    if (parts.length === 0) return
    // 剩余积分优先用面板余额台账（`credits` 是余额，用量行的 `credits` 是本窗口消耗）：
    // 同一段里替换掉「消耗」，否则一行放不下两个积分口径。台账缺失（旧面板/无权限）就
    // 保留窗口消耗，与改版前一致。
    const uid = workbuddyLabel(account.key, 64)
    const balance = uid === undefined ? undefined : balances.get(uid)
    if (balance !== undefined) {
      const part = { kindKey: 'credit-balance', text: workbuddyCreditBalanceText(balance) }
      const at = parts.findIndex((entry) => entry.kindKey === 'credits')
      if (at === -1) parts.push(part)
      else parts[at] = part
    }
    // 标签优先级：账号昵称/邮箱（数据）→ 区域码 → 截断的账号键；全缺就不带标签。
    const label = workbuddyLabel(account.extra, 128) ?? workbuddyLabel(account.realm, 32) ?? workbuddyLabel(account.key, 32)
    windows.push({ id: `account-${index}`, kindKey: 'account-usage', ...(label !== undefined ? { label } : {}), parts })
  })
  return { windows }
}

/**
 * 面板端点 = 所选渠道 baseURL 的同源 + 固定路径（中转网关与面板 API 同域）。
 * 只接受 HTTPS、无 userinfo、默认端口；空/非法 baseURL 如实报错，不猜、不回退写死主机。
 */
function workbuddyPanelUrl(profile) {
  const declared = String(profile?.baseURL ?? '').trim()
  if (declared === '') return { error: 'no-base-url' }
  let parsed
  try { parsed = new URL(declared) } catch (_) { return { error: 'unsafe-provider-endpoint' } }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return { error: 'unsafe-provider-endpoint' }
  if (parsed.port !== '' && parsed.port !== '443') return { error: 'unsafe-provider-endpoint' }
  return { url: `${parsed.origin}${WORKBUDDY_USAGE_PATH}` }
}

/**
 * 单个 provider 的 realmCaps 归一：区键 `[A-Za-z0-9_-]{1,32}`、值正整数 tokens ≤1e12，
 * 至多 `maxRealms` 条。宿主配置解析与 RPC 写入共用这一份，避免两边校验漂移。
 * @returns 归一后的 `{realm: tokens}`；无有效条目时返回 `{}`。
 */
function sanitizeRealmCaps(raw, maxRealms = MAX_QUOTA_REALM_CAPS) {
  const out = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out
  let count = 0
  for (const [realm, value] of Object.entries(raw)) {
    if (count >= maxRealms) break
    if (typeof realm !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(realm)) continue
    const numeric = Number(value)
    if (!Number.isFinite(numeric) || numeric < 1 || numeric > 1e12) continue
    out[realm] = Math.round(numeric)
    count += 1
  }
  return out
}

/** 配置覆盖合并到默认上限：只接受正整数，其它条目忽略（坏配置不得让油表变成乱码）。 */
function mergeWorkbuddyRealmCaps(providerCaps) {
  return { ...WORKBUDDY_DEFAULT_REALM_CAPS, ...sanitizeRealmCaps(providerCaps) }
}

/**
 * 有效上限（默认 + provider 覆盖），供额度快照下发给客户端渲染输入框。
 * 没有默认值的 Adapter（不画油表的渠道）返回 undefined。
 */
function quotaAdapterRealmCaps(adapter, providerCaps) {
  const metadata = ADAPTER_METADATA.get(adapter)
  if (metadata === undefined || metadata.realmCaps === undefined) return undefined
  return mergeWorkbuddyRealmCaps(providerCaps)
}

async function fetchWorkbuddyUsage({ profile, config, credential, signal, requestJson }) {
  if (typeof requestJson !== 'function') throw new Error('transport-unavailable')
  const endpoint = workbuddyPanelUrl(profile)
  if (endpoint.error !== undefined) throw new Error(endpoint.error)
  const raw = String(credential ?? '').trim()
  if (raw === '') throw new Error('credential-missing')
  // 发现链已按 policy.format 加了 Bearer；粘贴带回的 `Authorization: Bearer x` 整头也容错。
  const token = raw.replace(/^authorization:\s*/i, '').replace(/^bearer\s+/i, '')
  if (token === '') throw new Error('credential-missing')
  let payload
  try {
    payload = await requestJson(endpoint.url, { authorization: `Bearer ${token}`, signal })
  } catch (error) {
    if (error?.message === 'http-status:401' || error?.message === 'http-status:403') {
      const rejected = new Error('credential-rejected')
      if (typeof error?.detail === 'string' && error.detail !== '') rejected.detail = error.detail
      throw rejected
    }
    throw error
  }
  // 限流台账是**附加信息**：同源的 /panel/api/overview 拿账号池状态（含 6004 的 reset_at）。
  // 旧面板没有该端点、或该 key 无权读面板面 → 静默降级（limits = null，卡片不出限流行），
  // 绝不让附加查询的失败把「用量」本身打成错误。
  let limits = null
  try {
    const origin = new URL(endpoint.url).origin
    const overview = await requestJson(`${origin}${WORKBUDDY_OVERVIEW_PATH}`, { authorization: `Bearer ${token}`, signal })
    if (overview !== null && typeof overview === 'object' && Array.isArray(overview.accounts)) limits = overview
  } catch (error) {
    if (signal?.aborted === true) throw error
    limits = null
  }
  const providerCaps = config?.realmCaps !== null && typeof config?.realmCaps === 'object'
    ? config.realmCaps[String(profile?.name ?? '')]
    : undefined
  const windows = normalizeWorkbuddyUsage(payload, mergeWorkbuddyRealmCaps(providerCaps), limits).windows
  if (windows.length === 0) throw new Error('bad-payload:shape')
  return windows
}

function createQuotaAdapterCatalog() {
  return Object.freeze([
    createEndpointAdapter({
      kind: 'opencode-go',
      normalize: normalizeOpencodeUsage,
      keyHints: ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
      hosts: ['opencode.ai'],
      // DSH 内置渠道（pi-ai 注册表渠道 opencode-go）的 profile 常常只有 apiKeyEnv：端点派生走这里的默认。
      // 注册表数据里 opencode-go 按协议分两组 baseUrl（anthropic-messages `…/zen/go`、
      // openai-completions/responses `…/zen/go/v1`），且 provider 级无 baseUrl——用量端点实测只在
      // `…/zen/go/v1/usage`（真 key 200；`…/zen/go/usage` 404），故不能取「第一条」。
      routeIds: ['opencode-go'],
      defaultBaseURL: 'https://opencode.ai/zen/go/v1',
      usageUrl: 'https://opencode.ai/',
      // 显式 baseURL 也踩同一个坑：注册表 anthropic-messages 组给的是 `…/zen/go`（不带 /v1），
      // 通用 `/usage` 拼接会打到 `…/zen/go/usage` → 上游 404 HTML 网页（实测 404 text/html；
      // 同域 `…/zen/go/v1/usage` 无 key 401 JSON、带 key 200）。只归一 zen 网关两种形状，
      // 其余自定义/反代路径返回 undefined 交回通用 `/usage` 拼接（不猜 /v1）。
      usageBasePathname(base) {
        const pathname = base.pathname.replace(/\/+$/, '')
        if (pathname.endsWith('/zen/go')) base.pathname = `${pathname}/v1/usage`
        else if (pathname.endsWith('/zen/go/v1')) base.pathname = `${pathname}/usage`
        else return undefined
        return base
      },
    }),
    createEndpointAdapter({
      kind: 'zai-coding-cn',
      normalize: normalizeZaiCodingUsage,
      endpoints: [
        'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
        'https://api.z.ai/api/monitor/usage/quota/limit',
      ],
      keyHints: ['ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY', 'BIGMODEL_API_KEY'],
      hosts: ['open.bigmodel.cn', 'bigmodel.cn'],
      routeIds: ['zai-coding-cn'],
      usageUrl: 'https://open.bigmodel.cn/coding-plan/personal/usage',
    }),
    createEndpointAdapter({
      kind: 'openrouter',
      normalize: normalizeOpenRouterCredits,
      endpoints: ['https://openrouter.ai/api/v1/credits'],
      keyHints: ['OPENROUTER_API_KEY'],
      hosts: ['openrouter.ai'],
      routeIds: ['openrouter'],
    }),
    createEndpointAdapter({
      kind: 'kimi',
      normalize: normalizeKimiBalance,
      endpoints: ['https://api.moonshot.cn/v1/users/me/balance'],
      keyHints: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
      hosts: ['moonshot.cn', 'kimi.com'],
    }),
    createEndpointAdapter({
      kind: 'siliconflow',
      normalize: normalizeSiliconFlowInfo,
      endpoints: ['https://api.siliconflow.cn/v1/user/info'],
      keyHints: ['SILICONFLOW_API_KEY'],
      hosts: ['siliconflow.cn'],
    }),
    createEndpointAdapter({
      kind: 'vercel-ai-gateway',
      normalize: normalizeVercelCredits,
      endpoints: ['https://ai-gateway.vercel.sh/v1/credits'],
      keyHints: ['AI_GATEWAY_API_KEY'],
      hosts: ['ai-gateway.vercel.sh'],
      routeIds: ['vercel-ai-gateway'],
    }),
    createEndpointAdapter({
      kind: 'poe',
      normalize: normalizePoePoints,
      endpoints: ['https://api.poe.com/usage/current_balance'],
      keyHints: ['POE_API_KEY'],
      hosts: ['api.poe.com'],
      routeIds: ['poe'],
    }),
    createEndpointAdapter({
      kind: 'clinepass',
      normalize: normalizeClinePassUsage,
      endpoints: ['https://api.cline.bot/api/v1/users/me/plan/usage-limits'],
      keyHints: ['CLINEPASS_API_KEY'],
      hosts: ['api.cline.bot'],
      routeIds: ['clinepass'],
    }),
    createEndpointAdapter({
      kind: 'deepseek',
      normalize: normalizeDeepseekBalance,
      endpoints: ['https://api.deepseek.com/user/balance'],
      keyHints: ['DEEPSEEK_API_KEY'],
      hosts: ['api.deepseek.com', 'deepseek.com'],
      runtimeChannels: ['deepseek-official'],
      // pi-ai 另有同名内置渠道 deepseek（DSH 自己的通道是 runtimeChannels 里的 deepseek-official）。
      routeIds: ['deepseek'],
      autoVisibility: 'credential-gated',
      usageUrl: 'https://platform.deepseek.com/usage',
    }),
    createComposedAdapter({
      kind: 'cliproxy',
      fetch: fetchCliproxyUsage,
      guard: cliproxyFetchGuard,
      keyHints: ['CPA_MANAGEMENT_KEY', 'CLIPROXY_MANAGEMENT_KEY'],
      includeProfileHint: false,
      entryKey: 'editManagement',
      configuration: 'pinned',
    }),
    createComposedAdapter({
      kind: 'xiaomi-token-plan-cn',
      fetch: fetchXiaomiTokenPlanUsage,
      keyHints: ['XIAOMI_MIMO_CONSOLE_COOKIE', 'MIMO_CONSOLE_COOKIE'],
      includeProfileHint: false,
      format: 'raw',
      entryKey: 'editCookie',
      hosts: ['token-plan-cn.xiaomimimo.com'],
      // pi-ai 内置渠道同名（xiaomi-token-plan-cn/-sgp/-ams）；只有本 kind 固定走控制台同源端点，
      // 故仅认领 -cn 渠道 id。
      routeIds: ['xiaomi-token-plan-cn'],
      usageUrl: 'https://platform.xiaomimimo.com/console/usage',
    }),
    createEndpointAdapter({
      kind: 'stepfun',
      normalize: normalizeStepfunBalance,
      endpoints: [
        'https://api.stepfun.com/v1/accounts',
        'https://api.stepfun.ai/v1/accounts',
      ],
      keyHints: ['STEPFUN_API_KEY'],
      hosts: ['api.stepfun.com', 'stepfun.com', 'api.stepfun.ai', 'stepfun.ai'],
      usageUrl: 'https://platform.stepfun.com/plan-usage',
    }),
    createComposedAdapter({
      kind: 'stepfun-step-plan',
      fetch: fetchStepFunStepPlanUsage,
      keyHints: ['STEPFUN_TOKEN', 'STEPFUN_OASIS_TOKEN'],
      includeProfileHint: false,
      format: 'raw',
      entryKey: 'editToken',
      usageUrl: 'https://platform.stepfun.com/plan-usage',
    }),
    createComposedAdapter({
      kind: 'command-goat',
      fetch: fetchCommandCodeQuota,
      keyHints: ['COMMAND_CODE_API_KEY', 'COMMANDCODE_API_KEY'],
      hosts: ['api.commandcode.ai', 'commandcode.ai'],
      // 查询面是固定账号面（与推理 baseURL 无关）：未声明端点的同名渠道按路由 id 认领。
      routeIds: ['command-goat'],
      usageUrl: 'https://commandcode.ai/settings/usage',
    }),
    createComposedAdapter({
      kind: 'workbuddy',
      fetch: fetchWorkbuddyUsage,
      keyHints: ['WORKBUDDY_API_KEY'],
      // 只走手动适配：baseURL 是中转地址，主机名不构成服务身份（见上方分节注释）。
      // 不声明 hosts/routeIds ⇒ recognize() 恒 false，绝不自动认领任何渠道。
      // 不设 usageUrl：中转域名随部署而变，静态外链会指错（面板就在所选渠道同源根路径）。
      // realmCaps：油表分母的默认值（额度页可按 provider 覆盖，写进 quota 配置的 realmCaps）。
      realmCaps: WORKBUDDY_DEFAULT_REALM_CAPS,
    }),
  ])
}

function findQuotaAdapter(adapters, kind) {
  return adapters.find((adapter) => adapter.kind === kind)
}

function recognizeQuotaAdapter(adapters, profile) {
  const hits = adapters.filter((adapter) => adapter.recognize(profile))
  return hits.length === 1 ? hits[0] : undefined
}

function quotaAdapterEndpoints(adapter, profile) {
  return adapter === undefined ? [] : adapterEndpoints(adapter, profile)
}

function prepareQuotaAdapterConfig(adapter, profile) {
  const metadata = ADAPTER_METADATA.get(adapter)
  if (metadata === undefined) return { ok: false, error: 'unknown-kind' }
  if (metadata.configuration === 'pinned') return pinnedHostFromProfile(profile)
  if (metadata.configuration === 'recognized' && !adapter.recognize(profile)) {
    return { ok: false, error: 'unsafe-provider-endpoint' }
  }
  return { ok: true }
}

function quotaAdapterUsageUrl(adapter) {
  return ADAPTER_METADATA.get(adapter)?.usageUrl
}

export {
  buildCliproxyAccountPlan,
  cliproxyFetchGuard,
  cliproxyPinHostFromBaseURL,
  cliproxyProjectFor,
  createQuotaAdapterCatalog,
  fetchCliproxyUsage,
  fetchCommandCodeQuota,
  fetchStepFunStepPlanUsage,
  fetchWorkbuddyUsage,
  MAX_QUOTA_REALM_CAPS,
  WORKBUDDY_DEFAULT_REALM_CAPS,
  workbuddyPanelUrl,
  fetchXiaomiTokenPlanUsage,
  findQuotaAdapter,
  normalizeAntigravityModels,
  normalizeAntigravityQuotaSummary,
  normalizeCodexRateLimit,
  normalizeCommandCodeQuota,
  normalizeDeepseekBalance,
  normalizeGeminiBuckets,
  normalizeKimiBalance,
  normalizeOpencodeUsage,
  normalizeOpenRouterCredits,
  normalizeSiliconFlowInfo,
  normalizeStepfunBalance,
  normalizeStepFunStepPlanUsage,
  mergeWorkbuddyRealmCaps,
  normalizeWorkbuddyUsage,
  normalizeXiaomiTokenPlanUsage,
  normalizeZaiCodingUsage,
  prepareQuotaAdapterConfig,
  quotaAdapterEndpoints,
  quotaAdapterRealmCaps,
  sanitizeRealmCaps,
  quotaAdapterUsageUrl,
  quotaErrorCode,
  quotaErrorDetailFromText,
  quotaRedactCredentialText,
  quotaUpstreamErrorMessage,
  recognizeQuotaAdapter,
  safeCliproxyOrigin,
  sanitizeQuotaErrorDetail,
  stepfunWebIdFromToken,
  unwrapCliproxyApiCallEnvelope,
  unwrapXiaomiConsoleEnvelope,
}
