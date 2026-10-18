// 客户端半分片：侧栏底部常驻「设置」入口（账号按钮上方，sidebar.footer.action 槽）。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域。
//
// 背景：DSH 的设置入口默认藏在账号按钮弹出的菜单里（菜单项「设置」），未登录/已登录
// 都只能先点账号按钮。本分片在侧栏底部 settingsArea **上方**的官方 list 槽
// sidebar.footer.action 常驻一行设置入口，点击直接打开官方设置面板。
//
// 打开面板的路径：DSH 没有公开的「打开设置」客户端 API，故按三条路径降级：
//   ① 设置外壳的单例 store：sidebar.settings 槽条目携带 store 句柄（settings-general
//      把 create() 覆写成恒返回同一个 shellInstance），instance.actions.open()。
//      这条可能拿到脱钩实例（静默无效），故尝试后用微任务复核面板是否真的出现。
//   ② 快捷键注册表的菜单调用：settings.open 命令（设置外壳注册）经 registry.invoke，
//      与真实菜单项走同一条 resolve/run；命令在目录里即视为可用。
//   ③ 账号菜单降级：合成「账号按钮 → 第一个菜单项（设置）」两次点击；同一同步任务内
//      完成，菜单不会绘制到屏幕上。
// 三条全失败时静默返回（入口仍在，不抛错、不阻断侧栏）。命中的路径写在按钮的
// data-dshsvc-open-via 上，供真机探针取证。

function createSettingsEntry({ ctx, useTranslation }) {
  const SETTINGS_PANEL_SELECTOR = '[data-shortcut-modal="settings"]'
  const SETTINGS_SLOT = 'sidebar.settings'
  const OPEN_VIA_ATTR = 'data-dshsvc-open-via'

  const isSettingsOpen = () => {
    try {
      return typeof document !== 'undefined' && document.querySelector(SETTINGS_PANEL_SELECTOR) !== null
    } catch (_) {
      return false
    }
  }

  // 当前是否已有别的模态层（设置面板自身除外）：此时不该再叠一层设置面板。
  const hasForeignModal = () => {
    try {
      if (typeof document === 'undefined') return false
      for (const dialog of document.querySelectorAll('[role="dialog"]')) {
        if (dialog.getAttribute('data-shortcut-modal') !== 'settings') return true
      }
      return false
    } catch (_) {
      return false
    }
  }

  const openViaShellStore = () => {
    try {
      const entries = typeof ctx.slots?.entries === 'function' ? ctx.slots.entries(SETTINGS_SLOT) : []
      for (const entry of entries) {
        const store = entry && entry.store
        if (!store || typeof store.create !== 'function') continue
        const instance = store.create()
        const open = instance && instance.actions && instance.actions.open
        if (typeof open === 'function') {
          open()
          return true
        }
      }
    } catch (_) {}
    return false
  }

  const openViaShortcutRegistry = () => {
    try {
      const shortcuts = typeof ctx.get === 'function' ? ctx.get('shortcuts') : undefined
      const registry = shortcuts && shortcuts.registry
      if (!registry || typeof registry.invoke !== 'function') return false
      const catalog = shortcuts.catalog
      const rows = catalog && typeof catalog.getSnapshot === 'function' ? catalog.getSnapshot() : null
      if (!Array.isArray(rows) || !rows.some((row) => row && row.id === 'settings.open')) return false
      // 无 document 的测试替身里 target 缺省为 null；真实浏览器恒有 body。
      registry.invoke('settings.open', {
        region: 'page',
        modal: null,
        target: typeof document === 'undefined' ? null : document.body,
      })
      return true
    } catch (_) {}
    return false
  }

  const openViaAccountMenu = () => {
    try {
      if (typeof document === 'undefined') return false
      const trigger = document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="menu"]')
      if (!trigger) return false
      trigger.click()
      // 账号菜单固定顺序：设置 → 意见反馈 → 退出登录/登录，第一项恒为设置。
      const item = document.querySelector('[role="menu"] [role="menuitem"], [role="menuitem"]')
      if (!item) {
        trigger.click()
        return false
      }
      item.click()
      return true
    } catch (_) {}
    return false
  }

  const markOpenVia = (target, via) => {
    try {
      if (target && target.dataset) target.dataset.dshsvcOpenVia = via
    } catch (_) {}
  }

  // 逐条尝试；某条报告成功即停（store 路径额外用微任务复核，防脱钩实例静默失效）。
  const attempt = (target, stages, index) => {
    if (isSettingsOpen() || hasForeignModal()) return
    if (index >= stages.length) return
    const attempted = stages[index]()
    if (!attempted) {
      attempt(target, stages, index + 1)
      return
    }
    if (index !== 0) {
      markOpenVia(target, index === 1 ? 'shortcut' : 'menu')
      return
    }
    // 无 DOM 可复核（单测替身）时信任本路径，不再无谓降级。
    Promise.resolve().then(() => {
      if (typeof document === 'undefined' || isSettingsOpen()) {
        markOpenVia(target, 'store')
        return
      }
      attempt(target, stages, index + 1)
    })
  }

  const openSettings = (event) => {
    const target = event && event.currentTarget ? event.currentTarget : null
    attempt(target, [openViaShellStore, openViaShortcutRegistry, openViaAccountMenu], 0)
  }

  function SettingsEntry(props) {
    const translate = useTranslation()
    const wide = props === null || props === undefined || props.wide !== false
    const label = translate('settingsEntry.label')
    return React.createElement(
      'button',
      {
        type: 'button',
        'data-dshsvc-settings-entry': '',
        'data-collapsed': wide ? 'false' : 'true',
        'data-testid': 'dsh-service-settings-entry',
        title: label,
        'aria-label': label,
        onClick: openSettings,
      },
      // 齿轮图标：与官方设置入口同一套描边语言（24 视图框、currentColor）；外层 24px
      // 图标位让本行文字与下方账号按钮的文字左缘同列。
      React.createElement(
        'span',
        { 'data-dshsvc-settings-entry-icon': '' },
        React.createElement(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: 16,
            height: 16,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            style: { flexShrink: 0, display: 'block' },
          },
          React.createElement('path', {
            d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
          }),
          React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
        ),
      ),
      wide ? React.createElement('span', { 'data-dshsvc-settings-entry-label': '' }, label) : null,
    )
  }

  return { SettingsEntry, openSettings }
}
