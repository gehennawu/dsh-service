import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const QUOTA_CODES = new Set(['ACCOUNT_QUOTA', 'QUOTA'])
const OFF = Object.freeze({ enabled: false })
const MAX_ENTRIES = 4096
const MAX_TURN_EVENTS = 8192
const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value)
const isRoute = (value) => isId(value?.provider) && isId(value?.model)
const sameRoute = (left, right) => left?.provider === right?.provider && left?.model === right?.model
const sameSelection = (left, right) => sameRoute(left, right) && left?.reasoningEffort === right?.reasoningEffort
const effortSupported = (model, effort) => effort === undefined || (Array.isArray(model.reasoning?.efforts) && model.reasoning.efforts.some((level) => level.id === effort))
const selectRoute = ({ provider, model, reasoningEffort }) => ({ provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) })

function decodeConfig(text) {
  const raw = JSON.parse(text)
  if (raw?.version !== 1 || !Array.isArray(raw.sessions) || raw.sessions.length > MAX_ENTRIES) throw new Error('invalid fallback configuration')
  const config = new Map()
  for (const entry of raw.sessions) {
    if (!Array.isArray(entry) || !isId(entry[0]) || !isRoute(entry[1]) || typeof entry[1].enabled !== 'boolean' || config.has(entry[0])) {
      throw new Error('invalid fallback configuration entry')
    }
    const [id, selection] = entry
    if (selection.reasoningEffort !== undefined && !isId(selection.reasoningEffort)) throw new Error('invalid fallback reasoning effort')
    config.set(id, { enabled: selection.enabled, ...selectRoute(selection) })
  }
  return config
}

