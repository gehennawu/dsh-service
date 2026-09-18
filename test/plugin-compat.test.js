import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  COMPAT_BREAKS,
  collectManifestHits,
  collectPluginCompat,
  manifestCallRefs,
  packageEntryFiles,
  pluginCompatCheckItem,
  scanCodeHits,
  scanPluginCompatibility,
} from '../plugin-compat.js'

function createFakeCtx(loader) {
  return {
    get(service) {
      return service === 'loader' ? loader : undefined
    },
  }
}

test('COMPAT_BREAKS lists only verified alpha breakage with unique ids', () => {
  const ids = new Set()
  assert.ok(COMPAT_BREAKS.length >= 1)
  for (const entry of COMPAT_BREAKS) {
    assert.equal(typeof entry.id, 'string')
    assert.equal(typeof entry.match, 'string')
    assert.ok(['manifest', 'code'].includes(entry.layer), `${entry.id} layer`)
    assert.ok(entry.match.length > 0)
    assert.equal(ids.has(entry.id), false, `duplicate id ${entry.id}`)
    ids.add(entry.id)
  }
  assert.ok(ids.has('client-runtime'))
  assert.ok(ids.has('sqlite-persistence'))
  assert.ok(ids.has('chat-hash'))
  assert.ok(ids.has('code-runtime'))
  assert.ok(ids.has('e2b-runtime'))
  assert.ok(ids.has('session-start-event'))
})

const codeBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'code')

test('scanCodeHits finds references in code and string literals but ignores comments', () => {
  // 字符串内的引用是真命中（className/选择器以字符串出现）
  assert.deepEqual([...scanCodeHits("const cls = 'Md3f7G_toBottom'", codeBreaks)], ['chat-hash'])
  assert.deepEqual([...scanCodeHits('querySelector("FJxK0a_root")', codeBreaks)], ['stats-hash'])
  assert.deepEqual([...scanCodeHits('document.querySelector(`[data-time-hover-root]`)', codeBreaks)], ['time-hover-root'])
  assert.deepEqual([...scanCodeHits("ctx.on('agent/session-start', () => {})", codeBreaks)], ['session-start-event'])
  // normal 态直接引用
  assert.deepEqual([...scanCodeHits("console.log('x') // Md3f7G_ comment", codeBreaks)], [])
  // 行注释/块注释内的提及不算引用
  assert.deepEqual([...scanCodeHits('// Md3f7G_ moved to EvIC1a_\nconst a = 1', codeBreaks)], [])
  assert.deepEqual([...scanCodeHits('/* rc.2 Md3f7G_ -> alpha.2 EvIC1a_ */\nconst a = 1', codeBreaks)], [])
  // 字符串内的 CSS 块注释不算（插件 mobile CSS 注释先例）
  assert.deepEqual([...scanCodeHits("const css = '/* Md3f7G_ comment */ .a{color:red}'", codeBreaks)], [])
  // 同一字符串里注释外的真实类名仍命中
  assert.deepEqual([...scanCodeHits("const css = '/* Md3f7G_ */ .Md3f7G_toBottom{}'", codeBreaks)], ['chat-hash'])
  // 注释结束后继续扫描
  assert.deepEqual([...scanCodeHits('/* comment */ FJxK0a_root', codeBreaks)], ['stats-hash'])
  // 转义引号不提前闭合字符串
  assert.deepEqual([...scanCodeHits("const s = 'it\\'s Md3f7G_'", codeBreaks)], ['chat-hash'])
  // 多命中汇总
  assert.deepEqual([...scanCodeHits("a('Md3f7G_x'); b('FJxK0a_y'); c('data-time-hover-root')", codeBreaks)], ['chat-hash', 'stats-hash', 'time-hover-root'])
})

