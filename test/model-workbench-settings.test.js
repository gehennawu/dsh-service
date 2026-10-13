import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { modelSettingsFor } from '../model-workbench-settings.js'
import { readLlmProfiles } from '../model-workbench.js'
import { createModelWorkbenchRoutes } from '../model-workbench-routes.js'

const packageName = '@deepseek-ai/dsh-llm-pi-ai'
function modernHost({ ns = 'my-models', profiles = {}, inherited = {}, extra = {} } = {}) {
  let revision = 4
  const raw = { ...extra, providers: structuredClone(profiles) }
  const writes = []
  const entry = { options: { id: ns, name: packageName, config: raw } }
  const settings = {
    // The resolved form includes defaults which must NEVER enter the write baseline.
    describe: () => [{ ns, revision, value: { providers: Object.fromEntries(Object.entries(raw.providers).map(([id, row]) => [id, { defaultMaxTokens: 32768, ...row }])) } }],
    mutate: async (target, ops, expected) => {
      assert.equal(target, ns)
      if (expected !== revision) { const error = new Error('stale'); error.code = 'SETTINGS_CONFLICT'; throw error }
      const next = structuredClone(raw)
      for (const op of ops) {
        let parent = next
        for (const key of op.path.slice(0, -1)) parent = parent[key] ??= {}
        if (op.op === 'unset') delete parent[op.path.at(-1)]
        else parent[op.path.at(-1)] = structuredClone(op.value)
      }
      raw.providers = next.providers
      writes.push({ target, ops, expected }); revision++
    },
  }
  const editor = { configuration: () => [{ entry, inherited, override: raw }] }
  const ctx = { get: (key) => ({ settings, configEditor: editor })[key] }
  const state = { providers: {}, removed: {}, recovery: {}, validations: {} }
  const store = { load: async () => structuredClone(state), mutate: async (fn) => { fn(state) } }
  const routes = createModelWorkbenchRoutes({
    ctx, randomUUID, workbenchStore: store,
    loadPiCatalog: async () => ({ channels: [], channelIds: new Set(), byModelId: new Map(), byHost: new Map() }),
    loadSubagentRoute: async () => ({ mode: 'inherit' }), loadAgentDefaultModelSelection: () => undefined,
  })
  return { ctx, settings, editor, entry, raw, routes, writes, store, bump: () => revision++ }
}
const profiles = () => ({ relay: { api: 'openai-completions', baseURL: 'https://relay.example/v1', apiKeyEnv: 'RELAY_KEY', vendorExtra: { preserve: true }, models: [{ id: 'one', compat: { vendor: true }, unknown: 3 }, { id: 'two' }] } })

test('model settings: Profile entry id is resolved by package, raw unknown fields survive and defaults stay inherited', async () => {
  const host = modernHost({ profiles: profiles(), extra: { ordinary: { keep: 1 } } })
  const access = modelSettingsFor(host.ctx)
  assert.equal(access.namespace, 'my-models')
  const row = readLlmProfiles(access)[0]
  assert.deepEqual(row.vendorExtra, { preserve: true })
  assert.equal(row.defaultMaxTokens, undefined)
  row.models[0].compat.vendor = false
  assert.equal(host.raw.providers.relay.models[0].compat.vendor, true, 'read snapshots are detached')
  await access.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'Relay' }])
  assert.deepEqual(host.raw.ordinary, { keep: 1 })
  assert.equal(host.raw.providers.relay.defaultMaxTokens, undefined)
  assert.deepEqual(host.writes[0].expected, 4)
})

test('model settings: captured revision rejects writes after asynchronous work rather than re-reading it', async () => {
  const host = modernHost({ profiles: profiles() })
  const access = modelSettingsFor(host.ctx)
  host.bump()
  await assert.rejects(access.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'lost' }]), { code: 'SETTINGS_CONFLICT' })
  assert.equal(host.writes.length, 0)
})

test('model settings: multiple, inactive, missing and expression-backed owners fail closed', () => {
  const host = modernHost()
  const original = host.editor.configuration
  host.editor.configuration = () => [...original(), { entry: { options: { id: 'other', name: packageName, config: {} } }, inherited: {} }]
  assert.throws(() => modelSettingsFor(host.ctx), /model-config-ambiguous/)
  host.editor.configuration = () => []
  assert.throws(() => modelSettingsFor(host.ctx), /model-config-unavailable/)
  host.editor.configuration = original
  host.settings.describe = () => []
  assert.throws(() => modelSettingsFor(host.ctx), /model-config-unavailable/)
  const expression = modernHost()
  expression.raw.providers = { __jsExpr: 'process.env.CONFIG' }
  assert.throws(() => modelSettingsFor(expression.ctx), /model-config-expression/)
})

test('model routes: modern host reads, edits, removes and restores the complete raw route without materializing defaults', async () => {
  const host = modernHost({ profiles: profiles() })
  const before = structuredClone(host.raw.providers.relay)
  const detail = await host.routes['models2-route'].handle({ route: 'relay' })
  assert.equal(detail.ok, true)
  const patched = await host.routes['models2-model-patch'].handle({ route: 'relay', modelId: 'one', patch: { contextWindow: 128000 } })
  assert.equal(patched.ok, true, patched.error)
  assert.equal(host.raw.providers.relay.models[0].unknown, 3)
  assert.deepEqual(host.raw.providers.relay.models[1], before.models[1])
  const saved = structuredClone(host.raw.providers.relay)
  const preview = await host.routes['models2-route-remove-preview'].handle({ route: 'relay' })
  const removed = await host.routes['models2-route-remove-commit'].handle({ route: 'relay', baseFingerprint: preview.value.fingerprint })
  assert.equal(removed.ok, true, removed.error)
  assert.equal(host.raw.providers.relay, undefined)
  const restored = await host.routes['models2-route-restore'].handle({ route: 'relay' })
  assert.equal(restored.ok, true, restored.error)
  assert.deepEqual(host.raw.providers.relay, saved)
  assert.equal(host.writes.every(({ target }) => target === 'my-models'), true)
})

test('model routes: inherited route deletion is refused instead of resetting to bundle defaults', async () => {
  const host = modernHost({ profiles: profiles(), inherited: { providers: profiles() } })
  const preview = await host.routes['models2-route-remove-preview'].handle({ route: 'relay' })
  assert.equal(preview.value.blocked, true)
  const removed = await host.routes['models2-route-remove-commit'].handle({ route: 'relay', baseFingerprint: preview.value.fingerprint })
  assert.equal(removed.error, 'model-config-inherited-route')
  assert.equal(host.writes.length, 0)
})
