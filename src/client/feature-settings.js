// 客户端半分片：特性设置门面（跨 DSH 版本的能力自适应适配层）。
//
// 背景（0.1.7-alpha.1 调研）：0.1.6 及更早的客户端设置面是 `ctx.settingsScope`
// （`bind({namespace})` → 同名快照 + 写入队列）；0.1.7-alpha.1 移除该服务，改为
// `ctx.configForms`（`get(entryId)` → ConfigForm）。两者快照字段形状恰好一致
// （status/value/base/user/revision/writable/mode），但**服务名不同**，而 Cordis
// Context Proxy 会直接抛 `cannot get property without inject`——静态 inject 任一方都会
// 在另一版本上阻断整个客户端激活。
//
// 本分片是全插件唯一的设置服务收口：静态 inject 一律不带设置服务，运行时按
// 「能力探测」级联选择（configForms → settingsScope → 内存兜底），并在服务晚到时
// 通过 ctx.inject 平滑升级。消费方只面对 getSnapshot/subscribe/set/unset，
// 不感知运行时差异。
//
// 与旧 apply 内联实现逐字等价的三件事：快照 `value` 不含默认值（消费方继续用
// Object.assign({}, DEFAULT_FEATURES, value) 合并）、`subscribe` 返回 disposer、
// `set/unset` 返回 Promise。

/** 门面快照字段归一：两代服务的快照形状相同，这里只做缺字段防御，不改语义。 */
function normalizeFeatureSnapshot(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const status = source.status === 'ready' || source.status === 'loading' || source.status === 'unavailable' ? source.status : 'unavailable'
  return {
    status,
    value: source.value !== undefined && source.value !== null && typeof source.value === 'object' ? source.value : undefined,
    base: source.base,
    user: source.user,
    revision: source.revision,
    writable: source.writable === true,
    mode: source.mode === 'host' ? 'host' : 'memory',
  }
}

/**
 * 探测一个候选设置服务的 `bind`/`get` 面，包成门面统一接口；形状不符返回 null。
 * @param {object} service 已解析的服务实例（configForms 或 settingsScope）
 * @param {string} namespace 特性设置命名空间 / Host 插件 entry id
 */
function featureBindingFrom(service, namespace) {
  if (service === null || typeof service !== 'object') return null
  let scope
  try {
    if (typeof service.get === 'function') scope = service.get(namespace)
    else if (typeof service.bind === 'function') scope = service.bind({ namespace })
  } catch (_) {
    return null
  }
  if (scope === null || typeof scope !== 'object') return null
  if (typeof scope.getSnapshot !== 'function' || typeof scope.subscribe !== 'function') return null
  return scope
}

/**
 * 建立特性设置门面。
 *
 * 探测顺序与理由：`configForms`（0.1.7+，新版配置面）→ `settingsScope`（0.1.5~0.1.6）。
 * 两者皆无（宿主引导竞态或测试替身）时回退内存状态机，并注册服务就绪回调平滑升级。
 * 探测一律走 `ctx.get`（缺服务返回 undefined，不触发 Proxy 抛错）。
 *
 * @param {{ ctx: object, namespace: string, defaults: object, React: object }} options
 * @returns {{ featureScope: object, featureSnapshot: Function, featureValue: Function, featureEnabled: Function, useFeatures: Function }}
 */
