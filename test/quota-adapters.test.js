import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createQuotaAdapterCatalog,
  fetchCommandCodeQuota,
  findQuotaAdapter,
  normalizeCommandCodeQuota,
  prepareQuotaAdapterConfig,
  quotaAdapterEndpoints,
  quotaAdapterUsageUrl,
  recognizeQuotaAdapter,
} from '../quota-adapters.js'

function createCatalog() {
  return createQuotaAdapterCatalog()
}

test('quota Adapter catalog exposes one exact five-method interface per unique kind', () => {
  const adapters = createCatalog()
  const expectedInterface = ['credentialPolicy', 'fetchUsage', 'kind', 'normalize', 'recognize']
  assert.equal(adapters.length, 11)
  assert.equal(new Set(adapters.map((adapter) => adapter.kind)).size, adapters.length)
  for (const adapter of adapters) {
    assert.deepEqual(Object.keys(adapter).sort(), expectedInterface)
    assert.equal(typeof adapter.kind, 'string')
    assert.equal(typeof adapter.recognize, 'function')
    assert.equal(typeof adapter.credentialPolicy, 'function')
    assert.equal(typeof adapter.fetchUsage, 'function')
    assert.equal(typeof adapter.normalize, 'function')
    assert.equal(Object.isFrozen(adapter), true)
  }
})

test('Adapter recognition owns host and runtime-channel facts and fails closed on ambiguity', () => {
  const adapters = createCatalog()
  assert.equal(recognizeQuotaAdapter(adapters, { baseURL: 'https://opencode.ai/zen/go/v1' })?.kind, 'opencode-go')
  assert.equal(recognizeQuotaAdapter(adapters, { baseURL: 'https://child.opencode.ai/v1' })?.kind, 'opencode-go')
  assert.equal(recognizeQuotaAdapter(adapters, { baseURL: 'https://opencode.ai.evil.example/v1' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { baseURL: 'http://opencode.ai/v1' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { baseURL: 'https://user@opencode.ai/v1' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { baseURL: 'https://opencode.ai:8443/v1' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { runtimeChannel: 'deepseek-official', baseURL: '' })?.kind, 'deepseek')

  const ambiguous = [...adapters, { ...findQuotaAdapter(adapters, 'opencode-go'), kind: 'ambiguous-copy' }]
  assert.equal(recognizeQuotaAdapter(ambiguous, { baseURL: 'https://opencode.ai/v1' }), undefined)
})

test('Adapter recognition claims its own undeclared built-in route ids and nothing else', () => {
  const adapters = createCatalog()
  // DSH 内置渠道（pi-ai 注册表渠道）经官方「模型」页启用时只写 apiKeyEnv：上游 baseUrl 只在注册表里，
  // settings 不写（llm-pi-ai schema 拒绝空串 baseURL，「没写」是唯一形态）→ 空 baseURL + 路由 id 命中即认领。
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'opencode-go', baseURL: '' })?.kind, 'opencode-go')
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'zai-coding-cn', baseURL: '' })?.kind, 'zai-coding-cn')
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'openrouter', baseURL: '' })?.kind, 'openrouter')
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'deepseek', baseURL: '' })?.kind, 'deepseek')
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'xiaomi-token-plan-cn', baseURL: '' })?.kind, 'xiaomi-token-plan-cn')
  // 名字即身份只在这三种情况下生效：无 name（quotaEndpointFor 那种纯 baseURL 查询）、名字不归本 Adapter、
  // 声明了端点却不在白名单——一律不认领，凭据不得改道。
  assert.equal(recognizeQuotaAdapter(adapters, { baseURL: '' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'opencode-no-base', baseURL: '' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'opencode-go', baseURL: 'https://relay.example/v1' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'opencode-go', baseURL: 'http://opencode.ai/zen/go/v1' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'zai', baseURL: '' }), undefined)
  // opencode（Zen）是与 opencode-go 不同的产品、不同的模型目录，绝不能被 Go 的 Adapter 认领。
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'opencode', baseURL: '' }), undefined)
})

