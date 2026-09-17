/**
 * 模型厂家/渠道图标 · 构建期 vendoring 生成器（manual，需联网）
 *
 * 产出 `src/model-icons.generated.js`（已入库）；`scripts/build-client.mjs` 只把它
 * 内联进 `client.js`——**构建本身不联网**，离线可重现。图标更新时手动跑本脚本。
 *
 * 图标源：`@lobehub/icons-static-svg`（MIT；品牌图形归各厂商，见
 * docs/planning/model-icons.md 的来源与许可一节）。版本**钉死**，不用 @latest：
 * 运行期解析到新版本会让 slug 漂移、图标静默变白块。
 *
 * 图标库未收录、或收录的图形不适用的品牌写在下方 `CUSTOM_SVG`（本地手绘，键 = slug）；
 * 生成时优先于 CDN 取用，避免为一个查不到的 slug 去打网络。
 *
 * 产出前统一把每个图标的 viewBox 收紧到真实绘制范围（getBBox），使所有图标等大地
 * 填满各自的框——各品牌在 24 格里的留白差异极大（实测占比 0.55~1.00），不收紧就会
 * 出现「同一 CSS 尺寸却视觉大小参差」。
 *
 * 分档（决定渲染路径）：
 *   - `mono`  用 `-webkit-mask` + `background-color: currentColor` 渲染——颜色完全
 *             交给主题文字色，深浅色零特判（实测：浅色 rgb(97,102,107) / 暗色
 *             rgb(207,211,214) 自动跟随）。
 *   - `color` 用 `background-image` 原样渲染品牌色。
 *   - **单色兜底**（用户定稿）：品牌色在浅底或深底任一侧对比度 < 3.0 的，一律
 *             回落到 mono 路径，不保留品牌色——避免「浅色模式下就看不见」。
 *   - 既无可读品牌色、又拿不到可用图形 → 不入表，客户端回落官方默认图标。
 *
 * 用法：node scripts/generate-model-icons.mjs
 */
import { writeFile } from 'node:fs/promises'
import { renderCatalog } from './model-icons-catalog.mjs'

const VERSION = '1.95.0'
const CDN = `https://unpkg.com/@lobehub/icons-static-svg@${VERSION}/icons/`
const LIGHT_BG = '#ffffff'
const DARK_BG = '#17181c' // 外壳暗色面板色（与插件既有的 --dsh-svc-page-bg 兜底同值）
const MIN_CONTRAST = 3.0

/**
 * provider 键 → 图标 slug。覆盖 pi-ai 内置全部 provider（40 个，含按区域/计费
 * 拆分的变体）与市占率较高的补充厂商/渠道。slug 取 LobeHub 的品牌名（非模型名）。
 */
