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
    for (const [slot, component] of slotComponents) {
      if (!mountedSlots.has(slot)) continue
      currentSlot = slot
      next.set(slot, evaluate(React.createElement(component, null)))
      currentSlot = undefined
      renderedComponents.set(slot, component)
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
          timeout(delay) {
            return new Promise((resolve) => timers.push({ delay, resolve }))
          },
        },
        slots: {
          inject(key, callback) {
            callback()
            return () => {}
          },
          register(slotOptions, component) {
            slotComponents.set(slotOptions.name, component)
            if (!(options.initiallyUnmounted || []).includes(slotOptions.name)) mountedSlots.add(slotOptions.name)
            return () => {
              unmountSlot(slotOptions.name)
              slotComponents.delete(slotOptions.name)
            }
          },
        },
        effect(callback) {
          const dispose = callback()
          return typeof dispose === 'function' ? dispose : () => {}
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
    reloadCount() {
      return reloads
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
  assert.equal(await renderer.advanceTimer(), 5000)
  assert.equal(healthCalls, 2)
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
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /检测到 1 项运行中的工作/)

  renderer.setLocale('en')
  await renderer.flush()
  assert.match(renderer.text('settings.section'), /Version information/)
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
  await renderer.findButton('重启 dsh web').props.onClick()
  await renderer.flush()
  await renderer.findButton('确认重启').props.onClick()
  await renderer.flush()
  renderer.unmount('settings.section')
  await renderer.advanceTimer(5000)

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
