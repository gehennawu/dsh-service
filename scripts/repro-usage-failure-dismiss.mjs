/**
 * 真机取证：模型统计「跳过会话」告警的关闭按钮。
 *
 * 验证四件事：
 *   1. 打开设置页 → 模型统计分区，出现 usage-failure-warning 且带 usage-failure-dismiss × 按钮；
 *   2. 点 × → 告警消失，且 localStorage 写入 dsh-service-usage-failures-dismissed（非空指纹）；
 *   3. 刷新页面（重新挂载）→ 告警仍不出现（说明记忆从 localStorage 读回，而非仅内存态）；
 *   4. 清掉记忆键并刷新 → 告警恢复（用户可主动找回）。
 *
 * 本机（DSH 0.1.5-rc.2 + 修复后的插件）真实索引里 failedSessions 为 0，所以第 1 步可能
 * 没有告警可关。此时脚本会**在页面内注入**一条假的 failedSessions 载荷来驱动 UI（走
 * 宿主 RPC 的 fetch 拦截面），从而在无真实坏会话的机器上也能验证按钮行为。
 * 用法：bash /workspace/.dsh-e2e/run.sh repro-usage-failure-dismiss.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { authedContext, BASE } from '/workspace/.dsh-e2e/scripts/lib.mjs'

const DISMISS_KEY = 'dsh-service-usage-failures-dismissed'
// 证据落仓库侧：会话沙箱只放行会话工作区，/workspace/.dsh-e2e/out/ 会被 EACCES 拒掉。
const OUT = join(process.cwd(), '.e2e-out')
mkdirSync(OUT, { recursive: true })
const dump = { steps: [] }
const step = (name, value) => { dump.steps.push({ name, value }); console.log(`— ${name}:`, JSON.stringify(value)) }

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const ctx = await authedContext(browser)

  // 注入假失败载荷：插件走 ctx.connection.rpc.call（不是 window.fetch），所以在网络层
  // 拦截 /dsh-service/usage 与 usage-refresh 的回包，只改写 failedSessions，其余字段照旧
  // ——图表照常渲染，只有「跳过会话」告警是被制造的，从而在任何机器上都能验证按钮行为。
  let patched = 0
  await ctx.route('**/dsh-service/*', async (route) => {
    const request = route.request()
    const url = request.url()
    if (!/\/(usage|usage-refresh)$/.test(url)) { await route.continue(); return }
    const response = await route.fetch()
    const body = await response.json().catch(() => null)
    const payload = body && body.result && body.result.value
    if (payload && typeof payload === 'object') {
      payload.failedSessions = [
        { id: 'legacy-v0-probe', code: 'session-read-failed', message: 'probe', stale: true },
        { id: 'broken-probe', code: 'format-migration-failed', message: 'probe', stale: true },
      ]
      patched += 1
    }
    await route.fulfill({
      response,
      body: JSON.stringify(body),
      headers: { ...response.headers(), 'content-type': 'application/json' },
    })
  })

  const page = await ctx.newPage()
  page.on('pageerror', (e) => { dump.pageErrors = dump.pageErrors || []; dump.pageErrors.push(String(e)) })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(4500)
  // 每次全新加载都清掉记忆键，保证从「未关闭」状态起测
  await page.evaluate((k) => { try { localStorage.removeItem(k) } catch {} }, DISMISS_KEY)

  // 打开设置 → 模型统计。设置入口是「设置」文字的最近可点祖先（实测为 span 包在按钮里）。
  const openStats = async () => {
    return page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const clickableOf = (node) => {
        let el = node
        while (el && el !== document.body) {
          if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'tab') return el
          el = el.parentElement
        }
        return null
      }
      const findAndClick = (re) => {
        const leaf = [...document.querySelectorAll('span,div,a,button')]
          .filter((e) => e.children.length === 0 && re.test((e.textContent || '').trim()))
        const target = leaf.map(clickableOf).find(Boolean)
        if (target) { target.click(); return true }
        return false
      }
      // 设置入口 → 服务控制 → 模型统计（分区标签有稳定 testid，优先用它，不靠文案匹配）
      if (!document.querySelector('[data-testid="service-panel-root"]')) {
        findAndClick(/^设置$|^Settings$/)
        await sleep(2000)
      }
      if (!document.querySelector('[data-testid="service-panel-root"]')) {
        findAndClick(/^服务控制$|^Service control$/)
        await sleep(2000)
      }
      const serviceTab = document.querySelector('[data-testid="service-tab-usage"]')
      if (serviceTab) { serviceTab.click(); await sleep(3000) }
      return { clickedStats: serviceTab !== null, hasRegion: document.querySelector('[data-testid="usage-statistics-region"]') !== null, hasWarning: document.querySelector('[data-testid="usage-failure-warning"]') !== null }
    })
  }

  step('open stats', { ...(await openStats()), patchedUsageResponses: patched })
  await page.waitForTimeout(2000)

  const before = await page.evaluate((k) => ({
    warning: document.querySelector('[data-testid="usage-failure-warning"]') !== null,
    dismissBtn: document.querySelector('[data-testid="usage-failure-dismiss"]') !== null,
    dismissText: (document.querySelector('[data-testid="usage-failure-dismiss"]') || {}).textContent || null,
    ariaLabel: (document.querySelector('[data-testid="usage-failure-dismiss"]') || {}).getAttribute?.('aria-label') || null,
    stored: (() => { try { return localStorage.getItem(k) } catch { return '<throw>' } })(),
    warningText: (document.querySelector('[data-testid="usage-failure-warning"]') || {}).textContent || null,
  }), DISMISS_KEY)
  step('before dismiss', before)
  await page.screenshot({ path: join(OUT, 'dismiss-01-visible.png') })

  if (!before.warning) {
    step('RESULT', { ok: false, reason: '告警未出现——注入载荷可能未生效或设置页未打开' })
  } else {
    // 点 ×
    await page.click('[data-testid="usage-failure-dismiss"]')
    await page.waitForTimeout(600)
    const afterClick = await page.evaluate((k) => ({
      warning: document.querySelector('[data-testid="usage-failure-warning"]') !== null,
      stored: (() => { try { return localStorage.getItem(k) } catch { return '<throw>' } })(),
    }), DISMISS_KEY)
    step('after dismiss click', afterClick)
    await page.screenshot({ path: join(OUT, 'dismiss-02-hidden.png') })

    // 刷新页面：记忆应读回
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4500)
    await openStats()
    await page.waitForTimeout(2000)
    const afterReload = await page.evaluate((k) => ({
      warning: document.querySelector('[data-testid="usage-failure-warning"]') !== null,
      stored: (() => { try { return localStorage.getItem(k) } catch { return '<throw>' } })(),
    }), DISMISS_KEY)
    step('after reload (should stay hidden)', afterReload)
    await page.screenshot({ path: join(OUT, 'dismiss-03-after-reload.png') })

    // 清键 + 刷新：应恢复
    await page.evaluate((k) => { try { localStorage.removeItem(k) } catch {} }, DISMISS_KEY)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4500)
    await openStats()
    await page.waitForTimeout(2000)
    const afterClear = await page.evaluate(() => ({
      warning: document.querySelector('[data-testid="usage-failure-warning"]') !== null,
    }))
    step('after clearing key (should reappear)', afterClear)
    await page.screenshot({ path: join(OUT, 'dismiss-04-restored.png') })

    step('RESULT', {
      ok: before.dismissBtn && afterClick.warning === false && typeof afterClick.stored === 'string'
        && afterReload.warning === false && afterClear.warning === true,
      checks: {
        '按钮存在': before.dismissBtn,
        '点击后消失': afterClick.warning === false,
        '指纹已落盘': typeof afterClick.stored === 'string' && afterClick.stored.length > 0,
        '刷新后仍隐藏': afterReload.warning === false,
        '清键后恢复': afterClear.warning === true,
      },
    })
  }
} catch (error) {
  dump.fatal = String(error && error.stack ? error.stack : error)
  console.error('probe failed:', dump.fatal)
} finally {
  writeFileSync(join(OUT, 'usage-failure-dismiss-dump.json'), JSON.stringify(dump, null, 2))
  await browser.close()
}
