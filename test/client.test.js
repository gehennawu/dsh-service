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
  const storage = new Map()
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
  assert.match(renderer.text('settings.plugin.item'), /服务控制（dsh-service）.*可选功能.*健康诊断.*模型统计.*额度查询.*备份维护.*任务通知.*外部能力.*\/healthz 探活端点/)
  assert.doesNotMatch(renderer.text('settings.section'), /模型统计|额度查询|备份维护|通知/)
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
  // v0.34.1：重启钉首行右缘（额度查询/通知之后、第二行子代理之前），各标签仍按组序渲染。
  assert.match(overviewText, /概览.*健康诊断.*模型统计.*额度查询.*通知/)
  assert.match(overviewText, /通知重启|重启子代理|重启\n/)
  assert.doesNotMatch(overviewText, /⚠ 模型统计|服务控制提醒/)
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

  const tabs = renderer.findByTestId('tab-list')
  const panel = renderer.findByTestId('tab-panel')
  const overviewSurface = renderer.findByTestId('health-display')
  const activeOverviewTab = renderer.findButton('概览')
  // v0.34 激活段区分度加强：品牌色暗化实底（color-mix 叠层）+ 白字——白字的对比度由
  // 「底也压暗」保证，不再依赖 token 明度；分段条托盘与分组行为照旧。
  assert.equal(tabs.props.style.borderBottom, undefined)
  assert.equal(tabs.props.style.flexDirection, 'column')
  // v0.34.2：激活块配色走双主题变量（浅=原色实底+白字，暗=提亮块+近黑字），组件只引用 var。
  assert.equal(activeOverviewTab.props.style.color, 'var(--dsh-svc-tab-active-text)')
  assert.equal(activeOverviewTab.props.style.background, 'var(--dsh-svc-tab-active-bg)')
  // 分段条样式：激活段 = 条内实底圆角块（非独立胶囊）。
  assert.equal(activeOverviewTab.props.style.borderRadius, '8px')
  assert.equal(panel.props.style.boxShadow, undefined)
  assert.equal(panel.props.style.border, undefined)
  assert.equal(panel.props.style.background, undefined)
  assert.equal(overviewSurface.props.style.background, 'var(--dsh-svc-surface-bg)')
  assert.equal(overviewSurface.props.style.color, 'var(--dsw-alias-label-primary)')
  assert.equal(overviewSurface.props.style.border, '1px solid var(--dsw-alias-border-l1)')
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  const healthRegion = renderer.findByTestId('health-diagnostics-region')
  assert.equal(healthRegion.props.style.border, '1px solid var(--dsw-alias-border-l1)')
  assert.equal(healthRegion.props.style.background, 'var(--dsh-svc-surface-bg)')
  assert.equal(healthRegion.props.style.color, 'var(--dsw-alias-label-primary)')
  const healthAction = renderer.findButton('立即健康检查')
  assert.equal(healthAction.props['data-variant'], 'neutral')
  assert.equal(healthAction.props.style.background, 'var(--dsw-alias-bg-layer-2)')
  assert.equal(healthAction.props.style.color, 'var(--dsw-alias-label-primary)')
  assert.equal(healthAction.props.style.borderColor, 'var(--dsw-alias-border-l2)')
  await renderer.findButton('模型统计').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findButton('刷新统计').props['data-variant'], 'neutral')
  await renderer.findButton('备份维护').props.onClick()
  await renderer.flush()
  const createBackup = renderer.findButton('创建备份')
  assert.equal(createBackup.props['data-variant'], undefined)
  assert.equal(createBackup.props.style.background, 'var(--dsw-alias-bg-layer-2)')
  assert.equal(createBackup.props.style.color, 'var(--dsw-alias-label-primary)')
  assert.equal(createBackup.props.style.borderColor, 'var(--dsw-alias-border-l2)')
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  const restartRegion = renderer.findByTestId('restart-region')
  assert.equal(restartRegion.props.style.border, '1px solid var(--dsw-alias-border-l1)')
  assert.equal(restartRegion.props.style.background, 'var(--dsh-svc-surface-bg)')
  assert.equal(restartRegion.props.style.color, 'var(--dsw-alias-label-primary)')
  const restart = renderer.findButton('重启 dsh web')
  assert.equal(restart.props['data-variant'], 'danger')
  assert.equal(restart.props.style.background, 'var(--dsw-alias-state-error-primary)')
  assert.equal(restart.props.style.color, '#fff')
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
  // v0.31 胶囊分组条：故障 ⚠ 从文字前缀改为角落橙点（tab-dot-* testid）。
  assert.equal(renderer.hasTest('tab-dot-health'), true)
  assert.equal(renderer.hasTest('tab-dot-backup'), true)
  assert.equal(renderer.hasTest('tab-dot-overview'), false, 'overview has no failure')
  assert.equal(renderer.hasTest('tab-dot-restart'), false, 'restart has no failure')
  // 两行分组：第一行「状态与数据」（概览→额度查询），第二行「技能与维护」（备份维护→子代理 + 红胶囊重启殿后）。
  // 每枚胶囊带 top-tab-<id> testid，顺序断言直接用官方辅助方法，不手写树遍历（假渲染树的
  // 子节点可能是数组节点，自写递归器漏掉会得到空集——曾因此假失败一轮）。
  // 分组行与竖排侧签各带 testid；前缀收集按 DOM 出现序：行 div 在前、其内部标题随后。
  // v0.33：竖排侧签标题去掉，只剩行 + 行内分段条；前缀收集顺序=行 → 托盘。
  assert.deepEqual(renderer.findAllByTestIdPrefix('tab-group-').map((group) => group.props['data-testid']), ['tab-group-data', 'tab-group-data-tray', 'tab-group-maint', 'tab-group-maint-tray'])
  // 组序（用户点名）：数据行 概览→健康诊断→模型统计→额度查询→通知；维护行 子代理→技能管理→备份维护。
  // v0.34.1：重启移出托盘、独立胶囊钉在首行右缘 → DOM 序里它出现在首行之后、子代理之前。
  assert.deepEqual(renderer.findAllByTestIdPrefix('top-tab-').map((node) => node.props['data-testid']), [
    'top-tab-overview', 'top-tab-health', 'top-tab-usage', 'top-tab-quota', 'top-tab-notify',
    'top-tab-restart', 'top-tab-subagent', 'top-tab-skills', 'top-tab-backup',
  ], 'order: data row chips, restart pinned right, then maintenance row')
  // renderer.text() 只认槽名；分组节点文本用本地展平器收集。
  const flattenText = (node) => {
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
  const dataGroup = renderer.findByTestId('tab-group-data')
  const maintGroup = renderer.findByTestId('tab-group-maint')
  assert.doesNotMatch(flattenText(dataGroup), /状态与数据|技能与维护/, 'group titles are removed per user feedback')
  // v0.34.1：重启钉首行右缘 → 数据行含重启、维护行不含。
  assert.match(flattenText(dataGroup), /重启/)
  assert.doesNotMatch(flattenText(dataGroup), /备份维护|子代理|技能(?!管理)/)
  assert.doesNotMatch(flattenText(maintGroup), /概览|重启/)
  // 重启胶囊在未激活态也保持危险色描边（组合值含 1px solid 前缀）；激活态淡染由点击流程用例覆盖。
  // v0.34：重启移出托盘、独立胶囊 margin-left:auto 推到行右缘。
  const restartChip = renderer.findByTestId('top-tab-restart')
  assert.equal(restartChip.props.style.border, '0.5px solid var(--dsw-alias-state-error-primary)', 'restart keeps a red outlined capsule when idle')
  assert.equal(restartChip.props.style.marginLeft, 'auto', 'restart pins to the right edge of the tab area')
  // 假树的节点没有 parentNode 回链：用「托盘子树文本不含重启段之外的分支」不可行（同名），
  // 直接断言 maintenance 托盘的直接 children 里没有 top-tab-restart 段。
  const maintTray = renderer.findByTestId('tab-group-maint-tray')
  const collectChipTestids = (node, out = []) => {
    if (Array.isArray(node)) { for (const child of node) collectChipTestids(child, out); return out }
    if (node === null || typeof node !== 'object') return out
    if (typeof node.props?.['data-testid'] === 'string' && node.props['data-testid'].startsWith('top-tab-')) { out.push(node.props['data-testid']); return out }
    for (const child of node.children ?? []) collectChipTestids(child, out)
    return out
  }
  assert.deepEqual(collectChipTestids(maintTray), ['top-tab-subagent', 'top-tab-skills', 'top-tab-backup'], 'maintenance tray holds exactly its three segments; restart floats outside')
  const dataTray = renderer.findByTestId('tab-group-data-tray')
  assert.deepEqual(collectChipTestids(dataTray), ['top-tab-overview', 'top-tab-health', 'top-tab-usage', 'top-tab-quota', 'top-tab-notify'], 'data tray holds its five segments')
  assert.match(text, /服务控制提醒.*健康诊断.*备份维护/)
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
        dsh: { current: '0.1.0-rc.7', latest: '0.2.0', tags: { latest: '0.1.0-rc.7', next: '0.2.0' }, upToDate: false, url: 'https://github.com/deepseek-ai/DeepSeek-Harness/releases' },
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
  assert.match(renderer.text('settings.section'), /当前版本：0\.1\.0-rc\.7.*最新版本：0\.2\.0.*正式版 0\.1\.0-rc\.7.*预览版 0\.2\.0/)
  assert.doesNotMatch(renderer.text('shell.overlay'), /正式版|预览版/, 'no overlay popup involved')
  assert.equal(renderer.findByTestId('version-dsh-channel-latest-npmjs').props.href, 'https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.0-rc.7')
  assert.equal(renderer.findByTestId('version-dsh-channel-next-npmjs').props.href, 'https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.2.0')
  assert.equal(renderer.findByTestId('version-dsh-channel-latest-npmmirror').props.href, 'https://www.npmmirror.com/package/@deepseek-ai/dsh/home?version=0.1.0-rc.7')
  assert.equal(renderer.findByTestId('version-dsh-channel-next-npmmirror').props.href, 'https://www.npmmirror.com/package/@deepseek-ai/dsh/home?version=0.2.0')
  assert.equal(renderer.findAllByTestIdPrefix('version-dsh-channel-').length, 6, 'two channel lines with number + npmjs + npmmirror each')

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
  assert.match(initialText, /健康提醒.*发现 1 个根目录异常/)
  assert.doesNotMatch(initialText, /模型使用/)
  assert.doesNotMatch(initialText, /\/home\/node\/\.dsh/)
  assert.match(initialText, /发现 1 个根目录异常/)
  assert.match(renderer.text('settings.section'), /目标属主：1000:1000/)
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
    if (endpoint === 'backup-create') return { ok: true, value: { item: second, items: [second, first], totalBytes: 3584 } }
    if (endpoint === 'backup-delete') {
      assert.deepEqual(payload, { id: first.id })
      return { ok: true, value: { items: [second], totalBytes: second.sizeBytes } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })

  await renderer.load()
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
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()

  assert.match(renderer.text(), /检测到 3 项运行中的工作/)
  assert.match(renderer.text(), /pnpm test/)
  assert.match(renderer.text(), /dev shell/)
  assert.equal(calls.some((call) => call.endpoint === 'web'), false)

  await renderer.findButton('取消').props.onClick()
  await renderer.flush()
  assert.doesNotMatch(renderer.text(), /检测到 3 项运行中的工作/)
  assert.equal(calls.some((call) => call.endpoint === 'web'), false)

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
  assert.equal(localStorage.getItem('dsh-service-restart-nav'), null)

  // 「重启」标签内打开开关后条目注册，位于「服务控制」之下
  await renderer.findButton('重启').props.onClick()
  await renderer.flush()
  renderer.findByTestId('restart-nav-switch').props.onClick()
  await renderer.flush()
  const sections = renderer.registrations()['settings.section']
  assert.deepEqual(sections.map((s) => s.id), ['dsh-service', 'dsh-service-restart'])
  assert.ok(sections[1].order > sections[0].order, 'restart entry sits below the service control page in the left nav')
  assert.equal(sections[1].label(), '重启')
  assert.equal(localStorage.getItem('dsh-service-restart-nav'), 'true')
  renderer.setLocale('en')
  await renderer.flush()
  assert.equal(sections[1].label(), 'Restart')
  renderer.setLocale('zh')
  await renderer.flush()

  // 关闭后条目移除并持久化
  renderer.findByTestId('restart-nav-switch').props.onClick()
  await renderer.flush()
  assert.deepEqual(renderer.registrations()['settings.section'].map((s) => s.id), ['dsh-service'])
  assert.equal(localStorage.getItem('dsh-service-restart-nav'), 'false')
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
  await renderer.findButton('通知').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /任务结束或需要你授权、抉择时发送浏览器通知。需要授权浏览器通知权限。/)
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

