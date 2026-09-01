// Host deep module: plugin compatibility scan against DSH alpha breakage (v1.3).
//
// 为什么不用 peerDependencies 判定（用户点名否掉的方向）：多数第三方插件根本不写 DSH peer
// 声明，写了也未必反映真实兼容性。真实信号是「插件代码/清单是否依赖了已被 DSH alpha 移除或
// 变更的接口」——破坏面清单来自 docs/research/dsh-v0.1.2-alpha.{1,2,3}-plugin-impact.md 与
// AGENTS.md 已核实的 alpha.2 拆包事实：
//
//   manifest 层（package.json 的依赖键与 dsh.client.inject）：
//   - @deepseek-ai/dsh-client-runtime：alpha.2 起官方 web roster 移除该 client supplier，
//     npm 无 0.1.2-alpha.* 发布物；插件声明它会使浏览器半等待不存在的供应商而无法挂载。
//   - @deepseek-ai/dsh-session-persistence-sqlite：alpha.3 移除 SQLite Session persistence
//     backend，官方只交付 JSONL provider；旧 SQLite 数据不会被自动转换。
//   code 层（宿主/浏览器入口文件的非注释文本）：
//   - Md3f7G_：dsh-client-ui-conversation 旧 CSS 哈希前缀，alpha.2 聊天视图拆进
//     dsh-client-ui-chat 后漂移至 EvIC1a_（词干不变，前缀更换）。
//   - FJxK0a_：旧 StatsLine 哈希前缀，alpha.2 漂移至 -NDN2W_。
//   - data-time-hover-root：alpha.2 删除的元素属性，由 data-turn-tail 取代。
//
// 破坏面清单是扩展点：每次 DSH alpha 发布后，把新「移除/迁移的旧标识」追加到 COMPAT_BREAKS
// 即可（清单条目 = 旧标识，从来不列新标识——检测的是「还依赖旧面」）。
//
// 扫描纪律：
//   - 只扫启用条目（与插件体检口径一致：停用是用户选择，不算异常）；
//   - code 层用状态机扫描：注释（行/块/CSS 块）内的提及不算引用（我们的 mobile CSS 注释就
//     写过旧哈希，剥掉后自证零命中）；字符串内的命中算引用（className/选择器/querySelector
//     都以字符串出现）；
//   - 单个入口文件 ≤ 4 MiB（注入可调），超限记 too-large 不误报也不拉满内存；
//   - 结果按模块名进程级缓存（插件更新需重启 DSH 才生效，缓存安全），重复诊断零成本。
//
// 本模块只做数据收集与纯函数变换；无浏览器输入，moduleName 只来自宿主 loader。

import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

/** 允许进入 require.resolve 的安全包名（拒绝 .. 逃逸、空串与非法字符）。 */
function packageNameOf(moduleName) {
  if (typeof moduleName !== 'string' || moduleName.length === 0 || moduleName.length > 4096) return null
  let pkg
  if (moduleName.startsWith('@')) {
    const matched = /^(@[^/]+)\/([^/]+)/.exec(moduleName)
    if (matched === null) return null
    pkg = `${matched[1]}/${matched[2]}`
  } else {
    const matched = /^([^/]+)/.exec(moduleName)
    if (matched === null) return null
    pkg = matched[1]
  }
  if (!/^@?[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(pkg) && !/^@[A-Za-z0-9][A-Za-z0-9._-]{0,255}\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(pkg)) return null
  return pkg
}

/**
 * 已核实破坏面清单（每条 = 一个已被 DSH alpha 移除/迁移的旧标识）。
 * 客户端按 `plugin.compat.break.<id>` 取词典文案；layer 决定扫描目标（manifest=package.json
 * 依赖键与 dsh 字段，code=入口文件非注释文本）。
 */
export const COMPAT_BREAKS = Object.freeze([
  {
    id: 'client-runtime',
    layer: 'manifest',
    match: '@deepseek-ai/dsh-client-runtime',
  },
  {
    id: 'sqlite-persistence',
    layer: 'manifest',
    match: '@deepseek-ai/dsh-session-persistence-sqlite',
  },
  {
    id: 'chat-hash',
    layer: 'code',
    match: 'Md3f7G_',
  },
  {
    id: 'stats-hash',
    layer: 'code',
    match: 'FJxK0a_',
  },
  {
    id: 'time-hover-root',
    layer: 'code',
    match: 'data-time-hover-root',
  },
])

const MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

/**
 * 状态机扫描：normal 态检查命中；行注释/块注释整段跳过；字符串态内检查命中
 * （className/选择器/querySelector 都以字符串出现），但字符串内的 CSS 块注释跳过
 * ——插件自己的 mobile CSS 注释里就写过旧哈希，注释提及必须不计。
 * @returns 命中的 break id 集合
 */

// 文档性后缀字符集：命中标识后紧跟这些字符的是「句子里的提及」而非代码引用——插件自己的
// 词典/提示文案会在解释检测项时写出旧标识（如「Md3f7G_，0.1.2-alpha.2 起漂移」），必须不
// 计为命中；真实引用（className 词干延续、引号/中括号收尾的完整标识）都不在此集。
const DOCUMENT_TRAIL = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef\s,;:!?()]/

