import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createQuotaAdapterCatalog,
  fetchCommandCodeQuota,
  fetchWorkbuddyUsage,
  findQuotaAdapter,
  mergeWorkbuddyRealmCaps,
  normalizeCommandCodeQuota,
  normalizeWorkbuddyUsage,
  quotaAdapterRealmCaps,
  sanitizeRealmCaps,
  prepareQuotaAdapterConfig,
  quotaAdapterEndpoints,
  quotaAdapterUsageUrl,
  recognizeQuotaAdapter,
} from '../quota-adapters.js'

test('Vercel USD balance preserves decimal text without inventing a lifetime-spend denominator', () => {
  const adapter = findQuotaAdapter(createCatalog(), 'vercel-ai-gateway')
  for (const balance of ['95.50', '0', '0.000001', '1234.123456789']) {
    assert.deepEqual(adapter.normalize({ balance, total_used: '999999' }), {
      windows: [{ id: 'balance', kindKey: 'balance', text: `$${balance}`, unit: 'usd' }],
    })
  }
  for (const balance of [undefined, null, '', ' ', true, 95.5, [], {}, '-1', 'NaN', 'Infinity', '1e10', '9007199254740992']) {
    assert.deepEqual(adapter.normalize({ balance, total_used: '10' }), { windows: [] })
  }
  assert.equal(recognizeQuotaAdapter(createCatalog(), { name: 'vercel-ai-gateway', baseURL: '' })?.kind, 'vercel-ai-gateway')
  assert.equal(adapter.recognize({ name: 'vercel-ai-gateway', baseURL: 'https://relay.example/v1' }), false)
  assert.equal(adapter.recognize({ baseURL: 'https://ai-gateway.vercel.sh.evil.example/v1' }), false)
  assert.equal(adapter.recognize({ baseURL: 'https://vercel.com/v1' }), false)
  assert.deepEqual([...adapter.credentialPolicy({ apiKeyEnv: 'AI_GATEWAY_API_KEY' }).hints], ['AI_GATEWAY_API_KEY'])
})

test('Poe points retain exact non-monetary values and reject missing or coercible junk', () => {
  const adapter = findQuotaAdapter(createCatalog(), 'poe')
  for (const value of ['12345678901234567890.25', 0, -2]) {
    assert.deepEqual(adapter.normalize({ current_point_balance: value }), {
      windows: [{ id: 'points', kindKey: 'points', text: `${value} points`, unit: 'points' }],
    })
  }
  for (const value of [null, undefined, '', ' ', true, [], {}, 'NaN', Infinity, '1e10']) {
    assert.deepEqual(adapter.normalize({ current_point_balance: value }), { windows: [] })
  }
})

test('ClinePass normalizes known windows with explicit resets and fails closed on duplicates', () => {
  const adapter = findQuotaAdapter(createCatalog(), 'clinepass')
  const limits = [
    { type: 'monthly', percentUsed: 110 },
    { type: 'weekly', percentUsed: 25.4, resetsAt: '2026-11-01T00:00:00Z' },
    { type: 'five_hour', percentUsed: 0 },
    { type: 'other', percentUsed: 50 },
  ]
  assert.deepEqual(adapter.normalize({ success: true, data: { limits } }), { windows: [
    { id: 'five-hour', percent: 0 },
    { id: 'weekly', percent: 25, resetsAt: '2026-11-01T00:00:00.000Z' },
    { id: 'monthly', percent: 100 },
  ] })
  for (const percentUsed of [null, '', '50', true, -1, Infinity]) {
    assert.deepEqual(adapter.normalize({ success: true, data: { limits: [{ type: 'weekly', percentUsed }] } }), { windows: [] })
  }
  assert.deepEqual(adapter.normalize({ success: false, data: { limits } }), { windows: [] })
  assert.deepEqual(adapter.normalize({ success: true, data: { limits: [limits[1], limits[1]] } }), { windows: [] })
  assert.deepEqual(adapter.normalize({ success: true, data: { limits: [{ type: 'weekly', percentUsed: 5, resetsAt: '2026-11-01T00:00:00' }] } }), { windows: [{ id: 'weekly', percent: 5 }] })
})

