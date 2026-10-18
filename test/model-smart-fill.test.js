// P2 智能填充证据模型回归（规格 docs/planning/model-config-smart-fill.md §4/§5）。
//
// 覆盖的语义（fixtures 内联，除本地 TLS 回环外全部离线）：
//   1. pi 索引保留渠道+api+ID 三元身份，同渠道同 ID 跨 api 不合并；
//   2. reasoning 三态，未声明 ≠ false；wire 只在明确 true 且有档位时出现；
//   3. 模态按集合比较，顺序差异不是冲突；空数组=未声明；
//   4. 同渠道跨 api / 跨渠道能力仅参考可明确采纳；wire/compat 只有精确渠道+协议可建议；
//   5. compat 协议门：offer 可写、withhold 只读；未知协议无可写键；
//   6. 资料缺席有理由（absentReason）且 unsupported:false；
//   7. modelparams 记录保留 provider/authType/apiSurface/model/wireId 独立身份，不做并集；
//      range.max 只读、绝不当 maxTokens 建议；effort values/default 是来源声明不是 wire；
//      空 .models 与逐条语义漂移是可见失败/留证，绝不伪装成「无建议」；
//   8. OpenRouter 同名多命中保留全部，绝不取首条；`/api/v1/model/{author}/{slug}` 的 data
//      是**对象**，与匹配层同形处理；
//   9. runtime 只有 id/name，没有 wire value，不能按 ID 捏造 wire；adapter 默认不是能力上限；
//  10. 固定来源白名单三重匹配（含重复/越界/编码穿越查询）；条件请求/单飞/失败可见/有界取数
//      （注入 transport + 本地真实 HTTPS 服务器两条路径：墙钟死线、解压引擎侧上限、错误码分类）；
//     元数据来源永不接收凭据（Authorization/Cookie/集合外头一律拒）；
//     OpenRouter 详情路径保留字面 `/`（`%2F` 实测 404），段内不安全字符仍转义；
//  11. OFF 零网络，ON 走固定来源 + 运行时；任何来源失败不阻断其它来源；
//  12. 采纳必须显式候选 ID，readOnly 拒绝，未知 ID 整体拒绝；
//  13. 来源绑定按 route+api+model+地址指纹登记，地址/身份变化待复核，绝不携带 wire/compat；
//  14. 永久装机 pi 全量扫描脚本自检（无硬编码规模）与 CLI 退出码。
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:https'
import tls from 'node:tls'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'

import {
  COMPAT_PROTOCOL_GATE,
  MAX_METADATA_BYTES,
  MAX_METADATA_INFLATED_BYTES,
  MAX_OPENROUTER_SEARCH_LIMIT,
  METADATA_HEADER_ALLOWLIST,
  SMART_FILL_MODES,
  SOURCE_BINDING_VERSION,
  adoptCandidate,
  applyAdoption,
  assertSourceAllowed,
  auditPiEvidence,
  buildPiEvidence,
  buildSmartFillGroups,
  compareModalitySets,
  createMetadataCache,
  createSourceFetcher,
  defaultTransport,
  indexModelParamsRecords,
  modalitySet,
  modelIdAliasCandidates,
  modelParamsReference,
  modelParamsRequest,
  openRouterMatches,
  openRouterReference,
  openRouterRequest,
  parseOpenRouterPayload,
  parseModelParamsPayload,
  piEvidenceFor,
  querySmartFill,
  resolveSmartFillIdentity,
  resolveSourceBinding,
  routeIdentityFingerprint,
  runtimeReference,
  sourceCandidateFingerprint,
  upstreamAtOf,
} from '../model-smart-fill.js'

import {
  auditSourceWhitelist,
  parseArgs,
  resolveDataDir,
  scanPiDir,
  summarize,
} from '../scripts/scan-model-smart-fill.mjs'

const execFileAsync = promisify(execFile)
const SCAN_SCRIPT = fileURLToPath(new URL('../scripts/scan-model-smart-fill.mjs', import.meta.url))

// ─────────────────────────────────────────────────────────────────────────────
// 内联 fixtures（覆盖全部语义；不新增文件）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 渠道 alpha 的同一模型 `shared` 在两种 api 下能力值不同（碰撞，必须保留两条）；
 * 渠道 beta 有同名跨渠道条目；`undeclared` 缺 reasoning 字段；`explicit-false` 明确 false。
 * baseUrl 覆盖 exact / template / empty 三种。
 */
const PI_FIXTURE = {
  alpha: JSON.stringify({
    'openai-completions': {
      'chat:shared': {
        id: 'shared',
        name: 'Shared via completions',
        api: 'openai-completions',
        baseUrl: 'https://alpha.example/v1',
        provider: 'alpha',
        reasoning: true,
        thinkingLevelMap: { off: null, low: 'low', high: 'high' },
        input: ['image', 'text'],
        contextWindow: 100000,
        maxTokens: 8000,
        compat: {
          supportsStore: true,
          supportsReasoningEffort: true,
          openRouterRouting: { only: ['x'] },
          sendSessionAffinityHeaders: true,
        },
      },
      'chat:undeclared': {
        id: 'undeclared',
        api: 'openai-completions',
        baseUrl: 'https://alpha.example/{region}/v1',
        provider: 'alpha',
        contextWindow: 50000,
      },
      'chat:explicit-false': {
        id: 'explicit-false',
        api: 'openai-completions',
        baseUrl: '',
        provider: 'alpha',
        reasoning: false,
        // 明确 false 时即使有 thinkingLevelMap 也不能产出 wire
        thinkingLevelMap: { low: 'low' },
      },
    },
    'anthropic-messages': {
      'chat:shared': {
        id: 'shared',
        name: 'Shared via anthropic',
        api: 'anthropic-messages',
        baseUrl: 'https://alpha.example/v1',
        provider: 'alpha',
        reasoning: false,
        input: ['text'],
        contextWindow: 200000,
        maxTokens: 16000,
        compat: {
          forceAdaptiveThinking: true,
          sendSessionAffinityHeaders: true,
        },
      },
    },
  }),
  beta: JSON.stringify({
    'openai-completions': {
      'chat:shared': {
        id: 'shared',
        name: 'Shared cross-channel',
        api: 'openai-completions',
        baseUrl: 'https://beta.example/v1',
        provider: 'beta',
        reasoning: true,
        thinkingLevelMap: { low: 'low', high: 'high', max: 'max' },
        input: ['text', 'image'],
        contextWindow: 300000,
        maxTokens: 24000,
        compat: { supportsStore: false },
      },
    },
  }),
}

const MODELPARAMS_FIXTURE = {
  generatedAt: '2026-10-01T00:00:00Z',
  models: [
    {
      model: 'shared',
      provider: 'prov-a',
      authType: 'api_key',
      apiSurface: 'openai',
      wireId: 'shared-wire-1',
      status: 'active',
      params: [
        { path: 'reasoning_effort', values: ['low', 'high'], default: 'low' },
        { path: 'max_tokens', range: { min: 1, max: 8192 } },
      ],
    },
    {
      // 同裸 ID 不同 authType/apiSurface/wireId → 独立记录，绝不并集
      model: 'shared',
      provider: 'prov-a',
      authType: 'oauth',
      apiSurface: 'responses',
      wireId: 'shared-wire-2',
      params: [
        { path: 'output_config.effort', values: ['medium'], default: 'medium' },
        { path: 'max_completion_tokens', range: { min: 1, max: 65536 } },
      ],
    },
    {
      model: 'shared',
      provider: 'prov-b',
      authType: 'api_key',
      apiSurface: 'anthropic',
      params: [{ path: 'thinking.budget_tokens', range: { max: 32768 } }],
    },
  ],
}

/** 目录里存在、但当前宿主协议门/写面都没有的协议（compat 全部只读解释）。 */
const UNKNOWN_PROTOCOL_FIXTURE = {
  gamma: JSON.stringify({
    'pi-messages': {
      'chat:shared': {
        id: 'shared',
        api: 'pi-messages',
        baseUrl: 'https://gamma.example/v1',
        provider: 'gamma',
        compat: { supportsStrictMode: true, madeUpKey: true },
      },
    },
  }),
}

const OPENROUTER_FIXTURE = {
  data: [
    { id: 'vendor/other', name: 'Other' },
    { id: 'author-a/shared', name: 'Shared A', context_length: 128000, architecture: { input_modalities: ['text', 'image', 'audio'] }, top_provider: { max_completion_tokens: 4096 }, reasoning: { supported_efforts: ['low', 'high'], default_effort: 'low' } },
    { id: 'author-b/shared', name: 'Shared B', context_length: 64000, architecture: { input_modalities: ['text'] }, top_provider: { max_completion_tokens: 2048 }, reasoning: { supported_efforts: ['medium'] } },
    { id: 'shared', name: 'Shared bare', context_length: 32000 },
  ],
}

const RUNTIME_FIXTURE = {
  input: ['image', 'text'],
  contextWindow: 123456,
  reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] },
  defaultMaxTokens: 4096,
  defaultEffort: 'high',
}

function groupOf(groups, field) {
  return groups.find((group) => group.field === field)
}

function optionsOf(groups, field) {
  return groupOf(groups, field)?.options ?? []
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. pi 索引：渠道 + api + ID 三元身份
// ─────────────────────────────────────────────────────────────────────────────

test('pi evidence: preserves channel+api+id and never merges same-channel cross-api entries', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  // alpha|shared 在两种 api 下各一条 → 2 条记录，能力值不同
  const pair = index.byChannelModel.get('alpha\u0000shared')
  assert.equal(pair.length, 2, 'same channel+id across two apis stays two records')
  assert.deepEqual(pair.map((record) => record.api).sort(), ['anthropic-messages', 'openai-completions'])
  assert.notEqual(pair[0].contextWindow, pair[1].contextWindow, 'values are preserved per api, not merged')
  // exact 键按 api 分开
  assert.equal(index.byExactKey.get('alpha\u0000openai-completions\u0000shared').length, 1)
  assert.equal(index.byExactKey.get('alpha\u0000anthropic-messages\u0000shared').length, 1)
  // 跨渠道同名在 byModelId 里都保留
  assert.ok((index.byModelId.get('shared') ?? []).length >= 3)
  // 单条记录的 api 字段存在且为字符串
  for (const record of index.records) {
    assert.equal(typeof record.channel, 'string')
    assert.equal(typeof record.api, 'string')
    assert.equal(typeof record.modelId, 'string')
    assert.notEqual(record.api, '')
  }
})

