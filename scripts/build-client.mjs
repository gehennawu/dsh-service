import { readFile, writeFile } from 'node:fs/promises'
import { minify } from 'terser'

// 模型厂家/渠道图标数据（src/model-icons.generated.js，由 scripts/generate-model-icons.mjs
// 联网生成、已入库）在这里被**内联**进客户端源，再一起过 terser：
//   - 构建本身不联网，离线可重现；
//   - 运行期零外部请求，无 CSP/隐私面；
//   - 数据与代码同一次压缩，省掉一次网络往返。
// 插入点是 factory 作用域顶部（`const NS = 'dsh-service'` 之后），apply() 内的
// 图标引擎直接引用这三个绑定。
const ANCHOR = "const NS = 'dsh-service'"

const generated = await readFile(new URL('../src/model-icons.generated.js', import.meta.url), 'utf8')
const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

// generated 文件自带 leading 注释行，取其声明本体即可。
const declarations = generated
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n')
  .trim()

if (!declarations.includes('MODEL_ICON_DATA') || !declarations.includes('MODEL_ICON_PROVIDERS')) {
  throw new Error('model-icons.generated.js missing expected declarations; regenerate with scripts/generate-model-icons.mjs')
}

const at = source.indexOf(ANCHOR)
if (at === -1) throw new Error(`client source anchor not found: ${ANCHOR}`)
const insertAt = at + ANCHOR.length

const inlined =
  source.slice(0, insertAt) +
  '\n    // ── 模型厂家/渠道图标数据（构建期内联；改动请跑 scripts/generate-model-icons.mjs）──\n' +
  declarations
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : '    ' + line))
    .join('\n') +
  source.slice(insertAt)

const result = await minify(inlined, {
  compress: {
    defaults: true,
    passes: 2,
  },
  mangle: true,
  ecma: 2022,
  format: {
    comments: false,
  },
})
if (typeof result.code !== 'string' || result.code === '') throw new Error('terser produced no client artifact')
const target = new URL('../client.js', import.meta.url)
await writeFile(target, result.code + '\n')