test('notification kinds are gated by the master and per-kind switches', async () => {
  const renderer = createRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'old-instance' } }
    throw new Error(`unexpected endpoint ${endpoint}`)
  }, { notificationPermission: 'granted' })

  await renderer.load()
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
  assert.equal(renderer.hasTest('tab-dot-health'), true)
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
  const renderer = quotaRingRenderer(async (channel, endpoint) => {
    if (endpoint === 'version') return { ok: true, value: { current: '0.1.0-rc.7', instanceId: 'x' } }
    if (endpoint === 'quota') {
      quotaCalls.push(Date.now())
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
  assert.ok(quotaCalls.length >= 1)

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
  // 未配置行的凭据入口文案按 kind 分流为 Cookie 版。
  assert.ok(renderer.hasTest('quota-cred-edit-mimo2'))
  assert.match(text, /填写控制台 Cookie（网页登录态）/)
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
  assert.deepEqual(addKindValues, ['', 'opencode-go', 'zai-coding-cn', 'openrouter', 'kimi', 'siliconflow', 'deepseek', 'xiaomi-token-plan-cn', 'cliproxy'])
  assert.match(text, /智谱 GLM Coding Plan/)
  assert.equal(renderer.findByTestId('quota-add-submit').props.disabled, true)
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
  assert.equal(localStorage.getItem('dsh-service-quota-nav'), 'true')
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
  const observers = []
  const injectedStyles = []
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe() {}
    disconnect() {}
  }
  globalThis.MutationObserver = FakeMutationObserver
  globalThis.document = {
    body: {},
    head: { appendChild(el) { injectedStyles.push(el.textContent) } },
    createElement() { return {} },
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
    assert.ok(observers.length >= 1, 'expected a MutationObserver for settings nav marking')
    assert.equal(navButtons[0].attrs.has('data-dsh-service-nav'), true)
    assert.equal(navButtons[1].attrs.has('data-dsh-service-quota-nav'), true)
    assert.equal(navButtons[2].attrs.has('data-dsh-service-restart-nav'), true)
    assert.equal(navButtons[3].attrs.has('data-dsh-service-subagent-nav'), true)
    assert.equal(navButtons[4].attrs.size, 0)

    // 外壳重渲染（观察器重跑 sync）：文案未变则标记幂等保留。
    for (const observer of observers) observer.callback([], undefined)
    assert.equal(navButtons[0].attrs.has('data-dsh-service-nav'), true)
    assert.equal(navButtons[1].attrs.has('data-dsh-service-quota-nav'), true)

    // 文案不再匹配（行消失/换名）：标记被摘除，不会残留到别的行。
    navButtons[2].textContent = '别人的同名行'
    for (const observer of observers) observer.callback([], undefined)
    assert.equal(navButtons[2].attrs.size, 0)

    // CSS 已随 load 注入：齿轮隐藏规则 + 各条 data 标记的 mask 规则齐全。
    const sheet = injectedStyles.join('')
    assert.ok(sheet.includes('[data-dsh-service-nav]>svg:first-child'), 'gear-hiding rule missing')
    for (const attr of ['data-dsh-service-nav', 'data-dsh-service-quota-nav', 'data-dsh-service-restart-nav', 'data-dsh-service-subagent-nav']) {
      assert.ok(sheet.includes('[' + attr + ']::before'), attr + ' icon rule missing')
      assert.ok(sheet.includes('mask:url("data:image/svg+xml,'), attr + ' mask data URI missing')
    }
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
      return { ok: true, value: { planId: 'plan-1', candidates: [{ id: 'id-beta', name: 'beta', source: 'user-agents' }], skipped: [{ id: 'id-alpha', name: 'alpha', reason: 'annotated-current' }], estBytes: 2048 } }
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

test('batch card plans, starts, and settles through the status poll with a refreshed catalog', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
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
  assert.match(renderer.text(), /待开始（核对候选后点击「开始批量补全」）/)
  assert.match(renderer.text(), /跳过 1 项/)

  renderer.findByTestId('skills-batch-start').props.onClick()
  await renderer.flush()
  await renderer.flush()
  await renderer.flush()
  assert.deepEqual(fixture.state.batchPlans, [{ provider: 'p', model: 'm1' }])
  assert.deepEqual(fixture.state.batchRuns, [{ planId: 'plan-1', lang: 'zh' }])
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
  renderer.findButton('技能').props.onClick()
  await renderer.flush()
  await renderer.flush()
  renderer.findByTestId('skills-batch-toggle').props.onClick()
  await renderer.flush()
  renderer.findByTestId('skills-batch-plan').props.onClick()
  await renderer.flush()
  await renderer.flush()

  // 摘要不再宣称「只读」跳过（只读目录早已是合法候选）。
  const summary = renderer.findByTestId('skills-batch-candidates').children.join('')
  assert.doesNotMatch(summary, /只读/)
  assert.match(summary, /跳过 1 项/)

  // 跳过清单可展开：逐条显示名称与本地化原因。
  assert.equal(renderer.hasTest('skills-batch-skipped-item'), false)
  renderer.findByTestId('skills-batch-skipped-toggle').props.onClick()
  await renderer.flush()
  assert.equal(renderer.hasTest('skills-batch-skipped-item'), true)
  assert.match(renderer.text(), /alpha：已注释/)
})

test('AI completion requests carry the active UI language so host prompts follow the DSH locale', async () => {
  const fixture = createSkillsRpcFixture()
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
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

test('factory-level adopt restores a host-side running batch badge without visiting the skills tab', async () => {
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
  const renderer = baseSkillRenderer(fixture)
  await renderer.load()
  renderer.mount('settings.section')
  await renderer.flush()
  await renderer.flush()
  // 工厂启动即采纳：不进技能页，「技能」胶囊右上角也挂批量计数小徽标（done/total）。
  assert.equal(renderer.hasTest('skills-tab-badge'), true)
  assert.equal(renderer.findByTestId('skills-tab-badge').children[0], '1/3')
  assert.ok(statusCalls >= 1)
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
      state.route = payload.mode === 'custom'
        ? { available: true, mode: 'custom', provider: payload.provider, model: payload.model }
        : { available: true, mode: payload.mode }
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

  // 左列快捷入口默认关闭，开关后注册 order=496 的独立 settings.section。
  assert.equal(renderer.findByTestId('subagent-nav-switch').props['aria-checked'], 'false')
  renderer.findByTestId('subagent-nav-switch').props.onClick()
  await renderer.flush()
  assert.equal(renderer.findByTestId('subagent-nav-switch').props['aria-checked'], 'true')
  assert.ok((renderer.registrations()['settings.section'] || []).some((entry) => entry.id === 'dsh-service-subagent' && entry.order === 496))
})

test('subagent tab is feature-gated and renders host errors/unavailable status in localized text', async () => {
  const disabled = createSubagentRenderer({ featureSettings: { subagentRoute: false } }).renderer
  await disabled.load()
  disabled.mount('settings.section')
  assert.doesNotMatch(disabled.text(disabled.findByTestId('tab-list')), /子代理/)
  assert.equal((disabled.registrations()['settings.section'] || []).some((entry) => entry.id === 'dsh-service-subagent'), false)

  const unavailable = createSubagentRenderer({ route: { available: false, mode: 'inherit' } }).renderer
  await unavailable.load()
  unavailable.mount('settings.section')
  unavailable.findButton('子代理').props.onClick()
  await unavailable.flush()
  await unavailable.flush()
  assert.match(unavailable.findByTestId('subagent-unavailable').children.join(''), /subagents 服务缺席/)

  const failed = createSubagentRenderer({ saveError: 'invalid-model-route' }).renderer
  await failed.load()
  failed.mount('settings.section')
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
    assert.match(styleTag.textContent, /\[class\*="FJxK0a_root"\] \{[^}]*overflow-x: auto !important/s)
    assert.match(styleTag.textContent, /\[role="dialog"\] \[class\*="navList"\] \{ flex-direction: row/)
    // 真机反馈第三轮：设置模态长在侧栏子树内（未 portal），抽屉隐藏禁用 transform
    // （transform 会造包含块把 fixed 模态锁进抽屉宽度），一律用 left/right 偏移。
    assert.doesNotMatch(styleTag.textContent, /data-dshsvc-(sidebar|details)\]\s*\{[^}]*transform/s)
    // 真机第六轮：钉位使 abs 子项包含块=0px grid area，百分比偏移对 0 宽取值失效、
    // 元素被超约束解算推回屏内盖住会话 —— 离屏偏移必须用 vw 长度。
    assert.doesNotMatch(styleTag.textContent, /-105%|translateX/)
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