test('pi evidence: audit reports collisions without hardcoded installed counts', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const audit = auditPiEvidence(index)
  assert.equal(audit.ok, true, JSON.stringify(audit.problems))
  // fixture 里 alpha|shared 是唯一的跨 api 碰撞
  assert.equal(audit.collisions.length, 1)
  const [collision] = audit.collisions
  assert.equal(collision.channel, 'alpha')
  assert.equal(collision.modelId, 'shared')
  assert.equal(collision.kind, 'same-channel-cross-api')
  assert.deepEqual(collision.apis, ['anthropic-messages', 'openai-completions'])
  assert.equal(collision.count, 2)
  // 记录数与 byChannelModel / byExactKey 的总数一致（没有静默丢弃）
  const pairTotal = [...index.byChannelModel.values()].reduce((sum, rows) => sum + rows.length, 0)
  const exactTotal = [...index.byExactKey.values()].reduce((sum, rows) => sum + rows.length, 0)
  assert.equal(pairTotal, index.records.length)
  assert.equal(exactTotal, index.records.length)
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. reasoning 三态与 wire 产生条件
// ─────────────────────────────────────────────────────────────────────────────

test('pi evidence: reasoning is tri-state and undeclared never collapses to false', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const byId = (api, modelId) => index.byExactKey.get(`alpha\u0000${api}\u0000${modelId}`)[0]
  const declaredTrue = byId('openai-completions', 'shared')
  const undeclared = byId('openai-completions', 'undeclared')
  const explicitFalse = byId('openai-completions', 'explicit-false')
  assert.equal(declaredTrue.reasoningDeclared, true)
  assert.equal(undeclared.reasoningDeclared, undefined, 'missing reasoning stays undeclared, not false')
  assert.equal(explicitFalse.reasoningDeclared, false)
  assert.notEqual(undeclared.reasoningDeclared, explicitFalse.reasoningDeclared, 'undeclared and explicit false are distinct')
  // wire 只在明确 true 且有可表达档位时出现
  assert.deepEqual(declaredTrue.reasoningEfforts, { low: 'low', high: 'high', off: null })
  assert.equal(undeclared.reasoningEfforts, undefined)
  assert.equal(explicitFalse.reasoningEfforts, undefined, 'explicit false never fabricates wire from thinkingLevelMap')
  const audit = auditPiEvidence(index)
  assert.ok(audit.counts.reasoningTrue >= 2)
  assert.ok(audit.counts.reasoningFalse >= 2)
  assert.ok(audit.counts.reasoningUndeclared >= 1)
})

test('pi evidence: baseUrl classified exact/template/empty', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const kinds = new Set(index.records.map((record) => record.baseUrlKind))
  assert.deepEqual([...kinds].sort(), ['empty', 'exact', 'template'])
  const undeclared = index.byExactKey.get('alpha\u0000openai-completions\u0000undeclared')[0]
  assert.equal(undeclared.baseUrlKind, 'template')
  const noBase = index.byExactKey.get('alpha\u0000openai-completions\u0000explicit-false')[0]
  assert.equal(noBase.baseUrlKind, 'empty')
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. 模态集合比较
// ─────────────────────────────────────────────────────────────────────────────

test('modality compare: order-insensitive, undeclared for empty/absent, unknown ignored', () => {
  assert.equal(compareModalitySets(['image', 'text'], ['text', 'image']), 'equal', 'array order is not a capability conflict')
  assert.equal(compareModalitySets(['text'], ['text', 'image']), 'different')
  assert.equal(compareModalitySets([], ['text']), 'undeclared')
  assert.equal(compareModalitySets(undefined, ['text']), 'undeclared')
  assert.equal(compareModalitySets(['text', 'audio'], ['text']), 'equal', 'unexpressible modalities are not hosted fields')
  assert.deepEqual(modalitySet(['image', 'text', 'image']), ['image', 'text'])
  assert.equal(modalitySet([]), undefined)
  assert.equal(modalitySet('text'), undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. 证据分类：exact / same-channel-other-api / cross-channel
// ─────────────────────────────────────────────────────────────────────────────

test('pi evidence lookup: exact, same-channel-other-protocol and cross-channel split', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const view = piEvidenceFor(index, { channel: 'alpha', api: 'anthropic-messages', modelId: 'shared' })
  assert.equal(view.exact.length, 1)
  assert.equal(view.exact[0].api, 'anthropic-messages')
  assert.equal(view.sameChannelOtherApi.length, 1)
  assert.equal(view.sameChannelOtherApi[0].api, 'openai-completions')
  assert.equal(view.crossChannel.length, 1)
  assert.equal(view.crossChannel[0].channel, 'beta')
  // 不存在的模型：三类都空（缺席，不是否定）
  const empty = piEvidenceFor(index, { channel: 'alpha', api: 'anthropic-messages', modelId: 'nope' })
  assert.deepEqual([empty.exact.length, empty.sameChannelOtherApi.length, empty.crossChannel.length], [0, 0, 0])
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. 分组建议：能力字段证据等级与可采纳性
// ─────────────────────────────────────────────────────────────────────────────

test('groups: capability options carry exact/reference evidence and require explicit adoption', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'anthropic-messages', modelId: 'shared', current: { contextWindow: 200000, input: ['image', 'text'] } },
    piIndex: index,
  })
  for (const field of ['name', 'contextWindow', 'maxTokens', 'input']) {
    const group = groupOf(groups, field)
    assert.ok(group !== undefined, `${field} group exists`)
    assert.equal(group.readOnly, false)
    assert.ok(group.options.length >= 3, `${field} collects exact + same-channel + cross-channel`)
    for (const option of group.options) assert.equal(option.requiresExplicitAdoption, true, 'no auto-selection')
    const evidence = new Set(group.options.map((option) => option.evidence))
    assert.ok(evidence.has('exact-channel-protocol'))
    assert.ok(evidence.has('same-channel-other-protocol'))
    assert.ok(evidence.has('cross-channel-reference'))
    assert.ok(group.options.every((option) => option.adoptable === true), 'cross-channel capacities are reference but explicitly adoptable')
  }
  // 模态比较按集合：current ['image','text'] vs exact ['text'] → differs；vs same-channel ['image','text'] → match
  const inputGroup = groupOf(groups, 'input')
  assert.equal(inputGroup.comparison.state, 'match', 'order-insensitive set match against the same-channel option')
  // contextWindow current 200000 = exact 值 → match
  assert.equal(groupOf(groups, 'contextWindow').comparison.state, 'match')
})

test('groups: cross-channel name/context/maxTokens/input come from external reference too', () => {
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'anthropic-messages', modelId: 'shared' },
    openRouter: {
      matches: [],
      ambiguous: false,
      references: [openRouterReference(openRouterMatches('shared', OPENROUTER_FIXTURE).matches.find((match) => match.row.id === 'author-a/shared'))],
    },
  })
  const nameOptions = optionsOf(groups, 'name')
  const external = nameOptions.filter((option) => option.source === 'openrouter')
  assert.equal(external.length, 1)
  assert.equal(external[0].evidence, 'external-reference')
  assert.equal(external[0].adoptable, true)
  // 外部档案的 audio 模态不可表达
  const reference = openRouterReference(openRouterMatches('shared', OPENROUTER_FIXTURE).matches.find((match) => match.row.id === 'author-a/shared'))
  assert.deepEqual(reference.inputInexpressible, ['audio'])
  assert.deepEqual(reference.input, ['image', 'text'])
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. wire/compat 只有精确渠道+协议
// ─────────────────────────────────────────────────────────────────────────────

test('groups: wire mapping is adoptable only from exact channel+protocol; foreign wire is read-only', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'anthropic-messages', modelId: 'shared' },
    piIndex: index,
  })
  const group = groupOf(groups, 'reasoningEfforts')
  const exact = group.options.filter((option) => option.evidence === 'exact-channel-protocol')
  const foreign = group.options.filter((option) => option.adoptable === false)
  // 当前协议明确 false → 只给 false 这一个精确选项
  assert.equal(exact.length, 1)
  assert.equal(exact[0].value, false, 'exact protocol declares reasoning false')
  assert.equal(exact[0].adoptable, true)
  assert.ok(foreign.length >= 1, 'same-channel other-protocol wire is retained as reference')
  for (const option of foreign) {
    assert.equal(option.readOnly, true)
    assert.equal(option.adoptable, false, 'wire is never carried across protocols')
    assert.equal(option.kind, 'foreign-wire')
  }
})

test('groups: exact reasoning true yields an adoptable wire map', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' },
    piIndex: index,
  })
  const group = groupOf(groups, 'reasoningEfforts')
  const exact = group.options.find((option) => option.evidence === 'exact-channel-protocol' && option.adoptable === true)
  assert.deepEqual(exact.value, { low: 'low', high: 'high', off: null })
})

test('groups: compat honours the protocol gate (offer writable, withhold read-only)', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' },
    piIndex: index,
  })
  const group = groupOf(groups, 'compat')
  const keys = group.options.filter((option) => option.adoptable === true).map((option) => option.key).sort()
  assert.deepEqual(keys, ['supportsReasoningEffort', 'supportsStore'])
  const withheld = group.inexpressible.map((entry) => entry.key).sort()
  assert.deepEqual(withheld, ['openRouterRouting', 'sendSessionAffinityHeaders'])
  assert.ok(group.inexpressible.every((entry) => entry.reason === 'protocol-withholds-key'))
  // withhold 键绝不出现在可采纳选项里
  for (const option of group.options) {
    assert.ok(!['openRouterRouting', 'sendSessionAffinityHeaders'].includes(option.key) || option.adoptable === false)
  }
  assert.equal(COMPAT_PROTOCOL_GATE['openai-completions'].openRouterRouting, 'withhold')
})

test('groups: cross-channel compat is read-only reference, never adoptable', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'anthropic-messages', modelId: 'shared' },
    piIndex: index,
  })
  const cross = groupOf(groups, 'compat').options.filter((option) => option.evidence === 'cross-channel-reference')
  assert.ok(cross.length >= 1)
  for (const option of cross) {
    assert.equal(option.adoptable, false)
    assert.equal(option.readOnly, true)
    assert.equal(option.kind, 'foreign-compat')
  }
})

