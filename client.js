// Browser half of @dsh-nas/restart-dsh
// 设置面板新增「服务控制」页：一键重启 dsh web（两段式确认）。
window.__ModuleLoader__.load({
  id: '@dsh-nas/restart-dsh',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const inject = ['slots', 'connection']

    function apply(ctx) {
      const { useState } = React

      function RestartPanel() {
        const [stage, setStage] = useState(0) // 0 初始 / 1 确认 / 2 已发送
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState(null)

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

        const row = { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }
        const btn = { padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(128,128,128,0.3)', cursor: 'pointer', fontSize: '13px' }
        const danger = Object.assign({}, btn, { background: '#d33', color: '#fff', borderColor: '#d33' })
        const plain = Object.assign({}, btn, { background: 'transparent' })
        const hint = { color: '#888', fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }

        if (stage === 2) {
          return React.createElement('div', null,
            React.createElement('p', { style: { margin: 0 } }, '重启指令已发出。'),
            React.createElement('p', { style: hint },
              '页面连接即将断开，服务会自动重新拉起（约 10-30 秒），就绪后请刷新页面。若 1 分钟后页面仍可用，说明重启未生效（进程管理器未配置自动重启或权限不足）。'))
        }

        return React.createElement('div', null,
          React.createElement('p', { style: { margin: 0 } },
            '重启 dsh web 服务进程：运行中的任务会中断，持久化的会话可恢复。'),
          React.createElement('div', { style: row },
            stage === 0
              ? React.createElement('button', { style: danger, onClick: () => setStage(1) }, '重启 dsh web')
              : [
                  React.createElement('button', { key: 'confirm', style: danger, onClick: restart, disabled: busy }, busy ? '发送中…' : '确认重启'),
                  React.createElement('button', { key: 'cancel', style: plain, onClick: () => setStage(0), disabled: busy }, '取消'),
                ]),
          stage === 1 ? React.createElement('p', { style: hint }, '确认后将立即断开当前连接，等待服务自动重启。') : null,
          error ? React.createElement('p', { style: Object.assign({}, hint, { color: '#d33' }) }, String(error)) : null)
      }

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'restart-dsh', order: 99, label: () => '服务控制' },
        () => React.createElement(RestartPanel, null),
      ))
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
