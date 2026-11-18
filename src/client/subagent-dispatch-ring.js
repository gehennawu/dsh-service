// 客户端半分片：v1.2 子代理派发记录缓存 + 输入框下累计行组件。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域。
// 原 apply 内整段迁出；本段不是单一引擎而是「缓存状态 + 一组件」，故包成工厂，
// apply.js 以 const { SubagentModelsDock } = createSubagentDispatchRing(
// { ctx, rpcCall, useTranslation }) 解构回原名——组件消费点与原语义零差异（工厂在 apply 内
// 原位调用，每次 apply 一份新缓存状态，与原 apply 作用域状态等命）。
// hooks 由分片自 React 解构（与 apply.js 顶部同一来源）；正文缩进保留搬运原深。
// 历史：v1.2 曾另有回合尾行组件（conversation.chat.turnTail 槽位），后按口径收敛
// 移除，对话页仅保留本累计行一个显示面。

function createSubagentDispatchRing({ ctx, rpcCall, useTranslation }) {
  const { useState, useEffect } = React
      // ── v1.2 子代理派发记录缓存：按父会话聚合；TTL 10s 按会话单飞去重 ──
      // 宿主记录在宿主内存（进程重启即清、页面刷新不丢）；拉取失败进冷却并保留旧缓存（fail-open，
      // 渲染已有行不闪断）。
      const DISPATCH_TTL_MS = 10 * 1000
      // 与宿主 SUBAGENT_DISPATCH_PAGE_MAX 同步（= 环形容量）：一次请求取回环内全部记录。
      const SUBAGENT_DISPATCH_LIMIT = 400
      const dispatchByParent = new Map()
      const dispatchFetchedAt = new Map()
      const dispatchInflight = new Map()
      const refreshSubagentDispatches = (sessionId, force = false) => {
        if (typeof sessionId !== 'string' || sessionId === '') return Promise.resolve([])
        const now = Date.now()
        // force：累计行的轮询刷新（绕过 TTL 去重，保证轮值总是实拉；挂载首拉不受影响）。
        if (!force && now - (dispatchFetchedAt.get(sessionId) ?? 0) < DISPATCH_TTL_MS) {
          return Promise.resolve(dispatchByParent.get(sessionId) ?? [])
        }
        let inflight = dispatchInflight.get(sessionId)
        if (inflight === undefined) {
          // limit = 宿主单次上限（= 环形容量）一次性取回环内全部记录。
          inflight = rpcCall('subagent-dispatches', { parentId: sessionId, limit: SUBAGENT_DISPATCH_LIMIT }).then((result) => {
            const records = result && result.ok === true && Array.isArray(result.value?.records) ? result.value.records : []
            const raw = []
            for (const record of records) {
              if (record === null || typeof record !== 'object') continue
              raw.push(record)
            }
            dispatchByParent.set(sessionId, raw)
            dispatchFetchedAt.set(sessionId, Date.now())
            return raw
          }).catch(() => {
            // 失败进冷却：避免一回合内同一会话渲染风暴；旧缓存原样保留。返回 null 区分「失败」，
            // 累计行的首拉据此决定是否启动轮询链（宿主不可用时静默、不常驻定时器）。
            dispatchFetchedAt.set(sessionId, Date.now())
            return null
          })
          dispatchInflight.set(sessionId, inflight)
          inflight.finally(() => dispatchInflight.delete(sessionId)).catch(() => {})
        }
        return inflight
      }

      // 会话级累计行（v1.2）：输入框下方常驻「本会话子代理」模型行，独占官方统计的下一行。
      // 由宿主派发记录驱动，不依赖回合数据、不受事件流折叠影响，任何视图/任意回合都能
      // 看到。轮询走 ctx.timer 自续链（20s/120s 两档，测试桩可推进、卸载即断）。
      //
      // 轮询口径（P3，2026-11-18）：派发记录只在回合内写入（宿主 `agent/created` 时入环），
      // 而客户端 `ctx.sessions.list` 快照的 `running` 是推送式事实源，据此把「从未派发过」
      // 的空会话从 20s 常驻轮询里摘出去：
      //   · 回合进行中 → 20s/轮，紧跟新派发（回合开始/结束各补一次实拉，边沿即刷新）；
      //   · 空闲且有记录 → 120s 低频心跳，只兜「漏掉 running 边沿」的宿主异常；
      //   · 空闲且无记录 → 彻底停表，等 running 边沿或会话切换再起（旧口径在此 20s 空转）；
      //   · 宿主没有客户端会话快照服务 → 退回旧 20s 常驻口径，不降级功能。
      // 页面不可见时只续链不实拉：后台标签不再空转，切回前台后的下一轮自然补上。
      const SUBAGENT_DOCK_POLL_MS = 20 * 1000
      const SUBAGENT_DOCK_IDLE_MS = 120 * 1000
      function SubagentModelsDock(props) {
        const translate = useTranslation()
        const [text, setText] = useState('')
        useEffect(() => {
          let cancelled = false
          let pollChain = undefined
          let unsubscribeSessions = null
          const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
          if (sessionId === undefined) {
            setText('')
            return undefined
          }
          // 展示一律从缓存条目读取（成功=新数据，失败=旧缓存原样）：瞬时 RPC 失败不闪断。
          const setFromCache = () => {
            const records = dispatchByParent.get(sessionId) ?? []
            const entries = aggregateSubagentRoutes(records)
            setText(entries.length === 0 ? '' : `${translate('subagent.dock.label')}${subagentRouteListText(entries)}`)
          }
          const hasRecords = () => (dispatchByParent.get(sessionId) ?? []).length > 0
          // true=回合进行中，false=空闲，null=宿主没有客户端会话快照服务（退回旧口径）。
          const readRunning = () => {
            try {
              const list = ctx.sessions?.list
              if (list === undefined || typeof list.getSnapshot !== 'function') return null
              const snapshot = list.getSnapshot()
              if (snapshot === undefined || snapshot === null || snapshot.byId === null || typeof snapshot.byId !== 'object') return null
              const row = snapshot.byId[sessionId]
              if (row === undefined) return false
              // 行上没有 running 字段（更老的宿主）= 没有可用的运行态事实，退回旧口径，
              // 不能把「不知道」当成「空闲」。
              return 'running' in row ? row.running === true : null
            } catch (_) {
              return null
            }
          }
          const pageVisible = () => {
            try {
              return typeof document === 'undefined' || document.visibilityState !== 'hidden'
            } catch (_) {
              return true
            }
          }
          let running = readRunning()
          const clearChain = () => {
            if (typeof pollChain === 'function') pollChain()
            pollChain = undefined
          }
          // 实拉一次：成功后按当前运行态重排轮询链；失败保留旧缓存（不闪断），
          // 由调用方决定是否继续挂链（轮内失败继续、首拉失败静默不常驻）。
          const pull = (force) => refreshSubagentDispatches(sessionId, force === true).then((records) => {
            if (cancelled) return null
            setFromCache()
            return records
          }).catch(() => {
            if (!cancelled) setText('')
            return null
          })
          const tick = () => {
            pollChain = undefined
            if (cancelled) return
            // 页面不可见时只续链不实拉（后台标签的空转收敛为一次空 tick；浏览器本身
            // 已把后台定时器节流到 ≥1 分钟，切回前台后下一轮自然补上）。
            if (!pageVisible()) {
              arm()
              return
            }
            // 轮内失败也续链（旧缓存照旧显示，下轮再试）。
            pull(true).then(() => { if (!cancelled) arm() })
          }
          const pollDelay = () => {
            if (running === true) return SUBAGENT_DOCK_POLL_MS
            if (running === null) return SUBAGENT_DOCK_POLL_MS
            return hasRecords() ? SUBAGENT_DOCK_IDLE_MS : null
          }
          const arm = () => {
            clearChain()
            if (cancelled) return
            const delay = pollDelay()
            if (delay === null) return
            pollChain = ctx.timer?.timeout?.(tick, delay)
          }
          // running 边沿（任意方向都实拉一次）：回合开始立刻看到新派发，回合结束补拉收尾
          // （最后一个派发可能落在上次轮询之后），随后按空闲节奏重排（无记录即停表）。
          const onSessionsChanged = () => {
            if (cancelled) return
            const next = readRunning()
            if (next === running) return
            running = next
            if (!pageVisible()) {
              arm()
              return
            }
            pull(true).then(() => { if (!cancelled) arm() })
          }
          try {
            const list = ctx.sessions?.list
            if (list !== undefined && typeof list.subscribe === 'function') unsubscribeSessions = list.subscribe(onSessionsChanged)
          } catch (_) {
            unsubscribeSessions = null
          }
          // 首拉只发一次（旧实现同一 tick 发两次）；成功才起链，宿主不可用时静默、
          // 不常驻定时器（重进会话或页面刷新后自愈）。
          pull(false).then((records) => { if (!cancelled && records !== null) arm() })
          return () => {
            cancelled = true
            clearChain()
            if (typeof unsubscribeSessions === 'function') unsubscribeSessions()
          }
        }, [props.sessionId])
        if (text === '') return null
        // 挂输入卡下方 dock 行（conversation.composer.dock 槽位）：svcStyle 的
        // `[class*="uV2eYG_dock"] [data-dsh-service-subagent-models-dock]{flex:0 0 100%}`
        // 让本行在 0.1.6 dock 行（开 wrap，见 apply.js :has 规则）独占官方统计的下一行。
        // 这条 flex 不能写进行内样式：老宿主（0.1.5-rc.1/rc.2）上同槽位渲染为
        // uV2eYG_root（flex-direction:column）的子项，横向语义的 flex-basis:100% 在那里
        // 变成「占满容器高度」，一行文字被撑成 ~150px 空壳（issue #3 底部空白）。
        // order:1 仍须有——官方 DOM 里槽位排在上下文圆环之前，100% 行会把圆环挤到
        // 第三行；order 后移让统计胶囊+圆环共占第一行（官方原位），本行居第二行。
        return React.createElement('div', {
          'data-testid': 'subagent-models-dock',
          'data-dsh-service-subagent-models-dock': true,
          style: {
            boxSizing: 'border-box',
            order: 1,
            textAlign: 'center',
            fontSize: '12px',
            lineHeight: '18px',
            color: 'var(--dsh-svc-text-muted, var(--dsw-alias-label-secondary, #6b7280))',
            padding: '0 4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          },
        }, text)
      }
  return { SubagentModelsDock }
}
