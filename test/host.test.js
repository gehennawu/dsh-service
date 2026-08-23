import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import test from 'node:test'
import { createRequire } from 'node:module'

import { apply, createQuotaThrottle, detectRuntimeEnv, fetchProviderUsage, inferQuotaKind, name, normalizeKimiBalance, normalizeOpenRouterCredits, normalizeOpencodeUsage, normalizeSiliconFlowInfo, normalizeZaiCodingUsage, parseQuotaConfigText, quotaEndpointFor, quotaErrorCode, readLlmProviders, runtimeEnvCheck } from '../index.js'

// 与 index.js 相同口径读取实际安装版本：DSH 包由宿主全局安装，插件版本来自本仓库。
const requireCjs = createRequire(import.meta.url)
const pluginVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version
let installedDshVersion = 'unknown'
try { installedDshVersion = requireCjs('@deepseek-ai/dsh/package.json').version } catch (_) {}
try {
  if (installedDshVersion === 'unknown') {
    installedDshVersion = JSON.parse(readFileSync('/usr/local/lib/node_modules/@deepseek-ai/dsh/package.json')).version
  }
} catch (_) {}

function localSubprocess() {
  return {
    resolveExecutable: async (command) => command,
    spawn(spec) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: { ...process.env, ...spec.env } })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => { stdout += chunk })
      child.stderr?.on('data', (chunk) => { stderr += chunk })
      return {
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: Buffer.byteLength(stdout), lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, nextOffset: Buffer.byteLength(stderr), lossy: false }) },
        },
        done: new Promise((resolve, reject) => {
          child.on('error', reject)
          child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
        }),
      }
    },
  }
}

function createHost(overrides = {}) {
  const handlers = []
  const scheduled = []
  const disposers = []
  const registeredCommands = []
  const services = new Map(Object.entries(overrides.services || {}))
  const previousEnv = {}
  // 运行环境探测默认强制 managed：真实探测分支由 detectRuntimeEnv 纯函数单测覆盖，
  // 升级/重启既有用例在裸机终端（双 TTY）里跑也不会误入「手动启动不退出」分支。
  for (const [key, value] of Object.entries({ DSH_SERVICE_RUNTIME_ENV: 'managed', ...(overrides.env || {}) })) {
    previousEnv[key] = process.env[key]
    process.env[key] = value
  }
  if (overrides.commands) {
    services.set('commands', {
      register(definition) {
        registeredCommands.push(definition)
        return () => {}
      },
    })
  }
  services.set('timer', {
    timeout(callback, delay) {
      scheduled.push({ callback, delay })
      return () => {}
    },
  })

  const ctx = {
    connection: {
      rpc: {
        handle(channel, handler, options) {
          handlers.push({ channel, handler, options })
          return () => {}
        },
      },
    },
    get(service) {
      return services.get(service)
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }

  apply(ctx)
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  assert.equal(handlers.length, 1)
  return { handler: handlers[0].handler, scheduled, registeredCommands, dispose: () => disposers.splice(0).reverse().forEach((fn) => fn()) }
}

test('permission RPC signs a frozen Linux plan, rejects forged ids, and repairs directory and file modes', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-permissions-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-permissions-workspace-'))
  const outside = await mkdtemp(join(tmpdir(), 'dsh-service-permissions-outside-'))
  t.after(() => Promise.all([
    rm(dshHome, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]))
  const nestedDir = join(workspace, 'nested')
  const executableFile = join(nestedDir, 'script.sh')
  const readOnlyFile = join(nestedDir, 'read-only.txt')
  const gitObjectDir = join(workspace, '.git', 'objects', 'aa')
  const gitObject = join(gitObjectDir, 'object')
  const credentials = join(dshHome, '.credentials.yaml')
  const workspaceCredentials = join(workspace, '.credentials.yaml')
  const externalTarget = join(outside, 'external-target.txt')
  const externalLink = join(workspace, 'external-link')
  await mkdir(nestedDir)
  await mkdir(gitObjectDir, { recursive: true })
  await writeFile(executableFile, '#!/bin/sh\nexit 0\n')
  await writeFile(readOnlyFile, 'read-only fixture')
  await writeFile(gitObject, 'git object fixture')
  await writeFile(credentials, 'credential fixture')
  await writeFile(workspaceCredentials, 'workspace fixture')
  await writeFile(externalTarget, 'external target')
  await symlink(externalTarget, externalLink)
  await chmod(dshHome, 0o775)
  await chmod(workspace, 0o777)
  await chmod(executableFile, 0o555)
  await chmod(readOnlyFile, 0o400)
  await chmod(gitObject, 0o444)
  await chmod(credentials, 0o644)
  await chmod(workspaceCredentials, 0o400)
  await chmod(externalTarget, 0o400)
  await chmod(nestedDir, 0o000)

  const { handler } = createHost({
    services: {
      subprocess: localSubprocess(),
      workspaceRegistry: { list: () => [{ id: 'workspace-1', title: 'Project', path: workspace }] },
    },
    env: { DSH_HOME: dshHome },
  })

  const planned = await handler('permissions-plan', {})
  assert.equal(planned.ok, true)
  assert.equal(planned.value.supported, true)
  assert.equal(planned.value.targetOwner, `${process.getuid()}:${process.getgid()}`)
  assert.equal(planned.value.items.length, 2)
  assert.deepEqual(planned.value.items.map((item) => item.path), [dshHome, workspace])
  assert.deepEqual(planned.value.items.map((item) => item.mode), ['0775', '0777'])
  assert.equal(typeof planned.value.planId, 'string')
  assert.notEqual(planned.value.planId, '')
  const concurrentPlan = await handler('permissions-plan', {})
  assert.equal(concurrentPlan.ok, true)
  assert.notEqual(concurrentPlan.value.planId, planned.value.planId)

  const forged = await handler('permissions-repair', { planId: 'forged-plan' })
  assert.deepEqual(forged, { ok: false, error: 'unknown-permission-plan' })

  const repaired = await handler('permissions-repair', { planId: planned.value.planId })
  assert.equal(repaired.ok, true)
  assert.equal(repaired.value.supported, true)
  assert.equal(repaired.value.items.every((item) => item.owner === `${process.getuid()}:${process.getgid()}`), true)
  assert.deepEqual(repaired.value.items.map((item) => item.mode), ['0775', '0777'])
  assert.equal((await stat(nestedDir)).mode & 0o777, 0o700)
  assert.equal((await stat(executableFile)).mode & 0o777, 0o755)
  assert.equal((await stat(readOnlyFile)).mode & 0o777, 0o600)
  assert.equal((await stat(gitObject)).mode & 0o777, 0o444)
  assert.equal((await stat(credentials)).mode & 0o777, 0o600)
  assert.equal((await stat(workspaceCredentials)).mode & 0o777, 0o600)
  assert.equal((await stat(externalTarget)).mode & 0o777, 0o400)

  const postRepairPlan = await handler('permissions-plan', {})
  const postRepairDeep = await handler('permissions-deep', { planId: postRepairPlan.value.planId })
  assert.equal(postRepairDeep.ok, true)
  assert.deepEqual({
    ownerIssues: postRepairDeep.value.ownerIssues,
    directoryModeIssues: postRepairDeep.value.directoryModeIssues,
    fileModeIssues: postRepairDeep.value.fileModeIssues,
    unreadable: postRepairDeep.value.unreadable,
    samples: postRepairDeep.value.samples,
  }, { ownerIssues: 0, directoryModeIssues: 0, fileModeIssues: 0, unreadable: 0, samples: [] })

  const replayed = await handler('permissions-repair', { planId: planned.value.planId })
  assert.deepEqual(replayed, { ok: false, error: 'unknown-permission-plan' })
})

test('permission deep check scans only host-planned roots and reports bounded anomalies without changing files', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-deep-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-deep-workspace-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })]))
  await mkdir(join(workspace, 'nested'))
  await writeFile(join(dshHome, '.credentials.yaml'), 'credential fixture')
  await writeFile(join(workspace, '.credentials.yaml'), 'workspace fixture')
  await writeFile(join(workspace, 'nested', 'bad.txt'), 'test')
  await chmod(join(dshHome, '.credentials.yaml'), 0o644)
  await chmod(join(workspace, '.credentials.yaml'), 0o644)
  await chmod(workspace, 0o555)
  await chmod(join(workspace, 'nested'), 0o700)
  await chmod(join(workspace, 'nested', 'bad.txt'), 0o400)
  await symlink(workspace, join(workspace, 'nested', 'loop'))
  const { handler } = createHost({ services: { workspaceRegistry: { list: () => [{ id: 'project', path: workspace }] }, subprocess: localSubprocess() }, env: { DSH_HOME: dshHome } })
  const plan = await handler('permissions-plan', {})
  const deep = await handler('permissions-deep', { planId: plan.value.planId })
  assert.equal(deep.ok, true)
  assert.equal(deep.value.scanned >= 5, true)
  assert.equal(deep.value.scanned < 10, true)
  assert.equal(deep.value.directoryModeIssues, 1)
  assert.equal(deep.value.fileModeIssues, 2)
  assert.equal(deep.value.samples.some((sample) => sample.path === join(dshHome, '.credentials.yaml') && sample.detail === '0644'), true)
  assert.equal(deep.value.samples.some((sample) => sample.path === join(workspace, '.credentials.yaml')), false)
  assert.equal(deep.value.samples.length >= 2, true)
  assert.equal((await stat(join(workspace, 'nested'))).mode & 0o777, 0o700)

  await chmod(join(dshHome, '.credentials.yaml'), 0o400)
  const ownerOnlyPlan = await handler('permissions-plan', {})
  const ownerOnlyDeep = await handler('permissions-deep', { planId: ownerOnlyPlan.value.planId })
  assert.equal(ownerOnlyDeep.ok, true)
  assert.equal(ownerOnlyDeep.value.fileModeIssues, 2)
  assert.equal(ownerOnlyDeep.value.samples.some((sample) => sample.path === join(dshHome, '.credentials.yaml')), true)

  const repaired = await handler('permissions-repair', { planId: plan.value.planId })
  assert.equal(repaired.ok, true)
  assert.equal((await stat(join(workspace, 'nested'))).mode & 0o777, 0o700)
  assert.equal((await stat(join(dshHome, '.credentials.yaml'))).mode & 0o777, 0o600)
  const forged = await handler('permissions-deep', { planId: 'forged' })
  assert.deepEqual(forged, { ok: false, error: 'unknown-permission-plan' })
})

