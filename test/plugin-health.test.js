import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PLUGIN_FIBER_STATE,
  collectPluginHealth,
  issueLevelOf,
  pluginCheckItem,
  restartPluginEntry,
} from '../plugin-health.js'

function createFakeCtx(loader) {
  return {
    get(service) {
      return service === 'loader' ? loader : undefined
    },
  }
}

function createFakeEntry({ id, name, group = false, disabled = false, state = null, inject = {}, store = null, error = null, restart = async () => {} }) {
  return {
    id,
    disabled,
    options: { name, group },
    fiber: state === null ? undefined : {
      state,
      inject,
      store,
      _error: error,
      async restart() { return restart() },
    },
  }
}

test('issueLevelOf maps only abnormal phases to error/warning', () => {
  assert.equal(issueLevelOf('failed'), 'error')
  assert.equal(issueLevelOf('pending'), 'warning')
  assert.equal(issueLevelOf('loading'), 'warning')
  assert.equal(issueLevelOf('unloading'), 'warning')
  assert.equal(issueLevelOf('active'), null)
  assert.equal(issueLevelOf('disabled'), null)
  assert.equal(issueLevelOf(undefined), null)
})

test('collectPluginHealth reports only abnormal enabled plugins and total counts', async () => {
  const loader = {
    ctx: { baseUrl: 'file:///home/node/.dsh/profiles/web/' },
    entries() {
      return [
        createFakeEntry({ id: 'group-root', name: 'group', group: true }),
        createFakeEntry({ id: 'ok-official', name: '@deepseek-ai/dsh-llm', state: PLUGIN_FIBER_STATE.ACTIVE }),
        createFakeEntry({ id: 'ok-custom', name: 'dsh-dream-skin', state: PLUGIN_FIBER_STATE.ACTIVE, inject: { tools: null }, store: { tools: {} } }),
        createFakeEntry({ id: 'failed', name: 'dshmarket', state: PLUGIN_FIBER_STATE.FAILED, inject: {}, store: null, error: new Error('boom: bad config') }),
        createFakeEntry({ id: 'pending', name: '@scope/pending', state: PLUGIN_FIBER_STATE.PENDING, inject: { settings: null, credentials: null }, store: { credentials: {} } }),
        createFakeEntry({ id: 'loading', name: 'pkg-loading', state: PLUGIN_FIBER_STATE.LOADING, inject: {}, store: {} }),
        createFakeEntry({ id: 'unloading', name: 'pkg-unload', state: PLUGIN_FIBER_STATE.UNLOADING, inject: {}, store: {} }),
        createFakeEntry({ id: 'off-official', name: '@deepseek-ai/dsh-tool-fs', disabled: true }),
        createFakeEntry({ id: 'off-custom', name: 'dsh-off', disabled: true, state: PLUGIN_FIBER_STATE.FAILED, error: new Error('should not surface') }),
        createFakeEntry({ id: 'nofiber', name: 'pkg-nofiber' }),
      ]
    },
  }
  const report = await collectPluginHealth(createFakeCtx(loader))
  assert.equal(report.available, true)
  // 停用条目（无论内置/自定义）不进总统计；group 跳过；active 不出现在 issues。
  assert.equal(report.total, 7)
  const byId = new Map(report.issues.map((issue) => [issue.entryId, issue]))
  assert.equal(report.issues.length, 5)
  assert.deepEqual(byId.get('failed'), { entryId: 'failed', moduleName: 'dshmarket', phase: 'failed', error: 'boom: bad config' })
  assert.deepEqual(byId.get('pending'), { entryId: 'pending', moduleName: '@scope/pending', phase: 'pending', missingDeps: ['settings'] })
  assert.equal(byId.get('loading').phase, 'loading')
  assert.equal(byId.get('unloading').phase, 'unloading')
  assert.deepEqual(byId.get('nofiber'), { entryId: 'nofiber', moduleName: 'pkg-nofiber', phase: 'loading' }, 'enabled entry without a fiber counts as loading')
  assert.equal(byId.has('ok-official'), false)
  assert.equal(byId.has('ok-custom'), false)
  assert.equal(byId.has('off-custom'), false, 'a failed fiber on a disabled entry is not an issue')
})

