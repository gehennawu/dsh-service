// 客户端半分片：技能批量补全共享态——跨标签/设置面板存活的批量状态机（宿主任务不随 UI 停止）。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域；正文除
// skillsBatchListDirty 改 { current } 箱体（技能段跨工厂读写）外与拆分前逐字节一致。
// 参数里的模型目录三件套（KEY/skillModelKey/resolveSkillModelChoice）声明在技能段，
// 故工厂调用点位于其后（apply.js「技能管理」段前），消费点均在调用点之后，无 TDZ。
function createSkillsBatchShared({ ctx, rpcCall, featureEnabled, featureScope, currentUiLocale, SKILLS_MODEL_STORAGE_KEY, skillModelKey, resolveSkillModelChoice }) {
  const { useState, useEffect } = React
      let skillsBatchState = null       // 宿主状态快照
      let skillsBatchPlan = null        // 本端计划（含所选模型）
      let skillsBatchModels = null      // 模型清单缓存（null=未拉取，[]=不可用）
      let skillsBatchModelItem = null   // 批量选中的模型
      let skillsBatchError = ''
      const skillsBatchListDirtyRef = { current: false }  // 落定后请挂载中的列表自刷新（箱体：技能段跨工厂读写）
      let skillsBatchPollHandle = null
      let skillsBatchAdoptPromise = null
      let skillsBatchStatusChecked = false
      const SKILLS_BATCH_PENDING_STORAGE_KEY = 'dsh-service-skills-batch-pending'
      const skillsBatchListeners = new Set()
      const publishSkillsBatch = () => { for (const listener of skillsBatchListeners) listener() }
      const setSkillsBatchPending = (pending) => {
        try {
          if (pending) localStorage.setItem(SKILLS_BATCH_PENDING_STORAGE_KEY, 'true')
          else localStorage.removeItem(SKILLS_BATCH_PENDING_STORAGE_KEY)
        } catch (_) {}
      }
      const hasSkillsBatchPendingMarker = () => {
        try { return localStorage.getItem(SKILLS_BATCH_PENDING_STORAGE_KEY) === 'true' } catch (_) { return false }
      }
      const rememberSkillsBatchPhase = (phase) => {
        setSkillsBatchPending(phase === 'planned' || phase === 'running')
      }
      const skillsBatchPollStop = () => {
        if (skillsBatchPollHandle !== null) { clearInterval(skillsBatchPollHandle); skillsBatchPollHandle = null }
      }
      const syncSkillsBatchPolling = (immediate = true) => {
        // 功能关闭时不轮询（宿主也会拒绝 skill-* RPC）；重开后由下一次交互重新拉起。
        const shouldPoll = skillsBatchState !== null && skillsBatchState.phase === 'running' && featureEnabled('skillManager')
        if (shouldPoll && skillsBatchPollHandle === null) {
          const tick = async () => {
            try {
              const res = await rpcCall('skills-batch-status', {})
              if (!res.ok) return
              const previousPhase = skillsBatchState !== null ? skillsBatchState.phase : null
              skillsBatchState = res.value
              rememberSkillsBatchPhase(res.value.phase)
              if (previousPhase === 'running' && res.value.phase !== 'running') {
                // 落定：停止轮询，请挂载中的列表刷新 annotated 标记。
                skillsBatchPollStop()
                skillsBatchListDirtyRef.current = true
              }
              publishSkillsBatch()
            } catch (_) {}
          }
          if (immediate) void tick()
          skillsBatchPollHandle = setInterval(() => void tick(), 2000)
        }
      }
      const fetchSkillsBatchModels = async () => {
        if (skillsBatchModels !== null) return skillsBatchModels
        try {
          const res = await rpcCall('skills-models', {})
          if (!res.ok) { skillsBatchModels = []; return skillsBatchModels }
          skillsBatchModels = res.value.models ?? []
          if (skillsBatchModelItem === null) skillsBatchModelItem = resolveSkillModelChoice(skillsBatchModels, res.value.current)
        } catch (_) { skillsBatchModels = [] }
        return skillsBatchModels
      }
      const changeSkillsBatchModel = (key) => {
        const item = (skillsBatchModels ?? []).find((candidate) => skillModelKey(candidate) === key) ?? null
        skillsBatchModelItem = item
        if (item !== null) {
          try { localStorage.setItem(SKILLS_MODEL_STORAGE_KEY, JSON.stringify({ provider: item.provider, model: item.id })) } catch (_) {}
        }
        publishSkillsBatch()
      }
      const adoptSkillsBatchStatus = () => {
        if (skillsBatchStatusChecked) return Promise.resolve(skillsBatchState)
        if (skillsBatchAdoptPromise !== null) return skillsBatchAdoptPromise
        skillsBatchAdoptPromise = (async () => {
          try {
            const res = await rpcCall('skills-batch-status', {})
            if (res.ok) {
              skillsBatchStatusChecked = true
              rememberSkillsBatchPhase(res.value.phase)
              if (res.value.phase !== 'idle') {
                skillsBatchState = res.value
                syncSkillsBatchPolling(false)
                publishSkillsBatch()
              }
            }
          } catch (_) {}
          return skillsBatchState
        })().finally(() => { skillsBatchAdoptPromise = null })
        return skillsBatchAdoptPromise
      }
      const planSkillsBatchShared = async () => {
        skillsBatchError = ''
        publishSkillsBatch()
        const models = await fetchSkillsBatchModels()
        if (models.length === 0 || skillsBatchModelItem === null) { skillsBatchError = 'models-empty'; publishSkillsBatch(); return false }
        try { localStorage.setItem(SKILLS_MODEL_STORAGE_KEY, JSON.stringify({ provider: skillsBatchModelItem.provider, model: skillsBatchModelItem.id })) } catch (_) {}
        const res = await rpcCall('skills-batch-plan', { provider: skillsBatchModelItem.provider, model: skillsBatchModelItem.id })
        if (!res.ok) { skillsBatchError = res.error || 'unknown'; publishSkillsBatch(); return false }
        skillsBatchPlan = { ...res.value, modelItem: skillsBatchModelItem }
        const annotatedCount = Array.isArray(res.value.annotated) ? res.value.annotated.length : 0
        skillsBatchState = { phase: 'planned', total: res.value.candidates.length + annotatedCount, done: 0, failures: [], current: null, estBytes: res.value.estBytes, logs: [] }
        rememberSkillsBatchPhase('planned')
        syncSkillsBatchPolling()
        publishSkillsBatch()
        return true
      }
      const startSkillsBatchShared = async (forceAnnotated = false) => {
        if (skillsBatchPlan === null || skillsBatchState === null) return false
        // 计划含已注释条目时宿主要求显式确认（annotated-confirm-required 兜底），客户端只在
        // 两段式武装确认后传 forceAnnotated: true。
        const res = await rpcCall('skills-batch-run', {
          planId: skillsBatchPlan.planId,
          lang: currentUiLocale(),
          ...(forceAnnotated === true ? { forceAnnotated: true } : {}),
        })
        if (!res.ok) { skillsBatchError = res.error || 'unknown'; publishSkillsBatch(); return false }
        skillsBatchState = { ...skillsBatchState, phase: 'running' }
        rememberSkillsBatchPhase('running')
        syncSkillsBatchPolling()
        publishSkillsBatch()
        return true
      }
      const cancelSkillsBatchShared = async () => {
        try {
          await rpcCall('skills-batch-cancel', {})
          setSkillsBatchPending(false)
        } catch (_) {}
      }
      const useSkillsBatch = () => {
        const [, bump] = useState(0)
        useEffect(() => {
          const update = () => bump((v) => v + 1)
          skillsBatchListeners.add(update)
          return () => skillsBatchListeners.delete(update)
        }, [])
        return { batch: skillsBatchState, plan: skillsBatchPlan, models: skillsBatchModels, modelItem: skillsBatchModelItem, error: skillsBatchError }
      }
      // 轮询器归属当前 Fiber（AGENTS.md 生命周期不变量）：插件停止即停表；
      // 功能开关关闭也停表。放在 useSkillsBatch 之后——这里引用的函数都已就绪。
      ctx.effect(() => {
        const unsubscribe = featureScope.subscribe(() => {
          if (!featureEnabled('skillManager')) skillsBatchPollStop()
        })
        return () => {
          unsubscribe()
          skillsBatchPollStop()
        }
      }, 'dsh-service skills batch polling lifecycle')
      // 只有本页曾启动过未落定批量任务时才在刷新后恢复：普通页面启动零 RPC；
      // 计划/运行阶段落本地 marker，落定/取消即清除。技能页首次进入仍会主动核对一次宿主状态。
      if (hasSkillsBatchPendingMarker()) void adoptSkillsBatchStatus()
  return { adoptSkillsBatchStatus, cancelSkillsBatchShared, changeSkillsBatchModel, fetchSkillsBatchModels, planSkillsBatchShared, publishSkillsBatch, skillsBatchListDirtyRef, startSkillsBatchShared, useSkillsBatch }
}
