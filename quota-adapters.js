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
const MAX_QUOTA_CPA_WINDOWS = 32

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
    usageUrl: metadata.usageUrl,
  }))
  return adapter
}

function adapterRecognizesProfile(kind, hosts, runtimeChannels, profile) {
  if (profile?.runtimeKind === kind) return true
  if (typeof profile?.runtimeChannel === 'string' && runtimeChannels.includes(profile.runtimeChannel)) return true
  let parsed
  try { parsed = new URL(String(profile?.baseURL ?? '').trim()) } catch (_) { return false }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return false
  if (parsed.port !== '' && parsed.port !== '443') return false
  return hosts.some((host) => quotaHostnameMatches(parsed.hostname, host))
}

function adapterEndpoints(adapter, profile) {
  const metadata = ADAPTER_METADATA.get(adapter)
  if (metadata === undefined) return []
  if (metadata.endpoints.length > 0) return [...metadata.endpoints]
  const base = safeBaseUrl(profile?.baseURL, metadata.hosts)
  if (base === undefined) return []
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
      return adapterRecognizesProfile(options.kind, options.hosts ?? [], options.runtimeChannels ?? [], profile)
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
      for (const endpoint of candidates) {
        let payload
        try {
          payload = await context.fetchJson(endpoint, authorization, { signal: context.signal })
        } catch (error) {
          lastError = error
          if ((error?.message === 'http-status:401' || error?.message === 'http-status:403') && candidates.length > 1) continue
          throw error
        }
        const normalized = adapter.normalize(payload)
        const windows = payloadWindows(normalized)
        if (windows === undefined) {
          parseFailure ??= new Error('bad-payload:shape')
          lastError = parseFailure
          continue
        }
        if (windows.length === 0) {
          const error = new Error('bad-payload')
          const detail = payload !== null && typeof payload === 'object'
            && Number(payload.code) !== 0 && typeof payload.msg === 'string'
            ? (context.sanitizeErrorDetail ?? sanitizeQuotaErrorDetail)(payload.msg)
            : undefined
          if (detail !== undefined) error.detail = detail
          parseFailure ??= error
          lastError = parseFailure
          continue
        }
        return payload
      }
      throw parseFailure ?? lastError ?? new Error('bad-payload')
    },
    normalize: options.normalize,
  }, {
    configuration: options.endpoints === undefined ? 'recognized' : 'fixed',
    endpoints: options.endpoints,
    hosts: options.hosts,
    usageUrl: options.usageUrl,
  })
  return adapter
}

function createComposedAdapter(options) {
  return defineQuotaAdapter({
    kind: options.kind,
    recognize(profile) {
      return adapterRecognizesProfile(options.kind, options.hosts ?? [], options.runtimeChannels ?? [], profile)
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
    usageUrl: options.usageUrl,
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
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(used)) return { windows: [] }
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

const CLIPROXY_CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CLIPROXY_GEMINI_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'
const CLIPROXY_ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
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
    const models = payload?.models
    return models !== null && typeof models === 'object' ? normalizeAntigravityModels(models) : []
  }
  return normalizeGeminiBuckets(payload?.buckets)
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

  const accountResults = new Map()
  const failures = []
  let callBudget = MAX_QUOTA_CPA_CALLS
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
        failures.push({ index: accountIndex, code: quotaErrorCode(error) })
        return
      }
      const { statusCode, payload } = unwrapCliproxyApiCallEnvelope(envelope)
      const parsed = statusCode === 200 && payload !== null ? parseCliproxyUpstream(account.provider, payload) : []
      if (parsed.length > 0) {
        accountResults.set(accountIndex, parsed)
        return
      }
      failures.push({ index: accountIndex, code: statusCode === 200 ? 'bad-payload:shape' : `upstream-status:${statusCode}` })
      if (account.provider !== 'antigravity') return
    }
    accountResults.set(accountIndex, [])
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
      })
    }
  }
  if (windows.length === 0 && failures.length > 0) {
    failures.sort((left, right) => left.index - right.index)
    throw new Error(failures[0].code)
  }
  return windows
}

function createQuotaAdapterCatalog() {
  return Object.freeze([
    createEndpointAdapter({
      kind: 'opencode-go',
      normalize: normalizeOpencodeUsage,
      keyHints: ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'],
      hosts: ['opencode.ai'],
      usageUrl: 'https://opencode.ai/',
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
      usageUrl: 'https://open.bigmodel.cn/coding-plan/personal/usage',
    }),
    createEndpointAdapter({
      kind: 'openrouter',
      normalize: normalizeOpenRouterCredits,
      endpoints: ['https://openrouter.ai/api/v1/credits'],
      keyHints: ['OPENROUTER_API_KEY'],
      hosts: ['openrouter.ai'],
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
      kind: 'deepseek',
      normalize: normalizeDeepseekBalance,
      endpoints: ['https://api.deepseek.com/user/balance'],
      keyHints: ['DEEPSEEK_API_KEY'],
      hosts: ['api.deepseek.com', 'deepseek.com'],
      runtimeChannels: ['deepseek-official'],
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
  fetchStepFunStepPlanUsage,
  fetchXiaomiTokenPlanUsage,
  findQuotaAdapter,
  normalizeAntigravityModels,
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
  prepareQuotaAdapterConfig,
  quotaAdapterEndpoints,
  quotaAdapterUsageUrl,
  quotaErrorCode,
  recognizeQuotaAdapter,
  safeCliproxyOrigin,
  sanitizeQuotaErrorDetail,
  stepfunWebIdFromToken,
  unwrapCliproxyApiCallEnvelope,
  unwrapXiaomiConsoleEnvelope,
}
