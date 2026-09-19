/**
 * 客户端半源码清单的 AST 词法检查。
 *
 * 背景：客户端半不是一个模块，而是**一个** factory 作用域被切成 N 个连续分片
 * （清单在 scripts/client-source.mjs）。分片只靠「同一作用域内声明可见」彼此连接：
 *   - 分片工厂（`function createXxx(...) { ... return { ... } }`）用返回值把内部名字
 *     交回给 apply —— 少返回一个名字，apply 侧的解构就是 undefined，而拼接后的文本
 *     依然语法合法，`node --check`、terser 与构建全都不报错；异步 helper 尤其隐蔽，
 *     因为缺失的 helper 要等实际调用时才报错；
 *   - 反向地，apply 里若引用了只存在于分片**内部**的私有名字，拼接后它会被解析成
 *     全局引用（浏览器里是 ReferenceError），同样是静默的。
 * 两种失效形态都只在运行期暴露，且往往被 mock 测试掩盖。本脚本把它们变成构建期事实。
 *
 * 实现要点（为什么用 terser 而不是自己写词法分析器）：
 *   terser 已是 devDependency，其 `minify(src, { compress:false, mangle:false,
 *   format:{ ast:true, code:false } })` 返回完整 AST，`ast.figure_out_scope({})` 会填好
 *   每个 symbol 的 `thedef`（SymbolDef）。于是：
 *     - 字符串 / 注释 / 属性名 / 属性访问不产生 AST_SymbolRef —— 天然不误报；
 *     - 遮蔽（shadowing）由 `thedef` 精确定位，不是文本猜测；
 *     - 未声明标识符由 terser 自己收进 `toplevel.globals`，不是我们的近似。
 *   `figure_out_scope` 是 terser 内部 API；升级 terser 时必须重跑本检查器的回归测试。
 *   本脚本读取 `thedef` / `scope` / `globals`，不运行压缩器。
 *
 * 检查项：
 *   A. 未解析标识符（自由名）必须命中显式白名单；未登记即报错——新增浏览器全局或
 *      新增构建期内联的 MODEL_ICON_* 名字必须显式登记，不能悄悄漏过。
 *   B. 分片工厂的返回面 vs apply 侧解构面：解构了但工厂从不返回的键 → 报错。
 *      工厂用动态键、条件返回、返回外部变量时判定为「不透明」并跳过：只报确定缺失的。
 *   C. 工厂内部私有名（未出现在任何返回面）被别处直接引用 → 报错（拼接后是全局）。
 *   D. 已在某工厂返回面里的名字被当作自由名引用 → 报错（必须经由该工厂返回值）。
 *
 * 接口刻意保持极小：`checkClientSource(source, options)` 不读盘、不打印、不退出，
 * 返回结构化结果；CLI 入口见本文件末尾，构建脚本按需 import 上面的函数。
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { minify } from 'terser'

import { ROOT, readClientSource } from './client-source.mjs'

/**
 * 允许作为自由名（global ref）出现并正常解析的名字白名单——**当前恰好是全部在用的集合**，
 * 不是「标准全局大表」。test/client-source.test.js 断言它与实际使用的自由名逐一相等，
 * 因此它无法悄悄长成一张什么都放行的清单。
 *
 * 分两类，都必须**显式登记**：
 *   1. 语言内建与浏览器宿主 API（window、document、fetch 等客户端半直接使用的全局）；
 *   2. 构建期内联的名字——scripts/build-client.mjs 把 src/model-icons.generated.js 的
 *      三个声明插进 factory 作用域顶部，所以分片源码里引用它们此刻是「自由名」，
 *      拼接内联后才变成局部绑定。它们属于白名单，而不是检查的例外。
 *
 * 新增一个自由名（例如换用 navigator）就必须改这里：这正是本检查的意图——让
 *「客户端半多了一个自由名字」成为一次显式决定，而不是静默通过。
 */
export const ALLOWED_GLOBALS = Object.freeze([
  // ── 语言内建 ──
  'Array', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object',
  'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'Uint8Array', 'undefined',
  'decodeURIComponent', 'encodeURIComponent',
  // ── 定时器 / 调度 ──
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame',
  // ── 网络 / 编码 / 宿主状态 ──
  'fetch', 'btoa', 'URLSearchParams', 'console', 'localStorage',
  // ── DOM / 浏览器宿主 ──
  'window', 'document', 'getComputedStyle', 'MutationObserver', 'ResizeObserver',
  'Notification', 'FileReader', 'Node',
  // ── 构建期内联（src/model-icons.generated.js，见 scripts/build-client.mjs）──
  'MODEL_ICON_DATA', 'MODEL_ICON_PROVIDERS', 'MODEL_ICON_PREFIXES',
])