const ENTRIES = [
  // ── pi-ai 官方直连 ────────────────────────────────────────────────
  ['openai', 'openai'],
  ['openai-codex', 'openai'],
  ['anthropic', 'anthropic'],
  ['google', 'gemini'],
  ['google-vertex', 'vertexai'],
  ['xai', 'xai'],
  ['mistral', 'mistral'],
  ['deepseek', 'deepseek'],
  ['moonshotai', 'moonshot'],
  ['moonshotai-cn', 'moonshot'],
  ['kimi-coding', 'kimi'],
  ['minimax', 'minimax'],
  ['minimax-cn', 'minimax'],
  ['zai', 'zhipu'],
  ['zai-coding-cn', 'zhipu'],
  ['xiaomi', 'xiaomi'],
  ['xiaomi-token-plan-ams', 'xiaomi'],
  ['xiaomi-token-plan-cn', 'xiaomi'],
  ['xiaomi-token-plan-sgp', 'xiaomi'],
  ['nvidia', 'nvidia'],
  ['huggingface', 'huggingface'],
  ['qwen-token-plan', 'qwen'],
  ['qwen-token-plan-cn', 'qwen'],
  ['qwen-token-plan-individual', 'qwen'],
  // ── pi-ai 聚合网关 / 云平台 / 托管 ────────────────────────────────
  ['openrouter', 'openrouter'],
  ['vercel-ai-gateway', 'vercel'],
  ['cloudflare-ai-gateway', 'cloudflare'],
  ['cloudflare-workers-ai', 'cloudflare'],
  ['amazon-bedrock', 'bedrock'],
  ['azure-openai-responses', 'azure'],
  ['together', 'together'],
  ['fireworks', 'fireworks'],
  ['baseten', 'baseten'],
  ['cerebras', 'cerebras'],
  ['groq', 'groq'],
  // ── pi-ai 订阅套餐 / 编码端点 ────────────────────────────────────
  ['github-copilot', 'github'],
  ['opencode', 'opencode'],
  ['opencode-go', 'opencode'],
  // ── 图标库未收录、用户点名要的品牌（本地手绘，见 CUSTOM_SVG）────────
  ['command-goat', 'commandcode'],
  ['commandcode', 'commandcode'],
  ['command-code', 'commandcode'],
  // ── 市占率补充（用户点名「查缺补漏」）────────────────────────────
  ['ollama', 'ollama'],
  ['vllm', 'vllm'],
  ['lmstudio', 'lmstudio'],
  ['perplexity', 'perplexity'],
  ['cohere', 'cohere'],
  ['ai21', 'ai21'],
  ['voyage', 'voyage'],
  ['deepinfra', 'deepinfra'],
  ['sambanova', 'sambanova'],
  ['novita', 'novita'],
  ['hyperbolic', 'hyperbolic'],
  ['targon', 'targon'],
  ['parasail', 'parasail'],
  ['lambda', 'lambda'],
  ['fal', 'fal'],
  ['replicate', 'replicate'],
  ['midjourney', 'midjourney'],
  ['stability', 'stability'],
  ['suno', 'suno'],
  ['elevenlabs', 'elevenlabs'],
  ['fishaudio', 'fishaudio'],
  ['assemblyai', 'assemblyai'],
  ['siliconcloud', 'siliconcloud'],
  ['volcengine', 'volcengine'],
  ['doubao', 'doubao'],
  ['hunyuan', 'hunyuan'],
  ['yuanbao', 'yuanbao'],
  ['stepfun', 'stepfun'],
  ['sensenova', 'sensenova'],
  ['baichuan', 'baichuan'],
  ['yi', 'yi'],
  ['codex', 'codex'],
  ['grok', 'grok'],
  ['gemini', 'gemini'],
]

/** 客户端前缀/别名匹配规则（自定义渠道名 → slug），与上表同源生成。 */
const PREFIX_RULES = [
  ['openrouter', 'openrouter'],
  ['opencode-go', 'opencode'],
  ['opencode', 'opencode'],
  ['openai-codex', 'openai'],
  ['openai', 'openai'],
  ['azure', 'azure'],
  ['bedrock', 'bedrock'],
  ['anthropic', 'anthropic'],
  ['claude', 'anthropic'],
  ['gemini', 'gemini'],
  ['google', 'gemini'],
  ['vertex', 'vertexai'],
  ['deepseek', 'deepseek'],
  ['moonshot', 'moonshot'],
  ['kimi', 'kimi'],
  ['minimax', 'minimax'],
  ['zhipu', 'zhipu'],
  ['zai', 'zhipu'],
  ['glm', 'zhipu'],
  ['xiaomi', 'xiaomi'],
  ['mimo', 'xiaomi'],
  ['qwen', 'qwen'],
  ['nvidia', 'nvidia'],
  ['huggingface', 'huggingface'],
  ['vercel', 'vercel'],
  ['cloudflare', 'cloudflare'],
  ['together', 'together'],
  ['fireworks', 'fireworks'],
  ['baseten', 'baseten'],
  ['cerebras', 'cerebras'],
  ['groq', 'groq'],
  ['github', 'github'],
  ['copilot', 'github'],
  ['perplexity', 'perplexity'],
  ['cohere', 'cohere'],
  ['ollama', 'ollama'],
  ['vllm', 'vllm'],
  ['lmstudio', 'lmstudio'],
  ['siliconcloud', 'siliconcloud'],
  ['siliconflow', 'siliconcloud'],
  ['volcengine', 'volcengine'],
  ['doubao', 'doubao'],
  ['hunyuan', 'hunyuan'],
  ['yuanbao', 'yuanbao'],
  ['stepfun', 'stepfun'],
  ['sensenova', 'sensenova'],
  ['baichuan', 'baichuan'],
  ['xai', 'xai'],
  ['grok', 'grok'],
  ['mistral', 'mistral'],
]

