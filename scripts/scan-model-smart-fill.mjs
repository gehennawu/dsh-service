#!/usr/bin/env node
// 永久 pi-ai 全量证据扫描（P2 回归资产，不依赖任何硬编码规模）。
//
// 用途：对**当前装机的** pi-ai 目录（`@earendil-works/pi-ai/dist/providers/data/*.json`）做全量
// 建索引 + 结构自检，专门覆盖「同渠道同 ID 跨 api 碰撞」而不能被合并的语义。碰撞是保留事实，
// 脚本报告它、绝不静默合并，也绝不用「应该有 N 条」这类硬编码计数判定。
//
// 用法：
//   node scripts/scan-model-smart-fill.mjs                 # 自动定位装机目录
//   node scripts/scan-model-smart-fill.mjs --data <dir>    # 指定目录（fixtures/离线）
//   node scripts/scan-model-smart-fill.mjs --json          # 机器可读摘要
//   node scripts/scan-model-smart-fill.mjs --require       # 目录缺失时以非零退出（CI 用）
//
// 退出码：0 = 结构自检通过（或目录不可用且未 --require）；1 = 自检失败或 --require 下缺失。
// 本脚本只读本地 JSON，不触网、不读配置、不碰密钥。

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  assertSourceAllowed,
  auditPiEvidence,
  buildPiEvidence,
  modelParamsRequest,
  openRouterRequest,
} from '../model-smart-fill.js'

/** 装机目录候选（按探测顺序；都缺失即 unavailable）。 */
export const DEFAULT_PI_DIRS = Object.freeze([
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/providers/data',
  '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/providers/data',
  join(process.cwd(), 'node_modules/@earendil-works/pi-ai/dist/providers/data'),
])

export function parseArgs(argv) {
  const options = { data: '', json: false, require: false }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--data' || token === '--fixtures') options.data = argv[index + 1] ?? ''
    else if (token === '--json') options.json = true
    else if (token === '--require') options.require = true
  }
  return options
}

export function resolveDataDir(explicit) {
  if (typeof explicit === 'string' && explicit !== '') return existsSync(explicit) ? explicit : ''
  for (const candidate of DEFAULT_PI_DIRS) {
    if (existsSync(candidate)) return candidate
  }
  return ''
}

/** 读目录里全部渠道 JSON → 证据索引 + 自检。目录不可用返回 status:'unavailable'。 */
export async function scanPiDir(dir) {
  if (dir === '' || !existsSync(dir)) return { status: 'unavailable', dir }
  const texts = {}
  let files = []
  try {
    files = await readdir(dir)
  } catch (_) {
    return { status: 'unavailable', dir, error: 'unreadable' }
  }
  let skippedFiles = 0
  for (const file of files) {
    if (!file.endsWith('.json') || file.startsWith('.') || file.includes('.bak')) continue
    try {
      texts[file.slice(0, -5)] = await readFile(join(dir, file), 'utf8')
    } catch (_) {
      skippedFiles += 1
    }
  }
  const index = buildPiEvidence(texts)
  const audit = auditPiEvidence(index)
  return { status: 'ok', dir, files: Object.keys(texts).length, skippedFiles, index, audit }
}

/** 白名单自检：固定来源 URL 必须通过，典型越界 URL 必须被拒。 */
export function auditSourceWhitelist() {
  const shouldPass = [modelParamsRequest().url, openRouterRequest('openai/gpt-5').url, openRouterRequest('gpt-5').url]
  const shouldFail = [
    'http://modelparams.dev/api/v1/models.json',
    'https://evil.example/api/v1/models.json',
    'https://modelparams.dev/api/v1/other.json',
    'https://openrouter.ai/api/v1/models?q=x&limit=50&key=leak',
    'https://openrouter.ai/api/v1/models?q=x&limit=99999',
    'https://user:pass@modelparams.dev/api/v1/models.json',
    'https://modelparams.dev:8443/api/v1/models.json',
    'https://openrouter.ai/api/v1/model/../../etc/passwd',
  ]
  const problems = []
  for (const url of shouldPass) if (!assertSourceAllowed(url).ok) problems.push(`unexpected-reject:${url}`)
  for (const url of shouldFail) if (assertSourceAllowed(url).ok) problems.push(`unexpected-accept:${url}`)
  return { ok: problems.length === 0, problems, checked: shouldPass.length + shouldFail.length }
}

export function summarize(scan, whitelist) {
  if (scan.status !== 'ok') return { status: scan.status, dir: scan.dir }
  const { audit } = scan
  const collisionKinds = {}
  for (const collision of audit.collisions) {
    collisionKinds[collision.kind] = (collisionKinds[collision.kind] ?? 0) + 1
  }
  return {
    status: 'ok',
    dir: scan.dir,
    files: scan.files,
    skippedFiles: scan.skippedFiles,
    records: audit.counts.records,
    channels: audit.counts.channels,
    models: audit.counts.models,
    collisions: audit.collisions.length,
    collisionKinds,
    reasoning: {
      declaredTrue: audit.counts.reasoningTrue,
      declaredFalse: audit.counts.reasoningFalse,
      undeclared: audit.counts.reasoningUndeclared,
    },
    skippedEntries: audit.counts.skipped,
    truncated: audit.counts.truncated,
    problems: audit.problems,
    whitelist: whitelist.ok ? 'ok' : whitelist.problems,
    ok: audit.ok && whitelist.ok,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const dir = resolveDataDir(options.data)
  const scan = await scanPiDir(dir)
  const whitelist = auditSourceWhitelist()
  const summary = summarize(scan, whitelist)

  if (options.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
  } else if (scan.status !== 'ok') {
    process.stdout.write(`[smart-fill scan] pi-ai 目录不可用：${options.data || '(未指定，装机目录均缺失)'}\n`)
    process.stdout.write(`[smart-fill whitelist] ${whitelist.ok ? 'PASS' : 'FAIL'} (${whitelist.checked} 条)\n`)
    process.stdout.write('RESULT: UNKNOWN\n')
  } else {
    process.stdout.write(`[smart-fill scan] dir=${scan.dir}\n`)
    process.stdout.write(`  files=${scan.files} skippedFiles=${scan.skippedFiles}\n`)
    process.stdout.write(`  records=${summary.records} channels=${summary.channels} models=${summary.models}\n`)
    process.stdout.write(`  collisions=${summary.collisions} ${JSON.stringify(summary.collisionKinds)}\n`)
    process.stdout.write(`  reasoning: true=${summary.reasoning.declaredTrue} false=${summary.reasoning.declaredFalse} undeclared=${summary.reasoning.undeclared}\n`)
    process.stdout.write(`  skippedEntries=${summary.skippedEntries} truncated=${summary.truncated}\n`)
    if (summary.problems.length > 0) process.stdout.write(`  problems=${JSON.stringify(summary.problems)}\n`)
    process.stdout.write(`[smart-fill whitelist] ${whitelist.ok ? 'PASS' : 'FAIL'} (${whitelist.checked} 条)\n`)
    if (!whitelist.ok) process.stdout.write(`  ${JSON.stringify(whitelist.problems)}\n`)
    process.stdout.write(`RESULT: ${summary.ok ? 'PASS' : 'FAIL'}\n`)
  }

  if (scan.status !== 'ok') process.exitCode = options.require ? 1 : 0
  else process.exitCode = summary.ok ? 0 : 1
}

// 仅在直接执行时跑 main（被测试 import 时不产生副作用）。
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`scan failed: ${error?.message ?? error}\n`)
    process.exitCode = 1
  })
}
