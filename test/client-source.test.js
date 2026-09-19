import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ALLOWED_GLOBALS, checkClientSource, checkClientSourceFromDisk, clientSourceBounds } from '../scripts/check-client-source.mjs'
import { readClientSource } from '../scripts/client-source.mjs'

// 客户端半的词法检查（scripts/check-client-source.mjs）的正反用例。
//
// 全部变异都作用在**真实源码**上：拆分后的分片不是一个模块，失效形态（工厂少返回一个
// 名字、apply 引用分片私有名）拼接后语法完全合法，只会在运行期显形。用真实源码而不是
// 手写小样例，才能保证这些用例跟着清单一起演进——分片改名、工厂改名时用例会先红。
//
// 反例（必须不报）同样重要：字符串、注释、属性名、属性访问、遮蔽局部变量都不得触发误报。
// 本文件不做任何磁盘写入，变异只存在于内存字符串里。

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 读拼接后的权威源（与构建、test/docs-static.test.js 共用同一份清单）。 */
const clientSource = async () => (await readClientSource()).source

/** 分片清单（供偏移表用例复用）。 */
const clientSourceFiles = async () => (await readClientSource()).files

/**
 * 断言变异确实改变了源码：替换目标消失时静默通过的测试没有价值。
 * 替换值走函数形式，避免 `$&`/`$1` 之类被 String.replace 当成替换模式解释 ——
 * apply.js 里满是模板字符串与 `$`，直接传字符串会静默插入整段匹配文本。
 */
function mutate(source, from, to, label) {
  assert.ok(source.includes(from), `mutation anchor disappeared (${label}): ${from.slice(0, 120)}`)
  const mutated = source.replace(from, () => to)
  assert.notEqual(mutated, source, `mutation had no effect (${label})`)
  return mutated
}

function messages(result) {
  return result.errors.join('\n')
}

test('committed client source passes the lexical check', async () => {
  const { ok, errors, stats } = await checkClientSourceFromDisk()
  assert.equal(ok, true, `check:client reported findings on committed source:\n${errors.join('\n')}`)
  // 清单被切碎时这两个数字会变；断言下界保证检查真的解析到了源码，而不是空跑。
  assert.ok(stats.references > 10_000, `expected the full concatenated source to be scanned, saw ${stats.references} references`)
  assert.ok(stats.factories.length >= 5, `expected several fragment factories, saw ${stats.factories.length}`)
  assert.ok(stats.destructureSites >= 5, `expected factory destructuring sites in apply, saw ${stats.destructureSites}`)
})

test('the allowlist stays exactly equal to the free names actually in use', async () => {
  const source = await clientSource()
  const { stats } = await checkClientSource(source)
  // 两个方向都断言：既不允许白名单留下永不使用的名字（会长成放行一切的大表），
  // 也不允许源码里的自由名逃出白名单。这条用例是「白名单是真实清单」的守门人。
  const unused = ALLOWED_GLOBALS.filter((name) => !stats.globals.includes(name))
  const unlisted = stats.globals.filter((name) => !ALLOWED_GLOBALS.includes(name))
  assert.deepEqual(unused, [], `ALLOWED_GLOBALS carries names no longer referenced: ${unused.join(', ')}`)
  assert.deepEqual(unlisted, [], `free names are missing from ALLOWED_GLOBALS: ${unlisted.join(', ')}`)
})

test('omitted factory return is reported against the destructuring site', async () => {
  // 分片工厂把内部名字交回 apply 的唯一通道是返回值：少一个键，apply 侧解构到 undefined。
  // 变异刻意**等长**（fetchQuotaSnapshot → fetchQuotaSnapshoX，均 18 字符），这样分片偏移表
  // 与真实文件逐一对应，报错定位可以被逐字验证。
  const source = await clientSource()
  const mutated = mutate(
    source,
    'readQuotaPollMinutes, fetchQuotaSnapshot } = createQuotaCore',
    'readQuotaPollMinutes, fetchQuotaSnapshoX } = createQuotaCore',
    'rename the destructured fetchQuotaSnapshot key',
  )
  assert.equal(mutated.length, source.length, 'this mutation must preserve length so the fragment offset table stays valid')
  const result = await checkClientSource(mutated, { files: await clientSourceBounds(await clientSourceFiles(), mutated.length) })
  assert.equal(result.ok, false, 'destructuring a name the factory never returns must fail the check')
  assert.match(messages(result), /createQuotaCore\(\) never returns "fetchQuotaSnapshoX"/)
  // 定位必须落在解构所在的真实分片与真实行号（src/client/apply.js 第 297 行）。
  assert.match(messages(result), /src\/client\/apply\.js:297\b/, 'finding must report the fragment-local line number')
})