/** 只对以此开头的函数做「返回面 vs 解构面」检查：分片工厂的命名约定。 */
export const FACTORY_NAME_PATTERN = /^create[A-Z]/

// ── terser AST 小工具 ────────────────────────────────────────────────────────

/** 结构属性（作用域回边、位置信息）不参与遍历，否则会绕回祖先甚至死循环。 */
const NON_CHILD_PROPS = new Set([
  'start', 'end', 'flags', 'variables', 'enclosed', 'parent_scope', 'block_scope',
  'globals', 'thedef', 'scope', 'init', 'definition', 'orig', 'references',
])

const KIND_CACHE = new Map()
function kindOf(node) {
  let kind = KIND_CACHE.get(node.CTOR)
  if (!kind) {
    let cursor = node.CTOR
    let isScope = false
    let isLambda = false
    while (cursor) {
      if (cursor.TYPE === 'Scope') isScope = true
      if (cursor.TYPE === 'Lambda') isLambda = true
      cursor = cursor.BASE
    }
    kind = {
      isScope,
      isLambda,
      childProps: (node.CTOR.PROPS || []).filter((prop) => !NON_CHILD_PROPS.has(prop)),
    }
    KIND_CACHE.set(node.CTOR, kind)
  }
  return kind
}

/**
 * 迭代式前序遍历：返回面分析只看当前工厂的 return，跳过嵌套函数作用域。
 * 显式栈避免对源码树递归调用，并统一控制需要排除的作用域回边。
 *
 * @param {object} root 起始节点
 * @param {{ stopAtScopes?: boolean, skipProps?: string[] }} [options]
 */
function* walk(root, { stopAtScopes = false, skipProps = null } = {}) {
  const stack = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || !node.TYPE) continue
    if (stopAtScopes && node !== root && kindOf(node).isScope) continue
    yield node
    const props = kindOf(node).childProps
    for (let i = props.length - 1; i >= 0; i -= 1) {
      const prop = props[i]
      if (skipProps && skipProps.includes(prop)) continue
      const value = node[prop]
      if (Array.isArray(value)) {
        for (let j = value.length - 1; j >= 0; j -= 1) stack.push(value[j])
      } else {
        stack.push(value)
      }
    }
  }
}

/**
 * 对象字面量成员的静态键名；动态键（计算键、展开、方法简写之外的非静态形态）
 * 返回 null。展开（`...rest`）与计算键都属于「不透明」。
 */
function staticKeyOf(member) {
  if (member.TYPE !== 'ObjectKeyVal' && member.TYPE !== 'ObjectMethod' && member.TYPE !== 'ConciseMethod') {
    return null
  }
  const key = member.key
  if (typeof key === 'string') return key
  if (key && key.TYPE === 'String') return key.value
  return null
}

/** 对象字面量的全部键名；只要有非静态成员就返回 null（不透明，宁可不报）。 */
function staticKeysOf(objectNode) {
  const keys = new Set()
  for (const member of objectNode.properties) {
    const key = staticKeyOf(member)
    if (key === null) return null
    keys.add(key)
  }
  return keys
}

/**
 * 工厂返回面：所有 `return` 的对象字面量（或指向某个对象常量的标识符）的静态键名并集。
 * 任何形态不确定的 return（裸 return、条件表达式、调用结果、含动态键的对象、少一个
 * return 分支）都让整个函数判定为不透明并返回 null —— 只有「确定缺失」才进报错路径。
 */
function returnedKeysOf(fnNode, objectsByDefId) {
  const returns = []
  for (const node of walk(fnNode, { stopAtScopes: true })) {
    if (node.TYPE === 'Return') returns.push(node)
  }
  if (returns.length === 0) return null
  const sets = []
  for (const ret of returns) {
    if (!ret.value) return null
    let keys = null
    if (ret.value.TYPE === 'Object') keys = staticKeysOf(ret.value)
    else if (ret.value.TYPE === 'SymbolRef') {
      const object = objectsByDefId.get(ret.value.thedef?.id)
      if (object) keys = staticKeysOf(object)
    }
    if (keys === null) return null
    sets.push(keys)
  }
  const union = new Set()
  for (const set of sets) for (const key of set) union.add(key)
  return union
}

/** 建立两张表：可调用的函数节点、可返回的对象常量节点（按 SymbolDef.id 索引）。 */
function collectDefinitions(ast) {
  const fnByDefId = new Map()
  const objectsByDefId = new Map()
  for (const node of walk(ast)) {
    if (node.TYPE === 'Defun' && node.name?.thedef) {
      fnByDefId.set(node.name.thedef.id, node)
      continue
    }
    if (node.TYPE === 'VarDef' && node.name?.thedef && node.value) {
      if (kindOf(node.value).isLambda) fnByDefId.set(node.name.thedef.id, node.value)
      else if (node.value.TYPE === 'Object') objectsByDefId.set(node.name.thedef.id, node.value)
    }
  }
  return { fnByDefId, objectsByDefId }
}