test('Poe and ClinePass use fixed endpoints, isolated hints and existing rejection handling', async () => {
  for (const [kind, endpoint, hint, payload] of [
    ['vercel-ai-gateway', 'https://ai-gateway.vercel.sh/v1/credits', 'AI_GATEWAY_API_KEY', { balance: '95.50', total_used: '4.50' }],
    ['poe', 'https://api.poe.com/usage/current_balance', 'POE_API_KEY', { current_point_balance: '100' }],
    ['clinepass', 'https://api.cline.bot/api/v1/users/me/plan/usage-limits', 'CLINEPASS_API_KEY', { success: true, data: { limits: [{ type: 'weekly', percentUsed: 20 }] } }],
  ]) {
    const adapter = findQuotaAdapter(createCatalog(), kind)
    assert.deepEqual([...adapter.credentialPolicy({ apiKeyEnv: 'CUSTOM_KEY' }).hints], ['CUSTOM_KEY', hint])
    assert.equal(adapter.credentialPolicy({}).format('key'), 'Bearer key')
    assert.equal(adapter.recognize({ name: kind, baseURL: '' }), true)
    assert.equal(adapter.recognize({ name: kind, baseURL: 'https://evil.example/v1' }), false)
    assert.equal(adapter.recognize({ baseURL: endpoint }), true)
    assert.equal(adapter.recognize({ baseURL: endpoint.replace('https:', 'http:') }), false)
    let calls = 0
    const context = { profile: { baseURL: 'https://relay.example/v1' }, credential: async () => 'Bearer key',
      fetchJson: async (url, auth) => { calls++; assert.equal(url, endpoint); assert.equal(auth, 'Bearer key'); return payload } }
    assert.deepEqual(await adapter.fetchUsage(context), payload)
    assert.equal(calls, 1)
    await assert.rejects(adapter.fetchUsage({ ...context, credential: async () => undefined }), /credential-missing/)
    await assert.rejects(adapter.fetchUsage({ ...context, fetchJson: async () => { const error = new Error('http-status:401'); error.status = 401; throw error } }), /credential-rejected/)
    await assert.rejects(adapter.fetchUsage({ ...context, fetchJson: async () => ({}) }), /bad-payload/)
  }
})

function createCatalog() {
  return createQuotaAdapterCatalog()
}

