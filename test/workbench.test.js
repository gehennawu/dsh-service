import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createModelWorkbenchRoutes } from '../model-workbench-routes.js'
import { assertPublicHost, modelsProbeLookup } from '../model-workbench.js'

import {
  WORKBENCH_SIDECAR_VERSION,
  applySuggestions,
  applyUndo,
  arbitrateModelSuggestions,
  abilityPatch,
  createFreshnessManager,
  createWorkbenchStore,
  diffModelLists,
  emptyWorkbenchSidecar,
  indexModelParamsDev,
  isPrivateIpAddress,
  loadModelParamsSnapshot,
  loadWorkbenchSidecar,
  modelParamsCandidates,
  modelParamsDevEfforts,
  openRouterModelFacts,
  openRouterVerifySource,
  pickOpenRouterMatch,
  probeBaseURLCheck,
  profileFingerprint,
  saveWorkbenchSidecar,
  selfCheckModelsPatch,
  suggestionId,
  undoPreviewModels,
} from '../index.js'

const SIDECAR = 'dsh-service-model-workbench.json'

test('workbench sidecar: roundtrip persists partitions and 0600 mode', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-workbench-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await saveWorkbenchSidecar(dshHome, { ...emptyWorkbenchSidecar(), bindings: { cpa: { 'm1': { source: 'pi-ai', providerId: 'x' } } } })
  const raw = JSON.parse(await readFile(join(dshHome, SIDECAR), 'utf8'))
  assert.equal(raw.schemaVersion, WORKBENCH_SIDECAR_VERSION)
  const info = await stat(join(dshHome, SIDECAR))
  assert.equal(info.mode & 0o777, 0o600, 'sidecar is owner-only')
  const loaded = await loadWorkbenchSidecar(dshHome)
  assert.deepEqual(loaded.bindings.cpa.m1, { source: 'pi-ai', providerId: 'x' })
  assert.deepEqual(loaded.undo, {})
})

test('workbench sidecar: corrupt or wrong-version files fail closed to an empty store', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-workbench-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, SIDECAR), 'not json at all', 'utf8')
  assert.deepEqual(await loadWorkbenchSidecar(dshHome), emptyWorkbenchSidecar())
  await writeFile(join(dshHome, SIDECAR), JSON.stringify({ schemaVersion: 99, providers: { stale: true } }), 'utf8')
  assert.deepEqual(await loadWorkbenchSidecar(dshHome), emptyWorkbenchSidecar())
  await writeFile(join(dshHome, SIDECAR), JSON.stringify({ schemaVersion: 1, providers: ['array'] }), 'utf8')
  const loaded = await loadWorkbenchSidecar(dshHome)
  assert.deepEqual(loaded.providers, {}, 'array partitions rejected')
})

test('workbench sidecar: failed save keeps the in-memory partition state', async (t) => {
  const notADir = join(tmpdir(), `dsh-service-workbench-notdir-${process.pid}-${Date.now()}`)
  await writeFile(notADir, 'not a directory')
  t.after(() => rm(notADir, { recursive: true, force: true }))
  const store = createWorkbenchStore(notADir)
  await assert.rejects(() => store.mutate((sidecar) => { sidecar.bindings.cpa = { m: { source: 'pi-ai' } } }))
})

test('workbench sidecar: serialized writes do not clobber each other', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-workbench-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const store = createWorkbenchStore(dshHome)
  await Promise.all([
    store.mutate((sidecar) => { sidecar.bindings.a = { m: { source: 'pi-ai' } } }),
    store.mutate((sidecar) => { sidecar.bindings.b = { m: { source: 'models-dev' } } }),
    store.mutate((sidecar) => { sidecar.bindings.c = { m: { source: 'pi-ai' } } }),
  ])
  const loaded = await loadWorkbenchSidecar(dshHome)
  for (const key of ['a', 'b', 'c']) assert.ok(loaded.bindings[key], `partition ${key} survived concurrent writes`)
})

test('workbench fingerprint: stable across key order, sensitive to every field', () => {
  const base = { route: 'cpa', api: 'openai-completions', models: [{ id: 'm1', input: ['text', 'image'], vendor: { keep: 1 } }] }
  const reordered = { models: [{ vendor: { keep: 1 }, input: ['text', 'image'], id: 'm1' }], api: 'openai-completions', route: 'cpa' }
  assert.equal(profileFingerprint(base), profileFingerprint(reordered), 'key order must not change the fingerprint')
  assert.notEqual(profileFingerprint(base), profileFingerprint({ ...base, models: [{ id: 'm1', input: ['text', 'image'], vendor: { keep: 2 } }] }), 'nested unknown fields count')
  assert.notEqual(profileFingerprint(base), profileFingerprint({ ...base, models: [{ id: 'm1', input: ['text'] }] }))
})

test('workbench arbitration: classifies safe fills, conflicts, additions and unknown models', () => {
  const currentModels = [
    { id: 'configured-bare', name: 'Mine' },
    { id: 'configured-complete', name: 'Full', contextWindow: 1000, maxTokens: 500, input: ['text', 'image'], reasoningEfforts: { off: null, high: 'high' } },
    { id: 'private-model', name: 'Private' },
  ]
  const gatewayModels = [
    { id: 'configured-bare' },
    { id: 'configured-complete' },
    { id: 'private-model' },
    { id: 'gateway-new', name: 'Gateway New' },
  ]
  const catalog = {
    'configured-bare': { source: 'pi-ai', providerId: 'chan', baseUrl: 'https://gw.example.com/v1', contextWindow: 4096, reasoningEfforts: { off: null, high: 'high' }, dropped: [] },
    'configured-complete': { source: 'models-dev', providerId: 'prov', baseUrl: 'https://other.example.com/v1', contextWindow: 9999, dropped: [] },
    'gateway-new': { source: 'models-dev', providerId: 'prov', baseUrl: 'https://gw.example.com/v1', name: 'Catalog New', contextWindow: 8192, input: ['text'], reasoningEfforts: { off: null, low: 'low' }, dropped: ['super'] },
  }
  const routeBaseURL = 'https://gw.example.com/v1'
  const suggestions = arbitrateModelSuggestions({ route: 'cpa', routeBaseURL, currentModels, gatewayModels, resolveModelMeta: (modelId) => (catalog[modelId] ? [catalog[modelId]] : []) })
  const byKey = (kind, modelId, field) => suggestions.find((row) => row.kind === kind && row.modelId === modelId && (field === undefined || row.field === field))

  const fillContext = byKey('safeFill', 'configured-bare', 'contextWindow')
  assert.ok(fillContext, 'missing capacity on a configured model is a safe fill')
  assert.equal(fillContext.to, 4096)
  assert.equal(fillContext.selected, true, 'high-confidence safe fills default selected')
  const fillEfforts = byKey('safeFill', 'configured-bare', 'reasoningEfforts')
  assert.ok(fillEfforts, 'missing reasoning map is a safe fill')

  const conflictContext = byKey('conflict', 'configured-complete', 'contextWindow')
  assert.ok(conflictContext, 'differing capacity is a conflict suggestion')
  assert.equal(conflictContext.from, 1000)
  assert.equal(conflictContext.to, 9999)
  assert.equal(conflictContext.selected, false, 'conflicts default unselected')
  assert.equal(conflictContext.source.confidence, 'low', 'cross-provider id matches need confirmation')

  const addition = suggestions.find((row) => row.kind === 'addition' && row.modelId === 'gateway-new')
  assert.ok(addition, 'gateway-only models are additions')
  assert.equal(addition.selected, false, 'additions default unselected')
  assert.deepEqual(addition.draft.reasoningEfforts, { off: null, low: 'low' })
  assert.deepEqual(addition.inexpressible, ['super'], 'dropped levels surface as inexpressible')

  assert.equal(suggestions.some((row) => row.kind === 'unknown' && row.modelId === 'private-model'), true, 'configured-but-unlisted models stay as unknown')
  assert.equal(suggestions.some((row) => row.kind === 'conflict' && row.modelId === 'private-model'), false, 'unknown models never get deletion or overwrite suggestions')
})

