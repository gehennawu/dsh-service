import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelConfigRoutes } from '../model-config-routes.js'
import { MODEL_FIELDS, ROUTE_FIELDS, COMPAT_GATES, displayProfile, containsSensitive, sensitiveHeader, validateField } from '../model-config-schema.js'

test('built-in provider accepts and persists models outside its installed catalog', async () => {
  const env = host({ profiles: { builtin: { models: [{ id: 'existing' }] } } })
  const opened = await env.call('models3-open', { route: 'builtin' })
  assert.equal(opened.ok, true)
  const added = await env.call('models3-add-models', { sessionId: opened.value.sessionId, modelIds: ['outside-installed-catalog'] })
  assert.equal(added.ok, true, added.error)
  assert.deepEqual(env.raw.providers.builtin.models.map((model) => model.id), ['existing', 'outside-installed-catalog'])
  const reopened = await env.call('models3-open', { route: 'builtin' })
  assert.ok(reopened.value.profile.models.some((model) => model.id === 'outside-installed-catalog'))
})

test('smart fill matches model identity without requiring a built-in provider protocol', async () => {
  let target
  const env = host({
    profiles: { builtin: { models: [{ id: 'extra-model' }] } },
    catalog: { channelIds: new Set(['builtin']), byModelId: new Map([['catalog-model', [{ channel: 'builtin', api: 'openai-completions' }]]]) },
    smartFill: async (value) => { target = value; return { groups: [], sources: [] } },
  })
  const result = await env.call('models3-fill', { route: 'builtin', modelId: 'extra-model' })
  assert.equal(result.ok, true, result.error)
  assert.equal(target.api, '')
  assert.equal(target.channel, '')
  assert.equal(target.modelOnly, true)
  assert.equal(target.modelId, 'extra-model')
  assert.equal(env.calls.length, 0)
})

