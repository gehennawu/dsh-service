import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { readClientSource } from '../scripts/client-source.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// 客户端源码按清单拼接后读取（清单在 scripts/client-source.mjs，构建脚本共用同一份）：
// 拆分后若这里仍写死 read('src/client.js')，断言到的将是一份不参与构建的文本。
const clientSource = async () => (await readClientSource()).source

function imageTargets(markdown) {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
}

function section(markdown, heading) {
  const start = markdown.indexOf(heading)
  assert.notEqual(start, -1, `missing section ${heading}`)
  const next = markdown.indexOf('\n### ', start + heading.length)
  return markdown.slice(start, next === -1 ? markdown.length : next)
}

// 路线图正文（TODO.md 与 docs/planning/）按 .gitignore 属本机资产，不入版本库：
// 克隆、CI 与 npm tarball 里都不存在。缺失文件时返回 null，让路线图断言在无本地
// 文档的环境下跳过，而不是让整个文档测试必然读取失败。
function localSection(path, heading) {
  if (!existsSync(resolve(root, path))) return null
  return section(read(path), heading)
}

test('README image references exist and screenshots ship in the npm package', () => {
  for (const path of ['README.md', 'README.en.md', 'screenshots/README.md']) {
    for (const target of imageTargets(read(path))) {
      if (/^[a-z]+:/i.test(target)) continue
      assert.equal(existsSync(resolve(root, dirname(path), target)), true, `${path} references missing image ${target}`)
    }
  }
  const packageJson = JSON.parse(read('package.json'))
  assert.ok(packageJson.files.includes('screenshots'), 'package files must include screenshots used by the READMEs')
})