function srgbToLinear(channel) {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)
}

function contrast(a, b) {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

async function fetchSvg(slug) {
  const res = await fetch(CDN + slug + '.svg')
  if (!res.ok) return null
  const text = await res.text()
  return text.startsWith('<svg') ? text : null
}

/**
 * 归一化：剥掉 title/width/height/style，只留 viewBox 与图形本体。
 * 我们的 CSS 用 em 尺寸控制大小，源尺寸属性留着只会打架。
 */
function normalize(svg) {
  const viewBoxMatch = svg.match(/viewBox="([^"]+)"/)
  const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 24 24'
  const inner = svg
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { viewBox, inner }
}

/**
 * 把每个图标的 viewBox 收紧到它真实的**墨迹**范围，使所有图标等大地填满自己的框。
 *
 * 为什么必须做：各品牌图形在 24 格里的留白差异极大（实测占比 0.55~1.00），统一 CSS
 * 尺寸下视觉大小参差——⌘ 曾经只占 55%，画出来比额度圆环还小一圈。
 *
 * **必须量「墨迹」而不是 `getBBox()`**：`getBBox()` 只算几何路径，**不含描边**。
 * 描边图形（⌘ 就是）会向外多出半个线宽，用它当 viewBox 会把描边裁掉——真机上
 * 表现为四个环的角被削平。这里改用画布：把图形放大渲染、读 alpha 通道求紧包围盒，
 * 描边/填充/渐变一并计入，再换算回原始 viewBox 坐标。
 */
async function tightenViewBoxes(entries) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent('<html><body></body></html>')
  const measured = await page.evaluate(async (items) => {
    const RENDER = 480 // 渲染边长：够大以保证亚像素精度
    const out = []
    for (const item of items) {
      const vb = item.viewBox.split(/\s+/).map(Number)
      const [vx, vy, vw, vh] = vb
      // **测量必须以「加白方形」渲染**：SVG 默认裁剪到 viewBox，用原 viewBox 量的话
      // 永远看不到超出它的墨迹（描边向外多出的半个线宽），于是既发现不了溢出、也修
      // 不了它——生成出来的 viewBox 会恰好等于原值，而真机上外圈被削平（本图标就
      // 这样踩过一次）。加白后墨迹完整可见，再按加白量换算回原始坐标。
      const pad = Math.max(vw, vh) * 0.2
      const side = Math.max(vw, vh) + pad * 2
      const cx0 = vx + vw / 2
      const cy0 = vy + vh / 2
      const mvx = cx0 - side / 2
      const mvy = cy0 - side / 2
      // 直接拼 SVG 字符串交给 <img> 解码：不经 DOM 宿主。挂到文档里的 div 会带进
      // 宿主样式、且离屏容器可能让 Chromium 不解码（实测 61 个全部量不到墨迹）。
      // color/fill 必须显式给：源图形大量用 currentColor，而 data-URI 是独立文档
      // 上下文，没有可继承的 color（与渲染端同一个坑）。
      const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${mvx} ${mvy} ${side} ${side}" width="${RENDER}" height="${RENDER}" color="#000" fill="#000">${item.inner}</svg>`
      let ink = null
      try {
        const img = new Image()
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
        await img.decode()
        const c = document.createElement('canvas')
        c.width = RENDER; c.height = RENDER
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0, RENDER, RENDER)
        const d = g.getImageData(0, 0, RENDER, RENDER).data
        let minX = RENDER, minY = RENDER, maxX = -1, maxY = -1
        for (let y = 0; y < RENDER; y++) {
          for (let x = 0; x < RENDER; x++) {
            if (d[((y * RENDER) + x) * 4 + 3] < 16) continue
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
        if (maxX >= 0) {
          // 画布像素 → 原始 viewBox 坐标（加白方形是等比缩放到 RENDER 的）
          const scale = side / RENDER
          ink = {
            x: mvx + minX * scale,
            y: mvy + minY * scale,
            w: (maxX - minX + 1) * scale,
            h: (maxY - minY + 1) * scale,
          }
        }
      } catch (err) { ink = null; window.__inkErr = String((err && err.message) || err) }
      out.push({ key: item.key, ink })
    }
    out.push({ key: '__err', ink: null, err: window.__inkErr || null })
    return out
  }, entries.map((e) => ({ key: e.key, viewBox: e.viewBox, inner: e.inner })))
  await browser.close()
  const errEntry = measured.find((m) => m.key === '__err')
  if (errEntry && errEntry.err) console.log('  [ink measurement error]', errEntry.err)
  return new Map(measured.filter((m) => m.key !== '__err').map((m) => [m.key, m.ink]))
}

