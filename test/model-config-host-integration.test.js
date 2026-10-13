// Execute the installed SettingsForms lock callback and pi-ai schema, not a
// look-alike settings mock. Persistence below is isolated to this test's memory.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelConfigRoutes } from '../model-config-routes.js'
import { createProviderAvailability } from '../provider-availability.js'
import { pathToFileURL } from 'node:url'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { modelsProbeLookup } from '../model-workbench.js'
const root = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/'
let SettingsForms, Config
try {
  ;({ SettingsForms } = await import(pathToFileURL(root + 'dsh-settings/lib/index.js')))
  ;({ Config } = await import(pathToFileURL(root + 'dsh-llm-pi-ai/lib/index.js')))
} catch (_) {}
const clone = (value) => structuredClone(value)
function makeHost(services = {}) {
  const raw = { ordinary: { survives: true }, providers: { relay: { api: 'openai-completions', baseURL: 'http://localhost/v1', models: [{ id: 'one', name: 'Inherited Name', unknown: { untouched: true } }, { id: 'two' }], unknown: 4 } } }
  const inherited = { providers: { relay: { displayName: 'Inherited Provider', defaultContextWindow: 64000 } } }
  const entry = { id: 'loader-entry', options: { id: 'pi-profile', name: '@deepseek-ai/dsh-llm-pi-ai', config: raw }, fiber: { state: 2, uid: 'pi-owner', runtime: { Config }, config: null, ctx: { get: () => undefined } } }
  const reconcile = () => { const parsed = Config(raw); if (parsed instanceof Error) throw parsed; entry.fiber.config = parsed }
  reconcile()
  let lock = Promise.resolve(); let swaps = 0
  const editor = {
    entries: () => [entry],
    configuration: () => [{ entry, inherited: clone(inherited), override: clone(raw) }],
    edit: async (target, change) => {
      const work = lock.then(async () => { assert.equal(target, entry); const next = change(clone(raw), clone(inherited)); Config(next); raw.providers = next.providers; if (next.ordinary) raw.ordinary = next.ordinary; reconcile(); swaps++ })
      lock = work.catch(() => {}); return work
    },
  }
  const settings = Object.create(SettingsForms.prototype)
  settings.ownerContext = { configEditor: editor, emit() {} }
  settings.revisions = new Map(); settings.presentations = new Map()
  const state = { providers: {}, removed: {}, bindings: {}, validations: {}, recovery: {} }
  const workbenchStore = { load: async () => clone(state), mutate: async (fn) => { const next = clone(state); fn(next); Object.assign(state, next) } }
  const providerAvailability = createProviderAvailability(workbenchStore)
  const routes = createModelConfigRoutes({ ctx: { get: (key) => ({ settings, configEditor: editor, ...services })[key] }, workbenchStore, providerAvailability, loadPiCatalog: async () => ({ channelIds: new Set(), byModelId: new Map() }) })
  return { raw, entry, editor, settings, state, routes, count: () => swaps }
}
test('installed SettingsForms: saved Anthropic discovery resolves credentials without writing configuration', { skip: !SettingsForms || !Config }, async (t) => {
  let ref
  const host = makeHost({ credentials: { resolve: async (key) => { ref = key; return { value: 'isolated-secret' } } } })
  Object.assign(host.raw.providers.relay, { api: 'anthropic-messages', baseURL: 'https://gateway.example/api/v1', apiKeyEnv: 'ISOLATED_KEY' })
  const before = clone(host.raw)
  t.mock.method(modelsProbeLookup, 'impl', async () => [{ address: '8.8.8.8', family: 4 }])
  let options
  t.mock.method(https, 'request', (requestOptions, callback) => {
    options = requestOptions
    const request = new EventEmitter()
    request.destroy = (error) => { if (error) request.emit('error', error) }
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.resume = () => {}
      callback(response)
      response.emit('data', Buffer.from(JSON.stringify({ data: [{ id: 'claude-example', display_name: 'Claude Example' }] })))
      response.emit('end')
    })
    return request
  })
  const opened = await host.routes['models3-open'].handle({ route: 'relay' })
  const result = await host.routes['models3-discover'].handle({ sessionId: opened.value.sessionId })
  assert.equal(result.ok, true, result.error)
  assert.equal(ref, 'ISOLATED_KEY')
  assert.equal(options.path, '/api/v1/models?limit=1000')
  assert.equal(options.headers['x-api-key'], 'isolated-secret')
  assert.equal(options.headers.authorization, undefined)
  assert.deepEqual(result.value.candidates, [{ id: 'claude-example', name: 'Claude Example' }])
  assert.equal(JSON.stringify(result).includes('isolated-secret'), false)
  assert.deepEqual(host.raw, before); assert.equal(host.count(), 0)
})

