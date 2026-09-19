import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

// 设置栏标签分片（src/client/settings-nav-tabs.js）的单元测试。
//
// 分片不是模块：它只是客户端半同一份 factory 作用域里的一段文本（见
// scripts/client-source.mjs 的清单），所以这里用 vm 把该分片**当作函数表达式求值**
// 直接拿到 createSettingsNavTabs 工厂本身，再用依赖注入驱动（ctx.slots 账本替身、
// localStorage 替身、假 DOM）。不读 client.js 产物、不依赖构建。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FRAGMENT_FILE = 'src/client/settings-nav-tabs.js'
const ORDER_KEY = 'dsh-service-settings-nav-order'
const HIDDEN_KEY = 'dsh-service-settings-nav-hidden'

function createStorageMock(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

/**
 * ctx.slots 账本替身：原生 SlotCore 语义 + 可选私有 `_core`（调用记录）。
 * withCore:false 建模旧宿主；hostileCore:true 建模宿主重构后 `_core.record` 抛错。
 */
function createSlotsStub({ sections = [], withCore = true, hostileCore = false } = {}) {
  const records = new Map()
  const calls = { markDirty: 0, flush: 0, registered: [], disposed: [] }
  const entryFor = (key) => {
    let entry = records.get(key)
    if (!entry) {
      entry = { key, listeners: new Set() }
      records.set(key, entry)
    }
    return entry
  }
  const coreRecord = (key) => {
    if (hostileCore) throw new Error('slot core internals changed')
    return entryFor(key)
  }
  const nativeSubscribe = (key, fn) => {
    const entry = entryFor(key)
    entry.listeners.add(fn)
    return () => entry.listeners.delete(fn)
  }
  const slots = {
    entries: (key) => (key === 'settings.section' ? sections.slice() : []),
    getVersion: () => 0,
    subscribe: (key, fn) => nativeSubscribe(key, fn),
    register(options, component) {
      calls.registered.push(options)
      const entry = { options, component }
      sections.push(entry)
      return () => {
        calls.disposed.push(options)
        const index = sections.indexOf(entry)
        if (index !== -1) sections.splice(index, 1)
      }
    },
  }
  if (withCore) {
    slots._core = {
      record: coreRecord,
      markDirty: () => { calls.markDirty += 1 },
      flush: () => { calls.flush += 1 },
    }
  }
  return {
    slots,
    calls,
    sections,
    nativeCount: (key) => entryFor(key).listeners.size,
    nativeSubscribe,
  }
}

/** 求值分片并以其依赖面调用工厂。syncNavDom 由分片裸赋值挂到 vm 沙箱（即工厂作用域外）。 */
async function loadNavTabs({ storage = createStorageMock(), slotsStub = createSlotsStub(), document, rpcCall } = {}) {
  const source = await readFile(resolve(root, FRAGMENT_FILE), 'utf8')
  const sandbox = { localStorage: storage }
  if (document !== undefined) sandbox.document = document
  const factory = new vm.Script(`(${source})`, { filename: FRAGMENT_FILE }).runInContext(vm.createContext(sandbox))

  const effects = []
  const rpcCalls = []
  const api = factory({
    ctx: {
      effect(fn) {
        effects.push(fn)
        return () => {}
      },
      slots: slotsStub.slots,
    },
    rpcCall: (...args) => {
      rpcCalls.push(args)
      return rpcCall ? rpcCall(...args) : Promise.resolve({ ok: false, error: 'unused' })
    },
  })
  return {
    api,
    storage,
    slotsStub,
    rpcCalls,
    syncNavDom: () => sandbox.syncNavDom(),
    /** 跑 ctx.effect 的 disposer（插件卸载路径）。 */
    disposeFactory() {
      while (effects.length > 0) {
        const dispose = effects.shift()()
        if (typeof dispose === 'function') dispose()
      }
    },
  }
}

// ─── 通知与退订残留 ─────────────────────────────────────────────────────────

test('native listeners are woken from a per-round snapshot and never retained after they unsubscribe', async () => {
  const slotsStub = createSlotsStub()
  const calls = []
  const early = () => calls.push('early')
  // 先于插件加载的常驻订阅者（外壳 useSections 一类）：只存在于原生账本。
  const disposeEarly = slotsStub.nativeSubscribe('settings.section', early)

  const { api } = await loadNavTabs({ slotsStub })
  api.notifyNavOrderChanged()
  assert.deepEqual(calls, ['early'], 'early native listeners must still be woken (realtime path kept)')
  // 关键回归：复制进长期集合的回调没有 disposer，原生退订后仍滞留到插件卸载。
  assert.equal(api.navOrderListeners.size, 0, 'native listeners must never be copied into navOrderListeners')

  disposeEarly()
  calls.length = 0
  api.notifyNavOrderChanged()
  api.notifyNavOrderChanged()
  assert.deepEqual(calls, [], 'an unsubscribed early listener must not be called again')
  assert.equal(api.navOrderListeners.size, 0)
})

test('a subscription cancelled earlier in the same round is not resurrected by that round snapshot', async () => {
  const slotsStub = createSlotsStub()
  const calls = []
  let disposeSecond = () => {}
  slotsStub.nativeSubscribe('settings.section', () => {
    calls.push('first')
    disposeSecond() // 同一轮里前面的回调注销后面的订阅
  })
  disposeSecond = slotsStub.nativeSubscribe('settings.section', () => calls.push('second'))

  const { api } = await loadNavTabs({ slotsStub })
  api.notifyNavOrderChanged()
  assert.deepEqual(calls, ['first'], 'a subscription cancelled mid-round must not be invoked later in the same round')
})

test('wrapped subscriptions dedupe per round, dispose idempotently, and zero out on factory disposal', async () => {
  const slotsStub = createSlotsStub()
  const wrapped = slotsStub.slots.entries
  const { api, disposeFactory } = await loadNavTabs({ slotsStub })
  const ctx = { slots: slotsStub.slots }
  assert.notEqual(slotsStub.slots.entries, wrapped, 'entries must be wrapped while mounted')

  let notified = 0
  const listener = () => { notified += 1 }
  const dispose = ctx.slots.subscribe('settings.section', listener)
  assert.equal(typeof dispose, 'function', 'wrapped subscribe must return a disposer')
  assert.equal(slotsStub.nativeCount('settings.section'), 1, 'wrapped subscribe must forward to the native ledger')
  assert.equal(api.navOrderListeners.has(listener), true)

  api.notifyNavOrderChanged()
  assert.equal(notified, 1, 'each subscription is notified exactly once per round (dedupe)')

  dispose()
  dispose() // 幂等：重复调用不得再摘一次或抛错
  assert.equal(slotsStub.nativeCount('settings.section'), 0, 'disposer must release the native subscription')
  assert.equal(api.navOrderListeners.has(listener), false)

  ctx.slots.subscribe('settings.section', () => {})
  disposeFactory()
  assert.equal(slotsStub.nativeCount('settings.section'), 0, 'forwarded native subscriptions must all be released')
  assert.equal(api.navOrderListeners.size, 0, 'no listener may survive factory disposal')
  // 包装已还原：卸载后的通知不再直呼任何被接管的回调，公开哨兵仍成对建/销（不堆条目）。
  const registeredBefore = slotsStub.calls.registered.length
  api.notifyNavOrderChanged()
  assert.equal(slotsStub.calls.registered.length, registeredBefore + 1)
  assert.equal(slotsStub.calls.disposed.length, registeredBefore + 1, 'the sentinel must be disposed in the same round')
  assert.equal(slotsStub.nativeCount('settings.section'), 0, 'the sentinel must not linger in the native ledger')
})

test('a host without usable private _core falls back to the public path without throwing', async () => {
  for (const options of [{ withCore: false }, { hostileCore: true }]) {
    const slotsStub = createSlotsStub(options)
    const { api } = await loadNavTabs({ slotsStub })
    let notified = 0
    slotsStub.slots.subscribe('settings.section', () => { notified += 1 })

    assert.doesNotThrow(() => api.notifyNavOrderChanged())
    assert.equal(notified, 1, 'wrapped subscribers must be notified without a usable _core')
    // 公开兜底哨兵：注册后立即注销，不残留在 entries 里。
    assert.deepEqual(slotsStub.calls.registered.map((o) => o.id), ['__dsh_nav_bump__'])
    assert.deepEqual(slotsStub.calls.disposed.map((o) => o.id), ['__dsh_nav_bump__'])
    assert.equal(slotsStub.nativeCount('settings.section'), 1, 'only the wrapped subscription remains')
  }
})

// ─── syncNavDom：DOM 归属识别 ───────────────────────────────────────────────

function createButton({ text = '', attrs = [] } = {}) {
  const map = new Map(attrs)
  return {
    textContent: text,
    style: { display: '', order: '' },
    getAttribute: (name) => (map.has(name) ? map.get(name) : null),
    setAttribute: (name, value) => map.set(name, String(value)),
    hasAttribute: (name) => map.has(name),
    removeAttribute: (name) => map.delete(name),
    querySelector(selector) {
      return selector === 'span' ? { textContent: this.textContent } : null
    },
  }
}

/** navList 可选；children 可缺省，建模老宿主的 nav。 */
function createNav(buttons, { navList = null, children } = {}) {
  return {
    querySelectorAll: (selector) => (selector === 'button' ? buttons : []),
    querySelector: (selector) => (selector === '[class*="navList"]' ? navList : null),
    children,
  }
}

const createDocument = (nav) => ({
  body: {},
  querySelector: (selector) => (selector === '[role="dialog"] nav' ? nav : null),
})

const baseSections = () => [
  { options: { id: 'general', order: 0, label: () => '通用' }, component: () => null },
  { options: { id: 'models', order: 10, label: '模型' }, component: () => null },
  { options: { id: 'plugins', order: 30, label: () => '插件' }, component: () => null },
  { options: { id: 'dsh-service', order: 99, label: () => '服务控制' }, component: () => null },
]

test('syncNavDom re-identifies each button by its current label, ignoring its own stale marker', async () => {
  const storage = createStorageMock({
    [ORDER_KEY]: JSON.stringify(['models', 'general']),
    [HIDDEN_KEY]: JSON.stringify(['plugins']),
  })
  // 行被复用：文案已是「模型」，却还带着上一行的 plugins 标记（该 id 也仍在 raw 账本里）。
  const reused = createButton({ text: '模型', attrs: [['data-dsh-section-id', 'plugins']] })
  const nav = createNav([reused], { children: [{}, {}] })
  const { syncNavDom } = await loadNavTabs({
    storage,
    slotsStub: createSlotsStub({ sections: baseSections() }),
    document: createDocument(nav),
  })

  syncNavDom()
  assert.equal(reused.getAttribute('data-dsh-section-id'), 'models', 'the current label wins over the stale marker')
  assert.equal(reused.style.display, '', 'a reused row must not inherit the hidden state of its former section')
  assert.equal(reused.style.order, '0', 'order must follow the current section index (models is first)')
})

test('an unmappable row (stale marker or bare plugin marker) is cleaned, and an old nav without children is safe', async () => {
  const unknown = createButton({ text: '别人的行', attrs: [['data-dsh-section-id', 'plugins']] })
  const bare = createButton({ text: '也是别人的行', attrs: [['data-dsh-service-nav', '']] })
  const nav = createNav([unknown, bare], { children: undefined })
  const { syncNavDom } = await loadNavTabs({
    storage: createStorageMock({ [HIDDEN_KEY]: JSON.stringify(['plugins']) }),
    slotsStub: createSlotsStub({ sections: baseSections() }),
    document: createDocument(nav),
  })

  unknown.style.display = 'none'
  unknown.style.order = '3'
  assert.doesNotThrow(() => syncNavDom(), 'an old nav without children must not break the list lookup')

  for (const button of [unknown, bare]) {
    assert.equal(button.hasAttribute('data-dsh-section-id'), false, 'an unmappable row must lose its stale marker')
    assert.equal(button.style.display, '', 'inline display must be reset on an unmappable row')
    assert.equal(button.style.order, '', 'inline order must be reset on an unmappable row')
  }
})

test('syncNavDom resolves plugin sections by their current label, follows renames, and never hides dsh-service', async () => {
  const sections = baseSections()
  const models = createButton({ text: '模型' })
  const service = createButton({ text: '服务控制' })
  const hiddenPlugins = createButton({ text: '插件' })
  const nav = createNav([models, service, hiddenPlugins], { children: [{}, { style: {} }] })
  const { syncNavDom } = await loadNavTabs({
    storage: createStorageMock({
      [ORDER_KEY]: JSON.stringify(['plugins', 'dsh-service']),
      [HIDDEN_KEY]: JSON.stringify(['plugins', 'dsh-service']),
    }),
    slotsStub: createSlotsStub({ sections }),
    document: createDocument(nav),
  })

  syncNavDom()
  assert.equal(models.getAttribute('data-dsh-section-id'), 'models')
  assert.equal(models.style.order, '9999', 'a section outside the custom order keeps its tail weight')
  assert.equal(service.getAttribute('data-dsh-section-id'), 'dsh-service')
  assert.equal(service.style.order, '1')
  assert.equal(service.style.display, '', 'dsh-service is permanently locked visible')
  assert.equal(hiddenPlugins.style.display, 'none', 'a listed section must be hidden')

  // 标签原地改名：仍按当前账本标签命中同一 id，不依赖历史标记。
  sections[1].options.label = '模型设置'
  models.textContent = '模型设置'
  models.removeAttribute('data-dsh-section-id')
  syncNavDom()
  assert.equal(models.getAttribute('data-dsh-section-id'), 'models', 'renamed row must still map to its section')
  assert.equal(models.style.order, '9999')
})
