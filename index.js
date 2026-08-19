// Host half of @dsh-nas/restart-dsh
// 「服务控制」：版本信息 + 检查更新 + 一键重启 dsh web
import { createRequire } from 'node:module'
import https from 'node:https'

const require = createRequire(import.meta.url)
const name = 'restart-dsh'
const inject = ['connection']
const DSH_PACKAGE = '@deepseek-ai/dsh'
const NPM_REGISTRY = 'https://registry.npmjs.org/'
const MAX_NPM_RESPONSE_BYTES = 256 * 1024

// 读取当前 dsh 版本。DSH 包由宿主安装，不作为插件依赖打包进来。
let dshVersion = 'unknown'
try {
  dshVersion = require(`${DSH_PACKAGE}/package.json`).version
} catch (_) {
  try {
    dshVersion = require('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json').version
  } catch (__) {}
}

// 只请求固定的 npm registry 包元数据：不接受来自浏览器的 URL 或包名，避免 SSRF。
function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    const succeed = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const url = NPM_REGISTRY + encodeURIComponent(DSH_PACKAGE)
    const request = https.get(url, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'dsh-restart-dsh',
      },
    }, (response) => {
      const status = response.statusCode || 0
      if (status < 200 || status >= 300) {
        response.resume()
        fail(new Error(`npm registry 返回 HTTP ${status}`))
        return
      }

      let body = ''
      let bytes = 0
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk)
        if (bytes > MAX_NPM_RESPONSE_BYTES) {
          fail(new Error('npm registry 响应过大'))
          request.destroy()
          return
        }
        body += chunk
      })
      response.on('error', fail)
      response.on('end', () => {
        if (settled) return
        try {
          const data = JSON.parse(body)
          const latest = data?.['dist-tags']?.latest
          if (typeof latest !== 'string' || latest.length === 0) {
            fail(new Error('npm 响应中没有 latest 版本'))
            return
          }
          succeed(latest)
        } catch (_) {
          fail(new Error('解析 npm 响应失败'))
        }
      })
    })
    request.on('error', fail)
    request.on('timeout', () => {
      request.destroy()
      fail(new Error('请求 npm registry 超时'))
    })
  })
}

function apply(ctx) {
  // DSH 的 Connection RPC channel 只能是单层绝对路径；子功能放在 endpoint 中。
  // 合法示例：channel=/restart-dsh，endpoint=version/check-update/web。
  ctx.connection.rpc.handle('/restart-dsh', async (endpoint) => {
    if (endpoint === 'version') {
      return { ok: true, value: { current: dshVersion } }
    }

    if (endpoint === 'check-update') {
      try {
        const latest = await fetchLatestVersion()
        return {
          ok: true,
          value: { current: dshVersion, latest, upToDate: dshVersion === latest },
        }
      } catch (error) {
        return { ok: false, error: error?.message || String(error) }
      }
    }

    if (endpoint === 'web') {
      const doExit = () => {
        try {
          // 退出码 42 交给 Docker/systemd/pm2 的重启策略处理。
          process.exit(42)
        } catch (error) {
          console.error('restart-dsh: exit failed', error?.message || error)
        }
      }
      const timer = ctx.get('timer')
      if (timer !== undefined) timer.timeout(doExit, 500)
      else doExit()
      return { ok: true, value: '重启指令已发出，进程将在 0.5 秒后退出' }
    }

    return { ok: false, error: 'unknown endpoint: ' + String(endpoint) }
  }, { authority: 'loopback' })
}

export { apply, inject, name }
export default { apply, inject, name }
