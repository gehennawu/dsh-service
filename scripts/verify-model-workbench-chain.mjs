// 隔离全链验证：自定义渠道完整闭环，全部落在**内存中的 settings 副本**上（绝不写真实配置）。
//
// 链路：空白 → 建渠道 → 发现候选批量添加 → 单模型行编辑 → 换密钥 → 连接改址 →
//       撤销（连接+模型）→ 删除渠道（凭据保留）→ 从删除快照恢复 → 恢复后原样可用。
// 每次写入都经真实 mutate 语义（revision 前进 + expectedRevision 比对 + schema 自检）。
//
// 用法：node scripts/verify-model-workbench-chain.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse } from '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/yaml/dist/index.js'
import { createModelWorkbenchRoutes } from '/workspace/projects/dsh-service/model-workbench-routes.js'
import { createWorkbenchStore, profileFingerprint } from '/workspace/projects/dsh-service/model-workbench.js'

const home = process.env.DSH_HOME || '/home/node/.dsh'
// 真实 settings 只读载入，作为「已有环境」的陪衬：新渠道写进副本，不动任何已有路由。
const doc = parse(await readFile(`${home}/settings.yaml`, 'utf8'))
const providers = structuredClone(doc['llm-pi-ai'].providers ?? {})
const existingRoutes = Object.keys(providers)

const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

// 真实 mutate 语义：revision 命名空间级、写前比对、失败抛 SETTINGS_CONFLICT。
let revision = 7
const writes = []
const credentialsStore = new Map()
const settings = {
  get: (ns) => (ns === 'llm-pi-ai' ? { providers } : undefined),
  describe: () => [{ ns: 'llm-pi-ai', revision }],
  mutate: async (ns, ops, expectedRevision) => {
    if (expectedRevision !== undefined && expectedRevision !== revision) {
      const e = new Error('settings namespace changed since it was read'); e.code = 'SETTINGS_CONFLICT'; throw e
    }
    // schema 自检：路由级必须能构建合法 api/baseURL；模型行 id 非空唯一（模拟 llm-pi-ai 的严格校验）。
    for (const op of ops) {
      const [, route, field] = op.path
      if (op.op === 'set' && field === undefined) {
        const profile = op.value
        if (typeof profile?.api !== 'string' || !['openai-completions', 'openai-responses', 'anthropic-messages'].includes(profile.api)) {
          const e = new Error('llm-pi-ai: route needs a supported api'); throw e
        }
        if (typeof profile?.baseURL !== 'string') { const e = new Error('llm-pi-ai: route needs a baseURL'); throw e }
      }
      if (op.op === 'set' && field === 'models') {
        if (!Array.isArray(op.value) || op.value.length === 0) { const e = new Error('llm-pi-ai: models must be a non-empty list'); throw e }
      }
    }
    for (const op of ops) {
      const [, route, field] = op.path
      if (field === undefined) { if (op.op === 'unset') delete providers[route]; else providers[route] = op.value; continue }
      const target = providers[route] ?? (providers[route] = {})
      if (op.op === 'unset') delete target[field]; else target[field] = op.value
    }
    writes.push(ops.map((op) => `${op.op} ${op.path.join('.')}`).join(' | '))
    revision += 1
  },
}
const credentials = {
  set: async (ref, value) => { if (value === '') throw new Error('empty'); credentialsStore.set(ref, value) },
  unset: async (ref) => { credentialsStore.delete(ref) },
  resolve: async (ref) => (credentialsStore.has(ref) ? { value: credentialsStore.get(ref), source: 'file' } : undefined),
  describe: async (ref) => ({ configured: credentialsStore.has(ref), source: credentialsStore.has(ref) ? 'file' : undefined, writable: true }),
}

const wbHome = await mkdtemp(join(tmpdir(), 'wb-chain-'))
const routes = createModelWorkbenchRoutes({
  ctx: { get: (n) => (n === 'settings' ? settings : n === 'credentials' ? credentials : undefined), logger: { info() {}, warn() {}, error() {} } },
  randomUUID,
  loadPiCatalog: async () => ({ channels: [], channelIds: new Set(), byHost: new Map(), byModelId: new Map(), whiteHosts: new Set() }),
  workbenchStore: createWorkbenchStore(wbHome),
  loadSubagentRoute: async () => ({ version: 1, mode: 'inherit' }),
  loadAgentDefaultModelSelection: () => undefined,
  writeSubagentRoute: async () => ({}),
  listSubagentModels: async () => ({ models: [] }),
  dshHome: wbHome,
  pluginVersion: 'chain-verify',
})
const call = async (endpoint, payload) => routes[endpoint].handle(payload)

