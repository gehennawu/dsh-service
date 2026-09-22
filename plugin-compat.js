// Host deep module: plugin compatibility scan against DSH alpha breakage (v1.3).
//
// 为什么不用 peerDependencies 判定（用户点名否掉的方向）：多数第三方插件根本不写 DSH peer
// 声明，写了也未必反映真实兼容性。真实信号是「插件代码/清单是否依赖了已被 DSH alpha 移除或
// 变更的接口」——破坏面清单来自 docs/research/ 的各版本 plugin-impact 报告（0.1.2-alpha.{1,2,3}、
// 0.1.6-alpha.2、0.1.7-alpha.1）与 AGENTS.md 已核实的拆包事实：
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

function isSemverIdentifier(value) {
  if (value.length === 0) return false
  return [...value].every((char) => (char >= '0' && char <= '9') || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char === '-')
}

function isNumericSemverIdentifier(value) {
  return value.length > 0 && [...value].every((char) => char >= '0' && char <= '9')
}

export function parseSemver(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const buildParts = trimmed.split('+')
  if (buildParts.length > 2 || (buildParts.length === 2 && !buildParts[1].split('.').every((part) => isSemverIdentifier(part)))) return null
  const versionPart = buildParts[0]
  const dashIndex = versionPart.indexOf('-')
  const corePart = dashIndex === -1 ? versionPart : versionPart.slice(0, dashIndex)
  const prereleasePart = dashIndex === -1 ? '' : versionPart.slice(dashIndex + 1)
  if (dashIndex !== -1 && prereleasePart.length === 0) return null
  const core = corePart.split('.')
  if (core.length !== 3 || !core.every((part) => isNumericSemverIdentifier(part) && (part.length === 1 || !part.startsWith('0')))) return null
  const prerelease = prereleasePart === '' ? [] : prereleasePart.split('.')
  if (!prerelease.every((part) => isSemverIdentifier(part) && !(isNumericSemverIdentifier(part) && part.length > 1 && part.startsWith('0')))) return null
  return { major: Number(core[0]), minor: Number(core[1]), patch: Number(core[2]), prerelease }
}

export function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    if (index >= a.prerelease.length) return -1
    if (index >= b.prerelease.length) return 1
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === rightPart) continue
    const leftNumeric = /^[0-9]+$/.test(leftPart)
    const rightNumeric = /^[0-9]+$/.test(rightPart)
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftPart > rightPart ? 1 : -1
  }
  return 0
}

/**
 * 已核实破坏面清单（每条 = 一个已被 DSH alpha 移除/迁移的旧标识）。
 * 客户端按 `plugin.compat.break.<id>` 取词典文案；layer 决定扫描目标（manifest=package.json
 * 依赖键与 dsh 字段，code=入口文件非注释文本）。
 *
 * since: 该破坏面首次生效的 DSH 版本。
 * kind: 破坏类型（package-removed / slot-retired / method-removed / hash-migrated / event-removed / attribute-removed）。
 *
 * `severity: 'info'`（可选，默认 warning）把该条降为提示档：命中的插件仍逐条列出，但走
 * 蓝色提示行、不把检查项拉成 warning（也就不进概览可行动项）。只用于「旧标识仍被注册但
 * 插件照常运行、对使用者无功能损失」的退役接口——如为旧宿主保留的退役槽位注册。
 */