test('a fragment-local private name referenced elsewhere is located in its own fragment', async () => {
  // 定位换算必须逐分片正确：terser 报的是拼接后的全局行号，直接把全局行号当成分片行号
  // 会指到完全无关的位置（本用例就是为这个换算写的）。
  //
  // 变异是**等长**的：apply.js 里的 `cancelAnimationFrame`（20 字符）换成
  // `quotaSnapshotPromise`（20 字符，createQuotaCore 的私有状态名）。这样分片偏移表与
  // 真实文件一一对应，且期望行号由 test 独立读取分片文件数出来 —— 与实现用的拼接偏移
  // 换算是两条独立路径，能真正证伪。
  const { files } = await readClientSource()
  assert.ok(files.includes('src/client/apply.js'), 'apply fragment must be in the manifest')
  const applyText = await readFile(resolve(root, 'src/client/apply.js'), 'utf8')
  const applyLines = applyText.split('\n')
  assert.equal(
    applyLines.findIndex((line) => line.includes('quotaSnapshotPromise')),
    -1,
    'the anchor name must not already appear in apply.js, or the assertion below cannot tell which hit was reported',
  )
  const lineIndex = applyLines.findIndex((line) => line.includes('cancelAnimationFrame'))
  assert.notEqual(lineIndex, -1, 'expected an apply.js line using cancelAnimationFrame as the equal-length anchor')

  const source = await clientSource()
  // 只替换 apply 分片内的那一处（拼接前的分片文本自带尾换行，与 client-source 的归一一致）。
  const applyFragment = applyText.endsWith('\n') ? applyText : `${applyText}\n`
  assert.ok(source.includes(applyFragment), 'apply fragment text must appear verbatim in the concatenated source')
  const mutatedFragment = mutate(applyFragment, 'cancelAnimationFrame', 'quotaSnapshotPromise', 'swap a global for a fragment-private name')
  const mutated = mutate(source, applyFragment, mutatedFragment, 'apply the apply-fragment mutation')
  assert.equal(mutated.length, source.length, 'this mutation must preserve length so the fragment offset table stays valid')

  const result = await checkClientSource(mutated, { files: await clientSourceBounds(files, mutated.length) })
  assert.equal(result.ok, false, 'referencing a fragment-private name must fail the check')
  assert.match(messages(result), /private to fragment factory createQuotaCore\(\)/)
  assert.match(
    messages(result),
    new RegExp(`src/client/apply\\.js:${lineIndex + 1}\\b`),
    `finding must land on apply.js:${lineIndex + 1} (the fragment-local line), not the concatenated line`,
  )
})

test('async helper whose declaration disappears is reported as an unresolved reference', async () => {
  // async helper 最隐蔽：`const p = helper()` 只有 await 时才炸，语法与压缩都不报。
  const source = await clientSource()
  const mutated = mutate(
    source,
    'async function fetchQuotaSnapshot(payload',
    'async function fetchQuotaSnapshotRenamed(payload',
    'rename the async helper declaration but keep the reference',
  )
  const result = await checkClientSource(mutated)
  assert.equal(result.ok, false, 'a reference to a renamed-away async helper must fail the check')
  assert.match(messages(result), /"fetchQuotaSnapshot"/)
  // 该名字仍在工厂返回面里，因此归因为「没走返回值」，而不是被当成合法全局。
  assert.match(messages(result), /returned by createQuotaCore\(\) but referenced outside any factory binding/)
})

test('referencing a fragment-private helper from apply is reported', async () => {
  // 反向失效：apply 直接引用分片内部私有名 —— 拼接后是自由名，浏览器里 ReferenceError。
  const source = await clientSource()
  const mutated = mutate(
    source,
    '    exports.inject = inject',
    '    void quotaSnapshotPromise\n    exports.inject = inject',
    'apply references createQuotaCore private state',
  )
  const result = await checkClientSource(mutated)
  assert.equal(result.ok, false, 'referencing a fragment-private name must fail the check')
  assert.match(messages(result), /"quotaSnapshotPromise".*private to fragment factory createQuotaCore\(\)/)
})

test('an unlisted global is reported and names the allowlist to edit', async () => {
  const source = await clientSource()
  const mutated = mutate(
    source,
    '    exports.inject = inject',
    '    void windowDshServiceTotallyNewGlobal\n    exports.inject = inject',
    'introduce an unknown global',
  )
  const result = await checkClientSource(mutated)
  assert.equal(result.ok, false, 'an unknown global must fail the check')
  assert.match(messages(result), /unknown global identifier "windowDshServiceTotallyNewGlobal"/)
  assert.match(messages(result), /ALLOWED_GLOBALS/)
})

