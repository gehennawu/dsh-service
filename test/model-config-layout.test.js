import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/client/model-config.js', import.meta.url), 'utf8')
test('model configuration homepage uses a vertical provider accordion with no default open row', () => {
  assert.match(source, /className: 'dsh-model-workspace'/)
  assert.match(source, /className: 'dsh-model-content'/)
  assert.match(source, /display:flex; flex-direction:column/)
  assert.match(source, /@media\(max-width:640px\)/)
  assert.match(source, /routes.find\(\(row\) => row.route === selected.route\)/)
  assert.match(source, /const active = selected \? .* : null/)
  assert.doesNotMatch(source, /if \(selected\) return el\(RouteDetail/)
})
test('provider selection guards drafts and reuses theme-aware channel icons', () => {
  assert.match(source, /if \(canLeave\(\)\) setSelected\(row.route === active\?\.route \? null : row\)/)
  assert.match(source, /modelIconNode\(row.route, size/)
  assert.match(source, /features.modelProviderIcons !== false/)
  assert.match(source, /'aria-expanded': active\?\.route === row.route/)
  assert.match(source, /model-provider-fallback-/)
  assert.match(source, /id: 'model-routes-refresh'/)
  assert.equal((source.match(/id: 'model-add'/g) ?? []).length, 1)
})
test('homepage copy is localized in both languages', () => {
  const locale = readFileSync(new URL('../src/client/model-config-i18n.js', import.meta.url), 'utf8')
  for (const key of ['homeTitle', 'homeDescription', 'providers', 'customProviders', 'refreshProviders', 'modelList', 'noModels']) {
    assert.equal((locale.match(new RegExp(`'models.smart.${key}':`, 'g')) ?? []).length, 2)
  }
})
