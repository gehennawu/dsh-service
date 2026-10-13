// Versioned model configuration access. Display forms are never a write baseline.
//
// Two host generations, one facade:
//   * legacy (settings.get exists, <=0.1.6): the namespace is the fixed string `llm-pi-ai`,
//     `settings.get(ns)` is the raw section, `settings.describe()` may expose a revision.
//   * modern (>=0.1.7, no settings.get): `configEditor.configuration()` resolves the
//     `@deepseek-ai/dsh-llm-pi-ai` Profile entry. `entry.options.id` is the *dynamic* namespace
//     (the Profile patch id, not the fixed `llm-pi-ai`), `entry.options.config` is the complete
//     raw merged config (the only safe write baseline), `override` is the explicit layer,
//     `inherited` the inherited layer, and `settings.describe().value` the effective projection
//     (bundle defaults merged in) which must NEVER be written back.
//
// Verified against the installed 0.2.1-alpha.2 host:
//   dsh-settings/lib/index.js:413-537   describe() revision + mutate(ns, ops, expected) inside the
//                                       write queue (mismatch throws SettingsConflictError); unset
//                                       re-materializes the inherited value.
//   dsh-config-editor/lib/index.js:30-135 configuration()/entries() (duplicate ids are dropped by
//                                       entries(), unique inclusion-owned ids only) and edit(),
//                                       which re-checks entry identity inside the file lock and
//                                       serializes any `{__jsExpr}` node back to a YAML `!js` tag.
//   dsh-llm-pi-ai/lib/index.js:1050-1080  provider schema: headers is a free string dict.
//
// Safety posture: raw/explicit/inherited/effective never share one surface; the owner (package +
// entry id) and revision are captured synchronously before any await; duplicate/inactive/invalid
// owners and expression-backed configuration at any depth fail closed; display DTOs redact
// sensitive headers/secrets; an opaque fingerprint binds the complete raw config to the owner
// identity so a baseline can be re-checked after asynchronous work.

import { createHash } from 'node:crypto'

const PACKAGE = '@deepseek-ai/dsh-llm-pi-ai'
const NS = 'llm-pi-ai'
const EXPRESSION_KEY = '__jsExpr'

/** Value substituted for sensitive headers/fields in display DTOs. */
export const SENSITIVE_MASK = '[redacted]'

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const clone = (value) => structuredClone(value)

/** Detached copy of host-provided config; non-cloneable values are unusable as a baseline. */
function cloneConfig(value) {
  try { return structuredClone(value) } catch (_) { throw fail('model-config-invalid-config') }
}

/** Coded, fail-closed error. The message is the code so callers can match on either. */
function fail(code) {
  const error = new Error(code)
  error.code = code
  return error
}

// ─────────────────────────────────────────────────────────────────────────────
// Expression-backed configuration (fail closed)
// ─────────────────────────────────────────────────────────────────────────────

/** config-editor serializes a YAML `!js` node back to `{ __jsExpr: "<source>" }`. */
function hasExpression(value, seen = new Set()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return false
    seen.add(value)
    const found = value.some((item) => hasExpression(item, seen))
    seen.delete(value)
    return found
  }
  if (!object(value)) return false
  if (seen.has(value)) return false
  seen.add(value)
  let found = Object.hasOwn(value, EXPRESSION_KEY)
  if (!found) for (const child of Object.values(value)) if (hasExpression(child, seen)) { found = true; break }
  seen.delete(value)
  return found
}

/** Any expression anywhere (root, providers, a route, a model entry) forbids a literal rewrite. */
function assertLiteral(config) {
  if (hasExpression(config)) throw fail('model-config-expression')
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensitive-value redaction for display interfaces
// ─────────────────────────────────────────────────────────────────────────────

const normalizeKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, '')

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'setcookie', 'xapikey', 'apikey',
  'xauthtoken', 'authtoken', 'xaccesstoken', 'accesstoken', 'xgoogapikey',
  'xamzsecuritytoken', 'xcsrftoken', 'xsrftoken',
])

