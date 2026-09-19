import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// 额度核心分片（src/client/quota-core.js）中「卡片配置写入协议」的单元测试。
//
// 分片不是模块：它没有自己的 import/export，只是客户端半同一份 factory 作用域里的一段文本
// （见 scripts/client-source.mjs 的清单）。所以这里用 vm 把该分片**当作函数表达式求值**
// （`(` + 文本 + `)`）直接拿到 createQuotaCore 工厂本身，再靠依赖注入驱动：
// createSectionBackendSync 替身、ctx.effect 桩、browser storage 替身。
// 不读 client.js 产物、不依赖构建；分片被搬走/改名时这里先红。
//
// 覆盖的契约（apply.js 的 RemoteQuotaCard 只消费这四项）：
//   commitQuotaCards / resetQuotaCards 先落 localStorage 再通知监听者，最后才推后端；
//   subscribeQuotaCards 的 disposer 摘掉自己的监听；ensureQuotaCardsSynced 委托后端；
//   后端 writeLocal（远端权威值落本地）只落本地 + 通知，不反向重推；
//   返回值不暴露监听器集合、原始写入函数或后端对象；配置操作经后端适配器同步。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const QUOTA_CORE_FILE = 'src/client/quota-core.js'

const ORDER_KEY = 'dsh-service-quota-card-order'
const HIDDEN_KEY = 'dsh-service-quota-card-hidden'

/** browser storage 替身：只实现分片用到的最小面，snapshot 便于整表断言。 */
function createStorageMock(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    snapshot() {
      return Object.fromEntries(map)
    },
  }
}

/** createSectionBackendSync 替身：记录 persist / persistReset / ensureSynced 的调用与次序。 */
function createBackendSpy({ onCall } = {}) {
  const calls = []
  const record = (entry) => {
    calls.push(entry)
    if (typeof onCall === 'function') onCall(entry)
  }
  return {
    calls,
    persist(order, hidden) { record({ op: 'persist', order, hidden }) },
    persistReset() { record({ op: 'persistReset' }) },
    ensureSynced() { record({ op: 'ensureSynced' }) },
  }
}

/**
 * 求值额度核心分片并以其依赖面调用工厂。
 * 返回公开接口、storage 替身、后端替身、RPC 调用记录、ctx.effect 注册记录与后端工厂入参。
 */
async function loadQuotaCore({ storage = createStorageMock(), rpcCall = async () => ({ ok: true }), backend = createBackendSpy(), backendFactory, ctx } = {}) {
  const source = await readFile(resolve(root, QUOTA_CORE_FILE), 'utf8')
  const context = vm.createContext({ localStorage: storage, React: { useState() {}, useEffect() {} } })
  const factory = new vm.Script(`(${source})`, { filename: QUOTA_CORE_FILE }).runInContext(context)

  const rpcCalls = []
  const effects = []
  const backendOptions = []
  const effectiveCtx = ctx ?? {
    effect(fn, label) {
      effects.push({ fn, label })
      return () => {}
    },
    timer: { timeout() { return () => {} } },
  }
  const effectiveBackendFactory = backendFactory ?? ((options) => {
    backendOptions.push(options)
    return backend
  })

  const api = factory({
    ctx: effectiveCtx,
    rpcCall: (...args) => { rpcCalls.push(args); return rpcCall(...args) },
    featureEnabled: () => true,
    getModelDirectories: () => undefined,
    sessionActivity: { runningSessionIds: [] },
    createSectionBackendSync: effectiveBackendFactory,
    SETTINGS_NAV_MAX_ITEMS: 64,
    formatCompactCount: (value) => String(value),
  })

  return { api, storage, backend, rpcCalls, effects, backendOptions }
}

test('quota core fragment loads without RPC and wires exactly one disposal effect', async () => {
  const { api, backend, rpcCalls, effects, backendOptions } = await loadQuotaCore()

  // 无「立即 RPC」预期：加载时既不拉也不推，后端同步留给调用方显式 ensure。
  assert.deepEqual(rpcCalls, [])
  assert.deepEqual(backend.calls, [])
  // 卡片配置的后端同步按 section 名建立一次，且沿用设置栏那份实现。
  assert.equal(backendOptions.length, 1)
  assert.equal(backendOptions[0].section, 'quotaCards')
  assert.equal(typeof backendOptions[0].readOrder, 'function')
  assert.equal(typeof backendOptions[0].readHidden, 'function')
  assert.equal(typeof backendOptions[0].writeLocal, 'function')

  // ctx.effect 的注册与销毁都要能被 Fiber 生命周期复用。
  assert.equal(effects.length, 1)
  assert.equal(effects[0].label, 'dsh-service quota poller disposal')
  const dispose = effects[0].fn()
  assert.equal(typeof dispose, 'function')
  dispose()
})

