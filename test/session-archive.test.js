import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionsRoutes } from '../session-routes.js'

function fixture({ persistenceListSnapshots, sessionTitleCache } = {}) {
  const listeners = new Map()
  const disposers = []
  const calls = []
  const records = ['a', 'b'].map(id => ({ header: { id, cwd: '/workspace/' + id, createdAt: 1 }, live: false }))
  const registry = { archivedSessionIds: [], async archiveSession(id) { calls.push(id); this.archivedSessionIds.push(id) } }
  const services = { sessionQuery: { async listSessions() { return records } }, workspaceRegistry: registry }
  const ctx = { get: key => services[key], on: (key, fn) => { listeners.set(key, fn); return () => listeners.delete(key) }, effect: fn => disposers.push(fn()) }
  // persistenceListSnapshots 是兼容夹具：现实现已不使用，保留注入以便同一组用例
  // 能在修复前的 revision 快路上复现红测（塌成 `{}` 的缺失 revision / 读取后新 revision）。
  const routes = createSessionsRoutes({ ctx, sessionIsLive: () => false, persistenceListSnapshots, sessionTitleCache })
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

test('archive submit re-reads and strictly revalidates the preview', async () => {
  const f = fixture()
  // 模拟持久化清单存在但没有 revision：perf 版会把两次 undefined 折成 `{}` 误判未变化。
  f.services.sessionPersistence = { async listSnapshots() { return [{ header: { id: 'a' } }] } }
  let reads = 0
  let titleReads = 0
  let title = 'Preview title'
  f.services.sessionQuery.readSession = async () => { reads += 1; return { inheritedEventCount: 0, events: [] } }
  f.services.sessionQuery.readTitleSnapshots = async ids => {
    titleReads += 1
    return ids.map(sessionId => ({ sessionId, status: 'fulfilled', value: { title: { title } } }))
  }
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  assert.equal(plan.value.sessions[0].title, 'Preview title')
  assert.equal(reads, 1)
  assert.equal(titleReads, 1)
  // 预览对象不得携带内部 revision 等缓存字段。
  assert.deepEqual(Object.keys(plan.value).sort(), ['cleanup', 'consequences', 'expiresAt', 'planId', 'sessions'].sort())
  const result = await f.invoke('sessions-archive', { planId: plan.value.planId })
  assert.equal(result.value.results[0].archived, true)
  assert.equal(reads, 2, 'submit must re-read the session log')
  assert.equal(titleReads, 2, 'submit must re-read the official title snapshots')
})

test('archive confirmation rejects a changed title without consulting the stale title cache', async () => {
  const f = fixture({ sessionTitleCache: new Map([['a', { title: 'Stale cached title', revision: 'r1' }]]) })
  let title = 'Preview title'
  f.services.sessionQuery.readTitleSnapshots = async ids => ids.map(sessionId => ({ sessionId, status: 'fulfilled', value: { title: { title } } }))
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  assert.equal(plan.value.sessions[0].title, 'Preview title', 'archive preview uses official snapshots, not the cache')
  title = 'Changed title'
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).error, 'archive-plan-stale')
  assert.deepEqual(f.calls, [])
})

test('archive confirmation rejects a changed log even when persistence exposes no revision', async () => {
  const f = fixture({ persistenceListSnapshots: async service => service.listSnapshots() })
  f.services.sessionPersistence = { async listSnapshots() { return [{ header: { id: 'a' } }] } }
  let snapshot = { inheritedEventCount: 0, events: [] }
  f.services.sessionQuery.readSession = async () => snapshot
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  assert.equal(plan.value.sessions[0].worktree, 'none-recorded')
  snapshot = { inheritedEventCount: 0, events: [{ type: 'plugin:worktree/created', seq: 1, ignorable: true, data: { path: '/new', branch: 'topic', baseCommit: 'abc', repositoryRoot: '/repo' } }] }
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).error, 'archive-plan-stale')
  assert.deepEqual(f.calls, [])
})

test('archive confirmation rejects a log change landing between the preview read and revision capture', async () => {
  let revisions = { a: 'r1' }
  const f = fixture({ persistenceListSnapshots: async () => Object.entries(revisions).map(([id, revision]) => ({ header: { id }, revision })) })
  f.services.sessionPersistence = {}
  let snapshot = { inheritedEventCount: 0, events: [] }
  let reads = 0
  f.services.sessionQuery.readSession = async () => {
    reads += 1
    const current = snapshot
    // 旧实现先读清单、再读日志、最后才取 revision；这里模拟日志在两次观测之间前进到 r2。
    if (reads === 1) revisions = { a: 'r2' }
    return current
  }
  f.services.sessionQuery.readTitleSnapshots = async ids => ids.map(sessionId => ({ sessionId, status: 'fulfilled', value: { title: { title: 'Preview title' } } }))
  const plan = await f.invoke('sessions-archive-plan', { ids: ['a'] })
  assert.equal(plan.value.sessions[0].worktree, 'none-recorded')
  snapshot = { inheritedEventCount: 0, events: [{ type: 'plugin:worktree/created', seq: 1, ignorable: true, data: { path: '/new', branch: 'topic', baseCommit: 'abc', repositoryRoot: '/repo' } }] }
  assert.equal((await f.invoke('sessions-archive', { planId: plan.value.planId })).error, 'archive-plan-stale')
  assert.deepEqual(f.calls, [])
})

test('archive confirmation rechecks identity state and disposal after awaits', async () => {
  const archived = fixture()
  const archivedPlan = await archived.invoke('sessions-archive-plan', { ids: ['a'] })
  archived.registry.archivedSessionIds = ['a']
  assert.equal((await archived.invoke('sessions-archive', { planId: archivedPlan.value.planId })).error, 'archive-plan-stale')
  assert.deepEqual(archived.calls, [])

  const disposed = fixture()
  let reads = 0
  disposed.services.sessionQuery.readSession = async () => {
    reads += 1
    if (reads === 2) disposed.dispose()
    return { inheritedEventCount: 0, events: [] }
  }
  const disposedPlan = await disposed.invoke('sessions-archive-plan', { ids: ['a'] })
  assert.equal((await disposed.invoke('sessions-archive', { planId: disposedPlan.value.planId })).error, 'archive-plan-stale')
  assert.deepEqual(disposed.calls, [])
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
