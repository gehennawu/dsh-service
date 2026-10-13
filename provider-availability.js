// Profile-owned policy: configuration and credentials never move or disappear.
export function createProviderAvailability(store) {
  let disabled = new Set()
  let disabledModels = new Set()
  const modelKey = (provider, model) => JSON.stringify([provider, model])
  let ready = false
  const loading = store.load().then((state) => {
    disabled = new Set(Object.entries(state.disabledProviders ?? {}).filter(([, value]) => value === true).map(([id]) => id))
    disabledModels = new Set(Object.entries(state.disabledModels ?? {}).filter(([, value]) => value === true).map(([key]) => key))
    ready = true
  })
  const enabled = (provider) => !disabled.has(provider)
  const modelEnabled = (provider, model) => !disabledModels.has(modelKey(provider, model))
  const assertEnabled = (provider, model) => {
    if (!ready || !enabled(provider) || model !== undefined && !modelEnabled(provider, model)) {
      const code = !ready ? 'provider-availability-loading' : !enabled(provider) ? 'provider-disabled' : 'model-disabled'
      const error = new Error(code)
      error.code = code.toUpperCase().replaceAll('-', '_')
      throw error
    }
  }
  let changes = Promise.resolve()
  const set = (provider, value, expected) => {
    const result = changes.then(async () => {
      await loading
      if (enabled(provider) !== expected) throw new Error('conflict')
      await store.mutate((state) => {
        state.disabledProviders ??= {}
        if (value) delete state.disabledProviders[provider]
        else Object.defineProperty(state.disabledProviders, provider, { value: true, enumerable: true, configurable: true, writable: true })
      })
      if (value) disabled.delete(provider); else disabled.add(provider)
      return { route: provider, enabled: value }
    })
    changes = result.catch(() => {})
    return result
  }
  const setModel = (provider, model, value, expected) => {
    const result = changes.then(async () => {
      await loading
      if (modelEnabled(provider, model) !== expected) throw new Error('conflict')
      const key = modelKey(provider, model)
      await store.mutate((state) => {
        state.disabledModels ??= {}
        if (value) delete state.disabledModels[key]
        else Object.defineProperty(state.disabledModels, key, { value: true, enumerable: true, configurable: true, writable: true })
      })
      if (value) disabledModels.delete(key); else disabledModels.add(key)
      return { route: provider, modelId: model, enabled: value }
    })
    changes = result.catch(() => {})
    return result
  }
  return { loading, enabled, modelEnabled, assertEnabled, set, setModel }
}

// Filter the shared catalog and guard exact routing, including inherited routes.
// Keep every original method and restore it when the owning Fiber is disposed.
export function installProviderAvailability(llm, policy, notify = () => {}) {
  const originals = new Map()
  const wrappers = new Map()
  const wrap = (key, factory) => {
    if (typeof llm[key] !== 'function') return
    const original = llm[key]
    const wrapper = factory(original.bind(llm))
    originals.set(key, original); wrappers.set(key, wrapper); llm[key] = wrapper
  }
  wrap('listProviders', (original) => () => original().filter((row) => policy.enabled(row.id)))
  wrap('listModels', (original) => async (provider, ...args) => { await policy.loading; return policy.enabled(provider) ? (await original(provider, ...args)).filter((row) => policy.modelEnabled(provider, row.id)) : [] })
  wrap('resolveModelInfo', (original) => async (provider, ...args) => { await policy.loading; policy.assertEnabled(provider, args[0]); return original(provider, ...args) })
  wrap('resolveCallConfig', (original) => async (config, ...args) => { await policy.loading; policy.assertEnabled(config.provider, config.model); return original(config, ...args) })
  wrap('prepareCall', (original) => async (config, ...args) => {
    await policy.loading; policy.assertEnabled(config.provider, config.model)
    const prepared = await original(config, ...args)
    return { ...prepared, stream: async function* (options) {
      policy.assertEnabled(config.provider, config.model)
      yield* prepared.stream(options)
    } }
  })
  wrap('stream', (original) => async function* (options) { await policy.loading; policy.assertEnabled(options.provider, options.model); yield* original(options) })
  let disposed = false
  policy.loading.then(() => { if (!disposed) notify() }, () => {})
  return () => { disposed = true; for (const [key, original] of originals) if (llm[key] === wrappers.get(key)) llm[key] = original; notify() }
}