test('browser globals and inlined MODEL_ICON names are allowed by the shipped allowlist', async () => {
  const source = await clientSource()
  const result = await checkClientSource(source)
  // 三个 MODEL_ICON_* 是构建期内联的分片级引用，浏览器全局则是客户端半的宿主 API：
  // 两类都必须已经在白名单里，否则干净源码会误报。
  for (const name of ['window', 'fetch', 'MODEL_ICON_DATA', 'MODEL_ICON_PROVIDERS', 'MODEL_ICON_PREFIXES']) {
    assert.ok(ALLOWED_GLOBALS.includes(name), `${name} must be explicitly allowlisted`)
  }
  assert.equal(result.errors.filter((message) => /MODEL_ICON_/.test(message)).length, 0)
})

test('strings, comments, property names and property access do not produce findings', async () => {
  // 词法检查的价值取决于零误报：这些形态出现过同名文本，但没有 AST_SymbolRef，
  // 因此既不能算「未解析标识符」，也不能算「工厂私有名被引用」。
  const source = await clientSource()
  const mutated = mutate(
    source,
    '    exports.inject = inject',
    [
      '    // quotaSnapshotPromise fetchQuotaSnapshot are mentioned in a comment',
      '    const lexicalNoise = { fetchQuotaSnapshot: 1, quotaSnapshotPromise: 2 }',
      '    lexicalNoise.fetchQuotaSnapshot = "quotaSnapshotPromise fetchQuotaSnapshot"',
      '    void lexicalNoise',
      '    exports.inject = inject',
    ].join('\n'),
    'mention private names in strings/comments/properties only',
  )
  const result = await checkClientSource(mutated)
  assert.equal(result.ok, true, `textual mentions must not be flagged:\n${messages(result)}`)
})

test('a shadowing local declaration is resolved to the local binding, not the private fragment name', async () => {
  // 遮蔽必须由作用域分析回答，而不是文本匹配：同名局部变量是完全合法的。
  const source = await clientSource()
  const mutated = mutate(
    source,
    '    exports.inject = inject',
    '    {\n      const quotaSnapshotPromise = null\n      const fetchQuotaSnapshot = () => quotaSnapshotPromise\n      void fetchQuotaSnapshot\n    }\n    exports.inject = inject',
    'shadow fragment-private names in a block scope',
  )
  const result = await checkClientSource(mutated)
  assert.equal(result.ok, true, `shadowed locals must not be flagged:\n${messages(result)}`)
})

test('a factory returning through an object constant is tracked', async () => {
  // 返回面分析要能跟一层 `const api = {...}; return api`，否则真实分片会被误判为不透明。
  const source = await clientSource()
  const result = await checkClientSource(source)
  const quotaCore = result.stats.factories.find((factory) => factory.name === 'createQuotaCore')
  assert.ok(quotaCore, 'createQuotaCore should be recognised as a fragment factory')
  assert.notEqual(quotaCore.returns, null, 'createQuotaCore return surface should be statically known')
  assert.ok(quotaCore.returns >= 20, `createQuotaCore should expose its full surface, saw ${quotaCore.returns}`)
})

test('dynamically-shaped returns are treated as opaque rather than reported', async () => {
  // 宁可不报也不误报：工厂一旦有条件返回或动态键，返回面不可静态确定，检查必须放手。
  const source = await clientSource()
  const mutated = mutate(
    source,
    'function createNotificationService() {',
    'function createNotificationService(dynamicKey) {\n  if (Math.random() > 0.5) return { [dynamicKey]: 1 }',
    'add a dynamic-key early return to a factory',
  )
  const result = await checkClientSource(mutated)
  const notification = result.stats.factories.find((factory) => factory.name === 'createNotificationService')
  assert.equal(notification.returns, null, 'a dynamic-key return must mark the factory return surface opaque')
  assert.equal(
    result.errors.some((message) => /createNotificationService\(\) never returns/.test(message)),
    false,
    'an opaque factory must not produce missing-return findings',
  )
})

test('the check itself is non-mutating: the artifact is not rebuilt by running it', async () => {
  // 检查只读 AST。这里比对 client.js 的运行前后字节，确认测试不会顺手改产物。
  const artifact = resolve(root, 'client.js')
  const before = await readFile(artifact)
  await checkClientSourceFromDisk()
  const after = await readFile(artifact)
  assert.equal(after.equals(before), true, 'check:client must not rewrite client.js')
})
