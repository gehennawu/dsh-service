// 客户端半分片：会话导航适配层。原 apply 内整段迁出，零非全局依赖
// （自由标识符仅浏览器全局）。分片不是模块，拼接机制见 scripts/client-source.mjs。

      /**
       * 会话导航适配层：本文件里唯一允许知道官方外壳 DOM 结构（类哈希、
       * data 属性、滚动参照系）的地方。「跳上一条用户回复」引擎只跟这里的
       * 语义操作对话；外壳升级导致结构或类哈希漂移时只改本层，引擎零改动。
       * 全部方法吞异常，找不到一律回 null / 空数组，调用方按「不存在」处理。
       */
      const createConversationNav = () => {
        const hasScrollAttr = (el) => {
          if (typeof el.hasAttribute === 'function') {
            try { return el.hasAttribute('data-conversation-scroll') } catch (_) { return false }
          }
          // 真实 DOM 的 attributes 是 NamedNodeMap（没有 .has），不得假设 Map 风格方法。
          try {
            return el.attributes !== null && typeof el.attributes.getNamedItem === 'function' &&
              el.attributes.getNamedItem('data-conversation-scroll') !== null
          } catch (_) { return false }
        }
        return {
          /** 官方「回到底部」sticky 槽位。
           *  哈希前缀随包拆分漂移（rc.2 Md3f7G_ → 0.1.2-alpha.2 EvIC1a_，聊天视图
           *  迁进 dsh-client-ui-chat）：按稳定的可读词干后缀匹配，跨版本兼容。 */
          toBottomSlot: () => {
            try { return document.querySelector('[class*="_toBottomSlot"]') } catch (_) { return null }
          },
          /** 官方回到底部按钮本体（:not 排除命名含 Slot 的槽层）。 */
          toBottomButton: (slot) => {
            try { return slot.querySelector('[class*="_toBottom"]:not([class*="Slot"])') } catch (_) { return null }
          },
          /** 事件目标是否就是官方「回到底部」按钮（含内部 svg）。
           *  沉浸引擎需要它：官方 toBottom 只做一次 `el.scrollTop = el.scrollHeight`，
           *  在引擎眼里与流式贴底同形（免疫层不翻转），点它到底因此不会回显
           *  （2026-09-15 真机反馈）。「用户点了回底按钮」这个意图只有事件目标能表达。
           *  词干后缀 _toBottom 跨版本稳定（rc.2 Md3f7G_ → 0.1.2-alpha.2 EvIC1a_）。 */
          isToBottomButton: (target) => {
            try {
              if (target === null || target === undefined || typeof target.closest !== 'function') return false
              return target.closest('[class*="_toBottom"]:not([class*="Slot"])') !== null
            } catch (_) { return false }
          },
          /** 从槽位向上找会话滚动容器（官方 [data-conversation-scroll]）；走不通时回退槽位父节点。 */
          scrollportOf: (slot) => {
            try {
              let node = slot
              while (node !== null && node !== document.documentElement && !hasScrollAttr(node)) {
                node = node.parentNode
              }
              return node !== null && node !== document.documentElement ? node : slot.parentNode
            } catch (_) { return null }
          },
          /** 官方回合导航条（0.1.2-alpha.2 新增 TurnNavigator，聊天右缘 rail）。
           *  官方双门控：已加载回合 <2 不渲染 + @container (width<=900px) 整条隐藏
           *  ——移动端/窄窗永远没有官方导航。v1.1.1 曾做过「rail 可见时上箭头让位」，
           *  用户实测反馈否决：官方 rail 是回合级跳转（仅桌面宽窗），上箭头是
           *  「上一条用户回复」逐条步进（全平台），语义不同、位置垂直错开，共存不冲突。
           *  保留探测能力仅供调试/未来参考，不再参与显隐。 */
          officialTurnNavigatorVisible: (scroll) => {
            try {
              if (typeof getComputedStyle !== 'function') return false
              if (scroll === null || typeof scroll.querySelector !== 'function') return false
              const rail = scroll.querySelector('[class*="_rail"]')
              if (rail === null) return false
              return getComputedStyle(rail).display !== 'none'
            } catch (_) { return false }
          },
          /** 已渲染的用户回复行快照（官方 data-chat-flow-kind="user"）。 */
          userRows: (scroll) => {
            const rows = []
            try {
              if (typeof scroll.querySelectorAll !== 'function') return rows
              for (const row of scroll.querySelectorAll('[data-chat-flow-kind="user"]')) rows.push(row)
            } catch (_) {}
            return rows
          },
          /** 行的滚动视口坐标（0=视口顶、负=已滚出上方，与官方 pagingAnchor 同系）。 */
          flowTopOf: (scroll, row) => {
            try { return row.getBoundingClientRect().top - scroll.getBoundingClientRect().top } catch (_) { return 0 }
          },
          /** 官方「加载更早」分页按钮（历史加载完即从 DOM 消失）。 */
          loadOlderButton: (scroll) => {
            try {
              return typeof scroll.querySelector === 'function' ? scroll.querySelector('[class*="_older"] button') : null
            } catch (_) { return null }
          },
        }
      }