export const COMPAT_BREAKS = Object.freeze([
  {
    id: 'client-runtime',
    layer: 'manifest',
    match: '@deepseek-ai/dsh-client-runtime',
    since: '0.1.2-alpha.2',
    kind: 'package-removed',
  },
  {
    id: 'sqlite-persistence',
    layer: 'manifest',
    match: '@deepseek-ai/dsh-session-persistence-sqlite',
    since: '0.1.2-alpha.3',
    kind: 'package-removed',
  },
  {
    id: 'code-runtime',
    layer: 'manifest',
    match: '@deepseek-ai/dsh-code-runtime',
    since: '0.1.6-alpha.1',
    kind: 'package-removed',
  },
  {
    id: 'e2b-runtime',
    layer: 'manifest',
    match: '@deepseek-ai/dsh-e2b',
    since: '0.1.6-alpha.1',
    kind: 'package-removed',
  },
  {
    id: 'session-start-event',
    layer: 'code',
    match: 'agent/session-start',
    since: '0.1.6-alpha.1',
    kind: 'event-removed',
  },
  {
    id: 'chat-hash',
    layer: 'code',
    match: 'Md3f7G_',
    since: '0.1.2-alpha.2',
    kind: 'hash-migrated',
  },
  {
    id: 'stats-hash',
    layer: 'code',
    match: 'FJxK0a_',
    since: '0.1.2-alpha.2',
    kind: 'hash-migrated',
  },
  {
    id: 'time-hover-root',
    layer: 'code',
    match: 'data-time-hover-root',
    since: '0.1.2-alpha.2',
    kind: 'attribute-removed',
  },
  {
    // 0.1.6-alpha.2 退役设置页槽位：第三方注册它则配置卡片在新插件页不再渲染。
    // selfExempt：本插件为双版本兼容在自身保留该槽位注册（老宿主仍需），自证扫描豁免其命中；
    // 第三方插件命中仍逐条报告（研究 §10：dsh-v0.1.6-alpha.2-plugin-impact.md）。
    // severity info：退役槽位只是配置入口搬迁——注入不生效、插件本体照常运行，既非代码错误
    // 也非挂载风险，故走蓝色提示行且不把检查项拉成 warning（与「仅声明残留」同档）。
    id: 'settings-plugin-item',
    layer: 'code',
    match: 'settings.plugin.item',
    since: '0.1.6-alpha.2',
    kind: 'slot-retired',
    selfExempt: true,
    severity: 'info',
  },
  {
    // 0.1.6-alpha.2 移除 ISessions 命令式打开方法：第三方调用它则详情页「打开」点击无响应
    // （官方改由 ui-workspace 的 openSession 承载）。call: true = 方法名条目，真实引用以
    // 调用括号结尾——`sessions.open(` 算引用，`sessions.openBar` 前缀误报与词典/提示提及
    // 都不算。已知局限：可选用链 `sessions?.open` 不含该串，扫描不到（研究 §10 建议形态）。
    id: 'sessions-open-method',
    layer: 'code',
    match: 'sessions.open',
    call: true,
    since: '0.1.6-alpha.2',
    kind: 'method-removed',
  },
  {
    // 0.1.7-alpha.1 移除客户端设置服务 settingsScope，官方配置面改由 configForms 承载
    // （研究 §2：dsh-v0.1.7-alpha.1-plugin-impact.md）：静态 inject 或直接绑定它的客户端半
    // 在新版宿主上整个客户端激活挂起，面板不可用（P0，不只是「开关不可保存」）。
    // kind 用新值 service-removed：整只客户端服务被移除，不是单个方法或槽位。
    // selfExempt（警示档运行时豁免，见 collectPluginCompat）：本插件设置门面按能力探测动态
    // 接入两个服务（createFeatureSettings → configForms / settingsScope / 内存兜底），老宿主
    // 仍需旧面；探测形态 `ctx.get('settingsScope')` 与硬依赖在文本扫描上不可区分，豁免仅对
    // 本插件自身生效，第三方命中照常上报。
    id: 'settings-scope',
    layer: 'code',
    match: 'settingsScope',
    since: '0.1.7-alpha.1',
    kind: 'service-removed',
    selfExempt: true,
  },
  {
    // 0.1.7-alpha.1 宿主 settings 服务重构为 SettingsForms，移除旧 register（研究 §2.2 S2）：
    // 命名空间注册失效（异常被插件 catch 则静默），功能开关停留在默认值、无法持久化。
    // call: true = 方法名条目（同 sessions-open-method）。已知局限：`settings?.register` 守卫
    // 形态不含该串扫不到——守卫本身是正确形态，漏报可接受。
    // selfExempt：本插件宿主半保留旧协议守卫分支（老宿主权威路径，新宿主走 Config 双源叠放）。
    id: 'settings-register',
    layer: 'code',
    match: 'settings.register',
    call: true,
    since: '0.1.7-alpha.1',
    kind: 'method-removed',
    selfExempt: true,
  },
  {
    // 同上：settings.get 一并移除（研究 §5.1 M1）——读宿主命名空间配置（如 llm-pi-ai 的
    // 自定义渠道）拿到空值，功能静默退化。词形较通用（本地 Map/缓存对象的同形调用会误报），
    // 但真实破坏面（配置读取退化）值得上报；误报由「DSH ≥ 0.1.7-alpha.1」徽标与文案引导
    // 人工复核，与 sessions-open-method 的粗粒度取舍同类。
    // selfExempt：本插件 readLlmProviders 的旧源读取分支（settings.get 存在才走）。
    id: 'settings-get',
    layer: 'code',
    match: 'settings.get',
    call: true,
    since: '0.1.7-alpha.1',
    kind: 'method-removed',
    selfExempt: true,
  },
])

/** 本插件包名：双版本兼容的运行时自证豁免只对 loader 里的这个条目生效。 */
const SELF_PACKAGE = '@gehennawu/dsh-service'