test('collectPluginHealth degrades when the loader service is absent', async () => {
  const report = await collectPluginHealth(createFakeCtx(undefined))
  assert.deepEqual(report, { available: false, total: 0, issues: [] })
})

test('pluginCheckItem aggregates failed and pending counts into a three-segment detail', () => {
  const report = {
    available: true,
    total: 4,
    issues: [
      { entryId: 'a', phase: 'failed' },
      { entryId: 'b', phase: 'pending' },
      { entryId: 'c', phase: 'loading' },
    ],
  }
  assert.deepEqual(pluginCheckItem(report), { id: 'plugins', status: 'error', detail: '4:1:2' })
  assert.deepEqual(pluginCheckItem({ total: 3, issues: [{ entryId: 'b', phase: 'pending' }] }), { id: 'plugins', status: 'warning', detail: '3:0:1' })
  assert.deepEqual(pluginCheckItem({ total: 5, issues: [] }), { id: 'plugins', status: 'ok', detail: '5:0:0' }, 'disabled entries are not part of the counts')
})

test('restartPluginEntry only restarts failed fibers of listed entries', async () => {
  const restarted = []
  const loader = {
    entries() {
      return [
        createFakeEntry({ id: 'g', name: 'group', group: true, state: PLUGIN_FIBER_STATE.FAILED }),
        createFakeEntry({ id: 'ok', name: 'pkg-ok', state: PLUGIN_FIBER_STATE.ACTIVE }),
        createFakeEntry({ id: 'broken', name: 'pkg-broken', state: PLUGIN_FIBER_STATE.FAILED, error: new Error('x'), restart: async () => { restarted.push('broken') } }),
        createFakeEntry({ id: 'disabled', name: 'pkg-off', disabled: true, state: PLUGIN_FIBER_STATE.FAILED }),
        createFakeEntry({ id: 'empty', name: 'pkg-empty' }),
      ]
    },
  }
  assert.deepEqual(await restartPluginEntry(createFakeCtx(undefined), 'broken'), { ok: false, code: 'loader-unavailable' })
  assert.deepEqual(await restartPluginEntry(createFakeCtx(loader), 'nope'), { ok: false, code: 'unknown-plugin' })
  assert.deepEqual(await restartPluginEntry(createFakeCtx(loader), 42), { ok: false, code: 'unknown-plugin' })
  assert.deepEqual(await restartPluginEntry(createFakeCtx(loader), 'g'), { ok: false, code: 'unknown-plugin' }, 'group entries are not restart targets')
  assert.deepEqual(await restartPluginEntry(createFakeCtx(loader), 'disabled'), { ok: false, code: 'plugin-disabled' })
  assert.deepEqual(await restartPluginEntry(createFakeCtx(loader), 'ok'), { ok: false, code: 'not-failed' })
  assert.deepEqual(await restartPluginEntry(createFakeCtx(loader), 'empty'), { ok: false, code: 'not-failed' })
  assert.deepEqual(await restartPluginEntry(createFakeCtx(loader), 'broken'), { ok: true })
  assert.deepEqual(restarted, ['broken'])
})

test('restartPluginEntry surfaces a still-failing reload as restart-failed', async () => {
  const loader = {
    entries() {
      return [createFakeEntry({ id: 'broken', name: 'pkg-broken', state: PLUGIN_FIBER_STATE.FAILED, error: new Error('old'), restart: async () => { throw new Error('still broken') } })]
    },
  }
  const result = await restartPluginEntry(createFakeCtx(loader), 'broken')
  assert.deepEqual(result, { ok: false, code: 'restart-failed', error: 'still broken' })
})