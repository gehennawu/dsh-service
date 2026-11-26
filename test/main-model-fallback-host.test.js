import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { createMainModelFallback } from '../main-model-fallback.js'

const primary = { provider: 'primary', model: 'one' }
const backup = { provider: 'backup', model: 'two' }

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-main-model-fallback-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const listeners = new Map()
  const agents = new Map()
  const state = { goal: undefined, validation: undefined, efforts: ['low', 'high'], generation: 0 }
  const services = { agents, goals: { get: () => state.goal }, llm: {
    listProviders: () => [{ id: 'primary' }, { id: 'backup' }],
    listModels: async (provider) => (provider === 'backup' ? ['two', 'three'] : ['one']).map((id) => ({ id })),
    resolveModelInfo: async (provider) => state.contextWindows ? { inputModalities: ['text'], context: { contextWindow: state.contextWindows[provider] } }
      : state.validation ?? { inputModalities: ['text'], reasoning: { efforts: state.efforts.map((id) => ({ id })) } },
  } }
  const ctx = { get: (key) => services[key], on: (event, callback) => { listeners.set(event, callback); return () => listeners.delete(event) }, effect: (fn) => fn() }
  const create = () => createMainModelFallback({ ctx, dir, featureGeneration: () => state.generation, rpcTechnicalFailure: () => ({ ok: false, error: 'technical' }) })
  const fallback = create()
  t.after(fallback.install(ctx))
  function add(id, header = {}) {
    const events = []; const messages = []; const history = []
    let current = primary
    const controller = new AbortController()
    const session = { id, header, get seq() { return events.length }, snapshotEvents: (start) => events.slice(start),
      deriveMessages: () => history, requestHeader: () => ({ config: current }) }
    const agent = { session, events, messages, history, controller, status: 'idle', inbox: { hasPending: false },
      whenIdle: async () => {}, runMaintenance: (job) => job(controller.signal), followup: (message) => messages.push(message),
      model: { current: () => current, select: (selection) => { current = selection } } }
    agents.set(id, agent)
    return agent
  }
  async function fail(agent, { code = 'ACCOUNT_QUOTA', tool, beforeEnd, provider = agent.model.current().provider, turn = 1 } = {}) {
    const { events, session } = agent
    events.push({ type: 'turn/start', data: { turn } }, { type: 'user/message', data: { source: { kind: 'user' } } })
    if (tool) events.push({ type: 'tool/call', data: { turn, callId: 'tool' } })
    if (tool === 'done') events.push({ type: 'tool/result', data: { turn, message: { toolCallId: 'tool' } } })
    listeners.get('agent/request-error')({ agent, turn, step: 2, provider, failure: { code }, signal: new AbortController().signal }, () => {})
    beforeEnd?.()
    const event = { seq: events.length, type: 'turn/end', data: { turn, reason: { kind: 'error', error: { code } } } }
    events.push(event)
    listeners.get('session/event')(session, event)
    listeners.get('session/event')(session, event)
    await setImmediate()
  }
  function completeContinuation(agent, { code, admitted = true, turn = 2 } = {}) {
    const emit = (type, data) => {
      const event = { seq: agent.events.length, type, data }
      agent.events.push(event)
      listeners.get('session/event')(agent.session, event)
    }
    emit('turn/start', { turn })
    if (admitted) emit('user/message', agent.messages.at(-1))
    if (code) listeners.get('agent/request-error')({ agent, turn, step: 1, provider: agent.model.current().provider,
      failure: { code }, signal: new AbortController().signal }, () => {})
    emit('turn/end', { turn, reason: code ? { kind: 'error', error: { code } } : { kind: 'completed' } })
  }
  const get = (id, instance = fallback) => instance.routes['main-model-fallback'].handle({ sessionId: id })
  const save = (id, args = { enabled: true, ...backup }) => fallback.routes['main-model-fallback-save'].handle({ sessionId: id, ...args })
  const getGlobal = (instance = fallback) => instance.routes['main-model-fallback-defaults'].handle({})
  const saveGlobal = (payload) => fallback.routes['main-model-fallback-defaults-save'].handle(payload)
  return { add, create, fail, completeContinuation, get, save, state, getGlobal, saveGlobal }
}

