// 客户端半分片：设置栏左侧标签手动排序与显隐（动态映射 Slot order 与版本通知）。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域。
// 原 apply 内「枢纽段」整段迁出：除两组件外还向 apply 其余部分暴露排序/显隐读写
// 助手与 createSectionBackendSync（额度卡段复用），全部经工厂返回值解构回原名。
// 参数面 { ctx, rpcCall }；syncNavDom 重赋值命中 client.js 工厂作用域的同一 let，
// 无需箱体；hooks 本段未用。

function createSettingsNavTabs({ ctx, rpcCall }) {
      // ── 设置栏左侧标签手动排序与显隐（动态映射 Slot order 与版本通知）────
      const STORAGE_KEY_NAV_ORDER = 'dsh-service-settings-nav-order'
      const STORAGE_KEY_NAV_HIDDEN = 'dsh-service-settings-nav-hidden'
      const SETTINGS_NAV_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
      const SETTINGS_NAV_MAX_ITEMS = 64

      const readSettingsNavIdList = (storageKey, fallback, options = {}) => {
        try {
          const raw = localStorage.getItem(storageKey)
          if (!raw) return fallback
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed) || parsed.length > SETTINGS_NAV_MAX_ITEMS) return fallback
          if (!parsed.every((id) => typeof id === 'string' && SETTINGS_NAV_ID_RE.test(id))) return fallback
          return options.excludeHost === true ? parsed.filter((id) => id !== 'dsh-service') : parsed
        } catch (_) {
          return fallback
        }
      }

      const readSettingsNavOrder = () => readSettingsNavIdList(STORAGE_KEY_NAV_ORDER, null)

      const writeSettingsNavOrder = (order) => {
        try {
          if (order === null) {
            localStorage.removeItem(STORAGE_KEY_NAV_ORDER)
          } else {
            localStorage.setItem(STORAGE_KEY_NAV_ORDER, JSON.stringify(order))
          }
        } catch (_) {}
      }

      const readSettingsNavHidden = () => readSettingsNavIdList(STORAGE_KEY_NAV_HIDDEN, [], { excludeHost: true })

      const writeSettingsNavHidden = (hidden) => {
        try {
          if (hidden === null || hidden.length === 0) {
            localStorage.removeItem(STORAGE_KEY_NAV_HIDDEN)
          } else {
            const filtered = hidden.filter((id) => id !== 'dsh-service')
            localStorage.setItem(STORAGE_KEY_NAV_HIDDEN, JSON.stringify(filtered))
          }
        } catch (_) {}
      }

      let navOrderRevision = 0
      // 长期集合只登记「本插件自己接管」的订阅者：包装 subscribe 转发进来的回调（各自
      // disposer 精确摘除，见 restoreSlots）与管理页组件的监听。原生账本里的既有订阅者
      // 绝不复制进来——复制品没有对应 disposer，原生退订后仍会滞留到插件卸载，并在
      // 此期间被每轮通知直呼。
      const navOrderListeners = new Set()
      // 私有 SlotCore 属兼容探测面（不在公开契约内，不能增强依赖）：只用于「现读当前记录与
      // 订阅者快照」，读到的对象当轮用完即弃；宿主没有该私有面时自动退化为公开路径
      // （包装订阅者 + __dsh_nav_bump__ 哨兵），不抛错、不留残留。
      const readSettingsSectionRecord = () => {
        try {
          const core = ctx.slots?._core
          if (core && typeof core.record === 'function') return core.record('settings.section') || null
        } catch (_) {}
        return null
      }
      const collectNativeSlotListeners = (record) => {
        const snapshot = new Set()
        try {
          const listeners = record && record.listeners
          if (listeners && typeof listeners[Symbol.iterator] === 'function') {
            for (const fn of listeners) {
              if (typeof fn === 'function') snapshot.add(fn)
            }
          }
        } catch (_) {}
        return snapshot
      }

      const notifyNavOrderChanged = () => {
        navOrderRevision++
        // 每轮现读现取：先于插件加载的原生订阅者只活在本次调用的局部快照里，绝不长期持有。
        const record = readSettingsSectionRecord()
        const roundCandidates = new Set()
        for (const listener of navOrderListeners) roundCandidates.add(listener)
        for (const listener of collectNativeSlotListeners(record)) roundCandidates.add(listener)
        // 调用前逐项复核「此刻仍被订阅」：同一轮里前面的回调注销掉别的 fn（React 卸载清理、
        // 包装订阅 disposer）后，后面的快照枚举不得把它复活；长期集合里没有、当前原生账本里
        // 也没有即视为已注销，跳过。（集合本身是当轮的 Set，天然对两个来源去重。）
        const isStillSubscribed = (listener) => {
          if (navOrderListeners.has(listener)) return true
          const latest = readSettingsSectionRecord()
          return collectNativeSlotListeners(latest).has(listener)
        }
        for (const listener of roundCandidates) {
          if (typeof listener !== 'function') continue
          if (!isStillSubscribed(listener)) continue
          try { listener() } catch (_) {}
        }
        // 唤醒底层 SlotCore 及其已注册订阅者（如 DSH 外壳 useSections）：私有面探测后才调。
        try {
          if (record) {
            const core = ctx.slots?._core
            if (core && typeof core.markDirty === 'function') core.markDirty('settings.section', record)
            if (core && typeof core.flush === 'function') core.flush()
          }
        } catch (_) {}
        // 兜底原生变动触发器
        try {
          if (typeof ctx.slots?.register === 'function') {
            const dispose = ctx.slots.register({ name: 'settings.section', id: '__dsh_nav_bump__' }, () => null)
            if (typeof dispose === 'function') dispose()
          }
        } catch (_) {}
        syncNavDom()
      }

      let origSlotsEntries = null
      let restoreSlots = null
      if (ctx.slots && typeof ctx.slots.entries === 'function') {
        const origEntries = ctx.slots.entries.bind(ctx.slots)
        origSlotsEntries = origEntries
        const origGetVersion = typeof ctx.slots.getVersion === 'function' ? ctx.slots.getVersion.bind(ctx.slots) : null
        const origSubscribe = typeof ctx.slots.subscribe === 'function' ? ctx.slots.subscribe.bind(ctx.slots) : null

        ctx.slots.entries = function (key) {
          const raw = origEntries(key)
          if (key !== 'settings.section') return raw
          const customOrder = readSettingsNavOrder()
          const hiddenList = readSettingsNavHidden()
          const hiddenSet = new Set(hiddenList)

          const visibleEntries = raw.filter((e) => {
            const id = e.options?.id ?? e.options?.key ?? ''
            if (id === '__dsh_nav_bump__') return false
            if (id === 'dsh-service') return true
            return !hiddenSet.has(id)
          })

          if (!customOrder || customOrder.length === 0) {
            return visibleEntries
          }

          return visibleEntries.map((e) => {
            const id = e.options?.id ?? e.options?.key ?? ''
            const idx = customOrder.indexOf(id)
            const order = idx !== -1 ? idx * 10 : 10000 + (e.options?.order ?? 0)
            return Object.assign({}, e, {
              options: Object.assign({}, e.options, { order }),
            })
          })
        }

        if (origGetVersion) {
          ctx.slots.getVersion = function (key) {
            const base = origGetVersion(key)
            if (key === 'settings.section') {
              return base + navOrderRevision * 100000
            }
            return base
          }
        }

        const forwardedSettingsSubscriptions = new Set()
        if (origSubscribe) {
          ctx.slots.subscribe = function (key, fn) {
            if (key === 'settings.section') {
              navOrderListeners.add(fn)
              const nativeUnsub = origSubscribe(key, fn)
              const disposeForwarded = () => {
                if (!forwardedSettingsSubscriptions.delete(disposeForwarded)) return
                navOrderListeners.delete(fn)
                if (typeof nativeUnsub === 'function') nativeUnsub()
              }
              forwardedSettingsSubscriptions.add(disposeForwarded)
              return disposeForwarded
            }
            return origSubscribe(key, fn)
          }
        }

        restoreSlots = () => {
          ctx.slots.entries = origEntries
          if (origGetVersion) ctx.slots.getVersion = origGetVersion
          if (origSubscribe) ctx.slots.subscribe = origSubscribe
          for (const disposeForwarded of Array.from(forwardedSettingsSubscriptions)) disposeForwarded()
          navOrderListeners.clear()
        }
      }

      ctx.effect(() => () => {
        if (restoreSlots) restoreSlots()
      }, 'dsh-service settings nav slot wrapping')

      const getRawSettingsSections = () => {
        let list = []
        if (origSlotsEntries) list = origSlotsEntries('settings.section')
        else if (typeof ctx.slots?.entries === 'function') list = ctx.slots.entries('settings.section')
        return list.filter((e) => (e.options?.id ?? e.options?.key) !== '__dsh_nav_bump__')
      }

      const resolveSectionLabel = (options) => {
        if (!options) return ''
        const label = options.label
        if (typeof label === 'function') {
          try {
            const res = label()
            if (res) return String(res)
          } catch (_) {}
        } else if (typeof label === 'string' && label) {
          return label
        }
        return String(options.id ?? options.key ?? '')
      }

      syncNavDom = () => {
        if (typeof document === 'undefined' || !document.body) return
        const nav = typeof document.querySelector === 'function'
          ? document.querySelector('[role="dialog"] nav')
          : null
        if (!nav) return
        ensureSettingsNavBackendSynced()
        const buttons = typeof nav.querySelectorAll === 'function'
          ? nav.querySelectorAll('button')
          : []
        if (!buttons || buttons.length === 0) return

        const hiddenList = readSettingsNavHidden()
        const hiddenSet = new Set(hiddenList)
        const customOrder = readSettingsNavOrder()

        const raw = getRawSettingsSections()
        const labelToId = new Map()
        for (const e of raw) {
          const id = e.options?.id ?? e.options?.key ?? ''
          if (!id || id === '__dsh_nav_bump__') continue
          const label = resolveSectionLabel(e.options)
          if (label) labelToId.set(label.trim(), id)
          labelToId.set(id, id)
        }

        for (const button of buttons) {
          const readAttr = (name) => {
            if (typeof button.getAttribute !== 'function') return null
            try { return button.getAttribute(name) } catch (_) { return null }
          }
          const hasAttr = (name) => {
            if (typeof button.hasAttribute === 'function') return button.hasAttribute(name)
            if (button.attrs && typeof button.attrs.has === 'function') return button.attrs.has(name)
            return false
          }
          const labelSpan = typeof button.querySelector === 'function' ? button.querySelector('span') : null
          const text = (labelSpan ? labelSpan.textContent : button.textContent || '').trim()
          const title = (readAttr('title') || '').trim()
          const ariaLabel = (readAttr('aria-label') || '').trim()
          // 每次按「当前标签与当前 raw 账本」重新识别，不信任任何自身历史标记：行被 React 复用时
          // 旧 data-dsh-section-id（或本插件自打的四个归属标记）会指向已消失/已换名的条目，
          // 照它下发显隐与排序就是 stale 误伤。识别不出即按未知行清理。
          const id = labelToId.get(text) || labelToId.get(title) || labelToId.get(ariaLabel) || null
          if (!id) {
            // 行消失/换名/无法识别：与 markSettingsNavRows 的摘标记对齐，归属标记与内联样式一并还原，
            // 避免旧标记残留、被后续行复用时误伤（显隐/排序以后续 DOM 同步为准）。
            if (hasAttr('data-dsh-section-id') && typeof button.removeAttribute === 'function') {
              try { button.removeAttribute('data-dsh-section-id') } catch (_) {}
            }
            if (button.style) {
              button.style.display = ''
              button.style.order = ''
            }
            continue
          }
          if (readAttr('data-dsh-section-id') !== id && typeof button.setAttribute === 'function') {
            try { button.setAttribute('data-dsh-section-id', id) } catch (_) {}
          }

          if (button.style) {
            if (id === 'dsh-service') {
              button.style.display = ''
            } else if (hiddenSet.has(id)) {
              button.style.display = 'none'
            } else {
              button.style.display = ''
            }

            if (customOrder && customOrder.length > 0) {
              const idx = customOrder.indexOf(id)
              button.style.order = idx !== -1 ? String(idx) : '9999'
            } else {
              button.style.order = ''
            }
          }
        }

        // 老版本外壳的 nav 可能没有 children（或不足两项）：先探测再取，避免可选链之外的下标直取报错。
        const navChildren = nav.children
        const navList = typeof nav.querySelector === 'function'
          ? (nav.querySelector('[class*="navList"]') || (navChildren && navChildren[1]) || null)
          : null
        if (navList && navList.style && customOrder && customOrder.length > 0) {
          navList.style.display = 'flex'
        }
      }

      // 统一配置区块的后端同步（设置栏标签、额度卡排序共用一份实现）：
      // 拉取失败本会话内可重试；写后端失败挂 pending，下次拉取成功后重推本地。
      // localStorage 仍是首帧缓存，后端成功拉到时为权威事实源。
      const createSectionBackendSync = ({ section, readOrder, readHidden, writeLocal }) => {
        const state = { synced: false, pushPending: false }
        const persist = (order, hidden) => {
          rpcCall('config-set', { section, value: { order, hidden } })
            .then((res) => { if (!res || res.ok !== true) state.pushPending = true })
            .catch(() => { state.pushPending = true })
        }
        const persistReset = () => {
          rpcCall('config-set', { section, value: null })
            .then((res) => { if (!res || res.ok !== true) state.pushPending = true })
            .catch(() => { state.pushPending = true })
        }
        const pushLocal = () => {
          const order = readOrder()
          const hidden = readHidden()
          if ((order && order.length > 0) || (hidden && hidden.length > 0)) persist(order, hidden)
          else persistReset()
        }
        const pull = async () => {
          try {
            const res = await rpcCall('config-get', { section })
            if (!res || res.ok !== true || res.value === undefined) {
              state.synced = false
              return
            }
            // 本地写已生效但后端落盘失败时，本地是待提交的新事实；先重推，不能让旧远端覆盖它。
            if (state.pushPending) {
              state.pushPending = false
              pushLocal()
              return
            }
            const remote = res.value
            const hasRemote = remote !== null && typeof remote === 'object' && (Array.isArray(remote.order) || Array.isArray(remote.hidden))
            if (hasRemote) {
              writeLocal(Array.isArray(remote.order) ? remote.order : null, Array.isArray(remote.hidden) ? remote.hidden : [])
              return
            }
            // 宿主尚未存入该配置，但当前本地已有历史配置 → 自动初次迁移至后端
            pushLocal()
          } catch (_) {
            // 拉取失败（瞬时网络/宿主重启窗口）：允许同会话内下次打开面板重试。
            state.synced = false
          }
        }
        return {
          persist,
          persistReset,
          ensureSynced: () => {
            if (state.synced) {
              // 上次写后端失败：本地已生效的配置重推一次，尽量收窄多端漂移窗口。
              if (state.pushPending) {
                state.pushPending = false
                pushLocal()
              }
              return
            }
            state.synced = true
            void pull()
          },
        }
      }

      const settingsNavBackend = createSectionBackendSync({
        section: 'settingsNav',
        readOrder: () => readSettingsNavOrder(),
        readHidden: () => readSettingsNavHidden(),
        writeLocal: (order, hidden) => {
          writeSettingsNavOrder(order)
          writeSettingsNavHidden(hidden)
          notifyNavOrderChanged()
        },
      })
  const ensureSettingsNavBackendSynced = settingsNavBackend.ensureSynced
  return { settingsNavBackend, createSectionBackendSync, SETTINGS_NAV_MAX_ITEMS, getRawSettingsSections, navOrderListeners, notifyNavOrderChanged, readSettingsNavHidden, readSettingsNavOrder, resolveSectionLabel, writeSettingsNavHidden, writeSettingsNavOrder, ensureSettingsNavBackendSynced }
}