export function scanCodeHits(text, breaks) {
  const hits = new Set()
  // 判定一次前缀命中的「引用形态」：紧跟字符是文档字符 → 提及（false），否则 → 引用。
  const inString = (mode) => mode !== 'normal' && mode !== 'line' && mode !== 'block'
  const isReferenceAt = (text, i, match) => {
    if (!text.startsWith(match, i)) return false
    const next = text[i + match.length]
    if (next === undefined || DOCUMENT_TRAIL.test(next)) return false
    return true
  }
  const tryHit = (text, i) => {
    for (const b of breaks) if (!hits.has(b.id) && isReferenceAt(text, i, b.match)) hits.add(b.id)
  }
  const n = text.length
  let i = 0
  let mode = 'normal'
  while (i < n) {
    const ch = text[i]
    if (mode === 'line') {
      if (ch === '\n') mode = 'normal'
      i += 1
      continue
    }
    if (mode === 'block') {
      if (ch === '*' && text[i + 1] === '/') {
        mode = 'normal'
        i += 2
      } else i += 1
      continue
    }
    if (inString(mode)) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === mode) {
        mode = 'normal'
        i += 1
        continue
      }
      // 字符串内的 CSS 块注释（styleTag 文本等里的注释提及）
      if (ch === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2)
        if (end === -1) {
          i = n
          continue
        }
        i = end + 2
        continue
      }
      tryHit(text, i)
      i += 1
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      mode = 'line'
      i += 2
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      mode = 'block'
      i += 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      mode = ch
      i += 1
      continue
    }
    tryHit(text, i)
    i += 1
  }
  return hits
}

/** manifest 层命中：依赖键集合 + dsh 字段（dsh.client.inject 是插件浏览器供应商声明处）。 */
export function collectManifestHits(pkg, breaks) {
  const hits = new Set()
  const fragments = []
  for (const field of MANIFEST_FIELDS) {
    const obj = pkg[field]
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) fragments.push(...Object.keys(obj))
  }
  if (pkg.dsh !== undefined) fragments.push(JSON.stringify(pkg.dsh))
  const haystack = JSON.stringify(fragments)
  for (const b of breaks) if (!hits.has(b.id) && haystack.includes(b.match)) hits.add(b.id)
  return hits
}

/**
 * 包入口文件解析：exports['./client'] / exports['.'] / main / index.js 兜底。
 * 只接受包目录内的相对路径（拒绝绝对路径与 .. 段）；目录形态追加 index.js。
 */
