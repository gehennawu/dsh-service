// Browser half of @dsh-nas/restart-dsh
// 设置面板「服务控制」：版本信息 + 检查更新 + 一键重启
window.__ModuleLoader__.load({
  id: '@dsh-nas/restart-dsh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const inject = ['slots', 'connection']

    function apply(ctx) {
      const { useState, useEffect } = React

      function ServicePanel() {
        const [version, setVersion] = useState(null)
        const [updateInfo, setUpdateInfo] = useState(null) // { latest, upToDate } | null
        const [updateBusy, setUpdateBusy] = useState(false)
        const [updateError, setUpdateError] = useState(null)
        // 重启状态
        const [stage, setStage] = useState(0)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)

        // 进入面板时拉取当前版本
        useEffect(() => {
          ctx.connection.rpc.call('/restart-dsh', 'version', {}).then((res) => {
            if (res && res.ok) setVersion(res.value.current)
          }).catch(() => {})
        }, [])

        const checkUpdate = async () => {
          setUpdateBusy(true)
          setUpdateError(null)
          setUpdateInfo(null)
          try {
            const res = await ctx.connection.rpc.call('/restart-dsh', 'check-update', {})
            if (res && res.ok === false) throw new Error(res.error || '检查失败')
            setUpdateInfo(res.value)
          } catch (err) {
            setUpdateError(err && err.message ? String(err.message) : String(err))
          } finally {
            setUpdateBusy(false)
          }
        }

        const restart = async () => {
          setBusy(true)
          setError(null)
          try {
            const res = await ctx.connection.rpc.call('/restart-dsh', 'web', {})
            if (res && res.ok === false) throw new Error(res.error || '重启失败')
            setStage(2)
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

        // 重启按钮区块
        const restartBlock = React.createElement('div', { key: 'restart-section' },
          React.createElement('div', { style: sectionTitle }, '服务重启'),
          React.createElement('p', { style: { margin: 0, fontSize: '13px' } },
            '重启 dsh web 服务进程：运行中的任务会中断，持久化的会话可恢复。'),
          React.createElement('div', { style: row },
            stage === 0
              ? React.createElement('button', { style: danger, onClick: () => setStage(1) }, '重启 dsh web')
              : [
                  React.createElement('button', { key: 'confirm', style: danger, onClick: restart, disabled: busy }, busy ? '发送中…' : '确认重启'),
                  React.createElement('button', { key: 'cancel', style: plain, onClick: () => setStage(0), disabled: busy }, '取消'),
                ]
          ),
          stage === 1 ? React.createElement('p', { style: hint }, '确认后将立即断开当前连接，等待服务自动重启。') : null,
          error ? React.createElement('p', { style: Object.assign({}, hint, { color: '#d33' }) }, String(error)) : null
        )

        return React.createElement('div', null, versionBlock, restartBlock)
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'restart-dsh', order: 99, label: () => '服务控制' },
        () => React.createElement(ServicePanel, null),
      ))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