test('scanCodeHits treats sentence-like mentions in strings as documentation, not references', () => {
  // 词典/提示文案自指（v1.3 自证误报回归）：旧标识后跟中文标点/括号/空格是「提及」
  assert.deepEqual([...scanCodeHits('引用已迁移的聊天界面旧样式前缀（Md3f7G_，0.1.2-alpha.2 起漂移至 EvIC1a_）', codeBreaks)], [])
  assert.deepEqual([...scanCodeHits('引用已迁移的统计条旧样式前缀（FJxK0a_，0.1.2-alpha.2 起漂移至 -NDN2W_）', codeBreaks)], [])
  assert.deepEqual([...scanCodeHits('使用已移除的元素属性 data-time-hover-root（0.1.2-alpha.2 起由 data-turn-tail 取代）', codeBreaks)], [])
  assert.deepEqual([...scanCodeHits('(Md3f7G_, migrated to EvIC1a_ since 0.1.2-alpha.2)', codeBreaks)], [])
  assert.deepEqual([...scanCodeHits('Uses the removed attribute data-time-hover-root (replaced by data-turn-tail)', codeBreaks)], [])
  // 真实引用形态（词干延续 / 引号收尾 / 中括号收尾）仍然命中
  assert.deepEqual([...scanCodeHits("const c = 'Md3f7G_toBottom'", codeBreaks)], ['chat-hash'])
  assert.deepEqual([...scanCodeHits("document.querySelector('[data-time-hover-root]')", codeBreaks)], ['time-hover-root'])
  assert.deepEqual([...scanCodeHits('getAttribute("FJxK0a_root")', codeBreaks)], ['stats-hash'])
  assert.deepEqual([...scanCodeHits("classList.contains('Md3f7G_')", codeBreaks)], ['chat-hash'])
})

test('scanCodeHits flags 0.1.6-alpha.2 slot retirement and session-open removal with documented limits', () => {
  const codeBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'code')
  // 第三方真实引用：字符串形态的槽位注册、直接方法调用
  assert.deepEqual([...scanCodeHits("ctx.slots.inject('settings.plugin.item', () => {})", codeBreaks)], ['settings-plugin-item'])
  assert.deepEqual([...scanCodeHits("{ name: 'settings.plugin.item', key: 'x' }", codeBreaks)], ['settings-plugin-item'])
  assert.deepEqual([...scanCodeHits('ctx.sessions.open(detail.sessionId)', codeBreaks)], ['sessions-open-method'])
  // 词典/提示的「提及」形态不计：标识后跟全角括号或空格
  assert.deepEqual([...scanCodeHits('注册已退役的设置页槽位 settings.plugin.item（0.1.6-alpha.2 起槽位移除）', codeBreaks)], [])
  assert.deepEqual([...scanCodeHits('调用已移除的打开方法 sessions.open（0.1.6-alpha.2 起移除）', codeBreaks)], [])
  assert.deepEqual([...scanCodeHits('Calls the retired slot settings.plugin.item (removed in 0.1.6-alpha.2)', codeBreaks)], [])
  // 已知局限：可选用链 `sessions?.open` 不含 `sessions.open` 串，扫描不到——研究 §10 建议
  // 的 match 即直接调用形态，需在词典与知识条目注明
  assert.deepEqual([...scanCodeHits('ctx.sessions?.open(detail.sessionId)', codeBreaks)], [])
  // 本插件自身的双版本注册形态命中 settings-plugin-item：由 selfExempt 豁免（见自证用例）
  assert.equal(COMPAT_BREAKS.find((b) => b.id === 'settings-plugin-item').selfExempt, true)
  assert.equal(COMPAT_BREAKS.find((b) => b.id === 'sessions-open-method').selfExempt, undefined)
})

