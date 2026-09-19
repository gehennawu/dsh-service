import assert from 'node:assert/strict'
import test from 'node:test'

function createRenderer(rpcCall, options = {}) {
  let moduleDefinition
  let moduleExports
  let activeCtx = null
  const slotComponents = new Map()
  const slotVersions = new Map()
  const slotSubscribers = new Map()
  if (options.initialSlots) {
    for (const [name, list] of Object.entries(options.initialSlots)) {
      const map = new Map()
      for (const item of list) {
        const entryKey = item.options?.key ?? item.options?.id ?? 'entry'
        map.set(entryKey, item)
      }
      slotComponents.set(name, map)
      slotVersions.set(name, 1)
    }
  }
  const mountedSlots = new Set()
  const renderedComponents = new Map()
  const hookState = new Map()
  const effectState = new Map()
  const effectCleanups = new Map()
  const timers = []
  const factoryDisposers = []
  const localeListeners = new Set()
  const localeDictionaries = new Map()
  const sessionListeners = new Set()
  const eventHandlers = new Map()
  const sentNotifications = []
  const notificationInstances = []
  let focuses = 0
  const storage = new Map(Object.entries(options.initialStorage || {}))
  const featureListeners = new Set()
  let featureSettings = {
    modelUsage: true,
    quotaLookup: true,
    backupMaintenance: true,
    taskNotifications: true,
    healthz: true,
    skillManager: true,
    subagentRoute: true,
    // v1.8：模型厂家/渠道图标默认开（与宿主 DEFAULT_FEATURE_SETTINGS 同值）。
    modelProviderIcons: true,
    ...(options.featureSettings || {}),
  }
  const featureScope = {
    getSnapshot: () => ({ status: 'ready', value: featureSettings, base: {}, user: featureSettings, revision: 0, writable: true, mode: 'host' }),
    subscribe(listener) {
      featureListeners.add(listener)
      return () => featureListeners.delete(listener)
    },
    async set(field, value) {
      featureSettings = { ...featureSettings, [field]: value }
      for (const listener of featureListeners) listener()
    },
    async unset(field) {
      featureSettings = { ...featureSettings }
      delete featureSettings[field]
      for (const listener of featureListeners) listener()
    },
  }
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  }
  let notificationPermission = options.notificationPermission
  let sessionSnapshot = { ids: [], byId: {}, current: undefined, phase: 'ready' }
  const statusListeners = new Set()
  const statusPending = new Map()
  const statusRunning = new Map()
  let statusSnapshot = new Map()
  // publishStatus 同构：ids = byId ∪ running ∪ pending，每个会话都有条目，
  // 无待审时会话的 pendingInteraction 为 undefined（而非条目缺席）。
  const publishStatusSnapshot = () => {
    const ids = new Set([...statusRunning.keys(), ...statusPending.keys()])
    const next = new Map()
    for (const id of ids) next.set(id, { running: statusRunning.get(id), pendingInteraction: statusPending.get(id) })
    statusSnapshot = next
    for (const listener of statusListeners) listener()
  }
  let activeLocale = 'zh'
  let localeRevision = 0
  let currentComponent
  let currentSlot
  let hookCursor = 0
  let roots = new Map()
  let reloads = 0
  // React #31 语义（真实 react-dom 行为）：children 里出现「裸对象」——不是本替身
  // createElement 产物（无 type 字段）、也不是带 $$typeof 的官方元素——就抛错。
  // 真壳会把这类树整个炸掉（设置节槽位错误边界吞成白屏），软替身曾把它掩盖
  // （会话管理「清除已删除记录」白屏根因：对象形态 res.error 直接进了 React children）。
  const isElementLike = (value) => value !== null && typeof value === 'object' && (('type' in value) || ('$$typeof' in value))
  const assertValidChildren = (children) => {
    for (const child of children) {
      if (child === null || child === undefined || typeof child !== 'object') continue
      if (Array.isArray(child)) { assertValidChildren(child); continue }
      if (isElementLike(child)) continue
      throw new Error('Minified React error #31 (test double): object is not a valid React child: ' + JSON.stringify(child).slice(0, 120))
    }
  }
  // strict session 槽语义（opt-in）：模拟真实渲染器的 (entry,binding) inject 缓存与
  // 会话绑定生命周期（undefined→session、卸载重挂都换新 binding；同 binding 重渲染
  // 复用首次注入产物）。默认关闭，行为与既有硬编码 session-1 完全一致。
  const sessionSlot = {
    mounted: options.initialSessionMounted !== false,
    sessionId: options.initialSessionId === undefined ? 'session-1' : options.initialSessionId,
    binding: {},
    epoch: 0,
  }
  const sessionInjectCache = new WeakMap()
  let activeModelDirectories = options.modelDirectories

  function scheduleRender() {
    renderAll()
  }

  const React = {
    createElement(type, props, ...children) {
      assertValidChildren(children)
      return { type, props: props || {}, children }
    },
    useState(initial) {
      assert.ok(currentComponent, 'useState called outside a component')
      const hooks = hookState.get(currentComponent) || []
      hookState.set(currentComponent, hooks)
      const index = hookCursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (value) => {
        hooks[index] = typeof value === 'function' ? value(hooks[index]) : value
        scheduleRender()
      }]
    },
    useEffect(effect, dependencies) {
      assert.ok(currentComponent, 'useEffect called outside a component')
      const component = currentComponent
      const effects = effectState.get(component) || new Map()
      effectState.set(component, effects)
      const index = hookCursor++
      const previous = effects.get(index)
      const changed = previous === undefined
        || dependencies === undefined
        || previous.length !== dependencies.length
        || dependencies.some((value, dependencyIndex) => !Object.is(value, previous[dependencyIndex]))
      if (!changed) return
      effects.set(index, dependencies === undefined ? undefined : dependencies.slice())
      const cleanups = effectCleanups.get(component) || new Map()
      effectCleanups.set(component, cleanups)
      const previousCleanup = cleanups.get(index)
      if (typeof previousCleanup === 'function') previousCleanup()
      cleanups.delete(index)
      queueMicrotask(() => {
        const cleanup = effect()
        if (typeof cleanup === 'function') cleanups.set(index, cleanup)
      })
    },
    useRef(initial) {
      assert.ok(currentComponent, 'useRef called outside a component')
      const hooks = hookState.get(currentComponent) || []
      hookState.set(currentComponent, hooks)
      const index = hookCursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    // 与真实 react-dom 的 createPortal 同语义的测试替身：portal 子树仍在渲染树里
    // 可遍历（断言用），但挂在带 portalContainer 标记的 #portal 节点之下。
    createPortal(child, container) {
      return { type: '#portal', props: { portalContainer: container }, children: [child] }
    },
  }

  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        moduleDefinition = definition
      },
    },
    focus() {
      focuses += 1
    },
    location: {
      reload() {
        reloads += 1
      },
    },
  }

  function evaluate(node) {
    if (Array.isArray(node)) return node.map(evaluate)
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const previousComponent = currentComponent
      const previousCursor = hookCursor
      const epochSuffix = currentSlot === 'conversation.input.right' && options.strictSessionSlots === true ? ':' + sessionSlot.epoch : ''
      currentComponent = currentSlot === undefined ? node.type : currentSlot + ':' + node.type.name + epochSuffix
      hookCursor = 0
      const output = node.type(node.props)
      currentComponent = previousComponent
      hookCursor = previousCursor
      return evaluate(output)
    }
    return { ...node, children: node.children.map(evaluate) }
  }

  function renderAll() {
    const next = new Map()
    for (const [slot, entries] of slotComponents) {
      if (!mountedSlots.has(slot)) continue
      currentSlot = slot
      const rendered = []
      for (const { component, options: entryOptions } of entries.values()) {
        let occupantProps
        if (options.strictSessionSlots === true && slot === 'conversation.input.right') {
          // strict 语义：会话未就绪不渲染；同 (entry,binding) 缓存首次注入产物。
          if (sessionSlot.mounted !== true || sessionSlot.sessionId === undefined || sessionSlot.sessionId === null) continue
          if (entryOptions === undefined || typeof entryOptions.inject !== 'function') continue
          let perBinding = sessionInjectCache.get(entryOptions)
          if (perBinding === undefined) {
            perBinding = new WeakMap()
            sessionInjectCache.set(entryOptions, perBinding)
          }
          occupantProps = perBinding.get(sessionSlot.binding)
          if (occupantProps === undefined) {
            occupantProps = entryOptions.inject(sessionSlot.sessionId)
            perBinding.set(sessionSlot.binding, occupantProps)
          }
        } else {
          // 与真实外壳一致：条目 meta 的 inject(sessionId) 产物作为组件 props。
          occupantProps = entryOptions && typeof entryOptions.inject === 'function'
            ? entryOptions.inject(entryOptions.testSessionId === undefined ? 'session-1' : entryOptions.testSessionId)
            : null
        }
        // 槽主注入的 owner props（如右栏文档槽的 resourceAddress/content/wrap）：
        // 真实运行由槽主 renderSlot 时给出，测试用 options.slotProps[槽名] 提供同一形态。
        const ownerProps = (options.slotProps || {})[slot]
        if (ownerProps !== undefined) {
          occupantProps = Object.assign({}, occupantProps === null || occupantProps === undefined ? {} : occupantProps, ownerProps)
        }
        rendered.push(evaluate(React.createElement(component, occupantProps)))
      }
      currentSlot = undefined
      renderedComponents.set(slot, entries)
      next.set(slot, rendered)
    }
    roots = next
    return roots
  }

  function unmountSlot(slot) {
    const component = renderedComponents.get(slot)
    if (component !== undefined) {
      const prefix = slot + ':'
      for (const [key, cleanups] of effectCleanups) {
        if (typeof key !== 'string' || !key.startsWith(prefix)) continue
        for (const cleanup of cleanups.values()) cleanup()
        effectCleanups.delete(key)
        effectState.delete(key)
        hookState.delete(key)
      }
      renderedComponents.delete(slot)
    }
    mountedSlots.delete(slot)
    renderAll()
  }

  function visit(node, callback) {
    if (Array.isArray(node)) {
      for (const child of node) visit(child, callback)
      return
    }
    if (node === null || node === undefined || typeof node !== 'object') return
    callback(node)
    for (const child of node.children || []) visit(child, callback)
  }

  function textOf(node) {
    if (Array.isArray(node)) return node.map(textOf).join('')
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node !== 'object') return String(node)
    return (node.children || []).map(textOf).join('')
  }

  return {
    async load() {
      if (notificationPermission === undefined) {
        delete globalThis.Notification
      } else {
        class FakeNotification {
          constructor(title, options) {
            sentNotifications.push({ title, body: options?.body })
            notificationInstances.push(this)
          }
          static requestPermission() {
            notificationPermission = 'granted'
            FakeNotification.permission = 'granted'
            return Promise.resolve('granted')
          }
          close() {}
        }
        FakeNotification.permission = notificationPermission
        globalThis.Notification = FakeNotification
      }
      await import(`../client.js?test=${Date.now()}-${Math.random()}`)
      assert.equal(moduleDefinition.id, '@gehennawu/dsh-service')
      const plugin = moduleDefinition.factory((name) => {
        // react-dom 在平台 seed 表内（dsh-web-frontend 前端 bundle 核实）；圆环窄视口
        // 弹窗 portal 用它，这里提供同语义替身。
        if (name === 'react-dom') return { createPortal: React.createPortal }
        // 官方 markdown 渲染器同样在平台 seed 表内（seed.ts 核实，v0.36 接入）：
        // 默认提供可断言的替身组件；options.noUiPrimitives=true 模拟老外壳 seed 缺席（抛错）。
        if (name === '@deepseek-ai/dsh-client-ui-primitives') {
          if (options.noUiPrimitives === true) throw new Error('simulated legacy shell without ui-primitives seed')
          const plain = {
            // v1.4.2 回归替身：复现 DSH 0.1.2-alpha.4 外壳的崩溃语义——渲染器对代码块
            // 无条件解引用 labels.code.copyLabel/copiedLabel（源码核实：wp 内 o.labels.code.*）。
            // text 含 ``` 栅栏而调用方没传 labels 时，抛与真机一致的 TypeError（整节空白根因）。
            MarkdownText: (props) => {
              const text = props && props.text
              const hasFence = typeof text === 'string' && text.includes('```')
              if (hasFence && (props === undefined || props.labels === undefined || props.labels.code === undefined)) {
                throw new TypeError("Cannot read properties of undefined (reading 'code')")
              }
              const node = React.createElement('div', { 'data-testid': 'md-markdown' }, text)
              if (props !== undefined && props.labels !== undefined) node.props['data-labels-code-copy'] = String(props.labels.code && props.labels.code.copyLabel)
              return node
            },
            MessageText: (props) => React.createElement('div', { 'data-testid': 'md-message' }, props && props.text),
          }
          // options.nestedMarkdown=true 模拟互操作包裹形态：组件被包成 {default: fn}。
          if (options.nestedMarkdown === true) {
            return { MarkdownText: { default: plain.MarkdownText }, MessageText: { default: plain.MessageText } }
          }
          // options.memoMarkdown=true 模拟真实 shell 的真机形态（v0.36 实证 keys=[$$typeof,type,compare]）：
          // MarkdownText 是 React.memo 的返回对象，本身是合法组件类型（createElement 直通）。
          if (options.memoMarkdown === true) {
            return {
              MarkdownText: { $$typeof: Symbol.for('react.memo'), type: plain.MarkdownText, compare: null },
              MessageText: { $$typeof: Symbol.for('react.memo'), type: plain.MessageText, compare: null },
            }
          }
          return plain
        }
        assert.equal(name, 'react')
        return React
      })
      const ctx = {
        connection: { rpc: { call: rpcCall } },
        locale: {
          register(namespace, dictionaries) {
            localeDictionaries.set(namespace, dictionaries)
            localeRevision += 1
            for (const listener of localeListeners) listener()
            return () => localeDictionaries.delete(namespace)
          },
          bind(namespace) {
            return (key, params = {}) => {
              const dictionaries = localeDictionaries.get(namespace) || {}
              const template = dictionaries[activeLocale]?.[key] ?? dictionaries.zh?.[key] ?? key
              return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
            }
          },
          getSnapshot() {
            return { active: activeLocale, revision: localeRevision, locales: [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }] }
          },
          subscribe(listener) {
            localeListeners.add(listener)
            return () => localeListeners.delete(listener)
          },
          setLocale(locale) {
            activeLocale = locale
            localeRevision += 1
            for (const listener of localeListeners) listener()
          },
        },
        timer: {
          timeout(callbackOrDelay, maybeDelay) {
            if (typeof callbackOrDelay === 'function') {
              const timer = { delay: maybeDelay, resolve: callbackOrDelay }
              timers.push(timer)
              return () => {
                const index = timers.indexOf(timer)
                if (index >= 0) timers.splice(index, 1)
              }
            }
            return new Promise((resolve) => timers.push({ delay: callbackOrDelay, resolve }))
          },
        },
        settingsScope: {
          bind(spec) {
            assert.equal(spec.namespace, 'dsh-service')
            return featureScope
          },
        },
        slots: {
          inject(key, callback) {
            // 与 cordis 的 slot 注入同语义：回调返回的 disposer 是这条注入的效应，
            // 句柄被释放（或槽声明折叠）时执行它。旧替身丢弃返回值，会掩盖
            // 「开关关闭后条目仍挂着」这类真实缺陷。
            const disposer = callback()
            return () => { if (typeof disposer === 'function') disposer() }
          },
          register(slotOptions, component) {
            // keyed 槽（sidebar.right.tab.document 一类）用 key 标识条目，普通槽用 id。
            const entryKey = slotOptions.key ?? slotOptions.id ?? 'entry'
            const entries = slotComponents.get(slotOptions.name) || new Map()
            entries.set(entryKey, { component, options: slotOptions })
            slotComponents.set(slotOptions.name, entries)
            slotVersions.set(slotOptions.name, (slotVersions.get(slotOptions.name) || 0) + 1)
            const subs = slotSubscribers.get(slotOptions.name)
            if (subs) { for (const fn of subs) fn() }
            // 挂载门控：mountOnly 白名单优先（只挂被测槽，其余一律不渲染）；
            // 否则默认不挂「右栏编辑正文」（它需要槽主注入的 owner props，
            // 无 props 渲染会发出 file-read 请求，干扰与它无关的用例）。
            const defaultUnmounted = ['sidebar.right.tab.document']
            const shouldMount = Array.isArray(options.mountOnly)
              ? options.mountOnly.includes(slotOptions.name)
              : slotOptions.name !== 'settings.plugin.item' && !(options.initiallyUnmounted ?? defaultUnmounted).includes(slotOptions.name)
            if (shouldMount) mountedSlots.add(slotOptions.name)
            return () => {
              // 与真实 cordis 一致：disposer 只摘除本条目，整槽无占用时才取消挂载。
              // 此前误杀整个槽名——「关闭左列入口」会把整个设置面板从渲染树里炸掉。
              const name = slotOptions.name
              const live = slotComponents.get(name)
              if (live) {
                live.delete(entryKey)
                if (live.size === 0) mountedSlots.delete(name)
              }
              slotVersions.set(name, (slotVersions.get(name) || 0) + 1)
              const nameSubs = slotSubscribers.get(name)
              if (nameSubs) { for (const fn of nameSubs) fn() }
              renderAll()
            }
          },
          entries(key) {
            const map = slotComponents.get(key)
            if (!map) return []
            return Array.from(map.values())
          },
          getVersion(key) {
            return slotVersions.get(key) || 0
          },
          subscribe(key, listener) {
            let listeners = slotSubscribers.get(key)
            if (!listeners) {
              listeners = new Set()
              slotSubscribers.set(key, listeners)
            }
            listeners.add(listener)
            return () => {
              listeners.delete(listener)
            }
          },
        },
        // 真实 Cordis 运行时标准方法：随时可用。
        // options.services / options.modelDirectories / 动态服务均经 get / inject 读取。
        inject(deps, callback) {
          const scope = {}
          for (const dep of Array.isArray(deps) ? deps : [deps]) {
            scope[dep] = this.get(dep)
          }
          const disposer = callback(scope)
          return () => { if (typeof disposer === 'function') disposer() }
        },
        get(service) {
          if (service === 'modelDirectories') return activeModelDirectories
          if (service === 'uiSession') {
            return options.legacyRuntime ? undefined : {
              sessionStatus: {
                getSnapshot: () => statusSnapshot,
                subscribe(listener) {
                  statusListeners.add(listener)
                  return () => statusListeners.delete(listener)
                },
              },
            }
          }
          return options.services?.[service]
        },
        effect(callback) {
          const dispose = callback()
          if (typeof dispose === 'function') factoryDisposers.push(dispose)
          return typeof dispose === 'function' ? dispose : () => {}
        },
        on(event, handler) {
          const handlers = eventHandlers.get(event) || new Set()
          handlers.add(handler)
          eventHandlers.set(event, handlers)
          return () => handlers.delete(handler)
        },
        sessions: {
          list: {
            getSnapshot: () => sessionSnapshot,
            subscribe(listener) {
              sessionListeners.add(listener)
              return () => sessionListeners.delete(listener)
            },
          },
        },
      }
      // 真实 Cordis 运行时行为守卫：对未在 inject 声明的服务进行直接属性访问必须抛错，
      // 防止写出看似安全却在真机触发 cannot get property without inject 的代码。
      const declaredInjectedServices = new Set([
        'slots', 'connection', 'timer', 'locale', 'sessions', 'settingsScope',
        'effect', 'on', 'inject', 'get', 'baseUrl', 'logger',
      ])
      const guardedCtx = new Proxy(ctx, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && !declaredInjectedServices.has(prop) && !(prop in Object.prototype)) {
            throw new Error(`cannot get property "${prop}" without inject`)
          }
          return Reflect.get(target, prop, receiver)
        },
      })
      activeCtx = guardedCtx
      plugin.apply(guardedCtx)
      moduleExports = plugin
      renderAll()
      await this.flush()
    },
    async flush() {
      await new Promise((resolve) => setImmediate(resolve))
      await Promise.resolve()
    },
    // 工厂级 ctx.effect 的 disposer（批量轮询表等）：测试末尾显式停表，防止真实 setInterval 挂住进程。
    disposeFactory() {
      while (factoryDisposers.length > 0) {
        const batch = factoryDisposers.splice(0)
        for (const dispose of batch) dispose()
      }
    },
    async advanceTimer(expectedDelay) {
      const index = expectedDelay === undefined ? 0 : timers.findIndex((timer) => timer.delay === expectedDelay)
      const [timer] = index < 0 ? [] : timers.splice(index, 1)
      assert.ok(timer, expectedDelay === undefined ? 'no pending timer' : `no pending ${expectedDelay}ms timer`)
      timer.resolve()
      await this.flush()
      return timer.delay
    },
    async advanceNonHealthTimer() {
      const index = timers.findIndex((timer) => timer.delay !== 5000)
      const [timer] = index < 0 ? [] : timers.splice(index, 1)
      assert.ok(timer, 'no pending non-health timer')
      timer.resolve()
      await this.flush()
      return timer.delay
    },
    pendingTimerDelays() {
      return timers.map((timer) => timer.delay)
    },
    findButton(label) {
      let match
      for (const tree of roots.values()) {
        visit(tree, (node) => {
          if (node.type === 'button' && textOf(node) === label) match = node
        })
      }
      assert.ok(match, `button ${JSON.stringify(label)} was not rendered; tree text: ${this.text()}`)
      return match
    },
    findSwitches() {
      const switches = []
      for (const tree of roots.values()) {
        visit(tree, (node) => {
          if (node.type === 'button' && node.props?.role === 'switch') switches.push(node)
        })
      }
      return switches
    },
    setSessions(byId) {
      sessionSnapshot = { ids: Object.keys(byId), byId, current: undefined, phase: 'ready' }
      // reconcileStatus 同构：list 快照播种/回收 running 事实；待审事实独立于 list 快照，
      // 不因行刷新清除（真实运行时里 pending 只随 publishPendingInteractions 变化）。
      for (const [id, row] of Object.entries(byId)) statusRunning.set(id, row.running === true)
      for (const id of [...statusRunning.keys()]) if (!(id in byId)) statusRunning.delete(id)
      for (const listener of sessionListeners) listener()
      publishStatusSnapshot()
      renderAll()
    },
    // 待审事实（publishPendingInteractions 同构）：entries 为 [sessionId, {pendingInteraction}]，
    // pendingInteraction 是交互对象（{kind, key, sessionId}）或 undefined；传全量即整体替换。
    setSessionStatus(entries) {
      statusPending.clear()
      for (const [id, status] of entries) statusPending.set(id, status?.pendingInteraction)
      publishStatusSnapshot()
      renderAll()
    },
    // 选定当前会话（引擎按 list.current 找 modelDirectory）：会话切换用例需要它。
    setCurrentSession(sessionId, byId = { [sessionId]: { id: sessionId } }) {
      sessionSnapshot = { ids: Object.keys(byId), byId, current: sessionId, phase: 'ready' }
      for (const listener of sessionListeners) listener()
      renderAll()
    },
    // 新版 DSH 运行时（0.1.6）：快照中无 current 字段，以 retainedBy.mainView 标识当前主会话。
    setMainViewSession(sessionId, byId = { [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } } }) {
      sessionSnapshot = { ids: Object.keys(byId), byId, phase: 'ready' }
      for (const listener of sessionListeners) listener()
      renderAll()
    },
    sessionSubscriptionCount() {
      return sessionListeners.size
    },
    emitConnectionReset() {
      for (const handler of eventHandlers.get('connection/reset') || []) handler()
    },
    notifications() {
      return sentNotifications.slice()
    },
    notificationInstances() {
      return notificationInstances.slice()
    },
    focusCount() {
      return focuses
    },
    mount(slot) {
      assert.ok(slotComponents.has(slot), `slot ${slot} is not registered`)
      mountedSlots.add(slot)
      renderAll()
    },
    unmount(slot) {
      unmountSlot(slot)
    },
    dictionaries(namespace) {
      return localeDictionaries.get(namespace)
    },
    setLocale(locale) {
      activeLocale = locale
      localeRevision += 1
      for (const listener of localeListeners) listener()
      renderAll()
    },
    hasSlot(name) {
      return slotComponents.has(name)
    },
    roots() {
      return [...roots.values()]
    },
    hasTest(testId) {
      let found = false
      for (const tree of roots.values()) visit(tree, (node) => { if (node.props && node.props['data-testid'] === testId) found = true })
      return found
    },
    async setFeature(field, value) {
      await featureScope.set(field, value)
      renderAll()
      await this.flush()
    },
    featureSettings() {
      return { ...featureSettings }
    },
    setSessionSlot({ sessionId, mounted = true, keepBinding = false } = {}) {
      const changed = sessionId !== undefined && sessionId !== sessionSlot.sessionId
      if (changed || !keepBinding) {
        sessionSlot.binding = {}
        sessionSlot.epoch += 1
      }
      if (sessionId !== undefined) sessionSlot.sessionId = sessionId
      if (mounted === false) {
        sessionSlot.mounted = false
        unmountSlot('conversation.input.right')
        return
      }
      sessionSlot.mounted = true
      mountedSlots.add('conversation.input.right')
      renderAll()
    },
    setModelDirectories(value) {
      activeModelDirectories = value
      renderAll()
    },
    registrations() {
      const out = {}
      for (const [slot, entries] of slotComponents) {
        out[slot] = []
        for (const { options } of entries.values()) out[slot].push({ ...options })
      }
      return out
    },
    get ctx() {
      return activeCtx
    },
    get slots() {
      return activeCtx ? activeCtx.slots : null
    },
    slotSubscriptionCount(key) {
      return slotSubscribers.get(key)?.size ?? 0
    },
    reloadCount() {
      return reloads
    },
    moduleExports() {
      return moduleExports
    },
    findByTestId(testId) {
      let match
      for (const tree of roots.values()) visit(tree, (node) => {
        if (node.props?.['data-testid'] === testId) match = node
      })
      assert.ok(match, `test id ${JSON.stringify(testId)} was not rendered`)
      return match
    },
    findAllByTestIdPrefix(prefix) {
      const matches = []
      for (const tree of roots.values()) visit(tree, (node) => {
        if (typeof node.props?.['data-testid'] === 'string' && node.props['data-testid'].startsWith(prefix)) matches.push(node)
      })
      return matches
    },
    // 带父指针的结构查找：断言 DOM 归属（如某节点挂在哪个容器里、紧跟谁）时用。
    findNode(predicate) {
      let match
      const walk = (node, parent) => {
        if (Array.isArray(node)) { for (const child of node) walk(child, parent); return }
        if (node === null || node === undefined || typeof node !== 'object') return
        if (match === undefined && predicate(node)) { match = { node, parent }; return }
        for (const child of node.children || []) walk(child, node)
      }
      for (const tree of roots.values()) walk(tree, undefined)
      return match
    },
    text(slot) {
      if (slot !== undefined) return textOf(roots.get(slot))
      return [...roots.values()].map(textOf).join('')
    },
  }
}

test('plugin configuration card saves feature switches and disabled features disappear from Client public slots', async () => {
  const calls = []
  const renderer = createRenderer(async (channel, endpoint) => {
    calls.push(endpoint)
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'offline' }
    if (endpoint === 'permissions-plan') return { ok: false, error: 'disabled fixture' }
    if (endpoint === 'health') return { ok: true, value: { uptime: 0, rss: 0, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: false, items: [] } }
    if (endpoint === 'diagnostics') return { ok: true, value: { checks: [], status: 'ok' } }
    if (endpoint === 'quota') return { ok: true, value: { providers: [], serverTime: Date.now() } }
    if (endpoint === 'web') return { ok: true, value: { instanceId: 'new-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    featureSettings: { modelUsage: false, quotaLookup: false, backupMaintenance: false, taskNotifications: false },
    notificationPermission: 'granted',
  })

  await renderer.load()
  assert.ok(renderer.registrations()['settings.plugin.item'].some((entry) => entry.key === 'dsh-service'))
  renderer.mount('settings.plugin.item')
  assert.match(renderer.text('settings.plugin.item'), /服务控制（dsh-service）.*控制可选功能和外部能力.*立即生效，无需重启/)
  assert.doesNotMatch(renderer.text('settings.plugin.item'), /模型统计|额度查询|备份维护|任务通知|\/healthz 探活端点/)
  const featureCardToggle = renderer.findByTestId('feature-card-toggle')
  assert.equal(featureCardToggle.props['aria-expanded'], 'false')
  featureCardToggle.props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('feature-card-toggle').props['aria-expanded'], 'true')
  // v0.39：卡片开关体 = 分组式 FeatureGroups（运行与观测/维护/交互/外部能力）。
  assert.match(renderer.text('settings.plugin.item'), /服务控制（dsh-service）.*运行与观测.*健康诊断.*模型统计.*额度查询.*维护.*备份维护.*技能.*子代理.*会话管理.*交互.*任务通知.*移动端适配.*外部能力.*\/healthz 探活端点/)
  // v0.39：通知不再是顶层标签（配置→通知 常驻，功能关闭时仅置灰标注），
  // 所以这里只断言被关功能对应的内容不出现。
  assert.doesNotMatch(renderer.text('settings.section'), /模型统计|额度查询|备份维护/)
  assert.equal(renderer.hasSlot('conversation.input.left'), false)
  assert.equal(renderer.hasSlot('conversation.input.right'), false)
  // 会话订阅计数：本测试只关了 modelUsage/quotaLookup/backupMaintenance/taskNotifications
  // 里的一部分——taskNotifications 仍开着，它持有的那份订阅是既有行为；模型厂家图标
  // （modelProviderIcons 未关）又各持一份。不变量是「功能全关时不留空闲订阅」，
  // 不是「永远不订阅」。下面显式验证关掉图标功能后计数回落。
  const sessionsBeforeIconOff = renderer.sessionSubscriptionCount()
  assert.ok(sessionsBeforeIconOff >= 1, 'enabled features should hold their session subscriptions')
  assert.equal(calls.includes('usage'), false)
  assert.equal(calls.includes('backup-list'), false)
  assert.equal(calls.includes('quota'), false)

  // 关掉「模型厂家图标」→ 它那份会话订阅必须被摘除（证明订阅随功能挂/卸，
  // 而不是永久占用）。
  await renderer.setFeature('modelProviderIcons', false)
  await renderer.flush()
  assert.equal(
    renderer.sessionSubscriptionCount(),
    sessionsBeforeIconOff - 1,
    'disabling the icon feature must release exactly its own session subscription',
  )
  await renderer.setFeature('modelProviderIcons', true)
  await renderer.flush()
  assert.equal(renderer.sessionSubscriptionCount(), sessionsBeforeIconOff, 're-enabling restores it')

  const modelSwitch = renderer.findByTestId('feature-switch-modelUsage')
  modelSwitch.props.onClick()
  await renderer.flush()
  assert.equal(renderer.featureSettings().modelUsage, true)
  assert.match(renderer.text('settings.section'), /模型统计/)
  assert.equal(calls.includes('usage'), true)

  await renderer.setFeature('backupMaintenance', true)
  // v0.39：备份维护收敛为维护子页——进入「维护」后子导航里应出现「备份维护」。
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /备份维护/)
  assert.equal(calls.includes('backup-list'), true)

  await renderer.setFeature('taskNotifications', true)
  assert.equal(renderer.hasSlot('conversation.input.left'), true)
  // 任务通知（既有）与模型厂家图标（v1.8，按会话切换重算渠道图标）各持一份会话订阅。
  assert.equal(renderer.sessionSubscriptionCount(), 2)

  await renderer.setFeature('quotaLookup', true)
  assert.match(renderer.text('settings.section'), /额度查询/)
  assert.equal(renderer.hasSlot('conversation.input.right'), true)
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  assert.equal(calls.includes('quota'), true)
})

test('health diagnostics switch hides the tab, gates diagnostics RPCs, and hot-restores', async () => {
  const calls = []
  const renderer = createRenderer(async (channel, endpoint) => {
    calls.push(endpoint)
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'offline' }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: false, items: [] } }
    if (endpoint === 'diagnostics') return { ok: true, value: { checks: [], status: 'ok' } }
    if (endpoint === 'quota') return { ok: true, value: { providers: [], serverTime: Date.now() } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, days: {}, totals: {}, errors: {}, projects: [], indexedSessions: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'web') return { ok: true, value: { instanceId: 'new-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { featureSettings: { healthDiagnostics: false } })

  await renderer.load()
  // 关闭态：健康诊断标签不渲染，权限浅检查与完整诊断都不发请求（真门控，不是只隐藏）。
  renderer.mount('settings.section')
  assert.doesNotMatch(renderer.text('settings.section'), /健康诊断/)
  assert.equal(calls.includes('permissions-plan'), false)
  assert.equal(calls.includes('diagnostics'), false)

  // 插件配置卡的胶囊开关：默认关，点击立即恢复标签并发起权限浅检查。
  renderer.mount('settings.plugin.item')
  renderer.findByTestId('feature-card-toggle').props.onClick()
  await renderer.flush()
  const healthSwitch = renderer.findByTestId('feature-switch-healthDiagnostics')
  assert.equal(healthSwitch.props['aria-checked'], 'false')
  healthSwitch.props.onClick()
  await renderer.flush()
  assert.equal(renderer.featureSettings().healthDiagnostics, true)
  assert.match(renderer.text('settings.section'), /健康诊断/)
  assert.equal(calls.includes('permissions-plan'), true)

  // 进入健康诊断标签自动跑一次完整诊断。
  renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.equal(calls.includes('diagnostics'), true)

  // 再次关闭：标签即时消失；概览的运行指标轮询不受本开关影响。
  await renderer.setFeature('healthDiagnostics', false)
  assert.doesNotMatch(renderer.text('settings.section'), /健康诊断/)
  assert.equal(calls.filter((endpoint) => endpoint === 'health').length > 0, true)
})

test('plugin registers balanced zh and en dictionaries', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  const dictionaries = renderer.dictionaries('dsh-service')
  assert.ok(dictionaries)
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort())
  assert.ok(Object.keys(dictionaries.zh).length >= 25)
})

test('health panel loads immediately, refreshes every five seconds, and stops after unmount', async () => {
  let healthCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') {
      healthCalls += 1
      return {
        ok: true,
        value: {
          uptimeSeconds: 3661,
          rssBytes: 157286400,
          liveSessions: 2,
          persistedSessions: 7,
          activeAgents: 1,
          activeJobs: 3,
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { initiallyUnmounted: ['settings.section'] })

  await renderer.load()
  assert.equal(healthCalls, 0)

  renderer.mount('settings.section')
  await renderer.flush()
  assert.equal(healthCalls, 1)
  assert.match(renderer.text('settings.section'), /运行时间.*1 小时 1 分钟/)
  assert.match(renderer.text('settings.section'), /内存 RSS.*150 MB/)
  assert.deepEqual(renderer.pendingTimerDelays(), [5000])

  assert.equal(await renderer.advanceTimer(), 5000)
  assert.equal(healthCalls, 2)
  assert.deepEqual(renderer.pendingTimerDelays(), [5000])

  renderer.unmount('settings.section')
  assert.deepEqual(renderer.pendingTimerDelays(), [])
  assert.equal(healthCalls, 2)
})

test('service panel puts versions first and renders switchable provider-prefixed usage charts by project', async () => {
  const day = new Date().toLocaleDateString('en-CA')
  let refreshes = 0
  const usage = {
    updatedAt: Date.now() - 301000,
    indexedSessions: 2,
    totals: { steps: 5, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 },
    projects: [{ id: 'project-1', title: 'Project One', path: '/workspace/project' }],
    errors: {
      models: [
        { key: 'deepseek/deepseek-chat|RATE_LIMIT|429', provider: 'deepseek', model: 'deepseek-chat', code: 'RATE_LIMIT', status: 429, message: 'rate limit exceeded', count: 4, projectId: 'project-1', projectTitle: 'Project One' },
        { key: 'deepseek/deepseek-chat|AUTH|401', provider: 'deepseek', model: 'deepseek-chat', code: 'AUTH', status: 401, message: 'invalid api key', count: 2, projectId: 'project-1', projectTitle: 'Project One' },
      ],
      tools: [
        { key: 'edit|FS_NOT_OBSERVED', tool: 'edit', code: 'FS_NOT_OBSERVED', message: 'edit requires reading <path> first — read the file, then retry', count: 5, projectId: 'project-1', projectTitle: 'Project One' },
        { key: 'grep|PATH_NOT_FOUND', tool: 'grep', code: 'PATH_NOT_FOUND', message: 'grep search failed: <path> not found', count: 2, projectId: 'project-1', projectTitle: 'Project One' },
      ],
    },
    days: {
      [day]: {
        totals: { steps: 5, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 },
        projects: [{ id: 'project-1', title: 'Project One', path: '/workspace/project', totals: { steps: 14, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 }, models: [
          { id: 'deepseek/deepseek-chat', provider: 'deepseek', model: 'deepseek-chat', totals: { steps: 5, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 } },
          { id: 'openai/gpt-5', provider: 'openai', model: 'gpt-5', totals: { steps: 4, inputTokens: 900, outputTokens: 180, cacheReadTokens: 2000, cacheWriteTokens: 80, cacheHitRate: 0.6 } },
          { id: 'anthropic/claude', provider: 'anthropic', model: 'claude', totals: { steps: 3, inputTokens: 800, outputTokens: 160, cacheReadTokens: 1000, cacheWriteTokens: 60, cacheHitRate: 0.5 } },
          { id: 'google/gemini', provider: 'google', model: 'gemini', totals: { steps: 2, inputTokens: 700, outputTokens: 140, cacheReadTokens: 500, cacheWriteTokens: 40, cacheHitRate: 0.4 } },
        ] }],

      },
    },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usage }
    if (endpoint === 'usage-refresh') { refreshes += 1; return { ok: true, value: usage } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  const overviewText = renderer.text('settings.section')
  // v0.39 六页单行导航：概览→模型统计→额度查询→健康诊断→维护→配置（通知并入配置页）。
  assert.match(overviewText, /概览.*模型统计.*额度查询.*健康诊断.*维护.*配置/)
  assert.doesNotMatch(overviewText, /服务控制提醒/)
  assert.match(overviewText, /版本信息.*进程与运行环境.*平台.*Node 版本.*运行时间.*内存 RSS/)
  assert.match(overviewText, /报错信息.*最近 24 小时.*模型报错.*2 类.*工具报错.*2 类/)
  const overviewPanel = renderer.text(renderer.findByTestId('tab-panel'))
  assert.doesNotMatch(overviewPanel, /立即健康检查|文件权限|模型使用|备份管理|服务重启/)
  const overviewErrors = renderer.findByTestId('overview-errors-region')
  assert.match(overviewErrors.props.style.border, /solid/)
  assert.equal(renderer.findByTestId('overview-errors-title').children[0], '报错信息')
  assert.doesNotMatch(renderer.text(overviewErrors), /报错信息/)
  await renderer.findButton('▸ 模型报错（2 类）').props.onClick()
  await renderer.flush()
  let expandedText = renderer.text('settings.section')
  assert.match(expandedText, /最近 24 小时.*RATE_LIMIT.*429.*4 次.*AUTH.*401.*2 次/)
  assert.ok(expandedText.indexOf('RATE_LIMIT') < expandedText.indexOf('AUTH'))
  assert.doesNotMatch(expandedText, /历史累计|FS_NOT_OBSERVED|PATH_NOT_FOUND/)
  await renderer.findButton('▸ 工具报错（2 类）').props.onClick()
  await renderer.flush()
  expandedText = renderer.text('settings.section')
  assert.match(expandedText, /edit.*FS_NOT_OBSERVED.*5 次.*grep.*PATH_NOT_FOUND.*2 次/)
  assert.doesNotMatch(expandedText, /\/workspace\/|README\.md|client\.js/)
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  const healthText = renderer.text('settings.section')
  assert.match(healthText, /健康诊断.*立即健康检查/)
  assert.doesNotMatch(healthText, /版本信息|进程与运行环境|模型使用/)
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  const text = renderer.text('settings.section')
  // 统计卡不再有「token 结构」标题与「按日期展示…」说明行，直接进入项目分页与图表。
  assert.doesNotMatch(text, /token 结构|按日期展示输入、输出和缓存 token。/)
  const projectTabs = renderer.findByTestId('usage-project-tabs')
  const activeProjectTab = renderer.findButton('全部项目')
  const usageChart = renderer.findByTestId('usage-chart')
  assert.equal(projectTabs.props.style.borderBottom.includes('solid'), true)
  assert.equal(activeProjectTab.props.style.color, 'var(--dsw-alias-brand-primary)')
  assert.equal(activeProjectTab.props.style.borderBottom, '2px solid var(--dsw-alias-brand-primary)')
  assert.ok(usageChart.props.style.background)
  assert.equal(renderer.findByTestId('usage-y-axis').props['aria-label'], 'token 纵轴')
  assert.equal(renderer.findAllByTestIdPrefix('usage-grid-').length, 5)
  assert.match(text, /4\.3K.*3\.2K.*2\.2K.*1\.1K.*0/)
  assert.match(usageChart.props.style.borderBottom, /solid/)
  assert.match(text, /输入 tok.*输出 tok.*缓存 tok/)
  const statisticsRegion = renderer.findByTestId('usage-statistics-region')
  assert.match(statisticsRegion.props.style.border, /solid/)
  assert.match(text, /今日.*输入 tok.*输出 tok.*缓存 tok.*成功模型步骤.*缓存命中率/)
  assert.match(text, /近 7 天.*输入 tok.*输出 tok.*缓存 tok.*成功模型步骤.*缓存命中率/)
  assert.match(text, /token 总量.*4\.3K/)
  assert.equal(renderer.findAllByTestIdPrefix('usage-summary-today-').length, 6)
  assert.equal(renderer.findAllByTestIdPrefix('usage-summary-seven-').length, 6)
  assert.match(text, /1K|3K|4\.1K/)
  assert.match(text, /5 次/)
  assert.match(text, /deepseek\/deepseek-chat.*openai\/gpt-5.*anthropic\/claude/)
  assert.doesNotMatch(text, /google\/gemini/)
  assert.match(text, /▸ 展开其余 1 个模型/)
  // v0.31 用户点名：模型明细默认按「今日」口径排序（原近 7 天）。
  assert.match(text, /按今日 token 从多到少排列/)
  assert.equal(renderer.findByTestId('usage-model-sort-hint').children[0], '按今日 token 从多到少排列')
  assert.equal(renderer.findByTestId('usage-model-scope-today').props.style.color, 'var(--dsw-alias-brand-primary)')
  assert.notEqual(renderer.findByTestId('usage-model-scope-week').props.style.color, 'var(--dsw-alias-brand-primary)')
  assert.notEqual(renderer.findByTestId('usage-model-scope-all').props.style.color, 'var(--dsw-alias-brand-primary)')
  let topModelBars = renderer.findAllByTestIdPrefix('usage-model-bar-')
  assert.deepEqual(topModelBars.map((bar) => Number(bar.props['data-value'])), [4300, 3160, 2020])
  assert.equal(topModelBars[0].props['aria-label'], 'deepseek/deepseek-chat：今日 4.3K token')
  assert.equal(topModelBars[0].children[0].props.style.width, '100%')
  assert.equal(topModelBars[1].children[0].props.style.width, '73.49%')
  assert.equal(renderer.findAllByTestIdPrefix('usage-model-segment-').length, 9)
  await renderer.findButton('▸ 展开其余 1 个模型').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /google\/gemini.*▾ 收起模型列表/)
  topModelBars = renderer.findAllByTestIdPrefix('usage-model-bar-')
  assert.deepEqual(topModelBars.map((bar) => Number(bar.props['data-value'])), [4300, 3160, 2020, 1380])
  assert.equal(topModelBars[3].children[0].props.style.width, '32.09%')
  assert.equal(renderer.findAllByTestIdPrefix('usage-model-segment-').length, 12)
  await renderer.findButton('▾ 收起模型列表').props.onClick()
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /google\/gemini/)
  const segments = renderer.findAllByTestIdPrefix('usage-segment-')
  assert.ok(segments.length >= 3)
  const visibleSegment = segments.find((segment) => Number(segment.props['data-value']) > 0)
  assert.ok(visibleSegment)
  visibleSegment.props.onMouseEnter({ clientX: 220, clientY: 140 })
  await renderer.flush()
  const tooltip = renderer.findByTestId('usage-tooltip')
  assert.equal(tooltip.props.style.position, 'fixed')
  assert.equal(tooltip.props.style.left, '232px')
  assert.equal(tooltip.props.style.top, '152px')
  assert.equal(tooltip.children[0].includes(`日期：${day}\n输入 1,000 token\n输出 200 token\n缓存命中 3,100 token`), true)
  visibleSegment.props.onMouseLeave()
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /日期：.*输入.*Token/)
  assert.match(text, /缓存命中率/)
  assert.match(text, /Project One/)
  assert.doesNotMatch(text, /模型报错|工具报错|RATE_LIMIT|AUTH|FS_NOT_OBSERVED|PATH_NOT_FOUND|历史累计/)
  const plot = renderer.findByTestId('usage-plot')
  const xAxis = renderer.findByTestId('usage-x-axis')
  const bars = renderer.findAllByTestIdPrefix('usage-bar-')
  assert.equal(plot.props.style.height, '164px')
  assert.equal(xAxis.props.style.position, 'absolute')
  assert.equal(xAxis.props.style.bottom, '0')
  assert.equal(bars.length, 7)
  assert.equal(bars.some((bar) => Number.parseFloat(bar.props.style.height) > 112), true)
  assert.equal(refreshes, 1)
  assert.match(renderer.text('settings.section'), /输入 tok.*缓存命中率.*73\.2%/)
  await renderer.findButton('刷新统计').props.onClick()
  await renderer.flush()
  assert.equal(refreshes, 2)
})

test('usage partial failures stay visible globally, explain stale rows in zh/en, and clear after recovery', async () => {
  const day = new Date().toLocaleDateString('en-CA')
  const totals = { steps: 2, inputTokens: 120, outputTokens: 30, cacheReadTokens: 40, cacheWriteTokens: 5, cacheHitRate: 40 / 165 }
  const usageWithFailure = {
    updatedAt: Date.now(),
    indexedSessions: 2,
    successfulSessions: 1,
    failedSessions: [{ id: 'legacy-v0', code: 'format-migration-failed', message: 'Session format migration was refused.', stale: true }],
    totals,
    projects: [{ id: 'project-1', title: 'Project One', path: '/workspace/project' }],
    errors: { models: [], tools: [] },
    days: { [day]: { totals, projects: [{ id: 'project-1', title: 'Project One', path: '/workspace/project', totals, models: [] }] } },
  }
  const cleanUsage = { ...usageWithFailure, indexedSessions: 2, successfulSessions: 2, failedSessions: [] }
  let refreshes = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'usage-partial' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageWithFailure }
    if (endpoint === 'usage-refresh') { refreshes += 1; return { ok: true, value: cleanUsage } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()

  assert.equal(renderer.hasTest('usage-statistics-region'), true, 'partial success keeps the chart')
  assert.equal(renderer.hasTest('usage-failure-warning'), true, 'failure warning is outside the statistics gate')
  assert.match(renderer.text('settings.section'), /全部项目.*成功统计 1 个会话，跳过 1 个会话/)
  assert.match(renderer.text('settings.section'), /统计结果可能包含.*旧缓存数据/)
  assert.doesNotMatch(renderer.text('settings.section'), /legacy-v0/)
  renderer.findByTestId('usage-failure-details-toggle').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /legacy-v0.*会话格式转换被拒绝/)
  assert.match(renderer.text('settings.section'), /保留上次统计（已过期，仍计入总量）/)

  renderer.setLocale('en')
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /Global session indexing.*1 sessions indexed successfully, 1 skipped/)
  assert.match(renderer.text('settings.section'), /Totals may include retained cached data/)
  assert.match(renderer.text('settings.section'), /legacy-v0.*Session format migration was refused/)
  assert.match(renderer.text('settings.section'), /Retained stale statistics \(included in totals\)/)

  renderer.findByTestId('usage-refresh').props.onClick()
  await renderer.flush()
  assert.equal(refreshes, 1)
  assert.equal(renderer.hasTest('usage-failure-warning'), false, 'a clean manual refresh clears the warning')
  assert.equal(renderer.hasTest('usage-statistics-region'), true)
})

test('usage all-failed payload shows warning without indexed sessions and recovers on refresh', async () => {
  const failedUsage = {
    updatedAt: Date.now(),
    indexedSessions: 0,
    successfulSessions: 0,
    failedSessions: [{ id: 'broken-session', code: 'session-read-failed', message: '会话读取失败', stale: false }],
    totals: {},
    projects: [],
    errors: { models: [], tools: [] },
    days: {},
  }
  const recoveredUsage = {
    ...failedUsage,
    indexedSessions: 1,
    successfulSessions: 1,
    failedSessions: [],
  }
  let refreshes = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'usage-all-failed' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 1, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: failedUsage }
    if (endpoint === 'usage-refresh') { refreshes += 1; return { ok: true, value: recoveredUsage } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  renderer.setLocale('en')
  await renderer.flush()

  assert.equal(renderer.hasTest('usage-failure-warning'), true, 'all failures remain visible with indexedSessions=0')
  assert.equal(renderer.hasTest('usage-statistics-region'), false)
  assert.match(renderer.text('settings.section'), /Global session indexing.*0 sessions indexed successfully, 1 skipped/)
  renderer.findByTestId('usage-failure-details-toggle').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /broken-session.*Session could not be opened or read.*No cached data, excluded from totals/)

  renderer.findButton('Refresh usage').props.onClick()
  await renderer.flush()
  assert.equal(refreshes, 1)
  assert.equal(renderer.hasTest('usage-failure-warning'), false)
})

test('usage old payload without failedSessions remains compatible', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'usage-legacy' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 1, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: Date.now(), indexedSessions: 1, totals: {}, projects: [], days: {}, errors: {} } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('usage-failure-warning'), false)
  assert.equal(renderer.hasTest('usage-refresh-fallback'), false)
})

test('usage model list re-sorts and relabels when switching between total and today scopes', async () => {
  const formatDay = (offset) => {
    const date = new Date()
    date.setDate(date.getDate() - offset)
    return date.toLocaleDateString('en-CA')
  }
  const totals = (steps, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) => ({ steps, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cacheHitRate: cacheReadTokens / (inputTokens + cacheReadTokens + cacheWriteTokens) })
  const projectModels = (models) => [{ id: 'project-1', title: 'Project One', path: '/workspace/project', totals: { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0 }, models }]
  const usage = {
    updatedAt: Date.now(),
    indexedSessions: 2,
    totals: {},
    projects: [{ id: 'project-1', title: 'Project One', path: '/workspace/project' }],
    errors: { models: [], tools: [] },
    days: {
      [formatDay(9)]: {
        // 窗口外的旧用量：只进「累计」口径，让 claude 在累计下反超 gpt-5。
        totals: totals(2, 800, 200, 800, 200),
        projects: projectModels([
          { id: 'anthropic/claude', provider: 'anthropic', model: 'claude', totals: totals(2, 800, 200, 800, 200) },
        ]),
      },
      [formatDay(1)]: {
        totals: totals(8, 2500, 500, 7500, 250),
        projects: projectModels([
          // 昨日 gemini 独大：总量口径登顶，今日口径无数据跌出前三。
          { id: 'google/gemini', provider: 'google', model: 'gemini', totals: totals(6, 2000, 400, 6000, 200) },
          { id: 'deepseek/deepseek-chat', provider: 'deepseek', model: 'deepseek-chat', totals: totals(2, 500, 100, 1500, 50) },
        ]),
      },
      [formatDay(0)]: {
        totals: totals(12, 2700, 540, 6000, 240),
        projects: projectModels([
          { id: 'deepseek/deepseek-chat', provider: 'deepseek', model: 'deepseek-chat', totals: totals(5, 1000, 200, 3000, 100) },
          { id: 'openai/gpt-5', provider: 'openai', model: 'gpt-5', totals: totals(4, 900, 180, 2000, 80) },
          { id: 'anthropic/claude', provider: 'anthropic', model: 'claude', totals: totals(3, 800, 160, 1000, 60) },
        ]),
      },
    },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usage }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()

  const barValues = () => renderer.findAllByTestIdPrefix('usage-model-bar-').map((bar) => Number(bar.props['data-value']))
  // 默认今日口径：只聚合今天的数据——gemini 无今日用量消失，claude 进入前三且无折叠。
  assert.equal(renderer.findByTestId('usage-model-sort-hint').children[0], '按今日 token 从多到少排列')
  assert.equal(renderer.findByTestId('usage-model-scope-today').props.style.color, 'var(--dsw-alias-brand-primary)')
  assert.deepEqual(barValues(), [4300, 3160, 2020])
  assert.doesNotMatch(renderer.text('settings.section'), /google\/gemini/)
  assert.equal(renderer.findByTestId('usage-model-bar-deepseek/deepseek-chat').props['aria-label'], 'deepseek/deepseek-chat：今日 4.3K token')
  // 切到近 7 天：昨日巨量的 gemini 登顶 [8600, 6450, 3160]，claude 被折叠（第 9 天旧用量不计入）。
  await renderer.findByTestId('usage-model-scope-week').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('usage-model-sort-hint').children[0], '按近 7 天 token 从多到少排列')
  assert.deepEqual(barValues(), [8600, 6450, 3160])
  assert.match(renderer.text('settings.section'), /▸ 展开其余 1 个模型/)
  assert.equal(renderer.findByTestId('usage-model-bar-google/gemini').props['aria-label'], 'google/gemini：近 7 天 8.6K token')
  // 切到累计：第 9 天旧用量并入，claude（4020）反超 gpt-5 进入前三。
  await renderer.findByTestId('usage-model-scope-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('usage-model-sort-hint').children[0], '按累计 token 从多到少排列')
  assert.deepEqual(barValues(), [8600, 6450, 4020])
  assert.match(renderer.text('settings.section'), /▸ 展开其余 1 个模型/)
  assert.equal(renderer.findByTestId('usage-model-bar-anthropic/claude').props['aria-label'], 'anthropic/claude：累计 4K token')
  // 切回默认今日口径：排序恢复初始视图。
  await renderer.findByTestId('usage-model-scope-today').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('usage-model-sort-hint').children[0], '按今日 token 从多到少排列')
  assert.deepEqual(barValues(), [4300, 3160, 2020])
  assert.doesNotMatch(renderer.text('settings.section'), /google\/gemini/)
})

test('service panel uses distinct cards, display surfaces, and semantic action colors', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.7.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: Date.now(), indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()

  // v0.39 视觉基础层：面板根节点带命名空间作用域锚 + 当前内部页标记 + 内容宽容器类。
  const panelRoot = renderer.findByTestId('service-panel-root')
  assert.equal(panelRoot.props['data-dshsvc-root'], '')
  assert.equal(panelRoot.props['data-dshsvc-page'], 'overview')
  assert.equal(panelRoot.props.className, 'dshsvc-page')

  const tabs = renderer.findByTestId('service-tab-list')
  const panel = renderer.findByTestId('tab-panel')
  const overviewSurface = renderer.findByTestId('health-display')
  const activeOverviewTab = renderer.findButton('概览')
  // v0.39：主导航 = 单行六页分段条（.dshsvc-tabs），激活段为条内反色实底圆角块。
  assert.equal(tabs.props.className, 'dshsvc-tabs')
  assert.equal(tabs.props.role, 'tablist')
  // v0.34.2：激活块配色走双主题变量（浅=深块+白字，暗=近白块+黑字），组件只引用 var。
  assert.equal(activeOverviewTab.props.style.color, 'var(--dsh-svc-tab-active-text)')
  assert.equal(activeOverviewTab.props.style.background, 'var(--dsh-svc-tab-active-bg)')
  assert.equal(activeOverviewTab.props['aria-selected'], 'true')
  // 分段条样式：激活段 = 条内实底圆角块（非独立胶囊）。
  assert.equal(activeOverviewTab.props.style.borderRadius, '8px')
  assert.equal(panel.props.style.boxShadow, undefined)
  assert.equal(panel.props.style.border, undefined)
  assert.equal(panel.props.style.background, undefined)
  assert.equal(overviewSurface.props.style.background, 'var(--dsh-svc-surface-bg)')
  assert.equal(overviewSurface.props.style.color, 'var(--dsh-svc-text)')
  assert.equal(overviewSurface.props.style.border, '1px solid var(--dsh-svc-border)')
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  const healthRegion = renderer.findByTestId('health-diagnostics-region')
  assert.equal(healthRegion.props.style.border, '1px solid var(--dsh-svc-border)')
  assert.equal(healthRegion.props.style.background, 'var(--dsh-svc-surface-bg)')
  assert.equal(healthRegion.props.style.color, 'var(--dsh-svc-text)')
  const healthAction = renderer.findButton('立即健康检查')
  assert.equal(healthAction.props['data-variant'], 'neutral')
  assert.equal(healthAction.props.style.background, 'var(--dsh-svc-page-bg)')
  assert.equal(healthAction.props.style.color, 'var(--dsh-svc-text)')
  assert.equal(healthAction.props.style.borderColor, 'var(--dsh-svc-border-strong)')
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findButton('刷新统计').props['data-variant'], 'neutral')
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()
  // v0.39：创建备份 = 非破坏主操作，低饱和品牌描边（brandGhost），不再是弱化中性钮。
  const createBackup = renderer.findButton('创建备份')
  assert.equal(createBackup.props['data-variant'], 'brandGhost')
  assert.equal(createBackup.props.style.background, 'transparent')
  assert.equal(createBackup.props.style.color, 'var(--dsh-svc-brand)')
  assert.equal(createBackup.props.style.borderColor, 'var(--dsh-svc-brand)')
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  const restartRegion = renderer.findByTestId('restart-region')
  assert.equal(restartRegion.props.style.border, '1px solid var(--dsh-svc-border)')
  assert.equal(restartRegion.props.style.background, 'var(--dsh-svc-surface-bg)')
  assert.equal(restartRegion.props.style.color, 'var(--dsh-svc-text)')
  // v0.39 安全教义回归：重启初次出现 = 危险描边（dangerGhost），实底只留给最终确认。
  const restart = renderer.findButton('重启 dsh web')
  assert.equal(restart.props['data-variant'], 'dangerGhost')
  assert.equal(restart.props.style.background, 'transparent')
  assert.equal(restart.props.style.color, 'var(--dsh-svc-danger)')
})

test('tab and top alerts identify health and backup failures without treating an empty backup list as failure', async () => {
  const permissions = { supported: true, planId: 'p1', targetOwner: '1000:1000', items: [{ label: 'DSH_HOME', path: '/home/node/.dsh', owner: '0:0', mode: '0555', writable: false }] }
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.8.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: Date.now(), indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    if (endpoint === 'backup-list') return { ok: false, error: 'storage unavailable' }
    if (endpoint === 'permissions-plan') return { ok: true, value: permissions }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  const text = renderer.text('settings.section')
  // v0.39 六页导航：故障 ⚠ 从子功能聚合到顶层页（诊断=健康/权限故障，维护=备份/重启故障）。
  assert.equal(renderer.hasTest('tab-dot-diagnostics'), true)
  assert.equal(renderer.hasTest('tab-dot-maintenance'), true)
  assert.equal(renderer.hasTest('tab-dot-overview'), false, 'overview has no failure')
  assert.equal(renderer.hasTest('tab-dot-configuration'), false, 'configuration has no failure')
  assert.equal(renderer.hasTest('tab-dot-usage'), false, 'usage has no failure')
  // v0.39：单行六页分段条，容器 testid = service-tab-list，按钮 testid = service-tab-<id>。
  assert.deepEqual(renderer.findAllByTestIdPrefix('service-tab-').map((node) => node.props['data-testid']), [
    'service-tab-list',
    'service-tab-overview', 'service-tab-usage', 'service-tab-quota', 'service-tab-diagnostics',
    'service-tab-maintenance', 'service-tab-configuration',
  ], 'order: overview → usage → quota → diagnostics → maintenance → configuration')
  // 重启不再是顶层标签：收敛为维护子页（maintenance-tab-*）。
  assert.equal(renderer.hasTest('top-tab-restart'), false, 'no legacy top tabs remain')
  assert.equal(renderer.hasTest('service-tab-restart'), false, 'restart is a maintenance subpage, not a primary tab')
  assert.match(text, /服务控制提醒.*健康诊断.*维护/)
})

test('maintenance aggregate page: subagent default, localStorage persistence, and fallback when stored page is disabled', async () => {
  const rpc = async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'offline' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
  // 首次进入维护页：默认「子代理」（用户点名），无 localStorage 记忆。
  const first = createRenderer(rpc)
  await first.load()
  await first.findButton('维护').props.onClick()
  await first.flush()
  assert.equal(first.findByTestId('maintenance-tab-subagent').props['aria-selected'], 'true')
  assert.equal(first.findByTestId('service-panel-root').props['data-dshsvc-page'], 'maintenance')
  // 用户切到「会话管理」：写入记忆键。
  await first.findByTestId('maintenance-tab-sessions').props.onClick()
  await first.flush()
  assert.equal(localStorage.getItem('dsh-service-maintenance-tab'), 'sessions')

  // 冷启动带记忆：直接落在已存储子页。
  const stored = createRenderer(rpc)
  localStorage.setItem('dsh-service-maintenance-tab', 'backup')
  await stored.load()
  await stored.findButton('维护').props.onClick()
  await stored.flush()
  assert.equal(stored.findByTestId('maintenance-tab-backup').props['aria-selected'], 'true')

  // 记忆的子页被功能关闭：整页移除，回退到白名单首项（会话管理）。
  const fallback = createRenderer(rpc, { featureSettings: { backupMaintenance: false } })
  localStorage.setItem('dsh-service-maintenance-tab', 'backup')
  await fallback.load()
  await fallback.findButton('维护').props.onClick()
  await fallback.flush()
  assert.equal(fallback.hasTest('maintenance-tab-backup'), false, 'disabled subpage is removed')
  assert.equal(fallback.findByTestId('maintenance-tab-sessions').props['aria-selected'], 'true', 'falls back to the first available page')
})

test('disabling the active primary page returns the panel to overview', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'offline' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('service-panel-root').props['data-dshsvc-page'], 'usage')
  // 当前页对应功能被关闭：标签即时消失，面板回退概览。
  await renderer.setFeature('modelUsage', false)
  await renderer.flush()
  assert.equal(renderer.hasTest('service-tab-usage'), false)
  assert.equal(renderer.findByTestId('service-panel-root').props['data-dshsvc-page'], 'overview')
})

test('overview layout aggregates status and actionable items without core action buttons', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.8.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    if (endpoint === 'backup-list') return { ok: false, error: 'storage unavailable' }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  // 备份失败（error 级）→ 状态摘要 error 文案 + 可行动项出现；错误项带「备份」文本。
  const orderText = renderer.text('settings.section')
  assert.match(orderText, /有 1 项需要处理/)
  assert.equal(renderer.hasTest('overview-actionables'), true)
  assert.match(renderer.text('settings.section'), /备份操作失败/)
  // 顺序：状态摘要 → 版本卡 → 进程与运行环境。
  // 页面头描述也含「版本信息」字样，锚点用版本卡标题+内容连排「版本信息dsh-service」。
  const firstVersion = orderText.indexOf('版本信息dsh-service')
  assert.ok(orderText.indexOf('有 1 项需要处理') < firstVersion, 'status summary precedes version card')
  assert.ok(firstVersion < orderText.indexOf('进程与运行环境'), 'version card precedes runtime metrics')
  // 核心操作按钮已移除：概览不再渲染健康检查/额度查询/创建备份入口。
  assert.equal(renderer.hasTest('overview-core-actions'), false, 'overview core actions row must be gone')
  assert.equal(renderer.hasTest('overview-action-health'), false)
  assert.equal(renderer.hasTest('overview-action-quota'), false)
  assert.equal(renderer.hasTest('overview-action-backup'), false)
  assert.doesNotMatch(orderText, /概览.{0,40}创建备份/, 'no create-backup shortcut on the overview panel')
  // 入口虽移除，顶层导航与各功能页自身不受影响：额度查询页仍可直接到达。
  const quotaTab = renderer.findButton('额度查询')
  assert.ok(quotaTab, 'quota tab remains reachable from the top nav')
})

test('overview status is informational when only update or empty-backup hints exist, and hidden when nothing is wrong beyond that', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.8.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true }, plugin: { current: '0.8.0', latest: '0.9.0', upToDate: false, url: 'https://github.com/gehennawu/dsh-service/releases' } } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  // 有可用更新 + 空备份 → info 级：两条提示进可行动项，状态摘要为提示文案。
  assert.match(renderer.text('settings.section'), /有 2 条提示/)
  assert.match(renderer.text('settings.section'), /检测到新版本可用/)
  assert.match(renderer.text('settings.section'), /还没有备份，建议创建一份/)
  // 干净场景（已是最新 + 已有备份）：无任何可行动项，状态摘要为正常运行。
  const clean = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.8.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [{ id: 'b1' }], totalBytes: 1024 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await clean.load()
  assert.equal(clean.hasTest('overview-actionables'), false, 'no actionable region when nothing needs attention')
  assert.match(clean.text('settings.section'), /所有系统运行正常/)
})

test('a reset card expiring today surfaces as an overview info item and disappears once the host drops it', async () => {
  const healthPayload = { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0, resetCardsExpiringToday: [{ provider: 'zai-coding-cn', label: '周额度重置卡' }] }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true }, plugin: { current: '0.9.0', latest: '0.9.0', upToDate: true } } }
    if (endpoint === 'health') return { ok: true, value: healthPayload }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [{ id: 'b1' }], totalBytes: 1024 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  // 今日到期 → info 级可行动项，带上卡名（无卡名时回落 provider）。
  assert.equal(renderer.hasTest('overview-actionables'), true)
  assert.match(renderer.text('settings.section'), /重置卡今日到期：周额度重置卡/)
  assert.match(renderer.text('settings.section'), /有 1 条提示/)

  // 次日宿主已自动移除该卡 → health 不再带该字段，提示随之消失（无需前端再判时间）。
  delete healthPayload.resetCardsExpiringToday
  await renderer.advanceTimer(5000)
  assert.equal(renderer.hasTest('overview-actionables'), false, 'the reminder must clear once the host stops reporting it')
  assert.match(renderer.text('settings.section'), /所有系统运行正常/)
})

test('a manual-launch runtime environment no longer occupies the overview actionable list', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance', runtimeEnv: { platform: 'linux', supervisorKind: null, manualStartLikely: true } } }
    if (endpoint === 'check-update') return { ok: true, value: { dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true }, plugin: { current: '0.9.0', latest: '0.9.0', upToDate: true } } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, platform: 'linux', arch: 'x64', nodeVersion: 'v22.14.0', liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [{ id: 'b1' }], totalBytes: 1024 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [
      { id: 'runtime-env', status: 'warning', detail: 'manual', advisory: true },
      { id: 'node-version', status: 'ok', detail: 'v22.14.0:22' },
    ] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  // 概览：手动启动环境是常驻环境事实，不生成状态项/可行动项，状态摘要回到「所有系统运行正常」（用户点名，2026-09-12）。
  assert.equal(renderer.hasTest('overview-actionables'), false, 'manual-launch runtime env must not create overview attention items')
  assert.equal(renderer.hasTest('overview-status'), true)
  assert.match(renderer.text('settings.section'), /所有系统运行正常/)
  assert.doesNotMatch(renderer.text('settings.section'), /疑似终端手动启动/)
  // 健康诊断：黄色行内提示与诊断口径照旧（只在诊断页呈现，且不点横幅/标签 ⚠）。
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /运行环境.*疑似终端手动启动，重启后不会自动拉起/)
  assert.doesNotMatch(renderer.text('settings.section'), /健康提醒/)
  assert.doesNotMatch(renderer.text('settings.section'), /服务控制提醒/)
  assert.equal(renderer.hasTest('tab-dot-health'), false)
})

test('quota windows at high usage no longer surface as overview attention items', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'diagnostics') return { ok: true, value: { checks: [], status: 'ok' } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [{ id: 'b1' }], totalBytes: 1024 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'zai-row', displayName: '智谱', adapted: true, kind: 'zai-coding-cn', refreshing: false, status: 'ok', fetchedAt: Date.now(),
            windows: [{ id: 'rolling', percent: 95, resetsAt: new Date(Date.now() + 3600_000).toISOString() }],
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  // 先进额度页把 ≥80% 窗口灌进 quota store，再回概览：额度高占用不再生成可行动项（v1.4.1 用户点名移除）。
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  await renderer.findButton('概览').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('overview-actionables'), false, 'quota windows must not create overview attention items')
  assert.equal(renderer.hasTest('overview-status'), true)
  assert.match(renderer.text('settings.section'), /所有系统运行正常/)
})

test('configuration page aggregates features and notifications without subpage memory', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'offline' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })
  await renderer.load()
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  // 恒开在「功能」子页，无记忆；分组标题渲染。
  assert.equal(renderer.findByTestId('config-tab-features').props['aria-selected'], 'true')
  assert.match(renderer.text('settings.section'), /运行与观测/)
  assert.match(renderer.text('settings.section'), /交互/)
  // v0.39 页面头部：标题随当前页切换，描述一行呈现（text() 只认槽名，节点文本用展平器）。
  const header = renderer.findByTestId('svc-page-header')
  const flattenNode = (node) => {
    let out = ''
    const walk = (current) => {
      if (Array.isArray(current)) { for (const child of current) walk(child); return }
      if (current === null || typeof current !== 'object') return
      for (const child of current.children || []) {
        if (typeof child === 'string') out += child
        else walk(child)
      }
    }
    walk(node)
    return out
  }
  assert.match(flattenNode(header), /配置/)
  assert.match(flattenNode(header), /功能开关与任务通知设置。/)
  // 切到「通知」子页；任务通知功能关闭时页面保留并置灰标注。
  await renderer.findByTestId('config-tab-notifications').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('config-tab-notifications').props['aria-selected'], 'true')
  await renderer.setFeature('taskNotifications', false)
  await renderer.flush()
  assert.equal(renderer.hasTest('config-notifications-page'), true)
  assert.match(renderer.text('settings.section'), /重新开启后通知才会生效/)
})

test('settings mount automatically shows separate DSH and plugin update states with release links', async () => {
  let updateCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'check-update') {
      updateCalls += 1
      return { ok: true, value: {
        dsh: { current: '0.1.0-rc.7', latest: '0.2.0', tags: { latest: '0.1.0-rc.7', next: '0.2.0', alpha: '0.3.0-alpha.1' }, upToDate: false, url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
        plugin: { current: '0.9.0', latest: '0.9.0', tags: { latest: '0.9.0', next: '0.9.0' }, upToDate: true, url: 'https://github.com/gehennawu/dsh-service/releases' },
      } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { initiallyUnmounted: ['settings.section'] })

  await renderer.load()
  assert.equal(updateCalls, 0)
  renderer.mount('settings.section')
  await renderer.flush()
  assert.equal(updateCalls, 1)
  const text = renderer.text('settings.section')
  assert.match(text, /DSH 0\.1\.0-rc\.7.*有新版本.*0\.2\.0/)
  assert.doesNotMatch(text, /正式版|预览版/, 'channel lines are no longer inline in the version row')
  assert.equal(renderer.findByTestId('version-plugin-link').props.style.color, 'var(--dsw-alias-label-primary)')
  assert.match(text, /dsh-service.*0\.9\.0.*已是最新版本/)
  assert.doesNotMatch(text, /检查更新/)
  assert.equal(renderer.findByTestId('version-dsh-link').props.href, 'https://github.com/deepseek-ai/DeepSeek-Harness/releases')
  assert.equal(renderer.findByTestId('version-plugin-link').props.href, 'https://github.com/gehennawu/dsh-service/releases')

  // 版本卡常驻支持边界声明（适配 DSH 0.1.1-rc.2 ~ 0.1.6-alpha.2；越界钉 0.1.6-alpha.3）；支持范围内的运行版本为中性色
  const supportBound = renderer.findByTestId('version-dsh-support-bound')
  assert.match(renderer.text('settings.section'), /0\.1\.1-rc\.2 ~ 0\.1\.6-alpha\.2/, 'support-bound declaration is always present')
  assert.equal(supportBound.props.style.color, 'var(--dsw-alias-label-secondary)')
  assert.equal(supportBound.props.style.background, 'transparent', 'supported run keeps the declaration neutral')
  // v1.5.1 用户点名：适配声明内联紧跟版本号（不排到状态之后）——扁平文本顺序=版本号→声明→状态。
  assert.match(text, /0\.9\.0（适配 DSH 0\.1\.1-rc\.2 ~ 0\.1\.6-alpha\.2）已是最新版本/,
    'support bound reads directly after the version number and before the status')

  // 「有新版本：…」整行可点击（小三角在前），点击行内下拉展开
  await renderer.findButton('有新版本：0.2.0').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /当前版本：0\.1\.0-rc\.7.*最新版本：0\.2\.0.*正式版 0\.1\.0-rc\.7.*预览版 0\.2\.0.*Alpha 版 0\.3\.0-alpha\.1/)
  assert.doesNotMatch(renderer.text('shell.overlay'), /正式版|预览版/, 'no overlay popup involved')
  assert.equal(renderer.findByTestId('version-dsh-channel-latest-npmjs').props.href, 'https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.0-rc.7')
  assert.equal(renderer.findByTestId('version-dsh-channel-next-npmjs').props.href, 'https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.0')
  assert.equal(renderer.findByTestId('version-dsh-channel-latest-npmmirror').props.href, 'https://www.npmmirror.com/package/@deepseek-ai/dsh/home?version=0.1.0-rc.7')
  assert.equal(renderer.findByTestId('version-dsh-channel-next-npmmirror').props.href, 'https://www.npmmirror.com/package/@deepseek-ai/dsh/home?version=0.2.0')
  assert.equal(renderer.findByTestId('version-dsh-channel-alpha').children[0], '0.3.0-alpha.1')
   assert.equal(renderer.findByTestId('version-dsh-channel-alpha-npmjs').props.href, 'https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.3.0-alpha.1')
   assert.equal(renderer.findByTestId('version-dsh-channel-alpha-npmmirror').props.href, 'https://www.npmmirror.com/package/@deepseek-ai/dsh/home?version=0.3.0-alpha.1')
   assert.equal(renderer.findAllByTestIdPrefix('version-dsh-channel-').length, 9, 'three channel lines with number + npmjs + npmmirror each')

  // 再点状态文本收起，行内信息消失
  await renderer.findButton('有新版本：0.2.0').props.onClick()
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /正式版|预览版/)
  assert.doesNotMatch(renderer.text('sidebar.footer.action'), /DSH 有更新/, 'sidebar update badge removed')
})

test('version card flags the DSH support bound red when running ≥ 0.1.6-alpha.3 (≤0.1.6-alpha.2 stays supported)', async () => {
  const cases = [
    { current: '0.1.2-rc.1', red: false },
    { current: '0.1.3-alpha.1', red: false },
    { current: '0.1.5-rc.1', red: false },
    { current: '0.1.5-rc.2', red: false },
    { current: '0.1.6-alpha.1', red: false },
    { current: '0.1.6-alpha.2', red: false },
    { current: '0.1.6-alpha.3', red: true },
    { current: '0.1.6', red: true },
  ]
  for (const item of cases) {
    const renderer = createRenderer(async (channel, endpoint) => {
      assert.equal(channel, '/dsh-service')
      if (endpoint === 'version') return { ok: true, value: { current: item.current, pluginVersion: '1.4.9', instanceId: 'x' } }
      if (endpoint === 'health') return { ok: false, error: 'not relevant' }
      if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
      if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
      if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    await renderer.load()
    const bound = renderer.findByTestId('version-dsh-support-bound')
    assert.match(renderer.text('settings.section'), /0\.1\.1-rc\.2 ~ 0\.1\.6-alpha\.2/, `bound note present on ${item.current}`)
    if (item.red) {
      assert.equal(bound.props.style.color, 'var(--dsw-alias-state-error-primary)', `${item.current} is at/above the unsupported bound and turns red`)
      assert.equal(bound.props.style.background, 'rgba(211,51,51,0.08)', `${item.current} gets the danger background`)
    } else {
      assert.equal(bound.props.style.color, 'var(--dsw-alias-label-secondary)', `${item.current} stays neutral`)
      assert.equal(bound.props.style.background, 'transparent', `${item.current} has no danger background`)
    }
  }
})

test('version card keeps the support bound inline after the version number, two rows on narrow containers', async () => {
  // 注入样式捕获：主渲染器环境没有 document，这里挂最小桩接住 svcStyle 文本；
  // 同时补齐 nav 标记效果依赖的 MutationObserver/querySelector 面（有桩即走真实分支）。
  const injectedStyles = []
  class FakeMutationObserver { observe() {} disconnect() {} }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {},
    head: { appendChild(el) { injectedStyles.push(el.textContent) } },
    // 真实 DOM 元素必有 dataset（插件按 alpha.2 的 style[data-plugin] 归属约定写它）。
    createElement() { return { dataset: {}, remove() {} } },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  }
  try {
    const renderer = createRenderer(async (channel, endpoint) => {
      assert.equal(channel, '/dsh-service')
      if (endpoint === 'version') return { ok: true, value: { current: '0.1.5-rc.1', pluginVersion: '1.5.0', instanceId: 'x' } }
      if (endpoint === 'check-update') return { ok: true, value: { plugin: { current: '1.5.0', latest: '1.5.0', tags: { latest: '1.5.0', next: '1.5.0' }, upToDate: true, url: 'https://github.com/gehennawu/dsh-service/releases' } } }
      throw new Error(`unexpected endpoint ${endpoint}`)
    }, { initiallyUnmounted: ['settings.section'] })
    await renderer.load()
    renderer.mount('settings.section')
    await renderer.flush()

    // 宽容器：声明排在 identity（label+版本号）内部、紧跟版本号元素；不自带整行 basis。
    const noteWrap = renderer.findNode((node) => node.props?.className === 'dshsvc-version-note')
    assert.ok(noteWrap, 'support bound wrapper rendered')
    assert.equal(noteWrap.parent.props.className, 'dshsvc-version-identity', 'support bound lives inside the identity cluster (right after the version number)')
    const identityChildren = noteWrap.parent.children
    const linkIndex = identityChildren.findIndex((child) => child.props?.['data-testid'] === 'version-plugin-link')
    assert.ok(linkIndex >= 0, 'identity contains the plugin version link')
    assert.equal(identityChildren[linkIndex + 1], noteWrap.node, 'support bound directly follows the version number element')
    assert.equal(noteWrap.node.props.style.flexBasis, undefined, 'wide containers keep the note inline, never forced onto its own line')
    assert.match(renderer.text('settings.section'), /1\.5\.0（适配 DSH 0\.1\.1-rc\.2 ~ 0\.1\.6-alpha\.2）/)

    // 窄容器（≤480px）两行契约由容器查询负责：identity 转 block 让 版本号+声明 连排一块（行内文本
    // 自然换行，声明永不独占行），status 独立整行——移动端两行：版本号+声明 / 状态。
    const css = injectedStyles.join('')
    const narrowStart = css.indexOf('@container dshsvc-version (max-width:480px){')
    assert.ok(narrowStart >= 0, 'narrow container query present')
    const identityRuleStart = css.indexOf('.dshsvc-version-identity{flex-basis:100%;display:block}', narrowStart)
    const noteInlineStart = css.indexOf('.dshsvc-version-note{display:inline}', narrowStart)
    const statusRuleStart = css.indexOf('.dshsvc-version-status{flex-basis:100%;justify-content:flex-start !important}', narrowStart)
    assert.ok(identityRuleStart > narrowStart, 'identity takes the full first row and switches to inline text flow on narrow containers')
    assert.ok(noteInlineStart > narrowStart, 'note flows inline with the version number on narrow containers (never its own row)')
    assert.ok(statusRuleStart > narrowStart, 'status takes the second row on narrow containers')
    assert.equal(css.indexOf('.dshsvc-version-note{flex-basis:100%', narrowStart), -1,
      'narrow containers must not force the note onto its own row (two-row layout, not three)')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

test('channel version strings outside the safe charset render plain text without npm links', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return {
      ok: true,
      value: {
        dsh: { current: '0.1.0-rc.7', latest: '0.2.0', tags: { latest: '0.1.0-rc.7', next: 'bad/version' }, upToDate: false, url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
        plugin: { current: '0.9.0', latest: '0.9.0', tags: { latest: '0.9.0', next: '0.9.0' }, upToDate: true, url: 'https://github.com/gehennawu/dsh-service/releases' },
      },
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  assert.doesNotMatch(renderer.text('settings.section'), /正式版|预览版/)
  await renderer.findButton('有新版本：0.2.0').props.onClick()
  await renderer.flush()
  const next = renderer.findByTestId('version-dsh-channel-next')
  assert.equal(next.props.href, undefined)
  const nextNpm = renderer.findByTestId('version-dsh-channel-next-npmjs')
  assert.equal(nextNpm.props.href, undefined, 'unsafe version renders the npmjs label as plain text')
  const nextMirror = renderer.findByTestId('version-dsh-channel-next-npmmirror')
  assert.equal(nextMirror.props.href, undefined, 'unsafe version renders the npmmirror label as plain text')
  assert.match(renderer.text('settings.section'), /bad\/version/)
  assert.equal(renderer.findByTestId('version-dsh-channel-latest-npmjs').props.href, 'https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.0-rc.7')
  assert.equal(renderer.findByTestId('version-dsh-channel-latest-npmmirror').props.href, 'https://www.npmmirror.com/package/@deepseek-ai/dsh/home?version=0.1.0-rc.7')
})

test('opening health diagnostics runs once and reuses its short-lived result until explicitly refreshed', async () => {
  let calls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') { calls += 1; return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [{ id: 'permissions', status: 'ok', detail: '0' }] } } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  assert.equal(calls, 0)
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.equal(calls, 1)
  assert.match(renderer.text('settings.section'), /文件权限.*检查正常/)
  await renderer.findButton('概览').props.onClick()
  await renderer.flush()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.equal(calls, 1)
  await renderer.findButton('重新诊断').props.onClick()
  await renderer.flush()
  assert.equal(calls, 2)
})

test('health check button runs deep diagnostics and displays individual results', async () => {
  let calls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') {
      calls += 1
      return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [{ id: 'session-storage', status: 'ok', detail: '2' }, { id: 'backup-storage', status: 'info', detail: '0:0' }] } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.equal(calls, 1)
  // 空备份是信息级提示：文案照常展示，但没有健康提醒横幅。
  assert.doesNotMatch(renderer.text('settings.section'), /健康提醒/)
  assert.match(renderer.text('settings.section'), /会话存储.*可用，共 2 个会话快照/)
  assert.match(renderer.text('settings.section'), /备份存储.*备份目录可用，当前暂无备份/)
  assert.doesNotMatch(renderer.text('settings.section'), /0:0|正常.*2|警告.*0/)
})

test('health diagnostics omits file permissions check when host is non-Linux', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [{ id: 'session-storage', status: 'ok', detail: '3' }, { id: 'workspace-registry', status: 'ok', detail: '1' }, { id: 'dsh-home', status: 'ok', detail: '0755' }, { id: 'backup-storage', status: 'ok', detail: '2:1024' }, { id: 'tar', status: 'ok', detail: '/usr/bin/tar' }] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /文件权限|File permissions/)
  assert.match(renderer.text('settings.section'), /会话存储/)
  assert.match(renderer.text('settings.section'), /tar/)
})

test('permission panel shows the host plan and requires explicit confirmation before repair', async () => {
  const repairs = []
  const before = {
    supported: true,
    planId: 'permission-plan-1',
    targetOwner: '1000:1000',
    items: [
      { label: 'DSH_HOME', path: '/home/node/.dsh', owner: '0:0', mode: '0700', writable: true },
      { label: 'Project', path: '/workspace/project', owner: '0:0', mode: '0555', writable: false },
    ],
  }
  const after = {
    supported: true,
    planId: 'permission-plan-2',
    targetOwner: '1000:1000',
    items: [
      { label: 'DSH_HOME', path: '/home/node/.dsh', owner: '1000:1000', mode: '0700', writable: true },
      { label: 'Project', path: '/workspace/project', owner: '1000:1000', mode: '0755', writable: true },
    ],
  }
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: before }
    if (endpoint === 'permissions-deep') return { ok: true, value: { scanned: 12, durationMs: 3, ownerIssues: 1, directoryModeIssues: 1, fileModeIssues: 2, unreadable: 0, samples: [] } }
    if (endpoint === 'permissions-repair') {
      repairs.push(payload)
      return { ok: true, value: after }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  const initialText = renderer.text('settings.section')
  assert.match(initialText, /健康诊断.*文件权限/)
  // v0.39：权限与修复默认折叠——摘要警告与目标属主都在折叠区内，展开前不可见。
  assert.doesNotMatch(initialText, /健康提醒.*发现 1 个根目录异常/)
  assert.doesNotMatch(initialText, /目标属主：1000:1000/)
  assert.doesNotMatch(initialText, /模型使用/)
  assert.doesNotMatch(initialText, /\/home\/node\/\.dsh/)
  // 展开后：警告摘要、属主、详情与修复流程按原语义继续。
  await renderer.findByTestId('permissions-toggle').props.onClick()
  await renderer.flush()
  const expandedText = renderer.text('settings.section')
  assert.match(expandedText, /健康提醒.*发现 1 个根目录异常/)
  assert.match(expandedText, /发现 1 个根目录异常/)
  assert.match(expandedText, /目标属主：1000:1000/)
  await renderer.findButton('查看详情').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /DSH_HOME.*0:0.*0700/)
  await renderer.findButton('深度检查').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /扫描 12 项.*目录不可编辑 1.*文件不可编辑 2/)

  await renderer.findButton('修复权限').props.onClick()
  await renderer.flush()
  assert.equal(repairs.length, 0)
  assert.match(renderer.text('settings.section'), /跳过 \.git.*补充 Agent 读写权限.*保留已有执行位/)

  await renderer.findButton('确认修复').props.onClick()
  await renderer.flush()
  assert.deepEqual(repairs, [{ planId: before.planId }])
  assert.match(renderer.text('settings.section'), /DSH_HOME.*1000:1000.*0700/)
})

test('health diagnostics lists only abnormal plugins and reloads failed ones with a two-stage confirm', async () => {
  const restartCalls = []
  let diagnosticsCalls = 0
  let marketFailed = true
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') {
      diagnosticsCalls += 1
      return {
        ok: true,
        value: {
          status: marketFailed ? 'error' : 'ok',
          checkedAt: Date.now(),
          checks: [
            { id: 'session-storage', status: 'ok', detail: '1' },
            { id: 'plugins', status: marketFailed ? 'error' : 'ok', detail: marketFailed ? '6:1:1:2' : '4:0:0:0' },
          ],
          // 只有异常插件下发：运行中的官方插件与已停用的自定义插件都不在列表里。
          pluginIssues: marketFailed
            ? [
                { entryId: 'include:market', moduleName: 'dshmarket', phase: 'failed', error: 'config invalid' },
                { entryId: 'include:waiting', moduleName: '@scope/pending', phase: 'pending', missingDeps: ['settings', 'llm'] },
                { entryId: 'include:disposed', moduleName: 'pkg-disposed', phase: 'disposed' },
                { entryId: 'include:unknown', moduleName: 'pkg-unknown', phase: 'unknown' },
              ]
            : [],
        },
      }
    }
    if (endpoint === 'plugin-restart') {
      restartCalls.push(payload)
      return { ok: true, value: {} }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  const initialText = renderer.text('settings.section')
  // 检查行内摘要：失败与等待依赖分段显示，停用/正常插件不进统计文案。
  assert.match(initialText, /插件1 个插件失败，1 个插件未就绪/)
  // 异常插件行直接可见（无折叠清单）：失败行带错误与重新加载，等待依赖行带缺失依赖。
  assert.notEqual(renderer.findByTestId('plugin-issue-include:market'), undefined)
  assert.notEqual(renderer.findByTestId('plugin-issue-include:waiting'), undefined)
  assert.match(initialText, /dshmarket.*失败.*错误：config invalid/)
  assert.match(initialText, /@scope\/pending.*等待依赖.*依赖缺失：settings, llm/)
  assert.match(initialText, /pkg-disposed.*已释放/)
  assert.match(initialText, /pkg-unknown.*未知状态/)
  // 运行中的内置插件与已停用插件不渲染任何行。
  assert.equal(renderer.hasTest('plugin-issue-include:llm'), false)
  assert.equal(renderer.findByTestId('plugin-issue-include:disposed').props['data-testid'], 'plugin-issue-include:disposed')
  assert.equal(renderer.findByTestId('plugin-issue-include:unknown').props['data-testid'], 'plugin-issue-include:unknown')
  assert.doesNotMatch(renderer.text('settings.section'), /@deepseek-ai\/dsh-llm/)

  // 两段式：第一次点击只进入确认，不发 RPC；取消可退出。
  await renderer.findByTestId('plugin-restart-include:market').props.onClick()
  await renderer.flush()
  assert.equal(restartCalls.length, 0)
  assert.notEqual(renderer.findByTestId('plugin-restart-confirm-include:market'), undefined)
  assert.match(renderer.text('settings.section'), /重新加载「dshmarket」/)
  await renderer.findButton('取消').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('plugin-restart-confirm-include:market'), false)

  // 确认：发 RPC + 强刷诊断；宿主返回已恢复后异常行消失、摘要回到正常。
  await renderer.findByTestId('plugin-restart-include:market').props.onClick()
  await renderer.flush()
  marketFailed = false
  await renderer.findByTestId('plugin-restart-confirm-include:market').props.onClick()
  await renderer.flush()
  assert.deepEqual(restartCalls, [{ entryId: 'include:market' }])
  assert.equal(diagnosticsCalls, 2, 'successful reload forces a diagnostics refresh')
  assert.equal(renderer.hasTest('plugin-issue-include:market'), false)
  assert.equal(renderer.hasTest('plugin-issue-include:waiting'), false)
  assert.match(renderer.text('settings.section'), /插件共 4 个插件，状态正常/)
})

test('plugin reload surfaces a mapped failure and reopens with a fresh confirm', async () => {
  let diagnosticsCalls = 0
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') {
      diagnosticsCalls += 1
      return {
        ok: true,
        value: {
          status: 'error',
          checkedAt: Date.now(),
          checks: [{ id: 'plugins', status: 'error', detail: '1:1:0' }],
          pluginIssues: [{ entryId: 'broken', moduleName: 'pkg-broken', phase: 'failed', error: 'boom' }],
        },
      }
    }
    if (endpoint === 'plugin-restart') return { ok: false, error: 'unknown-plugin' }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('plugin-restart-broken').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('plugin-restart-confirm-broken').props.onClick()
  await renderer.flush()
  assert.equal(diagnosticsCalls, 1, 'a rejected reload does not force a diagnostics refresh')
  assert.match(renderer.text('settings.section'), /重新加载失败：未找到该插件/)
  // 重试按钮仍可再次打开确认流程，错误在再次点击时清空。
  await renderer.findByTestId('plugin-restart-broken').props.onClick()
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /重新加载失败/)
})

test('plugin check degrades to an informational row when the host has no loader and renders no issue list', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [{ id: 'plugins', status: 'info', detail: 'unavailable' }] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /插件体检不可用（宿主未暴露 Loader）/)
  assert.equal(renderer.hasTest('plugin-issue-list'), false)
})

test('health diagnostics lists plugins that reference alpha-changed interfaces with reasons', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return {
      ok: true,
      value: {
        status: 'warning',
        checkedAt: Date.now(),
        checks: [
          { id: 'session-storage', status: 'ok', detail: '1' },
          { id: 'plugins', status: 'ok', detail: '3:0:0' },
          { id: 'plugin-compat', status: 'warning', detail: '3:2:1:1' },
        ],
        pluginCompat: {
          scanned: 3,
          issues: [
            { moduleName: 'dshmarket', breaks: ['client-runtime', 'chat-hash'] },
            { moduleName: 'dsh-dream-skin', breaks: ['sqlite-persistence'] },
          ],
          declaredOnly: [{ moduleName: 'stale-skin', breaks: ['client-runtime'] }],
          unknown: [{ moduleName: 'huge-pkg', reason: 'too-large' }],
        },
      },
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  const text = renderer.text('settings.section')
  // 检查行内摘要：broken / declaredOnly / unknown 分段
  assert.match(text, /插件兼容性2 个插件可能不兼容，1 个插件仅声明残留（代码未引用），1 个插件未能扫描/)
  // 命中行：一个插件一行（同一档内的多个命中并排一行）；名称 + 每条破坏面说明
  assert.equal(renderer.findAllByTestIdPrefix('plugin-compat-row-').length, 4)
  assert.notEqual(renderer.findByTestId('plugin-compat-row-0'), undefined)
  assert.equal(renderer.findByTestId('plugin-compat-kind-0-0').children[0], '可能不兼容')
  assert.match(text, /dshmarket.*声明了已移除的客户端供应商.*引用已迁移的聊天界面旧样式前缀/)
  assert.match(text, /dsh-dream-skin.*依赖已移除的会话持久化后端/)
  // 仅声明残留行：info 提示（代码未引用、无害）
  assert.notEqual(renderer.findByTestId('plugin-compat-row-2'), undefined)
  assert.equal(renderer.findByTestId('plugin-compat-kind-2-0').children[0], '声明残留')
  assert.match(text, /stale-skin.*声明了已移除的接口但代码未引用.*静默跳过/)
  // unknown 行：名称 + 原因
  assert.notEqual(renderer.findByTestId('plugin-compat-row-3'), undefined)
  assert.equal(renderer.findByTestId('plugin-compat-kind-3-0').children[0], '未能扫描')
  assert.match(text, /huge-pkg.*入口文件超过扫描上限/)
  // 不渲染运行状态 issues 行
  assert.equal(renderer.hasTest('plugin-issue-include:market'), false)
})

test('plugin compatibility merges different findings of the same plugin into a single row', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return {
      ok: true,
      value: {
        status: 'info',
        checkedAt: Date.now(),
        checks: [{ id: 'plugin-compat', status: 'info', detail: '4:1:1:0:1' }],
        pluginCompat: {
          scanned: 4,
          issues: [{ moduleName: 'dshmarket', breaks: ['chat-hash'] }],
          soft: [{ moduleName: 'dshmarket', breaks: ['settings-plugin-item'] }],
          declaredOnly: [{ moduleName: 'dshmarket', breaks: ['client-runtime'] }],
          unknown: [],
        },
      },
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  // 三档命中（可能不兼容/退役接口/声明残留）收敛成一行，插件名只出现一次
  const rows = renderer.findAllByTestIdPrefix('plugin-compat-row-')
  assert.equal(rows.length, 1)
  const sectionText = renderer.text('settings.section')
  assert.equal(sectionText.match(/dshmarket/g).length, 1)
  // 分档标签独立成行排在插件名下方：颜色随档位（可能不兼容=警示黄，其余=信息蓝）
  assert.equal(renderer.findByTestId('plugin-compat-kind-0-0').children[0], '可能不兼容')
  assert.equal(renderer.findByTestId('plugin-compat-kind-0-0').props.style.color, 'var(--dsh-svc-warning)')
  assert.equal(renderer.findByTestId('plugin-compat-kind-0-1').children[0], '为兼容旧版保留')
  assert.equal(renderer.findByTestId('plugin-compat-kind-0-1').props.style.color, 'var(--dsh-svc-info)')
  assert.equal(renderer.findByTestId('plugin-compat-kind-0-2').children[0], '声明残留')
  assert.equal(renderer.findByTestId('plugin-compat-kind-0-2').props.style.color, 'var(--dsh-svc-info)')
  // 正文段落跟在自己标签下方：三档各一段
  assert.equal(renderer.findAllByTestIdPrefix('plugin-compat-line-0-').length, 3)
  assert.match(renderer.findByTestId('plugin-compat-line-0-0').children[0], /引用已迁移的聊天界面旧样式前缀/)
  assert.match(renderer.findByTestId('plugin-compat-line-0-1').children[0], /为兼容老版本宿主保留了已退役的设置页槽位/)
  assert.match(renderer.findByTestId('plugin-compat-line-0-2').children[0], /声明了已移除的接口但代码未引用/)
})

test('plugin compatibility check shows a clean summary and no list when nothing references changed interfaces', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return {
      ok: true,
      value: {
        status: 'ok',
        checkedAt: Date.now(),
        checks: [{ id: 'plugin-compat', status: 'ok', detail: '4:0:0:0' }],
        pluginCompat: { scanned: 4, issues: [], unknown: [] },
      },
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /插件兼容性已扫描 4 个插件，未发现对已变更接口的引用/)
  assert.equal(renderer.hasTest('plugin-compat-list'), false)
})

test('plugin compatibility check degrades to an informational row when the host has no loader', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'not relevant' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [{ id: 'plugin-compat', status: 'info', detail: 'unavailable' }] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /插件兼容性检查不可用（宿主未暴露 Loader）/)
  assert.equal(renderer.hasTest('plugin-compat-list'), false)
})

test('permission panel stays hidden when the host reports a non-Linux platform', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  assert.doesNotMatch(renderer.text('settings.section'), /文件权限|File permissions/)
})

test('backup panel creates, lists, and requires a second click before deleting a host-listed backup', async () => {
  const calls = []
  const first = {
    id: 'signed-backup-1',
    name: 'dsh-backup-20250819-120000.tar.gz',
    sizeBytes: 1536,
    createdAt: '2025-08-19T12:00:00.000Z',
  }
  const second = {
    id: 'signed-backup-2',
    name: 'dsh-backup-20250819-130000.tar.gz',
    sizeBytes: 2048,
    createdAt: '2025-08-19T13:00:00.000Z',
  }
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    calls.push({ endpoint, payload })
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [first], totalBytes: first.sizeBytes } }
    if (endpoint === 'backup-progress') return { ok: true, value: { active: false } }
    if (endpoint === 'backup-create') return { ok: true, value: { item: second, items: [second, first], totalBytes: 3584 } }
    if (endpoint === 'backup-delete') {
      assert.deepEqual(payload, { id: first.id })
      return { ok: true, value: { items: [second], totalBytes: second.sizeBytes } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /备份管理/)
  assert.match(renderer.text('settings.section'), /总体积：1\.5 KB/)
  assert.match(renderer.text('settings.section'), /dsh-backup-20250819-120000\.tar\.gz/)
  assert.doesNotMatch(renderer.text('settings.section'), /展开备份记录/)

  await renderer.findButton('创建备份').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /dsh-backup-20250819-130000\.tar\.gz/)
  assert.match(renderer.text('settings.section'), /总体积：3\.5 KB/)

  await renderer.findButton('删除').props.onClick()
  await renderer.flush()
  assert.equal(calls.filter((call) => call.endpoint === 'backup-delete').length, 0)
  assert.match(renderer.text('settings.section'), /确认删除这个备份/)

  await renderer.findButton('确认删除').props.onClick()
  await renderer.flush()
  assert.equal(calls.filter((call) => call.endpoint === 'backup-delete').length, 1)
  assert.doesNotMatch(renderer.text('settings.section'), /dsh-backup-20250819-120000\.tar\.gz/)
  assert.match(renderer.text('settings.section'), /总体积：2 KB/)
})

test('backup panel shows live progress during creation and clears it when the host finishes', async () => {
  const first = { id: 'signed-backup-1', name: 'dsh-backup-20250819-120000.tar.gz', sizeBytes: 1536, createdAt: '2025-08-19T12:00:00.000Z' }
  const second = { id: 'signed-backup-2', name: 'dsh-backup-20250819-130000.tar.gz', sizeBytes: 2048, createdAt: '2025-08-19T13:00:00.000Z' }
  let releaseCreate
  const createGate = new Promise((resolve) => { releaseCreate = resolve })
  let progressActive = true
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [first], totalBytes: first.sizeBytes } }
    if (endpoint === 'backup-progress') {
      return { ok: true, value: progressActive ? { active: true, phase: 'copy', copiedBytes: 512, totalBytes: 2048, archiveBytes: 0 } : { active: false } }
    }
    if (endpoint === 'backup-create') {
      await createGate
      return { ok: true, value: { item: second, items: [second, first], totalBytes: 3584 } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()

  const click = renderer.findButton('创建备份').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /正在复制会话数据/)
  assert.match(renderer.text('settings.section'), /（1\/4）/)
  assert.match(renderer.text('settings.section'), /512 B \/ 2 KB/)
  assert.ok(renderer.pendingTimerDelays().includes(400), 'progress polling chains a 400ms timer')

  progressActive = false
  releaseCreate()
  await click
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /正在复制会话数据/)
  assert.match(renderer.text('settings.section'), /dsh-backup-20250819-130000\.tar\.gz/)
  assert.equal(renderer.pendingTimerDelays().includes(400), false, 'progress polling stops after completion')
})

test('backup progress bar never regresses when a later snapshot reports a lower percent (monotonic guard)', async () => {
  const first = { id: 'signed-backup-1', name: 'dsh-backup-20250819-120000.tar.gz', sizeBytes: 1536, createdAt: '2025-08-19T12:00:00.000Z' }
  const second = { id: 'signed-backup-2', name: 'dsh-backup-20250819-130000.tar.gz', sizeBytes: 2048, createdAt: '2025-08-19T13:00:00.000Z' }
  let releaseCreate
  const createGate = new Promise((resolve) => { releaseCreate = resolve })
  // 队列：复制完成 30% →（模拟重试）复制从 0 重跑 → 结束。
  const snapshots = [
    { active: true, phase: 'copy', copiedBytes: 2048, totalBytes: 2048, archiveBytes: 0 },
    { active: true, phase: 'copy', copiedBytes: 0, totalBytes: 2048, archiveBytes: 0 },
    { active: false },
  ]
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [first], totalBytes: first.sizeBytes } }
    if (endpoint === 'backup-progress') return { ok: true, value: snapshots.length > 0 ? snapshots.shift() : { active: false } }
    if (endpoint === 'backup-create') {
      await createGate
      return { ok: true, value: { item: second, items: [second, first], totalBytes: 3584 } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()

  const click = renderer.findButton('创建备份').props.onClick()
  await renderer.flush()
  const fillWidth = () => {
    const node = renderer.findByTestId('backup-progress')
    return node.children[1].children[0].props.style.width
  }
  assert.equal(fillWidth(), '30%', 'copy completed within its weight band')
  // 第二次快照（疑似重试）原始百分比为 0——单调守卫让条幅保持 30% 不回退。
  await renderer.advanceTimer(400)
  assert.equal(fillWidth(), '30%', 'percent never regresses')
  assert.match(renderer.text('settings.section'), /正在复制会话数据/)

  releaseCreate()
  await click
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /正在复制会话数据/)
  assert.equal(renderer.pendingTimerDelays().includes(400), false)
})

test('backup restore inspects, prepares, renders consequences, and commits only the host plan id', async () => {
  const calls = []
  const item = { id: 'signed-backup-1', name: 'dsh-backup-20250819-120000.tar.gz', sizeBytes: 1536, createdAt: '2025-08-19T12:00:00.000Z' }
  const report = {
    validForRestore: true,
    status: 'ok',
    archive: { entryCount: 12, logicalBytes: 4096 },
    sections: { sessions: { files: 3, dirs: 2, bytes: 2048 }, config: { files: [{ name: 'settings.yaml' }] }, profiles: { count: 1 } },
    issues: [],
  }
  const plan = {
    planId: 'restore-plan-1',
    expiresAt: Date.now() + 300000,
    targets: { sessions: { action: 'replace' }, config: { replace: ['settings.yaml'], remove: ['AGENTS.md'] }, profiles: { upsert: ['web'], untouched: true } },
  }
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    calls.push({ endpoint, payload })
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [item], totalBytes: item.sizeBytes } }
    if (endpoint === 'backup-inspect') { assert.deepEqual(payload, { id: item.id }); return { ok: true, value: report } }
    if (endpoint === 'backup-restore-prepare') { assert.deepEqual(payload, { id: item.id }); return { ok: true, value: plan } }
    if (endpoint === 'backup-restore-commit') { assert.deepEqual(payload, { planId: plan.planId }); return { ok: true, value: { restoredFrom: item.name, restart: { scheduled: true, previousInstanceId: 'old-instance' } } } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('恢复').props.onClick()
  await renderer.flush()

  assert.deepEqual(calls.filter((call) => call.endpoint.startsWith('backup-restore') || call.endpoint === 'backup-inspect').map((call) => call.endpoint), ['backup-inspect', 'backup-restore-prepare'])
  assert.doesNotMatch(calls.map((call) => call.endpoint).join(','), /backup-restore,/)
  const text = renderer.text('settings.section')
  assert.match(text, /完整性检查通过/)
  assert.match(text, /共 12 个条目，解压后 4 KB/)
  assert.match(text, /会话目录将整体替换/)
  assert.match(text, /配置覆盖 1 项，移除 1 项/)
  assert.match(text, /覆盖 1 个 profile/)

  await renderer.findButton('确认恢复').props.onClick()
  await renderer.flush()
  assert.equal(calls.filter((call) => call.endpoint === 'backup-restore-commit').length, 1)
  assert.deepEqual(renderer.pendingTimerDelays().filter((delay) => delay !== 5000), [1000])
})

test('backup restore blocks confirmation for an invalid integrity report', async () => {
  const item = { id: 'signed-backup-1', name: 'dsh-backup-20250819-120000.tar.gz', sizeBytes: 1536, createdAt: '2025-08-19T12:00:00.000Z' }
  const calls = []
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [item], totalBytes: item.sizeBytes } }
    if (endpoint === 'backup-inspect') return { ok: true, value: { validForRestore: false, status: 'error', archive: { entryCount: 1, logicalBytes: 0 }, sections: { sessions: { files: 0 }, config: { files: [] }, profiles: { count: 0 } }, issues: [{ code: 'backup-entry-traversal' }] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('恢复').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /归档不可恢复.*归档含越界或不安全路径/)
  assert.equal(calls.some((call) => call.endpoint === 'backup-restore-prepare'), false)
  assert.throws(() => renderer.findButton('确认恢复'))
})

test('backup restore manual result shows restart instructions without starting recovery polling', async () => {
  const item = { id: 'signed-backup-1', name: 'dsh-backup-20250819-120000.tar.gz', sizeBytes: 1536, createdAt: '2025-08-19T12:00:00.000Z' }
  let versionCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') { versionCalls += 1; return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } } }
    if (endpoint === 'health') return { ok: false, error: 'not relevant' }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [item], totalBytes: item.sizeBytes } }
    if (endpoint === 'backup-inspect') return { ok: true, value: { validForRestore: true, archive: { entryCount: 3, logicalBytes: 10 }, sections: { sessions: { files: 1 }, config: { files: [] }, profiles: { count: 0 } }, issues: [] } }
    if (endpoint === 'backup-restore-prepare') return { ok: true, value: { planId: 'manual-plan', expiresAt: Date.now() + 300000, targets: { config: { replace: [], remove: [] }, profiles: { upsert: [] } } } }
    if (endpoint === 'backup-restore-commit') return { ok: true, value: { restart: { scheduled: false, requiresManualRestart: true, previousInstanceId: 'old-instance' } } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('恢复').props.onClick()
  await renderer.flush()
  await renderer.findButton('确认恢复').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /恢复完成，需要手动重启.*Ctrl\+C/)
  assert.equal(versionCalls, 1)
  assert.deepEqual(renderer.pendingTimerDelays().filter((delay) => delay !== 5000), [], 'recovery polling did not start')
})

test('service panel lists active work and requires an explicit force restart', async () => {
  const calls = []
  const activity = {
    hasActive: true,
    items: [
      { type: 'agent', id: 'agent-1', label: 'agent-1', status: 'running' },
      { type: 'job', id: 'bash-1', label: 'pnpm test', status: 'running', ownerSession: 'agent-1' },
      { type: 'terminal', id: 'terminal-1', label: 'dev shell', status: 'running', ownerSession: 'agent-1' },
    ],
  }
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    calls.push({ channel, endpoint, payload })
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'activity') return { ok: true, value: activity }
    if (endpoint === 'web') return { ok: true, value: { message: 'restart scheduled', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()

  // v0.39 按钮语义：最终确认（仍要重启）= 危险实底；取消 = 幽灵描边。
  // v0.42.2 深色修复：实底按钮文字走 --dsh-svc-brand-text（浅=白、深=近黑），不再写死 #fff。
  const forceConfirm = renderer.findButton('仍要重启')
  assert.equal(forceConfirm.props['data-variant'], 'danger')
  assert.equal(forceConfirm.props.style.background, 'var(--dsh-svc-danger)')
  assert.equal(forceConfirm.props.style.color, 'var(--dsh-svc-brand-text)')

  assert.match(renderer.text(), /检测到 3 项运行中的工作/)
  assert.match(renderer.text(), /pnpm test/)
  assert.match(renderer.text(), /dev shell/)
  assert.equal(calls.some((call) => call.endpoint === 'web'), false)

  await renderer.findButton('取消').props.onClick()
  await renderer.flush()
  assert.doesNotMatch(renderer.text(), /检测到 3 项运行中的工作/)
  assert.equal(calls.some((call) => call.endpoint === 'web'), false)

  // 回到初次出现态：重启入口恢复危险描边（dangerGhost），不是实底。
  const initialRestart = renderer.findButton('重启 dsh web')
  assert.equal(initialRestart.props['data-variant'], 'dangerGhost')
  assert.equal(initialRestart.props.style.background, 'transparent')
  assert.equal(initialRestart.props.style.color, 'var(--dsh-svc-danger)')

  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  await renderer.findButton('仍要重启').props.onClick()
  await renderer.flush()

  assert.deepEqual(calls.find((call) => call.endpoint === 'web'), {
    channel: '/dsh-service',
    endpoint: 'web',
    payload: { force: true },
  })
  assert.match(renderer.text(), /重启指令已发出/)
})

test('settings left nav restart entry is opt-in, defaults to hidden, and persists the toggle', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  // 默认关闭：只注册服务控制一页
  assert.deepEqual(renderer.registrations()['settings.section'].map((s) => s.id), ['dsh-service'])
  assert.equal(localStorage.getItem('dsh-service-shortcut-restart'), null)

  // 「重启」标签内打开开关后条目注册，位于「服务控制」之下
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  renderer.findByTestId('restart-nav-switch').props.onClick()
  await renderer.flush()
  const sections = renderer.registrations()['settings.section']
  assert.deepEqual(sections.map((s) => s.id), ['dsh-service', 'dsh-service-restart'])
  assert.ok(sections[1].order > sections[0].order, 'restart entry sits below the service control page in the left nav')
  assert.equal(sections[1].label(), '重启')
  assert.equal(localStorage.getItem('dsh-service-shortcut-restart'), 'true')
  renderer.setLocale('en')
  await renderer.flush()
  assert.equal(sections[1].label(), 'Restart')
  renderer.setLocale('zh')
  await renderer.flush()

  // 关闭后条目移除并持久化
  renderer.findByTestId('restart-nav-switch').props.onClick()
  await renderer.flush()
  assert.deepEqual(renderer.registrations()['settings.section'].map((s) => s.id), ['dsh-service'])
  assert.equal(localStorage.getItem('dsh-service-shortcut-restart'), 'false')
})

test('left-nav shortcut keys migrate once to the shortcut-* namespace', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  // 旧键遗留值：迁移只发生一次——首次读取即写入新键，此后只认新键。
  localStorage.setItem('dsh-service-restart-nav', 'true')
  localStorage.setItem('dsh-service-quota-nav', 'false')
  await renderer.load()
  assert.equal(localStorage.getItem('dsh-service-shortcut-restart'), 'true', 'legacy restart value migrates to the new key')
  assert.equal(localStorage.getItem('dsh-service-shortcut-quota'), 'false', 'legacy quota value migrates to the new key')
  // 重启入口按迁移值注册；额度查询保持关闭；skills/subagent 入口已撤销不再可注册。
  const sections = renderer.registrations()['settings.section']
  assert.deepEqual(sections.map((s) => s.id), ['dsh-service', 'dsh-service-restart'])
  // 旧键值不再被读取：改写旧键不影响已迁移状态（新键已是唯一事实源）。
  localStorage.setItem('dsh-service-restart-nav', 'false')
  await renderer.load()
  assert.deepEqual(renderer.registrations()['settings.section'].map((s) => s.id), ['dsh-service', 'dsh-service-restart'])
})

test('dedicated restart page runs the same activity check, force, and sent flow as the restart tab', async () => {
  const calls = []
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    calls.push({ endpoint, payload })
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: true, items: [{ type: 'job', id: 'bash-1', label: 'pnpm test', status: 'running' }] } }
    if (endpoint === 'web') return { ok: true, value: { message: 'restart scheduled', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  // 默认关闭：先在「重启」标签打开左列入口开关
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  renderer.findByTestId('restart-nav-switch').props.onClick()
  await renderer.flush()
  assert.deepEqual(renderer.registrations()['settings.section'].map((s) => s.id), ['dsh-service', 'dsh-service-restart'])
  // 专属入口的按钮在「服务控制」之后渲染，点它即走共享流程
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  assert.deepEqual(calls.find((call) => call.endpoint === 'activity').payload, {})
  assert.match(renderer.text('settings.section'), /检测到 1 项运行中的工作/)
  assert.equal(calls.some((call) => call.endpoint === 'web'), false)

  await renderer.findButton('取消').props.onClick()
  await renderer.flush()
  assert.doesNotMatch(renderer.text('settings.section'), /检测到 1 项运行中的工作/)

  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  await renderer.findButton('仍要重启').props.onClick()
  await renderer.flush()
  assert.deepEqual(calls.find((call) => call.endpoint === 'web').payload, { force: true })
  assert.match(renderer.text('settings.section'), /重启指令已发出/)
})

test('restart recovery overlay ignores the old instance and reloads for a new instance', async () => {
  let versionCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') {
      versionCalls += 1
      if (versionCalls <= 2) return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
      if (versionCalls === 3) throw new Error('connection refused')
      return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'new-instance' } }
    }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: false, items: [] } }
    if (endpoint === 'web') return { ok: true, value: { message: 'restart scheduled', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  assert.equal(renderer.hasSlot('shell.overlay'), true)
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  await renderer.findButton('确认重启').props.onClick()
  await renderer.flush()

  assert.match(renderer.text('shell.overlay'), /服务重启中/)
  assert.ok(renderer.pendingTimerDelays().includes(1000))

  await renderer.advanceTimer(1000)
  assert.equal(renderer.reloadCount(), 0)
  assert.ok(renderer.pendingTimerDelays().includes(2000))

  await renderer.advanceTimer(2000)
  assert.equal(renderer.reloadCount(), 0)
  assert.ok(renderer.pendingTimerDelays().includes(4000))

  await renderer.advanceTimer(4000)
  assert.equal(renderer.reloadCount(), 1)
})

test('runtime locale switch updates the settings panel, activity warning, and restart overlay', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'activity') return {
      ok: true,
      value: {
        hasActive: true,
        items: [{ type: 'job', id: 'bash-1', label: 'pnpm test', status: 'running' }],
      },
    }
    if (endpoint === 'web') return { ok: true, value: { message: 'restart scheduled', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  assert.match(renderer.text('settings.section'), /版本信息/)
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /检测到 1 项运行中的工作/)

  renderer.setLocale('en')
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /Service restart/)
  assert.match(renderer.text('settings.section'), /Detected 1 active item/)
  assert.doesNotMatch(renderer.text('settings.section'), /版本信息|检测到/)

  await renderer.findButton('Force restart').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('shell.overlay'), /Restarting service/)
  assert.doesNotMatch(renderer.text('shell.overlay'), /服务重启中/)
})

test('restart recovery offers manual reload after sixty seconds', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: false, items: [] } }
    if (endpoint === 'web') return { ok: true, value: { message: 'restart scheduled', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  await renderer.findButton('确认重启').props.onClick()
  await renderer.flush()
  renderer.unmount('settings.section')

  let elapsed = 0
  while (!renderer.text('shell.overlay').includes('服务尚未恢复')) {
    elapsed += await renderer.advanceTimer()
    assert.ok(elapsed <= 60000)
  }

  assert.equal(elapsed, 60000)
  assert.equal(renderer.reloadCount(), 0)
  await renderer.findButton('手动刷新').props.onClick()
  assert.equal(renderer.reloadCount(), 1)
})

test('host-side /restart reloads the page on the next connection generation without the settings panel', async () => {
  // 场景：在对话里用 /restart（宿主命令，commands.register → exit(42)），
  // 进程被管理器拉起后页面不自动刷新。原因 = 该路径不经过客户端「重启」按钮，
  // 没有 previousInstanceId，客户端从未比对 instanceId，也就没人发起刷新。
  // 判据与按钮路径一致：只有 instanceId 变化才算「新进程已起」。
  let versionCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') {
      versionCalls += 1
      // 首个世代 = 老进程（基线）；老进程退出前的一次重连仍是同一 id；新世代 = 新进程。
      return { ok: true, value: { current: '0.1.0-rc.7', instanceId: versionCalls <= 2 ? 'old-instance' : 'new-instance' } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  assert.equal(renderer.reloadCount(), 0)

  // 老进程退出前的一次重连：instanceId 未变，绝不刷新。
  renderer.emitConnectionReset()
  await renderer.flush()
  assert.equal(renderer.reloadCount(), 0, 'a reconnect to the same process must not reload')

  // 新进程上线：connection 起新世代 → 判定新进程 → 刷新。
  renderer.emitConnectionReset()
  await renderer.flush()
  assert.equal(renderer.reloadCount(), 1, 'a new process instance must reload the page')
})

test('notification switches render four independent toggles (incl. bell visibility) and persist each choice', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  await renderer.load()
  // 通知区块已从概览拆出：概览标签无开关，「通知」标签内才有
  assert.equal(renderer.findSwitches().length, 0)
  assert.doesNotMatch(renderer.text('settings.section'), /任务通知/)
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /主会话任务结束，或会话需要授权、抉择时发送浏览器通知；子代理完成任务不通知。/)
  assert.doesNotMatch(renderer.text('settings.section'), /关闭时下面两个开关暂停生效|页面刷新后保持|会话完成一轮任务时提醒|需要授权、审阅计划或选择答案时提醒/)
  const notifyRows = renderer.findAllByTestIdPrefix('notify-row-')
  assert.equal(notifyRows.length, 4)
  assert.deepEqual(notifyRows.map((row) => row.props.style.padding), ['5px 0', '5px 0', '5px 0', '5px 0'], 'rows keep their vertical spacing without hints')
  let switches = renderer.findSwitches()
  assert.equal(switches.length, 4, 'master + done + input + bell-visibility switches')
  assert.deepEqual(switches.map((node) => node.props['aria-checked']), ['false', 'true', 'true', 'true'])
  assert.equal(switches[1].props.onClick, undefined, 'sub switches are paused while master is off')
  // 铃铛显隐独立于总开关：总开关关闭时仍可隐藏/恢复输入框旁的快捷入口。
  assert.equal(typeof switches[3].props.onClick, 'function')

  switches[0].props.onClick()
  await renderer.flush()
  switches = renderer.findSwitches()
  assert.deepEqual(switches.map((node) => node.props['aria-checked']), ['true', 'true', 'true', 'true'])
  assert.equal(typeof switches[1].props.onClick, 'function')

  switches[2].props.onClick()
  await renderer.flush()
  switches = renderer.findSwitches()
  assert.deepEqual(switches.map((node) => node.props['aria-checked']), ['true', 'true', 'false', 'true'])
  assert.equal(localStorage.getItem('dsh-service-notify'), 'true')
  assert.equal(localStorage.getItem('dsh-service-notify-done'), null)
  assert.equal(localStorage.getItem('dsh-service-notify-input'), 'false')
  assert.equal(localStorage.getItem('dsh-service-notify-bell'), null)

  // 关掉铃铛显隐 → conversation.input.left 条目即时注销、选择持久化；再开回来条目恢复。
  // 注意 hasSlot 首次注册后恒真，条目在否要看 registrations 的存活清单。
  const bellEntries = () => (renderer.registrations()['conversation.input.left'] ?? []).filter((entry) => entry.id === 'dsh-service-notify')
  assert.equal(bellEntries().length, 1)
  switches[3].props.onClick()
  await renderer.flush()
  assert.equal(localStorage.getItem('dsh-service-notify-bell'), 'false')
  assert.equal(bellEntries().length, 0)
  renderer.findSwitches()[3].props.onClick()
  await renderer.flush()
  assert.equal(localStorage.getItem('dsh-service-notify-bell'), 'true')
  assert.equal(bellEntries().length, 1)
})

test('bell visibility stays hidden on reload after a persisted off choice', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  // createRenderer 之后、load 之前播种持久化选择（模拟上次会话把铃铛藏了）。
  globalThis.localStorage.setItem('dsh-service-notify-bell', 'false')
  await renderer.load()
  assert.equal((renderer.registrations()['conversation.input.left'] ?? []).some((entry) => entry.id === 'dsh-service-notify'), false, 'persisted bell-off hides the composer entry immediately')
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  const switches = renderer.findSwitches()
  assert.deepEqual(switches.map((node) => node.props['aria-checked']), ['false', 'true', 'true', 'false'])
})

test('clicking a browser notification focuses the dsh page and closes the popup', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  await renderer.load()
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  renderer.findSwitches()[0].props.onClick()
  await renderer.flush()

  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true } })
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: false } })
  const instances = renderer.notificationInstances()
  assert.equal(instances.length, 1)
  assert.equal(renderer.focusCount(), 0)
  instances[0].onclick()
  assert.equal(renderer.focusCount(), 1, 'notification click focuses the dsh page')
})

test('session edges notify for task completion and pending interaction with kind labels', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  await renderer.load()
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  renderer.findSwitches()[0].props.onClick()
  await renderer.flush()

  renderer.setSessions({ 's1': { id: 's1', displayTitle: '重构面板', running: true } })
  assert.deepEqual(renderer.notifications(), [], 'baseline snapshot rings nothing')

  renderer.setSessions({ 's1': { id: 's1', displayTitle: '重构面板', running: false } })
  assert.deepEqual(renderer.notifications(), [
    { title: '任务完成', body: '重构面板 已完成本轮任务' },
  ])

  // 待审状态按真实拓扑走 sessionStatus 快照（list 行永远没有 pendingInteraction 字段）
  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: { kind: 'question', key: 'q1', sessionId: 's1' } }]])
  assert.deepEqual(renderer.notifications().slice(1), [
    { title: '需要你的确认', body: '重构面板（等待选择答案）' },
  ])

  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: undefined }]])
  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: { kind: 'approval', key: 'a1', sessionId: 's1' } }]])
  assert.deepEqual(renderer.notifications().slice(2), [
    { title: '需要你的确认', body: '重构面板（等待授权）' },
  ])

  // 回归钉：list 行上残留 pendingInteraction（旧测试的假形状）不得驱动任何通知
  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: undefined }]])
  renderer.setSessions({ 's1': { id: 's1', displayTitle: '重构面板', running: false, pendingInteraction: 'approval' } })
  assert.equal(renderer.notifications().length, 3, 'pendingInteraction on list rows must never ring')
})

test('subagent completion stays silent while root completion and subagent interactions notify', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  await renderer.load()
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  renderer.findSwitches()[0].props.onClick()
  await renderer.flush()

  renderer.setSessions({
    root: { id: 'root', displayTitle: '主会话', running: true },
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: true },
  })
  assert.deepEqual(renderer.notifications(), [], 'baseline snapshot rings nothing')

  renderer.setSessions({
    root: { id: 'root', displayTitle: '主会话', running: false },
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: false },
  })
  assert.deepEqual(renderer.notifications(), [
    { title: '任务完成', body: '主会话 已完成本轮任务' },
  ], 'root completion notifies but subagent completion stays silent')

  renderer.setSessions({
    root: { id: 'root', displayTitle: '主会话', running: false },
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: false },
  })
  renderer.setSessionStatus([
    ['child', { running: false, pendingInteraction: { kind: 'approval', key: 'a1', sessionId: 'child' } }],
  ])
  renderer.setSessionStatus([
    ['child', { running: false, pendingInteraction: undefined }],
  ])
  renderer.setSessionStatus([
    ['child', { running: false, pendingInteraction: { kind: 'plan-review', key: 'p1', sessionId: 'child' } }],
  ])
  renderer.setSessionStatus([
    ['child', { running: false, pendingInteraction: undefined }],
  ])
  renderer.setSessionStatus([
    ['child', { running: false, pendingInteraction: { kind: 'question', key: 'q1', sessionId: 'child' } }],
  ])
  assert.deepEqual(renderer.notifications().slice(1), [
    { title: '需要你的确认', body: '子代理（等待授权）' },
    { title: '需要你的确认', body: '子代理（等待审阅计划）' },
    { title: '需要你的确认', body: '子代理（等待选择答案）' },
  ], 'subagent approval, plan review, and question notifications remain enabled')
})

test('notification kinds are gated by the master and per-kind switches', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  await renderer.load()
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  const master = () => renderer.findSwitches()[0]
  master().props.onClick()
  await renderer.flush()
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true } })

  master().props.onClick()
  await renderer.flush()
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: false } })
  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: { kind: 'approval', key: 'a0', sessionId: 's1' } }]])
  assert.deepEqual(renderer.notifications(), [], 'master off gates both kinds')

  master().props.onClick()
  await renderer.flush()
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true } })
  renderer.setSessionStatus([['s1', { running: true, pendingInteraction: undefined }]])
  renderer.setSessionStatus([['s1', { running: true, pendingInteraction: { kind: 'plan-review', key: 'p0', sessionId: 's1' } }]])
  assert.deepEqual(renderer.notifications(), [
    { title: '需要你的确认', body: 'A（等待审阅计划）' },
  ], 'master back on lets the input edge ring with the plan-review label')

  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true } })
  const doneSwitch = () => renderer.findSwitches()[1]
  doneSwitch().props.onClick()
  await renderer.flush()
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: false } })
  assert.equal(renderer.notifications().length, 1, 'done toggle off suppresses completion')
})

test('connection reset rebuilds the baseline so replayed frames ring nothing', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  await renderer.load()
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  renderer.findSwitches()[0].props.onClick()
  await renderer.flush()

  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true } })
  renderer.emitConnectionReset()
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: false } })
  assert.deepEqual(renderer.notifications(), [], 'first snapshot after reset only rebuilds the baseline')

  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true } })
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: false } })
  assert.equal(renderer.notifications().length, 1, 'edges after re-baseline ring again')

  // 状态源基线同样随连接重置重建：重置后首个快照只记录，不响铃
  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: { kind: 'approval', key: 'a2', sessionId: 's1' } }]])
  assert.equal(renderer.notifications().length, 2, 'pending edge rings before reset bookkeeping')

  renderer.emitConnectionReset()
  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: { kind: 'approval', key: 'a3', sessionId: 's1' } }]])
  assert.equal(renderer.notifications().length, 2, 'first status snapshot after reset only rebuilds the baseline')

  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: undefined }]])
  renderer.setSessionStatus([['s1', { running: false, pendingInteraction: { kind: 'approval', key: 'a4', sessionId: 's1' } }]])
  assert.equal(renderer.notifications().length, 3, 'pending edges after status re-baseline ring again')
})

test('legacy runtime without uiSession keeps completion notifications and stays silent on interaction', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted', legacyRuntime: true })

  await renderer.load()
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  renderer.findSwitches()[0].props.onClick()
  await renderer.flush()
  renderer.setSessions({ 's1': { id: 's1', displayTitle: '旧运行时', running: true } })
  renderer.setSessions({ 's1': { id: 's1', displayTitle: '旧运行时', running: false } })
  assert.deepEqual(renderer.notifications(), [
    { title: '任务完成', body: '旧运行时 已完成本轮任务' },
  ], 'completion path works without the status service')
})

test('upgrade failure surfaces the host error detail instead of only the generic message', async () => {
  let upgradeCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: {
      dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', tags: { latest: '0.1.0-rc.7', next: null }, upToDate: true, status: 'available', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
      plugin: { current: '0.9.0', latest: '0.10.0', tags: { latest: '0.10.0', next: null }, upToDate: false, status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' },
    } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'upgrade') {
      upgradeCalls += 1
      return { ok: false, error: 'npm-failed: spawn EINVAL' }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('升级插件').props.onClick()
  await renderer.flush()
  assert.equal(upgradeCalls, 1)
  assert.match(renderer.text('settings.section'), /插件升级失败（npm-failed: spawn EINVAL）/)
  assert.doesNotMatch(renderer.text('settings.section'), /升级中/)
})

test('upgrade failure with a known guard code renders the localized message', async () => {
  let upgradeCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: true, value: {
      dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', tags: { latest: '0.1.0-rc.7', next: null }, upToDate: true, status: 'available', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
      plugin: { current: '0.9.0', latest: '0.10.0', tags: { latest: '0.10.0', next: null }, upToDate: false, status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' },
    } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'upgrade') {
      upgradeCalls += 1
      return { ok: false, error: 'link-install' }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('升级插件').props.onClick()
  await renderer.flush()
  assert.equal(upgradeCalls, 1)
  assert.match(renderer.text('settings.section'), /开发模式/)
  assert.doesNotMatch(renderer.text('settings.section'), /插件升级失败（/)
  assert.doesNotMatch(renderer.text('settings.section'), /升级中/)
})

// ---- 运行环境检测与手动启动提示（v0.16）----

function stubPanelRpc(extra = {}) {
  return async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') {
      return { ok: true, value: Object.assign({ current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance' }, extra.version || {}) }
    }
    if (endpoint === 'check-update') return { ok: true, value: {
      dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', tags: { latest: '0.1.0-rc.7', next: null }, upToDate: true, status: 'available', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
      plugin: { current: '0.9.0', latest: '0.10.0', tags: { latest: '0.10.0', next: null }, upToDate: false, status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' },
    } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: false, items: [] } }
    if (extra.endpoints && extra.endpoints[endpoint] !== undefined) return extra.endpoints[endpoint]()
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
}

test('manual-launch environment confirms before upgrade and shows hand-restart guidance without recovery polling', async () => {
  let upgradeCalls = 0
  let webRestarts = 0
  const renderer = createRenderer(stubPanelRpc({
    version: { runtimeEnv: { platform: 'win32', supervisorKind: null, manualStartLikely: true } },
    endpoints: {
      upgrade: () => {
        upgradeCalls += 1
        return { ok: true, value: { result: 'upgraded', profile: 'web', previous: '0.9.0', installed: '0.10.0', requiresManualRestart: true } }
      },
      web: () => {
        webRestarts += 1
        return { ok: true, value: { message: 'exiting', instanceId: 'old-instance' } }
      },
    },
  }))

  await renderer.load()
  // 版本卡不再显示运行环境行（用户复核口径）；升级前仍需确认后果。
  assert.doesNotMatch(renderer.text('settings.section'), /运行环境：/)
  await renderer.findButton('升级插件').props.onClick()
  await renderer.flush()
  assert.equal(upgradeCalls, 0, 'first click only opens the consequence confirmation')
  assert.match(renderer.text('settings.section'), /升级前请确认/)
  await renderer.findButton('仍要升级').props.onClick()
  await renderer.flush()
  assert.equal(upgradeCalls, 1)
  assert.match(renderer.text('settings.section'), /升级完成，需要手动重启/)
  assert.match(renderer.text('settings.section'), /重新启动 dsh/)
  assert.equal(renderer.pendingTimerDelays().filter((delay) => delay !== 5000).length, 0, 'no recovery polling while the process keeps running')

  // 重启标签：确认流程展示同源警告；发出后等待文案换成手动拉起说明。
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  renderer.findByTestId('restart-manual-warn')
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  await renderer.findButton('确认重启').props.onClick()
  await renderer.flush()
  assert.equal(webRestarts, 1)
  assert.match(renderer.text('settings.section'), /服务不会自动拉起/)
})

// 已装好待重启（installedVersion 领先运行版本）是宿主事实而不是点击残留：重挂载/刷新页面后
// 依然收起升级按钮并改示「已安装 X，重启后生效」（用户报「以为没升级成功」，2026-09-12）。
const installedAheadRpc = ({ installed = '1.5.2', running = '1.5.1', manual = true } = {}) => async (channel, endpoint) => {
  assert.equal(channel, '/dsh-service')
  if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: running, installedVersion: installed, instanceId: 'old-instance', runtimeEnv: { platform: 'win32', supervisorKind: manual ? null : 'pm2', manualStartLikely: manual } } }
  if (endpoint === 'check-update') return { ok: true, value: {
    dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', tags: { latest: '0.1.0-rc.7', next: null }, upToDate: true, status: 'available', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
    plugin: { current: running, installed, latest: '1.5.2', tags: { latest: '1.5.2', next: null }, upToDate: installed === '1.5.2', status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' },
  } }
  if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
  if (endpoint === 'backup-list') return { ok: true, value: { items: [{ id: 'b1' }], totalBytes: 1024 } }
  if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
  if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
  throw new Error(`unexpected endpoint ${endpoint}`)
}

test('an installed-but-not-restarted upgrade hides the upgrade button on a fresh mount', async () => {
  const renderer = createRenderer(installedAheadRpc())
  await renderer.load()
  assert.match(renderer.text('settings.section'), /已安装 1\.5\.2，重启后生效/)
  assert.doesNotMatch(renderer.text('settings.section'), /升级插件/)
  assert.equal(renderer.hasTest('upgrade-manual-pending'), true, 'manual environment keeps the hand-restart guidance')
  assert.equal(renderer.hasTest('overview-actionables'), false, 'no bogus update item while restart is pending')
})

test('after the process finally restarts the card returns to the ordinary up-to-date state', async () => {
  const renderer = createRenderer(installedAheadRpc({ running: '1.5.2', installed: '1.5.2' }))
  await renderer.load()
  assert.match(renderer.text('settings.section'), /已是最新版本/)
  assert.doesNotMatch(renderer.text('settings.section'), /重启后生效/)
  assert.doesNotMatch(renderer.text('settings.section'), /升级插件/)
  assert.equal(renderer.hasTest('upgrade-manual-pending'), false)
})

test('a managed environment with a pending restart drops the button without the manual guidance', async () => {
  const renderer = createRenderer(installedAheadRpc({ manual: false }))
  await renderer.load()
  assert.match(renderer.text('settings.section'), /已安装 1\.5\.2，重启后生效/)
  assert.doesNotMatch(renderer.text('settings.section'), /升级插件/)
  assert.equal(renderer.hasTest('upgrade-manual-pending'), false, 'recovery polling owns the managed case')
})

test('a legacy host without an installed version keeps the upgrade button and the old flow', async () => {
  const renderer = createRenderer(stubPanelRpc({ version: { pluginVersion: '1.5.1' } }))
  await renderer.load()
  assert.match(renderer.text('settings.section'), /有新版本：0\.10\.0/)
  await renderer.findButton('升级插件')
})

test('an upgrade that lands without a restart switches the card to the restart-pending state', async () => {
  let installed = '1.5.1'
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '1.5.1', installedVersion: installed, instanceId: 'old-instance', runtimeEnv: { platform: 'win32', supervisorKind: null, manualStartLikely: true } } }
    if (endpoint === 'check-update') {
      const landed = installed !== '1.5.1'
      return { ok: true, value: {
        dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', tags: { latest: '0.1.0-rc.7', next: null }, upToDate: true, status: 'available', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
        plugin: { current: '1.5.1', installed, latest: '1.5.2', tags: { latest: '1.5.2', next: null }, upToDate: landed, status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' },
      } }
    }
    if (endpoint === 'upgrade') {
      installed = '1.5.2'
      return { ok: true, value: { result: 'upgraded', profile: 'web', previous: '1.5.1', installed: '1.5.2', requiresManualRestart: true } }
    }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [{ id: 'b1' }], totalBytes: 1024 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {}, errors: { models: [], tools: [] } } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  assert.match(renderer.text('settings.section'), /有新版本：1\.5\.2/)
  await renderer.findButton('升级插件').props.onClick()
  await renderer.flush()
  await renderer.findButton('仍要升级').props.onClick()
  await renderer.flush()
  // 升级落地后凭刷新到的 installedVersion 立刻切换：按钮消失、状态改示重启后生效、指引同现。
  assert.doesNotMatch(renderer.text('settings.section'), /升级插件/)
  assert.match(renderer.text('settings.section'), /已安装 1\.5\.2，重启后生效/)
  assert.equal(renderer.hasTest('upgrade-manual-pending'), true)
  assert.equal(renderer.pendingTimerDelays().filter((delay) => delay !== 5000).length, 0, 'no recovery polling while the process keeps running')
})

test('managed environment upgrades immediately, keeps recovery polling, and labels the supervisor', async () => {
  let upgradeCalls = 0
  const renderer = createRenderer(stubPanelRpc({
    version: { runtimeEnv: { platform: 'linux', supervisorKind: 'pm2', manualStartLikely: false } },
    endpoints: {
      upgrade: () => {
        upgradeCalls += 1
        return { ok: true, value: { result: 'upgraded', profile: 'web', previous: '0.9.0', installed: '0.10.0' } }
      },
    },
  }))

  await renderer.load()
  await renderer.findButton('升级插件').props.onClick()
  await renderer.flush()
  assert.equal(upgradeCalls, 1, 'no confirmation gate when a process manager is detected')
  assert.doesNotMatch(renderer.text('settings.section'), /需要手动重启/)
  assert.ok(renderer.pendingTimerDelays().some((delay) => delay !== 5000), 'recovery polling is armed as before')
})

test('version responses without the runtime env field keep the legacy upgrade behavior', async () => {
  let upgradeCalls = 0
  const renderer = createRenderer(stubPanelRpc({
    endpoints: {
      upgrade: () => {
        upgradeCalls += 1
        return { ok: true, value: { result: 'upgraded', profile: 'web', previous: '0.9.0', installed: '0.10.0' } }
      },
    },
  }))

  await renderer.load()
  assert.doesNotMatch(renderer.text('settings.section'), /运行环境：/, 'no runtime env line for old hosts')
  await renderer.findButton('升级插件').props.onClick()
  await renderer.flush()
  assert.equal(upgradeCalls, 1, 'legacy hosts skip the confirmation gate entirely')
})

test('same-tick double invocation of the upgrade button issues a single upgrade RPC', async () => {
  let upgradeCalls = 0
  const renderer = createRenderer(stubPanelRpc({
    endpoints: {
      upgrade: () => {
        upgradeCalls += 1
        return { ok: true, value: { result: 'upgraded', profile: 'web', previous: '0.9.0', installed: '0.10.0', requiresManualRestart: true } }
      },
    },
  }))

  await renderer.load()
  const click = renderer.findButton('升级插件').props.onClick
  click()
  click()
  await renderer.flush()
  assert.equal(upgradeCalls, 1, 'module-level in-flight flag blocks same-tick re-entry that closure state cannot')
})

test('upgrade click before the version snapshot lands still waits for it and shows the confirmation', async () => {
  let upgradeCalls = 0
  let resolveVersion
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return new Promise((resolve) => { resolveVersion = resolve })
    if (endpoint === 'check-update') return { ok: true, value: {
      dsh: { current: '0.1.0-rc.7', latest: '0.1.0-rc.7', tags: { latest: '0.1.0-rc.7', next: null }, upToDate: true, status: 'available', url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
      plugin: { current: '0.9.0', latest: '0.10.0', tags: { latest: '0.10.0', next: null }, upToDate: false, status: 'available', url: 'https://github.com/gehennawu/dsh-service/releases' },
    } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'upgrade') {
      upgradeCalls += 1
      return { ok: true, value: { result: 'upgraded', profile: 'web', previous: '0.9.0', installed: '0.10.0', requiresManualRestart: true } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  // check-update 已返回、version 仍挂起：按钮可点，但处理器必须等共享快照落地再判环境。
  const pending = renderer.findButton('升级插件').props.onClick()
  await renderer.flush()
  assert.equal(upgradeCalls, 0, 'no upgrade RPC while the environment is still unknown')
  resolveVersion({ ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance', runtimeEnv: { platform: 'win32', supervisorKind: null, manualStartLikely: true } } })
  await pending
  await renderer.flush()
  assert.equal(upgradeCalls, 0, 'the manual confirmation gate is applied once the environment resolves')
  assert.match(renderer.text('settings.section'), /升级前请确认/)
})

test('malformed runtime env shapes degrade to legacy behavior', async () => {
  // 形状不对（manualStartLikely 非布尔）→ 视同旧宿主：不设确认门，直接按现状行为升级。
  let upgradeCalls = 0
  const malformed = createRenderer(stubPanelRpc({
    version: { runtimeEnv: { platform: 'win32', supervisorKind: null, manualStartLikely: 'true' } },
    endpoints: {
      upgrade: () => {
        upgradeCalls += 1
        return { ok: true, value: { result: 'upgraded', profile: 'web', previous: '0.9.0', installed: '0.10.0', requiresManualRestart: true } }
      },
    },
  }))
  await malformed.load()
  await malformed.findButton('升级插件').props.onClick()
  await malformed.flush()
  assert.equal(upgradeCalls, 1, 'gate never arms on an untrusted shape')
})

test('overview shows platform and node version metrics and diagnostics renders the runtime-env and node checks', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance', runtimeEnv: { platform: 'win32', supervisorKind: null, manualStartLikely: true } } }
    if (endpoint === 'check-update') return { ok: false, error: 'unavailable' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, platform: 'win32', arch: 'x64', nodeVersion: 'v20.11.0', liveSessions: 1, persistedSessions: 2, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'warning', checkedAt: Date.now(), checks: [
      { id: 'runtime-env', status: 'warning', detail: 'manual', advisory: true },
      { id: 'node-version', status: 'warning', detail: 'v20.11.0:22' },
    ] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  // 概览：进程与运行环境卡顶部出现平台与 Node 版本两个指标（win32 映射为 Windows）。
  assert.match(renderer.text('settings.section'), /平台/)
  assert.match(renderer.text('settings.section'), /Windows · x64/)
  assert.match(renderer.text('settings.section'), /Node 版本/)
  assert.match(renderer.text('settings.section'), /v20\.11\.0/)
  assert.match(renderer.text('settings.section'), /进程与运行环境/)

  // 健康诊断：两个新检查项的可读化文案；runtime-env 警告以胶囊角落橙点点亮标签。
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /运行环境.*疑似终端手动启动，重启后不会自动拉起/)
  assert.match(renderer.text('settings.section'), /Node 运行时.*v20\.11\.0 低于插件要求的 22\.x/)
  assert.equal(renderer.hasTest('tab-dot-diagnostics'), true)
})

test('diagnostics renders a recognized supervisor and a satisfied node version as ok', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance', runtimeEnv: { platform: 'linux', supervisorKind: 'docker', manualStartLikely: false } } }
    if (endpoint === 'check-update') return { ok: false, error: 'unavailable' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, platform: 'linux', arch: 'arm64', nodeVersion: 'v22.14.0', liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [
      { id: 'runtime-env', status: 'ok', detail: 'docker' },
      { id: 'node-version', status: 'ok', detail: 'v22.14.0:22' },
    ] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  assert.match(renderer.text('settings.section'), /Linux · arm64/)
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /运行环境.*由Docker 容器管理，重启后会自动拉起/)
  assert.match(renderer.text('settings.section'), /Node 运行时.*v22\.14\.0，满足 ≥22 要求/)
  assert.equal(renderer.hasTest('tab-dot-health'), false)
})

test('a manual-launch runtime-env check renders yellow inline but raises no alerts', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance', runtimeEnv: { platform: 'win32', supervisorKind: null, manualStartLikely: true } } }
    if (endpoint === 'check-update') return { ok: false, error: 'unavailable' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, platform: 'win32', arch: 'x64', nodeVersion: 'v22.14.0', liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [
      { id: 'runtime-env', status: 'warning', detail: 'manual', advisory: true },
      { id: 'node-version', status: 'ok', detail: 'v22.14.0:22' },
    ] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  // 黄色行内提示保留：检查文案照常展示；但不出现健康提醒横幅、服务控制提醒与任何 ⚠ 标志。
  assert.match(renderer.text('settings.section'), /运行环境.*疑似终端手动启动，重启后不会自动拉起/)
  assert.doesNotMatch(renderer.text('settings.section'), /健康提醒/)
  assert.doesNotMatch(renderer.text('settings.section'), /服务控制提醒/)
  assert.doesNotMatch(renderer.text('settings.section'), /⚠/)
})

test('an unknown runtime environment renders as informational without warning marks', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', pluginVersion: '0.9.0', instanceId: 'old-instance', runtimeEnv: { platform: 'linux', supervisorKind: null, manualStartLikely: false } } }
    if (endpoint === 'check-update') return { ok: false, error: 'unavailable' }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, platform: 'linux', arch: 'x64', nodeVersion: 'v22.14.0', liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { updatedAt: 0, indexedSessions: 0, totals: {}, projects: [], days: {} } }
    if (endpoint === 'diagnostics') return { ok: true, value: { status: 'ok', checkedAt: Date.now(), checks: [
      { id: 'runtime-env', status: 'info', detail: 'unknown' },
      { id: 'node-version', status: 'ok', detail: 'v22.14.0:22' },
    ] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  // info 检查项：可读文案照常展示补救提示，但不产生健康提醒横幅、不点亮标签 ⚠。
  assert.match(renderer.text('settings.section'), /运行环境.*未检测到进程管理器，无法确认重启后是否自动拉起/)
  assert.match(renderer.text('settings.section'), /DSH_SERVICE_RUNTIME_ENV=managed/)
  assert.doesNotMatch(renderer.text('settings.section'), /健康提醒/)
  assert.equal(renderer.hasTest('tab-dot-health'), false)
})

// ── v0.19 额度查询 ──────────────────────────────────────────────────────────────

function quotaRingRenderer(rpcCall, modelDirectories, options = {}) {
  return createRenderer(rpcCall, { modelDirectories, ...options })
}

test('quota ring follows the session provider, renders the tightest window, and opens the panel on click', async (t) => {
  const quotaCalls = []
  const storeListeners = new Set()
  const store = {
    snapshot: { current: null },
    subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    getSnapshot() { return this.snapshot },
  }
  const modelDirectories = {
    directoryFor(sessionId) {
      assert.equal(sessionId, 'session-1')
      return {
        store,
        load() {
          store.snapshot = { current: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }
          for (const fn of [...storeListeners]) fn()
          return Promise.resolve()
        },
      }
    },
  }
  const renderer = quotaRingRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      quotaCalls.push(payload)
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [
            {
              provider: 'opencode-go',
              displayName: 'opencode-go',
              adapted: true,
              kind: 'opencode-go',
              refreshing: false,
              status: 'ok',
              windows: [
                { id: 'rolling', percent: 12, resetsAt: new Date(Date.now() + 6030_000).toISOString() },
                { id: 'weekly', percent: 40 },
                { id: 'monthly', percent: 85 },
              ],
              fetchedAt: Date.now(),
            },
            { provider: 'openrouter', displayName: 'openrouter', adapted: false },
          ],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, modelDirectories)

  await renderer.load()
  // 目录尚未加载：环静默隐藏，但挂载即触发一次目录加载。
  await renderer.flush()
  await renderer.flush()
  assert.equal(store.snapshot.current?.provider, 'opencode-go')
  // 快照到达后：最紧窗口是月度 85%，环出现且 dasharray 反映百分比。
  const trigger = renderer.findByTestId('quota-ring-trigger')
  const circles = []
  ;(function walk(node) {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node === null || node === undefined || typeof node !== 'object') return
    if (node.type === 'circle') circles.push(node)
    for (const child of node.children || []) walk(child)
  })(trigger)
  assert.equal(circles.length, 2)
  const circumference = 2 * Math.PI * 5.5
  assert.ok(String(circles[1].props.strokeDasharray).startsWith(String((circumference * 85) / 100)))
  assert.deepEqual(quotaCalls, [{ providers: ['opencode-go'] }], 'first ring request waits for and targets the resolved provider')

  // 点击：开面板 + 再发一次 quota RPC（宿主决定缓存还是上游）。
  const callsBeforeClick = quotaCalls.length
  trigger.props.onClick()
  await renderer.flush()
  const panel = renderer.findByTestId('quota-ring-panel')
  assert.ok(panel)
  // 宽视口（无 matchMedia/document 的默认测试环境）：保持圆环上方 absolute 锚定几何。
  assert.equal(panel.props.style.position, 'absolute')
  assert.equal(panel.props.style.bottom, 'calc(100% + 8px)')
  assert.equal(panel.props.style.right, 0)
  const panelText = renderer.text()
  assert.match(panelText, /滚动 5 小时.*12%/)
  assert.match(panelText, /本周.*40%/)
  assert.match(panelText, /本月.*85%/)
  assert.match(panelText, /重置/) // rolling 的 resetsAt 在未来 → 出现重置倒计时
  // 头部表明「已用」，总进度条填充等于最紧窗口（月度 85%）。
  assert.match(panelText, /已用/)
  assert.equal(renderer.hasTest('quota-panel-used-bar'), false)
  assert.equal(renderer.hasTest('quota-panel-tightest-label'), false)
  // 每个窗口有独立进度条；重置时间是单独一行（独立节点），不与标签同行拼接。
  assert.equal(renderer.findByTestId('quota-window-bar-rolling').children[0].props.style.width, '12%')
  assert.equal(renderer.findByTestId('quota-window-bar-weekly').children[0].props.style.width, '40%')
  const rollingReset = renderer.findByTestId('quota-reset-rolling')
  // 官网口径：两个非零单位带分钟数（1 小时 31 分钟），措辞「重置于」。
  assert.equal(String(rollingReset.children[0]), '重置于 1 小时 40 分钟')
  assert.match(panelText, /1 小时 40 分钟/)
  assert.equal(renderer.hasTest('quota-reset-weekly'), false)
  assert.ok(quotaCalls.length > callsBeforeClick)

  // 环的轮询已在跑（refs>1）时打开「额度查询」标签：挂载即立即再查一次，不沿用旧快照。
  const callsBeforeTab = quotaCalls.length
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  assert.ok(quotaCalls.length > callsBeforeTab)
  assert.ok(renderer.hasTest('remote-quota-card'))

  // 切到未适配供应商：环整体消失（不占位）。
  store.snapshot = { current: { provider: 'openrouter' } }
  for (const fn of [...storeListeners]) fn()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-ring-trigger'), false)
})

test('quota ring routes cliproxy CPA windows by current model family (Claude, Gemini, Codex) and toggles all', async () => {
  const storeListeners = new Set()
  const store = {
    snapshot: { current: { provider: 'cpa', model: 'claude-sonnet-4-6' } },
    subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    getSnapshot() { return this.snapshot },
  }
  const modelDirectories = {
    directoryFor: () => ({ store, load: () => Promise.resolve() }),
  }
  const cpaWindows = [
    { id: 'gemini-5h', kindKey: 'gemini-5h', percent: 20 },
    { id: 'gemini-week', kindKey: 'gemini-week', percent: 10 },
    { id: 'claude-5h', kindKey: 'claude-5h', percent: 0 },
    { id: 'claude-week', kindKey: 'claude-week', percent: 0 },
    { id: 'codex-5h', kindKey: 'codex-5h', percent: 5 },
    { id: 'codex-week', kindKey: 'codex-week', percent: 70 },
  ]
  const renderer = quotaRingRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          providers: [
            { provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', windows: cpaWindows },
          ],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, modelDirectories)

  await renderer.load()
  await renderer.flush()

  // 1) 当前模型是 claude-sonnet-4-6：环展示 Claude 0% 额度
  const trigger = renderer.findByTestId('quota-ring-trigger')
  assert.ok(trigger)
  assert.match(trigger.props.title, /CPA · Claude/)
  assert.match(trigger.props.title, /0%/)

  trigger.props.onClick()
  await renderer.flush()
  const panel = renderer.findByTestId('quota-ring-panel')
  assert.ok(panel)
  assert.match(renderer.text(), /CPA · Claude/)
  assert.match(renderer.text(), /5 小时/)
  assert.match(renderer.text(), /本周/)
  // 此时未点「查看全部」：不展示 Codex / Gemini 窗口
  assert.equal(renderer.hasTest('quota-window-bar-codex-5h'), false)
  assert.equal(renderer.hasTest('quota-window-bar-gemini-5h'), false)

  // 点击展开全部额度
  const toggleBtn = renderer.findByTestId('quota-ring-toggle-all')
  assert.ok(toggleBtn)
  assert.match(toggleBtn.children[0], /查看全部额度 \(6\)/)
  toggleBtn.props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-window-bar-codex-5h'), true)
  assert.equal(renderer.hasTest('quota-window-bar-gemini-5h'), true)
  // 展开全部后按 Gemini / Claude / Codex 分区
  assert.ok(renderer.findByTestId('quota-ring-family-gemini'))
  assert.ok(renderer.findByTestId('quota-ring-family-claude'))
  assert.ok(renderer.findByTestId('quota-ring-family-codex'))
  assert.equal(renderer.findByTestId('quota-ring-family-title-gemini').children.join(''), 'Gemini')
  assert.equal(renderer.findByTestId('quota-ring-family-title-claude').children.join(''), 'Claude')
  assert.equal(renderer.findByTestId('quota-ring-family-title-codex').children.join(''), 'Codex')

  // 2) 切到 gpt-5.5：自动折算为 Codex 上游，反映 70% 用量
  store.snapshot = { current: { provider: 'cpa', model: 'gpt-5.5' } }
  for (const fn of [...storeListeners]) fn()
  await renderer.flush()
  assert.match(renderer.text(), /CPA · Codex/)
  assert.match(renderer.text(), /本周.*70%/)
  assert.equal(renderer.hasTest('quota-window-bar-claude-5h'), false)

  // 3) 切到 gemini-3.1-pro：自动折算为 Gemini 上游，反映 20% 用量
  store.snapshot = { current: { provider: 'cpa', model: 'gemini-3.1-pro' } }
  for (const fn of [...storeListeners]) fn()
  await renderer.flush()
  assert.match(renderer.text(), /CPA · Gemini/)
  assert.match(renderer.text(), /5 小时.*20%/)
  assert.equal(renderer.hasTest('quota-window-bar-codex-5h'), false)
})

test('quota ring recovers when the first strict-session injection missed the directory', async () => {
  // 真机事实（v0.1.2-alpha.3 渲染器源码核实）：strict session 槽的 inject 产物按
  // (entry,binding) 缓存——刷新/首进旧会话时 directoryFor 可能因会话作用域尚未热身
  // 抛错，空 props 被缓存后圆环从此静默（用户报告的「刷新/新会话后圆环不见」）。
  // 本用例用 (entry,binding) 缓存语义复现：首次注入拿到空 props，服务就绪后同一
  // binding 内必须自愈。
  const storeListeners = new Set()
  const store = {
    snapshot: { current: null },
    subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    getSnapshot() { return this.snapshot },
  }
  let directoryCalls = 0
  let loadCalls = 0
  let ready = false
  let resolveLoad = () => {}
  const directory = {
    store,
    load() {
      loadCalls += 1
      return new Promise((resolve) => {
        resolveLoad = () => {
          store.snapshot = { current: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }
          for (const fn of [...storeListeners]) fn()
          resolve()
        }
      })
    },
  }
  const modelDirectories = {
    directoryFor(sessionId) {
      assert.equal(sessionId, 'session-1')
      directoryCalls += 1
      if (!ready) throw new Error('session directory is warming up')
      return directory
    },
  }
  const quotaPayloads = []
  const renderer = quotaRingRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      quotaPayloads.push(payload)
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'opencode-go', displayName: 'opencode-go', adapted: true, kind: 'opencode-go',
            refreshing: false, status: 'ok',
            windows: [{ id: 'weekly', percent: 40, resetsAt: new Date(Date.now() + 3600_000).toISOString() }],
            fetchedAt: Date.now(),
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, modelDirectories, { strictSessionSlots: true, initialSessionId: 'session-1' })

  await renderer.load()
  await renderer.flush()
  // 首次注入撞上目录未热身：inject 记 1 次；组件挂载立刻原地补解一次（attempt 0）
  // 仍失败 → 环不渲染、零 quota 请求、挂起 250ms 退避重试。
  assert.equal(directoryCalls, 2)
  assert.equal(renderer.hasTest('quota-ring-trigger'), false)
  assert.equal(quotaPayloads.length, 0)

  // 服务就绪后（同一 binding）：退避重试必须再次解析目录并触发加载。
  ready = true
  renderer.setModelDirectories(modelDirectories)
  await renderer.advanceTimer(250)
  assert.equal(directoryCalls, 3, 'retry must resolve the directory again within the same binding')
  assert.equal(loadCalls, 1)
  // 目录 current 未到：环仍隐藏，也不提前发 provider 级请求。
  assert.equal(renderer.hasTest('quota-ring-trigger'), false)
  assert.equal(quotaPayloads.length, 0)

  // 目录加载落地：环出现且唯一一次 quota 请求精确指向当前 provider。
  resolveLoad()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-ring-trigger'), true)
  assert.deepEqual(quotaPayloads, [{ providers: ['opencode-go'] }])

  // strict 生命周期护栏：卸载即摘环；同会话重新挂载（新 binding）重新解析并恢复。
  renderer.setSessionSlot({ mounted: false })
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-ring-trigger'), false)
  renderer.setSessionSlot({ sessionId: 'session-1', mounted: true })
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-ring-trigger'), true)
  assert.equal(directoryCalls, 4, 'remount mints a new binding and resolves the directory again')
  assert.equal(loadCalls, 1)
  renderer.disposeFactory()
})

test('ring keeps its panel open while refreshing and shows reset times once data lands', async () => {
  const storeListeners = new Set()
  const store = {
    snapshot: { current: null },
    subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    getSnapshot() { return this.snapshot },
  }
  const modelDirectories = {
    directoryFor() {
      return {
        store,
        load() {
          store.snapshot = { current: { provider: 'opencode-go', model: 'deepseek-v4-flash' } }
          for (const fn of [...storeListeners]) fn()
          return Promise.resolve()
        },
      }
    },
  }
  // 前两笔（挂载拉取 + provider 补拉）返回「刷新中、无窗口」的行，之后返回完整窗口。
  let refreshed = false
  let quotaCalls = 0
  const refreshingPayload = {
    ok: true,
    value: {
      serverTime: Date.now(),
      providers: [{ provider: 'opencode-go', displayName: 'opencode-go', adapted: true, kind: 'opencode-go', refreshing: true, status: 'ok' }],
    },
  }
  const fullPayload = {
    ok: true,
    value: {
      serverTime: Date.now(),
      providers: [{
        provider: 'opencode-go',
        displayName: 'opencode-go',
        adapted: true,
        kind: 'opencode-go',
        refreshing: false,
        status: 'ok',
        windows: [{ id: 'weekly', percent: 40, resetsAt: new Date(Date.now() + 7530_000).toISOString() }],
        fetchedAt: Date.now(),
        resetCards: [{ id: 'rc-panel', provider: 'opencode-go', label: '周额度重置卡', expiresAt: '2099-06-01' }],
      }],
    },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      quotaCalls += 1
      return refreshed ? fullPayload : refreshingPayload
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories })

  await renderer.load()
  await renderer.flush()
  await renderer.flush()
  // 有适配行但数据未到的刷新期：触发钮仍然可见（不再整环消失）。
  assert.equal(renderer.hasTest('quota-ring-trigger'), true)
  // 点击：面板保持打开（不再因无窗口数据整环卸载），显示「刷新中」。
  renderer.findByTestId('quota-ring-trigger').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-ring-panel'), true)
  assert.match(renderer.text(), /刷新中/)
  // 数据落地（落定接续补拉，不再等下一个轮询周期）：同一面板原地更新，重置时间无需二次点击。
  refreshed = true
  await renderer.advanceTimer(800)
  let landed = false
  for (let i = 0; i < 20 && !landed; i++) {
    await renderer.flush()
    landed = renderer.text().includes('本周')
  }
  assert.ok(landed)
  assert.equal(renderer.hasTest('quota-ring-panel'), true)
  assert.match(renderer.text(), /本周.*40%/)
  assert.match(renderer.text(), /重置于 2 小时 5 分钟/)
  // 圆环面板的重置卡：单张时直接显示那张卡（不再有汇总行），行首是卡片图标。
  const panelCard = renderer.findByTestId('quota-panel-reset-card-0-0')
  assert.equal(panelCard.children[0].type, 'svg')
  assert.equal(panelCard.children[0].props['aria-hidden'], true)
  // 弹窗与额度页同款：图标绿色锚点、文字中性。
  assert.equal(panelCard.children[0].props.stroke, 'var(--dsw-alias-state-success-primary)')
  assert.equal(panelCard.props.style.color, 'var(--dsw-alias-label-secondary)')
  assert.match(String(panelCard.children[1].children), /重置卡 · 周额度重置卡/)
  assert.equal(renderer.hasTest('quota-panel-reset-more-0'), false, 'single card needs no collapse toggle')

  // 关闭面板不再补发 quota RPC（此前开/关 toggle 都无条件拉一次）。
  const callsBeforeClose = quotaCalls
  renderer.findByTestId('quota-ring-trigger').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-ring-panel'), false)
  assert.equal(quotaCalls, callsBeforeClose)
})

test('the ring panel shows only each account\'s nearest reset card and collapses the rest', async () => {
  // 复现多账号场景：CPA 下两个 codex 账号各有多张卡。每账号默认只显示最近要到期的那张，
  // 其余折叠在「另有 N 张」后面（此前把所有卡混成一长串，多账号下分不清归属）。
  const store = {
    snapshot: { current: { provider: 'cpa' } },
    subscribe: () => () => {},
    getSnapshot() { return this.snapshot },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
            refreshing: false, status: 'ok', fetchedAt: Date.now(),
            windows: [
              { id: 'g-0-codex-5h', kindKey: 'codex-5h', label: 'gehenna8888@gmail.com', percent: 0 },
              { id: 'r-1-codex-5h', kindKey: 'codex-5h', label: 'relient8888@gmail.com', percent: 0 },
            ],
            // 刻意乱序：最近到期的排在中间，验证展示取「最近」而不是原序第一张。
            resetCards: [
              { id: 'g2', provider: 'cpa', account: 'gehenna8888@gmail.com', expiresAt: '2026-10-04T13:42' },
              { id: 'g1', provider: 'cpa', account: 'gehenna8888@gmail.com', expiresAt: '2026-09-21T08:30' },
              { id: 'g3', provider: 'cpa', account: 'gehenna8888@gmail.com', expiresAt: '2026-10-05T07:12' },
              { id: 'r2', provider: 'cpa', account: 'relient8888@gmail.com', expiresAt: '2026-10-05T06:18' },
              { id: 'r1', provider: 'cpa', account: 'relient8888@gmail.com', expiresAt: '2026-10-04T10:34' },
            ],
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories: { directoryFor: () => ({ store, load: () => Promise.resolve() }) } })
  await renderer.load()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('quota-ring-trigger').props.onClick()
  await renderer.flush()

  // 两个账号两组；每组只显示最近那一张（gehenna=09-21、relient=10-04），其余折叠。
  assert.equal(String(renderer.findByTestId('quota-panel-reset-owner-0').children), 'gehenna8888@gmail.com')
  assert.equal(String(renderer.findByTestId('quota-panel-reset-owner-1').children), 'relient8888@gmail.com')
  assert.match(String(renderer.findByTestId('quota-panel-reset-card-0-0').children[1].children), /2026-09-21 08:30/)
  assert.match(String(renderer.findByTestId('quota-panel-reset-card-1-0').children[1].children), /2026-10-04 10:34/)
  // 弹窗侧同款配色：图标绿色锚点、文字中性（与额度页同一份 resetCardContent）。
  assert.equal(renderer.findByTestId('quota-panel-reset-card-0-0').children[0].props.stroke, 'var(--dsw-alias-state-success-primary)')
  assert.equal(renderer.findByTestId('quota-panel-reset-card-0-0').props.style.color, 'var(--dsw-alias-label-secondary)')
  assert.equal(renderer.hasTest('quota-panel-reset-card-0-1'), false, 'only the nearest card is shown per account')
  assert.equal(String(renderer.findByTestId('quota-panel-reset-more-0').children), '另有 2 张')
  assert.equal(String(renderer.findByTestId('quota-panel-reset-more-1').children), '另有 1 张')

  // 展开某账号 → 该账号全部卡按最近到期排序；其它账号不受影响。
  renderer.findByTestId('quota-panel-reset-more-0').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-panel-reset-more-0'), false)
  assert.match(String(renderer.findByTestId('quota-panel-reset-card-0-1').children[1].children), /2026-10-04 13:42/)
  assert.match(String(renderer.findByTestId('quota-panel-reset-card-0-2').children[1].children), /2026-10-05 07:12/)
  assert.equal(String(renderer.findByTestId('quota-panel-reset-more-1').children), '另有 1 张', 'the other account stays collapsed')

  // 收起恢复默认。
  renderer.findByTestId('quota-panel-reset-less-0').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-panel-reset-card-0-1'), false)
  assert.equal(String(renderer.findByTestId('quota-panel-reset-more-0').children), '另有 2 张')
})

test('a provider-level reset card (no account) is grouped separately from account cards', async () => {
  const store = {
    snapshot: { current: { provider: 'cpa' } },
    subscribe: () => () => {},
    getSnapshot() { return this.snapshot },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
            refreshing: false, status: 'ok', fetchedAt: Date.now(),
            windows: [{ id: 'g-0-codex-5h', kindKey: 'codex-5h', label: 'gehenna8888@gmail.com', percent: 0 }],
            resetCards: [
              { id: 'whole', provider: 'cpa', expiresAt: '2026-09-21T23:47' },
              { id: 'acct', provider: 'cpa', account: 'gehenna8888@gmail.com', expiresAt: '2026-10-05T07:12' },
            ],
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories: { directoryFor: () => ({ store, load: () => Promise.resolve() }) } })
  await renderer.load()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('quota-ring-trigger').props.onClick()
  await renderer.flush()
  // 旧数据（无 account）归到独立的「重置卡」组，不混进任何账号。
  assert.equal(String(renderer.findByTestId('quota-panel-reset-owner-0').children), '重置卡')
  assert.match(String(renderer.findByTestId('quota-panel-reset-card-0-0').children[1].children), /2026-09-21 23:47/)
  assert.equal(String(renderer.findByTestId('quota-panel-reset-owner-1').children), 'gehenna8888@gmail.com')
  assert.match(String(renderer.findByTestId('quota-panel-reset-card-1-0').children[1].children), /2026-10-05 07:12/)
})

test('an expired reset card switches both its icon and its text to the warning color', async () => {
  // 配色契约的过期分支：未过期 = 绿图标 + 中性文字；过期 = 图标与文字一起转警示色
  // （与既有「过期标黄」口径一致，不再只靠「已过期」三字提示）。
  const store = {
    snapshot: { current: { provider: 'cpa' } },
    subscribe: () => () => {},
    getSnapshot() { return this.snapshot },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
            refreshing: false, status: 'ok', fetchedAt: Date.now(),
            windows: [{ id: 'g-0-codex-5h', kindKey: 'codex-5h', label: 'gehenna8888@gmail.com', percent: 0 }],
            resetCards: [{ id: 'stale', provider: 'cpa', account: 'gehenna8888@gmail.com', expiresAt: '2020-01-01T00:00' }],
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories: { directoryFor: () => ({ store, load: () => Promise.resolve() }) } })
  await renderer.load()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('quota-ring-trigger').props.onClick()
  await renderer.flush()

  const row = renderer.findByTestId('quota-panel-reset-card-0-0')
  assert.equal(row.props.style.color, 'var(--dsw-alias-state-warn-primary)')
  assert.equal(row.children[0].props.stroke, 'var(--dsw-alias-state-warn-primary)')
  assert.match(String(row.children[1].children), /已过期/)
})


test('quota ring panel centers lower in the conversation area via body portal on mobile viewports and reverts when widened', async () => {
  const storeListeners = new Set()
  const store = {
    snapshot: { current: { provider: 'opencode-go' } },
    subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    getSnapshot() { return this.snapshot },
  }
  const modelDirectories = {
    directoryFor() {
      return { store, load() { return Promise.resolve() } }
    },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'opencode-go', displayName: 'opencode-go', adapted: true, kind: 'opencode-go',
            refreshing: false, status: 'ok',
            windows: [{ id: 'weekly', percent: 40, resetsAt: new Date(Date.now() + 3600_000).toISOString() }],
            fetchedAt: Date.now(),
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories })
  // 移动视口模拟：与整体适配同用 1023px 断点（matches 用 getter 保持活值），document.body 存在。
  // createRenderer 会重置 window，所以 mock 必须在其后、load 之前装上。
  const mediaListeners = new Set()
  const mediaQueries = []
  let narrow = true
  globalThis.window.matchMedia = (query) => {
    mediaQueries.push(query)
    return {
    media: query,
    get matches() { return narrow },
    addEventListener(type, listener) { mediaListeners.add(listener) },
    removeEventListener(type, listener) { mediaListeners.delete(listener) },
    }
  }
  const body = {}
  // querySelector 返回 null 让设置导航标记逻辑走「无 dialog 早退」路径（真实外壳里同理）；
  // MutationObserver 提供空实现（标记逻辑在无 dialog 时不会真正 observe）。
  class FakeMutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = { body, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }
  const findPortal = () => {
    let portal = null
    const walk = (node) => {
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (node === null || node === undefined || typeof node !== 'object') return
      if (node.type === '#portal') portal = node
      for (const child of node.children || []) walk(child)
    }
    for (const tree of renderer.roots()) walk(tree)
    return portal
  }
  try {
    await renderer.load()
    await renderer.flush()
    await renderer.flush()
    renderer.findByTestId('quota-ring-trigger').props.onClick()
    await renderer.flush()
    // 手机几何：跟整体移动端统一到 1023px 断点；水平居中，垂直中心位于屏幕高度 75%。
    const panel = renderer.findByTestId('quota-ring-panel')
    assert.ok(mediaQueries.includes('(max-width: 1023px)'))
    assert.equal(panel.props.style.position, 'fixed')
    assert.equal(panel.props.style.left, '50%')
    assert.equal(panel.props.style.top, '75%')
    assert.equal(panel.props.style.transform, 'translate(-50%, -50%)')
    assert.match(panel.props.style.width, /^min\(280px/)
    assert.equal(panel.props.style.maxHeight, 'min(560px, calc(100dvh - 176px))')
    // portal 生效：面板经 #portal 节点挂到 document.body，脱离圆环 span 子树。
    const portal = findPortal()
    assert.ok(portal, 'panel should render through a portal node')
    assert.equal(portal.props.portalContainer, body)
    assert.match(renderer.text(), /本周.*40%/)

    // 拖宽窗口（断点离开）：面板实时迁回圆环上方锚定几何，open 态不丢。
    narrow = false
    for (const listener of [...mediaListeners]) listener({ matches: false })
    await renderer.flush()
    const anchored = renderer.findByTestId('quota-ring-panel')
    assert.equal(anchored.props.style.position, 'absolute')
    assert.equal(anchored.props.style.bottom, 'calc(100% + 8px)')
    assert.equal(anchored.props.style.right, 0)
    assert.equal(findPortal(), null)
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
    delete globalThis.window.matchMedia
  }
})

test('remaining-basis windows switch the panel word and invert the warn threshold', async () => {
  const storeListeners = new Set()
  const store = {
    snapshot: { current: { provider: 'minimax-cn' } },
    subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    getSnapshot() { return this.snapshot },
  }
  const modelDirectories = {
    directoryFor() {
      return { store, load() { return Promise.resolve() } }
    },
  }
  // 剩余口径：percent=95 表示「剩余 95%」——头部应显「剩余」，且 95 不触发 ≥80 警黄。
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'minimax-cn',
            displayName: 'MiniMax Token Plan',
            adapted: true,
            kind: 'minimax',
            refreshing: false,
            status: 'ok',
            windows: [{ id: '5h', percent: 95, remaining: true, resetsAt: new Date(Date.now() + 3600_000).toISOString() }],
            fetchedAt: Date.now(),
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories })

  await renderer.load()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('quota-ring-trigger').props.onClick()
  await renderer.flush()
  assert.match(renderer.text(), /剩余/)
  assert.doesNotMatch(renderer.text(), /已用 · /)
  const bar = renderer.findByTestId('quota-window-bar-5h').children[0]
  assert.equal(bar.props.style.width, '95%')
  assert.equal(bar.props.style.background, 'var(--dsw-alias-state-success-primary)')
})

test('balance-only providers show remaining wording and skip the fake percent in the ring panel', async () => {
  // 纯文本窗口（余额类）没有「已用」概念：头部按剩余口径，aria 不带假百分比。
  const storeListeners = new Set()
  const store = {
    snapshot: { current: { provider: 'deepseek-official' } },
    subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
    getSnapshot() { return this.snapshot },
  }
  const modelDirectories = {
    directoryFor() { return { store, load() { return Promise.resolve() } } },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.25.0', instanceId: 'x' } }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'deepseek-official',
            displayName: 'DeepSeek',
            adapted: true,
            kind: 'deepseek',
            refreshing: false,
            status: 'ok',
            windows: [{ id: 'balance-cny', text: '¥110.00', label: 'CNY', kindKey: 'balance' }],
            fetchedAt: Date.now(),
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories })

  await renderer.load()
  await renderer.flush()
  await renderer.flush()
  const trigger = renderer.findByTestId('quota-ring-trigger')
  assert.equal(trigger.props['aria-label'].includes('%'), false)
  trigger.props.onClick()
  await renderer.flush()
  const text = renderer.text()
  assert.match(text, /剩余/)
  assert.doesNotMatch(text, /已用/)
  assert.match(text, /CNY · 余额/)
  assert.match(text, /¥110\.00/)
})

test('xiaomi token plan card shows console buckets with absolute figures and the cookie credential entry', async () => {
  // 小米 Token Plan（v0.29）：套餐名文本窗口置顶 + 额度桶带 used/limit 原始数值（客户端缩写）；
  // 未配置行的凭据入口必须是「控制台 Cookie」文案——错标签会诱导把 tp- 推理密钥填进 Cookie 槽位。
  const now = Date.now()
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const quotaResponse = {
    ok: true,
    value: {
      serverTime: now,
      providers: [
        {
          provider: 'mimo', displayName: 'MiMo', adapted: true, kind: 'xiaomi-token-plan-cn', credentialEntryKey: 'editCookie', refreshing: false, status: 'ok',
          windows: [
            { id: 'plan', kindKey: 'plan-name', text: 'Pro 月度套餐' },
            { id: 'total_token', kindKey: 'total_token', percent: 12, used: 1357400000, limit: 11000000000, resetsAt: new Date(now + 3600_000).toISOString() },
          ],
          fetchedAt: now,
          usageUrl: 'https://platform.xiaomimimo.com/console/usage',
        },
        {
          provider: 'mimo2', displayName: 'MiMo relay', adapted: true, kind: 'xiaomi-token-plan-cn', credentialEntryKey: 'editCookie', refreshing: false, status: 'unconfigured',
          errorCode: 'credential-missing', nextAllowedAt: null,
          credentialHints: [
            { name: 'XIAOMI_MIMO_CONSOLE_COOKIE', configured: false },
            { name: 'MIMO_CONSOLE_COOKIE', configured: false },
          ],
        },
      ],
    },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.29.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.29.0', latest: '0.29.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') return quotaResponse
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const text = renderer.text('settings.section')
  // 卡片标题链到用户点名的控制台用量页。
  assert.equal(renderer.findByTestId('quota-usage-link-mimo').props.href, 'https://platform.xiaomimimo.com/console/usage')
  // 套餐名文本窗口 + 总额度桶：百分比与绝对数 figure 同行（「{{used}} / {{limit}}」控制台口径）。
  assert.match(text, /订阅套餐/)
  assert.match(text, /Pro 月度套餐/)
  assert.match(text, /套餐总额度/)
  // 无 unit 的窗口（token 数）继续走 K/M/B 缩写：量纲分流不能把 token 数也按金额渲染。
  assert.match(text, /12% · 1\.4B \/ 11B/)
  assert.doesNotMatch(text, /\$1\.4B/)
  // 有效期作为 resetsAt → 重置倒计时行（时长随执行耗时漂移，只断行存在与文案前缀）。
  const resetLine = renderer.findByTestId('quota-card-reset-mimo-total_token')
  assert.match(String(resetLine.children[0]), /^重置于 /)
  // v0.39：凭据入口收进折叠的「配置」，先展开 mimo2 卡。
  const advancedToggle = renderer.findByTestId('quota-advanced-toggle-mimo2')
  // 折叠钮文案就是「配置」（不再叫「高级配置」）。
  assert.equal(String(advancedToggle.children[0]).endsWith('配置'), true)
  advancedToggle.props.onClick()
  await renderer.flush()
  // 未配置行的凭据入口文案按 kind 分流为 Cookie 版。
  assert.ok(renderer.hasTest('quota-cred-edit-mimo2'))
  assert.match(renderer.text('settings.section'), /填写控制台 Cookie（网页登录态）/)
})

test('stepfun cards show money text windows and the credit-pool plan windows with the token credential entry', async () => {
  // StepFun（v0.39）：余额卡 = ¥ 文本窗（voucher 复用 granted-balance）；Step Plan 卡 = credit-pool/
  // topup-credit 百分比窗；未配置订阅行的凭据入口分流为「控制台令牌（Oasis-Token）」版。
  const now = Date.now()
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const quotaResponse = {
    ok: true,
    value: {
      serverTime: now,
      providers: [
        {
          provider: 'sf', displayName: 'StepFun', adapted: true, kind: 'stepfun', credentialEntryKey: 'edit', refreshing: false, status: 'ok',
          windows: [
            { id: 'balance', kindKey: 'balance', text: '¥123.45' },
            { id: 'granted-balance', kindKey: 'granted-balance', text: '¥3.45' },
          ],
          fetchedAt: now,
          usageUrl: 'https://platform.stepfun.com/plan-usage',
        },
        {
          provider: 'sfplan', displayName: 'Step Plan', adapted: true, kind: 'stepfun-step-plan', credentialEntryKey: 'editToken', refreshing: false, status: 'ok',
          windows: [
            { id: 'credit-pool', kindKey: 'credit-pool', percent: 10, resetsAt: new Date(now + 3600_000).toISOString() },
            { id: 'topup-credit', kindKey: 'topup-credit', percent: 1 },
          ],
          fetchedAt: now,
          usageUrl: 'https://platform.stepfun.com/plan-usage',
        },
        {
          provider: 'sfplan2', displayName: 'Step Plan2', adapted: true, kind: 'stepfun-step-plan', credentialEntryKey: 'editToken', refreshing: false, status: 'unconfigured',
          errorCode: 'credential-missing', nextAllowedAt: null,
          credentialHints: [
            { name: 'STEPFUN_TOKEN', configured: false },
            { name: 'STEPFUN_OASIS_TOKEN', configured: false },
          ],
        },
      ],
    },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.38.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.38.0', latest: '0.38.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') return quotaResponse
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const text = renderer.text('settings.section')
  // 余额文本窗（voucher 行复用「赠送余额（未过期）」词典键）；卡片标题链到用户点名的官网用量页。
  assert.match(text, /余额/)
  assert.match(text, /¥123\.45/)
  assert.match(text, /赠送余额（未过期）/)
  assert.match(text, /¥3\.45/)
  assert.equal(renderer.findByTestId('quota-usage-link-sf').props.href, 'https://platform.stepfun.com/plan-usage')
  // Step Plan 窗：credit-pool 百分比 + 重置倒计时行；topup 无重置不渲染该行。
  assert.match(text, /月度 Credit 池/)
  assert.match(text, /10%/)
  assert.ok(renderer.hasTest('quota-card-reset-sfplan-credit-pool'))
  assert.equal(renderer.hasTest('quota-card-reset-sfplan-topup-credit'), false)
  assert.match(text, /加油包 Credit/)
  assert.match(text, /1%/)
  // v0.39：凭据入口在折叠的「配置」区，先展开 sfplan2 卡。
  renderer.findByTestId('quota-advanced-toggle-sfplan2').props.onClick()
  await renderer.flush()
  // 未配置订阅行的凭据入口分流为「控制台令牌（Oasis-Token）」版。
  assert.ok(renderer.hasTest('quota-cred-edit-sfplan2'))
  assert.match(renderer.text('settings.section'), /填写控制台令牌（Oasis-Token，浏览器登录态）/)
})

test('command-goat card shows the account balance, period spend, plan and usage windows', async () => {
  // Command Code 额度卡：余额 / 本周期已用 / 套餐是文本窗，5 小时与周窗是百分比窗
  // （宿主下发绝对 used/limit，客户端缩写）；卡片标题链到官方用量页。
  const now = Date.now()
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const quotaResponse = {
    ok: true,
    value: {
      serverTime: now,
      providers: [
        {
          provider: 'command-goat', displayName: 'command-goat', adapted: true, kind: 'command-goat', kindSource: 'auto',
          credentialEntryKey: 'edit', refreshing: false, status: 'ok',
          windows: [
            { id: 'balance', kindKey: 'balance', text: '$69.84' },
            { id: 'period-spend', kindKey: 'period-spend', text: '$0.12' },
            { id: 'plan', kindKey: 'plan-name', text: 'individual goat', resetsAt: new Date(now + 86400_000).toISOString() },
            { id: 'five-hour', kindKey: 'five-hour', percent: 50, used: 7, limit: 14, unit: 'usd', resetsAt: new Date(now + 3600_000).toISOString() },
            { id: 'weekly', kindKey: 'weekly', percent: 10, used: 3.5, limit: 35, unit: 'usd' },
          ],
          fetchedAt: now,
          usageUrl: 'https://commandcode.ai/settings/usage',
        },
        {
          provider: 'goat-relay', displayName: 'goat-relay', adapted: true, kind: 'command-goat', credentialEntryKey: 'edit',
          refreshing: false, status: 'unconfigured', errorCode: 'credential-rejected', errorDetail: "Invalid 'Authorization' header or token.",
          nextAllowedAt: null,
          credentialHints: [
            { name: 'COMMAND_GOAT_API_KEY', configured: false },
            { name: 'COMMAND_CODE_API_KEY', configured: false },
            { name: 'COMMANDCODE_API_KEY', configured: false },
          ],
        },
      ],
    },
  }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '1.6.3', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '1.6.3', latest: '1.6.3', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') return quotaResponse
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const text = renderer.text('settings.section')
  // 文本窗：余额、本周期已用、套餐标识（planId 去分隔符）；绝对数窗不必缩写。
  assert.match(text, /余额/)
  assert.match(text, /\$69\.84/)
  assert.match(text, /本周期已用/)
  assert.match(text, /\$0\.12/)
  assert.match(text, /订阅套餐/)
  assert.match(text, /individual goat/)
  // 百分比窗：绝对数是美元（unit:'usd'）→ 两列都带 `$`，不是 token 缩写。
  assert.match(text, /5 小时额度/)
  assert.match(text, /50% · \$7\.00 \/ \$14\.00/)
  assert.match(text, /10% · \$3\.50 \/ \$35\.00/)
  assert.doesNotMatch(text, /50% · 7 \/ 14/)
  assert.ok(renderer.hasTest('quota-card-reset-command-goat-five-hour'))
  assert.ok(renderer.hasTest('quota-card-reset-command-goat-plan'))
  assert.equal(renderer.findByTestId('quota-usage-link-command-goat').props.href, 'https://commandcode.ai/settings/usage')
  assert.equal(renderer.findByTestId('quota-usage-link-command-goat').props.target, '_blank')
  // 适配来源标签：baseURL 自动识别。
  assert.match(text, /自动识别/)
  // 错 key 行的凭据入口文案是经典「填写 API 密钥」（额度面与推理面同 key），不是 Cookie/管理密钥版。
  renderer.findByTestId('quota-advanced-toggle-goat-relay').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /凭据被上游拒绝/)
  assert.match(renderer.text('settings.section'), /Invalid 'Authorization' header or token/)
  assert.ok(renderer.hasTest('quota-cred-edit-goat-relay'))
  assert.match(renderer.text('settings.section'), /填写 API 密钥/)
})

test('quota kind dropdown offers command-goat alongside every other built-in adapter', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '1.6.3', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '1.6.3', latest: '1.6.3', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [{ provider: 'command-goat', displayName: 'command-goat', adapted: false }] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const kinds = renderer.findByTestId('quota-add-kind').children.flat(Infinity).map((option) => option.props.value)
  assert.deepEqual(kinds, ['', 'opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow', 'deepseek', 'stepfun', 'stepfun-step-plan', 'xiaomi-token-plan-cn', 'cliproxy', 'command-goat'])
  const labels = renderer.findByTestId('quota-add-kind').children.flat(Infinity).map((option) => option.children).flat(Infinity)
  assert.ok(labels.includes('Command Code 账号额度'), `kind dropdown labels missing command-goat: ${JSON.stringify(labels)}`)
})

test('quota ring renders nothing when the modelDirectories service is absent', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') return { ok: true, value: { providers: [], serverTime: 0 } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  assert.equal(renderer.hasTest('quota-ring-trigger'), false)
})

test('remote quota card lists providers, saves kind via whitelist RPC, and persists the poll choice', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const configCalls = []
  const cardCalls = []
  let zaiAdapted = false
  let zaiKind = null
  let zaiAutoSource = false
  let opencodeAdapted = false
  let allowZaiConfig = false
  let zaiCards = []
  const buildQuotaResponse = () => ({
    ok: true,
    value: {
      serverTime: Date.now(),
      providers: [
        ...(opencodeAdapted ? [{
          provider: 'opencode-go', displayName: 'OpenCode Go', adapted: true, kind: 'opencode-go', refreshing: false, status: 'ok',
          windows: [{ id: 'rolling', percent: 3, resetsAt: new Date(Date.now() + 7530_000).toISOString() }],
          fetchedAt: Date.now(), usageUrl: 'https://opencode.ai/',
        }] : [{ provider: 'opencode-go', displayName: 'OpenCode Go', adapted: false }]),
        ...(zaiAdapted ? [{
          provider: 'zai-coding-cn', displayName: 'zai-coding-cn', adapted: true, kind: zaiKind === null ? 'zai-coding-cn' : zaiKind,
          ...(zaiAutoSource ? { kindSource: 'auto' } : {}), refreshing: false, status: 'ok',
          windows: [{ id: 'rolling', percent: 3, resetsAt: new Date(Date.now() + 7530_000).toISOString() }],
          fetchedAt: Date.now(),
          ...(zaiCards.length > 0 ? { resetCards: zaiCards.map((card) => ({ provider: 'zai-coding-cn', ...card })) } : {}),
        }] : [{ provider: 'zai-coding-cn', displayName: 'zai-coding-cn', adapted: false }]),
        { provider: 'openrouter', displayName: 'openrouter', adapted: true, kind: 'opencode-go', kindSource: 'auto', refreshing: false, status: 'ok', windows: [{ id: 'weekly', percent: 14 }], fetchedAt: Date.now(), resetCards: [{ id: 'or-1', provider: 'openrouter', label: '周额度重置卡', expiresAt: '2099-06-01' }], usageUrl: 'https://opencode.ai/' },
      ],
    },
  })
  let quotaResponse = buildQuotaResponse()
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') return quotaResponse
    if (endpoint === 'quota-reset-card') {
      cardCalls.push(payload)
      if (payload.remove === true) zaiCards = zaiCards.filter((card) => card.id !== payload.id)
      else zaiCards = [...zaiCards, { id: `rc-${zaiCards.length + 1}`, ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}), ...(payload.label !== undefined ? { label: payload.label } : {}) }]
      quotaResponse = buildQuotaResponse()
      return { ok: true }
    }
    if (endpoint === 'quota-config') {
      configCalls.push(payload)
      if (payload.provider === 'zai-coding-cn') {
        // 仅在测试显式放行后接受（用于驱动「未知供应商」负路径断言）。
        if (!allowZaiConfig) return { ok: false, error: 'unknown-provider' }
      } else if (payload.provider !== 'opencode-go') {
        return { ok: false, error: 'unknown-provider' }
      }
      // 三种写法对齐宿主语义：clear 回退自动（fake 里保持适配、来源变 auto）；kind:null 显式停用；其余指定 kind。
      if (payload.provider === 'zai-coding-cn') {
        if (payload.clear === true) {
          zaiAdapted = true
          zaiAutoSource = true
        } else if (payload.kind === null) {
          zaiAdapted = false
          zaiAutoSource = false
        } else {
          zaiAdapted = true
          zaiAutoSource = false
          zaiKind = payload.kind
        }
      } else if (payload.provider === 'opencode-go') {
        opencodeAdapted = !(payload.clear === true || payload.kind === null)
      }
      quotaResponse = buildQuotaResponse()
      return { ok: true }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const text = renderer.text('settings.section')
  assert.match(text, /额度查询/)
  // 卡片分区：只有已适配的 openrouter 成卡；未适配供应商不渲染灰行，只进底部「手动适配」候选。
  assert.ok(renderer.hasTest('quota-provider-card-openrouter'))
  assert.equal(renderer.hasTest('quota-provider-card-zai-coding-cn'), false)
  assert.equal(renderer.hasTest('quota-provider-card-opencode-go'), false)
  // 手动适配行：供应商候选 = 未适配集合，类型下拉 = 全部内置 kind（zai 带本地化标签）。
  const candidateValues = renderer.findByTestId('quota-add-provider').children.flat(Infinity).map((option) => option.props.value)
  assert.deepEqual(candidateValues, ['', 'opencode-go', 'zai-coding-cn'])
  const addKindValues = renderer.findByTestId('quota-add-kind').children.flat(Infinity).map((option) => option.props.value)
  assert.deepEqual(addKindValues, ['', 'opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow', 'deepseek', 'stepfun', 'stepfun-step-plan', 'xiaomi-token-plan-cn', 'cliproxy', 'command-goat'])
  assert.match(text, /智谱 GLM Coding Plan/)
  assert.equal(renderer.findByTestId('quota-add-submit').props.disabled, true)
  // 「配置」未展开时重置卡行不挂「移除」钮；展开后才出现（平时不出现破坏性按钮）。
  assert.equal(renderer.hasTest('quota-remove-openrouter-or-1'), false)
  // v0.39：类型切换在折叠的「配置」区，先展开 openrouter 卡。
  renderer.findByTestId('quota-advanced-toggle-openrouter').props.onClick()
  await renderer.flush()
  assert.ok(renderer.hasTest('quota-remove-openrouter-or-1'), 'expanding 配置 reveals the per-card remove button')
  // 已适配卡片脚部下拉预选当前 kind。
  assert.equal(renderer.findByTestId('quota-kind-select-openrouter').props.value, 'opencode-go')
  // 已适配行展示窗口与更新时间；每个窗口带独立进度条（无「已用」头条）。
  assert.match(text, /本周.*14%/)
  // 自动推断的行带「自动识别」标签。
  assert.match(text, /自动识别/)
  assert.ok(renderer.hasTest('quota-auto-tag-openrouter'))
  assert.equal(renderer.findByTestId('quota-card-bar-openrouter-weekly').children[0].props.style.width, '14%')
  assert.equal(renderer.hasTest('quota-card-reset-openrouter-weekly'), false) // fixture 无 resetsAt → 不显示重置行
  // 手录重置卡行（v0.20 免次数）：行首卡片 SVG + 标题/到期两段。
  const cardLine = renderer.findByTestId('quota-reset-card-openrouter-or-1')
  assert.equal(cardLine.children[0].type, 'svg', 'each reset card row starts with the card icon')
  assert.equal(cardLine.children[0].props['aria-hidden'], true)
  // 重置卡区域的可辨识度：图标染绿（类别锚点），文字保持中性可读，不再两者同色。
  assert.equal(cardLine.children[0].props.stroke, 'var(--dsw-alias-state-success-primary)')
  assert.equal(cardLine.props.style.color, 'var(--dsw-alias-label-secondary)')
  assert.equal(String(cardLine.children[1].children[0].children), '重置卡 · 周额度重置卡')
  assert.equal(String(cardLine.children[1].children[1].children), '2099-06-01 到期')

  // 手动适配行选 opencode-go → quota-config 双白名单校验后保存并刷新成卡。
  renderer.findByTestId('quota-add-provider').props.onChange({ target: { value: 'opencode-go' } })
  await renderer.flush()
  renderer.findByTestId('quota-add-kind').props.onChange({ target: { value: 'opencode-go' } })
  await renderer.flush()
  assert.equal(renderer.findByTestId('quota-add-submit').props.disabled, false)
  renderer.findByTestId('quota-add-submit').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(configCalls, [{ provider: 'opencode-go', kind: 'opencode-go' }])
  assert.ok(renderer.hasTest('quota-provider-card-opencode-go'))
  // 官网用量页链接（用户点名）：opencode-go 标题即外链。
  assert.equal(renderer.findByTestId('quota-usage-link-opencode-go').props.href, 'https://opencode.ai/')
  assert.ok(renderer.hasTest('quota-add-adapt')) // zai 仍未适配，手动适配行保留
  const restCandidates = renderer.findByTestId('quota-add-provider').children.flat(Infinity).map((option) => option.props.value)
  assert.deepEqual(restCandidates, ['', 'zai-coding-cn']) // 已适配的 opencode-go 从候选中移除
  assert.match(renderer.text('settings.section'), /滚动 5 小时.*3%/)
  // 卡片窗口行同样三段式：进度条 + 重置时间单独一行。
  assert.equal(renderer.findByTestId('quota-card-bar-opencode-go-rolling').children[0].props.style.width, '3%')
  assert.equal(String(renderer.findByTestId('quota-card-reset-opencode-go-rolling').children[0]), '重置于 2 小时 5 分钟')

  // 拒绝分支透出稳定错误文案（zai 未放行时经手动适配行提交）。
  renderer.findByTestId('quota-add-provider').props.onChange({ target: { value: 'zai-coding-cn' } })
  await renderer.flush()
  renderer.findByTestId('quota-add-kind').props.onChange({ target: { value: 'opencode-go' } })
  await renderer.flush()
  renderer.findByTestId('quota-add-submit').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /未知供应商/)
  assert.ok(renderer.hasTest('quota-add-adapt')) // 失败后 zai 仍是候选

  // 自动查询已整块移除：卡片顶部不再有轮询档位下拉，也不写旧 localStorage 键。
  assert.equal(renderer.hasTest('quota-poll-select'), false)
  assert.equal(localStorage.getItem('dsh-service-quota-poll'), null)
  assert.equal(renderer.pendingTimerDelays().some((delay) => delay === 60000 || delay === 120000 || delay === 300000), false)

  // 「额度查询」是独立标签：切回「模型统计」不再出现额度卡。
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('remote-quota-card'), false)
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()

  // 左列入口开关：默认关；开启注册 settings.section 条目（order 498），再关即注销。
  // 开关与「额度查询」标题同一行，说明行（去掉「默认关闭；」前缀）紧贴开关之前。
  const navSwitch = renderer.findByTestId('quota-nav-switch')
  assert.equal(navSwitch.props['aria-checked'], 'false')
  assert.equal(navSwitch.props['aria-label'], '设置页左列显示「额度查询」入口')
  assert.match(renderer.text('settings.section'), /开启后在设置页左侧标签列底部显示「额度查询」快捷入口/)
  assert.doesNotMatch(renderer.text('settings.section'), /默认关闭；/)
  // 开关与标题同一行：两者是同一个 flex 行的直接子节点。
  const titleRow = renderer.findByTestId('remote-quota-card').children.find(
    (child) => child.props?.style?.display === 'flex'
      && String(child.props.style.justifyContent) === 'space-between'
      && JSON.stringify(child).includes('设置页左列显示「额度查询」入口'),
  )
  assert.ok(titleRow, 'the quota nav switch must sit on the card title row')
  assert.equal(titleRow.props.style.alignItems, 'center')
  assert.equal(renderer.registrations()['settings.section'].some((entry) => entry.id === 'dsh-service-quota'), false)
  navSwitch.props.onClick()
  await renderer.flush()
  assert.equal(localStorage.getItem('dsh-service-shortcut-quota'), 'true')
  assert.equal(renderer.findByTestId('quota-nav-switch').props['aria-checked'], 'true')
  const navEntry = renderer.registrations()['settings.section'].find((entry) => entry.id === 'dsh-service-quota')
  assert.ok(navEntry)
  assert.equal(navEntry.order, 498)
  // 重渲染后旧节点闭包失效：二次关闭前重新取当前 switch 节点。
  renderer.findByTestId('quota-nav-switch').props.onClick()
  await renderer.flush()
  assert.equal(renderer.registrations()['settings.section'].some((entry) => entry.id === 'dsh-service-quota'), false)

  // 重置卡内联表单仅 zai-coding-cn 行提供；openrouter（kind 非 zai）无入口。
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-card-edit-openrouter'), false)

  // 放行后经手动适配行选择 zai-coding-cn：出现「添加重置卡」入口（完整文字独占一行）。
  allowZaiConfig = true
  renderer.findByTestId('quota-add-provider').props.onChange({ target: { value: 'zai-coding-cn' } })
  await renderer.flush()
  renderer.findByTestId('quota-add-kind').props.onChange({ target: { value: 'zai-coding-cn' } })
  await renderer.flush()
  renderer.findByTestId('quota-add-submit').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.ok(renderer.hasTest('quota-provider-card-zai-coding-cn'))
  // v0.39：手录重置入口在折叠的「配置」区，先展开 zai 卡。
  renderer.findByTestId('quota-advanced-toggle-zai-coding-cn').props.onClick()
  await renderer.flush()
  const addCardTrigger = renderer.findByTestId('quota-card-edit-zai-coding-cn')
  assert.match(String(addCardTrigger.children[0]), /添加重置卡/)
  assert.deepEqual(cardCalls, [])

  // 打开表单：只有到期日期与名称两个字段，无次数输入；空表单也可直接添加。
  addCardTrigger.props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-reset-input-count'), false)
  assert.equal(renderer.findByTestId('quota-reset-input-date').props.type, 'datetime-local')
  assert.equal(renderer.findByTestId('quota-reset-input-date').props.value, '')
  assert.equal(renderer.findByTestId('quota-reset-input-name').props.value, '')
  renderer.findByTestId('quota-reset-input-date').props.onChange({ target: { value: '2026-09-30T08:00' } })
  await renderer.flush()
  renderer.findByTestId('quota-reset-input-name').props.onChange({ target: { value: '周额度重置卡' } })
  await renderer.flush()
  renderer.findByTestId('quota-reset-card-save').props.onClick()
  await renderer.flush()
  // 载荷免次数；成功后表单清空但保持打开，方便连续追加。
  assert.deepEqual(cardCalls, [{ provider: 'zai-coding-cn', expiresAt: '2026-09-30T08:00', label: '周额度重置卡' }])
  assert.ok(renderer.hasTest('quota-reset-editor-zai-coding-cn'))
  assert.equal(renderer.findByTestId('quota-reset-input-date').props.value, '')
  assert.equal(renderer.findByTestId('quota-reset-input-name').props.value, '')
  assert.ok(renderer.hasTest('quota-reset-card-zai-coding-cn-rc-1'))

  // 第二条只填到期时间：一行一张，可重复添加。
  renderer.findByTestId('quota-reset-input-date').props.onChange({ target: { value: '2099-01-01' } })
  await renderer.flush()
  renderer.findByTestId('quota-reset-card-save').props.onClick()
  await renderer.flush()
  assert.deepEqual(cardCalls[1], { provider: 'zai-coding-cn', expiresAt: '2099-01-01' })
  assert.ok(renderer.hasTest('quota-reset-card-zai-coding-cn-rc-1'))
  assert.ok(renderer.hasTest('quota-reset-card-zai-coding-cn-rc-2'))
  const secondLineTexts = renderer.findByTestId('quota-reset-card-zai-coding-cn-rc-1').children.filter((child) => child != null)
  assert.equal(secondLineTexts[0].type, 'svg')
  assert.equal(String(secondLineTexts[1].children[0].children), '重置卡 · 周额度重置卡')
  assert.equal(String(secondLineTexts[1].children[1].children), '2026-09-30 08:00 到期')

  // 取消关闭表单。
  renderer.findByTestId('quota-reset-cancel').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-reset-editor-zai-coding-cn'), false)

  // 逐条移除：按宿主下发 id 只删那一条。
  renderer.findByTestId('quota-remove-zai-coding-cn-rc-1').props.onClick()
  await renderer.flush()
  assert.deepEqual(cardCalls[2], { provider: 'zai-coding-cn', remove: true, id: 'rc-1' })
  assert.equal(renderer.hasTest('quota-reset-card-zai-coding-cn-rc-1'), false)
  assert.ok(renderer.hasTest('quota-reset-card-zai-coding-cn-rc-2'))

  // 卡片脚部「跟随自动识别」：发 clear:true，卡片保留且自动识别标签点亮。
  renderer.findByTestId('quota-kind-select-zai-coding-cn').props.onChange({ target: { value: '__auto__' } })
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(configCalls[configCalls.length - 1], { provider: 'zai-coding-cn', clear: true })
  assert.ok(renderer.hasTest('quota-provider-card-zai-coding-cn'))
  assert.ok(renderer.hasTest('quota-auto-tag-zai-coding-cn'))

  // 「停用查询」：发 kind:null，卡片消失且回到手动适配候选（解决「选错了怎么改回」）。
  renderer.findByTestId('quota-kind-select-zai-coding-cn').props.onChange({ target: { value: '' } })
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(configCalls[configCalls.length - 1], { provider: 'zai-coding-cn', kind: null })
  assert.equal(renderer.hasTest('quota-provider-card-zai-coding-cn'), false)
  const backCandidates = renderer.findByTestId('quota-add-provider').children.flat(Infinity).map((option) => option.props.value)
  assert.ok(backCandidates.includes('zai-coding-cn'))
})

test('quota cards support manual reordering persisted in localStorage', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  let snapshotProviders = [
    { provider: 'zai-row', displayName: '智谱', adapted: true, kind: 'zai-coding-cn', refreshing: false, status: 'ok', windows: [{ id: 'rolling', percent: 3 }], fetchedAt: Date.now(), usageUrl: 'https://open.bigmodel.cn/coding-plan/personal/usage' },
    { provider: 'kimi-row', displayName: 'Kimi', adapted: true, kind: 'kimi', refreshing: false, status: 'ok', windows: [{ id: 'balance', text: '¥12.34' }], fetchedAt: Date.now() },
    { provider: 'sf-row', displayName: '硅基流动', adapted: true, kind: 'siliconflow', refreshing: false, status: 'ok', windows: [{ id: 'balance', text: '¥8.00' }], fetchedAt: Date.now() },
  ]
  const buildQuotaResponse = () => ({ ok: true, value: { serverTime: Date.now(), providers: snapshotProviders } })
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') return buildQuotaResponse()
    if (endpoint === 'quota-refresh') return { ok: true }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const cardOrder = () => renderer.findByTestId('quota-card-list').children.flat(Infinity).map((child) => child.props['data-testid'])
  const panelOrder = () => renderer.findByTestId('quota-card-order-list').children.flat(Infinity).map((child) => child.props['data-testid'])
  // 官网用量页链接：zai 卡标题为外链（新标签页），kimi 未登记无链接。
  const zaiLink = renderer.findByTestId('quota-usage-link-zai-row')
  assert.equal(zaiLink.props.href, 'https://open.bigmodel.cn/coding-plan/personal/usage')
  assert.equal(zaiLink.props.target, '_blank')
  assert.equal(renderer.hasTest('quota-usage-link-kimi-row'), false)
  // 初始为快照序。
  assert.deepEqual(cardOrder(), ['quota-provider-card-zai-row', 'quota-provider-card-kimi-row', 'quota-provider-card-sf-row'])
  // 默认收起：无管理列表；≥2 张卡才显示「调整排序与显隐」开关，点击后列表才出现。
  assert.equal(renderer.hasTest('quota-card-order-panel'), false)
  assert.equal(renderer.hasTest('quota-reorder-toggle'), true)
  renderer.findByTestId('quota-reorder-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('quota-reorder-toggle').props['aria-expanded'], 'true')
  assert.deepEqual(panelOrder(), ['quota-card-order-item-zai-row', 'quota-card-order-item-kimi-row', 'quota-card-order-item-sf-row'])
  // 进入管理列表后：首项↑、末项↓禁用；卡片头部不再常驻箭头。
  assert.equal(renderer.findByTestId('quota-card-order-up-zai-row').props.disabled, true)
  assert.equal(renderer.findByTestId('quota-card-order-down-zai-row').props.disabled, false)
  assert.equal(renderer.findByTestId('quota-card-order-down-sf-row').props.disabled, true)
  assert.equal(renderer.hasTest('quota-move-up-zai-row'), false)
  // ↓ 换位立即生效并整体落盘。
  renderer.findByTestId('quota-card-order-down-zai-row').props.onClick({ stopPropagation: () => {} })
  await renderer.flush()
  assert.deepEqual(cardOrder(), ['quota-provider-card-kimi-row', 'quota-provider-card-zai-row', 'quota-provider-card-sf-row'])
  assert.deepEqual(JSON.parse(localStorage.getItem('dsh-service-quota-card-order')), ['kimi-row', 'zai-row', 'sf-row'])
  assert.equal(renderer.findByTestId('quota-card-order-up-kimi-row').props.disabled, true)
  // 显隐开关：关掉 kimi 后卡片列表不再渲染它，管理列表仍保留该行（开关是「可见」态）。
  renderer.findByTestId('quota-card-order-toggle-kimi-row').props.onClick({ stopPropagation: () => {} })
  await renderer.flush()
  assert.deepEqual(cardOrder(), ['quota-provider-card-zai-row', 'quota-provider-card-sf-row'])
  assert.deepEqual(JSON.parse(localStorage.getItem('dsh-service-quota-card-hidden')), ['kimi-row'])
  assert.equal(renderer.findByTestId('quota-card-order-toggle-kimi-row').props['aria-checked'], 'false')
  assert.deepEqual(panelOrder(), ['quota-card-order-item-kimi-row', 'quota-card-order-item-zai-row', 'quota-card-order-item-sf-row'])
  // 全部隐藏：卡片列表整体让位给提示行，管理列表照常可操作（否则等于把自己锁死）。
  renderer.findByTestId('quota-card-order-toggle-zai-row').props.onClick({ stopPropagation: () => {} })
  await renderer.flush()
  renderer.findByTestId('quota-card-order-toggle-sf-row').props.onClick({ stopPropagation: () => {} })
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-card-list'), false)
  assert.ok(renderer.hasTest('quota-cards-all-hidden'))
  // 恢复默认排序：清空两个 localStorage 键并复位展示。
  renderer.findByTestId('quota-card-order-reset').props.onClick()
  await renderer.flush()
  assert.equal(localStorage.getItem('dsh-service-quota-card-order'), null)
  assert.equal(localStorage.getItem('dsh-service-quota-card-hidden'), null)
  assert.deepEqual(cardOrder(), ['quota-provider-card-zai-row', 'quota-provider-card-kimi-row', 'quota-provider-card-sf-row'])
  assert.ok(renderer.hasTest('quota-card-order-saved'))
  // 保存按钮：把当前管理列表整体落盘。
  renderer.findByTestId('quota-card-order-down-zai-row').props.onClick({ stopPropagation: () => {} })
  await renderer.flush()
  renderer.findByTestId('quota-card-order-save').props.onClick()
  await renderer.flush()
  assert.deepEqual(JSON.parse(localStorage.getItem('dsh-service-quota-card-order')), ['kimi-row', 'zai-row', 'sf-row'])
  // 快照里新出现的供应商即使排宿主清单第一位，也追加在记忆序之后。
  snapshotProviders = [
    { provider: 'openrouter-row', displayName: 'OpenRouter', adapted: true, kind: 'openrouter', refreshing: false, status: 'ok', windows: [{ id: 'credits', percent: 25 }], fetchedAt: Date.now() },
    ...snapshotProviders,
  ]
  renderer.findByTestId('quota-refresh-kimi-row').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(cardOrder(), ['quota-provider-card-kimi-row', 'quota-provider-card-zai-row', 'quota-provider-card-sf-row', 'quota-provider-card-openrouter-row'])
  // 再点一次收起管理列表；只剩一张卡时「调整排序与显隐」开关整体消失。
  renderer.findByTestId('quota-reorder-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-card-order-panel'), false)
  snapshotProviders = [snapshotProviders.find((row) => row.provider === 'kimi-row')]
  renderer.findByTestId('quota-refresh-kimi-row').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-reorder-toggle'), false)
})

test('quota card order: backend sync, retry after failure, and local migration', async () => {
  const rpcCalls = []
  let configGetShouldFail = true
  let configSetShouldFail = false
  let remoteConfig = { order: ['sf-row', 'zai-row'], hidden: ['kimi-row'] }
  const providers = [
    { provider: 'zai-row', displayName: '智谱', adapted: true, kind: 'zai-coding-cn', refreshing: false, status: 'ok', windows: [{ id: 'rolling', percent: 3 }], fetchedAt: Date.now() },
    { provider: 'kimi-row', displayName: 'Kimi', adapted: true, kind: 'kimi', refreshing: false, status: 'ok', windows: [{ id: 'balance', text: '¥12.34' }], fetchedAt: Date.now() },
    { provider: 'sf-row', displayName: '硅基流动', adapted: true, kind: 'siliconflow', refreshing: false, status: 'ok', windows: [{ id: 'balance', text: '¥8.00' }], fetchedAt: Date.now() },
  ]
  const syncRpc = async (channel, endpoint, payload) => {
    rpcCalls.push({ endpoint, payload })
    if (endpoint === 'config-get') {
      if (configGetShouldFail) throw new Error('host restarting')
      return { ok: true, value: remoteConfig }
    }
    if (endpoint === 'config-set') {
      if (configSetShouldFail) throw new Error('host restarting')
      remoteConfig = payload.value
      return { ok: true, value: remoteConfig }
    }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers } }
    return testSettingsNavRpc(channel, endpoint)
  }
  const openQuotaPage = async (renderer) => {
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()
    await renderer.flush()
  }
  const cardOrder = (renderer) => renderer.findByTestId('quota-card-list').children.flat(Infinity).map((child) => child.props['data-testid'])
  const configCalls = () => rpcCalls.filter((call) => call.endpoint === 'config-set' && call.payload?.section === 'quotaCards')

  // 1. 首次拉取失败（宿主重启窗口）：本地配置保留、照常渲染，后端值不覆盖。
  const renderer = createRenderer(syncRpc, {
    initialStorage: { 'dsh-service-quota-card-order': JSON.stringify(['kimi-row', 'zai-row', 'sf-row']) },
  })
  await renderer.load()
  await openQuotaPage(renderer)
  assert.ok(rpcCalls.some((call) => call.endpoint === 'config-get' && call.payload?.section === 'quotaCards'), 'entering the quota page must pull the backend card config')
  assert.deepEqual(
    JSON.parse(localStorage.getItem('dsh-service-quota-card-order')),
    ['kimi-row', 'zai-row', 'sf-row'],
    'local config must survive a failed backend pull',
  )
  assert.deepEqual(cardOrder(renderer), ['quota-provider-card-kimi-row', 'quota-provider-card-zai-row', 'quota-provider-card-sf-row'])

  // 2. 重新进入额度页时重试成功：后端为权威事实源，覆盖本地。
  configGetShouldFail = false
  renderer.unmount('settings.section')
  renderer.mount('settings.section')
  await openQuotaPage(renderer)
  assert.deepEqual(JSON.parse(localStorage.getItem('dsh-service-quota-card-order')), ['sf-row', 'zai-row'])
  assert.deepEqual(JSON.parse(localStorage.getItem('dsh-service-quota-card-hidden')), ['kimi-row'])
  assert.deepEqual(cardOrder(renderer), ['quota-provider-card-sf-row', 'quota-provider-card-zai-row'])

  // 3. 写后端失败挂 pending：下次进入额度页自动重推本地已生效配置。
  rpcCalls.length = 0
  configSetShouldFail = true
  renderer.findByTestId('quota-reorder-toggle').props.onClick()
  await renderer.flush()
  renderer.findByTestId('quota-card-order-down-sf-row').props.onClick({ stopPropagation: () => {} })
  await renderer.flush()
  assert.equal(configCalls().length, 1, 'failed write still attempted once')
  // 隐藏的卡片仍留在排序名单里（与设置栏标签同款：显隐与顺序是两份独立名单），只是不渲染。
  assert.deepEqual(configCalls()[0].payload.value, { order: ['zai-row', 'sf-row', 'kimi-row'], hidden: ['kimi-row'] })

  configSetShouldFail = false
  renderer.unmount('settings.section')
  renderer.mount('settings.section')
  await openQuotaPage(renderer)
  assert.equal(configCalls().length, 2, 'pending write should be re-pushed on next quota page entry')
  assert.deepEqual(configCalls()[1].payload.value, { order: ['zai-row', 'sf-row', 'kimi-row'], hidden: ['kimi-row'] }, 're-pushed value must match the locally applied config')

  // 4. 本地已有历史配置而后端为空 → 首次自动迁移；且只动自己的区块。
  rpcCalls.length = 0
  remoteConfig = null
  const migrateRenderer = createRenderer(syncRpc, {
    initialStorage: {
      'dsh-service-quota-card-order': JSON.stringify(['zai-row', 'sf-row', 'kimi-row']),
      'dsh-service-quota-card-hidden': JSON.stringify(['sf-row']),
    },
  })
  await migrateRenderer.load()
  await openQuotaPage(migrateRenderer)
  const migrateCall = configCalls()[0]
  assert.ok(migrateCall, 'local quota card config should auto-migrate to the backend')
  assert.deepEqual(migrateCall.payload.value, { order: ['zai-row', 'sf-row', 'kimi-row'], hidden: ['sf-row'] })
  // 迁移只写 quotaCards 区块：卡片配置绝不落到设置栏标签区块（后者另有自己的拉取/重置逻辑）。
  assert.equal(
    rpcCalls.some((call) => call.endpoint === 'config-set' && call.payload?.section === 'settingsNav' && call.payload.value !== null),
    false,
  )
})


test('deepseek balance card shows a peak/off-peak timeline following Beijing time', async () => {
  // 固定时刻驱动（Date.now 覆盖 + ctx.timer 桩推进）：周三 10:30 北京时间 = UTC 02:30，处于高峰中段。
  const wednesdayPeak = Date.UTC(2026, 0, 7, 2, 30)
  const realNow = Date.now
  Date.now = () => wednesdayPeak
  try {
    const deepseekWindows = [
      { id: 'balance-cny', text: '¥110.00', label: 'CNY', kindKey: 'balance' },
      { id: 'granted-cny', text: '¥10.00', label: 'CNY', kindKey: 'granted-balance' },
    ]
    const renderer = createRenderer(async (channel, endpoint) => {
      if (endpoint === 'version') return { ok: true, value: { current: '0.25.0', instanceId: 'x' } }
      if (endpoint === 'quota') {
        return {
          ok: true,
          value: {
            providers: [
              { provider: 'ds-official', displayName: 'DeepSeek 官方', adapted: true, kind: 'deepseek', refreshing: false, status: 'ok', windows: deepseekWindows, fetchedAt: wednesdayPeak },
              { provider: 'kimi-row', displayName: 'Kimi', adapted: true, kind: 'kimi', refreshing: false, status: 'ok', windows: [{ id: 'balance', text: '¥1.00' }], fetchedAt: wednesdayPeak },
            ],
            serverTime: wednesdayPeak,
          },
        }
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    await renderer.load()
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()

    // 余额行：currency 作 label 与本地化窗口名拼接；赠金 > 0 追加一行。
    const text = renderer.text('settings.section')
    assert.match(text, /CNY · 余额/)
    assert.match(text, /¥110\.00/)
    assert.match(text, /CNY · 赠送余额（未过期）/)
    assert.match(text, /¥10\.00/)
    // 峰谷块只出现在 deepseek 卡上。
    assert.ok(renderer.hasTest('quota-provider-card-ds-official'))
    assert.ok(renderer.hasTest('quota-provider-card-kimi-row'))
    assert.ok(renderer.hasTest('quota-peak-timeline')) // 只有 deepseek 卡渲染峰谷块：全页仅一份（分段数 5 可证）

    // 高峰状态徽标；倒计时指向 12:00 转空闲（90 分钟）。
    const stateNode = renderer.findByTestId('quota-peak-state')
    assert.equal(stateNode.props['data-in-peak'], 'true')
    const nextNode = renderer.findByTestId('quota-peak-next')
    assert.match(String(nextNode.children[0]), /12:00 转空闲（1 小时 30 分钟后）/)
    // 两段式色带（用户点名）：第一段 = 当前时段剩余，第二段 = 下一个相反时段，宽度按实际时长。
    // 周三 10:30 高峰中段：剩余 90 分钟 + 空闲 12-14 的 120 分钟。
    const segments = renderer.findAllByTestIdPrefix('quota-peak-segment-')
    assert.deepEqual(segments.map((segment) => segment.props['data-peak']), ['true', 'false'])
    assert.equal(segments[0].props.style.left, '0%')
    assert.equal(segments[0].props.style.width, '42.8571%') // 90 / 210
    assert.equal(segments[1].props.style.left, '42.8571%')
    assert.equal(segments[1].props.style.width, '57.1429%') // 120 / 210
    // 段内只标「忙时/闲时」短词（精确时刻在倒计时与说明行）。
    assert.deepEqual(segments.map((segment) => String(segment.children[0].children[0])), ['忙时', '闲时'])
    // 左缘「当前」标线取代旧移动圆点（now 起点域下圆点恒在左缘）。
    assert.ok(renderer.hasTest('quota-peak-now'))
    assert.equal(renderer.hasTest('quota-peak-dot'), false)
    assert.equal(renderer.findAllByTestIdPrefix('quota-peak-axis-').length, 0)
    // 卡片内带规则说明行（时间措辞为「9点–12点」式，用户点名）。
    assert.match(renderer.text('settings.section'), /空闲时段价格为高峰时段的一半。高峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00；其余时间为空闲时段，周六和周日全天空闲。/)

    // 切到周六 15:00 北京时间（UTC 07:00）：全天空闲——单条绿色分段、圆点 62.5%、下一个换挡是周一 09:00。
    Date.now = () => Date.UTC(2026, 0, 10, 7, 0)
    renderer.advanceTimer(30000)
    await renderer.flush()
    assert.equal(renderer.findByTestId('quota-peak-state').props['data-in-peak'], 'false')
    const weekendSegments = renderer.findAllByTestIdPrefix('quota-peak-segment-')
    // 周六 15:00 闲时：第一段跨周末到周一 9 点（93.33%），第二段是周一 9-12 忙时（6.67%，过窄不标字）。
    assert.deepEqual(weekendSegments.map((segment) => segment.props['data-peak']), ['false', 'true'])
    assert.equal(weekendSegments[0].props.style.width, '93.3333%')
    assert.equal(String(weekendSegments[0].children[0].children[0]), '闲时')
    assert.equal(weekendSegments[1].props.style.width, '6.6667%')
    assert.deepEqual(weekendSegments[1].children.filter(Boolean), [])
    assert.match(String(renderer.findByTestId('quota-peak-next').children[0]), /09:00 转高峰（1 天 18 小时后）/)
  } finally {
    Date.now = realNow
  }
})

test('zai-coding-cn card shows its own peak/off-peak timeline (weekdays 14:00–18:00 UTC+8)', async () => {
  // 固定时刻驱动（Date.now 覆盖 + ctx.timer 桩推进）：智谱 GLM Coding Plan 高峰 = 周一至周五
  // 14:00–18:00（北京时间）。场景一：周三 15:00 北京 = UTC 07:00，高峰中段。
  const realNow = Date.now
  Date.now = () => Date.UTC(2026, 0, 7, 7, 0)
  try {
    const wednesdayPeak = Date.UTC(2026, 0, 7, 7, 0)
    const renderer = createRenderer(async (channel, endpoint) => {
      if (endpoint === 'version') return { ok: true, value: { current: '1.3.0', instanceId: 'x' } }
      if (endpoint === 'quota') {
        return {
          ok: true,
          value: {
            providers: [
              { provider: 'zai-row', displayName: '智谱', adapted: true, kind: 'zai-coding-cn', refreshing: false, status: 'ok', windows: [{ id: 'rolling', percent: 11 }], fetchedAt: wednesdayPeak },
              { provider: 'kimi-row', displayName: 'Kimi', adapted: true, kind: 'kimi', refreshing: false, status: 'ok', windows: [{ id: 'balance', text: '¥1.00' }], fetchedAt: wednesdayPeak },
            ],
            serverTime: wednesdayPeak,
          },
        }
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    await renderer.load()
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()

    // 忙时状态徽标；换挡倒计时指向 18:00 转空闲（3 小时）。
    assert.ok(renderer.hasTest('quota-provider-card-zai-row'))
    assert.equal(renderer.findByTestId('quota-peak-state').props['data-in-peak'], 'true')
    assert.match(String(renderer.findByTestId('quota-peak-next').children[0]), /18:00 转空闲（3 小时后）/)
    // 两段式色带：高峰剩余 180 分钟（13.0435%）+ 闲时到次日 14:00 的 1200 分钟（86.9565%）。
    const segments = renderer.findAllByTestIdPrefix('quota-peak-segment-')
    assert.deepEqual(segments.map((segment) => segment.props['data-peak']), ['true', 'false'])
    assert.equal(segments[0].props.style.width, '13.0435%')
    assert.equal(segments[1].props.style.left, '13.0435%')
    assert.equal(segments[1].props.style.width, '86.9565%')
    assert.deepEqual(segments.map((segment) => String(segment.children[0].children[0])), ['忙时', '闲时'])
    // 规则说明行为 GLM 专属文案（50% 抵扣、14:00–18:00），与 deepseek 说明行同键位不同键。
    assert.match(renderer.text('settings.section'), /非高峰时段模型调用按基础积分的 50% 抵扣。高峰时段：每周一至周五 14:00–18:00（UTC\+8）；其余时间为非高峰时段，周六和周日全天空闲。/)

    // 切到周六 15:00 北京时间（UTC 07:00）：周末全天空闲，下个高峰是周一 14:00。
    Date.now = () => Date.UTC(2026, 0, 10, 7, 0)
    renderer.advanceTimer(30000)
    await renderer.flush()
    assert.equal(renderer.findByTestId('quota-peak-state').props['data-in-peak'], 'false')
    const weekendSegments = renderer.findAllByTestIdPrefix('quota-peak-segment-')
    // 周六 15:00 闲时：第一段跨周末到周一 14 点（2820/3060 = 92.1569%），第二段是周一 14-18 忙时（7.8431%，过窄不标字）。
    assert.deepEqual(weekendSegments.map((segment) => segment.props['data-peak']), ['false', 'true'])
    assert.equal(weekendSegments[0].props.style.width, '92.1569%')
    assert.equal(String(weekendSegments[0].children[0].children[0]), '闲时')
    assert.equal(weekendSegments[1].props.style.width, '7.8431%')
    assert.deepEqual(weekendSegments[1].children.filter(Boolean), [])
    assert.match(String(renderer.findByTestId('quota-peak-next').children[0]), /14:00 转高峰（1 天 23 小时后）/)

    // 切到周三 13:00 北京时间（UTC 05:00）：闲时中段，60 分钟后 14:00 转高峰。
    Date.now = () => Date.UTC(2026, 0, 7, 5, 0)
    renderer.advanceTimer(30000)
    await renderer.flush()
    assert.equal(renderer.findByTestId('quota-peak-state').props['data-in-peak'], 'false')
    const idleSegments = renderer.findAllByTestIdPrefix('quota-peak-segment-')
    assert.deepEqual(idleSegments.map((segment) => segment.props['data-peak']), ['false', 'true'])
    assert.equal(idleSegments[0].props.style.width, '20%') // 60 / 300
    assert.equal(idleSegments[1].props.style.width, '80%') // 240 / 300
    assert.match(String(renderer.findByTestId('quota-peak-next').children[0]), /14:00 转高峰（1 小时后）/)
  } finally {
    Date.now = realNow
  }
})

test('quota card header has a refresh icon that forces per-provider refresh', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const refreshCalls = []
  let quotaCalls = 0
  let refreshing = false
  let pendingSettle = false
  let percent = 5
  const buildQuotaResponse = () => ({
    ok: true,
    value: {
      serverTime: Date.now(),
      providers: [
        { provider: 'zai-coding-cn', displayName: 'zai-coding-cn', adapted: true, kind: 'zai-coding-cn', refreshing, status: 'ok',
          windows: [{ id: 'rolling', percent }], fetchedAt: Date.now() },
      ],
    },
  })
  let quotaResponse = buildQuotaResponse()
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      quotaCalls += 1
      // 手动刷新后的第一次快照仍在途；下一次快照视为上游落定（窗口数值变化可断言）。
      if (pendingSettle) {
        pendingSettle = false
      } else if (refreshing) {
        refreshing = false
        percent = 9
      }
      quotaResponse = buildQuotaResponse()
      return quotaResponse
    }
    if (endpoint === 'quota-refresh') {
      refreshCalls.push(payload)
      refreshing = true
      pendingSettle = true
      quotaResponse = buildQuotaResponse()
      return { ok: true }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /滚动 5 小时.*5%/)

  // 图标在更新时间之前，aria 标记为「刷新」，默认可点；排序模式未开启时头部无 ↑↓（v0.25 收起式排序）。
  const cardRoot = renderer.findByTestId('quota-provider-card-zai-coding-cn')
  const rightCluster = cardRoot.children[0].children[1]
  assert.equal(rightCluster.children[0].props['data-testid'], 'quota-refresh-zai-coding-cn')
  assert.equal(rightCluster.children[0].props['aria-label'], '刷新')
  assert.equal(rightCluster.children[0].props.disabled, false)
  assert.match(String(rightCluster.children[1].children), /更新于/)
  assert.equal(renderer.hasTest('quota-move-up-zai-coding-cn'), false)

  // 点击：发起 quota-refresh 并立即补拉快照；在途期间图标置灰防重入。
  const initialQuotaCalls = quotaCalls
  renderer.findByTestId('quota-refresh-zai-coding-cn').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(refreshCalls, [{ provider: 'zai-coding-cn' }])
  assert.ok(quotaCalls > initialQuotaCalls)
  assert.equal(renderer.findByTestId('quota-refresh-zai-coding-cn').props.disabled, true)

  // 落定接续（fetchQuotaSnapshot 的 settle 补拉）接住上游结果：窗口数值更新、图标恢复可点；
  // 上游落定后 settle 链自动终止，不再有悬空定时器。
  await renderer.advanceTimer(800)
  assert.match(renderer.text('settings.section'), /滚动 5 小时.*9%/)
  assert.equal(renderer.findByTestId('quota-refresh-zai-coding-cn').props.disabled, false)
})

test('quota card falls back to type-level window labels and localizes stable error codes', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [
            {
              // 未登记的窗口形状：完整 id 未命中词典 → 类型前缀（tokens-limit/credit-limit）兜底，绝不直出原始 id。
              provider: 'zai-coding-cn', displayName: 'zai-coding-cn', adapted: true, kind: 'zai-coding-cn', refreshing: false, status: 'ok',
              windows: [
                { id: 'tokens-limit-u9-n2', percent: 30 },
                { id: 'credit-limit-u2-n1', percent: 10, resetsAt: new Date(Date.now() + 3600_000).toISOString() },
              ],
              fetchedAt: Date.now(),
            },
            {
              // 重试耗尽的瞬时网络错误：错误码必须有本地化文案，不再落进「未知错误」。
              provider: 'openrouter', displayName: 'openrouter', adapted: true, kind: 'openrouter', refreshing: false, status: 'error', errorCode: 'network-transient',
            },
          ],
        },
      }
    }
    if (endpoint === 'quota-refresh') return { ok: false, error: 'not-adapted' }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const text = renderer.text('settings.section')
  assert.match(text, /Token 额度.*30%/)
  assert.match(text, /点数额度.*10%/)
  assert.doesNotMatch(text, /tokens-limit-u9-n2/)
  assert.doesNotMatch(text, /credit-limit-u2-n1/)
  assert.match(text, /网络不稳定（已自动重试）/)

  // 卡片渠道名前有厂家小图标：与对话框同源解析，档位决定渲染路径。
  // zhipu 是彩色档（background-image 原样上品牌色）；openrouter 是 mono 档（mask + currentColor）。
  const zaiIcon = renderer.findByTestId('quota-provider-icon-zai-coding-cn')
  assert.equal(zaiIcon.props['data-dshsvc-model-icon'], 'zhipu', 'card icon resolves the provider slug')
  assert.ok(String(zaiIcon.props.style.backgroundImage).startsWith('url("data:image/svg+xml,'), 'color-tier card icon uses background-image')
  assert.equal(zaiIcon.props.style.backgroundRepeat, 'no-repeat')
  const openrouterIcon = renderer.findByTestId('quota-provider-icon-openrouter')
  assert.equal(openrouterIcon.props['data-dshsvc-model-icon'], 'openrouter')
  assert.ok(String(openrouterIcon.props.style.WebkitMask).startsWith('url("data:image/svg+xml,'), 'mono card icon uses the mask data-URI')
  assert.equal(openrouterIcon.props.style.backgroundColor, 'currentColor', 'mono card icon follows the theme text colour')

  // 卡片图标与对话框同受 modelProviderIcons 开关管辖：关闭即全量摘除（不留卡片半截装饰），
  // 重新打开立即回来。这是验收标准「关闭即全量摘除」在卡片这条新增渲染路径上的落实。
  await renderer.setFeature('modelProviderIcons', false)
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-provider-icon-zai-coding-cn'), false, 'disabling the feature removes the color-tier card icon')
  assert.equal(renderer.hasTest('quota-provider-icon-openrouter'), false, 'disabling the feature removes the mono card icon')
  assert.ok(renderer.hasTest('quota-provider-card-zai-coding-cn'), 'the card itself must stay rendered — only the icon is gated')
  await renderer.setFeature('modelProviderIcons', true)
  await renderer.flush()
  assert.ok(renderer.hasTest('quota-provider-icon-zai-coding-cn'), 're-enabling restores the card icon')
  assert.ok(renderer.hasTest('quota-provider-icon-openrouter'), 're-enabling restores the mono card icon')

  // quota-refresh 拒绝（not-adapted）也走词典，不再直出原始键名 quota.unadapted。
  renderer.findByTestId('quota-refresh-zai-coding-cn').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /未适配/)
  assert.doesNotMatch(renderer.text('settings.section'), /quota\.unadapted/)
})

test('quota auto and hidden polling request only running-session providers while the quota page requests all providers', async () => {
  const storeA = {
    getSnapshot: () => ({ current: { provider: 'opencode-go' } }),
    subscribe: () => () => {},
  }
  const storeB = {
    getSnapshot: () => ({ current: { provider: 'openrouter' } }),
    subscribe: () => () => {},
  }
  const modelDirectories = {
    directoryFor(sessionId) {
      return { store: sessionId === 'running-b' ? storeB : storeA, load: () => Promise.resolve() }
    },
  }
  const quotaPayloads = []
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      quotaPayloads.push(payload)
      return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories })
  renderer.setSessions({
    'running-a': { id: 'running-a', running: true },
    'running-b': { id: 'running-b', running: true },
    idle: { id: 'idle', running: false },
  })
  await renderer.load()
  await renderer.flush()
  assert.ok(quotaPayloads.some((payload) => Array.isArray(payload.providers) && payload.providers.includes('opencode-go')))
  assert.ok(quotaPayloads.some((payload) => Array.isArray(payload.providers) && payload.providers.includes('openrouter')))
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  assert.ok(quotaPayloads.some((payload) => payload.scope === 'all'))
})

test('quota queries are manual-only: no periodic timer is ever armed, and a running session does not start one', async () => {
  class FakeMutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    visibilityState: 'hidden',
    addEventListener() {},
    removeEventListener() {},
  }
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const directoryStore = { getSnapshot: () => ({ current: { provider: 'opencode-go' } }), subscribe: () => () => {} }
  let quotaCalls = 0
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      quotaCalls += 1
      return { ok: true, value: { serverTime: Date.now(), providers: [{ provider: 'opencode-go', displayName: 'opencode-go', adapted: true, kind: 'opencode-go', refreshing: false, status: 'ok', windows: [], fetchedAt: Date.now() }] } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { modelDirectories: { directoryFor: () => ({ store: directoryStore, load: () => Promise.resolve() }) } })
  try {
    await renderer.load()
    await renderer.flush()
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()
    // 页面挂载只拉一次快照，不排任何周期定时器。
    const afterOpen = quotaCalls
    assert.ok(afterOpen >= 1, 'opening the quota page must fetch a snapshot once')
    assert.equal(renderer.pendingTimerDelays().some((delay) => delay >= 60000), false, 'no polling timer may be armed')

    // 关闭设置页，只留下会话圆环表面：不排周期表，时间流逝也没有任何外呼。
    renderer.unmount('settings.section')
    await renderer.flush()
    const callsBeforeHiddenIdle = quotaCalls
    assert.equal(renderer.pendingTimerDelays().some((delay) => delay >= 60000), false, 'unmounting must not arm a polling timer')
    assert.equal(quotaCalls, callsBeforeHiddenIdle, 'no background period may fire')

    // agent 启动也不会拉起周期：会话活跃只服务任务通知与活跃供应商集合。
    renderer.setSessions({ s1: { id: 's1', displayTitle: '后台 agent', running: true } })
    await renderer.flush()
    assert.equal(renderer.pendingTimerDelays().some((delay) => delay >= 60000), false, 'a running session must not arm a polling timer')
    assert.equal(quotaCalls, callsBeforeHiddenIdle, 'a running session must not trigger a quota RPC')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

test('settings nav rows get icon markers by localized label and follow text changes', async () => {
  function navButton(text) {
    return {
      textContent: text,
      attrs: new Set(),
      setAttribute(name) { this.attrs.add(name) },
      removeAttribute(name) { this.attrs.delete(name) },
    }
  }
  const navButtons = [
    navButton('服务控制'),
    navButton('额度查询'),
    navButton('重启'),
    navButton('子代理'),
    navButton('通用设置'),
  ]
  const nav = { querySelectorAll(selector) { return selector === 'button' ? navButtons : [] } }

  function assertMarked(button, attr) {
    assert.equal(button.attrs.has(attr), true)
  }
  const observers = []
  const injectedStyles = []
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target, options) { this.target = target; this.options = options }
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {},
    head: { appendChild(el) { injectedStyles.push(el.textContent) } },
    // dataset 必须有：插件给注入的样式表打 data-plugin 归属标记（0.1.6-alpha.2 起加载器
    // 按该标记移除样式），缺了会让样式注入分支抛错、样式表静默不进 injectedStyles。
    createElement() { return { dataset: {} } },
    querySelector(selector) { return selector === '[role="dialog"] nav' ? nav : null },
    querySelectorAll(selector) {
      if (selector === '[role="dialog"] nav button') return navButtons
      const name = selector.slice(1, -1)
      return navButtons.filter((button) => button.attrs.has(name))
    },
    addEventListener() {},
    removeEventListener() {},
  }
  try {
    const renderer = createRenderer(async (channel, endpoint) => {
      assert.equal(channel, '/dsh-service')
      if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
      throw new Error(`unexpected endpoint ${endpoint}`)
    })
    await renderer.load()

    // 首次同步：各行按本地化文案命中并打标；无关行不打。
    // v0.39：技能/子代理左列入口撤销后，只剩四个标记行；「子代理」是无关行不打标。
    const bodyObserver = observers.find((observer) => observer.target === globalThis.document.body && observer.options?.characterData !== true)
    const navObserver = observers.find((observer) => observer.target === nav)
    assert.ok(bodyObserver, 'expected body observer for settings nav discovery')
    assert.ok(navObserver, 'expected scoped settings nav observer')
    assert.deepEqual(bodyObserver.options, { childList: true, subtree: true }, 'settings nav discovery should ignore chat text mutations')
    assert.deepEqual(navObserver.options, { childList: true, subtree: true, characterData: true }, 'localized text changes stay scoped to settings nav')
    assertMarked(navButtons[0], 'data-dsh-service-nav')
    assertMarked(navButtons[1], 'data-dsh-service-quota-nav')
    assertMarked(navButtons[2], 'data-dsh-service-restart-nav')
    assert.equal(navButtons[3].attrs.size, 0)
    assert.equal(navButtons[4].attrs.size, 0)

    // 外壳重渲染（观察器重跑 sync）：文案未变则标记幂等保留。
    navObserver.callback([], undefined)
    assertMarked(navButtons[0], 'data-dsh-service-nav')
    assertMarked(navButtons[1], 'data-dsh-service-quota-nav')

    // 文案不再匹配（行消失/换名）：标记被摘除，不会残留到别的行。
    navButtons[2].textContent = '别人的同名行'
    for (const observer of observers) observer.callback([], undefined)
    assert.equal(navButtons[2].attrs.size, 0)

    // CSS 已随 load 注入：齿轮隐藏规则 + 各条 data 标记的 mask 规则齐全。
    const sheet = injectedStyles.join('')
    assert.ok(sheet.includes('[data-dsh-service-nav]>svg:first-child'), 'gear-hiding rule missing')
    for (const attr of ['data-dsh-service-nav', 'data-dsh-service-quota-nav', 'data-dsh-service-restart-nav']) {
      assert.ok(sheet.includes('[' + attr + ']::before'), attr + ' icon rule missing')
      assert.ok(sheet.includes('mask:url("data:image/svg+xml,'), attr + ' mask data URI missing')
    }
    assert.ok(sheet.includes('%3Crect width=%2720%27 height=%278%27'), 'service nav icon must serialize server rack rect')
    // 撤销入口的选择器不残留。
    assert.equal(sheet.includes('data-dsh-service-skills-nav'), false, 'skills nav selector must be gone')
    assert.equal(sheet.includes('data-dsh-service-subagent-nav'), false, 'subagent nav selector must be gone')
    // v0.39 令牌链铁律二：主题相关令牌必须锚在 body（:root 上声明的 var() 链会在根元素
    // 被浅色值定格，暗色覆盖失效——真机翻过车）。几何令牌（静态）不受此限。
    // 内容画布浅色 = 固定浅灰（用户点名：内容区灰色），深色 = 别名优先的暗底。
    assert.ok(sheet.includes('body{--dsh-svc-page-bg:#f4f5f7'), 'light theme tokens must anchor on body')
    assert.ok(sheet.includes('body[data-ds-dark-theme]{--dsh-svc-page-bg:var(--dsw-alias-bg-layer-1,#17181c)'), 'dark theme tokens must re-anchor on body')
    assert.ok(sheet.includes('body{--dsh-svc-surface-bg:var(--dsh-svc-card-bg)'), 'compat alias chain must anchor on body')
    assert.ok(sheet.includes('body{--dsh-svc-card-bg:#eceef1}') && sheet.includes('body[data-ds-dark-theme]{--dsh-svc-card-bg:var(--dsw-alias-bg-layer-2,#202126)}'), 'card tint must be plugin-fixed in light and page-level in dark')
    assert.equal(/:root\{--dsh-svc-(page|content|raised|text|border|surface|tab-active)/.test(sheet), false, 'theme tokens must not be declared on :root')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

// ─── v0.22 技能管理 ──────────────────────────────────────────────────────────

function createSkillsRpcFixture() {
  const state = {
    entries: [
      { id: 'id-alpha', name: 'alpha', description: 'Alpha desc', usage: '', invocation: { model: true, user: true }, source: 'project-dsh', writable: true, shadowed: false, annotated: false },
      { id: 'id-beta', name: 'beta', description: 'Beta desc', usage: 'Use beta', invocation: { model: false, user: true }, source: 'user-agents', writable: true, shadowed: false, annotated: false },
      { id: 'id-gamma', name: 'gamma', description: 'Gamma desc', usage: '', invocation: { model: false, user: false }, source: 'bundled', writable: false, shadowed: false, annotated: true },
      { id: 'id-delta', name: 'delta', description: 'Delta desc', usage: '', invocation: { model: true, user: true }, source: 'user-agents', writable: true, shadowed: false, invalid: 'legacy-invocation-key:modelInvocable', annotated: false },
    ],
    toggles: [],
    fixes: [],
    applies: [],
    describes: [],
    batchPlans: [],
    batchRuns: [],
    adoptPlanned: false,
    listCalls: 0,
  }
  const clone = (entry) => JSON.parse(JSON.stringify(entry))
  const handler = async (channel, endpoint, payload = {}) => {
    if (endpoint === 'skills-list') {
      state.listCalls += 1
      return { ok: true, value: { roots: [], entries: state.entries.map(clone), llmAvailable: true } }
    }
    if (endpoint === 'skills-toggle') {
      state.toggles.push(payload)
      const entry = state.entries.find((candidate) => candidate.id === payload.id)
      entry.invocation[payload.field] = payload.enable
      return { ok: true, value: { entry: clone(entry) } }
    }
    if (endpoint === 'skills-fix-keys') {
      state.fixes.push(payload)
      const entry = state.entries.find((candidate) => candidate.id === payload.id)
      delete entry.invalid
      return { ok: true, value: { entry: clone(entry) } }
    }
    if (endpoint === 'skills-models') {
      return { ok: true, value: { models: [{ provider: 'p', providerName: 'Prov', id: 'm1', name: 'Model One' }, { provider: 'p', providerName: 'Prov', id: 'm2', name: 'Model Two' }], current: { provider: 'p', model: 'm2' } } }
    }
    if (endpoint === 'skills-describe') {
      state.describes.push(payload)
      return { ok: true, value: { draft: { description: 'AI 描述', usage: 'AI 用法' } } }
    }
    if (endpoint === 'skills-note-save') {
      state.applies.push(payload)
      const entry = state.entries.find((candidate) => candidate.id === payload.id)
      entry.note = { description: payload.patch.description, usage: payload.patch.usage, stale: false }
      entry.annotated = true
      return { ok: true, value: { entry: clone(entry) } }
    }
    if (endpoint === 'skills-describe-log') {
      // 宿主下发结构化 {at, code, params}；本地化由客户端词典渲染。
      return { ok: true, value: { logs: [
        { at: Date.now(), code: 'located', params: { name: 'alpha', chars: 128 } },
        { at: Date.now(), code: 'attempt', params: { n: 1, total: 3, route: 'p/m1' } },
        { at: Date.now(), code: 'parsed', params: {} },
      ] } }
    }
    if (endpoint === 'skills-note-clear') {
      const entry = state.entries.find((candidate) => candidate.id === payload.id)
      delete entry.note
      entry.annotated = false
      return { ok: true, value: { entry: clone(entry) } }
    }
    if (endpoint === 'skills-batch-plan') {
      state.batchPlans.push(payload)
      return { ok: true, value: { planId: 'plan-1', candidates: [{ id: 'id-beta', name: 'beta', source: 'user-agents' }], annotated: [{ id: 'id-alpha', name: 'alpha', source: 'project-dsh' }], skipped: [{ id: 'id-gamma', name: 'gamma', reason: 'missing-frontmatter' }], estBytes: 2048 } }
    }
    if (endpoint === 'skills-batch-run') {
      state.batchRuns.push(payload)
      return { ok: true, value: { started: true, total: 1 } }
    }
    if (endpoint === 'skills-batch-status') {
      if (state.adoptPlanned === true && state.batchRuns.length === 0) {
        return { ok: true, value: { phase: 'planned', total: 2, done: 0, failures: [], current: null, estBytes: 1024, logs: [] } }
      }
      if (state.batchRuns.length === 0) return { ok: true, value: { phase: 'idle', total: 0, done: 0, failures: [], current: null, estBytes: 0, logs: [] } }
      return { ok: true, value: { phase: 'done', total: 1, done: 1, failures: [], current: null, estBytes: 2048, logs: [{ at: Date.now(), name: 'beta', code: 'parsed', params: {} }] } }
    }
    if (endpoint === 'skills-batch-cancel') return { ok: true, value: { phase: 'cancelled' } }
    return null
  }
  return { state, handler }
}

function baseSkillRenderer(rpcFixture, options = {}) {
  return createRenderer(async (channel, endpoint, payload) => {
    const handled = rpcFixture.handler(channel, endpoint, payload)
    if (handled !== null) return handled
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'offline' }
    if (endpoint === 'permissions-plan') return { ok: false, error: 'disabled fixture' }
    if (endpoint === 'health') return { ok: true, value: { uptime: 0, rss: 0, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: false, items: [] } }
    if (endpoint === 'diagnostics') return { ok: true, value: { checks: [], status: 'ok' } }
    if (endpoint === 'quota') return { ok: true, value: { providers: [], serverTime: Date.now() } }
    if (endpoint === 'web') return { ok: true, value: { instanceId: 'new-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, options)
}

test('skills tab renders three groups with badges, filters, and double-confirm toggles', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  assert.equal(renderer.hasTest('skill-entry-alpha'), false)
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()

  assert.equal(renderer.hasTest('skills-section'), true)
  assert.equal(renderer.hasTest('skills-group-auto'), true)
  assert.equal(renderer.hasTest('skills-group-manual'), true)
  assert.equal(renderer.hasTest('skills-group-disabled'), true)
  assert.equal(renderer.findAllByTestIdPrefix('skill-entry-').length, 4)

  // 名称过滤：纯前端，命中 alpha 后其余条目消失。
  renderer.findByTestId('skills-filter').props.onChange({ target: { value: 'alp' } })
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-entry-alpha'), true)
  assert.equal(renderer.hasTest('skill-entry-beta'), false)
  renderer.findByTestId('skills-filter').props.onChange({ target: { value: '' } })
  await renderer.flush()

  // 条目默认折叠：开关在折叠体里，先点开 beta 的头部行才能操作。
  assert.equal(renderer.hasTest('skill-switch-model-beta'), false)
  renderer.findByTestId('skill-header-beta').props.onClick()
  await renderer.flush()

  // 两段式开关：第一击只进入待确认，不发 RPC；第二击才下发 enable=true（点亮模型可见）。
  const betaSwitch = renderer.findByTestId('skill-switch-model-beta')
  assert.equal(betaSwitch.props['aria-checked'], 'false')
  betaSwitch.props.onClick()
  await renderer.flush()
  assert.equal(fixture.state.toggles.length, 0)
  assert.equal(renderer.findByTestId('skill-switch-model-beta').props.title, '再次点击生效')
  renderer.findByTestId('skill-switch-model-beta').props.onClick()
  await renderer.flush()
  assert.deepEqual(fixture.state.toggles, [{ id: 'id-beta', field: 'model', enable: true }])
  assert.equal(renderer.findByTestId('skill-switch-model-beta').props['aria-checked'], 'true')

  // 无效条目组：delta 带 legacy ⚠ 与修复按钮（⚠ 是警告不是细节，折叠态也照常露出）；
  // 修复与开关同款两段式——第一击只进入待确认不发 RPC。
  assert.equal(renderer.hasTest('skills-invalid-group'), true)
  renderer.findByTestId('skill-fix-delta').props.onClick()
  await renderer.flush()
  assert.equal(fixture.state.fixes.length, 0)
  assert.equal(renderer.findByTestId('skill-fix-delta').children.join(''), '再次点击生效')
  // 第二击才真正下发修复；条目转正后无效组消失。
  renderer.findByTestId('skill-fix-delta').props.onClick()
  await renderer.flush()
  assert.deepEqual(fixture.state.fixes, [{ id: 'id-delta' }])
  assert.equal(renderer.hasTest('skills-invalid-group'), false)
})

test('skills list defaults to collapsed entries with a top expand-all toggle', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()

  // 默认全部折叠：折叠体、开关与 ✨ 都不在树里，只剩可点的头部行。
  assert.equal(renderer.hasTest('skill-body-alpha'), false)
  assert.equal(renderer.hasTest('skill-switch-model-alpha'), false)
  assert.equal(renderer.hasTest('skill-describe-alpha'), false)
  assert.equal(renderer.findByTestId('skill-header-alpha').props['aria-expanded'], 'false')
  // 无效条目的 ⚠ 行即使在折叠态也露出（含一键修复入口），并且始终挂在折叠体之外。
  assert.equal(renderer.hasTest('skill-fix-delta'), true)
  const collapsedInvalid = renderer.findNode((node) => node.props?.['data-testid'] === 'skill-fix-delta')
  assert.ok(collapsedInvalid)
  assert.equal(collapsedInvalid.parent?.props?.['data-testid'], undefined)
  renderer.findByTestId('skill-header-delta').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-body-delta'), true)
  const expandedInvalid = renderer.findNode((node) => node.props?.['data-testid'] === 'skill-fix-delta')
  assert.ok(expandedInvalid)
  assert.notEqual(expandedInvalid.parent?.props?.['data-testid'], 'skill-body-delta')

  // 单条点击独立开合：alpha 展开不牵动 beta。
  renderer.findByTestId('skill-header-alpha').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-body-alpha'), true)
  assert.equal(renderer.hasTest('skill-switch-model-alpha'), true)
  assert.equal(renderer.findByTestId('skill-header-alpha').props['aria-expanded'], 'true')
  assert.equal(renderer.hasTest('skill-body-beta'), false)
  assert.equal(renderer.findByTestId('skills-expand-all').children.join(''), '全部展开')
  renderer.findByTestId('skill-header-alpha').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-body-alpha'), false)

  // 顶部按钮一键展开全部可见条目，按钮自身切成「全部折叠」。
  renderer.findByTestId('skills-expand-all').props.onClick()
  await renderer.flush()
  for (const name of ['alpha', 'beta', 'gamma', 'delta']) assert.equal(renderer.hasTest('skill-body-' + name), true, name + ' expanded')
  assert.equal(renderer.findByTestId('skills-expand-all').children.join(''), '全部折叠')

  // 过滤态下按钮只作用于命中的条目：全收 alpha，被过滤掉的 beta/gamma/delta 保持展开。
  renderer.findByTestId('skills-filter').props.onChange({ target: { value: 'alp' } })
  await renderer.flush()
  assert.equal(renderer.findByTestId('skills-expand-all').children.join(''), '全部折叠')
  renderer.findByTestId('skills-expand-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-body-alpha'), false)
  assert.equal(renderer.findByTestId('skills-expand-all').children.join(''), '全部展开')

  renderer.findByTestId('skills-filter').props.onChange({ target: { value: '' } })
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-body-beta'), true)
  assert.equal(renderer.hasTest('skill-body-alpha'), false)
  assert.equal(renderer.findByTestId('skills-expand-all').children.join(''), '全部展开')
  renderer.findByTestId('skills-expand-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-body-alpha'), true)
  assert.equal(renderer.findByTestId('skills-expand-all').children.join(''), '全部折叠')
})

test('AI describe dialog loads models, drafts a preview diff, and writes after explicit confirm', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()

  renderer.findByTestId('skill-header-alpha').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-describe-alpha').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-describe-dialog'), true)
  // 默认模型取 localStorage（空）→ 首个模型 m1。
  assert.equal(renderer.findByTestId('skill-describe-model').props.value.startsWith('p\u0000'), true)

  renderer.findByTestId('skill-describe-run').props.onClick()
  await renderer.flush()
  assert.deepEqual(fixture.state.describes, [{ id: 'id-alpha', provider: 'p', model: 'm1', lang: 'zh' }])
  assert.match(renderer.text(), /AI 描述/)
  assert.match(renderer.text(), /Alpha desc/)
  assert.equal(renderer.hasTest('skill-diff-usage'), true)

  renderer.findByTestId('skill-apply-confirm').props.onClick()
  await renderer.flush()
  assert.deepEqual(fixture.state.applies, [{ id: 'id-alpha', patch: { description: 'AI 描述', usage: 'AI 用法' }, model: 'p/m1' }])
  assert.equal(renderer.hasTest('skill-apply-done'), true)
  // 注释以独立块展示在条目下方：只含描述与用法两行，不再带标题说明。
  assert.equal(renderer.hasTest('skill-note-alpha'), true)
  assert.equal(renderer.text().includes('仅面板展示'), false)
  // v0.31 用户点名：描述/用法/注释占满技能展示区宽度——折叠体里「文本 | 开关」双栏 + 注释块
  // 独占整行（不再嵌在左列里被开关列挤窄）；折叠头部行只留名称徽标。
  const entryNode = renderer.findByTestId('skill-entry-alpha')
  const directIds = entryNode.children.filter((child) => child !== null && child.props && child.props['data-testid']).map((child) => child.props['data-testid'])
  assert.deepEqual(directIds, ['skill-header-alpha', 'skill-body-alpha'])
  const headerRow = entryNode.children[0]
  assert.equal(headerRow.props.style.display, 'flex', 'collapsed header keeps the name row')
  const bodyNode = renderer.findByTestId('skill-body-alpha')
  const bodyIds = bodyNode.children.filter((child) => child !== null && child.props && child.props['data-testid']).map((child) => child.props['data-testid'])
  assert.deepEqual(bodyIds, ['skill-note-alpha'], 'the note block spans the whole entry width')
  // 运行日志盒保留最后一次生成的过程记录（结构化条目经词典渲染）。
  assert.equal(renderer.hasTest('skill-describe-log'), true)
  assert.match(renderer.text(), /解析成功，草稿就绪/)
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('dsh-service-skills-model')), { provider: 'p', model: 'm1' })
})

test('skill run logs render timestamps in local time instead of UTC', async () => {
  const fixture = createSkillsRpcFixture()
  const at = 1735689600000 // 2026-01-01T00:00:00Z
  const originalHandler = fixture.handler
  fixture.handler = async (channel, endpoint, payload) => {
    if (endpoint === 'skills-describe-log') {
      return { ok: true, value: { logs: [
        { at, code: 'located', params: { name: 'alpha', chars: 128 } },
        { at: at + 1000, code: 'parsed', params: {} },
      ] } }
    }
    return originalHandler(channel, endpoint, payload)
  }
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('skill-header-alpha').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-describe-alpha').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('skill-describe-run').props.onClick()
  await renderer.flush()
  await renderer.flush()

  const pad = (value) => String(value).padStart(2, '0')
  const date = new Date(at)
  const expectedLocal = pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  const utcTime = pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds())
  // 日志前缀随本机时区渲染；本机时区与 UTC 不同的环境里，UTC 时钟不得出现。
  assert.match(renderer.text(), new RegExp('\\[' + expectedLocal + '\\]'))
  if (utcTime !== expectedLocal) assert.doesNotMatch(renderer.text(), new RegExp('\\[' + utcTime + '\\]'))
})

test('batch card plans, starts, and settles through the status poll with a refreshed catalog', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  await renderer.flush()
  // 批量入口默认折叠为单个按钮；点击展开完整卡片。
  assert.equal(renderer.hasTest('skills-batch-card'), false)
  renderer.findByTestId('skills-batch-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-batch-card'), true)
  const listCallsAfterLoad = fixture.state.listCalls

  // 批量卡片自带模型下拉：默认取会话默认模型（fixture current = p/m2），可改选。
  const batchSelect = renderer.findByTestId('skills-batch-model')
  assert.equal(batchSelect.props.value.startsWith('p\u0000'), true)
  assert.equal(batchSelect.props.disabled, false)
  batchSelect.props.onChange({ target: { value: 'p\u0000m1' } })
  await renderer.flush()
  assert.equal(renderer.findByTestId('skills-batch-model').props.value, 'p\u0000m1')

  renderer.findByTestId('skills-batch-plan').props.onClick()
  await renderer.flush()
  assert.match(renderer.text(), /候选 1 项/)
  assert.match(renderer.text(), /已注释将覆盖 1 项/)
  assert.match(renderer.text(), /待开始（核对候选后点击「开始批量补全」）/)
  assert.match(renderer.text(), /跳过 1 项/)

  // 计划含已注释条目：第一击只武装「确认强制补全」（不发 RPC），第二击才真正启动并带 forceAnnotated。
  renderer.findByTestId('skills-batch-start').props.onClick()
  await renderer.flush()
  assert.equal(fixture.state.batchRuns.length, 0)
  assert.equal(renderer.findByTestId('skills-batch-start').children.join(''), '确认强制补全（覆盖 1 项已注释）')
  // 将覆盖清单可展开：逐条显示被覆盖的技能名。
  assert.equal(renderer.hasTest('skills-batch-annotated-item'), false)
  renderer.findByTestId('skills-batch-annotated-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-batch-annotated-item'), true)
  const annotatedItems = renderer.findAllByTestIdPrefix('skills-batch-annotated-item')
  assert.equal(annotatedItems.length, 1)
  assert.equal(annotatedItems[0].children.join(''), 'alpha')

  renderer.findByTestId('skills-batch-start').props.onClick()
  await renderer.flush()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(fixture.state.batchPlans, [{ provider: 'p', model: 'm1' }])
  assert.deepEqual(fixture.state.batchRuns, [{ planId: 'plan-1', lang: 'zh', forceAnnotated: true }])
  assert.match(renderer.text(), /已完成/)
  assert.match(renderer.text(), /进度 1\/1/)
  // 落定后运行日志自动折叠：只留开关行；点击展开回看过程记录。
  const logToggle = renderer.findByTestId('skills-batch-log-toggle')
  assert.match(String(logToggle.children[0]), /^▸ /)
  assert.equal(renderer.hasTest('skills-batch-log'), false)
  logToggle.props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-batch-log'), true)
  assert.match(renderer.text(), /解析成功，草稿就绪/)
  // 后台语义：切走再切回，进度不丢（状态在工厂作用域，不随组件卸载）。
  // 日志盒为组件局部状态：重新挂载后回到默认折叠，与真实 React 卸载重置行为一致。
  renderer.findButton('概览').props.onClick()
  await renderer.flush()
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.match(renderer.text(), /已完成/)
  assert.match(renderer.text(), /进度 1\/1/)
  // 折叠开关在重挂载后依然有效（测试桩复用同名组件的局部状态，展开/收起都可能，
  // 因此只断言点击切换有效，不断言具体初值——真实 React 卸载即重置为折叠）。
  const remountToggle = renderer.findByTestId('skills-batch-log-toggle')
  const expandedBefore = renderer.hasTest('skills-batch-log')
  remountToggle.props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-batch-log'), !expandedBefore)
  // 落定后列表自动刷新拿最新 annotated 标记；选择已写入 localStorage。
  assert.ok(fixture.state.listCalls > listCallsAfterLoad)
  assert.deepEqual(JSON.parse(globalThis.localStorage.getItem('dsh-service-skills-model')), { provider: 'p', model: 'm1' })
})

test('an adopted planned batch without a local plan recovers through the plan button', async () => {
  const fixture = createSkillsRpcFixture()
  fixture.state.adoptPlanned = true
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  await renderer.flush()

  // 宿主遗留 planned 任务：批量卡片自动展开（在途任务自动可见），无需点击入口。
  // 宿主停在 planned 但本端无计划：不显示开始按钮，而是回到空闲态给出「生成计划」。
  assert.equal(renderer.hasTest('skills-batch-start'), false)
  const planButton = renderer.findByTestId('skills-batch-plan')
  assert.equal(planButton.props.disabled, false)
  planButton.props.onClick()
  await renderer.flush()
  // 重新计划后恢复正常两段流程。
  assert.match(renderer.text(), /候选 1 项/)
  assert.equal(renderer.hasTest('skills-batch-start'), true)
})

test('skills tab renders localized error text instead of crashing on failed loads and rejected toggles', async () => {
  const fixture = createSkillsRpcFixture()
  // 只读条目 gamma 的开关被宿主拒绝 read-only-source；此前 mapSkillErrorMessage 引用
  // 不存在的 translate 自由变量，任何错误渲染都会 ReferenceError 把整个技能页炸掉。
  const originalHandler = fixture.handler
  fixture.handler = async (channel, endpoint, payload) => {
    if (endpoint === 'skills-toggle' && payload.id === 'id-gamma') return { ok: false, error: 'read-only-source' }
    return originalHandler(channel, endpoint, payload)
  }
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-section'), true)

  // 双击只读条目开关 → 宿主拒绝 → 错误行显示词典文案而非原始错误码，页面不崩溃。
  renderer.findByTestId('skill-header-gamma').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-switch-model-gamma').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-switch-model-gamma').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-error'), true)
  assert.match(renderer.text(), /只读来源/)
  assert.doesNotMatch(renderer.text(), /read-only-source/)
})

test('skills batch plan shows an expandable skipped list with per-entry reasons and no stale read-only claim', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('skills-batch-toggle').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skills-batch-plan').props.onClick()
  await renderer.flush()
  await renderer.flush()

  // 摘要不再宣称「只读」跳过（只读目录早已是合法候选）；已注释条目另列「将覆盖」不计入跳过。
  const summary = renderer.findByTestId('skills-batch-candidates').children.join('')
  assert.doesNotMatch(summary, /只读/)
  assert.match(summary, /跳过 1 项/)
  assert.doesNotMatch(summary, /已注释将覆盖 0 项/)

  // 跳过清单可展开：逐条显示名称与本地化原因（已注释条目不再混在跳过清单里）。
  assert.equal(renderer.hasTest('skills-batch-skipped-item'), false)
  renderer.findByTestId('skills-batch-skipped-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-batch-skipped-item'), true)
  assert.match(renderer.text(), /gamma：缺 frontmatter/)
  assert.doesNotMatch(renderer.text(), /alpha：已注释/)
})

test('AI completion requests carry the active UI language so host prompts follow the DSH locale', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()

  // 英文环境发起补全：请求带 lang:'en'；切回中文另开一条补全：lang 跟随切换。
  renderer.findByTestId('skill-header-alpha').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-describe-alpha').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.setLocale('en')
  await renderer.flush()
  renderer.findByTestId('skill-describe-run').props.onClick()
  await renderer.flush()
  assert.equal(fixture.state.describes.length, 1)
  renderer.setLocale('zh')
  await renderer.flush()
  renderer.findByTestId('skill-header-beta').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-describe-beta').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('skill-describe-run').props.onClick()
  await renderer.flush()
  assert.deepEqual(fixture.state.describes.map((payload) => payload.lang), ['en', 'zh'])
})

test('describe dialog shows the panel-only disclaimer before saving a note', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('skill-header-alpha').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-describe-alpha').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('skill-describe-run').props.onClick()
  await renderer.flush()

  // 草稿就绪后、确认保存前，「仅面板展示」免责声明可见（此前只在批量 hint 里出现）。
  assert.equal(renderer.hasTest('skill-note-disclaimer'), true)
  assert.match(renderer.findByTestId('skill-note-disclaimer').children.join(''), /不写入 SKILL\.md/)

  // 保存后的完成文案说「注释已保存」，不再说「已写入」。
  renderer.findByTestId('skill-apply-confirm').props.onClick()
  await renderer.flush()
  assert.match(renderer.findByTestId('skill-apply-done').children.join(''), /注释已保存/)
})

test('AI describe dialog renders directly below the target skill item instead of at the top of the section', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()

  // 未打开补全前：无补全设置框
  assert.equal(renderer.hasTest('skill-describe-dialog'), false)

  // 为 alpha（位于 auto 组）开启补全
  renderer.findByTestId('skill-header-alpha').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-describe-alpha').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('skill-describe-dialog'), true)

  // 补全设置框不得出现在 skills-section 顶层直接子节点中
  const sectionNode = renderer.findByTestId('skills-section')
  const sectionDirectIds = sectionNode.children.filter((c) => c && c.props && c.props['data-testid']).map((c) => c.props['data-testid'])
  assert.equal(sectionDirectIds.includes('skill-describe-dialog'), false, 'describe dialog must not be at section top')

  // 补全设置框必须直接位于 skill-entry-alpha 下方（在同一个分组内相邻）
  const autoGroup = renderer.findByTestId('skills-group-auto')
  const autoChildIds = autoGroup.children.flat(Infinity).filter((c) => c && c.props && c.props['data-testid']).map((c) => c.props['data-testid'])
  assert.deepEqual(autoChildIds, ['skill-entry-alpha', 'skill-describe-dialog'])

  // 切换为 beta（位于 manual 组）开启补全：设置框必须移到 beta 下方，auto 组不再包含设置框
  renderer.findByTestId('skill-header-beta').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skill-describe-beta').props.onClick()
  await renderer.flush()
  await renderer.flush()
  const autoGroupAfter = renderer.findByTestId('skills-group-auto')
  const autoChildIdsAfter = autoGroupAfter.children.flat(Infinity).filter((c) => c && c.props && c.props['data-testid']).map((c) => c.props['data-testid'])
  assert.deepEqual(autoChildIdsAfter, ['skill-entry-alpha'])
  const manualGroup = renderer.findByTestId('skills-group-manual')
  const manualChildIds = manualGroup.children.flat(Infinity).filter((c) => c && c.props && c.props['data-testid']).map((c) => c.props['data-testid'])
  assert.deepEqual(manualChildIds, ['skill-entry-beta', 'skill-describe-dialog'])
})

test('ordinary client startup skips skills batch recovery without a pending marker', async () => {
  const fixture = createSkillsRpcFixture()
  const originalHandler = fixture.handler
  let statusCalls = 0
  fixture.handler = async (channel, endpoint, payload) => {
    if (endpoint === 'skills-batch-status') statusCalls += 1
    return originalHandler(channel, endpoint, payload)
  }
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  await renderer.flush()
  assert.equal(statusCalls, 0)
})

test('a pending skills batch marker restores the host-side running badge without visiting the skills tab', async () => {
  const fixture = createSkillsRpcFixture()
  const originalHandler = fixture.handler
  let statusCalls = 0
  fixture.handler = async (channel, endpoint, payload) => {
    if (endpoint === 'skills-batch-status') {
      statusCalls += 1
      if (fixture.state.batchRuns.length === 0) {
        // 页面刷新后的宿主态：批量正在运行（本端计划已丢）。
        return { ok: true, value: { phase: 'running', total: 3, done: 1, failures: [], current: 'beta', estBytes: 128, logs: [] } }
      }
    }
    return originalHandler(channel, endpoint, payload)
  }
  const renderer = baseSkillRenderer(fixture, { initialStorage: { 'dsh-service-skills-batch-pending': 'true' } })
  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-tab-badge'), true)
  assert.equal(renderer.findByTestId('skills-tab-badge').children[0], '1/3')
  assert.equal(statusCalls, 1)
  renderer.disposeFactory()
})

test('cliproxy windows render as「账号 · 本地化窗口名」and management errors have localized copy', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [
            {
              provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
              refreshing: false, status: 'ok', fetchedAt: Date.now(),
              windows: [
                // 宿主下发 label（账号标识）+ kindKey（稳定代码）；词典收录的走本地化，未收录的裸模型名兜底。
                { id: 'codex-user-example-com-0-codex-5h', kindKey: 'codex-5h', label: 'codex-user@example.com', percent: 43 },
                { id: 'gm-gmail-com-1-gemini-2-5-pro', kindKey: 'gemini-2.5-pro', label: 'gm@gmail.com', percent: 10 },
                { id: 'codex-user-example-com-0-codex-week', kindKey: 'codex-week', label: 'codex-user@example.com', percent: 7 },
              ],
            },
            {
              provider: 'cpa2', displayName: 'CPA 备用', adapted: true, kind: 'cliproxy', kindSource: 'config',
              refreshing: false, status: 'error', errorCode: 'mgmt-disabled',
            },
          ],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const text = renderer.text()
  // 两段式组合文案：账号（数据）· 本地化窗口名（词典）——宿主不拼用户可见句子。
  assert.match(text, /codex-user@example\.com · 5 小时/)
  assert.match(text, /codex-user@example\.com · 本周/)
  assert.match(text, /gm@gmail\.com · gemini-2\.5-pro/) // 模型名未收录 → 裸模型名兜底
  assert.match(text, /43%/)
  // 稳定错误码 mgmt-disabled 的本地化文案。
  assert.match(text, /CLIProxyAPI 管理面未启用/)
  // CPA 卡片按 Gemini / Codex 分区
  assert.ok(renderer.findByTestId('quota-card-family-cpa-gemini'))
  assert.ok(renderer.findByTestId('quota-card-family-cpa-codex'))
  assert.equal(renderer.findByTestId('quota-card-family-title-cpa-gemini').children.join(''), 'Gemini')
  assert.equal(renderer.findByTestId('quota-card-family-title-cpa-codex').children.join(''), 'Codex')
})

test('CLIProxyAPI codex accounts each get their own reset-card block with an add entry', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const cardCalls = []
  // 假宿主持有卡状态：新增卡片后 quota RPC 要把新卡回传给客户端（复现真实往返，
  // 否则「保存成功但卡片没出现在对应账号下」这类 bug 会被静态 fixture 掩盖）。
  let savedCards = [
    { id: 'rc-a', provider: 'cpa', account: 'codex-a@example.com', label: 'A 号周卡', expiresAt: '2099-01-01' },
    { id: 'rc-b', provider: 'cpa', account: 'codex-b@example.com', label: 'B 号周卡', expiresAt: '2099-02-01' },
  ]
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota-reset-card') {
      cardCalls.push(payload)
      if (payload?.remove === true) savedCards = savedCards.filter((card) => card.id !== payload.id)
      else savedCards = [...savedCards, { id: `rc-new-${savedCards.length}`, ...payload }]
      return { ok: true }
    }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [{
            provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
            refreshing: false, status: 'ok', fetchedAt: Date.now(),
            // 两个 codex 账号（同 provider 内）+ 一个 gemini 账号；账号级重置卡按 account 归属。
            windows: [
              { id: 'a-0-codex-5h', kindKey: 'codex-5h', label: 'codex-a@example.com', percent: 43 },
              { id: 'a-0-codex-week', kindKey: 'codex-week', label: 'codex-a@example.com', percent: 7 },
              { id: 'b-1-codex-5h', kindKey: 'codex-5h', label: 'codex-b@example.com', percent: 12 },
              { id: 'gm-2-gemini-pro', kindKey: 'gemini-2.5-pro', label: 'gm@gmail.com', percent: 10 },
            ],
            resetCards: savedCards,
          }],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  // 每个 codex 账号一个块（testid 带账号 slug），gemini 不改结构（仍无账号块）。
  assert.ok(renderer.findByTestId('quota-cpa-account-cpa-codex-a-example-com'))
  assert.ok(renderer.findByTestId('quota-cpa-account-cpa-codex-b-example-com'))
  assert.equal(renderer.hasTest('quota-cpa-account-cpa-gm-gmail-com'), false)
  // 各账号块内只出现属于自己的重置卡。
  const blockA = renderer.findByTestId('quota-cpa-account-cpa-codex-a-example-com')
  const blockB = renderer.findByTestId('quota-cpa-account-cpa-codex-b-example-com')
  const flatText = (node) => JSON.stringify(node)
  assert.match(flatText(blockA), /A 号周卡/)
  assert.doesNotMatch(flatText(blockA), /B 号周卡/)
  assert.match(flatText(blockB), /B 号周卡/)
  assert.doesNotMatch(flatText(blockB), /A 号周卡/)
  // 追加时带 account 归属（否则两张卡都会挂到 provider 级）。
  assert.deepEqual(renderer.findAllByTestIdPrefix('quota-reset-card-cpa-rc-').length, 2)

  // 「添加重置卡」与 zai 同款：平时不出现，展开「配置」后每个账号各一个。
  assert.equal(renderer.hasTest('quota-card-edit-cpa-codex-a-example-com'), false)
  renderer.findByTestId('quota-advanced-toggle-cpa').props.onClick()
  await renderer.flush()
  const addA = renderer.findByTestId('quota-card-edit-cpa-codex-a-example-com')
  const addB = renderer.findByTestId('quota-card-edit-cpa-codex-b-example-com')
  assert.match(String(addA.children[0]), /添加重置卡/)
  assert.match(String(addB.children[0]), /添加重置卡/)

  // 点 A 账号的入口 → 表单出现在 A 块内，保存载荷带 account=codex-a。
  addA.props.onClick()
  await renderer.flush()
  assert.ok(renderer.hasTest('quota-reset-editor-cpa-codex-a-example-com'))
  assert.equal(renderer.findByTestId('quota-reset-input-name').props.value, '')
  renderer.findByTestId('quota-reset-input-date').props.onChange({ target: { value: '2099-03-01T00:00' } })
  await renderer.flush()
  renderer.findByTestId('quota-reset-card-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(cardCalls, [{ provider: 'cpa', account: 'codex-a@example.com', expiresAt: '2099-03-01T00:00' }])
  // 真实往返：新卡归属 A 账号（B 账号的块里不能出现它）。A 账号已有两张卡，
  // 默认只展开最近那张，新的 2099-03-01 不是最近 → 落在折叠里，展开后可见。
  const blockB2 = renderer.findByTestId('quota-cpa-account-cpa-codex-b-example-com')
  assert.doesNotMatch(flatText(blockB2), /rc-new-2/, 'the new card must never land under another account')
  renderer.findByTestId('quota-reset-more-cpa-codex-a-example-com').props.onClick()
  await renderer.flush()
  const blockA2 = renderer.findByTestId('quota-cpa-account-cpa-codex-a-example-com')
  assert.match(flatText(blockA2), /rc-new-2/, 'the new card must render inside its own account block')
})

test('an account-scoped reset card stays visible while the row has no windows yet', async () => {
  // 回归：保存后行会短暂回到 refreshing/无窗口（宿主重新查询中），查询失败的账号同样拿不到窗口。
  // 账号块的成员若只由窗口推导，卡就会凭空消失（「添加成功但没按账号位置显示」）。
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const baseCards = [{ id: 'rc-a', provider: 'cpa', account: 'codex-a@example.com', label: 'A 号周卡' }]
  const renderRow = ({ windows, refreshing, errorCode }) => ({
    provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
    refreshing: refreshing === true, status: errorCode !== undefined ? 'error' : 'ok', fetchedAt: Date.now(),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(windows.length > 0 ? { windows } : {}),
    resetCards: baseCards,
  })
  const codexWindow = { id: 'a-0-codex-5h', kindKey: 'codex-5h', label: 'codex-a@example.com', percent: 43 }
  let scenario = 'refreshing'
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      const row = scenario === 'refreshing'
        ? renderRow({ windows: [], refreshing: true })
        : scenario === 'error'
          ? renderRow({ windows: [], errorCode: 'upstream-status:401' })
          : renderRow({ windows: [codexWindow] })
      return { ok: true, value: { serverTime: Date.now(), providers: [row] } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const flat = (id) => JSON.stringify(renderer.findByTestId(id))
  // refreshing + 无窗口：账号卡仍要出现（这是保存后立刻发生的状态）。
  assert.ok(renderer.hasTest('quota-cpa-account-cpa-codex-a-example-com'), 'account block must exist while refreshing')
  assert.match(flat('quota-cpa-account-cpa-codex-a-example-com'), /A 号周卡/)
  // 查询失败 + 无窗口：同样不能丢卡。经该卡的「刷新」入口重发 quota（无自动轮询，手动触发）。
  scenario = 'error'
  renderer.findByTestId('quota-refresh-cpa').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.ok(renderer.hasTest('quota-cpa-account-cpa-codex-a-example-com'), 'account block must exist on a failed account query')
  assert.match(flat('quota-cpa-account-cpa-codex-a-example-com'), /A 号周卡/)
})

test('quota error rows render one unified line: family copy, HTTP status, endpoint, account, upstream reason', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const retryAt = Date.now() + 3600_000
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [
            // 传输层失败：错误码带状态码后缀 + 多候选链的失败端点 + 上游原话 + 重试时刻。
            {
              provider: 'zai-key', displayName: 'Z.ai', adapted: true, kind: 'zai-coding-cn', kindSource: 'config',
              refreshing: false, status: 'error', errorCode: 'http-status:503', errorEndpoint: 'api.z.ai',
              errorDetail: 'bad gateway', nextAllowedAt: retryAt,
            },
            // CPA 全账号失败：状态码 + 失败账号 + 上游原话（此前只有一个 upstream-status 家族码）。
            {
              provider: 'cpa-key', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
              refreshing: false, status: 'error', errorCode: 'upstream-status:401',
              errorAccount: 'codex-user@example.com', errorDetail: 'token expired', nextAllowedAt: Date.now() - 1,
            },
            // 上游拒绝凭据：家族码走词典，详情只带上游原话。
            {
              provider: 'ds-key', displayName: 'DeepSeek', adapted: true, kind: 'deepseek', kindSource: 'config',
              refreshing: false, status: 'unconfigured', errorCode: 'credential-rejected',
              errorDetail: 'Authentication Fails, Your api key: ****wxyz is invalid', nextAllowedAt: Date.now() - 1,
              credentialHints: [{ name: 'DEEPSEEK_API_KEY', configured: true }],
            },
            // HTTP 200 的业务信封自报服务故障：没有 HTTP 状态码后缀，只有家族码 + 失败端点 + 上游原话。
            {
              provider: 'zai-up-key', displayName: 'Z.ai', adapted: true, kind: 'zai-coding-cn', kindSource: 'config',
              refreshing: false, status: 'error', errorCode: 'upstream-error', errorEndpoint: 'open.bigmodel.cn',
              errorDetail: '内部服务器错误', nextAllowedAt: Date.now() - 1,
            },
          ],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  const clock = new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const zaiLine = renderer.findByTestId('quota-error-zai-key').children.join('')
  assert.equal(zaiLine, `上游返回错误状态 (HTTP 503 · api.z.ai · bad gateway) · ${clock} 后可重试`)
  const cpaLine = renderer.findByTestId('quota-error-cpa-key').children.join('')
  assert.equal(cpaLine, '上游官方接口返回错误状态 (HTTP 401 · codex-user@example.com · token expired)')
  const dsLine = renderer.findByTestId('quota-error-ds-key').children.join('')
  assert.equal(dsLine, '凭据被上游拒绝，请重新填写（控制台类渠道请重新从浏览器复制登录态） (Authentication Fails, Your api key: ****wxyz is invalid)')
  const upLine = renderer.findByTestId('quota-error-zai-up-key').children.join('')
  assert.equal(upLine, '上游服务故障（额度接口报错，稍后自动重试） (open.bigmodel.cn · 内部服务器错误)')
  // 带后缀的错误码不得掉进「未知错误」兜底。
  assert.doesNotMatch(renderer.text(), /未知错误/)
})

test('stale cliproxy snapshot windows render a cached badge while live windows stay unmarked', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      return {
        ok: true,
        value: {
          serverTime: Date.now(),
          providers: [
            {
              provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config',
              refreshing: false, status: 'ok', fetchedAt: Date.now(),
              windows: [
                // 实时 api-call 失败回退的快照窗口（宿主打 stale 标，重置点已过的死窗口宿主已丢弃）。
                { id: 'u0-example-com-0-codex-week', kindKey: 'codex-week', label: 'u0@example.com', percent: 5, resetsAt: new Date(Date.now() + 3600_000).toISOString(), stale: true },
                { id: 'u1-example-com-1-codex-week', kindKey: 'codex-week', label: 'u1@example.com', percent: 73, resetsAt: new Date(Date.now() + 3600_000).toISOString() },
              ],
            },
          ],
        },
      }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  // stale 窗口带「缓存」徽标与悬停说明；实时窗口不带任何标记。
  const staleBadge = renderer.findByTestId('quota-card-stale-cpa-u0-example-com-0-codex-week')
  assert.equal(staleBadge.children.join(''), '缓存')
  assert.match(String(staleBadge.props.title), /CPA 上次缓存的快照/)
  assert.equal(renderer.findByTestId('quota-card-window-cpa-u1-example-com-1-codex-week') !== undefined, true)
  let liveStaleBadge
  try {
    liveStaleBadge = renderer.findByTestId('quota-card-stale-cpa-u1-example-com-1-codex-week')
  } catch (_) {
    liveStaleBadge = null
  }
  assert.equal(liveStaleBadge, null)
})

test('unconfigured quota rows offer an inline credential form that writes via the store RPC', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const rpcLog = []
  let credentialConfigured = false
  const buildProviders = () => [{
    provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config', credentialEntryKey: 'editManagement',
    refreshing: false, status: 'unconfigured', errorCode: 'credential-missing',
    nextAllowedAt: Date.now() - 1,
    credentialHints: [{ name: 'CPA_MANAGEMENT_KEY', configured: credentialConfigured }],
  }]
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    rpcLog.push([endpoint, payload])
    if (endpoint === 'quota') return { ok: true, value: { providers: buildProviders(), serverTime: Date.now() } }
    if (endpoint === 'quota-credential-set') {
      credentialConfigured = true
      return { ok: true }
    }
    if (endpoint === 'quota-refresh') return { ok: true }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  // v0.39：凭据入口在折叠的「配置」区，先展开 cpa 卡。
  renderer.findByTestId('quota-advanced-toggle-cpa').props.onClick()
  await renderer.flush()
  // 未配置行：错误文案旁出现表单入口；cliproxy 行的按钮文案是「管理密钥」而非「API 密钥」
  // ——那是 CPA 网页登录的 remote-management key，写错标签会诱导用户填代理 key 撞封禁。
  assert.match(renderer.text(), /凭据未配置/)
  assert.equal(renderer.findByTestId('quota-cred-edit-cpa').children.join(''), '填写管理密钥（网页登录的 key）')
  renderer.findByTestId('quota-cred-edit-cpa').props.onClick()
  await renderer.flush()
  const input = renderer.findByTestId('quota-cred-input-value')
  input.props.onChange({ target: { value: 'mgmt-secret' } })
  await renderer.flush()
  // 已配置=false 时没有「清除已存」按钮；保存后走 set → quota-refresh（强制清闸）→ 快照接续。
  assert.equal(renderer.hasTest('quota-cred-clear'), false)
  renderer.findByTestId('quota-cred-save').props.onClick()
  await renderer.flush()
  const setCall = rpcLog.find(([endpoint]) => endpoint === 'quota-credential-set')
  assert.deepEqual(setCall[1], { provider: 'cpa', name: 'CPA_MANAGEMENT_KEY', value: 'mgmt-secret' })
  assert.ok(rpcLog.some(([endpoint]) => endpoint === 'quota-refresh'))
})

test('credential form defaults to the configured alias and marks the primary name', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const buildProviders = () => [{
    provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config', credentialEntryKey: 'editManagement',
    refreshing: false, status: 'unconfigured', errorCode: 'credential-missing', nextAllowedAt: Date.now() - 1,
    // 别名链：主名未配置、别名已配置（用户先填错主名后改对别名的真实场景）。
    credentialHints: [
      { name: 'CPA_MANAGEMENT_KEY', configured: false },
      { name: 'CLIPROXY_MANAGEMENT_KEY', configured: true },
    ],
  }]
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') return { ok: true, value: { providers: buildProviders(), serverTime: Date.now() } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  // v0.39：凭据入口在折叠的「配置」区，先展开 cpa 卡。
  renderer.findByTestId('quota-advanced-toggle-cpa').props.onClick()
  await renderer.flush()
  renderer.findByTestId('quota-cred-edit-cpa').props.onClick()
  await renderer.flush()
  // 默认选中「已配置」的别名（不是主名）；下拉按发现顺序列出两个别名槽。
  const selectNode = renderer.findByTestId('quota-cred-name-select')
  assert.equal(selectNode.props.value, 'CLIPROXY_MANAGEMENT_KEY')
  assert.deepEqual(selectNode.children.flat(Infinity).map((option) => option.props.value), ['CPA_MANAGEMENT_KEY', 'CLIPROXY_MANAGEMENT_KEY'])
})

test('classic-kind credential rows keep the API-key label while cliproxy uses the management-key one', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') return { ok: true, value: { providers: [{
      provider: 'or', displayName: 'OR', adapted: true, kind: 'openrouter', kindSource: 'config',
      refreshing: false, status: 'unconfigured', errorCode: 'credential-missing', nextAllowedAt: Date.now() - 1,
      credentialHints: [{ name: 'OPENROUTER_API_KEY', configured: false }],
    }], serverTime: Date.now() } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  // v0.39：凭据入口在折叠的「配置」区，先展开 or 卡。
  renderer.findByTestId('quota-advanced-toggle-or').props.onClick()
  await renderer.flush()
  // 经典 kind 的凭据确实是 API key，文案保持「填写 API 密钥」。
  assert.equal(renderer.findByTestId('quota-cred-edit-or').children.join(''), '填写 API 密钥')
})

test('clearing a stored credential requires a second confirming click', async () => {
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const rpcLog = []
  const buildProviders = () => [{
    provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config', credentialEntryKey: 'editManagement',
    refreshing: false, status: 'unconfigured', errorCode: 'credential-missing', nextAllowedAt: Date.now() - 1,
    credentialHints: [{ name: 'CPA_MANAGEMENT_KEY', configured: true }],
  }]
  const renderer = createRenderer(async (channel, endpoint, payload) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    rpcLog.push([endpoint, payload])
    if (endpoint === 'quota') return { ok: true, value: { providers: buildProviders(), serverTime: Date.now() } }
    if (endpoint === 'quota-credential-unset') return { ok: true }
    if (endpoint === 'quota-refresh') return { ok: true }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()
  // v0.39：凭据入口在折叠的「配置」区，先展开 cpa 卡。
  renderer.findByTestId('quota-advanced-toggle-cpa').props.onClick()
  await renderer.flush()
  renderer.findByTestId('quota-cred-edit-cpa').props.onClick()
  await renderer.flush()
  // 已配置槽位 → 出现「清除已存」；第一击只武装（文案切换为确认态），不发任何 RPC。
  const clearButton = renderer.findByTestId('quota-cred-clear')
  assert.equal(clearButton.children.join(''), '清除已存')
  clearButton.props.onClick()
  await renderer.flush()
  assert.equal(rpcLog.some(([endpoint]) => endpoint === 'quota-credential-unset'), false)
  assert.equal(renderer.findByTestId('quota-cred-clear').children.join(''), '再次点击清除')
  // 第二击才真正下发清除，并随后强制重拉。
  renderer.findByTestId('quota-cred-clear').props.onClick()
  await renderer.flush()
  const unsetCall = rpcLog.find(([endpoint]) => endpoint === 'quota-credential-unset')
  assert.deepEqual(unsetCall[1], { provider: 'cpa', name: 'CPA_MANAGEMENT_KEY' })
  assert.ok(rpcLog.some(([endpoint]) => endpoint === 'quota-refresh'))
})

// ─── v0.27 子代理模型路由 ────────────────────────────────────────────────────

function createSubagentRenderer(options = {}) {
  const state = {
    route: options.route ?? { available: true, mode: 'inherit' },
    models: options.models ?? [
      { provider: 'deepseek-official', providerName: 'DeepSeek', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { provider: 'deepseek-official', providerName: 'DeepSeek', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { provider: 'cpa', providerName: 'CPA', id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
    ],
    saves: [],
  }
  const renderer = createRenderer(async (channel, endpoint, payload = {}) => {
    assert.equal(channel, '/dsh-service')
    if (endpoint === 'subagent-route') {
      if (options.loadError) return { ok: false, error: options.loadError }
      // beforeRoute：可选的挂起钩子，用来观察「宿主尚未响应」时的首帧渲染。
      if (typeof options.beforeRoute === 'function') await options.beforeRoute()
      return { ok: true, value: { ...state.route, models: state.models, current: { provider: 'cpa', model: 'gpt-5.6-sol' } } }
    }
    if (endpoint === 'subagent-route-save') {
      state.saves.push(payload)
      if (options.saveError) return { ok: false, error: options.saveError }
      // 镜像宿主 v1.4.12 草稿保留语义：切换模式不销毁 provider/model/reasoningEffort；
      // 回退列表 custom/follow 全量提交（缺省 = 清空），inherit 无编辑器 = 保留。
      const prior = state.route
      const draft = payload.mode === 'custom'
        ? { provider: payload.provider, model: payload.model, ...(payload.reasoningEffort !== undefined ? { reasoningEffort: payload.reasoningEffort } : {}) }
        : {
            ...(typeof prior.provider === 'string' ? { provider: prior.provider } : {}),
            ...(typeof prior.model === 'string' ? { model: prior.model } : {}),
            ...(typeof prior.reasoningEffort === 'string' ? { reasoningEffort: prior.reasoningEffort } : {}),
          }
      const savedFallbacks = payload.mode === 'inherit'
        ? (Array.isArray(prior.fallbacks) && prior.fallbacks.length > 0 ? { fallbacks: prior.fallbacks } : {})
        : (Array.isArray(payload.fallbacks) && payload.fallbacks.length > 0 ? { fallbacks: payload.fallbacks } : {})
      state.route = { available: true, mode: payload.mode, ...draft, ...savedFallbacks }
      return { ok: true, ...state.route }
    }
    if (endpoint === 'version') return { ok: true, value: { current: '0.26.0', instanceId: 'old-instance' } }
    if (endpoint === 'check-update') return { ok: false, error: 'offline' }
    if (endpoint === 'permissions-plan') return { ok: false, error: 'disabled fixture' }
    if (endpoint === 'health') return { ok: true, value: { uptime: 0, rss: 0, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'activity') return { ok: true, value: { hasActive: false, items: [] } }
    if (endpoint === 'diagnostics') return { ok: true, value: { checks: [], status: 'ok' } }
    if (endpoint === 'quota') return { ok: true, value: { providers: [], serverTime: Date.now() } }
    if (endpoint === 'web') return { ok: true, value: { instanceId: 'new-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { featureSettings: options.featureSettings, initialStorage: options.initialStorage })
  return { renderer, state }
}

test('subagent tab supports inherit/follow/custom, provider-model selection, save/reset, and optional nav entry', async () => {
  const { renderer, state } = createSubagentRenderer()
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()

  assert.equal(renderer.hasTest('subagent-section'), true)
  assert.equal(renderer.findByTestId('subagent-mode-inherit').props['aria-pressed'], 'true')
  assert.match(renderer.findByTestId('subagent-mode-desc').children.join(''), /不注入任何路由/)

  // follow 保存：无需供应商/模型字段。
  renderer.findByTestId('subagent-mode-follow').props.onClick()
  await renderer.flush()
  assert.match(renderer.findByTestId('subagent-mode-desc').children.join(''), /当前实际使用的模型/)
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[0], { mode: 'follow' })
  assert.equal(renderer.hasTest('subagent-saved'), true)

  // custom 默认选目录首项；切换 provider 后模型自动联动到该 provider 首项。
  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-provider').props.value, 'deepseek-official')
  assert.equal(renderer.findByTestId('subagent-model').props.value, 'deepseek-v4-flash')
  renderer.findByTestId('subagent-provider').props.onChange({ target: { value: 'cpa' } })
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-model').props.value, 'gpt-5.6-sol')
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[1], { mode: 'custom', provider: 'cpa', model: 'gpt-5.6-sol' })

  // 重置按钮直接保存 inherit；已保存的自定义路由作为草稿保留（模式切换不销毁）。
  renderer.findByTestId('subagent-reset').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[2], { mode: 'inherit' })
  assert.equal(renderer.findByTestId('subagent-mode-inherit').props['aria-pressed'], 'true')
  // 切回「自定义」：草稿自动回填，无需重新选择（用户点名：切换模式不丢配置）。
  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-provider').props.value, 'cpa')
  assert.equal(renderer.findByTestId('subagent-model').props.value, 'gpt-5.6-sol')

  // v0.39：子代理的设置页左列入口已撤销——段内开关不复存在，也不再注册独立 section。
  assert.equal(renderer.hasTest('subagent-nav-switch'), false)
  assert.equal((renderer.registrations()['settings.section'] || []).some((entry) => entry.id === 'dsh-service-subagent'), false)
})

test('subagent tab restores the saved custom route after switching modes (draft retention)', async () => {
  // 场景：曾保存 custom(cpa/gpt-5.6-sol)，后切到 follow——快照仍携带草稿字段。
  const { renderer, state } = createSubagentRenderer({ route: { available: true, mode: 'follow', provider: 'cpa', model: 'gpt-5.6-sol' } })
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()

  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-provider').props.value, 'cpa')
  assert.equal(renderer.findByTestId('subagent-model').props.value, 'gpt-5.6-sol')
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[0], { mode: 'custom', provider: 'cpa', model: 'gpt-5.6-sol' })
})

test('subagent tab preserves the reasoning effort across mode switches', async () => {
  const models = [
    { provider: 'deepseek-official', providerName: 'DeepSeek', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } },
    { provider: 'deepseek-official', providerName: 'DeepSeek', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    { provider: 'cpa', providerName: 'CPA', id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
  ]
  // 场景：custom + 思考等级 high 已保存 → 切 follow 保存 → 切回 custom：等级原样恢复并可一键保存。
  const { renderer, state } = createSubagentRenderer({ models, route: { available: true, mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } })
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-reasoning-effort').props.value, 'high')

  renderer.findByTestId('subagent-mode-follow').props.onClick()
  await renderer.flush()
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[0], { mode: 'follow' })

  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-provider').props.value, 'deepseek-official')
  assert.equal(renderer.findByTestId('subagent-model').props.value, 'deepseek-v4-flash')
  assert.equal(renderer.findByTestId('subagent-reasoning-effort').props.value, 'high')
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[1], { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
})

// v1.7.1：首帧秒开缓存——进入子代理页时先用上次成功快照画模式与草稿，宿主响应到达后再覆盖，
// 消除「先亮初始、再跳到自定义」的按钮/内容位移。
test('subagent first paint: cached route seeds the first frame so the mode does not jump after load', async () => {
  const cachedModels = [
    { provider: 'deepseek-official', providerName: 'DeepSeek', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    { provider: 'cpa', providerName: 'CPA', id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol', reasoning: { efforts: [{ id: 'high', name: 'High' }] } },
  ]
  const cached = { mode: 'custom', provider: 'cpa', model: 'gpt-5.6-sol', reasoningEffort: 'high', fallbacks: [{ provider: 'cpa', model: 'gpt-5.6-sol' }], models: cachedModels, available: true }
  // 宿主端点挂起：模拟「响应尚未返回」的窗口，此时唯一能画出来的就是缓存。
  let release = () => {}
  const gate = new Promise((resolve) => { release = resolve })
  const pending = createSubagentRenderer({ route: { available: true, mode: 'custom', provider: 'cpa', model: 'gpt-5.6-sol', reasoningEffort: 'high' }, initialStorage: { 'dsh-service-subagent-route-cache': JSON.stringify(cached) }, beforeRoute: () => gate })
  await pending.renderer.load()
  pending.renderer.mount('settings.section')
  // 不等待 flush：进入子代理页后的第一帧就必须读缓存，而非等宿主响应（否则首帧先亮旧模式，出现「跳一下」窗口）。
  pending.renderer.findButton('维护').props.onClick()
  pending.renderer.findButton('子代理').props.onClick()
  // 首帧（宿主未响应）：模式已经是自定义，自定义区块与回退编辑器在位——不先画初始再跳。
  assert.equal(pending.renderer.findByTestId('subagent-mode-custom').props['aria-pressed'], 'true')
  assert.equal(pending.renderer.findByTestId('subagent-mode-inherit').props['aria-pressed'], 'false')
  assert.equal(pending.renderer.hasTest('subagent-custom'), true)
  assert.equal(pending.renderer.hasTest('subagent-fallback-block'), true)
  assert.equal(pending.renderer.findByTestId('subagent-provider').props.value, 'cpa')
  assert.equal(pending.renderer.findByTestId('subagent-model').props.value, 'gpt-5.6-sol')
  assert.equal(pending.renderer.findByTestId('subagent-reasoning-effort').props.value, 'high')
  // 首帧也不该出现「模型清单为空」这类只有真快照到达前会误报的告警。
  assert.equal(pending.renderer.hasTest('subagent-models-empty'), false)
  release()
  await pending.renderer.flush()
  await pending.renderer.flush()
  // 响应到达后仍是自定义（快照是权威事实源，缓存只作初值）。
  assert.equal(pending.renderer.findByTestId('subagent-mode-custom').props['aria-pressed'], 'true')

  // 无缓存：保持原行为，首帧落在默认「初始」。
  const cold = createSubagentRenderer()
  await cold.renderer.load()
  cold.renderer.mount('settings.section')
  cold.renderer.findButton('维护').props.onClick()
  await cold.renderer.flush()
  cold.renderer.findButton('子代理').props.onClick()
  await cold.renderer.flush()
  await cold.renderer.flush()
  assert.equal(cold.renderer.findByTestId('subagent-mode-inherit').props['aria-pressed'], 'true')
})

test('subagent route cache: written after a successful load/save and ignored when malformed', async () => {
  const { renderer, state } = createSubagentRenderer({ route: { available: true, mode: 'follow' } })
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()
  // load 成功即落缓存（只含轻量路由字段，不含模型清单）。
  const written = JSON.parse(localStorage.getItem('dsh-service-subagent-route-cache'))
  assert.equal(written.mode, 'follow')
  assert.equal('models' in written, true, 'cache carries the catalog so the first frame can resolve provider/model names')
  assert.equal(written.models.length, 3)

  // 保存 custom 后 load 回填，缓存跟着更新到最新作者态（provider/model 按目录归一后的实际值）。
  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  const afterSave = JSON.parse(localStorage.getItem('dsh-service-subagent-route-cache'))
  assert.equal(afterSave.mode, 'custom')
  assert.equal(afterSave.provider, 'deepseek-official')
  assert.equal(afterSave.model, 'deepseek-v4-flash')
  assert.deepEqual(state.saves[0], { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash' })

  // 坏缓存（非法模式 / 非法 JSON / 缺模式）一律当没有：首帧回落默认「初始」，不炸渲染。
  for (const raw of ['{"mode":"bogus"}', 'not json', '{}', '{"mode":"custom","fallbacks":"nope"}']) {
    const broken = createSubagentRenderer({ initialStorage: { 'dsh-service-subagent-route-cache': raw } })
    await broken.renderer.load()
    broken.renderer.mount('settings.section')
    broken.renderer.findButton('维护').props.onClick()
    await broken.renderer.flush()
    broken.renderer.findButton('子代理').props.onClick()
    await broken.renderer.flush()
    await broken.renderer.flush()
    assert.equal(broken.renderer.findByTestId('subagent-mode-inherit').props['aria-pressed'], 'true', `bad cache ${raw} must be ignored`)
    assert.equal(broken.renderer.findByTestId('subagent-section') !== undefined, true)
  }
})

test('subagent fallback list: load/add/move/remove rows and save ordered fallbacks with follow and custom modes', async () => {
  const { renderer, state } = createSubagentRenderer()
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()

  // inherit 无回退块；切到 follow 出现，初始为空提示。
  assert.equal(renderer.hasTest('subagent-fallback-block'), false)
  renderer.findByTestId('subagent-mode-follow').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('subagent-fallback-block'), true)
  assert.equal(renderer.hasTest('subagent-fallback-empty'), true)

  // 添加两条：默认取目录首项；第二条换供应商后模型联动。非排序模式下无箭头。
  renderer.findByTestId('subagent-fallback-add').props.onClick()
  await renderer.flush()
  renderer.findByTestId('subagent-fallback-add').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-fallback-provider-0').props.value, 'deepseek-official')
  assert.equal(renderer.hasTest('subagent-fallback-up-1'), false)
  renderer.findByTestId('subagent-fallback-provider-1').props.onChange({ target: { value: 'cpa' } })
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-fallback-model-1').props.value, 'gpt-5.6-sol')

  // 调整排序：开启后出现箭头（非文字按钮），▲ 上移第二条 → 顺序交换；再点完成退出。
  renderer.findByTestId('subagent-fallback-sort').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('subagent-fallback-up-1'), true)
  renderer.findByTestId('subagent-fallback-up-1').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-fallback-provider-0').props.value, 'cpa')
  renderer.findByTestId('subagent-fallback-sort').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('subagent-fallback-up-1'), false)
  // 移除第二条（deepseek）→ 只剩 cpa 一条。
  renderer.findByTestId('subagent-fallback-remove-1').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-fallback-provider-0').props.value, 'cpa')

  // 保存 follow 带回退列表。
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[0], { mode: 'follow', fallbacks: [{ provider: 'cpa', model: 'gpt-5.6-sol' }] })

  // custom 回落：回退列表由快照原样带回并随保存下发。
  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-provider').props.value, 'deepseek-official')
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[1], { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', fallbacks: [{ provider: 'cpa', model: 'gpt-5.6-sol' }] })
})

test('subagent tab is feature-gated and renders host errors/unavailable status in localized text', async () => {
  const disabled = createSubagentRenderer({ featureSettings: { subagentRoute: false } }).renderer
  await disabled.load()
  disabled.mount('settings.section')
  assert.doesNotMatch(disabled.text(disabled.findByTestId('service-tab-list')), /子代理/)
  assert.equal((disabled.registrations()['settings.section'] || []).some((entry) => entry.id === 'dsh-service-subagent'), false)

  const unavailable = createSubagentRenderer({ route: { available: false, mode: 'inherit' } }).renderer
  await unavailable.load()
  unavailable.mount('settings.section')
  unavailable.findButton('维护').props.onClick()
  await unavailable.flush()
  unavailable.findButton('子代理').props.onClick()
  await unavailable.flush()
  await unavailable.flush()
  assert.match(unavailable.findByTestId('subagent-unavailable').children.join(''), /subagents 服务缺席/)

  const failed = createSubagentRenderer({ saveError: 'invalid-model-route' }).renderer
  await failed.load()
  failed.mount('settings.section')
  failed.findButton('维护').props.onClick()
  await failed.flush()
  failed.findButton('子代理').props.onClick()
  await failed.flush()
  await failed.flush()
  failed.findByTestId('subagent-mode-custom').props.onClick()
  await failed.flush()
  await failed.flush()
  failed.findByTestId('subagent-save').props.onClick()
  await failed.flush()
  assert.match(failed.findByTestId('subagent-error').children.join(''), /不在宿主清单内/)
})

test('subagent reasoning effort: custom 显示选择器、选项只来自当前模型、空值默认、切换模型清空旧等级、inherit/follow 不显示', async () => {
  const reasoningModels = [
    { provider: 'deepseek-official', providerName: 'DeepSeek', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: 'More deliberate' }], defaultEffort: 'low' } },
    { provider: 'deepseek-official', providerName: 'DeepSeek', id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    { provider: 'cpa', providerName: 'CPA', id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
  ]
  const { renderer, state } = createSubagentRenderer({ models: reasoningModels })
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()

  // inherit 默认不显示 reasoning selector。
  assert.equal(renderer.hasTest('subagent-reasoning-effort'), false)
  // follow 也不显示。
  renderer.findByTestId('subagent-mode-follow').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('subagent-reasoning-effort'), false)

  // custom 显示选择器，选项来自当前模型的 reasoning.efforts。
  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  const select = renderer.findByTestId('subagent-reasoning-effort')
  assert.equal(select.props.disabled, false)
  assert.deepEqual(select.children.map((option) => option.props.value), ['', 'low', 'high'])
  assert.equal(select.children[0].children.join(''), '使用模型默认（不指定）')
  assert.equal(select.children[1].children.join(''), 'Low')
  assert.equal(select.children[2].children.join(''), 'High')
  assert.equal(select.children[2].props.title, 'More deliberate')

  // 默认空值 → payload 不含 reasoningEffort。
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[0], { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash' })

  // 选择非空等级 → payload 含 reasoningEffort。
  renderer.findByTestId('subagent-reasoning-effort').props.onChange({ target: { value: 'high' } })
  await renderer.flush()
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[1], { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })

  // 切换到没有可选等级的模型 → selector disabled + unavailable hint + 旧等级被清空。
  renderer.findByTestId('subagent-model').props.onChange({ target: { value: 'deepseek-v4-pro' } })
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-reasoning-effort').props.disabled, true)
  assert.equal(renderer.hasTest('subagent-reasoning-effort-unavailable'), true)
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[2], { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-pro' })
})

test('subagent reasoning effort: invalid-reasoning-effort 显示正确中文/英文错误', async () => {
  const { renderer } = createSubagentRenderer({ saveError: 'invalid-reasoning-effort' })
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('subagent-mode-custom').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('subagent-save').props.onClick()
  await renderer.flush()
  assert.match(renderer.findByTestId('subagent-error').children.join(''), /思考等级不受该模型支持/)
  renderer.setLocale('en')
  await renderer.flush()
  assert.match(renderer.findByTestId('subagent-error').children.join(''), /not supported by the selected model/)
})

test('plugins.bundle.config slot is registered for @gehennawu/dsh-service and renders on page view', async () => {
  const renderer = createRenderer(async () => ({ ok: true, value: {} }), {
    initiallyUnmounted: ['settings.section'],
    slotProps: {
      'plugins.bundle.config': { view: 'page' },
    },
  })
  await renderer.load()
  const entries = renderer.registrations()['plugins.bundle.config']
  assert.ok(entries.some((entry) => entry.key === '@gehennawu/dsh-service'), 'plugins.bundle.config registered for this package')
  renderer.mount('plugins.bundle.config')
  await renderer.flush()
  assert.match(renderer.text('plugins.bundle.config'), /服务控制（dsh-service）/, 'renders feature settings card on page view')

  // summary 视图时不渲染卡片本体（返回 null）
  const summaryRenderer = createRenderer(async () => ({ ok: true, value: {} }), {
    initiallyUnmounted: ['settings.section'],
    slotProps: {
      'plugins.bundle.config': { view: 'summary' },
    },
  })
  await summaryRenderer.load()
  summaryRenderer.mount('plugins.bundle.config')
  await summaryRenderer.flush()
  assert.equal(summaryRenderer.text('plugins.bundle.config'), '', 'renders null on summary view')
})

test('subagent line: route aggregation and line text assembly', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'subagent-dispatches') return { ok: true, value: { records: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  const utils = renderer.moduleExports().subagentLine
  assert.equal(typeof utils.aggregateSubagentRoutes, 'function')
  assert.equal(typeof utils.subagentRouteListText, 'function')
  // 聚合：按 provider/model/effort 去键、保持首个出现顺序、同名计数。
  const entries = utils.aggregateSubagentRoutes([
    { provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh', source: 'routed' },
    { provider: 'opencode-go', model: 'deepseek-v4-flash', reasoningEffort: 'max', source: 'routed' },
    { provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh', source: 'routed' },
    { provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'low', source: 'routed' },
    null,
    { provider: '', model: 'x' },
  ])
  assert.deepEqual(entries, [
    { provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh', count: 2 },
    { provider: 'opencode-go', model: 'deepseek-v4-flash', reasoningEffort: 'max', count: 1 },
    { provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'low', count: 1 },
  ])
  assert.equal(utils.aggregateSubagentRoutes(undefined).length, 0)
  assert.equal(utils.aggregateSubagentRoutes('nope').length, 0)
  // 行文本：effort 括号、×n 仅计数>1、条目间「 · 」。
  assert.equal(utils.subagentRouteListText(entries), 'cpa/gpt-5.6-luna (xhigh) ×2 · opencode-go/deepseek-v4-flash (max) · cpa/gpt-5.6-luna (low)')
  assert.equal(utils.subagentRouteListText([]), '')
  // 词典：zh/en 都有累计行词条；回合尾行移除后旧键（unknown/countOne/countMany）不得残留。
  const zh = renderer.dictionaries('dsh-service').zh
  const en = renderer.dictionaries('dsh-service').en
  assert.match(zh['subagent.dock.label'], /子代理：/)
  assert.match(en['subagent.dock.label'], /Subagents/)
  assert.equal('subagent.turnTail.label' in zh, false)
  assert.equal('subagent.turnTail.unknown' in zh, false)
  assert.equal('subagent.turnTail.countOne' in en, false)
  assert.ok(Object.keys(zh).every((key) => key in en), 'zh/en key sets must match')
})

test('subagent models dock row: session-level aggregate renders from dispatch records, polls on the timer chain, and is feature-gated', async () => {
  const calls = []
  let records = [
    { childId: 'c1', parentId: 'session-1', turn: 1, provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh', source: 'routed' },
    { childId: 'c2', parentId: 'session-1', turn: 2, provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh', source: 'routed' },
  ]
  let fail = false
  const renderer = createRenderer(async (channel, endpoint) => {
    calls.push(endpoint)
    if (endpoint === 'subagent-dispatches') {
      if (fail) throw new Error('boom')
      return { ok: true, value: { records } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  assert.ok(renderer.registrations()['conversation.composer.dock'].some((entry) => entry.id === 'dsh-service-subagent-models-dock'))
  renderer.mount('conversation.composer.dock')
  await renderer.flush()
  // 初始拉取 + 聚合文本（跨回合累计、×n 计数）。
  assert.equal(calls.filter((entry) => entry === 'subagent-dispatches').length, 1)
  assert.equal(renderer.findByTestId('subagent-models-dock').children.join(''), '子代理：cpa/gpt-5.6-luna (xhigh) ×2')
  // 布局契约：行挂输入卡下方 dock 行，flex:0 0 100% + order:1 独占官方统计（含上下文
  // 圆环）行的下一行（svcStyle 行级规则开 wrap + row-gap:0 两行贴紧），不与官方条目
  // 同行挤占、不把圆环挤到第三行；自身无顶部内边距。
  const dockStyle = renderer.findByTestId('subagent-models-dock').props.style
  assert.equal(dockStyle.flex, '0 0 100%')
  assert.equal(dockStyle.order, 1)
  assert.equal(dockStyle.textAlign, 'center')
  assert.equal(dockStyle.maxWidth, '100%')
  assert.equal(dockStyle.padding, '0 4px')

  // 轮询自续链：advanceTimer(20000) 推进一次（force 强刷绕过 TTL 去重）。
  await renderer.advanceTimer(20000)
  assert.equal(calls.filter((entry) => entry === 'subagent-dispatches').length, 2)

  // 缺 turn 的派发记录（宿主允许缺 turn）同样计入累计行（v1.1.2 发布前评审修复）。
  records = [
    ...records,
    { childId: 'c3', parentId: 'session-1', provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh', source: 'default' },
  ]
  await renderer.advanceTimer(20000)
  assert.equal(calls.filter((entry) => entry === 'subagent-dispatches').length, 3)
  assert.equal(renderer.findByTestId('subagent-models-dock').children.join(''), '子代理：cpa/gpt-5.6-luna (xhigh) ×3')

  // 轮询轮内 RPC 失败：沿用旧缓存、已显示的行不闪断（v1.1.2 发布前评审修复）。
  fail = true
  await renderer.advanceTimer(20000)
  assert.equal(calls.filter((entry) => entry === 'subagent-dispatches').length, 4)
  assert.equal(renderer.findByTestId('subagent-models-dock').children.join(''), '子代理：cpa/gpt-5.6-luna (xhigh) ×3')
  fail = false

  // 记录无 → 空渲染（null），不再有文本。
  records = []
  await renderer.advanceTimer(20000)
  await renderer.advanceTimer(20000)
  assert.equal(calls.filter((entry) => entry === 'subagent-dispatches').length, 6)
  assert.equal(renderer.text('conversation.composer.dock'), '')
  assert.equal(renderer.hasTest('subagent-models-dock'), false)

  // 路由功能关闭：条目注销。
  await renderer.setFeature('subagentRoute', false)
  assert.equal((renderer.registrations()['conversation.composer.dock'] ?? []).filter((item) => item.id === 'dsh-service-subagent-models-dock').length, 0)
  await renderer.setFeature('subagentRoute', true)
  assert.equal(renderer.registrations()['conversation.composer.dock'].some((item) => item.id === 'dsh-service-subagent-models-dock'), true)
  // 独立开关（v1.2）：subagentModelsDock 关闭同样注销；重开恢复。
  await renderer.setFeature('subagentModelsDock', false)
  assert.equal((renderer.registrations()['conversation.composer.dock'] ?? []).filter((item) => item.id === 'dsh-service-subagent-models-dock').length, 0)
  await renderer.setFeature('subagentModelsDock', true)
  assert.equal(renderer.registrations()['conversation.composer.dock'].some((item) => item.id === 'dsh-service-subagent-models-dock'), true)
})

test('subagent page: composer subagent-info toggle defaults on, flips the independent feature, and persists', async () => {
  const { renderer } = createSubagentRenderer()
  await renderer.load()
  renderer.mount('settings.section')
  renderer.findButton('维护').props.onClick()
  await renderer.flush()
  renderer.findButton('子代理').props.onClick()
  await renderer.flush()
  await renderer.flush()
  // 默认开（DEFAULT_FEATURES subagentModelsDock: true）。
  assert.equal(renderer.hasTest('subagent-dock-toggle-row'), true)
  assert.equal(renderer.findByTestId('subagent-dock-toggle').props['aria-checked'], 'true')
  assert.match(renderer.findByTestId('subagent-dock-toggle-row').children[0].children[0].children.join(''), /输入框下方显示子代理信息/)
  // 切换 → feature 落盘（harness featureScope.set）。
  renderer.findByTestId('subagent-dock-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.featureSettings().subagentModelsDock, false)
  assert.equal(renderer.findByTestId('subagent-dock-toggle').props['aria-checked'], 'false')
  // 再开回来。
  renderer.findByTestId('subagent-dock-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.featureSettings().subagentModelsDock, true)
  // 英文文案。
  renderer.setLocale('en')
  await renderer.flush()
  assert.match(renderer.findByTestId('subagent-dock-toggle-row').children[0].children[0].children.join(''), /Show subagent info under the composer/)
})

// ── v0.30 移动端适配·客户端引擎 ─────────────────────────────────────────────

test('mobile adaptation engine mounts drawer furniture on narrow viewport, wires official layout service, and tears down symmetrically', async () => {
  // 最小可用假 DOM：支持属性选择器查询、父子树与事件分发
  class FakeElement {
    constructor(tag) {
      this.tagName = tag
      this.children = []
      this.attributes = new Map()
      this.style = {}
      this.dataset = {}
      this.parentNode = null
      this.className = ''
      this.listeners = new Map()
    }
    get isConnected() {
      let node = this
      while (node.parentNode !== null) node = node.parentNode
      return node === root
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child }
    remove() {
      if (this.parentNode === null) return
      const index = this.parentNode.children.indexOf(this)
      if (index >= 0) this.parentNode.children.splice(index, 1)
      this.parentNode = null
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
    hasAttribute(name) { return this.attributes.has(name) }
    removeAttribute(name) { this.attributes.delete(name) }
    addEventListener(type, handler) { (this.listeners.get(type) || this.listeners.set(type, new Set()).get(type)).add(handler) }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler) }
    dispatch(type, event) { for (const handler of this.listeners.get(type) || []) handler(event || {}) }
  }
  const matchesSelector = (el, selector) => {
    for (const part of selector.split(',')) {
      const trimmed = part.trim()
      const match = /^\[([a-z-]+)\]$/i.exec(trimmed)
      if (match && el.attributes.has(match[1])) return true
    }
    return false
  }
  const walk = (node, visit_) => { visit_(node); for (const child of node.children) walk(child, visit_) }

  const root = new FakeElement('#root')
  const head = new FakeElement('head'); root.appendChild(head)
  const bodyEl = new FakeElement('body'); root.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); root.appendChild(htmlEl)

  // 外壳骨架：frame（含官方 data-shell-overlay 子层）+ 三栏
  const frame = new FakeElement('div')
  frame.className = 'pI_x6G_frame'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-details-collapsed', '')
  const sidebarCol = new FakeElement('div'); sidebarCol.className = 'pI_x6G_sidebarCol'
  const centerCol = new FakeElement('div'); centerCol.className = 'pI_x6G_centerCol'
  const detailsCol = new FakeElement('div'); detailsCol.className = 'pI_x6G_detailsCol'
  const overlayLayer = new FakeElement('div'); overlayLayer.setAttribute('data-shell-overlay', '')
  for (const el of [sidebarCol, centerCol, detailsCol, overlayLayer]) frame.appendChild(el)
  bodyEl.appendChild(frame)

  let observerInstance = null
  class FakeMutationObserver {
    constructor(callback) { observerInstance = callback }
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    documentElement: htmlEl,
    head,
    body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      let found = null
      for (const tree of [htmlEl, head, bodyEl]) {
        walk(tree, (el) => { if (found === null && el !== tree ? false : false) {} })
      }
      walk(root, (el) => { if (found === null && matchesSelector(el, selector)) found = el })
      return found
    },
    querySelectorAll(selector) {
      const found = []
      walk(root, (el) => { if (matchesSelector(el, selector)) found.push(el) })
      return found
    },
  }

  const layoutCalls = { toggleSidebar: 0, closeDetails: 0 }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }

  const realDateNow = Date.now
  try {
    const renderer = createRenderer(rpc, { featureSettings: { mobileAdaptation: true }, services: { layout: {
      toggleSidebar() { layoutCalls.toggleSidebar += 1 },
      closeDetails() { layoutCalls.closeDetails += 1 },
    } } })
    // createRenderer 会重置 window，matchMedia 桩必须在其后、load 之前装上。
  const mediaListeners = new Set()
  let narrowViewport = false
  globalThis.window.matchMedia = (query) => ({
    media: query,
    get matches() { return narrowViewport },
    addEventListener(type, listener) { mediaListeners.add(listener) },
    removeEventListener(type, listener) { mediaListeners.delete(listener) },
  })

    await renderer.load()

    // 宽视口：零挂载（head 里可能有插件自带的导航图标样式，只断言引擎产物不存在）
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), false)
    assert.equal(head.children.some((el) => el.textContent?.includes('data-dshsvc-mobile')), false)
    assert.equal(frame.attributes.has('data-dshsvc-frame'), false)

    // 进入窄视口 → 引擎激活：作用域属性、样式表、三栏标记、backdrop/FAB 全部就位
    narrowViewport = true
    for (const listener of mediaListeners) listener()
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), true)
    assert.equal(frame.attributes.has('data-dshsvc-frame'), true)
    assert.equal(sidebarCol.attributes.has('data-dshsvc-sidebar'), true)
    assert.equal(centerCol.attributes.has('data-dshsvc-center'), true)
    assert.equal(detailsCol.attributes.has('data-dshsvc-details'), true)
    const styleTag = head.children.find((el) => el.textContent.includes('data-dshsvc-mobile'))
    assert.notEqual(styleTag, undefined)
    // 真机反馈两处：抽屉钮钉左上角（头部预留位），设置标签条横滑
    assert.match(styleTag.textContent, /data-dshsvc-fab\]:hover/)
    assert.match(styleTag.textContent, /nth-child\(2\) header \{ padding: 10px 20px 0 46px/)
    // 顶栏移动端适配（2026-09-19）：右内边距 28→20、utilities 左距 20→4、
    // titleCluster 列距 10→6、计数组列距 10→4 且 flex:none 不可挤压
    // （:not(:has(switcherTrigger)) 守卫 lineage 切换器根），标题吃掉全部富余
    assert.match(styleTag.textContent, /\[class\*="wSkVaW_headerUtilities"\] \{ margin-left: 4px !important; \}/)
    assert.match(styleTag.textContent, /\[class\*="wSkVaW_titleCluster"\] \{ gap: 6px !important; \}/)
    assert.match(styleTag.textContent, /\[class\*="ZKlsPq_root"\] \{ gap: 4px !important; \}/)
    assert.match(styleTag.textContent, /\[class\*="ZKlsPq_root"\]:not\(:has\(\[class\*="ZKlsPq_switcherTrigger"\]\)\) \{ flex: none !important; \}/)
    // 动作芯片泊位 v2（方案二，2026-09-19 用户定稿）：模式回标题行（headerActions
    // 保持官方在流不泊），子代理+任务两枚计数芯片 ≤560 右锚泊入标签行成对
    // （任务 right:106 让出右侧 90px 给子代理 right:16，间隔 ~8.5px；箭头保留），标签行 gap 36→20，
    // 箭头/分隔符隐藏、菜单右锚、计数可省略；>560 保持官方在流
    const parkingGroup = styleTag.textContent.match(
      /@media \(max-width: 560px\) \{\s*html\[data-dshsvc-mobile\] \[data-dshsvc-frame\] > :nth-child\(2\) header:not\(\[class\*="wSkVaW_headerBlank"\]\) \{ position: relative !important; \}[\s\S]*?\n\}/,
    )
    assert.notEqual(parkingGroup, null, 'header chip parking must be gated by the 560px media query')
    assert.match(parkingGroup[0], /\[class\*="wSkVaW_tabs"\] \{ gap: 20px !important; \}/)
    assert.match(parkingGroup[0], /\[class\*="QsffPG_root"\] \{[^}]*right: 106px !important/s)
    assert.match(parkingGroup[0], /\[class\*="QsffPG_root"\] \{[^}]*max-width: calc\(100vw - 240px\) !important/s)
    assert.match(parkingGroup[0], /\[class\*="ZKlsPq_root"\]:not\(:has\(\[class\*="ZKlsPq_switcherTrigger"\]\)\) \{[^}]*right: 16px !important/s)
    assert.match(parkingGroup[0], /\[class\*="ZKlsPq_root"\]:not\(:has\(\[class\*="ZKlsPq_switcherTrigger"\]\)\) \[class\*="ZKlsPq_separator"\] \{ display: none !important; \}/)
    // 下拉箭头保留（用户点名恢复），仅钉 flex:none 防被压
    assert.match(parkingGroup[0], /\[class\*="QsffPG_trigger"\] > svg:last-child,\s*html\[data-dshsvc-mobile\] \[class\*="ZKlsPq_root"\]:not\(:has\(\[class\*="ZKlsPq_switcherTrigger"\]\)\) \[class\*="ZKlsPq_trigger"\] > svg:last-child \{ flex: none !important; \}/)
    assert.doesNotMatch(parkingGroup[0], /svg:last-child \{ display: none !important; \}/, 'chevrons must stay visible on the parked chips')
    assert.match(parkingGroup[0], /\[class\*="QsffPG_count"\] \{[^}]*text-overflow: ellipsis !important/s)
    // 预设芯片右靠贴住更多钮：margin-left:auto 把富余收到标题与动作组之间
    assert.match(parkingGroup[0], /header:not\(\[class\*="wSkVaW_headerBlank"\]\) \[class\*="wSkVaW_headerActions"\] \{ margin-left: auto !important; \}/)
    assert.match(parkingGroup[0], /\[class\*="QsffPG_menu"\],\s*html\[data-dshsvc-mobile\] \[class\*="ZKlsPq_menu"\] \{[^}]*left: auto !important/s)
    assert.match(parkingGroup[0], /\[class\*="QsffPG_menu"\],\s*html\[data-dshsvc-mobile\] \[class\*="ZKlsPq_menu"\] \{[^}]*max-width: calc\(100vw - 122px\) !important/s)
    // 方案二：headerActions（预设芯片所在）必须保持官方在流，不得整体泊动
    assert.doesNotMatch(parkingGroup[0], /wSkVaW_headerActions"\] \{[^}]*position: absolute/, 'headerActions must stay in-flow so the preset chip remains in the title row')
    assert.doesNotMatch(styleTag.textContent, /\nhtml\[data-dshsvc-mobile\] \[class\*="QsffPG_root"\] \{ position: absolute/, 'ungated parking rule would also hit 561~1023px windows')
    // Agent Team 弹窗右锚（2026-09-20）：官方 TeamAction 面板自带 left:0，
    // 挂在头部右侧的 header.actions 槽上会整体右移越屏。三条断言锁死修法：
    // ① 头部（引擎稳定标记）成为定位上下文；② 触发钮根让出包含块；
    // ③ 面板改右锚 16px 并按 100vw−32px 封顶。
    // 必须无 @media 门：≥561px 官方头部是 static，只在 ≤560 修会漏掉 561~1023。
    assert.match(styleTag.textContent, /html\[data-dshsvc-mobile\] \[data-dshsvc-chat-header\] \{ position: relative !important; \}/)
    assert.match(styleTag.textContent, /html\[data-dshsvc-mobile\] \[data-team-action\] \{ position: static !important; \}/)
    assert.match(styleTag.textContent, /\[data-team-action\] \[role="dialog"\] \{[^}]*left: auto !important/s)
    assert.match(styleTag.textContent, /\[data-team-action\] \[role="dialog"\] \{[^}]*right: 16px !important/s)
    assert.match(styleTag.textContent, /\[data-team-action\] \[role="dialog"\] \{[^}]*max-width: calc\(100vw - 32px\) !important/s)
    // 不得落进 ≤560 泊位门：561~1023 官方头部是 static，只有把 position:relative
    // 覆盖到整个移动端，面板才不会落到页面流底部。泊位组里只应出现已有的
    // header chip parking 规则，不应出现 data-team-action。
    assert.doesNotMatch(parkingGroup[0], /data-team-action/, 'Agent Team panel rule must not be trapped inside the 560px parking gate')
    // 真机反馈第二轮根因：左右列 absolute 后退出 grid 流，三列必须显式钉位防中列掉进 0px 轨
    assert.match(styleTag.textContent, /\[data-dshsvc-sidebar\] \{ grid-column: 1 !important; grid-row: 1 !important; \}/)
    assert.match(styleTag.textContent, /\[data-dshsvc-center\] \{ grid-column: 2 !important; grid-row: 1 !important; \}/)
    assert.match(styleTag.textContent, /\[data-dshsvc-details\] \{ grid-column: 3 !important; grid-row: 1 !important; \}/)
    // 真机反馈第二轮：模态顶部贴顶不留空（全屏面板），市场分区不吞标签条，统计条横滑
    assert.match(styleTag.textContent, /\[role="dialog"\]\[aria-modal="true"\] \{[^}]*flex-direction: column/s)
    assert.match(styleTag.textContent, /\[role="dialog"\]\[aria-modal="true"\] \{[^}]*top: 0 !important/s)
    assert.match(styleTag.textContent, /\[role="dialog"\]\[aria-modal="true"\] \{[^}]*max-height: none !important/s)
    assert.match(styleTag.textContent, /\[role="dialog"\]\[aria-modal="true"\] \{[^}]*border-radius: 0 !important/s)
    assert.match(styleTag.textContent, /\[role="dialog"\]:has\(\[data-dsh-market-root\]\) > nav \{ display: flex !important; \}/)
    assert.match(styleTag.textContent, /\[class\*="NDN2W_root"\] \{[^}]*overflow-x: auto !important/s)
    // 真机反馈：消息尾部元信息行用「回合尾节点稳定属性 data-turn-tail + 末位子项」
    // 结构定位（0.1.2-alpha.2 起官方把聊天视图迁进 dsh-client-ui-chat，
    // data-time-hover-root 已删除），不依赖会随 DSH 构建漂移的 CSS-module 哈希类名。
    assert.match(styleTag.textContent, /\[data-chat-flow-kind="turn-tail"\] \[data-turn-tail\] > :last-child \{[^}]*min-width: 0 !important/s)
    assert.match(styleTag.textContent, /\[data-chat-flow-kind="turn-tail"\] \[data-turn-tail\] > :last-child > span:last-child \{[^}]*flex: 1 1 auto !important/s)
    assert.doesNotMatch(styleTag.textContent, /p-xYUq_/)
    assert.match(styleTag.textContent, /\[role="dialog"\] \[class\*="navList"\] \{ flex-direction: row/)
    // 真机反馈第三轮：设置模态长在侧栏子树内（未 portal），抽屉隐藏禁用 transform
    // （transform 会造包含块把 fixed 模态锁进抽屉宽度），一律用 left/right 偏移。
    assert.doesNotMatch(styleTag.textContent, /data-dshsvc-(sidebar|details)\]\s*\{[^}]*transform/s)
    // 真机第六轮：钉位使 abs 子项包含块=0px grid area，百分比偏移对 0 宽取值失效、
    // 元素被超约束解算推回屏内盖住会话 —— 离屏偏移必须用 vw 长度。
    // 注：-105% 与 sidebar/details 上的 transform 仍全局禁止；悬浮按钮簇的
    // translateX 位移规则（Task A 右移）不在此列 —— 只作用于 34px 小按钮、
    // 不参与离屏布局，故断言收窄到列级。
    assert.doesNotMatch(styleTag.textContent, /-105%|data-dshsvc-(sidebar|details)\]\s*\{[^}]*translateX/s)
    assert.match(styleTag.textContent, /\[data-dshsvc-sidebar\] \{[^}]*left: calc\(-100vw - 24px\) !important/s)
    // 真机第九轮：外壳侧栏内容原生固定 280px；外层拉到 320px 会在右侧造出 40px 空带。
    assert.match(styleTag.textContent, /\[data-dshsvc-sidebar\] \{[^}]*width: min\(100vw, 280px\) !important/s)
    assert.match(styleTag.textContent, /\[data-dshsvc-sidebar\] \{[^}]*border-right: none !important/s)
    assert.match(styleTag.textContent, /\[data-dshsvc-details\] \{[^}]*right: calc\(-100vw - 24px\) !important/s)
    // 真机第五轮：详情列移动端永久离屏（官方窄屏本就 0 宽），不得存在「打开态」规则
    assert.doesNotMatch(styleTag.textContent, /:not\(\[data-details-collapsed\]\) \[data-dshsvc-details\]/)
    assert.match(styleTag.textContent, /:not\(\[data-sidebar-collapsed\]\) \[data-dshsvc-sidebar\] \{[^}]*left: 0 !important/s)
    assert.match(styleTag.textContent, /\[role="dialog"\]\[aria-modal="true"\] \{[^}]*height: 100% !important/s)
    // 真机第七轮：模态打开藏抽屉钮、关闭钮钉右上角（导航条让位）、composer 底行禁换行
    assert.match(styleTag.textContent, /body:has\(\[role="dialog"\]\[aria-modal="true"\]\) \[data-dshsvc-fab\] \{[^}]*display: none !important/s)
    // 2026-09-15 用户点名：移除底部沉浸把手（常驻小胶囊钮）——DOM/样式/词典全清
    assert.doesNotMatch(styleTag.textContent, /data-dshsvc-handle/)
    assert.match(styleTag.textContent, /\[class\*="VOzbGW_close"\] \{[^}]*position: absolute !important/s)
    assert.doesNotMatch(styleTag.textContent, /\[role="dialog"\] nav \{[^}]*padding: 8px 12px/s)
    assert.doesNotMatch(styleTag.textContent, /\[class\*="uV2eYG_row"\] \{[^}]*flex-wrap: wrap/s)
    assert.match(styleTag.textContent, /\[class\*="Sh0Q9G_trigger"\],\s*html\[data-dshsvc-mobile\] \[class\*="JObwrW_trigger"\] \{ max-width: 38vw !important; \}/)
    // 真机第八轮：设置关闭钮圆形底衬随钮置顶；工作区侧板开关浮在面板上方。
    assert.match(styleTag.textContent, /\[class\*="VOzbGW_close"\] \{[^}]*border-radius: 999px !important/s)
    assert.match(styleTag.textContent, /\[class\*="nArs4W_toggleButton"\] \{[^}]*z-index: 45 !important/s)
    // 用户点名（2026-09-15）：模型选择按钮在手机上收成图标。官方只在容器 ≤360px
    // 收起，而插件移动端收回官方 56px sidebar rail 把行内容盒顶到 368~378px
    // （430/440 机型），官方规则永不触发 —— 显式按官方窄容器形态覆盖，
    // 且整组必须被 ≤480px 媒体查询包裹（481~1023px 的窄窗口/平板保持显示名称）。
    const modelSelectGroup = styleTag.textContent.match(
      /@media \(max-width: 480px\) \{\s*html\[data-dshsvc-mobile\] \[class\*="_7KE1Ra_triggerIcon"\] \{ display: block !important; \}[\s\S]*?\n\}/,
    )
    assert.notEqual(modelSelectGroup, null, 'model-select icon collapse must be gated by the 480px media query')
    assert.match(modelSelectGroup[0], /\[class\*="_7KE1Ra_triggerLabel"\],\s*html\[data-dshsvc-mobile\] \[class\*="_7KE1Ra_triggerEffort"\] \{ display: none !important; \}/)
    assert.doesNotMatch(styleTag.textContent, /\nhtml\[data-dshsvc-mobile\] \[class\*="_7KE1Ra_triggerIcon"\]/, 'ungated model-select rule would also hit 481~1023px windows')
    // 死规则审计（2026-09-15）：0.1.5-rc.2 外壳已无含 toolbar/inputTriggers 的类名
    // （活页面命中 0），两条泛化空转规则清理；"composer" 仍命中（composerSeat）保留。
    assert.doesNotMatch(styleTag.textContent, /\nhtml\[data-dshsvc-mobile\] \[class\*="toolbar" i\]/)
    assert.doesNotMatch(styleTag.textContent, /\nhtml\[data-dshsvc-mobile\] \[class\*="inputTriggers" i\]/)
    assert.match(styleTag.textContent, /\[class\*="composer" i\] \{ min-width: 0 !important; max-width: 100% !important; \}/)
    // 统计条与外部上下文圆环（2026-09-15 / 2026-09-18 用户点名「保证一行可以显示完」）：
    // 0.1.6 官方把上下文圆环移入输入框外部下方的 uV2eYG_dock，与统计胶囊并列。
    // 收紧 uV2eYG_root/dock 间距与内边距，降字号至 11px（≤375px 降至 10px）；官方条目
    // 仍共占一行（列距 3px），子代理累计行独占第二行且行距归零（row-gap 0）。
    assert.match(styleTag.textContent, /\[class\*="uV2eYG_root"\] \{[^}]*padding-left: 8px !important/s)
    assert.match(styleTag.textContent, /\[class\*="uV2eYG_dock"\] \{[^}]*gap: 0 3px !important/s)
    assert.match(styleTag.textContent, /\[class\*="uV2eYG_dock"\] \{[^}]*flex-wrap: wrap !important/s)
    assert.match(styleTag.textContent, /\[class\*="NDN2W_root"\] \{[^}]*overflow-x: auto !important/s)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_root"\] \{[^}]*flex-wrap: nowrap !important/s)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_root"\] \{[^}]*padding-left: 2px !important/s)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_root"\] \{[^}]*column-gap: 3px !important/s)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_root"\] \{[^}]*font-size: 11px !important/s)
    assert.doesNotMatch(styleTag.textContent, /\[class\*="bOPqQW_root"\] \{[^}]*flex-wrap: wrap !important/s)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_root"\] > \* \{ flex: 1 1 auto !important; min-width: 0 !important; \}/)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_pill"\] \{[^}]*padding-left: 2px !important/s)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_pill"\] \{[^}]*font-size: 11px !important/s)
    assert.match(styleTag.textContent, /\[class\*="bOPqQW_label"\] \{[^}]*text-overflow: ellipsis !important/s)
    assert.match(styleTag.textContent, /\[class\*="JObwrW_trigger"\] \{[^}]*font-size: 11px !important/s)
    assert.match(styleTag.textContent, /@media \(max-width: 375px\) \{[^}]*font-size: 10px !important/s)
    const backdrop = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-backdrop'))
    const fab = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-fab'))
    assert.notEqual(backdrop, undefined)
    assert.notEqual(fab, undefined)
    assert.equal(fab.getAttribute('aria-label'), '打开侧栏菜单')
    assert.match(fab.style.left, /safe-area-inset-left/)
    assert.match(fab.style.top, /safe-area-inset-top/)
    assert.equal(fab.style.width, '32px')
    assert.ok(fab.innerHTML.includes('<svg'), 'drawer toggle must render an icon, not text')
    // 初始折叠：抽屉关 → backdrop 藏、FAB 显
    assert.equal(backdrop.style.display, 'none')
    assert.equal(fab.style.display, 'flex')

    // 真机触屏短按会派发 pointerdown → pointerup → click；无论 click 延迟多久，
    // 同一手势都只能翻转一次。旧实现以 350ms 时间窗区分回声，主线程忙时 click
    // 晚到就二次翻转，短按看起来打不开、长按取消 click 反而能打开。
    let now = 10_000
    Date.now = () => now
    fab.dispatch('pointerdown', { pointerType: 'touch', button: 0 })
    now += 500
    fab.dispatch('click', { detail: 1 })
    assert.equal(layoutCalls.toggleSidebar, 1)
    frame.removeAttribute('data-sidebar-collapsed')
    observerInstance([], () => {})
    assert.equal(backdrop.style.display, 'block')
    assert.equal(fab.style.display, 'none', 'open drawer must hide the fab (close via native toggle / scrim tap)')
    assert.equal(fab.getAttribute('aria-label'), '打开侧栏菜单')

    // 侧栏内容层不得再代理关闭。原生右上角按钮自身先 toggle，若事件冒泡到
    // sidebarCol 又 toggle 一次，就会关闭后立即重开；普通条目点击也不该被劫持。
    sidebarCol.dispatch('click')
    assert.equal(layoutCalls.toggleSidebar, 1)

    // backdrop 点击：抽屉开着时收抽屉
    frame.removeAttribute('data-sidebar-collapsed')
    observerInstance([], () => {})
    backdrop.dispatch('click')
    assert.equal(layoutCalls.toggleSidebar, 2)

    // 只有详情列场景：移动端详情列永久离屏，引擎自愈式 closeDetails，backdrop 不参与
    frame.setAttribute('data-sidebar-collapsed', '')
    frame.removeAttribute('data-details-collapsed')
    observerInstance([], () => {})
    assert.equal(layoutCalls.closeDetails, 1)
    assert.equal(backdrop.style.display, 'none')

    // 功能开关热关闭：全量卸载
    await renderer.setFeature?.('mobileAdaptation', false)
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), false)
    assert.equal(head.children.some((el) => el.textContent.includes('data-dshsvc-mobile')), false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-fab')), false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-backdrop')), false)
    assert.equal(frame.attributes.has('data-dshsvc-frame'), false)
    assert.equal(sidebarCol.attributes.has('data-dshsvc-sidebar'), false)
    assert.equal(centerCol.attributes.has('data-dshsvc-center'), false)

    // 热重开即时恢复
    await renderer.setFeature?.('mobileAdaptation', true)
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), true)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-fab')), true)
    assert.equal(frame.attributes.has('data-dshsvc-frame'), true)

    // 回到宽视口 → 再次卸载
    narrowViewport = false
    for (const listener of mediaListeners) listener()
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-fab')), false)
  } finally {
    Date.now = realDateNow
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

test('mobile adaptation 0.1.5 rightbar mode: official rightbar drives the right drawer while legacy details stays retired', async () => {
  // 0.1.5 影响报告 §4：官方 layout 移除 Details 列（openDetails/closeDetails、
  // data-details-collapsed、detailsCol 全部消失），改为 rightbarCol + data-rightbar-*。
  // 引擎按 layout 服务能力判形态：新宿主右缘手势驱动 ctx.layout.openRightbar/closeRightbar，
  // FAB 随 rightbarOpen 让位；旧宿主 data-details-collapsed 语义原样保留（双形态）。
  class FakeElement {
    constructor(tag) {
      this.tagName = tag
      this.children = []
      this.attributes = new Map()
      this.style = {}
      this.dataset = {}
      this.parentNode = null
      this.className = ''
      this.listeners = new Map()
      this.scrollWidth = 0
      this.clientWidth = 0
    }
    get isConnected() {
      let node = this
      while (node.parentNode !== null) node = node.parentNode
      return node === root
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child }
    remove() {
      if (this.parentNode === null) return
      const index = this.parentNode.children.indexOf(this)
      if (index >= 0) this.parentNode.children.splice(index, 1)
      this.parentNode = null
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
    hasAttribute(name) { return this.attributes.has(name) }
    removeAttribute(name) { this.attributes.delete(name) }
    addEventListener(type, handler) { (this.listeners.get(type) || this.listeners.set(type, new Set()).get(type)).add(handler) }
    dispatch(type, event) { for (const handler of this.listeners.get(type) || []) handler(event || {}) }
    click() { this.dispatch('click', {}) }
  }
  const matchesSelector = (el, selector) => {
    for (const part of selector.split(',')) {
      const pairs = part.trim().match(/\[([a-z-]+)(?:="([^"]*)")?\]/gi)
      if (pairs === null) continue
      if (pairs.join('') !== part.trim()) continue
      const ok = pairs.every((pair) => {
        const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/i.exec(pair)
        if (m === null) return false
        if (m[2] === undefined) return el.attributes.has(m[1])
        return el.attributes.get(m[1]) === m[2]
      })
      if (ok) return true
    }
    return false
  }
  const walk = (node, visit_) => { visit_(node); for (const child of node.children) walk(child, visit_) }

  const root = new FakeElement('#root')
  const head = new FakeElement('head'); root.appendChild(head)
  const bodyEl = new FakeElement('body'); root.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); root.appendChild(htmlEl)

  // 0.1.5 外壳骨架：frame（侧栏/右栏均折叠态）+ rightbarCol 三栏 + overlay 子层。
  // 刻意不带 data-details-collapsed 与 detailsCol——旧代码在此会读出 detailsOpen 恒真。
  const frame = new FakeElement('div')
  frame.className = 'f_frame'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-rightbar-collapsed', '')
  const sidebarCol = new FakeElement('div'); sidebarCol.className = 'f_sidebarCol'
  const centerCol = new FakeElement('div'); centerCol.className = 'f_centerCol'
  const rightbarCol = new FakeElement('div'); rightbarCol.className = 'f_rightbarCol'; rightbarCol.setAttribute('data-rightbar-col', '')
  const overlayLayer = new FakeElement('div'); overlayLayer.setAttribute('data-shell-overlay', '')
  for (const el of [sidebarCol, centerCol, rightbarCol, overlayLayer]) frame.appendChild(el)
  bodyEl.appendChild(frame)

  // 官方右栏展开与收起组件夹具：折叠时挂载 expand 钮，展开时挂载 panel 与 toggle 钮
  const expandBtn = new FakeElement('button'); expandBtn.setAttribute('data-sidebar-right-expand', '')
  const toggleBtn = new FakeElement('button'); toggleBtn.setAttribute('data-sidebar-right-toggle', '')
  const rightbarPanel = new FakeElement('div'); rightbarPanel.setAttribute('data-sidebar-right-panel', 'fullscreen')
  rightbarPanel.setAttribute('data-sidebar-right-open', '')
  rightbarPanel.appendChild(toggleBtn)
  bodyEl.appendChild(expandBtn)
  expandBtn.addEventListener('click', () => { layoutCalls.openRightbar.push([false, true]) })
  toggleBtn.addEventListener('click', () => { layoutCalls.closeRightbar += 1 })

  const observerCallbacks = []
  const observeCalls = []
  class FakeMutationObserver {
    constructor(callback) { observerCallbacks.push(callback) }
    observe(target, options) { observeCalls.push({ target, options }) }
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    documentElement: htmlEl,
    head,
    body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      let found = null
      walk(root, (el) => { if (found === null && matchesSelector(el, selector)) found = el })
      return found
    },
    querySelectorAll(selector) {
      const found = []
      walk(root, (el) => { if (matchesSelector(el, selector)) found.push(el) })
      return found
    },
  }

  const layoutCalls = { toggleSidebar: 0, openRightbar: [], closeRightbar: 0 }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.5-rc.1', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true, upstreamManaged: false } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }

  try {
    const renderer = createRenderer(rpc, { featureSettings: { mobileAdaptation: true }, services: { layout: {
      toggleSidebar() { layoutCalls.toggleSidebar += 1 },
      openRightbar(track, fullscreen) { layoutCalls.openRightbar.push([track, fullscreen]) },
      closeRightbar() { layoutCalls.closeRightbar += 1 },
    } } })
    globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    globalThis.window.innerWidth = 390
    globalThis.window.location = { search: '?dshsvc-mobile-debug=1', reload() {} }
    const windowListeners = new Map()
    globalThis.window.addEventListener = (type, handler) => {
      ;(windowListeners.get(type) || windowListeners.set(type, new Set()).get(type)).add(handler)
    }
    globalThis.window.removeEventListener = (type, handler) => { windowListeners.get(type)?.delete(handler) }
    globalThis.getComputedStyle = () => ({ overflowX: 'hidden' })
    await renderer.load()

    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), true)
    const fab = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-fab'))
    assert.notEqual(fab, undefined)
    const chipText = () => {
      const chip = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-debug'))
      return chip !== undefined && chip.textContent !== undefined ? chip.textContent : ''
    }
    const sync = () => observerCallbacks[observerCallbacks.length - 1]([], () => {})
    const touchAt = (x, y) => ({ touches: [{ clientX: x, clientY: y }], target: null })

    // frame 观察者订阅 data-rightbar-collapsed（右栏开合主驱动）
    const frameObserve = observeCalls.map((entry) => entry.options).find((options) => Array.isArray(options?.attributeFilter) && options.attributeFilter.includes('data-rightbar-collapsed'))
    assert.notEqual(frameObserve, undefined, 'the frame observer must track data-rightbar-collapsed')

    // 双关闭态：FAB 可见；新形态下 detailsOpen 恒关（frame 无 data-details-collapsed 不再误报常开）
    assert.equal(fab.style.display, 'flex')
    assert.match(chipText(), /预览列 关/)
    assert.match(chipText(), /右栏 关/)

    // —— 1. 右缘左滑开官方右栏：openRightbar(false, true)（窄屏浮层全屏语义）——
    htmlEl.dispatch('touchstart', touchAt(388, 300))
    htmlEl.dispatch('touchmove', touchAt(360, 298))
    htmlEl.dispatch('touchmove', touchAt(326, 298))
    assert.deepEqual(layoutCalls.openRightbar, [[false, true]], 'right-edge leftward swipe opens the official rightbar in fullscreen-float mode')
    assert.match(chipText(), /右开/)
    expandBtn.remove()
    bodyEl.appendChild(rightbarPanel)
    frame.removeAttribute('data-rightbar-collapsed')
    sync()
    assert.equal(fab.style.display, 'none', 'official rightbar open must hide the fab')
    assert.match(chipText(), /右栏 开/)

    // —— 2. 右栏开着：任意起点右往左滑关闭 closeRightbar ——
    htmlEl.dispatch('touchstart', touchAt(120, 300))
    htmlEl.dispatch('touchmove', touchAt(185, 300))
    assert.equal(layoutCalls.closeRightbar, 1, 'rightward swipe anywhere closes the open official rightbar')
    rightbarPanel.remove()
    bodyEl.appendChild(expandBtn)
    frame.setAttribute('data-rightbar-collapsed', '')
    sync()
    assert.equal(fab.style.display, 'flex')

    // —— 3. 左抽屉语义不受影响 ——
    htmlEl.dispatch('touchstart', touchAt(6, 300))
    htmlEl.dispatch('touchmove', touchAt(64, 302))
    assert.equal(layoutCalls.toggleSidebar, 1, 'left drawer gestures are untouched in rightbar mode')

    // —— 4. 卸载对称：data-dshsvc-rightbar 标记随手势件一起摘除 ——
    await renderer.setFeature('mobileAdaptation', false)
    assert.equal(frame.attributes.has('data-dshsvc-rightbar'), false, 'rightbar markers are removed on teardown')
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), false)
  } finally {
    delete globalThis.MutationObserver
    delete globalThis.document
    delete globalThis.window.matchMedia
    delete globalThis.window.innerWidth
    delete globalThis.window.location
    delete globalThis.window.addEventListener
    delete globalThis.window.removeEventListener
    delete globalThis.getComputedStyle
  }
})

test('mobile adaptation debug chip renders diagnostics and counts JS errors only with the debug param', async () => {
  class FakeElement {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = new Map()
      this.style = {}; this.dataset = {}; this.parentNode = null; this.className = ''; this.listeners = new Map()
    }
    get isConnected() { let n = this; while (n.parentNode !== null) n = n.parentNode; return n === rootNode }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c }
    remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null } }
    setAttribute(k, v) { this.attributes.set(k, String(v)) }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null }
    hasAttribute(k) { return this.attributes.has(k) }
    removeAttribute(k) { this.attributes.delete(k) }
    addEventListener(t, h) { (this.listeners.get(t) || this.listeners.set(t, new Set()).get(t)).add(h) }
    removeEventListener(t, h) { this.listeners.get(t)?.delete(h) }
    dispatch(t) { for (const h of this.listeners.get(t) || []) h({}) }
  }
  const rootNode = new FakeElement('#root')
  const head = new FakeElement('head'); rootNode.appendChild(head)
  const bodyEl = new FakeElement('body'); rootNode.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); rootNode.appendChild(htmlEl)
  const frame = new FakeElement('div'); frame.className = 'pI_x6G_frame'; frame.setAttribute('data-sidebar-collapsed', '')
  const sidebarCol = new FakeElement('div'); sidebarCol.className = 'sidebarCol'; frame.appendChild(sidebarCol)
  const centerCol = new FakeElement('div'); centerCol.className = 'centerCol'; frame.appendChild(centerCol)
  const detailsCol = new FakeElement('div'); detailsCol.className = 'detailsCol'; frame.appendChild(detailsCol)
  const overlayLayer = new FakeElement('div'); overlayLayer.setAttribute('data-shell-overlay', ''); frame.appendChild(overlayLayer)
  bodyEl.appendChild(frame)

  class FakeMutationObserver { constructor() {} observe() {} disconnect() {} }
  globalThis.MutationObserver = FakeMutationObserver
  const windowListeners = new Map()
  globalThis.document = {
    documentElement: htmlEl, head, body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      let found = null
      const scan = (node) => { if (found === null && node.attributes?.has?.(selector.replace(/[[\]]/g, ''))) found = node; for (const c of node.children || []) scan(c) }
      scan(rootNode)
      return found
    },
    querySelectorAll() { return [] },
  }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
  try {
    const renderer = createRenderer(rpc, { featureSettings: { mobileAdaptation: true }, services: { layout: { toggleSidebar() {}, closeDetails() {} } } })
    globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    globalThis.window.addEventListener = (type, handler) => { (windowListeners.get(type) || windowListeners.set(type, new Set()).get(type)).add(handler) }
    globalThis.window.removeEventListener = (type, handler) => { windowListeners.get(type)?.delete(handler) }
    globalThis.window.location = { search: '?dshsvc-mobile-debug=1', reload() {} }
    await renderer.load()
    const chip = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-debug'))
    assert.notEqual(chip, undefined, 'debug param must mount the diagnostics chip')
    assert.equal(chip.title, '移动端诊断')
    assert.match(chip.textContent, /视口/)
    assert.match(chip.textContent, /JS 错误 0/)

    windowListeners.get('error').forEach((handler) => handler(new Error('boom')))
    windowListeners.get('error').forEach((handler) => handler(new Error('boom again')))
    assert.match(chip.textContent, /JS 错误 2/)
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
    delete globalThis.window.location.search
  }
})

test('mobile adaptation survives cold narrow load before the shell frame mounts', async () => {
  // 真机反馈第二轮根因：手机直接窄屏冷加载时 AppFrame 尚未挂载，
  // 引擎激活那一刻找不到 [data-shell-overlay] → 抽屉件全没建、官方 rail 残留。
  class FakeElement {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = new Map()
      this.style = {}; this.dataset = {}; this.parentNode = null; this.className = ''; this.listeners = new Map()
    }
    get isConnected() { let n = this; while (n.parentNode !== null) n = n.parentNode; return n === rootNode }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c }
    remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null } }
    setAttribute(k, v) { this.attributes.set(k, String(v)) }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null }
    hasAttribute(k) { return this.attributes.has(k) }
    removeAttribute(k) { this.attributes.delete(k) }
    addEventListener(t, h) { (this.listeners.get(t) || this.listeners.set(t, new Set()).get(t)).add(h) }
    dispatch(t) { for (const h of this.listeners.get(t) || []) h({}) }
  }
  const rootNode = new FakeElement('#root')
  const head = new FakeElement('head'); rootNode.appendChild(head)
  const bodyEl = new FakeElement('body'); rootNode.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); rootNode.appendChild(htmlEl)
  // 注意：故意不放外壳骨架 —— 模拟冷加载瞬间

  const observers = []
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    documentElement: htmlEl, head, body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      const bare = selector.replace(/[[\]]/g, '')
      let found = null
      const scan = (node) => {
        if (found === null && node.attributes?.has?.(bare)) found = node
        for (const c of node.children || []) scan(c)
      }
      scan(rootNode)
      return found
    },
    querySelectorAll() { return [] },
  }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
  try {
    let toggles = 0
    const renderer = createRenderer(rpc, { featureSettings: { mobileAdaptation: true }, services: { layout: { toggleSidebar() { toggles += 1 }, closeDetails() {} } } })
    globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    await renderer.load()

    // 作用域属性与样式表立即生效，但抽屉件必须缺席、等待骨架
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), true)
    const styleTag = head.children.find((el) => el.textContent.includes('data-dshsvc-mobile'))
    assert.notEqual(styleTag, undefined)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-fab')), false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-backdrop')), false)
    assert.ok(observers.length >= 1, 'engine must watch for the late shell mount')

    // 外壳此刻才挂载 → 重试观察者补建全部抽屉件并打齐标记
    const frame = new FakeElement('div'); frame.className = 'pI_x6G_frame'
    frame.setAttribute('data-sidebar-collapsed', '')
    frame.setAttribute('data-details-collapsed', '')
    const sidebarCol = new FakeElement('div'); sidebarCol.className = 'pI_x6G_sidebarCol'
    const centerCol = new FakeElement('div'); centerCol.className = 'pI_x6G_centerCol'
    const detailsCol = new FakeElement('div'); detailsCol.className = 'pI_x6G_detailsCol'
    const overlayLayer = new FakeElement('div'); overlayLayer.setAttribute('data-shell-overlay', '')
    for (const el of [sidebarCol, centerCol, detailsCol, overlayLayer]) frame.appendChild(el)
    bodyEl.appendChild(frame)

    for (const observer of observers) observer.callback([], () => {})

    assert.equal(frame.attributes.has('data-dshsvc-frame'), true)
    assert.equal(sidebarCol.attributes.has('data-dshsvc-sidebar'), true)
    assert.equal(centerCol.attributes.has('data-dshsvc-center'), true)
    assert.equal(detailsCol.attributes.has('data-dshsvc-details'), true)
    const backdrop = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-backdrop'))
    const fab = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-fab'))
    assert.notEqual(backdrop, undefined)
    assert.notEqual(fab, undefined)
    assert.equal(fab.getAttribute('aria-label'), '打开侧栏菜单')
    assert.equal(fab.style.display, 'flex')
    assert.equal(backdrop.style.display, 'none')

    // 补建后的交互件功能完整：FAB 开抽屉 → 开着时 FAB 收起（关闭走原生钮/遮罩）
    fab.dispatch('click')
    assert.equal(toggles, 1)
    frame.removeAttribute('data-sidebar-collapsed')
    for (const observer of observers) observer.callback([], () => {})
    assert.equal(fab.style.display, 'none')
    assert.equal(fab.getAttribute('aria-label'), '打开侧栏菜单')
    assert.equal(backdrop.style.display, 'block')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

// ── 会话管理（v0.35）───────────────────────────────────────────────

function sessionManagerRenderer(rpcCall, options = {}) {
  return createRenderer(rpcCall, { featureSettings: { sessionManager: true, ...(options.featureSettings || {}) }, ...options })
}

const SESSION_LIST_VALUE = {
  available: true,
  items: [
    { id: 'session-live', title: 'Live session', cwd: '/workspace', createdAt: 3000, live: true, persisted: true, archived: false, bytes: 2048 },
    { id: 'session-cold', title: 'Cold session', cwd: '/workspace/projects', createdAt: 2000, live: false, persisted: true, archived: false, bytes: 4096 },
    { id: 'session-archived', title: 'Archived one', cwd: '/workspace', createdAt: 1000, live: false, persisted: true, archived: true, bytes: 1024 },
  ],
  archivedIds: ['session-archived'],
  deleted: [{ id: 'session-gone', title: 'Gone session', cwd: '/tmp', deletedAt: 1500 }],
}

function createSessionRpcMock({ onCall, ...overrides } = {}) {
  const defaults = {
    version: () => ({ ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }),
    'check-update': () => ({ ok: false, error: 'offline' }),
    'permissions-plan': () => ({ ok: true, value: { supported: false } }),
    health: () => ({ ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }),
    activity: () => ({ ok: true, value: { hasActive: false, items: [] } }),
    diagnostics: () => ({ ok: true, value: { checks: [], status: 'ok' } }),
    quota: () => ({ ok: true, value: { providers: [], serverTime: Date.now() } }),
    web: () => ({ ok: true, value: { instanceId: 'new-instance' } }),
    'sessions-list': (payload) => {
      const scope = payload?.scope || 'all'
      if (scope === 'archived') return { ok: true, value: { available: true, items: SESSION_LIST_VALUE.items.filter((item) => item.archived), archivedIds: SESSION_LIST_VALUE.archivedIds, deleted: [] } }
      if (scope === 'deleted') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: SESSION_LIST_VALUE.deleted } }
      return { ok: true, value: SESSION_LIST_VALUE }
    },
    'sessions-bytes': (payload) => {
      const bytes = {}
      for (const id of payload?.ids || []) {
        const found = SESSION_LIST_VALUE.items.find((item) => item.id === id)
        bytes[id] = found ? found.bytes : null
      }
      return { ok: true, value: { bytes } }
    },
    'sessions-search': () => ({ ok: true, value: { available: true, query: '', scope: 'all', hits: [] } }),
    'sessions-clear-deleted': (payload) => {
      const ids = payload?.ids || []
      return { ok: true, value: { cleared: true, count: ids.length, ids } }
    },
    'sessions-unarchive': (payload) => ({ ok: true, value: { archived: false, id: payload.id, archivedSessionIds: [] } }),
  }
  return async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    onCall?.(endpoint, payload)
    const handler = overrides[endpoint] ?? defaults[endpoint]
    if (handler !== undefined) return typeof handler === 'function' ? handler(payload, endpoint) : handler
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
}


test('mobile adaptation immersive engine hides chat chrome on downward gesture (cumulative) and restores via upward gesture, bottom arrival, and focus reveal (no resident handle since 2026-09-15)', async () => {
  class FakeElement {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = new Map()
      this.style = {}; this.dataset = {}; this.parentNode = null; this.className = ''; this.listeners = new Map()
    }
    get isConnected() { let n = this; while (n.parentNode !== null) n = n.parentNode; return n === rootNode }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c }
    remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null } }
    setAttribute(k, v) { this.attributes.set(k, String(v)) }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null }
    hasAttribute(k) { return this.attributes.has(k) }
    removeAttribute(k) { this.attributes.delete(k) }
    addEventListener(t, h) { (this.listeners.get(t) || this.listeners.set(t, new Set()).get(t)).add(h) }
    removeEventListener(t, h) { this.listeners.get(t)?.delete(h) }
    dispatch(t, event) { for (const h of this.listeners.get(t) || []) h(event || {}) }
  }
  const rootNode = new FakeElement('#root')
  const head = new FakeElement('head'); rootNode.appendChild(head)
  const bodyEl = new FakeElement('body'); rootNode.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); rootNode.appendChild(htmlEl)
  const frame = new FakeElement('div'); frame.className = 'pI_x6G_frame'; frame.setAttribute('data-sidebar-collapsed', '')
  const sidebarCol = new FakeElement('div'); sidebarCol.className = 'sidebarCol'; frame.appendChild(sidebarCol)
  const centerCol = new FakeElement('div'); centerCol.className = 'centerCol'; frame.appendChild(centerCol)
  const detailsCol = new FakeElement('div'); detailsCol.className = 'detailsCol'; frame.appendChild(detailsCol)
  const overlayLayer = new FakeElement('div'); overlayLayer.setAttribute('data-shell-overlay', ''); frame.appendChild(overlayLayer)
  bodyEl.appendChild(frame)

  // 外壳会话骨架（v0.36.1 真机取证修正：header 藏在官方槽位包裹层里，非直接子元素）
  // root[data-phase] > div[data-slot=conversation.session.header] > header
  //                  + scroller[data-conversation-scroll] > composerSeat[data-composer-seat]
  const convRoot = new FakeElement('div'); convRoot.setAttribute('data-phase', 'active')
  const headerWrap = new FakeElement('div'); headerWrap.setAttribute('data-slot', 'conversation.session.header')
  const headerEl = new FakeElement('header')
  const scroller = new FakeElement('div'); scroller.setAttribute('data-conversation-scroll', '')
  const seat = new FakeElement('div'); seat.setAttribute('data-composer-seat', '')
  headerWrap.appendChild(headerEl)
  convRoot.appendChild(headerWrap)
  convRoot.appendChild(scroller)
  scroller.appendChild(seat)
  centerCol.appendChild(convRoot)
  scroller.scrollTop = 0
  scroller.scrollHeight = 2000
  scroller.clientHeight = 600

  class FakeMutationObserver { constructor() {} observe() {} disconnect() {} }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    documentElement: htmlEl, head, body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      let found = null
      const scan = (node) => { if (found === null && node.attributes?.has?.(selector.replace(/[[\]]/g, ''))) found = node; for (const c of node.children || []) scan(c) }
      scan(rootNode)
      return found
    },
    querySelectorAll(selector) {
      // 引擎卸载清扫按「逗号分隔属性选择器清单」摘标记——桩需支持该形态
      const parts = selector.split(',').map((p) => p.trim()).filter(Boolean)
      const found = []
      const scan = (node) => {
        if (node !== rootNode && parts.some((p) => /^\[[a-z-]+\]$/i.test(p) && node.attributes.has(p.slice(1, -1)))) found.push(node)
        for (const c of node.children || []) scan(c)
      }
      scan(rootNode)
      return found
    },
  }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }

  const immersiveOn = () => htmlEl.attributes.has('data-dshsvc-immersive')
  const freshGesture = () => htmlEl.dispatch('touchstart', {})
  const scrollToY = (y) => { scroller.scrollTop = y; htmlEl.dispatch('scroll', { target: scroller }) }

  try {
    const renderer = createRenderer(rpc, { featureSettings: { mobileAdaptation: true }, services: { layout: { toggleSidebar() {}, closeDetails() {} } } })
    globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    globalThis.window.location = { search: '', reload() {} }
    await renderer.load()

    // 样式层：composer 滑出裁剪区、头部测高变量回退常量、reduced-motion 关动画
    const styleTag = head.children.find((el) => el.textContent.includes('data-dshsvc-mobile'))
    // 2026-09-15 几何返工：沉浸时把 composer 座移出文档流 + 淡出。不再用 transform ——
    // 变换后的视觉溢出会被计入滚动容器可滚动区域（实测 +147px），造成「底部空一大段」，
    // 回显时那截又消失导致「最后一段被输入框压住」。
    assert.match(styleTag.textContent, /\[data-dshsvc-immersive\] \[data-composer-seat\] \{[^}]*position: absolute !important/s)
    assert.match(styleTag.textContent, /\[data-dshsvc-immersive\] \[data-composer-seat\] \{[^}]*opacity: 0 !important/s)
    assert.match(styleTag.textContent, /\[data-dshsvc-immersive\] \[data-composer-seat\] \{[^}]*pointer-events: none !important/s)
    assert.doesNotMatch(styleTag.textContent, /\[data-dshsvc-immersive\] \[data-composer-seat\] \{[^}]*translateY/s)
    assert.match(styleTag.textContent, /margin-top: calc\(0px - var\(--dshsvc-header-h, 76px\)\)/s)
    assert.match(styleTag.textContent, /@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-dshsvc-mobile\]\[data-dshsvc-immersive\]/s)

    // 用户点名移除常驻把手：body 下不得再挂 data-dshsvc-handle，样式表里也不得残留
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-handle')), false, 'resident handle must no longer mount')
    assert.doesNotMatch(styleTag.textContent, /data-dshsvc-handle/)

    // 程序化滚动免疫：无手势窗口时分步位移绝不翻转状态，也绝不残留累加
    scrollToY(60)
    scrollToY(120)
    scrollToY(180)
    assert.equal(immersiveOn(), false)

    // touchend 不是手势窗口刷新源：否则抬手后 800ms 内的程序化滚动会被误判为用户拖拽。
    const realDateNow = Date.now
    let gestureNow = 10_000
    Date.now = () => gestureNow
    freshGesture()
    gestureNow += 700
    htmlEl.dispatch('touchend', {})
    gestureNow += 200
    scroller.scrollTop = 250
    htmlEl.dispatch('scroll', { target: scroller })
    assert.equal(immersiveOn(), false, 'touchend must not extend the gesture window')
    // 回归场景只验证窗口是否延长；恢复后把滚动基线拉回原位置，避免影响后续方向累加用例。
    scrollToY(180)
    Date.now = realDateNow

    // 真机拖拽形态回归（v0.36.1 核心）：单事件只有几像素、靠连续累加越过阈值
    const dragTo = (targetY, step) => {
      const dir = Math.sign(targetY - scroller.scrollTop)
      let y = scroller.scrollTop
      while ((dir > 0 && y < targetY) || (dir < 0 && y > targetY)) {
        const next = Math.abs(targetY - y) < step ? targetY : y + dir * step
        scroller.scrollTop = next
        htmlEl.dispatch('scroll', { target: scroller })
        y = next
      }
    }

    // 下滑小步累加（每步 6px，越过 64 即触发）→ 隐藏；标记穿透槽位包裹层、
    // 落在真正有盒子的 header 上（v0.36.1 真机两连取证：wrapper 是 display:contents）
    freshGesture()
    dragTo(264, 6)
    assert.equal(immersiveOn(), true)
    assert.equal(headerEl.attributes.has('data-dshsvc-chat-header'), true)
    assert.equal(headerWrap.attributes.has('data-dshsvc-chat-header'), false)

    // 上滑小步累加越过迟滞带 → 回显
    freshGesture()
    dragTo(240, 6)
    assert.equal(immersiveOn(), false)

    // 底部到达回显：用户手势逐步带回底部时优先于继续隐藏
    freshGesture()
    dragTo(420, 20)
    assert.equal(immersiveOn(), true)
    freshGesture()
    dragTo(1450, 40)
    assert.equal(immersiveOn(), false, 'user-driven arrival near the bottom must reveal chrome')

    // 聚焦回显保留，但不再硬阻断后续滑动（v0.36.1：首版把「打完字读历史」压死）。
    // 底部区内向下重新收起不受 bottom 分支影响——它只拦「已沉浸时到达底部」。
    freshGesture()
    dragTo(1600, 12)
    assert.equal(immersiveOn(), true)
    htmlEl.dispatch('focusin', { target: seat })
    assert.equal(immersiveOn(), false, 'focus inside composer reveals chrome immediately')
    freshGesture()
    dragTo(1720, 10)
    assert.equal(immersiveOn(), true, 'directional hiding works again even right after typing context')

    // 上滑回显（把手的替代路径）
    freshGesture()
    dragTo(1560, 10)
    assert.equal(immersiveOn(), false)

    // 回显贴底补偿（2026-09-15）：沉浸态下停在内容末尾时回显，必须把滚动位置重新对齐到
    // 末尾 —— 沉浸期移出文档流的坐位收回会让可滚动长度变长，不补偿就把最后一段压到输入框下。
    gestureNow += 2000                                   // 手势窗口过期 → 下一次程序化滚动免疫
    scrollToY(600)                                       // 程序化回中部（不翻转沉浸态）
    freshGesture()
    dragTo(1100, 8)                                      // delta>0 累加越过 64 → 隐藏
    assert.equal(immersiveOn(), true, '隐藏手势后应进入沉浸态')
    gestureNow += 2000
    scrollToY(1200)                                      // 底部区之外（2000-600-80=1320 为界）
    assert.equal(immersiveOn(), true, '程序化滚动不应翻转沉浸态')
    freshGesture()
    dragTo(1360, 10)                                     // 手势滑入底部区 → 引擎「到底回显」
    assert.equal(immersiveOn(), false, '到底回显应展开头部与输入框')
    assert.equal(scroller.scrollTop, 1360, '回显当下不得抢手指位置（贴底补偿要等停稳）')
    await new Promise((resolve) => setTimeout(resolve, 340))
    assert.equal(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight, '停稳后若仍在末尾应补一次贴底（对齐到最大滚动位置）')
    // 反向负例：重建一次「隐藏 → 往回读 → 回显」，补偿不得把人拽到底
    gestureNow += 2000
    scrollToY(600)
    freshGesture()
    dragTo(1100, 8)
    assert.equal(immersiveOn(), true)
    gestureNow += 2000
    scrollToY(1200)
    freshGesture()
    dragTo(1360, 10)                                     // 到底回显
    assert.equal(immersiveOn(), false)
    gestureNow += 2000
    scroller.scrollTop = 900                             // 回显后用户往回读了 460px（程序化模拟）
    htmlEl.dispatch('scroll', { target: scroller })
    await new Promise((resolve) => setTimeout(resolve, 340))
    assert.equal(scroller.scrollTop, 900, '已往回读时贴底补偿必须放弃，不得把人拽到底')

    // 点官方「回到底部」按钮必须立即回显（2026-09-15 真机反馈：点回底后 composer 不回来，
    // 要手动上滑一点再下滑、还得试几次）。官方 toBottom 只做一次 `scrollTop = scrollHeight`
    // 的瞬时赋值 → 引擎免疫层眼里和流式贴底同形，只有点击目标能表达「用户到底了」。
    gestureNow += 2000
    scrollToY(600)
    freshGesture()
    dragTo(1100, 8)                                      // 手势隐藏
    assert.equal(immersiveOn(), true)
    // 否定面：普通点击（closest 不认账）不得掀开沉浸
    htmlEl.dispatch('click', { target: { closest: () => null } })
    assert.equal(immersiveOn(), true, '非回底按钮的点击不得回显')
    htmlEl.dispatch('click', { target: {} })             // 无 closest 的节点也不得抛错/回显
    assert.equal(immersiveOn(), true)
    let closestArg = null
    const toBottomBtn = { closest(sel) { closestArg = sel; return toBottomBtn } }
    freshGesture()                                       // 真实点按：touchstart 先到（会清方向锁）
    htmlEl.dispatch('click', { target: toBottomBtn })
    assert.equal(immersiveOn(), false, '点官方回到底部按钮必须立即回显')
    assert.match(String(closestArg), /_toBottom/, '按钮识别必须落在官方 _toBottom 词干上')
    // 同一次点按开出的 800ms 手势窗口里，官方跳转（scrollTop = scrollHeight）会留下同向
    // 前进位移：跳 64~200px 时正是隐藏阈值区间，方向锁必须吞掉它，不得刚回显又藏回
    dragTo(1220, 40)
    assert.equal(immersiveOn(), false, '回底跳转的剩余位移不得把刚回显的界面再藏回去')

    // 点回底后的一次停稳贴底：官方跳转按「点按当下」的滚动高度算目标，而回显刚把坐位
    // 收回文档流、真实末尾更远 → 不补就停在距底一段（最后一段压在输入框下）。已往回读则放弃。
    gestureNow += 2000
    scrollToY(600)
    freshGesture()
    dragTo(1100, 8)
    assert.equal(immersiveOn(), true)
    freshGesture()
    htmlEl.dispatch('click', { target: toBottomBtn })
    assert.equal(immersiveOn(), false)
    scrollToY(scroller.scrollHeight)                     // 官方 toBottom：scrollTop = scrollHeight
    await new Promise((resolve) => setTimeout(resolve, 340))
    assert.equal(scroller.scrollTop, scroller.scrollHeight - scroller.clientHeight, '点回底后必须补一次贴底对齐（官方跳转用的是点击当下的高度）')
    // 负例：停稳前用户已经往回读 → 对齐必须放弃
    gestureNow += 2000
    dragTo(600, 10)
    freshGesture()
    dragTo(1100, 8)
    assert.equal(immersiveOn(), true)
    freshGesture()
    htmlEl.dispatch('click', { target: toBottomBtn })
    scrollToY(1450)                                      // 官方跳到底（假桩不 clamp）
    gestureNow += 2000
    scrollToY(1000)                                      // 停稳前用户往回读了 450px
    await new Promise((resolve) => setTimeout(resolve, 340))
    assert.equal(scroller.scrollTop, 1000, '已往回读时点回底的贴底对齐必须放弃，不得把人拽到底')

    // 已在内容末尾的沉浸态：往回一点就该回显（末尾之后没有「前进」内容，24px 迟滞带
    // 在这里只会让人以为失灵）。先在中途隐藏。
    gestureNow += 2000
    scrollToY(600)
    freshGesture()
    dragTo(1100, 8)
    assert.equal(immersiveOn(), true)
    freshGesture()
    scrollToY(1092)                                      // 中途往回 8px（未到末尾）
    assert.equal(immersiveOn(), true, '未在末尾时迟滞带照旧：8px 不足以回显（防翻页闪烁）')
    gestureNow += 2000
    scrollToY(1340)                                      // 程序化到距末尾 60px（底部区内）
    freshGesture()
    dragTo(1480, 12)                                     // 起点已在区内 → 不走到底回显，靠累加隐藏
    assert.equal(immersiveOn(), true, '末尾处的沉浸态（区内起滑）先要到手')
    freshGesture()
    scrollToY(scroller.scrollTop - 8)                    // 单个 −8px 事件
    assert.equal(immersiveOn(), false, '末尾处往回一点即回显，不再等 24px 迟滞带')

    // 开关热关闭：属性/标记/挂件全部对称拆除，二次关闭幂等
    await renderer.setFeature('mobileAdaptation', false)
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), false)
    assert.equal(htmlEl.attributes.has('data-dshsvc-immersive'), false)
    assert.equal(headerEl.attributes.has('data-dshsvc-chat-header'), false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-handle')), false)
    await renderer.setFeature('mobileAdaptation', false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-handle')), false)
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
    delete globalThis.window.location.search
  }
})

test('mobile adaptation immersive engine tolerates the 0.1.2-alpha.2 skeleton (body wrapper between the phase root and the scroll body)', async () => {
  // 0.1.2-alpha.2 ConversationRoot 树（dsh-client-ui-conversation bundle 源码核实）：
  //   root[data-phase] > [header 槽包裹层 > header, body 包裹层(.wSkVaW_body)]
  //   body 包裹层 > [scroller[data-conversation-scroll] > [slot, seat[data-composer-seat]],
  //                 WidthHandle[data-width-handle=left], WidthHandle[data-width-handle=right]]
  // 滚动容器不再是带 data-phase 的 root 的直接子元素 → 引擎必须上溯一层找相位，
  // 否则 chatAvailable=false、沉浸/把手/头部标记整体哑火（alpha.2 真机报告）。
  class FakeElement {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = new Map()
      this.style = {}; this.dataset = {}; this.parentNode = null; this.className = ''; this.listeners = new Map()
    }
    get isConnected() { let n = this; while (n.parentNode !== null) n = n.parentNode; return n === rootNode }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c }
    remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null } }
    setAttribute(k, v) { this.attributes.set(k, String(v)) }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null }
    hasAttribute(k) { return this.attributes.has(k) }
    removeAttribute(k) { this.attributes.delete(k) }
    addEventListener(t, h) { (this.listeners.get(t) || this.listeners.set(t, new Set()).get(t)).add(h) }
    removeEventListener(t, h) { this.listeners.get(t)?.delete(h) }
    dispatch(t, event) { for (const h of this.listeners.get(t) || []) h(event || {}) }
  }
  const rootNode = new FakeElement('#root')
  const head = new FakeElement('head'); rootNode.appendChild(head)
  const bodyEl = new FakeElement('body'); rootNode.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); rootNode.appendChild(htmlEl)
  const frame = new FakeElement('div'); frame.className = 'pI_x6G_frame'; frame.setAttribute('data-sidebar-collapsed', '')
  const sidebarCol = new FakeElement('div'); sidebarCol.className = 'sidebarCol'; frame.appendChild(sidebarCol)
  const centerCol = new FakeElement('div'); centerCol.className = 'centerCol'; frame.appendChild(centerCol)
  const detailsCol = new FakeElement('div'); detailsCol.className = 'detailsCol'; frame.appendChild(detailsCol)
  const overlayLayer = new FakeElement('div'); overlayLayer.setAttribute('data-shell-overlay', ''); frame.appendChild(overlayLayer)
  bodyEl.appendChild(frame)

  const convRoot = new FakeElement('div'); convRoot.setAttribute('data-phase', 'active')
  const headerWrap = new FakeElement('div'); headerWrap.setAttribute('data-slot', 'conversation.session.header')
  const headerEl = new FakeElement('header')
  const bodyWrap = new FakeElement('div'); bodyWrap.className = 'wSkVaW_body'
  const scroller = new FakeElement('div'); scroller.setAttribute('data-conversation-scroll', '')
  const seat = new FakeElement('div'); seat.setAttribute('data-composer-seat', '')
  const leftHandle = new FakeElement('div'); leftHandle.setAttribute('data-width-handle', 'left')
  const rightHandle = new FakeElement('div'); rightHandle.setAttribute('data-width-handle', 'right')
  headerWrap.appendChild(headerEl)
  convRoot.appendChild(headerWrap)
  convRoot.appendChild(bodyWrap)
  bodyWrap.appendChild(scroller)
  bodyWrap.appendChild(leftHandle)
  bodyWrap.appendChild(rightHandle)
  scroller.appendChild(seat)
  centerCol.appendChild(convRoot)
  scroller.scrollTop = 0
  scroller.scrollHeight = 2000
  scroller.clientHeight = 600

  class FakeMutationObserver { constructor() {} observe() {} disconnect() {} }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    documentElement: htmlEl, head, body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      let found = null
      const scan = (node) => { if (found === null && node.attributes?.has?.(selector.replace(/[[\]]/g, ''))) found = node; for (const c of node.children || []) scan(c) }
      scan(rootNode)
      return found
    },
    querySelectorAll(selector) {
      const parts = selector.split(',').map((p) => p.trim()).filter(Boolean)
      const found = []
      const scan = (node) => {
        if (node !== rootNode && parts.some((p) => /^\[[a-z-]+\]$/i.test(p) && node.attributes.has(p.slice(1, -1)))) found.push(node)
        for (const c of node.children || []) scan(c)
      }
      scan(rootNode)
      return found
    },
  }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }

  const immersiveOn = () => htmlEl.attributes.has('data-dshsvc-immersive')
  const freshGesture = () => htmlEl.dispatch('touchstart', {})
  const dragTo = (targetY, step) => {
    const dir = Math.sign(targetY - scroller.scrollTop)
    let y = scroller.scrollTop
    while ((dir > 0 && y < targetY) || (dir < 0 && y > targetY)) {
      const next = Math.abs(targetY - y) < step ? targetY : y + dir * step
      scroller.scrollTop = next
      htmlEl.dispatch('scroll', { target: scroller })
      y = next
    }
  }

  try {
    const renderer = createRenderer(rpc, { featureSettings: { mobileAdaptation: true }, services: { layout: { toggleSidebar() {}, closeDetails() {} } } })
    globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    globalThis.window.location = { search: '', reload() {} }
    await renderer.load()

    // 相位必须透过 body 包裹层上溯到 root：会话可滚（chatAvailable）→ 滑动沉浸可用、头部标记打上
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-handle')), false, 'resident handle was removed (2026-09-15)')
    assert.equal(headerEl.attributes.has('data-dshsvc-chat-header'), true, 'header tag must land on the real header through the wrapper')
    assert.equal(headerWrap.attributes.has('data-dshsvc-chat-header'), false, 'display:contents wrapper must stay untagged')

    // 下滑累加 → 隐藏；上滑 → 回显
    freshGesture()
    dragTo(264, 6)
    assert.equal(immersiveOn(), true)
    freshGesture()
    dragTo(240, 6)
    assert.equal(immersiveOn(), false)

    // 开关热关闭：属性/标记/挂件全部对称拆除
    await renderer.setFeature('mobileAdaptation', false)
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), false)
    assert.equal(htmlEl.attributes.has('data-dshsvc-immersive'), false)
    assert.equal(headerEl.attributes.has('data-dshsvc-chat-header'), false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-handle')), false)
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
    delete globalThis.window.location.search
  }
})


test('user reply jump: mounts the up-arrow above the to-bottom button, steps up through user replies on every click, and tears down on dispose', async () => {
  // 全平台引擎（与 mobileAdaptation 无关）：挂在官方 to-bottom 槽位（哈希前缀随包拆分
  // 漂移：rc.2 Md3f7G_ → 0.1.2-alpha.2 EvIC1a_，聊天视图迁进 dsh-client-ui-chat）内，
  // 点击按 [data-chat-flow-kind="user"] 行定位「上一条」平滑跳转，逐击步进。
  class FakeElement {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attributes = new Map()
      this.style = {}; this.dataset = {}; this.parentNode = null; this.className = ''; this.listeners = new Map()
      this.rect = { top: 0, left: 0, width: 0, height: 0 }
    }
    get isConnected() { let n = this; while (n.parentNode !== null) n = n.parentNode; return n === rootNode }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c }
    remove() { if (this.parentNode) { const i = this.parentNode.children.indexOf(this); if (i >= 0) this.parentNode.children.splice(i, 1); this.parentNode = null } }
    setAttribute(k, v) { this.attributes.set(k, String(v)) }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null }
    hasAttribute(k) { return this.attributes.has(k) }
    removeAttribute(k) { this.attributes.delete(k) }
    addEventListener(t, h) { (this.listeners.get(t) || this.listeners.set(t, new Set()).get(t)).add(h) }
    removeEventListener(t, h) { this.listeners.get(t)?.delete(h) }
    dispatch(t, event) { for (const h of this.listeners.get(t) || []) h(event || {}) }
    click() { this.dispatch('click', {}) }
    getBoundingClientRect() { return { top: this.rect.top, left: this.rect.left, width: this.rect.width, height: this.rect.height, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height } }
    querySelectorAll(selector) {
      const m = selector.match(/^\[([a-z-]+)="?([^"]*)"?\]$/)
      const found = []
      const scan = (node) => {
        if (node !== this && m !== null) {
          const attr = node.attributes.get(m[1])
          if (attr !== undefined && (m[2] === '' || attr === m[2])) found.push(node)
        }
        for (const c of node.children || []) scan(c)
      }
      scan(this)
      return found
    }
    querySelector(selector) {
      const cls = selector.match(/^\[class\*="([^"]+)"\](:not\(\[class\*="([^"]+)"\]\))?$/)
      const desc = selector.match(/^\[class\*="([^"]+)"\] ([a-z]+)$/)
      if (cls !== null) {
        let found = null
        const scan = (node) => {
          if (found !== null) return
          if (node !== this && node.className.includes(cls[1]) && (cls[2] === undefined || !node.className.includes(cls[2]))) { found = node; return }
          for (const c of node.children || []) scan(c)
        }
        scan(this)
        return found
      }
      if (desc !== null) {
        const box = this.querySelector(`[class*="${desc[1]}"]`)
        if (box !== null) {
          for (const c of box.children) if ((c.tagName || '').toUpperCase() === desc[2].toUpperCase()) return c
        }
      }
      return null
    }
    scrollTo(opts) { this.scrollTop = opts.top; (this.scrollCalls = this.scrollCalls || []).push(opts); if (typeof this.onScrollTo === 'function') this.onScrollTo(opts.top) }
  }
  const rootNode = new FakeElement('#root')
  const head = new FakeElement('head'); rootNode.appendChild(head)
  const bodyEl = new FakeElement('body'); rootNode.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); rootNode.appendChild(htmlEl)

  // 主对话视图骨架：滚动容器 + 官方回到底部槽位 + 三条用户回复行
  const scroller = new FakeElement('div'); scroller.setAttribute('data-conversation-scroll', '')
  scroller.scrollCalls = []
  // 真实浏览器语义：scrollTop 直接赋值 = 引擎唯一滚动路径（v0.36.6 起，不再 scrollTo smooth），
  // 赋值即触发滚动 → 布局更新 → rect 变化，等同 updateFlows 的真实时机
  let scrollerTop = 0
  Object.defineProperty(scroller, 'scrollTop', {
    get() { return scrollerTop },
    set(value) {
      scrollerTop = value
      scroller.scrollCalls.push(value)
      if (typeof scroller.onScrollTo === 'function') scroller.onScrollTo(value)
    },
  })
  scroller.scrollTop = 0
  const slot = new FakeElement('div'); slot.className = 'EvIC1a_toBottomSlot'
  const officialBottom = new FakeElement('button'); officialBottom.className = 'EvIC1a_toBottom'
  slot.appendChild(officialBottom)
  scroller.appendChild(slot)
  const mkUser = (docTop) => { const r = new FakeElement('div'); r.setAttribute('data-chat-flow-kind', 'user'); r.docTop = docTop; r.rect.top = docTop; scroller.appendChild(r); return r }
  mkUser(3000); mkUser(4000); mkUser(4900)
  // flowTop = 行文档坐标 − 视口顶（scrollTop），与真实 getBoundingClientRect 语义一致
  const updateFlows = () => { for (const r of scroller.children.filter((c) => c.attributes.has('data-chat-flow-kind'))) r.rect.top = r.docTop - scroller.scrollTop }
  scroller.onScrollTo = () => updateFlows() // scrollTop 赋值（含劫持拉回）后 rect 同步，等同真实布局更新
  bodyEl.appendChild(scroller)

  const observers = []
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    documentElement: htmlEl, head, body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      const cls = selector.match(/^\[class\*="([^"]+)"\]$/)
      let found = null
      const scan = (node) => {
        if (found === null) {
          if (cls !== null) { if (node.className.includes(cls[1])) found = node }
          else if (node.attributes?.has?.(selector.replace(/[[\]]/g, ''))) found = node
        }
        for (const c of node.children || []) scan(c)
      }
      scan(rootNode)
      return found
    },
    querySelectorAll() { return [] },
  }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
  try {
    const renderer = createRenderer(rpc, { featureSettings: {} }) // mobileAdaptation 关闭：本引擎独立于它
    await renderer.load()

    // 挂载：槽位内出现上箭头按钮 + hover 样式注入 head
    const btn = slot.children.find((el) => el.attributes.has('data-dshsvc-user-jump'))
    assert.notEqual(btn, undefined, 'up-arrow must mount into the official to-bottom slot')
    assert.equal(btn.getAttribute('aria-label'), '上一条用户回复')
    assert.equal(btn.style.bottom, '42px')
    assert.equal(btn.style.borderRadius, '100px')
    assert.equal(btn.style.right, '0px', 'desktop right alignment mirrors the official button edge (fake rects coincide)')
    assert.ok(head.children.some((el) => (el.textContent || '').includes('[data-dshsvc-user-jump]:hover')), 'hover style must be injected')
    // v0.36.5：顶部的显隐由「可达目标 / 加载更早」驱动——初始视口在顶部、无目标无更早 → 隐藏
    assert.equal(btn.style.display, 'none', 'top of loaded history hides the up-arrow')

    // 视口顶在 5000：三条用户行 docTop 3000/4000/4900 → flowTop -2000/-1000/-100
    scroller.scrollTop = 5000
    updateFlows()
    htmlEl.dispatch('scroll', {}) // 滚动事件驱动显隐刷新 → 有上一条可跳 → 显示
    assert.equal(btn.style.display, 'flex')

    // 点一次：上一条 = flowTop<4 的最后一行（u3 at -100）→ 5000-100-12=4888
    // （v0.36.6：瞬时 scrollTop 直接赋值，与官方同款；setter 已同步 flows）
    btn.dispatch('click', {})
    assert.equal(scroller.scrollTop, 4888)
    updateFlows() // u3=12, u2=-888, u1=-1888

    // 再点：u2（-888）→ 4888-888-12=3988
    btn.dispatch('click', {})
    assert.equal(scroller.scrollTop, 3988)
    updateFlows() // u2=12, u1=-988

    // 再点：u1（-988）→ 3988-988-12=2988
    btn.dispatch('click', {})
    assert.equal(scroller.scrollTop, 2988)
    updateFlows() // u1=12

    // 已到第一条：没有 flowTop<4 的行 → 忽略（不再滚动）
    const before = scroller.scrollCalls.length
    btn.dispatch('click', {})
    assert.equal(scroller.scrollCalls.length, before)
    // 跳无可跳且无「加载更早」→ 按钮隐藏（用户点名：达到最顶部后隐藏）
    htmlEl.dispatch('scroll', {})
    assert.equal(btn.style.display, 'none', 'reaching the top hides the up-arrow')

    // 目标在未加载历史里：顶部有官方「加载更早」按钮 → 自动点击并在加载后跳到新目标
    const olderBox = new FakeElement('div'); olderBox.className = 'EvIC1a_older'; scroller.appendChild(olderBox)
    const olderBtn = new FakeElement('button'); olderBox.appendChild(olderBtn)
    let olderClicks = 0
    olderBtn.addEventListener('click', () => {
      olderClicks += 1
      mkUser(1500) // 官方加载更早后出现一条更早的用户回复（docTop 1500）
      updateFlows()
      scroller.scrollTop = 9000 // 官方 loadOlderAnchored 的锚点行为会把视口劫持走
      updateFlows()
    })
    for (const observer of observers) observer.callback([], () => {}) // 加载更早按钮出现 → 按钮恢复显示
    assert.equal(btn.style.display, 'flex', 'load-older availability keeps the up-arrow visible')
    btn.dispatch('click', {})
    assert.equal(olderClicks, 1, 'missing target must trigger the official load-older button')
    await renderer.advanceTimer(220) // Fiber 托管的 220ms 重试窗：拉回基准视口 → 加载完成 → 跳转
    assert.equal(scroller.scrollTop, 1488) // 基准 2988 + (1500-2988) - 12
    // 官方锚点劫持到 9000 后必须被即时拉回基准（v0.36.6：scrollTop 直接赋值）
    const hijackAt = scroller.scrollCalls.lastIndexOf(9000)
    assert.ok(hijackAt !== -1 && scroller.scrollCalls.indexOf(2988, hijackAt) !== -1, 'anchor hijack must be reverted instantly')
    // 历史全部加载完（加载更早按钮消失）且已到最顶 → 再次隐藏
    olderBox.remove()
    for (const observer of observers) observer.callback([], () => {})
    assert.equal(btn.style.display, 'none', 'history exhausted at the top hides the up-arrow again')

    // disabled 的「加载更早」（官方 loading 态）：只等待、绝不点击，且每个 220ms
    // 窗口照常消耗重试配额——20 个窗口后必须停表，不得退化成无限等待。
    const disabledBox = new FakeElement('div'); disabledBox.className = 'EvIC1a_older'; scroller.appendChild(disabledBox)
    const disabledBtn = new FakeElement('button'); disabledBtn.disabled = true; disabledBox.appendChild(disabledBtn)
    let disabledClicks = 0
    disabledBtn.addEventListener('click', () => { disabledClicks += 1 })
    for (const observer of observers) observer.callback([], () => {})
    btn.dispatch('click', {})
    for (let i = 0; i < 20; i += 1) await renderer.advanceTimer(220)
    assert.equal(disabledClicks, 0, 'disabled load-older must never be clicked')
    assert.ok(!renderer.pendingTimerDelays().includes(220), 'retry budget must run out and stop scheduling')
    disabledBox.remove()

    // 槽位重建（React 卸载重挂）→ observer 重新挂载新按钮
    slot.remove()
    const slot2 = new FakeElement('div'); slot2.className = 'EvIC1a_toBottomSlot'
    scroller.appendChild(slot2)
    for (const observer of observers) observer.callback([], () => {})
    const btn2 = slot2.children.find((el) => el.attributes.has('data-dshsvc-user-jump'))
    assert.notEqual(btn2, undefined, 'observer must re-mount after slot recreation')
    assert.notEqual(btn2, btn)

    // 官方回合导航条（0.1.2-alpha.2 TurnNavigator，@container ≤900px 隐藏）共存：
    // 曾实验「rail 可见即让位」被用户实测否决（官方 rail 回合级跳转、本按钮逐条
    // 步进，语义位置都不同）→ 上箭头显隐只由可达目标驱动，rail 在场不隐藏按钮；
    // 探针在无 getComputedStyle 的桩环境自然返回 false，行为与真机一致。
    scroller.scrollTop = 5000
    updateFlows() // 三条用户行 flowTop -2000/-1000/-100 → 有可跳目标
    const rail = new FakeElement('div'); rail.className = 'eGxaPq_rail'; scroller.appendChild(rail)
    globalThis.getComputedStyle = () => ({ display: 'flex' })
    for (const observer of observers) observer.callback([], () => {})
    assert.equal(btn2.style.display, 'flex', 'official turn navigator visible must NOT hide the up-arrow (coexists)')
    assert.equal(btn2.isConnected, true)
    delete globalThis.getComputedStyle
    rail.remove()

    // 官方拖动调宽跟随（v1.1.1 用户反馈）：官方 WidthHandle 改内容宽 → 槽位
    // padding-right 变化 → 官方按钮右移；absolute right 是挂载时量的一次性偏移，
    // 不会跟随。引擎用 ResizeObserver 盯槽位 content-box（padding 变化即触发），
    // 实时重测「slot 右缘 − 官方按钮右缘」；拖动期间右缘持续贴住官方按钮。
    const ros = []
    class FakeResizeObserver {
      constructor(callback) { this.callback = callback; ros.push(this) }
      observe() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = FakeResizeObserver
    // 槽位重建 → mount() 为按钮挂新槽位并附上新 RO
    slot2.remove()
    const slot3 = new FakeElement('div'); slot3.className = 'EvIC1a_toBottomSlot'
    scroller.appendChild(slot3)
    slot3.rect.width = 400
    const official3 = new FakeElement('button'); official3.className = 'EvIC1a_toBottom'
    official3.rect.width = 100
    slot3.appendChild(official3)
    for (const observer of observers) observer.callback([], () => {})
    const btn3 = slot3.children.find((el) => el.attributes.has('data-dshsvc-user-jump'))
    assert.notEqual(btn3, undefined, 'observer must re-mount the up-arrow into the new slot')
    assert.equal(btn3.style.right, '300px', 'initial gap = slot right (400) - official right (100)')
    assert.ok(ros.length > 0, 'slot ResizeObserver must be attached on mount')
    // 模拟 WidthHandle 拖动：内容宽变化 → 槽位右缘与官方按钮右缘相对位移
    slot3.rect.width = 600
    official3.rect.width = 450
    ros.at(-1).callback([], () => {})
    assert.equal(btn3.style.right, '150px', 'width drag must re-align the up-arrow to the official button')
    // 反向拖到内容占满：官方按钮右缘回到槽位右缘 → 零偏移
    slot3.rect.width = 500
    official3.rect.width = 500
    ros.at(-1).callback([], () => {})
    assert.equal(btn3.style.right, '0px', 'full-width content re-aligns to zero gap')

    // dispose：按钮与样式全部移除、观察者断开
    renderer.disposeFactory()
    assert.equal(slot3.children.some((el) => el.attributes.has('data-dshsvc-user-jump')), false)
    assert.ok(!head.children.some((el) => (el.textContent || '').includes('[data-dshsvc-user-jump]:hover')))
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
    delete globalThis.getComputedStyle
    delete globalThis.ResizeObserver
  }
})

test('mobile adaptation edge gestures drive the left drawer and the official rightbar drawer, and stay inert when unavailable', async () => {
  // 边缘手势四向开合（2026-09 用户点名）：
  //   左缘右滑开官方左抽屉 / 开着时任意起点右往左滑关；
  //   右缘左滑开官方右栏 / 开着时任意起点左往右滑关；官方右栏未就绪手势无效。
  // 官方右侧栏控制缝（DSH 0.1.5-rc.1 核实）：
  //   [data-sidebar-right-expand]=折叠态展开钮、[data-sidebar-right-toggle]=展开态收起钮、
  //   [data-sidebar-right-open]=展开态面板标记、frame[data-rightbar-collapsed]=外壳轨折叠态。
  class FakeElement {
    constructor(tag) {
      this.tagName = tag
      this.children = []
      this.attributes = new Map()
      this.style = {}
      this.dataset = {}
      this.parentNode = null
      this.className = ''
      this.listeners = new Map()
      this.scrollWidth = 0
      this.clientWidth = 0
      this.clickCalls = 0
    }
    get isConnected() {
      let node = this
      while (node.parentNode !== null) node = node.parentNode
      return node === root
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child }
    remove() {
      if (this.parentNode === null) return
      const index = this.parentNode.children.indexOf(this)
      if (index >= 0) this.parentNode.children.splice(index, 1)
      this.parentNode = null
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null }
    hasAttribute(name) { return this.attributes.has(name) }
    removeAttribute(name) { this.attributes.delete(name) }
    addEventListener(type, handler) { (this.listeners.get(type) || this.listeners.set(type, new Set()).get(type)).add(handler) }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler) }
    dispatch(type, event) { for (const handler of this.listeners.get(type) || []) handler(event || {}) }
    click() { this.clickCalls += 1 } // 程序化 click：真实 DOM 走原生 click 派发同路径
  }
  // 支持裸属性、带值属性与带值复合（[role="dialog"][aria-modal="true"]）的迷你匹配器
  const matchesSelector = (el, selector) => {
    for (const part of selector.split(',')) {
      const trimmed = part.trim()
      const pairs = trimmed.match(/\[([a-z-]+)(?:="([^"]*)")?\]/gi)
      if (pairs === null) continue
      if (pairs.join('') !== trimmed) continue
      const ok = pairs.every((pair) => {
        const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/i.exec(pair)
        if (m === null) return false
        if (m[2] === undefined) return el.attributes.has(m[1])
        return el.attributes.get(m[1]) === m[2]
      })
      if (ok) return true
    }
    return false
  }
  const walk = (node, visit_) => { visit_(node); for (const child of node.children) walk(child, visit_) }

  const root = new FakeElement('#root')
  const head = new FakeElement('head'); root.appendChild(head)
  const bodyEl = new FakeElement('body'); root.appendChild(bodyEl)
  const htmlEl = new FakeElement('html'); root.appendChild(htmlEl)
  // 外壳骨架：折叠态 frame + rightbarCol 三栏 + overlay 子层
  const frame = new FakeElement('div')
  frame.className = 'pI_x6G_frame'
  frame.setAttribute('data-sidebar-collapsed', '')
  frame.setAttribute('data-details-collapsed', '')
  frame.setAttribute('data-rightbar-collapsed', '')
  const sidebarCol = new FakeElement('div'); sidebarCol.className = 'pI_x6G_sidebarCol'
  const centerCol = new FakeElement('div'); centerCol.className = 'pI_x6G_centerCol'
  const detailsCol = new FakeElement('div'); detailsCol.className = 'pI_x6G_detailsCol'
  const rightbarCol = new FakeElement('div'); rightbarCol.className = 'pI_x6G_rightbarCol'; rightbarCol.setAttribute('data-rightbar-col', '')
  const overlayLayer = new FakeElement('div'); overlayLayer.setAttribute('data-shell-overlay', '')
  for (const el of [sidebarCol, centerCol, detailsCol, rightbarCol, overlayLayer]) frame.appendChild(el)
  bodyEl.appendChild(frame)

  // 官方右栏展开与收起按钮夹具：未挂载前右缘手势必须无效
  const expandBtn = new FakeElement('button'); expandBtn.setAttribute('data-sidebar-right-expand', '')
  const toggleBtn = new FakeElement('button'); toggleBtn.setAttribute('data-sidebar-right-toggle', '')
  const rightbarPanel = new FakeElement('div'); rightbarPanel.setAttribute('data-sidebar-right-panel', 'fullscreen')
  rightbarPanel.appendChild(toggleBtn)
  // 横滚内容夹具（CodeMirror 式）：scrollWidth > clientWidth
  const hScroller = new FakeElement('div'); hScroller.scrollWidth = 800; hScroller.clientWidth = 300
  // 裁剪型溢出夹具：横向溢出被 overflow-x:hidden 裁掉（会话滚动体带宽代码块的
  // 真实形态）——v1 横滚守卫只看 scrollWidth 把它误判成横滚区，整页手势全灭
  const hClipper = new FakeElement('div'); hClipper.scrollWidth = 800; hClipper.clientWidth = 300

  const observerCallbacks = []
  class FakeMutationObserver {
    constructor(callback) { observerCallbacks.push(callback) }
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    documentElement: htmlEl,
    head,
    body: bodyEl,
    createElement: (tag) => new FakeElement(tag),
    querySelector(selector) {
      let found = null
      walk(root, (el) => { if (found === null && matchesSelector(el, selector)) found = el })
      return found
    },
    querySelectorAll(selector) {
      const found = []
      walk(root, (el) => { if (matchesSelector(el, selector)) found.push(el) })
      return found
    },
  }

  const layoutCalls = { toggleSidebar: 0, closeDetails: 0 }
  const rpc = async (_channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true, upstreamManaged: false } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 1, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
    if (endpoint === 'quota') return { ok: true, value: { serverTime: Date.now(), providers: [] } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }

  try {
    const renderer = createRenderer(rpc, { featureSettings: { mobileAdaptation: true }, services: { layout: {
      toggleSidebar() { layoutCalls.toggleSidebar += 1 },
      closeDetails() { layoutCalls.closeDetails += 1 },
      openRightbar() {},
      closeRightbar() {},
    } } })
    globalThis.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
    globalThis.window.innerWidth = 390
    // 开 debug 参数：遥测行写入诊断条，测试直接断言芯片文本（含词典化原因值）
    globalThis.window.location = { search: '?dshsvc-mobile-debug=1', reload() {} }
    // debug 分支会往 window 挂 error/resize 监听（诊断条用），与 debug 芯片测试同款桩
    const windowListeners = new Map()
    globalThis.window.addEventListener = (type, handler) => {
      ;(windowListeners.get(type) || windowListeners.set(type, new Set()).get(type)).add(handler)
    }
    globalThis.window.removeEventListener = (type, handler) => { windowListeners.get(type)?.delete(handler) }
    // 横滚守卫的 computed overflow-x 桩：hScroller=auto（真横滚）、hClipper=hidden
    // （裁剪型溢出，不得误杀）、其余 visible。真实浏览器走 CSSOM，桩仅喂测试。
    globalThis.getComputedStyle = (el) => ({ overflowX: el === hScroller ? 'auto' : 'hidden' })
    await renderer.load()

    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), true)
    const fab = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-fab'))
    assert.notEqual(fab, undefined)
    const chipText = () => {
      const chip = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-debug'))
      return chip !== undefined && chip.textContent !== undefined ? chip.textContent : ''
    }
    // buildSurfaces 先建 workspace 再建 frame 观察者 → 最后一个即 frame 回调（同步读改）
    const sync = () => observerCallbacks[observerCallbacks.length - 1]([], () => {})
    const touchAt = (x, y, extra) => ({ touches: [{ clientX: x, clientY: y }], target: extra?.target ?? null })

    // —— 1. 官方右栏未就绪：右缘手势无效；左缘右滑开官方左抽屉 ——
    htmlEl.dispatch('touchstart', touchAt(388, 300))
    htmlEl.dispatch('touchmove', touchAt(360, 300))
    htmlEl.dispatch('touchmove', touchAt(326, 300))
    assert.equal(expandBtn.clickCalls, 0, 'right-edge gesture must be inert while no rightbar is mounted')

    htmlEl.dispatch('touchstart', touchAt(6, 300))
    htmlEl.dispatch('touchmove', touchAt(30, 302))
    htmlEl.dispatch('touchmove', touchAt(64, 302))
    assert.equal(layoutCalls.toggleSidebar, 1, 'left-edge rightward swipe opens the official drawer')
    // 遥测词典化：fire 后芯片显示本地化的种类标签与生效标记
    assert.match(chipText(), /左开/)
    assert.ok(chipText().includes('✓'))
    frame.removeAttribute('data-sidebar-collapsed')
    sync()
    assert.equal(fab.style.display, 'none')

    // 同一触摸内 fired 锁定：越阈后继续滑不重复翻转
    htmlEl.dispatch('touchmove', touchAt(140, 302))
    assert.equal(layoutCalls.toggleSidebar, 1)
    htmlEl.dispatch('touchend', {})

    // —— 2. 左抽屉开着：任意起点右往左滑关闭 ——
    htmlEl.dispatch('touchstart', touchAt(220, 400))
    htmlEl.dispatch('touchmove', touchAt(180, 402))
    htmlEl.dispatch('touchmove', touchAt(160, 402))
    assert.equal(layoutCalls.toggleSidebar, 2, 'leftward swipe anywhere closes the open left drawer')
    frame.setAttribute('data-sidebar-collapsed', '')
    sync()

    // 纵向主导作废：左缘起滑先下垂再横移，绝不能开抽屉（滚动/沉浸优先）
    htmlEl.dispatch('touchstart', touchAt(8, 200))
    htmlEl.dispatch('touchmove', touchAt(4, 230))
    htmlEl.dispatch('touchmove', touchAt(90, 230))
    assert.equal(layoutCalls.toggleSidebar, 2)

    // 多指（捏合）取消
    htmlEl.dispatch('touchstart', { touches: [{ clientX: 6, clientY: 100 }, { clientX: 30, clientY: 120 }], target: null })
    htmlEl.dispatch('touchmove', touchAt(80, 120))
    assert.equal(layoutCalls.toggleSidebar, 2)

    // 中途并指（评审 Spec 防御）：单指起滑后第二指落下 → move 阶段复查作废追踪
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchmove', touchAt(40, 300))
    htmlEl.dispatch('touchmove', { touches: [{ clientX: 80, clientY: 300 }, { clientX: 100, clientY: 320 }], target: null })
    htmlEl.dispatch('touchmove', touchAt(120, 300))
    assert.equal(layoutCalls.toggleSidebar, 2, 'a second finger joining mid-gesture must void the tracker')
    assert.match(chipText(), /多指/)

    // 双抽屉全关 + 非贴边起点：开启语义对齐关闭手势——任意起点横移即可开
    // （真机第三轮用户点名：贴边限制太严）。+x 开左抽屉、−x 开右栏（缺席则该向无效）
    htmlEl.dispatch('touchstart', touchAt(120, 300))
    htmlEl.dispatch('touchmove', touchAt(200, 300))
    assert.equal(layoutCalls.toggleSidebar, 3, 'interior rightward swipe opens the left drawer (close-gesture ergonomics)')
    frame.setAttribute('data-sidebar-collapsed', '')
    sync()
    htmlEl.dispatch('touchstart', touchAt(150, 300))
    htmlEl.dispatch('touchmove', touchAt(80, 300))
    assert.equal(layoutCalls.toggleSidebar, 3)
    assert.equal(expandBtn.clickCalls, 0, 'leftward swipe stays inert while no right-sidebar is mounted')
    // 遥测区分失败形态：左滑方向无效必须记录「右栏缺席」，而非笼统未触发
    assert.match(chipText(), /右栏缺席/)

    // —— 3. 官方右栏上线：进入会话挂载展开钮，右缘左滑开右栏 ——
    // 真实宿主下，SidebarPanel 连同其中的收起按钮 [data-sidebar-right-toggle] 在折叠态下
    // 依然常驻 DOM（仅未打 data-sidebar-right-open、带 aria-hidden="true"）。
    // 此时折叠态绝不可误报为展开态，左抽屉 FAB 必须保持可见，且向右滑必须开左抽屉。
    rightbarPanel.setAttribute('aria-hidden', 'true')
    bodyEl.appendChild(rightbarPanel)
    bodyEl.appendChild(expandBtn)
    sync()
    assert.equal(fab.style.display, 'flex', 'left drawer fab must stay visible when rightbar is mounted but collapsed')

    // 在右栏折叠态下，向右滑必须打开左抽屉，绝不可误判为「关闭右栏」
    const currentToggleSidebar = layoutCalls.toggleSidebar
    htmlEl.dispatch('touchstart', touchAt(100, 300))
    htmlEl.dispatch('touchmove', touchAt(180, 300))
    assert.equal(layoutCalls.toggleSidebar, currentToggleSidebar + 1, 'rightward swipe opens left drawer when rightbar is collapsed')
    assert.equal(toggleBtn.clickCalls, 0, 'opening the left drawer must not toggle the collapsed rightbar')
    layoutCalls.toggleSidebar = currentToggleSidebar // 下文的既有累计断言保持独立
    frame.setAttribute('data-sidebar-collapsed', '')
    sync()

    htmlEl.dispatch('touchstart', touchAt(388, 300))
    htmlEl.dispatch('touchmove', touchAt(360, 298))
    htmlEl.dispatch('touchmove', touchAt(330, 298))
    assert.equal(expandBtn.clickCalls, 1, 'leftward swipe from the right edge opens the official rightbar')
    // 手机全屏态：同一面板始终挂载，frame 的零宽轨折叠标记始终保留。
    expandBtn.remove()
    rightbarPanel.setAttribute('data-sidebar-right-open', '')
    rightbarPanel.removeAttribute('aria-hidden')
    sync()
    assert.equal(fab.style.display, 'none', 'right drawer open must hide the fab')

    // —— 4. 官方右栏开着：横滚内容内起点不关，其余起点左往右滑关 ——
    bodyEl.appendChild(hScroller)
    htmlEl.dispatch('touchstart', touchAt(120, 300, { target: hScroller }))
    htmlEl.dispatch('touchmove', touchAt(190, 300))
    assert.equal(toggleBtn.clickCalls, 0, 'horizontal scrolling content keeps its own swipe semantics')
    hScroller.remove()
    htmlEl.dispatch('touchstart', touchAt(120, 300))
    htmlEl.dispatch('touchmove', touchAt(185, 300))
    assert.equal(toggleBtn.clickCalls, 1, 'rightward swipe anywhere closes the open right drawer')
    rightbarPanel.removeAttribute('data-sidebar-right-open')
    rightbarPanel.setAttribute('aria-hidden', 'true')
    bodyEl.appendChild(expandBtn)
    frame.setAttribute('data-rightbar-collapsed', '')
    sync()
    assert.equal(fab.style.display, 'flex', 'right drawer closed restores the fab')

    // —— 5. 模态全屏态：边缘手势整套禁用 ——
    const modal = new FakeElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    bodyEl.appendChild(modal)
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchmove', touchAt(80, 300))
    assert.equal(layoutCalls.toggleSidebar, 3)
    htmlEl.dispatch('touchstart', touchAt(388, 300))
    htmlEl.dispatch('touchmove', touchAt(320, 300))
    assert.equal(expandBtn.clickCalls, 1)
    modal.remove()

    // —— 6. touchend 清追踪器：抬手后迟到的 move 不再翻转 ——
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchend', {})
    htmlEl.dispatch('touchmove', touchAt(90, 300))
    assert.equal(layoutCalls.toggleSidebar, 3)

    // —— 6b. 系统手势接管（touchcancel）补完：真机「贴边开不了、关正常」的主因。
    // 浏览器认领边缘横滑后以 touchcancel 收场，页面拿不到后续 move——此刻用取消
    // 事件的最终触点按放宽阈值补完，被截走的横滑转化为成功开合。
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchmove', touchAt(28, 303))
    htmlEl.dispatch('touchcancel', { changedTouches: [{ clientX: 36, clientY: 304 }], target: null })
    assert.equal(layoutCalls.toggleSidebar, 4, 'a system-stolen edge swipe completes on touchcancel')

    // 补完阈值(6)内的短横移被取消：不放行（静止触被系统取消 dx≈0 的形态）
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchcancel', { changedTouches: [{ clientX: 12, clientY: 300 }], target: null })
    assert.equal(layoutCalls.toggleSidebar, 4)

    // 纵向主导的原生滚动被接管：斜率检查拒绝补完
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchmove', touchAt(10, 340))
    htmlEl.dispatch('touchcancel', { changedTouches: [{ clientX: 12, clientY: 380 }], target: null })
    assert.equal(layoutCalls.toggleSidebar, 4, 'vertical scroll takeover must not complete an edge gesture')

    // 完整抬手但未达触发阈且无坐标的 touchend（桩 {}）：不补完也不崩
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchmove', touchAt(40, 300))
    htmlEl.dispatch('touchend', {})
    assert.equal(layoutCalls.toggleSidebar, 4)

    // —— 6b2. 快速短拂补完（仅贴边起滑的开启追踪）：未达完整阈就抬手的快拂，
    // 类原生抽屉的速度语义；位移不足 32px 的短拖仍不放行 ——
    htmlEl.dispatch('touchstart', touchAt(8, 300))
    htmlEl.dispatch('touchmove', touchAt(44, 302))
    htmlEl.dispatch('touchend', { changedTouches: [{ clientX: 52, clientY: 304 }], target: null })
    assert.equal(layoutCalls.toggleSidebar, 5, 'a fast short flick from the edge completes the open on touchend')

    // 关闭追踪不做短拂放大：开着时 -40px 快速抬手不关（完整阈仍是 56）
    frame.removeAttribute('data-sidebar-collapsed')
    sync()
    htmlEl.dispatch('touchstart', touchAt(200, 400))
    htmlEl.dispatch('touchmove', touchAt(160, 402))
    htmlEl.dispatch('touchend', { changedTouches: [{ clientX: 160, clientY: 402 }], target: null })
    assert.equal(layoutCalls.toggleSidebar, 5, 'the close path keeps its full 56px threshold')
    frame.setAttribute('data-sidebar-collapsed', '')
    sync()

    // —— 6c. 官方右栏同样受益：右缘起滑被系统接管 → 取消补完开右栏 ——
    htmlEl.dispatch('touchstart', touchAt(386, 300))
    htmlEl.dispatch('touchcancel', { changedTouches: [{ clientX: 350, clientY: 298 }], target: null })
    assert.equal(expandBtn.clickCalls, 2, 'stolen right-edge swipe opens the official rightbar on touchcancel')
    sync()

    // —— 6c2. 非贴边起滑不享受放宽补完：cancel 达阈也不补（系统竞争只在边缘）——
    htmlEl.dispatch('touchstart', touchAt(150, 300))
    htmlEl.dispatch('touchcancel', { changedTouches: [{ clientX: 158, clientY: 300 }], target: null })
    assert.equal(layoutCalls.toggleSidebar, 5)
    assert.equal(expandBtn.clickCalls, 2, 'non-edge origins complete only via the full threshold')

    // —— 6c3. 非贴边左滑 + 右栏在场：完整触发阈开右栏（方向任意起点结算）——
    htmlEl.dispatch('touchstart', touchAt(200, 300))
    htmlEl.dispatch('touchmove', touchAt(140, 300))
    assert.equal(expandBtn.clickCalls, 3, 'interior leftward swipe opens the official rightbar')
    assert.equal(layoutCalls.toggleSidebar, 5)

    // —— 6d. 贴边起滑但落在【真横滚】内容内：开启追踪不起 ——
    bodyEl.appendChild(hScroller)
    htmlEl.dispatch('touchstart', touchAt(6, 300, { target: hScroller }))
    htmlEl.dispatch('touchmove', touchAt(90, 300))
    assert.equal(layoutCalls.toggleSidebar, 5, 'edge swipe inside horizontally scrollable content must not open the drawer')
    hScroller.remove()

    // —— 6e. 裁剪型溢出（overflow-x:hidden）不是横滚语义：不误杀边缘手势 ——
    // 会话滚动体带宽代码块时横向溢出被裁掉，v1 守卫只看 scrollWidth 曾把
    // 整个对话页判成横滚区，真机表现为「开不了、关正常」
    bodyEl.appendChild(hClipper)
    htmlEl.dispatch('touchstart', touchAt(6, 300, { target: hClipper }))
    htmlEl.dispatch('touchmove', touchAt(70, 302))
    assert.equal(layoutCalls.toggleSidebar, 6, 'clipped horizontal overflow must not block the edge open')
    hClipper.remove()

    // —— 7. 热关闭对称拆除 ——
    await renderer.setFeature?.('mobileAdaptation', false)
    assert.equal(htmlEl.attributes.has('data-dshsvc-mobile'), false)
    assert.equal(bodyEl.children.some((el) => el.attributes.has('data-dshsvc-fab')), false)
    htmlEl.dispatch('touchstart', touchAt(6, 300))
    htmlEl.dispatch('touchmove', touchAt(90, 300))
    assert.equal(layoutCalls.toggleSidebar, 6, 'no edge gestures after the engine is off')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
    delete globalThis.window.innerWidth
    delete globalThis.window.location.search
    delete globalThis.getComputedStyle
  }
})

test('session manager tab lists sessions with archive marks, size info, and deleted filter', async () => {
  const calls = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push(endpoint + (payload && payload.scope ? ':' + payload.scope : '')),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  // 切到「维护 → 会话管理」：v0.35 默认停在「仅归档」视图（不全量拉取）。
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  assert.ok(calls.includes('sessions-list:archived'), 'default view requests the archived scope only')
  assert.equal(calls.includes('sessions-list:all'), false, 'no full refresh on open')
  // 默认仅归档：只显示归档行
  assert.equal(renderer.hasTest('sessions-row-session-live'), false, 'default archived view hides live sessions')
  assert.equal(renderer.hasTest('sessions-row-session-cold'), false, 'default archived view hides cold sessions')
  assert.equal(renderer.hasTest('sessions-row-session-archived'), true)
  assert.equal(renderer.hasTest('sessions-tag-archived-session-archived'), true, 'archived session shows archived tag')
  // 归档行不再显示归档按钮，但支持恢复时显示恢复按钮；删除入口保留并在全部视图继续验证。
  assert.equal(renderer.hasTest('sessions-row-archive-session-archived'), false, 'archived session has no archive button')
  assert.equal(renderer.hasTest('sessions-row-unarchive-session-archived'), true, 'archived session has unarchive button')
  // v0.36：体积懒加载——打开即请求可见行体积；行内显示大小、无「—」占位。
  assert.ok(calls.includes('sessions-bytes'), 'lazy bytes RPC fires for visible rows')
  const archivedMeta = renderer.findByTestId('sessions-meta-session-archived')
  const archivedMetaText = Array.isArray(archivedMeta.children) ? archivedMeta.children.join('') : String(archivedMeta.children)
  assert.equal(archivedMetaText.includes('—'), false, 'no dash placeholder for sizes')
  assert.ok(archivedMetaText.includes('1.0 KB'), 'lazy-loaded size appears after the bytes RPC resolves')

  // 切到「全部」：全量拉取 → live/cold 行出现
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.ok(calls.includes('sessions-list:all'))
  assert.equal(renderer.hasTest('sessions-row-session-live'), true)
  assert.equal(renderer.hasTest('sessions-row-session-cold'), true)
  assert.equal(renderer.hasTest('sessions-tag-live-session-live'), true, 'live session shows running tag')
  // 删除按钮只对已归档、非 live 会话出现。
  assert.equal(renderer.hasTest('sessions-row-delete-session-live'), false, 'live session has no delete button')
  assert.equal(renderer.hasTest('sessions-row-delete-session-cold'), false, 'unarchived cold session has no delete button')
  assert.equal(renderer.hasTest('sessions-row-delete-session-archived'), true, 'archived cold session stays deletable')

  assert.equal(renderer.hasTest('sessions-row-archive-session-cold'), true)

  // 已删除筛选（scope=deleted）
  await renderer.findByTestId('sessions-filter-deleted').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-row-session-gone'), true, 'deleted record shown in deleted filter')
  assert.equal(renderer.hasTest('sessions-row-delete-session-gone'), false, 'deleted record is read-only')
})

test('session manager row unarchive restores archived session and updates list', async () => {
  const calls = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push({ endpoint, payload }),
    'sessions-unarchive': (payload) => ({ ok: true, value: { archived: false, id: payload.id } }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()

  assert.equal(renderer.hasTest('sessions-row-unarchive-session-archived'), true)
  await renderer.findByTestId('sessions-row-unarchive-session-archived').props.onClick()
  await renderer.flush()

  assert.deepEqual(calls.filter((c) => c.endpoint === 'sessions-unarchive').map((c) => c.payload.id), ['session-archived'])
  assert.equal(renderer.hasTest('sessions-row-session-archived'), false, 'unarchived session is pruned from archived view')
})

test('session manager unarchive follows the current filter after an in-flight scope switch', async () => {
  for (const start of ['archived', 'all']) {
    let resolveUnarchive
    const renderer = sessionManagerRenderer(createSessionRpcMock({
      'sessions-unarchive': () => new Promise((resolve) => { resolveUnarchive = resolve }),
    }))
    await renderer.load()
    renderer.mount('settings.section')
    await renderer.flush()
    await renderer.findButton('维护').props.onClick()
    await renderer.flush()
    await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
    await renderer.flush()
    if (start === 'all') {
      await renderer.findByTestId('sessions-filter-all').props.onClick()
      await renderer.flush()
    }
    renderer.findByTestId('sessions-row-unarchive-session-archived').props.onClick()
    await renderer.flush()
    const target = start === 'archived' ? 'all' : 'archived'
    await renderer.findByTestId('sessions-filter-' + target).props.onClick()
    await renderer.flush()
    resolveUnarchive({ ok: true, value: { archived: false } })
    await renderer.flush()
    assert.equal(renderer.hasTest('sessions-row-session-archived'), target === 'all', start + ' → ' + target)
    assert.equal(renderer.hasTest('sessions-tag-archived-session-archived'), false)
  }
})

test('session manager restores live archived sessions individually and in batches without enabling deletion', async () => {
  for (const batch of [false, true]) {
    const calls = []
    const renderer = sessionManagerRenderer(createSessionRpcMock({
      onCall: (endpoint, payload) => calls.push({ endpoint, payload }),
      'sessions-list': () => ({ ok: true, value: {
        available: true, canUnarchive: true,
        items: SESSION_LIST_VALUE.items.filter((item) => item.archived).map((item) => ({ ...item, live: true })),
        archivedIds: ['session-archived'], deleted: [],
      } }),
    }))
    await renderer.load()
    renderer.mount('settings.section')
    await renderer.flush()
    await renderer.findButton('维护').props.onClick()
    await renderer.flush()
    await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
    await renderer.flush()
    assert.equal(renderer.hasTest('sessions-row-delete-session-archived'), false)
    if (batch) {
      await renderer.findByTestId('sessions-batch-toggle').props.onClick()
      await renderer.flush()
      await renderer.findByTestId('sessions-select-all').props.onClick()
      await renderer.flush()
      assert.equal(renderer.findByTestId('sessions-batch-delete').props.disabled, true)
      assert.equal(renderer.findByTestId('sessions-batch-unarchive').props.disabled, false)
      await renderer.findByTestId('sessions-batch-unarchive').props.onClick()
    } else {
      assert.equal(renderer.hasTest('sessions-row-unarchive-session-archived'), true)
      await renderer.findByTestId('sessions-row-unarchive-session-archived').props.onClick()
    }
    await renderer.flush()
    assert.deepEqual(calls.filter((call) => call.endpoint === 'sessions-unarchive').map((call) => call.payload.id), ['session-archived'])
    assert.equal(renderer.hasTest('sessions-row-session-archived'), false)
  }
})

test('session manager row unarchive is hidden on legacy host lacking unarchive capability', async () => {
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({
      ok: true,
      value: {
        available: true,
        canUnarchive: false,
        items: SESSION_LIST_VALUE.items.filter((item) => item.archived),
        archivedIds: SESSION_LIST_VALUE.archivedIds,
        deleted: [],
      },
    }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()

  assert.equal(renderer.hasTest('sessions-row-unarchive-session-archived'), false, 'legacy host hides unarchive button')
})

test('session manager list supports project (cwd) sorting rendered as grouped sections', async () => {
  const renderer = sessionManagerRenderer(createSessionRpcMock())
  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  const rowIds = () => renderer.findAllByTestIdPrefix('sessions-row-').filter((node) => !/^sessions-row-(view|export|archive|unarchive|delete)-/.test(node.props['data-testid'])).map((node) => node.props['data-testid'])
  // 默认排序：创建时间倒序（live 3000 → cold 2000 → archived 1000）
  assert.deepEqual(rowIds(), ['sessions-row-session-live', 'sessions-row-session-cold', 'sessions-row-session-archived'])
  // 排序下拉包含「按项目」选项（zh/en 词典平衡由词典用例覆盖）
  const sortSelect = renderer.findByTestId('sessions-sort')
  const projectOption = sortSelect.children.find((option) => option.props.value === 'project')
  assert.notEqual(projectOption, undefined, 'sort dropdown offers the project option')
  assert.equal(projectOption.children[0], '按项目')
  // 切到「按项目」：按 cwd 分区显示——每个工作区一个分区头（路径 + 会话数），且默认折叠
  sortSelect.props.onChange({ target: { value: 'project' } })
  const groups = renderer.findAllByTestIdPrefix('sessions-project-group-')
  assert.equal(groups.length, 2, 'one section per project')
  assert.deepEqual(groups.map((node) => node.props['data-testid']), ['sessions-project-group-0', 'sessions-project-group-1'])
  assert.equal(renderer.findByTestId('sessions-project-header-0').props['data-project'], '/workspace')
  assert.equal(renderer.findByTestId('sessions-project-count-0').children[0], '2 个会话')
  // 默认折叠：分区头常驻、行不渲染；分区头带可点击语义与展开指示
  assert.equal(renderer.findByTestId('sessions-project-header-0').props['data-collapsed'], 'true')
  assert.equal(renderer.findByTestId('sessions-project-header-0').props['aria-expanded'], 'false')
  assert.equal(renderer.findByTestId('sessions-project-header-0').props.role, 'button')
  assert.deepEqual(rowIds(), [], 'project sections are collapsed by default')
  // 点击分区头展开：行出现、同项目内最新在前；计数与 aria 同步翻转
  renderer.findByTestId('sessions-project-header-0').props.onClick()
  assert.equal(renderer.findByTestId('sessions-project-header-0').props['data-collapsed'], 'false')
  assert.equal(renderer.findByTestId('sessions-project-header-0').props['aria-expanded'], 'true')
  const group0Tests = renderer.findAllByTestIdPrefix('sessions-project-group-')[0].children.flat(Infinity).map((child) => child !== null && child !== undefined ? child.props?.['data-testid'] : undefined)
  assert.deepEqual(group0Tests.filter((id) => id !== undefined && id.startsWith('sessions-row-')), ['sessions-row-session-live', 'sessions-row-session-archived'], 'same project groups newest first')
  // 其他分区保持折叠，逐个展开
  assert.equal(renderer.findByTestId('sessions-project-header-1').props['data-collapsed'], 'true')
  assert.equal(rowIds().includes('sessions-row-session-cold'), false)
  renderer.findByTestId('sessions-project-header-1').props.onClick()
  assert.deepEqual(rowIds(), ['sessions-row-session-live', 'sessions-row-session-archived', 'sessions-row-session-cold'])
  // 再点收起第一个分区：只渲染展开的分区行
  renderer.findByTestId('sessions-project-header-0').props.onClick()
  assert.deepEqual(rowIds(), ['sessions-row-session-cold'])
  // 切换排序后滚动恢复上下文仍可计算（listScrollKey 含 sort）
  // 切回「按标题」：标题字母序，且回到平铺（无分区头）
  renderer.findByTestId('sessions-sort').props.onChange({ target: { value: 'title' } })
  assert.deepEqual(rowIds(), ['sessions-row-session-archived', 'sessions-row-session-cold', 'sessions-row-session-live'])
  assert.equal(renderer.findAllByTestIdPrefix('sessions-project-group-').length, 0, 'non-project sorts stay flat')
  // 再切回默认：创建时间倒序恢复
  renderer.findByTestId('sessions-sort').props.onChange({ target: { value: 'createdDesc' } })
  assert.deepEqual(rowIds(), ['sessions-row-session-live', 'sessions-row-session-cold', 'sessions-row-session-archived'])
})

test('session manager batch mode supports multi-select, actions, select all, clear all, and resets across views', async () => {
  const calls = []
  const downloaded = []
  const previousFetch = globalThis.fetch
  const previousDocument = globalThis.document
  globalThis.fetch = async (url, options) => {
    downloaded.push({ url, method: options?.method })
    return { ok: true, status: 200 }
  }
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'a')
      return { href: '', download: '', click() { downloaded.push({ href: this.href, download: this.download }) } }
    },
  }
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push({ endpoint, payload }),
    'sessions-export': (payload) => ({ ok: true, value: { url: '/api/session.export?sessionId=' + payload.id + '&includeDescendants=true', includesDescendants: true } }),
    'sessions-archive': (payload) => ({ ok: true, value: { archived: true, id: payload.id, archivedSessionIds: ['session-archived', payload.id] } }),
    'sessions-delete-plan': (payload) => ({ ok: true, value: { planId: 'plan-' + payload.id, session: { ...SESSION_LIST_VALUE.items.find((item) => item.id === payload.id), bytes: 1024, archived: true }, consequences: ['deletes-session-log'] } }),
    'sessions-delete': (payload) => ({ ok: true, value: { deleted: true, id: payload.planId.replace('plan-', '') } }),
  }))

  try {
    await renderer.load()
    renderer.mount('settings.section')
    await renderer.flush()
    await renderer.findButton('维护').props.onClick()
    await renderer.flush()
    await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
    await renderer.flush()

    assert.equal(renderer.hasTest('sessions-batch-toggle'), true, 'normal session list exposes batch selection')
    assert.equal(renderer.hasTest('sessions-select-session-archived'), false, 'row checkboxes stay hidden before entering batch mode')
    assert.equal(renderer.findByTestId('sessions-row-session-archived').props.onClick, undefined, 'ordinary rows do not replace their explicit action buttons')
    await renderer.findByTestId('sessions-batch-toggle').props.onClick()
    await renderer.flush()
    assert.equal(renderer.findByTestId('sessions-batch-toggle').children[0], '退出批量')
    assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 0 项')
    assert.equal(renderer.hasTest('sessions-select-session-archived'), true)
    assert.equal(renderer.hasTest('sessions-row-view-session-archived'), false, 'batch mode hides per-row actions')

    await renderer.findByTestId('sessions-row-session-archived').props.onClick()
    await renderer.flush()
    assert.equal(renderer.findByTestId('sessions-select-session-archived').props.checked, true, 'clicking anywhere on a batch row selects it')
    await renderer.findByTestId('sessions-row-session-archived').props.onClick()
    await renderer.flush()
    assert.equal(renderer.findByTestId('sessions-select-session-archived').props.checked, false, 'clicking a selected batch row clears it')
    let checkboxClickStopped = false
    renderer.findByTestId('sessions-select-session-archived').props.onClick({ stopPropagation() { checkboxClickStopped = true } })
    assert.equal(checkboxClickStopped, true, 'checkbox clicks do not bubble into the row and toggle twice')
    await renderer.findByTestId('sessions-select-session-archived').props.onChange({ target: { checked: true } })
    await renderer.flush()
    assert.equal(renderer.findByTestId('sessions-select-session-archived').props.checked, true)
    assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 1 项')
    const selectedRow = renderer.findByTestId('sessions-row-session-archived')
    assert.equal(selectedRow.props.style.background, 'transparent', 'selection must not replace the row background color')
    assert.match(selectedRow.props.style.boxShadow, /brand-primary/, 'selection uses a narrow accent marker instead')
    assert.equal(renderer.findByTestId('sessions-batch-export').props.disabled, false)
    assert.equal(renderer.findByTestId('sessions-batch-archive').props.disabled, true, 'already archived rows are not archive candidates')
    assert.equal(renderer.findByTestId('sessions-batch-unarchive').props.disabled, false, 'already archived rows are unarchive candidates')
    assert.equal(renderer.findByTestId('sessions-batch-delete').props.disabled, false)
    assert.equal(renderer.findByTestId('sessions-select-all').children[0], '取消全选', 'single visible row means manual selection reaches all-selected state')

    await renderer.findByTestId('sessions-batch-export').props.onClick()
    await renderer.flush()
    assert.deepEqual(calls.filter((call) => call.endpoint === 'sessions-export').map((call) => call.payload.id), ['session-archived'])
    assert.ok(downloaded.some((item) => item.download === 'dsh-session-session-archived.zip'), 'batch export triggers the official download path')

    await renderer.findByTestId('sessions-select-all').props.onClick()
    await renderer.flush()
    assert.equal(renderer.findByTestId('sessions-select-session-archived').props.checked, false)
    assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 0 项')
    assert.equal(renderer.findByTestId('sessions-select-all').children[0], '全选')

    await renderer.findByTestId('sessions-filter-all').props.onClick()
    await renderer.flush()
    assert.equal(renderer.hasTest('sessions-batch-bar'), false, 'changing filters exits batch mode')
    await renderer.findByTestId('sessions-batch-toggle').props.onClick()
    await renderer.flush()
    await renderer.findByTestId('sessions-select-session-cold').props.onChange({ target: { checked: true } })
    await renderer.flush()
    assert.equal(renderer.findByTestId('sessions-batch-archive').props.disabled, false)
    assert.equal(renderer.findByTestId('sessions-batch-delete').props.disabled, true)
    await renderer.findByTestId('sessions-batch-archive').props.onClick()
    await renderer.flush()
    assert.deepEqual(calls.filter((call) => call.endpoint === 'sessions-archive').map((call) => call.payload.id), ['session-cold'])
    assert.equal(renderer.hasTest('sessions-tag-archived-session-cold'), true, 'batch archive updates the local row immediately')

    await renderer.findByTestId('sessions-select-all').props.onClick()
    await renderer.flush()
    assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 3 项')
    assert.equal(renderer.findByTestId('sessions-select-session-live').props.checked, true)
    assert.equal(renderer.findByTestId('sessions-select-session-cold').props.checked, true)
    assert.equal(renderer.findByTestId('sessions-select-session-archived').props.checked, true)

    await renderer.findByTestId('sessions-batch-delete').props.onClick()
    await renderer.flush()
    assert.equal(renderer.hasTest('sessions-delete-modal'), true, 'batch delete still requires the confirmation modal')
    assert.deepEqual(calls.filter((call) => call.endpoint === 'sessions-delete-plan').map((call) => call.payload.id), ['session-cold', 'session-archived'], 'only archived non-live selections receive delete plans')
    await renderer.findByTestId('sessions-delete-confirm').props.onClick()
    await renderer.flush()
    assert.deepEqual(calls.filter((call) => call.endpoint === 'sessions-delete').map((call) => call.payload.planId), ['plan-session-cold', 'plan-session-archived'])
    assert.equal(renderer.hasTest('sessions-row-session-live'), true, 'live selections are never deleted')
    assert.equal(renderer.hasTest('sessions-row-session-cold'), false)
    assert.equal(renderer.hasTest('sessions-row-session-archived'), false)
    assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 1 项', 'selection prunes deleted rows and keeps the remaining live row')

    await renderer.findByTestId('sessions-batch-toggle').props.onClick()
    await renderer.flush()
    assert.equal(renderer.hasTest('sessions-batch-bar'), false)
    assert.equal(renderer.hasTest('sessions-row-view-session-live'), true, 'leaving batch mode restores row actions')

    const searchInput = renderer.findByTestId('sessions-search-input')
    searchInput.props.onChange({ target: { value: 'answer' } })
    await renderer.flush()
    assert.equal(renderer.hasTest('sessions-batch-toggle'), false, 'search results do not expose batch selection')

    await renderer.findByTestId('sessions-filter-deleted').props.onClick()
    await renderer.flush()
    assert.equal(renderer.hasTest('sessions-batch-toggle'), true, 'deleted records support batch selection for clearing')
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = previousFetch
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
})

test('session manager identifies subagent sessions with a badge, a subagent-only filter, and one-click batch selection', async () => {
  const subagentList = {
    available: true,
    items: [
      { id: 'session-main', title: 'Main talk', cwd: '/workspace', createdAt: 5000, live: true, persisted: true, archived: false, subagent: false },
      { id: 'session-sub-one', title: 'Sub one', cwd: '/workspace', createdAt: 4000, live: false, persisted: true, archived: false, subagent: true },
      { id: 'session-sub-two', title: 'Sub two', cwd: '/workspace', createdAt: 3000, live: false, persisted: true, archived: false, subagent: true },
      { id: 'session-archived-main', title: 'Archived main', cwd: '/workspace', createdAt: 2000, live: false, persisted: true, archived: true, subagent: false },
      { id: 'session-forked', title: 'Forked talk', cwd: '/workspace', createdAt: 1000, live: false, persisted: true, archived: false, subagent: false },
    ],
    archivedIds: ['session-archived-main'],
    deleted: [{ id: 'session-gone', title: 'Gone session', cwd: '/tmp', deletedAt: 500 }],
  }
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': (payload) => {
      const scope = payload?.scope || 'all'
      if (scope === 'archived') return { ok: true, value: { available: true, items: subagentList.items.filter((item) => item.archived), archivedIds: subagentList.archivedIds, deleted: [] } }
      if (scope === 'deleted') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: subagentList.deleted } }
      return { ok: true, value: subagentList }
    },
  }))
  const rowIds = () => renderer.findAllByTestIdPrefix('sessions-row-').filter((node) => !/^sessions-row-(view|export|archive|unarchive|delete)-/.test(node.props['data-testid'])).map((node) => node.props['data-testid'])

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()

  // 默认普通模式：批量条不可见
  assert.equal(renderer.hasTest('sessions-batch-bar'), false, 'panel opens in normal mode by default')

  // 默认「仅归档」视图：归档的非子代理行无徽标；子代理限定是复选框（收纳后与「仅搜归档」同行）
  assert.equal(renderer.hasTest('sessions-tag-subagent-session-archived-main'), false, 'non-subagent rows carry no subagent badge')
  const subagentBox = renderer.findByTestId('sessions-filter-subagent')
  assert.equal(subagentBox.props.type, 'checkbox')
  assert.equal(subagentBox.props.checked, false)

  // 进入批量：归档视图无子代理行 → 「选中子代理」整键隐藏（隐藏代替禁用）
  await renderer.findByTestId('sessions-batch-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-batch-select-subagents'), false, 'the quick select stays hidden when no subagent rows are visible')

  // 切「全部」（切筛选退出批量）：子代理行带徽标，非子代理行（含纯 fork 血统）不带
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-batch-bar'), false, 'changing filters exits batch mode')
  assert.equal(renderer.hasTest('sessions-tag-subagent-session-sub-one'), true)
  assert.equal(renderer.hasTest('sessions-tag-subagent-session-sub-two'), true)
  assert.equal(renderer.hasTest('sessions-tag-subagent-session-main'), false)
  assert.equal(renderer.hasTest('sessions-tag-subagent-session-forked'), false)
  assert.equal(renderer.hasTest('sessions-tag-subagent-session-archived-main'), false)
  assert.deepEqual(rowIds().length, 5)

  // 仅子代理复选框：普通态同样可用，勾选后只剩子代理行，取消恢复全量
  renderer.findByTestId('sessions-filter-subagent').props.onChange({ target: { checked: true } })
  await renderer.flush()
  assert.equal(renderer.findByTestId('sessions-filter-subagent').props.checked, true)
  assert.deepEqual(rowIds(), ['sessions-row-session-sub-one', 'sessions-row-session-sub-two'])
  renderer.findByTestId('sessions-filter-subagent').props.onChange({ target: { checked: false } })
  await renderer.flush()
  assert.deepEqual(rowIds().length, 5)

  // 批量态一键选中子代理：追加语义（不清既有选择）、重复点击不重复计数
  await renderer.findByTestId('sessions-batch-toggle').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-batch-select-subagents').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 2 项')
  assert.equal(renderer.findByTestId('sessions-select-session-sub-one').props.checked, true)
  assert.equal(renderer.findByTestId('sessions-select-session-sub-two').props.checked, true)
  assert.equal(renderer.findByTestId('sessions-select-session-main').props.checked, false)
  await renderer.findByTestId('sessions-batch-select-subagents').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 2 项', 'repeated clicks must not duplicate the selection')

  // 全选后勾选仅子代理：隐藏行同步出选择集（计数裁剪），复选框不退出批量态
  await renderer.findByTestId('sessions-select-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 5 项')
  renderer.findByTestId('sessions-filter-subagent').props.onChange({ target: { checked: true } })
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-batch-bar'), true, 'the subagent qualifier stays available inside batch mode')
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 2 项', 'hidden non-subagent rows are pruned from the selection')
  assert.deepEqual(rowIds(), ['sessions-row-session-sub-one', 'sessions-row-session-sub-two'])

  // 「已删除」视图：复选框隐藏（墓碑记录无子代理标志）
  await renderer.findByTestId('sessions-filter-deleted').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-filter-subagent'), false, 'the subagent qualifier stays hidden in the deleted view')
})

test('session manager shows a legacy-host hint when the subagent filter finds no flags in the list', async () => {
  const legacyList = {
    available: true,
    items: [
      { id: 'session-old-a', title: 'Old A', cwd: '/workspace', createdAt: 2000, live: false, persisted: true, archived: false },
      { id: 'session-old-b', title: 'Old B', cwd: '/workspace', createdAt: 1000, live: false, persisted: true, archived: false },
    ],
    archivedIds: [],
    deleted: [],
  }
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': (payload) => {
      const scope = payload?.scope || 'all'
      if (scope === 'archived') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: [] } }
      if (scope === 'deleted') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: [] } }
      return { ok: true, value: legacyList }
    },
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // 切「全部」让列表带条目
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-subagent-legacy-hint'), false, 'no hint before enabling the qualifier')
  renderer.findByTestId('sessions-filter-subagent').props.onChange({ target: { checked: true } })
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-subagent-legacy-hint'), true, 'legacy host (no subagent flags) explains the empty filtered list')
  assert.equal(renderer.findByTestId('sessions-subagent-legacy-hint').children[0], '当前插件宿主较旧，列表未携带子代理标志；升级插件并重启 dsh 后「仅子代理」才会生效')
})

test('session manager deleted records support single clear, multi-select clear, and select-all clear with confirmation', async () => {
  const calls = []
  const initialDeleted = [
    { id: 'del-alpha', title: 'Deleted Alpha', cwd: '/workspace', deletedAt: 3000 },
    { id: 'del-beta', title: 'Deleted Beta', cwd: '/workspace', deletedAt: 2000 },
    { id: 'del-gamma', title: 'Deleted Gamma', cwd: '/workspace', deletedAt: 1000 },
  ]
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push({ endpoint, payload }),
    'sessions-list': (payload) => {
      const scope = payload?.scope || 'all'
      if (scope === 'deleted') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: initialDeleted } }
      return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: initialDeleted } }
    },
    'sessions-clear-deleted': (payload) => {
      const ids = payload?.ids || []
      return { ok: true, value: { cleared: true, count: ids.length, ids } }
    },
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()

  // 切换到已删除筛选
  await renderer.findByTestId('sessions-filter-deleted').props.onClick()
  await renderer.flush()

  // 验证三条记录展示，每行有清除按钮，无删除按钮
  assert.equal(renderer.hasTest('sessions-row-del-alpha'), true)
  assert.equal(renderer.hasTest('sessions-row-del-beta'), true)
  assert.equal(renderer.hasTest('sessions-row-del-gamma'), true)
  assert.equal(renderer.hasTest('sessions-row-clear-del-alpha'), true)
  assert.equal(renderer.hasTest('sessions-row-delete-del-alpha'), false)

  // 1. 单条清除流程：点击清除 -> 弹出两段式确认模态 -> 点击取消 -> 模态关闭且记录仍在
  await renderer.findByTestId('sessions-row-clear-del-alpha').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), true)
  await renderer.findByTestId('sessions-clear-cancel').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), false)
  assert.equal(renderer.hasTest('sessions-row-del-alpha'), true)

  // 再次点击清除 -> 确认清除 -> 调用 RPC 并从视图移除 del-alpha
  await renderer.findByTestId('sessions-row-clear-del-alpha').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-clear-confirm').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), false)
  assert.equal(renderer.hasTest('sessions-row-del-alpha'), false)
  assert.equal(renderer.hasTest('sessions-row-del-beta'), true)
  assert.equal(renderer.hasTest('sessions-row-del-gamma'), true)
  assert.deepEqual(calls.filter((c) => c.endpoint === 'sessions-clear-deleted').map((c) => c.payload.ids), [['del-alpha']])

  // 2. 批量选择（多选）清除流程：进入批量态
  await renderer.findByTestId('sessions-batch-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-batch-bar'), true)
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 0 项')
  assert.equal(renderer.findByTestId('sessions-batch-clear').props.disabled, true)

  // 选中 del-beta
  await renderer.findByTestId('sessions-row-del-beta').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 1 项')
  assert.equal(renderer.findByTestId('sessions-batch-clear').props.disabled, false)
  assert.equal(renderer.findByTestId('sessions-batch-clear').children[0], '清除 (1)')

  // 点击批量清除 -> 确认模态 -> 确认
  await renderer.findByTestId('sessions-batch-clear').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), true)
  assert.equal(renderer.hasTest('sessions-clear-list'), true)
  await renderer.findByTestId('sessions-clear-confirm').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), false)
  assert.equal(renderer.hasTest('sessions-row-del-beta'), false)
  assert.equal(renderer.hasTest('sessions-row-del-gamma'), true)
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 0 项')
  assert.equal(renderer.findByTestId('sessions-batch-result').children[0], '已完成清除：1 项')

  // 3. 全选清除流程：点击全选 -> 选中剩余的 del-gamma -> 批量清除
  await renderer.findByTestId('sessions-select-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('sessions-selected-count').children[0], '已选择 1 项')
  assert.equal(renderer.findByTestId('sessions-select-all').children[0], '取消全选')

  await renderer.findByTestId('sessions-batch-clear').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), true)
  await renderer.findByTestId('sessions-clear-confirm').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), false)
  assert.equal(renderer.hasTest('sessions-row-del-gamma'), false)

  // 全部清除后列表显示空提示
  assert.match(renderer.text(), /暂无删除记录/)

  // 退出批量态
  await renderer.findByTestId('sessions-batch-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-batch-bar'), false)
})

test('session manager clear error path renders message text instead of crashing the panel on strict rpc error objects', async () => {
  // 真壳回归（白屏根因）：宿主/派发层对 ok:false 一律回 rpcErrorSchema 枚举对象
  // （如 {code:'internal',message:'unknown-endpoint',details:{}}——宿主未重载新端点、
  // 磁盘写失败等都走它）。真实 React 把对象 children 判 #31 → 整个 settings.section
  // 槽位错误边界吞成白屏。替身 createElement 已开 #31 严格语义，此测试在坏代码上
  // 必炸、修复后必须存活。
  const initialDeleted = [
    { id: 'del-alpha', title: 'Deleted Alpha', cwd: '/workspace', deletedAt: 3000 },
    { id: 'del-beta', title: 'Deleted Beta', cwd: '/workspace', deletedAt: 2000 },
  ]
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': (payload) => {
      const scope = payload?.scope || 'all'
      if (scope === 'deleted') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: initialDeleted } }
      return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: initialDeleted } }
    },
    // 真壳派发层对未知端点的返回形状（逐字节同款）
    'sessions-clear-deleted': () => ({ ok: false, error: { code: 'internal', message: 'unknown-endpoint', details: {} } }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-filter-deleted').props.onClick()
  await renderer.flush()

  // 单条清除失败：模态保持打开、错误以可读文本呈现、面板其余部分照常渲染（无白屏）
  await renderer.findByTestId('sessions-row-clear-del-alpha').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-clear-confirm').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-clear-modal'), true, 'failed single clear keeps the confirm modal open')
  assert.match(renderer.text(), /unknown-endpoint/)
  assert.equal(renderer.hasTest('sessions-row-del-alpha'), true, 'panel still renders rows after error')
  assert.equal(renderer.hasTest('sessions-row-del-beta'), true)
  assert.equal(renderer.hasTest('sessions-filter-deleted'), true, 'filter bar still alive (no section crash)')

  // 取消后行仍在
  await renderer.findByTestId('sessions-clear-cancel').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-row-del-alpha'), true)

  // 批量清除失败：同形状错误进批量错误条（也是 children 渲染），面板同样必须存活
  await renderer.findByTestId('sessions-batch-toggle').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-row-del-alpha').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-batch-clear').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-clear-confirm').props.onClick()
  await renderer.flush()
  assert.match(renderer.findByTestId('sessions-batch-error').children.join(''), /unknown-endpoint/)
  assert.equal(renderer.hasTest('sessions-row-del-alpha'), true, 'panel still renders rows after batch error')
})

test('session manager detail pages events, loads more with seq cursor, and triggers export', async () => {
  const calls = []
  const viewResponses = {
      'session-cold': {
        ok: true,
        value: {
          session: { id: 'session-cold', title: 'Cold session', cwd: '/workspace/projects', createdAt: 2000 },
          items: [
            { seq: 0, type: 'user/message', time: 2001, text: 'first question', noise: false },
            { seq: 1, type: 'assistant/message', time: 2002, text: 'first answer', noise: false },
            { seq: 2, type: 'session/created', time: 2000, text: '', noise: true },
          ],
          nextCursor: undefined,
          total: 3,
        },
      },
  }
  const renderer = sessionManagerRenderer(createSessionRpcMock({
      onCall: (endpoint) => calls.push(endpoint),
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-view': () => viewResponses['session-cold'],
    'sessions-export': () => ({ ok: true, value: { url: '/api/session.export?sessionId=session-cold&includeDescendants=true', includesDescendants: true } }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-detail'), true)
  assert.equal(renderer.hasTest('sessions-event-0'), true)
  assert.equal(renderer.hasTest('sessions-event-1'), true)
  // v0.36（用户点名「查看渲染优化」）：系统事件默认折叠为一块——不再逐条渲染卡片。
  assert.equal(renderer.hasTest('sessions-event-2'), false, 'noise event is collapsed into a block by default')
  assert.equal(renderer.hasTest('sessions-noisewall-2'), true, 'collapsed noise block rendered with its first seq as the key')
  await renderer.findByTestId('sessions-noisewall-toggle-2').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-event-2'), true, 'expanding the noise block reveals its events')
  assert.equal(renderer.findByTestId('sessions-event-type-2').children[0], '系统事件', 'noise event labeled as system event')
  // 收起后再折叠。
  await renderer.findByTestId('sessions-noisewall-toggle-2').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-event-2'), false, 'collapsing hides the noise events again')
  // v0.36 用户点名：正文走官方 MarkdownText（platform seed 替身渲染 data-testid=md-markdown）。
  assert.equal(renderer.hasTest('sessions-event-text-0'), true, 'event body container present')
  const mdText = renderer.findByTestId('sessions-event-text-0').children[0]
  assert.ok(mdText !== undefined && mdText.type === 'div' && mdText.props['data-testid'] === 'md-markdown', 'official MarkdownText wrapped the event body')
  assert.equal(mdText.children[0], 'first question', 'text flows through the official renderer')
  assert.equal(renderer.hasTest('sessions-detail-back'), true)
  assert.equal(renderer.hasTest('sessions-detail-export'), true)
  assert.equal(renderer.hasTest('sessions-detail-more'), false, 'no load-more when all events loaded')
})

test('session manager detail open button uses uiWorkspace.openSession when available', async () => {
  const opened = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold', title: 'Cold session' }, items: [] } }),
  }), {
    services: {
      uiWorkspace: {
        openSession(id) { opened.push(id) },
      },
    },
  })
  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-detail-open'), true)
  renderer.findByTestId('sessions-detail-open').props.onClick()
  assert.deepEqual(opened, ['session-cold'], 'uiWorkspace.openSession was called with session id')
})

test('session manager folds tool messages by default and expands them on demand', async () => {
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    // v1.6.x（用户点名「tool 相关的消息也默认折叠」）：宿主给工具消息打 tool 标志——
    // tool/call、tool/result 与「通篇只有工具调用」的 assistant/message 都归此类。
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold', title: 'Cold session' }, items: [
      { seq: 0, type: 'user/message', time: 2000, text: '帮我看看', noise: false, tool: false },
      { seq: 1, type: 'assistant/message', time: 2001, text: 'edit\n{"file_path":"a.js"}', noise: false, tool: true },
      { seq: 2, type: 'tool/call', time: 2002, text: 'bash\n{"command":"ls"}', noise: false, tool: true },
      { seq: 3, type: 'tool/result', time: 2003, text: 'output', noise: false, tool: true },
      { seq: 4, type: 'step/end', time: 2004, text: '', noise: true, tool: false },
      { seq: 5, type: 'assistant/message', time: 2005, text: '看完了', noise: false, tool: false },
    ], nextCursor: undefined, total: 6 } }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()

  // 普通事件原样渲染，工具消息连续三条合并为一块（默认折叠）。
  assert.equal(renderer.hasTest('sessions-event-0'), true)
  assert.equal(renderer.hasTest('sessions-event-1'), false, 'a tool-only assistant message is folded')
  assert.equal(renderer.hasTest('sessions-event-2'), false, 'tool/call is folded')
  assert.equal(renderer.hasTest('sessions-event-3'), false, 'tool/result is folded')
  assert.equal(renderer.hasTest('sessions-toolwall-1'), true, 'consecutive tool messages collapse into one block keyed by the first seq')
  assert.equal(renderer.findByTestId('sessions-toolwall-toggle-1').children[0], '▸ 3 条工具消息', 'the collapsed line reports the tool-message count')
  // 系统事件块与工具消息块各自成块、不混排。
  assert.equal(renderer.hasTest('sessions-noisewall-4'), true, 'the noise run right after the tool run keeps its own block')
  assert.equal(renderer.hasTest('sessions-event-5'), true, 'the readable assistant message stays inline')
  // 展开：三条工具消息明细逐条出现（类型沿用原始事件类型，便于看工具流量）。
  await renderer.findByTestId('sessions-toolwall-toggle-1').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-event-1'), true)
  assert.equal(renderer.hasTest('sessions-event-2'), true)
  assert.equal(renderer.hasTest('sessions-event-3'), true)
  assert.equal(renderer.findByTestId('sessions-event-type-2').children[0], 'tool/call', 'folded tool cards keep their raw event type')
  assert.equal(renderer.findByTestId('sessions-toolwall-toggle-1').children[0], '▾ 收起', 'the expanded line offers collapse')
  // 收起后再折叠。
  await renderer.findByTestId('sessions-toolwall-toggle-1').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-event-2'), false, 'collapsing hides the tool messages again')
})

test('session manager expands a folded block when a search hit lands inside it', async () => {
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-search': () => ({ ok: true, value: { available: true, query: 'bash', scope: 'all', hits: [{ sessionId: 'session-cold', title: 'Cold session', items: [{ seq: 2, type: 'tool/call', snippet: 'bash {"command":"ls"}' }] }] } }),
    // 命中落在工具消息块内：块默认展开，命中行带 HIT 徽章与 jump 锚点（v0.37 定位前提）。
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold' }, items: [
      { seq: 0, type: 'assistant/message', time: 2000, text: '', noise: false, tool: true },
      { seq: 1, type: 'tool/call', time: 2001, text: 'read\n{"path":"a.js"}', noise: false, tool: true },
      { seq: 2, type: 'tool/call', time: 2002, text: 'bash\n{"command":"ls"}', noise: false, tool: true },
      { seq: 3, type: 'tool/result', time: 2003, text: 'output', noise: false, tool: true },
    ], nextCursor: undefined, total: 60, centerSeq: 2 } }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  renderer.findByTestId('sessions-search-input').props.onChange({ target: { value: 'bash' } })
  await renderer.flush()
  await renderer.advanceTimer(300)
  await renderer.flush()
  await renderer.findByTestId('sessions-hit-open-session-cold').props.onClick()
  await renderer.flush()

  assert.equal(renderer.hasTest('sessions-toolwall-0'), true, 'the tool block is rendered')
  assert.equal(renderer.hasTest('sessions-event-2'), true, 'a block containing the hit opens by default')
  assert.equal(renderer.hasTest('sessions-jump-target-2'), true, 'the hit inside the block keeps its jump anchor')
  assert.equal(renderer.hasTest('sessions-jump-badge-2'), true, 'the hit inside the block shows the HIT badge')
  // 用户显式收起优先于「命中即展开」：收起后明细（含命中行）隐藏。
  await renderer.findByTestId('sessions-toolwall-toggle-0').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-event-2'), false, 'an explicit collapse wins over the hit auto-expand')
})

test('session manager restores the list scroll position after returning from detail', async () => {
  const calls = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint) => calls.push(endpoint),
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold', title: 'Cold session' }, items: [{ seq: 0, type: 'user/message', time: 2001, text: 'hi', noise: false }], nextCursor: undefined, total: 1 } }),
  }))

  // v0.37 假滚动容器 = 官方 .VOzbGW_options 的替身：列表长到可滚、scrollTop 站在 640。
  // 点击行的 DOM 祖先链：view 按钮 → 行包装 → 这个滚动容器（inline overflow-y:auto）。
  const scrollContainer = { nodeType: 1, scrollTop: 640, scrollHeight: 3000, clientHeight: 400, style: { overflowY: 'auto' } }
  const rowWrap = { nodeType: 1, style: {}, parentNode: scrollContainer }
  const buttonNode = { nodeType: 1, style: {}, parentNode: rowWrap }

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // 点「查看」时带上真实点击事件 → 组件沿祖先链找到滚动容器并记下 scrollTop。
  renderer.findByTestId('sessions-row-view-session-cold').props.onClick({ currentTarget: buttonNode })
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-detail'), true)
  // 详情里滚动到别处（模拟长详情把容器 scrollTop 带走）。
  scrollContainer.scrollTop = 120
  // 返回列表：筛选/排序/搜索上下文未变 → 恢复 640（不再回到顶部）。
  await renderer.findByTestId('sessions-detail-back').props.onClick()
  await renderer.flush()
  assert.equal(scrollContainer.scrollTop, 640, 'back from detail restores the saved list scroll position')
  assert.equal(renderer.hasTest('sessions-row-session-cold'), true, 'list rendered again')
  // 无点击事件（老调用方/坏事件）时不保存也不崩溃：再进再出，容器位置保持现状。
  renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()
  scrollContainer.scrollTop = 200
  await renderer.findByTestId('sessions-detail-back').props.onClick()
  await renderer.flush()
  assert.equal(scrollContainer.scrollTop, 200, 'no event → nothing saved → back leaves the scroll untouched')
})

test('session manager does not restore scroll onto a different filter, and restores for search-hit returns', async () => {
  const calls = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint) => calls.push(endpoint),
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-search': () => ({ ok: true, value: { available: true, query: 'answer', scope: 'all', hits: [{ sessionId: 'session-cold', title: 'Cold session', items: [{ seq: 1, type: 'assistant/message', snippet: 'first answer' }] }] } }),
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold', title: 'Cold session' }, items: [], nextCursor: undefined, total: 0 } }),
  }))

  const scrollContainer = { nodeType: 1, scrollTop: 640, scrollHeight: 3000, clientHeight: 400, style: { overflowY: 'auto' } }
  const rowWrap = { nodeType: 1, style: {}, parentNode: scrollContainer }
  const buttonNode = { nodeType: 1, style: {}, parentNode: rowWrap }

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // 带事件进详情（保存 640），在详情里滚动到 120，然后切「全部」筛选。
  renderer.findByTestId('sessions-row-view-session-cold').props.onClick({ currentTarget: buttonNode })
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-detail'), true)
  scrollContainer.scrollTop = 120
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.notEqual(scrollContainer.scrollTop, 640, 'filter changed mid-detail → old position is NOT restored onto the new list')
  // 切回「仅归档」，再从搜索结果进详情：搜索命中路径同样恢复。
  await renderer.findByTestId('sessions-filter-archived').props.onClick()
  await renderer.flush()
  const searchInput = renderer.findByTestId('sessions-search-input')
  searchInput.props.onChange({ target: { value: 'answer' } })
  await renderer.flush()
  await renderer.advanceTimer(300)
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-hit-open-session-cold'), true)
  scrollContainer.scrollTop = 640
  renderer.findByTestId('sessions-hit-open-session-cold').props.onClick({ currentTarget: buttonNode })
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-detail-return-search'), true)
  scrollContainer.scrollTop = 40
  await renderer.findByTestId('sessions-detail-return-search').props.onClick()
  await renderer.flush()
  assert.equal(scrollContainer.scrollTop, 640, 'returning from a search-hit detail restores the search results scroll position')
})

test('session manager search opens a hit window with highlight, context, and match navigation', async () => {
  const calls = []
  const viewCenters = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint) => calls.push(endpoint),
    'sessions-search': () => ({ ok: true, value: { available: true, query: 'answer', scope: 'all', hits: [{ sessionId: 'session-cold', title: 'Cold session', items: [{ seq: 1, type: 'assistant/message', snippet: 'first answer' }] }] } }),
    'sessions-view': (payload) => {
      viewCenters.push(payload && payload.center !== undefined ? payload.center : null)
      // v0.37：命中窗口视图——围绕 center 的上下文窗口，命中行的 text 与上下文都全量返回。
      return { ok: true, value: { session: { id: 'session-cold' }, items: [
        { seq: 0, type: 'session/created', time: 2000, text: '', noise: true },
        { seq: 1, type: 'assistant/message', time: 2002, text: 'first answer', noise: false },
        { seq: 2, type: 'user/message', time: 2003, text: 'follow-up here', noise: false },
      ], nextCursor: undefined, total: 100, centerSeq: 1 } }
    },
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  const searchInput = renderer.findByTestId('sessions-search-input')
  searchInput.props.onChange({ target: { value: 'answer' } })
  await renderer.flush()
  // 搜索防抖 300ms 走 Fiber 托管的 ctx.timer。
  await renderer.advanceTimer(300)
  await renderer.flush()
  assert.ok(calls.includes('sessions-search'))
  assert.equal(renderer.hasTest('sessions-hit-session-cold'), true)
  assert.equal(renderer.hasTest('sessions-hit-open-session-cold'), true)
  assert.equal(renderer.hasTest('sessions-hit-highlight-session-cold-0'), true, 'the matching snippet text is highlighted')
  // v0.37：点开命中 → 直接以首个命中 seq 为中心拉上下文窗口（不再从头分页的浪费调用）。
  await renderer.findByTestId('sessions-hit-open-session-cold').props.onClick()
  await renderer.flush()
  assert.deepEqual(viewCenters, [1], 'search hit opens centered on the first matched seq')
  assert.equal(renderer.hasTest('sessions-detail'), true)
  assert.equal(renderer.hasTest('sessions-detail-return-search'), true, 'back-to-search button kept')
  assert.equal(renderer.hasTest('sessions-jump-view'), true)
  // 命中行高亮 + 定位 testid；上下文事件也渲染（不再只有孤立的 type · #seq 列表）。
  assert.equal(renderer.hasTest('sessions-jump-target-1'), true, 'matched event wrapped with the jump target testid')
  assert.equal(renderer.hasTest('sessions-jump-badge-1'), true, 'matched event shows the HIT badge')
  assert.equal(renderer.hasTest('sessions-event-1'), true, 'matched event still renders its full event card inside the wrapper')
  assert.equal(renderer.hasTest('sessions-event-2'), true, 'context event after the hit is rendered')
  assert.equal(renderer.hasTest('sessions-hit-event-1'), false, 'the old flat type · #seq list is gone')
  // 窗口里的噪音事件仍折叠（与普通详情一致）。
  assert.equal(renderer.hasTest('sessions-noisewall-0'), true, 'noise events inside the window stay collapsed')
  // 命中导航条：seq 芯片 + 上一个/下一个（单命中时两者都禁用）。
  assert.equal(renderer.hasTest('sessions-jump-chip-1'), true)
  assert.equal(renderer.findByTestId('sessions-jump-prev').props.disabled, true, 'no previous match at the first hit')
  assert.equal(renderer.findByTestId('sessions-jump-next').props.disabled, true, 'no next match with a single hit')
})

test('session manager hit window navigates between matches via card chips, prev/next, and navigator chips', async () => {
  const calls = []
  const centers = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint) => calls.push(endpoint),
    // 同会话 4 处命中（用户反馈里那类 #7 #8 #431 #533 的稀疏分布）。
    'sessions-search': () => ({ ok: true, value: { available: true, query: 'todo', scope: 'all', hits: [{ sessionId: 'session-cold', title: 'Cold session', items: [
      { seq: 7, type: 'user/message', snippet: 'a' },
      { seq: 8, type: 'user/message', snippet: 'b' },
      { seq: 431, type: 'assistant/message', snippet: 'c' },
      { seq: 533, type: 'assistant/message', snippet: 'd' },
    ] }] } }),
    'sessions-view': (payload) => {
      const center = payload && payload.center !== undefined ? payload.center : null
      centers.push(center)
      return { ok: true, value: { session: { id: 'session-cold' }, items: [
        { seq: center, type: 'user/message', time: 1000 + (center || 0), text: 'match at ' + center, noise: false },
      ], nextCursor: undefined, total: 600, centerSeq: center } }
    },
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  const searchInput = renderer.findByTestId('sessions-search-input')
  searchInput.props.onChange({ target: { value: 'todo' } })
  await renderer.flush()
  await renderer.advanceTimer(300)
  await renderer.flush()
  // 命中卡上 4 个 seq 芯片（多命中时显示）。
  assert.equal(renderer.hasTest('sessions-hit-seq-session-cold-7'), true)
  assert.equal(renderer.hasTest('sessions-hit-seq-session-cold-533'), true)
  // 点卡上芯片 #431：直接以该命中为中心打开窗口（不绕「打开→翻跳」）。
  await renderer.findByTestId('sessions-hit-seq-session-cold-431').props.onClick()
  await renderer.flush()
  assert.deepEqual(centers, [431], 'card seq chip jumps straight to that match')
  assert.equal(renderer.hasTest('sessions-jump-target-431'), true)
  // 上一个 → 8；再下一个 → 回到 431；最后到 533 时 next 禁用。
  await renderer.findByTestId('sessions-jump-prev').props.onClick()
  await renderer.flush()
  assert.deepEqual(centers, [431, 8], 'prev moves to the previous match')
  await renderer.findByTestId('sessions-jump-next').props.onClick()
  await renderer.flush()
  assert.deepEqual(centers, [431, 8, 431], 'next moves forward again')
  await renderer.findByTestId('sessions-jump-chip-533').props.onClick()
  await renderer.flush()
  assert.deepEqual(centers, [431, 8, 431, 533], 'navigator chip jumps to its match')
  assert.equal(renderer.findByTestId('sessions-jump-next').props.disabled, true, 'next disabled at the last match')
  assert.equal(renderer.findByTestId('sessions-jump-prev').props.disabled, false, 'prev enabled with earlier matches')
  // 返回搜索结果，点整卡 → 自动以首个命中（7）为中心。
  await renderer.findByTestId('sessions-detail-return-search').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-hit-seq-session-cold-7'), true, 'back on the search result cards')
  await renderer.findByTestId('sessions-hit-open-session-cold').props.onClick()
  await renderer.flush()
  assert.deepEqual(centers, [431, 8, 431, 533, 7], 'opening the card centers on the first match')
})

test('session manager delete is two-phase with consequences and rejects live sessions', async () => {
  const calls = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push(endpoint + (payload && payload.scope ? ':' + payload.scope : '')),
    'sessions-list': (payload) => {
      const scope = payload && payload.scope ? payload.scope : 'all'
      if (scope === 'archived') return { ok: true, value: { available: true, items: SESSION_LIST_VALUE.items.filter((item) => item.archived), archivedIds: SESSION_LIST_VALUE.archivedIds, deleted: [] } }
      if (scope === 'deleted') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: [...SESSION_LIST_VALUE.deleted, { id: 'session-archived', title: 'Archived one', cwd: '/workspace', deletedAt: 3000 }] } }
      return { ok: true, value: SESSION_LIST_VALUE }
    },
    'sessions-delete-plan': () => ({ ok: true, value: { planId: 'plan-1', session: { id: 'session-archived', title: 'Archived one', cwd: '/workspace', bytes: 1024, archived: true }, consequences: ['deletes-session-log'] } }),
    'sessions-delete': () => ({ ok: true, value: { deleted: true, id: 'session-archived' } }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // 全部视图：冷会话没有删除入口，归档会话可删除。
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-row-delete-session-cold'), false)
  await renderer.findByTestId('sessions-row-delete-session-archived').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-delete-modal'), true)
  assert.ok(calls.includes('sessions-delete-plan'))
  await renderer.findByTestId('sessions-delete-cancel').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-delete-modal'), false)
  // 再次发起 → 确认
  await renderer.findByTestId('sessions-row-delete-session-archived').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-delete-confirm').props.onClick()
  await renderer.flush()
  assert.ok(calls.includes('sessions-delete'))
  assert.equal(renderer.hasTest('sessions-delete-modal'), false)
  // v0.35 用户反馈：删除后本地更新，不重拉当前视图列表；行即时消失。
  const listCalls = calls.filter((name) => name.startsWith('sessions-list')).length
  assert.equal(renderer.hasTest('sessions-row-session-archived'), false, 'deleted archived row disappears from the list immediately')
  assert.equal(renderer.hasTest('sessions-delete-modal'), false)
  // 切已删除筛选：宿主 scope=deleted 返回已落盘的归档会话记录。
  await renderer.findByTestId('sessions-filter-deleted').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-row-session-archived'), true, 'deleted archived record appears under the deleted filter')
  assert.equal(calls.filter((name) => name.startsWith('sessions-list')).length, listCalls + 1, 'switching to deleted refetches only that scope')
})

test('session manager fills row sizes lazily and shows no dash placeholder beforehand', async () => {
  const calls = []
  let resolveBytes
  const bytesGate = new Promise((resolve) => { resolveBytes = resolve })
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push(endpoint + (payload && payload.scope ? ':' + payload.scope : '')),
    'sessions-bytes': async () => {
      // 体积响应被闸住：断言「在途无占位」后手动放行，再断言大小出现。
      await bytesGate
      return { ok: true, value: { bytes: { 'session-archived': 1024 } } }
    },
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // 列表已落地但体积仍在途：请求已发出，行内没有任何「—」占位，也没有体积。
  assert.ok(calls.includes('sessions-bytes'), 'bytes request issued lazily after the list lands')
  assert.ok(calls.includes('sessions-list:archived'), 'default view still requests the archived scope only')
  const meta = renderer.findByTestId('sessions-meta-session-archived')
  const metaText = Array.isArray(meta.children) ? meta.children.join('') : String(meta.children)
  assert.equal(metaText.includes('—'), false, 'no dash placeholder while size is pending')
  assert.equal(metaText.includes('KB'), false, 'size not shown until the bytes RPC resolves')
  // 放行体积响应 → 行内出现大小。
  resolveBytes()
  await renderer.flush()
  await renderer.flush()
  const metaAfter = renderer.findByTestId('sessions-meta-session-archived')
  const metaAfterText = Array.isArray(metaAfter.children) ? metaAfter.children.join('') : String(metaAfter.children)
  assert.ok(metaAfterText.includes('1.0 KB'), 'size appears after the lazy bytes RPC resolves')
})

test('session manager reuses loaded scope caches when switching filters, refresh forces refetch', async () => {
  const calls = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push(endpoint + (payload && payload.scope ? ':' + payload.scope : '')),
  }))

  const listCalls = () => calls.filter((name) => name.startsWith('sessions-list')).length
  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // 打开默认仅归档：只拉一次 archived。
  assert.equal(listCalls(), 1)
  assert.equal(calls.filter((name) => name === 'sessions-list:archived').length, 1)
  // 切「全部」：新 scope → 拉一次。
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 2)
  assert.equal(calls.filter((name) => name === 'sessions-list:all').length, 1)
  // 切回「仅归档」：缓存命中 → 零 RPC。
  await renderer.findByTestId('sessions-filter-archived').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 2, 'switching back to a loaded scope reuses the cache — no refetch')
  assert.equal(renderer.hasTest('sessions-row-session-archived'), true, 'cached archived rows still render')
  assert.equal(renderer.hasTest('sessions-row-session-cold'), false, 'archived view stays subset-scoped')
  // 再切「全部」：同样缓存命中，零 RPC。
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 2, 'switching to a loaded scope reuses the cache — no refetch')
  // 「刷新」按钮：强制重拉当前 scope（全部）。
  await renderer.findByTestId('sessions-refresh').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 3, 'refresh forces exactly one refetch of the current scope')
  assert.equal(calls.filter((name) => name === 'sessions-list:all').length, 2)
  // 新 scope（已删除）仍是按需首拉一次。
  await renderer.findByTestId('sessions-filter-deleted').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 4, 'deleted scope first use fetches once')
  assert.equal(renderer.hasTest('sessions-row-session-gone'), true)
  // 切回「全部」：all 缓存仍在 → 零 RPC。
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 4, 'already-loaded scope stays cached after visiting others')
})

test('session manager reuses module-level caches when the panel is closed and reopened', async () => {
  const calls = []
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push(endpoint + (payload && payload.scope ? ':' + payload.scope : '')),
  }))
  const listCalls = () => calls.filter((name) => name.startsWith('sessions-list')).length
  const bytesCalls = () => calls.filter((name) => name === 'sessions-bytes').length

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 1, 'first open fetches the archived scope once')
  assert.equal(bytesCalls(), 1, 'first open lazily fetches sizes once')
  // 切「全部」也缓存一份（体积对新行再取一次）。
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 2)
  assert.equal(bytesCalls(), 2)
  // 关闭面板（组件卸载）→ 再打开：缓存仍在 → 秒显；同时后台静默刷新当前 scope 一次。
  renderer.unmount('settings.section')
  await renderer.flush()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // v0.36 用户选定「秒显 + 后台静默刷新」：列表即显（下方断言行可见）但会发一次静默刷新。
  assert.equal(listCalls(), 3, 'reopening shows cached data instantly and refreshes quietly once')
  assert.equal(bytesCalls(), 2, 'reopening reuses cached sizes — no bytes refetch')
  assert.equal(renderer.hasTest('sessions-row-session-archived'), true, 'cached archived rows render immediately')
  // 已加载过的 scope 缓存重开后全部保留：切「全部」仍零请求。
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 3, 'all scope cache survives reopen')
  assert.equal(renderer.hasTest('sessions-row-session-cold'), true)
  assert.equal(renderer.hasTest('sessions-row-session-live'), true)
})

test('session manager shows cached data instantly on reopen, refreshes quietly in the background, and never overwrites a switched view', async () => {
  const calls = []
  let archivedReopenCalls = 0
  let resolveReopen
  let reopenGate
  const holdReopen = () => {
      reopenGate = new Promise((resolve) => { resolveReopen = resolve })
      return reopenGate
  }
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    onCall: (endpoint, payload) => calls.push(endpoint + (payload && payload.scope ? ':' + payload.scope : '')),
    'sessions-list': async (payload) => {
      const scope = payload && payload.scope ? payload.scope : 'all'
      if (scope === 'archived') {
        archivedReopenCalls += 1
        if (archivedReopenCalls === 1) return { ok: true, value: { available: true, items: SESSION_LIST_VALUE.items.filter((item) => item.archived), archivedIds: SESSION_LIST_VALUE.archivedIds, deleted: [] } }
        // 重开面板后的静默刷新返回「有变更」的数据：标题改了、归档区多了一个会话。
        await holdReopen()
        return {
          ok: true,
          value: {
            available: true,
            items: [
              { id: 'session-archived', title: 'Archived renamed', cwd: '/workspace', createdAt: 1000, live: false, persisted: true, archived: true },
              { id: 'session-new2', title: 'Brand new archived', cwd: '/workspace/x', createdAt: 900, live: false, persisted: true, archived: true },
            ],
            archivedIds: ['session-archived', 'session-new2'],
            deleted: [],
          },
        }
      }
      if (scope === 'deleted') return { ok: true, value: { available: true, items: [], archivedIds: [], deleted: SESSION_LIST_VALUE.deleted } }
      return { ok: true, value: SESSION_LIST_VALUE }
    },
  }))
  const listCalls = () => calls.filter((name) => name.startsWith('sessions-list')).length

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 1, 'first open fetches archived once')
  assert.equal(renderer.findByTestId('sessions-row-session-archived').children !== undefined, true)
  // 关闭再打开：无需等待，缓存立即可见（秒显），静默刷新请求已发出但被闸住。
  renderer.unmount('settings.section')
  await renderer.flush()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 2, 'background silent refresh issued on reopen')
  assert.equal(renderer.hasTest('sessions-row-session-archived'), true, 'cached row is visible instantly while refresh is in flight')
  // 刷新在途时用户切到「全部」：该 scope 从未加载过 → 首拉一次（正常行为）。
  await renderer.findByTestId('sessions-filter-all').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 3, 'switching to all during in-flight refresh fetches the never-loaded scope once')
  assert.equal(renderer.hasTest('sessions-row-session-live'), true)
  // 释放静默刷新响应：视图已切走 → 不覆盖当前「全部」视图。
  resolveReopen()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-row-session-live'), true, 'switched view is not overwritten by a stale archived response')
  assert.equal(renderer.hasTest('sessions-row-session-archived'), true, 'archived row stays visible in the all view as before')
  // 切回「仅归档」：缓存已被静默刷新原地更新 → 零请求、看到新数据（改名 + 新增会话）。
  await renderer.findByTestId('sessions-filter-archived').props.onClick()
  await renderer.flush()
  assert.equal(listCalls(), 3, 'returning to archived reuses the refreshed cache — no refetch')
  assert.equal(renderer.hasTest('sessions-row-session-new2'), true, 'silently refreshed cache contains the new session')
})

test('session manager detail falls back to plain text when the shell lacks the markdown seed', async () => {
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold' }, items: [{ seq: 0, type: 'user/message', time: 2001, text: '**bold** and `code`', noise: false }], nextCursor: undefined, total: 1 } }),
  }), { noUiPrimitives: true })

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()
  // 老外壳（seed 无 ui-primitives）：官方渲染器不可用 → 回落 pre-wrap 纯文本，原文按字面显示。
  assert.equal(renderer.hasTest('md-markdown'), false, 'no official renderer on legacy shells')
  assert.equal(renderer.hasTest('sessions-event-text-0'), true, 'plain-text fallback container present')
  const fallback = renderer.findByTestId('sessions-event-text-0').children[0]
  assert.ok(fallback !== undefined && fallback.type === 'div')
  assert.equal(fallback.children[0], '**bold** and `code`', 'markdown source shown literally when the official renderer is unavailable')
})

test('session manager unwraps a namespace-wrapped official MarkdownText (ESM interop shell)', async () => {
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold' }, items: [{ seq: 0, type: 'user/message', time: 2001, text: 'hello **world**', noise: false }], nextCursor: undefined, total: 1 } }),
  }), { nestedMarkdown: true })

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()
  // v0.36 真实 shell 复现：MarkdownText 是 {default: fn} 命名空间对象——必须解包才渲染。
  assert.equal(renderer.hasTest('sessions-event-text-0'), true, 'event body container present')
  const inner = renderer.findByTestId('sessions-event-text-0').children[0]
  assert.ok(inner !== undefined && inner.type === 'div' && inner.props['data-testid'] === 'md-markdown', 'namespace-wrapped MarkdownText unwrapped and rendered')
  assert.equal(inner.children[0], 'hello **world**', 'text flows through the unwrapped renderer')
})

test('session manager accepts the memo-wrapped official MarkdownText (real shell shape) instead of falling back', async () => {
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold' }, items: [{ seq: 0, type: 'user/message', time: 2001, text: 'hello **world**', noise: false }], nextCursor: undefined, total: 1 } }),
  }), { memoMarkdown: true })

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()
  // v0.36 真实 shell 形态：MarkdownText = React.memo 返回对象（$$typeof/type/compare）。
  // 它是合法组件类型——探测必须直通交给 createElement，而不是回落纯文本。
  assert.equal(renderer.hasTest('sessions-event-text-0'), true, 'event body container present')
  const inner = renderer.findByTestId('sessions-event-text-0').children[0]
  assert.ok(inner !== undefined && inner.type !== undefined && inner.type.$$typeof === Symbol.for('react.memo'),
      'memo-wrapped MarkdownText accepted as a renderable component (not falling back)')
  assert.equal(inner.props && inner.props.text, 'hello **world**', 'text flows to the memo-wrapped renderer')
})

test('session manager detail survives a fenced code block in event text: MarkdownText receives labels (v1.4.2 regression, DSH 0.1.2-alpha.4)', async () => {
  // 回归：alpha.4 外壳的 MarkdownText 渲染代码块时无条件读 labels.code.copyLabel/copiedLabel；
  // 旧实现只传 { text } → 事件文本含 ``` 栅栏时整节崩溃（「查看点开后空白」根因）。
  // 替身已在 seed 层复现该崩溃语义；断言插件调用始终携带 labels。
  const renderer = sessionManagerRenderer(createSessionRpcMock({
    'sessions-list': () => ({ ok: true, value: SESSION_LIST_VALUE }),
    'sessions-view': () => ({ ok: true, value: { session: { id: 'session-cold', title: 'Cold session' }, items: [
      { seq: 0, type: 'user/message', time: 2001, text: '模板：\n```\n# 标题\n```\n结束', noise: false },
    ], nextCursor: undefined, total: 1 } }),
  }))

  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.findButton('维护').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('maintenance-tab-sessions').props.onClick()
  await renderer.flush()
  // alpha.4 真机复现：点「查看」渲染含代码栅栏的事件 → 不再抛 TypeError、整节不空白。
  await renderer.findByTestId('sessions-row-view-session-cold').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('sessions-detail'), true, 'detail still renders (no section crash)')
  const mdText = renderer.findByTestId('sessions-event-text-0').children[0]
  assert.ok(mdText !== undefined && mdText.type === 'div' && mdText.props['data-testid'] === 'md-markdown', 'MarkdownText rendered the fenced body')
  const copyLabel = mdText.props['data-labels-code-copy']
  assert.ok(typeof copyLabel === 'string' && copyLabel !== '', 'labels.code.copyLabel was passed to MarkdownText')
})

// ── 官方右栏文件编辑（v1.6 用户点名）：渲染器档位注册 + 编辑正文交互 ──────────────
// 槽主（官方文档预览）在真实运行里注入 owner props（resourceAddress/content/wrap），
// 测试用 mountOnly + slotProps 提供同一形态；documentPreviews 走 options.services 的替身。
function createFileEditorRenderer(rpcCall, options = {}) {
  const documentRegistrations = []
  const documentPreviews = {
    register(definition) {
      documentRegistrations.push(definition)
      return () => {
        const index = documentRegistrations.indexOf(definition)
        if (index >= 0) documentRegistrations.splice(index, 1)
      }
    },
  }
  const renderer = createRenderer(rpcCall, Object.assign({
    services: { documentPreviews },
    mountOnly: ['sidebar.right.tab.document'],
  }, options))
  return { renderer, documentRegistrations }
}

const FILE_EDITOR_ADDRESS = 'dsh-resource://file/session/session-1/note.md'

test('right-Sidebar editor registers a builtin-band renderer that never claims the default slot', async () => {
  const { renderer, documentRegistrations } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    assert.deepEqual(payload, { address: FILE_EDITOR_ADDRESS })
    assert.equal(endpoint, 'file-read')
    return { ok: true, value: { text: 'hello\n', version: 'v1', path: '/ws/note.md', bytes: 6 } }
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'hello\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()

  assert.equal(documentRegistrations.length, 1)
  const definition = documentRegistrations[0]
  assert.equal(definition.id, '@gehennawu/dsh-service/editor')
  // builtin 档 = 官方渲染器仍是各后缀默认：编辑器只出现在下拉里，不夺默认位。
  assert.equal(definition.priority, 'builtin')
  assert.equal(definition.loading, 'text-pages')
  assert.equal(definition.wrap, true)
  assert.ok(Array.isArray(definition.extensions))
  for (const extension of ['md', 'json', 'ts', 'py', 'sh', 'txt']) assert.ok(definition.extensions.includes(extension), extension)
  assert.equal(definition.title(), '编辑')
  // body 与元数据同 id（keyed 槽按 key 取件），槽名是官方文档正文槽。
  const entries = renderer.registrations()['sidebar.right.tab.document']
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, '@gehennawu/dsh-service/editor')
  assert.equal(entries[0].locale, 'dsh-service')

  renderer.setLocale('en')
  assert.equal(definition.title(), 'Edit')
})

test('right-Sidebar editor stays out of the way without the preview service or with the feature off', async () => {
  // 官方预览未挂载（旧宿主形态）：元数据与 body 都不注册，也不抛错。
  const withoutService = createRenderer(async () => ({ ok: true, value: {} }), { mountOnly: [] })
  await withoutService.load()
  await withoutService.flush()
  assert.equal(withoutService.registrations()['sidebar.right.tab.document'], undefined)

  // 开关关闭：注册整体卸载；重新打开即恢复（热生效）。
  const { renderer, documentRegistrations } = createFileEditorRenderer(async () => ({ ok: true, value: {} }), {
    featureSettings: { fileEditor: false },
  })
  await renderer.load()
  await renderer.flush()
  assert.equal(documentRegistrations.length, 0)
  assert.equal(renderer.registrations()['sidebar.right.tab.document'], undefined)

  await renderer.setFeature('fileEditor', true)
  assert.equal(documentRegistrations.length, 1)
  assert.equal(renderer.registrations()['sidebar.right.tab.document'].length, 1)

  await renderer.setFeature('fileEditor', false)
  assert.equal(documentRegistrations.length, 0)
  assert.equal(renderer.registrations()['sidebar.right.tab.document'].length, 0)
})

test('right-Sidebar editor loads through its own RPC, tracks dirtiness, saves with the read version, and undoes', async () => {
  const calls = []
  const { renderer } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    // 插件级进程身份基线也会在连接建立时取一次 version：它不属于本编辑器用例，
    // 不计入 calls（calls[0] 仍断言「编辑器的首个 RPC 是 file-read」）。
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    calls.push({ endpoint, payload })
    if (endpoint === 'file-read') return { ok: true, value: { text: 'hello\n', version: 'v1', path: '/ws/note.md', bytes: 6 } }
    if (endpoint === 'file-write') return { ok: true, value: { version: 'v2', operation: 'update', bytes: 12, before: 'hello\n', path: '/ws/note.md' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'hello\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  assert.deepEqual(calls[0], { endpoint: 'file-read', payload: { address: FILE_EDITOR_ADDRESS } })
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'hello\n')
  assert.equal(renderer.findByTestId('file-editor-save').props.disabled, true)
  assert.equal(renderer.hasTest('file-editor-status'), false)
  assert.equal(renderer.hasTest('file-editor-undo'), false)

  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'hello world\n' } })
  await renderer.flush()
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'hello world\n')
  assert.match(renderer.text('sidebar.right.tab.document'), /未保存/)
  assert.equal(renderer.findByTestId('file-editor-save').props.disabled, false)

  // Ctrl/Cmd+S 与保存按钮同一条路径。
  renderer.findByTestId('file-editor-textarea').props.onKeyDown({ key: 's', ctrlKey: true, preventDefault() {} })
  await renderer.flush()
  const write = calls.find((call) => call.endpoint === 'file-write')
  assert.deepEqual(write.payload, { address: FILE_EDITOR_ADDRESS, text: 'hello world\n', version: 'v1', force: false })
  assert.match(renderer.text('sidebar.right.tab.document'), /已保存/)
  assert.equal(renderer.findByTestId('file-editor-save').props.disabled, true)
  // 保存后「撤销保存」可用（未脏）：点它先出确认面板，主操作把 before 写回去。
  const undoButton = renderer.findByTestId('file-editor-undo')
  assert.equal(undoButton.props.disabled, false)
  undoButton.props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-confirm'), true)
  renderer.findByTestId('file-editor-confirm-save').props.onClick()
  await renderer.flush()
  const undoWrite = calls.filter((call) => call.endpoint === 'file-write')[1]
  assert.deepEqual(undoWrite.payload, { address: FILE_EDITOR_ADDRESS, text: 'hello\n', version: 'v2', force: false })
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'hello\n')
  // 撤销不再挂新的撤销项：不做「撤销的撤销」。
  assert.equal(renderer.hasTest('file-editor-undo'), false)
})

test('right-Sidebar editor turns a stale save into a conflict banner with reload and overwrite exits', async () => {
  const calls = []
  let stale = true
  const { renderer } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    calls.push({ endpoint, payload })
    if (endpoint === 'file-read') return { ok: true, value: { text: 'hello\n', version: 'v1', path: '/ws/note.md', bytes: 6 } }
    if (endpoint === 'file-write') {
      if (stale && payload.force !== true) return { ok: false, error: 'file-stale' }
      return { ok: true, value: { version: 'v3', operation: 'update', bytes: 6, before: 'reloaded\n', path: '/ws/note.md' } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'hello\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'mine\n' } })
  await renderer.flush()
  renderer.findByTestId('file-editor-save').props.onClick()
  await renderer.flush()

  // stale 不进顶部错误行，而是进冲突横幅（待用户裁决的状态）。
  assert.equal(renderer.hasTest('file-editor-notice'), false)
  assert.match(renderer.text('sidebar.right.tab.document'), /磁盘内容已变化，保存被拒绝/)
  assert.match(renderer.text('sidebar.right.tab.document'), /重新加载（丢弃修改）.*用我的内容覆盖/)

  // 覆盖：force=true 无条件写。
  stale = false
  renderer.findByTestId('file-editor-conflict-overwrite').props.onClick()
  await renderer.flush()
  const overwrite = calls.filter((call) => call.endpoint === 'file-write')[1]
  assert.equal(overwrite.payload.force, true)
  assert.equal(overwrite.payload.text, 'mine\n')
  assert.equal(renderer.hasTest('file-editor-conflict'), false)

  // 重新加载：重新走 file-read 并丢弃草稿。
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'again\n' } })
  await renderer.flush()
  stale = true
  renderer.findByTestId('file-editor-save').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-conflict'), true)
  const readsBefore = calls.filter((call) => call.endpoint === 'file-read').length
  renderer.findByTestId('file-editor-conflict-reload').props.onClick()
  await renderer.flush()
  assert.equal(calls.filter((call) => call.endpoint === 'file-read').length, readsBefore + 1)
  assert.equal(renderer.hasTest('file-editor-conflict'), false)
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'hello\n')
  assert.equal(renderer.findByTestId('file-editor-save').props.disabled, true)
})

test('right-Sidebar editor keeps newer typing alive while a save is in flight', async () => {
  const calls = []
  let releaseWrite
  const writeGate = new Promise((resolve) => { releaseWrite = resolve })
  const { renderer } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'file-read') return { ok: true, value: { text: 'base\n', version: 'v1', path: '/ws/note.md', bytes: 5 } }
    if (endpoint === 'file-write') {
      await writeGate
      return { ok: true, value: { version: 'v2', operation: 'update', bytes: payload.text.length, before: 'base\n', path: '/ws/note.md' } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'base\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'base\nA\n' } })
  await renderer.flush()
  renderer.findByTestId('file-editor-save').props.onClick()
  // 保存在途：状态「保存中」，期间继续输入 B。
  await renderer.flush()
  assert.match(renderer.text('sidebar.right.tab.document'), /保存中/)
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'base\nA\nB\n' } })
  await renderer.flush()
  releaseWrite()
  await renderer.flush()

  // 响应只确认提交的 A；B 原样保留为未保存，绝不误报「已保存」。
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'base\nA\nB\n')
  assert.match(renderer.text('sidebar.right.tab.document'), /未保存/)
  assert.doesNotMatch(renderer.text('sidebar.right.tab.document'), /已保存/)
  const save = calls.filter((call) => call.endpoint === 'file-write')[0]
  assert.equal(save.payload.text, 'base\nA\n')

  // 再次保存把最新草稿落盘；在途期间重入被忽略（不产生第二份并发写）。
  assert.equal(renderer.findByTestId('file-editor-save').props.disabled, false)
  renderer.findByTestId('file-editor-save').props.onClick()
  renderer.findByTestId('file-editor-save').props.onClick()
  const writes = calls.filter((call) => call.endpoint === 'file-write')
  assert.equal(writes.length, 2)
  assert.equal(writes[1].payload.text, 'base\nA\nB\n')
  releaseWrite?.()
  await renderer.flush()
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'base\nA\nB\n')
})

test('right-Sidebar editor overwrite after a conflict submits the latest draft, not the rejected snapshot', async () => {
  const calls = []
  let stale = true
  const { renderer } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'file-read') return { ok: true, value: { text: 'base\n', version: 'v1', path: '/ws/note.md', bytes: 5 } }
    if (endpoint === 'file-write') {
      if (stale === true && payload.force !== true) return { ok: false, error: 'file-stale' }
      return { ok: true, value: { version: 'v9', operation: 'update', bytes: payload.text.length, before: 'disk\n', path: '/ws/note.md' } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'base\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'rejected draft\n' } })
  await renderer.flush()
  renderer.findByTestId('file-editor-save').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-conflict'), true)

  // 冲突出现后继续修改：覆盖必须用编辑器当前内容，而不是被拒绝时的快照。
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'rejected draft\n+ later tweak\n' } })
  await renderer.flush()
  renderer.findByTestId('file-editor-conflict-overwrite').props.onClick()
  await renderer.flush()
  const overwrite = calls.filter((call) => call.endpoint === 'file-write')[1]
  assert.equal(overwrite.payload.force, true)
  assert.equal(overwrite.payload.text, 'rejected draft\n+ later tweak\n')
  assert.equal(renderer.hasTest('file-editor-conflict'), false)
})

test('right-Sidebar editor undo asks for confirmation, can be cancelled, and reports a stale undo without force', async () => {
  const calls = []
  let staleNextSave = false
  let staleNextUndo = false
  const { renderer } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'file-read') return { ok: true, value: { text: 'base\n', version: 'v1', path: '/ws/note.md', bytes: 5 } }
    if (endpoint === 'file-write') {
      const isUndo = payload.text === 'base\n'
      if (payload.force !== true && ((isUndo === true && staleNextUndo === true) || (isUndo !== true && staleNextSave === true))) {
        return { ok: false, error: 'file-stale' }
      }
      // 撤销（写回 base）产出 v3；普通保存产出 v2。
      return { ok: true, value: { version: isUndo === true ? 'v3' : 'v2', operation: 'update', bytes: payload.text.length, before: isUndo === true ? 'edited\n' : 'base\n', path: '/ws/note.md' } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'base\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'edited\n' } })
  await renderer.flush()
  renderer.findByTestId('file-editor-save').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('sidebar.right.tab.document'), /已保存/)

  // 确认面板：取消回到编辑（内容不变），也不发任何写请求。
  renderer.findByTestId('file-editor-undo').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-confirm'), true)
  const writesBefore = calls.filter((call) => call.endpoint === 'file-write').length
  renderer.findByTestId('file-editor-confirm-cancel').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-confirm'), false)
  assert.equal(calls.filter((call) => call.endpoint === 'file-write').length, writesBefore)
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'edited\n')

  // 确认后撤销：带版本守卫把 before 写回，撤销项消失（不做撤销的撤销）。
  renderer.findByTestId('file-editor-undo').props.onClick()
  await renderer.flush()
  renderer.findByTestId('file-editor-confirm-save').props.onClick()
  await renderer.flush()
  const undoWrite = calls.filter((call) => call.endpoint === 'file-write')[1]
  assert.deepEqual(undoWrite.payload, { address: FILE_EDITOR_ADDRESS, text: 'base\n', version: 'v2', force: false })
  assert.equal(renderer.hasTest('file-editor-undo'), false)

  // 第二次保存成功后再撤销，且撤销时磁盘已再变化（file-stale）：绝无 force 覆盖出口，
  // 只给重新加载与关闭——撤销不能把更老的回滚内容无条件压过磁盘新改动。
  staleNextUndo = true
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'second edit\n' } })
  await renderer.flush()
  renderer.findByTestId('file-editor-save').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-conflict'), false)
  assert.equal(renderer.hasTest('file-editor-undo'), true)
  renderer.findByTestId('file-editor-undo').props.onClick()
  await renderer.flush()
  renderer.findByTestId('file-editor-confirm-save').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-undo-conflict'), true)
  assert.equal(renderer.hasTest('file-editor-conflict-overwrite'), false)
  renderer.findByTestId('file-editor-undo-conflict-dismiss').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-undo-conflict'), false)
})

test('right-Sidebar editor confirms before leaving with unsaved changes and can save-and-back', async () => {
  const calls = []
  const { renderer } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'file-read') return { ok: true, value: { text: 'base\n', version: 'v1', path: '/ws/note.md', bytes: 5 } }
    return { ok: true, value: { version: 'v2', operation: 'update', bytes: payload.text.length, before: 'base\n', path: '/ws/note.md' } }
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'base\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  // 未保存时点「预览」：先出确认面板，取消后编辑器仍在、草稿保留。
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'draft\n' } })
  await renderer.flush()
  assert.equal(renderer.findByTestId('file-editor-preview').props.disabled, false)
  renderer.findByTestId('file-editor-preview').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-confirm'), true)
  renderer.findByTestId('file-editor-confirm-cancel').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-confirm'), false)
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'draft\n')

  // 保存并返回：提交当前草稿（菜单切换在桩环境不可观察，只验证写盘与面板收起）。
  renderer.findByTestId('file-editor-preview').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-confirm'), true)
  renderer.findByTestId('file-editor-confirm-save').props.onClick()
  await renderer.flush()
  const save = calls.filter((call) => call.endpoint === 'file-write')[0]
  assert.equal(save.payload.text, 'draft\n')
  assert.equal(save.payload.version, 'v1')
  assert.equal(renderer.hasTest('file-editor-confirm'), false)
  // 编辑器仍在（桩环境无法切官方档位），内容已保存。
  assert.match(renderer.text('sidebar.right.tab.document'), /已保存/)

  // 保存完成后再点「预览」：内容与基线一致，直接尝试切换、不弹确认。
  const confirmsBefore = renderer.hasTest('file-editor-confirm')
  renderer.findByTestId('file-editor-preview').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-confirm'), confirmsBefore)
})

test('right-Sidebar editor header entries target their own pane menu and ambiguous menus never fire', async () => {
  const makeNode = (text) => ({
    textContent: text,
    removed: false,
    clicks: 0,
    attrs: {},
    listeners: {},
    style: {},
    setAttribute(name, value) { this.attrs[name] = value },
    addEventListener(type, listener) { this.listeners[type] = listener },
    click() { this.clicks += 1 },
    remove() { this.removed = true },
  })
  // 双 pane：两个 pane 各有下拉钮与自己的 pane 容器（querySelector 只返回自己的钮）。
  const itemsPane1 = ['Markdown', '编辑'].map(makeNode)
  const itemsPane2 = ['Markdown', '编辑'].map(makeNode)
  const menuPane1 = makeNode('Markdown')
  const menuPane2 = makeNode('Markdown')
  const pane1 = { injected: [], insertBefore(node, reference) { this.injected.push(node); node.parentNode = this }, querySelector: (selector) => (selector === '[data-document-viewer-menu]' ? menuPane1 : null) }
  const pane2 = { injected: [], insertBefore(node, reference) { this.injected.push(node); node.parentNode = this }, querySelector: (selector) => (selector === '[data-document-viewer-menu]' ? menuPane2 : null) }
  menuPane1.parentNode = pane1
  menuPane2.parentNode = pane2
  const doc = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === '[data-document-viewer-menu]') return [menuPane1, menuPane2]
      return []
    },
    createElement: () => makeNode(''),
  }
  const previousDocument = globalThis.document
  const previousObserver = globalThis.MutationObserver
  globalThis.document = doc
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  try {
    const { renderer } = createFileEditorRenderer(async () => ({ ok: true, value: {} }), { mountOnly: [] })
    await renderer.load()
    await renderer.flush()
    // 每个 pane 头部各注入一个按钮。
    const buttons = [...pane1.injected, ...pane2.injected]
    assert.equal(buttons.length, 2)

    // 双 pane 下没有「就地命中」：点 pane2 的按钮只能开 pane2 自己的下拉。
    void itemsPane1
    void itemsPane2
    buttons[1].listeners.click({ preventDefault() {}, stopPropagation() {} })
    assert.equal(menuPane2.clicks, 1)
    assert.equal(menuPane1.clicks, 0)

    // 功能关闭卸载按钮，未决重试一并作废（守卫取消）。
    await renderer.setFeature('fileEditor', false)
    assert.equal(buttons.every((node) => node.removed === true), true)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousObserver === undefined) delete globalThis.MutationObserver
    else globalThis.MutationObserver = previousObserver
  }
})

test('right-Sidebar editor survives unrelated feature toggles without dropping the draft', async () => {
  const { renderer } = createFileEditorRenderer(async (channel, endpoint) => {
    if (endpoint === 'file-read') return { ok: true, value: { text: 'base\n', version: 'v1', path: '/ws/note.md', bytes: 5 } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'base\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'draft kept\n' } })
  await renderer.flush()
  // 无关功能开关更新：编辑器正文不得卸载重挂，草稿原地保留。
  await renderer.setFeature('mobileAdaptation', true)
  await renderer.flush()
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'draft kept\n')
  // fileEditor 自身关闭才真正卸载。
  await renderer.setFeature('fileEditor', false)
  await renderer.flush()
  assert.equal(renderer.hasTest('file-editor-textarea'), false)
})

test('right-Sidebar editor renders each failure code through its dictionary entry and retries', async () => {
  const calls = []
  let failure = 'session-not-live'
  const { renderer } = createFileEditorRenderer(async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    calls.push({ endpoint, payload })
    if (endpoint === 'file-read') {
      if (failure !== '') return { ok: false, error: failure }
      return { ok: true, value: { text: 'ready\n', version: 'v1', path: '/ws/note.md', bytes: 6 } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, {
    slotProps: { 'sidebar.right.tab.document': { resourceAddress: FILE_EDITOR_ADDRESS, content: { kind: 'text', text: 'hello\n', pages: [], eof: true }, wrap: true } },
  })

  await renderer.load()
  await renderer.flush()
  assert.match(renderer.text('sidebar.right.tab.document'), /该会话当前未激活，无法编辑/)
  assert.equal(renderer.hasTest('file-editor-textarea'), false)

  // 未知错误码走通用文案，绝不把词典 key 漏到界面上。
  failure = 'weird-code'
  renderer.findByTestId('file-editor-retry').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('sidebar.right.tab.document'), /操作失败，请重试。/)
  assert.doesNotMatch(renderer.text('sidebar.right.tab.document'), /editor\.error\./)

  failure = ''
  renderer.findByTestId('file-editor-retry').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('file-editor-textarea').props.value, 'ready\n')

  // 英文词典同步（标题 + 提示行 + 状态芯片）。
  renderer.setLocale('en')
  renderer.findByTestId('file-editor-textarea').props.onChange({ target: { value: 'changed\n' } })
  await renderer.flush()
  assert.match(renderer.text('sidebar.right.tab.document'), /Unsaved/)
  assert.match(renderer.text('sidebar.right.tab.document'), /Ctrl\/Cmd \+ S to save/)
  assert.equal(renderer.findByTestId('file-editor-save').children[0], 'Save')
})

test('right-Sidebar editor injects a header entry button that selects its renderer tier, and retracts it in edit mode', async () => {
  // 官方预览头部 DOM 桩：一个渲染器下拉钮（文案 = 当前档位）+ 四个菜单项（与真机一致）。
  const makeNode = (text) => ({
    textContent: text,
    removed: false,
    clicks: 0,
    attrs: {},
    listeners: {},
    style: {},
    setAttribute(name, value) { this.attrs[name] = value },
    addEventListener(type, listener) { this.listeners[type] = listener },
    click() { this.clicks += 1 },
    remove() { this.removed = true },
  })
  const items = ['Markdown', '代码', '编辑', '纯文本'].map(makeNode)
  const menu = makeNode('Markdown')
  const parent = {
    injected: [],
    insertBefore(node, reference) { this.injected.push({ node, reference }); node.parentNode = this; this.reference = reference },
    // pane 容器：findViewerMenuForNode 沿祖先就近定位自己 pane 的下拉钮。
    querySelector(selector) { return selector === '[data-document-viewer-menu]' ? menu : null },
  }
  menu.parentNode = parent
  const injectedButtons = () => parent.injected.map((entry) => entry.node)
  const doc = {
    documentElement: {},
    querySelector(selector) { return selector === '[data-document-viewer-menu]' ? menu : null },
    querySelectorAll(selector) {
      if (selector === '[data-document-viewer-menu]') return [menu]
      if (selector === '[role="menuitem"], [role="option"]') return items
      if (selector === '[data-dshsvc-editor-entry]') return injectedButtons().filter((node) => node.removed !== true)
      return []
    },
    createElement: () => makeNode(''),
  }
  const observers = []
  class FakeMutationObserver {
    constructor(callback) { observers.push(callback) }
    observe() {}
    disconnect() {}
  }
  const previousDocument = globalThis.document
  const previousObserver = globalThis.MutationObserver
  globalThis.document = doc
  globalThis.MutationObserver = FakeMutationObserver
  try {
    const { renderer } = createFileEditorRenderer(async () => ({ ok: true, value: {} }), { mountOnly: [] })
    await renderer.load()
    await renderer.flush()

    // 1) 头部右上角注入按钮：插在渲染器下拉之前，文案与无障碍名都取当前语言。
    assert.equal(parent.injected.length, 1)
    const button = parent.injected[0].node
    assert.equal(parent.injected[0].reference, menu)
    assert.equal(button.textContent, '编辑')
    assert.equal(button.attrs['data-dshsvc-editor-entry'], '')
    assert.equal(button.attrs['aria-label'], '编辑')

    // 2) 点击 = 在下拉里选中「编辑」档位（菜单已渲染时不再多点一次下拉钮）。
    button.listeners.click({ preventDefault() {}, stopPropagation() {} })
    assert.equal(items[2].clicks, 1)
    assert.equal(menu.clicks, 0)

    // 3) 档位已是「编辑」：按钮收起（返回入口由编辑正文自己的「预览」承担）。
    menu.textContent = '编辑'
    // 替身里同时存在多个观察者（设置页导航标记等），逐个触发保证本引擎的那次一定跑到。
    for (const callback of observers) callback()
    await renderer.flush()
    assert.equal(injectedButtons().filter((node) => node.removed !== true).length, 0)

    // 4) 切回官方档位 + DOM 变化（观察者回调）→ 按钮回来一次。
    menu.textContent = '纯文本'
    for (const callback of observers) callback()
    await renderer.flush()
    assert.equal(injectedButtons().filter((node) => node.removed !== true).length, 1)

    // 5) 功能关闭：整块卸载，按钮一并回收。
    const live = injectedButtons().find((node) => node.removed !== true)
    await renderer.setFeature('fileEditor', false)
    assert.equal(live.removed, true)
    assert.equal(injectedButtons().filter((node) => node.removed !== true).length, 0)

    // 6) 没有下拉钮（不是官方预览）时选档位是安全的空操作。
    const { selectViewerItem, id, extensions, attr } = renderer.moduleExports().fileEditor
    assert.equal(id, '@gehennawu/dsh-service/editor')
    assert.equal(attr, 'data-dshsvc-editor-entry')
    assert.ok(extensions.includes('md'))
    // 新契约：menu 必须由调用方显式给出（所属 pane 的下拉钮），缺失一律安全失败。
    assert.equal(selectViewerItem(doc, () => true, { menu }), true)
    assert.equal(selectViewerItem(doc, () => true), false)
    assert.equal(selectViewerItem(null, () => true, { menu }), false)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousObserver === undefined) delete globalThis.MutationObserver
    else globalThis.MutationObserver = previousObserver
  }
})

test('right-Sidebar editor header entry follows the active language', async () => {
  const makeNode = (text) => ({
    textContent: text,
    removed: false,
    attrs: {},
    listeners: {},
    style: {},
    setAttribute(name, value) { this.attrs[name] = value },
    addEventListener(type, listener) { this.listeners[type] = listener },
    click() {},
    remove() { this.removed = true },
  })
  const menu = makeNode('Markdown')
  const parent = { injected: [], insertBefore(node) { this.injected.push(node) } }
  menu.parentNode = parent
  const doc = {
    documentElement: {},
    querySelector: () => menu,
    querySelectorAll: (selector) => (selector === '[data-document-viewer-menu]' ? [menu] : []),
    createElement: () => makeNode(''),
  }
  const previousDocument = globalThis.document
  const previousObserver = globalThis.MutationObserver
  globalThis.document = doc
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  try {
    const { renderer } = createFileEditorRenderer(async () => ({ ok: true, value: {} }), { mountOnly: [] })
    await renderer.load()
    await renderer.flush()
    assert.equal(parent.injected[0].textContent, '编辑')
    renderer.setLocale('en')
    assert.equal(parent.injected.filter((node) => node.removed !== true)[0].textContent, 'Edit')
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousObserver === undefined) delete globalThis.MutationObserver
    else globalThis.MutationObserver = previousObserver
  }
})

test('right-Sidebar editor retries an asynchronously mounted viewer menu instead of giving up', async () => {
  // 官方 Menu 走 portal 异步挂载：点开下拉钮的同一次同步查找必然落空，必须靠有界重试补上
  // （真机首次实现漏了这一步：点头部「编辑」毫无反应）。
  const timers = []
  const realSetTimeout = globalThis.setTimeout
  globalThis.setTimeout = (callback) => { timers.push(callback); return 0 }
  const menu = { textContent: 'Markdown', parentNode: { insertBefore() {} }, attrs: {}, style: {}, setAttribute() {}, addEventListener() {}, click() {}, remove() {} }
  const items = []
  const doc = {
    documentElement: {},
    querySelector: (selector) => (selector === '[data-document-viewer-menu]' ? menu : null),
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitem"], [role="option"]') return items
      if (selector === '[data-document-viewer-menu]') return [menu]
      return []
    },
    createElement: () => ({ textContent: '', attrs: {}, style: {}, setAttribute() {}, addEventListener() {}, click() {}, remove() {} }),
  }
  const previousDocument = globalThis.document
  const previousObserver = globalThis.MutationObserver
  globalThis.document = doc
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  try {
    const { renderer } = createFileEditorRenderer(async () => ({ ok: true, value: {} }), { mountOnly: [] })
    await renderer.load()
    await renderer.flush()
    const { selectViewerItem } = renderer.moduleExports().fileEditor

    // 菜单还没挂载：同步返回 false，并排下一次重试（不把下拉钮来回开合）。
    assert.equal(selectViewerItem(doc, (text) => text === '编辑', { menu }), false)
    assert.equal(timers.length, 1)
    let clicks = 0
    items.push({ textContent: '编辑', click() { clicks += 1 } })
    timers.shift()()
    assert.equal(clicks, 1)

    // 菜单已开时直接就地点中，不再排定时器。
    const before = timers.length
    assert.equal(selectViewerItem(doc, (text) => text === '编辑', { menu }), true)
    assert.equal(timers.length, before)
    assert.equal(clicks, 2)

    // 活性守卫：入口引擎销毁后，未决的重试定时器不再点击任何菜单项。
    assert.equal(selectViewerItem(doc, (text) => text === '编辑', { menu, isAlive: () => false }), false)
    assert.equal(timers.length, before)
  } finally {
    globalThis.setTimeout = realSetTimeout
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousObserver === undefined) delete globalThis.MutationObserver
    else globalThis.MutationObserver = previousObserver
  }
})

test('right-Sidebar editor also offers an official tab-menu entry that never matches itself', async () => {
  // 头部按钮靠注入 DOM；这条是官方 ⋯ 菜单座（零 DOM），互为冗余。官方菜单项同样是
  // [role=menuitem]，所以「选档位」必须能排除本插件自己的条目（否则自我递归）。
  const makeNode = (text, attrs = {}) => ({
    textContent: text,
    attrs,
    style: {},
    removed: false,
    clicks: 0,
    setAttribute(name, value) { this.attrs[name] = value },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null },
    addEventListener() {},
    click() { this.clicks += 1 },
    remove() { this.removed = true },
  })
  const viewerItem = makeNode('编辑')
  const ownMenuItem = makeNode('编辑', { 'data-dshsvc-editor-menu-item': '' })
  const viewerMenu = makeNode('Markdown')
  viewerMenu.parentNode = { insertBefore() {} }
  const doc = {
    documentElement: {},
    querySelector: (selector) => (selector === '[data-document-viewer-menu]' ? viewerMenu : null),
    querySelectorAll: (selector) => {
      if (selector === '[role="menuitem"], [role="option"]') return [ownMenuItem, viewerItem]
      if (selector === '[data-document-viewer-menu]') return [viewerMenu]
      return []
    },
    createElement: () => makeNode(''),
  }
  const previousDocument = globalThis.document
  const previousObserver = globalThis.MutationObserver
  globalThis.document = doc
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  try {
    let dismissed = 0
    const renderer = createRenderer(async () => ({ ok: true, value: {} }), {
      services: { documentPreviews: { register: () => () => {} } },
      mountOnly: ['sidebar.right.tab.menu.item'],
      slotProps: { 'sidebar.right.tab.menu.item': { tab: { contentId: 'dsh-resource://file/session/s1/note.md' }, dismiss: () => { dismissed += 1 } } },
    })
    await renderer.load()
    await renderer.flush()
    assert.ok(renderer.registrations()['sidebar.right.tab.menu.item'].some((entry) => entry.id === 'dsh-service-editor'))
    const item = renderer.findByTestId('file-editor-menu-item')
    assert.equal(item.children[0], '编辑')
    assert.equal(item.props.role, 'menuitem')

    // 点击：先关菜单，再选中官方下拉里的「编辑」——命中的必须是官方那一项，
    // 不能是本插件自己的菜单项（否则无限自我递归）。
    item.props.onClick()
    assert.equal(dismissed, 1)
    assert.equal(viewerItem.clicks, 1)
    assert.equal(ownMenuItem.clicks, 0)

    // 后缀不在可编辑表内（如 LICENSE）不露出条目。
    const other = createRenderer(async () => ({ ok: true, value: {} }), {
      services: { documentPreviews: { register: () => () => {} } },
      mountOnly: ['sidebar.right.tab.menu.item'],
      slotProps: { 'sidebar.right.tab.menu.item': { tab: { contentId: 'dsh-resource://file/session/s1/LICENSE' }, dismiss: () => {} } },
    })
    await other.load()
    await other.flush()
    assert.equal(other.hasTest('file-editor-menu-item'), false)

    // 已在编辑档位（下拉显示本插件档位名）时也不露出。
    viewerMenu.textContent = '编辑'
    const editing = createRenderer(async () => ({ ok: true, value: {} }), {
      services: { documentPreviews: { register: () => () => {} } },
      mountOnly: ['sidebar.right.tab.menu.item'],
      slotProps: { 'sidebar.right.tab.menu.item': { tab: { contentId: 'dsh-resource://file/session/s1/note.md' }, dismiss: () => {} } },
    })
    await editing.load()
    await editing.flush()
    assert.equal(editing.hasTest('file-editor-menu-item'), false)

    // 后缀判定与官方同口径（解码后的文件名，大小写不敏感，无点号的整名也算）。
    const { editorExtensionMatches } = renderer.moduleExports().fileEditor
    assert.equal(editorExtensionMatches('dsh-resource://file/session/s1/a%20b/c.ts'), true)
    assert.equal(editorExtensionMatches('dsh-resource://file/session/s1/Makefile'), true)
    assert.equal(editorExtensionMatches('dsh-resource://file/session/s1/logo.png'), false)
    assert.equal(editorExtensionMatches('dsh-resource://file/session/s1/LICENSE'), false)
    assert.equal(editorExtensionMatches('dsh-resource://file/session/s1/a.md?line=3'), true)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousObserver === undefined) delete globalThis.MutationObserver
    else globalThis.MutationObserver = previousObserver
  }
})

const testSettingsNavRpc = async (channel, endpoint) => {
  if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
  if (endpoint === 'check-update') return { ok: false, error: 'offline' }
  if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1048576, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
  if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
  if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
  if (endpoint === 'usage' || endpoint === 'usage-refresh') return { ok: true, value: { updatedAt: Date.now(), indexedSessions: 0, totals: {}, projects: [], days: {} } }
  return { ok: true, value: {} }
}

test('settings nav order: invalid localStorage arrays fall back as a whole', async () => {
  const initialSlots = {
    'settings.section': [
      { options: { id: 'general', order: 0, label: () => '通用' }, component: () => null },
      { options: { id: 'models', order: 10, label: () => '模型' }, component: () => null },
      { options: { id: 'plugins', order: 30, label: () => '插件' }, component: () => null },
    ],
  }
  const renderer = createRenderer(testSettingsNavRpc, {
    initialSlots,
    initialStorage: {
      'dsh-service-settings-nav-order': JSON.stringify(['plugins', 'bad/id', 'general']),
      'dsh-service-settings-nav-hidden': JSON.stringify(['models', 42]),
    },
  })
  await renderer.load()
  const entries = renderer.slots.entries('settings.section')
  assert.ok(entries.some((entry) => entry.options.id === 'models'), 'one invalid member must discard the whole hidden preference')
  const sorted = [...entries].sort((a, b) => a.options.order - b.options.order).map((entry) => entry.options.id)
  assert.deepEqual(sorted.slice(0, 3), ['general', 'models', 'plugins'], 'one invalid member must discard the whole order preference')
})

test('settings nav order: entries() maps orders from localStorage and filters hidden items', async () => {
  const initialSlots = {
    'settings.section': [
      { options: { id: 'general', order: 0, label: () => '通用' }, component: () => null },
      { options: { id: 'models', order: 10, label: () => '模型' }, component: () => null },
      { options: { id: 'plugins', order: 30, label: () => '插件' }, component: () => null },
      { options: { id: 'archived-sessions', order: 40, label: () => '已归档会话' }, component: () => null },
    ],
  }
  const renderer = createRenderer(testSettingsNavRpc, {
    initialSlots,
    initialStorage: {
      'dsh-service-settings-nav-order': JSON.stringify(['plugins', 'dsh-service', 'general']),
      'dsh-service-settings-nav-hidden': JSON.stringify(['archived-sessions', 'dsh-service']),
    },
  })
  await renderer.load()
  const entries = renderer.slots.entries('settings.section')
  const ids = entries.map((e) => e.options.id)
  assert.ok(ids.includes('plugins'))
  assert.ok(ids.includes('dsh-service'))
  assert.ok(ids.includes('general'))
  assert.ok(ids.includes('models'))
  assert.ok(!ids.includes('archived-sessions'), 'archived-sessions should be filtered out')

  // Sorted by order (matching DSH shell behavior)
  const sorted = [...entries].sort((a, b) => a.options.order - b.options.order).map((e) => e.options.id)
  assert.deepEqual(sorted.slice(0, 3), ['plugins', 'dsh-service', 'general'])
  // Unlisted models should be at the end
  assert.equal(sorted[3], 'models')

  // 工厂卸载时必须注销包装期间转发给原生 Slot 的订阅，不能只清插件自己的监听集合。
  const nativeSubscriptionsBefore = renderer.slotSubscriptionCount('settings.section')
  renderer.slots.subscribe('settings.section', () => {})
  assert.equal(renderer.slotSubscriptionCount('settings.section'), nativeSubscriptionsBefore + 1)
  renderer.disposeFactory()
  assert.equal(renderer.slotSubscriptionCount('settings.section'), nativeSubscriptionsBefore)
})

test('settings nav order: management page allows reordering, toggling visibility, and resetting', async () => {
  const initialSlots = {
    'settings.section': [
      { options: { id: 'general', order: 0, label: () => '通用' }, component: () => null },
      { options: { id: 'models', order: 10, label: () => '模型' }, component: () => null },
      { options: { id: 'plugins', order: 30, label: () => '插件' }, component: () => null },
    ],
  }
  const renderer = createRenderer(testSettingsNavRpc, {
    initialSlots,
  })
  await renderer.load()

  // Subscribe to settings.section
  let notifiedCount = 0
  renderer.slots.subscribe('settings.section', () => { notifiedCount += 1 })
  const v1 = renderer.slots.getVersion('settings.section')

  // Navigate to Configuration -> Settings Nav tab
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  const navTab = renderer.findByTestId('config-tab-navOrder')
  assert.ok(navTab)
  await navTab.props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('config-tab-navOrder').props['aria-selected'], 'true')
  assert.ok(renderer.hasTest('config-nav-order-page'))
  assert.equal(renderer.findByTestId('nav-order-title').children[0], '设置栏标签排序与显隐')
  assert.match(renderer.text('settings.section'), /设置栏标签排序与显隐.*恢复默认排序.*保存排序/)
  // 管理页不再出现操作说明行（拖拽/箭头/显隐提示），页头只留标题 + 操作按钮。
  assert.doesNotMatch(renderer.text('settings.section'), /可通过拖拽|调整标签顺序|隐藏不常用标签/)

  // All entries present
  assert.ok(renderer.hasTest('nav-order-item-general'))
  assert.ok(renderer.hasTest('nav-order-item-models'))
  assert.ok(renderer.hasTest('nav-order-item-plugins'))
  assert.ok(renderer.hasTest('nav-order-item-dsh-service'))

  // dsh-service visibility toggle is disabled
  const dshToggle = renderer.findByTestId('nav-order-toggle-dsh-service')
  assert.equal(dshToggle.props.disabled, true)

  // Move models down
  const modelsDown = renderer.findByTestId('nav-order-down-models')
  assert.ok(modelsDown)
  await modelsDown.props.onClick({ stopPropagation() {} })
  await renderer.flush()

  // Verify subscriber was notified and version bumped
  assert.ok(notifiedCount > 0)
  assert.ok(renderer.slots.getVersion('settings.section') > v1)

  // Verify storage was updated
  const storedOrder = JSON.parse(globalThis.localStorage.getItem('dsh-service-settings-nav-order'))
  assert.ok(Array.isArray(storedOrder))
  assert.ok(storedOrder.indexOf('models') > 0)

  // Toggle visibility of plugins
  const pluginsToggle = renderer.findByTestId('nav-order-toggle-plugins')
  assert.equal(pluginsToggle.props['aria-checked'], 'true')
  await pluginsToggle.props.onClick({ stopPropagation() {} })
  await renderer.flush()

  const storedHidden = JSON.parse(globalThis.localStorage.getItem('dsh-service-settings-nav-hidden'))
  assert.ok(storedHidden.includes('plugins'))

  // Verify entries() in slots filtered plugins out
  const entriesAfterHide = renderer.slots.entries('settings.section')
  assert.ok(!entriesAfterHide.some((e) => e.options.id === 'plugins'))

  // Click Save
  const saveBtn = renderer.findByTestId('nav-order-save')
  await saveBtn.props.onClick()
  await renderer.flush()
  assert.ok(renderer.hasTest('nav-order-saved-tip'))

  // Reset to default
  const resetBtn = renderer.findByTestId('nav-order-reset')
  await resetBtn.props.onClick()
  await renderer.flush()

  assert.equal(globalThis.localStorage.getItem('dsh-service-settings-nav-order'), null)
  assert.equal(globalThis.localStorage.getItem('dsh-service-settings-nav-hidden'), null)
  const entriesAfterReset = renderer.slots.entries('settings.section')
  assert.ok(entriesAfterReset.some((e) => e.options.id === 'plugins'))
})

test('settings nav order: backend sync on startup and local migration', async () => {
  const rpcCalls = []
  let remoteConfig = { order: ['models', 'general', 'dsh-service'], hidden: ['plugins'] }

  const syncRpc = async (channel, endpoint, payload) => {
    rpcCalls.push({ endpoint, payload })
    if (endpoint === 'config-get') {
      return { ok: true, value: remoteConfig }
    }
    if (endpoint === 'config-set') {
      remoteConfig = payload.value
      return { ok: true, value: remoteConfig }
    }
    return testSettingsNavRpc(channel, endpoint)
  }

  const initialSlots = {
    'settings.section': [
      { options: { id: 'general', order: 0, label: () => '通用' }, component: () => null },
      { options: { id: 'models', order: 10, label: () => '模型' }, component: () => null },
      { options: { id: 'plugins', order: 30, label: () => '插件' }, component: () => null },
    ],
  }

  // 1. 启动时从后端同步配置并覆盖本地
  const renderer = createRenderer(syncRpc, { initialSlots })
  await renderer.load()
  await renderer.flush()

  // 验证 config-get 被调用
  assert.ok(rpcCalls.some((c) => c.endpoint === 'config-get' && c.payload?.section === 'settingsNav'))

  // 验证 entries() 已经应用了后端的排序与隐藏（plugins 隐藏，models 在前）
  const entries = renderer.slots.entries('settings.section')
  assert.ok(!entries.some((e) => e.options.id === 'plugins'), 'plugins should be hidden per backend config')
  const sorted = [...entries].sort((a, b) => a.options.order - b.options.order).map((e) => e.options.id)
  assert.deepEqual(sorted, ['models', 'general', 'dsh-service'])

  // 2. 验证本地已有配置但后端为空时（首次自动迁移）
  rpcCalls.length = 0
  remoteConfig = null
  const rendererMigrate = createRenderer(syncRpc, {
    initialSlots,
    initialStorage: {
      'dsh-service-settings-nav-order': JSON.stringify(['general', 'plugins', 'dsh-service']),
      'dsh-service-settings-nav-hidden': JSON.stringify(['models']),
    },
  })
  await rendererMigrate.load()
  await rendererMigrate.flush()

  // 验证 config-set 被调用以迁移本地配置
  const migrateCall = rpcCalls.find((c) => c.endpoint === 'config-set')
  assert.ok(migrateCall, 'should auto-migrate local settings to backend')
  assert.equal(migrateCall.payload.section, 'settingsNav')
  assert.deepEqual(migrateCall.payload.value, {
    order: ['general', 'plugins', 'dsh-service'],
    hidden: ['models'],
  })
})

test('settings nav order: backend sync retries after failure and re-pushes pending writes', async () => {
  const rpcCalls = []
  let configGetShouldFail = true
  let remoteConfig = null
  let configSetShouldFail = false

  const syncRpc = async (channel, endpoint, payload) => {
    rpcCalls.push({ endpoint, payload })
    if (endpoint === 'config-get') {
      if (configGetShouldFail) throw new Error('host restarting')
      return { ok: true, value: remoteConfig }
    }
    if (endpoint === 'config-set') {
      if (configSetShouldFail) throw new Error('host restarting')
      remoteConfig = payload.value
      return { ok: true, value: remoteConfig }
    }
    return testSettingsNavRpc(channel, endpoint)
  }

  const initialSlots = {
    'settings.section': [
      { options: { id: 'general', order: 0, label: () => '通用' }, component: () => null },
      { options: { id: 'models', order: 10, label: () => '模型' }, component: () => null },
      { options: { id: 'plugins', order: 30, label: () => '插件' }, component: () => null },
    ],
  }

  // 1. 首次拉取失败（宿主重启窗口）：本地配置保留，下次打开面板重试成功并应用后端配置
  const renderer = createRenderer(syncRpc, {
    initialSlots,
    initialStorage: {
      'dsh-service-settings-nav-order': JSON.stringify(['plugins', 'dsh-service', 'general']),
    },
  })
  await renderer.load()
  await renderer.flush()
  assert.deepEqual(
    JSON.parse(globalThis.localStorage.getItem('dsh-service-settings-nav-order')),
    ['plugins', 'dsh-service', 'general'],
    'local config must survive a failed backend pull',
  )

  configGetShouldFail = false
  remoteConfig = { order: ['models', 'general', 'dsh-service'], hidden: [] }
  renderer.unmount('settings.section')
  renderer.mount('settings.section')
  await renderer.flush()
  assert.deepEqual(
    JSON.parse(globalThis.localStorage.getItem('dsh-service-settings-nav-order')),
    ['models', 'general', 'dsh-service'],
    'retry after remount should apply the backend config',
  )

  // 2. 写后端失败挂 pending：下次打开面板时自动重推本地配置
  rpcCalls.length = 0
  configSetShouldFail = true
  await renderer.findButton('配置').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('config-tab-navOrder').props.onClick()
  await renderer.flush()
  const saveCallsBefore = rpcCalls.filter((c) => c.endpoint === 'config-set').length
  await renderer.findByTestId('nav-order-save').props.onClick()
  await renderer.flush()
  assert.equal(rpcCalls.filter((c) => c.endpoint === 'config-set').length, saveCallsBefore + 1, 'failed write still attempted once')

  configSetShouldFail = false
  renderer.unmount('settings.section')
  renderer.mount('settings.section')
  await renderer.flush()
  const setCalls = rpcCalls.filter((c) => c.endpoint === 'config-set')
  assert.equal(setCalls.length, saveCallsBefore + 2, 'pending write should be re-pushed on next panel open')
  assert.deepEqual(remoteConfig, {
    order: ['models', 'general', 'dsh-service', 'plugins'],
    hidden: [],
  }, 're-pushed value must match the local display order')
})

test('settings nav order: ok:false pulls retry and pending local writes win over stale remote data', async () => {
  const rpcCalls = []
  let configGetMode = 'error-response'
  let configSetShouldFail = false
  let remoteConfig = { order: ['models', 'general', 'dsh-service'], hidden: ['plugins'] }
  const syncRpc = async (channel, endpoint, payload) => {
    rpcCalls.push({ endpoint, payload })
    if (endpoint === 'config-get') {
      if (configGetMode === 'error-response') return { ok: false, error: 'restarting' }
      return { ok: true, value: remoteConfig }
    }
    if (endpoint === 'config-set') {
      if (configSetShouldFail) return { ok: false, error: 'restarting' }
      remoteConfig = payload.value
      return { ok: true, value: remoteConfig }
    }
    return testSettingsNavRpc(channel, endpoint)
  }
  const initialSlots = {
    'settings.section': [
      { options: { id: 'general', order: 0, label: () => '通用' }, component: () => null },
      { options: { id: 'models', order: 10, label: () => '模型' }, component: () => null },
      { options: { id: 'plugins', order: 30, label: () => '插件' }, component: () => null },
    ],
  }
  const localOrder = ['plugins', 'dsh-service', 'general', 'models']
  const renderer = createRenderer(syncRpc, {
    initialSlots,
    initialStorage: { 'dsh-service-settings-nav-order': JSON.stringify(localOrder) },
  })
  await renderer.load()
  await renderer.flush()
  assert.equal(rpcCalls.filter((call) => call.endpoint === 'config-get').length, 1)

  // ok:false 不是成功同步：下一次打开必须重试。
  configGetMode = 'success'
  renderer.unmount('settings.section')
  renderer.mount('settings.section')
  await renderer.flush()
  assert.equal(rpcCalls.filter((call) => call.endpoint === 'config-get').length, 2)

  // 独立实例制造真实竞态：首次拉取失败（backendSynced=false），随后本地写失败挂 pending；
  // 下次拉取成功拿到旧远端时，本地 pending 必须优先重推，不能被旧值覆盖。
  configGetMode = 'error-response'
  configSetShouldFail = false
  remoteConfig = { order: ['models', 'general', 'dsh-service'], hidden: [] }
  const pendingRenderer = createRenderer(syncRpc, { initialSlots })
  await pendingRenderer.load()
  await pendingRenderer.flush()
  await pendingRenderer.findButton('配置').props.onClick()
  await pendingRenderer.flush()
  await pendingRenderer.findByTestId('config-tab-navOrder').props.onClick()
  await pendingRenderer.flush()
  const pendingLocal = { order: ['general', 'models', 'plugins', 'dsh-service'], hidden: ['plugins'] }
  configSetShouldFail = true
  await pendingRenderer.findByTestId('nav-order-toggle-plugins').props.onClick({ stopPropagation() {} })
  await pendingRenderer.flush()
  await pendingRenderer.findByTestId('nav-order-save').props.onClick()
  await pendingRenderer.flush()
  configSetShouldFail = false
  configGetMode = 'success'
  pendingRenderer.unmount('settings.section')
  pendingRenderer.mount('settings.section')
  await pendingRenderer.flush()
  assert.deepEqual(remoteConfig, pendingLocal, 'stale remote data must not overwrite a pending local write')
})

// ─── v1.8 模型厂家/渠道图标 ──────────────────────────────────
// 覆盖面：纯解析（精确表 / 前缀别名 / 分段兜底 / 未命中回落）、tier 与 data-URI
// 生成、CSS 两组门（窄态替换 + 未适配零规则）、以及 DOM 层「命中挂属性 / 未命中
// 摘属性」与 effect 析构对称。

test('model provider icons: exact table, prefix aliases, segment fallback, and unmapped providers resolve to null', async () => {
  const renderer = createRenderer(async () => { throw new Error('no rpc expected') })
  await renderer.load()
  const icons = renderer.moduleExports().modelProviderIcons
  assert.equal(typeof icons.resolve, 'function')

  // ① 内置 provider 精确命中（含区域/计费变体共享同一 slug）
  assert.equal(icons.resolve('openai').slug, 'openai')
  assert.equal(icons.resolve('openai-codex').slug, 'openai')
  assert.equal(icons.resolve('anthropic').slug, 'anthropic')
  assert.equal(icons.resolve('google').slug, 'gemini')
  assert.equal(icons.resolve('google-vertex').slug, 'vertexai')
  assert.equal(icons.resolve('amazon-bedrock').slug, 'bedrock')
  assert.equal(icons.resolve('azure-openai-responses').slug, 'azure')
  assert.equal(icons.resolve('github-copilot').slug, 'github')
  assert.equal(icons.resolve('zai-codeinting-cn'.replace('codeinting', 'coding')).slug, 'zhipu')
  assert.equal(icons.resolve('xiaomi-token-plan-ams').slug, 'xiaomi')
  assert.equal(icons.resolve('qwen-token-plan-individual').slug, 'qwen')
  assert.equal(icons.resolve('kimi-coding').slug, 'kimi')

  // ② 自定义渠道名走前缀/别名（本机真实值）
  assert.equal(icons.resolve('opencode-goo').slug, 'opencode')
  assert.equal(icons.resolve('opencode-go-f').slug, 'opencode')
  assert.equal(icons.resolve('openrouter-f').slug, 'openrouter')
  assert.equal(icons.resolve('siliconflow').slug, 'siliconcloud')

  // ③ 大小写与空白归一
  assert.equal(icons.resolve('  OpenAI  ').slug, 'openai')
  assert.equal(icons.resolve('DeepSeek').slug, 'deepseek')

  // ③b 图标库未收录、本地手绘的品牌（CUSTOM_SVG）：Command Code（commandcode.ai）
  assert.equal(icons.resolve('command-goat').slug, 'commandcode')
  assert.equal(icons.resolve('commandcode').slug, 'commandcode')
  assert.equal(icons.resolve('command-code').slug, 'commandcode')
  assert.equal(icons.resolve('Command-Code').slug, 'commandcode')
  // 手绘的是 ⌘ 符号线条（stroke，无填充）：mono 档靠 alpha 出形，必须是 0 档
  assert.equal(icons.resolve('command-goat').spec.c, 0, 'custom Command Code mark must be mono (stroke silhouette)')

  // ③c CLIProxyAPI（CPA）手绘标：外框为内凹菱形，中心为水平镜像反转的 OpenAI 花瓣漩涡
  assert.equal(icons.resolve('cliproxy').slug, 'cliproxy')
  const cpaSpec = icons.resolve('cliproxy').spec
  assert.equal(cpaSpec.c, 0, 'cliproxy mark must be mono tier (c: 0) following currentColor')
  assert.ok(cpaSpec.m.includes('scale(-0.835, 0.835)'), 'cliproxy mark must mirror OpenAI swirl horizontally')
  assert.ok(cpaSpec.m.includes('stroke="currentColor"') || cpaSpec.m.includes('stroke='), 'cliproxy mark must carry outer diamond stroke')

  // 判定是否显示在对话框的条件是用户在余额查询里手动适配过 CLIProxyAPI：
  // 未在余额查询中手动适配时，cpa 渠道解析为 null（不显示）；显式标记已适配时解析为 cliproxy
  assert.equal(icons.resolve('cpa'), null, 'cpa without quota adaptation must resolve to null')
  assert.equal(icons.resolve('cpa', { isCliproxyAdapted: true }).slug, 'cliproxy', 'cpa with quota adaptation resolves to cliproxy')
  assert.equal(icons.resolve('cpa', { isCliproxyAdapted: false }), null, 'cpa with isCliproxyAdapted: false resolves to null')
  assert.equal(icons.resolve('cliproxy', { forComposer: true }), null, 'bare cliproxy channel in composer without adaptation resolves to null')
  assert.equal(icons.resolve('cliproxy', { forComposer: true, isCliproxyAdapted: true }).slug, 'cliproxy')
  assert.equal(icons.resolve('my-custom-proxy', { isCliproxyAdapted: true }).slug, 'cliproxy', 'any custom provider adapted as cliproxy in quota resolves to cliproxy')
  // ⌘ 必须是真的 ⌘ 构造：四条边（<path>）+ 四个向外鼓出的环（<circle>）。
  // 这里刻意分别锁「边」与「环」两种图元——首版把环心放在方框角点上，用的是
  // <rect> + 四个 <circle>，几何上「有框有环」但读起来是「四环 + 中间一个 X」，
  // 完全不像 ⌘（真机放大才看出来）。断言两种图元都在，能挡住这种退化。
  const cmdMark = icons.resolve('command-goat').spec.m
  assert.ok(cmdMark.includes('<path'), 'custom mark must draw its four edges as a path')
  assert.ok(cmdMark.includes('<rect') === false, 'custom mark must not use a corner-centred rect construction (reads as an X, not ⌘)')
  // 校验 ⌘ 的几何自洽：四条边 + 四个环，且**环与边精确相切**。
  // 解析用显式形状，不靠宽松正则——首版正则把环心坐标当成了路径坐标，导致
  // 断言恒真（故意破坏数据也测不出来）。
  const pathD = (cmdMark.match(/<path d="([^"]+)"/) || [])[1]
  assert.ok(pathD, 'custom mark must draw its four edges as a path')
  // 路径形如 M-7.6 -4.6H7.6M-7.6 4.6H7.6M-4.6 -7.6V7.6M4.6 -7.6V7.6
  const segs = [...pathD.matchAll(/M(-?[\d.]+) (-?[\d.]+)([HV])(-?[\d.]+)/g)]
    .map((m) => ({ x1: +m[1], y1: +m[2], axis: m[3], to: +m[4] }))
  assert.equal(segs.length, 4, 'custom mark must have four edge segments')
  const loops = [...cmdMark.matchAll(/<circle cx="(-?[\d.]+)" cy="(-?[\d.]+)" r="([\d.]+)"/g)]
    .map((m) => ({ cx: +m[1], cy: +m[2], r: +m[3] }))
  assert.equal(loops.length, 4, 'custom mark must carry its four corner loops')

  const radii = new Set(loops.map((l) => l.r))
  assert.equal(radii.size, 1, 'all four loops must share one radius')
  const r = loops[0].r

  // 核心不变量：环心到中心的距离 == 方框半边长 + 环半径。
  // 这等价于「环恰好鼓在方框外、并与边的端点相切」——旧版声明了 r 却不满足它
  // （环心 5.1 / 边 8.1 / r 2.5 → 差 0.5），线与环之间留出可见断口，整体散架。
  const frameHalf = Math.abs(segs[0].y1)          // 横边的 |y| 即方框半边长
  for (const loop of loops) {
    const reach = Math.max(Math.abs(loop.cx), Math.abs(loop.cy))
    assert.ok(
      Math.abs(reach - (frameHalf + r)) < 1e-9,
      `loop centre must sit exactly one radius outside the frame (reach ${reach} vs frame ${frameHalf} + r ${r} = ${frameHalf + r})`,
    )
  }
  // 相邻环不得重叠（重叠会糊成一块实心）。
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      const gap = Math.hypot(loops[i].cx - loops[j].cx, loops[i].cy - loops[j].cy) - 2 * r
      assert.ok(gap > 0, `adjacent loops must not overlap (gap ${gap.toFixed(3)})`)
    }
  }

  // 图标库「收录了但在这个尺寸下不可用」的品牌：Xiaomi 用原研哉 2021 全彩超椭圆标（形态 A）替换 xiaomimimo 组合标。
  // 库里那份是「Xiaomi / MIMO」两行文字组合标，15px 下两行各不足 7px 高、糊成一团。
  // 彩色形态 A 包含：超椭圆底板（#FF6900）+ 纯白 MI 字标，属于彩色档（c: 1），通过 background-image 渲染。
  const miSpec = icons.resolve('xiaomi-token-plan-cn').spec
  assert.equal(icons.resolve('xiaomi').slug, 'xiaomi')
  assert.equal(icons.resolve('mimo').slug, 'xiaomi')
  assert.equal(miSpec.c, 1, 'Xiaomi mi mark must be color tier (c: 1) with brand orange superellipse')
  assert.equal((miSpec.m.match(/<path/g) || []).length, 2, 'mi mark has two paths (orange superellipse + white letters)')
  assert.ok(miSpec.m.includes('#FF6900'), 'mi mark must include Xiaomi brand orange #FF6900')
  assert.ok(!miSpec.m.includes('<text'), 'mi mark must not rely on text layout')
  assert.ok(!miSpec.m.includes('<rect'), 'mi mark must use the Kenya Hara superellipse curve, not raw <rect>')

  // 尺寸对齐额度圆环：15px，且每个图标的 viewBox 必须是**正方形**且
  // **贴合图形**——这是「所有图标看起来一样大」的前提。生成器用画布量「含描边的
  // 真实墨迹」再收紧；漏掉这一步各品牌留白不同，同一尺寸会画出参差大小。
  // 尺寸走 CSS 变量（基准 15px），便于按图标做「光学修正」（满框形状如 ⌘ 收 10%）。
  assert.match(icons.css, new RegExp(`width: var\\(${icons.sizeVar}, ${icons.basePx}px\\) !important`), 'icon width must fall back to the 15px base')
  assert.match(icons.css, new RegExp(`height: var\\(${icons.sizeVar}, ${icons.basePx}px\\) !important`))
  assert.equal(icons.basePx, 15, 'base icon size must match the quota ring calibration')
  for (const slug of icons.slugs) {
    const spec = icons.resolve(slug).spec
    const vb = String(spec.v).trim().split(/\s+/).map(Number)
    assert.equal(vb.length, 4, `${slug} viewBox must have four numbers`)
    assert.ok(vb.every((n) => Number.isFinite(n)), `${slug} viewBox numbers must be finite`)
    assert.ok(
      Math.abs(vb[2] - vb[3]) < 0.01,
      `${slug} viewBox must be square so every mark renders at one visual size (got ${spec.v})`,
    )
    assert.ok(vb[2] > 0 && vb[3] > 0, `${slug} viewBox must have positive extents`)
  }

  // 自定义 viewBox 必须被带上（有些品牌不是 24 格）。
  const customUri = icons.dataUri({ v: '0 0 32 32', m: '<path d="M0 0h32v32H0z"/>', c: 0 }, true)
  assert.match(decodeURIComponent(customUri), /viewBox="0 0 32 32"/, 'custom viewBox must survive into the data-URI')
})

test('model provider icons: CSS gates narrow-mode replacement and stays inert for unmapped providers', async () => {
  const renderer = createRenderer(async () => { throw new Error('no rpc expected') })
  await renderer.load()
  const icons = renderer.moduleExports().modelProviderIcons
  const css = icons.css

  // 宽态：模型名前加图标（触发钮 flex 行的首个子项），且以自有属性为门。
  // **必须限定 button**：[class*="_7KE1Ra_trigger"] 是子串匹配，会同时命中
  // _7KE1Ra_triggerLabel / _7KE1Ra_triggerEffort —— 首版真机就是这样在模型名和
  // 推理等级上各多画了一枚（三枚并排）。回归锁死这条。
  assert.ok(
    css.includes(`[${icons.seatAttr}][${icons.attr}] button[class*="_7KE1Ra_trigger"]::before`),
    'wide mode prepends an icon via ::before on the trigger button only',
  )
  // 子串裸匹配不允许再出现：任何给 trigger 画 ::before 的规则都必须带 button 限定。
  for (const line of css.split('\n')) {
    if (!line.includes('_7KE1Ra_trigger"]::before')) continue
    assert.ok(
      /button\[class\*="_7KE1Ra_trigger"\]/.test(line),
      'icon ::before rules must target the trigger button, not the label/effort substrings: ' + line.trim(),
    )
  }
  assert.match(css, /content: '' !important/, 'pseudo element needs content to render')

  // mono 走 mask + currentColor（自动跟随深浅主题）；color 档切到 background-image。
  assert.match(css, /background-color: currentColor !important/)
  assert.match(css, /-webkit-mask: var\(--dshsvc-model-icon\)/)
  assert.ok(css.includes(`[${icons.seatAttr}="color"]`), 'color tier has its own rule')
  assert.match(css, /background-image: var\(--dshsvc-model-icon\) !important/)

  // 窄态替换：官方通用图标必须让位，两条门（≤480px 与官方容器查询）都要在。
  assert.match(css, /@media \(max-width: 480px\)/, 'mobile breakpoint gate present')
  assert.match(css, /@container \(width<=360px\)/, 'official narrow-container gate mirrored')
  const iconHideRules = css.match(/\[class\*="_7KE1Ra_triggerIcon"\] \{ display: none !important; \}/g) || []
  assert.equal(iconHideRules.length, 2, 'official icon must be hidden in both narrow-mode gates')
  // 特异性必须高于 mobile.css 那条 display:block!important（同为 (0,2,1) 时靠顺序会输，
  // 真机实测窄态因此出现两枚图标）——隐藏规则得同时带两个自有属性 → (0,3,1)。
  for (const line of css.split('\n')) {
    if (!line.includes('_7KE1Ra_triggerIcon') || !line.includes('display: none')) continue
    assert.ok(
      line.includes(`[${icons.seatAttr}][${icons.attr}]`),
      'the official-icon hide rule must out-specify mobile.css by carrying both our attributes: ' + line.trim(),
    )
  }

  // 每一组规则都必须以自有属性为门：未适配渠道（属性没挂）不能有任何效果。
  // 逐条检查含 _7KE1Ra_ 的规则选择器都带 seatAttr。
  for (const line of css.split('\n')) {
    if (!line.includes('_7KE1Ra_') || !line.includes('{')) continue
    assert.ok(
      line.includes(`[${icons.seatAttr}]`) || line.includes(`[${icons.seatAttr}="`),
      `every official-icon rule must be gated by our attribute: ${line.trim()}`,
    )
  }

  // 刻意不引用移动端作用域属性：本功能与移动端适配开关无关，且避免与移动端引擎
  // 的挂载断言互相牵连（首版就是这样把 mobile adapt 用例弄红的）。
  assert.equal(css.includes('data-dshsvc-mobile'), false, 'icon CSS must not depend on the mobile-adaptation scope attribute')
})

test('model provider icons: DOM engine applies the mapped icon, clears it for unmapped providers, and tears down symmetrically', async () => {
  const injectedStyles = []
  const attrs = new Map()
  const styleProps = new Map()
  const seat = {
    setAttribute(name, value) { attrs.set(name, value) },
    removeAttribute(name) { attrs.delete(name) },
    hasAttribute(name) { return attrs.has(name) },
    style: {
      setProperty(name, value) { styleProps.set(name, value) },
      removeProperty(name) { styleProps.delete(name) },
    },
  }
  // 可触发的 MutationObserver：真机里 composer 座出现/重建会引发 DOM 变更，
  // 引擎据此重算；替身必须能复现这一步，否则「座后到」的路径测不到。
  const observerCallbacks = []
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb }
    observe() { observerCallbacks.push(this.cb) }
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {},
    documentElement: {},
    head: { appendChild(el) { injectedStyles.push(el.textContent) } },
    // dataset 必须有：引擎给样式表打 plugin/pluginCss 标记（与其它功能同规），
    // 缺了会让 createElement 分支抛错并被容错吞掉，样式表静默不注入。
    createElement() { return { dataset: {}, remove() {} } },
    querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
    querySelectorAll: (sel) => (sel.includes('model-icon-seat') && attrs.has('data-dshsvc-model-icon-seat') ? [seat] : []),
    contains: () => true,
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  }

  // 可切换 provider 的目录桩：订阅回调驱动引擎重新解析。
  let provider = 'openrouter-f'
  const directoryListeners = new Set()
  const directory = {
    store: {
      getSnapshot: () => ({ current: { provider } }),
      subscribe(listener) { directoryListeners.add(listener); return () => directoryListeners.delete(listener) },
    },
    load: () => Promise.resolve(),
  }
  const setProvider = (next) => {
    provider = next
    for (const listener of directoryListeners) listener()
  }

  try {
    const renderer = createRenderer(async () => { throw new Error('no rpc expected') }, {
      modelDirectories: { directoryFor: () => directory },
      featureSettings: { modelProviderIcons: true },
    })
    await renderer.load()
    // 会话快照要有 current，引擎才去找目录（setSessions 会把 current 置空）。
    renderer.setCurrentSession('session-1')
    // 真机里这会伴随 composer DOM 变更 → MutationObserver 回调；替身手动补这一步。
    for (const cb of observerCallbacks) cb()
    await renderer.flush()

    // 命中：属主属性 + 变量 + tier 标记都落到座上（未命中则不挂）。
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'openrouter', 'mapped provider writes the slug attribute')
    assert.equal(attrs.get('data-dshsvc-model-icon-seat'), 'mono')
    assert.ok(styleProps.get('--dshsvc-model-icon')?.startsWith('url("data:image/svg+xml,'), 'mono path writes a mask-ready data-URI')
    assert.ok(injectedStyles.some((text) => text.includes('_7KE1Ra_trigger')), 'icon stylesheet is injected')

    // 切到未适配渠道：属性和变量必须摘干净，官方默认图标完全照旧。
    // （cpa 无映射；command-goat 现已配上 Command Code 手绘标，不再适合当反例。）
    setProvider('cpa')
    assert.equal(attrs.has('data-dshsvc-model-icon'), false, 'unmapped provider must not keep the slug attribute')
    assert.equal(attrs.has('data-dshsvc-model-icon-seat'), false, 'unmapped provider must not keep the seat attribute')
    assert.equal(styleProps.has('--dshsvc-model-icon'), false, 'unmapped provider must not keep the icon variable')

    // 再切回已适配：恢复图标（证明是「按 provider 重算」而不是一次性）。
    setProvider('deepseek')
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'deepseek')

    // 彩色档写 color 标记（deepseek 的品牌色两态对比度达标，走 background-image 路径）。
    assert.equal(attrs.get('data-dshsvc-model-icon-seat'), 'color')

    // 析构对称：effect 释放后属性、变量、样式表全部摘除。
    // 注意 directoryListeners 是共享计数：同一目录 store 上还挂着官方额度环组件
    // （QuotaRing 的 useEffect），它不归本功能管，所以断言「本功能那一份被解开」
    // （数量减少）而不是归零——归零会要求我们去动别的组件的订阅。
    const listenersBeforeDispose = directoryListeners.size
    renderer.disposeFactory()
    assert.equal(attrs.has('data-dshsvc-model-icon'), false, 'teardown removes the slug attribute')
    assert.equal(attrs.has('data-dshsvc-model-icon-seat'), false, 'teardown removes the seat attribute')
    assert.equal(styleProps.has('--dshsvc-model-icon'), false, 'teardown removes the icon variable')
    assert.equal(directoryListeners.size, listenersBeforeDispose - 1, 'teardown releases exactly its own directory subscription')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

test('model provider icons: switching sessions re-resolves the icon even when the composer DOM is untouched', async () => {
  // 回归（真机实测）：宽视口切会话时 composer 座**不重建**（MutationObserver 不回调），
  // 而目录订阅还挂在旧会话的 store 上 → 属性停在旧渠道的图标上。真机表现：390/430/480
  // 因重建 composer 而正确，481/1280 仍显示上一个渠道的品牌。修法是显式订阅会话列表。
  const attrs = new Map()
  const seat = {
    setAttribute(n, v) { attrs.set(n, v) },
    removeAttribute(n) { attrs.delete(n) },
    hasAttribute(n) { return attrs.has(n) },
    style: { setProperty() {}, removeProperty() {} },
  }
  class FakeMutationObserver { observe() {} disconnect() {} }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {}, documentElement: {},
    head: { appendChild() {} },
    createElement() { return { dataset: {}, remove() {} } },
    querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
    querySelectorAll: () => [],
    contains: () => true,
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
  }

  // 两个会话各有自己的目录与 provider。
  const listeners = new Map([['s1', new Set()], ['s2', new Set()]])
  const makeDir = (id, provider) => ({
    store: {
      getSnapshot: () => ({ current: { provider } }),
      subscribe(fn) { listeners.get(id).add(fn); return () => listeners.get(id).delete(fn) },
    },
    load: () => Promise.resolve(),
  })
  const dirs = { s1: makeDir('s1', 'openrouter-f'), s2: makeDir('s2', 'deepseek') }
  try {
    const renderer = createRenderer(async () => { throw new Error('no rpc expected') }, {
      modelDirectories: { directoryFor: (id) => dirs[id] },
      featureSettings: { modelProviderIcons: true },
    })
    await renderer.load()
    renderer.setCurrentSession('s1')
    await renderer.flush()
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'openrouter', 'session 1 resolves its own provider')

    // 切会话：不触发任何 DOM 变更，也不动旧会话的 store——只靠会话列表订阅感知。
    renderer.setCurrentSession('s2')
    await renderer.flush()
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'deepseek', 'switching sessions must re-resolve the icon without any DOM mutation')

    // 再切回：必须也能回来（证明是双向重绑，不是一次性）。
    renderer.setCurrentSession('s1')
    await renderer.flush()
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'openrouter')

    renderer.disposeFactory()
    assert.equal([...listeners.values()].reduce((n, s) => n + s.size, 0), 0, 'teardown must release every directory subscription')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

test('model provider icons: resolves session via retainedBy.mainView when snapshot has no current field (DSH 0.1.6)', async () => {
  const attrs = new Map()
  const styleProps = new Map()
  const seat = {
    setAttribute(name, value) { attrs.set(name, value) },
    removeAttribute(name) { attrs.delete(name) },
    hasAttribute(name) { return attrs.has(name) },
    style: {
      setProperty(name, value) { styleProps.set(name, value) },
      removeProperty(name) { styleProps.delete(name) },
    },
  }
  globalThis.document = {
    createElement(tag) { return { tagName: tag.toUpperCase(), dataset: {}, textContent: '', remove() {} } },
    head: { appendChild() {} },
    querySelector(sel) { return sel === '[data-composer-seat]' ? seat : null },
    querySelectorAll() { return [] },
    documentElement: { hasAttribute: () => false },
    contains: () => true,
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  }
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  const directory = {
    store: {
      getSnapshot: () => ({ current: { provider: 'openrouter-f' } }),
      subscribe() { return () => {} },
    },
    load: () => Promise.resolve(),
  }
  try {
    const renderer = createRenderer(async () => { throw new Error('no rpc expected') }, {
      modelDirectories: { directoryFor: () => directory },
      featureSettings: { modelProviderIcons: true },
    })
    await renderer.load()
    // DSH 0.1.6 真实运行时结构：快照无 current 字段，以 retainedBy.mainView: 1 标识主会话
    renderer.setMainViewSession('session-v16', {
      'session-v16': { id: 'session-v16', retainedBy: { mainView: 1 } },
      'session-other': { id: 'session-other', retainedBy: { mainView: 0 } },
    })
    await renderer.flush()
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'openrouter', 'resolves icon from retainedBy.mainView session')
    assert.equal(attrs.get('data-dshsvc-model-icon-seat'), 'mono')
    renderer.disposeFactory()
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

test('model provider icons: feature toggle off leaves the official icon untouched and re-enables hot', async () => {
  const attrs = new Map()
  const styleProps = new Map()
  const seat = {
    setAttribute(name, value) { attrs.set(name, value) },
    removeAttribute(name) { attrs.delete(name) },
    hasAttribute(name) { return attrs.has(name) },
    style: {
      setProperty(name, value) { styleProps.set(name, value) },
      removeProperty(name) { styleProps.delete(name) },
    },
  }
  class FakeMutationObserver { observe() {} disconnect() {} }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {},
    documentElement: {},
    head: { appendChild() {} },
    createElement() { return { dataset: {}, remove() {} } },
    querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
    querySelectorAll: () => [],
    contains: () => true,
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  }
  const directory = {
    store: { getSnapshot: () => ({ current: { provider: 'deepseek' } }), subscribe: () => () => {} },
    load: () => Promise.resolve(),
  }
  try {
    const renderer = createRenderer(async () => { throw new Error('no rpc expected') }, {
      modelDirectories: { directoryFor: () => directory },
      featureSettings: { modelProviderIcons: false },
    })
    await renderer.load()
    renderer.setCurrentSession('session-1')
    await renderer.flush()
    assert.equal(attrs.has('data-dshsvc-model-icon'), false, 'feature off: no icon attribute, official default icon stays')

    // 热开：立即生效。
    await renderer.setFeature('modelProviderIcons', true)
    await renderer.flush()
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'deepseek', 'hot-enable applies the icon')

    // 热关：立即摘除，回到官方默认图标。
    await renderer.setFeature('modelProviderIcons', false)
    await renderer.flush()
    assert.equal(attrs.has('data-dshsvc-model-icon'), false, 'hot-disable removes the icon again')
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})

test('model provider icons: CLIProxyAPI icon displays on composer seat only when adapted in quota, and responds hot to quota changes', async () => {
  const attrs = new Map()
  const styleProps = new Map()
  const seat = {
    setAttribute(n, v) { attrs.set(n, v) },
    removeAttribute(n) { attrs.delete(n) },
    hasAttribute(n) { return attrs.has(n) },
    style: {
      setProperty(n, v) { styleProps.set(n, v) },
      removeProperty(n) { styleProps.delete(n) },
    },
  }
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {},
    documentElement: {},
    head: { appendChild() {} },
    createElement() { return { dataset: {}, remove() {} } },
    querySelector: (sel) => (sel === '[data-composer-seat]' ? seat : null),
    querySelectorAll: () => [],
    contains: () => true,
    addEventListener() {},
    removeEventListener() {},
    visibilityState: 'visible',
  }

  let currentProvider = 'cpa'
  const listeners = new Set()
  const directory = {
    store: {
      getSnapshot: () => ({ current: { provider: currentProvider } }),
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    },
    load: () => Promise.resolve(),
  }

  let quotaResponse = { ok: true, value: { providers: [] } }
  try {
    const renderer = createRenderer(async (channel, endpoint) => {
      if (endpoint === 'quota') return quotaResponse
      if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
      if (endpoint === 'usage') return { ok: true, value: { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] } }
      return { ok: true, value: {} }
    }, {
      modelDirectories: { directoryFor: () => directory },
      featureSettings: { modelProviderIcons: true },
    })
    await renderer.load()
    renderer.setCurrentSession('session-1')
    await renderer.flush()

    const icons = renderer.moduleExports().modelProviderIcons
    assert.equal(typeof icons.quotaStore?.publish, 'function')

    // 1. 用户未在余额查询中适配 cpa：对话框不显示 cliproxy 图标（回落官方默认图标）
    assert.equal(attrs.has('data-dshsvc-model-icon'), false, 'cpa without quota adaptation must not display icon on composer seat')

    // 2. 用户在余额查询中手动适配了 cpa（kind: cliproxy, kindSource: config）：
    // 触发 quota 快照更新，对话框座立即响应挂上 cliproxy 图标
    icons.quotaStore.publish({
      serverTime: Date.now(),
      providers: [
        { provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config', windows: [] },
      ],
    })
    await renderer.flush()

    assert.equal(attrs.get('data-dshsvc-model-icon'), 'cliproxy', 'cpa adapted as cliproxy in quota displays cliproxy icon')
    assert.equal(attrs.get('data-dshsvc-model-icon-seat'), 'mono')
    assert.ok(styleProps.get('--dshsvc-model-icon')?.startsWith('url("data:image/svg+xml,'))

    // 2b. 余额查询卡片上：已适配的 cpa 渠道名前同样显示 cliproxy 厂家小图标
    // （打开标签会触发一次全量 RPC，替身必须返回同一份适配快照，否则会把 store 覆盖回空）
    quotaResponse = {
      ok: true,
      value: {
        serverTime: Date.now(),
        providers: [
          { provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config', windows: [] },
        ],
      },
    }
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()
    assert.ok(renderer.hasTest('quota-provider-card-cpa'), 'adapted cpa renders a quota card')
    const cardIcon = renderer.findByTestId('quota-provider-icon-cpa')
    assert.equal(cardIcon.props['data-dshsvc-model-icon'], 'cliproxy', 'quota card title carries the cliproxy mark once adapted')
    assert.ok(String(cardIcon.props.style.WebkitMask).startsWith('url("data:image/svg+xml,'), 'card icon renders via the mono mask path')
    await renderer.findButton('概览').props.onClick()
    await renderer.flush()

    // 3. 任意自定义命名的渠道，只要在余额查询中手动适配过 CLIProxyAPI，也会在对话框中显示 cliproxy 图标
    currentProvider = 'my-custom-proxy'
    for (const fn of listeners) fn()
    await renderer.flush()
    assert.equal(attrs.has('data-dshsvc-model-icon'), false, 'my-custom-proxy not yet in quota snapshot has no icon')

    icons.quotaStore.publish({
      serverTime: Date.now(),
      providers: [
        { provider: 'cpa', displayName: 'CPA', adapted: true, kind: 'cliproxy', kindSource: 'config', windows: [] },
        { provider: 'my-custom-proxy', displayName: 'My Proxy', adapted: true, kind: 'cliproxy', kindSource: 'config', windows: [] },
      ],
    })
    await renderer.flush()
    assert.equal(attrs.get('data-dshsvc-model-icon'), 'cliproxy', 'my-custom-proxy adapted as cliproxy displays cliproxy icon')

    // 4. 用户在余额查询中取消了适配：对话框图标立即摘除
    icons.quotaStore.publish({
      serverTime: Date.now(),
      providers: [
        { provider: 'my-custom-proxy', displayName: 'My Proxy', adapted: false, windows: [] },
      ],
    })
    await renderer.flush()
    assert.equal(attrs.has('data-dshsvc-model-icon'), false, 'unadapting removes the icon immediately')

    // 5. 析构清理
    renderer.disposeFactory()
    assert.equal(attrs.has('data-dshsvc-model-icon'), false)
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
})
