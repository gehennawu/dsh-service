// ─── 模型厂家/渠道图标（v1.8 新增）──────────────────────────────
// 在官方 composer 模型钮上叠加「当前会话 provider」的厂家图标。官方那颗钮是
// 独占槽（conversation.input.model，kind:single，官方 ModelSelect 占位），
// 无法再注册第二个 occupant，故走纯 CSS 装饰：把 --dshsvc-model-icon 变量
// 与 data-dshsvc-model-icon 属性挂在 composer 座上，用 ::before 画图标。
//
// 三态：
//   ① 宽态（官方显示模型名）→ 模型名前加图标；
//   ② 窄态（≤480px，官方/本插件把 label 藏成图标）→ 我方图标替换官方默认图标；
//   ③ 未适配渠道 → 完全不动官方默认图标（既不加、也不换）。
//
// 渲染路径由数据里的 c 字段决定，全部实测过（scripts/probe-model-icon-dom.mjs）：
//   c=0（mono）mask + background-color:currentColor —— 颜色交给主题文字色，
//              浅色 rgb(97,102,107) / 暗色 rgb(207,211,214) 自动跟随，零特判；
//   c=1（color）background-image 原样上品牌色。
// data-URI 是独立文档上下文，**不继承 currentColor**，所以 mono 必须走 mask
// （直接写 fill="currentColor" 的 data-URI 会渲染成全黑/全透明）。
//
// 客户端半分片：分片不是模块——按 scripts/client-source.mjs 清单与 src/client.js 等
// 拼接成同一个 factory 作用域；静态面（MODEL_ICON_* 常量、modelIconDataUri、
// resolveModelIcon、MODEL_ICON_CSS、iconDom* 助手、quotaStore）都在 client.js 工厂
// 作用域，本分片直接引用；apply 作用域依赖以参数注入 { ctx, getModelDirectories }，
// 调用点在 apply.js。
      /**
       * 图标引擎：订阅当前会话的 modelDirectory，把 provider 解析成图标并写到
       * composer 座上。会话切换/模型切换/主题切换都自然跟随（数据属性驱动 CSS）。
       */
      const createModelProviderIcons = ({ ctx, getModelDirectories }) => {
        const state = { styleTag: null, observer: null, observerCreated: false, unsubscribe: null, unsubscribeSessions: null, unsubscribeQuota: null, seat: null, lastProvider: null, lastSession: undefined, disposed: false }

        const currentSessionId = () => {
          try {
            const sessions = ctx.sessions
            if (sessions && sessions.list && typeof sessions.list.getSnapshot === 'function') {
              const snapshot = sessions.list.getSnapshot()
              if (snapshot && typeof snapshot.current === 'string' && snapshot.current !== '') {
                return snapshot.current
              }
              if (snapshot && snapshot.byId) {
                const found = Object.values(snapshot.byId).find((s) => (s?.retainedBy?.mainView ?? 0) > 0)
                if (found && typeof found.id === 'string' && found.id !== '') return found.id
                if (found && typeof found.sessionId === 'string' && found.sessionId !== '') return found.sessionId
                const ids = Object.keys(snapshot.byId)
                if (ids.length === 1) return ids[0]
              }
            }
          } catch (_) {}
          return undefined
        }

        const currentProvider = () => {
          const sessionId = currentSessionId()
          if (sessionId === undefined || sessionId === null) return null
          try {
            const models = getModelDirectories()
            if (models === undefined || typeof models.directoryFor !== 'function') return null
            const directory = models.directoryFor(sessionId)
            const snapshot = directory && directory.store && typeof directory.store.getSnapshot === 'function'
              ? directory.store.getSnapshot()
              : null
            const provider = snapshot && snapshot.current ? snapshot.current.provider : undefined
            return typeof provider === 'string' && provider !== '' ? provider : null
          } catch (_) {
            return null
          }
        }

        /** 找到 composer 座（官方 data-composer-seat，React 不重建的稳定锚点）。 */
        const findSeat = () => {
          const doc = docOrNull()
          if (doc === null) return null
          try { return doc.querySelector('[data-composer-seat]') } catch (_) { return null }
        }

        /** 把 provider 解析结果写到座上；未命中则摘属性（官方默认图标照旧）。 */
        const apply = () => {
          if (state.disposed) return
          const seat = findSeat()
          if (seat === null) { state.seat = null; return }
          state.seat = seat
          // 切会话：directory 是「每会话一个」，必须重挂订阅并清掉旧图标，
          // 否则座上会残留上一个会话的品牌（首版漏了这条）。这里不额外持有
          // sessions.list 订阅——外壳重建 composer 时 MutationObserver 会调进来，
          // 而那份额外订阅会破坏「功能全关时不留空闲订阅」的既有不变量。
          const sessionId = currentSessionId()
          if (sessionId !== state.lastSession) {
            state.lastProvider = null
            clear()
            subscribe()
          }
          const provider = currentProvider()
          if (provider === state.lastProvider && iconDomHasAttr(seat, MODEL_ICON_SEAT_ATTR)) return
          state.lastProvider = provider
          const resolved = provider === null ? null : resolveModelIcon(provider, { forComposer: true })
          if (resolved === null) {
            // 未适配：摘掉属性和变量，官方默认图标完全照旧。
            iconDomRemoveAttr(seat, MODEL_ICON_ATTR)
            iconDomRemoveAttr(seat, MODEL_ICON_SEAT_ATTR)
            iconDomRemoveVar(seat, MODEL_ICON_VAR)
            iconDomRemoveVar(seat, MODEL_ICON_SIZE_VAR)
            return
          }
          const useMask = resolved.spec.c !== 1
          iconDomSetVar(seat, MODEL_ICON_VAR, modelIconDataUri(resolved.spec, useMask))
          // 光学修正：满框形状按系数收一点，其余图标不设变量（回落基准 15px）。
          const optical = typeof resolved.spec.o === 'number' && resolved.spec.o > 0 ? resolved.spec.o : 1
          if (optical === 1) iconDomRemoveVar(seat, MODEL_ICON_SIZE_VAR)
          else iconDomSetVar(seat, MODEL_ICON_SIZE_VAR, `${(MODEL_ICON_BASE_PX * optical).toFixed(2)}px`)
          iconDomSetAttr(seat, MODEL_ICON_ATTR, resolved.slug)
          iconDomSetAttr(seat, MODEL_ICON_SEAT_ATTR, useMask ? 'mono' : 'color')
        }

        const clearSeat = (seat) => {
          iconDomRemoveAttr(seat, MODEL_ICON_ATTR)
          iconDomRemoveAttr(seat, MODEL_ICON_SEAT_ATTR)
          iconDomRemoveVar(seat, MODEL_ICON_VAR)
          iconDomRemoveVar(seat, MODEL_ICON_SIZE_VAR)
        }

        const clear = () => {
          // 两条路都要走：自有查询拿不到时（替身/非常规 DOM）至少清掉我们记着的那颗座，
          // 否则热关会留下残影（首版实测）。
          if (state.seat !== null) clearSeat(state.seat)
          const doc = docOrNull()
          if (doc !== null && typeof doc.querySelectorAll === 'function') {
            let nodes = []
            try { nodes = Array.from(doc.querySelectorAll(`[${MODEL_ICON_SEAT_ATTR}]`)) } catch (_) { nodes = [] }
            for (const seat of nodes) clearSeat(seat)
          }
          state.seat = null
          state.lastProvider = null
        }

        /** 订阅会话目录：模型切换（selectModel）会推快照，无需轮询。 */
        const subscribe = () => {
          if (state.unsubscribe !== null) { try { state.unsubscribe() } catch (_) {} state.unsubscribe = null }
          const sessionId = currentSessionId()
          // 无论是否真的挂上，都要记住「这次为哪个会话解析过」：早退（无会话/服务未就绪）
          // 若不记，下次 apply() 会以为会话变了而重复挂订阅，析构时只解开一份，留下监听泄漏
          // （实测：listeners 2 → 1）。
          state.lastSession = sessionId
          if (sessionId === undefined || sessionId === null) return
          try {
            const models = getModelDirectories()
            if (models === undefined || typeof models.directoryFor !== 'function') return
            const directory = models.directoryFor(sessionId)
            if (directory && directory.store && typeof directory.store.subscribe === 'function') {
              const stop = directory.store.subscribe(() => apply())
              state.unsubscribe = typeof stop === 'function' ? stop : null
              // 目录可能尚未加载：触发一次 load，拿到真实 provider。
              if (typeof directory.load === 'function') {
                try {
                  const pending = directory.load()
                  if (pending && typeof pending.catch === 'function') pending.catch(() => {})
                } catch (_) {}
              }
            }
          } catch (_) {}
        }

        /**
         * 订阅会话列表：**切会话必须能感知到**。
         *
         * 只靠 MutationObserver + 目录订阅是不够的：两者都锚在「当前」会话的 DOM 与
         * store 上——切到新会话时，宽视口下 composer 座不重建（observer 不回调）、
         * 而目录订阅还挂在**旧会话**的 store 上（新会话的 provider 变化收不到）。
         * 结果就是属性停在旧渠道上（真机复现：390/430/480 因重建 composer 而正确，
         * 481/1280 仍显示上一个渠道的图标）。
         *
         * 该订阅随功能开关精确挂/卸（start/stop 各自对应），不破坏「功能全关时不留
         * 空闲订阅」的既有不变量——那正是当初没写它的原因。
         */
        const subscribeSessions = () => {
          if (state.unsubscribeSessions !== null) return
          try {
            const sessions = ctx.sessions
            if (!sessions || !sessions.list || typeof sessions.list.subscribe !== 'function') return
            const stop = sessions.list.subscribe(() => {
              if (state.disposed) return
              const sessionId = currentSessionId()
              if (sessionId === state.lastSession) return
              // 会话变了：先摘掉旧图标，再挂到新会话的目录上重算。
              state.lastProvider = null
              clear()
              subscribe()
              apply()
            })
            state.unsubscribeSessions = typeof stop === 'function' ? stop : null
          } catch (_) {}
        }

        /**
         * 订阅余额查询快照：用户在余额查询中改/撤销手动适配类型时，
         * 图标（识别的兜底来源）立即响应——设 state.lastProvider = null 触发重算，不重载页面。
         */
        const subscribeQuota = () => {
          if (state.unsubscribeQuota !== null) return
          try {
            if (typeof quotaStore === 'undefined' || typeof quotaStore.subscribe !== 'function') return
            const stop = quotaStore.subscribe(() => {
              if (state.disposed) return
              state.lastProvider = null
              apply()
            })
            state.unsubscribeQuota = typeof stop === 'function' ? stop : null
          } catch (_) {}
        }

        const start = () => {
          const doc = docOrNull()
          if (state.styleTag === null && doc !== null) {
            try {
              const tag = doc.createElement('style')
              tag.dataset.plugin = '@gehennawu/dsh-service'
              tag.dataset.pluginCss = '@gehennawu/dsh-service/model-icons.css'
              tag.textContent = MODEL_ICON_CSS
              doc.head.appendChild(tag)
              state.styleTag = tag
            } catch (_) {}
          }
          subscribeQuota()
          subscribeSessions()
          subscribe()
          apply()
          if (state.observer !== null) return
          if (doc === null || typeof MutationObserver !== 'function') return
          if (state.observerCreated) return
          state.observerCreated = true
          try {
            // 会话切换/新会话创建会重建 composer 座；模型切换走上面的 store 订阅。
            state.observer = new MutationObserver(() => {
              if (state.seat !== null && typeof doc.contains === 'function' && !doc.contains(state.seat)) {
                state.seat = null
                state.lastProvider = null
              }
              apply()
            })
            state.observer.observe(doc.documentElement, { childList: true, subtree: true })
          } catch (_) {
            state.observer = null
          }
        }

        const stop = () => {
          state.disposed = true
          if (state.unsubscribe !== null) {
            try { state.unsubscribe() } catch (_) {}
            state.unsubscribe = null
          }
          if (state.unsubscribeSessions !== null) {
            try { state.unsubscribeSessions() } catch (_) {}
            state.unsubscribeSessions = null
          }
          if (state.unsubscribeQuota !== null) {
            try { state.unsubscribeQuota() } catch (_) {}
            state.unsubscribeQuota = null
          }
          if (state.observer !== null) {
            try { state.observer.disconnect() } catch (_) {}
            state.observer = null
          }
          clear()
          if (state.styleTag !== null) {
            try { state.styleTag.remove() } catch (_) {}
            state.styleTag = null
          }
        }

        return { start, stop, apply, clear }
      }