test('manifestCallRefs only matches real require/import calls, not stringified examples', () => {
  const manifestBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'manifest')
  // 真调用：require/import 的引号前无转义反斜杠 → 算引用
  assert.deepEqual(manifestCallRefs("const r = require('@deepseek-ai/dsh-client-runtime')", manifestBreaks), ['client-runtime'])
  assert.deepEqual(manifestCallRefs('import "@deepseek-ai/dsh-session-persistence-sqlite"', manifestBreaks), ['sqlite-persistence'])
  assert.deepEqual(manifestCallRefs("import '@deepseek-ai/dsh-client-runtime'", manifestBreaks), ['client-runtime'])
  assert.deepEqual(manifestCallRefs("require('@deepseek-ai/dsh-code-runtime')", manifestBreaks), ['code-runtime'])
  assert.deepEqual(manifestCallRefs("require('@deepseek-ai/dsh-e2b')", manifestBreaks), ['e2b-runtime'])
  // 字符串化的迁移示例（引号带 \\ 转义，dsh-dream-skin 实证）与 markdown 提及 → 不算调用
  assert.deepEqual(manifestCallRefs('"_x = require(\\"@deepseek-ai/dsh-client-runtime/client\\");"', manifestBreaks), [])
  assert.deepEqual(manifestCallRefs('// `@deepseek-ai/dsh-client-runtime/client` (issue #41)', manifestBreaks), [])
})

test('self-proof: scanning this plugin own manifest and built entries yields zero hits', async () => {
  // 自证回归（v1.3 词典自指误报修复）：构建产物里若再出现裸旧标识（词典文案、代码引用），
  // 本测试立即变红——兼容性扫描绝不能把自己报告成不兼容。
  // 0.1.6-alpha.2 修订：`settings-plugin-item` 标记 selfExempt——本插件为双版本兼容在自身
  // 保留该退役槽位注册（老宿主仍需），豁免其命中；其余破坏面仍强制零命中，且豁免条目
  // 对第三方插件的扫描照常生效。
  const { readFileSync } = await import('node:fs')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const manifestBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'manifest')
  const codeBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'code')
  const exemptIds = new Set(COMPAT_BREAKS.filter((b) => b.selfExempt === true).map((b) => b.id))
  assert.deepEqual([...collectManifestHits(pkg, manifestBreaks)], [])
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  // 宿主端点已按功能域拆到 *-routes.js（packageEntryFiles 只扫 exports 入口，不会覆盖它们），
  // 自证明必须显式纳入，否则拆出的 handler 逃过退役接口扫描。
  const ROUTE_MODULES = ['skill-routes.js', 'session-routes.js', 'quota-routes.js', 'subagent-routes.js', 'backup-routes.js']
  const routeTexts = ROUTE_MODULES.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
  const scanNonExempt = (text) => [...scanCodeHits(text, codeBreaks)].filter((id) => !exemptIds.has(id))
  assert.deepEqual(scanNonExempt(client), [], 'client.js must not reference changed interfaces outside dual-version exemptions')
  assert.deepEqual(scanNonExempt(host), [], 'index.js must not reference changed interfaces outside dual-version exemptions')
  for (let i = 0; i < ROUTE_MODULES.length; i += 1) {
    assert.deepEqual(scanNonExempt(routeTexts[i]), [], `${ROUTE_MODULES[i]} must not reference changed interfaces`)
  }
  // 豁免命中必须确实存在且仅来自客户端半：双版本注册是豁免的前提，注册消失了应删豁免。
  const exemptHits = [...scanCodeHits(client, codeBreaks)].filter((id) => exemptIds.has(id))
  assert.deepEqual(exemptHits, ['settings-plugin-item'], 'the self-exemption must stay tied to the retained dual-version slot registration')
})

