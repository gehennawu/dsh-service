// 客户端半分片：会话活跃观察——sessions.list 快照派生活跃会话集合，驱动任务通知
// 边沿触发与额度圆环的「活跃会话供应商」集合。纯接线（订阅/基线/边沿/清理），状态本体
// （sessionActivity）留在 apply 供额度核心按引用消费。分片不是模块——拼接见 scripts/client-source.mjs。
//
// 数据源按真实运行时拓扑分两路：running 事实在 list 行（SessionSummary）上；
// pendingInteraction 只存在于会话状态表（ReadonlyMap<SessionId, SessionStatus>）上——
// list 行从不携带该字段（projectList 的三条行构造路径都不写），待审边沿只能从状态表取。
// 两路各自维护基线与边沿，连接重置时各自重建（首快照只建基线，均不响铃）。
//
// 状态表的服务拓扑跨宿主世代：
//   - 0.2.3-alpha.1 起拆成独立服务 `uiSession.sessionStatus`（Cordis 以扁平点号名注册），
//     只有按该服务名 inject/get 才能读到；
//   - 更早的宿主把它作为 `uiSession` 上的普通属性提供，点号服务名从未单独注册，
//     按名注入回调整体不会触发（待审通知因此静默失效）。
// 所以两条注入同时登记：新版按服务名注入；旧版注入 `uiSession` 后读已注入服务上的属性
// （仍不直接访问 ctx.uiSession）。按来源优先级订阅，来源变化时先拆旧订阅再重建基线；
// 两者都缺席时状态路整体降级（只留 running 路，任务完成通知照常）。
function createSessionActivityObserver({ ctx, sessionActivity, t, featureEnabled, featureScope, notifyState, fireNotification, NOTIFY_KIND_KEYS }) {
      if (ctx.sessions && typeof ctx.sessions.list?.subscribe === 'function') {
        const observed = new Map()
        let baselined = false
        let sessionsDispose = null
        let resetDispose = null

        // 状态路的两条注入各留下服务引用；subscription 只认当前解析出的那一份。
        // Cordis 每次解析服务都会新建 traceable Proxy，代理引用不能做「同源」判据，
        // 因此订阅完全由注入变动驱动：每次同步都先拆后建、以当前快照重建基线。
        let standaloneStatus = undefined
        let injectedUiSession = undefined
        let statusRef = null
        let statusDispose = null
        let statusResetDispose = null
        const statusObserved = new Map()
        let statusBaselined = false

        // 状态路的统一拆除：订阅、连接重置监听、基线一起清。注入 disposer、
        // 功能开关同步与 fiber 收尾三处共用，避免只走其中一条路径时漏拆。
        const stopStatusObservation = () => {
          if (statusDispose !== null) { statusDispose(); statusDispose = null }
          if (statusResetDispose !== null) { statusResetDispose(); statusResetDispose = null }
          statusRef = null
          statusObserved.clear()
          statusBaselined = false
        }

        // 按服务名取（0.2.3-alpha.1+ 的独立服务）：scope 优先，ctx.get 兜底。旧宿主没有
        // 这个服务名，两次都返回 undefined，由下面的普通属性路径接手。
        const getNamedStatus = (scope) => {
          try {
            if (scope != null && typeof scope.get === 'function') {
              const status = scope.get('uiSession.sessionStatus')
              if (status !== undefined) return status
            }
          } catch (_) {}
          try {
            if (typeof ctx.get === 'function') {
              const status = ctx.get('uiSession.sessionStatus')
              if (status !== undefined) return status
            }
          } catch (_) {}
          return undefined
        }

        // 旧宿主：`sessionStatus` 只是已注入 `uiSession` 上的普通属性。新版把状态拆出去
        // 后该属性访问会触发属性守卫（cannot get property … without inject），按缺席处理。
        const getLegacyStatus = () => {
          if (injectedUiSession === undefined || injectedUiSession === null) return undefined
          try {
            const status = injectedUiSession.sessionStatus
            return status === undefined ? undefined : status
          } catch (_) {
            return undefined
          }
        }

        // 注入 scope 上的 uiSession：真实 Cordis 里注入的服务可直接读属性；测试替身只
        // 提供 get 时退到 scope.get / ctx.get。
        const getInjectedUiSession = (scope) => {
          try {
            if (scope != null && scope.uiSession !== undefined) return scope.uiSession
          } catch (_) {}
          try {
            if (scope != null && typeof scope.get === 'function') {
              const session = scope.get('uiSession')
              if (session !== undefined) return session
            }
          } catch (_) {}
          try {
            if (typeof ctx.get === 'function') return ctx.get('uiSession')
          } catch (_) {}
          return undefined
        }

        // 优先级：按服务名注入到的独立服务 > 按名 get（注入回调尚未触发的窗口）> 旧版普通属性。
        const resolveStatus = () => standaloneStatus ?? getNamedStatus() ?? getLegacyStatus()

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
          const status = statusRef
          if (!status || typeof status.getSnapshot !== 'function') return
          const snapshot = status.getSnapshot()
          if (!snapshot || typeof snapshot.entries !== 'function') return
          if (!statusBaselined) {
            statusBaselined = true
            for (const [id, entry] of snapshot.entries()) {
              statusObserved.set(id, { pending: entry?.pendingInteraction !== undefined })
            }
            return
          }
          for (const [id, entry] of snapshot.entries()) {
            const next = { pending: entry?.pendingInteraction !== undefined }
            const prev = statusObserved.get(id)
            if (prev !== undefined && !prev.pending && next.pending && featureEnabled('taskNotifications') && notifyState.current.enabled && notifyState.current.input) {
              const kindKey = NOTIFY_KIND_KEYS[entry.pendingInteraction.kind]
              const kind = kindKey ? t(kindKey) : String(entry.pendingInteraction.kind)
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
          // 先拆后建：来源可能被同名的下一代实例替换，而代理引用无法做同源比较；
          // 拆与建都在同步段内完成，不会漏掉中间的发布。
          const status = resolveStatus()
          stopStatusObservation()
          if (!status || typeof status.subscribe !== 'function' || !featureEnabled('taskNotifications')) return
          statusRef = status
          const dispose = status.subscribe(() => observeStatus())
          statusDispose = typeof dispose === 'function' ? dispose : null
          statusResetDispose = ctx.on('connection/reset', () => { statusObserved.clear(); statusBaselined = false })
          observeStatus()
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

        let uninjectStandalone = null
        let uninjectLegacyUiSession = null
        if (typeof ctx.inject === 'function') {
          // 新版宿主：状态是独立服务。真机核实（0.2.3-alpha.1/alpha.2）按该名注入可命中。
          uninjectStandalone = ctx.inject(['uiSession.sessionStatus'], (scope) => {
            standaloneStatus = getNamedStatus(scope)
            syncStatusObservation()
            return () => {
              standaloneStatus = undefined
              syncStatusObservation()
            }
          })
          // 旧宿主：状态是 uiSession 的普通属性，点号服务名不注册、按名注入回调永不触发。
          // 订阅归属这条注入：uiSession 撤销/更换时先跑 disposer 拆旧订阅，再以新属性源
          // 重建订阅与基线（只靠外层 fiber 收尾会让旧 statusDispose 挡住新源接管）。
          uninjectLegacyUiSession = ctx.inject(['uiSession'], (scope) => {
            injectedUiSession = getInjectedUiSession(scope)
            syncStatusObservation()
            return () => {
              injectedUiSession = undefined
              syncStatusObservation()
            }
          })
        }

        syncSessionObservation()
        const unsubscribeFeatures = featureScope.subscribe(syncSessionObservation)
        ctx.effect(() => () => {
          unsubscribeFeatures()
          if (typeof uninjectStandalone === 'function') { try { uninjectStandalone() } catch (_) {} }
          if (typeof uninjectLegacyUiSession === 'function') { try { uninjectLegacyUiSession() } catch (_) {} }
          stopSessionObservation()
        }, 'dsh-service: shared session observation')
      }
}
