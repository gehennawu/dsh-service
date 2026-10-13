import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPiEvidence, buildSmartFillGroups, querySmartFill } from '../model-smart-fill.js'

const fixture = {
  vendor: JSON.stringify({ 'openai-completions': {
    'chat:reasoning-model': { id: 'reasoning-model', provider: 'vendor', api: 'openai-completions', reasoning: true, thinkingLevelMap: { off: null, low: 'low', high: 'high' }, input: ['text'], contextWindow: 100000 },
    'chat:support-only': { id: 'support-only', provider: 'vendor', api: 'openai-completions', reasoning: true, input: ['text'] },
    'chat:unknown': { id: 'unknown', provider: 'vendor', api: 'openai-completions', input: ['text'] },
  } }),
}

test('model-only suggestions do not depend on target provider or protocol', () => {
  const piIndex = buildPiEvidence(fixture)
  const collect = (channel, api) => buildSmartFillGroups({ target: { modelId: 'reasoning-model', channel, api, modelOnly: true }, piIndex }).groups.filter((group) => ['contextWindow', 'reasoningEfforts'].includes(group.field)).map((group) => group.options.map((option) => ({ value: option.value, evidence: option.evidence, adoptable: option.adoptable })))
  assert.deepEqual(collect('vendor', 'openai-completions'), collect('custom-relay', 'anthropic-messages'))
  assert.ok(collect('', '').flat().some((option) => option.value?.high === 'high' && option.adoptable))
})

test('model-only reasoning prefers a declared mapping over another source declaring false', () => {
  const piIndex = buildPiEvidence({ ...fixture, aaa: JSON.stringify({ 'anthropic-messages': { 'chat:reasoning-model': { id: 'reasoning-model', provider: 'aaa', api: 'anthropic-messages', reasoning: false } } }) })
  const group = buildSmartFillGroups({ target: { modelId: 'reasoning-model', modelOnly: true }, piIndex }).groups.find((row) => row.field === 'reasoningEfforts')
  assert.equal(group.options[0].value.high, 'high')
  assert.equal(group.supported, true)
})

test('query preserves supported-without-levels separately from unknown support', async () => {
  const piIndex = buildPiEvidence(fixture)
  for (const [modelId, supported] of [['support-only', true], ['unknown', false]]) {
    const result = await querySmartFill({ mode: 'on', target: { modelId, modelOnly: true }, piIndex })
    const group = result.groups.find((row) => row.field === 'reasoningEfforts')
    assert.equal(group.supported, supported)
    assert.equal(group.options.length, 0)
    assert.equal(group.unsupported, false)
  }
})