test('quota Adapter catalog exposes one exact five-method interface per unique kind', () => {
  const adapters = createCatalog()
  const expectedInterface = ['credentialPolicy', 'fetchUsage', 'kind', 'normalize', 'recognize']
  assert.equal(adapters.length, 15)
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
    // unit:'usd' 声明绝对数量纲（Credit 与美元 1:1）：缺了它客户端会按 token 数缩写渲染。
    { id: 'five-hour', kindKey: 'five-hour', percent: 1, used: 0.16, limit: 14, unit: 'usd', resetsAt: new Date(1789645175513).toISOString() },
    { id: 'weekly', kindKey: 'weekly', percent: 0, used: 0.16, limit: 35, unit: 'usd', resetsAt: new Date(1790231975513).toISOString() },
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

// ─── Workbuddy 网关（workbuddy）面板用量 API ────────────────────────────────
// 真实形状来自 2026-10-18 真 key 实测（/panel/api/usage?hours=24）：totals + by_realm + by_account
// + by_model + series；hours 收窄全部汇总。这里只固定归一化与传输契约。
const WORKBUDDY_FIXTURE = {
  totals: {
    requests: 1077, errors: 13,
    prompt_tokens: 257200000, completion_tokens: 734600, total_tokens: 257934600,
    credits: 99.97, cache_hit_rate: 99.54, avg_latency_ms: 5670,
  },
  by_realm: [
    { key: 'cn', requests: 749, total_tokens: 200702562, credits: 99.97 },
    { key: 'global', requests: 328, total_tokens: 57320630, credits: 0 },
  ],
  by_account: [
    { key: 'acct-b', realm: 'global', extra: 'user@example.com', requests: 328, total_tokens: 57320630, credits: 0 },
    { key: 'acct-a', realm: 'cn', extra: '神经蛙', requests: 749, total_tokens: 200702562, credits: 99.97 },
  ],
}

// /panel/api/overview 的限流台账（2026-10-19 真机形状）：账号级 cooling/until/reason +
// 模型级 rate_limited_models（reset_at 是上游原始重置墙钟，until 是网关自己的解锁时刻）；
// accounts[].credits / credits_total 是**剩余积分 / 总额度**（与用量行的 credits=窗口消耗不同名不同义），
// uid 与用量 by_account[].key 同值，用来把余额挂回账号行。
const WORKBUDDY_OVERVIEW = {
  accounts: [
    {
      uid: 'acct-a', nickname: '神经蛙', realm: 'cn', cooling: false, credits: 1205, credits_total: 1305,
      rate_limited_models: [
        { model: 'glm-5.3', kind: 'rate_limit', until: '2026-10-19T11:40:00+08:00', reset_at: '2026-10-20T10:00:00+08:00' },
        { model: 'kimi-k3', kind: 'rate_limit', until: '2026-10-19T11:10:00+08:00', reset_at: '2026-10-19T12:00:00+08:00' },
        { model: 'minimax-m3', kind: 'rate_limit', reset_at: '2026-10-20T09:00:00+08:00' },
      ],
    },
    { uid: 'acct-b', nickname: 'user@example.com', realm: 'global', cooling: true, until: '2026-10-19T12:30:00+08:00', reason: '429 rate limit', credits: 350, credits_total: 350 },
  ],
}

test('Workbuddy usage normalizes per-realm daily-volume gauges and account rollups (totals stay off-card)', () => {
  assert.deepEqual(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE), { windows: [
    { id: 'usage-window', kindKey: 'usage-window', text: '24h' },
    // 区域行 = 百分比窗口（油表/进度条）：分母是每日模型量上限 cn 200M / global 100M。
    // 超上限时 percent 截 100，used 仍是真实用量（cn 200,702,562 > 200M → 100%）。
    { id: 'realm-cn', kindKey: 'realm-daily-tokens', label: 'cn', percent: 100, used: 200702562, limit: 200000000 },
    { id: 'realm-global', kindKey: 'realm-daily-tokens', label: 'global', percent: 57, used: 57320630, limit: 100000000 },
    // 账号按 total_tokens 降序（面板原序不保证），昵称/邮箱是纯数据标签。
    { id: 'account-0', kindKey: 'account-usage', label: '神经蛙', parts: [
      { kindKey: 'requests', text: '749' }, { kindKey: 'tokens', text: '200.7M' }, { kindKey: 'credits', text: '99.97' },
    ] },
    { id: 'account-1', kindKey: 'account-usage', label: 'user@example.com', parts: [
      { kindKey: 'requests', text: '328' }, { kindKey: 'tokens', text: '57.3M' }, { kindKey: 'credits', text: '0.00' },
    ] },
  ] })

  // 总量统计（请求/错误/输入输出 Token/积分/延迟/缓存命中）不再上卡：给了 totals 也只出统计口径行。
  assert.deepEqual(normalizeWorkbuddyUsage({ totals: { requests: 1, errors: 3, total_tokens: 5 } }).windows,
    [{ id: 'usage-window', kindKey: 'usage-window', text: '24h' }])

  // 面板返回既没有 totals 也没有汇总 → 空窗口（fetcher 转 bad-payload:shape，不谎报成功）。
  for (const payload of [null, 'nope', {}, { totals: null }, { totals: [] }, { by_realm: 'x', by_account: 3 }]) {
    assert.deepEqual(normalizeWorkbuddyUsage(payload).windows, [])
  }

  // 缺段容错：区域缺 total_tokens（画不了油表）→ 回落「请求/Token/积分」文字行；
  // 空 key / 非对象整行跳过；账号缺任何段就不出该行。
  assert.deepEqual(normalizeWorkbuddyUsage({
    totals: { requests: 1 },
    by_realm: [{ key: 'cn', requests: 2 }, { key: '', requests: 3 }, { key: 'global' }, null, 'x'],
    by_account: [{ key: 'a', requests: 4 }, { key: 'b' }, { key: 'c', total_tokens: 10 }],
  }).windows.map((window) => window.id), ['usage-window', 'realm-cn', 'account-0', 'account-1'])
  // 未登记上限的区域同样回落文字行（不编分母）。
  const unknownRealm = normalizeWorkbuddyUsage({ totals: { requests: 1 }, by_realm: [{ key: 'sgp', requests: 2, total_tokens: 5 }] }).windows
  assert.deepEqual(unknownRealm.filter((window) => window.kindKey === 'realm-usage').map((window) => window.label), ['sgp'])
  assert.equal(unknownRealm.some((window) => window.kindKey === 'realm-daily-tokens'), false)

  // 上限：区域 ≤4、账号 ≤6；账号标签回退顺序 昵称 → 区域码 → 账号键（截断 32）。
  const manyRealms = Array.from({ length: 8 }, (_, index) => ({ key: `r${index}`, requests: index + 1 }))
  const manyAccounts = Array.from({ length: 10 }, (_, index) => ({ key: `k${index}`, realm: 'cn', requests: index + 1 }))
  const capped = normalizeWorkbuddyUsage({ totals: { requests: 1 }, by_realm: manyRealms, by_account: manyAccounts }).windows
  // 八个未登记上限的区域都回落文字行，仍受 ≤4 截断。
  assert.deepEqual(capped.filter((window) => window.kindKey === 'realm-usage').map((window) => window.label), ['r0', 'r1', 'r2', 'r3'])
  const cappedAccounts = capped.filter((window) => window.kindKey === 'account-usage')
  assert.equal(cappedAccounts.length, 6)
  // 无昵称 → 回退区域码 'cn'。
  assert.ok(cappedAccounts.every((window) => window.label === 'cn'))

  // 标签清洗：控制字符压成空格、超长截断（128）；区域码截断 32。
  const dirty = normalizeWorkbuddyUsage({
    totals: { requests: 1 },
    by_realm: [{ key: 'c\nn', requests: 1 }],
    by_account: [{ key: 'k', realm: 'cn', extra: `bad\u0000name ${'x'.repeat(200)}`, requests: 1 }],
  }).windows
  assert.equal(dirty.find((window) => window.kindKey === 'realm-usage').label, 'c n')
  const accountLabel = dirty.find((window) => window.kindKey === 'account-usage').label
  assert.equal(accountLabel.length, 128)
  assert.ok(!accountLabel.includes('\u0000'))
})

test('Workbuddy limit ledger replaces the totals block: per-realm models + upstream reset wall clock', () => {
  const windows = normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, WORKBUDDY_OVERVIEW).windows
  // 限流行紧跟在统计口径行之后（油表之前），总量统计已不再出现。
  assert.deepEqual(windows.slice(0, 3), [
    { id: 'usage-window', kindKey: 'usage-window', text: '24h' },
    {
      id: 'limit-cn',
      kindKey: 'limit-models',
      label: 'cn',
      // 每域最多两个模型；时间只下发 ISO（客户端按浏览器时区格式化），第三个模型折叠成 +1。
      parts: [
        { kindKey: '', text: 'glm-5.3' },
        { kindKey: 'reset-at', iso: '2026-10-20T02:00:00.000Z' },
        { kindKey: '', text: 'kimi-k3' },
        { kindKey: 'reset-at', iso: '2026-10-19T04:00:00.000Z' },
        { kindKey: '', text: '+1' },
      ],
      resetsAt: '2026-10-19T04:00:00.000Z',
    },
    {
      id: 'cooling-1',
      kindKey: 'account-cooling',
      label: 'user@example.com',
      parts: [
        { kindKey: 'reason', text: '429 rate limit' },
        { kindKey: 'reset-at', iso: '2026-10-19T04:30:00.000Z' },
      ],
      resetsAt: '2026-10-19T04:30:00.000Z',
    },
  ])
  // 后面仍是油表与账号行（顺序不变）。
  assert.deepEqual(windows.map((window) => window.id), ['usage-window', 'limit-cn', 'cooling-1', 'realm-cn', 'realm-global', 'account-0', 'account-1'])

  // 账号行用面板余额台账的「剩余积分」（credits 余额 / credits_total 总额）替换窗口消耗——
  // 段落逐个对：uid 与用量 key 对上才算数（acct-a=cn、acct-b=global）。
  assert.deepEqual(windows.filter((window) => window.kindKey === 'account-usage').map((window) => window.parts), [
    [{ kindKey: 'requests', text: '749' }, { kindKey: 'tokens', text: '200.7M' }, { kindKey: 'credit-balance', text: '1205 / 1305' }],
    [{ kindKey: 'requests', text: '328' }, { kindKey: 'tokens', text: '57.3M' }, { kindKey: 'credit-balance', text: '350 / 350' }],
  ])
  // 余额缺失（旧面板/坏数据）→ 保留窗口消耗，不把未知渲染成 0。
  const withoutBalances = normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, { accounts: [{ uid: 'acct-a' }] }).windows
  assert.deepEqual(withoutBalances.find((window) => window.id === 'account-0').parts[2], { kindKey: 'credits', text: '99.97' })
  // credits_total 缺失/0（未知总额度）→ 只显示剩余，不拼「/ 0」。
  const withoutTotal = normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, { accounts: [{ uid: 'acct-a', credits: 42, credits_total: 0 }] }).windows
  assert.deepEqual(withoutTotal.find((window) => window.id === 'account-0').parts[2], { kindKey: 'credit-balance', text: '42' })
  // 余额是 0 也要显示（0 不等于未知）。
  const zero = normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, { accounts: [{ uid: 'acct-a', credits: 0 }] }).windows
  assert.deepEqual(zero.find((window) => window.id === 'account-0').parts[2], { kindKey: 'credit-balance', text: '0' })

  // 台账可用但当前无锁 → 一行「—」；台账不可用（null/坏形状）→ 不出行（未知 ≠ 无限流）。
  assert.deepEqual(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, { accounts: [] }).windows[1],
    { id: 'limit', kindKey: 'rate-limits', text: '—' })
  assert.deepEqual(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, null).windows[1].id, 'realm-cn')
  assert.deepEqual(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, { accounts: 'x' }).windows[1].id, 'realm-cn')

  // 坏条目静默跳过：缺模型名、非对象、时间不可解析都不该造行；11102（模型不可用）不是额度限流，
  // 它的重试时间不能冒充「配额重置」。
  assert.deepEqual(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, {
    accounts: [
      { realm: 'cn', rate_limited_models: [
        { model: '' }, null, 'x',
        { model: 'glm-5.3', reset_at: 'not-a-date' },
        { model: 'ghost-model', kind: 'model_unavailable', until: '2026-10-19T12:00:00+08:00' },
      ] },
      null,
      'x',
    ],
  }).windows[1], { id: 'limit-cn', kindKey: 'limit-models', label: 'cn', parts: [{ kindKey: '', text: 'glm-5.3' }] })

  // 账号级冷却缺原因又缺时间 → 整行跳过（不能渲染成空百分比行）。
  assert.deepEqual(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, { accounts: [{ realm: 'cn', cooling: true }] }).windows[1],
    { id: 'limit', kindKey: 'rate-limits', text: '—' })

  // 域行上限 4，账号冷却行上限 2。
  const many = { accounts: [0, 1, 2, 3, 4].map((index) => ({ realm: `r${index}`, rate_limited_models: [{ model: `m${index}` }] })) }
  assert.equal(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, many).windows.filter((window) => window.kindKey === 'limit-models').length, 4)
  const coolingMany = { accounts: [0, 1, 2, 3].map((index) => ({ realm: 'cn', cooling: true, reason: `r${index}` })) }
  assert.equal(normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, undefined, coolingMany).windows.filter((window) => window.kindKey === 'account-cooling').length, 2)
})

