import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// 客户端半的源码清单：**唯一权威源**。
//
// 构建脚本（scripts/build-client.mjs）与静态测试（test/docs-static.test.js）都必须经这里
// 读源码，不许各自 readFile 固定路径——否则清单一旦变动，构建读 A+B+C 而测试只读 A，
// 两边静默漂移，测试会在断言一份并不参与构建的文本。
//
// 顺序即拼接顺序：客户端半整体是**一个** factory 作用域（DSH 客户端模块加载器只认
// exports["./client"] 单一产物、require 不解析相对路径；详见 docs/research/
// apply-closure-split-feasibility.md），所以分片不是模块，只是同一份文本的连续切片。
// 拼接顺序直接决定声明先后，而 apply() 是同步函数体——改动顺序前先确认没有
// 「立即求值的前向引用」。
const CLIENT_SOURCE_FILES = [
  'src/client.js',
  'src/client/mobile.js',
  'src/client/conversation-nav.js',
  'src/client/subagent-dispatch-ring.js',
  'src/client/model-icons.js',
  'src/client/apply.js',
]

/** 客户端工厂入口标记：整个产物有且只能有一个。 */
const FACTORY_ENTRY = 'window.__ModuleLoader__.load('
/** 图标数据的构建期内联锚点：必须唯一，否则内联会插进第一个匹配处。 */
const INLINE_ANCHOR = "const NS = 'dsh-service'"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 读并拼接客户端源码。
 *
 * 每个分片归一为「恰好一个尾换行」再首尾相接：单文件时结果与磁盘内容逐字节相同
 * （分片各自带自己的行分隔符，相接处不额外插入任何字节），多文件时等价于把各段
 * 按行切开后顺序拼回。这条性质让拆分对 terser 产物完全透明。
 *
 * @returns {Promise<{ source: string, files: string[] }>} 拼接后的源码与参与的文件（相对仓库根）
 */
export async function readClientSource() {
  const parts = []
  for (const file of CLIENT_SOURCE_FILES) {
    const text = await readFile(resolve(ROOT, file), 'utf8')
    if (text === '') throw new Error(`client source part is empty: ${file}`)
    parts.push(text.endsWith('\n') ? text : text + '\n')
  }
  const source = parts.join('')

  // 结构性不变量：分片只能切出「一份 factory」，切错（例如把开头也切走一份、
  // 或某个分片自带入口）必须立刻失败，而不是产出一个能跑但语义可疑的包。
  const entries = source.split(FACTORY_ENTRY).length - 1
  if (entries !== 1) throw new Error(`client source must contain exactly one ${FACTORY_ENTRY} (found ${entries})`)
  const anchors = source.split(INLINE_ANCHOR).length - 1
  if (anchors !== 1) throw new Error(`client source must contain exactly one inline anchor (${INLINE_ANCHOR}), found ${anchors}`)

  return { source, files: [...CLIENT_SOURCE_FILES] }
}

export { CLIENT_SOURCE_FILES, FACTORY_ENTRY, INLINE_ANCHOR, ROOT }