/** 工厂自己作用域内直接声明的名字（不看嵌套作用域、不看形参）。 */
function privateNamesOf(fnNode) {
  const names = new Set()
  for (const node of walk(fnNode, { stopAtScopes: true, skipProps: ['argnames'] })) {
    if (node === fnNode) continue
    if (!node.name || typeof node.name !== 'string' || !node.thedef) continue
    if (!/Symbol(Defun|Const|Let|Var|Class|DefClass|Catch|Using)$/.test(node.TYPE)) continue
    if (node.thedef.scope !== fnNode) continue
    names.add(node.name)
  }
  return names
}

// ── 主检查 ──────────────────────────────────────────────────────────────────

/**
 * 对拼接后的客户端源码跑全部词法检查。不读盘、不打印、不抛业务错误。
 *
 * @param {string} source scripts/client-source.mjs 拼接出的源码
 * @param {{ allowedGlobals?: Iterable<string>, files?: Array<{ file: string, start: number, end: number }> }} [options]
 *   `files` 为分片偏移表（build 侧提供），用于把报错定位成 `src/client/xxx.js:行号`。
 * @returns {Promise<{ ok: boolean, errors: string[], stats: object }>}
 */
export async function checkClientSource(source, options = {}) {
  if (typeof source !== 'string' || source === '') {
    throw new TypeError('checkClientSource requires a non-empty source string')
  }

  const allowed = options.allowedGlobals ? new Set(options.allowedGlobals) : new Set(ALLOWED_GLOBALS)
  const bounds = options.files ?? null
  // terser 的 `token.line` 是**拼接后**源码里的全局行号，不是分片内的行号：定位时必须
  // 减去该分片之前的行数（bounds 的 `line` 承载这一信息），否则报错会指到别处的行。
  const locate = (token) => {
    if (!token || typeof token.pos !== 'number') return 'unknown position'
    if (bounds) {
      for (const bound of bounds) {
        if (token.pos >= bound.start && token.pos < bound.end) {
          const line = typeof bound.line === 'number' ? token.line - bound.line : token.line
          return `${bound.file}:${line}`
        }
      }
    }
    return `line ${token.line}`
  }

  // 只用解析 + 作用域两步：不压缩、不混淆，AST 与源码一一对应。
  const result = await minify(source, {
    compress: false,
    mangle: false,
    format: { ast: true, code: false },
  })
  const ast = result.ast
  if (!ast || ast.TYPE !== 'Toplevel' || typeof ast.figure_out_scope !== 'function') {
    throw new Error('terser did not return a scoped AST; the AST API may have changed')
  }
  ast.figure_out_scope({})

  const { fnByDefId, objectsByDefId } = collectDefinitions(ast)
  const errors = []

  // 分片工厂表：返回面 + 私有名。
  const factories = new Map() // SymbolDef.id -> { name, node, keys, privateNames }
  for (const [defId, fnNode] of fnByDefId) {
    const name = fnNode.name?.name
    if (!name || !FACTORY_NAME_PATTERN.test(name)) continue
    factories.set(defId, { name, node: fnNode, keys: null, privateNames: null })
  }
  const returnedBy = new Map() // 返回面里的名字 -> 工厂名（只记首个）
  for (const factory of factories.values()) {
    factory.keys = returnedKeysOf(factory.node, objectsByDefId)
    factory.privateNames = privateNamesOf(factory.node)
    if (factory.keys) {
      for (const key of factory.keys) if (!returnedBy.has(key)) returnedBy.set(key, factory.name)
    }
  }

  // ── 自由名（global ref）收集 ─────────────────────────────────────────────
  const globalsUsed = new Map() // name -> 首次出现的节点
  let references = 0
  for (const node of walk(ast)) {
    if (node.TYPE !== 'SymbolRef') continue
    references += 1
    const def = node.thedef
    if (!def) {
      errors.push(`unresolved identifier "${node.name}" at ${locate(node.start)}`)
      continue
    }
    if (def.global && !globalsUsed.has(node.name)) globalsUsed.set(node.name, node)
  }

  // 工厂私有名索引：名字 -> 所属工厂（用于给出比「未知全局」更准的报错）。
  const privateOwner = new Map()
  for (const factory of factories.values()) {
    for (const name of factory.privateNames) {
      if (!privateOwner.has(name)) privateOwner.set(name, factory.name)
    }
  }

  // ── 检查 A / C / D：自由名归因 ───────────────────────────────────────────
  const unknownGlobals = []
  for (const [name, node] of globalsUsed) {
    if (allowed.has(name)) continue
    if (returnedBy.has(name)) {
      // D：是某工厂返回面里的名字，却被当自由名引用 —— 没走返回值。
      errors.push(
        `"${name}" at ${locate(node.start)} is returned by ${returnedBy.get(name)}() but referenced ` +
        `outside any factory binding — destructure it from ${returnedBy.get(name)}(...) instead`,
      )
      continue
    }
    if (privateOwner.has(name)) {
      // C：是某分片工厂的内部私有名 —— 拼接后成为全局，运行期 ReferenceError。
      errors.push(
        `"${name}" at ${locate(node.start)} is private to fragment factory ${privateOwner.get(name)}() ` +
        `and not part of its return value — it is unreachable from here`,
      )
      continue
    }
    unknownGlobals.push([name, node])
  }
  for (const [name, node] of unknownGlobals) {
    errors.push(
      `unknown global identifier "${name}" at ${locate(node.start)} — add it to ALLOWED_GLOBALS ` +
      `in scripts/check-client-source.mjs if it is an intentional browser global`,
    )
  }

  // ── 检查 B：解构面 ⊆ 工厂返回面 ──────────────────────────────────────────
  let destructureSites = 0
  for (const node of walk(ast)) {
    if (node.TYPE !== 'VarDef' || node.name?.TYPE !== 'Destructuring' || node.name.is_array) continue
    const call = node.value
    if (call?.TYPE !== 'Call' || call.expression?.TYPE !== 'SymbolRef') continue
    const factory = factories.get(call.expression.thedef?.id)
    if (!factory) continue
    destructureSites += 1
    if (!factory.keys) continue // 返回面不透明 → 不报
    for (const member of node.name.names) {
      const key = staticKeyOf(member)
      if (key === null || factory.keys.has(key)) continue
      errors.push(
        `${factory.name}() never returns "${key}", but ${locate(node.start)} destructures it — ` +
        `add it to the return object of the fragment that declares ${factory.name}`,
      )
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      references,
      globals: [...globalsUsed.keys()].sort(),
      factories: [...factories.values()].map((factory) => ({
        name: factory.name,
        returns: factory.keys ? factory.keys.size : null,
        privateNames: factory.privateNames.size,
      })),
      destructureSites,
    },
  }
}