test('Workbuddy fetchUsage derives the panel endpoint from the relay baseURL and classifies failures', async () => {
  const requests = []
  const requestJson = async (endpoint, options) => {
    requests.push({ endpoint, authorization: options.authorization })
    return endpoint.includes('/panel/api/overview') ? { accounts: [] } : WORKBUDDY_FIXTURE
  }
  const profile = { name: 'workbuddy', baseURL: 'https://relay.example/v1' }
  const windows = await fetchWorkbuddyUsage({ profile, credential: 'Bearer gateway-key', signal: undefined, requestJson })
  // 用量 5 窗口（统计口径 + 2 油表 + 2 账号）+ 1 行「限流 —」（overview 可用但当前无锁）。
  assert.equal(windows.length, 6)
  // 端点 = 所选渠道 baseURL 同源 + 面板固定路径（中转网关与面板 API 同域）；限流台账同源。
  assert.deepEqual(requests, [
    { endpoint: 'https://relay.example/panel/api/usage?hours=24', authorization: 'Bearer gateway-key' },
    { endpoint: 'https://relay.example/panel/api/overview', authorization: 'Bearer gateway-key' },
  ])

  // 裸 key 与整头粘贴都容错成同一个 Bearer；默认端口与无端口写法同源。
  requests.length = 0
  await fetchWorkbuddyUsage({ profile, credential: 'gateway-key', signal: undefined, requestJson })
  await fetchWorkbuddyUsage({ profile, credential: 'Authorization: Bearer gateway-key', signal: undefined, requestJson })
  await fetchWorkbuddyUsage({ profile: { baseURL: 'https://relay.example:443/v1' }, credential: 'k', signal: undefined, requestJson })
  assert.deepEqual(requests.map((entry) => entry.endpoint), [
    'https://relay.example/panel/api/usage?hours=24',
    'https://relay.example/panel/api/overview',
    'https://relay.example/panel/api/usage?hours=24',
    'https://relay.example/panel/api/overview',
    'https://relay.example/panel/api/usage?hours=24',
    'https://relay.example/panel/api/overview',
  ])
  assert.deepEqual(requests.map((entry) => entry.authorization), [
    'Bearer gateway-key', 'Bearer gateway-key',
    'Bearer gateway-key', 'Bearer gateway-key',
    'Bearer k', 'Bearer k',
  ])

  // baseURL 是查询面的唯一来源：空/非法一律如实报错，绝不回退写死主机。
  for (const baseURL of ['', '   ', 'relay.example/v1', 'http://relay.example/v1', 'https://user@relay.example/v1', 'https://relay.example:8443/v1']) {
    await assert.rejects(fetchWorkbuddyUsage({ profile: { baseURL }, credential: 'k', signal: undefined, requestJson }),
      (error) => error.message === (String(baseURL).trim() === '' ? 'no-base-url' : 'unsafe-provider-endpoint'))
  }

  await assert.rejects(fetchWorkbuddyUsage({ profile, credential: '', signal: undefined, requestJson }),
    (error) => error.message === 'credential-missing')
  await assert.rejects(fetchWorkbuddyUsage({ profile, credential: 'k', signal: undefined, requestJson: undefined }),
    (error) => error.message === 'transport-unavailable')

  // 401/403 → credential-rejected（行回 unconfigured 以便就地重填），上游原话随 detail 透出。
  for (const status of [401, 403]) {
    await assert.rejects(fetchWorkbuddyUsage({
      profile, credential: 'k', signal: undefined,
      requestJson: async () => { const error = new Error(`http-status:${status}`); error.detail = 'invalid key'; throw error },
    }), (error) => error.message === 'credential-rejected' && error.detail === 'invalid key')
  }
  // 其余传输错误原样抛出（状态码后缀保留）。
  await assert.rejects(fetchWorkbuddyUsage({
    profile, credential: 'k', signal: undefined,
    requestJson: async () => { throw new Error('http-status:503') },
  }), (error) => error.message === 'http-status:503')
  // 200 但形状不认识 → bad-payload:shape。
  await assert.rejects(fetchWorkbuddyUsage({ profile, credential: 'k', signal: undefined, requestJson: async () => ({}) }),
    (error) => error.message === 'bad-payload:shape')
})