test('permission deep check scans nested workspace roots exactly once and skips git metadata', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-nested-home-'))
  const parent = await mkdtemp(join(tmpdir(), 'dsh-service-nested-parent-'))
  const standalone = await mkdtemp(join(tmpdir(), 'dsh-service-nested-standalone-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(parent, { recursive: true, force: true }), rm(standalone, { recursive: true, force: true })]))
  // 注册表常见形态：/workspace、/workspace/projects 与 /workspace/projects/<x> 同时注册。
  const child = join(parent, 'projects', 'child')
  const gitObjectDir = join(child, '.git', 'objects', 'aa')
  await mkdir(child, { recursive: true })
  await mkdir(gitObjectDir, { recursive: true })
  await writeFile(join(child, 'editable.dat'), 'x')
  await writeFile(join(gitObjectDir, 'object'), 'git')
  await chmod(join(child, 'editable.dat'), 0o600)
  await chmod(join(gitObjectDir, 'object'), 0o444)
  const { handler } = createHost({ services: { workspaceRegistry: { list: () => [
    { id: 'child', title: 'Child', path: child },
    { id: 'parent', title: 'Parent', path: parent },
    { id: 'standalone', title: 'Standalone', path: standalone },
  ] }, subprocess: localSubprocess() }, env: { DSH_HOME: dshHome } })
  const plan = await handler('permissions-plan', {})
  const deep = await handler('permissions-deep', { planId: plan.value.planId })
  assert.equal(deep.ok, true)
  // 每个非 Git 节点只 stat 一次：dshHome、parent、projects、child、editable.dat、standalone。
  assert.equal(deep.value.scanned, 6)
  assert.equal(deep.value.directoryModeIssues, 0)
  assert.equal(deep.value.fileModeIssues, 0)
  assert.equal(deep.value.samples.length, 0)
})

test('usage RPC builds and incrementally refreshes exact daily provider, model, and project totals', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-usage-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const now = Date.now()
  const day = new Date(now).toLocaleDateString('en-CA')
  let revision = 'rev-1'
  let reads = 0
  let events = [
    { type: 'request/header', seq: 0, time: now - 2000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } }, reason: 'initial' } },
    { type: 'assistant/message', seq: 1, time: now - 1000, data: { turn: 0, step: 0, message: { role: 'assistant', content: [] }, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 10 } } },
    { type: 'llm/retry', seq: 2, time: now - 900, data: { retryId: 'r1', turn: 1, step: 0, provider: 'deepseek', mode: 'normal', policyKey: 'default', retry: 1, maxRetries: 2, delayMs: 100, failure: { code: 'RATE_LIMIT', status: 429, message: 'request id abc123 rate limit exceeded after 1.2s' } } },
    { type: 'llm/retry', seq: 3, time: now - 800, data: { retryId: 'r2', turn: 1, step: 0, provider: 'deepseek', mode: 'normal', policyKey: 'default', retry: 2, maxRetries: 2, delayMs: 200, failure: { code: 'RATE_LIMIT', status: 429, message: 'request id xyz789 rate limit exceeded after 2.4s' } } },
    { type: 'turn/end', seq: 4, time: now - 700, data: { turn: 2, reason: { kind: 'error', error: { code: 'AUTH', status: 401, message: 'invalid api key' } } } },
  ]
  const persistence = {
    listSnapshots: async () => [{ header: { id: 'session-1', version: 0, createdAt: now, cwd: '/workspace/project/src' }, revision }],
    async readFrom(id, fromSeq) {
      reads += 1
      assert.equal(id, 'session-1')
      return { meta: { id, version: 0, createdAt: now, cwd: '/workspace/project/src' }, events: events.filter((event) => event.seq >= fromSeq) }
    },
  }
  const { handler } = createHost({
    services: {
      sessionPersistence: persistence,
      workspaceRegistry: { list: () => [{ id: 'project-1', title: 'Project One', path: '/workspace/project' }] },
    },
    env: { DSH_HOME: dshHome },
  })

  const first = await handler('usage-refresh', {})
  assert.equal(first.ok, true)
  assert.equal(first.value.indexedSessions, 1)
  assert.equal(reads, 1)
  assert.deepEqual(first.value.days[day].totals, {
    steps: 1,
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 300,
    cacheWriteTokens: 10,
    cacheHitRate: 300 / 410,
  })
  assert.equal(first.value.days[day].projects[0].id, 'project-1')
  assert.equal(first.value.days[day].projects[0].models[0].id, 'deepseek/deepseek-chat')
  assert.deepEqual(first.value.errors, {
    models: [
      { key: 'deepseek/deepseek-chat|RATE_LIMIT|429', provider: 'deepseek', model: 'deepseek-chat', code: 'RATE_LIMIT', status: 429, message: 'request id abc123 rate limit exceeded after 1.2s', count: 2, projectId: 'project-1', projectTitle: 'Project One' },
      { key: 'deepseek/deepseek-chat|AUTH|401', provider: 'deepseek', model: 'deepseek-chat', code: 'AUTH', status: 401, message: 'invalid api key', count: 1, projectId: 'project-1', projectTitle: 'Project One' },
    ],
    tools: [],
  })

  const unchanged = await handler('usage-refresh', {})
  assert.equal(unchanged.ok, true)
  assert.equal(reads, 1)

  revision = 'rev-2'
  events = events.concat([
    { type: 'request/header', seq: 5, time: now, data: { header: { config: { provider: 'openai', model: 'gpt-5' } }, reason: 'change' } },
    { type: 'assistant/message', seq: 6, time: now + 1, data: { turn: 1, step: 0, message: { role: 'assistant', content: [] }, usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ])
  const resumed = await handler('usage-refresh', {})
  assert.equal(resumed.ok, true)
  assert.equal(reads, 2)
  assert.equal(resumed.value.days[day].totals.steps, 2)
  assert.deepEqual(resumed.value.days[day].projects[0].models.map((model) => model.id).sort(), ['deepseek/deepseek-chat', 'openai/gpt-5'])

  const cached = await handler('usage', {})
  assert.equal(cached.ok, true)
  assert.equal(cached.value.days[day].totals.steps, 2)
  assert.equal(reads, 2)

  const restarted = createHost({ services: { sessionPersistence: persistence, workspaceRegistry: { list: () => [{ id: 'project-1', title: 'Project One', path: '/workspace/project' }] } }, env: { DSH_HOME: dshHome } })
  const persisted = await restarted.handler('usage', {})
  assert.equal(persisted.ok, true)
  assert.equal(persisted.value.days[day].totals.steps, 2)
  await restarted.handler('usage-refresh', {})
  assert.equal(reads, 2)
})

test('usage RPC groups UTC-hour buckets into the browser local calendar day', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-local-day-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const eventTime = Date.UTC(2026, 7, 19, 17, 30)
  const persistence = {
    listSnapshots: async () => [{ header: { id: 'session-local-day', version: 0, createdAt: eventTime, cwd: '/workspace/project' }, revision: 'rev-1' }],
    readFrom: async () => ({
      meta: { id: 'session-local-day', version: 0, createdAt: eventTime, cwd: '/workspace/project' },
      events: [
        { type: 'request/header', seq: 0, time: eventTime - 1, data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } } } },
        { type: 'assistant/message', seq: 1, time: eventTime, data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 10 } } },
      ],
    }),
  }
  const { handler } = createHost({
    services: {
      sessionPersistence: persistence,
      workspaceRegistry: { list: () => [{ id: 'project-1', title: 'Project One', path: '/workspace/project' }] },
    },
    env: { DSH_HOME: dshHome },
  })

  const refreshed = await handler('usage-refresh', { timezoneOffsetMinutes: -480 })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.value.days['2026-08-20'].totals.steps, 1)
  assert.equal(refreshed.value.days['2026-08-19'], undefined)

  const cached = await handler('usage', { timezoneOffsetMinutes: -480 })
  assert.equal(cached.ok, true)
  assert.equal(cached.value.days['2026-08-20'].totals.inputTokens, 100)
})

test('usage RPC groups direct and code-dispatched tool failures for the last 24 hours without persisting paths', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-tool-errors-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const now = Date.now()
  const old = now - 25 * 60 * 60 * 1000
  const events = [
    { type: 'tool/call', seq: 0, time: now - 5000, data: { turn: 0, step: 0, callId: 'call-1', name: 'edit', arguments: '{"file_path":"/workspace/a/README.md"}' } },
    { type: 'tool/result', seq: 1, time: now - 4900, surfaceOp: 'append', sourceEventSeqs: [0], data: { turn: 0, step: 0, message: { id: 'm1', role: 'user', source: { kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: 'call-1', isError: true, content: [{ type: 'text', text: 'Error: edit requires reading "/workspace/a/README.md" first — read the file, then retry' }] }] }, error: { name: 'Error', code: 'FS_NOT_OBSERVED' } } },
    { type: 'tool/call', seq: 2, time: now - 4000, data: { turn: 0, step: 1, callId: 'call-2', name: 'edit', arguments: '{"file_path":"/workspace/b/client.js"}' } },
    { type: 'tool/result', seq: 3, time: now - 3900, surfaceOp: 'append', sourceEventSeqs: [2], data: { turn: 0, step: 1, message: { id: 'm2', role: 'user', source: { kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: 'call-2', isError: true, content: [{ type: 'text', text: 'Error: edit requires reading "/workspace/b/client.js" first — read the file, then retry' }] }] }, error: { name: 'Error', code: 'FS_NOT_OBSERVED' } } },
    { type: 'tool/code-dispatch-start', seq: 4, time: now - 3000, data: { rootCallId: 'root', parentCallId: 'root', subCallId: 'root:code:0', name: 'grep', arguments: { path: '/missing/one' } } },
    { type: 'tool/code-dispatch', seq: 5, time: now - 2900, data: { rootCallId: 'root', parentCallId: 'root', subCallId: 'root:code:0', name: 'grep', arguments: { path: '/missing/one' }, isError: true, content: [{ type: 'text', text: 'Error: grep search failed (exit 2): rg: /missing/one: No such file or directory (os error 2)' }] } },
    { type: 'tool/code-dispatch', seq: 6, time: now - 2800, data: { rootCallId: 'root', parentCallId: 'root', subCallId: 'root:code:1', name: 'bash', arguments: { command: 'false' }, isError: false, content: [{ type: 'text', text: '[exit code: 1]' }] } },
    { type: 'tool/call', seq: 7, time: old - 100, data: { turn: 0, step: 2, callId: 'old-call', name: 'write', arguments: '{"file_path":"/old/path"}' } },
    { type: 'tool/result', seq: 8, time: old, surfaceOp: 'append', sourceEventSeqs: [7], data: { turn: 0, step: 2, message: { id: 'm3', role: 'user', source: { kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: 'old-call', isError: true, content: [{ type: 'text', text: 'Error: write failed for /old/path' }] }] }, error: { name: 'FsError', code: 'EACCES' } } },
  ]
  const persistence = {
    listSnapshots: async () => [{ header: { id: 'tool-session', version: 0, createdAt: now, cwd: '/workspace/project' }, revision: 'tool-rev' }],
    readFrom: async () => ({ meta: {}, events }),
  }
  const { handler } = createHost({ services: { sessionPersistence: persistence, workspaceRegistry: { list: () => [{ id: 'project', title: 'Project', path: '/workspace/project' }] } }, env: { DSH_HOME: dshHome } })

  const result = await handler('usage-refresh', {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.errors.tools, [
    { key: 'edit|FS_NOT_OBSERVED', tool: 'edit', code: 'FS_NOT_OBSERVED', message: 'edit requires reading <path> first — read the file, then retry', count: 2, projectId: 'project', projectTitle: 'Project' },
    { key: 'bash|EXIT_1', tool: 'bash', code: 'EXIT_1', message: 'bash command exited with code 1', count: 1, projectId: 'project', projectTitle: 'Project' },
    { key: 'grep|PATH_NOT_FOUND', tool: 'grep', code: 'PATH_NOT_FOUND', message: 'grep search failed: <path> not found', count: 1, projectId: 'project', projectTitle: 'Project' },
  ])
  const stored = await readFile(join(dshHome, 'dsh-service-usage-index.json'), 'utf8')
  assert.doesNotMatch(stored, /\/workspace\/a|\/workspace\/b|\/missing\/one|\/old\/path/)
})

test('usage indexes a read_image failure with no error code as IMAGE_NOT_SUPPORTED', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-usage-image-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const now = Date.now()
  const events = [
    { type: 'tool/call', seq: 0, time: now - 5000, data: { turn: 0, step: 0, callId: 'img-1', name: 'read_image', arguments: '{"file_path":"/workspace/pic.png"}' } },
    { type: 'tool/result', seq: 1, time: now - 4900, surfaceOp: 'append', sourceEventSeqs: [0], data: {
      turn: 0, step: 0, message: { id: 'm1', role: 'user', source: { kind: 'tool' }, content: [{ type: 'tool-result', toolCallId: 'img-1', isError: true, content: [{ type: 'text', text: 'Error: cannot read "/workspace/pic.png" as an image: model "deepseek-v4" does not declare image input; switch to an image-capable model to read images' }] }] } } },
  ]
  const persistence = {
    listSnapshots: async () => [{ header: { id: 'img-session', version: 0, createdAt: now, cwd: '/workspace/project' }, revision: 'img-rev' }],
    readFrom: async () => ({ meta: {}, events }),
  }
  const { handler } = createHost({ services: { sessionPersistence: persistence, workspaceRegistry: { list: () => [{ id: 'project', title: 'Project', path: '/workspace/project' }] } }, env: { DSH_HOME: dshHome } })

  const result = await handler('usage-refresh', {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.errors.tools, [
    { key: 'read_image|IMAGE_NOT_SUPPORTED', tool: 'read_image', code: 'IMAGE_NOT_SUPPORTED', message: 'read_image failed: the current model does not support image input; switch to an image-capable model', count: 1, projectId: 'project', projectTitle: 'Project' },
  ])
  const stored = await readFile(join(dshHome, 'dsh-service-usage-index.json'), 'utf8')
  assert.doesNotMatch(stored, /deepseek-v4|pic\.png/)
})