/** 抽取 SVG 中所有硬编码色值（fill / stop-color），用于对比度判定。 */
function hardcodedColors(svg) {
  const found = new Set()
  for (const m of svg.matchAll(/(?:fill|stop-color)="(#[0-9a-fA-F]{6})"/g)) found.add(m[1].toLowerCase())
  return [...found]
}

const isCurrentColor = (svg) => /fill="currentColor"/.test(svg)

/**
 * 图标库里没有、或**收录的图形在这个尺寸下不可用**的品牌：本地手绘 SVG，键与
 * ENTRIES 的 slug 对齐。走 mono 档（无硬编码色 → 自动回落），并在 report 里标
 * `custom` 以便核对。
 *
 * 已收录：
 *   - Command Code（commandcode.ai，本机 `command-goat` 渠道）——取其网站 favicon 里的
 *     ⌘ 符号线条。**刻意不搬「黑底圆角方块」那层板子**：我们的图标只有 15px、且要跟随
 *     深浅主题文字色，整块板子会糊成一枚纯色色块，⌘ 镂空看不清。
 *   - Xiaomi（`xiaomi-token-plan-*` 渠道）——**换掉图标库的 xiaomimimo**，理由见下方注释。
 */
const CUSTOM_SVG = {
  // ⌘（U+2318）——按 Unicode 字形比例手工构造，参数经与 DejaVu/Noto 的字体渲染
  // 并排放大比对定稿（对照脚本见 scripts/compare-command-glyph.mjs）：
  //   b=4.6   中央方框半边长
  //   r=3.0   环半径（孔洞必须留得出来，否则糊成实心块）
  //   s=1.85  描边宽（Unicode 字形比想象中细；2.0 以上孔洞就开始闭合）
  // 环心位于 ±(b+r)=±7.6，与方框边的端点**精确相切**（距离恰为 r，不是近似）。
  //
  // 三处踩过的坑（都别再犯）：
  //  ① 环心放在方框**角点**上（旧版）：环有一半落在框内，四条边被盖住，读成
  //     「四环 + 中间一个 X」而非 ⌘。
  //  ② 描边过粗/环过小：孔洞闭合，整体糊成一坨实心块。
  //  ③ **声明不相切**：写了 r 却没让「环心到边的距离」等于 r（旧版 5.1/8.1/2.5 差 0.5），
  //     线与环之间留出可见断口，整体散架。
  // 注：这里给的 viewBox 只是初始值，生成期会按真实墨迹（含描边）重算覆盖。
  commandcode:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-11.5 -11.5 23 23">' +
    '<g fill="none" stroke="#000" stroke-width="1.85">' +
    '<path d="M-7.6 -4.6H7.6M-7.6 4.6H7.6M-4.6 -7.6V7.6M4.6 -7.6V7.6"/>' +
    '<circle cx="-7.6" cy="-7.6" r="3"/>' +
    '<circle cx="7.6" cy="-7.6" r="3"/>' +
    '<circle cx="-7.6" cy="7.6" r="3"/>' +
    '<circle cx="7.6" cy="7.6" r="3"/>' +
    '</g></svg>',

  /**
   * Xiaomi「mi」品牌标——**替换**图标库的 `xiaomimimo`。
   *
   * 为什么不直接用库里的：`xiaomimimo.svg` 是「Xiaomi / MIMO」**两行文字组合标**
   * （第一行完整 Xiaomi 单词 + 第二行 MIMO），在 15px 下两行各自不足 7px 高、糊成
   * 一团灰（真机 1x 像素对照：覆盖率仅 0.378，在 63 张里排第 50；同尺寸的 openai
   * 是 0.578）。而它还被 4 个 provider（xiaomi + 三个 token-plan 区域变体）共用，
   * 影响面最大。
   *
   * 图源：simple-icons（CC0-1.0，`icons/xiaomi.svg`）——该库只有**纯 mi 标**，没有
   * 那层深色圆角底板干扰。这里只取其中 mi 字形的两个子路径（第一段 `M12 0…` 是外层
   * 圆角方框，**丢掉**：它同 ⌘ 的板子问题一样，会把 15px 糊成实心块）。
   * 覆盖率为 0.564，与 openai（0.578）同档，属于正常品牌标的重量。
   *
   * 注：viewBox 只是初始值，生成期会按真实墨迹重算覆盖（见 tightenViewBoxes）。
   */
  xiaomi:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">' +
    '<path d="M4.906 7.405h5.624c1.47 0 3.007.068 3.764.827.746.746.827 2.233.83 3.676v4.54a.15.15 0 0 1-.152.147h-1.947a.15.15 0 0 1-.152-.148V11.83c-.002-.806-.048-1.634-.464-2.051-.358-.36-1.026-.441-1.72-.458H7.158a.15.15 0 0 0-.151.147v6.98a.15.15 0 0 1-.152.148H4.906a.15.15 0 0 1-.15-.148V7.554a.15.15 0 0 1 .15-.149zm12.131 0h1.949a.15.15 0 0 1 .15.15v8.892a.15.15 0 0 1-.15.148h-1.949a.15.15 0 0 1-.151-.148V7.554a.15.15 0 0 1 .151-.149zM8.92 10.948h2.046c.083 0 .15.066.15.147v5.352a.15.15 0 0 1-.15.148H8.92a.15.15 0 0 1-.152-.148v-5.352a.15.15 0 0 1 .152-.147Z"/>' +
    '</svg>',
}