test('Workbuddy limit ledger degrades independently of the usage windows', async () => {
  const profile = { name: 'workbuddy', baseURL: 'https://relay.example/v1' }
  // overview 不可用（旧面板 404 / 该 key 无面板面权限）→ 用量窗口照常返回，只是没有限流行。
  for (const failure of ['http-status:404', 'http-status:401', 'bad-payload:json', 'network']) {
    const windows = await fetchWorkbuddyUsage({
      profile, credential: 'k', signal: undefined,
      requestJson: async (endpoint) => {
        if (endpoint.includes('/panel/api/overview')) throw new Error(failure)
        return WORKBUDDY_FIXTURE
      },
    })
    assert.equal(windows.length, 5)
    assert.equal(windows.some((window) => String(window.kindKey).startsWith('limit') || window.kindKey === 'account-cooling'), false)
  }
  // overview 形状不对（不是 {accounts: [...]}）→ 同样按「台账不可用」处理，不误报「无限流」。
  const windows = await fetchWorkbuddyUsage({
    profile, credential: 'k', signal: undefined,
    requestJson: async (endpoint) => (endpoint.includes('/panel/api/overview') ? { accounts: {} } : WORKBUDDY_FIXTURE),
  })
  assert.equal(windows.some((window) => window.kindKey === 'rate-limits'), false)

  // 台账可用 → 限流行出现，且使用 reset_at（上游墙钟）而不是 until（网关解锁）。
  const withLedger = await fetchWorkbuddyUsage({
    profile, credential: 'k', signal: undefined,
    requestJson: async (endpoint) => (endpoint.includes('/panel/api/overview') ? WORKBUDDY_OVERVIEW : WORKBUDDY_FIXTURE),
  })
  assert.deepEqual(withLedger.slice(0, 3).map((window) => window.id), ['usage-window', 'limit-cn', 'cooling-1'])
})