test('usage index skips inherited fork events and removes deleted sessions', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-usage-fork-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const time = new Date(2026, 7, 19, 8).getTime()
  let snapshots = [{ header: { id: 'fork', version: 0, createdAt: time, cwd: '/workspace', seedLength: 2 }, revision: 'a' }]
  const persistence = {
    listSnapshots: async () => snapshots,
    readFrom: async () => ({ meta: snapshots[0].header, events: [
      { type: 'request/header', seq: 2, time, data: { header: { config: { provider: 'anthropic', model: 'claude' } }, reason: 'resume' } },
      { type: 'assistant/message', seq: 3, time, data: { turn: 1, step: 0, message: { role: 'assistant', content: [] }, usage: { inputTokens: 60, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    ] }),
  }
  const { handler } = createHost({ services: { sessionPersistence: persistence }, env: { DSH_HOME: dshHome } })
  const built = await handler('usage-refresh', {})
  assert.equal(built.value.totals.steps, 1)
  assert.equal(built.value.totals.inputTokens, 60)
  snapshots = []
  const deleted = await handler('usage-refresh', {})
  assert.equal(deleted.value.totals.steps, 0)
  assert.equal(deleted.value.indexedSessions, 0)
})

test('usage ignores assistant steps whose provider reports no token data', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-usage-no-tokens-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const now = Date.now()
  const day = new Date(now).toLocaleDateString('en-CA')
  const events = [
    { type: 'request/header', seq: 0, time: now - 2000, data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' } }, reason: 'initial' } },
    { type: 'assistant/message', seq: 1, time: now - 1000, data: { turn: 0, step: 0, message: { role: 'assistant', content: [] } } },
    { type: 'assistant/message', seq: 2, time: now - 500, data: { turn: 0, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens: 40, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ]
  const persistence = {
    listSnapshots: async () => [{ header: { id: 'no-usage-session', version: 0, createdAt: now, cwd: '/workspace/project' }, revision: 'rev-1' }],
    readFrom: async () => ({ meta: {}, events }),
  }
  const { handler } = createHost({ services: { sessionPersistence: persistence, workspaceRegistry: { list: () => [{ id: 'project', title: 'Project', path: '/workspace/project' }] } }, env: { DSH_HOME: dshHome } })

  const result = await handler('usage-refresh', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.days[day].totals.steps, 1)
  assert.equal(result.value.days[day].totals.inputTokens, 40)
  assert.equal(result.value.days[day].totals.outputTokens, 10)
  assert.equal(result.value.days[day].totals.cacheReadTokens, 0)
  assert.deepEqual(result.value.days[day].projects[0].models.map((model) => model.id), ['deepseek/deepseek-chat'])
  assert.equal('missingUsage' in result.value.days[day].totals, false)
  assert.equal('missingUsage' in result.value.days[day].projects[0].models[0].totals, false)
})

test('usage index version mismatch rebuilds the persisted index', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-usage-rebuild-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const now = Date.now()
  const stale = { version: 4, updatedAt: now, sessions: { old: { revision: 'r', lastSeq: 1, project: { id: 'p', title: 'Old' }, currentModel: null, hours: {} } } }
  await mkdir(dshHome, { recursive: true })
  await writeFile(join(dshHome, 'dsh-service-usage-index.json'), JSON.stringify(stale))
  const persistence = {
    listSnapshots: async () => [],
    readFrom: async () => ({ meta: {}, events: [] }),
  }
  const { handler } = createHost({ services: { sessionPersistence: persistence }, env: { DSH_HOME: dshHome } })
  const result = await handler('usage-refresh', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.indexedSessions, 0)
  const stored = JSON.parse(await readFile(join(dshHome, 'dsh-service-usage-index.json'), 'utf8'))
  assert.equal(stored.version, 5)
  assert.deepEqual(Object.keys(stored.sessions), [])
})

test('backup RPC creates the fixed archive shape, lists totals, rejects forged ids, and deletes listed backups', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'sessions', 'workspace', 'session-1'), { recursive: true })
  await mkdir(join(dshHome, 'profiles', 'web', 'node_modules', 'ignored'), { recursive: true })
  await writeFile(join(dshHome, 'sessions', 'workspace', 'session-1', 'events.jsonl'), '{"type":"test"}\n')
  await writeFile(join(dshHome, 'settings.yaml'), 'theme: system\n')
  await writeFile(join(dshHome, 'cordis.patch.yml'), '- id: local\n')
  await writeFile(join(dshHome, 'profiles', 'web', 'package.json'), '{"name":"web-profile"}\n')
  await writeFile(join(dshHome, 'profiles', 'web', 'node_modules', 'ignored', 'secret.txt'), 'exclude me')
  await writeFile(join(dshHome, '.credentials.yaml'), 'secret: do-not-back-up\n')

  const { handler } = createHost({
    services: { subprocess: localSubprocess() },
    env: { DSH_HOME: dshHome },
  })

  const created = await handler('backup-create', {})
  assert.equal(created.ok, true)
  assert.match(created.value.item.name, /^dsh-backup-\d{8}-\d{6}\.tar\.gz$/)

  const archivePath = join(dshHome, 'backups', created.value.item.name)
  const archiveEntries = await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-tzf', archivePath])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(stdout.trim().split('\n')) : reject(new Error(stderr)))
  })
  assert.ok(archiveEntries.includes('sessions/workspace/session-1/events.jsonl'))
  assert.ok(archiveEntries.includes('config/settings.yaml'))
  assert.ok(archiveEntries.includes('config/cordis.patch.yml'))
  assert.ok(archiveEntries.includes('profiles/web/package.json'))
  assert.equal(archiveEntries.some((entry) => entry.includes('node_modules')), false)
  assert.equal(archiveEntries.some((entry) => entry.includes('credentials')), false)

  const listed = await handler('backup-list', {})
  assert.equal(listed.ok, true)
  assert.equal(listed.value.items.length, 1)
  assert.equal(listed.value.items[0].id, created.value.item.id)
  assert.equal(listed.value.totalBytes, listed.value.items[0].sizeBytes)
  assert.ok(listed.value.totalBytes > 0)

  const forged = await handler('backup-delete', { id: 'forged-id' })
  assert.deepEqual(forged, { ok: false, error: 'unknown-backup' })
  assert.equal(await readFile(archivePath).then(() => true), true)

  const imported = await handler('backup-import', { name: 'dsh-backup-20250819-120000.tar.gz', data: Buffer.from('imported archive').toString('base64') })
  assert.equal(imported.ok, true)
  assert.equal(imported.value.items.length, 2)
  const duplicate = await handler('backup-import', { name: 'dsh-backup-20250819-120000.tar.gz', data: Buffer.from('imported archive').toString('base64') })
  assert.deepEqual(duplicate, { ok: false, error: 'invalid-backup' })
  const deleted = await handler('backup-delete', { id: listed.value.items[0].id })
  assert.equal(deleted.ok, true)
  assert.equal(deleted.value.items.length, 1)
  assert.equal(deleted.value.totalBytes, imported.value.items.find((item) => item.name === 'dsh-backup-20250819-120000.tar.gz').sizeBytes)
})

test('healthz serves empty liveness responses and unregisters with the plugin fiber', async () => {
  const routes = []
  let unregisters = 0
  const { dispose } = createHost({
    services: {
      webServer: {
        register(nextRoute) {
          routes.push(nextRoute)
          return () => { unregisters += 1 }
        },
      },
    },
  })

  const route = routes.find((r) => r.path === '/healthz')
  assert.ok(route, 'healthz route should be registered')
  assert.deepEqual({ kind: route.kind, path: route.path }, { kind: 'exact', path: '/healthz' })

  for (const [method, expectedStatus] of [['GET', 200], ['HEAD', 200], ['POST', 405]]) {
    let statusCode
    let body = 'not-ended'
    const response = {
      writeHead(status) { statusCode = status },
      end(value) { body = value === undefined ? '' : String(value) },
    }
    await route.handler({ method }, response)
    assert.equal(statusCode, expectedStatus)
    assert.equal(body, '')
  }

  dispose()
  assert.ok(unregisters >= 1, 'at least healthz should be unregistered')
})

test('diagnostics RPC returns one overall report with storage, workspace, backup, executable, permission, and update checks', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-diagnostics-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-diagnostics-workspace-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })]))
  await chmod(dshHome, 0o755)
  await chmod(workspace, 0o755)
  const { handler } = createHost({
    services: {
      sessionPersistence: { listSnapshots: async () => [{ header: { id: 's1' }, revision: '1' }] },
      workspaceRegistry: { list: () => [{ id: 'project', title: 'Project', path: workspace }] },
      subprocess: { resolveExecutable: async (name) => `/usr/bin/${name}` },
    },
    env: { DSH_HOME: dshHome },
  })
  const result = await handler('diagnostics', {})
  assert.equal(result.ok, true)
  assert.match(result.value.status, /^(ok|warning)$/)
  assert.equal(typeof result.value.checkedAt, 'number')
  assert.deepEqual(result.value.checks.slice(0, 5).map((check) => check.id), ['session-storage', 'workspace-registry', 'dsh-home', 'backup-storage', 'tar'])
  assert.equal(result.value.checks.find((check) => check.id === 'session-storage').detail, '1')
  assert.equal(result.value.checks.find((check) => check.id === 'workspace-registry').detail, '1')
  assert.equal(result.value.checks.find((check) => check.id === 'permissions').status, 'ok')
  // 空备份是信息级提示（不算警告）：脚手架无其他告警源时 overall 应为 ok。
  const backupCheck = result.value.checks.find((check) => check.id === 'backup-storage')
  assert.deepEqual(backupCheck, { id: 'backup-storage', status: 'info', detail: '0:0' })
  assert.equal(result.value.status, 'ok')
  // createHost 默认强制 DSH_SERVICE_RUNTIME_ENV=managed → runtime-env 为 ok/declared；
  // node-version 的 detail 是「当前版本:要求 major」，本机 Node 满足 engines 时为 ok。
  assert.deepEqual(result.value.checks.find((check) => check.id === 'runtime-env'), { id: 'runtime-env', status: 'ok', detail: 'declared' })
  const nodeCheck = result.value.checks.find((check) => check.id === 'node-version')
  assert.match(nodeCheck.detail, /^v\d+\.\d+\.\d+:\d+$/)
  assert.equal(nodeCheck.status, 'ok')
})

test('health RPC reports process and service metrics with persisted-only session count', async () => {
  const runningAgent = { id: 'agent-running', status: 'running' }
  const idleAgent = { id: 'agent-idle', status: 'idle' }
  const sharedJob = { id: 'job-1', label: 'build', status: 'running' }
  const beforeUptime = process.uptime()

  const { handler } = createHost({
    services: {
      sessions: { list: () => [{ id: 'live-1' }, { id: 'live-2' }] },
      sessionQuery: {
        listSessions: async () => [
          { header: { id: 'persisted-1' }, live: true, persisted: true },
          { header: { id: 'persisted-2' }, live: false, persisted: true },
          { header: { id: 'live-only' }, live: true, persisted: false },
        ],
      },
      agents: { list: () => [runningAgent, idleAgent] },
      jobs: {
        list(caller) {
          if (caller === idleAgent) return []
          return [sharedJob]
        },
      },
      terminals: { list: () => [] },
    },
  })

  const result = await handler('health', {})

  assert.equal(result.ok, true)
  assert.deepEqual({
    liveSessions: result.value.liveSessions,
    persistedSessions: result.value.persistedSessions,
    activeAgents: result.value.activeAgents,
    activeJobs: result.value.activeJobs,
  }, {
    liveSessions: 2,
    persistedSessions: 2,
    activeAgents: 1,
    activeJobs: 1,
  })
  assert.ok(result.value.uptimeSeconds >= beforeUptime)
  assert.ok(result.value.uptimeSeconds <= process.uptime())
  assert.ok(Number.isInteger(result.value.rssBytes))
  assert.ok(result.value.rssBytes > 0)
  // v0.17 静态进程事实：平台/arch/Node 版本随每次 health 轮询返回。
  assert.equal(result.value.platform, process.platform)
  assert.equal(result.value.arch, process.arch)
  assert.equal(result.value.nodeVersion, process.version)
})

test('health RPC uses zero for unavailable optional services', async () => {
  const { handler } = createHost()

  const result = await handler('health', {})

  assert.equal(result.ok, true)
  assert.deepEqual({
    liveSessions: result.value.liveSessions,
    persistedSessions: result.value.persistedSessions,
    activeAgents: result.value.activeAgents,
    activeJobs: result.value.activeJobs,
  }, {
    liveSessions: 0,
    persistedSessions: 0,
    activeAgents: 0,
    activeJobs: 0,
  })
})

test('health RPC reports session query failures instead of inventing persisted metrics', async () => {
  const { handler } = createHost({
    services: {
      sessionQuery: { listSessions: async () => { throw new Error('storage unavailable') } },
    },
  })

  const result = await handler('health', {})

  assert.deepEqual(result, { ok: false, error: 'storage unavailable' })
})

test('activity RPC reports running agents, jobs, and agent-scoped terminals without duplicates', async () => {
  let runningAgent
  const terminalService = {
    list(owner) {
      if (owner !== runningAgent) return []
      return [{
        sessionId: 'terminal-1',
        name: 'dev shell',
        type: 'local',
        status: { kind: 'running' },
      }]
    },
  }
  runningAgent = { id: 'agent-running', status: 'running', ctx: { get: (service) => service === 'terminals' ? terminalService : undefined } }
  const idleAgent = { id: 'agent-idle', status: 'idle', ctx: { get: () => undefined } }
  const sharedJob = {
    id: 'bash-1',
    kind: 'bash',
    label: 'pnpm test',
    ownerSession: 'agent-running',
    status: 'running',
  }

  const { handler } = createHost({
    services: {
      agents: { list: () => [runningAgent, idleAgent] },
      jobs: {
        list(caller) {
          if (caller === runningAgent) return [sharedJob]
          if (caller === idleAgent) return []
          return [sharedJob]
        },
      },

    },
  })

  const result = await handler('activity', {})

  assert.deepEqual(result, {
    ok: true,
    value: {
      hasActive: true,
      items: [
        { type: 'agent', id: 'agent-running', label: 'agent-running', status: 'running' },
        { type: 'job', id: 'bash-1', label: 'pnpm test', status: 'running', ownerSession: 'agent-running' },
        { type: 'terminal', id: 'terminal-1', label: 'dev shell', status: 'running', ownerSession: 'agent-running' },
      ],
    },
  })
})

