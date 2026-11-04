import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

// 移动端沉浸态「抽屉入口」联动回归（独立用例，不并进 test/client.test.js）。
//
// 背景机制：0.2.2-alpha.3 起官方把 shell.leading 座从「macOS 折叠专用」扩成所有抽屉态
// （AppFrame `leadingMounted = drawer || darwin && sidebarCollapsed`），web 窄屏由
// HeaderLeadingControls 渲染原生抽屉钮 `[data-sidebar-opener]`。该座是帧根下的独立
// absolute 覆盖件（`[data-shell-leading]`），不在会话头部内部 —— 沉浸态头部
// `translateY(-100%)` 上滑时它不会跟着走。插件 FAB 在官方钮在位时已让位
// （`body:has([data-sidebar-opener]) [data-dshsvc-fab]{display:none}`），于是
// 全屏阅读区左上角残留一枚抽屉钮：正是这条用例要守住的联动。
//
// 两段验证：
//   1) 源码/CSS 静态断言（任何环境都跑）：规则存在、作用域在 html[data-dshsvc-mobile]、
//      隐藏由沉浸标记驱动、reduced-motion 覆盖、旧 FAB 路径不受影响（老宿主回退）。
//   2) 真实浏览器（Playwright Chromium，**显式 opt-in**，默认 skip）：载入**源码里的实际
//      MOBILE_CSS** + 复刻官方接缝的最小 DOM，按引擎真实输出（html[data-dshsvc-immersive]
//      属性）驱动，断言计算样式与退出恢复。默认 `npm test` 不触 playwright/浏览器，
//      避免给常规单测引入依赖；需要计算样式取证时单跑：
//        DSHSVC_MOBILE_BROWSER=1 PLAYWRIGHT_BROWSERS_PATH=... LD_LIBRARY_PATH=... \
//          FONTCONFIG_FILE=... node --test test/mobile-immersive-controls.test.js
//      （e2e 环境见 docs/internals/e2e-browser-env.md；run.sh 只接受 .dsh-e2e/scripts/
//      下的脚本名，本用例在仓库 test/ 下，故用文档记载的内联 env 等价入口。）

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mobileSource = readFileSync(resolve(root, 'src/client/mobile.js'), 'utf8')

/** 从移动端分片抽出权威样式表文本（模板字面量无插值，逐字取用）。 */
function extractMobileCss(source) {
  const backtick = String.fromCharCode(96)
  const marker = `const MOBILE_CSS = ${backtick}`
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'src/client/mobile.js must declare MOBILE_CSS')
  const end = source.indexOf(`${backtick}\n`, start + marker.length)
  assert.ok(end > start, 'MOBILE_CSS template literal must terminate')
  const css = source.slice(start + marker.length, end)
  assert.ok(css.length > 40_000, `MOBILE_CSS extraction must be non-empty (saw ${css.length} chars)`)
  assert.ok(!css.includes(`$${'{'}`), 'MOBILE_CSS must stay a static template (no interpolation)')
  return css
}

const MOBILE_CSS = extractMobileCss(mobileSource)

/** 取某选择器（逐字匹配、允许换行空白）的声明块正文列表。 */
function ruleBodies(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g')
  return [...css.matchAll(re)].map((match) => match[1])
}

/** 取全部 @media 块正文（按花括号配平，避免被块内单行规则或多块同名查询干扰）。 */
function mediaBlocks(css, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`@media ${escaped} \\{`, 'g')
  const blocks = []
  let match
  while ((match = re.exec(css)) !== null) {
    const bodyStart = match.index + match[0].length
    let depth = 1
    let index = bodyStart
    for (; index < css.length && depth > 0; index += 1) {
      if (css[index] === '{') depth += 1
      else if (css[index] === '}') depth -= 1
    }
    assert.equal(depth, 0, `@media ${query} block must be balanced`)
    blocks.push(css.slice(bodyStart, index - 1))
    re.lastIndex = index
  }
  assert.ok(blocks.length > 0, `@media ${query} block must exist`)
  return blocks
}