test('workbench arbitration: built-in channel fields inherited from the same-channel catalog are not safe fills', () => {
  // 内置渠道（如 opencode-go）：pi-ai 目录条目自带 thinkingLevelMap → 索引已推导 reasoningEfforts。
  // 运行时（dsh-llm-pi-ai resolveRouteModels）对同渠道模型把缺失字段回落到目录 base（含推理能力），
  // 所以「配置缺写 ≠ 能力缺失」——同渠道目录已提供的字段不得再建议 safeFill 补全。
  const catalog = {
    'deepseek-v4-flash': { source: 'pi-ai', providerId: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1', contextWindow: 1000000, maxTokens: 384000, input: ['text'], reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' }, dropped: [] },
  }
  const gatewayModels = [{ id: 'deepseek-v4-flash' }]
  const resolveModelMeta = (modelId) => (catalog[modelId] ? [catalog[modelId]] : [])

  const suggestions = arbitrateModelSuggestions({ route: 'opencode-go', routeBaseURL: 'https://opencode.ai/zen/go/v1', currentModels: [{ id: 'deepseek-v4-flash' }], gatewayModels, resolveModelMeta, bindings: {} })
  assert.equal(suggestions.filter((row) => row.kind === 'safeFill').length, 0, 'same-channel catalog fields are inherited at runtime, not gaps to fill')

  const conflict = arbitrateModelSuggestions({ route: 'opencode-go', routeBaseURL: 'https://opencode.ai/zen/go/v1', currentModels: [{ id: 'deepseek-v4-flash', reasoningEfforts: { off: null, low: 'low' } }], gatewayModels, resolveModelMeta, bindings: {} })
  assert.ok(conflict.some((row) => row.kind === 'conflict' && row.field === 'reasoningEfforts'), 'explicit overrides still surface as conflicts')

  const relay = arbitrateModelSuggestions({ route: 'cpa', routeBaseURL: 'https://relay.example.com/v1', currentModels: [{ id: 'deepseek-v4-flash' }], gatewayModels, resolveModelMeta, bindings: {} })
  assert.ok(relay.some((row) => row.kind === 'safeFill'), 'cross-route catalog matches still need fills (the runtime catalog for cpa is empty)')
})