test('activity tolerates an agent with an unavailable scoped terminal service', async () => {
  const malformedAgent = {
    id: 'agent-without-terminal-realm',
    status: 'running',
    ctx: { get: () => { throw new Error('terminal realm unavailable') } },
  }
  const { handler } = createHost({
    services: {
      agents: { list: () => [malformedAgent] },
      jobs: { list: () => [] },
    },
  })

  const activity = await handler('activity', {})
  assert.deepEqual(activity, {
    ok: true,
    value: {
      hasActive: true,
      items: [{ type: 'agent', id: malformedAgent.id, label: malformedAgent.id, status: 'running' }],
    },
  })
  const health = await handler('health', {})
  assert.equal(health.ok, true)
  assert.equal(health.value.activeAgents, 1)
})

test('idle restart schedules exit without requiring force', async () => {
  const { handler, scheduled } = createHost({
    services: {
      agents: { list: () => [{ id: 'agent-idle', status: 'idle' }] },
      jobs: { list: () => [] },
      terminals: { list: () => [] },
    },
  })

  const result = await handler('web', {})
  assert.equal(result.ok, true)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 500)
})

test('restart is blocked by active work unless force is explicit', async () => {
  const runningAgent = { id: 'agent-running', status: 'running' }
  const { handler, scheduled } = createHost({
    services: {
      agents: { list: () => [runningAgent] },
      jobs: { list: () => [] },
      terminals: { list: () => [] },
    },
  })

  const blocked = await handler('web', {})
  assert.equal(blocked.ok, false)
  assert.equal(blocked.error, 'active-work')
  assert.equal(blocked.value.items.length, 1)
  assert.equal(scheduled.length, 0)

  const forced = await handler('web', { force: true })
  assert.equal(forced.ok, true)
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 500)
})

test('update RPC checks DSH and plugin versions once and reuses the successful cache', async (t) => {
  const originalGet = https.get
  const requests = []
  https.get = (url, options, callback) => {
    requests.push(String(url))
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      const isDsh = String(url).includes('%40deepseek-ai%2Fdsh')
      response.emit('data', JSON.stringify({ 'dist-tags': isDsh ? { latest: '0.1.0-rc.7', next: '0.2.0-rc.1' } : { latest: '0.10.1', next: '0.11.0' } }))
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost()
  const first = await host.handler('check-update', {})
  const second = await host.handler('check-update', {})
  assert.equal(first.ok, true)
  assert.equal(first.value.dsh.current, installedDshVersion)
  assert.equal(first.value.dsh.latest, '0.2.0-rc.1')
  assert.deepEqual(first.value.dsh.tags, { latest: '0.1.0-rc.7', next: '0.2.0-rc.1' })
  assert.equal(first.value.dsh.upToDate, false)
  assert.equal(first.value.plugin.current, pluginVersion)
  assert.equal(first.value.plugin.latest, '0.11.0')
  assert.deepEqual(first.value.plugin.tags, { latest: '0.10.1', next: '0.11.0' })
  assert.equal(first.value.plugin.upToDate, true)
  assert.equal(first.value.cached, false)
  assert.equal(second.value.cached, true)
  assert.equal(requests.length, 2)
})

test('update RPC preserves the DSH result when the unpublished plugin package returns 404', async (t) => {
  const originalGet = https.get
  https.get = (url, options, callback) => {
    const response = new EventEmitter()
    response.statusCode = String(url).includes('%40deepseek-ai%2Fdsh') ? 200 : 404
    response.setEncoding = () => {}
    response.resume = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      if (response.statusCode === 200) {
        response.emit('data', JSON.stringify({ 'dist-tags': { latest: '0.1.0-rc.7', next: '0.1.0-rc.7' } }))
        response.emit('end')
      }
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost()
  const result = await host.handler('check-update', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.dsh.upToDate, true)
  assert.equal(result.value.plugin.status, 'unpublished')
  assert.equal(result.value.plugin.current, pluginVersion)
  assert.equal(result.value.plugin.latest, null)
})

test('version and restart responses expose one stable process instance id', async () => {
  const { handler } = createHost()

  const first = await handler('version', {})
  const second = await handler('version', {})
  const restart = await handler('web', {})

  assert.equal(first.ok, true)
  assert.equal(typeof first.value.instanceId, 'string')
  assert.notEqual(first.value.instanceId, '')
  assert.equal(second.value.instanceId, first.value.instanceId)
  assert.equal(restart.value.instanceId, first.value.instanceId)
})

test('optional commands service registers a guarded /restart command and cleans it up', async () => {
  const host = createHost({ commands: true })
  assert.equal(host.registeredCommands.length, 1)
  const command = host.registeredCommands[0]
  assert.equal(command.name, 'restart')
  assert.match(command.description, /restart/i)
  const success = await command.handler({ rawInput: '   ' })
  assert.deepEqual(success, { kind: 'success', text: 'Restart scheduled. The DSH Web process will exit in 0.5 seconds.' })
  assert.deepEqual(host.scheduled.map((entry) => entry.delay), [500])
  const invalid = await command.handler({ rawInput: ' now' })
  assert.deepEqual(invalid, { kind: 'error', text: '/restart does not accept arguments.' })
  const activeHost = createHost({ commands: true, services: { agents: { list: () => [{ id: 'agent-1', status: 'running' }] } } })
  const blocked = await activeHost.registeredCommands[0].handler({ rawInput: '' })
  assert.deepEqual(blocked, { kind: 'error', text: 'Restart refused: 1 active item(s) detected. Use the Service Control restart tab to review them.' })
  assert.deepEqual(activeHost.scheduled, [])
  host.dispose()
  activeHost.dispose()
})

test('host plugin keeps the dsh-service public identity', () => {
  assert.equal(name, 'dsh-service')
})

// ---- 一键升级（profile 中继 + 白名单收口）----

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

async function makeHome(t, prefix = 'dsh-service-upgrade-') {
  const dshHome = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  return dshHome
}

// 被测临时环境的 profile 脚手架：写入 manifest、可选 pnpm-workspace.yaml 与已安装副本
// （真实目录或指向本仓库的 symlink，后者用于「当前加载副本」匹配测试）。
async function scaffoldProfile(dshHome, { name = 'web', spec = '0.13.0', workspace = true, installedVersion, linkToRepo = false }) {
  const dir = join(dshHome, 'profiles', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `dsh-profile-${name}`, private: true, dependencies: { '@gehennawu/dsh-service': spec } }))
  if (workspace) await writeFile(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  if (linkToRepo) {
    await mkdir(join(dir, 'node_modules', '@gehennawu'), { recursive: true })
    await symlink(repoRoot, join(dir, 'node_modules', '@gehennawu', 'dsh-service'), 'dir')
  } else if (installedVersion !== undefined) {
    const pkgDir = join(dir, 'node_modules', '@gehennawu', 'dsh-service')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@gehennawu/dsh-service', version: installedVersion }))
  }
  return dir
}

// 模拟 subprocess：记录 argv，可选按 logical argv 命中一次性失败行为（pnpm 各特征），
// 成功且 simulateInstall 时把目标版本写进 profile 的 node_modules（模拟 registry 安装落盘）。
function upgradeSubprocess({ dshHome, simulateInstall = true, executables = { dsh: '/usr/bin/dsh' }, behaviors = [] }) {
  const spawned = []
  const resolved = []
  const service = {
    resolveExecutable: async (command) => {
      resolved.push(command)
      const found = executables[command]
      if (found === undefined) throw new Error(`not found: ${command}`)
      return found
    },
    spawn(spec) {
      spawned.push(spec)
      const win32Routed = /[/\\]cmd(\.exe)?$/i.test(spec.argv[0]) && spec.argv[1] === '/d'
      const logical = win32Routed ? spec.argv.slice(5) : spec.argv.slice(1)
      const behavior = behaviors.find((entry) => !entry.used && entry.match(logical))
      if (behavior !== undefined) behavior.used = true
      const exitCode = behavior === undefined ? 0 : behavior.exitCode
      const signal = exitCode === -1 ? 'SIGKILL' : null
      const stderr = behavior === undefined ? '' : (behavior.stderr || '')
      const stdout = behavior === undefined ? '' : (behavior.stdout || '')
      if (simulateInstall && exitCode === 0 && signal === null && logical.includes('add')) {
        const profileName = logical[logical.indexOf('--profile') + 1]
        const target = logical[logical.length - 1]
        const version = target.slice(target.lastIndexOf('@') + 1)
        const installed = join(dshHome, 'profiles', profileName, 'node_modules', '@gehennawu', 'dsh-service', 'package.json')
        mkdirSync(dirname(installed), { recursive: true })
        writeFileSync(installed, JSON.stringify({ name: '@gehennawu/dsh-service', version }))
      }
      return {
        collected: {
          stdout: { readFrom: () => ({ text: stdout }) },
          stderr: { readFrom: () => ({ text: stderr }) },
        },
        done: Promise.resolve({ exitCode, signal }),
      }
    },
  }
  return { spawned, resolved, service }
}

function mockPluginRegistry(t, latest = '9.9.9') {
  const originalGet = https.get
  https.get = (url, options, callback) => {
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', JSON.stringify({ 'dist-tags': { latest, next: latest } }))
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
}

test('upgrade refuses while active work exists', async (t) => {
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home })
  const { handler, scheduled } = createHost({
    env: { DSH_HOME: home },
    services: { subprocess, agents: { list: () => [{ id: 'agent-a', status: 'running' }] }, jobs: { list: () => [] } },
  })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'active-work')
  assert.equal(spawned.length, 0)
  assert.equal(scheduled.length, 0)
})

test('upgrade refuses link: and file: installs and reports missing profiles', async (t) => {
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: 'link:/workspace/projects/dsh-service' })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home })
  const linkHost = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const link = await linkHost.handler('upgrade', {})
  assert.equal(link.ok, false)
  assert.equal(link.error, 'link-install')
  assert.equal(spawned.length, 0)

  const fileHome = await makeHome(t, 'dsh-service-upgrade-file-')
  await scaffoldProfile(fileHome, { spec: 'file:/workspace/junk/dsh-service' })
  const { service: subprocess2 } = upgradeSubprocess({ dshHome: fileHome })
  const fileHost = createHost({ env: { DSH_HOME: fileHome }, services: { subprocess: subprocess2 } })
  const file = await fileHost.handler('upgrade', {})
  assert.equal(file.ok, false)
  assert.equal(file.error, 'file-install')

  const emptyHome = await makeHome(t, 'dsh-service-upgrade-empty-')
  await mkdir(join(emptyHome, 'profiles'), { recursive: true })
  const { service: subprocess3 } = upgradeSubprocess({ dshHome: emptyHome })
  const missingHost = createHost({ env: { DSH_HOME: emptyHome }, services: { subprocess: subprocess3 } })
  const missing = await missingHost.handler('upgrade', {})
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'no-profile-found')
})

test('upgrade refuses to downgrade when latest is not newer than the loaded version', async (t) => {
  mockPluginRegistry(t, '0.1.0')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'no-newer-version')
  assert.equal(spawned.length, 0)
  assert.equal(scheduled.length, 0)
})

test('upgrade runs dsh plugin add against the discovered workspace profile and restarts', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const { service: subprocess, spawned, resolved } = upgradeSubprocess({ dshHome: home })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, true)
  assert.deepEqual(resolved, ['dsh'])
  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0].argv, ['/usr/bin/dsh', 'plugin', '--profile', 'web', 'add', '-w', '@gehennawu/dsh-service@9.9.9'])
  assert.equal(spawned[0].cwd, '/')
  assert.deepEqual(result.value, { result: 'upgraded', profile: 'web', previous: pluginVersion, installed: '9.9.9' })
  assert.deepEqual(scheduled.map((entry) => entry.delay), [500])
})

test('upgrade omits -w when the profile is not a pnpm workspace', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { name: 'tui', spec: '^0.13.0', installedVersion: pluginVersion, workspace: false })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home })
  const { handler } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, true)
  assert.deepEqual(spawned[0].argv, ['/usr/bin/dsh', 'plugin', '--profile', 'tui', 'add', '@gehennawu/dsh-service@9.9.9'])
})