test('groups: unknown/empty protocol has no writable compat key', () => {
  const index = buildPiEvidence(UNKNOWN_PROTOCOL_FIXTURE)
  const { groups } = buildSmartFillGroups({
    target: { channel: 'gamma', api: 'pi-messages', modelId: 'shared' },
    piIndex: index,
  })
  const group = groupOf(groups, 'compat')
  assert.equal(group.options.filter((option) => option.adoptable).length, 0)
  assert.equal(group.inexpressible.length, 2, 'every compat key of an ungated protocol is read-only explanation')
  assert.ok(group.inexpressible.some((entry) => entry.reason === 'unknown-protocol'))
  assert.equal(group.absentReason, 'not-writable-under-protocol')
  assert.equal(group.unsupported, false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. 缺席推理
// ─────────────────────────────────────────────────────────────────────────────

test('groups: absence is reasoned and never claimed as unsupported', () => {
  const { groups, notes } = buildSmartFillGroups({
    target: { channel: 'nowhere', api: 'openai-completions', modelId: 'ghost' },
  })
  for (const group of groups) {
    assert.equal(group.unsupported, false, 'no group turns absence into a negative capability claim')
    if (group.options.length === 0) {
      assert.ok(['no-local-evidence', 'source-undeclared'].includes(group.absentReason), `${group.field} has absentReason`)
    }
  }
  assert.equal(groupOf(groups, 'reasoningEfforts').absentReason, 'no-local-evidence')

  // 有记录但字段未表态 → source-undeclared，且不会被当成 false
  const index = buildPiEvidence(PI_FIXTURE)
  const { groups: declared } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'undeclared' },
    piIndex: index,
  })
  const reasoning = groupOf(declared, 'reasoningEfforts')
  assert.equal(reasoning.options.length, 0)
  assert.equal(reasoning.absentReason, 'source-undeclared')
  assert.equal(reasoning.unsupported, false)
  assert.ok(notes === undefined || Array.isArray(notes))
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. modelparams：独立身份、无并集、range.max 只读
// ─────────────────────────────────────────────────────────────────────────────

test('modelparams: records keep provider/authType/apiSurface/model/wireId identity and are never unioned', () => {
  const index = indexModelParamsRecords(MODELPARAMS_FIXTURE)
  const reference = modelParamsReference(index, 'shared')
  // 3 条独立身份（prov-a/api_key、prov-a/oauth、prov-b/api_key）
  assert.equal(reference.identities.length, 3)
  const keys = reference.identities.map((identity) => `${identity.provider}|${identity.authType}|${identity.apiSurface}|${identity.wireId}`)
  assert.deepEqual(keys.sort(), [
    'prov-a|api_key|openai|shared-wire-1',
    'prov-a|oauth|responses|shared-wire-2',
    'prov-b|api_key|anthropic|',
  ])
  // effort values 逐记录独立，不并集、不贴第一条 provider 标签
  assert.equal(reference.effortValues.length, 2)
  const valueSets = reference.effortValues.map((entry) => `${entry.identity.authType}:${entry.values.join('+')}`)
  assert.deepEqual(valueSets.sort(), ['api_key:low+high', 'oauth:medium'])
  assert.ok(reference.effortValues.every((entry) => entry.wire === false), 'effort values are source declarations, not wire')
  // 没有任何聚合字段
  assert.equal(Object.prototype.hasOwnProperty.call(reference, 'effortUnion'), false)
  assert.equal(reference.identities[0].model, 'shared')
})

test('modelparams: range.max is read-only and never becomes a maxTokens suggestion', () => {
  const index = indexModelParamsRecords(MODELPARAMS_FIXTURE)
  const reference = modelParamsReference(index, 'shared')
  const ranges = reference.requestRanges.map((range) => range.rangeMax).sort((a, b) => a - b)
  assert.deepEqual(ranges, [8192, 32768, 65536])
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared', current: { maxTokens: 8000 } },
    modelParams: reference,
  })
  const rangeGroup = groupOf(groups, 'paramRangeMax')
  assert.equal(rangeGroup.readOnly, true)
  assert.equal(rangeGroup.mapsToModelField, null, 'request range maps to no model field')
  assert.equal(rangeGroup.adoptable, false)
  assert.ok(rangeGroup.options.every((option) => option.readOnly === true && option.adoptable === false))
  assert.ok(rangeGroup.notes.some((note) => note.includes('maxTokens')))
  // 没有任何 maxTokens 选项来自 modelparams
  const maxTokensFromModelParams = optionsOf(groups, 'maxTokens').filter((option) => option.source === 'modelparams')
  assert.equal(maxTokensFromModelParams.length, 0, 'range.max must not be suggested as maxTokens')
  // 来源默认也 read-only
  assert.ok(optionsOf(groups, 'sourceDefaults').every((option) => option.readOnly === true && option.adoptable === false))
  assert.ok(optionsOf(groups, 'sourceEffortValues').every((option) => option.readOnly === true && option.adoptable === false))
  // reasoningEfforts 组里不能混入 modelparams 选项（不跨来源拼 wire）
  assert.equal(optionsOf(groups, 'reasoningEfforts').filter((option) => option.source === 'modelparams').length, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. OpenRouter 歧义
// ─────────────────────────────────────────────────────────────────────────────

test('openrouter: ambiguity preserves all matches, never defaults to the first', () => {
  const result = openRouterMatches('shared', OPENROUTER_FIXTURE)
  assert.equal(result.ambiguous, true)
  assert.equal(result.matches.length, 3, 'all suffix matches retained')
  assert.deepEqual(result.matches.map((match) => match.row.id).sort(), ['author-a/shared', 'author-b/shared', 'shared'])
  assert.equal(result.searched, OPENROUTER_FIXTURE.data.length)
  // exact match ranks before suffix matches
  assert.equal(result.matches[0].row.id, 'shared')
  assert.equal(result.matches[0].matchKind, 'exact')
  // 不做「唯一真值」选择
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'match'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'selected'), false)
  // 无命中 → 空数组，不是 undefined 首条
  const none = openRouterMatches('does-not-exist', OPENROUTER_FIXTURE)
  assert.deepEqual(none.matches, [])
  assert.equal(none.ambiguous, false)
})

test('openrouter: reference is identity-only and source-default efforts are not wire', () => {
  const match = openRouterMatches('shared', OPENROUTER_FIXTURE).matches.find((row) => row.row.id === 'author-a/shared')
  const reference = openRouterReference(match)
  assert.equal(reference.evidence, 'external-reference')
  assert.deepEqual(reference.supportedEfforts, ['low', 'high'])
  assert.equal(reference.defaultEffort, 'low')
  assert.equal(reference.maxTokens, 4096)
  assert.equal(reference.contextWindow, 128000)
  assert.equal(Object.prototype.hasOwnProperty.call(reference, 'reasoningEfforts'), false, 'source efforts never become a wire map')
})

test('openrouter: fixed request URLs route model vs search and stay whitelisted', () => {
  const modelRequest = openRouterRequest('author-a/shared')
  assert.equal(modelRequest.sourceId, 'openrouter-model')
  assert.ok(modelRequest.url.startsWith('https://openrouter.ai/api/v1/model/'))
  assert.equal(assertSourceAllowed(modelRequest.url).ok, true)
  const searchRequest = openRouterRequest('shared')
  assert.equal(searchRequest.sourceId, 'openrouter-search')
  assert.ok(searchRequest.url.startsWith('https://openrouter.ai/api/v1/models?q='))
  assert.equal(assertSourceAllowed(searchRequest.url).ok, true)
})

test('openrouter: detail path keeps literal slashes (percent-encoded slash is a 404 upstream)', () => {
  // 实测 2026-10-12：`/api/v1/model/anthropic/claude-haiku-5.5` → 200，`%2F` 形态 → 404。
  // 因此逐段编码、段间保留字面 `/`；段内不安全字符仍必须编码。
  const request = openRouterRequest('anthropic/claude-haiku-5.5')
  assert.equal(request.url, 'https://openrouter.ai/api/v1/model/anthropic/claude-haiku-5.5')
  assert.equal(request.url.includes('%2F'), false, 'never percent-encode the path separator')
  assert.equal(request.url.includes('%2f'), false)
  assert.equal(assertSourceAllowed(request.url).ok, true)
  // 多段 ID：每段独立做结构安全编码；pchar（`@` `.` `:`）保持字面，路径结构仍由 `/` 划分
  const multi = openRouterRequest('@cf/meta/llama 3?x#y')
  assert.equal(multi.url, 'https://openrouter.ai/api/v1/model/@cf/meta/llama%203%3Fx%23y')
  assert.equal(multi.url.includes('%40'), false, 'legal pchar @ is not over-encoded')
  assert.equal(assertSourceAllowed(multi.url).ok, true, 'segment-encoded multi-segment id stays whitelisted')
  // 编码后的段不可能注入路径穿越（`..` 逐段编码后仍是 ..，被路径守卫拒掉）
  assert.equal(assertSourceAllowed('https://openrouter.ai/api/v1/model/..%2Fetc').ok, false)
  // 查询形态仍然只编码 q 值
  assert.equal(openRouterRequest('a b').url, `https://openrouter.ai/api/v1/models?q=a%20b&limit=${MAX_OPENROUTER_SEARCH_LIMIT}`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. 运行时：不推断 wire
// ─────────────────────────────────────────────────────────────────────────────

test('runtime: effort ids get no wire inference and adapter defaults stay read-only', () => {
  const runtime = runtimeReference({ ...RUNTIME_FIXTURE, reasoning: { efforts: [{ id: 'high', name: 'High', value: 'HIGH_WIRE' }] } })
  assert.equal(runtime.reasoningWire, null)
  assert.equal(runtime.reasoningWireAvailable, false)
  assert.deepEqual(runtime.reasoningEffortIds, ['high'])
  assert.equal(Object.prototype.hasOwnProperty.call(runtime, 'reasoningEfforts'), false, 'runtime never fabricates a wire map from ids')
  assert.equal(runtime.defaultMaxTokensKind, 'adapter-budget')

  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' },
    runtime,
  })
  const effortGroup = groupOf(groups, 'runtimeEfforts')
  assert.equal(effortGroup.wireAvailable, false)
  assert.equal(effortGroup.readOnly, true)
  for (const option of effortGroup.options) {
    assert.equal(option.adoptable, false)
    assert.equal(option.readOnly, true)
    assert.deepEqual(option.value, { ids: ['high'], names: ['High'] })
  }
  const defaults = optionsOf(groups, 'adapterDefaults')
  assert.ok(defaults.length >= 1)
  for (const option of defaults) assert.equal(option.adoptable, false)
  assert.ok(defaults.some((option) => option.kind === 'adapter-budget'))
  // reasoningEfforts 组里不能出现 runtime 的 wire
  assert.equal(optionsOf(groups, 'reasoningEfforts').filter((option) => option.source === 'runtime').length, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 11. 固定来源白名单
// ─────────────────────────────────────────────────────────────────────────────

test('allowlist: only the fixed sources pass; everything else is refused', () => {
  assert.equal(assertSourceAllowed(modelParamsRequest().url).ok, true)
  assert.equal(assertSourceAllowed(openRouterRequest('a/b').url).ok, true)
  const refusals = [
    ['http://modelparams.dev/api/v1/models.json', 'insecure'],
    ['https://evil.example/api/v1/models.json', 'source-not-whitelisted'],
    ['https://modelparams.dev/api/v1/other.json', 'source-not-whitelisted'],
    ['https://modelparams.dev/api/v1/models.json?extra=1', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=a&limit=50&key=leak', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=a&limit=99999', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=a&limit=51', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=a&limit=50&limit=50', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=a&q=b', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=', 'bad-query'],
    [`https://openrouter.ai/api/v1/models?q=${'x'.repeat(300)}`, 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=a%2Fb', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=a%5Cb', 'bad-query'],
    ['https://openrouter.ai/api/v1/models?q=..', 'bad-query'],
    ['https://openrouter.ai/api/v1/model/%2e%2e%2f%2e%2e%2fetc', 'bad-path'],
    ['https://openrouter.ai/api/v1/model/..%2f..%2fetc', 'bad-path'],
    ['https://modelparams.dev/api/v1/models.json?extra=1&extra=2', 'bad-query'],
    ['https://user:pass@modelparams.dev/api/v1/models.json', 'credentials-in-url'],
    ['https://modelparams.dev:8443/api/v1/models.json', 'bad-port'],
    ['https://openrouter.ai/api/v1/model/../../etc/passwd', 'source-not-whitelisted'],
    ['not a url', 'bad-url'],
  ]
  for (const [url, code] of refusals) {
    const result = assertSourceAllowed(url)
    assert.equal(result.ok, false, `refuse ${url}`)
    assert.equal(result.code, code, `${url} → ${code}`)
  }
  assert.equal(auditSourceWhitelist().ok, true)
})

// ─────────────────────────────────────────────────────────────────────────────
// 12. 受控取数：有界 + 条件请求
// ─────────────────────────────────────────────────────────────────────────────

test('fetcher: whitelist is enforced before any transport call', async () => {
  let called = 0
  const fetcher = createSourceFetcher({ transport: async () => { called += 1; return { status: 200, headers: {}, body: '{}' } } })
  await assert.rejects(() => fetcher('https://evil.example/steal'), (error) => error.code === 'source-not-whitelisted')
  assert.equal(called, 0, 'no transport call for a non-whitelisted URL')
  const ok = await fetcher(modelParamsRequest().url)
  assert.equal(ok.status, 200)
  assert.equal(called, 1)
})

test('fetcher: bounded, no redirect, conditional 304', async () => {
  const seen = []
  const fetcher = createSourceFetcher({
    transport: async (url, { headers }) => {
      seen.push(headers)
      if (headers['if-none-match'] === 'etag-1') return { status: 304, headers: { etag: 'etag-2' }, body: '' }
      return { status: 200, headers: { etag: 'etag-1' }, body: '{"models":[]}' }
    },
  })
  const first = await fetcher(modelParamsRequest().url)
  assert.equal(first.status, 200)
  assert.equal(first.etag, 'etag-1')
  const conditional = await fetcher(modelParamsRequest().url, { etag: 'etag-1' })
  assert.equal(conditional.status, 304)
  assert.equal(conditional.etag, 'etag-2')
  assert.equal(seen[1]['if-none-match'], 'etag-1')

  const redirect = createSourceFetcher({ transport: async () => ({ status: 302, headers: { location: 'https://elsewhere' }, body: '' }) })
  await assert.rejects(() => redirect(modelParamsRequest().url), (error) => error.code === 'redirect')
  const status = createSourceFetcher({ transport: async () => ({ status: 500, headers: {}, body: '' }) })
  await assert.rejects(() => status(modelParamsRequest().url), (error) => error.code === 'http-status:500')
  const oversize = createSourceFetcher({ transport: async () => ({ status: 200, headers: {}, body: 'x'.repeat(1000) }), limits: { maxBytes: 64 } })
  await assert.rejects(() => oversize(modelParamsRequest().url), (error) => error.code === 'too-large')
  assert.ok(MAX_METADATA_BYTES > 0)
})

test('fetcher: parse failures are explicit, never a silent empty result', () => {
  assert.throws(() => parseModelParamsPayload('not json'), (error) => error.code === 'bad-json')
  assert.throws(() => parseModelParamsPayload('{"models":"nope"}'), (error) => error.code === 'bad-shape')
  assert.throws(() => parseOpenRouterPayload('[]junk'), (error) => error.code === 'bad-json')
  assert.deepEqual(parseOpenRouterPayload('{"data":[]}').data, [])
  assert.equal(upstreamAtOf('modelparams', { generatedAt: '2026-10-01T00:00:00Z' }), Date.parse('2026-10-01T00:00:00Z'))
  assert.equal(upstreamAtOf('openrouter', { generatedAt: 'x' }), undefined)
})

// ─────────────────────────────────────────────────────────────────────────────
// 12b. OpenRouter 真实载荷形状：单模型详情是 data **对象**
// ─────────────────────────────────────────────────────────────────────────────

const OPENROUTER_MODEL_DETAIL = JSON.stringify({
  data: {
    id: 'author-a/shared',
    canonical_slug: 'author-a/shared',
    name: 'Shared A',
    context_length: 128000,
    architecture: { input_modalities: ['text', 'image', 'audio'] },
    top_provider: { max_completion_tokens: 4096 },
    reasoning: { supported_efforts: ['low', 'high'], default_effort: 'low' },
  },
})

test('openrouter: /api/v1/model/{author}/{slug} returns a data OBJECT and is accepted (no first-ambiguous pick)', () => {
  const payload = parseOpenRouterPayload(OPENROUTER_MODEL_DETAIL)
  assert.equal(Array.isArray(payload.data), true, 'single detail object is wrapped into a one-row array')
  assert.equal(payload.data.length, 1)
  assert.equal(payload.data[0].id, 'author-a/shared')
  // 匹配层与解析层必须同形：否则解析通过、匹配为空，单模型详情被静默变成「零命中」。
  const result = openRouterMatches('author-a/shared', payload)
  assert.equal(result.matches.length, 1, 'detail payload is matched, not dropped')
  assert.equal(result.matches[0].matchKind, 'exact')
  assert.equal(result.ambiguous, false)
  const reference = openRouterReference(result.matches[0])
  assert.equal(reference.identity.author, 'author-a')
  assert.equal(reference.identity.slug, 'shared')
  assert.equal(reference.contextWindow, 128000)
  assert.deepEqual(reference.supportedEfforts, ['low', 'high'])
  // 裸 model 对象（部分镜像直接返回顶层 model）同样接受
  const bare = parseOpenRouterPayload(JSON.stringify({ id: 'author-b/shared', name: 'B', context_length: 64000 }))
  assert.equal(bare.data.length, 1)
  assert.equal(bare.data[0].id, 'author-b/shared')
})

test('openrouter: unknown shapes are bad-shape, never an empty successful result', () => {
  const bad = [
    '{}',
    '{"data":{"name":"no id"}}',
    '{"data":{"id":123}}',
    '{"data":{"id":""}}',
    '{"data":"nope"}',
    'null',
    '42',
  ]
  for (const text of bad) {
    assert.throws(() => parseOpenRouterPayload(text), (error) => error.code === 'bad-shape', `bad-shape for ${text}`)
  }
  // 数组形态（含空数组）仍走批量语义：空 = 该查询无结果，不是形状错误
  assert.deepEqual(parseOpenRouterPayload('[]').data, [])
  assert.deepEqual(parseOpenRouterPayload('{"data":[]}').data, [])
  // 批里混入非对象行：解析宽容（OpenRouter 轮换字段时不至于整源失败），
  // 但匹配层绝不把垃圾当模型行——不产生任何候选、更不取首条。
  const mixed = parseOpenRouterPayload('{"data":[1,"two",null,{"id":"author-a/shared"}]}')
  const matched = openRouterMatches('author-a/shared', mixed)
  assert.deepEqual(matched.matches.map((match) => match.row.id), ['author-a/shared'])
  assert.equal(matched.ambiguous, false)
  const noRows = openRouterMatches('shared', parseOpenRouterPayload('{"data":[1,"two",null]}'))
  assert.deepEqual(noRows.matches, [], 'non-object rows never become match candidates')
})

// ─────────────────────────────────────────────────────────────────────────────
// 12c. modelparams 漂移：空 .models 是 schema 漂移，不是「无资料」
// ─────────────────────────────────────────────────────────────────────────────

test('modelparams payload: empty .models is schema drift, not a silent empty catalog', () => {
  assert.throws(() => parseModelParamsPayload('{"models":[]}'), (error) => error.code === 'bad-shape')
  assert.throws(() => parseModelParamsPayload('{"models":[]}'), /bad-shape/)
  // 非空 models 正常通过
  assert.deepEqual(parseModelParamsPayload('{"models":[{"model":"m"}]}').models.length, 1)
  // 漂移经缓存可见（status:error + staleError），旧载荷保留为 stale
  const driftCache = createMetadataCache({
    fetcher: createSourceFetcher({ transport: async () => ({ status: 200, headers: {}, body: '{"models":[]}' }) }),
  })
  return driftCache.get({ ...modelParamsRequest(), parse: parseModelParamsPayload }).then((drifted) => {
    assert.equal(drifted.status, 'error')
    assert.equal(drifted.staleError, 'bad-shape')
    assert.equal(drifted.payload, undefined, 'drift never becomes an empty payload pretending success')
  })
})

test('modelparams index: per-entry drift is retained as evidence and never throws out of the source', () => {
  const catalog = {
    models: [
      { model: 'ok', provider: 'p', params: [{ path: 'reasoning_effort', values: ['low'], default: 'low' }] },
      null,
      { provider: 'p' },
      { model: 'bad\u0001id', provider: 'p' },
      { model: 'x'.repeat(300), provider: 'p' },
      { model: 'weird', provider: 'p', params: [{ path: 'max_tokens', range: { max: true } }] },
      { model: 'norange', provider: 'p', params: [{ path: 'max_tokens', range: 'nope' }] },
      { model: 'novalues', provider: 'p', params: [{ path: 'x', values: 42 }] },
      { model: 'nppath', provider: 'p', params: [{ values: ['a'] }, 'not-an-object'] },
      { model: 'nonparr', provider: 'p', params: 'nope' },
    ],
  }
  let index
  assert.doesNotThrow(() => { index = indexModelParamsRecords(catalog) })
  // 合法条目仍然建出记录（漂移不阻断整源）
  assert.ok(index.records.some((record) => record.model === 'ok'))
  const reasons = index.skippedDetail.map((entry) => entry.reason)
  for (const reason of ['entry-not-object', 'model-missing', 'model-id-invalid', 'range-max-not-integer', 'range-not-object', 'values-not-array', 'param-path-missing', 'param-not-object', 'params-not-array']) {
    assert.ok(reasons.includes(reason), `drift reason retained: ${reason}`)
  }
  assert.equal(index.skipped, index.skippedDetail.length)
  // 非整数 range 边界绝不变成可读的 rangeMax（宁可留空 + 留证）
  const weird = index.byModelId.get('weird')[0]
  assert.equal(weird.rangeMax, undefined)
  // 参考面把漂移证据一并回传，调用方能区分「无资料」与「来源漂移」
  const reference = modelParamsReference(index, 'weird')
  assert.equal(reference.skipped, index.skipped)
  assert.ok(reference.skippedDetail.length >= 1)
  // 空数组/坏形状目录本身不抛
  assert.doesNotThrow(() => indexModelParamsRecords({ models: 'nope' }))
  assert.doesNotThrow(() => indexModelParamsRecords(undefined))
})

// ─────────────────────────────────────────────────────────────────────────────
// 13. 缓存：单飞 + 条件刷新 + 失败可见
// ─────────────────────────────────────────────────────────────────────────────

test('fetcher: metadata sources never receive credentials — header allowlist is enforced', async () => {
  const calls = []
  const fetcher = createSourceFetcher({
    transport: async (url, { headers }) => {
      calls.push(headers)
      return { status: 200, headers: {}, body: '{}' }
    },
  })
  const request = modelParamsRequest()
  const sensitive = [
    { authorization: 'Bearer sk-real-key' },
    { Authorization: 'Bearer sk-real-key' },
    { COOKIE: 'session=secret' },
    { 'x-api-key': 'sk-real-key' },
    { 'proxy-authorization': 'Basic x' },
    { apikey: 'sk-real-key' },
  ]
  for (const headers of sensitive) {
    await assert.rejects(
      () => fetcher(request.url, { headers }),
      (error) => error.code === 'forbidden-header',
      `sensitive header must be refused: ${Object.keys(headers)[0]}`,
    )
  }
  assert.equal(calls.length, 0, 'no credential-bearing request ever reaches the transport')
  // 闭集内的元数据头放行
  await fetcher(request.url, { headers: { accept: 'application/json', 'user-agent': 'caller', 'accept-encoding': 'identity' } })
  assert.equal(calls.length, 1)
  assert.deepEqual(Object.keys(calls[0]).sort(), ['accept', 'accept-encoding', 'user-agent'])
  // 集合外的任意头默认拒绝（新增元数据头必须显式进闭集）
  await assert.rejects(() => fetcher(request.url, { headers: { 'x-custom-meta': 'v' } }), (error) => error.code === 'unknown-header')
  await assert.rejects(() => fetcher(request.url, { headers: { 'x-forwarded-for': '1.2.3.4' } }), (error) => error.code === 'unknown-header')
  // CRLF 注入在 http 层之前就拒
  await assert.rejects(() => fetcher(request.url, { headers: { accept: 'a\r\nx-evil: 1' } }), (error) => error.code === 'bad-header-value')
  await assert.rejects(() => fetcher(request.url, { headers: { accept: 'a'.repeat(2048) } }), (error) => error.code === 'bad-header-value')
  await assert.rejects(() => fetcher(request.url, { headers: { accept: { nested: true } } }), (error) => error.code === 'bad-header-value')
  await assert.rejects(() => fetcher(request.url, { headers: 'not-an-object' }), (error) => error.code === 'bad-headers')
  await assert.rejects(() => fetcher(request.url, { etag: 'e\r\nx: 1' }), (error) => error.code === 'bad-etag')
  assert.ok(METADATA_HEADER_ALLOWLIST.every((name) => !['authorization', 'cookie', 'x-api-key'].includes(name)))
  assert.equal(calls.length, 1, 'refused requests add no transport calls')
})

test('fetcher: gzip/br decompression is engine-bounded (no unbounded allocation before the check)', async () => {
  const { gzipSync, brotliCompressSync, brotliDecompress, gunzip } = await import('node:zlib')
  const bombPlain = Buffer.from('a'.repeat(MAX_METADATA_INFLATED_BYTES + 4096), 'utf8')
  const gzBomb = gzipSync(bombPlain)
  const brBomb = brotliCompressSync(bombPlain)
  assert.ok(gzBomb.length < 64 * 1024, 'compressed bomb stays small, so the transport limit cannot catch it')
  // 引擎侧行为：maxOutputLength 让 zlib 边解边截断并报错，绝不先解出完整正文再判大小。
  const gzCode = await new Promise((resolve) => gunzip(gzBomb, { maxOutputLength: MAX_METADATA_INFLATED_BYTES }, (error) => resolve(error?.code ?? 'ok')))
  assert.notEqual(gzCode, 'ok', 'gzip bomb is truncated by the engine, not allocated in full')
  const brCode = await new Promise((resolve) => brotliDecompress(brBomb, { maxOutputLength: MAX_METADATA_INFLATED_BYTES }, (error) => resolve(error?.code ?? 'ok')))
  assert.notEqual(brCode, 'ok', 'brotli bomb is truncated by the engine too')
  // 未压缩正文超限在传输层就被拒（body 长度判据在解压分支之外）
  const plainFetcher = createSourceFetcher({ transport: async () => ({ status: 200, headers: {}, body: bombPlain.toString('utf8') }) })
  await assert.rejects(() => plainFetcher(modelParamsRequest().url), (error) => error.code === 'too-large')
  // 注入 transport 的字符串正文也过解压后上限（显式下调后 4KB 正文即拒）
  const inflatedFetcher = createSourceFetcher({
    limits: { maxBytes: MAX_METADATA_BYTES, maxInflatedBytes: 1024 },
    transport: async () => ({ status: 200, headers: {}, body: 'y'.repeat(4096) }),
  })
  await assert.rejects(() => inflatedFetcher(modelParamsRequest().url), (error) => error.code === 'too-large')
  // 未超过更严上限时正常放行（上限判定是 >，不是 >=）
  const withinFetcher = createSourceFetcher({
    limits: { maxBytes: MAX_METADATA_BYTES, maxInflatedBytes: 4096 },
    transport: async () => ({ status: 200, headers: {}, body: 'y'.repeat(1000) }),
  })
  assert.equal((await withinFetcher(modelParamsRequest().url)).status, 200)
})

test('fetcher: a slow-but-alive transport hits the whole-request wall deadline', async () => {
  let disposed = 0
  const fetcher = createSourceFetcher({
    limits: { timeoutMs: 30 },
    transport: (_url, { signal }) => new Promise(() => {
      signal?.addEventListener('abort', () => { disposed += 1 }, { once: true })
    }),
  })
  const startedAt = Date.now()
  await assert.rejects(() => fetcher(modelParamsRequest().url), (error) => error.code === 'timeout')
  assert.ok(Date.now() - startedAt < 5000, 'deadline fires without waiting for the transport')
  assert.equal(disposed, 1, 'the injected transport is aborted so it cannot keep running detached')
})

// ─────────────────────────────────────────────────────────────────────────────
// 12a-2. 真实 socket 路径：本地 HTTPS 服务器上的墙钟死线 / 解压上限 / 错误码分类
// （注入 transport 的用例覆盖不到 https.request + AbortSignal + zlib 的接线）
// ─────────────────────────────────────────────────────────────────────────────

/** 固定自签测试证书（localhost/127.0.0.1，10 年有效期；仅用于本地 TLS 回环测试）。 */
const LOCALHOST_TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUUXXzrsPLMODKTudXUU6XivuSI6gwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MTAxMjAyNTkwMFoXDTM2MTAw
OTAyNTkwMFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAtr/ChOp7TdWI0VEyDOb9lKRk7jFZrp+Jg3oGDBZpCMaD
dkYC/AXy4lo8K4vlV6QmGGnhjwuxE9LliVeVGjTAKZXdmAJZfKCbpWyWELe/ZX/9
m6BNko8P2Pv4B31oFTsc3afqqjoj0Uw1C0gk9MIrGt4mu3p25XcwAwA38JoULauU
qVe6Q2+MoRW5kGKYAVC5XUa5/WaTjfcTPpcpq7nKwohSFvbm+xwcBnnLfsbmybTM
Un8IkKkiSjwEzp6noQ7VgMRz7wm2CgU6TtcGkB0T845UZ5O++Ge9T52unTDbrlqK
PJ7+FJ4Y8IxY5A5MOVh6LCzHfaQEl06BXpfLOs5k9QIDAQABo28wbTAdBgNVHQ4E
FgQUbZmiXHcm40tB+D+2jeEyOuNps8EwHwYDVR0jBBgwFoAUbZmiXHcm40tB+D+2
jeEyOuNps8EwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBAGKbQF7XdMV2BH987eMWfnlFbwflKImJ
Vj8EYLa6Lqf/YiCC9WxNT1cOqiK9p/6W/8shzSZgq6+wGB72RAAasnZSl8XajCLg
2cp3rST9llpbdb8Hh9Bhl+wQI+LjjxetFHin50cs5KjEjuJbv+nwcADxCH36txms
M2/3FVUzneWVVG6Ac1bQPBxLqcQ12ITQXe/Yv7F30Zcjxo5iFG6angEtWXREoWWN
3VBVOnW5aEyhQq6QbOXdeRV9ddpHdmW4lX/A9VzkN/v35uYkwwQ/6TC3PjXnYZNX
pv5PZPE4+AoaTD7QtQ16RZ9u1JYlNnROcnMZTKcBLqiBdsOfx6WLacQ=
-----END CERTIFICATE-----`
const LOCALHOST_TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC2v8KE6ntN1YjR
UTIM5v2UpGTuMVmun4mDegYMFmkIxoN2RgL8BfLiWjwri+VXpCYYaeGPC7ET0uWJ
V5UaNMApld2YAll8oJulbJYQt79lf/2boE2Sjw/Y+/gHfWgVOxzdp+qqOiPRTDUL
SCT0wisa3ia7enbldzADADfwmhQtq5SpV7pDb4yhFbmQYpgBULldRrn9ZpON9xM+
lymrucrCiFIW9ub7HBwGect+xubJtMxSfwiQqSJKPATOnqehDtWAxHPvCbYKBTpO
1waQHRPzjlRnk774Z71Pna6dMNuuWoo8nv4UnhjwjFjkDkw5WHosLMd9pASXToFe
l8s6zmT1AgMBAAECggEAUAXJLj2lD7Cc8BdvZLHzQVb5MUof3LTUWOOiaUGY7bRL
lYtTvDr4n8Bmj6T7ILTqz47xq5sxh542T70vt6F4sd0DgxAoUkfb0ASr85cact4o
VbDMtwv5Iwk2k0UJQh635aGlQrQhwgDuS0nkkN7DVEkJydd238Ugm3fJhwxZIKO/
KCDY/H5W4EbghAIITmlyOufSWbgpygQ2FfZ/+YQb4AqVo4emVNd7P73GEV21gvLr
EXi4GhJ1lXWKKPt4GytUNWiigVdkXRGokL8PdxeE/QgxPfnKQrfCgi7VJIKPbqX2
mMcBQpPHx8RFFvboCNoYbcbpcxw4XYh0dutxEKycUwKBgQDm8wxuCnMFU8KH9O/I
t2eEggHwPLN46EQBiHYExQ7lBiE+RjTba5/xyGcCjC9emzZdX0FoltkV0dW2VmgD
Smrf8/iBG291uiV56N1GzZ0F0RzbNIIg3O+7PYRPTxeN+nv65bIlBXFSDeP7UHeW
0uNGnw1lN3Rm4OcW4atZYCESBwKBgQDKkkt76w/Px/xm/CFCR9th9w0zianjlUEZ
JAo1saoz22pk7yuas3xlaTxVo2ITfUXM8qmrx5oyqQiqX89UzQEonA6L3D47pr0R
IYbCmYFsfyCHktcq3/jvoLb6rV6Txt3m7dyJQkx5IxvcwGI7orvAj5hT7x1WgFL/
JIHutfwiIwKBgQDJvxPipNopkyviXIODEUQqqu9Kj5wwSKXvuOdv7zy9sIclwWq3
KuND8U6bGR7gRDJPisC2vt/QgcdxSzX9eeq2zIcPMYpCi2PlhRiXm1JKHIxaqRnr
31TEek60gWEQM/pOCI2Abaq6hUvc5EQzyvGjZZnsC29x15HHmUd4AdOhzQKBgBJI
b+2oQo4TU7GL0gikaaWG4bckFqRGxVBak11TQrRZelnPyFS3HGQewmZMT77IkLM1
t6CcbEtkPDb8XL8fnZons5xl7Wv+2ZOhPgN0TV0YgDwcQbVJ77LZA4rOePnHeiGs
mDn/NN2+EHa1GmidgGqZyzrQGwrCnDsQ9XUxEaeXAoGAU0tBUZoChVev2JA/CPZt
UZKdQILCN/kJjMI/jCkfuZU8pcHFJMIAiY3+RWX17iomvl2zcPcJgwPp07/4dA+m
C3QWOHV6voqQ29RViOMPBGzA3Yh4Egzf1wJ2qvZ9lAG11vOQFmcSjL8e/3f1kmSh
Oe6WdcGBPOScqHA5Br7bT24=
-----END PRIVATE KEY-----`

const originalCaCertificates = tls.getCACertificates()
after(() => tls.setDefaultCACertificates(originalCaCertificates))

test('fetcher socket path: real HTTPS server hits wall deadline, decompression cap stays too-large', async () => {
  const { gzipSync } = await import('node:zlib')
  // 只把自签测试证书追加进现有信任集，不替换、不放宽校验（不设 NODE_TLS_REJECT_UNAUTHORIZED）。
  tls.setDefaultCACertificates([...tls.getCACertificates(), LOCALHOST_TEST_CERT])
  const gzipBody = gzipSync(Buffer.from('{"models":[{"model":"m"}]}'))
  const gzipBomb = gzipSync(Buffer.alloc(MAX_METADATA_INFLATED_BYTES + 4096, 0x61))
  const server = createServer({ key: LOCALHOST_TEST_KEY, cert: LOCALHOST_TEST_CERT }, (request, response) => {
    if (request.url === '/gzip') {
      response.writeHead(200, { 'content-encoding': 'gzip' })
      response.end(gzipBody)
      return
    }
    if (request.url === '/bomb') {
      response.writeHead(200, { 'content-encoding': 'gzip' })
      response.end(gzipBomb)
      return
    }
    if (request.url === '/oversize') {
      response.writeHead(200, {})
      response.end('x'.repeat(MAX_METADATA_BYTES + 1024))
      return
    }
    if (request.url === '/hang') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('{"partial"')
      return
    }
    // 慢速持续吐字节：socket 空闲超时抓不到，只有墙钟死线能截断
    response.writeHead(200, { 'content-type': 'application/json' })
    const tick = setInterval(() => response.write(' '), 20)
    request.on('close', () => clearInterval(tick))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `https://localhost:${server.address().port}`
  const limits = { maxBytes: MAX_METADATA_BYTES, maxInflatedBytes: MAX_METADATA_INFLATED_BYTES, timeoutMs: 5000 }
  const attempt = async (path, extra = {}) => {
    try {
      const response = await defaultTransport(base + path, { headers: { accept: 'application/json' }, ...limits, ...extra })
      return { status: response.status, body: response.body }
    } catch (error) {
      return { code: error.code }
    }
  }
  try {
    // 正常 gzip 响应必须仍然可用（不能把压缩路径整个拒掉）
    const gzip = await attempt('/gzip')
    assert.equal(gzip.status, 200)
    assert.deepEqual(JSON.parse(gzip.body), { models: [{ model: 'm' }] })
    // 真 gzip 炸弹：engine-side maxOutputLength 命中 → too-large（不是 bad-gzip，也不能 OOM）
    assert.equal((await attempt('/bomb')).code, 'too-large')
    // 未压缩正文超传输上限：必须是有界性失败，不能伪装成 network
    assert.equal((await attempt('/oversize')).code, 'too-large')
    // 慢速持续吐字节：墙钟死线截断（socket 空闲超时对此无效）
    const slow = await attempt('/', { timeoutMs: 120 })
    assert.equal(slow.code, 'timeout')
    // 有字节但不结束：同样由墙钟死线兜住
    const hang = await attempt('/hang', { timeoutMs: 150 })
    assert.equal(hang.code, 'timeout')
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('cache: concurrent gets single-flight; cached hits skip transport', async () => {
  let calls = 0
  const cache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 15))
        return { status: 200, headers: { etag: 'e' }, body: '{"models":[{"model":"m"}]}' }
      },
    }),
  })
  const request = modelParamsRequest()
  const [first, second] = await Promise.all([
    cache.get({ ...request, parse: parseModelParamsPayload }),
    cache.get({ ...request, parse: parseModelParamsPayload }),
  ])
  assert.equal(calls, 1, 'concurrent gets share one request')
  assert.equal(first.status, 'ok')
  assert.equal(second.status, 'ok')
  const cached = await cache.get({ ...request, parse: parseModelParamsPayload })
  assert.equal(calls, 1, 'cached hit does not re-fetch')
  assert.equal(cached.status, 'cached')
  assert.equal(cached.fromCache, true)
})

test('cache: forced refresh uses If-None-Match and 304 renews without losing payload', async () => {
  let calls = 0
  const etags = []
  const cache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async (_url, { headers }) => {
        calls += 1
        etags.push(headers['if-none-match'] ?? '')
        if (calls === 2) return { status: 304, headers: { etag: 'e2' }, body: '' }
        return { status: 200, headers: { etag: 'e1' }, body: '{"models":[{"model":"m"}]}' }
      },
    }),
    now: () => 4242,
  })
  const request = modelParamsRequest()
  await cache.get({ ...request, parse: parseModelParamsPayload })
  const refreshed = await cache.get({ ...request, force: true, parse: parseModelParamsPayload })
  assert.equal(etags[1], 'e1', 'conditional request carries the stored etag')
  assert.equal(refreshed.status, 'ok')
  assert.equal(refreshed.conditional, true)
  assert.equal(refreshed.fetchedAt, 4242)
  assert.deepEqual(refreshed.payload, { models: [{ model: 'm' }] }, '304 keeps the cached payload')
})