test('workbench arbitration: built-in reasoning support without a thinkingLevelMap is still inherited, not a fill', () => {
  // 用户反馈（全渠道扫描）：nvidia/openrouter/vercel/qwen-token-plan 等渠道里目录条目
  // 只有 reasoning:true 而无 thinkingLevelMap——运行时对该模型继承基础思考能力（base.reasoning），
  // 目录没有映射 ≠ 缺能力，不得拿别的渠道（如 groq）的映射建议补 reasoningEfforts。
  // 真实 byModelId 桶里同 id 有多个渠道候选，首个是 groq（有映射）——修复前会拿它当 to 建议补。
  const gptOss = [
    { source: 'pi-ai', providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', reasoning: true, reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' }, dropped: [] },
    { source: 'pi-ai', providerId: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', reasoning: true, input: ['text'], dropped: [] },
    { source: 'models-dev', providerId: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', reasoningEfforts: { off: null, low: 'low', high: 'high' }, dropped: [] },
  ]
  const gatewayModels = [{ id: 'openai/gpt-oss-120b' }]
  const resolveModelMeta = (modelId) => gptOss

  const suggestions = arbitrateModelSuggestions({ route: 'nvidia', routeBaseURL: 'https://integrate.api.nvidia.com/v1', currentModels: [{ id: 'openai/gpt-oss-120b' }], gatewayModels, resolveModelMeta, bindings: {} })
  assert.equal(suggestions.filter((row) => row.kind === 'safeFill' && row.field === 'reasoningEfforts').length, 0,
    'same-channel reasoning:true inherits thinking at runtime even without a level map (no fill from sibling channels)')
})

test('workbench arbitration: a same-id model outside its channel still gets the reasoning fill', () => {
  // 同一模型 ID 出现在别的路由（relay cpa）时无同渠道 base，运行时真的缺——补全照常。
  const gptOss = [
    { source: 'pi-ai', providerId: 'groq', baseUrl: 'https://api.groq.com/openai/v1', reasoning: true, reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' }, dropped: [] },
    { source: 'pi-ai', providerId: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', reasoning: true, input: ['text'], dropped: [] },
  ]
  const gatewayModels = [{ id: 'openai/gpt-oss-120b' }]
  const resolveModelMeta = (modelId) => gptOss
  const suggestions = arbitrateModelSuggestions({ route: 'cpa', routeBaseURL: 'https://relay.example.com/v1', currentModels: [{ id: 'openai/gpt-oss-120b' }], gatewayModels, resolveModelMeta, bindings: {} })
  assert.ok(suggestions.some((row) => row.kind === 'safeFill' && row.field === 'reasoningEfforts'), 'cross-route candidates still propose the reasoning fill')
})

test('workbench arbitration: split catalogs never accuse the explicit config; unanimous catalogs do', () => {
  // 用户报告：cpa 的 gpt-5.6-sol 配置了完整思考档（与 opencode/openai 目录一致），
  // 检查却建议改成 off/xhigh/max——to 来自空 baseUrl 的 azure 模板渠道（文件序首个候选）。
  // 多候选无法精确定位时：目录取值互相矛盾 → 任一候选都不代表目录意见，不得断言用户配置有误；
  // 目录取值一致 → 有共识，仍需确认的冲突照常给出（默认不勾）。
  const gatewayModels = [{ id: 'gpt-5.6-sol' }]
  const split = [
    { source: 'pi-ai', providerId: 'azure-openai-responses', baseUrl: '', reasoningEfforts: { off: null, xhigh: 'xhigh', max: 'max' }, dropped: [] },
    { source: 'pi-ai', providerId: 'opencode', baseUrl: 'https://opencode.ai/zen/v1', reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, dropped: [] },
    { source: 'pi-ai', providerId: 'openai', baseUrl: 'https://api.openai.com/v1', reasoningEfforts: { off: 'none', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, dropped: [] },
  ]
  const splitSuggestions = arbitrateModelSuggestions({ route: 'cpa', routeBaseURL: 'https://relay.example.com/v1', currentModels: [{ id: 'gpt-5.6-sol', reasoningEfforts: { off: null, low: 'low' } }], gatewayModels, resolveModelMeta: () => split, bindings: {} })
  assert.equal(splitSuggestions.some((row) => row.kind === 'conflict' && row.field === 'reasoningEfforts'), false,
    'split catalogs cannot claim the explicit config is wrong')

  // 目录一致时才提示：两个候选都只有 off/xhigh/max → 低置信 needsConfirm 冲突照常给出（默认不勾）。
  const unanimous = [
    { source: 'pi-ai', providerId: 'a', baseUrl: 'https://a.example.com/v1', reasoningEfforts: { off: null, xhigh: 'xhigh', max: 'max' }, dropped: [] },
    { source: 'models-dev', providerId: 'b', baseUrl: 'https://b.example.com/v1', reasoningEfforts: { off: null, xhigh: 'xhigh', max: 'max' }, dropped: [] },
  ]
  const uniSuggestions = arbitrateModelSuggestions({ route: 'cpa', routeBaseURL: 'https://relay.example.com/v1', currentModels: [{ id: 'gpt-5.6-sol', reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } }], gatewayModels, resolveModelMeta: () => unanimous, bindings: {} })
  const uniConflict = uniSuggestions.find((row) => row.kind === 'conflict' && row.field === 'reasoningEfforts')
  assert.ok(uniConflict, 'unanimous catalogs still surface a needs-confirm conflict')
  assert.equal(uniConflict.selected, false, 'conflicts stay default-unchecked')
  assert.equal(uniConflict.source.confidence, 'low', 'unpinned ambiguity stays low confidence')
})

test('workbench arbitration: persisted bindings make cross-provider matches high confidence', () => {
  const suggestions = arbitrateModelSuggestions({
    route: 'cpa',
    routeBaseURL: 'https://gw.example.com/v1',
    currentModels: [{ id: 'm1' }],
    gatewayModels: [{ id: 'm1' }],
    resolveModelMeta: (modelId) => modelId === 'm1' ? [
      { source: 'pi-ai', providerId: 'a', baseUrl: 'https://a.example.com/v1', contextWindow: 1 },
      { source: 'models-dev', providerId: 'b', baseUrl: 'https://b.example.com/v1', contextWindow: 2 },
    ] : [],
    bindings: { m1: { source: 'models-dev', providerId: 'b' } },
  })
  const fill = suggestions.find((row) => row.kind === 'safeFill' && row.field === 'contextWindow')
  assert.ok(fill, 'bound provider produces a fill')
  assert.equal(fill.source.providerId, 'b')
  assert.equal(fill.source.confidence, 'high')
  assert.equal(fill.selected, true)
})

test('workbench patch replay: field-level ops preserve unknown keys and untouched fields', () => {
  const currentModels = [
    { id: 'm1', name: 'Mine', compat: { keep: true }, vendorX: 1 },
    { id: 'm2', contextWindow: 10 },
  ]
  const suggestions = [
    { sid: 's1', kind: 'safeFill', modelId: 'm1', field: 'contextWindow', from: undefined, to: 4096 },
    { sid: 's2', kind: 'conflict', modelId: 'm2', field: 'contextWindow', from: 10, to: 20 },
    { sid: 's3', kind: 'addition', modelId: 'm3', draft: { id: 'm3', name: 'New', contextWindow: 100, inexpressible: 'super' } },
  ]
  const next = applySuggestions(currentModels, suggestions, ['s1', 's3'])
  assert.equal(next.length, 3, 'addition appended')
  const m1 = next.find((row) => row.id === 'm1')
  assert.equal(m1.contextWindow, 4096)
  assert.equal(m1.name, 'Mine', 'untouched fields preserved')
  assert.deepEqual(m1.compat, { keep: true }, 'unknown keys preserved')
  assert.equal(m1.vendorX, 1)
  const m2 = next.find((row) => row.id === 'm2')
  assert.equal(m2.contextWindow, 10, 'unselected conflict never applied')
  const m3 = next.find((row) => row.id === 'm3')
  assert.deepEqual(m3, { id: 'm3', name: 'New', contextWindow: 100 }, 'internal keys stripped from drafts')
})

test('workbench suggestion ids are deterministic and change with the payload', () => {
  const a = suggestionId({ route: 'cpa', modelId: 'm1', kind: 'safeFill', field: 'contextWindow', from: undefined, to: 10 })
  const b = suggestionId({ route: 'cpa', modelId: 'm1', kind: 'safeFill', field: 'contextWindow', from: undefined, to: 10 })
  const c = suggestionId({ route: 'cpa', modelId: 'm1', kind: 'safeFill', field: 'contextWindow', from: undefined, to: 11 })
  assert.equal(a, b)
  assert.notEqual(a, c)
})

test('workbench diff: field-level changes, additions and removals', () => {
  const before = [
    { id: 'm1', name: 'A', contextWindow: 1, compat: { x: 1 } },
    { id: 'm2', contextWindow: 2 },
    { id: 'gone', name: 'G' },
  ]
  const after = [
    { id: 'm1', name: 'A', contextWindow: 100, compat: { x: 1 }, input: ['text'] },
    { id: 'm2', contextWindow: 2 },
    { id: 'new', name: 'N' },
  ]
  const diff = diffModelLists(before, after)
  assert.ok(diff.changes.some((row) => row.modelId === 'm1' && row.field === 'contextWindow' && row.from === 1 && row.to === 100))
  assert.ok(diff.changes.some((row) => row.modelId === 'm1' && row.field === 'input'))
  assert.equal(diff.changes.filter((row) => row.modelId === 'm2').length, 0, 'untouched models produce no rows')
  assert.deepEqual(diff.added, ['new'])
  assert.deepEqual(diff.removed, ['gone'])
})

test('workbench undo: preview separates restorable fields from post-apply work', () => {
  const snapshotModels = [
    { id: 'm1', name: 'Old', contextWindow: 1 },
    { id: 'dropped-after', name: 'D' },
  ]
  const current = [
    { id: 'm1', name: 'Old', contextWindow: 999, input: ['text', 'image'] },
    { id: 'added-after', name: 'N' },
  ]
  const preview = undoPreviewModels(snapshotModels, current)
  assert.ok(preview.restorable.some((row) => row.modelId === 'm1' && row.field === 'contextWindow' && row.restoreTo === 1))
  assert.ok(preview.restorable.some((row) => row.modelId === 'm1' && row.field === 'input' && row.remove === true), 'fields added after apply restore to absent')
  assert.equal(preview.restorable.some((row) => row.field === 'name'), false, 'unchanged fields are not restorable rows')
  assert.deepEqual(preview.addedSince, ['added-after'])
  assert.deepEqual(preview.removedSince, ['dropped-after'])
})

test('workbench undo: replay restores matching fields, keeps or drops post-apply work by flag', () => {
  const snapshotModels = [
    { id: 'm1', name: 'Old', contextWindow: 1 },
    { id: 'dropped-after', name: 'D', vendor: 2 },
  ]
  const current = [
    { id: 'm1', name: 'Old', contextWindow: 999, input: ['text', 'image'], compat: { keep: true } },
    { id: 'added-after', name: 'N' },
  ]
  const keep = applyUndo(snapshotModels, current, { dropAdded: false, restoreRemoved: false })
  const m1 = keep.find((row) => row.id === 'm1')
  assert.equal(m1.contextWindow, 1, 'changed field restored')
  assert.equal(m1.input, undefined, 'post-apply field removed back to snapshot state')
  assert.equal(m1.compat, undefined, 'models present in both sides restore to the exact snapshot shape (preview lists every row)')
  assert.ok(keep.some((row) => row.id === 'added-after'), 'post-apply additions kept by default')
  assert.equal(keep.some((row) => row.id === 'dropped-after'), false, 'removed models stay removed by default')

  const aggressive = applyUndo(snapshotModels, current, { dropAdded: true, restoreRemoved: true })
  assert.equal(aggressive.some((row) => row.id === 'added-after'), false)
  assert.ok(aggressive.some((row) => row.id === 'dropped-after' && row.vendor === 2), 'removed models restored with full fields')
})

// ─────────────────────────────────────────────────────────────────────────────
// v1.10 新增面：P3.5 补充源、多源共识、以及 models2-* 端点的门禁与事务语义。
// 这些在旧分支里没有（或形状不同），是重实现到 0.1.6-alpha.2 骨架时新增的覆盖。
// ─────────────────────────────────────────────────────────────────────────────

test('modelparams: only DSH 7 levels survive, none maps to off, toggle-style params stay silent', () => {
  assert.deepEqual(modelParamsDevEfforts([{ effortValues: ['low', 'none', 'high'] }]), { low: 'low', off: null, high: 'high' })
  // 超档值只能丢弃（DSH 思考等级被 pi-ai 类型锁死在 7 档）。
  assert.deepEqual(modelParamsDevEfforts([{ effortValues: ['low', 'super', 'ultra'] }]), { low: 'low', off: null })
  // 纯 toggle/预算制（无可表达档位）不表态，绝不凭空造一个映射。
  assert.equal(modelParamsDevEfforts([{ effortValues: [] }]), undefined)
  assert.equal(modelParamsDevEfforts([{ effortValues: ['super'] }]), undefined)
  assert.equal(modelParamsDevEfforts([]), undefined)
  assert.equal(modelParamsDevEfforts(undefined), undefined)
})

test('modelparams: indexing only accepts declared effort params and a valid model id', () => {
  const catalog = {
    models: [
      { model: 'm1', provider: 'p1', params: [{ path: 'reasoning_effort', values: ['low', 'high'] }] },
      // 非「档位式」参数路径不参与（thinking 预算制等不表态）。
      { model: 'm2', provider: 'p1', params: [{ path: 'thinking.budget_tokens', values: ['1024'] }] },
      // 无 provider 或无档位值的条目不产出记录。
      { model: 'm3', params: [{ path: 'reasoning_effort', values: ['low'] }] },
      { model: 'm4', provider: 'p1', params: [] },
      // 非法模型 id 跳过。
      { model: '', provider: 'p1', params: [{ path: 'reasoning_effort', values: ['low'] }] },
    ],
  }
  const index = indexModelParamsDev(catalog)
  assert.equal(index.has('m1'), true)
  assert.equal(index.has('m2'), false, 'budget-style params never produce an effort record')
  assert.equal(index.has('m3'), false)
  assert.equal(index.has('m4'), false)
  assert.equal(index.size, 1)
})

test('modelparams: candidates carry only reasoningEfforts and the output ceiling, never capacity/vision', () => {
  const catalog = {
    models: [{
      model: 'm1',
      provider: 'p1',
      params: [
        { path: 'reasoning_effort', values: ['low', 'none'] },
        { path: 'max_tokens', range: { max: 8192 } },
      ],
    }],
  }
  const [candidate] = modelParamsCandidates(catalog, 'm1')
  assert.equal(candidate.source, 'modelparams')
  assert.deepEqual(candidate.reasoningEfforts, { low: 'low', off: null })
  assert.equal(candidate.maxTokens, 8192)
  // 补充源对 contextWindow/input 不表态——那两处口径以 pi-ai 与运行时实测为准。
  assert.equal(candidate.contextWindow, undefined)
  assert.equal(candidate.input, undefined)
  assert.deepEqual(modelParamsCandidates(catalog, 'missing'), [])
})

test('modelparams: snapshot loader fails closed on wrong version, malformed catalog or bad fetchedAt', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-modelparams-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const target = join(dshHome, 'dsh-service-modelparams.json')
  assert.equal(await loadModelParamsSnapshot(dshHome), null, 'missing file is not a snapshot')
  await writeFile(target, JSON.stringify({ schemaVersion: 99, fetchedAt: 1, catalog: {} }), 'utf8')
  assert.equal(await loadModelParamsSnapshot(dshHome), null, 'version mismatch fails closed')
  await writeFile(target, JSON.stringify({ schemaVersion: 1, fetchedAt: 1, catalog: [] }), 'utf8')
  assert.equal(await loadModelParamsSnapshot(dshHome), null, 'array catalog fails closed')
  await writeFile(target, JSON.stringify({ schemaVersion: 1, fetchedAt: 'soon', catalog: {} }), 'utf8')
  assert.equal(await loadModelParamsSnapshot(dshHome), null, 'non-numeric fetchedAt fails closed')
  await writeFile(target, JSON.stringify({ schemaVersion: 1, fetchedAt: 5, catalog: { models: [] } }), 'utf8')
  const ok = await loadModelParamsSnapshot(dshHome)
  assert.equal(ok.fetchedAt, 5)
})

test('modelparams: freshness manager coalesces in-flight requests, honours backoff, and never rejects', async () => {
  const state = { snapshot: null, lastError: null, lastAttemptAt: 0 }
  let calls = 0
  let release
  const manager = createFreshnessManager(() => state, () => {
    calls += 1
    return new Promise((resolve) => { release = resolve })
  })
  // 同一 freshKey 的并发调用共享一次网络请求（在途合并单飞）。
  const first = manager.refreshed('session-a')
  const second = manager.refreshed('session-a')
  assert.equal(first, second, 'in-flight calls are the same promise')
  assert.equal(calls, 1)
  release({ snapshot: { fetchedAt: 1 }, source: 'network' })
  await first
  // 成功结果在会话内复用，不再发第二次请求（无 TTL，动作驱动）。
  await manager.refreshed('session-a')
  assert.equal(calls, 1, 'settled success is reused within the session')

  // 失败保留旧快照继续，返回 staleError 而不是 reject（refresh 永不外漏异常）。
  const failing = createFreshnessManager(() => state, async () => { throw new Error('network') })
  const result = await failing.refreshed('session-b')
  assert.equal(result.staleError, 'network')
  assert.equal(result.source, 'snapshot')

  // 30 分钟退避内不再尝试（force 才绕过）。
  assert.equal(state.lastError, 'network')
  const callsBefore = calls
  const backedOff = await failing.refreshed('session-c')
  assert.equal(backedOff.staleError, 'network', 'backoff answers from the stale snapshot')
  assert.equal(calls, callsBefore, 'backoff suppresses the automatic retry')
})

// ─────────────────────────────────────────────────────────────────────────────
// models2-* 路由层：门禁、句柄纪律（一次性 + TTL）与写入事务语义。
// 直接驱动 createModelWorkbenchRoutes，用最小假宿主；不经过 index.js 的装配，
// 便于逐条锁定「客户端伪造输入被拒」这条安全不变量。
// ─────────────────────────────────────────────────────────────────────────────

function createWorkbenchHost({ profiles = {}, mutate = async () => {}, revision = 0 } = {}) {
  // 模型 0.1.6-alpha.2 的真实 settings 服务：describe() 暴露命名空间 revision，
  // mutate(ns, ops, expectedRevision) 在写队列内比对，不匹配抛 SETTINGS_CONFLICT。
  let currentRevision = revision
  const settings = {
    get: (ns) => (ns === 'llm-pi-ai' ? { providers: profiles } : undefined),
    describe: () => [{ ns: 'llm-pi-ai', revision: currentRevision }],
    mutate: async (ns, ops, expectedRevision) => {
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        const error = new Error(`settings namespace "${ns}" changed since it was read`)
        error.name = 'SettingsConflictError'
        error.code = 'SETTINGS_CONFLICT'
        throw error
      }
      const result = await mutate(ns, ops)
      currentRevision += 1
      return result
    },
  }
  const services = new Map([['settings', settings]])
  const ctx = {
    get: (name) => services.get(name),
    logger: { info() {}, warn() {}, error() {} },
  }
  return { ctx, services, settings, bumpRevision: () => { currentRevision += 1 }, revision: () => currentRevision }
}

async function createRoutes(options = {}) {
  const host = createWorkbenchHost(options)
  const dshHome = options.dshHome
  const store = options.workbenchStore ?? createWorkbenchStore(dshHome)
  const routes = createModelWorkbenchRoutes({
    ctx: host.ctx,
    randomUUID,
    // 空目录：本组用例只关心路由层契约，不依赖真实装机目录。
    loadPiCatalog: async () => ({ channels: [], channelIds: new Set(), byHost: new Map(), byModelId: new Map(), whiteHosts: new Set() }),
    workbenchStore: store,
    loadSubagentRoute: async () => ({ version: 1, mode: 'inherit' }),
    loadAgentDefaultModelSelection: () => undefined,
    writeSubagentRoute: async () => ({ saved: true }),
    listSubagentModels: async () => ({ models: [] }),
    dshHome,
    pluginVersion: 'test',
  })
  return { routes, ctx: host.ctx, store, host }
}

test('workbench routes: every models2-* endpoint is feature-gated on modelCatalog', async () => {
  const { routes } = await createRoutes({ dshHome: '/nonexistent' })
  const endpoints = Object.keys(routes)
  assert.equal(endpoints.length, 22)
  for (const name of endpoints) {
    assert.equal(name.startsWith('models2-'), true, `${name} uses the models2- namespace`)
    assert.equal(routes[name].feature, 'modelCatalog', `${name} is behind the modelCatalog gate`)
    assert.equal(typeof routes[name].handle, 'function')
  }
})

test('workbench routes: route lookup and writes reject unknown routes without touching settings', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-routes-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  let mutations = 0
  const { routes } = await createRoutes({
    dshHome,
    profiles: { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] } },
    mutate: async () => { mutations += 1 },
  })

  assert.equal((await routes['models2-route'].handle({ route: 'ghost' })).ok, false)
  assert.equal((await routes['models2-edit-prepare'].handle({ route: 'ghost', models: [{ id: 'm1' }] })).ok, false)
  assert.equal((await routes['models2-commit'].handle({ planId: 'made-up' })).ok, false, 'forged plan ids are rejected')
  assert.equal((await routes['models2-prepare'].handle({ inspectId: 'made-up', sids: [] })).ok, false, 'forged inspect ids are rejected')
  assert.equal((await routes['models2-undo-preview'].handle({ route: 'ghost' })).ok, false)
  assert.equal((await routes['models2-remove-plan'].handle({ route: 'ghost', removeIds: ['m1'] })).ok, false)
  assert.equal(mutations, 0, 'no rejected call reached settings.mutate')
})

