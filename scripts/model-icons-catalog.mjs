/**
 * 模型厂家/渠道图标 · 可视化目录生成器
 *
 * 读 `src/model-icons.generated.js`（客户端实际内联的那份数据），产出
 * `docs/model-icons.html`——一个零依赖、可离线打开的单文件页面，把这套图标**原样
 * 铺开**给人看：每张图形、每个 provider 映射、每档渲染路径、每条匹配规则。
 *
 * 存在的理由：图标是「看着对不对」的东西。生成期只能断言数据形状，真机核验脚本
 * （scripts/verify-model-provider-icons.mjs）一次只跑几个渠道；要回答「每张图形到底
 * 长什么样、深浅色下哪几张是彩色哪几张是单色、某个渠道名会不会命中」，翻数据文件
 * 不如直接看一页。
 *
 * 两个入口：
 *   - 作为模块：generate-model-icons.mjs 在写完成数据后调用，保证两者永不漂移；
 *   - 直接运行：`node scripts/model-icons-catalog.mjs`，只重渲染本页（不联网）。
 *
 * 页面渲染必须与运行期**逐像素同构**，否则这页就没有说服力，所以：
 *   - 单色档用 `mask` + `background-color`，不用 filter/opacity 之类的近似；
 *   - 彩色档用 `background-image` 原样上品牌色；
 *   - ink 取运行期实测的 composer 触发钮文字色（浅 rgb(97,102,107) / 暗
 *     rgb(207,211,214)），深浅主题各自套用，不自己调色；
 *   - 尺寸走 `--preview-size`，并叠加数据里的光学系数 `o`，与客户端
 *     `--dshsvc-model-icon-size` 同一套算法。
 *
 * 产出**确定性**：不含时间戳/随机数/本机路径，同一份数据重复生成字节一致
 * （test/docs-static.test.js 据此做漂移检查）。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const GENERATED = new URL('../src/model-icons.generated.js', import.meta.url)
const OUTPUT = new URL('../docs/model-icons.html', import.meta.url)

// 运行期实测的 composer 触发钮 color（深色主题下由主题变量接管），直接抄过来当预览墨色。
const LIGHT_INK = 'rgb(97,102,107)'
const DARK_INK = 'rgb(207,211,214)'
const PANEL_LIGHT = '#17181c' // 运行期判对比度用的暗底，也是预览「暗色面板」色
const PANEL_WHITE = '#ffffff'

/**
 * provider 分组。纯展示用：数据里只有 provider→slug 的扁平映射，分组是给人读的。
 * 新增 provider 若忘了归类，会落进末尾「其他」并被 test/docs-static.test.js 断言拦下——
 * 与其静默沉底，不如让新增的人顺手写一行。
 */
const CATEGORIES = [
  {
    key: 'direct',
    title: '直连厂商',
    note: '模型原厂或其区域/计费变体（同一图形按 slug 去重共享）。',
    providers: [
      'openai', 'openai-codex', 'anthropic', 'google', 'google-vertex', 'xai', 'mistral',
      'deepseek', 'moonshotai', 'moonshotai-cn', 'kimi-coding', 'minimax', 'minimax-cn',
      'zai', 'zai-coding-cn', 'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn',
      'xiaomi-token-plan-sgp', 'qwen-token-plan', 'qwen-token-plan-cn',
      'qwen-token-plan-individual', 'nvidia', 'huggingface', 'cohere', 'ai21', 'voyage',
      'siliconcloud', 'volcengine', 'doubao', 'hunyuan', 'yuanbao', 'stepfun', 'sensenova',
      'baichuan', 'yi', 'codex', 'grok', 'gemini',
    ],
  },
  {
    key: 'gateway',
    title: '聚合网关 / 云平台',
    note: '一个 key 转发多家模型的中转与云托管端点。',
    providers: [
      'openrouter', 'vercel-ai-gateway', 'cloudflare-ai-gateway', 'cloudflare-workers-ai',
      'amazon-bedrock', 'azure-openai-responses', 'together', 'fireworks', 'baseten',
      'cerebras', 'groq', 'perplexity', 'deepinfra', 'sambanova', 'novita', 'hyperbolic',
      'targon', 'parasail', 'lambda', 'fal', 'replicate',
    ],
  },
  {
    key: 'local',
    title: '本地与自托管',
    note: '跑在自己机器/内网上的推理服务。',
    providers: ['ollama', 'vllm', 'lmstudio', 'cliproxy'],
  },
  {
    key: 'coding',
    title: '编码订阅端点',
    note: '面向编码工具的订阅制入口，渠道名常带自定义后缀（靠前缀规则命中）。',
    providers: [
      'opencode', 'opencode-go', 'command-goat', 'commandcode', 'command-code',
      'github-copilot',
    ],
  },
  {
    key: 'media',
    title: '图像 / 音频厂商',
    note: '非对话模型，同一套图标机制沿用。',
    providers: ['midjourney', 'stability', 'suno', 'elevenlabs', 'fishaudio', 'assemblyai'],
  },
]

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/**
 * 与客户端 `modelIconDataUri` 同算法：mask 档补 `fill="#000" color="#000"`（mask 只看 alpha）。
 * 两处必须逐字一致——目录页的用途就是「所见即运行期」，多一个属性少一个属性都会让这页骗人。
 * 已导出：docs-static 测试逐字节比对两侧产物，防止再次单向漂移。
 */
