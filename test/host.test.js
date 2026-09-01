import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import https from 'node:https'
import { gzipSync, zstdCompress, zstdDecompressSync, constants as zlibConstants } from 'node:zlib'
import { promisify } from 'node:util'
import test from 'node:test'
import { createRequire } from 'node:module'

import { apply, appendVaryToken, buildCliproxyAccountPlan, buildSubagentDispatchRecord, cliproxyFetchGuard, cliproxyPinHostFromBaseURL, cliproxyProjectFor, createQuotaThrottle, detectRuntimeEnv, ensureMobileResponseCompression, evaluateSkillFile, extractSkillDraftJson, fetchCliproxyUsage, fetchProviderUsage, fetchStepFunStepPlanUsage, fetchXiaomiTokenPlanUsage, inferQuotaKind, installMobileResponseCompression, isCompressibleJsonType, lastSubagentTurn, listSubagentDispatches, listSubagentModels, name, normalizeAntigravityModels, normalizeCodexRateLimit, normalizeDeepseekBalance, normalizeGeminiBuckets, normalizeKimiBalance, normalizeOpenRouterCredits, normalizeOpencodeUsage, normalizeSiliconFlowInfo, normalizeStepfunBalance, normalizeStepFunStepPlanUsage, normalizeXiaomiTokenPlanUsage, normalizeZaiCodingUsage, parseQuotaConfigText, parseSubagentRouteText, pickCompressionEncoding, publicSubagentReasoning, pushSubagentDispatchRecord, quotaCredentialConfigured, quotaCredentialHintNames, quotaEndpointFor, quotaErrorCode, quotaProviderUnusable, readLlmProviders, resolveSubagentInjection, runtimeEnvCheck, safeCliproxyOrigin, sessionEventText, stepfunWebIdFromToken, unwrapCliproxyApiCallEnvelope, unwrapXiaomiConsoleEnvelope } from '../index.js'

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

function tarOctal(value, length) {
  const digits = Math.max(1, length - 1)
  return value.toString(8).padStart(digits - 1, '0') + '\0'
}

function tarString(value, length) {
  const bytes = Buffer.alloc(length)
  Buffer.from(value).copy(bytes, 0, 0, length)
  return bytes
}

function tarArchive(entries) {
  const blocks = []
  for (const entry of entries) {
    const type = entry.type ?? '0'
    const data = type === '0' || type === '\0' ? Buffer.from(entry.data ?? '') : Buffer.alloc(0)
    const header = Buffer.alloc(512)
    tarString(entry.name, 100).copy(header, 0)
    tarString(tarOctal(type === '5' ? 0o755 : 0o644, 8), 8).copy(header, 100)
    tarString(tarOctal(0, 8), 8).copy(header, 108)
    tarString(tarOctal(0, 8), 8).copy(header, 116)
    tarString(tarOctal(data.length, 12), 12).copy(header, 124)
    tarString(tarOctal(0, 12), 12).copy(header, 136)
    Buffer.from('        ').copy(header, 148)
    header[156] = type.charCodeAt(0)
    tarString(entry.linkname ?? '', 100).copy(header, 157)
    tarString('ustar\0', 6).copy(header, 257)
    tarString('00', 2).copy(header, 263)
    let checksum = 0
    for (const byte of header) checksum += byte
    tarString(checksum.toString(8).padStart(6, '0') + '\0 ', 8).copy(header, 148)
    blocks.push(header)
    if (data.length > 0) {
      blocks.push(data)
      const padding = (512 - (data.length % 512)) % 512
      if (padding > 0) blocks.push(Buffer.alloc(padding))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function validBackupArchive(overrides = {}) {
  const entries = [
    { name: 'sessions/', type: '5' },
    { name: 'sessions/workspace/', type: '5' },
    { name: 'sessions/workspace/session-1.jsonl', data: '{"type":"restored"}\n' },
    { name: 'config/', type: '5' },
    { name: 'config/settings.yaml', data: 'theme: restored\n' },
    { name: 'profiles/', type: '5' },
    { name: 'profiles/web/', type: '5' },
    { name: 'profiles/web/package.json', data: '{"name":"web-profile","restored":true}\n' },
  ]
  return tarArchive(overrides.entries ?? entries)
}

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
  const registeredSettings = []
  const eventHandlers = new Map()
  const logs = { info: [], warn: [], error: [] }
  let updateFeatureSettings = async () => {}
  const services = new Map(Object.entries(overrides.services || {}))
  const injectors = []
  let settingsService
  if (overrides.featureSettings !== undefined) {
    let current = {
      healthDiagnostics: true,
      modelUsage: true,
      quotaLookup: true,
      backupMaintenance: true,
      taskNotifications: true,
      healthz: true,
      skillManager: true,
      subagentRoute: true,
      ...overrides.featureSettings,
    }
    settingsService = {
      register(namespace, schema, options) {
        registeredSettings.push({ namespace, schema, options })
        const watchers = new Set()
        updateFeatureSettings = async (patch) => {
          const previous = current
          current = { ...current, ...patch }
          for (const watcher of watchers) await watcher(current, previous)
        }
        return {
          get: () => current,
          watch(callback) { watchers.add(callback); return () => watchers.delete(callback) },
          update: updateFeatureSettings,
          replace: async (section) => { current = { ...section } },
        }
      },
      get(namespace) {
        return namespace === 'dsh-service' ? current : undefined
      },
      describe() {
        return registeredSettings.map(({ namespace, schema }) => ({ ns: namespace, schema: schema.toJSON(), value: current, revision: 0 }))
      },
    }
    if (overrides.settingsInitiallyAvailable !== false) services.set('settings', settingsService)
  }
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

  const logger = overrides.logger ?? {
    info(message) { logs.info.push(String(message)) },
    warn(message) { logs.warn.push(String(message)) },
    error(message) { logs.error.push(String(message)) },
  }
  const ctx = {
    logger,
    get settings() {
      return services.get('settings')
    },
    get subagents() {
      return services.get('subagents')
    },
    connection: {
      rpc: { handle(channel, handler, options) {
          handlers.push({ channel, handler, options })
          return () => {}
        },
      },
    },
    get(service) {
      return services.get(service)
    },
    inject(required, callback) {
      const names = Array.isArray(required) ? required : [required]
      const run = () => {
        if (!names.every((service) => services.has(service))) return false
        callback(ctx)
        return true
      }
      if (!run()) injectors.push({ names, callback })
      return () => {}
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return typeof dispose === 'function' ? dispose : () => {}
    },
    on(event, handler) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, [])
      eventHandlers.get(event).push(handler)
      return () => {
        const list = eventHandlers.get(event)
        if (list === undefined) return
        const index = list.indexOf(handler)
        if (index >= 0) list.splice(index, 1)
      }
    },
  }

  apply(ctx)
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  assert.equal(handlers.length, 1)
  const provideSettings = () => {
    if (settingsService === undefined) throw new Error('featureSettings fixture is required')
    services.set('settings', settingsService)
    for (let index = injectors.length - 1; index >= 0; index -= 1) {
      const injector = injectors[index]
      if (!injector.names.every((service) => services.has(service))) continue
      injectors.splice(index, 1)
      injector.callback(ctx)
    }
  }
  // 事件派发替身：emit 事件逐个调用监听器；waterfall 事件提供 next 链（最外层 listener 先执行）。
  const fire = async (event, payload, baseNext) => {
    const listeners = eventHandlers.get(event) || []
    if (baseNext === undefined) {
      for (const listener of [...listeners]) await listener(payload)
      return undefined
    }
    let next = baseNext
    for (let index = listeners.length - 1; index >= 0; index -= 1) {
      const listener = listeners[index]
      const preceding = next
      next = () => listener(payload, preceding)
    }
    return next()
  }
  const publicHandler = async (...args) => {
    const result = await handlers[0].handler(...args)
    if (result?.ok === false && typeof result.error === 'object') {
      const detail = typeof result.error.details?.detail === 'string' ? result.error.details.detail : result.detail
      return { ...result, error: result.error.message, ...(detail !== undefined ? { detail } : {}) }
    }
    return result
  }
  return { handler: publicHandler, rawHandler: handlers[0].handler, rpcRegistration: handlers[0], logs, scheduled, registeredCommands, registeredSettings, updateFeatureSettings: (...args) => updateFeatureSettings(...args), provideSettings, fire, dispose: () => disposers.splice(0).reverse().forEach((fn) => fn()) }
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
    readFrom: async () => ({ meta: { ...snapshots[0].header, seedLength: 2 }, events: [
      { type: 'request/header', seq: 0, time, data: { header: { config: { provider: 'inherited', model: 'old' } }, reason: 'seed' } },
      { type: 'assistant/message', seq: 1, time, data: { turn: 0, step: 0, message: { role: 'assistant', content: [] }, usage: { inputTokens: 999, outputTokens: 999, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
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

test('usage index reads alpha.4 inheritedEventCount while retaining old header fallback', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-usage-alpha4-fork-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const time = new Date(2026, 7, 19, 8).getTime()
  const header = { id: 'alpha4-fork', version: 0, createdAt: time, cwd: '/workspace', isSeeded: true }
  let snapshots = [{ header, revision: 'a' }]
  let events = [
    { type: 'request/header', seq: 0, time, data: { header: { config: { provider: 'inherited', model: 'old' } }, reason: 'seed' } },
    { type: 'assistant/message', seq: 1, time, data: { turn: 0, step: 0, message: { role: 'assistant', content: [] }, usage: { inputTokens: 999, outputTokens: 999, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { type: 'request/header', seq: 2, time, data: { header: { config: { provider: 'anthropic', model: 'claude' } }, reason: 'resume' } },
    { type: 'assistant/message', seq: 3, time, data: { turn: 1, step: 0, message: { role: 'assistant', content: [] }, usage: { inputTokens: 60, outputTokens: 12, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ]
  const reads = []
  const persistence = {
    listSnapshots: async () => snapshots,
    readFrom: async (id, fromSeq) => {
      reads.push({ id, fromSeq })
      return { meta: header, inheritedEventCount: 2, fromSeq, events: events.filter((event) => event.seq >= fromSeq) }
    },
  }
  const { handler } = createHost({ services: { sessionPersistence: persistence }, env: { DSH_HOME: dshHome } })
  const built = await handler('usage-refresh', {})
  assert.equal(built.value.totals.steps, 1)
  assert.equal(built.value.totals.inputTokens, 60)
  assert.deepEqual(reads, [{ id: 'alpha4-fork', fromSeq: 0 }])

  snapshots = [{ header, revision: 'b' }]
  events = events.concat([
    { type: 'request/header', seq: 4, time, data: { header: { config: { provider: 'openai', model: 'gpt-5' } }, reason: 'next' } },
    { type: 'assistant/message', seq: 5, time, data: { turn: 2, step: 0, message: { role: 'assistant', content: [] }, usage: { inputTokens: 40, outputTokens: 8, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ])
  const resumed = await handler('usage-refresh', {})
  assert.equal(resumed.value.totals.steps, 2)
  assert.equal(resumed.value.totals.inputTokens, 100)
  assert.deepEqual(reads, [{ id: 'alpha4-fork', fromSeq: 0 }, { id: 'alpha4-fork', fromSeq: 4 }])
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

test('backup creation retries a transient tar file-change failure from a fresh staging tree', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-retry-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'sessions', 'workspace'), { recursive: true })
  await writeFile(join(dshHome, 'sessions', 'workspace', 'session.jsonl'), '{"type":"session"}\n')

  const realSubprocess = localSubprocess()
  let tarCalls = 0
  const subprocess = {
    resolveExecutable: realSubprocess.resolveExecutable,
    spawn(spec) {
      tarCalls += 1
      if (tarCalls === 1) {
        return {
          collected: { stderr: { readFrom: () => ({ text: 'sessions/workspace/session.jsonl: file changed as we read it' }) } },
          done: Promise.resolve({ exitCode: 1, signal: null }),
        }
      }
      return realSubprocess.spawn(spec)
    },
  }
  const { handler, rawHandler } = createHost({ services: { subprocess }, env: { DSH_HOME: dshHome } })

  const result = await handler('backup-create', {})
  assert.equal(result.ok, true, JSON.stringify(result))
  const rawFailure = await rawHandler('backup-delete', { id: 'forged' })
  assert.equal(typeof rawFailure.error, 'object')
  assert.equal(rawFailure.error.code, 'internal')
  assert.equal(rawFailure.error.message, 'unknown-backup')
  assert.equal((await handler('backup-inspect', { id: result.value.item.id })).value.validForRestore, true)
  assert.equal(tarCalls, 2)
  assert.equal((await handler('backup-list', {})).value.items.length, 1)
  assert.deepEqual((await readdir(join(dshHome, 'backups'))).filter((name) => name.startsWith('.staging-')), [])
})

test('backup progress RPC exposes phase snapshots during creation and goes idle afterwards', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-progress-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const sessionBytes = 4096
  await mkdir(join(dshHome, 'sessions', 'workspace'), { recursive: true })
  await writeFile(join(dshHome, 'sessions', 'workspace', 'session.jsonl'), 'x'.repeat(sessionBytes))

  const realSubprocess = localSubprocess()
  let releaseTar
  const tarGate = new Promise((resolve) => { releaseTar = resolve })
  let tarCalls = 0
  const subprocess = {
    resolveExecutable: realSubprocess.resolveExecutable,
    spawn(spec) {
      tarCalls += 1
      if (tarCalls === 1) {
        return {
          collected: { stderr: { readFrom: () => ({ text: '' }) } },
          done: tarGate.then(() => ({ exitCode: 0, signal: null })),
        }
      }
      return realSubprocess.spawn(spec)
    },
  }
  const { handler } = createHost({ services: { subprocess }, env: { DSH_HOME: dshHome } })

  assert.deepEqual(await handler('backup-progress', {}), { ok: true, value: { active: false } })

  const creating = handler('backup-create', {})
  let snapshot
  for (let index = 0; index < 200; index += 1) {
    snapshot = (await handler('backup-progress', {})).value
    if (snapshot.active === true && snapshot.phase === 'archive') break
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(snapshot.active, true, JSON.stringify(snapshot))
  assert.equal(snapshot.phase, 'archive')
  assert.equal(snapshot.totalBytes, sessionBytes)
  assert.equal(snapshot.copiedBytes, sessionBytes)
  assert.equal(snapshot.archiveBytes, 0)

  releaseTar()
  const created = await creating
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.deepEqual(await handler('backup-progress', {}), { ok: true, value: { active: false } })
  assert.equal((await handler('backup-inspect', { id: created.value.item.id })).value.validForRestore, true)
})

test('backup creation stages sessions through the persistence raw-artifact seam and encodes backend-compatible zstd frames', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-seam-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'settings.yaml'), 'theme: system\n')
  // 会话文件不存在也没关系：seam 只读承诺前缀文本，不读物理字节。
  const header = '{"type":"session/header","id":"s1","cwd":"/workspace"}\n'
  const events = '{"type":"user/message"}\n{"type":"assistant/message"}\n'
  const content = header + events
  const union = {
    supportsRawArtifacts: true,
    async listSnapshots() {
      return [{ header: { id: 's1', cwd: '/workspace' }, revision: 'r1' }]
    },
    async readRaw(id) {
      assert.equal(id, 's1')
      return { meta: { id: 's1' }, filename: 'session.jsonl', content }
    },
    locate(entry) {
      assert.equal(entry.id, 's1')
      return { kind: 'jsonl', path: join(dshHome, 'sessions', 'project-a', 'enc-id-1', 'session.jsonl.zstd') }
    },
  }
  const { handler } = createHost({
    services: { subprocess: localSubprocess(), sessionPersistence: union },
    env: { DSH_HOME: dshHome },
  })

  const created = await handler('backup-create', {})
  assert.equal(created.ok, true, JSON.stringify(created))

  const extractDir = join(dshHome, 'extracted')
  await mkdir(extractDir, { recursive: true })
  await new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xzf', join(dshHome, 'backups', created.value.item.name), '-C', extractDir])
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)))
  })
  const artifact = join(extractDir, 'sessions', 'project-a', 'enc-id-1', 'session.jsonl.zstd')
  const bytes = await readFile(artifact)
  // 首帧必须恰好是一行 header（后端 assertZstdHeaderFrame 约束）；多帧拼接解出首帧。
  assert.equal(zstdDecompressSync(bytes).toString('utf8'), header, 'first frame is exactly the header line')
  // 事件帧必须存在：文件大于仅 header 帧，且去掉首帧后的余量能解出事件原文。
  const compressAsync = promisify(zstdCompress)
  const headerAlone = await compressAsync(header, { params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 } })
  assert.ok(bytes.length > headerAlone.length + 8, 'event frame is attached')
  assert.equal((await handler('backup-inspect', { id: created.value.item.id })).value.validForRestore, true)
  assert.deepEqual((await readdir(join(dshHome, 'backups'))).filter((name) => name.startsWith('.staging-')), [])
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

  const importedArchive = validBackupArchive()
  const imported = await handler('backup-import', { name: 'dsh-backup-20250819-120000.tar.gz', data: importedArchive.toString('base64') })
  assert.equal(imported.ok, true)
  assert.equal(imported.value.items.length, 2)
  const duplicate = await handler('backup-import', { name: 'dsh-backup-20250819-120000.tar.gz', data: importedArchive.toString('base64') })
  assert.deepEqual(duplicate, { ok: false, error: 'invalid-backup' })
  const deleted = await handler('backup-delete', { id: listed.value.items[0].id })
  assert.equal(deleted.ok, true)
  assert.equal(deleted.value.items.length, 1)
  assert.equal(deleted.value.totalBytes, imported.value.items.find((item) => item.name === 'dsh-backup-20250819-120000.tar.gz').sizeBytes)
})

test('backup integrity preflight inspects, plans, restores once, and rejects replay', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-preflight-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'backups'), { recursive: true })
  await mkdir(join(dshHome, 'sessions', 'old'), { recursive: true })
  await mkdir(join(dshHome, 'profiles', 'web', 'node_modules', 'kept'), { recursive: true })
  await writeFile(join(dshHome, 'sessions', 'old', 'event.jsonl'), '{"type":"old"}\n')
  await writeFile(join(dshHome, 'settings.yaml'), 'theme: old\n')
  await writeFile(join(dshHome, 'AGENTS.md'), 'remove me\n')
  await writeFile(join(dshHome, 'profiles', 'web', 'package.json'), '{"name":"old-profile"}\n')
  await writeFile(join(dshHome, 'profiles', 'web', 'node_modules', 'kept', 'module.txt'), 'keep me')
  await writeFile(join(dshHome, '.credentials.yaml'), 'secret: keep\n')
  const name = 'dsh-backup-20250819-120000.tar.gz'
  await writeFile(join(dshHome, 'backups', name), validBackupArchive())

  const { handler, scheduled } = createHost({ env: { DSH_HOME: dshHome } })
  const listed = await handler('backup-list', {})
  const id = listed.value.items[0].id

  const inspected = await handler('backup-inspect', { id })
  assert.equal(inspected.ok, true)
  assert.equal(inspected.value.validForRestore, true)
  assert.equal(inspected.value.status, 'ok')
  assert.equal(inspected.value.source.name, name)
  assert.match(inspected.value.source.sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(inspected.value.sections.config.files.map((item) => item.name), ['settings.yaml'])
  assert.equal(inspected.value.sections.profiles.count, 1)
  assert.equal(inspected.value.sections.sessions.files, 1)

  const prepared = await handler('backup-restore-prepare', { id })
  assert.equal(prepared.ok, true)
  assert.equal(typeof prepared.value.planId, 'string')
  assert.equal(prepared.value.source.sha256, inspected.value.source.sha256)
  assert.equal(prepared.value.targets.sessions.action, 'replace')
  assert.deepEqual(prepared.value.targets.config.remove, ['AGENTS.md'])
  assert.deepEqual(prepared.value.targets.profiles.upsert, ['web'])

  const committed = await handler('backup-restore-commit', { planId: prepared.value.planId })
  assert.equal(committed.ok, true)
  assert.equal(committed.value.restoredFrom, name)
  assert.equal(committed.value.restart.scheduled, true)
  assert.equal(committed.value.restart.previousInstanceId, committed.value.previousInstanceId)
  assert.equal(scheduled.some((entry) => entry.delay === 500), true)
  assert.equal(await readFile(join(dshHome, 'sessions', 'workspace', 'session-1.jsonl'), 'utf8'), '{"type":"restored"}\n')
  await assert.rejects(readFile(join(dshHome, 'sessions', 'old', 'event.jsonl')), { code: 'ENOENT' })
  assert.equal(await readFile(join(dshHome, 'settings.yaml'), 'utf8'), 'theme: restored\n')
  await assert.rejects(readFile(join(dshHome, 'AGENTS.md')), { code: 'ENOENT' })
  assert.equal(JSON.parse(await readFile(join(dshHome, 'profiles', 'web', 'package.json'), 'utf8')).restored, true)
  assert.equal(await readFile(join(dshHome, 'profiles', 'web', 'node_modules', 'kept', 'module.txt'), 'utf8'), 'keep me')
  assert.equal(await readFile(join(dshHome, '.credentials.yaml'), 'utf8'), 'secret: keep\n')

  assert.deepEqual(await handler('backup-restore-commit', { planId: prepared.value.planId }), { ok: false, error: 'restore-plan-used' })
  assert.deepEqual(await handler('backup-restore', { id }), { ok: false, error: 'restore-preflight-required' })
})

test('backup integrity rejects traversal, links, duplicates, unexpected entries, malformed manifests, and invalid imports', async (t) => {
  const cases = [
    ['traversal', [{ name: '../escape', data: 'bad' }], 'backup-entry-traversal'],
    ['link', [{ name: 'sessions/', type: '5' }, { name: 'sessions/link', type: '2', linkname: '/tmp/target' }, { name: 'config/', type: '5' }, { name: 'profiles/', type: '5' }], 'backup-entry-link'],
    ['duplicate', [{ name: 'sessions/', type: '5' }, { name: 'sessions/a', data: 'one' }, { name: 'sessions/a', data: 'two' }, { name: 'config/', type: '5' }, { name: 'profiles/', type: '5' }], 'backup-entry-duplicate'],
    ['unexpected', [{ name: 'sessions/', type: '5' }, { name: 'config/', type: '5' }, { name: 'config/.credentials.yaml', data: 'secret' }, { name: 'profiles/', type: '5' }], 'backup-entry-unexpected'],
    ['profile', [{ name: 'sessions/', type: '5' }, { name: 'config/', type: '5' }, { name: 'profiles/', type: '5' }, { name: 'profiles/web/', type: '5' }, { name: 'profiles/web/package.json', data: 'not json' }], 'backup-profile-invalid'],
  ]
  for (const [label, entries, issueCode] of cases) {
    const dshHome = await mkdtemp(join(tmpdir(), `dsh-service-backup-invalid-${label}-`))
    t.after(() => rm(dshHome, { recursive: true, force: true }))
    await mkdir(join(dshHome, 'backups'), { recursive: true })
    const name = 'dsh-backup-20250819-120000.tar.gz'
    await writeFile(join(dshHome, 'backups', name), tarArchive(entries))
    const { handler } = createHost({ env: { DSH_HOME: dshHome } })
    const listed = await handler('backup-list', {})
    const inspected = await handler('backup-inspect', { id: listed.value.items[0].id })
    assert.equal(inspected.ok, true, label)
    assert.equal(inspected.value.validForRestore, false, label)
    assert.equal(inspected.value.status, 'error', label)
    assert.equal(inspected.value.issues.some((issue) => issue.code === issueCode || (label === 'traversal' && issue.code === 'backup-entry-platform')), true, label)
    assert.deepEqual(await handler('backup-restore-prepare', { id: listed.value.items[0].id }), { ok: false, error: 'backup-archive-invalid' }, label)
  }

  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-invalid-import-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const { handler } = createHost({ env: { DSH_HOME: dshHome } })
  const imported = await handler('backup-import', { name: 'dsh-backup-20250819-120000.tar.gz', data: Buffer.from('not a tar archive').toString('base64') })
  assert.deepEqual(imported, { ok: false, error: 'backup-archive-invalid' })
  assert.equal((await handler('backup-list', {})).value.items.length, 0)
})

test('restore preflight consumes expired and drifted plans without changing live data or scheduling restart', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-drift-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'backups'), { recursive: true })
  await mkdir(join(dshHome, 'sessions'), { recursive: true })
  await writeFile(join(dshHome, 'sessions', 'current.jsonl'), 'current\n')
  const name = 'dsh-backup-20250819-120000.tar.gz'
  const archivePath = join(dshHome, 'backups', name)
  await writeFile(archivePath, validBackupArchive())
  const { handler, scheduled } = createHost({ env: { DSH_HOME: dshHome } })
  const id = (await handler('backup-list', {})).value.items[0].id

  const sourcePlan = await handler('backup-restore-prepare', { id })
  await writeFile(archivePath, validBackupArchive({ entries: [
    { name: 'sessions/', type: '5' }, { name: 'sessions/changed', data: 'changed' },
    { name: 'config/', type: '5' }, { name: 'profiles/', type: '5' },
  ] }))
  assert.deepEqual(await handler('backup-restore-commit', { planId: sourcePlan.value.planId }), { ok: false, error: 'restore-source-changed' })
  assert.deepEqual(await handler('backup-restore-commit', { planId: sourcePlan.value.planId }), { ok: false, error: 'restore-plan-used' })

  await writeFile(archivePath, validBackupArchive())
  const targetPlan = await handler('backup-restore-prepare', { id })
  await writeFile(join(dshHome, 'sessions', 'current.jsonl'), 'changed-after-plan\n')
  assert.deepEqual(await handler('backup-restore-commit', { planId: targetPlan.value.planId }), { ok: false, error: 'restore-target-changed' })
  assert.equal(await readFile(join(dshHome, 'sessions', 'current.jsonl'), 'utf8'), 'changed-after-plan\n')
  assert.equal(scheduled.some((entry) => entry.delay === 500), false)
})

test('manual runtime restore commits without scheduling exit and returns hand-restart guidance', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-manual-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'backups'), { recursive: true })
  await writeFile(join(dshHome, 'backups', 'dsh-backup-20250819-120000.tar.gz'), validBackupArchive())
  const { handler, scheduled } = createHost({ env: { DSH_HOME: dshHome, DSH_SERVICE_RUNTIME_ENV: 'manual' } })
  const id = (await handler('backup-list', {})).value.items[0].id
  const plan = await handler('backup-restore-prepare', { id })
  const committed = await handler('backup-restore-commit', { planId: plan.value.planId })
  assert.equal(committed.ok, true)
  assert.equal(committed.value.restart.scheduled, false)
  assert.equal(committed.value.restart.requiresManualRestart, true)
  assert.deepEqual(scheduled, [])
})

test('feature gate covers backup integrity and restore preflight endpoints', async () => {
  const { handler } = createHost({ featureSettings: { backupMaintenance: false } })
  for (const endpoint of ['backup-inspect', 'backup-restore-prepare', 'backup-restore-commit']) {
    assert.deepEqual(await handler(endpoint, {}), { ok: false, error: 'feature-disabled' }, endpoint)
  }
})

test('RPC dispatcher registers one loopback channel and normalizes every wire failure', async () => {
  const host = createHost({ featureSettings: { healthDiagnostics: false } })
  assert.equal(host.rpcRegistration.channel, '/dsh-service')
  assert.deepEqual(host.rpcRegistration.options, { authority: 'loopback' })

  const cases = [
    ['diagnostics', 42, 'feature-disabled'],
    ['sessions-view', 42, 'invalid-session-id'],
    ['skills-toggle', { field: 'bad', enable: true }, 'invalid-field'],
    ['sessions-view', {}, 'invalid-session-id'],
    ['missing-endpoint', { secret: 'must-not-be-logged' }, 'unknown-endpoint'],
  ]
  for (const [endpoint, payload, message] of cases) {
    const raw = await host.rawHandler(endpoint, payload)
    assert.equal(raw.ok, false, endpoint)
    assert.deepEqual(raw.error, { code: 'internal', message, details: {} }, endpoint)
    assert.equal((await host.handler(endpoint, payload)).error, message, endpoint)
  }
})

