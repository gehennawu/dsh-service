import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMetadataCache, createSourceFetcher, loadPiEvidenceFromDir, querySmartFill } from './model-smart-fill.js'
import { modelSettingsFor, redactSensitive } from './model-workbench-settings.js'
import { loadPiAiCatalog, locateDshPackageJson, profileFingerprint, selfCheckModelsPatch, fetchModelsProbe, deriveKeyRefFor, MODEL_ID_RE, MODELS_ROUTE_RE, MODELS_KEY_REF_RE, WORKBENCH_PLAN_TTL_MS } from './model-workbench.js'
import { MODEL_FIELDS, ROUTE_FIELDS, PROTOCOLS, object, displayProfile, containsSensitive, sensitiveHeader, patchFields, schemaVocabulary, validateField } from './model-config-schema.js'

const clone = (value) => structuredClone(value)
const has = (value, key) => object(value) && Object.hasOwn(value, key)
const error = (code) => { throw new Error(code) }
const conflict = (failure) => failure?.code === 'SETTINGS_CONFLICT' || failure?.name === 'SettingsConflictError'
const builtin = (catalog, route) => catalog.channelIds.has(route)
const fingerprint = (access) => profileFingerprint({ baseline: access.fingerprint?.() ?? access.get('llm-pi-ai'), namespace: access.namespace, revision: access.revision })
const validRoute = (route) => typeof route === 'string' && route.length > 0 && route.length <= 128 && !/[\p{Cc}]/u.test(route) && !['__proto__', 'constructor', 'prototype'].includes(route)
const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? value[key] : undefined
const setOwn = (value, key, child) => { Object.defineProperty(value, key, { value: child, writable: true, enumerable: true, configurable: true }); return child }
const routeRaw = (access, route) => validRoute(route) ? own(access.get('llm-pi-ai')?.providers, route) : undefined
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 512 && MODEL_ID_RE.test(id)

