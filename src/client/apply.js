    function apply(ctx) {
      const { useState, useEffect, useRef } = React
      // v1.4.x（白屏修复）：宿主对 ok:false 一律回 rpcErrorSchema 枚举对象
      // （{code,message,details}），真实外壳的严格校验放行对象后，消费方若把
      // res.error 直接当字符串用（mapSessionError 透传 → setClearError → React
      // children），React 会以 #31「object is not a valid React child」炸掉整个
      // 渲染树——插件设置节被外壳错误边界吞成白屏（「清除已删除记录」实测触发，
      // 宿主未重载新端点时 unknown-endpoint 即命中）。归一回字符串语义（error=message、
      // 恢复 details.detail）后全插件既有 `res.error` 字符串消费零改动。
      // 需要浏览器时区偏移的端点：宿主用「用户墙上时间」解释无时区的重置卡到期串
      // （纯日期 / datetime-local；容器多为 UTC，两边各算一套会让卡在界面上「已过期」
      // 却仍被宿主判为未过期，既不自动移除也继续提示）。只在这几个端点上附带，
      // 不给其余请求的载荷平白加字段——偏移是少数端点的真需求，不是全局协议。
      const TZ_AWARE_ENDPOINTS = new Set(['quota', 'quota-reset-card', 'health'])
      const rpcCall = (endpoint, payload) => {
        const base = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
        const withOffset = TZ_AWARE_ENDPOINTS.has(endpoint) && base.timezoneOffsetMinutes === undefined
          ? { ...base, timezoneOffsetMinutes: new Date().getTimezoneOffset() }
          : base
        const request = TZ_AWARE_ENDPOINTS.has(endpoint)
          ? { ...withOffset, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
          : withOffset
        // datetime-local 必须在浏览器按目标日期解析；当前偏移不能代表跨夏令时的到期日。
        if (endpoint === 'quota-reset-card' && typeof request.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(request.expiresAt)) {
          const at = new Date(request.expiresAt)
          if (Number.isFinite(at.getTime())) request.expiresAt = at.toISOString()
        }
        return Promise.resolve(ctx.connection.rpc.call('/dsh-service', endpoint, request)).then(normalizeRpcResult)
      }


      let svcStyle
      if (typeof document !== 'undefined' && document.head) {
        svcStyle = document.createElement('style')
        // 归属标记：0.1.6-alpha.2 起客户端加载器按 style[data-plugin] 精确移除（removeOwnedStyles），
        // 未标记的标签会被 claimStyles 收归「当前物化的插件」——归属就取决于物化时机。
        // 本插件四处注入统一显式声明，不依赖该时序假设。
        svcStyle.dataset.plugin = '@gehennawu/dsh-service'
        svcStyle.dataset.pluginCss = '@gehennawu/dsh-service/theme-tokens.css'
        svcStyle.textContent = [
          // ── 统一视觉语言令牌（v0.39）：--dsh-svc-* 单一事实源──
          // 铁律一：恒为 var(--dsw-alias-*, <兜底>)，暗色块只换兜底叶值，不覆盖别名解析。
          // 铁律二：主题相关令牌（含别名链）一律声明在 body 而非 :root——var() 在声明元素上求值，
          // :root 上声明会先于 body[data-ds-dark-theme] 定格，暗色覆盖永远赶不上（真机实证）。
          'body{--dsh-svc-page-bg:#f4f5f7;--dsh-svc-content-bg:var(--dsw-alias-bg-layer-2,#ffffff);--dsh-svc-raised-bg:var(--dsw-alias-bg-layer-3,#ffffff);--dsh-svc-text:var(--dsw-alias-label-primary,#202124);--dsh-svc-text-muted:var(--dsw-alias-label-secondary,#6b7280);--dsh-svc-border:var(--dsw-alias-border-l1,#e5e7eb);--dsh-svc-brand:var(--dsw-alias-brand-primary,#2563eb);--dsh-svc-brand-text:var(--dsw-alias-label-primary-foreground,#ffffff);--dsh-svc-info:#2563eb;--dsh-svc-success:var(--dsw-alias-state-success-primary,#16a34a);--dsh-svc-warning:var(--dsw-alias-state-warn-primary,#d97706);--dsh-svc-danger:var(--dsw-alias-state-error-primary,#dc2626)}',
          // 卡片底写死浅灰（外壳 bg-layer-2 可能就是白，别名优先会隐形）；深色走 bg-layer-2 链。
          'body{--dsh-svc-card-bg:#eceef1}',
          // 加强边框只用于按钮描边：浅色深灰、深色亮灰。
          'body{--dsh-svc-border-strong:#b9c0ca}',
          'body[data-ds-dark-theme]{--dsh-svc-border-strong:#52565f}',
          'body[data-ds-dark-theme]{--dsh-svc-card-bg:var(--dsw-alias-bg-layer-2,#202126)}',
          'body[data-ds-dark-theme]{--dsh-svc-page-bg:var(--dsw-alias-bg-layer-1,#17181c);--dsh-svc-content-bg:var(--dsw-alias-bg-layer-2,#202126);--dsh-svc-raised-bg:var(--dsw-alias-bg-layer-3,#292a31);--dsh-svc-text:var(--dsw-alias-label-primary,#f3f4f6);--dsh-svc-text-muted:var(--dsw-alias-label-secondary,#a1a1aa);--dsh-svc-border:var(--dsw-alias-border-l1,#3f414a)}',
          // 品牌实底按钮（v0.42.2）：深色下 brand-primary 是近白，文字走 label-primary-foreground
          // （浅=白、深=近黑），外壳缺席回落 #fff、暗色叶值 #111318 兜底。
          'body[data-ds-dark-theme]{--dsh-svc-brand-text:#111318}',
          // 几何与密度令牌（与主题无关，:root 即可）：间距 4/8/12/16/20/24/32；圆角 控件8/卡片12/面板16/胶囊999；控件高 紧凑32/默认36/主操作40。
          ':root{--dsh-svc-space-1:4px;--dsh-svc-space-2:8px;--dsh-svc-space-3:12px;--dsh-svc-space-4:16px;--dsh-svc-space-5:20px;--dsh-svc-space-6:24px;--dsh-svc-space-8:32px;--dsh-svc-radius-control:8px;--dsh-svc-radius-card:12px;--dsh-svc-radius-panel:16px;--dsh-svc-radius-pill:999px;--dsh-svc-control-h:36px;--dsh-svc-control-h-compact:32px;--dsh-svc-control-h-primary:40px;--dsh-svc-content-max:800px;--dsh-svc-dur-fast:120ms;--dsh-svc-dur-view:170ms;--dsh-svc-font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
          // 兼容别名：展示面底=卡片底；分段条激活块=文字反色块（铁律二同样适用，暗色只改叶值）。
          'body{--dsh-svc-surface-bg:var(--dsh-svc-card-bg);--dsh-svc-tab-active-bg:var(--dsh-svc-text);--dsh-svc-tab-active-danger:var(--dsh-svc-text);--dsh-svc-tab-active-text:#ffffff}',
          'body[data-ds-dark-theme]{--dsh-svc-tab-active-text:#111318}',
          // 设置页导航行图标：外壳按 id 硬编码（第三方一律兜底齿轮）且协议无 icon 字段；
          // markSettingsNavRows 打的 data 标记接住——藏齿轮 SVG、mask SVG 画图标、currentColor 跟主题。
          '[data-dsh-service-nav]>svg:first-child,[data-dsh-service-quota-nav]>svg:first-child,[data-dsh-service-restart-nav]>svg:first-child,[data-dsh-service-sessions-nav]>svg:first-child{display:none}',
          '[data-dsh-service-nav]::before,[data-dsh-service-quota-nav]::before,[data-dsh-service-restart-nav]::before,[data-dsh-service-sessions-nav]::before{content:\'\';flex:none;width:16px;height:16px;background:currentColor}',
          '[data-dsh-service-nav]::before{' + navIconMask(NAV_ICON_BODY_SERVICE) + '}',
          '[data-dsh-service-quota-nav]::before{' + navIconMask(NAV_ICON_BODY_QUOTA) + '}',
          '[data-dsh-service-sessions-nav]::before{' + navIconMask(NAV_ICON_BODY_SESSIONS) + '}',
          '[data-dsh-service-restart-nav]::before{' + navIconMask(NAV_ICON_BODY_RESTART) + '}',
          // 窄面板主导航（v0.39）：≤640px 六页单行横滑——本插件自己的面板 UI，不挂 data-dshsvc-mobile。
          '@media (max-width:640px){',
          '[data-dshsvc-root] .dshsvc-tabs{flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch;padding:3px}',
          '[data-dshsvc-root] .dshsvc-tabs::-webkit-scrollbar{display:none}',
          '[data-dshsvc-root] .dshsvc-tab{padding:9px 13px;min-height:36px;box-sizing:border-box;font-size:13px;white-space:nowrap;flex:none}',
          '[data-dshsvc-root] .dshsvc-tab svg{flex:none}',
          '}',
          // 两行共享一套列（label / 版本号 / 「本次更新内容」/ 状态）：原先每行各自
          // space-between，label 宽窄不同（dsh-service 比 DSH 宽）就把版本号与入口按钮推成
          // 两行各自的位置——两行的入口按钮右缘对不齐。共享列后，两行的版本号与入口按钮
          // 天然同列，且与版本号长度无关：列宽取两行里最宽的那个版本号，长版本号只把整列
          // 一起推宽，不会让某一行错位。
          // 版本号右对齐（`justify-self:end`）：列宽按最长版本号取，短版本号（1.9.8 对
          // 0.1.7-rc.1）若左对齐会在它和入口按钮之间留出一段随长度变化的空隙。右对齐把
          // 这段余量挪到版本号**前面**（label 与版本号之间），版本号与入口按钮之间就只剩
          // 固定的列间距——两行的这段间距因此完全一致，且入口按钮位置不受影响（列宽与
          // 列间距都没变，按钮列不动）。
          // subgrid 是承重件：`display:contents` 让 identity 的三个子项直接落进行共享列，
          // 不新增包装层（DOM 结构不变，外点判定与结构断言照旧）。老引擎整块跳过，
          // 退回原有的 flex + space-between 行为（功能可用，仅不额外对齐）。
          '@supports (grid-template-columns:subgrid){',
          '[data-dshsvc-root] .dshsvc-version-surface{display:grid !important;grid-template-columns:max-content max-content max-content minmax(0,1fr);column-gap:16px}',
          '[data-dshsvc-root] .dshsvc-version-surface>*{grid-column:1/-1}',
          '[data-dshsvc-root] .dshsvc-version-row{display:grid !important;grid-template-columns:subgrid;justify-content:normal !important;align-items:center}',
          '[data-dshsvc-root] .dshsvc-version-identity{display:contents !important}',
          '[data-dshsvc-root] .dshsvc-version-identity>a,[data-dshsvc-root] .dshsvc-version-identity>code{margin-left:0 !important;justify-self:end}',
          '[data-dshsvc-root] .dshsvc-version-status{grid-column:4;justify-self:end}',
          '}',
          // 版本卡自身作为查询容器：窄设置面板与手机都按可用宽度排版，不依赖移动手势开关。
          // 窄容器两行：label+版本号+入口连排一块（identity 自己撑满整行）/ 状态行（status）。
          '[data-dshsvc-root] [data-testid="version-card"]{container-type:inline-size;container-name:dshsvc-version}',
          '@container dshsvc-version (max-width:480px){',
          // 窄卡放不下四列共享网格，必须逐条撤回上面 @supports 的 grid/contents——
          // subgrid 失去父网格会退化成单列堆叠，两行契约（identity 整行 + status 整行）就没了。
          '[data-dshsvc-root] .dshsvc-version-surface{display:block !important}',
          '[data-dshsvc-root] .dshsvc-version-row{display:flex !important;justify-content:space-between !important;gap:6px !important;padding:12px 2px !important}',
          // identity 保持 flex（勿改回 block）：block 下行内子项之间的 gap 失效，
          // label / 版本号 / 入口按钮会贴在一起（手机实拍「1.9.8」紧贴「本次更新内容」）。
          // flex + gap:8px 让三者之间恒有间隔；版本号仍可换行（min-width:0 + anywhere），
          // 入口按钮 flex:none 不被压扁，放不下时整体折到下一行。
          '[data-dshsvc-root] .dshsvc-version-identity{flex-basis:100%;display:flex !important;flex-wrap:wrap;align-items:center;gap:8px}',
          '[data-dshsvc-root] .dshsvc-version-identity>a,[data-dshsvc-root] .dshsvc-version-identity>code{margin-left:0 !important;white-space:normal !important;overflow-wrap:anywhere;min-width:0;justify-self:auto !important}',
          '[data-dshsvc-root] .dshsvc-version-identity>button{flex:none}',
          '[data-dshsvc-root] .dshsvc-version-status{grid-column:auto !important;justify-self:stretch !important;flex-basis:100%;justify-content:flex-start !important}',
          '}',
          // 搜索命中定位闪烁（jumpScrollToHit）。
          '@keyframes dshsv-locate-flash{0%,100%{background-color:rgba(198,128,0,0.10)}30%,70%{background-color:rgba(198,128,0,0.45)}}.dshsv-locate-flash{animation:dshsv-locate-flash 2s ease}',
          // 会话累计行独占 dock 行的下一行（v1.8.x 布局修订）：官方 dock 行（uV2eYG_dock，
          // content-sized + nowrap 的 flex 行）默认把槽位内容与统计胶囊/上下文圆环挤在一行；
          // 仅当累计行在场（:has 限定，功能关闭时官方行零影响）才开 wrap + 撑满整行。
          // 累计行 flex:0 0 100%（下方按形态限定的规则）+ order:1——order 后移是关键：官方 DOM
          // 里槽位排在上下文圆环之前，不同后移会把圆环挤到第三行；后移后统计胶囊+圆环
          // 共占第一行（官方原位），累计行居第二行。row-gap:0 把换行后的两行贴紧
          // （官方 gap:12px 纵横同值，拆开只收纵向、横向列距不动）。
          // 哈希词干随 DSH 版本漂移，与 mobile.css 同一口径按当前词干匹配、升级时复核。
          '[class*="uV2eYG_dock"]:has([data-dsh-service-subagent-models-dock]){flex-wrap:wrap;width:100%;row-gap:0}',
          // 累计行「独占一行」的 flex:0 0 100% 只在 0.1.6 的 dock 行形态下声明（后代选择
          // 器，穿透槽位 wrapper 的 display:contents 依然命中）；老宿主上这条 dock 行不存在，
          // 累计行回到列布局的内容高（单行），不再被撑成整座容器那么高。
          '[class*="uV2eYG_dock"] [data-dsh-service-subagent-models-dock]{flex:0 0 100%}',
          // 老宿主（0.1.5-rc.1/rc.2）下累计行若仍声称占满 100% 会出 issue #3 的空白：
          // 官方聊天包把统计胶囊（order 0）与累计行（order 60）注册在**同一个**
          // conversation.composer.dock 槽位，该槽位当时渲染为 uV2eYG_root 的子项，而
          // uV2eYG_root 是 flex-direction:column（主轴=纵向）——横向语义的
          // flex-basis:100% 在纵向容器上解析为「占满容器高度」，一行文字的累计行被撑成
          // ~150px 空壳，输入框下方出现一大块空白。判据不能用父级：0.1.6 上槽位
          // wrapper（data-slot，class 为空、display:contents）才是累计行的直接父级，
          // 按父级分流会同时命中新宿主；「祖先是否有 dock 行」CSS 选不了祖先，但能反着
          // 用后代选择器——老宿主根本没有 uV2eYG_dock 元素。故累计行的 flex 一律不写
          // 行内样式、交给上面这条按形态限定的规则。此规则组无条件注入（与移动端开关
          // 无关，老宿主不开移动端适配同样空白）。
          // ── 统一视觉语言基础层（v0.39）：.dshsvc-* 命名空间类，锚在 data-dshsvc-root 不外溢 ──
          // 线宽主、阴影次；动效 120/170ms；reduced-motion 归零；内容区灰画布 + 卡片分层。
          '[data-dshsvc-root]{color:var(--dsh-svc-text);font-size:14px;line-height:1.55;background:var(--dsh-svc-page-bg);border-radius:var(--dsh-svc-radius-card);padding:2px}',
          '[data-dshsvc-root] .dshsvc-page{width:100%;max-width:var(--dsh-svc-content-max);margin:0 auto}',
          '[data-dshsvc-root] button:focus-visible,[data-dshsvc-root] [role="switch"]:focus-visible,[data-dshsvc-root] select:focus-visible,[data-dshsvc-root] input:focus-visible{outline:2px solid var(--dsh-svc-brand);outline-offset:2px;border-radius:var(--dsh-svc-radius-control)}',
          '@media (prefers-reduced-motion:reduce){[data-dshsvc-root] *,[data-dshsvc-root] *::before,[data-dshsvc-root] *::after{transition-duration:0.01ms !important;animation-duration:0.01ms !important}}',
          // v1.4.x：按项目分区头可点击——hover 背景提示可展开/收起。
          '[data-testid^="sessions-project-header-"]{transition:background var(--dsh-svc-dur-fast,120ms)}',
          '[data-testid^="sessions-project-header-"]:hover{background:var(--dsw-alias-bg-layer-3,#f2f3f5)}',
          // 主导航条：单行连续分段条；激活段=文字反色块（tab-active 别名）。
          '[data-dshsvc-root] .dshsvc-tabs{display:flex;align-items:center;flex-wrap:wrap;gap:2px;width:100%;box-sizing:border-box;border:0.5px solid var(--dsh-svc-border);border-radius:var(--dsh-svc-radius-card);overflow:hidden}',
          '[data-dshsvc-root] .dshsvc-tab{position:relative;display:inline-flex;align-items:center;gap:5px;padding:8px 12px;margin:0;border:0;border-radius:0;background:transparent;color:var(--dsh-svc-text-muted);font:inherit;font-size:12px;font-weight:550;line-height:16px;cursor:pointer;transition:color var(--dsh-svc-dur-fast) ease,background var(--dsh-svc-dur-fast) ease}',
          '[data-dshsvc-root] .dshsvc-tab[aria-selected="true"]{background:var(--dsh-svc-tab-active-bg);color:var(--dsh-svc-tab-active-text);font-weight:650;border-radius:8px}',
          // 二级子标签：下划线标签语言，与模型列表内联标签同源。
          '[data-dshsvc-root] .dshsvc-subtabs{display:flex;flex-wrap:wrap;gap:2px;margin:10px 0 0;border-bottom:1px solid var(--dsh-svc-border)}',
          '[data-dshsvc-root] .dshsvc-subtab{appearance:none;background:transparent;border:0;border-bottom:2px solid transparent;border-radius:0;padding:8px 10px;font:inherit;font-size:13px;font-weight:550;color:var(--dsh-svc-text-muted);cursor:pointer;transition:color var(--dsh-svc-dur-fast) ease,border-color var(--dsh-svc-dur-fast) ease}',
          '[data-dshsvc-root] .dshsvc-subtab[aria-selected="true"]{color:var(--dsh-svc-brand);border-bottom-color:var(--dsh-svc-brand);font-weight:700}',
          // 页面头部：非吸附标题行（标题 + 主操作/次级组换行共处）+ 一行描述。
          '[data-dshsvc-root] .dshsvc-page-header{margin:14px 2px 2px}',
          '[data-dshsvc-root] .dshsvc-page-header-row{display:flex;align-items:center;justify-content:space-between;gap:var(--dsh-svc-space-3);flex-wrap:wrap}',
        ].join('')
        document.head.appendChild(svcStyle)
      }
      ctx.effect(() => () => { if (svcStyle) svcStyle.remove() }, 'dsh-service theme styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-service dictionaries')
      const t = ctx.locale.bind(NS)
      // 当前生效界面语言（显式设置 > 浏览器语言 > en 兜底，locale 快照已折算）：'zh' | 'en'。
      // 供 AI 补全等宿主侧语言相关动作取用；宿主只收枚举，不收自由文本。
      const currentUiLocale = () => ((ctx.locale?.getSnapshot?.()?.active) === 'zh' ? 'zh' : 'en')
      /** 十进制数量缩写共用实现：模型统计沿用 K/M，额度绝对数可额外启用 B；非法值由调用方指定兜底。 */
      const formatCompactCount = (value, options = {}) => {
        const number = Number(value)
        if (!Number.isFinite(number)) return options.invalid ?? ''
        if (options.billions === true && number >= 1e9) return `${Math.round(number / 1e8) / 10}B`
        if (number >= 1e6) return `${Math.round(number / 1e5) / 10}M`
        if (number >= 1e3) return `${Math.round(number / 1e2) / 10}K`
        return number.toLocaleString()
      }
      // mobileAdaptation 默认关闭（v0.31 用户点名）：宿主与客户端默认值必须一致。
      const DEFAULT_FEATURES = { healthDiagnostics: true, modelUsage: true, quotaLookup: true, backupMaintenance: true, taskNotifications: true, healthz: true, skillManager: true, subagentRoute: true, subagentModelsDock: true, mobileAdaptation: false, sessionManager: true, fileEditor: true, modelProviderIcons: true }
      // 特性设置门面：静态 inject 不带任何设置服务，运行时按能力探测接入
      // （configForms → settingsScope → 内存兜底；见 src/client/feature-settings.js）。
      // 0.1.7-alpha.1 移除了 settingsScope，静态依赖它会在该版本阻断整个客户端激活；
      // 反向静态依赖 configForms 又会在 0.1.5~0.1.6 上同样阻断，故只走动态探测。
      const { featureScope, featureSnapshot, featureValue, featureEnabled, useFeatures } = createFeatureSettings({
        ctx,
        namespace: NS,
        defaults: DEFAULT_FEATURES,
        React,
      })
      ctx.effect(() => () => featureScope.dispose(), 'dsh-service feature settings facade')
      // 设置页左列三行打标记，配合上方样式换成各自图标；label 走 locale 绑定值。
      ctx.effect(
        () => markSettingsNavRows([
          { attr: 'data-dsh-service-nav', label: () => t('nav.label') },
          { attr: 'data-dsh-service-quota-nav', label: () => t('tabs.quota') },
          { attr: 'data-dsh-service-restart-nav', label: () => t('nav.restart') },
          { attr: 'data-dsh-service-sessions-nav', label: () => t('tabs.sessions') },
        ]),
        'dsh-service settings nav icons',
      )
      // ── 设置栏左侧标签手动排序与显隐：正文已整段抽至 src/client/settings-nav-tabs.js
      // （工厂作用域分片，清单见 scripts/client-source.mjs）。工厂在本位原位调用，返回值
      // 解构回原名供下游（导航管理子页、额度卡、版本通知等）零改动消费。
      const { settingsNavBackend, createSectionBackendSync, SETTINGS_NAV_MAX_ITEMS, getRawSettingsSections, navOrderListeners, notifyNavOrderChanged, readSettingsNavHidden, readSettingsNavOrder, resolveSectionLabel, writeSettingsNavHidden, writeSettingsNavOrder, ensureSettingsNavBackendSynced } = createSettingsNavTabs({ ctx, rpcCall })
      const persistSettingsNavToBackend = settingsNavBackend.persist
      const persistSettingsNavReset = settingsNavBackend.persistReset

      const useTranslation = () => {
        const [, setSnapshot] = useState(ctx.locale.getSnapshot())
        useEffect(() => ctx.locale.subscribe(() => setSnapshot(ctx.locale.getSnapshot())), [])
        return t
      }
      // ── v1.2 子代理派发记录缓存：正文与两组件已整段抽至 src/client/subagent-dispatch-ring.js
      // （工厂作用域分片，清单见 scripts/client-source.mjs）。工厂调用在 useTranslation 定义
      // 之后（见「Svc 视觉基元」段前），避免按值传参的 TDZ；每次 apply 调用产出一份新缓存状态，
      // 与原 apply 作用域声明等命。
      const { SubagentModelsDock } = createSubagentDispatchRing({ ctx, rpcCall, useTranslation })
      // ── 导航纯函数（v0.39 六页信息架构）────────────────────────────────
      // 可见性/顺序/回退全部收敛为纯函数（可独立测试）；ServicePanel 只持状态与业务块。
      const PRIMARY_TAB_ORDER = ['overview', 'usage', 'quota', 'diagnostics', 'maintenance', 'configuration']
      const PRIMARY_TAB_LABELS = { overview: 'tabs.overview', usage: 'tabs.usage', quota: 'tabs.quota', diagnostics: 'tabs.health', maintenance: 'tabs.maintenance', configuration: 'tabs.configuration' }
      const PRIMARY_TAB_FEATURES = { usage: 'modelUsage', quota: 'quotaLookup', diagnostics: 'healthDiagnostics' }
      const getVisiblePrimaryTabs = (features, warnings) => PRIMARY_TAB_ORDER
        .filter((id) => PRIMARY_TAB_FEATURES[id] === undefined || features[PRIMARY_TAB_FEATURES[id]] !== false)
        .map((id) => ({ id, labelKey: PRIMARY_TAB_LABELS[id], warning: warnings !== undefined && warnings[id] === true }))
      // 维护子页顺序（用户点名）：sessions → skills → subagent → backup → restart；
      // restart 不受功能门控（重启永远可用），维护页实际恒可达。
      const MAINTENANCE_TAB_ORDER = ['sessions', 'skills', 'subagent', 'backup', 'restart']
      const MAINTENANCE_TAB_LABELS = { sessions: 'tabs.sessions', skills: 'tabs.skills', subagent: 'tabs.subagent', backup: 'tabs.backup', restart: 'tabs.restart' }
      const MAINTENANCE_TAB_FEATURES = { sessions: 'sessionManager', skills: 'skillManager', subagent: 'subagentRoute', backup: 'backupMaintenance' }
      const getVisibleMaintenanceTabs = (features) => MAINTENANCE_TAB_ORDER
        .filter((id) => MAINTENANCE_TAB_FEATURES[id] === undefined || features[MAINTENANCE_TAB_FEATURES[id]] !== false)
        .map((id) => ({ id, labelKey: MAINTENANCE_TAB_LABELS[id] }))
      // 维护子页记忆规整：值必须在当前可见白名单内，否则回退到首个可用页；全关返回 null。
      const normalizeMaintenanceTab = (value, features) => {
        const visible = getVisibleMaintenanceTabs(features)
        if (visible.length === 0) return null
        return visible.some((item) => item.id === value) ? value : visible[0].id
      }
      const CONFIG_TABS = [
        { id: 'features', labelKey: 'tabs.features' },
        { id: 'notifications', labelKey: 'tabs.notifications' },
        { id: 'navOrder', labelKey: 'tabs.navOrder' },
      ]
      // v0.39 页面元数据：每页一行描述（标题复用 tabs.* 词条）。
      // 概览/模型统计/维护/额度/诊断页 的描述取消（undefined = 不渲染），仅配置页保留一行。
      const PAGE_DESCRIPTIONS = {
        configuration: 'page.configuration.desc',
      }
      /** 页面头部基元：非吸附轻量标题 + 一行描述；主操作位由各页逐步接入（action prop）。 */
      function SvcPageHeader({ title, description, action, secondary }) {
        return React.createElement('header', { 'data-testid': 'svc-page-header', className: 'dshsvc-page-header' },
          React.createElement('div', { className: 'dshsvc-page-header-row' },
            React.createElement('h2', { className: 'dshsvc-page-title', style: { margin: 0, fontSize: '18px', fontWeight: 700, lineHeight: 1.4, color: 'var(--dsh-svc-text)' } }, title),
            action !== undefined && action !== null ? action : null,
            secondary !== undefined && secondary !== null ? React.createElement('div', { className: 'dshsvc-page-secondary', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, secondary) : null),
          description ? React.createElement('p', { className: 'dshsvc-page-desc', style: { margin: '2px 0 0', fontSize: '12px', color: 'var(--dsh-svc-text-muted)', lineHeight: 1.5 } }, description) : null)
      }
      /** 导航条基元：variant 'primary' = 分段条（激活=反色块），'sub' = 下划线子标签。
       * items=[{id,label,icon?,warning?,badge?}]；role=tablist/tab + aria-selected，
       * 状态点只做视觉补充，语义由 aria-label 文字承载。 */
      function SvcTabs({ items, activeId, onChange, testIdPrefix, variant, dotLabel, ariaLabel }) {
        const isSub = variant === 'sub'
        return React.createElement('div', { role: 'tablist', 'aria-label': ariaLabel, className: isSub ? 'dshsvc-subtabs' : 'dshsvc-tabs', 'data-testid': testIdPrefix + '-list' },
          items.map((item) => {
            const isActive = item.id === activeId
            const style = isSub
              ? (isActive ? { color: 'var(--dsh-svc-brand)', borderBottom: '2px solid var(--dsh-svc-brand)', fontWeight: 700 } : null)
              : (isActive ? { background: 'var(--dsh-svc-tab-active-bg)', color: CHIP_ACTIVE_TEXT, fontWeight: 650, borderRadius: '8px' } : null)
            return React.createElement('button', {
              key: item.id,
              type: 'button',
              role: 'tab',
              'aria-selected': String(isActive),
              'data-testid': testIdPrefix + '-' + item.id,
              className: isSub ? 'dshsvc-subtab' : 'dshsvc-tab',
              style,
              onClick: () => onChange(item.id),
            },
              item.icon !== undefined ? React.createElement(TabIcon, { name: item.icon }) : null,
              item.label,
              item.warning ? React.createElement('span', { 'data-testid': 'tab-dot-' + item.id, 'aria-label': dotLabel, style: { position: 'absolute', top: '-3px', right: '-3px', width: '8px', height: '8px', ...fullRound('50%'), background: 'var(--dsw-alias-state-warn-primary)', boxShadow: '0 0 0 2px var(--dsw-alias-bg-layer-1)' } }) : null,
              item.badge ? React.createElement('span', { 'data-testid': item.badge.testid, style: { position: 'absolute', top: '-7px', right: '-10px', fontSize: '9px', lineHeight: '14px', padding: '0 4px', ...fullRound('999px'), background: 'var(--dsw-alias-state-warn-primary)', color: 'var(--dsh-svc-brand-text)', fontWeight: 700 } }, item.badge.text) : null)
          }))
      }
      // 全局通知状态服务已抽至 src/client/notification-service.js（工厂作用域分片）；开关
      // let 改为 notifyState.current.* 箱体活读（原 let 快照语义不跨工厂边界）。
      const { notifyState, useNotifyState, NOTIFY_KIND_KEYS, fireNotification, subscribeBellVisible } = createNotificationService()
      // 设置页左列入口开关的通用实现（重启/额度/技能三个入口共用，不再三套复制）：
      // localStorage 持久化、默认关；开启才注册 settings.section 条目、关闭即注销——
      // 导航列单元格由外壳渲染，null 内容不能隐藏导航项。feature 可选：功能关闭时同样注销。
      const createNavEntryToggle = ({ storageKey, legacyStorageKey, sectionId, order, labelKey, feature, renderContent }) => {
        let enabled = false
        try {
          let raw = localStorage.getItem(storageKey)
          // v0.39 快捷入口键更名（用户点名）：旧键只读一次、迁移写入新键，此后只认新键。
          if (raw === null && legacyStorageKey !== undefined) {
            const legacy = localStorage.getItem(legacyStorageKey)
            if (legacy !== null) {
              try { localStorage.setItem(storageKey, legacy) } catch (_) {}
              raw = legacy
            }
          }
          enabled = raw === 'true'
        } catch (_) {}
        let dispose = null
        const listeners = new Set()
        const sync = () => {
          if (dispose) { dispose(); dispose = null }
          if (!enabled || (feature !== undefined && !featureEnabled(feature))) return
          dispose = ctx.slots.register(
            { name: 'settings.section', id: sectionId, order, label: () => t(labelKey) },
            renderContent,
          )
        }
        const setEnabled = (value) => {
          enabled = value === true
          try { localStorage.setItem(storageKey, enabled ? 'true' : 'false') } catch (_) {}
          sync()
          if (typeof notifyNavOrderChanged === 'function') notifyNavOrderChanged()
          for (const listener of listeners) listener()
        }
        const useEnabled = () => {
          const [state, setState] = useState(enabled)
          useEffect(() => {
            const update = () => setState(enabled)
            listeners.add(update)
            setState(enabled)
            return () => listeners.delete(update)
          }, [])
          return [state, setEnabled]
        }
        const disposeEntry = () => {
          if (dispose) { dispose(); dispose = null }
        }
        return { sync, setEnabled, useEnabled, disposeEntry }
      }
      // v0.39 快捷入口收敛为三个（用户点名）：重启/额度查询/会话管理，各自独立开关、默认关。
      // 技能与子代理的左列入口撤销（维护页内仍有完整功能）；存储键统一迁到 shortcut-* 命名。
      const restartNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-shortcut-restart', legacyStorageKey: 'dsh-service-restart-nav', sectionId: 'dsh-service-restart', order: 499, labelKey: 'nav.restart', renderContent: () => React.createElement(RestartSection, null) })
      const quotaNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-shortcut-quota', legacyStorageKey: 'dsh-service-quota-nav', sectionId: 'dsh-service-quota', order: 498, labelKey: 'tabs.quota', feature: 'quotaLookup', renderContent: () => React.createElement(QuotaSection, null) })
      const sessionsNavToggle = createNavEntryToggle({ storageKey: 'dsh-service-shortcut-sessions', legacyStorageKey: 'dsh-service-sessions-nav', sectionId: 'dsh-service-sessions', order: 495, labelKey: 'tabs.sessions', feature: 'sessionManager', renderContent: () => React.createElement(SessionsSection, null) })
      // ── 批量补全共享状态：跨标签/设置面板开关存活（宿主任务本身不随 UI 停止）──
      // ── 批量补全共享状态：正文已抽至 src/client/skills-batch-shared.js（工厂作用域分片）；
      // 工厂调用点在「技能管理」段 resolveSkillModelChoice 定义之后（模型目录三件套按值传入）。
      // 会话边沿通知：running→idle 记一次任务结束；pendingInteraction 出现记一次需要确认。
      // 数据源是客户端运行时的会话列表快照（订阅推送）；首个快照只建立基线，重连后重建基线，二者都不响铃。
      // NOTIFY_KIND_KEYS 与 fireNotification 已并入 src/client/notification-service.js（见上方解构）。
      const getModelDirectories = () => {
        try {
          if (typeof ctx.get === 'function') return ctx.get('modelDirectories')
        } catch (_) {}
        return undefined
      }
      // 会话活跃态（sessions.list 快照派生，订阅推送更新）：任务通知与额度圆环的活跃供应商集合共享这一事实源。
      // 两项都关闭时彻底摘除订阅；任一重新开启时重新建立当前快照基线，不补发关闭期间的旧边沿。
      const sessionActivity = { runningSessionIds: new Set() }
      // 会话活跃观察已抽至 src/client/session-activity.js。

      // ── 版本/重启流子系统：已整段抽至 src/client/version-restart.js（工厂作用域分片，
      // 清单见 scripts/client-source.mjs）。返回值解构回原名供 ServicePanel/导航入口/覆盖层消费；
      // upgradeInFlight/runtimeEnvState 两个 let 经访问器跨界（见下方调用点的 is/set/get 改写）。
      const { RestartOverlay, RestartSection, compareSemver, fetchVersionSnapshot, refreshVersionSnapshot, startRecovery, useInstalledVersion, useRestartFlow, useRuntimeEnv, isUpgradeInFlight, setUpgradeInFlight, getRuntimeEnvState } = createVersionRestartFlow({ ctx, rpcCall, t, useTranslation, restartNavToggle })

      // ── 额度核心：已整段抽至 src/client/quota-core.js（工厂作用域分片，清单见
      // scripts/client-source.mjs）。返回值解构回原名供 RemoteQuotaCard/峰谷时段等消费。
      const { QUOTA_KIND_OPTIONS, acquireQuotaLoop, applyQuotaCardOrder, formatClockTime, formatShortDate, humanizeDuration, subscribeQuotaCards, commitQuotaCards, resetQuotaCards, ensureQuotaCardsSynced, quotaWindowDisplayLabel, quotaWindowValueText, readQuotaCardHidden, readQuotaCardOrder, releaseQuotaLoop, quotaExtractBalance, resolveBalanceBaseline, setManualBalanceBaseline, computeBalanceGaugeState, fetchQuotaSnapshot } = createQuotaCore({ ctx, rpcCall, featureEnabled, getModelDirectories, sessionActivity, createSectionBackendSync, SETTINGS_NAV_MAX_ITEMS, formatCompactCount })
      createSessionActivityObserver({ ctx, sessionActivity, t, featureEnabled, featureScope, notifyState, fireNotification, NOTIFY_KIND_KEYS })

      // ─── 峰谷时段（v0.25 deepseek，v1.3.1 起扩表到 zai-coding-cn）─────────────
      // 各家计费口径同族：非高峰时段按高峰价格的一半计/抵扣。北京时间固定 UTC+8 无夏令时：
      // nowMs 平移 8h 后读 UTC 字段即得。segments = 高峰分钟区间（当日分钟数，北京零点起算），
      // 仅周一至周五生效；两家周六日全天空闲。captionKey 指向各自的规则说明词典键。
      // 用 null 原型表防 kind 撞上 Object.prototype 键名（constructor 等）。
      //
      // holidays：**是否为该 kind 叠加「中国法定节假日全天算空闲」**。只有 DeepSeek 官方定价页
      // 有此口径（脚注：北京时间周一至周五「不含中国法定节假日」9:00-12:00、14:00-18:00 为高峰）；
      // 智谱 GLM Coding Plan 的官方口径只看星期（每周一至周五 14:00-18:00），**不得**跟着变。
      // 调休上班的周末仍算空闲是两家共同的既有行为：判定从不查「工作日」概念，只在周一至周五
      // 里剔除法定节假日，故本次唯一增量是「工作日里的假期整天转空闲」，不存在反向案例。
      const QUOTA_PEAK_SCHEDULES = Object.assign(Object.create(null), {
        // DeepSeek 开放平台：高峰 = 9:00–12:00、14:00–18:00，**不含中国法定节假日**（官方定价页）。
        deepseek: { segments: [[540, 720], [840, 1080]], captionKey: 'quota.peak.caption', holidays: true },
        // 智谱 GLM Coding Plan：高峰 = 14:00–18:00（官方套餐概览：非高峰时段模型调用按基础积分的 50% 抵扣）。
        'zai-coding-cn': { segments: [[840, 1080]], captionKey: 'quota.peak.caption.zai', holidays: false },
      })
      const QUOTA_PEAK_COLOR = '#f0952f'
      const QUOTA_PEAK_IDLE_COLOR = 'var(--dsw-alias-state-success-primary)'
      const QUOTA_PEAK_TICK_MS = 30000
      // 换挡倒计时用数字钟时刻（formatBeijingClockTime），无 boundary 类词典键。
      // 色带无外部刻度：只画两段——当前时段剩余 + 下一个相反时段（可跨天，用户点名隐藏
      // 过去时间），左缘细标线即当前时刻，段内短词「忙时/闲时」过窄自动隐藏。
      function beijingCivilParts(nowMs) {
        const shifted = new Date(nowMs + 8 * 3600 * 1000)
        return { dayIndex: shifted.getUTCDay(), minutesOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() }
      }
      // 峰谷扫描的最大天数：**由数据覆盖范围推导**而不是固定魔法数——长假可达 9 天
      // （2026 春节 2/15–2/23），旧的「扫 7 天必然覆盖」不变量在有节假日维度后不再成立，
      // 会让 flips 为空、倒计时整块不渲染（静默缺失）。生成表里最晚覆盖年份的年末
      // + 元旦高峰边界所需天数，并保证退化为纯星期判定时仍 ≥ 8（覆盖「周五最后一个
      // 边界点后下个翻转在周一」）。
      const QUOTA_PEAK_SCAN_DAYS = (() => {
        let latest = 0
        const years = Array.isArray(HOLIDAY_DATA?.years) ? HOLIDAY_DATA.years : []
        for (const year of years) {
          const value = Number(year)
          if (Number.isFinite(value) && value > latest) latest = value
        }
        if (latest === 0) return 8
        // 覆盖年全年 + 跨年到下一个元旦高峰边界（约 8 天）留足余量。
        return Math.max(8, Math.ceil((new Date(Date.UTC(latest, 11, 31)).getTime() - Date.now()) / 86400000) + 8)
      })()
      // ── 节假日集合：生成表（构建期内联，见 scripts/generate-holidays.mjs），唯一事实源 ──
      // 生成物只含**已由国务院公告确认**的年份。未覆盖年份**不查节假日**（退回纯星期判定）
      // ——静态表空数据必须表现为「没有信息」而不是「没有假期」，否则等于把未知伪装成已知；
      // 降级状态由说明行的附加提示说出来。曾有「月历点选即改」的配置补丁层，已整层取消：
      // 判定只认生成表，不再读任何用户配置（历史遗留的补丁键/配置区块被直接无视）。
      const quotaHolidayYears = new Set(Array.isArray(HOLIDAY_DATA?.years) ? HOLIDAY_DATA.years.map((year) => String(year)) : [])
      const quotaHolidayGenerated = HOLIDAY_DATA?.offDays && typeof HOLIDAY_DATA.offDays === 'object' ? HOLIDAY_DATA.offDays : {}
      /** 北京日历日的 `YYYY-MM-DD`。 */
      function beijingDateKey(nowMs) {
        const shifted = new Date(nowMs + 8 * 3600 * 1000)
        const digits = (value) => String(value).padStart(2, '0')
        return `${shifted.getUTCFullYear()}-${digits(shifted.getUTCMonth() + 1)}-${digits(shifted.getUTCDate())}`
      }
      /** 该北京年是否有节假日数据（生成表覆盖年）。无数据 → 退回纯星期判定，
       * 并由说明行的降级提示把「这是估算」说出来。 */
      function quotaHolidayDataCovers(yearKey) {
        return quotaHolidayYears.has(yearKey)
      }
      /** 该北京日历日是否算放假日（生成表说了算）。 */
      function quotaIsHolidayDate(dateKey) {
        return typeof quotaHolidayGenerated[dateKey] === 'string'
      }
      function quotaIsPeakMinute(schedule, nowMs) {
        const civil = beijingCivilParts(nowMs)
        if (civil.dayIndex === 0 || civil.dayIndex === 6) return false
        // 法定节假日全天算空闲：只在数据覆盖该年时才生效——未覆盖年份退回星期判定，并由
        // 卡片上的降级提示把「这是估算」说出来（绝不静默显示一个可能错的忙/闲）。
        if (schedule.holidays === true) {
          const dateKey = beijingDateKey(nowMs)
          if (quotaHolidayDataCovers(dateKey.slice(0, 4)) && quotaIsHolidayDate(dateKey)) return false
        }
        return schedule.segments.some(([start, end]) => civil.minutesOfDay >= start && civil.minutesOfDay < end)
      }
      /** 从当前时刻起收集前 count 个峰谷切换时刻（毫秒，升序）。
       * 候选翻转点 = 当日高峰边界 + 次日的零点，逐点比较状态是否翻转——周末与法定节假日
       * 没有边界点，其「整段空闲」由零点处的状态比较兜住。扫描上界 QUOTA_PEAK_SCAN_DAYS
       * 覆盖最长假期（9 天），长假期间不会再出现 flips 为空、倒计时整块消失的情形。 */
      function quotaUpcomingFlips(schedule, nowMs, count) {
        const shifted = new Date(nowMs + 8 * 3600 * 1000)
        shifted.setUTCHours(0, 0, 0, 0)
        const beijingDayStart = shifted.getTime() - 8 * 3600 * 1000
        const boundariesPerDay = schedule.segments.flat()
        const flips = []
        let previous = quotaIsPeakMinute(schedule, nowMs)
        for (let dayOffset = 0; dayOffset <= QUOTA_PEAK_SCAN_DAYS && flips.length < count; dayOffset++) {
          const dayStart = beijingDayStart + dayOffset * 86400000
          const candidates = boundariesPerDay.map((minute) => dayStart + minute * 60000)
          candidates.push(dayStart + 86400000)
          for (const candidate of candidates) {
            if (candidate <= nowMs) continue
            const current = quotaIsPeakMinute(schedule, candidate)
            if (current === previous) continue
            flips.push(candidate)
            previous = current
            if (flips.length >= count) return flips
          }
        }
        return flips
      }
      function formatBeijingClockTime(ms) {
        const shifted = new Date(ms + 8 * 3600 * 1000)
        const digits = (value) => String(value).padStart(2, '0')
        return `${digits(shifted.getUTCHours())}:${digits(shifted.getUTCMinutes())}`
      }

      /** 峰谷块显隐判定：kind 命中峰谷时段表且有窗口数据（额度卡与圆环面板共用一处口径）。
       * 返回命中的 schedule（segments + captionKey），未命中返回 null。 */
      function quotaPeakScheduleFor(row, windows) {
        if (Array.isArray(windows) === false || windows.length === 0) return null
        return QUOTA_PEAK_SCHEDULES[row?.kind] ?? null
      }

      /** 峰谷提示块（kind 对应时段表见 QUOTA_PEAK_SCHEDULES，当前 deepseek 与 zai-coding-cn）：
       * 当前状态徽标 + 数字钟换挡倒计时、两段式峰谷色带（橙=高峰、绿=空闲；当前时段剩余 +
       * 下一个相反时段，可跨天）、左缘细标线即当前时刻，规则说明行可选。额度卡与圆环面板共用，
       * 圆环面板窄所以不渲染说明行（showCaption:false）。schedule 必传（由 quotaPeakScheduleFor 判定）。
       * 时刻推进用 ctx.timer 自续链而非 setInterval：测试桩里不会留真实定时器挂住进程，卸载即断链。
       * 说明行在节假日数据未覆盖当前年份时追加一条降级提示——「按工作日估算」必须让用户看见，
       * 否则等于把一次可能算错的忙/闲伪装成确定结论。 */
      function QuotaPeakTimeline({ showCaption, schedule }) {
        const translate = useTranslation()
        // 测试桩的 useState 不调用函数式初始化器，直接传值（多算一次 Date.now 无副作用）。
        const [now, setNow] = useState(Date.now())
        useEffect(() => {
          let disposed = false
          let disposer = null
          const tick = () => {
            if (disposed) return
            disposer = ctx.timer.timeout(() => {
              setNow(Date.now())
              tick()
            }, QUOTA_PEAK_TICK_MS)
          }
          tick()
          return () => {
            disposed = true
            if (disposer !== null && disposer !== undefined) disposer()
          }
        }, [])
        const inPeak = quotaIsPeakMinute(schedule, now)
        const flips = quotaUpcomingFlips(schedule, now, 2)
        const nextFlip = flips[0] ?? null
        const accentColor = inPeak ? QUOTA_PEAK_COLOR : QUOTA_PEAK_IDLE_COLOR
        const stateLabel = translate(inPeak ? 'quota.peak.nowPeak' : 'quota.peak.nowIdle')
        // 降级提示：节假日维度只属于声明了 holidays 的 kind（当前仅 deepseek），且只在数据
        // 覆盖当前北京年时生效；未覆盖年份忙/闲退回纯星期判定，必须说清这是估算。
        // （节假日不做任何专门显示——假期语境只存在于说明行，判定层静默生效。）
        const holidayDateKey = beijingDateKey(now)
        const degraded = schedule.holidays === true && !quotaHolidayDataCovers(holidayDateKey.slice(0, 4))
        // pctOf 复用 /1440 归一：传入「权重占比 ×1440」得到百分比（保留 4 位小数）。
        const pctOf = (minute) => Math.round((minute / 1440) * 1000000) / 10000
        return React.createElement('div', { 'data-testid': 'quota-peak-timeline', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', minHeight: '16px' } },
            React.createElement('span', {
              'data-testid': 'quota-peak-state',
              'data-in-peak': String(inPeak),
              // nowrap + flexShrink:0：容器过窄时整块折行，绝不把文字挤成一列竖排（用户点名）。
              style: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', lineHeight: '16px', color: accentColor, whiteSpace: 'nowrap', flexShrink: 0 },
            },
            React.createElement('span', { style: { width: '7px', height: '7px', ...fullRound('50%'), background: accentColor, flexShrink: 0 } }),
            stateLabel),
            nextFlip !== null ? React.createElement('span', {
              'data-testid': 'quota-peak-next',
              style: { marginLeft: 'auto', fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap' },
            }, translate(inPeak ? 'quota.peak.untilIdle' : 'quota.peak.untilPeak', {
              time: formatBeijingClockTime(nextFlip),
              dur: humanizeDuration(nextFlip - now, translate),
            })) : null),
          React.createElement('div', {
            'data-testid': 'quota-peak-bar',
            style: { position: 'relative', height: '14px', ...fullRound(999), overflow: 'hidden', background: 'var(--dsw-alias-interactive-bg-hover)' },
          },
          // 两段式（用户点名）：第一段 = 当前时段剩余，第二段 = 下一个相反时段（可跨天），
          // 宽度按实际时长比例；段内只标「忙时/闲时」，过窄自动隐藏（精确时刻在倒计时与说明行）。
          (flips.length > 0 ? [
            { peak: inPeak, weight: flips[0] - now },
            ...(flips.length > 1 ? [{ peak: !inPeak, weight: flips[1] - flips[0] }] : []),
          ] : [{ peak: inPeak, weight: 1 }]).map((segment, index, all) => {
            const totalWeight = all.reduce((sum, part) => sum + part.weight, 0)
            const widthPct = pctOf(segment.weight / totalWeight * 1440)
            return React.createElement('span', {
              key: index,
              'data-testid': `quota-peak-segment-${index}`,
              'data-peak': String(segment.peak),
              style: { position: 'absolute', top: 0, bottom: 0, left: `${index === 0 ? 0 : pctOf(all[0].weight / totalWeight * 1440)}%`, width: `${widthPct}%`, background: segment.peak ? QUOTA_PEAK_COLOR : QUOTA_PEAK_IDLE_COLOR, overflow: 'hidden' },
            },
            widthPct >= 11 ? React.createElement('span', { style: { position: 'absolute', inset: 0, textAlign: 'center', fontSize: '9px', lineHeight: '14px', fontWeight: 500, color: 'rgba(255,255,255,0.95)' } }, translate(segment.peak ? 'quota.peak.tag.peak' : 'quota.peak.tag.idle')) : null)
          }),
          // 左缘细标线即「当前」时刻（原移动圆点在 now 起点域下恒在左缘，退化为标线）。
          React.createElement('span', {
            'data-testid': 'quota-peak-now',
            style: { position: 'absolute', top: 0, bottom: 0, left: 0, width: '3px', borderRadius: '3px', background: 'var(--dsw-specific-menu)' },
          })),
          showCaption === true ? React.createElement('div', {
            'data-testid': 'quota-peak-caption',
            style: { fontSize: '11px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px' },
          }, translate(schedule.captionKey)) : null,
          showCaption === true && degraded ? React.createElement('div', {
            'data-testid': 'quota-peak-caption-degraded',
            style: { fontSize: '11px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px' },
          }, translate('quota.peak.caption.degraded', { year: holidayDateKey.slice(0, 4) })) : null)
      }

      /**
       * 手录重置卡的到期时刻（毫秒）：与宿主 `resetCardExpiryMs` 同口径——
       * 带时刻的串按真实时刻；纯日期（`YYYY-MM-DD`）顺延到当日 23:59:59.999（当天仍有效）；
       * 缺失/无法解析 → null（永不过期）。
       */
      function resetCardExpiryMs(expiresAt) {
        if (typeof expiresAt !== 'string') return null
        const raw = expiresAt.trim()
        if (raw === '') return null
        // 纯日期必须取浏览器本地日末，不能用 UTC 零点加 24h（DST 日可能只有 23/25 小时）。
        const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999` : raw)
        return Number.isFinite(parsed) ? parsed : null
      }

      /** 手录重置卡的统一文案与过期态：卡片行与圆环面板共用。v0.20 起免次数。 */
      function resetCardContent(card, translate) {
        const rawExpiry = typeof card.expiresAt === 'string' && card.expiresAt.trim() !== '' ? card.expiresAt.trim() : ''
        const at = resetCardExpiryMs(rawExpiry)
        const expired = at !== null && at < Date.now()
        let expiryPart = ''
        if (rawExpiry !== '') {
          let shown = rawExpiry
          if (at !== null) {
            shown = rawExpiry.length > 10 ? `${formatShortDate(at)} ${formatClockTime(at)}` : formatShortDate(at)
            shown = expired
              ? `${shown} ${translate('quota.resetCard.expired')}`
              : translate('quota.resetCard.expires', { date: shown })
          }
          expiryPart = shown
        }
        const labelSuffix = typeof card.label === 'string' && card.label !== '' ? ` · ${card.label}` : ''
        return {
          expired,
          title: `${translate('quota.resetCard.title')}${labelSuffix}`,
          expiry: expiryPart,
          // 重置卡是「类别」不是「状态」：图标染成绿色提示这是重置卡（视觉锚点），
          // 文字保持中性可读；过期时图标随行文字一起转警示色。用令牌而非硬编码绿色，
          // 深色模式自动跟随。
          iconColor: expired ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)',
          textColor: expired ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)',
        }
      }
      /**
       * 重置卡排序：**最近要到期的排最前**。未过期且能解析出时刻的按升序在前；
       * 已过期 / 无到期时刻的排到末尾（各自内部保持原序，稳定）。「只显示最近一张」即取首个。
       */
      function orderResetCardsByNearest(resetCards, now = Date.now()) {
        const list = Array.isArray(resetCards) ? resetCards : []
        return list
          .map((card, index) => {
            const at = resetCardExpiryMs(card?.expiresAt)
            return { card, index, key: at !== null && at >= now ? at : Number.POSITIVE_INFINITY }
          })
          .sort((a, b) => (a.key - b.key) || (a.index - b.index))
          .map((entry) => entry.card)
      }

      /**
       * 重置卡按账号归组（两处面板共用）：provider 级（无 account）归一组，账号级各归一组。
       * 组序：provider 级在前，账号按首次出现序。组内按「最近要到期」排序。
       */
      function groupResetCards(resetCards, now = Date.now()) {
        if (!Array.isArray(resetCards) || resetCards.length === 0) return []
        const groups = []
        const indexByKey = new Map()
        for (const card of resetCards) {
          const account = typeof card?.account === 'string' ? card.account.trim() : ''
          const key = account === '' ? '\u0000provider' : account
          let slot = indexByKey.get(key)
          if (slot === undefined) {
            slot = groups.length
            indexByKey.set(key, slot)
            groups.push({ account, cards: [] })
          }
          groups[slot].cards.push(card)
        }
        for (const group of groups) group.cards = orderResetCardsByNearest(group.cards, now)
        return groups
      }

      function quotaErrorMessage(code, translate) {
        const key = `quota.error.${code}`
        const text = translate(key)
        return text === key ? translate('quota.error.unknown') : text
      }
      /**
       * 统一错误行（v1.5.2）：稳定错误码查词典取主文案，`http-status:401` 这类后缀状态码、
       * 宿主下发的渠道事实（多候选链的失败端点 / CPA 的失败账号）与上游原话统一按
       * 「主文案 (HTTP 401 · api.z.ai · 账号 · 上游原话)」拼装，末尾附自动重试时刻。
       * 额度卡与圆环面板共用这一处，渠道之间不再各写一套提示。
       */
      function quotaErrorLine(row, translate) {
        const code = typeof row?.errorCode === 'string' ? row.errorCode : ''
        const colon = code.indexOf(':')
        const family = colon === -1 ? code : code.slice(0, colon)
        const status = colon === -1 ? '' : code.slice(colon + 1)
        const facts = [
          /^\d{3}$/.test(status) ? `HTTP ${status}` : undefined,
          typeof row?.errorEndpoint === 'string' && row.errorEndpoint !== '' ? row.errorEndpoint : undefined,
          typeof row?.errorAccount === 'string' && row.errorAccount !== '' ? row.errorAccount : undefined,
          typeof row?.errorDetail === 'string' && row.errorDetail !== '' ? row.errorDetail : undefined,
        ].filter((part) => part !== undefined)
        const retrySuffix = typeof row?.nextAllowedAt === 'number' && row.nextAllowedAt > Date.now()
          ? ` · ${translate('quota.retryAt', { time: formatClockTime(row.nextAllowedAt) })}`
          : ''
        return `${quotaErrorMessage(family, translate)}${facts.length > 0 ? ` (${facts.join(' · ')})` : ''}${retrySuffix}`
      }
      /** 弹窗/卡片共用的横向进度条。默认已用口径（≥80% 警黄）；remaining 口径数值即剩余%，≤20% 才警黄。 */
      function quotaBar(testId, percent, height, remainingBasis) {
        const warning = remainingBasis === true ? percent <= 20 : percent >= 80
        return React.createElement('div', {
          'data-testid': testId,
          style: { height, ...fullRound(999), background: 'var(--dsw-alias-interactive-bg-hover)', overflow: 'hidden' },
        },
        React.createElement('div', {
          style: { height: '100%', width: `${Math.max(0, Math.min(100, percent))}%`, ...fullRound(999), background: warning ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)' },
        }))
      }
      /** 窗口行的统一渲染，圆环面板与额度卡共用（此前两处各写一份，配色/倒计时格式容易漂移）：
       * 百分比窗口三段式（标签+百分比 / 独立进度条 / 重置倒计时单独一行）；文本窗口（余额类）单行。
       * testid 约定：面板 quota-text|quota-window-bar|quota-reset-<id>；卡片 quota-card-window|bar|text|reset-<provider>-<id>。 */
      function renderQuotaWindowRow(window, translate, provider) {
        const inCard = provider !== null && provider !== undefined
        // 标签可能很长（cliproxy 是「账号 · 窗口名」两段式）：标签溢出省略，百分比整体不换行、不被挤压。
        const labelText = quotaWindowDisplayLabel(window, translate)
        const labelStyle = { color: 'var(--dsw-alias-label-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
        const valueStyle = { color: 'var(--dsw-alias-label-primary)', fontWeight: 500, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flexShrink: 0 }
        // 重置倒计时（两种窗口共用）：文本窗也可能是周期性的（如订阅套餐的计费周期结束），
        // 早退会让 resetsAt 静默丢失，故与百分比窗走同一段渲染。
        let resetNode = null
        if (typeof window.resetsAt === 'string') {
          const at = Date.parse(window.resetsAt)
          if (Number.isFinite(at) && at > Date.now()) {
            resetNode = React.createElement('div', {
              'data-testid': inCard ? `quota-card-reset-${provider}-${window.id}` : `quota-reset-${window.id}`,
              style: { fontSize: '11px', lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
            }, translate('quota.resetIn', { time: humanizeDuration(at - Date.now(), translate) }))
          }
        }
        if (typeof window.text === 'string') {
          return React.createElement('div', {
            key: window.id,
            ...(inCard ? { 'data-testid': `quota-card-window-${provider}-${window.id}` } : {}),
          },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' } },
            React.createElement('span', { style: labelStyle, title: labelText }, labelText),
            React.createElement('span', {
              'data-testid': inCard ? `quota-card-text-${provider}-${window.id}` : `quota-text-${window.id}`,
              style: valueStyle,
            }, window.text)),
          resetNode)
        }
        return React.createElement('div', {
          key: window.id,
          ...(inCard ? { 'data-testid': `quota-card-window-${provider}-${window.id}` } : {}),
        },
        React.createElement('div', { 'data-value': window.percent, style: { display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', lineHeight: '18px' } },
          React.createElement('span', { style: labelStyle, title: labelText }, labelText),
          // stale（v1.3.1）：cliproxy 实时 api-call 失败时回退的 auth-files 快照窗口，宿主打标——
          // 没有徽标时缓存值与实时值在面板上不可区分，正是「额度一直停在昨天」观感的来源。
          React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 } },
            React.createElement('span', { style: valueStyle }, quotaWindowValueText(window)),
            window.stale === true
              ? React.createElement('span', {
                  'data-testid': inCard ? `quota-card-stale-${provider}-${window.id}` : `quota-stale-${window.id}`,
                  title: translate('quota.window.staleTip'),
                  style: svcBadgeStyle('warning', { padding: '1px 7px', flexShrink: 0 }),
                }, translate('quota.window.stale'))
              : null)),
        quotaBar(inCard ? `quota-card-bar-${provider}-${window.id}` : `quota-window-bar-${window.id}`, window.percent, '4px', window.remaining === true),
        resetNode)
      }

      // v0.21.1 圆环弹窗窄视口居中：宿主事实（别再翻外壳源码）——composer 工具行容器带
      // container-type:inline-size（布局包含：fixed 后代的 containing block 是它而非视口），
      // 外层会话滚动体又是 overflow:hidden auto，挂在 conversation.input.right 的弹层在手机上
      // 必然被裁一半，CSS 覆盖救不了。唯一可靠解法是 portal 到 document.body 后 fixed 视口居中。
      // react-dom 在平台 seed 表内（官方附件插件同源用 createPortal），老外壳可能缺席：
      // 惰性尝试，拿不到就回落原锚定弹层（与 modelDirectories 同款可选依赖哲学）。
      let quotaCreatePortal = null
      try {
        const reactDom = require('react-dom')
        if (reactDom !== null && reactDom !== undefined && typeof reactDom.createPortal === 'function') {
          quotaCreatePortal = reactDom.createPortal
        }
      } catch (_) {
        quotaCreatePortal = null
      }

      /** 移动视口判定：与 v0.30 整体适配共用 1023px 断点；matchMedia 优先，
       * 缺席时 innerWidth 兜底。无 window（SSR/测试）一律宽视口，维持圆环上方锚定。 */
      function quotaNarrowViewport() {
        if (typeof window === 'undefined' || window === null) return false
        if (typeof window.matchMedia === 'function') {
          const query = window.matchMedia('(max-width: 1023px)')
          return typeof query.matches === 'boolean' ? query.matches : false
        }
        return typeof window.innerWidth === 'number' && window.innerWidth <= 1023
      }

      /** 从模型名称推断上游产品家族（CPA 多账号适配路由）：
       * - claude / gpt-oss -> 'claude'
       * - gemini -> 'gemini'
       * - codex / gpt / chatgpt / o1 / o3 -> 'codex' */
      function inferModelFamily(modelId) {
        if (typeof modelId !== 'string' || modelId.trim() === '') return null
        const m = modelId.trim().toLowerCase()
        if (m.includes('claude') || m.includes('gpt-oss')) return 'claude'
        if (m.includes('gemini')) return 'gemini'
        if (m.includes('codex') || m.includes('gpt') || m.includes('chatgpt') || /(?:^|[-_/])o[134](?:[-_/]|$)/.test(m)) return 'codex'
        return null
      }

      const CPA_FAMILIES = ['gemini', 'claude', 'codex']

      function windowFamily(window) {
        const key = String(window?.kindKey ? window.kindKey : (window?.id ?? '')).toLowerCase()
        if (key.includes('gemini')) return 'gemini'
        if (key.includes('claude') || key.includes('gpt-oss')) return 'claude'
        if (key.includes('codex') || key.includes('chatgpt')) return 'codex'
        return 'other'
      }

      function windowMatchesFamily(window, family) {
        if (!family) return true
        return windowFamily(window) === family
      }

      function groupWindowsByFamily(windows) {
        const map = new Map()
        for (const w of windows) {
          const fam = windowFamily(w)
          const list = map.get(fam) || []
          list.push(w)
          map.set(fam, list)
        }
        const groups = []
        for (const fam of [...CPA_FAMILIES, 'other']) {
          const list = map.get(fam)
          if (list && list.length > 0) {
            groups.push({ family: fam, windows: list })
          }
        }
        return groups
      }

      // ─── 大号精细带指针油表（展开面板用，#todo-77）─────────────────
      function QuotaBigFuelGauge(props) {
        const { balanceInfo, gaugeState, onCalibrate, translate } = props
        const [hoverCalibrate, setHoverCalibrate] = useState(false)
        const angle = gaugeState.needleAngle
        const symbol = balanceInfo.symbol
        const baselineText = `${symbol}${gaugeState.baseline.toFixed(2)}`
        const balanceText = balanceInfo.rawText

        return React.createElement('div', {
          'data-testid': 'quota-big-fuel-gauge',
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: '8px',
            marginBottom: '8px',
            padding: '10px 4px 8px',
            borderRadius: '10px',
            background: 'var(--dsw-alias-surface-l1, rgba(127, 127, 127, 0.05))',
            border: '1px solid var(--dsw-alias-border-l1, rgba(127, 127, 127, 0.1))',
          },
        },
          React.createElement('svg', {
            viewBox: '0 0 180 96',
            width: '180',
            height: '96',
            style: { overflow: 'visible', display: 'block' },
            'aria-hidden': true,
          },
            // 底轨（全段背景）
            React.createElement('path', {
              d: 'M 25 82 A 65 65 0 0 1 155 82',
              fill: 'none',
              stroke: 'var(--dsw-alias-border-l2)',
              strokeWidth: '7',
              strokeLinecap: 'round',
            }),
            // 红色区段 (0% ~ 20%): 180° 到 144°
            React.createElement('path', {
              d: 'M 25 82 A 65 65 0 0 1 37.4 43.8',
              fill: 'none',
              stroke: 'var(--dsw-alias-state-error-primary)',
              strokeWidth: '7',
              strokeLinecap: 'round',
            }),
            // 黄色区段 (20% ~ 50%): 144° 到 90°
            React.createElement('path', {
              d: 'M 37.4 43.8 A 65 65 0 0 1 90 17',
              fill: 'none',
              stroke: 'var(--dsw-alias-state-warn-primary)',
              strokeWidth: '7',
            }),
            // 绿色区段 (50% ~ 100%): 90° 到 0°
            React.createElement('path', {
              d: 'M 90 17 A 65 65 0 0 1 155 82',
              fill: 'none',
              stroke: 'var(--dsw-alias-state-success-primary)',
              strokeWidth: '7',
              strokeLinecap: 'round',
            }),
            // E 标
            React.createElement('text', {
              x: '18',
              y: '86',
              fontSize: '11',
              fontWeight: '700',
              fill: 'var(--dsw-alias-state-error-primary)',
              textAnchor: 'end',
            }, 'E'),
            // F 标
            React.createElement('text', {
              x: '162',
              y: '86',
              fontSize: '11',
              fontWeight: '700',
              fill: 'var(--dsw-alias-state-success-primary)',
              textAnchor: 'start',
            }, 'F'),
            // 50% 顶部中点刻度线
            React.createElement('line', {
              x1: '90', y1: '17', x2: '90', y2: '23',
              stroke: 'var(--dsw-specific-menu)', strokeWidth: '1.5',
            }),
            // 轴心底座
            React.createElement('circle', {
              cx: '90',
              cy: '82',
              r: '7',
              fill: 'var(--dsw-alias-label-secondary)',
            }),
            // 指针组（以 90px 82px 为中心平滑旋转）
            React.createElement('g', {
              style: {
                transformOrigin: '90px 82px',
                transform: `rotate(${angle}deg)`,
                transition: 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)',
              },
            },
              React.createElement('line', {
                x1: '90',
                y1: '82',
                x2: '90',
                y2: '26',
                stroke: 'var(--dsw-alias-label-primary)',
                strokeWidth: '2.4',
                strokeLinecap: 'round',
              }),
              React.createElement('circle', {
                cx: '90',
                cy: '27',
                r: '1.8',
                fill: gaugeState.color,
              })
            ),
            // 轴心中心圆点
            React.createElement('circle', {
              cx: '90',
              cy: '82',
              r: '3.5',
              fill: 'var(--dsw-specific-menu)',
            })
          ),
          // 数值与满额基准
          React.createElement('div', {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginTop: '-6px',
              gap: '2px',
            },
          },
            React.createElement('div', {
              'data-testid': 'quota-gauge-balance-text',
              style: {
                fontSize: '20px',
                fontWeight: 700,
                color: 'var(--dsw-alias-label-primary)',
                lineHeight: '26px',
              },
            }, balanceText),
            React.createElement('div', {
              style: {
                fontSize: '11px',
                color: gaugeState.color,
                fontWeight: 600,
              },
            }, translate('quota.gauge.ratio', { percent: gaugeState.ratio })),
            React.createElement('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '4px',
                fontSize: '11px',
                color: 'var(--dsw-alias-label-tertiary)',
              },
            },
              React.createElement('span', null, `${translate('quota.gauge.baseline')}: ${baselineText}`),
              React.createElement('button', {
                type: 'button',
                'data-testid': 'quota-gauge-calibrate-btn',
                title: translate('quota.gauge.calibrateTip', { amount: balanceText }),
                onClick: onCalibrate,
                onMouseEnter: () => setHoverCalibrate(true),
                onMouseLeave: () => setHoverCalibrate(false),
                style: {
                  background: 'none',
                  border: 'none',
                  padding: '1px 4px',
                  fontSize: '11px',
                  color: 'var(--dsw-alias-brand-primary)',
                  cursor: 'pointer',
                  textDecoration: hoverCalibrate ? 'underline' : 'none',
                },
              }, `[${translate('quota.gauge.calibrate')}]`)
            )
          )
        )
      }

      function QuotaRing(props) {
        const translate = useTranslation()
        const [quota, setQuota] = useState(quotaStore.getSnapshot())
        useEffect(() => quotaStore.subscribe(() => setQuota(quotaStore.getSnapshot())), [])
        // 重置卡分区的展开态（v1.9.1）：默认收起，只显示每个账号最近要到期的那张。
        // 键为 `panel:<组序>`，与额度页管理列表的展开态互不影响。
        const [expandedResetGroups, setExpandedResetGroups] = useState(new Set())
        const toggleResetGroup = (key) => setExpandedResetGroups((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
        // CPA 重置卡分区整体默认折叠：卡是手录的次要信息，弹窗里只留一行标题，
        // 点开标题才显示账号分组内容（非 CPA 行无标题，不折叠）。
        const [panelResetOpen, setPanelResetOpen] = useState(false)
        // 自愈（v1.1.2）：真实渲染器把 inject 产物按 (entry,binding) 缓存——刷新/首进
        // 旧会话时 directoryFor 可能因会话作用域尚未热身抛错，空 props 被缓存后圆环静默。
        // 注入失败也携带 sessionId；store 缺席时组件内按 ctx.timer 退避重试解析目录，
        // 成功即接管后续 effect（成功路径零变化，失败路径最多 7 次 ≈30s 后放弃）。
        const propsStore = props && props.directoryStore
        const sessionId = props && typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined
        const [retriedStore, setRetriedStore] = useState(null)
        const store = propsStore !== undefined && propsStore !== null ? propsStore : retriedStore
        useEffect(() => {
          if (propsStore !== undefined && propsStore !== null) return undefined
          if (sessionId === undefined) return undefined
          let stopped = false
          let dispose = null
          const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 15000]
          const attempt = (round) => {
            if (stopped) return
            let models = null
            try {
              models = getModelDirectories()
            } catch (_) {
              models = null
            }
            // 服务彻底缺席（老版本 DSH）是永久条件：不重试、不挂定时器。
            if (models === undefined || models === null || typeof models.directoryFor !== 'function') return
            let next = null
            try {
              next = models.directoryFor(sessionId)
            } catch (_) {
              next = null
            }
            if (next !== null && next !== undefined && next.store !== undefined && next.store !== null) {
              setRetriedStore(next.store)
              try {
                const pending = next.load()
                if (pending && typeof pending.catch === 'function') pending.catch(() => {})
              } catch (_) {}
              return
            }
            if (round >= RETRY_DELAYS_MS.length) return
            dispose = ctx.timer.timeout(() => { dispose = null; attempt(round + 1) }, RETRY_DELAYS_MS[round])
          }
          attempt(0)
          return () => { stopped = true; if (dispose !== null) dispose() }
        }, [propsStore, sessionId])
        useEffect(() => {
          // 无 modelDirectories 服务（或条目 props 为空）：不启动轮询、不发 RPC、不渲染内容。
          if (!store) return undefined
          acquireQuotaLoop()
          return releaseQuotaLoop
        }, [store])
        const [directoryState, setDirectoryState] = useState(store ? store.getSnapshot() : null)
        useEffect(() => {
          if (!store) return undefined
          setDirectoryState(store.getSnapshot())
          return store.subscribe(() => setDirectoryState(store.getSnapshot()))
        }, [store])
        useEffect(() => {
          if (store && (directoryState === null || directoryState?.current == null) && props && typeof props.loadDirectory === 'function') props.loadDirectory()
        }, [store, directoryState, props && props.loadDirectory])
        const [open, setOpen] = useState(false)
        const rootRef = useRef(null)
        const panelRef = useRef(null)
        // 移动视口：弹层 portal 到 body，在对话区域下半部保持水平居中；宽视口保持圆环上方锚定。
        // matchMedia change 订阅让旋转/拖宽窗口时弹层几何实时迁移，open 态不丢。
        const [narrow, setNarrow] = useState(quotaNarrowViewport)
        useEffect(() => {
          if (typeof window === 'undefined' || window === null || typeof window.matchMedia !== 'function') return undefined
          const query = window.matchMedia('(max-width: 1023px)')
          const sync = () => setNarrow(query.matches)
          sync()
          if (typeof query.addEventListener === 'function') query.addEventListener('change', sync)
          else if (typeof query.addListener === 'function') query.addListener(sync)
          return () => {
            if (typeof query.removeEventListener === 'function') query.removeEventListener('change', sync)
            else if (typeof query.removeListener === 'function') query.removeListener(sync)
          }
        }, [])
        const [showAll, setShowAll] = useState(false)
        const provider = directoryState?.current?.provider ?? null
        const currentModel = directoryState?.current?.model ?? null
        const row = provider !== null ? (quota.providers || []).find((entry) => entry.provider === provider && entry.adapted === true) : null
        const allWindows = Array.isArray(row?.windows) ? row.windows : []

        // 当提供方是 cliproxy (CPA) 时，根据当前会话模型推断上游（Claude / Gemini / Codex）
        const family = row?.kind === 'cliproxy' ? inferModelFamily(currentModel) : null
        const familyLabel = family === 'claude' ? 'Claude' : family === 'gemini' ? 'Gemini' : family === 'codex' ? 'Codex' : null
        const matchedWindows = family !== null ? allWindows.filter((w) => windowMatchesFamily(w, family)) : allWindows
        const activeWindows = (matchedWindows.length > 0 && !showAll) ? matchedWindows : allWindows

        const percentWindows = (matchedWindows.length > 0 ? matchedWindows : allWindows).filter((window) => typeof window.percent === 'number')
        // 最紧约束：已用口径取最高占用；剩余口径取最低余量。两种口径并存时按压力值（贴近耗尽程度）比较。
        const pressureOf = (window) => (window.remaining === true ? 100 - window.percent : window.percent)
        const tightest = percentWindows.length > 0 ? percentWindows.reduce((best, current) => (pressureOf(current) > pressureOf(best) ? current : best), percentWindows[0]) : null

        // 余额型渠道判定（v1.9.1+ #todo-77）：无百分比窗口，但包含数字金额文本窗口
        const balanceInfo = tightest === null ? quotaExtractBalance(activeWindows) : null
        const isBalanceMode = balanceInfo !== null
        // 校准只落持久基准并触发重渲染；后续渲染一律走 resolveBalanceBaseline——
        // 规格参数 2 的充值检测无条件生效，不能被内存值短路冻结（校准后充值仍会抬基准）。
        const [, bumpCalibration] = useState(0)
        const currentBaseline = isBalanceMode
          ? resolveBalanceBaseline(provider, balanceInfo.amount, balanceInfo.currency)
          : 0
        const gaugeState = isBalanceMode
          ? computeBalanceGaugeState(balanceInfo.amount, currentBaseline, balanceInfo.currency)
          : null
        const handleCalibrate = () => {
          if (!isBalanceMode || !provider || !balanceInfo) return
          if (setManualBalanceBaseline(provider, balanceInfo.amount, balanceInfo.currency) !== null) bumpCalibration((tick) => tick + 1)
        }

        useEffect(() => {
          setShowAll(false)
        }, [provider, currentModel, open])

        // 切换会话/模型后，若目标 provider 有适配行但尚无数据（重启后首拉缺失等），
        // 主动补一次快照请求（宿主节流兜底）；Set 防抖避免发布→重渲染死循环。
        const quotaRefetchRequested = useRef(new Set())
        useEffect(() => {
          if (provider === null) return
          const matchedRow = (quota.providers || []).find((entry) => entry.provider === provider && entry.adapted === true)
          const needsData = matchedRow === undefined || (Array.isArray(matchedRow.windows) === false && matchedRow.refreshing !== true && matchedRow.errorCode === undefined)
          if (needsData && !quotaRefetchRequested.current.has(provider)) {
            quotaRefetchRequested.current.add(provider)
            fetchQuotaSnapshot({ providers: [provider] })
          }
        }, [provider, quota])
        useEffect(() => {
          if (!open || typeof document === 'undefined') return undefined
          const onPointerDown = (event) => {
            if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return
            // portal 模式下面板挂在 body 下、不在 rootRef 子树内：点面板本体不算外点。
            if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) return
            setOpen(false)
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          document.addEventListener('pointerdown', onPointerDown)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [open])
        // 面板挂载几何：移动视口 portal 到 document.body 后 fixed，以底部为基准向上展开
        // （水平居中、下边缘锁定在触发区上方）；宽视口或 react-dom 缺席时锚定圆环上方。
        // 这两个 hook 必须在下面的 row 空判提前返回之前声明：组件「目录未就绪（返回 null）
        // → 数据落地同挂载重渲染」时 hook 数必须恒定，否则真实 React 抛
        // “Rendered more hooks than during the previous render”，圆环被槽位错误边界吞掉，
        // 表现为「切换模型（重挂载）后圆环才出现」。
        const centered = open && narrow && quotaCreatePortal !== null
          && typeof document !== 'undefined' && document.body !== null && document.body !== undefined
        const [bottomOffset, setBottomOffset] = useState(null)
        useEffect(() => {
          if (!open || !centered) return undefined
          const updatePos = () => {
            if (rootRef.current && typeof rootRef.current.getBoundingClientRect === 'function' && typeof window !== 'undefined') {
              try {
                const rect = rootRef.current.getBoundingClientRect()
                if (rect && typeof rect.top === 'number' && Number.isFinite(rect.top)) {
                  setBottomOffset(Math.max(16, Math.round(window.innerHeight - rect.top + 8)))
                }
              } catch (_) {}
            }
          }
          updatePos()
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('resize', updatePos)
            window.addEventListener('scroll', updatePos, true)
          }
          return () => {
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
              window.removeEventListener('resize', updatePos)
              window.removeEventListener('scroll', updatePos, true)
            }
          }
        }, [open, centered])
        if (row === undefined || row === null) return null
        const percent = tightest === null ? 0 : tightest.percent
        // 纯文本窗口（余额类：DeepSeek/Kimi/硅基流动）没有百分比可「已用」，头部按剩余口径显示；
        // 百分比窗口仍按方言的 remaining 标记切换已用/剩余。
        const hasPercentWindow = tightest !== null
        const remainingBasis = !hasPercentWindow || tightest.remaining === true
        const usedWord = remainingBasis ? translate('quota.panel.remaining') : translate('quota.panel.used')
        const color = isBalanceMode
          ? gaugeState.color
          : ((remainingBasis ? percent <= 20 : percent >= 80) ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)')
        const radius = 5.5
        const circumference = 2 * Math.PI * radius
        const providerDisplayName = row?.displayName || provider
        const providerTag = familyLabel ? `${providerDisplayName} · ${familyLabel}` : providerDisplayName
        const ariaText = hasPercentWindow
          ? `${translate('quota.ring.label')} · ${providerTag} · ${usedWord} ${percent}%`
          : `${translate('quota.ring.label')} · ${providerTag}`
        const errorNode = row.errorCode !== undefined
          ? React.createElement('div', { style: { marginTop: '8px', fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary)' } },
              quotaErrorLine(row, translate))
          : null
        const updatedNode = row.refreshing === true || typeof row.fetchedAt === 'number'
          ? React.createElement('div', { style: { marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
              row.refreshing === true ? translate('quota.refreshing') : translate('quota.updated', { time: formatClockTime(row.fetchedAt) }))
          : null
        // 面板先构造、再决定挂载方式（centered/bottomOffset 的 hook 声明在 row 空判之前）：
        // 移动视口 portal 到 document.body 后 fixed；宽视口或 react-dom 缺席时锚定圆环上方。
        const panelPeakSchedule = quotaPeakScheduleFor(row, allWindows)
        const triggerNode = React.createElement('button', {
            type: 'button',
            'data-testid': 'quota-ring-trigger',
            'aria-label': ariaText,
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            title: ariaText,
            onClick: () => {
              // 只在打开时补拉快照；关闭面板的那次请求没有意义（宿主闸门本就会兜住）。
              const next = !open
              if (next && rootRef.current && typeof rootRef.current.getBoundingClientRect === 'function' && typeof window !== 'undefined') {
                try {
                  const rect = rootRef.current.getBoundingClientRect()
                  if (rect && typeof rect.top === 'number' && Number.isFinite(rect.top)) {
                    setBottomOffset(Math.max(16, Math.round(window.innerHeight - rect.top + 8)))
                  }
                } catch (_) {}
              }
              setOpen(next)
              if (next) fetchQuotaSnapshot({ providers: provider === null ? [] : [provider] })
            },
            style: { width: '28px', height: '28px', border: 'none', ...fullRound('999px'), background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0, color: 'var(--dsw-alias-label-secondary)' },
          },
          isBalanceMode
            ? React.createElement('svg', { viewBox: '0 0 20 20', width: '17', height: '17', 'aria-hidden': true, style: { display: 'block' } },
                React.createElement('path', {
                  d: 'M 3.8 15 A 7.5 7.5 0 1 1 16.2 15',
                  fill: 'none',
                  stroke: 'var(--dsw-alias-border-l3)',
                  strokeWidth: '2.2',
                  strokeLinecap: 'round',
                }),
                React.createElement('path', {
                  d: gaugeState.gear === 'high'
                    ? 'M 3.8 15 A 7.5 7.5 0 1 1 16.2 15'
                    : gaugeState.gear === 'mid'
                    ? 'M 3.8 15 A 7.5 7.5 0 0 1 10 3.0'
                    : 'M 3.8 15 A 7.5 7.5 0 0 1 2.6 9.2',
                  fill: 'none',
                  stroke: gaugeState.color,
                  strokeWidth: '2.2',
                  strokeLinecap: 'round',
                }),
                React.createElement('circle', {
                  cx: '10',
                  cy: '10.5',
                  r: '2.0',
                  fill: gaugeState.color,
                }),
                React.createElement('line', {
                  x1: '10',
                  y1: '10.5',
                  x2: gaugeState.gear === 'high' ? '13.9' : gaugeState.gear === 'mid' ? '10' : '6.1',
                  y2: gaugeState.gear === 'high' ? '8.25' : gaugeState.gear === 'mid' ? '5.5' : '12.8',
                  stroke: gaugeState.color,
                  strokeWidth: '2.0',
                  strokeLinecap: 'round',
                }))
            : React.createElement('svg', { viewBox: '0 0 14 14', width: '14', height: '14', 'aria-hidden': true },
                React.createElement('circle', { cx: '7', cy: '7', r: radius, fill: 'none', stroke: 'var(--dsw-alias-border-l3)', strokeWidth: '2' }),
                React.createElement('circle', {
                  cx: '7', cy: '7', r: radius, fill: 'none', stroke: color, strokeWidth: '2', strokeLinecap: 'round',
                  strokeDasharray: `${(circumference * percent) / 100} ${circumference}`,
                  transform: 'rotate(-90 7 7)',
                })))
        const panelNode = open ? React.createElement('div', {
          ref: panelRef,
          role: 'dialog',
          'aria-label': translate('quota.panel.title'),
          'data-testid': 'quota-ring-panel',
          style: centered
            ? { position: 'fixed', left: '50%', bottom: (bottomOffset !== null ? bottomOffset : 80) + 'px', transform: 'translateX(-50%)', zIndex: 1000, boxSizing: 'border-box', width: 'min(280px, calc(100vw - 32px))', maxHeight: `min(560px, calc(100dvh - ${(bottomOffset !== null ? bottomOffset : 80) + 16}px))`, overflowY: 'auto', padding: '12px', borderRadius: '12px', background: 'var(--dsw-specific-menu)', border: '1px solid var(--dsw-alias-border-inverted)', boxShadow: 'var(--dsw-shadow-lv3)' }
            : { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 100, boxSizing: 'border-box', width: 'max-content', minWidth: '240px', maxWidth: 'min(480px, calc(100vw - 32px))', padding: '12px', borderRadius: '12px', background: 'var(--dsw-specific-menu)', border: '1px solid var(--dsw-alias-border-inverted)', boxShadow: 'var(--dsw-shadow-lv3)' },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
            React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, usedWord),
            React.createElement('span', { style: { marginLeft: 'auto', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, providerTag)),
          ...(isBalanceMode
            ? [React.createElement(QuotaBigFuelGauge, {
                key: 'panel-big-fuel-gauge',
                balanceInfo,
                gaugeState,
                onCalibrate: handleCalibrate,
                translate,
              })]
            : []),
          React.createElement('div', { style: { marginTop: isBalanceMode ? '4px' : '10px', display: 'flex', flexDirection: 'column', gap: '8px' } },
            (() => {
              const ringGroups = (row?.kind === 'cliproxy' && (showAll || family === null)) ? groupWindowsByFamily(activeWindows) : null
              if (ringGroups && ringGroups.length > 1) {
                return ringGroups.map((group, groupIndex) => React.createElement('div', {
                  key: `ring-family-${group.family}`,
                  'data-testid': `quota-ring-family-${group.family}`,
                  style: {
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    marginTop: groupIndex === 0 ? '0' : '4px',
                    paddingTop: groupIndex === 0 ? '0' : '8px',
                    borderTop: groupIndex === 0 ? 'none' : '1px solid var(--dsw-alias-border-l1)',
                  },
                },
                  React.createElement('div', {
                    'data-testid': `quota-ring-family-title-${group.family}`,
                    style: {
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--dsw-alias-label-secondary)',
                    },
                  }, translate('quota.family.' + group.family)),
                  group.windows.map((window) => renderQuotaWindowRow(window, translate, null))
                ))
              }
              return activeWindows.map((window) => renderQuotaWindowRow(window, translate, null))
            })()),
          allWindows.length > matchedWindows.length && matchedWindows.length > 0
            ? React.createElement('div', { style: { marginTop: '6px', textAlign: 'center' } },
                React.createElement('button', {
                  type: 'button',
                  'data-testid': 'quota-ring-toggle-all',
                  onClick: () => setShowAll(!showAll),
                  style: {
                    fontSize: '11px',
                    color: 'var(--dsw-alias-brand-primary)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px 6px',
                    textDecoration: 'underline',
                  },
                }, showAll ? translate('quota.filter.currentOnly') : translate('quota.filter.showAll', { count: allWindows.length })))
            : null,
          ...(panelPeakSchedule !== null
            ? [React.createElement(QuotaPeakTimeline, { key: 'panel-peak-timeline', showCaption: false, schedule: panelPeakSchedule })]
            : []),
          ...(() => {
            // 重置卡分区（弹窗）：按账号独立展示，**每账号默认只展开最近要到期的那张**，
            // 其余折叠在「另有 N 张」后面（多账号下既分得清归属，也不会一屏铺满旧卡）。
            const groups = groupResetCards(row.resetCards)
            if (groups.length === 0) return []
            return [React.createElement('div', {
              key: 'panel-reset-cards',
              'data-testid': 'panel-reset-cards',
              style: { marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l1)', display: 'flex', flexDirection: 'column', gap: '6px' },
            },
            // CPA 的卡都归属 codex 账号：弹窗窗口区已按 Codex/Gemini 分族展示，分区若不标
            // codex，只看 Gemini 窗口时极易把这张卡读成 Gemini 的重置卡。标题即折叠钮
            // （默认收起，点开才是账号分组内容，与「配置」钮同款 ▸/▾ 前缀）；非 CPA 行
            // 无标题、不折叠，行为不变。
            row?.kind === 'cliproxy'
              ? React.createElement('button', {
                  key: 'panel-reset-title',
                  type: 'button',
                  'data-testid': 'quota-panel-reset-title',
                  'aria-expanded': String(panelResetOpen),
                  onClick: () => setPanelResetOpen(!panelResetOpen),
                  style: { display: 'flex', alignItems: 'center', alignSelf: 'flex-start', fontSize: '11px', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' },
                }, `${panelResetOpen ? '▾' : '▸'} ${translate('quota.resetCard.codexTitle')}`)
              : null,
            ...(row?.kind === 'cliproxy' && !panelResetOpen ? [] : groups.map((group, groupIndex) => {
              const expanded = expandedResetGroups.has(`panel:${groupIndex}`)
              const shown = expanded ? group.cards : group.cards.slice(0, 1)
              const hidden = group.cards.length - shown.length
              // 账号名兜底：provider 级组用「重置卡」标题词条，账号组直接用账号标识（纯数据）。
              const owner = group.account !== '' ? group.account : translate('quota.resetCard.title')
              return React.createElement('div', {
                key: `panel-reset-group-${groupIndex}`,
                'data-testid': `quota-panel-reset-group-${groupIndex}`,
                style: { display: 'flex', flexDirection: 'column', gap: '2px' },
              },
              // 账号名行：多组时各组都要归属；只有一组但它是账号组时同样要标——CPA 禁用
              // 账号后块里只剩一张无窗口的卡，不标名就分不出是哪个 codex 号的。
              // provider 级单组不标（卡行标题本就是「重置卡」，没有归属可言）。
              groups.length > 1 || group.account !== ''
                ? React.createElement('div', { 'data-testid': `quota-panel-reset-owner-${groupIndex}`, title: owner, style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, owner)
                : null,
              shown.map((card, cardIndex) => {
                const content = resetCardContent(card, translate)
                return React.createElement('div', {
                  key: `panel-reset-card-${cardIndex}`,
                  'data-testid': `quota-panel-reset-card-${groupIndex}-${cardIndex}`,
                  style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', lineHeight: '16px', color: content.textColor },
                },
                React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: content.iconColor, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0 } },
                  React.createElement('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }),
                  React.createElement('line', { x1: 2, y1: 10, x2: 22, y2: 10 })),
                React.createElement('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, content.expiry !== '' ? `${content.title} · ${content.expiry}` : content.title))
              }),
              hidden > 0
                ? React.createElement('button', {
                    type: 'button',
                    'data-testid': `quota-panel-reset-more-${groupIndex}`,
                    onClick: () => toggleResetGroup(`panel:${groupIndex}`),
                    style: { alignSelf: 'flex-start', fontSize: '11px', color: 'var(--dsw-alias-brand-primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', textDecoration: 'underline' },
                  }, translate('quota.resetCard.more', { count: hidden }))
                : null,
              expanded && group.cards.length > 1
                ? React.createElement('button', {
                    type: 'button',
                    'data-testid': `quota-panel-reset-less-${groupIndex}`,
                    onClick: () => toggleResetGroup(`panel:${groupIndex}`),
                    style: { alignSelf: 'flex-start', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', textDecoration: 'underline' },
                  }, translate('quota.resetCard.less'))
                : null)
            })))]
          })(),
          errorNode,
          updatedNode) : null
        return React.createElement('span', { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
          triggerNode,
          centered ? quotaCreatePortal(panelNode, document.body) : panelNode)
      }

      function FeatureSettingsCard() {
        const translate = useTranslation()
        const { snapshot } = useFeatures()
        const [open, setOpen] = React.useState(false)
        const writable = snapshot.status === 'ready' && snapshot.writable === true
        return React.createElement('li', {
          style: { listStyle: 'none', border: '1px solid ' + (open ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsw-alias-border-l2)'), borderRadius: '12px', color: 'var(--dsw-alias-label-primary)', background: open ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)' },
        },
        React.createElement('button', {
          type: 'button',
          'data-testid': 'feature-card-toggle',
          'aria-expanded': String(open),
          onClick: () => setOpen(!open),
          style: { appearance: 'none', width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', border: 0, borderRadius: '12px', background: 'transparent', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer' },
        },
        React.createElement('span', { style: { display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column', gap: '4px' } },
          React.createElement('span', { style: { fontSize: '15px', fontWeight: 600, lineHeight: 1.4 } }, translate('features.cardTitle')),
          React.createElement('span', { style: { fontSize: '13px', lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' } }, translate('features.cardHint'))),
        React.createElement('svg', {
          viewBox: '0 0 14 14',
          width: 14,
          height: 14,
          'aria-hidden': 'true',
          style: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .16s' },
        }, React.createElement('path', { d: 'M3 5.25 7 9l4-3.75', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
        open ? React.createElement('div', { style: { margin: '0 16px', padding: '12px 0 8px', borderTop: '1px solid var(--dsw-alias-border-l2)' } },
          // v0.39：开关体收敛为分组式 FeatureGroups（与面板「配置 → 功能」页同一事实源）。
          React.createElement(FeatureGroups, null),
          !writable ? React.createElement('p', { style: { margin: '6px 0 0', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('features.readOnly')) : null) : null)
      }

      // ─── 功能开关分组（v0.39）：配置页与官方插件卡共用的分组事实源 ──────────
      // 运行/观测 + 维护 + 交互 三组默认展开；外部（/healthz）默认折叠。
      // 两处共用同一分组与同一写入路径（featureScope.set，行级 saving 锁）。
      const FEATURE_GROUPS = [
        ['features.group.runtime', ['healthDiagnostics', 'modelUsage', 'quotaLookup'], true],
        ['features.group.maintenance', ['backupMaintenance', 'skillManager', 'subagentRoute', 'sessionManager'], true],
        ['features.group.interaction', ['taskNotifications', 'mobileAdaptation', 'modelProviderIcons', 'fileEditor'], true],
        ['features.external', ['healthz'], false],
      ]
      function FeatureGroups() {
        const translate = useTranslation()
        const { snapshot, value } = useFeatures()
        const [saving, setSaving] = useState('')
        const writable = snapshot.status === 'ready' && snapshot.writable === true
        const row = (key) => React.createElement('div', {
          key,
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', padding: '7px 0' },
        },
        React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, translate('features.' + key)),
        React.createElement('button', {
          type: 'button',
          role: 'switch',
          'data-testid': 'feature-switch-' + key,
          'aria-checked': String(value[key] !== false),
          disabled: !writable || saving === key,
          onClick: async () => {
            setSaving(key)
            try { await featureScope.set(key, value[key] === false) } catch (_) {}
            setSaving('')
          },
          style: { width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative', border: '1px solid ' + (value[key] !== false ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'), background: value[key] !== false ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: writable && saving === '' ? 'pointer' : 'default', opacity: writable ? 1 : 0.5, lineHeight: 0 },
        }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: value[key] !== false ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: value[key] !== false ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))
        // 注意：本组件的根**不带** `card` 内边距——它同时被官方插件卡的折叠面板复用
        // （那里的容器已自带 `margin: 0 16px; padding: 12px 0 8px`），在根上加卡式内边距会串味。
        // 配置页所需的卡式内边距由调用处那层容器负责（见 tabContent 的 configuration 分支）。
        return React.createElement('div', null, FEATURE_GROUPS.map(([groupKey, keys]) => React.createElement('div', { key: groupKey, style: { marginTop: '10px' } },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, marginBottom: '2px' } }, translate(groupKey)),
          keys.map(row))))
      }

      // ─── 设置栏导航管理（排序与显隐）：集中在「配置 → 设置栏标签」子页 ────
      function SettingsNavOrderSection() {
        const translate = useTranslation()
        const [orderList, setOrderList] = useState(readSettingsNavOrder())
        const [hiddenIds, setHiddenIds] = useState(readSettingsNavHidden())
        const [savedTip, setSavedTip] = useState(false)
        const [dragIndex, setDragIndex] = useState(null)
        const savedTipTimerRef = useRef(null)
        const [, setTick] = useState(0)

        const showSavedTip = () => {
          setSavedTip(true)
          if (savedTipTimerRef.current !== null) savedTipTimerRef.current()
          savedTipTimerRef.current = ctx.timer.timeout(() => {
            savedTipTimerRef.current = null
            setSavedTip(false)
          }, 2000)
        }

        useEffect(() => () => {
          if (savedTipTimerRef.current !== null) savedTipTimerRef.current()
          savedTipTimerRef.current = null
        }, [])

        useEffect(() => {
          if (typeof ctx.slots?.subscribe === 'function') {
            return ctx.slots.subscribe('settings.section', () => setTick((v) => v + 1))
          }
        }, [])

        useEffect(() => {
          const update = () => {
            setOrderList(readSettingsNavOrder())
            setHiddenIds(readSettingsNavHidden())
          }
          navOrderListeners.add(update)
          return () => navOrderListeners.delete(update)
        }, [])

        const raw = getRawSettingsSections()
        const rawMap = new Map()
        for (const e of raw) {
          const id = e.options?.id ?? e.options?.key ?? ''
          if (!id || rawMap.has(id)) continue
          rawMap.set(id, {
            id,
            label: resolveSectionLabel(e.options),
            defaultOrder: e.options?.order ?? 0,
          })
        }

        let displayItems = []
        if (orderList && orderList.length > 0) {
          for (const id of orderList) {
            if (rawMap.has(id)) {
              displayItems.push(rawMap.get(id))
              rawMap.delete(id)
            }
          }
        }
        const remaining = Array.from(rawMap.values()).sort((a, b) => a.defaultOrder - b.defaultOrder)
        displayItems = displayItems.concat(remaining)

        const moveItem = (from, to) => {
          if (from < 0 || to < 0 || from >= displayItems.length || to >= displayItems.length || from === to) return
          const ids = displayItems.map((it) => it.id)
          const [moved] = ids.splice(from, 1)
          ids.splice(to, 0, moved)
          setOrderList(ids)
          writeSettingsNavOrder(ids)
          notifyNavOrderChanged()
          persistSettingsNavToBackend(ids, Array.isArray(hiddenIds) ? hiddenIds : [])
        }

        const toggleVisible = (id) => {
          if (id === 'dsh-service') return
          const currentHidden = Array.isArray(hiddenIds) ? hiddenIds : []
          const next = new Set(currentHidden)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          const arr = Array.from(next)
          setHiddenIds(arr)
          writeSettingsNavHidden(arr)
          notifyNavOrderChanged()
          persistSettingsNavToBackend(Array.isArray(orderList) ? orderList : null, arr)
        }

        const resetDefault = () => {
          setOrderList(null)
          setHiddenIds([])
          writeSettingsNavOrder(null)
          writeSettingsNavHidden(null)
          notifyNavOrderChanged()
          showSavedTip()
          persistSettingsNavReset()
        }

        const handleSave = () => {
          const ids = displayItems.map((it) => it.id)
          setOrderList(ids)
          writeSettingsNavOrder(ids)
          writeSettingsNavHidden(hiddenIds)
          notifyNavOrderChanged()
          showSavedTip()
          persistSettingsNavToBackend(ids, Array.isArray(hiddenIds) ? hiddenIds : [])
        }

        const hiddenSet = new Set(Array.isArray(hiddenIds) ? hiddenIds : [])

        return React.createElement('div', {
          'data-testid': 'config-nav-order-page',
          // 页内首块上边距交回 tab-panel（同其它页的 card 约定），此处不再自带 marginTop。
          style: { display: 'flex', flexDirection: 'column', gap: '12px' },
        },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' },
        },
        React.createElement('div', { style: { minWidth: 0, flex: '1 1 260px' } },
          React.createElement('div', { 'data-testid': 'nav-order-title', style: { fontSize: '14px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, translate('config.navOrder.title'))),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          savedTip ? React.createElement('span', {
            'data-testid': 'nav-order-saved-tip',
            style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
          }, '✓ ' + translate('config.navOrder.saved')) : null,
          React.createElement('button', {
            type: 'button',
            'data-testid': 'nav-order-reset',
            onClick: resetDefault,
            style: svcButtonStyle('ghost'),
          }, translate('config.navOrder.reset')),
          React.createElement('button', {
            type: 'button',
            'data-testid': 'nav-order-save',
            onClick: handleSave,
            style: svcButtonStyle('primary'),
          }, translate('config.navOrder.save')))),
        displayItems.length === 0
          ? React.createElement('div', { style: { padding: '16px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' } }, translate('config.navOrder.empty'))
          : React.createElement('div', {
            'data-testid': 'nav-order-list',
            style: { display: 'flex', flexDirection: 'column', gap: '8px' },
          }, displayItems.map((item, index) => {
            const isVisible = item.id === 'dsh-service' ? true : !hiddenSet.has(item.id)
            const isLocked = item.id === 'dsh-service'
            const isDragging = dragIndex === index

            return React.createElement('div', {
              key: item.id,
              'data-testid': 'nav-order-item-' + item.id,
              draggable: true,
              onDragStart: (e) => {
                try {
                  e.dataTransfer.setData('text/plain', String(index))
                  e.dataTransfer.effectAllowed = 'move'
                } catch (_) {}
                setDragIndex(index)
              },
              onDragOver: (e) => {
                e.preventDefault()
                try { e.dataTransfer.dropEffect = 'move' } catch (_) {}
              },
              onDrop: (e) => {
                e.preventDefault()
                let from = index
                try {
                  const rawData = e.dataTransfer.getData('text/plain')
                  from = Number.parseInt(rawData, 10)
                } catch (_) {}
                if (!Number.isNaN(from) && from !== index) {
                  moveItem(from, index)
                }
                setDragIndex(null)
              },
              onDragEnd: () => setDragIndex(null),
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '9px 14px',
                borderRadius: 'var(--dsh-svc-radius-control, 8px)',
                border: '1px solid ' + (isDragging ? 'var(--dsh-svc-brand)' : 'var(--dsw-alias-border-l1)'),
                background: isDragging ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsh-svc-card-bg)',
                opacity: isVisible ? 1 : 0.5,
                transition: 'border-color 120ms, background 120ms, opacity 120ms',
                cursor: 'grab',
                userSelect: 'none',
              },
            },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
              React.createElement('span', {
                style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', cursor: 'grab', letterSpacing: '-1px' },
                'aria-hidden': 'true',
              }, '⋮⋮'),
              React.createElement('span', {
                style: { fontSize: '13px', fontWeight: 550, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
              }, item.label || item.id),
              React.createElement('span', {
                style: { fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'monospace' },
              }, item.id),
              isLocked ? React.createElement('span', {
                style: { fontSize: '11px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(59,130,246,0.12)', color: 'var(--dsh-svc-brand)', fontWeight: 500 },
              }, translate('config.navOrder.locked')) : null,
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
              React.createElement('button', {
                type: 'button',
                'data-testid': 'nav-order-up-' + item.id,
                'aria-label': translate('config.navOrder.moveUp'),
                title: translate('config.navOrder.moveUp'),
                disabled: index === 0,
                onClick: (e) => { e.stopPropagation(); moveItem(index, index - 1) },
                style: {
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '24px', height: '24px', padding: 0,
                  borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: index === 0 ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)',
                  cursor: index === 0 ? 'default' : 'pointer',
                  opacity: index === 0 ? 0.35 : 1,
                  fontSize: '12px',
                  lineHeight: '24px',
                },
              }, '↑'),
              React.createElement('button', {
                type: 'button',
                'data-testid': 'nav-order-down-' + item.id,
                'aria-label': translate('config.navOrder.moveDown'),
                title: translate('config.navOrder.moveDown'),
                disabled: index === displayItems.length - 1,
                onClick: (e) => { e.stopPropagation(); moveItem(index, index + 1) },
                style: {
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '24px', height: '24px', padding: 0,
                  borderRadius: '6px',
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: index === displayItems.length - 1 ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)',
                  cursor: index === displayItems.length - 1 ? 'default' : 'pointer',
                  opacity: index === displayItems.length - 1 ? 0.35 : 1,
                  fontSize: '12px',
                  lineHeight: '24px',
                },
              }, '↓'),
              React.createElement('button', {
                type: 'button',
                role: 'switch',
                'data-testid': 'nav-order-toggle-' + item.id,
                'aria-checked': String(isVisible),
                'aria-label': translate(isVisible ? 'config.navOrder.visible' : 'config.navOrder.hidden'),
                title: isLocked ? translate('config.navOrder.locked') : translate(isVisible ? 'config.navOrder.visible' : 'config.navOrder.hidden'),
                disabled: isLocked,
                onClick: (e) => { e.stopPropagation(); toggleVisible(item.id) },
                style: {
                  width: '34px', height: '20px', ...fullRound('10px'),
                  padding: 0, position: 'relative', flexShrink: 0,
                  border: '1px solid ' + (isVisible ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'),
                  background: isVisible ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)',
                  cursor: isLocked ? 'not-allowed' : 'pointer',
                  opacity: isLocked ? 0.6 : 1,
                  lineHeight: 0,
                },
              }, React.createElement('span', {
                style: {
                  position: 'absolute', top: '1px',
                  left: isVisible ? '15px' : '1px',
                  width: '16px', height: '16px', ...fullRound('50%'),
                  background: isVisible ? '#fff' : 'var(--dsw-alias-label-tertiary)',
                  transition: 'left 120ms ease',
                },
              })),
            ))
          })))
      }

      // ─── 子代理模型（v0.27）：三态路由配置 ────────────────────────────────
      function mapSubagentError(translate, code) {
        if (code === 'feature-disabled') return translate('subagent.error.feature-disabled')
        if (code === 'llm-unavailable') return translate('subagent.error.llm-unavailable')
        if (code === 'unknown-mode') return translate('subagent.error.unknown-mode')
        if (code === 'invalid-model-route') return translate('subagent.error.invalid-model-route')
        if (code === 'invalid-reasoning-effort') return translate('subagent.error.invalid-reasoning-effort')
        if (code === 'network') return translate('subagent.error.network')
        return code
      }

      const SUBAGENT_MODES = ['inherit', 'follow', 'custom']
      // 首帧秒开缓存（v1.7.1）：上次成功快照的模式、草稿与模型清单。宿主快照是本页面唯一
      // 事实源，但「进入 → 请求返回」这段窗口里若直接画 state 初值，会先亮「初始（不干预）」
      // 再跳到磁盘上真实的「自定义」——模式高亮与整块表单（自定义下拉/回退编辑器）随之从
      // 287px 撑到 937px，进入本页时按钮和内容跳一下。缓存只作首帧初值，响应到达后整体覆盖；
      // 结构非法一律忽略，且只存宿主确认过的值（保存后同样经 load 回填）。
      const SUBAGENT_ROUTE_CACHE_KEY = 'dsh-service-subagent-route-cache'
      const isSubagentModelEntry = (item) => item !== null && typeof item === 'object'
        && typeof item.provider === 'string' && typeof item.id === 'string'
      function readSubagentRouteCache() {
        try {
          const parsed = JSON.parse(localStorage.getItem(SUBAGENT_ROUTE_CACHE_KEY) || 'null')
          if (parsed === null || typeof parsed !== 'object') return null
          if (!SUBAGENT_MODES.includes(parsed.mode)) return null
          if (!Array.isArray(parsed.models) || !parsed.models.every(isSubagentModelEntry)) return null
          return {
            mode: parsed.mode,
            provider: typeof parsed.provider === 'string' ? parsed.provider : '',
            model: typeof parsed.model === 'string' ? parsed.model : '',
            reasoningEffort: typeof parsed.reasoningEffort === 'string' ? parsed.reasoningEffort : '',
            fallbacks: Array.isArray(parsed.fallbacks) ? parsed.fallbacks : [],
            models: parsed.models,
            ...(parsed.current !== null && typeof parsed.current === 'object' ? { current: parsed.current } : {}),
            ...(typeof parsed.available === 'boolean' ? { available: parsed.available } : {}),
          }
        } catch (_) { return null }
      }
      function writeSubagentRouteCache(value) {
        if (value === null || typeof value !== 'object' || !SUBAGENT_MODES.includes(value.mode)) return
        if (!Array.isArray(value.models)) return
        try {
          localStorage.setItem(SUBAGENT_ROUTE_CACHE_KEY, JSON.stringify({
            mode: value.mode,
            provider: typeof value.provider === 'string' ? value.provider : '',
            model: typeof value.model === 'string' ? value.model : '',
            reasoningEffort: typeof value.reasoningEffort === 'string' ? value.reasoningEffort : '',
            fallbacks: Array.isArray(value.fallbacks) ? value.fallbacks : [],
            models: value.models.filter(isSubagentModelEntry),
            ...(value.current !== null && typeof value.current === 'object' ? { current: value.current } : {}),
            ...(typeof value.available === 'boolean' ? { available: value.available } : {}),
          }))
        } catch (_) {}
      }
      function SubagentSection() {
        const translate = useTranslation()
        const { useState, useEffect } = React
        // 挂载期只读一次缓存作首帧初值：之后的轮询/保存回填不重读。
        const initialRoute = React.useRef(null)
        if (initialRoute.current === null) initialRoute.current = { cached: readSubagentRouteCache() }
        // v1.2：输入框底部累计行独立开关（默认开，存 dsh-service settings，热生效）。
        const features = useFeatures()
        const dockEnabled = features.value.subagentModelsDock !== false
        // v0.39：子代理的设置页左列入口已撤销（维护页内有完整功能），不再有段内入口开关。
        const bootstrap = initialRoute.current.cached
        const [snapshot, setSnapshot] = useState(bootstrap)
        const [mode, setMode] = useState(bootstrap !== null ? bootstrap.mode : 'inherit')
        const [provider, setProvider] = useState(bootstrap !== null ? bootstrap.provider : '')
        const [model, setModel] = useState(bootstrap !== null ? bootstrap.model : '')
        const [loading, setLoading] = useState(true)
        const [saving, setSaving] = useState(false)
        const [savedTick, setSavedTick] = useState(0)
        const [error, setError] = useState('')
        const [reasoningEffort, setReasoningEffort] = useState(bootstrap !== null ? bootstrap.reasoningEffort : '')
        const [fallbacks, setFallbacks] = useState(bootstrap !== null ? bootstrap.fallbacks : [])
        const [reorderMode, setReorderMode] = useState(false)
        const hintStyle = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const selectStyle = { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' }

        const load = async () => {
          setLoading(true)
          try {
            const res = await rpcCall('subagent-route', {})
            if (res.ok) {
              setSnapshot(res.value)
              setMode(res.value.mode)
              setFallbacks(Array.isArray(res.value.fallbacks) ? res.value.fallbacks : [])
              // 自定义路由草稿三模式统一回填（宿主 v1.4.12 起草稿保留）：切换模式保存后
              // provider/model/reasoningEffort 仍随快照下发，切回「自定义」无需重新选择。
              if (typeof res.value.provider === 'string') setProvider(res.value.provider)
              if (typeof res.value.model === 'string') setModel(res.value.model)
              setReasoningEffort(typeof res.value.reasoningEffort === 'string' ? res.value.reasoningEffort : '')
              // 只缓存宿主确认过的状态（保存后同样经 load 回填），下次进入以此为初值。
              writeSubagentRouteCache(res.value)
              setError('')
            } else {
              setError(res.error || 'unknown')
            }
          } catch (_) {
            setError('network')
          } finally {
            setLoading(false)
          }
        }
        useEffect(() => { void load() }, [])

        const models = snapshot !== null && Array.isArray(snapshot.models) ? snapshot.models : []
        // 供应商分组：清单顺序去重；模型下拉随供应商切换。
        const providers = []
        const providerName = {}
        for (const item of models) {
          if (providerName[item.provider] === undefined) {
            providerName[item.provider] = item.providerName
            providers.push(item.provider)
          }
        }
        const modelsFor = (providerId) => models.filter((item) => item.provider === providerId)
        // 精确模型及其 adapter 声明的可选思考等级（host 已裁剪；此处再做防御性过滤/去重）。
        const effortsFor = (modelEntry) => {
          const options = []
          const seenIds = new Set()
          for (const entry of (modelEntry?.reasoning?.efforts ?? [])) {
            if (entry === null || typeof entry !== 'object') continue
            const id = typeof entry.id === 'string' ? entry.id : ''
            if (id === '' || seenIds.has(id)) continue
            seenIds.add(id)
            options.push({ id, name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : id, description: typeof entry.description === 'string' && entry.description !== '' ? entry.description : undefined })
          }
          return options
        }
        // 派生选择（derive, don't synchronize）：provider/model/reasoningEffort state 只存用户意图，
        // 展示与保存一律用派生值——供应商不在清单回落首项、模型不属于当前供应商回落其首项、
        // 等级不被当前模型支持回落「使用默认」。不把派生值写回 state：快照异步回填（切换模式后
        // 草稿恢复）与用户中途改选都不会被过期归一化效果覆盖。
        const effectiveProvider = providers.includes(provider) ? provider : providers[0] ?? ''
        const providerModels = modelsFor(effectiveProvider)
        // 当前精确模型及其 adapter 声明的可选思考等级（host 已裁剪；此处再做防御性过滤/去重）。
        const effectiveModel = providerModels.some((item) => item.id === model) ? model : providerModels[0]?.id ?? ''
        const selectedModel = providerModels.find((item) => item.id === effectiveModel) ?? null
        const effortOptions = effortsFor(selectedModel)
        const effectiveReasoningEffort = effortOptions.some((option) => option.id === reasoningEffort) ? reasoningEffort : ''

        // 回退模型（v1.1）：有序候选列表，custom/follow 共用；上限与宿主常量一致。
        const FALLBACK_MAX = 10
        const updateFallback = (index, patch) => {
          setFallbacks((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
        }
        const removeFallback = (index) => {
          setFallbacks((rows) => rows.filter((_, i) => i !== index))
        }
        const moveFallback = (index, delta) => {
          setFallbacks((rows) => {
            const target = index + delta
            if (target < 0 || target >= rows.length) return rows
            const next = [...rows]
            const moving = next.splice(index, 1)[0]
            next.splice(target, 0, moving)
            return next
          })
        }
        const addFallback = () => {
          setFallbacks((rows) => {
            if (rows.length >= FALLBACK_MAX) return rows
            const firstProvider = providers[0] ?? ''
            return [...rows, { provider: firstProvider, model: modelsFor(firstProvider)[0]?.id ?? '' }]
          })
        }
        // 排序模式只对 ≥2 条有意义：删到只剩一条时自动退出。
        useEffect(() => {
          if (reorderMode && fallbacks.length < 2) setReorderMode(false)
        }, [fallbacks.length])

        const save = async (nextMode) => {
          setSaving(true)
          setError('')
          try {
            const withFallbacks = (nextMode === 'custom' || nextMode === 'follow') && fallbacks.length > 0 ? { fallbacks } : {}
            const payload = nextMode === 'custom'
              ? { mode: 'custom', provider: effectiveProvider, model: effectiveModel, ...(effectiveReasoningEffort !== '' ? { reasoningEffort: effectiveReasoningEffort } : {}), ...withFallbacks }
              : { mode: nextMode, ...withFallbacks }
            const res = await rpcCall('subagent-route-save', payload)
            if (res.ok) {
              setSavedTick((tick) => tick + 1)
              await load()
            } else {
              setError(res.error || 'unknown')
            }
          } catch (_) {
            setError('network')
          } finally {
            setSaving(false)
          }
        }

        const cardStyle = svcCardStyle()
        const modeButton = (candidate) => React.createElement('button', {
          type: 'button',
          key: candidate,
          'data-testid': 'subagent-mode-' + candidate,
          'aria-pressed': String(mode === candidate),
          disabled: loading,
          onClick: () => setMode(candidate),
          style: Object.assign({}, svcRowActionStyle(), {
            cursor: loading ? 'default' : 'pointer',
            background: mode === candidate ? 'var(--dsh-svc-tab-active-bg)' : 'transparent',
            color: mode === candidate ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsh-svc-text)',
            opacity: loading ? 0.55 : 1,
          })
        }, translate('subagent.mode.' + candidate))

        const fallbackIconButton = (testId, disabled, onClick, label, danger = false) => React.createElement('button', {
          type: 'button',
          'data-testid': testId,
          disabled: disabled || saving,
          onClick,
          style: {
            fontSize: '12px',
            padding: '3px 8px',
            borderRadius: '6px',
            border: '1px solid ' + (danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsh-svc-border-strong)'),
            background: 'transparent',
            color: danger ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsh-svc-text)',
            cursor: disabled || saving ? 'default' : 'pointer',
            opacity: disabled || saving ? 0.55 : 1,
          },
        }, label)
        // 排序箭头：仅图标（▲/▼），无文字。
        const fallbackArrowButton = (testId, disabled, onClick, glyph) => React.createElement('button', {
          type: 'button',
          'data-testid': testId,
          disabled: disabled || saving,
          onClick,
          style: {
            fontSize: '12px',
            lineHeight: '14px',
            width: '24px',
            height: '24px',
            padding: 0,
            borderRadius: '6px',
            border: '1px solid var(--dsh-svc-border-strong)',
            background: 'transparent',
            color: 'var(--dsh-svc-text)',
            cursor: disabled || saving ? 'default' : 'pointer',
            opacity: disabled || saving ? 0.55 : 1,
          },
        }, glyph)

        // 字段行标签（定宽对齐）：供应商 / 模型 / 思考等级。
        const fieldLabelStyle = { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', width: '88px', flexShrink: 0 }

        return React.createElement('div', { 'data-testid': 'subagent-section', style: cardStyle },
          React.createElement('div', { style: { fontSize: '14px', fontWeight: 700 } }, translate('subagent.title')),
          React.createElement('p', { style: hintStyle }, translate('subagent.hint')),
          // v1.2：输入框下方累计行开关（独立于路由配置，feature 热生效；关闭即隐藏累计行，
          // 对话页不再有其他子代理显示面）。
          React.createElement('div', { 'data-testid': 'subagent-dock-toggle-row', style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', padding: '10px 12px', border: '1px solid var(--dsh-svc-border)', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)' } },
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, translate('subagent.dock.title'))),
            React.createElement('button', { type: 'button', role: 'switch', 'aria-checked': String(dockEnabled), 'data-testid': 'subagent-dock-toggle', onClick: () => { featureScope.set('subagentModelsDock', !dockEnabled).catch(() => {}) }, style: { width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative', border: '1px solid ' + (dockEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'), background: dockEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 } },
              React.createElement('span', { style: { position: 'absolute', top: '1px', left: dockEnabled ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: dockEnabled ? '#fff' : 'var(--dsw-alias-label-tertiary)', transition: 'left 150ms ease' } }))),
          snapshot !== null && snapshot.available === false ? React.createElement('p', { 'data-testid': 'subagent-unavailable', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.unavailable')) : null,
          // 首帧无缓存（首次安装/换浏览器）：给一行读取提示，避免整页空白像「坏掉了」。
          // 有缓存时首帧就是最终形态，不出现这行。
          loading && snapshot === null ? React.createElement('p', { 'data-testid': 'subagent-loading', style: hintStyle }, translate('subagent.loading')) : null,
          React.createElement('div', { 'data-testid': 'subagent-modes', style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
            SUBAGENT_MODES.map(modeButton)),
          React.createElement('p', { 'data-testid': 'subagent-mode-desc', style: { ...hintStyle, marginTop: '8px' } }, translate('subagent.mode.' + mode + '.desc')),
          mode === 'custom' ? React.createElement('div', { 'data-testid': 'subagent-custom', style: { marginTop: '8px' } },
            // 供应商行
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
              React.createElement('span', { style: fieldLabelStyle }, translate('subagent.provider')),
              React.createElement('select', { 'data-testid': 'subagent-provider', value: effectiveProvider, disabled: providers.length === 0 || saving, onChange: (event) => setProvider(event.target.value), style: selectStyle },
                providers.map((id) => React.createElement('option', { key: id, value: id }, providerName[id] ?? id)))),
            // 模型行
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
              React.createElement('span', { style: fieldLabelStyle }, translate('subagent.model')),
              React.createElement('select', { 'data-testid': 'subagent-model', value: effectiveModel, disabled: providerModels.length === 0 || saving, onChange: (event) => setModel(event.target.value), style: selectStyle },
                providerModels.map((item) => React.createElement('option', { key: item.id, value: item.id }, item.name ?? item.id)))),
            // 思考等级行：选模型后出现；无等级信息时给提示。
            effectiveModel !== '' ? React.createElement('div', { 'data-testid': 'subagent-reasoning-row', style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px', flexWrap: 'wrap' } },
              React.createElement('span', { style: fieldLabelStyle }, translate('subagent.reasoningEffort')),
              React.createElement('select', { 'data-testid': 'subagent-reasoning-effort', value: effectiveReasoningEffort, disabled: saving || effortOptions.length === 0, onChange: (event) => setReasoningEffort(event.target.value), style: selectStyle },
                React.createElement('option', { value: '' }, translate('subagent.reasoningEffort.default')),
                ...effortOptions.map((option) => React.createElement('option', { key: option.id, value: option.id, ...(option.description !== undefined ? { title: option.description } : {}) }, option.name))),
              effortOptions.length === 0 ? React.createElement('span', { 'data-testid': 'subagent-reasoning-effort-unavailable', style: { fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.reasoningEffort.unavailable')) : null) : null) : null,
          mode === 'custom' && models.length === 0 && !loading ? React.createElement('p', { 'data-testid': 'subagent-models-empty', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.modelsEmpty')) : null,
          mode === 'custom' || mode === 'follow' ? React.createElement('div', { 'data-testid': 'subagent-fallback-block', style: { marginTop: '14px', borderTop: '1px solid var(--dsh-svc-border)', paddingTop: '12px' } },
            React.createElement('div', { style: { fontSize: '13px', fontWeight: 700 } }, translate('subagent.fallback.title')),
            React.createElement('p', { style: hintStyle }, translate('subagent.fallback.hint')),
            fallbacks.length === 0 ? React.createElement('p', { 'data-testid': 'subagent-fallback-empty', style: { ...hintStyle, color: 'var(--dsw-alias-label-secondary)' } }, translate('subagent.fallback.empty')) : null,
            fallbacks.map((fallback, index) => {
              const rowKnownProvider = providers.includes(fallback.provider)
              const rowProviderModels = rowKnownProvider ? modelsFor(fallback.provider) : []
              const rowModelEntry = rowProviderModels.find((item) => item.id === fallback.model) ?? null
              const rowEffortOptions = effortsFor(rowModelEntry)
              const rowEffortIds = rowEffortOptions.map((option) => option.id)
              return React.createElement('div', { key: index, 'data-testid': 'subagent-fallback-row', style: { marginTop: '8px', border: '1px solid var(--dsh-svc-border)', borderRadius: '8px', padding: '7px 10px 8px' } },
                // 标题行：序号 + 右侧操作（移除 / 排序箭头）。
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' } },
                  React.createElement('span', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, translate('subagent.fallback.item', { index: String(index + 1) })),
                  React.createElement('span', { style: { marginLeft: 'auto' } }),
                  fallbackIconButton('subagent-fallback-remove-' + index, false, () => removeFallback(index), translate('subagent.fallback.remove'), true),
                  reorderMode ? fallbackArrowButton('subagent-fallback-up-' + index, index === 0, () => moveFallback(index, -1), '▲') : null,
                  reorderMode ? fallbackArrowButton('subagent-fallback-down-' + index, index === fallbacks.length - 1, () => moveFallback(index, 1), '▼') : null),
                // 供应商行
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
                  React.createElement('span', { style: fieldLabelStyle }, translate('subagent.provider')),
                  React.createElement('select', { 'data-testid': 'subagent-fallback-provider-' + index, value: rowKnownProvider ? fallback.provider : '', disabled: saving, onChange: (event) => { const nextProvider = event.target.value; updateFallback(index, { provider: nextProvider, model: modelsFor(nextProvider)[0]?.id ?? '' }) }, style: selectStyle },
                    React.createElement('option', { value: '' }, ''),
                    providers.map((id) => React.createElement('option', { key: id, value: id }, providerName[id] ?? id)))),
                // 模型行
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
                  React.createElement('span', { style: fieldLabelStyle }, translate('subagent.model')),
                  React.createElement('select', { 'data-testid': 'subagent-fallback-model-' + index, value: rowProviderModels.some((item) => item.id === fallback.model) ? fallback.model : '', disabled: rowProviderModels.length === 0 || saving, onChange: (event) => { const nextModel = event.target.value; const nextEntry = rowProviderModels.find((item) => item.id === nextModel) ?? null; const nextIds = effortsFor(nextEntry).map((option) => option.id); updateFallback(index, { model: nextModel, ...(typeof fallback.reasoningEffort === 'string' && fallback.reasoningEffort !== '' && !nextIds.includes(fallback.reasoningEffort) ? { reasoningEffort: undefined } : {}) }) }, style: selectStyle },
                    rowProviderModels.map((item) => React.createElement('option', { key: item.id, value: item.id }, item.name ?? item.id)))),
                // 思考等级行：模型无等级信息时给提示。
                rowEffortOptions.length > 0
                  ? React.createElement('div', { 'data-testid': 'subagent-fallback-reasoning-row', style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' } },
                    React.createElement('span', { style: fieldLabelStyle }, translate('subagent.reasoningEffort')),
                    React.createElement('select', { 'data-testid': 'subagent-fallback-effort-' + index, value: rowEffortIds.includes(fallback.reasoningEffort) ? fallback.reasoningEffort : '', disabled: saving, onChange: (event) => updateFallback(index, { reasoningEffort: event.target.value === '' ? undefined : event.target.value }), style: selectStyle },
                      React.createElement('option', { value: '' }, translate('subagent.reasoningEffort.default')),
                      ...rowEffortOptions.map((option) => React.createElement('option', { key: option.id, value: option.id, ...(option.description !== undefined ? { title: option.description } : {}) }, option.name))))
                  : React.createElement('span', { 'data-testid': 'subagent-fallback-effort-unavailable-' + index, style: { display: 'inline-block', marginTop: '4px', fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.reasoningEffort.unavailable')))
            }),
            fallbacks.length >= FALLBACK_MAX
              ? React.createElement('p', { 'data-testid': 'subagent-fallback-limit', style: { ...hintStyle, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('subagent.fallback.limit', { max: String(FALLBACK_MAX) }))
              : React.createElement('div', { style: { display: 'flex', gap: '10px', marginTop: '8px', flexWrap: 'wrap' } },
                  React.createElement('button', { type: 'button', 'data-testid': 'subagent-fallback-add', disabled: saving || providers.length === 0, onClick: () => addFallback(), style: { fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px dashed var(--dsh-svc-border-strong)', background: 'transparent', color: 'var(--dsh-svc-text)', cursor: saving || providers.length === 0 ? 'default' : 'pointer', opacity: saving || providers.length === 0 ? 0.55 : 1 } }, translate('subagent.fallback.add')),
                  fallbacks.length > 1 ? React.createElement('button', { type: 'button', 'data-testid': 'subagent-fallback-sort', disabled: saving, onClick: () => setReorderMode((value) => !value), style: { fontSize: '12px', padding: '5px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsh-svc-border-strong)', background: reorderMode ? 'var(--dsh-svc-tab-active-bg)' : 'transparent', color: reorderMode ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsh-svc-text)', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.55 : 1 } }, translate(reorderMode ? 'subagent.fallback.sort.done' : 'subagent.fallback.sort')) : null))
              : null,
          error !== '' ? React.createElement('p', { 'data-testid': 'subagent-error', style: { ...hintStyle, color: 'var(--dsw-alias-state-error-primary)' } }, mapSubagentError(translate, error)) : null,
          savedTick > 0 && error === '' ? React.createElement('p', { 'data-testid': 'subagent-saved', style: { ...hintStyle, color: 'var(--dsw-alias-state-success-primary)' } }, '✓ ' + translate('subagent.saved')) : null,
          React.createElement('div', { style: { display: 'flex', gap: '10px', marginTop: '12px', flexWrap: 'wrap' } },
            React.createElement('button', { type: 'button', 'data-testid': 'subagent-save', disabled: saving || loading || (mode === 'custom' && (effectiveProvider === '' || effectiveModel === '')), onClick: () => void save(mode), style: { fontSize: '12px', padding: '6px 16px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: saving ? 'default' : 'pointer', opacity: saving || loading || (mode === 'custom' && (effectiveProvider === '' || effectiveModel === '')) ? 0.55 : 1 } }, saving ? translate('subagent.saving') : translate('subagent.save')),
            mode !== 'inherit' ? React.createElement('button', { type: 'button', 'data-testid': 'subagent-reset', disabled: saving || loading, onClick: () => { setMode('inherit'); void save('inherit') }, style: { fontSize: '12px', padding: '6px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: saving ? 'default' : 'pointer', opacity: saving || loading ? 0.55 : 1 } }, translate('subagent.reset')) : null))
      }

      // ─── 技能管理（v0.22）：三区列表 / 启停 / AI 补全 / 批量 ────────────────
      const SKILLS_MODEL_STORAGE_KEY = 'dsh-service-skills-model'
      const SKILL_RPC = (endpoint, payload) => rpcCall(endpoint, payload)
      function formatSkillBytes(size) {
        return size >= 1024 * 1024 ? (size / 1024 / 1024).toFixed(1) + ' MB' : size >= 1024 ? (size / 1024).toFixed(1) + ' KB' : String(size) + ' B'
      }
      function skillModelKey(item) { return item.provider + '\u0000' + item.id }
      function readStoredSkillModel() {
        try {
          const parsed = JSON.parse(localStorage.getItem(SKILLS_MODEL_STORAGE_KEY) || 'null')
          if (parsed && typeof parsed.provider === 'string' && typeof parsed.model === 'string') return parsed
        } catch (_) {}
        return null
      }
      function pickSkillModel(models, preferred) {
        const current = typeof preferred === 'object' && preferred !== null ? preferred : readStoredSkillModel()
        if (current !== null) {
          const match = models.find((item) => item.provider === current.provider && item.id === current.model)
          if (match !== undefined) return match
        }
        return models[0] ?? null
      }

      // 批量与单条共用的模型预选：localStorage 记忆 > 宿主当前默认 > 清单首个。
      const resolveSkillModelChoice = (models, current) => {
        let item = pickSkillModel(models, readStoredSkillModel())
        if (item === null && current !== undefined) {
          item = models.find((candidate) => candidate.provider === current.provider && candidate.id === current.model) ?? null
        }
        return item
      }

      // 技能批量共享态工厂：正文见 src/client/skills-batch-shared.js；模型目录三件套已在前文定义，
      // 此处按值传入（调用点晚于其声明，无 TDZ）；返回值解构回原名供技能段消费。
      const { adoptSkillsBatchStatus, cancelSkillsBatchShared, changeSkillsBatchModel, fetchSkillsBatchModels, planSkillsBatchShared, publishSkillsBatch, skillsBatchListDirtyRef, startSkillsBatchShared, useSkillsBatch } = createSkillsBatchShared({ ctx, rpcCall, featureEnabled, featureScope, currentUiLocale, SKILLS_MODEL_STORAGE_KEY, skillModelKey, resolveSkillModelChoice })

      // 宿主下发的日志条目是结构化 {at, name?, code, params}：时间戳按本机时区格式化（用户点名：
      // 原先 toISOString 出 UTC 时刻，看日志对不上本地钟）、文案词典渲染，词典没有的 code 原样透出。
      const formatSkillLogLine = (translate, entry) => {
        if (entry === null || typeof entry !== 'object') return String(entry)
        const date = new Date(entry.at)
        const pad = (value) => String(value).padStart(2, '0')
        const time = Number.isFinite(date.getTime())
          ? pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
          : '--:--:--'
        const key = 'skills.log.' + entry.code
        const label = translate(key, entry.params ?? {})
        return '[' + time + ']' + (entry.name !== undefined ? ' [' + entry.name + ']' : '') + ' ' + (label === key ? entry.code : label)
      }

      // 错误码 → 本地化文案：translate 必须由调用方传入（本函数所在作用域没有 translate，
      // 此前直接引用自由变量，技能页一出错误就 ReferenceError 整页崩溃）。
      function mapSkillErrorMessage(translate, code) {
        if (code === 'models-empty') return translate('skills.describe.models.empty')
        if (code === 'llm-unavailable') return translate('skills.llm.unavailable')
        if (code === 'batch-already-running') return translate('skills.batch.already')
        if (code === 'feature-disabled') return translate('skills.error.feature-disabled')
        if (code === 'network') return translate('skills.error.network')
        if (code === 'read-only-source') return translate('skills.error.read-only-source')
        if (code === 'unknown-skill') return translate('skills.error.unknown-skill')
        if (code === 'invalid-field') return translate('skills.error.invalid-field')
        if (code === 'invalid-enable') return translate('skills.error.invalid-enable')
        if (code === 'invalid-model-route') return translate('skills.error.invalid-model-route')
        if (code === 'invalid-description') return translate('skills.error.invalid-description')
        if (code === 'describe-timeout') return translate('skills.error.describe-timeout')
        if (code === 'batch-cancelled') return translate('skills.error.batch-cancelled')
        if (code === 'entry-changed') return translate('skills.error.entry-changed')
        if (code === 'unknown-batch-plan') return translate('skills.error.unknown-batch-plan')
        if (code === 'batch-already-done') return translate('skills.error.batch-already-done')
        if (code === 'batch-already-cancelled') return translate('skills.error.batch-already-cancelled')
        if (code === 'annotated-confirm-required') return translate('skills.error.annotated-confirm-required')
        if (typeof code === 'string' && code.startsWith('empty-output')) {
          const kind = code.slice('empty-output:'.length)
          return translate('skills.error.empty-output', { kind: kind === '' ? '?' : kind })
        }
        if (typeof code === 'string' && code.startsWith('invalid-skill')) {
          const reason = code.startsWith('invalid-skill:') ? code.slice('invalid-skill:'.length) : ''
          return translate('skills.error.invalid-skill', { reason })
        }
        return translate('skills.error', { error: code })
      }

      function SkillsSection() {
        const translate = useTranslation()
        const [data, setData] = useState(null)
        const [error, setError] = useState('')
        const [loading, setLoading] = useState(true)
        const [filterText, setFilterText] = useState('')
        // 技能条目默认全部折叠（长列表先当索引用）：记录已展开的条目签名 ID，
        // 点条目各自开合，顶部按钮对当前可见条目一键全开/全收。
        const [expandedSkillIds, setExpandedSkillIds] = useState([])
        const [confirmingKey, setConfirmingKey] = useState(null)
        const [describe, setDescribe] = useState(null)   // {entry, models, modelItem, draft, busy, error, applied}
        const [batchBusy, setBatchBusy] = useState(false)
        const [describeLogs, setDescribeLogs] = useState([])
        // 运行日志盒：生成中自动展开；落定自动折叠为一行开关，可手动展开回看。
        // 初值恒为折叠（此时 batch 尚未解构），挂载后的阶段 effect 会立即校正。
        const [batchLogOpen, setBatchLogOpen] = useState(false)
        // 跳过清单：默认折叠，点开看逐条原因。
        const [skippedOpen, setSkippedOpen] = useState(false)
        // 计划含已注释条目时的强制覆盖确认：第一击只武装（3 秒自动复位），第二击才真正启动。
        const [batchAnnotatedArmed, setBatchAnnotatedArmed] = useState(false)
        // 将覆盖清单（已注释条目）：默认折叠，点开看被覆盖的技能名。
        const [annotatedListOpen, setAnnotatedListOpen] = useState(false)
        // 批量进度/计划/模型来自工厂共享作用域：跨标签与设置面板开关存活。
        const { batch, plan: batchPlan, models: batchModels, modelItem: batchModelItem, error: batchError } = useSkillsBatch()
        // 运行日志盒：生成中自动展开；落定自动折叠为一行开关，可手动展开回看。
        const batchPhaseForLog = batch !== null ? batch.phase : null
        useEffect(() => { setBatchLogOpen(batchPhaseForLog === 'running') }, [batchPhaseForLog])

        const load = async () => {
          setLoading(true)
          try {
            const res = await SKILL_RPC('skills-list', {})
            if (res.ok) { setData(res.value); setError('') } else setError(res.error || 'unknown')
          } catch (_) {
            // 断连/传输失败也要落到错误态，而不是静默 unhandled rejection。
            setError('network')
          } finally { setLoading(false) }
        }
        useEffect(() => {
          void load()
          void adoptSkillsBatchStatus()
          void fetchSkillsBatchModels().then(publishSkillsBatch)
        }, [])
        // 落定后刷新列表拿最新注释标记；订阅回调里消费脏标记。
        useEffect(() => {
          if (batch !== null && (batch.phase === 'done' || batch.phase === 'cancelled') && skillsBatchListDirtyRef.current) {
            skillsBatchListDirtyRef.current = false
            void load()
          }
        }, [batch !== null && batch.phase])
        // 「生成中」800ms 轮询运行日志；落定后单次补拉，接住最后一条「解析成功/失败原因」。
        // 成功路径不做 alive 门控：完成渲染的清理可能先于在途响应执行，迟到结果正是我们要的尾巴。
        useEffect(() => {
          if (describe === null || !describe.busy) return undefined
          const entryId = describe.entry.id
          let intervalHandle
          const fetchLog = async () => {
            try {
              const res = await SKILL_RPC('skills-describe-log', { id: entryId })
              if (res.ok) setDescribeLogs(res.value.logs ?? [])
            } catch (_) {}
          }
          void fetchLog()
          intervalHandle = setInterval(() => void fetchLog(), 800)
          return () => clearInterval(intervalHandle)
        }, [describe !== null && describe.busy])
        useEffect(() => {
          if (describe === null || describe.busy) return undefined
          const entryId = describe.entry.id
          void (async () => {
            try {
              const res = await SKILL_RPC('skills-describe-log', { id: entryId })
              if (res.ok) setDescribeLogs(res.value.logs ?? [])
            } catch (_) {}
          })()
        }, [describe !== null && describe.busy])

        const patchEntry = (next) => {
          setData((prev) => prev === null ? prev : { ...prev, entries: prev.entries.map((entry) => entry.id === next.id ? next : entry) })
        }
        const toggleSkillExpanded = (id) => setExpandedSkillIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : prev.concat([id]))
        // 待确认态 3 秒无第二击自动复位（armed 态不再无限滞留）。
        useEffect(() => {
          if (confirmingKey === null) return undefined
          const handle = setTimeout(() => setConfirmingKey(null), 3000)
          return () => clearTimeout(handle)
        }, [confirmingKey])
        // 强制覆盖确认同样 3 秒自动复位；批量相位/计划变化（落定、重新计划）时武装状态作废。
        useEffect(() => {
          if (!batchAnnotatedArmed) return undefined
          const handle = setTimeout(() => setBatchAnnotatedArmed(false), 3000)
          return () => clearTimeout(handle)
        }, [batchAnnotatedArmed])
        useEffect(() => { setBatchAnnotatedArmed(false) }, [batchPhaseForLog, batchPlan])
        const toggleSkill = async (entry, field) => {
          const key = entry.id + ':' + field
          // 两段式：第一击只进入待确认态，3 秒内再击才下发；超时点别处自然复位。
          if (confirmingKey !== key) { setConfirmingKey(key); return }
          setConfirmingKey(null)
          const enable = field === 'model' ? entry.invocation.model !== true : entry.invocation.user !== true
          try {
            const res = await SKILL_RPC('skills-toggle', { id: entry.id, field, enable })
            if (res.ok) patchEntry(res.value.entry)
            else setError(res.error + (res.detail ? ':' + res.detail : '') || 'unknown')
          } catch (_) { setError('network') }
        }
        const fixLegacyKeys = async (entry) => {
          // 与开关同款两段式：一键修复会直接改写 SKILL.md frontmatter，先确认再动手。
          const key = entry.id + ':fix'
          if (confirmingKey !== key) { setConfirmingKey(key); return }
          setConfirmingKey(null)
          try {
            const res = await SKILL_RPC('skills-fix-keys', { id: entry.id })
            if (res.ok) patchEntry(res.value.entry)
            else setError(res.error + (res.detail ? ':' + res.detail : '') || 'unknown')
          } catch (_) { setError('network') }
        }
        const clearNote = async (entry) => {
          const res = await SKILL_RPC('skills-note-clear', { id: entry.id })
          if (res.ok) patchEntry(res.value.entry)
          else setError(res.error || 'unknown')
        }

        const openDescribe = async (entry) => {
          const stored = readStoredSkillModel()
          setDescribe({ entry, models: null, modelItem: null, draft: null, busy: false, error: '', applied: false, preferred: stored })
          setDescribeLogs([])
          const res = await SKILL_RPC('skills-models', {})
          if (!res.ok) { setDescribe((prev) => ({ ...prev, error: res.error || 'unknown' })); return }
          const models = res.value.models ?? []
          setDescribe((prev) => ({ ...prev, models, modelItem: resolveSkillModelChoice(models, res.value.current) }))
        }
        const runDescribe = async () => {
          if (describe === null || describe.modelItem === null) return
          const { entry, modelItem } = describe
          setDescribe((prev) => ({ ...prev, busy: true, error: '' }))
          const res = await SKILL_RPC('skills-describe', { id: entry.id, provider: modelItem.provider, model: modelItem.id, lang: currentUiLocale() })
          if (res.ok) {
            try { localStorage.setItem(SKILLS_MODEL_STORAGE_KEY, JSON.stringify({ provider: modelItem.provider, model: modelItem.id })) } catch (_) {}
            setDescribe((prev) => ({ ...prev, draft: res.value.draft, busy: false }))
          } else {
            setDescribe((prev) => ({ ...prev, busy: false, error: res.error + (res.detail ? ':' + res.detail : '') }))
          }
        }
        const applyDraft = async () => {
          if (describe === null || describe.draft === null || describe.modelItem === null) return
          const { entry, draft, modelItem } = describe
          setDescribe((prev) => ({ ...prev, busy: true }))
          const res = await SKILL_RPC('skills-note-save', { id: entry.id, patch: { description: draft.description, usage: draft.usage }, model: modelItem.provider + '/' + modelItem.id })
          if (res.ok) {
            patchEntry(res.value.entry)
            setDescribe((prev) => ({ ...prev, busy: false, applied: true }))
          } else {
            setDescribe((prev) => ({ ...prev, busy: false, error: res.error || 'unknown' }))
          }
        }

        const planBatch = async () => {
          setBatchBusy(true)
          try { await planSkillsBatchShared() } finally { setBatchBusy(false) }
        }
        const startBatch = async () => {
          // 计划含已注释条目：第一击只武装「确认强制补全」，第二击（3 秒内）才真正启动并携带
          // forceAnnotated；无已注释条目时行为与原来一致，单击即启。
          const annotatedCount = Array.isArray(batchPlan?.annotated) ? batchPlan.annotated.length : 0
          if (annotatedCount > 0 && !batchAnnotatedArmed) { setBatchAnnotatedArmed(true); return }
          setBatchAnnotatedArmed(false)
          setBatchBusy(true)
          try { await startSkillsBatchShared(annotatedCount > 0) } finally { setBatchBusy(false) }
        }
        const cancelBatch = async () => { await cancelSkillsBatchShared() }

        // ── 渲染 ──
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const badge = (text, tone) => React.createElement('span', { key: text, style: svcBadgeStyle(tone === 'warn' ? 'warning' : tone === 'danger' ? 'danger' : 'neutral', { marginLeft: '6px', padding: '1px 7px', verticalAlign: 'middle' }) }, text)
        const pillSwitch = (checked, opts) => React.createElement('button', {
          type: 'button',
          role: 'switch',
          'data-testid': opts.testid,
          'aria-checked': String(checked),
          title: opts.title,
          disabled: opts.disabled,
          onClick: opts.onClick,
          style: { width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative', cursor: opts.disabled ? 'default' : 'pointer', lineHeight: 0, border: '1px solid ' + (opts.armed ? 'var(--dsw-alias-state-warn-primary)' : checked ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'), background: opts.armed ? 'transparent' : checked ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', opacity: opts.disabled ? 0.5 : 1 },
        }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: checked && !opts.armed ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: opts.armed ? 'var(--dsw-alias-state-warn-primary)' : checked ? '#fff' : 'var(--dsw-alias-label-tertiary)' } }))
        // v0.31 用户点名两连修：AI 注释块独占整行占满技能展示区；技能自带的描述/用法行
        // 回到「文本 | 开关」双栏的左列原宽度，给右侧胶囊开关列留位。头部行 = 名称 +
        // 自带描述/用法/无效行（左列）+ 右侧开关列，注释块铺满全宽垫底。
        // 条目默认折叠：头部行只剩折叠箭头 + 名称徽标行（可点，独立开合）；描述/用法/开关/
        // 注释都进折叠体。无效 ⚠ 行是警告不是细节，折叠态也照常露出。
        const entryCard = { border: '1px solid var(--dsh-alias-border-l2)', borderRadius: '10px', padding: '11px 13px', marginBottom: '8px', background: 'var(--dsh-svc-card-bg)' }

        const renderEntry = (entry) => {
          const expanded = expandedSkillIds.includes(entry.id)
          const invalidLegacy = typeof entry.invalid === 'string' && entry.invalid.startsWith('legacy-invocation-key:')
          const nameLine = React.createElement('div', { style: { fontSize: '14px', fontWeight: 650, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' } },
            entry.name,
            badge(translate('skills.source.' + entry.source) === 'skills.source.' + entry.source ? entry.source : translate('skills.source.' + entry.source)),
            entry.shadowed ? badge(translate('skills.badge.shadowed'), 'warn') : null,
            !entry.writable ? badge(translate('skills.badge.readonly'), 'danger') : null,
            entry.annotated ? badge(translate('skills.badge.annotated')) : null)
          const descLine = React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginTop: '3px', lineHeight: 1.45, overflowWrap: 'anywhere' } }, entry.description)
          // 原文无 whenToUse 就不渲染该行，不放占位文案。
          const usageLine = entry.usage === '' ? null : React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '2px', lineHeight: 1.45, overflowWrap: 'anywhere' } },
            translate('skills.apply.usage') + '：' + entry.usage)
          // AI 注释块：只存插件侧车索引、只在面板展示；正文变更后自动标记过期。
          const noteLine = entry.note !== undefined ? React.createElement('div', { 'data-testid': 'skill-note-' + entry.name, style: { marginTop: '5px', padding: '6px 9px', borderRadius: '7px', background: 'var(--dsh-svc-raised-bg)', border: '1px solid var(--dsw-alias-border-l2)', fontSize: '11.5px', lineHeight: 1.55, color: 'var(--dsw-alias-label-secondary)', display: 'flex', gap: '8px', alignItems: 'flex-start' } },
            React.createElement('div', { style: { minWidth: 0, flex: 1 } },
              entry.note.stale === true ? React.createElement('div', { style: { marginBottom: '3px', color: 'var(--dsw-alias-state-warn-primary)' } }, '⚠ ' + translate('skills.note.stale')) : null,
              React.createElement('div', { style: { overflowWrap: 'anywhere' } },
                React.createElement('span', { style: { fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, translate('skills.apply.description') + '：'),
                React.createElement('span', null, entry.note.description)),
              entry.note.usage === '' ? null : React.createElement('div', { style: { overflowWrap: 'anywhere', marginTop: '3px' } },
                React.createElement('span', { style: { fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, translate('skills.apply.usage') + '：'),
                React.createElement('span', null, entry.note.usage))),
            React.createElement('button', { type: 'button', 'data-testid': 'skill-note-remove-' + entry.name, onClick: () => void clearNote(entry), title: translate('skills.note.remove'), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '13px', flexShrink: 0, lineHeight: 1 } }, '✕')) : null
          const invalidLine = entry.invalid !== undefined ? React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-state-warn-primary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            '⚠ ', invalidLegacy ? translate('skills.invalid.legacy') : translate('skills.invalid.other', { reason: entry.invalid }),
            invalidLegacy && entry.writable ? React.createElement('button', { type: 'button', 'data-testid': 'skill-fix-' + entry.name, onClick: () => void fixLegacyKeys(entry), title: confirmingKey === entry.id + ':fix' ? translate('skills.switch.confirm') : undefined, style: { fontSize: '11px', padding: '2px 9px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-warn-primary)', background: confirmingKey === entry.id + ':fix' ? 'rgba(198,128,0,0.14)' : 'transparent', color: 'var(--dsw-alias-state-warn-primary)', cursor: 'pointer' } }, confirmingKey === entry.id + ':fix' ? translate('skills.switch.confirm') : translate('skills.fix.legacy')) : null) : null
          const switches = entry.invalid === undefined ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '7px', alignItems: 'flex-end', flexShrink: 0 } },
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.switch.model'),
              pillSwitch(entry.invocation.model, { testid: 'skill-switch-model-' + entry.name, disabled: !entry.writable, armed: confirmingKey === entry.id + ':model', title: confirmingKey === entry.id + ':model' ? translate('skills.switch.confirm') : undefined, onClick: () => void toggleSkill(entry, 'model') })),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.switch.user'),
              pillSwitch(entry.invocation.user, { testid: 'skill-switch-user-' + entry.name, disabled: !entry.writable, armed: confirmingKey === entry.id + ':user', title: confirmingKey === entry.id + ':user' ? translate('skills.switch.confirm') : undefined, onClick: () => void toggleSkill(entry, 'user') })),
            data !== null && data.llmAvailable ? React.createElement('button', { type: 'button', 'data-testid': 'skill-describe-' + entry.name, onClick: () => void openDescribe(entry), style: Object.assign({}, svcRowActionStyle(), { fontSize: '11px', padding: '3px 10px' }) }, '✨ ' + translate('skills.describe.button')) : null) : null
          const headerRow = React.createElement('button', { type: 'button', 'data-testid': 'skill-header-' + entry.name, 'aria-expanded': String(expanded), onClick: () => toggleSkillExpanded(entry.id), style: { display: 'flex', alignItems: 'flex-start', gap: '8px', width: '100%', padding: 0, border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' } },
            React.createElement('span', { 'aria-hidden': 'true', style: { flexShrink: 0, fontSize: '11px', lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary)' } }, expanded ? '▾' : '▸'),
            React.createElement('div', { style: { minWidth: 0, flex: 1 } }, nameLine))
          const body = expanded ? React.createElement('div', { 'data-testid': 'skill-body-' + entry.name, style: { marginTop: '2px' } },
            React.createElement('div', { style: { display: 'flex', gap: '12px', alignItems: 'flex-start', justifyContent: 'space-between' } },
              React.createElement('div', { style: { minWidth: 0, flex: 1 } }, descLine, usageLine),
              switches),
            noteLine) : null
          return React.createElement('div', { key: entry.id, 'data-testid': 'skill-entry-' + entry.name, style: entryCard },
            headerRow,
            invalidLine,
            body)
        }

        const renderLogBox = (testid, lines, showHeader) => lines.length === 0 ? null : React.createElement('div', { 'data-testid': testid, style: { marginTop: '9px', padding: '7px 10px', borderRadius: '7px', background: 'var(--dsw-alias-bg-layer-3)', border: '1px solid var(--dsw-alias-border-l2)', maxHeight: '130px', overflowY: 'auto' } },
          showHeader ? React.createElement('div', { style: { fontSize: '11px', fontWeight: 700, color: 'var(--dsw-alias-label-secondary)', marginBottom: '3px' } }, translate('skills.log.title')) : null,
          ...lines.map((line, index) => React.createElement('div', { key: index, style: { fontSize: '11px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflowWrap: 'anywhere' } }, line)))

        const renderDescribeDialog = (entryOverride) => {
          if (describe === null) return null
          const entry = entryOverride ?? describe.entry
          const { models, modelItem, draft, busy, error, applied } = describe
          const inputStyle = { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' }
          const diffRows = draft === null ? null : [['description', entry.note !== undefined ? entry.note.description : '', draft.description], ['usage', entry.note !== undefined ? entry.note.usage : '', draft.usage === '' ? null : draft.usage]].map(([field, oldText, newText]) =>
            React.createElement('div', { key: field, 'data-testid': 'skill-diff-' + field, style: { marginBottom: '9px' } },
              React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, marginBottom: '3px' } }, translate('skills.apply.' + field)),
              React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', textDecoration: 'line-through', lineHeight: 1.45 } }, translate('skills.apply.old') + '：' + (oldText === '' ? '—' : oldText)),
              React.createElement('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', lineHeight: 1.45 } }, translate('skills.apply.new') + '：' + (newText === null ? translate('skills.apply.keepusage') : newText))))
          return React.createElement('div', { key: 'skill-describe-' + entry.id, 'data-testid': 'skill-describe-dialog', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '12px', padding: '14px 16px', marginBottom: '14px', background: 'var(--dsh-svc-raised-bg)' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
              React.createElement('div', { style: { fontSize: '14px', fontWeight: 700 } }, translate('skills.describe.title', { name: entry.name })),
              React.createElement('button', { type: 'button', onClick: () => setDescribe(null), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '15px' } }, '✕')),
            models === null && error === '' ? React.createElement('p', { style: hint }, translate('skills.describe.models.loading')) : null,
            models !== null && models.length === 0 ? React.createElement('p', { style: hint }, translate('skills.describe.models.empty')) : null,
            models !== null && models.length > 0 ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } },
              React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.describe.model')),
              React.createElement('select', { 'data-testid': 'skill-describe-model', value: modelItem === null ? '' : skillModelKey(modelItem), onChange: (event) => setDescribe((prev) => prev === null ? prev : { ...prev, modelItem: models.find((item) => skillModelKey(item) === event.target.value) ?? null }), style: inputStyle },
                models.map((item) => React.createElement('option', { key: skillModelKey(item), value: skillModelKey(item) }, item.providerName + ' / ' + item.name))),
              draft === null ? React.createElement('button', { type: 'button', 'data-testid': 'skill-describe-run', disabled: busy || modelItem === null, onClick: () => void runDescribe(), style: Object.assign({}, svcButtonStyle('neutral'), { fontSize: '12px', minHeight: '28px', padding: '4px 12px', cursor: busy ? 'default' : 'pointer', opacity: busy || modelItem === null ? 0.55 : 1 }) }, busy ? translate('skills.describe.running') : translate('skills.describe.run')) : null) : null,
            error !== '' ? React.createElement('p', { 'data-testid': 'skill-describe-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSkillErrorMessage(translate, error)) : null,
            renderLogBox('skill-describe-log', describeLogs.map((line) => formatSkillLogLine(translate, line))),
            diffRows,
            applied ? React.createElement('p', { 'data-testid': 'skill-apply-done', style: { ...hint, color: 'var(--dsw-alias-state-success-primary)' } }, '✓ ' + translate('skills.apply.done')) : null,
            draft !== null && !applied ? React.createElement('p', { 'data-testid': 'skill-note-disclaimer', style: { ...hint, fontSize: '11px' } }, translate('skills.note.panelOnly')) : null,
            draft !== null && !applied ? React.createElement('button', { type: 'button', 'data-testid': 'skill-apply-confirm', disabled: busy, onClick: () => void applyDraft(), style: { fontSize: '12px', padding: '6px 16px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.55 : 1 } }, translate('skills.apply.confirm')) : null)
        }

        // 过滤后的可见条目：顶部「全部展开」按钮与分组列表共用同一份口径。
        const needle = filterText.trim().toLowerCase()
        const visibleEntries = data === null ? [] : (needle === '' ? data.entries : data.entries.filter((entry) => entry.name.toLowerCase().includes(needle)))
        const allVisibleExpanded = visibleEntries.length > 0 && visibleEntries.every((entry) => expandedSkillIds.includes(entry.id))
        const toggleAllVisible = () => {
          const visibleIds = visibleEntries.map((entry) => entry.id)
          if (allVisibleExpanded) {
            setExpandedSkillIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
            return
          }
          setExpandedSkillIds((prev) => visibleIds.reduce((next, id) => next.includes(id) ? next : next.concat([id]), prev))
        }

        const renderGroups = () => {
          if (data === null || data.entries.length === 0) return React.createElement('p', { style: hint }, translate('skills.empty'))
          const invalidEntries = visibleEntries.filter((entry) => entry.invalid !== undefined)
          const validEntries = visibleEntries.filter((entry) => entry.invalid === undefined)
          const groups = [
            ['skills.group.auto', validEntries.filter((entry) => entry.invocation.model)],
            ['skills.group.manual', validEntries.filter((entry) => !entry.invocation.model && entry.invocation.user)],
            ['skills.group.disabled', validEntries.filter((entry) => !entry.invocation.model && !entry.invocation.user)],
          ]
          const renderItem = (entry) => {
            const entryNode = renderEntry(entry)
            if (describe !== null && describe.entry.id === entry.id) {
              return [entryNode, renderDescribeDialog(entry)]
            }
            return [entryNode]
          }
          return React.createElement('div', null,
            invalidEntries.length > 0 ? React.createElement('div', { 'data-testid': 'skills-invalid-group', style: { marginBottom: '12px' } }, invalidEntries.flatMap(renderItem)) : null,
            groups.map(([label, items]) => items.length === 0 ? null : React.createElement('div', { key: label, 'data-testid': 'skills-group-' + label.split('.').pop(), style: { marginBottom: '14px' } },
              React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, margin: '0 0 7px', color: 'var(--dsw-alias-label-secondary)' } }, translate(label) + ' · ' + items.length),
              items.flatMap(renderItem))))
        }

        // 跳过原因 → 本地化标签：已知原因走词典，未知原因原样透出（已注释条目不再进跳过清单，
        // 而是单列「将覆盖」候选，见 renderBatchCard）。
        const skipReasonLabel = (reason) => {
          if (reason === 'shadowed') return translate('skills.skip.shadowed')
          if (typeof reason === 'string' && reason.startsWith('legacy-invocation-key')) return translate('skills.skip.reason.legacy-invocation-key')
          const mapped = translate('skills.skip.reason.' + reason)
          return mapped === 'skills.skip.reason.' + reason ? reason : mapped
        }

        const renderBatchCard = () => {
          // 页面刷新会丢掉本端计划但宿主仍停在 planned（孤儿状态）：此时按空闲处理，
          // 让「生成计划」按钮回来形成闭环，而不是卡在没有可用按钮的死路里。
          const effectivePhase = batch !== null && batch.phase === 'planned' && batchPlan === null ? 'idle' : batch !== null ? batch.phase : 'idle'
          const phaseLabel = effectivePhase
          const progress = batch !== null && batch.total > 0 ? Math.round((batch.done / batch.total) * 100) : 0
          const batchAnnotatedCount = Array.isArray(batchPlan?.annotated) ? batchPlan.annotated.length : 0
          return React.createElement('div', { 'data-testid': 'skills-batch-card', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', padding: '13px 15px', margin: '14px 0' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } },
              React.createElement('div', { style: { fontSize: '13.5px', fontWeight: 700 } }, translate('skills.batch.title')),
              React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-collapse', onClick: () => setBatchCardOpen(false), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '12px' } }, translate('skills.batch.collapse') + ' ▴')),
            React.createElement('p', { style: { ...hint, marginTop: '4px' } }, translate('skills.batch.hint')),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '9px', flexWrap: 'wrap' } },
              batchModels !== null && batchModels.length > 0 ? React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, translate('skills.batch.model'),
                React.createElement('select', { 'data-testid': 'skills-batch-model', value: batchModelItem === null ? '' : skillModelKey(batchModelItem), disabled: batchBusy || (batch !== null && batch.phase === 'running'), onChange: (event) => changeSkillsBatchModel(event.target.value), style: { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' } },
                  batchModels.map((item) => React.createElement('option', { key: skillModelKey(item), value: skillModelKey(item) }, item.providerName + ' / ' + item.name)))) : null,
              effectivePhase === 'idle' || effectivePhase === 'done' || effectivePhase === 'cancelled' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-plan', disabled: batchBusy, onClick: () => void planBatch(), style: Object.assign({}, svcButtonStyle('neutral'), { cursor: batchBusy ? 'default' : 'pointer', opacity: batchBusy ? 0.55 : 1 }) }, translate('skills.batch.plan')) : null,
              batchPlan !== null ? React.createElement('span', { 'data-testid': 'skills-batch-candidates', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                translate('skills.batch.candidates', { count: batchPlan.candidates.length }) + (batchPlan.estBytes > 0 ? ' · ' + translate('skills.batch.estBytes', { size: formatSkillBytes(batchPlan.estBytes) }) : '') + (batchAnnotatedCount > 0 ? ' · ' + translate('skills.batch.annotated', { count: batchAnnotatedCount }) : '') + ' · ' + translate('skills.batch.skipped', { count: batchPlan.skipped.length })) : null,
              batchPlan !== null && effectivePhase === 'planned' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-start', disabled: batchBusy || (batchPlan.candidates.length === 0 && batchAnnotatedCount === 0), onClick: () => void startBatch(), title: batchAnnotatedArmed ? translate('skills.switch.confirm') : undefined, style: { fontSize: '12px', padding: '5px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', background: batchAnnotatedArmed ? 'var(--dsh-svc-warning)' : 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: batchBusy ? 'default' : 'pointer', opacity: batchBusy ? 0.55 : 1 } }, batchAnnotatedArmed && batchAnnotatedCount > 0 ? translate('skills.batch.forceConfirm', { count: batchAnnotatedCount }) : translate('skills.batch.start')) : null,
              batch !== null && batch.phase === 'running' ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-cancel', onClick: () => void cancelBatch(), style: { fontSize: '12px', padding: '4px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer' } }, translate('skills.batch.cancel')) : null,
              batch !== null ? React.createElement('span', { 'data-testid': 'skills-batch-phase', style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('skills.batch.phase.' + phaseLabel)) : null),
            batchPlan !== null && batchPlan.candidates.length === 0 && batchAnnotatedCount === 0 ? React.createElement('p', { style: hint }, translate('skills.batch.no-candidates')) : null,
            // 跳过清单不只报数量：可展开查看每条的名称与原因（宿主本来就下发了 name+reason）。
            (() => {
              if (batchPlan === null || batchPlan.skipped.length === 0) return null
              return React.createElement('div', { 'data-testid': 'skills-batch-skipped', style: { marginTop: '6px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-skipped-toggle', onClick: () => setSkippedOpen((value) => !value), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '11.5px', padding: 0 } },
                  (skippedOpen ? '▾ ' : '▸ ') + translate('skills.skippedList') + '（' + batchPlan.skipped.length + '）'),
                skippedOpen ? React.createElement('div', { style: { marginTop: '4px', fontSize: '11.5px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' } },
                  batchPlan.skipped.map((item, index) => React.createElement('div', { key: item.id ?? index, 'data-testid': 'skills-batch-skipped-item' },
                    (item.name === '' ? item.id : item.name) + translate('skills.colon') + skipReasonLabel(item.reason)))) : null)
            })(),
            // 将覆盖清单：已注释条目单列，展开看名称（强制覆盖前先看后果清单，两段式确认具象化）。
            (() => {
              const annotatedItems = Array.isArray(batchPlan?.annotated) ? batchPlan.annotated : []
              if (batchPlan === null || annotatedItems.length === 0) return null
              return React.createElement('div', { 'data-testid': 'skills-batch-annotated', style: { marginTop: '6px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-annotated-toggle', onClick: () => setAnnotatedListOpen((value) => !value), style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '11.5px', padding: 0 } },
                  (annotatedListOpen ? '▾ ' : '▸ ') + translate('skills.batch.annotatedList') + '（' + annotatedItems.length + '）'),
                annotatedListOpen ? React.createElement('div', { style: { marginTop: '4px', fontSize: '11.5px', lineHeight: 1.6, color: 'var(--dsh-svc-warning)' } },
                  annotatedItems.map((item, index) => React.createElement('div', { key: item.id ?? index, 'data-testid': 'skills-batch-annotated-item' },
                    (item.name === '' ? item.id : item.name)))) : null)
            })(),
            batch !== null && batch.total > 0 && effectivePhase !== 'idle' ? (() => {
              const failuresNode = Array.isArray(batch.failures) && batch.failures.length > 0 ? React.createElement('div', { 'data-testid': 'skills-batch-failures', style: { marginTop: '7px', fontSize: '11.5px', color: 'var(--dsw-alias-state-error-primary)', lineHeight: 1.5 } },
                translate('skills.batch.failures', { count: batch.failures.length }) + '：' + batch.failures.map((failure) => failure.name + '(' + failure.reason + ')').join('、')) : null
              const logLines = Array.isArray(batch.logs) ? batch.logs : []
              const logNode = logLines.length === 0 ? null : React.createElement('div', null,
                React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-log-toggle', onClick: () => setBatchLogOpen((value) => !value), style: { marginTop: '7px', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: '11.5px', padding: 0 } },
                  (batchLogOpen ? '▾ ' : '▸ ') + translate('skills.log.title') + '（' + logLines.length + '）'),
                batchLogOpen ? renderLogBox('skills-batch-log', logLines.slice(-30).map((line) => formatSkillLogLine(translate, line)), false) : null)
              return React.createElement('div', { style: { marginTop: '10px' } },
                React.createElement('div', { 'data-testid': 'skills-batch-progress', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' } },
                  translate('skills.batch.progress', { done: batch.done, total: batch.total }) + (batch.current !== null ? ' · ' + translate('skills.batch.current', { name: batch.current }) : '')),
                React.createElement('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--dsw-alias-bg-layer-3)', overflow: 'hidden' } },
                  React.createElement('div', { style: { height: '100%', width: progress + '%', background: 'var(--dsw-alias-state-success-primary)', transition: 'width .3s' } })),
                failuresNode,
                logNode)
            })() : null)
        }

        // 批量注释默认折叠成单个入口按钮；有任务在途（运行/待开始）时自动展开。
        const [batchCardOpen, setBatchCardOpen] = useState(false)
        useEffect(() => {
          if (batch !== null && (batch.phase === 'running' || batch.phase === 'planned')) setBatchCardOpen(true)
        }, [batch !== null && batch.phase])
        // 维护子页统一用卡式容器（同 subagent-section 的 cardStyle / restart-card 的 card），
        // 使本页首块与其它子页一样从 tab-panel 内容顶开始、底部留出同量留白。
        return React.createElement('div', { 'data-testid': 'skills-section', style: svcCardStyle() },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
            React.createElement('input', { 'data-testid': 'skills-filter', value: filterText, placeholder: translate('skills.filter'), onChange: (event) => setFilterText(event.target.value), style: { fontSize: '12px', padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', width: '200px' } }),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
              // 条目默认折叠：一键全开/全收当前可见条目（过滤后只作用于命中的那些）。
              React.createElement('button', { type: 'button', 'data-testid': 'skills-expand-all', 'data-variant': 'neutral', disabled: visibleEntries.length === 0, style: Object.assign({}, svcButtonStyle('neutral'), { minHeight: '28px', padding: '4px 10px', fontSize: '12px', cursor: visibleEntries.length === 0 ? 'default' : 'pointer', opacity: visibleEntries.length === 0 ? 0.55 : 1 }), onClick: () => toggleAllVisible() }, allVisibleExpanded ? translate('skills.collapseAll') : translate('skills.expandAll')),
              // v0.39：技能的设置页左列入口已撤销（维护页内有完整功能），只剩刷新按钮。
              // v0.39 统一：刷新钮三胞胎（usage/skills/sessions）同一紧凑 neutral 视觉。
              React.createElement('button', { type: 'button', 'data-testid': 'skills-refresh', 'data-variant': 'neutral', style: Object.assign({}, svcButtonStyle('neutral'), { minHeight: '28px', padding: '4px 10px', fontSize: '12px' }), onClick: () => void load() }, '↻'))),
          loading && data === null ? React.createElement('p', { style: hint }, '…') : null,
          (error !== '' || batchError !== '') ? React.createElement('p', { 'data-testid': 'skills-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSkillErrorMessage(translate, error !== '' ? error : batchError)) : null,
          data !== null && data.llmAvailable ? React.createElement('button', { type: 'button', 'data-testid': 'skills-batch-toggle', 'aria-expanded': String(batchCardOpen), onClick: () => setBatchCardOpen((value) => !value), style: { margin: '0 0 12px', fontSize: '12px', padding: '6px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid ' + (batchCardOpen ? 'var(--dsw-alias-label-dimmed)' : 'var(--dsh-svc-border-strong)'), background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' } }, (batchCardOpen ? '▾ ' : '▸ ') + translate('skills.batch.toggle')) : null,
          batchCardOpen && data !== null && data.llmAvailable ? renderBatchCard() : null,
          renderGroups())
      }

      function QuotaSection() {
        return React.createElement(RemoteQuotaCard, null)
      }

      // ─── 会话管理（v0.35）：列表/搜索/详情/导出/归档/删除 ──────────────────
      // v0.36：体积不在列表下发，行内懒加载（sessions-bytes）；非正数不渲染占位符。
      function formatBytes(value) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return ''
        if (value === 0) return '0 B'
        const units = ['B', 'KB', 'MB', 'GB']
        let size = value
        let unit = 0
        while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
        return (unit === 0 ? String(size) : size.toFixed(1)) + ' ' + units[unit]
      }
      function formatSessionTime(value, translate) {
        if (typeof value !== 'number' || value <= 0) return translate('sessions.status.unavailableTime')
        try { return new Date(value).toLocaleString() } catch (_) { return String(value) }
      }
      function highlightSessionSnippet(text, query, keyPrefix) {
        const source = typeof text === 'string' ? text : ''
        const tokens = typeof query === 'string' ? query.trim().split(/\s+/).filter(Boolean) : []
        if (source === '' || tokens.length === 0) return source
        let pattern
        try {
          pattern = new RegExp(tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'gi')
        } catch (_) {
          return source
        }
        const children = []
        let cursor = 0
        let match
        let index = 0
        while ((match = pattern.exec(source)) !== null) {
          if (match.index > cursor) children.push(source.slice(cursor, match.index))
          children.push(React.createElement('mark', { key: keyPrefix + '-' + index, 'data-testid': keyPrefix + '-' + index, style: { background: 'rgba(198,128,0,0.24)', color: 'inherit', borderRadius: '3px', padding: '0 1px' } }, match[0]))
          cursor = match.index + match[0].length
          index += 1
        }
        if (children.length === 0) return source
        if (cursor < source.length) children.push(source.slice(cursor))
        return children
      }
      function mapSessionError(translate, code) {
        // 白屏修复二道闸：rpcCall 出口已把枚举对象归一为字符串；此处兜底把一切
        // 非字符串（未来绕过归一层的形状）压成可读文本，杜绝对象进 React children。
        if (typeof code !== 'string') {
          const error = code && typeof code === 'object' ? code : {}
          return typeof error.message === 'string' && error.message !== '' ? error.message : typeof error.code === 'string' && error.code !== '' ? error.code : 'unknown'
        }
        if (code === 'feature-disabled') return translate('sessions.error.feature-disabled')
        if (code === 'session-not-found') return translate('sessions.error.session-not-found')
        if (code === 'live-session-rejected') return translate('sessions.error.live-session-rejected')
        if (code === 'session-not-archived') return translate('sessions.error.session-not-archived')
        if (code === 'unknown-delete-plan') return translate('sessions.error.unknown-delete-plan')
        if (code === 'invalid-session-ids') return translate('sessions.error.invalid-session-ids')
        if (code === 'unarchive-unsupported') return translate('sessions.error.unarchive-unsupported')
        if (code === 'network') return translate('sessions.error.network')
        return code
      }
      // v0.36（用户点名「查看渲染优化」）：连续的系统事件合并为一块（DOM/视觉噪音双降），
      // 点击展开显示明细。普通事件原样保留。
      // v1.6.x（用户点名「tool 相关的消息也默认折叠」）：宿主对工具消息同样打 tool 标志
      // （tool/* 事件 + 通篇只有工具调用的 assistant/message），此处按**同类的连续事件**合并——
      // 系统事件与工具消息各自成块、绝不混排（两类事件语义不同，混排后块标题说不清）。
      // 记 firstIndex/lastIndex（块在 items 里的闭区间下标）：块成员恰好是这段切片，展开时直接
      // slice，不必按 seq 数值区间回扫全表（也免疫个别事件 seq 缺失）。
      // 返回 [{_block:'noise'|'tool', count, firstSeq, lastSeq, firstIndex, lastIndex} | event]。
      function collapseEventItems(items) {
        const out = []
        const list = Array.isArray(items) ? items : []
        for (let index = 0; index < list.length; index += 1) {
          const item = list[index]
          const kind = item.noise === true ? 'noise' : item.tool === true ? 'tool' : null
          if (kind === null) {
            out.push(item)
            continue
          }
          const last = out[out.length - 1]
          if (last !== undefined && last._block === kind) {
            last.count += 1
            last.lastSeq = item.seq
            last.lastIndex = index
          } else {
            out.push({ _block: kind, count: 1, firstSeq: item.seq, lastSeq: item.seq, firstIndex: index, lastIndex: index })
          }
        }
        return out
      }

      // v0.37 用户点名「查看详情后返回列表维持原位置」：进详情前记录列表滚动位置，返回时恢复。
      // 滚动容器不是本插件的 DOM——官方设置面板的内容列（.VOzbGW_options，overflow-y:auto）在
      // panel > content 里，跨列表⇄详情切换一直挂载（哈希类名跨版本会漂，故不按类名找）。
      // 从点击行的 DOM 祖先链向上找第一个「真的能滚」的滚动祖先（computed overflowY；测试替身
      // 无 document 时回落 inline style）。找不到容器（宽度撑不满/异常布局）= 无需恢复，静默降级。
      function findSessionScrollContainer(event) {
        let node = event !== null && event !== undefined && event.currentTarget ? event.currentTarget : null
        const doc = typeof document !== 'undefined' ? document : null
        while (node !== null && node !== undefined && node.nodeType === 1) {
          let overflowY = ''
          if (doc !== null && doc.defaultView && typeof doc.defaultView.getComputedStyle === 'function') {
            try {
              const style = doc.defaultView.getComputedStyle(node)
              overflowY = style ? String(style.overflowY || '') : ''
            } catch (_) { /* 个别节点 computed style 抛错：当无样式处理 */ }
          } else if (node.style) {
            overflowY = String(node.style.overflowY || node.style.overflow || '')
          }
          if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
            && typeof node.scrollHeight === 'number' && typeof node.clientHeight === 'number'
            && node.scrollHeight > node.clientHeight + 1) {
            return node
          }
          node = node.parentNode
        }
        return null
      }

      // v0.37 搜索命中定位（参考 dsh-session-kb 的 Locate）：命中窗口渲染完成后把详情滚动到
      // 目标命中行并闪烁高亮 2s。行按 testid sessions-jump-target-<seq> 找（seq 来自宿主可信
      // 清单，非用户输入）；滚动为 best-effort——测试替身无真实 DOM/行未渲染时静默跳过。
      function jumpScrollToHit(seq) {
        if (typeof document === 'undefined' || document === null) return () => {}
        try {
          const element = document.querySelector('[data-testid="sessions-jump-target-' + seq + '"]')
          if (element === null || element === undefined) return () => {}
          try {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } catch (_) {
            try { element.scrollIntoView() } catch (_) {}
          }
          if (element.classList && typeof element.classList.add === 'function') {
            element.classList.add('dshsv-locate-flash')
            const disposeTimer = ctx.timer.timeout(() => {
              try {
                if (element.classList && typeof element.classList.remove === 'function') element.classList.remove('dshsv-locate-flash')
              } catch (_) {}
            }, 2000)
            return () => {
              disposeTimer()
              try {
                if (element.classList && typeof element.classList.remove === 'function') element.classList.remove('dshsv-locate-flash')
              } catch (_) {}
            }
          }
        } catch (_) {
          // 定位滚动失败不影响查看：保持现状
        }
        return () => {}
      }

      // v0.36 用户反馈「关掉面板再打开又要重新加载」：列表/体积缓存从组件 state 提升到
      // **模块级**（页面加载期间一直存活，设置面板关闭只是组件卸载、数据保留；刷新页面才清零）。
      // 测试替代环境的 ?test= 查询串让每个 renderer 独立评估本模块，互不污染。
      const sessionPanelListCache = { all: undefined, archived: undefined, deleted: undefined }
      const sessionPanelBytesCache = new Map()
      // v0.36 详情正文 markdown：复用官方渲染器 @deepseek-ai/dsh-client-ui-primitives 的
      // MarkdownText（untrusted 安全设计，老 DSH 缺席时 try/catch 回落纯文本）。
      // 官方导出是 React.memo 返回对象（keys=[$$typeof,type,compare]），createElement 直通——
      // 判「可渲染组件」认 function 或 exotic $$typeof（memo/forwardRef/lazy），
      // {default: fn} 互操作形态作第二候选解包（把 memo 对象当不可用是当初误判的根源）。
      const EXOTIC_COMPONENT_TYPES = [Symbol.for('react.memo'), Symbol.for('react.forward_ref'), Symbol.for('react.lazy')]
      const isRenderableComponent = (value) => {
        if (typeof value === 'function') return true
        if (value !== null && typeof value === 'object' && typeof value.$$typeof === 'symbol') {
          return EXOTIC_COMPONENT_TYPES.includes(value.$$typeof)
        }
        return false
      }
      let sessionMarkdownText = null
      // v1.4.2 修复（alpha.4 详情空白根因）：外壳 MarkdownText 的代码块渲染器无条件读
      // labels.code.copyLabel / labels.code.copiedLabel（脚注标题同族 labels.footnotes）。
      // 选项对象不像 text 有默认值——缺失又碰到 ``` 栅栏就会 TypeError 把整个 settings.section
      // 崩成空白。词典键带兜底常量：即便未来词典缺键也绝不传 undefined。memo 组件用同一引用
      // 无妨（labels 只是文案字典，不参与渲染 memo 判定）；逐次新建只为语言切换即时生效。
      const sessionMarkdownLabels = (translate) => {
        const copy = translate('sessions.md.copy')
        const copied = translate('sessions.md.copied')
        const footnotes = translate('sessions.md.footnotes')
        return {
          code: {
            copyLabel: typeof copy === 'string' && copy !== '' ? copy : 'Copy',
            copiedLabel: typeof copied === 'string' && copied !== '' ? copied : 'Copied',
          },
          footnotes: typeof footnotes === 'string' && footnotes !== '' ? footnotes : 'Footnotes',
        }
      }
      try {
        const uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives')
        let candidate = uiPrimitives === null || uiPrimitives === undefined ? null : uiPrimitives.MarkdownText
        // 直通判定：函数 / memo / forwardRef / lazy。
        if (isRenderableComponent(candidate)) {
          sessionMarkdownText = candidate
        } else if (candidate !== null && typeof candidate === 'object') {
          // 互操作命名空间包裹 {default: fn}：解包后再判定。
          const unwrapped = typeof candidate.default === 'function' ? candidate.default
            : typeof candidate.MarkdownText === 'function' ? candidate.MarkdownText
              : null
          candidate = unwrapped
          if (isRenderableComponent(candidate)) {
            sessionMarkdownText = candidate
          } else {
            let shape = String(typeof candidate)
            try { shape += ' keys=[' + Object.keys(candidate).join(',') + ']' } catch (_) {}
            console.warn('[dsh-service-md] MarkdownText is an unexpected value (' + shape + ') — falling back to plain text')
          }
        } else {
          // v0.36 排查埋点（[dsh-service-md] tag）：seed 拿到了但 MarkdownText 缺席——
          // 之前静默吞掉导致「不渲染却无原因」。打开 DevTools Console 即可看到。
          console.warn('[dsh-service-md] ui-primitives seed present, but MarkdownText unavailable (' + typeof candidate + ') — falling back to plain text')
        }
      } catch (error) {
        // v0.36 排查埋点：老外壳 seed 缺席 require 抛错——warn 一次让「为何回落」可见。
        console.warn('[dsh-service-md] ui-primitives require failed: ' + (error && error.message ? error.message : String(error)))
      }
      if (sessionMarkdownText !== null) console.info('[dsh-service-md] session detail markdown renderer ready')

      function SessionsSection() {
        const translate = useTranslation()
        const { useState, useEffect, useRef } = React
        const [navEnabled, setNavEnabled] = sessionsNavToggle.useEnabled()
        // 列表状态
        // 测试替身 React 的 useState 只接受直接值（不接受初始化函数），模块缓存读取放表达式里。
        const cachedArchivedList = sessionPanelListCache.archived
        const [list, setList] = useState(cachedArchivedList !== undefined ? cachedArchivedList : null)
        // v0.36：列表/体积为模块级缓存——面板关闭再打开直接复用（零 RPC 秒开），
        // 切换筛选走同一缓存；「刷新」按钮强制重拉（用户反馈：关闭再打开不该重新加载）。
        const [loading, setLoading] = useState(cachedArchivedList === undefined)
        const [error, setError] = useState('')
        // v0.36：行体积懒加载——bytesById 初始自模块级缓存，跨面板关闭复用
        //（刷新浏览器/宿主重启后宿主另有内存缓存接管 sessions-bytes 秒回）。
        const [bytesById, setBytesById] = useState(Object.fromEntries(sessionPanelBytesCache))
        const bytesInFlight = useRef(new Set())
        // v0.35 用户反馈：默认停在「仅归档」——不再每次打开都全量拉全部会话（过得快）。
        const [filter, setFilter] = useState('archived')      // all | archived | deleted
        // 子代理正交筛选（toggle，非第四 scope）：all/archived 下叠加过滤 subagent 行；
        // deleted 墓碑记录无该标志，chip 在该视图隐藏但状态保留（切回即恢复）。
        const [subagentOnly, setSubagentOnly] = useState(false)
        const [sort, setSort] = useState('createdDesc')      // createdDesc | createdAsc | title | project
        // v1.4.x：按项目分区默认折叠——展开集合按项目路径记忆于组件 state（切换筛选/排序保留，
        // 面板重开回默认折叠；初始恒空 = 全折叠）。
        const [expandedProjects, setExpandedProjects] = useState([])
        const toggleProjectExpanded = (project) => setExpandedProjects((current) => current.includes(project) ? current.filter((value) => value !== project) : [...current, project])
        // 批量选择只作用于当前普通列表视图：进入后可点击整行（复选框仍可单独操作）或全选当前筛选结果；
        // 搜索结果/已删除记录不进入批量模式，切换筛选或进入详情时自动退出，避免把隐藏行带进选择集。
        const [batchMode, setBatchMode] = useState(false)
        const [selectedIds, setSelectedIds] = useState([])
        const [search, setSearch] = useState('')
        const [searchScopeArchived, setSearchScopeArchived] = useState(false)
        const [searchRunning, setSearchRunning] = useState(false)
        const [searchResult, setSearchResult] = useState(null)
        // 详情状态
        const [detail, setDetail] = useState(null)            // {sessionId, title, view: 'events'|'search', cursor, items, total, hitItems}
        const [detailLoading, setDetailLoading] = useState(false)
        const [detailError, setDetailError] = useState('')
        // v0.36：系统事件块的展开态（key=块首条 seq），默认折叠；v1.6.x 起工具消息块共用
        // 这一张表（seq 全局唯一，两类块不会撞 key）。显式记录的是**用户点击后的目标态**——
        // 传入当前生效态取反，块因命中自动展开时第一次点击就是「收起」（不是又置成展开）。
        const [eventBlockOpen, setEventBlockOpen] = useState({})
        const toggleEventBlock = (firstSeq, open) => setEventBlockOpen((current) => ({ ...current, [firstSeq]: !open }))
        // v0.37 详情返回保持列表滚动位置：进详情时保存一次、回列表时恢复一次。记录当下列表
        // 上下文（筛选/排序/搜索），返回时上下文一致才回写 scrollTop——在详情里切了筛选/
        // 搜了新词，列表内容已换，不恢复旧位置（避免冲到别的视图上）。
        const savedListScroll = useRef(null)
        const listScrollKey = () => filter + '\u0000' + sort + '\u0000' + search + '\u0000' + (searchScopeArchived ? 1 : 0)
        // 导出状态
        const [exportingId, setExportingId] = useState('')
        const [exportError, setExportError] = useState('')
        // 批量操作状态：按钮只处理当前选择中符合各动作边界的行（归档排除 live/已归档，
        // 删除只含非 live 的已归档行）；删除仍逐项向宿主申请 plan，并合并到一次确认中。
        const [batchWorking, setBatchWorking] = useState('')
        const [batchResult, setBatchResult] = useState('')
        const [batchError, setBatchError] = useState('')
        // 删除确认状态
        const [deletePlan, setDeletePlan] = useState(null)
        const [deleting, setDeleting] = useState(false)
        const [deleteError, setDeleteError] = useState('')
        const [doneTick, setDoneTick] = useState(0)
        // 清除已删除记录状态
        const [clearPlan, setClearPlan] = useState(null)
        const [clearing, setClearing] = useState(false)
        const [clearError, setClearError] = useState('')
        // 归档/恢复状态
        const [archivingId, setArchivingId] = useState('')
        const [unarchivingId, setUnarchivingId] = useState('')
        const [archiveError, setArchiveError] = useState('')

        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }
        const chipButton = svcRowActionStyle()
        // v0.39 按钮语义（安全教义）：删除初次出现 = 危险描边，实底红只留给最终确认。
        const dangerOutlineButton = Object.assign({}, chipButton, { background: 'transparent', borderColor: 'var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' })
        const dangerSolidButton = Object.assign({}, chipButton, { background: 'var(--dsw-alias-state-error-primary)', borderColor: 'transparent', color: 'var(--dsh-svc-brand-text)' })
        const inputStyle = { fontSize: '12px', padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', width: '100%', boxSizing: 'border-box' }
        const selectStyle = { fontSize: '12px', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', maxWidth: '100%' }

        // 当前筛选对应的宿主 scope：archived/deleted 只在宿主侧拉对应子集，
        // 避免每次打开/切换都全量拉取全部会话（v0.35 用户反馈：全量刷新多余）。
        const scopeForFilter = (key) => key === 'archived' ? 'archived' : key === 'deleted' ? 'deleted' : 'all'
        // v0.36 用户选定「秒显 + 后台静默刷新」：打开面板先渲染缓存，再无感 re-fetch 一次。
        // filterRef 每次渲染同步当前筛选——loadList 响应回来时若视图已切走，不应用 setList（防竞态覆盖）。
        const filterRef = useRef(filter)
        filterRef.current = filter
        const loadList = async (scope, options = {}) => {
          const target = scope !== undefined ? scope : scopeForFilter(filter)
          const cached = sessionPanelListCache[target]
          const reuse = !options.force && cached !== undefined
          if (reuse) {
            setList(cached)
            setError('')
            setLoading(false)
            // 打开面板（组件重挂载）走 silent：秒显缓存后再后台静默刷新一次——
            // 不置 loading、失败保留缓存视图；普通缓存命中（切换筛选）零 RPC 直接返回。
            if (options.silent !== true) return
          } else {
            setLoading(true)
          }
          try {
            const res = await rpcCall('sessions-list', { scope: target })
            if (res.ok) {
              sessionPanelListCache[target] = res.value
              // 竞态防护：静默/普通刷新响应回来时用户可能已切到别的 scope——缓存照写、
              // 视图只在仍处于该 scope 时原地更新（filterRef 是发起后最新值）。
              if (scopeForFilter(filterRef.current) === target) {
                setList(res.value)
                setError('')
              }
            } else if (!(reuse && options.silent)) {
              setError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            if (!(reuse && options.silent)) setError(translate('sessions.error.network'))
          } finally {
            if (!(reuse && options.silent)) setLoading(false)
          }
        }
        const refreshList = () => void loadList(undefined, { force: true })
        const changeFilter = (key) => {
          if (key === filter) return
          setFilter(key)
          setBatchMode(false)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
          setSearch('')
          setSearchResult(null)
          setDetail(null)
          setClearPlan(null)
          setClearError('')
          void loadList(key)
        }
        useEffect(() => { void loadList('archived', { silent: true }) }, [])

        // v0.36：体积懒加载——列表落地后只对缺体积的行发起一次 sessions-bytes 批量请求
        // （分片防超宿主上限）；请求失败留在缺失集，下次列表变更自动重试；筛选切换时
        // bytesById 已在组件状态里，同一面板内不重复请求。
        useEffect(() => {
          if (list === null) return
          const items = Array.isArray(list.items) ? list.items : []
          const missing = []
          for (const item of items) {
            const id = item.id
            if (bytesById[id] !== undefined || bytesInFlight.current.has(id)) continue
            bytesInFlight.current.add(id)
            missing.push(id)
          }
          if (missing.length === 0) return
          let cancelled = false
          const MAX_PER_REQUEST = 100
          const fetchSlice = async (sliceIds) => {
            try {
              const res = await rpcCall('sessions-bytes', { ids: sliceIds })
              if (cancelled) return
              const map = res && res.ok && res.value && typeof res.value.bytes === 'object' ? res.value.bytes : {}
              if (Object.keys(map).length > 0) {
                for (const id of sliceIds) {
                  if (map[id] !== undefined) sessionPanelBytesCache.set(id, map[id])
                }
                setBytesById((current) => {
                  const next = { ...current }
                  for (const id of sliceIds) {
                    if (map[id] !== undefined) next[id] = map[id]
                  }
                  return next
                })
              }
            } catch (_) {
              // 网络失败：保持缺失，下次列表变更重试
            } finally {
              if (!cancelled) {
                for (const id of sliceIds) bytesInFlight.current.delete(id)
              }
            }
          }
          for (let index = 0; index < missing.length; index += MAX_PER_REQUEST) {
            void fetchSlice(missing.slice(index, index + MAX_PER_REQUEST))
          }
          return () => {
            cancelled = true
            for (const id of missing) bytesInFlight.current.delete(id)
          }
        }, [list])

        const runSearch = async (query) => {
          if (query.trim() === '') { setSearchResult(null); return }
          setSearchRunning(true)
          try {
            const res = await rpcCall('sessions-search', {
              query: query.trim(),
              scope: searchScopeArchived ? 'archived' : 'all',
            })
            if (res.ok) setSearchResult(res.value)
            else setSearchResult({ available: true, query, scope: 'all', hits: [], error: res.error })
          } catch (_) {
            setSearchResult({ available: true, query, scope: searchScopeArchived ? 'archived' : 'all', hits: [], error: 'network' })
          } finally {
            setSearchRunning(false)
          }
        }
        // 防抖 300ms
        useEffect(() => {
          if (filter === 'deleted') return
          if (search.trim() === '') { setSearchResult(null); return }
          return ctx.timer.timeout(() => { void runSearch(search) }, 300)
        }, [search, searchScopeArchived, filter])

        const openDetail = (sessionId, view, hitItems, event, targetSeq) => {
          setBatchMode(false)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
          setClearPlan(null)
          setClearError('')
          // v0.37：进详情前沿点击行的 DOM 祖先链找官方面板内容滚动容器（.VOzbGW_options），
          // 记下列表位置；找不到容器（宽度撑不满/异常布局/无点击事件）→ 不保存，返回时保持现状。
          const scrollContainer = findSessionScrollContainer(event)
          if (scrollContainer !== null) {
            savedListScroll.current = { key: listScrollKey(), container: scrollContainer, scrollTop: scrollContainer.scrollTop }
          }
          setEventBlockOpen({})
          setDetail({ sessionId, view: view || 'events', cursor: undefined, items: [], total: 0, hitItems: hitItems || null, loadedTitle: '', centerSeq: undefined })
          setDetailError('')
          setDetailLoading(false)
          if ((view || 'events') === 'search' && Array.isArray(hitItems) && hitItems.length > 0) {
            // v0.37 搜索命中不再从头分页（旧实现浪费一次拉取且看不到上下文）：
            // 直接进命中窗口视图，围绕首个命中（或点击的 seq 芯片）拉上下文窗口。
            const seq = Number.isSafeInteger(targetSeq) ? Number(targetSeq) : Number(hitItems[0].seq)
            void loadJumpWindow(sessionId, Number.isSafeInteger(seq) ? seq : 0)
          } else {
            void loadDetailPage(sessionId, undefined, view || 'events')
          }
        }
        const loadDetailPage = async (sessionId, cursor, view) => {
          setDetailLoading(true)
          try {
            const res = await rpcCall('sessions-view', { id: sessionId, cursor })
            if (res.ok) {
              setDetail((current) => {
                const merged = current === null ? {} : current
                const appended = cursor === undefined ? (res.value.items || []) : [...(merged.items || []), ...(res.value.items || [])]
                return {
                  ...merged,
                  sessionId,
                  view: view || merged.view || 'events',
                  cursor: res.value.nextCursor,
                  items: appended,
                  total: res.value.total,
                  loadedTitle: merged.loadedTitle || (res.value.session && res.value.session.id !== undefined ? '' : ''),
                }
              })
              setDetailError('')
            } else {
              setDetailError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            setDetailError(translate('sessions.error.network'))
          } finally {
            setDetailLoading(false)
          }
        }
        // v0.37 命中窗口视图：围绕命中 seq 拉上下文窗口（宿主端快照缓存切片，无额外读取）。
        const loadJumpWindow = async (sessionId, seq) => {
          setDetailLoading(true)
          setDetailError('')
          try {
            const res = await rpcCall('sessions-view', { id: sessionId, center: seq })
            if (res.ok) {
              setDetail((current) => {
                const merged = current === null ? {} : current
                return {
                  ...merged,
                  sessionId,
                  view: 'search',
                  cursor: res.value.nextCursor,
                  items: res.value.items || [],
                  total: res.value.total,
                  // 命中行不一定是窗口几何中心（窗口两端被行首/行尾裁剪），以宿主回传为准。
                  centerSeq: Number.isSafeInteger(res.value.centerSeq) ? res.value.centerSeq : seq,
                  loadedTitle: merged.loadedTitle || '',
                }
              })
              setDetailError('')
            } else {
              setDetailError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            setDetailError(translate('sessions.error.network'))
          } finally {
            setDetailLoading(false)
          }
        }

        const downloadSessionExport = async (sessionId) => {
          try {
            const res = await rpcCall('sessions-export', { id: sessionId })
            if (!res.ok) return { ok: false, error: mapSessionError(translate, res.error || 'unknown') }
            // 复用官方 ZIP 下载：HEAD 探测 → 触发浏览器下载（同源 loopback）。
            const url = res.value.url
            const head = await fetch(url, { method: 'HEAD' })
            if (!head.ok) return { ok: false, error: translate('sessions.error.export-failed', { error: 'HTTP ' + head.status }) }
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = 'dsh-session-' + sessionId.replace(/[^A-Za-z0-9_-]/g, '_') + '.zip'
            anchor.click()
            return { ok: true }
          } catch (_) {
            return { ok: false, error: translate('sessions.error.network') }
          }
        }
        const doExport = async (sessionId) => {
          setExportingId(sessionId)
          setExportError('')
          const result = await downloadSessionExport(sessionId)
          if (!result.ok) setExportError(result.error)
          setExportingId('')
          return result
        }

        const applyArchivedSession = (sessionId) => {
          // 本地同步模块级缓存（不重拉）：all/archived 缓存里该行标 archived，
          // archived 缓存缺此行则补入（切「仅归档」/重开面板直接命中新行）。
          const currentAll = sessionPanelListCache.all
          if (currentAll !== undefined && Array.isArray(currentAll.items)) {
            sessionPanelListCache.all = { ...currentAll, items: currentAll.items.map((item) => item.id === sessionId ? { ...item, archived: true } : item) }
          }
          const archived = sessionPanelListCache.archived
          if (archived !== undefined && Array.isArray(archived.items)) {
            const exists = archived.items.some((item) => item.id === sessionId)
            const sourceRow = currentAll?.items?.find((item) => item.id === sessionId)
            sessionPanelListCache.archived = exists
              ? { ...archived, items: archived.items.map((item) => item.id === sessionId ? { ...item, archived: true } : item) }
              : sourceRow !== undefined
                ? { ...archived, items: [{ ...sourceRow, archived: true }, ...archived.items] }
                : archived
          }
          setList((current) => {
            if (current === null || !Array.isArray(current.items)) return current
            return { ...current, items: current.items.map((item) => item.id === sessionId ? { ...item, archived: true } : item) }
          })
        }
        const archiveSession = async (sessionId) => {
          try {
            const res = await rpcCall('sessions-archive', { id: sessionId })
            if (!res.ok) return { ok: false, error: mapSessionError(translate, res.error || 'unknown') }
            applyArchivedSession(sessionId)
            return { ok: true }
          } catch (_) {
            return { ok: false, error: translate('sessions.error.network') }
          }
        }
        const doArchive = async (sessionId) => {
          setArchivingId(sessionId)
          setArchiveError('')
          const result = await archiveSession(sessionId)
          if (!result.ok) setArchiveError(result.error)
          setArchivingId('')
          return result
        }

        const applyUnarchivedSession = (sessionId) => {
          // 本地同步模块级缓存（不重拉）：all 缓存里该行改标 archived: false，
          // archived 缓存移除该行（切「仅归档」不再显示）。
          const currentAll = sessionPanelListCache.all
          if (currentAll !== undefined && Array.isArray(currentAll.items)) {
            sessionPanelListCache.all = { ...currentAll, items: currentAll.items.map((item) => item.id === sessionId ? { ...item, archived: false } : item) }
          }
          const archived = sessionPanelListCache.archived
          if (archived !== undefined && Array.isArray(archived.items)) {
            sessionPanelListCache.archived = { ...archived, items: archived.items.filter((item) => item.id !== sessionId) }
          }
          setList((current) => {
            if (current === null || !Array.isArray(current.items)) return current
            // RPC 在途时可能切换筛选，按响应完成时的当前视图更新。
            if (filterRef.current === 'archived') {
              return { ...current, items: current.items.filter((item) => item.id !== sessionId) }
            }
            return { ...current, items: current.items.map((item) => item.id === sessionId ? { ...item, archived: false } : item) }
          })
        }
        const unarchiveSession = async (sessionId) => {
          try {
            const res = await rpcCall('sessions-unarchive', { id: sessionId })
            if (!res.ok) return { ok: false, error: mapSessionError(translate, res.error || 'unknown') }
            applyUnarchivedSession(sessionId)
            return { ok: true }
          } catch (_) {
            return { ok: false, error: translate('sessions.error.network') }
          }
        }
        const doUnarchive = async (sessionId) => {
          setUnarchivingId(sessionId)
          setArchiveError('')
          const result = await unarchiveSession(sessionId)
          if (!result.ok) setArchiveError(result.error)
          setUnarchivingId('')
          return result
        }

        const requestDelete = async (sessionId) => {
          // 在途防重：确认模态已开时不重复发起 plan。
          if (deletePlan !== null || deleting) return
          setDeleteError('')
          try {
            const res = await rpcCall('sessions-delete-plan', { id: sessionId })
            if (res.ok) {
              setDeletePlan(res.value)
            } else {
              setDeleteError(mapSessionError(translate, res.error || 'unknown'))
            }
          } catch (_) {
            setDeleteError(translate('sessions.error.network'))
          }
        }
        const applyDeletedSession = (session) => {
          const removedId = session?.id ?? ''
          if (removedId === '') return
          // v0.36：删除同步模块级缓存（all/archived 移除行、deleted 缓存补记录）——
          // 切回已加载过的视图/关掉面板再打开都不再重拉；deleted 缓存从未加载时首次切换仍按 scope 拉一次。
          const removedRow = list !== null && Array.isArray(list.items) ? list.items.find((item) => item.id === removedId) : undefined
          const deletedRecord = {
            id: removedId,
            title: typeof session?.title === 'string' ? session.title : (removedRow?.title ?? ''),
            cwd: session?.cwd ?? removedRow?.cwd ?? null,
            deletedAt: Date.now(),
          }
          for (const scope of ['all', 'archived']) {
            const value = sessionPanelListCache[scope]
            if (value !== undefined && Array.isArray(value.items)) {
              sessionPanelListCache[scope] = { ...value, items: value.items.filter((item) => item.id !== removedId) }
            }
          }
          const deletedValue = sessionPanelListCache.deleted
          if (deletedValue !== undefined) {
            sessionPanelListCache.deleted = {
              ...deletedValue,
              deleted: [
                deletedRecord,
                ...(Array.isArray(deletedValue.deleted) ? deletedValue.deleted : []).filter((item) => item.id !== removedId),
              ],
            }
          }
          sessionPanelBytesCache.delete(removedId)
          setList((current) => {
            if (current === null) return current
            const items = Array.isArray(current.items) ? current.items : []
            return {
              ...current,
              items: items.filter((item) => item.id !== removedId),
              deleted: [
                deletedRecord,
                ...(Array.isArray(current.deleted) ? current.deleted : []).filter((item) => item.id !== removedId),
              ],
            }
          })
          setBytesById((current) => {
            const next = { ...current }
            delete next[removedId]
            return next
          })
          bytesInFlight.current.delete(removedId)
        }
        const confirmDelete = async () => {
          if (deletePlan === null || deleting) return
          setDeleting(true)
          setDeleteError('')
          const plans = deletePlan.batch === true && Array.isArray(deletePlan.plans) ? deletePlan.plans : [deletePlan]
          let completed = 0
          let failure = ''
          for (const plan of plans) {
            try {
              const res = await rpcCall('sessions-delete', { planId: plan.planId })
              if (res.ok) {
                completed += 1
                applyDeletedSession(plan.session)
              } else if (failure === '') {
                failure = mapSessionError(translate, res.error || 'unknown')
              }
            } catch (_) {
              if (failure === '') failure = translate('sessions.error.network')
            }
          }
          if (deletePlan.batch === true) {
            setDeletePlan(null)
            setDoneTick((tick) => tick + 1)
            if (failure === '') {
              setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.delete'), count: completed }))
              setBatchError('')
            } else {
              setBatchResult('')
              setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.delete'), done: completed, total: plans.length, error: failure }))
            }
          } else if (failure === '') {
            setDeletePlan(null)
            setDoneTick((tick) => tick + 1)
          } else {
            // 保持单项确认框与旧行为一致：失败原因仍在模态内可见，用户可取消后重新发起计划。
            setDeleteError(failure)
          }
          setDeleting(false)
        }
        // 删除完成自动刷新一次列表（loadList 已做，doneTick 仅用于复位列表外的状态）
        useEffect(() => { if (doneTick > 0) setDetail(null) }, [doneTick])
        // v0.37（用户点名「返回列表不要回到顶部」）：离开详情回到列表时恢复原滚动位置。
        // effect 在列表重新渲染进 DOM 后运行——此时回写 scrollTop 才不会被详情内容的高度
        // 把值裁掉（连详情内滚到深处的场景也一并纠正）。保存的上下文与当前不一致则放弃。
        useEffect(() => {
          if (detail !== null) return
          const saved = savedListScroll.current
          savedListScroll.current = null
          if (saved === null) return
          if (saved.key !== listScrollKey()) return
          if (saved.container === null || saved.container === undefined) return
          const top = typeof saved.scrollTop === 'number' ? saved.scrollTop : 0
          try {
            if (typeof saved.container.scrollTop === 'number') saved.container.scrollTop = top
          } catch (_) {
            // 容器已脱离文档（面板被关）：忽略——下次打开自然从顶部开始
          }
        }, [detail])

        // v0.37 命中窗口自动定位：窗口落地（centerSeq 或 items.length 变化）后滚动到目标命中
        // 行并闪烁高亮——第一次打开与「上一个/下一个命中」翻跳共用，滚动为 best-effort。
        const jumpCenterSeq = detail !== null && detail.view === 'search' ? detail.centerSeq : null
        const jumpItemsLen = detail !== null && detail.view === 'search' && Array.isArray(detail.items) ? detail.items.length : 0
        useEffect(() => {
          if (jumpCenterSeq === null || typeof jumpCenterSeq !== 'number') return
          return jumpScrollToHit(jumpCenterSeq)
        }, [jumpCenterSeq, jumpItemsLen])

        const computeVisibleItems = () => {
          if (list === null) return []
          if (filter === 'deleted') {
            const items = Array.isArray(list.deleted) ? list.deleted : []
            return items.slice().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)).map((item) => ({ ...item, _deleted: true, archived: true }))
          }
          // 宿主按 scope 已过滤（archived 只回归档条目、all 全量）；本地只要排序。
          let items = (Array.isArray(list.items) ? list.items : []).slice()
          // 仅子代理：客户端本地过滤（老宿主无 subagent 字段时无行可命中，视图为空不报错）。
          if (subagentOnly) items = items.filter((item) => item.subagent === true)
          if (sort === 'createdAsc') items.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
          else if (sort === 'title') items.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')))
          // v1.4.x：按项目排序——项目即会话 cwd（行内展示的工作区路径）；同项目内保持默认
          // 的创建时间倒序（最新在前），跨项目按路径字母序。
          else if (sort === 'project') items.sort((a, b) => String(a.cwd || '').localeCompare(String(b.cwd || '')) || (b.createdAt || 0) - (a.createdAt || 0))
          else items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          return items
        }
        const visibleItems = computeVisibleItems()
        const visibleSelectableIds = search.trim() !== ''
          ? []
          : filter === 'deleted'
            ? visibleItems.map((item) => item.id)
            : visibleItems.filter((item) => item._deleted !== true).map((item) => item.id)
        const selectedSet = new Set(selectedIds)
        const selectedItems = visibleItems.filter((item) => selectedSet.has(item.id))
        const batchExportItems = selectedItems.filter((item) => item._deleted !== true)
        const batchArchiveItems = selectedItems.filter((item) => item._deleted !== true && item.live !== true && item.archived !== true)
        const batchUnarchiveItems = selectedItems.filter((item) => item._deleted !== true && item.archived === true)
        const batchDeleteItems = selectedItems.filter((item) => item._deleted !== true && item.live !== true && item.archived === true)
        const batchClearItems = selectedItems.filter((item) => item._deleted === true)
        const allVisibleSelected = visibleSelectableIds.length > 0 && visibleSelectableIds.every((id) => selectedSet.has(id))
        useEffect(() => {
          if (!batchMode) return
          const allowed = new Set(visibleSelectableIds)
          setSelectedIds((current) => {
            const next = current.filter((id) => allowed.has(id))
            return next.length === current.length ? current : next
          })
        }, [list, filter, batchMode, subagentOnly])
        const enterBatchMode = () => {
          setBatchMode(true)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
        }
        const exitBatchMode = () => {
          setBatchMode(false)
          setSelectedIds([])
          setBatchResult('')
          setBatchError('')
        }
        const toggleSelected = (id) => {
          setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
        }
        const toggleSelectAll = () => {
          if (allVisibleSelected) {
            setSelectedIds([])
          } else {
            setSelectedIds(visibleSelectableIds.slice())
          }
        }
        // 选中子代理（批量态一键勾选）：把当前可见条目中的 subagent 行并入选择集
        // （追加语义，不清既有选择）；无可见子代理时按钮 disabled 兜底。
        const visibleSubagentIds = filter === 'deleted'
          ? []
          : visibleItems.filter((item) => item.subagent === true).map((item) => item.id)
        const selectSubagents = () => {
          setSelectedIds((current) => {
            const additions = visibleSubagentIds.filter((id) => !current.includes(id))
            return additions.length === 0 ? current : [...current, ...additions]
          })
        }
        const runBatchExport = async () => {
          if (batchWorking !== '' || batchExportItems.length === 0) return
          setBatchWorking('export')
          setBatchResult('')
          setBatchError('')
          let completed = 0
          let failure = ''
          for (const item of batchExportItems) {
            const result = await downloadSessionExport(item.id)
            if (result.ok) completed += 1
            else if (failure === '') failure = result.error
          }
          if (failure === '') setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.export'), count: completed }))
          else setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.export'), done: completed, total: batchExportItems.length, error: failure }))
          setBatchWorking('')
        }
        const runBatchArchive = async () => {
          if (batchWorking !== '' || batchArchiveItems.length === 0) return
          setBatchWorking('archive')
          setBatchResult('')
          setBatchError('')
          let completed = 0
          let failure = ''
          const ids = batchArchiveItems.map((item) => item.id)
          const completedIds = []
          for (const id of ids) {
            const result = await archiveSession(id)
            if (result.ok) {
              completed += 1
              completedIds.push(id)
            } else if (failure === '') failure = result.error
          }
          if (completedIds.length > 0) setSelectedIds((current) => current.filter((id) => !completedIds.includes(id)))
          if (failure === '') setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.archive'), count: completed }))
          else setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.archive'), done: completed, total: ids.length, error: failure }))
          setBatchWorking('')
        }
        const runBatchUnarchive = async () => {
          if (batchWorking !== '' || batchUnarchiveItems.length === 0) return
          setBatchWorking('unarchive')
          setBatchResult('')
          setBatchError('')
          let completed = 0
          let failure = ''
          const ids = batchUnarchiveItems.map((item) => item.id)
          const completedIds = []
          for (const id of ids) {
            const result = await unarchiveSession(id)
            if (result.ok) {
              completed += 1
              completedIds.push(id)
            } else if (failure === '') failure = result.error
          }
          if (completedIds.length > 0) setSelectedIds((current) => current.filter((id) => !completedIds.includes(id)))
          if (failure === '') setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.unarchive'), count: completed }))
          else setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.unarchive'), done: completed, total: ids.length, error: failure }))
          setBatchWorking('')
        }
        const requestBatchDelete = async () => {
          if (batchWorking !== '' || deletePlan !== null || batchDeleteItems.length === 0) return
          setBatchWorking('delete-plan')
          setBatchResult('')
          setBatchError('')
          const plans = []
          let failure = ''
          for (const item of batchDeleteItems) {
            try {
              const res = await rpcCall('sessions-delete-plan', { id: item.id })
              if (res.ok) plans.push(res.value)
              else if (failure === '') failure = mapSessionError(translate, res.error || 'unknown')
            } catch (_) {
              if (failure === '') failure = translate('sessions.error.network')
            }
          }
          setBatchWorking('')
          if (failure !== '' || plans.length !== batchDeleteItems.length) {
            setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.delete'), done: plans.length, total: batchDeleteItems.length, error: failure || translate('sessions.error.network') }))
            return
          }
          setDeletePlan({
            batch: true,
            plans,
            sessions: plans.map((plan) => plan.session),
            consequences: ['deletes-session-log'],
          })
        }
        const requestClear = (item) => {
          if (clearPlan !== null || clearing) return
          setClearError('')
          setClearPlan({
            batch: false,
            items: [{ id: item.id, title: item.title }],
          })
        }
        const requestBatchClear = () => {
          if (clearPlan !== null || clearing || batchClearItems.length === 0) return
          setClearError('')
          setClearPlan({
            batch: true,
            items: batchClearItems.map((item) => ({ id: item.id, title: item.title })),
          })
        }
        const applyClearedDeletedSessions = (ids) => {
          const idSet = new Set(ids)
          const deletedCache = sessionPanelListCache.deleted
          if (deletedCache !== undefined && Array.isArray(deletedCache.deleted)) {
            sessionPanelListCache.deleted = {
              ...deletedCache,
              deleted: deletedCache.deleted.filter((item) => !idSet.has(item.id)),
            }
          }
          setList((current) => {
            if (current === null) return current
            const currentDeleted = Array.isArray(current.deleted) ? current.deleted : []
            return {
              ...current,
              deleted: currentDeleted.filter((item) => !idSet.has(item.id)),
            }
          })
          setSelectedIds((current) => current.filter((id) => !idSet.has(id)))
        }
        const confirmClear = async () => {
          if (clearPlan === null || clearing) return
          setClearing(true)
          setClearError('')
          const items = Array.isArray(clearPlan.items) ? clearPlan.items : []
          const ids = items.map((item) => item.id)
          const isBatch = clearPlan.batch === true
          try {
            const res = await rpcCall('sessions-clear-deleted', { ids })
            if (res.ok) {
              applyClearedDeletedSessions(ids)
              setClearPlan(null)
              if (isBatch) {
                setBatchResult(translate('sessions.batch.completed', { action: translate('sessions.action.clear'), count: ids.length }))
                setBatchError('')
              }
            } else {
              const msg = mapSessionError(translate, res.error || 'unknown')
              if (isBatch) {
                setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.clear'), done: 0, total: ids.length, error: msg }))
              } else {
                setClearError(msg)
              }
            }
          } catch (_) {
            const msg = translate('sessions.error.network')
            if (isBatch) {
              setBatchError(translate('sessions.batch.failed', { action: translate('sessions.action.clear'), done: 0, total: ids.length, error: msg }))
            } else {
              setClearError(msg)
            }
          } finally {
            setClearing(false)
          }
        }

        const listRow = (item) => {
          const isDeleted = item._deleted === true
          const id = item.id
          const title = isDeleted ? (item.title || translate('sessions.row.noTitle')) : (item.title !== '' ? item.title : translate('sessions.row.noTitle'))
          const live = item.live === true
          const archived = isDeleted || item.archived === true
          const selected = selectedSet.has(id)
          // v0.36：体积懒加载——未返回前不占位（无「—」），返回后行内显示。
          const sizeBit = (() => {
            const value = bytesById[id]
            return typeof value === 'number' && value > 0 ? formatBytes(value) : null
          })()
          const metaBits = [
            live ? translate('sessions.row.live') : (archived ? translate('sessions.row.archived') : null),
            isDeleted ? translate('sessions.row.deleted') : null,
            item.cwd ? translate('sessions.detail.cwd', { cwd: item.cwd }) : null,
            isDeleted ? (item.deletedAt ? formatSessionTime(item.deletedAt, translate) : null) : sizeBit,
          ].filter(Boolean)
          const actions = []
          if (!isDeleted) {
            actions.push(React.createElement('button', { key: 'view', type: 'button', 'data-testid': 'sessions-row-view-' + id, style: chipButton, onClick: (event) => openDetail(id, 'events', null, event) }, translate('sessions.action.view')))
            actions.push(React.createElement('button', { key: 'export', type: 'button', 'data-testid': 'sessions-row-export-' + id, style: chipButton, disabled: exportingId === id, onClick: () => void doExport(id) }, exportingId === id ? translate('sessions.detail.exporting') : translate('sessions.action.export')))
            if (!live && !archived) {
              actions.push(React.createElement('button', { key: 'archive', type: 'button', 'data-testid': 'sessions-row-archive-' + id, style: chipButton, disabled: archivingId === id, onClick: () => void doArchive(id) }, archivingId === id ? translate('sessions.status.working') : translate('sessions.action.archive')))
            }
            if (archived && list?.canUnarchive !== false) {
              actions.push(React.createElement('button', { key: 'unarchive', type: 'button', 'data-testid': 'sessions-row-unarchive-' + id, style: chipButton, disabled: unarchivingId === id, onClick: () => void doUnarchive(id) }, unarchivingId === id ? translate('sessions.status.working') : translate('sessions.action.unarchive')))
            }
            if (!live && archived) {
              actions.push(React.createElement('button', { key: 'delete', type: 'button', 'data-testid': 'sessions-row-delete-' + id, style: dangerOutlineButton, onClick: () => void requestDelete(id) }, translate('sessions.action.delete')))
            }
          } else {
            actions.push(React.createElement('button', { key: 'clear', type: 'button', 'data-testid': 'sessions-row-clear-' + id, style: dangerOutlineButton, onClick: () => void requestClear(item) }, translate('sessions.action.clear')))
          }
          return React.createElement('div', {
            key: id,
            'data-testid': 'sessions-row-' + id,
            'data-selected': batchMode && selected ? 'true' : undefined,
            onClick: batchMode ? () => toggleSelected(id) : undefined,
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: batchMode ? '9px 2px 9px 8px' : '9px 2px', borderBottom: '1px solid var(--dsh-svc-border)', background: 'transparent', borderRadius: '4px', boxShadow: batchMode && selected ? 'inset 3px 0 0 var(--dsw-alias-brand-primary)' : 'none', cursor: batchMode ? 'pointer' : 'default' },
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0, flex: '1 1 auto' } },
              batchMode ? React.createElement('input', {
                type: 'checkbox',
                'data-testid': 'sessions-select-' + id,
                'aria-label': translate('sessions.batch.selectRow', { title }),
                checked: selected,
                onClick: (event) => event.stopPropagation(),
                onChange: () => toggleSelected(id),
                style: { width: '16px', height: '16px', flexShrink: 0, accentColor: 'var(--dsw-alias-brand-primary)', cursor: 'pointer' },
              }) : null,
              React.createElement('div', { style: { minWidth: 0 } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                  React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
                  live ? React.createElement('span', { 'data-testid': 'sessions-tag-live-' + id, style: svcBadgeStyle('success') }, translate('sessions.row.live')) : null,
                  archived ? React.createElement('span', { 'data-testid': 'sessions-tag-archived-' + id, style: svcBadgeStyle('warning') }, translate('sessions.row.archived')) : null,
                  isDeleted ? React.createElement('span', { style: svcBadgeStyle('danger') }, translate('sessions.row.deleted')) : null,
                  !isDeleted && item.subagent === true ? React.createElement('span', { 'data-testid': 'sessions-tag-subagent-' + id, style: svcBadgeStyle('info') }, translate('sessions.row.subagent')) : null),
                React.createElement('div', { 'data-testid': 'sessions-meta-' + id, style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)', marginTop: '3px' } }, metaBits.join(' · ')))),
            !batchMode ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' } }, ...actions) : null)
        }

        const eventCard = (event, index) => {
          const noise = event.noise === true
          // v0.36 用户点名：正文用官方 MarkdownText 渲染（与官方聊天观感一致、主题 token 同源、
          // 默认拒原始 HTML/危险链接）；官方 seed 缺席的老外壳自动回落纯文本（pre-wrap）。
          const body = typeof event.text === 'string' && event.text !== ''
            ? React.createElement('div', { 'data-testid': 'sessions-event-text-' + event.seq, style: { marginTop: '4px' } },
                sessionMarkdownText !== null
                  ? React.createElement(sessionMarkdownText, { text: event.text, labels: sessionMarkdownLabels(translate) })
                  : React.createElement('div', { style: { fontSize: '12px', lineHeight: 1.55, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, event.text))
            : null
          return React.createElement('div', { key: String(event.seq), 'data-testid': 'sessions-event-' + event.seq, style: { padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: noise ? 'transparent' : 'var(--dsw-alias-bg-layer-3)', marginBottom: '5px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } },
              React.createElement('span', { 'data-testid': 'sessions-event-type-' + event.seq, style: { fontWeight: 600, color: noise ? 'inherit' : 'var(--dsw-alias-label-secondary)' } }, noise ? translate('sessions.detail.noise') : event.type),
              event.time ? React.createElement('span', null, formatSessionTime(event.time, translate)) : null),
            body)
        }

        const renderListBody = () => {
          if (loading) return React.createElement('p', { style: hint }, translate('sessions.status.loading'))
          if (error !== '') return React.createElement('p', { 'data-testid': 'sessions-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, error)
          if (search.trim() !== '' && filter !== 'deleted') {
            if (searchResult === null) return React.createElement('p', { style: hint }, searchRunning ? translate('sessions.status.loading') : translate('sessions.search.placeholder'))
            if (searchResult.error) return React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, mapSessionError(translate, searchResult.error))
            if (searchResult.hits.length === 0) return React.createElement('p', { style: hint }, translate('sessions.empty.search', { query: search }))
            return searchResult.hits.map((hit) => React.createElement('div', { key: hit.sessionId, 'data-testid': 'sessions-hit-' + hit.sessionId, style: { padding: '9px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-3)', marginBottom: '6px' } },
              React.createElement('button', { type: 'button', 'data-testid': 'sessions-hit-open-' + hit.sessionId, style: { ...chipButton, border: 0, padding: 0, textAlign: 'left', display: 'inline', maxWidth: '100%' }, onClick: (event) => openDetail(hit.sessionId, 'search', hit.items, event) },
                React.createElement('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, hit.title !== '' ? hit.title : translate('sessions.row.noTitle')),
                React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)', marginLeft: '6px', fontSize: '11.5px' } }, translate('sessions.hit.title', { count: hit.items.length }))),
              // v0.37：命中位置直接可见可点——点 seq 芯片直达该命中（不绕一次「打开→翻跳」）。
              hit.items.length > 1 ? React.createElement('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '5px' } },
                hit.items.map((item) => React.createElement('button', { key: item.seq, type: 'button', 'data-testid': 'sessions-hit-seq-' + hit.sessionId + '-' + item.seq, style: { ...chipButton, padding: '1px 8px', fontSize: '11px', ...fullRound('999px'), color: 'var(--dsw-alias-label-tertiary)' }, onClick: (event) => openDetail(hit.sessionId, 'search', hit.items, event, Number(item.seq)) }, '#' + item.seq))) : null,
              hit.items.slice(0, 1).map((item, index) => React.createElement('div', { key: index, 'data-testid': 'sessions-hit-snippet-' + hit.sessionId, style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginTop: '5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, highlightSessionSnippet(item.snippet, searchResult.query || search, 'sessions-hit-highlight-' + hit.sessionId)))))
          }
          if (visibleItems.length === 0) {
            const emptyKey = filter === 'archived' ? 'sessions.empty.archived' : filter === 'deleted' ? 'sessions.empty.deleted' : 'sessions.empty.all'
            return React.createElement('p', { style: hint }, translate(emptyKey))
          }
          // v1.4.x：按项目排序时分区显示——每个工作区一个分区头（路径 + 会话数），
          // 同项目内保持创建时间倒序；visibleItems 已按 (cwd, createdAt desc) 排序，
          // 分组只做遍历切段，零排序逻辑重复。仅项目排序 + 非已删除视图生效，
          // 已删除视图恒按删除时间倒序平铺（既有行为）。
          // v1.4.x 二轮：分区默认折叠——只渲染分区头，行按需展开（点击分区头切换，
          // 展开集合按项目路径记忆于组件 state：切换筛选/排序保留，重开面板回默认折叠）。
          if (sort !== 'project' || filter === 'deleted') return visibleItems.map(listRow)
          const groups = []
          for (const item of visibleItems) {
            const project = String(item.cwd || '')
            const group = groups.length > 0 && groups[groups.length - 1].project === project ? groups[groups.length - 1] : null
            if (group === null) groups.push({ project, items: [item] })
            else group.items.push(item)
          }
          return groups.map((group, index) => {
            const collapsed = !expandedProjects.includes(group.project)
            return React.createElement('div', {
              key: 'project-group-' + (group.project === '' ? '__none__' : group.project),
              'data-testid': 'sessions-project-group-' + index,
              style: { marginBottom: '14px' },
            },
              React.createElement('div', {
                'data-testid': 'sessions-project-header-' + index,
                'data-project': group.project,
                'data-collapsed': collapsed ? 'true' : 'false',
                role: 'button',
                'aria-expanded': String(!collapsed),
                onClick: () => toggleProjectExpanded(group.project),
                style: { display: 'flex', alignItems: 'baseline', gap: '8px', margin: '0 2px 4px', padding: '2px 5px', borderRadius: '6px', cursor: 'pointer', userSelect: 'none' },
              },
                React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', flex: 'none' } }, translate(collapsed ? 'sessions.glyph.expand' : 'sessions.glyph.collapse')),
                React.createElement('span', { style: { fontSize: '11.5px', fontWeight: 650, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, group.project === '' ? translate('sessions.projectGroup.noCwd') : group.project),
                React.createElement('span', { 'data-testid': 'sessions-project-count-' + index, style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', flexShrink: 0 } }, group.items.length === 1 ? translate('sessions.projectGroup.countOne') : translate('sessions.projectGroup.countMany', { count: group.items.length }))),
              collapsed ? null : group.items.map(listRow))
          })
        }

        const renderDetail = () => {
          if (detail === null) return null
          const target = list !== null && Array.isArray(list.items) ? list.items.find((item) => item.id === detail.sessionId) : undefined
          const targetTitle = search !== '' && detail.view === 'search' && searchResult !== null
            ? (searchResult.hits.find((hit) => hit.sessionId === detail.sessionId)?.title || '')
            : (target !== undefined && target.title !== '' ? target.title : '')
          const mineRow = list !== null && Array.isArray(list.items) ? list.items.find((item) => item.id === detail.sessionId) : undefined
          // v0.37 命中导航：seq 芯片 + 上一个/下一个——翻跳只在详情内换窗口中心，不重载整个会话。
          const hitSeqList = detail.view === 'search' && Array.isArray(detail.hitItems)
            ? detail.hitItems.map((item) => Number(item.seq)).filter((seq) => Number.isSafeInteger(seq))
            : []
          const hitIndex = detail.view === 'search' && typeof detail.centerSeq === 'number' ? hitSeqList.indexOf(detail.centerSeq) : -1
          const jumpPrevSeq = hitIndex > 0 ? hitSeqList[hitIndex - 1] : undefined
          const jumpNextSeq = hitIndex >= 0 && hitIndex < hitSeqList.length - 1 ? hitSeqList[hitIndex + 1] : undefined
          const hitSet = new Set(hitSeqList)
          // 折叠块的两种形态（v0.36 系统事件 / v1.6.x 工具消息）：testid 前缀与文案键各自一套，
          // 渲染与开合逻辑完全共用（成员由 collapseEventItems 记的下标区间切出，与形态无关）。
          // 工具消息块的成员卡沿用原始事件类型（tool/call、tool/result…）——展开就是来看工具
          // 流量的，原始类型比「工具消息」更有信息量。
          const EVENT_BLOCK_KINDS = {
            noise: { testId: 'sessions-noisewall-', countKey: 'sessions.detail.noiseBlock', collapseKey: 'sessions.detail.noiseCollapse' },
            tool: { testId: 'sessions-toolwall-', countKey: 'sessions.detail.toolBlock', collapseKey: 'sessions.detail.toolCollapse' },
          }
          // 详情事件列表渲染（v0.36 噪音折叠 + v0.37 命中高亮共用）：命中行套命中徽章/强调框，
          // 带 sessions-jump-target-<seq> 定位 testid（jumpScrollToHit 按它滚）——折叠块内的
          // 命中行同样要套（否则自动展开后没有锚点、也看不到高亮）。
          // v1.6.x：命中落在折叠块内时**默认展开**——否则搜索跳转的目标行被折叠藏起来，
          // jumpScrollToHit 找不到锚点、用户也看不到高亮（v0.37 的命中定位前提）。用户手动
          // 开合优先于该默认值（显式收起后不再自动弹开）。
          const renderEventList = (items, matchSet) => {
            const eventNode = (item, index) => {
              if (matchSet !== null && matchSet.has(Number(item.seq))) {
                return React.createElement('div', { key: 'jump-' + item.seq, 'data-testid': 'sessions-jump-target-' + item.seq, style: { borderRadius: '8px', border: '1px solid rgba(198,128,0,0.55)', background: 'rgba(198,128,0,0.10)', padding: '6px 8px', marginBottom: '6px' } },
                  React.createElement('div', { 'data-testid': 'sessions-jump-badge-' + item.seq, style: { fontSize: '10.5px', fontWeight: 700, color: 'var(--dsw-alias-state-warn-primary)', marginBottom: '3px' } }, translate('sessions.hit.badge')),
                  eventCard(item, index))
              }
              return eventCard(item, index)
            }
            return collapseEventItems(items).map((item, index) => {
              if (item._block !== undefined) {
                const meta = EVENT_BLOCK_KINDS[item._block]
                const blockEvents = Array.isArray(items) ? items.slice(item.firstIndex, item.lastIndex + 1) : []
                const chosen = eventBlockOpen[item.firstSeq]
                const containsHit = matchSet !== null && blockEvents.some((event) => matchSet.has(Number(event.seq)))
                const open = chosen === undefined ? containsHit : chosen === true
                return React.createElement('div', { key: item._block + '-' + item.firstSeq, 'data-testid': meta.testId + item.firstSeq, style: { padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', marginBottom: '5px' } },
                  React.createElement('button', { type: 'button', 'data-testid': meta.testId + 'toggle-' + item.firstSeq, style: { ...chipButton, border: 0, padding: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px' }, onClick: () => toggleEventBlock(item.firstSeq, open) },
                    translate(open ? 'sessions.glyph.collapse' : 'sessions.glyph.expand') + ' ' + translate(open ? meta.collapseKey : meta.countKey, { count: item.count })),
                  open && blockEvents.length > 0 ? React.createElement('div', { style: { marginTop: '6px' } }, blockEvents.map((event) => eventNode(event, index))) : null)
              }
              return eventNode(item, index)
            })
          }
          return React.createElement('div', { 'data-testid': 'sessions-detail' },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' } },
              React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-back', style: chipButton, onClick: () => setDetail(null) }, translate('sessions.glyph.back') + ' ' + translate('sessions.detail.back')),
              React.createElement('span', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)', minWidth: 0 } }, targetTitle !== '' ? targetTitle : translate('sessions.row.noTitle')),
              !mineRow?.archived ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-open', style: chipButton, onClick: () => { try { (ctx.get?.('uiWorkspace')?.openSession ?? ctx.sessions?.open)?.(detail.sessionId) } catch (_) {} } }, translate('sessions.detail.open')) : React.createElement('span', { title: translate('sessions.detail.archiveDisabled'), style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('sessions.detail.archiveDisabled')),
              React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-export', style: chipButton, disabled: exportingId === detail.sessionId, onClick: () => void doExport(detail.sessionId) }, exportingId === detail.sessionId ? translate('sessions.detail.exporting') : translate('sessions.detail.exportAll'))),
            detail.view === 'search' && detail.hitItems !== null ? React.createElement('div', { 'data-testid': 'sessions-jump-view', style: { marginBottom: '10px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-return-search', style: chipButton, onClick: () => setDetail(null) }, translate('sessions.glyph.back') + ' ' + translate('sessions.hit.return')),
                React.createElement('span', { style: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('sessions.hit.inSession', { count: Array.isArray(detail.hitItems) ? detail.hitItems.length : 0 })),
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-jump-prev', style: chipButton, disabled: jumpPrevSeq === undefined || detailLoading, onClick: () => { if (jumpPrevSeq !== undefined) void loadJumpWindow(detail.sessionId, jumpPrevSeq) } }, translate('sessions.hit.prev')),
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-jump-next', style: chipButton, disabled: jumpNextSeq === undefined || detailLoading, onClick: () => { if (jumpNextSeq !== undefined) void loadJumpWindow(detail.sessionId, jumpNextSeq) } }, translate('sessions.hit.next'))),
              React.createElement('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' } },
                hitSeqList.map((seq) => React.createElement('button', { key: seq, type: 'button', 'data-testid': 'sessions-jump-chip-' + seq, style: { ...chipButton, padding: '1px 8px', fontSize: '11px', ...fullRound('999px'), background: seq === detail.centerSeq ? 'var(--dsh-svc-tab-active-bg)' : 'transparent', color: seq === detail.centerSeq ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsw-alias-label-secondary)' }, onClick: () => void loadJumpWindow(detail.sessionId, seq) }, '#' + seq))),
              detailLoading && detail.items.length === 0 ? React.createElement('p', { style: hint }, translate('sessions.status.loading')) : null,
              renderEventList(detail.items, hitSet),
              detail.cursor !== undefined && detail.items.length > 0 ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-more', style: chipButton, disabled: detailLoading, onClick: () => void loadDetailPage(detail.sessionId, detail.cursor, detail.view) }, translate('sessions.detail.loadMore', { remaining: Math.max(0, detail.total - detail.items.length) })) : null,
              detail.cursor === undefined && detail.items.length > 0 ? React.createElement('p', { style: hint }, translate('sessions.detail.noMore', { total: detail.total })) : null) : null,
            detailError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, detailError) : null,
            detail.view !== 'search' ? renderEventList(detail.items, null) : null,
            detail.view !== 'search' && detail.cursor !== undefined ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-detail-more', style: chipButton, disabled: detailLoading, onClick: () => void loadDetailPage(detail.sessionId, detail.cursor, detail.view) }, translate('sessions.detail.loadMore', { remaining: Math.max(0, detail.total - detail.items.length) })) : null,
            detail.view !== 'search' && detail.cursor === undefined && detail.items.length > 0 ? React.createElement('p', { style: hint }, translate('sessions.detail.noMore', { total: detail.total })) : null)
        }

        const renderClearModal = () => {
          if (clearPlan === null) return null
          const isBatch = clearPlan.batch === true
          const items = Array.isArray(clearPlan.items) ? clearPlan.items : []
          const count = items.length
          return React.createElement('div', { 'data-testid': 'sessions-clear-modal', style: { position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' } },
            React.createElement('div', { style: { width: 'min(480px, calc(100vw - 32px))', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '14px', padding: '18px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' } },
              React.createElement('div', { style: { fontSize: '15px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)', marginBottom: '8px' } }, isBatch ? translate('sessions.batch.clearTitle', { count }) : translate('sessions.clear.title')),
              React.createElement('p', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5, margin: '0 0 10px' } }, isBatch ? translate('sessions.batch.clearBody', { count }) : translate('sessions.clear.body')),
              isBatch
                ? React.createElement('ul', { 'data-testid': 'sessions-clear-list', style: { margin: '0 0 12px', paddingLeft: '18px', maxHeight: '220px', overflowY: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 } },
                    items.map((item) => React.createElement('li', { key: item.id }, item.title || translate('sessions.row.noTitle'))))
                : React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: '12px' } }, items[0]?.title || translate('sessions.row.noTitle')),
              clearError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, clearError) : null,
              React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-clear-cancel', style: chipButton, disabled: clearing, onClick: () => { setClearPlan(null); setClearError('') } }, translate('sessions.clear.cancel')),
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-clear-confirm', style: dangerSolidButton, disabled: clearing, onClick: () => void confirmClear() }, clearing ? translate('sessions.status.working') : translate('sessions.clear.confirm')))))
        }

        const renderDeleteModal = () => {
          if (deletePlan === null) return null
          const batchSessions = deletePlan.batch === true && Array.isArray(deletePlan.sessions) ? deletePlan.sessions : null
          const session = batchSessions === null ? (deletePlan.session || {}) : {}
          return React.createElement('div', { 'data-testid': 'sessions-delete-modal', style: { position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)' } },
            React.createElement('div', { style: { width: 'min(480px, calc(100vw - 32px))', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '14px', padding: '18px', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' } },
              React.createElement('div', { style: { fontSize: '15px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)', marginBottom: '8px' } }, batchSessions === null ? translate('sessions.delete.title') : translate('sessions.batch.deleteTitle', { count: batchSessions.length })),
              React.createElement('p', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5, margin: '0 0 10px' } }, batchSessions === null ? translate('sessions.delete.body') : translate('sessions.batch.deleteBody')),
              batchSessions === null
                ? React.createElement('div', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: '6px' } }, session.title || translate('sessions.row.noTitle'))
                : React.createElement('ul', { 'data-testid': 'sessions-batch-delete-list', style: { margin: '0 0 12px', paddingLeft: '18px', maxHeight: '220px', overflowY: 'auto', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 } },
                    batchSessions.map((item) => React.createElement('li', { key: item.id }, translate('sessions.batch.deleteItem', { title: item.title || translate('sessions.row.noTitle'), bytes: formatBytes(item.bytes) })))),
              batchSessions === null ? React.createElement('ul', { style: { margin: '0 0 12px', paddingLeft: '18px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.7 } },
                React.createElement('li', null, translate('sessions.delete.consequence.log', { bytes: formatBytes(session.bytes) })),
                deletePlan.consequences && deletePlan.consequences.includes('hides-from-official-sidebar') ? React.createElement('li', null, translate('sessions.delete.consequence.sidebar')) : null) : null,
              deleteError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, deleteError) : null,
              React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-delete-cancel', style: chipButton, disabled: deleting, onClick: () => { setDeletePlan(null); setDeleteError('') } }, translate('sessions.delete.cancel')),
                React.createElement('button', { type: 'button', 'data-testid': 'sessions-delete-confirm', style: dangerSolidButton, disabled: deleting, onClick: () => void confirmDelete() }, deleting ? translate('sessions.status.working') : translate('sessions.delete.confirm')))))
        }

        // 根节点带 testid（与 remote-quota-card / restart-card / skills-section 一致），
        // 便于真机取证与结构断言定位这一块；此前是唯一没有根 testid 的顶层页块。
        return React.createElement('div', { 'data-testid': 'sessions-section', style: svcCardStyle() },
          React.createElement('div', { style: sectionTitle }, translate('sessions.title')),
          // v0.35 用户点名：设置页左列入口开关放在面板靠上、筛选标签之前。
          // v0.39 统一：与重启/额度同款胶囊开关（此前是复选框，与其他入口开关不一致）。
          React.createElement('div', { 'data-testid': 'sessions-nav-toggle', style: { margin: '2px 0 8px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } },
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, translate('sessions.navToggle'))),
              React.createElement('button', {
                type: 'button',
                role: 'switch',
                'data-testid': 'sessions-nav-switch',
                'aria-checked': String(navEnabled),
                onClick: () => setNavEnabled(!navEnabled),
                style: { width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: navEnabled ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
              }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: navEnabled ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: navEnabled ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 10px' } },
            (['all', 'archived', 'deleted']).map((key) => React.createElement('button', { key, type: 'button', 'data-testid': 'sessions-filter-' + key, style: { ...chipButton, background: filter === key ? 'var(--dsh-svc-tab-active-bg)' : 'transparent', color: filter === key ? 'var(--dsh-svc-tab-active-text)' : 'var(--dsw-alias-label-primary)', fontWeight: filter === key ? 650 : 400 }, onClick: () => changeFilter(key) }, translate('sessions.filter.' + key))),
            React.createElement('select', { 'data-testid': 'sessions-sort', style: selectStyle, value: sort, onChange: (event) => setSort(event.target.value) },
              React.createElement('option', { value: 'createdDesc' }, translate('sessions.sort.createdDesc')),
              React.createElement('option', { value: 'createdAsc' }, translate('sessions.sort.createdAsc')),
              React.createElement('option', { value: 'title' }, translate('sessions.sort.title')),
              React.createElement('option', { value: 'project' }, translate('sessions.sort.project'))),
            // v0.36：切换筛选复用已取过的 scope 缓存；「刷新」才强制重拉当前 scope。
            React.createElement('button', { type: 'button', 'data-testid': 'sessions-refresh', 'data-variant': 'neutral', style: Object.assign({}, svcButtonStyle('neutral'), { minHeight: '28px', padding: '4px 10px', fontSize: '12px' }), onClick: () => refreshList() }, translate('sessions.refresh')),
            detail === null && search.trim() === '' ? React.createElement('button', {
              type: 'button',
              'data-testid': 'sessions-batch-toggle',
              'data-variant': batchMode ? 'primary' : 'neutral',
              style: Object.assign({}, svcButtonStyle(batchMode ? 'primary' : 'neutral'), { minHeight: '28px', padding: '4px 10px', fontSize: '12px' }),
              onClick: batchMode ? exitBatchMode : enterBatchMode,
            }, translate(batchMode ? 'sessions.batch.exit' : 'sessions.batch.enter')) : null),
          detail === null && batchMode ? React.createElement('div', { 'data-testid': 'sessions-batch-bar', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 10px', padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-3)' } },
            React.createElement('button', { type: 'button', 'data-testid': 'sessions-select-all', style: chipButton, disabled: visibleSelectableIds.length === 0 || batchWorking !== '' || deleting || clearing, onClick: toggleSelectAll }, translate(allVisibleSelected ? 'sessions.batch.clearAll' : 'sessions.batch.selectAll')),
            // 收纳：仅在可见子代理 > 0 时出现（隐藏代替禁用，零子代理视图少一个按钮）。
            filter !== 'deleted' && visibleSubagentIds.length > 0 ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-batch-select-subagents', style: chipButton, disabled: batchWorking !== '' || deleting || clearing, onClick: selectSubagents }, translate('sessions.batch.selectSubagents')) : null,
            React.createElement('span', { 'data-testid': 'sessions-selected-count', style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginRight: 'auto' } }, translate('sessions.batch.selected', { count: selectedIds.length })),
            filter === 'deleted'
              ? React.createElement('button', { type: 'button', 'data-testid': 'sessions-batch-clear', style: dangerOutlineButton, disabled: batchClearItems.length === 0 || batchWorking !== '' || deleting || clearing, onClick: () => void requestBatchClear() }, translate('sessions.batch.clear', { count: batchClearItems.length }))
              : [
                  React.createElement('button', { key: 'export', type: 'button', 'data-testid': 'sessions-batch-export', style: chipButton, disabled: batchExportItems.length === 0 || batchWorking !== '' || deleting || clearing, onClick: () => void runBatchExport() }, batchWorking === 'export' ? translate('sessions.status.working') : translate('sessions.batch.export', { count: batchExportItems.length })),
                  React.createElement('button', { key: 'archive', type: 'button', 'data-testid': 'sessions-batch-archive', style: chipButton, disabled: batchArchiveItems.length === 0 || batchWorking !== '' || deleting || clearing, onClick: () => void runBatchArchive() }, batchWorking === 'archive' ? translate('sessions.status.working') : translate('sessions.batch.archive', { count: batchArchiveItems.length })),
                  list?.canUnarchive !== false ? React.createElement('button', { key: 'unarchive', type: 'button', 'data-testid': 'sessions-batch-unarchive', style: chipButton, disabled: batchUnarchiveItems.length === 0 || batchWorking !== '' || deleting || clearing, onClick: () => void runBatchUnarchive() }, batchWorking === 'unarchive' ? translate('sessions.status.working') : translate('sessions.batch.unarchive', { count: batchUnarchiveItems.length })) : null,
                  React.createElement('button', { key: 'delete', type: 'button', 'data-testid': 'sessions-batch-delete', style: dangerOutlineButton, disabled: batchDeleteItems.length === 0 || batchWorking !== '' || deleting || clearing, onClick: () => void requestBatchDelete() }, batchWorking === 'delete-plan' ? translate('sessions.status.working') : translate('sessions.batch.delete', { count: batchDeleteItems.length })),
                ]) : null,
          detail === null && filter !== 'deleted' ? React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' } },
            React.createElement('input', { 'data-testid': 'sessions-search-input', type: 'text', placeholder: translate('sessions.search.placeholder'), value: search, onChange: (event) => { if (batchMode) exitBatchMode(); setSearch(event.target.value) }, style: inputStyle }),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } },
              React.createElement('input', { type: 'checkbox', 'data-testid': 'sessions-search-archived', checked: searchScopeArchived, onChange: (event) => setSearchScopeArchived(event.target.checked) }),
              translate('sessions.search.archivedOnly')),
            // 仅子代理：与「仅搜归档」同款复选框（收纳：两个「仅…」限定条件归一行、同一控件语言）；
            // 正交于 scope，批量态可用且不退出批量；已删除视图整行隐藏（墓碑记录无该标志）。
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } },
              React.createElement('input', { type: 'checkbox', 'data-testid': 'sessions-filter-subagent', checked: subagentOnly, onChange: (event) => setSubagentOnly(event.target.checked) }),
              translate('sessions.filter.subagent'))) : null,
          archiveError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, archiveError + (list?.canUnarchive !== false ? '' : (' · ' + translate('sessions.oneWayHint')))) : null,
          exportError !== '' ? React.createElement('p', { style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, exportError) : null,
          batchResult !== '' ? React.createElement('p', { 'data-testid': 'sessions-batch-result', style: { ...hint, color: 'var(--dsw-alias-state-success-primary)' } }, batchResult) : null,
          batchError !== '' ? React.createElement('p', { 'data-testid': 'sessions-batch-error', style: { ...hint, color: 'var(--dsw-alias-state-error-primary)' } }, batchError) : null,
          // 老宿主提示：仅子代理开启但本次列表没有携带任何 subagent 标志 → 不是真的没有
          // 子代理，而是宿主半未升级；明示原因，避免「开了筛选列表空了」的困惑。
          (() => {
            const items = list !== null && Array.isArray(list.items) ? list.items : []
            const legacyHost = subagentOnly && filter !== 'deleted' && items.length > 0 && items.every((item) => item.subagent === undefined)
            return legacyHost ? React.createElement('p', { 'data-testid': 'sessions-subagent-legacy-hint', style: { ...hint, color: 'var(--dsh-svc-warning)' } }, translate('sessions.subagent.hostLegacy')) : null
          })(),
          renderDetail() ?? renderListBody(),
          renderDeleteModal(),
          renderClearModal())
      }

      function RemoteQuotaCard() {
        const translate = useTranslation()
        const { value: features } = useFeatures()
        const [quotaNav, setQuotaNav] = quotaNavToggle.useEnabled()
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }
        const [quota, setQuota] = useState(quotaStore.getSnapshot())
        useEffect(() => quotaStore.subscribe(() => setQuota(quotaStore.getSnapshot())), [])
        useEffect(() => {
          acquireQuotaLoop({ all: true })
          return () => releaseQuotaLoop({ all: true })
        }, [])
        // 重置卡分区的展开态（v1.9.1）：默认收起，每个账号只显示最近要到期的那张。
        // 键为 `card:<provider>:<slug>`，与圆环弹窗的展开态互不影响。
        const [expandedResetGroups, setExpandedResetGroups] = useState(new Set())
        const toggleResetGroup = (key) => setExpandedResetGroups((current) => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })
        // 排序与显隐的多端同步：进入额度页时拉一次后端权威值（拉取失败下次进入重试），
        // 并订阅本地/远端变更刷新管理列表。
        useEffect(() => {
          ensureQuotaCardsSynced()
          const update = () => {
            setCardOrder(readQuotaCardOrder())
            setCardHidden(readQuotaCardHidden())
          }
          return subscribeQuotaCards(update)
        }, [])
        const [configError, setConfigError] = useState('')
        const providers = quota.providers || []
        const [cardEditor, setCardEditor] = useState(null)
        // v0.39 卡片分区（确认规格：身份 → 核心余额 → 最紧窗口 → 重置 → 折叠配置）。
        // 配置区（凭据入口/类型切换/手动重置录入）按卡折叠，一次只开一张。
        const [advancedOpen, setAdvancedOpen] = useState(null)
        // v0.20 免次数：草稿只有到期时间与名称；添加成功后清空并保持打开，方便连续追加多条。
        const [cardDraft, setCardDraft] = useState({ expiresAt: '', label: '' })
        // 重置卡编辑器按 (provider, account) 定位：CLIProxyAPI 一行多账号，每个 codex 账号各自记事。
        // account 为 '' 表示 provider 级（zai-coding-cn 等既有渠道，行为与加 account 前一致）。
        const openCardEditor = (row, account = '') => {
          setCardEditor({ provider: row.provider, account })
          setCardDraft({ expiresAt: '', label: '' })
        }
        // 凭据填写窗口（v0.24）：未配置行的「填写 API 密钥」内联表单；宿主写入凭据库后立即强制
        // 重拉该 provider（清退避闸），密钥值只随保存请求发出、绝不回显。
        const [credEditor, setCredEditor] = useState(null)
        const [credDraft, setCredDraft] = useState({ name: '', value: '' })
        // 清除已存凭据的两段式确认武装态（skill 开关同款）：3 秒无第二击自动复位。
        const [credClearArmed, setCredClearArmed] = useState(false)
        useEffect(() => {
          if (!credClearArmed) return undefined
          const handle = setTimeout(() => setCredClearArmed(false), 3000)
          return () => clearTimeout(handle)
        }, [credClearArmed])
        const closeCredEditor = () => {
          setCredEditor(null)
          setCredDraft({ name: '', value: '' })
          setCredClearArmed(false)
        }
        const openCredEditor = (row) => {
          const hints = Array.isArray(row.credentialHints) ? row.credentialHints : []
          // 默认选中「已配置」的那个槽位（别名链里可能已有生效值）；全空才落回主名。
          setCardEditor(null)
          setCredEditor({ provider: row.provider })
          setCredDraft({ name: (hints.find((hint) => hint.configured === true) ?? hints[0])?.name ?? '', value: '' })
          setCredClearArmed(false)
        }
        const credentialFailCopy = (res) => {
          const code = String(res?.error ?? '')
          const known = ['unknown-hint', 'invalid-value', 'credentials-unavailable']
          const reason = known.includes(code) ? translate(`quota.credential.${code}`) : `${code}${res?.detail ? ` (${res.detail})` : ''}`
          return translate('quota.credential.saveFailed', { error: reason })
        }
        const saveCredential = async (providerName) => {
          setConfigError('')
          try {
            const res = await rpcCall('quota-credential-set', { provider: providerName, name: credDraft.name, value: credDraft.value })
            if (res?.ok !== true) {
              setConfigError(credentialFailCopy(res))
              return
            }
            closeCredEditor()
            await refreshProvider(providerName)
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        const clearCredential = async (providerName, name) => {
          setConfigError('')
          try {
            const res = await rpcCall('quota-credential-unset', { provider: providerName, name })
            if (res?.ok !== true) {
              setConfigError(credentialFailCopy(res))
              return
            }
            await refreshProvider(providerName)
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        const saveResetCard = async () => {
          if (cardEditor === null) return
          setConfigError('')
          try {
            const payload = { provider: cardEditor.provider }
            if (typeof cardEditor.account === 'string' && cardEditor.account !== '') payload.account = cardEditor.account
            if (cardDraft.expiresAt !== '') payload.expiresAt = cardDraft.expiresAt
            if (cardDraft.label !== '') payload.label = cardDraft.label
            const res = await rpcCall('quota-reset-card', payload)
            if (res?.ok !== true) {
              setConfigError(translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            setCardDraft({ expiresAt: '', label: '' })
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (error) {
            // 不再一律吞成 Network：透出真实错误（unknown endpoint 等），network 仅作兜底。
            const detail = error instanceof Error && typeof error.message === 'string' && error.message.trim() !== '' ? error.message.trim() : 'network'
            setConfigError(translate('quota.saveFailed', { error: detail }))
          }
        }
        // 逐条移除：provider + 宿主下发的卡片 id 定位，不再依赖「每 provider 一张」的旧约束。
        const removeResetCard = async (providerName, cardId) => {
          setConfigError('')
          try {
            await rpcCall('quota-reset-card', { provider: providerName, remove: true, id: cardId })
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        // 手动刷新：宿主清闸后立即 kick（单飞仍生效）；立刻拉一次快照，之后的落定接续
        // （fetchQuotaSnapshot 的 settle 补拉）统一接管，这里不再自建补拉定时器。
        const refreshProvider = async (providerName) => {
          setConfigError('')
          try {
            const res = await rpcCall('quota-refresh', { provider: providerName })
            if (res?.ok !== true) {
              setConfigError(res?.error === 'unknown-provider' ? translate('quota.unknownProvider') : res?.error === 'not-adapted' ? translate('quota.unadapted') : translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        const requestQuotaConfig = async (payload) => {
          setConfigError('')
          try {
            const res = await rpcCall('quota-config', payload)
            if (res?.ok !== true) {
              setConfigError(res?.error === 'unknown-provider' ? translate('quota.unknownProvider') : translate('quota.saveFailed', { error: String(res?.error ?? '') }))
              return
            }
            await fetchQuotaSnapshot({ scope: 'all' })
          } catch (_) {
            setConfigError(translate('quota.saveFailed', { error: 'network' }))
          }
        }
        // kind 传 null = 显式停用（宿主存 null，baseURL 可推断也不外呼）。
        const adaptProvider = (providerName, kind) => requestQuotaConfig({ provider: providerName, kind })
        // 删掉手动覆盖键，回退 baseURL 自动推断。
        const clearAdaptedKind = (providerName) => requestQuotaConfig({ provider: providerName, clear: true })
        // 卡片排序与显隐：localStorage 名单驱动展示序，后端统一配置多端同步；
        // 新供应商自然排末尾。管理界面照搬「设置栏标签」的列表形态（拖拽 + ↑↓ + 显隐开关）。
        const [cardOrder, setCardOrder] = useState(readQuotaCardOrder())
        const [cardHidden, setCardHidden] = useState(readQuotaCardHidden())
        // 面板开合：平时不显示管理列表，点「调整排序」才展开，避免常驻占位。
        const [reorderMode, setReorderMode] = useState(false)
        const [cardsSavedTip, setCardsSavedTip] = useState(false)
        const [cardDragIndex, setCardDragIndex] = useState(null)
        const cardsSavedTipTimer = useRef(null)
        useEffect(() => () => {
          if (cardsSavedTipTimer.current !== null) cardsSavedTipTimer.current()
          cardsSavedTipTimer.current = null
        }, [])
        // 卡片分区（v0.20）：只展示已适配供应商；未适配/已停用的不渲染灰行，统一收进底部「手动适配」行。
        const adaptedRows = applyQuotaCardOrder(providers.filter((row) => row.adapted === true), cardOrder)
        const hiddenCardSet = new Set(cardHidden)
        const visibleCardRows = adaptedRows.filter((row) => !hiddenCardSet.has(row.provider))
        const candidateRows = providers.filter((row) => row.adapted !== true)
        const quotaSelectStyle = { fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' }
        const showCardsSavedTip = () => {
          setCardsSavedTip(true)
          if (cardsSavedTipTimer.current !== null) cardsSavedTipTimer.current()
          cardsSavedTipTimer.current = ctx.timer.timeout(() => {
            cardsSavedTipTimer.current = null
            setCardsSavedTip(false)
          }, 2000)
        }
        const commitCards = (order, hidden) => {
          setCardOrder(order)
          setCardHidden(hidden)
          commitQuotaCards(order, hidden)
        }
        // 管理列表的展示项：记忆序在前，快照里新出现的按快照相对顺序追加在后。
        const managedCardItems = applyQuotaCardOrder(adaptedRows, cardOrder).map((row) => ({ id: row.provider, label: row.displayName || row.provider }))
        // ↑↓ 换位：以当前管理列表交换相邻项并整体落盘（新见过的供应商一并入册）。
        const moveQuotaCard = (providerName, delta) => {
          const names = managedCardItems.map((item) => item.id)
          const from = names.indexOf(providerName)
          const to = from + delta
          if (from < 0 || to < 0 || to >= names.length || from === to) return
          names.splice(to, 0, names.splice(from, 1)[0])
          commitCards(names, cardHidden)
        }
        const toggleCardVisible = (providerName) => {
          const next = new Set(cardHidden)
          if (next.has(providerName)) next.delete(providerName)
          else next.add(providerName)
          commitCards(managedCardItems.map((item) => item.id), Array.from(next))
        }
        const saveCardsConfig = () => {
          commitCards(managedCardItems.map((item) => item.id), cardHidden)
          showCardsSavedTip()
        }
        const resetCardsConfig = () => {
          setCardOrder([])
          setCardHidden([])
          resetQuotaCards()
          showCardsSavedTip()
        }

        // 手动适配行（未适配/已停用的候选供应商）的选择状态；拆成两个独立 state 避免对象草稿接力更新。
        const [addProvider, setAddProvider] = useState('')
        const [addKind, setAddKind] = useState('')
        // 顶层页块用工厂级 `svcCardStyle()`（同为设置页左列快捷入口的 `RestartSection` 一致）：
        // 上内边距让标题贴住 tab-panel 内容顶，页内首块不再各自写 marginTop。
        // 注意 `RemoteQuotaCard` 还被设置页左列快捷入口直接复用（`renderContent` 原样挂进
        // `settings.section` 槽位、外层无包裹），`card` 的 padding/margin 在两个场景下都成立。
        return React.createElement('div', { 'data-testid': 'remote-quota-card', style: svcCardStyle() },
          // 标题行：左「额度查询」，右「说明 + 左列入口胶囊开关」；开关与标题同一行，说明紧贴开关之前。
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' } },
            React.createElement('div', { style: Object.assign({}, sectionTitle, { margin: 0 }) }, translate('quota.cardTitle')),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 } },
              React.createElement('span', { style: { fontSize: '12px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)', textAlign: 'right' } }, translate('quota.navToggleHint')),
              React.createElement('button', {
                type: 'button',
                role: 'switch',
                'data-testid': 'quota-nav-switch',
                'aria-checked': String(quotaNav),
                'aria-label': translate('quota.navToggle'),
                title: translate('quota.navToggle'),
                onClick: () => setQuotaNav(!quotaNav),
                style: { width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${quotaNav ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: quotaNav ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
              }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: quotaNav ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: quotaNav ? '#fff' : 'var(--dsw-alias-label-tertiary)' } })))),
          configError !== '' ? React.createElement('p', { 'data-testid': 'quota-config-error', style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, configError) : null,
          // 「调整排序」开关（形状照搬设置栏标签管理页：展开列表 + 拖拽/↑↓/显隐 + 恢复默认/保存）。
          ...(adaptedRows.length >= 2
            ? [React.createElement('div', { key: 'quota-reorder-row', style: { display: 'flex', justifyContent: 'flex-end', margin: '2px 0 8px' } },
                React.createElement('button', {
                  type: 'button',
                  'data-testid': 'quota-reorder-toggle',
                  'aria-expanded': String(reorderMode),
                  title: translate('quota.reorder'),
                  onClick: () => setReorderMode(!reorderMode),
                  style: { fontSize: '12px', lineHeight: '20px', padding: '2px 12px', ...fullRound(999), border: `1px solid ${reorderMode ? 'var(--dsw-alias-brand-primary)' : 'var(--dsh-svc-border-strong)'}`, background: 'transparent', color: reorderMode ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
                }, translate('quota.reorder')))]
            : []),
          reorderMode && adaptedRows.length >= 2
            ? React.createElement('div', {
                'data-testid': 'quota-card-order-panel',
                style: { display: 'flex', flexDirection: 'column', gap: '10px', margin: '0 0 12px', padding: '10px 12px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsh-svc-raised-bg)' },
              },
              React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
                React.createElement('div', { style: { minWidth: 0, flex: '1 1 240px' } },
                  React.createElement('div', { 'data-testid': 'quota-card-order-title', style: { fontSize: '13px', fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } }, translate('quota.order.title')),
                  React.createElement('div', { style: { marginTop: '3px', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } }, translate('quota.order.hint'))),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                  cardsSavedTip ? React.createElement('span', {
                    'data-testid': 'quota-card-order-saved',
                    style: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
                  }, '✓ ' + translate('config.navOrder.saved')) : null,
                  React.createElement('button', {
                    type: 'button',
                    'data-testid': 'quota-card-order-reset',
                    onClick: resetCardsConfig,
                    style: svcButtonStyle('ghost'),
                  }, translate('config.navOrder.reset')),
                  React.createElement('button', {
                    type: 'button',
                    'data-testid': 'quota-card-order-save',
                    onClick: saveCardsConfig,
                    style: svcButtonStyle('primary'),
                  }, translate('config.navOrder.save')))),
              React.createElement('div', {
                'data-testid': 'quota-card-order-list',
                style: { display: 'flex', flexDirection: 'column', gap: '8px' },
              }, managedCardItems.map((item, index) => {
                const isVisible = !hiddenCardSet.has(item.id)
                const isDragging = cardDragIndex === index
                return React.createElement('div', {
                  key: item.id,
                  'data-testid': 'quota-card-order-item-' + item.id,
                  draggable: true,
                  onDragStart: (e) => {
                    try {
                      e.dataTransfer.setData('text/plain', String(index))
                      e.dataTransfer.effectAllowed = 'move'
                    } catch (_) {}
                    setCardDragIndex(index)
                  },
                  onDragOver: (e) => {
                    e.preventDefault()
                    try { e.dataTransfer.dropEffect = 'move' } catch (_) {}
                  },
                  onDrop: (e) => {
                    e.preventDefault()
                    let from = index
                    try {
                      const rawData = e.dataTransfer.getData('text/plain')
                      from = Number.parseInt(rawData, 10)
                    } catch (_) {}
                    if (!Number.isNaN(from) && from !== index) {
                      const names = managedCardItems.map((entry) => entry.id)
                      const [moved] = names.splice(from, 1)
                      names.splice(index, 0, moved)
                      commitCards(names, cardHidden)
                    }
                    setCardDragIndex(null)
                  },
                  onDragEnd: () => setCardDragIndex(null),
                  style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                    padding: '7px 10px', borderRadius: 'var(--dsh-svc-radius-control, 8px)',
                    border: '1px solid ' + (isDragging ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'),
                    background: isDragging ? 'var(--dsw-alias-interactive-bg-hover)' : 'var(--dsh-svc-card-bg)',
                    opacity: isVisible ? 1 : 0.5,
                    transition: 'border-color 120ms, background 120ms, opacity 120ms',
                    cursor: 'grab', userSelect: 'none',
                  },
                },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
                  React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', letterSpacing: '-1px' }, 'aria-hidden': 'true' }, '⋮⋮'),
                  React.createElement('span', { style: { fontSize: '13px', fontWeight: 550, color: 'var(--dsw-alias-label-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, item.label)),
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
                  React.createElement('button', {
                    type: 'button',
                    'data-testid': 'quota-card-order-up-' + item.id,
                    'aria-label': translate('config.navOrder.moveUp'),
                    title: translate('config.navOrder.moveUp'),
                    disabled: index === 0,
                    onClick: (e) => { e.stopPropagation(); moveQuotaCard(item.id, -1) },
                    style: {
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: '24px', height: '24px', padding: 0, borderRadius: '6px',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: index === 0 ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)',
                      cursor: index === 0 ? 'default' : 'pointer',
                      opacity: index === 0 ? 0.35 : 1, fontSize: '12px', lineHeight: '24px',
                    },
                  }, '↑'),
                  React.createElement('button', {
                    type: 'button',
                    'data-testid': 'quota-card-order-down-' + item.id,
                    'aria-label': translate('config.navOrder.moveDown'),
                    title: translate('config.navOrder.moveDown'),
                    disabled: index === managedCardItems.length - 1,
                    onClick: (e) => { e.stopPropagation(); moveQuotaCard(item.id, 1) },
                    style: {
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: '24px', height: '24px', padding: 0, borderRadius: '6px',
                      border: '1px solid var(--dsw-alias-border-l2)',
                      background: 'var(--dsw-alias-bg-layer-2)',
                      color: index === managedCardItems.length - 1 ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-primary)',
                      cursor: index === managedCardItems.length - 1 ? 'default' : 'pointer',
                      opacity: index === managedCardItems.length - 1 ? 0.35 : 1, fontSize: '12px', lineHeight: '24px',
                    },
                  }, '↓'),
                  React.createElement('button', {
                    type: 'button',
                    role: 'switch',
                    'data-testid': 'quota-card-order-toggle-' + item.id,
                    'aria-checked': String(isVisible),
                    'aria-label': translate(isVisible ? 'config.navOrder.visible' : 'config.navOrder.hidden'),
                    title: translate(isVisible ? 'config.navOrder.visible' : 'config.navOrder.hidden'),
                    onClick: (e) => { e.stopPropagation(); toggleCardVisible(item.id) },
                    style: {
                      width: '34px', height: '20px', ...fullRound('10px'),
                      padding: 0, position: 'relative', flexShrink: 0,
                      border: '1px solid ' + (isVisible ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'),
                      background: isVisible ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)',
                      cursor: 'pointer', lineHeight: 0,
                    },
                  }, React.createElement('span', {
                    style: {
                      position: 'absolute', top: '1px', left: isVisible ? '15px' : '1px',
                      width: '16px', height: '16px', ...fullRound('50%'),
                      background: isVisible ? '#fff' : 'var(--dsw-alias-label-tertiary)',
                      transition: 'left 120ms ease',
                    },
                  }))))
              })))
            : null,
          adaptedRows.length === 0
            ? React.createElement('p', { style: hint }, translate('quota.noAdapted'))
            : visibleCardRows.length === 0
              ? React.createElement('p', { 'data-testid': 'quota-cards-all-hidden', style: hint }, translate('quota.order.allHidden'))
              : React.createElement('div', { 'data-testid': 'quota-card-list', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                visibleCardRows.map((row, index) => {
                  const nameNode = React.createElement('span', { style: { fontWeight: 600, fontSize: '12px', overflowWrap: 'anywhere' } },
                    // 渠道名前的厂家小图标：与对话框同源解析（mono mask / 彩色 background），
                    // 未命中渠道返回 null 不渲染、不占位；inline-block 参与行内排版，长名照常折行。
                    // 与对话框同受 modelProviderIcons 开关管辖（关闭即全量摘除，卡片不留半截装饰）。
                    features.modelProviderIcons === false
                      ? null
                      : modelIconNode(row.provider, 14, { verticalAlign: '-2px', marginRight: '5px' }, `quota-provider-icon-${row.provider}`),
                    // 官网用量页链接（用户点名）：宿主按 kind 下发 usageUrl 时，展示名本身即外链。
                    typeof row.usageUrl === 'string' && row.usageUrl !== ''
                      ? React.createElement('a', {
                          'data-testid': `quota-usage-link-${row.provider}`,
                          href: row.usageUrl,
                          target: '_blank',
                          rel: 'noreferrer',
                          title: translate('quota.usageLink'),
                          style: { color: 'var(--dsw-alias-brand-primary)', textDecoration: 'underline' },
                        }, row.displayName || row.provider)
                      : (row.displayName || row.provider),
                    row.kindSource === 'auto'
                      ? React.createElement('span', {
                          'data-testid': `quota-auto-tag-${row.provider}`,
                          style: svcBadgeStyle('neutral', { marginLeft: '6px', verticalAlign: 'middle' }),
                        }, translate('quota.kindAuto'))
                      : null)
                  const windows = Array.isArray(row.windows) ? row.windows : []
                  const isAdvanced = advancedOpen === row.provider
                  // 账号 slug（CLIProxyAPI codex 账号块的 testid 后缀）：纯展示用稳定键，与宿主侧同规则。
                  const accountSlugOf = (account, index) => String(account).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || `acct-${index}`
                  // 每个窗口三段式：标签+百分比 / 进度条 / 重置单独一行；文本窗口（余额）只有一行（renderQuotaWindowRow 统一渲染）。
                  const windowBlocks = windows.map((window) => renderQuotaWindowRow(window, translate, row.provider))
                                    // 手录重置卡（v0.19 过渡方案；v0.20 免次数、可多条）：每条一行，
                  // 行首卡片图标 + 标题/到期两段；「移除」只在展开「配置」区后出现（平时不挂删除钮）。
                  // 账号级（v1.9.1）：CLIProxyAPI 一行多账号，card.account 标明归属；缺省 = provider 级。
                  const resetCardsAll = Array.isArray(row.resetCards) ? row.resetCards : []
                  const providerLevelResetCards = resetCardsAll.filter((card) => typeof card.account !== 'string' || card.account === '')
                  const renderResetCardRow = (card, cardIndex) => {
                    const content = resetCardContent(card, translate)
                    const cardId = typeof card.id === 'string' && card.id !== '' ? card.id : `idx-${cardIndex}`
                    // 账号归属直接标在卡行上：CPA 在 codex 账号额度用尽时会自动禁用账号，
                    // 适配器随之跳过 disabled/unavailable 账号——该账号没有窗口，账号块里
                    // 只剩卡、无从辨认是谁的。卡行自带账号名（纯数据），禁用期也认得出归属；
                    // provider 级卡无 account，行文不变。账号在前、自定义名称殿后。
                    const accountSuffix = typeof card.account === 'string' && card.account !== '' ? ` · ${card.account}` : ''
                    return React.createElement('div', {
                      key: cardId,
                      'data-testid': `quota-reset-card-${row.provider}-${cardId}`,
                      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', lineHeight: '16px', color: content.textColor },
                    },
                    // 行首卡片图标：与「刷新」同为 12px stroke 线性图标；染色成绿色（类别锚点，
                    // 见 `resetCardContent`），过期时转警示色，与文字颜色解耦。
                    React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: content.iconColor, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0 } },
                      React.createElement('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }),
                      React.createElement('line', { x1: 2, y1: 10, x2: 22, y2: 10 })),
                    React.createElement('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                      React.createElement('span', null, `${content.title}${accountSuffix}`),
                      content.expiry !== '' ? React.createElement('span', null, content.expiry) : null),
                    // 移除钮只在「配置」展开时渲染：平时卡片行是纯展示，避免常驻破坏性按钮。
                    isAdvanced
                      ? React.createElement('button', {
                          type: 'button',
                          'data-testid': `quota-remove-${row.provider}-${cardId}`,
                          onClick: () => removeResetCard(row.provider, cardId),
                          style: { fontSize: '11px', padding: '2px 10px', ...fullRound(999), border: '1px solid var(--dsw-alias-state-error-primary)', background: 'transparent', color: 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' },
                        }, translate('quota.resetCard.remove'))
                      : null)
                  }
                  const resetCardNodes = providerLevelResetCards.map(renderResetCardRow)
                  // 账号级卡按账号归集：账号块的成员是「窗口里的账号」∪「已有卡的账号」——
                  // 只看窗口会让刚保存（行回到 refreshing、暂无窗口）或查询失败的账号卡无处可挂，
                  // 表现为「添加成功但卡片不显示」。
                  const accountScopedCards = resetCardsAll.filter((card) => typeof card.account === 'string' && card.account !== '')
                  const accountCardKeys = []
                  const accountCardsByKey = new Map()
                  for (const card of accountScopedCards) {
                    if (!accountCardsByKey.has(card.account)) {
                      accountCardsByKey.set(card.account, [])
                      accountCardKeys.push(card.account)
                    }
                    accountCardsByKey.get(card.account).push(card)
                  }
                  // 账号块里的重置卡：**默认只显示最近要到期的那张**，其余折叠在「另有 N 张」后面
                  // （与圆环弹窗同款规则，避免多账号下每张卡的旧卡铺满页面）。
                  const accountResetCardNodes = (account, slug) => {
                    const cards = orderResetCardsByNearest(accountCardsByKey.get(account) ?? [])
                    const key = `card:${row.provider}:${slug}`
                    const expanded = expandedResetGroups.has(key)
                    const shown = expanded ? cards : cards.slice(0, 1)
                    const hidden = cards.length - shown.length
                    return [
                      ...shown.map(renderResetCardRow),
                      hidden > 0
                        ? React.createElement('button', {
                            key: 'reset-more',
                            type: 'button',
                            'data-testid': `quota-reset-more-${row.provider}-${slug}`,
                            onClick: () => toggleResetGroup(key),
                            style: { alignSelf: 'flex-start', fontSize: '11px', color: 'var(--dsw-alias-brand-primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', textDecoration: 'underline' },
                          }, translate('quota.resetCard.more', { count: hidden }))
                        : null,
                      expanded && cards.length > 1
                        ? React.createElement('button', {
                            key: 'reset-less',
                            type: 'button',
                            'data-testid': `quota-reset-less-${row.provider}-${slug}`,
                            onClick: () => toggleResetGroup(key),
                            style: { alignSelf: 'flex-start', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 2px', textDecoration: 'underline' },
                          }, translate('quota.resetCard.less'))
                        : null,
                    ]
                  }
                  // 单个账号块的渲染：窗口行（可空）→ 该账号的重置卡 → 「添加重置卡」入口。
                  const renderAccountBlock = (account, slug, windowNodes) => React.createElement('div', {
                    key: `codex-account-${slug}`,
                    'data-testid': `quota-cpa-account-${row.provider}-${slug}`,
                    style: { display: 'flex', flexDirection: 'column', gap: '10px' },
                  },
                  windowNodes.length > 0
                    ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, windowNodes)
                    : null,
                  ...accountResetCardNodes(account, slug),
                  // 「添加重置卡」与 zai 同款：只在「配置」展开时出现，卡行本身常驻可见。
                  isAdvanced
                    ? React.createElement('div', { key: 'reset-add-row', style: { display: 'flex' } },
                        React.createElement('button', {
                          type: 'button',
                          'data-testid': `quota-card-edit-${row.provider}-${slug}`,
                          onClick: () => openCardEditor(row, account),
                          style: { fontSize: '12px', lineHeight: '20px', padding: '4px 14px', ...fullRound(999), border: '1px solid var(--dsh-svc-border-strong)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', width: 'auto', minWidth: 0, overflow: 'visible', flex: '0 0 auto', whiteSpace: 'nowrap' },
                        }, translate('quota.resetCard.edit')))
                    : null,
                  resetEditorFor(account, slug))
                  const inputStyle = { fontSize: '12px', padding: '3px 6px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', width: '130px' }
                  const resetField = (labelText, testId, type, keyName) => React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                    labelText,
                    React.createElement('input', {
                      type,
                      'data-testid': testId,
                      value: cardDraft[keyName],
                      onChange: (event) => setCardDraft({ ...cardDraft, [keyName]: event.target.value }),
                      style: inputStyle,
                    }))
                  // 录入表单：按 (provider, account) 归属渲染——账号级卡的表单要出现在该账号块内，
                  // 而不是整张卡底部（否则多账号下分不清正在给谁加卡）。testid 带账号 slug 后缀区分。
                  const resetEditorFor = (account, slug) => {
                    const target = typeof account === 'string' ? account : ''
                    if (!isAdvanced || cardEditor === null || cardEditor.provider !== row.provider) return null
                    if ((typeof cardEditor.account === 'string' ? cardEditor.account : '') !== target) return null
                    const suffix = slug === undefined ? '' : `-${slug}`
                    return React.createElement('div', { key: `reset-editor${suffix}`, 'data-testid': `quota-reset-editor-${row.provider}${suffix}`, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)' } },
                      resetField(translate('quota.resetCard.dateLabel'), 'quota-reset-input-date', 'datetime-local', 'expiresAt'),
                      resetField(translate('quota.resetCard.nameLabel'), 'quota-reset-input-name', 'text', 'label'),
                      React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-card-save', onClick: saveResetCard, style: { minHeight: '28px', padding: '4px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsh-svc-brand-text)', cursor: 'pointer', fontSize: '12px' } }, translate('quota.resetCard.add')),
                      React.createElement('button', { type: 'button', 'data-testid': 'quota-reset-cancel', onClick: () => setCardEditor(null), style: svcRowActionStyle() }, translate('quota.resetCard.cancel')),
                    )
                  }

                  let body
                  // 无窗口可渲染时的兜底：账号级卡不能因为没有窗口就消失（刚保存的行会短暂处于
                  // refreshing/无窗口状态；查询失败的行也拿不到窗口）。有账号卡则先渲染它们的块。
                  const accountOnlyBody = () => {
                    if (accountCardKeys.length === 0) return null
                    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                      accountCardKeys.map((account, accountIndex) => renderAccountBlock(account, accountSlugOf(account, accountIndex), [])))
                  }
                  if (row.refreshing === true && windows.length === 0) {
                    body = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                      React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.refreshing')),
                      accountOnlyBody())
                  } else if (row.errorCode !== undefined && windows.length === 0) {
                    body = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
                      React.createElement('span', { 'data-testid': `quota-error-${row.provider}`, style: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } },
                        quotaErrorLine(row, translate)),
                      accountOnlyBody())
                  } else if (windows.length > 0) {
                    // CLIProxyAPI 的 codex 分区按账号切块：块内先列该账号窗口，再列它的重置卡与
                    // 「添加重置卡」入口。已有卡但当前没有窗口的账号（刚保存 / 查询失败）也要成块。
                    const accountBlockFor = (group) => {
                      const byAccount = []
                      const indexByAccount = new Map()
                      for (const window of group.windows) {
                        const account = typeof window.label === 'string' ? window.label.trim() : ''
                        let slot = indexByAccount.get(account)
                        if (slot === undefined) {
                          slot = byAccount.length
                          indexByAccount.set(account, slot)
                          byAccount.push({ account, windows: [] })
                        }
                        byAccount[slot].windows.push(window)
                      }
                      // 有卡无窗口的账号补在窗口账号之后（保持窗口序在前）。
                      for (const account of accountCardKeys) {
                        if (indexByAccount.has(account)) continue
                        indexByAccount.set(account, byAccount.length)
                        byAccount.push({ account, windows: [] })
                      }
                      return byAccount.map((entry, accountIndex) => renderAccountBlock(
                        entry.account,
                        accountSlugOf(entry.account, accountIndex),
                        entry.windows.map((window) => renderQuotaWindowRow(window, translate, row.provider)),
                      ))
                    }
                    const cpaGroups = row.kind === 'cliproxy' ? groupWindowsByFamily(windows) : null
                    if (cpaGroups && cpaGroups.length > 0) {
                      body = React.createElement('div', {
                        'data-testid': `quota-card-families-${row.provider}`,
                        style: { display: 'flex', flexDirection: 'column', gap: '10px' },
                      },
                        cpaGroups.map((group, groupIndex) => React.createElement('div', {
                          key: `family-${group.family}`,
                          'data-testid': `quota-card-family-${row.provider}-${group.family}`,
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            marginTop: groupIndex === 0 ? '0' : '4px',
                            paddingTop: groupIndex === 0 ? '0' : '10px',
                            borderTop: groupIndex === 0 ? 'none' : '1px solid var(--dsw-alias-border-l1)',
                          },
                        },
                          React.createElement('div', {
                            'data-testid': `quota-card-family-title-${row.provider}-${group.family}`,
                            style: {
                              fontSize: '12px',
                              fontWeight: 600,
                              color: 'var(--dsw-alias-label-primary)',
                            },
                          }, translate('quota.family.' + group.family)),
                          // codex：按账号切块（含账号级重置卡）；其余家族：原样窗口列表。
                          group.family === 'codex'
                            ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, accountBlockFor(group))
                            : React.createElement('div', {
                                style: { display: 'flex', flexDirection: 'column', gap: '14px' },
                              },
                                group.windows.map((window) => renderQuotaWindowRow(window, translate, row.provider))
                              )
                        ))
                      )
                    } else {
                      // 窗口块之间的留白由列容器统一控制（14px），进度条吃满整行宽度。
                      body = React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } }, windowBlocks)
                    }
                  } else {
                    body = React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.empty'))
                  }
                  // 峰谷提示块（deepseek / zai-coding-cn，时段表见 QUOTA_PEAK_SCHEDULES）：
                  // 状态徽标 + 换挡倒计时 + 两段色带 + 规则说明行。
                  const peakSchedule = quotaPeakScheduleFor(row, windows)
                  const peakTimeline = peakSchedule !== null
                    ? React.createElement(QuotaPeakTimeline, { key: 'peak-timeline', showCaption: true, schedule: peakSchedule })
                    : null
                  return React.createElement('div', { key: row.provider, 'data-testid': `quota-provider-card-${row.provider}`, style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsh-svc-card-bg)' } },
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' } },
                      nameNode,
                      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '5px' } },
                        // 排序与显隐统一收进上方管理面板（形状照搬设置栏标签页），
                        // 卡片头部不再常驻 ↑↓，避免「平时就挂着小钮」。
                        // 手动刷新：SVG 图标按钮，点击强制该 provider 重拉上游；在途时置灰防重入。
                        React.createElement('button', {
                          type: 'button',
                          'data-testid': `quota-refresh-${row.provider}`,
                          'aria-label': translate('quota.refresh'),
                          title: translate('quota.refresh'),
                          disabled: row.refreshing === true,
                          onClick: () => refreshProvider(row.provider),
                          style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '2px', border: 'none', background: 'transparent', color: row.refreshing === true ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-label-secondary)', cursor: row.refreshing === true ? 'default' : 'pointer', opacity: row.refreshing === true ? 0.45 : 1 },
                        }, React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true }, React.createElement('path', { d: 'M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.77L13 11h7V4l-2.35 2.35z' }))),
                        typeof row.fetchedAt === 'number'
                          ? React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.updated', { time: formatClockTime(row.fetchedAt) }))
                          : null)),
                    body,
                    ...(peakTimeline !== null ? [peakTimeline] : []),
                    // 配置折叠钮（凭据/类型切换/手录重置都收进折叠区）。
                    React.createElement('div', { key: 'advanced-toggle-row', style: { display: 'flex', marginTop: '2px' } },
                      React.createElement('button', {
                        type: 'button',
                        'data-testid': `quota-advanced-toggle-${row.provider}`,
                        'aria-expanded': String(isAdvanced),
                        onClick: () => setAdvancedOpen(isAdvanced ? null : row.provider),
                        style: { fontSize: '11px', lineHeight: '20px', padding: '2px 10px', ...fullRound(999), border: '1px solid var(--dsh-svc-border-strong)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
                      }, `${isAdvanced ? '▾' : '▸'} ${translate('quota.advanced')}`)),
                    ...(isAdvanced && row.status === 'unconfigured' && Array.isArray(row.credentialHints) && row.credentialHints.length > 0
                      ? (() => {
                          const editingCred = credEditor !== null && credEditor.provider === row.provider
                          const hints = row.credentialHints
                          const selectedName = hints.some((hint) => hint.name === credDraft.name) ? credDraft.name : (hints[0]?.name ?? '')
                          const selectedHint = hints.find((hint) => hint.name === selectedName)
                          return [editingCred
                            ? React.createElement('div', { key: 'cred-editor', 'data-testid': `quota-cred-editor-${row.provider}`, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)' } },
                                hints.length > 1
                                  ? React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                                      translate('quota.credential.nameLabel'),
                                      React.createElement('select', {
                                        'data-testid': 'quota-cred-name-select',
                                        value: selectedName,
                                        onChange: (event) => { setCredDraft({ ...credDraft, name: event.target.value }); setCredClearArmed(false) },
                                        style: quotaSelectStyle,
                                      },
                                      // 别名链说明：多个名字是同一密钥的备用存放槽（发现按序取第一个已配置的值），主名带「主名」标记。
                                      hints.map((hint, hintIndex) => React.createElement('option', { key: hint.name, value: hint.name }, `${hint.name}${hintIndex === 0 ? ` · ${translate('quota.credential.primary')}` : ''} · ${hint.configured === true ? translate('quota.credential.configured') : translate('quota.credential.notConfigured')}`))))
                                  : React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', alignSelf: 'center' } }, `${selectedName}${selectedHint?.configured === true ? ` · ${translate('quota.credential.configured')}` : ''}`),
                                React.createElement('label', { style: { display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                                  translate('quota.credential.valueLabel'),
                                  React.createElement('input', {
                                    type: 'password',
                                    'data-testid': 'quota-cred-input-value',
                                    value: credDraft.value,
                                    onChange: (event) => setCredDraft({ ...credDraft, value: event.target.value }),
                                    autoComplete: 'off',
                                    style: inputStyle,
                                  })),
                                React.createElement('button', { type: 'button', 'data-testid': 'quota-cred-save', onClick: () => saveCredential(row.provider), disabled: credDraft.value.trim() === '', style: { minHeight: '28px', padding: '4px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-brand-primary)', background: credDraft.value.trim() === '' ? 'transparent' : 'var(--dsw-alias-brand-primary)', color: credDraft.value.trim() === '' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsh-svc-brand-text)', cursor: credDraft.value.trim() === '' ? 'default' : 'pointer', fontSize: '12px' } }, translate('quota.credential.save')),
                                ...(selectedHint?.configured === true && selectedHint?.writable !== false ? [React.createElement('button', { type: 'button', key: 'cred-clear', 'data-testid': 'quota-cred-clear', title: credClearArmed ? translate('quota.credential.clearConfirm') : undefined, onClick: () => { if (!credClearArmed) { setCredClearArmed(true); return } setCredClearArmed(false); void clearCredential(row.provider, selectedName) }, style: { minHeight: '28px', padding: '4px 12px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsw-alias-state-error-primary)', background: credClearArmed ? 'var(--dsw-alias-state-error-primary)' : 'transparent', color: credClearArmed ? 'var(--dsh-svc-brand-text)' : 'var(--dsw-alias-state-error-primary)', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' } }, translate(credClearArmed ? 'quota.credential.clearConfirm' : 'quota.credential.clear'))] : []),
                                React.createElement('button', { type: 'button', 'data-testid': 'quota-cred-cancel', onClick: closeCredEditor, style: svcRowActionStyle() }, translate('quota.resetCard.cancel')),
                              )
                            : React.createElement('div', { key: 'cred-entry', style: { display: 'flex' } },
                                React.createElement('button', {
                                  type: 'button',
                                  'data-testid': `quota-cred-edit-${row.provider}`,
                                  onClick: () => openCredEditor(row),
                                  style: { fontSize: '12px', lineHeight: '20px', padding: '4px 14px', ...fullRound(999), border: '1px solid var(--dsw-alias-brand-primary)', background: 'transparent', color: 'var(--dsw-alias-brand-primary)', cursor: 'pointer', width: 'auto', minWidth: 0, overflow: 'visible', flex: '0 0 auto', whiteSpace: 'nowrap' },
                                // 宿主按 kind registry 下发凭据入口语义键；客户端只本地化，避免新增 kind 时复制分支。
                                }, translate(`quota.credential.${typeof row.credentialEntryKey === 'string' && row.credentialEntryKey !== '' ? row.credentialEntryKey : 'edit'}`)))]
                        })()
                      : []),
                    ...resetCardNodes,
                    resetEditorFor(''),
                    // 卡片脚部（配置区）：类型下拉（当前选中 / 跟随自动识别 / 停用查询）+ 重置卡录入入口。
                    ...(isAdvanced ? [
                      React.createElement('div', { key: 'advanced-footer', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                      React.createElement('select', {
                        'data-testid': `quota-kind-select-${row.provider}`,
                        value: row.kind,
                        'aria-label': `${translate('quota.adapt')} · ${row.displayName || row.provider}`,
                        onChange: (event) => {
                          if (event.target.value === '') adaptProvider(row.provider, null)
                          else if (event.target.value === '__auto__') clearAdaptedKind(row.provider)
                          else adaptProvider(row.provider, event.target.value)
                        },
                        style: quotaSelectStyle,
                      },
                      QUOTA_KIND_OPTIONS.map((kind) => React.createElement('option', { key: kind, value: kind }, translate(`quota.kind.${kind}`))),
                      React.createElement('option', { value: '__auto__' }, translate('quota.followAuto')),
                      React.createElement('option', { value: '' }, translate('quota.disable')))),
                    // provider 级重置卡录入仅智谱（zai-coding-cn）保留；CLIProxyAPI 的卡按账号走
                    // codex 账号块内的「添加重置卡」，故这里不再给它一个语义不清的整体入口。
                    ...(row.kind === 'zai-coding-cn' ? [React.createElement('div', { key: 'reset-add-row', style: { display: 'flex' } },
                      React.createElement('button', {
                        type: 'button',
                        'data-testid': `quota-card-edit-${row.provider}`,
                        onClick: () => openCardEditor(row),
                        style: { fontSize: '12px', lineHeight: '20px', padding: '4px 14px', ...fullRound(999), border: '1px solid var(--dsh-svc-border-strong)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', width: 'auto', minWidth: 0, overflow: 'visible', flex: '0 0 auto', whiteSpace: 'nowrap' },
                      }, translate('quota.resetCard.edit')))] : []),
                    ] : []))
                })),
          ...(candidateRows.length > 0 ? [React.createElement('div', { key: 'quota-add-adapt', 'data-testid': 'quota-add-adapt', style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: adaptedRows.length > 0 ? '2px' : '4px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1)' } },
            React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('quota.addAdapt')),
            React.createElement('select', { 'data-testid': 'quota-add-provider', value: addProvider, onChange: (event) => setAddProvider(event.target.value), style: quotaSelectStyle },
              React.createElement('option', { value: '' }, translate('quota.addPickProvider')),
              candidateRows.map((row) => React.createElement('option', { key: row.provider, value: row.provider }, row.displayName || row.provider))),
            React.createElement('select', { 'data-testid': 'quota-add-kind', value: addKind, onChange: (event) => setAddKind(event.target.value), style: quotaSelectStyle },
              React.createElement('option', { value: '' }, translate('quota.addPickKind')),
              QUOTA_KIND_OPTIONS.map((kind) => React.createElement('option', { key: kind, value: kind }, translate(`quota.kind.${kind}`)))),
            React.createElement('button', {
              type: 'button',
              'data-testid': 'quota-add-submit',
              disabled: addProvider === '' || addKind === '',
              onClick: () => {
                adaptProvider(addProvider, addKind)
                setAddProvider('')
                setAddKind('')
              },
              style: { fontSize: '12px', padding: '3px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-brand-primary)', background: addProvider === '' || addKind === '' ? 'transparent' : 'var(--dsw-alias-brand-primary)', color: addProvider === '' || addKind === '' ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsh-svc-brand-text)', cursor: addProvider === '' || addKind === '' ? 'default' : 'pointer' },
            }, translate('quota.adapt')))] : []))
      }

      // 跳过会话告警的「已关闭」记忆键。存的是**失败集合指纹**（见 ServicePanel 内注释），
      // 不是布尔值——同组失败关掉后不再提示，出现新的失败会话则指纹变化、告警重新出现。
      const USAGE_FAILURE_DISMISS_KEY = 'dsh-service-usage-failures-dismissed'

      function ServicePanel() {
        const translate = useTranslation()
        const { value: features } = useFeatures()
        const [health, setHealth] = useState(null)
        const [healthError, setHealthError] = useState(null)
        const [diagnostics, setDiagnostics] = useState(null)
        const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
        const [diagnosticsLoadedAt, setDiagnosticsLoadedAt] = useState(0)
        // v1.3 插件健康检查：失败插件「重新加载」两段式（确认条目/忙碌条目/错误文案）。
        const [pluginConfirmEntry, setPluginConfirmEntry] = useState(null)
        const [pluginBusyEntry, setPluginBusyEntry] = useState(null)
        const [pluginRestartError, setPluginRestartError] = useState(null)
        const [permissions, setPermissions] = useState(null)
        const [permissionConfirm, setPermissionConfirm] = useState(false)
        const [permissionBusy, setPermissionBusy] = useState(false)
        const [permissionError, setPermissionError] = useState(null)
        const [permissionDetails, setPermissionDetails] = useState(false)
        // v0.39：权限与修复默认折叠（确认规格：汇总 → 两行检查清单 → 折叠权限/深检/修复区）。
        const [permissionOpen, setPermissionOpen] = useState(false)
        const [permissionDeep, setPermissionDeep] = useState(null)
        const [permissionDeepBusy, setPermissionDeepBusy] = useState(false)
        const [backups, setBackups] = useState({ items: [], totalBytes: 0 })
        const [backupBusy, setBackupBusy] = useState(false)
        const [backupProgress, setBackupProgress] = useState(null)
        // v0.45.1 单调守卫：总进度只进不退（重试/异常快照不回退条幅）。
        const backupProgressPercentRef = useRef(0)
        const [backupError, setBackupError] = useState(null)
        const [backupDeleteId, setBackupDeleteId] = useState(null)
        const [backupRestoreId, setBackupRestoreId] = useState(null)
        const [backupRestoreReport, setBackupRestoreReport] = useState(null)
        const [backupRestorePlan, setBackupRestorePlan] = useState(null)
        const [backupManualRestart, setBackupManualRestart] = useState(false)
        const [backupExportBusy, setBackupExportBusy] = useState(false)
        const [backupImportBusy, setBackupImportBusy] = useState(false)
        const [backupDetails, setBackupDetails] = useState(false)
        const [version, setVersion] = useState(null)
        const [pluginVersion, setPluginVersion] = useState(null)
        const [updateInfo, setUpdateInfo] = useState(null)
        const [updateError, setUpdateError] = useState(null)
        const [usage, setUsage] = useState(null)
        const [usageBusy, setUsageBusy] = useState(false)
        const [usageError, setUsageError] = useState(null)
        const [usageFailureDetails, setUsageFailureDetails] = useState(false)
        // 已关闭的跳过会话告警：存失败集合指纹（而非布尔），空串/null 表示未关闭。
        // 与「维护子页记忆」同法：先默认值，mount 后从 localStorage 读回，避免渲染期副作用。
        const [usageFailureDismissed, setUsageFailureDismissed] = useState(null)
        const [upgradeBusy, setUpgradeBusy] = useState(false)
        const [upgradeError, setUpgradeError] = useState(null)
        // 疑似手动启动环境的升级两段式：确认后果 → 仍要升级；成功后不自动退出，改示指引。
        const [upgradeManualConfirm, setUpgradeManualConfirm] = useState(false)
        const [upgradeManualPending, setUpgradeManualPending] = useState(false)
        const [hoveredUsageSegment, setHoveredUsageSegment] = useState(null)
        // 热力日历格悬浮提示：与主图提示同形（fixed 跟随指针，pointerEvents:none）。
        const [hoveredHeatDay, setHoveredHeatDay] = useState(null)
        // 热力块维度切换：'day' = 每日日历（默认），'hour' = 打卡图（星期 × 小时）。
        const [heatScope, setHeatScope] = useState('day')
        const [usageProject, setUsageProject] = useState('all')
        const usageDataCacheRef = useRef(null)
        const [modelErrorsOpen, setModelErrorsOpen] = useState(false)
        const [toolErrorsOpen, setToolErrorsOpen] = useState(false)
        const [modelsOpen, setModelsOpen] = useState(false)
        // 模型列表口径：today=仅今日（默认，v0.31 用户点名）/ week=近 7 天 / all=宿主索引内全部日期累计。
        const [modelScope, setModelScope] = useState('today')
        const [activeTab, setActiveTab] = useState('overview')
        // 「本次更新内容」：GitHub 的 release 页面对 iframe 一律 `x-frame-options: deny`，
        // 官方右栏浏览器 tab 载不出来；正文由宿主取回、客户端就地渲染。两个版本面共用一条
        // 状态机：`variant='current'`（版本号后的常驻入口，读当前这一版）与 `variant='latest'`
        // （有新版本时点状态文本，读可升级到的那一版）。按 `kind@variant` 分槽存快照，
        // 状态机 loading/ready/error 由 notesState 三态表达（loading 只在请求飞行中）。
        const notesCacheRef = useRef({})
        // 两个端点各自的能力事实：浏览器半刷新即换、宿主半要重启才换，升级落地未重启的窗口里
        // 新端点必然缺席。分开记，才不至于因为「新版正文读不到」把**本来能用的**当前版入口
        // 一起收掉——旧宿主（连 release-notes 都没有）则两个都缺席，入口与状态文本一并降级。
        const notesHostUnsupportedRef = useRef(false)
        const latestNotesHostUnsupportedRef = useRef(false)
        const [notesState, setNotesState] = useState({ kind: null, variant: null, phase: 'idle', value: null, error: null })
        // 请求序号：收起（含外点关闭）与换行都 +1，让在飞的旧响应落地时自我作废——
        // 否则「关掉面板后才回来的 release 正文」会把面板又点亮，看起来像关不掉。
        const notesRequestRef = useRef(0)
        // 面板正文节点：外点判定要能区分「点面板内部」与「点面板外」——面板是行内展开，
        // 真实 DOM 里本就在版本卡子树内，这一层是元素级兜底（不依赖 closest 的实现）。
        const notesPanelRef = useRef(null)
        // 重启流程状态来自共享流（与设置页左列底部的专属入口同源）
        const restartFlowState = useRestartFlow()
        const runtimeEnv = useRuntimeEnv()
        const installedVersion = useInstalledVersion()
        const usageRequestPayload = { timezoneOffsetMinutes: new Date().getTimezoneOffset() }

        useEffect(() => {
          ensureSettingsNavBackendSynced()
        }, [])

        // 进入面板时拉取当前版本和健康快照；健康数据每 5 秒刷新，卸载即停止。
        // version 走全插件共享的缓存快照：无论哪个挂载点先到，都只有一次请求。
        useEffect(() => {
          fetchVersionSnapshot().then((res) => {
            if (res && res.ok) {
              setVersion(res.value.current)
              setPluginVersion(res.value.pluginVersion || null)
            }
          })
        }, [])
        // 更新快照的统一落库口径：失败只置错误文案，成功同时清掉旧的错误态。
        const applyUpdateResult = (res) => {
          if (!res || res.ok === false) { setUpdateError(translate('update.unavailable')); return }
          setUpdateInfo(res.value)
          setUpdateError(null)
        }
        useEffect(() => {
          let active = true
          rpcCall('check-update', {}).then((res) => {
            if (!active) return
            applyUpdateResult(res)
          }).catch(() => { if (active) setUpdateError(translate('update.unavailable')) })
          return () => { active = false }
        }, [])
        // 升级落地后宿主已作废其更新缓存，这里再取一次：让「已安装 X，重启后生效」立刻
        // 取代升级按钮，且概览不再误报「检测到新版本可用」。
        const refreshUpdate = async () => {
          const res = await rpcCall('check-update', {}).catch(() => null)
          if (res) applyUpdateResult(res)
        }
        // 「本次更新内容」的展开/收起：点开即取（宿主侧按 kind+版本缓存，重复点开只回缓存），
        // 面板内缓存到模块级 ref，同一 kind 不因收起再展开而重发请求。收起不清缓存，
        // 只切 kind（展开另一行）时覆盖显示槽。
        // 宿主半与客户端半同包发布，但浏览器半刷新即换、宿主半要重启才换：升级落地未重启
        // 那段窗口里 release-notes 会回 unknown-endpoint。与其每次点开都报错，不如认下
        // 「这个宿主还不支持」并把入口整体收起（与其它「旧宿主缺字段静默降级」同规）。
        const notesErrorCode = (error) => (error === 'release-not-found' ? 'release-not-found' : 'release-unavailable')
        const notesSlot = (kind, variant) => `${kind}@${variant}`
        // 客户端仍只送闭集字段（kind、variant），版本号一律宿主侧解析：`current` 走当前版本，
        // `latest` 走该 kind 的可用新版本——两条线都不接受浏览器送来的版本串或 URL（安全教义）。
        const loadNotes = async (kind, variant) => {
          const token = (notesRequestRef.current += 1)
          const stale = () => notesRequestRef.current !== token
          setNotesState({ kind, variant, phase: 'loading', value: null, error: null })
          let res = null
          try {
            res = await rpcCall(variant === 'latest' ? 'release-notes-latest' : 'release-notes', { kind })
          } catch (_) {
            res = null
          }
          if (res && res.ok !== false && res.value) {
            // 缓存先落、UI 后落：用户在飞行中收起时不该点亮面板，但拿到的正文仍值得留着——
            // 再展开直接命中缓存，不为一次外点关闭白扔一条已成功的请求。
            notesCacheRef.current[notesSlot(kind, variant)] = res.value
            if (stale()) return
            setNotesState({ kind, variant, phase: 'ready', value: res.value, error: null })
            return
          }
          if (stale()) return
          if (res?.error === 'unknown-endpoint') {
            // 「这个宿主还不支持」是环境事实，与面板是否还被看着无关，照记不误。
            // 按 variant 分别记：升级落地未重启时旧宿主缺的是 release-notes-latest，
            // 当前版入口不该被它连坐。
            if (variant === 'latest') latestNotesHostUnsupportedRef.current = true
            else notesHostUnsupportedRef.current = true
            setNotesState({ kind: null, variant: null, phase: 'idle', value: null, error: null })
            return
          }
          // `release-not-found` 不是故障而是上游发布时序：DSH 先发 npm、release 稍后补（实测最长
          // 95 分钟），这段窗口里 check-update 已经报「有新版本」而正文必然 404。落**待定态**：
          // 中性文案 + 重试按钮，不当错误渲染；宿主侧对 404 也不缓存，Release 一上线重试即得。
          const code = notesErrorCode(res?.error)
          setNotesState({ kind, variant, phase: code === 'release-not-found' ? 'pending' : 'error', value: null, error: code })
        }
        // 面板收起（含点击面板外、Esc）：在飞的响应一并作废，避免关掉后又被旧响应点亮。
        // 缓存保留——再展开直接命中缓存，不重发请求。
        const collapseNotes = () => {
          notesRequestRef.current += 1
          setNotesState({ kind: null, variant: null, phase: 'idle', value: null, error: null })
        }
        const toggleNotes = async (kind, variant) => {
          if (notesHostUnsupportedRef.current === true) return
          const current = notesState.kind === kind && notesState.variant === variant ? notesState : null
          // 「已就绪」与「读取中」再点是收起；待定态再点是重试（内容还没拿到，收起没有意义）。
          if (current !== null && (current.phase === 'ready' || current.phase === 'loading')) {
            collapseNotes()
            return
          }
          const cached = notesCacheRef.current[notesSlot(kind, variant)]
          if (cached !== undefined) {
            notesRequestRef.current += 1
            setNotesState({ kind, variant, phase: 'ready', value: cached, error: null })
            return
          }
          await loadNotes(kind, variant)
        }
        // 面板展开期间：点击版本卡之外任意位置（pointerdown）或按 Esc 即收起。
        // 内点判定**收在版本卡整棵子树上**，不是「只要落在面板节点上」——版本卡里还有另一行
        // 入口与升级按钮，点到它们面板不该自己关了（否则「切到 DSH 行」这类操作会被
        // 自己的外点逻辑搅乱）。面板节点再做一层 ref.contains 元素级兜底。
        // 监听随展开/收起精确挂卸（依赖 [notesOpen]），收起后不留常驻 document 监听。
        const notesOpen = notesState.kind !== null && notesState.phase !== 'idle'
        useEffect(() => {
          if (!notesOpen || typeof document === 'undefined') return undefined
          const onPointerDown = (event) => {
            const target = event?.target
            if (target != null && typeof target.closest === 'function') {
              try {
                if (target.closest('[data-testid="version-card"]') !== null) return
              } catch (_) {}
            }
            const panel = notesPanelRef.current
            if (panel != null && typeof panel.contains === 'function') {
              try { if (panel.contains(target)) return } catch (_) {}
            }
            collapseNotes()
          }
          const onKeyDown = (event) => {
            if (event?.key === 'Escape') collapseNotes()
          }
          document.addEventListener('pointerdown', onPointerDown)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [notesOpen])
        useEffect(() => {
          // 健康诊断开关关闭时权限浅检查属于被门禁功能：不发起请求，也不落错误态。
          if (!featureEnabled('healthDiagnostics')) return () => {}
          let active = true
          rpcCall('permissions-plan', {}).then((res) => {
            if (!active) return
            if (!res || res.ok === false) setPermissionError(translate('permissions.error'))
            else setPermissions(res.value)
          }).catch(() => {
            if (active) setPermissionError(translate('permissions.error'))
          })
          return () => { active = false }
        }, [features.healthDiagnostics])
        // 跳过会话告警的关闭记忆：mount 时读回（与维护子页记忆同法），读失败按未关闭处理。
        useEffect(() => {
          try { setUsageFailureDismissed(localStorage.getItem(USAGE_FAILURE_DISMISS_KEY)) } catch (_) { setUsageFailureDismissed(null) }
        }, [])
        useEffect(() => {
          if (!featureEnabled('modelUsage')) return () => {}
          let active = true
          rpcCall('usage', usageRequestPayload).then(async (res) => {
            if (!active) return
            if (!res || res.ok === false) { setUsageError(translate('usage.error')); return }
            setUsageError(null)
            setUsageFailureDetails(false)
            setUsage(res.value)
            if (res.value.updatedAt > 0 && Date.now() - res.value.updatedAt <= 300000) return
            try {
              const refreshed = await rpcCall('usage-refresh', usageRequestPayload)
              if (active && refreshed && refreshed.ok) {
                setUsageError(null)
                setUsageFailureDetails(false)
                setUsage(refreshed.value)
              }
            } catch (_) {}
          }).catch(() => {
            if (active) setUsageError(translate('usage.error'))
          })
          return () => { active = false }
        }, [features.modelUsage])
        useEffect(() => {
          if (!featureEnabled('backupMaintenance')) return () => {}
          let active = true
          rpcCall('backup-list', {}).then((res) => {
            if (!active) return
            if (!res || res.ok === false) setBackupError(translate('backup.error'))
            else setBackups(res.value)
          }).catch(() => {
            if (active) setBackupError(translate('backup.error'))
          })
          return () => { active = false }
        }, [features.backupMaintenance])
        useEffect(() => {
          let active = true
          let cancelNext = () => {}
          const poll = async () => {
            try {
              const res = await rpcCall('health', {})
              if (!active) return
              if (!res || res.ok === false) throw new Error(res && res.error ? res.error : 'health failed')
              setHealth(res.value)
              setHealthError(null)
            } catch (_) {
              if (!active) return
              setHealthError(translate('health.error'))
            }
            if (active) cancelNext = ctx.timer.timeout(poll, 5000)
          }
          poll()
          return () => {
            active = false
            cancelNext()
          }
        }, [])

        const runDiagnostics = async (force = false) => {
          if (!featureEnabled('healthDiagnostics')) return
          if (!force && diagnosticsLoadedAt > 0 && Date.now() - diagnosticsLoadedAt <= 30000) return
          setDiagnosticsBusy(true)
          try {
            const res = await rpcCall('diagnostics', {})
            if (!res || res.ok === false) throw new Error('diagnostics failed')
            setDiagnostics(res.value)
            setDiagnosticsLoadedAt(Date.now())
          } catch (_) {
            setHealthError(translate('health.error'))
          } finally {
            setDiagnosticsBusy(false)
          }
        }

        // v1.3 插件失败状态映射：稳定码走词典；restart-failed 码带底层原文（宿主并入 message）。
        const mapPluginRestartError = (error) => {
          const message = typeof error === 'string' && error.length > 0 ? error : 'internal-error'
          if (message.startsWith('restart-failed:')) {
            const detail = message.slice('restart-failed:'.length).trim()
            const base = translate('plugin.error.restart-failed')
            return translate('plugin.restartFailed', { detail: detail === '' ? base : `${base}（${detail}）` })
          }
          const known = {
            'unknown-plugin': 'plugin.error.unknown-plugin',
            'loader-unavailable': 'plugin.error.loader-unavailable',
            'plugin-disabled': 'plugin.error.plugin-disabled',
            'not-failed': 'plugin.error.not-failed',
          }
          const key = known[message]
          return translate('plugin.restartFailed', { detail: key === undefined ? message : translate(key) })
        }

        const restartPlugin = async (entry) => {
          if (entry === null || typeof entry !== 'object' || pluginBusyEntry !== null) return
          setPluginBusyEntry(entry.entryId)
          setPluginRestartError(null)
          try {
            const res = await rpcCall('plugin-restart', { entryId: entry.entryId })
            if (!res || res.ok !== true) throw Object.assign(new Error('plugin restart failed'), { code: res?.error })
            setPluginConfirmEntry(null)
            // 成功即强刷诊断：失败行换成新相位（仍失败则错误原文更新为新一次启动的报错）。
            await runDiagnostics(true)
          } catch (error) {
            setPluginConfirmEntry(null)
            setPluginRestartError(mapPluginRestartError(error?.code ?? String(error?.message || error)))
          } finally {
            setPluginBusyEntry(null)
          }
        }

        const refreshUsage = async () => {
          setUsageBusy(true)
          setUsageError(null)
          try {
            const res = await rpcCall('usage-refresh', usageRequestPayload)
            if (!res || res.ok === false) throw new Error('usage refresh failed')
            setUsage(res.value)
          } catch (_) {
            setUsageError(translate('usage.error'))
          } finally {
            setUsageBusy(false)
          }
        }

        const deepCheckPermissions = async () => {
          if (!permissions || permissions.supported !== true) return
          setPermissionDeepBusy(true)
          setPermissionError(null)
          try {
            const res = await rpcCall('permissions-deep', { planId: permissions.planId })
            if (!res || res.ok === false) throw new Error('deep permission check failed')
            setPermissionDeep(res.value)
          } catch (_) {
            setPermissionError(translate('permissions.error'))
          } finally {
            setPermissionDeepBusy(false)
          }
        }

        const repairPermissions = async () => {
          if (!permissions || permissions.supported !== true) return
          setPermissionBusy(true)
          setPermissionError(null)
          try {
            const res = await rpcCall('permissions-repair', { planId: permissions.planId })
            if (!res || res.ok === false) throw new Error('permission repair failed')
            setPermissions(res.value)
            setPermissionConfirm(false)
          } catch (_) {
            setPermissionError(translate('permissions.error'))
          } finally {
            setPermissionBusy(false)
          }
        }

        const createBackup = async () => {
          setBackupBusy(true)
          setBackupError(null)
          setBackupProgress(null)
          backupProgressPercentRef.current = 0
          // v0.45 进度轮询：创建期间每 400ms 拉一次 backup-progress；完成/失败即停链并清快照。
          let stopped = false
          let cancelNext = () => {}
          const poll = async () => {
            if (stopped) return
            try {
              const res = await rpcCall('backup-progress', {})
              if (!stopped && res && res.ok) setBackupProgress(res.value?.active === true ? res.value : null)
            } catch (_) {}
            if (!stopped) cancelNext = ctx.timer.timeout(poll, 400)
          }
          poll()
          try {
            const res = await rpcCall('backup-create', {})
            if (!res || res.ok === false) throw Object.assign(new Error('backup failed'), { code: res?.error })
            setBackups({ items: res.value.items, totalBytes: res.value.totalBytes })
          } catch (error) {
            setBackupError(mapBackupRestoreError(error?.code))
          } finally {
            stopped = true
            cancelNext()
            setBackupProgress(null)
            setBackupBusy(false)
          }
        }

        const deleteBackup = async (id) => {
          setBackupBusy(true)
          setBackupError(null)
          try {
            const res = await rpcCall('backup-delete', { id })
            if (!res || res.ok === false) throw new Error('backup failed')
            setBackups(res.value)
            setBackupDeleteId(null)
          } catch (_) {
            setBackupError(translate('backup.error'))
          } finally {
            setBackupBusy(false)
          }
        }

        const exportBackup = async (id) => {
          setBackupExportBusy(true)
          setBackupError(null)
          try {
            const res = await rpcCall('backup-export', { id })
            if (!res || res.ok === false) throw new Error('export failed')
            const a = document.createElement('a')
            a.href = res.value.url
            a.download = res.value.name
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
          } catch (_) {
            setBackupError(translate('backup.exportError'))
          } finally {
            setBackupExportBusy(false)
          }
        }

        const mapBackupRestoreError = (code) => {
          const key = 'backup.error.' + String(code || '')
          const translated = translate(key)
          return translated === key ? translate('backup.restoreError') : translated
        }

        const prepareBackupRestore = async (id) => {
          setBackupBusy(true)
          setBackupError(null)
          setBackupManualRestart(false)
          setBackupRestoreReport(null)
          setBackupRestorePlan(null)
          setBackupRestoreId(id)
          try {
            const inspected = await rpcCall('backup-inspect', { id })
            if (!inspected || inspected.ok === false) throw Object.assign(new Error('backup inspect failed'), { code: inspected?.error })
            setBackupRestoreReport(inspected.value)
            if (inspected.value.validForRestore !== true) return
            const prepared = await rpcCall('backup-restore-prepare', { id })
            if (!prepared || prepared.ok === false) throw Object.assign(new Error('backup prepare failed'), { code: prepared?.error })
            setBackupRestorePlan(prepared.value)
          } catch (error) {
            setBackupError(mapBackupRestoreError(error?.code))
          } finally {
            setBackupBusy(false)
          }
        }

        const commitBackupRestore = async () => {
          if (!backupRestorePlan || backupBusy) return
          setBackupBusy(true)
          setBackupError(null)
          try {
            const res = await rpcCall('backup-restore-commit', { planId: backupRestorePlan.planId })
            if (!res || res.ok === false) throw Object.assign(new Error('backup restore failed'), { code: res?.error })
            setBackupRestoreId(null)
            setBackupRestoreReport(null)
            setBackupRestorePlan(null)
            if (res.value?.restart?.requiresManualRestart === true) {
              setBackupManualRestart(true)
            } else {
              const previousInstanceId = res.value?.restart?.previousInstanceId || res.value?.previousInstanceId
              if (typeof previousInstanceId === 'string' && previousInstanceId.length > 0) startRecovery(previousInstanceId).catch(() => {})
            }
          } catch (error) {
            setBackupRestorePlan(null)
            setBackupError(mapBackupRestoreError(error?.code))
          } finally {
            setBackupBusy(false)
          }
        }

        const cancelBackupRestore = () => {
          if (backupBusy) return
          setBackupRestoreId(null)
          setBackupRestoreReport(null)
          setBackupRestorePlan(null)
        }

         const importBackup = (event) => {
           const file = event.target.files && event.target.files[0]
           event.target.value = ''
           if (!file) return
           setBackupImportBusy(true)
           setBackupError(null)
           const reader = new FileReader()
           reader.onload = async () => {
             try {
               const bytes = new Uint8Array(reader.result)
               let binary = ''
               for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
               const res = await rpcCall('backup-import', { name: file.name, data: btoa(binary) })
               if (!res || res.ok === false) throw Object.assign(new Error('backup import failed'), { code: res?.error })
               setBackups(res.value)
             } catch (error) {
               setBackupError(error?.code ? mapBackupRestoreError(error.code) : translate('backup.error'))
             } finally {
               setBackupImportBusy(false)
             }
           }
           reader.onerror = () => {
             setBackupImportBusy(false)
             setBackupError(translate('backup.error'))
           }
           reader.readAsArrayBuffer(file)
         }

        // 宿主返回的稳定失败码 → 词典文案；未知错误详情（如 dsh-failed: …）透出原文。
        const UPGRADE_FAILURES = {
          'active-work': 'update.guardActiveWork',
          'link-install': 'update.guardLinkInstall',
          'file-install': 'update.guardFileInstall',
          'no-newer-version': 'update.guardNoNewer',
          'no-profile-found': 'update.guardNoProfile',
          'ambiguous-profile': 'update.guardAmbiguous',
          'upgrade-stale': 'update.guardStale',
          'installed-version-unreadable': 'update.guardUnreadable',
          'pnpm-missing': 'update.failPnpmMissing',
          'transient-network': 'update.failNetwork',
          'fetch-timeout': 'update.failFetchTimeout',
          'release-age-violation': 'update.failReleaseAge',
          'hoist-pattern-diff': 'update.failHoist',
          'adding-to-root': 'update.failAddingToRoot',
          'not-a-workspace': 'update.failNotWorkspace',
          'ignored-builds': 'update.failIgnoredBuilds',
        }
        const upgradePlugin = async () => {
          if (isUpgradeInFlight()) return
          setUpgradeInFlight(true)
          try {
            // check-update 先于 version 返回时按钮可能先出现：env 未知就等共享快照落地再判。
            let env = runtimeEnv
            if (env === null) {
              await fetchVersionSnapshot()
              env = getRuntimeEnvState()
            }
            // 疑似终端手动启动：升级成功不会自动重启，先两段式确认后果再动手（安全教义）。
            if (!upgradeManualConfirm && env !== null && env.manualStartLikely === true) {
              setUpgradeError(null)
              setUpgradeManualConfirm(true)
              return
            }
            setUpgradeManualConfirm(false)
            setUpgradeBusy(true)
            setUpgradeError(null)
            const versionRes = await fetchVersionSnapshot()
            const previousInstanceId = versionRes && versionRes.ok ? versionRes.value.instanceId : undefined
            const res = await rpcCall('upgrade', {})
            if (!res || res.ok === false) {
              const code = res && typeof res.error === 'string' ? res.error.trim() : ''
              const mapped = typeof code === 'string' && code.length > 0 ? UPGRADE_FAILURES[code] : undefined
              // 已知失败码走双语词典；其余（如 npm-failed: …、dsh-failed: …）随通用文案透出宿主错误详情。
              if (mapped !== undefined) {
                setUpgradeError(translate(mapped))
              } else {
                setUpgradeError(translate('update.upgradeErrorDetail', { detail: code || 'upgrade failed' }))
              }
              return
            }
            if (res.value && res.value.requiresManualRestart === true) {
              // 宿主保持运行（没有 exit，就不会有新实例）：不启动恢复轮询，改示手动重启指引。
              setUpgradeManualPending(true)
            } else if (typeof previousInstanceId === 'string' && previousInstanceId.length > 0) {
              startRecovery(previousInstanceId).catch(() => {})
            }
            // 升级已落地：重取版本与更新快照，让「已安装 X，重启后生效」立刻取代升级按钮。
            // 组件重挂载或刷新页面后同样由这两个事实推导出来，不依赖本次点击留下的状态。
            refreshVersionSnapshot().catch(() => {})
            refreshUpdate().catch(() => {})
          } catch (err) {
            const detail = err instanceof Error && typeof err.message === 'string' && err.message !== 'upgrade failed' ? err.message.trim() : ''
            console.error('dsh-service: upgrade failed', detail || err)
            setUpgradeError(detail ? translate('update.upgradeErrorDetail', { detail }) : translate('update.upgradeError'))
          } finally {
            setUpgradeInFlight(false)
            setUpgradeBusy(false)
          }
        }

        // 样式（v0.39 收敛：按钮/展示面统一取自工厂级 svcButtonStyle/svcSurfaceStyle，
        // 本地只保留布局类常量；variant 语义见工厂处注释——破坏动作初次=dangerGhost 描边、
        // 最终确认=danger 实底，非破坏主操作=brandGhost 品牌描边）。
        const btn = svcButtonStyle()
        const primary      = svcButtonStyle('primary')
        const secondary    = svcButtonStyle('brandGhost')
        const neutral      = svcButtonStyle('neutral')
        const danger       = svcButtonStyle('danger')
        const dangerGhost  = svcButtonStyle('dangerGhost')
        const ghost        = svcButtonStyle('ghost')
        const toggle = Object.assign({}, btn, { background: 'transparent', color: 'var(--dsw-alias-label-primary)', border: 0, borderTop: '1px solid var(--dsw-alias-border-l1)', borderRadius: 0, padding: '10px 2px', width: '100%', textAlign: 'left', fontWeight: 600 })
        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }
        const hint = { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const card = svcCardStyle()
        const displaySurface = svcSurfaceStyle()
        const tabPanel = { padding: '14px 2px 2px', color: 'var(--dsw-alias-label-primary)' }
        const inlineTab = { background: 'transparent', color: 'var(--dsw-alias-label-secondary)', border: 0, borderBottom: '2px solid transparent', padding: '8px 10px', cursor: 'pointer', fontSize: '13px', fontWeight: 550, transition: 'color 120ms, border-color 120ms' }
        const inlineTabActive = { color: 'var(--dsw-alias-brand-primary)', borderBottom: '2px solid var(--dsw-alias-brand-primary)', fontWeight: 700 }
        // 模型列表头部的紧凑口径切换：沿用下划线标签语言，但按 11px 行高缩比。
        const compactTab = Object.assign({}, inlineTab, { padding: '3px 6px', fontSize: '11px' })
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'var(--dsw-alias-label-primary)' }

        const formatSize = (bytes) => {
          const value = Number(bytes)
          if (value < 1024) return value + ' B'
          if (value < 1024 * 1024) return (Math.round(value / 102.4) / 10) + ' KB'
          if (value < 1024 * 1024 * 1024) return (Math.round(value / (1024 * 1024) * 10) / 10) + ' MB'
          return (Math.round(value / (1024 * 1024 * 1024) * 10) / 10) + ' GB'
        }
        const formatUptime = (seconds) => {
          const totalMinutes = Math.floor(Number(seconds) / 60)
          return translate('health.uptimeValue', {
            hours: Math.floor(totalMinutes / 60),
            minutes: totalMinutes % 60,
          })
        }
        const formatBytes = (bytes) => {
          const mb = Number(bytes) / (1024 * 1024)
          return (Math.round(mb * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' MB'
        }
        const metric = (labelKey, value) => React.createElement('div', {
          key: labelKey,
          style: { padding: '8px 10px', borderRadius: '6px', background: 'var(--dsh-svc-raised-bg)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)' },
        },
        React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginBottom: '2px' } }, translate(labelKey)),
        React.createElement('div', { style: { fontSize: '14px', fontWeight: 600 } }, value))
        const dateKey = (date) => {
          const digits = (value) => String(value).padStart(2, '0')
          return `${date.getFullYear()}-${digits(date.getMonth() + 1)}-${digits(date.getDate())}`
        }
        const usageDays = []
        for (let offset = 6; offset >= 0; offset -= 1) {
          const date = new Date()
          date.setHours(0, 0, 0, 0)
          date.setDate(date.getDate() - offset)
          usageDays.push({ key: dateKey(date), label: `${date.getMonth() + 1}/${date.getDate()}` })
        }
        const usageSegments = [
          ['inputTokens', 'usage.input', '#79aaf7'],
          ['outputTokens', 'usage.output', '#f1b35b'],
          ['cacheTokens', 'usage.cache', '#48c7b0'],
        ]
        const usageTotalsFor = (day) => {
          const source = usage && usage.days ? usage.days[day] : null
          if (!source) return { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0 }
          if (usageProject === 'all') return source.totals
          const project = source.projects.find((item) => item.id === usageProject)
          return project ? project.totals : { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0 }
        }
        const modelCacheHitRate = (model) => {
           const denominator = Number(model.inputTokens || 0) + Number(model.cacheReadTokens || 0) + Number(model.cacheWriteTokens || 0)
           return denominator === 0 ? 0 : Number(model.cacheReadTokens || 0) / denominator
         }
         const modelTotalTokens = (model) => Number(model.inputTokens || 0) + Number(model.outputTokens || 0) + Number(model.cacheReadTokens || 0) + Number(model.cacheWriteTokens || 0)
         const modelSegmentValue = (model, metric) => metric === 'cacheTokens'
           ? Number(model.cacheReadTokens || 0) + Number(model.cacheWriteTokens || 0)
           : Number(model[metric] || 0)
         const usageValue = (totals, metricName) => metricName === 'cacheTokens'
          ? totals.cacheReadTokens + totals.cacheWriteTokens
          : totals[metricName] || 0
        const formatTokenValue = (value) => formatCompactCount(value, { invalid: '0' })
        const formatUsageValue = (value, metricName) => metricName === 'cacheHitRate'
          ? (Number(value) * 100).toFixed(1) + '%'
          : metricName === 'steps'
            ? translate('usage.stepsValue', { count: Number(value).toLocaleString() })
            : formatTokenValue(value)
        const chartTotals = usageDays.map((day) => usageTotalsFor(day.key))
        const chartValues = chartTotals.map((totals) => usageSegments.reduce((sum, [metricName]) => sum + usageValue(totals, metricName), 0))
        const chartMax = Math.max(1, ...chartValues)
        const chartTicks = [chartMax, chartMax * 0.75, chartMax * 0.5, chartMax * 0.25, 0]
        const todayTotals = usageTotalsFor(usageDays[6].key)
        const sevenTotals = usageDays.reduce((total, day) => {
          const source = usageTotalsFor(day.key)
          total.steps += source.steps || 0
          total.inputTokens += source.inputTokens || 0
          total.outputTokens += source.outputTokens || 0
          total.cacheReadTokens += source.cacheReadTokens || 0
          total.cacheWriteTokens += source.cacheWriteTokens || 0
          return total
        }, { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
        const sevenDenominator = sevenTotals.inputTokens + sevenTotals.cacheReadTokens + sevenTotals.cacheWriteTokens
        sevenTotals.cacheHitRate = sevenDenominator === 0 ? 0 : sevenTotals.cacheReadTokens / sevenDenominator
        // ── 日用量热力日历（卡片最下方）：GitHub 贡献图式，覆盖宿主索引内**全部**日期键 ──
        // 数据面零改动：`usage.days` 本就按「索引内每个有记录的本地日」下发（宿主 publicUsage 折小时桶
        // 而成），主图只取最后 7 天——累计口径下其余日期一直是随载荷白下发的。
        // 维度选择：格 = 一个自然日（本地日，与宿主分桶口径一致），强度 = 当日 token 总量。
        // 格边长 20px + 间距 4px：单格明显变大，7 行格网高 164px（原 15px 时为 123px），整块也更舒展。
        // 上限 **20 周**：本块与图表/模型列表同为 `usage-statistics-region` 的子块，内容宽实测 484px
        // （region 外框 530 − region padding 12×2 − 本块 padding 10×2 − 边框 2），20×20 + 19×4 = 476 恰好进；
        // 21 周需 500px 会溢出。数据不满时右侧留白（GitHub 新账号的稀疏日历同样表现），
        // **不拉伸填满**——试过 flex 铺满，格子会变成 82×10 的细长条，热力图的可读性依赖方格。
        // 打卡图是 24 列，同样的 484px 预算下 20px 格需 24×20 + 23×4 = 572px 会溢出 88px，
        // 故小时维度专用 16px 格：24×16 + 23×4 = 476 恰好进（与日视图同一套约束算法）。
        const HEAT_CELL = 20
        const HEAT_GAP = 4
        const HEAT_MAX_WEEKS = 20
        const PUNCH_CELL = 16
        // 文案走词典，星期/月份名走 Intl（与仓库既有 toLocaleString 用法同源），避免 19 个一次性死键。
        const heatLocale = currentUiLocale() === 'zh' ? 'zh-CN' : 'en-US'
        const heatParseDay = (key) => { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day) }
        const heatFormatDate = (date) => date.toLocaleDateString(heatLocale, { month: 'short', day: 'numeric' })
        const heatFormatMonth = (date) => date.toLocaleDateString(heatLocale, { month: 'short' })
        const usageCacheKey = `${usage?.updatedAt || 0}:${usageProject}:${heatLocale}:${dateKey(new Date())}`
        if (!usageDataCacheRef.current || usageDataCacheRef.current.key !== usageCacheKey) {
          const heatDayKeys = Object.keys(usage?.days || {}).filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(heatParseDay(key).getTime()))
          const heatTotalsByDay = new Map()
          for (const key of heatDayKeys) {
            const totals = usageTotalsFor(key)
            heatTotalsByDay.set(key, { total: usageSegments.reduce((sum, [metricName]) => sum + usageValue(totals, metricName), 0), steps: Number(totals.steps || 0) })
          }
          const heatDays = []
          const heatToday = new Date()
          heatToday.setHours(0, 0, 0, 0)
          if (heatDayKeys.length > 0) {
            const earliest = heatDayKeys.map(heatParseDay).reduce((min, date) => (date < min ? date : min))
            const thisMonday = new Date(heatToday)
            thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7))
            const floor = new Date(thisMonday)
            floor.setDate(floor.getDate() - ((HEAT_MAX_WEEKS - 1) * 7))
            const earliestMonday = new Date(earliest)
            earliestMonday.setDate(earliestMonday.getDate() - ((earliestMonday.getDay() + 6) % 7))
            const start = earliestMonday < floor ? floor : earliestMonday
            for (const cursor = new Date(start); cursor <= heatToday; cursor.setDate(cursor.getDate() + 1)) heatDays.push(new Date(cursor))
          }
          const heatMax = heatDays.reduce((max, date) => Math.max(max, heatTotalsByDay.get(dateKey(date))?.total || 0), 0)
          const heatColumns = []
          for (let index = 0; index < heatDays.length; index += 7) {
            const columnDays = heatDays.slice(index, index + 7)
            const first = columnDays[0]
            const previous = index === 0 ? null : heatDays[index - 7]
            heatColumns.push({
              key: dateKey(first),
              // 列首月变化时才写标签，避免同一月份每列重复。
              monthLabel: previous !== null && previous.getMonth() === first.getMonth() ? '' : heatFormatMonth(first),
              days: columnDays,
            })
          }
          // 星期标签取固定参照周的周一..周日：行序恒定，与数据范围无关。
          const heatWeekdayReference = new Date(2024, 0, 1)
          const heatWeekdays = [0, 1, 2, 3, 4, 5, 6].map((row) => { const date = new Date(heatWeekdayReference); date.setDate(date.getDate() + row); return date.toLocaleDateString(heatLocale, { weekday: 'short' }) })
          const selectedProjects = usageProject === 'all'
            ? (usage?.projects || []).map((project) => project.id)
            : [usageProject]
          // ── 打卡图（星期 × 小时）数据面 ──
          // `usage.hours` 由宿主按客户端时区把同一批小时桶折成「本地星期 × 本地小时」，
          // 与日视图同源、零新增持久化字段。格 = 该时段累计 token，行 = 周一..周日，列 = 0..23 时。
          const hourTotalsFor = (bucket) => {
            const totals = usageProject === 'all' ? bucket.totals : (bucket.projects || []).find((project) => project.id === usageProject)?.totals
            return totals || { steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
          }
          const punchBuckets = Array.isArray(usage?.hours) ? usage.hours : []
          const punchBySlot = new Map()
          for (const bucket of punchBuckets) {
            const weekday = Number(bucket?.weekday)
            const hour = Number(bucket?.hour)
            if (!Number.isInteger(weekday) || !Number.isInteger(hour) || weekday < 0 || weekday > 6 || hour < 0 || hour > 23) continue
            const totals = hourTotalsFor(bucket)
            punchBySlot.set(`${weekday}-${hour}`, {
              total: usageSegments.reduce((sum, [metricName]) => sum + usageValue(totals, metricName), 0),
              steps: Number(totals.steps || 0),
            })
          }
          const punchValues = [...punchBySlot.values()]
          const punchMax = punchValues.reduce((max, entry) => Math.max(max, entry.total), 0)
          const heatLevel = (total) => {
            if (total <= 0 || heatMax <= 0) return 0
            if (total <= heatMax * 0.25) return 1
            if (total <= heatMax * 0.5) return 2
            if (total <= heatMax * 0.75) return 3
            return 4
          }
          const punchLevel = (total) => {
            if (total <= 0 || punchMax <= 0) return 0
            if (total <= punchMax * 0.25) return 1
            if (total <= punchMax * 0.5) return 2
            if (total <= punchMax * 0.75) return 3
            return 4
          }
          const emptyModelTotals = (id) => ({ id, steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
          const accumulateModelTotals = (buckets, model) => {
            const existing = buckets.get(model.id) || emptyModelTotals(model.id)
            existing.steps += model.totals.steps || 0
            existing.inputTokens += model.totals.inputTokens || 0
            existing.outputTokens += model.totals.outputTokens || 0
            existing.cacheReadTokens += model.totals.cacheReadTokens || 0
            existing.cacheWriteTokens += model.totals.cacheWriteTokens || 0
            buckets.set(model.id, existing)
          }
          const modelTodayTotals = new Map()
          const modelWeekTotals = new Map()
          const modelAllTotals = new Map()
          const weekDayKeys = new Set(usageDays.map((day) => day.key))
          const todayDayKey = usageDays[usageDays.length - 1].key
          // 累计口径遍历宿主下发的全部日期键（可早于 7 天窗口）；周/今日按窗口命中累积。
          for (const [dayKey, source] of Object.entries(usage?.days || {})) {
            const targets = [modelAllTotals]
            if (weekDayKeys.has(dayKey)) targets.push(modelWeekTotals)
            if (dayKey === todayDayKey) targets.push(modelTodayTotals)
            for (const project of source.projects) {
              if (!selectedProjects.includes(project.id)) continue
              for (const model of project.models) {
                for (const buckets of targets) accumulateModelTotals(buckets, model)
              }
            }
          }
          usageDataCacheRef.current = {
            key: usageCacheKey,
            heatTotalsByDay,
            heatDays,
            heatMax,
            heatColumns,
            heatWeekdays,
            heatLevel,
            punchBuckets,
            punchBySlot,
            punchMax,
            punchLevel,
            modelTodayTotals,
            modelWeekTotals,
            modelAllTotals,
          }
        }
        const heatLevelOpacity = (level) => (level <= 0 ? 1 : [1, 0.25, 0.45, 0.7, 1][level])
        const punchHourLabels = (hour) => (hour % 3 === 0 ? String(hour).padStart(2, '0') : '')
        const {
          heatTotalsByDay,
          heatDays,
          heatMax,
          heatColumns,
          heatWeekdays,
          heatLevel,
          punchBuckets,
          punchBySlot,
          punchMax,
          punchLevel,
          modelTodayTotals,
          modelWeekTotals,
          modelAllTotals,
        } = usageDataCacheRef.current
        const scopedModelTotals = modelScope === 'today' ? modelTodayTotals : modelScope === 'all' ? modelAllTotals : modelWeekTotals
        const diagnosticDetail = (check) => {
          const detail = String(check.detail ?? '')
          if (check.id === 'usage-index') {
            // 三段 failed:indexed:updatedAt；'never' = 尚未建立索引，'unavailable' = 索引不可读。
            if (detail === 'never') return translate('health.detail.usage-index.never')
            if (detail === 'unavailable') return translate('health.detail.usage-index.unavailable')
            const [failed = '0', indexed = '0', updatedAt = '0'] = detail.split(':')
            const at = Number(updatedAt)
            const params = { failed, indexed, updated: at > 0 ? `${formatShortDate(at)} ${formatClockTime(at)}` : '—' }
            return translate(Number(failed) > 0 ? 'health.detail.usage-index.warning' : 'health.detail.usage-index.ok', params)
          }
          if (check.id === 'session-storage' && check.status === 'ok') return translate('health.detail.session-storage.ok', { count: detail })
          if (check.id === 'workspace-registry' && check.status === 'ok') return translate('health.detail.workspace-registry.ok', { count: detail })
          if (check.id === 'dsh-home' && check.status === 'ok') return translate('health.detail.dsh-home.ok', { mode: detail })
          if (check.id === 'backup-storage') {
            const [count = '0', size = '0'] = detail.split(':')
            return Number(count) === 0
              ? translate('health.detail.backup-storage.empty')
              : translate('health.detail.backup-storage.ok', { count, size: formatSize(size) })
          }
          if (check.id === 'tar' && check.status === 'ok') return translate('health.detail.tar.ok')
          if (check.id === 'permissions') return translate(check.status === 'ok' ? 'health.detail.permissions.ok' : 'health.detail.permissions.warning', { count: detail || '0' })
          if (check.id === 'runtime-env') {
            if (detail === 'manual') return translate('health.detail.runtime-env.manual')
            if (detail === 'declared') return translate('health.detail.runtime-env.declared')
            if (detail === 'unknown') return translate('health.detail.runtime-env.unknown')
            // 已识别的管理器 kind：复用概览运行环境的标签词典。
            return translate('health.detail.runtime-env.managed', { kind: translate(`env.kind.${detail}`) })
          }
          if (check.id === 'node-version') {
            const [version = '', required = ''] = detail.split(':')
            return translate(check.status === 'ok' ? 'health.detail.node-version.ok' : 'health.detail.node-version.warning', { version, required })
          }
          if (check.id === 'plugins') {
            // detail 四段 total:failed:pending:informational（前三段兼容旧客户端）；停用插件不进统计。
            if (detail === 'unavailable') return translate('health.detail.plugins.unavailable')
            const [total, failed, pending, informational] = detail.split(':')
            if (check.status === 'ok') return translate('health.detail.plugins.ok', { total })
            const segments = []
            if ((Number(failed) || 0) > 0) segments.push(translate('plugin.issue.failed', { failed }))
            if ((Number(pending) || 0) > 0) segments.push(translate('plugin.issue.pending', { pending }))
            if ((Number(informational) || 0) > 0) segments.push(translate('plugin.issue.info', { count: informational }))
            return segments.join('，')
          }
          if (check.id === 'plugin-compat') {
            // detail 五段 scanned:broken:declaredOnly:unknown:soft（宿主 pluginCompatCheckItem；尾部追加以兼容旧版）。
            if (detail === 'unavailable') return translate('health.detail.plugin-compat.unavailable')
            const parts = detail.split(':')
            const scanned = parts[0]
            const broken = parts[1]
            const declaredOnly = parts[2]
            const unknown = parts[3]
            const soft = parts[4] || '0'
            if (check.status === 'ok' && (Number(declaredOnly) || 0) === 0 && (Number(soft) || 0) === 0) return translate('health.detail.plugin-compat.ok', { total: scanned })
            const segments = []
            if ((Number(broken) || 0) > 0) segments.push(translate('plugin.compat.issue.broken', { count: broken }))
            if ((Number(soft) || 0) > 0) segments.push(translate('plugin.compat.issue.soft', { count: soft }))
            if ((Number(declaredOnly) || 0) > 0) segments.push(translate('plugin.compat.issue.declared', { count: declaredOnly }))
            if ((Number(unknown) || 0) > 0) segments.push(translate('plugin.compat.issue.unknown', { count: unknown }))
            return segments.join('，')
          }
          return translate('health.detail.generic', { status: translate(`health.status.${check.status}`) })
        }
        const summaryItems = (totals) => [
          ['usage.total', formatTokenValue(usageValue(totals, 'inputTokens') + usageValue(totals, 'outputTokens') + usageValue(totals, 'cacheTokens'))],
          ...usageSegments.map(([metricName, label]) => [label, formatTokenValue(usageValue(totals, metricName))]),
          ['usage.steps', formatUsageValue(totals.steps, 'steps')],
          ['usage.hitRate', formatUsageValue(totals.cacheHitRate, 'cacheHitRate')],
        ]
        const summaryBlock = (id, title, totals) => React.createElement('div', { style: { padding: '10px', borderRadius: '7px', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)' } },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: 700, marginBottom: '5px' } }, translate(title)),
          summaryItems(totals).map(([label, value], index) => React.createElement('div', { key: label, 'data-testid': `usage-summary-${id}-${index}`, style: { display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '4px 0', fontSize: '12px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)' } },
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, translate(label)),
            React.createElement('span', { style: { fontWeight: 650 } }, value)))
        )
        const sortedModels = [...scopedModelTotals.values()].sort((a, b) => modelTotalTokens(b) - modelTotalTokens(a) || b.steps - a.steps || a.id.localeCompare(b.id))
        const visibleModels = modelsOpen ? sortedModels : sortedModels.slice(0, 3)
        const hiddenModelCount = Math.max(0, sortedModels.length - 3)
        const maxModelTokens = Math.max(1, ...visibleModels.map((model) => modelTotalTokens(model)))
        const selectedErrors = (list) => (list || [])
          .filter((error) => usageProject === 'all' || error.projectId === usageProject)
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        const modelErrors = selectedErrors(usage?.errors?.models)
        const toolErrors = selectedErrors(usage?.errors?.tools)
        const usageFailures = Array.isArray(usage?.failedSessions) ? usage.failedSessions : []
        const usageSuccessfulSessions = Number.isFinite(Number(usage?.successfulSessions))
          ? Number(usage.successfulSessions)
          : Math.max(0, Number(usage?.indexedSessions || 0) - usageFailures.filter((failure) => failure && failure.stale === true).length)
        // 失败集合指纹：id+错误码排序后拼串（不排序则宿主列表顺序变化就会误判为新失败）。
        // 关闭告警时把这个指纹写进 localStorage，之后只有**同一组**失败被静音；一旦出现新的
        // 失败会话（增删/换码，如这次读不动的旧日志被修好、或又冒出别的坏会话）指纹即变，
        // 告警自动重新出现——避免「关一次就永远看不到新问题」。
        const usageFailureFingerprint = usageFailures
          .map((failure) => `${failure && typeof failure.id === 'string' ? failure.id : ''}\u0000${failure && typeof failure.code === 'string' ? failure.code : ''}`)
          .sort()
          .join('\u0001')
        const usageFailureWarning = usageFailures.length === 0 || usageFailureDismissed === usageFailureFingerprint
          ? null
          : React.createElement('div', { 'data-testid': 'usage-failure-warning', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--dsh-svc-warning)', background: 'var(--dsh-svc-raised-bg)', color: 'var(--dsh-svc-text)' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } },
                React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } },
                  React.createElement('div', { style: { fontSize: '12px', lineHeight: 1.5, fontWeight: 650 } }, translate('usage.failures.global', { successful: usageSuccessfulSessions.toLocaleString(), failed: usageFailures.length.toLocaleString() })),
                  usageFailures.some((failure) => failure && failure.stale === true)
                    ? React.createElement('div', { style: { marginTop: '4px', fontSize: '11px', lineHeight: 1.5, color: 'var(--dsh-svc-text-muted)' } }, translate('usage.failures.staleHint'))
                    : null),
                React.createElement('button', {
                  type: 'button',
                  'data-testid': 'usage-failure-dismiss',
                  'aria-label': translate('usage.failures.dismiss'),
                  title: translate('usage.failures.dismiss'),
                  style: { flex: 'none', background: 'transparent', border: 0, padding: '0 2px', cursor: 'pointer', color: 'var(--dsh-svc-text-muted)', fontSize: '16px', lineHeight: 1 },
                  onClick: () => {
                    setUsageFailureDismissed(usageFailureFingerprint)
                    try { localStorage.setItem(USAGE_FAILURE_DISMISS_KEY, usageFailureFingerprint) } catch (_) {}
                  },
                }, '×')),
              React.createElement('button', { type: 'button', 'data-testid': 'usage-failure-details-toggle', 'aria-expanded': String(usageFailureDetails), style: Object.assign({}, toggle, { marginTop: '5px', padding: 0 }), onClick: () => setUsageFailureDetails((value) => !value) }, `${usageFailureDetails ? '▾' : '▸'} ${translate(usageFailureDetails ? 'usage.failures.hide' : 'usage.failures.show')}`),
               usageFailureDetails
                ? React.createElement('div', { 'data-testid': 'usage-failure-details', style: { display: 'grid', gap: '6px', marginTop: '8px' } },
                     usageFailures.map((failure, index) => {
                       const item = failure && typeof failure === 'object' ? failure : {}
                       return React.createElement('div', { key: `${String(item.id || 'unknown')}:${index}`, style: { padding: '7px 9px', borderRadius: '6px', border: '1px solid var(--dsh-svc-border)', background: 'var(--dsh-svc-card-bg)', fontSize: '11px', lineHeight: 1.5 } },
                        React.createElement('div', { style: { overflowWrap: 'anywhere' } }, `${translate('usage.failures.id')}: ${typeof item.id === 'string' && item.id !== '' ? item.id : '—'}`),
                        React.createElement('div', { style: { overflowWrap: 'anywhere' } }, `${translate('usage.failures.code')}: ${typeof item.code === 'string' && item.code !== '' ? item.code : '—'}`),
                        React.createElement('div', { style: { overflowWrap: 'anywhere', color: 'var(--dsh-svc-text-muted)' } }, `${translate('usage.failures.message')}: ${['format-migration-failed', 'session-read-failed', 'session-fold-failed'].includes(item.code) ? translate(`usage.failures.reason.${item.code}`) : typeof item.message === 'string' && item.message !== '' ? item.message : '—'}`),
                        React.createElement('div', { style: { marginTop: '2px', color: 'var(--dsh-svc-warning)' } }, translate(item.stale === true ? 'usage.failures.stale' : 'usage.failures.notStale')))
                     }))
                 : null)
        const errorList = (kind, errors) => React.createElement('div', { key: kind, style: { display: 'grid', gap: '6px', marginTop: '8px' } },
          errors.length === 0
            ? React.createElement('p', { style: hint }, translate(kind === 'model' ? 'usage.errors.empty' : 'usage.toolErrors.empty'))
            : errors.map((failure) => React.createElement('div', { key: `${kind}:${failure.projectId}:${failure.key}`, style: { padding: '8px 10px', borderRadius: '6px', background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px' } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontWeight: 600 } },
                  React.createElement('span', null, kind === 'model'
                    ? `${failure.provider}/${failure.model} · ${failure.code}${failure.status === null ? '' : ` · ${failure.status}`}`
                    : `${failure.tool} · ${failure.code}`),
                  React.createElement('span', null, translate('usage.errors.count', { count: failure.count }))),
                React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: '3px', overflowWrap: 'anywhere' } }, failure.message))))
        // ── 日用量热力日历（卡片最下方）──
        // 承载「索引内全部日期」的长期视图：主图只画近 7 天，这里回答「哪天在烧、有没有断档」。
        // 随项目筛选联动（usageTotalsFor 已按 usageProject 取值），与上方各块口径一致。
        // 单独成块（而非塞进 usageBlock 的数组）是为了把嵌套压平——塞进去时括号层级过深，极易错配。
        const heatCellStyle = (date) => {
          const entry = heatTotalsByDay.get(dateKey(date)) || { total: 0, steps: 0 }
          const level = heatLevel(entry.total)
          const label = translate('usage.heatmap.cell', { date: heatFormatDate(date), total: formatTokenValue(entry.total), steps: Number(entry.steps || 0).toLocaleString() })
          return {
            key: dateKey(date),
            'data-testid': `usage-heatmap-cell-${dateKey(date)}`,
            'data-value': entry.total,
            'data-level': level,
            'aria-label': label,
            onMouseEnter: (event) => setHoveredHeatDay({ id: dateKey(date), label, x: event.clientX, y: event.clientY }),
            onMouseMove: (event) => setHoveredHeatDay((current) => current && current.id === dateKey(date) ? (current.x === event.clientX && current.y === event.clientY ? current : Object.assign({}, current, { x: event.clientX, y: event.clientY })) : current),
            onMouseLeave: () => setHoveredHeatDay(null),
            style: {
              width: `${HEAT_CELL}px`,
              height: `${HEAT_CELL}px`,
              borderRadius: '4px',
              flex: 'none',
              cursor: entry.total > 0 ? 'pointer' : 'default',
              background: entry.total > 0 ? 'var(--dsh-svc-success)' : 'var(--dsw-alias-border-l1)',
              opacity: heatLevelOpacity(level),
            },
          }
        }
        // 打卡图格：行=星期、列=小时。小时维度用 16px 格（24 列在 484px 预算下的唯一解）。
        const punchCellStyle = (weekday, hour) => {
          const entry = punchBySlot.get(`${weekday}-${hour}`) || { total: 0, steps: 0 }
          const level = punchLevel(entry.total)
          const label = translate('usage.heatmap.hourCell', { weekday: heatWeekdays[weekday], hour: String(hour).padStart(2, '0'), total: formatTokenValue(entry.total), steps: Number(entry.steps || 0).toLocaleString() })
          return {
            key: `${weekday}-${hour}`,
            'data-testid': `usage-punch-cell-${weekday}-${hour}`,
            'data-value': entry.total,
            'data-level': level,
            'aria-label': label,
            onMouseEnter: (event) => setHoveredHeatDay({ id: `punch-${weekday}-${hour}`, label, x: event.clientX, y: event.clientY }),
            onMouseMove: (event) => setHoveredHeatDay((current) => current && current.id === `punch-${weekday}-${hour}` ? (current.x === event.clientX && current.y === event.clientY ? current : Object.assign({}, current, { x: event.clientX, y: event.clientY })) : current),
            onMouseLeave: () => setHoveredHeatDay(null),
            style: {
              width: `${PUNCH_CELL}px`,
              height: `${PUNCH_CELL}px`,
              borderRadius: '3px',
              flex: 'none',
              cursor: entry.total > 0 ? 'pointer' : 'default',
              background: entry.total > 0 ? 'var(--dsh-svc-success)' : 'var(--dsw-alias-border-l1)',
              opacity: heatLevelOpacity(level),
            },
          }
        }
        const heatScopeTabs = React.createElement('div', { 'data-testid': 'usage-heatmap-scope-tabs', style: { display: 'flex', gap: '2px' } },
          ['day', 'hour'].map((scopeId) => React.createElement('button', {
            key: scopeId,
            type: 'button',
            'data-testid': `usage-heatmap-scope-${scopeId}`,
            style: Object.assign({}, compactTab, heatScope === scopeId ? inlineTabActive : { color: 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }),
            onClick: () => setHeatScope(scopeId),
          }, translate(`usage.heatmap.scope.${scopeId}`))))
        // 打卡图：7 行（周一..周日）× 24 列（0..23 时），每 3 小时标一次刻度减少拥挤。
        const punchGrid = React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '2px' } },
          React.createElement('div', { 'aria-hidden': 'true', style: { display: 'flex', flexDirection: 'column', gap: `${HEAT_GAP}px`, flex: 'none', paddingTop: '19px' } },
            heatWeekdays.map((label, row) => React.createElement('div', { key: row, style: { height: `${PUNCH_CELL}px`, fontSize: '11px', lineHeight: `${PUNCH_CELL}px`, color: 'var(--dsw-alias-label-secondary)' } }, label))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: `${HEAT_GAP}px`, minWidth: 0, flex: 'none' } },
            React.createElement('div', { 'aria-hidden': 'true', style: { display: 'flex', gap: `${HEAT_GAP}px`, height: '15px' } },
              Array.from({ length: 24 }, (_, hour) => React.createElement('div', { key: `hour-${hour}`, style: { width: `${PUNCH_CELL}px`, flex: 'none', fontSize: '10px', lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, punchHourLabels(hour)))),
            React.createElement('div', { 'data-testid': 'usage-punch-grid', role: 'img', 'aria-label': translate('usage.heatmap.hourGridLabel'), style: { display: 'flex', flexDirection: 'column', gap: `${HEAT_GAP}px` } },
              [0, 1, 2, 3, 4, 5, 6].map((weekday) => React.createElement('div', { key: weekday, style: { display: 'flex', gap: `${HEAT_GAP}px` } },
                Array.from({ length: 24 }, (_, hour) => React.createElement('div', punchCellStyle(weekday, hour))))))))
        const heatmapBlock = (heatDays.length === 0 && punchBuckets.length === 0) ? null : React.createElement('div', {
          key: 'usage-heatmap',
          'data-testid': 'usage-heatmap',
          // 与同级的 `usage-model-list` 同一套容器语言（padding 8px 10px / radius 8 / raised-bg / 同色边框），
          // 保证两块的左右边缘与内缩完全对齐；本块内容高，底部 padding 略加。
          style: { marginTop: '10px', padding: '8px 10px 10px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)', border: '1px solid var(--dsw-alias-border-l1)' },
        },
        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' } },
          React.createElement('div', { 'data-testid': 'usage-heatmap-title', style: { fontSize: '12px', fontWeight: 650 } }, translate(heatScope === 'hour' ? 'usage.heatmap.hourTitle' : 'usage.heatmap.title')),
          heatScopeTabs),
        heatScope === 'hour' ? punchGrid : React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: '2px' } },
          // 星期标签列（周一..周日，与列内行序一致）；隔行写字（周一/三/五/日），格变大后 11px 文字不挤。
          React.createElement('div', { 'aria-hidden': 'true', style: { display: 'flex', flexDirection: 'column', gap: `${HEAT_GAP}px`, flex: 'none', paddingTop: '19px' } },
            heatWeekdays.map((label, row) => React.createElement('div', { key: row, style: { height: `${HEAT_CELL}px`, fontSize: '11px', lineHeight: `${HEAT_CELL}px`, color: 'var(--dsw-alias-label-secondary)' } }, row % 2 === 0 ? label : ''))),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: `${HEAT_GAP}px`, minWidth: 0, flex: 'none' } },
            // 月份标签行：与列一一对齐（仅月首列有文字，其余留空占位保持列宽）。
            React.createElement('div', { 'aria-hidden': 'true', style: { display: 'flex', gap: `${HEAT_GAP}px`, height: '15px' } },
              heatColumns.map((column) => React.createElement('div', { key: `month-${column.key}`, style: { width: `${HEAT_CELL}px`, flex: 'none', fontSize: '11px', lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, column.monthLabel))),
            React.createElement('div', { 'data-testid': 'usage-heatmap-grid', role: 'img', 'aria-label': translate('usage.heatmap.gridLabel'), style: { display: 'flex', gap: `${HEAT_GAP}px` } },
              heatColumns.map((column) => React.createElement('div', { key: column.key, style: { display: 'flex', flexDirection: 'column', gap: `${HEAT_GAP}px`, flex: 'none' } },
                column.days.map((date) => React.createElement('div', heatCellStyle(date)))))))),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '5px', marginTop: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
          React.createElement('span', null, translate('usage.heatmap.less')),
          [0, 1, 2, 3, 4].map((level) => React.createElement('span', { key: level, 'data-testid': `usage-heatmap-legend-${level}`, style: { width: '12px', height: '12px', borderRadius: '3px', background: level === 0 ? 'var(--dsw-alias-border-l1)' : 'var(--dsh-svc-success)', opacity: heatLevelOpacity(level) } })),
          React.createElement('span', null, translate('usage.heatmap.more'))),
        hoveredHeatDay ? React.createElement('div', { 'data-testid': 'usage-heatmap-tooltip', style: { position: 'fixed', left: `${hoveredHeatDay.x + 12}px`, top: `${hoveredHeatDay.y + 12}px`, zIndex: 1000, pointerEvents: 'none', padding: '7px 9px', borderRadius: '6px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: '12px', fontWeight: 600, whiteSpace: 'pre-line', textAlign: 'left' } }, hoveredHeatDay.label) : null)

        const usageBlock = React.createElement('div', { key: 'usage-section', 'data-testid': 'usage-card', style: card },
          usage && Array.isArray(usage.projects) && usage.projects.length > 0
            ? React.createElement('div', { 'data-testid': 'usage-project-tabs', style: { display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '12px', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
                React.createElement('button', { style: Object.assign({}, inlineTab, usageProject === 'all' ? inlineTabActive : { color: 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }), onClick: () => setUsageProject('all') }, translate('usage.allProjects')),
                // 项目文件夹已删除的条目不再提供入口（其用量仍计入「全部」总量与热力图）。
                usage.projects.filter((project) => project.missing !== true).map((project) => React.createElement('button', { key: project.id, style: Object.assign({}, inlineTab, usageProject === project.id ? inlineTabActive : { color: 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }), onClick: () => setUsageProject(project.id) }, project.title)))
            : null,
          usageFailureWarning,
          usage && usage.indexedSessions > 0
            ? React.createElement('div', { 'data-testid': 'usage-statistics-region', style: Object.assign({}, displaySurface, { padding: '12px', borderRadius: '9px' }) },
                // v0.39 头部行统一：图例（输入/输出/缓存）+ 刷新钮收进统计区头部，不再散落图下与列表尾。
                React.createElement('div', { 'data-testid': 'usage-region-header', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' } },
                  React.createElement('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11px' } },
                    usageSegments.map(([, label, color]) => React.createElement('span', { key: label, style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
                      React.createElement('span', { style: { width: '9px', height: '9px', borderRadius: '2px', background: color } }),
                      translate(label)))),
                  React.createElement('button', { type: 'button', 'data-testid': 'usage-refresh', 'data-variant': 'neutral', style: neutral, onClick: refreshUsage, disabled: usageBusy }, translate(usageBusy ? 'usage.refreshing' : 'usage.refresh'))),
                React.createElement('div', { 'data-testid': 'usage-chart', style: { position: 'relative', display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr)', height: '180px', padding: '12px 10px 4px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
                  React.createElement('div', { 'data-testid': 'usage-y-axis', 'aria-label': translate('usage.axis'), style: { position: 'relative', height: '144px', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } },
                    chartTicks.map((tick, index) => React.createElement('span', { key: index, style: { position: 'absolute', right: '7px', top: `${index * 25}%`, transform: index === 4 ? 'translateY(-100%)' : 'translateY(-50%)' } }, formatTokenValue(tick)))),
                  React.createElement('div', { 'data-testid': 'usage-plot', style: { position: 'relative', height: '164px' } },
                    React.createElement('div', { style: { position: 'absolute', inset: '0 0 20px', display: 'flex', alignItems: 'end', gap: '8px', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
                      chartTicks.map((_, index) => React.createElement('div', { key: index, 'data-testid': `usage-grid-${index}`, style: { position: 'absolute', left: 0, right: 0, top: `${index * 25}%`, borderTop: '1px solid var(--dsw-alias-border-l1)', pointerEvents: 'none' } })),
                      usageDays.map((day, index) => React.createElement('div', { key: day.key, 'aria-label': translate('usage.barDay', { day: day.label, total: formatTokenValue(chartValues[index]) }), style: { position: 'relative', zIndex: 1, flex: 1, minWidth: 0, alignSelf: 'end' } },
                        React.createElement('div', { 'data-testid': `usage-bar-${day.key}`, style: { height: `${Math.max(2, chartValues[index] / chartMax * 144)}px`, display: 'flex', flexDirection: 'column-reverse', justifyContent: 'flex-start', borderRadius: '4px 4px 0 0', overflow: 'hidden' } },
                          usageSegments.map(([metricName, label, color]) => {
                            const value = usageValue(chartTotals[index], metricName)
                            const segmentHeight = chartValues[index] === 0 ? 0 : value / chartValues[index] * 100
                            const segmentId = `${day.key}-${metricName}`
                            const active = hoveredUsageSegment && hoveredUsageSegment.id === segmentId
                            return React.createElement('div', {
                              key: metricName,
                              'data-testid': `usage-segment-${segmentId}`,
                              'data-value': value,
                              onMouseEnter: (event) => setHoveredUsageSegment({ id: segmentId, date: day.key, totals: chartTotals[index], x: event.clientX, y: event.clientY }),
                              onMouseMove: (event) => setHoveredUsageSegment((current) => current && current.id === segmentId ? (current.x === event.clientX && current.y === event.clientY ? current : Object.assign({}, current, { x: event.clientX, y: event.clientY })) : current),
                              onMouseLeave: () => setHoveredUsageSegment(null),
                              style: { height: `${segmentHeight}%`, minHeight: value > 0 ? '2px' : 0, background: color, opacity: hoveredUsageSegment && !active ? 0.42 : 1, cursor: value > 0 ? 'pointer' : 'default', transition: 'opacity 120ms ease' },
                            })
                          }))))),
                    React.createElement('div', { 'data-testid': 'usage-x-axis', style: { position: 'absolute', left: 0, right: 0, bottom: '0', height: '20px', display: 'flex', gap: '8px', alignItems: 'end' } },
                      usageDays.map((day) => React.createElement('div', { key: day.key, style: { flex: 1, minWidth: 0, textAlign: 'center', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } }, day.label))))),

                // 可访问的文本图表摘要：视觉上不可见，屏幕阅读器可见（v0.39 确认规格）。
                React.createElement('div', { 'data-testid': 'usage-chart-summary', style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } },
                  translate('usage.chartSummary', { total: formatTokenValue(chartValues.reduce((a, b) => a + b, 0)) })),
                // 提示框追加三行汇总：token 总量 / 成功模型步骤 / 缓存命中率。
                // 命中率取宿主已按当日桶加权的 cacheHitRate（比率不可跨桶相加，见知识库同名条目）；
                // 旧宿主缺该字段时按同一加权式 ΣcacheRead ÷ Σ(input+cacheRead+cacheWrite) 回算。
                hoveredUsageSegment ? React.createElement('div', { 'data-testid': 'usage-tooltip', style: { position: 'fixed', left: `${hoveredUsageSegment.x + 12}px`, top: `${hoveredUsageSegment.y + 12}px`, zIndex: 1000, pointerEvents: 'none', padding: '7px 9px', borderRadius: '6px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontSize: '12px', fontWeight: 600, whiteSpace: 'pre-line', textAlign: 'left' } }, (() => {
                  const totals = hoveredUsageSegment.totals || {}
                  const totalValue = usageValue(totals, 'inputTokens') + usageValue(totals, 'outputTokens') + usageValue(totals, 'cacheTokens')
                  const denominator = Number(totals.inputTokens || 0) + Number(totals.cacheReadTokens || 0) + Number(totals.cacheWriteTokens || 0)
                  const hitRate = Number.isFinite(Number(totals.cacheHitRate))
                    ? Number(totals.cacheHitRate)
                    : (denominator === 0 ? 0 : Number(totals.cacheReadTokens || 0) / denominator)
                  return `${translate('usage.tooltip.date', { date: hoveredUsageSegment.date })}\n${translate('usage.tooltip.input', { value: Number(totals.inputTokens || 0).toLocaleString() })}\n${translate('usage.tooltip.output', { value: Number(totals.outputTokens || 0).toLocaleString() })}\n${translate('usage.tooltip.cache', { value: Number((totals.cacheReadTokens || 0) + (totals.cacheWriteTokens || 0)).toLocaleString() })}\n${translate('usage.tooltip.total', { value: formatTokenValue(totalValue) })}\n${translate('usage.tooltip.steps', { value: Number(totals.steps || 0).toLocaleString() })}\n${translate('usage.tooltip.hitRate', { value: (hitRate * 100).toFixed(1) + '%' })}`
                })()) : null,
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginTop: '10px' } },
                  summaryBlock('today', 'usage.today', todayTotals),
                  summaryBlock('seven', 'usage.sevenDays', sevenTotals)),
                React.createElement('div', { 'data-testid': 'usage-model-list', style: { marginTop: '10px', padding: '8px 10px', borderRadius: '8px', background: 'var(--dsh-svc-raised-bg)', border: '1px solid var(--dsw-alias-border-l1)' } },
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' } },
                    React.createElement('div', { 'data-testid': 'usage-model-sort-hint', style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, translate(`usage.modelSortHint.${modelScope}`)),
                    React.createElement('div', { 'data-testid': 'usage-model-scope-tabs', style: { display: 'flex', gap: '2px' } },
                      ['today', 'week', 'all'].map((scopeId) => React.createElement('button', {
                        key: scopeId,
                        'data-testid': `usage-model-scope-${scopeId}`,
                        style: Object.assign({}, compactTab, modelScope === scopeId ? inlineTabActive : { color: 'var(--dsw-alias-label-secondary)', borderBottom: '2px solid transparent' }),
                        onClick: () => setModelScope(scopeId),
                      }, translate(`usage.modelScope.${scopeId}`))))),
                  visibleModels.map((model, index) => {
                    const total = modelTotalTokens(model)
                    const fillWidth = `${Math.round(total / maxModelTokens * 10000) / 100}%`
                    return React.createElement('div', { key: model.id, 'data-testid': `usage-model-row-${model.id}`, style: { padding: '8px 2px', borderTop: index === 0 ? 0 : '1px solid var(--dsw-alias-border-l1)' } },
                      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', fontSize: '12px' } },
                        React.createElement('span', { style: { overflowWrap: 'anywhere' } }, model.id),
                        React.createElement('span', { style: { fontWeight: 650, whiteSpace: 'nowrap' } }, formatTokenValue(total))),
                      React.createElement('div', { 'data-testid': `usage-model-bar-${model.id}`, 'data-value': total, 'aria-label': translate(`usage.modelBar.${modelScope}`, { model: model.id, total: formatTokenValue(total) }), style: { height: '8px', borderRadius: '4px', marginTop: '6px', overflow: 'hidden', background: 'var(--dsw-alias-border-l1)' } },
                        React.createElement('div', { style: { display: 'flex', height: '100%', width: fillWidth } },
                          usageSegments.map(([metricName, , color]) => {
                            const value = modelSegmentValue(model, metricName)
                            return value > 0 ? React.createElement('div', { key: metricName, 'data-testid': `usage-model-segment-${model.id}-${metricName}`, style: { width: `${value / total * 100}%`, background: color } }) : null
                          }))),
                      React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginTop: '4px', textAlign: 'right' } }, translate('usage.modelLine', {
                        steps: Number(model.steps || 0).toLocaleString(),
                        hitRate: formatUsageValue(modelCacheHitRate(model), 'cacheHitRate'),
                        input: formatTokenValue(model.inputTokens),
                        output: formatTokenValue(model.outputTokens),
                      })))
                  }),
                  hiddenModelCount > 0 ? React.createElement('button', { style: Object.assign({}, toggle, { borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: '2px' }), onClick: () => setModelsOpen((value) => !value) }, `${modelsOpen ? '▾' : '▸'} ${translate(modelsOpen ? 'usage.models.less' : 'usage.models.more', { count: hiddenModelCount })}`) : null),
                  // 热力日历是统计区（usage-statistics-region）的**同级子块**，与图表/汇总卡/模型列表同一容器、
                  // 同一内缩；此前误挂在 usage-card 上（跳过 region），导致它比上方各块宽 13px/侧而显得脱节。
                  heatmapBlock)
            : React.createElement('p', { style: hint }, usageError || translate('usage.empty')),
          ...(usage && usage.indexedSessions > 0 ? [] : [React.createElement('div', { key: 'usage-refresh-fallback', style: row }, React.createElement('button', { style: neutral, 'data-variant': 'neutral', onClick: refreshUsage, disabled: usageBusy }, translate(usageBusy ? 'usage.refreshing' : 'usage.refresh')))]))

        // 平台标签：process.platform 映射为常见系统名，arch 跟在后面（均为专有名词，不走词典）。
        const platformNames = { win32: 'Windows', darwin: 'macOS', linux: 'Linux', freebsd: 'FreeBSD', openbsd: 'OpenBSD' }
        const platformLabel = (health && typeof health.platform === 'string' && health.platform)
          ? `${platformNames[health.platform] || health.platform}${typeof health.arch === 'string' && health.arch ? ` · ${health.arch}` : ''}`
          : '—'
        // 与 versionBlock 同用 `card`（padding 4px 0 14px + marginBottom 12px）承载「区块标题 + 展示面」，
        // 不再用 `marginTop: 18px` 手工下沉——后者与 card 的 marginBottom 相邻折叠成 18px，
        // 使概览的区块纵向节奏与其它页（统一 12px）不一致。
        const containerInfoBlock = React.createElement('div', { key: 'container-info', style: card },
          React.createElement('div', { style: sectionTitle }, translate('overview.container')),
          health
            ? React.createElement('div', { 'data-testid': 'health-display', style: Object.assign({}, displaySurface, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }) },
                metric('health.platform', platformLabel),
                metric('health.nodeVersion', typeof health.nodeVersion === 'string' && health.nodeVersion ? health.nodeVersion : '—'),
                metric('health.uptime', formatUptime(health.uptimeSeconds)),
                metric('health.rss', formatBytes(health.rssBytes)),
                metric('health.liveSessions', String(health.liveSessions)),
                metric('health.persistedSessions', String(health.persistedSessions)),
                metric('health.activeAgents', String(health.activeAgents)),
                metric('health.activeJobs', String(health.activeJobs)))
            : React.createElement('p', { style: hint }, healthError || translate('version.loading')))
        const overviewErrorsBlock = React.createElement('div', { key: 'overview-errors', style: card },
          React.createElement('div', { 'data-testid': 'overview-errors-title', style: sectionTitle }, translate('overview.errors')),
          React.createElement('div', { 'data-testid': 'overview-errors-region', style: displaySurface },
            React.createElement('div', { style: Object.assign({}, hint, { margin: '-3px 0 7px' }) }, translate('usage.errors.recent')),
            React.createElement('div', { style: { display: 'grid', gap: '7px' } },
              React.createElement('div', null,
                React.createElement('button', { style: toggle, onClick: () => setModelErrorsOpen((value) => !value) }, `${modelErrorsOpen ? '▾' : '▸'} ${translate('usage.errors.toggle', { count: modelErrors.length })}`),
                modelErrorsOpen ? React.createElement('div', { style: { padding: '0 2px 8px' } }, errorList('model', modelErrors)) : null),
              React.createElement('div', null,
                React.createElement('button', { style: toggle, onClick: () => setToolErrorsOpen((value) => !value) }, `${toolErrorsOpen ? '▾' : '▸'} ${translate('usage.toolErrors.toggle', { count: toolErrors.length })}`),
                toolErrorsOpen ? React.createElement('div', { style: { padding: '0 2px 8px' } }, errorList('tool', toolErrors)) : null))))
        // 诊断检查项行渲染（宿主检查项与客户端专属行共用）：主行=检查名+状态点，次行=详情；
        // 异常行（error/非 advisory warning）局部淡染强调，正常行低对比。
        const renderCheckRow = (check, index, detailText) => {
          const abnormal = check.status === 'error' || (check.status === 'warning' && check.advisory !== true)
          const dotColor = check.status === 'ok' ? 'var(--dsh-svc-success)' : check.status === 'warning' ? 'var(--dsh-svc-warning)' : check.status === 'info' ? 'var(--dsh-svc-info)' : 'var(--dsh-svc-danger)'
          return React.createElement('div', { key: check.id, 'data-testid': `health-check-${check.id}`, style: { display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '9px 10px', borderRadius: '6px', borderTop: index === 0 ? 0 : '1px solid var(--dsh-svc-border)', background: abnormal ? (check.status === 'error' ? 'rgba(211,51,51,0.08)' : 'rgba(198,128,0,0.10)') : 'transparent' } },
            React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '7px', height: '7px', ...fullRound('50%'), marginTop: '5px', background: dotColor } }),
            React.createElement('div', { style: { minWidth: 0, flex: 1 } },
              React.createElement('div', { style: { fontSize: '12px', fontWeight: abnormal ? 650 : 550, color: 'var(--dsh-svc-text)' } }, translate('health.check.' + check.id)),
              React.createElement('div', { style: { fontSize: '11px', lineHeight: 1.5, marginTop: '2px', color: check.status === 'ok' ? 'var(--dsh-svc-text-muted)' : abnormal ? (check.status === 'error' ? 'var(--dsh-svc-danger)' : 'var(--dsh-svc-warning)') : 'var(--dsh-svc-text-muted)' } }, detailText)))
        }
        // 浏览器通知权限检查（客户端专属）：宿主看不到浏览器侧权限，故此行的数据源必须在客户端。
        // 语义：granted → ok；尚未授权（default）与被拒（denied）都是「通知不会响」= warning；
        // 浏览器不支持 → info（非用户可修的故障）。功能关闭时返回 null（整行不渲染）。
        // 刻意不进入 diagnostics.checks：概览可行动项与诊断标签 ⚠ 都只消费宿主下发的检查项，
        // 本行仅作诊断页内的可见性补足（被拒时静默失效才是真问题）。
        const notificationPermissionCheck = features.taskNotifications === false
          ? null
          : typeof Notification === 'undefined'
            ? { status: 'info', detail: translate('health.detail.notification-permission.unsupported') }
            : Notification.permission === 'granted'
              ? { status: 'ok', detail: translate('health.detail.notification-permission.granted') }
              : { status: 'warning', detail: translate(Notification.permission === 'denied' ? 'health.detail.notification-permission.denied' : 'health.detail.notification-permission.default') }
        const healthSummaryBlock = React.createElement('div', { 'data-testid': 'health-diagnostics-region', style: displaySurface },
          // v0.39 用户复核：重新诊断按钮移入页面头右侧（SvcPageHeader action 位），此处不再独占一行。
          diagnostics && diagnostics.status !== 'ok'
            ? React.createElement('div', { style: { marginTop: '10px', padding: '9px 11px', borderRadius: '7px', background: diagnostics.status === 'error' ? 'rgba(211,51,51,0.1)' : 'rgba(198,128,0,0.12)', border: '1px solid ' + (diagnostics.status === 'error' ? 'rgba(211,51,51,0.3)' : 'rgba(198,128,0,0.3)') } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('health.alert.title')),
                React.createElement('div', { style: hint }, translate('health.alert.diagnostics', { status: translate('health.overall.' + diagnostics.status) })))
            : null,
          diagnostics
            ? React.createElement('div', { 'data-testid': 'health-check-list', style: Object.assign({}, displaySurface, { marginTop: '10px', padding: '8px 10px' }) },
                ...diagnostics.checks.map((check, index) => renderCheckRow(check, index, diagnosticDetail(check))),
                // 浏览器通知权限（客户端专属检查行，追加在宿主检查项之后）：宿主看不到浏览器侧权限，
                // 故不塞进 diagnostics.checks（那是宿主下发的结构化报告，客户端伪造会混淆数据来源），
                // 也不进概览可行动项与标签 ⚠——只在诊断页呈现。
                ...(notificationPermissionCheck === null
                  ? []
                  : [renderCheckRow(
                      { id: 'notification-permission', status: notificationPermissionCheck.status },
                      diagnostics.checks.length,
                      notificationPermissionCheck.detail)]))
            : null)
        // v1.3 插件健康检查：只显示异常插件（官方设置页已有完整插件清单与开关，不做重复清单）。
        // 检查项行内摘要把 failed/pending/informational 计数说清楚；这里列出每个异常插件的名字、
        // 错误原文/缺失依赖，并对失败插件提供「重新加载」两段式。
        const pluginIssues = Array.isArray(diagnostics?.pluginIssues) ? diagnostics.pluginIssues : []
        const pluginIssueBlock = pluginIssues.length === 0
          ? null
          : React.createElement('div', { 'data-testid': 'plugin-issue-list', style: { marginTop: '6px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--dsh-svc-border)', background: 'var(--dsh-svc-raised-bg)' } },
              pluginIssues.map((issue, index) => {
                const failed = issue.phase === 'failed'
                const informational = issue.phase === 'disposed' || issue.phase === 'unknown'
                const phaseColor = failed ? 'var(--dsh-svc-danger)' : informational ? 'var(--dsh-svc-info)' : 'var(--dsh-svc-warning)'
                const confirming = pluginConfirmEntry === issue.entryId
                const busy = pluginBusyEntry === issue.entryId
                return React.createElement('div', { key: issue.entryId, 'data-testid': `plugin-issue-${issue.entryId}`, style: { display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '8px 2px', borderTop: index === 0 ? 0 : '1px solid var(--dsh-svc-border)' } },
                  React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '7px', height: '7px', ...fullRound('50%'), marginTop: '6px', background: phaseColor } }),
                  React.createElement('div', { style: { minWidth: 0, flex: 1 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
                      React.createElement('span', { style: { fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: '12px', fontWeight: 600, overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-primary)' } }, issue.moduleName),
                      React.createElement('span', { style: { fontSize: '11px', fontWeight: 650, color: phaseColor } }, translate('plugin.state.' + issue.phase))),
                    issue.error !== undefined && issue.error !== null
                      ? React.createElement('div', { style: { fontSize: '11px', marginTop: '3px', color: 'var(--dsh-svc-danger)', lineHeight: 1.5, overflowWrap: 'anywhere' } }, translate('plugin.error', { error: issue.error }))
                      : null,
                    issue.missingDeps !== undefined && issue.missingDeps.length > 0
                      ? React.createElement('div', { style: { fontSize: '11px', marginTop: '3px', color: 'var(--dsh-svc-warning)', lineHeight: 1.5, overflowWrap: 'anywhere' } }, translate('plugin.missingDeps', { deps: issue.missingDeps.join(', ') }))
                      : null,
                    failed
                      ? React.createElement('div', { style: { marginTop: '6px' } },
                          confirming
                            ? React.createElement('div', { style: { padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-state-error-primary)', background: 'rgba(211,51,51,0.08)' } },
                                React.createElement('p', { style: Object.assign({}, hint, { margin: '0 0 6px', color: 'var(--dsw-alias-state-error-primary)' }) }, translate('plugin.restartHint', { name: issue.moduleName })),
                                React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                                  React.createElement('button', { type: 'button', 'data-testid': `plugin-restart-confirm-${issue.entryId}`, style: danger, disabled: busy, onClick: () => restartPlugin(issue) }, translate(busy ? 'plugin.restarting' : 'plugin.restartConfirm')),
                                  React.createElement('button', { type: 'button', style: ghost, disabled: busy, onClick: () => { setPluginConfirmEntry(null); setPluginRestartError(null) } }, translate('plugin.restartCancel'))))
                            : React.createElement('button', { type: 'button', 'data-testid': `plugin-restart-${issue.entryId}`, style: dangerGhost, disabled: busy, onClick: () => { setPluginConfirmEntry(issue.entryId); setPluginRestartError(null) } }, translate(busy ? 'plugin.restarting' : 'plugin.restart')))
                      : null,
                    pluginRestartError ? React.createElement('p', { 'data-testid': 'plugin-restart-error', style: Object.assign({}, hint, { margin: '4px 0 0', color: 'var(--dsw-alias-state-error-primary)' }) }, pluginRestartError) : null))
              }))
        // v1.3 插件兼容性：对照已核实的 alpha 破坏面清单扫描启用插件，命中才显示行
        // （字体说明见 plugin-compat.js 的 COMPAT_BREAKS；未扫成的插件单独提示原因）。
        // 四档分级：真引用破坏（可能不兼容，warning）→ 退役接口引用（蓝色提示，info）→ 仅声明残留（代码未引用、官方 loader 静默
        // 跳过缺失供应商，info 无害提示）→ 未扫描（info）。
        // 展示契约：**一个插件一行**——同一插件可能同时落在多档（如既注册退役槽位又留了声明残留），
        // 各档不再各占一行、不再重复插件名；行的圆点与徽标取该插件最重的一档，行内按严重度列出各档命中。
        const pluginCompatScan = diagnostics?.pluginCompat !== null && typeof diagnostics?.pluginCompat === 'object' ? diagnostics.pluginCompat : null
        const pluginCompatIssues = Array.isArray(pluginCompatScan?.issues) ? pluginCompatScan.issues : []
        const pluginCompatSoft = Array.isArray(pluginCompatScan?.soft) ? pluginCompatScan.soft : []
        const pluginCompatDeclared = Array.isArray(pluginCompatScan?.declaredOnly) ? pluginCompatScan.declaredOnly : []
        const pluginCompatUnknown = Array.isArray(pluginCompatScan?.unknown) ? pluginCompatScan.unknown : []
        // 分档严重度序（小 = 重）。归并序取首次出现的档位，故 broken 插件整体排在退役接口/声明残留之前。
        const pluginCompatKindOrder = { broken: 0, soft: 1, declared: 2, unknown: 3 }
        const COMPAT_BREAK_METAS = {
          'client-runtime': { since: '0.1.2-alpha.2', kind: 'package-removed' },
          'sqlite-persistence': { since: '0.1.2-alpha.3', kind: 'package-removed' },
          'code-runtime': { since: '0.1.6-alpha.1', kind: 'package-removed' },
          'e2b-runtime': { since: '0.1.6-alpha.1', kind: 'package-removed' },
          'session-start-event': { since: '0.1.6-alpha.1', kind: 'event-removed' },
          'chat-hash': { since: '0.1.2-alpha.2', kind: 'hash-migrated' },
          'stats-hash': { since: '0.1.2-alpha.2', kind: 'hash-migrated' },
          'time-hover-root': { since: '0.1.2-alpha.2', kind: 'attribute-removed' },
          'settings-plugin-item': { since: '0.1.6-alpha.2', kind: 'slot-retired' },
          'sessions-open-method': { since: '0.1.6-alpha.2', kind: 'method-removed' },
          'settings-scope': { since: '0.1.7-alpha.1', kind: 'service-removed' },
          'settings-register': { since: '0.1.7-alpha.1', kind: 'method-removed' },
          'settings-get': { since: '0.1.7-alpha.1', kind: 'method-removed' },
        }
        const pluginCompatFindings = [
          ...pluginCompatIssues.map((issue) => ({ kind: 'broken', moduleName: issue.moduleName, breaks: issue.breaks })),
          ...pluginCompatSoft.map((item) => ({ kind: 'soft', moduleName: item.moduleName, breaks: item.breaks })),
          ...pluginCompatDeclared.map((item) => ({ kind: 'declared', moduleName: item.moduleName, breaks: item.breaks })),
          ...pluginCompatUnknown.map((item) => ({ kind: 'unknown', moduleName: item.moduleName, reason: item.reason })),
        ]
        const pluginCompatGrouped = new Map()
        for (const finding of pluginCompatFindings) {
          const bucket = pluginCompatGrouped.get(finding.moduleName)
          if (bucket === undefined) pluginCompatGrouped.set(finding.moduleName, [finding])
          else bucket.push(finding)
        }
        const pluginCompatFindingText = (finding) => finding.kind === 'broken' || finding.kind === 'soft'
          ? finding.breaks.map((id) => translate('plugin.compat.break.' + id)).join('；')
          : finding.kind === 'declared'
            ? translate('plugin.compat.declared')
            : translate(`plugin.compat.unknown.${finding.reason}`)
        const pluginCompatRows = [...pluginCompatGrouped].map(([moduleName, findings], index) => {
          const sorted = [...findings].sort((a, b) => pluginCompatKindOrder[a.kind] - pluginCompatKindOrder[b.kind])
          return { key: `${sorted[0].kind}-${index}`, moduleName, findings: sorted }
        })
        const pluginCompatBlock = pluginCompatScan === null || pluginCompatRows.length === 0
          ? null
          : React.createElement('div', { 'data-testid': 'plugin-compat-list', style: { marginTop: '6px', padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--dsh-svc-border)', background: 'var(--dsh-svc-raised-bg)' } },
              pluginCompatRows.map((row, index) => {
                const warning = row.findings[0].kind === 'broken'
                const rowColor = warning ? 'var(--dsh-svc-warning)' : 'var(--dsh-svc-info)'
                return React.createElement('div', { key: row.key, 'data-testid': `plugin-compat-row-${index}`, style: { display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '8px 2px', borderTop: index === 0 ? 0 : '1px solid var(--dsh-svc-border)' } },
                  // 圆点与插件名第一行光学居中：名称行高钉 17px；代码字体的字面盒中心比行盒中心
                  // 实测低 2.5px（探针 getBoundingClientRect 实证），故上边距取 (17-7)/2 + 2.5 = 7.5px。
                  React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '7px', height: '7px', ...fullRound('50%'), marginTop: '7.5px', background: rowColor } }),
                  React.createElement('div', { style: { minWidth: 0, flex: 1 } },
                    React.createElement('span', { style: { fontFamily: 'var(--ds-font-family-code, monospace)', fontSize: '12px', fontWeight: 600, lineHeight: '17px', overflowWrap: 'anywhere', color: 'var(--dsw-alias-label-primary)' } }, row.moduleName),
                    // 分档标签独立成行排在插件名下方（颜色随档位：可能不兼容=警示黄，其余=信息蓝），
                    // 正文段落跟在自己标签的下面——标签管「属于哪一档」，正文管「具体是什么」，不挤同一行。
                    row.findings.flatMap((finding, findingIndex) => {
                      const detailBlocks = Array.isArray(finding.breaks) && finding.breaks.length > 0
                        ? finding.breaks.map((breakId, dIdx) => {
                            const meta = COMPAT_BREAK_METAS[breakId]
                            const since = meta?.since
                            const kind = meta?.kind
                            const active = since && version ? compareSemver(version, since) >= 0 : true
                            const catKey = 'plugin.compat.category.' + kind
                            const catLabel = translate(catKey) !== catKey ? translate(catKey) : kind
                            const badgeLabel = active
                              ? translate('plugin.compat.badge.active')
                              : translate('plugin.compat.badge.future', { since: since || '' })
                            const reasonKey = 'plugin.compat.reason.' + breakId
                            const impactKey = 'plugin.compat.impact.' + breakId
                            const adviceKey = 'plugin.compat.advice.' + breakId
                            const hasReason = translate(reasonKey) !== reasonKey
                            const hasImpact = translate(impactKey) !== impactKey
                            const hasAdvice = translate(adviceKey) !== adviceKey
                            // 详情卡片配色跟档位走：只有 broken 档且已生效才用警示黄——info 档
                            // （退役接口引用/仅声明残留）即使「当前版本已生效」也保持信息蓝，
                            // 与行圆点、分档标签同一套视觉语义（2026-09-23 settings-scope 降档）。
                            const toneWarning = finding.kind === 'broken' && active

                            return React.createElement('div', {
                              key: `${row.key}-${finding.kind}-detail-${dIdx}`,
                              'data-testid': `plugin-compat-detail-${index}-${findingIndex}-${dIdx}`,
                              style: {
                                marginTop: '5px',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                background: toneWarning ? 'rgba(230, 162, 60, 0.05)' : 'rgba(64, 158, 255, 0.05)',
                                border: `1px solid ${toneWarning ? 'rgba(230, 162, 60, 0.25)' : 'rgba(64, 158, 255, 0.25)'}`,
                                fontSize: '11px',
                                lineHeight: 1.6,
                              },
                            },
                              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '3px' } },
                                catLabel ? React.createElement('span', {
                                  style: {
                                    fontWeight: 650,
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    background: toneWarning ? 'var(--dsh-svc-warning)' : 'var(--dsh-svc-info)',
                                    color: '#fff',
                                    fontSize: '10px',
                                  }
                                }, catLabel) : null,
                                since ? React.createElement('span', {
                                  style: {
                                    padding: '1px 5px',
                                    borderRadius: '3px',
                                    background: 'var(--dsh-svc-border)',
                                    color: 'var(--dsw-alias-label-primary)',
                                    fontSize: '10px',
                                    fontFamily: 'var(--ds-font-family-code, monospace)',
                                    fontWeight: 600,
                                  }
                                }, `DSH ≥ ${since}`) : null,
                                React.createElement('span', {
                                  style: {
                                    color: toneWarning ? 'var(--dsh-svc-warning)' : 'var(--dsh-svc-info)',
                                    fontSize: '10px',
                                    fontWeight: 600,
                                  }
                                }, badgeLabel),
                              ),
                              hasReason ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: '2px' } },
                                React.createElement('strong', { style: { color: 'var(--dsw-alias-label-primary)', marginRight: '4px' } }, translate('plugin.compat.meta.reason') + '：'),
                                translate(reasonKey),
                              ) : null,
                              hasImpact ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: '2px' } },
                                React.createElement('strong', { style: { color: 'var(--dsw-alias-label-primary)', marginRight: '4px' } }, translate('plugin.compat.meta.impact') + '：'),
                                translate(impactKey),
                              ) : null,
                              hasAdvice ? React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', marginTop: '2px' } },
                                React.createElement('strong', { style: { color: 'var(--dsw-alias-label-primary)', marginRight: '4px' } }, translate('plugin.compat.meta.advice') + '：'),
                                translate(adviceKey),
                              ) : null,
                            )
                          })
                        : []

                      return [
                        React.createElement('div', {
                          key: `${row.key}-${finding.kind}-kind`,
                          'data-testid': `plugin-compat-kind-${index}-${findingIndex}`,
                          style: { fontSize: '11px', fontWeight: 650, marginTop: findingIndex === 0 ? '3px' : '7px', color: finding.kind === 'broken' ? 'var(--dsh-svc-warning)' : 'var(--dsh-svc-info)' },
                        }, translate('plugin.compat.kind.' + finding.kind)),
                        React.createElement('div', {
                          key: `${row.key}-${finding.kind}-text`,
                          'data-testid': `plugin-compat-line-${index}-${findingIndex}`,
                          style: { fontSize: '11px', marginTop: '1px', lineHeight: 1.6, overflowWrap: 'anywhere', color: finding.kind === 'broken' ? 'var(--dsh-svc-warning)' : 'var(--dsh-svc-text-muted)' },
                        }, pluginCompatFindingText(finding)),
                        ...detailBlocks,
                      ]
                    })))
              }))
        const permissionAbnormal = permissions && permissions.supported === true
          ? permissions.items.filter((item) => item.writable === false).length
          : 0
        const permissionNeedsRepair = permissionAbnormal > 0 || (permissionDeep && (permissionDeep.ownerIssues > 0 || permissionDeep.directoryModeIssues > 0 || permissionDeep.fileModeIssues > 0 || permissionDeep.unreadable > 0))
        const permissionBlock = permissions && permissions.supported === true
          ? React.createElement('div', { key: 'permissions-section', style: { marginTop: '18px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } },
                React.createElement('div', { style: sectionTitle }, translate('permissions.title')),
                React.createElement('button', {
                  type: 'button',
                  'data-testid': 'permissions-toggle',
                  'aria-expanded': String(permissionOpen),
                  onClick: () => setPermissionOpen((value) => !value),
                  style: { fontSize: '12px', lineHeight: '20px', padding: '2px 12px', ...fullRound(999), border: '1px solid var(--dsh-svc-border-strong)', background: 'transparent', color: permissionAbnormal > 0 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-primary)', cursor: 'pointer' },
                }, `${permissionOpen ? '▾' : '▸'} ${translate(permissionOpen ? 'permissions.hide' : 'permissions.show')}${permissionAbnormal > 0 ? ` · ${permissionAbnormal}` : ''}`)),
              permissionOpen
                ? React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
              React.createElement('p', { style: hint }, translate('permissions.description')),
              permissionAbnormal > 0 ? React.createElement('div', { style: { marginTop: '8px', padding: '9px 11px', borderRadius: '7px', background: 'rgba(198,128,0,0.12)', border: '1px solid rgba(198,128,0,0.3)' } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('health.alert.title')),
                React.createElement('div', { style: hint }, translate('permissions.summary.warning', { count: permissionAbnormal }))) : null,
              React.createElement('p', { style: Object.assign({}, hint, { fontWeight: 600, color: permissionAbnormal > 0 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-primary)' }) }, translate(permissionAbnormal > 0 ? 'permissions.summary.warning' : 'permissions.summary.ok', { count: permissionAbnormal > 0 ? permissionAbnormal : permissions.items.length })),
              React.createElement('p', { style: Object.assign({}, hint, { fontWeight: 600 }) }, translate('permissions.target', { owner: permissions.targetOwner })),
              React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                React.createElement('button', { style: neutral, onClick: () => setPermissionDetails((value) => !value) }, translate(permissionDetails ? 'permissions.hideDetails' : 'permissions.showDetails')),
                React.createElement('button', { style: neutral, 'data-variant': 'neutral', onClick: deepCheckPermissions, disabled: permissionDeepBusy }, translate(permissionDeepBusy ? 'permissions.deepChecking' : 'permissions.deep'))),
              permissionDeep ? React.createElement('p', { style: hint }, translate('permissions.deepSummary', { scanned: permissionDeep.scanned, duration: permissionDeep.durationMs, owner: permissionDeep.ownerIssues, directories: permissionDeep.directoryModeIssues, files: permissionDeep.fileModeIssues, unreadable: permissionDeep.unreadable })) : null,
              permissionDetails ? React.createElement('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } },
                permissions.items.map((item) => React.createElement('div', {
                  key: item.path,
                  style: { padding: '9px 10px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsh-svc-raised-bg)', color: 'var(--dsw-alias-label-primary)' },
                },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 600 } }, item.label),
                React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } }, item.path),
                React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '12px', marginTop: '3px' } }, `${item.owner} · ${item.mode}`)))) : null,
              permissionConfirm
                ? React.createElement('div', { style: { marginTop: '10px' } },
                    React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, translate('permissions.confirmHint')),
                    React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                      React.createElement('button', { style: danger, disabled: permissionBusy, onClick: repairPermissions }, translate(permissionBusy ? 'permissions.repairing' : 'permissions.confirm')),
                      React.createElement('button', { style: ghost, disabled: permissionBusy, onClick: () => setPermissionConfirm(false) }, translate('permissions.cancel'))))
                : permissionNeedsRepair
                   ? React.createElement('button', { style: Object.assign({}, dangerGhost, { marginTop: '10px' }), 'data-variant': 'dangerGhost', disabled: permissionBusy, onClick: () => setPermissionConfirm(true) }, translate('permissions.repair'))
                   : null,
              permissionError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, permissionError) : null)
              : null)
          : null

        const healthBlock = React.createElement('div', { key: 'health-section', 'data-testid': 'health-card', style: card },
          // v0.39 省空间：页头标题即「健康诊断」，去掉内容区重复区块标题。
          healthSummaryBlock,
          pluginIssueBlock,
          pluginCompatBlock,
          permissionBlock)

        // v0.45 进度显示：一根连续不清零的总进度条，按阶段加权映射——
        // 复制 0–30%（真实字节）、打包 30–70%（已写入归档字节 ÷ 源字节估算）、校验 70–95%（无细分信号，保持段起点）、发布 95–100%。
        // 校验/发布段的 95/100 差值在发布完成瞬间补满，避免打包估算误差导致条回退。
        const BACKUP_PHASE_STEP = { copy: 1, archive: 2, validate: 3, publish: 4 }
        const backupProgressActive = backupBusy && backupProgress?.active === true
        const backupProgressPhase = backupProgressActive ? (backupProgress.phase || 'copy') : 'copy'
        const backupProgressStep = BACKUP_PHASE_STEP[backupProgressPhase] || 1
        const backupProgressPercent = (() => {
          if (!backupProgressActive) return 0
          const total = Number(backupProgress.totalBytes) || 0
          let raw
          if (backupProgressPhase === 'copy') raw = total > 0 ? Math.min(30, Math.floor(backupProgress.copiedBytes / total * 30)) : 0
          else if (backupProgressPhase === 'archive') {
            const ratio = total > 0 ? Math.min(1, Number(backupProgress.archiveBytes) / total) : 0
            raw = Math.min(70, 30 + Math.floor(ratio * 40))
          } else if (backupProgressPhase === 'validate') raw = 70
          else raw = 100
          // 单调守卫：只进不退（重试从 0 重跑或异常快照不回退条幅）。
          const shown = Math.max(backupProgressPercentRef.current, raw)
          backupProgressPercentRef.current = shown
          return shown
        })()
        const backupProgressDetail = !backupProgressActive ? ''
          : backupProgressPhase === 'copy'
            ? `${formatSize(backupProgress.copiedBytes)} / ${formatSize(backupProgress.totalBytes)}`
            : (backupProgress.archiveBytes > 0 ? formatSize(backupProgress.archiveBytes) : '')

        const backupBlock = React.createElement('div', { key: 'backup-section' },
          React.createElement('div', { style: sectionTitle }, translate('backup.title')),
          React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
          React.createElement('p', { style: hint }, translate('backup.description')),
          React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
            React.createElement('button', { style: Object.assign({}, secondary, { flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }), 'data-variant': 'brandGhost', onClick: createBackup, disabled: backupBusy }, translate(backupBusy ? 'backup.creating' : 'backup.create')),
            React.createElement('label', { style: Object.assign({}, neutral, { flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: backupImportBusy ? 'default' : 'pointer' }) },
              translate(backupImportBusy ? 'backup.importing' : 'backup.import'),
              React.createElement('input', { type: 'file', accept: '.tar.gz,application/gzip', disabled: backupImportBusy, onChange: importBackup, style: { display: 'none' } }))),
          backupBusy && backupProgress?.active === true
            ? React.createElement('div', { 'data-testid': 'backup-progress', style: { marginTop: '10px' } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                  React.createElement('span', null, translate('backup.progress.' + backupProgressPhase, { current: backupProgressStep, total: 4 })),
                  React.createElement('span', null, backupProgressDetail)),
                React.createElement('div', { style: { marginTop: '5px', height: '6px', ...fullRound('999px'), background: 'var(--dsh-svc-raised-bg)', border: '1px solid var(--dsw-alias-border-l1)', overflow: 'hidden' } },
                  React.createElement('div', { style: { height: '100%', width: backupProgressPercent + '%', background: 'var(--dsw-alias-brand-primary)', transition: 'width 240ms ease' } })))
            : null,
          React.createElement('p', { style: hint }, translate('backup.total', { size: formatSize(backups.totalBytes) })),
          backupManualRestart ? React.createElement('div', { 'data-testid': 'backup-manual-restart', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'rgba(198,128,0,0.10)' } },
            React.createElement('div', { style: { fontWeight: 650, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('backup.manualRestartTitle')),
            React.createElement('p', { style: Object.assign({}, hint, { margin: '4px 0 0' }) }, translate('backup.manualRestartBody'))) : null,
          backupError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)' }) }, backupError) : null,
          backups.items.length === 0
            ? React.createElement('p', { style: hint }, translate('backup.empty'))
            : backups.items.length > 10
              ? React.createElement('button', { style: Object.assign({}, ghost, { marginTop: '8px' }), onClick: () => setBackupDetails((value) => !value) }, translate(backupDetails ? 'backup.hideRecords' : 'backup.showRecords'))
              : null,
          backups.items.length > 0 && (backups.items.length <= 10 || backupDetails)
            ? React.createElement('div', { style: { marginTop: '10px', display: 'grid', gap: '8px' } },
                backups.items.map((item) => React.createElement('div', {
                  key: item.id,
                  // v0.39 轻行：分隔线代替独立卡片底；主行=文件名，次行=体积 · 时间，行尾上下文操作。
                  style: { padding: '9px 2px', borderBottom: '1px solid var(--dsh-svc-border)', color: 'var(--dsw-alias-label-primary)' },
                },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' } },
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '12px', overflowWrap: 'anywhere' } }, item.name),
                    // 备份时的 DSH 版本：宿主随每条记录下发 dshVersion，老归档给 null，
                    // 此时完全不渲染这一节，不给用户看「未知」这种噪声。
                    item.dshVersion ? React.createElement('div', { 'data-testid': `backup-row-version-${item.id}`, style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginTop: '3px' } }, translate('backup.row.version', { version: item.dshVersion })) : null,
                    React.createElement('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', marginTop: '3px' } }, `${formatSize(item.sizeBytes)} · ${new Date(item.createdAt).toLocaleString()}`)),
                  React.createElement('div', { style: { display: 'flex', gap: '6px', flexShrink: 0 } },
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: svcRowActionStyle(), disabled: backupExportBusy || backupBusy, onClick: () => exportBackup(item.id) }, translate(backupExportBusy ? 'backup.exporting' : 'backup.export')),
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: svcRowActionStyle(), disabled: backupBusy, onClick: () => prepareBackupRestore(item.id) }, translate(backupBusy && backupRestoreId === item.id ? 'backup.inspecting' : 'backup.restore')),
                    backupDeleteId === item.id || backupRestoreId === item.id
                      ? null
                      : React.createElement('button', { style: Object.assign({}, dangerGhost, { minHeight: '28px', padding: '4px 9px' }), 'data-variant': 'dangerGhost', disabled: backupBusy, onClick: () => setBackupDeleteId(item.id) }, translate('backup.delete')),
                  )),
                backupDeleteId === item.id
                  ? React.createElement('div', { style: { marginTop: '8px' } },
                      React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)', margin: '0 0 6px' }) }, translate('backup.confirmHint')),
                      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                        React.createElement('button', { style: danger, disabled: backupBusy, onClick: () => deleteBackup(item.id) }, translate('backup.confirm')),
                        React.createElement('button', { style: ghost, disabled: backupBusy, onClick: () => setBackupDeleteId(null) }, translate('backup.cancel'))))
                  : backupRestoreId === item.id
                    ? React.createElement('div', { 'data-testid': 'backup-restore-preflight', style: { marginTop: '8px', padding: '10px', borderRadius: '8px', border: '1px solid var(--dsh-svc-border)', background: 'var(--dsh-svc-raised-bg)' } },
                        backupBusy && backupRestoreReport === null
                          ? React.createElement('p', { style: hint }, translate('backup.inspecting'))
                          : backupRestoreReport !== null
                            ? React.createElement('div', null,
                                React.createElement('div', { style: { fontWeight: 650, color: backupRestoreReport.validForRestore ? 'var(--dsh-svc-success)' : 'var(--dsh-svc-danger)' } }, translate(backupRestoreReport.validForRestore ? 'backup.integrity.ok' : 'backup.integrity.invalid')),
                                React.createElement('p', { style: Object.assign({}, hint, { margin: '4px 0 0' }) }, translate('backup.integrity.summary', {
                                  entries: backupRestoreReport.archive?.entryCount || 0,
                                  size: formatSize(backupRestoreReport.archive?.logicalBytes || 0),
                                  sessions: backupRestoreReport.sections?.sessions?.files || 0,
                                  config: backupRestoreReport.sections?.config?.files?.length || 0,
                                  profiles: backupRestoreReport.sections?.profiles?.count || 0,
                                })),
                                // 归档格式标签：v1（旧版所出、不含 Profile 补丁层）与 v2 在恢复语义上
                                // 不同——旧归档不覆盖现有 patch，界面必须讲清楚，避免误判「恢复了但没生效」。
                                React.createElement('p', { 'data-testid': 'backup-archive-format', style: Object.assign({}, hint, { margin: '2px 0 0' }) }, translate('backup.integrity.format', { format: translate(backupRestoreReport.archiveFormat === 'v2' ? 'backup.format.v2' : 'backup.format.v1') })),
                                // 备份时的 DSH 版本：恢复是不可逆动作，确认前必须知道这份快照出自哪个版本
                                // （跨版本降级恢复读不动新格式会话）。元数据缺席（旧插件所出归档）时退回
                                // 文件名里的版本段；两处都没有就不渲染这一行，而不是显示「未知版本」。
                                (backupRestoreReport.dshVersion ?? backupRestorePlan?.reportSummary?.dshVersion)
                                  ? React.createElement('p', { 'data-testid': 'backup-source-version', style: Object.assign({}, hint, { margin: '2px 0 0' }) }, translate('backup.integrity.sourceVersion', { version: backupRestoreReport.dshVersion ?? backupRestorePlan.reportSummary.dshVersion }))
                                  : null,
                                backupRestoreReport.validForRestore !== true
                                  ? React.createElement('ul', { style: Object.assign({}, hint, { margin: '6px 0 0', paddingLeft: '18px', color: 'var(--dsh-svc-danger)' }) }, (backupRestoreReport.issues || []).map((issue, index) => React.createElement('li', { key: index }, mapBackupRestoreError(issue.code))))
                                  : null)
                            : null,
                        backupRestorePlan !== null ? React.createElement('div', { style: { marginTop: '8px' } },
                          React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-warn-primary)', margin: '0 0 6px' }) }, translate('backup.restoreHint')),
                          React.createElement('ul', { style: Object.assign({}, hint, { margin: '0 0 8px', paddingLeft: '18px' }) },
                            React.createElement('li', null, translate('backup.plan.sessions')),
                            React.createElement('li', null, translate('backup.plan.config', { replace: backupRestorePlan.targets?.config?.replace?.length || 0, remove: backupRestorePlan.targets?.config?.remove?.length || 0 })),
                            React.createElement('li', null, translate('backup.plan.profiles', { count: backupRestorePlan.targets?.profiles?.upsert?.length || 0 })),
                            // 补丁层单独一行：为 0 时用「旧归档不覆盖现有配置」的说明替代，不能让
                            // 用户以为 patch 也被回滚了（实际是刻意保留）。
                            React.createElement('li', { 'data-testid': 'backup-plan-profile-patches' }, (backupRestorePlan.targets?.profiles?.patches?.length || 0) > 0
                              ? translate('backup.plan.profilePatches', { count: backupRestorePlan.targets.profiles.patches.length })
                              : translate('backup.plan.profilePatchesAbsent'))),
                          React.createElement('p', { style: Object.assign({}, hint, { margin: '0 0 8px' }) }, translate('backup.plan.expires', { time: new Date(backupRestorePlan.expiresAt).toLocaleTimeString() })),
                          React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                            React.createElement('button', { style: danger, disabled: backupBusy, onClick: commitBackupRestore }, translate('backup.restoreConfirm')),
                            React.createElement('button', { style: ghost, disabled: backupBusy, onClick: cancelBackupRestore }, translate('backup.cancel'))))
                          : React.createElement('button', { style: ghost, disabled: backupBusy, onClick: cancelBackupRestore }, translate('backup.cancel')))
                    : null)))
            : null))

        // 有更新时状态文本本身可点击：小三角 + 「有新版本：…」整体切换新版 release 内容的展开/收起。
        const chevronIcon = (open) => React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block', transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'none' } },
          React.createElement('path', { d: 'M9 6l6 6-6 6' }))
        // 「本次更新内容」入口：紧跟在当前版本号之后，有可解析版本就常驻——与是否有新版本无关，
        // 用户想看的往往正是当前这一版改了什么。只服务 `variant='current'`（读当前这一版）；
        // 「有新版本」那条路不在这里，它是状态文本本身可点（见 versionRow）。
        const notesEntry = (id) => {
          if (notesHostUnsupportedRef.current === true) return null
          const open = notesState.kind === id && notesState.variant === 'current' && notesState.phase !== 'idle'
          return React.createElement('button', {
            type: 'button',
            'data-testid': `version-${id}-notes-toggle`,
            'aria-expanded': String(open),
            title: translate(open ? 'update.notes.hide' : 'update.notes.button'),
            onClick: () => { toggleNotes(id, 'current') },
            style: Object.assign({}, ghost, { minHeight: '22px', padding: '1px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }),
          }, open ? null : chevronIcon(false), React.createElement('span', null, translate('update.notes.button')))
        }
        const versionRow = (id, label, fallbackVersion, state, action, latestNotes, topBorder) => {
          const statusText = !state
            ? (updateError || translate('update.checking'))
            : state.restartPending ? translate('update.installedPendingRestart', { version: state.current || fallbackVersion || '' })
              : state.status === 'unpublished' ? translate('update.unpublished')
                : state.status === 'unavailable' ? translate('update.unavailable')
                  : state.upToDate ? translate('update.current')
                    : translate('update.available', { version: state.latest })
          const statusColor = !state ? 'var(--dsw-alias-label-secondary)' : state.restartPending ? 'var(--dsw-alias-state-warn-primary)' : state.upToDate ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)'
          // 状态文本在「有新版本」时可点击（小三角 + 文案整体）：读的是**新版**的 release 信息，
          // 原「查看详情」弹层已由它取代——旧弹层放的当前/最新版本对比与 npmjs / npmmirror
          // 链接整条移除，读者要的是新版改了什么，不是再来一串版本号。
          const notesOpen = latestNotes !== undefined && notesState.kind === latestNotes && notesState.variant === 'latest' && notesState.phase !== 'idle'
          const clickable = latestNotes !== undefined && latestNotesHostUnsupportedRef.current !== true && state && state.status !== 'unpublished' && state.status !== 'unavailable' && !state.upToDate
          const rightSide = clickable
            ? React.createElement('button', { type: 'button', title: translate(notesOpen ? 'update.notes.hide' : 'update.notes.button'), style: { background: 'transparent', border: 0, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 600, color: statusColor }, onClick: () => { toggleNotes(latestNotes, 'latest') } },
                chevronIcon(notesOpen),
                React.createElement('span', null, statusText))
            : React.createElement('div', { style: { color: statusColor, fontWeight: 600 } }, statusText)
          // 行内只有三件 inline 级内容落列：label、版本号、入口按钮；status 占第四列靠右。
          // 行内样式的 flex 布局是 @supports 缺席时的回落面，共享列由上面的 CSS 覆盖。
          return React.createElement('div', { key: id, className: 'dshsvc-version-row', style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px 16px', padding: '10px 2px', borderTop: topBorder ? '1px solid var(--dsw-alias-border-l1)' : 0 } },
            React.createElement('div', { className: 'dshsvc-version-identity', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 } },
              React.createElement('span', { style: { fontSize: '13px', fontWeight: 650, whiteSpace: 'nowrap' } }, `${label} `),
              state?.url
                ? React.createElement('a', { 'data-testid': `version-${id}-link`, href: state.url, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-alias-label-primary)', textDecoration: 'underline', fontSize: '12px', whiteSpace: 'nowrap', marginLeft: '16px' } }, state.current || fallbackVersion || translate('version.loading'))
                : React.createElement('code', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', marginLeft: '16px', whiteSpace: 'nowrap' } }, state?.current || fallbackVersion || translate('version.loading')),
              // 入口紧跟在当前版本号之后：读作「这一版改了什么」的注脚。
              notesEntry(id)),
            React.createElement('div', { className: 'dshsvc-version-status', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', fontSize: '12px', minWidth: 0, overflowWrap: 'anywhere' } }, rightSide, action || null))
        }
        // 版本信息区块：两行都在有更新时由状态文本（小三角 + 有新版本）行内下拉展开新版 release 信息
        const dshUpdate = updateInfo?.dsh
        const pluginUpdate = updateInfo?.plugin && !updateInfo.plugin.upToDate && updateInfo.plugin.status === 'available'
        // 磁盘已装版本比运行进程新 = 升级已落地、只差重启（手动启动环境尤其常见）：这是宿主事实，
        // 不是本次点击的临时状态——重挂载、刷新页面后依然成立，升级按钮不再冒出来骗人
        // （用户点名，2026-09-12）。旧宿主无 installedVersion 时 compareSemver 得 null，退回现状。
        const runningPluginVersion = pluginVersion || updateInfo?.plugin?.current || null
        const installedAhead = compareSemver(installedVersion, runningPluginVersion) === 1
        const pluginRestartPending = upgradeManualPending || installedAhead
        const pluginState = pluginRestartPending && installedVersion !== null
          ? Object.assign({}, updateInfo?.plugin, { current: installedVersion, restartPending: true })
          : updateInfo?.plugin
        // 确认后果或已装好待重启期间收起升级按钮，避免重复触发或撞 no-newer-version 守卫。
        const pluginAction = pluginUpdate && !pluginRestartPending && !upgradeManualConfirm
          ? React.createElement('button', { style: Object.assign({}, neutral, { minHeight: '24px', padding: '2px 8px', fontSize: '11px' }), disabled: upgradeBusy, onClick: upgradePlugin }, translate(upgradeBusy ? 'update.upgrading' : 'update.upgrade'))
          : null
        // 手动重启指引：本次点击刚装好，或（事实层面）已装好待重启且当前是手动启动环境。
        // 托管环境由恢复轮询接管，不重复提示。
        const manualRestartHint = upgradeManualPending || (installedAhead && runtimeEnv !== null && runtimeEnv.manualStartLikely === true)
        // 「本次更新内容」正文：折叠面板挂在触发它的那一行下方（`notesState.kind` 决定归属），
        // 正文按不可信文本渲染——能复用官方 MarkdownText 就用（与官方聊天观感一致、
        // 默认拒原始 HTML/危险链接），官方 seed 缺席的老外壳回落 pre-wrap 纯文本。
        // 同一 kind 的两种版本面（当前 / 新版）共用一个显示槽：面板归属由 variant 区分，
        // 测试 id 用 variant 后缀，两处入口各自命中自己的面板与状态节点。
        const releaseNotesPanel = (kind) => {
          if (notesState.kind !== kind || notesState.phase === 'idle') return null
          const variant = notesState.variant === 'latest' ? 'latest' : 'current'
          const testId = (suffix) => `version-${kind}-notes-${variant}${suffix}`
          const meta = notesState.phase === 'ready' ? notesState.value : null
          const body = notesState.phase === 'loading'
            ? React.createElement('p', { 'data-testid': testId('-loading'), style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('update.notes.loading'))
            // 待定态（上游先发 npm、release 稍后补）：中性文字 + 「重试」按钮，不是错误。
            // 红色 + role="alert" 会把它讲成故障，而这里既不是故障、用户也无事可做。
            : notesState.phase === 'pending'
              ? React.createElement('div', { 'data-testid': testId('-pending'), style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' } },
                  React.createElement('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                    translate('update.notes.error.release-not-found')),
                  React.createElement('button', {
                    type: 'button',
                    'data-testid': testId('-retry'),
                    onClick: () => { loadNotes(kind, variant) },
                    style: Object.assign({}, ghost, { minHeight: '22px', padding: '1px 8px', fontSize: '11px' }),
                  }, translate('update.notes.retry')))
              : notesState.phase === 'error'
                ? React.createElement('p', { 'data-testid': testId('-error'), role: 'alert', style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' } },
                    translate('update.notes.error.' + (typeof notesState.error === 'string' && notesState.error !== '' ? notesState.error : 'release-unavailable')))
                : typeof meta?.notes === 'string' && meta.notes.trim() !== ''
                  ? React.createElement('div', { 'data-testid': testId('-body'), style: { fontSize: '12px', color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' } },
                      sessionMarkdownText !== null
                        ? React.createElement(sessionMarkdownText, { text: meta.notes, labels: sessionMarkdownLabels(translate) })
                        : React.createElement('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 } }, meta.notes))
                  : React.createElement('p', { 'data-testid': testId('-empty'), style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('update.notes.empty'))
          const metaLine = meta === null ? [] : [
            // 新版正文先把版本号摆出来：状态行只写「有新版本：x」，正文头部再明确这一份是哪一版。
            variant === 'latest' && typeof meta.version === 'string' && meta.version !== ''
              ? React.createElement('span', { key: 'version', style: { color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 } }, translate('update.notes.version', { version: meta.version }))
              : null,
            meta.publishedAt
              ? React.createElement('span', { key: 'published' }, translate('update.notes.publishedAt', { date: String(meta.publishedAt).slice(0, 10) }))
              : null,
            meta.prerelease === true ? React.createElement('span', { key: 'prerelease', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, translate('update.notes.prerelease')) : null,
            meta.truncated === true ? React.createElement('span', { key: 'truncated' }, translate('update.notes.truncated', { chars: Number(meta.notesLimit) > 0 ? meta.notesLimit : 20000 })) : null,
          ].filter((node) => node !== null)
          return React.createElement('div', { 'data-testid': `version-${kind}-notes`, 'data-dshsvc-notes-panel': '', ref: notesPanelRef, style: { marginTop: '6px', marginBottom: '4px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsh-svc-raised-bg)', display: 'flex', flexDirection: 'column', gap: '8px' } },
            body,
            metaLine.length > 0
              ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, ...metaLine)
              : null)
        }
        // 版本卡只放版本与升级：运行环境信息在健康诊断检查项与重启确认提示中呈现（用户复核口径）。
        const versionBlock = React.createElement('div', { key: 'version-card', 'data-testid': 'version-card', style: card },
          React.createElement('div', { key: 'title', style: sectionTitle }, translate('version.title')),
          React.createElement('div', { className: 'dshsvc-version-surface', style: displaySurface },
            versionRow('plugin', 'dsh-service', pluginVersion, pluginState, pluginAction, 'plugin', false),
            releaseNotesPanel('plugin'),
            versionRow('dsh', 'DSH', version, dshUpdate, null, 'dsh', true),
            releaseNotesPanel('dsh'),
            upgradeManualConfirm
              ? React.createElement('div', { 'data-testid': 'upgrade-manual-confirm', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '6px', background: 'rgba(211,51,51,0.08)', border: '1px solid rgba(211,51,51,0.3)' } },
                  React.createElement('p', { style: { margin: '0 0 6px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', fontWeight: 600 } }, translate('update.manualConfirmTitle')),
                  React.createElement('p', { style: Object.assign({}, hint, { margin: '0 0 8px' }) }, translate('update.manualConfirm')),
                  React.createElement('div', { style: row },
                    React.createElement('button', { style: dangerGhost, 'data-variant': 'dangerGhost', disabled: upgradeBusy, onClick: upgradePlugin }, translate(upgradeBusy ? 'update.upgrading' : 'update.manualProceed')),
                    React.createElement('button', { style: ghost, disabled: upgradeBusy, onClick: () => setUpgradeManualConfirm(false) }, translate('restart.cancel'))))
              : null,
            manualRestartHint
              ? React.createElement('div', { 'data-testid': 'upgrade-manual-pending', style: { marginTop: '10px', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsh-svc-raised-bg)' } },
                  React.createElement('p', { style: { margin: '0 0 4px', color: 'var(--dsw-alias-state-warn-primary)', fontSize: '13px', fontWeight: 650 } }, translate('update.manualRestartTitle')),
                  React.createElement('p', { style: Object.assign({}, hint, { margin: 0 }) }, translate('update.manualRestartBody')))
              : null,
            upgradeError ? React.createElement('p', { style: Object.assign({}, hint, { color: 'var(--dsw-alias-state-error-primary)', margin: '4px 0 0' }) }, upgradeError) : null))

        // 重启区块复用共享组件（「重启」标签还承载设置页左列入口的显示开关；左侧入口默认关闭）
        const restartBlock = React.createElement(RestartSection, { showNavToggle: true })

        const { enabled: notifyOn, done: notifyDoneOn, input: notifyInputOn, bell: notifyBellOn, setEnabled: setNotifyOn, setDone: setNotifyDoneOn, setInput: setNotifyInputOn, setBell: setNotifyBellOn } = useNotifyState()
        const notifSupported = typeof Notification !== 'undefined'
        const notifPermission = notifSupported ? Notification.permission : 'denied'
        const notifySwitch = (on, onChange, disabled) => React.createElement('button', {
          type: 'button',
          role: 'switch',
          'aria-checked': String(on === true),
          'aria-disabled': disabled ? 'true' : undefined,
          onClick: disabled ? undefined : () => onChange(!on),
          style: {
            width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative',
            border: `1px solid ${on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`,
            background: on ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)',
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, lineHeight: 0,
          },
        }, React.createElement('span', { style: { position: 'absolute', top: '1px', left: on ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: on ? '#fff' : 'var(--dsw-alias-label-tertiary)' } }))
        const notifyRow = (testId, label, labelHint, on, onChange, disabled) => React.createElement('div', { 'data-testid': testId, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '5px 0' } },
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
            React.createElement('span', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' } }, label),
            labelHint ? React.createElement('span', { style: hint }, labelHint) : null),
          notifySwitch(on, onChange, disabled))
        // 仅被「配置 → 通知」页消费；不带自身 marginTop——页内定位统一交给该页的 card 容器。
        const notificationBlock = !notifSupported ? null
          : React.createElement('div', null,
              React.createElement('div', { style: sectionTitle }, translate('notification.title')),
              React.createElement('div', { style: Object.assign({}, displaySurface, { marginTop: '4px' }) },
                React.createElement('p', { style: hint }, translate('notification.description')),
                notifPermission !== 'granted'
                  ? React.createElement('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' } },
                      React.createElement('button', { style: neutral, onClick: () => { Notification.requestPermission().then((p) => { if (p === 'granted') setNotifyOn(true) }) } }, translate('notification.enable')),
                      React.createElement('span', { style: hint }, notifPermission === 'denied' ? translate('notification.denied') : ''))
                  : React.createElement('div', { style: { marginTop: '8px', display: 'flex', flexDirection: 'column' } },
                      notifyRow('notify-row-master', translate('notification.master'), null, notifyOn, setNotifyOn, false),
                      notifyRow('notify-row-done', translate('notification.done'), null, notifyDoneOn, setNotifyDoneOn, !notifyOn),
                      notifyRow('notify-row-input', translate('notification.input'), null, notifyInputOn, setNotifyInputOn, !notifyOn),
                      // 铃铛显隐独立于通知总开关：藏掉只是收起输入框旁的快捷入口（v0.31 用户点名）。
                      notifyRow('notify-row-bell', translate('notification.bellShow'), null, notifyBellOn, setNotifyBellOn, false))))
        // ── 概览状态聚合与分段布局（v0.39 确认规格；v1.4.1 移除额度提醒）──
        // 状态摘要 → 可行动项（仅在存在时）→ 版本/运行时 → 指标格 → 近期错误。
        // 严重度 error > warning > info > normal：error=RPC/健康/诊断/备份/统计/额度/重启错误；
        // warning=权限异常/非 advisory 诊断警告；info=可更新/无备份。
        // 额度窗口占用不再聚合进概览状态（额度页内的高占用进度条展示保留）；
        // 运行环境（疑似终端手动启动）是常驻环境事实而非待办，不进概览状态项——
        // 只在健康诊断检查项与重启/升级两段式确认里呈现（用户点名，2026-09-12）。
        const updateOutdated = updateInfo !== null && updateInfo !== undefined &&
          ((updateInfo.dsh && updateInfo.dsh.upToDate === false) || (updateInfo.plugin && updateInfo.plugin.upToDate === false))
        const backupLoaded = backups !== null && !backupBusy && !backupError
        const failingChecks = (diagnostics?.checks || []).filter((check) => check.status === 'error' || (check.status === 'warning' && check.advisory !== true && check.id !== 'permissions'))
        const statusItems = []
        if (healthError) statusItems.push({ level: 'error', text: healthError })
        if (usageError) statusItems.push({ level: 'error', text: usageError })
        if (backupError) statusItems.push({ level: 'error', text: backupError })
        if (restartFlowState.error) statusItems.push({ level: 'error', text: String(restartFlowState.error) })
        if (permissionError) statusItems.push({ level: 'error', text: permissionError })
        for (const check of failingChecks) {
          statusItems.push({ level: check.status === 'error' ? 'error' : 'warning', text: translate(`health.check.${check.id}`) + '：' + diagnosticDetail(check) })
        }
        if (permissionAbnormal > 0) statusItems.push({ level: 'warning', text: translate('permissions.summary.warning', { count: permissionAbnormal }) })
        if (updateOutdated) statusItems.push({ level: 'info', text: translate('overview.updateAvailable') })
        if (backupLoaded && backups.items.length === 0) statusItems.push({ level: 'info', text: translate('overview.backupEmpty') })
        // 重置卡到期不再进概览提示（整条去掉，用户裁决）：卡到期由宿主自动移除，
        // 界面只在额度页展示现存卡，这里不再产出 info 项。
        const statusLevel = statusItems.some((item) => item.level === 'error') ? 'error'
          : statusItems.some((item) => item.level === 'warning') ? 'warning'
            : statusItems.some((item) => item.level === 'info') ? 'info' : 'normal'
        const statusText = statusLevel === 'normal'
          ? translate('overview.status.normal')
          : translate(`overview.status.${statusLevel}`, { count: statusItems.length })
        const overviewStatusBlock = React.createElement('div', { 'data-testid': 'overview-status', style: Object.assign({}, displaySurface, { display: 'flex', alignItems: 'center', gap: '10px' }) },
          React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '10px', height: '10px', ...fullRound('50%'), background: statusLevel === 'normal' ? 'var(--dsh-svc-success)' : statusLevel === 'warning' ? 'var(--dsh-svc-warning)' : statusLevel === 'error' ? 'var(--dsh-svc-danger)' : 'var(--dsh-svc-info)' } }),
          React.createElement('span', { style: { fontSize: '13px', fontWeight: 600, color: 'var(--dsh-svc-text)' } }, statusText))
        const overviewActionablesBlock = statusItems.length === 0
          ? null
          : React.createElement('div', { 'data-testid': 'overview-actionables', style: Object.assign({}, displaySurface, { marginTop: '10px', padding: '4px 10px' }) },
              statusItems.map((item, index) => React.createElement('div', { key: `${item.level}-${index}`, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 2px', fontSize: '12px', borderTop: index === 0 ? 0 : '1px solid var(--dsh-svc-border)' } },
                React.createElement('span', { 'aria-hidden': 'true', style: { flex: 'none', width: '7px', height: '7px', ...fullRound('50%'), background: item.level === 'error' ? 'var(--dsh-svc-danger)' : item.level === 'warning' ? 'var(--dsh-svc-warning)' : 'var(--dsh-svc-info)' } }),
                React.createElement('span', { style: { color: 'var(--dsh-svc-text)' } }, item.text))))
        // 概览核心操作按钮（健康检查/额度查询/创建备份）已移除（2026-09-16）：
        // 三个动作在各自功能页内都有常驻入口，概览里重复摆放没有增量价值。
        // 近期错误只在非空时渲染（模型/工具报错默认折叠）。
        const overviewBlock = React.createElement('div', null,
          overviewStatusBlock,
          overviewActionablesBlock,
          versionBlock,
          containerInfoBlock,
          modelErrors.length > 0 || toolErrors.length > 0 ? overviewErrorsBlock : null)
        const maintenanceBlock = React.createElement('div', { key: 'maintenance-card', 'data-testid': 'maintenance-card', style: card }, backupBlock)
        // advisory 警告（如手动启动环境的黄色提示）只做行内呈现，不点亮标签 ⚠ 与顶部服务控制提醒。
        const diagnosticFailure = diagnostics?.checks?.some((check) => check.status === 'error' || (check.status === 'warning' && check.advisory !== true)) === true
        // 批量进行中在「维护」标签右上角显示进度计数角标（done/total）。
        const { batch: skillsBadgeBatch } = useSkillsBatch()
        // v0.39 六页信息架构：顶层 overview→usage→quota→diagnostics→maintenance→configuration。
        // 通知不再是顶层页：归入 配置→通知（功能关闭时页面保留、置灰标注）。
        const tabWarnings = {
          overview: false,
          usage: Boolean(usageError),
          quota: false,
          diagnostics: Boolean(healthError || permissionError || diagnosticFailure || permissionAbnormal > 0),
          maintenance: Boolean(backupError || restartFlowState.error),
          configuration: false,
        }
        // 维护子页记忆：首次开面板默认「子代理」（用户点名），此后读写 localStorage；
        // 非法/被功能关闭的值按 sessions→skills→subagent→backup→restart 回退到首个可用页。
        // 配置页恒开在 features，无子页记忆（用户点名）。
        const [maintenanceTab, setMaintenanceTab] = useState('subagent')
        const [configTab, setConfigTab] = useState('features')
        useEffect(() => {
          let stored = null
          try { stored = localStorage.getItem('dsh-service-maintenance-tab') } catch (_) {}
          // 无记忆键 = 首次进入：保留「子代理」默认值（不可用时由渲染期 normalize 回退）；
          // 有键但非法/被关 = 回退白名单首项。
          setMaintenanceTab(stored === null ? 'subagent' : normalizeMaintenanceTab(stored, features))
        }, [])
        const selectMaintenanceTab = (id) => {
          setMaintenanceTab(id)
          try { localStorage.setItem('dsh-service-maintenance-tab', id) } catch (_) {}
        }
        const primaryTabs = getVisiblePrimaryTabs(features, tabWarnings)
        const maintenanceTabs = getVisibleMaintenanceTabs(features)
        const warningTabs = primaryTabs.filter((item) => item.warning).map((item) => translate(item.labelKey))
        const visiblePrimaryTab = primaryTabs.some((item) => item.id === activeTab) ? activeTab : 'overview'
        const visibleMaintenanceTab = normalizeMaintenanceTab(maintenanceTab, features)
        const tabContent = visiblePrimaryTab === 'overview'
          ? overviewBlock
          : visiblePrimaryTab === 'usage'
            ? usageBlock
            : visiblePrimaryTab === 'quota'
              ? React.createElement(RemoteQuotaCard, null)
            : visiblePrimaryTab === 'diagnostics'
              ? healthBlock
            : visiblePrimaryTab === 'maintenance'
              ? (visibleMaintenanceTab === null
                  ? React.createElement('div', { 'data-testid': 'maintenance-empty', style: displaySurface }, translate('maintenance.empty'))
                  : visibleMaintenanceTab === 'restart'
                    ? restartBlock
                    : visibleMaintenanceTab === 'backup'
                      ? maintenanceBlock
                      : visibleMaintenanceTab === 'skills'
                        ? React.createElement(SkillsSection, null)
                        : visibleMaintenanceTab === 'subagent'
                          ? React.createElement(SubagentSection, null)
                          : React.createElement(SessionsSection, null))
            : configTab === 'notifications'
              ? React.createElement('div', { 'data-testid': 'config-notifications-page', style: Object.assign({}, card, features.taskNotifications === false ? { opacity: 0.55 } : {}) },
                  notificationBlock,
                  ...(features.taskNotifications === false ? [React.createElement('p', { key: 'notify-off-hint', style: Object.assign({}, hint, { marginTop: '8px' }) }, translate('config.notificationsDisabled'))] : []))
              : configTab === 'navOrder'
                ? React.createElement(SettingsNavOrderSection, null)
                // FeatureGroups 的根不带卡式内边距（官方插件卡共用该组件），配置页在这里补上，
                // 使本页首块与其它页一样从 tab-panel 内容顶开始（原先靠 marginTop:10px 下沉 10px）。
                : React.createElement('div', { style: card }, React.createElement(FeatureGroups, null))
        // v0.39：根节点带 data-dshsvc-root 作用域锚（焦点环/降动效/reduced-motion 都挂在它下）、
        // data-dshsvc-page 记录当前内部页、dshsvc-page 类收 800px 内容宽。导航渲染收敛到
        // SvcTabs 基元（role=tablist/tab + aria-selected）；旧 group/tray/top-tab 结构已移除。
        return React.createElement('div', { 'data-testid': 'service-panel-root', 'data-dshsvc-root': '', 'data-dshsvc-page': visiblePrimaryTab, className: 'dshsvc-page' },
          warningTabs.length > 0 ? React.createElement('div', { role: 'alert', style: { marginBottom: '12px', padding: '11px 13px', borderRadius: '8px', background: 'rgba(198,128,0,0.16)', border: '1px solid rgba(198,128,0,0.48)' } },
            React.createElement('div', { style: { fontSize: '13px', fontWeight: 700 } }, translate('tabs.alert.title')),
            React.createElement('div', { style: Object.assign({}, hint, { marginTop: '3px' }) }, translate('tabs.alert.body', { tabs: warningTabs.join(translate('tabs.alert.join')) }))) : null,
          React.createElement(SvcTabs, {
            items: primaryTabs.map((item) => ({
              id: item.id,
              label: translate(item.labelKey),
              icon: item.id === 'diagnostics' ? 'health' : item.id,
              warning: item.warning,
              badge: item.id === 'maintenance' && skillsBadgeBatch !== null && skillsBadgeBatch.phase === 'running'
                ? { testid: 'skills-tab-badge', text: skillsBadgeBatch.done + '/' + skillsBadgeBatch.total }
                : null,
            })),
            activeId: visiblePrimaryTab,
            onChange: (id) => { setActiveTab(id); if (id === 'diagnostics') runDiagnostics(false) },
            testIdPrefix: 'service-tab',
            dotLabel: translate('tabs.alert.dot'),
            ariaLabel: translate('nav.label'),
          }),
          // v0.39 页面头部：标题随当前页切换（标签词条复用），描述见 PAGE_DESCRIPTIONS；
          // 诊断页的「重新诊断」按钮驻留头部右缘（用户复核点名），内容区不再独占一行。
          React.createElement(SvcPageHeader, {
            title: translate(PRIMARY_TAB_LABELS[visiblePrimaryTab]),
            description: PAGE_DESCRIPTIONS[visiblePrimaryTab] !== undefined ? translate(PAGE_DESCRIPTIONS[visiblePrimaryTab]) : null,
            action: visiblePrimaryTab === 'diagnostics'
              ? React.createElement('button', { type: 'button', 'data-testid': 'diagnostics-recheck', 'data-variant': 'neutral', style: neutral, onClick: () => runDiagnostics(true), disabled: diagnosticsBusy }, translate(diagnosticsBusy ? 'health.checking' : diagnostics ? 'health.recheck' : 'health.check'))
              : null,
          }),
          visiblePrimaryTab === 'maintenance' && maintenanceTabs.length > 0
            ? React.createElement(SvcTabs, {
                items: maintenanceTabs.map((item) => ({ id: item.id, label: translate(item.labelKey) })),
                activeId: visibleMaintenanceTab,
                onChange: selectMaintenanceTab,
                testIdPrefix: 'maintenance-tab',
                variant: 'sub',
                ariaLabel: translate('tabs.maintenance'),
              })
            : null,
          visiblePrimaryTab === 'configuration'
            ? React.createElement(SvcTabs, {
                items: CONFIG_TABS.map((item) => ({ id: item.id, label: translate(item.labelKey) })),
                activeId: configTab,
                onChange: setConfigTab,
                testIdPrefix: 'config-tab',
                variant: 'sub',
                ariaLabel: translate('tabs.configuration'),
              })
            : null,
          React.createElement('div', { 'data-testid': 'tab-panel', style: tabPanel }, tabContent))
      }

      const bellPaths = {
        on: ['M10.268 21a2 2 0 0 0 3.464 0', 'm15 8 2 2 4-4', 'M16.8607 4.4824A6 6 0 0 0 6 8C6 12.499 4.589 13.956 3.262 15.326', 'M3.262 15.326A1 1 0 0 0 4 17H20A1 1 0 0 0 20.74 15.327C20.209 14.779 19.665 14.218 19.203 13.454'],
        off: ['M10.268 21a2 2 0 0 0 3.464 0', 'M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742', 'm2 2 20 20', 'M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05'],
      }
      function BellIcon(on) {
        return React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block' } },
          (on ? bellPaths.on : bellPaths.off).map(function (d, i) { return React.createElement('path', { key: i, d: d }) }))
      }
      function InlineNotifyBell() {
        const { enabled, setEnabled } = useNotifyState()
        const translate = useTranslation()
        return React.createElement('button', {
          type: 'button',
          title: translate(enabled ? 'notification.bellOn' : 'notification.bellOff'),
          style: { background: 'transparent', border: 0, cursor: 'pointer', padding: '2px 4px', color: 'inherit', opacity: enabled ? 1 : 0.45, lineHeight: 0 },
          onClick: () => {
            if (typeof Notification === 'undefined') return
            if (Notification.permission !== 'granted') {
              Notification.requestPermission().then((p) => { if (p === 'granted') setEnabled(true) })
              return
            }
            setEnabled(!enabled)
          },
        }, BellIcon(enabled))
      }
      ctx.slots.inject('conversation.input.left', () => {
        let dispose = null
        const sync = () => {
          if (dispose !== null) { dispose(); dispose = null }
          // 铃铛显隐开关关闭时整条注销（v0.31 用户点名），通知行为不受影响。
          if (!featureEnabled('taskNotifications') || !notifyState.current.bellVisible) return
          dispose = ctx.slots.register(
            { name: 'conversation.input.left', id: 'dsh-service-notify', order: 90, label: () => t('notification.bellOn') },
            () => React.createElement(InlineNotifyBell, null),
          )
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        const unsubscribeBell = subscribeBellVisible(sync)
        return () => { unsubscribe(); unsubscribeBell(); if (dispose !== null) dispose() }
      })
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
        { name: 'settings.plugin.item', id: 'dsh-service', key: 'dsh-service', order: 40 },
        () => React.createElement(FeatureSettingsCard, null),
      ))
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
        { name: 'plugins.bundle.config', key: '@gehennawu/dsh-service' },
        (props) => props?.view === 'page' ? React.createElement(FeatureSettingsCard, null) : null,
      ))
      ctx.slots.inject('settings.section', () => {
        const disposePanel = ctx.slots.register(
          { name: 'settings.section', id: 'dsh-service', order: 99, label: () => t('nav.label') },
          () => React.createElement(ServicePanel, null),
        )
        // 左列「重启」「额度查询」「会话管理」入口由各自页内的开关控制，默认不注册
        restartNavToggle.sync()
        quotaNavToggle.sync()
        sessionsNavToggle.sync()
        const unsubscribeFeatures = featureScope.subscribe(quotaNavToggle.sync)
        const unsubscribeFeaturesSessions = featureScope.subscribe(sessionsNavToggle.sync)
        return () => {
          unsubscribeFeatures()
          unsubscribeFeaturesSessions()
          disposePanel()
          restartNavToggle.disposeEntry()
          quotaNavToggle.disposeEntry()
          sessionsNavToggle.disposeEntry()
        }
      })
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-service-restart', order: 100, label: () => t('overlay.label') },
        () => React.createElement(RestartOverlay, null),
      ))

      // 额度查询圆环：跟随当前会话所选模型的供应商。modelDirectories 是可选服务
      // （老版本 DSH 没有）。槽位条目无条件注册，服务在条目渲染时（inject(sessionId)）
      // 经 ctx.get 惰性解析——此时会话已渲染、model-selection 必然已挂载，不受注入时序影响。
      // 真实渲染器按 (entry,binding) 缓存注入产物（v1.1.2 教训）：目录未热身时 inject
      // 只带 sessionId，QuotaRing 组件内按 ctx.timer 退避重试自愈，不能指望重渲染重算 inject；
      // 老版本 DSH 无该服务时 props 同样只带 sessionId，重试永远落空即静默，其他功能零影响。
      ctx.slots.inject('conversation.input.right', () => {
        let dispose = null
        const sync = () => {
          if (dispose !== null) { dispose(); dispose = null }
          if (!featureEnabled('quotaLookup')) return
          dispose = ctx.slots.register({
            name: 'conversation.input.right',
            id: 'dsh-service-quota-ring',
            order: 95,
            label: () => t('quota.ring.label'),
            inject: (sessionId) => {
              if (sessionId === undefined || sessionId === null) return {}
              try {
                const models = getModelDirectories()
                if (models === undefined || typeof models.directoryFor !== 'function') return { sessionId }
                const directory = models.directoryFor(sessionId)
                return {
                  sessionId,
                  directoryStore: directory.store,
                  loadDirectory: () => {
                    try {
                      const pending = directory.load()
                      if (pending && typeof pending.catch === 'function') pending.catch(() => {})
                    } catch (_) {}
                  },
                }
              } catch (_) {
                // 渲染器按 (entry,binding) 缓存注入产物：这里绝不能返回空对象——
                // 带上 sessionId 让 QuotaRing 组件内退避重试自愈（刷新/首进旧会话时
                // 会话作用域可能尚未热身，directoryFor 会暂时抛错）。
                return { sessionId }
              }
            },
          }, (props) => React.createElement(QuotaRing, props))
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        return () => { unsubscribe(); if (dispose !== null) dispose() }
      })

      // 会话级累计行（输入卡下方、官方统计行的下一行）：挂官方 conversation.composer.dock
      // 槽位（与统计胶囊/上下文圆环同一 dock 行），但通过 svcStyle 的行级规则让该行启用
      // 换行、累计行 flex-basis:100% 独占下一行——不再与官方条目同行挤占。
      // 对话页唯一显示面；不依赖回合数据，任何视图可见。order 后置（60）排在同槽官方条目之后。
      ctx.slots.inject('conversation.composer.dock', () => {
        let dispose = null
        const sync = () => {
          if (dispose !== null) { dispose(); dispose = null }
          // 双门控：v1.2 独立开关（子代理页可关）+ 路由功能总门。
          if (!featureEnabled('subagentRoute') || !featureEnabled('subagentModelsDock')) return
          dispose = ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'dsh-service-subagent-models-dock',
            order: 60,
            label: () => t('subagent.dock.label'),
            inject: (sessionId) => ({ sessionId }),
          }, (props) => React.createElement(SubagentModelsDock, props))
        }
        sync()
        const unsubscribe = featureScope.subscribe(sync)
        return () => { unsubscribe(); if (dispose !== null) dispose() }
      })

      // ─── 官方右栏文件编辑（v1.6 用户点名）───────────────────────────────
      // 官方右栏的文档预览（@deepseek-ai/dsh-client-ui-sidebar-documentpreview）把「渲染器」
      // 做成公开注册面：ctx.documentPreviews.register 声明元数据（extensions/priority/
      // loading/wrap），同 id 的 keyed body 挂在 session 作用域槽 sidebar.right.tab.document。
      // 这里注册「编辑」档位——priority 'builtin' 表示**故意不夺默认位**：官方渲染器仍是各
      // 后缀的默认，编辑器只在下拉里可选，打开文件的行为零变化。正文读写走自有 RPC
      // （官方 content 是分页累积前缀，不足以编辑），地址逐字回传 tab.contentId，会话与
      // 工作区根由宿主侧解析（前端不送路径、不送 root）。
      // 与宿主 FILE_EDITOR_MAX_BYTES 同步（= 2 MiB）：只用于文案，不参与判定。
      const FILE_EDITOR_LIMIT_LABEL = '2 MiB'
      const FILE_EDITOR_EXTENSIONS = FILE_EDITOR_EXTENSION_TABLE
      /** 错误码 → 词典文案；词典缺键（bind 原样返回 key）时退回通用文案，绝不把 key 漏到界面上。 */
      const fileEditorErrorText = (translate, code) => {
        const key = 'editor.error.' + (typeof code === 'string' && code !== '' ? code : 'internal')
        const text = translate(key, { limit: FILE_EDITOR_LIMIT_LABEL })
        return text === key ? translate('editor.error.internal') : text
      }

      // ─── 预览头部的「编辑」按钮（v1.6.1 用户点名：右上角一个显式入口）──────
      // 官方预览没有工具栏扩展座（头部只有渲染器下拉、wrap 开关与重载），所以按钮由本插件
      // 注入头部控件簇：插在渲染器下拉左边（即右上角），点击 = 在下拉里选中本插件的「编辑」
      // 档位；已处于编辑档位时按钮收起，由编辑正文自己的「预览」负责返回。
      // DOM 触点只用稳定钩子：`[data-document-viewer-menu]`（官方下拉钮）与官方 Menu 渲染的
      // `[role="menuitem"|"option"]`（按文案匹配，文案是本插件自己的档位名）。
      // 已注入的按钮（多分栏 / 浮动面板各有一份头部，逐个记账以便整体回收）。
      const editorEntries = []
      const dropEditorEntry = (index) => {
        const entry = editorEntries[index]
        try { entry.button.remove() } catch (_) {}
        editorEntries.splice(index, 1)
      }
      const disposeEditorEntries = () => { while (editorEntries.length > 0) dropEditorEntry(editorEntries.length - 1) }
      /**
       * 对齐当前 DOM：需要按钮的预览头补齐，不再需要的（功能关闭 / 档位已是「编辑」/ 标签已切走）收起。
       */
      const syncEditorEntries = () => {
        const doc = docOrNull()
        if (doc === null) return
        const label = t('editor.viewer')
        const enabled = featureEnabled('fileEditor')
        const menus = enabled ? queryAll(doc, VIEWER_MENU_SELECTOR) : []
        for (let index = editorEntries.length - 1; index >= 0; index -= 1) {
          const entry = editorEntries[index]
          if (!menus.includes(entry.menu) || textOfNode(entry.menu) === label) dropEditorEntry(index)
        }
        if (!enabled) return
        // 语言切换后同步在位的按钮文案。**只在真的变了时才写**：`textContent = 同值` 同样会
        // 重建文本节点 → 观察者再回调 → 再写，构成无限微任务环，实测把整个右栏饿死（点击全部
        // 挂起、页面无响应）；`setAttribute` 同值不产生 mutation 记录，顺手也判一下。
        for (const entry of editorEntries) {
          if (entry.button.textContent === label) continue
          entry.button.textContent = label
          try {
            entry.button.setAttribute('aria-label', label)
            entry.button.setAttribute('title', label)
          } catch (_) {}
        }
        for (const menu of menus) {
          if (textOfNode(menu) === label) continue
          if (editorEntries.some((entry) => entry.menu === menu)) continue
          const parent = menu.parentNode
          if (parent === null || parent === undefined || typeof doc.createElement !== 'function' || typeof parent.insertBefore !== 'function') continue
          const button = doc.createElement('button')
          button.type = 'button'
          button.setAttribute(EDITOR_ENTRY_ATTR, '')
          button.setAttribute('aria-label', label)
          button.setAttribute('title', label)
          button.textContent = label
          Object.assign(button.style, {
            minHeight: '22px',
            marginRight: '4px',
            padding: '1px 8px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 'var(--dsh-svc-radius-control, 6px)',
            background: 'transparent',
            color: 'var(--dsw-alias-label-secondary)',
            font: 'inherit',
            fontSize: '12px',
            lineHeight: '18px',
            cursor: 'pointer',
            flex: 'none',
          })
          button.addEventListener('click', (event) => {
            try { event?.preventDefault?.() } catch (_) {}
            try { event?.stopPropagation?.() } catch (_) {}
            // 只操作自己 pane 的下拉：双分栏下绝不允许全局取第一个（会切错别的文件）。
            // 守卫随入口引擎销毁——功能关闭/插件卸载后，未决的延迟重试全部作废。
            selectViewerItem(doc, (text) => text === label, { menu: findViewerMenuForNode(button), isAlive: () => editorEntriesGuard.isAlive() })
          })
          parent.insertBefore(button, menu)
          editorEntries.push({ menu, button })
        }
      }
      /** 起观察：DOM 变化（换标签、切档位、开关功能）后按微任务合并重扫一次。 */
      const startEditorEntries = () => {
        editorEntriesGuard = createViewerSelectionGuard()
        syncEditorEntries()
        // 语言切换不换 DOM 结构，观察者不会响：显式订阅 locale 刷新按钮文案。
        let disposeLocale = () => {}
        try {
          if (typeof ctx.locale?.subscribe === 'function') {
            const unsubscribe = ctx.locale.subscribe(() => { try { syncEditorEntries() } catch (_) {} })
            if (typeof unsubscribe === 'function') disposeLocale = unsubscribe
          }
        } catch (_) {}
        const doc = docOrNull()
        if (doc === null || typeof MutationObserver !== 'function') {
          return () => { disposeLocale(); disposeEditorEntries() }
        }
        let scheduled = false
        const schedule = () => {
          if (scheduled) return
          scheduled = true
          Promise.resolve().then(() => {
            scheduled = false
            try { syncEditorEntries() } catch (_) {}
          })
        }
        let observer = null
        try {
          observer = new MutationObserver(schedule)
          observer.observe(doc.documentElement ?? doc.body ?? doc, { childList: true, subtree: true, characterData: true })
        } catch (_) { observer = null }
        return () => {
          try { observer?.disconnect() } catch (_) {}
          disposeLocale()
          disposeEditorEntries()
          // 作废未决的选档位重试：功能关闭 / 卸载后，延迟定时器不得再点任何菜单。
          editorEntriesGuard.dispose()
          cancelPendingViewerSelections()
        }
      }

      /**
       * 标签 ⋯ 菜单里的「编辑」入口（v1.6.2，官方 `sidebar.right.tab.menu.item` 座，零 DOM 注入）。
       *
       * 与头部按钮互为冗余：头部按钮靠注入 DOM 实现，万一将来某个壳版本上注入失效，这条官方路径
       * 仍然可用。只在该标签确实是「官方文档预览能打开、且本插件有对应档位」的文件、并且当前不在
       * 编辑档位时露出；动作后按契约调用 `dismiss()` 关闭菜单。
       */
      function FileEditorMenuItem(props) {
        const translate = useTranslation()
        const address = typeof props?.tab?.contentId === 'string' ? props.tab.contentId : ''
        if (!address.startsWith('dsh-resource://file/') || !editorExtensionMatches(address)) return null
        const doc = docOrNull()
        const viewers = doc === null ? [] : queryAll(doc, VIEWER_MENU_SELECTOR)
        // 任一 pane 已在编辑档位就不露出（单 pane 与旧行为一致；多 pane 从保守）。
        if (viewers.some((viewer) => textOfNode(viewer) === translate('editor.viewer'))) return null
        return React.createElement('button', {
          type: 'button',
          role: 'menuitem',
          'data-testid': 'file-editor-menu-item',
          [EDITOR_MENU_ITEM_ATTR]: '',
          onClick: () => {
            try { props?.dismiss?.() } catch (_) {}
            // 多 pane 时菜单项无法可靠映射到所属 pane 的下拉（portal 菜单拿不到 tab 的 pane 根），
            // 唯一锚点才执行，歧义时宁可不动作——这是头部按钮之外的冗余路径，不需要激进兜底。
            const clickDoc = docOrNull()
            const anchors = clickDoc === null ? [] : queryAll(clickDoc, VIEWER_MENU_SELECTOR)
            if (anchors.length !== 1) return
            selectViewerItem(clickDoc, (text) => text === translate('editor.viewer'), { menu: anchors[0], isAlive: () => editorEntriesGuard.isAlive() })
          },
          style: {
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 10px',
            border: 0,
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            font: 'inherit',
            fontSize: '12px',
            lineHeight: '18px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          },
        }, translate('editor.viewer'))
      }

      /**
       * 「编辑」档位的正文：等宽 textarea + 保存/重载/撤销 + 冲突横幅与内联确认。
       *
       * 交互基线（v1.6 审查后）：保存期间允许继续输入，响应只确认提交内容；冲突覆盖取
       * 编辑器当前草稿；离开/重读/撤销遇未保存内容先内联确认。首版刻意不做语法高亮、
       * 多光标与查找替换——插件半没有打包器，借不到编辑器组件。
       */
      function FileEditorBody(props) {
        const translate = useTranslation()
        const address = typeof props?.resourceAddress === 'string' ? props.resourceAddress : ''
        const wrap = props?.wrap !== false
        const officialContent = props?.content
        const [doc, setDoc] = React.useState({ phase: 'loading', text: '', version: '', path: '', bytes: 0, error: '' })
        const [draft, setDraft] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState('')
        const [conflict, setConflict] = React.useState(null)
        const [undo, setUndo] = React.useState(null)
        const [confirm, setConfirm] = React.useState(null)
        // 请求代次：切文件 / 重新加载 / 保存都会作废在途响应，避免过期结果覆盖新状态。
        const requestRef = React.useRef(0)
        const contentRef = React.useRef(officialContent)
        // 延迟 RPC 回调必须对齐「最新本地状态」而不是发起请求时的快照：保存期间允许继续
        // 输入，响应只能确认提交的内容，绝不能清掉更晚的草稿。以下 ref 经包装 setter 同步。
        const docRef = React.useRef(doc)
        const draftRef = React.useRef(null)
        const busyRef = React.useRef(false)
        const undoRef = React.useRef(null)
        const rootRef = React.useRef(null)
        const textareaRef = React.useRef(null)
        const setDocValue = (value) => { docRef.current = value; setDoc(value) }
        const setDraftValue = (value) => { draftRef.current = value; setDraft(value) }
        const setBusyValue = (value) => { busyRef.current = value; setBusy(value) }
        const setUndoValue = (value) => { undoRef.current = value; setUndo(value) }
        const beginRequest = () => { requestRef.current += 1; return requestRef.current }
        const isCurrent = (id) => requestRef.current === id

        const load = () => {
          // 写盘在途时禁止重读：重读会作废在途保存回调，磁盘结果与界面从此对不上。
          if (busyRef.current === true) return
          const id = beginRequest()
          setDocValue({ phase: 'loading', text: '', version: '', path: '', bytes: 0, error: '' })
          setDraftValue(null)
          setConflict(null)
          setUndoValue(null)
          setNotice('')
          setBusyValue(false)
          rpcCall('file-read', { address }).then((result) => {
            if (!isCurrent(id)) return
            if (!result || result.ok !== true) {
              setDocValue({ phase: 'error', text: '', version: '', path: '', bytes: 0, error: typeof result?.error === 'string' ? result.error : 'internal' })
              return
            }
            const value = result.value || {}
            setDocValue({
              phase: 'ready',
              text: typeof value.text === 'string' ? value.text : '',
              version: typeof value.version === 'string' ? value.version : '',
              path: typeof value.path === 'string' ? value.path : '',
              bytes: Number.isFinite(value.bytes) ? value.bytes : 0,
              error: '',
            })
          }).catch(() => {
            if (!isCurrent(id)) return
            setDocValue({ phase: 'error', text: '', version: '', path: '', bytes: 0, error: 'internal' })
          })
        }

        /**
         * 写盘。kind：'save' 用户保存 / 冲突覆盖；'undo' 撤销本次保存（不产生新的撤销项）。
         *
         * 响应只确认 submittedText 这份提交内容：发起请求之后用户继续输入的草稿（draftRef）
         * 与提交内容不同时原样保留为「未保存」，绝不覆盖、不误报已保存。
         */
        const write = (submittedText, version, options = {}) => {
          const kind = options?.kind === 'undo' ? 'undo' : 'save'
          if (busyRef.current === true) return
          if (typeof submittedText !== 'string') return
          const id = beginRequest()
          setBusyValue(true)
          setNotice('')
          rpcCall('file-write', { address, text: submittedText, version, force: options?.force === true }).then((result) => {
            if (!isCurrent(id)) return
            setBusyValue(false)
            if (!result || result.ok !== true) {
              const errorCode = typeof result?.error === 'string' ? result.error : 'internal'
              // 版本冲突不是错误而是待用户裁决的状态：进横幅，不写顶部错误行。
              // 撤销保存遇到冲突绝不提供无条件覆盖——那会把更老的回滚内容压过磁盘新改动。
              if (errorCode === 'file-stale') {
                setConflict({ kind })
                return
              }
              setNotice(errorCode)
              return
            }
            const value = result.value || {}
            const newVersion = typeof value.version === 'string' && value.version !== '' ? value.version : (typeof version === 'string' ? version : '')
            const previous = docRef.current
            setDocValue({
              phase: 'ready',
              text: submittedText,
              version: newVersion,
              path: typeof value.path === 'string' && value.path !== '' ? value.path : previous.path,
              bytes: Number.isFinite(value.bytes) ? value.bytes : previous.bytes,
              error: '',
            })
            // 先记录后变更：宿主回传 before 即回滚状态；撤销本身不再挂新的撤销项（不做「撤销的撤销」）。
            if (kind === 'undo') {
              setUndoValue(null)
            } else {
              setUndoValue(typeof value.before === 'string' ? { text: value.before, version: newVersion } : null)
            }
            // 保存期间继续输入：草稿保留为未保存，只有内容与提交一致时才清空并报已保存。
            const latestDraft = draftRef.current
            if (latestDraft !== null && latestDraft !== submittedText) {
              setConflict(null)
              return
            }
            setDraftValue(null)
            setConflict(null)
            setNotice('saved')
            // 「保存并返回」：本次提交就是用户最终内容时才真正返回；期间又输入了则留在编辑器。
            if (options?.leaveAfter === 'preview') selectPreview()
          }).catch(() => {
            if (!isCurrent(id)) return
            setBusyValue(false)
            setNotice('internal')
          })
        }

        // 挂载 / 换文件：首次读取。地址变化必须重读，否则会拿旧文件的版本去写新文件。
        React.useEffect(() => {
          contentRef.current = officialContent
          load()
          return () => { requestRef.current += 1 }
        }, [address])

        // 官方工具栏的「重新加载」会换掉 content 引用：草稿与磁盘基线一致（或没有草稿）时
        // 静默跟随重读；有实际差异时不打扰用户（此时版本已过期，保存会走 file-stale 冲突
        // 横幅，由用户裁决）。写盘在途时同样不跟随，避免作废在途保存。
        React.useEffect(() => {
          if (contentRef.current === officialContent) return
          contentRef.current = officialContent
          if (busyRef.current === true) return
          const latestDraft = draftRef.current
          if (latestDraft !== null && latestDraft !== docRef.current.text) return
          load()
        }, [officialContent])

        const dirty = draft !== null && draft !== doc.text
        const code = doc.phase === 'error' ? doc.error : ''
        // 状态优先级：保存中 > 有未保存内容 > 刚保存完成。保存期间的新输入永远压过「已保存」。
        const statusText = busy === true ? translate('editor.saving') : dirty === true ? translate('editor.unsaved') : notice === 'saved' ? translate('editor.saved') : ''
        const statusColor = busy === true ? 'var(--dsw-alias-label-secondary)' : dirty === true ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-state-success-primary)'
        const buttonStyle = (variant) => ({
          minHeight: '26px',
          padding: '2px 9px',
          fontSize: '12px',
          borderRadius: 'var(--dsh-svc-radius-control, 6px)',
          border: '1px solid ' + (variant === 'primary' ? 'var(--dsh-svc-brand)' : 'var(--dsw-alias-border-l2)'),
          background: variant === 'primary' ? 'var(--dsh-svc-brand)' : 'transparent',
          color: variant === 'primary' ? 'var(--dsh-svc-brand-text)' : 'var(--dsw-alias-label-primary)',
          cursor: 'pointer',
        })
        const action = (testid, labelKey, onClick, variant, disabled) => React.createElement('button', {
          type: 'button',
          'data-testid': testid,
          disabled: disabled === true,
          onClick,
          style: Object.assign(buttonStyle(variant), disabled === true ? { opacity: 0.5, cursor: 'default' } : {}),
        }, translate(labelKey))

        // ── 离开保护与档位切换：全部经所属 pane 的下拉，定位失败宁可不动作 ─────────
        const selectPreview = () => {
          const menu = findViewerMenuForNode(rootRef.current)
          if (menu === null || menu === undefined) return false
          return selectViewerItem(docOrNull(), (text) => text !== translate('editor.viewer'), { menu, isAlive: () => editorEntriesGuard.isAlive() })
        }
        const cancelConfirm = () => {
          setConfirm(null)
          try { textareaRef.current?.focus?.() } catch (_) {}
        }
        const requestPreview = () => {
          if (busyRef.current === true) return
          if (dirty === true) { setConfirm('preview'); return }
          selectPreview()
        }
        const requestReload = () => {
          if (busyRef.current === true) return
          if (dirty === true) { setConfirm('reload'); return }
          load()
        }
        const requestUndo = () => {
          if (busyRef.current === true || undo === null) return
          setConfirm('undo')
        }
        const confirmUndo = () => {
          const target = undoRef.current
          setConfirm(null)
          if (target === null || target === undefined) return
          // 撤销会把磁盘恢复为保存前内容，确认面板已说明未保存修改会丢弃。
          setDraftValue(null)
          write(target.text, target.version, { kind: 'undo' })
        }

        const header = React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: '12px' },
        },
        React.createElement('span', {
          'data-testid': 'file-editor-path',
          title: doc.path !== '' ? doc.path : address,
          style: { flex: '1 1 90px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--ds-font-family-code, monospace)', color: 'var(--dsw-alias-label-secondary)' },
        }, doc.path !== '' ? doc.path : address),
        statusText !== '' ? React.createElement('span', {
          'data-testid': 'file-editor-status',
          role: 'status',
          'aria-live': 'polite',
          style: { flex: 'none', fontWeight: 600, color: statusColor },
        }, statusText) : null,
        React.createElement('span', { style: { display: 'flex', gap: '6px', marginLeft: 'auto', flex: 'none' } },
          // 返回官方默认渲染器（本 pane 下拉里第一个非本插件的档位）：编辑模式不是单向门。
          action('file-editor-preview', 'editor.preview', () => requestPreview(), 'ghost', busy),
          // 「撤销保存」常驻（只要还有回滚状态）：先确认再写，撤销不做二次撤销。
          undo !== null ? action('file-editor-undo', 'editor.undo', () => requestUndo(), 'ghost', busy) : null,
          action('file-editor-reload', 'editor.reload', () => requestReload(), 'ghost', busy),
          action('file-editor-save', 'editor.save', () => write(draftRef.current ?? doc.text, doc.version, { kind: 'save' }), 'primary', busy || !dirty)))

        // 保存版本冲突：重新加载（丢弃）或用编辑器**当前**内容覆盖——横幅出现后用户继续
        // 修改的内容也算数，覆盖永远取最新草稿而不是被拒绝时的快照。
        const saveConflictBanner = conflict !== null && conflict.kind === 'save' ? React.createElement('div', {
          'data-testid': 'file-editor-conflict',
          style: { margin: '8px 10px 0', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsh-svc-raised-bg, transparent)', fontSize: '12px', lineHeight: 1.6 },
        },
        React.createElement('div', { style: { fontWeight: 700, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('editor.conflict.title')),
        React.createElement('p', { style: { margin: '4px 0 8px', color: 'var(--dsw-alias-label-secondary)' } }, translate('editor.conflict.body')),
        React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          action('file-editor-conflict-reload', 'editor.conflict.reload', () => load(), 'ghost', busy),
          action('file-editor-conflict-overwrite', 'editor.conflict.overwrite', () => write(draftRef.current ?? doc.text, doc.version, { kind: 'save', force: true }), 'primary', busy))) : null

        // 撤销保存遇到冲突：磁盘在保存后又变了，回滚内容不能无条件压上去——只给重载/关闭。
        const undoConflictBanner = conflict !== null && conflict.kind === 'undo' ? React.createElement('div', {
          'data-testid': 'file-editor-undo-conflict',
          style: { margin: '8px 10px 0', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'var(--dsh-svc-raised-bg, transparent)', fontSize: '12px', lineHeight: 1.6 },
        },
        React.createElement('div', { style: { fontWeight: 700, color: 'var(--dsw-alias-state-warn-primary)' } }, translate('editor.undoConflict.title')),
        React.createElement('p', { style: { margin: '4px 0 8px', color: 'var(--dsw-alias-label-secondary)' } }, translate('editor.undoConflict.body')),
        React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          action('file-editor-undo-conflict-reload', 'editor.conflict.reload', () => load(), 'ghost', busy),
          action('file-editor-undo-conflict-dismiss', 'editor.undoConflict.dismiss', () => setConflict(null), 'ghost', false))) : null

        // 未保存离开 / 撤销的内联确认面板：取消回到编辑（焦点回 textarea），主操作按意图执行。
        const confirmTitles = { preview: 'editor.confirm.previewTitle', reload: 'editor.confirm.reloadTitle', undo: 'editor.confirm.undoTitle' }
        const confirmBodies = { preview: 'editor.confirm.previewBody', reload: 'editor.confirm.reloadBody', undo: 'editor.confirm.undoBody' }
        const confirmPanel = confirm === null ? null : React.createElement('div', {
          'data-testid': 'file-editor-confirm',
          role: 'alertdialog',
          'aria-label': translate(confirmTitles[confirm] ?? 'editor.confirm.previewTitle'),
          style: { margin: '8px 10px 0', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsh-svc-raised-bg, transparent)', fontSize: '12px', lineHeight: 1.6 },
        },
        React.createElement('div', { style: { fontWeight: 700 } }, translate(confirmTitles[confirm] ?? 'editor.confirm.previewTitle')),
        React.createElement('p', { style: { margin: '4px 0 8px', color: 'var(--dsw-alias-label-secondary)' } }, translate(confirmBodies[confirm] ?? 'editor.confirm.previewBody')),
        React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          confirm === 'preview' ? action('file-editor-confirm-save', 'editor.confirm.saveBack', () => { setConfirm(null); write(draftRef.current ?? doc.text, doc.version, { kind: 'save', leaveAfter: 'preview' }) }, 'primary', busy) : null,
          confirm === 'undo' ? action('file-editor-confirm-save', 'editor.undo', () => confirmUndo(), 'primary', busy) : null,
          confirm === 'reload' ? action('file-editor-confirm-discard', 'editor.confirm.reloadGo', () => { setConfirm(null); load() }, 'primary', busy) : null,
          confirm === 'preview' ? action('file-editor-confirm-discard', 'editor.confirm.discardBack', () => { setConfirm(null); selectPreview() }, 'ghost', false) : null,
          action('file-editor-confirm-cancel', 'editor.confirm.cancel', () => cancelConfirm(), 'ghost', false)))

        const noticeLine = notice === '' || notice === 'saved' ? null : React.createElement('p', {
          'data-testid': 'file-editor-notice',
          style: { margin: '8px 10px 0', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' },
        }, fileEditorErrorText(translate, notice))

        const body = doc.phase === 'loading'
          ? React.createElement('p', { 'data-testid': 'file-editor-loading', style: { margin: '12px 10px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' } }, translate('editor.loading'))
          : doc.phase === 'error'
            ? React.createElement('div', { 'data-testid': 'file-editor-error', style: { margin: '12px 10px', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' } },
              React.createElement('p', { style: { margin: '0 0 8px' } }, fileEditorErrorText(translate, code)),
              action('file-editor-retry', 'editor.retry', () => load(), 'ghost', false))
            : React.createElement('textarea', {
              'data-testid': 'file-editor-textarea',
              ref: textareaRef,
              'aria-label': translate('editor.viewer'),
              value: draft !== null ? draft : doc.text,
              spellCheck: false,
              onChange: (event) => setDraftValue(typeof event?.target?.value === 'string' ? event.target.value : ''),
              onKeyDown: (event) => {
                if ((event?.ctrlKey === true || event?.metaKey === true) && (event?.key === 's' || event?.key === 'S')) {
                  event.preventDefault()
                  if (busyRef.current !== true && dirty) write(draftRef.current ?? doc.text, doc.version, { kind: 'save' })
                }
              },
              style: {
                flex: '1 1 auto',
                minHeight: '160px',
                margin: 0,
                padding: '8px 10px',
                border: 0,
                outline: 'none',
                resize: 'none',
                background: 'transparent',
                color: 'var(--dsw-alias-label-primary)',
                fontFamily: 'var(--ds-font-family-code, monospace)',
                fontSize: '12px',
                lineHeight: 1.6,
                tabSize: 2,
                whiteSpace: wrap ? 'pre-wrap' : 'pre',
                overflow: 'auto',
                overflowWrap: wrap ? 'anywhere' : 'normal',
              },
            })

        return React.createElement('div', {
          'data-dshsvc-editor': '',
          ref: rootRef,
          style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'var(--dsw-alias-label-primary)' },
        },
        header,
        confirmPanel,
        saveConflictBanner,
        undoConflictBanner,
        noticeLine,
        body,
        React.createElement('div', {
          style: { flex: 'none', padding: '4px 10px 6px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
        }, translate('editor.keyHint')))
      }

      // 注册 = 元数据（下拉里的档位）+ keyed body（正文）。两段都属于本 effect，
      // 开关关闭或插件卸载时一起消失；documentPreviews 服务缺失（旧宿主 / 官方预览未挂载）
      // 时整块静默跳过，不注册 body、不报错。
      const setupFileEditor = () => {
        if (!featureEnabled('fileEditor')) return undefined
        const disposers = []
        const previewsOf = (scope) => {
          if (scope !== undefined && scope !== null && scope.documentPreviews !== undefined) return scope.documentPreviews
          try { return typeof ctx.get === 'function' ? ctx.get('documentPreviews') : undefined } catch (_) { return undefined }
        }
        const registerPreviews = (previews) => {
          if (previews === undefined || previews === null || typeof previews.register !== 'function') return
          // 真机实测：ctx.inject(deps, cb) **不接管** cb 的返回值（只有 slots.inject 接管），
          // 所以元数据 disposer 必须自己记账——否则重建时会撞「duplicate implementation」抛错，
          // 整块引擎（含头部按钮与正文）从此不再注册。
          let disposeRegistration = null
          try {
            disposeRegistration = previews.register({
              id: FILE_EDITOR_ID,
              extensions: FILE_EDITOR_EXTENSIONS,
              priority: 'builtin',
              title: () => t('editor.viewer'),
              loading: 'text-pages',
              wrap: true,
            })
          } catch (_) {
            return
          }
          disposers.push(disposeRegistration)
          // 档位注册成功才挂 body 与头部按钮：没有档位可选的正文/按钮都是死代码。
          disposers.push(ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
            name: 'sidebar.right.tab.document',
            key: FILE_EDITOR_ID,
            locale: NS,
          }, FileEditorBody)))
          // 标签 ⋯ 菜单项（官方座，零 DOM）：档位注册成功就一起挂上。
          disposers.push(ctx.slots.inject('sidebar.right.tab.menu.item', () => ctx.slots.register({
            name: 'sidebar.right.tab.menu.item',
            id: 'dsh-service-editor',
            order: 40,
          }, (props) => React.createElement(FileEditorMenuItem, props))))
          disposers.push(startEditorEntries())
        }
        if (typeof ctx.inject === 'function') {
          disposers.push(ctx.inject(['documentPreviews'], (scope) => { registerPreviews(previewsOf(scope)) }))
        } else {
          registerPreviews(previewsOf(undefined))
        }
        return () => { for (const dispose of disposers) { try { dispose() } catch (_) {} } }
      }
      ctx.effect(() => {
        // 只在 fileEditor 开关值真正变化时才重挂：无关功能开关更新也会触发 featureScope
        // 订阅，若不判值就整块卸载重挂，会把用户正开着的编辑器（连同未保存草稿）一起掀掉。
        let lastEnabled = featureEnabled('fileEditor')
        let teardown = lastEnabled === true ? setupFileEditor() : undefined
        const unsubscribe = featureScope.subscribe(() => {
          const enabled = featureEnabled('fileEditor')
          if (enabled === lastEnabled) return
          lastEnabled = enabled
          if (typeof teardown === 'function') teardown()
          teardown = enabled === true ? setupFileEditor() : undefined
        })
        return () => {
          unsubscribe()
          if (typeof teardown === 'function') teardown()
        }
      }, 'dsh-service file editor')

      // 移动端适配引擎（v0.30）与会话导航适配层已整段抽至 src/client/mobile.js 与
      // src/client/conversation-nav.js（工厂作用域分片，清单见 scripts/client-source.mjs）；
      // 调用点 createMobileAdaptation({ ... }) 在本文件下方。

      /**
       * 全平台「跳上一条用户回复」引擎：
       * 在官方「回到底部」按钮（to-bottom 槽位，哈希后缀 _toBottomSlot 匹配，
       * rc.2 Md3f7G_ / 0.1.2-alpha.2 EvIC1a_）内注入
       * 同款圆形上箭头按钮（absolute bottom:42px → 稳居官方按钮上方 8px），
       * 随该按钮成组显隐（离开底部才渲染）、跟随 composer 高度偏移。
       * 点击按官方 data-chat-flow-kind="user" 行定位上一条用户回复（流程坐标
       * flowTop = rect.top - scrollport.rect.top，与官方 pagingAnchor 同系），
       * 逐击向上步进；程序化滚动天然受沉浸引擎 800ms 手势窗口免疫。
       * 0.1.2-alpha.2 官方自带回合导航条（TurnNavigator rail，桌面宽窗可见）：
       * 它是回合级跳转，本按钮是「上一条用户回复」逐条步进——语义位置都不同，
       * 历来共存；曾试过「rail 可见即让位」，用户实测否决后回退共存。
       * 与 mobileAdaptation 无关：不依赖 matchMedia、不引用 any 移动属性。
       * v0.36.4 三处真机反馈修正：
       *  ① 图标严格克隆官方按钮内 svg（旋转 180°），不再手绘近似；
       *  ② 桌面 right 对齐实测「slot 右缘 − 官方按钮右缘」（slot 的 padding-right
       *     会把 absolute right:0 推到内容区之外，桌面差一整个侧清理）；
       *  ③ 目标不存在时自动点击「加载更早」（older 分页按钮）并短窗重试，
       *     直到新历史里找到目标或按钮消失/重试耗尽。
       * v0.36.6 iPhone 白屏修复：跳转一律瞬时 scrollTop 直接赋值，绝不
       *   scrollTo({behavior:'smooth'})——真机排查（2026-08-27）：iOS WebKit 上
       *   smooth 滚动 + sticky composer/transform 变换层会让合成层不重绘（点按
       *   上箭头 → 视口白屏，再触发一次滚动才恢复）；Android/桌面 Blink 均无此
       *   问题，官方全应用滚动也从来只用瞬时赋值。别把动画加回来。
       */
      const createUserJump = (labelOf) => {
        const state = { observer: null, btn: null, styleTag: null, retryTimer: null, retryLeft: 0, scrollHandler: null, rafId: null, slotRO: null }
        const nav = createConversationNav()
        const cancelRetryTimer = () => {
          if (state.retryTimer === null) return
          try { state.retryTimer() } catch (_) {}
          state.retryTimer = null
        }
        const UP_SVG_FALLBACK =
          '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">' +
          '<path d="M7 10.5V3.5M3.5 7 7 3.5 10.5 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'

        /**
         * 按钮显隐（v0.36.5 用户点名：达到最顶部后隐藏）：
         * 还有「可跳的上一条」（flowTop<4 的 user 行）或还有官方「加载更早」
         * （点了能加载出更早目标）→ 显示；两者皆无（真正到顶且历史已加载完）→ 隐藏。
         * v1.1.1 曾加「官方回合导航条可见即让位」：实测被用户否决——官方 rail 是
         * 回合级跳转（≤900px 容器整条隐藏，移动端永远没有），上箭头是「上一条
         * 用户回复」逐条步进，语义与位置都不同，两代共存，显隐只由可达目标驱动。
         */
        const updateVisibility = () => {
          if (state.btn === null || !state.btn.isConnected) return
          try {
            const slot = nav.toBottomSlot()
            if (slot === null) return
            const scroll = nav.scrollportOf(slot)
            if (scroll === null || typeof scroll.querySelectorAll !== 'function') return
            let hasTarget = false
            for (const row of nav.userRows(scroll)) {
              if (nav.flowTopOf(scroll, row) < 4) { hasTarget = true; break }
            }
            const hasOlder = nav.loadOlderButton(scroll) !== null
            state.btn.style.display = hasTarget || hasOlder ? 'flex' : 'none'
            syncPosition()
          } catch (_) {}
        }

        /** 克隆官方回到底部按钮内的 svg 并旋转 180° → 图标与官方严格一致。 */
        const officialUpSvg = (slot) => {
          try {
            const source = nav.toBottomButton(slot)
            const svg = source !== null ? source.querySelector('svg') : null
            if (svg !== null && typeof svg.outerHTML === 'string') {
              return svg.outerHTML.replace(/<svg/i, '<svg style="transform:rotate(180deg)"')
            }
          } catch (_) {}
          return UP_SVG_FALLBACK
        }

        /** 实时重测右缘对齐（v1.1.1）：官方 WidthHandle 拖动会改 --dsh-chat-content-width
         *  → 槽位 padding-right 变化 → 官方按钮右移；absolute right 是挂载时量的一次性
         *  偏移，不会跟随。ResizeObserver 观察槽位 content-box（padding 变化即触发）
         *  重测「slot 右缘 − 官方按钮右缘」；滚动驱动的 updateVisibility 顺带再校一次。 */
        const syncPosition = () => {
          if (state.btn === null || !state.btn.isConnected) return
          try {
            const slot = nav.toBottomSlot()
            if (slot === null || typeof slot.querySelector !== 'function') return
            const official = nav.toBottomButton(slot)
            let rightGap = 0
            if (official !== null) {
              const slotRight = slot.getBoundingClientRect().right
              const officialRight = official.getBoundingClientRect().right
              rightGap = Math.max(0, Math.round(slotRight - officialRight))
            }
            const next = `${rightGap}px`
            if (state.btn.style.right !== next) state.btn.style.right = next
          } catch (_) {}
        }

        /** 槽位 content-box 尺寸变化的观察：只挂当前槽位，重建即重挂。 */
        const attachSlotRO = () => {
          if (typeof ResizeObserver !== 'function') return
          if (state.slotRO !== null) {
            try { state.slotRO.disconnect() } catch (_) {}
            state.slotRO = null
          }
          try {
            const slot = nav.toBottomSlot()
            if (slot === null) return
            const ro = new ResizeObserver(() => { syncPosition() })
            ro.observe(slot)
            state.slotRO = ro
          } catch (_) {
            state.slotRO = null
          }
        }

        const mount = () => {
          if (state.btn !== null && state.btn.isConnected) return
          try {
            const slot = nav.toBottomSlot()
            if (slot === null || typeof slot.appendChild !== 'function' || typeof slot.querySelector !== 'function') return
            const official = nav.toBottomButton(slot)
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.setAttribute('data-dshsvc-user-jump', '')
            btn.setAttribute('aria-label', labelOf())
            // 桌面 slot 有 padding-right（内容区居中垫白）→ absolute right:0 会比
            // 官方按钮偏右一整个 padding；实测「slot 右缘 − 官方按钮右缘」对齐。
            // 拖动调宽后由 attachSlotRO → syncPosition 持续跟随官方按钮右缘。
            let rightGap = 0
            try {
              if (official !== null) {
                const slotRight = slot.getBoundingClientRect().right
                const officialRight = official.getBoundingClientRect().right
                rightGap = Math.max(0, Math.round(slotRight - officialRight))
              }
            } catch (_) {}
            Object.assign(btn.style, {
              position: 'absolute', right: `${rightGap}px`, bottom: '42px', zIndex: '1',
              width: '34px', height: '34px', padding: '0', cursor: 'pointer',
              border: '1px solid var(--dsw-alias-border-l2)',
              background: 'var(--dsw-alias-button-floating-fill)',
              color: 'var(--dsw-alias-label-primary)',
              boxShadow: 'var(--dsw-shadow-lv2)',
              ...fullRound('100px'), display: 'flex', alignItems: 'center',
              justifyContent: 'center', pointerEvents: 'auto',
            })
            btn.innerHTML = officialUpSvg(slot)
            btn.addEventListener('click', () => {
              const scroll = nav.scrollportOf(slot)
              if (scroll === null || typeof scroll.querySelectorAll !== 'function') return
              const baseScrollTop = Number(scroll.scrollTop) || 0
              // flowTop 与 scrollTop 不同系：flowTop 是相对滚动视口的坐标（0=视口顶，
              // 负=上方）。「上一条用户回复」= flowTop<4（已滚出视口顶之上）的最后一行；
              // 目标文档坐标 = scrollTop + flowTop − 顶部留白。
              const jumpOnce = () => {
                state.retryTimer = null
                // 官方 loadOlderAnchored 加载后会按锚点移动视口（常把视口拉去别处）——
                // 以点击时的基准视口为准即时拉回，避免跳转目标被劫持。
                const now = Number(scroll.scrollTop) || 0
                if (Math.abs(now - baseScrollTop) > 40) {
                  try { scroll.scrollTop = baseScrollTop } catch (_) {}
                }
                const rows = nav.userRows(scroll)
                let target = null
                for (let i = rows.length - 1; i >= 0; i -= 1) {
                  if (nav.flowTopOf(scroll, rows[i]) < 4) { target = rows[i]; break }
                }
                if (target !== null) {
                  const top = Math.max(0, baseScrollTop + nav.flowTopOf(scroll, target) - 12)
                  try { scroll.scrollTop = top } catch (_) {}
                  return
                }
                // 目标不在已加载历史里：官方「加载更早」分页按钮还在 → 持续加载直到
                // 目标出现或历史尽头（按钮消失）。每个 220ms 窗口都消耗一次配额，
                // disabled 只是不重复点击，绝不能因此把约 4.4s 上限变成无限等待。
                if (state.retryLeft <= 0) return
                state.retryLeft -= 1
                const older = nav.loadOlderButton(scroll)
                if (older === null) return // 历史已全部加载且无目标 → 停（按钮随显隐规则隐藏）
                if (older.disabled !== true) {
                  try { older.click() } catch (_) { /* 官方 loading 态下点击无害 */ }
                }
                state.retryTimer = ctx.timer.timeout(jumpOnce, 220)
              }
              cancelRetryTimer()
              state.retryLeft = 20 // 最多约 4.4s 的加载重试窗（多批分页），防无限加载
              jumpOnce()
            })
            slot.appendChild(btn)
            state.btn = btn
            attachSlotRO()
            updateVisibility()
          } catch (_) { /* 外壳结构变化期间探不到槽位时静默等待下轮 */ }
        }

        const start = () => {
          try {
            if (state.styleTag === null) {
              const tag = document.createElement('style')
              tag.dataset.plugin = '@gehennawu/dsh-service'
              tag.dataset.pluginCss = '@gehennawu/dsh-service/user-jump.css'
              tag.textContent =
                '[data-dshsvc-user-jump]:hover,[data-dshsvc-user-jump]:active{background:var(--dsw-alias-button-floating-hover)!important}'
              document.head.appendChild(tag)
              state.styleTag = tag
            }
          } catch (_) {}
          mount()
          if (state.observer !== null) return
          try {
            state.observer = new MutationObserver(() => { mount(); updateVisibility() })
            state.observer.observe(document.documentElement, { childList: true, subtree: true })
          } catch (_) {
            state.observer = null
          }
          if (state.scrollHandler === null) {
            try {
              state.scrollHandler = () => {
                if (typeof requestAnimationFrame === 'function') {
                  if (state.rafId !== null) return
                  state.rafId = requestAnimationFrame(() => { state.rafId = null; updateVisibility() })
                } else {
                  updateVisibility()
                }
              }
              document.documentElement.addEventListener('scroll', state.scrollHandler, true)
            } catch (_) {
              state.scrollHandler = null
            }
          }
        }

        const stop = () => {
          cancelRetryTimer()
          if (state.slotRO !== null) {
            try { state.slotRO.disconnect() } catch (_) {}
            state.slotRO = null
          }
          if (state.scrollHandler !== null) {
            try { document.documentElement.removeEventListener('scroll', state.scrollHandler, true) } catch (_) {}
            state.scrollHandler = null
          }
          if (state.rafId !== null) {
            try { cancelAnimationFrame(state.rafId) } catch (_) {}
            state.rafId = null
          }
          if (state.observer !== null) {
            try { state.observer.disconnect() } catch (_) {}
            state.observer = null
          }
          if (state.btn !== null) {
            try { state.btn.remove() } catch (_) {}
            state.btn = null
          }
          if (state.styleTag !== null) {
            try { state.styleTag.remove() } catch (_) {}
            state.styleTag = null
          }
        }

        return { start, stop }
      }

      const userJump = createUserJump(() => t('conversation.jump.previousReply'))
      ctx.effect(() => {
        userJump.start()
        return () => userJump.stop()
      }, 'dsh-service user reply jump')

      // ─── 模型厂家/渠道图标（v1.8 新增）：设计说明与引擎正文见 src/client/model-icons.js，调用点在下方 ───

      const modelIconEngine = createModelProviderIcons({ ctx, getModelDirectories })
      ctx.effect(() => {
        let subscribed = false
        const sync = () => {
          const enabled = featureEnabled('modelProviderIcons')
          if (enabled && !subscribed) {
            subscribed = true
            // stop() 把引擎标成 disposed 并断开观察者；重新打开必须复位该标记，
            // 否则热重开会「订阅挂上了、重算全被 disposed 早退挡掉」——表现为
            // 关闭后再打开，弹窗分组图标不再回来（真机实测）。
            modelIconEngine.revive()
            modelIconEngine.start()
          } else if (!enabled && subscribed) {
            subscribed = false
            modelIconEngine.stop()
          }
        }
        const unsubscribeFeatures = featureScope.subscribe(sync)
        sync()
        return () => {
          unsubscribeFeatures()
          if (subscribed) modelIconEngine.stop()
        }
      }, 'dsh-service model provider icons')

      const mobileEngine = createMobileAdaptation({ ctx, t, featureEnabled, createConversationNav })
      ctx.effect(() => {
        const unsubscribeFeatures = featureScope.subscribe(() => mobileEngine.evaluate())
        mobileEngine.evaluate()
        return () => {
          unsubscribeFeatures()
          mobileEngine.dispose()
        }
      }, 'dsh-service mobile adaptation')
    }

    exports.inject = inject
    exports.apply = apply
    // 子代理行纯逻辑出口：仅供自动化测试直达，运行时无消费者。
    exports.subagentLine = { aggregateSubagentRoutes, subagentRouteListText }
    // 特性设置门面的具名工厂：供单测在隔离 ctx 上直接覆盖三条能力探测分支。
    exports.featureSettings = { create: createFeatureSettings }
    // 右栏文件编辑（v1.6/v1.6.1）：档位 id、可编辑后缀表与入口引擎的纯函数面，供测试与排障复用。
    exports.fileEditor = { id: FILE_EDITOR_ID, extensions: FILE_EDITOR_EXTENSION_TABLE, selectViewerItem, editorExtensionMatches, attr: EDITOR_ENTRY_ATTR, menuItemAttr: EDITOR_MENU_ITEM_ATTR }
    // v1.8 模型厂家/渠道图标：纯解析面 + 图标数据规模，供自动化测试与排障直视。
    exports.modelProviderIcons = {
      resolve: resolveModelIcon,
      dataUri: modelIconDataUri,
      attr: MODEL_ICON_ATTR,
      seatAttr: MODEL_ICON_SEAT_ATTR,
      sizeVar: MODEL_ICON_SIZE_VAR,
      basePx: MODEL_ICON_BASE_PX,
      // 模型选择弹窗分组标题（厂家/渠道商）前的同一枚图标：门属性 + 节点属性 + 基准尺寸。
      menuGroupAttr: MENU_GROUP_ATTR,
      menuGroupIconAttr: MENU_GROUP_ICON_ATTR,
      menuGroupPx: MENU_GROUP_ICON_PX,
      css: MODEL_ICON_CSS,
      slugs: Object.keys(MODEL_ICON_DATA),
      providerCount: Object.keys(MODEL_ICON_PROVIDERS).length,
      // 余额查询手动适配（识别兜底来源）：kind 取值器 + kind→slug 表，供测试与排障直视。
      quotaAdaptedKind: quotaAdaptedKindInStore,
      quotaKindSlugs: MODEL_ICON_QUOTA_KINDS,
      quotaStore,
    }
    return module.exports
  },
})
