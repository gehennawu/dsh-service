// Browser half of @gehennawu/dsh-service
// 设置面板「服务控制」：版本信息 + 检查更新 + 一键重启
window.__ModuleLoader__.load({
  id: '@gehennawu/dsh-service',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const inject = ['slots', 'connection', 'timer']

    function apply(ctx) {
      const { useState, useEffect } = React
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
          timedOut ? '服务尚未恢复' : '服务重启中…'),
        React.createElement('p', { style: { margin: 0, fontSize: '13px', lineHeight: 1.7, color: '#888' } },
          timedOut
            ? '已等待 60 秒。请确认外部进程管理器已正确配置，或手动刷新页面重试。'
            : '正在等待新的 DSH Web 进程启动，已等待 ' + Math.floor(recovery.elapsedMs / 1000) + ' 秒。'),
        timedOut
          ? React.createElement('button', {
              style: { marginTop: '16px', padding: '7px 16px', borderRadius: '6px', border: 0, background: '#5B4CF0', color: '#fff', cursor: 'pointer' },
              onClick: () => window.location.reload(),
            }, '手动刷新')
          : null))
      }

      function ServicePanel() {
        const [version, setVersion] = useState(null)
        const [updateInfo, setUpdateInfo] = useState(null) // { latest, upToDate } | null
        const [updateBusy, setUpdateBusy] = useState(false)
        const [updateError, setUpdateError] = useState(null)
        // 重启状态：0=初始，1=普通确认，2=已发出，3=检测到活动工作
        const [stage, setStage] = useState(0)
        const [activity, setActivity] = useState(null)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)

        // 进入面板时拉取当前版本
        useEffect(() => {
          ctx.connection.rpc.call('/dsh-service', 'version', {}).then((res) => {
            if (res && res.ok) setVersion(res.value.current)
          }).catch(() => {})
        }, [])

        const checkUpdate = async () => {
          setUpdateBusy(true)
          setUpdateError(null)
          setUpdateInfo(null)
          try {
            const res = await ctx.connection.rpc.call('/dsh-service', 'check-update', {})
            if (res && res.ok === false) throw new Error(res.error || '检查失败')
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
            if (res && res.ok === false) throw new Error(res.error || '检查运行状态失败')
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
              throw new Error(res.error || '重启失败')
            }
            setStage(2)
            const previousInstanceId = res && res.value ? res.value.instanceId : undefined
            if (typeof previousInstanceId !== 'string' || previousInstanceId.length === 0) {
              throw new Error('重启响应缺少进程实例标识')
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

        // 版本信息区块
        const versionBlock = [
          React.createElement('div', { key: 'ver-section', style: { marginTop: 4 } },
            React.createElement('div', { key: 'title', style: sectionTitle }, '版本信息'),
            React.createElement('div', { key: 'body', style: { fontSize: '13px', lineHeight: 1.6 } },
              React.createElement('span', null, '当前版本：'),
              React.createElement('code', { style: { background: 'rgba(128,128,128,0.15)', padding: '1px 6px', borderRadius: '4px', fontSize: '12px' } }, version || '加载中…')
            )
          ),
          // 检查更新
          React.createElement('div', { key: 'update-section' },
            React.createElement('div', { style: row },
              React.createElement('button', { style: primary, onClick: checkUpdate, disabled: updateBusy }, updateBusy ? '检查中…' : '检查更新'),
              updateInfo
                ? React.createElement('span', {
                    key: 'result',
                    style: { fontSize: '13px', color: updateInfo.upToDate ? '#2a7' : '#d80' }
                  }, updateInfo.upToDate
                    ? '✓ 已是最新版本'
                    : '有新版本可用：' + updateInfo.latest)
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
            versionBlock,
            React.createElement('div', { key: 'restart-section' },
              React.createElement('div', { style: sectionTitle }, '服务重启'),
              React.createElement('p', { style: { margin: 0, fontSize: '13px' } }, '重启指令已发出。'),
              React.createElement('p', { style: hint },
                '页面连接即将断开，服务会自动重新拉起（约 10-30 秒），就绪后请刷新页面。'))
          )
        }

        const activityLabels = { agent: 'Agent', job: '后台任务', terminal: '终端' }
        const activityItems = activity && Array.isArray(activity.items) ? activity.items : []
        const activityWarning = stage === 3
          ? React.createElement('div', { style: { marginTop: '12px', padding: '10px 12px', borderRadius: '6px', background: 'rgba(211,51,51,0.1)', border: '1px solid rgba(211,51,51,0.35)' } },
              React.createElement('p', { style: { margin: '0 0 8px', color: '#d33', fontSize: '13px', fontWeight: 600 } },
                '检测到 ' + activityItems.length + ' 项运行中的工作，重启会立即中断它们。'),
              React.createElement('ul', { style: { margin: 0, paddingLeft: '20px', fontSize: '12px', lineHeight: 1.7 } },
                activityItems.map((item) => React.createElement('li', { key: item.type + ':' + item.id },
                  (activityLabels[item.type] || item.type) + '：' + item.label + ' (' + item.status + ')')))
            )
          : null

        // 重启按钮区块
        const restartBlock = React.createElement('div', { key: 'restart-section' },
          React.createElement('div', { style: sectionTitle }, '服务重启'),
          React.createElement('p', { style: { margin: 0, fontSize: '13px' } },
            '重启 dsh web 服务进程：运行中的任务会中断，持久化的会话可恢复。'),
          activityWarning,
          React.createElement('div', { style: row },
            stage === 0
              ? React.createElement('button', { style: danger, onClick: checkRestart, disabled: busy }, busy ? '检查中…' : '重启 dsh web')
              : stage === 1
                ? [
                    React.createElement('button', { key: 'confirm', style: danger, onClick: () => restart(false), disabled: busy }, busy ? '发送中…' : '确认重启'),
                    React.createElement('button', { key: 'cancel', style: plain, onClick: () => { setActivity(null); setStage(0) }, disabled: busy }, '取消'),
                  ]
                : stage === 3
                  ? [
                      React.createElement('button', { key: 'force', style: danger, onClick: () => restart(true), disabled: busy }, busy ? '发送中…' : '仍要重启'),
                      React.createElement('button', { key: 'cancel', style: plain, onClick: () => { setActivity(null); setStage(0) }, disabled: busy }, '取消'),
                    ]
                  : null
          ),
          stage === 1 ? React.createElement('p', { style: hint }, '当前没有检测到运行中的工作。确认后将断开连接，等待服务自动重启。') : null,
          error ? React.createElement('p', { style: Object.assign({}, hint, { color: '#d33' }) }, String(error)) : null
        )

        return React.createElement('div', null, versionBlock, restartBlock)
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'dsh-service', order: 99, label: () => '服务控制' },
        () => React.createElement(ServicePanel, null),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'dsh-service-restart', order: 100, label: () => '服务重启状态' },
        () => React.createElement(RestartOverlay, null),
      ))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
