// Two-stage "forget" of recently removed channel records: host-only contract.
// The preview shows safe consequences and pins one removal snapshot token; the
// commit deletes exactly that record inside the serialized sidecar write and
// never touches channels, credentials or other records.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModelConfigRoutes } from '../model-config-routes.js'
import { createWorkbenchStore, profileFingerprint, WORKBENCH_PLAN_TTL_MS, WORKBENCH_SIDECAR_FILE, WORKBENCH_SIDECAR_VERSION } from '../model-workbench.js'

const clone = (value) => structuredClone(value)

/** Sidecar snapshot written by the removal path: route-scoped, non-sensitive, token-pinned. */
function removedEntry(token, overrides = {}) {
  return {
    kind: 'removed',
    token,
    before: {
      displayName: 'Relay Old',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1/v1',
      models: [{ id: 'one' }, { id: 'two' }],
    },
    after: null,
    expectedAfter: profileFingerprint(null),
    protectedHeaders: false,
    baseline: 'fingerprint-before-removal',
    at: 1700000000000,
    status: 'applied',
    ...overrides,
  }
}

/** In-memory sidecar store with the same load/mutate contract as the real one. */
function memoryStore(sidecar = {}) {
  const state = clone({ providers: {}, removed: {}, bindings: {}, validations: {}, undo: {}, recovery: {}, ...sidecar })
  return {
    state,
    load: async () => clone(state),
    mutate: async (work) => {
      const next = clone(state)
      const outcome = await work(next)
      for (const key of Object.keys(state)) delete state[key]
      Object.assign(state, next)
      return outcome
    },
  }
}

function host({ profiles = {}, sidecar = {}, store, credentials = {}, providerAvailability } = {}) {
  const raw = { providers: clone(profiles) }
  let revision = 1
  const settingsCalls = []
  const entry = { options: { id: 'forget-owner', name: '@deepseek-ai/dsh-llm-pi-ai', config: raw }, fiber: { state: 2, uid: 'forget-owner' } }
  const settings = {
    describe: () => [{ ns: entry.options.id, revision, value: { providers: raw.providers } }],
    mutate: async (ns, ops, expected) => {
      // Forget is a sidecar-only operation: any configuration write is a defect.
      settingsCalls.push({ ns, ops, expected })
      throw new Error('settings-must-not-be-written-by-forget')
    },
  }
  const keys = clone(credentials)
  const credentialCalls = []
  const credentialService = {
    describe: async (id) => ({ configured: Object.hasOwn(keys, id), writable: true }),
    set: async (id, key) => { credentialCalls.push({ id, action: 'set' }); keys[id] = key },
    resolve: async (id) => ({ value: keys[id] }),
    readRecord: async (id) => Object.hasOwn(keys, id) ? { kind: 'api-key', key: keys[id] } : undefined,
    unset: async (id) => { credentialCalls.push({ id, action: 'unset' }); throw new Error('credentials must never be deleted by forget') },
  }
  const workbenchStore = store ?? memoryStore(sidecar)
  const services = { settings, configEditor: { configuration: () => [{ entry, inherited: {}, override: raw }] }, credentials: credentialService }
  const ctx = new Proxy({ get: (id) => services[id] }, { get: (target, key) => { if (key !== 'get') throw new Error('undeclared service'); return target[key] } })
  const routes = createModelConfigRoutes({ ctx, workbenchStore, providerAvailability })
  return {
    raw,
    store: workbenchStore,
    settingsCalls,
    keys,
    credentialCalls,
    call: async (id, data) => routes[id].handle(data),
  }
}

