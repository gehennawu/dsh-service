// 模型配置工作台 · 写入路径端到端验证（真实 settings.yaml 数据 + 真实侧车，不重启、不发网）。
//
// 覆盖：inspect（目录级，零网络）→ prepare（字段级 diff）→ commit（带 expectedRevision 的
// read-modify-write）→ undo-preview → undo-commit，并断言**字段保真**：未选中的 conflict
// 字段一字未动、profile 级键与 per-model compat 等未知键原样保留、撤销回到字节相同的原状、
// 计划生成后 revision 前进则提交被拒（并发窗口）。
//
// 用法：node scripts/verify-model-workbench-write-path.mjs
// 依赖真实 $DSH_HOME/settings.yaml 与 .credentials.yaml（只读，绝不写回真实配置——所有写入
// 都落在脚本内存里的 providers 副本上）。
import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml/dist/index.js'
import { createModelWorkbenchRoutes } from '/workspace/projects/dsh-service/model-workbench-routes.js'
import { createWorkbenchStore, loadPiAiCatalog, profileFingerprint } from '/workspace/projects/dsh-service/model-workbench.js'
import { randomUUID } from 'node:crypto'

const home = process.env.DSH_HOME || '/home/node/.dsh'
const doc = parse(readFileSync(`${home}/settings.yaml`, 'utf8'))
const providers = doc['llm-pi-ai'].providers
const credDoc = parse(readFileSync(`${home}/.credentials.yaml`, 'utf8'))
const refs = credDoc?.refs ?? {}
const credentials = { resolve: async (ref) => (typeof refs[ref] === 'string' ? { value: refs[ref] } : undefined) }

let revision = 3
const settings = {
  get: (ns) => (ns === 'llm-pi-ai' ? { providers } : undefined),
  describe: () => [{ ns: 'llm-pi-ai', revision }],
  mutate: async (_ns, ops, expectedRevision) => {
    if (expectedRevision !== undefined && expectedRevision !== revision) {
      const e = new Error('changed'); e.code = 'SETTINGS_CONFLICT'; throw e
    }
    ops.forEach((op) => {
      const [, route, field] = op.path
      const target = providers[route] ?? (providers[route] = {})
      target[field] = op.value
    })
    revision += 1
  },
}
const wbHome = await mkdtemp(join(tmpdir(), 'wb-verify-'))
const routes = createModelWorkbenchRoutes({
  ctx: { get: (n) => (n === 'settings' ? settings : n === 'credentials' ? credentials : undefined), logger: { info() {}, warn() {}, error() {} } },
  randomUUID, loadPiCatalog: loadPiAiCatalog, workbenchStore: createWorkbenchStore(wbHome),
  loadSubagentRoute: async () => ({ version: 1, mode: 'inherit' }),
  loadAgentDefaultModelSelection: () => undefined,
  writeSubagentRoute: async () => ({}), listSubagentModels: async () => ({ models: [] }),
  dshHome: wbHome, pluginVersion: 'verify',
})

const route = 'cpa'
const before = JSON.parse(JSON.stringify(providers[route]))
const beforeFp = profileFingerprint(before)

const insp = await routes['models2-inspect'].handle({ route })
// 显式勾选全部 safeFill（含低置信）——模拟用户在 UI 上点选后应用，确保真的产生字段变化。
const fillSids = insp.value.suggestions.filter((s) => s.kind === 'safeFill').map((s) => s.sid)
const autoSelected = insp.value.suggestions.filter((s) => s.kind === 'safeFill' && s.selected).length
console.log('safeFill total:', fillSids.length, 'auto-selected:', autoSelected)
const prep = await routes['models2-prepare'].handle({ inspectId: insp.value.inspectId, sids: fillSids })
console.log('prepare.ok:', prep.ok, 'diff:', JSON.stringify({ changes: prep.value.diff.changes.length, added: prep.value.diff.added.length, removed: prep.value.diff.removed.length }))

const commit = await routes['models2-commit'].handle({ planId: prep.value.planId })
console.log('commit.ok:', commit.ok, 'undoable:', commit.value?.undoable)

// 保真断言：其它键（apiKeyEnv/compat/未知键）原样保留；只有被选字段变化。
const after = JSON.parse(JSON.stringify(providers[route]))
const kept = ['displayName', 'api', 'baseURL', 'apiKeyEnv'].filter((k) => JSON.stringify(before[k]) === JSON.stringify(after[k]))
console.log('profile-level keys preserved:', kept.join(','))
const compatKept = JSON.stringify(before.models.map((m) => m.compat)) === JSON.stringify(after.models.map((m) => m.compat))
console.log('per-model compat preserved:', compatKept)
console.log('model count unchanged:', before.models.length === after.models.length)
console.log('fingerprint changed (a real write happened):', profileFingerprint(after) !== beforeFp)
// 逐字段核对：被选中的字段确实写入，未选中的字段一字未动。
const changedFields = []
for (const [id, bm] of new Map(before.models.map((m) => [m.id, m]))) {
  const am = after.models.find((m) => m.id === id)
  for (const k of new Set([...Object.keys(bm), ...Object.keys(am ?? {})])) {
    if (JSON.stringify(bm[k]) !== JSON.stringify(am?.[k])) changedFields.push(`${id}.${k}`)
  }
}
console.log('fields actually changed:', changedFields.length, changedFields.slice(0, 5).join(', '))
// 未选中的 conflict 字段必须原样保留。
const conflictFields = insp.value.suggestions.filter((s) => s.kind === 'conflict').map((s) => `${s.modelId}.${s.field}`)
const untouched = conflictFields.filter((f) => !changedFields.includes(f))
console.log('unselected conflict fields left untouched:', untouched.length, '/', conflictFields.length)

const prev = await routes['models2-undo-preview'].handle({ route })
console.log('undo-preview.ok:', prev.ok, 'restorable:', prev.value.restorable.length)
const undo = await routes['models2-undo-commit'].handle({ route })
console.log('undo-commit.ok:', undo.ok, 'restored to original:', profileFingerprint(providers[route]) === beforeFp)

// 并发窗口：计划生成后 revision 前进 → 提交必须拒绝。
const insp2 = await routes['models2-inspect'].handle({ route })
const prep2 = await routes['models2-prepare'].handle({ inspectId: insp2.value.inspectId, sids: [] })
revision += 1
const conflict = await routes['models2-commit'].handle({ planId: prep2.value.planId })
console.log('stale plan refused:', conflict.ok === false && /conflict/.test(conflict.error))