async function persist(file, config) {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    try { await handle.writeFile(JSON.stringify({ version: 1, sessions: [...config] }) + '\n') }
    finally { await handle.close() }
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

function agentSupported(agent) {
  const header = agent?.session?.header
  return header != null && header.origin !== 'subagent' && !(header.delegationDepth > 0)
    && typeof agent.model?.current === 'function' && typeof agent.model.select === 'function'
    && typeof agent.whenIdle === 'function' && typeof agent.runMaintenance === 'function' && typeof agent.followup === 'function'
    && typeof agent.session.snapshotEvents === 'function' && typeof agent.session.deriveMessages === 'function'
    && typeof agent.inbox?.hasPending === 'boolean'
}

// Only resume an actual ordinary user turn whose tool calls all reached a
// definite result. Never replay the original message or its tool calls.
function resumableTurn(session, turn) {
  const start = Math.max(0, session.seq - MAX_TURN_EVENTS)
  const events = session.snapshotEvents(start)
  const calls = new Set()
  let ordinaryUser = false
  for (let index = events.length - 1; index >= 0; index--) {
    const { type, data } = events[index]
    if (type === 'turn/start') return data.turn === turn && ordinaryUser && calls.size === 0
    if (type === 'user/message' && (data.source?.kind === 'user' || data.source?.kind === 'retry')) ordinaryUser = true
    if (type === 'tool/result' && data.turn === turn) {
      if (data.error || data.message?.isError || !isId(data.message?.toolCallId)) return false
      calls.add(data.message.toolCallId)
    }
    if (type === 'tool/call' && data.turn === turn && !calls.delete(data.callId)) return false
  }
  return false
}

export function createMainModelFallback({ ctx, dir, providerAvailability, rpcTechnicalFailure }) {
  const file = join(dir, 'dsh-service-main-model-fallback.json')
  const candidates = new WeakMap()
  const scheduled = new WeakSet()
  const pendingWrites = new Map()
  const lifetime = new AbortController()
  let writeTail = Promise.resolve()
  let config
  let load
  let disposed = false
  const read = () => load ??= readFile(file, 'utf8').then(decodeConfig, (error) => {
    if (error?.code === 'ENOENT') return new Map()
    throw error
  }).then((loaded) => config = loaded)
  const isBlockedByGoal = (agent) => ctx.get('goals')?.get?.(agent)?.phase === 'active'
  const agents = () => ctx.get('agents')
  const getAgent = (id) => agents()?.get?.(id)
  const canList = () => typeof ctx.get('llm')?.listModels === 'function' && typeof ctx.get('llm')?.resolveModelInfo === 'function'
  const available = (agent) => !disposed && agentSupported(agent) && canList()

  async function catalogModel(route, signal) {
    await providerAvailability?.loading
    if (disposed || signal?.aborted || providerAvailability?.modelEnabled(route.provider, route.model) === false) return null
    const llm = ctx.get('llm')
    if (!llm?.listProviders().some((entry) => entry.id === route.provider)) return null
    const models = await llm.listModels(route.provider)
    if (disposed || signal?.aborted || !models.some((entry) => entry.id === route.model)) return null
    return llm.resolveModelInfo(route.provider, route.model, signal)
  }

  async function resume(agent, event, candidate, selected, revision) {
    const { session } = agent
    const stillValid = () => available(agent) && !candidate.signal.aborted && agent.status === 'idle'
      && getAgent(session.id) === agent && session.seq === revision && !agent.inbox.hasPending
      && config.get(session.id) === selected && !pendingWrites.has(session.id) && !isBlockedByGoal(agent)
      && sameSelection(agent.model.current(), candidate.selection)
      && providerAvailability?.modelEnabled(selected.provider, selected.model) !== false
    await agent.whenIdle()
    if (!stillValid() || !resumableTurn(session, event.data.turn)) return
    await agent.runMaintenance(async (signal) => {
      const validationSignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(8_000)])
      let cancel
      const aborted = new Promise((resolve) => { cancel = () => resolve(null) })
      validationSignal.addEventListener('abort', cancel, { once: true })
      let model
      try {
        if (validationSignal.aborted) return
        model = await Promise.race([catalogModel(selected, validationSignal), aborted])
      } finally {
        validationSignal.removeEventListener('abort', cancel)
      }
      if (!model || !effortSupported(model, selected.reasoningEffort) || validationSignal.aborted || !stillValid()) return
      const modalities = model.inputModalities
      if (session.deriveMessages().some((message) => message.content.some((block) => block.type === 'image' && block.offloaded !== true))
        && !modalities?.includes('image')) return
      if (!stillValid()) return
      const message = {
        id: randomUUID(), role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: `主模型额度耗尽，已切换到 ${selected.provider}/${selected.model}。请接着完成上一轮任务，保留已有进展，不要重复执行已经成功的操作。\nThe main model ran out of quota. Continue the unfinished task using existing progress; do not repeat successful operations.` }],
      }
      agent.model.select(selectRoute(selected))
      if (!signal.aborted && !agent.inbox.hasPending && sameSelection(agent.model.current(), selected)) agent.followup(message)
    })
  }

  function onRequestError({ agent, turn, step, provider, failure, signal }, next) {
    if (!available(agent)) return next()
    candidates.delete(agent)
    const selected = config?.get(agent.session.id)
    try {
      const selection = agent.model.current()
      const attempted = agent.session.requestHeader()?.config
      if (selected?.enabled && QUOTA_CODES.has(failure?.code) && signal?.aborted === false
        && isRoute(selection) && provider === selection.provider && sameRoute(selection, attempted) && !sameRoute(selected, selection)
        && !agent.inbox.hasPending && !isBlockedByGoal(agent)) {
        candidates.set(agent, { turn, step, code: failure.code, signal, selection: { ...selection }, selected })
      }
    } catch (_) { /* Keep the original host failure on unavailable session state. */ }
    return next()
  }

  function onEvent(session, event) {
    if (disposed || !config?.has(session.id) || event.type !== 'turn/end') return
    const agent = getAgent(session.id)
    if (!agent || agent.session !== session) return
    const candidate = candidates.get(agent)
    candidates.delete(agent)
    if (candidate === undefined || scheduled.has(agent) || event.data.turn !== candidate.turn
      || event.data.reason?.kind !== 'error' || event.data.reason.error?.code !== candidate.code
      || config.get(session.id) !== candidate.selected || session.seq !== event.seq + 1) return
    scheduled.add(agent)
    void resume(agent, event, candidate, candidate.selected, session.seq)
      .catch(() => ctx.logger?.warn?.('dsh-service: quota fallback could not continue the session'))
      .finally(() => scheduled.delete(agent))
  }

  // Load with the Host services so resumed sessions do not depend on opening a menu first.
  function install(scope) {
    void read().catch(() => ctx.logger?.warn?.('dsh-service: session quota fallback settings could not be loaded'))
    return scope.effect(() => {
      const stopRequest = scope.on('agent/request-error', onRequestError)
      const stopEvents = scope.on('session/event', onEvent)
      return () => { stopEvents(); stopRequest() }
    }, 'dsh-service main model quota fallback')
  }

  const route = (save) => ({ ...(save ? { audit: true } : {}), handle: async (payload) => {
    const id = payload?.sessionId
    if (!isId(id)) return { ok: false, error: 'invalid-session' }
    const agent = getAgent(id)
    if (!available(agent)) return { ok: true, value: { available: false, ...OFF } }
    if (!save) {
      try {
        // The initial load promise keeps the original map; writes publish a new one.
        // Reopening during a save should also see its committed value (or the last
        // good value if the write failed).
        await pendingWrites.get(id)?.catch(() => {})
        const current = config ?? await read()
        if (!available(agent) || getAgent(id) !== agent) return { ok: true, value: { available: false, ...OFF } }
        return { ok: true, value: { available: true, ...(current.get(id) ?? OFF) } }
      } catch (error) { return rpcTechnicalFailure(error) }
    }
    if (typeof payload.enabled !== 'boolean') return { ok: false, error: 'invalid-fallback-state' }
    if ((payload.provider !== undefined || payload.model !== undefined) && !isRoute(payload)) return { ok: false, error: 'invalid-model-route' }
    if (payload.reasoningEffort !== undefined && (!isId(payload.reasoningEffort) || !isRoute(payload))) return { ok: false, error: 'invalid-reasoning-effort' }
    const write = async () => {
      const current = config ?? await read()
      const old = current.get(id)
      const selected = isRoute(payload) ? selectRoute(payload) : old
      if (payload.enabled && !selected) return { ok: false, error: 'invalid-model-route' }
      const changedRoute = selected && !sameRoute(old, selected)
      const changedSelection = selected && !sameSelection(old, selected)
      if (selected && (changedSelection || payload.enabled)) {
        if ((changedRoute || payload.enabled) && sameRoute(agent.model.current(), selected)) return { ok: false, error: 'same-model-route' }
        const model = await catalogModel(selected)
        if (!model) return { ok: false, error: 'invalid-model-route' }
        if (!effortSupported(model, selected.reasoningEffort)) return { ok: false, error: 'invalid-reasoning-effort' }
      }
      if (!available(agent) || getAgent(id) !== agent) return { ok: true, value: { available: false, ...OFF } }
      if (selected && (changedRoute || payload.enabled) && sameRoute(agent.model.current(), selected)) return { ok: false, error: 'same-model-route' }
      if (!selected) return { ok: true, value: { available: true, ...OFF } }
      if (!old && current.size >= MAX_ENTRIES) return { ok: false, error: 'fallback-config-full' }
      const value = { enabled: payload.enabled, ...selectRoute(selected) }
      if (old?.enabled === value.enabled && !changedSelection) return { ok: true, value: { available: true, ...value } }
      const next = new Map(current).set(id, value)
      await persist(file, next)
      config = next
      return { ok: true, value: { available: true, ...value } }
    }
    const pending = writeTail.then(write)
    pendingWrites.set(id, pending)
    writeTail = pending.catch(() => {})
    try { return await pending }
    catch (error) { return rpcTechnicalFailure(error) }
    finally { if (pendingWrites.get(id) === pending) pendingWrites.delete(id) }
  } })

  return {
    install,
    dispose: () => { disposed = true; lifetime.abort() },
    routes: { 'main-model-fallback': route(false), 'main-model-fallback-save': route(true) },
  }
}