/** 扁平化取出样式表里的规则（选择器 + 声明块）；@media 内的规则同样被拆出。 */
function cssRules(css) {
  const rules = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match
  while ((match = re.exec(css)) !== null) rules.push({ selector: match[1].trim(), body: match[2] })
  return rules
}

const MOBILE_SCOPE = 'html[data-dshsvc-mobile]'
const IMMERSIVE_SCOPE = 'html[data-dshsvc-mobile][data-dshsvc-immersive]'
const LEADING_SEAT = '[data-shell-leading]'
const OPENER = '[data-sidebar-opener]'
const FAB = '[data-dshsvc-fab]'
const LEADING_SELECTOR = `${MOBILE_SCOPE} body:has(${OPENER}) ${LEADING_SEAT}`
const LEADING_IMMERSIVE_SELECTOR = `${IMMERSIVE_SCOPE} body:has(${OPENER}) ${LEADING_SEAT}`

test('official drawer control (shell.leading seat) follows the immersive flag in CSS', () => {
  // 过渡常驻在座位上，隐藏只由沉浸属性驱动：非沉浸态必须可点可见。
  // （同一选择器也会以逗号列表成员出现在 prefers-reduced-motion 块里，按声明内容区分。）
  const baseRules = ruleBodies(MOBILE_CSS, LEADING_SELECTOR)
  const transitionRules = baseRules.filter((body) => /transition:\s*transform/.test(body))
  assert.equal(transitionRules.length, 1, 'exactly one base transition rule for the official leading seat')
  assert.match(transitionRules[0], /transition:\s*transform[^;]*var\(--ds-transition-duration-slow, \.25s\)/)
  assert.match(transitionRules[0], /opacity\s+var\(--ds-transition-duration-slow, \.25s\)/)
  assert.equal(baseRules.filter((body) => /opacity:\s*0/.test(body)).length, 0, 'base rule must not hide the seat')

  const hideRules = ruleBodies(MOBILE_CSS, LEADING_IMMERSIVE_SELECTOR)
  const hidingBodies = hideRules.filter((body) => /opacity:\s*0/.test(body))
  assert.equal(hidingBodies.length, 1, 'exactly one immersive rule for the official leading seat')
  for (const declaration of [
    'transform: translateY(calc(0px - var(--dshsvc-header-h, 76px) - env(safe-area-inset-top, 0px))) !important',
    'opacity: 0 !important',
    'pointer-events: none !important',
  ]) {
    assert.ok(hidingBodies[0].includes(declaration), `immersive rule must declare \`${declaration}\`\n${hidingBodies[0]}`)
  }

  // 退出恢复靠「移除属性即不再命中」：所有涉及该座的选择器都必须留在移动端作用域并
  // 以官方钮为门（老宿主/无钮时整条空转）；唯一的隐藏规则必须由沉浸标记驱动，
  // 否则回显后抽屉钮再也回不来。
  const leadingRules = cssRules(MOBILE_CSS).filter((rule) => rule.selector.includes(LEADING_SEAT))
  assert.ok(leadingRules.length >= 2, `expected transition + immersive rules for the leading seat, saw ${leadingRules.length}`)
  for (const rule of leadingRules) {
    assert.ok(rule.selector.includes(MOBILE_SCOPE), `leading-seat rule must stay inside the mobile scope: ${rule.selector}`)
    assert.ok(rule.selector.includes(`body:has(${OPENER})`), `leading-seat rule must be gated on the official opener: ${rule.selector}`)
  }
  const hidingRules = leadingRules.filter((rule) => /opacity:\s*0/.test(rule.body))
  assert.equal(hidingRules.length, 1, 'exactly one leading-seat rule hides it')
  assert.ok(hidingRules[0].selector.includes(`${MOBILE_SCOPE}[data-dshsvc-immersive]`),
    `leading-seat hiding must be driven by the immersive flag: ${hidingRules[0].selector}`)
})

