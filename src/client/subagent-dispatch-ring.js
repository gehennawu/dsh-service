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
      // 看到。轮询走 ctx.timer 自续链（20s，测试桩可推进、卸载即断）。
      const SUBAGENT_DOCK_POLL_MS = 20 * 1000
      function SubagentModelsDock(props) {
        const translate = useTranslation()
        const [text, setText] = useState('')
        useEffect(() => {
          let cancelled = false
          let pollDispose = undefined
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
          const refresh = () => refreshSubagentDispatches(sessionId).then((records) => {
            if (cancelled) return false
            setFromCache()
            return records !== null
          }).catch(() => {
            if (!cancelled) setText('')
            return false
          })
          refresh()
          // 首拉成功才启动轮询链：宿主不可用/RPC 失败时静默且不常驻定时器
          // （重进会话或页面刷新后自愈）。轮询轮内失败保留链，下轮再试。
          const tick = () => {
            if (cancelled) return
            refreshSubagentDispatches(sessionId, true).then(() => {
              if (cancelled) return
              setFromCache()
            }).catch(() => {
              if (!cancelled) setText('')
            })
            pollChain = ctx.timer?.timeout?.(tick, SUBAGENT_DOCK_POLL_MS)
          }
          let pollChain = undefined
          Promise.resolve(refresh()).then((ok) => {
            if (cancelled || !ok) return
            pollChain = ctx.timer?.timeout?.(tick, SUBAGENT_DOCK_POLL_MS)
          })
          return () => {
            cancelled = true
            if (typeof pollChain === 'function') pollChain()
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
