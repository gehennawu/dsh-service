import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createQuotaAdapterCatalog,
  findQuotaAdapter,
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
  assert.equal(adapters.length, 10)
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