export function packageEntryFiles(pkgDir, pkg) {
  const files = []
  const push = (rel) => {
    if (typeof rel !== 'string' || rel === '' || rel.startsWith('/') || rel.split('/').some((segment) => segment === '..')) return
    let target = resolve(pkgDir, rel)
    if (!target.startsWith(pkgDir)) return
    try {
      if (statSync(target).isDirectory()) target = join(target, 'index.js')
      if (statSync(target).isFile()) files.push(target)
    } catch (_) {}
  }
  const exportsField = pkg.exports
  if (exportsField !== null && typeof exportsField === 'object' && !Array.isArray(exportsField)) {
    const pick = (spec) => {
      if (typeof spec === 'string') return spec
      if (spec !== null && typeof spec === 'object') return spec.default ?? spec.import ?? spec.require
      return undefined
    }
    push(pick(exportsField['./client']))
    push(pick(exportsField['.']))
  }
  push(pkg.main)
  if (files.length === 0) push('index.js')
  return files
}

/** 进程级扫描缓存：moduleName → scanPluginCompatibility 结果。 */
const SCAN_CACHE = new Map()

/**
 * 扫描单个插件包（纯函数，测试可注入 requireFn 与选项）。
 *
 * 输出分级（用户实测「声明了但没使用」后定稿——官方 client module loader 对 dsh.client.inject
 * 里缺失的供应商是静默跳过（arriveGraphRow 对 graphRows.get() === undefined 直接 continue），
 * 因此 manifest 命中的危害取决于插件代码是否真的引用了该标识）：
 *   - hits：真引用（code 层命中，或 manifest 标识在入口代码中被引用）→ “可能不兼容”；
 *   - declaredOnly：manifest 声明了已移除标识、但入口代码零引用 → 无害残留，仅提醒作者清理；
 *   - unknown：包不可解析/入口缺失/超限。
 *
 * @param requireFn createRequire 替身（resolve `${pkg}/package.json`）
 * @param moduleName loader 条目模块说明符
 * @param options.maxFileBytes 单入口文件上限（默认 4 MiB）
 * @returns { hits: string[], declaredOnly: string[], unknown: string | null, files: number, bytes: number }
 */
export function scanPluginCompatibility(requireFn, moduleName, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? 4 * 1024 * 1024
  const pkgName = packageNameOf(moduleName)
  if (pkgName === null) return { hits: [], declaredOnly: [], unknown: 'unresolved', files: 0, bytes: 0 }
  let pkgPath
  try {
    pkgPath = requireFn(`${pkgName}/package.json`)
  } catch (_) {
    // exports 字段未导出 './package.json' 的包：回退主入口（exports['.']/main）定位包根。
    try {
      pkgPath = join(dirname(requireFn(pkgName)), 'package.json')
    } catch (_) {
      return { hits: [], declaredOnly: [], unknown: 'unresolved', files: 0, bytes: 0 }
    }
  }
  const pkgDir = dirname(pkgPath)
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (_) {
    return { hits: [], declaredOnly: [], unknown: 'unresolved', files: 0, bytes: 0 }
  }
  const manifestBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'manifest')
  const codeBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'code')
  const declaredOnly = [...collectManifestHits(pkg, manifestBreaks)]
  const hits = []
  const files = packageEntryFiles(pkgDir, pkg)
  let bytes = 0
  for (const file of files) {
    let text
    try {
      const info = statSync(file)
      if (info.size > maxFileBytes) return { hits, declaredOnly, unknown: 'too-large', files, bytes }
      bytes += info.size
      text = readFileSync(file, 'utf8')
    } catch (_) {
      continue
    }
    // manifest 层复核：供应商被真实 require/import 调用（调用形态，见 manifestCallRefs）才升级为
    // 真引用；字符串化的 `require(\"...\")` 示例与文档提及留在 declaredOnly。
    if (declaredOnly.length > 0) {
      for (const id of manifestCallRefs(text, manifestBreaks)) {
        if (hits.indexOf(id) === -1) hits.push(id)
        const at = declaredOnly.indexOf(id)
        if (at !== -1) declaredOnly.splice(at, 1)
      }
    }
    // code 层照旧：状态机剥注释 + 引用形态判定（className/选择器在字符串内也算引用）。
    if (codeBreaks.some((b) => text.includes(b.match))) {
      for (const id of scanCodeHits(text, codeBreaks)) if (hits.indexOf(id) === -1) hits.push(id)
    }
  }
  return { hits, declaredOnly, unknown: hits.length === 0 && declaredOnly.length === 0 && files.length === 0 ? 'missing-entry' : null, files: files.length, bytes }
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * manifest 层供应商的「真实调用」复核：包名以 `require('…')` / `require("…")` /
 * `import('…')` / `import "…"` / `from "…"` 形态出现才算代码引用。引号前必须不是反斜杠
 * ——被字符串化的文档/迁移示例写的是 `require(\"…\")`（引号带转义，dsh-dream-skin 实证），
 * 真调用不会加反斜杠。
 * @returns 命中的 manifest break id 列表
 */