test('workbench routes: inspect handles are single-use and carry the fingerprint that guards commit', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-handle-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const { routes } = await createRoutes({
    dshHome,
    profiles: { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] } },
  })

  const inspected = await routes['models2-inspect'].handle({ route: 'cpa' })
  assert.equal(inspected.ok, true)
  const inspectId = inspected.value.inspectId
  // 目录级检查（未 probe）零网络：connection.probed 为 false，且不解析凭据。
  assert.equal(inspected.value.connection.probed, false)
  assert.equal(inspected.value.connection.usedCredential, undefined)

  const prepared = await routes['models2-prepare'].handle({ inspectId, sids: [] })
  assert.equal(prepared.ok, true)
  assert.equal(typeof prepared.value.planId, 'string')
  // 句柄取出即消费：同一 inspectId 不能二次准备（防重放）。
  assert.equal((await routes['models2-prepare'].handle({ inspectId, sids: [] })).ok, false)
  // 同一 planId 也不能二次提交。
  const committed = await routes['models2-commit'].handle({ planId: prepared.value.planId })
  assert.equal(committed.ok, true)
  assert.equal((await routes['models2-commit'].handle({ planId: prepared.value.planId })).ok, false)
})

test('workbench routes: commit refuses a write when the profile drifted after the plan was made', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-conflict-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profiles = { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] } }
  let mutations = 0
  const { routes } = await createRoutes({ dshHome, profiles, mutate: async () => { mutations += 1 } })

  const inspected = await routes['models2-inspect'].handle({ route: 'cpa' })
  const prepared = await routes['models2-prepare'].handle({ inspectId: inspected.value.inspectId, sids: [] })
  assert.equal(prepared.ok, true)
  // 计划生成后配置发生漂移（模拟并发写）→ 提交必须拒绝，绝不覆盖。
  profiles.cpa.models = [{ id: 'm1' }, { id: 'added-behind-our-back' }]
  const committed = await routes['models2-commit'].handle({ planId: prepared.value.planId })
  assert.equal(committed.ok, false)
  assert.match(committed.error, /conflict/)
  assert.equal(mutations, 0, 'a conflicted commit never writes')
})

