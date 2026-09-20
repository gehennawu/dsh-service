import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// 会话活跃观察分片（src/client/session-activity.js）中「uiSession 注入生命周期」的单元测试。
//
// 分片不是模块：无 import/export，是客户端半 factory 作用域里的连续切片（见 scripts/client-source.mjs），
// 所以用 vm 把该分片当函数表达式求值（`(` + 文本 + `)`）直接拿到工厂本身。本文件独立于
// test/client.test.js 的整链 renderer harness，只构造状态观察路径需要的最小面。
//
// 覆盖的契约（Cordis 语义，0.1.6-alpha.2 @deepseek-ai/cordis 源码核实）：
//   ctx.inject(['uiSession'], cb) = 以 cb 为 apply 启动子 fiber——服务可用即执行，cb 返回的
//   函数被收为该 fiber 的 disposable：uiSession 撤销或更换时先跑 disposer，再以新服务重跑 cb。
//   因此注入回调必须返回 disposer 清理状态订阅/连接重置监听/基线/服务引用，否则：
//     - 撤销后旧 sessionStatus 订阅泄漏在旧源上（外层 fiber 收尾前一直活着）；
//     - 更换后 statusDispose 非 null 挡住重建，新源永不接管，待审边沿对真实状态源失效。
//   重跑 cb 时首快照只重建基线、不响铃；新源的 pending 边沿照常通知；最终 dispose 全部摘除。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRAGMENT_FILE = 'src/client/session-activity.js'

/** uiSession.sessionStatus 替身：ReadonlyMap 快照 + subscribe，发布即通知监听者。 */
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
 * 观察者替身 ctx：按真实 Cordis inject 语义建模 provide/withdraw——
 * provide 以 `{ uiSession: service }` 为子 scope 执行回调并收下返回的 disposer；
 * withdraw 先执行已收下的 disposer（服务更换 = unload + reload 的 unload 半程）。
 */
function createObserverHarness({ summariesById = {} } = {}) {
  const services = new Map()
  const injectRegistrations = []
  const effectDisposers = []
  const notifications = []
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
      return () => {}
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
  const provideUiSession = (service) => {
    services.set('uiSession', service)
    for (const entry of injectRegistrations) {
      if (entry.active || !entry.names.includes('uiSession')) continue
      entry.active = true
      const result = entry.callback({ uiSession: service })
      entry.dispose = typeof result === 'function' ? result : null
    }
  }
  const withdrawUiSession = () => {
    services.delete('uiSession')
    for (const entry of injectRegistrations) {
      if (!entry.active) continue
      entry.active = false
      const dispose = entry.dispose
      entry.dispose = null
      if (dispose) dispose()
    }
  }
  const disposeEffects = () => {
    for (const dispose of effectDisposers.splice(0).reverse()) dispose()
  }
  return { ctx, notifications, provideUiSession, withdrawUiSession, disposeEffects }
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

test('uiSession 撤销后旧订阅拆除、重新提供后接管新源并重建基线', async () => {
  const summariesById = { 'session-1': { displayTitle: '示例会话' } }
  const storeA = createStatusStore([['session-1', {}]])
  const harness = createObserverHarness({ summariesById })
  await loadObserver(harness)

  // 服务 A 可用：注入回调执行，订阅 A 的状态源。
  harness.provideUiSession({ sessionStatus: storeA })
  assert.equal(storeA.listeners.size, 1)

  // A 撤销：注入回调返回的 disposer 被执行——旧订阅必须摘除，而不是挂在旧源上等 fiber 收尾。
  harness.withdrawUiSession()
  assert.equal(storeA.listeners.size, 0)
  assert.deepEqual(harness.notifications, [])

  // 服务 B 上线：回调重跑，接管新源；首快照只重建基线，不因 A→B 更换补响铃。
  const storeB = createStatusStore([['session-1', {}]])
  harness.provideUiSession({ sessionStatus: storeB })
  assert.equal(storeA.listeners.size, 0)
  assert.equal(storeB.listeners.size, 1)
  storeB.publish()
  assert.deepEqual(harness.notifications, [])
  harness.disposeEffects()
  assert.equal(storeB.listeners.size, 0)
})

test('新源 pending 边沿触发通知，最终 dispose 摘除全部监听', async () => {
  const summariesById = { 'session-1': { displayTitle: '示例会话' } }
  const storeA = createStatusStore([['session-1', {}]])
  const harness = createObserverHarness({ summariesById })
  await loadObserver(harness)

  // 与上一例同链：A→撤销→B。旧实现里 B 永不接管，新源的待审边沿因此全部丢失。
  harness.provideUiSession({ sessionStatus: storeA })
  harness.withdrawUiSession()
  const storeB = createStatusStore([['session-1', {}]])
  harness.provideUiSession({ sessionStatus: storeB })
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
