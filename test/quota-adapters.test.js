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
})
