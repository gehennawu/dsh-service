// 真机验证：模型配置页在真实 Web UI 里可达、渲染路由与子标签（v1.10 重实现收尾取证）。
//
// 用法（会话沙箱内 .dsh-e2e/ 只读，故脚本放仓库侧，run.sh 的 env 内联）：
//   PLAYWRIGHT_BROWSERS_PATH=/workspace/.dsh-e2e/browsers \
//   LD_LIBRARY_PATH="/workspace/.dsh-e2e/libs/root/usr/lib/x86_64-linux-gnu:/workspace/.dsh-e2e/libs/root/lib/x86_64-linux-gnu" \
//   FONTCONFIG_FILE=/workspace/.dsh-e2e/etc/fonts/fonts.conf node scripts/verify-model-workbench-page.mjs
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { authedContext, BASE } from '../../../.dsh-e2e/scripts/lib.mjs'

const OUT = process.env.DSH_E2E_OUT || join(tmpdir(), `dshsvc-model-wb-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await authedContext(browser, { viewport: { width: 1440, height: 960 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

const report = { openedSettings: null, tabFound: false, subTabs: [], routeRows: [], routeCount: 0, panelTextLen: 0, pageErrors, error: null }
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)

  report.openedSettings = await page.evaluate(() => {
    const area = document.querySelector('[class*="settingsArea"]') || document.querySelector('[data-slot="sidebar.settings"]')
    const scoped = area ? [...area.querySelectorAll('button')] : []
    const buttons = [...document.querySelectorAll('button')]
    const hit = scoped[0]
      || buttons.find((b) => b.getAttribute('aria-haspopup') === 'dialog')
      || buttons.find((b) => /设置|Settings/.test((b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '') + (b.textContent || '')))
    if (!hit) return null
    hit.click()
    return (hit.getAttribute('aria-label') || hit.textContent || '').trim().slice(0, 40)
  })
  await page.waitForTimeout(2500)

  // 侧栏插件节 → 本插件页。
  await page.evaluate(() => {
    const nav = document.querySelector('[role="dialog"] nav')
    if (!nav) return
    const hit = [...nav.querySelectorAll('button')].find((b) => /服务控制|Service control|dsh-service/i.test(b.textContent || ''))
    if (hit) hit.click()
  })
  await page.waitForTimeout(2500)

  report.tabFound = await page.evaluate(() => document.querySelector('[data-testid="service-tab-models"]') !== null)
  if (report.tabFound) {
    await page.click('[data-testid="service-tab-models"]')
    await page.waitForSelector('[data-testid="models-page"]', { timeout: 15000 })
    await page.waitForTimeout(2500)
    const snapshot = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="models-page"]')
      return {
        subTabs: [...document.querySelectorAll('[data-testid^="models-tab-"]')].map((n) => n.getAttribute('data-testid')),
        routeRows: [...document.querySelectorAll('[data-testid^="models-route-row-"]')].map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100)),
        textLen: (panel?.textContent || '').length,
      }
    })
    report.subTabs = snapshot.subTabs
    report.routeRows = snapshot.routeRows
    report.routeCount = snapshot.routeRows.length
    report.panelTextLen = snapshot.textLen
    await page.screenshot({ path: join(OUT, 'model-workbench-page.png') })
  }
} catch (error) {
  report.error = error?.message || String(error)
}
console.log(JSON.stringify(report, null, 2))
console.log('OUT=' + OUT)
await browser.close()
