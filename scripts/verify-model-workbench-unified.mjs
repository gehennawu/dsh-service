// 真机验收：统一「模型配置」页在真实 Web UI 里的默认路径与零 pageerror（v1.11 重设计 P3）。
//
// 覆盖：渠道列表 → 渠道详情三页签 → 单模型独立编辑面板（保存按钮在面板内）→
//       连接信息页（地址边界文案、密钥不回显）→ 撤销与删除页 → 删除恢复入口 → 搜索框。
// 只读操作 + 页面内 DOM 取证，**不做任何真实写入**（不点保存/确认，不触发出网）。
//
// 用法（会话沙箱内 .dsh-e2e/ 只读，故脚本放仓库侧，env 内联）：
//   PLAYWRIGHT_BROWSERS_PATH=/workspace/.dsh-e2e/browsers \
//   LD_LIBRARY_PATH="/workspace/.dsh-e2e/libs/root/usr/lib/x86_64-linux-gnu:/workspace/.dsh-e2e/libs/root/lib/x86_64-linux-gnu" \
//   FONTCONFIG_FILE=/workspace/.dsh-e2e/etc/fonts/fonts.conf node scripts/verify-model-workbench-unified.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { authedContext, BASE } from '/workspace/.dsh-e2e/scripts/lib.mjs'