const clone = (x) => structuredClone(x)
function host({ profiles, inherited = {}, providerAvailability, secret = {}, failSave = false, failSnapshot = false, ref = {}, smartFill, storeMutate, catalog = { channelIds: new Set(['builtin']), byModelId: new Map() } } = {}) {
  const raw = { providers: clone(profiles ?? { relay: { api: 'openai-completions', baseURL: 'http://127.0.0.1/v1', models: [{ id: 'one', unknown: { keep: 3 } }, { id: 'two' }], vendorExtra: true } }) }
  let revision = 1
  const calls = []
  const entry = { options: { id: 'renamed-owner', name: '@deepseek-ai/dsh-llm-pi-ai', config: raw }, fiber: { state: 2, uid: 'test-owner' } }
  const settings = { describe: () => [{ ns: entry.options.id, revision, value: { providers: raw.providers } }], mutate: async (ns, ops, expected) => {
    if (expected !== revision) { const err = new Error('stale'); err.code = 'SETTINGS_CONFLICT'; throw err }
    if (failSave) throw new Error('schema error includes NEVER_PRINT_SECRET')
    const next = clone(raw)
    for (const op of ops) {
      let parent = next; let base = inherited
      for (const key of op.path.slice(0, -1)) { parent = parent[key] ??= {}; base = base?.[key] }
      if (op.op === 'set') parent[op.path.at(-1)] = clone(op.value)
      else if (base?.[op.path.at(-1)] !== undefined) parent[op.path.at(-1)] = clone(base[op.path.at(-1)])
      else delete parent[op.path.at(-1)]
    }
    raw.providers = next.providers; revision++; calls.push({ ns, ops, expected })
  } }
  const state = { providers: {}, removed: {}, recovery: {}, validations: {} }
  const store = { load: async () => clone(state), mutate: async (fn) => { if (failSnapshot) throw new Error('disk'); const next = clone(state); await fn(next); if (storeMutate) await storeMutate(next, state, { raw, bump: () => revision++ }); Object.assign(state, next) } }
  const keys = clone(secret); const credentialCalls = []
  const credentials = { describe: async (id) => ({ configured: Object.hasOwn(keys, id), writable: true }), set: async (id, key) => { credentialCalls.push({ id }); keys[id] = key }, resolve: async (id) => ({ value: keys[id] }), unset: async () => { throw new Error('must never delete') } }
  const services = { settings, configEditor: { configuration: () => [{ entry, inherited, override: raw }] }, credentials }
  const ctx = new Proxy({ get: (id) => services[id] }, { get: (target, key) => { if (key !== 'get') throw new Error('undeclared service'); return target[key] } })
  const routes = createModelConfigRoutes({ ctx, workbenchStore: store, providerAvailability, smartFill, loadPiCatalog: async () => catalog, loadSubagentRoute: async () => ref.subagent, loadAgentDefaultModelSelection: () => ref.main })
  const call = async (id, data) => routes[id].handle(data)
  const open = async () => (await call('models3-open', { route: 'relay' })).value
  return { raw, state, calls, keys, credentialCalls, call, open, bump: () => revision++, services }
}
test('new Profile editor: rejects prototype routes and treats dangerous model IDs only as own data keys', async () => {
  const env = host({ smartFill: async () => ({ groups: [{ field: 'contextWindow', options: [{ candidateId: 'cap', value: 128000, source: 'pi-ai', adoptable: true }] }], sources: [] }) })
  for (const id of ['__proto__', 'constructor', 'prototype']) {
    assert.equal((await env.call('models3-open', { route: id })).error, 'bad-route')
    assert.equal((await env.call('models3-fill', { route: id, modelId: 'one', api: 'openai-completions' })).error, 'bad-route')
  }
  const filled = await env.call('models3-fill', { route: 'relay', modelId: '__proto__' })
  assert.equal(filled.ok, true, filled.error)
  assert.equal((await env.call('models3-bind-source', { queryId: filled.value.queryId, sourceId: filled.value.candidates[0].id })).ok, true)
  assert.equal(Object.hasOwn(env.state.bindings.relay['openai-completions'], '__proto__'), true)
  assert.equal(Object.hasOwn(Object.prototype, 'openai-completions'), false)
})
test('new Profile editor: credential writes obey recovery gating and shared replacement requires an existing ref', async () => {
  const env = host(); const opened = await env.open()
  assert.equal((await env.call('models3-credential-preview', { sessionId: opened.sessionId, shared: true })).error, 'shared-ref-unavailable')
  const preview = await env.call('models3-credential-preview', { sessionId: opened.sessionId })
  env.state.recovery.relay = { reason: 'pending' }
  assert.equal((await env.call('models3-credential-commit', { planId: preview.value.planId, key: 'new' })).error, 'recovery-pending')
  assert.equal(env.credentialCalls.length, 0)
})
test('new Profile editor: token-count metadata is not a secret and unknown benign fields survive', () => {
  assert.equal(containsSensitive({ inputTokens: 100, outputTokens: 20, maxOutputTokens: 4096 }), false)
  assert.equal(containsSensitive({ accessToken: 'secret' }), true)
})
test('new Profile editor: complete field vocabulary and per-protocol compat gates', () => {
  assert.deepEqual(MODEL_FIELDS, ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat'])
  assert.ok(ROUTE_FIELDS.includes('headers')); assert.ok(ROUTE_FIELDS.includes('requestImagePixelBudget'))
  for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages']) assert.ok(COMPAT_GATES[api].length)
  assert.doesNotThrow(() => validateField('compat', { supportsStore: false }, { api: 'openai-completions' }))
  assert.throws(() => validateField('compat', { supportsStore: false }, { api: 'anthropic-messages' }), /compat-not-offered/)
  assert.throws(() => validateField('compat', { supportsOpenAIGrammarTools: true }, { api: 'openai-responses' }), /compat-not-offered/)
  assert.throws(() => validateField('reasoningEfforts', { high: null }), /schema-invalid/)
  assert.doesNotThrow(() => validateField('reasoningEfforts', { high: 'custom-wire', off: null }))
  assert.doesNotThrow(() => validateField('baseURL', 'http://127.0.0.1/v1'))
  assert.throws(() => validateField('baseURL', 'file:///etc/passwd'), /bad-base-url/)
})
test('new Profile editor: sensitive headers and unknown secret fields never reach Display DTO', () => {
  for (const name of ['Authorization', 'aUtHoRiZaTiOn', 'Proxy-Authorization', 'X-API-Key', 'Cookie', 'X-Auth-Token']) assert.equal(sensitiveHeader(name), true)
  const raw = { headers: { Authorization: 'SECRET_VALUE', 'X-Trace': 'public' }, token: 'SECRET_VALUE', models: [{ id: 'one', name: 'One', secret: 'SECRET_VALUE' }] }
  const dto = displayProfile(raw)
  assert.equal(JSON.stringify(dto).includes('SECRET_VALUE'), false)
  assert.deepEqual(dto.headers, { 'X-Trace': 'public' })
  assert.equal(containsSensitive(raw), true)
})
test('new Profile editor: resetting a replaced model-array field restores the matching inherited model value', async () => {
  const env = host({ profiles: { relay: { api: 'openai-completions', models: [{ id: 'one', name: 'Override', contextWindow: 128000 }] } }, inherited: { providers: { relay: { api: 'openai-completions', models: [{ id: 'one', name: 'Inherited', contextWindow: 64000 }] } } } }); const opened = await env.open()
  assert.equal((await env.call('models3-save-model', { sessionId: opened.sessionId, modelId: 'one', patch: {}, unset: ['name', 'contextWindow'] })).ok, true)
  assert.deepEqual(env.raw.providers.relay.models, [{ id: 'one', name: 'Inherited', contextWindow: 64000 }])
})
test('new Profile editor: explicit unset survives JSON transport and preserves unknown model/route fields', async () => {
  const env = host({ profiles: { relay: { api: 'openai-completions', baseURL: 'https://relay.example/v1', vendor: 3, models: [{ id: 'one', name: 'Remove', input: ['text'], unknown: { keep: 1 } }, { id: 'two', untouched: true }] } } })
  const opened = await env.open()
  const payload = JSON.parse(JSON.stringify({ sessionId: opened.sessionId, modelId: 'one', patch: { contextWindow: 128000, reasoningEfforts: false }, unset: ['name'] }))
  const saved = await env.call('models3-save-model', payload)
  assert.equal(saved.ok, true, saved.error)
  assert.equal(env.raw.providers.relay.models[0].name, undefined)
  assert.deepEqual(env.raw.providers.relay.models[0].unknown, { keep: 1 })
  assert.equal(env.raw.providers.relay.vendor, 3)
  assert.deepEqual(env.raw.providers.relay.models[1], { id: 'two', untouched: true })
  assert.equal(env.state.providers.relay.before.models[0].name, 'Remove')
  assert.equal(env.state.providers.relay.status, 'applied')
})
test('new Profile editor: edited snapshot cannot overwrite changes made since opening', async () => {
  const env = host(); const opened = await env.open(); env.bump()
  const saved = await env.call('models3-save-model', { sessionId: opened.sessionId, modelId: 'one', patch: { name: 'lost' } })
  assert.equal(saved.error, 'conflict'); assert.equal(env.calls.length, 0)
})
test('new Profile editor: revision changes during snapshot persistence are rejected inside the host write gate', async () => {
  let triggered = false
  const env = host({ storeMutate: async (_next, _state, controls) => { if (!triggered) { triggered = true; controls.raw.providers.relay.vendorExternal = 42; controls.bump() } } }); const opened = await env.open()
  const saved = await env.call('models3-save-model', { sessionId: opened.sessionId, modelId: 'one', patch: { name: 'Lost' } })
  assert.equal(saved.error, 'conflict'); assert.equal(env.calls.length, 0); assert.equal(env.raw.providers.relay.vendorExternal, 42)
  assert.deepEqual(env.state.providers, {})
})
test('new Profile editor: compat edits can restore offered-key inheritance while retaining unknown keys', async () => {
  const env = host({ profiles: { relay: { api: 'openai-completions', models: [{ id: 'one', compat: { supportsStore: true, supportsUsageInStreaming: true, vendor: 7 } }] } } }); const opened = await env.open()
  const saved = await env.call('models3-save-model', { sessionId: opened.sessionId, modelId: 'one', patch: { compat: { supportsStore: false } } })
  assert.equal(saved.ok, true, saved.error)
  assert.deepEqual(env.raw.providers.relay.models[0].compat, { supportsStore: false, vendor: 7 })
})
test('new Profile editor: snapshot failure prevents config write', async () => {
  const env = host({ failSnapshot: true }); const opened = await env.open()
  const saved = await env.call('models3-save-model', { sessionId: opened.sessionId, modelId: 'one', patch: { name: 'lost' } })
  assert.equal(saved.ok, false); assert.equal(env.calls.length, 0)
})
test('new Profile editor: sensitive header profile is not copied to sidecar or deletable', async () => {
  const env = host({ profiles: { relay: { api: 'openai-completions', headers: { 'X-Api-Key': 'SECRET' }, models: [{ id: 'one' }] } } }); const opened = await env.open()
  assert.equal(JSON.stringify(opened).includes('SECRET'), false)
  assert.equal((await env.call('models3-remove-preview', { sessionId: opened.sessionId })).error, 'sensitive-snapshot')
  assert.equal(env.calls.length, 0); assert.deepEqual(env.state.removed, {})
})
test('new Profile editor: primary and fallback subagent references block removal, unrelated primary model does not', async () => {
  const env = host({ ref: { main: { provider: 'relay', model: 'two' }, subagent: { mode: 'custom', provider: 'other', model: 'x', fallbacks: [{ provider: 'relay', model: 'one' }] } } }); const opened = await env.open()
  const preview = await env.call('models3-remove-preview', { sessionId: opened.sessionId, modelIds: ['one'] })
  assert.equal(preview.value.blocked, true); assert.deepEqual(preview.value.references.map((x) => x.kind), ['subagent-fallback'])
  const removed = await env.call('models3-remove-commit', { planId: preview.value.planId })
  assert.equal(removed.error, 'removal-blocked'); assert.equal(env.calls.length, 0)
})
test('existing model ID rename preserves fields and rejects duplicates or referenced identity removal', async () => {
  const env = host(); const opened = await env.open()
  const saved = await env.call('models3-save-model', { sessionId: opened.sessionId, originalModelId: 'one', modelId: 'renamed', patch: { name: 'Renamed' } })
  assert.equal(saved.ok, true, saved.error)
  assert.deepEqual(env.raw.providers.relay.models[0], { id: 'renamed', name: 'Renamed', unknown: { keep: 3 } })
  const reopened = await env.open()
  assert.equal((await env.call('models3-save-model', { sessionId: reopened.sessionId, originalModelId: 'renamed', modelId: 'two' })).error, 'duplicate-model')
  const blocked = host({ ref: { subagent: { mode: 'custom', provider: 'relay', model: 'one' } } }); const baseline = await blocked.open()
  assert.equal((await blocked.call('models3-save-model', { sessionId: baseline.sessionId, originalModelId: 'one', modelId: 'renamed' })).error, 'removal-blocked')
  assert.equal(blocked.calls.length, 0)
})
test('adding a model to an unconfigured built-in writes only the models key', async () => {
  const env = host({ profiles: {}, catalog: { channelIds: new Set(['builtin']), channels: [{ id: 'builtin', name: 'Builtin', api: 'openai-completions', baseUrl: 'https://vendor.example/v1' }], byModelId: new Map() } })
  const opened = await env.call('models3-open', { route: 'builtin' })
  const saved = await env.call('models3-add-models', { sessionId: opened.value.sessionId, modelIds: ['extra'] })
  assert.equal(saved.ok, true, saved.error)
  assert.deepEqual(env.raw.providers.builtin, { models: [{ id: 'extra' }] })
  assert.deepEqual(env.calls[0].ops, [{ op: 'set', path: ['providers', 'builtin', 'models'], value: [{ id: 'extra' }] }])
})
test('renaming a disabled model is refused rather than silently enabling the new ID', async () => {
  const policy = { loading: Promise.resolve(), modelEnabled: (_provider, model) => model !== 'one' }
  const env = host({ providerAvailability: policy }); const opened = await env.open()
  const saved = await env.call('models3-save-model', { sessionId: opened.sessionId, originalModelId: 'one', modelId: 'new-id' })
  assert.equal(saved.error, 'disabled-model-rename')
  assert.equal(env.calls.length, 0)
  assert.equal(env.raw.providers.relay.models[0].id, 'one')
})
test('provider deletion preview includes exact primary and fallback conflicts', async () => {
  const env = host({ ref: { subagent: { mode: 'custom', provider: 'relay', model: 'one', fallbacks: [{ provider: 'relay', model: 'two' }] } } }); const opened = await env.open()
  const preview = await env.call('models3-remove-preview', { sessionId: opened.sessionId })
  assert.equal(preview.value.removeRoute, true)
  assert.equal(preview.value.blocked, true)
  assert.deepEqual(preview.value.references, [{ kind: 'subagent-route', provider: 'relay', model: 'one' }, { kind: 'subagent-fallback', provider: 'relay', model: 'two' }])
})
test('new Profile editor: restore preview refuses any subsequent external mutation', async () => {
  const env = host(); const opened = await env.open()
  assert.equal((await env.call('models3-save-model', { sessionId: opened.sessionId, modelId: 'one', patch: { name: 'Saved' } })).ok, true)
  env.raw.providers.relay.vendorExtra = false; env.bump()
  const preview = await env.call('models3-restore-preview', { route: 'relay' })
  assert.equal(preview.error, 'restore-conflict'); assert.equal(env.calls.length, 1)
})
test('new Profile editor: deletion survives list disappearance and restores complete non-sensitive profile', async () => {
  const env = host(); const before = clone(env.raw.providers.relay); const opened = await env.open()
  const preview = await env.call('models3-remove-preview', { sessionId: opened.sessionId })
  assert.equal((await env.call('models3-remove-commit', { planId: preview.value.planId })).ok, true)
  const list = await env.call('models3-snapshot')
  assert.equal(list.value.removedRoutes[0].route, 'relay')
  const rescue = await env.call('models3-restore-preview', { route: 'relay' })
  assert.equal((await env.call('models3-restore-commit', { planId: rescue.value.planId })).ok, true)
  assert.deepEqual(env.raw.providers.relay, before)
})
test('new Profile editor: handles cannot be replayed across operation kinds', async () => {
  const env = host(); const opened = await env.open()
  const remove = await env.call('models3-remove-preview', { sessionId: opened.sessionId })
  assert.equal((await env.call('models3-create-commit', { planId: remove.value.planId })).error, 'unknown-plan')
  const create = await env.call('models3-create-preview', { route: 'created', profile: { api: 'openai-completions', baseURL: 'http://localhost/v1', models: [{ id: 'new' }] } })
  assert.equal((await env.call('models3-remove-commit', { planId: create.value.planId })).error, 'unknown-plan')
  assert.equal(env.calls.length, 0)
})
test('new Profile editor: creation carries baseline and never writes credentials or makes discovery requests', async () => {
  const env = host()
  const preview = await env.call('models3-create-preview', { route: 'created', profile: { api: 'openai-completions', baseURL: 'http://localhost/v1', models: [{ id: 'new' }] } })
  assert.equal(preview.ok, true, preview.error); env.bump()
  const save = await env.call('models3-create-commit', { planId: preview.value.planId })
  assert.equal(save.error, 'conflict'); assert.equal(env.calls.length, 0); assert.equal(env.credentialCalls.length, 0)
})
test('new Profile editor: credential update is refused if baseline changes during snapshot persistence', async () => {
  let triggered = false
  const env = host({ storeMutate: async (_next, _state, controls) => { if (!triggered) { triggered = true; controls.bump() } } }); const opened = await env.open()
  const preview = await env.call('models3-credential-preview', { sessionId: opened.sessionId })
  const result = await env.call('models3-credential-commit', { planId: preview.value.planId, key: 'new' })
  assert.equal(result.error, 'conflict'); assert.equal(env.credentialCalls.length, 0); assert.equal(env.calls.length, 0)
})
test('new Profile editor: failed configuration after explicit shared key update reports actual effect and never unsets existing key', async () => {
  const env = host({ profiles: { relay: { apiKeyEnv: 'SHARED', api: 'openai-completions', models: [{ id: 'one' }] }, other: { apiKeyEnv: 'SHARED', models: [{ id: 'x' }] } }, secret: { SHARED: 'original' }, failSave: true })
  const opened = await env.open()
  const preview = await env.call('models3-credential-preview', { sessionId: opened.sessionId, shared: true })
  assert.deepEqual(preview.value.users, ['relay', 'other'])
  const saved = await env.call('models3-credential-commit', { planId: preview.value.planId, key: 'replacement' })
  assert.equal(saved.ok, true); assert.equal(saved.value.saved, false); assert.equal(saved.value.credentialStored, true)
  assert.equal(env.keys.SHARED, 'replacement'); assert.equal(JSON.stringify(saved).includes('replacement'), false)
})
test('new Profile editor: safe edits and restores retain sensitive headers without copying values to snapshots', async () => {
  const env = host({ profiles: { relay: { api: 'openai-completions', headers: { Authorization: 'TOP_SECRET', 'X-Public': 'yes' }, models: [{ id: 'one' }, { id: 'two' }] } } }); const opened = await env.open()
  assert.equal((await env.call('models3-save-model', { sessionId: opened.sessionId, modelId: 'one', patch: { name: 'Changed' } })).ok, true)
  assert.equal(JSON.stringify(env.state).includes('TOP_SECRET'), false)
  assert.equal(env.raw.providers.relay.headers.Authorization, 'TOP_SECRET')
  const preview = await env.call('models3-restore-preview', { route: 'relay' })
  assert.equal(preview.ok, true, preview.error)
  assert.equal(JSON.stringify(preview).includes('TOP_SECRET'), false)
  assert.equal((await env.call('models3-restore-commit', { planId: preview.value.planId })).ok, true)
  assert.equal(env.raw.providers.relay.headers.Authorization, 'TOP_SECRET')
  assert.equal(env.raw.providers.relay.models[0].name, undefined)
})
test('new Profile editor: reference alias is never treated as exact channel evidence', async () => {
  let queried
  const env = host({ smartFill: async (target) => { queried = target; return { groups: [], sources: [] } } })
  assert.equal((await env.call('models3-fill', { route: 'relay', modelId: 'one', referenceModelId: 'vendor/alias' })).ok, true)
  assert.equal(queried.modelId, 'vendor/alias'); assert.equal(queried.channel, ''); assert.equal(env.calls.length, 0)
})
test('new Profile editor: smart-fill queries never write draft/config and read-only candidates cannot be promoted', async () => {
  let queries = 0
  const env = host({ smartFill: async () => { queries++; return { groups: [{ field: 'contextWindow', options: [{ candidateId: 'cap', value: 128000, source: 'pi-ai', adoptable: true }] }, { field: 'reasoningEfforts', options: [{ candidateId: 'foreign', value: { high: 'not-for-this-channel' }, source: 'pi-ai', adoptable: false, readOnly: true }] }], sources: [] } } })
  assert.equal((await env.call('models3-fill', { route: 'relay', modelId: 'one', enabled: false })).value.mode, 'off')
  assert.equal(queries, 0)
  const filled = await env.call('models3-fill', { route: 'relay', modelId: 'one' })
  assert.equal(queries, 1); assert.equal(env.calls.length, 0)
  assert.deepEqual(filled.value.groups.map((x) => x.field), ['contextWindow'])
  assert.equal(filled.value.readonly[0].field, 'reasoningEfforts')
})
test('smart-fill DTO reports explicit reasoning support independently of missing level candidates', async () => {
  for (const supported of [true, false]) {
    const env = host({ smartFill: async () => ({ groups: [{ field: 'reasoningEfforts', supported, options: [] }], sources: [] }) })
    const filled = await env.call('models3-fill', { route: 'relay', modelId: 'one' })
    assert.equal(filled.value.reasoningSupported, supported)
    assert.deepEqual(filled.value.groups, [])
  }
})
test('new Profile editor: runtime test requires valid successful finish and uses saved single model', async () => {
  for (const chunks of [[], [{ type: 'text-delta', text: 'partial' }], [{ type: 'finish', reason: { kind: 'error' } }], [{ type: 'finish', reason: { kind: 'aborted' } }], [{ type: 'finish', reason: { kind: 'stop' } }], [{ type: 'text-delta', text: 'cut off' }, { type: 'finish', reason: { kind: 'max-tokens' } }], [{ type: 'block-end', block: { type: 'text', text: 'OK' } }, { type: 'finish', reason: { kind: 'stop' } }], [{ type: 'text-delta', text: 'OK' }, { type: 'finish', reason: { kind: 'stop' } }]]) {
    const env = host(); let requested
    env.services.llm = { stream: async function* (options) { requested = options; yield* chunks } }
    const opened = await env.open()
    const preview = await env.call('models3-test-preview', { sessionId: opened.sessionId, modelId: 'two' })
    const tested = await env.call('models3-test-commit', { planId: preview.value.planId })
    assert.equal(tested.value.ok, chunks.at(-1)?.reason?.kind === 'stop' && chunks.some((x) => x.type === 'text-delta' || x.type === 'block-end'))
    assert.equal(requested.model, 'two'); assert.deepEqual(requested.messages[0].content, [{ type: 'text', text: 'ping' }]); assert.equal(requested.maxTokens, 30000)
  }
})
test('model test records sanitized upstream failure and finish reason', async () => {
  const env = host()
  env.services.llm = { stream: async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM_ERROR', status: 404, message: 'Unknown model; authorization=Bearer sk-secret123 https://gateway.example?key=private' } } } } }
  const opened = await env.open()
  const preview = await env.call('models3-test-preview', { sessionId: opened.sessionId, modelId: 'two' })
  const result = await env.call('models3-test-commit', { planId: preview.value.planId })
  assert.equal(result.value.ok, false)
  assert.equal(result.value.finishReason, 'error')
  assert.equal(result.value.failure.code, 'UPSTREAM_ERROR')
  assert.equal(result.value.failure.status, 404)
  assert.equal(result.value.failure.stage, 'stream')
  assert.equal(JSON.stringify(result).includes('sk-secret123'), false)
  assert.equal(JSON.stringify(result).includes('gateway.example'), false)
  assert.deepEqual(env.state.validations.relay.failure, result.value.failure)
})

test('new Profile editor: default key replacement uses new independent reference and retains existing credential', async () => {
  const env = host({ profiles: { relay: { apiKeyEnv: 'SHARED', api: 'openai-completions', models: [{ id: 'one' }] } }, secret: { SHARED: 'original' } }); const opened = await env.open()
  const preview = await env.call('models3-credential-preview', { sessionId: opened.sessionId })
  assert.notEqual(preview.value.ref, 'SHARED')
  assert.equal((await env.call('models3-credential-commit', { planId: preview.value.planId, key: 'new-secret' })).ok, true)
  assert.equal(env.keys.SHARED, 'original'); assert.equal(env.raw.providers.relay.apiKeyEnv, preview.value.ref)
})
test('new Profile editor: snapshot returns only configured routes and provides unconfigured built-in templates', async () => {
  const env = host({ profiles: { relay: { api: 'openai-completions', models: [{ id: 'one' }] } } })
  const snapshot = await env.call('models3-snapshot')
  assert.equal(snapshot.ok, true)
  assert.deepEqual(snapshot.value.routes.map((r) => r.route), ['relay'])
  assert.deepEqual(snapshot.value.templates.map((t) => t.id), ['builtin'])
})
test('new Profile editor: creation with key writes credentials atomically during commit', async () => {
  const env = host()
  const preview = await env.call('models3-create-preview', {
    route: 'with-key',
    profile: { displayName: 'Keyed', api: 'openai-completions', baseURL: 'https://key.example/v1', models: [{ id: 'k1' }] },
    key: 'secret-api-key',
  })
  assert.equal(preview.ok, true)
  assert.equal(env.credentialCalls.length, 0, 'key is not written in preview')
  const commit = await env.call('models3-create-commit', { planId: preview.value.planId })
  assert.equal(commit.ok, true)
  assert.equal(commit.value.credentialStored, true)
  assert.equal(env.credentialCalls.length, 1)
  assert.equal(env.raw.providers['with-key'].apiKeyEnv, env.credentialCalls[0].id)
  assert.equal(env.keys[env.raw.providers['with-key'].apiKeyEnv], 'secret-api-key')
})