test('RPC dispatcher records unexpected handler failures as technical errors', async () => {
  const host = createHost({
    services: {
      sessionQuery: {
        async listSessions() { throw new Error('database-offline') },
      },
    },
  })
  const raw = await host.rawHandler('health', {})
  assert.deepEqual(raw, { ok: false, error: { code: 'internal', message: 'database-offline', details: {} } })
  assert.equal(host.logs.error.length, 1)
  assert.match(host.logs.error[0], /technical error endpoint=health/)
  assert.match(host.logs.error[0], /database-offline/)
})

test('RPC dispatcher preserves failure extras and audits operations without payload data', async () => {
  const host = createHost({ services: { agents: { list: () => [{ id: 'agent-1', status: 'running' }] } } })
  const raw = await host.rawHandler('web', { force: false, secret: 'must-not-be-logged' })
  assert.equal(raw.ok, false)
  assert.equal(raw.error.message, 'active-work')
  assert.equal(raw.value.hasActive, true)
  assert.equal(host.logs.info.length, 1)
  assert.match(host.logs.info[0], /rpc audit endpoint=web outcome=rejected/)
  assert.equal(host.logs.info[0].includes('must-not-be-logged'), false)
  assert.deepEqual(host.logs.error, [])
})

test('feature settings namespace registers when the settings service appears after plugin startup', () => {
  const { registeredSettings, provideSettings } = createHost({
    featureSettings: {},
    settingsInitiallyAvailable: false,
  })

  assert.equal(registeredSettings.length, 0)
  provideSettings()
  assert.equal(registeredSettings.length, 1)
  assert.equal(registeredSettings[0].namespace, 'dsh-service')
})

test('feature settings namespace defaults on and disabled capabilities hot-enable through public Host seams', async () => {
  const routes = []
  const { handler, registeredSettings, updateFeatureSettings } = createHost({
    featureSettings: { healthDiagnostics: false, modelUsage: false, quotaLookup: false, backupMaintenance: false, healthz: false, subagentRoute: false, sessionManager: false },
    services: {
      webServer: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    },
  })

  assert.equal(registeredSettings.length, 1)
  assert.equal(registeredSettings[0].namespace, 'dsh-service')
  assert.deepEqual(registeredSettings[0].options?.base, {
    healthDiagnostics: true,
    modelUsage: true,
    quotaLookup: true,
    backupMaintenance: true,
    taskNotifications: true,
    healthz: true,
    skillManager: true,
    subagentRoute: true,
    subagentModelsDock: true,
    mobileAdaptation: false,
    sessionManager: true,
  })
  assert.deepEqual(registeredSettings[0].schema({}), {
    healthDiagnostics: true,
    modelUsage: true,
    quotaLookup: true,
    backupMaintenance: true,
    taskNotifications: true,
    healthz: true,
    skillManager: true,
    subagentRoute: true,
    subagentModelsDock: true,
    mobileAdaptation: false,
    sessionManager: true,
  })
  assert.equal(routes.some((route) => route.path === '/healthz'), false)
  assert.equal(routes.some((route) => route.path === '/dsh-backup-download'), true)

  for (const endpoint of ['diagnostics', 'permissions-plan', 'permissions-deep', 'permissions-repair', 'plugin-restart', 'usage', 'usage-refresh', 'quota', 'quota-refresh', 'quota-config', 'quota-reset-card', 'backup-list', 'backup-create', 'backup-export', 'backup-delete', 'backup-inspect', 'backup-restore-prepare', 'backup-restore-commit', 'backup-restore', 'backup-import', 'subagent-route', 'subagent-route-save', 'subagent-dispatches', 'sessions-list', 'sessions-bytes', 'sessions-view', 'sessions-search', 'sessions-export', 'sessions-archive', 'sessions-delete-plan', 'sessions-delete']) {
    assert.deepEqual(await handler(endpoint, {}), { ok: false, error: 'feature-disabled' }, endpoint)
  }

  await updateFeatureSettings({ healthDiagnostics: true, modelUsage: true, quotaLookup: true, backupMaintenance: true })
  assert.notDeepEqual(await handler('diagnostics', {}), { ok: false, error: 'feature-disabled' })
  assert.notDeepEqual(await handler('permissions-plan', {}), { ok: false, error: 'feature-disabled' })
  assert.notDeepEqual(await handler('permissions-deep', {}), { ok: false, error: 'feature-disabled' })
  assert.notDeepEqual(await handler('permissions-repair', {}), { ok: false, error: 'feature-disabled' })
  assert.notDeepEqual(await handler('usage', {}), { ok: false, error: 'feature-disabled' })
  assert.notDeepEqual(await handler('quota', {}), { ok: false, error: 'feature-disabled' })
  assert.notDeepEqual(await handler('backup-list', {}), { ok: false, error: 'feature-disabled' })
})

test('healthz feature setting unregisters and re-registers the route without restarting the plugin', async () => {
  const routes = []
  const active = new Set()
  const { updateFeatureSettings } = createHost({
    featureSettings: {},
    services: {
      webServer: {
        register(route) {
          routes.push(route)
          active.add(route.path)
          return () => active.delete(route.path)
        },
      },
    },
  })

  assert.equal(active.has('/healthz'), true)
  await updateFeatureSettings({ healthz: false })
  assert.equal(active.has('/healthz'), false)
  await updateFeatureSettings({ healthz: true })
  assert.equal(active.has('/healthz'), true)
  assert.equal(routes.filter((route) => route.path === '/healthz').length, 2)
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

test('diagnostics degrades the plugins check to info when the loader service is absent', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-no-loader-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-no-loader-workspace-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })]))
  await chmod(dshHome, 0o755)
  await chmod(workspace, 0o755)
  const { handler } = createHost({
    services: {
      sessionPersistence: { listSnapshots: async () => [] },
      workspaceRegistry: { list: () => [] },
      subprocess: { resolveExecutable: async (name) => `/usr/bin/${name}` },
    },
    env: { DSH_HOME: dshHome },
  })
  const result = await handler('diagnostics', {})
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.checks.find((check) => check.id === 'plugins'), { id: 'plugins', status: 'info', detail: 'unavailable' })
  assert.equal(result.value.pluginIssues, undefined, 'no plugin issues without the loader')
  assert.deepEqual(result.value.checks.find((check) => check.id === 'plugin-compat'), { id: 'plugin-compat', status: 'info', detail: 'unavailable' })
  assert.equal(result.value.pluginCompat, undefined, 'no compatibility scan result without the loader')
  assert.equal(result.value.status, 'ok', 'info does not affect the overall status')
})

test('diagnostics carries per-plugin rows and a failed plugin escalates the report', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-with-loader-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-with-loader-workspace-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true })]))
  await chmod(dshHome, 0o755)
  await chmod(workspace, 0o755)
  const { handler } = createHost({
    services: {
      sessionPersistence: { listSnapshots: async () => [] },
      workspaceRegistry: { list: () => [] },
      subprocess: { resolveExecutable: async (name) => `/usr/bin/${name}` },
      loader: {
        ctx: { baseUrl: 'file:///home/node/.dsh/profiles/web/' },
        entries: () => [
          { id: 'include:group', options: { name: 'group', group: true } },
          { id: 'include:llm', options: { name: '@deepseek-ai/dsh-llm' }, fiber: { state: 2, inject: {}, store: {} } },
          { id: 'include:dsh-service', options: { name: '@gehennawu/dsh-service' }, fiber: { state: 2, inject: { connection: null }, store: { connection: {} } } },
          { id: 'include:market', options: { name: 'dshmarket' }, fiber: { state: 3, inject: {}, store: {}, _error: new Error('config invalid') } },
          { id: 'include:off', options: { name: 'dsh-off' }, disabled: true },
        ],
      },
    },
    env: { DSH_HOME: dshHome },
  })
  const result = await handler('diagnostics', {})
  assert.equal(result.ok, true)
  const pluginCheck = result.value.checks.find((check) => check.id === 'plugins')
  assert.deepEqual(pluginCheck, { id: 'plugins', status: 'error', detail: '3:1:0' }, 'total counts enabled entries only; disabled (built-in or custom) are excluded')
  assert.equal(result.value.status, 'error')
  assert.equal(result.value.pluginIssues.length, 1, 'only abnormal entries are delivered')
  assert.deepEqual(result.value.pluginIssues[0], {
    entryId: 'include:market',
    moduleName: 'dshmarket',
    phase: 'failed',
    error: 'config invalid',
  })
  assert.equal(result.value.pluginIssues.some((issue) => issue.entryId === 'include:llm'), false, 'active built-in plugins are not listed')
  assert.equal(result.value.pluginIssues.some((issue) => issue.entryId === 'include:off'), false, 'disabled plugins are not listed')
})

test('diagnostics scans plugin breakage fixtures and flags possibly incompatible plugins as a warning', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-compat-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-compat-workspace-'))
  const profile = await mkdtemp(join(tmpdir(), 'dsh-service-compat-profile-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true }), rm(profile, { recursive: true, force: true })]))
  await chmod(dshHome, 0o755)
  await chmod(workspace, 0o755)
  // fixture 包：hst-old-a 在 manifest 与代码里都引用已变更接口；hst-old-b 只引用代码层旧钩子
  await mkdir(join(profile, 'node_modules', 'hst-old-a'), { recursive: true })
  await writeFile(join(profile, 'node_modules', 'hst-old-a', 'package.json'), JSON.stringify({
    name: 'hst-old-a',
    exports: { './client': './client.js', '.': './index.js' },
    dsh: { client: { inject: ['@deepseek-ai/dsh-client-runtime'] } },
  }))
  await writeFile(join(profile, 'node_modules', 'hst-old-a', 'client.js'), "const cls = 'Md3f7G_toBottom'")
  await writeFile(join(profile, 'node_modules', 'hst-old-a', 'index.js'), 'module.exports = {}')
  await mkdir(join(profile, 'node_modules', 'hst-old-b'), { recursive: true })
  await writeFile(join(profile, 'node_modules', 'hst-old-b', 'package.json'), JSON.stringify({ name: 'hst-old-b', main: './index.js' }))
  await writeFile(join(profile, 'node_modules', 'hst-old-b', 'index.js'), "const s = 'data-time-hover-root'")
  await mkdir(join(profile, 'node_modules', 'hst-clean'), { recursive: true })
  await writeFile(join(profile, 'node_modules', 'hst-clean', 'package.json'), JSON.stringify({ name: 'hst-clean', main: './index.js' }))
  await writeFile(join(profile, 'node_modules', 'hst-clean', 'index.js'), 'const fine = 1')
  await mkdir(join(profile, 'node_modules', 'hst-missing'), { recursive: true })
  await writeFile(join(profile, 'node_modules', 'hst-missing', 'package.json'), JSON.stringify({ name: 'hst-missing', main: './gone.js' }))

  const { handler } = createHost({
    services: {
      sessionPersistence: { listSnapshots: async () => [] },
      workspaceRegistry: { list: () => [] },
      subprocess: { resolveExecutable: async (name) => `/usr/bin/${name}` },
      loader: {
        ctx: { baseUrl: `file://${profile}/` },
        entries: () => [
          { id: 'inc:group', options: { name: 'group', group: true } },
          { id: 'inc:a', options: { name: 'hst-old-a' }, fiber: { state: 2, inject: {}, store: {} } },
          { id: 'inc:b', options: { name: 'hst-old-b' }, fiber: { state: 2, inject: {}, store: {} } },
          { id: 'inc:clean', options: { name: 'hst-clean' }, fiber: { state: 2, inject: {}, store: {} } },
          { id: 'inc:missing', options: { name: 'hst-missing' }, fiber: { state: 2, inject: {}, store: {} } },
          { id: 'inc:off', options: { name: 'hst-old-b' }, disabled: true },
        ],
      },
    },
    env: { DSH_HOME: dshHome },
  })
  const result = await handler('diagnostics', {})
  assert.equal(result.ok, true)
  const compatCheck = result.value.checks.find((check) => check.id === 'plugin-compat')
  // scanned=4（a/b/clean/missing，group/disabled 跳过）：broken=2（a 的 chat-hash + b 的
  // time-hover-root 真引用）、declaredOnly=1（a 的 client-runtime 仅声明）、unknown=1。
  assert.deepEqual(compatCheck, { id: 'plugin-compat', status: 'warning', detail: '4:2:1:1' })
  assert.equal(result.value.status, 'warning', 'compatibility risk escalates the report to warning')
  assert.deepEqual(result.value.pluginCompat.issues, [
    { moduleName: 'hst-old-a', breaks: ['chat-hash'] },
    { moduleName: 'hst-old-b', breaks: ['time-hover-root'] },
  ])
  assert.deepEqual(result.value.pluginCompat.declaredOnly, [{ moduleName: 'hst-old-a', breaks: ['client-runtime'] }])
  assert.deepEqual(result.value.pluginCompat.unknown, [{ moduleName: 'hst-missing', reason: 'missing-entry' }])
  assert.equal(result.value.pluginCompat.scanned, 4)
})

test('diagnostics reports a healthy compatibility scan when every plugin is clean', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-compat-home2-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-compat-workspace2-'))
  const profile = await mkdtemp(join(tmpdir(), 'dsh-service-compat-profile2-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(workspace, { recursive: true, force: true }), rm(profile, { recursive: true, force: true })]))
  await chmod(dshHome, 0o755)
  await chmod(workspace, 0o755)
  await mkdir(join(profile, 'node_modules', 'hst-clean2'), { recursive: true })
  await writeFile(join(profile, 'node_modules', 'hst-clean2', 'package.json'), JSON.stringify({ name: 'hst-clean2', main: './index.js' }))
  await writeFile(join(profile, 'node_modules', 'hst-clean2', 'index.js'), 'const fine = 1')

  const { handler } = createHost({
    services: {
      sessionPersistence: { listSnapshots: async () => [] },
      workspaceRegistry: { list: () => [] },
      subprocess: { resolveExecutable: async (name) => `/usr/bin/${name}` },
      loader: {
        ctx: { baseUrl: `file://${profile}/` },
        entries: () => [{ id: 'inc:clean2', options: { name: 'hst-clean2' }, fiber: { state: 2, inject: {}, store: {} } }],
      },
    },
    env: { DSH_HOME: dshHome },
  })
  const result = await handler('diagnostics', {})
  assert.deepEqual(result.value.checks.find((check) => check.id === 'plugin-compat'), { id: 'plugin-compat', status: 'ok', detail: '1:0:0:0' })
  assert.deepEqual(result.value.pluginCompat, { scanned: 1, issues: [], declaredOnly: [], unknown: [] })
})

test('plugin-restart endpoint reloads only failed fibers of listed entries', async () => {
  const restarted = []
  const { handler, logs } = createHost({
    featureSettings: {},
    services: {
      loader: {
        entries: () => [
          { id: 'ok', options: { name: 'pkg-ok' }, fiber: { state: 2, inject: {}, store: {} } },
          {
            id: 'broken',
            options: { name: 'pkg-broken' },
            fiber: {
              state: 3,
              inject: {},
              store: {},
              _error: new Error('boom'),
              restart: async () => { restarted.push('broken') },
            },
          },
          { id: 'off', options: { name: 'pkg-off' }, disabled: true },
        ],
      },
    },
  })
  assert.deepEqual(await handler('plugin-restart', { entryId: 'broken' }), { ok: true, value: {} })
  assert.deepEqual(restarted, ['broken'])

  // publicHandler 把严格 RPC 错误信封归一为字符串码（等价客户端 rpcCall wrapper 语义）。
  assert.deepEqual(await handler('plugin-restart', { entryId: 'nope' }), { ok: false, error: 'unknown-plugin' })
  assert.deepEqual(await handler('plugin-restart', { entryId: 'ok' }), { ok: false, error: 'not-failed' })
  assert.deepEqual(await handler('plugin-restart', { entryId: 'off' }), { ok: false, error: 'plugin-disabled' })
  assert.deepEqual(await handler('plugin-restart', {}), { ok: false, error: 'unknown-plugin' })
  assert.ok(logs.info.some((line) => String(line).includes('endpoint=plugin-restart')), 'restart is audited')
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
      response.emit('data', JSON.stringify({ 'dist-tags': isDsh ? { latest: '0.1.0-rc.7', next: '0.2.0-rc.1', alpha: '0.3.0-alpha.1' } : { latest: '0.10.1', next: '0.11.0', alpha: '0.12.0-alpha.1' } }))
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
  assert.equal(first.value.dsh.latest, '0.3.0-alpha.1')
  assert.deepEqual(first.value.dsh.tags, { latest: '0.1.0-rc.7', next: '0.2.0-rc.1', alpha: '0.3.0-alpha.1' })
  assert.equal(first.value.dsh.upToDate, false)
  assert.equal(first.value.plugin.current, pluginVersion)
  assert.equal(first.value.plugin.latest, '0.12.0-alpha.1')
  assert.deepEqual(first.value.plugin.tags, { latest: '0.10.1', next: '0.11.0', alpha: '0.12.0-alpha.1' })
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
  assert.deepEqual(parseQuotaConfigText('not json'), { version: 1, kinds: {}, resetCards: [], allowedHosts: {} })
  assert.deepEqual(parseQuotaConfigText('{"version":99,"kinds":{"p":"opencode-go"}}'), { version: 1, kinds: {}, resetCards: [], allowedHosts: {} })
  assert.deepEqual(parseQuotaConfigText('{"version":1,"kinds":{"p":"mystery","q":"opencode-go"}}'), { version: 1, kinds: { q: 'opencode-go' }, resetCards: [], allowedHosts: {} })
  assert.deepEqual(parseQuotaConfigText('{"version":1,"kinds":[] }'), { version: 1, kinds: {}, resetCards: [], allowedHosts: {} })
  // null = 显式停用，必须原样保留。
  assert.deepEqual(parseQuotaConfigText('{"version":1,"kinds":{"p":null,"q":"opencode-go"}}'), { version: 1, kinds: { p: null, q: 'opencode-go' }, resetCards: [], allowedHosts: {} })
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

test('quota merges runtime llm channels via the alias table (deepseek-official) without extra rows', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-channel-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  // 全程离线：https.get 整体替换为假上游——别名渠道配了凭据后的真实外呼也落在这个桩上。
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
      if (String(url).includes('api.deepseek.com')) {
        response.emit('data', JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '0', topped_up_balance: '12.34' }] }))
      } else {
        response.emit('data', '{"usage":{}}')
      }
      response.emit('end')
    })
    return request
  }
  t.after(() => { https.get = originalGet })
  const host = createHost({
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { openrouter: { apiKeyEnv: 'OPENROUTER_API_KEY' } } } : undefined) },
      // 真实契约：listProviders() 下发 [{id,name}] 对象数组（dsh-llm 源码核实）；字符串条目兼容容忍。
      llm: { listProviders: () => [{ id: 'pi-catalog-noise', name: 'Noise' }, { id: 'deepseek-official', name: 'DeepSeek' }, 'legacy-string'] },
      // 最小凭据服务：resolve 走环境变量，describe 只回「未配置」——供凭据填写窗口的数据源断言。
      credentials: {
        resolve: async (name) => (typeof process.env[name] === 'string' && process.env[name] !== '' ? { value: process.env[name] } : undefined),
        describe: async () => ({ configured: false }),
      },
    },
  })

  // v0.31 用户点名：自动识别的 DeepSeek 行在 API KEY 未配置时整行不下发——不出现卡片、不外呼。
  const first = await host.handler('quota', {})
  assert.equal(first.ok, true)
  const byProvider = new Map(first.value.providers.map((row) => [row.provider, row]))
  assert.equal(byProvider.has('deepseek-official'), false, 'unconfigured auto deepseek must be hidden')
  assert.equal(byProvider.get('openrouter').usageUrl, undefined)
  assert.equal(byProvider.has('pi-catalog-noise'), false)
  assert.equal(byProvider.has('legacy-string'), false)

  // 配置好 DEEPSEEK_API_KEY 后，下一次快照（即进入额度页那次拉取）自动识别完成、行自动现身；
  // 假上游接住由此触发的唯一一次余额查询（TTL 内不再重复）。
  process.env.DEEPSEEK_API_KEY = 'k'
  t.after(() => { delete process.env.DEEPSEEK_API_KEY })
  const second = await host.handler('quota', {})
  assert.equal(second.ok, true)
  const dsRow = second.value.providers.find((row) => row.provider === 'deepseek-official')
  assert.ok(dsRow, 'configured deepseek-official row missing')
  assert.equal(dsRow.adapted, true)
  assert.equal(dsRow.kind, 'deepseek')
  assert.equal(dsRow.kindSource, 'auto')
  assert.equal(dsRow.displayName, 'DeepSeek') // 渠道对象的 name 作展示名
  assert.equal(dsRow.usageUrl, 'https://platform.deepseek.com/usage') // 官网用户页随 kind 下发
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.filter((url) => url.includes('api.deepseek.com')).length, 1)

  // 显式停用（kind:null）优先于别名自动适配；clear 回退后恢复自动识别。
  const saved = await host.handler('quota-config', { provider: 'deepseek-official', kind: null })
  assert.equal(saved.ok, true)
  assert.equal((await host.handler('quota', {})).value.providers.find((row) => row.provider === 'deepseek-official').adapted, false)
  await host.handler('quota-config', { provider: 'deepseek-official', clear: true })
  assert.ok((await host.handler('quota', {})).value.providers.find((row) => row.provider === 'deepseek-official').adapted)

  // 撤掉凭据后回退自动识别 → 行再次隐藏；但显式在 UI 适配过的不受隐匿门限制：
  // 照常出现 unconfigured 卡片（带凭据填写线索），用户主动选择的入口不能消失。
  delete process.env.DEEPSEEK_API_KEY
  await host.handler('quota-config', { provider: 'deepseek-official', kind: 'deepseek' })
  // quota-refresh 清掉上一阶段的成功 TTL，强制一次真实重试（此时无凭据 → 静默失败）。
  await host.handler('quota-refresh', { provider: 'deepseek-official' })
  const manualFirst = await host.handler('quota', {})
  const manualRow = manualFirst.value.providers.find((row) => row.provider === 'deepseek-official')
  assert.ok(manualRow, 'explicitly adapted deepseek row must stay visible even without key')
  assert.equal(manualRow.kindSource, 'config')
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const manualSettled = await host.handler('quota', {})
  const settledRow = manualSettled.value.providers.find((row) => row.provider === 'deepseek-official')
  assert.equal(settledRow.status, 'unconfigured')
  assert.equal(settledRow.errorCode, 'credential-missing')
  assert.ok(Array.isArray(settledRow.credentialHints))
  assert.ok(settledRow.credentialHints.some((hint) => hint.name === 'DEEPSEEK_API_KEY' && hint.configured === false))

  // 别名渠道在白名单语义里与 settings 路由同权：凭据写入窗口接受它、未知名字仍拒绝。
  const credForm = await host.handler('quota-credential-set', { provider: 'deepseek-official', name: 'DEEPSEEK_API_KEY', value: 'k' })
  assert.notEqual(credForm.error, 'unknown-provider')
  assert.equal((await host.handler('quota-reset-card', { provider: 'no-such-provider' })).error, 'unknown-provider')

  await new Promise((resolve) => setImmediate(resolve))
  // 除假上游中转的 deepseek 域以外无任何出网请求（openrouter 未适配，绝不发起）。
  assert.equal(requests.some((url) => !url.includes('api.deepseek.com')), false)
})