test('forget preview exposes only safe consequences and commit deletes exactly the pinned record', async () => {
  const sidecar = {
    removed: {
      relay: removedEntry('record-relay', {
        before: {
          displayName: 'Relay Old',
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1/v1',
          apiKeyEnv: 'RELAY_KEY',
          headers: { Authorization: 'SECRET-HEADER-VALUE' },
          models: [{ id: 'one' }, { id: 'two' }],
        },
      }),
      other: removedEntry('record-other', { before: { displayName: 'Other', models: [{ id: 'x' }] }, at: 1700000000001 }),
    },
    providers: { relay: { kind: 'transaction', token: 'edit-relay', before: { displayName: 'Before Edit' }, status: 'applied' } },
    recovery: { relay: { pending: true } },
    validations: { relay: { ok: false, at: 5 } },
    bindings: { relay: { 'openai-completions': { one: { sourceId: 'source-1' } } } },
    disabledProviders: { other: true },
  }
  const env = host({ profiles: { live: { api: 'openai-completions', models: [{ id: 'live' }] } }, sidecar, credentials: { RELAY_KEY: 'secret-value' } })
  const untouched = clone(env.store.state)

  const preview = await env.call('models3-forget-preview', { route: 'relay' })
  assert.equal(preview.ok, true, preview.error)
  assert.equal(typeof preview.value.planId, 'string')
  assert.ok(preview.value.planId.length > 0)
  assert.equal(preview.value.route, 'relay')
  assert.equal(preview.value.displayName, 'Relay Old')
  assert.equal(preview.value.removedAt, 1700000000000)
  assert.equal(preview.value.modelCount, 2)
  assert.equal(preview.value.irreversible, true)
  assert.equal(preview.value.channelRetained, true)
  assert.equal(preview.value.credentialRetained, true)
  assert.equal(preview.value.otherRemovedRecordsRetained, true)
  const wire = JSON.stringify(preview)
  assert.equal(wire.includes('SECRET-HEADER-VALUE'), false, 'header values never cross the RPC')
  assert.equal(wire.includes('secret-value'), false, 'credential values never cross the RPC')
  assert.equal(wire.includes('RELAY_KEY'), false, 'the preview is a display-name/consequence DTO only')
  assert.equal(wire.includes('record-relay'), false, 'the pinned token stays host-side')
  assert.equal(wire.includes('"before"'), false)
  assert.equal(env.settingsCalls.length, 0, 'preview does not write configuration')
  assert.deepEqual(env.store.state, untouched, 'preview does not modify the sidecar')

  const commit = await env.call('models3-forget-commit', { planId: preview.value.planId })
  assert.equal(commit.ok, true, commit.error)
  assert.equal(commit.value.route, 'relay')
  assert.equal(commit.value.forgotten, true)
  assert.equal(commit.value.channelRetained, true)
  assert.equal(commit.value.credentialRetained, true)
  assert.equal(commit.value.otherRemovedRecordsRetained, true)
  assert.equal(Object.hasOwn(env.store.state.removed, 'relay'), false)
  assert.deepEqual(env.store.state.removed.other, untouched.removed.other)
  assert.deepEqual(env.store.state.providers, untouched.providers, 'channel snapshots are not touched')
  assert.deepEqual(env.store.state.recovery, untouched.recovery)
  assert.deepEqual(env.store.state.validations, untouched.validations)
  assert.deepEqual(env.store.state.bindings, untouched.bindings)
  assert.deepEqual(env.store.state.disabledProviders, untouched.disabledProviders)
  assert.deepEqual(env.raw.providers, { live: { api: 'openai-completions', models: [{ id: 'live' }] } }, 'no channel configuration is read or written')
  assert.deepEqual(env.keys, { RELAY_KEY: 'secret-value' }, 'credentials are retained')
  assert.equal(env.credentialCalls.length, 0, 'credentials are never described, set or unset')
  assert.equal(env.settingsCalls.length, 0)

  const replay = await env.call('models3-forget-commit', { planId: preview.value.planId })
  assert.equal(replay.error, 'unknown-plan', 'a handle is single-use')
})

test('forget refuses invalid routes and records that are not exact removal snapshots', async () => {
  const sidecar = {
    providers: {
      edited: { kind: 'transaction', token: 'transaction-edit', before: { displayName: 'Edited' } },
      live: { kind: 'transaction', token: 'live-token' },
    },
    removed: {
      pending: { kind: 'transaction', token: 'transaction-pending', before: { displayName: 'In flight' } },
      ghost: { kind: 'removed', token: 'removed-ghost', before: null },
      legacy: { kind: 'removed', profile: { displayName: 'Legacy' }, displayName: 'Legacy', at: 1 },
      tokenless: { kind: 'removed', before: { displayName: 'No token' }, at: 2 },
    },
  }
  const env = host({ sidecar })
  const untouched = clone(env.store.state)
  for (const route of [undefined, '', '__proto__', 'constructor', 'prototype', 'x'.repeat(129), 42, null, {}]) {
    const result = await env.call('models3-forget-preview', route === undefined ? {} : { route })
    assert.equal(result.error, 'bad-route', String(route))
  }
  for (const route of ['edited', 'live', 'pending', 'ghost', 'legacy', 'tokenless', 'absent']) {
    const result = await env.call('models3-forget-preview', { route })
    assert.equal(result.error, 'nothing-to-forget', route)
  }
  assert.deepEqual(env.store.state, untouched)
  assert.equal(env.settingsCalls.length, 0)
  assert.equal((await env.call('models3-forget-commit', { planId: 'fabricated' })).error, 'unknown-plan')
})