test('legacy FAB keeps its own immersive rule and lets the official opener win (old-host fallback)', () => {
  // 官方钮在位即藏 FAB：两枚同功能钮不并存（老宿主无该座、规则空转，FAB 照常）。
  const yieldRules = ruleBodies(MOBILE_CSS, `${MOBILE_SCOPE} body:has(${OPENER}) ${FAB}`)
  assert.equal(yieldRules.length, 1)
  assert.match(yieldRules[0], /display:\s*none !important/)

  // FAB 自身沉浸规则不得依赖 :has（老宿主无官方钮时仍要能隐藏）。
  const fabHidden = ruleBodies(MOBILE_CSS, `${IMMERSIVE_SCOPE} ${FAB}`)
  assert.equal(fabHidden.length, 1, 'legacy FAB immersive rule must survive')
  assert.match(fabHidden[0], /opacity:\s*0 !important/)
  assert.match(fabHidden[0], /pointer-events:\s*none !important/)
  assert.match(fabHidden[0], /transform: translateY\(calc\(0px - var\(--dshsvc-header-h, 76px\)/)
})

test('reduced motion disables the immersive transition for both drawer controls', () => {
  // 样式表里有多个 prefers-reduced-motion 块（动画抑制、抽屉动画等），取覆盖抽屉控件的那一块。
  const block = mediaBlocks(MOBILE_CSS, '(prefers-reduced-motion: reduce)')
    .find((candidate) => candidate.includes(FAB) && candidate.includes(LEADING_SEAT))
  assert.ok(block !== undefined, 'a prefers-reduced-motion block must cover both drawer controls')
  const selectors = block.split(',').map((line) => line.trim()).filter(Boolean)
  const covers = (element) => selectors.some((selector) => selector.includes(element) && selector.includes(MOBILE_SCOPE))
  assert.ok(covers(FAB), `reduced-motion block must cover the legacy FAB\n${block}`)
  assert.ok(covers(LEADING_SEAT), `reduced-motion block must cover the official leading seat\n${block}`)
  assert.ok(selectors.filter((selector) => selector.includes(LEADING_SEAT)).every((selector) => selector.includes(`body:has(${OPENER})`)),
    'reduced-motion leading-seat selectors must keep the official-opener gate')
  assert.equal((block.match(/transition: none !important/g) ?? []).length, 1, 'single transition: none declaration for the whole list')
})

// ── 真实浏览器（显式 opt-in）：实际 MOBILE_CSS + 复刻官方接缝的最小 DOM ────────
//
// 默认跳过：常规 `npm test` 不 import playwright、不启动浏览器，静态断言已守护规则形状。
// 取证时以 DSHSVC_MOBILE_BROWSER=1 启用；Chromium 从 /workspace/node_modules（工作区共享）
// 解析，浏览器二进制需在**进程启动前**注入 PLAYWRIGHT_BROWSERS_PATH / LD_LIBRARY_PATH
// （playwright 在模块加载时快照 env，见 docs/internals/e2e-browser-env.md）。

const BROWSER_ENV = 'DSHSVC_MOBILE_BROWSER'
const browserOptIn = process.env[BROWSER_ENV] === '1'

let browser = null
const browserSkipReason = browserOptIn ? null : `real-browser checks are opt-in: set ${BROWSER_ENV}=1 (see docs/internals/e2e-browser-env.md)`
if (browserOptIn) {
  // Explicit verification must fail, not silently skip, when its browser is unavailable.
  const { chromium } = await import('playwright')
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
}
after(async () => {
  if (browser !== null) await browser.close()
})

const REVEAL_SETTLE_MS = 400 // 官方 --ds-transition-duration-slow 兜底 .25s，留一个数量级的余量

/**
 * 最小 DOM：复刻 0.2.2-alpha.3 帧根接缝。
 * 官方类哈希 pI_x6G_leadingSeat 的 absolute 定位几何用内联样式等价复刻，
 * 避免把版本哈希/具体像素值写进用例；MOBILE_CSS 走 addStyleTag 真实生效。
 */
function pageHtml({ officialSeat }) {
  return `<!doctype html>
<html data-dshsvc-mobile style="--dshsvc-header-h:76px">
<head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  body { width: 390px; height: 844px; }
  #frame { position: relative; width: 390px; height: 844px; }
  [data-shell-leading] { position: absolute; top: 11px; left: 12px; z-index: 15; display: flex; align-items: center; }
  [data-sidebar-opener] { width: 28px; height: 28px; }
  [data-dshsvc-chat-header] { height: 76px; }
</style></head>
<body>
  <div id="frame">
    ${officialSeat ? `<div data-shell-leading><button data-sidebar-opener type="button" aria-label="打开侧栏">opener</button></div>` : ''}
    <header data-dshsvc-chat-header>header</header>
  </div>
  <button data-dshsvc-fab type="button" aria-label="打开侧栏"
    style="position:fixed;left:calc(env(safe-area-inset-left, 0px) + 10px);top:calc(env(safe-area-inset-top, 0px) + 12px);width:32px;height:32px;z-index:33;display:flex">fab</button>
</body></html>`
}

async function openPage({ officialSeat, reducedMotion = false }) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  })
  const page = await context.newPage()
  await page.setContent(pageHtml({ officialSeat }))
  await page.addStyleTag({ content: MOBILE_CSS })
  return { context, page }
}

