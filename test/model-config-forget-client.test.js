import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 直接加载客户端源码，而不是已构建的 client.js：本用例只验证最近删除记录的
// 交互契约，不能在测试时要求先构建产物。
const configSource = readFileSync(new URL('../src/client/model-config.js', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../src/client/model-config-i18n.js', import.meta.url), 'utf8')
const dictionaries = new Function('zh', 'en', `${i18nSource}\nreturn { zh, en }`)({}, {})
const identityStyle = () => ({})
const loadConfigFactory = new Function(
  'React', 'require', 'svcButtonStyle', 'svcRowActionStyle', 'svcBadgeStyle', 'fullRound',
  `${configSource}\nreturn createModelConfig`,
)

function createHarness({ snapshot, handlers = {}, locale = 'zh' }) {
  const calls = []
  const translate = (key, params = {}) => {
    const text = dictionaries[locale][key] ?? key
    return text.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match)
  }
  const rpcCall = async (endpoint, payload = {}) => {
    calls.push({ endpoint, payload })
    if (endpoint === 'models3-snapshot') return { ok: true, value: typeof snapshot === 'function' ? snapshot() : snapshot }
    const handler = handlers[endpoint]
    if (handler === undefined) return { ok: true, value: {} }
    return typeof handler === 'function' ? handler(payload) : handler
  }

  const hooks = new Map()
  let current = null
  let cursor = 0
  let dirty = false
  let pendingEffects = []
  let root

  const hookStore = () => {
    if (!hooks.has(current)) hooks.set(current, { values: [], refs: [], effects: new Map() })
    return hooks.get(current)
  }

  const React = {
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props || {}),
          ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}),
        },
        children,
      }
    },
    useState(initial) {
      const store = hookStore()
      const index = cursor++
      if (!(index in store.values)) store.values[index] = initial
      return [store.values[index], (value) => {
        const next = typeof value === 'function' ? value(store.values[index]) : value
        if (!Object.is(next, store.values[index])) {
          store.values[index] = next
          dirty = true
        }
      }]
    },
    useEffect(effect, dependencies) {
      const store = hookStore()
      const index = cursor++
      pendingEffects.push({ store, index, effect, dependencies })
    },
    useRef(initial) {
      const store = hookStore()
      const index = cursor++
      if (!(index in store.refs)) store.refs[index] = { current: initial }
      return store.refs[index]
    },
  }

  const requireStub = (name) => {
    assert.equal(name, '@deepseek-ai/dsh-client-ui-primitives')
    return { Modal: (props) => React.createElement('section', { 'data-testid': 'mock-modal', onClose: props.onClose }, props.title, props.children, props.footer) }
  }
  const createModelConfig = loadConfigFactory(React, requireStub, identityStyle, identityStyle, identityStyle, identityStyle)
  const { ModelsSection } = createModelConfig({
    useTranslation: () => translate,
    rpcCall,
    SvcTabs: () => null,
    useFeatures: () => ({ value: { modelCatalog: true, subagentRoute: false, modelProviderIcons: false } }),
    modelsNavToggle: undefined,
  })

  function renderNode(node) {
    if (Array.isArray(node)) return node.map(renderNode)
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (typeof node.type === 'function') {
      const previousComponent = current
      const previousCursor = cursor
      current = node.type
      cursor = 0
      const output = node.type(node.props)
      current = previousComponent
      cursor = previousCursor
      return renderNode(output)
    }
    return { ...node, children: renderNode(node.children) }
  }

  async function runEffects() {
    for (const entry of pendingEffects) {
      const previous = entry.store.effects.get(entry.index)
      const changed = previous === undefined
        || entry.dependencies === undefined
        || previous.length !== entry.dependencies.length
        || entry.dependencies.some((value, index) => !Object.is(value, previous[index]))
      if (!changed) continue
      entry.store.effects.set(entry.index, entry.dependencies === undefined ? undefined : entry.dependencies.slice())
      entry.effect()
    }
  }

  async function flush() {
    for (let round = 0; round < 12; round += 1) {
      dirty = false
      pendingEffects = []
      cursor = 0
      root = renderNode(React.createElement(ModelsSection, { SubagentSection: () => null }))
      await runEffects()
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (!dirty) return
    }
    throw new Error('client render did not settle')
  }

  function find(node, id) {
    if (node === null || node === undefined || typeof node !== 'object') return undefined
    if (Array.isArray(node)) {
      for (const child of node) {
        const match = find(child, id)
        if (match !== undefined) return match
      }
      return undefined
    }
    if (node.props?.['data-testid'] === id) return node
    for (const child of node.children || []) {
      const match = find(child, id)
      if (match !== undefined) return match
    }
    for (const value of Object.values(node.props || {})) {
      if (value === null || typeof value !== 'object') continue
      const match = find(value, id)
      if (match !== undefined) return match
    }
    return undefined
  }

  function text(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (Array.isArray(node)) return node.map(text).join('')
    if (typeof node !== 'object') return String(node)
    return (node.children || []).map(text).join('')
  }

  return {
    calls,
    flush,
    find: (id) => find(root, id),
    text: () => text(root),
    async click(id) {
      const node = find(root, id)
      assert.ok(node, `control ${id} was rendered`)
      await node.props.onClick()
      await flush()
    },
  }
}

