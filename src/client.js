// Browser half of @gehennawu/dsh-service
// 设置面板「服务控制」：版本信息 + 检查更新 + 一键重启
window.__ModuleLoader__.load({
  id: '@gehennawu/dsh-service',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const NS = 'dsh-service'
    // ── 模型厂家/渠道图标（v1.8 新增）静态面 ──
    // 静态常量与纯解析函数放在工厂作用域（与 FILE_EDITOR_* 同规），既让 exports 能直接
    // 引用（apply 内的局部声明在导出点不可见），也便于测试直达。
    // 渲染路径由数据里的 c 字段决定，全部实测过（scripts/probe-model-icon-dom.mjs）：
    //   c=0（mono）mask + background-color:currentColor —— 颜色交给主题文字色，
    //              浅色 rgb(97,102,107) / 暗色 rgb(207,211,214) 自动跟随，零特判；
    //   c=1（color）background-image 原样上品牌色。
    // data-URI 是独立文档上下文，**不继承 currentColor**，所以 mono 必须走 mask
    // （直接写 fill="currentColor" 的 data-URI 会渲染成全黑/全透明）。
    const MODEL_ICON_ATTR = 'data-dshsvc-model-icon'
    const MODEL_ICON_SEAT_ATTR = 'data-dshsvc-model-icon-seat'
    const MODEL_ICON_VAR = '--dshsvc-model-icon'
    // 图标尺寸走变量：基准 15px，逐图标可被数据里的光学修正系数（o）覆盖。
    const MODEL_ICON_SIZE_VAR = '--dshsvc-model-icon-size'
    const MODEL_ICON_BASE_PX = 15
    const MODEL_ICON_VIEWBOX = '0 0 24 24'
    // ── 模型选择弹窗「分组标题（厂家/渠道商）」前的同一枚图标 ──
    // 官方 ModelSelect 的二级列表按 provider 分组，分组标题（`_7KE1Ra_groupTitle`）
    // 只渲染 group.name 一个文本节点，没有任何厂家标识。这里用同一套数据与渲染路径
    // 在其前画一枚图标：与 composer 座不同，菜单是**运行期才出现**的 DOM（官方在
    // 打开菜单时才 portal 一个 `<section role="group">` 列表），且每个分组是**不同**
    // 的 provider，所以不能像座上那样把变量挂在一个稳定锚点上——改为由引擎逐个分组
    // 打标（见 src/client/model-icons.js 的 decorateMenuGroups）。
    const MENU_GROUP_ATTR = 'data-dshsvc-model-group'
    // 标记本插件画出的图标节点：图标是**插入的真实子元素**而不是伪元素。标题的内容
    // 由官方 React 渲染，伪元素只能附着在标题自身、必然排到文本之后（表现为「渠道名
    // 后」），要放到名字**前**只能插入节点；重算时按该属性只摘自己插入的那一枚。
    const MENU_GROUP_ICON_ATTR = 'data-dshsvc-model-group-icon'
    // 分组标题只有一行、字号 12px（官方 line-height 18px）；图标取同一量级，
    // 由样式表统一尺寸与对齐，JS 侧只负责插节点。
    const MENU_GROUP_ICON_PX = 13

    /** 把一张图标规格化成 data-URI（mask 用纯黑填充即可，mask 只看 alpha）。 */
    const modelIconDataUri = (spec, useMask) => {
      const viewBox = spec.v || MODEL_ICON_VIEWBOX
      const paint = useMask ? ' fill="#000" color="#000"' : ''
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${paint}>${spec.m}</svg>`
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    }

    // ── 额度查询（v0.18）：环与统计卡共用一份快照、一个轮询器；上游节流全部收敛在宿主。 ──
    // 快照仓放在工厂作用域（而非 apply 内）：模型图标的「余额查询手动适配判定」
    // 与自动化测试直视都需要在 apply 之外读到它；订阅方（圆环/额度页/图标引擎）
    // 全部各自随 effect/Fiber 清理，仓本身无生命周期副作用。
    const quotaStore = {
      snapshot: { providers: [], serverTime: 0 },
      listeners: new Set(),
      subscribe(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
      getSnapshot() {
        return this.snapshot
      },
      publish(next) {
        this.snapshot = next
        for (const listener of [...this.listeners]) {
          try { listener() } catch (_) {}
        }
      },
    }

    // ── 余额查询「手动适配」→ 厂家图标（识别的兜底来源）────────────────────
    // 渠道名匹配不中时（自定义中转名：cpa、relay-xxx…），识别退而参考用户在余额查询里
    // 给该渠道手动适配的类型：适配成哪个 kind，就显示哪个 kind 的厂家图标。
    // CPA 因此只是本表的一行，不再是 `resolveModelIcon` 里的特例——旧行为
    // （只有手动适配成 cliproxy 才显示 CPA 标、且与渠道名无关）逐字保留。
    //
    // 两个前提缺一不可：
    //   ① 显式适配（kindSource === 'config'）：仅由 baseURL 自动推断出来的类型不算
    //      「用户手动适配过」，否则任何命中主机白名单的渠道都会凭空长出图标；
    //   ② 只作兜底：渠道名能识别时**以名字为准**（叫 cpa 却适配成 openrouter 时，
    //      仍按名字规则回落官方默认图标，不冒充 OpenRouter）。
    // 映射值必须是 MODEL_ICON_DATA 里真实存在的 slug（单测逐条断言）。
    const MODEL_ICON_QUOTA_KINDS = {
      'opencode-go': 'opencode',
      'zai-coding-cn': 'zhipu',
      'openrouter': 'openrouter',
      'kimi': 'kimi',
      'siliconflow': 'siliconcloud',
      'deepseek': 'deepseek',
      'cliproxy': 'cliproxy',
      'xiaomi-token-plan-cn': 'xiaomi',
      'stepfun': 'stepfun',
      'stepfun-step-plan': 'stepfun',
      'command-goat': 'commandcode',
    }

    /**
     * 取该 provider 在余额查询（quotaStore）中手动适配成的 kind；没有则 null。
     * 判定标准：快照中存在对应 provider 行，adapted 为 true，且 kindSource 为显式配置
     * （undefined 视作显式——老宿主快照不带该字段）。
     */
    const quotaAdaptedKindInStore = (provider) => {
      if (typeof provider !== 'string' || provider === '') return null
      const key = provider.trim().toLowerCase()
      try {
        if (typeof quotaStore !== 'object' || quotaStore === null || typeof quotaStore.getSnapshot !== 'function') return null
        const snapshot = quotaStore.getSnapshot()
        const rows = Array.isArray(snapshot?.providers) ? snapshot.providers : []
        const row = rows.find((candidate) => {
          const name = typeof candidate?.provider === 'string' ? candidate.provider.trim().toLowerCase() : ''
          return name === key && candidate.adapted === true && (candidate.kindSource === undefined || candidate.kindSource === 'config')
        })
        return row !== undefined && typeof row.kind === 'string' ? row.kind : null
      } catch (_) {
        return null
      }
    }

    /**
     * provider 名 → 图标 slug。先精确命中内置表，再按前缀/别名规则匹配自定义渠道
     * （本机 7 条 provider 里 6 条是自定义名：opencode-goo → opencode、
     * openrouter-f → openrouter、zai-coding-cn → zhipu…）。
     *
     * 名字识别不到时，退而参考余额查询里的手动适配类型（MODEL_ICON_QUOTA_KINDS）。
     * 两者都命中不了返回 null，由调用方回落官方默认图标。
     */
    const resolveModelIcon = (provider, options = {}) => {
      if (typeof provider !== 'string' || provider === '') return null
      const key = provider.trim().toLowerCase()
      if (key === '') return null

      const forComposer = options.forComposer === true

      // 手动适配类型：options.quotaKind（字符串=覆盖 / null=显式无）优先，缺省读快照仓。
      const quotaKind = typeof options.quotaKind === 'string'
        ? options.quotaKind
        : options.quotaKind === null
          ? null
          : quotaAdaptedKindInStore(key)
      const cliproxyAdapted = quotaKind === 'cliproxy'

      // 未在余额查询中手动适配时，对话框（含额度卡片）不显示 CLIProxyAPI 图标，回落官方默认图标。
      // 下面四条解析路径都可能落到 cliproxy 这个 slug，故收敛成同一个谓词——逐路径手写容易改漏其中一条。
      const cliproxyGatedOut = (slug) => slug === 'cliproxy' && forComposer && !cliproxyAdapted

      // ② 内置 provider 精确表
      const exactSlug = MODEL_ICON_PROVIDERS[key]
      if (exactSlug !== undefined && MODEL_ICON_DATA[exactSlug] !== undefined) {
        if (cliproxyGatedOut(exactSlug)) return null
        return { slug: exactSlug, spec: MODEL_ICON_DATA[exactSlug] }
      }
      // ③ 前缀/别名（自定义渠道名）。表内长前缀排在前（opencode-go 先于 opencode），
      //    命中即返回；分隔符限定为 - _ . ，避免 'openaiish' 这类误命中 'openai'。
      for (const [prefix, slug] of MODEL_ICON_PREFIXES) {
        if (key !== prefix && !key.startsWith(prefix + '-') && !key.startsWith(prefix + '_') && !key.startsWith(prefix + '.')) continue
        if (cliproxyGatedOut(slug)) continue
        if (MODEL_ICON_DATA[slug] !== undefined) return { slug, spec: MODEL_ICON_DATA[slug] }
      }
      // ④ 兜底：key 本身或其分段就是 slug
      if (MODEL_ICON_DATA[key] !== undefined) {
        if (cliproxyGatedOut(key)) return null
        return { slug: key, spec: MODEL_ICON_DATA[key] }
      }
      for (const part of key.split(/[-_.]/)) {
        if (part !== '' && MODEL_ICON_DATA[part] !== undefined) {
          if (cliproxyGatedOut(part)) continue
          return { slug: part, spec: MODEL_ICON_DATA[part] }
        }
      }
      // ⑤ 兜底：渠道名认不出来，但用户在余额查询里手动适配过 → 用所适配类型的厂家图形
      //    （cpa 这类没有公开品牌图形、名字也无从匹配的中转，正是这条存在的理由）。
      //    注意排在任何名字规则之后：名字能识别时以名字为准（见文件头注释）。
      const adaptedSlug = quotaKind === null ? undefined : MODEL_ICON_QUOTA_KINDS[quotaKind]
      if (adaptedSlug !== undefined && MODEL_ICON_DATA[adaptedSlug] !== undefined) {
        if (cliproxyGatedOut(adaptedSlug)) return null
        return { slug: adaptedSlug, spec: MODEL_ICON_DATA[adaptedSlug] }
      }
      return null
    }

    /**
     * 渲染一枚内联厂家小图标（额度卡片渠道名前等 React 场景）。
     * 与 composer 座同一套渲染路径：mono 档 mask + currentColor、彩色档 background-image；
     * 未命中渠道返回 null（调用方不渲染，不占位）。显示门与对话框一致：
     * CLIProxyAPI 图标只在余额查询里手动适配过时出现（forComposer 门语义复用）。
     */
    const modelIconNode = (provider, size = 14, extraStyle = {}, testId) => {
      if (typeof provider !== 'string' || provider === '') return null
      const resolved = resolveModelIcon(provider, { forComposer: true })
      if (resolved === null) return null
      const useMask = resolved.spec.c !== 1
      const uri = modelIconDataUri(resolved.spec, useMask)
      const base = { display: 'inline-block', width: `${size}px`, height: `${size}px`, flexShrink: 0, ...extraStyle }
      const maskValue = `${uri} center / contain no-repeat`
      if (useMask) {
        base.backgroundColor = 'currentColor'
        base.WebkitMask = maskValue
        base.mask = maskValue
      } else {
        base.backgroundImage = uri
        base.backgroundPosition = 'center'
        base.backgroundSize = 'contain'
        base.backgroundRepeat = 'no-repeat'
      }
      return React.createElement('span', {
        ...(typeof testId === 'string' && testId !== '' ? { 'data-testid': testId } : {}),
        'data-dshsvc-model-icon': resolved.slug,
        'aria-hidden': true,
        style: base,
      })
    }

    /** 图标 CSS：宽态加在 label 前，窄态替换官方 svg。整组以属性为门，未命中渠道零规则。 */
    const MODEL_ICON_CSS = `
/* 宽态：模型名前加厂家图标（::before 是触发钮 flex 行的首个子项）。
   官方 triggerIcon 在宽态本就 display:none，故宽态不会与官方图标重复。 */
/* 必须限定 button：[class*="_7KE1Ra_trigger"] 是子串匹配，会同时命中
   _7KE1Ra_triggerLabel / _7KE1Ra_triggerEffort —— 首版真机就是这样在模型名和
   推理等级上各多画了一枚图标（三枚并排）。限定标签既修命中面，又把特异性
   提到 (0,3,2)，顺带稳赢 mobile.css 的 (0,2,1)。 */
html [${MODEL_ICON_SEAT_ATTR}][${MODEL_ICON_ATTR}] button[class*="_7KE1Ra_trigger"]::before {
  content: '' !important;
  flex: none !important;
  display: block !important;
  /* 尺寸对齐额度圆环：圆环可见外径 13px（14px 的 SVG 盒，外圈 r=5.5 + 2 描边）。
     图标是实心块面、圆环是细描边环，同直径下实心更重，故基准取略小的 15px 让
     「视觉重量」相当（真机像素量测校准，见 scripts/measure-icon-ink.mjs）。
     能定一个统一数字的前提是生成期已把每个图标的 viewBox 收紧到真实绘制范围——
     否则各品牌留白不同，同一个数字画出来大小参差（⌘ 曾经只占 55%）。
     变量留给「形状填充率」这一层：满框形状（如 ⌘）即使外接尺寸相同也更显大，
     由数据里的光学系数 o 单独修正，见生成器 OPTICAL_SCALE。 */
  width: var(${MODEL_ICON_SIZE_VAR}, ${MODEL_ICON_BASE_PX}px) !important;
  height: var(${MODEL_ICON_SIZE_VAR}, ${MODEL_ICON_BASE_PX}px) !important;
  background-color: currentColor !important;
  -webkit-mask: var(${MODEL_ICON_VAR}) center/contain no-repeat !important;
  mask: var(${MODEL_ICON_VAR}) center/contain no-repeat !important;
}
/* 彩色档：原样上品牌色（去掉 mask，改用 background-image）。
   选择器必须同样带上 [${MODEL_ICON_ATTR}] 保持特异性 (0,3,2) 与上方单色规则平齐，
   以保证 !important 级联下后定义的 mask:none / transparent 胜出。 */
html [${MODEL_ICON_SEAT_ATTR}="color"][${MODEL_ICON_ATTR}] button[class*="_7KE1Ra_trigger"]::before {
  background-color: transparent !important;
  -webkit-mask: none !important;
  mask: none !important;
  background-image: var(${MODEL_ICON_VAR}) !important;
  background-position: center !important;
  background-size: contain !important;
  background-repeat: no-repeat !important;
}
/* 窄态「替换」：我方图标已表达厂家，官方那枚通用 IconDataOutline16 必须让位，
   否则两枚图标并排。两条门覆盖两种进入图标态的方式：
   ① ≤480px —— 本插件移动端显式把模型钮收成图标的那一档；
   ② 官方自己的容器查询 —— 容器 ≤360px 时官方本就切到图标态。
   两态都只在「已适配」时才有官方图标要藏：属性是 JS 按 provider 命中后才挂的，
   未命中渠道官方图标完全照旧。
   **选择器必须同时带两个自有属性**（而不是只带 seat 属性）：mobile.css 里那条
   「移动端作用域属性 + triggerIcon → display:block!important」与本规则同为
   !important、特异性也同为 (0,2,1)，而 mobile.css 在样式表顺序上排在后面——
   平局由顺序裁决，官方图标就会赢回来（真机实测：窄态出现两枚图标）。
   多带一个自身属性把特异性提到 (0,3,1)，即与插入顺序解耦，不依赖谁先挂。
   刻意不引用移动端作用域属性：本规则与移动端适配开关无关（关掉移动端适配、
   窄窗口下官方同样会收成图标），也避免与移动端引擎的挂载断言互相牵连。 */
@media (max-width: 480px) {
  html [${MODEL_ICON_SEAT_ATTR}][${MODEL_ICON_ATTR}] [class*="_7KE1Ra_triggerIcon"] { display: none !important; }
}
@container (width<=360px) {
  html [${MODEL_ICON_SEAT_ATTR}][${MODEL_ICON_ATTR}] [class*="_7KE1Ra_triggerIcon"] { display: none !important; }
}
/* 模型选择弹窗：分组标题（厂家/渠道商）**前**的同一枚图标。
   与座上那枚同一套渲染路径（mono 走 mask+currentColor、彩色走 background-image），
   但挂载机制不同：菜单是运行期才 portal 出来的 DOM、每组是**不同**的 provider，
   没有稳定独占座可挂，所以由引擎逐组插一个真实节点并打上自有属性门。
   不能改用标题的伪元素：伪元素只能排在标题既有内容**之后**（表现为「渠道名后」），
   而需求是名字**前**——插入节点（firstChild 之前）是唯一能满足位置的做法。
   未命中渠道的组不写属性、不插节点，这里也就没有匹配对象——官方标题零改动。 */
html [${MENU_GROUP_ATTR}] [${MENU_GROUP_ICON_ATTR}] {
  display: inline-block !important;
  /* 标题一行 12px（官方 line-height 18px），图标同量级并贴基线；
     右侧留 5px 让图标与渠道名之间的缝隙与官方行内间距相当。 */
  width: var(${MODEL_ICON_SIZE_VAR}, ${MENU_GROUP_ICON_PX}px) !important;
  height: var(${MODEL_ICON_SIZE_VAR}, ${MENU_GROUP_ICON_PX}px) !important;
  margin-right: 5px !important;
  vertical-align: -2px !important;
  background-color: currentColor !important;
  -webkit-mask: var(${MODEL_ICON_VAR}) center/contain no-repeat !important;
  mask: var(${MODEL_ICON_VAR}) center/contain no-repeat !important;
}
/* 彩色档：与座上同规——去掉 mask、改用 background-image 上品牌色。
   选择器同样带 [${MODEL_ICON_ATTR}] 保持特异性平齐，保证 !important 级联下后一条胜出；
   属性同时挂在标题与图标节点上（标题那份让「哪些组被装饰过」在 DOM 上可读）。 */
html [${MENU_GROUP_ATTR}][${MODEL_ICON_SEAT_ATTR}="color"] [${MENU_GROUP_ICON_ATTR}] {
  background-color: transparent !important;
  -webkit-mask: none !important;
  mask: none !important;
  background-image: var(${MODEL_ICON_VAR}) !important;
  background-position: center !important;
  background-size: contain !important;
  background-repeat: no-repeat !important;
}
`

    // DOM 访问容错包装：真机是标准 Element，但测试替身/老外壳可能既没有 document
    // 也没有 hasAttribute，直接调用会在 effect 析构时抛 `document is not defined` /
    // `t.hasAttribute is not a function`（本功能首版就是这样红掉的）。
    const iconDomSetAttr = (el, name, value) => {
      try {
        if (el !== null && el !== undefined && typeof el.setAttribute === 'function') el.setAttribute(name, value)
      } catch (_) {}
    }
    const iconDomRemoveAttr = (el, name) => {
      try {
        if (el !== null && el !== undefined && typeof el.removeAttribute === 'function') el.removeAttribute(name)
      } catch (_) {}
    }
    const iconDomHasAttr = (el, name) => {
      try {
        return el !== null && el !== undefined && typeof el.hasAttribute === 'function' && el.hasAttribute(name) === true
      } catch (_) { return false }
    }
    const iconDomGetAttr = (el, name) => {
      try {
        return el !== null && el !== undefined && typeof el.getAttribute === 'function' ? el.getAttribute(name) : null
      } catch (_) { return null }
    }
    const iconDomSetVar = (el, name, value) => {
      try {
        if (el !== null && el !== undefined && el.style && typeof el.style.setProperty === 'function') el.style.setProperty(name, value)
      } catch (_) {}
    }
    const iconDomRemoveVar = (el, name) => {
      try {
        if (el !== null && el !== undefined && el.style && typeof el.style.removeProperty === 'function') el.style.removeProperty(name)
      } catch (_) {}
    }

    // ── 右栏文件编辑（v1.6 / v1.6.1）静态面：档位 id、可编辑后缀表、头部入口的纯函数 ──
    // 官方右栏文档预览把「渲染器」做成公开注册面（ctx.documentPreviews + keyed 正文槽）。
    // 这里注册一个「编辑」档位：priority 'builtin' 表示**故意不夺默认位**——官方渲染器仍是
    // 各后缀的默认，编辑器由预览头部的注入按钮或渲染器下拉进入。
    const FILE_EDITOR_ID = '@gehennawu/dsh-service/editor'
    // 首版固定表：纯文本/代码类后缀。官方按后缀匹配，故不列 tar.gz 这类复合后缀。
    const FILE_EDITOR_EXTENSION_TABLE = [
      'md', 'markdown', 'mdx', 'txt', 'text', 'log', 'ini', 'toml', 'conf', 'cfg', 'env',
      'json', 'jsonc', 'json5', 'yml', 'yaml', 'xml', 'csv', 'tsv', 'diff', 'patch',
      'ts', 'mts', 'cts', 'js', 'mjs', 'cjs', 'jsx', 'tsx', 'vue', 'svelte', 'astro',
      'css', 'scss', 'sass', 'less', 'html', 'htm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
      'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh',
      'cs', 'php', 'sql', 'swift', 'lua', 'pl', 'pm', 'r', 'dart', 'scala', 'clj', 'ex', 'exs', 'erl',
      'hs', 'ml', 'nim', 'zig', 'vim', 'el', 'emacs', 'lisp', 'scm', 'gradle', 'properties',
      'dockerfile', 'makefile', 'gitignore', 'gitattributes', 'gitconfig', 'editorconfig',
      'npmrc', 'nvmrc', 'eslintignore', 'prettierignore',
    ]
    // 头部「编辑」入口只用稳定钩子：官方渲染器下拉钮 + 官方 Menu 渲染的菜单项。
    const EDITOR_ENTRY_ATTR = 'data-dshsvc-editor-entry'
    // 本插件在标签 ⋯ 菜单里的条目（官方 sidebar.right.tab.menu.item 座）：官方菜单同样把条目
    // 渲染成 [role=menuitem]，选档位时必须能把自己排除掉，否则点它会自我递归。
    const EDITOR_MENU_ITEM_ATTR = 'data-dshsvc-editor-menu-item'
    const VIEWER_MENU_SELECTOR = '[data-document-viewer-menu]'
    const VIEWER_ITEM_SELECTOR = '[role="menuitem"], [role="option"]'
    const docOrNull = () => {
      try { return typeof document === 'undefined' || document === null ? null : document } catch (_) { return null }
    }
    const queryAll = (doc, selector) => {
      try { return Array.from(doc.querySelectorAll(selector)) } catch (_) { return [] }
    }
    const textOfNode = (node) => String(node?.textContent ?? '').trim()
    /** 节点是否带某属性（替身/极简桩可能没有 getAttribute）。 */
    const hasAttr = (node, name) => {
      try { return typeof node?.getAttribute === 'function' && node.getAttribute(name) !== null } catch (_) { return false }
    }
    /**
     * 整圆/胶囊几何：官方 ui-theme 的 corner-shape.css 在 @supports 内用通配选择器给
     * **所有元素**加 corner-shape: superellipse(1.5)（全局圆角平滑，官方既定设计，不是缺陷）。
     * 官方约定「正圆与胶囊由所属组件把 corner-shape: round 与半径配对」（ui-theme README
     * §corner-shape.css，官方 20 个包均照此办理）；只写 border-radius: 50%/999px/100px 会被
     * 超级椭圆压成方角、胶囊两端削平。插件自有整圆/胶囊一律经此助手声明；不支持该属性的引擎
     * 忽略它，几何自动回落普通圆弧。
     */
    const fullRound = (radius) => ({ borderRadius: radius, cornerShape: 'round' })
    /**
     * 地址后缀是否落在可编辑表内（与官方按解码后文件名后缀匹配同口径）。
     * 只用于「⋯ 菜单要不要露出编辑入口」这类显示判定，真正的档位匹配仍由官方注册面负责。
     * @param address - `dsh-resource://file/…` 地址。
     * @returns 是否可能有「编辑」档位可选。
     */
    const editorExtensionMatches = (address) => {
      let name = ''
      try {
        const cut = address.search(/[?#]/)
        const raw = (cut === -1 ? address : address.slice(0, cut)).slice(address.lastIndexOf('/') + 1)
        name = decodeURIComponent(raw)
      } catch (_) {
        return false
      }
      const lower = name.toLowerCase()
      return FILE_EDITOR_EXTENSION_TABLE.some((extension) => lower.endsWith('.' + extension) || lower === extension)
    }
    /**
     * 从 pane 内节点（编辑器正文根 / 注入按钮）定位**所属 pane** 的官方下拉钮。
     *
     * 官方右栏支持双分栏，每个 pane 各有一份头部与 `[data-document-viewer-menu]`；
     * 入口必须操作自己 pane 的下拉，「全文档取第一个」就是多 pane 选错文件档位的根因。
     * 定位失败返回 null，由调用方安全失败（宁可不动作，也不操作别的 pane）。
     * @param root - pane 内的任意元素节点。
     * @returns 所属 pane 的下拉钮；无法确定所属时 null。
     */
    const findViewerMenuForNode = (root) => {
      if (root === null || root === undefined) return null
      try {
        if (typeof root.closest === 'function') {
          const pane = root.closest('[data-document-preview]')
          if (pane !== null && pane !== undefined) {
            const menu = pane.querySelector(VIEWER_MENU_SELECTOR)
            if (menu !== null && menu !== undefined) return menu
          }
        }
      } catch (_) {}
      // 兜底：壳版本没有 data-document-preview 时沿祖先逐层就近找——第一个包含下拉钮
      // 的祖先就是自己的 pane（分栏 pane 是兄弟节点，不会嵌套）。
      try {
        let node = typeof root.closest === 'function' ? root.parentElement : root.parentNode
        const ownerDoc = docOrNull()
        while (node !== null && node !== undefined && node !== ownerDoc) {
          if (typeof node.querySelector !== 'function') break
          const menu = node.querySelector(VIEWER_MENU_SELECTOR)
          if (menu !== null && menu !== undefined) return menu
          node = node.parentNode
        }
      } catch (_) {}
      return null
    }
    /** 延迟选档位的活性守卫登记表：入口引擎 teardown 时统一作废未决重试。 */
    const viewerSelectionGuards = new Set()
    const createViewerSelectionGuard = () => {
      const guard = { alive: true }
      viewerSelectionGuards.add(guard)
      return {
        isAlive: () => guard.alive === true,
        dispose: () => { guard.alive = false; viewerSelectionGuards.delete(guard) },
      }
    }
    // 入口引擎当前守卫；startEditorEntries 装配时替换，销毁时作废。
    let editorEntriesGuard = { isAlive: () => false, dispose: () => {} }
    const cancelPendingViewerSelections = () => {
      for (const guard of viewerSelectionGuards) guard.alive = false
      viewerSelectionGuards.clear()
    }
    /**
     * 在官方渲染器下拉里选中一个档位。
     *
     * 与旧版的关键差异：
     * - `options.menu` 必须是调用方 pane 自己的下拉钮（经 findViewerMenuForNode 取得），
     *   缺失即安全失败——绝不全局取第一个，杜绝多 pane 操作错面板；
     * - `options.isAlive` 活性守卫：功能关闭 / 插件卸载后，未决的延迟点击一律作废；
     * - 菜单条目仍全文档查找（官方 Menu portal 到 body，就近查不到），但打开动作只发生在
     *   自己 pane 的下拉钮上：先关掉别的 pane 可能开着的菜单，portal 里留下的才是本 pane 条目；
     *   就地命中仅在「全文档只有这一个下拉」时采用（此时任何已开 portal 都属于它）。
     * @param doc - 宿主 document（测试可传桩）。
     * @param match - 菜单项文案判定。
     * @param options - `{ menu: 本 pane 下拉钮, isAlive: 活性守卫 }`。
     * @returns 是否已经点中（重试路径返回 false，由定时器继续）。
     */
    const selectViewerItem = (doc, match, options = {}) => {
      const menu = options?.menu
      if (doc === null || menu === null || menu === undefined) return false
      const alive = typeof options?.isAlive === 'function' ? options.isAlive : () => true
      if (!alive()) return false
      const pick = () => queryAll(doc, VIEWER_ITEM_SELECTOR).find((item) => {
        // 官方 ⋯ 菜单的条目同样是 [role=menuitem]：必须跳过本插件自己的项，
        // 否则「点菜单项 → 找菜单项 → 又点自己」会自我递归。
        if (hasAttr(item, EDITOR_MENU_ITEM_ATTR)) return false
        return match(textOfNode(item))
      })
      const clickItem = (item) => {
        try { item.click() } catch (_) { return false }
        return true
      }
      let anchorCount = 0
      try { anchorCount = queryAll(doc, VIEWER_MENU_SELECTOR).length } catch (_) { anchorCount = 0 }
      if (anchorCount <= 1) {
        const opened = pick()
        if (opened !== undefined) return clickItem(opened)
      }
      try { menu.click() } catch (_) { return false }
      if (!alive()) return false
      const afterOpen = pick()
      if (afterOpen !== undefined) return clickItem(afterOpen)
      let remaining = 12
      const retry = () => {
        if (remaining <= 0 || !alive()) return
        remaining -= 1
        if (typeof setTimeout !== 'function') return
        setTimeout(() => {
          if (!alive()) return
          try {
            const late = pick()
            if (late !== undefined) { clickItem(late); return }
          } catch (_) {}
          retry()
        }, 60)
      }
      retry()
      return false
    }

    const zh = {
      'nav.label': '服务控制',
      'nav.restart': '重启',
      'features.cardTitle': '服务控制（dsh-service）',
      'features.cardHint': '控制可选功能和外部能力。开关立即生效，无需重启。',
      'features.external': '外部能力',
      'features.healthDiagnostics': '健康诊断',
      'features.modelUsage': '模型统计',
      'features.quotaLookup': '额度查询',
      'features.backupMaintenance': '备份维护',
      'features.taskNotifications': '任务通知',
      'features.healthz': '/healthz 探活端点',
      'features.skillManager': '技能管理',
      'features.readOnly': '当前设置不可写。',
      'tabs.skills': '技能',
      'tabs.subagent': '子代理',
      'tabs.sessions': '会话管理',
      'features.subagentRoute': '子代理模型',
      'features.mobileAdaptation': '移动端适配',
      'features.sessionManager': '会话管理',
      'sessions.title': '会话管理',
      'sessions.filter.all': '全部',
      'sessions.filter.archived': '仅归档',
      'sessions.filter.deleted': '已删除',
      'sessions.filter.subagent': '仅子代理',
      'sessions.refresh': '刷新',
      'sessions.batch.enter': '批量选择',
      'sessions.batch.exit': '退出批量',
      'sessions.batch.selectAll': '全选',
      'sessions.batch.clearAll': '取消全选',
      'sessions.batch.selectSubagents': '选中子代理',
      'sessions.batch.selected': '已选择 {count} 项',
      'sessions.batch.selectRow': '选择会话：{title}',
      'sessions.batch.export': '导出 ({count})',
      'sessions.batch.archive': '归档 ({count})',
      'sessions.batch.unarchive': '恢复 ({count})',
      'sessions.batch.delete': '删除 ({count})',
      'sessions.batch.clear': '清除 ({count})',
      'sessions.batch.completed': '已完成{action}：{count} 项',
      'sessions.batch.failed': '{action}完成 {done}/{total} 项；{error}',
      'sessions.batch.deleteTitle': '删除 {count} 个会话',
      'sessions.batch.deleteBody': '将永久删除以下已归档会话的日志文件，删除后不可恢复。',
      'sessions.batch.deleteItem': '{title}（{bytes}）',
      'sessions.batch.clearTitle': '清除 {count} 条已删除记录',
      'sessions.batch.clearBody': '确定要清除以下 {count} 条已删除记录吗？清除后将从记录列表中永久移除。',
      'sessions.status.loading': '加载中…',
      'sessions.status.working': '处理中…',
      'sessions.status.unavailableTime': '时间未知',
      'sessions.glyph.expand': '▸',
      'sessions.glyph.collapse': '▾',
      'sessions.glyph.back': '←',
      'sessions.search.placeholder': '搜索对话内容…',
      'sessions.search.archivedOnly': '仅搜归档',
      'sessions.sort.createdDesc': '创建时间倒序',
      'sessions.sort.createdAsc': '创建时间正序',
      'sessions.sort.title': '按标题',
      'sessions.sort.project': '按项目',
      'sessions.projectGroup.countOne': '1 个会话',
      'sessions.projectGroup.countMany': '{count} 个会话',
      'sessions.projectGroup.noCwd': '（无工作区）',
      'sessions.row.live': '运行中',
      'sessions.row.archived': '已归档',
      'sessions.row.deleted': '已删除',
      'sessions.row.subagent': '子代理',
      'sessions.subagent.hostLegacy': '当前插件宿主较旧，列表未携带子代理标志；升级插件并重启 dsh 后「仅子代理」才会生效',
      'sessions.row.events': '{count} 条事件',
      'sessions.row.noTitle': '（无标题）',
      'sessions.action.view': '查看',
      'sessions.action.export': '导出',
      'sessions.action.archive': '归档',
      'sessions.action.unarchive': '恢复',
      'sessions.action.delete': '删除',
      'sessions.action.clear': '清除',
      'sessions.empty.all': '没有会话',
      'sessions.empty.archived': '没有归档会话',
      'sessions.empty.deleted': '暂无删除记录',
      'sessions.empty.search': '没有命中「{query}」',
      'sessions.error.load': '加载失败：{error}',
      'sessions.error.feature-disabled': '会话管理功能已在设置中关闭',
      'sessions.error.network': '网络错误：无法连接宿主',
      'sessions.error.session-not-found': '会话不存在或已被删除',
      'sessions.error.live-session-rejected': '会话正在运行，无法删除',
      'sessions.error.session-not-archived': '仅已归档会话可以删除',
      'sessions.error.unknown-delete-plan': '删除请求已失效，请重新发起',
      'sessions.error.invalid-session-ids': '无效的会话标识',
      'sessions.error.unarchive-unsupported': '当前宿主不支持恢复归档（需要 DSH ≥ 0.1.6）',
      'sessions.error.export-failed': '导出失败：{error}',
      'sessions.detail.back': '返回列表',
      'sessions.detail.open': '在官方会话中打开',
      'sessions.detail.archiveDisabled': '归档会话/空白会话无法在官方界面打开',
      'sessions.detail.exportAll': '导出全部 ZIP',
      'sessions.detail.exporting': '正在导出…',
      'sessions.detail.loadMore': '加载更多（{remaining}）',
      'sessions.detail.noMore': '已加载全部 {total} 条事件',
      'sessions.detail.noise': '系统事件',
      'sessions.detail.noiseBlock': '{count} 条系统事件',
      'sessions.detail.noiseExpand': '展开全部',
      'sessions.detail.noiseCollapse': '收起',
      'sessions.detail.toolBlock': '{count} 条工具消息',
      'sessions.detail.toolCollapse': '收起',
      'sessions.detail.cwd': '{cwd}',
      'sessions.detail.created': '创建于 {time}',
      // v1.4.2 修复：alpha.4 外壳 MarkdownText 的代码块渲染器无条件读 labels.code.copyLabel/
      // copiedLabel（footnotes 同理）——不传 labels 时事件文本含 ``` 栅栏会整节崩成空白。
      'sessions.md.copy': '复制',
      'sessions.md.copied': '已复制',
      'sessions.md.footnotes': '脚注',
      'sessions.hit.title': '命中 {count} 条',
      'sessions.hit.return': '返回搜索结果',
      'sessions.hit.badge': '命中',
      'sessions.hit.prev': '◀ 上一个',
      'sessions.hit.next': '下一个 ▶',
      'sessions.hit.inSession': '本会话 {count} 处命中',
      'sessions.delete.title': '删除会话',
      'sessions.delete.body': '将永久删除以下会话的日志文件，删除后不可恢复。',
      'sessions.delete.consequence.log': '删除会话日志（{bytes}）',
      'sessions.delete.consequence.sidebar': '会话从官方侧栏隐藏',
      'sessions.delete.confirm': '确认删除',
      'sessions.delete.cancel': '取消',
      'sessions.delete.done': '已删除',
      'sessions.clear.title': '清除已删除记录',
      'sessions.clear.body': '确定要清除该条已删除记录吗？清除后将从记录列表中永久移除。',
      'sessions.clear.confirm': '确认清除',
      'sessions.clear.cancel': '取消',
      'sessions.export.includes': '含子代理与附件',
      'sessions.navToggle': '设置页左列显示「会话管理」入口',
      'sessions.oneWay': '归档不可恢复',
      'sessions.oneWayHint': '归档后会话从官方侧栏隐藏；官方不支持恢复归档，只能通过本面板删除。',
      'mobile.fab.label': '打开侧栏菜单',
      'mobile.debug.title': '移动端诊断',
      'mobile.debug.viewport': '视口',
      'mobile.debug.drawer': '抽屉',
      'mobile.debug.sidebarPanel': '右栏',
      'mobile.debug.details': '预览列',
      'mobile.debug.rightbar': '右栏',
      'mobile.debug.errors': 'JS 错误',
      'mobile.debug.stateOn': '开',
      'mobile.debug.stateOff': '关',
      'mobile.debug.immersive': '沉浸',
      'mobile.debug.immersive.reason.gesture': '滑动回显',
      'mobile.debug.immersive.reason.arrival': '到底回显',
      'mobile.debug.immersive.reason.focus': '聚焦回显',
      'mobile.debug.immersive.reason.button': '回底钮回显',
      'mobile.debug.edge': '边缘',
      'mobile.debug.edge.fieldStart': '起',
      'mobile.debug.edge.fieldMoves': '动',
      'mobile.debug.edge.fieldLast': '末',
      'mobile.debug.edge.fieldCancel': '消',
      'mobile.debug.edge.fieldReason': '因',
      'mobile.debug.edge.open': '开',
      'mobile.debug.edge.leftOpen': '左开',
      'mobile.debug.edge.rightOpen': '右开',
      'mobile.debug.edge.leftClose': '左关',
      'mobile.debug.edge.rightClose': '右关',
      'mobile.debug.edge.reason.multiTouch': '多指',
      'mobile.debug.edge.reason.modal': '模态',
      'mobile.debug.edge.reason.hScroll': '横滚',
      'mobile.debug.edge.reason.noPoint': '无触点',
      'mobile.debug.edge.reason.absentRight': '右栏缺席',
      'mobile.debug.edge.reason.badButton': '右栏钮不可用',
      'mobile.debug.edge.reason.noTracker': '无追踪',
      'conversation.jump.previousReply': '上一条用户回复',
      'subagent.title': '子代理模型',
      'subagent.loading': '读取配置…',
      'subagent.hint': '控制未显式指定模型的子代理所用模型；显式指定的不受影响。切换模式不会清除已保存的自定义模型与回退列表，切回「自定义」即恢复。',
      'subagent.mode.label': '模式',
      'subagent.mode.inherit': '初始（不干预）',
      'subagent.mode.inherit.desc': '不注入任何路由，保持宿主原生继承行为：子代理使用会话创建时烘焙的默认模型。',
      'subagent.mode.follow': '跟随主模型',
      'subagent.mode.follow.desc': '每次派生时读取主对话当前实际使用的模型（最近一次请求的渠道）并注入。',
      'subagent.mode.custom': '自定义',
      'subagent.mode.custom.desc': '所有未显式指定模型的子代理固定使用下方选择的模型。',
      'subagent.provider': '供应商',
      'subagent.model': '模型',
      'subagent.reasoningEffort': '思考等级',
      'subagent.reasoningEffort.default': '使用模型默认（不指定）',
      'subagent.reasoningEffort.unavailable': '该模型未声明可选思考等级',
      'subagent.modelsEmpty': '模型清单为空：无法解析宿主 LLM 渠道。',
      'subagent.save': '保存',
      'subagent.saved': '已保存',
      'subagent.reset': '重置回初始配置',
      'subagent.saving': '保存中…',
      'subagent.unavailable': '宿主未提供子代理注册表（subagents 服务缺席），配置不会生效。',
      'subagent.error': '操作失败：{error}',
      'subagent.error.feature-disabled': '子代理模型功能已在设置中关闭',
      'subagent.error.llm-unavailable': '宿主 LLM 服务不可用',
      'subagent.error.unknown-mode': '未知模式',
      'subagent.error.invalid-model-route': '供应商或模型不在宿主清单内',
      'subagent.error.invalid-reasoning-effort': '思考等级不受该模型支持，请重新选择',
      'subagent.error.network': '网络错误：无法连接宿主',
      'subagent.fallback.title': '回退模型（按顺序）',
      'subagent.fallback.item': '回退 {index}',
      'subagent.fallback.hint': '第一路由不可用时（渠道已卸载、额度查询判定不可服务）依次尝试回退；全部不可用则回落原生继承，不让派生失败。',
      'subagent.fallback.add': '添加回退',
      'subagent.fallback.sort': '调整排序',
      'subagent.fallback.sort.done': '完成排序',
      'subagent.fallback.remove': '移除',
      'subagent.fallback.up': '上移',
      'subagent.fallback.down': '下移',
      'subagent.fallback.empty': '未添加回退：第一路由不可用时子代理回落到原生继承。',
      'subagent.fallback.limit': '已达上限（{max} 个）',
      'subagent.error.invalid-fallback-route': '回退条目不在宿主清单内，请重新选择',
      'subagent.dock.label': '子代理：',
      'subagent.dock.title': '输入框下方显示子代理信息',
      'skills.error': '操作失败：{error}',
      'skills.error.feature-disabled': '技能管理功能已在设置中关闭',
      'skills.error.network': '网络错误，请稍后重试',
      'skills.error.read-only-source': '该条目位于只读来源，无法修改',
      'skills.error.unknown-skill': '技能未找到，列表可能已变化，请刷新重试',
      'skills.error.invalid-skill': '条目当前无效：{reason}',
      'skills.error.invalid-field': '开关字段无效',
      'skills.error.invalid-enable': '开关值无效',
      'skills.error.invalid-model-route': '模型路由无效，请重新选择模型',
      'skills.error.invalid-description': '描述不能为空',
      'skills.error.describe-timeout': '模型生成超时（90 秒）',
      'skills.error.empty-output': '模型未产出正文（结束原因：{kind}）',
      'skills.error.batch-cancelled': '已取消',
      'skills.error.entry-changed': '条目在运行中发生变化，已跳过',
      'skills.error.unknown-batch-plan': '批量计划已失效，请重新生成',
      'skills.error.batch-already-done': '该批量计划已完成',
      'skills.error.batch-already-cancelled': '该批量计划已取消',
      'skills.error.annotated-confirm-required': '已注释技能需再次确认后才能被覆盖',
      'skills.empty': '未发现任何技能',
      'skills.filter': '按名称过滤…',
      'skills.expandAll': '全部展开',
      'skills.collapseAll': '全部折叠',
      'skills.colon': '：',
      'skills.group.auto': '自动加载',
      'skills.group.manual': '仅手动调用',
      'skills.group.disabled': '完全停用',
      'skills.source.project-dsh': '项目 .dsh',
      'skills.source.project-agents': '项目 .agents',
      'skills.source.user-dsh': '用户 DSH',
      'skills.source.user-agents': '用户 .agents',
      'skills.source.bundled': '内置',
      'skills.source.custom': '自定义目录',
      'skills.badge.shadowed': '被同名遮蔽',
      'skills.badge.readonly': '只读',
      'skills.badge.annotated': '已注释',
      'skills.note.stale': '正文已变更，待重新补全',
      'skills.note.remove': '移除 AI 注释',
      'skills.note.panelOnly': '注释仅保存在本面板展示，不写入 SKILL.md。',
      'skills.log.title': '运行日志',
      'skills.log.located': '已定位技能 {name}（文件 {chars} 字符）',
      'skills.log.attempt': '第 {n}/{total} 次生成：调用 {route}',
      'skills.log.received': '输出接收完成（{chars} 字符），解析 JSON…',
      'skills.log.parsed': '解析成功，草稿就绪',
      'skills.log.failed-retry': '失败：{message}，自动重试',
      'skills.log.failed': '失败：{message}',
      'skills.log.wait': '等待模型输出… {secs}s',
      'skills.log.first-delta': '模型已开始返回',
      'skills.log.first-reasoning': '模型已开始返回（先输出推理）',
      'skills.log.progress': '已接收 {chars} 字符',
      'skills.log.finish-reasoning-only': '模型结束：{kind}（仅推理 {chars} 字符，未产出正文）',
      'skills.log.finish-empty': '模型结束：{kind}（无任何输出）',
      'skills.log.block-extract': '从整块输出提取正文（{chars} 字符）',
      'skills.log.item-start': '开始生成注释…',
      'skills.batch.toggle': '批量注释',
      'skills.batch.collapse': '收起',
      'skills.batch.already': '已有批量任务在进行中，请等待完成或先取消',
      'skills.invalid.legacy': '存在旧版调用键，已从模型目录剔除',
      'skills.invalid.other': '无效条目：{reason}',
      'skills.fix.legacy': '一键修复旧键',
      'skills.switch.model': '对模型可见',
      'skills.switch.user': '可被 / 调用',
      'skills.switch.confirm': '再次点击生效',
      'skills.describe.button': 'AI 补全说明',
      'skills.describe.title': 'AI 补全说明 — {name}',
      'skills.describe.model': '模型',
      'skills.describe.models.loading': '获取模型列表…',
      'skills.describe.models.empty': '未发现已配置模型',
      'skills.describe.run': '生成草稿',
      'skills.describe.running': '生成中…',
      'skills.apply.title': '保存 AI 注释 — {name}',
      'skills.apply.description': '描述',
      'skills.apply.usage': '用法',
      'skills.apply.old': '旧',
      'skills.apply.new': '新',
      'skills.apply.confirm': '保存注释',
      'skills.apply.done': '注释已保存',
      'skills.apply.keepusage': '（保留现有）',
      'skills.llm.unavailable': '宿主 LLM 服务不可用，无法 AI 补全。',
      'skills.batch.title': '批量补全技能说明',
      'skills.batch.hint': '逐条调用所选模型为未注释或正文有变的技能生成说明；已注释技能在计划中单列，再次确认后才会被覆盖。结果仅存插件内并展示在条目下方。',
      'skills.batch.plan': '生成计划',
      'skills.batch.candidates': '候选 {count} 项',
      'skills.batch.estBytes': '约发送 {size} 内容',
      'skills.batch.skipped': '跳过 {count} 项（无效 / 被遮蔽）',
      'skills.batch.annotated': '已注释将覆盖 {count} 项',
      'skills.batch.annotatedList': '将覆盖清单',
      'skills.batch.forceConfirm': '确认强制补全（覆盖 {count} 项已注释）',
      'skills.skippedList': '跳过清单',
      'skills.skip.shadowed': '被遮蔽',
      'skills.skip.invalid': '无效（{reason}）',
      'skills.skip.reason.missing-frontmatter': '缺 frontmatter',
      'skills.skip.reason.missing-name': '缺 name',
      'skills.skip.reason.invalid-name': 'name 不合法',
      'skills.skip.reason.missing-description': '缺 description',
      'skills.skip.reason.too-large': '文件过大',
      'skills.skip.reason.legacy-invocation-key': '旧版调用键',
      'skills.batch.start': '开始批量补全',
      'skills.batch.progress': '进度 {done}/{total}',
      'skills.batch.current': '当前：{name}',
      'skills.batch.cancel': '取消',
      'skills.batch.phase.idle': '空闲',
      'skills.batch.phase.planned': '待开始（核对候选后点击「开始批量补全」）',
      'skills.batch.phase.running': '进行中',
      'skills.batch.phase.done': '已完成',
      'skills.batch.phase.cancelled': '已取消',
      'skills.batch.failures': '失败 {count} 项',
      'skills.batch.no-candidates': '没有需要补全的候选',
      'skills.batch.model': '模型',
      // v0.39：技能/子代理的左列入口撤销，相关开关文案随之移除。
      'overlay.label': '服务重启状态',
      'recovery.waiting.title': '服务重启中…',
      'recovery.waiting.body': '正在等待新的 DSH Web 进程启动，已等待 {seconds} 秒。',
      'recovery.timeout.title': '服务尚未恢复',
      'recovery.timeout.body': '已等待 60 秒。请确认外部进程管理器已正确配置，或手动刷新页面重试。',
      'recovery.manual': '手动刷新',
      'health.title': '运行状况',
      'health.uptime': '运行时间',
      'health.rss': '内存 RSS',
      'health.platform': '平台',
      'health.nodeVersion': 'Node 版本',
      'health.liveSessions': '存活会话',
      'health.persistedSessions': '持久化会话',
      'health.activeAgents': '活跃 Agent',
      'health.activeJobs': '后台任务',
      'health.uptimeValue': '{hours} 小时 {minutes} 分钟',
      'health.error': '无法读取运行状况',
      'health.check': '立即健康检查',
      'health.checking': '检查中…',
      'health.overall.ok': '正常',
      'health.overall.warning': '警告',
      'health.overall.error': '错误',
      'health.alert.title': '健康提醒',
      'health.alert.diagnostics': '检查结果存在{status}，请查看下方异常项。',
      'health.status.ok': '正常',
      'health.status.warning': '警告',
      'health.status.error': '错误',
      'health.status.info': '信息',
      'health.check.session-storage': '会话存储',
      'health.check.workspace-registry': '工作区注册表',
      'health.check.dsh-home': 'DSH_HOME',
      'health.check.backup-storage': '备份存储',
      'health.check.tar': 'tar',
      'health.check.permissions': '文件权限',
      'health.check.runtime-env': '运行环境',
      'health.check.node-version': 'Node 运行时',
      'health.detail.runtime-env.managed': '由{kind}管理，重启后会自动拉起',
      'health.detail.runtime-env.declared': '已通过 DSH_SERVICE_RUNTIME_ENV 声明由外部进程管理器管理',
      'health.detail.runtime-env.manual': '疑似终端手动启动，重启后不会自动拉起；一键升级已改为不自动退出',
      'health.detail.runtime-env.unknown': '未检测到进程管理器，无法确认重启后是否自动拉起；如实际有，可设置 DSH_SERVICE_RUNTIME_ENV=managed 声明',
      'health.detail.node-version.ok': '{version}，满足 ≥{required} 要求',
      'health.detail.node-version.warning': '{version} 低于插件要求的 {required}.x，建议升级 Node',
      'health.detail.session-storage.ok': '可用，共 {count} 个会话快照',
      'health.detail.workspace-registry.ok': '可用，共 {count} 个工作区',
      'health.detail.dsh-home.ok': '目录可访问，权限模式 {mode}',
      'health.detail.backup-storage.empty': '备份目录可用，当前暂无备份',
      'health.detail.backup-storage.ok': '备份目录可用，共 {count} 个备份，占用 {size}',
      'health.detail.tar.ok': 'tar 可执行文件可用',
      'health.detail.permissions.ok': '文件权限检查正常，未发现异常',
      'health.detail.permissions.warning': '发现 {count} 个文件或目录权限异常',
      'health.detail.generic': '{status}',
      // 使用统计索引（工作区实现，未发布）：detail 三段 failed:indexed:updatedAt；'never' = 尚未建立索引。
      'health.check.usage-index': '使用统计索引',
      'health.detail.usage-index.never': '尚未建立统计索引，打开模型统计页后开始只读建立',
      'health.detail.usage-index.unavailable': '统计索引暂不可读',
      'health.detail.usage-index.ok': '已索引 {indexed} 个会话，更新于 {updated}',
      'health.detail.usage-index.warning': '{failed} 个会话未能索引（统计少算），已索引 {indexed} 个，更新于 {updated}',
      // 浏览器通知权限：客户端专属检查行（宿主看不到浏览器权限）。仅在通知总开关开启时才有意义。
      'health.check.notification-permission': '通知权限',
      'health.detail.notification-permission.granted': '浏览器已授权系统通知',
      'health.detail.notification-permission.default': '浏览器尚未授权系统通知，可在「配置 → 通知」中启用',
      'health.detail.notification-permission.denied': '浏览器已拒绝系统通知，需在浏览器站点设置里恢复',
      'health.detail.notification-permission.unsupported': '当前浏览器不支持系统通知',
      // v1.3 插件健康检查：只检查异常（官方设置页已有完整插件清单与开关，这里不做重复清单）。
      'health.check.plugins': '插件',
      'health.detail.plugins.unavailable': '插件体检不可用（宿主未暴露 Loader）',
      'health.detail.plugins.ok': '共 {total} 个插件，状态正常',
      'plugin.issue.failed': '{failed} 个插件失败',
      'plugin.issue.pending': '{pending} 个插件未就绪',
      'plugin.issue.info': '{count} 个插件状态需确认',
      'plugin.state.pending': '等待依赖',
      'plugin.state.loading': '加载中',
      'plugin.state.failed': '失败',
      'plugin.state.disposed': '已释放',
      'plugin.state.unknown': '未知状态',
      'plugin.state.unloading': '卸载中',
      'plugin.missingDeps': '依赖缺失：{deps}',
      'plugin.error': '错误：{error}',
      'plugin.restart': '重新加载',
      'plugin.restarting': '重新加载中…',
      'plugin.restartConfirm': '确认重新加载',
      'plugin.restartHint': '重新加载「{name}」，其启动逻辑将重新执行，失败状态会随之刷新。',
      'plugin.restartCancel': '取消',
      'plugin.restartFailed': '重新加载失败：{detail}',
      'plugin.error.unknown-plugin': '未找到该插件',
      'plugin.error.loader-unavailable': '宿主 Loader 不可用',
      'plugin.error.plugin-disabled': '插件已停用，无法重新加载',
      'plugin.error.not-failed': '该插件未处于失败状态',
      'plugin.error.restart-failed': '重新加载后仍然失败',
      // v1.3 插件兼容性：对照已核实的 DSH alpha 破坏面清单（供应商移除/后端移除/样式哈希漂移/属性删除）。
      'health.check.plugin-compat': '插件兼容性',
      'health.detail.plugin-compat.unavailable': '插件兼容性检查不可用（宿主未暴露 Loader）',
      'health.detail.plugin-compat.ok': '已扫描 {total} 个插件，未发现对已变更接口的引用',
      // 单插件条目内的分档短标签（同一插件多档命中归并到一行时用；`issue.*` 是检查行摘要的计数文案）。
      'plugin.compat.kind.broken': '可能不兼容',
      'plugin.compat.kind.soft': '为兼容旧版保留',
      'plugin.compat.kind.declared': '声明残留',
      'plugin.compat.kind.unknown': '未能扫描',
      'plugin.compat.issue.broken': '{count} 个插件可能不兼容',
      'plugin.compat.issue.soft': '{count} 个插件为兼容旧版保留了退役接口',
      'plugin.compat.issue.declared': '{count} 个插件仅声明残留（代码未引用）',
      'plugin.compat.issue.unknown': '{count} 个插件未能扫描',
      'plugin.compat.declared': '声明了已移除的接口但代码未引用——官方加载器对缺失供应商静默跳过，当前无害，可提示作者清理',
      'plugin.compat.badge.active': '当前版本已生效',
      'plugin.compat.badge.future': '当前正常（升级至 DSH ≥ {since} 后生效）',
      'plugin.compat.category.package-removed': '依赖包已移除',
      'plugin.compat.category.slot-retired': '槽位已退役',
      'plugin.compat.category.method-removed': '方法已移除',
      'plugin.compat.category.event-removed': '事件已废弃',
      'plugin.compat.category.hash-migrated': '样式前缀漂移',
      'plugin.compat.category.attribute-removed': 'DOM属性已删除',
      'plugin.compat.meta.since': '影响版本：DSH ≥ {since}',
      'plugin.compat.meta.reason': '变更背景',
      'plugin.compat.meta.impact': '潜在影响',
      'plugin.compat.meta.advice': '适配建议',
      'plugin.compat.reason.client-runtime': 'DSH 0.1.2-alpha.2 官方 web roster 移除客户端供应商 @deepseek-ai/dsh-client-runtime',
      'plugin.compat.impact.client-runtime': '浏览器半加载器等待缺失供应商，导致插件卡在 pending 状态无法激活',
      'plugin.compat.advice.client-runtime': '在 package.json 的 dsh.client.inject 中移除该依赖声明',
      'plugin.compat.reason.sqlite-persistence': 'DSH 0.1.2-alpha.3 移除 SQLite 会话持久化包，官方仅交付 JSONL',
      'plugin.compat.impact.sqlite-persistence': '引入该包会导致模块解析失败或启动异常',
      'plugin.compat.advice.sqlite-persistence': '移除对 sqlite persistence 的依赖，改用官方 JSONL 或公共会话接口',
      'plugin.compat.reason.code-runtime': 'DSH 0.1.6-alpha.1 代码执行包更名重构，由 ptc-runtime 取代',
      'plugin.compat.impact.code-runtime': '依赖该包的代码执行器无法加载',
      'plugin.compat.advice.code-runtime': '更新为新版 @deepseek-ai/dsh-ptc-runtime',
      'plugin.compat.reason.e2b-runtime': 'DSH 0.1.6-alpha.1 移除内置 E2B 沙箱后端',
      'plugin.compat.impact.e2b-runtime': '依赖该包的沙箱逻辑无法加载',
      'plugin.compat.advice.e2b-runtime': '改用官方推荐的执行环境或外部 MCP',
      'plugin.compat.reason.session-start-event': 'DSH 0.1.6-alpha.1 统一生命周期事件派发，移除「agent/session-start」事件',
      'plugin.compat.impact.session-start-event': '事件监听永不触发，导致时序挂钩逻辑失效',
      'plugin.compat.advice.session-start-event': '改用 ctx.on 监听 agent/created 事件并在 payload 中读取 source',
      'plugin.compat.reason.chat-hash': 'DSH 0.1.2-alpha.2 聊天视图独立拆包，CSS Module 前缀漂移（Md3f7G_ → EvIC1a_）',
      'plugin.compat.impact.chat-hash': '写死旧类名前缀的选择器无法命中目标 DOM',
      'plugin.compat.advice.chat-hash': '改用词干后缀模糊匹配（如 [class*="_toBottomSlot"]）',
      'plugin.compat.reason.stats-hash': 'DSH 0.1.2-alpha.2 统计条样式前缀由 FJxK0a_ 漂移至 -NDN2W_',
      'plugin.compat.impact.stats-hash': '写死该类名的选择器匹配失败',
      'plugin.compat.advice.stats-hash': '改用词干匹配，或在 0.1.5+ 适配新版 StatsPills 胶囊',
      'plugin.compat.reason.time-hover-root': 'DSH 0.1.2-alpha.2 移除 data-time-hover-root 属性',
      'plugin.compat.impact.time-hover-root': '依赖该属性定位回合时间的脚本扑空',
      'plugin.compat.advice.time-hover-root': '改用官方稳定的 [data-turn-tail] 属性定位回合尾部',
      'plugin.compat.reason.settings-plugin-item': 'DSH 0.1.6-alpha.2 设置面板重构，移除了 settings.plugin.item 槽位',
      'plugin.compat.impact.settings-plugin-item': '配置卡片不会在设置页渲染；插件本体运行正常',
      'plugin.compat.advice.settings-plugin-item': '迁移至独立插件页槽位 plugins.bundle.config，或保留双版本注册',
      'plugin.compat.reason.sessions-open-method': 'DSH 0.1.6-alpha.2 引入会话生命周期管理，ISessions 移除 open 方法',
      'plugin.compat.impact.sessions-open-method': '调用 sessions.open 方法静默无响应或抛错',
      'plugin.compat.advice.sessions-open-method': '改用 uiWorkspace.openSession 或保留两层降级调用',
      'plugin.compat.break.client-runtime': '声明了已移除的客户端供应商 @deepseek-ai/dsh-client-runtime（0.1.2-alpha.2 起官方 roster 移除，浏览器半可能无法挂载）',
      'plugin.compat.break.sqlite-persistence': '依赖已移除的会话持久化后端 @deepseek-ai/dsh-session-persistence-sqlite（0.1.2-alpha.3 起官方仅交付 JSONL）',
      'plugin.compat.break.code-runtime': '依赖已移除的代码执行后端 @deepseek-ai/dsh-code-runtime（0.1.6-alpha.1 起由 ptc-runtime 取代）',
      'plugin.compat.break.e2b-runtime': '依赖已移除的沙箱执行器 @deepseek-ai/dsh-e2b（0.1.6-alpha.1 起官方移除内置 E2B）',
      'plugin.compat.break.session-start-event': '监听已移除的会话生命周期事件 agent/session-start（0.1.6-alpha.1 起由 agent/created 携带 source 统一取代）',
      'plugin.compat.break.settings-plugin-item': '为兼容老版本宿主保留了已退役的设置页槽位 settings.plugin.item（0.1.6-alpha.2 起新版宿主不再渲染该槽位，配置卡片改由插件管理页 plugins.bundle.config 承载；插件本体照常运行，仅配置入口位置变化，无需处理）',
      'plugin.compat.break.sessions-open-method': '调用已移除的命令式会话打开方法 sessions.open（0.1.6-alpha.2 起 ISessions 移除该方法，点击无响应，官方改由 ui-workspace 的 openSession 承载）',
      'plugin.compat.break.chat-hash': '引用已迁移的聊天界面旧样式前缀（Md3f7G_，0.1.2-alpha.2 起漂移至 EvIC1a_）',
      'plugin.compat.break.stats-hash': '引用已迁移的统计条旧样式前缀（FJxK0a_，0.1.2-alpha.2 起漂移至 -NDN2W_）',
      'plugin.compat.break.time-hover-root': '使用已移除的元素属性 data-time-hover-root（0.1.2-alpha.2 起由 data-turn-tail 取代）',
      'plugin.compat.unknown.unresolved': '包清单不可解析',
      'plugin.compat.unknown.missing-entry': '未找到可扫描的入口文件',
      'plugin.compat.unknown.too-large': '入口文件超过扫描上限（4 MiB）',
      'tabs.overview': '概览',
      'tabs.notify': '通知',
      'tabs.health': '健康诊断',
      'tabs.usage': '模型统计',
      'tabs.quota': '额度查询',
      'overview.container': '进程与运行环境',
      'overview.errors': '报错信息',
      // v0.39 概览分段布局：状态摘要/可行动项文案。
      'overview.status.normal': '所有系统运行正常',
      'overview.status.info': '有 {count} 条提示',
      'overview.status.warning': '有 {count} 项需要注意',
      'overview.status.error': '有 {count} 项需要处理',
      'overview.backupEmpty': '还没有备份，建议创建一份',
      'overview.updateAvailable': '检测到新版本可用',
      'tabs.backup': '备份维护',
      'tabs.restart': '重启',
      // v0.39 六页信息架构：顶层 维护/配置 聚合页 + 配置页两个子页 + 功能分组标题。
      'tabs.maintenance': '维护',
      'tabs.configuration': '配置',
      'tabs.features': '功能',
      'tabs.notifications': '通知',
      'tabs.navOrder': '设置栏标签',
      'config.navOrder.title': '设置栏标签排序与显隐',
      'config.navOrder.moveUp': '上移',
      'config.navOrder.moveDown': '下移',
      'config.navOrder.visible': '显示',
      'config.navOrder.hidden': '隐藏',
      'config.navOrder.locked': '当前面板（不可隐藏）',
      'config.navOrder.reset': '恢复默认排序',
      'config.navOrder.saved': '已保存',
      'config.navOrder.save': '保存排序',
      'config.navOrder.empty': '未检测到已注册的设置栏标签',
      'maintenance.empty': '所有维护子页均已关闭。可在「配置 → 功能」中开启备份、技能、子代理或会话管理。',
      'config.notificationsDisabled': '任务通知功能已在「功能」页关闭，以下设置仅作展示；重新开启后通知才会生效。',
      'features.group.runtime': '运行与观测',
      'features.group.maintenance': '维护',
      'features.group.interaction': '交互',
      // v0.39 页面头部描述（标题复用 tabs.*）。
      'page.configuration.desc': '功能开关与任务通知设置。',
      'tabs.alert.title': '服务控制提醒',
      'tabs.alert.body': '以下功能需要处理：{tabs}',
      'tabs.alert.join': '、',
      'tabs.alert.dot': '此标签存在故障提醒',
      'permissions.title': '文件权限',
      'permissions.description': '检查 Agent 能否读写并进入 DSH_HOME 与工作区。深检跳过 .git；修复补充当前用户所需权限并保留执行位。',
      'permissions.target': '目标属主：{owner}',
      'permissions.repair': '修复权限',
      'permissions.repairing': '修复中…',
      'permissions.confirm': '确认修复',
      'permissions.confirmHint': '跳过 .git，递归恢复当前用户属主并补充 Agent 读写权限，保留已有执行位。',
      'permissions.cancel': '取消',
      // v0.39 折叠区开关文案。
      'permissions.show': '权限与修复',
      'permissions.hide': '收起',
      'permissions.error': '权限操作失败',
      'permissions.summary.ok': '{count} 个根目录检查正常',
      'permissions.summary.warning': '发现 {count} 个根目录异常',
      'permissions.showDetails': '查看详情',
      'permissions.hideDetails': '隐藏详情',
      'permissions.deep': '深度检查',
      'permissions.deepChecking': '扫描中…',
      'permissions.deepSummary': '扫描 {scanned} 项，用时 {duration} ms；目录不可编辑 {directories}，文件不可编辑 {files}，无法读取 {unreadable}。',
      'backup.title': '备份管理',
      'backup.description': '备份会话、配置与插件 profile 清单，不含 node_modules 与凭据；不自动清理。',
      'backup.create': '创建备份',
      'backup.creating': '创建中…',
      'backup.progress.copy': '正在复制会话数据（{current}/{total}）…',
      'backup.progress.archive': '正在打包归档（{current}/{total}）…',
      'backup.progress.validate': '正在校验归档（{current}/{total}）…',
      'backup.progress.publish': '正在发布备份（{current}/{total}）…',
      'backup.total': '总体积：{size}',
      'backup.empty': '还没有备份。',
      'backup.delete': '删除',
      'backup.confirm': '确认删除',
      'backup.confirmHint': '确认删除这个备份？此操作无法撤销。',
      'backup.cancel': '取消',
      'backup.error': '备份操作失败',
      'backup.export': '导出',
      'backup.exporting': '导出中…',
      'backup.exportError': '备份导出失败',
      'backup.restore': '恢复',
      'backup.inspecting': '检查中…',
      'backup.restoreConfirm': '确认恢复',
      'backup.restoreHint': '完整性检查通过。确认后会按下方计划覆盖数据；提交前宿主会再次检查归档和当前目标是否发生变化。',
      'backup.restoreError': '备份恢复失败',
      'backup.integrity.ok': '完整性检查通过',
      'backup.integrity.invalid': '归档不可恢复',
      'backup.integrity.summary': '共 {entries} 个条目，解压后 {size}；会话文件 {sessions}，配置文件 {config}，profile 清单 {profiles}。',
      'backup.integrity.format': '归档格式 {format}',
      'backup.format.v1': 'v1（不含 Profile 补丁层）',
      'backup.format.v2': 'v2（含 Profile 补丁层）',
      'backup.plan.sessions': '会话目录将整体替换',
      'backup.plan.config': '配置覆盖 {replace} 项，移除 {remove} 项',
      'backup.plan.profiles': '覆盖 {count} 个 profile 的 package.json，保留 node_modules 与其他文件',
      'backup.plan.profilePatches': '恢复 {count} 个 profile 的 cordis.patch.yml（Profile 配置层）',
      'backup.plan.profilePatchesAbsent': '该归档来自旧版备份，未包含 Profile 补丁层（cordis.patch.yml）：现有配置保持不变，不会被覆盖或删除。',
      'backup.plan.expires': '恢复计划有效至 {time}',
      'backup.manualRestartTitle': '恢复完成，需要手动重启',
      'backup.manualRestartBody': '数据已恢复，但当前进程仍在运行旧状态。请在运行 dsh 的终端按 Ctrl+C，然后重新启动 dsh。',
      'backup.error.backup-gzip-invalid': '归档不是有效的 gzip 文件或已损坏。',
      'backup.error.backup-tar-invalid': 'tar 结构或校验和无效。',
      'backup.error.backup-entry-traversal': '归档含越界或不安全路径。',
      'backup.error.backup-entry-absolute': '归档含绝对路径。',
      'backup.error.backup-entry-link': '归档含符号链接或硬链接。',
      'backup.error.backup-entry-type': '归档含不支持的特殊条目。',
       'backup.error.backup-entry-platform': '归档包含其他系统不兼容的文件名。',
      'backup.error.backup-entry-unexpected': '归档含备份范围外的文件。',
      'backup.error.backup-profile-invalid': 'profile package.json 无效。',
      'backup.error.backup-section-missing': '归档缺少必要分区。',
      'backup.error.backup-size-limit': '归档超过安全大小或条目限制。',
      'backup.error.backup-archive-invalid': '归档未通过完整性检查。',
      'backup.error.backup-archive-incomplete': '归档内容与备份源不一致（有文件未被完整收录），未发布。',
       'backup.error.backup-source-changed': '会话正在写入，备份未完成，请稍后重试。',
       'backup.error.backup-source-unsafe': '备份源含符号链接或特殊文件，已拒绝创建。',
       'backup.error.tar-failed': '归档工具执行失败，请检查 tar/gzip 是否可用。',
      'backup.error.active-work': '检测到运行中的工作，暂不能恢复。',
      'backup.error.restore-plan-expired': '恢复计划已过期，请重新检查。',
      'backup.error.restore-source-changed': '备份归档在确认前发生变化，请重新检查。',
      'backup.error.restore-target-changed': '当前数据在确认前发生变化，请重新检查。',
      'backup.error.restore-target-unsafe': '当前目标含不安全的链接或特殊文件。',
      'backup.import': '导入备份',
      'backup.importing': '导入中…',
      'backup.showRecords': '展开备份记录',
      'backup.hideRecords': '收起备份记录',
      'version.title': '版本信息',
      'version.current': 'DSH：',
      'version.plugin': 'dsh-service：',
      'version.loading': '加载中…',
      'update.check': '检查更新',
      'update.checking': '检查中…',
      'update.current': '已是最新版本',
      'update.available': '有新版本：{version}',
      'update.installedPendingRestart': '已安装 {version}，重启后生效',
      'update.notes.button': '本次更新内容',
      'update.notes.hide': '收起更新内容',
      'update.notes.loading': '正在读取更新内容…',
      'update.notes.empty': '这一版没有填写更新说明。',
      'update.notes.truncated': '（内容过长，仅显示前 {chars} 个字符）',
      'update.notes.publishedAt': '发布于 {date}',
      'update.notes.version': '版本 {version}',
      'update.notes.prerelease': '预发布',
      'update.notes.error.release-not-found': '这一版的发布说明还没上线（版本先发到 npm、release 稍后补上）。',
      'update.notes.retry': '重试',
      'update.notes.error.release-unavailable': '读取更新内容失败，请稍后重试。',
      'update.unavailable': '暂时无法检查最新版本',
      'update.unpublished': '尚未发布可检查版本',
      'health.recheck': '重新诊断',
      'update.upgrade': '升级插件',
      'update.upgrading': '升级中…',
      'update.upgradeError': '插件升级失败',
      'update.upgradeErrorDetail': '插件升级失败（{detail}）',
      'update.upgradeSuccess': '升级成功，服务重启中…',
      'update.guardActiveWork': '有活动中的会话或后台任务，请处理完毕后再升级',
      'update.guardLinkInstall': '插件通过 link: 安装（开发模式），不能从 registry 一键升级；请更新源码仓库后重启',
      'update.guardFileInstall': '插件通过 file: 安装，不能从 registry 一键升级',
      'update.guardNoNewer': 'registry 最新版不高于当前版本，已拒绝可能回退的升级',
      'update.guardNoProfile': '没有找到安装了本插件的 profile，无法定位升级目标',
      'update.guardAmbiguous': '多个 profile 都安装了本插件且无法确定当前加载的副本，已中止',
      'update.guardStale': '命令报告成功但安装版本没有变化（可能被 pnpm 安全等待期拦下），保持当前版本不重启',
      'update.guardUnreadable': '命令成功但无法确认安装后的版本，已中止重启',
      'update.failPnpmMissing': '找不到 pnpm，无法执行升级；请先安装 pnpm 再重试',
      'update.failNetwork': '拉取依赖时网络临时失败，请稍后重试',
      'update.failFetchTimeout': '下载超时（网络较慢或安装包较大），请稍后重试',
      'update.failReleaseAge': '新版本被 pnpm 安全等待期拦截，已自动放行重试仍失败',
      'update.failHoist': 'profile 的 node_modules 由不同版本的 pnpm 创建，已重建重试仍失败',
      'update.failAddingToRoot': 'pnpm 拒绝在 workspace 根目录安装（缺少 -w）',
      'update.failNotWorkspace': 'profile 不是 pnpm workspace 却传入了 -w',
      'update.failIgnoredBuilds': '依赖构建脚本被 pnpm 默认拦截，无法完成升级',
      'env.kind.docker': 'Docker 容器',
      'env.kind.container': '容器（containerd/Kubernetes）',
      'env.kind.systemd': 'systemd 服务',
      'env.kind.pm2': 'pm2',
      'env.kind.supervisord': 'supervisord',
      'env.kind.kubernetes': 'Kubernetes',
      'env.kind.declared': '外部进程管理器（手动指定）',
      'update.manualConfirmTitle': '升级前请确认：当前疑似手动启动环境',
      'update.manualConfirm': '未检测到进程管理器。升级完成后 DSH 不会自动重启。',
      'update.manualProceed': '仍要升级',
      'update.manualRestartTitle': '升级完成，需要手动重启',
      'update.manualRestartBody': '新版本已安装，但当前进程仍在运行旧版本。请在运行 dsh 的终端窗口按 Ctrl+C（或直接关闭窗口），然后重新启动 dsh。',
      'restart.title': '服务重启',
      'restart.description': '重启 dsh web 进程。运行中的工作会中断，持久化会话可恢复。',
      'restart.button': '重启 dsh web',
      'restart.sending': '发送中…',
      'restart.confirm': '确认重启',
      'restart.force': '仍要重启',
      'restart.cancel': '取消',
      'restart.sent': '重启指令已发出。',
      'restart.sentHint': '页面连接即将断开，服务恢复后将自动刷新。',
      'restart.idleHint': '当前没有检测到运行中的工作。确认后将断开连接，等待服务自动重启。',
      'restart.manualWarn': '当前疑似终端手动启动环境：确认后进程将退出且不会自动拉起，需要你手动重新运行 dsh。',
      'restart.sentManualHint': '当前为手动启动环境，服务不会自动拉起；请在原终端重新运行 dsh 后刷新。',
      'restart.navToggle': '设置页左列显示「重启」入口',
      'restart.navToggleHint': '默认关闭；开启后在设置页左侧标签列底部显示快捷重启入口',
      'activity.agent': 'Agent',
      'activity.job': '后台任务',
      'activity.terminal': '终端',
      'activity.warning': '检测到 {count} 项运行中的工作，重启将中断。',
      'activity.item': '{type}：{label} ({status})',
      'error.update': '检查失败',
      'error.activity': '检查运行状态失败',
      'error.restart': '重启失败',
      'error.instance': '重启响应缺少进程实例标识',
      'usage.title': '模型使用',
      'usage.tooltip.date': '日期：{date}',
      'usage.tooltip.input': '输入 {value} token',
      'usage.tooltip.output': '输出 {value} token',
      'usage.tooltip.cache': '缓存命中 {value} token',
      'usage.tooltip.total': 'token 总量 {value}',
      'usage.tooltip.steps': '成功模型步骤 {value} 次',
      'usage.tooltip.hitRate': '缓存命中率 {value}',
      'usage.axis': 'token 纵轴',
      'usage.models.more': '展开其余 {count} 个模型',
      'usage.models.less': '收起模型列表',
      'usage.modelScope.today': '今日',
      'usage.modelScope.week': '近 7 天',
      'usage.modelScope.all': '累计',
      'usage.modelSortHint.today': '按今日 token 从多到少排列',
      'usage.modelSortHint.week': '按近 7 天 token 从多到少排列',
      'usage.modelSortHint.all': '按累计 token 从多到少排列',
      'usage.modelBar.today': '{model}：今日 {total} token',
      'usage.modelBar.week': '{model}：近 7 天 {total} token',
      'usage.modelBar.all': '{model}：累计 {total} token',
      'usage.refresh': '刷新统计',
      'usage.refreshing': '刷新中…',
      'usage.empty': '尚未建立使用统计索引。点击刷新统计开始只读建立索引。',
      'usage.error': '无法读取模型使用统计',
      'usage.allProjects': '全部项目',
      'usage.chartSummary': '七天内累计用量 {total} token',
      'usage.barDay': '{day} 总用量 {total} token',
      'usage.total': 'token 总量',
      'usage.steps': '成功模型步骤',
      'usage.stepsValue': '{count} 次',
      'usage.modelLine': '{steps}次 · 缓存命中 {hitRate} · 输入 {input} token · 输出 {output} token',
      'usage.input': '输入 token',
      'usage.output': '输出 token',
      'usage.cache': '缓存 token',
      'usage.hitRate': '缓存命中率',
      'usage.today': '今日',
      'usage.sevenDays': '近 7 天',
      // 热力日历（卡片最下方）：覆盖宿主索引内全部日期；星期/月份名走 Intl，不入词典。
      'usage.heatmap.title': '每日用量日历',
      'usage.heatmap.gridLabel': '每日 token 用量热力日历',
      'usage.heatmap.cell': '{date}：{total} token · {steps} 次模型步骤',
      'usage.heatmap.hourTitle': '用量打卡图（星期 × 小时）',
      'usage.heatmap.hourGridLabel': '按星期与小时的 token 用量打卡图',
      'usage.heatmap.hourCell': '{weekday} {hour} 时：{total} token · {steps} 次模型步骤',
      'usage.heatmap.scope.day': '每日',
      'usage.heatmap.scope.hour': '小时',
      'usage.heatmap.less': '少',
      'usage.heatmap.more': '多',
      'usage.errors.title': '模型报错',
      'usage.errors.toggle': '模型报错（{count} 类）',
      'usage.errors.recent': '最近 48 小时',
      'usage.errors.empty': '最近 48 小时没有记录到模型报错。',
      'usage.toolErrors.title': '工具报错',
      'usage.toolErrors.toggle': '工具报错（{count} 类）',
      'usage.toolErrors.empty': '最近 48 小时没有记录到工具报错。',
      'usage.errors.count': '{count} 次',
      'usage.failures.global': '全局会话统计（不受项目筛选影响）：成功统计 {successful} 个会话，跳过 {failed} 个会话。',
      'usage.failures.staleHint': '统计结果可能包含无法重新读取会话的旧缓存数据；这些数据已保留但可能过期。',
      'usage.failures.show': '查看跳过会话详情',
      'usage.failures.hide': '收起跳过会话详情',
      'usage.failures.dismiss': '关闭提示（出现新的跳过会话时会再次提示）',
      'usage.failures.id': '会话 ID',
      'usage.failures.code': '错误类型',
      'usage.failures.message': '原因',
      'usage.failures.stale': '保留上次统计（已过期，仍计入总量）',
      'usage.failures.notStale': '无可用缓存，未计入统计',
      'usage.failures.reason.format-migration-failed': '会话格式转换被拒绝。',
      'usage.failures.reason.session-read-failed': '无法打开或读取会话。',
      'usage.failures.reason.session-fold-failed': '无法统计会话事件。',
      'notification.title': '通知',
      'notification.description': '主会话任务结束，或会话需要授权、抉择时发送浏览器通知；子代理完成任务不通知。',
      'notification.enable': '开启通知',
      'notification.enabled': '通知已开启',
      'notification.disable': '关闭通知',
      'notification.denied': '通知权限被拒绝',
      'notification.master': '通知总开关',
      'notification.done': '任务结束通知',
      'notification.input': '授权与提问通知',
      'notification.doneTitle': '任务完成',
      'notification.doneBody': '{title} 已完成本轮任务',
      'notification.inputTitle': '需要你的确认',
      'notification.inputBody': '{title}（{kind}）',
      'notification.kind.approval': '等待授权',
      'notification.kind.plan-review': '等待审阅计划',
      'notification.kind.question': '等待选择答案',
      'notification.bellOn': '通知开启',
      'notification.bellOff': '通知关闭',
      'notification.bellShow': '显示输入框旁的铃铛图标',
      'quota.cardTitle': '额度查询',
      'quota.navToggle': '设置页左列显示「额度查询」入口',
      'quota.navToggleHint': '开启后在设置页左侧标签显示入口',
      'quota.window.rolling': '滚动 5 小时',
      'quota.window.tokens-limit-u3-n5': '5 小时 Token',
      'quota.window.tokens-limit-u6-n1': '本周 Token',
      'quota.window.tokens-limit': 'Token 额度',
      'quota.window.time-limit-u5-n1': 'MCP 配额',
      'quota.window.time-limit': 'MCP 配额',
      'quota.window.credit-limit': '点数额度',
      'quota.window.credits': '已用额度',
      'quota.window.balance': '余额',
      'quota.window.weekly': '本周',
      'quota.window.monthly': '本月',
      'quota.window.codex-5h': '5 小时',
      'quota.window.codex-day': '本日',
      'quota.window.codex-week': '本周',
      'quota.window.codex-month': '本月',
      'quota.window.gemini-5h': '5 小时',
      'quota.window.gemini-week': '本周',
      'quota.window.claude-5h': '5 小时',
      'quota.window.claude-week': '本周',
      'quota.panel.title': '额度用量',
      // 重置卡折叠（v1.9.1）：两处面板默认只显示最近要到期的那张，其余折叠。
      'quota.resetCard.more': '另有 {count} 张',
      'quota.resetCard.less': '收起',
      'quota.panel.used': '已用',
      'quota.panel.remaining': '剩余',
      'quota.ring.label': '额度查询',
      'quota.gauge.baseline': '基准满额',
      'quota.gauge.calibrate': '设当前为满额',
      'quota.gauge.calibrateTip': '将当前余额 {amount} 设为 100% 满额基准',
      'quota.gauge.ratio': '余量 {percent}%',
      'quota.filter.showAll': '查看全部额度 ({count})',
      'quota.filter.currentOnly': '仅看当前模型',
      'quota.updated': '更新于 {time}',
      'quota.refreshing': '刷新中…',
      'quota.empty': '暂无数据',
      'quota.resetIn': '重置于 {time}',
      'quota.window.stale': '缓存',
      'quota.window.staleTip': '该账号实时查询失败，显示的是 CPA 上次缓存的快照（非实时值）',
      'quota.family.gemini': 'Gemini',
      'quota.family.claude': 'Claude',
      'quota.family.codex': 'Codex',
      'quota.family.other': '其他',
      'quota.resetCard.title': '重置卡',
      // 弹窗重置卡分区的归属标题（仅 CPA）：卡都是 codex 账号的，不标注会被误读成 Gemini 的重置卡。
      'quota.resetCard.codexTitle': 'Codex 重置卡',
      'quota.resetCard.expires': '{date} 到期',
      'quota.resetCard.expired': '已过期',
      'quota.resetCard.edit': '添加重置卡',
      // v0.39 卡片分区：最紧窗口徽标 / 配置折叠 / 重置区标题。
      'quota.advanced': '配置',
      'quota.resetCard.dateLabel': '到期日期',
      'quota.resetCard.nameLabel': '名称（可选）',
      'quota.resetCard.add': '添加',
      'quota.resetCard.cancel': '取消',
      'quota.resetCard.remove': '移除',
      'quota.retryAt': '{time} 后可重试',
      'quota.refresh': '刷新',
      'quota.reorder': '调整排序与显隐',
      'quota.order.title': '额度卡排序与显隐',
      'quota.order.hint': '可通过拖拽或点击上下箭头调整卡片顺序；关闭开关可隐藏不常用卡片（隐藏只影响展示，不影响查询）。',
      'quota.order.allHidden': '所有已适配卡片都被隐藏了；在「调整排序与显隐」里打开开关即可恢复显示。',
      'quota.usageLink': '打开官网用量页',
      'quota.adapt': '适配',
      'quota.kind.opencode-go': 'OpenCode Go',
      'quota.kind.zai-coding-cn': '智谱 GLM Coding Plan',
      'quota.kind.openrouter': 'OpenRouter',
      'quota.kind.kimi': 'Kimi / Moonshot',
      'quota.kind.siliconflow': '硅基流动',
      'quota.kind.deepseek': 'DeepSeek 开放平台',
      'quota.kind.stepfun': 'StepFun 余额',
      'quota.kind.stepfun-step-plan': 'StepFun Step Plan 订阅',
      'quota.kind.cliproxy': 'CLIProxyAPI 账号额度',
      'quota.kind.xiaomi-token-plan-cn': '小米 MiMo Token Plan',
      'quota.kind.command-goat': 'Command Code 账号额度',
      'quota.window.total_token': '套餐总额度',
      'quota.window.compensation_total_token': '补偿积分',
      'quota.window.plan-name': '订阅套餐',
      'quota.window.credit-pool': '月度 Credit 池',
      'quota.window.topup-credit': '加油包 Credit',
      'quota.window.five-hour': '5 小时额度',
      'quota.window.period-spend': '本周期已用',
      'quota.error.no-subscription': '当前账号没有生效中的订阅额度',
      'quota.error.credential-rejected': '凭据被上游拒绝，请重新填写（控制台类渠道请重新从浏览器复制登录态）',
      'quota.credential.editCookie': '填写控制台 Cookie（网页登录态）',
      'quota.credential.editToken': '填写控制台令牌（Oasis-Token，浏览器登录态）',
      'quota.kindAuto': '自动识别',
      'quota.noAdapted': '暂无已适配的供应商，可在下方手动适配',
      'quota.disable': '停用查询',
      'quota.followAuto': '跟随自动识别',
      'quota.addAdapt': '手动适配：',
      'quota.addPickProvider': '选择供应商',
      'quota.addPickKind': '选择类型',
      'quota.saveFailed': '保存失败：{error}',
      'quota.unknownProvider': '未知供应商',
      'quota.error.credential-missing': '凭据未配置（请在 DSH 凭据中设置对应 API key）',
      'quota.error.no-base-url': '该供应商未配置 baseURL',
      'quota.error.credentials-unavailable': '凭据服务不可用',
      'quota.error.http-status': '上游返回错误状态',
      'quota.error.network': '网络错误',
      'quota.error.network-transient': '网络不稳定（已自动重试）',
      'quota.error.timeout': '请求超时',
      'quota.error.bad-payload': '响应格式异常',
      'quota.error.mgmt-disabled': 'CLIProxyAPI 管理面未启用（未设置 remote-management secret-key）',
      'quota.error.host-not-pinned': 'baseURL 与适配时记录的域名不一致，请重新保存适配',
      'quota.error.upstream-status': '上游官方接口返回错误状态',
      'quota.error.upstream-error': '上游服务故障（额度接口报错，稍后自动重试）',
      'quota.credential.edit': '填写 API 密钥',
      'quota.credential.editManagement': '填写管理密钥（网页登录的 key）',
      'quota.credential.nameLabel': '凭据名称',
      'quota.credential.valueLabel': '密钥值',
      'quota.credential.save': '保存',
      'quota.credential.primary': '主名（别名存一即可）',
      'quota.credential.clear': '清除已存',
      'quota.credential.clearConfirm': '再次点击清除',
      'quota.credential.configured': '已配置',
      'quota.credential.notConfigured': '未配置',
      'quota.credential.saveFailed': '凭据保存失败：{error}',
      'quota.credential.unknown-hint': '未知凭据名',
      'quota.credential.invalid-value': '密钥值不能为空',
      'quota.credential.credentials-unavailable': '凭据服务不可用',
      'quota.error.unknown': '未知错误',
      'quota.unadapted': '该供应商未适配，请先在下方选择类型',
      'quota.unit.day': '{count} 天',
      'quota.unit.hour': '{count} 小时',
      'quota.unit.minute': '{count} 分钟',
      'quota.window.granted-balance': '赠送余额（未过期）',
      'quota.peak.nowIdle': '当前空闲时段 · 半价计费',
      'quota.peak.nowPeak': '当前高峰时段 · 标准价',
      'quota.peak.untilIdle': '{time} 转空闲（{dur}后）',
      'quota.peak.untilPeak': '{time} 转高峰（{dur}后）',
      'quota.peak.tag.peak': '忙时',
      'quota.peak.tag.idle': '闲时',
      'quota.peak.caption': '空闲时段价格为高峰时段价格的一半。高峰时段：北京时间周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00；其余时段，包括周末及中国法定节假日全天均为空闲时段。',
      'quota.peak.caption.degraded': '暂未收录 {year} 年的中国法定节假日安排，本年度按「周一至周五 09:00–12:00、14:00–18:00」估算，节假日期内可能显示为高峰；更新插件后即可自动收录当年安排。',
      'quota.peak.caption.zai': '非高峰时段模型调用按基础积分的 50% 抵扣。高峰时段：每周一至周五 14:00–18:00（UTC+8）；其余时间为非高峰时段，周六和周日全天空闲。',
      // ── 官方右栏文件编辑（v1.6 用户点名）────────────────────────────────
      'features.fileEditor': '右栏文件编辑',
      'features.modelProviderIcons': '模型厂家图标',
      'editor.viewer': '编辑',
      'editor.loading': '正在读取文件…',
      'editor.preview': '预览',
      'editor.save': '保存',
      'editor.saving': '保存中…',
      'editor.saved': '已保存',
      'editor.unsaved': '未保存',
      'editor.reload': '重新加载',
      'editor.undo': '撤销保存',
      'editor.keyHint': 'Ctrl/Cmd + S 保存',
      'editor.conflict.title': '磁盘内容已变化，保存被拒绝',
      'editor.conflict.body': '文件在打开后被其他改动覆盖（Agent 或其他窗口写入）。重新加载会丢弃你的修改，覆盖会把当前编辑内容直接写盘。',
      'editor.conflict.reload': '重新加载（丢弃修改）',
      'editor.conflict.overwrite': '用我的内容覆盖',
      'editor.confirm.previewTitle': '返回预览',
      'editor.confirm.previewBody': '有未保存的修改，返回官方预览将丢弃这些修改。',
      'editor.confirm.saveBack': '保存并返回',
      'editor.confirm.discardBack': '丢弃并返回',
      'editor.confirm.reloadTitle': '重新加载',
      'editor.confirm.reloadBody': '有未保存的修改，重新加载将丢弃这些修改并读取磁盘当前内容。',
      'editor.confirm.reloadGo': '丢弃并重新加载',
      'editor.confirm.undoTitle': '撤销保存',
      'editor.confirm.undoBody': '将把文件恢复为本次保存之前的内容；未保存的修改会一并丢弃。',
      'editor.confirm.cancel': '继续编辑',
      'editor.undoConflict.title': '无法自动撤销',
      'editor.undoConflict.body': '磁盘内容在本次保存之后又发生了变化，不能自动恢复为保存前内容；可重新加载查看当前内容。',
      'editor.undoConflict.dismiss': '关闭',
      'editor.readonlyHint': '只读',
      'editor.retry': '重试',
      'editor.error.file-not-found': '文件不存在（可能已被移动或删除）。',
      'editor.error.not-regular-file': '这不是普通文件，无法编辑。',
      'editor.error.too-large': '文件超过 {limit}，右栏编辑器只读：请用其他预览器查看。',
      'editor.error.binary-file': '不是 UTF-8 文本文件，右栏编辑器无法编辑。',
      'editor.error.session-not-live': '该会话当前未激活，无法编辑（可切换到其他预览器查看）。',
      'editor.error.file-forbidden': '当前会话的沙箱策略不允许写入这个文件。',
      'editor.error.unavailable': '宿主文件服务不可用，暂时无法编辑。',
      'editor.error.invalid-address': '文件地址无法识别，无法编辑。',
      'editor.error.file-stale': '磁盘内容已变化，请重新加载后再保存。',
      'editor.error.file-failed': '读写失败，请重试。',
      'editor.error.feature-disabled': '「右栏文件编辑」已在插件配置里关闭。',
      'editor.error.internal': '操作失败，请重试。',
    }
    const en = {
      'nav.label': 'Service Control',
      'nav.restart': 'Restart',
      'features.cardTitle': 'Service control (dsh-service)',
      'features.cardHint': 'Controls optional features and external capabilities. Switches apply instantly without restart.',
      'features.external': 'External capabilities',
      'features.healthDiagnostics': 'Health diagnostics',
      'features.modelUsage': 'Model statistics',
      'features.quotaLookup': 'Quota lookup',
      'features.backupMaintenance': 'Backup maintenance',
      'features.taskNotifications': 'Task notifications',
      'features.healthz': '/healthz liveness endpoint',
      'features.skillManager': 'Skill manager',
      'features.readOnly': 'These settings are read-only.',
      'tabs.skills': 'Skills',
      'tabs.subagent': 'Subagents',
      'tabs.sessions': 'Sessions',
      'features.subagentRoute': 'Subagent model',
      'features.mobileAdaptation': 'Mobile adaptation',
      'features.sessionManager': 'Session manager',
      'sessions.title': 'Session manager',
      'sessions.filter.all': 'All',
      'sessions.filter.archived': 'Archived',
      'sessions.filter.deleted': 'Deleted',
      'sessions.filter.subagent': 'Subagents only',
      'sessions.refresh': 'Refresh',
      'sessions.batch.enter': 'Select multiple',
      'sessions.batch.exit': 'Exit selection',
      'sessions.batch.selectAll': 'Select all',
      'sessions.batch.clearAll': 'Clear all',
      'sessions.batch.selectSubagents': 'Select subagents',
      'sessions.batch.selected': '{count} selected',
      'sessions.batch.selectRow': 'Select session: {title}',
      'sessions.batch.export': 'Export ({count})',
      'sessions.batch.archive': 'Archive ({count})',
      'sessions.batch.unarchive': 'Unarchive ({count})',
      'sessions.batch.delete': 'Delete ({count})',
      'sessions.batch.clear': 'Clear ({count})',
      'sessions.batch.completed': '{action} completed for {count}',
      'sessions.batch.failed': '{action} completed for {done}/{total}; {error}',
      'sessions.batch.deleteTitle': 'Delete {count} sessions',
      'sessions.batch.deleteBody': 'This permanently deletes the logs of the archived sessions below. This cannot be undone.',
      'sessions.batch.deleteItem': '{title} ({bytes})',
      'sessions.batch.clearTitle': 'Clear {count} deleted records',
      'sessions.batch.clearBody': 'Are you sure you want to clear the following {count} deleted records? They will be permanently removed from the record list.',
      'sessions.status.loading': 'Loading…',
      'sessions.status.working': 'Working…',
      'sessions.status.unavailableTime': 'Time unavailable',
      'sessions.glyph.expand': '▸',
      'sessions.glyph.collapse': '▾',
      'sessions.glyph.back': '←',
      'sessions.search.placeholder': 'Search conversation content…',
      'sessions.search.archivedOnly': 'Search archived only',
      'sessions.sort.createdDesc': 'Created (newest first)',
      'sessions.sort.createdAsc': 'Created (oldest first)',
      'sessions.sort.title': 'By title',
      'sessions.sort.project': 'By project',
      'sessions.projectGroup.countOne': '1 session',
      'sessions.projectGroup.countMany': '{count} sessions',
      'sessions.projectGroup.noCwd': '(no workspace)',
      'sessions.row.live': 'Running',
      'sessions.row.archived': 'Archived',
      'sessions.row.deleted': 'Deleted',
      'sessions.row.subagent': 'Subagent',
      'sessions.subagent.hostLegacy': 'The plugin host is outdated and the list carries no subagent flags; upgrade the plugin and restart dsh for “Subagents only” to take effect',
      'sessions.row.events': '{count} events',
      'sessions.row.noTitle': '（No title）',
      'sessions.action.view': 'View',
      'sessions.action.export': 'Export',
      'sessions.action.archive': 'Archive',
      'sessions.action.unarchive': 'Unarchive',
      'sessions.action.delete': 'Delete',
      'sessions.action.clear': 'Clear',
      'sessions.empty.all': 'No sessions',
      'sessions.empty.archived': 'No archived sessions',
      'sessions.empty.deleted': 'No deleted sessions yet',
      'sessions.empty.search': 'No matches for “{query}”',
      'sessions.error.load': 'Load failed: {error}',
      'sessions.error.feature-disabled': 'Session manager is disabled in settings',
      'sessions.error.network': 'Network error: cannot reach the host',
      'sessions.error.session-not-found': 'Session not found or already deleted',
      'sessions.error.live-session-rejected': 'Session is running and cannot be deleted',
      'sessions.error.session-not-archived': 'Only archived sessions can be deleted',
      'sessions.error.unknown-delete-plan': 'Delete request expired, please retry',
      'sessions.error.invalid-session-ids': 'Invalid session IDs',
      'sessions.error.unarchive-unsupported': 'Unarchiving is not supported by current host (requires DSH ≥ 0.1.6)',
      'sessions.error.export-failed': 'Export failed: {error}',
      'sessions.detail.back': 'Back to list',
      'sessions.detail.open': 'Open in official view',
      'sessions.detail.archiveDisabled': 'Archived or blank sessions cannot be opened in the official view',
      'sessions.detail.exportAll': 'Export full ZIP',
      'sessions.detail.exporting': 'Exporting…',
      'sessions.detail.loadMore': 'Load more ({remaining})',
      'sessions.detail.noMore': 'All {total} events loaded',
      'sessions.detail.noise': 'System events',
      'sessions.detail.noiseBlock': '{count} system events',
      'sessions.detail.noiseExpand': 'Expand all',
      'sessions.detail.noiseCollapse': 'Collapse',
      'sessions.detail.toolBlock': '{count} tool messages',
      'sessions.detail.toolCollapse': 'Collapse',
      'sessions.detail.cwd': '{cwd}',
      'sessions.detail.created': 'Created {time}',
      'sessions.md.copy': 'Copy',
      'sessions.md.copied': 'Copied',
      'sessions.md.footnotes': 'Footnotes',
      'sessions.hit.title': '{count} hits',
      'sessions.hit.return': 'Back to search results',
      'sessions.hit.badge': 'HIT',
      'sessions.hit.prev': '◀ Prev',
      'sessions.hit.next': 'Next ▶',
      'sessions.hit.inSession': '{count} matches in this session',
      'sessions.delete.title': 'Delete session',
      'sessions.delete.body': 'This permanently deletes the session log below. This cannot be undone.',
      'sessions.delete.consequence.log': 'Delete session log ({bytes})',
      'sessions.delete.consequence.sidebar': 'Session disappears from the official sidebar',
      'sessions.delete.confirm': 'Delete',
      'sessions.delete.cancel': 'Cancel',
      'sessions.delete.done': 'Deleted',
      'sessions.clear.title': 'Clear deleted record',
      'sessions.clear.body': 'Are you sure you want to clear this deleted record? It will be permanently removed from the record list.',
      'sessions.clear.confirm': 'Clear',
      'sessions.clear.cancel': 'Cancel',
      'sessions.export.includes': 'Includes subagents and attachments',
      'sessions.navToggle': 'Show “Sessions” entry in the settings sidebar',
      'sessions.oneWay': 'Archiving cannot be undone',
      'sessions.oneWayHint': 'Archived sessions are hidden from the official sidebar; the official UI cannot unarchive, deletion here is the only way out.',
      'mobile.fab.label': 'Open sidebar menu',
      'mobile.debug.title': 'Mobile diagnostics',
      'mobile.debug.viewport': 'Viewport',
      'mobile.debug.drawer': 'Drawer',
      'mobile.debug.sidebarPanel': 'Side panel',
      'mobile.debug.details': 'Details',
      'mobile.debug.rightbar': 'Rightbar',
      'mobile.debug.errors': 'JS errors',
      'mobile.debug.stateOn': 'on',
      'mobile.debug.stateOff': 'off',
      'mobile.debug.immersive': 'Immersive',
      'mobile.debug.immersive.reason.gesture': 'swipe',
      'mobile.debug.immersive.reason.arrival': 'arrival',
      'mobile.debug.immersive.reason.focus': 'focus',
      'mobile.debug.immersive.reason.button': 'to-bottom',
      'mobile.debug.edge': 'Edge',
      'mobile.debug.edge.fieldStart': 'start',
      'mobile.debug.edge.fieldMoves': 'moves',
      'mobile.debug.edge.fieldLast': 'last',
      'mobile.debug.edge.fieldCancel': 'cancel',
      'mobile.debug.edge.fieldReason': 'reason',
      'mobile.debug.edge.open': 'open',
      'mobile.debug.edge.leftOpen': 'open L',
      'mobile.debug.edge.rightOpen': 'open R',
      'mobile.debug.edge.leftClose': 'close L',
      'mobile.debug.edge.rightClose': 'close R',
      'mobile.debug.edge.reason.multiTouch': 'multi-touch',
      'mobile.debug.edge.reason.modal': 'modal',
      'mobile.debug.edge.reason.hScroll': 'h-scroll',
      'mobile.debug.edge.reason.noPoint': 'no point',
      'mobile.debug.edge.reason.absentRight': 'right sidebar absent',
      'mobile.debug.edge.reason.badButton': 'right sidebar toggle unavailable',
      'mobile.debug.edge.reason.noTracker': 'no tracker',
      'conversation.jump.previousReply': 'Previous user message',
      'subagent.title': 'Subagent model',
      'subagent.loading': 'Reading configuration…',
      'subagent.hint': 'Controls the model used by subagents without an explicit model; explicitly specified ones are unaffected. Switching modes keeps the saved custom model and fallback list; switch back to "Custom" to reuse them.',
      'subagent.mode.label': 'Mode',
      'subagent.mode.inherit': 'Default (no override)',
      'subagent.mode.inherit.desc': 'Injects nothing and keeps the native inheritance: subagents use the model baked in when the session was created.',
      'subagent.mode.follow': 'Follow main model',
      'subagent.mode.follow.desc': 'Each delegation reads the model the main conversation actually uses right now (route of its latest request) and injects it.',
      'subagent.mode.custom': 'Custom',
      'subagent.mode.custom.desc': 'Every delegation without an explicit model uses the model selected below.',
      'subagent.provider': 'Provider',
      'subagent.model': 'Model',
      'subagent.reasoningEffort': 'Reasoning effort',
      'subagent.reasoningEffort.default': 'Use model default (unspecified)',
      'subagent.reasoningEffort.unavailable': 'This model does not declare selectable reasoning levels',
      'subagent.modelsEmpty': 'Model list is empty: host LLM channels cannot be resolved.',
      'subagent.save': 'Save',
      'subagent.saved': 'Saved',
      'subagent.reset': 'Reset to default',
      'subagent.saving': 'Saving…',
      'subagent.unavailable': 'The host exposes no subagents registry (service missing); this configuration has no effect.',
      'subagent.error': 'Operation failed: {error}',
      'subagent.error.feature-disabled': 'Subagent model is switched off in settings',
      'subagent.error.llm-unavailable': 'Host LLM service is unavailable',
      'subagent.error.unknown-mode': 'Unknown mode',
      'subagent.error.invalid-model-route': 'Provider or model is not in the host catalog',
      'subagent.error.invalid-reasoning-effort': 'This reasoning effort is not supported by the selected model; choose another',
      'subagent.error.network': 'Network error: cannot reach the host',
      'subagent.fallback.title': 'Fallback models (in order)',
      'subagent.fallback.item': 'Fallback {index}',
      'subagent.fallback.hint': 'When the primary route is unavailable (channel unloaded, or quota state marks it unserviceable), try fallbacks in order; if none works, fall back to native inheritance instead of failing the delegation.',
      'subagent.fallback.add': 'Add fallback',
      'subagent.fallback.sort': 'Reorder',
      'subagent.fallback.sort.done': 'Done',
      'subagent.fallback.remove': 'Remove',
      'subagent.fallback.up': 'Move up',
      'subagent.fallback.down': 'Move down',
      'subagent.fallback.empty': 'No fallbacks: delegations fall back to native inheritance when the primary route is unavailable.',
      'subagent.fallback.limit': 'Limit reached ({max})',
      'subagent.error.invalid-fallback-route': 'Fallback entry is not in the host catalog, please choose again',
      'subagent.dock.label': 'Subagents: ',
      'subagent.dock.title': 'Show subagent info under the composer',
      'skills.error': 'Operation failed: {error}',
      'skills.error.feature-disabled': 'Skill manager is switched off in settings',
      'skills.error.network': 'Network error, try again later',
      'skills.error.read-only-source': 'This entry lives in a read-only source',
      'skills.error.unknown-skill': 'Skill not found; the list may have changed, refresh and retry',
      'skills.error.invalid-skill': 'Entry is currently invalid: {reason}',
      'skills.error.invalid-field': 'Invalid switch field',
      'skills.error.invalid-enable': 'Invalid switch value',
      'skills.error.invalid-model-route': 'Invalid model route; pick a model again',
      'skills.error.invalid-description': 'Description cannot be empty',
      'skills.error.describe-timeout': 'Model generation timed out (90s)',
      'skills.error.empty-output': 'Model produced no body output (finish: {kind})',
      'skills.error.batch-cancelled': 'Cancelled',
      'skills.error.entry-changed': 'Entry changed during the run; skipped',
      'skills.error.unknown-batch-plan': 'Batch plan is stale; regenerate it',
      'skills.error.batch-already-done': 'That batch already finished',
      'skills.error.batch-already-cancelled': 'That batch was already cancelled',
      'skills.error.annotated-confirm-required': 'Annotated skills need an explicit confirm before being overwritten',
      'skills.empty': 'No skills found',
      'skills.filter': 'Filter by name…',
      'skills.expandAll': 'Expand all',
      'skills.collapseAll': 'Collapse all',
      'skills.colon': ': ',
      'skills.group.auto': 'Auto-loaded',
      'skills.group.manual': 'Manual only',
      'skills.group.disabled': 'Fully disabled',
      'skills.source.project-dsh': 'Project .dsh',
      'skills.source.project-agents': 'Project .agents',
      'skills.source.user-dsh': 'User DSH',
      'skills.source.user-agents': 'User .agents',
      'skills.source.bundled': 'Bundled',
      'skills.source.custom': 'Custom dir',
      'skills.badge.shadowed': 'Shadowed',
      'skills.badge.readonly': 'Read-only',
      'skills.badge.annotated': 'Annotated',
      'skills.note.stale': 'Body changed; refill needed',
      'skills.note.remove': 'Remove AI note',
      'skills.note.panelOnly': 'Notes are stored and shown in this panel only; SKILL.md is never modified.',
      'skills.log.title': 'Run log',
      'skills.log.located': 'Located skill {name} ({chars} chars)',
      'skills.log.attempt': 'Attempt {n}/{total}: calling {route}',
      'skills.log.received': 'Output received ({chars} chars), parsing JSON…',
      'skills.log.parsed': 'Parsed OK, draft ready',
      'skills.log.failed-retry': 'Failed: {message}, retrying',
      'skills.log.failed': 'Failed: {message}',
      'skills.log.wait': 'Waiting for model output… {secs}s',
      'skills.log.first-delta': 'Model started returning',
      'skills.log.first-reasoning': 'Model started returning (reasoning first)',
      'skills.log.progress': 'Received {chars} chars',
      'skills.log.finish-reasoning-only': 'Finished: {kind} (only {chars} reasoning chars, no body)',
      'skills.log.finish-empty': 'Finished: {kind} (no output)',
      'skills.log.block-extract': 'Extracted body from whole block ({chars} chars)',
      'skills.log.item-start': 'Generating note…',
      'skills.batch.toggle': 'Batch annotate',
      'skills.batch.collapse': 'Collapse',
      'skills.batch.already': 'A batch is already running; wait for it or cancel first',
      'skills.invalid.legacy': 'Legacy invocation keys present; excluded from the model catalog',
      'skills.invalid.other': 'Invalid entry: {reason}',
      'skills.fix.legacy': 'Fix legacy keys',
      'skills.switch.model': 'Visible to model',
      'skills.switch.user': 'Invocable via /',
      'skills.switch.confirm': 'Click again to apply',
      'skills.describe.button': 'Fill with AI',
      'skills.describe.title': 'Fill metadata with AI — {name}',
      'skills.describe.model': 'Model',
      'skills.describe.models.loading': 'Loading models…',
      'skills.describe.models.empty': 'No configured models found',
      'skills.describe.run': 'Generate draft',
      'skills.describe.running': 'Generating…',
      'skills.apply.title': 'Save AI note — {name}',
      'skills.apply.description': 'Description',
      'skills.apply.usage': 'Usage',
      'skills.apply.old': 'Old',
      'skills.apply.new': 'New',
      'skills.apply.confirm': 'Save note',
      'skills.apply.done': 'Note saved',
      'skills.apply.keepusage': '(keep existing)',
      'skills.llm.unavailable': 'Host LLM service unavailable; AI fill disabled.',
      'skills.batch.title': 'Batch-fill skill descriptions',
      'skills.batch.hint': 'Call the selected model per skill to draft explanations for uncommented or changed skills; annotated skills are listed separately and are only overwritten after an explicit confirm. Results stay in the plugin and render below the entry.',
      'skills.batch.plan': 'Plan batch',
      'skills.batch.candidates': '{count} candidates',
      'skills.batch.estBytes': '~{size} of content will be sent',
      'skills.batch.skipped': '{count} skipped (invalid / shadowed)',
      'skills.batch.annotated': '{count} annotated will be overwritten',
      'skills.batch.annotatedList': 'To be overwritten',
      'skills.batch.forceConfirm': 'Confirm forced refill ({count} annotated)',
      'skills.skippedList': 'Skipped',
      'skills.skip.shadowed': 'shadowed',
      'skills.skip.invalid': 'invalid ({reason})',
      'skills.skip.reason.missing-frontmatter': 'no frontmatter',
      'skills.skip.reason.missing-name': 'missing name',
      'skills.skip.reason.invalid-name': 'invalid name',
      'skills.skip.reason.missing-description': 'missing description',
      'skills.skip.reason.too-large': 'file too large',
      'skills.skip.reason.legacy-invocation-key': 'legacy invocation keys',
      'skills.batch.start': 'Start batch',
      'skills.batch.progress': 'Progress {done}/{total}',
      'skills.batch.current': 'Current: {name}',
      'skills.batch.cancel': 'Cancel',
      'skills.batch.phase.idle': 'Idle',
      'skills.batch.phase.planned': 'Planned — review candidates, then press Start',
      'skills.batch.phase.running': 'Running',
      'skills.batch.phase.done': 'Done',
      'skills.batch.phase.cancelled': 'Cancelled',
      'skills.batch.failures': '{count} failed',
      'skills.batch.no-candidates': 'Nothing to fill',
      'skills.batch.model': 'Model',
      'overlay.label': 'Service restart status',
      'recovery.waiting.title': 'Restarting service…',
      'recovery.waiting.body': 'Waiting for a new DSH Web process. Elapsed: {seconds} seconds.',
      'recovery.timeout.title': 'Service has not recovered',
      'recovery.timeout.body': 'Waited 60 seconds. Check the external process manager, or refresh the page manually.',
      'recovery.manual': 'Manual reload',
      'health.title': 'Health',
      'health.uptime': 'Uptime',
      'health.rss': 'Memory RSS',
      'health.platform': 'Platform',
      'health.nodeVersion': 'Node version',
      'health.liveSessions': 'Live sessions',
      'health.persistedSessions': 'Persisted sessions',
      'health.activeAgents': 'Active agents',
      'health.activeJobs': 'Background jobs',
      'health.uptimeValue': '{hours} h {minutes} min',
      'health.error': 'Could not read health metrics',
      'health.check': 'Run health check',
      'health.checking': 'Checking…',
      'health.overall.ok': 'Healthy',
      'health.overall.warning': 'Warning',
      'health.overall.error': 'Error',
      'health.alert.title': 'Health alert',
      'health.alert.diagnostics': 'The health check reported {status}. Review the affected items below.',
      'health.status.ok': 'Healthy',
      'health.status.warning': 'Warning',
      'health.status.error': 'Error',
      'health.status.info': 'Info',
      'health.check.session-storage': 'Session storage',
      'health.check.workspace-registry': 'Workspace registry',
      'health.check.dsh-home': 'DSH_HOME',
      'health.check.backup-storage': 'Backup storage',
      'health.check.tar': 'tar',
      'health.check.permissions': 'File permissions',
      'health.check.runtime-env': 'Runtime environment',
      'health.check.node-version': 'Node runtime',
      'health.detail.runtime-env.managed': 'Managed by {kind}; the process restarts automatically after exit',
      'health.detail.runtime-env.declared': 'Declared externally managed via DSH_SERVICE_RUNTIME_ENV',
      'health.detail.runtime-env.manual': 'Likely a manual terminal launch — nothing restarts the process after exit; one-click upgrade already keeps it running',
      'health.detail.runtime-env.unknown': 'No process manager detected, so automatic restart cannot be confirmed; set DSH_SERVICE_RUNTIME_ENV=managed if one exists',
      'health.detail.node-version.ok': '{version}, meets the >={required} requirement',
      'health.detail.node-version.warning': '{version} is below the required {required}.x; upgrading Node is recommended',
      'health.detail.session-storage.ok': 'Available, with {count} session snapshots',
      'health.detail.workspace-registry.ok': 'Available, with {count} workspaces',
      'health.detail.dsh-home.ok': 'Directory is accessible with mode {mode}',
      'health.detail.backup-storage.empty': 'Backup directory is available; no backups exist yet',
      'health.detail.backup-storage.ok': 'Backup directory is available, with {count} backups using {size}',
      'health.detail.tar.ok': 'The tar executable is available',
      'health.detail.permissions.ok': 'Permission check passed with no anomalies',
      'health.detail.permissions.warning': 'Found {count} file or directory permission anomalies',
      'health.detail.generic': '{status}',
      'health.check.usage-index': 'Usage index',
      'health.detail.usage-index.never': 'No usage index yet; open the Model usage page to build it read-only',
      'health.detail.usage-index.unavailable': 'The usage index could not be read',
      'health.detail.usage-index.ok': '{indexed} sessions indexed, updated {updated}',
      'health.detail.usage-index.warning': '{failed} session(s) could not be indexed (usage is undercounted); {indexed} indexed, updated {updated}',
      'health.check.notification-permission': 'Notification permission',
      'health.detail.notification-permission.granted': 'The browser is allowed to show system notifications',
      'health.detail.notification-permission.default': 'The browser has not granted system notifications yet; enable them under Configuration → Notifications',
      'health.detail.notification-permission.denied': 'The browser blocked system notifications; restore them in the site settings',
      'health.detail.notification-permission.unsupported': 'This browser does not support system notifications',
      'health.check.plugins': 'Plugins',
      'health.detail.plugins.unavailable': 'Plugin health check unavailable (host loader is not exposed)',
      'health.detail.plugins.ok': '{total} plugins healthy',
      'plugin.issue.failed': '{failed} failed plugin(s)',
      'plugin.issue.pending': '{pending} pending plugin(s)',
      'plugin.issue.info': '{count} plugin state(s) need review',
      'plugin.state.pending': 'Waiting',
      'plugin.state.loading': 'Loading',
      'plugin.state.failed': 'Failed',
      'plugin.state.disposed': 'Disposed',
      'plugin.state.unknown': 'Unknown state',
      'plugin.state.unloading': 'Unloading',
      'plugin.missingDeps': 'Missing deps: {deps}',
      'plugin.error': 'Error: {error}',
      'plugin.restart': 'Reload',
      'plugin.restarting': 'Reloading…',
      'plugin.restartConfirm': 'Confirm reload',
      'plugin.restartHint': 'Reloading "{name}" re-runs its startup logic; the failure state refreshes afterwards.',
      'plugin.restartCancel': 'Cancel',
      'plugin.restartFailed': 'Reload failed: {detail}',
      'plugin.error.unknown-plugin': 'Plugin not found',
      'plugin.error.loader-unavailable': 'Host loader unavailable',
      'plugin.error.plugin-disabled': 'The plugin is disabled and cannot be reloaded',
      'plugin.error.not-failed': 'The plugin is not in a failed state',
      'plugin.error.restart-failed': 'Still failed after reload',
      'health.check.plugin-compat': 'Plugin compatibility',
      'health.detail.plugin-compat.unavailable': 'Plugin compatibility check unavailable (host loader is not exposed)',
      'health.detail.plugin-compat.ok': 'Scanned {total} plugins; no references to changed interfaces',
      // Per-kind short labels for a single plugin row (multiple findings of one plugin merge into
      // one row; `issue.*` keys are the counted summary phrases on the check line).
      'plugin.compat.kind.broken': 'Possibly incompatible',
      'plugin.compat.kind.soft': 'Kept for backward compatibility',
      'plugin.compat.kind.declared': 'Stale declaration',
      'plugin.compat.kind.unknown': 'Not scanned',
      'plugin.compat.issue.broken': '{count} plugin(s) possibly incompatible',
      'plugin.compat.issue.soft': '{count} plugin(s) keep retired interfaces for backward compatibility',
      'plugin.compat.issue.declared': '{count} plugin(s) with stale declarations only (not referenced in code)',
      'plugin.compat.issue.unknown': '{count} plugin(s) could not be scanned',
      'plugin.compat.declared': 'Declares a removed interface but never references it in code — the official loader silently skips missing suppliers, so this is harmless today and only signals the author to clean up',
      'plugin.compat.badge.active': 'Active in current DSH',
      'plugin.compat.badge.future': 'Normal now (triggers upon DSH ≥ {since})',
      'plugin.compat.category.package-removed': 'Package removed',
      'plugin.compat.category.slot-retired': 'Slot retired',
      'plugin.compat.category.method-removed': 'Method removed',
      'plugin.compat.category.event-removed': 'Event removed',
      'plugin.compat.category.hash-migrated': 'CSS hash migrated',
      'plugin.compat.category.attribute-removed': 'DOM attribute removed',
      'plugin.compat.meta.since': 'Impacts: DSH ≥ {since}',
      'plugin.compat.meta.reason': 'Reason',
      'plugin.compat.meta.impact': 'Impact',
      'plugin.compat.meta.advice': 'Advice',
      'plugin.compat.reason.client-runtime': 'Official web roster dropped @deepseek-ai/dsh-client-runtime in DSH 0.1.2-alpha.2',
      'plugin.compat.impact.client-runtime': 'Browser loader waits for missing supplier, causing the plugin to hang in pending state',
      'plugin.compat.advice.client-runtime': 'Remove the package from dsh.client.inject in package.json',
      'plugin.compat.reason.sqlite-persistence': 'Official SQLite session persistence package was dropped in DSH 0.1.2-alpha.3; JSONL is the only official provider',
      'plugin.compat.impact.sqlite-persistence': 'Importing this package causes resolution failure or startup crashes',
      'plugin.compat.advice.sqlite-persistence': 'Drop the dependency on sqlite persistence and use standard JSONL or public session APIs',
      'plugin.compat.reason.code-runtime': 'Code execution package was renamed and refactored in DSH 0.1.6-alpha.1, replaced by ptc-runtime',
      'plugin.compat.impact.code-runtime': 'Code execution engines depending on this package fail to load',
      'plugin.compat.advice.code-runtime': 'Upgrade to @deepseek-ai/dsh-ptc-runtime',
      'plugin.compat.reason.e2b-runtime': 'Built-in E2B sandbox backend was removed in DSH 0.1.6-alpha.1',
      'plugin.compat.impact.e2b-runtime': 'Sandbox logic depending on this package fails to load',
      'plugin.compat.advice.e2b-runtime': 'Use official execution environments or external MCP servers',
      'plugin.compat.reason.session-start-event': 'Lifecycle event dispatch was unified in DSH 0.1.6-alpha.1 (agent/session-start was removed)',
      'plugin.compat.impact.session-start-event': 'Event listeners never fire, breaking timing hooks',
      'plugin.compat.advice.session-start-event': 'Listen to agent/created via ctx.on and inspect payload.source',
      'plugin.compat.reason.chat-hash': 'Chat view was split into dsh-client-ui-chat in DSH 0.1.2-alpha.2, shifting CSS module prefix (Md3f7G_ → EvIC1a_)',
      'plugin.compat.impact.chat-hash': 'Selectors hardcoding the old class prefix fail to match target DOM elements',
      'plugin.compat.advice.chat-hash': 'Use stem suffix matching (e.g. [class*="_toBottomSlot"])',
      'plugin.compat.reason.stats-hash': 'Status line view moved into chat package in DSH 0.1.2-alpha.2, changing class prefix from FJxK0a_ to -NDN2W_',
      'plugin.compat.impact.stats-hash': 'Hardcoded selectors fail to find status line elements',
      'plugin.compat.advice.stats-hash': 'Use stem matching, or adapt to StatsPills on DSH 0.1.5+',
      'plugin.compat.reason.time-hover-root': 'Turn timestamp interaction was overhauled in DSH 0.1.2-alpha.2, deleting data-time-hover-root DOM attribute',
      'plugin.compat.impact.time-hover-root': 'Scripts relying on this attribute to locate turn timestamps fail',
      'plugin.compat.advice.time-hover-root': 'Use the stable [data-turn-tail] attribute instead',
      'plugin.compat.reason.settings-plugin-item': 'Settings panel was redesigned in DSH 0.1.6-alpha.2, retiring the settings.plugin.item slot',
      'plugin.compat.impact.settings-plugin-item': 'Configuration cards no longer render inside the settings dialog; plugin core runs normally',
      'plugin.compat.advice.settings-plugin-item': 'Migrate to the dedicated plugins page slot plugins.bundle.config, or register both for compatibility',
      'plugin.compat.reason.sessions-open-method': 'Session lifecycle management was introduced in DSH 0.1.6-alpha.2, removing the imperative ISessions.open method',
      'plugin.compat.impact.sessions-open-method': 'Calling the sessions.open method fails silently or throws',
      'plugin.compat.advice.sessions-open-method': 'Use uiWorkspace.openSession or keep dual-level fallbacks',
      'plugin.compat.break.client-runtime': 'Declares the removed client supplier @deepseek-ai/dsh-client-runtime (dropped from the official roster in 0.1.2-alpha.2; the browser half may fail to mount)',
      'plugin.compat.break.sqlite-persistence': 'Depends on the removed session persistence backend @deepseek-ai/dsh-session-persistence-sqlite (JSONL is the only official provider since 0.1.2-alpha.3)',
      'plugin.compat.break.code-runtime': 'Depends on the removed code runtime backend @deepseek-ai/dsh-code-runtime (replaced by ptc-runtime in 0.1.6-alpha.1)',
      'plugin.compat.break.e2b-runtime': 'Depends on the removed sandbox backend @deepseek-ai/dsh-e2b (built-in E2B removed in 0.1.6-alpha.1)',
      'plugin.compat.break.session-start-event': 'Listens to the removed lifecycle event agent/session-start (replaced by agent/created with source in 0.1.6-alpha.1)',
      'plugin.compat.break.settings-plugin-item': 'Keeps the retired settings page slot settings.plugin.item for compatibility with older hosts (new hosts stopped rendering it in 0.1.6-alpha.2 — the config card is hosted via plugins.bundle.config; the plugin runs normally with only the config entry relocated, no action needed)',
      'plugin.compat.break.sessions-open-method': 'Calls the removed imperative session-open method sessions.open (removed from ISessions in 0.1.6-alpha.2, clicks do nothing; the official ui-workspace openSession replaces it)',
      'plugin.compat.break.chat-hash': 'References the old chat UI style prefix (Md3f7G_, migrated to EvIC1a_ since 0.1.2-alpha.2)',
      'plugin.compat.break.stats-hash': 'References the old status-line style prefix (FJxK0a_, migrated to -NDN2W_ since 0.1.2-alpha.2)',
      'plugin.compat.break.time-hover-root': 'Uses the removed attribute data-time-hover-root (replaced by data-turn-tail in 0.1.2-alpha.2)',
      'plugin.compat.unknown.unresolved': 'Package manifest could not be resolved',
      'plugin.compat.unknown.missing-entry': 'No scannable entry file found',
      'plugin.compat.unknown.too-large': 'Entry file exceeds the 4 MiB scan limit',
      'tabs.overview': 'Overview',
      'tabs.notify': 'Notifications',
      'tabs.health': 'Health',
      'tabs.usage': 'Models',
      'tabs.quota': 'Quota lookup',
      'overview.container': 'Process and runtime',
      'overview.errors': 'Errors',
      'overview.status.normal': 'All systems nominal',
      'overview.status.info': 'You have {count} note(s)',
      'overview.status.warning': 'You have {count} item(s) to review',
      'overview.status.error': 'You have {count} item(s) needing attention',
      'overview.backupEmpty': 'No backups yet — consider creating one',
      'overview.updateAvailable': 'A new version is available',
      'tabs.backup': 'Backup',
      'tabs.restart': 'Restart',
      'tabs.maintenance': 'Maintenance',
      'tabs.configuration': 'Configuration',
      'tabs.features': 'Features',
      'tabs.notifications': 'Notifications',
      'tabs.navOrder': 'Settings Nav',
      'config.navOrder.title': 'Settings Navigation Order & Visibility',
      'config.navOrder.moveUp': 'Move up',
      'config.navOrder.moveDown': 'Move down',
      'config.navOrder.visible': 'Visible',
      'config.navOrder.hidden': 'Hidden',
      'config.navOrder.locked': 'Current panel (locked)',
      'config.navOrder.reset': 'Reset to default',
      'config.navOrder.saved': 'Saved',
      'config.navOrder.save': 'Save order',
      'config.navOrder.empty': 'No registered settings tabs detected',
      'maintenance.empty': 'All maintenance pages are disabled. Enable backup, skills, subagents, or session management under “Configuration → Features”.',
      'config.notificationsDisabled': 'Task notifications are turned off on the Features page; these settings are shown for reference only until re-enabled.',
      'features.group.runtime': 'Runtime and observation',
      'features.group.maintenance': 'Maintenance',
      'features.group.interaction': 'Interaction',
      'page.configuration.desc': 'Feature switches and task notification settings.',
      'tabs.alert.title': 'Service control alert',
      'tabs.alert.body': 'These areas need attention: {tabs}',
      'tabs.alert.join': ', ',
      'tabs.alert.dot': 'Alert on this tab',
      'permissions.title': 'File permissions',
      'permissions.description': 'Checks whether the Agent can read, write, and enter DSH_HOME and workspaces. Deep scans skip .git; repair adds only the needed permissions and keeps execute bits.',
      'permissions.target': 'Target owner: {owner}',
      'permissions.repair': 'Repair permissions',
      'permissions.repairing': 'Repairing…',
      'permissions.confirm': 'Confirm repair',
      'permissions.confirmHint': 'Skips .git, restores ownership to the current user, adds Agent read/write access, and keeps existing execute bits.',
      'permissions.cancel': 'Cancel',
      'permissions.show': 'Permissions & repair',
      'permissions.hide': 'Collapse',
      'permissions.error': 'Permission operation failed',
      'permissions.summary.ok': '{count} root path(s) passed the check',
      'permissions.summary.warning': '{count} root path(s) need attention',
      'permissions.showDetails': 'Show details',
      'permissions.hideDetails': 'Hide details',
      'permissions.deep': 'Deep check',
      'permissions.deepChecking': 'Scanning…',
      'permissions.deepSummary': 'Scanned {scanned} entries in {duration} ms; non-editable directories {directories}, non-editable files {files}, unreadable {unreadable}.',
      'backup.title': 'Backup management',
      'backup.description': 'Backs up sessions, config, and plugin profiles — no node_modules or credentials; never auto-pruned.',
      'backup.create': 'Create backup',
      'backup.creating': 'Creating…',
      'backup.progress.copy': 'Copying session data ({current}/{total})…',
      'backup.progress.archive': 'Packing archive ({current}/{total})…',
      'backup.progress.validate': 'Verifying archive ({current}/{total})…',
      'backup.progress.publish': 'Publishing backup ({current}/{total})…',
      'backup.total': 'Total size: {size}',
      'backup.empty': 'No backups yet.',
      'backup.delete': 'Delete',
      'backup.confirm': 'Confirm delete',
      'backup.confirmHint': 'Delete this backup? This cannot be undone.',
      'backup.cancel': 'Cancel',
      'backup.error': 'Backup operation failed',
      'backup.export': 'Export',
      'backup.exporting': 'Exporting…',
      'backup.exportError': 'Backup export failed',
      'backup.restore': 'Restore',
      'backup.inspecting': 'Inspecting…',
      'backup.restoreConfirm': 'Confirm restore',
      'backup.restoreHint': 'The integrity check passed. Confirm to apply the plan below; the host will recheck the archive and current targets immediately before committing.',
      'backup.restoreError': 'Backup restore failed',
      'backup.integrity.ok': 'Integrity check passed',
      'backup.integrity.invalid': 'Archive cannot be restored',
      'backup.integrity.summary': '{entries} entries, {size} expanded; {sessions} session file(s), {config} config file(s), {profiles} profile manifest(s).',
      'backup.integrity.format': 'Archive format {format}',
      'backup.format.v1': 'v1 (no Profile patch layer)',
      'backup.format.v2': 'v2 (includes the Profile patch layer)',
      'backup.plan.sessions': 'The sessions directory will be replaced in full',
      'backup.plan.config': 'Replace {replace} config file(s), remove {remove}',
      'backup.plan.profiles': 'Replace package.json for {count} profile(s); keep node_modules and all other files',
      'backup.plan.profilePatches': 'Restore cordis.patch.yml (the Profile configuration layer) for {count} profile(s)',
      'backup.plan.profilePatchesAbsent': 'This archive predates the Profile patch layer: it carries no cordis.patch.yml, so your current configuration is left untouched rather than overwritten or removed.',
      'backup.plan.expires': 'Restore plan expires at {time}',
      'backup.manualRestartTitle': 'Restore completed — manual restart required',
      'backup.manualRestartBody': 'The data is restored, but the current process is still running its old state. Press Ctrl+C in the terminal running dsh, then start dsh again.',
      'backup.error.backup-gzip-invalid': 'The archive is not a valid gzip file or is damaged.',
      'backup.error.backup-tar-invalid': 'The tar structure or checksum is invalid.',
      'backup.error.backup-entry-traversal': 'The archive contains an unsafe path traversal.',
      'backup.error.backup-entry-absolute': 'The archive contains an absolute path.',
      'backup.error.backup-entry-link': 'The archive contains a symbolic or hard link.',
      'backup.error.backup-entry-type': 'The archive contains an unsupported special entry.',
       'backup.error.backup-entry-platform': 'The archive contains a filename incompatible with another platform.',
      'backup.error.backup-entry-unexpected': 'The archive contains files outside the backup scope.',
      'backup.error.backup-profile-invalid': 'A profile package.json is invalid.',
      'backup.error.backup-section-missing': 'The archive is missing a required section.',
      'backup.error.backup-size-limit': 'The archive exceeds a safe size or entry limit.',
      'backup.error.backup-archive-invalid': 'The archive failed its integrity check.',
      'backup.error.backup-archive-incomplete': 'The archive does not match the backup source (a file was not captured completely), so it was not published.',
       'backup.error.backup-source-changed': 'A session is being written; the backup was not completed. Try again shortly.',
       'backup.error.backup-source-unsafe': 'The backup source contains a link or special file, so creation was refused.',
       'backup.error.tar-failed': 'The archive tool failed. Check that tar and gzip are available.',
      'backup.error.active-work': 'Running work was detected; restore is blocked for now.',
      'backup.error.restore-plan-expired': 'The restore plan expired. Inspect the backup again.',
      'backup.error.restore-source-changed': 'The backup changed before confirmation. Inspect it again.',
      'backup.error.restore-target-changed': 'Current data changed before confirmation. Inspect it again.',
      'backup.error.restore-target-unsafe': 'A restore target contains an unsafe link or special file.',
      'backup.import': 'Import backup',
      'backup.importing': 'Importing…',
      'backup.showRecords': 'Show backup records',
      'backup.hideRecords': 'Hide backup records',
      'version.title': 'Version information',
      'version.current': 'DSH: ',
      'version.plugin': 'dsh-service: ',
      'version.loading': 'Loading…',
      'update.check': 'Check for updates',
      'update.checking': 'Checking…',
      'update.current': 'Up to date',
      'update.available': 'New version: {version}',
      'update.installedPendingRestart': 'Installed {version} — restart to take effect',
      'update.notes.button': "What's new",
      'update.notes.hide': "Hide what's new",
      'update.notes.loading': 'Loading release notes…',
      'update.notes.empty': 'This release has no notes.',
      'update.notes.truncated': '(Very long; showing the first {chars} characters)',
      'update.notes.publishedAt': 'Published {date}',
      'update.notes.version': 'Version {version}',
      'update.notes.prerelease': 'Pre-release',
      'update.notes.error.release-not-found': 'The release notes are not published yet (the version reached npm first; the release follows later).',
      'update.notes.retry': 'Retry',
      'update.notes.error.release-unavailable': 'Could not load the release notes. Try again later.',
      'update.unavailable': 'Latest version is temporarily unavailable',
      'update.unpublished': 'No published version is available to check',
      'health.recheck': 'Run again',
      'update.upgrade': 'Upgrade plugin',
      'update.upgrading': 'Upgrading…',
      'update.upgradeError': 'Plugin upgrade failed',
      'update.upgradeErrorDetail': 'Plugin upgrade failed ({detail})',
      'update.upgradeSuccess': 'Upgrade successful, restarting…',
      'update.guardActiveWork': 'Active sessions or background tasks are running; resolve them before upgrading',
      'update.guardLinkInstall': 'Installed via link: (development mode) — cannot one-click upgrade from the registry; update the source checkout and restart',
      'update.guardFileInstall': 'Installed via file: — cannot one-click upgrade from the registry',
      'update.guardNoNewer': 'The registry latest is not higher than the current version; refused a possible downgrade',
      'update.guardNoProfile': 'No profile with this plugin installed was found to target the upgrade at',
      'update.guardAmbiguous': 'Several profiles install this plugin and the loaded copy could not be determined; aborted',
      'update.guardStale': 'The command reported success but the installed version did not change (pnpm safety wait likely blocked it); keeping the current version without restarting',
      'update.guardUnreadable': 'The command succeeded but the installed version could not be confirmed; the restart was cancelled',
      'update.failPnpmMissing': 'pnpm was not found, so the upgrade cannot run; install pnpm first and retry',
      'update.failNetwork': 'A transient network failure occurred while fetching dependencies; please retry shortly',
      'update.failFetchTimeout': 'Download timed out (slow network or large package); please retry later',
      'update.failReleaseAge': 'The new release is blocked by pnpm\'s fresh-release safety wait; one automatic bypass retry also failed',
      'update.failHoist': 'This profile\'s node_modules was created by a different pnpm major; the rebuild retry also failed',
      'update.failAddingToRoot': 'pnpm refused to add at the workspace root (missing -w)',
      'update.failNotWorkspace': '-w was passed but the profile is not a pnpm workspace',
      'update.failIgnoredBuilds': 'Dependency build scripts are blocked by pnpm by default, so the upgrade could not finish',
      'env.kind.docker': 'Docker container',
      'env.kind.container': 'Container (containerd/Kubernetes)',
      'env.kind.systemd': 'systemd service',
      'env.kind.pm2': 'pm2',
      'env.kind.supervisord': 'supervisord',
      'env.kind.kubernetes': 'Kubernetes',
      'env.kind.declared': 'External process manager (declared manually)',
      'update.manualConfirmTitle': 'Confirm before upgrading: manual launch suspected',
      'update.manualConfirm': 'No process manager detected. DSH will not restart automatically after the upgrade.',
      'update.manualProceed': 'Upgrade anyway',
      'update.manualRestartTitle': 'Upgrade finished — manual restart required',
      'update.manualRestartBody': 'The new version is installed, but the current process still runs the old one. Press Ctrl+C in the terminal running dsh (or simply close the window), then start dsh again.',
      'restart.title': 'Service restart',
      'restart.description': 'Restarts the dsh web process. Running work is interrupted; persisted sessions recover.',
      'restart.button': 'Restart dsh web',
      'restart.sending': 'Sending…',
      'restart.confirm': 'Confirm restart',
      'restart.force': 'Force restart',
      'restart.cancel': 'Cancel',
      'restart.sent': 'Restart request sent.',
      'restart.sentHint': 'The connection will close shortly. The page will reload automatically after recovery.',
      'restart.idleHint': 'No active work was detected. Confirm to disconnect and wait for the service to restart.',
      'restart.manualWarn': 'This looks like a manual terminal launch: once confirmed the process exits and nothing restarts it — you must run dsh again yourself.',
      'restart.sentManualHint': 'Manual start detected — the service will not relaunch itself. Rerun dsh in the original terminal, then refresh.',
      'restart.navToggle': 'Show "Restart" entry in settings left nav',
      'restart.navToggleHint': 'Off by default; when enabled, a quick-restart entry appears at the bottom of the settings left navigation',
      'activity.agent': 'Agent',
      'activity.job': 'Background job',
      'activity.terminal': 'Terminal',
      'activity.warning': 'Detected {count} active items; restart interrupts them.',
      'activity.item': '{type}: {label} ({status})',
      'error.update': 'Update check failed',
      'error.activity': 'Could not check active work',
      'error.restart': 'Restart failed',
      'error.instance': 'Restart response is missing the process instance ID',
      'usage.title': 'Model usage',
      'usage.tooltip.date': 'Date: {date}',
      'usage.tooltip.input': 'Input {value} token',
      'usage.tooltip.output': 'Output {value} token',
      'usage.tooltip.cache': 'Cache hit {value} token',
      'usage.tooltip.total': 'Total tokens {value}',
      'usage.tooltip.steps': 'Successful model steps {value}',
      'usage.tooltip.hitRate': 'Cache hit rate {value}',
      'usage.axis': 'token vertical axis',
      'usage.models.more': 'Show {count} more models',
      'usage.models.less': 'Collapse model list',
      'usage.modelScope.today': 'Today',
      'usage.modelScope.week': 'Last 7 days',
      'usage.modelScope.all': 'All time',
      'usage.modelSortHint.today': 'Sorted by tokens used today, largest first',
      'usage.modelSortHint.week': 'Sorted by tokens in the last 7 days, largest first',
      'usage.modelSortHint.all': 'Sorted by all-time tokens, largest first',
      'usage.modelBar.today': '{model}: {total} tokens today',
      'usage.modelBar.week': '{model}: {total} tokens in the last 7 days',
      'usage.modelBar.all': '{model}: {total} tokens in total',
      'usage.refresh': 'Refresh usage',
      'usage.refreshing': 'Refreshing…',
      'usage.empty': 'No usage index yet. Select Refresh usage to build the read-only index.',
      'usage.error': 'Could not read model usage',
      'usage.allProjects': 'All projects',
      'usage.chartSummary': 'Total usage over seven days: {total} tokens',
      'usage.barDay': '{day} total {total} tokens',
      'usage.total': 'Total tokens',
      'usage.steps': 'Successful model steps',
      'usage.stepsValue': '{count} times',
      'usage.modelLine': '{steps} times · Cache hit {hitRate} · Input {input} token · Output {output} token',
      'usage.input': 'Input token',
      'usage.output': 'Output token',
      'usage.cache': 'Cache token',
      'usage.hitRate': 'Cache hit rate',
      'usage.today': 'Today',
      'usage.sevenDays': 'Last 7 days',
      // Heatmap calendar (bottom of the card): covers every day in the host index; weekday and
      // month names come from Intl, not the dictionary.
      'usage.heatmap.title': 'Daily usage calendar',
      'usage.heatmap.gridLabel': 'Daily token usage heatmap calendar',
      'usage.heatmap.cell': '{date}: {total} tokens · {steps} model steps',
      'usage.heatmap.hourTitle': 'Usage punch card (weekday × hour)',
      'usage.heatmap.hourGridLabel': 'Token usage punch card by weekday and hour',
      'usage.heatmap.hourCell': '{weekday} {hour}:00: {total} tokens · {steps} model steps',
      'usage.heatmap.scope.day': 'Daily',
      'usage.heatmap.scope.hour': 'Hourly',
      'usage.heatmap.less': 'Less',
      'usage.heatmap.more': 'More',
      'usage.errors.title': 'Model errors',
      'usage.errors.toggle': 'Model errors ({count} types)',
      'usage.errors.recent': 'Last 48 hours',
      'usage.errors.empty': 'No model errors were recorded in the last 48 hours.',
      'usage.toolErrors.title': 'Tool errors',
      'usage.toolErrors.toggle': 'Tool errors ({count} types)',
      'usage.toolErrors.empty': 'No tool errors were recorded in the last 48 hours.',
      'usage.errors.count': '{count} occurrence(s)',
      'usage.failures.global': 'Global session indexing (not affected by project filter): {successful} sessions indexed successfully, {failed} skipped.',
      'usage.failures.staleHint': 'Totals may include retained cached data from sessions that could not be read again; it may be stale.',
      'usage.failures.show': 'Show skipped session details',
      'usage.failures.hide': 'Hide skipped session details',
      'usage.failures.dismiss': 'Dismiss (shown again if new sessions are skipped)',
      'usage.failures.id': 'Session ID',
      'usage.failures.code': 'Error type',
      'usage.failures.message': 'Reason',
      'usage.failures.stale': 'Retained stale statistics (included in totals)',
      'usage.failures.notStale': 'No cached data, excluded from totals',
      'usage.failures.reason.format-migration-failed': 'Session format migration was refused.',
      'usage.failures.reason.session-read-failed': 'Session could not be opened or read.',
      'usage.failures.reason.session-fold-failed': 'Session events could not be indexed.',
      'notification.title': 'Notifications',
      'notification.description': 'Browser notifications when a root task finishes or approval/choice is needed; subagent completion stays silent.',
      'notification.enable': 'Enable notifications',
      'notification.enabled': 'Notifications enabled',
      'notification.disable': 'Disable notifications',
      'notification.denied': 'Notification permission denied',
      'notification.master': 'Master switch',
      'notification.done': 'Task completion',
      'notification.input': 'Approvals & questions',
      'notification.doneTitle': 'Task complete',
      'notification.doneBody': '{title} has finished its turn',
      'notification.inputTitle': 'Your attention needed',
      'notification.inputBody': '{title} — {kind}',
      'notification.kind.approval': 'approval requested',
      'notification.kind.plan-review': 'plan review requested',
      'notification.kind.question': 'answer requested',
      'notification.bellOn': 'Notifications on',
      'notification.bellOff': 'Notifications off',
      'notification.bellShow': 'Show composer bell icon',
      'quota.cardTitle': 'Quota lookup',
      'quota.navToggle': 'Show "Quota lookup" entry in settings left nav',
      'quota.navToggleHint': 'When enabled, an entry appears in the settings left navigation',
      'quota.window.rolling': '5h rolling',
      'quota.window.tokens-limit-u3-n5': '5-hour tokens',
      'quota.window.tokens-limit-u6-n1': 'Weekly tokens',
      'quota.window.tokens-limit': 'Token quota',
      'quota.window.time-limit-u5-n1': 'MCP quota',
      'quota.window.time-limit': 'MCP quota',
      'quota.window.credit-limit': 'Credit quota',
      'quota.window.credits': 'Credits used',
      'quota.window.balance': 'Balance',
      'quota.window.weekly': 'This week',
      'quota.window.monthly': 'This month',
      'quota.window.codex-5h': '5-hour',
      'quota.window.codex-day': 'Daily',
      'quota.window.codex-week': 'Weekly',
      'quota.window.codex-month': 'Monthly',
      'quota.window.gemini-5h': '5-hour',
      'quota.window.gemini-week': 'Weekly',
      'quota.window.claude-5h': '5-hour',
      'quota.window.claude-week': 'Weekly',
      'quota.panel.title': 'Quota usage',
      // Reset-card collapse (v1.9.1): both panels show only the nearest card by default.
      'quota.resetCard.more': '{count} more',
      'quota.resetCard.less': 'Collapse',
      'quota.panel.used': 'Used',
      'quota.panel.remaining': 'Remaining',
      'quota.ring.label': 'Quota lookup',
      'quota.gauge.baseline': 'Baseline full',
      'quota.gauge.calibrate': 'Set current as full',
      'quota.gauge.calibrateTip': 'Set current balance {amount} as the 100% baseline',
      'quota.gauge.ratio': '{percent}% remaining',
      'quota.filter.showAll': 'Show all quotas ({count})',
      'quota.filter.currentOnly': 'Current model only',
      'quota.updated': 'Updated {time}',
      'quota.refreshing': 'Refreshing…',
      'quota.empty': 'No data yet',
      'quota.resetIn': 'Resets in {time}',
      'quota.window.stale': 'cached',
      'quota.window.staleTip': "Live query failed for this account; showing CPA's last cached snapshot (not realtime)",
      'quota.family.gemini': 'Gemini',
      'quota.family.claude': 'Claude',
      'quota.family.codex': 'Codex',
      'quota.family.other': 'Other',
      'quota.resetCard.title': 'Reset card',
      // Attribution title of the ring-panel reset section (CPA only): these cards all belong
      // to codex accounts; without the label they read as Gemini's reset cards.
      'quota.resetCard.codexTitle': 'Codex reset cards',
      'quota.resetCard.expires': 'expires {date}',
      'quota.resetCard.expired': 'expired',
      'quota.resetCard.edit': 'Add reset card',
      'quota.advanced': 'Configuration',
      'quota.resetCard.dateLabel': 'Expiry date',
      'quota.resetCard.nameLabel': 'Name (optional)',
      'quota.resetCard.add': 'Add',
      'quota.resetCard.cancel': 'Cancel',
      'quota.resetCard.remove': 'Remove',
      'quota.retryAt': 'Retry allowed after {time}',
      'quota.refresh': 'Refresh',
      'quota.reorder': 'Reorder & visibility',
      'quota.order.title': 'Quota card order & visibility',
      'quota.order.hint': 'Drag items or click the arrows to reorder; toggle off to hide cards you rarely need (hiding only affects display, not querying).',
      'quota.order.allHidden': 'All adapted cards are hidden; turn a toggle back on under “Reorder & visibility” to show them again.',
      'quota.usageLink': 'Open the official usage page',
      'quota.adapt': 'Adapt',
      'quota.kind.opencode-go': 'OpenCode Go',
      'quota.kind.zai-coding-cn': 'Zhipu GLM Coding Plan',
      'quota.kind.openrouter': 'OpenRouter',
      'quota.kind.kimi': 'Kimi / Moonshot',
      'quota.kind.siliconflow': 'SiliconFlow',
      'quota.kind.cliproxy': 'CLIProxyAPI accounts',
      'quota.kind.deepseek': 'DeepSeek Platform',
      'quota.kind.stepfun': 'StepFun Balance',
      'quota.kind.stepfun-step-plan': 'StepFun Step Plan',
      'quota.kind.xiaomi-token-plan-cn': 'Xiaomi MiMo Token Plan',
      'quota.kind.command-goat': 'Command Code account quota',
      'quota.window.total_token': 'Plan total quota',
      'quota.window.compensation_total_token': 'Compensation credits',
      'quota.window.plan-name': 'Subscription plan',
      'quota.window.credit-pool': 'Monthly credit pool',
      'quota.window.topup-credit': 'Top-up credit',
      'quota.window.five-hour': '5-hour quota',
      'quota.window.period-spend': 'Spent this period',
      'quota.error.no-subscription': 'No active quota subscription on this account',
      'quota.error.credential-rejected': 'Credential rejected by upstream; enter it again (for console types, copy the browser session again)',
      'quota.credential.editCookie': 'Set console cookie (web session)',
      'quota.credential.editToken': 'Set console token (Oasis-Token, browser session)',
      'quota.kindAuto': 'Auto-detected',
      'quota.noAdapted': 'No adapted providers yet — adapt manually below',
      'quota.disable': 'Disable',
      'quota.followAuto': 'Follow auto-detect',
      'quota.addAdapt': 'Manual adapt:',
      'quota.addPickProvider': 'Pick provider',
      'quota.addPickKind': 'Pick type',
      'quota.saveFailed': 'Save failed: {error}',
      'quota.unknownProvider': 'Unknown provider',
      'quota.error.credential-missing': 'Credential missing (set the API key in DSH credentials)',
      'quota.error.no-base-url': 'This provider has no baseURL configured',
      'quota.error.credentials-unavailable': 'Credential service unavailable',
      'quota.error.http-status': 'Upstream returned an error status',
      'quota.error.network': 'Network error',
      'quota.error.network-transient': 'Unstable network (auto-retried)',
      'quota.error.timeout': 'Request timed out',
      'quota.error.bad-payload': 'Unexpected response format',
      'quota.error.mgmt-disabled': 'CLIProxyAPI management API disabled (remote-management secret-key not set)',
      'quota.error.host-not-pinned': 'baseURL differs from the domain recorded when adapting; save the adapter again',
      'quota.error.upstream-status': 'Upstream official API returned an error status',
      'quota.error.upstream-error': 'Upstream service error (quota API failed; retrying automatically)',
      'quota.credential.edit': 'Set API credential',
      'quota.credential.editManagement': 'Set management key (web login key)',
      'quota.credential.nameLabel': 'Credential name',
      'quota.credential.valueLabel': 'Secret value',
      'quota.credential.save': 'Save',
      'quota.credential.primary': 'primary (one alias is enough)',
      'quota.credential.clear': 'Clear stored',
      'quota.credential.clearConfirm': 'Click again to clear',
      'quota.credential.configured': 'configured',
      'quota.credential.notConfigured': 'not set',
      'quota.credential.saveFailed': 'Failed to save credential: {error}',
      'quota.credential.unknown-hint': 'Unknown credential name',
      'quota.credential.invalid-value': 'Secret value must not be empty',
      'quota.credential.credentials-unavailable': 'Credential service unavailable',
      'quota.error.unknown': 'Unknown error',
      'quota.unadapted': 'Not adapted: pick a provider kind below first',
      'quota.unit.day': '{count} d',
      'quota.unit.hour': '{count} h',
      'quota.unit.minute': '{count} min',
      'quota.window.granted-balance': 'Granted balance (unexpired)',
      'quota.peak.nowIdle': 'Off-peak now · half price',
      'quota.peak.nowPeak': 'Peak now · standard price',
      'quota.peak.untilIdle': 'Half price from {time} (in {dur})',
      'quota.peak.untilPeak': 'Peak pricing from {time} (in {dur})',
      'quota.peak.tag.peak': 'Peak',
      'quota.peak.tag.idle': 'Off-peak',
      'quota.peak.caption': 'Off-peak price is half the peak price. Peak hours (GMT+8): Mon–Fri 09:00–12:00 and 14:00–18:00, excluding Chinese public holidays. All other times — including all day on weekends and Chinese public holidays — are off-peak.',
      'quota.peak.caption.degraded': 'The {year} Chinese public holiday schedule is not yet included; this year is estimated as "Mon–Fri 09:00–12:00 and 14:00–18:00", so holidays may still show as peak. Updating the plugin picks up the current year\'s schedule automatically.',
      'quota.peak.caption.zai': 'Off-peak calls deduct 50% of the base credits. Peak hours: Mon–Fri 14:00–18:00 (UTC+8). All other times are off-peak, including all day Saturday and Sunday.',
      // ── Official right-Sidebar file editing (v1.6) ──────────────────────
      'features.fileEditor': 'Right-Sidebar file editing',
      'features.modelProviderIcons': 'Model provider icons',
      'editor.viewer': 'Edit',
      'editor.loading': 'Reading file…',
      'editor.preview': 'Preview',
      'editor.save': 'Save',
      'editor.saving': 'Saving…',
      'editor.saved': 'Saved',
      'editor.unsaved': 'Unsaved',
      'editor.reload': 'Reload',
      'editor.undo': 'Undo save',
      'editor.keyHint': 'Ctrl/Cmd + S to save',
      'editor.conflict.title': 'The file changed on disk; save rejected',
      'editor.conflict.body': 'Another change (an Agent or another window) overwrote this file after it was opened. Reload discards your edits; overwrite writes the current editor content to disk.',
      'editor.conflict.reload': 'Reload (discard edits)',
      'editor.conflict.overwrite': 'Overwrite with mine',
      'editor.confirm.previewTitle': 'Back to preview',
      'editor.confirm.previewBody': 'You have unsaved changes; going back to the preview discards them.',
      'editor.confirm.saveBack': 'Save & back',
      'editor.confirm.discardBack': 'Discard & back',
      'editor.confirm.reloadTitle': 'Reload',
      'editor.confirm.reloadBody': 'You have unsaved changes; reloading discards them and reads the current disk content.',
      'editor.confirm.reloadGo': 'Discard & reload',
      'editor.confirm.undoTitle': 'Undo save',
      'editor.confirm.undoBody': 'This restores the file to its content before the last save; unsaved changes are discarded as well.',
      'editor.confirm.cancel': 'Keep editing',
      'editor.undoConflict.title': 'Cannot undo automatically',
      'editor.undoConflict.body': 'The file changed on disk again after your save, so the previous content cannot be restored automatically; reload to see the current content.',
      'editor.undoConflict.dismiss': 'Dismiss',
      'editor.readonlyHint': 'Read-only',
      'editor.retry': 'Retry',
      'editor.error.file-not-found': 'The file does not exist (it may have been moved or deleted).',
      'editor.error.not-regular-file': 'This is not a regular file and cannot be edited.',
      'editor.error.too-large': 'The file exceeds {limit}; the right-Sidebar editor is read-only. Use another viewer.',
      'editor.error.binary-file': 'This is not a UTF-8 text file, so the right-Sidebar editor cannot edit it.',
      'editor.error.session-not-live': 'This session is not active right now, so it cannot be edited (switch to another viewer to read it).',
      'editor.error.file-forbidden': 'The sandbox policy of this session does not allow writing this file.',
      'editor.error.unavailable': 'The host file service is unavailable, so editing is not possible right now.',
      'editor.error.invalid-address': 'The file address is not recognized, so it cannot be edited.',
      'editor.error.file-stale': 'The file changed on disk; reload before saving again.',
      'editor.error.file-failed': 'Read or write failed. Please retry.',
      'editor.error.feature-disabled': '“Right-Sidebar file editing” is turned off in the plugin configuration.',
      'editor.error.internal': 'The operation failed. Please retry.',
    }

    // 设置页导航自定义图标：settings.section 协议没有 icon 字段，外壳 navIcon(id) 只认
    // models/agent-presets/plugins 三个官方 id，其余一律兜底齿轮。手法学 DSH-better-sidebar：
    // 运行时在设置弹窗 nav 里按本地化文案全文匹配自己的行、打自有 data 属性（不猜 DOM 位置，
    // 切语言靠 characterData 观察自动重挂），CSS 再藏齿轮、mask SVG 画自家图标。
    // disposer 断 observer 并摘光自家标记，随 Fiber 销毁。残余脆弱点：依赖外壳 dialog>nav>button
    // 结构；与其他条目同文案会误标（本插件三个文案足够独特）。
    const NAV_ICON_SVG_OPEN = '%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2724%27 height=%2724%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27black%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E'
    const NAV_ICON_SVG_CLOSE = '%3C/svg%3E'
    const navIconMask = (body) => '-webkit-mask:url("data:image/svg+xml,' + NAV_ICON_SVG_OPEN + body + NAV_ICON_SVG_CLOSE + '") center/contain no-repeat;mask:url("data:image/svg+xml,' + NAV_ICON_SVG_OPEN + body + NAV_ICON_SVG_CLOSE + '") center/contain no-repeat'
    // 线性图标单一事实源（v0.31 用户点名：顶部标签胶囊复用既有 SVG）：每枚 = [tag, attrs]
    // 元素清单，两处消费——① 顶栏胶囊内联 React SVG；② 左列导航 mask 的 data URI 序列化。
    // 换图标只改这一处，两处永远同步。风格统一 lucide：24 viewBox、stroke 2、圆角线帽。
    const SVG_ICONS = {
      // 服务控制（左列 mask 专用）= 机架服务器（lucide server）
      service: [['rect', { width: '20', height: '8', x: '2', y: '2', rx: '2' }], ['rect', { width: '20', height: '8', x: '2', y: '14', rx: '2' }], ['line', { x1: '6', x2: '6.01', y1: '6', y2: '6' }], ['line', { x1: '6', x2: '6.01', y1: '18', y2: '18' }]],
      // 概览 = 仪表盘四宫格
      overview: [['rect', { x: '3', y: '3', width: '7', height: '9', rx: '1' }], ['rect', { x: '14', y: '3', width: '7', height: '5', rx: '1' }], ['rect', { x: '14', y: '12', width: '7', height: '9', rx: '1' }], ['rect', { x: '3', y: '16', width: '7', height: '5', rx: '1' }]],
      // 通知 = 铃铛（取 BellIcon 铃体三笔，不带对钩/斜线变体）
      notify: [['path', { d: 'M10.268 21a2 2 0 0 0 3.464 0' }], ['path', { d: 'M16.8607 4.4824A6 6 0 0 0 6 8C6 12.499 4.589 13.956 3.262 15.326' }], ['path', { d: 'M3.262 15.326A1 1 0 0 0 4 17H20A1 1 0 0 0 20.74 15.327C20.209 14.779 19.665 14.218 19.203 13.454' }]],
      // 健康诊断 = 盾牌 + 对钩
      health: [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
      // 模型统计 = 坐标轴 + 三根柱
      usage: [['path', { d: 'M3 3v16a2 2 0 0 0 2 2h16' }], ['path', { d: 'M18 17V9' }], ['path', { d: 'M13 17V5' }], ['path', { d: 'M8 17v-3' }]],
      // 额度查询 = 仪表弧 + 指针
      quota: [['path', { d: 'm12 14 4-4' }], ['path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }]],
      // 备份维护 = 归档箱
      backup: [['rect', { x: '2', y: '3', width: '20', height: '5', rx: '1' }], ['path', { d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8' }], ['path', { d: 'M10 12h4' }]],
      // 技能 = 书本轮廓
      skills: [['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }], ['path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }]],
      // 子代理 = 机器人头
      subagent: [['path', { d: 'M12 8V4H8' }], ['rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }], ['path', { d: 'M2 14h2' }], ['path', { d: 'M20 14h2' }], ['path', { d: 'M15 13v2' }], ['path', { d: 'M9 13v2' }]],
      // 会话管理 = 对话气泡 + 对钩（查/导出/归档的管理语义）
      sessions: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }], ['path', { d: 'm9 10 2 2 4-4' }]],
      // 重启 = 电源符号
      restart: [['path', { d: 'M12 2v10' }], ['path', { d: 'M18.4 6.6a9 9 0 1 1-12.77.04' }]],
      // 维护 = 扳手（v0.39 六页导航新 id）
      maintenance: [['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }]],
      // 配置 = settings-2 双滑杆组
      configuration: [['path', { d: 'M20 7h-9' }], ['path', { d: 'M14 17H5' }], ['circle', { cx: '17', cy: '17', r: '3' }], ['circle', { cx: '7', cy: '7', r: '3' }]],
    }
    // 左列 mask 的 data URI 体序列化：`<tag attr='val'/>` → %3Ctag%20attr=%27val%27/%3E。
    // 输出 byte 级等于历史上手写的常量（属性分隔用原始空格），外观零漂移。
    const iconMaskBody = (icon) => icon.map(([tag, attrs]) =>
      '%3C' + tag + Object.entries(attrs).map(([k, v]) => ` ${k}=%27${v}%27`).join('') + '/%3E').join('')
    const NAV_ICON_BODY_SERVICE = iconMaskBody(SVG_ICONS.service)
    const NAV_ICON_BODY_QUOTA = iconMaskBody(SVG_ICONS.quota)
    const NAV_ICON_BODY_RESTART = iconMaskBody(SVG_ICONS.restart)
    // 会话管理 = 对话气泡 + 对钩（lucide message-circle check，16px 下可读）
    const NAV_ICON_BODY_SESSIONS = iconMaskBody(SVG_ICONS.sessions)
    /** 顶栏胶囊的内联 SVG 图标：跟随 currentColor，尺寸 13px，随文字基线居中。 */
    function TabIcon({ name }) {
      const elements = SVG_ICONS[name]
      if (elements === undefined) return null
      return React.createElement('svg', {
        viewBox: '0 0 24 24', width: 13, height: 13, fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
        style: { flexShrink: 0, display: 'block' },
      }, elements.map(([tag, attrs], index) => React.createElement(tag, Object.assign({ key: index }, attrs))))
    }
    // v0.34 顶栏分段条激活段实底色。v0.34.2 用户复核定稿——**按主题分流**：
    // 浅色主题 = 品牌原色实底 + 白字（黑/深底白字，用户点名）；暗色主题 = 提亮品牌色块
    // 激活块底色与文字色均由插件样式表的双主题变量决定（写死中性固定色，见 v0.34.2 注释）：
    // 组件只引用变量，React 内联样式无需感知当前主题。不支持变量的极老内核回退到浅色深块白字。
    const CHIP_ACTIVE_TEXT = 'var(--dsh-svc-tab-active-text)'

    let syncNavDom = () => {}

    function markSettingsNavRows(rows) {
      if (typeof document === 'undefined' || !document.body) return () => {}
      let disposed = false
      let frame = null
      let nav = null
      let navObserver = null
      const scheduleSync = () => {
        if (disposed || frame !== null) return
        if (typeof requestAnimationFrame !== 'function') {
          sync()
          return
        }
        frame = requestAnimationFrame(() => {
          frame = null
          sync()
        })
      }
      const sync = () => {
        if (disposed) return
        const nextNav = typeof document.querySelector === 'function'
          ? document.querySelector('[role="dialog"] nav')
          : null
        if (nextNav !== nav) {
          if (navObserver !== null) navObserver.disconnect()
          navObserver = null
          nav = nextNav
          // 语言切换可能原地改 text node，所以 characterData 只保留在小范围 nav 子树；
          // body 级观察器只负责发现 dialog/nav 的挂载和卸载，不再被聊天流式 token 唤醒。
          if (nav !== null) {
            navObserver = new MutationObserver(scheduleSync)
            navObserver.observe(nav, { childList: true, subtree: true, characterData: true })
          }
        }
        if (nav === null) return
        const buttons = typeof nav.querySelectorAll === 'function'
          ? nav.querySelectorAll('button')
          : document.querySelectorAll('[role="dialog"] nav button')
        for (const button of buttons) {
          const text = (button.textContent || '').trim()
          for (const row of rows) {
            const label = String(row.label() || '').trim()
            if (label && text === label) button.setAttribute(row.attr, '')
            else button.removeAttribute(row.attr)
          }
        }
        syncNavDom()
      }
      sync()
      const bodyObserver = new MutationObserver(scheduleSync)
      bodyObserver.observe(document.body, { childList: true, subtree: true })
      return () => {
        disposed = true
        bodyObserver.disconnect()
        if (navObserver !== null) navObserver.disconnect()
        navObserver = null
        nav = null
        if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        frame = null
        for (const row of rows) {
          for (const el of document.querySelectorAll('[' + row.attr + ']')) el.removeAttribute(row.attr)
        }
      }
    }

    // 设置服务不在这里：0.1.7-alpha.1 移除了 settingsScope、0.1.6 及更早没有 configForms，
    // 静态声明任一方都会在另一版本上阻断整个客户端激活。改为运行时能力探测
    // （createFeatureSettings -> configForms / settingsScope / 内存兜底）。
    const inject = ['slots', 'connection', 'timer', 'locale', 'sessions']

    // ── 子代理行纯逻辑（模块级便于单测）──────────────────────────────────
    /** 按 provider/model/effort 聚合记录为展示条目（保持首个出现的顺序，同名路由计数）。 */
    function aggregateSubagentRoutes(records) {
      if (!Array.isArray(records)) return []
      const entries = []
      const index = new Map()
      for (const record of records) {
        if (record === null || typeof record !== 'object') continue
        const provider = typeof record.provider === 'string' && record.provider !== '' ? record.provider : undefined
        const model = typeof record.model === 'string' && record.model !== '' ? record.model : undefined
        if (provider === undefined || model === undefined) continue
        const effort = typeof record.reasoningEffort === 'string' && record.reasoningEffort !== '' ? record.reasoningEffort : undefined
        const key = provider + '\u0000' + model + '\u0000' + (effort ?? '')
        let entry = index.get(key)
        if (entry === undefined) {
          entry = { provider, model, ...(effort !== undefined ? { reasoningEffort: effort } : {}), count: 0 }
          index.set(key, entry)
          entries.push(entry)
        }
        entry.count += 1
      }
      return entries
    }

    /** 条目 → 一行文本：`provider/model (effort)`，计数>1 才带 ` ×n`，条目间 ` · `。 */
    function subagentRouteListText(entries) {
      return (Array.isArray(entries) ? entries : []).map((entry) => {
        if (entry === null || typeof entry !== 'object') return ''
        const provider = typeof entry.provider === 'string' ? entry.provider : ''
        const model = typeof entry.model === 'string' ? entry.model : ''
        const effort = typeof entry.reasoningEffort === 'string' && entry.reasoningEffort !== '' ? entry.reasoningEffort : undefined
        const count = Number.isFinite(entry.count) && entry.count > 1 ? ` ×${entry.count}` : ''
        return `${provider}/${model}${effort !== undefined ? ` (${effort})` : ''}${count}`
      }).filter((part) => part !== '').join(' · ')
    }

    function normalizeRpcResult(result) {
      if (!result || result.ok !== false || typeof result.error !== 'object' || result.error === null) return result
      const detail = typeof result.error.details?.detail === 'string' ? result.error.details.detail : result.detail
      const message = typeof result.error.message === 'string' ? result.error.message : result.error.code
      return { ...result, error: message || 'unknown', ...(detail !== undefined ? { detail } : {}) }
    }