/** 读计算样式：位移统一折算成 translateY 像素（transform 矩阵 m42）。 */
function readState(page) {
  return page.evaluate(() => {
    const style = (element) => {
      if (element === null) return null
      const computed = getComputedStyle(element)
      const matrix = computed.transform === 'none' ? null : new DOMMatrixReadOnly(computed.transform)
      return {
        display: computed.display,
        opacity: computed.opacity,
        pointerEvents: computed.pointerEvents,
        translateY: matrix === null ? 0 : Math.round(matrix.m42 * 100) / 100,
        transitionProperty: computed.transitionProperty,
        transitionDuration: computed.transitionDuration,
      }
    }
    return {
      immersive: document.documentElement.hasAttribute('data-dshsvc-immersive'),
      seat: style(document.querySelector('[data-shell-leading]')),
      opener: style(document.querySelector('[data-sidebar-opener]')),
      fab: style(document.querySelector('[data-dshsvc-fab]')),
    }
  })
}

async function setImmersive(page, on) {
  await page.evaluate((flag) => {
    if (flag) document.documentElement.setAttribute('data-dshsvc-immersive', '')
    else document.documentElement.removeAttribute('data-dshsvc-immersive')
  }, on)
}

test('browser: official shell.leading drawer control slides away in immersive and returns on exit', async (t) => {
  if (browser === null) return t.skip(browserSkipReason)
  const { context, page } = await openPage({ officialSeat: true })
  try {
    const baseline = await readState(page)
    // 非沉浸态：官方钮可见可点，座位带过渡（联动的前提）。
    assert.equal(baseline.immersive, false)
    assert.equal(baseline.seat.display, 'flex')
    assert.equal(baseline.seat.opacity, '1')
    assert.equal(baseline.seat.pointerEvents, 'auto')
    assert.equal(baseline.seat.translateY, 0)
    assert.match(baseline.seat.transitionProperty, /transform/)
    assert.match(baseline.seat.transitionProperty, /opacity/)
    // 官方钮在位时插件 FAB 让位：两者不得同时出现在左上角。
    assert.equal(baseline.fab.display, 'none')

    await setImmersive(page, true)
    await page.waitForTimeout(REVEAL_SETTLE_MS)
    const hidden = await readState(page)
    assert.equal(hidden.immersive, true)
    assert.equal(hidden.seat.opacity, '0', 'official drawer control must fade out in immersive mode')
    assert.equal(hidden.seat.pointerEvents, 'none', 'immersive leftover must not swallow taps')
    assert.ok(Number.isFinite(hidden.seat.translateY) && hidden.seat.translateY <= -70 && hidden.seat.translateY >= -82,
      `official drawer control must slide up with the header (saw translateY=${hidden.seat.translateY})`)

    await setImmersive(page, false)
    await page.waitForTimeout(REVEAL_SETTLE_MS)
    const restored = await readState(page)
    assert.equal(restored.immersive, false)
    assert.equal(restored.seat.opacity, '1', 'official drawer control must come back on immersive exit')
    assert.equal(restored.seat.pointerEvents, 'auto')
    assert.equal(restored.seat.translateY, 0)
    assert.equal(restored.seat.display, 'flex')
  } finally {
    await context.close()
  }
})