test('installed SettingsForms: saved openai-responses discovery uses saved credentials and never mutates the profile', { skip: !SettingsForms || !Config }, async (t) => {
  let resolvedRef; let options
  const host = makeHost({ credentials: { resolve: async (key) => { resolvedRef = key; return { value: 'responses-isolated-secret' } } } })
  Object.assign(host.raw.providers.relay, { api: 'openai-responses', baseURL: 'https://gateway.example/prefix/v1', apiKeyEnv: 'RESPONSES_KEY' })
  const before = clone(host.raw)
  t.mock.method(modelsProbeLookup, 'impl', async () => [{ address: '8.8.8.8', family: 4 }])
  t.mock.method(https, 'request', (requestOptions, callback) => {
    options = requestOptions
    const request = new EventEmitter()
    request.destroy = (error) => { if (error) request.emit('error', error) }
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter(); response.statusCode = 200; response.resume = () => {}
      callback(response); response.emit('data', Buffer.from(JSON.stringify({ data: [{ id: 'gpt-responses-example', name: 'Responses Example' }] }))); response.emit('end')
    })
    return request
  })
  const opened = await host.routes['models3-open'].handle({ route: 'relay' })
  const result = await host.routes['models3-discover'].handle({ sessionId: opened.value.sessionId })
  assert.equal(result.ok, true, result.error)
  assert.equal(resolvedRef, 'RESPONSES_KEY')
  assert.equal(options.path, '/prefix/v1/models')
  assert.equal(options.method, 'GET')
  assert.equal(options.headers.authorization, 'Bearer responses-isolated-secret')
  assert.equal(options.headers['x-api-key'], undefined)
  assert.deepEqual(result.value.candidates, [{ id: 'gpt-responses-example', name: 'Responses Example' }])
  assert.equal(JSON.stringify(result).includes('responses-isolated-secret'), false)
  assert.deepEqual(host.raw, before); assert.equal(host.count(), 0)
})
test('installed SettingsForms: availability preview/commit retains complete profile and rejects stale plans', { skip: !SettingsForms || !Config }, async () => {
  const host = makeHost()
  const before = clone(host.raw)
  const opened = await host.routes['models3-open'].handle({ route: 'relay' })
  const preview = await host.routes['models3-enabled-preview'].handle({ sessionId: opened.value.sessionId, enabled: false })
  assert.equal(preview.ok, true)
  assert.equal(host.state.disabledProviders, undefined)
  const committed = await host.routes['models3-enabled-commit'].handle({ planId: preview.value.planId })
  assert.equal(committed.ok, true)
  assert.equal(host.state.disabledProviders.relay, true)
  assert.deepEqual(host.raw, before)
  const snapshot = await host.routes['models3-snapshot'].handle({})
  assert.equal(snapshot.value.routes[0].enabled, false)
  const stale = await host.routes['models3-enabled-preview'].handle({ sessionId: opened.value.sessionId, enabled: true })
  host.raw.providers.relay.external = true
  const rejected = await host.routes['models3-enabled-commit'].handle({ planId: stale.value.planId })
  assert.equal(rejected.error, 'conflict')
  assert.equal(host.state.disabledProviders.relay, true)
})

test('installed SettingsForms: real schema writes keep unknown keys, inherited defaults and guarded revision', { skip: !SettingsForms || !Config }, async () => {
  const host = makeHost()
  const opened = await host.routes['models3-open'].handle({ route: 'relay' })
  assert.equal(opened.ok, true, opened.error)
  const changed = await host.routes['models3-save-model'].handle({ sessionId: opened.value.sessionId, modelId: 'one', patch: { contextWindow: 128000, compat: { supportsStore: false } }, unset: ['name'] })
  assert.equal(changed.ok, true, changed.error)
  assert.equal(host.raw.providers.relay.models[0].name, undefined)
  assert.deepEqual(host.raw.providers.relay.models[0].unknown, { untouched: true })
  assert.equal(host.raw.providers.relay.unknown, 4)
  assert.deepEqual(host.raw.ordinary, { survives: true })
  assert.equal(host.raw.providers.relay.defaultMaxTokens, undefined, 'Effective schema defaults stay out of raw writes')
  const reopened = await host.routes['models3-open'].handle({ route: 'relay' })
  host.raw.providers.relay.extraExternal = true
  const conflict = await host.routes['models3-save-route'].handle({ sessionId: reopened.value.sessionId, patch: { displayName: 'lost' } })
  assert.equal(conflict.error, 'conflict'); assert.equal(host.count(), 1)
})
test('installed SettingsForms: unset restores the inherited scalar instead of deleting it', { skip: !SettingsForms || !Config }, async () => {
  const host = makeHost(); host.raw.providers.relay.defaultContextWindow = 128000
  const opened = await host.routes['models3-open'].handle({ route: 'relay' })
  const save = await host.routes['models3-save-route'].handle({ sessionId: opened.value.sessionId, patch: {}, unset: ['defaultContextWindow'] })
  assert.equal(save.ok, true, save.error); assert.equal(host.raw.providers.relay.defaultContextWindow, 64000)
  const restore = await host.routes['models3-restore-preview'].handle({ route: 'relay' })
  assert.equal(restore.ok, true, restore.error)
})
test('installed SettingsForms: callback within write queue rejects a revision changed after snapshot I/O', { skip: !SettingsForms || !Config }, async () => {
  const host = makeHost()
  const captured = host.settings.describe()[0].revision
  host.raw.providers.relay.unknown = 5
  await assert.rejects(host.settings.mutate('pi-profile', [{ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'lost' }], captured), { name: 'SettingsConflictError' })
  assert.equal(host.raw.providers.relay.displayName, undefined); assert.equal(host.count(), 0)
})