test('cache: failures stay visible and stale payload is retained', async () => {
  let failing = false
  const cache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async () => {
        if (failing) throw Object.assign(new Error('boom'), { code: 'network' })
        return { status: 200, headers: { etag: 'e' }, body: '{"models":[1]}' }
      },
    }),
  })
  const request = modelParamsRequest()
  await cache.get({ ...request, parse: parseModelParamsPayload })
  failing = true
  const stale = await cache.get({ ...request, force: true, parse: parseModelParamsPayload })
  assert.equal(stale.status, 'stale')
  assert.equal(stale.staleError, 'network')
  assert.deepEqual(stale.payload, { models: [1] }, 'stale data is shown, not dropped')
  // 全新 key 失败 → error 而不是静默空
  const freshCache = createMetadataCache({ fetcher: createSourceFetcher({ transport: async () => { throw Object.assign(new Error('x'), { code: 'timeout' }) } }) })
  const failed = await freshCache.get({ ...request, parse: parseModelParamsPayload })
  assert.equal(failed.status, 'error')
  assert.equal(failed.staleError, 'timeout')
  assert.equal(failed.payload, undefined)
  // schema 漂移（解析零条/坏形状）也是可见失败
  const driftCache = createMetadataCache({ fetcher: createSourceFetcher({ transport: async () => ({ status: 200, headers: {}, body: '{"unexpected":true}' }) }) })
  const drifted = await driftCache.get({ ...request, parse: parseModelParamsPayload })
  assert.equal(drifted.status, 'error')
  assert.equal(drifted.staleError, 'bad-shape')
})

