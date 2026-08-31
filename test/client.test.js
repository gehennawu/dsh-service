import assert from 'node:assert/strict'
import test from 'node:test'

function createRenderer(rpcCall, options = {}) {
  let moduleDefinition
  const slotComponents = new Map()
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
  let activeLocale = 'zh'
  let localeRevision = 0
  let currentComponent
  let currentSlot
  let hookCursor = 0
  let roots = new Map()
  let reloads = 0

  function scheduleRender() {
    renderAll()
  }

  const React = {
    createElement(type, props, ...children) {
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
      currentComponent = currentSlot === undefined ? node.type : currentSlot + ':' + node.type.name
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
        // 与真实外壳一致：条目 meta 的 inject(sessionId) 产物作为组件 props。
        const occupantProps = entryOptions && typeof entryOptions.inject === 'function'
          ? entryOptions.inject(entryOptions.testSessionId === undefined ? 'session-1' : entryOptions.testSessionId)
          : null
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
            MarkdownText: (props) => React.createElement('div', { 'data-testid': 'md-markdown' }, props && props.text),
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
            callback()
            return () => {}
          },
          register(slotOptions, component) {
            const entries = slotComponents.get(slotOptions.name) || new Map()
            entries.set(slotOptions.id ?? 'entry', { component, options: slotOptions })
            slotComponents.set(slotOptions.name, entries)
            if (slotOptions.name !== 'settings.plugin.item' && !(options.initiallyUnmounted || []).includes(slotOptions.name)) mountedSlots.add(slotOptions.name)
            return () => {
              // 与真实 cordis 一致：disposer 只摘除本条目，整槽无占用时才取消挂载。
              // 此前误杀整个槽名——「关闭左列入口」会把整个设置面板从渲染树里炸掉。
              const name = slotOptions.name
              const live = slotComponents.get(name)
              if (live) {
                live.delete(slotOptions.id ?? 'entry')
                if (live.size === 0) mountedSlots.delete(name)
              }
              renderAll()
            }
          },
        },
        // 圆环路径专用：提供 modelDirectories 时模拟 cordis 的嵌套 inject 等待语义 +
        // ctx.get 惰性取值（插件 apply 时已挂载则立即注册）；
        // 不提供时两者都不存在，插件应保持无圆环（老版本 DSH 兼容分支）。
        // options.services：其他可选服务桩（如移动端适配的 layout 服务）走同一惰性 get。
        ...(options.modelDirectories || options.services ? {
          inject(deps, callback) {
            callback({ modelDirectories: options.modelDirectories })
            return () => {}
          },
          get(service) {
            if (service === 'modelDirectories') return options.modelDirectories
            return options.services?.[service]
          },
        } : {}),
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
      plugin.apply(ctx)
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
    registrations() {
      const out = {}
      for (const [slot, entries] of slotComponents) {
        out[slot] = []
        for (const { options } of entries.values()) out[slot].push({ ...options })
      }
      return out
    },
    reloadCount() {
      return reloads
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
  assert.equal(renderer.sessionSubscriptionCount(), 0)
  assert.equal(calls.includes('usage'), false)
  assert.equal(calls.includes('backup-list'), false)
  assert.equal(calls.includes('quota'), false)

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
  assert.equal(renderer.sessionSubscriptionCount(), 1)

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
  assert.match(text, /token 结构/)
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
  assert.match(text, /今天.*输入 tok.*输出 tok.*缓存 tok.*成功模型步骤.*缓存命中率/)
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

test('overview six-section layout aggregates status, actionable items, and core actions', async () => {
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
  // 六段顺序：状态摘要 → 版本卡 → 进程与运行环境 → 核心操作。
  // 页面头描述也含「版本信息」字样，锚点用版本卡标题+内容连排「版本信息dsh-service」。
  const firstVersion = orderText.indexOf('版本信息dsh-service')
  assert.ok(orderText.indexOf('有 1 项需要处理') < firstVersion, 'status summary precedes version card')
  assert.ok(firstVersion < orderText.indexOf('进程与运行环境'), 'version card precedes runtime metrics')
  assert.ok(orderText.indexOf('进程与运行环境') < orderText.indexOf('健康检查'), 'metrics precede core actions')
  // 核心操作导航：额度查询 → 额度页；健康检查 → 诊断页；创建备份 → 维护·备份子页。
  await renderer.findByTestId('overview-action-quota').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('service-panel-root').props['data-dshsvc-page'], 'quota')
  await renderer.findButton('概览').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('overview-action-health').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('service-panel-root').props['data-dshsvc-page'], 'diagnostics')
  await renderer.findButton('概览').props.onClick()
  await renderer.flush()
  await renderer.findByTestId('overview-action-backup').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('service-panel-root').props['data-dshsvc-page'], 'maintenance')
  assert.equal(renderer.findByTestId('maintenance-tab-backup').props['aria-selected'], 'true')
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
  assert.match(renderer.text('sidebar.footer.action'), /DSH 有更新/)
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

  renderer.setSessions({ 's1': { id: 's1', displayTitle: '重构面板', running: false, pendingInteraction: 'question' } })
  assert.deepEqual(renderer.notifications().slice(1), [
    { title: '需要你的确认', body: '重构面板（等待选择答案）' },
  ])

  renderer.setSessions({ 's1': { id: 's1', displayTitle: '重构面板', running: false } })
  renderer.setSessions({ 's1': { id: 's1', displayTitle: '重构面板', running: false, pendingInteraction: 'approval' } })
  assert.deepEqual(renderer.notifications().slice(2), [
    { title: '需要你的确认', body: '重构面板（等待授权）' },
  ])
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
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: false, pendingInteraction: 'approval' },
  })
  renderer.setSessions({
    root: { id: 'root', displayTitle: '主会话', running: false },
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: false },
  })
  renderer.setSessions({
    root: { id: 'root', displayTitle: '主会话', running: false },
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: false, pendingInteraction: 'plan-review' },
  })
  renderer.setSessions({
    root: { id: 'root', displayTitle: '主会话', running: false },
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: false },
  })
  renderer.setSessions({
    root: { id: 'root', displayTitle: '主会话', running: false },
    child: { id: 'child', displayTitle: '子代理', parentId: 'root', origin: 'subagent', running: false, pendingInteraction: 'question' },
  })
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
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: false, pendingInteraction: 'approval' } })
  assert.deepEqual(renderer.notifications(), [], 'master off gates both kinds')

  master().props.onClick()
  await renderer.flush()
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true } })
  renderer.setSessions({ 's1': { id: 's1', displayTitle: 'A', running: true, pendingInteraction: 'plan-review' } })
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

  // 关闭面板不再补发 quota RPC（此前开/关 toggle 都无条件拉一次）。
  const callsBeforeClose = quotaCalls
  renderer.findByTestId('quota-ring-trigger').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-ring-panel'), false)
  assert.equal(quotaCalls, callsBeforeClose)
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
  assert.match(text, /12% · 1\.4B \/ 11B/)
  // 有效期作为 resetsAt → 重置倒计时行（时长随执行耗时漂移，只断行存在与文案前缀）。
  const resetLine = renderer.findByTestId('quota-card-reset-mimo-total_token')
  assert.match(String(resetLine.children[0]), /^重置于 /)
  // v0.39：凭据入口收进折叠的「高级配置」，先展开 mimo2 卡。
  renderer.findByTestId('quota-advanced-toggle-mimo2').props.onClick()
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
  // v0.39：凭据入口在折叠的「高级配置」区，先展开 sfplan2 卡。
  renderer.findByTestId('quota-advanced-toggle-sfplan2').props.onClick()
  await renderer.flush()
  // 未配置订阅行的凭据入口分流为「控制台令牌（Oasis-Token）」版。
  assert.ok(renderer.hasTest('quota-cred-edit-sfplan2'))
  assert.match(renderer.text('settings.section'), /填写控制台令牌（Oasis-Token，浏览器登录态）/)
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
  assert.deepEqual(addKindValues, ['', 'opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow', 'deepseek', 'stepfun', 'stepfun-step-plan', 'xiaomi-token-plan-cn', 'cliproxy'])
  assert.match(text, /智谱 GLM Coding Plan/)
  assert.equal(renderer.findByTestId('quota-add-submit').props.disabled, true)
  // v0.39：类型切换在折叠的「高级配置」区，先展开 openrouter 卡。
  renderer.findByTestId('quota-advanced-toggle-openrouter').props.onClick()
  await renderer.flush()
  // 已适配卡片脚部下拉预选当前 kind。
  assert.equal(renderer.findByTestId('quota-kind-select-openrouter').props.value, 'opencode-go')
  // 已适配行展示窗口与更新时间；每个窗口带独立进度条（无「已用」头条）。
  assert.match(text, /本周.*14%/)
  // 自动推断的行带「自动识别」标签。
  assert.match(text, /自动识别/)
  assert.ok(renderer.hasTest('quota-auto-tag-openrouter'))
  assert.equal(renderer.findByTestId('quota-card-bar-openrouter-weekly').children[0].props.style.width, '14%')
  assert.equal(renderer.hasTest('quota-card-reset-openrouter-weekly'), false) // fixture 无 resetsAt → 不显示重置行
  // 手录重置卡行（v0.20 免次数）：标题+到期两段，行尾带逐条「移除」按钮。
  const cardLine = renderer.findByTestId('quota-reset-card-openrouter-or-1')
  assert.equal(String(cardLine.children[0].children[0].children), '重置卡 · 周额度重置卡')
  assert.equal(String(cardLine.children[0].children[1].children), '2099-06-01 到期')
  assert.ok(renderer.hasTest('quota-remove-openrouter-or-1'))

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

  // 轮询档位：默认仅手动且不写 localStorage；改 2 分钟开始排程，切回仅手动立即清表。
  assert.equal(localStorage.getItem('dsh-service-quota-poll'), null) // 从未改过 → 不写入，读侧回落仅手动
  const pollSelect = renderer.findByTestId('quota-poll-select')
  assert.equal(pollSelect.props.value, '0')
  pollSelect.props.onChange({ target: { value: '2' } })
  await renderer.flush()
  assert.equal(localStorage.getItem('dsh-service-quota-poll'), '2')
  assert.ok(renderer.pendingTimerDelays().includes(120000))
  pollSelect.props.onChange({ target: { value: '0' } })
  await renderer.flush()
  assert.equal(localStorage.getItem('dsh-service-quota-poll'), '0')
  assert.equal(renderer.pendingTimerDelays().includes(120000), false)
  pollSelect.props.onChange({ target: { value: '1' } })
  await renderer.flush()
  assert.ok(renderer.pendingTimerDelays().includes(60000))

  // 「额度查询」是独立标签：切回「模型统计」不再出现额度卡。
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('remote-quota-card'), false)
  await renderer.findButton('额度查询').props.onClick()
  await renderer.flush()

  // 左列入口开关：默认关；开启注册 settings.section 条目（order 498），再关即注销。
  // 左列入口开关（与重启同款 role=switch）：默认关；开启注册 settings.section 条目（order 498），再关即注销。
  const navSwitch = renderer.findByTestId('quota-nav-switch')
  assert.equal(navSwitch.props['aria-checked'], 'false')
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
  // v0.39：手录重置入口在折叠的「高级配置」区，先展开 zai 卡。
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
  assert.equal(String(secondLineTexts[0].children[0].children), '重置卡 · 周额度重置卡')
  assert.equal(String(secondLineTexts[0].children[1].children), '2026-09-30 08:00 到期')

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
  // 官网用量页链接：zai 卡标题为外链（新标签页），kimi 未登记无链接。
  const zaiLink = renderer.findByTestId('quota-usage-link-zai-row')
  assert.equal(zaiLink.props.href, 'https://open.bigmodel.cn/coding-plan/personal/usage')
  assert.equal(zaiLink.props.target, '_blank')
  assert.equal(renderer.hasTest('quota-usage-link-kimi-row'), false)
  // 初始为快照序。
  assert.deepEqual(cardOrder(), ['quota-provider-card-zai-row', 'quota-provider-card-kimi-row', 'quota-provider-card-sf-row'])
  // 默认收起：无 ↑↓ 按钮；≥2 张卡才显示「调整排序」开关，点击后箭头才出现。
  assert.equal(renderer.hasTest('quota-move-up-zai-row'), false)
  assert.equal(renderer.hasTest('quota-reorder-toggle'), true)
  renderer.findByTestId('quota-reorder-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('quota-reorder-toggle').props['aria-pressed'], 'true')
  // 进入排序模式后：首卡↑、末卡↓禁用。
  assert.equal(renderer.findByTestId('quota-move-up-zai-row').props.disabled, true)
  assert.equal(renderer.findByTestId('quota-move-down-zai-row').props.disabled, false)
  assert.equal(renderer.findByTestId('quota-move-down-sf-row').props.disabled, true)
  // ↓ 换位立即生效并整体落盘。
  renderer.findByTestId('quota-move-down-zai-row').props.onClick()
  await renderer.flush()
  assert.deepEqual(cardOrder(), ['quota-provider-card-kimi-row', 'quota-provider-card-zai-row', 'quota-provider-card-sf-row'])
  assert.deepEqual(JSON.parse(localStorage.getItem('dsh-service-quota-card-order')), ['kimi-row', 'zai-row', 'sf-row'])
  assert.equal(renderer.findByTestId('quota-move-up-kimi-row').props.disabled, true)
  // 快照里新出现的供应商即使排宿主清单第一位，也追加在记忆序之后。
  snapshotProviders = [
    { provider: 'openrouter-row', displayName: 'OpenRouter', adapted: true, kind: 'openrouter', refreshing: false, status: 'ok', windows: [{ id: 'credits', percent: 25 }], fetchedAt: Date.now() },
    ...snapshotProviders,
  ]
  renderer.findByTestId('quota-refresh-kimi-row').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(cardOrder(), ['quota-provider-card-kimi-row', 'quota-provider-card-zai-row', 'quota-provider-card-sf-row', 'quota-provider-card-openrouter-row'])
  // 再点一次收起箭头；只剩一张卡时「调整排序」开关整体消失。
  renderer.findByTestId('quota-reorder-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-move-up-kimi-row'), false)
  snapshotProviders = [snapshotProviders.find((row) => row.provider === 'kimi-row')]
  renderer.findByTestId('quota-refresh-kimi-row').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.equal(renderer.hasTest('quota-reorder-toggle'), false)
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

