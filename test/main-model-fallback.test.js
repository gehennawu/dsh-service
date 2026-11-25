import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { readClientSource } from '../scripts/client-source.mjs'

// 「主模型限额回退」客户端分片的静态护栏（规格：docs/planning/main-model-fallback.md）。
// 交互面由 test/client.test.js 的渲染 harness 覆盖；这里只钉住构建清单、官方槽契约
// 与 zh/en 词典完整性，避免后续重构把入口悄悄搬走或留下裸词条键。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

test('the main-model-fallback fragment is in the client manifest before apply.js', async () => {
  const { files } = await readClientSource()
  const fragment = files.indexOf('src/client/main-model-fallback.js')
  const apply = files.indexOf('src/client/apply.js')
  assert.notEqual(fragment, -1, 'src/client/main-model-fallback.js must be part of the client source')
  assert.ok(fragment < apply, 'the factory must be declared before apply() immediate call site')
  const manifest = await read('scripts/client-source.mjs')
  assert.match(manifest, /'src\/client\/main-model-fallback\.js',/)
})

test('the fallback registers the official model options and keyed pane slots', async () => {
  const source = await read('src/client/main-model-fallback.js')
  assert.match(source, /ctx\.slots\.inject\('conversation\.input\.model\.options'/)
  assert.match(source, /name: 'conversation\.input\.model\.options'/)
  // 官方 agent-team 条目没有 order（默认 0）；order:50 才能稳定落在它下方。
  assert.match(source, /order: 50,/)
  assert.match(source, /ctx\.slots\.inject\('conversation\.input\.model\.pane'/)
  assert.match(source, /name: 'conversation\.input\.model\.pane'/)
  assert.match(source, /key: PANE_KEY,/)
  assert.match(source, /data-model-menu-pane/)
})

test('the fallback keeps a visible standalone switch, reads official reasoning metadata, and leaves keys to the menu', async () => {
  const source = await read('src/client/main-model-fallback.js')
  // 活体 Theme.listTokens 没有 --dsw-alias-switch-thumb；关闭态轨道/拇指必须用真实令牌，
  // 否则浅色主题下开关整体不可见（2026-11-25 真机反馈）。
  assert.match(source, /--dsw-alias-border-l3/)
  assert.match(source, /--dsw-alias-bg-layer-1/)
  assert.doesNotMatch(source, /--dsw-alias-switch-thumb/)
  // 状态不能只靠颜色：开关旁始终有开启/关闭文字。
  assert.match(source, /main-model-fallback-switch-state/)
  // 官方菜单保留键盘拦截（Escape/Tab/方向键），插件不注册 keydown/Tab 处理。
  assert.doesNotMatch(source, /onKeyDown/)
  // 选择后备模型只落配置，绝不调用官方 directory.select 改主模型。
  assert.doesNotMatch(source, /\.select\s*\(/)
  // 思考档来自目标模型目录的 reasoning.efforts/defaultEffort，不是客户端自建词表。
  assert.match(source, /reasoning\.efforts/)
  assert.match(source, /reasoning\.defaultEffort/)
  // 可搜索、按供应商分组的菜单式列表复用官方目录 groups。
  assert.match(source, /ctx\.modelDirectories|getModelDirectories/)
  assert.match(source, /role: 'menuitemradio'/)
  assert.match(source, /mainModelFallback\.search\.placeholder/)
})

test('every fallback locale key used by the fragment exists in both zh and en dictionaries', async () => {
  const fragment = await read('src/client/main-model-fallback.js')
  const dictionarySource = await read('src/client.js')
  const keys = new Set()
  for (const match of fragment.matchAll(/'((?:mainModelFallback)\.[^']+)'/g)) keys.add(match[1])
  assert.ok(keys.size >= 10, 'expected the fragment to consume its locale dictionary')
  for (const key of keys) {
    assert.ok(key.startsWith('mainModelFallback.'), `unexpected locale namespace for ${key}`)
    const occurrences = dictionarySource.split(`'${key}':`).length - 1
    assert.equal(occurrences, 2, `locale key ${key} must exist exactly once in zh and once in en`)
  }
})