// ─────────────────────────────────────────────────────────────────────────────
// 13b. 模型 ID 别名归一：精确身份永远优先，别名只在必要时回退一次
// ─────────────────────────────────────────────────────────────────────────────

test('identity: alias candidates stay conservative and never split real colon IDs', () => {
  assert.deepEqual(modelIdAliasCandidates('cn:deepseek-v4.1-flash'), [{ id: 'deepseek-v4.1-flash', kind: 'scope-prefix' }])
  assert.deepEqual(modelIdAliasCandidates('cline-pass/deepseek-v4.1-flash'), [{ id: 'deepseek-v4.1-flash', kind: 'provider-slug' }])
  const variant = modelIdAliasCandidates('inclusionai/ling-3.1-flash:free')
  assert.equal(variant[0].id, 'inclusionai/ling-3.1-flash')
  assert.equal(variant[0].kind, 'variant-suffix')
  // 真正带冒号的 Bedrock ID 不能被拆成 `amazon.nova-2-lite-v1`
  assert.deepEqual(modelIdAliasCandidates('amazon.nova-2-lite-v1:0'), [])
  assert.deepEqual(modelIdAliasCandidates('anthropic.claude-sonnet-4-5-20250929-v1:0'), [])
  // 短词、纯 slug、无结构 ID 不产出候选
  assert.deepEqual(modelIdAliasCandidates('free'), [])
  assert.deepEqual(modelIdAliasCandidates('anthropic/openrouter/free'), [])
  assert.deepEqual(modelIdAliasCandidates('gpt-6-astra'), [])
  // 思考档后缀是受控词表：只剥档位词，兄弟型号（-pro/-fast/-flashx）绝不剥离
  assert.deepEqual(modelIdAliasCandidates('gemini-3.8-flash-high'), [{ id: 'gemini-3.8-flash', kind: 'thinking-suffix' }])
  assert.deepEqual(modelIdAliasCandidates('deepseek-v4.1-flash-fast'), [])
  assert.deepEqual(modelIdAliasCandidates('gpt-6-astra-pro'), [])
  assert.deepEqual(modelIdAliasCandidates('glm-5.3-flashx'), [])
  // 变体词黑名单：`gpt-4o:free` 只允许拆出基座，绝不允许反向拆出 `free`（会撞 openrouter/free）
  const freeVariant = modelIdAliasCandidates('gpt-4o:free')
  assert.deepEqual(freeVariant.filter((entry) => entry.id === 'free'), [])
  assert.equal(freeVariant[0].id, 'gpt-4o')
  assert.equal(freeVariant[0].kind, 'variant-suffix')
  assert.deepEqual(modelIdAliasCandidates('mystery:free'), [])
  // 任何剥离方向都不许把变体词当型号：`free-high` 剥档位后是 `free`（会撞 openrouter/free）
  assert.deepEqual(modelIdAliasCandidates('free-high'), [])
  assert.deepEqual(modelIdAliasCandidates('auto-high'), [])
  assert.deepEqual(modelIdAliasCandidates('free:high'), [])
  assert.deepEqual(modelIdAliasCandidates('batch-medium'), [])
  assert.deepEqual(modelIdAliasCandidates(''), [])
  // 组合形态有界、去重、绝不返回原始 ID
  const many = modelIdAliasCandidates('cn:vendor/author/slug-model:free')
  assert.ok(many.length > 0 && many.length <= 6)
  assert.equal(new Set(many.map((entry) => entry.id)).size, many.length)
  assert.ok(many.every((entry) => entry.id !== 'cn:vendor/author/slug-model:free'))
})