/**
 * 警示档 selfExempt 条目（settings-scope / settings-register / settings-get）：本插件自身的
 * 能力探测与守卫调用是刻意保留的旧面接入，不是破坏面命中，collectPluginCompat 扫到
 * SELF_PACKAGE 自己时从 hits（可能不兼容档）剔除，避免诊断页把本插件标成「可能不兼容」、
 * 检查项常挂 warning。提示档 selfExempt（settings-plugin-item，severity info）不豁免——
 * 本插件自己的蓝色提示行正是给使用者的解释（2026-09-19 真机验证口径）。SCAN_CACHE 缓存
 * 原始扫描结果，豁免在收集层做，纯函数 scanPluginCompatibility 保持无状态。
 */
const SELF_EXEMPT_HITS = new Set(
  COMPAT_BREAKS.filter((b) => b.selfExempt === true && b.severity !== 'info').map((b) => b.id),
)

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
  // 判定一次前缀命中的「引用形态」：默认（文档性后缀规则）紧跟字符是文档字符 → 提及（false），
  // 否则 → 引用；方法名条目（call: true）反其道——只有紧跟调用括号 `(` 才算引用（方法调用），
  // 标识符后跟字母的前缀误报（`sessions.openBar`）与「句子提及（」都不算。
  const inString = (mode) => mode !== 'normal' && mode !== 'line' && mode !== 'block'
  const isReferenceAt = (text, i, b) => {
    const match = b.match
    if (!text.startsWith(match, i)) return false
    const next = text[i + match.length]
    if (b.call === true) return next === '('
    if (next === undefined || DOCUMENT_TRAIL.test(next)) return false
    return true
  }
  const tryHit = (text, i) => {
    for (const b of breaks) if (!hits.has(b.id) && isReferenceAt(text, i, b)) hits.add(b.id)
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
 *   - softHits：命中来自 `severity: 'info'` 的条目 → 退役接口提示（蓝色、不拉高检查项）；
 *   - declaredOnly：manifest 声明了已移除标识、但入口代码零引用 → 无害残留，仅提醒作者清理；
 *   - unknown：包不可解析/入口缺失/超限。
 *
 * @param requireFn createRequire 替身（resolve `${pkg}/package.json`）
 * @param moduleName loader 条目模块说明符
 * @param options.maxFileBytes 单入口文件上限（默认 4 MiB）
 * @returns { hits: string[], softHits: string[], declaredOnly: string[], unknown: string | null, files: number, bytes: number }
 */
export function scanPluginCompatibility(requireFn, moduleName, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? 4 * 1024 * 1024
  const pkgName = packageNameOf(moduleName)
  if (pkgName === null) return { hits: [], softHits: [], declaredOnly: [], unknown: 'unresolved', files: 0, bytes: 0 }
  let pkgPath
  try {
    pkgPath = requireFn(`${pkgName}/package.json`)
  } catch (_) {
    // exports 字段未导出 './package.json' 的包：回退主入口（exports['.']/main）定位包根。
    try {
      pkgPath = join(dirname(requireFn(pkgName)), 'package.json')
    } catch (_) {
      return { hits: [], softHits: [], declaredOnly: [], unknown: 'unresolved', files: 0, bytes: 0 }
    }
  }
  const pkgDir = dirname(pkgPath)
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (_) {
    return { hits: [], softHits: [], declaredOnly: [], unknown: 'unresolved', files: 0, bytes: 0 }
  }
  const manifestBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'manifest')
  const codeBreaks = COMPAT_BREAKS.filter((b) => b.layer === 'code')
  // 提示档条目（severity info）单列：命中照旧逐条上报，只是不升级成「可能不兼容」。
  const softIds = new Set(COMPAT_BREAKS.filter((b) => b.severity === 'info').map((b) => b.id))
  const declaredOnly = [...collectManifestHits(pkg, manifestBreaks)]
  const hits = []
  const softHits = []
  const record = (id) => {
    const bucket = softIds.has(id) ? softHits : hits
    if (bucket.indexOf(id) === -1) bucket.push(id)
  }
  const files = packageEntryFiles(pkgDir, pkg)
  let bytes = 0
  for (const file of files) {
    let text
    try {
      const info = statSync(file)
      if (info.size > maxFileBytes) return { hits, softHits, declaredOnly, unknown: 'too-large', files, bytes }
      bytes += info.size
      text = readFileSync(file, 'utf8')
    } catch (_) {
      continue
    }
    // manifest 层复核：供应商被真实 require/import 调用（调用形态，见 manifestCallRefs）才升级为
    // 真引用；字符串化的 `require(\"...\")` 示例与文档提及留在 declaredOnly。
    if (declaredOnly.length > 0) {
      for (const id of manifestCallRefs(text, manifestBreaks)) {
        record(id)
        const at = declaredOnly.indexOf(id)
        if (at !== -1) declaredOnly.splice(at, 1)
      }
    }
    // code 层照旧：状态机剥注释 + 引用形态判定（className/选择器在字符串内也算引用）。
    if (codeBreaks.some((b) => text.includes(b.match))) {
      for (const id of scanCodeHits(text, codeBreaks)) record(id)
    }
  }
  return {
    hits,
    softHits,
    declaredOnly,
    unknown: hits.length === 0 && softHits.length === 0 && declaredOnly.length === 0 && files.length === 0 ? 'missing-entry' : null,
    files: files.length,
    bytes,
  }
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

export function enrichBreak(breakId, dshVersion) {
  const meta = COMPAT_BREAKS.find((b) => b.id === breakId)
  if (!meta) return { id: breakId, since: 'unknown', kind: 'unknown', severity: 'warning', active: true }
  const active = dshVersion && dshVersion !== 'unknown' ? compareSemver(dshVersion, meta.since) >= 0 : true
  return {
    id: meta.id,
    since: meta.since,
    kind: meta.kind,
    severity: meta.severity || 'warning',
    active,
  }
}

/**
 * 收集启用插件的兼容性扫描结果（顺序 = loader 条目序，稳定可测）。
 * @param ctx 宿主插件上下文（ctx.get('loader')）
 * @param options 透传 scanPluginCompatibility 选项（requireFn/maxFileBytes）与缓存开关（noCache）
 * @returns { available, scanned, issues: [{moduleName, breaks[]}], soft: [{moduleName, breaks[]}], declaredOnly: [{moduleName, breaks[]}], unknown: [{moduleName, reason}] }
 */
export async function collectPluginCompat(ctx, options = {}) {
  const loader = ctx.get('loader')
  if (loader === undefined) return { available: false, scanned: 0, issues: [], soft: [], declaredOnly: [], unknown: [] }
  // 真机 ctx 是服务代理：未提供服务的属性直读（ctx.dshVersion 之类）会抛
  // cannot get property "<prop>" without inject，让整个检查被降级 unavailable。
  // 本函数只允许 ctx.get('loader') 与 ctx.baseUrl（Context 实体字段，恒存在）。
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
  const soft = []
  const declaredOnly = []
  const unknown = []
  let scanned = 0
  for (const entry of loader.entries()) {
    if (entry?.options?.group === true) continue
    const moduleName = entry?.options?.name
    if (typeof entry?.id !== 'string' || typeof moduleName !== 'string') continue
    if (entry.disabled === true) continue
    // 官方内置插件跳过且不计 scanned：@deepseek-ai/* 随 DSH 发行版统一构建分发，
    // 内部版本天生自洽，不是第三方扩展；且部分大体积内置组件（如 documentpreview 6.5MB）
    // 会误触发单文件扫描上限。
    if (options.includeOfficial !== true && moduleName.startsWith('@deepseek-ai/')) continue
    // 无法形成合法包名的条目跳过且不计 scanned：`cordis:include` 这类 Cordis 内建声明名、
    // 相对路径/`file:` 形态不是可扫描的 npm 插件（没有清单可查），不该渲染「未能扫描」提示。
    if (packageNameOf(moduleName) === null) continue
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
      // 警示档自证豁免只作用于本插件自己（见 SELF_EXEMPT_HITS 注释）；第三方同名命中不受影响。
      const hits = moduleName === SELF_PACKAGE ? result.hits.filter((id) => !SELF_EXEMPT_HITS.has(id)) : result.hits
      if (hits.length > 0) issues.push({ moduleName, breaks: hits })
      if (result.softHits.length > 0) soft.push({ moduleName, breaks: result.softHits })
      if (result.declaredOnly.length > 0) declaredOnly.push({ moduleName, breaks: result.declaredOnly })
    }
  }
  return { available: true, scanned, issues, soft, declaredOnly, unknown }
}

/**
 * 聚合为诊断检查项（追加在 checks 尾部）。detail 五段
 * `scanned:broken:declaredOnly:unknown:soft`——前四段与旧口径逐字相同（旧客户端按四段读，
 * 多出的第五段被忽略），soft 追加在尾部保证前后兼容；客户端解析。
 *   - broken>0 → warning（「可能不兼容」是风险提示，不是已损坏的 error）；
 *   - 仅 soft（退役接口，插件照常运行）→ info：蓝色提示行，不拉高 overall、不进概览可行动项；
 *   - 仅 declaredOnly（声明残留、代码未引用，官方 loader fail-open 无害）与 unknown 不改变状态，
 *     只在摘要提及。
 */
export function pluginCompatCheckItem(report) {
  const soft = report.soft ?? []
  const issues = report.issues ?? []
  const declaredOnly = report.declaredOnly ?? []
  const unknown = report.unknown ?? []
  return {
    id: 'plugin-compat',
    status: issues.length > 0 ? 'warning' : soft.length > 0 ? 'info' : 'ok',
    detail: `${report.scanned}:${issues.length}:${declaredOnly.length}:${unknown.length}:${soft.length}`,
  }
}