/** 读清单拼接（附分片偏移表，让报错定位到源文件），再跑检查。 */
export async function checkClientSourceFromDisk() {
  const { source, files } = await readClientSource()
  return checkClientSource(source, { files: await clientSourceBounds(files, source.length) })
}

/**
 * 分片在拼接结果里的 UTF-16 字符偏移区间表：`[{ file, start, end, line }]`，`line` 是该分片首行
 * 之前的累计行数（terser 报全局行号，定位时要用它换算回分片内行号）。
 * 报错定位靠它把 token 偏移翻译回 `src/client/xxx.js:行号`；构建脚本复用同一份，
 * 避免「检查用的偏移」和「构建读到的源码」各自漂移。
 *
 * @param {string[]} files scripts/client-source.mjs 的清单顺序
 * @param {number} totalLength 拼接后的字符串长度（用于自校验）
 */
export async function clientSourceBounds(files, totalLength) {
  const bounds = []
  let offset = 0
  let line = 0
  for (const file of files) {
    const text = await readFile(resolve(ROOT, file), 'utf8')
    const end = offset + (text.endsWith('\n') ? text.length : text.length + 1)
    bounds.push({ file, start: offset, end, line })
    line += text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    offset = end
  }
  if (offset !== totalLength) {
    throw new Error(`fragment offsets (${offset}) do not match concatenated source (${totalLength})`)
  }
  return bounds
}

/**
 * CLI 包装：`npm run check:client` / `node scripts/check-client-source.mjs`。
 * 返回布尔而不是直接 exit，方便构建脚本复用同一份输出逻辑。
 */
export async function runClientSourceCheck({ log = console.log, error = console.error } = {}) {
  const { ok, errors, stats } = await checkClientSourceFromDisk()
  if (ok) {
    log(`check:client ok — ${stats.references} references, ${stats.factories.length} fragment factories, ${stats.globals.length} allowed globals`)
    return true
  }
  error(`check:client failed (${errors.length} finding${errors.length === 1 ? '' : 's'}):`)
  for (const message of errors) error(`  ✗ ${message}`)
  return false
}

// 直接执行时作为 CLI 运行（被 import 时不触发）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const ok = await runClientSourceCheck()
  process.exit(ok ? 0 : 1)
}
