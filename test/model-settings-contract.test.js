// Modern model-configuration contract regressions for model-workbench-settings.js.
//
// Covers the P0/P1 requirements: raw/explicit/inherited/effective surfaces stay separate, the
// owner (package + dynamic Profile entry id) and revision are captured before any await, duplicate
// / inactive / invalid owners and expression-backed configuration fail closed at every depth,
// display DTOs never leak headers/secrets, and the opaque baseline fingerprint binds the complete
// raw config to the owner identity so a stale baseline cannot be written into another owner.
//
// The last test reads the *installed* host packages to pin the assumptions (entry id/raw config
// layout, `__jsExpr` serialization, expectedRevision conflict) and is skipped when the checkout
// layout is unavailable.

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SENSITIVE_MASK,
  modelSettingsFor,
  redactSensitive,
} from '../model-workbench-settings.js'

const PACKAGE = '@deepseek-ai/dsh-llm-pi-ai'
const NS = 'llm-pi-ai'

/** Minimal modern host: configEditor.configuration() + settings.describe()/mutate(). */
function modernHost({
  ns = 'tenant-models',
  raw = { providers: {} },
  explicit = {},
  inherited = {},
  effective,
  revision = 7,
  fiberState = 2,
  loaderEntries,
  describe,
} = {}) {
  const state = {
    revision,
    raw: structuredClone(raw),
    entry: undefined,
    rows: undefined,
  }
  state.entry = { options: { id: ns, name: PACKAGE, config: state.raw }, fiber: { state: fiberState } }
  const row = { entry: state.entry, override: structuredClone(explicit), inherited: structuredClone(inherited) }
  state.rows = [row]
  const writes = []
  const settings = {
    describe: describe ?? (() => [{
      ns,
      revision: state.revision,
      ...(effective === undefined ? {} : { value: structuredClone(effective) }),
    }]),
    mutate: async (target, ops, expected) => {
      if (expected !== state.revision) {
        const error = new Error('settings namespace changed')
        error.name = 'SettingsConflictError'
        error.code = 'SETTINGS_CONFLICT'
        throw error
      }
      writes.push({ target, ops, expected })
      for (const op of ops) {
        const parent = op.path.slice(0, -1).reduce((node, key) => (node[key] ??= {}), state.raw)
        if (op.op === 'unset') delete parent[op.path.at(-1)]
        else parent[op.path.at(-1)] = structuredClone(op.value)
      }
      state.revision += 1
    },
  }
  const editor = { configuration: () => state.rows }
  const loader = loaderEntries === undefined ? undefined : { entries: () => loaderEntries() }
  const ctx = { get: (key) => ({ settings, configEditor: editor, loader })[key] }
  return {
    ctx, state, row, writes, settings, editor,
    setRows: (rows) => { state.rows = rows },
    replaceOwner: (entry, layers = {}) => {
      state.rows = [{ entry, override: layers.override ?? {}, inherited: layers.inherited ?? {} }]
    },
  }
}