test('identity: exact local evidence wins and an alias needs a source recognition', () => {
  const piIndex = buildPiEvidence(PI_FIXTURE)
  const modelParamsIndex = indexModelParamsRecords(MODELPARAMS_FIXTURE)
  const exact = resolveSmartFillIdentity('shared', { piIndex, modelParamsIndex })
  assert.equal(exact.via, 'exact')
  assert.equal(exact.modelId, 'shared')
  assert.equal(exact.requestedModelId, 'shared')
  assert.deepEqual([...exact.recognizedBy].sort(), ['modelparams', 'pi-ai'])
  const alias = resolveSmartFillIdentity('cw:shared', { piIndex, modelParamsIndex })
  assert.equal(alias.via, 'alias')
  assert.equal(alias.modelId, 'shared')
  assert.equal(alias.kind, 'scope-prefix')
  assert.deepEqual([...alias.recognizedBy].sort(), ['modelparams', 'pi-ai'])
  // 无任何本地来源认出：暂取第一候选但 recognizedBy 为空，调用方必须用 OpenRouter 确认或退回精确
  const guess = resolveSmartFillIdentity('cw:never-heard-of-it', { piIndex, modelParamsIndex })
  assert.equal(guess.via, 'alias')
  assert.equal(guess.modelId, 'never-heard-of-it')
  assert.deepEqual(guess.recognizedBy, [])
  // OpenRouter 精确命中 ⇒ 精确身份，不启用别名
  const orExact = resolveSmartFillIdentity('cw:shared', { piIndex, modelParamsIndex, openRouterMatchesCount: 1 })
  assert.equal(orExact.via, 'exact')
  assert.deepEqual(orExact.recognizedBy, ['openrouter'])
  // 思考档后缀走同一套「先认出再回退」：`shared-high` → `shared`
  const thinking = resolveSmartFillIdentity('shared-high', { piIndex, modelParamsIndex })
  assert.equal(thinking.via, 'alias')
  assert.equal(thinking.modelId, 'shared')
  assert.equal(thinking.kind, 'thinking-suffix')
})