test('workbench routes: edit-prepare reports noop for an unchanged table and stages real diffs otherwise', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-edit-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const { routes } = await createRoutes({
    dshHome,
    profiles: { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1', name: 'Mine', compat: { keep: true } }] } },
  })

  const same = await routes['models2-edit-prepare'].handle({ route: 'cpa', models: [{ id: 'm1', name: 'Mine', compat: { keep: true } }] })
  assert.deepEqual(same.value, { noop: true })

  // 非法字段形状（input 含未知模态）必须被写前自检整体拒绝，而不是带伤写入。
  const bad = await routes['models2-edit-prepare'].handle({ route: 'cpa', models: [{ id: 'm1', input: ['audio'] }] })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /schema-invalid/)

  const changed = await routes['models2-edit-prepare'].handle({ route: 'cpa', models: [{ id: 'm1', name: 'Renamed', compat: { keep: true } }] })
  assert.equal(changed.ok, true)
  assert.equal(changed.value.diff.changes.length, 1)
  assert.equal(changed.value.diff.changes[0].field, 'name')
})

test('workbench routes: undo snapshot is written on commit and cleared only after a successful restore', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-undo-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profiles = { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1', name: 'Before' }] } }
  const { routes } = await createRoutes({
    dshHome,
    profiles,
    mutate: async (_ns, ops) => {
      // 模拟 settings 真实写路径：把新模型表落到读面上。
      profiles.cpa.models = ops[0].value
    },
  })

  const inspected = await routes['models2-inspect'].handle({ route: 'cpa' })
  const prepared = await routes['models2-prepare'].handle({ inspectId: inspected.value.inspectId, sids: [] })
  await routes['models2-commit'].handle({ planId: prepared.value.planId })

  // 提交后撤销槽可用（快照 = 写前状态）。
  const preview = await routes['models2-undo-preview'].handle({ route: 'cpa' })
  assert.equal(preview.ok, true)
  assert.equal(typeof preview.value.at, 'number')

  const undone = await routes['models2-undo-commit'].handle({ route: 'cpa' })
  assert.equal(undone.ok, true)
  assert.equal(profiles.cpa.models[0].name, 'Before', 'restore writes the snapshot back')
  // 撤销成功才清槽：再预览即 nothing-to-undo。
  const after = await routes['models2-undo-preview'].handle({ route: 'cpa' })
  assert.equal(after.ok, false)
  assert.match(after.error, /nothing-to-undo/)
})