test('upgrade fails as ambiguous when several profiles install the plugin and none matches', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { name: 'tui', spec: '^0.13.0', installedVersion: '0.13.0', workspace: false })
  await scaffoldProfile(home, { name: 'web', spec: '^0.13.0', installedVersion: '0.13.0', workspace: true })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home })
  const { handler } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'ambiguous-profile')
  assert.equal(spawned.length, 0)
})

test('upgrade selects the multi-profile winner by matching the loaded plugin copy', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { name: 'tui', spec: '^0.13.0', installedVersion: '0.13.0', workspace: false })
  await scaffoldProfile(home, { name: 'web', spec: '^0.13.0', workspace: true, linkToRepo: true })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home, simulateInstall: false })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  // 选中 web（当前加载副本指向本仓库）而非报 ambiguous；web 版本与运行副本一致 → 视为陈旧，不重启。
  assert.equal(result.ok, false)
  assert.equal(result.error, 'upgrade-stale')
  assert.deepEqual(spawned[0].argv, ['/usr/bin/dsh', 'plugin', '--profile', 'web', 'add', '-w', '@gehennawu/dsh-service@9.9.9'])
  assert.equal(scheduled.length, 0)
})

test('upgrade does not restart when pnpm exits 0 but the installed version did not change', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home, simulateInstall: false })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'upgrade-stale')
  assert.equal(spawned.length, 1)
  assert.equal(scheduled.length, 0)
})

test('upgrade fails when the installed version cannot be read after pnpm succeeds', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', workspace: true })
  const { service: subprocess } = upgradeSubprocess({ dshHome: home, simulateInstall: false })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'installed-version-unreadable')
  assert.equal(scheduled.length, 0)
})

test('upgrade rebuilds a stale pnpm-major modules dir and retries the add once', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const behaviors = [
    { match: (l) => l.includes('add') && !l.includes('install'), exitCode: 7, stderr: 'ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF: public-hoist-pattern[] differs' },
  ]
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home, behaviors })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, true)
  assert.equal(spawned.length, 3)
  assert.deepEqual(spawned.map((spec) => spec.argv.slice(1)), [
    ['plugin', '--profile', 'web', 'add', '-w', '@gehennawu/dsh-service@9.9.9'],
    ['plugin', '--profile', 'web', 'install', '--no-frozen-lockfile'],
    ['plugin', '--profile', 'web', 'add', '-w', '@gehennawu/dsh-service@9.9.9'],
  ])
  assert.ok(scheduled.length >= 1, 'restart is scheduled after the recovered upgrade')
})

test('upgrade retries once with minimumReleaseAge=0 after pnpm blocks a too-young release', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const behaviors = [
    { match: (l) => l.includes('add') && !l.includes('minimumReleaseAge'), exitCode: 1, stderr: 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION\nVerification failed during install:' },
  ]
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home, behaviors })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, true)
  assert.equal(spawned.length, 2)
  assert.deepEqual(spawned[1].argv.slice(1), ['plugin', '--profile', 'web', 'add', '--config.minimumReleaseAge=0', '-w', '@gehennawu/dsh-service@9.9.9'])
  assert.ok(scheduled.length >= 1)
})

test('upgrade retries a transient network failure once with the original command', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const behaviors = [
    { match: (l) => l.includes('add'), exitCode: 1, stderr: 'FetchError: request to https://registry failed, reason: socket hang up' },
  ]
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home, behaviors })
  const { handler } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, true)
  assert.equal(spawned.length, 2)
  assert.deepEqual(spawned[1].argv, spawned[0].argv)
})

test('upgrade surfaces a residual unknown pnpm failure without restarting', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const behaviors = [
    { match: (l) => l.includes('add'), exitCode: 5, stderr: 'mystery boom' },
  ]
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home, behaviors })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, false)
  assert.match(result.error, /^dsh-failed: mystery boom/)
  assert.equal(spawned.length, 1)
  assert.equal(scheduled.length, 0)
})

test('upgrade reports when pnpm is missing on PATH', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const behaviors = [
    { match: (l) => l.includes('add'), exitCode: 127, stderr: 'dsh: pnpm not found on PATH — install pnpm to manage profile plugins' },
  ]
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home, behaviors })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })
  const result = await handler('upgrade', {})
  assert.equal(result.ok, false)
  assert.equal(result.error, 'pnpm-missing')
  assert.equal(spawned.length, 1)
  assert.equal(scheduled.length, 0)
})

test('upgrade wraps a resolved dsh.cmd through cmd.exe on Windows with a valid cwd', async (t) => {
  const originalPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  t.after(() => Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true }))
  const originalSystemRoot = process.env.SystemRoot
  process.env.SystemRoot = 'C:\\FakeWindows'
  t.after(() => {
    if (originalSystemRoot === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = originalSystemRoot
  })

  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const { service: subprocess, spawned, resolved } = upgradeSubprocess({
    dshHome: home,
    executables: { dsh: 'C:\\Program Files\\nodejs\\dsh.CMD', 'cmd.exe': 'C:\\Windows\\System32\\cmd.exe' },
  })
  const { handler, scheduled } = createHost({ env: { DSH_HOME: home }, services: { subprocess } })

  const result = await handler('upgrade', {})

  assert.equal(result.ok, true)
  assert.deepEqual(resolved, ['dsh', 'cmd.exe'])
  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0].argv, ['C:\\Windows\\System32\\cmd.exe', '/d', '/s', '/c', 'C:\\Program Files\\nodejs\\dsh.CMD', 'plugin', '--profile', 'web', 'add', '-w', '@gehennawu/dsh-service@9.9.9'])
  assert.equal(spawned[0].cwd, 'C:\\FakeWindows')
  assert.ok(scheduled.length >= 1, 'restart is scheduled after a successful upgrade')
})

// ---- 运行环境探测（v0.16）----

test('runtime env classifies supervisors, manual terminals, and unknown contexts from passive signals', () => {
  // 全原语注入，不碰真实 env/fs/TTY：任何环境跑结果都一致。
  const base = { env: {}, platform: 'linux', stdinIsTTY: false, stdoutIsTTY: false, dockerEnvExists: false, cgroupText: '' }
  assert.deepEqual(detectRuntimeEnv({ ...base, env: { pm_id: '0' } }), { platform: 'linux', supervisorKind: 'pm2', manualStartLikely: false })
  assert.equal(detectRuntimeEnv({ ...base, env: { INVOCATION_ID: 'x' } }).supervisorKind, 'systemd')
  assert.equal(detectRuntimeEnv({ ...base, env: { NOTIFY_SOCKET: '/run/systemd/notify' } }).supervisorKind, 'systemd')
  assert.equal(detectRuntimeEnv({ ...base, env: { SUPERVISOR_ENABLED: '1' } }).supervisorKind, 'supervisord')
  assert.equal(detectRuntimeEnv({ ...base, env: { KUBERNETES_SERVICE_HOST: '10.96.0.1' } }).supervisorKind, 'kubernetes')
  assert.equal(detectRuntimeEnv({ ...base, dockerEnvExists: true }).supervisorKind, 'docker')
  assert.equal(detectRuntimeEnv({ ...base, cgroupText: '12:pids:/docker/abc123' }).supervisorKind, 'docker')
  assert.equal(detectRuntimeEnv({ ...base, cgroupText: '9:cpuset:/kubepods/burstable/podxyz' }).supervisorKind, 'container')

  // 双 TTY 且无正向信号 → 疑似终端手动启动；缺任一 TTY（输出重定向、服务包装器）回落 unknown。
  const manual = detectRuntimeEnv({ ...base, stdinIsTTY: true, stdoutIsTTY: true })
  assert.deepEqual(manual, { platform: 'linux', supervisorKind: null, manualStartLikely: true })
  assert.equal(detectRuntimeEnv({ ...base, stdinIsTTY: true, stdoutIsTTY: false }).manualStartLikely, false)
  assert.equal(detectRuntimeEnv({ ...base, stdinIsTTY: false, stdoutIsTTY: true }).manualStartLikely, false)

  // 正向信号优先于 TTY：docker run -it 开发场景不因交互终端误报手动启动。
  assert.equal(detectRuntimeEnv({ ...base, dockerEnvExists: true, stdinIsTTY: true, stdoutIsTTY: true }).manualStartLikely, false)

  // win32 原生进程不做 /.dockerenv 与 /proc 探测，双 TTY 判定不受影响。
  const win32 = { ...base, platform: 'win32', dockerEnvExists: true, cgroupText: 'docker' }
  assert.equal(detectRuntimeEnv(win32).supervisorKind, null)
  assert.equal(detectRuntimeEnv({ ...win32, stdinIsTTY: true, stdoutIsTTY: true }).manualStartLikely, true)

  // DSH_SERVICE_RUNTIME_ENV 显式声明压过一切探测；无法识别的取值被忽略。
  assert.deepEqual(detectRuntimeEnv({ ...base, env: { DSH_SERVICE_RUNTIME_ENV: 'manual' } }), { platform: 'linux', supervisorKind: null, manualStartLikely: true })
  assert.deepEqual(detectRuntimeEnv({ ...base, env: { DSH_SERVICE_RUNTIME_ENV: 'managed' } }), { platform: 'linux', supervisorKind: 'declared', manualStartLikely: false })
  assert.equal(detectRuntimeEnv({ ...base, env: { DSH_SERVICE_RUNTIME_ENV: 'yes', pm_id: '1' } }).supervisorKind, 'pm2')

  // 真实进程只断言形状：具体分类取决于运行容器，不属于用例契约。
  const live = detectRuntimeEnv()
  assert.equal(typeof live.platform, 'string')
  assert.equal(typeof live.manualStartLikely, 'boolean')
})

