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
test('model names show IDs on hover and capability controls use stable horizontal widths', () => {
  assert.match(source, /className: 'dsh-model-row-name', title: item.id/)
  assert.match(source, /item.name\?\.trim\(\) \|\| item.id/)
  assert.match(source, /REASONING_LEVELS = \['minimal', 'low', 'medium', 'high', 'xhigh', 'max'\]/)
  assert.match(source, /gridTemplateColumns: 'minmax\(0, 2fr\) minmax\(0, 1fr\)'/)
  assert.match(source, /flex: '1 1 0'/)
  assert.match(source, /border: '1px solid ' \+ \(checked/)
  assert.match(source, /margin: '36px 0 12px'/)
})
test('custom provider creation filters long candidate lists instead of making users scroll', () => {
  // 模板/在线发现一次可带回上百个候选（amazon-bedrock 模板实测 193 个）：候选区必须带搜索，
  // 且“选择所有”只看过滤后的可见项；空结果要落到可见提示上，不能留空白滚动区。
  assert.match(source, /'data-testid': 'model-create-search'/)
  assert.match(source, /const visibleModels = modelSearchTerm/)
  assert.match(source, /visibleModels\.length \? visibleModels\.map/)
  assert.match(source, /'data-testid': 'model-create-no-match'/)
  assert.match(source, /setPicked\(\[\.\.\.new Set\(\[\.\.\.picked, \.\.\.visibleModels\.map\(\(m\) => m\.id\)\]\)\]\)/)
  assert.match(source, /availableModels\.length > 5 \? el\('input', \{ type: 'search'/)
})
test('advanced editing stays out of the ordinary interface', () => {
  // 渠道与模型都不再提供高级参数入口；compat 编辑器整块移除。
  assert.doesNotMatch(source, /'data-testid': 'model-route-advanced'/)
  assert.doesNotMatch(source, /advancedRouteFields/)
  assert.doesNotMatch(source, /'data-testid': 'model-advanced-parameters'/)
  assert.doesNotMatch(source, /'data-testid': 'model-compat-editor'/)
  assert.doesNotMatch(source, /CompatEditor/)
  assert.doesNotMatch(source, /model-inherit-/)
  // 思考 wire 收在折叠区里，默认只显示档位按钮。
  assert.match(source, /'data-testid': 'model-reasoning-wire-editor'/)
  assert.match(source, /'data-testid': 'model-reasoning-wires'/)
  assert.match(source, /'data-testid': 'model-reasoning-mode'/)
  // 输入框只呈现草稿，不再渲染显式/继承/生效值说明。
  assert.match(source, /value: draft\.contextWindow,/)
  assert.match(source, /value: draft\.maxTokens,/)
  assert.doesNotMatch(source, /models\.smart\.explicitValue/)
  assert.doesNotMatch(source, /models\.smart\.effective/)
  assert.doesNotMatch(source, /models\.smart\.restoreInherited/)
  // 批选语义统一：全选并集可见项，筛选外选择显式摘要并可移除。
  assert.match(source, /'data-testid': 'model-discovery-selected'/)
  assert.match(source, /'data-testid': 'model-discovery-no-match'/)
  assert.match(source, /'data-testid': 'model-create-selected'/)
  // 停用只在有引用时确认；测试一律先确认。
  assert.match(source, /plan\.kind === 'availability'/)
  assert.match(source, /'data-testid': 'model-availability-references'/)
  assert.match(source, /'data-testid': 'model-test-details'/)
})
test('new editing controls are localized in both languages', () => {
  const locale = readFileSync(new URL('../src/client/model-config-i18n.js', import.meta.url), 'utf8')
  for (const key of ['field.modelId', 'modality.textInput', 'modality.imageInput', 'modality.textOutput', 'wireValue', 'testMayCharge', 'testNeedsSaved', 'disableProvider', 'disableReferences', 'selectedCount', 'hiddenPicks', 'removeHiddenPicks', 'wireEditor', 'maxTokensHelpLabel']) {
    assert.equal((locale.match(new RegExp(`'models\\.smart\\.${key.replaceAll('.', '\\.')}':`, 'g')) ?? []).length, 2, `${key} must exist in zh and en`)
  }
})
test('homepage copy is localized in both languages', () => {
  const locale = readFileSync(new URL('../src/client/model-config-i18n.js', import.meta.url), 'utf8')
  for (const key of ['homeTitle', 'homeDescription', 'providers', 'customProviders', 'refreshProviders', 'modelList', 'noModels', 'noSearchMatch', 'aliasIdentity']) {
    assert.equal((locale.match(new RegExp(`'models.smart.${key}':`, 'g')) ?? []).length, 2)
  }
})