/**
 * 光学尺寸修正（相对基准 15px 的系数），只给「满框」形状用。
 *
 * 为什么需要：所有图标共享一个 CSS 尺寸，但**形状的填充率差异会让视觉重量不同**。
 * 多数品牌标是圆形/居中造型，而 ⌘ 的四个环把外接方框的四角全部占满——同样 15px 下
 * 它的墨迹面积明显更大，真机看就偏大（用户实测反馈）。收紧 viewBox 已经解决了
 * 「留白不同导致大小参差」，但解决不了「形状本身更满」这一类，需要光学修正。
 *
 * 只写偏离 1 的项；未列出的品牌一律用基准尺寸。
 */
const OPTICAL_SCALE = {
  // ⌘ 满框（方框 + 四角环占满四角）→ 收 10%，真机与额度圆环观感相当。
  commandcode: 0.9,
}

const out = {}
const providerToSlug = {}
const report = []
const seen = new Set()

for (const [provider, slug] of ENTRIES) {
  if (seen.has(provider)) continue
  seen.add(provider)
  providerToSlug[provider] = slug

  // 同一 slug 已被解析过（区域/计费变体共享同一品牌图形：xiaomi 四变体、qwen 三变体、
  // minimax/minimax-cn…）：只登记映射，不重复存图形，产物省掉 9 组重复。
  if (out[slug] !== undefined) {
    report.push({ provider, slug, tier: out[slug].c === 1 ? 'color' : 'mono', note: 'shared' })
    continue
  }

  // 本地手绘品牌优先：图标库里没有的（如 Command Code）不打 CDN。
  const customSvg = CUSTOM_SVG[slug]
  // 单色候选：base slug（多数为 currentColor）
  const monoSvg = customSvg !== undefined ? customSvg : await fetchSvg(slug)
  // 彩色候选：slug-color
  const colorSvg = customSvg !== undefined ? null : await fetchSvg(slug + '-color')

  let tier = null
  let chosen = null

  const colorOk =
    colorSvg !== null &&
    (() => {
      const colors = hardcodedColors(colorSvg)
      // 没有硬编码色（渐变/currentColor）时按 mono 处理，不算可读品牌色
      if (colors.length === 0) return false
      return colors.every((c) => contrast(c, LIGHT_BG) >= MIN_CONTRAST && contrast(c, DARK_BG) >= MIN_CONTRAST)
    })()

  if (colorOk) {
    tier = 'color'
    chosen = colorSvg
  } else if (monoSvg !== null) {
    tier = 'mono'
    chosen = monoSvg
  } else if (colorSvg !== null) {
    // 没有 mono 变体：彩色图形当 mask 用（mask 只看 alpha，颜色不参与），
    // 仍能得到单色字形；但形状重叠型 logo 会糊成一块，故仅作最后手段。
    tier = 'mono'
    chosen = colorSvg
  }

  if (chosen === null) {
    report.push({ provider, slug, tier: 'skipped', note: 'no svg' })
    continue
  }

  const { viewBox, inner } = normalize(chosen)
  // 图形按 slug 存一次；provider → slug 的映射单独一张表。
  const optical = OPTICAL_SCALE[slug]
  out[slug] = { v: viewBox, m: inner, c: tier === 'color' ? 1 : 0, ...(optical === undefined || optical === 1 ? {} : { o: optical }) }
  report.push({
    provider,
    slug,
    tier,
    custom: customSvg !== undefined,
    colors: tier === 'color' ? hardcodedColors(chosen).join(',') : isCurrentColor(chosen) ? 'currentColor' : 'mono-fallback',
  })
}

