// 宿主版本探测（readDshVersion）的专项用例：v2.0.5 起改为「进程入口优先」，
// 修的是非全局前缀安装（npx / npm i --prefix / 隔离 profile）读到机器上另一份 DSH 的问题。
// 这里只测纯探测逻辑：用临时目录造真实目录树 + 注入 require/readFileSync 控住回落链。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { readDshVersion } from '../index.js'

const DSH = '@deepseek-ai/dsh'

/** 造一棵 `<root>/node_modules/@deepseek-ai/dsh/{package.json,lib/bin.js}` 安装树。 */
function createInstallTree(root, { version = '9.9.9-test', name = DSH } = {}) {
  const packageDir = join(root, 'node_modules', ...DSH.split('/'))
  mkdirSync(join(packageDir, 'lib'), { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify({ name, version })}\n`)
  const bin = join(packageDir, 'lib', 'bin.js')
  writeFileSync(bin, '// entry\n')
  return { packageDir, bin }
}

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-version-'))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const unavailable = () => { throw new Error('unavailable') }

test('进程入口所在的安装树优先于插件自身解析与历史全局路径', () => {
  withTempDir((dir) => {
    const { bin } = createInstallTree(dir, { version: '9.9.9-test' })
    // 回落链故意给出别的版本：入口命中时应完全不走它们。
    const version = readDshVersion({
      argv1: bin,
      requireManifest: () => ({ version: '1.1.1-fallback' }),
    })
    assert.equal(version, '9.9.9-test')
  })
})

test('入口是 .bin 软链时按 realpath 穿透到真正的宿主包', () => {
  withTempDir((dir) => {
    const { bin } = createInstallTree(dir, { version: '8.8.8-link' })
    const shim = join(dir, 'node_modules', '.bin', 'dsh')
    mkdirSync(dirname(shim), { recursive: true })
    symlinkSync(bin, shim)
    assert.equal(readDshVersion({ argv1: shim, requireManifest: unavailable }), '8.8.8-link')
  })
})

test('入口链上同名不同包（name 不是 @deepseek-ai/dsh）的 package.json 不被采纳', () => {
  withTempDir((dir) => {
    const { bin } = createInstallTree(dir, { version: '7.7.7-wrong-name', name: 'some-other-tool' })
    assert.equal(readDshVersion({ argv1: bin, requireManifest: unavailable }), 'unknown')
  })
})

test('版本串不合法（含非 semver 字符）时拒绝该候选并继续回落', () => {
  withTempDir((dir) => {
    const { bin } = createInstallTree(dir, { version: 'not a version!' })
    assert.equal(readDshVersion({ argv1: bin, requireManifest: unavailable }), 'unknown')
  })
})

test('入口缺失时回落到插件自身解析路径，再回落到历史全局路径', () => {
  const fromPlugin = readDshVersion({
    argv1: '',
    readFileSync: unavailable,
    requireManifest: (path) => {
      if (path === `${DSH}/package.json`) return { version: '1.2.3-plugin' }
      throw new Error('unavailable')
    },
  })
  assert.equal(fromPlugin, '1.2.3-plugin')

  const fromLegacy = readDshVersion({
    argv1: '/nonexistent/entry.js',
    readFileSync: unavailable,
    requireManifest: (path) => {
      if (path === '/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json') return { version: '4.5.6-legacy' }
      throw new Error('unavailable')
    },
  })
  assert.equal(fromLegacy, '4.5.6-legacy')
})

test('三条候选全部失败时返回 unknown，不抛错也不返回坏值', () => {
  assert.equal(
    readDshVersion({ argv1: '/nonexistent/entry.js', readFileSync: unavailable, requireManifest: unavailable }),
    'unknown',
  )
})

test('默认参数探测本机运行宿主：拿到合法版本串或 unknown，且不抛错', () => {
  const version = readDshVersion({ argv1: '' })
  assert.match(version, /^(unknown|(?=.*[0-9])[0-9A-Za-z][0-9A-Za-z.-]{0,63})$/)
})