export function manifestCallRefs(text, manifestBreaks) {
  const found = []
  for (const b of manifestBreaks) {
    const re = new RegExp(`(?:require\\s*\\(\\s*|\\bimport\\s*(?:\\(\\s*)?|\\bfrom\\s+|\\bimport\\s+)(?<!\\\\)['"]${escapeRegex(b.match)}['"]`)
    if (re.test(text)) found.push(b.id)
  }
  return found
}

/**
 * 收集启用插件的兼容性扫描结果（顺序 = loader 条目序，稳定可测）。
 * @param ctx 宿主插件上下文（ctx.get('loader')）
 * @param options 透传 scanPluginCompatibility 选项（requireFn/maxFileBytes）与缓存开关（noCache）
 * @returns { available, scanned, issues: [{moduleName, breaks[]}], declaredOnly: [{moduleName, breaks[]}], unknown: [{moduleName, reason}] }
 */
export async function collectPluginCompat(ctx, options = {}) {
  const loader = ctx.get('loader')
  if (loader === undefined) return { available: false, scanned: 0, issues: [], declaredOnly: [], unknown: [] }
  let requireFn = options.requireFn
  if (typeof requireFn !== 'function') {
    const baseUrl = typeof loader.ctx?.baseUrl === 'string' && loader.ctx.baseUrl.length > 0
      ? loader.ctx.baseUrl
      : typeof ctx.baseUrl === 'string' && ctx.baseUrl.length > 0
        ? ctx.baseUrl
        : undefined
    // 必须是 .resolve 而非直接 require：require 会加载求值模块，对 JSON 返回对象而非路径。
    const baseRequire = baseUrl === undefined ? createRequire(import.meta.url) : createRequire(baseUrl)
    requireFn = (specifier) => baseRequire.resolve(specifier)
  }
  const issues = []
  const declaredOnly = []
  const unknown = []
  let scanned = 0
  for (const entry of loader.entries()) {
    if (entry?.options?.group === true) continue
    const moduleName = entry?.options?.name
    if (typeof entry?.id !== 'string' || typeof moduleName !== 'string') continue
    if (entry.disabled === true) continue
    scanned += 1
    let result
    if (options.noCache === true) {
      result = scanPluginCompatibility(requireFn, moduleName, options)
    } else {
      const cached = SCAN_CACHE.get(moduleName)
      if (cached !== undefined) result = cached
      else {
        result = scanPluginCompatibility(requireFn, moduleName, options)
        SCAN_CACHE.set(moduleName, result)
      }
    }
    if (result.unknown !== null) {
      unknown.push({ moduleName, reason: result.unknown })
    } else {
      if (result.hits.length > 0) issues.push({ moduleName, breaks: result.hits })
      if (result.declaredOnly.length > 0) declaredOnly.push({ moduleName, breaks: result.declaredOnly })
    }
  }
  return { available: true, scanned, issues, declaredOnly, unknown }
}

/**
 * 聚合为诊断检查项（追加在 checks 尾部）。detail 四段 `scanned:broken:declaredOnly:unknown`，
 * 客户端解析；broken>0 → warning（「可能不兼容」是风险提示，不是已损坏的 error）；
 * 仅 declaredOnly（声明残留、代码未引用，官方 loader fail-open 无害）不改变状态，只在摘要提及。
 */
export function pluginCompatCheckItem(report) {
  return {
    id: 'plugin-compat',
    status: report.issues.length > 0 ? 'warning' : 'ok',
    detail: `${report.scanned}:${report.issues.length}:${report.declaredOnly.length}:${report.unknown.length}`,
  }
}