const removedSnapshot = (rows) => ({ routes: [], templates: [], removedRoutes: rows })
const byEndpoint = (calls, endpoint) => calls.filter((call) => call.endpoint === endpoint)

test('recently deleted records offer restore or record deletion, with an explicit irreversible warning and second confirmation', async () => {
  const harness = createHarness({
    snapshot: removedSnapshot([{ route: 'gone', displayName: 'Old Relay', at: 1, taken: false }]),
    handlers: {
      'models3-restore-preview': () => ({ ok: true, value: { planId: 'restore-plan', route: 'gone', restore: { route: 'gone', displayName: 'Old Relay' }, removesRoute: false, credentialValueRestored: false } }),
      'models3-forget-preview': () => ({ ok: true, value: { planId: 'forget-plan', route: 'gone', displayName: 'Old Relay', irreversible: true } }),
      'models3-forget-commit': () => ({ ok: true, value: { route: 'gone', forgotten: true, channelRetained: true, credentialRetained: true } }),
    },
  })
  await harness.flush()

  assert.equal(harness.find('model-removed-gone').props.disabled, false, 'a removable record is clickable')
  await harness.click('model-removed-gone')

  // 原恢复体验保留：先预览恢复后果，再确认。
  assert.deepEqual(byEndpoint(harness.calls, 'models3-restore-preview')[0].payload, { route: 'gone' })
  assert.ok(harness.find('model-restore-confirm'), 'restore confirmation remains available')
  assert.ok(harness.find('model-forget-open'), 'deleting the record is offered next to restore')
  assert.match(harness.text(), /删除保留凭据，恢复不会写回旧密钥/)
  assert.equal(byEndpoint(harness.calls, 'models3-forget-preview').length, 0, 'opening the record does not start deletion')

  await harness.click('model-forget-open')
  assert.deepEqual(byEndpoint(harness.calls, 'models3-forget-preview')[0].payload, { route: 'gone' })

  // 首次确认弹层必须明确：记录不可恢复，且不修改渠道与密钥。
  assert.ok(harness.find('model-forget-dialog'), 'the deletion confirmation is rendered')
  assert.match(harness.text(), /该记录删除后无法恢复/)
  assert.match(harness.text(), /不会修改或删除当前渠道配置/)
  assert.match(harness.text(), /不会修改或删除 API 密钥/)
  assert.equal(byEndpoint(harness.calls, 'models3-forget-commit').length, 0, 'the plan is not committed before the second confirmation')

  await harness.click('model-forget-confirm')
  assert.deepEqual(byEndpoint(harness.calls, 'models3-forget-commit')[0].payload, { planId: 'forget-plan' })
  assert.equal(harness.find('model-forget-dialog'), undefined, 'the confirmation closes after commit')
  assert.match(harness.text(), /最近删除记录已删除；渠道配置与密钥未变更。/)

  const endpoints = harness.calls.map((call) => call.endpoint)
  assert.equal(endpoints.includes('models3-remove-commit'), false, 'forgetting a record never deletes a channel')
  assert.equal(endpoints.includes('models3-restore-commit'), false, 'forgetting a record never restores a channel')
  assert.equal(endpoints.some((endpoint) => endpoint.includes('credential')), false, 'forgetting a record never touches credentials')
})

test('cancelling the confirmation does not delete the record', async () => {
  const harness = createHarness({
    snapshot: removedSnapshot([{ route: 'gone', displayName: 'Old Relay', taken: false }]),
    handlers: { 'models3-forget-preview': { ok: true, value: { planId: 'forget-plan', route: 'gone', displayName: 'Old Relay' } } },
  })
  await harness.flush()
  await harness.click('model-removed-gone')
  await harness.click('model-forget-open')
  harness.find('mock-modal').props.onClose()
  await harness.flush()
  assert.equal(harness.find('model-forget-dialog'), undefined)
  assert.equal(byEndpoint(harness.calls, 'models3-forget-commit').length, 0)
})

