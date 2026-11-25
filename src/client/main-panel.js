// 客户端半分片：运维面板的侧栏独立页面（主面板，P1）。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域；
// 本段必须排在 apply.js 之前（工厂在 apply 内被调用，ServicePanel 由调用方按引用传入）。
//
// 形态：功能开关 sidebarPanel（默认关，宿主侧见 DEFAULT_FEATURE_SETTINGS）与两道能力门
// （layout 服务在位、宿主已声明 sidebar.panellist 槽）全部满足才**成对**注册：
//   · main（key = dsh-service）：官方布局只挂载被选中的面板，离开即卸载；
//   · sidebar.panellist（id = dsh-service）：侧栏全局面板行。按钮、无障碍名称与
//     aria-current 全由侧栏拥有，注册方只拿到图标位 props { size, active }。
// 关闭开关或能力缺失时两条注册一起注销；若此刻正显示本面板，先 layout.selectPanel(null)
// 回到会话页再注销（官方 store 在 main 条目消失时也会回落选中态，这里不依赖它）。
//
// 页面几何由插件自持：官方 .mainPanel 无 padding/overflow，故页壳撑满高度、自有纵向
// 滚动、顶部为 macOS 顶部让位（--dsh-frame-top-clearance）留白、内容居中定宽。
// 既有 [data-dshsvc-root] 的卡片外观是给设置弹窗写的，只在**本页壳之内**中和，
// 不改既有选择器本身。
//
// 失败姿态：开关默认关 ⇒ 零注册、零样式注入；构造与 sync 全程不向上抛
// （加载期异常会让活体用户的客户端半整体失效），内部 try/catch 后静默降级。

