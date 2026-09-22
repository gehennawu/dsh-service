// Host routes: model-configuration workbench RPC surface (models2-*).
//
// 装配层只做三件事：**收窄输入**（客户端只能回传宿主签发的句柄与 sid）、**门禁与稳定错误码**、
// **把领域调用接到共享工具**。领域逻辑一律在 `model-workbench.js`（可独立单测的纯函数与深模块）。
//
// 与 `index.js` 其它 `*-routes.js` 同一形状：工厂返回 `{ endpoint: { feature, handle } }`，
// 由 `mergeRouteTables` 汇总；重复端点键立即抛错（拆分回归保护）。
//
// 端点清单（全部 feature 门 `modelCatalog`）：
//   只读：models2-snapshot / models2-route
//   检查：models2-inspect
//   建议与写入：models2-prepare / models2-commit
//   撤销：models2-undo-preview / models2-undo-commit
//   新建（补偿式）：models2-create-begin / models2-create-commit / models2-recovery-resolve
//   验证：models2-validate
//   编辑器与移除守卫：models2-edit-prepare / models2-remove-preview / models2-remove-plan / models2-remove-commit
//
// 句柄纪律：`inspectId` / `planId` / `draftId` 由宿主签发、内存保存、取出即消费（一次性）。
// 客户端无法伪造取值——`models2-prepare` 只回放服务端自己的建议清单，`applySuggestions`
// 对未知 sid 整体拒绝。计划携带 baseFingerprint，提交前复检，任何漂移返回 `conflict`。

import {
  MAX_MODEL_ID_LENGTH,
  MAX_MODELS_KEY_LENGTH,
  MODELS_KEY_REF_RE,
  MODELS_PROBE_PROTOCOLS,
  MODELS_PROTOCOLS,
  MODELS_ROUTE_RE,
  MODEL_ID_RE,
  WORKBENCH_PLAN_TTL_MS,
  applySuggestions,
  applyUndo,
  arbitrateModelSuggestions,
  buildRouteCreateProfile,
  consensusFields,
  createFreshnessManager,
  deriveKeyRefFor,
  diffModelLists,
  fetchModelsProbe,
  hostnameOf,
  loadModelParamsSnapshot,
  modelMetaCandidates,
  modelParamsCandidates,
  profileFingerprint,
  readLlmProfiles,
  refreshModelParamsSnapshot,
  rememberHandle,
  resolveLlmProfileBaseURL,
  selfCheckModelsPatch,
  suggestRouteId,
  takeHandle,
  undoPreviewModels,
  planIdFor,
} from './model-workbench.js'

/** 幂等目录缓存：目录随 DSH 升级才变，进程内一次足够。 */
function createPiCatalogCache(loadCatalog) {
  let promise = null
  return () => {
    if (promise === null) {
      promise = loadCatalog().catch(() => {
        promise = null
        throw new Error('catalog-unavailable')
      })
    }
    return promise
  }
}