test('quotaCredentialConfigured mirrors the full credential chain and fails silent', async () => {
  const profile = { name: 'deepseek-official', displayName: 'DeepSeek', baseURL: '', apiKeyEnv: '' }
  // 凭据服务缺席且环境变量未设 → 未配置。
  assert.equal(await quotaCredentialConfigured({ get: () => undefined }, 'deepseek', profile), false)
  // resolve 抛错（凭据层故障）→ 静默按未配置处理，绝不让错误冒泡到快照 RPC。
  assert.equal(await quotaCredentialConfigured({ get: () => ({ resolve: async () => { throw new Error('boom') } }) }, 'deepseek', profile), false)
  // 凭据库命中 / 环境变量兜底 → 配置完成。
  assert.equal(await quotaCredentialConfigured({ get: () => ({ resolve: async () => ({ value: 'k' }) }) }, 'deepseek', profile), true)
  process.env.DEEPSEEK_API_KEY = 'k-env'
  try {
    assert.equal(await quotaCredentialConfigured({ get: () => undefined }, 'deepseek', profile), true)
  } finally {
    delete process.env.DEEPSEEK_API_KEY
  }
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
  assert.equal(rows.find((row) => row.provider === 'zai-bigmodel').usageUrl, 'https://open.bigmodel.cn/coding-plan/personal/usage')
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

test('deepseek balance parser maps currency windows and tolerates missing fields', () => {
  // 官方文档 fixture（api-docs.deepseek.com/zh-cn/api/get-user-balance，2026-08 核实）：
  // 金额是字符串，total_balance = granted_balance + topped_up_balance。
  assert.deepEqual(normalizeDeepseekBalance({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
  }).windows, [
    { id: 'balance-cny', text: '¥110.00', label: 'CNY', kindKey: 'balance' },
    { id: 'granted-cny', text: '¥10.00', label: 'CNY', kindKey: 'granted-balance' },
  ])
  // 赠金为 0 不追加赠金行；金额字符串直接是数字也收。
  assert.deepEqual(
    normalizeDeepseekBalance({ balance_infos: [{ currency: 'USD', total_balance: '9.5', granted_balance: '0.00' }] }).windows,
    [{ id: 'balance-usd', text: '$9.50', label: 'USD', kindKey: 'balance' }],
  )
  // 非人民币/美元币种不带符号、后缀 ISO 码；重复币种去重；坏条目（负数/缺金额/null）逐条丢弃。
  assert.deepEqual(
    normalizeDeepseekBalance({ balance_infos: [
      { currency: 'eur', total_balance: '7' },
      { currency: 'EUR', total_balance: '8.00' },
      { currency: 'CNY', total_balance: '-1' },
      { currency: 'CNY' },
      null,
    ] }).windows,
    [{ id: 'balance-eur', text: '7.00 EUR', label: 'EUR', kindKey: 'balance' }],
  )
  assert.deepEqual(normalizeDeepseekBalance(null).windows, [])
  assert.deepEqual(normalizeDeepseekBalance({ balance_infos: 'nope' }).windows, [])
  // 空串/空白金额是上游缺数据不是零余额：Number('') === 0 会伪装成 ¥0.00，必须整条丢弃。
  assert.deepEqual(
    normalizeDeepseekBalance({ balance_infos: [{ currency: 'CNY', total_balance: '', granted_balance: ' ' }] }).windows,
    [],
  )
  // 宿主常量端点链与 baseURL 自动推断（含子域与 /v1 路径后缀）。
  assert.deepEqual(quotaEndpointFor('deepseek', ''), ['https://api.deepseek.com/user/balance'])
  assert.equal(inferQuotaKind('https://api.deepseek.com/v1'), 'deepseek')
  assert.equal(inferQuotaKind('https://api.deepseek.com'), 'deepseek')
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

// ─── v0.22 技能管理 ──────────────────────────────────────────────────────────

const SKILL_FILE_ALPHA = '---\nname: alpha\ndescription: "Alpha skill"\n---\n\nAlpha body.\n'
const SKILL_FILE_BETA = '---\nname: beta\ndescription: "Beta skill"\nwhenToUse: "Use beta for tests"\n---\n\nBeta body.\n'
const SKILL_FILE_LEGACY = '---\nname: gamma\ndescription: "Gamma skill"\nmodelInvocable: false\n---\n\nGamma body.\n'

function withAgentsHome(agentsHome, run) {
  const previous = process.env.DSH_AGENTS_HOME
  process.env.DSH_AGENTS_HOME = agentsHome
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = previous
    })
}

async function createSkillFixture(t) {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-skills-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-skills-ws-'))
  const agentsHome = await mkdtemp(join(tmpdir(), 'dsh-service-skills-agents-'))
  t.after(() => Promise.all([
    rm(dshHome, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
    rm(agentsHome, { recursive: true, force: true }),
  ]))
  await mkdir(join(dshHome, 'skills'), { recursive: true })
  await mkdir(join(workspace, '.dsh', 'skills', 'alpha'), { recursive: true })
  await mkdir(join(agentsHome, 'skills'), { recursive: true })
  await writeFile(join(workspace, '.dsh', 'skills', 'alpha', 'SKILL.md'), SKILL_FILE_ALPHA)
  await writeFile(join(agentsHome, 'skills', 'beta.md'), SKILL_FILE_BETA)
  await writeFile(join(agentsHome, 'skills', 'gamma.md'), SKILL_FILE_LEGACY)
  await writeFile(join(agentsHome, 'skills', 'alpha.md'), SKILL_FILE_ALPHA.replace('Alpha body.', 'Shadow copy.'))
  return { dshHome, workspace, agentsHome }
}

test('skills-list scans roots, marks shadows and legacy entries; toggle round-trips the frontmatter key', async (t) => {
  const { dshHome, workspace, agentsHome } = await createSkillFixture(t)
  const { handler } = createHost({
    services: { workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] } },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(agentsHome, async () => {
    const listed = await handler('skills-list', {})
    assert.equal(listed.ok, true)
    const byName = new Map(listed.value.entries.map((entry) => [entry.name + ':' + entry.source, entry]))
    const alphaProject = byName.get('alpha:project-dsh')
    const alphaShadow = byName.get('alpha:user-agents')
    assert.notEqual(alphaProject, undefined)
    assert.notEqual(alphaShadow, undefined)
    assert.equal(alphaProject.shadowed, false)
    assert.equal(alphaShadow.shadowed, true)
    assert.equal(alphaProject.invocation.model, true)
    assert.equal(alphaProject.writable, true)
    assert.equal(alphaProject.annotated, false)

    const beta = byName.get('beta:user-agents')
    assert.equal(beta.usage, 'Use beta for tests')
    const gamma = byName.get('gamma:user-agents')
    assert.match(gamma.invalid, /^legacy-invocation-key:modelInvocable$/)

    // 签名 ID 可逆：伪造 ID 拒绝。
    assert.equal((await handler('skills-toggle', { id: 'forged-id', field: 'user', enable: false })).error, 'unknown-skill')

    // 两段开关：关 = 写规范键；开 = 删键行，且往返后文件与初始内容一致。
    const betaPath = join(agentsHome, 'skills', 'beta.md')
    const disabled = await handler('skills-toggle', { id: beta.id, field: 'user', enable: false })
    assert.equal(disabled.ok, true)
    assert.equal(disabled.value.entry.invocation.user, false)
    assert.match(await readFile(betaPath, 'utf8'), /user-invocable: false/)
    const reEnabled = await handler('skills-toggle', { id: beta.id, field: 'user', enable: true })
    assert.equal(reEnabled.value.entry.invocation.user, true)
    assert.equal(await readFile(betaPath, 'utf8'), SKILL_FILE_BETA)

    // 幂等：重复关闭不叠加行。
    await handler('skills-toggle', { id: beta.id, field: 'user', enable: false })
    const twice = await readFile(betaPath, 'utf8')
    await handler('skills-toggle', { id: beta.id, field: 'user', enable: false })
    assert.equal(await readFile(betaPath, 'utf8'), twice)
    await handler('skills-toggle', { id: beta.id, field: 'user', enable: true })
  })
})

test('bundled skills are listed read-only and reject toggle and fix', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-skills-bundled-home-'))
  const bundledDir = await mkdtemp(join(tmpdir(), 'dsh-service-skills-bundled-dir-'))
  t.after(() => Promise.all([rm(dshHome, { recursive: true, force: true }), rm(bundledDir, { recursive: true, force: true })]))
  await mkdir(bundledDir, { recursive: true })
  await writeFile(join(bundledDir, 'core.md'), SKILL_FILE_BETA)
  const { handler } = createHost({ env: { DSH_HOME: dshHome } })
  // DSH_BUNDLED_SKILL_DIR 在扫描期读取（createHost 的 env 注入只覆盖 apply 阶段），手动设置并恢复。
  const previousBundled = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_BUNDLED_SKILL_DIR = bundledDir
  try {
    const listed = await handler('skills-list', {})
    assert.equal(listed.ok, true)
    const core = listed.value.entries.find((entry) => entry.name === 'beta' && entry.source === 'bundled')
    assert.notEqual(core, undefined)
    assert.equal(core.writable, false)
    assert.equal((await handler('skills-toggle', { id: core.id, field: 'model', enable: false })).error, 'read-only-source')
    assert.equal((await handler('skills-fix-keys', { id: core.id })).error, 'read-only-source')
  } finally {
    if (previousBundled === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
    else process.env.DSH_BUNDLED_SKILL_DIR = previousBundled
  }
})

test('skills-fix-keys rewrites legacy invocation keys with semantic conversion', async (t) => {
  const { dshHome, workspace, agentsHome } = await createSkillFixture(t)
  const { handler } = createHost({
    services: { workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] } },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(agentsHome, async () => {
    const listed = await handler('skills-list', {})
    const gamma = listed.value.entries.find((entry) => entry.name === 'gamma')
    const fixed = await handler('skills-fix-keys', { id: gamma.id })
    assert.equal(fixed.ok, true)
    assert.equal(fixed.value.entry.invalid, undefined)
    assert.equal(fixed.value.entry.invocation.model, false)
    const text = await readFile(join(agentsHome, 'skills', 'gamma.md'), 'utf8')
    assert.doesNotMatch(text, /modelInvocable/)
    assert.match(text, /disable-model-invocation: true/)
  })
})

test('feature-disabled gate blocks every skills endpoint', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-skills-gate-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const host = createHost({ env: { DSH_HOME: dshHome }, featureSettings: { skillManager: false } })
  for (const endpoint of ['skills-list', 'skills-models', 'skills-batch-status', 'skills-batch-cancel']) {
    assert.equal((await host.handler(endpoint, {})).error, 'feature-disabled', endpoint)
  }
})

function skillLlmMock(state) {
  return {
    listProviders: () => [{ id: 'prov', name: 'Provider' }],
    listModels: async (provider) => provider === 'prov' ? [{ id: 'm1', name: 'Model One' }] : [],
    stream(options) {
      state.streamCalls.push(options)
      const text = state.responses.shift() ?? '{"description":"fallback","whenToUse":""}'
      return (async function* generate() {
        yield { type: 'text-delta', index: 0, text }
      })()
    },
  }
}

test('skills-describe validates the model whitelist and applies a sanitized draft with sidecar annotation', async (t) => {
  const { dshHome, workspace, agentsHome } = await createSkillFixture(t)
  const llmState = {
    streamCalls: [],
    responses: ['Here you go:\n```json\n{"description":"新的描述句子","whenToUse":"新的用法说明"}\n```'],
  }
  const { handler } = createHost({
    services: {
      workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] },
      llm: skillLlmMock(llmState),
      agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'm1' }) },
    },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(agentsHome, async () => {
    const models = await handler('skills-models', {})
    assert.equal(models.ok, true)
    assert.deepEqual(models.value.models.map((item) => item.provider + '/' + item.id), ['prov/m1'])
    assert.deepEqual(models.value.current, { provider: 'prov', model: 'm1' })

    const listed = await handler('skills-list', {})
    const beta = listed.value.entries.find((entry) => entry.name === 'beta')
    // 白名单外的 route 拒绝。
    assert.equal((await handler('skills-describe', { id: beta.id, provider: 'other', model: 'm1' })).error, 'invalid-model-route')
    const described = await handler('skills-describe', { id: beta.id, provider: 'prov', model: 'm1' })
    assert.equal(described.ok, true)
    assert.deepEqual(described.value.draft, { description: '新的描述句子', usage: '新的用法说明' })
    // prompt 由宿主模板构造：系统提示含 STRICT JSON 约定，用户消息带技能正文。
    const streamOptions = llmState.streamCalls[0]
    assert.match(streamOptions.system, /STRICT JSON/)
    assert.match(streamOptions.messages[0].content[0].text, /Beta body/)
    // 补全输出语言跟随界面语言：请求未带 lang 时按英文兜底（与 DSH locale 的 en fallback 一致）。
    assert.match(streamOptions.system, /MUST be written in English/)
    assert.doesNotMatch(streamOptions.system, /Simplified Chinese/)
    // 显式 lang:'zh' 切到简体中文规则，其余 JSON 约定保持不变。
    llmState.responses.push('{"description":"中文描述","whenToUse":"中文用法"}')
    const describedZh = await handler('skills-describe', { id: beta.id, provider: 'prov', model: 'm1', lang: 'zh' })
    assert.equal(describedZh.ok, true)
    assert.deepEqual(describedZh.value.draft, { description: '中文描述', usage: '中文用法' })
    assert.match(llmState.streamCalls[1].system, /MUST be written in Simplified Chinese/)
    assert.doesNotMatch(llmState.streamCalls[1].system, /written in English/)
    assert.match(llmState.streamCalls[1].system, /STRICT JSON/)
    // 语言是白名单枚举：伪造值绝不进 prompt，一律落回英文模板。
    await handler('skills-describe', { id: beta.id, provider: 'prov', model: 'm1', lang: 'en\ndefinitely-not' })
    assert.doesNotMatch(llmState.streamCalls[2].system, /Simplified Chinese/)
    assert.match(llmState.streamCalls[2].system, /MUST be written in English/)

    // 运行日志可回读：包含调用路由与解析成功标记。
    const logs = await handler('skills-describe-log', { id: beta.id })
    assert.equal(logs.ok, true)
    // 日志条目是结构化 {at, code, params}：宿主不再拼本地化文案。
    const logLine = (code) => logs.value.logs.find((entry) => entry.code === code)
    assert.match(String(logLine('located').params.name), /beta/)
    assert.equal(logLine('attempt').params.route, 'prov/m1')
    assert.notEqual(logLine('parsed'), undefined)

    const saved = await handler('skills-note-save', { id: beta.id, patch: { description: described.value.draft.description, usage: described.value.draft.usage }, model: 'prov/m1' })
    assert.equal(saved.ok, true)
    assert.equal(saved.value.entry.annotated, true)
    assert.deepEqual(saved.value.entry.note, { description: '新的描述句子', usage: '新的用法说明', stale: false })
    // 注释只进侧车索引：技能文件必须保持原样。
    assert.equal(await readFile(join(agentsHome, 'skills', 'beta.md'), 'utf8'), SKILL_FILE_BETA)
    const index = JSON.parse(await readFile(join(dshHome, 'dsh-service-skills-index.json'), 'utf8'))
    assert.equal(index.version, 2)
    const record = Object.values(index.entries)[0]
    assert.deepEqual(record.note, { description: '新的描述句子', usage: '新的用法说明' })
    assert.equal(record.model, 'prov/m1')
    // 清除注释后回到未注释态，文件依旧原样。
    const cleared = await handler('skills-note-clear', { id: beta.id })
    assert.equal(cleared.ok, true)
    assert.equal(cleared.value.entry.annotated, false)
    assert.equal(cleared.value.entry.note, undefined)
    assert.equal(await readFile(join(agentsHome, 'skills', 'beta.md'), 'utf8'), SKILL_FILE_BETA)
  })
})

test('skills batch plan/run/status fills unannotated candidates, lists annotated ones, and gates their forced re-fill on explicit confirm', async (t) => {
  const { dshHome, workspace, agentsHome } = await createSkillFixture(t)
  const llmState = {
    streamCalls: [],
    responses: [
      '{"description":"Delta desc","whenToUse":"Delta usage"}',
      '{"description":"Gamma desc","whenToUse":"Gamma usage"}',
      '{"description":"Alpha redone","whenToUse":""}',
      '{"description":"Beta redone","whenToUse":""}',
    ],
  }
  const { handler } = createHost({
    services: {
      workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] },
      llm: skillLlmMock(llmState),
      agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'm1' }) },
    },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(agentsHome, async () => {
    const planned = await handler('skills-batch-plan', { provider: 'prov', model: 'm1' })
    assert.equal(planned.ok, true)
    // 候选 = alpha(project winner，未注释) + beta；alpha 的 user-agents 遮蔽副本与 gamma(invalid) 跳过。
    assert.deepEqual(planned.value.candidates.map((candidate) => candidate.name), ['alpha', 'beta'])
    assert.deepEqual(planned.value.annotated, [])
    assert.equal(planned.value.skipped.some((item) => item.reason === 'shadowed'), true)
    assert.equal(planned.value.skipped.some((item) => item.reason.startsWith('legacy-invocation-key:')), true)

    const run = await handler('skills-batch-run', { planId: planned.value.planId, lang: 'zh' })
    assert.equal(run.value.started, true)
    let finalStatus = null
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await handler('skills-batch-status', {})
      if (status.value.phase !== 'running') {
        finalStatus = status.value
        assert.equal(status.value.phase, 'done')
        assert.equal(status.value.done, 2)
        assert.equal(status.value.failures.length, 0)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    // 批量日志随状态返回：含逐条目与模型路由信息。
    assert.notEqual(finalStatus, null)
    assert.ok(finalStatus.logs.length > 0)
    assert.ok(finalStatus.logs.every((entry) => typeof entry.code === 'string'))
    assert.ok(finalStatus.logs.some((entry) => entry.name === 'alpha' && entry.code === 'item-start'))
    assert.ok(finalStatus.logs.some((entry) => entry.code === 'attempt' && entry.params.route === 'prov/m1'))
    // 按调用顺序：第一条候选 alpha、第二条 beta；草稿只进侧车索引，技能文件零改动。
    assert.equal(llmState.streamCalls.length, 2)
    assert.match(llmState.streamCalls[0].messages[0].content[0].text, /Alpha body/)
    assert.match(llmState.streamCalls[1].messages[0].content[0].text, /Beta body/)
    // run 时刻下发的 lang 定格整批补全语言：两条都走简体中文模板。
    assert.match(llmState.streamCalls[0].system, /MUST be written in Simplified Chinese/)
    assert.match(llmState.streamCalls[1].system, /MUST be written in Simplified Chinese/)
    assert.equal(await readFile(join(workspace, '.dsh', 'skills', 'alpha', 'SKILL.md'), 'utf8'), SKILL_FILE_ALPHA)
    assert.equal(await readFile(join(agentsHome, 'skills', 'beta.md'), 'utf8'), SKILL_FILE_BETA)
    const index = JSON.parse(await readFile(join(dshHome, 'dsh-service-skills-index.json'), 'utf8'))
    assert.equal(index.version, 2)
    assert.equal(Object.keys(index.entries).length, 2)
    for (const record of Object.values(index.entries)) {
      assert.match(record.note.description, /(Delta|Gamma) desc/)
      assert.equal(typeof record.bodyHash, 'string')
    }
    // 二次规划：两条都已注释，不再进候选，但单列为 annotated（注释过≠不能再次补全）。
    const replanned = await handler('skills-batch-plan', { provider: 'prov', model: 'm1' })
    assert.equal(replanned.ok, true)
    assert.equal(replanned.value.candidates.length, 0)
    assert.deepEqual(replanned.value.annotated.map((candidate) => candidate.name), ['alpha', 'beta'])
    // 未显式确认的强制覆盖被拒绝：计划保持 planned、零 LLM 调用。
    const rejected = await handler('skills-batch-run', { planId: replanned.value.planId, lang: 'zh' })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.error, 'annotated-confirm-required')
    assert.equal(llmState.streamCalls.length, 2)
    assert.equal((await handler('skills-batch-status', {})).value.phase, 'planned')
    // 显式确认后强制重跑：已注释条目被覆盖、进度按合并清单计。
    const forced = await handler('skills-batch-run', { planId: replanned.value.planId, lang: 'zh', forceAnnotated: true })
    assert.equal(forced.ok, true)
    let forcedStatus = null
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const status = await handler('skills-batch-status', {})
      if (status.value.phase !== 'running') {
        forcedStatus = status.value
        assert.equal(status.value.phase, 'done')
        assert.equal(status.value.done, 2)
        assert.equal(status.value.failures.length, 0)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.notEqual(forcedStatus, null)
    assert.equal(llmState.streamCalls.length, 4)
    assert.match(llmState.streamCalls[2].messages[0].content[0].text, /Alpha body/)
    assert.match(llmState.streamCalls[3].messages[0].content[0].text, /Beta body/)
    const overwritten = JSON.parse(await readFile(join(dshHome, 'dsh-service-skills-index.json'), 'utf8'))
    const notes = Object.values(overwritten.entries).map((record) => record.note.description)
    assert.ok(notes.includes('Alpha redone') && notes.includes('Beta redone'))
    // 技能文件依旧零改动；两名条目保持已注释（覆盖后仍是注释态，不会再次进未确认候选）。
    assert.equal(await readFile(join(workspace, '.dsh', 'skills', 'alpha', 'SKILL.md'), 'utf8'), SKILL_FILE_ALPHA)
    assert.equal(await readFile(join(agentsHome, 'skills', 'beta.md'), 'utf8'), SKILL_FILE_BETA)
  })
})

test('skill pure helpers: loose booleans, draft sanitizing, and multi-line description splice', () => {
  assert.equal(evaluateSkillFile('no frontmatter').invalid, 'missing-frontmatter')
  assert.equal(evaluateSkillFile('---\nname: Bad Name\ndescription: x\n---\nb').invalid, 'invalid-name')
  assert.equal(evaluateSkillFile('---\nname: ok\n---\nb').invalid, 'missing-description')
  assert.deepEqual(evaluateSkillFile(SKILL_FILE_BETA).invocation, { modelInvocable: true, userInvocable: true, legacyKeys: [] })

  const draft = extractSkillDraftJson('noise {"description":"a\\nb\u0000c","whenToUse":"u"} trailing')
  // 裸 NUL 在 parse 前剥除，\n 转义解析后折叠为单个空格。
  assert.equal(draft.description, 'a bc')
  assert.throws(() => extractSkillDraftJson('{"description":"   "}'))

})

test('a directory hit by both the workspace and user root rules is scanned once under the higher-priority source', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-skills-dup-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-skills-dup-ws-'))
  t.after(() => Promise.all([
    rm(dshHome, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ]))
  await mkdir(join(workspace, '.agents', 'skills'), { recursive: true })
  await writeFile(join(workspace, '.agents', 'skills', 'beta.md'), SKILL_FILE_BETA)
  const { handler } = createHost({
    services: { workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] } },
    env: { DSH_HOME: dshHome },
  })
  // HOME 指向工作区父目录的部署里，~/.agents/skills 与 <workspace>/.agents/skills 是同一目录：
  // 必须只出一组候选（project-agents 赢），而不是双份互标遮蔽。
  await withAgentsHome(join(workspace, '.agents'), async () => {
    const listed = await handler('skills-list', {})
    assert.equal(listed.ok, true)
    const betas = listed.value.entries.filter((entry) => entry.name === 'beta')
    assert.equal(betas.length, 1)
    assert.equal(betas[0].source, 'project-agents')
    assert.equal(betas[0].shadowed, false)
    const agentRoots = listed.value.roots.filter((root) => root.source === 'project-agents' || root.source === 'user-agents')
    assert.equal(agentRoots.length, 1)
    assert.equal(agentRoots[0].source, 'project-agents')
  })
})

test('skills-describe surfaces empty-output finish reasons and recovers via bigger budget or whole-block fallback', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-skills-empty-home-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-service-skills-empty-ws-'))
  t.after(() => Promise.all([
    rm(dshHome, { recursive: true, force: true }),
    rm(workspace, { recursive: true, force: true }),
  ]))
  await mkdir(join(workspace, '.agents', 'skills'), { recursive: true })
  await writeFile(join(workspace, '.agents', 'skills', 'beta.md'), SKILL_FILE_BETA)
  // 响应脚本：第一轮只给推理流并以 max-tokens 截断；重试（4 倍预算）返回正文。
  const llmState = { streamCalls: [] }
  const buildLlm = (responses) => ({
    listProviders: () => [{ id: 'prov', name: 'Provider' }],
    listModels: async () => [{ id: 'm1', name: 'Model One' }],
    stream(options) {
      llmState.streamCalls.push(options)
      const response = responses.shift()
      return (async function* generate() {
        if (response === '__REASONING_TRUNCATED__') {
          yield { type: 'reasoning-delta', index: 0, text: 'thinking...' }
          yield { type: 'finish', reason: { kind: 'max-tokens' } }
          return
        }
        if (response && response.__BLOCK__) {
          yield { type: 'block-end', index: 0, block: { type: 'text', text: response.__BLOCK__ } }
          yield { type: 'finish', reason: { kind: 'stop' } }
          return
        }
        yield { type: 'text-delta', index: 0, text: response }
      })()
    },
  })

  const { handler } = createHost({
    services: {
      workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] },
      llm: buildLlm(['__REASONING_TRUNCATED__', '__REASONING_TRUNCATED__', '{"description":"恢复后的中文描述","whenToUse":"恢复后的用法"}']),
      agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'm1' }) },
    },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(join(workspace, '.agents'), async () => {
    const listed = await handler('skills-list', {})
    const beta = listed.value.entries.find((entry) => entry.name === 'beta')
    const described = await handler('skills-describe', { id: beta.id, provider: 'prov', model: 'm1' })
    assert.equal(described.ok, true)
    assert.deepEqual(described.value.draft, { description: '恢复后的中文描述', usage: '恢复后的用法' })
    const entries = (await handler('skills-describe-log', { id: beta.id })).value.logs
    const byCode = (code) => entries.filter((entry) => entry.code === code)
    const finishEntry = byCode('finish-reasoning-only')[0]
    assert.equal(finishEntry.params.kind, 'max-tokens')
    assert.equal(llmState.streamCalls.length, 3)
    assert.equal(byCode('attempt')[2].params.n, 3)
    assert.match(byCode('failed-retry')[0].params.message, /^empty-output:max-tokens$/)
    assert.notEqual(byCode('parsed')[0], undefined)

    // 整块兜底：适配器不发 text-delta 时从 block-end 提取。
    const fallbackHost = createHost({
      services: {
        workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] },
        llm: buildLlm([{ __BLOCK__: '{"description":"整块描述","whenToUse":""}' }]),
        agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'm1' }) },
      },
      env: { DSH_HOME: dshHome },
    })
    const described2 = await fallbackHost.handler('skills-describe', { id: beta.id, provider: 'prov', model: 'm1' })
    assert.equal(described2.ok, true)
    assert.equal(described2.value.draft.description, '整块描述')
  })
})

test('skills-batch-plan validates the model route against the whitelist', async (t) => {
  const { dshHome, workspace, agentsHome } = await createSkillFixture(t)
  const { handler } = createHost({
    services: {
      workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] },
      llm: skillLlmMock({ streamCalls: [], responses: [] }),
      agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'm1' }) },
    },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(agentsHome, async () => {
    // 白名单外的 provider/model 组合拒绝：批量路由与单条 describe 同一道闸。
    assert.equal((await handler('skills-batch-plan', { provider: 'other', model: 'm1' })).error, 'invalid-model-route')
    assert.equal((await handler('skills-batch-plan', { provider: 'prov', model: 'nope' })).error, 'invalid-model-route')
    const planned = await handler('skills-batch-plan', { provider: 'prov', model: 'm1' })
    assert.equal(planned.ok, true)
  })
})

