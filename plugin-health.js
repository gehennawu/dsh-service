// Host deep module: plugin health check for the diagnostics feature (v1.3).
//
// 数据源（v1.3 真机探针核实，详见 KNOWLEDGE.md）：
//   - `ctx.get('loader').entries()` 返回全部已注册 Loader 条目（官方 @deepseek-ai/* 与第三方
//     自定义插件同列；group 条目是文件夹，跳过）。每条目：id / options.name（模块说明符）/
//     options.group / disabled（含祖先组禁用）/ fiber（启用时存在）。
//   - `fiber.state`：0 pending（等待依赖）/ 1 loading / 2 active / 3 failed / 4 disposed /
//     5 unloading；`fiber.inject` = 声明依赖的服务名 Dict；`fiber.store` = 已满足依赖的 Impl
//     快照（ACTIVE 时含全部 inject 键，缺失键即依赖未就绪）；`fiber._error` = fail 原因。
//
// 口径（用户点名：只要「检查是否有插件异常」；官方设置页已有完整插件清单与开关，
// 本功能不做重复清单）：
//   - 停用条目（disabled，无论内置还是自定义）一律不算异常、不进任何统计文案；
//   - failed → error；pending（等待依赖）/ loading / unloading → warning；
//   - 只把「异常」条目下发（issues），正常插件客户端不渲染，也不需要版本/归属等元数据。
//
// 本模块只做数据收集与纯函数变换：不注册任何服务/事件，生命周期全部由 index.js 的
// RPC 装配层托管；无浏览器输入，entryId 只接受宿主 loader 列出的条目。

/** Cordis FiberState 数值常量（跨包 const enum 的运行时镜像；真机核实与 provider 一致）。 */
export const PLUGIN_FIBER_STATE = Object.freeze({
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
})

/** 异常相位 → 检查项等级：失败是真故障（error），依赖未就绪/加载中按 warning 提示。 */
export function issueLevelOf(phase) {
  switch (phase) {
    case 'failed': return 'error'
    case 'pending':
    case 'loading':
    case 'unloading': return 'warning'
    default: return null
  }
}

/** fiber.state 数值 → 相位串；未知/无 fiber 一律按加载中（瞬态/声明未挂载）。 */
function phaseOfState(state) {
  switch (state) {
    case PLUGIN_FIBER_STATE.PENDING: return 'pending'
    case PLUGIN_FIBER_STATE.LOADING: return 'loading'
    case PLUGIN_FIBER_STATE.ACTIVE: return 'active'
    case PLUGIN_FIBER_STATE.FAILED: return 'failed'
    case PLUGIN_FIBER_STATE.UNLOADING: return 'unloading'
    default: return 'loading'
  }
}

/**
 * 收集插件健康体检结果。
 *
 * @param ctx 宿主插件上下文（供 `ctx.get('loader')`）
 * @returns {available: boolean, total: number, issues: PluginIssue[]}——loader 缺席时
 *   available=false（调用方降级为 info 检查项，不含任何插件数据）。
 */
export async function collectPluginHealth(ctx) {
  const loader = ctx.get('loader')
  if (loader === undefined) return { available: false, total: 0, issues: [] }
  const issues = []
  let total = 0
  for (const entry of loader.entries()) {
    if (entry?.options?.group === true) continue
    const moduleName = entry?.options?.name
    if (typeof entry?.id !== 'string' || typeof moduleName !== 'string') continue
    // 停用是用户的显式选择（官方插件页的开关），无论内置还是自定义都不算异常。
    if (entry.disabled === true) continue
    total += 1
    const fiber = entry.fiber
    const phase = fiber === undefined ? 'loading' : phaseOfState(fiber.state)
    if (phase === 'active') continue
    const error = phase === 'failed' && fiber?._error != null
      ? String(fiber._error?.message || fiber._error)
      : null
    const missingDeps = phase === 'pending'
      ? Object.keys(fiber.inject || {}).filter((key) => !(fiber.store !== undefined && fiber.store[key]))
      : []
    issues.push({
      entryId: entry.id,
      moduleName,
      phase,
      ...(error === null ? {} : { error }),
      ...(missingDeps.length > 0 ? { missingDeps } : {}),
    })
  }
  return { available: true, total, issues }
}

/**
 * 聚合为一个诊断检查项（追加在 checks 尾部）。detail 三段 `total:failed:pending`：
 * 客户端用它渲染「共 N 个插件，全部正常」或异常摘要；停用插件完全不进统计
 * （failed 是 error，其余异常相位归 pending 桶按 warning 处理）。
 */
export function pluginCheckItem(report) {
  const failed = report.issues.filter((issue) => issue.phase === 'failed').length
  const pending = report.issues.filter((issue) => issue.phase !== 'failed').length
  return {
    id: 'plugins',
    status: failed > 0 ? 'error' : pending > 0 ? 'warning' : 'ok',
    detail: `${report.total}:${failed}:${pending}`,
  }
}

/**
 * 重新加载一个 failed 插件的 fiber（唯一的修复动作——只对已失败条目生效，绝不打扰
 * 正在运行/等待依赖的插件）。entryId 只接受宿主 loader 实际列出的条目 id；其余一律
 * 稳定错误码拒绝。
 *
 * @returns {ok: true} 或 {ok: false, code, error?}；code ∈
 *   unknown-plugin / loader-unavailable / plugin-disabled / not-failed / restart-failed。
 */
export async function restartPluginEntry(ctx, entryId) {
  if (typeof entryId !== 'string' || entryId.length === 0 || entryId.length > 256) return { ok: false, code: 'unknown-plugin' }
  const loader = ctx.get('loader')
  if (loader === undefined) return { ok: false, code: 'loader-unavailable' }
  let target
  for (const entry of loader.entries()) {
    if (entry?.options?.group === true) continue
    if (entry.id === entryId) {
      target = entry
      break
    }
  }
  if (target === undefined) return { ok: false, code: 'unknown-plugin' }
  if (target.disabled) return { ok: false, code: 'plugin-disabled' }
  const fiber = target.fiber
  if (fiber === undefined || fiber.state !== PLUGIN_FIBER_STATE.FAILED) return { ok: false, code: 'not-failed' }
  try {
    await fiber.restart()
  } catch (error) {
    // 重启后仍失败；错误原文交给客户端透出，等待下一次「重新诊断」落定新状态。
    return { ok: false, code: 'restart-failed', error: String(error?.message || error) }
  }
  return { ok: true }
}