/** Header names are matched case-insensitively and separator-insensitively, plus common suffixes. */
export function isSensitiveHeaderName(name) {
  if (typeof name !== 'string' || name === '') return false
  const normalized = normalizeKey(name)
  if (SENSITIVE_HEADER_KEYS.has(normalized)) return true
  return normalized.endsWith('authorization') || normalized.endsWith('apikey') ||
    normalized.endsWith('token') || normalized.endsWith('cookie') || normalized.includes('secret')
}

const SENSITIVE_FIELD_KEYS = new Set([
  'apikey', 'apikeys', 'token', 'tokens', 'secret', 'secrets', 'password', 'passwd',
  'authorization', 'cookie', 'credential', 'credentials', 'privatekey', 'accesskey',
  'clientsecret', 'apitoken', 'authtoken', 'bearer', 'sessionkey',
])

/**
 * `apiKeyEnv` is intentionally NOT masked: it is the *name* of a host credential record, not a
 * secret value. Only names that denote a secret themselves are masked.
 */
function isSensitiveFieldName(name) {
  if (typeof name !== 'string' || name === '') return false
  return SENSITIVE_FIELD_KEYS.has(normalizeKey(name))
}

/** Return a detached copy with sensitive header/field values masked. Keys are always preserved. */
export function redactSensitive(value, inHeaders = false) {
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, inHeaders))
  if (!object(value)) return value
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (inHeaders) {
      out[key] = isSensitiveHeaderName(key) ? SENSITIVE_MASK : redactSensitive(child, false)
      continue
    }
    if (isSensitiveFieldName(key)) { out[key] = SENSITIVE_MASK; continue }
    out[key] = redactSensitive(child, normalizeKey(key) === 'headers')
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// Opaque baseline fingerprint (complete raw config + owner identity)
// ─────────────────────────────────────────────────────────────────────────────

const UNDEFINED_TAG = '\u0000__undef__'

/** Deterministic, type-aware serialization; unknown value types fail closed. */
function canonicalString(value, seen = new Set()) {
  if (value === undefined) return UNDEFINED_TAG
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'string') return JSON.stringify(value)
  if (type === 'boolean' || type === 'bigint') return `${type}:${String(value)}`
  if (type === 'number') return `number:${String(value)}`
  if (type !== 'object') throw fail('model-config-invalid-config')
  if (seen.has(value)) throw fail('model-config-invalid-config')
  seen.add(value)
  let out
  if (Array.isArray(value)) {
    out = `[${value.map((item) => canonicalString(item, seen)).join(',')}]`
  } else {
    out = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalString(value[key], seen)}`).join(',')}}`
  }
  seen.delete(value)
  return out
}

