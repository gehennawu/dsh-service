import test from 'node:test'
import assert from 'node:assert/strict'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { fetchModelsProbe, modelsProbeLookup, MAX_MODELS_PROBE_BYTES } from '../model-workbench.js'
import { createModelConfigRoutes } from '../model-config-routes.js'

function network(t, reply = {}) {
  const requests = []
  t.mock.method(modelsProbeLookup, 'impl', async () => [{ address: '8.8.8.8', family: 4 }])
  t.mock.method(https, 'request', (options, callback) => {
    requests.push(options)
    const request = new EventEmitter()
    request.destroy = (error) => { if (error) request.emit('error', error) }
    request.end = () => queueMicrotask(() => {
      const response = new EventEmitter()
      response.statusCode = reply.status ?? 200
      response.headers = reply.headers ?? {}
      response.resume = () => {}
      callback(response)
      response.emit('data', Buffer.from(reply.body ?? JSON.stringify({ data: [{ id: 'claude-example', display_name: 'Claude Example' }], has_more: false })))
      response.emit('end')
    })
    return request
  })
  return requests
}
test('Gemini discovery uses native auth, preserves version prefix and never follows pagination', async (t) => {
  const requests = network(t, { body: JSON.stringify({ models: [{ name: 'models/gemini-example', displayName: 'Example', inputTokenLimit: 1000000, outputTokenLimit: 64000 }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }, { name: 'gemini-example' }], nextPageToken: 'untrusted-next' }) })
  const rows = await fetchModelsProbe('https://gateway.example/prefix/v1beta/?tenant=a&pageSize=2&pageToken=old', 'isolated-key', 'google-generative-ai')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, '/prefix/v1beta/models?tenant=a&pageSize=1000')
  assert.equal(requests[0].headers['x-goog-api-key'], 'isolated-key')
  assert.equal(requests[0].headers.authorization, undefined)
  assert.equal(requests[0].headers['x-api-key'], undefined)
  assert.deepEqual(rows, [{ id: 'gemini-example', name: 'Example', contextWindow: 1000000, maxTokens: 64000 }])
})
test('Gemini discovery rejects invalid shape and encoded responses', async (t) => {
  network(t, { body: JSON.stringify({ data: [] }) })
  await assert.rejects(fetchModelsProbe('https://gateway.example/v1beta', undefined, 'google-generative-ai'), /probe-bad-listing/)
  await assert.rejects(fetchModelsProbe('https://gateway.example/v1beta', 'bad\nkey', 'google-generative-ai'), /bad-key/)
})
test('Google discovery rejects compressed replies and mixed public/private DNS', async (t) => {
  await t.test('encoding', async (t) => {
    network(t, { headers: { 'content-encoding': 'gzip' } })
    await assert.rejects(fetchModelsProbe('https://gateway.example/v1beta', undefined, 'google-generative-ai'), /probe-encoding-unsupported/)
  })
  await t.test('mixed DNS', async (t) => {
    const requests = network(t)
    modelsProbeLookup.impl = async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }]
    await assert.rejects(fetchModelsProbe('https://gateway.example/v1beta', undefined, 'google-generative-ai'), /probe-not-public/)
    assert.equal(requests.length, 0)
  })
})
test('discovery destroys endless error replies instead of draining after rejecting', async (t) => {
  for (const status of [302, 401, 500]) await t.test(String(status), async (t) => {
    t.mock.method(modelsProbeLookup, 'impl', async () => [{ address: '8.8.8.8', family: 4 }])
    let destroyed = false
    t.mock.method(https, 'request', (_, callback) => {
      const request = new EventEmitter()
      request.destroy = () => { destroyed = true }
      request.end = () => queueMicrotask(() => {
        const response = new EventEmitter(); response.statusCode = status
        response.resume = () => {}
        callback(response) // deliberately never emits end
      })
      return request
    })
    await assert.rejects(fetchModelsProbe('https://gateway.example/v1beta', undefined, 'google-generative-ai'), new RegExp(status === 302 ? 'probe-redirect:302' : 'probe-status:' + status))
    assert.equal(destroyed, true)
  })
})
test('discovery wall deadline includes unresolved DNS and prevents a late connection', async (t) => {
  const requests = network(t)
  let release
  modelsProbeLookup.impl = () => new Promise((resolve) => { release = resolve })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = fetchModelsProbe('https://gateway.example/v1beta', undefined, 'google-generative-ai')
  const rejected = assert.rejects(pending, /probe-timeout/)
  t.mock.timers.tick(10001)
  await rejected
  release([{ address: '8.8.8.8', family: 4 }])
  await Promise.resolve(); await Promise.resolve()
  assert.equal(requests.length, 0)
})
test('Anthropic discovery normalizes v1 path and uses its own auth and version headers', async (t) => {
  const requests = network(t)
  const rows = await fetchModelsProbe('https://gateway.example/anthropic/v1/', 'isolated-key', 'anthropic-messages')
  assert.equal(requests[0].path, '/anthropic/v1/models?limit=1000')
  assert.equal(requests[0].headers['x-api-key'], 'isolated-key')
  assert.equal(requests[0].headers['anthropic-version'], '2023-06-01')
  assert.equal(requests[0].headers.authorization, undefined)
  assert.equal(requests[0].host, '8.8.8.8')
  assert.equal(requests[0].servername, 'gateway.example')
  assert.deepEqual(rows, [{ id: 'claude-example', name: 'Claude Example' }])
})
test('Anthropic model discovery RPC reaches guarded request and leaves drafts unmodified', async (t) => {
  const requests = network(t)
  const endpoints = createModelConfigRoutes({ ctx: { get: () => undefined } })
  const result = await endpoints['models3-discover'].handle({ baseURL: 'https://gateway.example/anthropic', api: 'anthropic-messages', key: 'isolated-key' })
  assert.equal(result.ok, true)
  assert.equal(result.value.saved, false)
  assert.deepEqual(result.value.candidates, [{ id: 'claude-example', name: 'Claude Example' }])
  assert.equal(requests[0].path, '/anthropic/v1/models?limit=1000')
})
test('discovery RPC distinguishes missing credentials from rejected credentials', async (t) => {
  for (const [status, key, expected] of [[401, undefined, 'credential-missing'], [401, 'isolated-key', 'discovery-auth-failed'], [403, undefined, 'discovery-forbidden'], [429, 'isolated-key', 'discovery-rate-limited']]) {
    await t.test(`${status} credential=${!!key}`, async (t) => {
      network(t, { status })
      const endpoints = createModelConfigRoutes({ ctx: { get: () => undefined } })
      const result = await endpoints['models3-discover'].handle({ baseURL: 'https://gateway.example', api: 'anthropic-messages', ...(key ? { key } : {}) })
      assert.equal(result.error, expected)
    })
  }
})