test('skills-batch-cancel interrupts the in-flight LLM call and settles without retrying', async (t) => {
  const { dshHome, workspace, agentsHome } = await createSkillFixture(t)
  const streamCalls = []
  const llm = {
    listProviders: () => [{ id: 'prov', name: 'Provider' }],
    listModels: async () => [{ id: 'm1', name: 'Model One' }],
    stream(options) {
      streamCalls.push(options)
      // 挂起直到 signal 中断：模拟一条慢生成。
      return (async function* () {
        await new Promise((resolve, reject) => {
          if (options.signal?.aborted) { reject(new Error('batch-cancelled')); return }
          options.signal?.addEventListener('abort', () => reject(new Error('batch-cancelled')))
        })
      })()
    },
  }
  const { handler } = createHost({
    services: {
      workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] },
      llm,
      agentDefaultModel: { currentSelection: () => ({ provider: 'prov', model: 'm1' }) },
    },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(agentsHome, async () => {
    const planned = await handler('skills-batch-plan', { provider: 'prov', model: 'm1' })
    assert.equal((await handler('skills-batch-run', { planId: planned.value.planId })).ok, true)
    // 等第一条进入在途（stream 调用发生）再取消。
    for (let attempt = 0; attempt < 100 && streamCalls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.equal(streamCalls.length, 1)
    const cancelled = await handler('skills-batch-cancel', {})
    assert.equal(cancelled.ok, true)
    let settled = null
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = await handler('skills-batch-status', {})
      if (status.value.phase !== 'running') { settled = status.value; break }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    // 取消中断在途调用：批次落为 cancelled、零完成、不重试、不记条目失败。
    assert.notEqual(settled, null)
    assert.equal(settled.phase, 'cancelled')
    assert.equal(settled.done, 0)
    assert.equal(settled.failures.length, 0)
    assert.equal(streamCalls.length, 1)
    // 未带 lang 的批量运行按英文模板兜底。
    assert.match(streamCalls[0].system, /MUST be written in English/)
  })
})

test('concurrent skills-note-save writes are serialized and both persist', async (t) => {
  const { dshHome, workspace, agentsHome } = await createSkillFixture(t)
  const { handler } = createHost({
    services: { workspaceRegistry: { list: () => [{ id: 'ws', path: workspace }] } },
    env: { DSH_HOME: dshHome },
  })
  await withAgentsHome(agentsHome, async () => {
    const listed = await handler('skills-list', {})
    const alpha = listed.value.entries.find((entry) => entry.name === 'alpha' && entry.source === 'project-dsh')
    const beta = listed.value.entries.find((entry) => entry.name === 'beta')
    // 并发保存两条注释：写队列串行化后磁盘上两条都在（旧实现互相覆盖会丢一条）。
    await Promise.all([
      handler('skills-note-save', { id: alpha.id, patch: { description: 'A 注释', usage: '' } }),
      handler('skills-note-save', { id: beta.id, patch: { description: 'B 注释', usage: '' } }),
    ])
    const index = JSON.parse(await readFile(join(dshHome, 'dsh-service-skills-index.json'), 'utf8'))
    const notes = Object.values(index.entries).map((record) => record.note.description).sort()
    assert.deepEqual(notes, ['A 注释', 'B 注释'])
  })
})

// ─── v0.24 CLIProxyAPI 账号额度（cliproxy 管理面）───────────────────────────

const CLIPROXY_CODEX_FIXTURE = {
  rate_limit: {
    primary_window: { used_percent: 42.6, reset_at: 1756000000, limit_window_seconds: 18000 },
    secondary_window: { used_percent: 7, reset_at: 1756500000, limit_window_seconds: 604800 },
  },
  plan_type: 'team',
}
const CLIPROXY_GEMINI_BUCKETS_FIXTURE = {
  buckets: [
    { modelId: 'gemini-2.5-pro', remainingFraction: 0.9, resetTime: '2026-09-01T00:00:00Z' },
    { modelId: 'gemini-2.5-flash', remainingFraction: 1, resetTime: '2026-09-01T00:00:00Z' },
    { modelId: 'broken-no-fraction' },
  ],
}

test('cliproxy upstream parsers fold codex/gemini/antigravity shapes into used-percent windows', () => {
  // Codex：used_percent 已用口径 + unix 秒重置；缺字段的窗口跳过。
  const codex = normalizeCodexRateLimit(CLIPROXY_CODEX_FIXTURE.rate_limit)
  // 桶位由 limit_window_seconds 推导（18000→5h、604800→week），已用多的排前面。
  assert.deepEqual(codex.map((w) => [w.kindKey, w.percent]), [['codex-5h', 43], ['codex-week', 7]])
  assert.equal(codex[0].resetsAt, new Date(1756000000 * 1000).toISOString())
  assert.equal(normalizeCodexRateLimit(null).length, 0)
  assert.deepEqual(normalizeCodexRateLimit({ primary_window: { used_percent: 'NaN-ish' } }), [])
  // 用户实测踩中的形状：主槽位本身就是周额度（604800s），secondary 为 null。
  const weeklyPrimary = normalizeCodexRateLimit({ primary_window: { used_percent: 12, reset_at: 1756000000, limit_window_seconds: 604800 }, secondary_window: null })
  assert.deepEqual(weeklyPrimary.map((w) => [w.id, w.kindKey, w.percent]), [['codex-week', 'codex-week', 12]])
  // 缺窗口长度时回退位置命名。
  assert.deepEqual(normalizeCodexRateLimit({ primary_window: { used_percent: 1 } }).map((w) => w.kindKey), ['codex-primary'])

  // GeminiCLI：remainingFraction∈[0,1] 折算已用%（clamp 不启发式），剩得最少的排前面。
  const gemini = normalizeGeminiBuckets(CLIPROXY_GEMINI_BUCKETS_FIXTURE.buckets)
  assert.deepEqual(gemini.map((w) => [w.id, w.kindKey, w.percent]), [
    ['gemini-2-5-pro', 'gemini-2.5-pro', 10],
    ['gemini-2-5-flash', 'gemini-2.5-flash', 0],
  ])
  assert.equal(gemini[0].resetsAt, '2026-09-01T00:00:00.000Z')
  // 越界 clamp：1.7 视为满、-0.5 视为空。
  assert.deepEqual(normalizeGeminiBuckets([{ modelId: 'x', remainingFraction: 1.7 }]).map((w) => w.percent), [0])
  assert.deepEqual(normalizeGeminiBuckets([{ modelId: 'x', remainingFraction: -0.5 }]).map((w) => w.percent), [100])
  assert.equal(normalizeGeminiBuckets('nope').length, 0)

  // Antigravity：models{}.quotaInfo（camel/snake 双形态），同样按剩余升序。
  const antigravity = normalizeAntigravityModels({
    'claude-sonnet-4-5': { quotaInfo: { remainingFraction: 0.25, resetTime: 1756000000 } },
    'gpt-oss-120b-medium': { quota_info: { remaining_fraction: 0.5 } },
    broken: {},
  })
  assert.deepEqual(antigravity.map((w) => [w.kindKey, w.percent]), [['claude-sonnet-4-5', 75], ['gpt-oss-120b-medium', 50]])})

test('cliproxy api-call envelope and account plan builders follow the management contract', () => {
  // 信封解包：body 字符串 / 对象 / 坏 JSON / 非对象。
  assert.deepEqual(unwrapCliproxyApiCallEnvelope({ status_code: 200, body: '{"a":1}' }), { statusCode: 200, payload: { a: 1 } })
  assert.deepEqual(unwrapCliproxyApiCallEnvelope({ status_code: '200', body: { a: 1 } }), { statusCode: 200, payload: { a: 1 } })
  assert.deepEqual(unwrapCliproxyApiCallEnvelope({ status_code: 200, body: 'not-json{' }), { statusCode: 200, payload: null })
  assert.deepEqual(unwrapCliproxyApiCallEnvelope({ status_code: 403, body: '"x"' }), { statusCode: 403, payload: null })
  assert.deepEqual(unwrapCliproxyApiCallEnvelope(null), { statusCode: 0, payload: null })

  // project 提取：条目字段优先，回落文件名 gemini-{email}-{project}.json。
  assert.equal(cliproxyProjectFor({ project_id: ' direct-project ', name: 'gemini-x@gmail.com-file-name.json' }), 'direct-project')
  assert.equal(cliproxyProjectFor({ name: 'gemini-user@gmail.com-focused-brace-480503-c1.json' }), 'focused-brace-480503-c1')
  assert.equal(cliproxyProjectFor({ name: 'codex-something.json' }), '')
  assert.equal(cliproxyProjectFor({ name: 'gemini-nodash@local' }), '')

  // 计划构建：codex GET wham、antigravity 三候选带 UA、gemini 带 project、其余不支持。
  const codexPlan = buildCliproxyAccountPlan({ provider: 'codex' })
  assert.equal(codexPlan.calls.length, 1)
  assert.equal(codexPlan.calls[0].method, 'GET')
  assert.ok(codexPlan.calls[0].url.includes('chatgpt.com/backend-api/wham/usage'))
  assert.equal(codexPlan.calls[0].header.Authorization, 'Bearer $TOKEN$')
  const antigravityPlan = buildCliproxyAccountPlan({ type: 'antigravity' })
  assert.equal(antigravityPlan.calls.length, 3)
  assert.ok(antigravityPlan.calls.every((call) => call.method === 'POST' && call.data === '{}'))
  assert.match(antigravityPlan.calls[0].header['User-Agent'], /antigravity\//)
  const geminiPlan = buildCliproxyAccountPlan({ provider: 'gemini-cli', name: 'gemini-u@gmail.com-p1.json' })
  assert.deepEqual(JSON.parse(geminiPlan.calls[0].data), { project: 'p1' })
  assert.equal(buildCliproxyAccountPlan({ provider: 'gemini-cli', name: 'no-project.json' }), null)
  assert.equal(buildCliproxyAccountPlan({ provider: 'claude' }), null)
  assert.equal(buildCliproxyAccountPlan({}), null)
})

test('cliproxy origin guard and pin derivation reject unsafe baseURLs', () => {
  // 钉住派生：HTTPS + DNS 域名 + 默认端口才收；IP/明文/自定义端口/userinfo 一律拒。
  assert.equal(cliproxyPinHostFromBaseURL('https://cli.example.org/api'), 'cli.example.org')
  assert.equal(cliproxyPinHostFromBaseURL('https://cli.example.org:443/'), 'cli.example.org')
  assert.equal(cliproxyPinHostFromBaseURL('https://CLI.Example.Org./api'), 'cli.example.org')
  assert.equal(cliproxyPinHostFromBaseURL('http://cli.example.org/api'), undefined)
  assert.equal(cliproxyPinHostFromBaseURL('https://127.0.0.1:8317'), undefined)
  // IP 字面量的非十进制编码：十六进制（整体/逐段）、纯整数、八进制标签都能被 getaddrinfo
  // 解析成 IP（实测 0x7f000001 → 127.0.0.1），钉住派生与外呼守卫一律拒收。
  assert.equal(cliproxyPinHostFromBaseURL('https://0x7f000001'), undefined)
  assert.equal(cliproxyPinHostFromBaseURL('https://0x7f.0.0.1/api'), undefined)
  assert.equal(cliproxyPinHostFromBaseURL('https://2130706433'), undefined)
  assert.equal(cliproxyPinHostFromBaseURL('https://0177.0.0.1'), undefined)
  // 数字标签混在真域名里不是 IP（nip.io 这类通配 DNS 服务仍可用）。
  assert.equal(cliproxyPinHostFromBaseURL('https://127.0.0.1.nip.io'), '127.0.0.1.nip.io')
  assert.equal(cliproxyPinHostFromBaseURL('https://user:pass@cli.example.org'), undefined)
  assert.equal(cliproxyPinHostFromBaseURL('https://cli.example.org:8443'), undefined)
  assert.equal(cliproxyPinHostFromBaseURL('not a url'), undefined)

  // origin 守卫：精确命中钉住表才放行；子域不算命中（不做子串猜测）。
  const pinned = ['cli.example.org']
  assert.equal(safeCliproxyOrigin('https://cli.example.org/api', pinned), 'https://cli.example.org')
  assert.equal(safeCliproxyOrigin('https://evil.cli.example.org/api', pinned), undefined)
  assert.equal(safeCliproxyOrigin('https://cli.example.org.attacker.example/', pinned), undefined)
  assert.equal(safeCliproxyOrigin('https://cli.example.org', []), undefined)
  // 守卫同样拒收十六进制 IP 编码（即使手工把这种条目写进钉住表也不放行）。
  assert.equal(safeCliproxyOrigin('https://0x7f000001', ['0x7f000001']), undefined)

  // fetch 守卫：baseURL 缺失 → no-base-url；未钉/失配 → host-not-pinned；命中 → 放行。
  assert.equal(cliproxyFetchGuard({ name: 'cpa', baseURL: '' }, {}), 'no-base-url')
  assert.equal(cliproxyFetchGuard({ name: 'cpa', baseURL: 'https://cli.example.org' }, { allowedHosts: {} }), 'host-not-pinned')
  assert.equal(cliproxyFetchGuard({ name: 'cpa', baseURL: 'https://other.example.org' }, { allowedHosts: { cpa: ['cli.example.org'] } }), 'host-not-pinned')
  assert.equal(cliproxyFetchGuard({ name: 'cpa', baseURL: 'https://cli.example.org/x' }, { allowedHosts: { cpa: ['cli.example.org'] } }), null)
})

/** https.request 桩：按 URL/方法返回固定信封；记录全部请求供断言。
 * 注意在请求创建时同步捕获条目：并发请求的 nextTick 回调乱序到达，事后取末尾元素会串话。 */
function stubHttpsRequest(t, handler) {
  const originalRequest = https.request
  const requests = []
  https.request = (url, options, callback) => {
    const entry = { url: String(url), method: options.method || 'GET', auth: options.headers?.Authorization, cookie: options.headers?.Cookie, headers: options.headers }
    requests.push(entry)
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    response.resume = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    request.write = (chunk) => { entry.body = String(chunk) }
    request.end = () => {
      process.nextTick(async () => {
        const outcome = await handler(entry)
        response.statusCode = outcome.status ?? 200
        callback(response)
        if (outcome.payload !== undefined) response.emit('data', JSON.stringify(outcome.payload))
        response.emit('end')
      })
    }
    return request
  }
  t.after(() => { https.request = originalRequest })
  return requests
}

const CLIPROXY_FILES = {
  files: [
    { auth_index: 'idx-codex', provider: 'codex', email: 'codex-user@example.com', name: 'codex-user@example.com.json' },
    { auth_index: 'idx-gemini', provider: 'gemini-cli', email: 'gm@gmail.com', name: 'gemini-gm@gmail.com-my-prj.json' },
    { auth_index: 'idx-claude', provider: 'claude', email: 'cl@example.com' }, // 不支持 → 跳过
    { auth_index: 'idx-qwen', provider: 'qwen', disabled: true },               // 禁用 → 跳过
    { provider: 'antigravity' },                                                // 缺 auth_index → 跳过
  ],
}

test('cliproxy RPC merges per-account windows via the management plane without touching the proxy key', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-cpa-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({
    version: 1,
    kinds: { cpa: 'cliproxy' },
    allowedHosts: { cpa: ['cli.example.org'] },
  }))
  const resolvedNames = []
  const host = createHost({
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { cpa: { displayName: 'CPA', baseURL: 'https://cli.example.org/api', apiKeyEnv: 'CPA_API_KEY' } } } : undefined) },
      // 凭据服务按名字区分：管理密钥线索命中 mgmt-secret；代理 key 线索若被误试则记录下来。
      credentials: { resolve: async (name) => {
        resolvedNames.push(name)
        return name === 'CPA_MANAGEMENT_KEY' ? { value: 'mgmt-secret' } : { value: 'proxy-key-value' }
      } },
    },
  })
  const requests = stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/v0/management/auth-files')) return { payload: CLIPROXY_FILES }
    const body = JSON.parse(request.body ?? '{}')
    if (body.url === 'https://chatgpt.com/backend-api/wham/usage') {
      return { payload: { status_code: 200, header: {}, body: JSON.stringify(CLIPROXY_CODEX_FIXTURE) } }
    }
    if (body.url === 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota') {
      return { payload: { status_code: 200, body: CLIPROXY_GEMINI_BUCKETS_FIXTURE } } // 对象形态 body 也兼容
    }
    return { status: 500 }
  })

  const first = await host.handler('quota', {})
  assert.equal(first.ok, true)
  await waitFor(() => requests.filter((r) => r.url.endsWith('/api-call')).length >= 2, 'two api-calls')
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))

  // 凭据发现只试管理密钥线索——代理 key（apiKeyEnv）绝不发往管理面（fail2ban 教训写进实现）。
  assert.deepEqual(resolvedNames, ['CPA_MANAGEMENT_KEY'])
  assert.ok(requests.length >= 3)
  assert.ok(requests.every((request) => request.auth === 'Bearer mgmt-secret'))

  const row = (await host.handler('quota', {})).value.providers.find((entry) => entry.provider === 'cpa')
  assert.equal(row.status, 'ok')
  assert.equal(row.kind, 'cliproxy')
  assert.equal(row.kindSource, 'config')
  assert.equal(row.credentialEntryKey, 'editManagement')
  const byKind = new Map(row.windows.map((window) => [window.kindKey, window]))
  assert.equal(byKind.get('codex-5h').percent, 43)
  assert.equal(byKind.get('codex-5h').label, 'codex-user@example.com')
  assert.equal(byKind.get('codex-5h').resetsAt, new Date(1756000000 * 1000).toISOString())
  assert.deepEqual(row.windows.filter((window) => window.label === 'gm@gmail.com').map((window) => window.percent).sort(), [0, 10])
  // api-call 请求体走管理契约：auth_index + $TOKEN$ 头由 CPA 代换。
  const codexCall = JSON.parse(requests.find((request) => request.body?.includes('wham/usage'))?.body ?? '{}')
  assert.equal(codexCall.auth_index, 'idx-codex')
  assert.equal(codexCall.header.Authorization, 'Bearer $TOKEN$')
})

test('cliproxy RPC surfaces mgmt-disabled and host-not-pinned as stable error codes', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-cpa-err-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({
    version: 1,
    kinds: { cpa: 'cliproxy', unpinned: 'cliproxy' },
    allowedHosts: { cpa: ['cli.example.org'] },
  }))
  let authFilesStatus = 404
  const requests = stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/v0/management/auth-files')) return { status: authFilesStatus }
    return {}
  })
  const host = createHost(quotaHostOverrides(dshHome, {
    cpa: { baseURL: 'https://cli.example.org' },
    unpinned: { baseURL: 'https://moved.example.org' },
  }, 'mgmt-secret'))
  await host.handler('quota', {})
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
  const rows = (await host.handler('quota', {})).value.providers
  const cpaRow = rows.find((row) => row.provider === 'cpa')
  assert.equal(cpaRow.status, 'error')
  assert.equal(cpaRow.errorCode, 'mgmt-disabled') // secret-key 为空时 CPA 管理路由整体 404
  const unpinnedRow = rows.find((row) => row.provider === 'unpinned')
  assert.equal(unpinnedRow.status, 'error')
  assert.equal(unpinnedRow.errorCode, 'host-not-pinned') // baseURL 与钉住域失配 → 明确提示重新适配
  assert.ok(requests.every((request) => !request.url.includes('moved.example.org'))) // 未钉住的域从未被打
})

test('quota-config pins the cliproxy domain on save and clears it with the kind', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-cpa-pin-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const host = createHost(quotaHostOverrides(dshHome, {
    cpa: { baseURL: 'https://pin.example.org/base' },
    plain: { baseURL: 'http://insecure.example.org' },
    empty: { baseURL: '' },
  }, 'k'))
  const saved = await host.handler('quota-config', { provider: 'cpa', kind: 'cliproxy' })
  assert.equal(saved.ok, true)
  let config = JSON.parse(await readFile(join(dshHome, 'dsh-service-quota.json'), 'utf8'))
  assert.deepEqual(config.allowedHosts.cpa, ['pin.example.org']) // 服务端从 settings 派生，浏览器零输入

  // 明文 http 与缺失 baseURL 分别拒绝，且不留半截钉住记录。
  assert.equal((await host.handler('quota-config', { provider: 'plain', kind: 'cliproxy' })).error, 'unsafe-provider-endpoint')
  assert.equal((await host.handler('quota-config', { provider: 'empty', kind: 'cliproxy' })).error, 'no-base-url')

  // 显式停用摘除钉住记录；clear 同样摘除。
  await host.handler('quota-config', { provider: 'cpa', kind: null })
  config = JSON.parse(await readFile(join(dshHome, 'dsh-service-quota.json'), 'utf8'))
  assert.equal(config.allowedHosts.cpa, undefined)
  await host.handler('quota-config', { provider: 'cpa', kind: 'cliproxy' })
  await host.handler('quota-config', { provider: 'cpa', clear: true })
  config = JSON.parse(await readFile(join(dshHome, 'dsh-service-quota.json'), 'utf8'))
  assert.equal(config.allowedHosts.cpa, undefined)
  // 换成非管理面 kind 时旧钉住记录一并清理。
  await host.handler('quota-config', { provider: 'cpa', kind: 'openrouter' }).catch(() => {})
  config = JSON.parse(await readFile(join(dshHome, 'dsh-service-quota.json'), 'utf8'))
  assert.equal(config.allowedHosts.cpa, undefined)
})

test('resetGates clears backoff and cooldown so a saved credential retries immediately', async (t) => {
  // 单元口径：force 保留失败退避（防手动按钮打爆上游），resetGates 只由宿主写入口触发、连硬冷却一起清。
  const throttle = createQuotaThrottle({ successTtlMs: 0, minIntervalMs: 15_000, backoffBaseMs: 30_000, backoffMaxMs: 60_000 })
  const now = 900_000
  assert.equal(throttle.attempt('p', now).ok, true)
  throttle.settle('p', { ok: false, code: 'http-status:401' }, now)
  assert.equal(throttle.force('p', now + 1).reason, 'backoff')          // 手动刷新仍要等退避
  assert.equal(throttle.attempt('p', now + 1).reason, 'backoff')
  throttle.resetGates('p')
  assert.equal(throttle.attempt('p', now + 2).ok, true)                 // 换凭据后立即放行

  // 单飞在途不抢占，等本轮自然落定。
  assert.equal(throttle.attempt('q', now).ok, true)
  assert.equal(throttle.resetGates('q').reason, 'inflight')
})

test('saving a credential clears the gates and the next snapshot fires upstream right away', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-cred-retry-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({ version: 1, kinds: { mimo: 'xiaomi-token-plan-cn' } }))
  let cookieValue = 'stale-cookie'
  let healthy = false
  const credCalls = []
  const host = createHost({
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { mimo: { displayName: 'MiMo', baseURL: '', apiKeyEnv: 'MIMO_TP_KEY' } } } : undefined) },
      credentials: {
        resolve: async () => ({ value: cookieValue }),
        describe: async (name) => ({ name, configured: name === 'XIAOMI_MIMO_CONSOLE_COOKIE' }),
        set: async (name, value) => { credCalls.push([name, value]); cookieValue = value },
      },
    },
  })
  const requests = stubHttpsRequest(t, (request) => {
    if (!healthy) return { status: 401 }
    if (request.url.endsWith('/tokenPlan/detail')) return { payload: XIAOMI_DETAIL_FIXTURE }
    if (request.url.endsWith('/tokenPlan/usage')) return { payload: XIAOMI_USAGE_FIXTURE }
    return { status: 404 }
  })

  // 第一轮：Cookie 失效 → 失败退避（30 秒起步）。
  await host.handler('quota', {})
  await waitFor(() => requests.length >= 1, 'first attempt')
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))

  // 存入新 Cookie：宿主清闸。不走真实时钟——若闸门没清，下面的快照 kick 会因退避被拒。
  healthy = true
  const saved = await host.handler('quota-credential-set', { provider: 'mimo', name: 'XIAOMI_MIMO_CONSOLE_COOKIE', value: 'fresh-cookie' })
  assert.equal(saved.ok, true)
  assert.deepEqual(credCalls, [['XIAOMI_MIMO_CONSOLE_COOKIE', 'fresh-cookie']])

  await host.handler('quota', {})
  await waitFor(() => requests.length >= 3, 'immediate retry detail+usage')
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
  const row = (await host.handler('quota', {})).value.providers.find((entry) => entry.provider === 'mimo')
  assert.equal(row.status, 'ok')
  assert.ok(requests.slice(-2).every((request) => request.cookie === 'fresh-cookie')) // 重试带着新值
})

test('fetchCliproxyUsage tolerates partial account failures and enforces the call budget', async (t) => {
  const profile = { name: 'cpa', baseURL: 'https://cli.example.org' }
  const context = { allowedHosts: { cpa: ['cli.example.org'] } }
  const credential = 'Bearer mgmt-secret'
  const manyFiles = {
    files: Array.from({ length: 12 }, (_, index) => ({
      auth_index: `idx-${index}`,
      provider: 'codex',
      email: `u${index}@example.com`,
    })),
  }

  // 全部上游失败：抛首个稳定错误码（upstream-status）。
  stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/auth-files')) return { payload: manyFiles }
    return { payload: { status_code: 500, body: 'boom' } }
  })
  await assert.rejects(fetchCliproxyUsage({ profile, config: context, credential, signal: undefined }), (error) => quotaErrorCode(error) === 'upstream-status')

  // 部分失败：一个账号上游 403，其余成功 → 返回成功账号窗口，不拖垮整行。
  let firstCallSeen = false
  const partialRequests = stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/auth-files')) return { payload: { files: manyFiles.files.slice(0, 3) } }
    const body = JSON.parse(request.body ?? '{}')
    if (body.auth_index === 'idx-0' && !firstCallSeen) {
      firstCallSeen = true
      return { payload: { status_code: 403, body: '{}' } }
    }
    return { payload: { status_code: 200, body: JSON.stringify(CLIPROXY_CODEX_FIXTURE) } }
  })
  const windows = await fetchCliproxyUsage({ profile, config: context, credential, signal: undefined })
  assert.ok(windows.length >= 4) // idx-1 与 idx-2 各两窗
  assert.equal(new Set(windows.map((window) => window.label)).has('u0@example.com'), false)

  // 预算上限：账号数截到 8、api-call 总次数 ≤12。
  const budgetRequests = stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/auth-files')) return { payload: manyFiles }
    return { payload: { status_code: 200, body: JSON.stringify(CLIPROXY_CODEX_FIXTURE) } }
  })
  const okWindows = await fetchCliproxyUsage({ profile, config: context, credential, signal: undefined })
  assert.equal(budgetRequests.filter((request) => request.url.endsWith('/api-call')).length <= 12, true)
  assert.equal(okWindows.length <= 32, true)
})

test('fetchCliproxyUsage keeps window ids unique when codex windows collide on the same bucket code', async (t) => {
  const profile = { name: 'cpa', baseURL: 'https://cli.example.org' }
  const context = { allowedHosts: { cpa: ['cli.example.org'] } }
  // 两窗恰好同秒长度（都折算 codex-5h 桶码）：解析器会产出同码窗口，合并器必须保 id 唯一
  // ——重复 id 会复制 React key/testid；kindKey 不动，展示名仍按窗口码本地化。
  const colliding = {
    rate_limit: {
      primary_window: { used_percent: 40, reset_at: 1756000000, limit_window_seconds: 18000 },
      secondary_window: { used_percent: 10, reset_at: 1756500000, limit_window_seconds: 18000 },
    },
  }
  stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/auth-files')) return { payload: { files: [{ auth_index: 'idx-0', provider: 'codex', email: 'u@example.com' }] } }
    return { payload: { status_code: 200, body: JSON.stringify(colliding) } }
  })
  const windows = await fetchCliproxyUsage({ profile, config: context, credential: 'Bearer k', signal: undefined })
  assert.equal(windows.length, 2)
  assert.deepEqual(windows.map((window) => window.id), ['u-example-com-0-codex-5h', 'u-example-com-0-codex-5h~'])
  assert.deepEqual(windows.map((window) => window.kindKey), ['codex-5h', 'codex-5h'])
})

test('fetchCliproxyUsage keeps account and Codex window order stable when calls finish out of order', async (t) => {
  const profile = { name: 'cpa', baseURL: 'https://cli.example.org' }
  const context = { allowedHosts: { cpa: ['cli.example.org'] } }
  const files = {
    files: [
      { auth_index: 'idx-a', provider: 'codex', email: 'a@example.com' },
      { auth_index: 'idx-b', provider: 'codex', email: 'b@example.com' },
    ],
  }
  const payloadFor = (authIndex) => authIndex === 'idx-a'
    ? { rate_limit: { primary_window: { used_percent: 80, limit_window_seconds: 18000 }, secondary_window: { used_percent: 10, limit_window_seconds: 604800 } } }
    : { rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18000 }, secondary_window: { used_percent: 80, limit_window_seconds: 604800 } } }
  stubHttpsRequest(t, async (request) => {
    if (request.url.endsWith('/auth-files')) return { payload: files }
    const body = JSON.parse(request.body ?? '{}')
    if (body.auth_index === 'idx-a') await new Promise((resolve) => setTimeout(resolve, 15))
    return { payload: { status_code: 200, body: JSON.stringify(payloadFor(body.auth_index)) } }
  })

  const windows = await fetchCliproxyUsage({ profile, config: context, credential: 'Bearer k', signal: undefined })
  assert.deepEqual(windows.map((window) => [window.label, window.kindKey]), [
    ['a@example.com', 'codex-5h'],
    ['a@example.com', 'codex-week'],
    ['b@example.com', 'codex-5h'],
    ['b@example.com', 'codex-week'],
  ])
})

// ─── 小米 MiMo Token Plan（xiaomi-token-plan-cn）────────────────────────────
// 形状来源：platform.xiaomimimo.com 控制台 SPA bundle（2026-09 核实）——信封 {code,message,data}、
// usage.items[] 每项 {name, percent(0..1 小数), used, limit}，与「套餐使用情况」页同源。

const XIAOMI_DETAIL_FIXTURE = {
  code: 200,
  message: 'ok',
  data: {
    planCode: 'tp_pro_monthly',
    planName: 'Pro 月度套餐',
    expired: false,
    currentPeriodEnd: '2026-06-27T23:59:59Z',
    enableAutoRenew: false,
    hasAutoRenewSubscribed: false,
    clawEnabled: false,
  },
}

const XIAOMI_USAGE_FIXTURE = {
  code: 0,
  message: 'ok',
  data: {
    usage: {
      items: [
        { name: 'total_token', percent: 0.1234, used: 1357400000, limit: 11000000000 },
        { name: 'compensation_total_token', percent: 0.05, used: 164213564, limit: 3284271284 },
      ],
    },
  },
}

test('normalizeXiaomiTokenPlanUsage maps console usage buckets into unified windows', () => {
  const windows = normalizeXiaomiTokenPlanUsage(XIAOMI_DETAIL_FIXTURE.data, XIAOMI_USAGE_FIXTURE.data)
  assert.deepEqual(windows, [
    // 套餐名是纯数据：文本窗口置顶，本地化标签在客户端词典。
    { id: 'plan', kindKey: 'plan-name', text: 'Pro 月度套餐' },
    // percent 是 0..1 小数（×100 截断取整）；used/limit 原始数值透传；resetsAt = 订阅有效期。
    { id: 'total_token', kindKey: 'total_token', percent: 12, used: 1357400000, limit: 11000000000, resetsAt: new Date('2026-06-27T23:59:59Z').toISOString() },
    { id: 'compensation_total_token', kindKey: 'compensation_total_token', percent: 5, used: 164213564, limit: 3284271284, resetsAt: new Date('2026-06-27T23:59:59Z').toISOString() },
  ])

  // 控制台同款规则：补偿积分 limit===0 不渲染；缺 percent 的桶跳过；重复 name 去重。
  const partial = normalizeXiaomiTokenPlanUsage(
    { planCode: 'x', planName: ' Standard ', expired: true, currentPeriodEnd: '2020-01-01T00:00:00Z' },
    { usage: { items: [
      { name: 'total_token', percent: 0.5, used: 5, limit: 10 },
      { name: 'compensation_total_token', percent: 0.5, used: 1, limit: 0 }, // 无补偿积分 → 丢弃
      { name: 'mystery_bucket', used: 1, limit: 2 },                          // 缺 percent → 跳过
      { name: 'total_token', percent: 0.9, used: 9, limit: 10 },              // 重复 → 去重
      'junk',                                                                  // 非对象 → 跳过
    ] } },
  )
  assert.deepEqual(partial, [
    { id: 'plan', kindKey: 'plan-name', text: 'Standard' },
    // 已失效套餐不挂 resetsAt（避免误导性的未来倒计时）。
    { id: 'total_token', kindKey: 'total_token', percent: 50, used: 5, limit: 10 },
  ])
  assert.deepEqual(normalizeXiaomiTokenPlanUsage(undefined, undefined), [])
  assert.deepEqual(normalizeXiaomiTokenPlanUsage({}, { usage: { items: 'nope' } }), [])
})