// 证据落仓库侧：会话沙箱对 .dsh-e2e/ 只读（见 docs/internals/e2e-browser-env.md）。
const OUT = process.env.DSH_E2E_OUT || join('/workspace/projects/dsh-service/.verify-out', `wb-unified-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await authedContext(browser, { viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const pageErrors = []
const consoleErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })

const report = { steps: {}, pageErrors, consoleErrors, error: null }
const step = (name, value) => { report.steps[name] = value }
const shot = async (name) => { await page.screenshot({ path: join(OUT, `${name}.png`) }) }

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(9000)

  // 设置 → 插件节 → 本插件页。
  await page.evaluate(() => {
    const area = document.querySelector('[class*="settingsArea"]') || document.querySelector('[data-slot="sidebar.settings"]')
    const scoped = area ? [...area.querySelectorAll('button')] : []
    const hit = scoped[0] || [...document.querySelectorAll('button')].find((b) => /设置|Settings/.test((b.getAttribute('aria-label') || '') + (b.textContent || '')))
    if (hit) hit.click()
  })
  await page.waitForTimeout(2500)
  await page.evaluate(() => {
    const nav = document.querySelector('[role="dialog"] nav')
    if (!nav) return
    const hit = [...nav.querySelectorAll('button')].find((b) => /服务控制|Service control|dsh-service/i.test(b.textContent || ''))
    if (hit) hit.click()
  })
  await page.waitForTimeout(2500)
  step('tabFound', await page.evaluate(() => document.querySelector('[data-testid="service-tab-models"]') !== null))
  await page.click('[data-testid="service-tab-models"]')
  await page.waitForSelector('[data-testid="models-page"]', { timeout: 15000 })
  await page.waitForTimeout(3000)

  // 渠道列表 + 删除恢复入口（常驻，不随渠道行消失）。
  step('list', await page.evaluate(() => ({
    routeRows: [...document.querySelectorAll('[data-testid^="models-route-row-"]')].map((n) => n.getAttribute('data-testid')),
    rescueEntry: document.querySelector('[data-testid="models-route-rescue-toggle"]') !== null,
    createCard: document.querySelector('[data-testid="wb-create-card"]') !== null,
    createOpen: document.querySelector('[data-testid="wb-create-open"]') !== null,
    securityCard: document.querySelector('[data-testid="models-security-card"]') === null,
  })))
  await shot('01-list')

  // 进入第一个渠道详情（只读打开，不保存）。
  const firstRoute = report.steps.list.routeRows[0]
  const firstRouteId = firstRoute.replace('models-route-row-', '')
  await page.click(`[data-testid="models-route-${firstRouteId}"]`)
  await page.waitForTimeout(2500)
  step('detail', await page.evaluate(() => ({
    title: document.querySelector('[data-testid="models-provider-detail-title"]')?.textContent ?? null,
    tabs: [...document.querySelectorAll('[data-testid^="models-detail-tab-"]')].map((n) => n.getAttribute('data-testid')),
    search: document.querySelector('[data-testid="models-model-search"]') !== null,
    modelRows: [...document.querySelectorAll('[data-testid^="models-model-card-"]')].map((n) => n.getAttribute('data-testid')).slice(0, 5),
  })))
  await shot('02-detail-models')

  // 单模型独立编辑面板：保存按钮必须在面板内（不在长列表底部）。
  const modelRow = report.steps.detail.modelRows[0]
  if (modelRow !== undefined) {
    const modelId = modelRow.replace('models-model-card-', '')
    await page.click(`[data-testid="models-model-${modelId}"]`)
    await page.waitForTimeout(1200)
    step('modelPanel', await page.evaluate((id) => ({
      panelPresent: document.querySelector(`[data-testid="models-model-panel-${CSS.escape(id)}"]`) !== null,
      saveInPanel: document.querySelector(`[data-testid="models-edit-save-${CSS.escape(id)}"]`) !== null,
      effortRows: [...document.querySelectorAll('[data-testid^="models-effort-row-"]')].map((n) => n.getAttribute('data-testid')),
      effortRadios: ['absent', 'mapped', 'custom'].every((mode) => document.querySelector(`[data-testid="models-effort-high-${mode}-x"]`) !== null
        || document.querySelector(`[data-testid="models-effort-high-${mode}"]`) !== null),
      contextValue: document.querySelector(`[data-testid="models-edit-context-${CSS.escape(id)}"]`)?.value ?? null,
    }), modelId))
    await shot('03-model-panel')
  }

  // 连接信息页：地址边界文案 + 密钥字段不回显。
  await page.click('[data-testid="models-detail-tab-connection"]')
  await page.waitForTimeout(1500)
  step('connection', await page.evaluate(() => {
    const key = document.querySelector('[data-testid="models-conn-key"]')
    return {
      panelPresent: document.querySelector('[data-testid="models-connection-panel"]') !== null,
      urlHint: document.querySelector('[data-testid="models-connection-panel"]')?.textContent?.includes('只有公网 HTTPS') ?? false,
      keyType: key?.getAttribute('type') ?? null,
      keyValueEmpty: key === null ? null : key.value === '',
      apiSelect: document.querySelector('[data-testid="models-conn-api"]') !== null,
      baseURLInput: document.querySelector('[data-testid="models-conn-baseurl"]')?.value ?? null,
    }
  }))
  await shot('04-connection')

  // 撤销与删除页：删除按钮与（有快照时的）撤销入口都在默认路径可达。
  await page.click('[data-testid="models-detail-tab-danger"]')
  await page.waitForTimeout(1200)
  step('danger', await page.evaluate(() => ({
    panelPresent: document.querySelector('[data-testid="models-danger-panel"]') !== null,
    deleteBtn: document.querySelector('[data-testid="models-route-delete"]') !== null,
    undoOpen: document.querySelector('[data-testid="models-undo-open"]') !== null,
    undoUnavailable: document.querySelector('[data-testid="models-undo-unavailable"]') !== null,
  })))
  await shot('05-danger')

  // 添加面板：手动 ID 路径始终可用；进面板不发网（无网络请求证据由宿主侧计数保证）。
  await page.click('[data-testid="models-detail-tab-models"]')
  await page.waitForTimeout(1000)
  await page.click('[data-testid="models-add-open"]')
  await page.waitForTimeout(1200)
  step('add', await page.evaluate(() => ({
    panelPresent: document.querySelector('[data-testid="models-add-panel"]') !== null,
    manualButton: document.querySelector('[data-testid="models-add-source-manual"]') !== null,
    builtinButton: document.querySelector('[data-testid="models-add-source-builtin"]') !== null,
    onlineButton: document.querySelector('[data-testid="models-add-source-online"]') !== null,
  })))
  await page.click('[data-testid="models-add-source-manual"]')
  await page.waitForTimeout(800)
  step('addManual', await page.evaluate(() => ({
    manualIds: document.querySelector('[data-testid="models-add-manual-ids"]') !== null,
    prepareReachable: document.querySelector('[data-testid="models-add-prepare"]') !== null,
    prepareDisabledWhileEmpty: document.querySelector('[data-testid="models-add-prepare"]')?.disabled ?? null,
    detectionCheckbox: document.querySelector('[data-testid="models-add-allow-unverified"]') !== null,
  })))
  await shot('06-add-manual')

  report.summary = {
    pageErrorCount: pageErrors.length,
    consoleErrorCount: consoleErrors.length,
  }
} catch (error) {
  report.error = error?.message || String(error)
  await shot('99-error')
} finally {
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}

console.log(JSON.stringify(report, null, 2))
console.log('OUT=' + OUT)
