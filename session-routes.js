// 会话管理（sessions）的 RPC 端点：从 apply 的端点表按功能域拆出。
// 依赖显式注入（工厂解构名单即本模块完整依赖面）；handler 体与拆分前逐字一致。
// 注意：客户端半有单产物约束，宿主半无此约束——兄弟 ESM 模块是本仓库既有惯例
// （quota-adapters.js / backup-integrity.js / plugin-health.js / plugin-compat.js）。

import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'

export function createSessionsRoutes({
  ctx,
  dshHome,
  sessionBytesCache,
  sessionDeletePlans,
  sessionTitleCache,
  sessionTitlesReady,
  sessionViewCache,
  SESSIONS_BYTES_MAX_IDS,
  SESSIONS_DELETE_PLAN_TTL_MS,
  SESSIONS_VIEW_PAGE_SIZE,
  listSessionsForManage,
  loadDeletedSessions,
  name,
  resolveSessionBytesForIds,
  resolveSessionForDelete,
  rpcFailure,
  rpcTechnicalFailure,
  saveDeletedSessions,
  searchSessionsContent,
  sessionExists,
  sessionIsLive,
  viewSessionPage,
}) {
  return {
    'sessions-list': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const scope = payload?.scope === 'archived' || payload?.scope === 'deleted' ? payload.scope : 'all'
      try {
        await sessionTitlesReady
        const value = await listSessionsForManage(ctx, dshHome, scope, sessionTitleCache)
        // 已删除记录独立下发（供「已删除」筛选）：字段只为展示，绝不包含内容。
        return { ok: true, value }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-bytes': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const raw = Array.isArray(payload?.ids) ? payload.ids : []
      const ids = []
      const seen = new Set()
      for (const id of raw) {
        if (typeof id !== 'string' || id === '' || seen.has(id)) continue
        seen.add(id)
        ids.push(id)
        if (ids.length >= SESSIONS_BYTES_MAX_IDS) break
      }
      if (ids.length === 0) return { ok: false, error: 'invalid-session-ids' }
      try {
        // 安全教义：id 只用来在宿主 listSessions 结果里查找头信息，定位/统计路径全部来自
        // 宿主侧记录（locate），浏览器不提供任何路径。
        return { ok: true, value: { bytes: await resolveSessionBytesForIds(ctx, ids, sessionBytesCache) } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-view': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      const cursor = typeof payload?.cursor === 'number' && Number.isFinite(payload.cursor) ? payload.cursor : undefined
      const center = typeof payload?.center === 'number' && Number.isSafeInteger(payload.center) ? payload.center : undefined
      try {
        return await viewSessionPage(ctx, id, cursor, sessionViewCache, SESSIONS_VIEW_PAGE_SIZE, center)
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-search': { feature: 'sessionManager', handle: async (payload, rpcEndpoint) => {
      const query = typeof payload?.query === 'string' ? payload.query : ''
      const scope = payload?.scope === 'archived' ? 'archived' : 'all'
      try {
        await sessionTitlesReady
        return { ok: true, value: await searchSessionsContent(ctx, dshHome, query, scope, sessionTitleCache) }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-export': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      try {
        if (!(await sessionExists(ctx, id))) return { ok: false, error: 'session-not-found' }
        // 复用官方 ZIP 导出路由：浏览器半下载同源 URL（含子代理+附件），宿主不自己拼包。
        const url = `/api/session.export?sessionId=${encodeURIComponent(id)}&includeDescendants=true`
        return { ok: true, value: { url, includesDescendants: true } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-archive': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      const workspaceRegistry = ctx.get('workspaceRegistry')
      if (workspaceRegistry === undefined || typeof workspaceRegistry.archiveSession !== 'function') return { ok: false, error: 'workspace-unavailable' }
      try {
        await workspaceRegistry.archiveSession(id)
        return {
          ok: true,
          value: {
            archived: true,
            archivedSessionIds: Array.isArray(workspaceRegistry.archivedSessionIds) ? [...workspaceRegistry.archivedSessionIds] : [id],
          },
        }
      } catch (error) {
        if (error?.name === 'WorkspaceUnknownSessionError') return { ok: false, error: 'session-not-found' }
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-unarchive': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      const workspaceRegistry = ctx.get('workspaceRegistry')
      if (workspaceRegistry === undefined) return { ok: false, error: 'workspace-unavailable' }
      if (typeof workspaceRegistry.unarchiveSession !== 'function') return { ok: false, error: 'unarchive-unsupported' }
      try {
        await workspaceRegistry.unarchiveSession(id)
        return {
          ok: true,
          value: {
            archived: false,
            archivedSessionIds: Array.isArray(workspaceRegistry.archivedSessionIds) ? [...workspaceRegistry.archivedSessionIds] : [],
          },
        }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-delete-plan': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (id === '') return { ok: false, error: 'invalid-session-id' }
      try {
        // 安全教义：只接受宿主列表返回的 id（白名单校验），且必须已归档、非 live。
        // 只定位目标会话 + stat 目标目录，不做全量列表重扫（v0.35 用户反馈：此前
        // 复用 listSessionsForManage 会对每个会话 readdir+stat，会话多时确认要等好几秒）。
        const record = await resolveSessionForDelete(ctx, id)
        if (record === undefined) return { ok: false, error: 'session-not-found' }
        if (record.live) return { ok: false, error: 'live-session-rejected' }
        if (!record.archived) return { ok: false, error: 'session-not-archived' }
        const planId = randomUUID()
        sessionDeletePlans.set(planId, { id, title: record.title, cwd: record.cwd, dir: record.dir, bytes: record.bytes, expires: Date.now() + SESSIONS_DELETE_PLAN_TTL_MS })
        return {
          ok: true,
          value: {
            planId,
            session: {
              id,
              title: record.title,
              cwd: record.cwd,
              bytes: record.bytes,
              archived: true,
            },
            // 归档会话早已从官方侧栏隐藏；删除只移除其日志，保留 archivedSessionIds 死 id。
            consequences: ['deletes-session-log'],
          },
        }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }

    } },
    'sessions-delete': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const planId = typeof payload?.planId === 'string' ? payload.planId : ''
      const plan = sessionDeletePlans.get(planId)
      if (plan === undefined) return { ok: false, error: 'unknown-delete-plan' }
      sessionDeletePlans.delete(planId)
      if (Date.now() > plan.expires) return { ok: false, error: 'delete-plan-expired' }
      try {
        // 执行前复检：计划期间会话可能被拉起或从归档集合移除，两种情况都拒绝。
        if (sessionIsLive(ctx, plan.id)) return { ok: false, error: 'live-session-rejected' }
        const archivedIds = ctx.get('workspaceRegistry')?.archivedSessionIds
        if (!Array.isArray(archivedIds) || !archivedIds.includes(plan.id)) return { ok: false, error: 'session-not-archived' }
        // 先持久化删除记录，再执行不可逆 rm；侧车写失败时日志保持原样。
        const deleted = await loadDeletedSessions(dshHome)
        const previousDeleted = { version: deleted.version, items: [...deleted.items] }
        deleted.items = deleted.items.filter((item) => item.id !== plan.id)
        deleted.items.push({ id: plan.id, title: plan.title, cwd: plan.cwd ?? null, deletedAt: Date.now() })
        await saveDeletedSessions(dshHome, deleted)
        try {
          await rm(plan.dir, { recursive: true, force: true })
        } catch (error) {
          try {
            await saveDeletedSessions(dshHome, previousDeleted)
          } catch (rollbackError) {
            throw new Error(`${error?.message || String(error)}; deleted-record rollback failed: ${rollbackError?.message || String(rollbackError)}`)
          }
          throw error
        }
        sessionBytesCache.delete(plan.id)
        if (sessionViewCache.id === plan.id) sessionViewCache.id = null
        // 同步官方侧（不然要刷新浏览器才正确）：官方客户端会话列表只吃 session/disposed
        // 派生的 api-session/removed（该事件在官方远程事件 allowlist 内），而插件是在官方
        // API 之外 rm 日志目录——不补发这条事件，官方侧栏与「已归档会话」页会一直留着幽灵行。
        // 旧版宿主没有对应监听器时纯等于空操作；监听器抛错也不能反过来把已落盘的删除报成失败
        // （与 file-write 的 fs/observed 广播同口径）。
        try { ctx.emit('api-session/removed', plan.id) } catch (_) {}
        // 归档集合里的死 id 一并清掉：官方归档页把「集合里有、会话已不在」的条目渲染成
        // 「这里没有可恢复的已归档会话」，死 id 留着会让该页永远停在不可恢复态。官方自己的
        // 「取消归档」对死 id 也是移除（幂等、无存在性校验），语义一致；删不掉不影响删除结果。
        const registry = ctx.get('workspaceRegistry')
        if (registry !== undefined && typeof registry.unarchiveSession === 'function') {
          try { await registry.unarchiveSession(plan.id) } catch (_) {}
        }
        return { ok: true, value: { deleted: true, id: plan.id } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }
    } },
    'sessions-clear-deleted': { feature: 'sessionManager', audit: true, handle: async (payload, rpcEndpoint) => {
      const all = payload?.all === true
      const raw = Array.isArray(payload?.ids) ? payload.ids : []
      const ids = []
      const seen = new Set()
      for (const id of raw) {
        if (typeof id !== 'string' || id.trim() === '') continue
        const cleanId = id.trim()
        if (seen.has(cleanId)) continue
        seen.add(cleanId)
        ids.push(cleanId)
      }
      if (!all && ids.length === 0) return rpcFailure(new Error('invalid-session-ids'))
      try {
        const deleted = await loadDeletedSessions(dshHome)
        let removedCount = 0
        const removedIds = []
        if (all) {
          removedCount = deleted.items.length
          for (const item of deleted.items) removedIds.push(item.id)
          deleted.items = []
        } else {
          const targetSet = new Set(ids)
          const remaining = []
          for (const item of deleted.items) {
            if (targetSet.has(item.id)) {
              removedCount++
              removedIds.push(item.id)
            } else {
              remaining.push(item)
            }
          }
          deleted.items = remaining
        }
        if (removedCount > 0) {
          await saveDeletedSessions(dshHome, deleted)
        }
        if (sessionTitleCache !== null) {
          for (const id of removedIds) sessionTitleCache.delete(id)
        }
        return { ok: true, value: { cleared: true, count: removedCount, ids: removedIds } }
      } catch (error) {
        return rpcTechnicalFailure(error)
      }
    } },
  }
}