test('fallback preferences persist only for the configured conversation; disabling keeps the backup', async (t) => {
  const h = await fixture(t)
  h.add('main'); h.add('fork', { parentSession: 'main' }); h.add('child', { origin: 'subagent' })
  assert.equal((await h.get('main')).value.enabled, false)
  assert.equal((await h.save('main', { enabled: true, ...primary })).error, 'same-model-route')
  assert.equal((await h.save('main', { enabled: true, ...backup, model: 'unknown' })).error, 'invalid-model-route')
  assert.deepEqual((await h.save('main')).value, { available: true, enabled: true, ...backup })
  await h.save('main', { enabled: false })
  assert.deepEqual((await h.get('main', h.create())).value, { available: true, enabled: false, ...backup })
  assert.equal((await h.get('fork')).value.enabled, false)
  assert.equal((await h.get('child')).value.available, false)
})

test('global fallback covers all main conversations but explicit local models and efforts win', async (t) => {
  const h = await fixture(t)
  assert.deepEqual((await h.getGlobal()).value, { available: true, enabled: false })
  assert.equal((await h.saveGlobal({ enabled: true })).error, 'invalid-model-route')
  const global = { ...backup, reasoningEffort: 'high' }
  const local = { ...backup, model: 'three', reasoningEffort: 'low' }
  await h.saveGlobal({ enabled: true, ...global })
  const inherited = h.add('inherited')
  const override = h.add('override')
  await h.save('override', { enabled: false, ...local })
  assert.deepEqual((await h.getGlobal(h.create())).value, { available: true, enabled: true, ...global })
  assert.equal((await h.get('inherited')).value.inherited, true)
  assert.equal((await h.get('override')).value.localEnabled, false)
  await h.fail(inherited)
  await h.fail(override)
  assert.deepEqual(inherited.model.current(), global)
  assert.deepEqual(override.model.current(), local)
  assert.equal(override.messages.length, 1)
  await h.saveGlobal({ enabled: false })
  assert.equal((await h.get('override')).value.enabled, false)
  assert.equal((await h.get('override', h.create())).value.model, 'two')
  assert.equal((await h.get('inherited')).value.enabled, false)
  assert.equal((await h.getGlobal()).value.model, 'two')
  await h.saveGlobal({ enabled: true })
  assert.equal((await h.get('override')).value.inherited, true)
  assert.equal((await h.getGlobal()).value.model, 'two')
})

test('changing global settings replaces old conversation routes but preserves independent session switches', async (t) => {
  const h = await fixture(t)
  h.add('local'); h.add('paused'); h.add('new')
  await h.saveGlobal({ enabled: true, ...backup })
  await h.save('local', { enabled: true, ...backup, model: 'three' })
  await h.save('paused', { paused: true })
  const next = { ...backup, reasoningEffort: 'high' }
  await h.saveGlobal({ enabled: true, ...next })
  const reopened = h.create()
  for (const id of ['local', 'paused', 'new']) {
    const { model, reasoningEffort, inherited } = (await h.get(id, reopened)).value
    assert.deepEqual({ model, reasoningEffort, inherited }, { model: 'two', reasoningEffort: 'high', inherited: true })
  }
  assert.equal((await h.get('paused', reopened)).value.enabled, false)
  assert.equal((await h.get('local', reopened)).value.localEnabled, true)
  await h.save('local', { enabled: true, ...backup, model: 'three' })
  assert.equal((await h.get('local')).value.model, 'three')
  assert.equal((await h.getGlobal()).value.model, 'two')
})

test('a conversation can opt out globally, keep its draft, and resume without changing other conversations', async (t) => {
  const h = await fixture(t)
  const shared = { ...backup, reasoningEffort: 'high' }
  await h.saveGlobal({ enabled: true, ...shared })
  const paused = h.add('paused')
  const sibling = h.add('sibling')
  await h.save('paused', { paused: true })
  const reopened = h.create()
  assert.equal((await h.get('paused', reopened)).value.paused, true)
  assert.equal((await h.get('paused', reopened)).value.enabled, false)
  await h.fail(paused)
  await h.fail(sibling)
  assert.deepEqual(paused.model.current(), primary)
  assert.equal(paused.messages.length, 0)
  assert.deepEqual(sibling.model.current(), shared)
  assert.equal(sibling.messages.length, 1)
  const local = { ...backup, model: 'three', reasoningEffort: 'low' }
  assert.equal((await h.save('paused', { enabled: true, ...local })).value.enabled, false)
  assert.deepEqual((await h.getGlobal()).value, { available: true, enabled: true, ...shared })
  assert.equal((await h.save('paused', { paused: false })).value.enabled, true)
  await h.fail(paused)
  assert.deepEqual(paused.model.current(), local)
  assert.equal(paused.messages.length, 1)
})

