// 客户端半分片：移动端适配引擎（v0.30）。
// 分片不是模块——与 src/client.js 等按 scripts/client-source.mjs 清单拼接成同一个
// factory 作用域；缩进保留自 apply 体的搬运原深，terser 产物不受影响。
// 原 apply 内「常量 + 样式表 + 引擎」整段迁出；闭包捕获改为显式参数
// { ctx, t, featureEnabled, createConversationNav }，调用点在 apply.js。

      // ─── 移动端适配引擎（v0.30）─────────────────────────────────────────
      // 断点与官方外壳一致取 <1024px（AppFrame 的 SIDEBAR_AUTO_COLLAPSE）。
      // 全部规则作用域于 html[data-dshsvc-mobile] 属性下；抽屉开合走官方
      // ctx.layout 服务，不重挂宿主 DOM。桌面 ≥1024px 或功能关闭时零效果。
      const MOBILE_ACTIVE_QUERY = '(max-width: 1023px)'
      const MOBILE_DEBUG_PARAM = 'dshsvc-mobile-debug'
      // —— 滑动沉浸（v0.36）：方向手势藏「会话头部 + composer 座」，把手/上滑/到底回显。
      // 全部走官方属性钩子（[data-conversation-scroll]、[data-composer-seat]、[data-phase]），
      // 不依赖类哈希，外壳升级零漂移。
      const IMMERSIVE_HIDE_PX = 64        // 累计下滑越过此值 → 隐藏（位移按手势窗口内连续累加）
      const IMMERSIVE_SHOW_PX = 24        // 上滑回显阈值：更小的迟滞带，避免阅读翻页闪烁
      const IMMERSIVE_BOTTOM_PX = 80      // 距底小于此值且是用户手势 → 强制回显
      const IMMERSIVE_DELTA_CAP_PX = 200  // 单事件位移上限：scrollTo 跳变不算手势
      const IMMERSIVE_ACC_CLAMP_PX = 240  // 累加器饱和界：防止极端长滑程数值无意义膨胀
      const IMMERSIVE_MIN_SCROLLABLE_PX = 24
      const GESTURE_WINDOW_MS = 800       // touchstart/move/wheel 后的有效窗口；窗口外一律视为程序化滚动
      // —— 边缘手势开合抽屉（2026-09 用户点名；真机返工第三轮）——
      // 系统手势竞争：iOS Safari / Android Edge|Chrome 的「边缘滑动=返回」会抢走
      // 从物理边缘起滑的触摸。四条缓解：开启追踪对齐关闭手势的任意起点语义
      // （真机第三轮用户点名：贴边限制太严，滑动范围大了失败）；touchcancel 用
      // 取消事件最终触点按放宽阈值补完；快速短拂补完（类原生抽屉速度语义）；
      // debug 芯片边缘遥测（?dshsvc-mobile-debug=1，真机定位用）。
      // 补完只作用于【贴边起滑】的开启追踪：系统手势竞争只存在于屏幕边缘，
      // 非贴边起点走完整触发阈即可；关闭路径不放大（不扰动已验证行为）。
      const EDGE_ZONE_PX = 32             // 贴边判定带（仅决定是否享有放宽补完，不再限制 arm）
      const EDGE_TRIGGER_PX = 56          // 水平位移触发阈值（触摸存活期间的完整触发）
      const EDGE_CANCEL_PX = 6            // touchcancel 补完阈值：系统接管时已达此横移即完成动作（
                                          // 6px 起判：静止触被取消 dx≈0 不命中，纵向滚动接管被斜率检查拒绝）
      const EDGE_SLANT_PX = 12            // 纵向主导作废阈：|dy|>|dx| 且超过此值即放弃（滚动优先）
      const EDGE_FLICK_PX = 32            // 快速短拂补完阈值（touchend；仅贴边起滑的开启追踪）
      const EDGE_FLICK_MS = 260           // 快速短拂的时长上限（起触到抬手）
      const MOBILE_CSS = `
/* 侧栏/详情列改 absolute 后会退出 grid 排版流，中列会被自动放置进第 1 轨
   （0px）而整屏变黑 —— 三列必须用 grid-column 显式钉位，绝不依赖子元素顺序。 */
html[data-dshsvc-mobile] [data-dshsvc-frame] { grid-template-columns: 0px minmax(0, 1fr) 0px !important; }
/* 0.1.5+ 右栏列（rightbarCol）：官方右栏自有窄屏语义（<768 开=浮层全屏 portal 到
   body，闭=0 轨），第三轨改 auto 让官方宽度生效——钉 0px 会把 push 态面板挤没。
   :has 特异性高于上一条，天然覆盖；旧宿主无 rightbar 标记时仍走 0px 模板。 */
html[data-dshsvc-mobile] [data-dshsvc-frame]:has([data-dshsvc-rightbar]) { grid-template-columns: 0px minmax(0, 1fr) auto !important; }
html[data-dshsvc-mobile] [data-dshsvc-sidebar] { grid-column: 1 !important; grid-row: 1 !important; }
html[data-dshsvc-mobile] [data-dshsvc-center] { grid-column: 2 !important; grid-row: 1 !important; }
html[data-dshsvc-mobile] [data-dshsvc-details] { grid-column: 3 !important; grid-row: 1 !important; }
html[data-dshsvc-mobile] [data-dshsvc-rightbar] { grid-column: 3 !important; grid-row: 1 !important; }
/* 侧栏/详情列 → overlay 抽屉。两条铁律：
   ① 隐藏禁用 transform —— 设置模态（未 portal）长在本列子树里，
      transform 会成为其 fixed 定位的包含块；
   ② 离屏偏移必须用 vw 长度而非百分比 —— 这些列带显式 grid-column 钉位
      （修中列黑屏所需），绝对定位子项的包含块会变成那格 grid area（0px 宽），
      百分比对 0 取值全变 0，元素被超约束解算推回屏内盖住会话。 */
html[data-dshsvc-mobile] [data-dshsvc-sidebar] {
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  left: calc(-100vw - 24px) !important;
  /* 外壳 sidebar slot 的原生展开内容固定 280px；外层也必须同宽，否则右侧
     会露出一条只有 sidebarCol 背景、没有内容的空带。窄于 280px 时按视口裁切。 */
  width: min(100vw, 280px) !important;
  border-right: none !important;
  z-index: 32;
  transition: left var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease);
}
html[data-dshsvc-mobile] [data-dshsvc-frame]:not([data-sidebar-collapsed]) [data-dshsvc-sidebar] {
  left: 0 !important;
  box-shadow: 8px 0 32px rgba(0, 0, 0, .22);
}
/* 详情列（预览/文件树）→ 移动端永久离屏。官方 computeColumns 在窄视口恒为
   0 宽（原生手机本就不显示该列），抽屉化只会用空态盖住会话且关闭路径
   与 backdrop/抽屉状态纠缠（真机反馈）。引擎在激活与属性观察时会自愈式
   closeDetails()，保证 store 也是干净的关闭态。 */
html[data-dshsvc-mobile] [data-dshsvc-details] {
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  right: calc(-100vw - 24px) !important;
  width: min(92vw, 420px) !important;
  z-index: 30;
}
/* 模态 → 全屏面板：外壳 portal 根是 fixed inset:0 flex 容器（无 transform，
   无 containing-block 陷阱），dialog 改 absolute 四边拉满即可。
   真机反馈：底部 sheet 顶部留空难看 → 顶部贴顶、圆角归零；
   刘海/home 条遮挡由 dialog 自身 env() padding 补回。 */
html[data-dshsvc-mobile] div[role="presentation"]:has(> [role="dialog"][aria-modal="true"]) {
  padding: 0 !important;
}
html[data-dshsvc-mobile] [role="dialog"][aria-modal="true"] {
  position: absolute !important;
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  left: 0 !important;
  margin: 0 !important;
  width: 100% !important;
  max-width: none !important;
  max-height: none !important;
  height: 100% !important;
  border-radius: 0 !important;
  overflow: hidden auto !important;
  flex-direction: column !important;
  padding-top: env(safe-area-inset-top, 0px) !important;
  padding-bottom: env(safe-area-inset-bottom, 0px) !important;
}
/* 插件市场（dshmarket）在 ≤560px 媒体查询里把设置导航 display:none 藏掉
   独占面板（其自有 CSS：[role=dialog]:has([data-dsh-market-root])>nav），
   手机上会把用户困在市场分区 —— 用更高优先级把横滑标签条顶回来。 */
html[data-dshsvc-mobile] [role="dialog"]:has([data-dsh-market-root]) > nav { display: flex !important; }
/* 设置页标签条：nav 从 188px 竖列变顶部横滑条（宽度与列向必须显式推翻）。
   右侧留 52px 给钉到角落的关闭钮。 */
html[data-dshsvc-mobile] [role="dialog"] nav {
  flex-direction: row !important;
  align-items: center !important;
  gap: 6px !important;
  width: auto !important;
  flex: none !important;
  padding: 8px 52px 0 12px !important;
  overflow-x: auto !important;
  overflow-y: hidden !important;
  border-right: none !important;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
html[data-dshsvc-mobile] [role="dialog"] nav > div { flex: none !important; }
html[data-dshsvc-mobile] [role="dialog"] [class*="navList"] { flex-direction: row !important; }
html[data-dshsvc-mobile] [role="dialog"] [class*="navCell"] { white-space: nowrap !important; flex: none !important; }
/* 关闭钮钉到设置页右上角并压到面板顶层（原生在内容区头行、导航条下方，
   会被横滑条/内容重叠遮挡——用户点名要顶层）；加不透明圆形底衬保证任何
   内容上都可辨识，底衬与钮同节点、随之置顶。类哈希 VOzbGW_ 取自
   dsh-client-ui-settings-general SettingsRoot.module.css（rc.2），升级需复核 */
html[data-dshsvc-mobile] [role="dialog"][aria-modal="true"] [class*="VOzbGW_close"] {
  position: absolute !important;
  top: calc(env(safe-area-inset-top, 0px) + 9px) !important;
  right: 10px !important;
  z-index: 60;
  background-color: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1)) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: 999px !important;
  corner-shape: round !important;
  box-shadow: var(--dsw-shadow-lv2, 0 4px 12px rgba(0, 0, 0, .12)) !important;
}
/* 设置内容列利用率：手机全屏后内容仍被
   宿主 options 24px → 插件看板卡 12px → 汇总小卡 10px 的多层内边距套娃收窄
   （单侧 ~46px、约一成屏宽）。只收紧间距不动物料：options 是宿主滚动容器、
   全分区生效（24→14）；看板/图表卡按 testid 收紧；汇总行禁折行——label/value
   两个 span 在窄卡会被 flex 按比例收缩成 40~70px 盒子导致短标签折行
   （2026-09-18 真机 360/390px 实测），nowrap 后装不下时值列省略兜底。 */
html[data-dshsvc-mobile] [class*="VOzbGW_options"] { padding: 0 14px 18px !important; }
html[data-dshsvc-mobile] [data-testid="usage-statistics-region"] { padding: 8px !important; }
html[data-dshsvc-mobile] [data-testid="usage-chart"] { padding: 8px 8px 2px !important; }
html[data-dshsvc-mobile] [data-testid^="usage-summary-"] { column-gap: 8px !important; }
html[data-dshsvc-mobile] [data-testid^="usage-summary-"] > span { white-space: nowrap !important; }
html[data-dshsvc-mobile] [data-testid^="usage-summary-"] > span:last-child {
  min-width: 0 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
/* 设置/任意模态打开时藏抽屉钮：抽屉列自带 z-index:32 层叠上下文会把模态的
   z1000 封顶在 32，body 级 z33 的钮反而浮在设置页上（真机实测）。:has 不支持时
   退化为旧行为（钮仍显示），无副作用。 */
html[data-dshsvc-mobile] body:has([role="dialog"][aria-modal="true"]) [data-dshsvc-fab] {
  display: none !important;
}
/* composer 底行单行紧凑：外壳原生 flex-wrap:wrap 在窄屏把图标/模型名折成两行。
   收紧间距 + 禁换行 + 最宽触发钮限宽省略。类哈希 uV2eYG_/Sh0Q9G_/pXSMma_ 取自
   dsh-client-ui-conversation composer（rc.2，0.1.6-alpha.1 漂移至 JObwrW_ 并存），升级需复核。 */
html[data-dshsvc-mobile] [class*="uV2eYG_row"] {
  flex-wrap: nowrap !important;
  column-gap: 4px !important;
  padding-left: 10px !important;
  padding-right: 10px !important;
}
html[data-dshsvc-mobile] [class*="uV2eYG_row"] > * { min-width: 0 !important; }
html[data-dshsvc-mobile] [class*="uV2eYG_tools"],
html[data-dshsvc-mobile] [class*="uV2eYG_modes"],
html[data-dshsvc-mobile] [class*="uV2eYG_trailing"] { gap: 6px !important; min-width: 0 !important; }
html[data-dshsvc-mobile] [class*="uV2eYG_trailing"] { margin-left: auto !important; }
html[data-dshsvc-mobile] [class*="Sh0Q9G_trigger"],
html[data-dshsvc-mobile] [class*="JObwrW_trigger"] { max-width: 38vw !important; }
html[data-dshsvc-mobile] [class*="pXSMma_workspace"] { max-width: 30vw !important; }
/* 模型选择按钮收成图标（用户点名，2026-09-15）：官方 ModelSelect 只在容器
   ≤360px 时把 triggerLabel/triggerEffort 换成 triggerIcon，而查询容器正是上面
   这条底行——本插件移动端把中列拉满、收回官方 56px sidebar rail，428~440px
   机型的行内容盒达 368~378px，官方规则永不触发，手机上常显模型名。这里显式
   按官方窄容器形态收成图标（唯一被藏起来的是「名称」这一处视觉信息：官方
   trigger 自带含模型名的 aria-label，读屏照旧）。
   媒体查询门是必需的：移动端适配覆盖 ≤1023px，481px 以上行内足够宽，官方
   语义本就是「放得下就显示名称」；480 = 官方等效临界视口（360 + 56 rail +
   32 clearance + 16 row padding ≈ 464~474）的安全上界。类哈希 _7KE1Ra_ 取自
   dsh-client-ui-model-selection ModelSelect.module.css（rc.2），升级需复核。 */
@media (max-width: 480px) {
  html[data-dshsvc-mobile] [class*="_7KE1Ra_triggerIcon"] { display: block !important; }
  html[data-dshsvc-mobile] [class*="_7KE1Ra_triggerLabel"],
  html[data-dshsvc-mobile] [class*="_7KE1Ra_triggerEffort"] { display: none !important; }
}
/* 工作区侧板（fixed z25 层内的 nArs4W_panel z40）开屏后会盖住它自己的外部
   开关钮（tab bar 行 nArs4W_toggleButton）——手机上抽屉一开就再没有任何
   可点的关闭入口（真机反馈「关不上」本体）。把开关钮提到面板之上，
   恢复「同一颗钮开/关」语义。 */
html[data-dshsvc-mobile] [class*="nArs4W_toggleButton"] {
  position: relative !important;
  z-index: 45 !important;
}
/* 会话底部统计条（composer 下方两枚统计：轮/步/tok/s ｜ tok/缓存命中）：
   官方这条行自带左右各 32px 内边距 + 12px 列间距，手机上先吃掉 76px；两枚 pill
   完整显示需 ~380px，于是官方让它们各自收缩、把每枚的文字截断（0.1.5-rc.2 的
   截断落在每枚 pill 自己的 bOPqQW_label 上）。用户点名（2026-09-15）：「不要换行，
   保持一行、把空间利用最大化」。
   修法：只收紧这条行自身的内边距/间距（32→2px、12→3px），行内两枚按官方
   justify-content 居中排开、flex-wrap:nowrap 保持一行；宽度不够时两枚按 shrink
   比例各让一点（比官方的固定截断少一个数量级），全程不换行、不横向滚动。
   注意「用满宽度」是靠**收窄行的内边距**换来的，不是靠子项 flex-grow——grow 会把
   整组推向左侧（老宿主形态，见下方 bOPqQW_root 规则注）。
   旧宿主（0.1.2-alpha.2 ~ 0.1.4）的单行横滑规则（NDN2W_root）原样保留。 */
/* 统计条与外部上下文圆环的单行布局：
   0.1.6 官方把上下文圆环（JObwrW_root / JObwrW_trigger）移入输入框外部下方的
   uV2eYG_dock，与统计胶囊（bOPqQW_root）并列，挤占了移动端可用宽度。
   修法：
   ① 收紧 uV2eYG_root 两侧内边距至 8px，uV2eYG_dock 间距收至 3px；换行保持开启——
   圆环与统计胶囊共占第一行，插件的子代理累计行（flex-basis:100%，见 apply.js svcStyle）
   独占第二行，官方条目之间仍不换行；
   ② 降低统计条与上下文圆环字号至 11px（≤375px 极窄视口阶梯降至 10px），行高 16px；
   ③ 收紧 pill 内边距、sep 间隔及 svg 尺寸（11px），上下文圆环内边距收至 1px 3px；
   保证从 360px 起所有移动端视口下统计与上下文圆环均零截断、单行排开。
   旧宿主（0.1.2-alpha.2 ~ 0.1.4）的单行横滑规则（NDN2W_root）原样保留。 */
html[data-dshsvc-mobile] [class*="uV2eYG_root"] {
  padding-left: 8px !important;
  padding-right: 8px !important;
}
html[data-dshsvc-mobile] [class*="uV2eYG_dock"] {
  gap: 0 3px !important;
  max-width: 100% !important;
  flex-wrap: wrap !important;
  justify-content: center !important;
}
html[data-dshsvc-mobile] [class*="NDN2W_root"] {
  overflow-x: auto !important;
  overflow-y: hidden !important;
  text-overflow: clip !important;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none !important;
}
html[data-dshsvc-mobile] [class*="NDN2W_root"]::-webkit-scrollbar { display: none !important; }
/* 统计行在老宿主上是「整行宽 + 居中」，子项 flex-grow 一旦非 0 整组就会左偏：
   官方这条行的盒子随版本变过两次形态——
   · 0.1.5-rc.2：width:100% + padding:0 32px + justify-content:center，宽度
     **等于整行**（它是 composer 卡片里的一行），行内必有富余宽度；
   · 0.1.6 起：max-width:100%，行**收缩到内容宽**，再由外层 dock 居中，行内零富余。
   富余宽度落在 justify-content:center 上才是「两枚统计居中」；若给子项 flex-grow，
   两枚 anchor 先把富余吃干，而行内每枚 pill 是默认 justify-content:flex-start
   ⇒ 文字贴着行内容盒左端、右端留出与富余等宽的空洞（实测 606px 视口尾空 144.7px、
   整组中心偏移 −72.3px，即「统计是歪的」）。故子项 grow 必须为 0：老宿主上交还给
   官方 justify-content 居中，新宿主上行本就无富余、写成 0 与 1 等效（空操作）。
   收缩仍保留 shrink:1，窄视口按比例让位的既定行为不变。 */
html[data-dshsvc-mobile] [class*="bOPqQW_root"] {
  flex-wrap: nowrap !important;
  padding-left: 2px !important;
  padding-right: 2px !important;
  column-gap: 3px !important;
  font-size: 11px !important;
  line-height: 16px !important;
}
/* 子项用 flex:0 1 auto（= flex 初始值）而非 flex:1 1 auto：
   grow 必须为 0，否则老宿主把统计整组推歪（见上方 rc.2 注）。 */
html[data-dshsvc-mobile] [class*="bOPqQW_root"] > * { flex: 0 1 auto !important; min-width: 0 !important; }
html[data-dshsvc-mobile] [class*="bOPqQW_pill"] {
  min-width: 0 !important;
  padding-left: 2px !important;
  padding-right: 2px !important;
  gap: 2px !important;
  font-size: 11px !important;
  line-height: 16px !important;
}
html[data-dshsvc-mobile] [class*="bOPqQW_pill"] svg {
  width: 11px !important;
  height: 11px !important;
  flex: none !important;
}
html[data-dshsvc-mobile] [class*="bOPqQW_sep"] {
  margin: 0 1px !important;
}
html[data-dshsvc-mobile] [class*="bOPqQW_label"] {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
html[data-dshsvc-mobile] [class*="JObwrW_root"] {
  flex: none !important;
  min-width: 0 !important;
}
html[data-dshsvc-mobile] [class*="JObwrW_trigger"] {
  font-size: 11px !important;
  line-height: 16px !important;
  padding: 1px 3px !important;
  gap: 2px !important;
}
html[data-dshsvc-mobile] [class*="JObwrW_trigger"] svg {
  width: 11px !important;
  height: 11px !important;
  flex: none !important;
}
html[data-dshsvc-mobile] [data-dsh-service-subagent-models-dock] {
  font-size: 11px !important;
  line-height: 16px !important;
  padding: 1px 2px !important;
}
@media (max-width: 375px) {
  html[data-dshsvc-mobile] [class*="bOPqQW_root"],
  html[data-dshsvc-mobile] [class*="bOPqQW_pill"],
  html[data-dshsvc-mobile] [class*="JObwrW_trigger"],
  html[data-dshsvc-mobile] [data-dsh-service-subagent-models-dock] {
    font-size: 10px !important;
  }
}
/* Assistant 回合尾部的运行元信息行（MessageIconActions）使用官方目录属性
   data-chat-flow-kind="turn-tail" 定位，内层兜底走回合尾节点自带的稳定
   data-turn-tail（0.1.2-alpha.2 起 data-time-hover-root 已删除）：
   「带 data-turn-tail 的节点」的最后一个子项 = actions 行，其最后一个 span =
   end-clock 时间文本（bundle 源码核实：clock:"end" 渲染在 children 末位）。
   行容器 min-width:0、时间文本可收缩并省略，以免移动端时间信息把复制/分支
   按钮挤出可视区域。 */
html[data-dshsvc-mobile] [data-chat-flow-kind="turn-tail"] [data-turn-tail] > :last-child {
  min-width: 0 !important;
  max-width: 100% !important;
}
html[data-dshsvc-mobile] [data-chat-flow-kind="turn-tail"] [data-turn-tail] > :last-child > span:last-child {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  padding-inline: 2px !important;
}
/* 回到底部按钮簇（官方 *_toBottom 词干后缀，rc.2 Md3f7G_ → 0.1.2-alpha.2 EvIC1a_，
   自有上箭头 data-dshsvc-user-jump）：
   移动端右侧还有约一行留白（scroll 的 --dsh-composer-side-clearance 侧清理），
   纯位移右移贴边（transform 只动绘制不动布局，sticky 定位不受影响）。
   :not([class*="Slot"]) 排除命名含 Slot 的 sticky 槽层，只移按钮本体。
   方向：正 translateX 向右；位移量 = 侧清理 +16（scroll 右 padding）再留 4px 缓冲。 */
html[data-dshsvc-mobile] [class*="_toBottom"]:not([class*="Slot"]),
html[data-dshsvc-mobile] [data-dshsvc-user-jump] {
  transform: translateX(calc(var(--dsh-composer-side-clearance, 16px) + 16px - 4px)) !important;
}
/* 左上角抽屉钮：悬停/按压用外壳交互底色；会话头部预留按钮位防遮面包屑 */
html[data-dshsvc-mobile] [data-dshsvc-fab]:hover,
html[data-dshsvc-mobile] [data-dshsvc-fab]:active { background: var(--dsw-alias-interactive-bg-hover) !important; }
html[data-dshsvc-mobile] [data-dshsvc-frame] > :nth-child(2) header { padding: 10px 20px 0 46px !important; }
/* 会话顶栏移动端适配：
   titleRow 里 标题crumb / 「N 个子代理」计数芯片 / 预设芯片（创造模式）互相挤压——
   官方 crumbs 自带 overflow:hidden，放不下的尾部被**硬裁**：计数芯片拦腰截断
   （真机 390px 实测裁掉 49px，视觉即「1 个子代…」），标题缩到 ~119px。
   只收紧固定几何 + 改收缩优先级，不重挂 DOM、不藏任何信息：
   ① 头部右内边距 28→20：corner 钮自带 margin-right:-16px 悬出，20 仍留 4px 边距；
   ② 更多操作钮的 utilities 左距 20→4（blank 空头部该层 :empty 隐藏，不受影响）；
   ③ titleCluster 列距 10→6；
   ④ 计数组（分隔符+计数触发钮）列距 10→4，并 flex:none 不可挤压——标题按钮
      自带 overflow:hidden + ellipsis（min-content=0）天生是收缩担当，让省出的
      宽度全部归标题；计数文案与触发钮 aria-label（「N 个子代理」）原样保留。
      :not(:has(switcherTrigger)) 守卫带 lineage 切换器的根（其内部自有
      min-width:0 收缩链，钉死会溢出）；:has 不支持时整条失效，退回官方行为。
   类哈希 wSkVaW_ 取自 dsh-client-ui-conversation ConversationRoot.module.css、
   ZKlsPq_ 取自 dsh-client-ui-subagent SubagentHeaderLineage.module.css
   （均 0.1.6-alpha.2），升级需复核。 */
html[data-dshsvc-mobile] [class*="wSkVaW_headerUtilities"] { margin-left: 4px !important; }
html[data-dshsvc-mobile] [class*="wSkVaW_titleCluster"] { gap: 6px !important; }
html[data-dshsvc-mobile] [class*="ZKlsPq_root"] { gap: 4px !important; }
html[data-dshsvc-mobile] [class*="ZKlsPq_root"]:not(:has([class*="ZKlsPq_switcherTrigger"])) { flex: none !important; }
/* 动作芯片泊位 v2（模式回标题行，子代理+任务下标签行
   右锚成对；官方标签行没有第三方挂载点，泊位=自有 CSS absolute 定位）：
   · 标签行官方 gap 36→20，标签内容尾 ≈126px；
   · 任务芯片（QsffPG_root，运行中带箭头自然宽 ~151.5px）right:106 —— 右侧 90px
     让给子代理芯片（带箭头 81.5~87.5px，「1~99 个」，间隔 8.5~2.5px），右锚成
     「[任务][子代理]」两枚一排（第三方插件将来若也泊到此带，右缘 16px 起排不受影响）；
     max-width calc(100vw − 240px) 封顶（右距 106 + 标签尾 126 + 8 缓冲），
     ≤360 档计数文字按省略优雅降级（320 档省 ~71px）、绝不压到对话/轨迹；
   · 子代理芯片（ZKlsPq_root）right:16 最贴右；泊离标题后分隔符「/」失去对象，隐藏；
   · 计数文字 nowrap+ellipsis 可省；下拉箭头保留，320~360 档文字省略加深，
     但开合指示不丢；
   · 两枚芯片的下拉菜单（锚在各自 root 上 top:100%+5、left:0）改右锚展开并按
     视口封顶（max-width 100vw−122 = 任务右距 106 + 16 边距），否则贴右泊位时
     336px 菜单会越出屏幕（390 档实测左越 46px）；
   · 预设芯片（SVAs4q_label）不再泊动——随官方 headerActions 留在标题行
     （「模式=会话身份」与标题同级），第三方动作芯片同样留官方原位不受泊位管辖；
     子代理计数离开 crumbs 后标题吃满整行（390 档 198px）；
   · ≤560 门：561~1023 行宽足够（标题 ≥115px），保持官方在流。blank 空头部
     :not 守卫不泊。类哈希 QsffPG_ 取自 dsh-client-ui-jobs JobListAction.module.css
     （0.1.6-alpha.2），升级需复核。 */
@media (max-width: 560px) {
  html[data-dshsvc-mobile] [data-dshsvc-frame] > :nth-child(2) header:not([class*="wSkVaW_headerBlank"]) { position: relative !important; }
  html[data-dshsvc-mobile] [class*="wSkVaW_tabs"] { gap: 20px !important; }
  html[data-dshsvc-mobile] [class*="QsffPG_root"],
  html[data-dshsvc-mobile] [class*="ZKlsPq_root"]:not(:has([class*="ZKlsPq_switcherTrigger"])) {
    position: absolute !important;
    bottom: 4px !important;
    z-index: 2;
  }
  html[data-dshsvc-mobile] [class*="QsffPG_root"] {
    right: 106px !important;
    max-width: calc(100vw - 240px) !important;
  }
  html[data-dshsvc-mobile] [class*="ZKlsPq_root"]:not(:has([class*="ZKlsPq_switcherTrigger"])) {
    right: 16px !important;
  }
  /* 分隔符/箭头/收缩只作用于已泊出的子代理根；带 lineage 切换器而留在
     crumbs 里的根（:has 守卫排除的那支）保持官方形态不受影响。 */
  html[data-dshsvc-mobile] [class*="ZKlsPq_root"]:not(:has([class*="ZKlsPq_switcherTrigger"])) [class*="ZKlsPq_separator"] { display: none !important; }
  html[data-dshsvc-mobile] [class*="QsffPG_trigger"],
  html[data-dshsvc-mobile] [class*="ZKlsPq_root"]:not(:has([class*="ZKlsPq_switcherTrigger"])) [class*="ZKlsPq_trigger"] { min-width: 0 !important; max-width: 100% !important; }
  html[data-dshsvc-mobile] [class*="QsffPG_trigger"] > svg:last-child,
  html[data-dshsvc-mobile] [class*="ZKlsPq_root"]:not(:has([class*="ZKlsPq_switcherTrigger"])) [class*="ZKlsPq_trigger"] > svg:last-child { flex: none !important; }
  html[data-dshsvc-mobile] [class*="QsffPG_count"] {
    min-width: 0 !important;
    flex: 0 1 auto !important;
    margin: 0 2px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  html[data-dshsvc-mobile] [class*="QsffPG_menu"],
  html[data-dshsvc-mobile] [class*="ZKlsPq_menu"] {
    left: auto !important;
    right: 0 !important;
    max-width: calc(100vw - 122px) !important;
  }
  /* 预设芯片右靠：margin-left:auto 把 crumbs 与
     动作组之间的全部富余收到中间——标题贴左、模式芯片贴住更多钮（间距 4px），
     标题长短变化时芯片位置稳定不飘。 */
  html[data-dshsvc-mobile] header:not([class*="wSkVaW_headerBlank"]) [class*="wSkVaW_headerActions"] { margin-left: auto !important; }
}
/* Agent Team 弹窗右锚：修复移动端面板右侧超出视口。
   面板 = 官方 @deepseek-ai/dsh-experimental-client-ui-agent-team 的 TeamAction，
   注册在 conversation.session.header.actions（与任务/子代理芯片同槽）。它自己的
   CSS 是 position:absolute; left:0; top:calc(100% + 5px);
   width:min(560px,100vw - 32px)——**左锚在触发钮左缘**，而该槽位在移动端位于
   头部右侧（右锚泊位之外），面板便整体右移越屏：真机实测 320~560px 越出
   112~352px、768/1023 越出 198/140px（面板右缘 = 触发钮左缘 + 面板宽）。

   修法（三条规则，均基于稳定属性而非类哈希）：
   ① 面板的包含块要落在**头部**而不是触发钮：会话头部在 ≥561px 官方为 static，
      而 .root{position:relative} 会让面板锚在触发钮上 → 引擎已打的
      data-dshsvc-chat-header 上补 position:relative（≤560 档泊位组已设过，
      这里把覆盖面扩到整个移动端，幂等），再把 TeamAction 根改 static 把
      包含块让给头部；
   ② 面板本身改右锚：left:auto + right:16px，与它自带的
      100vw − 32px 宽度公式（两侧各 16px）对称，并补 max-width 封顶以防
      官方改宽。桌面 ≥1024 引擎拆卸、标记与属性同时下线 → 官方几何逐字不变。

   选右锚而非 fixed：沉浸态头部带 transform（translateY(-100%)），被变换的
   祖先会成为 fixed 后代的包含块——本文件顶部记载的 containing-block 陷阱；
   真机实测 fixed 变体在沉浸态随头部一起位移（top 84→-68），与 absolute 无异，
   却另外硬编码了一份纵向几何。右锚复用头部包含块，两者行为一致且不写死 top。 */
html[data-dshsvc-mobile] [data-dshsvc-chat-header] { position: relative !important; }
html[data-dshsvc-mobile] [data-team-action] { position: static !important; }
html[data-dshsvc-mobile] [data-team-action] [role="dialog"] {
  left: auto !important;
  right: 16px !important;
  max-width: calc(100vw - 32px) !important;
}
/* 刘海安全区：viewport-fit=cover 后由 env() 补回遮挡区 */
html[data-dshsvc-mobile] body {
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
}
/* 双击缩放与 iOS 聚焦放大 */
html[data-dshsvc-mobile] button,
html[data-dshsvc-mobile] a,
html[data-dshsvc-mobile] [role="button"],
html[data-dshsvc-mobile] input,
html[data-dshsvc-mobile] textarea,
html[data-dshsvc-mobile] select { touch-action: manipulation; }
html[data-dshsvc-mobile] input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]),
html[data-dshsvc-mobile] textarea { font-size: max(16px, 1em) !important; }
/* composer 防挤压：真机反馈后迭代。0.1.5-rc.2 起外壳已无含 "toolbar"/"inputTriggers"
   的类名（活页面命中 0，2026-09-15 死规则审计），两条泛化规则删除；只留仍命中的
   "composer"（composerSeat 等）——min-width:0 + max-width:100% 防子项撑破容器。 */
html[data-dshsvc-mobile] [class*="composer" i] { min-width: 0 !important; max-width: 100% !important; }
/* —— 滑动沉浸（v0.36；2026-09-15 几何返工）——
   原先用 transform: translateY(115%) 把 composer 座滑出视口：**变换后的视觉溢出会被
   计入滚动容器的可滚动区域**（实测 +147px），于是「沉浸态滑到底」时内容被抬高、底部露出
   291px 空带（用户反馈「对话框和输出空一大段」）；回显时这 147px 又消失，滚动位置随之
   错位、最后一段被输入框压住（用户反馈「输出跑到对话框下面去了」）。
   现改为沉浸时把该座**移出文档流**（让出 128px 占位、内容真正铺满整屏）+ 淡出：既不加
   可滚动溢出，也不改 --dsh-composer-height（ResizeObserver 仍读到座高，外壳的浮钮偏移
   与贴底锚定不受影响）。回显侧因占位收回会改变可滚动长度，由 setImmersive 做「贴底补偿」。 */
html[data-dshsvc-mobile] [data-composer-seat] {
  transition: opacity var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease) !important;
}
html[data-dshsvc-mobile][data-dshsvc-immersive] [data-composer-seat] {
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
/* 会话头部（面包屑+视图标签）在滚动体外面，藏在根列里：translateY(-100%) 上滑出
   data-phase=active 根的 overflow:hidden 裁剪区，负 margin-top 用引擎测得的高度
   （--dshsvc-header-h，ResizeObserver 实时校正；老内核无 RO 时回退常量）补位，
   否则留一条空带。 */
html[data-dshsvc-mobile] [data-dshsvc-chat-header] {
  transition: transform var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease),
    margin-top var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease);
}
html[data-dshsvc-mobile][data-dshsvc-immersive] [data-dshsvc-chat-header] {
  transform: translateY(-100%) !important;
  margin-top: calc(0px - var(--dshsvc-header-h, 76px)) !important;
}
@media (prefers-reduced-motion: reduce) {
  html[data-dshsvc-mobile][data-dshsvc-immersive] [data-composer-seat],
  html[data-dshsvc-mobile][data-dshsvc-immersive] [data-dshsvc-chat-header],
  html[data-dshsvc-mobile] [data-dshsvc-chat-header] { transition: none !important; }
}
`

      function createMobileAdaptation({ ctx, t, featureEnabled, createConversationNav }) {
        const state = {
          active: false,
          mq: null,
          mqHandler: null,
          frameObserver: null,
          mountObserver: null,
          workspaceObserver: null,
          errorHandler: null,
          resizeHandler: null,
          styleTag: null,
          backdrop: null,
          fab: null,
          debugChip: null,
          debugEnabled: false,
          errorCount: 0,
          drawerOpen: false,
          detailsOpen: false,
          // 0.1.5 官方右栏（rightbarCol）开合态：右缘手势/FAB 让位/debug 芯片用；
          // 与旧宿主的 detailsOpen 互斥——按 layout 服务能力判定形态（见 readOverlayState）。
          rightbarOpen: false,
          workspaceOpen: false,
          edgeGesture: null,
          // 边缘手势遥测：仅 debug 模式记录最近一次触摸的事件流（起触点、armed
          // 或拒绝原因、move 数、末次/取消时相对位移、是否补完成功），真机定位用
          edgeTelemetry: null,
          lastFabDisplay: null,
          lastBackdropDisplay: null,
          // —— 滑动沉浸（v0.36）状态 ——
          immersive: false,
          repinTimer: null,
          repinAnchor: null,
          repinToBottom: false,
          chatAvailable: false,
          chatScrollLastY: null,
          gestureAt: 0,
          immersiveAcc: 0,
          immersiveLockDir: null,
          zoneArmed: null,
          arrivalDone: false,
          // 最近一次回显的来路（gesture 手势 / arrival 到底 / focus 聚焦 / button
          // 点官方回底按钮）：debug 芯片真机定位「为什么没回显」用。
          lastRevealReason: null,
          headerEl: null,
          headerRO: null,
        }

        // 会话导航适配层：官方外壳 DOM 结构（含类哈希）只在该层里出现，
        // 沉浸引擎借它识别「官方回到底部按钮」这一个语义节点。
        const nav = createConversationNav()

        const layoutService = () => {
          try { return typeof ctx.get === 'function' ? ctx.get('layout') : undefined } catch (_) { return undefined }
        }

        const syncSurfaces = () => {
          // 详情列移动端永久离屏（CSS），backdrop 只服务侧栏抽屉；
          // 若外部把详情打开（openDetails），这里自愈式收掉，避免空态盖屏。
          if (state.detailsOpen) {
            const layout = layoutService()
            if (layout !== undefined) {
              try { layout.closeDetails() } catch (_) {}
            }
            state.detailsOpen = false
          }
          // 抽屉开启时收起 FAB：关闭走外壳原生侧栏钮或外侧遮罩，绝不在
          // 抽屉面板上叠画第二套关闭件（真机反馈：
          // 那只会变成糊在侧栏 logo 上的不明物）。工作区侧板、官方右栏
          // 全屏抽屉同理互斥。
          // 变化才写：innerHTML/display 若无条件重写会喂活 body 级观察器死循环。
          const nextDisplay = (state.drawerOpen || state.workspaceOpen || state.rightbarOpen) ? 'none' : 'flex'
          if (state.fab !== null && state.lastFabDisplay !== nextDisplay) {
            state.lastFabDisplay = nextDisplay
            state.fab.style.display = nextDisplay
          }
          const backdropNext = state.drawerOpen ? 'block' : 'none'
          if (state.backdrop !== null && state.lastBackdropDisplay !== backdropNext) {
            state.lastBackdropDisplay = backdropNext
            state.backdrop.style.display = backdropNext
          }
          if (state.debugEnabled && state.debugChip !== null) updateDebugChip()
        }

        /** body 级监听的节流入口：同帧多次变更合并为一次读改（脏标记 + 单发调度），
            回调内严格「无变化不写 DOM」，杜绝 观察器→写DOM→再触发 的自激循环。 */
        let syncScheduled = false
        const scheduleSync = () => {
          if (syncScheduled || !state.active) return
          syncScheduled = true
          // 定时器可能活过宿主环境/测试清理期——回调整体兜底，绝不外抛
          setTimeout(() => {
            syncScheduled = false
            if (!state.active) return
            try {
              readOverlayState()
              syncSurfaces()
            } catch (_) {}
          }, 50)
          // 追踪采样：外壳的显隐走过渡动画，50ms 那次读到的可能是动画前旧值；
          // 动画落定后再校准两次，否则 UI 僵在旧状态、要再碰一下屏幕才刷新。
          for (const delay of [400, 900]) {
            setTimeout(() => {
              if (!state.active) return
              try { readOverlayState(); syncSurfaces() } catch (_) {}
            }, delay)
          }
        }

        const readOverlayState = () => {
          const frame = document.querySelector('[data-dshsvc-frame]')
          state.drawerOpen = frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
          // 右列形态按官方右栏两态判断（开合口径与手势 fire 保持 100% 统一）：
          state.rightbarOpen = officialRightbarOpenedNow()
          const layout = layoutService()
          const rightbarMode = (layout !== undefined && typeof layout.openRightbar === 'function') || state.rightbarOpen
          state.detailsOpen = rightbarMode ? false : (frame !== null && !frame.hasAttribute('data-details-collapsed'))
          // 工作区侧板（外壳 tab 系统 nArs4W_panel）：可见 = 任一匹配节点解除
          // PanelHidden 且进入视口。注意 panelBody 等 同哈希同名 子串节点会混入
          // querySelector 匹配，必须逐个甄别取「或」，否则状态时对时错。
          state.workspaceOpen = false
          try {
            for (const el of document.querySelectorAll('[class*="nArs4W_panel"]')) {
              const cls = typeof el.className === 'string' ? el.className : ''
              if (/nArs4W_panelHidden/.test(cls)) continue
              const rect = el.getBoundingClientRect()
              if (rect.width > 0 && rect.left < window.innerWidth - 2 && getComputedStyle(el).visibility !== 'hidden') {
                state.workspaceOpen = true
                break
              }
            }
          } catch (_) { state.workspaceOpen = false }
          refreshImmersiveAvailability()
        }

        // ===== 滑动沉浸（v0.36）：方向手势藏「头部+composer」，三路回显 =====
        // 范围=整套、回显=上滑方向+常驻底部小把手、开关并入 mobileAdaptation（用户三问选型）。
        // 手势可信度是命门：流式贴底 scrollTo / 跳转 scrollIntoView 等程序化滚动必须无视——
        // 判据=800ms 手势窗口（touchstart/move/wheel 刷新时间戳），窗口外的 scroll 只更新基线、
        // 绝不翻转状态（贴底强制回显同样只认手势窗口内）。

        const cssVarSupported = (styleEl) => typeof styleEl.setProperty === 'function'

        const setHeaderHeightVar = (px) => {
          const styleEl = document.documentElement.style
          if (cssVarSupported(styleEl)) styleEl.setProperty('--dshsvc-header-h', `${Math.max(0, Math.round(px))}px`)
        }

        /** 会话骨架三要素定位：全部官方属性钩子 + parentNode 走树，无类哈希。
         *  0.1.2-alpha.2：官方把 scrollBody 包进新的 body 包裹层（.wSkVaW_body），
         *  data-phase 落在根上（scroller 的祖父）；旧版则直接在父节点上。上溯
         *  最多两层找 data-phase，命中即采纳该节点作 rootEl —— 两代形状通吃。 */
        const chatContext = () => {
          let scroller = null
          try { scroller = document.querySelector('[data-conversation-scroll]') } catch (_) { return null }
          if (scroller === null || scroller.isConnected === false) return null
          let rootEl = scroller.parentNode
          if (rootEl === null || rootEl === document.documentElement) return null
          let phase = null
          try { phase = rootEl.getAttribute('data-phase') } catch (_) {}
          let cursor = rootEl
          for (let depth = 0; phase === null && depth < 2; depth += 1) {
            cursor = cursor === null || cursor === undefined ? null : cursor.parentNode
            if (cursor === null || cursor === document.documentElement) break
            try { phase = cursor.getAttribute('data-phase') } catch (_) { break }
            if (phase !== null) rootEl = cursor
          }
          return { scroller, rootEl, phase }
        }

        /** 在某节点的子树里找第一个 HEADER 节点（限深，不依赖 querySelector，假桩环境全兼容）。 */
        const findHeaderNodeIn = (node, depthLeft) => {
          if (depthLeft <= 0 || node === null || typeof node.children === 'undefined' || node.children === null) return null
          for (const c of node.children || []) {
            const t = typeof c.tagName === 'string' ? c.tagName.toUpperCase() : ''
            if (t === 'HEADER') return c
            const deeper = findHeaderNodeIn(c, depthLeft - 1)
            if (deeper !== null) return deeper
          }
          return null
        }

        /**
         * 给会话头部打自有标记属性。
         * v0.36.1 真机取证两连修正（puppeteer29/30）：
         * ① rc.2 的 header 不是 root 直接子元素——官方把槽位内容包在一层
         *    <div data-slot="conversation.session.header"> 里，直接子扫描永远扑空；
         * ② 该包裹层是 display:contents（不产生盒子、getBoundingClientRect 恒 0），
         *    真正的布局占位者是内层 header 本人——transform/负 margin 必须落在它
         *    身上才有效果。因此双层穿透最终定位到【HEADER 节点】打标，RO 同步测其
         *    高度；找到后停止向上传递，兼容未来官方去掉包裹层的直渲染形态。
         */
        const tagChatHeader = (ctx) => {
          const rootEl = ctx !== null ? ctx.rootEl : null
          if (rootEl === null || typeof rootEl.children === 'undefined') return state.headerEl
          if (state.headerEl !== null && state.headerEl.isConnected) {
            try { state.headerEl.setAttribute('data-dshsvc-chat-header', '') } catch (_) {}
            return state.headerEl
          }
          let target = null
          for (const child of rootEl.children || []) {
            const tagName = typeof child.tagName === 'string' ? child.tagName.toUpperCase() : ''
            if (tagName === 'HEADER') { target = child; break }
          }
          if (target === null) {
            for (const child of rootEl.children || []) {
              const found = findHeaderNodeIn(child, 3)
              if (found !== null) { target = found; break }
            }
          }
          if (target !== null) {
            target.setAttribute('data-dshsvc-chat-header', '')
            state.headerEl = target
            measureChatHeader(target)
            return target
          }
          return null
        }

        /** 头部高度测量 → --dshsvc-header-h。无 ResizeObserver 的环境保持 CSS 常量兜底。 */
        const measureChatHeader = (headerEl) => {
          if (typeof ResizeObserver !== 'function') return
          if (state.headerRO !== null && state.headerRO.__el === headerEl) return
          if (state.headerRO !== null) { try { state.headerRO.disconnect() } catch (_) {} }
          try {
            const observer = new ResizeObserver(() => {
              try {
                const height = headerEl.offsetHeight
                if (typeof height === 'number' && height > 0) setHeaderHeightVar(height)
              } catch (_) {}
            })
            observer.__el = headerEl
            observer.observe(headerEl)
            state.headerRO = observer
            const initial = headerEl.offsetHeight
            if (typeof initial === 'number' && initial > 0) setHeaderHeightVar(initial)
          } catch (_) {
            state.headerRO = null
          }
        }

        const nodeContains = (ancestor, node) => {
          let cursor = node
          while (cursor !== null && cursor !== undefined) {
            if (cursor === ancestor) return true
            cursor = cursor.parentNode
          }
          return false
        }

        /** 会话滚动体是否停在内容末尾（按当前几何判定；沉浸态下末尾不含 composer 占位）。 */
        const scrollerAtContentEnd = () => {
          const ctx = chatContext()
          if (ctx === null || ctx.scroller === null) return false
          try {
            const scrollTop = Number(ctx.scroller.scrollTop)
            const scrollHeight = Number(ctx.scroller.scrollHeight)
            const clientHeight = Number(ctx.scroller.clientHeight)
            if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return false
            return scrollHeight - clientHeight - scrollTop <= IMMERSIVE_BOTTOM_PX
          } catch (_) { return false }
        }

        /** 回显贴底补偿：沉浸态让出的 composer 占位随属性移除收回，可滚动长度因此变长 ——
            回显前若停在内容末尾，不补偿就会把最后一段推到输入框下面（真机反馈「输出跑到对话框
            下面去了」）。两条纪律：① 等手势停稳（260ms 无新滚动）再对齐，绝不和进行中的手指
            抢位置；② 对齐前复查「此刻仍在末尾」——占位刚收回，末尾在几何上表现为距底约一个
            座高 + 原空档，超过这个量说明用户已经往回读了，此时对齐会把人硬拽到底，必须放弃。 */
        const IMMERSIVE_REPIN_SETTLE_MS = 260

        const revealRepinIfStillAtEnd = () => {
          state.repinTimer = null
          // 判据用「回显当下的滚动位置」而不是几何差值：占位收回会让距底从 ~0 变 ~一个座高，
          // 拿阈值去猜容易差几像素失灵。用户是否往回读，直接看 scrollTop 有没有变小最可靠。
          const anchor = state.repinAnchor
          const snapToBottom = state.repinToBottom
          state.repinAnchor = null
          state.repinToBottom = false
          const ctx = chatContext()
          if (ctx === null || ctx.scroller === null) return
          try {
            const scrollTop = Number(ctx.scroller.scrollTop)
            const scrollHeight = Number(ctx.scroller.scrollHeight)
            const clientHeight = Number(ctx.scroller.clientHeight)
            if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return
            // 取「最大滚动位置」而不是 scrollHeight：真实浏览器会自行 clamp，假桩环境需同一语义。
            const floor = Math.max(0, scrollHeight - clientHeight)
            if (snapToBottom) {
              // 「点回底」模式：跳转目标按点击当下的滚动高度算，而回显刚把坐位收回文档流，
              // 真实末尾还会更远 —— 只要求停稳时仍在末尾一带，已往回读（超过底部区）就放弃。
              if (floor - scrollTop > IMMERSIVE_BOTTOM_PX) return
              ctx.scroller.scrollTop = floor
              return
            }
            if (anchor === null) return
            if (scrollTop < anchor - 4) return   // 回显后用户已往回读 → 放弃，绝不把人拽到底
            ctx.scroller.scrollTop = floor
          } catch (_) {}
        }

        const scheduleImmersiveRepin = (anchor, snapToBottom = false) => {
          cancelImmersiveRepin()
          state.repinAnchor = anchor
          state.repinToBottom = snapToBottom
          try {
            state.repinTimer = setTimeout(revealRepinIfStillAtEnd, IMMERSIVE_REPIN_SETTLE_MS)
          } catch (_) { revealRepinIfStillAtEnd() }
        }

        const cancelImmersiveRepin = () => {
          state.repinAnchor = null
          state.repinToBottom = false
          if (state.repinTimer === null) return
          try { clearTimeout(state.repinTimer) } catch (_) {}
          state.repinTimer = null
        }

        const setImmersive = (hidden, reason = null) => {
          if (!state.active || !state.chatAvailable) hidden = false
          if (state.immersive === hidden) return
          // 回显前先按**沉浸几何**判定是否停在内容末尾（属性一去掉几何就变了）。
          const repinAnchor = !hidden && scrollerAtContentEnd() ? Number((chatContext() || {}).scroller?.scrollTop) : null
          const repin = repinAnchor !== null && Number.isFinite(repinAnchor)
          state.immersive = hidden
          if (!hidden && reason !== null) state.lastRevealReason = reason
          const htmlEl = document.documentElement
          try {
            if (hidden) htmlEl.setAttribute('data-dshsvc-immersive', '')
            else htmlEl.removeAttribute('data-dshsvc-immersive')
          } catch (_) {}
          if (hidden) cancelImmersiveRepin()
          else if (repin) scheduleImmersiveRepin(repinAnchor)
          if (state.debugEnabled) updateDebugChip()
        }

        /** 清掉沉浸态与手势基线（阶段切换/不可滚/卸载共用）。 */
        const resetImmersive = () => {
          state.chatScrollLastY = null
          state.immersiveAcc = 0
          state.immersiveLockDir = null
          state.zoneArmed = null
          state.arrivalDone = false
          setImmersive(false)
        }

        /** 会话可用性门控：无会话/hero/settling/内容不可滚时整体禁用并复位。 */
        const refreshImmersiveAvailability = () => {
          const ctx = chatContext()
          let available = false
          if (ctx !== null && ctx.phase === 'active') {
            tagChatHeader(ctx)
            const seat = (() => { try { return document.querySelector('[data-composer-seat]') } catch (_) { return null } })()
            if (seat !== null && nodeContains(ctx.scroller, seat)) {
              let scrollTop = NaN; let scrollHeight = NaN; let clientHeight = NaN
              try {
                scrollTop = Number(ctx.scroller.scrollTop)
                scrollHeight = Number(ctx.scroller.scrollHeight)
                clientHeight = Number(ctx.scroller.clientHeight)
              } catch (_) {}
              available = Number.isFinite(scrollTop) && Number.isFinite(scrollHeight) && Number.isFinite(clientHeight) &&
                scrollHeight - clientHeight > IMMERSIVE_MIN_SCROLLABLE_PX
            }
          }
          state.chatAvailable = available
          if (!available) resetImmersive()
        }

        const gestureFresh = () => {
          const now = Date.now()
          return state.gestureAt > 0 && now - state.gestureAt <= GESTURE_WINDOW_MS
        }

        /** scroll 捕获监听的主判定（v0.36.1 真机返工）。
            首版拿「单次 scroll 事件的位移」比阈值：测试桩一步跳 70px 必中，真机拖拽
            每帧只产生几像素的高频增量，单个事件永远摸不到 64px —— 表现即「下滑几乎
            不触发」。现改为**方向累加器**：手势窗口内的位移连续求和（反向滚动自然
            抵消），越过阈值立即翻转并清零；窗口外/大跳变只重基线与累加器，绝不翻转
            （流式贴底 scrollTo、scrollIntoView 跳转全部免疫）。
            聚焦硬阻断同步移除（首版只要焦点在输入框里就压住一切方向判定——打完字
            去读历史是常态操作，表现为整个功能失灵）：获焦仅保留「立即回显」一次，
            之后滑动照常生效。 */
        const evaluateImmersiveScroll = (scroller) => {
          if (!state.active || !state.chatAvailable) return
          let scrollTop = NaN; let scrollHeight = NaN; let clientHeight = NaN
          try {
            scrollTop = Number(scroller.scrollTop)
            scrollHeight = Number(scroller.scrollHeight)
            clientHeight = Number(scroller.clientHeight)
          } catch (_) { return }
          if (!Number.isFinite(scrollTop) || !Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight)) return
          const lastY = state.chatScrollLastY === null ? scrollTop : state.chatScrollLastY
          const delta = scrollTop - lastY
          state.chatScrollLastY = scrollTop
          // 免疫层：程序化滚动（无手势窗口）或单事件大跳变 → 只重基线与累加器。
          // 窗口一过再到达的事件一律视为外壳自驱（贴底锚定），顺手把残留累加清零，
          // 保证下一次真实触摸从干净状态起算。
          if (!gestureFresh() || Math.abs(delta) > IMMERSIVE_DELTA_CAP_PX) {
            state.immersiveAcc = 0
            return
          }
          // 已在内容末尾的沉浸态：往回一点点就该回显。末尾之后没有更多「前进」内容，
          // 任何向后位移只可能是要回看或要操作；再用 24px 迟滞带会让人「点回底后
          // 上滑一下再下滑、还要试几次」（2026-09-15 真机反馈）。
          // 判据用**本事件之前**的位置（lastY）：往回的第一个像素就已经让当前 scrollTop
          // 离开末尾（实测 8px），拿当前值判永远不成立。只有严格停在滚动末端才放宽，
          // 阅读中途的迟滞带原样保留。
          if (state.immersive && delta < 0 && lastY + clientHeight >= scrollHeight - 1) {
            state.immersiveAcc = 0
            state.immersiveLockDir = -1
            setImmersive(false, 'gesture')
            return
          }
          // 到底回显：仅认「本手势起点在底部区之外、正向下滑跨入边界」的到达；
          // 程序化贴底进不了手势层。起点就在区内的新手势不得触发（否则区内每次
          // 下拉都会被抢着掀开，沉浸根本无法维持）；向上经过底部区也不得进入本分支
          // （与累加器的向上回显打架：前一事件刚显示、下一事件又被藏回）。
          const inBottomZone = scrollTop + clientHeight >= scrollHeight - IMMERSIVE_BOTTOM_PX
          if (state.zoneArmed === null) state.zoneArmed = inBottomZone
          if (
            state.zoneArmed === false && inBottomZone && !state.arrivalDone &&
            state.immersive && delta > 0
          ) {
            state.arrivalDone = true
            state.immersiveAcc = 0
            state.immersiveLockDir = 1
            setImmersive(false, 'arrival')
            return
          }
          // 同方向手势段内只翻转一次（方向锁）：到底回显后继续滑入底部的剩余动量
          // 不允许把刚回显的界面再次藏起（真机三连教训）。反向滚动或下一次触摸解锁。
          const dirSign = Math.sign(delta)
          if (dirSign !== 0 && state.immersiveLockDir !== null) {
            if (dirSign === -state.immersiveLockDir) state.immersiveLockDir = null
            else { state.immersiveAcc = 0; return }
          }
          // 方向段语义：手势一反转就清零重来——隐藏触发后的下滑残量不允许
          // 吃掉下一次上滑的前几像素，否则回显也会「感觉失灵」（真机二连教训）。
          if (state.immersiveAcc > 0 && delta < 0) state.immersiveAcc = 0
          else if (state.immersiveAcc < 0 && delta > 0) state.immersiveAcc = 0
          state.immersiveAcc += delta
          if (state.immersiveAcc > IMMERSIVE_ACC_CLAMP_PX) state.immersiveAcc = IMMERSIVE_ACC_CLAMP_PX
          else if (state.immersiveAcc < -IMMERSIVE_ACC_CLAMP_PX) state.immersiveAcc = -IMMERSIVE_ACC_CLAMP_PX
          if (state.immersiveAcc >= IMMERSIVE_HIDE_PX) {
            state.immersiveAcc = 0
            state.immersiveLockDir = 1
            setImmersive(true)
          } else if (state.immersiveAcc <= -IMMERSIVE_SHOW_PX) {
            state.immersiveAcc = 0
            state.immersiveLockDir = -1
            setImmersive(false, 'gesture')
          }
        }

        /** 捕获式 scroll 监听挂在根元素上：scroll 事件不冒泡但捕获可达，
            会话切换/视图重建换节点也无需重绑。 */
        const onDocumentScroll = (event) => {
          if (!state.active) return
          let el = event && event.target
          for (let depth = 0; el !== null && el !== undefined && depth < 6; depth += 1) {
            if (typeof el.hasAttribute === 'function') {
              try { if (el.hasAttribute('data-conversation-scroll')) { evaluateImmersiveScroll(el); return } } catch (_) {}
            }
            el = el.parentNode
          }
        }

        const markGesture = () => {
          state.gestureAt = Date.now()
          state.immersiveLockDir = null // 新触摸开始：同方向段锁作废
          state.zoneArmed = null        // 底部区基线待首个事件采样
          state.arrivalDone = false
        }

        const onFocusIn = (event) => {
          if (!state.active) return
          let seat = null
          try { seat = document.querySelector('[data-composer-seat]') } catch (_) { return }
          if (seat === null) return
          // v0.36.1：聚焦只负责「立即回显」；此后滑动照常生效（首版的
          // 聚焦硬阻断把「打完字读历史」这一常态场景整个压死，已撤）。
          if (nodeContains(seat, event?.target)) {
            state.immersiveAcc = 0
            if (state.immersive) setImmersive(false, 'focus')
          }
        }

        /** 点官方「回到底部」按钮 → 立即回显（2026-09-15 真机反馈：点回底后
            composer 不回来，要手动上滑一点再下滑、还得试几次）。
            官方 toBottom 只是一次 `el.scrollTop = el.scrollHeight` 的瞬时赋值：在引擎
            的免疫层里和流式贴底同形（无手势窗口/超 200px 跳变一律不翻转），所以「用户
            到底了」这个事实引擎看不见——只有事件目标能表达它，故按点击目标识别，不猜位移。
            点完跳转还会在点按自身开出的 800ms 手势窗口里留下同向前进位移（跳 64~200px
            时足以把刚回显的界面立刻再藏回去），因此顺手落一个方向锁吞掉它；
            反方向位移照常解锁，后续滑动不受影响。 */
        const onChatClick = (event) => {
          if (!state.active || !state.chatAvailable || !state.immersive) return
          if (!nav.isToBottomButton(event && event.target)) return
          state.immersiveAcc = 0
          state.immersiveLockDir = 1
          setImmersive(false, 'button')
          // 官方这一跳按「点按当下」的滚动高度算目标，而回显刚把坐位收回文档流、真实末尾
          // 还会更远；不补一次对齐就只能等外壳自己跟随（实测 0.5s 起步，且不一定发生，
          // 停在距底 ~76px 处 = 最后一段压在输入框下）。停稳时仍在末尾一带才对，往回读放弃。
          scheduleImmersiveRepin(null, true)
        }

        // ===== 边缘手势开合抽屉（2026-09 用户点名）=====
        // 边缘手势开合抽屉：右滑开官方左抽屉 / 开着时反向滑关；左滑开官方右栏
        // 抽屉（无右栏则手势无效）/ 开着时反向滑关。识别器与沉浸引擎共用
        // documentElement 捕获式监听；所有判定只消费触摸坐标，绝不可 preventDefault
        //（passive），翻转动作在阈值达成后走既有服务/DOM 缝。
        // 状态读取铁律：arm（touchstart）与 fire（touchmove 达阈值）都实时重读
        // DOM 缝，绝不消费观察器缓存的 state.rightbarOpen（50ms 调度窗口会陈旧）。

        /** 兼容桩环境的首触点提取：真浏览器读 touches[0]，桩直接给同形对象。 */
        const edgeTouchPoint = (event) => {
          try {
            const list = event !== null && event !== undefined && event.touches !== undefined && event.touches !== null && event.touches.length > 0
              ? event.touches
              : (event !== null && event !== undefined ? event.changedTouches : null)
            if (list === undefined || list === null || list.length === 0) return null
            const x = Number(list[0].clientX)
            const y = Number(list[0].clientY)
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null
            return { x, y }
          } catch (_) { return null }
        }

        /** 左抽屉实时开合态：true=折叠（含 frame 缺席的骨架未就绪期）。 */
        const leftDrawerCollapsedNow = () => {
          try {
            const frame = document.querySelector('[data-dshsvc-frame]')
            return frame === null || frame.hasAttribute('data-sidebar-collapsed')
          } catch (_) { return true }
        }

        const sidebarRightService = () => {
          try { return typeof ctx.get === 'function' ? ctx.get('sidebarRight') : undefined } catch (_) { return undefined }
        }

        /** 官方右栏存在性与展开态分别判断。面板和内部 toggle 在收起时仍挂载，
            不能拿 toggle 的存在性判断展开；展开按钮只在折叠时出现。
            无挂载面板及活跃服务时手势无效。 */
        const officialRightbarAvailableNow = () => {
          try {
            if (document.querySelector('[data-sidebar-right-expand], [data-sidebar-right-toggle], [data-sidebar-right-panel]') !== null) {
              return true
            }
          } catch (_) {}
          const sr = sidebarRightService()
          return sr !== undefined && typeof sr.toggleExpanded === 'function' && sr.active() !== undefined
        }

        const officialRightbarOpenedNow = () => {
          if (!officialRightbarAvailableNow()) return false
          // 1. 服务层权威判断（读当前会话的 layout.expanded）
          const sr = sidebarRightService()
          if (sr !== undefined && typeof sr.isExpanded === 'function') {
            try {
              const exp = sr.isExpanded()
              if (typeof exp === 'boolean') return exp
            } catch (_) {}
          }
          // 2. DOM 展开标记：面板展开时带有 [data-sidebar-right-open] 属性
          try {
            if (document.querySelector('[data-sidebar-right-open]') !== null) return true
          } catch (_) {}
          // 3. 常驻展开钮存在时必为折叠态（避免将常驻 DOM 内的折叠收起按钮误读为展开态）
          try {
            if (document.querySelector('[data-sidebar-right-expand]') !== null) return false
          } catch (_) {}
          // 4. 外壳 frame 兜底（桌面/平板非全屏 track 模式）：cols.rightbar > 0 时无 data-rightbar-collapsed
          try {
            const frame = document.querySelector('[data-dshsvc-frame]')
            if (frame !== null && !frame.hasAttribute('data-rightbar-collapsed')) return true
          } catch (_) {}
          return false
        }

        /**
         * 驱动官方右栏开合：
         * 1. 优先直接点击官方对应的按钮（与用户手点展开 ExpandButton / 收起 toggle 同链路，
         *    成功立即返回，绝不穿透调用服务层导致同一手势下重复翻转/开了又关）；
         * 2. 其次通过官方 sidebarRight 服务切换会话右栏状态（方向复核，防误反转）；
         * 3. 极简布局外壳降级（测试桩未挂载组件但提供了 layout 服务时）。
         */
        const toggleOfficialRightbar = (wantOpen) => {
          // 1. 优先直接触发官方对应的开合按钮
          try {
            const btn = wantOpen
              ? document.querySelector('[data-sidebar-right-expand]')
              : (document.querySelector('[data-sidebar-right-open] [data-sidebar-right-toggle]') || (officialRightbarOpenedNow() ? document.querySelector('[data-sidebar-right-toggle]') : null))
            if (btn !== null && typeof btn.click === 'function') {
              btn.click()
              return true
            }
          } catch (_) {}

          // 2. 服务层：通过官方 sidebarRight 服务切换会话右栏状态（方向复核）
          const sr = sidebarRightService()
          if (sr !== undefined && typeof sr.toggleExpanded === 'function') {
            try {
              if (typeof sr.isExpanded !== 'function' || sr.isExpanded() !== wantOpen) {
                sr.toggleExpanded()
                return true
              }
            } catch (_) {}
          }

          // 3. 布局外壳呈现同步（极简测试桩或外壳 grid 呈现）
          const layout = layoutService()
          if (layout !== undefined) {
            try {
              if (wantOpen && typeof layout.openRightbar === 'function') {
                layout.openRightbar(false, true)
                return true
              } else if (!wantOpen && typeof layout.closeRightbar === 'function') {
                layout.closeRightbar()
                return true
              }
            } catch (_) {}
          }

          return false
        }

        /** 模态全屏态门控：与移动 CSS 的 body:has 规则同一判定选择器。
            桩环境的 matchesSelector 不支持带值选择器时恒回 null → 视为无模态。 */
        const modalOpenNow = () => {
          try { return document.querySelector('[role="dialog"][aria-modal="true"]') !== null } catch (_) { return false }
        }

        /** 起点是否在某【可交互横滚】内容内（CodeMirror 横滚区、tab 条、统计条）：
            这类横滑属于内容自身的滚动语义，不得触发边缘手势。
            判据必须同时满足 scrollWidth > clientWidth **且** computed
            overflow-x ∈ {auto, scroll, overlay}——只看 scrollWidth 会把
            「纵向滚动 + overflow-x:hidden 裁剪」的容器误判成横滚区：会话
            滚动体带一个宽代码块（横向溢出只是被裁掉、用户横拖它毫无反应）
            就会把对话页全部边缘手势杀掉（真机第二轮「开不了」的主嫌疑）。
            限深向上走、到 body 即止——根元素级溢出属布局 bug，不拿来禁手势。 */
        const insideHorizontalScroller = (node) => {
          try {
            let cursor = node
            for (let depth = 0; cursor !== null && cursor !== undefined && depth < 8; depth += 1) {
              if (cursor === document.body || cursor === document.documentElement) return false
              if (typeof cursor.scrollWidth === 'number' && typeof cursor.clientWidth === 'number' &&
                cursor.scrollWidth > cursor.clientWidth + 1) {
                // 溢出还需「可横向滚」才算横滚语义：hidden/visible/clip 的横向
                // 溢出是裁剪不是滚动。无 getComputedStyle（极简桩）时保守沿用
                // 旧判据（真实浏览器必有 CSSOM，不受影响）。
                if (typeof getComputedStyle !== 'function') return true
                const style = getComputedStyle(cursor)
                const overflowX = style !== null && style !== undefined ? String(style.overflowX || '') : ''
                if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') return true
              }
              cursor = cursor.parentNode
            }
          } catch (_) {}
          return false
        }

        /** 手势追踪种类/遥测原因的语义 token（评审收敛：不裸写魔法串）。 */
        const EDGE_KIND = {
          open: 'open',
          leftClose: 'left-close',
          rightClose: 'right-close',
          leftOpen: 'left-open',
          rightOpen: 'right-open',
          // 遥测原因 token（渲染时经词典翻译，绝不直接进 UI）
          multiTouch: 'multi-touch',
          modal: 'modal',
          hScroll: 'h-scroll',
          noPoint: 'no-point',
          absentRight: 'right-absent',
          badButton: 'toggle-unavailable',
          noTracker: 'no-tracker',
        }

        /**
         * 开合动作统一包装：两个抽屉（左侧栏 / 官方右栏）的 target 描述 +
         * 单一执行器。门控语义：状态已是要达成的样子时 no-op（防 arm 后被
         * 抢先翻转的竞态）；左抽屉缺 layout 服务时静默放弃；右栏执行失败
         * 时回报执行结果给遥测。
         */
        const drawerTargets = {
          left: {
            opened: () => !leftDrawerCollapsedNow(),
            toggle: () => {
              const layout = layoutService()
              if (layout === undefined) return false
              try { layout.toggleSidebar(); return true } catch (_) { return false }
            },
          },
          right: {
            opened: () => officialRightbarOpenedNow(),
            toggle: (wantOpen) => toggleOfficialRightbar(wantOpen),
          },
        }
        const fireDrawer = (side, wantOpen) => {
          const target = drawerTargets[side]
          if (target === undefined) return false
          if (target.opened() === wantOpen) return false
          return target.toggle(wantOpen) === true
        }

        /** touchstart：清旧追踪 → 多指/模态直接放弃 → 决定是否 arm。
            arm 规则（优先级即互斥）：某抽屉开着 → 只 arm 它的关闭追踪（任意起点，
            横滚内容除外）；双关 → arm 开启追踪（真机第三轮用户点名：对齐关闭手势
            的任意起点语义，方向在 fire 时结算——+x 开左抽屉、−x 开右栏）。
            debug 模式下全程写遥测：armed/拒绝原因 + 起触点，配合芯片读数定位真机。 */
        const onEdgeTouchStart = (event) => {
          if (!state.active) return
          state.edgeGesture = null
          const tele = state.debugEnabled ? { start: '—', kind: '—', moves: 0, last: '—', cancel: '—', fired: false } : null
          state.edgeTelemetry = tele
          try {
            if (event !== null && event !== undefined && event.touches !== undefined && event.touches !== null && event.touches.length > 1) {
              if (tele !== null) tele.kind = EDGE_KIND.multiTouch
              return
            }
          } catch (_) {}
          if (modalOpenNow()) {
            if (tele !== null) tele.kind = EDGE_KIND.modal
            return
          }
          const point = edgeTouchPoint(event)
          if (point === null) {
            if (tele !== null) tele.kind = EDGE_KIND.noPoint
            return
          }
          if (tele !== null) tele.start = `${Math.round(point.x)},${Math.round(point.y)}`
          const leftOpen = !leftDrawerCollapsedNow()
          const rightAvailable = officialRightbarAvailableNow()
          const rightOpen = rightAvailable && officialRightbarOpenedNow()
          if (leftOpen || rightOpen) {
            // 关闭追踪：任意起点，但横滚内容（编辑器/tab 条）的横滑是内容滚动语义
            if (insideHorizontalScroller(event?.target)) {
              if (tele !== null) tele.kind = EDGE_KIND.hScroll
              return
            }
            state.edgeGesture = { kind: leftOpen ? EDGE_KIND.leftClose : EDGE_KIND.rightClose, edge: null, startX: point.x, startY: point.y, at: Date.now(), fired: false }
            if (tele !== null) tele.kind = leftOpen ? EDGE_KIND.leftClose : EDGE_KIND.rightClose
            return
          }
          // 开启追踪：任意起点；横滚内容内不起（编辑器/统计条的横滑是内容滚动语义）
          if (insideHorizontalScroller(event?.target)) {
            if (tele !== null) tele.kind = EDGE_KIND.hScroll
            return
          }
          // 贴边起滑记录在案：只有贴边起点享有 touchcancel/短拂两类放宽补完
          //（系统手势竞争只存在于屏幕边缘），非贴边起点走完整触发阈
          const vw = Number(window.innerWidth)
          let edge = null
          if (point.x <= EDGE_ZONE_PX) edge = 'left'
          else if (Number.isFinite(vw) && point.x >= vw - EDGE_ZONE_PX) edge = 'right'
          state.edgeGesture = { kind: EDGE_KIND.open, edge, startX: point.x, startY: point.y, at: Date.now(), fired: false }
          if (tele !== null) tele.kind = edge === 'left' ? EDGE_KIND.leftOpen : edge === 'right' ? EDGE_KIND.rightOpen : EDGE_KIND.open
          if (state.debugEnabled) updateDebugChip()
        }

        /** 共用判定：纵向主导即作废（滚动/沉浸优先）→ 达阈值 fire 一次并锁定
            （fired 后同一触摸内不重复翻转）。threshold 由调用方给：触摸存活期间
            用完整触发阈，touchcancel/touchend 补完用放宽阈。返回是否发生了值得
            刷新遥测的事件（fire 或记录了原因）。 */
        const evaluateEdgeGesture = (gesture, point, threshold) => {
          if (gesture === null || gesture.fired || point === null) return false
          const dx = point.x - gesture.startX
          const dy = point.y - gesture.startY
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > EDGE_SLANT_PX) {
            state.edgeGesture = null
            return false
          }
          // 方向结算：关闭追踪方向固定（left-close 沿 −x、right-close 沿 +x）；
          // 开启追踪方向在达阈时结算——+x 开左抽屉、−x 开右栏（右栏缺席则该向
          // 无效并记录原因，对齐「不存在支持右侧栏的插件则无效」的语义）。
          let side = null
          let wantOpen = false
          let kind = null
          if (gesture.kind === EDGE_KIND.open) {
            if (dx >= threshold) { side = 'left'; wantOpen = true; kind = EDGE_KIND.leftOpen }
            else if (dx <= -threshold) {
              side = 'right'; wantOpen = true; kind = EDGE_KIND.rightOpen
              if (!officialRightbarAvailableNow()) {
                // 官方右栏未就绪（如处于 Hero 首页或非会话状态）：记录专属原因
                if (state.edgeTelemetry !== null) state.edgeTelemetry.reason = EDGE_KIND.absentRight
                return true
              }
            }
          } else if (gesture.kind === EDGE_KIND.leftClose) {
            if (dx <= -threshold) { side = 'left'; kind = EDGE_KIND.leftClose }
          } else if (gesture.kind === EDGE_KIND.rightClose) {
            if (dx >= threshold) { side = 'right'; kind = EDGE_KIND.rightClose }
          }
          if (side === null) return false
          const executed = fireDrawer(side, wantOpen)
          gesture.fired = true
          if (state.edgeTelemetry !== null) {
            state.edgeTelemetry.fired = executed
            state.edgeTelemetry.kind = kind
            if (!executed && kind === EDGE_KIND.rightOpen) {
              // 动作未生效：右栏开关钮不可用（无会话态 aria-disabled 等）
              state.edgeTelemetry.reason = EDGE_KIND.badButton
            }
          }
          return true
        }

        const onEdgeTouchMove = (event) => {
          const gesture = state.edgeGesture
          if (gesture === null || gesture.fired) return
          // 中途并指（评审 Spec 防御）：单指起滑后第二指落下（捏合/双指操作），
          // 触摸序列不得被结算成边缘手势——move 阶段复查并作废追踪
          try {
            if (event !== null && event !== undefined && event.touches !== undefined && event.touches !== null && event.touches.length > 1) {
              state.edgeGesture = null
              if (state.edgeTelemetry !== null) state.edgeTelemetry.reason = EDGE_KIND.multiTouch
              if (state.debugEnabled) updateDebugChip()
              return
            }
          } catch (_) {}
          const point = edgeTouchPoint(event)
          const tele = state.edgeTelemetry
          if (tele !== null && point !== null) {
            tele.moves += 1
            tele.last = `${Math.round(point.x - gesture.startX)},${Math.round(point.y - gesture.startY)}`
          }
          const notable = evaluateEdgeGesture(gesture, point, EDGE_TRIGGER_PX)
          if (state.debugEnabled && notable) updateDebugChip()
        }

        /** touchend：只对【贴边起滑的开启追踪】做快速短拂补完——横移主导 ≥32px、
            起触到抬手 ≤260ms 的快拂，是「系统手势没接管但位移不足完整阈」的最
            自然形态（类原生抽屉的速度语义）。非贴边起点与关闭路径不做短拂放大；
            静止短触（FAB 点击、选择长按）位移为零自然不命中。绝不刷新 800ms
            手势窗口——沉浸引擎语义：touchend 不是可信手势信号。 */
        const onEdgeTouchEnd = (event) => {
          const gesture = state.edgeGesture
          if (gesture === null || gesture.fired) {
            state.edgeGesture = null
            return
          }
          const lenient = gesture.kind === 'open' && gesture.edge !== null
          const point = lenient ? edgeTouchPoint(event) : null
          if (lenient && point !== null && Date.now() - gesture.at <= EDGE_FLICK_MS) {
            evaluateEdgeGesture(gesture, point, EDGE_FLICK_PX)
          }
          state.edgeGesture = null
          if (state.debugEnabled && gesture.fired) updateDebugChip()
        }

        /** touchcancel = 触摸被浏览器/系统接管（边缘返回手势、原生滚动接管等）。
            系统手势竞争只存在于屏幕边缘：仅【贴边起滑的开启追踪】用取消事件的
            最终触点按放宽阈值（EDGE_CANCEL_PX）补完——右向横移就被系统截走的
            触摸，意图显然是开抽屉；纵向主导的（原生滚动接管）由共用判定的斜率
            检查天然拒绝。非贴边起点与关闭路径不做补完（不扰动已验证的行为）。 */
        const onEdgeTouchCancel = (event) => {
          const gesture = state.edgeGesture
          const tele = state.edgeTelemetry
          if (gesture === null) {
            if (tele !== null) tele.cancel = EDGE_KIND.noTracker
            if (state.debugEnabled) updateDebugChip()
            return
          }
          const lenient = gesture.kind === 'open' && gesture.edge !== null
          const point = edgeTouchPoint(event)
          if (tele !== null && point !== null) {
            tele.cancel = `${Math.round(point.x - gesture.startX)},${Math.round(point.y - gesture.startY)}`
          }
          if (lenient) evaluateEdgeGesture(gesture, point, EDGE_CANCEL_PX)
          state.edgeGesture = null
          if (state.debugEnabled) updateDebugChip()
        }

        const immersiveListeners = [
          ['scroll', onDocumentScroll, { capture: true, passive: true }],
          ['touchstart', markGesture, { capture: true, passive: true }],
          ['touchmove', markGesture, { capture: true, passive: true }],
          ['touchstart', onEdgeTouchStart, { capture: true, passive: true }],
          ['touchmove', onEdgeTouchMove, { capture: true, passive: true }],
          // 只清边缘追踪器/补完被接管的触摸，不刷新手势窗口（见各自注释）
          ['touchend', onEdgeTouchEnd, { capture: true, passive: true }],
          ['touchcancel', onEdgeTouchCancel, { capture: true, passive: true }],
          ['wheel', markGesture, { capture: true, passive: true }],
          ['focusin', onFocusIn, { capture: true }],
          // 官方「回到底部」按钮：跳转本身是程序化滚动，只有点击目标能表达用户意图。
          // 捕获阶段挂在 documentElement 上，早于 React 在根容器上的 onClick，
          // 所以回显先于官方 `scrollTop = scrollHeight` 落地（随之贴到收回坐位后的新末尾）。
          ['click', onChatClick, { capture: true }],
        ]
        let immersiveBound = false

        const attachImmersiveListeners = () => {
          if (immersiveBound) return
          immersiveBound = true
          for (const [type, handler, opts] of immersiveListeners) {
            try { document.documentElement.addEventListener(type, handler, opts) } catch (_) {}
          }
        }

        const detachImmersiveListeners = () => {
          if (!immersiveBound) return
          immersiveBound = false
          for (const [type, handler, opts] of immersiveListeners) {
            try { document.documentElement.removeEventListener(type, handler, opts) } catch (_) {}
          }
        }

        const FAB_OPEN_ICON =
          '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
          '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
          '<line x1="6.25" y1="3.5" x2="6.25" y2="12.5" stroke="currentColor" stroke-width="1.5"/></svg>'

        const updateDebugChip = () => {
          const chip = state.debugChip
          if (chip === null) return
          const onOff = (value) => (value ? t('mobile.debug.stateOn') : t('mobile.debug.stateOff'))
          // 回显来路：真机「为什么没回显 / 是谁把它掀开的」一读即知。
          const revealReason = (token) => {
            if (token === 'gesture') return t('mobile.debug.immersive.reason.gesture')
            if (token === 'arrival') return t('mobile.debug.immersive.reason.arrival')
            if (token === 'focus') return t('mobile.debug.immersive.reason.focus')
            if (token === 'button') return t('mobile.debug.immersive.reason.button')
            return token
          }
          const lines = [
            [
              `${t('mobile.debug.viewport')} ${window.innerWidth}×${window.innerHeight}`,
              `≤1023 ${onOff(state.active)}`,
              `${t('mobile.debug.drawer')} ${onOff(state.drawerOpen)}`,
              `${t('mobile.debug.details')} ${onOff(state.detailsOpen)}`,
              `${t('mobile.debug.rightbar')} ${onOff(state.rightbarOpen)}`,
              `${t('mobile.debug.immersive')} ${onOff(state.immersive)}` +
                (state.lastRevealReason === null ? '' : `(${revealReason(state.lastRevealReason)})`),
              `${t('mobile.debug.errors')} ${state.errorCount}`,
            ].join(' · '),
          ]
          // 边缘遥测第二行：起触点 + armed/拒绝原因 + move 数 + 末次相对位移 +
          // 取消时相对位移 + 遥测原因 + 是否生效。真机「开不了」时读这行即可
          // 区分「没到阈值 / 被横滚拦截 / 右栏缺席 / 开关钮不可用」。种类与原因
          // token 一律经词典翻译（评审：debug 面也是用户可见 UI，不得硬编码文案）。
          const edgeKindLabel = (token) => {
            if (token === EDGE_KIND.leftOpen) return t('mobile.debug.edge.leftOpen')
            if (token === EDGE_KIND.rightOpen) return t('mobile.debug.edge.rightOpen')
            if (token === EDGE_KIND.leftClose) return t('mobile.debug.edge.leftClose')
            if (token === EDGE_KIND.rightClose) return t('mobile.debug.edge.rightClose')
            if (token === EDGE_KIND.open) return t('mobile.debug.edge.open')
            if (token === EDGE_KIND.multiTouch) return t('mobile.debug.edge.reason.multiTouch')
            if (token === EDGE_KIND.modal) return t('mobile.debug.edge.reason.modal')
            if (token === EDGE_KIND.hScroll) return t('mobile.debug.edge.reason.hScroll')
            if (token === EDGE_KIND.noPoint) return t('mobile.debug.edge.reason.noPoint')
            if (token === EDGE_KIND.absentRight) return t('mobile.debug.edge.reason.absentRight')
            if (token === EDGE_KIND.badButton) return t('mobile.debug.edge.reason.badButton')
            if (token === EDGE_KIND.noTracker) return t('mobile.debug.edge.reason.noTracker')
            return token
          }
          const tele = state.edgeTelemetry
          if (tele !== null && tele.start !== undefined) {
            let line = `${t('mobile.debug.edge')} ${t('mobile.debug.edge.fieldStart')}(${tele.start}) ${edgeKindLabel(tele.kind)} ${t('mobile.debug.edge.fieldMoves')}${tele.moves} ${t('mobile.debug.edge.fieldLast')}(${tele.last}) ${t('mobile.debug.edge.fieldCancel')}(${edgeKindLabel(tele.cancel)})`
            if (tele.reason !== undefined) line += ` ${t('mobile.debug.edge.fieldReason')}(${edgeKindLabel(tele.reason)})`
            if (tele.fired) line += ' ✓'
            lines.push(line)
          }
          chip.textContent = lines.join('\n')
        }

        /** 给外壳三栏骨架打自有标记属性；找不到骨架（异常布局）时返回 false 跳过抽屉件。 */
        const tagShellFrame = () => {
          // overlayLayer 是 frame 的子元素且带官方 data-shell-overlay 属性（源码核实）
          const overlayLayer = document.querySelector('[data-shell-overlay]')
          const frame = overlayLayer !== null ? overlayLayer.parentNode : null
          if (frame === null || frame === document.documentElement) return false
          frame.setAttribute('data-dshsvc-frame', '')
          let sawSidebar = false
          let sawCenter = false
          let sawDetails = false
          let sawRightbar = false
          for (const child of frame.children) {
            const className = typeof child.className === 'string' ? child.className : ''
            if (!sawSidebar && /sidebarCol/.test(className)) {
              child.setAttribute('data-dshsvc-sidebar', '')
              sawSidebar = true
            } else if (!sawCenter && /centerCol/.test(className)) {
              child.setAttribute('data-dshsvc-center', '')
              sawCenter = true
            } else if (!sawDetails && /detailsCol/.test(className)) {
              child.setAttribute('data-dshsvc-details', '')
              sawDetails = true
            } else if (!sawRightbar && /rightbarCol/.test(className)) {
              child.setAttribute('data-dshsvc-rightbar', '')
              sawRightbar = true
            }
          }
          return true
        }

        /** 建 backdrop/FAB 并接上抽屉状态观察。外壳骨架就绪才算成功；
            手机直接窄屏冷加载时骨架往往还没挂载（真机反馈：抽屉钮缺失 +
            官方 rail 残留，就是这个竞态），失败则由 watchForShell 重试。 */
        const buildSurfaces = () => {
          if (state.fab !== null) return true
          if (!tagShellFrame()) return false
          state.backdrop = document.createElement('div')
          state.backdrop.setAttribute('data-dshsvc-backdrop', '')
          state.backdrop.setAttribute('aria-hidden', 'true')
          Object.assign(state.backdrop.style, {
            position: 'fixed', inset: '0', zIndex: '31', display: 'none',
            background: 'rgba(0,0,0,.42)', backdropFilter: 'blur(1px)',
          })
          state.backdrop.addEventListener('click', () => {
            const layout = layoutService()
            if (layout === undefined) return
            if (state.drawerOpen) layout.toggleSidebar()
          })
          document.body.appendChild(state.backdrop)

          state.fab = document.createElement('button')
          state.fab.type = 'button'
          state.fab.setAttribute('data-dshsvc-fab', '')
          state.fab.setAttribute('aria-label', t('mobile.fab.label'))
          // 样式对齐外壳幽灵图标钮（设置关闭钮同族：28px 圆形、透明底、主题色），
          // 位置钉会话头部左上角（safe-area 感知），图标为侧栏面板开关。
          Object.assign(state.fab.style, {
            position: 'fixed',
            left: 'calc(env(safe-area-inset-left, 0px) + 10px)',
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            width: '32px', height: '32px', borderRadius: '16px', zIndex: '33', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            border: 'none', background: 'transparent', color: 'var(--dsw-alias-label-primary)',
            padding: '0', cursor: 'pointer', touchAction: 'manipulation',
          })
          state.fab.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
            '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" stroke="currentColor" stroke-width="1.5"/>' +
            '<line x1="6.25" y1="3.5" x2="6.25" y2="12.5" stroke="currentColor" stroke-width="1.5"/></svg>'
          // 标准 click 是唯一激活路径：浏览器会把一次触屏手势归一为一个 click，
          // 同时保留鼠标、键盘与辅助技术支持。不得在 pointerdown 提前翻转再按时间窗
          // 吞合成 click——主线程忙时 click 可晚到时间窗外，导致同一短按开后又关，
          // 表现成「必须长按才能打开」。touch-action:manipulation 已消除旧式点按延迟。
          state.fab.addEventListener('click', () => {
            const layout = layoutService()
            if (layout !== undefined) layout.toggleSidebar()
          })
          document.body.appendChild(state.fab)
          readOverlayState()

          // 不在 sidebarCol 上代理关闭：侧栏右上角已有外壳原生 toggle。若祖先再监听
          // click，同一事件会先由按钮关闭、再冒泡触发第二次 toggle，结果立即重新打开。
          // 抽屉关闭路径只保留原生 toggle 与外侧 backdrop，两者职责互不重叠。

          // 工作区侧板（nArs4W_panel，fixed z25 层）不受三栏属性驱动；
          // body 级监听只置脏标记、单发调度处理（绝不在回调里同步写 DOM，
          // 否则 写DOM→再触发→再写 的自激循环会打满主线程，页面永久转圈）
          try {
            state.workspaceObserver = new MutationObserver(() => { scheduleSync() })
            state.workspaceObserver.observe(document.body, { attributes: true, childList: true, subtree: true })
          } catch (_) {
            state.workspaceObserver = null
          }

          // frame 属性观察是抽屉状态主驱动：同步处理（监听范围受控、无自激风险）
          state.frameObserver = new MutationObserver(() => {
            readOverlayState()
            syncSurfaces()
          })
          const frame = document.querySelector('[data-dshsvc-frame]')
          if (frame !== null) state.frameObserver.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-details-collapsed', 'data-rightbar-collapsed'] })

          if (state.mountObserver !== null) { state.mountObserver.disconnect(); state.mountObserver = null }
          syncSurfaces()
          return true
        }

        /** 外壳骨架晚挂载的重试观察：AppFrame 一进 DOM 就补建抽屉件。 */
        const watchForShell = () => {
          if (state.mountObserver !== null || typeof MutationObserver !== 'function') return
          try {
            state.mountObserver = new MutationObserver(() => { buildSurfaces() })
            state.mountObserver.observe(document.documentElement, { childList: true, subtree: true })
          } catch (_) {
            state.mountObserver = null
          }
        }

        const ensureViewportCover = () => {
          for (const meta of document.querySelectorAll('meta[name="viewport"]')) {
            const content = meta.getAttribute('content') || ''
            if (/(^|,)\s*viewport-fit\s*=/.test(content)) continue
            meta.setAttribute('content', content.trim() === '' ? 'viewport-fit=cover' : content.trim() + ', viewport-fit=cover')
          }
        }

        const activate = () => {
          if (state.active) return
          if (layoutService() === undefined) return // 无官方 layout 服务时不出交互件，避免不可收起的抽屉
          state.active = true
          // 全部规则的作用域开关：CSS 与 DOM 标记都以它为门
          document.documentElement.setAttribute('data-dshsvc-mobile', '')
          ensureViewportCover()
          state.styleTag = document.createElement('style')
          state.styleTag.dataset.plugin = '@gehennawu/dsh-service'
          state.styleTag.dataset.pluginCss = '@gehennawu/dsh-service/mobile.css'
          state.styleTag.textContent = MOBILE_CSS
          document.head.appendChild(state.styleTag)
          if (!buildSurfaces()) watchForShell()
          attachImmersiveListeners()
          refreshImmersiveAvailability()

          let debugRequested = false
          try { debugRequested = new URLSearchParams(window.location.search).has(MOBILE_DEBUG_PARAM) } catch (_) {}
          if (debugRequested) {
            state.debugEnabled = true
            state.errorHandler = () => {
              state.errorCount += 1
              updateDebugChip()
            }
            window.addEventListener('error', state.errorHandler)
            state.resizeHandler = () => updateDebugChip()
            window.addEventListener('resize', state.resizeHandler)
            state.debugChip = document.createElement('div')
            state.debugChip.setAttribute('data-dshsvc-debug', '')
            Object.assign(state.debugChip.style, {
              position: 'fixed', left: '8px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
              zIndex: '60', maxWidth: '94vw', padding: '4px 8px', borderRadius: '8px',
              font: '11px/1.5 var(--ds-font-family-code, monospace)',
              background: 'var(--dsw-alias-bg-layer-2, #333)', color: 'var(--dsw-alias-label-primary, #eee)',
              pointerEvents: 'none', whiteSpace: 'pre-wrap', overflow: 'hidden', textOverflow: 'ellipsis',
            })
            state.debugChip.title = t('mobile.debug.title')
            document.body.appendChild(state.debugChip)
            updateDebugChip()
          }
          syncSurfaces()
        }

        const deactivate = () => {
          if (!state.active) return
          state.active = false
          state.drawerOpen = false
          state.detailsOpen = false
          state.rightbarOpen = false
          state.edgeGesture = null
          state.edgeTelemetry = null
          detachImmersiveListeners()
          document.documentElement.removeAttribute('data-dshsvc-mobile')
          document.documentElement.removeAttribute('data-dshsvc-immersive')
          if (state.headerRO !== null) {
            try { state.headerRO.disconnect() } catch (_) {}
            state.headerRO = null
          }
          state.headerEl = null
          if (state.frameObserver !== null) { state.frameObserver.disconnect(); state.frameObserver = null }
          if (state.workspaceObserver !== null) { state.workspaceObserver.disconnect(); state.workspaceObserver = null }
          if (state.mountObserver !== null) { state.mountObserver.disconnect(); state.mountObserver = null }
          if (state.errorHandler !== null) window.removeEventListener('error', state.errorHandler)
          if (state.resizeHandler !== null) window.removeEventListener('resize', state.resizeHandler)
          state.errorHandler = null
          state.resizeHandler = null
          for (const el of [state.styleTag, state.backdrop, state.fab, state.debugChip]) {
            if (el !== null && el.isConnected) el.remove()
          }
          for (const el of document.querySelectorAll('[data-dshsvc-frame],[data-dshsvc-sidebar],[data-dshsvc-center],[data-dshsvc-details],[data-dshsvc-rightbar],[data-dshsvc-chat-header]')) {
            el.removeAttribute('data-dshsvc-frame')
            el.removeAttribute('data-dshsvc-sidebar')
            el.removeAttribute('data-dshsvc-center')
            el.removeAttribute('data-dshsvc-details')
            el.removeAttribute('data-dshsvc-rightbar')
            el.removeAttribute('data-dshsvc-chat-header')
          }
          const headerStyle = (() => { try { return document.documentElement.style } catch (_) { return null } })()
          if (headerStyle !== null) {
            try { headerStyle.removeProperty('--dshsvc-header-h') } catch (_) { headerStyle['--dshsvc-header-h'] = '' }
          }
          state.styleTag = null
          state.backdrop = null
          state.fab = null
          cancelImmersiveRepin()
          state.debugChip = null
          state.debugEnabled = false
          resetImmersive()
        }

        const evaluate = () => {
          const want = featureEnabled('mobileAdaptation') && state.mmqMatches()
          if (want) activate()
          else deactivate()
        }

        const dispose = () => {
          deactivate()
          if (state.mq !== null && state.mqHandler !== null) {
            if (typeof state.mq.removeEventListener === 'function') state.mq.removeEventListener('change', state.mqHandler)
            else if (typeof state.mq.removeListener === 'function') state.mq.removeListener('change', state.mqHandler)
          }
          state.mqHandler = null
        }

        // matchMedia 惰性创建：测试环境可能只提供最小桩
        try {
          state.mq = window.matchMedia(MOBILE_ACTIVE_QUERY)
        } catch (_) {
          state.mq = null
        }
        state.mmqMatches = () => {
          try { return state.mq !== null && state.mq.matches === true } catch (_) { return false }
        }
        if (state.mq !== null) {
          state.mqHandler = () => evaluate()
          if (typeof state.mq.addEventListener === 'function') state.mq.addEventListener('change', state.mqHandler)
          else if (typeof state.mq.addListener === 'function') state.mq.addListener(state.mqHandler)
        }

        return { evaluate, dispose }
      }
