// 客户端半分片：主模型限额回退（官方模型菜单原生二级面板）。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域。
//
// 官方接缝（dsh-client-ui-model-selection / dsh-client-ui-agent-team 源码核实）：
//  · `conversation.input.model.options`（session/list）：根菜单里模型与思考档之后的会话选项，
//    条目用 order 升序（默认 0）。agent-team 未给 order，我方 order:50 即落在
//    「智能体团队协作」下方；条目必须渲染成 role=menuitem 的 button，并用
//    data-model-menu-pane 指认 pane key。
//  · `conversation.input.model.pane`（session/keyed）：由根条目的 openPane({key,title})
//    进入；pane 自己放初始焦点（本段保持不抢焦点：菜单表面仍可 Escape/方向键操作）。
//    官方 MenuSurface 仍统一拦截键盘事件，本分片不注册任何 keydown/Tab 处理。
//  · 模型清单复用官方 `ctx.modelDirectories.directoryFor(sessionId)`（同一份目录/快照，
//    不新增模型端点）：groups/current/failures + load()。目录里的 groups/模型名与
//    reasoning.efforts/defaultEffort 是唯一元数据来源；不调用官方 select，不切换主模型。
//
// 本段只负责浏览器半的展示与配置读写：状态按 sessionId 隔离；宿主是唯一事实源
// （GET `main-model-fallback`、保存 `main-model-fallback-save`）。选中后备模型只落配置，
// 绝不调用目录 select——不立刻切换主模型，也不碰全局默认或子代理配置。
//
// 保存口径（宿主协议）：
//  · 纯开关请求不带 provider/model → 宿主保留整份草稿（关闭后已选模型与思考档不丢）。
//  · 明确提交模型路由时省略 reasoningEffort → 宿主恢复该模型的默认思考档；
//    换模型即走这条（旧 effort 清除）。
//  · 只有用户显式选择非默认思考档才提交 reasoningEffort 字符串。

