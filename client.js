// Browser half of @gehennawu/dsh-service
// 设置面板「服务控制」：版本信息 + 检查更新 + 一键重启
window.__ModuleLoader__.load({
  id: '@gehennawu/dsh-service',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const NS = 'dsh-service'
    const zh = {
      'nav.label': '服务控制',
      'overlay.label': '服务重启状态',
      'recovery.waiting.title': '服务重启中…',
      'recovery.waiting.body': '正在等待新的 DSH Web 进程启动，已等待 {seconds} 秒。',
      'recovery.timeout.title': '服务尚未恢复',
      'recovery.timeout.body': '已等待 60 秒。请确认外部进程管理器已正确配置，或手动刷新页面重试。',
      'recovery.manual': '手动刷新',
      'health.title': '运行状况',
      'health.uptime': '运行时间',
      'health.rss': '内存 RSS',
      'health.liveSessions': '存活会话',
      'health.persistedSessions': '持久化会话',
      'health.activeAgents': '活跃 Agent',
      'health.activeJobs': '后台任务',
      'health.uptimeValue': '{hours} 小时 {minutes} 分钟',
      'health.error': '无法读取运行状况',
      'health.check': '立即健康检查',
      'health.checking': '检查中…',
      'health.overall.ok': '正常',
      'health.overall.warning': '警告',
      'health.overall.error': '错误',
      'health.alert.title': '健康提醒',
      'health.alert.diagnostics': '检查结果存在{status}，请查看下方异常项。',
      'health.status.ok': '正常',
      'health.status.warning': '警告',
      'health.status.error': '错误',
      'health.status.info': '信息',
      'health.check.session-storage': '会话存储',
      'health.check.workspace-registry': '工作区注册表',
      'health.check.dsh-home': 'DSH_HOME',
      'health.check.backup-storage': '备份存储',
      'health.check.tar': 'tar',
      'health.check.permissions': '文件权限',
      'permissions.title': '文件权限',
      'permissions.description': '检查 DSH_HOME 和全部工作区的属主与权限。修复会设置目录 755、普通文件 644，并强制凭据文件保持 600。',
      'permissions.target': '目标属主：{owner}',
      'permissions.repair': '修复权限',
      'permissions.repairing': '修复中…',
      'permissions.confirm': '确认修复',
      'permissions.confirmHint': '将递归修改以上目录的属主和权限。请确认当前值后再继续。',
      'permissions.cancel': '取消',
      'permissions.error': '权限操作失败',
      'permissions.summary.ok': '{count} 个根目录检查正常',
      'permissions.summary.warning': '发现 {count} 个根目录异常',
      'permissions.showDetails': '查看详情',
      'permissions.hideDetails': '隐藏详情',
      'permissions.deep': '深度检查',
      'permissions.deepChecking': '扫描中…',
      'permissions.deepSummary': '扫描 {scanned} 项，用时 {duration} ms；属主异常 {owner}，目录权限异常 {directories}，文件权限异常 {files}，无法读取 {unreadable}。',
      'backup.title': '备份管理',
      'backup.description': '备份会话、配置和插件 profile 清单；不会包含 node_modules 或凭据。备份不会自动清理，请自行管理磁盘空间。',
      'backup.create': '创建备份',
      'backup.creating': '创建中…',
      'backup.total': '总体积：{size}',
      'backup.empty': '还没有备份。',
      'backup.delete': '删除',
      'backup.confirm': '确认删除',
      'backup.confirmHint': '确认删除这个备份？此操作无法撤销。',
      'backup.cancel': '取消',
      'backup.error': '备份操作失败',
      'backup.showRecords': '备份记录',
      'backup.hideRecords': '隐藏备份记录',
      'version.title': '版本信息',
      'version.current': 'DSH：',
      'version.plugin': 'dsh-service：',
      'version.loading': '加载中…',
      'update.check': '检查更新',
      'update.checking': '检查中…',
      'update.current': '✓ 已是最新版本',
      'update.available': '有新版本可用：{version}',
      'update.badge': 'DSH 有更新',
      'update.details.title': 'DSH 更新可用',
      'update.details.current': '当前版本：{version}',
      'update.details.latest': '最新版本：{version}',
      'update.details.close': '关闭',
      'restart.title': '服务重启',
      'restart.description': '重启 dsh web 服务进程：运行中的任务会中断，持久化的会话可恢复。',
      'restart.button': '重启 dsh web',
      'restart.sending': '发送中…',
      'restart.confirm': '确认重启',
      'restart.force': '仍要重启',
      'restart.cancel': '取消',
      'restart.sent': '重启指令已发出。',
      'restart.sentHint': '页面连接即将断开，服务恢复后将自动刷新。',
      'restart.idleHint': '当前没有检测到运行中的工作。确认后将断开连接，等待服务自动重启。',
      'activity.agent': 'Agent',
      'activity.job': '后台任务',
      'activity.terminal': '终端',
      'activity.warning': '检测到 {count} 项运行中的工作，重启会立即中断它们。',
      'activity.item': '{type}：{label} ({status})',
      'error.update': '检查失败',
      'error.activity': '检查运行状态失败',
      'error.restart': '重启失败',
      'error.instance': '重启响应缺少进程实例标识',
      'usage.title': '模型使用',
      'usage.refresh': '刷新统计',
      'usage.refreshing': '刷新中…',
      'usage.empty': '尚未建立使用统计索引。点击刷新统计开始只读建立索引。',
      'usage.error': '无法读取模型使用统计',
      'usage.allProjects': '全部项目',
      'usage.steps': '成功模型步骤',
      'usage.input': '输入 Token',
      'usage.output': '输出 Token',
      'usage.cache': '缓存 Token',
      'usage.hitRate': '缓存命中率',
      'usage.today': '今天',
      'usage.sevenDays': '近 7 天',
      'usage.missing': '{count} 个步骤没有 Token 数据',
      'usage.errors.title': '模型报错',
      'usage.errors.toggle': '模型报错（{count} 类）',
      'usage.errors.recent': '最近 24 小时',
      'usage.errors.empty': '最近 24 小时没有记录到模型报错。',
      'usage.toolErrors.title': '工具报错',
      'usage.toolErrors.toggle': '工具报错（{count} 类）',
      'usage.toolErrors.empty': '最近 24 小时没有记录到工具报错。',
      'usage.errors.count': '{count} 次',
    }
    const en = {
      'nav.label': 'Service Control',
      'overlay.label': 'Service restart status',
      'recovery.waiting.title': 'Restarting service…',
      'recovery.waiting.body': 'Waiting for a new DSH Web process. Elapsed: {seconds} seconds.',
      'recovery.timeout.title': 'Service has not recovered',
      'recovery.timeout.body': 'Waited 60 seconds. Check the external process manager, or refresh the page manually.',
      'recovery.manual': 'Manual reload',
      'health.title': 'Health',
      'health.uptime': 'Uptime',
      'health.rss': 'Memory RSS',
      'health.liveSessions': 'Live sessions',
      'health.persistedSessions': 'Persisted sessions',
      'health.activeAgents': 'Active agents',
      'health.activeJobs': 'Background jobs',
      'health.uptimeValue': '{hours} h {minutes} min',
      'health.error': 'Could not read health metrics',
      'health.check': 'Run health check',
      'health.checking': 'Checking…',
      'health.overall.ok': 'Healthy',
      'health.overall.warning': 'Warning',
      'health.overall.error': 'Error',
      'health.alert.title': 'Health alert',
      'health.alert.diagnostics': 'The health check reported {status}. Review the affected items below.',
      'health.status.ok': 'Healthy',
      'health.status.warning': 'Warning',
      'health.status.error': 'Error',
      'health.status.info': 'Info',
      'health.check.session-storage': 'Session storage',
      'health.check.workspace-registry': 'Workspace registry',
      'health.check.dsh-home': 'DSH_HOME',
      'health.check.backup-storage': 'Backup storage',
      'health.check.tar': 'tar',
      'health.check.permissions': 'File permissions',
      'permissions.title': 'File permissions',
      'permissions.description': 'Checks ownership and modes across DSH_HOME and every workspace. Repair sets directories to 755, regular files to 644, and always keeps the credentials file at 600.',
      'permissions.target': 'Target owner: {owner}',
      'permissions.repair': 'Repair permissions',
      'permissions.repairing': 'Repairing…',
      'permissions.confirm': 'Confirm repair',
      'permissions.confirmHint': 'This will recursively modify ownership and permissions for every directory above. Review the current values before continuing.',
      'permissions.cancel': 'Cancel',
      'permissions.error': 'Permission operation failed',
      'permissions.summary.ok': '{count} root path(s) passed the check',
      'permissions.summary.warning': '{count} root path(s) need attention',
      'permissions.showDetails': 'Show details',
      'permissions.hideDetails': 'Hide details',
      'permissions.deep': 'Deep check',
      'permissions.deepChecking': 'Scanning…',
      'permissions.deepSummary': 'Scanned {scanned} entries in {duration} ms; owner issues {owner}, directory mode issues {directories}, file mode issues {files}, unreadable {unreadable}.',
      'backup.title': 'Backup management',
      'backup.description': 'Backs up sessions, configuration, and plugin profile manifests. Credentials and node_modules are excluded. Backups are never auto-pruned; you are responsible for disk usage.',
      'backup.create': 'Create backup',
      'backup.creating': 'Creating…',
      'backup.total': 'Total size: {size}',
      'backup.empty': 'No backups yet.',
      'backup.delete': 'Delete',
      'backup.confirm': 'Confirm delete',
      'backup.confirmHint': 'Delete this backup? This cannot be undone.',
      'backup.cancel': 'Cancel',
      'backup.error': 'Backup operation failed',
      'backup.showRecords': 'Backup records',
      'backup.hideRecords': 'Hide backup records',
      'version.title': 'Version information',
      'version.current': 'DSH: ',
      'version.plugin': 'dsh-service: ',
      'version.loading': 'Loading…',
      'update.check': 'Check for updates',
      'update.checking': 'Checking…',
      'update.current': '✓ Up to date',
      'update.available': 'New version available: {version}',
      'update.badge': 'DSH update',
      'update.details.title': 'DSH update available',
      'update.details.current': 'Current version: {version}',
      'update.details.latest': 'Latest version: {version}',
      'update.details.close': 'Close',
      'restart.title': 'Service restart',
      'restart.description': 'Restart the dsh web process. Active work will be interrupted; persisted sessions can be resumed.',
      'restart.button': 'Restart dsh web',
      'restart.sending': 'Sending…',
      'restart.confirm': 'Confirm restart',
      'restart.force': 'Force restart',
      'restart.cancel': 'Cancel',
      'restart.sent': 'Restart request sent.',
      'restart.sentHint': 'The connection will close shortly. The page will reload automatically after recovery.',
      'restart.idleHint': 'No active work was detected. Confirm to disconnect and wait for the service to restart.',
      'activity.agent': 'Agent',
      'activity.job': 'Background job',
      'activity.terminal': 'Terminal',
      'activity.warning': 'Detected {count} active item(s). Restarting will interrupt them immediately.',
      'activity.item': '{type}: {label} ({status})',
      'error.update': 'Update check failed',
      'error.activity': 'Could not check active work',
      'error.restart': 'Restart failed',
      'error.instance': 'Restart response is missing the process instance ID',
      'usage.title': 'Model usage',
      'usage.refresh': 'Refresh usage',
      'usage.refreshing': 'Refreshing…',
      'usage.empty': 'No usage index yet. Select Refresh usage to build the read-only index.',
      'usage.error': 'Could not read model usage',
      'usage.allProjects': 'All projects',
      'usage.steps': 'Successful model steps',
      'usage.input': 'Input tokens',
      'usage.output': 'Output tokens',
      'usage.cache': 'Cache tokens',
      'usage.hitRate': 'Cache hit rate',
      'usage.today': 'Today',
      'usage.sevenDays': 'Last 7 days',
      'usage.missing': '{count} step(s) have no token data',
      'usage.errors.title': 'Model errors',
      'usage.errors.toggle': 'Model errors ({count} types)',
      'usage.errors.recent': 'Last 24 hours',
      'usage.errors.empty': 'No model errors were recorded in the last 24 hours.',
      'usage.toolErrors.title': 'Tool errors',
      'usage.toolErrors.toggle': 'Tool errors ({count} types)',
      'usage.toolErrors.empty': 'No tool errors were recorded in the last 24 hours.',
      'usage.errors.count': '{count} occurrence(s)',
    }

    const inject = ['slots', 'connection', 'timer', 'locale']

    function apply(ctx) {
      const { useState, useEffect } = React
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-service dictionaries')
      const t = ctx.locale.bind(NS)
      const useTranslation = () => {
        const [, setSnapshot] = useState(ctx.locale.getSnapshot())
        useEffect(() => ctx.locale.subscribe(() => setSnapshot(ctx.locale.getSnapshot())), [])
        return t
      }
      const recoveryListeners = new Set()
      const updateListeners = new Set()
      let recoveryState = { status: 'idle', elapsedMs: 0 }
      let recoveryGeneration = 0
      let availableUpdate = null
      let updateDetailsOpen = false

      const setRecoveryState = (next) => {
        recoveryState = next
        for (const listener of recoveryListeners) listener(next)
      }

      const publishUpdateState = () => {
        const snapshot = { update: availableUpdate, open: updateDetailsOpen }
        for (const listener of updateListeners) listener(snapshot)
      }
      const setAvailableUpdate = (value) => {
        availableUpdate = value
        if (value === null) updateDetailsOpen = false
        publishUpdateState()
      }
      const setUpdateDetailsOpen = (open) => {
        updateDetailsOpen = open === true
        publishUpdateState()
      }
      const useUpdateState = () => {
        const [snapshot, setSnapshot] = useState({ update: availableUpdate, open: updateDetailsOpen })
        useEffect(() => {
          updateListeners.add(setSnapshot)
          setSnapshot({ update: availableUpdate, open: updateDetailsOpen })
          return () => updateListeners.delete(setSnapshot)
        }, [])
        return snapshot
      }

      const useRecoveryState = () => {
        const [snapshot, setSnapshot] = useState(recoveryState)
        useEffect(() => {
          recoveryListeners.add(setSnapshot)
          setSnapshot(recoveryState)
          return () => recoveryListeners.delete(setSnapshot)
        }, [])
        return snapshot
      }

      const startRecovery = async (previousInstanceId) => {
        const generation = ++recoveryGeneration
        let elapsedMs = 0
        let delayMs = 1000
        setRecoveryState({ status: 'waiting', elapsedMs })

        while (elapsedMs < 60000 && generation === recoveryGeneration) {
          const waitMs = Math.min(delayMs, 60000 - elapsedMs)
          try {
            await ctx.timer.timeout(waitMs)
          } catch (_) {
            return
          }
          if (generation !== recoveryGeneration) return

          elapsedMs += waitMs
          setRecoveryState({ status: 'waiting', elapsedMs })
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'version', {})
            const nextInstanceId = res && res.ok ? res.value && res.value.instanceId : undefined
            if (typeof nextInstanceId === 'string' && nextInstanceId.length > 0 && nextInstanceId !== previousInstanceId) {
              window.location.reload()
              return
            }
          } catch (_) {}

          if (elapsedMs >= 60000) {
            setRecoveryState({ status: 'timeout', elapsedMs })
            return
          }
          delayMs = Math.min(delayMs * 2, 10000)
        }
      }

      ctx.effect(() => () => {
        recoveryGeneration += 1
        recoveryListeners.clear()
        updateListeners.clear()
      }, 'dsh-service recovery')

      function UpdateBadge() {
        const state = useUpdateState()
        const translate = useTranslation()
        if (state.update === null) return null
        return React.createElement('button', {
          type: 'button',
          onClick: () => setUpdateDetailsOpen(true),
          style: { margin: '4px', padding: '5px 8px', borderRadius: '999px', border: 0, background: '#d80', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 600 },
        }, translate('update.badge'))
      }

      function ServiceOverlay() {
        const recovery = useRecoveryState()
        const updateState = useUpdateState()
        const translate = useTranslation()
        if (recovery.status === 'idle' && !updateState.open) return null
        if (recovery.status === 'idle') {
          const update = updateState.update
          if (update === null) return null
          return React.createElement('div', {
            style: { position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(12, 14, 20, 0.72)', backdropFilter: 'blur(4px)', pointerEvents: 'auto' },
          }, React.createElement('div', {
            style: { width: 'min(420px, 100%)', padding: '24px', borderRadius: '12px', background: 'var(--color-background, #fff)', color: 'var(--color-foreground, #222)', boxShadow: '0 18px 60px rgba(0,0,0,0.35)', textAlign: 'center' },
          },
          React.createElement('div', { style: { fontSize: '18px', fontWeight: 700, marginBottom: '10px' } }, translate('update.details.title')),
          React.createElement('p', { style: { margin: '4px 0', fontSize: '13px' } }, translate('update.details.current', { version: update.current })),
          React.createElement('p', { style: { margin: '4px 0', fontSize: '13px' } }, translate('update.details.latest', { version: update.latest })),
          React.createElement('button', { style: { marginTop: '16px', padding: '7px 16px', borderRadius: '6px', border: 0, background: '#5B4CF0', color: '#fff', cursor: 'pointer' }, onClick: () => setUpdateDetailsOpen(false) }, translate('update.details.close'))))
        }

        const timedOut = recovery.status === 'timeout'
        return React.createElement('div', {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(12, 14, 20, 0.72)',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'auto',
          },
        },
        React.createElement('div', {
          style: {
            width: 'min(420px, 100%)',
            padding: '24px',
            borderRadius: '12px',
            background: 'var(--color-background, #fff)',
            color: 'var(--color-foreground, #222)',
            boxShadow: '0 18px 60px rgba(0,0,0,0.35)',
            textAlign: 'center',
          },
        },
        React.createElement('div', { style: { fontSize: '18px', fontWeight: 700, marginBottom: '10px' } },
          translate(timedOut ? 'recovery.timeout.title' : 'recovery.waiting.title')),
        React.createElement('p', { style: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: '#888' } },
          timedOut
            ? translate('recovery.timeout.body')
            : translate('recovery.waiting.body', { seconds: Math.floor(recovery.elapsedMs / 1000) })),
        timedOut
          ? React.createElement('button', {
              style: { marginTop: '16px', padding: '7px 16px', borderRadius: '6px', border: 0, background: '#5B4CF0', color: '#fff', cursor: 'pointer' },
              onClick: () => window.location.reload(),
            }, translate('recovery.manual'))
          : null))
      }

      function RestartOverlay() {
        return React.createElement(ServiceOverlay, null)
      }

      function ServicePanel() {
        const translate = useTranslation()
        const [health, setHealth] = useState(null)
        const [healthError, setHealthError] = useState(null)
        const [diagnostics, setDiagnostics] = useState(null)
        const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
        const [permissions, setPermissions] = useState(null)
        const [permissionConfirm, setPermissionConfirm] = useState(false)
        const [permissionBusy, setPermissionBusy] = useState(false)
        const [permissionError, setPermissionError] = useState(null)
        const [permissionDetails, setPermissionDetails] = useState(false)
        const [permissionDeep, setPermissionDeep] = useState(null)
        const [permissionDeepBusy, setPermissionDeepBusy] = useState(false)
        const [backups, setBackups] = useState({ items: [], totalBytes: 0 })
        const [backupBusy, setBackupBusy] = useState(false)
        const [backupError, setBackupError] = useState(null)
        const [backupDeleteId, setBackupDeleteId] = useState(null)
        const [backupDetails, setBackupDetails] = useState(false)
        const [version, setVersion] = useState(null)
        const [pluginVersion, setPluginVersion] = useState(null)
        const [updateInfo, setUpdateInfo] = useState(null) // { latest, upToDate } | null
        const [updateBusy, setUpdateBusy] = useState(false)
        const [updateError, setUpdateError] = useState(null)
        const [usage, setUsage] = useState(null)
        const [usageBusy, setUsageBusy] = useState(false)
        const [usageError, setUsageError] = useState(null)
        const [usageMetric, setUsageMetric] = useState('inputTokens')
        const [usageProject, setUsageProject] = useState('all')
        const [modelErrorsOpen, setModelErrorsOpen] = useState(false)
        const [toolErrorsOpen, setToolErrorsOpen] = useState(false)
        // 重启状态：0=初始，1=普通确认，2=已发出，3=检测到活动工作
        const [stage, setStage] = useState(0)
        const [activity, setActivity] = useState(null)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)

        // 进入面板时拉取当前版本和健康快照；健康数据每 5 秒刷新，卸载即停止。
        useEffect(() => {
          ctx.connection.rpc.call('/dsh-service', 'version', {}).then((res) => {
            if (res && res.ok) {
              setVersion(res.value.current)
              setPluginVersion(res.value.pluginVersion || null)
            }
          }).catch(() => {})
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'check-update', {}).then((res) => {
            if (!active || !res || res.ok === false) return
            setUpdateInfo(res.value)
            setAvailableUpdate(res.value.upToDate ? null : res.value)
          }).catch(() => {})
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'permissions-plan', {}).then((res) => {
            if (active && res && res.ok) setPermissions(res.value)
          }).catch(() => {
            if (active) setPermissionError(translate('permissions.error'))
          })
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'usage', {}).then(async (res) => {
            if (!active || !res || !res.ok) return
            setUsage(res.value)
            if (res.value.updatedAt > 0 && Date.now() - res.value.updatedAt <= 300000) return
            try {
              const refreshed = await ctx.connection.rpc.call('/dsh-service', 'usage-refresh', {})
              if (active && refreshed && refreshed.ok) setUsage(refreshed.value)
            } catch (_) {}
          }).catch(() => {
            if (active) setUsageError(translate('usage.error'))
          })
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          ctx.connection.rpc.call('/dsh-service', 'backup-list', {}).then((res) => {
            if (active && res && res.ok) setBackups(res.value)
          }).catch(() => {
            if (active) setBackupError(translate('backup.error'))
          })
          return () => { active = false }
        }, [])
        useEffect(() => {
          let active = true
          let cancelNext = () => {}
          const poll = async () => {
            try {
              const res = await ctx.connection.rpc.call('/dsh-service', 'health', {})
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

        const runDiagnostics = async () => {
          setDiagnosticsBusy(true)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'diagnostics', {})
            if (!res || res.ok === false) throw new Error('diagnostics failed')
            setDiagnostics(res.value)
          } catch (_) {
            setHealthError(translate('health.error'))
          } finally {
            setDiagnosticsBusy(false)
          }
        }

        const refreshUsage = async () => {
          setUsageBusy(true)
          setUsageError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'usage-refresh', {})
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
            const res = await ctx.connection.rpc.call('/dsh-service', 'permissions-deep', { planId: permissions.planId })
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
            const res = await ctx.connection.rpc.call('/dsh-service', 'permissions-repair', { planId: permissions.planId })
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
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'backup-create', {})
            if (!res || res.ok === false) throw new Error('backup failed')
            setBackups({ items: res.value.items, totalBytes: res.value.totalBytes })
          } catch (_) {
            setBackupError(translate('backup.error'))
          } finally {
            setBackupBusy(false)
          }
        }

        const deleteBackup = async (id) => {
          setBackupBusy(true)
          setBackupError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'backup-delete', { id })
            if (!res || res.ok === false) throw new Error('backup failed')
            setBackups(res.value)
            setBackupDeleteId(null)
          } catch (_) {
            setBackupError(translate('backup.error'))
          } finally {
            setBackupBusy(false)
          }
        }

        const checkUpdate = async () => {
          setUpdateBusy(true)
          setUpdateError(null)
          setUpdateInfo(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'check-update', {})
            if (res && res.ok === false) {
              console.error('dsh-service: update check failed', res.error)
              throw new Error(translate('error.update'))
            }
            setUpdateInfo(res.value)
            setAvailableUpdate(res.value.upToDate ? null : res.value)
          } catch (err) {
            setUpdateError(err && err.message ? String(err.message) : String(err))
          } finally {
            setUpdateBusy(false)
          }
        }

        const checkRestart = async () => {
          setBusy(true)
          setError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'activity', {})
            if (res && res.ok === false) {
              console.error('dsh-service: activity check failed', res.error)
              throw new Error(translate('error.activity'))
            }
            const nextActivity = res && res.value ? res.value : { hasActive: false, items: [] }
            setActivity(nextActivity)
            setStage(nextActivity.hasActive ? 3 : 1)
          } catch (err) {
            setError(err && err.message ? String(err.message) : String(err))
            setStage(0)
          } finally {
            setBusy(false)
          }
        }

        const restart = async (force) => {
          setBusy(true)
          setError(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'web', { force: force === true })
            if (res && res.ok === false) {
              if (res.error === 'active-work' && res.value) {
                setActivity(res.value)
                setStage(3)
                return
              }
              console.error('dsh-service: restart failed', res.error)
              throw new Error(translate('error.restart'))
            }
            setStage(2)
            const previousInstanceId = res && res.value ? res.value.instanceId : undefined
            if (typeof previousInstanceId !== 'string' || previousInstanceId.length === 0) {
              throw new Error(translate('error.instance'))
            }
            startRecovery(previousInstanceId).catch((err) => console.error('dsh-service: recovery failed', err))
          } catch (err) {
            setError(err && err.message ? String(err.message) : String(err))
            setStage(0)
          } finally {
            setBusy(false)
          }
        }

        // 样式
        const btn = { padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.3)', cursor: 'pointer', fontSize: '13px' }
        const danger = Object.assign({}, btn, { background: '#d33', color: '#fff', borderColor: '#d33' })
        const plain = Object.assign({}, btn, { background: 'transparent' })
        const primary = Object.assign({}, btn, { background: '#5B4CF0', color: '#fff', borderColor: '#5B4CF0' })
        const info = Object.assign({}, btn, { background: 'rgba(43,108,176,0.12)', color: '#2b6cb0', borderColor: 'rgba(43,108,176,0.35)' })
        const toggle = Object.assign({}, btn, { background: 'rgba(128,128,128,0.08)', borderColor: 'transparent', padding: '7px 10px', width: '100%', textAlign: 'left', fontWeight: 600 })
        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }
        const hint = { color: '#888', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const card = { background: 'rgba(128,128,128,0.055)', border: '1px solid rgba(128,128,128,0.14)', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' }
        const displaySurface = { background: 'rgba(128,128,128,0.09)', borderRadius: '8px', padding: '10px', marginTop: '8px' }
        const sectionTitle = { fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: 'inherit' }

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
          style: { padding: '8px 10px', borderRadius: '6px', background: 'rgba(128,128,128,0.08)' },
        },
        React.createElement('div', { style: { color: '#888', fontSize: '11px', marginBottom: '2px' } }, translate(labelKey)),
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
        const usageMetrics = [
          ['steps', 'usage.steps'],
          ['inputTokens', 'usage.input'],
          ['outputTokens', 'usage.output'],
          ['cacheTokens', 'usage.cache'],
          ['cacheHitRate', 'usage.hitRate'],
        ]
        const usageTotalsFor = (day) => {
          const source = usage && usage.days ? usage.days[day] : null
          if (!source) return { steps: 0, missingUsage: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0 }
          if (usageProject === 'all') return source.totals
          const project = source.projects.find((item) => item.id === usageProject)
          return project ? project.totals : { steps: 0, missingUsage: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheHitRate: 0 }
        }
        const usageValue = (totals) => usageMetric === 'cacheTokens'
          ? totals.cacheReadTokens + totals.cacheWriteTokens
          : totals[usageMetric] || 0
        const formatUsageValue = (value, metricName) => metricName === 'cacheHitRate'
          ? (Number(value) * 100).toFixed(1) + '%'
          : Number(value).toLocaleString()
        const chartValues = usageDays.map((day) => usageValue(usageTotalsFor(day.key)))
        const chartMax = Math.max(1, ...chartValues)
        const todayTotals = usageTotalsFor(usageDays[6].key)
        const sevenTotals = usageDays.reduce((total, day) => {
          const source = usageTotalsFor(day.key)
          total.steps += source.steps || 0
          total.missingUsage += source.missingUsage || 0
          total.inputTokens += source.inputTokens || 0
          total.outputTokens += source.outputTokens || 0
          total.cacheReadTokens += source.cacheReadTokens || 0
          total.cacheWriteTokens += source.cacheWriteTokens || 0
          return total
        }, { steps: 0, missingUsage: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
        const sevenDenominator = sevenTotals.inputTokens + sevenTotals.cacheReadTokens + sevenTotals.cacheWriteTokens
        sevenTotals.cacheHitRate = sevenDenominator === 0 ? 0 : sevenTotals.cacheReadTokens / sevenDenominator
        const selectedProjects = usageProject === 'all'
          ? (usage?.projects || []).map((project) => project.id)
          : [usageProject]
        const modelTotals = new Map()
        for (const day of usageDays) {
          const source = usage?.days?.[day.key]
          if (!source) continue
          for (const project of source.projects) {
            if (!selectedProjects.includes(project.id)) continue
            for (const model of project.models) {
              const existing = modelTotals.get(model.id) || { id: model.id, steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
              existing.steps += model.totals.steps || 0
              existing.inputTokens += model.totals.inputTokens || 0
              existing.outputTokens += model.totals.outputTokens || 0
              existing.cacheReadTokens += model.totals.cacheReadTokens || 0
              existing.cacheWriteTokens += model.totals.cacheWriteTokens || 0
              modelTotals.set(model.id, existing)
            }
          }
        }
        const selectedErrors = (list) => (list || [])
          .filter((error) => usageProject === 'all' || error.projectId === usageProject)
          .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        const modelErrors = selectedErrors(usage?.errors?.models)
        const toolErrors = selectedErrors(usage?.errors?.tools)
        const errorList = (kind, errors) => React.createElement('div', { key: kind, style: { display: 'grid', gap: '6px', marginTop: '8px' } },
          errors.length === 0
            ? React.createElement('p', { style: hint }, translate(kind === 'model' ? 'usage.errors.empty' : 'usage.toolErrors.empty'))
            : errors.map((failure) => React.createElement('div', { key: `${kind}:${failure.projectId}:${failure.key}`, style: { padding: '8px 10px', borderRadius: '6px', background: 'rgba(211,51,51,0.065)', border: '1px solid rgba(211,51,51,0.2)', fontSize: '12px' } },
                React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontWeight: 600 } },
                  React.createElement('span', null, kind === 'model'
                    ? `${failure.provider}/${failure.model} · ${failure.code}${failure.status === null ? '' : ` · ${failure.status}`}`
                    : `${failure.tool} · ${failure.code}`),
                  React.createElement('span', null, translate('usage.errors.count', { count: failure.count }))),
                React.createElement('div', { style: { color: '#888', marginTop: '3px', overflowWrap: 'anywhere' } }, failure.message))))
        const usageBlock = React.createElement('div', { key: 'usage-section', 'data-testid': 'usage-card', style: card },
          React.createElement('div', { style: sectionTitle }, translate('usage.title')),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '8px 0' } },
            usageMetrics.map(([id, label]) => React.createElement('button', { key: id, style: id === usageMetric ? primary : plain, onClick: () => setUsageMetric(id) }, translate(label)))),
          usage && usage.projects.length > 0
            ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' } },
                React.createElement('button', { style: usageProject === 'all' ? primary : plain, onClick: () => setUsageProject('all') }, translate('usage.allProjects')),
                usage.projects.map((project) => React.createElement('button', { key: project.id, style: usageProject === project.id ? primary : plain, onClick: () => setUsageProject(project.id) }, project.title)))
            : null,
          usage && usage.indexedSessions > 0
            ? React.createElement('div', null,
                React.createElement('div', { style: { display: 'flex', alignItems: 'end', gap: '6px', height: '130px', padding: '10px', borderRadius: '8px', background: 'rgba(128,128,128,0.07)' } },
                  usageDays.map((day, index) => React.createElement('div', { key: day.key, style: { flex: 1, minWidth: 0, textAlign: 'center' } },
                    React.createElement('div', { title: formatUsageValue(chartValues[index], usageMetric), style: { height: `${Math.max(2, chartValues[index] / chartMax * 95)}px`, background: '#5B4CF0', borderRadius: '4px 4px 0 0' } }),
                    React.createElement('div', { style: { fontSize: '10px', color: '#888', marginTop: '4px' } }, day.label)))),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', marginTop: '8px' } },
                  metric('usage.today', formatUsageValue(usageValue(todayTotals), usageMetric)),
                  metric('usage.sevenDays', formatUsageValue(usageValue(sevenTotals), usageMetric))),
                sevenTotals.missingUsage > 0 ? React.createElement('p', { style: hint }, translate('usage.missing', { count: sevenTotals.missingUsage })) : null,
                React.createElement('div', { style: { display: 'grid', gap: '5px', marginTop: '8px' } },
                  [...modelTotals.values()].sort((a, b) => b.steps - a.steps).map((model) => React.createElement('div', { key: model.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '6px 8px', border: '1px solid rgba(128,128,128,0.18)', borderRadius: '6px' } },
                    React.createElement('span', null, model.id),
                    React.createElement('span', null, formatUsageValue(usageValue({ ...model, cacheHitRate: (model.inputTokens + model.cacheReadTokens + model.cacheWriteTokens) === 0 ? 0 : model.cacheReadTokens / (model.inputTokens + model.cacheReadTokens + model.cacheWriteTokens) }), usageMetric))))),
                React.createElement('div', { style: { display: 'grid', gap: '7px', marginTop: '12px' } },
                  React.createElement('div', null,
                    React.createElement('button', { style: toggle, onClick: () => setModelErrorsOpen((value) => !value) }, `${modelErrorsOpen ? '▾' : '▸'} ${translate('usage.errors.toggle', { count: modelErrors.length })}`),
                    modelErrorsOpen ? React.createElement('div', { style: displaySurface },
                      React.createElement('div', { style: { fontSize: '11px', color: '#888', fontWeight: 600 } }, translate('usage.errors.recent')),
                      errorList('model', modelErrors)) : null),
                  React.createElement('div', null,
                    React.createElement('button', { style: toggle, onClick: () => setToolErrorsOpen((value) => !value) }, `${toolErrorsOpen ? '▾' : '▸'} ${translate('usage.toolErrors.toggle', { count: toolErrors.length })}`),
                    toolErrorsOpen ? React.createElement('div', { style: displaySurface },
                      React.createElement('div', { style: { fontSize: '11px', color: '#888', fontWeight: 600 } }, translate('usage.errors.recent')),
                      errorList('tool', toolErrors)) : null)))
            : React.createElement('p', { style: hint }, usageError || translate('usage.empty')),
          React.createElement('div', { style: row }, React.createElement('button', { style: info, 'data-variant': 'info', onClick: refreshUsage, disabled: usageBusy }, translate(usageBusy ? 'usage.refreshing' : 'usage.refresh'))))

        const healthSummaryBlock = React.createElement('div', null,
          health
            ? React.createElement('div', { 'data-testid': 'health-display', style: Object.assign({}, displaySurface, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }) },
                metric('health.uptime', formatUptime(health.uptimeSeconds)),
                metric('health.rss', formatBytes(health.rssBytes)),
                metric('health.liveSessions', String(health.liveSessions)),
                metric('health.persistedSessions', String(health.persistedSessions)),
                metric('health.activeAgents', String(health.activeAgents)),
                metric('health.activeJobs', String(health.activeJobs)))
            : React.createElement('p', { style: hint }, healthError || translate('version.loading')),
          React.createElement('div', { style: row }, React.createElement('button', { style: info, 'data-variant': 'info', onClick: runDiagnostics, disabled: diagnosticsBusy }, translate(diagnosticsBusy ? 'health.checking' : 'health.check'))),
          diagnostics && diagnostics.status !== 'ok'
            ? React.createElement('div', { style: { marginTop: '10px', padding: '9px 11px', borderRadius: '7px', background: diagnostics.status === 'error' ? 'rgba(211,51,51,0.1)' : 'rgba(198,128,0,0.12)', border: `1px solid ${diagnostics.status === 'error' ? 'rgba(211,51,51,0.3)' : 'rgba(198,128,0,0.3)'}` } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('health.alert.title')),
                React.createElement('div', { style: hint }, translate('health.alert.diagnostics', { status: translate(`health.overall.${diagnostics.status}`) })))
            : null,
          diagnostics
            ? React.createElement('div', { style: { display: 'grid', gap: '5px', marginTop: '8px' } },
                diagnostics.checks.map((check) => React.createElement('div', { key: check.id, style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px', padding: '6px 8px', borderRadius: '6px', background: 'rgba(128,128,128,0.07)' } },
                  React.createElement('span', null, translate(`health.check.${check.id}`)),
                  React.createElement('span', null, `${translate(`health.status.${check.status}`)}${check.detail === undefined ? '' : ` · ${check.detail}`}`))))
            : null)

        const permissionAbnormal = permissions && permissions.supported === true
          ? permissions.items.filter((item) => item.owner !== permissions.targetOwner || item.mode !== '0755').length
          : 0
        const permissionBlock = permissions && permissions.supported === true
          ? React.createElement('div', { key: 'permissions-section', style: Object.assign({}, displaySurface, { marginTop: '12px' }) },
              React.createElement('div', { style: sectionTitle }, translate('permissions.title')),
              React.createElement('p', { style: hint }, translate('permissions.description')),
              permissionAbnormal > 0 ? React.createElement('div', { style: { marginTop: '8px', padding: '9px 11px', borderRadius: '7px', background: 'rgba(198,128,0,0.12)', border: '1px solid rgba(198,128,0,0.3)' } },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 700 } }, translate('health.alert.title')),
                React.createElement('div', { style: hint }, translate('permissions.summary.warning', { count: permissionAbnormal }))) : null,
              React.createElement('p', { style: Object.assign({}, hint, { fontWeight: 600, color: permissionAbnormal > 0 ? '#c68000' : 'inherit' }) }, translate(permissionAbnormal > 0 ? 'permissions.summary.warning' : 'permissions.summary.ok', { count: permissionAbnormal > 0 ? permissionAbnormal : permissions.items.length })),
              React.createElement('p', { style: Object.assign({}, hint, { fontWeight: 600 }) }, translate('permissions.target', { owner: permissions.targetOwner })),
              React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                React.createElement('button', { style: plain, onClick: () => setPermissionDetails((value) => !value) }, translate(permissionDetails ? 'permissions.hideDetails' : 'permissions.showDetails')),
                React.createElement('button', { style: info, 'data-variant': 'info', onClick: deepCheckPermissions, disabled: permissionDeepBusy }, translate(permissionDeepBusy ? 'permissions.deepChecking' : 'permissions.deep'))),
              permissionDeep ? React.createElement('p', { style: hint }, translate('permissions.deepSummary', { scanned: permissionDeep.scanned, duration: permissionDeep.durationMs, owner: permissionDeep.ownerIssues, directories: permissionDeep.directoryModeIssues, files: permissionDeep.fileModeIssues, unreadable: permissionDeep.unreadable })) : null,
              permissionDetails ? React.createElement('div', { style: { display: 'grid', gap: '8px', marginTop: '8px' } },
                permissions.items.map((item) => React.createElement('div', {
                  key: item.path,
                  style: { padding: '9px 10px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.2)' },
                },
                React.createElement('div', { style: { fontSize: '12px', fontWeight: 600 } }, item.label),
                React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '11px', color: '#888', overflowWrap: 'anywhere' } }, item.path),
                React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '12px', marginTop: '3px' } }, `${item.owner} · ${item.mode}`)))) : null,
              permissionConfirm
                ? React.createElement('div', { style: { marginTop: '10px' } },
                    React.createElement('p', { style: Object.assign({}, hint, { color: '#d33' }) }, translate('permissions.confirmHint')),
                    React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                      React.createElement('button', { style: danger, disabled: permissionBusy, onClick: repairPermissions }, translate(permissionBusy ? 'permissions.repairing' : 'permissions.confirm')),
                      React.createElement('button', { style: plain, disabled: permissionBusy, onClick: () => setPermissionConfirm(false) }, translate('permissions.cancel'))))
                : React.createElement('button', { style: Object.assign({}, danger, { marginTop: '10px' }), disabled: permissionBusy, onClick: () => setPermissionConfirm(true) }, translate('permissions.repair')),
              permissionError ? React.createElement('p', { style: Object.assign({}, hint, { color: '#d33' }) }, permissionError) : null)
          : null

        const healthBlock = React.createElement('div', { key: 'health-section', 'data-testid': 'health-card', style: card },
          React.createElement('div', { style: sectionTitle }, translate('health.title')),
          healthSummaryBlock,
          permissionBlock)

        const backupBlock = React.createElement('div', { key: 'backup-section', style: displaySurface },
          React.createElement('div', { style: sectionTitle }, translate('backup.title')),
          React.createElement('p', { style: hint }, translate('backup.description')),
          React.createElement('div', { style: row },
            React.createElement('button', { style: info, 'data-variant': 'info', onClick: createBackup, disabled: backupBusy }, translate(backupBusy ? 'backup.creating' : 'backup.create')),
            React.createElement('span', { style: { fontSize: '12px', color: '#888' } }, translate('backup.total', { size: formatSize(backups.totalBytes) }))),
          backupError ? React.createElement('p', { style: Object.assign({}, hint, { color: '#d33' }) }, backupError) : null,
          backups.items.length === 0
            ? React.createElement('p', { style: hint }, translate('backup.empty'))
            : React.createElement('button', { style: Object.assign({}, plain, { marginTop: '8px' }), onClick: () => setBackupDetails((value) => !value) }, translate(backupDetails ? 'backup.hideRecords' : 'backup.showRecords')),
          backups.items.length > 0 && backupDetails
            ? React.createElement('div', { style: { marginTop: '10px', display: 'grid', gap: '8px' } },
                backups.items.map((item) => React.createElement('div', {
                  key: item.id,
                  style: { padding: '9px 10px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.2)' },
                },
                React.createElement('div', { style: { fontFamily: 'monospace', fontSize: '12px', overflowWrap: 'anywhere' } }, item.name),
                React.createElement('div', { style: { color: '#888', fontSize: '11px', marginTop: '3px' } }, `${formatSize(item.sizeBytes)} · ${new Date(item.createdAt).toLocaleString()}`),
                backupDeleteId === item.id
                  ? React.createElement('div', { style: { marginTop: '8px' } },
                      React.createElement('p', { style: Object.assign({}, hint, { color: '#d33', margin: '0 0 6px' }) }, translate('backup.confirmHint')),
                      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                        React.createElement('button', { style: danger, disabled: backupBusy, onClick: () => deleteBackup(item.id) }, translate('backup.confirm')),
                        React.createElement('button', { style: plain, disabled: backupBusy, onClick: () => setBackupDeleteId(null) }, translate('backup.cancel'))))
                  : React.createElement('button', { style: Object.assign({}, plain, { marginTop: '7px' }), disabled: backupBusy, onClick: () => setBackupDeleteId(item.id) }, translate('backup.delete')))))
            : null)

        // 版本信息区块
        const versionBlock = React.createElement('div', { key: 'version-card', 'data-testid': 'version-card', style: card },
          React.createElement('div', { key: 'ver-section' },
            React.createElement('div', { key: 'title', style: sectionTitle }, translate('version.title')),
            React.createElement('div', { key: 'body', style: { fontSize: '13px', lineHeight: 1.6 } },
              React.createElement('span', null, translate('version.current')),
              React.createElement('code', { style: { background: 'rgba(128,128,128,0.15)', padding: '1px 6px', borderRadius: '4px', fontSize: '12px' } }, version || translate('version.loading')),
              React.createElement('br'),
              React.createElement('span', null, translate('version.plugin')),
              React.createElement('code', { style: { background: 'rgba(128,128,128,0.15)', padding: '1px 6px', borderRadius: '4px', fontSize: '12px' } }, pluginVersion || translate('version.loading'))
            )
          ),
          // 检查更新
          React.createElement('div', { key: 'update-section' },
            React.createElement('div', { style: row },
              React.createElement('button', { style: info, 'data-variant': 'info', onClick: checkUpdate, disabled: updateBusy }, translate(updateBusy ? 'update.checking' : 'update.check')),
              updateInfo
                ? React.createElement('span', {
                    key: 'result',
                    style: { fontSize: '13px', color: updateInfo.upToDate ? '#2a7' : '#d80' }
                  }, updateInfo.upToDate
                    ? translate('update.current')
                    : translate('update.available', { version: updateInfo.latest }))
                : null
            ),
            updateError
              ? React.createElement('p', { key: 'update-err', style: Object.assign({}, hint, { color: '#d33' }) }, String(updateError))
              : null
          ))

        // 重启后提示
        if (stage === 2) {
          return React.createElement('div', null,
            healthBlock,
            backupBlock,
            versionBlock,
            React.createElement('div', { key: 'restart-section' },
              React.createElement('div', { style: sectionTitle }, translate('restart.title')),
              React.createElement('p', { style: { margin: 0, fontSize: '13px' } }, translate('restart.sent')),
              React.createElement('p', { style: hint }, translate('restart.sentHint')))
          )
        }

        const activityLabels = {
          agent: translate('activity.agent'),
          job: translate('activity.job'),
          terminal: translate('activity.terminal'),
        }
        const activityItems = activity && Array.isArray(activity.items) ? activity.items : []
        const activityWarning = stage === 3
          ? React.createElement('div', { style: { marginTop: '12px', padding: '10px 12px', borderRadius: '6px', background: 'rgba(211,51,51,0.1)', border: '1px solid rgba(211,51,51,0.35)' } },
              React.createElement('p', { style: { margin: '0 0 8px', color: '#d33', fontSize: '13px', fontWeight: 600 } },
                translate('activity.warning', { count: activityItems.length })),
              React.createElement('ul', { style: { margin: 0, paddingLeft: '20px', fontSize: '12px', lineHeight: 1.7 } },
                activityItems.map((item) => React.createElement('li', { key: item.type + ':' + item.id },
                  translate('activity.item', {
                    type: activityLabels[item.type] || item.type,
                    label: item.label,
                    status: item.status,
                  }))))
            )
          : null

        // 重启按钮区块
        const restartBlock = React.createElement('div', { key: 'restart-section', 'data-testid': 'restart-card', style: Object.assign({}, card, { borderColor: 'rgba(211,51,51,0.3)', background: 'rgba(211,51,51,0.045)' }) },
          React.createElement('div', { style: sectionTitle }, translate('restart.title')),
          React.createElement('p', { style: { margin: 0, fontSize: '13px' } }, translate('restart.description')),
          activityWarning,
          React.createElement('div', { style: row },
            stage === 0
              ? React.createElement('button', { style: danger, 'data-variant': 'danger', onClick: checkRestart, disabled: busy }, translate(busy ? 'update.checking' : 'restart.button'))
              : stage === 1
                ? [
                    React.createElement('button', { key: 'confirm', style: danger, onClick: () => restart(false), disabled: busy }, translate(busy ? 'restart.sending' : 'restart.confirm')),
                    React.createElement('button', { key: 'cancel', style: plain, onClick: () => { setActivity(null); setStage(0) }, disabled: busy }, translate('restart.cancel')),
                  ]
                : stage === 3
                  ? [
                      React.createElement('button', { key: 'force', style: danger, onClick: () => restart(true), disabled: busy }, translate(busy ? 'restart.sending' : 'restart.force')),
                      React.createElement('button', { key: 'cancel', style: plain, onClick: () => { setActivity(null); setStage(0) }, disabled: busy }, translate('restart.cancel')),
                    ]
                  : null
          ),
          stage === 1 ? React.createElement('p', { style: hint }, translate('restart.idleHint')) : null,
          error ? React.createElement('p', { style: Object.assign({}, hint, { color: '#d33' }) }, String(error)) : null
        )

        const maintenanceBlock = React.createElement('div', { key: 'maintenance-card', 'data-testid': 'maintenance-card', style: card }, backupBlock)
        return React.createElement('div', null, versionBlock, healthBlock, usageBlock, maintenanceBlock, restartBlock)
      }

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'dsh-service-update', order: 90, label: () => t('update.badge') },
        () => React.createElement(UpdateBadge, null),
      ))
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'dsh-service', order: 99, label: () => t('nav.label') },
        () => React.createElement(ServicePanel, null),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-service-restart', order: 100, label: () => t('overlay.label') },
        () => React.createElement(RestartOverlay, null),
      ))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