/** sha256 over the owner identity plus the complete raw config; opaque and order-independent. */
function baselineFingerprint(identity, raw) {
  const payload = canonicalString({
    package: identity.package,
    entryId: identity.entryId,
    entryName: identity.entryName ?? null,
    mode: identity.mode,
    raw,
  })
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner resolution
// ─────────────────────────────────────────────────────────────────────────────

function ownerEntry(row) {
  return row?.entry
}

function isPiAiEntry(entry) {
  return entry?.options?.name === PACKAGE
}

/**
 * Modern owner: exactly one active, inclusion-owned entry named PACKAGE with a non-empty string id.
 * A duplicate id makes configEditor.entries() drop both rows, so the raw Loader list is consulted
 * (when reachable) to report the ambiguity instead of a generic unavailability.
 */
function resolveModernOwner(ctx, editor) {
  if (typeof editor?.configuration !== 'function') throw fail('model-config-unavailable')
  let rows
  try { rows = editor.configuration() } catch (_) { throw fail('model-config-unavailable') }
  if (!Array.isArray(rows)) throw fail('model-config-unavailable')

  const owners = rows.filter((row) => isPiAiEntry(ownerEntry(row)))
  const loader = typeof ctx?.get === 'function' ? ctx.get('loader') : undefined
  if (loader !== undefined && typeof loader.entries === 'function') {
    let named
    try { named = [...loader.entries()].filter(isPiAiEntry) } catch (_) { named = undefined }
    if (Array.isArray(named)) {
      const ids = named.map((entry) => entry?.options?.id)
      const duplicated = ids.some((id, index) => ids.indexOf(id) !== index)
      if (duplicated || named.length > 1) throw fail('model-config-ambiguous')
    }
  }
  if (owners.length > 1) throw fail('model-config-ambiguous')
  if (owners.length === 0) throw fail('model-config-unavailable')

  const row = owners[0]
  const entry = ownerEntry(row)
  const ns = entry?.options?.id
  if (typeof ns !== 'string' || ns === '' || ns.length > 128) throw fail('model-config-invalid-owner')
  if (entry.fiber !== undefined && entry.fiber.state !== 2) throw fail('model-config-inactive')
  return { entry, ns, row }
}

/** Re-resolve the modern owner and require the exact same Loader entry instance and id. */
function assertSameModernOwner(ctx, editor, captured) {
  let rows
  try { rows = editor.configuration() } catch (_) { throw fail('model-config-owner-changed') }
  if (!Array.isArray(rows)) throw fail('model-config-owner-changed')
  const owners = rows.filter((row) => isPiAiEntry(ownerEntry(row)))
  if (owners.length !== 1) throw fail('model-config-owner-changed')
  const entry = ownerEntry(owners[0])
  if (entry !== captured.entry || entry?.options?.id !== captured.ns) throw fail('model-config-owner-changed')
  if (entry.fiber !== undefined && entry.fiber.state !== 2) throw fail('model-config-inactive')
}

// ─────────────────────────────────────────────────────────────────────────────
// Facade
// ─────────────────────────────────────────────────────────────────────────────

function facade({
  settings, ns, mode, entryName, raw, explicit, inherited, effective, revision,
  verifyOwner,
}) {
  const revisionTracked = Number.isSafeInteger(revision)
  const identity = Object.freeze({ mode, package: PACKAGE, entryId: ns, entryName: entryName ?? null })
  const fingerprint = baselineFingerprint(identity, raw)

  const access = {
    namespace: ns,
    revision,
    revisionTracked,
    identity,
    get owner() { return { ...identity } },

    // ── separated layers (detached snapshots; raw is the write baseline) ──
    raw: () => clone(raw),
    explicit: () => clone(explicit),
    inherited: () => clone(inherited),
    effective: () => effective === undefined ? undefined : clone(effective),

    // ── display DTO: the only interface a UI/route should project, secrets masked ──
    display: () => ({
      namespace: ns,
      mode,
      revision,
      revisionTracked,
      raw: redactSensitive(raw),
      explicit: redactSensitive(explicit),
      inherited: redactSensitive(inherited),
      effective: effective === undefined ? undefined : redactSensitive(effective),
    }),

    // ── opaque baseline ──
    fingerprint: () => fingerprint,
    baseline: () => ({
      ...identity,
      revision: revisionTracked ? revision : null,
      revisionTracked,
      fingerprint,
    }),

    // Legacy facade shape consumed by model-workbench-routes.js: `get`/`describe`/`mutate`
    // always speak the fixed `llm-pi-ai` namespace, while `namespace`/`identity` expose the
    // resolved host entry id.
    get: (key) => key === NS ? clone(raw) : undefined,
    describe: () => [{ ns: NS, revision }],
    inheritedRoute: (route) => object(inherited.providers) && Object.hasOwn(inherited.providers, route),

    /** Re-check this baseline still belongs to the captured owner (safe after async work). */
    assertOwner: () => { verifyOwner(); return { ...identity } },

    /**
     * Carry the captured revision by default, including creation and compensation.
     * Re-reading the revision after credential/sidecar I/O would reopen the TOCTOU gap.
     */
    mutate: (key, ops, expected = revision) => {
      if (key !== NS) throw fail('model-config-unavailable')
      if (typeof settings.mutate !== 'function') throw fail('model-config-unavailable')
      if (!revisionTracked) {
        // A host that advertises a revision parameter but exposes none cannot be written safely:
        // reject instead of silently degrading to an unguarded write.
        if (settings.mutate.length >= 3) throw fail('model-config-revision-unavailable')
        // Documented pre-revision host: keep compatibility; the profile fingerprint gate upstream
        // still guards the content window.
        return settings.mutate(ns, ops)
      }
      verifyOwner()
      return settings.mutate(ns, ops, expected)
    },
  }
  return access
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/** Capture one request's raw configuration, identity and revision before any awaits.
 * <=0.1.6 uses namespaces; >=0.1.7 uses addressable Profile entries. Ambiguous, inactive or
 * expression-backed owners fail closed instead of accidentally modifying another adapter.
 */
export function modelSettingsFor(ctx) {
  const settings = ctx.get('settings')
  if (settings === undefined) throw fail('model-config-unavailable')

  // ── legacy namespace host ──
  if (typeof settings.get === 'function') {
    let section
    try { section = settings.get(NS) } catch (_) { throw fail('model-config-unavailable') }
    if (section !== undefined && !object(section)) throw fail('model-config-invalid-section')
    const raw = cloneConfig(section ?? { providers: {} })
    assertLiteral(raw)

    let revision
    let effective
    const describe = typeof settings.describe === 'function' ? settings.describe : undefined
    if (describe !== undefined) {
      let descriptors
      try { descriptors = describe.call(settings) } catch (_) { descriptors = undefined }
      const row = Array.isArray(descriptors) ? descriptors.find((item) => item?.ns === NS) : undefined
      if (row !== undefined) {
        if (Number.isSafeInteger(row.revision)) revision = row.revision
        if (row.value !== undefined) effective = cloneConfig(row.value)
      }
    }
    if (effective !== undefined) assertLiteral(effective)

    return facade({
      settings,
      ns: NS,
      mode: 'legacy',
      entryName: PACKAGE,
      raw,
      explicit: raw,
      inherited: {},
      effective,
      revision,
      verifyOwner: () => {},
    })
  }

  // ── modern Profile entry host ──
  const editor = ctx.get('configEditor')
  if (typeof editor?.configuration !== 'function' || typeof settings.describe !== 'function') {
    throw fail('model-config-unavailable')
  }
  const { entry, ns, row } = resolveModernOwner(ctx, editor)

  let descriptors
  try { descriptors = settings.describe() } catch (_) { throw fail('model-config-unavailable') }
  if (!Array.isArray(descriptors)) throw fail('model-config-unavailable')
  const descriptor = descriptors.find((item) => item.ns === ns)
  if (descriptor === undefined || !Number.isSafeInteger(descriptor.revision)) throw fail('model-config-unavailable')

  const raw = cloneConfig(entry.options.config ?? {})
  const explicit = cloneConfig(row.override ?? {})
  const inherited = cloneConfig(row.inherited ?? {})
  assertLiteral(raw)
  assertLiteral(explicit)
  assertLiteral(inherited)
  const effective = descriptor.value === undefined ? undefined : cloneConfig(descriptor.value)
  if (effective !== undefined) assertLiteral(effective)

  const captured = { entry, ns }
  return facade({
    settings,
    ns,
    mode: 'modern',
    entryName: entry.options.name,
    raw,
    explicit,
    inherited,
    effective,
    revision: descriptor.revision,
    verifyOwner: () => assertSameModernOwner(ctx, editor, captured),
  })
}
