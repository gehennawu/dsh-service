// 客户端半分片：会话活跃观察——sessions.list 快照派生 anyRunning/活跃集合，驱动任务通知
// 边沿触发与后台额度轮询拉起。纯接线（订阅/基线/边沿/清理），状态本体（sessionActivity）
// 留在 apply 供额度核心按引用消费。分片不是模块——拼接见 scripts/client-source.mjs。
function createSessionActivityObserver({ ctx, sessionActivity, t, featureEnabled, featureScope, notifyState, fireNotification, NOTIFY_KIND_KEYS, scheduleQuotaCycle }) {
      if (ctx.sessions && typeof ctx.sessions.list?.subscribe === 'function') {
        const observed = new Map()
        let baselined = false
        let sessionsDispose = null
        let resetDispose = null
        const observeSessions = () => {
          const snapshot = ctx.sessions.list.getSnapshot()
          if (!snapshot || !snapshot.byId) return
          sessionActivity.runningSessionIds = new Set(Object.entries(snapshot.byId).filter(([, summary]) => summary.running === true).map(([id]) => id))
          sessionActivity.anyRunning = sessionActivity.runningSessionIds.size > 0
          if (!baselined) {
            baselined = true
            for (const [id, summary] of Object.entries(snapshot.byId)) {
              observed.set(id, { running: summary.running === true, pending: summary.pendingInteraction !== undefined })
            }
            return
          }
          for (const [id, summary] of Object.entries(snapshot.byId)) {
            const next = { running: summary.running === true, pending: summary.pendingInteraction !== undefined }
            const prev = observed.get(id)
            if (prev !== undefined) {
              if (prev.running && !next.running && summary.origin !== 'subagent' && featureEnabled('taskNotifications') && notifyState.current.enabled && notifyState.current.done) {
                fireNotification(t('notification.doneTitle'), t('notification.doneBody', { title: summary.displayTitle || id }))
              }
              if (!prev.pending && next.pending && featureEnabled('taskNotifications') && notifyState.current.enabled && notifyState.current.input) {
                const kindKey = NOTIFY_KIND_KEYS[summary.pendingInteraction]
                const kind = kindKey ? t(kindKey) : String(summary.pendingInteraction)
                fireNotification(t('notification.inputTitle'), t('notification.inputBody', { title: summary.displayTitle || id, kind }))
              }
            }
            observed.set(id, next)
          }
          for (const id of [...observed.keys()]) {
            if (!(id in snapshot.byId)) observed.delete(id)
          }
          // agent 启动时轮询链可能已因「隐藏页跳过周期」而死（runQuotaCycle 跳过即不再排下一轮）：
          // 有活跃会话就重新拉起排程（幂等：已有挂起定时器/refs=0/仅手动时 no-op）。
          if (sessionActivity.anyRunning) scheduleQuotaCycle()
        }
        const stopSessionObservation = () => {
          if (sessionsDispose !== null) { sessionsDispose(); sessionsDispose = null }
          if (resetDispose !== null) { resetDispose(); resetDispose = null }
          observed.clear()
          baselined = false
          sessionActivity.anyRunning = false
          sessionActivity.runningSessionIds = new Set()
        }
        const syncSessionObservation = () => {
          const needed = featureEnabled('taskNotifications') || featureEnabled('quotaLookup')
          if (!needed) { stopSessionObservation(); return }
          if (sessionsDispose !== null) return
          sessionsDispose = ctx.sessions.list.subscribe(() => observeSessions())
          resetDispose = ctx.on('connection/reset', () => { observed.clear(); baselined = false })
          observeSessions()
        }
        syncSessionObservation()
        const unsubscribeFeatures = featureScope.subscribe(syncSessionObservation)
        ctx.effect(() => () => {
          unsubscribeFeatures()
          stopSessionObservation()
        }, 'dsh-service: shared session observation')
      }
}