test('browser: legacy host without the official seat still hides the plugin FAB in immersive', async (t) => {
  if (browser === null) return t.skip(browserSkipReason)
  const { context, page } = await openPage({ officialSeat: false })
  try {
    const baseline = await readState(page)
    assert.equal(baseline.seat, null, 'legacy shell has no shell.leading seat')
    assert.equal(baseline.fab.display, 'flex', 'legacy FAB must remain the drawer entry')
    assert.equal(baseline.fab.opacity, '1')

    await setImmersive(page, true)
    await page.waitForTimeout(REVEAL_SETTLE_MS)
    const hidden = await readState(page)
    assert.equal(hidden.fab.opacity, '0')
    assert.equal(hidden.fab.pointerEvents, 'none')
    assert.ok(Number.isFinite(hidden.fab.translateY) && hidden.fab.translateY <= -70 && hidden.fab.translateY >= -82,
      `legacy FAB must slide up with the header (saw translateY=${hidden.fab.translateY})`)

    await setImmersive(page, false)
    await page.waitForTimeout(REVEAL_SETTLE_MS)
    const restored = await readState(page)
    assert.equal(restored.fab.opacity, '1')
    assert.equal(restored.fab.pointerEvents, 'auto')
    assert.equal(restored.fab.translateY, 0)
    assert.equal(restored.fab.display, 'flex')
  } finally {
    await context.close()
  }
})

test('browser: reduced motion applies the immersive state instantly for both drawer controls', async (t) => {
  if (browser === null) return t.skip(browserSkipReason)
  const withSeat = await openPage({ officialSeat: true, reducedMotion: true })
  try {
    const { page } = withSeat
    const baseline = await readState(page)
    assert.equal(baseline.seat.transitionDuration, '0s', 'reduced motion must disable the seat transition')
    assert.equal(baseline.fab.transitionDuration, '0s', 'reduced motion must disable the FAB transition')

    await setImmersive(page, true)
    // 无过渡 ⇒ 同一帧即可读到终态，不等待。
    const hidden = await readState(page)
    assert.equal(hidden.seat.opacity, '0')
    assert.equal(hidden.seat.pointerEvents, 'none')
    assert.ok(hidden.seat.translateY <= -70 && hidden.seat.translateY >= -82)

    await setImmersive(page, false)
    const restored = await readState(page)
    assert.equal(restored.seat.opacity, '1')
    assert.equal(restored.seat.translateY, 0)
  } finally {
    await withSeat.context.close()
  }

  const legacy = await openPage({ officialSeat: false, reducedMotion: true })
  try {
    const { page } = legacy
    const baseline = await readState(page)
    assert.equal(baseline.fab.transitionDuration, '0s')
    await setImmersive(page, true)
    const hidden = await readState(page)
    assert.equal(hidden.fab.opacity, '0')
    assert.ok(hidden.fab.translateY <= -70 && hidden.fab.translateY >= -82)
  } finally {
    await legacy.context.close()
  }
})