test('an occupied provider ID can still have its recently deleted record removed', async () => {
  const harness = createHarness({
    snapshot: removedSnapshot([{ route: 'taken-route', displayName: 'Busy Relay', at: 2, taken: true }]),
    handlers: {
      'models3-forget-preview': () => ({ ok: true, value: { planId: 'forget-taken', route: 'taken-route', displayName: 'Busy Relay', irreversible: true } }),
      'models3-forget-commit': () => ({ ok: true, value: { route: 'taken-route', forgotten: true } }),
    },
  })
  await harness.flush()

  assert.equal(harness.find('model-removed-taken-route').props.disabled, false, 'an occupied ID record is not disabled')
  await harness.click('model-removed-taken-route')
  assert.equal(byEndpoint(harness.calls, 'models3-restore-preview').length, 0, 'restore is not previewed while the ID is occupied')
  assert.equal(harness.find('model-restore-confirm'), undefined, 'no restore confirmation is offered')
  assert.match(harness.text(), /渠道 ID「taken-route」当前已被占用/)
  assert.match(harness.text(), /仍可删除记录/)
  assert.ok(harness.find('model-forget-open'), 'record deletion remains available')

  await harness.click('model-forget-open')
  assert.deepEqual(byEndpoint(harness.calls, 'models3-forget-preview')[0].payload, { route: 'taken-route' })
  assert.ok(harness.find('model-forget-taken'), 'the confirmation explains the occupied ID')
  assert.match(harness.text(), /不会影响正在使用该 ID 的渠道/)

  await harness.click('model-forget-confirm')
  assert.deepEqual(byEndpoint(harness.calls, 'models3-forget-commit')[0].payload, { planId: 'forget-taken' })
  assert.equal(byEndpoint(harness.calls, 'models3-restore-commit').length, 0)
  assert.equal(byEndpoint(harness.calls, 'models3-remove-commit').length, 0)
})

test('restoring a recently deleted record keeps its two-phase plan flow', async () => {
  const harness = createHarness({
    snapshot: removedSnapshot([{ route: 'restorable', displayName: 'Restorable Relay', at: 3, taken: false }]),
    handlers: {
      'models3-restore-preview': () => ({ ok: true, value: { planId: 'restore-kept', route: 'restorable', restore: { route: 'restorable', displayName: 'Restorable Relay' }, removesRoute: false, credentialValueRestored: false } }),
      'models3-restore-commit': () => ({ ok: true, value: { route: 'restorable', saved: true, undoable: true } }),
    },
  })
  await harness.flush()
  await harness.click('model-removed-restorable')

  assert.deepEqual(byEndpoint(harness.calls, 'models3-restore-preview')[0].payload, { route: 'restorable' })
  assert.match(harness.text(), /删除保留凭据，恢复不会写回旧密钥/)
  await harness.click('model-restore-confirm')
  assert.deepEqual(byEndpoint(harness.calls, 'models3-restore-commit')[0].payload, { planId: 'restore-kept' })
  assert.equal(byEndpoint(harness.calls, 'models3-forget-preview').length, 0)
  assert.equal(byEndpoint(harness.calls, 'models3-forget-commit').length, 0)
})

test('record deletion copy exists in Chinese and English and states the irreversible boundary', () => {
  const keys = ['forgetRecordOpen', 'forgetRecordTitle', 'forgetRecordPrompt', 'forgetRecordBoundary', 'forgetRecordTaken', 'forgetRecordConfirm', 'forgetRecordDone']
  for (const key of keys) {
    assert.equal(typeof dictionaries.zh[`models.smart.${key}`], 'string', `zh copy for ${key}`)
    assert.equal(typeof dictionaries.en[`models.smart.${key}`], 'string', `en copy for ${key}`)
  }
  assert.match(dictionaries.zh['models.smart.forgetRecordPrompt'], /无法恢复/)
  assert.match(dictionaries.zh['models.smart.forgetRecordBoundary'], /不会修改或删除当前渠道配置/)
  assert.match(dictionaries.zh['models.smart.forgetRecordBoundary'], /API 密钥/)
  assert.match(dictionaries.en['models.smart.forgetRecordPrompt'], /cannot be recovered/)
  assert.match(dictionaries.en['models.smart.forgetRecordBoundary'], /does not modify or delete the current provider configuration/)
  assert.match(dictionaries.en['models.smart.forgetRecordBoundary'], /API credentials/)
})