test('unwrapXiaomiConsoleEnvelope accepts success codes and rejects login/business errors stably', () => {
  assert.deepEqual(unwrapXiaomiConsoleEnvelope({ code: 0, data: { a: 1 } }), { a: 1 })
  assert.deepEqual(unwrapXiaomiConsoleEnvelope({ code: 200, data: null }), {})
  assert.throws(() => unwrapXiaomiConsoleEnvelope({ code: 401, message: 'login required' }),
    (error) => quotaErrorCode(error) === 'credential-rejected' && error.detail === 'login required')
  assert.throws(() => unwrapXiaomiConsoleEnvelope({ code: 50001, message: 'inner error' }),
    (error) => quotaErrorCode(error) === 'bad-payload' && error.detail === 'inner error')
  for (const bad of [null, 'str', {}, { data: {} }]) {
    assert.throws(() => unwrapXiaomiConsoleEnvelope(bad), (error) => quotaErrorCode(error) === 'bad-payload')
  }
})

test('fetchXiaomiTokenPlanUsage sends the session cookie to fixed endpoints only', async (t) => {
  // 成功路径：两个固定 GET 都带裸 Cookie（无 Authorization），detail 先于 usage。
  const okRequests = stubHttpsRequest(t, (request) => {
    if (request.url === 'https://platform.xiaomimimo.com/api/v1/tokenPlan/detail') return { payload: XIAOMI_DETAIL_FIXTURE }
    if (request.url === 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage') return { payload: XIAOMI_USAGE_FIXTURE }
    return { status: 404 }
  })
  const windows = await fetchXiaomiTokenPlanUsage({ credential: 'sid=abc; userId=42', signal: undefined })
  assert.equal(windows.length, 3)
  assert.ok(okRequests.every((request) => request.auth === undefined))
  assert.deepEqual(okRequests.map((request) => request.cookie), ['sid=abc; userId=42', 'sid=abc; userId=42'])

  // 粘贴带入的「Cookie:」前缀（带或不带空格）剥掉再上头。
  const prefixRequests = stubHttpsRequest(t, () => ({ payload: XIAOMI_DETAIL_FIXTURE }))
  await fetchXiaomiTokenPlanUsage({ credential: 'Cookie: sid=xyz', signal: undefined })
  assert.ok(prefixRequests.every((request) => request.cookie === 'sid=xyz'))

  // 空 Cookie（凭据链全落空后不该发生，仍防御）→ credential-missing。
  await assert.rejects(fetchXiaomiTokenPlanUsage({ credential: '', signal: undefined }),
    (error) => quotaErrorCode(error) === 'credential-missing')
})

test('fetchXiaomiTokenPlanUsage normalizes login failures and missing subscriptions', async (t) => {
  // HTTP 401（登录态失效）→ credential-rejected，别让用户对着状态码猜。
  stubHttpsRequest(t, () => ({ status: 401 }))
  await assert.rejects(fetchXiaomiTokenPlanUsage({ credential: 'sid=abc', signal: undefined }),
    (error) => quotaErrorCode(error) === 'credential-rejected')

  // HTTP 200 但信封 code:401 同样归一。
  stubHttpsRequest(t, () => ({ payload: { code: 401, message: 'not logged in' } }))
  await assert.rejects(fetchXiaomiTokenPlanUsage({ credential: 'sid=abc', signal: undefined }),
    (error) => quotaErrorCode(error) === 'credential-rejected')

  // 无订阅（detail 无 planCode 且无可用额度桶）→ 独立稳定错误码。
  stubHttpsRequest(t, (request) => request.url.endsWith('/detail')
    ? { payload: { code: 200, data: {} } }
    : { payload: { code: 200, data: { usage: { items: [] } } } })
  await assert.rejects(fetchXiaomiTokenPlanUsage({ credential: 'sid=abc', signal: undefined }),
    (error) => quotaErrorCode(error) === 'no-subscription')

  // 上游 500 维持 http-status 稳定码。
  stubHttpsRequest(t, () => ({ status: 500 }))
  await assert.rejects(fetchXiaomiTokenPlanUsage({ credential: 'sid=abc', signal: undefined }),
    (error) => quotaErrorCode(error) === 'http-status')
})

test('xiaomi-token-plan-cn RPC auto-infers from the CN gateway host and keeps the tp- key off the console plane', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-mimo-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const resolvedNames = []
  const host = createHost({
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { mimo: { displayName: 'MiMo', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', apiKeyEnv: 'MIMO_TP_KEY' } } } : undefined) },
      credentials: { resolve: async (name) => {
        resolvedNames.push(name)
        return { value: 'session-cookie-value' }
      } },
    },
  })
  const requests = stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/tokenPlan/detail')) return { payload: XIAOMI_DETAIL_FIXTURE }
    if (request.url.endsWith('/tokenPlan/usage')) return { payload: XIAOMI_USAGE_FIXTURE }
    return { status: 404 }
  })

  assert.equal(await host.handler('quota', {}).then((res) => res.ok), true)
  await waitFor(() => requests.length >= 2, 'two console calls')
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))

  // 凭据发现只试控制台 Cookie 线索——apiKeyEnv（tp- 推理密钥）绝不发往控制台平面。
  assert.deepEqual(resolvedNames, ['XIAOMI_MIMO_CONSOLE_COOKIE'])
  assert.ok(requests.every((request) => request.auth === undefined))
  assert.ok(requests.every((request) => request.cookie === 'session-cookie-value'))

  const row = (await host.handler('quota', {})).value.providers.find((entry) => entry.provider === 'mimo')
  assert.equal(row.status, 'ok')
  assert.equal(row.kind, 'xiaomi-token-plan-cn')
  assert.equal(row.kindSource, 'auto') // baseURL 宿主唯一命中自动推断
  assert.equal(row.credentialEntryKey, 'editCookie')
  assert.equal(row.usageUrl, 'https://platform.xiaomimimo.com/console/usage')
  const byId = new Map(row.windows.map((window) => [window.id, window]))
  assert.equal(byId.get('plan').text, 'Pro 月度套餐')
  assert.equal(byId.get('total_token').percent, 12)
  assert.equal(byId.get('total_token').used, 1357400000)
  assert.equal(byId.get('compensation_total_token').percent, 5)
  assert.equal(row.credentialHints, undefined) // 已配置成功的行不带凭据窗口

  // 手动适配不受 baseURL 端点检查拦截（查询平面固定，中转域/空 baseURL 也能凭 Cookie 查额度）。
  const relayHost = createHost(quotaHostOverrides(dshHome, { relay: { baseURL: '' } }, 'sid=abc'))
  const adapted = await relayHost.handler('quota-config', { provider: 'relay', kind: 'xiaomi-token-plan-cn' })
  assert.equal(adapted.ok, true)
  const config = JSON.parse(await readFile(join(dshHome, 'dsh-service-quota.json'), 'utf8'))
  assert.equal(config.kinds.relay, 'xiaomi-token-plan-cn')
})

test('xiaomi token plan card stays fillable after the console cookie is rejected', async (t) => {
  // Cookie 失效是最典型的「需要重新填入」场景：行必须保持 unconfigured 并带线索状态，
  // 否则用户面对「Cookie 已失效」错误却找不到任何填写入口（GUI 反馈回归，v0.31.2 修复）。
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-mimo-reject-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const describedNames = []
  const host = createHost({
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { mimo: { displayName: 'MiMo', baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', apiKeyEnv: 'MIMO_TP_KEY' } } } : undefined) },
      credentials: {
        resolve: async () => ({ value: 'stale-cookie' }),
        describe: async (name) => { describedNames.push(name); return { configured: true, source: 'file' } },
      },
    },
  })
  const requests = stubHttpsRequest(t, () => ({ status: 401 }))
  await host.handler('quota', {})
  await waitFor(() => requests.length >= 1, 'one console call')
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))

  const row = (await host.handler('quota', {})).value.providers.find((entry) => entry.provider === 'mimo')
  assert.equal(row.status, 'unconfigured') // 不是锁死的 error 态——凭据表单入口回来了
  assert.equal(row.errorCode, 'credential-rejected')
  assert.ok(Array.isArray(row.credentialHints) && row.credentialHints.length > 0)
  // describe 只试 Cookie 线索名，绝不试探 tp- 推理密钥槽位。
  assert.deepEqual(describedNames, ['XIAOMI_MIMO_CONSOLE_COOKIE', 'MIMO_CONSOLE_COOKIE'])
})

// ─── StepFun（v0.38）：余额（/v1/accounts）+ Step Plan 订阅（控制台 BFF）────────────────

const STEPFUN_ACCOUNTS_FIXTURE = { object: 'account', type: 'prepaid', balance: 123.45, total_cash_balance: 120.0, total_voucher_balance: 3.45 }
// 旧版 Token Plan：5h/周滚动窗口，left_rate 是 0..1 剩余比例；reset_time 字符串/整数皆可。
const STEPFUN_RATE_LIMIT_LEGACY_FIXTURE = {
  status: 1,
  five_hour_usage_left_rate: 1,
  weekly_usage_left_rate: 0.8,
  five_hour_usage_reset_time: '1777528800',
  weekly_usage_reset_time: 1780000000,
}
// 新版 Credit 月池（plan_family=2）：窗口字段为 0/"0"（无窗口，不是用光）；额度在 plan_credit_rate_limit。
const STEPFUN_RATE_LIMIT_CREDIT_FIXTURE = {
  status: 1,
  plan_family: 2,
  five_hour_usage_left_rate: 0,
  weekly_usage_left_rate: 0,
  five_hour_usage_reset_time: '0',
  weekly_usage_reset_time: 0,
  plan_credit_rate_limit: {
    subscription_credit_left_rate: 0.875,
    subscription_credit_reset_time: '1790000000',
    topup_credit_left_rate: 0.99,
    credit_buckets: [
      { credit_total: 1600000000, credit_residual: 1400000000, expire_at: 1800000000, next_reset_at: 1790000000 },
      { credit_total: 400000000, credit_residual: 400000000, expire_at: 1810000000, next_reset_at: 1810000000 },
    ],
  },
}

/** 造一个带 device_id 的 JWT（index.js 的 stepfunJwtDeviceId 用 base64url payload）。 */
function jwtWithDeviceId(deviceId, extra) {
  const payload = Buffer.from(JSON.stringify({ device_id: deviceId, ...(extra ?? {}) })).toString('base64url')
  return `header.${payload}.signature`
}

test('normalizeStepfunBalance maps the official accounts payload into money text windows', () => {
  // 官方文档示例形状：金额是 float，balance 为主窗、赠金 >0 追加一行（kindKey 复用 granted-balance）。
  assert.deepEqual(normalizeStepfunBalance(STEPFUN_ACCOUNTS_FIXTURE), {
    windows: [
      { id: 'balance', text: '¥123.45', kindKey: 'balance' },
      { id: 'granted-balance', text: '¥3.45', kindKey: 'granted-balance' },
    ],
  })
  // 无赠金（voucher 0）只出一行；字符串金额照收。
  assert.deepEqual(normalizeStepfunBalance({ balance: '26', total_voucher_balance: 0 }), {
    windows: [
      { id: 'balance', text: '¥26.00', kindKey: 'balance' },
    ],
  })
  // balance 缺失/非法（含空白串——Number('') 是 0 的坑）→ 整条丢弃，不伪造 ¥0.00。
  assert.deepEqual(normalizeStepfunBalance({ balance: '' }), { windows: [] })
  assert.deepEqual(normalizeStepfunBalance(undefined), { windows: [] })
  assert.deepEqual(normalizeStepfunBalance({ balance: -5 }), { windows: [] })
  assert.deepEqual(normalizeStepfunBalance({ balance: 'abc' }), { windows: [] })
})

test('stepfunWebIdFromToken derives the Oasis-Webid from the token JWT device_id', () => {
  const access = jwtWithDeviceId('dev-access')
  const refresh = jwtWithDeviceId('dev-refresh')
  // 纯 access 半可解；`access...refresh` 对取 refresh 半优先（CodexBar 同款，浏览器 cookie 就是这种形态）。
  assert.equal(stepfunWebIdFromToken(access), 'dev-access')
  assert.equal(stepfunWebIdFromToken(`${access}...${refresh}`), 'dev-refresh')
  assert.equal(stepfunWebIdFromToken(`${jwtWithDeviceId('')}...${refresh}`), 'dev-refresh')
  // 解不出（非 JWT / 缺 device_id / 空）→ undefined。
  assert.equal(stepfunWebIdFromToken('not-a-jwt'), undefined)
  assert.equal(stepfunWebIdFromToken(jwtWithDeviceId('')), undefined)
  assert.equal(stepfunWebIdFromToken(''), undefined)
  assert.equal(stepfunWebIdFromToken(undefined), undefined)
})

test('normalizeStepFunStepPlanUsage classifies the two plan families by shape and never reads 0-window as used-up', () => {
  // 旧版 Token Plan：活窗口值存在 → 5h/周两窗，left_rate 折算已用 %；reset 字符串/整数都归一为 ISO。
  const legacy = normalizeStepFunStepPlanUsage(STEPFUN_RATE_LIMIT_LEGACY_FIXTURE)
  assert.deepEqual(legacy, [
    { id: 'five-hour', kindKey: 'five-hour', percent: 0, resetsAt: new Date(1777528800 * 1000).toISOString() },
    { id: 'weekly', kindKey: 'weekly', percent: 20, resetsAt: new Date(1780000000 * 1000).toISOString() },
  ])

  // 新版 Credit 月池：窗口字段 0/"0" 是「无窗口未配置」→ 走 plan_credit_rate_limit；
  // buckets 全有效时按 total 加权合成一窗（订阅 1600M 剩 1400M + 加油包 400M 全剩 = 剩 1800/2000 = 90% → 已用 10%）。
  const credit = normalizeStepFunStepPlanUsage(STEPFUN_RATE_LIMIT_CREDIT_FIXTURE)
  assert.deepEqual(credit, [
    { id: 'credit-pool', kindKey: 'credit-pool', percent: 10, resetsAt: new Date(1790000000 * 1000).toISOString() },
  ])

  // 新版无 buckets（或不完整）→ 回退 subscription/topup 两个剩余比例窗。
  const noBuckets = normalizeStepFunStepPlanUsage({
    status: 1,
    plan_family: 2,
    five_hour_usage_reset_time: 0,
    weekly_usage_reset_time: 0,
    plan_credit_rate_limit: { subscription_credit_left_rate: 0.5, topup_credit_left_rate: 0.9 },
  })
  assert.deepEqual(noBuckets, [
    { id: 'credit-pool', kindKey: 'credit-pool', percent: 50 },
    { id: 'topup-credit', kindKey: 'topup-credit', percent: 10 },
  ])

  // camelCase 形态照收（Connect protobuf JSON 两形态都出现过）。
  const camel = normalizeStepFunStepPlanUsage({ status: 1, planCreditRateLimit: { subscriptionCreditLeftRate: 0.75, subscriptionCreditResetTime: 1790000000 } })
  assert.deepEqual(camel, [{ id: 'credit-pool', kindKey: 'credit-pool', percent: 25, resetsAt: new Date(1790000000 * 1000).toISOString() }])

  // status 非 1 / 非对象 / 无任何窗口 → 空（fetcher 转 bad-payload / no-subscription）。
  assert.deepEqual(normalizeStepFunStepPlanUsage({ status: 2, desc: 'x' }), [])
  assert.deepEqual(normalizeStepFunStepPlanUsage({ status: 1 }), [])
  assert.deepEqual(normalizeStepFunStepPlanUsage(null), [])
  // 率缺失时旧版窗跳过（reset 有值但率全无 → 只保留存在的窗）。
  assert.deepEqual(normalizeStepFunStepPlanUsage({ status: 1, five_hour_usage_reset_time: 1, weekly_usage_reset_time: 1, weekly_usage_left_rate: 0.5 }), [
    { id: 'weekly', kindKey: 'weekly', percent: 50, resetsAt: new Date(1000).toISOString() },
  ])
})

test('fetchStepFunStepPlanUsage POSTs the Connect-JSON RPC with Oasis headers derived from the token', async (t) => {
  const token = jwtWithDeviceId('dev-123')
  const requests = stubHttpsRequest(t, () => ({ payload: STEPFUN_RATE_LIMIT_CREDIT_FIXTURE }))
  const windows = await fetchStepFunStepPlanUsage({ credential: token, signal: undefined })
  assert.equal(windows.length, 1)
  assert.equal(requests.length, 1)
  const entry = requests[0]
  // 固定端点 + POST + body {} + Oasis 全家头（token 与派生 web_id 各自落位，无 Authorization 无 Cookie）。
  assert.equal(entry.url, 'https://platform.stepfun.com/api/step.openapi.devcenter.Dashboard/QueryStepPlanRateLimit')
  assert.equal(entry.method, 'POST')
  assert.equal(entry.body, '{}')
  assert.equal(entry.headers['Oasis-Token'], token)
  assert.equal(entry.headers['Oasis-Webid'], 'dev-123')
  assert.equal(entry.headers['Oasis-appID'], '10300')
  assert.equal(entry.headers['Oasis-Platform'], 'web')
  assert.equal(entry.auth, undefined)
  assert.equal(entry.cookie, undefined)

  // 粘贴带入的「Oasis-Token:」/「Cookie:」前缀剥掉再上头。
  const prefixRequests = stubHttpsRequest(t, () => ({ payload: STEPFUN_RATE_LIMIT_LEGACY_FIXTURE }))
  await fetchStepFunStepPlanUsage({ credential: `Oasis-Token: ${jwtWithDeviceId('dev-prefix')}`, signal: undefined })
  assert.equal(prefixRequests[0].headers['Oasis-Token'], jwtWithDeviceId('dev-prefix'))
})

test('fetchStepFunStepPlanUsage normalizes credential/session/business failures stably', async (t) => {
  // 空凭据（发现链全落空后不该发生，仍防御）。
  await assert.rejects(fetchStepFunStepPlanUsage({ credential: '', signal: undefined }),
    (error) => quotaErrorCode(error) === 'credential-missing')

  // token 解不出 device_id（web_id 与 token 不匹配是唯一常见认证失败）→ credential-rejected。
  await assert.rejects(fetchStepFunStepPlanUsage({ credential: 'not-a-jwt', signal: undefined }),
    (error) => quotaErrorCode(error) === 'credential-rejected')

  // HTTP 401（登录态失效）→ credential-rejected。
  stubHttpsRequest(t, () => ({ status: 401 }))
  await assert.rejects(fetchStepFunStepPlanUsage({ credential: jwtWithDeviceId('dev-1'), signal: undefined }),
    (error) => quotaErrorCode(error) === 'credential-rejected')

  // status 非 1（业务失败）→ bad-payload 并透出 desc。
  stubHttpsRequest(t, () => ({ payload: { status: 0, desc: 'plan expired', code: 120000 } }))
  await assert.rejects(fetchStepFunStepPlanUsage({ credential: jwtWithDeviceId('dev-1'), signal: undefined }),
    (error) => quotaErrorCode(error) === 'bad-payload' && error.detail === 'plan expired')

  // status 1 但无任何窗口（未订阅 Step Plan）→ no-subscription。
  stubHttpsRequest(t, () => ({ payload: { status: 1 } }))
  await assert.rejects(fetchStepFunStepPlanUsage({ credential: jwtWithDeviceId('dev-1'), signal: undefined }),
    (error) => quotaErrorCode(error) === 'no-subscription')

  // 上游 500 维持 http-status 稳定码。
  stubHttpsRequest(t, () => ({ status: 500 }))
  await assert.rejects(fetchStepFunStepPlanUsage({ credential: jwtWithDeviceId('dev-1'), signal: undefined }),
    (error) => quotaErrorCode(error) === 'http-status')
})

test('stepfun auto-infers balance from the API host; step-plan adapts without a baseURL and never probes the API key', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-stepfun-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const resolvedNames = []
  const host = createHost({
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: {
        sf: { displayName: 'StepFun', baseURL: 'https://api.stepfun.com/v1', apiKeyEnv: 'SF_API_KEY' },
        sfplan: { displayName: 'StepPlan', baseURL: 'https://api.stepfun.com/step_plan/v1', apiKeyEnv: 'SF_API_KEY' },
      } } : undefined) },
      credentials: {
        resolve: async (name) => {
          resolvedNames.push(name)
          // 余额 kind 用 API key；订阅 kind 用 Oasis token（带 device_id 的 JWT）。
          return name === 'SF_API_KEY' || name === 'STEPFUN_API_KEY' ? { value: 'sk-stepfun-abc' } : { value: jwtWithDeviceId('dev-rpc') }
        },
      },
    },
  })
  const requests = stubHttpsRequest(t, (request) => {
    if (request.url.endsWith('/v1/accounts')) return { payload: STEPFUN_ACCOUNTS_FIXTURE }
    if (request.url.includes('QueryStepPlanRateLimit')) return { payload: STEPFUN_RATE_LIMIT_CREDIT_FIXTURE }
    return { status: 404 }
  })
  // 经典链余额端点走 https.get（与 https.request 桩互补）：返回同一 fixture。
  const originalGet = https.get
  const getHits = []
  t.after(() => { https.get = originalGet })
  https.get = (url, options, callback) => {
    getHits.push(String(url))
    const response = new EventEmitter()
    response.statusCode = 200
    response.setEncoding = () => {}
    response.resume = () => {}
    const request = new EventEmitter()
    request.destroy = () => {}
    request.write = () => {}
    process.nextTick(() => {
      callback(response)
      response.emit('data', JSON.stringify(STEPFUN_ACCOUNTS_FIXTURE))
      response.emit('end')
    })
    return request
  }

  // 订阅行的适配先落盘（fixed 查询面：baseURL 为空也不拦）；
  // 余额行靠 baseURL 唯一命中自动推断，不写配置。
  const adapted = await host.handler('quota-config', { provider: 'sfplan', kind: 'stepfun-step-plan' })
  assert.equal(adapted.ok, true)
  assert.equal(await host.handler('quota', {}).then((res) => res.ok), true)
  await waitFor(() => requests.filter((r) => r.url.includes('QueryStepPlanRateLimit')).length >= 1, 'one rate-limit call')
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))

  const rows = (await host.handler('quota', {})).value.providers
  const balanceRow = rows.find((entry) => entry.provider === 'sf')
  assert.equal(balanceRow.kind, 'stepfun')
  assert.equal(balanceRow.kindSource, 'auto')
  assert.equal(balanceRow.status, 'ok')
  assert.equal(balanceRow.credentialEntryKey, 'edit')
  assert.equal(balanceRow.usageUrl, 'https://platform.stepfun.com/plan-usage')
  assert.deepEqual(balanceRow.windows.map((w) => w.text), ['¥123.45', '¥3.45'])
  // 余额请求走 https.get（Bearer 同 API key），仅命中固定 com 端点一次。
  assert.deepEqual(getHits, ['https://api.stepfun.com/v1/accounts'])

  const planRow = rows.find((entry) => entry.provider === 'sfplan')
  assert.equal(planRow.kind, 'stepfun-step-plan')
  assert.equal(planRow.kindSource, 'config')
  assert.equal(planRow.status, 'ok')
  assert.equal(planRow.credentialEntryKey, 'editToken')
  assert.deepEqual(planRow.windows.map((w) => [w.id, w.percent]), [['credit-pool', 10]])
  const planRequest = requests.find((r) => r.url.includes('QueryStepPlanRateLimit'))
  assert.equal(planRequest.headers['Oasis-Webid'], 'dev-rpc')
  assert.equal(planRequest.auth, undefined)

  // 凭据发现链：余额行从 settings apiKeyEnv（SF_API_KEY）命中即止（不回退 STEPFUN_API_KEY）；
  // 订阅行只试 Oasis token 线索名（第一个命中即止）——settings 的 API key 声明绝不进控制台平面。
  assert.deepEqual(resolvedNames.filter((n) => n === 'SF_API_KEY' || n === 'STEPFUN_API_KEY'), ['SF_API_KEY'])
  assert.ok(resolvedNames.includes('STEPFUN_TOKEN'))
  assert.ok(!resolvedNames.includes('STEPFUN_OASIS_TOKEN'))
  assert.deepEqual(quotaCredentialHintNames('stepfun-step-plan', { apiKeyEnv: 'SF_API_KEY' }), ['STEPFUN_TOKEN', 'STEPFUN_OASIS_TOKEN'])
})


test('quota credential hints and write endpoints round-trip through the DSH credentials store', async (t) => {
  // 线索名清单：经典 kind = apiKeyEnv 在前、keyHints 殿后去重；管理面 kind 不含代理 key。
  assert.deepEqual(quotaCredentialHintNames('opencode-go', { apiKeyEnv: 'OPENCODE_GO_API_KEY' }), ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY'])
  assert.deepEqual(quotaCredentialHintNames('cliproxy', { apiKeyEnv: 'CPA_API_KEY' }), ['CPA_MANAGEMENT_KEY', 'CLIPROXY_MANAGEMENT_KEY'])

  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-quota-cred-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(join(dshHome, 'dsh-service-quota.json'), JSON.stringify({ version: 1, kinds: { 'opencode-go': 'opencode-go' }, resetCards: [], allowedHosts: {} }))
  const credCalls = []
  const credentials = {
    resolve: async () => undefined,
    describe: async (name) => (name === 'OPENCODE_API_KEY' ? { configured: true, source: 'env', writable: false } : { configured: false }),
    set: async (name, value) => { credCalls.push(['set', name, value]) },
    unset: async (name) => { credCalls.push(['unset', name]) },
  }
  const host = createHost({
    env: { DSH_HOME: dshHome },
    services: {
      settings: { get: (ns) => (ns === 'llm-pi-ai' ? { providers: { 'opencode-go': { baseURL: 'https://opencode.ai/zen/go/v1' } } } : undefined) },
      credentials,
    },
  })
  const snapshot = await host.handler('quota', {})
  // 首拉在途时行还是 refreshing；等凭据缺失落定后取下一拍断言。
  assert.equal(snapshot.value.providers.find((entry) => entry.provider === 'opencode-go').refreshing, true)
  await host.handler('quota', {})
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
  const settledSnapshot = await host.handler('quota', {})
  const row = settledSnapshot.value.providers.find((entry) => entry.provider === 'opencode-go')
  assert.equal(row.status, 'unconfigured')
  // 快照只带配置状态/来源/可写位，绝不带值。
  assert.deepEqual(row.credentialHints, [
    { name: 'OPENCODE_GO_API_KEY', configured: false },
    { name: 'OPENCODE_API_KEY', configured: true, source: 'env', writable: false },
  ])

  // 写入守卫：白名单外名字、空值、未知 provider 分别拒绝；合法值裁剪后落库。
  assert.equal((await host.handler('quota-credential-set', { provider: 'opencode-go', name: 'EVIL_NAME', value: 'x' })).error, 'unknown-hint')
  assert.equal((await host.handler('quota-credential-set', { provider: 'opencode-go', name: 'OPENCODE_GO_API_KEY', value: '   ' })).error, 'invalid-value')
  assert.equal((await host.handler('quota-credential-set', { provider: 'nope', name: 'X', value: 'x' })).error, 'unknown-provider')
  const saved = await host.handler('quota-credential-set', { provider: 'opencode-go', name: 'OPENCODE_GO_API_KEY', value: '  sk-live-1  ' })
  assert.equal(saved.ok, true)
  assert.deepEqual(credCalls, [['set', 'OPENCODE_GO_API_KEY', 'sk-live-1']])
  const cleared = await host.handler('quota-credential-unset', { provider: 'opencode-go', name: 'OPENCODE_GO_API_KEY' })
  assert.equal(cleared.ok, true)
  assert.deepEqual(credCalls[1], ['unset', 'OPENCODE_GO_API_KEY'])

  // set 抛错（如进程环境层遮蔽该名字）→ 稳定错误码 + 透出 detail。
  credentials.set = async () => { throw new Error('ref is shadowed by a read-only source') }
  const failed = await host.handler('quota-credential-set', { provider: 'opencode-go', name: 'OPENCODE_GO_API_KEY', value: 'x' })
  assert.equal(failed.error, 'credential-write-failed')
  assert.match(failed.detail, /shadowed/)

  // 凭据服务缺席（或只有 resolve 没有 describe/set）：快照行省略 credentialHints，写入报不可用。
  const bare = createHost(quotaHostOverrides(dshHome, QUOTA_PROVIDERS, null))
  await bare.handler('quota', {})
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
  const bareRow = (await bare.handler('quota', {})).value.providers.find((entry) => entry.provider === 'opencode-go')
  assert.equal(bareRow.credentialHints, undefined)
  assert.equal((await bare.handler('quota-credential-set', { provider: 'opencode-go', name: 'OPENCODE_GO_API_KEY', value: 'x' })).error, 'credentials-unavailable')
})

// ─── 子代理路由（v0.27）────────────────────────────────────────────────

/** 最小 subagents 注册表替身：记录两次入口的入参，可回读原始方法身份；可选在创建时同步派发 agent/created。 */
function fakeSubagents(emitCreated) {
  const calls = []
  const createdAgents = []
  const registry = {
    start(name, request) {
      calls.push({ entry: 'start', name, request })
      const agent = { id: 'agent-' + (calls.length + 1), options: request?.agentOptions || {}, session: {} }
      createdAgents.push(agent)
      emitCreated?.(agent)
      return Promise.resolve({ id: 'run-1' })
    },
    startContinuable(spec) {
      calls.push({ entry: 'startContinuable', name: spec.provider, request: spec.request })
      const agent = { id: 'agent-' + (calls.length + 1), options: spec.request?.agentOptions || {}, session: {} }
      createdAgents.push(agent)
      emitCreated?.(agent)
      return Promise.resolve({ childId: 'child-1' })
    },
  }
  return { registry, calls, createdAgents }
}

/** 最小 llm 服务替身：listProviders/listModels 提供白名单目录，stream 仅在位性检查用；可选 resolveModelInfo 供 reasoning metadata。 */
function fakeLlm(providers) {
  const modelInfo = new Map()
  return {
    listProviders: () => providers.map(([id, name]) => ({ id, name })),
    listModels: async (provider) => (providers.find(([id]) => id === provider)?.[2] ?? []).map((modelId) => ({ id: modelId, name: modelId })),
    stream: async function* () {},
    resolveModelInfo: async (provider, model) => {
      const info = modelInfo.get(provider + '\u0000' + model)
      return info === undefined ? { provider, id: model, name: model } : info
    },
    setModelInfo(provider, model, info) {
      modelInfo.set(provider + '\u0000' + model, info)
    },
  }
}

test('parseSubagentRouteText：损坏/版本不符/未知模式/custom 缺字段回退 inherit，合法输入截断保留', () => {
  const empty = { version: 1, mode: 'inherit' }
  assert.deepEqual(parseSubagentRouteText('{oops'), empty)
  assert.deepEqual(parseSubagentRouteText('null'), empty)
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 2, mode: 'custom', provider: 'a', model: 'b' })), empty)
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'pin' })), empty)
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'custom' })), empty)
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'custom', provider: 'p', model: '' })), empty)
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'follow' })), { version: 1, mode: 'follow' })
  const custom = parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'custom', provider: '  p  ', model: ' m ' }))
  assert.deepEqual(custom, { version: 1, mode: 'custom', provider: 'p', model: 'm' })
})

