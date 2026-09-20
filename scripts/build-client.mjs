import { readFile, writeFile } from 'node:fs/promises'
import { minify } from 'terser'

import { checkClientSource, clientSourceBounds } from './check-client-source.mjs'
import { INLINE_ANCHOR as ANCHOR, readClientSource } from './client-source.mjs'

// 构建期内联的生成物数据（均由 scripts/ 下的生成器联网生成、已入库）在这里被
// **内联**进客户端源，再一起过 terser：
//   - 构建本身不联网，离线可重现；
//   - 运行期零外部请求，无 CSP/隐私面；
//   - 数据与代码同一次压缩，省掉一次网络往返。
// 插入点是 factory 作用域顶部（`const NS = 'dsh-service'` 之后），apply() 内直接引用
// 这些绑定——引用名必须同时登记在 scripts/check-client-source.mjs 的 ALLOWED_GLOBALS，
// 否则词法检查会把「构建期才存在的全局」当成自由名报错。
//
// 客户端源码可能由多个分片组成（清单在 scripts/client-source.mjs，构建与静态测试
// 共用同一份）：分片不是模块，而是同一个 factory 作用域的连续切片，拼接后仍是一份
// 普通 JS；加载器只认 exports["./client"] 单一产物，故这里也只产出包根 client.js。
const INLINE_BUNDLES = [
  {
    file: '../src/model-icons.generated.js',
    requires: ['MODEL_ICON_DATA', 'MODEL_ICON_PROVIDERS'],
    comment: '模型厂家/渠道图标数据（构建期内联；改动请跑 scripts/generate-model-icons.mjs）',
    generator: 'scripts/generate-model-icons.mjs',
  },
  {
    file: '../src/holidays.generated.js',
    requires: ['HOLIDAY_DATA'],
    comment: '中国法定节假日数据（构建期内联；改动请跑 scripts/generate-holidays.mjs）',
    generator: 'scripts/generate-holidays.mjs',
  },
]

const { source, files } = await readClientSource()

// 拼接后的源码先过词法检查，**再**写产物：少了工厂返回值或引用了分片私有名的源码
// 拼接后依然语法合法，terser 会一路压缩成「能加载但运行期炸」的包，所以闸门必须在
// 这里，而不是发布后靠运行期发现。检查只读 AST，不改源码；失败即中止构建。
{
  const bounds = await clientSourceBounds(files, source.length)
  const { ok, errors } = await checkClientSource(source, { files: bounds })
  if (!ok) {
    throw new Error(
      `client source lexical check failed (${errors.length} finding${errors.length === 1 ? '' : 's'}); ` +
      `client.js was NOT written:\n  - ${errors.join('\n  - ')}`,
    )
  }
}

const at = source.indexOf(ANCHOR)
if (at === -1) throw new Error(`client source anchor not found: ${ANCHOR} (read ${files.join(', ')})`)
const insertAt = at + ANCHOR.length

let inlined = source
for (const bundle of INLINE_BUNDLES) {
  const generated = await readFile(new URL(bundle.file, import.meta.url), 'utf8')
  // generated 文件自带 leading 注释行，取其声明本体即可。
  const declarations = generated
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n')
    .trim()

  for (const name of bundle.requires) {
    if (!declarations.includes(name)) {
      throw new Error(`${bundle.file} missing expected declaration ${name}; regenerate with ${bundle.generator}`)
    }
  }

  const block =
    `\n    // ── ${bundle.comment}──\n` +
    declarations
      .split('\n')
      .map((line) => (line.trim() === '' ? '' : '    ' + line))
      .join('\n')

  inlined = inlined.slice(0, insertAt) + block + inlined.slice(insertAt)
}

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
