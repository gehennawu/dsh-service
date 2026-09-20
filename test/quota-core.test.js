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
  assert.equal(effects[0].label, 'dsh-service quota snapshot disposal')
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

test('quotaExtractBalance extracts amount, currency, symbol and window for balance-only providers', async () => {
  const { api } = await loadQuotaCore()
  // DeepSeek CNY
  const dsWindows = [
    { id: 'balance-cny', text: '¥35.50', label: 'CNY', kindKey: 'balance' },
    { id: 'granted-cny', text: '¥10.00', label: 'CNY', kindKey: 'granted-balance' },
  ]
  const ds = api.quotaExtractBalance(dsWindows)
  assert.equal(ds.amount, 35.5)
  assert.equal(ds.currency, 'CNY')
  assert.equal(ds.symbol, '¥')
  assert.equal(ds.rawText, '¥35.50')
  assert.equal(ds.window.id, 'balance-cny')

  // USD
  const usdWindows = [{ id: 'balance', text: '$12.80', kindKey: 'balance' }]
  const usd = api.quotaExtractBalance(usdWindows)
  assert.equal(usd.amount, 12.8)
  assert.equal(usd.currency, 'USD')
  assert.equal(usd.symbol, '$')

  // Empty or invalid
  assert.equal(api.quotaExtractBalance([]), null)
  assert.equal(api.quotaExtractBalance(null), null)
  assert.equal(api.quotaExtractBalance([{ id: 'percent-only', percent: 50 }]), null)
})

test('resolveBalanceBaseline applies floor, detects recharge, and persists in localStorage', async () => {
  const storage = createStorageMock()
  const { api } = await loadQuotaCore({ storage })

  // 首次进入：余额 ¥7.38，保底 ¥20.00
  const b1 = api.resolveBalanceBaseline('deepseek-official', 7.38, 'CNY')
  assert.equal(b1, 20)
  const snap1 = JSON.parse(storage.getItem('dsh-service-quota-balance-baseline'))
  assert.equal(snap1['deepseek-official'].baseline, 20)
  assert.equal(snap1['deepseek-official'].lastBalance, 7.38)

  // 正常消耗：余额降到 ¥5.00，基准保持 ¥20.00
  const b2 = api.resolveBalanceBaseline('deepseek-official', 5.00, 'CNY')
  assert.equal(b2, 20)

  // 充值：余额充到 ¥50.00（> 基准 20），基准自动上调为 ¥50.00
  const b3 = api.resolveBalanceBaseline('deepseek-official', 50.00, 'CNY')
  assert.equal(b3, 50)
  const snap3 = JSON.parse(storage.getItem('dsh-service-quota-balance-baseline'))
  assert.equal(snap3['deepseek-official'].baseline, 50)
  assert.equal(snap3['deepseek-official'].lastBalance, 50)

  // 手动标定：用户点击设当前为满额（例如当前 ¥35.00）
  const bManual = api.setManualBalanceBaseline('deepseek-official', 35.00, 'CNY')
  assert.equal(bManual, 35)
  const snapManual = JSON.parse(storage.getItem('dsh-service-quota-balance-baseline'))
  assert.equal(snapManual['deepseek-official'].baseline, 35)
})

test('computeBalanceGaugeState derives ratio, gear, needleAngle and safety floors', async () => {
  const { api } = await loadQuotaCore()

  // 满额（100%）：gear high, needle +90°
  const full = api.computeBalanceGaugeState(50, 50, 'CNY')
  assert.equal(full.ratio, 100)
  assert.equal(full.gear, 'high')
  assert.equal(full.needleAngle, 90)

  // 半箱（40%）：gear mid, needle -18°
  const mid = api.computeBalanceGaugeState(20, 50, 'CNY')
  assert.equal(mid.ratio, 40)
  assert.equal(mid.gear, 'mid')
  assert.equal(mid.needleAngle, -18)

  // 见底（10%）：gear low, needle -72°
  const low = api.computeBalanceGaugeState(5, 50, 'CNY')
  assert.equal(low.ratio, 10)
  assert.equal(low.gear, 'low')

  // 绝对值极低护栏（余额 <= 2 CNY）：强制 low 报警
  const extremeLow = api.computeBalanceGaugeState(1.5, 30, 'CNY')
  assert.equal(extremeLow.gear, 'low')

  // 绝对值充裕护栏（余额 >= 50 CNY）：即使比例 < 20% 也不亮红灯，保持 mid
  const comfortable = api.computeBalanceGaugeState(60, 500, 'CNY')
  assert.equal(comfortable.ratio, 12)
  assert.equal(comfortable.gear, 'mid')
})