export function createModelWorkbenchRoutes({
  ctx,
  randomUUID,
  loadPiCatalog,
  workbenchStore,
  loadSubagentRoute,
  loadAgentDefaultModelSelection,
  writeSubagentRoute,
  listSubagentModels,
  dshHome,
  pluginVersion = 'unknown',
}) {
  const ensurePiCatalog = createPiCatalogCache(loadPiCatalog)

  // 内存句柄表：检查 / 计划 / 新建草稿。上限与 TTL 在 model-workbench.js 定稿。
  const inspections = new Map()
  const plans = new Map()
  const drafts = new Map()

  // P3.5 补充源状态（modelparams.dev）：快照式、动作驱动、零网络默认。
  // 状态挂在工厂闭包（随 Fiber 销毁），退避标志由新鲜度管理器写入。
  const modelParamsState = { snapshot: null, lastError: null, lastAttemptAt: 0 }
  const modelParamsReady = dshHome === undefined
    ? Promise.resolve(null)
    : loadModelParamsSnapshot(dshHome).then((snapshot) => {
      if (snapshot !== null) modelParamsState.snapshot = snapshot
      return snapshot
    })
  const modelParamsFresh = createFreshnessManager(
    () => modelParamsState,
    () => refreshModelParamsSnapshot(dshHome, modelParamsState, { userAgent: `dsh-service/${pluginVersion} (DeepSeek Harness plugin)` }),
  )

  /**
   * 目录候选（含 P3.5 补充源），按优先级排序：同渠道 pi-ai → 跨渠道 pi-ai → modelparams
   * （补充源只表态 reasoningEfforts 与输出上限，绝不参与 contextWindow/input 仲裁）。
   */
  const orderedCandidates = (piIndex, route, modelId) => {
    const candidates = modelMetaCandidates(piIndex, modelId)
    return [
      ...candidates.filter((candidate) => candidate.source === 'pi-ai' && candidate.providerId === route),
      ...candidates.filter((candidate) => candidate.source === 'pi-ai' && candidate.providerId !== route),
      ...modelParamsCandidates(modelParamsState.snapshot?.catalog, modelId),
    ]
  }

  /** 稳定错误码 → RPC 失败（`details.detail` 承载补充数据，客户端 wrapper 归一回字符串）。 */
  const fail = (message, detail) => ({ ok: false, error: detail === undefined ? message : `${message}: ${String(detail)}` })

  const profileFor = (route, settings) => readLlmProfiles(settings).find((candidate) => candidate.route === route)

  /** 凭据解析（仅本机凭据库，不发网）；未配置/解析失败返回 undefined。 */
  const resolveCredential = async (profile) => {
    if (profile?.apiKeyEnv === '' || !MODELS_KEY_REF_RE.test(profile?.apiKeyEnv ?? '')) return undefined
    const credentials = ctx.get('credentials')
    if (credentials === undefined || typeof credentials.resolve !== 'function') return undefined
    try {
      const resolved = await credentials.resolve(profile.apiKeyEnv)
      return typeof resolved?.value === 'string' && resolved.value !== '' ? resolved.value : undefined
    } catch (_) {
      return undefined
    }
  }

  /** 凭据状态：none（未引用）/ invalid-ref（文法非法）/ ok / dangling（引用悬空）。 */
  const credentialStateOf = async (profile) => {
    if (profile.apiKeyEnv === '') return 'none'
    if (!MODELS_KEY_REF_RE.test(profile.apiKeyEnv)) return 'invalid-ref'
    const credentials = ctx.get('credentials')
    if (credentials === undefined || typeof credentials.resolve !== 'function') return 'dangling'
    try {
      const resolved = await credentials.resolve(profile.apiKeyEnv)
      return typeof resolved?.value === 'string' && resolved.value !== '' ? 'ok' : 'dangling'
    } catch (_) {
      return 'dangling'
    }
  }

  /**
   * 移除引用的共享探测（移除守卫）：子代理路由（可迁移）与 agent-default-model（硬阻断）。
   * 只读宿主侧配置与 llm 服务，不接受浏览器输入。
   */
  const inspectRemoveReferences = async (route) => {
    const references = []
    try {
      const config = await loadSubagentRoute()
      if (config?.mode === 'custom' && config.provider === route && typeof config.model === 'string') {
        references.push({ kind: 'subagent-route', provider: config.provider, model: config.model })
      }
    } catch (_) {}
    try {
      const selection = loadAgentDefaultModelSelection?.()
      if (typeof selection?.provider === 'string' && selection.provider === route && typeof selection.model === 'string') {
        references.push({ kind: 'agent-default-model', provider: selection.provider, model: selection.model })
      }
    } catch (_) {}
    return references
  }

  /**
   * 子代理路由的模型选择面（移除守卫的迁移下拉与目标校验）。
   * 权威清单走宿主既有的 `listSubagentModels(llm, agentDefaultModel)`（含内置目录渠道与
   * reasoning 元数据），迁移目标必须落在该清单内——拒绝客户端自造路由。
   */
  const subagentModelOptions = async () => {
    try {
      const llm = ctx.get('llm')
      if (llm === undefined) return []
      const whitelist = await listSubagentModels(llm, ctx.get('agentDefaultModel'))
      const byProvider = new Map()
      for (const item of Array.isArray(whitelist?.models) ? whitelist.models : []) {
        if (typeof item?.provider !== 'string' || item.provider === '' || typeof item?.id !== 'string' || item.id === '') continue
        const group = byProvider.get(item.provider) ?? []
        if (group.some((row) => row.id === item.id)) continue
        group.push({ id: item.id, name: typeof item.name === 'string' && item.name !== '' ? item.name : item.id })
        byProvider.set(item.provider, group)
      }
      return [...byProvider.entries()].map(([provider, models]) => ({ provider, models }))
    } catch (_) {
      return []
    }
  }

  return {
    // ── P3.5 补充源（modelparams.dev）手动刷新：force 绕过退避，但在途请求仍单飞合并 ──
    'models2-refresh-modelparams': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        if (dshHome === undefined) return fail('catalog-unavailable')
        await modelParamsReady
        // freshKey 非法/缺失即给唯一键：绝不与其它会话共享一次条件请求。
        const key = typeof payload?.freshKey === 'string' && payload.freshKey.length > 0 && payload.freshKey.length <= 64
          ? payload.freshKey
          : `anon-${randomUUID()}`
        await modelParamsFresh.refreshed(key, payload?.force === true)
        return {
          ok: true,
          value: {
            haveSnapshot: modelParamsState.snapshot !== null,
            ...(modelParamsState.snapshot !== null ? { fetchedAt: modelParamsState.snapshot.fetchedAt } : {}),
            // 失败保留旧快照继续：staleError 让客户端显著标注陈旧，而非静默当真。
            ...(modelParamsState.lastError !== null ? { staleError: modelParamsState.lastError } : {}),
          },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 首页状态总览（零网络：settings + pi-ai 目录 + 侧车）─────────────────────
    'models2-snapshot': { feature: 'modelCatalog', handle: async () => {
      try {
        const piIndex = await ensurePiCatalog()
        const sidecar = workbenchStore === undefined ? { providers: {}, validations: {}, recovery: {} } : await workbenchStore.load()
        const builtinIds = piIndex.channelIds
        const routes = await Promise.all(readLlmProfiles(ctx.get('settings')).map(async (profile) => {
          const models = Array.isArray(profile.models) ? profile.models : []
          // 空 models = 继承默认，不算非法；内置渠道的能力字段由目录继承 → looseCapabilities。
          const structureOk = models.length === 0 ? true : selfCheckModelsPatch(models, { looseCapabilities: builtinIds.has(profile.route) }).ok
          const rawValidation = sidecar.validations?.[profile.route]
          const lastValidation = rawValidation !== null && typeof rawValidation === 'object' && !Array.isArray(rawValidation) ? rawValidation : undefined
          const credentialState = await credentialStateOf(profile)
          const attention = []
          if (credentialState === 'dangling' || credentialState === 'invalid-ref') attention.push('dangling-credential')
          if (lastValidation?.ok === false) attention.push('validation-failed')
          if (sidecar.recovery?.[profile.route] !== undefined) attention.push('recovery-pending')
          if (!structureOk) attention.push('invalid-profile')
          const undoSnapshot = sidecar.providers?.[profile.route]
          // 内置渠道的能力计数按「显式值或目录已提供」的有效口径算（避免带思考等级却显示 0）。
          const catalogRecordFor = (modelId) => {
            for (const record of piIndex.byModelId.get(modelId) ?? []) {
              if (record.channel === profile.route) return record
            }
            return undefined
          }
          const metaCounts = { contextWindow: 0, inputImage: 0, reasoning: 0 }
          for (const model of models) {
            const record = catalogRecordFor(model?.id)
            if ((Number.isInteger(model?.contextWindow) && model.contextWindow > 0) || (record !== undefined && Number.isInteger(record.contextWindow) && record.contextWindow > 0)) metaCounts.contextWindow += 1
            if ((Array.isArray(model?.input) && model.input.includes('image')) || (record !== undefined && Array.isArray(record.input) && record.input.includes('image'))) metaCounts.inputImage += 1
            if (model?.reasoningEfforts !== undefined || (record !== undefined && (record.reasoningEfforts !== undefined || record.reasoning === true))) metaCounts.reasoning += 1
          }
          return {
            route: profile.route,
            displayName: profile.displayName,
            source: builtinIds.has(profile.route) ? 'builtin' : 'custom',
            baseURL: resolveLlmProfileBaseURL(profile, piIndex),
            api: profile.api,
            modelCount: models.length,
            metaCounts,
            credentialState,
            lastValidation,
            undoable: undoSnapshot !== undefined,
            ...(undoSnapshot !== undefined ? { undoAt: undoSnapshot.at } : {}),
            attention,
            needsAttention: attention.length > 0,
          }
        }))
        // 需处理优先 → 最近验证时间倒序（从未验证殿后）→ 显示名。
        routes.sort((a, b) => {
          if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1
          const atA = a.lastValidation?.at ?? 0
          const atB = b.lastValidation?.at ?? 0
          if (atA !== atB) return atB - atA
          return a.displayName.localeCompare(b.displayName)
        })
        return { ok: true, value: { routes } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 单路由完整 profile（手动编辑器基线；保真读取，含未知字段）──────────────
    'models2-route': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        const profile = profileFor(route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        const piIndex = await ensurePiCatalog()
        return {
          ok: true,
          value: {
            route,
            displayName: profile.displayName,
            baseURL: resolveLlmProfileBaseURL(profile, piIndex),
            api: profile.api,
            apiKeyEnv: profile.apiKeyEnv,
            models: profile.models,
          },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 检查：目录级（零网络）或显式探测（probe: true 才发网）─────────────────
    'models2-inspect': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        const probe = payload?.probe === true
        const profile = profileFor(route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        const piIndex = await ensurePiCatalog()
        const effectiveBaseURL = resolveLlmProfileBaseURL(profile, piIndex)
        if (effectiveBaseURL === '') return fail('no-base-url')
        const connection = { baseURL: effectiveBaseURL, probed: probe }
        let gatewayRows = []
        if (probe) {
          // 显式启动检查即授权该路由使用已存凭据（仅发往该路由当前地址，不回显不落日志）。
          const apiKey = await resolveCredential(profile)
          connection.usedCredential = apiKey !== undefined
          if (profile.api !== '' && !MODELS_PROBE_PROTOCOLS.has(profile.api)) {
            // anthropic-messages 等无标准列表协议：在线发现不受支持，不判失败，降级继续。
            connection.ok = false
            connection.error = 'probe-protocol-unsupported'
          } else {
            try {
              gatewayRows = await fetchModelsProbe(effectiveBaseURL, apiKey)
              connection.ok = true
              connection.modelCount = gatewayRows.length
            } catch (error) {
              connection.ok = false
              connection.error = error?.message || String(error)
            }
          }
        }
        const bindings = workbenchStore === undefined ? {} : (await workbenchStore.load()).bindings?.[route] ?? {}
        let suggestions = arbitrateModelSuggestions({
          route,
          routeBaseURL: effectiveBaseURL,
          currentModels: profile.models,
          gatewayModels: gatewayRows,
          resolveModelMeta: (modelId) => orderedCandidates(piIndex, route, modelId),
          bindings,
        })
        // 未探测或无在线清单：unknown（已配置但网关未返回）无从判定，过滤掉。
        if (connection.ok !== true) suggestions = suggestions.filter((row) => row.kind !== 'unknown')
        const inspectId = randomUUID()
        rememberHandle(inspections, inspectId, { route, suggestions, expires: Date.now() + WORKBENCH_PLAN_TTL_MS })
        const summary = {}
        for (const row of suggestions) summary[row.kind] = (summary[row.kind] ?? 0) + 1
        return { ok: true, value: { inspectId, route, connection, summary, suggestions } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 准备：把选中的 sid 重放成新模型表 + 字段级 diff（不写盘）────────────────
    'models2-prepare': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const inspectId = typeof payload?.inspectId === 'string' ? payload.inspectId : ''
        const inspection = takeHandle(inspections, inspectId)
        if (inspection === undefined) return fail('unknown-inspection')
        if (Date.now() > inspection.expires) return fail('plan-expired')
        const profile = profileFor(inspection.route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        const sids = Array.isArray(payload?.sids) ? payload.sids.filter((sid) => typeof sid === 'string') : []
        // 零输入拼接：客户端只能回传 sid，取值全部来自服务端仲裁清单重放。
        const nextModels = applySuggestions(profile.models, inspection.suggestions, sids)
        const checked = selfCheckModelsPatch(nextModels)
        if (!checked.ok) return fail('schema-invalid', checked.errors.join(';'))
        const planId = planIdFor(`${inspection.route}:${randomUUID()}`)
        const expires = Date.now() + WORKBENCH_PLAN_TTL_MS
        rememberHandle(plans, planId, { route: inspection.route, nextModels, sids, baseFingerprint: profileFingerprint(profile), expires })
        return { ok: true, value: { planId, route: inspection.route, expires, diff: diffModelLists(profile.models, nextModels), selected: sids.length } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 提交：重读比对（漂移即 conflict）→ 写入 → 持久化写前快照 ────────────────
    'models2-commit': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const planId = typeof payload?.planId === 'string' ? payload.planId : ''
        const plan = takeHandle(plans, planId)
        if (plan === undefined) return fail('unknown-plan')
        if (Date.now() > plan.expires) return fail('plan-expired')
        const settingsService = ctx.get('settings')
        const profile = profileFor(plan.route, settingsService)
        if (profile === undefined) return fail('route-gone')
        // 补偿未恢复的阻断态：恢复前禁止对该路由的任何自动写入。
        if (workbenchStore !== undefined && (await workbenchStore.load()).recovery?.[plan.route] !== undefined) return fail('recovery-pending')
        // 冲突检测：计划生成后配置有任何漂移（含 baseURL/凭据引用/未知字段）→ 拒绝并要求重算。
        if (profileFingerprint(profile) !== plan.baseFingerprint) return fail('conflict')
        const undoSnapshot = { models: profile.models, at: Date.now() }
        await settingsService.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', plan.route, 'models'], value: plan.nextModels }])
        // 写后持久化撤销快照（只存模型数组，不含密钥值）；落盘失败仅降级撤销能力。
        let undoable = true
        if (workbenchStore !== undefined) {
          try {
            await workbenchStore.mutate((sidecar) => {
              if (sidecar.providers === undefined) sidecar.providers = {}
              sidecar.providers[plan.route] = undoSnapshot
            })
          } catch (_) {
            undoable = false
          }
        } else {
          undoable = false
        }
        return { ok: true, value: { route: plan.route, applied: plan.sids.length, undoable } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 撤销预览：快照 vs 当前，逐字段列出可恢复项 ─────────────────────────────
    'models2-undo-preview': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        if (workbenchStore === undefined) return fail('nothing-to-undo')
        const snapshot = (await workbenchStore.load()).providers?.[route]
        if (snapshot === undefined) return fail('nothing-to-undo')
        const profile = profileFor(route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        return { ok: true, value: { route, at: snapshot.at, ...undoPreviewModels(snapshot.models, profile.models) } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 撤销提交：只回滚快照能证明的字段差异；成功才清槽（失败可重试）───────────
    'models2-undo-commit': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        if (workbenchStore === undefined) return fail('nothing-to-undo')
        if ((await workbenchStore.load()).recovery?.[route] !== undefined) return fail('recovery-pending')
        const snapshot = (await workbenchStore.load()).providers?.[route]
        if (snapshot === undefined) return fail('nothing-to-undo')
        const settingsService = ctx.get('settings')
        const profile = profileFor(route, settingsService)
        if (profile === undefined) return fail('route-gone')
        const nextModels = applyUndo(snapshot.models, profile.models, {
          dropAdded: payload?.dropAdded === true,
          restoreRemoved: payload?.restoreRemoved === true,
        })
        const checked = selfCheckModelsPatch(nextModels)
        if (!checked.ok) return fail('schema-invalid', checked.errors.join(';'))
        await settingsService.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', route, 'models'], value: nextModels }])
        await workbenchStore.mutate((sidecar) => { if (sidecar.providers !== undefined) delete sidecar.providers[route] })
        return { ok: true, value: { route, restored: true } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 新建：连接信息 → 检查 → 候选（临时密钥只进任务内存）─────────────────────
    'models2-create-begin': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const displayName = typeof payload?.displayName === 'string' ? payload.displayName.trim().slice(0, 128) : ''
        const baseURL = typeof payload?.baseURL === 'string' ? payload.baseURL.trim().slice(0, 2048) : ''
        const api = typeof payload?.api === 'string' ? payload.api : ''
        const key = typeof payload?.key === 'string' ? payload.key.trim() : ''
        if (displayName === '') return fail('bad-display-name')
        if (!MODELS_PROTOCOLS.includes(api)) return fail('bad-api')
        if (hostnameOf(baseURL) === undefined) return fail('bad-base-url')
        if (key.length > MAX_MODELS_KEY_LENGTH) return fail('bad-key')
        const taken = readLlmProfiles(ctx.get('settings')).map((profile) => profile.route)
        const explicitRoute = typeof payload?.route === 'string' ? payload.route.trim().slice(0, 64) : ''
        const routeId = explicitRoute !== '' && MODELS_ROUTE_RE.test(explicitRoute) ? explicitRoute : suggestRouteId(displayName, taken)
        if (taken.includes(routeId)) return fail('route-taken')
        const piIndex = await ensurePiCatalog()
        const expires = Date.now() + WORKBENCH_PLAN_TTL_MS
        const connection = { usedTempKey: key !== '' }
        let gatewayRows = []
        if (!MODELS_PROBE_PROTOCOLS.has(api)) {
          connection.ok = false
          connection.error = 'probe-protocol-unsupported'
        } else {
          try {
            gatewayRows = await fetchModelsProbe(baseURL, key !== '' ? key : undefined)
            connection.ok = true
            connection.modelCount = gatewayRows.length
          } catch (error) {
            connection.ok = false
            connection.error = error?.message || String(error)
          }
        }
        const candidates = arbitrateModelSuggestions({
          route: routeId,
          routeBaseURL: baseURL,
          currentModels: [],
          gatewayModels: gatewayRows,
          resolveModelMeta: (modelId) => orderedCandidates(piIndex, routeId, modelId),
          bindings: {},
        }).filter((row) => row.kind === 'addition')
        const draftId = randomUUID()
        rememberHandle(drafts, draftId, { routeId, displayName, baseURL, api, key, candidates, expires }, 8)
        const summary = {}
        for (const row of candidates) summary[row.kind] = (summary[row.kind] ?? 0) + 1
        return { ok: true, value: { draftId, routeId, connection, summary, candidates, expires } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 新建提交：凭据先行（可恢复）→ settings profile；失败逐级补偿 ─────────────
    'models2-create-commit': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const draftId = typeof payload?.draftId === 'string' ? payload.draftId : ''
        const draft = takeHandle(drafts, draftId)
        if (draft === undefined) return fail('unknown-draft')
        if (Date.now() > draft.expires) return fail('plan-expired')
        const sids = Array.isArray(payload?.sids) ? payload.sids.filter((sid) => typeof sid === 'string') : []
        const bySid = new Map(draft.candidates.map((row) => [row.sid, row]))
        const unknown = sids.filter((sid) => !bySid.has(sid))
        if (unknown.length > 0) return fail('unknown-suggestion', unknown.join(','))
        const models = sids.map((sid) => {
          const clean = {}
          for (const [field, value] of Object.entries(bySid.get(sid).draft ?? {})) {
            if (field !== 'inexpressible' && field !== 'selected' && field !== 'source' && value !== undefined) clean[field] = value
          }
          return clean
        }).filter((row) => typeof row.id === 'string' && row.id !== '')
        // 手填模型：仅允许 ID，wire-id 契约校验 + 去重。
        const manualIds = Array.isArray(payload?.manualIds) ? payload.manualIds.filter((id) => typeof id === 'string') : []
        const seen = new Set(models.map((row) => row.id))
        for (const rawId of manualIds) {
          const id = rawId.trim().slice(0, MAX_MODEL_ID_LENGTH)
          if (id === '' || !MODEL_ID_RE.test(id)) return fail('schema-invalid', `${id.slice(0, 64)}|bad-id`)
          if (!seen.has(id)) { seen.add(id); models.push({ id }) }
        }
        if (models.length === 0) return fail('no-models')
        const checked = selfCheckModelsPatch(models)
        if (!checked.ok) return fail('schema-invalid', checked.errors.join(';'))
        const settingsService = ctx.get('settings')
        if (readLlmProfiles(settingsService).some((profile) => profile.route === draft.routeId)) return fail('route-taken')
        const keyRef = deriveKeyRefFor(draft.routeId)
        let credentialStored = false
        if (draft.key !== '') {
          const credentials = ctx.get('credentials')
          // 凭据先行：此刻失败时 settings 尚未写，天然无半提交。
          if (credentials === undefined || typeof credentials.set !== 'function' || !MODELS_KEY_REF_RE.test(keyRef)) return fail('credential-rejected')
          await credentials.set(keyRef, draft.key)
          credentialStored = true
        }
        const profile = buildRouteCreateProfile({
          route: draft.routeId,
          displayName: draft.displayName,
          api: draft.api,
          baseURL: draft.baseURL,
          models,
          storesKey: credentialStored,
        })
        try {
          await settingsService.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', draft.routeId], value: profile }])
        } catch (error) {
          // settings 失败 → 逐级补偿：删新凭据；连回滚都失败 → 人工恢复阻断态。
          if (credentialStored) {
            const credentials = ctx.get('credentials')
            try {
              if (credentials !== undefined && typeof credentials.unset === 'function') await credentials.unset(keyRef)
            } catch (_) {
              if (workbenchStore !== undefined) {
                try {
                  await workbenchStore.mutate((sidecar) => {
                    if (sidecar.recovery === undefined) sidecar.recovery = {}
                    sidecar.recovery[draft.routeId] = { reason: 'credential-rollback-failed', keyRef, at: Date.now() }
                  })
                } catch (_) {}
              }
            }
          }
          return fail('create-failed', error?.message || String(error))
        }
        // 临时密钥用完即弃（任务内存不保留）。
        draft.key = ''
        return { ok: true, value: { route: draft.routeId, models: models.length, credentialStored } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 人工恢复解除（补偿失败的阻断态）───────────────────────────────────────
    'models2-recovery-resolve': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        if (workbenchStore === undefined) return fail('nothing-to-resolve')
        const sidecar = await workbenchStore.load()
        if (sidecar.recovery?.[route] === undefined) return fail('nothing-to-resolve')
        await workbenchStore.mutate((current) => { if (current.recovery !== undefined) delete current.recovery[route] })
        return { ok: true, value: { route, resolved: true } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 验证：默认四项无推理检查 + 可选深度最小真实调用（显式确认由客户端承载）────
    'models2-validate': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        const profile = profileFor(route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        const deep = payload?.deep === true
        const models = (Array.isArray(profile.models) ? profile.models : []).map((row) => row?.id).filter((id) => typeof id === 'string' && id !== '')
        if (deep && models.length === 0) return fail('no-models')
        const testModelId = models.length > 0 ? models[0] : undefined
        const llm = ctx.get('llm')
        const checks = [{ type: 'settings', ok: true }]
        if (llm === undefined) {
          // 服务缺席标跳过，不判失败。
          checks.push({ type: 'providers', ok: true, skipped: true })
          checks.push({ type: 'models', ok: true, skipped: true })
        } else {
          let providersOk = false
          try {
            // 0.1.6-alpha.2 契约：listProviders() 同步返回 LlmProviderInfo[] = {id, name}——
            // 路由键是 `id`（旧分支写的 `entry.provider` 在该版本恒为 undefined，会误报 provider-missing）。
            const providers = await llm.listProviders()
            providersOk = Array.isArray(providers) && providers.some((entry) => {
              if (entry !== null && typeof entry === 'object') return entry.id === route || entry.provider === route
              return String(entry) === route
            })
          } catch (_) {}
          checks.push({ type: 'providers', ok: providersOk, ...(providersOk ? {} : { error: 'provider-missing' }) })
          if (models.length === 0) {
            checks.push({ type: 'models', ok: true, skipped: true })
          } else {
            let resolved = true
            let failId = null
            try {
              const listed = await llm.listModels(route)
              const listedIds = new Set(Array.isArray(listed) ? listed.map((entry) => (
                entry !== null && typeof entry === 'object' && typeof entry.id === 'string' ? entry.id : String(entry)
              )) : [])
              failId = models.find((id) => !listedIds.has(id))
              if (failId === undefined || failId === null) {
                for (const id of models) {
                  try {
                    await llm.resolveModelInfo(route, id)
                  } catch (_) {
                    resolved = false
                    failId = id
                    break
                  }
                }
              } else {
                resolved = false
              }
            } catch (_) {
              resolved = false
              failId = models[0]
            }
            checks.push({ type: 'models', ok: resolved, ...(resolved ? { modelCount: models.length } : { error: 'resolve-model-missing', modelId: failId }) })
          }
        }
        const credentials = ctx.get('credentials')
        if (profile.apiKeyEnv === '' || !MODELS_KEY_REF_RE.test(profile.apiKeyEnv)) {
          checks.push({ type: 'credential', ok: true })
        } else if (credentials === undefined || typeof credentials.resolve !== 'function') {
          checks.push({ type: 'credential', ok: true, skipped: true })
        } else {
          try {
            const resolved = await credentials.resolve(profile.apiKeyEnv)
            const hasValue = typeof resolved?.value === 'string' && resolved.value !== ''
            checks.push(hasValue ? { type: 'credential', ok: true } : { type: 'credential', ok: false, error: 'credential-unresolvable' })
          } catch (_) {
            checks.push({ type: 'credential', ok: false, error: 'credential-unresolvable' })
          }
        }
        if (deep) {
          if (llm === undefined || typeof llm.stream !== 'function') return fail('llm-service-missing')
          // 有界最小真实调用：固定提示词 + maxTokens 16 + 15s 超时；正文不展示不持久化，
          // 只记成功/耗时/首块。「可能计费」的再次确认由客户端承载。
          const started = Date.now()
          try {
            const signal = AbortSignal.timeout(15000)
            const stream = await llm.stream({
              provider: route,
              model: testModelId,
              messages: [
                { role: 'system', content: 'Reply with OK.' },
                { role: 'user', content: 'ping' },
              ],
              maxTokens: 16,
              signal,
            })
            for await (const _chunk of stream) break
            checks.push({ type: 'stream', ok: true, durationMs: Date.now() - started, firstChunk: true })
          } catch (error) {
            const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'stream-failed'
            checks.push({ type: 'stream', ok: false, durationMs: Date.now() - started, error: code })
          }
        }
        const ok = checks.every((check) => check.ok === true)
        const summary = {
          at: Date.now(),
          ok,
          checks,
          ...(testModelId !== undefined ? { modelId: testModelId } : {}),
          ...(deep ? { deep: true } : {}),
        }
        if (workbenchStore !== undefined) {
          // 摘要持久化失败仅降级为「下次不再可见」，不阻断结果展示。
          try {
            await workbenchStore.mutate((sidecar) => {
              if (sidecar.validations === undefined) sidecar.validations = {}
              sidecar.validations[route] = summary
            })
          } catch (_) {}
        }
        return { ok: true, value: summary }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 手动编辑器：整表提交，宿主侧同一道 schema 自检兜底 ───────────────────────
    'models2-edit-prepare': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        const profile = profileFor(route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        if (!Array.isArray(payload?.models)) return fail('bad-models')
        const nextModels = payload.models.map((model) => (model !== null && typeof model === 'object' ? { ...model } : model))
        const checked = selfCheckModelsPatch(nextModels)
        if (!checked.ok) return fail('schema-invalid', checked.errors.join(';'))
        const diff = diffModelLists(profile.models, nextModels)
        if (diff.changes.length + diff.added.length + diff.removed.length === 0) return { ok: true, value: { noop: true } }
        const planId = planIdFor(`${route}:edit:${randomUUID()}`)
        const expires = Date.now() + WORKBENCH_PLAN_TTL_MS
        const appliedCount = diff.changes.length + diff.added.length + diff.removed.length
        rememberHandle(plans, planId, { route, nextModels, sids: [], baseFingerprint: profileFingerprint(profile), appliedCount, expires })
        return { ok: true, value: { planId, route, expires, diff, appliedCount } }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },
    // ── 移除预览（守卫）：静态引用检测 + 可迁移目标清单 ──────────────────────────
    'models2-remove-preview': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        const profile = profileFor(route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        const removeIds = Array.isArray(payload?.removeIds)
          ? payload.removeIds.filter((id) => typeof id === 'string').map((id) => id.slice(0, MAX_MODEL_ID_LENGTH))
          : []
        const currentIds = new Set(profile.models.map((model) => model?.id))
        for (const id of removeIds) {
          if (!currentIds.has(id)) return fail('unknown-model', id.slice(0, 64))
        }
        if (removeIds.length === 0) return fail('no-models')
        const remaining = profile.models.filter((model) => !removeIds.includes(model?.id))
        if (remaining.length === 0) return fail('no-models')
        const references = await inspectRemoveReferences(route)
        const hardBlocked = references.some((ref) => ref.kind === 'agent-default-model')
        // 子代理引用只在「被移除的模型正是引用模型」时才需要迁移。
        const subagentRef = references.find((ref) => ref.kind === 'subagent-route' && removeIds.includes(ref.model))
        const migrateOptions = hardBlocked || subagentRef === undefined ? [] : await subagentModelOptions()
        return {
          ok: true,
          value: {
            route,
            models: profile.models.map((model) => ({ id: model?.id ?? '', name: typeof model?.name === 'string' ? model.name : undefined })),
            removeIds,
            remainingCount: remaining.length,
            references,
            blocked: hardBlocked,
            ...(migrateOptions.length > 0 ? { migrateOptions } : {}),
          },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 移除计划：hard block / 必须迁移 / 迁移目标必须在可用清单内 ─────────────────
    'models2-remove-plan': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const route = typeof payload?.route === 'string' ? payload.route : ''
        const profile = profileFor(route, ctx.get('settings'))
        if (profile === undefined) return fail('route-gone')
        const removeIds = Array.isArray(payload?.removeIds)
          ? payload.removeIds.filter((id) => typeof id === 'string').map((id) => id.slice(0, MAX_MODEL_ID_LENGTH))
          : []
        const currentIds = new Set(profile.models.map((model) => model?.id))
        for (const id of removeIds) {
          if (!currentIds.has(id)) return fail('unknown-model', id.slice(0, 64))
        }
        if (removeIds.length === 0) return fail('no-models')
        if (profile.models.filter((model) => !removeIds.includes(model?.id)).length === 0) return fail('no-models')
        const references = await inspectRemoveReferences(route)
        if (references.some((ref) => ref.kind === 'agent-default-model')) return fail('removal-blocked')
        const hasSubagentRef = references.some((ref) => ref.kind === 'subagent-route' && removeIds.includes(ref.model))
        const migrateTo = payload?.migrateTo !== null && typeof payload?.migrateTo === 'object' ? payload.migrateTo : undefined
        if (hasSubagentRef && migrateTo === undefined) return fail('migration-required')
        if (!hasSubagentRef && migrateTo !== undefined) return fail('no-migration-needed')
        let normalizedMigration
        if (hasSubagentRef) {
          const provider = typeof migrateTo?.provider === 'string' ? migrateTo.provider.trim() : ''
          const model = typeof migrateTo?.model === 'string' ? migrateTo.model.trim() : ''
          if (provider === '' || model === '') return fail('invalid-model-route')
          // 迁移目标必须仍在宿主可用清单内（拒绝客户端自造路由）。
          const options = await subagentModelOptions()
          if (!options.some((group) => group.provider === provider && group.models.some((row) => row.id === model))) return fail('invalid-model-route')
          normalizedMigration = { provider: provider.slice(0, 256), model: model.slice(0, 256) }
        }
        const planId = planIdFor(`${route}:remove:${randomUUID()}`)
        const expires = Date.now() + WORKBENCH_PLAN_TTL_MS
        rememberHandle(plans, planId, {
          route,
          kind: 'remove',
          removeIds,
          originalModels: profile.models.map((model) => (model !== null && typeof model === 'object' ? { ...model } : model)),
          baseFingerprint: profileFingerprint(profile),
          appliedCount: removeIds.length,
          ...(normalizedMigration !== undefined ? { migrateTo: normalizedMigration } : {}),
          expires,
        })
        return {
          ok: true,
          value: {
            planId,
            route,
            expires,
            removed: removeIds.length,
            ...(normalizedMigration !== undefined ? { migrateTo: normalizedMigration } : {}),
          },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },

    // ── 移除提交：模型移除与子代理迁移同处一个跨侧车事务，任一步失败立即补偿 ───────
    'models2-remove-commit': { feature: 'modelCatalog', handle: async (payload) => {
      try {
        const planId = typeof payload?.planId === 'string' ? payload.planId : ''
        const plan = takeHandle(plans, planId)
        if (plan === undefined || plan.kind !== 'remove') return fail('unknown-plan')
        if (Date.now() > plan.expires) return fail('plan-expired')
        const settingsService = ctx.get('settings')
        const profile = profileFor(plan.route, settingsService)
        if (profile === undefined) return fail('route-gone')
        if (workbenchStore !== undefined && (await workbenchStore.load()).recovery?.[plan.route] !== undefined) return fail('recovery-pending')
        if (profileFingerprint(profile) !== plan.baseFingerprint) return fail('conflict')
        const nextModels = profile.models.filter((model) => !plan.removeIds.includes(model?.id))
        try {
          await settingsService.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', plan.route, 'models'], value: nextModels }])
        } catch (error) {
          return fail('remove-failed', error?.message || String(error))
        }
        if (plan.migrateTo !== undefined) {
          // 子代理迁移与模型移除同处一个跨侧车事务：任一步失败立即补偿（写回原模型）。
          try {
            await writeSubagentRoute(async (config) => {
              config.mode = 'custom'
              config.provider = plan.migrateTo.provider
              config.model = plan.migrateTo.model
              delete config.reasoningEffort
              return { save: true }
            })
          } catch (error) {
            try {
              await settingsService.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', plan.route, 'models'], value: plan.originalModels }])
            } catch (compError) {
              // 补偿也失败 → 人工恢复阻断态，恢复前禁止对该路由的自动写入。
              if (workbenchStore !== undefined) {
                try {
                  await workbenchStore.mutate((sidecar) => {
                    if (sidecar.recovery === undefined) sidecar.recovery = {}
                    sidecar.recovery[plan.route] = { reason: 'remove-rollback-failed', at: Date.now() }
                  })
                } catch (_) {}
              }
              return fail('remove-failed', compError?.message || String(compError))
            }
            return fail('remove-failed', error?.message || String(error))
          }
        }
        // 写后撤销快照：移除可撤销（恢复被移除模型）。
        let undoable = true
        if (workbenchStore !== undefined) {
          try {
            await workbenchStore.mutate((sidecar) => {
              if (sidecar.providers === undefined) sidecar.providers = {}
              sidecar.providers[plan.route] = { models: plan.originalModels, at: Date.now() }
            })
          } catch (_) {
            undoable = false
          }
        } else {
          undoable = false
        }
        return {
          ok: true,
          value: {
            route: plan.route,
            removed: plan.removeIds.length,
            ...(plan.migrateTo !== undefined ? { migrated: true } : {}),
            undoable,
          },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    } },
  }
}