test('workbench routes: create-commit rejects forged sids and unserviceable manual ids before writing', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-create-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  let mutations = 0
  const { routes } = await createRoutes({ dshHome, mutate: async () => { mutations += 1 } })

  assert.equal((await routes['models2-create-commit'].handle({ draftId: 'ghost', sids: [], manualIds: ['m1'] })).ok, false)
  // 非法 route 名与协议在 begin 阶段即被拒（零输入拼接：浏览器不提供命令/路径）。
  assert.equal((await routes['models2-create-begin'].handle({ displayName: '', baseURL: 'https://gw.example.com/v1', api: 'openai-completions' })).ok, false)
  assert.equal((await routes['models2-create-begin'].handle({ displayName: 'X', baseURL: 'https://gw.example.com/v1', api: 'evil-protocol' })).ok, false)
  assert.equal((await routes['models2-create-begin'].handle({ displayName: 'X', baseURL: 'http://insecure.example.com/v1', api: 'openai-completions' })).ok, false, 'non-HTTPS base URLs are rejected')
  assert.equal(mutations, 0)
})

test('workbench routes: validate reports every skipped service instead of failing the route', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-validate-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const { routes } = await createRoutes({
    dshHome,
    profiles: { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] } },
  })

  // llm 服务缺席：相关检查标 skipped 而不是判失败（服务缺席不是配置错误）。
  const result = await routes['models2-validate'].handle({ route: 'cpa' })
  assert.equal(result.ok, true)
  const providers = result.value.checks.find((check) => check.type === 'providers')
  assert.equal(providers.skipped, true)
  assert.equal(providers.ok, true)
  const models = result.value.checks.find((check) => check.type === 'models')
  assert.equal(models.skipped, true)
  // deep 需要 llm.stream，缺席即明确拒绝。
  assert.equal((await routes['models2-validate'].handle({ route: 'cpa', deep: true })).ok, false)
})

test('workbench routes: provider check reads the 0.1.6 provider id field, not the retired provider key', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-provider-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profile = { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] }
  // 0.1.6-alpha.2 的 LlmProviderInfo 是 {id, name}；旧分支读 entry.provider 会误报 provider-missing。
  const llm = {
    listProviders: async () => [{ id: 'cpa', name: 'CPA' }],
    listModels: async () => [{ id: 'm1' }],
    resolveModelInfo: async () => ({ id: 'm1' }),
    stream: async () => [],
  }
  const { routes } = await createRoutes({ dshHome, profiles: { cpa: profile } })
  const patched = createModelWorkbenchRoutes({
    ctx: {
      get: (name) => (name === 'llm' ? llm : name === 'settings' ? { get: () => ({ providers: { cpa: profile } }), mutate: async () => {} } : undefined),
      logger: { info() {}, warn() {}, error() {} },
    },
    randomUUID,
    loadPiCatalog: async () => ({ channels: [], channelIds: new Set(), byHost: new Map(), byModelId: new Map(), whiteHosts: new Set() }),
    workbenchStore: createWorkbenchStore(dshHome),
    loadSubagentRoute: async () => ({ version: 1, mode: 'inherit' }),
    loadAgentDefaultModelSelection: () => undefined,
    writeSubagentRoute: async () => ({ saved: true }),
    listSubagentModels: async () => ({ models: [] }),
    dshHome,
    pluginVersion: 'test',
  })
  assert.equal(typeof routes, 'object')
  const result = await patched['models2-validate'].handle({ route: 'cpa' })
  assert.equal(result.ok, true)
  const providers = result.value.checks.find((check) => check.type === 'providers')
  assert.equal(providers.ok, true, 'provider id match succeeds on the current contract')
  assert.equal(providers.skipped, undefined)
  const models = result.value.checks.find((check) => check.type === 'models')
  assert.equal(models.ok, true)
})

test('workbench simple flow: option and detection handles are single-use and route-bound', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-simple-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const { routes } = await createRoutes({
    dshHome,
    profiles: { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] } },
  })

  // 伪造句柄一路拒绝（浏览器无法自造 optionHandle / detectionId）。
  assert.equal((await routes['models2-model-prepare'].handle({ route: 'cpa', additions: [{ optionHandle: 'forged' }] })).ok, false)
  assert.equal((await routes['models2-model-prepare'].handle({ route: 'cpa', additions: [{ detectionId: 'forged' }] })).ok, false)
  assert.equal((await routes['models2-model-prepare'].handle({ route: 'cpa', additions: [{}] })).ok, false, 'an addition with no handle is rejected')
  // 非 HTTPS 的在线获取被护栏挡下（不会发网）。
  const online = await routes['models2-model-options'].handle({ route: 'cpa', source: 'online' })
  assert.equal(online.ok, false)
  // 内置来源只对内置渠道开放；未知来源名被拒。
  assert.equal((await routes['models2-model-options'].handle({ route: 'cpa', source: 'builtin' })).ok, false)
  assert.equal((await routes['models2-model-options'].handle({ route: 'cpa', source: 'nonsense' })).ok, false)
  const badIds = await routes['models2-model-suggestions'].handle({ route: 'cpa', modelIds: [] })
  assert.equal(badIds.ok, false)
})

test('workbench simple flow: detection reports the skipped llm service and unverified state', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-detect-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const { routes } = await createRoutes({
    dshHome,
    profiles: { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [] } },
  })
  // llm 缺席：检测照常返回，但 verified=false 且带明确错误码——不是「检测通过」。
  const result = await routes['models2-model-detect'].handle({ route: 'cpa', modelId: 'm1' })
  assert.equal(result.ok, true)
  assert.equal(result.value.verified, false)
  assert.equal(result.value.error, 'llm-service-missing')
  // 非法模型 id 在检测前就被拒。
  assert.equal((await routes['models2-model-detect'].handle({ route: 'cpa', modelId: 'bad\u0000id' })).ok, false)
})

test('workbench simple flow: prepare warns about unverified models and commit persists builtin bindings', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-bind-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profiles = { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [] } }
  const store = createWorkbenchStore(dshHome)
  const { routes } = await createRoutes({
    dshHome,
    profiles,
    workbenchStore: store,
    mutate: async (_ns, ops) => { profiles.cpa.models = ops[0].value },
  })

  // detection → prepare：未验证模型必须显式 allowUnverified 才放行，并带 warning。
  const detection = await routes['models2-model-detect'].handle({ route: 'cpa', modelId: 'manual-model' })
  const detectionId = detection.value.detectionId
  const blocked = await routes['models2-model-prepare'].handle({ route: 'cpa', additions: [{ detectionId }] })
  assert.equal(blocked.ok, false, 'an unverified detection needs explicit consent')

  const detection2 = await routes['models2-model-detect'].handle({ route: 'cpa', modelId: 'manual-model' })
  const prepared = await routes['models2-model-prepare'].handle({ route: 'cpa', additions: [{ detectionId: detection2.value.detectionId, allowUnverified: true }] })
  assert.equal(prepared.ok, true)
  assert.deepEqual(prepared.value.warnings, ['unverified-model'])
  assert.equal(prepared.value.diff.added.includes('manual-model'), true)

  const committed = await routes['models2-model-commit'].handle({ planId: prepared.value.planId })
  assert.equal(committed.ok, true)
  assert.equal(profiles.cpa.models.some((model) => model.id === 'manual-model'), true, 'the plan is written')
  // 提交后撤销槽可用。
  const preview = await routes['models2-undo-preview'].handle({ route: 'cpa' })
  assert.equal(preview.ok, true)
})