try {
  // 1) 空白起步：建一个自定义渠道（手动 ID，不依赖发现）。
  const created = await call('models2-create-begin', { displayName: 'Chain Gateway', baseURL: 'https://chain.example.com/v1', api: 'openai-completions', key: 'sk-chain-temp' })
  check('create-begin accepts connection info without a mandatory probe', created.ok === true && typeof created.value.draftId === 'string', created.ok ? `route=${created.value.routeId}` : created.error)
  const commitCreate = await call('models2-create-commit', { draftId: created.value.draftId, manualIds: ['chain-model-a', 'chain-model-b'] })
  check('create-commit writes the route with manual ids', commitCreate.ok === true && providers[created.value.routeId]?.models?.length === 2, commitCreate.ok ? `credentialStored=${commitCreate.value.credentialStored}` : commitCreate.error)
  const routeId = created.value.routeId
  check('key went to the credential store, not into settings', credentialsStore.get('CHAIN_GATEWAY_API_KEY') === 'sk-chain-temp' && JSON.stringify(providers[routeId]).includes('sk-chain-temp') === false)

  // 2) 单模型行编辑：只改一行，兄弟行不变。
  const patched = await call('models2-model-patch', { route: routeId, modelId: 'chain-model-a', patch: { contextWindow: 200000, input: ['text', 'image'] } })
  check('model row edit writes only that row', patched.ok === true && providers[routeId].models[0].contextWindow === 200000 && providers[routeId].models[1].contextWindow === undefined, patched.ok ? '' : patched.error)

  // 3) 连接改址 + 换密钥（两段式：预览拿指纹 → 提交）。
  const preview = await call('models2-connection-preview', { route: routeId, next: { baseURL: 'https://chain2.example.com/v1' }, keyRef: 'CHAIN_GATEWAY_API_KEY' })
  check('connection preview issues a fingerprint and credential facts', preview.ok === true && typeof preview.value.fingerprint === 'string' && preview.value.probeAllowed === true && preview.value.credential.writable === true, preview.ok ? `probeAllowed=${preview.value.probeAllowed}` : preview.error)
  const committed = await call('models2-connection-commit', { route: routeId, next: { baseURL: 'https://chain2.example.com/v1' }, key: 'sk-chain-new', baseFingerprint: preview.value.fingerprint })
  check('connection commit writes the address and replaces the key', committed.ok === true && providers[routeId].baseURL === 'https://chain2.example.com/v1' && credentialsStore.get('CHAIN_GATEWAY_API_KEY') === 'sk-chain-new', committed.ok ? '' : committed.error)
  check('model list untouched by a connection edit', providers[routeId].models.length === 2 && providers[routeId].models[0].contextWindow === 200000)

  // 4) 撤销：连接字段与模型一起回滚到写前快照。
  const undoPreview = await call('models2-undo-preview', { route: routeId })
  check('undo preview reports the full scope with connection rows', undoPreview.ok === true && undoPreview.value.scope === 'full' && undoPreview.value.connection.some((r) => r.field === 'baseURL'), undoPreview.ok ? '' : undoPreview.error)
  const undone = await call('models2-undo-commit', { route: routeId })
  check('undo restores the previous address', undone.ok === true && providers[routeId].baseURL === 'https://chain.example.com/v1', undone.ok ? '' : undone.error)
  check('undo restores the model row that was edited', providers[routeId].models[0].contextWindow === 200000 && providers[routeId].models.length === 2)
  check('undo never restores a key value', credentialsStore.get('CHAIN_GATEWAY_API_KEY') === 'sk-chain-new')

  // 5) 删除渠道：快照先行 + 凭据保留。
  const delPreview = await call('models2-route-remove-preview', { route: routeId })
  check('delete preview lists consequences and credential retention', delPreview.ok === true && delPreview.value.credential.retained === true && delPreview.value.blocked === false, delPreview.ok ? '' : delPreview.error)
  const removed = await call('models2-route-remove-commit', { route: routeId, baseFingerprint: delPreview.value.fingerprint })
  check('delete removes the route and keeps the credential', removed.ok === true && providers[routeId] === undefined && credentialsStore.has('CHAIN_GATEWAY_API_KEY') === true, removed.ok ? '' : removed.error)

  // 6) 删除后仍可找到并恢复；整份配置原样回来。
  const list = await call('models2-route-removed-list', {})
  check('deleted route stays reachable for restore', list.ok === true && list.value.removed.some((r) => r.route === routeId), list.ok ? '' : list.error)
  const restored = await call('models2-route-restore', { route: routeId })
  check('restore writes the exact profile back', restored.ok === true && providers[routeId]?.models?.length === 2 && providers[routeId]?.apiKeyEnv === 'CHAIN_GATEWAY_API_KEY', restored.ok ? '' : restored.error)
  check('restore reports that the key value is not restored', restored.value.credentialValueRestored === false)

  // 7) 陪衬断言：已有路由一字未动。
  const unchanged = existingRoutes.every((route) => JSON.stringify(providers[route]) === JSON.stringify(doc['llm-pi-ai'].providers[route]))
  check('every pre-existing route is byte-identical', unchanged, `${existingRoutes.length} routes`)

  // 8) 冲突保护：过期指纹被拒。
  const stale = await call('models2-connection-commit', { route: routeId, next: { api: 'openai-responses' }, baseFingerprint: 'stale-fingerprint' })
  check('a stale fingerprint is refused as conflict', stale.ok === false && stale.error === 'conflict')
} finally {
  await rm(wbHome, { recursive: true, force: true })
}

console.log('\nwrite log:')
for (const w of writes) console.log('  ' + w)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