test('published browser entry stays at the DSH-standard package-root client.js', async () => {
  const packageJson = JSON.parse(read('package.json'))
  assert.equal(packageJson.exports['./client'], './client.js')
  assert.equal(packageJson.files.includes('client.js'), true)
  assert.equal(packageJson.files.includes('src/client.js'), false)
  assert.equal(packageJson.files.some((path) => path.startsWith('dist/')), false)
  const source = await clientSource()
  const artifact = read('client.js')
  assert.match(artifact, /^window\.__ModuleLoader__\.load\(/)
  assert.ok(artifact.length < source.length * 0.75, `generated client artifact should be at least 25% smaller (${artifact.length}/${source.length})`)
})

// 运行时完整性守卫：宿主半拆出兄弟模块后（*-routes.js 等），只要 index.js 相对导入的
// 本地模块有一个没进 package.json files，发布包就会在加载时崩。这里解析 index.js 的
// 相对导入并逐个核对 files 白名单，新增拆分文件时忘记登记会直接红。
test('every local module imported by the host entry ships in the package files list', () => {
  const packageJson = JSON.parse(read('package.json'))
  const host = read('index.js')
  const relativeImports = [...host.matchAll(/from\s+'(\.[^']+)'/g)].map((m) => m[1])
  assert.ok(relativeImports.length >= 5, `expected the host entry to import its sibling modules (${relativeImports.join(', ')})`)
  for (const spec of relativeImports) {
    const target = (spec.endsWith('.js') ? spec : `${spec}.js`).replace(/^\.\//, '')
    assert.equal(
      packageJson.files.includes(target),
      true,
      `host imports "${spec}" but package.json files does not ship "${target}" — the published tarball would crash on load`,
    )
  }
})

test('backup integrity and restore preflight are documented in both languages and shipped', () => {
  const zh = section(read('README.md'), '### 备份管理')
  const en = section(read('README.en.md'), '### Backup management')
  const packageJson = JSON.parse(read('package.json'))
  assert.match(zh, /完整性检查.*恢复预检/s)
  assert.match(zh, /SHA-256.*目标指纹/s)
  assert.match(en, /Integrity inspection.*Restore preflight/s)
  assert.match(en, /SHA-256.*target fingerprint/s)
  assert.equal(packageJson.files.includes('backup-integrity.js'), true)
})

test('session deletion documentation is archived-only in both languages and the roadmap', () => {
  const zh = section(read('README.md'), '### 会话管理')
  const en = section(read('README.en.md'), '### Session manager')
  assert.match(zh, /仅已归档会话可删除/)
  assert.doesNotMatch(zh, /非运行中会话可删除/)
  assert.match(en, /Only archived sessions can be deleted/i)
  assert.doesNotMatch(en, /non-running sessions can be deleted/i)
  const roadmap = localSection('docs/planning/sessions.md', '## v0.35 会话管理')
  if (roadmap !== null) {
    assert.match(roadmap, /未归档.*拒绝/)
    assert.match(roadmap, /live.*拒绝/i)
  }
})

test('plugin health checks are documented in both languages and shipped', () => {
  const zh = section(read('README.md'), '### 健康诊断')
  const en = section(read('README.en.md'), '### Health diagnostics')
  const roadmap = localSection('docs/planning/runtime-health.md', '## v1.3 插件健康检查')
  const packageJson = JSON.parse(read('package.json'))
  assert.match(zh, /插件健康检查/)
  assert.match(zh, /重新加载/)
  assert.match(zh, /已释放或未知状态/)
  assert.match(zh, /兼容性/)
  assert.match(en, /plugin health/i)
  assert.match(en, /reload/i)
  assert.match(en, /disposed or unknown/i)
  assert.match(en, /compatib/i)
  if (roadmap !== null) {
    assert.match(roadmap, /plugin-restart/)
    assert.match(roadmap, /plugin-compat/)
  }
  assert.equal(packageJson.files.includes('plugin-health.js'), true)
  assert.equal(packageJson.files.includes('plugin-compat.js'), true)
})

// 图标目录页是生成物（scripts/model-icons-catalog.mjs），与 src/model-icons.generated.js
// 同源。这里做漂移检查：数据改了却忘了重渲染、或页面被手改过，都会红。
// 顺带断言每张图形都出现在页面里——只比对字节无法发现「生成器漏了某个 slug」。
test('model icon catalog is regenerated from the generated data and covers every mark', async () => {
  const { parseGeneratedData, renderCatalog } = await import('../scripts/model-icons-catalog.mjs')
  const source = read('src/model-icons.generated.js')
  const parsed = parseGeneratedData(source)
  const expected = renderCatalog({
    ...parsed,
    sourceVersion: source.match(/icons-static-svg@([\d.]+)/)[1],
  })
  assert.equal(read('docs/model-icons.html'), expected, 'docs/model-icons.html is stale; run node scripts/model-icons-catalog.mjs')

  const html = read('docs/model-icons.html')
  const slugs = Object.keys(parsed.data)
  assert.equal(slugs.length, 62, 'icon mark count changed — update the catalog expectations with it')
  for (const slug of slugs) {
    assert.match(html, new RegExp(`data-slug="${slug}"`), `catalog is missing mark ${slug}`)
  }
  // provider 精确表与别名表都必须逐条落进页面（源码折叠块里的 slug 不算数，
  // 表格行才是有意展示的口径）。
  for (const provider of Object.keys(parsed.providers)) {
    assert.ok(html.includes(`<code>${provider}</code>`), `catalog is missing provider ${provider}`)
  }
  for (const [prefix, slug] of parsed.prefixes) {
    assert.ok(html.includes(`<code>${prefix}</code>`), `catalog is missing prefix ${prefix}`)
    assert.ok(parsed.data[slug] !== undefined, `prefix ${prefix} points at unknown slug ${slug}`)
  }
  // 页面必须零外部请求：出现 http(s) 资源引用即视为引入网络依赖。
  const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(external, [], `catalog must not reference external resources: ${external.join(', ')}`)
})

// 目录页的全部意义是「所见即运行期」。它的 data-URI 由 scripts/model-icons-catalog.mjs
// 独立复刻一份（src/client.js 的 modelIconDataUri 在客户端工厂作用域内，无法直接 import），
// 两侧一旦单向改动就会静默漂移——历史上就发生过：运行期补了 color="#000"、目录页没跟。
// 这里用源码逐字比对，把「同算法」从注释里的承诺变成可执行断言。
test('catalog data-URI builder stays byte-identical to the runtime modelIconDataUri', async () => {
  const { dataUri } = await import('../scripts/model-icons-catalog.mjs')
  const client = await clientSource()
  const runtime = client.match(/const modelIconDataUri = \(spec, useMask\) => \{(.*?)\n    \}/s)
  assert.notEqual(runtime, null, 'runtime modelIconDataUri not found in the concatenated client source')

  // 两处都是 DATA-URI 模板：抽出各自的 svg 模板串，断言逐字相等。
  const catalogSvg = read('scripts/model-icons-catalog.mjs').match(/const svg = `([^`]*)`/)
  assert.notEqual(catalogSvg, null, 'catalog dataUri svg template not found')
  const runtimeSvg = runtime[1].match(/const svg = `([^`]*)`/)
  assert.notEqual(runtimeSvg, null, 'runtime modelIconDataUri svg template not found')
  assert.equal(
    runtimeSvg[1],
    catalogSvg[1],
    'catalog and runtime data-URI templates drifted; keep both in sync',
  )

  // 行为面复核：两侧对同一 spec 产出的 data-URI 必须完全相同（含 mask/color 两个分支）。
  const spec = { v: '0 0 24 24', m: '<path d="M0 0h24v24H0z"/>', c: 0 }
  for (const useMask of [true, false]) {
    const fromCatalog = dataUri(spec, useMask)
    const expectedPaint = useMask ? ' fill="#000" color="#000"' : ''
    const expected = `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${spec.v}"${expectedPaint}>${spec.m}</svg>`,
    )}")`
    assert.equal(fromCatalog, expected, `catalog dataUri drifted (useMask=${useMask})`)
  }
})
