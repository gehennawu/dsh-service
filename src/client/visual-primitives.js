// 客户端半分片：Svc 视觉基元（统一视觉语言 v0.39）——按钮/行动作/徽标/展示面样式单一事实源。
// 纯函数（仅依赖 client.js 工厂作用域的 fullRound），下沉工厂作用域：apply 与其余分片
// 直接引用，不占接口面。分片不是模块——按 scripts/client-source.mjs 清单拼接。
// variant 语义（安全教义对齐）：dangerGhost 危险描边 = 破坏动作初次出现；danger 危险实底 =
// 仅最终确认；brandGhost 低饱和品牌描边 = 非破坏主操作；primary 品牌实底 = 唯一主操作。
      // ── Svc 视觉基元（统一视觉语言 v0.39）：按钮/展示面样式单一事实源 ────
      // ServicePanel 与 RestartSection 曾各自声明同名样式常量并已漂移，现收敛到工厂级。
      // variant 语义（安全教义对齐）：dangerGhost 危险描边 = 破坏动作初次出现；
      // danger 危险实底 = 仅最终确认；brandGhost 低饱和品牌描边 = 非破坏主操作
      // （创建备份等）；primary 品牌实底 = 唯一主操作；neutral 弱化；ghost 取消类。
      const SVC_BTN_BASE = { minHeight: 'var(--dsh-svc-control-h, 36px)', padding: '6px 14px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid transparent', cursor: 'pointer', fontSize: '13px', fontWeight: 550, transition: 'border-color 120ms ease, color 120ms ease, background 120ms ease', lineHeight: '20px' }
      const svcButtonStyle = (variant) => {
        if (variant === 'primary') return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-brand)', borderColor: 'var(--dsh-svc-brand)', color: 'var(--dsh-svc-brand-text)' }
        if (variant === 'danger') return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-danger)', borderColor: 'var(--dsh-svc-danger)', color: 'var(--dsh-svc-brand-text)' }
        if (variant === 'dangerGhost') return { ...SVC_BTN_BASE, background: 'transparent', color: 'var(--dsh-svc-danger)', borderColor: 'var(--dsh-svc-danger)' }
        if (variant === 'brandGhost') return { ...SVC_BTN_BASE, background: 'transparent', color: 'var(--dsh-svc-brand)', borderColor: 'var(--dsh-svc-brand)' }
        if (variant === 'ghost') return { ...SVC_BTN_BASE, background: 'transparent', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)' }
        // v0.39 用户复核：中性操作钮也要可辨——边框用加强令牌，不再与卡片/画布同色。
        if (variant === 'neutral') return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-page-bg)', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)' }
        return { ...SVC_BTN_BASE, background: 'var(--dsh-svc-content-bg)', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)' }
      }
      // v0.39 行尾上下文动作（查看/导出/归档/恢复…）：统一幽灵底 + 加强描边 + 紧凑尺寸。
      const svcRowActionStyle = (overrides) => Object.assign({}, SVC_BTN_BASE, { background: 'transparent', color: 'var(--dsh-svc-text)', borderColor: 'var(--dsh-svc-border-strong)', minHeight: '28px', padding: '4px 10px', fontSize: '12px', borderRadius: 'var(--dsh-svc-radius-control)' }, overrides)
      // v0.39 徽标工厂：状态/标签统一 pill 语言（10px 字 + 语义淡色底 + 语义文字）——
      // 一处改动 = 全面板徽章联动（此前会话标签/额度 auto/技能徽章各写各的 rgba）。
      const svcBadgeStyle = (tone, extra) => Object.assign({
        display: 'inline-flex',
        alignItems: 'center',
        flex: 'none',
        fontSize: '10px',
        lineHeight: '16px',
        padding: '1px 6px',
        ...fullRound(999),
        whiteSpace: 'nowrap',
        ...({
          success: { background: 'rgba(16,185,129,0.16)', color: 'var(--dsh-svc-success)' },
          warning: { background: 'rgba(198,128,0,0.14)', color: 'var(--dsh-svc-warning)' },
          danger: { background: 'rgba(220,38,38,0.12)', color: 'var(--dsh-svc-danger)' },
          info: { background: 'rgba(37,99,235,0.10)', color: 'var(--dsh-svc-info)' },
          neutral: { background: 'var(--dsh-svc-page-bg)', color: 'var(--dsh-svc-text-muted)' },
        }[tone] || {}),
      }, extra)
      // 展示面（只读信息容器）：页面级浅底 + 细边框，与操作卡片区分。
      const svcSurfaceStyle = (extra) => Object.assign({ background: 'var(--dsh-svc-surface-bg)', color: 'var(--dsh-svc-text)', border: '1px solid var(--dsh-svc-border)', borderRadius: 'var(--dsh-svc-radius-control)', padding: '10px' }, extra)
      // 页面级「区块卡」容器：一个页面/子页的最外层块统一用它——上内边距 4px 让区块标题贴住
      // tab-panel 的内容顶（页内首块不再各自写 marginTop），下内边距 14px + marginBottom 12px
      // 构成统一的纵向节奏。此前该字面量在三个分片里各写一份，且部分页改用 `marginTop: 18px`
      // 手工下沉，导致概览/额度/配置三页的首块起点与其它页不一致；收敛到这一处。
      const svcCardStyle = (extra) => Object.assign({ padding: '4px 0 14px', marginBottom: '12px', color: 'var(--dsw-alias-label-primary)' }, extra)
