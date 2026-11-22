import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// 会话活跃观察分片（src/client/session-activity.js）中「会话状态源注入生命周期」的单元测试。
//
// 分片不是模块：无 import/export，是客户端半 factory 作用域里的连续切片（见 scripts/client-source.mjs），
// 所以用 vm 把该分片当函数表达式求值（`(` + 文本 + `)`）直接拿到工厂本身。本文件独立于
// test/client.test.js 的整链 renderer harness，只构造状态观察路径需要的最小面。
//
// 覆盖的契约（Cordis 语义，0.1.6-alpha.2 @deepseek-ai/cordis 源码核实；状态源拓扑跨两代）：
//   新版（0.2.3-alpha.1+）：状态是独立服务 `uiSession.sessionStatus`。
//   旧版：状态是 `uiSession` 服务上的普通属性，点号服务名从未单独注册。
//   两种拓扑下 ctx.inject([...], cb) 都以 cb 为 apply 启动子 fiber——依赖可用即执行，cb 返回的
//   函数被收为该 fiber 的 disposable：依赖撤销或更换时先跑 disposer，再以新服务重跑 cb。
//   因此注入回调必须返回 disposer 清理状态订阅/连接重置监听/基线/服务引用，否则：
//     - 撤销后旧状态订阅泄漏在旧源上（外层 fiber 收尾前一直活着）；
//     - 更换后 statusDispose 非 null 挡住重建，新源永不接管，待审边沿对真实状态源失效。
//   重跑 cb 时首快照只重建基线、不响铃；新源的 pending 边沿照常通知；最终 dispose 全部摘除。
//   旧版若只登记点号名注入，回调永不触发 ⇒ 待审通知静默失效（本文件第三例钉住这条回归）。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRAGMENT_FILE = 'src/client/session-activity.js'