test('query: prefixed model ID makes exactly one bounded alias fallback and merges the source view', async () => {
  const urls = []
  const cache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async (url) => {
        urls.push(url)
        if (url.includes('modelparams')) return { status: 200, headers: { etag: 'm' }, body: JSON.stringify(MODELPARAMS_FIXTURE) }
        if (url.includes('q=cw%3Ashared')) return { status: 200, headers: { etag: 'o1' }, body: JSON.stringify({ data: [] }) }
        if (url.includes('q=shared')) return { status: 200, headers: { etag: 'o2' }, body: JSON.stringify(OPENROUTER_FIXTURE) }
        throw Object.assign(new Error('unexpected-url'), { code: 'network' })
      },
    }),
  })
  const result = await querySmartFill({
    mode: 'on',
    target: { channel: '', api: '', modelId: 'cw:shared', modelOnly: true, current: { maxTokens: 8000 } },
    piIndex: buildPiEvidence(PI_FIXTURE),
    cache,
  })
  assert.equal(result.identity.via, 'alias')
  assert.equal(result.identity.requestedModelId, 'cw:shared')
  assert.equal(result.identity.modelId, 'shared')
  assert.equal(result.identity.kind, 'scope-prefix')
  assert.ok(result.identity.recognizedBy.includes('pi-ai'))
  assert.ok(result.identity.recognizedBy.includes('modelparams'))
  assert.ok(result.identity.recognizedBy.includes('openrouter'))
  assert.equal(result.identity.openRouterFallback.attempted, true)
  assert.ok(result.identity.openRouterFallback.matched > 0)
  // 两跳：精确 ID 无命中 + 别名命中；不因候选再多而级联请求
  assert.equal(urls.filter((url) => url.includes('openrouter.ai/api/v1/models?')).length, 2)
  // 两次读取合并成一条可见来源状态，且留证两次的状态码
  const openRouterSources = result.sources.filter((source) => source.sourceId === 'openrouter')
  assert.equal(openRouterSources.length, 1)
  assert.equal(openRouterSources[0].status, 'ok')
  assert.equal(openRouterSources[0].identityFallback.exactStatus, 'ok')
  assert.equal(openRouterSources[0].identityFallback.fallbackStatus, 'ok')
  // 能力建议来自别名身份，modelOnly 下统一降级为「模型身份参考」，并带别名注记
  const nameGroup = groupOf(result.groups, 'name')
  assert.ok(nameGroup.options.length > 0)
  assert.ok(nameGroup.options.every((option) => ['model-identity', 'external-reference'].includes(option.evidence)))
  assert.ok(nameGroup.options.some((option) => option.evidence === 'model-identity' && /别名/.test(option.note ?? '')))
  // modelparams 参考按别名身份取到（证明查询键已切换）
  assert.ok(result.groups.some((group) => group.field === 'paramRangeMax'))
  assert.ok(result.notes.some((note) => note.includes('别名')))
})

test('query: alias fallback stays bounded even when several candidates exist', async () => {
  const urls = []
  const cache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async (url) => {
        urls.push(url)
        if (url.includes('/api/v1/model/')) return { status: 404, headers: {}, body: JSON.stringify({ error: { message: 'not found' } }) }
        return { status: 200, headers: { etag: 'empty' }, body: JSON.stringify({ data: [] }) }
      },
    }),
  })
  const modelParamsIndex = indexModelParamsRecords({
    models: [{ model: 'slug-model', provider: 'p', authType: 'api_key', apiSurface: 'x', params: [{ path: 'max_tokens', range: { max: 100 } }] }],
  })
  const candidates = modelIdAliasCandidates('cn:vendor/author/slug-model:free')
  assert.ok(candidates.length > 1, 'the regression fixture really has several candidates')
  const result = await querySmartFill({
    mode: 'on',
    target: { channel: '', api: '', modelId: 'cn:vendor/author/slug-model:free', modelOnly: true },
    piIndex: buildPiEvidence({}),
    modelParamsIndex,
    cache,
  })
  assert.equal(result.identity.via, 'alias')
  assert.ok(result.identity.recognizedBy.includes('modelparams'))
  // 精确 1 次 + 别名 1 次；即使有多个候选也绝不按候选级联。
  assert.equal(urls.filter((url) => url.includes('openrouter.ai')).length, 2)
})

test('query: alias identity never poses as exact channel evidence for non-modelOnly callers', async () => {
  const result = await querySmartFill({
    mode: 'on',
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'cw:shared' },
    piIndex: buildPiEvidence(PI_FIXTURE),
    modelParamsIndex: indexModelParamsRecords(MODELPARAMS_FIXTURE),
  })
  assert.equal(result.identity.via, 'alias')
  const nameGroup = groupOf(result.groups, 'name')
  assert.ok(nameGroup.options.length > 0)
  assert.ok(nameGroup.options.every((option) => option.evidence !== 'exact-channel-protocol'))
  assert.ok(nameGroup.options.some((option) => option.evidence === 'model-identity' && /别名/.test(option.note ?? '')))
  const reasoning = groupOf(result.groups, 'reasoningEfforts')
  assert.ok((reasoning?.options ?? []).every((option) => option.evidence !== 'exact-channel-protocol'), 'same-channel wire cannot keep exact evidence under an alias identity')
})

