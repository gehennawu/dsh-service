// 子代理模型路由（subagent）的 RPC 端点：从 apply 的端点表按功能域拆出。
// 依赖显式注入（工厂解构名单即本模块完整依赖面）；handler 体与拆分前一致，
// 例外：可重赋值的 let（subagentRouteConfig/subagentSeamInstalled）以 { current } 箱体注入保活绑定。
// 注意：客户端半有单产物约束，宿主半无此约束——兄弟 ESM 模块是本仓库既有惯例
// （quota-adapters.js / backup-integrity.js / plugin-health.js / plugin-compat.js）。

export function createSubagentRoutes({
  ctx,
  dispatchRing,
  serializeSubagentRouteWrite,
  subagentRouteRef,
  subagentRouteLoadPromise,
  subagentSeamRef,
  MAX_SUBAGENT_ROUTE_FIELD,
  SUBAGENT_ROUTE_FALLBACK_MAX,
  SUBAGENT_ROUTE_MODES,
  listSubagentDispatches,
  listSubagentModels,
  rpcTechnicalFailure,
}) {
  return {
    'subagent-route': { feature: 'subagentRoute', handle: async (payload, rpcEndpoint) => {
      try {
        await subagentRouteLoadPromise
        const llm = ctx.get('llm')
        // 模型清单沿用 skills-models 的白名单口径（llm.listProviders × listModels，单渠道失败跳过），
        // 并对每个精确模型附加 adapter 的 reasoning metadata（resolveModelInfo 缺席时保留原目录项）；
        // llm 服务缺席时清单为空——自定义模式在保存端也会被拒（llm-unavailable），快照仍可下发。
        let models = []
        let current
        if (llm !== undefined && typeof llm.listProviders === 'function') {
          const catalog = await listSubagentModels(llm, ctx.get('agentDefaultModel'))
          models = catalog.models
          current = catalog.current
        }
        const config = subagentRouteRef.current
        // 自定义路由草稿（v1.4.12）：三模式统一下发——客户端据此回填表单，切换模式不丢配置。
        const routePresent = typeof config.provider === 'string' && config.provider !== '' && typeof config.model === 'string' && config.model !== ''
        return {
          ok: true,
          value: {
            available: subagentSeamRef.current,
            mode: config.mode,
            ...(routePresent ? {
              provider: config.provider,
              model: config.model,
              ...(typeof config.reasoningEffort === 'string' && config.reasoningEffort !== '' ? { reasoningEffort: config.reasoningEffort } : {}),
            } : {}),
            ...(Array.isArray(config.fallbacks) && config.fallbacks.length > 0 ? { fallbacks: config.fallbacks } : {}),
            models,
            ...(current !== undefined ? { current } : {}),
          },
        }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'subagent-dispatches': { feature: 'subagentRoute', handle: async (payload, rpcEndpoint) => {
      try {
        const records = listSubagentDispatches(dispatchRing, payload)
        return { ok: true, value: { records } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'subagent-route-save': { feature: 'subagentRoute', audit: true, handle: async (payload, rpcEndpoint) => {
      const mode = payload?.mode
      if (!SUBAGENT_ROUTE_MODES.includes(mode)) return { ok: false, error: 'unknown-mode' }
      try {
        let whitelist
        const loadWhitelist = async () => {
          if (whitelist === undefined) {
            const llm = ctx.get('llm')
            if (llm === undefined || typeof llm.stream !== 'function') return null
            whitelist = await listSubagentModels(llm, ctx.get('agentDefaultModel'))
          }
          return whitelist
        }
        const primary = { mode }
        if (mode === 'custom') {
          const provider = typeof payload?.provider === 'string' ? payload.provider.trim() : ''
          const model = typeof payload?.model === 'string' ? payload.model.trim() : ''
          if (provider === '' || model === '') return { ok: false, error: 'invalid-model-route' }
          const catalog = await loadWhitelist()
          if (catalog === null) return { ok: false, error: 'llm-unavailable' }
          // 与 skills-describe 同一道闸：provider/model 必须命中运行时清单白名单；同时取该
          // exact model 的 adapter reasoning metadata 用于校验 reasoningEffort 是否受支持。
          const modelEntry = catalog.models.find((item) => item.provider === provider && item.id === model)
          if (modelEntry === undefined) return { ok: false, error: 'invalid-model-route' }
          const rawEffort = payload?.reasoningEffort
          if (rawEffort !== undefined && rawEffort !== '') {
            if (typeof rawEffort !== 'string') return { ok: false, error: 'invalid-reasoning-effort' }
            const effort = rawEffort.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD)
            if (effort !== '') {
              if (!(modelEntry.reasoning?.efforts ?? []).some((entry) => entry.id === effort)) return { ok: false, error: 'invalid-reasoning-effort' }
              primary.reasoningEffort = effort
            }
          }
          primary.provider = provider.slice(0, MAX_SUBAGENT_ROUTE_FIELD)
          primary.model = model.slice(0, MAX_SUBAGENT_ROUTE_FIELD)
        }
        // 回退列表（v1.1）：custom 与 follow 共用；每条与主路由同一道白名单闸，条目非法整体拒绝。
        const fallbacks = []
        const rawFallbacks = Array.isArray(payload?.fallbacks) ? payload.fallbacks : []
        if (rawFallbacks.length > 0 && mode !== 'inherit') {
          const catalog = await loadWhitelist()
          if (catalog === null) return { ok: false, error: 'llm-unavailable' }
          for (const entry of rawFallbacks) {
            if (fallbacks.length >= SUBAGENT_ROUTE_FALLBACK_MAX) break
            if (entry === null || typeof entry !== 'object') return { ok: false, error: 'invalid-fallback-route' }
            const provider = typeof entry.provider === 'string' ? entry.provider.trim() : ''
            const model = typeof entry.model === 'string' ? entry.model.trim() : ''
            const modelEntry = catalog.models.find((item) => item.provider === provider && item.id === model)
            if (modelEntry === undefined) return { ok: false, error: 'invalid-fallback-route' }
            let effort = ''
            const rawEffort = entry.reasoningEffort
            if (rawEffort !== undefined && rawEffort !== '') {
              if (typeof rawEffort !== 'string') return { ok: false, error: 'invalid-fallback-route' }
              const trimmed = rawEffort.trim().slice(0, MAX_SUBAGENT_ROUTE_FIELD)
              if (trimmed !== '' && !(modelEntry.reasoning?.efforts ?? []).some((candidate) => candidate.id === trimmed)) return { ok: false, error: 'invalid-fallback-route' }
              effort = trimmed
            }
            const normalized = { provider: provider.slice(0, MAX_SUBAGENT_ROUTE_FIELD), model: model.slice(0, MAX_SUBAGENT_ROUTE_FIELD), ...(effort !== '' ? { reasoningEffort: effort } : {}) }
            if (fallbacks.some((candidate) => candidate.provider === normalized.provider && candidate.model === normalized.model)) continue
            fallbacks.push(normalized)
          }
        }
        return await serializeSubagentRouteWrite(async (config) => {
          config.mode = mode
          if (mode === 'custom') {
            config.provider = primary.provider
            config.model = primary.model
            // 先删旧值，只有新值非空时才写入：空/未提供代表「使用模型默认」。
            delete config.reasoningEffort
            if (primary.reasoningEffort !== undefined) config.reasoningEffort = primary.reasoningEffort
          }
          // follow / inherit（v1.4.12 草稿保留）：不携带 provider/model/reasoningEffort 时已保存的
          // 自定义路由原样保留（此时不生效，切回 custom 即恢复），切换模式不再销毁配置。
          // 回退列表：custom/follow 页面渲染完整编辑器、总是全量提交（缺省/空 = 清空）；inherit
          // 页面没有回退编辑器、payload 不会携带 → 保留原值（resolveSubagentInjection 对 inherit
          // 零消费，纯函数层纵深防御不变）。
          if (mode !== 'inherit') {
            if (fallbacks.length > 0) config.fallbacks = fallbacks
            else delete config.fallbacks
          }
          const routePresent = typeof config.provider === 'string' && config.provider !== '' && typeof config.model === 'string' && config.model !== ''
          return { value: { ok: true, mode: config.mode, ...(routePresent ? {
            provider: config.provider,
            model: config.model,
            ...(typeof config.reasoningEffort === 'string' && config.reasoningEffort !== '' ? { reasoningEffort: config.reasoningEffort } : {}),
          } : {}), ...(Array.isArray(config.fallbacks) && config.fallbacks.length > 0 ? { fallbacks: config.fallbacks } : {}) } }
        })
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
  }
}
