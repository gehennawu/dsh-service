import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MODEL_FIELDS, ROUTE_FIELDS, COMPAT_GATES, validateImageCountPair } from '../model-config-schema.js'
import vm from 'node:vm'

test('image-count rejection has actionable Chinese and English messages', async () => {
  const source = await readFile(new URL('../src/client/model-config-i18n.js', import.meta.url), 'utf8')
  const dictionaries = new Function('zh', 'en', source + '\nreturn {zh, en}')({}, {})
  for (const locale of ['zh', 'en']) {
    const message = dictionaries[locale]['models.smart.error.image-offload-exceeds-limit']
    assert.equal(typeof message, 'string')
    assert.ok(message.includes('50'))
  }
})

const sourcePath = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'
const keys = (block) => [...block.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*):/gm)].map((x) => x[1])
test('image-count guard agrees with installed pi-ai default resolution', async (t) => {
  let source; try { source = await readFile(sourcePath, 'utf8') } catch (_) { t.skip('Installed pi-ai unavailable'); return }
  const block = /const maxRequestImages = source\.maxRequestImages[\s\S]*?const requestImagePixelBudget/.exec(source)?.[0]
  assert.ok(block, 'installed image-count resolution must remain recognizable')
  const resolve = vm.runInNewContext('(source, provider) => { ' + block.replace(/const requestImagePixelBudget$/, '') + ' return {maxRequestImages, imageOffloadCountQuantum}; }')
  for (const config of [{}, { maxRequestImages: 2 }, { imageOffloadCountQuantum: 50 }, { imageOffloadCountQuantum: 51 }, { maxRequestImages: 100, imageOffloadCountQuantum: 80 }, { maxRequestImages: 30, imageOffloadCountQuantum: 80 }]) {
    let hostAccepts = true
    try { resolve(config, 'test-route') } catch (_) { hostAccepts = false }
    let pluginAccepts = true
    try { validateImageCountPair(config) } catch (_) { pluginAccepts = false }
    assert.equal(pluginAccepts, hostAccepts, JSON.stringify(config))
  }
})
test('model configuration vocabulary exhaustively tracks installed persistable schema scopes', async (t) => {
  let source; try { source = await readFile(sourcePath, 'utf8') } catch (_) { t.skip('Installed pi-ai unavailable'); return }
  const model = /const modelFields = \{([\s\S]*?)\n\};/.exec(source)?.[1]
  const profile = /const profile = z\.object\(\{([\s\S]*?)\n\}\);/.exec(source)?.[1]
  assert.ok(model); assert.ok(profile)
  assert.deepEqual([...MODEL_FIELDS].sort(), keys(model).sort())
  const fields = [...keys(profile), ...[...profile.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*),$/gm)].map((x) => x[1])].filter((x) => !['models', 'modelOverrides'].includes(x))
  assert.deepEqual([...ROUTE_FIELDS].sort(), fields.sort())
})
test('model configuration protocol gates never offer withheld installed compat keys', async (t) => {
  let source; try { source = await readFile(sourcePath, 'utf8') } catch (_) { t.skip('Installed pi-ai unavailable'); return }
  for (const [api, symbol] of [['openai-completions', 'COMPLETIONS_COMPAT_GATE'], ['openai-responses', 'RESPONSES_COMPAT_GATE']]) {
    const block = new RegExp('const ' + symbol + ' = \\{([\\s\\S]*?)\\n\\};').exec(source)?.[1]
    assert.ok(block)
    const offered = [...block.matchAll(/([A-Za-z][A-Za-z0-9]*): "offer"/g)].map((x) => x[1])
    assert.deepEqual([...COMPAT_GATES[api]].sort(), offered.sort())
  }
  const anthropic = /"anthropic-messages": \{([\s\S]*?)\n\s*\}/.exec(source)?.[1]
  assert.ok(anthropic)
  assert.deepEqual([...COMPAT_GATES['anthropic-messages']].sort(), [...anthropic.matchAll(/([A-Za-z][A-Za-z0-9]*): "offer"/g)].map((x) => x[1]).sort())
})