test('query: exact ID never triggers an alias request, and unrecognized aliases are discarded', async () => {
  const exactUrls = []
  const exactCache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async (url) => {
        exactUrls.push(url)
        if (url.includes('modelparams')) return { status: 200, headers: { etag: 'm' }, body: JSON.stringify(MODELPARAMS_FIXTURE) }
        return { status: 200, headers: { etag: 'o' }, body: JSON.stringify(OPENROUTER_FIXTURE) }
      },
    }),
  })
  const exact = await querySmartFill({
    mode: 'on',
    target: { channel: '', api: '', modelId: 'shared', modelOnly: true },
    piIndex: buildPiEvidence(PI_FIXTURE),
    cache: exactCache,
  })
  assert.equal(exact.identity.via, 'exact')
  assert.equal(exactUrls.filter((url) => url.includes('openrouter.ai')).length, 1, 'exact identity asks OpenRouter once')

  const guessUrls = []
  const guessCache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async (url) => {
        guessUrls.push(url)
        if (url.includes('modelparams')) return { status: 200, headers: { etag: 'm' }, body: JSON.stringify(MODELPARAMS_FIXTURE) }
        return { status: 200, headers: { etag: 'o' }, body: JSON.stringify({ data: [] }) }
      },
    }),
  })
  const guessed = await querySmartFill({
    mode: 'on',
    target: { channel: '', api: '', modelId: 'cw:never-heard-of-it', modelOnly: true },
    piIndex: buildPiEvidence(PI_FIXTURE),
    cache: guessCache,
  })
  // 唯一候选也没有任何来源命中 ⇒ 放弃别名，退回精确身份，不产出猜测建议
  assert.equal(guessed.identity.via, 'exact')
  assert.equal(guessed.identity.modelId, 'cw:never-heard-of-it')
  assert.equal(guessUrls.filter((url) => url.includes('openrouter.ai')).length, 2, 'at most one fallback request')
  assert.equal(groupOf(guessed.groups, 'name').options.length, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// 14. querySmartFill：OFF 零网络 / ON 来源与运行时
// ─────────────────────────────────────────────────────────────────────────────

test('query: OFF returns before touching cache or network', async () => {
  let touched = 0
  const cache = {
    get: async () => { touched += 1; throw new Error('must not be reached when OFF') },
    drop: () => { touched += 1 },
    peek: () => undefined,
    size: () => 0,
  }
  const result = await querySmartFill({
    mode: SMART_FILL_MODES.OFF,
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' },
    cache,
    piIndex: buildPiEvidence(PI_FIXTURE),
  })
  assert.equal(result.mode, 'off')
  assert.equal(result.network, false)
  assert.deepEqual(result.groups, [])
  assert.equal(result.runtime, null)
  assert.equal(touched, 0, 'OFF never reads cache or network')
})

test('query: ON uses provided offline sources and runtime without any fetch', async () => {
  const result = await querySmartFill({
    mode: 'on',
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared', current: { maxTokens: 8000 } },
    piIndex: buildPiEvidence(PI_FIXTURE),
    modelParamsCatalog: MODELPARAMS_FIXTURE,
    openRouterPayload: OPENROUTER_FIXTURE,
    runtimeInfo: RUNTIME_FIXTURE,
  })
  assert.equal(result.mode, 'on')
  assert.equal(result.network, false, 'all sources were provided offline')
  const statuses = Object.fromEntries(result.sources.map((source) => [source.sourceId, source.status]))
  assert.equal(statuses['pi-ai'], 'ok')
  assert.equal(statuses.modelparams, 'provided')
  assert.equal(statuses.openrouter, 'provided')
  assert.equal(statuses.runtime, 'ok')
  assert.ok(result.groups.length > 0)
  assert.equal(result.runtime.reasoningWireAvailable, false)
  assert.ok(result.groups.some((group) => group.field === 'paramRangeMax'))
})

test('query: ON fetches fixed sources through the cache and surfaces failures', async () => {
  const urls = []
  const cache = createMetadataCache({
    fetcher: createSourceFetcher({
      transport: async (url) => {
        urls.push(url)
        if (url.includes('modelparams')) return { status: 200, headers: { etag: 'm' }, body: JSON.stringify(MODELPARAMS_FIXTURE) }
        return { status: 200, headers: { etag: 'o' }, body: JSON.stringify(OPENROUTER_FIXTURE) }
      },
    }),
  })
  const result = await querySmartFill({
    mode: 'on',
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' },
    piIndex: buildPiEvidence(PI_FIXTURE),
    cache,
  })
  assert.equal(result.network, true)
  assert.ok(urls.includes('https://modelparams.dev/api/v1/models.json'))
  assert.ok(urls.some((url) => url.startsWith('https://openrouter.ai/api/v1/models?q=')))
  const statuses = Object.fromEntries(result.sources.map((source) => [source.sourceId, source.status]))
  assert.equal(statuses.modelparams, 'ok')
  assert.equal(statuses.openrouter, 'ok')
  assert.equal(statuses.runtime, 'unavailable')
  assert.ok(result.groups.some((group) => group.field === 'paramRangeMax'))

  const failing = createMetadataCache({ fetcher: createSourceFetcher({ transport: async () => { throw Object.assign(new Error('x'), { code: 'network' }) } }) })
  const degraded = await querySmartFill({
    mode: 'on',
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' },
    piIndex: buildPiEvidence(PI_FIXTURE),
    cache: failing,
  })
  const failedStatuses = degraded.sources.filter((source) => source.error !== null)
  assert.ok(failedStatuses.length >= 2, 'each fixed source failure is visible')
  assert.ok(failedStatuses.every((source) => source.status === 'error'))
  // 失败不阻断本地 pi 建议
  assert.ok(degraded.groups.some((group) => group.field === 'name' && group.options.length > 0))
})

// ─────────────────────────────────────────────────────────────────────────────
// 15. 采纳：显式候选、readOnly 拒绝
// ─────────────────────────────────────────────────────────────────────────────

test('adoption: only explicit adoptable candidates apply, readOnly and unknown are refused', () => {
  const index = buildPiEvidence(PI_FIXTURE)
  const { groups } = buildSmartFillGroups({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' },
    piIndex: index,
    modelParams: modelParamsReference(indexModelParamsRecords(MODELPARAMS_FIXTURE), 'shared'),
  })
  const adoptable = optionsOf(groups, 'maxTokens').find((option) => option.adoptable === true && option.evidence === 'exact-channel-protocol')
  const applied = applyAdoption({ id: 'shared' }, groups, [adoptable.candidateId])
  assert.equal(applied.ok, true)
  assert.equal(applied.draft.maxTokens, adoptable.value)
  assert.equal(applied.draft.id, 'shared', 'untouched draft fields survive')

  // 未知候选 → 整体拒绝，不产生半套状态
  const unknown = applyAdoption({ id: 'shared' }, groups, [adoptable.candidateId, 'deadbeef'])
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error, 'unknown-candidate')

  // readOnly 候选 → 拒绝
  const readOnly = optionsOf(groups, 'paramRangeMax')[0]
  assert.equal(adoptCandidate(groups, readOnly.candidateId).ok, false)
  assert.equal(adoptCandidate(groups, readOnly.candidateId).error, 'not-adoptable')
  assert.equal(applyAdoption({}, groups, [readOnly.candidateId]).ok, false)

  // compat 按 key 合并进草稿
  const compatOption = optionsOf(groups, 'compat').find((option) => option.adoptable === true)
  const compatApplied = applyAdoption({ id: 'shared', compat: { keep: true } }, groups, [compatOption.candidateId])
  assert.equal(compatApplied.ok, true)
  assert.equal(compatApplied.draft.compat.keep, true)
  assert.equal(compatApplied.draft.compat[compatOption.key], compatOption.value)

  // 选项 ID 稳定可复现
  const again = buildSmartFillGroups({ target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared' }, piIndex: index })
  const idsAgain = optionsOf(again.groups, 'maxTokens').map((option) => option.candidateId)
  assert.deepEqual(idsAgain, optionsOf(groups, 'maxTokens').map((option) => option.candidateId))
})

// ─────────────────────────────────────────────────────────────────────────────
// 15b. 来源绑定：身份指纹 + 地址变化待复核 + 绝不跨来源带 wire
// ─────────────────────────────────────────────────────────────────────────────

const BINDING_SOURCES = [
  { sourceId: 'pi-ai', channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://alpha.example/v1', baseUrlKind: 'exact' },
  { sourceId: 'pi-ai', channel: 'alpha', api: 'anthropic-messages', modelId: 'shared', baseUrl: 'https://alpha.example/v1', baseUrlKind: 'exact' },
  { sourceId: 'pi-ai', channel: 'beta', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://beta.example/v1', baseUrlKind: 'exact' },
  { sourceId: 'modelparams', channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: '', baseUrlKind: 'empty' },
  { sourceId: 'pi-ai', channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://alpha.example/{region}/v1', baseUrlKind: 'template' },
]

test('binding: candidates are listed per route+api+model+address, never unioned across sources', () => {
  const binding = resolveSourceBinding({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://alpha.example/v1' },
    candidateSources: BINDING_SOURCES,
  })
  assert.equal(binding.version, SOURCE_BINDING_VERSION)
  assert.equal(binding.state, 'new')
  assert.equal(binding.reason, 'matched')
  assert.equal(binding.candidates.length, BINDING_SOURCES.length, 'every candidate is listed, none merged')
  assert.equal(binding.linked.index, 0)
  assert.equal(binding.linked.sourceId, 'pi-ai')
  const states = binding.candidates.map((candidate) => candidate.state)
  assert.deepEqual(states, ['match', 'identity-mismatch', 'identity-mismatch', 'address-unresolved', 'address-unresolved'])
  // 同名不同 api / 不同渠道都不算绑定
  assert.equal(binding.links.length, 1)
  // 空地址与模板地址只作参考，不能当当前渠道事实
  assert.equal(binding.candidates[3].reason, 'empty-address')
  assert.equal(binding.candidates[4].reason, 'template-address')
  // 同一身份不同来源（modelparams）绝不因为「名称相同」被当成同一记录
  assert.notEqual(binding.candidates[3].sourceId, binding.candidates[0].sourceId)
})

test('binding: address change requires re-review; api/route change invalidates the binding', () => {
  const previous = resolveSourceBinding({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://alpha.example/v1' },
    candidateSources: BINDING_SOURCES,
  })
  // 只有地址变：同一条 binding 待复核，绝不悄悄沿用旧关联
  const addressChanged = resolveSourceBinding({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://alpha.example/v2' },
    candidateSources: BINDING_SOURCES,
    previous,
  })
  assert.equal(addressChanged.state, 'review')
  assert.equal(addressChanged.reason, 'address-changed')
  assert.equal(addressChanged.rereviewRequired, true)
  assert.equal(addressChanged.route.fingerprint, previous.route.fingerprint, 'base identity key survives an address change')
  assert.notEqual(addressChanged.route.identityFingerprint, previous.route.identityFingerprint)
  // 协议变（同渠道同 ID）：整条绑定失效
  const apiChanged = resolveSourceBinding({
    target: { channel: 'alpha', api: 'anthropic-messages', modelId: 'shared', baseUrl: 'https://alpha.example/v1' },
    candidateSources: BINDING_SOURCES,
    previous,
  })
  assert.equal(apiChanged.state, 'invalid')
  assert.equal(apiChanged.reason, 'fingerprint-changed')
  assert.equal(apiChanged.rereviewRequired, true)
  // 无关路由：新绑定
  const other = resolveSourceBinding({
    target: { channel: 'gamma', api: 'pi-messages', modelId: 'ghost' },
    candidateSources: BINDING_SOURCES,
    previous,
  })
  assert.equal(other.state, 'invalid')
  assert.equal(other.linked ?? null, null)
  assert.equal(other.reason, 'fingerprint-changed')
  // 稳定身份 + 候选列表不变 → stable
  const stable = resolveSourceBinding({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://alpha.example/v1' },
    candidateSources: BINDING_SOURCES,
    previous,
  })
  assert.equal(stable.state, 'stable')
  assert.equal(stable.rereviewRequired, false)
})

test('binding: association never carries wire/compat values across source association', () => {
  const binding = resolveSourceBinding({
    target: { channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://alpha.example/v1' },
    candidateSources: BINDING_SOURCES,
  })
  assert.equal(binding.adoptionScope, 'candidate-identity-only')
  assert.equal(binding.wireCarryover, false)
  // 绑定结构里不能出现任何能力/wire 值字段（只登记身份；字符串说明文字不算）
  const forbiddenKeys = ['reasoningEfforts', 'thinkingLevelMap', 'compat', 'supportedEfforts', 'defaultEffort', 'value']
  const seenKeys = new Set()
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      seenKeys.add(key)
      walk(value)
    }
  }
  walk(JSON.parse(JSON.stringify(binding)))
  for (const key of forbiddenKeys) {
    assert.equal(seenKeys.has(key), false, `binding must not carry a ${key} field`)
  }
  // 指纹与身份字段是纯函数：同输入同输出，身份变化即指纹变化
  const a = sourceCandidateFingerprint(BINDING_SOURCES[0])
  const b = sourceCandidateFingerprint({ ...BINDING_SOURCES[0] })
  assert.deepEqual(a, b)
  assert.notEqual(a.fingerprint, sourceCandidateFingerprint({ ...BINDING_SOURCES[0], api: 'anthropic-messages' }).fingerprint)
  assert.notEqual(a.identityFingerprint, routeIdentityFingerprint({ channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://other.example/v1' }).identityFingerprint)
  // 地址变化不改变主键指纹（用于识别「待复核」而不是「换了一条绑定」）
  assert.equal(
    routeIdentityFingerprint({ channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://a.example/v1' }).fingerprint,
    routeIdentityFingerprint({ channel: 'alpha', api: 'openai-completions', modelId: 'shared', baseUrl: 'https://b.example/v1' }).fingerprint,
  )
})

test('openrouter: search limit constant stays inside the allowlist bound', () => {
  assert.ok(MAX_OPENROUTER_SEARCH_LIMIT <= 50)
  assert.equal(assertSourceAllowed(openRouterRequest('shared').url).ok, true)
  assert.equal(assertSourceAllowed(`https://openrouter.ai/api/v1/models?q=shared&limit=${MAX_OPENROUTER_SEARCH_LIMIT}`).ok, true)
  assert.equal(assertSourceAllowed(`https://openrouter.ai/api/v1/models?q=shared&limit=${MAX_OPENROUTER_SEARCH_LIMIT + 1}`).ok, false)
})

// ─────────────────────────────────────────────────────────────────────────────
// 16. 永久全量扫描：fixtures 与装机目录
// ─────────────────────────────────────────────────────────────────────────────

test('scan: fixture scan audits collisions structurally without hardcoded counts', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'dsh-service-smart-fill-fixture-'))
  try {
    for (const [channel, text] of Object.entries(PI_FIXTURE)) await writeFile(join(dir, `${channel}.json`), text, 'utf8')
    const scan = await scanPiDir(dir)
    assert.equal(scan.status, 'ok')
    const summary = summarize(scan, auditSourceWhitelist())
    assert.equal(summary.ok, true)
    assert.ok(summary.records > 0)
    assert.equal(summary.collisions, 1)
    assert.deepEqual(summary.collisionKinds, { 'same-channel-cross-api': 1 })
    assert.ok(summary.reasoning.undeclared >= 1)
    // 碰撞里每条记录都共享 channel+modelId，且 apis 至少两个
    for (const collision of scan.audit.collisions) {
      const records = scan.index.byChannelModel.get(`${collision.channel}\u0000${collision.modelId}`)
      assert.equal(records.length, collision.count)
      assert.ok(records.every((record) => record.channel === collision.channel && record.modelId === collision.modelId))
      assert.ok(collision.apis.length >= 2)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('scan: full installed pi directory passes the permanent audit', async (t) => {
  const dir = resolveDataDir('')
  if (dir === '') {
    t.skip('pi-ai catalog not installed in this environment')
    return
  }
  const scan = await scanPiDir(dir)
  assert.equal(scan.status, 'ok')
  const summary = summarize(scan, auditSourceWhitelist())
  assert.equal(summary.ok, true, JSON.stringify(summary.problems))
  assert.ok(summary.records > 0)
  assert.equal(summary.problems.length, 0)
  // 身份守恒：byChannelModel / byExactKey 汇总等于记录数（无硬编码规模）
  const pairTotal = [...scan.index.byChannelModel.values()].reduce((sum, rows) => sum + rows.length, 0)
  assert.equal(pairTotal, scan.index.records.length)
  // 每个 collision 都真实存在且未被合并进单条记录
  for (const collision of scan.audit.collisions) {
    const records = scan.index.byChannelModel.get(`${collision.channel}\u0000${collision.modelId}`)
    assert.equal(records.length, collision.count)
    assert.equal(new Set(records.map((record) => record.api)).size, collision.apis.length)
  }
})

test('scan: CLI exits 0 over the installed catalog and prints a machine summary', async (t) => {
  const dir = resolveDataDir('')
  if (dir === '') {
    t.skip('pi-ai catalog not installed in this environment')
    return
  }
  const { stdout } = await execFileAsync(process.execPath, [SCAN_SCRIPT, '--data', dir, '--json'], { maxBuffer: 4 * 1024 * 1024 })
  const summary = JSON.parse(stdout)
  assert.equal(summary.status, 'ok')
  assert.equal(summary.ok, true)
  assert.ok(summary.records > 0)
  assert.equal(summary.whitelist, 'ok')
  const text = await execFileAsync(process.execPath, [SCAN_SCRIPT, '--data', dir], { maxBuffer: 4 * 1024 * 1024 })
  assert.match(text.stdout, /RESULT: PASS/)
})

test('scan: args and availability handling are explicit', async () => {
  assert.deepEqual(parseArgs(['--data', '/tmp/x', '--json', '--require']), { data: '/tmp/x', json: true, require: true })
  const missing = await scanPiDir('/definitely/not/a/pi/dir')
  assert.equal(missing.status, 'unavailable')
  const summary = summarize(missing, auditSourceWhitelist())
  assert.equal(summary.status, 'unavailable')
  assert.equal(resolveDataDir('/definitely/not/a/pi/dir'), '')
})