test('collectManifestHits scans dependency keys and the dsh field', () => {
  const manifestBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'manifest')
  const hit = (pkg) => [...collectManifestHits(pkg, manifestBreaks)]
  assert.deepEqual(hit({ dependencies: { '@deepseek-ai/dsh-client-runtime': '^0.1.0-rc.6' } }), ['client-runtime'])
  assert.deepEqual(hit({ dsh: { client: { inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-runtime'] } } }), ['client-runtime'])
  assert.deepEqual(hit({ peerDependencies: { '@deepseek-ai/dsh-session-persistence-sqlite': '^0.1.0' } }), ['sqlite-persistence'])
  assert.deepEqual(hit({ devDependencies: { '@deepseek-ai/dsh-client-runtime': '^0.1.0' } }), ['client-runtime'])
  // 值里的字符串不算（只扫键与 dsh 字段）
  assert.deepEqual(hit({ dependencies: { react: '^18' }, description: 'uses @deepseek-ai/dsh-client-runtime' }), [])
  assert.deepEqual(hit({ name: 'clean-pkg' }), [])
})

test('packageEntryFiles resolves exports, main, directory main and index.js fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-compat-entries-'))
  try {
    await mkdir(join(dir, 'lib'))
    await writeFile(join(dir, 'lib', 'index.js'), '')
    await writeFile(join(dir, 'lib', 'client.js'), '')
    await writeFile(join(dir, 'index.js'), '')
    await mkdir(join(dir, 'lib', 'client.js.d'))
    // exports client + dot（对象形态）
    assert.deepEqual(packageEntryFiles(dir, { exports: { './client': { default: './lib/client.js' }, '.': './lib/index.js' } }), [join(dir, 'lib', 'client.js'), join(dir, 'lib', 'index.js')])
    // 字符串形态 + main 目录
    assert.deepEqual(packageEntryFiles(dir, { exports: { './client': './lib/client.js' }, main: './lib' }), [join(dir, 'lib', 'client.js'), join(dir, 'lib', 'index.js')])
    // main 文件 + 无 exports
    assert.deepEqual(packageEntryFiles(dir, { main: './index.js' }), [join(dir, 'index.js')])
    // 全缺 → index.js 兜底
    assert.deepEqual(packageEntryFiles(dir, {}), [join(dir, 'index.js')])
    // 拒绝 ../ 与绝对路径
    assert.deepEqual(packageEntryFiles(dir, { exports: { './client': '../escape.js', '.': '/etc/passwd' } }), [join(dir, 'index.js')])
    // 目录形态的入口不是文件 → 兜底 index.js
    assert.deepEqual(packageEntryFiles(dir, { exports: { './client': './lib/client.js.d' } }), [join(dir, 'index.js')])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('scanPluginCompatibility splits references from stale declarations, and reports unknown reasons', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-compat-scan-'))
  try {
    await mkdir(join(dir, 'node_modules', 'pkg-a'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'pkg-a', 'package.json'), JSON.stringify({
      name: 'pkg-a',
      exports: { './client': './client.js', '.': './index.js' },
      dsh: { client: { inject: ['@deepseek-ai/dsh-client-runtime'] } },
    }))
    await writeFile(join(dir, 'node_modules', 'pkg-a', 'client.js'), "const c = 'Md3f7G_toBottom'")
    await writeFile(join(dir, 'node_modules', 'pkg-a', 'index.js'), '// FJxK0a_ is old\nmodule.exports = {}')

    await mkdir(join(dir, 'node_modules', 'pkg-b'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'pkg-b', 'package.json'), JSON.stringify({
      name: 'pkg-b',
      exports: { './client': './client.js' },
      dependencies: { '@deepseek-ai/dsh-session-persistence-sqlite': '^0.1.0' },
    }))
    await writeFile(join(dir, 'node_modules', 'pkg-b', 'client.js'), "const x = 'data-time-hover-root'")

    await mkdir(join(dir, 'node_modules', 'pkg-ref'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'pkg-ref', 'package.json'), JSON.stringify({
      name: 'pkg-ref',
      main: './index.js',
      dependencies: { '@deepseek-ai/dsh-session-persistence-sqlite': '^0.1.0' },
    }))
    await writeFile(join(dir, 'node_modules', 'pkg-ref', 'index.js'), "import '@deepseek-ai/dsh-session-persistence-sqlite'; module.exports = {}")

    await mkdir(join(dir, 'node_modules', 'pkg-c'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'pkg-c', 'package.json'), JSON.stringify({ name: 'pkg-c', main: './index.js' }))
    await writeFile(join(dir, 'node_modules', 'pkg-c', 'index.js'), 'const clean = 1')

    await mkdir(join(dir, 'node_modules', 'pkg-d'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'pkg-d', 'package.json'), JSON.stringify({ name: 'pkg-d', main: './missing.js' }))

    await mkdir(join(dir, 'node_modules', 'pkg-e'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'pkg-e', 'package.json'), JSON.stringify({ name: 'pkg-e', main: './big.js' }))
    await writeFile(join(dir, 'node_modules', 'pkg-e', 'big.js'), 'x'.repeat(2048))

    const requireFn = (specifier) => join(dir, 'node_modules', specifier)

    // pkg-a：client-runtime 只在 manifest 声明、代码零引用（code 命中 chat-hash 是真引用）
    const a = scanPluginCompatibility(requireFn, 'pkg-a')
    assert.deepEqual(a.hits, ['chat-hash'])
    assert.deepEqual(a.declaredOnly, ['client-runtime'], 'declared-but-unused supplier is a stale declaration')
    assert.equal(a.unknown, null)

    // pkg-b：sqlite-persistence 仅声明残留；time-hover-root 是 code 真引用
    const b = scanPluginCompatibility(requireFn, 'pkg-b')
    assert.deepEqual(b.hits, ['time-hover-root'])
    assert.deepEqual(b.declaredOnly, ['sqlite-persistence'])
    assert.equal(b.unknown, null)

    // pkg-ref：manifest 命中且代码确实 require/import 引用 → 升级为真引用
    const ref = scanPluginCompatibility(requireFn, 'pkg-ref')
    assert.deepEqual(ref.hits, ['sqlite-persistence'])
    assert.deepEqual(ref.declaredOnly, [], 'code reference upgrades the declaration to a real hit')
    assert.equal(ref.unknown, null)

    const c = scanPluginCompatibility(requireFn, 'pkg-c')
    assert.deepEqual(c.hits, [])
    assert.deepEqual(c.declaredOnly, [])
    assert.equal(c.unknown, null)

    const d = scanPluginCompatibility(requireFn, 'pkg-d')
    assert.deepEqual(d.hits, [])
    assert.deepEqual(d.declaredOnly, [])
    assert.equal(d.unknown, 'missing-entry')

    const e = scanPluginCompatibility(requireFn, 'pkg-e', { maxFileBytes: 1024 })
    assert.equal(e.unknown, 'too-large')

    assert.equal(scanPluginCompatibility(requireFn, 'nope-pkg').unknown, 'unresolved')
    assert.equal(scanPluginCompatibility(requireFn, '../escape').unknown, 'unresolved')
    const bad = scanPluginCompatibility(requireFn, 'pkg-c', { maxFileBytes: 1 })
    assert.equal(bad.unknown, 'too-large')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('collectPluginCompat scans enabled entries only, caches, and degrades without loader', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plugin-compat-collect-'))
  try {
    await mkdir(join(dir, 'node_modules', 'good-pkg'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'good-pkg', 'package.json'), JSON.stringify({
      name: 'good-pkg',
      main: './index.js',
      dsh: { client: { inject: ['@deepseek-ai/dsh-client-runtime'] } },
    }))
    await writeFile(join(dir, 'node_modules', 'good-pkg', 'index.js'), "const c = 'Md3f7G_x'")
    const requireFn = (specifier) => join(dir, 'node_modules', specifier)

    const mkEntry = (id, name, disabled = false) => ({ id, disabled, options: { name }, fiber: { state: 2 } })
    const loader = {
      ctx: { baseUrl: `file://${dir}/` },
      entries: () => [
        { id: 'group', options: { name: 'g', group: true } },
        mkEntry('e1', 'good-pkg'),
        mkEntry('e2', 'disabled-pkg', true),
        mkEntry('e3', 'nope-pkg'),
        // Cordis 内建声明名/相对路径不是可扫描的 npm 插件：跳过且不计 scanned（用户实测噪音回归）
        mkEntry('e4', 'cordis:include'),
        mkEntry('e5', './plugins/local.js'),
        // 官方 @deepseek-ai/* 插件：随宿主发行版自洽分发，跳过且不计 scanned（不触发 4 MiB 假报警）
        mkEntry('e6', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'),
      ],
    }
    const first = await collectPluginCompat(createFakeCtx(loader), { requireFn })
    assert.equal(first.available, true)
    assert.equal(first.scanned, 2, 'group, disabled, cordis:, relative-path, and official @deepseek-ai entries are all skipped')
    assert.deepEqual(first.issues, [{ moduleName: 'good-pkg', breaks: ['chat-hash'] }])
    assert.deepEqual(first.declaredOnly, [{ moduleName: 'good-pkg', breaks: ['client-runtime'] }])
    assert.deepEqual(first.unknown, [{ moduleName: 'nope-pkg', reason: 'unresolved' }])

    // 缓存：磁盘内容变化后再次收集仍是旧结果；noCache 才重扫
    await writeFile(join(dir, 'node_modules', 'good-pkg', 'index.js'), 'const clean = 1')
    const cached = await collectPluginCompat(createFakeCtx(loader), { requireFn })
    assert.deepEqual(cached.issues, [{ moduleName: 'good-pkg', breaks: ['chat-hash'] }], 'SCAN_CACHE serves stale result')
    assert.deepEqual(cached.declaredOnly, [{ moduleName: 'good-pkg', breaks: ['client-runtime'] }])
    const fresh = await collectPluginCompat(createFakeCtx(loader), { requireFn, noCache: true })
    assert.deepEqual(fresh.issues, [], 'noCache rescans and the code reference is gone')
    assert.deepEqual(fresh.declaredOnly, [{ moduleName: 'good-pkg', breaks: ['client-runtime'] }], 'the stale manifest declaration survives but is no longer a real hit')

    assert.deepEqual(await collectPluginCompat(createFakeCtx(undefined)), { available: false, scanned: 0, issues: [], soft: [], declaredOnly: [], unknown: [] })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('pluginCompatCheckItem derives warning status and five-segment detail', () => {
  assert.deepEqual(pluginCompatCheckItem({ scanned: 4, issues: [{ moduleName: 'x', breaks: ['chat-hash'] }], soft: [], declaredOnly: [{ moduleName: 'y', breaks: ['client-runtime'] }], unknown: [] }), { id: 'plugin-compat', status: 'warning', detail: '4:1:1:0:0' })
  assert.deepEqual(pluginCompatCheckItem({ scanned: 4, issues: [], soft: [{ moduleName: 's', breaks: ['settings-plugin-item'] }], declaredOnly: [{ moduleName: 'y', breaks: ['client-runtime'] }], unknown: [] }), { id: 'plugin-compat', status: 'info', detail: '4:0:1:0:1' })
  assert.deepEqual(pluginCompatCheckItem({ scanned: 4, issues: [], soft: [], declaredOnly: [{ moduleName: 'y', breaks: ['client-runtime'] }], unknown: [] }), { id: 'plugin-compat', status: 'ok', detail: '4:0:1:0:0' }, 'stale declarations alone do not warn')
  assert.deepEqual(pluginCompatCheckItem({ scanned: 4, issues: [], soft: [], declaredOnly: [], unknown: [{ moduleName: 'x', reason: 'too-large' }] }), { id: 'plugin-compat', status: 'ok', detail: '4:0:0:1:0' }, 'unscanned alone is not a compatibility warning')
  assert.deepEqual(pluginCompatCheckItem({ scanned: 6, issues: [], soft: [], declaredOnly: [], unknown: [] }), { id: 'plugin-compat', status: 'ok', detail: '6:0:0:0:0' })
})