function createFeatureSettings({ ctx, namespace, defaults, React }) {
  const listeners = new Set()
  // 内存兜底快照：writable=false（没有持久化面就不给出会骗人的开关），值仍可本地更新，
  // 保证 getSnapshot/set 读写一致、绝不抛非受控异常。
  const memorySnapshot = () => normalizeFeatureSnapshot({ status: 'ready', value: memoryValue(), revision: 0, writable: false, mode: 'memory' })
  let memoryState = Object.assign({}, defaults)
  const memoryValue = () => Object.assign({}, memoryState)
  let snapshot = memorySnapshot()
  let binding = null
  let releaseBinding = null
  let disposed = false

  const publish = (next) => {
    snapshot = next
    for (const listener of [...listeners]) {
      try { listener() } catch (_) {}
    }
  }

  const readFromBinding = () => {
    if (binding === null) return memorySnapshot()
    try {
      return normalizeFeatureSnapshot(binding.getSnapshot())
    } catch (_) {
      return memorySnapshot()
    }
  }

  const syncFromBinding = () => {
    if (disposed) return
    publish(readFromBinding())
  }

  // 当前接入的服务类型：'configForms' | 'settingsScope' | 'memory'（测试与排障直视）。
  let kind = 'memory'

  /** 切到某个服务绑定（service 为 null 表示回到内存兜底，serviceName 记来源）。 */
  const adopt = (serviceName, service) => {
    if (disposed) return
    if (releaseBinding !== null) {
      try { releaseBinding() } catch (_) {}
      releaseBinding = null
    }
    binding = service === null || service === undefined ? null : featureBindingFrom(service, namespace)
    kind = binding === null ? 'memory' : serviceName
    if (binding === null) {
      publish(memorySnapshot())
      return
    }
    if (typeof binding.subscribe === 'function') {
      try { releaseBinding = binding.subscribe(syncFromBinding) } catch (_) { releaseBinding = null }
    }
    syncFromBinding()
  }

  /** 由一个已解析的服务实例决定服务名；形状不符返回 undefined。 */
  const serviceNameFor = (name, service) => {
    if (service === null || service === undefined) return undefined
    if (name === 'configForms') return typeof service.get === 'function' ? name : undefined
    if (name === 'settingsScope') return typeof service.bind === 'function' ? name : undefined
    return undefined
  }

  /** 当前可用服务探测：configForms 优先（新版），其次 settingsScope。 */
  const detect = () => {
    for (const name of ['configForms', 'settingsScope']) {
      let service
      try { service = typeof ctx.get === 'function' ? ctx.get(name) : undefined } catch (_) { service = undefined }
      if (serviceNameFor(name, service) !== undefined) return { name, service }
    }
    return undefined
  }

  const detected = detect()
  if (detected !== undefined) adopt(detected.name, detected.service)

  // 动态就绪：任一设置服务晚于本插件出现时平滑接入。configForms 出现会接管
  // settingsScope（新版优先）；反向不覆盖，避免老宿主上被空探测打回内存兜底。
  for (const serviceName of ['configForms', 'settingsScope']) {
    if (typeof ctx.inject !== 'function') break
    try {
      ctx.inject([serviceName], (scope) => {
        if (disposed) return
        const service = scope !== null && typeof scope === 'object' ? scope[serviceName] : undefined
        if (serviceNameFor(serviceName, service) === undefined) return
        if (serviceName === 'settingsScope' && kind === 'configForms') return
        adopt(serviceName, service)
      })
    } catch (_) {}
  }

  const featureScope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field, value) => {
      if (binding !== null && typeof binding.set === 'function') return binding.set(field, value)
      memoryState = Object.assign({}, memoryState, { [field]: value })
      publish(memorySnapshot())
    },
    unset: async (field) => {
      if (binding !== null && typeof binding.unset === 'function') return binding.unset(field)
      memoryState = Object.assign({}, memoryState)
      delete memoryState[field]
      publish(memorySnapshot())
    },
    // 仅测试与排障直视：当前接入的服务类型（'configForms' | 'settingsScope' | 'memory'）。
    kind: () => kind,
    dispose: () => {
      disposed = true
      if (releaseBinding !== null) { try { releaseBinding() } catch (_) {} releaseBinding = null }
      binding = null
      listeners.clear()
    },
  }

  const featureSnapshot = () => snapshot
  const featureValue = () => Object.assign({}, defaults, snapshot.value || {})
  const featureEnabled = (key) => featureValue()[key] !== false
  const useFeatures = () => {
    const [current, setCurrent] = React.useState(featureSnapshot())
    React.useEffect(() => featureScope.subscribe(() => setCurrent(featureSnapshot())), [])
    return { snapshot: current, value: Object.assign({}, defaults, current.value || {}) }
  }

  return { featureScope, featureSnapshot, featureValue, featureEnabled, useFeatures }
}