test('resolveSubagentInjection：显式路由永远赢、follow 读父会话 header、custom 校验可路由、inherit 不注入', () => {
  const explicit = { agentOptions: { provider: 'cpa' } }
  assert.equal(resolveSubagentInjection(explicit, { mode: 'custom', provider: 'x', model: 'y' }, { isRoutable: () => true }), undefined)
  assert.equal(resolveSubagentInjection({ agentOptions: { model: 'm1' } }, { mode: 'custom', provider: 'x', model: 'y' }, { isRoutable: () => true }), undefined)
  // follow：父会话最近一次请求路由被注入。
  const parent = { session: { requestHeader: () => ({ config: { provider: 'openrouter', model: 'ox-alpha' } }) } }
  assert.deepEqual(resolveSubagentInjection({ parent }, { mode: 'follow' }, { readParentHeader: (p) => p?.session?.requestHeader?.()?.config }), { provider: 'openrouter', model: 'ox-alpha' })
  // follow：空白会话无 header / header 缺字段 → 回落继承。
  assert.equal(resolveSubagentInjection({ parent: { session: { requestHeader: () => undefined } } }, { mode: 'follow' }, { readParentHeader: (p) => p?.session?.requestHeader?.()?.config }), undefined)
  assert.equal(resolveSubagentInjection({ parent: { session: { requestHeader: () => ({ config: { provider: 'p' } }) } } }, { mode: 'follow' }, { readParentHeader: (p) => p?.session?.requestHeader?.()?.config }), undefined)
  // follow：读取抛错不炸派生。
  assert.equal(resolveSubagentInjection({ parent: {} }, { mode: 'follow' }, { readParentHeader: () => { throw new Error('boom') } }), undefined)
  // custom：可路由才注入。
  assert.deepEqual(resolveSubagentInjection({}, { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash' }, { isRoutable: () => true }), { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  assert.equal(resolveSubagentInjection({}, { mode: 'custom', provider: 'gone', model: 'm' }, { isRoutable: () => false }), undefined)
  // inherit / 未配置：一律不注入。
  assert.equal(resolveSubagentInjection({}, { mode: 'inherit' }, {}), undefined)
  assert.equal(resolveSubagentInjection({}, null, {}), undefined)
})

test('subagent-route seam：包装 start/startContinuable 注入未显式路由的派生，disposer 还原原方法', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-seam-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const llm = fakeLlm([['deepseek-official', 'DeepSeek', ['deepseek-v4-flash', 'deepseek-v4-pro']], ['cpa', 'CPA', ['gpt-5.6-sol']]])
  const { registry, calls } = fakeSubagents()
  const host = createHost({ featureSettings: {}, services: { subagents: registry, llm }, env: { DSH_HOME: dshHome } })

  // 默认 inherit：零干预。
  await registry.start('spawn', { label: 'a', parent: { session: { requestHeader: () => ({ config: { provider: 'cpa', model: 'gpt-5.6-sol' } }) } } })
  assert.equal(calls[0].request.agentOptions, undefined)

  // follow：注入父会话最近一次请求的路由。
  await host.handler('subagent-route-save', { mode: 'follow' })
  await registry.startContinuable({ provider: 'spawn', label: 'b', request: { label: 'b', parent: { session: { requestHeader: () => ({ config: { provider: 'cpa', model: 'gpt-5.6-sol' } }) } } } })
  assert.deepEqual(calls[1].request.agentOptions, { provider: 'cpa', model: 'gpt-5.6-sol' })
  // follow：显式路由派生不干预。
  await registry.start('spawn', { label: 'c', parent: {}, agentOptions: { provider: 'cpa', model: 'gpt-5.6-sol' } })
  assert.deepEqual(calls[2].request.agentOptions, { provider: 'cpa', model: 'gpt-5.6-sol' })

  // custom：白名单校验 + 注入；不可路由渠道回落继承。
  assert.equal((await host.handler('subagent-route-save', { mode: 'custom', provider: 'nope', model: 'x' })).error, 'invalid-model-route')
  assert.equal((await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'nope' })).error, 'invalid-model-route')
  const saved = await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved, { ok: true, mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  await registry.start('spawn', { label: 'd', parent: {}, agentOptions: { maxTokens: 321 } })
  assert.deepEqual(calls[3].request.agentOptions, { maxTokens: 321, provider: 'deepseek-official', model: 'deepseek-v4-flash' })

  // 功能开关关闭 → 热回落零干预（seam 仍在但不再注入）。
  await host.updateFeatureSettings({ subagentRoute: false })
  await registry.start('spawn', { label: 'e', parent: {} })
  assert.equal(calls[4].request.agentOptions, undefined)
  await host.updateFeatureSettings({ subagentRoute: true })

  // 快照端点：available + 模式 + 模型目录。
  const snapshot = await host.handler('subagent-route', {})
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.value.available, true)
  assert.equal(snapshot.value.mode, 'custom')
  assert.equal(snapshot.value.provider, 'deepseek-official')
  assert.ok(snapshot.value.models.some((item) => item.provider === 'cpa' && item.id === 'gpt-5.6-sol'))

  // disposer：还原两个入口为初始方法（自身恒等）。
  const originalStart = registry.start
  const originalStartContinuable = registry.startContinuable
  host.dispose()
  assert.notEqual(registry.start, originalStart)
  assert.notEqual(registry.startContinuable, originalStartContinuable)
  // 还原后行为回落原生（注入不再发生——此处用「可再调用」验证方法可用）。
  await registry.start('spawn', { label: 'f', parent: {} })
  assert.equal(calls[5].request.agentOptions, undefined)
  const disposedSnapshot = await host.handler('subagent-route', {})
  assert.equal(disposedSnapshot.ok, true)
  assert.equal(disposedSnapshot.value.available, false)
})

test('subagent-route-save：unknown-mode 与功能门；follow/inherit 清干净 custom 字段并跨重启持久化', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-persist-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const llm = fakeLlm([['deepseek-official', 'DeepSeek', ['deepseek-v4-flash']]])
  const host = createHost({ featureSettings: {}, services: { subagents: fakeSubagents().registry, llm }, env: { DSH_HOME: dshHome } })

  assert.equal((await host.handler('subagent-route-save', { mode: 'pin' })).error, 'unknown-mode')
  assert.equal((await host.handler('subagent-route-save', {})).error, 'unknown-mode')
  // custom 缺 provider/model。
  assert.equal((await host.handler('subagent-route-save', { mode: 'custom' })).error, 'invalid-model-route')
  assert.equal((await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official' })).error, 'invalid-model-route')

  // 保存 custom → 重启后从磁盘恢复。
  await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  const rebooted = createHost({ featureSettings: {}, services: { subagents: fakeSubagents().registry, llm }, env: { DSH_HOME: dshHome } })
  const snapshot = await rebooted.handler('subagent-route', {})
  assert.equal(snapshot.value.mode, 'custom')
  assert.equal(snapshot.value.provider, 'deepseek-official')
  assert.equal(snapshot.value.model, 'deepseek-v4-flash')

  // follow 覆盖后 custom 字段不残留；重置回 inherit 落盘干净。
  await rebooted.handler('subagent-route-save', { mode: 'follow' })
  const afterFollow = await rebooted.handler('subagent-route', {})
  assert.equal(afterFollow.value.mode, 'follow')
  assert.equal(afterFollow.value.provider, undefined)
  await rebooted.handler('subagent-route-save', { mode: 'inherit' })
  const raw = JSON.parse(await readFile(join(dshHome, 'dsh-service-subagent-route.json'), 'utf8'))
  assert.deepEqual(raw, { version: 1, mode: 'inherit' })

  // 功能关闭：读写两端都被门住。
  await rebooted.updateFeatureSettings({ subagentRoute: false })
  assert.equal((await rebooted.handler('subagent-route', {})).error, 'feature-disabled')
  assert.equal((await rebooted.handler('subagent-route-save', { mode: 'follow' })).error, 'feature-disabled')
})

test('parseSubagentRouteText：回退列表解析（trim/去重/上限/非法条目丢弃；follow 与 custom 持有，inherit 丢弃）', () => {
  const custom = parseSubagentRouteText(JSON.stringify({
    version: 1, mode: 'custom', provider: 'p', model: 'm',
    fallbacks: [
      { provider: '  a  ', model: ' a1 ', reasoningEffort: '  low  ' },
      { provider: 'b', model: 'b1' },
      { provider: 'a', model: 'a1' },
      { provider: '', model: 'x' },
      'junk',
      { provider: 'c', model: 'c1', reasoningEffort: 42 },
    ],
  }))
  assert.deepEqual(custom.fallbacks, [
    { provider: 'a', model: 'a1', reasoningEffort: 'low' },
    { provider: 'b', model: 'b1' },
    { provider: 'c', model: 'c1' },
  ])
  const follow = parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'follow', fallbacks: [{ provider: 'x', model: 'y' }] }))
  assert.deepEqual(follow, { version: 1, mode: 'follow', fallbacks: [{ provider: 'x', model: 'y' }] })
  const inherit = parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'inherit', fallbacks: [{ provider: 'x', model: 'y' }] }))
  assert.deepEqual(inherit, { version: 1, mode: 'inherit' })
  const many = parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'follow', fallbacks: Array.from({ length: 12 }, (_, i) => ({ provider: 'p' + i, model: 'm' })) }))
  assert.equal(many.fallbacks.length, 10)
})

test('resolveSubagentInjection：回退候选链——顺序选择、quota-skip、全不可用回落继承', () => {
  // a/b/c 都可路由；b 的额度态「不可服务」。
  const isRoutable = (provider) => ['a', 'b', 'c'].includes(provider)
  const isQuotaHealthy = (provider) => provider !== 'b'
  // custom：主路由可用时用主路由。
  assert.deepEqual(resolveSubagentInjection({}, { mode: 'custom', provider: 'a', model: 'm1', fallbacks: [{ provider: 'c', model: 'm3' }] }, { isRoutable, isQuotaHealthy }), { provider: 'a', model: 'm1' })
  // custom：主路由不可路由 → 顺序落到回退（含 effort 透传）。
  assert.deepEqual(resolveSubagentInjection({}, { mode: 'custom', provider: 'zz', model: 'm1', fallbacks: [{ provider: 'b', model: 'm2' }, { provider: 'c', model: 'm3', reasoningEffort: 'high' }] }, { isRoutable, isQuotaHealthy }), { provider: 'c', model: 'm3', reasoningEffort: 'high' })
  // custom：主路由 quota 不可用 → 落到回退。
  assert.deepEqual(resolveSubagentInjection({}, { mode: 'custom', provider: 'b', model: 'm1', fallbacks: [{ provider: 'c', model: 'm3' }] }, { isRoutable, isQuotaHealthy }), { provider: 'c', model: 'm3' })
  // 全部 quota 不可用 → undefined（回落原生继承，不让派生失败）。
  assert.equal(resolveSubagentInjection({}, { mode: 'custom', provider: 'b', model: 'm1', fallbacks: [{ provider: 'b', model: 'm2' }] }, { isRoutable, isQuotaHealthy }), undefined)
  // 未提供 isQuotaHealthy → fail-open 不跳过。
  assert.deepEqual(resolveSubagentInjection({}, { mode: 'custom', provider: 'b', model: 'm1' }, { isRoutable }), { provider: 'b', model: 'm1' })
  // follow：父路由优先；父路由 quota 不可用 → 回退；无 header → 回退兜底。
  const parentA = { session: { requestHeader: () => ({ config: { provider: 'a', model: 'm1' } }) } }
  const parentB = { session: { requestHeader: () => ({ config: { provider: 'b', model: 'm1' } }) } }
  const parentEmpty = { session: { requestHeader: () => undefined } }
  const readParentHeader = (parent) => parent?.session?.requestHeader?.()?.config
  assert.deepEqual(resolveSubagentInjection({ parent: parentA }, { mode: 'follow', fallbacks: [{ provider: 'c', model: 'm3' }] }, { isRoutable, isQuotaHealthy, readParentHeader }), { provider: 'a', model: 'm1' })
  assert.deepEqual(resolveSubagentInjection({ parent: parentB }, { mode: 'follow', fallbacks: [{ provider: 'c', model: 'm3' }] }, { isRoutable, isQuotaHealthy, readParentHeader }), { provider: 'c', model: 'm3' })
  assert.deepEqual(resolveSubagentInjection({ parent: parentEmpty }, { mode: 'follow', fallbacks: [{ provider: 'c', model: 'm3' }] }, { isRoutable, isQuotaHealthy, readParentHeader }), { provider: 'c', model: 'm3' })
  // inherit：无候选。
  assert.equal(resolveSubagentInjection({ parent: parentA }, { mode: 'inherit', fallbacks: [{ provider: 'c', model: 'm3' }] }, { isRoutable, readParentHeader }), undefined)
  // note 回调收到跳过原因。
  const notes = []
  resolveSubagentInjection({}, { mode: 'custom', provider: 'b', model: 'm1', fallbacks: [{ provider: 'c', model: 'm3' }] }, { isRoutable, isQuotaHealthy, note: (message) => notes.push(message) })
  assert.deepEqual(notes, ['b/m1 skipped (quota-unusable)'])
})

test('quotaProviderUnusable：失败码/上游 4xx/100% 窗口判不可用；瞬态/5xx/无数据/刷新中放行', () => {
  assert.equal(quotaProviderUnusable(undefined), false)
  assert.equal(quotaProviderUnusable({ refreshing: true, lastError: 'credential-rejected' }), false)
  assert.equal(quotaProviderUnusable({ lastError: 'credential-rejected' }), true)
  assert.equal(quotaProviderUnusable({ lastError: 'no-base-url' }), true)
  assert.equal(quotaProviderUnusable({ lastError: 'credential-missing' }), true)
  assert.equal(quotaProviderUnusable({ lastError: 'http-status:402' }), true)
  assert.equal(quotaProviderUnusable({ lastError: 'upstream-status:429' }), true)
  assert.equal(quotaProviderUnusable({ lastError: 'network' }), false)
  assert.equal(quotaProviderUnusable({ lastError: 'timeout' }), false)
  assert.equal(quotaProviderUnusable({ lastError: 'upstream-status:500' }), false)
  assert.equal(quotaProviderUnusable({ windows: [{ percent: 100, label: 'x' }] }), true)
  assert.equal(quotaProviderUnusable({ windows: [{ percent: 99.9 }] }), false)
  assert.equal(quotaProviderUnusable({ windows: [{ text: '¥12' }] }), false)
})

test('createQuotaThrottle.peek：无状态返回 undefined 且不建条目；有状态只读返回', () => {
  const throttle = createQuotaThrottle()
  assert.equal(throttle.peek('never-seen'), undefined)
  // view 会建条目，peek 不会。
  throttle.view('seen')
  assert.notEqual(throttle.peek('seen'), undefined)
  const fresh = createQuotaThrottle()
  assert.equal(fresh.peek('anything'), undefined)
  assert.equal(fresh.peek('anything'), undefined)
})

test('buildSubagentDispatchRecord：routed/inherited/default/跳过四态与 turn 扫描', () => {
  const parent = {
    session: {
      id: 'parent-1',
      events: [
        { type: 'turn/start', data: { turn: 0 } },
        { type: 'step/start', data: { turn: 0, step: 0 } },
        { type: 'tool/call', data: { turn: 0, step: 0 } },
        { type: 'turn/end', data: { turn: 0, reason: { kind: 'completed' } } },
        { type: 'tool/call', data: { turn: 3, step: 1 } },
      ],
    },
  }
  // routed：注入值优先，effort 保留，turn 取最近带数字 turn 的事件（3）。
  const routed = buildSubagentDispatchRecord({ id: 'child-1' }, parent, { provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh', parent })
  assert.equal(routed.source, 'routed')
  assert.equal(routed.provider, 'cpa')
  assert.equal(routed.model, 'gpt-5.6-luna')
  assert.equal(routed.reasoningEffort, 'xhigh')
  assert.equal(routed.turn, 3)
  assert.equal(routed.childId, 'child-1')
  assert.equal(routed.parentId, 'parent-1')
  assert.ok(Number.isFinite(routed.at))
  // error 事件尾巴上的对象没有数字 turn → 回退扫描仍能找到 3。
  const routedWithErrorTail = buildSubagentDispatchRecord({ id: 'child-1' }, {
    session: { id: 'parent-1', events: [...parent.session.events, { type: 'compaction/start', data: { compactionId: 'x' } }] },
  }, { provider: 'cpa', model: 'gpt-5.6-luna' })
  assert.equal(routedWithErrorTail.turn, 3)
  // explicit：请求自带 route（source 来自 dispatch.source），显式思考等级一并记录。
  const explicit = buildSubagentDispatchRecord({ id: 'child-2' }, parent, { source: 'explicit', provider: 'openrouter', model: 'ox-alpha' })
  assert.equal(explicit.source, 'explicit')
  assert.equal(explicit.provider, 'openrouter')
  assert.equal(explicit.reasoningEffort, undefined)
  const explicitWithEffort = buildSubagentDispatchRecord({ id: 'child-2b' }, parent, { source: 'explicit', provider: 'openrouter', model: 'ox-alpha', reasoningEffort: 'high' })
  assert.equal(explicitWithEffort.source, 'explicit')
  assert.equal(explicitWithEffort.reasoningEffort, 'high')
  // inherited：无注入时读父会话 header；header 读取抛错不炸。
  const inherited = buildSubagentDispatchRecord({ id: 'child-3' }, {
    session: { id: 'parent-1', events: [], requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }) },
  }, { parent: {} }, { readParentHeader: (p) => p?.session?.requestHeader?.()?.config })
  assert.equal(inherited.source, 'inherited')
  assert.equal(inherited.provider, 'deepseek-official')
  assert.equal(inherited.model, 'deepseek-v4-flash')
  const headerThrow = buildSubagentDispatchRecord({ id: 'child-4' }, { session: { id: 'parent-1' } }, {}, { readParentHeader: () => { throw new Error('boom') } })
  assert.equal(headerThrow, undefined)
  // default：header 空时读 agent-default-model 选择。
  const byDefault = buildSubagentDispatchRecord({ id: 'child-5' }, { session: { id: 'parent-1' } }, {}, {
    readDefaultSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-flash' }),
  })
  assert.equal(byDefault.source, 'default')
  assert.equal(byDefault.provider, 'opencode-go')
  // 全空跳过：无注入、无 header、无默认选择。
  assert.equal(buildSubagentDispatchRecord({ id: 'child-6' }, { session: { id: 'parent-1' } }, {}, {}), undefined)
  // 缺 id / 非字符串：跳过。
  assert.equal(buildSubagentDispatchRecord(null, parent, { provider: 'cpa', model: 'm' }), undefined)
  assert.equal(buildSubagentDispatchRecord({ id: '' }, parent, { provider: 'cpa', model: 'm' }), undefined)
  assert.equal(buildSubagentDispatchRecord({ id: 'c' }, { session: {} }, { provider: 'cpa', model: 'm' }), undefined)
  // alpha.4 只公开 snapshotEvents()；旧版仍走 events getter。
  assert.equal(lastSubagentTurn({ session: { snapshotEvents: () => [{ data: { turn: 7 } }] } }), 7)
  assert.equal(lastSubagentTurn({ session: { snapshotEvents: (from, to) => [{ data: { turn: 9 } }] } }), 9)
  // 新 API 异常时必须 fail-open，并回退旧 getter。
  assert.equal(lastSubagentTurn({ session: { snapshotEvents: () => { throw new Error('boom') }, events: [{ data: { turn: 6 } }] } }), 6)
  assert.equal(lastSubagentTurn({ session: { snapshotEvents: () => 'not-an-array', events: [{ data: { turn: 8 } }] } }), 8)
  assert.equal(lastSubagentTurn({ session: { snapshotEvents: () => 'not-an-array', get events() { throw new Error('old getter boom') } } }), undefined)
  // 非法 events / 超长扫描：异常安全（scanLimit 0 视为非法回落默认 50）。
  assert.equal(lastSubagentTurn({ session: { events: 'not-an-array' } }), undefined)
  assert.equal(lastSubagentTurn({ session: { events: [{ data: { turn: 1 } }] } }, 0), 1)
  assert.equal(lastSubagentTurn({ session: { events: [{ data: { turn: 1 } }, { data: { turn: 5 } }] } }, 1), 5)
  assert.equal(lastSubagentTurn({ session: { events: [{ data: { turn: 5 } }] } }, 5), 5)
})

test('pushSubagentDispatchRecord/listSubagentDispatches：childId 去重、环形上限、过滤与分页', () => {
  const ring = { order: [], byChild: new Map() }
  for (let index = 0; index < 5; index += 1) {
    assert.equal(pushSubagentDispatchRecord(ring, { childId: `c${index}`, parentId: 'p1', provider: 'a', model: 'm1', turn: 1, at: index }), true)
  }
  // 去重：同 childId 不再插入，ring 保持计数。
  assert.equal(pushSubagentDispatchRecord(ring, { childId: 'c2', parentId: 'p1', provider: 'b', model: 'm2', turn: 2, at: 9 }), false)
  assert.equal(ring.order.length, 5)
  assert.equal(ring.byChild.get('c2').provider, 'a')
  // 超限丢最旧（丢 c0）。
  assert.equal(pushSubagentDispatchRecord(ring, { childId: 'c5', parentId: 'p2', provider: 'c', model: 'm3', turn: 3, at: 10 }, 5), true)
  assert.equal(ring.order.length, 5)
  assert.equal(ring.byChild.has('c0'), false)
  // 过滤：parentId + turn；newest-first 顺序。
  const all = listSubagentDispatches(ring)
  assert.deepEqual(all.map((record) => record.childId), ['c5', 'c4', 'c3', 'c2', 'c1'])
  assert.deepEqual(listSubagentDispatches(ring, { parentId: 'p2' }).map((record) => record.childId), ['c5'])
  assert.deepEqual(listSubagentDispatches(ring, { turn: 1 }).map((record) => record.childId), ['c4', 'c3', 'c2', 'c1'])
  assert.deepEqual(listSubagentDispatches(ring, { parentId: 'p1', turn: 1 }).map((record) => record.childId), ['c4', 'c3', 'c2', 'c1'])
  // 分页：limit 生效且封顶；非法 limit 回默认。
  assert.equal(listSubagentDispatches(ring, { limit: 2 }).length, 2)
  const huge = listSubagentDispatches(ring, { limit: 9999 })
  assert.equal(huge.length, 5)
  assert.equal(listSubagentDispatches(ring, { limit: -1 }).length, 5)
  assert.equal(listSubagentDispatches(ring, { limit: 'nope' }).length, 5)
})

test('subagent-dispatches 端点：seam 记录 routed/explicit 两态、按父会话回合过滤、功能门与 disposer 后停止记录', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-dispatches-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const llm = fakeLlm([['cpa', 'CPA', ['gpt-5.6-luna']], ['deepseek-official', 'DeepSeek', ['deepseek-v4-flash']]])
  llm.setModelInfo('cpa', 'gpt-5.6-luna', { id: 'gpt-5.6-luna', name: 'Luna', reasoning: { efforts: [{ id: 'xhigh', name: 'XHigh' }], defaultEffort: 'xhigh' } })
  const agentDefaultModel = { currentSelection: () => ({ provider: 'opencode-go', model: 'deepseek-v4-flash' }) }
  let emitCreated
  const { registry } = fakeSubagents((agent) => emitCreated?.(agent))
  const host = createHost({ featureSettings: {}, services: { subagents: registry, llm, agentDefaultModel }, env: { DSH_HOME: dshHome } })
  emitCreated = (agent) => { void host.fire('agent/created', { agent }) }
  const parentWithTurn = { session: { id: 'parent-1', events: [{ type: 'tool/call', data: { turn: 2, step: 0 } }] } }

  // 功能关闭：记录与端点都门住。
  await host.updateFeatureSettings({ subagentRoute: false })
  await registry.start('spawn', { label: 'disabled', parent: parentWithTurn })
  assert.deepEqual(await host.handler('subagent-dispatches', {}), { ok: false, error: 'feature-disabled' })
  await host.updateFeatureSettings({ subagentRoute: true })

  // custom 路由注入：记录 source=routed + effort + turn。
  await host.handler('subagent-route-save', { mode: 'custom', provider: 'cpa', model: 'gpt-5.6-luna', reasoningEffort: 'xhigh' })
  await registry.start('spawn', { label: 'a', parent: parentWithTurn })
  let snapshot = await host.handler('subagent-dispatches', { parentId: 'parent-1' })
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.value.records.length, 1)
  const routed = snapshot.value.records[0]
  assert.equal(routed.provider, 'cpa')
  assert.equal(routed.model, 'gpt-5.6-luna')
  assert.equal(routed.reasoningEffort, 'xhigh')
  assert.equal(routed.source, 'routed')
  assert.equal(routed.turn, 2)
  assert.equal(routed.parentId, 'parent-1')
  assert.equal(routed.childId, 'agent-3')

  // 显式路由（未注入）：source=explicit。
  await registry.start('spawn', { label: 'b', parent: parentWithTurn, agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' } })
  snapshot = await host.handler('subagent-dispatches', { parentId: 'parent-1' })
  assert.equal(snapshot.value.records.length, 2)
  assert.equal(snapshot.value.records[0].source, 'explicit')
  assert.equal(snapshot.value.records[0].provider, 'deepseek-official')
  assert.equal(snapshot.value.records[0].reasoningEffort, 'high')

  // 功能关闭期间的派生没有记录（门住时 dispatch 无注入且不建上下文）。
  snapshot = await host.handler('subagent-dispatches', { parentId: 'parent-1' })
  assert.equal(snapshot.value.records.length, 2)

  // 过滤：无关父会话 / turn 命中 / turn 未命中。
  snapshot = await host.handler('subagent-dispatches', { parentId: 'parent-other' })
  assert.equal(snapshot.value.records.length, 0)
  snapshot = await host.handler('subagent-dispatches', { parentId: 'parent-1', turn: 2 })
  assert.equal(snapshot.value.records.length, 2)
  snapshot = await host.handler('subagent-dispatches', { parentId: 'parent-1', turn: 99 })
  assert.equal(snapshot.value.records.length, 0)

  // disposer 后 seam 还原、监听摘除：不再新增记录，已有记录仍可读。
  host.dispose()
  await registry.start('spawn', { label: 'c', parent: parentWithTurn })
  const afterDispose = await host.handler('subagent-dispatches', { parentId: 'parent-1' })
  assert.equal(afterDispose.value.records.length, 2)
})

