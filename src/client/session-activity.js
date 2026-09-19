// 客户端半分片：会话活跃观察——sessions.list 快照派生活跃会话集合，驱动任务通知
// 边沿触发与额度圆环的「活跃会话供应商」集合。纯接线（订阅/基线/边沿/清理），状态本体
// （sessionActivity）留在 apply 供额度核心按引用消费。分片不是模块——拼接见 scripts/client-source.mjs。
//
// 数据源按真实运行时拓扑分两路：running 事实在 list 行（SessionSummary）上；
// pendingInteraction 只在 uiSession.sessionStatus 的 ReadonlyMap<SessionId, SessionStatus>
// 上——list 行从不携带该字段（projectList 的三条行构造路径都不写），待审边沿只能从
// 状态源取。两路各自维护基线与边沿，连接重置时各自重建（首快照只建基线，均不响铃）。
// 旧运行时没有 uiSession 服务时状态路整体缺席，任务完成通知照常。
function createSessionActivityObserver({ ctx, sessionActivity, t, featureEnabled, featureScope, notifyState, fireNotification, NOTIFY_KIND_KEYS }) {
      if (ctx.sessions && typeof ctx.sessions.list?.subscribe === 'function') {
        const observed = new Map()
        let baselined = false
        let sessionsDispose = null
        let resetDispose = null
        const hasStatusSource = ctx.uiSession && typeof ctx.uiSession.sessionStatus?.subscribe === 'function'
        const statusObserved = new Map()
        let statusBaselined = false
        let statusDispose = null
        let statusResetDispose = null
        const observeSessions = () => {
          const snapshot = ctx.sessions.list.getSnapshot()
          if (!snapshot || !snapshot.byId) return
          sessionActivity.runningSessionIds = new Set(Object.entries(snapshot.byId).filter(([, summary]) => summary.running === true).map(([id]) => id))
          if (!baselined) {
            baselined = true
            for (const [id, summary] of Object.entries(snapshot.byId)) {
              observed.set(id, { running: summary.running === true })
            }
            return
          }
          for (const [id, summary] of Object.entries(snapshot.byId)) {
            const next = { running: summary.running === true }
            const prev = observed.get(id)
            if (prev !== undefined && prev.running && !next.running && summary.origin !== 'subagent' && featureEnabled('taskNotifications') && notifyState.current.enabled && notifyState.current.done) {
              fireNotification(t('notification.doneTitle'), t('notification.doneBody', { title: summary.displayTitle || id }))
            }
            observed.set(id, next)
          }
          for (const id of [...observed.keys()]) {
            if (!(id in snapshot.byId)) observed.delete(id)
          }
        }
        const observeStatus = () => {
          if (!hasStatusSource) return
          const snapshot = ctx.uiSession.sessionStatus.getSnapshot()
          if (!snapshot || typeof snapshot.entries !== 'function') return
          if (!statusBaselined) {
            statusBaselined = true
            for (const [id, status] of snapshot.entries()) {
              statusObserved.set(id, { pending: status?.pendingInteraction !== undefined })
            }
            return
          }
          for (const [id, status] of snapshot.entries()) {
            const next = { pending: status?.pendingInteraction !== undefined }
            const prev = statusObserved.get(id)
            if (prev !== undefined && !prev.pending && next.pending && featureEnabled('taskNotifications') && notifyState.current.enabled && notifyState.current.input) {
              const kindKey = NOTIFY_KIND_KEYS[status.pendingInteraction.kind]
              const kind = kindKey ? t(kindKey) : String(status.pendingInteraction.kind)
              const summary = ctx.sessions.list.getSnapshot().byId[id]
              fireNotification(t('notification.inputTitle'), t('notification.inputBody', { title: summary?.displayTitle || id, kind }))
            }
            statusObserved.set(id, next)
          }
          for (const id of [...statusObserved.keys()]) {
            if (!snapshot.has(id)) statusObserved.delete(id)
          }
        }
        const stopSessionObservation = () => {
          if (sessionsDispose !== null) { sessionsDispose(); sessionsDispose = null }
          if (resetDispose !== null) { resetDispose(); resetDispose = null }
          if (statusDispose !== null) { statusDispose(); statusDispose = null }
          if (statusResetDispose !== null) { statusResetDispose(); statusResetDispose = null }
          observed.clear()
          baselined = false
          statusObserved.clear()
          statusBaselined = false
          sessionActivity.runningSessionIds = new Set()
        }
        const syncSessionObservation = () => {
          const needed = featureEnabled('taskNotifications') || featureEnabled('quotaLookup')
          if (!needed) { stopSessionObservation(); return }
          if (sessionsDispose === null) {
            sessionsDispose = ctx.sessions.list.subscribe(() => observeSessions())
            resetDispose = ctx.on('connection/reset', () => { observed.clear(); baselined = false })
            observeSessions()
          }
          if (hasStatusSource && featureEnabled('taskNotifications')) {
            if (statusDispose === null) {
              statusDispose = ctx.uiSession.sessionStatus.subscribe(() => observeStatus())
              statusResetDispose = ctx.on('connection/reset', () => { statusObserved.clear(); statusBaselined = false })
              observeStatus()
            }
          } else if (statusDispose !== null) {
            statusDispose(); statusDispose = null
            statusResetDispose(); statusResetDispose = null
            statusObserved.clear()
            statusBaselined = false
          }
        }
        syncSessionObservation()
        const unsubscribeFeatures = featureScope.subscribe(syncSessionObservation)
        ctx.effect(() => () => {
          unsubscribeFeatures()
          stopSessionObservation()
        }, 'dsh-service: shared session observation')
      }
}