test('workbench simple flow: verification maps 404 to not-found and rejects bad model ids', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-verify-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const { routes } = await createRoutes({
    dshHome,
    profiles: { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [] } },
  })
  assert.equal((await routes['models2-model-verify-online'].handle({ route: 'cpa', modelId: '' })).ok, false)
  assert.equal((await routes['models2-model-verify-online'].handle({ route: 'ghost', modelId: 'm1' })).ok, false)
})

test('workbench verification: OpenRouter source selection and match scoring are deterministic', () => {
  // 含作者前缀直查档案端点；否则走目录搜索。
  const direct = openRouterVerifySource('anthropic/claude-sonnet-4')
  assert.equal(direct.kind, 'model')
  assert.match(direct.url, /^https:\/\/openrouter\.ai\/api\/v1\/model\//)
  const search = openRouterVerifySource('glm-5.3-flash')
  assert.equal(search.kind, 'search')
  assert.match(search.url, /^https:\/\/openrouter\.ai\/api\/v1\/models\?q=/)
  assert.equal(openRouterVerifySource('a/b/c').url.endsWith(encodeURIComponent('a/b/c')), true, 'slashes are encoded, never path segments')

  // 精确相等优先于后缀匹配；:variant 变体不被当成同模型。
  const rows = [
    { id: 'other/glm-5.3-flash:free' },
    { id: 'zai/glm-5.3-flash', canonical_slug: 'zai/glm-5.3-flash' },
    { id: 'glm-5.3-flash', name: 'exact' },
  ]
  assert.equal(pickOpenRouterMatch('glm-5.3-flash', rows).name, 'exact', 'exact id wins')
  assert.equal(pickOpenRouterMatch('glm-5.3-flash', [{ id: 'zai/glm-5.3-flash' }]).id, 'zai/glm-5.3-flash', 'suffix match works')
  assert.equal(pickOpenRouterMatch('missing', rows), undefined)

  // 事实抽取：字段缺失即跳过；一个都抽不到返回 []（调用方判 no-match）。
  assert.deepEqual(openRouterModelFacts({ data: { name: 'M', context_length: 200000 } }), ['name: M', 'context length: 200000'])
  assert.deepEqual(openRouterModelFacts({ data: {} }), [])
  assert.deepEqual(openRouterModelFacts(null), [])
})

test('workbench ability patch: follow never fabricates a text-only or no-reasoning claim', () => {
  // 「未表态」与「显式不支持」语义不同：follow 必须产出空补丁。
  assert.deepEqual(abilityPatch({}), {})
  assert.deepEqual(abilityPatch({ image: 'follow', reasoning: 'follow' }), {})
  assert.deepEqual(abilityPatch({ image: 'image' }), { input: ['text', 'image'] })
  assert.deepEqual(abilityPatch({ image: 'text' }), { input: ['text'] })
  assert.deepEqual(abilityPatch({ reasoning: 'unsupported' }), { reasoningEfforts: false })
  // observed：只在运行时确实观测到 image 时才写多模态。
  assert.deepEqual(abilityPatch({ image: 'observed', observed: { input: ['text'] } }), {})
  assert.deepEqual(abilityPatch({ image: 'observed', observed: { input: ['text', 'image'] } }), { input: ['text', 'image'] })
  assert.deepEqual(abilityPatch({ reasoning: 'observed', observed: { reasoningEfforts: { off: null, low: 'low' } } }), { reasoningEfforts: { off: null, low: 'low' } })
  // 回归：观测不到档位时绝不能把 'observed' 当 wire 值写进去——否则 selfCheck 以 bad-efforts
  // 整体拒绝，表现为「添加未验证模型永远失败」（llm 服务缺席或 adapter 不表态时必现）。
  assert.deepEqual(abilityPatch({ reasoning: 'observed', observed: {} }), {})
  assert.deepEqual(abilityPatch({ reasoning: 'observed' }), {})
  assert.equal(selfCheckModelsPatch([{ id: 'm', ...abilityPatch({ reasoning: 'observed', observed: {} }) }]).ok, true)
})

test('workbench routes: expectedRevision closes the read-check-write race a fingerprint alone cannot', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-rev-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profiles = { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1', name: 'M1' }] } }
  const { routes, host } = await createRoutes({
    dshHome,
    profiles,
    mutate: async (_ns, ops) => { profiles.cpa.models = ops[0].value },
  })

  const inspected = await routes['models2-inspect'].handle({ route: 'cpa' })
  const prepared = await routes['models2-prepare'].handle({ inspectId: inspected.value.inspectId, sids: [] })
  assert.equal(prepared.ok, true)

  // 关键构造：只在**别的**命名空间内容上做了改动，profile 指纹不变（models 数组一字未改），
  // 但 settings revision 前进了——这正是指纹闸看不见、并发窗口真实存在的场景。
  host.bumpRevision()
  assert.equal(profiles.cpa.models[0].name, 'M1', 'the profile itself is byte-identical')

  const committed = await routes['models2-commit'].handle({ planId: prepared.value.planId })
  assert.equal(committed.ok, false, 'the stale plan is refused')
  assert.match(committed.error, /conflict/, 'and surfaces as the workbench conflict code')
})

test('workbench routes: a live revision still commits, and revision-less hosts fall back to the fingerprint gate', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-rev-ok-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profiles = { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] } }
  const { routes, host } = await createRoutes({
    dshHome,
    profiles,
    mutate: async (_ns, ops) => { profiles.cpa.models = ops[0].value },
  })
  const inspected = await routes['models2-inspect'].handle({ route: 'cpa' })
  const prepared = await routes['models2-prepare'].handle({ inspectId: inspected.value.inspectId, sids: [] })
  // 未发生任何并发写 → 带 revision 的提交照常成功，且写后 revision 前进。
  const before = host.revision()
  const committed = await routes['models2-commit'].handle({ planId: prepared.value.planId })
  assert.equal(committed.ok, true)
  assert.equal(host.revision(), before + 1, 'a real write advances the namespace revision')

  // 老宿主形态：settings 服务没有 describe/revision → 退化为不带 expectedRevision 的写，
  // 指纹闸仍在（这里内容未漂移，故成功）。
  const legacyProfiles = { cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1' }] } }
  const legacyCtx = {
    get: (name) => (name === 'settings'
      ? { get: () => ({ providers: legacyProfiles }), mutate: async (_ns, ops) => { legacyProfiles.cpa.models = ops[0].value } }
      : undefined),
    logger: { info() {}, warn() {}, error() {} },
  }
  const legacyRoutes = createModelWorkbenchRoutes({
    ctx: legacyCtx,
    randomUUID,
    loadPiCatalog: async () => ({ channels: [], channelIds: new Set(), byHost: new Map(), byModelId: new Map(), whiteHosts: new Set() }),
    workbenchStore: createWorkbenchStore(dshHome),
    loadSubagentRoute: async () => ({ version: 1, mode: 'inherit' }),
    loadAgentDefaultModelSelection: () => undefined,
    writeSubagentRoute: async () => ({ saved: true }),
    listSubagentModels: async () => ({ models: [] }),
    dshHome,
    pluginVersion: 'test',
  })
  const legacyInspect = await legacyRoutes['models2-inspect'].handle({ route: 'cpa' })
  const legacyPrepare = await legacyRoutes['models2-prepare'].handle({ inspectId: legacyInspect.value.inspectId, sids: [] })
  const legacyCommit = await legacyRoutes['models2-commit'].handle({ planId: legacyPrepare.value.planId })
  assert.equal(legacyCommit.ok, true, 'a revision-less host still writes (fingerprint gate only)')
})