function createMainPanel({ ctx, t, ServicePanel, featureEnabled }) {
  // 与设置节 id 同名；官方已占用 conversation / plugins / schedules / dsh-market。
  const PANEL_KEY = 'dsh-service'
  const MAIN_SLOT = 'main'
  const SIDEBAR_SLOT = 'sidebar.panellist'
  // 与 `main` 的 key 成对：侧栏回调按 id 找到它对应的主面板。
  const SIDEBAR_ORDER = 1
  // 侧栏行图标尺寸随 owner.size；给一个合理上下限，异常值不放大也不缩成不可见。
  const ICON_FALLBACK_PX = 18
  const ICON_MIN_PX = 12
  const ICON_MAX_PX = 40

  const MAIN_PANEL_SELECTOR = '[data-dshsvc-main-panel]'

  // 页壳与内容列。官方 .mainPanel 是纯 flex 容器（无 padding/overflow），因此
  // 高度、滚动与顶部让位全部由这里给；左右留白用与官方入口页同源的算法。
  const MAIN_PANEL_CSS = [
    MAIN_PANEL_SELECTOR + '{box-sizing:border-box;display:block;flex:1 1 auto;height:100%;min-height:0;overflow-y:auto;overflow-x:hidden;padding:calc(28px + var(--dsh-frame-top-clearance,0px)) 0 0;-webkit-overflow-scrolling:touch}',
    MAIN_PANEL_SELECTOR + ' [data-dshsvc-main-panel-inner]{box-sizing:border-box;width:100%;padding:0 max(max(16px,min(4vw,48px)),50% - 480px) 32px}',
    // 根容器在设置卡里是「卡片」：底色 / 圆角 / 内边距在主面板里中和成平铺页面。
    // 选择器**限定在本页壳之内**，既有 [data-dshsvc-root] 规则一字不改。
    MAIN_PANEL_SELECTOR + ' [data-dshsvc-root]{background:transparent;border-radius:0;padding:0}',
  ].join('')

  let layout = undefined
  let releaseLayoutInject = null
  let sidebarDeclared = false
  let releaseSidebarInject = null
  let disposeMain = null
  let disposeSidebarRow = null
  let styleElement = null
  let disposed = false

  // 构造与 sync 的兜底：任何异常都只记一条告警，不向上冒到 apply()（加载期抛错会
  // 让插件客户端半整体失效）。
  const guard = (label, run) => (...args) => {
    try {
      return run(...args)
    } catch (error) {
      try {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn('[dsh-service] ' + label + ' failed', error)
      } catch (_) {}
      return undefined
    }
  }

  // 未在 inject 声明过的可选服务一律 ctx.get（直接访问 ctx.layout 会被 Cordis Proxy 拒绝）。
  const readLayout = () => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('layout') : undefined
    } catch (_) {
      return undefined
    }
  }
  const usableLayout = (candidate) => candidate !== null && typeof candidate === 'object'

  const ensureStyle = () => {
    if (styleElement !== null) return
    try {
      if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return
      const tag = document.createElement('style')
      // 归属标记：客户端加载器按 style[data-plugin] 精确移除（与 apply.js 的 svcStyle 同规）。
      tag.dataset.plugin = '@gehennawu/dsh-service'
      tag.dataset.pluginCss = '@gehennawu/dsh-service/main-panel.css'
      tag.textContent = MAIN_PANEL_CSS
      document.head.appendChild(tag)
      styleElement = tag
    } catch (_) {
      styleElement = null
    }
  }
  const removeStyle = () => {
    if (styleElement === null) return
    const tag = styleElement
    styleElement = null
    try {
      if (typeof tag.remove === 'function') tag.remove()
    } catch (_) {}
  }

  // 注销前主动把选中态交还给会话页：官方服务对**未注册**的 key 会抛错，
  // 故先清选中再摘条目，且自己做 try/catch（布局服务可能已被卸载）。
  const clearActivePanel = () => {
    try {
      if (!usableLayout(layout)) return
      const snapshot = layout.panelInfo !== null && typeof layout.panelInfo === 'object' && typeof layout.panelInfo.getSnapshot === 'function'
        ? layout.panelInfo.getSnapshot()
        : undefined
      if (snapshot === null || typeof snapshot !== 'object' || snapshot.activePanelId !== PANEL_KEY) return
      if (typeof layout.selectPanel === 'function') layout.selectPanel(null)
    } catch (_) {}
  }

  const unregister = () => {
    clearActivePanel()
    const row = disposeSidebarRow
    disposeSidebarRow = null
    if (typeof row === 'function') {
      try { row() } catch (_) {}
    }
    const panel = disposeMain
    disposeMain = null
    if (typeof panel === 'function') {
      try { panel() } catch (_) {}
    }
  }

  // 侧栏行图标：尺寸随 owner.size、选中态随 owner.active；颜色走 currentColor，
  // 无障碍名称由侧栏按钮拥有，故图标 aria-hidden。仪表盘式四宫格，语义中性。
  function SidebarPanelIcon(ownerProps) {
    const props = ownerProps !== null && typeof ownerProps === 'object' ? ownerProps : {}
    const requested = Number(props.size)
    const size = Number.isFinite(requested) && requested > 0
      ? Math.min(ICON_MAX_PX, Math.max(ICON_MIN_PX, Math.round(requested)))
      : ICON_FALLBACK_PX
    const glyph = (x, y, width, height) => React.createElement('rect', { key: x + '-' + y, x, y, width, height, rx: 1.5 })
    return React.createElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'currentColor',
      'aria-hidden': 'true',
      focusable: 'false',
      'data-dshsvc-panel-icon': '',
      style: { display: 'block', width: size, height: size, flex: 'none', color: 'currentColor', opacity: props.active === true ? 1 : 0.82 },
    },
      glyph(3, 3, 8, 8),
      glyph(13, 3, 8, 5),
      glyph(13, 10, 8, 11),
      glyph(3, 13, 8, 8))
  }

  // 主面板 = 页面壳 + 现有 ServicePanel。ServicePanel 零参数、不读 owner props。
  function MainPanelPage() {
    return React.createElement('div', {
      'data-dshsvc-main-panel': '',
      'data-testid': 'dsh-service-main-panel',
      className: 'dshsvc-main-panel',
    }, React.createElement('div', {
      'data-dshsvc-main-panel-inner': '',
      className: 'dshsvc-main-panel-inner',
    }, React.createElement(ServicePanel, null)))
  }

  // 开关 / 能力门 → 注册状态的唯一收敛点。可见性真变化才动注册（无关开关的写入
  // 也会触发订阅回调，重复注册会闪一下并丢掉页内状态）。
  const sync = guard('sidebar main panel sync', () => {
    if (disposed) return
    const wanted = featureEnabled('sidebarPanel') === true && usableLayout(layout) && sidebarDeclared === true
    const registered = disposeMain !== null && disposeSidebarRow !== null
    if (wanted === registered) return
    if (!wanted) {
      unregister()
      return
    }
    ensureStyle()
    // 成对注册：任一条失败都整体回滚，绝不留下「有行无面板」或「有面板无行」。
    const offRow = ctx.slots.register({
      name: SIDEBAR_SLOT,
      id: PANEL_KEY,
      order: SIDEBAR_ORDER,
      label: () => t('nav.label'),
    }, SidebarPanelIcon)
    disposeSidebarRow = typeof offRow === 'function' ? offRow : () => {}
    try {
      const offPanel = ctx.slots.register({ name: MAIN_SLOT, key: PANEL_KEY }, MainPanelPage)
      disposeMain = typeof offPanel === 'function' ? offPanel : () => {}
    } catch (error) {
      unregister()
      throw error
    }
  })

  // 能力门②：sidebar.panellist 槽由官方 sidebar 的 sidebar.panel.icon factory 声明，
  // 只在侧栏根活跃时存在 ⇒ inject 回调在槽未声明时不运行（也不报错），可作能力探针；
  // 槽折叠时回调的 disposer 运行，条目随之摘除。
  const openSidebarGate = () => {
    try {
      if (typeof ctx.slots?.inject !== 'function') return
      releaseSidebarInject = ctx.slots.inject(SIDEBAR_SLOT, () => {
        sidebarDeclared = true
        sync()
        return () => {
          sidebarDeclared = false
          unregister()
        }
      })
    } catch (_) {
      releaseSidebarInject = null
    }
  }

  // 能力门①：layout 可能晚于本插件上线；取不到时等注入回调，回调里再 sync。
  const adoptLayout = (candidate) => {
    const next = usableLayout(candidate) ? candidate : readLayout()
    if (!usableLayout(next)) return
    if (next !== layout) layout = next
    sync()
  }
  const openLayoutGate = () => {
    layout = readLayout()
    if (usableLayout(layout)) return
    if (typeof ctx.inject !== 'function') return
    try {
      releaseLayoutInject = ctx.inject(['layout'], (scope) => {
        let candidate
        try {
          candidate = scope !== null && typeof scope === 'object' ? scope.layout : undefined
        } catch (_) {
          candidate = undefined
        }
        adoptLayout(candidate)
      })
    } catch (_) {
      releaseLayoutInject = null
    }
  }

  const dispose = guard('sidebar main panel dispose', () => {
    if (disposed) return
    disposed = true
    unregister()
    if (typeof releaseSidebarInject === 'function') {
      const release = releaseSidebarInject
      releaseSidebarInject = null
      try { release() } catch (_) {}
    }
    if (typeof releaseLayoutInject === 'function') {
      const release = releaseLayoutInject
      releaseLayoutInject = null
      try { release() } catch (_) {}
    }
    removeStyle()
  })

  // 构造顺序：先装两道能力门（回调里会调用 sync，此时 sync 已就绪），
  // 首次 sync 由 apply 在功能订阅建立后统一触发。
  openSidebarGate()
  openLayoutGate()

  return { sync, dispose }
}