test('commitQuotaCards writes both storage keys before notifying, then persists', async () => {
  const sequence = []
  const backend = createBackendSpy({ onCall: (entry) => sequence.push({ step: entry.op }) })
  const storage = createStorageMock()
  const { api, rpcCalls } = await loadQuotaCore({ storage, backend })
  api.subscribeQuotaCards(() => sequence.push({ step: 'notify', storage: storage.snapshot() }))

  api.commitQuotaCards(['alpha', 'beta'], ['beta'])

  // 次序即契约：监听者被叫到时两个键都已落盘，后端 persist 在通知之后。
  assert.deepEqual(sequence, [
    { step: 'notify', storage: { [ORDER_KEY]: '["alpha","beta"]', [HIDDEN_KEY]: '["beta"]' } },
    { step: 'persist' },
  ])
  assert.deepEqual(storage.snapshot(), { [ORDER_KEY]: '["alpha","beta"]', [HIDDEN_KEY]: '["beta"]' })
  assert.deepEqual(backend.calls, [{ op: 'persist', order: ['alpha', 'beta'], hidden: ['beta'] }])
  // 写后端由 createSectionBackendSync 负责：核心自身不发 RPC。
  assert.deepEqual(rpcCalls, [])
})

test('commitQuotaCards drops the hidden key when nothing is hidden', async () => {
  const storage = createStorageMock({ [ORDER_KEY]: '["old"]', [HIDDEN_KEY]: '["old"]' })
  const { api } = await loadQuotaCore({ storage })

  api.commitQuotaCards(['alpha'], [])

  assert.deepEqual(storage.snapshot(), { [ORDER_KEY]: '["alpha"]' })
})

test('resetQuotaCards removes both keys before notifying, then persists a reset', async () => {
  const sequence = []
  const backend = createBackendSpy({ onCall: (entry) => sequence.push({ step: entry.op }) })
  const storage = createStorageMock({ [ORDER_KEY]: '["alpha"]', [HIDDEN_KEY]: '["alpha"]' })
  const { api, rpcCalls } = await loadQuotaCore({ storage, backend })
  api.subscribeQuotaCards(() => sequence.push({ step: 'notify', storage: storage.snapshot() }))

  api.resetQuotaCards()

  assert.deepEqual(sequence, [{ step: 'notify', storage: {} }, { step: 'persistReset' }])
  assert.deepEqual(storage.snapshot(), {})
  assert.deepEqual(backend.calls, [{ op: 'persistReset' }])
  // 重置同样只走后端同步，不发 RPC、也不触发一轮 persist。
  assert.deepEqual(rpcCalls, [])
})

test('subscribeQuotaCards disposer removes only its own listener', async () => {
  const first = []
  const second = []
  const { api } = await loadQuotaCore()
  const dispose = api.subscribeQuotaCards(() => first.push(1))
  api.subscribeQuotaCards(() => second.push(1))

  api.commitQuotaCards(['alpha'], ['beta'])
  assert.deepEqual([first.length, second.length], [1, 1])

  dispose()
  api.commitQuotaCards(['gamma'], ['delta'])
  // disposer 之后本人不再收到回调，另一个监听者照常。
  assert.deepEqual([first.length, second.length], [1, 2])
})

test('ensureQuotaCardsSynced delegates to the backend on every call', async () => {
  const { api, backend } = await loadQuotaCore()

  api.ensureQuotaCardsSynced()
  api.ensureQuotaCardsSynced()

  // 幂等判断在 createSectionBackendSync 内：核心每次都如实委托。
  assert.deepEqual(backend.calls, [{ op: 'ensureSynced' }, { op: 'ensureSynced' }])
})

test('backend writeLocal applies remote values locally and never re-persists', async () => {
  const backend = createBackendSpy()
  const storage = createStorageMock()
  const { api, backendOptions } = await loadQuotaCore({ storage, backend })
  const seen = []
  api.subscribeQuotaCards(() => seen.push(storage.snapshot()))

  const options = backendOptions[0]
  options.writeLocal(['remote'], ['remote'])

  // 远端权威值落本地后要通知在看的组件，但不得回环重推（重推归 pushPending 路径）。
  assert.deepEqual(seen, [{ [ORDER_KEY]: '["remote"]', [HIDDEN_KEY]: '["remote"]' }])
  assert.deepEqual(storage.snapshot(), { [ORDER_KEY]: '["remote"]', [HIDDEN_KEY]: '["remote"]' })
  assert.deepEqual(backend.calls, [])
  // readOrder / readHidden 与本地落盘结果一致，后端在 pushLocal 时读到同一份事实。
  assert.equal(JSON.stringify(options.readOrder()), '["remote"]')
  assert.equal(JSON.stringify(options.readHidden()), '["remote"]')
})

test('returned interface exposes the card API without raw listeners, writers or backend', async () => {
  const { api } = await loadQuotaCore()

  for (const name of ['subscribeQuotaCards', 'commitQuotaCards', 'resetQuotaCards', 'ensureQuotaCardsSynced']) {
    assert.equal(typeof api[name], 'function', `${name} must be part of the public card API`)
  }
  for (const name of ['quotaCardListeners', 'notifyQuotaCardsChanged', 'writeQuotaCardOrder', 'writeQuotaCardHidden', 'readQuotaCardNameList', 'quotaCardsBackend', 'createSectionBackendSync']) {
    assert.equal(name in api, false, `${name} must stay private to the fragment`)
  }
})