test('a completed quota continuation saves the previous main model and effort for this conversation only', async (t) => {
  const h = await fixture(t)
  const agent = h.add('swap')
  h.add('sibling')
  const original = { ...primary, reasoningEffort: 'low' }
  const target = { ...backup, reasoningEffort: 'high' }
  agent.model.select(original)
  await h.saveGlobal({ enabled: true, ...target })
  await h.fail(agent)
  assert.deepEqual(agent.model.current(), target)
  assert.equal((await h.get('swap')).value.model, target.model)
  h.completeContinuation(agent)
  const saved = (await h.get('swap')).value
  assert.deepEqual(saved, { available: true, enabled: true, ...original, globalEnabled: true, inherited: false, localEnabled: false })
  assert.deepEqual((await h.get('swap', h.create())).value, saved)
  assert.equal((await h.get('sibling')).value.model, target.model)
  assert.equal((await h.getGlobal()).value.model, target.model)
})

test('a new turn may return to the former primary, but its automatic continuation never bounces back', async (t) => {
  const h = await fixture(t)
  for (const recovered of [true, false]) {
    const id = recovered ? 'recovered' : 'still-exhausted'
    const agent = h.add(id)
    await h.save(id)
    await h.fail(agent)
    h.completeContinuation(agent)
    assert.equal((await h.get(id)).value.model, primary.model)
    await h.fail(agent, { turn: 3, code: 'QUOTA' })
    assert.deepEqual(agent.model.current(), primary)
    assert.equal(agent.messages.length, 2)
    h.completeContinuation(agent, { turn: 4, code: recovered ? undefined : 'ACCOUNT_QUOTA' })
    assert.equal((await h.get(id)).value.model, recovered ? backup.model : primary.model)
    await setImmediate()
    assert.equal(agent.messages.length, 2)
    assert.deepEqual(agent.model.current(), primary)
  }
})

test('a failed or unrelated continuation never swaps backups or retries again', async (t) => {
  const h = await fixture(t)
  for (const [id, options] of [['failed', { code: 'QUOTA' }], ['unrelated', { admitted: false }]]) {
    const agent = h.add(id)
    await h.save(id)
    await h.fail(agent)
    h.completeContinuation(agent, options)
    await setImmediate()
    assert.equal((await h.get(id)).value.model, backup.model)
    assert.deepEqual(agent.model.current(), backup)
    assert.equal(agent.messages.length, 1)
  }
  const agent = h.add('edited')
  await h.save('edited')
  await h.fail(agent)
  await h.save('edited', { enabled: true, ...backup, model: 'three' })
  h.completeContinuation(agent)
  assert.equal((await h.get('edited')).value.model, 'three')
})

test('smaller windows are advisory and failed fallback compaction is reported without changing the backup', async (t) => {
  const h = await fixture(t)
  const agent = h.add('context')
  await h.save('context')
  h.state.contextWindows = { primary: 200000, backup: 36000 }
  assert.deepEqual((await h.get('context')).value.smallerContext, { primary: 200000, backup: 36000 })
  await h.fail(agent)
  assert.equal(agent.messages.length, 1)
  h.completeContinuation(agent, { code: 'MODEL_SWITCH_COMPACTION_FAILED', admitted: false })
  const { model, contextFailure, smallerContext } = (await h.get('context')).value
  assert.equal(model, backup.model)
  assert.equal(contextFailure, 'MODEL_SWITCH_COMPACTION_FAILED')
  assert.equal(smallerContext, undefined)
  assert.equal(agent.messages.length, 1)
})

test('feature switch suspends fallback without clearing saved settings or resuming stale attempts', async (t) => {
  const h = await fixture(t)
  const agent = h.add('main')
  const selection = { ...backup, reasoningEffort: 'high' }
  await h.save('main', { enabled: true, ...selection })
  h.state.generation = null
  assert.equal((await h.get('main')).value.available, false)
  await h.fail(agent)
  assert.deepEqual(agent.model.current(), primary)
  assert.equal(agent.messages.length, 0)
  h.state.generation = 2
  assert.deepEqual((await h.get('main')).value, { available: true, enabled: true, ...selection })
  await h.fail(agent, { beforeEnd() { h.state.generation = null; h.state.generation = 4 } })
  assert.deepEqual(agent.model.current(), primary)
  await h.fail(agent)
  assert.deepEqual(agent.model.current(), selection)
  assert.equal(agent.messages.length, 1)
})

