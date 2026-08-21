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
  const localeListeners = new Set()
  const localeDictionaries = new Map()
  const sessionListeners = new Set()
  const eventHandlers = new Map()
  const sentNotifications = []
  const notificationInstances = []
  let focuses = 0
  const storage = new Map()
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
    useEffect(effect) {
      assert.ok(currentComponent, 'useEffect called outside a component')
      const component = currentComponent
      const effects = effectState.get(component) || new Set()
      effectState.set(component, effects)
      const index = hookCursor++
      if (effects.has(index)) return
      effects.add(index)
      queueMicrotask(() => {
        const cleanup = effect()
        if (typeof cleanup !== 'function') return
        const cleanups = effectCleanups.get(component) || new Map()
        effectCleanups.set(component, cleanups)
        cleanups.set(index, cleanup)
      })
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
      for (const { component } of entries.values()) {
        rendered.push(evaluate(React.createElement(component, null)))
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
        slots: {
          inject(key, callback) {
            callback()
            return () => {}
          },
          register(slotOptions, component) {
            const entries = slotComponents.get(slotOptions.name) || new Map()
            entries.set(slotOptions.id ?? 'entry', { component, options: slotOptions })
            slotComponents.set(slotOptions.name, entries)
            if (!(options.initiallyUnmounted || []).includes(slotOptions.name)) mountedSlots.add(slotOptions.name)
            return () => {
              unmountSlot(slotOptions.name)
              const live = slotComponents.get(slotOptions.name)
              if (live) live.delete(slotOptions.id ?? 'entry')
            }
          },
        },
        effect(callback) {
          const dispose = callback()
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
    totals: { steps: 5, missingUsage: 0, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 },
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
        totals: { steps: 5, missingUsage: 0, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 },
        projects: [{ id: 'project-1', title: 'Project One', path: '/workspace/project', totals: { steps: 14, missingUsage: 0, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 }, models: [
          { id: 'deepseek/deepseek-chat', provider: 'deepseek', model: 'deepseek-chat', totals: { steps: 5, missingUsage: 0, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000, cacheWriteTokens: 100, cacheHitRate: 3000 / 4100 } },
          { id: 'openai/gpt-5', provider: 'openai', model: 'gpt-5', totals: { steps: 4, missingUsage: 0, inputTokens: 900, outputTokens: 180, cacheReadTokens: 2000, cacheWriteTokens: 80, cacheHitRate: 0.6 } },
          { id: 'anthropic/claude', provider: 'anthropic', model: 'claude', totals: { steps: 3, missingUsage: 0, inputTokens: 800, outputTokens: 160, cacheReadTokens: 1000, cacheWriteTokens: 60, cacheHitRate: 0.5 } },
          { id: 'google/gemini', provider: 'google', model: 'gemini', totals: { steps: 2, missingUsage: 0, inputTokens: 700, outputTokens: 140, cacheReadTokens: 500, cacheWriteTokens: 40, cacheHitRate: 0.4 } },
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
  assert.match(overviewText, /概览.*健康诊断.*模型统计.*备份维护.*重启/)
  assert.doesNotMatch(overviewText, /⚠ 模型统计|服务控制提醒/)
  assert.match(overviewText, /版本信息.*容器信息.*运行时间.*内存 RSS/)
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
  assert.doesNotMatch(healthText, /版本信息|容器信息|模型使用/)
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
  assert.equal(renderer.findAllByTestIdPrefix('usage-summary-today-').length, 5)
  assert.equal(renderer.findAllByTestIdPrefix('usage-summary-seven-').length, 5)
  assert.match(text, /1K|3K|4\.1K/)
  assert.match(text, /5 次/)
  assert.match(text, /deepseek\/deepseek-chat.*openai\/gpt-5.*anthropic\/claude/)
  assert.doesNotMatch(text, /google\/gemini/)
  assert.match(text, /▸ 展开其余 1 个模型/)
  await renderer.findButton('▸ 展开其余 1 个模型').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /google\/gemini.*▾ 收起模型列表/)
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
  assert.equal(tabs.props.style.borderBottom, '1px solid var(--dsw-alias-border-l1)')
  assert.equal(activeOverviewTab.props.style.color, 'var(--dsw-alias-brand-primary)')
  assert.equal(activeOverviewTab.props.style.borderBottom, '2px solid var(--dsw-alias-brand-primary)')
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
  assert.match(text, /概览.*⚠ 健康诊断.*⚠ 备份维护/)
  assert.match(text, /服务控制提醒.*健康诊断.*备份维护/)
  assert.doesNotMatch(text, /⚠ 概览|⚠ 模型统计|⚠ 重启/)
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
      return { ok: true, value: { status: 'warning', checkedAt: Date.now(), checks: [{ id: 'session-storage', status: 'ok', detail: '2' }, { id: 'backup-storage', status: 'warning', detail: '0:0' }] } }
    }
    throw new Error(`unexpected endpoint ${endpoint}`)
  })
  await renderer.load()
  await renderer.findButton('健康诊断').props.onClick()
  await renderer.flush()
  assert.equal(calls, 1)
  assert.match(renderer.text('settings.section'), /健康提醒.*检查结果存在警告/)
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
  await renderer.findButton('⚠ 健康诊断').props.onClick()
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

test('notification switches render three independent toggles and persist each choice', async () => {
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
  let switches = renderer.findSwitches()
  assert.equal(switches.length, 3, 'master + done + input switches')
  assert.deepEqual(switches.map((node) => node.props['aria-checked']), ['false', 'true', 'true'])
  assert.equal(switches[1].props.onClick, undefined, 'sub switches are paused while master is off')

  switches[0].props.onClick()
  await renderer.flush()
  switches = renderer.findSwitches()
  assert.deepEqual(switches.map((node) => node.props['aria-checked']), ['true', 'true', 'true'])
  assert.equal(typeof switches[1].props.onClick, 'function')

  switches[2].props.onClick()
  await renderer.flush()
  switches = renderer.findSwitches()
  assert.deepEqual(switches.map((node) => node.props['aria-checked']), ['true', 'true', 'false'])
  assert.equal(localStorage.getItem('dsh-service-notify'), 'true')
  assert.equal(localStorage.getItem('dsh-service-notify-done'), null)
  assert.equal(localStorage.getItem('dsh-service-notify-input'), 'false')
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