test('subagent-route-save：回退列表白名单校验、持久化与 follow 快照回读', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-fallback-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const llm = fakeLlm([['deepseek-official', 'DeepSeek', ['deepseek-v4-flash', 'deepseek-v4-pro']], ['cpa', 'CPA', ['gpt-5.6-sol']]])
  llm.setModelInfo('deepseek-official', 'deepseek-v4-flash', { provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } })
  const host = createHost({ featureSettings: {}, services: { subagents: fakeSubagents().registry, llm }, env: { DSH_HOME: dshHome } })

  // follow + 回退默认值：列表外条目整体拒绝（fail-closed）。
  assert.equal((await host.handler('subagent-route-save', { mode: 'follow', fallbacks: [{ provider: 'nope', model: 'x' }] })).error, 'invalid-fallback-route')
  assert.equal((await host.handler('subagent-route-save', { mode: 'follow', fallbacks: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' }] })).error, 'invalid-fallback-route')
  // custom 需主路由有效；回退与主路由同闸，effort 复核。
  assert.equal((await host.handler('subagent-route-save', { mode: 'custom', provider: 'nope', model: 'x', fallbacks: [{ provider: 'cpa', model: 'gpt-5.6-sol' }] })).error, 'invalid-model-route')
  assert.equal((await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', fallbacks: [{ provider: 'cpa', model: 'gpt-5.6-sol', reasoningEffort: 'max' }] })).error, 'invalid-fallback-route')

  // follow + 合法回退（含 effort）落盘并可回读；重复条目去重。
  const saved = await host.handler('subagent-route-save', { mode: 'follow', fallbacks: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' }, { provider: 'cpa', model: 'gpt-5.6-sol' }, { provider: 'cpa', model: 'gpt-5.6-sol' }] })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.fallbacks, [
    { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' },
    { provider: 'cpa', model: 'gpt-5.6-sol' },
  ])
  const raw = JSON.parse(await readFile(join(dshHome, 'dsh-service-subagent-route.json'), 'utf8'))
  assert.deepEqual(raw, { version: 1, mode: 'follow', fallbacks: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' }, { provider: 'cpa', model: 'gpt-5.6-sol' }] })
  const snapshot = await host.handler('subagent-route', {})
  assert.equal(snapshot.value.mode, 'follow')
  assert.deepEqual(snapshot.value.fallbacks, [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' }, { provider: 'cpa', model: 'gpt-5.6-sol' }])

  // 重存 follow 不带回退 → 落盘清掉 fallbacks 字段。
  await host.handler('subagent-route-save', { mode: 'follow' })
  const after = JSON.parse(await readFile(join(dshHome, 'dsh-service-subagent-route.json'), 'utf8'))
  assert.deepEqual(after, { version: 1, mode: 'follow' })

  // custom + 回退：主路由与回退并存；inherit 丢弃回退。
  const customSaved = await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-pro', fallbacks: [{ provider: 'cpa', model: 'gpt-5.6-sol' }] })
  assert.equal(customSaved.ok, true)
  assert.equal(customSaved.mode, 'custom')
  assert.deepEqual(customSaved.fallbacks, [{ provider: 'cpa', model: 'gpt-5.6-sol' }])
  await host.handler('subagent-route-save', { mode: 'inherit' })
  const rawInherit = JSON.parse(await readFile(join(dshHome, 'dsh-service-subagent-route.json'), 'utf8'))
  assert.deepEqual(rawInherit, { version: 1, mode: 'inherit' })
  // 重启后回读 follow+custom 的持久化回退。
  await host.handler('subagent-route-save', { mode: 'follow', fallbacks: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }] })
  const rebooted = createHost({ featureSettings: {}, services: { subagents: fakeSubagents().registry, llm }, env: { DSH_HOME: dshHome } })
  const rebootedSnapshot = await rebooted.handler('subagent-route', {})
  assert.deepEqual(rebootedSnapshot.value.fallbacks, [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }])
})

test('subagent-route seam：回退链路——follow 父路由不可路由落到回退；custom 落盘回退同理', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-seam-fallback-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  // 预写 custom 配置（绕过 API 白名单闸）：主路由不在 llm 清单、首回退也不可路由 → 落到带 effort 的第二回退。
  await writeFile(join(dshHome, 'dsh-service-subagent-route.json'), JSON.stringify({
    version: 1, mode: 'custom', provider: 'not-installed', model: 'm',
    fallbacks: [
      { provider: 'not-installed-2', model: 'x' },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    ],
  }), { mode: 0o600 })
  const llm = fakeLlm([['deepseek-official', 'DeepSeek', ['deepseek-v4-flash', 'deepseek-v4-pro']]])
  llm.setModelInfo('deepseek-official', 'deepseek-v4-pro', { provider: 'deepseek-official', id: 'deepseek-v4-pro', name: 'Pro', reasoning: { efforts: [{ id: 'high', name: 'High' }] } })
  const { registry, calls } = fakeSubagents()
  const host = createHost({ featureSettings: {}, services: { subagents: registry, llm }, env: { DSH_HOME: dshHome } })
  // 配置异步加载：await 一次快照确保 subagentRouteConfig 已从磁盘就位再派生。
  await host.handler('subagent-route', {})

  // custom：主路由与首回退均不可路由 → 顺序落到第二回退（effort 由候选透传，绑定路径与主路由同）。
  await registry.start('spawn', { label: 'a', parent: {} })
  assert.deepEqual(calls[0].request.agentOptions, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })

  // follow + 回退：父路由的渠道已卸载 → 注入回退[0]。
  await host.handler('subagent-route-save', { mode: 'follow', fallbacks: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }] })
  await registry.start('spawn', { label: 'b', parent: { session: { requestHeader: () => ({ config: { provider: 'cpa', model: 'gpt-5.6-sol' } }) } } })
  assert.deepEqual(calls[1].request.agentOptions, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  host.dispose()
})
test('subagent-route-save：llm 缺席时带回退的 follow 保存被拒（llm-unavailable）', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-fallback-bare-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const host = createHost({ env: { DSH_HOME: dshHome } })
  assert.equal((await host.handler('subagent-route-save', { mode: 'follow', fallbacks: [{ provider: 'x', model: 'y' }] })).error, 'llm-unavailable')
  assert.equal((await host.handler('subagent-route-save', { mode: 'follow' })).ok, true)
})

test('subagent-route：宿主无 subagents/llm 服务时 available=false、模型清单为空、custom 保存被拒', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-bare-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const host = createHost({ env: { DSH_HOME: dshHome } })
  const snapshot = await host.handler('subagent-route', {})
  assert.equal(snapshot.ok, true)
  assert.equal(snapshot.value.available, false)
  assert.equal(snapshot.value.mode, 'inherit')
  assert.deepEqual(snapshot.value.models, [])
  assert.equal((await host.handler('subagent-route-save', { mode: 'custom', provider: 'p', model: 'm' })).error, 'llm-unavailable')
  // follow 不需要 llm 目录，允许保存。
  assert.equal((await host.handler('subagent-route-save', { mode: 'follow' })).ok, true)
})

test('publicSubagentReasoning：把 adapter reasoning metadata 裁剪成安全普通 JSON', () => {
  assert.equal(publicSubagentReasoning(null), undefined)
  assert.equal(publicSubagentReasoning('x'), undefined)
  assert.equal(publicSubagentReasoning({}), undefined)
  assert.equal(publicSubagentReasoning({ efforts: [] }), undefined)
  assert.deepEqual(publicSubagentReasoning({
    efforts: [{ id: 'low', name: 'Low' }, { id: 'low', name: 'Duplicate' }, { id: '', name: 'empty' }, 42, { id: 'high', name: 'High', description: 'More deliberate' }],
    defaultEffort: 'low',
  }), { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: 'More deliberate' }], defaultEffort: 'low' })
  // name 缺失回退 id；非空 description 保留。
  assert.deepEqual(publicSubagentReasoning({ efforts: [{ id: 'x', name: '' }, { id: 'y', name: 'Y', description: '' }] }), { efforts: [{ id: 'x', name: 'x' }, { id: 'y', name: 'Y' }] })
  // 只有 defaultEffort 时返回它。
  assert.deepEqual(publicSubagentReasoning({ defaultEffort: 'low' }), { defaultEffort: 'low' })
})

test('parseSubagentRouteText：version-1 带/不带 reasoningEffort 解析，空值与非字符串不保留', () => {
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'custom', provider: 'p', model: 'm' })), { version: 1, mode: 'custom', provider: 'p', model: 'm' })
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'custom', provider: 'p', model: 'm', reasoningEffort: 'low' })), { version: 1, mode: 'custom', provider: 'p', model: 'm', reasoningEffort: 'low' })
  // 空白/空字符串不保留；非字符串忽略。
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'custom', provider: 'p', model: 'm', reasoningEffort: '  ' })), { version: 1, mode: 'custom', provider: 'p', model: 'm' })
  assert.deepEqual(parseSubagentRouteText(JSON.stringify({ version: 1, mode: 'custom', provider: 'p', model: 'm', reasoningEffort: 7 })), { version: 1, mode: 'custom', provider: 'p', model: 'm' })
})

test('resolveSubagentInjection：custom 附带 reasoningEffort，inherit/follow 不携带', () => {
  assert.deepEqual(resolveSubagentInjection({}, { mode: 'custom', provider: 'p', model: 'm', reasoningEffort: 'low' }, { isRoutable: () => true }), { provider: 'p', model: 'm', reasoningEffort: 'low' })
  // 空 reasoningEffort 不携带。
  assert.deepEqual(resolveSubagentInjection({}, { mode: 'custom', provider: 'p', model: 'm', reasoningEffort: '' }, { isRoutable: () => true }), { provider: 'p', model: 'm' })
  // follow 只带 provider/model，不设置 reasoningEffort。
  const parent = { session: { requestHeader: () => ({ config: { provider: 'a', model: 'b' } }) } }
  assert.deepEqual(resolveSubagentInjection({ parent }, { mode: 'follow' }, { readParentHeader: (p) => p?.session?.requestHeader?.()?.config }), { provider: 'a', model: 'b' })
})

test('subagent-route：快照返回精确模型 reasoning metadata；保存校验等级、空值不持久化、跨重启恢复、follow/inherit 清理', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-reasoning-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const llm = fakeLlm([['deepseek-official', 'DeepSeek', ['deepseek-v4-flash']]])
  llm.setModelInfo('deepseek-official', 'deepseek-v4-flash', { id: 'deepseek-v4-flash', name: 'Model A', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: 'More deliberate' }], defaultEffort: 'low' } })
  const host = createHost({ featureSettings: {}, services: { subagents: fakeSubagents().registry, llm }, env: { DSH_HOME: dshHome } })

  const snap = await host.handler('subagent-route', {})
  assert.equal(snap.ok, true)
  const modelEntry = snap.value.models.find((item) => item.provider === 'deepseek-official' && item.id === 'deepseek-v4-flash')
  assert.deepEqual(modelEntry.reasoning, { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: 'More deliberate' }], defaultEffort: 'low' })

  // 保存支持等级。
  const saved = await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
  assert.deepEqual(saved, { ok: true, mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })

  // 空值代表「使用模型默认」→ 不持久化。
  await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: '' })
  const emptySnap = await host.handler('subagent-route', {})
  assert.equal(emptySnap.value.reasoningEffort, undefined)

  // 再次保存支持等级，跨重启恢复。
  await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'low' })
  const rebooted = createHost({ featureSettings: {}, services: { subagents: fakeSubagents().registry, llm }, env: { DSH_HOME: dshHome } })
  const restored = await rebooted.handler('subagent-route', {})
  assert.equal(restored.value.mode, 'custom')
  assert.equal(restored.value.reasoningEffort, 'low')

  // 不支持 / 非字符串。
  assert.equal((await rebooted.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'nope' })).error, 'invalid-reasoning-effort')
  assert.equal((await rebooted.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 5 })).error, 'invalid-reasoning-effort')

  // follow 清理 reasoningEffort。
  await rebooted.handler('subagent-route-save', { mode: 'follow' })
  const afterFollow = await rebooted.handler('subagent-route', {})
  assert.equal(afterFollow.value.mode, 'follow')
  assert.equal(afterFollow.value.reasoningEffort, undefined)

  // inherit 落盘干净。
  await rebooted.handler('subagent-route-save', { mode: 'inherit' })
  const raw = JSON.parse(await readFile(join(dshHome, 'dsh-service-subagent-route.json'), 'utf8'))
  assert.deepEqual(raw, { version: 1, mode: 'inherit' })
})

test('subagent-route：Custom 把 reasoningEffort 注入首个 agent/request，已建立值/显式路由/功能关闭不覆盖', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-inject-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const llm = fakeLlm([['deepseek-official', 'DeepSeek', ['deepseek-v4-flash']]])
  llm.setModelInfo('deepseek-official', 'deepseek-v4-flash', { id: 'deepseek-v4-flash', name: 'Model A', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } })
  let emitCreated
  const { registry, createdAgents } = fakeSubagents((agent) => emitCreated?.(agent))
  const host = createHost({ featureSettings: {}, services: { subagents: registry, llm }, env: { DSH_HOME: dshHome } })
  emitCreated = (agent) => { void host.fire('agent/created', { agent }) }

  await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })

  // 普通派生（无显式 provider/model）：先注入 provider/model，再在首请求补入 reasoningEffort。
  await registry.start('spawn', { label: 'a', parent: {} })
  assert.deepEqual(createdAgents[0].options, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  const proposal = await host.fire('agent/request', { agent: createdAgents[0] }, async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
  assert.deepEqual(proposal, { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })

  // proposal 已自带 reasoningEffort → 不覆盖，且绑定视为已消费。
  const owned = await host.fire('agent/request', { agent: createdAgents[0] }, async () => ({ provider: 'p', model: 'm', reasoningEffort: 'low' }))
  assert.equal(owned.reasoningEffort, 'low')

  // 绑定已在首个请求结算后消费：后续 waterfall 不再补标（即使 proposal 缺该字段）。
  const subsequent = await host.fire('agent/request', { agent: createdAgents[0] }, async () => ({ provider: 'p', model: 'm' }))
  assert.equal(subsequent.reasoningEffort, undefined)

  // 显式 provider/model：seam 不注入，也无 reasoningEffort 绑定。
  await registry.start('spawn', { label: 'b', parent: {}, agentOptions: { provider: 'cpa', model: 'gpt-5.6-sol' } })
  const explicitProposal = await host.fire('agent/request', { agent: createdAgents[1] }, async () => ({ provider: 'cpa', model: 'gpt-5.6-sol' }))
  assert.equal(explicitProposal.reasoningEffort, undefined)

  // 功能关闭：seam 不注入 provider/model，request listener 也不注入 reasoningEffort。
  await host.updateFeatureSettings({ subagentRoute: false })
  await registry.start('spawn', { label: 'c', parent: {} })
  assert.deepEqual(createdAgents[2].options, {})
  const disabledProposal = await host.fire('agent/request', { agent: createdAgents[2] }, async () => ({ provider: 'p', model: 'm' }))
  assert.equal(disabledProposal.reasoningEffort, undefined)
})

test('subagent-route：等级随 proposal 实际目标模型运行时复审——漂移丢弃、判定失败 fail-open、绑定不复活', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-subagent-revalidate-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const llm = fakeLlm([['deepseek-official', 'DeepSeek', ['deepseek-v4-flash']]])
  llm.setModelInfo('deepseek-official', 'deepseek-v4-flash', { id: 'deepseek-v4-flash', name: 'Model A', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } })
  let emitCreated
  const { registry, createdAgents } = fakeSubagents((agent) => emitCreated?.(agent))
  const host = createHost({ featureSettings: {}, services: { subagents: registry, llm }, env: { DSH_HOME: dshHome } })
  emitCreated = (agent) => { void host.fire('agent/created', { agent }) }
  await host.handler('subagent-route-save', { mode: 'custom', provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high' })
  await registry.start('spawn', { label: 'a', parent: {} })

  // 元数据漂移：请求实际路由到的模型不再声明该等级 → 按复审结果丢弃，不影响派生本身。
  llm.setModelInfo('deepseek-official', 'deepseek-v3', { id: 'deepseek-v3', name: 'Model B', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } })
  const drifted = await host.fire('agent/request', { agent: createdAgents[0] }, async () => ({ provider: 'deepseek-official', model: 'deepseek-v3' }))
  assert.equal(drifted.reasoningEffort, undefined)
  // 同一 agent 的绑定已随首请求消费。
  const again = await host.fire('agent/request', { agent: createdAgents[0] }, async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
  assert.equal(again.reasoningEffort, undefined)

  // 无法判定（resolveModelInfo 失败）→ fail-open 放行，保持注入行为。
  llm.resolveModelInfo = () => Promise.reject(new Error('adapter offline'))
  await registry.start('spawn', { label: 'b', parent: {} })
  const degraded = await host.fire('agent/request', { agent: createdAgents[1] }, async () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }))
  assert.equal(degraded.reasoningEffort, 'high')
})


// ── v0.30 移动端适配·宿主半：大 JSON 响应透明压缩 ──────────────────────────

test('mobile compression pure helpers classify content types, encodings and vary tokens', () => {
  assert.equal(isCompressibleJsonType('application/json'), true)
  assert.equal(isCompressibleJsonType('application/json; charset=utf-8'), true)
  assert.equal(isCompressibleJsonType('APPLICATION/JSON'), true)
  assert.equal(isCompressibleJsonType('application/x-ndjson'), false)
  assert.equal(isCompressibleJsonType('text/event-stream'), false)
  assert.equal(isCompressibleJsonType('text/html'), false)
  assert.equal(isCompressibleJsonType(undefined), false)

  assert.equal(pickCompressionEncoding('br, gzip, deflate'), 'br')
  assert.equal(pickCompressionEncoding('gzip, deflate'), 'gzip')
  assert.equal(pickCompressionEncoding('deflate'), null)
  assert.equal(pickCompressionEncoding(undefined), null)
  // 子串不算协商命中：brotli/gzip 必须是独立 token
  assert.equal(pickCompressionEncoding('gzipper'), null)

  assert.equal(appendVaryToken(undefined, 'Accept-Encoding'), 'Accept-Encoding')
  assert.equal(appendVaryToken('User-Agent', 'Accept-Encoding'), 'User-Agent, Accept-Encoding')
  assert.equal(appendVaryToken('accept-encoding', 'Accept-Encoding'), 'accept-encoding')
})

test('mobile compression patches a real http server: gzip/br large JSON, verbatim small JSON, untouched html and SSE', async (t) => {
  const { createServer } = await import('node:http')
  const { gunzipSync, brotliDecompressSync } = await import('node:zlib')
  const dispose = ensureMobileResponseCompression()
  t.after(() => dispose())

  const bigJson = JSON.stringify({ history: Array.from({ length: 800 }, (_, i) => ({ role: 'user', text: `message-${i}-` + 'x'.repeat(40) })) })
  assert.ok(bigJson.length > 4 * 1024, 'fixture should exceed the compress threshold')

  const server = createServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(bigJson)
    } else if (req.url === '/small') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    } else if (req.url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end('<html>' + 'y'.repeat(64 * 1024) + '</html>')
    } else if (req.url === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream; content-type-ish-json=1' })
      res.end('data: '.repeat(2048))
    } else if (req.url === '/setheader') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.setHeader('x-extra', 'kept')
      res.end(bigJson)
    } else if (req.url === '/no-args-writehead') {
      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end(bigJson)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  t.after(() => new Promise((resolvePromise) => server.close(() => resolvePromise())))
  const port = server.address().port

  const request = ({ path, acceptEncoding = 'gzip, deflate, br', method = 'GET' }) => new Promise((resolvePromise, rejectPromise) => {
    const request_ = http.request({ host: '127.0.0.1', port, path, method, headers: acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    request_.on('error', rejectPromise)
    request_.end()
  })

  // 大 JSON + 仅 gzip：压缩生效、解压相等、长度头与实际字节一致、Vary 追加
  const gzipped = await request({ path: '/json', acceptEncoding: 'gzip, deflate' })
  assert.equal(gzipped.status, 200)
  assert.equal(gzipped.headers['content-encoding'], 'gzip')
  assert.ok(String(gzipped.headers.vary).toLowerCase().includes('accept-encoding'))
  assert.equal(gzipped.body.length, Number(gzipped.headers['content-length']))
  assert.equal(gunzipSync(gzipped.body).toString('utf8'), bigJson)

  // br 优先
  const brotlied = await request({ path: '/json', acceptEncoding: 'br, gzip' })
  assert.equal(brotlied.headers['content-encoding'], 'br')
  assert.equal(brotliDecompressSync(brotlied.body).toString('utf8'), bigJson)

  // 客户端不接受压缩 → 原样透传
  const identity = await request({ path: '/json', acceptEncoding: 'identity' })
  assert.equal(identity.headers['content-encoding'], undefined)
  assert.equal(identity.body.toString('utf8'), bigJson)
  assert.equal(identity.headers.vary, undefined)

  // 小 JSON：不压缩，body 字节级一致
  const small = await request({ path: '/small' })
  assert.equal(small.headers['content-encoding'], undefined)
  assert.equal(small.body.toString('utf8'), '{"ok":true}')

  // HTML 与 SSE：即便体积大也字节级透传（SSE 的 content-type 里含 "json" 样式子串也不行）
  const html = await request({ path: '/html' })
  assert.equal(html.headers['content-encoding'], undefined)
  const sse = await request({ path: '/sse' })
  assert.equal(sse.headers['content-encoding'], undefined)

  // writeHead 之后 setHeader：最终头集合保留后设的头
  const withExtra = await request({ path: '/setheader', acceptEncoding: 'gzip' })
  assert.equal(withExtra.headers['content-encoding'], 'gzip')
  assert.equal(withExtra.headers['x-extra'], 'kept')

  // 无实参 writeHead 路径（statusCode + setHeader）：设计上识别不到，透传不压缩
  const implicit = await request({ path: '/no-args-writehead' })
  assert.equal(implicit.headers['content-encoding'], undefined)
  assert.equal(implicit.body.toString('utf8'), bigJson)

  // HEAD：响应头应与 GET 同语义（含协商出的压缩头），body 本就不上线
  const head = await request({ path: '/json', method: 'HEAD', acceptEncoding: 'gzip' })
  assert.equal(head.status, 200)
  assert.equal(head.headers['content-encoding'], 'gzip')
  assert.equal(head.body.length, 0)
})

test('mobile compression disposer restores the original prototype methods and keeps serving responses', async (t) => {
  const { createServer } = await import('node:http')
  const proto = (await import('node:http')).ServerResponse.prototype
  const beforeWriteHead = proto.writeHead
  const beforeWrite = proto.write
  const beforeEnd = proto.end

  const dispose = installMobileResponseCompression()
  assert.notEqual(proto.writeHead, beforeWriteHead)
  dispose()
  assert.equal(proto.writeHead, beforeWriteHead)
  assert.equal(proto.write, beforeWrite)
  assert.equal(proto.end, beforeEnd)

  // 还原后服务器照常工作（补丁期间建立的连接不受影响）
  const dispose2 = ensureMobileResponseCompression()
  const disposeAgain = ensureMobileResponseCompression() // 单例：同一份 disposer
  disposeAgain()
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"after":"dispose"}')
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  t.after(() => new Promise((resolvePromise) => server.close(() => resolvePromise())))
  const port = server.address().port
  const payload = await new Promise((resolvePromise, rejectPromise) => {
    const request_ = http.request({ host: '127.0.0.1', port, path: '/' , headers: { 'accept-encoding': 'gzip' } }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolvePromise({ headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request_.on('error', rejectPromise)
    request_.end()
  })
  assert.equal(payload.headers['content-encoding'], undefined)
  assert.equal(payload.body, '{"after":"dispose"}')
})

test('mobileAdaptation feature gate installs and restores response compression hot', async (t) => {
  const proto = (await import('node:http')).ServerResponse.prototype
  const beforeWriteHead = proto.writeHead
  t.after(() => {
    if (proto.writeHead !== beforeWriteHead) proto.writeHead = beforeWriteHead
  })

  const host = createHost({ featureSettings: { mobileAdaptation: false } })
  assert.equal(proto.writeHead, beforeWriteHead, 'patch must stay off when the feature starts disabled')

  await host.updateFeatureSettings({ mobileAdaptation: true })
  assert.notEqual(proto.writeHead, beforeWriteHead, 'enabling the feature must install the patch without restart')

  await host.updateFeatureSettings({ mobileAdaptation: false })
  assert.equal(proto.writeHead, beforeWriteHead, 'disabling the feature must restore the prototype')
})

// ── 会话管理（v0.35）───────────────────────────────────────────────

function sessionManagerServices() {
  const eventsBySession = {
    'session-alpha': [
      { seq: 0, type: 'session/created', time: 1000, data: {} },
      { seq: 1, type: 'user/message', time: 1001, data: { content: [{ type: 'text', text: '你好，帮我查一下' }] } },
      { seq: 2, type: 'assistant/message', time: 1002, data: { message: { content: [{ type: 'text', text: '好的，正在查询' }] } } },
      { seq: 3, type: 'tool/call', time: 1003, data: { name: 'bash', arguments: '{"command":"ls"}' } },
      { seq: 4, type: 'tool/result', time: 1004, data: { message: { content: [{ type: 'text', text: 'output' }] } } },
      { seq: 5, type: 'assistant/message', time: 1005, data: { message: { content: [{ type: 'text', text: '查询完成：余额充足' }] } } },
    ],
    'session-beta': [
      { seq: 0, type: 'user/message', time: 2000, data: { content: [{ type: 'text', text: 'alpha 测试会话' }] } },
    ],
  }
  const headers = {
    'session-alpha': { id: 'session-alpha', createdAt: 1000, cwd: '/workspace' },
    'session-beta': { id: 'session-beta', createdAt: 2000, cwd: '/workspace/projects' },
  }
  const persistence = {
    supportsRawArtifacts: true,
    locate(meta) {
      return { kind: 'jsonl', path: `/sessions-root/${encodeURIComponent(meta.cwd ?? '_no-cwd')}/${meta.id}/session.jsonl` }
    },
  }
  const sessionQuery = {
    async listSessions() {
      return [
        { header: { ...headers['session-alpha'] }, live: true, persisted: true },
        { header: { ...headers['session-beta'] }, live: false, persisted: true },
      ]
    },
    async readSession(id) {
      const events = eventsBySession[id]
      if (events === undefined) {
        const error = new Error(`session '${id}' not found`)
        error.code = 'SESSION_QUERY_NOT_FOUND'
        throw error
      }
      return { session: { ...headers[id] }, events: events.map((event) => ({ ...event })) }
    },
    async readTitleSnapshots(ids) {
      return ids.map((sessionId) => ({
        sessionId,
        status: 'fulfilled',
        value: { session: headers[sessionId], title: { title: `标题-${sessionId}` } },
      }))
    },
    async filterEvents(sessionId, filters) {
      const textFilter = filters.find((filter) => filter.kind === 'text')
      if (textFilter === undefined) return []
      const query = textFilter.text.trim().toLowerCase()
      return (eventsBySession[sessionId] ?? [])
        .filter((event) => JSON.stringify(event).toLowerCase().includes(query))
        .map((event) => ({
          seq: event.seq,
          type: event.type,
          time: event.time,
          surface: 'current',
          sessionId,
          text: event.data?.content?.[0]?.text ?? '',
        }))
    },
  }
  const workspaceRegistry = {
    archivedSessionIds: ['session-beta'],
    async archiveSession(id) {
      if (id === 'session-missing') {
        const error = new Error('cannot archive unknown session')
        error.name = 'WorkspaceUnknownSessionError'
        throw error
      }
      if (!this.archivedSessionIds.includes(id)) this.archivedSessionIds = [...this.archivedSessionIds, id]
    },
  }
  const sessions = {
    get(id) {
      return id === 'session-alpha' ? { id } : undefined
    },
  }
  return { sessionQuery, persistence, workspaceRegistry, sessions, headers, eventsBySession, persistence }
}

test('session management list merges live/cold sessions, archive marks, titles, and deleted filter (no eager sizes)', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const services = sessionManagerServices()
  // v0.36：列表不下发体积（体积走 sessions-bytes 懒加载），因此无需构造会话目录。
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery, workspaceRegistry: services.workspaceRegistry, sessions: services.sessions }, env: { DSH_HOME: dshHome } })
  const result = await handler('sessions-list', {})
  assert.equal(result.ok, true)
  assert.equal(result.value.available, true)
  const byId = new Map(result.value.items.map((item) => [item.id, item]))
  assert.equal(byId.size, 2)
  assert.equal(byId.get('session-alpha').live, true)
  assert.equal(byId.get('session-alpha').archived, false)
  assert.equal(byId.get('session-alpha').title, '标题-session-alpha')
  assert.equal(byId.get('session-beta').live, false)
  assert.equal(byId.get('session-beta').archived, true)
  assert.equal(byId.get('session-beta').title, '标题-session-beta')
  assert.equal(byId.get('session-beta').bytes, undefined, 'list items carry no size field — sizes are lazy-loaded')
  assert.deepEqual(result.value.archivedIds, ['session-beta'])
  assert.deepEqual(result.value.deleted, [])

  // v0.35 用户反馈：默认视图只拉归档 scope——只回归档条目，不逐会话扫描。
  const archivedResult = await handler('sessions-list', { scope: 'archived' })
  assert.equal(archivedResult.ok, true)
  assert.deepEqual(archivedResult.value.items.map((item) => item.id), ['session-beta'])
  assert.deepEqual(archivedResult.value.archivedIds, ['session-beta'])

  // deleted scope 只回已删除记录（不含会话条目）。
  const deletedResult = await handler('sessions-list', { scope: 'deleted' })
  assert.equal(deletedResult.ok, true)
  assert.deepEqual(deletedResult.value.items, [])
  assert.deepEqual(deletedResult.value.deleted, [])
  const unknownScope = await handler('sessions-list', { scope: 'bogus' })
  assert.deepEqual(unknownScope.value.items.map((item) => item.id), ['session-beta', 'session-alpha'], 'unknown scope falls back to full list (created desc)')
})

