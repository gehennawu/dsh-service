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
      'version.title': '版本信息',
      'version.current': '当前版本：',
      'version.loading': '加载中…',
      'update.check': '检查更新',
      'update.checking': '检查中…',
      'update.current': '✓ 已是最新版本',
      'update.available': '有新版本可用：{version}',
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
      'version.title': 'Version information',
      'version.current': 'Current version: ',
      'version.loading': 'Loading…',
      'update.check': 'Check for updates',
      'update.checking': 'Checking…',
      'update.current': '✓ Up to date',
      'update.available': 'New version available: {version}',
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
      let recoveryState = { status: 'idle', elapsedMs: 0 }
      let recoveryGeneration = 0

      const setRecoveryState = (next) => {
        recoveryState = next
        for (const listener of recoveryListeners) listener(next)
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
      }, 'dsh-service recovery')

      function RestartOverlay() {
        const recovery = useRecoveryState()
        const translate = useTranslation()
        if (recovery.status === 'idle') return null

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

      function ServicePanel() {
        const translate = useTranslation()
        const [health, setHealth] = useState(null)
        const [healthError, setHealthError] = useState(null)
        const [version, setVersion] = useState(null)
        const [updateInfo, setUpdateInfo] = useState(null) // { latest, upToDate } | null
        const [updateBusy, setUpdateBusy] = useState(false)
        const [updateError, setUpdateError] = useState(null)
        // 重启状态：0=初始，1=普通确认，2=已发出，3=检测到活动工作
        const [stage, setStage] = useState(0)
        const [activity, setActivity] = useState(null)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)

        // 进入面板时拉取当前版本和健康快照；健康数据每 5 秒刷新，卸载即停止。
        useEffect(() => {
          ctx.connection.rpc.call('/dsh-service', 'version', {}).then((res) => {
            if (res && res.ok) setVersion(res.value.current)
          }).catch(() => {})
        }, [])
        useEffect(() => {
          let active = true
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
            try {
              await ctx.timer.timeout(5000)
            } catch (_) {
              return
            }
            if (active) poll()
          }
          poll()
          return () => { active = false }
        }, [])

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
        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }
        const hint = { color: '#888', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }
        const sectionTitle = { fontSize: '13px', fontWeight: 600, margin: '16px 0 4px', color: 'inherit' }

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
        const healthBlock = React.createElement('div', { key: 'health-section' },
          React.createElement('div', { style: sectionTitle }, translate('health.title')),
          health
            ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' } },
                metric('health.uptime', formatUptime(health.uptimeSeconds)),
                metric('health.rss', formatBytes(health.rssBytes)),
                metric('health.liveSessions', String(health.liveSessions)),
                metric('health.persistedSessions', String(health.persistedSessions)),
                metric('health.activeAgents', String(health.activeAgents)),
                metric('health.activeJobs', String(health.activeJobs)))
            : React.createElement('p', { style: hint }, healthError || translate('version.loading')))

        // 版本信息区块
        const versionBlock = [
          React.createElement('div', { key: 'ver-section', style: { marginTop: 4 } },
            React.createElement('div', { key: 'title', style: sectionTitle }, translate('version.title')),
            React.createElement('div', { key: 'body', style: { fontSize: '13px', lineHeight: 1.6 } },
              React.createElement('span', null, translate('version.current')),
              React.createElement('code', { style: { background: 'rgba(128,128,128,0.15)', padding: '1px 6px', borderRadius: '4px', fontSize: '12px' } }, version || translate('version.loading'))
            )
          ),
          // 检查更新
          React.createElement('div', { key: 'update-section' },
            React.createElement('div', { style: row },
              React.createElement('button', { style: primary, onClick: checkUpdate, disabled: updateBusy }, translate(updateBusy ? 'update.checking' : 'update.check')),
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
          )
        ]

        // 重启后提示
        if (stage === 2) {
          return React.createElement('div', null,
            healthBlock,
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
        const restartBlock = React.createElement('div', { key: 'restart-section' },
          React.createElement('div', { style: sectionTitle }, translate('restart.title')),
          React.createElement('p', { style: { margin: 0, fontSize: '13px' } }, translate('restart.description')),
          activityWarning,
          React.createElement('div', { style: row },
            stage === 0
              ? React.createElement('button', { style: danger, onClick: checkRestart, disabled: busy }, translate(busy ? 'update.checking' : 'restart.button'))
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

        return React.createElement('div', null, healthBlock, versionBlock, restartBlock)
      }

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
