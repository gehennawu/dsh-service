import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import test from 'node:test'
import { createRequire } from 'node:module'

import { apply, name } from '../index.js'

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
  for (const [key, value] of Object.entries(overrides.env || {})) {
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
    missingUsage: 0,
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

test('usage index skips inherited fork events and removes deleted sessions', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-usage-fork-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const time = new Date(2026, 7, 19, 8).getTime()
  let snapshots = [{ header: { id: 'fork', version: 0, createdAt: time, cwd: '/workspace', seedLength: 2 }, revision: 'a' }]
  const persistence = {
    listSnapshots: async () => snapshots,
    readFrom: async () => ({ meta: snapshots[0].header, events: [
      { type: 'request/header', seq: 2, time, data: { header: { config: { provider: 'anthropic', model: 'claude' } }, reason: 'resume' } },
      { type: 'assistant/message', seq: 3, time, data: { turn: 1, step: 0, message: { role: 'assistant', content: [] } } },
    ] }),
  }
  const { handler } = createHost({ services: { sessionPersistence: persistence }, env: { DSH_HOME: dshHome } })
  const built = await handler('usage-refresh', {})
  assert.equal(built.value.totals.steps, 1)
  assert.equal(built.value.totals.missingUsage, 1)
  snapshots = []
  const deleted = await handler('usage-refresh', {})
  assert.equal(deleted.value.totals.steps, 0)
  assert.equal(deleted.value.indexedSessions, 0)
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

function recordingSubprocess(executables) {
  const spawned = []
  const resolved = []
  return {
    spawned,
    resolved,
    service: {
      resolveExecutable: async (command) => {
        resolved.push(command)
        const found = executables[command]
        if (found === undefined) throw new Error(`not found: ${command}`)
        return found
      },
      spawn(spec) {
        spawned.push(spec)
        return {
          collected: {
            stdout: { readFrom: () => ({ text: '' }) },
            stderr: { readFrom: () => ({ text: '' }) },
          },
          done: Promise.resolve({ exitCode: 0, signal: null }),
        }
      },
    },
  }
}

test('upgrade RPC wraps a resolved .cmd through cmd.exe on Windows and uses a valid cwd', async (t) => {
  const originalPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  t.after(() => Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true }))
  const originalSystemRoot = process.env.SystemRoot
  process.env.SystemRoot = 'C:\\FakeWindows'
  t.after(() => {
    if (originalSystemRoot === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = originalSystemRoot
  })

  const recorder = recordingSubprocess({
    npm: 'C:\\Program Files\\nodejs\\npm.CMD',
    'cmd.exe': 'C:\\Windows\\System32\\cmd.exe',
  })
  const { handler, scheduled } = createHost({ services: { subprocess: recorder.service } })

  const result = await handler('upgrade', {})

  assert.equal(result.ok, true)
  assert.deepEqual(recorder.resolved, ['npm', 'cmd.exe'])
  assert.equal(recorder.spawned.length, 1)
  assert.deepEqual(recorder.spawned[0].argv, ['C:\\Windows\\System32\\cmd.exe', '/d', '/s', '/c', 'C:\\Program Files\\nodejs\\npm.CMD', 'install', '-g', '@gehennawu/dsh-service@latest'])
  assert.equal(recorder.spawned[0].cwd, 'C:\\FakeWindows')
  assert.ok(scheduled.length >= 1, 'restart is scheduled after a successful upgrade')
})

test('upgrade RPC spawns the resolved executable directly on POSIX with root cwd', async () => {
  const recorder = recordingSubprocess({ npm: '/usr/bin/npm' })
  const { handler, scheduled } = createHost({ services: { subprocess: recorder.service } })

  const result = await handler('upgrade', {})

  assert.equal(result.ok, true)
  assert.deepEqual(recorder.resolved, ['npm'])
  assert.equal(recorder.spawned.length, 1)
  assert.deepEqual(recorder.spawned[0].argv, ['/usr/bin/npm', 'install', '-g', '@gehennawu/dsh-service@latest'])
  assert.equal(recorder.spawned[0].cwd, '/')
  assert.ok(scheduled.length >= 1, 'restart is scheduled after a successful upgrade')
})
