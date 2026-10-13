import test from 'node:test'
import assert from 'node:assert/strict'
import { createProviderAvailability, installProviderAvailability } from '../provider-availability.js'
function fixture(initial = {}) {
  let state = structuredClone(initial)
  const policy = createProviderAvailability({ load: async () => state, mutate: async (fn) => { const next = structuredClone(state); fn(next); state = next } })
  let calls = 0
  const llm = {
    listProviders: () => [{ id: 'relay' }, { id: 'other' }],
    listModels: async (provider) => [{ provider, id: 'one' }],
    resolveModelInfo: async (provider) => ({ provider }),
    resolveCallConfig: async (config) => config,
    prepareCall: async () => ({ stream: async function* () { calls++; yield 'ok' } }),
    stream: async function* () { calls++; yield 'ok' },
  }
  return { policy, llm, state: () => state, calls: () => calls }
}
test('availability filters shared model directory, guards calls and restores on disposal', async () => {
  const f = fixture({ disabledProviders: { relay: true } })
  const original = f.llm.listProviders
  const dispose = installProviderAvailability(f.llm, f.policy)
  await f.policy.loading
  assert.deepEqual(f.llm.listProviders(), [{ id: 'other' }])
  assert.deepEqual(await f.llm.listModels('relay'), [])
  await assert.rejects(f.llm.resolveModelInfo('relay', 'one'), { code: 'PROVIDER_DISABLED' })
  await assert.rejects(f.llm.prepareCall({ provider: 'relay', model: 'one' }), { code: 'PROVIDER_DISABLED' })
  await assert.rejects(async () => { for await (const _ of f.llm.stream({ provider: 'relay' })) {} }, { code: 'PROVIDER_DISABLED' })
  assert.equal(f.calls(), 0)
  await f.policy.set('relay', true, false)
  assert.equal(f.llm.listProviders().length, 2)
  assert.equal((await f.llm.listModels('relay')).length, 1)
  dispose(); assert.equal(f.llm.listProviders, original)
})
test('a prepared call cannot dispatch after its channel is disabled', async () => {
  const f = fixture(); installProviderAvailability(f.llm, f.policy); await f.policy.loading
  const prepared = await f.llm.prepareCall({ provider: 'relay', model: 'one' })
  await f.policy.set('relay', false, true)
  await assert.rejects(async () => { for await (const _ of prepared.stream({ provider: 'relay' })) {} }, { code: 'PROVIDER_DISABLED' })
  assert.equal(f.calls(), 0)
  await assert.rejects(f.policy.set('relay', false, true), /conflict/)
})
test('installed LlmRuntime catalog and exact dispatch honor availability', async () => {
  const { LlmRuntime } = await import('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js')
  const llm = Object.create(LlmRuntime.prototype)
  llm.adapters = new Map([['relay', { provider: { id: 'relay', name: 'Relay' }, adapter: { listModels: async () => [{ provider: 'relay', id: 'one', name: 'One' }] } }]])
  const f = fixture({ disabledProviders: { relay: true } })
  const dispose = installProviderAvailability(llm, f.policy)
  await f.policy.loading
  assert.deepEqual(llm.listProviders(), [])
  assert.deepEqual(await llm.listModels('relay'), [])
  await assert.rejects(llm.prepareCall({ provider: 'relay', model: 'one' }), { code: 'PROVIDER_DISABLED' })
  await f.policy.set('relay', true, false)
  assert.deepEqual(llm.listProviders(), [{ id: 'relay', name: 'Relay' }])
  assert.equal((await llm.listModels('relay')).length, 1)
  dispose()
})

test('policy persistence failure never flips in-memory availability', async () => {
  const policy = createProviderAvailability({ load: async () => ({}), mutate: async () => { throw new Error('disk-failed') } })
  await policy.loading
  await assert.rejects(policy.set('relay', false, true), /disk-failed/)
  assert.equal(policy.enabled('relay'), true)
})