test('upgrade in a declared manual environment installs without exiting and version carries the runtime env', async (t) => {
  mockPluginRegistry(t, '9.9.9')
  const home = await makeHome(t)
  await scaffoldProfile(home, { spec: '^0.13.0', installedVersion: pluginVersion, workspace: true })
  const { service: subprocess, spawned } = upgradeSubprocess({ dshHome: home })
  const { handler, scheduled } = createHost({
    env: { DSH_SERVICE_RUNTIME_ENV: 'manual', DSH_HOME: home },
    services: { subprocess },
  })

  const version = await handler('version', {})
  assert.equal(version.ok, true)
  assert.equal(version.value.runtimeEnv.manualStartLikely, true)
  assert.equal(version.value.runtimeEnv.supervisorKind, null)

  const result = await handler('upgrade', {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { result: 'upgraded', profile: 'web', previous: pluginVersion, installed: '9.9.9', requiresManualRestart: true })
  assert.equal(spawned.length, 1)
  assert.equal(scheduled.length, 0, 'no exit is scheduled when nothing would restart the process')
})

test('diagnostics keeps a declared manual environment advisory: yellow inline, overall stays ok', async (t) => {
  const home = await makeHome(t, 'dsh-service-diag-manual-')
  const { handler } = createHost({
    env: { DSH_SERVICE_RUNTIME_ENV: 'manual', DSH_HOME: home },
    services: {
      sessionPersistence: { listSnapshots: async () => [{ header: { id: 's1' }, revision: '1' }] },
      workspaceRegistry: { list: () => [] },
      subprocess: { resolveExecutable: async (name) => `/usr/bin/${name}` },
    },
  })
  const result = await handler('diagnostics', {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.checks.find((check) => check.id === 'runtime-env'), { id: 'runtime-env', status: 'warning', detail: 'manual', advisory: true })
  // advisory 警告不把 overall 拉成 warning：没有其他告警源时整体仍是 ok。
  assert.equal(result.value.status, 'ok')
})

test('runtime env check maps each environment to ok, advisory warning, or a non-alarming info', () => {
  // 疑似手动终端启动 → warning + advisory：黄色行内提示，不参与 overall 聚合、不点亮标签 ⚠。
  assert.deepEqual(runtimeEnvCheck({ platform: 'win32', supervisorKind: null, manualStartLikely: true }), { id: 'runtime-env', status: 'warning', detail: 'manual', advisory: true })
  // 已识别管理器与用户声明 → ok。
  assert.deepEqual(runtimeEnvCheck({ platform: 'linux', supervisorKind: 'docker', manualStartLikely: false }), { id: 'runtime-env', status: 'ok', detail: 'docker' })
  assert.deepEqual(runtimeEnvCheck({ platform: 'linux', supervisorKind: 'declared', manualStartLikely: false }), { id: 'runtime-env', status: 'ok', detail: 'declared' })
  // unknown → info：维持现状本是默认路径，不算警告，不点亮标签 ⚠。
  assert.deepEqual(runtimeEnvCheck({ platform: 'linux', supervisorKind: null, manualStartLikely: false }), { id: 'runtime-env', status: 'info', detail: 'unknown' })
  // 宿主未提供运行环境（老版本/异常）→ 不产生该检查项。
  assert.equal(runtimeEnvCheck(undefined), null)
  assert.equal(runtimeEnvCheck(null), null)
})

// ── v0.18 远端额度 ──────────────────────────────────────────────────────────────

const OPENCODE_FIXTURE = {
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-08-23T11:16:13.823Z' },
    weekly: { status: 'ok', percent: 14, resetsAt: '2026-08-24T00:00:00.823Z' },
    monthly: { status: 'ok', percent: 7, resetsAt: '2026-09-21T06:16:35.823Z' },
  },
}

test('opencode-go parser maps percent-only windows and tolerates missing fields', () => {
  assert.deepEqual(normalizeOpencodeUsage(OPENCODE_FIXTURE), {
    windows: [
      { id: 'rolling', percent: 0, resetsAt: '2026-08-23T11:16:13.823Z' },
      { id: 'weekly', percent: 14, resetsAt: '2026-08-24T00:00:00.823Z' },
      { id: 'monthly', percent: 7, resetsAt: '2026-09-21T06:16:35.823Z' },
    ],
  })
  // 非数字 percent 逐窗口跳过、截断到 [0,100]、未知窗口 id 忽略、resetsAt 缺失不造数。
  assert.deepEqual(
    normalizeOpencodeUsage({
      usage: {
        rolling: { percent: 150 },
        weekly: { percent: -5 },
        monthly: { percent: 'x', resetsAt: 'ignored' },
        extra: { percent: 3 },
      },
    }).windows,
    [
      { id: 'rolling', percent: 100 },
      { id: 'weekly', percent: 0 },
    ],
  )
  assert.deepEqual(normalizeOpencodeUsage(undefined).windows, [])
  assert.deepEqual(normalizeOpencodeUsage({ usage: null }).windows, [])
})

test('quota config parsing falls back safely on corruption and drops unknown kinds', () => {
  assert.deepEqual(parseQuotaConfigText('not json'), { version: 1, kinds: {}, resetCards: [] })
  assert.deepEqual(parseQuotaConfigText('{"version":99,"kinds":{"p":"opencode-go"}}'), { version: 1, kinds: {}, resetCards: [] })
  assert.deepEqual(parseQuotaConfigText('{"version":1,"kinds":{"p":"mystery","q":"opencode-go"}}'), { version: 1, kinds: { q: 'opencode-go' }, resetCards: [] })
  assert.deepEqual(parseQuotaConfigText('{"version":1,"kinds":[] }'), { version: 1, kinds: {}, resetCards: [] })
  // null = 显式停用，必须原样保留。
  assert.deepEqual(parseQuotaConfigText('{"version":1,"kinds":{"p":null,"q":"opencode-go"}}'), { version: 1, kinds: { p: null, q: 'opencode-go' }, resetCards: [] })
  // resetCards（v0.20 免次数）：provider 必填，label/expiresAt 可选，remaining 不再保留；id 缺失按原始位置合成。
  const withCards = parseQuotaConfigText(JSON.stringify({
    version: 1,
    kinds: {},
    resetCards: [
      { provider: 'zai-coding-cn', label: '周额度重置卡', remaining: 2.4, expiresAt: '2026-09-01' },
      { provider: 'zai-coding-cn', remaining: -3 },
      { remaining: 1 },
      { provider: 'x' },
      'garbage',
      null,
    ],
  }))
  assert.deepEqual(withCards.resetCards, [
    { id: 'legacy-0', provider: 'zai-coding-cn', label: '周额度重置卡', expiresAt: '2026-09-01' },
    { id: 'legacy-1', provider: 'zai-coding-cn' },
    { id: 'legacy-3', provider: 'x' },
  ])
})

test('readLlmProviders normalizes profiles and tolerates missing settings service', () => {
  assert.deepEqual(readLlmProviders(undefined), [])
  assert.deepEqual(readLlmProviders({ get: () => undefined }), [])
  assert.deepEqual(readLlmProviders({ get: () => { throw new Error('boom') } }), [])
  assert.deepEqual(
    readLlmProviders({
      get: (ns) => (ns === 'llm-pi-ai'
        ? {
            providers: {
              a: { displayName: 'A 供应商', baseURL: 'https://a.example///', apiKeyEnv: 'A_KEY' },
              b: { models: [] },
            },
          }
        : undefined),
    }),
    [
      { name: 'a', displayName: 'A 供应商', baseURL: 'https://a.example', apiKeyEnv: 'A_KEY' },
      { name: 'b', displayName: 'b', baseURL: '', apiKeyEnv: '' },
    ],
  )
})

test('quota throttle enforces single-flight, TTL, min interval, and capped exponential backoff', () => {
  const throttle = createQuotaThrottle({ successTtlMs: 60_000, minIntervalMs: 15_000, backoffBaseMs: 30_000, backoffMaxMs: 15 * 60_000 })
  let now = 1_000_000
  // 单飞：进行中一律拒绝且 nextAllowedAt 未知。
  assert.equal(throttle.attempt('p', now).ok, true)
  const busy = throttle.attempt('p', now + 1)
  assert.equal(busy.ok, false)
  assert.equal(busy.reason, 'inflight')
  assert.equal(busy.nextAllowedAt, null)
  throttle.settle('p', { ok: true, windows: [{ id: 'weekly', percent: 14 }] }, now + 2)
  const view = throttle.view('p', now + 2)
  assert.equal(view.refreshing, false)
  assert.deepEqual(view.windows, [{ id: 'weekly', percent: 14 }])
  assert.equal(view.fetchedAt, now + 2)
  assert.equal(view.lastError, undefined)
  // 成功 TTL 内拒绝（fresh），TTL 恰好过期后放行。
  assert.equal(throttle.attempt('p', now + 3).reason, 'fresh')
  assert.equal(throttle.attempt('p', now + 2 + 60_000).ok, true)
  throttle.settle('p', { ok: true, windows: [] }, now + 2 + 60_000)

  // 最小上游间隔：TTL 置 0 单独验证 15s 间隔规则。
  const tight = createQuotaThrottle({ successTtlMs: 0, minIntervalMs: 15_000, backoffBaseMs: 30_000, backoffMaxMs: 60_000 })
  const t0 = 500_000
  assert.equal(tight.attempt('p', t0).ok, true)
  tight.settle('p', { ok: true, windows: [{ id: 'rolling', percent: 1 }] }, t0 + 1)
  const intervalDenial = tight.attempt('p', t0 + 10_000)
  assert.equal(intervalDenial.reason, 'interval')
  assert.equal(intervalDenial.nextAllowedAt, t0 + 15_000)
  assert.equal(tight.attempt('p', t0 + 15_000).ok, true)

  // 失败指数退避：30s 起步 ×2、封顶 60s（此实例配置），成功后清零。
  const backoff = createQuotaThrottle({ successTtlMs: 0, minIntervalMs: 0, backoffBaseMs: 30_000, backoffMaxMs: 60_000 })
  const b0 = 900_000
  assert.equal(backoff.attempt('a', b0).ok, true)
  backoff.settle('a', { ok: false, code: 'network' }, b0)
  let denial = backoff.attempt('a', b0 + 1)
  assert.equal(denial.reason, 'backoff')
  assert.equal(denial.nextAllowedAt, b0 + 30_000)
  assert.equal(backoff.attempt('a', b0 + 30_000).ok, true)
  backoff.settle('a', { ok: false, code: 'timeout' }, b0 + 30_000)
  denial = backoff.attempt('a', b0 + 31_000)
  assert.equal(denial.nextAllowedAt, b0 + 90_000)
  assert.equal(backoff.attempt('a', b0 + 90_000).ok, true)
  backoff.settle('a', { ok: false, code: 'http-status:403' }, b0 + 90_000)
  denial = backoff.attempt('a', b0 + 91_000)
  assert.equal(denial.nextAllowedAt, b0 + 150_000)
  assert.equal(backoff.view('a', b0 + 91_000).lastError, 'http-status:403')
  assert.equal(backoff.attempt('a', b0 + 150_000).ok, true)
  backoff.settle('a', { ok: true, windows: [{ id: 'monthly', percent: 2 }] }, b0 + 150_000)
  assert.equal(backoff.view('a', b0 + 151_000).lastError, undefined)
  assert.deepEqual(backoff.view('a', b0 + 151_000).windows, [{ id: 'monthly', percent: 2 }])
})

test('fetchProviderUsage GETs the given endpoint with Bearer and reports stable error codes', async (t) => {
  const originalGet = https.get
  t.after(() => { https.get = originalGet })
  {
    https.get = (url, options, callback) => {
      assert.equal(String(url), 'https://x.example/v1/usage') // 端点由 quotaEndpointFor 解析后透传
      assert.equal(options.headers.Authorization, 'Bearer k')
      const response = new EventEmitter()
      response.statusCode = 200
      response.setEncoding = () => {}
      const request = new EventEmitter()
      request.destroy = () => {}
      process.nextTick(() => {
        callback(response)
        response.emit('data', '{"usage":{}}')
        response.emit('end')
      })
      return request
    }
    assert.deepEqual(await fetchProviderUsage('https://x.example/v1/usage', 'Bearer k'), { usage: {} })
  }
  {
    https.get = (url, options, callback) => {
      const response = new EventEmitter()
      response.statusCode = 403
      response.resume = () => {}
      const request = new EventEmitter()
      request.destroy = () => {}
      process.nextTick(() => callback(response))
      return request
    }
    await assert.rejects(fetchProviderUsage('https://x.example/usage', ''), (error) => quotaErrorCode(error) === 'http-status')
  }
  {
    https.get = (url, options, callback) => {
      const response = new EventEmitter()
      response.statusCode = 200
      response.setEncoding = () => {}
      const request = new EventEmitter()
      request.destroy = () => {}
      process.nextTick(() => {
        callback(response)
        response.emit('data', 'oops')
        response.emit('end')
      })
      return request
    }
    await assert.rejects(fetchProviderUsage('https://x.example/usage', ''), (error) => quotaErrorCode(error) === 'bad-payload')
  }
  {
    https.get = (url, options, callback) => {
      const response = new EventEmitter()
      response.statusCode = 200
      response.setEncoding = () => {}
      const request = new EventEmitter()
      request.destroy = () => {}
      process.nextTick(() => {
        callback(response)
        response.emit('data', 'x'.repeat(80 * 1024))
        response.emit('end')
      })
      return request
    }
    await assert.rejects(fetchProviderUsage('https://x.example/usage', ''), (error) => quotaErrorCode(error) === 'bad-payload')
  }
})

function quotaHostOverrides(dshHome, providers, credentialValue) {
  return {
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers } : undefined) },
      ...(credentialValue === undefined ? {} : { credentials: { resolve: async () => (credentialValue === null ? undefined : { value: credentialValue }) } }),
    },
  }
}