test('forget handles cannot be replayed across operation kinds and only matching plans commit', async () => {
  const profiles = { relay: { api: 'openai-completions', baseURL: 'http://127.0.0.1/v1', models: [{ id: 'one' }, { id: 'two' }] } }
  const sidecar = {
    removed: {
      gone: removedEntry('record-gone', { before: { displayName: 'Gone', models: [{ id: 'g' }] } }),
      relay: removedEntry('record-relay'),
    },
  }
  const providerAvailability = { loading: Promise.resolve(), enabled: () => true, setModel: async () => ({}), modelEnabled: () => true }
  const env = host({ profiles, sidecar, providerAvailability })
  const opened = await env.call('models3-open', { route: 'relay' })
  assert.equal(opened.ok, true, opened.error)

  const forget = await env.call('models3-forget-preview', { route: 'gone' })
  assert.equal(forget.ok, true, forget.error)
  for (const endpoint of ['models3-remove-commit', 'models3-restore-commit', 'models3-create-commit', 'models3-credential-commit', 'models3-enabled-commit', 'models3-test-commit']) {
    assert.equal((await env.call(endpoint, { planId: forget.value.planId })).error, 'unknown-plan', endpoint)
  }

  const restore = await env.call('models3-restore-preview', { route: 'gone' })
  assert.equal(restore.ok, true, restore.error)
  const remove = await env.call('models3-remove-preview', { sessionId: opened.value.sessionId })
  assert.equal(remove.ok, true, remove.error)
  const create = await env.call('models3-create-preview', { route: 'brand-new', profile: { api: 'openai-completions', baseURL: 'http://localhost/v1', models: [{ id: 'new' }] } })
  assert.equal(create.ok, true, create.error)
  const credential = await env.call('models3-credential-preview', { sessionId: opened.value.sessionId })
  assert.equal(credential.ok, true, credential.error)
  const enabled = await env.call('models3-enabled-preview', { sessionId: opened.value.sessionId, enabled: false })
  assert.equal(enabled.ok, true, enabled.error)
  const probe = await env.call('models3-test-preview', { sessionId: opened.value.sessionId, modelId: 'one' })
  assert.equal(probe.ok, true, probe.error)
  for (const planId of [restore.value.planId, remove.value.planId, create.value.planId, credential.value.planId, enabled.value.planId, probe.value.planId]) {
    assert.equal((await env.call('models3-forget-commit', { planId })).error, 'unknown-plan')
  }

  assert.equal(env.store.state.removed.gone.token, 'record-gone')
  assert.equal(env.store.state.removed.relay.token, 'record-relay')
  assert.equal(env.settingsCalls.length, 0)
  assert.equal(env.credentialCalls.length, 0)
})

test('forget never deletes a record replaced by a concurrent re-removal', async () => {
  const env = host({ sidecar: { removed: { relay: removedEntry('record-old'), other: removedEntry('record-other') } } })
  const preview = await env.call('models3-forget-preview', { route: 'relay' })
  assert.equal(preview.ok, true, preview.error)

  const newer = removedEntry('record-new', { before: { displayName: 'Relay New', models: [{ id: 'z' }] }, at: 1700000099999 })
  env.store.state.removed.relay = clone(newer)
  const conflict = await env.call('models3-forget-commit', { planId: preview.value.planId })
  assert.equal(conflict.error, 'forget-conflict')
  assert.deepEqual(env.store.state.removed.relay, newer, 'the concurrently replaced record survives')
  assert.equal(env.store.state.removed.other.token, 'record-other')
  assert.equal(env.settingsCalls.length, 0)

  const again = await env.call('models3-forget-preview', { route: 'relay' })
  assert.equal(again.value.displayName, 'Relay New', 'the fresh preview reflects the replacement')
  assert.equal((await env.call('models3-forget-commit', { planId: again.value.planId })).ok, true)
  assert.equal(Object.hasOwn(env.store.state.removed, 'relay'), false)
  assert.equal(env.store.state.removed.other.token, 'record-other')
})

test('forget refuses a record restored away after preview without recreating it', async () => {
  const env = host({ sidecar: { removed: { relay: removedEntry('record-relay') } } })
  const untouched = clone(env.store.state)
  const preview = await env.call('models3-forget-preview', { route: 'relay' })
  delete env.store.state.removed.relay
  const conflict = await env.call('models3-forget-commit', { planId: preview.value.planId })
  assert.equal(conflict.error, 'forget-conflict')
  assert.deepEqual(env.store.state.removed, {})
  assert.deepEqual(env.store.state.providers, untouched.providers, 'no channel is created or edited')
  assert.equal(env.settingsCalls.length, 0)
  assert.equal(env.credentialCalls.length, 0)
})

test('forget: two handles for one record yield exactly one deletion', async () => {
  const env = host({ sidecar: { removed: { relay: removedEntry('record-relay') } } })
  const first = await env.call('models3-forget-preview', { route: 'relay' })
  const second = await env.call('models3-forget-preview', { route: 'relay' })
  assert.notEqual(first.value.planId, second.value.planId)
  assert.equal((await env.call('models3-forget-commit', { planId: first.value.planId })).ok, true)
  assert.equal((await env.call('models3-forget-commit', { planId: second.value.planId })).error, 'forget-conflict')
  assert.deepEqual(env.store.state.removed, {})
})