test('Workbuddy adapter is manual-only: it never claims a relay host or route id', () => {
  const adapters = createCatalog()
  const adapter = findQuotaAdapter(adapters, 'workbuddy')
  // baseURL 是中转地址，主机名不构成服务身份：真实中转域名与同名路由都不自动认领。
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'workbuddy', baseURL: 'https://wb.woodyair.dpdns.org/v1' }), undefined)
  assert.equal(recognizeQuotaAdapter(adapters, { name: 'workbuddy', baseURL: '' }), undefined)
  assert.equal(adapter.recognize({ name: 'workbuddy', baseURL: 'https://wb.woodyair.dpdns.org/v1' }), false)
  // 手动适配入口：类型可保存（不要求自动识别通过）；端点不参与兼容导出，也不给静态外链。
  assert.deepEqual(prepareQuotaAdapterConfig(adapter, { baseURL: 'https://wb.woodyair.dpdns.org/v1' }), { ok: true })
  assert.deepEqual(prepareQuotaAdapterConfig(adapter, { baseURL: '' }), { ok: true })
  assert.deepEqual(quotaAdapterEndpoints(adapter, { baseURL: 'https://wb.woodyair.dpdns.org/v1' }), [])
  assert.equal(quotaAdapterUsageUrl(adapter), undefined)
  const policy = adapter.credentialPolicy({ apiKeyEnv: 'WORKBUDDY_API_KEY_abc' })
  assert.deepEqual([...policy.hints], ['WORKBUDDY_API_KEY_abc', 'WORKBUDDY_API_KEY'])
  assert.equal(policy.format('gateway-key'), 'Bearer gateway-key')
  assert.equal(policy.entryKey, 'edit')
})

