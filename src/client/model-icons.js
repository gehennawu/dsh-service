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

        // ── 模型选择弹窗「分组标题（厂家/渠道商）」前的那一枚 ────────────────
        // 官方「模型」二级列表把每个 provider 渲染成
        // `<section role="group"><div class="_7KE1Ra_groupTitle">渠道名</div>…</section>`，
        // 标题里没有任何厂家标识。分组顺序与渠道名**完全等于**目录快照的
        // groups[].id/name（宿主侧 buildModelCatalog 直接用 provider.id/name 构造），
        // 所以映射键就用标题文本，配同一套 resolveModelIcon 解析——不引入第二份映射表。
        // 标题文本取不到（空标题 / 结构漂移）就跳过该组，绝不猜。

        /** 分组标题对应的 provider 名；拿不到文本返回 null。 */
        const menuGroupProviderOf = (title) => {
          try {
            const text = String(title?.textContent ?? '').trim()
            return text === '' ? null : text
          } catch (_) {
            return null
          }
        }

        /** 摘掉本插件插进分组标题的那一枚图标（按自有属性，不碰官方任何节点）。 */
        const removeMenuGroupIcon = (title) => {
          try {
            if (title === null || title === undefined || typeof title.querySelectorAll !== 'function') return
            for (const node of Array.from(title.querySelectorAll(`[${MENU_GROUP_ICON_ATTR}]`))) {
              try { node.remove() } catch (_) {}
            }
          } catch (_) {}
        }

        /** 清空全部分组装饰（菜单关闭 / 切换会话 / 功能关闭 / 析构都走这里）。 */
        const clearMenuGroups = () => {
          const doc = docOrNull()
          if (doc === null || typeof doc.querySelectorAll !== 'function') return
          try {
            for (const node of Array.from(doc.querySelectorAll(`[${MENU_GROUP_ICON_ATTR}]`))) {
              try { node.remove() } catch (_) {}
            }
          } catch (_) {}
          let titles = []
          try { titles = Array.from(doc.querySelectorAll(`[${MENU_GROUP_ATTR}]`)) } catch (_) { titles = [] }
          for (const node of titles) {
            removeMenuGroupIcon(node)
            iconDomRemoveAttr(node, MENU_GROUP_ATTR)
            iconDomRemoveAttr(node, MODEL_ICON_ATTR)
            iconDomRemoveAttr(node, MODEL_ICON_SEAT_ATTR)
            iconDomRemoveVar(node, MODEL_ICON_VAR)
            iconDomRemoveVar(node, MODEL_ICON_SIZE_VAR)
          }
        }

        /**
         * 给每个打开中的分组标题前插一枚厂家图标；未命中渠道的组保持官方原样。
         *
         * 图标是**插入的兄弟节点**而不是标题的伪元素：伪元素只能排在标题既有内容
         * 之后（表现为「渠道名后」），插到 firstChild 之前才是「渠道名**前**」。
         *
         * 幂等：已装饰且 slug 未变的组直接跳过——MutationObserver 会被我们自己的
         * 插入动作唤醒，不设这条会自激。插入的是我们的节点，官方 React 不会把它
         * 当 children 处理（React 只认自己创建的节点）。
         */
        const decorateMenuGroups = () => {
          if (state.disposed) return
          const doc = docOrNull()
          if (doc === null || typeof doc.querySelectorAll !== 'function') return
          let titles = []
          try { titles = Array.from(doc.querySelectorAll(`[class*="_7KE1Ra_groupTitle"]`)) } catch (_) { return }
          if (titles.length === 0) return
          for (const title of titles) {
            const provider = menuGroupProviderOf(title)
            if (provider === null) continue
            const resolved = resolveModelIcon(provider, { forComposer: true })
            if (resolved === null) {
              // 未适配渠道：官方标题零改动，顺带摘掉上一轮可能留下的残留。
              removeMenuGroupIcon(title)
              iconDomRemoveAttr(title, MENU_GROUP_ATTR)
              iconDomRemoveAttr(title, MODEL_ICON_ATTR)
              iconDomRemoveAttr(title, MODEL_ICON_SEAT_ATTR)
              iconDomRemoveVar(title, MODEL_ICON_VAR)
              iconDomRemoveVar(title, MODEL_ICON_SIZE_VAR)
              continue
            }
            const useMask = resolved.spec.c !== 1
            // 已有同一枚：跳过（防自激——MutationObserver 会被我们自己的插入动作唤醒）。
            const current = iconDomGetAttr(title, MODEL_ICON_ATTR)
            const hasIcon = (() => {
              try { return title.querySelector(`[${MENU_GROUP_ICON_ATTR}]`) !== null } catch (_) { return false }
            })()
            if (hasIcon && current === resolved.slug) continue
            removeMenuGroupIcon(title)
            if (typeof doc.createElement !== 'function') continue
            try {
              const icon = doc.createElement('span')
              icon.setAttribute(MENU_GROUP_ICON_ATTR, resolved.slug)
              icon.setAttribute(MODEL_ICON_ATTR, resolved.slug)
              icon.setAttribute(MODEL_ICON_SEAT_ATTR, useMask ? 'mono' : 'color')
              icon.setAttribute('aria-hidden', 'true')
              // 变量就近写在这枚图标上：mask 与 background-image 两条路径都从它取值。
              if (icon.style && typeof icon.style.setProperty === 'function') {
                icon.style.setProperty(MODEL_ICON_VAR, modelIconDataUri(resolved.spec, useMask))
                // 光学修正与座上同规（满框形状收一点），这里基准是分组标题的 13px。
                const optical = typeof resolved.spec.o === 'number' && resolved.spec.o > 0 ? resolved.spec.o : 1
                if (optical !== 1) icon.style.setProperty(MODEL_ICON_SIZE_VAR, `${(MENU_GROUP_ICON_PX * optical).toFixed(2)}px`)
              }
              title.insertBefore(icon, title.firstChild)
            } catch (_) {}
            // 标题上也留一份门属性：标明该标题已被装饰，并让测试/排障可直接定位。
            iconDomSetAttr(title, MENU_GROUP_ATTR, resolved.slug)
            iconDomSetAttr(title, MODEL_ICON_ATTR, resolved.slug)
            iconDomSetAttr(title, MODEL_ICON_SEAT_ATTR, useMask ? 'mono' : 'color')
          }
        }

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
          // 弹窗分组标题与座是两处独立渲染面：座不在（菜单开着而 composer 被替换）时
          // 也不能漏掉分组装饰，故先把菜单这半算完，再走座的分支。
          decorateMenuGroups()
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
          // 弹窗分组标题同理：菜单会被官方 portal 到 body，它也带 seat 属性，
          // 上面那条通用清理能顺带摘掉标题上的标记，但**插进去的节点**要显式移除。
          clearMenuGroups()
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

        /**
         * 热重开复位：stop() 把 disposed 置真、并断开 MutationObserver；
         * 重新打开功能时必须先复位，否则 start() 挂上的订阅与重算都会被
         * `state.disposed` 早退挡掉（表现为「关一次再开，图标再也不回来」）。
         * observerCreated 同样要复位，否则观察者不会被重新建立。
         */
        const revive = () => {
          state.disposed = false
          state.observerCreated = false
          // 上一次 stop 已让会话/directory 订阅与观察者全灭，这里把「记住的会话」
          // 一并清掉，让 subscribe()/apply() 重新解析当前会话。
          state.lastSession = undefined
          state.lastProvider = null
          state.seat = null
        }

        return { start, stop, apply, clear, revive }
      }