test('forget commit is serialized against queued sidecar writes and persists atomically', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-forget-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = createWorkbenchStore(dir)
  await store.mutate((state) => {
    state.providers.relay = { kind: 'transaction', token: 'edit-relay', before: { displayName: 'Edit' }, status: 'applied' }
    state.removed.relay = removedEntry('record-relay')
    state.removed.other = removedEntry('record-other', { before: { displayName: 'Other' } })
    state.recovery.other = { reason: 'pending' }
    state.validations.other = { ok: true, at: 3 }
  })
  const env = host({ store })
  const preview = await env.call('models3-forget-preview', { route: 'relay' })
  assert.equal(preview.ok, true, preview.error)

  // A re-removal queued on the same store must land before the forget write and
  // make its token stale; the commit may not delete the newer record.
  const replacement = store.mutate((state) => { state.removed.relay = removedEntry('record-new', { before: { displayName: 'Relay New' } }) })
  const conflict = await env.call('models3-forget-commit', { planId: preview.value.planId })
  await replacement
  assert.equal(conflict.error, 'forget-conflict')

  const file = join(dir, WORKBENCH_SIDECAR_FILE)
  let disk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(disk.removed.relay.token, 'record-new')
  assert.equal((await createWorkbenchStore(dir).load()).removed.relay.token, 'record-new', 'the replacement is durable')

  const retry = await env.call('models3-forget-preview', { route: 'relay' })
  assert.equal(retry.value.displayName, 'Relay New')
  const committed = await env.call('models3-forget-commit', { planId: retry.value.planId })
  assert.equal(committed.ok, true, committed.error)

  disk = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(disk.schemaVersion, WORKBENCH_SIDECAR_VERSION)
  assert.equal(Object.hasOwn(disk.removed, 'relay'), false)
  assert.equal(disk.removed.other.token, 'record-other')
  assert.deepEqual(disk.providers.relay, { kind: 'transaction', token: 'edit-relay', before: { displayName: 'Edit' }, status: 'applied' })
  assert.deepEqual(disk.recovery.other, { reason: 'pending' })
  assert.deepEqual(disk.validations.other, { ok: true, at: 3 })
  assert.equal((await stat(file)).mode & 0o777, 0o600, 'sidecar stays owner-only')

  const reloaded = createWorkbenchStore(dir)
  assert.equal(Object.hasOwn((await reloaded.load()).removed, 'relay'), false)
  const fresh = host({ store: reloaded })
  assert.equal((await fresh.call('models3-forget-preview', { route: 'relay' })).error, 'nothing-to-forget', 'the deletion is durable')
})

test('forget reports a sidecar save failure without advancing state or consuming the handle', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-forget-fail-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = createWorkbenchStore(dir)
  await store.mutate((state) => { state.removed.relay = removedEntry('record-relay') })
  const env = host({ store })
  const preview = await env.call('models3-forget-preview', { route: 'relay' })
  assert.equal(preview.ok, true, preview.error)

  // Force the atomic temporary-file rename to fail: the sidecar path becomes a directory.
  await rm(join(dir, WORKBENCH_SIDECAR_FILE))
  await mkdir(join(dir, WORKBENCH_SIDECAR_FILE))
  const failed = await env.call('models3-forget-commit', { planId: preview.value.planId })
  assert.equal(failed.error, 'operation-failed')
  assert.equal((await store.load()).removed.relay.token, 'record-relay', 'state is not advanced without a durable write')
  assert.equal(env.settingsCalls.length, 0)

  // The failure does not consume the handle: once persistence works again the same plan commits.
  await rm(join(dir, WORKBENCH_SIDECAR_FILE), { recursive: true, force: true })
  const retry = await env.call('models3-forget-commit', { planId: preview.value.planId })
  assert.equal(retry.ok, true, retry.error)
  assert.equal(Object.hasOwn((await store.load()).removed, 'relay'), false)
})

test('forget rejects an expired handle before reading or writing the sidecar', async (t) => {
  const env = host({ sidecar: { removed: { relay: removedEntry('record-relay') } } })
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const preview = await env.call('models3-forget-preview', { route: 'relay' })
  assert.equal(preview.ok, true, preview.error)
  t.mock.timers.tick(WORKBENCH_PLAN_TTL_MS + 1)
  const expired = await env.call('models3-forget-commit', { planId: preview.value.planId })
  assert.equal(expired.error, 'plan-expired')
  assert.equal(env.store.state.removed.relay.token, 'record-relay')
  assert.equal(env.settingsCalls.length, 0)
})