test('workbench routes: undo reads the live revision so an unrelated write never falsely refuses it', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-rev-undo-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profiles = {
    cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1', name: 'Before' }] },
  }
  const { routes, host } = await createRoutes({
    dshHome,
    profiles,
    mutate: async (_ns, ops) => { profiles.cpa.models = ops[0].value },
  })

  const inspected = await routes['models2-inspect'].handle({ route: 'cpa' })
  const prepared = await routes['models2-prepare'].handle({ inspectId: inspected.value.inspectId, sids: [] })
  assert.equal((await routes['models2-commit'].handle({ planId: prepared.value.planId })).ok, true)

  // 撤销没有计划句柄可携带旧 revision，因此**写前现读**当前值：其它命名空间的
  // 改动不该让撤销失败（否则用户改个无关开关就撤不回去了）。
  host.bumpRevision()
  const undone = await routes['models2-undo-commit'].handle({ route: 'cpa' })
  assert.equal(undone.ok, true, 'a fresh read keeps undo usable')
  assert.equal(profiles.cpa.models[0].name, 'Before', 'and it actually restored the snapshot')
})

test('workbench routes: a service-side revision rejection maps to conflict and preserves the undo slot', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-wb-rev-reject-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const profiles = {
    cpa: { displayName: 'CPA', api: 'openai-completions', baseURL: 'https://gw.example.com/v1', apiKeyEnv: '', models: [{ id: 'm1', name: 'Before' }] },
  }
  // 构造「读到的 revision 已经过时」：describe() 永远回 0，而真实写入要求 revision 5。
  // 这模拟写前读取与真正落盘之间被别的写者插队——服务端据此拒绝。
  const host = createWorkbenchHost({
    profiles,
    mutate: async (_ns, ops) => { profiles.cpa.models = ops[0].value },
  })
  host.ctx.get = (name) => {
    if (name !== 'settings') return undefined
    return {
      get: () => ({ providers: profiles }),
      describe: () => [{ ns: 'llm-pi-ai', revision: 0 }],
      mutate: async (ns, ops, expectedRevision) => {
        if (expectedRevision !== 5) {
          const error = new Error(`settings namespace "${ns}" changed since it was read`)
          error.name = 'SettingsConflictError'
          error.code = 'SETTINGS_CONFLICT'
          throw error
        }
        profiles.cpa.models = ops[0].value
      },
    }
  }
  const store = createWorkbenchStore(dshHome)
  const routes = createModelWorkbenchRoutes({
    ctx: host.ctx,
    randomUUID,
    loadPiCatalog: async () => ({ channels: [], channelIds: new Set(), byHost: new Map(), byModelId: new Map(), whiteHosts: new Set() }),
    workbenchStore: store,
    loadSubagentRoute: async () => ({ version: 1, mode: 'inherit' }),
    loadAgentDefaultModelSelection: () => undefined,
    writeSubagentRoute: async () => ({ saved: true }),
    listSubagentModels: async () => ({ models: [] }),
    dshHome,
    pluginVersion: 'test',
  })
  // 手工放一个写前快照，激活撤销槽。
  await store.mutate((sidecar) => { sidecar.providers.cpa = { models: [{ id: 'm1', name: 'Snapshot' }], at: Date.now() } })

  const undone = await routes['models2-undo-commit'].handle({ route: 'cpa' })
  assert.equal(undone.ok, false)
  assert.match(undone.error, /conflict/, 'a service-side revision rejection reads as a workbench conflict')
  const preview = await routes['models2-undo-preview'].handle({ route: 'cpa' })
  assert.equal(preview.ok, true, 'the undo slot survives so the user can retry')
})

test('workbench probe guard: rejects every non-public-https shape before any request is made', () => {
  // 安全教义「零输入拼接」的核心闸：地址合法性完全在宿主侧判定，浏览器给什么都要过这里。
  const cases = [
    ['https://gw.example.com/v1', true, 'ordinary public https'],
    ['http://gw.example.com/v1', false, 'plain http'],
    ['https://1.2.3.4/v1', false, 'ipv4 literal (bypasses the DNS gate)'],
    ['https://[::1]/v1', false, 'ipv6 literal'],
    ['https://user:pw@gw.example.com/v1', false, 'embedded credentials'],
    ['https://gw.example.com:8443/v1', false, 'non-443 port'],
    ['https://gw.example.com:443/v1', true, 'explicit 443 is fine'],
    ['https://{location}-api.example.com/v1', false, 'unresolved template host'],
    ['file:///etc/passwd', false, 'file scheme'],
    ['javascript:alert(1)', false, 'javascript scheme'],
    ['', false, 'empty'],
    ['not a url', false, 'unparseable'],
  ]
  for (const [url, want, label] of cases) {
    assert.equal(probeBaseURLCheck(url).ok, want, `${label}: ${url}`)
  }
})

test('workbench probe guard: every private and reserved address range is refused', () => {
  const privateOnes = [
    '127.0.0.1', '10.0.0.5', '169.254.1.1', '172.16.0.1', '192.168.1.1', '100.64.0.1',
    '224.0.0.1', '240.0.0.1', '0.0.0.0', '192.0.2.1', '198.51.100.5', '203.0.113.9',
    '::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '2001:db8::1', '::ffff:10.0.0.1',
  ]
  for (const address of privateOnes) assert.equal(isPrivateIpAddress(address), true, `${address} must be refused`)
  const publicOnes = ['8.8.8.8', '1.1.1.1', '2606:4700::1', '::ffff:1.1.1.1']
  for (const address of publicOnes) assert.equal(isPrivateIpAddress(address), false, `${address} is public`)
})

test('workbench probe guard: DNS resolution is refused unless every answer is public', async () => {
  const original = modelsProbeLookup.impl
  const t2 = (impl) => { modelsProbeLookup.impl = impl }
  try {
    // 单条私网答案即整体拒绝（防 rebinding 的首道：解析结果全量校验）。
    t2(async () => [{ address: '10.0.0.1' }])
    await assert.rejects(() => assertPublicHost('gw.example.com'), /probe-not-public/)
    // 多答案里混入一条私网同样拒绝。
    t2(async () => [{ address: '1.1.1.1' }, { address: '192.168.0.1' }])
    await assert.rejects(() => assertPublicHost('gw.example.com'), /probe-not-public/)
    // 空解析结果拒绝。
    t2(async () => [])
    await assert.rejects(() => assertPublicHost('gw.example.com'), /probe-dns-empty/)
    // 全部公网才放行。
    t2(async () => [{ address: '1.1.1.1' }, { address: '8.8.8.8' }])
    const rows = await assertPublicHost('gw.example.com')
    assert.equal(rows.length, 2)
  } finally {
    t2(original)
  }
})