test('hard quota selects the backup and continues the same conversation just once', async (t) => {
  const h = await fixture(t)
  const agent = h.add('main')
  await h.save('main')
  assert.deepEqual(agent.model.current(), primary)
  await h.fail(agent, { tool: 'done' })
  assert.deepEqual(agent.model.current(), backup)
  assert.equal(agent.messages.length, 1)
  assert.match(agent.messages[0].content[0].text, /请接着完成上一轮任务/)
  assert.equal(agent.events.filter((event) => event.type === 'tool/call').length, 1)
})

test('backup effort is validated, persisted, resettable and applied only on actual fallback', async (t) => {
  const h = await fixture(t)
  const agent = h.add('main')
  const selection = { ...backup, reasoningEffort: 'high' }
  assert.equal((await h.save('main', { enabled: false, ...backup, reasoningEffort: 'foreign' })).error, 'invalid-reasoning-effort')
  await h.save('main', { enabled: true, ...selection })
  assert.deepEqual((await h.get('main')).value, { available: true, enabled: true, ...selection })
  await h.save('main', { enabled: false })
  assert.deepEqual((await h.get('main', h.create())).value, { available: true, enabled: false, ...selection })
  assert.deepEqual((await h.save('main', { enabled: false, ...backup })).value, { available: true, enabled: false, ...backup })
  await h.save('main', { enabled: true, ...selection })
  assert.deepEqual(agent.model.current(), primary)
  await h.fail(agent)
  assert.deepEqual(agent.model.current(), selection)
  assert.equal(agent.messages.length, 1)
})

test('reopening the fallback pane during an effort save reads the committed level', async (t) => {
  const h = await fixture(t)
  h.add('main')
  await h.save('main')
  const gate = Promise.withResolvers()
  h.state.validation = gate.promise
  const pending = h.save('main', { enabled: true, ...backup, reasoningEffort: 'high' })
  const reopened = h.get('main')
  await setImmediate()
  gate.resolve({ reasoning: { efforts: [{ id: 'high' }] } })
  assert.equal((await pending).value.reasoningEffort, 'high')
  assert.equal((await reopened).value.reasoningEffort, 'high')
})

test('an effort removed from the backup model is not used for fallback', async (t) => {
  const h = await fixture(t)
  const agent = h.add('main')
  await h.save('main', { enabled: true, ...backup, reasoningEffort: 'high' })
  h.state.efforts = ['low']
  await h.fail(agent)
  assert.deepEqual(agent.model.current(), primary)
  assert.equal(agent.messages.length, 0)
})

test('rate limits and competing or unsafe activity do not cause a fallback', async (t) => {
  const h = await fixture(t)
  for (const name of ['rate', 'tool', 'input', 'manual', 'goal', 'image', 'cancel', 'disable']) {
    const agent = h.add(name)
    await h.save(name)
    if (name === 'goal') h.state.goal = { phase: 'active', activation: 'armed' }
    if (name === 'image') agent.history.push({ content: [{ type: 'image' }] })
    const deferred = Promise.withResolvers()
    if (name === 'cancel' || name === 'disable') h.state.validation = deferred.promise
    const manual = { provider: 'other', model: 'manual' }
    await h.fail(agent, { code: name === 'rate' ? 'RATE_LIMIT' : 'QUOTA', tool: name === 'tool' ? 'pending' : undefined, beforeEnd() {
      if (name === 'input') agent.inbox.hasPending = true
      if (name === 'manual') agent.model.select(manual)
      if (name === 'goal') h.state.goal.activation = 'disarmed'
    } })
    if (name === 'cancel') agent.controller.abort()
    if (name === 'disable') await h.save(name, { enabled: false })
    deferred.resolve({ inputModalities: ['text'] })
    await setImmediate()
    assert.deepEqual(agent.model.current(), name === 'manual' ? manual : primary, name)
    assert.equal(agent.messages.length, 0, name)
    h.state.goal = undefined
    h.state.validation = undefined
  }
})