test('Workbuddy realm caps are configurable: sanitizer + provider override + adapter merge', () => {
  // 归一：只认合法区键与正整数 tokens；坏条目静默丢弃（坏配置只能让油表回落，不能让整行报错）。
  assert.deepEqual(sanitizeRealmCaps({ cn: 2e8, global: '1e8', bad: -1, 'no space': 5, x: 'abc' }), { cn: 200000000, global: 100000000 })
  assert.deepEqual(sanitizeRealmCaps(null), {})
  assert.deepEqual(sanitizeRealmCaps([1, 2]), {})
  // 上界 1e12（防手滑多打零）：越界值整条丢弃，不截断成「看似合法」的数。
  assert.deepEqual(sanitizeRealmCaps({ cn: 2e13 }), {})
  // 条数上限 8。
  assert.equal(Object.keys(sanitizeRealmCaps(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`r${i}`, 1e6])))).length, 8)

  // 默认值合并：覆盖只影响给出的区。
  assert.deepEqual(mergeWorkbuddyRealmCaps(undefined), { cn: 200000000, global: 100000000 })
  assert.deepEqual(mergeWorkbuddyRealmCaps({ cn: 300000000 }), { cn: 300000000, global: 100000000 })

  // 归一化按传入分母计算：cn 100M 分母下 200.7M → 100%（截断）+ 真实 used。
  const windows = normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, { cn: 100000000, global: 100000000 }).windows
  const cn = windows.find((window) => window.id === 'realm-cn')
  assert.deepEqual(cn, { id: 'realm-cn', kindKey: 'realm-daily-tokens', label: 'cn', percent: 100, used: 200702562, limit: 100000000 })
  // 分母调大 → 百分比下降（同一份用量换个分母就换读数）。
  const loose = normalizeWorkbuddyUsage(WORKBUDDY_FIXTURE, { cn: 400000000, global: 100000000 }).windows.find((window) => window.id === 'realm-cn')
  assert.equal(loose.percent, 50)

  // Adapter 元数据暴露默认分母（客户端据此渲染输入框）；未声明的 Adapter 返回 undefined。
  const adapters = createCatalog()
  const adapter = findQuotaAdapter(adapters, 'workbuddy')
  assert.deepEqual(quotaAdapterRealmCaps(adapter, undefined), { cn: 200000000, global: 100000000 })
  assert.deepEqual(quotaAdapterRealmCaps(adapter, { cn: 250000000 }), { cn: 250000000, global: 100000000 })
  assert.equal(quotaAdapterRealmCaps(findQuotaAdapter(adapters, 'openrouter'), {}), undefined)
})

test('Workbuddy fetchUsage applies the provider-level realm caps from quota config', async () => {
  const requestJson = async () => WORKBUDDY_FIXTURE
  const profile = { name: 'workbuddy2api-panel', baseURL: 'https://relay.example/v1' }
  const withConfig = await fetchWorkbuddyUsage({ profile, config: { realmCaps: { 'workbuddy2api-panel': { cn: 100000000 } } }, credential: 'k', signal: undefined, requestJson })
  const cn = withConfig.find((window) => window.id === 'realm-cn')
  assert.equal(cn.limit, 100000000)
  // 未配置该 provider → 回默认分母；配置值非法 → 保持默认（不把油表打成 NaN）。
  const defaulted = await fetchWorkbuddyUsage({ profile, config: { realmCaps: {} }, credential: 'k', signal: undefined, requestJson })
  assert.equal(defaulted.find((window) => window.id === 'realm-cn').limit, 200000000)
  const bogus = await fetchWorkbuddyUsage({ profile, config: { realmCaps: { 'workbuddy2api-panel': { cn: -5 } } }, credential: 'k', signal: undefined, requestJson })
  assert.equal(bogus.find((window) => window.id === 'realm-cn').limit, 200000000)
})