test('session management sizes are lazy-loaded, cached in-process and reusable without restart', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-bytes-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const services = sessionManagerServices()
  const baseListSessions = services.sessionQuery.listSessions
  services.sessionQuery.listSessions = async () => [
    ...(await baseListSessions()),
    { header: { id: 'session-orphan', createdAt: 500, cwd: '/workspace/missing' }, live: false, persisted: true },
  ]
  // 真实目录：alpha（live 也有目录）+ beta（冷+归档），另有一个列表中存在但目录缺失的 orphan。
  const alphaDir = join(dshHome, 'sessions-root', 'session-alpha')
  const betaDir = join(dshHome, 'sessions-root', 'session-beta')
  await mkdir(alphaDir, { recursive: true })
  await mkdir(betaDir, { recursive: true })
  await writeFile(join(alphaDir, 'session.jsonl'), '{"seq":0}\n') // 10 字节
  await writeFile(join(betaDir, 'session.jsonl'), '{"seq":0}\n{"seq":1}\n') // 20 字节
  const persistence = {
    locate(meta) { return { kind: 'jsonl', path: join(dshHome, 'sessions-root', meta.id, 'session.jsonl') } },
  }
  const { handler } = createHost({
    services: { sessionQuery: services.sessionQuery, workspaceRegistry: services.workspaceRegistry, sessions: services.sessions, sessionPersistence: persistence },
    env: { DSH_HOME: dshHome },
  })

  // 第一次：缺缓存 → listSessions 定位 + 逐目录 stat；未知会话返回 null。
  const first = await handler('sessions-bytes', { ids: ['session-beta', 'session-alpha', 'session-orphan', 'session-missing', 'session-beta'] })
  assert.equal(first.ok, true)
  assert.equal(first.value.bytes['session-beta'], 20)
  assert.equal(first.value.bytes['session-alpha'], 10)
  assert.equal(first.value.bytes['session-orphan'], null, 'listed session with a missing archive returns null')
  assert.equal(first.value.bytes['session-missing'], null, 'unknown session returns null (not cached)')
  await rm(betaDir, { recursive: true, force: true })
  const missingArchive = await handler('sessions-bytes', { ids: ['session-beta'] })
  assert.equal(missingArchive.value.bytes['session-beta'], 20, 'a previously cached archive size remains available until invalidated')

  // 第二次：同一宿主实例（不重启）→ 全命中缓存，零 listSessions、零磁盘访问。
  const originalListSessions = services.sessionQuery.listSessions
  let listSessionsCalls = 0
  services.sessionQuery.listSessions = async (...args) => {
    listSessionsCalls += 1
    return originalListSessions(...args)
  }
  const second = await handler('sessions-bytes', { ids: ['session-beta', 'session-alpha'] })
  assert.equal(second.ok, true)
  assert.equal(second.value.bytes['session-beta'], 20, 'cached size returned')
  assert.equal(second.value.bytes['session-alpha'], 10, 'cached size returned')
  assert.equal(listSessionsCalls, 0, 'cache hits skip the listSessions scan entirely')

  // 只对未命中的 id 才查（半命中）：beta 已有缓存，missing 未缓存 → 一次 listSessions。
  const third = await handler('sessions-bytes', { ids: ['session-beta', 'session-missing'] })
  assert.equal(third.ok, true)
  assert.equal(third.value.bytes['session-beta'], 20)
  assert.equal(third.value.bytes['session-missing'], null)
  assert.equal(listSessionsCalls, 1, 'partial hit performs one listSessions for the miss only')

  // payload 校验：非数组 / 空数组拒绝，id 去重且只收字符串。
  assert.deepEqual(await handler('sessions-bytes', { ids: 'nope' }), { ok: false, error: 'invalid-session-ids' })
  assert.deepEqual(await handler('sessions-bytes', { ids: [] }), { ok: false, error: 'invalid-session-ids' })
  const mixed = await handler('sessions-bytes', { ids: ['session-beta', 7, '', 'session-beta'] })
  assert.equal(mixed.ok, true)
  assert.deepEqual(Object.keys(mixed.value.bytes), ['session-beta'])
})

test('session list titles are revision-cached, only refetched on change, and survive host restarts', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-titles-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const headers = {
    'session-alpha': { id: 'session-alpha', createdAt: 1000, cwd: '/workspace/projects' },
    'session-beta': { id: 'session-beta', createdAt: 900, cwd: '/workspace/projects' },
  }
  // readTitleSnapshots 在真实宿主里对每个冷会话全量解析整份日志——用计数器断言只按需发生。
  let titleCalls = 0
  let titleIds = []
  const revisions = new Map([['session-alpha', 'rev-a'], ['session-beta', 'rev-b']])
  const sessionQuery = {
    async listSessions() {
      return [
        { header: { ...headers['session-alpha'] }, live: false, persisted: true },
        { header: { ...headers['session-beta'] }, live: false, persisted: true },
      ]
    },
    async readTitleSnapshots(ids) {
      titleCalls += 1
      titleIds = [...ids]
      return ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { title: { title: `标题-${sessionId}` } } }))
    },
  }
  const sessionPersistence = {
    async listSnapshots() {
      return [...revisions].map(([id, revision]) => ({ header: { id }, revision }))
    },
  }
  const hostOptions = () => ({
    services: { sessionQuery, sessionPersistence, workspaceRegistry: { archivedSessionIds: [] }, sessions: { get: () => undefined } },
    env: { DSH_HOME: dshHome },
  })

  // 首次：无缓存 → 一次全量标题拉取（2 ids），并携带当次 revision 入缓存。
  const first = createHost(hostOptions())
  const firstList = await first.handler('sessions-list', {})
  assert.equal(firstList.ok, true)
  assert.equal(titleCalls, 1)
  assert.deepEqual([...titleIds].sort(), ['session-alpha', 'session-beta'])
  assert.equal(firstList.value.items.find((item) => item.id === 'session-alpha').title, '标题-session-alpha')

  // 第二次：revision 未变 → 零整库日志重读，标题照常展示。
  const secondList = await first.handler('sessions-list', {})
  assert.equal(secondList.ok, true)
  assert.equal(titleCalls, 1, 'unchanged revisions skip the full-log title read entirely')
  assert.equal(secondList.value.items.find((item) => item.id === 'session-beta').title, '标题-session-beta', 'titles are served from cache')

  // revision 变更 → 只重读变更的那个会话。
  revisions.set('session-alpha', 'rev-a2')
  const thirdList = await first.handler('sessions-list', {})
  assert.equal(thirdList.ok, true)
  assert.equal(titleCalls, 2)
  assert.deepEqual(titleIds, ['session-alpha'], 'only the revision-changed session is refetched')

  // 等待落盘：磁盘缓存必须已含 rev-a2 再模拟宿主重启，避免写入竞态。
  const titlesFile = join(dshHome, 'dsh-service-session-titles.json')
  for (let i = 0; i < 200; i += 1) {
    try {
      const persisted = JSON.parse(await readFile(titlesFile, 'utf8'))
      if (persisted?.items?.['session-alpha']?.revision === 'rev-a2') break
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  // 宿主重启（同 DSH_HOME）：内存缓存已空，磁盘缓存 + revision 指纹命中 → 首个列表零重读。
  titleCalls = 0
  const restarted = createHost(hostOptions())
  const restartedList = await restarted.handler('sessions-list', {})
  assert.equal(restartedList.ok, true)
  assert.equal(titleCalls, 0, 'restart reuses the persisted title cache via stat revisions')
  assert.equal(restartedList.value.items.find((item) => item.id === 'session-alpha').title, '标题-session-alpha')
  assert.equal(restartedList.value.items.find((item) => item.id === 'session-beta').title, '标题-session-beta')
})

test('session event text matches the official semantic extractor contract', () => {
  const cases = [
    { type: 'user/message', data: { content: [{ type: 'text', text: ' first ' }, { type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'second' }] } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', name: 'bash', arguments: '{"command":"pwd"}' }, { type: 'tool-result', content: [{ type: 'text', text: 'done' }] }] } } },
    { type: 'tool/call', data: { name: 'read', arguments: '{"path":"README.md"}' } },
    { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'output' }] }, error: { name: 'ToolError', code: 'EFAIL' } } },
    { type: 'todo/write', data: { todos: [{ status: 'completed', content: 'ship it' }] } },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'boom' } } } },
    { type: 'turn/end', data: { reason: { kind: 'aborted' } } },
    { type: 'turn/end', data: { reason: { kind: 'max-tokens' } } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { type: 'turn/start', data: {} },
  ]
  assert.deepEqual(cases.map(sessionEventText), [
    'first\nsecond',
    'bash\n{"command":"pwd"}\ndone',
    'read\n{"path":"README.md"}',
    'output\nToolError\nEFAIL',
    'completed\nship it',
    'error\nboom',
    'aborted',
    'max-tokens',
    '',
    '',
  ])
})

test('session management view pages events with seq cursor and marks noise types', async (t) => {
  const services = sessionManagerServices()
  // v0.36：详情快照单槽位缓存——翻页/重复查看同一会话不再重复 readSession。
  const originalReadSession = services.sessionQuery.readSession
  let readSessionCalls = 0
  services.sessionQuery.readSession = async (...args) => {
    readSessionCalls += 1
    return originalReadSession(...args)
  }
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery }, featureSettings: { sessionManager: true } })

  const first = await handler('sessions-view', { id: 'session-alpha', cursor: undefined })
  assert.equal(first.ok, true)
  assert.equal(first.value.session.id, 'session-alpha')
  assert.equal(first.value.total, 6)
  assert.equal(first.value.items.length, 6)
  assert.ok(first.value.nextCursor === undefined)
  assert.equal(first.value.items[0].noise, true, 'session/created is a noise type')
  assert.equal(first.value.items[1].text, '你好，帮我查一下')
  assert.equal(first.value.items[2].text, '好的，正在查询')
  assert.equal(first.value.items[4].type, 'tool/result')
  assert.equal(readSessionCalls, 1, 'first page reads the session once')

  // 同一会话再次查看（翻页/重进详情）：缓存命中 → 零重复读取。
  const second = await handler('sessions-view', { id: 'session-alpha', cursor: undefined })
  assert.equal(second.ok, true)
  assert.equal(second.value.total, 6)
  assert.equal(readSessionCalls, 1, 'reopening the same session reuses the cached snapshot')

  // 换会话：单槽位整体替换 → 重读一次。
  const beta = await handler('sessions-view', { id: 'session-beta', cursor: undefined })
  assert.equal(beta.ok, true)
  assert.equal(beta.value.total, 1)
  assert.equal(readSessionCalls, 2, 'switching sessions replaces the single slot with one read')

  // 换回 alpha：槽位已被替换 → 再读一次，之后命中缓存。
  const alphaAgain = await handler('sessions-view', { id: 'session-alpha', cursor: undefined })
  assert.equal(alphaAgain.ok, true)
  assert.equal(alphaAgain.value.total, 6)
  assert.equal(readSessionCalls, 3, 'switching back re-reads after slot replacement')
  const alphaThird = await handler('sessions-view', { id: 'session-alpha', cursor: undefined })
  assert.equal(alphaThird.ok, true)
  assert.equal(readSessionCalls, 3, 'subsequent views of the current slot hit the cache')

  const missing = await handler('sessions-view', { id: 'session-missing' })
  assert.deepEqual(missing, { ok: false, error: 'session-not-found' })

  const badId = await handler('sessions-view', { id: '' })
  assert.deepEqual(badId, { ok: false, error: 'invalid-session-id' })

  const atEnd = await handler('sessions-view', { id: 'session-alpha', cursor: 5 })
  assert.deepEqual(atEnd.value.items, [], 'cursor at the final seq returns an empty page')
  assert.equal(atEnd.value.nextCursor, undefined)
  const beyondEnd = await handler('sessions-view', { id: 'session-alpha', cursor: 999 })
  assert.deepEqual(beyondEnd.value.items, [], 'cursor beyond the final seq must not restart from page one')
  assert.equal(beyondEnd.value.nextCursor, undefined)
})

test('session management view centers a hit window around a seq with clamped bounds and paging', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-window-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const services = sessionManagerServices()
  // 60 条用户消息（无噪音），验证窗口切片边界。
  const events = Array.from({ length: 60 }, (_, seq) => ({ seq, type: 'user/message', time: 1000 + seq, data: { content: [{ type: 'text', text: 'event ' + seq }] } }))
  services.sessionQuery.readSession = async (id) => ({ session: { id, createdAt: 1000, cwd: '/workspace' }, events: events.map((event) => ({ ...event })) })
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery }, featureSettings: { sessionManager: true } })

  // 中间命中：窗口 = [15, 45]，共 31 条；centerSeq 回传；nextCursor 指向窗口末条可续页。
  const mid = await handler('sessions-view', { id: 'session-alpha', center: 30 })
  assert.equal(mid.ok, true)
  assert.equal(mid.value.centerSeq, 30)
  assert.equal(mid.value.total, 60)
  assert.equal(mid.value.items.length, 31)
  assert.equal(mid.value.items[0].seq, 15)
  assert.equal(mid.value.items[30].seq, 45)
  assert.equal(mid.value.nextCursor, 45, 'paging may continue beyond the window end')

  // 行首附近命中：窗口被左端裁剪。
  const early = await handler('sessions-view', { id: 'session-alpha', center: 2 })
  assert.equal(early.ok, true)
  assert.equal(early.value.centerSeq, 2)
  assert.equal(early.value.items.length, 18, 'window starts at 0 and extends past the hit')
  assert.equal(early.value.items[0].seq, 0)

  // 行尾命中：窗口被右端裁剪，nextCursor 不再续页。
  const late = await handler('sessions-view', { id: 'session-alpha', center: 59 })
  assert.equal(late.ok, true)
  assert.equal(late.value.centerSeq, 59)
  assert.equal(late.value.items.length, 16, 'window ends at the last event')
  assert.equal(late.value.items[late.value.items.length - 1].seq, 59)
  assert.ok(late.value.nextCursor === undefined)

  // 越界 center 钳制到事件范围。
  const over = await handler('sessions-view', { id: 'session-alpha', center: 999 })
  assert.equal(over.ok, true)
  assert.equal(over.value.centerSeq, 59, 'center clamped to the last seq')

  // 无 center 时保持既有 cursor 分页语义（不混入窗口模式字段）。
  const page = await handler('sessions-view', { id: 'session-alpha', cursor: 45 })
  assert.equal(page.ok, true)
  assert.equal(page.value.items[0].seq, 46)
  assert.ok(page.value.centerSeq === undefined, 'cursor paging does not report centerSeq')
})

test('session management search scans cold and archived sessions with budget bounds and respects scope', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-search-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const services = sessionManagerServices()
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery, workspaceRegistry: services.workspaceRegistry, sessions: services.sessions }, env: { DSH_HOME: dshHome } })

  const all = await handler('sessions-search', { query: '查询', scope: 'all' })
  assert.equal(all.ok, true)
  assert.equal(all.value.available, true)
  // alpha 命中 3 处文本含「查询」，beta 无。
  const alphaHit = all.value.hits.find((hit) => hit.sessionId === 'session-alpha')
  assert.equal(alphaHit.title, '标题-session-alpha')
  assert.ok(alphaHit.items.length >= 1)
  assert.equal(all.value.hits.filter((hit) => hit.sessionId === 'session-beta').length, 0)

  const archived = await handler('sessions-search', { query: '查询', scope: 'archived' })
  assert.equal(archived.ok, true)
  // 归档区只有 session-beta（无「查询」命中）→ 无命中。
  assert.equal(archived.value.hits.length, 0)

  const empty = await handler('sessions-search', { query: '  ', scope: 'all' })
  assert.equal(empty.ok, true)
  assert.deepEqual(empty.value.hits, [])
})

test('session management search returns the official semantic document text as the snippet', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-search-text-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const services = sessionManagerServices()
  services.sessionQuery.filterEvents = async (sessionId) => sessionId === 'session-alpha'
    ? [{ sessionId, seq: 2, type: 'assistant/message', time: 1002, surface: 'current', text: '官方语义片段' }]
    : []
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery, workspaceRegistry: services.workspaceRegistry, sessions: services.sessions }, env: { DSH_HOME: dshHome } })

  const result = await handler('sessions-search', { query: '片段', scope: 'all' })
  assert.equal(result.ok, true)
  assert.equal(result.value.hits[0].items[0].snippet, '官方语义片段')
})

test('session management search enforces a global fifty-hit budget', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-search-budget-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const services = sessionManagerServices()
  const headers = Array.from({ length: 11 }, (_, index) => ({ id: 'session-' + index, createdAt: 2000 - index, cwd: '/workspace' }))
  services.sessionQuery.listSessions = async () => headers.map((header) => ({ header, live: false, persisted: true }))
  services.sessionQuery.readTitleSnapshots = async (ids) => ids.map((sessionId) => ({ sessionId, status: 'fulfilled', value: { session: headers.find((header) => header.id === sessionId), title: { title: sessionId } } }))
  services.sessionQuery.filterEvents = async (sessionId) => Array.from({ length: 5 }, (_, index) => ({ sessionId, seq: index, type: 'user/message', time: index, surface: 'current', text: sessionId + '-hit-' + index }))
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery, workspaceRegistry: { archivedSessionIds: [] } }, env: { DSH_HOME: dshHome } })

  const result = await handler('sessions-search', { query: 'hit', scope: 'all' })
  assert.equal(result.ok, true)
  assert.equal(result.value.hits.flatMap((hit) => hit.items).length, 50)
  assert.equal(result.value.hits.length, 10)
  assert.equal(result.value.hits.some((hit) => hit.sessionId === 'session-10'), false)
})

test('session management export validates existence and reuses official ZIP URL', async (t) => {
  const services = sessionManagerServices()
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery } })

  const ok = await handler('sessions-export', { id: 'session-beta' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.includesDescendants, true)
  assert.equal(ok.value.url, '/api/session.export?sessionId=session-beta&includeDescendants=true')

  const missing = await handler('sessions-export', { id: 'session-missing' })
  assert.deepEqual(missing, { ok: false, error: 'session-not-found' })
  const badId = await handler('sessions-export', { id: '' })
  assert.deepEqual(badId, { ok: false, error: 'invalid-session-id' })
})

test('session management archive calls workspace registry and maps unknown session', async (t) => {
  const services = sessionManagerServices()
  const { handler } = createHost({ services: { sessionQuery: services.sessionQuery, workspaceRegistry: services.workspaceRegistry } })

  const ok = await handler('sessions-archive', { id: 'session-alpha' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.archived, true)
  assert.deepEqual(ok.value.archivedSessionIds, ['session-beta', 'session-alpha'])

  const missing = await handler('sessions-archive', { id: 'session-missing' })
  assert.deepEqual(missing, { ok: false, error: 'session-not-found' })
})

test('session management delete keeps the archive when recording the deletion fails', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-delete-record-fail-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHomeFile = join(root, 'not-a-directory')
  await writeFile(dshHomeFile, 'occupied')
  const services = sessionManagerServices()
  const betaDir = join(root, 'cold-root', 'session-beta')
  await mkdir(betaDir, { recursive: true })
  await writeFile(join(betaDir, 'session.jsonl'), '{"seq":0}\n')
  const persistence = { locate: () => ({ kind: 'jsonl', path: join(betaDir, 'session.jsonl') }) }
  const { handler } = createHost({
    services: { sessionQuery: services.sessionQuery, workspaceRegistry: services.workspaceRegistry, sessions: services.sessions, sessionPersistence: persistence },
    env: { DSH_HOME: dshHomeFile },
  })

  const plan = await handler('sessions-delete-plan', { id: 'session-beta' })
  assert.equal(plan.ok, true)
  const result = await handler('sessions-delete', { planId: plan.value.planId })
  assert.equal(result.ok, false)
  assert.equal((await stat(betaDir)).isDirectory(), true, 'the archived log remains when the deletion record cannot be persisted')
})

test('session management delete is two-phase: plan lists consequences, live rejected, execution removes directory and records deleted', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-sessions-delete-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const services = sessionManagerServices()
  // beta 是冷会话（非 live），其目录指向 dshHome 之下以便断言删除落盘。
  const betaDir = join(dshHome, 'cold-root', 'session-beta')
  const missingDir = join(dshHome, 'cold-root', 'session-missing-archive')
  await mkdir(betaDir, { recursive: true })
  await writeFile(join(betaDir, 'session.jsonl'), '{"seq":0}\n')
  const persistence = {
    locate(meta) {
      if (meta.id === 'session-beta') return { kind: 'jsonl', path: join(betaDir, 'session.jsonl') }
      return { kind: 'jsonl', path: `/sessions-root/${meta.id}/session.jsonl` }
    },
  }
  const { handler } = createHost({
    services: { sessionQuery: services.sessionQuery, workspaceRegistry: services.workspaceRegistry, sessions: services.sessions, sessionPersistence: persistence },
    env: { DSH_HOME: dshHome },
  })

  // v0.35 用户反馈：plan 阶段只定位目标会话，不做全量列表重扫——listSessions 调用保持 1 次。
  const originalListSessions = services.sessionQuery.listSessions
  let listSessionsCalls = 0
  services.sessionQuery.listSessions = async (...args) => {
    listSessionsCalls += 1
    return originalListSessions(...args)
  }

  // live 会话 plan 拒绝
  const livePlan = await handler('sessions-delete-plan', { id: 'session-alpha' })
  assert.deepEqual(livePlan, { ok: false, error: 'live-session-rejected' })
  assert.equal(listSessionsCalls, 1, 'live rejection performs exactly one listSessions lookup')

  // 未归档冷会话也拒绝：删除能力仅属于归档区。
  services.workspaceRegistry.archivedSessionIds = []
  const unarchivedPlan = await handler('sessions-delete-plan', { id: 'session-beta' })
  assert.deepEqual(unarchivedPlan, { ok: false, error: 'session-not-archived' })
  assert.equal(listSessionsCalls, 2, 'unarchived rejection performs exactly one lookup')
  services.workspaceRegistry.archivedSessionIds = ['session-beta']

  // 未知会话拒绝
  const unknownPlan = await handler('sessions-delete-plan', { id: 'session-missing' })
  assert.deepEqual(unknownPlan, { ok: false, error: 'session-not-found' })
  assert.equal(listSessionsCalls, 3, 'unknown session: one lookup per plan request')

  // 已归档冷会话 plan 返回后果清单（仍只做一次目标定位，不触发全量字节扫描循环）
  const plan = await handler('sessions-delete-plan', { id: 'session-beta' })
  assert.equal(plan.ok, true)
  assert.equal(typeof plan.value.planId, 'string')
  assert.equal(plan.value.session.id, 'session-beta')
  assert.equal(plan.value.session.archived, true)
  assert.deepEqual(plan.value.consequences, ['deletes-session-log'])
  assert.equal(listSessionsCalls, 4, 'archived plan performs exactly one listSessions lookup per request')

  // v0.36：plan 前取一次体积（冷目录实际 10 字节），供删除后验证缓存失效。
  const beforeBytes = await handler('sessions-bytes', { ids: ['session-beta'] })
  assert.equal(beforeBytes.ok, true)
  assert.equal(beforeBytes.value.bytes['session-beta'], 10)

  // 伪造 planId 拒绝
  const forged = await handler('sessions-delete', { planId: 'forged' })
  assert.deepEqual(forged, { ok: false, error: 'unknown-delete-plan' })

  // 确认删除：目录消失 + 记录写入 + 列表不再包含该会话
  const confirmed = await handler('sessions-delete', { planId: plan.value.planId })
  assert.equal(confirmed.ok, true)
  assert.equal(confirmed.value.deleted, true)
  await assert.rejects(() => stat(betaDir))
  const deletedFile = join(dshHome, 'dsh-service-sessions-deleted.json')
  const recorded = JSON.parse(await readFile(deletedFile, 'utf8'))
  assert.equal(recorded.version, 1)
  assert.equal(recorded.items[0].id, 'session-beta')
  assert.equal(recorded.items[0].title, '标题-session-beta')
  assert.ok(recorded.items[0].cwd === '/workspace/projects')

  // planId 一次性消费；删除主动失效体积缓存，目录已缺失时回 null。
  assert.deepEqual(await handler('sessions-delete', { planId: plan.value.planId }), { ok: false, error: 'unknown-delete-plan' })
  const afterBytes = await handler('sessions-bytes', { ids: ['session-beta'] })
  assert.equal(afterBytes.ok, true)
  assert.equal(afterBytes.value.bytes['session-beta'], null, 'delete invalidates the size cache and missing archive returns null')

  const afterList = await handler('sessions-list', {})
  assert.equal(afterList.ok, true)
  assert.equal(afterList.value.items.some((item) => item.id === 'session-beta'), false)
  assert.equal(afterList.value.deleted.some((item) => item.id === 'session-beta'), true)
})
