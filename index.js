// Host half of @dsh-nas/restart-dsh
// 「服务控制」：版本信息 + 检查更新 + 一键重启 dsh web
import { createRequire } from 'node:module'
import https from 'node:https'

const require = createRequire(import.meta.url)
const name = 'restart-dsh'
const inject = ['connection', 'shell']

// 读取当前 dsh 版本
let dshVersion = 'unknown'
try {
  dshVersion = require('@deepseek-ai/dsh/package.json').version
} catch (_) {
  try {
    dshVersion = require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version
  } catch (__) {}
}

// 从 npm registry 获取最新版本
function fetchLatestVersion(pkg) {
  return new Promise((resolve, reject) => {
    const url = 'https://registry.npmjs.org/' + encodeURIComponent(pkg)
    const req = https.get(url, { timeout: 10000, headers: { 'Accept': 'application/json' } }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          resolve(data['dist-tags'] ? data['dist-tags']['latest'] : null)
        } catch (e) { reject(new Error('解析 npm 响应失败')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
  })
}

function apply(ctx) {
  // 版本信息
  ctx.connection.rpc.handle('/restart-dsh/version', async (endpoint) => {
    if (endpoint !== 'web') return { ok: false, error: 'unknown endpoint' }
    return { ok: true, value: { current: dshVersion } }
  }, { authority: 'loopback' })

  // 检查更新
  ctx.connection.rpc.handle('/restart-dsh/check-update', async (endpoint) => {
    if (endpoint !== 'web') return { ok: false, error: 'unknown endpoint' }
    try {
      const latest = await fetchLatestVersion('@deepseek-ai/dsh')
      return { ok: true, value: { current: dshVersion, latest: latest, upToDate: dshVersion === latest } }
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) }
    }
  }, { authority: 'loopback' })

  // 重启
  ctx.connection.rpc.handle('/restart-dsh/web', async (endpoint) => {
    if (endpoint !== 'web') return { ok: false, error: 'unknown endpoint: ' + String(endpoint) }
    const doExit = () => {
      try { process.exit(42) }
      catch (err) { console.error('restart-dsh: exit failed', err && err.message ? err.message : err) }
    }
    const timer = ctx.get('timer')
    if (timer !== undefined) timer.timeout(doExit, 500)
    else setTimeout(doExit, 500)
    return { ok: true, value: '重启指令已发出，进程将在 0.5 秒后退出' }
  }, { authority: 'loopback' })
}

export { apply, inject, name }
export default { apply, inject, name }