/** 会话状态表替身：ReadonlyMap 快照 + subscribe，发布即通知监听者。 */
function createStatusStore(entries = []) {
  const map = new Map(entries)
  const listeners = new Set()
  return {
    map,
    listeners,
    getSnapshot() {
      return map
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish() {
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * 观察者替身 ctx：按真实 Cordis inject 语义建模服务可用性与 scope——
 * 依赖齐备才执行回调（scope 同时暴露属性与 get），依赖撤销/更换先跑已收下的 disposer。
 * 这与客户端整链替身不同：后者同步调用回调、无法表达「点号服务名不存在 ⇒ 回调不触发」。
 */
function createObserverHarness({ summariesById = {} } = {}) {
  const services = new Map()
  const injectRegistrations = []
  const effectDisposers = []
  const notifications = []

  const disposeEntry = (entry) => {
    if (!entry.active) return
    entry.active = false
    const dispose = entry.dispose
    entry.dispose = null
    if (typeof dispose === 'function') dispose()
  }

  const startEntries = () => {
    for (const entry of injectRegistrations) {
      if (entry.active) continue
      if (!entry.names.every((name) => services.has(name))) continue
      entry.active = true
      const scope = { get: (name) => services.get(name) }
      for (const name of entry.names) scope[name] = services.get(name)
      const result = entry.callback(scope)
      entry.dispose = typeof result === 'function' ? result : null
    }
  }

  const reconcile = () => {
    for (const entry of injectRegistrations) {
      if (entry.active && !entry.names.every((name) => services.has(name))) disposeEntry(entry)
    }
    startEntries()
  }

  const setService = (name, service) => {
    const previous = services.get(name)
    // 同一服务名被新实例替换 = 真实运行时的 unload + reload：先拆依赖它的 fiber。
    if (previous !== undefined && previous !== service) {
      for (const entry of injectRegistrations) {
        if (entry.active && entry.names.includes(name)) disposeEntry(entry)
      }
    }
    services.set(name, service)
    reconcile()
  }

  const removeService = (name) => {
    if (!services.has(name)) return
    services.delete(name)
    reconcile()
  }

  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => ({ byId: summariesById }),
        subscribe: () => () => {},
      },
    },
    get(name) {
      return services.get(name)
    },
    inject(names, callback) {
      const entry = { names: Array.isArray(names) ? [...names] : [names], callback, active: false, dispose: null }
      injectRegistrations.push(entry)
      startEntries()
      return () => disposeEntry(entry)
    },
    on() {
      return () => {}
    },
    effect(fn, label) {
      // 与真实运行时一致：effect 工厂立即执行，返回的 disposer 才是收尾物。
      assert.equal(label, 'dsh-service: shared session observation')
      effectDisposers.push(fn())
      return () => {}
    },
  }

  /** 新版拓扑（0.2.3-alpha.1+）：uiSession 不再挂属性，状态是独立点号服务。 */
  const provideUiSession = (statusStore) => {
    setService('uiSession', {})
    setService('uiSession.sessionStatus', statusStore)
  }
  const withdrawUiSession = () => {
    removeService('uiSession.sessionStatus')
    removeService('uiSession')
  }
  /** 旧拓扑（≤0.2.2）：只有 uiSession，状态挂在它的 sessionStatus 普通属性上。 */
  const provideLegacyUiSession = (statusStore) => {
    setService('uiSession', { sessionStatus: statusStore })
  }
  const withdrawLegacyUiSession = () => {
    removeService('uiSession')
  }
  const disposeEffects = () => {
    for (const dispose of effectDisposers.splice(0).reverse()) dispose()
  }
  return { ctx, notifications, provideUiSession, withdrawUiSession, provideLegacyUiSession, withdrawLegacyUiSession, disposeEffects }
}

/** 求值分片并按依赖面创建观察者。 */
async function loadObserver(harness, { notifyState } = {}) {
  const source = await readFile(resolve(root, FRAGMENT_FILE), 'utf8')
  const factory = new vm.Script(`(${source})`, { filename: FRAGMENT_FILE }).runInNewContext({})
  const sessionActivity = { runningSessionIds: new Set() }
  factory({
    ctx: harness.ctx,
    sessionActivity,
    t: (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`),
    featureEnabled: () => true,
    featureScope: { subscribe: () => () => {} },
    notifyState: notifyState ?? { current: { enabled: true, done: true, input: true } },
    fireNotification: (title, body) => harness.notifications.push({ title, body }),
    NOTIFY_KIND_KEYS: { approval: 'notification.kind.approval', question: 'notification.kind.question' },
  })
  return sessionActivity
}

test('新版独立服务：撤销后旧订阅拆除、重新提供后接管新源并重建基线', async () => {
  const summariesById = { 'session-1': { displayTitle: '示例会话' } }
  const storeA = createStatusStore([['session-1', {}]])
  const harness = createObserverHarness({ summariesById })
  await loadObserver(harness)

  // 新拓扑：uiSession 与独立状态服务分别注册；只按点号服务名注入即命中。
  harness.provideUiSession(storeA)
  assert.equal(storeA.listeners.size, 1, '独立服务源只订阅一次（父子两条注入不重复订阅）')

  // 服务 A 撤销：注入回调返回的 disposer 被执行——旧订阅必须摘除，而不是挂在旧源上等 fiber 收尾。
  harness.withdrawUiSession()
  assert.equal(storeA.listeners.size, 0)
  assert.deepEqual(harness.notifications, [])

  // 服务 B 上线：回调重跑，接管新源；首快照只重建基线，不因 A→B 更换补响铃。
  const storeB = createStatusStore([['session-1', {}]])
  harness.provideUiSession(storeB)
  assert.equal(storeA.listeners.size, 0)
  assert.equal(storeB.listeners.size, 1)
  storeB.publish()
  assert.deepEqual(harness.notifications, [])
  harness.disposeEffects()
  assert.equal(storeB.listeners.size, 0)
})

test('新版独立服务：新源 pending 边沿触发通知，最终 dispose 摘除全部监听', async () => {
  const summariesById = { 'session-1': { displayTitle: '示例会话' } }
  const storeA = createStatusStore([['session-1', {}]])
  const harness = createObserverHarness({ summariesById })
  await loadObserver(harness)

  // 与上一例同链：A→撤销→B。旧实现里 B 永不接管，新源的待审边沿因此全部丢失。
  harness.provideUiSession(storeA)
  harness.withdrawUiSession()
  const storeB = createStatusStore([['session-1', {}]])
  harness.provideUiSession(storeB)
  assert.equal(storeA.listeners.size, 0)
  assert.equal(storeB.listeners.size, 1)
  assert.deepEqual(harness.notifications, [])

  // 新源的待审边沿照常驱动通知（重建基线后的首次 pending 变化）。
  storeB.map.set('session-1', { pendingInteraction: { kind: 'approval' } })
  storeB.publish()
  assert.equal(harness.notifications.length, 1)
  assert.equal(harness.notifications[0].title, 'notification.inputTitle')
  assert.equal(
    harness.notifications[0].body,
    `notification.inputBody:${JSON.stringify({ title: '示例会话', kind: 'notification.kind.approval' })}`,
  )

  // fiber 收尾：状态订阅随外层 effect 全部摘除。
  harness.disposeEffects()
  assert.equal(storeA.listeners.size, 0)
  assert.equal(storeB.listeners.size, 0)
})

test('旧宿主把 sessionStatus 作为 uiSession 普通属性：注入 uiSession 订阅属性源，撤销/更换时重建', async () => {
  const summariesById = { 'session-1': { displayTitle: '示例会话' } }
  const storeA = createStatusStore([['session-1', {}]])
  const harness = createObserverHarness({ summariesById })
  await loadObserver(harness)

  // 旧拓扑：点号服务名不存在，只有 uiSession；状态是它的普通属性。
  harness.provideLegacyUiSession(storeA)
  assert.equal(storeA.listeners.size, 1, 'legacy plain-property source is subscribed through uiSession')

  // 属性源的待审边沿照常通知（这条路径在新版迁移中曾整体失效）。
  storeA.map.set('session-1', { pendingInteraction: { kind: 'approval' } })
  storeA.publish()
  assert.equal(harness.notifications.length, 1)
  assert.equal(
    harness.notifications[0].body,
    `notification.inputBody:${JSON.stringify({ title: '示例会话', kind: 'notification.kind.approval' })}`,
  )

  // uiSession 撤销：注入回调的 disposer 先拆旧订阅，不能泄漏在旧属性源上。
  harness.withdrawLegacyUiSession()
  assert.equal(storeA.listeners.size, 0)

  // 旧服务重新提供（换新属性源）：接管新源并重建基线；A→B 更换不补响铃。
  const storeB = createStatusStore([['session-1', {}]])
  harness.provideLegacyUiSession(storeB)
  assert.equal(storeA.listeners.size, 0)
  assert.equal(storeB.listeners.size, 1)
  storeB.publish()
  assert.equal(harness.notifications.length, 1, 'first snapshot after re-attach only rebuilds the baseline')

  // 重建基线后的边沿仍有效。
  storeB.map.set('session-1', { pendingInteraction: { kind: 'question' } })
  storeB.publish()
  assert.equal(harness.notifications.length, 2, 'pending edges after re-baseline ring again')
  assert.equal(
    harness.notifications[1].body,
    `notification.inputBody:${JSON.stringify({ title: '示例会话', kind: 'notification.kind.question' })}`,
  )

  harness.disposeEffects()
  assert.equal(storeB.listeners.size, 0)
})
