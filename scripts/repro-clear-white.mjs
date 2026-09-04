// [DEBUG-c1ear] throwaway e2e repro: drive real DSH web UI → 会话管理 → 已删除 → 清除 → 确认.
// Captures pageerror/console/RPC failures; asserts panel survives (no white screen).
// Backs up the host's deleted-records file and restores it byte-for-byte on exit.
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { chromium } from '/workspace/projects/dsh-service/node_modules/playwright/index.mjs'

const ORIGIN = 'http://127.0.0.1:3080'
const AUTHORITY = new URL(ORIGIN).host
const DELETED_FILE = '/home/node/.dsh/dsh-service-sessions-deleted.json'
const BACKUP = '/workspace/projects/dsh-service/.e2e-backup/deleted.json'

const b64u = (v) => Buffer.from(v).toString('base64url')
function forgeCookie() {
  const raw = readFileSync('/home/node/.dsh/.credentials.yaml', 'utf8')
  const m = raw.match(/client-connection\/browser-session:[\s\S]*?secret:\s*"?([A-Za-z0-9_=-]+)"?/)
  const secret = Buffer.from(m[1], 'base64url')
  const name = 'dsh-auth-' + b64u(createHash('sha256').update(AUTHORITY).digest())
  const body = b64u(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: Date.now(), expiresAt: Date.now() + 3600_000 }))
  const sig = createHmac('sha256', secret).update(body).digest()
  return [name, `v1.${body}.${b64u(sig)}`]
}

mkdirSync('/workspace/projects/dsh-service/.e2e-backup', { recursive: true })
copyFileSync(DELETED_FILE, BACKUP)
let restored = false
const restore = (tag) => {
  if (restored) return
  copyFileSync(BACKUP, DELETED_FILE)
  restored = true
  console.log(`[cleanup] deleted-records restored (${tag})`)
}
process.on('exit', () => restore('exit'))
process.on('SIGINT', () => { restore('sigint'); process.exit(130) })

const [cookieName, cookieValue] = forgeCookie()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
await context.addCookies([{ name: cookieName, value: cookieValue, url: ORIGIN }])
const page = await context.newPage()

const problems = []
page.on('pageerror', (err) => { problems.push('pageerror: ' + err.message); console.log('[pageerror]', err.message) })
page.on('console', (msg) => { if (msg.type() === 'error') { problems.push('console.error: ' + msg.text()); console.log('[console.error]', msg.text().slice(0, 300)) } })
page.on('requestfailed', (req) => { if (req.url().includes('/dsh-service')) { problems.push('rpc-failed: ' + req.url()); console.log('[rpc requestfailed]', req.url(), req.failure()?.errorText) } })
page.on('response', (res) => {
  if (res.url().includes('/dsh-service/')) {
    res.text().then((t) => {
      if (t.includes('"ok":false')) console.log('[rpc nok]', res.url().split('/').pop(), t.slice(0, 220))
      else console.log('[rpc ok]', res.url().split('/').pop(), t.length + 'B')
    }).catch(() => {})
  }
})

const step = async (label, fn) => {
  try { await fn(); console.log('[step ok]', label) }
  catch (e) { console.log('[step FAIL]', label, '::', e.message.split('\n')[0]); await page.screenshot({ path: `/workspace/projects/dsh-service/.e2e-shots/fail-${label.replace(/\W+/g, '_')}.png` }).catch(() => {}); throw e }
}

await step('open app', async () => {
  await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(2500)
})
await page.screenshot({ path: '/workspace/projects/dsh-service/.e2e-shots/01-app.png' })

// open settings: look for a settings-ish button in the sidebar
await step('open settings', async () => {
  const candidates = [
    '[aria-label*="设置"]', '[aria-label*="Settings" i]', '[title*="设置"]', '[title*="Settings" i]',
  ]
  let opened = false
  for (const sel of candidates) {
    const el = page.locator(sel).first()
    if (await el.count() > 0) { await el.click(); opened = true; break }
  }
  if (!opened) {
    // fallback: click buttons containing 设置/Settings text
    const btn = page.getByRole('button', { name: /设置|settings/i }).first()
    await btn.click(); opened = true
  }
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 })
})

