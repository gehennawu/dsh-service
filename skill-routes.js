// 技能管理（skills）的 RPC 端点：从 apply 的端点表按功能域拆出。
// 依赖显式注入（工厂解构名单即本模块完整依赖面）；handler 体与拆分前一致，
// 例外：可重赋值的 let（skillsBatch/skillsIndexPromise）以 { current } 箱体注入保活绑定。
// 注意：客户端半有单产物约束，宿主半无此约束——兄弟 ESM 模块是本仓库既有惯例
// （quota-adapters.js / backup-integrity.js / plugin-health.js / plugin-compat.js）。

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export function createSkillsRoutes({
  ctx,
  describeJobs,
  dshHome,
  makeDescribeJobLogger,
  registerSkillCall,
  serializeSkillsIndexWrite,
  skillFileCache,
  skillsActiveControllers,
  skillsBatchRef,
  skillsIndexRef,
  SKILL_DESCRIPTION_MAX_CHARS,
  SKILL_USAGE_MAX_CHARS,
  bodyHashOf,
  describeSkillDraft,
  evaluateSkillFile,
  fixLegacySkillInvocationKeys,
  listSkillModels,
  locateSkillFrontmatter,
  mutateSkillEntryById,
  name,
  normalizeSkillDescribeLang,
  publicSkillEntry,
  rpcTechnicalFailure,
  sanitizeSkillDraftText,
  scanSkillEntries,
  selectSkillBatchCandidates,
  setSkillInvocationKey,
}) {
  return {
    'skills-list': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
      try {
        const index = await skillsIndexRef.current
        const { roots, entries } = await scanSkillEntries(ctx, dshHome, skillFileCache)
        return {
          ok: true,
          value: {
            roots: roots.map(({ source, dir, writable }) => ({ source, dir, writable })),
            entries: entries.map((entry) => publicSkillEntry(entry, index)),
            llmAvailable: ctx.get('llm') !== undefined,
          },
        }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-models': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
      try {
        return { ok: true, value: await listSkillModels(llm, ctx.get('agentDefaultModel')) }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-toggle': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const field = payload?.field === 'model' || payload?.field === 'user' ? payload.field : null
      if (field === null) return { ok: false, error: 'invalid-field' }
      if (typeof payload?.enable !== 'boolean') return { ok: false, error: 'invalid-enable' }
      try {
        const index = await skillsIndexRef.current
        const outcome = await mutateSkillEntryById(ctx, dshHome, index, payload?.id, false, (raw) => ({ text: setSkillInvocationKey(raw, field, payload.enable) }), skillFileCache)
        if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) }
        return { ok: true, value: { entry: outcome.entry } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-fix-keys': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const index = await skillsIndexRef.current
        const outcome = await mutateSkillEntryById(ctx, dshHome, index, payload?.id, true, (raw) => {
          const fixed = fixLegacySkillInvocationKeys(raw)
          return { text: fixed.text }
        }, skillFileCache)
        if (!outcome.ok) return { ok: false, error: outcome.error, ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}) }
        return { ok: true, value: { entry: outcome.entry } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-describe': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
      const provider = typeof payload?.provider === 'string' ? payload.provider : ''
      const model = typeof payload?.model === 'string' ? payload.model : ''
      if (provider === '' || model === '') return { ok: false, error: 'invalid-model-route' }
      try {
        // provider/model 必须命中白名单；条目必须能被签名 ID 重新定位。
        const whitelist = await listSkillModels(llm, ctx.get('agentDefaultModel'))
        if (!whitelist.models.some((item) => item.provider === provider && item.id === model)) return { ok: false, error: 'invalid-model-route' }
        const index = await skillsIndexRef.current
        const { entries } = await scanSkillEntries(ctx, dshHome, skillFileCache)
        const entry = entries.find((candidate) => candidate.id === payload?.id)
        if (entry === undefined) return { ok: false, error: 'unknown-skill' }
        if (entry.invalid !== undefined) return { ok: false, error: 'invalid-skill', detail: entry.invalid }
        const raw = await readFile(entry.path, 'utf8')
        const job = makeDescribeJobLogger(entry.id)
        job.push('located', { name: entry.name ?? '', chars: raw.length })
        // 注册进活动调用表：Fiber 销毁时立即中断，不再僵尸到 90s 超时。
        const call = registerSkillCall()
        try {
          const draft = await describeSkillDraft(llm, entry.name ?? '', raw, provider, model, (code, params) => job.push(code, params), { signal: call.signal, lang: normalizeSkillDescribeLang(payload?.lang) })
          return { ok: true, value: { draft } }
        } finally {
          call.done()
        }
      } catch (error) {
        return rpcTechnicalFailure(error, error?.message === 'describe-timeout' ? { detail: 'timeout' } : {})
      }

    } },
    'skills-describe-log': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
      const job = describeJobs.get(typeof payload?.id === 'string' ? payload.id : '')
      return { ok: true, value: { logs: job ? [...job.logs] : [] } }

    } },
    'skills-note-save': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const description = sanitizeSkillDraftText(payload?.patch?.description, SKILL_DESCRIPTION_MAX_CHARS)
      const usage = sanitizeSkillDraftText(payload?.patch?.usage ?? '', SKILL_USAGE_MAX_CHARS)
      if (description === '') return { ok: false, error: 'invalid-description' }
      try {
        // 注释只进插件侧车索引，绝不写回技能文件；因此不要求条目可写，只要求能被签名 ID 定位。
        const { entries } = await scanSkillEntries(ctx, dshHome, skillFileCache)
        const entry = entries.find((candidate) => candidate.id === payload?.id)
        if (entry === undefined) return { ok: false, error: 'unknown-skill' }
        const index = await serializeSkillsIndexWrite((current) => {
          current[entry.path] = {
            bodyHash: entry.bodyHash,
            note: { description, usage },
            ...(typeof payload?.model === 'string' ? { model: payload.model.slice(0, 120) } : {}),
            at: Date.now(),
          }
          return { value: current }
        })
        return { ok: true, value: { entry: publicSkillEntry({ ...entry }, index) } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-note-clear': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const { entries } = await scanSkillEntries(ctx, dshHome, skillFileCache)
        const entry = entries.find((candidate) => candidate.id === payload?.id)
        if (entry === undefined) return { ok: false, error: 'unknown-skill' }
        const index = await serializeSkillsIndexWrite((current) => {
          delete current[entry.path]
          return { value: current }
        })
        return { ok: true, value: { entry: publicSkillEntry(entry, index) } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-batch-plan': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      // 覆盖竞态守卫：运行中生成新计划会让在途循环错位到新清单，直接拒绝。
      if (skillsBatchRef.current !== null && (skillsBatchRef.current.running || skillsBatchRef.current.phase === 'running')) return { ok: false, error: 'batch-already-running' }
      const provider = typeof payload?.provider === 'string' ? payload.provider : ''
      const model = typeof payload?.model === 'string' ? payload.model : ''
      if (provider === '' || model === '') return { ok: false, error: 'invalid-model-route' }
      try {
        // 与单条 describe 同款白名单：批量路由必须命中 skills-models 清单。
        const llm = ctx.get('llm')
        if (llm === undefined || typeof llm.stream !== 'function') return { ok: false, error: 'llm-unavailable' }
        const whitelist = await listSkillModels(llm, ctx.get('agentDefaultModel'))
        if (!whitelist.models.some((item) => item.provider === provider && item.id === model)) return { ok: false, error: 'invalid-model-route' }
        const index = await skillsIndexRef.current
        const { entries } = await scanSkillEntries(ctx, dshHome, skillFileCache)
        const { candidates, annotated, skipped } = selectSkillBatchCandidates(entries, index)
        const planId = randomUUID()
        // 已注释条目也进计划（单列待客户端确认），体积估算含两者——确认后整批运行。
        const planIds = new Set([...candidates, ...annotated].map((candidate) => candidate.id))
        skillsBatchRef.current = { phase: 'planned', planId, provider, model, candidates, annotated, items: candidates, total: candidates.length + annotated.length, done: 0, failures: [], aborted: false, running: false, current: null, logs: [], estBytes: entries.filter((entry) => planIds.has(entry.id)).reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) }
        return { ok: true, value: { planId, candidates, annotated, skipped, estBytes: skillsBatchRef.current.estBytes } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'skills-batch-run': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      if (skillsBatchRef.current === null || skillsBatchRef.current.planId !== payload?.planId) return { ok: false, error: 'unknown-batch-plan' }
      if (skillsBatchRef.current.running || skillsBatchRef.current.phase === 'done' || skillsBatchRef.current.phase === 'cancelled') return { ok: false, error: 'batch-already-' + (skillsBatchRef.current.running ? 'running' : skillsBatchRef.current.phase) }
      // 已注释条目的强制覆盖确认闸：计划含已注释条目时，客户端必须显式确认
      // （forceAnnotated: true）才允许启动——注释过不等于永远不能再次补全，但覆盖旧注释要有确认。
      const planAnnotated = Array.isArray(skillsBatchRef.current.annotated) ? skillsBatchRef.current.annotated : []
      if (planAnnotated.length > 0 && payload?.forceAnnotated !== true) return { ok: false, error: 'annotated-confirm-required' }
      // 确认后新注释覆盖旧注释：候选 + 已注释合并成一个运行清单，进度口径随之更新。
      skillsBatchRef.current.items = [...(skillsBatchRef.current.candidates ?? []), ...planAnnotated]
      skillsBatchRef.current.total = skillsBatchRef.current.items.length
      skillsBatchRef.current.phase = 'running'
      skillsBatchRef.current.running = true
      // 补全语言在 run 时刻定格（而非 plan 时刻）：计划确认前切换界面语言，按新语言补全。
      skillsBatchRef.current.lang = normalizeSkillDescribeLang(payload?.lang)
      // 批量级 AbortController：取消/销毁时立即中断在途 LLM 调用（不只等当前条目自然结束）。
      const batchCall = registerSkillCall()
      // 有意不 await：批量在后台顺序执行，客户端轮询 skills-batch-status 取进度。
      void (async () => {
        // 扫描一次建立 id→条目映射；逐条只重读目标文件校验新鲜度，不再每条全量重扫五类根。
        let byId = new Map()
        try {
          const { entries } = await scanSkillEntries(ctx, dshHome, skillFileCache)
          byId = new Map(entries.map((entry) => [entry.id, entry]))
        } catch (_) {}
        for (let cursor = 0; cursor < skillsBatchRef.current.items.length; cursor += 1) {
          const item = skillsBatchRef.current.items[cursor]
          if (skillsBatchRef.current.aborted) break
          skillsBatchRef.current.current = item.name
          const batchLog = (code, params = {}) => {
            skillsBatchRef.current.logs.push({ at: Date.now(), name: item.name, code, params })
            if (skillsBatchRef.current.logs.length > 120) skillsBatchRef.current.logs.shift()
          }
          batchLog('item-start')
          try {
            const llm = ctx.get('llm')
            if (llm === undefined) throw new Error('llm-unavailable')
            const entry = byId.get(item.id)
            if (entry === undefined || entry.invalid !== undefined) throw new Error('entry-changed')
            let raw
            try {
              raw = await readFile(entry.path, 'utf8')
            } catch (_) {
              throw new Error('entry-changed')
            }
            const evaluated = evaluateSkillFile(raw)
            if (evaluated.invalid !== undefined) throw new Error('entry-changed')
            const located = locateSkillFrontmatter(raw)
            const draft = await describeSkillDraft(llm, entry.name ?? '', raw, skillsBatchRef.current.provider, skillsBatchRef.current.model, batchLog, { signal: batchCall.signal, lang: skillsBatchRef.current.lang })
            // 注释只进侧车索引：文件零改动，正文哈希取当前内容（正文再变更即自动回到待补全）。
            await serializeSkillsIndexWrite((current) => {
              current[entry.path] = { bodyHash: bodyHashOf(raw, located?.bodyStart ?? 0), note: { description: draft.description, usage: draft.usage }, model: skillsBatchRef.current.provider + '/' + skillsBatchRef.current.model, at: Date.now() }
              return {}
            })
            skillsBatchRef.current.done += 1
          } catch (error) {
            // 取消导致的失败不是条目失败：直接跳出，由循环外的 phase 落定。
            if (skillsBatchRef.current.aborted || batchCall.signal.aborted) break
            skillsBatchRef.current.failures.push({ name: item.name, reason: String(error?.message || error).slice(0, 160) })
          } finally {
            skillsBatchRef.current.current = null
          }
        }
        batchCall.done()
        skillsBatchRef.current.phase = skillsBatchRef.current.aborted || batchCall.signal.aborted ? 'cancelled' : 'done'
        skillsBatchRef.current.running = false
      })()
      return { ok: true, value: { started: true, total: skillsBatchRef.current.total } }

    } },
    'skills-batch-status': { feature: 'skillManager', handle: async (payload, rpcEndpoint) => {
      if (skillsBatchRef.current === null) return { ok: true, value: { phase: 'idle', total: 0, done: 0, failures: [] } }
      return {
        ok: true,
        value: {
          phase: skillsBatchRef.current.phase,
          total: skillsBatchRef.current.total,
          done: skillsBatchRef.current.done,
          failures: [...skillsBatchRef.current.failures],
          current: skillsBatchRef.current.current,
          estBytes: skillsBatchRef.current.estBytes,
          logs: skillsBatchRef.current.logs.slice(-30),
        },
      }

    } },
    'skills-batch-cancel': { feature: 'skillManager', audit: true, handle: async (payload, rpcEndpoint) => {
      if (skillsBatchRef.current !== null) skillsBatchRef.current.aborted = true
      // 立即中断在途 LLM 调用：不等当前条目跑满 90s 超时/重试链。
      for (const call of skillsActiveControllers) {
        try { call.abort(new Error('batch-cancelled')) } catch (_) {}
      }
      return { ok: true, value: { phase: skillsBatchRef.current?.phase ?? 'idle' } }

    } },
  }
}