function newEntry(ns, raw = { providers: {} }, fiberState = 2) {
  return { options: { id: ns, name: PACKAGE, config: raw }, fiber: { state: fiberState } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner identity and separated surfaces
// ─────────────────────────────────────────────────────────────────────────────

test('contract: dynamic owner identity and complete raw baseline are captured by package', () => {
  const raw = {
    ordinary: { keep: 1 },
    providers: { relay: { displayName: 'Relay', headers: { 'X-Trace': 't' }, models: [{ id: 'm1' }] } },
  }
  const explicit = { providers: { relay: { displayName: 'Relay' } } }
  const inherited = { providers: { builtin: { api: 'openai-completions' } } }
  const effective = { providers: { relay: { displayName: 'Relay', defaultMaxTokens: 32768 } } }
  const host = modernHost({ ns: 'acme-gateway', raw, explicit, inherited, effective, revision: 11 })

  const access = modelSettingsFor(host.ctx)
  assert.equal(access.namespace, 'acme-gateway')
  assert.deepEqual(access.identity, { mode: 'modern', package: PACKAGE, entryId: 'acme-gateway', entryName: PACKAGE })
  assert.equal(access.revision, 11)
  assert.equal(access.revisionTracked, true)

  // raw is the complete merged config (write baseline); unknown keys survive.
  assert.deepEqual(access.raw(), raw)
  assert.deepEqual(access.raw().ordinary, { keep: 1 })
  // explicit / inherited are distinct layers, never merged into raw.
  assert.deepEqual(access.explicit(), explicit)
  assert.deepEqual(access.inherited(), inherited)
  // effective is the host projection with defaults and is never the write baseline.
  assert.equal(access.effective().providers.relay.defaultMaxTokens, 32768)
  assert.equal(access.raw().providers.relay.defaultMaxTokens, undefined)

  assert.equal(access.inheritedRoute('builtin'), true)
  assert.equal(access.inheritedRoute('relay'), false)

  // Every accessor is a detached snapshot.
  access.raw().providers.relay.models[0].id = 'mutated'
  access.explicit().providers.relay.displayName = 'mutated'
  assert.equal(host.state.raw.providers.relay.models[0].id, 'm1')
  assert.equal(host.row.override.providers.relay.displayName, 'Relay')
})

test('contract: legacy facade still speaks the fixed llm-pi-ai namespace and exposes no dynamic id', () => {
  const host = modernHost({ ns: 'acme-gateway', raw: { providers: { relay: { models: [] } } }, revision: 3 })
  const access = modelSettingsFor(host.ctx)
  // model-workbench-routes.js reads the revision back through describe(['llm-pi-ai']).
  assert.deepEqual(access.describe(), [{ ns: NS, revision: 3 }])
  assert.equal(access.get(NS).providers.relay.models.length, 0)
  assert.equal(access.get('other-namespace'), undefined)
  assert.throws(() => access.mutate('other-namespace', []), { code: 'model-config-unavailable' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Opaque baseline fingerprint
// ─────────────────────────────────────────────────────────────────────────────

test('contract: baseline fingerprint is opaque, deterministic, identity-bound and change-sensitive', () => {
  const raw = { providers: { relay: { models: [{ id: 'm1', name: 'One' }] } } }
  const first = modelSettingsFor(modernHost({ ns: 'tenant-a', raw: structuredClone(raw) }).ctx)
  const sameShape = modelSettingsFor(modernHost({ ns: 'tenant-a', raw: structuredClone(raw) }).ctx)
  const otherEntry = modelSettingsFor(modernHost({ ns: 'tenant-b', raw: structuredClone(raw) }).ctx)
  const changed = modelSettingsFor(modernHost({
    ns: 'tenant-a',
    raw: { providers: { relay: { models: [{ id: 'm1', name: 'Two' }] } } },
  }).ctx)

  assert.match(first.fingerprint(), /^sha256:[0-9a-f]{64}$/)
  assert.equal(first.fingerprint(), sameShape.fingerprint(), 'same owner + same raw is deterministic')
  assert.notEqual(first.fingerprint(), otherEntry.fingerprint(), 'the entry id is part of the fingerprint')
  assert.notEqual(first.fingerprint(), changed.fingerprint(), 'a nested raw change moves the fingerprint')

  const reorderedA = modelSettingsFor(modernHost({ ns: 'tenant-a', raw: { a: 1, b: { x: [1, 2] } } }).ctx)
  const reorderedB = modelSettingsFor(modernHost({ ns: 'tenant-a', raw: { b: { x: [1, 2] }, a: 1 } }).ctx)
  assert.equal(reorderedA.fingerprint(), reorderedB.fingerprint(), 'key order does not matter')

  assert.deepEqual(first.baseline(), {
    mode: 'modern',
    package: PACKAGE,
    entryId: 'tenant-a',
    entryName: PACKAGE,
    revision: 7,
    revisionTracked: true,
    fingerprint: first.fingerprint(),
  })
})

test('contract: a cyclic or non-cloneable raw config cannot become a baseline', () => {
  const cyclic = { providers: {} }
  cyclic.self = cyclic
  assert.throws(() => modelSettingsFor(modernHost({ raw: cyclic }).ctx), { code: 'model-config-invalid-config' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Revision / owner capture across asynchronous work
// ─────────────────────────────────────────────────────────────────────────────

test('contract: a captured revision is never re-read after asynchronous work', async () => {
  const host = modernHost({ raw: { providers: { relay: { models: [] } } }, revision: 4 })
  const access = modelSettingsFor(host.ctx)
  host.state.revision = 5 // concurrent write happened while we awaited
  await Promise.resolve()
  await assert.rejects(
    access.mutate(NS, [{ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'lost' }]),
    { code: 'SETTINGS_CONFLICT' },
  )
  assert.equal(host.writes.length, 0)
})

test('contract: the baseline still belongs to the captured owner after asynchronous work', async () => {
  const host = modernHost({ raw: { providers: { relay: { models: [] } } }, revision: 2 })
  const access = modelSettingsFor(host.ctx)
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.doesNotThrow(() => access.assertOwner())
  await access.mutate(NS, [{ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'ok' }])
  assert.equal(host.writes.length, 1)
  assert.equal(host.writes[0].expected, 2, 'the captured revision travelled with the write')
})

test('contract: a replaced Profile entry (same id) invalidates the captured baseline', async () => {
  const host = modernHost({ ns: 'tenant-models', raw: { providers: {} } })
  const access = modelSettingsFor(host.ctx)
  await Promise.resolve()
  host.replaceOwner(newEntry('tenant-models', { providers: { other: {} } }))
  assert.throws(() => access.assertOwner(), { code: 'model-config-owner-changed' })
  assert.throws(() => access.mutate(NS, [{ op: 'set', path: ['providers', 'x'], value: {} }]), { code: 'model-config-owner-changed' })
  assert.equal(host.writes.length, 0)
})

test('contract: a re-addressed entry id invalidates the captured baseline', async () => {
  const host = modernHost({ ns: 'tenant-models', raw: { providers: {} } })
  const access = modelSettingsFor(host.ctx)
  host.replaceOwner(newEntry('renamed-models', { providers: {} }))
  assert.throws(() => access.assertOwner(), { code: 'model-config-owner-changed' })
  assert.throws(() => access.mutate(NS, [{ op: 'set', path: ['providers', 'x'], value: {} }]), { code: 'model-config-owner-changed' })
})

test('contract: an owner that goes inactive invalidates the captured baseline', () => {
  const host = modernHost({ raw: { providers: {} } })
  const access = modelSettingsFor(host.ctx)
  host.state.entry.fiber.state = 1
  assert.throws(() => access.assertOwner(), { code: 'model-config-inactive' })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fail closed: duplicate / inactive / invalid owners
// ─────────────────────────────────────────────────────────────────────────────

test('contract: multiple pi-ai owners fail closed as ambiguous', () => {
  const host = modernHost({ raw: { providers: {} } })
  host.setRows([
    { entry: newEntry('a'), override: {}, inherited: {} },
    { entry: newEntry('b'), override: {}, inherited: {} },
  ])
  assert.throws(() => modelSettingsFor(host.ctx), { code: 'model-config-ambiguous' })
})

test('contract: a duplicated entry id hidden from configuration() is still reported as ambiguous', () => {
  const host = modernHost({
    ns: 'dup-id',
    raw: { providers: {} },
    loaderEntries: () => [
      { options: { id: 'dup-id', name: PACKAGE, config: {} } },
      { options: { id: 'dup-id', name: PACKAGE, config: {} } },
    ],
  })
  assert.throws(() => modelSettingsFor(host.ctx), { code: 'model-config-ambiguous' })
})

test('contract: an inactive owner is refused instead of written', () => {
  assert.throws(() => modelSettingsFor(modernHost({ fiberState: 1 }).ctx), { code: 'model-config-inactive' })
})

test('contract: an invalid owner namespace is refused', () => {
  assert.throws(() => modelSettingsFor(modernHost({ ns: '' }).ctx), { code: 'model-config-invalid-owner' })
  const host = modernHost({ raw: { providers: {} } })
  host.state.entry.options.id = 42
  assert.throws(() => modelSettingsFor(host.ctx), { code: 'model-config-invalid-owner' })
})

test('contract: missing services, missing descriptor and unsafe revisions fail closed', () => {
  assert.throws(() => modelSettingsFor({ get: () => undefined }), { code: 'model-config-unavailable' })
  assert.throws(() => modelSettingsFor({ get: (key) => (key === 'settings' ? {} : undefined) }), { code: 'model-config-unavailable' })
  assert.throws(
    () => modelSettingsFor(modernHost({ describe: () => [] }).ctx),
    { code: 'model-config-unavailable' },
  )
  assert.throws(
    () => modelSettingsFor(modernHost({ describe: () => [{ ns: 'tenant-models', revision: 1.5 }] }).ctx),
    { code: 'model-config-unavailable' },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Fail closed: expression-backed configuration at any depth
// ─────────────────────────────────────────────────────────────────────────────

const expressionShapes = {
  'root config': () => ({ __jsExpr: 'process.env.CONFIG' }),
  'providers dict': () => ({ providers: { __jsExpr: 'load()' } }),
  'single route': () => ({ providers: { relay: { __jsExpr: 'route()' } } }),
  'model entry': () => ({ providers: { relay: { models: [{ __jsExpr: 'model()' }] } } }),
  'nested unknown field': () => ({ providers: { relay: { models: [{ id: 'm', compat: { deep: { __jsExpr: 'x' } } }] } } }),
  'non-string marker': () => ({ providers: { relay: { __jsExpr: 3 } } }),
}

for (const [label, makeRaw] of Object.entries(expressionShapes)) {
  test(`contract: expression-backed configuration fails closed at ${label}`, () => {
    assert.throws(() => modelSettingsFor(modernHost({ raw: makeRaw() }).ctx), { code: 'model-config-expression' })
  })
}

test('contract: expression-backed inherited / explicit / effective layers fail closed', () => {
  assert.throws(
    () => modelSettingsFor(modernHost({ inherited: { providers: { relay: { __jsExpr: '$ENV' } } } }).ctx),
    { code: 'model-config-expression' },
  )
  assert.throws(
    () => modelSettingsFor(modernHost({ explicit: { providers: { relay: { __jsExpr: '$ENV' } } } }).ctx),
    { code: 'model-config-expression' },
  )
  assert.throws(
    () => modelSettingsFor(modernHost({ effective: { providers: { relay: { __jsExpr: '$ENV' } } } }).ctx),
    { code: 'model-config-expression' },
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Display DTOs never leak headers/secrets
// ─────────────────────────────────────────────────────────────────────────────

test('contract: display DTOs mask sensitive headers/secrets while the raw baseline keeps them', () => {
  const secrets = {
    providers: {
      relay: {
        apiKeyEnv: 'RELAY_API_KEY',
        apiKey: 'sk-live-123',
        token: 'tok',
        headers: {
          Authorization: 'Bearer abc',
          authorization: 'Bearer lower',
          'X-Api-Key': 'k',
          Cookie: 'c=1',
          'Proxy-Authorization': 'Basic x',
          'X-Auth-Token': 't',
          'Set-Cookie': 's=1',
          'X-Goog-Api-Key': 'g',
          'X-Secret-Thing': 'hidden',
          'Content-Type': 'application/json',
        },
        models: [{ id: 'm', compat: { apiKey: 'nested-secret', keep: true } }],
      },
    },
  }
  const host = modernHost({ raw: secrets })
  const access = modelSettingsFor(host.ctx)
  const display = access.display()

  for (const name of ['Authorization', 'authorization', 'X-Api-Key', 'Cookie', 'Proxy-Authorization', 'X-Auth-Token', 'Set-Cookie', 'X-Goog-Api-Key', 'X-Secret-Thing']) {
    assert.equal(display.raw.providers.relay.headers[name], SENSITIVE_MASK, `${name} must be masked`)
  }
  assert.equal(display.raw.providers.relay.headers['Content-Type'], 'application/json', 'ordinary headers stay readable')
  assert.equal(display.raw.providers.relay.apiKey, SENSITIVE_MASK)
  assert.equal(display.raw.providers.relay.token, SENSITIVE_MASK)
  assert.equal(display.raw.providers.relay.models[0].compat.apiKey, SENSITIVE_MASK)
  assert.equal(display.raw.providers.relay.models[0].compat.keep, true)
  // apiKeyEnv is the *name* of a credential record, not a secret value.
  assert.equal(display.raw.providers.relay.apiKeyEnv, 'RELAY_API_KEY')

  // The write baseline keeps the real values; only the display projection is masked.
  assert.equal(access.raw().providers.relay.headers.Authorization, 'Bearer abc')
  assert.equal(access.get(NS).providers.relay.apiKey, 'sk-live-123')
  // redaction is pure: the source is untouched.
  assert.equal(secrets.providers.relay.headers.Authorization, 'Bearer abc')
  assert.equal(redactSensitive(secrets).providers.relay.headers.Authorization, SENSITIVE_MASK)
})

test('contract: display() reports an absent effective layer as undefined, not a fabricated default', () => {
  const access = modelSettingsFor(modernHost({ effective: undefined }).ctx)
  assert.equal(access.effective(), undefined)
  assert.equal(access.display().effective, undefined)
  assert.deepEqual(access.display().inherited, {})
})

// ─────────────────────────────────────────────────────────────────────────────
// Legacy namespace facade: revision handling and unsafe-write rejection
// ─────────────────────────────────────────────────────────────────────────────

function legacyHost({ section, revision, describe = true, mutateArity = 2 } = {}) {
  const calls = []
  const settings = {
    get: () => section,
  }
  if (describe) settings.describe = () => (revision === undefined ? [] : [{ ns: NS, revision, value: { providers: {} } }])
  if (mutateArity >= 3) {
    settings.mutate = async function mutate(ns, ops, expected) { calls.push({ ns, ops, expected }); return 'ok' }
  } else {
    settings.mutate = async function mutate(ns, ops) { calls.push({ ns, ops }); return 'ok' }
  }
  return { ctx: { get: (key) => (key === 'settings' ? settings : undefined) }, settings, calls }
}

test('contract: a revision-capable legacy host carries the captured revision into the write', async () => {
  const host = legacyHost({ section: { providers: { relay: { models: [] } } }, revision: 9, mutateArity: 3 })
  const access = modelSettingsFor(host.ctx)
  assert.equal(access.namespace, NS)
  assert.equal(access.identity.mode, 'legacy')
  assert.equal(access.revisionTracked, true)
  await access.mutate(NS, [{ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'R' }])
  assert.deepEqual(host.calls, [{ ns: NS, ops: [{ op: 'set', path: ['providers', 'relay', 'displayName'], value: 'R' }], expected: 9 }])
})

test('contract: a pre-revision legacy host keeps the compatible revision-less write', async () => {
  const host = legacyHost({ section: { providers: {} }, describe: false, mutateArity: 2 })
  const access = modelSettingsFor(host.ctx)
  assert.equal(access.revisionTracked, false)
  await access.mutate(NS, [{ op: 'set', path: ['providers', 'x'], value: {} }])
  assert.equal(host.calls.length, 1)
  assert.equal(host.calls[0].ns, NS)
  assert.equal('expected' in host.calls[0], false, 'no revision argument is fabricated')
})

test('contract: a legacy host advertising a revision parameter but exposing none rejects writes', async () => {
  const host = legacyHost({ section: { providers: {} }, describe: false, mutateArity: 3 })
  const access = modelSettingsFor(host.ctx)
  assert.equal(access.revisionTracked, false)
  assert.throws(
    () => access.mutate(NS, [{ op: 'set', path: ['providers', 'x'], value: {} }]),
    { code: 'model-config-revision-unavailable' },
  )
  assert.equal(host.calls.length, 0)
})

test('contract: a legacy host advertising describe but no revision row rejects writes', async () => {
  const host = legacyHost({ section: { providers: {} }, revision: undefined, describe: true, mutateArity: 3 })
  const access = modelSettingsFor(host.ctx)
  assert.throws(() => access.mutate(NS, []), { code: 'model-config-revision-unavailable' })
  assert.equal(host.calls.length, 0)
})

test('contract: legacy invalid or failing sections fail closed', () => {
  const arraySection = legacyHost({ section: ['not', 'an', 'object'] })
  assert.throws(() => modelSettingsFor(arraySection.ctx), { code: 'model-config-invalid-section' })

  const throwing = { get: (key) => (key === 'settings' ? { get: () => { throw new Error('boom') } } : undefined) }
  assert.throws(() => modelSettingsFor(throwing), { code: 'model-config-unavailable' })

  const expression = legacyHost({ section: { providers: { relay: { __jsExpr: 'x' } } } })
  assert.throws(() => modelSettingsFor(expression.ctx), { code: 'model-config-expression' })
})

test('contract: legacy get(NS) defaults to an empty provider table and inheritedRoute stays false', () => {
  const host = legacyHost({ section: undefined, describe: false })
  const access = modelSettingsFor(host.ctx)
  assert.deepEqual(access.get(NS), { providers: {} })
  assert.equal(access.inheritedRoute('anything'), false)
  assert.equal(access.display().effective, undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// Installed-host contract (skipped when the checkout layout is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

const installedRoot = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const configEditorPath = join(installedRoot, 'dsh-config-editor/lib/index.js')
const settingsPath = join(installedRoot, 'dsh-settings/lib/index.js')

test('contract: the installed host still exposes the entry/raw/expression assumptions', {
  skip: !existsSync(configEditorPath) || !existsSync(settingsPath) ? 'installed host source not found' : false,
}, () => {
  const editor = readFileSync(configEditorPath, 'utf8')
  assert.match(editor, /configuration\(\)/, 'configEditor.configuration() is the owner source')
  assert.match(editor, /entry\.options\.config/, 'entry.options.config is the raw merged config')
  assert.match(editor, /__jsExpr/, 'expression config is serialized as __jsExpr')
  assert.match(editor, /entry\.options\.id/, 'entry.options.id is the addressable namespace')
  assert.match(editor, /entries\(\)/, 'configEditor.entries() deduplicates duplicate ids')

  const settings = readFileSync(settingsPath, 'utf8')
  assert.match(settings, /expectedRevision/, 'settings.mutate compares the expected revision')
  assert.match(settings, /SettingsConflictError/, 'a revision mismatch raises SettingsConflictError')
})
