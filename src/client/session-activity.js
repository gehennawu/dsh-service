// 客户端半分片：会话活跃观察——sessions.list 快照派生活跃会话集合，驱动任务通知
// 边沿触发与额度圆环的「活跃会话供应商」集合。纯接线（订阅/基线/边沿/清理），状态本体
// （sessionActivity）留在 apply 供额度核心按引用消费。分片不是模块——拼接见 scripts/client-source.mjs。
//
// 数据源按真实运行时拓扑分两路：running 事实在 list 行（SessionSummary）上；
// pendingInteraction 只在 uiSession.sessionStatus 的 ReadonlyMap<SessionId, SessionStatus>
// 上——list 行从不携带该字段（projectList 的三条行构造路径都不写），待审边沿只能从
// 状态源取。两路各自维护基线与边沿，连接重置时各自重建（首快照只建基线，均不响铃）。
//
// 架构约束：状态服务 0.2.3-alpha.1 起从 ui-session 拆到独立包，服务名仍是
// `uiSession.sessionStatus`；读取必须按该服务名 inject / get，只注 `uiSession`
// 再读属性会被属性守卫拒绝。旧运行时同样提供嵌套服务，缺席时状态路优雅降级。
function createSessionActivityObserver({ ctx, sessionActivity, t, featureEnabled, featureScope, notifyState, fireNotification, NOTIFY_KIND_KEYS }) {
      if (ctx.sessions && typeof ctx.sessions.list?.subscribe === 'function') {
        const observed = new Map()
        let baselined = false
        let sessionsDispose = null
        let resetDispose = null

        // 0.2.3-alpha.1 起会话状态独立为 `uiSession.sessionStatus` 服务：只注
        // uiSession 再读 `.sessionStatus` 会被属性守卫拒绝（cannot get property
        // without inject）。这里直接按服务名取，老宿主同样提供该嵌套服务，
        // 缺席时走既有降级（不订阅、不响铃）。
        const getSessionStatus = (scope) => {
          try {
            if (scope != null && typeof scope.get === 'function') {
              const status = scope.get('uiSession.sessionStatus')
              if (status !== undefined) return status
            }
            if (typeof ctx.get === 'function') return ctx.get('uiSession.sessionStatus')
          } catch (_) {}
          return undefined
        }

        let injectedStatus = undefined
        let uninjectUiSession = null
        const statusObserved = new Map()
        let statusBaselined = false
        let statusDispose = null
        let statusResetDispose = null

        // 状态路的统一拆除：订阅、连接重置监听、基线一起清。注入 disposer、
        // 功能开关同步与 fiber 收尾三处共用，避免只走其中一条路径时漏拆。
        const stopStatusObservation = () => {
          if (statusDispose !== null) { statusDispose(); statusDispose = null }
          if (statusResetDispose !== null) { statusResetDispose(); statusResetDispose = null }
          statusObserved.clear()
          statusBaselined = false
        }

        const resolveSessionStatus = () => injectedStatus ?? getSessionStatus()

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
          const status = resolveSessionStatus()
          if (!status || typeof status.subscribe !== 'function') return
          const snapshot = status.getSnapshot()
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
          stopStatusObservation()
          observed.clear()
          baselined = false
          sessionActivity.runningSessionIds = new Set()
        }

        const syncStatusObservation = () => {
          const status = resolveSessionStatus()
          if (status && typeof status.subscribe === 'function' && featureEnabled('taskNotifications')) {
            if (statusDispose === null) {
              statusDispose = status.subscribe(() => observeStatus())
              statusResetDispose = ctx.on('connection/reset', () => { statusObserved.clear(); statusBaselined = false })
              observeStatus()
            }
          } else if (statusDispose !== null) {
            stopStatusObservation()
          }
        }

        const syncSessionObservation = () => {
          const needed = featureEnabled('taskNotifications') || featureEnabled('quotaLookup')
          if (!needed) { stopSessionObservation(); return }
          if (sessionsDispose === null) {
            sessionsDispose = ctx.sessions.list.subscribe(() => observeSessions())
            resetDispose = ctx.on('connection/reset', () => { observed.clear(); baselined = false })
            observeSessions()
          }
          syncStatusObservation()
        }

        if (typeof ctx.inject === 'function') {
          // 订阅归属 inject 子 Fiber：服务撤销时先清理，再为新服务重建订阅和基线。
          // 只在外层插件收尾会让旧 statusDispose 挡住新源接管。
          uninjectUiSession = ctx.inject(['uiSession.sessionStatus'], (scope) => {
            // 防御性先拆：若运行时未先 unload 就以新服务重入回调，旧订阅先释放再重建。
            stopStatusObservation()
            injectedStatus = getSessionStatus(scope)
            syncStatusObservation()
            return () => {
              injectedStatus = undefined
              stopStatusObservation()
            }
          })
        }

        syncSessionObservation()
        const unsubscribeFeatures = featureScope.subscribe(syncSessionObservation)
        ctx.effect(() => () => {
          unsubscribeFeatures()
          if (typeof uninjectUiSession === 'function') { try { uninjectUiSession() } catch (_) {} }
          stopSessionObservation()
        }, 'dsh-service: shared session observation')
      }
}
