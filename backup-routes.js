// 备份与恢复（backup）的 RPC 端点：从 apply 的端点表按功能域拆出。
// 依赖显式注入（工厂解构名单即本模块完整依赖面）；handler 体与拆分前逐字一致。
// 注意：客户端半有单产物约束，宿主半无此约束——兄弟 ESM 模块是本仓库既有惯例
// （quota-adapters.js / backup-integrity.js / plugin-health.js / plugin-compat.js）。

import { createBackupIntegrity } from './backup-integrity.js'
import { join } from 'node:path'

export function createBackupRoutes({
  ctx,
  backupIntegrity,
  backupProgress,
  clearBackupProgress,
  downloadTokens,
  dshHome,
  setBackupProgress,
  withBackupLock,
  createBackup,
  deleteBackup,
  exportBackup,
  formatBackupTimestamp,
  importBackup,
  listBackups,
  name,
  rpcFailure,
}) {
  return {
    'backup-list': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await listBackups(dshHome) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-progress': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      return { ok: true, value: { ...backupProgress } }

    } },
    'backup-create': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await withBackupLock(() => {
          const name = `dsh-backup-${formatBackupTimestamp(new Date())}.tar.gz`
          const withValidator = async (source, task) => {
            const validator = createBackupIntegrity({ dshHome, resolveBackup: async () => source })
            try { return await task(validator) } finally { await validator.dispose() }
          }
          return createBackup(ctx, dshHome, join(dshHome, 'backups'), name, async (source) => {
            return withValidator(source, (validator) => validator.inspectBackup(source.id))
          }, setBackupProgress, async (source, root) => {
            return withValidator(source, (validator) => validator.verifyArchivedTree(source, root))
          }).finally(clearBackupProgress)
        }) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-export': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const value = await exportBackup(dshHome, downloadTokens, payload?.id)
        if (value === undefined) return rpcFailure(new Error('unknown-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-delete': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const value = await deleteBackup(dshHome, payload?.id)
        if (value === undefined) return rpcFailure(new Error('unknown-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-inspect': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      try {
        const value = await backupIntegrity.inspectBackup(payload?.id)
        if (value === undefined) return rpcFailure(new Error('unknown-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-restore-prepare': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await backupIntegrity.prepareRestore(payload?.id) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-restore-commit': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        return { ok: true, value: await backupIntegrity.commitRestore(payload?.planId) }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
    'backup-restore': { feature: 'backupMaintenance', handle: async (payload, rpcEndpoint) => {
      return rpcFailure(new Error('restore-preflight-required'))

    } },
    'backup-import': { feature: 'backupMaintenance', audit: true, handle: async (payload, rpcEndpoint) => {
      try {
        const value = await importBackup(dshHome, payload?.name, payload?.data, async (source) => {
          const validator = createBackupIntegrity({ dshHome, resolveBackup: async () => source })
          try { return await validator.inspectBackup(source.id) } finally { await validator.dispose() }
        })
        if (value === undefined) return rpcFailure(new Error('invalid-backup'))
        return { ok: true, value }
      } catch (error) {
        return rpcFailure(error)
      }

    } },
  }
}
