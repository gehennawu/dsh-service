// Host half of @dsh-nas/restart-dsh
// 「服务控制」重启能力：先返回 RPC 成功响应，再延迟退出进程。
// 退出码 42 语义：通知进程管理器（systemd / pm2 / Docker restart 策略）重新拉起。
const name = 'restart-dsh'

const inject = ['connection', 'shell']

function apply(ctx) {
  ctx.connection.rpc.handle('/restart-dsh', async (endpoint, payload) => {
    if (endpoint !== 'web') return { ok: false, error: 'unknown endpoint: ' + String(endpoint) }

    const doExit = () => {
      try {
        process.exit(42)
      } catch (err) {
        console.error('restart-dsh: exit failed', err && err.message ? err.message : err)
      }
    }

    // 延迟退出，确保 RPC 响应先到达浏览器
    const timer = ctx.get('timer')
    if (timer !== undefined) timer.timeout(doExit, 500)
    else setTimeout(doExit, 500)

    return { ok: true, value: '重启指令已发出，进程将在 0.5 秒后退出' }
  }, { authority: 'loopback' })
}

export { apply, inject, name }
export default { apply, inject, name }