// Only a bounded diagnostic summary crosses the RPC/persistence boundary.
export function modelTestFailure(failure, fallback = 'stream-failed') {
  const code = typeof failure?.code === 'string' && /^[a-z0-9_-]{1,80}$/i.test(failure.code) ? failure.code : fallback
  const message = typeof failure?.message === 'string' ? failure.message
    .replace(/\b(?:Bearer\s+\S+|sk-[a-z0-9_-]+)\b/gi, '<REDACTED>')
    .replace(/((?:api[-_]?key|authorization|cookie|token|secret|password)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1<REDACTED>')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '<URL>')
    .replace(/[\r\n\p{Cc}]+/gu, ' ').slice(0, 600) : undefined
  return { code, ...(message ? { message } : {}), ...(Number.isInteger(failure?.status) && failure.status >= 100 && failure.status <= 599 ? { status: failure.status } : {}) }
}

/** No product write path uses normalized catalog/display values as a baseline. */
export function createModelConfigRoutes({ ctx, workbenchStore, loadPiCatalog = loadPiAiCatalog, loadSubagentRoute, loadAgentDefaultModelSelection, smartFill, providerAvailability, notifyProviderAvailability = () => {}, uuid = randomUUID }) {
  const sessions = new Map()
  const plans = new Map()
  const queries = new Map()
  const metadataCache = createMetadataCache({ fetcher: createSourceFetcher() })
  let piEvidence = null
  const ensureEvidence = () => {
    if (piEvidence === null) piEvidence = (async () => {
      const entry = locateDshPackageJson()
      if (!entry) return null
      const path = String(entry).startsWith('file://') ? fileURLToPath(entry) : entry
      return loadPiEvidenceFromDir(join(dirname(path), 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'))
    })().catch(() => { piEvidence = null; return null })
    return piEvidence
  }
  let writes = Promise.resolve()
  const serialize = (work) => {
    const result = writes.then(work)
    writes = result.then(() => undefined, () => undefined)
    return result
  }
  const remember = (table, value) => {
    const id = uuid()
    table.set(id, { ...value, expires: Date.now() + WORKBENCH_PLAN_TTL_MS })
    for (const [key, entry] of table) if (entry.expires < Date.now()) table.delete(key)
    while (table.size > 128) table.delete(table.keys().next().value)
    return id
  }
  const get = (table, id) => {
    const value = table.get(id)
    if (!value) error('unknown-plan')
    if (Date.now() > value.expires) { table.delete(id); error('plan-expired') }
    return value
  }
  const references = async (route, ids) => {
    const rows = []
    const current = loadAgentDefaultModelSelection?.()
    const subagent = await loadSubagentRoute?.()
    if (current?.provider === route && (!ids || ids.includes(current.model))) rows.push({ kind: 'agent-default-model', provider: route, model: current.model })
    if (subagent?.mode === 'custom' && subagent.provider === route && (!ids || ids.includes(subagent.model))) rows.push({ kind: 'subagent-route', provider: route, model: subagent.model })
    for (const fallback of subagent?.fallbacks ?? []) if (fallback.provider === route && (!ids || ids.includes(fallback.model))) rows.push({ kind: 'subagent-fallback', provider: route, model: fallback.model })
    return rows
  }
  const storeLoad = async () => workbenchStore ? await workbenchStore.load() : {}
  const latest = (session) => {
    const access = modelSettingsFor(ctx)
    if (fingerprint(access) !== session.baseline) error('conflict')
    return access
  }
  const sessionDTO = (access, route, raw) => ({
    route, profile: displayProfile(raw),
    inherited: displayProfile(access.inherited?.()?.providers?.[route] ?? {}),
    explicit: displayProfile(access.explicit?.()?.providers?.[route] ?? {}),
    effective: displayProfile(access.effective?.()?.providers?.[route] ?? {}),
    schema: schemaVocabulary(),
  })
  // A complete non-sensitive snapshot is a precondition, not a post-write promise.
  const snapshotValue = (raw) => {
    if (raw === undefined) return null
    const next = clone(raw)
    if (object(next.headers)) next.headers = Object.fromEntries(Object.entries(next.headers).filter(([name]) => !sensitiveHeader(name)))
    if (containsSensitive(next)) error('sensitive-snapshot')
    return next
  }
  const persistBefore = async (route, before, after, baseline) => {
    if (!workbenchStore) error('snapshot-unavailable')
    if (after === undefined && containsSensitive(before)) error('sensitive-snapshot')
    const safeBefore = snapshotValue(before)
    const safeAfter = snapshotValue(after)
    const token = uuid()
    const previous = clone((await storeLoad()).providers?.[route])
    const previousRemoved = clone((await storeLoad()).removed?.[route])
    await workbenchStore.mutate((state) => {
      state.providers ??= {}; state.removed ??= {}
      const snapshot = { kind: after === undefined ? 'removed' : 'transaction', token, before: safeBefore, after: safeAfter, expectedAfter: profileFingerprint(after ?? null), protectedHeaders: !!Object.keys(before?.headers ?? {}).some(sensitiveHeader), baseline, at: Date.now(), status: 'pending' }
      if (after === undefined) { state.removed[route] = snapshot; delete state.providers[route] }
      else { state.providers[route] = snapshot; delete state.removed[route] }
    })
    return { token, previous, previousRemoved }
  }
  const rollbackSnapshot = async (route, backup) => {
    await workbenchStore.mutate((state) => {
      if (state.providers?.[route]?.token !== backup.token && state.removed?.[route]?.token !== backup.token) return
      state.providers ??= {}; state.removed ??= {}
      if (backup.previous === undefined) delete state.providers[route]; else state.providers[route] = backup.previous
      if (backup.previousRemoved === undefined) delete state.removed[route]; else state.removed[route] = backup.previousRemoved
    })
  }
  const apply = async (session, next, { ops, deletedIds, renamedModelId, remove = false } = {}) => serialize(async () => {
    const access = latest(session)
    if (access.revisionTracked !== true) error('model-config-revision-unavailable')
    const before = routeRaw(access, session.route)
    if (remove && access.inheritedRoute(session.route)) error('model-config-inherited-route')
    if (remove || deletedIds?.length) if ((await references(session.route, remove ? undefined : deletedIds)).length) error('removal-blocked')
    if ((await storeLoad()).recovery?.[session.route]) error('recovery-pending')
    if (renamedModelId && providerAvailability) {
      await providerAvailability.loading
      if (!providerAvailability.modelEnabled(session.route, renamedModelId)) error('disabled-model-rename')
    }
    const backup = await persistBefore(session.route, before, next, session.baseline)
    try {
      await access.mutate('llm-pi-ai', ops ?? [{ op: next === undefined ? 'unset' : 'set', path: ['providers', session.route], ...(next === undefined ? {} : { value: next }) }], access.revision)
    } catch (failure) {
      try { await rollbackSnapshot(session.route, backup) } catch (_) {}
      if (conflict(failure)) error('conflict')
      // Host errors may embed configuration; return only a stable non-sensitive code.
      error('configuration-rejected')
    }
    let recoveryRecorded = true
    try { await workbenchStore.mutate((state) => { const row = (next === undefined ? state.removed : state.providers)?.[session.route]; if (row?.token === backup.token) row.status = 'applied' }) } catch (_) { recoveryRecorded = false }
    return { route: session.route, saved: true, undoable: true, recoveryRecorded, credentialValueRestored: false }
  })
  // A forgettable record is exactly the sidecar's route-scoped removal snapshot:
  // no channel snapshot, no transaction (undo) snapshot, no credential data.
  const forgettable = (state, target) => {
    const row = own(state.removed, target)
    if (!object(row) || row.kind !== 'removed' || typeof row.token !== 'string' || row.token.length === 0) return undefined
    if (!object(row.before)) return undefined
    return row
  }
  const route = (handle) => ({ feature: 'modelCatalog', handle: async (payload = {}) => {
    try {
      if (Object.hasOwn(payload, 'route') && !validRoute(payload.route)) error('bad-route')
      return { ok: true, value: await handle(payload) }
    } catch (failure) {
      const code = conflict(failure) ? 'conflict' : /^[a-z][a-z0-9-]+$/.test(failure?.message ?? '') ? failure.message : 'operation-failed'
      return { ok: false, error: code }
    }
  } })
  const endpoints = {
    'models3-model-enabled': route(async ({ sessionId, modelId, enabled, expected }) => serialize(async () => {
      if (!providerAvailability || !validId(modelId) || typeof enabled !== 'boolean' || typeof expected !== 'boolean') error('bad-payload')
      const session = get(sessions, sessionId)
      const access = latest(session)
      if (!routeRaw(access, session.route)?.models?.some((model) => model.id === modelId)) error('bad-model-id')
      const result = await providerAvailability.setModel(session.route, modelId, enabled, expected)
      notifyProviderAvailability()
      return result
    })),
    'models3-enabled-preview': route(async ({ sessionId, enabled }) => {
      if (!providerAvailability || typeof enabled !== 'boolean') error('bad-payload')
      await providerAvailability.loading
      const session = get(sessions, sessionId)
      latest(session)
      const previous = providerAvailability.enabled(session.route)
      const uses = await references(session.route)
      const planId = remember(plans, { kind: 'availability', session, enabled, previous })
      return { planId, route: session.route, previous, enabled, references: uses, configurationRetained: true, credentialRetained: true }
    }),
    'models3-enabled-commit': route(async ({ planId }) => {
      const plan = get(plans, planId)
      if (plan.kind !== 'availability') error('unknown-plan')
      return serialize(async () => {
        latest(plan.session)
        const result = await providerAvailability.set(plan.session.route, plan.enabled, plan.previous)
        plans.delete(planId)
        notifyProviderAvailability()
        return result
      })
    }),
    'models3-fill': route(async (payload) => {
      if (!validId(payload.modelId)) error('bad-model-id')
      if (payload.referenceModelId !== undefined && !validId(payload.referenceModelId)) error('bad-model-id')
      if (payload.enabled === false) return { groups: [], sources: [], readonly: [], mode: 'off' }
      const access = modelSettingsFor(ctx)
      const raw = routeRaw(access, payload.route)
      const catalog = await loadPiCatalog()
      const records = [...catalog.byModelId.values()].flat().filter((entry) => entry.channel === payload.route)
      const catalogApis = [...new Set(records.map((entry) => entry.api).filter(Boolean))]
      const exactApi = (catalog.byModelId.get(payload.modelId) ?? []).find((entry) => entry.channel === payload.route)?.api
      const api = raw?.api ?? payload.api ?? exactApi ?? (catalogApis.length === 1 ? catalogApis[0] : undefined)
      const referenceModelId = payload.referenceModelId ?? payload.modelId
      const target = { channel: '', api: '', modelId: referenceModelId, modelOnly: true, current: raw?.models?.find((x) => x.id === payload.modelId) ?? {} }
      const result = smartFill ? await smartFill(target) : await querySmartFill({ mode: 'on', target, piIndex: await ensureEvidence(), cache: metadataCache, forceRefresh: true })
      const groups = []; const readonly = []
      for (const group of result.groups ?? []) {
        const options = group.options ?? group.candidates ?? []
        for (const option of options.filter((x) => x.readOnly === true || x.adoptable === false)) readonly.push({ field: group.field, value: option.value, source: option.sourceRef ?? option.source, kind: option.kind, evidence: option.evidence })
        for (const row of group.inexpressible ?? []) readonly.push({ field: group.field, ...row })
        const adopted = options.filter((x) => x.adoptable === true && x.readOnly !== true)
        const keys = [...new Set(adopted.map((x) => x.key ?? null))]
        for (const key of keys) {
          const candidates = adopted.filter((x) => (x.key ?? null) === key).map((x) => ({ id: x.candidateId ?? x.id, value: x.value, source: redactSensitive(x.sourceRef ?? x.source), reference: x.evidence !== 'exact-channel-protocol', evidence: x.evidence }))
          if (candidates.length) groups.push({ key: key === null ? group.field : 'compat.' + key, field: group.field, path: key === null ? [group.field] : ['compat', key], candidates })
        }
      }
      const sourceCandidates = []
      for (const group of groups) for (const candidate of group.candidates) {
        const identity = profileFingerprint(candidate.source)
        if (!sourceCandidates.some((x) => x.id === identity)) sourceCandidates.push({ id: identity, name: [candidate.source?.source, candidate.source?.channel, candidate.source?.api, candidate.source?.modelId].filter(Boolean).join(' / '), source: candidate.source })
      }
      const selectedSource = undefined
      const sourceIdentity = profileFingerprint({ route: payload.route, api, modelId: payload.modelId, baseURL: raw?.baseURL ?? null })
      const bindingNeedsReview = false
      if (selectedSource && !sourceCandidates.some((x) => x.id === selectedSource)) error('unknown-source')
      const queryId = remember(queries, { kind: 'source', route: payload.route, api, modelId: payload.modelId, referenceModelId, identity: sourceIdentity, sourceCandidates })
      if (selectedSource) for (const group of groups) group.candidates = group.candidates.filter((x) => profileFingerprint(x.source) === selectedSource)
      for (const group of groups) group.candidates = group.candidates.filter((x) => !containsSensitive(x.value))
      // 身份留证（只回传有界字符串）：别名归一是否发生、命中哪个候选、哪些来源认出它。
      // 只影响提示文案；采纳仍走候选 ID，原始模型 ID 与写入面都不变。
      const rawIdentity = result.identity
      const identity = rawIdentity === null || typeof rawIdentity !== 'object'
        ? undefined
        : {
            requestedModelId: String(rawIdentity.requestedModelId ?? referenceModelId).slice(0, 512),
            modelId: String(rawIdentity.modelId ?? referenceModelId).slice(0, 512),
            via: rawIdentity.via === 'alias' ? 'alias' : 'exact',
            kind: typeof rawIdentity.kind === 'string' ? rawIdentity.kind.slice(0, 64) : '',
            recognizedBy: Array.isArray(rawIdentity.recognizedBy)
              ? rawIdentity.recognizedBy.filter((item) => typeof item === 'string' && ['pi-ai', 'modelparams', 'openrouter'].includes(item)).slice(0, 4)
              : [],
          }
      return { reasoningSupported: result.groups?.find((group) => group.field === 'reasoningEfforts')?.supported === true, groups: groups.filter((x) => x.candidates.length), readonly: redactSensitive(readonly), candidates: sourceCandidates, queryId, selectedSource: selectedSource ?? '', bindingNeedsReview, sources: (result.sources ?? []).map((x) => ({ ...x, id: x.sourceId ?? x.id })), mode: 'on', ...(identity !== undefined ? { identity } : {}) }
    }),
    'models3-bind-source': route(async ({ queryId, sourceId }) => {
      const query = get(queries, queryId)
      if (!workbenchStore) error('snapshot-unavailable')
      if (sourceId !== '' && !query.sourceCandidates.some((x) => x.id === sourceId)) error('unknown-source')
      const access = modelSettingsFor(ctx)
      const raw = routeRaw(access, query.route)
      if (profileFingerprint({ route: query.route, api: raw?.api ?? query.api, modelId: query.modelId, baseURL: raw?.baseURL ?? null }) !== query.identity) error('conflict')
      await workbenchStore.mutate((state) => {
        state.bindings ??= {}
        const byRoute = own(state.bindings, query.route) ?? setOwn(state.bindings, query.route, {})
        const byApi = own(byRoute, query.api) ?? setOwn(byRoute, query.api, {})
        if (!sourceId) delete byApi[query.modelId]
        else setOwn(byApi, query.modelId, { identity: query.identity, sourceId, referenceModelId: query.referenceModelId })
      })
      return { bound: !!sourceId, sourceId }
    }),
    'models3-snapshot': route(async () => {
      const access = modelSettingsFor(ctx)
      const providers = access.get('llm-pi-ai')?.providers ?? {}
      const catalog = await loadPiCatalog()
      const state = await storeLoad()
      if (providerAvailability) await providerAvailability.loading
      const llm = ctx.get('llm')
      let loaded = []; try { loaded = await llm?.listProviders?.() ?? [] } catch (_) {}
      const configuredIds = new Set()
      for (const id of Object.keys(providers)) {
        if (validRoute(id)) configuredIds.add(id)
      }
      for (const id of catalog.channelIds) {
        if (has(providers, id) || access.inheritedRoute?.(id)) configuredIds.add(id)
      }
      const routes = [...configuredIds].map((id) => ({
        route: id,
        displayName: providers[id]?.displayName ?? id,
        source: builtin(catalog, id) ? 'builtin' : 'custom',
        configured: has(providers, id) || access.inheritedRoute?.(id) === true,
        modelCount: Array.isArray(providers[id]?.models) && providers[id].models.length ? providers[id].models.length : [...catalog.byModelId.values()].flat().filter((x) => x.channel === id).length,
        enabled: providerAvailability ? providerAvailability.enabled(id) : state.disabledProviders?.[id] !== true,
        runtimeLoaded: loaded.some((x) => x.id === id || x.provider === id),
        lastValidation: state.validations?.[id],
        undoable: !!state.providers?.[id] && state.providers[id].kind === 'transaction',
      }))
      const templates = [...catalog.channelIds].filter((id) => !configuredIds.has(id)).map((id) => {
        const records = [...catalog.byModelId.entries()]
          .flatMap(([modelId, recs]) => recs.filter((x) => x.channel === id).map((x) => ({
            id: modelId,
            name: x.name ?? modelId,
            api: x.api ?? 'openai-completions',
            contextWindow: x.contextWindow,
            maxTokens: x.maxTokens,
          })))
        const defaultEntry = catalog.channels?.find((c) => c.id === id) || [...catalog.byModelId.values()].flat().find((x) => x.channel === id)
        return {
          id,
          name: defaultEntry?.name ?? id,
          api: defaultEntry?.api ?? 'openai-completions',
          baseURL: defaultEntry?.baseUrl ?? '',
          // 混合协议目录（v2.0.9）：pi-ai 1.1.0 起 azure 等渠道单目录含多种 api。路由级 `api`
          // 会覆盖该路由全部模型（官方语义），客户端据此提示「钉协议前先确认全部模型同协议」。
          apis: [...new Set(records.map((x) => x.api).filter(Boolean))],
          models: records,
        }
      })
      return {
        routes,
        templates,
        removedRoutes: Object.entries(state.removed ?? {}).filter(([, v]) => v.kind === 'removed' && v.before).map(([id, v]) => ({ route: id, displayName: v.before.displayName ?? id, at: v.at, taken: has(providers, id) })),
      }
    }),
    'models3-open': route(async ({ route: id }) => {
      const access = modelSettingsFor(ctx)
      const catalog = await loadPiCatalog()
      const raw = routeRaw(access, id)
      if (!raw && !builtin(catalog, id)) error('route-gone')
      const defaultEntry = catalog.channels?.find((c) => c.id === id) || [...catalog.byModelId.values()].flat().find((x) => x.channel === id)
      const effectiveRaw = raw ?? {
        displayName: defaultEntry?.name ?? id,
        api: defaultEntry?.api ?? 'openai-completions',
        baseURL: defaultEntry?.baseUrl ?? '',
        models: [],
      }
      const sessionId = remember(sessions, { route: id, baseline: fingerprint(access), readOnly: false, ownerEntry: access.namespace })
      const dto = sessionDTO(access, id, effectiveRaw)
      dto.builtin = builtin(catalog, id)
      dto.resolvedApi = effectiveRaw.api ?? defaultEntry?.api ?? [...catalog.byModelId.values()].flat().find((entry) => entry.channel === id && entry.api)?.api ?? ''
      dto.credentialState = 'unknown'
      const credentialService = ctx.get('credentials')
      try {
        if (effectiveRaw.apiKeyEnv && typeof credentialService?.resolve === 'function') {
          const hit = await credentialService.resolve(effectiveRaw.apiKeyEnv)
          dto.credentialState = hit?.value ? 'configured' : 'missing'
        } else if (typeof credentialService?.readRecord === 'function') {
          const record = await credentialService.readRecord(`llm-pi-ai/${id}`)
          if (record?.kind === 'api-key' && record.key) dto.credentialState = 'configured'
          else if (record?.kind === 'grant') dto.credentialState = 'authorized'
        }
      } catch (_) { /* Missing status must not prevent configuration editing. */ }
      if (builtin(catalog, id)) dto.catalogModels = [...catalog.byModelId.entries()].flatMap(([modelId, records]) => records.filter((x) => x.channel === id).map((x) => ({ id: modelId, api: x.api, ...displayProfile({ models: [{ id: modelId, ...x }] }).models[0] })))
      // 混合协议目录（v2.0.9）：≥2 种 api 才下发，客户端据它在路由编辑器里提示路由级 api 的覆盖语义。
      if (Array.isArray(dto.catalogModels)) {
        const apis = [...new Set(dto.catalogModels.map((entry) => entry.api).filter(Boolean))]
        if (apis.length > 1) dto.catalogApis = apis
      }
      dto.resolved = {
        displayName: effectiveRaw.displayName ?? dto.effective.displayName ?? defaultEntry?.name ?? id,
        api: dto.resolvedApi,
        baseURL: effectiveRaw.baseURL ?? dto.effective.baseURL ?? defaultEntry?.baseUrl ?? '',
        models: (effectiveRaw.models ?? []).map((model) => ({
          ...(dto.catalogModels ?? []).find((entry) => entry.id === model.id && (!model.api || entry.api === model.api)),
          ...(dto.effective.models ?? []).find((entry) => entry.id === model.id),
          ...displayProfile({ models: [model] }).models[0],
        })),
      }
      if (providerAvailability) await providerAvailability.loading
      const modelAvailability = (effectiveRaw.models ?? []).map((model) => ({ id: model.id, enabled: providerAvailability ? providerAvailability.modelEnabled(id, model.id) : true }))
      return { ...dto, modelAvailability, sessionId, readOnly: false, inheritedRoute: access.inheritedRoute(id), fingerprint: fingerprint(access) }
    }),
    'models3-save-model': route(async (payload) => {
      const session = get(sessions, payload.sessionId)
      const access = latest(session)
      const catalog = await loadPiCatalog()
      const defaultEntry = catalog.channels?.find((c) => c.id === session.route) || [...catalog.byModelId.values()].flat().find((x) => x.channel === session.route)
      const raw = routeRaw(access, session.route) ?? {
        displayName: defaultEntry?.name ?? session.route,
        api: defaultEntry?.api ?? 'openai-completions',
        baseURL: defaultEntry?.baseUrl ?? '',
        models: [],
      }
      const models = clone(raw.models ?? [])
      const originalModelId = payload.add === true ? payload.modelId : payload.originalModelId ?? payload.modelId
      if (!validId(originalModelId) || !validId(payload.modelId)) error('bad-model-id')
      const position = models.findIndex((x) => x.id === originalModelId)
      const renamed = payload.add !== true && originalModelId !== payload.modelId
      if (renamed && models.some((model) => model.id === payload.modelId)) error('duplicate-model')
      if (payload.add === true ? position !== -1 : position === -1) error(payload.add === true ? 'duplicate-model' : 'unknown-model')
      const previous = position === -1 ? { id: payload.modelId } : models[position]
      const next = patchFields(previous, payload.patch ?? {}, payload.unset ?? [], MODEL_FIELDS, raw.api)
      next.id = payload.modelId
      // Models are a replaced array in Profile composition, so deleting a field
      // from that array does not magically re-expose an inherited model row.
      const inheritedModel = access.inherited?.()?.providers?.[session.route]?.models?.find((row) => row.id === originalModelId)
      for (const field of payload.unset ?? []) if (has(inheritedModel, field)) next[field] = clone(inheritedModel[field])
      if (has(payload.patch, 'compat')) {
        const offered = schemaVocabulary().compatGates[raw.api] ?? []
        next.compat = { ...Object.fromEntries(Object.entries(previous.compat ?? {}).filter(([key]) => !offered.includes(key))), ...next.compat }
      }
      if (position === -1) models.push(next); else models[position] = next
      if (!selfCheckModelsPatch(models).ok) error('schema-invalid')
      const result = await apply(session, { ...(routeRaw(access, session.route) ?? {}), models }, { ops: [{ op: 'set', path: ['providers', session.route, 'models'], value: models }], ...(renamed ? { deletedIds: [originalModelId], renamedModelId: originalModelId } : {}) })
      sessions.delete(payload.sessionId)
      return result
    }),
    'models3-add-models': route(async ({ sessionId, modelIds }) => {
      const session = get(sessions, sessionId)
      const access = latest(session)
      const catalog = await loadPiCatalog()
      const defaultEntry = catalog.channels?.find((c) => c.id === session.route) || [...catalog.byModelId.values()].flat().find((x) => x.channel === session.route)
      const raw = routeRaw(access, session.route) ?? {
        displayName: defaultEntry?.name ?? session.route,
        api: defaultEntry?.api ?? 'openai-completions',
        baseURL: defaultEntry?.baseUrl ?? '',
        models: [],
      }
      if (!Array.isArray(modelIds) || !modelIds.length || modelIds.length > 200 || modelIds.some((id) => !validId(id)) || new Set(modelIds).size !== modelIds.length) error('bad-model-id')
      const models = clone(raw.models ?? [])
      if (modelIds.some((id) => models.some((x) => x.id === id))) error('duplicate-model')
      for (const id of modelIds) models.push({ id })
      if (!selfCheckModelsPatch(models).ok) error('schema-invalid')
      const result = await apply(session, { ...(routeRaw(access, session.route) ?? {}), models }, { ops: [{ op: 'set', path: ['providers', session.route, 'models'], value: models }] })
      sessions.delete(sessionId)
      return result
    }),
    'models3-save-route': route(async (payload) => {
      const session = get(sessions, payload.sessionId)
      const access = latest(session)
      const catalog = await loadPiCatalog()
      const defaultEntry = catalog.channels?.find((c) => c.id === session.route) || [...catalog.byModelId.values()].flat().find((x) => x.channel === session.route)
      const raw = routeRaw(access, session.route) ?? {
        displayName: defaultEntry?.name ?? session.route,
        api: defaultEntry?.api ?? 'openai-completions',
        baseURL: defaultEntry?.baseUrl ?? '',
        models: [],
      }
      const next = patchFields(raw, payload.patch ?? {}, payload.unset ?? [], ROUTE_FIELDS.filter((x) => x !== 'apiKeyEnv'), payload.patch?.api ?? raw.api)
      if (has(payload.patch, 'headers')) next.headers = { ...Object.fromEntries(Object.entries(raw.headers ?? {}).filter(([key]) => sensitiveHeader(key))), ...next.headers }
      if ((payload.unset ?? []).includes('headers') && Object.keys(raw.headers ?? {}).some(sensitiveHeader)) error('sensitive-header')
      // Preserve unknown nested keys; the client never owns their write baseline.
      for (const key of ['compat', 'thinkingBudgets', 'retryPolicy']) if (has(payload.patch, key)) {
        const known = key === 'compat' ? schemaVocabulary().compatGates[next.api] ?? [] : key === 'thinkingBudgets' ? ['minimal', 'low', 'medium', 'high'] : ['mode', 'maxRetries', 'retryableCodes', 'backoff']
        next[key] = { ...Object.fromEntries(Object.entries(raw[key] ?? {}).filter(([name]) => !known.includes(name))), ...next[key] }
      }
      const ops = []
      for (const key of payload.unset ?? []) ops.push({ op: 'unset', path: ['providers', session.route, key] })
      for (const key of Object.keys(payload.patch ?? {})) ops.push({ op: 'set', path: ['providers', session.route, key], value: next[key] })
      // Calculate unset's true inherited result for the restore fingerprint.
      for (const key of payload.unset ?? []) { const value = access.inherited?.()?.providers?.[session.route]?.[key]; if (value !== undefined) next[key] = clone(value) }
      const result = await apply(session, next, { ops })
      sessions.delete(payload.sessionId)
      return result
    }),
    'models3-remove-preview': route(async (payload) => {
      const session = get(sessions, payload.sessionId)
      const access = latest(session)
      const raw = routeRaw(access, session.route) ?? {
        api: 'openai-completions',
        baseURL: '',
        models: [],
      }
      if (containsSensitive(raw)) error('sensitive-snapshot')
      const ids = payload.modelIds
      let next
      if (ids !== undefined) {
        if (!Array.isArray(ids) || !ids.length || ids.some((id) => !raw.models?.some((m) => m.id === id))) error('unknown-model')
        const models = raw.models.filter((x) => !ids.includes(x.id))
        if (!models.length) error('last-model-undeletable')
        next = { ...raw, models }
      }
      const refs = await references(session.route, ids)
      const blocked = refs.length > 0 || ids === undefined && access.inheritedRoute(session.route)
      const planId = remember(plans, { ...session, kind: 'remove', next, deletedIds: ids, remove: ids === undefined })
      return { planId, route: session.route, removeRoute: ids === undefined, references: refs, blocked, modelsRemoved: ids ?? raw.models?.map((x) => x.id) ?? [], credentialRetained: true, before: displayProfile(raw) }
    }),
    'models3-remove-commit': route(async ({ planId }) => {
      const plan = get(plans, planId)
      if (plan.kind !== 'remove') error('unknown-plan')
      const result = await apply(plan, plan.next, { deletedIds: plan.deletedIds, remove: plan.remove })
      plans.delete(planId)
      return result
    }),
    'models3-restore-preview': route(async ({ route: id }) => {
      const access = modelSettingsFor(ctx)
      const state = await storeLoad()
      const snapshot = state.removed?.[id] ?? state.providers?.[id]
      if (!snapshot || !['removed', 'transaction'].includes(snapshot.kind)) error('nothing-to-restore')
      const raw = routeRaw(access, id)
      if (profileFingerprint(raw ?? null) !== snapshot.expectedAfter) error('restore-conflict')
      const next = clone(snapshot.before ?? undefined)
      if (snapshot.protectedHeaders && next) next.headers = { ...(next.headers ?? {}), ...Object.fromEntries(Object.entries(raw?.headers ?? {}).filter(([name]) => sensitiveHeader(name))) }
      const planId = remember(plans, { kind: 'restore', route: id, baseline: fingerprint(access), next, restoreToken: snapshot.token, remove: snapshot.before === null })
      return { planId, route: id, before: displayProfile(raw ?? {}), restore: displayProfile(snapshot.before ?? {}), removesRoute: snapshot.before === null, credentialValueRestored: false }
    }),
    'models3-restore-commit': route(async ({ planId }) => {
      const plan = get(plans, planId)
      if (plan.kind !== 'restore') error('unknown-plan')
      const state = await storeLoad()
      if ((state.removed?.[plan.route] ?? state.providers?.[plan.route])?.token !== plan.restoreToken) error('restore-conflict')
      const access = latest(plan)
      const current = routeRaw(access, plan.route)
      const removedIds = (current?.models ?? []).filter((row) => !(plan.next?.models ?? []).some((x) => x.id === row.id)).map((row) => row.id)
      const result = await apply(plan, plan.next, { remove: plan.remove, deletedIds: removedIds })
      plans.delete(planId)
      return result
    }),
    // Recently removed channel records can be forgotten one at a time. This only
    // deletes the exact removal snapshot; it never touches channels, credentials or
    // any other route's record. The plan pins the record token, and the commit
    // rechecks it inside the serialized sidecar write, so a concurrent re-removal
    // (which replaces the record with a new token) cannot be deleted by mistake.
    'models3-forget-preview': route(async (payload) => {
      const id = payload.route
      if (!validRoute(id)) error('bad-route')
      const state = await storeLoad()
      const record = forgettable(state, id)
      if (!record) error('nothing-to-forget')
      const before = record.before
      const planId = remember(plans, { kind: 'forget', route: id, recordToken: record.token })
      return {
        planId,
        route: id,
        displayName: typeof before.displayName === 'string' && before.displayName.trim() ? before.displayName.slice(0, 128) : id,
        removedAt: Number.isFinite(record.at) ? record.at : null,
        modelCount: Array.isArray(before.models) ? before.models.length : 0,
        irreversible: true,
        channelRetained: true,
        credentialRetained: true,
        otherRemovedRecordsRetained: true,
      }
    }),
    'models3-forget-commit': route(async ({ planId }) => serialize(async () => {
      // Read the handle inside the write gate: a replayed or cross-kind plan can
      // never borrow another operation's critical section.
      const plan = get(plans, planId)
      if (plan.kind !== 'forget' || !validRoute(plan.route) || typeof plan.recordToken !== 'string') error('unknown-plan')
      if (!workbenchStore) error('snapshot-unavailable')
      await workbenchStore.mutate((state) => {
        const record = forgettable(state, plan.route)
        if (!record || record.token !== plan.recordToken) error('forget-conflict')
        delete state.removed[plan.route]
      })
      plans.delete(planId)
      return { route: plan.route, forgotten: true, channelRetained: true, credentialRetained: true, otherRemovedRecordsRetained: true }
    })),
    'models3-create-preview': route(async ({ route: id, profile, key }) => {
      if (!MODELS_ROUTE_RE.test(id ?? '') || (id?.length ?? 0) > 64) error('bad-route')
      const access = modelSettingsFor(ctx)
      if (routeRaw(access, id)) error('route-taken')
      if (!object(profile) || Object.keys(profile).some((key) => ![...ROUTE_FIELDS.filter((x) => x !== 'apiKeyEnv'), 'models'].includes(key))) error('unknown-field')
      for (const [field, value] of Object.entries(profile)) if (field !== 'models') validateField(field, value, { api: profile.api })
      if (!PROTOCOLS.includes(profile.api) || !profile.baseURL || !selfCheckModelsPatch(profile.models).ok) error('schema-invalid')
      for (const row of profile.models) { if (Object.keys(row).some((x) => !['id', ...MODEL_FIELDS].includes(x))) error('unknown-field'); for (const [field, value] of Object.entries(row)) if (field !== 'id') validateField(field, value, { api: profile.api }) }
      const credentialRef = typeof key === 'string' && key.trim() ? `${deriveKeyRefFor(id)}_${uuid().replaceAll('-', '').slice(0, 12)}` : null
      const planId = remember(plans, { kind: 'create', route: id, baseline: fingerprint(access), next: clone(profile), key: typeof key === 'string' && key.trim() ? key.trim() : null, credentialRef })
      return { planId, route: id, profile: displayProfile(profile), credentialStored: false }
    }),
    'models3-create-commit': route(async ({ planId }) => {
      const plan = get(plans, planId)
      if (plan.kind !== 'create') error('unknown-plan')
      latest(plan)
      if (plan.key && plan.credentialRef) {
        const service = ctx.get('credentials')
        if (!service?.set) error('credential-rejected')
        await service.set(plan.credentialRef, plan.key)
        plan.next.apiKeyEnv = plan.credentialRef
      }
      const result = await apply(plan, plan.next)
      plans.delete(planId)
      return { ...result, credentialStored: !!plan.key }
    }),
    'models3-discover': route(async ({ sessionId, baseURL, api, key }) => {
      let routeName = ''
      let targetURL = baseURL
      let targetApi = api ?? 'openai-completions'
      let targetKey = typeof key === 'string' && key.trim() ? key.trim() : undefined
      if (sessionId) {
        const session = get(sessions, sessionId)
        const access = latest(session)
        const raw = routeRaw(access, session.route)
        if (!raw) error('route-gone')
        routeName = session.route
        const catalog = await loadPiCatalog()
        const catalogModel = [...catalog.byModelId.values()].flat().find((entry) => entry.channel === session.route && entry.api)
        const catalogChannel = catalog.channels?.find((entry) => entry.id === session.route)
        targetURL = raw.baseURL ?? catalogChannel?.baseUrl ?? catalogModel?.baseUrl
        targetApi = raw.api ?? catalogModel?.api
        if (raw.apiKeyEnv) {
          const credentials = ctx.get('credentials')
          try { targetKey = (await credentials?.resolve(raw.apiKeyEnv))?.value } catch (_) { error('credential-missing') }
          if (typeof targetKey !== 'string' || !targetKey) error('credential-missing')
        }
      } else if (!targetURL) {
        error('unknown-plan')
      }
      if (!PROTOCOLS.includes(targetApi)) error('probe-protocol-unsupported')
      let rows
      try { rows = await fetchModelsProbe(targetURL, targetKey, targetApi) } catch (failure) {
        const status = /^probe-status:(\d{3})$/.exec(failure?.message ?? '')?.[1]
        if (status === '401') error(targetKey ? 'discovery-auth-failed' : 'credential-missing')
        if (status === '403') error('discovery-forbidden')
        if (status === '429') error('discovery-rate-limited')
        if (status) error('discovery-http-' + status)
        throw failure
      }
      return { route: routeName, usedCredential: !!targetKey, candidates: rows.map((x) => ({ id: x.id, name: x.name })), saved: false }
    }),
    'models3-credential-preview': route(async ({ sessionId, shared = false }) => {
      const session = get(sessions, sessionId)
      const access = latest(session)
      const raw = routeRaw(access, session.route)
      if (!raw) error('route-gone')
      const users = Object.entries(access.get('llm-pi-ai').providers ?? {}).filter(([, v]) => raw.apiKeyEnv && v.apiKeyEnv === raw.apiKeyEnv).map(([id]) => id)
      if (shared && !MODELS_KEY_REF_RE.test(raw.apiKeyEnv ?? '')) error('shared-ref-unavailable')
      // Default is a fresh owner-only reference: never overwrite or compensate a
      // pre-existing credential. Shared replacement is a separate explicit intent.
      const ref = shared && MODELS_KEY_REF_RE.test(raw.apiKeyEnv ?? '') ? raw.apiKeyEnv : `${deriveKeyRefFor(session.route)}_${uuid().replaceAll('-', '').slice(0, 12)}`
      const service = ctx.get('credentials')
      if (!service?.set || !service?.describe) error('credential-rejected')
      const info = await service.describe(ref)
      if (info?.writable === false) error('credential-rejected')
      const planId = remember(plans, { ...session, kind: 'credential', credentialRef: ref, shared: shared === true, configured: info?.configured === true })
      return { planId, ref, shared: shared === true, users, externalConsumersUnknown: true, configured: info?.configured === true }
    }),
    'models3-credential-commit': route(async ({ planId, key }) => serialize(async () => {
      const plan = get(plans, planId)
      if (plan.kind !== 'credential' || !plan.credentialRef) error('unknown-plan')
      if (typeof key !== 'string' || !key.trim() || key.length > 4096) error('bad-key')
      let access = latest(plan)
      if (access.revisionTracked !== true) error('model-config-revision-unavailable')
      if (own((await storeLoad()).recovery, plan.route)) error('recovery-pending')
      const service = ctx.get('credentials')
      const info = await service?.describe?.(plan.credentialRef)
      if (!plan.shared && info?.configured) error('credential-taken')
      if (info?.writable === false) error('credential-rejected')
      const raw = routeRaw(access, plan.route)
      const next = { ...raw, apiKeyEnv: plan.credentialRef }
      const backup = await persistBefore(plan.route, raw, next, plan.baseline)
      try { access = latest(plan); access.assertOwner?.() } catch (failure) { try { await rollbackSnapshot(plan.route, backup) } catch (_) {}; throw failure }
      try { await service.set(plan.credentialRef, key) } catch (_) { try { await rollbackSnapshot(plan.route, backup) } catch (_) {}; error('credential-rejected') }
      plans.delete(planId)
      try { await access.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', plan.route, 'apiKeyEnv'], value: plan.credentialRef }], access.revision) } catch (_) {
        try { await rollbackSnapshot(plan.route, backup) } catch (_) {}
        // Never delete a credential during compensation. A concurrent consumer
        // may have adopted even a newly allocated reference after its creation.
        return { saved: false, credentialStored: true, ref: plan.credentialRef, shared: plan.shared, configurationFailed: true, undoable: false }
      }
      let recoveryRecorded = true
      try { await workbenchStore.mutate((state) => { if (state.providers?.[plan.route]?.token === backup.token) state.providers[plan.route].status = 'applied' }) } catch (_) { recoveryRecorded = false }
      return { saved: true, credentialStored: true, ref: plan.credentialRef, shared: plan.shared, undoable: true, recoveryRecorded }
    })),
    'models3-test-preview': route(async ({ sessionId, modelId }) => {
      const session = get(sessions, sessionId)
      const access = latest(session)
      const raw = routeRaw(access, session.route)
      if (!raw?.models?.some((row) => row.id === modelId)) error('unknown-model')
      const planId = remember(plans, { ...session, kind: 'test', testModelId: modelId })
      return { planId, route: session.route, modelId, text: 'ping', system: 'Reply with OK.', maxTokens: 30000, timeoutMs: 120000, mayCharge: true, scope: 'basic-text-call' }
    }),
    'models3-test-commit': route(async ({ planId }) => {
      const plan = get(plans, planId)
      if (plan.kind !== 'test' || !plan.testModelId) error('unknown-plan')
      latest(plan); plans.delete(planId)
      const llm = ctx.get('llm')
      if (!llm?.stream) error('llm-service-missing')
      const signal = AbortSignal.timeout(120000)
      const began = Date.now()
      let completed = false
      let finishReason
      let failureDetail
      let stage = 'start'
      const deadline = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stream-timeout')), { once: true }))
      let iterator
      try {
        const stream = await Promise.race([Promise.resolve(llm.stream({ provider: plan.route, model: plan.testModelId, system: 'Reply with OK.', messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }], maxTokens: 30000, signal })), deadline])
        iterator = stream[Symbol.asyncIterator]()
        stage = 'stream'
        let visibleText = false
        while (true) {
          const step = await Promise.race([iterator.next(), deadline])
          if (step.done) break
          const chunk = step.value
          if (signal.aborted || completed) error('stream-failed')
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0 || chunk?.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string' && chunk.block.text.length > 0) visibleText = true
          if (chunk?.type === 'finish') {
            finishReason = ['stop', 'error', 'aborted', 'max-tokens', 'tool-calls'].includes(chunk.reason?.kind) ? chunk.reason.kind : 'unknown'
            if (finishReason !== 'stop' || !visibleText) {
              failureDetail = modelTestFailure(chunk.reason?.failure, finishReason === 'stop' ? 'empty-output' : finishReason)
              error('stream-failed')
            }
            completed = true
          }
        }
        if (!completed) failureDetail = modelTestFailure(null, 'missing-finish')
      } catch (failure) {
        completed = false
        failureDetail ??= modelTestFailure(failure, signal.aborted ? 'stream-timeout' : 'stream-failed')
        try { Promise.resolve(iterator?.return?.()).catch(() => {}) } catch (_) {}
      }
      const result = { ok: completed, at: Date.now(), durationMs: Date.now() - began, modelId: plan.testModelId, scope: 'basic-text-call', ...(finishReason ? { finishReason } : {}), ...(!completed ? { failure: { stage, ...failureDetail } } : {}) }
      if (!completed) {
        try { ctx.logger?.warn?.('dsh-service: model test failed %s', JSON.stringify({ route: plan.route, ...result })) } catch (_) { /* Diagnostics cannot veto the test result. */ }
      }
      try { await workbenchStore?.mutate((state) => { state.validations ??= {}; state.validations[plan.route] = result }) } catch (_) {}
      return result
    }),
  }
  return endpoints
}