// ── viewBox 收紧：让每个图标等大地填满自己的框 ──────────────────────────
// 放在最后统一做，因为要一次拉起浏览器量全部图形。
const bboxes = await tightenViewBoxes(Object.entries(out).map(([slug, spec]) => ({ key: slug, viewBox: spec.v, inner: spec.m })))
const tightened = []
for (const [slug, spec] of Object.entries(out)) {
  const b = bboxes.get(slug)
  if (b === undefined || b === null || b.w <= 0 || b.h <= 0) { tightened.push({ slug, note: 'bbox-missing' }); continue }
  // 正方形化：取较长边并在较长边上居中，避免非等比图形被拉伸变形；
  // 这样「框」永远是正方形，CSS 的 center/contain 不会二次缩放，各图标大小才真一致。
  const side = Math.max(b.w, b.h)
  const cx = b.x + b.w / 2
  const cy = b.y + b.h / 2
  const x = +(cx - side / 2).toFixed(4)
  const y = +(cy - side / 2).toFixed(4)
  const s = +side.toFixed(4)
  spec.v = `${x} ${y} ${s} ${s}`
  tightened.push({ slug, from: bboxes.get(slug), side: s })
}

const lines = []
lines.push('// AUTO-GENERATED by scripts/generate-model-icons.mjs — do not edit manually.')
lines.push(`// Source: @lobehub/icons-static-svg@${VERSION} (MIT); brand marks belong to their owners.`)
lines.push('// Regenerate: node scripts/generate-model-icons.mjs')
lines.push(`const MODEL_ICON_DATA = ${JSON.stringify(out)}`)
lines.push('')
lines.push(`const MODEL_ICON_PROVIDERS = ${JSON.stringify(providerToSlug)}`)
lines.push('')
lines.push(`const MODEL_ICON_PREFIXES = ${JSON.stringify(PREFIX_RULES)}`)
lines.push('')

await writeFile(new URL('../src/model-icons.generated.js', import.meta.url), lines.join('\n'), 'utf8')

// 可视化目录与数据文件同一次生成，杜绝「文档里的图标集」与「运行期内联的那份」漂移。
await writeFile(
  new URL('../docs/model-icons.html', import.meta.url),
  renderCatalog({ data: out, providers: providerToSlug, prefixes: PREFIX_RULES, sourceVersion: VERSION }),
  'utf8',
)

const byTier = report.reduce((acc, r) => {
  acc[r.tier] = (acc[r.tier] ?? 0) + 1
  return acc
}, {})
console.log('icons generated:', Object.keys(out).length, JSON.stringify(byTier))
console.log('provider mappings:', Object.keys(providerToSlug).length)
for (const r of report.filter((r) => r.tier === 'skipped')) console.log('  skipped:', r.provider, r.slug)
console.log('color tier:', report.filter((r) => r.tier === 'color').map((r) => r.provider).join(' '))
console.log('custom marks:', report.filter((r) => r.custom).map((r) => r.provider + '->' + r.slug).join(' '))
const missed = tightened.filter((t) => t.note !== undefined)
console.log('optical scale:', Object.entries(OPTICAL_SCALE).map(([k, v]) => k + '×' + v).join(' ') || '(none)')
console.log('viewBox tightened:', tightened.length - missed.length, '/', tightened.length, missed.length ? '(missing bbox: ' + missed.map((m) => m.slug).join(',') + ')' : '')