export const dataUri = (spec, useMask) => {
  const viewBox = spec.v === undefined || spec.v === '' ? '0 0 24 24' : spec.v
  const paint = useMask ? ' fill="#000" color="#000"' : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${paint}>${spec.m}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * 解析 src/model-icons.generated.js 里的三条声明。
 * 格式由生成器自己产出（每个声明一行 JSON），所以按行切即可，不需要 eval。
 */
export function parseGeneratedData(source) {
  const grab = (name) => {
    const marker = `const ${name} = `
    const at = source.indexOf(marker)
    if (at === -1) throw new Error(`model-icons.generated.js missing ${name}; regenerate with scripts/generate-model-icons.mjs`)
    const start = at + marker.length
    const end = source.indexOf('\n', start)
    return JSON.parse(source.slice(start, end === -1 ? source.length : end))
  }
  return {
    data: grab('MODEL_ICON_DATA'),
    providers: grab('MODEL_ICON_PROVIDERS'),
    prefixes: grab('MODEL_ICON_PREFIXES'),
  }
}

const tierOf = (spec) => (spec.c === 1 ? 'color' : 'mono')
const tierLabel = (spec) => (spec.c === 1 ? '彩色' : '单色')

function iconSpan(slug, spec, extraClass = '') {
  const cls = extraClass === '' ? 'ic' : `ic ${extraClass}`
  return `<span class="${cls}" data-tier="${tierOf(spec)}" data-slug="${escapeHtml(slug)}" role="img" aria-label="${escapeHtml(slug)}"></span>`
}

function statCard(value, label, hint = '') {
  return `<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span>${hint === '' ? '' : `<em>${escapeHtml(hint)}</em>`}</div>`
}

/**
 * 渲染整页。入参就是三条声明 + 图标库版本号，无隐式状态，便于测试直接调用比对。
 */
export function renderCatalog({ data, providers, prefixes, sourceVersion }) {
  const slugs = Object.keys(data).sort()
  const providerKeys = Object.keys(providers).sort()
  const colorSlugs = slugs.filter((slug) => data[slug].c === 1)
  const monoSlugs = slugs.filter((slug) => data[slug].c !== 1)
  const optical = slugs.filter((slug) => data[slug].o !== undefined && data[slug].o !== 1)

  // slug → 使用它的 provider 列表（一张图形可能被多个区域变体共享）
  const usedBy = new Map(slugs.map((slug) => [slug, []]))
  for (const provider of providerKeys) {
    const slug = providers[provider]
    if (usedBy.has(slug)) usedBy.get(slug).push(provider)
  }
  const sharedSlugs = slugs.filter((slug) => usedBy.get(slug).length > 1)

  const categorised = new Set(CATEGORIES.flatMap((c) => c.providers))
  const uncategorised = providerKeys.filter((provider) => !categorised.has(provider))
  if (uncategorised.length > 0) {
    CATEGORIES.push({ key: 'other', title: '其他', note: '尚未归类。', providers: uncategorised })
  }

  // ── 每张图形的 CSS 变量：一条规则一处 data-URI，页面里不重复 ──────────
  const slugRules = slugs
    .map((slug) => {
      const spec = data[slug]
      const useMask = spec.c !== 1
      const size = spec.o === undefined || spec.o === 1 ? '' : `;--o:${spec.o}`
      return `[data-slug="${slug}"]{--svg:${dataUri(spec, useMask)}${size}}`
    })
    .join('\n')

  // ── provider 卡：按分组 ────────────────────────────────────────────────
  const providerSections = CATEGORIES.map((category) => {
    const cards = category.providers
      .filter((provider) => providers[provider] !== undefined)
      .map((provider) => {
        const slug = providers[provider]
        const spec = data[slug]
        if (spec === undefined) return ''
        const key = `${provider} ${slug} ${tierLabel(spec)} ${tierOf(spec)}`
        return `<article class="card" data-key="${escapeHtml(key)}">
  ${iconSpan(slug, spec)}
  <div class="body">
    <code class="name">${escapeHtml(provider)}</code>
    <span class="tags"><span class="tag tag-slug">${escapeHtml(slug)}</span><span class="tag tag-${tierOf(spec)}">${tierLabel(spec)}</span></span>
  </div>
</article>`
      })
      .join('\n')
    return `<h3 class="group">${escapeHtml(category.title)} <small>${category.providers.length} 项</small></h3>
<p class="group-note">${escapeHtml(category.note)}</p>
<div class="grid">
${cards}
</div>`
  }).join('\n')

  // ── 母版卡：每张图形（含源码折叠） ──────────────────────────────────────
  const markCards = slugs
    .map((slug) => {
      const spec = data[slug]
      const users = usedBy.get(slug)
      const key = `${slug} ${users.join(' ')} ${tierLabel(spec)} ${tierOf(spec)}`
      const notes = []
      if (spec.o !== undefined && spec.o !== 1) notes.push(`光学系数 ${spec.o}（实机 ${(15 * spec.o).toFixed(1)}px）`)
      if (users.length > 1) notes.push(`${users.length} 个 provider 共用`)
      if (slug === 'commandcode') notes.push('本地手绘（图标库未收录）')
      return `<article class="card card-mark" data-key="${escapeHtml(key)}">
  ${iconSpan(slug, spec)}
  <div class="body">
    <code class="name">${escapeHtml(slug)}</code>
    <span class="tags"><span class="tag tag-${tierOf(spec)}">${tierLabel(spec)}</span>${notes.map((n) => `<span class="tag tag-note">${escapeHtml(n)}</span>`).join('')}</span>
    <p class="vb">viewBox <code>${escapeHtml(spec.v)}</code></p>
    <p class="vb">provider：${users.map((u) => `<code>${escapeHtml(u)}</code>`).join(' ')}</p>
    <details><summary>SVG 源码</summary><pre>${escapeHtml(spec.m)}</pre></details>
  </div>
</article>`
    })
    .join('\n')

  // ── 前缀/匹配规则表 ───────────────────────────────────────────────────
  const prefixRows = prefixes
    .map(([prefix, slug], index) => `<tr><td class="num">${index + 1}</td><td><code>${escapeHtml(prefix)}</code></td><td><code>${escapeHtml(slug)}</code></td><td>${escapeHtml(data[slug] === undefined ? '—' : tierLabel(data[slug]))}</td></tr>`)
    .join('\n')

  const providerRows = providerKeys
    .map((provider) => `<tr><td><code>${escapeHtml(provider)}</code></td><td><code>${escapeHtml(providers[provider])}</code></td><td>${escapeHtml(data[providers[provider]] === undefined ? '—' : tierLabel(data[providers[provider]]))}</td></tr>`)
    .join('\n')

  const darkVars = `--bg:#0e0f12;--panel:${PANEL_LIGHT};--fg:#e9ebee;--muted:#9ba2ac;--line:#2b2e34;--ink:${DARK_INK}`

  return `<!doctype html>
<html lang="zh-CN" data-theme="auto" data-surface="panel">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>模型厂家/渠道图标目录 · @gehennawu/dsh-service</title>
<meta name="description" content="dsh-service 内置的模型厂家/渠道图标全集：${slugs.length} 张图形、${providerKeys.length} 条 provider 映射。">
<style>
/* 主题变量：auto 跟随系统，浅/深可强制；底色可切「面板 / 纯白 / 纯黑」用来单独验对比度。
   ink 不是随便挑的灰——它是 composer 模型钮在运行期实测到的文字色，单色档图标就靠
   background-color:currentColor 继承它，所以这里必须与运行期同值，否则这页会骗人。 */
:root{--bg:#f4f5f7;--panel:#ffffff;--fg:#1b1e23;--muted:#5d646e;--line:#e2e5ea;--ink:${LIGHT_INK};--preview-size:28px;color-scheme:light}
:root[data-theme="dark"]{${darkVars};color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${darkVars};color-scheme:dark}}
/* 底色覆写整套前景变量（bg/panel/fg/muted/line/ink）——只覆写背景会造出
   「白底 + 深色主题的近白文字」这种肉眼全灭的组合（真机核验抓到过）。
   每个底色因此是一套**自洽调色板**，与主题正交：主题决定面板氛围，底色决定
   「在什么背景上验对比度」，两者任意组合都必须可读。
   特异性 (0,2,0) 与深色规则打平，靠**写在后面**赢。 */
:root[data-surface="white"]{--bg:${PANEL_WHITE};--panel:${PANEL_WHITE};--fg:#1b1e23;--muted:#5d646e;--line:#e6e8ec;--ink:${LIGHT_INK}}
:root[data-surface="black"]{--bg:#000000;--panel:#000000;--fg:#e9ebee;--muted:#9ba2ac;--line:#242730;--ink:${DARK_INK}}

*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI","Noto Sans CJK SC","Microsoft YaHei",sans-serif}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
a{color:inherit}
header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:20px 24px 14px}
h1{margin:0 0 4px;font-size:19px;letter-spacing:.01em}
h2{margin:34px 0 6px;font-size:16px}
h3.group{margin:26px 0 2px;font-size:14px}
h3.group small{font-weight:400;color:var(--muted)}
.group-note{margin:0 0 12px;color:var(--muted);font-size:12.5px}
main{padding:8px 24px 72px;max-width:1400px;margin:0 auto}
.lede{margin:0 0 14px;color:var(--muted);max-width:74ch}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px;padding:0;list-style:none}
.stat{border:1px solid var(--line);background:var(--panel);border-radius:9px;padding:7px 12px;min-width:96px}
.stat b{display:block;font-size:17px;line-height:1.25}
.stat span{display:block;color:var(--muted);font-size:12px}
.stat em{display:block;color:var(--muted);font-size:11px;font-style:normal}
.controls{display:flex;flex-wrap:wrap;gap:16px;align-items:center;font-size:12.5px;color:var(--muted)}
.controls label{display:flex;align-items:center;gap:6px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel)}
.seg button{border:0;background:transparent;color:inherit;font:inherit;padding:5px 10px;cursor:pointer}
.seg button[aria-pressed="true"]{background:var(--fg);color:var(--bg)}
input[type="search"]{border:1px solid var(--line);background:var(--panel);color:inherit;border-radius:8px;padding:5px 9px;font:inherit;min-width:210px}
input[type="range"]{width:170px;vertical-align:middle}
.readout{font-variant-numeric:tabular-nums;min-width:96px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(212px,1fr));gap:10px}
.card{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:12px;min-width:0}
.card .body{min-width:0;flex:1}
.name{display:block;font-size:12.5px;overflow-wrap:anywhere}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.tag{font-size:11px;line-height:1.5;border-radius:5px;padding:0 6px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.tag-color{border-color:#c9a227;color:#a5811a}
.tag-mono{border-color:var(--line)}
.tag-slug{font-family:ui-monospace,monospace}
.tag-note{font-style:italic}
.vb{margin:6px 0 0;font-size:11.5px;color:var(--muted);overflow-wrap:anywhere}
.vb code{font-size:11px}
details{margin-top:7px}
summary{cursor:pointer;font-size:11.5px;color:var(--muted)}
pre{margin:6px 0 0;padding:8px;border:1px solid var(--line);border-radius:7px;background:color-mix(in srgb,var(--fg) 4%,transparent);font-size:11px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:10px 0 0}
th,td{border-bottom:1px solid var(--line);padding:5px 9px;text-align:left}
th{color:var(--muted);font-weight:500}
td.num,th.num{width:44px;color:var(--muted)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px}
.note{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:12px 14px}
.note ul{margin:8px 0 0;padding-left:20px}
.note li{margin:3px 0}
.empty{color:var(--muted);font-size:12.5px;display:none}
body[data-filtered="1"] .empty{display:block}

/* ── 图标本体：与客户端 CSS 同构（mono=mask+currentColor，color=background-image）── */
.ic{display:inline-block;flex:none;width:calc(var(--preview-size) * var(--o,1));height:calc(var(--preview-size) * var(--o,1));background-repeat:no-repeat;background-position:center;background-size:contain}
.ic[data-tier="mono"]{background-color:var(--ink);-webkit-mask:var(--svg) center/contain no-repeat;mask:var(--svg) center/contain no-repeat}
.ic[data-tier="color"]{background-image:var(--svg)}
[hidden]{display:none !important}
${slugRules}
</style>
</head>
<body>
<header>
  <h1>模型厂家 / 渠道图标目录</h1>
  <p class="lede">dsh-service 内置的全部厂家/渠道图标——对话输入框的模型按钮用它替换/前置官方默认图标。下面是插件实际内联进 <code>client.js</code> 的那份数据，不是设计稿：单色档用 mask 跟随主题文字色，彩色档原样上品牌色。</p>
  <ul class="stats">
    ${statCard(slugs.length, '图形母版', '按 slug 去重')}
    ${statCard(providerKeys.length, 'provider 映射', '含区域/计费变体')}
    ${statCard(monoSlugs.length, '单色档', 'mask + 主题文字色')}
    ${statCard(colorSlugs.length, '彩色档', '品牌色双主题对比度 ≥ 3.0')}
    ${statCard(prefixes.length, '前缀/别名规则', '自定义渠道名匹配')}
    ${statCard(sharedSlugs.length, '共享图形', '多 provider 同一张')}
    ${statCard(optical.length, '光学修正', optical.length === 0 ? '' : optical.map((s) => `${s} ×${data[s].o}`).join('　'))}
  </ul>
  <div class="controls">
    <label>主题
      <span class="seg" id="theme">
        <button type="button" data-theme-value="auto" aria-pressed="true">跟随系统</button>
        <button type="button" data-theme-value="light" aria-pressed="false">浅色</button>
        <button type="button" data-theme-value="dark" aria-pressed="false">深色</button>
      </span>
    </label>
    <label>底色
      <span class="seg" id="surface">
        <button type="button" data-surface-value="panel" aria-pressed="true">面板</button>
        <button type="button" data-surface-value="white" aria-pressed="false">纯白</button>
        <button type="button" data-surface-value="black" aria-pressed="false">纯黑</button>
      </span>
    </label>
    <label>预览尺寸
      <input type="range" id="size" min="12" max="72" step="1" value="28">
      <span class="readout" id="sizeReadout">28 px</span>
      <button type="button" class="segbtn" id="sizeReal">实机 15px</button>
    </label>
    <label>筛选
      <input type="search" id="filter" placeholder="provider / slug / 分组…" autocomplete="off">
    </label>
  </div>
</header>
<main>
  <p class="empty" id="empty">没有匹配的条目。</p>

  <h2 id="providers">一 · provider 映射（${providerKeys.length}）</h2>
  <p class="lede">按 <code>provider</code> 名查表的结果。运行期三步解析：① 内置精确表 → ② 前缀/别名 → ③ 自身或其分段即 slug。三步都不中就回落官方默认图标。</p>
${providerSections}

  <h2 id="marks">二 · 图形母版（${slugs.length}）</h2>
  <p class="lede">每张图形只存一份，provider 映射指向它。展开「SVG 源码」可看内联进运行期的原始 <code>innerHTML</code>（<code>viewBox</code> 已在生成期按真实墨迹收紧，使各品牌等大地填满自己的框）。</p>
  <div class="grid">
${markCards}
  </div>

  <h2 id="rules">三 · 匹配规则</h2>
  <div class="cols">
    <div>
      <h3 class="group">前缀 / 别名规则（${prefixes.length}）</h3>
      <p class="group-note">按表中顺序匹配，长前缀在前（<code>opencode-go</code> 先于 <code>opencode</code>）；分隔符限定 <code>- _ .</code>，避免 <code>openaiish</code> 误命中 <code>openai</code>。命中即返回，不再往下走。</p>
      <table>
        <thead><tr><th class="num">#</th><th>前缀 / 别名</th><th>→ 图形</th><th>档位</th></tr></thead>
        <tbody>
${prefixRows}
        </tbody>
      </table>
    </div>
    <div>
      <h3 class="group">provider 精确表（${providerKeys.length}）</h3>
      <p class="group-note">第一步命中，优先级最高。</p>
      <table>
        <thead><tr><th>provider</th><th>→ 图形</th><th>档位</th></tr></thead>
        <tbody>
${providerRows}
        </tbody>
      </table>
    </div>
  </div>

  <h2 id="notes">四 · 说明</h2>
  <div class="cols">
    <div class="note">
      <b>渲染路径</b>
      <ul>
        <li><b>单色档</b>（${monoSlugs.length}）：<code>-webkit-mask</code> + <code>background-color: currentColor</code>。颜色完全交给主题文字色，深浅色零特判——本页墨色即运行期实测值（浅 <code>${LIGHT_INK}</code> / 暗 <code>${DARK_INK}</code>）。</li>
        <li><b>彩色档</b>（${colorSlugs.length}）：<code>background-image</code> 原样上品牌色。只有品牌色在 <code>#ffffff</code> 与 <code>${PANEL_LIGHT}</code> 上对比度均 ≥ 3.0 才留彩色，否则一律回落单色——避免「浅色模式下看不见」。</li>
        <li>data-URI 是独立文档上下文，<b>不继承 currentColor</b>，所以单色档必须走 mask；直接写 <code>fill="currentColor"</code> 的 data-URI 会渲染成透明。</li>
      </ul>
    </div>
    <div class="note">
      <b>尺寸</b>
      <ul>
        <li>基准 <b>15px</b>，对齐额度圆环的视觉重量。</li>
        <li>生成期已把每个 <code>viewBox</code> 收紧到真实绘制范围（各品牌在 24 格里的留白差异极大），所以同一个数字画出来才等大。</li>
        <li>「满框」形状即使外接尺寸相同也更显大，由数据里的光学系数 <code>o</code> 单独修正：${optical.length === 0 ? '（当前无）' : optical.map((s) => `<code>${escapeHtml(s)}</code> ×${data[s].o}`).join('、')}。</li>
        <li>本页尺寸滑杆只改预览；运行期固定 15px（乘 <code>o</code>）。</li>
      </ul>
    </div>
    <div class="note">
      <b>来源与许可</b>
      <ul>
        <li>图形取自 <code>@lobehub/icons-static-svg@${escapeHtml(sourceVersion)}</code>（MIT）。</li>
        <li>品牌图形与商标归各厂商所有，此处仅用于标识对应服务。</li>
        <li>本地手绘：<code>commandcode</code>（⌘，图标库未收录）。</li>
        <li>新增/更新图标：<code>node scripts/generate-model-icons.mjs</code>（需联网，同时写数据文件与本页）。</li>
        <li>仅重渲染本页：<code>node scripts/model-icons-catalog.mjs</code>（离线）。</li>
      </ul>
    </div>
  </div>
</main>
<script>
(function () {
  var root = document.documentElement;
  var bindSeg = function (id, attr) {
    var group = document.getElementById(id);
    if (!group) return;
    group.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-' + attr + '-value]');
      if (!button) return;
      root.setAttribute('data-' + attr, button.getAttribute('data-' + attr + '-value'));
      group.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === button));
      });
    });
  };
  bindSeg('theme', 'theme');
  bindSeg('surface', 'surface');

  var size = document.getElementById('size');
  var readout = document.getElementById('sizeReadout');
  var apply = function (px) {
    root.style.setProperty('--preview-size', px + 'px');
    readout.textContent = px + ' px';
    size.value = px;
  };
  size.addEventListener('input', function () { apply(size.value); });
  document.getElementById('sizeReal').addEventListener('click', function () { apply(15); });

  var filter = document.getElementById('filter');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  filter.addEventListener('input', function () {
    var q = filter.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var hit = q === '' || (card.getAttribute('data-key') || '').toLowerCase().indexOf(q) !== -1;
      card.hidden = !hit;
      if (hit) shown++;
    });
    document.body.setAttribute('data-filtered', q === '' || shown > 0 ? '0' : '1');
  });
})();
</script>
</body>
</html>
`
}

async function main() {
  const source = await readFile(GENERATED, 'utf8')
  const versionMatch = source.match(/icons-static-svg@([\d.]+)/)
  const sourceVersion = versionMatch === null ? 'unknown' : versionMatch[1]
  const html = renderCatalog({ ...parseGeneratedData(source), sourceVersion })
  await writeFile(OUTPUT, html, 'utf8')
  console.log('catalog written:', fileURLToPath(OUTPUT), `(${html.length} bytes)`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