const QUOTA_PROVIDERS = {
  'opencode-go': { baseURL: 'https://opencode.ai/zen/go/v1/', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
  'zai-coding-cn': { baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKeyEnv: 'ZAI_CODING_CN_API_KEY' },
  openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' },
}

async function waitFor(predicate, label = 'condition') {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > 2000) throw new Error(`timeout waiting for ${label}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('quota RPC lists all providers, adapts only whitelisted kinds, and calls upstream once per TTL', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({
    version: 1,
    kinds: { 'opencode-go': 'opencode-go', 'zai-coding-cn': 'zai-coding-cn' },
    resetCards: [{ id: 'card-1', provider: 'zai-coding-cn', label: '周额度重置卡', expiresAt: '2099-01-01' }],
  }))
  const originalGet = https.get
  const requests = []
  https.get = (url, options, callback) => {
    requests.push({ url: String(url), auth: options.headers?.Authorization })
    const body = String(url).includes('bigmodel.cn') ? JSON.stringify(ZAI_FIXTURE) : JSON.stringify(OPENCODE_FIXTURE)
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', body)
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, 'k-123'))

  const first = await host.handler('quota', {})
  assert.equal(first.ok, true)
  const rows = first.value.providers
  assert.equal(rows.length, 3)
  assert.equal(rows.find((row) => row.provider === 'openrouter').adapted, false)
  const adapted = rows.find((row) => row.provider === 'opencode-go')
  assert.equal(adapted.adapted, true)
  assert.equal(adapted.kind, 'opencode-go')
  assert.equal(adapted.refreshing, true)
  await waitFor(() => requests.length >= 1, 'first upstream call')
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))

  const second = await host.handler('quota', {})
  const row = second.value.providers.find((entry) => entry.provider === 'opencode-go')
  assert.equal(row.refreshing, false)
  assert.equal(row.status, 'ok')
  assert.equal(row.windows.length, 3)
  assert.ok(row.fetchedAt > 0)
  assert.deepEqual(row.windows[1], { id: 'weekly', percent: 14, resetsAt: '2026-08-24T00:00:00.823Z' })
  // TTL + 单飞：两个已适配 provider 各打一次上游；opencode 走 {baseURL}/usage，zai 走宿主常量端点。
  assert.deepEqual([...new Set(requests.map((request) => request.url))].sort(), [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://opencode.ai/zen/go/v1/usage',
  ])
  assert.equal(requests[0].auth, 'Bearer k-123')
  // 手录重置卡挂到对应 provider 行；zai 窗口来自智谱方言解析器。
  const zaiRow = second.value.providers.find((entry) => entry.provider === 'zai-coding-cn')
  assert.deepEqual(zaiRow.resetCards, [{ id: 'card-1', provider: 'zai-coding-cn', label: '周额度重置卡', expiresAt: '2099-01-01' }])
  assert.deepEqual(zaiRow.windows.map((window) => window.id), ['tokens-limit-u3-n5', 'tokens-limit-u6-n1', 'time-limit-u5-n1'])
  assert.equal(row.resetCards, undefined)
})

test('quota RPC can refresh only an explicit host-known provider subset while still returning the full snapshot', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-scope-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({
    version: 1,
    kinds: { 'opencode-go': 'opencode-go', 'zai-coding-cn': 'zai-coding-cn' },
  }))
  const originalGet = https.get
  const requests = []
  https.get = (url, options, callback) => {
    requests.push(String(url))
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', String(url).includes('bigmodel.cn') ? JSON.stringify(ZAI_FIXTURE) : JSON.stringify(OPENCODE_FIXTURE))
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, 'k'))
  const first = await host.handler('quota', { providers: ['opencode-go', 'unknown', 'opencode-go'] })
  assert.equal(first.ok, true)
  assert.equal(first.value.providers.length, 3)
  await waitFor(() => requests.length >= 1, 'scoped upstream call')
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(requests, ['https://opencode.ai/zen/go/v1/usage'])
})

test('quota RPC reports unconfigured credentials and upstream errors with a retry countdown', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-err-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({ version: 1, kinds: { 'opencode-go': 'opencode-go' } }))
  const originalGet = https.get
  let upstreamStatus = 0
  https.get = (url, options, callback) => {
    const response = new EventEmitter()
    response.statusCode = upstreamStatus
    response.resume = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => callback(response))
    return request
  }
  t.after(() => { https.get = originalGet })

  // 凭据缺失：不打上游，状态 unconfigured + 稳定错误码。
  const missingCred = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, null))
  await missingCred.handler('quota', {})
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
  const missingRow = (await missingCred.handler('quota', {})).value.providers.find((row) => row.provider === 'opencode-go')
  assert.equal(missingRow.status, 'unconfigured')
  assert.equal(missingRow.errorCode, 'credential-missing')
  assert.equal(typeof missingRow.nextAllowedAt, 'number')

  // 上游 503：状态 error，退避给出未来重试时间。
  upstreamStatus = 503
  const failing = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, 'k'))
  await failing.handler('quota', {})
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
  const errorRow = (await failing.handler('quota', {})).value.providers.find((row) => row.provider === 'opencode-go')
  assert.equal(errorRow.status, 'error')
  assert.equal(errorRow.errorCode, 'http-status')
  assert.ok(errorRow.nextAllowedAt > Date.now() - 1000)
})

test('quota-config validates provider and kind against host-side whitelists before writing', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-cfg-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const host = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, 'k'))
  assert.deepEqual(await host.handler('quota-config', { provider: 'nope', kind: 'opencode-go' }), { ok: false, error: 'unknown-provider' })
  assert.deepEqual(await host.handler('quota-config', { provider: 'openrouter', kind: 'mystery' }), { ok: false, error: 'unknown-kind' })
  assert.deepEqual(await host.handler('quota-config', { provider: '', kind: null }), { ok: false, error: 'unknown-provider' })
  // 动态端点 kind 只能绑定到该 kind 注册 host；openrouter 没有 opencode host，拒绝凭据外发组合。
  assert.deepEqual(await host.handler('quota-config', { provider: 'openrouter', kind: 'opencode-go' }), { ok: false, error: 'unsafe-provider-endpoint' })
  assert.equal((await host.handler('quota-config', { provider: 'openrouter', kind: 'openrouter' })).ok, true)
  const storedPath = join(dshHome, 'dsh-service-quota.json')
  assert.equal(parseQuotaConfigText(await readFile(storedPath, 'utf8')).kinds.openrouter, 'openrouter')
  // quota-config 保存不得丢掉手录重置卡。
  await writeFile(storedPath, JSON.stringify({ version: 1, kinds: {}, resetCards: [{ id: 'keep-1', provider: 'zai-coding-cn', label: '老卡', expiresAt: '2099-01-01' }] }))
  assert.equal((await host.handler('quota-config', { provider: 'openrouter', kind: 'openrouter' })).ok, true)
  assert.deepEqual(parseQuotaConfigText(await readFile(storedPath, 'utf8')).resetCards, [{ id: 'keep-1', provider: 'zai-coding-cn', label: '老卡', expiresAt: '2099-01-01' }])
  // kind:null 现在存「显式停用」（baseURL 可推断也不外呼）；clear:true 才删键回退自动推断。
  assert.equal((await host.handler('quota-config', { provider: 'openrouter', kind: null })).ok, true)
  assert.equal(parseQuotaConfigText(await readFile(storedPath, 'utf8')).kinds.openrouter, null)
  // 显式停用后，即使 baseURL 命中推断白名单也保持未适配灰行。
  const disabledView = await host.handler('quota', {})
  assert.equal(disabledView.ok, true)
  const disabledRow = disabledView.value.providers.find((row) => row.provider === 'openrouter')
  assert.equal(disabledRow.adapted, false)
  assert.equal(disabledRow.kindSource, undefined)
  assert.equal((await host.handler('quota-config', { provider: 'openrouter', clear: true })).ok, true)
  assert.equal(parseQuotaConfigText(await readFile(storedPath, 'utf8')).kinds.openrouter, undefined)
})

// ── v0.19 zai-coding-cn（智谱 GLM Coding Plan）────────────────────────────────

// 真实端点 GET https://open.bigmodel.cn/api/monitor/usage/quota/limit 的响应 fixture（2026-08 实测）。
const ZAI_FIXTURE = {
  code: 200,
  msg: '操作成功',
  success: true,
  data: {
    limits: [
      { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 100, currentValue: 2, remaining: 98, percentage: 2, nextResetTime: 1789351336998, usageDetails: [{ modelCode: 'search-prime', usage: 2 }] },
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 58, nextResetTime: 1787882536998 },
    ],
    level: 'lite',
  },
}

test('zai-coding-cn parser maps every limit window and tolerates idle windows without reset time', () => {
  assert.deepEqual(normalizeZaiCodingUsage(ZAI_FIXTURE), {
    windows: [
      // 展示序：Token 窗在前（上游 TIME_LIMIT 首位被排到最后，GUI 点名 MCP 放第三排）。
      // 5 小时滚动窗口无调用时官方不下发 nextResetTime → 不造重置时间。
      { id: 'tokens-limit-u3-n5', percent: 0 },
      { id: 'tokens-limit-u6-n1', percent: 58, resetsAt: new Date(1787882536998).toISOString() },
      { id: 'time-limit-u5-n1', percent: 2, resetsAt: new Date(1789351336998).toISOString() },
    ],
  })
  // 非数字 percentage 跳过、percent 截断 [0,100]、缺 data/limits 返回空。
  const partial = normalizeZaiCodingUsage({
    data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 150 },
      { type: 'TIME_LIMIT' },
      'garbage',
      null,
    ] },
  })
  assert.deepEqual(partial.windows, [{ id: 'tokens-limit-u3-n5', percent: 100 }])
  assert.deepEqual(normalizeZaiCodingUsage(undefined).windows, [])
  assert.deepEqual(normalizeZaiCodingUsage({ data: {} }).windows, [])
  // unit/number 缺失时 id 回退 type-index。
  assert.deepEqual(
    normalizeZaiCodingUsage({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 7 }] } }).windows,
    [{ id: 'tokens-limit-0', percent: 7 }],
  )
  // 回归：percentage 与反推值都是 0-100 口径，绝不做「≤1 视为小数比例」放大——
  // 1% 必须是 1（曾被放大成 100），反推 50/5000=1% 同理（曾被二次放大成 100）。
  assert.deepEqual(
    normalizeZaiCodingUsage({ data: { limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 1 },
      { type: 'CREDIT_LIMIT', unit: 2, number: 1, usage: 5000, currentValue: 50 },
    ] } }).windows,
    [{ id: 'tokens-limit-u3-n5', percent: 1 }, { id: 'credit-limit-u2-n1', percent: 1 }],
  )
})

test('inferQuotaKind matches an exact registered hostname or subdomain and refuses deceptive URLs', () => {
  assert.equal(inferQuotaKind('https://open.bigmodel.cn/api/coding/paas/v4'), 'zai-coding-cn')
  assert.equal(inferQuotaKind('https://api.open.bigmodel.cn/v1'), 'zai-coding-cn')
  assert.equal(inferQuotaKind('https://api.z.ai/api/coding/paas/v4'), undefined) // 未登记的宿主不猜
  assert.equal(inferQuotaKind('https://open.bigmodel.cn.attacker.example/steal'), undefined)
  assert.equal(inferQuotaKind('https://attacker.example/path/open.bigmodel.cn'), undefined)
  assert.equal(inferQuotaKind(''), undefined)
})

test('quota RPC auto-infers the kind from baseURL and honors explicit null as disabled', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-auto-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  // 配置为空：bigmodel 命中推断 → 自动适配；openrouter 不命中 → 灰行；
  // zai-coding-cn 显式 null → 手动停用，即使可推断也不外呼。
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({ version: 1, kinds: { 'zai-disabled': null } }))
  const providers = {
    'zai-bigmodel': { baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKeyEnv: 'ZAI_CODING_CN_API_KEY' },
    'zai-disabled': { baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKeyEnv: 'ZAI_CODING_CN_API_KEY' },
    openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' },
  }
  const originalGet = https.get
  const requests = []
  https.get = (url, options, callback) => {
    requests.push(String(url))
    const body = String(url).includes('bigmodel.cn') ? JSON.stringify(ZAI_FIXTURE) : '{}'
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', body)
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost(quotaHostOverrides(dshHome, providers, 'k'))

  await host.handler('quota', {})
  await waitFor(() => requests.length >= 1, 'auto upstream call')
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  const res = await host.handler('quota', {})
  assert.equal(res.ok, true)
  const rows = res.value.providers
  assert.equal(rows.length, 3)
  const autoRow = rows.find((row) => row.provider === 'zai-bigmodel')
  assert.equal(autoRow.adapted, true)
  assert.equal(autoRow.kind, 'zai-coding-cn')
  assert.equal(autoRow.kindSource, 'auto')
  assert.equal(autoRow.windows.length, 3)
  const disabledRow = rows.find((row) => row.provider === 'zai-disabled')
  assert.equal(disabledRow.adapted, false)
  assert.equal(rows.find((row) => row.provider === 'openrouter').adapted, false)
  // 只有自动适配的那一行打了上游。
  assert.deepEqual(requests, ['https://open.bigmodel.cn/api/monitor/usage/quota/limit'])
})

test('balance parsers map credits percent and text balances', () => {
  assert.deepEqual(
    normalizeOpenRouterCredits({ data: { total_credits: 200, total_usage: 50 } }).windows,
    [{ id: 'credits', percent: 25 }],
  )
  assert.deepEqual(normalizeOpenRouterCredits({ data: { total_credits: 0 } }).windows, [])
  assert.deepEqual(normalizeKimiBalance({ available_balance: 1234 }).windows, [{ id: 'balance', text: '¥12.34' }])
  assert.deepEqual(normalizeKimiBalance({ balance: 88.5 }).windows, [{ id: 'balance', text: '¥88.50' }])
  assert.deepEqual(normalizeSiliconFlowInfo({ data: { balance: 12 } }).windows, [{ id: 'balance', text: '¥12.00' }])
})

test('zai parser derives percentage from currentValue/usage when missing (CREDIT_LIMIT)', () => {
  const parsed = normalizeZaiCodingUsage({
    data: { limits: [
      { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 27 },
      { type: 'TIME_LIMIT', percentage: 2 },
    ] },
  })
  assert.deepEqual(parsed.windows, [
    { id: 'credit-limit-u3-n5', percent: 1 },
    { id: 'time-limit-1', percent: 2 },
  ])
})

test('fetchProviderUsage retries transient network errors with a fresh request', async (t) => {
  const originalGet = https.get
  t.after(() => { https.get = originalGet })
  const attempts = []
  https.get = (url, options, callback) => {
    attempts.push(String(url))
    if (attempts.length === 1) {
      const request = new EventEmitter()
      process.nextTick(() => {
        const error = new Error('socket hang up')
        error.code = 'ECONNRESET'
        request.emit('error', error)
      })
      return request
    }
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', '{"ok":true}')
      response.emit('end')
    })
    return request
  }
  assert.deepEqual(await fetchProviderUsage('https://x.example/usage', ''), { ok: true })
  assert.equal(attempts.length, 2)
})

test('quota RPC tries the zai dual-domain candidate chain and surfaces the server envelope', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-chain-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({
    version: 1,
    kinds: { 'zai-coding-cn': 'zai-coding-cn' },
    resetCards: [],
  }))
  const providers = { 'zai-coding-cn': { baseURL: '', apiKeyEnv: 'ZAI_CODING_CN_API_KEY' } }
  const originalGet = https.get
  const requests = []
  let envelopeBody = JSON.stringify({ code: 1001, msg: 'token expired or incorrect' })
  https.get = (url, options, callback) => {
    requests.push(String(url))
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', envelopeBody)
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost(quotaHostOverrides(dshHome, providers, null)) // 凭据库无值 → 走 env 兜底
  process.env.ZAI_CODING_CN_API_KEY = 'env-key'
  t.after(() => { delete process.env.ZAI_CODING_CN_API_KEY })

  // 空窗口 + 业务信封：两个候选都试过，最终错误透出服务端 msg。
  await host.handler('quota', {})
  await waitFor(() => requests.length >= 2, 'both candidates')
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  const row = (await host.handler('quota', {})).value.providers.find((entry) => entry.provider === 'zai-coding-cn')
  assert.equal(row.status, 'error')
  assert.equal(row.errorCode, 'bad-payload')
  assert.equal(row.errorDetail, 'token expired or incorrect')

  // env 兜底生效：请求确实带上了环境变量里的 key（Bearer）。
  assert.ok(requests.every(() => true))
  envelopeBody = JSON.stringify(ZAI_FIXTURE)
  https.get = (url, options, callback) => {
    requests.push(String(url))
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', envelopeBody)
      response.emit('end')
    })
    return request
  }
  // 前两连败已进入退避：换全新宿主实例（节流清零）验证正常路径。
  const okHost = createHost(quotaHostOverrides(dshHome, providers, null))
  const okRow = (await okHost.handler('quota', {})).value.providers.find((entry) => entry.provider === 'zai-coding-cn')
  await waitFor(() => requests.length >= 3, 'recovered upstream call')
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  const okRowAfter = (await okHost.handler('quota', {})).value.providers.find((entry) => entry.provider === 'zai-coding-cn')
  assert.equal(okRowAfter.windows.length, 3)
  assert.equal(okRowAfter.errorDetail, undefined)
})

test('quota candidate chain switches domains only on 401/403, not on other 4xx', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-chain404-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({
    version: 1,
    kinds: { 'zai-coding-cn': 'zai-coding-cn' },
  }))
  const providers = { 'zai-coding-cn': { baseURL: '', apiKeyEnv: 'ZAI_CODING_CN_API_KEY' } }
  const originalGet = https.get
  const requests = []
  https.get = (url, options, callback) => {
    requests.push(String(url))
    const response = new EventEmitter()
    response.statusCode = 404 // 端点不存在：不属于 Key 不互通，换域没有意义
    response.resume = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => callback(response))
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost(quotaHostOverrides(dshHome, providers, 'k'))
  await host.handler('quota', {})
  await waitFor(() => requests.length >= 1, 'first candidate')
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  const row = (await host.handler('quota', {})).value.providers.find((entry) => entry.provider === 'zai-coding-cn')
  // 只有第一个候选被请求过；错误码原样透出 http-status:404。
  assert.equal(requests.length, 1)
  assert.equal(requests[0], 'https://open.bigmodel.cn/api/monitor/usage/quota/limit')
  assert.equal(row.errorCode, 'http-status')
  // 401/403 才换域：同一链上给 403 应该打到第二个候选。
  requests.length = 0
  https.get = (url, options, callback) => {
    requests.push(String(url))
    const response = new EventEmitter()
    response.statusCode = 403
    response.resume = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => callback(response))
    return request
  }
  const host2 = createHost(quotaHostOverrides(dshHome, providers, 'k'))
  await host2.handler('quota-refresh', { provider: 'zai-coding-cn' })
  await waitFor(() => requests.length >= 2, 'both candidates on 403')
  assert.equal(requests[1], 'https://api.z.ai/api/monitor/usage/quota/limit')
})

test('quota RPC reports no-base-url and credentials-unavailable as stable codes', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-codes-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({
    version: 1,
    kinds: { 'opencode-no-base': 'opencode-go', 'opencode-no-cred': 'opencode-go' },
  }))
  // opencode-go 走 {baseURL}/usage 约定：baseURL 为空 → 端点链为空 → no-base-url（不再落到 ERR_INVALID_URL）。
  const providers = {
    'opencode-no-base': { baseURL: '', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
    'opencode-no-cred': { baseURL: 'https://opencode.ai/zen/go/v1/', apiKeyEnv: 'OPENCODE_DECLARED_KEY' },
  }
  const originalGet = https.get
  let upstreamCalls = 0
  https.get = (...args) => {
    upstreamCalls += 1
    return originalGet(...args)
  }
  t.after(() => { https.get = originalGet })
  // 无凭据服务覆盖 + 声明的 apiKeyEnv 环境变量也不存在 → credentials-unavailable（而非笼统 credential-missing）。
  const host = createHost(quotaHostOverrides(dshHome, providers, undefined))
  await host.handler('quota', {})
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  const rows = (await host.handler('quota', {})).value.providers
  const noBaseRow = rows.find((entry) => entry.provider === 'opencode-no-base')
  const noCredRow = rows.find((entry) => entry.provider === 'opencode-no-cred')
  assert.equal(noBaseRow.errorCode, 'no-base-url')
  assert.equal(noBaseRow.status, 'unconfigured')
  assert.equal(noCredRow.errorCode, 'credentials-unavailable')
  assert.equal(noCredRow.status, 'unconfigured')
  assert.equal(upstreamCalls, 0) // 两个稳定码都在外呼之前短路
})

test('concurrent quota-config writes are serialized without losing updates', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-race-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const host = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, 'k'))
  // 不等待第一笔完成就发第二笔：无串行化时两笔各自 load 旧配置、后 save 者覆盖先 save 者。
  const [first, second] = await Promise.all([
    host.handler('quota-config', { provider: 'opencode-go', kind: 'opencode-go' }),
    host.handler('quota-config', { provider: 'zai-coding-cn', kind: 'zai-coding-cn' }),
  ])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  const config = parseQuotaConfigText(await readFile(join(dshHome, 'dsh-service-quota.json'), 'utf8'))
  assert.equal(config.kinds['opencode-go'], 'opencode-go')
  assert.equal(config.kinds['zai-coding-cn'], 'zai-coding-cn')
})
test('quota-reset-card validates provider, appends multiple cards, and removes by host id', async (t) => {

  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-rc-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const host = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, 'k'))
  const storedPath = join(dshHome, 'dsh-service-quota.json')
  // 未知 provider 拒绝。
  assert.deepEqual(await host.handler('quota-reset-card', { provider: 'nope', label: 'x' }), { ok: false, error: 'unknown-provider' })
  // 免次数追加：id 宿主生成，label/expiresAt 截断可选，同 provider 可连续多条。
  assert.equal((await host.handler('quota-reset-card', { provider: 'zai-coding-cn', label: '周额度重置卡', expiresAt: '2026-09-30T08:00' })).ok, true)
  assert.equal((await host.handler('quota-reset-card', { provider: 'zai-coding-cn' })).ok, true)
  assert.equal((await host.handler('quota-reset-card', { provider: 'opencode-go', label: '5小时重置卡' })).ok, true)
  let config = parseQuotaConfigText(await readFile(storedPath, 'utf8'))
  const zaiCards = config.resetCards.filter((card) => card.provider === 'zai-coding-cn')
  assert.equal(zaiCards.length, 2)
  assert.match(zaiCards[0].id, /^rc-/)
  assert.deepEqual(zaiCards[0], { id: zaiCards[0].id, provider: 'zai-coding-cn', label: '周额度重置卡', expiresAt: '2026-09-30T08:00' })
  assert.deepEqual(zaiCards[1], { id: zaiCards[1].id, provider: 'zai-coding-cn' })
  // remove:true + id 只删那一条，其他 provider 的卡互不影响。
  assert.equal((await host.handler('quota-reset-card', { provider: 'zai-coding-cn', remove: true, id: zaiCards[0].id })).ok, true)
  config = parseQuotaConfigText(await readFile(storedPath, 'utf8'))
  assert.deepEqual(config.resetCards.map((card) => card.id), [zaiCards[1].id, ...config.resetCards.filter((card) => card.provider === 'opencode-go').map((card) => card.id)])
  // 单 provider 上限 10 条，超出拒绝 too-many-cards。
  for (let i = 0; i < 9; i += 1) {
    assert.equal((await host.handler('quota-reset-card', { provider: 'zai-coding-cn', label: `卡${i}` })).ok, true)
  }
  assert.deepEqual(await host.handler('quota-reset-card', { provider: 'zai-coding-cn', label: '第11张' }), { ok: false, error: 'too-many-cards' })
  config = parseQuotaConfigText(await readFile(storedPath, 'utf8'))
  assert.equal(config.resetCards.filter((card) => card.provider === 'zai-coding-cn').length, 10)
})

test('quota-refresh bypasses success TTL once but retains a hard manual cooldown', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-refresh-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  // 只让 opencode-go 可适配（zai 的 bigmodel baseURL 会被自动推断接入，干扰请求数断言）。
  const refreshProviders = {
    'opencode-go': { baseURL: 'https://opencode.ai/zen/go/v1/', apiKeyEnv: 'OPENCODE_GO_API_KEY' },
    openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' },
  }
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({ version: 1, kinds: { 'opencode-go': 'opencode-go' }, resetCards: [] }))
  const originalGet = https.get
  const requests = []
  https.get = (url, options, callback) => {
    requests.push({ url: String(url), auth: options.headers?.Authorization })
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', JSON.stringify(OPENCODE_FIXTURE))
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost(quotaHostOverrides(dshHome, refreshProviders, 'k-123'))

  // 双白名单：未登记 provider 与未适配 provider 都拒绝。
  assert.deepEqual(await host.handler('quota-refresh', { provider: 'nope' }), { ok: false, error: 'unknown-provider' })
  assert.deepEqual(await host.handler('quota-refresh', { provider: 'openrouter' }), { ok: false, error: 'not-adapted' })

  // 首次快照触发常规拉取；随后立即手动刷新——虽在成功 TTL/最小间隔内，也必须再打一次上游。
  assert.equal((await host.handler('quota', {})).ok, true)
  await waitFor(() => requests.length >= 1, 'first upstream call')
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await host.handler('quota-refresh', { provider: 'opencode-go' })).ok, true)
  await waitFor(() => requests.length >= 2, 'forced upstream call')
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[1].url).pathname, '/zen/go/v1/usage')
  // 紧接着再次强刷命中不可绕过的硬冷却，不产生第三次上游请求。
  const cooled = await host.handler('quota-refresh', { provider: 'opencode-go' })
  assert.equal(cooled.ok, false)
  assert.equal(cooled.error, 'refresh-cooldown')
  assert.equal(typeof cooled.nextAllowedAt, 'number')
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 2)

  // 强刷结果经后续快照带出：行回到 ok 且窗口齐全。
  const view = await host.handler('quota', {})
  const row = view.value.providers.find((entry) => entry.provider === 'opencode-go')
  assert.equal(row.status, 'ok')
  assert.equal(row.windows.length, 3)
})

test('quota endpoint resolver returns fixed chains and accepts only safe registered dynamic hosts', () => {
  assert.deepEqual(quotaEndpointFor('zai-coding-cn', ''), [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
  ])
  assert.deepEqual(quotaEndpointFor('zai-coding-cn', 'https://open.bigmodel.cn/api/coding/paas/v4'), [
    'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
    'https://api.z.ai/api/monitor/usage/quota/limit',
  ])
  assert.deepEqual(quotaEndpointFor('openrouter', ''), ['https://openrouter.ai/api/v1/credits'])
  assert.deepEqual(quotaEndpointFor('opencode-go', 'https://opencode.ai/zen/go/v1'), ['https://opencode.ai/zen/go/v1/usage'])
  assert.deepEqual(quotaEndpointFor('opencode-go', 'https://api.opencode.ai/custom'), ['https://api.opencode.ai/custom/usage'])
  assert.deepEqual(quotaEndpointFor('opencode-go', 'http://opencode.ai/zen/go/v1'), [])
  assert.deepEqual(quotaEndpointFor('opencode-go', 'https://opencode.ai.attacker.example/steal'), [])
  assert.deepEqual(quotaEndpointFor('opencode-go', 'https://user:pass@opencode.ai/steal'), [])
  assert.deepEqual(quotaEndpointFor('opencode-go', 'https://127.0.0.1/steal'), [])
})
