import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { readClientSource } from '../scripts/client-source.mjs'

// P1 侧栏主面板的静态护栏（规格：docs/planning/main-panel.md）：
// 分片必须进清单且排在 apply.js 之前；卡片外观中和规则只能作用于本页壳之内；
// 构造与 sync/dispose 必须自带 try/catch 兜底（加载期异常会让活体客户端半整体失效）。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFile(resolve(root, path), 'utf8')

test('the main panel fragment is in the client source manifest, before apply.js', async () => {
  const { files } = await readClientSource()
  const fragment = files.indexOf('src/client/main-panel.js')
  const apply = files.indexOf('src/client/apply.js')
  assert.notEqual(fragment, -1, 'src/client/main-panel.js must be part of the client source')
  assert.notEqual(apply, -1, 'apply.js must stay in the manifest')
  assert.ok(fragment < apply, 'the factory must be declared before apply() immediate call site')
  // 分片清单是拼接顺序的唯一事实源：构建与静态测试都读它，这里只断言新分片在场。
  const manifest = await read('scripts/client-source.mjs')
  assert.match(manifest, /'src\/client\/main-panel\.js',/)
})

test('the card-look neutralisation is scoped to the page shell, never the existing selector', async () => {
  const source = await read('src/client/main-panel.js')
  assert.match(source, /const MAIN_PANEL_SELECTOR = '\[data-dshsvc-main-panel\]'/)
  // 覆盖规则必须带页壳前缀（在本页壳之内生效）；既有 settings 卡片外观不动。
  assert.match(source, /MAIN_PANEL_SELECTOR \+ ' \[data-dshsvc-root\]\{background:transparent;border-radius:0;padding:0\}'/)
  const bareRootRule = source.split('\n').filter((line) => line.includes("'[data-dshsvc-root]"))
  assert.deepEqual(bareRootRule, [], 'no bare [data-dshsvc-root] rule may be introduced by this fragment')
})

test('the factory guards construction, sync and dispose instead of throwing into apply()', async () => {
  const source = await read('src/client/main-panel.js')
  assert.match(source, /const guard = \(label, run\) => \(\.\.\.args\) => \{[\s\S]*?try \{[\s\S]*?\} catch \(error\) \{/)
  assert.match(source, /const sync = guard\('sidebar main panel sync'/)
  assert.match(source, /const dispose = guard\('sidebar main panel dispose'/)
  // 每次注销/样式移除都必须自带兜底：布局服务或 DOM 可能已被卸载。
  assert.match(source, /try \{ row\(\) \} catch \(_\) \{\}/)
  assert.match(source, /try \{ panel\(\) \} catch \(_\) \{\}/)
})

test('both halves default the sidebarPanel feature to false and translate it', async () => {
  const host = await read('index.js')
  assert.match(host, /DEFAULT_FEATURE_SETTINGS = Object\.freeze\(\{[\s\S]*?sidebarPanel: false,/)
  const apply = await read('src/client/apply.js')
  assert.match(apply, /const DEFAULT_FEATURES = \{[^}]*sidebarPanel: false \}/)
  assert.match(apply, /'sidebarSettingsEntry', 'sidebarPanel'\]/, 'the switch belongs to the interaction group')

  const dictionaries = await read('src/client.js')
  assert.match(dictionaries, /'features\.sidebarPanel': '侧栏运维面板',/)
  assert.match(dictionaries, /'features\.sidebarPanel': 'Sidebar ops panel',/)
})