function createMainModelFallback({ ctx, rpcCall, getModelDirectories, t, useTranslation, useFeatures }) {
  const { useState, useEffect, useRef } = React
  const DEFAULTS = Symbol('fallback-defaults')
  const PANE_KEY = 'main-model-fallback'
  const OPTION_ATTR = 'data-dshsvc-main-model-fallback'
  const ROW_ATTR = 'data-dshsvc-main-model-fallback-row'
  const PANE_ATTR = 'data-dshsvc-main-model-fallback-pane'
  const h = React.createElement
  let ui = {}
  try { ui = require('@deepseek-ai/dsh-client-ui-primitives') } catch (_) {}
  const MenuGroup = ui.MenuGroup || function LocalMenuGroup({ label, children }) {
    return h('section', { role: 'group', 'data-menu-group': '' }, h('div', { 'data-menu-group-heading': '' }, label), children)
  }
  const Check = ui.IconCheckOutlineRegular || (() => '✓')
  const ENABLE_DESC_ID = 'dshsvc-main-model-fallback-enable-desc'
  const ENABLE_HINT_ID = 'dshsvc-main-model-fallback-enable-hint'
  // 宿主结构化错误码 -> 词典键。未知错误仍带原始 message 显示，不吞错。
  const SAVE_ERROR_KEYS = {
    'same-model-route': 'mainModelFallback.saveError.same-model-route',
    'invalid-model-route': 'mainModelFallback.saveError.invalid-model-route',
    'invalid-fallback-state': 'mainModelFallback.saveError.invalid-fallback-state',
    'invalid-reasoning-effort': 'mainModelFallback.saveError.invalid-reasoning-effort',
    'fallback-config-full': 'mainModelFallback.saveError.fallback-config-full',
    'invalid-session': 'mainModelFallback.saveError.invalid-session',
  }
  // 会话作用域尚未热身时 directoryFor 会抛；短退避重试，不阻塞菜单其它项。
  const MODEL_RETRY_DELAYS_MS = [250, 500, 1000, 2000]

  const idleSnapshot = () => ({
    status: 'idle',
    loaded: false,
    available: true,
    enabled: false,
    provider: null,
    model: null,
    reasoningEffort: null,
    saving: false,
    error: null,
  })

  // ── 按 sessionId 隔离的轻量 store：row 与 pane 共享同一份配置快照 ──
  const stores = new Map()
  const storeFor = (sessionId) => {
    let entry = stores.get(sessionId)
    if (entry === undefined) {
      entry = { snapshot: idleSnapshot(), listeners: new Set(), inflight: null, epoch: 0 }
      stores.set(sessionId, entry)
    }
    return entry
  }
  const emit = (entry) => {
    for (const listener of [...entry.listeners]) {
      try { listener() } catch (_) {}
    }
  }
  const patch = (entry, next) => {
    entry.snapshot = Object.assign({}, entry.snapshot, next)
    emit(entry)
  }
  const resetEntry = (entry) => {
    entry.epoch += 1
    entry.inflight = null
    entry.snapshot = idleSnapshot()
    emit(entry)
  }

  const errorText = (result) => {
    if (result && typeof result.error === 'string' && result.error !== '') return result.error
    if (result && result.error && typeof result.error.message === 'string') return result.error.message
    return 'error'
  }
  const isUnsupported = (result) => result !== null && typeof result === 'object'
    && result.ok === false
    && (result.error === 'unknown-endpoint' || result.error === 'unsupported' || result.error === 'not-found')

  // 宿主回包 -> 规范化配置。enabled 为真但缺少后备模型一律按关闭处理（不能假装已启用）。
  const readPayload = (value) => {
    if (value === null || typeof value !== 'object') return { available: false }
    if (value.available === false) return { available: false }
    const provider = typeof value.provider === 'string' && value.provider !== '' ? value.provider : null
    const model = typeof value.model === 'string' && value.model !== '' ? value.model : null
    const reasoningEffort = typeof value.reasoningEffort === 'string' && value.reasoningEffort !== ''
      ? value.reasoningEffort
      : null
    return {
      available: true,
      enabled: value.enabled === true && provider !== null && model !== null,
      provider,
      model,
      reasoningEffort,
      globalEnabled: value.globalEnabled === true,
      inherited: value.inherited === true,
      localEnabled: value.localEnabled === true,
    }
  }

  const load = (sessionId, force) => {
    const entry = storeFor(sessionId)
    if (entry.snapshot.saving === true) return Promise.resolve(entry.snapshot)
    if (entry.inflight !== null) return entry.inflight
    if (force !== true && entry.snapshot.loaded === true && entry.snapshot.status === 'ready') {
      return Promise.resolve(entry.snapshot)
    }
    const epoch = entry.epoch
    patch(entry, { status: entry.snapshot.loaded === true ? 'refreshing' : 'loading', error: null })
    let request
    try {
      request = sessionId === DEFAULTS ? rpcCall('main-model-fallback-defaults', {}) : rpcCall('main-model-fallback', { sessionId })
    } catch (error) {
      request = Promise.reject(error)
    }
    const settle = (result) => {
      if (entry.epoch !== epoch) return entry.snapshot
      if (result !== null && typeof result === 'object' && result.ok === true) {
        const next = readPayload(result.value)
        if (next.available !== true) {
          patch(entry, {
            status: 'unavailable', loaded: true, available: false,
            enabled: false, provider: null, model: null, reasoningEffort: null, saving: false, error: null,
          })
          return entry.snapshot
        }
        patch(entry, {
          status: 'ready', loaded: true, available: true,
          enabled: next.enabled, provider: next.provider, model: next.model, reasoningEffort: next.reasoningEffort, globalEnabled: next.globalEnabled, inherited: next.inherited, localEnabled: next.localEnabled,
          saving: false, error: null,
        })
        return entry.snapshot
      }
      if (isUnsupported(result)) {
        patch(entry, { status: 'unsupported', loaded: true, available: false, saving: false, error: null })
      } else {
        patch(entry, { status: 'error', loaded: true, saving: false, error: errorText(result) })
      }
      return entry.snapshot
    }
    entry.inflight = Promise.resolve(request).then(settle, (error) => settle({ ok: false, error: errorText({ error }) }))
    const clearRead = () => { if (entry.epoch === epoch) entry.inflight = null }
    entry.inflight.then(clearRead, clearRead)
    return entry.inflight
  }

  // config 只携带本次真正要提交的字段：
  //  · provider+model 都在 → 明确提交模型路由；此时没有 reasoningEffort 字段 =
  //    恢复该模型默认思考档（换模型也走这里）。
  //  · 都不在 → 纯开关请求；宿主保留已有草稿（关闭后后备模型/思考档不丢）。
  const save = (sessionId, config) => {
    const entry = storeFor(sessionId)
    if (entry.snapshot.saving === true) return Promise.resolve(false)
    const provider = typeof config?.provider === 'string' && config.provider !== '' ? config.provider : null
    const model = typeof config?.model === 'string' && config.model !== '' ? config.model : null
    const reasoningEffort = typeof config?.reasoningEffort === 'string' && config.reasoningEffort !== ''
      ? config.reasoningEffort
      : null
    // 纯开关请求没有 route，enabled 仍按调用方意图提交；宿主自行校验草稿是否可用。
    const enabled = config?.enabled === true
    const payload = sessionId === DEFAULTS ? { enabled } : config?.inherit ? { sessionId, inherit: true } : { sessionId, enabled }
    if (provider !== null && model !== null) {
      payload.provider = provider
      payload.model = model
      if (reasoningEffort !== null) payload.reasoningEffort = reasoningEffort
    }
    // A read started before this mutation must not publish its stale snapshot.
    const epoch = ++entry.epoch
    entry.inflight = null
    patch(entry, { saving: true, error: null })
    let request
    try {
      request = rpcCall(sessionId === DEFAULTS ? 'main-model-fallback-defaults-save' : 'main-model-fallback-save', payload)
    } catch (error) {
      request = Promise.reject(error)
    }
    const settle = (result) => {
      if (entry.epoch !== epoch) return false
      if (result !== null && typeof result === 'object' && result.ok === true) {
        const next = readPayload(result.value)
        if (next.available !== true) {
          patch(entry, {
            status: 'unavailable', loaded: true, available: false,
            enabled: false, provider: null, model: null, reasoningEffort: null, saving: false, error: null,
          })
          return false
        }
        patch(entry, {
          status: 'ready', loaded: true, available: true,
          enabled: next.enabled, provider: next.provider, model: next.model, reasoningEffort: next.reasoningEffort, globalEnabled: next.globalEnabled, inherited: next.inherited, localEnabled: next.localEnabled,
          saving: false, error: null,
        })
        if (sessionId === DEFAULTS) {
          for (const [id, cached] of stores) {
            if (id === DEFAULTS || cached.snapshot.saving || cached.listeners.size === 0) continue
            cached.epoch++
            cached.inflight = null
            load(id, true)
          }
        }
        return true
      }
      if (isUnsupported(result)) {
        patch(entry, { status: 'unsupported', loaded: true, available: false, saving: false, error: null })
      } else {
        patch(entry, { saving: false, error: errorText(result) })
      }
      return false
    }
    return Promise.resolve(request).then(settle, (error) => settle({ ok: false, error: errorText({ error }) }))
  }

  const useStoreSnapshot = (sessionId) => {
    const [snapshot, setSnapshot] = useState(() => storeFor(sessionId).snapshot)
    useEffect(() => {
      const entry = storeFor(sessionId)
      const listener = () => setSnapshot(entry.snapshot)
      setSnapshot(entry.snapshot)
      entry.listeners.add(listener)
      return () => { entry.listeners.delete(listener) }
    }, [sessionId])
    return snapshot
  }

  // 子代理会话不提供入口（与官方 agent-team 同一判据）。hooks 按能力探测调用：
  // 老外壳没有这两个标准 hook 时退化为「非子代理」，真实运行期两者恒在。
  const useSubagentSession = (props) => {
    const useSession = props !== null && typeof props === 'object' && typeof props.useSession === 'function' ? props.useSession : null
    const useSessions = props !== null && typeof props === 'object' && typeof props.useSessions === 'function' ? props.useSessions : null
    const addressed = useSession !== null
      ? useSession((snapshot) => snapshot !== null && snapshot !== undefined && snapshot.subagent !== null && snapshot.subagent !== undefined)
      : false
    const listed = useSessions !== null
      ? useSessions((state) => {
        const row = state !== null && state !== undefined && state.byId ? state.byId[props.sessionId] : null
        return row !== null && row !== undefined && row.origin === 'subagent'
      })
      : false
    return addressed === true || listed === true
  }

  // 官方模型目录（ctx.modelDirectories）只在面板打开时解析；目录快照订阅让模型清单
  // 随宿主事件刷新。失败重试有上限，卸载即清定时器与订阅。
  const useModelCatalog = (sessionId, active) => {
    const [state, setState] = useState({ status: 'idle', groups: [], failures: [], current: null, error: null })
    const [attempt, setAttempt] = useState(0)
    useEffect(() => {
      if (active !== true || typeof sessionId !== 'string' || sessionId === '') return undefined
      let disposed = false
      let timer = null
      let unsubscribe = null
      const finish = (next) => {
        if (disposed) return
        setState((previous) => Object.assign({}, previous, next))
      }
      const attach = (directory) => {
        const store = directory !== null && directory !== undefined ? directory.store : null
        if (store === null || store === undefined || typeof store.getSnapshot !== 'function') {
          finish({ status: 'error', error: 'no-directory' })
          return
        }
        const sync = () => {
          const snapshot = store.getSnapshot() || {}
          finish({
            status: snapshot.status === 'idle' || snapshot.status === 'loading' ? 'loading'
              : snapshot.status === 'error' && !snapshot.groups?.length ? 'error' : 'ready',
            groups: Array.isArray(snapshot.groups) ? snapshot.groups : [],
            failures: Array.isArray(snapshot.failures) ? snapshot.failures : [],
            current: snapshot.current === undefined ? null : snapshot.current,
            error: null,
          })
        }
        sync()
        try {
          if (typeof store.subscribe === 'function') unsubscribe = store.subscribe(sync)
        } catch (_) { unsubscribe = null }
        try {
          const pending = directory.load()
          if (pending && typeof pending.catch === 'function') pending.catch(() => {})
        } catch (_) {}
      }
      const attemptResolve = (round) => {
        if (disposed) return
        let models
        try { models = getModelDirectories() } catch (_) { models = undefined }
        if (models === undefined || models === null || typeof models.directoryFor !== 'function') {
          finish({ status: 'unavailable', error: null })
          return
        }
        let directory = null
        try { directory = models.directoryFor(sessionId) } catch (_) { directory = null }
        if (directory !== null && directory !== undefined) {
          attach(directory)
          return
        }
        if (round >= MODEL_RETRY_DELAYS_MS.length) {
          finish({ status: 'error', error: 'session-not-ready' })
          return
        }
        timer = ctx.timer.timeout(() => {
          timer = null
          attemptResolve(round + 1)
        }, MODEL_RETRY_DELAYS_MS[round])
      }
      attemptResolve(0)
      return () => {
        disposed = true
        if (timer !== null) {
          try { timer() } catch (_) {}
          timer = null
        }
        if (typeof unsubscribe === 'function') {
          try { unsubscribe() } catch (_) {}
        }
        unsubscribe = null
      }
    }, [sessionId, active, attempt])
    return [state, () => setAttempt((value) => value + 1)]
  }

  // ── 目录查询纯函数：官方分组/元数据只读复用，不改写目录对象 ──
  // 官方 orderModelProviders 的公开顺序（DeepSeek 账号 → DeepSeek 官方 → 其余），
  // 复刻语义而非引用私有模块。
  const providerRank = (id) => id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2
  const orderedGroups = (groups) => {
    const list = []
    if (!Array.isArray(groups)) return list
    for (const group of groups) {
      if (group === null || group === undefined || typeof group !== 'object') continue
      if (typeof group.id !== 'string' || group.id === '') continue
      if (!Array.isArray(group.models) || group.models.length === 0) continue
      list.push(group)
    }
    return list.sort((left, right) => providerRank(left.id) - providerRank(right.id))
  }
  const normalizeSearch = (value) => typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : ''
  const modelMatchRank = (model, needle) => {
    if (needle === '') return 0
    const rank = (text) => {
      const value = normalizeSearch(text)
      if (value.startsWith(needle)) return 0
      if (value.includes(needle)) return 1
      let index = 0
      for (const char of value) {
        if (needle.startsWith(char, index) && (index += char.length) === needle.length) return 2
      }
      return Number.POSITIVE_INFINITY
    }
    return Math.min(rank(model.name), rank(model.id), normalizeSearch(model.description).includes(needle) ? 3 : Number.POSITIVE_INFINITY)
  }
  // 返回去掉当前主模型 route 且按查询过滤后的分组（顺序与官方一致）。
  const filterGroups = (groups, query, current) => {
    const needle = normalizeSearch(query).trim()
    const out = []
    for (const group of orderedGroups(groups)) {
      const models = []
      for (const model of group.models) {
        if (model === null || model === undefined || typeof model !== 'object') continue
        if (typeof model.id !== 'string' || model.id === '') continue
        if (current !== null && current !== undefined
          && current.provider === group.id && current.model === model.id) continue
        const rank = modelMatchRank(model, needle)
        if (Number.isFinite(rank)) models.push({ model, rank })
      }
      if (models.length === 0) continue
      out.push({
        id: group.id,
        name: typeof group.name === 'string' && group.name !== '' ? group.name : group.id,
        models: models.sort((a, b) => a.rank - b.rank).map(({ model }) => model),
      })
    }
    return out
  }
  const findModel = (groups, provider, model) => {
    if (typeof provider !== 'string' || typeof model !== 'string') return null
    for (const group of orderedGroups(groups)) {
      if (group.id !== provider) continue
      for (const entry of group.models) {
        if (entry !== null && entry !== undefined && entry.id === model) return entry
      }
    }
    return null
  }
  // 目标模型可选的思考档（reasoning.efforts/defaultEffort）；模型没有 reasoning
  // 元数据时返回两个空值，UI 只提示不支持、不伪造档位。
  const effortMetaOf = (model) => {
    const reasoning = model !== null && model !== undefined && typeof model === 'object' ? model.reasoning : null
    if (reasoning === null || typeof reasoning !== 'object') return { efforts: [], defaultEffort: null }
    const efforts = []
    if (Array.isArray(reasoning.efforts)) {
      for (const level of reasoning.efforts) {
        if (level === null || level === undefined || typeof level !== 'object') continue
        if (typeof level.id !== 'string' || level.id === '') continue
        efforts.push({
          id: level.id,
          name: typeof level.name === 'string' && level.name !== '' ? level.name : level.id,
          description: typeof level.description === 'string' ? level.description : '',
        })
      }
    }
    return {
      efforts,
      defaultEffort: typeof reasoning.defaultEffort === 'string' && reasoning.defaultEffort !== ''
        ? reasoning.defaultEffort
        : null,
    }
  }
  const modelLabel = (model) => typeof model.name === 'string' && model.name !== '' ? model.name : model.id

  const Chevron = () => React.createElement('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    width: 12,
    height: 12,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    style: { flex: 'none', display: 'block', color: 'var(--dsw-alias-label-tertiary)' },
  }, React.createElement('path', { d: 'M9 6l6 6-6 6' }))

  const optionStyle = (disabled) => ({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    boxSizing: 'border-box',
    width: '100%',
    height: '34px',
    padding: '0 8px',
    border: 0,
    borderRadius: 'var(--dsw-radius-md)',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: 400,
    lineHeight: '20px',
    textAlign: 'start',
    cursor: disabled === true ? 'default' : 'pointer',
    opacity: disabled === true ? 0.5 : 1,
  })

  const labelStyle = { flex: '1', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }
  const stateStyle = { ...labelStyle, flex: '0 1 auto', maxWidth: '50%', color: 'var(--dsw-alias-label-tertiary)' }

  function MainModelFallbackOption(props) {
    const translate = useTranslation()
    const sessionId = props !== null && typeof props === 'object' && typeof props.sessionId === 'string' ? props.sessionId : ''
    const snapshot = useStoreSnapshot(sessionId)
    const subagent = useSubagentSession(props)
    const [catalog] = useModelCatalog(sessionId, !subagent && snapshot.enabled && Boolean(snapshot.model))
    const openPane = props !== null && typeof props === 'object' && typeof props.openPane === 'function' ? props.openPane : null
    const canRender = openPane !== null && sessionId !== ''
    // 每次菜单重新挂载都复查一次（历史会话可能第一次打开时尚未热身）；
    // 同一次挂载内只在状态回到 idle（连接重置）时补拉，渲染不重复发请求。
    const firstLoad = useRef(true)
    useEffect(() => {
      if (canRender !== true || subagent === true) return undefined
      if (firstLoad.current === true) {
        firstLoad.current = false
        load(sessionId, true)
        return undefined
      }
      if (snapshot.status === 'idle') load(sessionId)
      return undefined
    }, [canRender, subagent, sessionId, snapshot.status])
    if (canRender !== true || subagent === true) return null
    // 老宿主（未知端点）整条收起；暂时不可用/读取失败保留入口，点开是可重试的面板。
    if (snapshot.status === 'unsupported') return null
    const known = snapshot.status === 'ready' || snapshot.status === 'refreshing'
    const failed = snapshot.status === 'unavailable' || snapshot.status === 'error'
    const disabled = snapshot.status === 'loading' || props.locked === true
    const backup = known && snapshot.enabled ? findModel(catalog.groups, snapshot.provider, snapshot.model) : null
    const stateText = known
      ? (snapshot.enabled ? (backup ? modelLabel(backup) : snapshot.model) : translate('mainModelFallback.state.off'))
      : failed ? translate('mainModelFallback.state.unavailable') : null
    return React.createElement('button', {
      type: 'button',
      role: 'menuitem',
      [OPTION_ATTR]: '',
      'data-testid': 'main-model-fallback-option',
      'data-model-menu-pane': PANE_KEY,
      'data-state': snapshot.status,
      'aria-busy': snapshot.status === 'loading' ? 'true' : undefined,
      disabled,
      onClick: () => openPane({ key: PANE_KEY, title: translate('mainModelFallback.label') }),
      style: optionStyle(disabled),
    }, [
      React.createElement('span', { key: 'label', style: labelStyle }, translate('mainModelFallback.label')),
      stateText !== null ? React.createElement('span', { key: 'state', style: stateStyle, title: stateText }, stateText) : null,
      React.createElement('span', { key: 'chevron', style: { display: 'flex', flex: 'none' } }, React.createElement(Chevron, null)),
    ])
  }

  const hintStyle = { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere' }
  const errorStyle = { margin: 0, padding: '4px 8px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere' }
  const linkButtonStyle = { alignSelf: 'flex-start', margin: '0 2px', padding: '2px 8px', minHeight: '26px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-md)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12px', cursor: 'pointer' }
  const saveErrorText = (translate, message) => {
    const key = SAVE_ERROR_KEYS[message]
    if (typeof key === 'string') return translate(key)
    return translate('mainModelFallback.saveError', { message })
  }

  const switchOnColor = 'var(--dsw-alias-state-success-primary,#16a34a)'
  // 胶囊开启时为绿色，关闭时为灰色，同时保留开关状态文字。
  function Switch({ checked, disabled, label, describedBy, onClick, testId = 'main-model-fallback-switch' }) {
    const on = checked === true
    const track = on ? switchOnColor : 'var(--dsw-alias-border-l3,#c9ccd2)'
    return React.createElement('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': on ? 'true' : 'false',
      'aria-label': label,
      'aria-describedby': describedBy,
      'data-testid': testId,
      disabled: disabled === true,
      onClick,
      style: {
        position: 'relative',
        flex: 'none',
        width: '42px',
        height: '24px',
        padding: 0,
        border: '1px solid ' + track,
        ...fullRound('999px'),
        background: track,
        cursor: disabled === true ? 'default' : 'pointer',
        opacity: disabled === true ? 0.55 : 1,
        transition: 'background 120ms ease, border-color 120ms ease',
      },
    }, React.createElement('span', {
      'aria-hidden': 'true',
      style: {
        position: 'absolute',
        top: '2px',
        left: on ? '19px' : '2px',
        width: '18px',
        height: '18px',
        boxSizing: 'border-box',
        ...fullRound('50%'),
        background: 'var(--dsw-alias-bg-layer-1,#ffffff)',
        border: '1px solid var(--dsw-alias-border-l3,#c9ccd2)',
        boxShadow: 'var(--dsw-shadow-lv1,0 1px 2px rgba(0,0,0,0.18))',
        transition: 'left 120ms ease',
      },
    }))
  }

  function MainModelFallbackPane(props) {
    const translate = useTranslation()
    const global = props.global === true
    const sessionId = global ? DEFAULTS : props !== null && typeof props === 'object' && typeof props.sessionId === 'string' ? props.sessionId : ''
    const snapshot = useStoreSnapshot(sessionId)
    const subagent = useSubagentSession(props)
    const dismiss = props !== null && typeof props === 'object' && typeof props.dismiss === 'function' ? props.dismiss : null
    const canRender = (dismiss !== null || global) && sessionId !== ''
    const [sessionCatalog, retrySession] = useModelCatalog(sessionId, !global && canRender && !subagent)
    const [globalCatalog, setGlobalCatalog] = useState({ status: 'idle', groups: [], current: null })
    const [catalogAttempt, setCatalogAttempt] = useState(0)
    useEffect(() => {
      if (!global) return undefined
      let live = true
      const settle = (result) => {
        if (live) setGlobalCatalog(result?.ok === true && Array.isArray(result.value?.groups)
          ? { status: 'ready', groups: result.value.groups, current: null }
          : { status: 'error', groups: [], current: null })
      }
      setGlobalCatalog({ status: 'loading', groups: [], current: null })
      Promise.resolve().then(() => rpcCall('main-model-fallback-catalog', {})).then(settle, () => settle(null))
      return () => { live = false }
    }, [global, catalogAttempt])
    useEffect(() => { if (global) load(DEFAULTS, true) }, [global])
    const catalog = global ? globalCatalog : sessionCatalog
    const retryCatalog = global ? () => setCatalogAttempt((value) => value + 1) : retrySession
    const [picker, setPicker] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [query, setQuery] = useState('')
    const iconsEnabled = useFeatures().value.modelProviderIcons !== false
    const searchRef = useRef(null)
    const resultsRef = useRef(null)
    const modelCellRef = useRef(null)
    const effortToggleRef = useRef(null)
    const restoreFocus = useRef(false)
    const filteredGroups = picker ? filterGroups(catalog.groups, query, catalog.current) : []
    useEffect(() => {
      if (picker && typeof ui.isMobileDevice === 'function' && !ui.isMobileDevice()) searchRef.current?.focus?.()
      if (!picker && restoreFocus.current) {
        restoreFocus.current = false
        modelCellRef.current?.focus?.()
      }
    }, [picker])
    useEffect(() => {
      if (picker && resultsRef.current && typeof ui.observeStickyMenuGroups === 'function') {
        return ui.observeStickyMenuGroups(resultsRef.current)
      }
    }, [picker, catalog.groups, catalog.current, query, catalog.status])
    useEffect(() => {
      const results = resultsRef.current
      if (!picker || !results) return
      results.scrollTop = 0
      if (!query.trim()) results.querySelector?.('[aria-checked="true"]')?.scrollIntoView?.({ block: 'nearest' })
    }, [picker, query, snapshot.provider, snapshot.model, catalog.status])
    useEffect(() => {
      if (canRender !== true || subagent === true) return undefined
      if (snapshot.status === 'idle') load(sessionId)
      return undefined
    }, [canRender, subagent, sessionId, snapshot.status])
    if (canRender !== true || subagent === true) return null

    const retry = () => { load(sessionId, true) }
    const loading = snapshot.status === 'idle' || snapshot.status === 'loading'
    const unavailable = snapshot.status === 'unsupported' || snapshot.status === 'unavailable' || snapshot.available === false
    const loadFailed = snapshot.status === 'error'
    const hasSelection = typeof snapshot.provider === 'string' && snapshot.provider !== ''
      && typeof snapshot.model === 'string' && snapshot.model !== ''
    const locked = props.locked === true
    const saving = snapshot.saving === true
    const current = catalog.current !== null && catalog.current !== undefined ? catalog.current : null
    const currentProvider = current !== null && typeof current.provider === 'string' ? current.provider : null
    const currentModel = current !== null && typeof current.model === 'string' ? current.model : null
    const savedIsCurrent = hasSelection && currentProvider !== null && currentModel !== null
      && snapshot.provider === currentProvider && snapshot.model === currentModel
    const localEnabled = snapshot.globalEnabled ? snapshot.localEnabled : snapshot.enabled
    const enableLabel = translate(global ? 'mainModelFallback.global.enable' : 'mainModelFallback.enable.label')
    const busy = saving === true || locked === true
    const groups = catalog.groups
    const selectedModel = hasSelection ? findModel(groups, snapshot.provider, snapshot.model) : null
    const canToggle = (snapshot.enabled || (selectedModel !== null && !savedIsCurrent))
      && !loading && !unavailable && !loadFailed && !busy
    const providerName = (group) => group.id === 'deepseek-account'
      ? translate('mainModelFallback.provider.account') : group.name || group.id
    const providerIcon = (id, name) => iconsEnabled ? modelIconNode(name, 13) || modelIconNode(id, 13) : null
    const closePicker = () => {
      restoreFocus.current = true
      setPicker(false)
    }
    const effortMeta = effortMetaOf(selectedModel)
    const effortEfforts = effortMeta.efforts
    const defaultEffort = effortMeta.defaultEffort
    const hasDefaultLevel = defaultEffort !== null && effortEfforts.some((level) => level.id === defaultEffort)
    // 目录可能已经换版：旧显式 effort 不在当前档位表里时按「未显式指定」处理，
    // 显示回到模型默认，而不是留下一个没有选中行的列表。
    const explicitEffort = snapshot.reasoningEffort !== null && effortEfforts.some((level) => level.id === snapshot.reasoningEffort)
      ? snapshot.reasoningEffort
      : null
    const effectiveEffort = explicitEffort !== null ? explicitEffort : defaultEffort
    const canConfigureEffort = selectedModel !== null && !savedIsCurrent && effortEfforts.length > 0
    const levelName = effortEfforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort
    const effortLabel = explicitEffort !== null ? levelName : levelName !== null
      ? translate('mainModelFallback.effort.defaultWith', { name: levelName })
      : translate('mainModelFallback.effort.default')

    const handleToggle = () => {
      if (canToggle !== true) return
      if (snapshot.enabled === true) {
        // 纯关闭请求：不带 route，宿主保留整份草稿（已选模型/思考档）。
        void save(sessionId, { enabled: false })
        return
      }
      // 开启时明确提交当前草稿；显式思考档随路由带上，没有显式档则省略恢复默认。
      const payload = {
        enabled: true,
        provider: snapshot.provider,
        model: snapshot.model,
      }
      if (snapshot.reasoningEffort !== null) payload.reasoningEffort = snapshot.reasoningEffort
      void save(sessionId, payload)
    }
    const handleModelSelect = async (provider, model) => {
      if (busy || storeFor(sessionId).snapshot.saving) return
      if ((!snapshot.inherited && snapshot.provider === provider && snapshot.model === model)
        || await save(sessionId, { enabled: localEnabled, provider, model })) {
        setExpanded(false)
        closePicker()
      }
    }
    const handleEffortSelect = async (effort) => {
      if (busy || !canConfigureEffort || storeFor(sessionId).snapshot.saving) return
      // 省略默认档，避免把当下的默认值固化到会话配置。
      const next = effort === '' || effort === defaultEffort ? null : effort
      if (snapshot.reasoningEffort !== next && !await save(sessionId, {
        enabled: localEnabled,
        provider: snapshot.provider,
        model: snapshot.model,
        reasoningEffort: next,
      })) return
      effortToggleRef.current?.focus?.()
      setExpanded(false)
    }

    let pickerView = null
    if (picker && !loading && !unavailable && !loadFailed) {
      const catalogError = catalog.status === 'error' || catalog.status === 'unavailable'
      const catalogLoading = catalog.status === 'idle' || catalog.status === 'loading'
      const showEmpty = !catalogError && !catalogLoading && filteredGroups.length === 0
      pickerView = h('div', { key: 'picker', [PANE_ATTR]: 'picker', 'data-testid': 'main-model-fallback-pane', className: 'dshsvc-fallback-picker' },
        h('div', { className: 'dshsvc-fallback-search', 'data-query': query !== '' ? '' : undefined },
          h(ui.Input || 'input', {
            ref: searchRef, type: 'text', role: 'searchbox',
            'data-testid': 'main-model-fallback-search',
            'aria-label': translate('mainModelFallback.search.placeholder'),
            'aria-controls': global ? 'dshsvc-fallback-global-model-results' : 'dshsvc-fallback-model-results',
            placeholder: translate('mainModelFallback.search.placeholder'),
            value: query, readOnly: busy,
            onChange: (event) => setQuery(event.target.value),
          }),
          query !== '' && h('button', {
            type: 'button', className: 'dshsvc-fallback-clear', 'data-testid': 'main-model-fallback-search-clear',
            'aria-label': translate('mainModelFallback.search.clear'), disabled: busy,
            onClick: () => { setQuery(''); searchRef.current?.focus?.() },
          }, ui.IconCloseFillRegular ? h(ui.IconCloseFillRegular) : '×')),
        snapshot.error && h('p', { role: 'alert', style: errorStyle }, saveErrorText(translate, snapshot.error)),
        catalogLoading && h('p', { role: 'status', style: hintStyle }, translate('mainModelFallback.model.loading')),
        catalogError && h('div', null,
          h('p', { role: 'alert', style: errorStyle }, translate(catalog.status === 'error' ? 'mainModelFallback.model.error' : 'mainModelFallback.model.unavailable')),
          h('button', { type: 'button', role: 'menuitem', style: linkButtonStyle, onClick: retryCatalog }, translate('mainModelFallback.retry'))),
        showEmpty && h('p', { role: 'status', style: hintStyle }, translate(query.trim() ? 'mainModelFallback.search.empty' : 'mainModelFallback.model.empty')),
        h('div', {
          ref: resultsRef, id: global ? 'dshsvc-fallback-global-model-results' : 'dshsvc-fallback-model-results', role: 'menu', className: 'scrollable dshsvc-fallback-results',
          hidden: filteredGroups.length === 0, 'aria-label': translate('mainModelFallback.model.label'),
          'aria-busy': saving, 'data-testid': 'main-model-fallback-model-results',
        }, filteredGroups.map((group) => h(MenuGroup, {
          key: group.id,
          label: h('span', { className: 'dshsvc-fallback-provider', 'data-testid': 'main-model-fallback-group' }, providerIcon(group.id, providerName(group)), providerName(group)),
        }, group.models.map((model) => {
          const selected = snapshot.provider === group.id && snapshot.model === model.id
          return h('button', {
            key: model.id, type: 'button', role: 'menuitemradio', 'aria-checked': selected ? 'true' : 'false',
            'data-testid': 'main-model-fallback-model-option', 'data-provider-id': group.id, 'data-model-id': model.id,
            [ROW_ATTR]: '', disabled: locked, 'aria-disabled': saving || undefined, title: modelLabel(model),
            onClick: () => { void handleModelSelect(group.id, model.id) }, style: optionStyle(locked),
          }, h('span', { style: labelStyle }, modelLabel(model)), h('span', { className: 'dshsvc-fallback-check', 'aria-hidden': true }, selected && h(Check)))
        })))),
        h('button', { type: 'button', role: 'menuitem', [ROW_ATTR]: '', style: { ...optionStyle(busy), flex: 'none' }, disabled: busy,
          'data-testid': 'main-model-fallback-picker-back', onClick: closePicker }, translate(global ? 'mainModelFallback.global.closePicker' : 'mainModelFallback.model.back')))
    }

    if (pickerView && !global) return pickerView
    const body = []
    if (loading === true) {
      body.push(React.createElement('p', { key: 'loading', style: hintStyle }, translate('mainModelFallback.loading')))
    } else if (loadFailed === true) {
      body.push(React.createElement('p', { key: 'load-error', role: 'alert', style: errorStyle }, translate('mainModelFallback.loadError')))
      body.push(React.createElement('button', {
        key: 'retry', type: 'button', 'data-testid': 'main-model-fallback-retry', onClick: retry, style: linkButtonStyle,
      }, translate('mainModelFallback.retry')))
    } else if (unavailable === true) {
      body.push(React.createElement('p', { key: 'unavailable', style: hintStyle }, translate(global ? 'mainModelFallback.global.unavailable' : 'mainModelFallback.unavailable')))
      body.push(React.createElement('button', {
        key: 'retry', type: 'button', 'data-testid': 'main-model-fallback-retry', onClick: retry, style: linkButtonStyle,
      }, translate('mainModelFallback.retry')))
    } else {
      if (snapshot.error !== null && typeof snapshot.error === 'string' && snapshot.error !== '') {
        body.push(React.createElement('p', { key: 'save-error', role: 'alert', 'data-testid': 'main-model-fallback-error', style: errorStyle },
          saveErrorText(translate, snapshot.error)))
      }

      // ── 显眼独立开关（始终在面板顶部；没有模型时禁用并用提示引导）──
      const guidance = hasSelection !== true
        ? translate('mainModelFallback.enable.hint.selectModel')
        : savedIsCurrent === true
          ? translate('mainModelFallback.enable.hint.sameAsCurrent')
          : null
      const describeId = global ? `${ENABLE_DESC_ID}-global` : ENABLE_DESC_ID
      const hintId = global ? `${ENABLE_HINT_ID}-global` : ENABLE_HINT_ID
      const enableDescribedBy = guidance !== null ? `${describeId} ${hintId}` : describeId
      if (snapshot.globalEnabled && !global) {
        body.push(h('div', { key: 'global-source', style: { display: 'grid', gap: '4px' } },
          h('p', { style: hintStyle }, translate(snapshot.inherited ? 'mainModelFallback.source.inherited' : 'mainModelFallback.source.local')),
          savedIsCurrent && h('p', { style: hintStyle }, translate('mainModelFallback.enable.hint.sameAsCurrent')),
          !snapshot.inherited && h('button', { type: 'button', role: 'menuitem', disabled: busy,
            'data-testid': 'main-model-fallback-use-global', style: linkButtonStyle,
            onClick: () => { void save(sessionId, { inherit: true }).then((ok) => { if (ok) setExpanded(false) }) },
          }, translate('mainModelFallback.source.reset'))))
      } else body.push(React.createElement('div', {
        key: 'enable',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          ...(global ? { padding: '8px' } : {
            padding: '8px 10px',
            border: '1px solid var(--dsw-alias-border-l2,#d9dce1)',
            borderRadius: 'var(--dsw-radius-md,8px)',
            background: 'var(--dsw-alias-bg-layer-2,#ffffff)',
          }),
        },
      },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
        React.createElement('span', {
          style: { minWidth: 0, fontSize: '13px', fontWeight: 650, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' },
        }, enableLabel),
        React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } },
          React.createElement('span', {
            'data-testid': 'main-model-fallback-switch-state',
            'aria-live': 'polite',
            style: {
              fontSize: '12px',
              fontWeight: 600,
              color: snapshot.enabled === true ? 'var(--dsw-alias-state-success-label,var(--dsw-alias-label-primary))' : 'var(--dsw-alias-label-secondary)',
            },
          }, translate(snapshot.enabled === true ? 'mainModelFallback.state.on' : 'mainModelFallback.state.off')),
          React.createElement(Switch, {
            checked: snapshot.enabled === true,
            disabled: canToggle !== true,
            label: enableLabel,
            describedBy: enableDescribedBy,
            onClick: handleToggle,
          }))),
      React.createElement('p', { id: describeId, style: hintStyle }, translate(global ? 'mainModelFallback.global.description' : 'mainModelFallback.enable.description')),
      guidance !== null
        ? React.createElement('p', { id: hintId, style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, guidance)
        : null
      ))

      const selectedGroup = groups.find((group) => group.id === snapshot.provider)
      const channelName = selectedGroup ? providerName(selectedGroup) : snapshot.provider
      const selectedName = selectedModel ? modelLabel(selectedModel) : snapshot.model
      const title = translate(global ? 'mainModelFallback.global.model' : 'mainModelFallback.model.label')
      body.push(h('button', {
        key: 'model', ref: modelCellRef, type: 'button', role: 'menuitem', [ROW_ATTR]: '',
        'data-testid': 'main-model-fallback-model-summary', disabled: busy,
        onClick: () => { setQuery(''); setPicker(!global || !picker) },
        'aria-expanded': global ? picker : undefined,
        style: { ...optionStyle(busy), height: 'auto', minHeight: global ? '62px' : '42px', paddingBlock: global ? '12px' : '4px' },
        title: hasSelection ? `${selectedName} · ${channelName}` : title,
      }, h('span', { style: { ...labelStyle, whiteSpace: 'normal' } },
        h('span', { style: hintStyle }, title),
        h('span', { className: 'dshsvc-fallback-provider' },
          hasSelection && providerIcon(snapshot.provider, channelName),
          h('span', { style: { ...labelStyle, fontWeight: 600 } }, selectedName ?? translate('mainModelFallback.model.choose'))),
        hasSelection && h('span', { style: { ...hintStyle, display: 'block' } }, channelName)),
      h(Chevron)))
      if (global && pickerView) body.push(pickerView)
      if (hasSelection && !savedIsCurrent && selectedModel === null && catalog.status === 'ready') {
        body.push(h('p', { key: 'missing-model', style: hintStyle }, translate('mainModelFallback.model.missing')))
      }
      if (canConfigureEffort) {
        const levels = hasDefaultLevel ? effortEfforts : [{ id: '', name: defaultEffort ? translate('mainModelFallback.effort.defaultWith', { name: defaultEffort }) : translate('mainModelFallback.effort.default') }, ...effortEfforts]
        body.push(h('div', { key: 'effort', 'data-testid': 'main-model-fallback-effort-section', 'data-model-id': snapshot.model },
          h('button', {
            ref: effortToggleRef, type: 'button', role: 'menuitem', [ROW_ATTR]: '', disabled: locked, 'aria-disabled': saving || undefined, 'aria-expanded': expanded,
            'data-testid': 'main-model-fallback-effort-toggle', onClick: () => { if (!busy) setExpanded(!expanded) }, style: optionStyle(busy),
          }, h('span', { style: labelStyle }, translate(global ? 'mainModelFallback.global.effort' : 'mainModelFallback.effort.label')),
          h('span', { style: { ...labelStyle, flex: '0 1 auto', color: 'var(--dsw-alias-label-secondary)' }, title: effortLabel }, effortLabel),
          h('span', { style: { display: 'flex', transform: `rotate(${expanded ? -90 : 90}deg)` } }, h(Chevron))),
          expanded && h('div', { role: 'group', 'aria-label': translate(global ? 'mainModelFallback.global.effort' : 'mainModelFallback.effort.label'), style: { paddingInlineStart: '8px' } },
            levels.map((level) => {
              const checked = level.id === effectiveEffort || (level.id === '' && explicitEffort === null)
              const name = level.id !== '' && level.id === defaultEffort
                ? translate('mainModelFallback.effort.defaultWith', { name: level.name }) : level.name
              return h('button', {
                key: level.id, type: 'button', role: 'menuitemradio', 'aria-checked': checked ? 'true' : 'false',
                'data-testid': 'main-model-fallback-effort-option', 'data-effort-id': level.id, [ROW_ATTR]: '',
                disabled: locked, 'aria-disabled': saving || undefined, title: level.description || name,
                onClick: () => handleEffortSelect(level.id), style: optionStyle(locked),
              }, h('span', { style: labelStyle }, name), checked && h(Check))
            }))))
      } else if (selectedModel !== null && !savedIsCurrent) {
        body.push(h('p', { key: 'no-effort', style: { ...hintStyle, paddingInline: '8px' } }, translate('mainModelFallback.effort.unsupported')))
      }
    }

    return React.createElement('div', {
      [PANE_ATTR]: '',
      'data-testid': 'main-model-fallback-pane',
      role: 'group',
      'aria-label': translate('mainModelFallback.label'),
      style: { display: 'flex', flexDirection: 'column', gap: global ? '14px' : '8px', minWidth: 0, minHeight: 0, padding: '2px 0 4px' },
    }, body)
  }

  function SettingsSection() {
    const translate = useTranslation()
    const enabled = useFeatures().value.mainModelFallback !== false
    return h('section', { 'data-testid': 'main-model-fallback-settings', style: { paddingBlock: '12px', minWidth: 0 } },
      enabled ? h(MainModelFallbackPane, { global: true })
        : h('p', { role: 'status', style: hintStyle }, translate('mainModelFallback.settings.disabled')))
  }

  function MenuOption(props) {
    return useFeatures().value.mainModelFallback !== false ? h(MainModelFallbackOption, { ...props, key: props.sessionId }) : null
  }

  function MenuPane(props) {
    return useFeatures().value.mainModelFallback !== false ? h(MainModelFallbackPane, { ...props, key: props.sessionId }) : null
  }

  const start = () => {
    const disposers = []
    if (typeof document !== 'undefined' && document !== null && document.head) {
      const styleTag = document.createElement('style')
      styleTag.dataset.plugin = '@gehennawu/dsh-service'
      styleTag.dataset.pluginCss = '@gehennawu/dsh-service/main-model-fallback.css'
      styleTag.textContent = [
        '[' + OPTION_ATTR + ']:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
        '[' + OPTION_ATTR + ']:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}',
        '[' + ROW_ATTR + ']:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)!important}',
        '[' + ROW_ATTR + ']:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)!important}',
        `[data-testid="main-model-fallback-settings"] .dshsvc-fallback-results{max-height:min(360px,50dvh)}
         [data-model-menu]:has(.dshsvc-fallback-picker){width:min(300px,calc(100vw - 24px))}
         [data-model-menu] > .scrollable:has(.dshsvc-fallback-picker){display:flex;flex-direction:column;overflow:hidden}
         .dshsvc-fallback-picker{display:flex;flex-direction:column;min-height:0;min-width:0}
         .dshsvc-fallback-search{position:relative;flex:none;margin:2px 0 3px}
         .dshsvc-fallback-search > :first-child{box-sizing:border-box;width:100%;height:auto;padding:5px 7px;border:0;border-radius:var(--dsw-radius-md);background:transparent}
         .dshsvc-fallback-search[data-query] > :first-child{padding-inline-end:34px}
         .dshsvc-fallback-search input{color:inherit;font:inherit;font-size:12px;line-height:normal}
         .dshsvc-fallback-search > :not(input) input{padding:0}
         .dshsvc-fallback-search input::placeholder{color:var(--dsw-alias-label-caption)}
         .dshsvc-fallback-search input:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
         .dshsvc-fallback-clear{position:absolute;top:50%;inset-inline-end:4px;transform:translateY(-50%);display:grid;place-items:center;width:24px;height:24px;border:0;border-radius:50%;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
         .dshsvc-fallback-clear:hover,.dshsvc-fallback-clear:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
         .dshsvc-fallback-results:not([hidden]){min-height:0;overflow:hidden auto;overscroll-behavior:contain}
         .dshsvc-fallback-results button{scroll-margin-top:25px}
         .dshsvc-fallback-provider{display:flex;align-items:center;gap:5px;min-width:0}
         .dshsvc-fallback-check{display:grid;place-items:center;flex:none;width:16px;height:16px;color:var(--dsw-alias-label-secondary)}
         @media(pointer:coarse){.dshsvc-fallback-search input{font-size:16px}}`,
      ].join('')
      document.head.appendChild(styleTag)
      disposers.push(() => {
        try { styleTag.remove() } catch (_) {}
      })
    }
    disposers.push(ctx.slots.inject('conversation.input.model.options', () => ctx.slots.register({
      name: 'conversation.input.model.options',
      id: PANE_KEY,
      order: 50,
      label: () => t('mainModelFallback.label'),
    }, MenuOption)))
    disposers.push(ctx.slots.inject('conversation.input.model.pane', () => ctx.slots.register({
      name: 'conversation.input.model.pane',
      key: PANE_KEY,
      label: () => t('mainModelFallback.label'),
    }, MenuPane)))
    let disposeReset = null
    if (typeof ctx.on === 'function') {
      disposeReset = ctx.on('connection/reset', () => {
        for (const entry of stores.values()) resetEntry(entry)
      })
    }
    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch (_) {}
      }
      if (typeof disposeReset === 'function') {
        try { disposeReset() } catch (_) {}
      }
      stores.clear()
    }
  }

  return { start, SettingsSection }
}