test('Adapter credential policies own hint order, transport formatting, visibility, and entry copy', () => {
  const adapters = createCatalog()
  const opencode = findQuotaAdapter(adapters, 'opencode-go').credentialPolicy({ apiKeyEnv: 'OPENCODE_GO_API_KEY' })
  assert.deepEqual([...opencode.hints], ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'])
  assert.equal(opencode.format('key'), 'Bearer key')
  assert.equal(opencode.entryKey, 'edit')
  assert.equal(opencode.autoVisibility, 'always')

  const cliproxy = findQuotaAdapter(adapters, 'cliproxy').credentialPolicy({ apiKeyEnv: 'CPA_PROXY_KEY' })
  assert.deepEqual([...cliproxy.hints], ['CPA_MANAGEMENT_KEY', 'CLIPROXY_MANAGEMENT_KEY'])
  assert.equal(cliproxy.format('secret'), 'Bearer secret')
  assert.equal(cliproxy.entryKey, 'editManagement')

  const xiaomi = findQuotaAdapter(adapters, 'xiaomi-token-plan-cn').credentialPolicy({ apiKeyEnv: 'MIMO_TP_KEY' })
  assert.deepEqual([...xiaomi.hints], ['XIAOMI_MIMO_CONSOLE_COOKIE', 'MIMO_CONSOLE_COOKIE'])
  assert.equal(xiaomi.format('sid=1'), 'sid=1')
  assert.equal(xiaomi.entryKey, 'editCookie')

  const deepseek = findQuotaAdapter(adapters, 'deepseek').credentialPolicy({})
  assert.equal(deepseek.autoVisibility, 'credential-gated')
})

test('Adapter configuration owns dynamic endpoint checks, fixed planes, and pinned hosts', () => {
  const adapters = createCatalog()
  const opencode = findQuotaAdapter(adapters, 'opencode-go')
  assert.deepEqual(quotaAdapterEndpoints(opencode, { baseURL: 'https://opencode.ai/zen/go/v1/' }), ['https://opencode.ai/zen/go/v1/usage'])
  assert.deepEqual(prepareQuotaAdapterConfig(opencode, { baseURL: 'https://opencode.ai/zen/go/v1' }), { ok: true })
  assert.deepEqual(prepareQuotaAdapterConfig(opencode, { baseURL: 'https://evil.example/v1' }), { ok: false, error: 'unsafe-provider-endpoint' })

  const xiaomi = findQuotaAdapter(adapters, 'xiaomi-token-plan-cn')
  assert.deepEqual(prepareQuotaAdapterConfig(xiaomi, { baseURL: '' }), { ok: true })

  const cliproxy = findQuotaAdapter(adapters, 'cliproxy')
  assert.deepEqual(prepareQuotaAdapterConfig(cliproxy, { baseURL: '' }), { ok: false, error: 'no-base-url' })
  assert.deepEqual(prepareQuotaAdapterConfig(cliproxy, { baseURL: 'http://cli.example.org' }), { ok: false, error: 'unsafe-provider-endpoint' })
  assert.deepEqual(prepareQuotaAdapterConfig(cliproxy, { baseURL: 'https://cli.example.org/base' }), { ok: true, allowedHosts: ['cli.example.org'] })

  assert.equal(quotaAdapterUsageUrl(findQuotaAdapter(adapters, 'deepseek')), 'https://platform.deepseek.com/usage')
  assert.equal(quotaAdapterUsageUrl(findQuotaAdapter(adapters, 'openrouter')), undefined)
})

test('built-in route defaults derive the endpoint only for the Adapter that owns the route id', () => {
  const adapters = createCatalog()
  const opencode = findQuotaAdapter(adapters, 'opencode-go')
  // 注册表数据里 opencode-go 有两条 baseUrl（anthropic-messages `…/zen/go`、其余 `…/zen/go/v1`）、
  // provider 级无 baseUrl；用量端点实测只在带 /v1 的那条（真 key 200，`…/zen/go/usage` 404）。
  assert.deepEqual(quotaAdapterEndpoints(opencode, { name: 'opencode-go', baseURL: '' }), ['https://opencode.ai/zen/go/v1/usage'])
  assert.deepEqual(prepareQuotaAdapterConfig(opencode, { name: 'opencode-go', baseURL: '' }), { ok: true })
  // 默认端点是 Adapter 自带常量，仍过 https/主机白名单；不认领的路由拿不到它。
  assert.deepEqual(quotaAdapterEndpoints(opencode, { name: 'opencode-no-base', baseURL: '' }), [])
  assert.deepEqual(quotaAdapterEndpoints(opencode, { baseURL: '' }), [])
  assert.deepEqual(quotaAdapterEndpoints(opencode, { name: 'opencode-go', baseURL: 'https://relay.example/v1' }), [])
  assert.deepEqual(prepareQuotaAdapterConfig(opencode, { name: 'opencode-no-base', baseURL: '' }), { ok: false, error: 'unsafe-provider-endpoint' })
  // 显式 baseURL 的 anthropic-messages 组形状（`…/zen/go`，不带 /v1）：通用 /usage 拼接实测打到
  // 上游 404 HTML 网页（`…/zen/go/usage` → 404 text/html；同域 `…/zen/go/v1/usage` 无 key 401 JSON）。
  // 两种 zen 网关显式形状都归一到 /v1，且归一化后仍受主机白名单约束。
  assert.deepEqual(quotaAdapterEndpoints(opencode, { baseURL: 'https://opencode.ai/zen/go' }), ['https://opencode.ai/zen/go/v1/usage'])
  assert.deepEqual(quotaAdapterEndpoints(opencode, { baseURL: 'https://opencode.ai/zen/go/' }), ['https://opencode.ai/zen/go/v1/usage'])
  assert.deepEqual(quotaAdapterEndpoints(opencode, { baseURL: 'https://child.opencode.ai/zen/go' }), ['https://child.opencode.ai/zen/go/v1/usage'])
  // 边界：非 zen 网关的自定义路径不猜 /v1，保持通用 /usage 拼接。
  assert.deepEqual(quotaAdapterEndpoints(opencode, { baseURL: 'https://api.opencode.ai/custom' }), ['https://api.opencode.ai/custom/usage'])
  // 固定端点 kind 只需认领即可用（zai 的候选链与 baseURL 无关）。
  assert.deepEqual(quotaAdapterEndpoints(findQuotaAdapter(adapters, 'zai-coding-cn'), { name: 'zai-coding-cn', baseURL: '' }), [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
  ])
})

test('endpoint Adapter fetchUsage resolves credentials lazily and returns raw payload for normalize', async () => {
  const adapter = findQuotaAdapter(createCatalog(), 'opencode-go')
  let credentialCalls = 0
  const fetched = []
  const context = {
    profile: { baseURL: 'https://opencode.ai/zen/go/v1' },
    signal: undefined,
    sanitizeErrorDetail: (value) => value,
    credential: async () => { credentialCalls += 1; return 'Bearer k' },
    fetchJson: async (endpoint, authorization) => {
      fetched.push([endpoint, authorization])
      return { usage: { weekly: { percent: 14 } } }
    },
  }
  const payload = await adapter.fetchUsage(context)
  assert.deepEqual(payload, { usage: { weekly: { percent: 14 } } })
  assert.deepEqual(adapter.normalize(payload), { windows: [{ id: 'weekly', percent: 14 }] })
  assert.equal(credentialCalls, 1)
  assert.deepEqual(fetched, [['https://opencode.ai/zen/go/v1/usage', 'Bearer k']])

  credentialCalls = 0
  await assert.rejects(adapter.fetchUsage({ ...context, profile: { baseURL: '' } }), /no-base-url/)
  assert.equal(credentialCalls, 0, 'unsafe/missing endpoint stops before touching credentials')

  // 内置渠道形态（只写 apiKeyEnv、无 baseURL）：端点来自 Adapter 默认值，凭据照常解析。
  credentialCalls = 0
  fetched.length = 0
  const builtinPayload = await adapter.fetchUsage({ ...context, profile: { name: 'opencode-go', baseURL: '' } })
  assert.deepEqual(builtinPayload, { usage: { weekly: { percent: 14 } } })
  assert.equal(credentialCalls, 1)
  assert.deepEqual(fetched, [['https://opencode.ai/zen/go/v1/usage', 'Bearer k']])
})

// ─── Command Code（command-goat）账号额度 ────────────────────────────────────
// 真实形状来自 2026-09-17 真 key 实测（个人号 org=null）：
//   whoami       → {success:true, user:{...}, org:null}
//   credits      → {credits:{belowThreshold,creditThreshold,monthlyCredits,purchasedCredits,freeCredits},
//                   windowLimits:{limited,exceeded,fiveHour:{used,cap,exceeded,resetAt(ms)},weekly:{...}}}
//   subscriptions→ {success:true, data:{planId:"individual-goat",status,currentPeriodStart,currentPeriodEnd,...}}
//   usage/summary→ {totalCount,totalCost,totalTokens,periodBasis:"billing-period",...}

const COMMAND_CODE_FIXTURE = {
  credits: {
    credits: { belowThreshold: false, creditThreshold: 0, monthlyCredits: 69.836433772, purchasedCredits: 0, freeCredits: 0 },
    windowLimits: {
      limited: true,
      exceeded: null,
      fiveHour: { used: 0.163566228, cap: 14, exceeded: false, resetAt: 1789645175513 },
      weekly: { used: 0.163566228, cap: 35, exceeded: false, resetAt: 1790231975513 },
    },
  },
  subscription: {
    success: true,
    data: {
      id: 'sub_1', status: 'active', planId: 'individual-goat',
      currentPeriodStart: '2026-09-17T06:28:04.000Z', currentPeriodEnd: '2026-10-17T06:28:04.000Z',
    },
  },
  summary: { totalCount: 11, totalCost: 0.12465959800000001, totalTokens: 2219164, periodBasis: 'billing-period' },
}

test('Command Code quota normalizes credits, plan, period spend and usage windows', () => {
  assert.deepEqual(normalizeCommandCodeQuota(COMMAND_CODE_FIXTURE), { windows: [
    // 剩余 = 三源之和（与 Studio 用量页同口径）；金额文本窗不带币种符号外的文案。
    { id: 'balance', kindKey: 'balance', text: '$69.84' },
    { id: 'period-spend', kindKey: 'period-spend', text: '$0.12' },
    // 套餐 id 是人类可读标识（纯数据，去掉连字符），周期结束作重置时刻。
    { id: 'plan', kindKey: 'plan-name', text: 'individual goat', resetsAt: '2026-10-17T06:28:04.000Z' },
    // used/cap 是绝对 Credit 数（非 0..1 比例）→ 折算已用百分比，绝对数原样下发供客户端缩写。
    { id: 'five-hour', kindKey: 'five-hour', percent: 1, used: 0.16, limit: 14, resetsAt: new Date(1789645175513).toISOString() },
    { id: 'weekly', kindKey: 'weekly', percent: 0, used: 0.16, limit: 35, resetsAt: new Date(1790231975513).toISOString() },
  ] })

  // 三源各自缺失时的降级：paid 与 free 缺席只按存在的源求和；全缺则整条余额窗不下发。
  assert.deepEqual(normalizeCommandCodeQuota({ credits: { credits: { monthlyCredits: 5 } } }).windows, [
    { id: 'balance', kindKey: 'balance', text: '$5.00' },
  ])
  assert.deepEqual(normalizeCommandCodeQuota({ credits: { credits: { monthlyCredits: null, purchasedCredits: null, freeCredits: null } } }).windows, [])
  assert.deepEqual(normalizeCommandCodeQuota({ credits: {} }).windows, [])

  // summary 缺席 → 不拿剩余冒充总额，只少一行「本周期已用」。
  assert.deepEqual(normalizeCommandCodeQuota({ ...COMMAND_CODE_FIXTURE, summary: null }).windows.map((w) => w.id),
    ['balance', 'plan', 'five-hour', 'weekly'])

  // 空窗口（used/cap 缺失或 cap<=0）跳过——0/0 上算百分比无意义，不伪造 0%。
  assert.deepEqual(normalizeCommandCodeQuota({
    credits: { windowLimits: { fiveHour: { used: 1, cap: 0 }, weekly: { used: null, cap: 35 } } },
  }).windows, [])

  // 坏形状一律空：非对象、subscription 空、未知 planId 形态。
  assert.deepEqual(normalizeCommandCodeQuota(null).windows, [])
  assert.deepEqual(normalizeCommandCodeQuota('nope').windows, [])
  assert.deepEqual(normalizeCommandCodeQuota({ subscription: { data: {} } }).windows, [])
  // 订阅信封已解包形态（`{planId,…}` 直给）也认，两种形态都出现过。
  assert.deepEqual(normalizeCommandCodeQuota({ subscription: { planId: 'individual_pro' } }).windows,
    [{ id: 'plan', kindKey: 'plan-name', text: 'individual pro' }])
})

test('Command Code fetchUsage walks whoami → credits/subscriptions → summary with the billing-period anchor', async () => {
  const requests = []
  const payloads = {
    '/alpha/whoami': { success: true, user: { userName: 'woodyair' }, org: null },
    '/alpha/billing/credits': COMMAND_CODE_FIXTURE.credits,
    '/alpha/billing/subscriptions': COMMAND_CODE_FIXTURE.subscription,
    '/alpha/usage/summary': COMMAND_CODE_FIXTURE.summary,
  }
  const requestJson = async (endpoint, options) => {
    requests.push({ endpoint, authorization: options.authorization })
    const path = endpoint.slice(endpoint.indexOf('/alpha'))
    const key = path.split('?')[0]
    if (payloads[key] === undefined) throw new Error(`unexpected ${endpoint}`)
    return payloads[key]
  }
  const windows = await fetchCommandCodeQuota({ credential: 'Bearer user_abc', signal: undefined, requestJson })
  assert.equal(windows.length, 5)
  // whoami 不带查询参数；个人号 org=null → 后续三点也不带 orgId；摘要带订阅周期起点（官方 CLI 同序）。
  assert.deepEqual(requests.map((entry) => entry.endpoint), [
    'https://api.commandcode.ai/alpha/whoami',
    'https://api.commandcode.ai/alpha/billing/credits',
    'https://api.commandcode.ai/alpha/billing/subscriptions',
    `https://api.commandcode.ai/alpha/usage/summary?since=${encodeURIComponent('2026-09-17T06:28:04.000Z')}`,
  ])
  for (const entry of requests) assert.equal(entry.authorization, 'Bearer user_abc')

  // 组织号：org.id 有值 → 三个端点都带 orgId（查询串顺序为 orgId 在前、since 在后）。
  requests.length = 0
  payloads['/alpha/whoami'] = { success: true, org: { id: 'org-42', login: 'acme' } }
  await fetchCommandCodeQuota({ credential: 'user_plain', signal: undefined, requestJson })
  assert.deepEqual(requests.map((entry) => entry.endpoint.replace('https://api.commandcode.ai', '')), [
    '/alpha/whoami',
    '/alpha/billing/credits?orgId=org-42',
    '/alpha/billing/subscriptions?orgId=org-42',
    `/alpha/usage/summary?orgId=org-42&since=${encodeURIComponent('2026-09-17T06:28:04.000Z')}`,
  ])
})

test('Command Code fetchUsage normalizes credential and payload failures stably', async () => {
  const ok = { ok: true }
  // 空凭据（发现链全落空后不该发生，仍防御）。
  await assert.rejects(fetchCommandCodeQuota({ credential: '', signal: undefined, requestJson: async () => ok }),
    (error) => error.message === 'credential-missing')
  // 传输层缺席。
  await assert.rejects(fetchCommandCodeQuota({ credential: 'k', signal: undefined, requestJson: undefined }),
    (error) => error.message === 'transport-unavailable')

  // whoami 401/403 → credential-rejected（错 key 要能就地重填），且不再打后续端点。
  let calls = 0
  await assert.rejects(fetchCommandCodeQuota({
    credential: 'k', signal: undefined,
    requestJson: async () => { calls += 1; throw new Error('http-status:401') },
  }), (error) => error.message === 'credential-rejected')
  assert.equal(calls, 1)

  // 业务面部分失败不拖垮整行：credits 失败但 summary 可用 → 仍出窗口。
  const partial = await fetchCommandCodeQuota({
    credential: 'k', signal: undefined,
    requestJson: async (endpoint) => {
      if (endpoint.includes('/credits')) throw new Error('http-status:500')
      if (endpoint.includes('/whoami')) return { org: null }
      if (endpoint.includes('/subscriptions')) return COMMAND_CODE_FIXTURE.subscription
      return { totalCost: 1.5 }
    },
  })
  assert.deepEqual(partial.map((window) => window.id), ['period-spend', 'plan'])

  // 三段全无可识别数据 → 抛首个端点的稳定错误码（原话随 detail 透出）。
  await assert.rejects(fetchCommandCodeQuota({
    credential: 'k', signal: undefined,
    requestJson: async (endpoint) => {
      if (endpoint.includes('/whoami')) return { org: null }
      const error = new Error('http-status:503')
      error.detail = 'upstream down'
      throw error
    },
  }), (error) => error.message === 'http-status:503' && error.detail === 'upstream down')

  // 端点全 200 但形状不认识 → bad-payload:shape（不谎报成功）。
  await assert.rejects(fetchCommandCodeQuota({
    credential: 'k', signal: undefined,
    requestJson: async (endpoint) => (endpoint.includes('/whoami') ? { org: null } : {}),
  }), (error) => error.message === 'bad-payload:shape')
})

test('Command Code adapter claims the api host and exposes the fixed usage page', () => {
  const adapters = createCatalog()
  const adapter = findQuotaAdapter(adapters, 'command-goat')
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'command-goat', baseURL: 'https://api.commandcode.ai/provider/v1' })?.kind, 'command-goat')
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'command-goat', baseURL: '' })?.kind, 'command-goat')
  // 查询面是宿主常量、无 baseURL 派生：任何 baseURL 都不影响适配（与 cliproxy 的钉住域不同）。
  assert.deepEqual(quotaAdapterEndpoints(adapter, { baseURL: '' }), [])
  assert.deepEqual(prepareQuotaAdapterConfig(adapter, { baseURL: '' }), { ok: true })
  assert.deepEqual(prepareQuotaAdapterConfig(adapter, { baseURL: 'https://relay.example/v1' }), { ok: true })
  assert.equal(quotaAdapterUsageUrl(adapter), 'https://commandcode.ai/settings/usage')
  const policy = adapter.credentialPolicy({ apiKeyEnv: 'COMMAND_GOAT_API_KEY' })
  assert.deepEqual([...policy.hints], ['COMMAND_GOAT_API_KEY', 'COMMAND_CODE_API_KEY', 'COMMANDCODE_API_KEY'])
  assert.equal(policy.format('user_abc'), 'Bearer user_abc')
  assert.equal(policy.entryKey, 'edit')
})
