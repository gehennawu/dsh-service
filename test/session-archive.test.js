import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionsRoutes } from '../session-routes.js'

function fixture() {
  const listeners = new Map()
  const disposers = []
  const calls = []
  const records = ['a', 'b'].map(id => ({ header: { id, cwd: '/workspace/' + id, createdAt: 1 }, live: false }))
  const registry = { archivedSessionIds: [], async archiveSession(id) { calls.push(id); this.archivedSessionIds.push(id) } }
  const services = { sessionQuery: { async listSessions() { return records } }, workspaceRegistry: registry }
  const ctx = { get: key => services[key], on: (key, fn) => { listeners.set(key, fn); return () => listeners.delete(key) }, effect: fn => disposers.push(fn()) }
  const routes = createSessionsRoutes({ ctx, sessionIsLive: () => false })
  const invoke = (key, payload) => routes[key].handle(payload)
  return { invoke, calls, records, registry, services, listeners, emit: info => listeners.get('worktree/cleanup')(info), dispose: () => disposers.forEach(fn => fn()) }
}

test('archive requires a one-time Host plan; preview is read-only and rejects ID override', async () => {
  const f = fixture()
  assert.equal((await f.invoke('sessions-archive', { id: 'a' })).error, 'archive-confirmation-required')
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a', 'a'] })
  assert.equal(plan.value.sessions.length, 1)
  assert.equal(plan.value.sessions[0].worktree, 'unknown')
  assert.deepEqual(f.calls, [])
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId, id: 'b' })).ok, false)
  const result = await f.invoke('sessions-archive', { planId: plan.value.planId })
  assert.equal(result.value.results[0].archived, true)
  assert.equal(result.value.results[0].cleanup.status, 'unknown')
  assert.deepEqual(f.calls, ['a'])
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).error, 'unknown-archive-plan')
})

test('archive expired, changed, live, missing and disposed plans never execute', async () => {
  const f = fixture()
  assert.equal((await f.invoke('sessions-archive-plan', { ids: ['missing'] })).ok, false)
  assert.equal((await f.invoke('sessions-archive-plan', { ids: Array(201).fill('a') })).ok, false)
  let plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  f.records[0].header.cwd = '/changed'
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).error, 'archive-plan-stale')
  f.records[0].live = true
  assert.equal((await f.invoke('sessions-archive-plan', { ids: ['a'] })).error, 'live-session-rejected')
  f.records[0].live = false
  plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  const original = Date.now
  try {
    Date.now = () => plan.value.expiresAt
    assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).error, 'archive-plan-expired')
  } finally { Date.now = original }
  plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  f.dispose()
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).ok, false)
  assert.deepEqual(f.calls, [])
})

test('archive batch reports partial failure without rollback; cleanup events are revision guarded', async () => {
  const f = fixture()
  f.registry.archiveSession = async id => {
    if (id === 'b') { const error = new Error('active'); error.name = 'WorkspaceActiveSessionError'; throw error }
    f.registry.archivedSessionIds.push(id)
    f.emit({ sessionId: id, path: '/checkout', cleanup: { revision: 2, status: 'scheduled' } })
  }
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a', 'b'] })
  const result = await f.invoke('sessions-archive', { planId: plan.value.planId })
  assert.deepEqual(result.value.results.map(item => item.archived), [true, false])
  assert.equal(result.value.results[1].error, 'active-session-rejected')
  for (const cleanup of [{ revision: 2, status: 'removed' }, { revision: 1, status: 'retained' }, { revision: 2, status: 'scheduled' }]) f.emit({ sessionId: 'a', cleanup })
  let status = await f.invoke('sessions-archive-status', { ids: ['a'] })
  assert.equal(status.value.items[0].cleanup.status, 'removed')
  f.registry.archivedSessionIds = []
  status = await f.invoke('sessions-archive-status', { ids: ['a'] })
  assert.equal(status.value.items[0].cleanup.status, 'unknown', 'unarchive never claims files restored')
})


test('preview sanitizes backend failures, returns titles, and releases cleanup listener', async () => {
  const f = fixture()
  f.services.sessionQuery.readTitleSnapshots = async ids => ids.map(sessionId => ({ sessionId, status: 'fulfilled', value: { title: { title: 'Recognizable title' } } }))
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  assert.equal(plan.value.sessions[0].title, 'Recognizable title')
  assert.equal(plan.value.sessions[0].archived, false)
  f.services.sessionQuery.listSessions = async () => { throw new Error('/secret/backend/path') }
  assert.equal(JSON.stringify(await f.invoke('sessions-archive-plan', { ids: ['a'] })).includes('/secret'), false)
  f.dispose()
  assert.equal(f.listeners.has('worktree/cleanup'), false)
})

test('concurrent preview requests cannot exceed plan limit', async () => {
  const f = fixture()
  const results = await Promise.all(Array.from({ length: 120 }, () => f.invoke('sessions-archive-plan', { ids: ['a'] })))
  assert.equal(results.filter(result => result.ok).length, 100)
  assert.equal(results.filter(result => result.error === 'archive-plan-limit').length, 20)
})


test('archive candidate follows strict owned records and is revalidated', async () => {
  const f = fixture()
  const candidate = { path: '/owned', branch: 'topic', baseCommit: 'abc', repositoryRoot: '/repo' }
  const record = (seq, data, ignorable = true) => ({ type: 'plugin:worktree/created', seq, ignorable, data })
  const snapshot = { inheritedEventCount: 5, events: [record(1, { ...candidate, path: '/inherited' }), record(5, { ...candidate, extra: true }), record(6, candidate, false), record(7, candidate), record(8, { ...candidate, path: '/later' })] }
  f.services.sessionQuery.readSession = async () => snapshot
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  assert.equal(plan.value.sessions[0].worktree, 'candidate')
  assert.deepEqual(plan.value.sessions[0].worktreeCandidate, candidate)
  snapshot.events[3].data = { ...candidate, path: '/changed' }
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).error, 'archive-plan-stale')
  assert.deepEqual(f.calls, [])
  snapshot.events = [record(1, candidate)]
  assert.equal((await f.invoke('sessions-archive-plan', { ids: ['a'] })).value.sessions[0].worktree, 'none-recorded')
  delete snapshot.inheritedEventCount
  assert.equal((await f.invoke('sessions-archive-plan', { ids: ['a'] })).value.sessions[0].worktree, 'unknown')
  f.services.sessionQuery.readSession = async () => { throw new Error('backend unavailable') }
  assert.equal((await f.invoke('sessions-archive-plan', { ids: ['a'] })).ok, false)
})
