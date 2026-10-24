import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

// 契约（2026-10-16 定稿）：`engines.dsh` 保持**开区间** `>=0.1.1-rc.2`，不设上界。
//
// 背景：0.2.1-alpha.4 起宿主门禁改为「manifest 一旦声明 engines.dsh 就由它单独裁决、
// peerDependencies 被忽略」，该字段因此是**唯一**决定插件装不装得上的字段。写死上界的
// 代价实测过：alpha.4 发布时上界 `<0.2.1-alpha.4` 恰好排除目标版 ⇒ 插件被拒/整包跳过
// （启动 stderr 才可见，UI 零提示），且插件「一键升级」被同一门禁挡死 ⇒ 无法自我修复。
// 因此改为开区间：新版 DSH 上插件照常加载，个别功能可能尚未适配，但不阻断使用，
// 也无需仅为挪动上界而发版。
//
// 本文件是这条不变量的机械守卫（正文见 AGENTS.md「兼容声明」节）：
// ① 声明不得重新长出上界；② 对「下界以下」仍要拒绝（别写成 `*` 把远古版本也放进来）；
// ③ 四处镜像（package.json / lockfile / 中英 README）一致；④ 已验证版本仍要写清。
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const manifest = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const README_ZH = read('README.md')
const README_EN = read('README.en.md')

const declared = manifest.engines?.dsh
const FLOOR = '0.1.1-rc.2'
const VERIFIED = '0.2.1-rc.3'

// —— 供本测试自证的最小 semver 子集 ——
// 只覆盖本插件声明用到的形态（`>=<version>` 单下界）。语义与宿主门禁所用
// `semver.satisfies(runtime, range, { includePrerelease: true })` 在开区间下一致：
// 给定下界 D，runtime R 满足当且仅当 R >= D（预发布号参与比较）。
function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(version))
  if (match === null) throw new Error(`unsupported version form: ${version}`)
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

// semver 预发布比较：逐段比较；数字段数值比较、字母数字段字典序、数字段优先级更低、
// 段数少者更小；无预发布号者整体更大。
function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const numericA = /^\d+$/.test(a)
    const numericB = /^\d+$/.test(b)
    if (numericA && numericB) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1
      continue
    }
    if (numericA !== numericB) return numericA ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

function compare(left, right) {
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.release[index] !== b.release[index]) return a.release[index] < b.release[index] ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/** True when `version` satisfies a `>=<floor>` open range. */
function satisfiesOpenFloor(version, floor = FLOOR) {
  return compare(version, floor) >= 0
}

test('the declared range is a lower bound with no upper bound', () => {
  assert.equal(typeof declared, 'string', 'package.json must declare engines.dsh')
  assert.equal(declared, `>=${FLOOR}`, 'engines.dsh must stay the open range >=0.1.1-rc.2')
  assert.doesNotMatch(declared, /</, 'engines.dsh must not carry an upper bound')
  assert.doesNotMatch(declared, /\|\||\s/, 'engines.dsh must stay a single open range')
})

test('the open range rejects versions below the floor and admits every later one', () => {
  // 注意：`0.1.1` 是 `0.1.1-rc.2` 的**正式版**，在 semver 里大于任何同号预发布，
  // 属于「下界之上」而非之下（预发布号存在时，无预发布号者更大）。
  for (const version of ['0.0.9', '0.1.0', '0.1.1-rc.1']) {
    assert.equal(satisfiesOpenFloor(version), false, `${version} is below the floor and must be rejected`)
  }
  for (const version of [
    '0.1.1-rc.2', '0.1.1', '0.1.5-rc.2', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0',
    '0.2.1-alpha.3', '0.2.1-alpha.4', '0.2.1-alpha.5', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1', '0.3.0-beta.1',
    '0.3.0', '1.0.0', '2.5.7',
  ]) {
    assert.equal(satisfiesOpenFloor(version), true, `${version} is at or above the floor and must be admitted`)
  }
})

// 期望矩阵（下界 `>=0.1.1-rc.2`，宿主门禁恒以 `{includePrerelease:true}` 求值）。
// 这批期望值经 `semver@7.8.5`（与宿主门禁同一 major）逐条实测，不依赖本仓库安装 semver；
// 若将来有人把声明改成带上界或放宽下界，这里会直接红。
const EXPECTED = new Map([
  ['0.0.9', false],
  ['0.1.0', false],
  ['0.1.1-rc.1', false],
  ['0.1.1-rc.2', true],
  ['0.1.1', true], // 正式版 > 同号预发布
  ['0.1.5-rc.2', true],
  ['0.1.7-rc.2', true],
  ['0.2.0-rc.1', true],
  ['0.2.0', true],
  ['0.2.1-alpha.3', true],
  ['0.2.1-alpha.4', true],
  ['0.2.1-alpha.5', true],
  ['0.2.1-rc.2', true],
  ['0.2.1-rc.3', true],
  ['0.2.1', true],
  ['0.3.0-beta.1', true],
  ['0.3.0', true],
  ['1.0.0', true],
  ['2.5.7', true],
])

test('the open range matches the host gate decision for every sampled runtime', () => {
  for (const [version, expected] of EXPECTED) {
    assert.equal(
      satisfiesOpenFloor(version),
      expected,
      `>=${FLOOR} against runtime ${version} should be ${expected}`,
    )
  }
})

test('the vendored comparison agrees with semver when one happens to be installed', async (t) => {
  let semver
  try {
    semver = createRequire(import.meta.url)('semver')
  } catch {
    try {
      semver = await import('semver')
    } catch {
      t.skip('semver is not installed; the EXPECTED matrix above is the authoritative check')
      return
    }
  }
  for (const [version, expected] of EXPECTED) {
    const actual = semver.satisfies(version, declared, { includePrerelease: true })
    assert.equal(actual, expected, `semver disagreed with the matrix for ${version}`)
    assert.equal(satisfiesOpenFloor(version), actual, `vendored comparison disagreed for ${version}`)
  }
})

test('package-lock.json mirrors the declared engines.dsh range', () => {
  assert.equal(lock.packages?.['']?.engines?.dsh, declared, 'package-lock.json engines.dsh drifted from package.json')
})

test('README compatibility text matches the declaration (zh + en)', () => {
  for (const [name, text] of [['README.md', README_ZH], ['README.en.md', README_EN]]) {
    assert.ok(text.includes(declared), `${name} must state the declared range ${declared}`)
  }
})

test('READMEs record the verified baseline and the ceiling-free rationale', () => {
  assert.ok(README_ZH.includes(`已验证至 \`${VERIFIED}\``), 'README.md must state the verified baseline')
  assert.ok(README_EN.includes(`verified through \`${VERIFIED}\``), 'README.en.md must state the verified baseline')
  for (const [name, text] of [['README.md', README_ZH], ['README.en.md', README_EN]]) {
    assert.match(text, /无上界|no upper bound/i, `${name} must explain that the range has no upper bound`)
  }
})