test('OpenAI model discovery keeps Bearer authentication and existing path semantics', async (t) => {
  const requests = network(t)
  await fetchModelsProbe('https://gateway.example/api/v1/', 'isolated-key', 'openai-responses')
  assert.equal(requests[0].path, '/api/v1/models')
  assert.equal(requests[0].headers.authorization, 'Bearer isolated-key')
  assert.equal(requests[0].headers['x-api-key'], undefined)
})
test('openai-responses discovery RPC parses model IDs and names without saving or invoking responses', async (t) => {
  const requests = network(t, { body: JSON.stringify({ data: [{ id: 'gpt-example', name: 'GPT Example' }, { id: 'gpt-other' }] }) })
  const endpoints = createModelConfigRoutes({ ctx: { get: () => undefined } })
  const result = await endpoints['models3-discover'].handle({ baseURL: 'https://gateway.example/prefix/v1/?tenant=example', api: 'openai-responses', key: 'isolated-key' })
  assert.equal(result.ok, true, result.error)
  assert.equal(result.value.saved, false)
  assert.deepEqual(result.value.candidates, [{ id: 'gpt-example', name: 'GPT Example' }, { id: 'gpt-other', name: undefined }])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'GET')
  assert.equal(requests[0].path, '/prefix/v1/models?tenant=example')
  assert.equal(requests[0].headers.authorization, 'Bearer isolated-key')
  assert.equal(requests[0].headers['anthropic-version'], undefined)
  assert.equal(JSON.stringify(result).includes('isolated-key'), false)
})
test('openai-responses discovery shares public DNS and redirect guards', async (t) => {
  await t.test('private DNS', async (t) => {
    const requests = network(t)
    modelsProbeLookup.impl = async () => [{ address: '127.0.0.1', family: 4 }]
    await assert.rejects(fetchModelsProbe('https://gateway.example/v1', undefined, 'openai-responses'), /probe-not-public/)
    assert.equal(requests.length, 0)
  })
  await t.test('redirect', async (t) => {
    network(t, { status: 302 })
    await assert.rejects(fetchModelsProbe('https://gateway.example/v1', undefined, 'openai-responses'), /probe-redirect:302/)
  })
})
test('Anthropic discovery without a credential sends no authentication and preserves gateway query data', async (t) => {
  const requests = network(t)
  await fetchModelsProbe('https://gateway.example/prefix?tenant=example', undefined, 'anthropic-messages')
  assert.equal(requests[0].path, '/prefix/v1/models?tenant=example&limit=1000')
  assert.equal(requests[0].headers['x-api-key'], undefined)
  assert.equal(requests[0].headers.authorization, undefined)
})
test('Anthropic discovery rejects socket timeouts', async (t) => {
  t.mock.method(modelsProbeLookup, 'impl', async () => [{ address: '8.8.8.8', family: 4 }])
  t.mock.method(https, 'request', () => {
    const request = new EventEmitter()
    request.destroy = (error) => request.emit('error', error)
    request.end = () => queueMicrotask(() => request.emit('timeout'))
    return request
  })
  await assert.rejects(fetchModelsProbe('https://gateway.example', undefined, 'anthropic-messages'), /probe-timeout/)
})
test('Anthropic discovery blocks private DNS, redirects, oversized responses and invalid JSON', async (t) => {
  await t.test('private DNS blocks before connection', async (t) => {
    const requests = network(t)
    modelsProbeLookup.impl = async () => [{ address: '127.0.0.1', family: 4 }]
    await assert.rejects(fetchModelsProbe('https://gateway.example', undefined, 'anthropic-messages'), /probe-not-public/)
    assert.equal(requests.length, 0)
  })
  for (const [name, reply, error] of [
    ['redirect', { status: 302 }, /probe-redirect:302/],
    ['oversized', { body: 'x'.repeat(MAX_MODELS_PROBE_BYTES + 1) }, /probe-too-large/],
    ['invalid JSON', { body: 'invalid' }, /probe-bad-json/],
  ]) await t.test(name, async (t) => {
    network(t, reply)
    await assert.rejects(fetchModelsProbe('https://gateway.example', undefined, 'anthropic-messages'), error)
  })
})