test('quota surfaces share one visibilitychange listener instead of one per mount', async () => {
  const listenerCount = { visibilitychange: 0 }
  class FakeMutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {},
    head: { appendChild() {} },
    createElement: () => ({}),
    visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type) { listenerCount[type] = (listenerCount[type] || 0) + 1 },
    removeEventListener(type) { listenerCount[type] = (listenerCount[type] || 0) - 1 },
  }
  const usageFixture = { indexedSessions: 0, projects: [], days: [], models: [], totals: {}, errors: [] }
  const quotaOk = async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'check-update') return { ok: true, value: { current: '0.10.0', latest: '0.10.0', upToDate: true } }
    if (endpoint === 'health') return { ok: true, value: { uptimeSeconds: 60, rssBytes: 1, liveSessions: 0, persistedSessions: 0, activeAgents: 0, activeJobs: 0 } }
    if (endpoint === 'backup-list') return { ok: true, value: { items: [], totalBytes: 0 } }
    if (endpoint === 'permissions-plan') return { ok: true, value: { supported: false } }
    if (endpoint === 'usage') return { ok: true, value: usageFixture }
    if (endpoint === 'quota') {
      return { ok: true, value: { serverTime: Date.now(), providers: [{ provider: 'opencode-go', displayName: 'opencode-go', adapted: true, kind: 'opencode-go', refreshing: false, status: 'ok', windows: [], fetchedAt: Date.now() }] } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
  try {
    // 场景一：只有设置页额度卡。开到额度标签 → 1 个监听；整槽卸载（真实 Fiber 销毁路径）→ 0。
    const renderer = createRenderer(quotaOk)
    await renderer.load()
    assert.equal(listenerCount.visibilitychange, 0)
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()
    assert.equal(listenerCount.visibilitychange, 1)
    renderer.unmount('settings.section')
    await renderer.flush()
    assert.equal(listenerCount.visibilitychange, 0)
    renderer.mount('settings.section')
    await renderer.flush()
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()
    assert.equal(listenerCount.visibilitychange, 1)
    renderer.unmount('settings.section')
    await renderer.flush()
    assert.equal(listenerCount.visibilitychange, 0)

    // 场景二：圆环 + 额度卡两个表面并存 → 仍然只有 1 个监听（此前每次挂载都 add 且只摘最后一个）。
    const storeListeners = new Set()
    const store = {
      snapshot: { current: { provider: 'opencode-go' } },
      subscribe(fn) { storeListeners.add(fn); return () => storeListeners.delete(fn) },
      getSnapshot() { return this.snapshot },
    }
    const modelDirectories = {
      directoryFor: () => ({ store, load: () => Promise.resolve() }),
    }
    const renderer2 = createRenderer(quotaOk, { modelDirectories })
    await renderer2.load()
    await renderer2.flush()
    await renderer2.flush()
    // 圆环已挂载（refs=1）：1 个监听。
    assert.equal(listenerCount.visibilitychange, 1)
    await renderer2.findButton('额度查询').props.onClick()
    await renderer2.flush()
    // 第二个表面挂载（refs=2）不叠加监听。
    assert.equal(listenerCount.visibilitychange, 1)
    renderer2.unmount('settings.section')
    await renderer2.flush()
    // 圆环仍挂载（refs 回到 1）：监听保留，最后一个表面卸载才摘。
    assert.equal(listenerCount.visibilitychange, 1)
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
  }
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

test('quota polling continues on a hidden page while a session is running and re-arms when one starts after auto polling is enabled', async () => {
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
    // 默认仅手动：先打开额度页并显式启用 5 分钟自动查询，再验证隐藏页活跃豁免。
    await renderer.findButton('额度查询').props.onClick()
    await renderer.flush()
    renderer.findByTestId('quota-poll-select').props.onChange({ target: { value: '5' } })
    await renderer.flush()
    // 关闭设置页，只留下会话圆环表面，进入“非额度页”的后台查询策略。
    renderer.unmount('settings.section')
    await renderer.flush()
    const callsBeforeHiddenIdle = quotaCalls
    assert.ok(renderer.pendingTimerDelays().includes(300000))
    await renderer.advanceTimer(300000)
    assert.equal(quotaCalls, callsBeforeHiddenIdle)
    assert.equal(renderer.pendingTimerDelays().includes(300000), false)

    // agent 在隐藏期间启动：会话订阅边沿重新拉起轮询链。
    renderer.setSessions({ s1: { id: 's1', displayTitle: '后台 agent', running: true } })
    await renderer.flush()
    assert.ok(renderer.pendingTimerDelays().includes(300000))
    // 隐藏页 + 活跃会话：豁免暂停，周期照常打 quota RPC，且链条继续排下一轮。
    await renderer.advanceTimer(300000)
    assert.ok(quotaCalls >= 1)
    assert.ok(renderer.pendingTimerDelays().includes(300000))

    // 会话结束回到隐藏：下一周期恢复暂停语义（不再外呼，链条死亡等回可见）。
    renderer.setSessions({ s1: { id: 's1', displayTitle: '后台 agent', running: false } })
    await renderer.flush()
    const callsBeforeIdle = quotaCalls
    await renderer.advanceTimer(300000)
    assert.equal(quotaCalls, callsBeforeIdle)
    assert.equal(renderer.pendingTimerDelays().includes(300000), false)
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
    createElement() { return {} },
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

  // 无效条目组：delta 带 legacy ⚠ 与修复按钮；修复与开关同款两段式——第一击只进入待确认不发 RPC。
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
  // v0.31 用户点名：描述/用法/注释占满技能展示区宽度——注释框是条目卡的直接子节点
  // （独占整行），不再嵌在「名称 | 开关」双栏的左列里被开关列挤窄。
  const entryNode = renderer.findByTestId('skill-entry-alpha')
  const directIds = entryNode.children.filter((child) => child !== null && child.props && child.props['data-testid']).map((child) => child.props['data-testid'])
  assert.deepEqual(directIds, ['skill-note-alpha'])
  const headerRow = entryNode.children[0]
  assert.equal(headerRow.props.style.display, 'flex', 'name + switches share the top row')
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
  assert.match(text, /codex-user@example\.com · Codex 5 小时窗/)
  assert.match(text, /codex-user@example\.com · Codex 本周窗/)
  assert.match(text, /gm@gmail\.com · gemini-2\.5-pro/) // 模型名未收录 → 裸模型名兜底
  assert.match(text, /43%/)
  // 稳定错误码 mgmt-disabled 的本地化文案。
  assert.match(text, /CLIProxyAPI 管理面未启用/)
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
  // v0.39：凭据入口在折叠的「高级配置」区，先展开 cpa 卡。
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
  // v0.39：凭据入口在折叠的「高级配置」区，先展开 cpa 卡。
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
  // v0.39：凭据入口在折叠的「高级配置」区，先展开 or 卡。
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
  // v0.39：凭据入口在折叠的「高级配置」区，先展开 cpa 卡。
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
      return { ok: true, value: { ...state.route, models: state.models, current: { provider: 'cpa', model: 'gpt-5.6-sol' } } }
    }
    if (endpoint === 'subagent-route-save') {
      state.saves.push(payload)
      if (options.saveError) return { ok: false, error: options.saveError }
      const savedFallbacks = Array.isArray(payload.fallbacks) && payload.fallbacks.length > 0 ? { fallbacks: payload.fallbacks } : {}
      state.route = payload.mode === 'custom'
        ? { available: true, mode: 'custom', provider: payload.provider, model: payload.model, ...(payload.reasoningEffort !== undefined ? { reasoningEffort: payload.reasoningEffort } : {}), ...savedFallbacks }
        : { available: true, mode: payload.mode, ...savedFallbacks }
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
  }, { featureSettings: options.featureSettings })
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

  // 重置按钮直接保存 inherit，并清除 custom 路由。
  renderer.findByTestId('subagent-reset').props.onClick()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(state.saves[2], { mode: 'inherit' })
  assert.equal(renderer.findByTestId('subagent-mode-inherit').props['aria-pressed'], 'true')

  // v0.39：子代理的设置页左列入口已撤销——段内开关不复存在，也不再注册独立 section。
  assert.equal(renderer.hasTest('subagent-nav-switch'), false)
  assert.equal((renderer.registrations()['settings.section'] || []).some((entry) => entry.id === 'dsh-service-subagent'), false)
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
    assert.match(styleTag.textContent, /nth-child\(2\) header \{ padding-left: 46px/)
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
    assert.match(styleTag.textContent, /body:has\(\[role="dialog"\]\[aria-modal="true"\]\) \[data-dshsvc-fab\],\s*html\[data-dshsvc-mobile\] body:has\(\[role="dialog"\]\[aria-modal="true"\]\) \[data-dshsvc-handle\] \{[^}]*display: none !important/s)
    assert.match(styleTag.textContent, /\[class\*="VOzbGW_close"\] \{[^}]*position: absolute !important/s)
    assert.doesNotMatch(styleTag.textContent, /\[role="dialog"\] nav \{[^}]*padding: 8px 12px/s)
    assert.doesNotMatch(styleTag.textContent, /\[class\*="uV2eYG_row"\] \{[^}]*flex-wrap: wrap/s)
    // 真机第八轮：设置关闭钮圆形底衬随钮置顶；工作区侧板开关浮在面板上方。
    assert.match(styleTag.textContent, /\[class\*="VOzbGW_close"\] \{[^}]*border-radius: 999px !important/s)
    assert.match(styleTag.textContent, /\[class\*="nArs4W_toggleButton"\] \{[^}]*z-index: 45 !important/s)
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
  }
  return async (channel, endpoint, payload) => {
    assert.equal(channel, '/dsh-service')
    onCall?.(endpoint, payload)
    const handler = overrides[endpoint] ?? defaults[endpoint]
    if (handler !== undefined) return typeof handler === 'function' ? handler(payload, endpoint) : handler
    throw new Error(`unexpected endpoint ${endpoint}`)
  }
}


test('mobile adaptation immersive engine hides chat chrome on downward gesture (cumulative) and restores via upward gesture, bottom arrival, focus reveal, and the resident handle', async () => {
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
    assert.match(styleTag.textContent, /\[data-dshsvc-immersive\] \[data-composer-seat\] \{[^}]*transform: translateY\(115%\)/s)
    assert.match(styleTag.textContent, /margin-top: calc\(0px - var\(--dshsvc-header-h, 76px\)\)/s)
    assert.match(styleTag.textContent, /@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-dshsvc-mobile\]\[data-dshsvc-immersive\]/s)

    // 常驻把手挂载；会话可滚 → 可见；半透明磨砂（真机反馈）
    const handle = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-handle'))
    assert.notEqual(handle, undefined, 'resident handle must mount under body')
    assert.equal(handle.style.display, 'flex')
    assert.equal(handle.style.opacity, '.72')
    assert.match(styleTag.textContent, /html\[data-dshsvc-mobile\] \[data-dshsvc-handle\]:hover,\s*html\[data-dshsvc-mobile\] \[data-dshsvc-handle\]:active \{[^}]*opacity: 1 !important/s)

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

    // 上滑回显，把 Chrome 带回展开态后再测把手开关
    freshGesture()
    dragTo(1560, 10)
    assert.equal(immersiveOn(), false)

    // 把手开关两连击
    handle.dispatch('click', {})
    assert.equal(immersiveOn(), true)
    assert.equal(handle.getAttribute('aria-expanded'), 'false')
    handle.dispatch('click', {})
    assert.equal(immersiveOn(), false)
    assert.equal(handle.getAttribute('aria-expanded'), 'true')

    // 开关热关闭：属性/标记/把手全部对称拆除，二次关闭幂等
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

    // 相位必须透过 body 包裹层上溯到 root：会话可滚 → 把手可见、头部标记打上
    const handle = bodyEl.children.find((el) => el.attributes.has('data-dshsvc-handle'))
    assert.notEqual(handle, undefined, 'resident handle must mount under body')
    assert.equal(handle.style.display, 'flex', 'wrapper skeleton must still yield chatAvailable')
    assert.equal(headerEl.attributes.has('data-dshsvc-chat-header'), true, 'header tag must land on the real header through the wrapper')
    assert.equal(headerWrap.attributes.has('data-dshsvc-chat-header'), false, 'display:contents wrapper must stay untagged')

    // 下滑累加 → 隐藏；上滑 → 回显；把手两连击开关
    freshGesture()
    dragTo(264, 6)
    assert.equal(immersiveOn(), true)
    freshGesture()
    dragTo(240, 6)
    assert.equal(immersiveOn(), false)
    handle.dispatch('click', {})
    assert.equal(immersiveOn(), true)
    handle.dispatch('click', {})
    assert.equal(immersiveOn(), false)

    // 开关热关闭：属性/标记/把手全部对称拆除
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

    // dispose：按钮与样式全部移除、观察者断开
    renderer.disposeFactory()
    assert.equal(slot2.children.some((el) => el.attributes.has('data-dshsvc-user-jump')), false)
    assert.ok(!head.children.some((el) => (el.textContent || '').includes('[data-dshsvc-user-jump]:hover')))
  } finally {
    delete globalThis.document
    delete globalThis.MutationObserver
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
  // 归档行不再显示归档按钮；删除入口保留并在全部视图继续验证。
  assert.equal(renderer.hasTest('sessions-row-archive-session-archived'), false, 'archived session has no archive button')
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
    assert.equal(renderer.hasTest('sessions-batch-toggle'), false, 'deleted records stay read-only without a batch selector')
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch
    else globalThis.fetch = previousFetch
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
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
