// 客户端半分片：v1.2 子代理派发记录缓存 + 回合尾/列表挂载组件。
// 分片不是模块——按 scripts/client-source.mjs 清单拼接成同一个 factory 作用域。
// 原 apply 内整段迁出；本段不是单一引擎而是「缓存状态 + 两组件」，故包成工厂，
// apply.js 以 const { SubagentModelsDock, SubagentModelsTurnTail } = createSubagentDispatchRing(
// { ctx, rpcCall, useTranslation }) 解构回原名——组件消费点与原语义零差异（工厂在 apply 内
// 原位调用，每次 apply 一份新缓存状态，与原 apply 作用域状态等命）。
// hooks 由分片自 React 解构（与 apply.js 顶部同一来源）；正文缩进保留搬运原深。

function createSubagentDispatchRing({ ctx, rpcCall, useTranslation }) {
  const { useState, useEffect } = React
      // ── v1.2 子代理派发记录缓存：按父会话聚合、turn 索引；TTL 10s 按会话单飞去重 ──
      // 宿主记录在宿主内存（进程重启即清、页面刷新不丢）；拉取失败进冷却并保留旧缓存（fail-open，
      // 渲染已有行不闪断）。同一会话连续回合尾行共享一次请求。
      const DISPATCH_TTL_MS = 10 * 1000
      // 与宿主 SUBAGENT_DISPATCH_PAGE_MAX 同步（= 环形容量）：一次请求取回环内全部记录。
      const SUBAGENT_DISPATCH_LIMIT = 400
      const dispatchByParent = new Map()
      const dispatchFetchedAt = new Map()
      const dispatchInflight = new Map()
      // 缓存条目 = { byTurn: Map<turn, records[]>, records: 原始记录全量 }。records 保留
      // 无 turn 的派发（宿主允许记录缺 turn）：回合尾行按 turn 索引取用，会话级累计行聚合全量。
      const dispatchRecordsFor = (sessionId) => {
        const entry = dispatchByParent.get(sessionId)
        return entry === undefined ? new Map() : entry.byTurn
      }
      const refreshSubagentDispatches = (sessionId, force = false) => {
        if (typeof sessionId !== 'string' || sessionId === '') return Promise.resolve(new Map())
        const now = Date.now()
        // force：会话级累计行的轮询刷新（绕过 TTL 去重，保证轮值总是实拉；回合尾行的
        // 挂载首拉不受影响——第二次拉取仍受 TTL 保护）。
        if (!force && now - (dispatchFetchedAt.get(sessionId) ?? 0) < DISPATCH_TTL_MS) return Promise.resolve(dispatchRecordsFor(sessionId))
        let inflight = dispatchInflight.get(sessionId)
        if (inflight === undefined) {
          // limit = 宿主单次上限（= 环形容量）一次性取回：累计行按此拉全量，回合尾行按 turn 过滤。
          inflight = rpcCall('subagent-dispatches', { parentId: sessionId, limit: SUBAGENT_DISPATCH_LIMIT }).then((result) => {
            const records = result && result.ok === true && Array.isArray(result.value?.records) ? result.value.records : []
            const byTurn = new Map()
            const raw = []
            for (const record of records) {
              if (record === null || typeof record !== 'object') continue
              raw.push(record)
              const turn = typeof record.turn === 'number' && Number.isFinite(record.turn) ? record.turn : undefined
              if (turn === undefined) continue
              let list = byTurn.get(turn)
              if (list === undefined) {
                list = []
                byTurn.set(turn, list)
              }
              list.push(record)
            }
            dispatchByParent.set(sessionId, { byTurn, records: raw })
            dispatchFetchedAt.set(sessionId, Date.now())
            return byTurn
          }).catch(() => {
            // 失败进冷却：避免一回合内同一会话渲染风暴；旧缓存原样保留。返回 null 区分「失败」，
            // 会话级累计行的首拉据此决定是否启动轮询链（宿主不可用时静默、不常驻定时器）。
            dispatchFetchedAt.set(sessionId, Date.now())
            return null
          })
          dispatchInflight.set(sessionId, inflight)
          inflight.finally(() => dispatchInflight.delete(sessionId)).catch(() => {})
        }
        return inflight
      }
      // 对话页回合尾行组件：
      // 0.1.6-alpha.1 及之前：chain 槽位，matched 由链槽裁决注入（{turn, subagentCount}）；
      // 0.1.6-alpha.2 起：list 槽位，props.matched 为空，由组件自身调用 selectSubagentModelsTurnTail(props) 兜底求值。
      // 标准 props 含 sessionId；数据按 (sessionId, turn) 拉取后渲染一行小字。
      function SubagentModelsTurnTail(props) {
        const translate = useTranslation()
        const [text, setText] = useState('')
        const matched = (props.matched && typeof props.matched.turn === 'number')
          ? props.matched
          : selectSubagentModelsTurnTail(props)
        const turn = matched && typeof matched.turn === 'number' ? matched.turn : undefined
        useEffect(() => {
          let cancelled = false
          const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
          if (turn === undefined || sessionId === undefined) {
            setText('')
            return undefined
          }
          refreshSubagentDispatches(sessionId).then((byTurn) => {
            if (cancelled) return
            // 拉取失败（null）沿用旧缓存：瞬时失败不把已正确的行替换成兜底文案；
            // 从未成功过（无缓存条目）按设计静默（RPC 失败渲染 null），不编造计数。
            const staleEntry = dispatchByParent.get(sessionId)
            const byTurnSafe = byTurn === null
              ? (staleEntry === undefined ? new Map() : staleEntry.byTurn)
              : byTurn
            const turnRecords = byTurnSafe.get(turn)
            const entries = aggregateSubagentRoutes(turnRecords)
            if (entries.length === 0) {
              if (byTurn === null && staleEntry === undefined) {
                setText('')
                return
              }
              const count = Number.isFinite(matched?.subagentCount) && matched.subagentCount > 0 ? String(matched.subagentCount) : String(turnRecords?.length ?? 1)
              const countKey = count === '1' ? 'subagent.turnTail.countOne' : 'subagent.turnTail.countMany'
              setText(`${translate(countKey, { count })}${translate('subagent.turnTail.unknown')}`)
              return
            }
            setText(`${translate('subagent.turnTail.label')}${subagentRouteListText(entries)}`)
          }).catch(() => {
            if (!cancelled) setText('')
          })
          return () => {
            cancelled = true
          }
        }, [turn, props.sessionId])
        if (text === '') return null
        return React.createElement('div', {
          'data-testid': 'subagent-models-turn-tail',
          'data-dsh-service-subagent-models': true,
          style: {
            fontSize: '12px',
            lineHeight: '18px',
            color: 'var(--dsh-svc-text-muted, var(--dsw-alias-label-secondary, #6b7280))',
            padding: '2px 0',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          },
        }, text)
      }

      // 会话级累计行（v1.2 补）：composer 下方常驻「本会话子代理模型」。
      // 回合尾行依赖官方 turn-process 计数触发，compaction 折叠子代理工具调用后
      // （官方自身也不再显示计数）回合尾行会静默消失——累计行由宿主派发记录驱动，
      // 不受事件流折叠影响，任何视图/任意回合都能看到。轮询走 ctx.timer 自续链
      // （20s，测试桩可推进、卸载即断）；与回合尾行共享同一份记录缓存。
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
          // 聚合用原始全量记录（含无 turn 的派发）——累计行就是「不依赖回合数据、任何视图
          // 可见」的兜底面，不能把缺 turn 的记录丢掉。
          const setFromCache = () => {
            const entry = dispatchByParent.get(sessionId)
            const records = entry === undefined ? [] : entry.records
            const entries = aggregateSubagentRoutes(records)
            setText(entries.length === 0 ? '' : `${translate('subagent.turnTail.label')}${subagentRouteListText(entries)}`)
          }
          const refresh = () => refreshSubagentDispatches(sessionId).then((byTurn) => {
            if (cancelled) return false
            setFromCache()
            return byTurn !== null
          }).catch(() => {
            if (!cancelled) setText('')
            return false
          })
          refresh()
          // 首拉成功才启动轮询链：宿主不可用/RPC 失败时静默且不常驻定时器
          // （重进会话或页面刷新后自愈）。轮询轮内失败保留链，下轮再试。
          const tick = () => {
            if (cancelled) return
            refreshSubagentDispatches(sessionId, true).then((byTurn) => {
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
        return React.createElement('div', {
          'data-testid': 'subagent-models-dock',
          'data-dsh-service-subagent-models-dock': true,
          style: {
            fontSize: '12px',
            lineHeight: '18px',
            color: 'var(--dsh-svc-text-muted, var(--dsw-alias-label-secondary, #6b7280))',
            padding: '2px 4px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: '100%',
          },
        }, text)
      }
  return { SubagentModelsDock, SubagentModelsTurnTail }
}
