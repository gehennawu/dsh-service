import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MODEL_FIELDS, ROUTE_FIELDS, COMPAT_GATES } from '../model-config-schema.js'

const sourcePath = '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js'
const keys = (block) => [...block.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*):/gm)].map((x) => x[1])
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