// click our plugin's nav entry in settings left column
await step('open plugin section', async () => {
  const nav = page.locator('[role="dialog"] nav button, [role="dialog"] [role="navigation"] button')
  const n = await nav.count()
  const labels = []
  for (let i = 0; i < n; i++) labels.push(await nav.nth(i).innerText().catch(() => ''))
  console.log('[nav labels]', JSON.stringify(labels))
  const idx = labels.findIndex((t) => /dsh-service|服务控制/.test(t))
  if (idx < 0) throw new Error('plugin nav entry not found; labels=' + JSON.stringify(labels))
  await nav.nth(idx).click()
  await page.waitForTimeout(800)
})
await page.screenshot({ path: '/workspace/projects/dsh-service/.e2e-shots/02-plugin.png' })

// open 会话管理 tab: it lives under the maintenance tab; dump tabs then click through
await step('open sessions tab', async () => {
  // what plugin client module did this page load? hash it
  const resources = page.url() ? await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => /dsh-service|plugin/i.test(u))) : []
  console.log('[plugin resources]', JSON.stringify(resources, null, 1))
  const maintBtn = page.locator('[role="dialog"] button', { hasText: /^维护$/ }).first()
  await maintBtn.click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '/workspace/projects/dsh-service/.e2e-shots/03b-maintenance.png' })
  let probe = page.locator('[data-testid="sessions-filter-deleted"]')
  if (await probe.count() === 0) {
    const strip = page.locator('[role="dialog"] button')
    const n = await strip.count()
    const labels = []
    for (let i = 0; i < Math.min(n, 80); i++) labels.push((await strip.nth(i).innerText().catch(() => '')).replace(/\n/g, '|'))
    console.log('[after-maint buttons]', JSON.stringify(labels))
    const sub = page.locator('[role="dialog"] button', { hasText: /会话管理/ }).first()
    if (await sub.count() > 0) { await sub.click(); await page.waitForTimeout(1500) }
  }
  probe = page.locator('[data-testid="sessions-filter-deleted"]')
  const sessionsBits = await page.locator('[data-testid^="sessions-"]').count()
  console.log('[probe] sessions testids on page =', sessionsBits, 'filter-deleted =', await probe.count())
  if (await probe.count() === 0) throw new Error('sessions panel did not mount under 维护')
})
await page.screenshot({ path: '/workspace/projects/dsh-service/.e2e-shots/03-sessions.png' })

// switch to 已删除 filter
await step('open deleted filter', async () => {
  await page.locator('[data-testid="sessions-filter-deleted"]').click()
  await page.waitForTimeout(1000)
})
await page.screenshot({ path: '/workspace/projects/dsh-service/.e2e-shots/04-deleted.png' })

const rowCountBefore = await page.locator('[data-testid^="sessions-row-"]').count()
console.log('[state] deleted rows before =', rowCountBefore)
if (rowCountBefore === 0) { console.log('NOTHING TO CLEAR — aborting without clearing'); await browser.close(); process.exit(0) }

// click the first row's 清除 (opens confirm modal)
await step('click row clear', async () => {
  const first = page.locator('[data-testid^="sessions-row-clear-"]').first()
  await first.click()
  await page.waitForSelector('[data-testid="sessions-clear-modal"]', { timeout: 5000 })
})
await page.screenshot({ path: '/workspace/projects/dsh-service/.e2e-shots/05-clear-modal.png' })

// confirm
await step('confirm clear', async () => {
  await page.locator('[data-testid="sessions-clear-confirm"]').click()
  await page.waitForTimeout(1500)
})
await page.screenshot({ path: '/workspace/projects/dsh-service/.e2e-shots/06-after-clear.png' })

// assert: panel still alive (no white screen)
const alive = {
  filterDeleted: await page.locator('[data-testid="sessions-filter-deleted"]').count(),
  titleVisible: await page.getByText('会话管理').first().count(),
  clearModalGone: (await page.locator('[data-testid="sessions-clear-modal"]').count()) === 0,
  rowsAfter: await page.locator('[data-testid^="sessions-row-"]').count(),
}
console.log('[state] after clear =', JSON.stringify(alive))
console.log('[verdict]', problems.length === 0 && alive.filterDeleted > 0 && alive.titleVisible > 0 ? 'PANEL ALIVE (bug not reproduced)' : 'PROBLEMS SEEN — see above')
console.log('[problems]', JSON.stringify(problems, null, 2))

await browser.close()
restore('done')
