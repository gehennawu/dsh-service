// 客户端半分片：模型配置工作台（v1.10，从 work/models-runtime 分支重实现）。
//
// 页面结构：顶级「模型配置」标签内两个子标签——「供应商与模型」（左，默认）+「子代理路由」
// （右，复用既有 SubagentSection）。子标签栏在只剩一个可用子页时整条隐藏。
//
// 与旧分支的差异（重实现到 main 分片骨架时逐条核对）：
//   - 分片不是模块，共享同一个 factory 作用域；本分片放在 model-icons.js 之后，
//     可直接用 visual-primitives 的样式基元与 model-icons 的图标解析。
//   - 宿主端点从 models-* 全量换成 models2-*（22 个，见 model-workbench-routes.js）。
//   - feature 门统一为 modelCatalog；错误映射表随之收敛。
//
// 安全教义：客户端只回传宿主签发的 sid / planId / inspectId / draftId 与 allowlist 能力意图；
// 凭据值只在新建表单里一次性经 loopback 提交，绝不回显、不落 localStorage。

// ─── 模型工作台：组件工厂 ───────────────────────────────────────────────────
// 分片在工厂作用域，但 `useTranslation` 与 `rpcCall` 是 apply() 的局部绑定
// （apply 内构造：rpcCall 带时区端点归一，useTranslation 带词典 bind），
// 所以组件必须由工厂注入这两个依赖，而不是直接引用 apply 的私有名。
// 返回面由 apply 消费：`modelsPageBlock` 用 ProvidersWorkbench，
// 测试可直接取纯函数（mapModelsError / formatCapacity / WB_FIELD_TEXT）。
function createModelsWorkbench({ useTranslation, rpcCall, SvcTabs, useFeatures }) {
  // translate 与 useTranslation() 同源（同一 bind 结果），供非组件纯函数与事件处理器取词；
  // SvcTabs 由 apply 注入（视觉基元在工厂作用域，但显式注入让本分片的依赖面可读、可测）。
      function mapModelsError(translate, code) {
        const known = {
          'feature-disabled': 'features.readOnly',
          'catalog-unavailable': 'models.error.catalog-unavailable',
          'catalog-too-large': 'models.error.catalog-unavailable',
          'route-gone': 'models.error.route-gone',
          'plan-expired': 'models.error.plan-expired',
          'unknown-inspection': 'models.error.inspect-gone',
          'unknown-plan': 'models.error.inspect-gone',
          'nothing-to-undo': 'models.error.nothing-to-undo',
          'conflict': 'models.error.conflict',
          'no-base-url': 'models.error.no-base-url',
          'models-workbench-readonly': 'models.error.workbenchReadonly',
          'bad-route': 'models.error.bad-route',
          'bad-api': 'models.error.bad-api',
          'bad-base-url': 'models.error.bad-base-url',
          'bad-display-name': 'models.error.bad-display-name',
          'bad-key': 'models.error.bad-key',
          'route-taken': 'models.error.route-taken',
          'no-models': 'models.error.no-models',
          'credential-rejected': 'models.error.credential-rejected',
          'recovery-pending': 'models.error.recovery-pending',
          'unknown-draft': 'models.error.draft-gone',
          'nothing-to-resolve': 'models.error.nothing-to-resolve',
          'bad-models': 'models.error.bad-models',
          'migration-required': 'models.error.migration-required',
          'removal-blocked': 'models.error.removal-blocked',
          'llm-service-missing': 'models.error.llm-missing',
          'credential-missing': 'models.error.unknown',
          'bad-model-id': 'models.error.bad-model-id',
          'model-detection-required': 'models.error.model-detection-required',
          'model-unverified': 'models.error.model-unverified',
          'unknown-option': 'models.error.unknown-option',
          'unknown-detection': 'models.error.unknown-detection',
          'duplicate-model': 'models.error.duplicate-model',
          'builtin-only': 'models.error.builtin-only',
          'online-custom-only': 'models.error.online-custom-only',
          'probe-protocol-unsupported': 'models.error.probe-protocol-unsupported',
          'last-model-undeletable': 'models.error.last-model-undeletable',
          'builtin-inherited-list': 'models.error.builtin-inherited-list',
          'nothing-to-restore': 'models.error.nothing-to-restore',
          'restore-failed': 'models.error.restore-failed',
          'connection-failed': 'models.error.connection-failed',
          'removal-blocked': 'models.error.removal-blocked',
        }
        if (code?.startsWith('schema-invalid:')) return translate('models.error.unknown').replace('{detail}', code)
        if (code?.startsWith('unknown-suggestion:')) return translate('models.error.unknown-suggestion')
        if (code?.startsWith('create-failed:')) return translate('models.error.create-failed').replace('{detail}', code.slice('create-failed:'.length))
        if (code?.startsWith('remove-failed:')) return translate('models.error.remove-failed').replace('{detail}', code.slice('remove-failed:'.length))
        if (known[code] !== undefined) return translate(known[code])
        return translate('models.error.unknown').replace('{detail}', code ?? '')
      }
      const MODEL_FIELDS = {
        name: 'models.plan.field.name',
        contextWindow: 'models.plan.field.contextWindow',
        maxTokens: 'models.plan.field.maxTokens',
        input: 'models.plan.field.input',
        reasoningEfforts: 'models.plan.field.reasoningEfforts',
      }
      /** 紧凑容量文案（列表行用）：1e6 → 1M、1e3 → 1K。 */
      function formatCapacity(value) {
        const number = Number(value)
        if (!Number.isFinite(number)) return ''
        if (number >= 1e6) return `${Math.round(number / 1e5) / 10}M`
        if (number >= 1e3) return `${Math.round(number / 1e2) / 10}K`
        return String(number)
      }
      /** 容量字段的可编辑文本（与官方设置页同款）：整数按 K/M 最短写法回显。 */
      function capacityText(value) {
        if (!Number.isInteger(value) || value <= 0) return value === undefined || value === null ? '' : String(value)
        if (value % 1e6 === 0) return `${value / 1e6}M`
        if (value % 1e3 === 0) return `${value / 1e3}K`
        return String(value)
      }
      /**
       * 解析容量文本：纯数字可带 K/M 后缀（1M = 1000K，与模型容量的通行写法一致）。
       * 返回 `undefined` = 留空（继承目录默认值），`NaN` = 不可读（由调用方拒绝保存）。
       */
      function parseCapacity(text) {
        const trimmed = String(text ?? '').trim()
        if (trimmed === '') return undefined
        const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(trimmed)
        if (match === null) return NaN
        const suffix = match[2] === undefined ? '' : match[2].toLowerCase()
        const scale = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : 1
        const scaled = Number(match[1]) * scale
        const rounded = Math.round(scaled)
        return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
      }
      /** 模型行的输出模态（只读展示）：条目自带 output 才用，否则按适配器默认 text。 */
      function outputModalitiesOf(model) {
        return Array.isArray(model?.output) && model.output.length > 0 ? model.output : ['text']
      }
      /** 相对时间（v0.43 修复 en 硬编码中文）：统一走词典。 */
      function formatRelativeTime(translate, at) {
        if (typeof at !== 'number') return ''
        const minutes = Math.max(0, Math.round((Date.now() - at) / 60000))
        if (minutes < 1) return translate('models.time.justNow')
        if (minutes < 60) return translate('models.time.minAgo').replace('{n}', String(minutes))
        return translate('models.time.hourAgo').replace('{n}', String(Math.round(minutes / 60)))
      }
      const WB_KIND_ORDER = ['safeFill', 'conflict', 'addition', 'unknown']
      const WB_KIND_KEYS = { safeFill: 'models.wb.group.safeFill', conflict: 'models.wb.group.conflict', addition: 'models.wb.group.addition', unknown: 'models.wb.group.unknown' }
      const WB_CHIP_KEYS = { safeFill: 'models.wb.chip.safeFill', conflict: 'models.wb.chip.conflict', addition: 'models.wb.chip.addition', unknown: 'models.wb.chip.unknown' }
      const WB_VALUE_TEXT = (value) => (value === null || value === undefined || value === '' ? '—' : (typeof value === 'object' ? JSON.stringify(value) : String(value)))
      const WB_INPUT_TEXT = (value) => (Array.isArray(value) ? value.join('+') : WB_VALUE_TEXT(value))
      const WB_EFFORTS_TEXT = (value) => (value === false ? '✕' : (value !== null && typeof value === 'object' ? Object.keys(value).join('/') : WB_VALUE_TEXT(value)))
      const WB_FIELD_TEXT = (field, value) => (field === 'input' ? WB_INPUT_TEXT(value) : field === 'reasoningEfforts' ? WB_EFFORTS_TEXT(value) : WB_VALUE_TEXT(value))
      /** 探测错误码 → 可行动文案（稳定码走词典，未知码原样折叠展示）。 */
      function wbProbeErrorText(translate, code) {
        const known = {
          'probe-protocol-unsupported': 'models.wb.check.unsupported',
          'probe-insecure': 'models.wb.check.insecure',
          'probe-private-address': 'models.wb.check.private',
          'probe-ip-literal': 'models.wb.check.ipliteral',
          'probe-dns-failed': 'models.wb.check.dns',
        }
        return known[code] !== undefined ? translate(known[code]) : String(code ?? 'internal')
      }
      const WB_CARD = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', padding: '14px 16px', marginTop: '12px', background: 'var(--dsw-alias-bg-layer-3)' }
      const WB_MUTED = { margin: 0, fontSize: '12px', color: 'var(--dsh-svc-text-muted)' }
      const WB_ERROR = { margin: '8px 0 0', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' }
      const WB_INPUT = { width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '13px' }

      /** 撤销面板（Q56/Q90）：预览逐字段比对 → 选择 post-apply 增删处置 → 确认执行。
       * 成功才通知上层刷新；失败保留输入可重试（侧车槽位只在成功后清）。 */
      function UndoPanel({ route, onUndone, onCancel }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useEffect } = React
        const [preview, setPreview] = useState(null)
        const [dropAdded, setDropAdded] = useState(false)
        const [restoreRemoved, setRestoreRemoved] = useState(false)
        const [busy, setBusy] = useState(false)
        const [done, setDone] = useState(false)
        const [error, setError] = useState('')
        useEffect(() => {
          let alive = true
          rpcCall('models2-undo-preview', { route }).then((res) => {
            if (!alive) return
            if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
            setPreview(res.value)
          }).catch(() => { if (alive) setError(mapModelsError(translate, 'internal')) })
          return () => { alive = false }
        }, [])
        const confirm = async () => {
          setBusy(true)
          const res = await rpcCall('models2-undo-commit', { route, dropAdded, restoreRemoved })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setDone(true)
          if (onUndone !== undefined) onUndone()
        }
        const fieldLabel = (field) => translate(MODEL_FIELDS[field] !== undefined ? MODEL_FIELDS[field] : 'models.error.unknown')
        const checkRow = (testId, checked, onToggle, label) => el('label', { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' } },
          el('input', { type: 'checkbox', 'data-testid': testId, checked, onChange: () => onToggle(!checked) }), label)
        const children = [
          el('div', { key: 'title', style: { fontWeight: 600 } }, translate('models.wb.undo.title').replace('{route}', route)),
        ]
        if (done) {
          children.push(el('span', { key: 'done', 'data-testid': 'wb-undo-done', style: { color: 'var(--dsw-alias-state-success-primary)' } }, translate('models.wb.undo.done')))
        } else {
          if (error !== '') children.push(el('p', { key: 'error', role: 'alert', 'data-testid': 'wb-undo-error', style: Object.assign({}, WB_ERROR, { margin: 0 }) }, error))
          if (preview === null && error === '') children.push(el('span', { key: 'loading', style: WB_MUTED }, '…'))
          if (preview !== null) {
            children.push(el('div', { key: 'at', style: WB_MUTED }, translate('models.wb.undo.at').replace('{time}', formatRelativeTime(translate, preview.at))))
            const restorable = Array.isArray(preview.restorable) ? preview.restorable : []
            children.push(restorable.length > 0
              ? el('div', { key: 'restorable', 'data-testid': 'wb-undo-restorable' }, [
                  el('div', { key: 'head', style: { fontWeight: 600 } }, translate('models.wb.undo.restorable').replace('{n}', String(restorable.length))),
                  el('ul', { key: 'list', style: { margin: '2px 0 0', paddingLeft: '18px' } }, restorable.map((item, index) => el('li', { key: index },
                    item.remove === true
                      ? translate('models.wb.undo.removeField').replace('{model}', item.modelId).replace('{field}', fieldLabel(item.field))
                      : translate('models.wb.undo.restoreField').replace('{model}', item.modelId).replace('{field}', fieldLabel(item.field)).replace('{value}', WB_FIELD_TEXT(item.field, item.restoreTo))))),
                ])
              : el('div', { key: 'restorable-none', style: WB_MUTED }, translate('models.wb.undo.nothing')))
            const added = Array.isArray(preview.addedSince) ? preview.addedSince : []
            const removed = Array.isArray(preview.removedSince) ? preview.removedSince : []
            if (added.length > 0) {
              children.push(checkRow('wb-undo-drop-added', dropAdded, setDropAdded, `${translate('models.wb.undo.added').replace('{n}', String(added.length))} — ${translate('models.wb.undo.dropAdded')}`))
            }
            if (removed.length > 0) {
              children.push(checkRow('wb-undo-restore-removed', restoreRemoved, setRestoreRemoved, `${translate('models.wb.undo.removed').replace('{n}', String(removed.length))} — ${translate('models.wb.undo.restoreRemoved')}`))
            }
            children.push(el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '4px' } }, [
              el('button', { key: 'confirm', type: 'button', 'data-testid': 'wb-undo-confirm', style: svcButtonStyle('danger'), disabled: busy, onClick: () => void confirm() }, translate('models.wb.undo.confirm')),
              onCancel !== undefined ? el('button', { key: 'cancel', type: 'button', 'data-testid': 'wb-undo-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: onCancel }, translate('models.wb.undo.cancel')) : null,
            ]))
          }
        }
        return el('div', { 'data-testid': 'wb-undo-panel', style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '10px 12px', marginTop: '8px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '6px' } }, children)
      }

      /** 四阶段任务页（Q-doc 定稿）：检查 → 建议 → 应用 → 验证。
       * 显式点「检查并修复」即任务启动，挂载后自动开始检查流水线；离开页面（卸载）丢弃在途回包。 */
      function WorkbenchTaskPage({ row, freshKey, onBack, onChanged }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useEffect, useRef } = React
        const route = row.route
        const [phase, setPhase] = useState('check')
        const [inspect, setInspect] = useState(null)
        const [selections, setSelections] = useState(new Set())
        const [filter, setFilter] = useState('')
        const [expandedKinds, setExpandedKinds] = useState(new Set())
        const [plan, setPlan] = useState(null)
        const [conflict, setConflict] = useState(false)
        const [applied, setApplied] = useState(null)
        const [validation, setValidation] = useState(null)
        const [validateBusy, setValidateBusy] = useState(false)
        const [deepArmed, setDeepArmed] = useState(false)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const aliveRef = useRef(true)
        useEffect(() => () => { aliveRef.current = false }, [])
        const runInspect = async (probe = false) => {
          setBusy(true); setError(''); setConflict(false); setPlan(null); setApplied(null); setInspect(null)
          const res = await rpcCall('models2-inspect', { route, freshKey, probe })
          if (!aliveRef.current) return
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          const value = res.value
          setInspect(value)
          // 探测重查后保留用户已勾选的建议（sid 确定性：同 route/模型/字段/值不变则 sid 不变）；
          // 但要过滤掉不再存在的 sid（探测后建议集变化）。
          setSelections((current) => {
            const alive = new Set((value.suggestions ?? []).map((item) => item.sid))
            const next = new Set((value.suggestions ?? []).filter((item) => item.selected === true).map((item) => item.sid))
            if (probe) for (const sid of current) if (alive.has(sid)) next.add(sid)
            return next
          })
          setPhase('suggest')
        }
        useEffect(() => { void runInspect() }, [])
        const prepare = async () => {
          if (inspect === null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-prepare', { inspectId: inspect.inspectId, sids: Array.from(selections) })
          if (!aliveRef.current) return
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setPlan(res.value)
        }
        const confirmApply = async () => {
          if (plan === null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-commit', { planId: plan.planId })
          if (!aliveRef.current) return
          setBusy(false)
          if (res.ok !== true) {
            if (res.error === 'conflict') { setConflict(true); setPlan(null); return }
            setError(mapModelsError(translate, res.error))
            return
          }
          setApplied(res.value)
          setPhase('verify')
          if (onChanged !== undefined) onChanged()
        }
        const toggleSid = (sid) => setSelections((current) => {
          const next = new Set(current)
          if (next.has(sid)) next.delete(sid); else next.add(sid)
          return next
        })
        const setModelSids = (sids, on) => setSelections((current) => {
          const next = new Set(current)
          for (const sid of sids) { if (on) next.add(sid); else next.delete(sid) }
          return next
        })
        // v0.43 验证（Q-doc 691）：默认四项无推理；deep 需显式「可能计费」两段确认，由宿主做有界最小真实调用。
        const runValidate = async (deep) => {
          setValidateBusy(true); setDeepArmed(false); setError('')
          const res = await rpcCall('models2-validate', deep === true ? { route, deep: true } : { route })
          if (!aliveRef.current) return
          setValidateBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setValidation(res.value)
          if (onChanged !== undefined) onChanged()
        }
        const CHECK_LABELS = { settings: 'models.wb.verify.check.settings', providers: 'models.wb.verify.check.providers', models: 'models.wb.verify.check.models', credential: 'models.wb.verify.check.credential', stream: 'models.wb.verify.check.stream' }
        const phaseBar = el('div', { 'data-testid': 'wb-phases', className: 'dshsvc-wb-phases' },
          ['inspect', 'suggest', 'apply', 'verify'].map((name, index) => el('span', {
            key: name,
            'data-testid': 'wb-phase-' + name,
            'data-active': name === phase ? 'true' : 'false',
            style: Object.assign(svcBadgeStyle(name === phase ? 'info' : 'neutral'), name === phase ? { fontWeight: 700 } : null),
          }, `${index + 1}. ${translate('models.wb.phase.' + name)}`)))
        const connectionLine = inspect === null ? null : el('div', { 'data-testid': 'wb-connection', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: 'var(--dsh-svc-text-muted)' } }, [
          inspect.connection?.probed !== true
            ? el('span', { key: 'not-probed', 'data-testid': 'wb-conn-not-probed', style: { color: 'var(--dsw-alias-label-secondary)' } }, translate('models.wb.check.notProbed'))
            : inspect.connection?.ok === true
              ? el('span', { key: 'ok', 'data-testid': 'wb-conn-ok', style: { color: 'var(--dsw-alias-state-success-primary)' } }, translate('models.wb.check.ok').replace('{n}', String(inspect.connection.modelCount ?? 0)))
              : el('span', { key: 'fail', 'data-testid': 'wb-conn-fail', style: { color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.check.failed').replace('{error}', wbProbeErrorText(translate, inspect.connection?.error))),
          inspect.connection?.probed === true
            ? el('span', { key: 'cred' }, inspect.connection?.usedCredential === true ? translate('models.wb.check.credential') : translate('models.wb.check.anon'))
            : null,
        ])
        const summaryChips = inspect === null ? null : el('div', { 'data-testid': 'wb-summary', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '8px 0' } },
          WB_KIND_ORDER
            .filter((kind) => (inspect.summary?.[kind] ?? 0) > 0)
            .map((kind) => el('span', { key: kind, 'data-testid': 'wb-summary-' + kind, style: svcBadgeStyle(kind === 'conflict' ? 'warning' : 'neutral') },
              `${translate(WB_CHIP_KEYS[kind])} ${inspect.summary[kind]}`)))
        const suggestionRow = (row) => {
          if (row.kind === 'unknown') {
            return el('div', { key: row.sid, 'data-testid': 'wb-sug-' + row.sid, style: { fontSize: '12px', color: 'var(--dsh-svc-text-muted)', padding: '2px 0' } },
              translate('models.wb.unknownRow'))
          }
          const checked = selections.has(row.sid)
          const lowConfidence = row.source?.confidence !== 'high'
          const bits = []
          if (row.kind === 'addition') {
            const draftBits = []
            if (row.draft?.name !== undefined && row.draft.name !== '') draftBits.push(row.draft.name)
            if (row.draft?.contextWindow !== undefined) draftBits.push(formatCapacity(row.draft.contextWindow))
            if (row.draft?.maxTokens !== undefined) draftBits.push(`${formatCapacity(row.draft.maxTokens)} out`)
            if (row.draft?.input !== undefined) draftBits.push(WB_INPUT_TEXT(row.draft.input))
            if (row.draft?.reasoningEfforts !== undefined) draftBits.push(WB_EFFORTS_TEXT(row.draft.reasoningEfforts))
            bits.push(draftBits.join(' · '))
          } else {
            bits.push(`${WB_FIELD_TEXT(row.field, row.from)} → ${WB_FIELD_TEXT(row.field, row.to)}`)
          }
          return el('label', { key: row.sid, 'data-testid': 'wb-sug-' + row.sid, 'data-checked': checked ? 'true' : 'false', style: { display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '12px', padding: '2px 0', cursor: 'pointer' } },
            el('input', { type: 'checkbox', checked, onChange: () => toggleSid(row.sid) }),
            el('span', null, [
              row.field !== undefined && row.kind !== 'addition' ? el('b', { key: 'f' }, `${translate(MODEL_FIELDS[row.field] !== undefined ? MODEL_FIELDS[row.field] : row.field)}: `) : null,
              el('span', { key: 'v' }, bits.join('')),
              // v0.43.1：来源可见——冲突/补全的 to 来自哪个渠道（providerId）与匹配方式，不再让用户猜。
              row.source?.providerId !== undefined && row.kind !== 'unknown'
                ? el('span', { key: 'src', 'data-testid': 'wb-sug-src-' + row.sid.slice(0, 8), style: { marginLeft: '6px', color: 'var(--dsh-svc-text-muted)', fontSize: '11px' } },
                  `@${row.source.providerId}${row.source.via !== undefined ? '·' + row.source.via : ''}`)
                : null,
              Array.isArray(row.inexpressible) && row.inexpressible.length > 0 ? el('span', { key: 'x', style: { color: 'var(--dsw-alias-state-warn-label)' } }, ` · ${translate('models.wb.inexpressible').replace('{n}', String(row.inexpressible.length))}`) : null,
              lowConfidence ? el('span', { key: 'c', style: Object.assign({}, svcBadgeStyle('warning'), { marginLeft: '6px' }) }, translate('models.wb.confidence.low')) : null,
            ]))
        }
        const filterText = filter.trim().toLowerCase()
        const groupBlocks = inspect === null ? [] : WB_KIND_ORDER.map((kind) => {
          const rows = inspect.suggestions.filter((item) => item.kind === kind)
          const byModel = new Map()
          for (const item of rows) {
            const list = byModel.get(item.modelId) ?? []
            list.push(item)
            byModel.set(item.modelId, list)
          }
          const visibleModels = Array.from(byModel.keys()).filter((modelId) => filterText === '' || modelId.toLowerCase().includes(filterText))
          if (visibleModels.length === 0) return null
          // v0.43.1 用户反馈：检查修复只关注已添加模型——「可添加」默认全部收起（不再先展示 5 个），
          // 点开才看全部；筛选命中时直接显示命中行（不被收起逻辑挡住）。
          const collapsed = kind === 'addition' && filterText === '' && visibleModels.length > 0 && !expandedKinds.has(kind)
          const shown = collapsed ? [] : visibleModels
          const toggleMore = () => setExpandedKinds((current) => {
            const next = new Set(current)
            if (next.has(kind)) next.delete(kind); else next.add(kind)
            return next
          })
          return el('div', { key: kind, 'data-testid': 'wb-group-' + kind, style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '10px 12px', marginTop: '8px' } }, [
            el('div', { key: 'head', style: { fontSize: '13px', fontWeight: 600 } }, translate(WB_KIND_KEYS[kind])),
            shown.map((modelId) => {
              const modelRows = byModel.get(modelId)
              const selectable = modelRows.filter((item) => item.kind !== 'unknown').map((item) => item.sid)
              return el('div', { key: modelId, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '8px 0', marginTop: '6px' } }, [
                el('div', { key: 'id', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
                  el('code', { key: 'code', style: { fontSize: '12px', fontWeight: 600 } }, modelId),
                  selectable.length > 0 ? el('span', { key: 'ops' }, [
                    el('button', { key: 'all', type: 'button', 'data-testid': 'wb-row-all-' + modelId, style: svcRowActionStyle(), onClick: () => setModelSids(selectable, true) }, translate('models.wb.selectRow')),
                    el('span', { key: 'gap' }, ' '),
                    el('button', { key: 'none', type: 'button', 'data-testid': 'wb-row-none-' + modelId, style: svcRowActionStyle(), onClick: () => setModelSids(selectable, false) }, translate('models.wb.clearRow')),
                  ]) : null,
                ]),
                el('div', { key: 'rows' }, modelRows.map(suggestionRow)),
              ])
            }),
            kind === 'addition' && visibleModels.length > 0
              ? el('button', { key: 'more', type: 'button', 'data-testid': 'wb-group-more-' + kind, style: svcRowActionStyle(), onClick: toggleMore }, collapsed ? translate('models.wb.group.more').replace('{n}', String(visibleModels.length)) : translate('models.wb.group.less'))
              : null,
          ])
        })
        const nonEmptySuggestions = inspect !== null && inspect.suggestions.length > 0
        const suggestBlock = phase === 'suggest' ? el('div', { 'data-testid': 'wb-suggest' }, [
          connectionLine,
          summaryChips,
          // v0.43.1 用户反馈：可添加模型改为显式点击才获取（进入页面的自动检查只做目录级修复检查，不探测网关）。
          inspect !== null && inspect.connection?.probed !== true
            ? el('div', { key: 'fetch', style: { margin: '8px 0' } }, [
                el('button', { type: 'button', 'data-testid': 'wb-fetch-additions', style: svcButtonStyle('brandGhost'), disabled: busy, onClick: () => void runInspect(true) }, translate('models.wb.check.fetchAdditions')),
              ])
            : null,
          nonEmptySuggestions ? el('input', { key: 'filter', 'data-testid': 'wb-filter', style: Object.assign({}, WB_INPUT, { maxWidth: '280px', marginTop: '4px' }), value: filter, onChange: (event) => setFilter(event.target.value), placeholder: translate('models.wb.filter') }) : null,
          nonEmptySuggestions ? groupBlocks : el('p', { 'data-testid': 'wb-suggest-empty', style: WB_MUTED }, translate('models.wb.suggestEmpty')),
          el('div', { key: 'footer', 'data-testid': 'wb-footer', className: 'dshsvc-wb-footer' }, [
            el('span', { key: 'count', 'data-testid': 'wb-selected-count', style: WB_MUTED }, translate('models.wb.selected').replace('{n}', String(selections.size))),
            el('button', { key: 'prepare', type: 'button', 'data-testid': 'wb-prepare', style: svcButtonStyle('primary'), disabled: busy || selections.size === 0, onClick: () => void prepare() }, translate('models.wb.prepare')),
          ]),
        ]) : null
        const planView = plan === null ? null : el('div', { 'data-testid': 'wb-apply-preview', style: WB_CARD }, [
          el('div', { key: 'title', style: { fontSize: '15px', fontWeight: 600 } }, translate('models.wb.apply.title')),
          el('p', { key: 'summary', 'data-testid': 'wb-apply-summary', style: { margin: '6px 0 0', fontSize: '13px' } },
            translate('models.wb.apply.summary').replace('{changes}', String(plan.diff.changes.length)).replace('{added}', String(plan.diff.added.length)).replace('{removed}', String(plan.diff.removed.length))),
          plan.diff.changes.length + plan.diff.added.length + plan.diff.removed.length === 0
            ? el('p', { key: 'empty', 'data-testid': 'wb-apply-empty', style: WB_MUTED }, translate('models.wb.apply.empty'))
            : null,
          plan.diff.changes.length > 0 ? el('ul', { key: 'changes', style: { margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--dsh-svc-text-muted)', maxHeight: '200px', overflow: 'auto' } },
            plan.diff.changes.map((change, index) => el('li', { key: index },
              `${change.modelId} · ${translate(MODEL_FIELDS[change.field] !== undefined ? MODEL_FIELDS[change.field] : change.field)}: ${WB_FIELD_TEXT(change.field, change.from)} → ${WB_FIELD_TEXT(change.field, change.to)}`))) : null,
          plan.diff.added.length > 0 ? el('p', { key: 'added', style: { margin: '4px 0 0', fontSize: '12px' } }, `+ ${plan.diff.added.join(', ')}`) : null,
          plan.diff.removed.length > 0 ? el('p', { key: 'removed', style: { margin: '4px 0 0', fontSize: '12px', color: 'var(--dsw-alias-state-warn-label)' } }, `− ${plan.diff.removed.join(', ')}`) : null,
          el('p', { key: 'cred', style: Object.assign({}, WB_MUTED, { marginTop: '6px' }) }, translate('models.wb.apply.noCredentialOps')),
          el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '10px' } }, [
            el('button', { key: 'back', type: 'button', 'data-testid': 'wb-apply-back', style: svcButtonStyle('ghost'), disabled: busy, onClick: () => setPlan(null) }, translate('models.wb.apply.back')),
            el('button', { key: 'confirm', type: 'button', 'data-testid': 'wb-apply-confirm', style: svcButtonStyle('danger'), disabled: busy, onClick: () => void confirmApply() }, translate('models.wb.apply.confirm')),
          ]),
        ])
        const conflictView = conflict ? el('div', { 'data-testid': 'wb-conflict', style: WB_CARD }, [
          el('p', { key: 'text', 'data-testid': 'wb-conflict-text', style: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.conflict')),
          el('button', { key: 'recheck', type: 'button', 'data-testid': 'wb-conflict-recheck', style: svcButtonStyle('primary'), disabled: busy, onClick: () => void runInspect() }, translate('models.wb.check.recheck')),
        ]) : null
        const checkView = phase === 'check' ? el('div', { 'data-testid': 'wb-check', style: WB_CARD }, [
          busy ? el('span', { key: 'busy', 'data-testid': 'wb-check-busy', style: WB_MUTED }, translate('models.wb.check.busy')) : el('div', { key: 'idle' }, [
            error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'wb-task-error', style: Object.assign({}, WB_ERROR, { margin: '0 0 6px' }) }, error) : null,
            el('button', { key: 'start', type: 'button', 'data-testid': 'wb-check-start', style: svcButtonStyle('primary'), disabled: busy, onClick: () => void runInspect() }, translate('models.wb.check.start')),
          ]),
        ]) : null
        const verifyView = phase === 'verify' && applied !== null ? el('div', { 'data-testid': 'wb-verify', style: WB_CARD }, [
          el('p', { key: 'note', 'data-testid': 'wb-applied-note', style: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-state-success-primary)' } }, translate('models.wb.applied').replace('{n}', String(applied.applied ?? 0))),
          el('div', { key: 'validate-actions', style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, [
            el('button', { key: 'run', type: 'button', 'data-testid': 'wb-validate-run', style: svcButtonStyle('primary'), disabled: validateBusy, onClick: () => void runValidate(false) }, validateBusy ? translate('models.wb.verify.busy') : translate('models.wb.verify.run')),
            el('button', { key: 'deep', type: 'button', 'data-testid': 'wb-validate-deep', style: svcButtonStyle('dangerGhost'), disabled: validateBusy, onClick: () => { if (deepArmed) void runValidate(true); else setDeepArmed(true) } }, deepArmed ? translate('models.wb.verify.deepArmed') : translate('models.wb.verify.deep')),
          ]),
          validation !== null ? el('div', { key: 'checks', 'data-testid': 'wb-validate-checks', style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px' } }, [
            el('div', { key: 'verdict', 'data-testid': 'wb-validate-verdict', style: { fontWeight: 600, color: validation.ok === true ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' } },
              validation.ok === true ? translate('models.wb.verify.ok') : translate('models.wb.verify.fail').replace('{error}', (validation.checks ?? []).filter((check) => check.ok !== true && check.skipped !== true).map((check) => `${translate(CHECK_LABELS[check.type] ?? check.type)}:${check.error ?? '?'}`).join('；'))),
            (validation.checks ?? []).map((check) => el('div', { key: check.type, 'data-testid': 'wb-validate-check-' + check.type, style: { display: 'flex', gap: '6px', alignItems: 'center', color: 'var(--dsh-svc-text-muted)' } }, [
              el('span', { style: { minWidth: '84px' } }, translate(CHECK_LABELS[check.type] ?? check.type)),
              check.skipped === true
                ? el('span', { style: svcBadgeStyle('neutral') }, translate('models.wb.verify.skipped'))
                : check.ok === true
                  ? el('span', { style: svcBadgeStyle('success') }, translate('models.wb.verify.ok'))
                  : el('span', { 'data-testid': 'wb-validate-check-fail-' + check.type, style: svcBadgeStyle('danger') }, translate('models.wb.verify.fail').replace('{error}', check.error ?? '?')),
              typeof check.durationMs === 'number' ? el('span', { style: { fontSize: '11px' } }, `${check.durationMs}ms`) : null,
            ])),
            el('p', { key: 'persisted', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.verify.persisted')),
          ]) : null,
          applied.undoable === true ? el(UndoPanel, { key: 'undo', route, onUndone: onChanged, onCancel: undefined }) : null,
          el('div', { key: 'actions', style: { marginTop: '10px' } },
            el('button', { type: 'button', 'data-testid': 'wb-verify-back', style: svcButtonStyle('neutral'), onClick: onBack }, translate('models.wb.task.back'))),
        ]) : null
        return el('div', { 'data-testid': 'wb-task' }, [
          el('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, [
            el('button', { key: 'back', type: 'button', 'data-testid': 'wb-back', style: svcRowActionStyle(), onClick: onBack }, '← ' + translate('models.wb.task.back')),
            el('span', { key: 'title', style: { fontSize: '15px', fontWeight: 600 } }, translate('models.wb.task.title').replace('{route}', route)),
          ]),
          phaseBar,
          error !== '' && phase !== 'check' && conflict === false ? el('p', { key: 'error', role: 'alert', 'data-testid': 'wb-task-error', style: WB_ERROR }, error) : null,
          checkView,
          suggestBlock,
          planView,
          conflictView,
          verifyView,
        ])
      }

      /** 添加供应商向导（v0.43 补偿式新建）：连接信息与临时密钥 → 检查 → 选模型/手填 → 确认创建。
       * 临时密钥只随 begin 进宿主任务内存；commit 凭据先行 + 失败补偿。 */
      function CreateProviderCard({ onCreated }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState } = React
        const [open, setOpen] = useState(false)
        const [displayName, setDisplayName] = useState('')
        const [baseURL, setBaseURL] = useState('')
        const [api, setApi] = useState('openai-completions')
        const [key, setKey] = useState('')
        const [route, setRoute] = useState('')
        const [routeTouched, setRouteTouched] = useState(false)
        const [draft, setDraft] = useState(null)
        const [selSids, setSelSids] = useState(new Set())
        const [manualText, setManualText] = useState('')
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const [created, setCreated] = useState('')
        const suggestRoute = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '')
        const changeName = (value) => {
          setDisplayName(value)
          if (!routeTouched) setRoute(suggestRoute(value))
        }
        const begin = async () => {
          setBusy(true); setError('')
          const res = await rpcCall('models2-create-begin', { displayName, baseURL, api, key, route })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setDraft(res.value)
          setSelSids(new Set())
          setCreated('')
        }
        const commit = async () => {
          if (draft === null) return
          setBusy(true); setError('')
          const manualIds = manualText.split(/[\n,]+/).map((id) => id.trim()).filter((id) => id !== '')
          const res = await rpcCall('models2-create-commit', { draftId: draft.draftId, sids: Array.from(selSids), manualIds })
          setBusy(false)
          if (res.ok !== true) {
            setError(mapModelsError(translate, res.error))
            return
          }
          setCreated(translate('models.wb.create.created').replace('{route}', res.value.route))
          setDraft(null)
          setSelSids(new Set())
          setManualText('')
          if (onCreated !== undefined) onCreated()
        }
        const manualIdsNow = () => manualText.split(/[\n,]+/).map((id) => id.trim()).filter((id) => id !== '')
        const candidates = draft?.candidates ?? []
        const summary = draft === null ? null : translate('models.wb.create.summary')
          .replace('{route}', draft.routeId)
          .replace('{n}', String(selSids.size + manualIdsNow().length))
          .replace('{credential}', key.trim() !== '' ? translate('models.wb.create.credNote') : '')
        const field = (label, children) => el('div', { style: { marginTop: '8px' } }, [
          el('label', { key: 'label', style: { display: 'block', fontSize: '12px', margin: '0 0 3px', color: 'var(--dsh-svc-text-muted)' } }, label),
          children,
        ])
        if (!open) {
          return el('div', { 'data-testid': 'wb-create-card', style: WB_CARD },
            el('button', { type: 'button', 'data-testid': 'wb-create-open', style: svcButtonStyle('primary'), onClick: () => setOpen(true) }, translate('models.wb.create.title')))
        }
        return el('div', { 'data-testid': 'wb-create-card', style: WB_CARD }, [
          el('div', { key: 'title', style: { fontSize: '15px', fontWeight: 600 } }, translate('models.wb.create.title')),
          error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'wb-create-error', style: Object.assign({}, WB_ERROR, { margin: '4px 0 0' }) }, error) : null,
          created !== '' ? el('p', { key: 'created', 'data-testid': 'wb-create-created', style: { margin: '6px 0 0', fontSize: '13px', color: 'var(--dsw-alias-state-success-primary)' } }, created) : null,
          draft === null ? [
            field(translate('models.wb.create.displayName'), el('input', { key: 'i', 'data-testid': 'wb-create-name', style: WB_INPUT, value: displayName, onChange: (e) => changeName(e.target.value), placeholder: 'My Gateway' })),
            field(translate('models.wb.create.baseURL'), el('input', { key: 'i', 'data-testid': 'wb-create-baseurl', style: WB_INPUT, value: baseURL, onChange: (e) => setBaseURL(e.target.value), placeholder: 'https://api.example.com/v1' })),
            field(translate('models.wb.create.api'), el('select', { key: 'i', 'data-testid': 'wb-create-api', style: WB_INPUT, value: api, onChange: (e) => setApi(e.target.value) },
              ['openai-completions', 'openai-responses', 'anthropic-messages'].map((protocol) => el('option', { key: protocol, value: protocol }, protocol)))),
            field(translate('models.wb.create.route'), el('input', { key: 'i', 'data-testid': 'wb-create-route', style: WB_INPUT, value: route, onChange: (e) => { setRouteTouched(true); setRoute(e.target.value) }, placeholder: suggestRoute(displayName) })),
            field(translate('models.wb.create.key'), el('input', { key: 'i', type: 'password', 'data-testid': 'wb-create-key', style: WB_INPUT, value: key, onChange: (e) => setKey(e.target.value) })),
            el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, [
              el('button', { key: 'begin', type: 'button', 'data-testid': 'wb-create-begin', style: svcButtonStyle('primary'), disabled: busy || displayName.trim() === '' || baseURL.trim() === '', onClick: () => void begin() }, translate('models.wb.create.begin')),
              el('button', { key: 'cancel', type: 'button', 'data-testid': 'wb-create-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: () => setOpen(false) }, translate('models.wb.create.cancel')),
            ]),
          ] : [
            el('p', { key: 'conn', style: { margin: '6px 0 0', fontSize: '12px', color: 'var(--dsh-svc-text-muted)' } },
              draft.connection?.ok === true
                ? translate('models.wb.check.ok').replace('{n}', String(draft.connection.modelCount ?? 0))
                : translate('models.wb.check.failed').replace('{error}', wbProbeErrorText(translate, draft.connection?.error))),
            el('p', { key: 'pick', 'data-testid': 'wb-create-pick-hint', style: Object.assign({}, WB_MUTED, { marginTop: '6px' }) }, translate('models.wb.create.pick')),
            candidates.length > 0 ? el('div', { key: 'candidates', 'data-testid': 'wb-create-candidates', style: { marginTop: '4px', maxHeight: '180px', overflow: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '6px 10px' } },
              candidates.map((row) => {
                const checked = selSids.has(row.sid)
                const bits = []
                if (row.draft?.name !== undefined && row.draft.name !== '') bits.push(row.draft.name)
                if (row.draft?.contextWindow !== undefined) bits.push(formatCapacity(row.draft.contextWindow))
                if (row.draft?.input !== undefined) bits.push(WB_INPUT_TEXT(row.draft.input))
                if (Array.isArray(row.inexpressible) && row.inexpressible.length > 0) bits.push(translate('models.wb.inexpressible').replace('{n}', String(row.inexpressible.length)))
                return el('label', { key: row.sid, style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', padding: '2px 0', cursor: 'pointer' } },
                  el('input', { type: 'checkbox', 'data-testid': 'wb-create-pick-' + row.modelId, checked, onChange: () => setSelSids((current) => { const next = new Set(current); if (next.has(row.sid)) next.delete(row.sid); else next.add(row.sid); return next }) }),
                  el('code', null, row.modelId),
                  bits.length > 0 ? el('span', { style: { color: 'var(--dsh-svc-text-muted)' } }, ` · ${bits.join(' · ')}`) : null)
              })) : null,
            field(translate('models.wb.create.manual'), el('textarea', { key: 'i', 'data-testid': 'wb-create-manual', style: Object.assign({}, WB_INPUT, { minHeight: '48px', resize: 'vertical' }), value: manualText, onChange: (e) => setManualText(e.target.value), placeholder: 'model-id-1\nmodel-id-2' })),
            summary !== null ? el('p', { key: 'summary', 'data-testid': 'wb-create-summary', style: { margin: '8px 0 0', fontSize: '13px' } }, summary) : null,
            el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, [
              el('button', { key: 'confirm', type: 'button', 'data-testid': 'wb-create-confirm', style: svcButtonStyle('danger'), disabled: busy, onClick: () => void commit() }, translate('models.wb.create.confirm')),
              el('button', { key: 'back', type: 'button', 'data-testid': 'wb-create-back', style: svcButtonStyle('ghost'), disabled: busy, onClick: () => { setDraft(null); setError(''); setCreated('') } }, translate('models.wb.create.cancel')),
            ]),
          ],
        ])
      }

      /** 手动模型编辑器（Q-doc 688）：基础字段常显 + 能力折叠；整表保存走
       * models2-edit-prepare → 两段确认 → models2-commit（删除模型请走移除流程）。 */
      function ManualEditor({ route, onDone, onCancel }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useEffect } = React
        const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
        const [models, setModels] = useState(null)
        const [expanded, setExpanded] = useState(new Set())
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const [plan, setPlan] = useState(null)
        const [armed, setArmed] = useState(false)
        const [saved, setSaved] = useState(false)
        useEffect(() => {
          let alive = true
          rpcCall('models2-route', { route }).then((res) => {
            if (!alive) return
            if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
            setModels((res.value.models ?? []).map((model) => ({ ...model })))
          }).catch(() => { if (alive) setError(mapModelsError(translate, 'internal')) })
          return () => { alive = false }
        }, [])
        const patchModel = (index, patch) => setModels((current) => current.map((model, i) => (i === index ? { ...model, ...patch } : model)))
        const toggleAbilities = (index) => setExpanded((current) => {
          const next = new Set(current)
          if (next.has(index)) next.delete(index); else next.add(index)
          return next
        })
        const toggleEffort = (index, level) => {
          const model = models[index]
          const current = model.reasoningEfforts !== undefined && model.reasoningEfforts !== false && typeof model.reasoningEfforts === 'object' ? model.reasoningEfforts : {}
          const next = { ...current }
          if (level === 'off') {
            if (next.off !== undefined) delete next.off
            else next.off = null
          } else {
            if (next[level] !== undefined) delete next[level]
            else next[level] = level
          }
          patchModel(index, { reasoningEfforts: Object.keys(next).length > 0 ? next : undefined })
        }
        const save = async () => {
          if (models === null || plan !== null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-edit-prepare', { route, models })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          if (res.value.noop === true) { setSaved(true); if (onDone !== undefined) onDone(); return }
          setPlan(res.value)
        }
        const confirmSave = async () => {
          if (plan === null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-commit', { planId: plan.planId })
          setBusy(false)
          if (res.ok !== true) { if (res.error === 'conflict') setPlan(null); setError(mapModelsError(translate, res.error)); return }
          setSaved(true)
          if (onDone !== undefined) onDone()
        }
        const box = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '10px 12px', marginTop: '8px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '12px' }
        const rowInput = Object.assign({}, WB_INPUT, { padding: '4px 8px', fontSize: '12px', flex: 1 })
        const fieldLabel = (text) => el('label', { style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)', display: 'block', margin: '6px 0 2px' } }, text)
        if (saved) return el('div', { 'data-testid': 'wb-edit-done', style: box }, translate('models.wb.edit.done'))
        const children = [
          el('div', { key: 'title', style: { fontWeight: 600 } }, translate('models.wb.edit.title').replace('{route}', route)),
          error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'wb-edit-error', style: Object.assign({}, WB_ERROR, { margin: 0 }) }, error) : null,
        ]
        if (models === null && error === '') children.push(el('p', { key: 'loading', style: WB_MUTED }, '…'))
        if (models !== null) {
          children.push(el('div', { key: 'list' }, models.map((model, index) => {
            const isExpanded = expanded.has(index)
            const efforts = model.reasoningEfforts !== undefined && model.reasoningEfforts !== false && typeof model.reasoningEfforts === 'object' ? model.reasoningEfforts : {}
            return el('div', { key: model.id + '-' + index, 'data-testid': 'wb-edit-model-' + index, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '8px 0' } }, [
              el('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
                el('code', { key: 'id', style: { fontSize: '12px', fontWeight: 600 } }, model.id || translate('models.wb.edit.addModel')),
                el('button', { key: 'toggle', type: 'button', 'data-testid': 'wb-edit-abilities-' + index, style: svcRowActionStyle(), onClick: () => toggleAbilities(index) }, isExpanded ? '▴' : '▾'),
              ]),
              isExpanded ? el('div', { key: 'fields' }, [
                el('div', { key: 'basic', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
                  el('div', { key: 'name', style: { flex: 2, minWidth: '160px' } }, fieldLabel(translate('models.wb.edit.name')), el('input', { 'data-testid': 'wb-edit-name-' + index, style: rowInput, value: model.name ?? '', onChange: (e) => patchModel(index, { name: e.target.value }) })),
                  el('div', { key: 'ctx', style: { flex: 1, minWidth: '100px' } }, fieldLabel(translate('models.wb.edit.context')), el('input', { 'data-testid': 'wb-edit-context-' + index, style: rowInput, type: 'number', value: model.contextWindow ?? '', onChange: (e) => patchModel(index, { contextWindow: e.target.value === '' ? undefined : Number(e.target.value) }) })),
                  el('div', { key: 'out', style: { flex: 1, minWidth: '100px' } }, fieldLabel(translate('models.wb.edit.maxTokens')), el('input', { 'data-testid': 'wb-edit-maxtokens-' + index, style: rowInput, type: 'number', value: model.maxTokens ?? '', onChange: (e) => patchModel(index, { maxTokens: e.target.value === '' ? undefined : Number(e.target.value) }) })),
                ]),
                el('label', { key: 'img', style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer', marginTop: '6px' } },
                  el('input', { type: 'checkbox', 'data-testid': 'wb-edit-image-' + index, checked: Array.isArray(model.input) && model.input.includes('image'), onChange: () => patchModel(index, { input: Array.isArray(model.input) && model.input.includes('image') ? ['text'] : ['text', 'image'] }) }),
                  translate('models.wb.edit.inputImage')),
                el('div', { key: 'efforts', style: { marginTop: '6px' } }, [
                  fieldLabel(translate('models.wb.edit.reasoning')),
                  THINKING_LEVELS.map((level) => el('label', { key: level, style: { display: 'inline-flex', gap: '4px', alignItems: 'center', cursor: 'pointer', marginRight: '8px' } },
                    el('input', { type: 'checkbox', 'data-testid': 'wb-edit-effort-' + index + '-' + level, checked: efforts[level] !== undefined, onChange: () => toggleEffort(index, level) }),
                    level === 'off' ? translate('models.wb.edit.reasoningOff') : level)),
                  el('label', { key: 'false', style: { display: 'inline-flex', gap: '4px', alignItems: 'center', cursor: 'pointer', marginRight: '8px' } },
                    el('input', { type: 'checkbox', 'data-testid': 'wb-edit-false-' + index, checked: model.reasoningEfforts === false, onChange: () => patchModel(index, { reasoningEfforts: model.reasoningEfforts === false ? undefined : false }) }),
                    translate('models.wb.edit.reasoningFalse')),
                  el('button', { key: 'clear', type: 'button', 'data-testid': 'wb-edit-clear-' + index, style: svcRowActionStyle(), onClick: () => { patchModel(index, { input: undefined, reasoningEfforts: undefined }) } }, translate('models.wb.edit.clearOverride')),
                ]),
              ]) : null,
            ])
          })))
          children.push(el('div', { key: 'footer', style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, [
            el('button', { key: 'add', type: 'button', 'data-testid': 'wb-edit-add', style: svcRowActionStyle(), onClick: () => setModels((current) => [...current, { id: '' }]) }, translate('models.wb.edit.addModel')),
            el('span', { key: 'hint', style: Object.assign({}, WB_MUTED, { marginTop: '2px' }) }, translate('models.wb.edit.removeHint')),
          ]))
        }
        if (plan !== null) {
          children.push(el('div', { key: 'plan', 'data-testid': 'wb-edit-plan', style: box }, [
            el('p', { key: 's', style: { margin: 0, fontSize: '12px' } }, `${plan.diff.changes.length} ${translate('models.wb.verify.check.models')} · +${plan.diff.added.length} · -${plan.diff.removed.length}`),
            el('div', { key: 'a', style: { display: 'flex', gap: '8px', marginTop: '6px' } }, [
              el('button', { key: 'back', type: 'button', 'data-testid': 'wb-edit-plan-back', style: svcButtonStyle('ghost'), onClick: () => setPlan(null) }, translate('models.wb.create.cancel')),
              el('button', { key: 'confirm', type: 'button', 'data-testid': 'wb-edit-confirm', style: svcButtonStyle('danger'), disabled: busy, onClick: () => { if (armed) void confirmSave(); else setArmed(true) } }, armed ? translate('models.plan.confirmArmed') : translate('models.wb.edit.confirm')),
            ]),
          ]))
        }
        if (plan === null && models !== null) {
          children.push(el('div', { key: 'save-row', style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
            el('button', { key: 'save', type: 'button', 'data-testid': 'wb-edit-save', style: svcButtonStyle('primary'), disabled: busy || models.length === 0, onClick: () => void save() }, translate('models.wb.edit.save')),
            onCancel !== undefined ? el('button', { key: 'cancel', type: 'button', 'data-testid': 'wb-edit-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: onCancel }, translate('models.wb.create.cancel')) : null,
          ]))
        }
        return el('div', { 'data-testid': 'wb-edit-panel', style: box }, children)
      }

      /** 移除守卫面板（Q-doc 689）：引用检测 → 迁移选择 → 跨事务应用（两段确认）。 */
      function RemovePanel({ route, onDone, onCancel }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useEffect } = React
        const [preview, setPreview] = useState(null)
        const [selIds, setSelIds] = useState(new Set())
        const [provider, setProvider] = useState('')
        const [model, setModel] = useState('')
        const [plan, setPlan] = useState(null)
        const [armed, setArmed] = useState(false)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const [doneText, setDoneText] = useState('')
        useEffect(() => {
          let alive = true
          rpcCall('models2-remove-preview', { route, removeIds: [] }).then((res) => {
            if (!alive) return
            if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
            setPreview(res.value)
          }).catch(() => { if (alive) setError(mapModelsError(translate, 'internal')) })
          return () => { alive = false }
        }, [])
        const subagentRef = (preview?.references ?? []).find((ref) => ref.kind === 'subagent-route')
        const defaultRef = (preview?.references ?? []).find((ref) => ref.kind === 'agent-default-model')
        const prepare = async () => {
          setBusy(true); setError('')
          const res = await rpcCall('models2-remove-plan', { route, removeIds: Array.from(selIds), ...(subagentRef !== undefined && provider !== '' ? { migrateTo: { provider, model } } : {}) })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setPlan(res.value)
        }
        const confirmRemove = async () => {
          if (plan === null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-remove-commit', { planId: plan.planId })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setDoneText(translate('models.wb.remove.done').replace('{n}', String(res.value.removed)))
          if (onDone !== undefined) onDone()
        }
        const blockable = defaultRef !== undefined
        const box = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '10px 12px', marginTop: '8px', background: 'var(--dsw-alias-bg-layer-2)', fontSize: '12px' }
        const children = [
          el('div', { key: 'title', style: { fontWeight: 600 } }, translate('models.wb.remove.title').replace('{route}', route)),
          error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'wb-remove-error', style: Object.assign({}, WB_ERROR, { margin: 0 }) }, error) : null,
          doneText !== '' ? el('p', { key: 'done', 'data-testid': 'wb-remove-done', style: { margin: 0, color: 'var(--dsw-alias-state-success-primary)' } }, doneText) : null,
        ]
        if (preview === null && error === '') children.push(el('p', { key: 'loading', style: WB_MUTED }, '…'))
        if (preview !== null) {
          const availableModels = Array.isArray(preview.models) ? preview.models : []
          children.push(el('div', { key: 'pick', 'data-testid': 'wb-remove-models', style: { marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '160px', overflow: 'auto' } },
            availableModels.length === 0
              ? el('p', { key: 'none', style: WB_MUTED }, translate('models.wb.edit.noop'))
              : availableModels.map((entry) => {
                  const checked = selIds.has(entry.id)
                  return el('label', { key: entry.id, style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer', fontSize: '12px' } },
                    el('input', { type: 'checkbox', 'data-testid': 'wb-remove-pick-' + entry.id, checked, onChange: () => setSelIds((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next }) }),
                    el('code', null, entry.id),
                    entry.name !== undefined ? el('span', { style: { color: 'var(--dsh-svc-text-muted)' } }, ` · ${entry.name}`) : null)
                })))
          if (defaultRef !== undefined) {
            children.push(el('p', { key: 'default', 'data-testid': 'wb-remove-default-ref', style: { margin: '6px 0 0', color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.remove.ref.default')))
          }
          if (subagentRef !== undefined) {
            children.push(el('p', { key: 'subagent', 'data-testid': 'wb-remove-subagent-ref', style: { margin: '6px 0 0', color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.remove.ref.subagent').replace('{model}', subagentRef.model)))
            const options = preview.migrateOptions ?? []
            children.push(el('div', { key: 'migrate', style: { display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' } }, [
              el('select', { key: 'provider', 'data-testid': 'wb-remove-provider', style: Object.assign({}, WB_INPUT, { flex: 1, minWidth: '140px' }), value: provider, onChange: (e) => { setProvider(e.target.value); setModel('') } },
                el('option', { key: '', value: '' }, translate('models.wb.remove.migrateProvider') + '…'),
                options.map((group) => el('option', { key: group.provider, value: group.provider }, group.provider))),
              el('select', { key: 'model', 'data-testid': 'wb-remove-model', style: Object.assign({}, WB_INPUT, { flex: 1, minWidth: '140px' }), value: model, disabled: provider === '', onChange: (e) => setModel(e.target.value) },
                el('option', { key: '', value: '' }, translate('models.wb.remove.migrateModel') + '…'),
                (options.find((group) => group.provider === provider)?.models ?? []).map((entry) => el('option', { key: entry.id, value: entry.id }, entry.name || entry.id))),
            ]))
          }
          children.push(el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, [
            el('button', { key: 'prepare', type: 'button', 'data-testid': 'wb-remove-prepare', style: svcButtonStyle('primary'), disabled: busy || blockable || selIds.size === 0 || (subagentRef !== undefined && (provider === '' || model === '')), onClick: () => void prepare() }, translate('models.wb.remove.plan')),
            onCancel !== undefined ? el('button', { key: 'cancel', type: 'button', 'data-testid': 'wb-remove-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: onCancel }, translate('models.wb.create.cancel')) : null,
          ]))
        }
        if (plan !== null) {
          const migrateNote = plan.migrateTo !== undefined ? ` → ${plan.migrateTo.provider}/${plan.migrateTo.model}` : ''
          children.push(el('div', { key: 'plan', 'data-testid': 'wb-remove-plan', style: box }, [
            el('p', { key: 's', style: { margin: 0, fontSize: '12px' } }, `${translate('models.wb.remove.done').replace('{n}', String(plan.removed))}${migrateNote}`),
            el('div', { key: 'a', style: { display: 'flex', gap: '8px', marginTop: '6px' } }, [
              el('button', { key: 'back', type: 'button', 'data-testid': 'wb-remove-plan-back', style: svcButtonStyle('ghost'), onClick: () => setPlan(null) }, translate('models.wb.create.cancel')),
              el('button', { key: 'confirm', type: 'button', 'data-testid': 'wb-remove-confirm', style: svcButtonStyle('danger'), disabled: busy, onClick: () => { if (armed) void confirmRemove(); else setArmed(true) } }, armed ? translate('models.plan.confirmArmed') : translate('models.wb.remove.confirm')),
            ]),
          ]))
        }
        return el('div', { 'data-testid': 'wb-remove-panel', style: box }, children)
      }

      /** 简化模型配置：首页仅负责供应商列表；进入详情后再选择来源与能力。 */
      // ── 统一界面（v1.11）：渠道优先，一套界面，无 localStorage 模式分流 ─────────
      //
      // 结构（对应规格 §3）：
      //   渠道列表 / 添加自定义渠道
      //   └─ 渠道详情：连接信息（编辑 / 换密钥）· 可搜索紧凑模型列表（勾选批量添加 / 手动 ID）
      //      · 单模型独立编辑面板 · 最近变更 / 预览并撤销 · 删除渠道
      //    删除后的恢复入口常驻列表底部（撤销入口不随渠道行消失）。
      //
      // 状态纪律：草稿只留在当前详情页；离开有未保存编辑时先确认。保存失败/冲突不清空草稿。

      /** 错误码 → 文案；已存在的 mapModelsError 复用，新码在此补充。 */
      function UnifiedProvidersWorkbench({ snapshot, reload }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useEffect, useRef } = React
        const freshKeyRef = useRef('')
        if (freshKeyRef.current === '') freshKeyRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36)
        const [detailRoute, setDetailRoute] = useState(null)
        const [rescueOpen, setRescueOpen] = useState(false)
        const routes = snapshot?.routes ?? []
        const removedRoutes = snapshot?.removedRoutes ?? []
        const activeRow = routes.find((row) => row.route === detailRoute)
        if (detailRoute !== null && activeRow !== undefined) {
          return el('div', { 'data-testid': 'models-section' }, [
            el(RouteDetail, {
              key: detailRoute,
              row: activeRow,
              freshKey: freshKeyRef.current,
              onBack: () => setDetailRoute(null),
              onChanged: reload,
            }),
          ])
        }
        return el('div', { 'data-testid': 'models-section' }, [
          el('div', { key: 'routes', style: WB_CARD }, [
            el('div', { key: 'title', 'data-testid': 'models-routes-title', style: { fontSize: '15px', fontWeight: 600, marginBottom: '6px' } }, translate('models.routes.title')),
            el('p', { key: 'legend', 'data-testid': 'models-routes-legend', style: { margin: '0 0 6px', fontSize: '12px', color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.legend')),
            snapshot === null
              ? el('p', { key: 'loading', 'data-testid': 'models-routes-loading', style: WB_MUTED }, '…')
              : routes.length === 0
                ? el('p', { key: 'empty', 'data-testid': 'models-routes-empty', style: WB_MUTED }, translate('models.wb.empty'))
                : routes.map((row) => el(RouteRow, { key: row.route, row, onOpen: () => setDetailRoute(row.route), reload })),
          ]),
          el(CreateProviderCard, { key: 'create', onCreated: reload }),
          // 删除恢复入口：常驻，不随渠道行消失。
          el('div', { key: 'rescue', 'data-testid': 'models-route-rescue', style: WB_CARD }, [
            el('button', {
              key: 'toggle', type: 'button', 'data-testid': 'models-route-rescue-toggle',
              'aria-expanded': String(rescueOpen),
              style: Object.assign({}, svcButtonStyle('ghost'), { width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }),
              onClick: () => setRescueOpen(!rescueOpen),
            }, [
              el('span', { key: 'label', style: { fontWeight: 600 } }, translate('models.wb.rescue.title')),
              el('span', { key: 'count', style: { fontSize: '12px', color: 'var(--dsh-svc-text-muted)' } }, String(removedRoutes.length)),
            ]),
            rescueOpen
              ? (removedRoutes.length === 0
                  ? el('p', { key: 'none', 'data-testid': 'models-route-rescue-empty', style: Object.assign({}, WB_MUTED, { marginTop: '8px' }) }, translate('models.wb.rescue.empty'))
                  : el('div', { key: 'list', style: { marginTop: '8px' } }, removedRoutes.map((entry) => el(RestoreRow, { key: entry.route, entry, reload }))))
              : null,
          ]),
        ])
      }

      /** 渠道行：名字 + 数量 + 能力徽章 + 需处理标记 + 进入详情。 */
      function RouteRow({ row, onOpen, reload }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState } = React
        const [resolveArmed, setResolveArmed] = useState(false)
        const [error, setError] = useState('')
        const needsResolve = (row.attention ?? []).includes('recovery-pending')
        const resolveFlag = async () => {
          if (!resolveArmed) { setResolveArmed(true); return }
          setResolveArmed(false)
          const res = await rpcCall('models2-recovery-resolve', { route: row.route })
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          if (reload !== undefined) reload()
        }
        const badges = []
        if (row.source === 'builtin') badges.push({ key: 'builtin', label: translate('models.wb.builtinUser'), style: svcBadgeStyle('info') })
        if (row.metaCounts?.inputImage > 0) badges.push({ key: 'image', label: translate('models.wb.seeImage'), style: svcBadgeStyle('neutral') })
        if (row.metaCounts?.reasoning > 0) badges.push({ key: 'thinking', label: translate('models.wb.canThink'), style: svcBadgeStyle('neutral') })
        return el('div', { key: row.route, 'data-testid': 'models-route-row-' + row.route, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '12px 0' } }, [
          el('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            el('button', {
              key: 'open', type: 'button', 'data-testid': 'models-route-' + row.route,
              style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, textAlign: 'left', border: '0', background: 'transparent', color: 'inherit', padding: '0', font: 'inherit', cursor: 'pointer' },
              onClick: onOpen,
            }, [
              el('b', { key: 'name' }, row.displayName),
              el('span', { key: 'count', style: { color: 'var(--dsh-svc-text-muted)', fontSize: '12px' } }, translate('models.wb.modelCount').replace('{n}', String(row.modelCount))),
              ...badges.map((badge) => el('span', { key: badge.key, style: badge.style }, badge.label)),
            ]),
            row.needsAttention === true ? el('span', { key: 'attention', 'data-testid': 'wb-attention-' + row.route, style: svcBadgeStyle('danger') }, translate('models.wb.needsAttention')) : null,
          ]),
          el('div', { key: 'stats', 'data-testid': 'wb-stats-' + row.route, style: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--dsh-svc-text-muted)', alignItems: 'center', marginTop: '4px' } }, [
            row.baseURL !== '' ? el('code', { key: 'url', style: { fontSize: '11px', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.baseURL) : null,
            row.api !== '' ? el('span', { key: 'api' }, row.api) : null,
            // 三种状态分开显示：配置保存（本行存在）· 运行时加载 · 真实调用测试。
            el('span', { key: 'runtime', 'data-testid': 'wb-runtime-' + row.route }, row.runtimeLoaded === true ? translate('models.wb.state.runtimeLoaded') : translate('models.wb.state.runtimeMissing')),
            row.lastValidation !== undefined && row.lastValidation.ok === false
              ? el('span', { key: 'validation', style: { color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.validationFailed'))
              : row.lastValidation !== undefined
                ? el('span', { key: 'validation' }, translate('models.wb.lastValidated').replace('{time}', formatRelativeTime(translate, row.lastValidation.at)))
                : el('span', { key: 'validation' }, translate('models.wb.neverValidated')),
            row.undoable === true ? el('span', { key: 'undoable', style: svcBadgeStyle('neutral') }, translate('models.wb.undoAvailable')) : null,
          ]),
          row.needsAttention === true ? el('div', { key: 'flags', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' } }, [
            ...(row.attention ?? []).map((flag) => {
              const labelKey = flag === 'dangling-credential' ? 'dangling' : flag === 'invalid-profile' ? 'invalid' : flag === 'validation-failed' ? 'validation' : flag === 'recovery-pending' ? 'recovery' : flag
              return el('span', { key: flag, 'data-testid': 'wb-flag-' + flag + '-' + row.route, style: svcBadgeStyle('warning'), title: translate('models.wb.attention.' + labelKey + 'Hint') }, translate('models.wb.attention.' + labelKey))
            }),
            needsResolve ? el('button', {
              key: 'resolve', type: 'button', 'data-testid': 'wb-resolve-' + row.route,
              style: svcRowActionStyle({ color: resolveArmed ? 'var(--dsh-svc-danger)' : 'var(--dsh-svc-text-muted)' }),
              onClick: () => void resolveFlag(),
            }, resolveArmed ? translate('models.plan.confirmArmed') : translate('models.wb.recovery.resolve')) : null,
          ]) : null,
          error !== '' ? el('p', { key: 'error', 'data-testid': 'wb-resolve-error-' + row.route, style: Object.assign({}, WB_ERROR, { marginTop: '4px' }) }, error) : null,
        ])
      }

      /** 删除恢复行：整份 profile 写回；引用被占用时给原因而不是静默失败。 */
      function RestoreRow({ entry, reload }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState } = React
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const [done, setDone] = useState(false)
        const restore = async () => {
          setBusy(true); setError('')
          const res = await rpcCall('models2-route-restore', { route: entry.route })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setDone(true)
          if (reload !== undefined) reload()
        }
        return el('div', { key: entry.route, 'data-testid': 'models-route-removed-' + entry.route, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '8px 0', fontSize: '12px' } }, [
          el('div', { key: 'head', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
            el('b', { key: 'name' }, entry.displayName),
            el('span', { key: 'count', style: { color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.modelCount').replace('{n}', String(entry.modelCount))),
            el('span', { key: 'at', style: { color: 'var(--dsh-svc-text-muted)' } }, formatRelativeTime(translate, entry.at)),
            entry.credentialRef !== undefined ? el('span', { key: 'key', style: { color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.keyRef').replace('{ref}', entry.credentialRef)) : null,
          ]),
          entry.taken === true ? el('p', { key: 'taken', 'data-testid': 'models-route-removed-taken-' + entry.route, style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.rescue.taken')) : null,
          done ? el('p', { key: 'done', 'data-testid': 'models-route-restored-' + entry.route, style: { margin: '4px 0 0', color: 'var(--dsw-alias-state-success-primary)' } }, translate('models.wb.rescue.done')) : null,
          error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'models-route-restore-error-' + entry.route, style: WB_ERROR }, error) : null,
          el('button', {
            key: 'go', type: 'button', 'data-testid': 'models-route-restore-' + entry.route,
            style: Object.assign({}, svcButtonStyle('primary'), { marginTop: '6px' }),
            disabled: busy || done || entry.taken === true,
            onClick: () => void restore(),
          }, translate('models.wb.rescue.restore')),
          el('p', { key: 'note', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.rescue.note')),
        ])
      }

      /**
       * 渠道详情：一个页面完成连接编辑、换密钥、模型管理、撤销与删除。
       * 草稿语义：`draft`（连接字段 + 密钥）与 `rows`（模型行）都只在本页；
       * 离开前若有未保存改动，先确认（离开提醒），不在跨刷新后假装恢复草稿。
       */
      function RouteDetail({ row, freshKey, onBack, onChanged }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useEffect, useRef } = React
        const route = row.route
        const aliveRef = useRef(true)
        useEffect(() => () => { aliveRef.current = false }, [])
        const [detail, setDetail] = useState(null)
        const [loadError, setLoadError] = useState('')
        const [tab, setTab] = useState('models')
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const [notice, setNotice] = useState('')

        // 连接草稿
        const [conn, setConn] = useState(null)
        const [keyDraft, setKeyDraft] = useState('')
        const [connPreview, setConnPreview] = useState(null)
        const [connPlan, setConnPlan] = useState(null)
        // 模型列表 / 草稿
        const [rows, setRows] = useState(null)
        const [search, setSearch] = useState('')
        const [editing, setEditing] = useState(null)
        const [removing, setRemoving] = useState(null)
        const [addOpen, setAddOpen] = useState(false)
        const [leaveAsk, setLeaveAsk] = useState(false)
        const [removeConfirms, setRemoveConfirms] = useState(0)

        const load = async () => {
          const res = await rpcCall('models2-route', { route })
          if (!aliveRef.current) return
          if (res.ok !== true) { setLoadError(mapModelsError(translate, res.error)); return }
          setDetail(res.value)
          setConn({
            displayName: res.value.displayName ?? route,
            api: res.value.api ?? '',
            baseURL: res.value.baseURL ?? '',
          })
          setRows((res.value.models ?? []).map((model) => (model !== null && typeof model === 'object' ? { ...model } : model)))
        }
        useEffect(() => { void load() }, [])
        const refresh = () => { void load(); if (onChanged !== undefined) onChanged() }

        const connDirty = conn !== null && detail !== null && (
          conn.displayName !== (detail.displayName ?? route) || conn.api !== (detail.api ?? '') || conn.baseURL !== (detail.baseURL ?? '') || keyDraft !== ''
        )
        const dirty = connDirty
        const attemptBack = () => {
          if (dirty) { setLeaveAsk(true); return }
          onBack()
        }

        // ── 连接：预览（含出网可用性、凭据可写性）→ 提交 ──────────────────────────
        const previewConnection = async (nextKey) => {
          setBusy(true); setError(''); setNotice('')
          const res = await rpcCall('models2-connection-preview', { route, next: conn ?? {}, ...(nextKey !== undefined && nextKey !== '' ? {} : {}) })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return null }
          setConnPreview(res.value)
          return res.value
        }
        const saveConnection = async () => {
          setBusy(true); setError(''); setNotice('')
          const preview = connPreview ?? await rpcCall('models2-connection-preview', { route, next: conn ?? {} }).then((res) => (res.ok === true ? res.value : null))
          if (preview === null) { setBusy(false); setError(mapModelsError(translate, 'internal')); return }
          setConnPreview(preview)
          setConnPlan({ preview, key: keyDraft })
          setBusy(false)
        }
        const commitConnection = async () => {
          if (connPlan === null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-connection-commit', {
            route, next: conn ?? {}, key: connPlan.key, baseFingerprint: connPlan.preview.fingerprint,
          })
          setBusy(false)
          if (res.ok !== true) {
            // 冲突/失败都不清空草稿：对照最新值后重新确认即可再次提交。
            setError(mapModelsError(translate, res.error))
            return
          }
          setKeyDraft(''); setConnPreview(null); setConnPlan(null)
          setNotice(translate('models.wb.conn.saved'))
          refresh()
        }

        // ── 模型：单行独立编辑（面板内保存）────────────────────────────────────────
        const patchRow = async (modelId, patch) => {
          setBusy(true); setError(''); setNotice('')
          const res = await rpcCall('models2-model-patch', { route, modelId, patch })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return false }
          if (res.value?.noop === true) { setNotice(translate('models.wb.edit.noop')); return true }
          setNotice(translate('models.wb.edit.done'))
          refresh()
          return true
        }

        // ── 模型：删除（预览后果 → 一次最终确认）──────────────────────────────────
        const previewRemove = async (modelId, removeIds) => {
          setBusy(true); setError(''); setNotice('')
          const res = await rpcCall('models2-remove-preview', { route, removeIds })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setRemoving({ modelId, removeIds, preview: res.value, plan: null })
          setRemoveConfirms(0)
        }
        const planRemove = async () => {
          if (removing === null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-remove-plan', { route, removeIds: removing.removeIds })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setRemoving({ ...removing, plan: res.value })
          setRemoveConfirms(1)
        }
        const commitRemove = async () => {
          if (removing?.plan === null || removing?.plan === undefined) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-remove-commit', { planId: removing.plan.planId })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setRemoving(null); setRemoveConfirms(0)
          setNotice(translate('models.wb.remove.done').replace('{n}', String(res.value.removed)))
          refresh()
        }

        // ── 删除渠道：后果预览 → 最终确认（凭据保留）───────────────────────────────
        const [deletePlan, setDeletePlan] = useState(null)
        const [deleteArmed, setDeleteArmed] = useState(false)
        const previewDelete = async () => {
          setBusy(true); setError('')
          const res = await rpcCall('models2-route-remove-preview', { route })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setDeletePlan(res.value)
        }
        const commitDelete = async () => {
          if (deletePlan === null) return
          if (!deleteArmed) { setDeleteArmed(true); return }
          setBusy(true); setError('')
          const res = await rpcCall('models2-route-remove-commit', { route, baseFingerprint: deletePlan.fingerprint })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); setDeleteArmed(false); return }
          onChanged !== undefined && onChanged()
          onBack()
        }

        // ── 撤销：预览 → 确认 ─────────────────────────────────────────────────────
        const [undoOpen, setUndoOpen] = useState(false)
        const [previewUndo, setPreviewUndo] = useState(false)
        const undoPreview = async () => {
          setBusy(true); setError('')
          const res = await rpcCall('models2-undo-preview', { route })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setUndoOpen(true)
        }
        const commitUndo = async () => {
          if (!previewUndo) { setPreviewUndo(true); return }
          setBusy(true); setError('')
          const res = await rpcCall('models2-undo-commit', { route })
          setBusy(false)
          setPreviewUndo(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setUndoOpen(false); setNotice(translate('models.wb.undo.done'))
          refresh()
        }

        // ── 测试：保存后主动触发；发起前说明内容与费用 ─────────────────────────────
        const [testState, setTestState] = useState(null)
        const [testArmed, setTestArmed] = useState(false)
        const runValidate = async (deep) => {
          if (deep && !testArmed) { setTestArmed(true); return }
          setBusy(true); setError(''); setTestArmed(false)
          const res = await rpcCall('models2-validate', { route, ...(deep ? { deep: true } : {}) })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setTestState(res.value)
          refresh()
        }

        if (detail === null && loadError === '') {
          return el('div', { 'data-testid': 'models-section' }, [
            el('button', { key: 'back', type: 'button', 'data-testid': 'models-detail-back', style: svcButtonStyle('ghost'), onClick: onBack }, translate('models.wb.create.cancel')),
            el('p', { key: 'loading', style: WB_MUTED }, '…'),
          ])
        }
        if (loadError !== '') {
          return el('div', { 'data-testid': 'models-section' }, [
            el('button', { key: 'back', type: 'button', 'data-testid': 'models-detail-back', style: svcButtonStyle('ghost'), onClick: onBack }, translate('models.wb.create.cancel')),
            el('p', { key: 'error', role: 'alert', 'data-testid': 'models-detail-error', style: WB_ERROR }, loadError),
          ])
        }

        const visibleRows = (rows ?? []).filter((model) => {
          const q = search.trim().toLowerCase()
          if (q === '') return true
          return String(model?.id ?? '').toLowerCase().includes(q) || String(model?.name ?? '').toLowerCase().includes(q)
        })
        const attention = row.attention ?? []
        const tabs = [
          { id: 'models', label: translate('models.wb.tab.models'), count: (rows ?? []).length },
          { id: 'connection', label: translate('models.wb.tab.connection') },
          { id: 'danger', label: translate('models.wb.tab.danger') },
        ]
        return el('div', { 'data-testid': 'models-section' }, [
          el('div', { key: 'head', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
            el('button', { key: 'back', type: 'button', 'data-testid': 'models-detail-back', style: svcButtonStyle('ghost'), onClick: attemptBack }, translate('models.wb.create.cancel')),
            el('h3', { key: 'title', 'data-testid': 'models-provider-detail-title', style: { margin: '8px 0 0' } }, detail.displayName ?? route),
            row.source === 'builtin' ? el('span', { key: 'builtin', style: svcBadgeStyle('info') }, translate('models.wb.builtinUser')) : null,
          ]),
          el('p', { key: 'summary', 'data-testid': 'models-provider-detail-summary', style: WB_MUTED }, [detail.baseURL ?? '', detail.api !== '' ? ` · ${detail.api}` : '', ` · ${(rows ?? []).length}`]),
          attention.length > 0 ? el('div', { key: 'todos', 'data-testid': 'models-detail-todos', style: WB_CARD }, [
            el('p', { key: 'head', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.detail.todos').replace('{n}', String(attention.length))),
            ...attention.map((flag) => {
              const labelKey = flag === 'dangling-credential' ? 'dangling' : flag === 'invalid-profile' ? 'invalid' : flag === 'validation-failed' ? 'validation' : flag === 'recovery-pending' ? 'recovery' : flag
              return el('div', { key: flag, 'data-testid': 'models-detail-todo-' + flag, style: { fontSize: '12px', margin: '2px 0' } }, [
                el('b', { key: 'label', style: { marginRight: '6px' } }, translate('models.wb.attention.' + labelKey)),
                el('span', { key: 'hint', style: { color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.attention.' + labelKey + 'Hint')),
              ])
            }),
          ]) : null,
          leaveAsk ? el('div', { key: 'leave', 'data-testid': 'models-leave-ask', style: WB_CARD }, [
            el('p', { key: 'msg', style: { margin: '0 0 6px', fontSize: '12px' } }, translate('models.wb.leave.body')),
            el('div', { key: 'row', style: { display: 'flex', gap: '8px' } }, [
              el('button', { key: 'stay', type: 'button', 'data-testid': 'models-leave-stay', style: svcButtonStyle('ghost'), onClick: () => setLeaveAsk(false) }, translate('models.wb.leave.stay')),
              el('button', { key: 'go', type: 'button', 'data-testid': 'models-leave-go', style: svcButtonStyle('danger'), onClick: onBack }, translate('models.wb.leave.go')),
            ]),
          ]) : null,
          el('div', { key: 'tabs', style: { display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' } },
            tabs.map((item) => el('button', {
              key: item.id, type: 'button', 'data-testid': 'models-detail-tab-' + item.id,
              style: svcButtonStyle(tab === item.id ? 'primary' : 'neutral'),
              onClick: () => setTab(item.id),
            }, item.count === undefined ? item.label : `${item.label} (${item.count})`))),
          error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'models-detail-error', style: WB_ERROR }, error) : null,
          notice !== '' ? el('p', { key: 'notice', 'data-testid': 'models-detail-notice', style: { margin: '8px 0 0', fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' } }, notice) : null,

          // ── 连接信息 ──────────────────────────────────────────────────────────
          tab === 'connection' ? el('div', { key: 'conn', 'data-testid': 'models-connection-panel', style: WB_CARD }, [
            el('div', { key: 'name', style: { marginBottom: '6px' } }, [
              el('label', { key: 'l', style: { display: 'block', fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.conn.displayName')),
              el('input', { key: 'i', 'data-testid': 'models-conn-name', style: WB_INPUT, value: conn?.displayName ?? '', onChange: (event) => { setConn({ ...conn, displayName: event.target.value }); setConnPreview(null); setConnPlan(null) } }),
            ]),
            el('div', { key: 'api', style: { marginBottom: '6px' } }, [
              el('label', { key: 'l', style: { display: 'block', fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.conn.api')),
              el('select', { key: 's', 'data-testid': 'models-conn-api', style: WB_INPUT, value: conn?.api ?? '', onChange: (event) => { setConn({ ...conn, api: event.target.value }); setConnPreview(null); setConnPlan(null) } },
                (detail.apiProtocols ?? []).map((protocol) => el('option', { key: protocol, value: protocol }, protocol))),
            ]),
            el('div', { key: 'url', style: { marginBottom: '6px' } }, [
              el('label', { key: 'l', style: { display: 'block', fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.conn.baseURL')),
              el('input', { key: 'i', 'data-testid': 'models-conn-baseurl', style: WB_INPUT, value: conn?.baseURL ?? '', placeholder: 'https://…', onChange: (event) => { setConn({ ...conn, baseURL: event.target.value }); setConnPreview(null); setConnPlan(null) } }),
              el('p', { key: 'hint', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.conn.urlHint')),
            ]),
            el('div', { key: 'key', style: { marginBottom: '6px' } }, [
              el('label', { key: 'l', style: { display: 'block', fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.conn.key')),
              el('input', {
                key: 'i', 'data-testid': 'models-conn-key', style: WB_INPUT, type: 'password', value: keyDraft,
                autoComplete: 'new-password', placeholder: translate('models.wb.conn.keyPlaceholder'),
                onChange: (event) => { setKeyDraft(event.target.value); setConnPlan(null) },
              }),
              el('p', { key: 'hint', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.conn.keyHint')),
            ]),
            connPreview !== null ? el('div', { key: 'preview', 'data-testid': 'models-conn-preview', style: { fontSize: '12px', marginTop: '6px' } }, [
              el('p', { key: 'probe', style: { margin: 0 } }, connPreview.probeAllowed === true ? translate('models.wb.conn.probeOk') : translate('models.wb.conn.probeBlocked').replace('{reason}', connPreview.probeBlocked ?? '')),
              el('p', { key: 'cred', style: { margin: '2px 0 0' } }, translate('models.wb.conn.credState')
                .replace('{ref}', connPreview.credential?.ref ?? '')
                .replace('{state}', connPreview.credential?.shadowed === true ? translate('models.wb.conn.credShadowed') : connPreview.credential?.configured === true ? translate('models.wb.conn.credConfigured') : translate('models.wb.conn.credAbsent'))),
            ]) : null,
            el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, [
              el('button', { key: 'save', type: 'button', 'data-testid': 'models-conn-save', style: svcButtonStyle('primary'), disabled: busy, onClick: () => void saveConnection() }, translate('models.wb.conn.save')),
            ]),
          ]) : null,
          // 连接保存的后果预览：写哪些键、出网是否可用、凭据会怎样。
          connPlan !== null ? el('div', { key: 'connPlan', 'data-testid': 'models-conn-plan', style: WB_CARD }, [
            el('p', { key: 'title', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.conn.planTitle')),
            el('p', { key: 'fields', style: Object.assign({}, WB_MUTED) }, translate('models.wb.conn.planFields').replace('{fields}', Object.keys(connPlan.preview.patch ?? {}).filter((k) => k !== 'badBaseURL').join(' / ') || translate('models.wb.conn.planNothing'))),
            el('p', { key: 'key', style: Object.assign({}, WB_MUTED, { marginTop: '2px' }) }, connPlan.key !== '' ? translate('models.wb.conn.planKey') : translate('models.wb.conn.planNoKey')),
            connPlan.preview.credential?.shadowed === true ? el('p', { key: 'shadow', 'data-testid': 'models-conn-plan-shadow', style: Object.assign({}, WB_ERROR, { marginTop: '4px' }) }, translate('models.wb.conn.shadowWarn').replace('{ref}', connPlan.preview.credential.ref)) : null,
            el('div', { key: 'row', style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
              el('button', { key: 'cancel', type: 'button', 'data-testid': 'models-conn-plan-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: () => { setConnPlan(null); setConnPreview(null) } }, translate('models.wb.create.cancel')),
              el('button', { key: 'go', type: 'button', 'data-testid': 'models-conn-confirm', style: svcButtonStyle('primary'), disabled: busy, onClick: () => void commitConnection() }, translate('models.wb.conn.confirm')),
            ]),
          ]) : null,

          // ── 模型列表 ──────────────────────────────────────────────────────────
          tab === 'models' ? el('div', { key: 'models', 'data-testid': 'models-provider-models', style: WB_CARD }, [
            el('div', { key: 'tools', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [
              el('input', {
                key: 'search', 'data-testid': 'models-model-search', style: Object.assign({}, WB_INPUT, { flex: 1, minWidth: '160px' }),
                value: search, placeholder: translate('models.wb.search.placeholder'),
                onChange: (event) => setSearch(event.target.value),
              }),
              el('button', { key: 'add', type: 'button', 'data-testid': 'models-add-open', style: svcButtonStyle(addOpen ? 'primary' : 'neutral'), onClick: () => setAddOpen(!addOpen) }, translate('models.wb.add.title')),
            ]),
            addOpen ? el(AddModelsPanel, { key: 'add-panel', row, detail, existingIds: new Set((rows ?? []).map((model) => model?.id)), onDone: () => { setAddOpen(false); refresh() }, onCancel: () => setAddOpen(false) }) : null,
            rows === null
              ? el('p', { key: 'loading', style: WB_MUTED }, '…')
              : (rows ?? []).length === 0
                ? el('p', { key: 'empty', 'data-testid': 'models-provider-models-empty', style: WB_MUTED }, translate('models.wb.detail.empty'))
                : el('div', { key: 'list', 'data-testid': 'models-model-list', style: { marginTop: '8px' } }, [
                    visibleRows.length === 0 ? el('p', { key: 'nomatch', 'data-testid': 'models-model-nomatch', style: WB_MUTED }, translate('models.wb.search.none')) : null,
                    ...visibleRows.map((model) => el(ModelRow, {
                      key: model.id, model, route, busy,
                      expanded: editing === model.id,
                      onToggle: () => setEditing(editing === model.id ? null : model.id),
                      onSave: (patch) => patchRow(model.id, patch),
                      onRemove: () => void previewRemove(model.id, [model.id]),
                    })),
                  ]),
          ]) : null,
          // 删除模型：后果清单 → 一次最终确认。
          removing !== null ? el('div', { key: 'remove', 'data-testid': 'models-remove-panel', style: WB_CARD }, [
            el('p', { key: 'title', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.remove.title').replace('{route}', removing.modelId)),
            el('p', { key: 'after', 'data-testid': 'models-remove-after', style: WB_MUTED }, translate('models.wb.remove.after').replace('{n}', String(removing.preview.remainingCount))),
            (removing.preview.references ?? []).some((ref) => ref.kind === 'agent-default-model')
              ? el('p', { key: 'blocked', 'data-testid': 'models-remove-blocked', style: { margin: '4px 0 0', fontSize: '12px', color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.remove.ref.default'))
              : null,
            (removing.preview.blocked === true)
              ? el('p', { key: 'blockedHint', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.remove.blockedHint'))
              : null,
            removing.plan !== null ? el('p', { key: 'plan', 'data-testid': 'models-remove-plan-summary', style: { margin: '6px 0 0', fontSize: '12px' } }, translate('models.wb.remove.done').replace('{n}', String(removing.plan.removed))) : null,
            error !== '' ? null : null,
            el('div', { key: 'row', style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, [
              el('button', { key: 'cancel', type: 'button', 'data-testid': 'models-remove-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: () => { setRemoving(null); setRemoveConfirms(0) } }, translate('models.wb.create.cancel')),
              removing.plan === null
                ? el('button', { key: 'plan', type: 'button', 'data-testid': 'models-remove-prepare', style: svcButtonStyle('primary'), disabled: busy || removing.preview.blocked === true, onClick: () => void planRemove() }, translate('models.wb.remove.plan'))
                : el('button', { key: 'go', type: 'button', 'data-testid': 'models-remove-confirm', style: svcButtonStyle('danger'), disabled: busy, onClick: () => void commitRemove() }, removeConfirms > 0 ? translate('models.wb.remove.confirm') : translate('models.wb.remove.confirm')),
            ]),
          ]) : null,

          // ── 撤销 ──────────────────────────────────────────────────────────────
          undoOpen ? el(UndoPanel, { key: 'undo', route, onUndone: () => { setUndoOpen(false); refresh() }, onCancel: () => { setUndoOpen(false); setPreviewUndo(false) } }) : null,

          // ── 测试 ──────────────────────────────────────────────────────────────
          tab === 'models' ? el('div', { key: 'test', 'data-testid': 'models-test-panel', style: WB_CARD }, [
            el('p', { key: 'title', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.test.title')),
            el('p', { key: 'note', style: WB_MUTED }, translate('models.wb.test.note')),
            el('div', { key: 'row', style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, [
              el('button', { key: 'shallow', type: 'button', 'data-testid': 'models-test-run', style: svcButtonStyle('neutral'), disabled: busy, onClick: () => void runValidate(false) }, translate('models.wb.verify.run')),
              el('button', { key: 'deep', type: 'button', 'data-testid': 'models-test-deep', style: svcButtonStyle(testArmed ? 'danger' : 'neutral'), disabled: busy, onClick: () => void runValidate(true) }, testArmed ? translate('models.wb.test.deepArmed') : translate('models.wb.test.deep')),
            ]),
            testArmed ? el('p', { key: 'armed', 'data-testid': 'models-test-cost', style: Object.assign({}, WB_MUTED, { marginTop: '6px' }) }, translate('models.wb.test.cost')) : null,
            testState !== null ? el('div', { key: 'result', 'data-testid': 'models-test-result', style: { marginTop: '8px', fontSize: '12px' } }, [
              ...(testState.checks ?? []).map((check, i) => el('div', { key: 'c' + i, 'data-testid': 'models-test-check-' + check.type, style: { margin: '2px 0' } },
                `${check.type}: ${check.skipped === true ? translate('models.wb.verify.skipped') : check.ok === true ? translate('models.wb.verify.ok') : translate('models.wb.verify.fail')}${check.error !== undefined ? ` (${check.error})` : ''}`)),
              el('p', { key: 'scope', 'data-testid': 'models-test-scope', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, testState.deep === true ? translate('models.wb.test.scopeDeep') : translate('models.wb.test.scopeShallow')),
            ]) : null,
          ]) : null,

          // ── 危险区：撤销上次变更 + 删除渠道 ────────────────────────────────────
          tab === 'danger' ? el('div', { key: 'danger', 'data-testid': 'models-danger-panel', style: WB_CARD }, [
            el('p', { key: 'title', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.danger.title')),
            row.undoable === true
              ? el('div', { key: 'undo', style: { marginBottom: '8px' } }, [
                  el('p', { key: 'note', style: WB_MUTED }, translate('models.wb.undoWrite')),
                  el('button', { key: 'go', type: 'button', 'data-testid': 'models-undo-open', style: svcButtonStyle('neutral'), disabled: busy, onClick: () => void undoPreview() }, translate('models.wb.undoWrite')),
                ])
              : el('p', { key: 'noundo', 'data-testid': 'models-undo-unavailable', style: WB_MUTED }, translate('models.wb.undo.nothing')),
            deletePlan === null
              ? el('button', { key: 'del', type: 'button', 'data-testid': 'models-route-delete', style: svcButtonStyle('dangerGhost'), disabled: busy, onClick: () => void previewDelete() }, translate('models.wb.routeDelete.btn'))
              : el('div', { key: 'delPlan', 'data-testid': 'models-route-delete-plan', style: { marginTop: '8px', fontSize: '12px' } }, [
                  el('p', { key: 'a', style: { margin: 0 } }, translate('models.wb.routeDelete.plan').replace('{n}', String(deletePlan.modelCount))),
                  el('p', { key: 'b', style: { margin: '2px 0 0' } }, deletePlan.credential?.retained === true ? translate('models.wb.routeDelete.key').replace('{ref}', deletePlan.credential.ref ?? '') : translate('models.wb.routeDelete.noKey')),
                  deletePlan.blocked === true ? el('p', { key: 'c', 'data-testid': 'models-route-delete-blocked', style: { margin: '2px 0 0', color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.routeDelete.blocked')) : null,
                  deletePlan.references.length > 0 && deletePlan.blocked !== true ? el('p', { key: 'd', style: { margin: '2px 0 0', color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.routeDelete.refs').replace('{n}', String(deletePlan.references.length))) : null,
                  el('div', { key: 'row', style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
                    el('button', { key: 'cancel', type: 'button', 'data-testid': 'models-route-delete-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: () => { setDeletePlan(null); setDeleteArmed(false) } }, translate('models.wb.create.cancel')),
                    el('button', { key: 'go', type: 'button', 'data-testid': 'models-route-delete-confirm', style: svcButtonStyle('danger'), disabled: busy || deletePlan.blocked === true, onClick: () => void commitDelete() }, deleteArmed ? translate('models.wb.routeDelete.confirmArmed') : translate('models.wb.routeDelete.confirm')),
                  ]),
                ]),
          ]) : null,
        ])
      }

      /** 折叠行里的图标（内联 SVG，客户端半不引第三方图标包）：chevron + 垃圾桶。 */
      function wbChevron(expanded) {
        return React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, style: { transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' } },
          React.createElement('path', { d: 'M6 3.5L10.5 8L6 12.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      function wbTrashIcon() {
        return React.createElement('svg', { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          React.createElement('path', { d: 'M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4.5M6.6 7v4M9.4 7v4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      }
      /** 模态小方块（参考图形态）：选中=高亮描边，未选=弱化描边；`text` 末位不可取消。 */
      function wbModalityBox({ testId, checked, disabled, label, glyph, onToggle }) {
        const el = React.createElement
        return el('label', {
          key: testId, 'data-testid': testId + '-box', 'data-checked': checked ? 'true' : 'false',
          title: label, 'aria-label': label,
          style: {
            position: 'relative',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            minWidth: '38px', height: '34px', padding: '0 8px', cursor: disabled ? 'default' : 'pointer',
            borderRadius: '9px',
            border: checked ? '1px solid var(--dsh-svc-border-strong)' : '1px solid var(--dsw-alias-border-l2)',
            background: checked ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-2)',
            color: checked ? 'var(--dsw-alias-label-primary)' : 'var(--dsh-svc-text-muted)',
            opacity: disabled ? 0.55 : 1,
          },
        }, [
          el('input', {
            key: 'i', type: 'checkbox', 'data-testid': testId, checked, disabled,
            style: { position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: disabled ? 'default' : 'pointer' },
            onChange: () => { if (disabled !== true) onToggle() },
          }),
          typeof glyph === 'string' ? el('span', { key: 'g', style: { fontSize: '13px', fontWeight: 600, lineHeight: 1 } }, glyph) : glyph,
        ])
      }

      /**
       * 单模型独立编辑面板（参考图「模型目录」形态）：一行身份 + 展开的模型选项。
       *
       * 语义不变量（规格 §3）：未勾选任何推理档 = **不声明**（继承目录能力），
       * 绝不把「未表态」写回成空映射或 `false`；显式声明非推理模型必须单独勾选。
       * 保存按钮在面板内始终可达；草稿只在本页，保存失败不清空。
       */
      function ModelRow({ model, route, busy, expanded, onToggle, onSave, onRemove }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState } = React
        const [draft, setDraft] = useState(null)
        const [error, setError] = useState('')
        // 容量字段是文本（可写 `256K`/`1M`）：未提交的原始文本留在本地，失焦才归一。
        const [capacityTexts, setCapacityTexts] = useState({})
        const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
        const EDITABLE = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts']
        const current = draft ?? model
        const snapshotOf = (source) => ({
          name: source.name, contextWindow: source.contextWindow, maxTokens: source.maxTokens,
          input: source.input, reasoningEfforts: source.reasoningEfforts,
        })
        const open = () => {
          if (!expanded) { setDraft(snapshotOf(model)); setCapacityTexts({}); setError('') }
          onToggle()
        }
        const dirty = draft !== null && JSON.stringify(snapshotOf(model)) !== JSON.stringify(draft)
        const patchDraft = (patch) => setDraft({ ...(draft ?? model), ...patch })
        const effortsOf = () => {
          const efforts = current.reasoningEfforts
          return efforts !== undefined && efforts !== false && typeof efforts === 'object' && efforts !== null ? { ...efforts } : {}
        }
        const wireOf = (level) => {
          const efforts = effortsOf()
          if (!Object.prototype.hasOwnProperty.call(efforts, level)) return undefined
          return efforts[level]
        }
        const levelChecked = (level) => wireOf(level) !== undefined
        /** 档位勾选/取消：勾选即写同名协议值（off 写 null = 关闭时不发送参数），取消即删除该档。 */
        const toggleLevel = (level) => {
          const efforts = effortsOf()
          if (Object.prototype.hasOwnProperty.call(efforts, level)) delete efforts[level]
          else efforts[level] = level === 'off' ? null : level
          applyEfforts(efforts)
        }
        /** 行内协议值：等于档位名即「默认」，改写成别的非空串即自定义。 */
        const setWire = (level, text) => {
          const efforts = effortsOf()
          efforts[level] = text
          applyEfforts(efforts)
        }
        const toggleNonReasoning = () => {
          patchDraft({ reasoningEfforts: current.reasoningEfforts === false ? undefined : false })
          setError('')
        }
        /**
         * 写回映射前先自检：只声明 off / 留空的自定义值 = llm-pi-ai 校验必拒。
         * 这里不静默写入非法值，而是就地提示并禁止保存（规格 §3「不写伪值」）。
         */
        const applyEfforts = (efforts) => {
          const nonOff = Object.entries(efforts).some(([level, wire]) => level !== 'off' && typeof wire === 'string' && wire !== '')
          const offOnly = Object.keys(efforts).length > 0 && Object.keys(efforts).every((level) => level === 'off')
          const blankCustom = Object.entries(efforts).some(([level, wire]) => level !== 'off' && typeof wire === 'string' && wire === '')
          setError(offOnly || blankCustom || (Object.keys(efforts).length > 0 && !nonOff) ? translate('models.wb.effort.needLevel') : '')
          patchDraft({ reasoningEfforts: Object.keys(efforts).length === 0 ? undefined : efforts })
        }
        const setCapacity = (field, text) => {
          setCapacityTexts((state) => ({ ...state, [field]: text }))
          const parsed = parseCapacity(text)
          setError(Number.isNaN(parsed) ? translate('models.wb.edit.capacityInvalid') : '')
          if (Number.isNaN(parsed)) return
          patchDraft({ [field]: parsed })
        }
        const settleCapacity = (field) => {
          setCapacityTexts((state) => {
            const next = { ...state }
            delete next[field]
            return next
          })
        }
        const capacityValue = (field) => (Object.prototype.hasOwnProperty.call(capacityTexts, field)
          ? capacityTexts[field]
          : capacityTextOf(field))
        const capacityTextOf = (field) => {
          const value = (draft ?? model)[field]
          return value === undefined || value === null ? '' : capacityText(value)
        }
        const inputModes = () => (Array.isArray(current.input) && current.input.length > 0 ? current.input : ['text'])
        const toggleModality = (modality) => {
          const selected = inputModes()
          const next = ['text', 'image'].filter((value) => (value === modality ? !selected.includes(value) : selected.includes(value)))
          // 空集合非法（schema 要求非空）；恒保留 text，与官方设置页同款。
          patchDraft({ input: next.length === 0 ? ['text'] : next })
        }
        const save = async () => {
          if (draft === null || error !== '') return
          const patch = {}
          for (const field of EDITABLE) {
            if (JSON.stringify(draft[field]) !== JSON.stringify(model[field])) patch[field] = draft[field]
          }
          if (Object.keys(patch).length === 0) { setError(translate('models.wb.edit.noop')); return }
          const ok = await onSave(patch)
          if (ok === true) { setDraft(null); setCapacityTexts({}); onToggle() }
        }
        const fieldBox = (label, children, extra) => el('div', { key: label, style: Object.assign({ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }, extra) }, [
          el('label', { key: 'l', style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, label),
          children,
        ])
        const modes = inputModes()
        // 输出模态读**源行**而不是草稿：草稿快照只含可编辑字段，`output` 不在其中。
        const outputs = outputModalitiesOf(model)
        const fieldset = (legend, children) => el('fieldset', { key: legend, style: { border: 'none', margin: 0, padding: 0, minWidth: 0 } }, [
          el('legend', { key: 'g', style: { padding: 0, marginBottom: '4px', fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, legend),
          children,
        ])
        return el('div', { key: model.id, 'data-testid': 'models-model-card-' + model.id, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '8px 0' } }, [
          el('div', { key: 'head', 'data-testid': 'models-model-' + model.id, style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }, onClick: open }, [
            el('code', { key: 'id', style: { fontSize: '13px', fontWeight: 600 } }, model.id),
            typeof model.name === 'string' && model.name !== '' ? el('span', { key: 'name', style: { fontSize: '12px', color: 'var(--dsh-svc-text-muted)' } }, model.name) : null,
            Array.isArray(model.input) && model.input.includes('image') ? el('span', { key: 'img', style: svcBadgeStyle('info') }, translate('models.wb.seeImage')) : null,
            model.reasoningEfforts !== undefined ? el('span', { key: 'think', style: svcBadgeStyle('neutral') }, translate('models.wb.reasoning')) : null,
            Number.isInteger(model.contextWindow) && model.contextWindow > 0 ? el('span', { key: 'ctx', style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, formatCapacity(model.contextWindow)) : null,
            el('span', { key: 'arrow', style: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' } }, [
              el('button', {
                key: 'remove', type: 'button', 'data-testid': 'models-edit-remove-' + model.id,
                title: translate('models.wb.remove.btn'), 'aria-label': translate('models.wb.remove.btn'),
                disabled: busy,
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', padding: 0, borderRadius: '7px', border: '1px solid transparent', background: 'transparent', color: 'var(--dsh-svc-text-muted)', cursor: 'pointer' },
                onClick: (event) => { event.stopPropagation(); onRemove() },
              }, wbTrashIcon()),
              el('span', { key: 'chev', style: { display: 'inline-flex', color: 'var(--dsh-svc-text-muted)' } }, wbChevron(expanded)),
            ]),
          ]),
          expanded ? el('div', { key: 'panel', 'data-testid': 'models-model-panel-' + model.id, style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' } }, [
            // 身份行：ID 只读（改 id 是增删，不是编辑），显示名可改。
            el('div', { key: 'identity', style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '8px' } }, [
              fieldBox(translate('models.wb.edit.modelId'), el('code', { key: 'id', 'data-testid': 'models-edit-id-' + model.id, style: Object.assign({}, WB_INPUT, { display: 'block', color: 'var(--dsh-svc-text-muted)' }) }, model.id)),
              fieldBox(translate('models.wb.edit.name'), el('input', {
                key: 'i', 'data-testid': 'models-edit-name-' + model.id, style: WB_INPUT,
                value: current.name ?? '', placeholder: translate('models.wb.edit.displayNamePlaceholder'),
                onChange: (event) => patchDraft({ name: event.target.value === '' ? undefined : event.target.value }),
              })),
            ]),
            // 容量：文本 + K/M 后缀（与官方设置页同款），留空 = 继承目录默认值。
            el('div', { key: 'capacity', style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '8px' } }, [
              fieldBox(translate('models.wb.edit.context'), el('input', {
                key: 'i', 'data-testid': 'models-edit-context-' + model.id, style: WB_INPUT,
                value: capacityValue('contextWindow'), placeholder: translate('models.wb.edit.contextPlaceholder'),
                onChange: (event) => setCapacity('contextWindow', event.target.value),
                onBlur: () => settleCapacity('contextWindow'),
              })),
              fieldBox(translate('models.wb.edit.maxTokens'), el('input', {
                key: 'i', 'data-testid': 'models-edit-maxtokens-' + model.id, style: WB_INPUT,
                value: capacityValue('maxTokens'), placeholder: translate('models.wb.edit.maxTokensPlaceholder'),
                onChange: (event) => setCapacity('maxTokens', event.target.value),
                onBlur: () => settleCapacity('maxTokens'),
              })),
            ]),
            // 输入/输出模态：输入可勾（文本恒留至少一项），输出由适配器决定，只读展示。
            el('div', { key: 'modes', style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '8px' } }, [
              fieldset(translate('models.wb.edit.inputModalities'), el('div', { key: 'row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
                wbModalityBox({ testId: 'models-edit-mode-text-' + model.id, checked: modes.includes('text'), disabled: modes.length === 1 && modes.includes('text'), label: translate('models.wb.edit.modalityText'), glyph: 'T', onToggle: () => toggleModality('text') }),
                wbModalityBox({ testId: 'models-edit-mode-image-' + model.id, checked: modes.includes('image'), disabled: false, label: translate('models.wb.edit.modalityImage'), glyph: '▣', onToggle: () => toggleModality('image') }),
              ])),
              fieldset(translate('models.wb.edit.outputModalities'), el('div', { key: 'row', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
                el('div', { key: 'out', 'data-testid': 'models-edit-output-' + model.id, style: { display: 'inline-flex', gap: '6px', flexWrap: 'wrap' } },
                  outputs.map((modality) => el('span', {
                    key: modality, 'data-testid': 'models-edit-output-' + modality + '-' + model.id,
                    style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '38px', height: '34px', padding: '0 8px', borderRadius: '9px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsh-svc-text-muted)', fontSize: '13px', fontWeight: 600 },
                  }, modality === 'image' ? '▣' : 'T'))),
              ])),
            ]),
            // 推理档位：胶囊勾选 + 行内协议值；另设显式「非推理模型」开关。
            el('div', { key: 'efforts', style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, [
              el('label', { key: 'title', style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.edit.reasoningLevels')),
              current.reasoningEfforts === false ? null : el('div', { key: 'chips', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
                LEVELS.filter((level) => level !== 'off').map((level) => {
                  const checked = levelChecked(level)
                  return el('span', { key: level, style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } }, [
                    el('label', {
                      key: 'chip', 'data-testid': 'models-effort-toggle-' + model.id + '-' + level + '-chip', 'data-checked': checked ? 'true' : 'false',
                      style: {
                        position: 'relative',
                        display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                        padding: '3px 10px', borderRadius: '999px', fontSize: '12px',
                        border: checked ? '1px solid var(--dsh-svc-border-strong)' : '1px solid var(--dsw-alias-border-l2)',
                        background: checked ? 'var(--dsw-alias-bg-layer-3)' : 'var(--dsw-alias-bg-layer-2)',
                        color: checked ? 'var(--dsw-alias-label-primary)' : 'var(--dsh-svc-text-muted)',
                      },
                    }, [
                      el('input', {
                        key: 'i', type: 'checkbox', 'data-testid': 'models-effort-toggle-' + model.id + '-' + level, checked,
                        style: { position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer' },
                        onChange: () => toggleLevel(level),
                      }),
                      level,
                    ]),
                    // 勾选后行内展开协议值：默认=同名档位，改写即自定义。
                    checked ? el('input', {
                      key: 'wire', 'data-testid': 'models-effort-wire-' + model.id + '-' + level,
                      'aria-label': translate('models.wb.edit.wireCustom'),
                      style: Object.assign({}, WB_INPUT, { width: '110px', padding: '3px 8px', fontSize: '12px' }),
                      value: typeof wireOf(level) === 'string' ? wireOf(level) : '',
                      placeholder: level,
                      onChange: (event) => setWire(level, event.target.value),
                    }) : null,
                  ])
                })),
              el('label', { key: 'off', style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12px', cursor: 'pointer' } }, [
                el('input', {
                  key: 'i', type: 'checkbox', 'data-testid': 'models-effort-toggle-' + model.id + '-off', checked: levelChecked('off'),
                  disabled: current.reasoningEfforts === false,
                  onChange: () => toggleLevel('off'),
                }),
                translate('models.wb.edit.reasoningOff'),
              ]),
              el('label', { key: 'false', style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12px', cursor: 'pointer' } }, [
                el('input', { key: 'i', type: 'checkbox', 'data-testid': 'models-effort-false-' + model.id, checked: current.reasoningEfforts === false, onChange: toggleNonReasoning }),
                translate('models.wb.edit.reasoningFalse'),
              ]),
              el('p', { key: 'hint', style: Object.assign({}, WB_MUTED) }, translate('models.wb.edit.reasoningNoneHint')),
              el('p', { key: 'wirehint', style: WB_MUTED }, translate('models.wb.edit.wireHint')),
            ]),
            error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'models-edit-error-' + model.id, style: WB_ERROR }, error) : null,
            el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '2px', flexWrap: 'wrap', alignItems: 'center' } }, [
              el('button', { key: 'save', type: 'button', 'data-testid': 'models-edit-save-' + model.id, style: svcButtonStyle('primary'), disabled: busy || error !== '', onClick: () => void save() }, translate('models.wb.edit.save')),
              el('button', { key: 'cancel', type: 'button', 'data-testid': 'models-edit-cancel-' + model.id, style: svcButtonStyle('ghost'), disabled: busy, onClick: () => { setDraft(null); setCapacityTexts({}); setError(''); onToggle() } }, translate('models.wb.create.cancel')),
              dirty ? el('span', { key: 'dirty', style: Object.assign({}, WB_MUTED, { alignSelf: 'center' }) }, translate('models.wb.edit.unsaved')) : null,
            ]),
          ]) : null,
        ])
      }

      /**
       * 添加入口：两条路都常开——在线发现（勾选批量添加，可搜索）与手动输入 ID。
       * 发现失败/协议不支持/安全策略拒绝都只提示，手动路径照常可用；发现结果区分已添加与可添加。
       */
      function AddModelsPanel({ row, detail, existingIds, onDone, onCancel }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useEffect } = React
        const [source, setSource] = useState('online')
        const [candidates, setCandidates] = useState(null)
        const [busy, setBusy] = useState(false)
        const [error, setError] = useState('')
        const [search, setSearch] = useState('')
        const [picked, setPicked] = useState(new Set())
        const [manualIds, setManualIds] = useState('')
        const [plan, setPlan] = useState(null)
        const builtin = row.source === 'builtin'
        const load = async (which) => {
          // 换发现来源只重置发现结果；手动 ID 与已勾选项不受影响（两条路径同时可用）。
          setSource(which); setBusy(true); setError(''); setCandidates(null); setPlan(null)
          const res = await rpcCall('models2-model-options', { route: row.route, source: which })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setCandidates(res.value.candidates ?? [])
        }
        useEffect(() => { if (builtin) void load('builtin') }, [])
        const submit = async () => {
          setBusy(true); setError(''); setPlan(null)
          const items = []
          for (const candidate of candidates ?? []) {
            if (!picked.has(candidate.optionHandle)) continue
            items.push({ optionHandle: candidate.optionHandle, abilities: { image: 'observed', reasoning: 'observed' } })
          }
          // 手填：只接受 ID 文本，交给宿主做 wire-id 校验（客户端不自造字段值）。
          const manual = manualIds.split(/[\s,]+/).map((id) => id.trim()).filter((id) => id !== '')
          const res = await rpcCall('models2-model-prepare', { route: row.route, additions: items, ...(manual.length > 0 ? { manualIds: manual } : {}) })
          void manual
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setPlan(res.value)
        }
        const commit = async () => {
          if (plan === null) return
          setBusy(true); setError('')
          const res = await rpcCall('models2-model-commit', { planId: plan.planId })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); setPlan(null); return }
          if (onDone !== undefined) onDone()
        }
        const filtered = (candidates ?? []).filter((candidate) => {
          const q = search.trim().toLowerCase()
          if (q === '') return true
          return String(candidate.id ?? '').toLowerCase().includes(q) || String(candidate.name ?? '').toLowerCase().includes(q)
        })
        return el('div', { key: 'add', 'data-testid': 'models-add-panel', style: Object.assign({}, WB_CARD, { marginTop: '8px' }) }, [
          el('div', { key: 'sources', style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, [
            builtin ? el('button', { key: 'builtin', type: 'button', 'data-testid': 'models-add-source-builtin', style: svcButtonStyle(source === 'builtin' ? 'primary' : 'neutral'), disabled: busy, onClick: () => void load('builtin') }, translate('models.wb.builtin')) : null,
            !builtin ? el('button', { key: 'online', type: 'button', 'data-testid': 'models-add-source-online', style: svcButtonStyle(source === 'online' ? 'primary' : 'neutral'), disabled: busy, onClick: () => void load('online') }, translate('models.wb.add.online')) : null,
            el('button', { key: 'manual', type: 'button', 'data-testid': 'models-add-source-manual', style: svcButtonStyle(source === 'manual' ? 'primary' : 'neutral'), disabled: busy, onClick: () => { setSource('manual'); setError(''); setPlan(null) } }, translate('models.wb.add.manual')),
          ]),
          // 手动 ID 路径**始终可用**（发现失败、协议不支持、安全策略拒绝探测都不阻断它）。
          el('div', { key: 'manual', style: { marginTop: '8px', display: source === 'manual' ? 'block' : 'none' } }, [
            el('label', { key: 'l', style: { display: 'block', fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.add.manualIds')),
            el('textarea', { key: 'i', 'data-testid': 'models-add-manual-ids', style: Object.assign({}, WB_INPUT, { minHeight: '60px' }), value: manualIds, placeholder: 'model-id-one\nmodel-id-two', onChange: (event) => { setManualIds(event.target.value); setPlan(null) } }),
            el('p', { key: 'hint', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.add.manualHint')),
          ]),
          el('div', { key: 'discovery', style: { marginTop: '8px', display: source === 'manual' && candidates === null ? 'none' : 'block' } }, [
            busy && candidates === null ? el('p', { key: 'loading', style: WB_MUTED }, translate('models.wb.add.fetching')) : null,
            candidates !== null ? el('div', { key: 'list' }, [
              el('input', { key: 'search', 'data-testid': 'models-add-search', style: WB_INPUT, value: search, placeholder: translate('models.wb.search.placeholder'), onChange: (event) => setSearch(event.target.value) }),
              el('p', { key: 'count', 'data-testid': 'models-add-count', style: Object.assign({}, WB_MUTED, { margin: '6px 0' }) }, translate('models.wb.add.count').replace('{n}', String(candidates.length)).replace('{added}', String(candidates.filter((c) => existingIds.has(c.id)).length))),
              el('div', { key: 'rows', style: { maxHeight: '240px', overflow: 'auto' } }, filtered.map((candidate) => {
                const added = existingIds.has(candidate.id)
                const checked = picked.has(candidate.optionHandle)
                return el('label', { key: candidate.id, 'data-testid': 'models-add-candidate-' + candidate.id, style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', padding: '2px 0', cursor: added ? 'default' : 'pointer', opacity: added ? 0.6 : 1 } }, [
                  el('input', {
                    key: 'i', type: 'checkbox', 'data-testid': 'models-add-pick-' + candidate.id, checked, disabled: added,
                    onChange: () => setPicked((current) => { const next = new Set(current); if (next.has(candidate.optionHandle)) next.delete(candidate.optionHandle); else next.add(candidate.optionHandle); return next }),
                  }),
                  el('code', { key: 'id' }, candidate.id),
                  candidate.name !== undefined && candidate.name !== candidate.id ? el('span', { key: 'name', style: { color: 'var(--dsh-svc-text-muted)' } }, candidate.name) : null,
                  added ? el('span', { key: 'added', style: svcBadgeStyle('neutral') }, translate('models.wb.add.already')) : null,
                ])
              })),
            ]) : null,
            // 发现失败不阻断：明确说明原因，并把手动 ID 路径摆在旁边。
            error !== '' ? el('p', { key: 'error', role: 'alert', 'data-testid': 'models-add-error', style: WB_ERROR }, error) : null,
            error !== '' ? el('p', { key: 'fallback', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.add.fallback')) : null,
          ]),
          plan !== null ? el('div', { key: 'plan', 'data-testid': 'models-add-plan', style: { marginTop: '8px', fontSize: '12px' } }, [
            el('p', { key: 'summary', style: { margin: 0 } }, translate('models.wb.detail.changeSummary').replace('{changes}', String(plan.diff.changes.length)).replace('{added}', String(plan.diff.added.length)).replace('{removed}', String(plan.diff.removed.length))),
            (plan.warnings ?? []).includes('unverified-model') ? el('p', { key: 'w', style: { margin: '4px 0 0', color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.add.unverified')) : null,
            el('button', { key: 'go', type: 'button', 'data-testid': 'models-add-commit', style: Object.assign({}, svcButtonStyle('primary'), { marginTop: '6px' }), disabled: busy, onClick: () => void commit() }, translate('models.wb.add.commit')),
          ]) : null,
          plan === null && candidates !== null ? el('p', { key: 'note', style: Object.assign({}, WB_MUTED, { marginTop: '6px' }) }, translate('models.wb.add.note')) : null,
          el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } }, [
            plan === null ? el('button', { key: 'prepare', type: 'button', 'data-testid': 'models-add-prepare', style: svcButtonStyle('primary'), disabled: busy || (picked.size === 0 && manualIds.trim() === ''), onClick: () => void submit() }, translate('models.wb.add.prepare')) : null,
            el('button', { key: 'cancel', type: 'button', 'data-testid': 'models-add-cancel', style: svcButtonStyle('ghost'), disabled: busy, onClick: onCancel }, translate('models.wb.create.cancel')),
          ]),
        ])
      }

      /** 兼容壳：v1.11 起只有一套界面（旧的 localStorage Simple/Legacy 分流已退役）。 */
      function ProvidersWorkbench({ snapshot, reload }) {
        return React.createElement(UnifiedProvidersWorkbench, { snapshot, reload })
      }
  /** 模型配置页：子标签「供应商与模型」（左，默认）+「子代理路由」（右）。
   * 只剩一个可用子页时整条子标签栏隐藏、直接渲染内容；两者全关时本页不可达（顶层标签已隐藏）。
   * 首页状态来自 models2-snapshot（零网络：本地 settings + 目录 + 侧车），提升到本组件持有，
   * 顶层标签 ⚠ 直接消费同一份状态。 */
  function ModelsSection({ SubagentSection }) {
    const tr = useTranslation()
    const { useState, useEffect } = React
    const [modelsTab, setModelsTab] = useState('providers')
    useEffect(() => {
      let stored = null
      try { stored = localStorage.getItem('dsh-service-models-tab') } catch (_) {}
      setModelsTab(stored === null ? 'providers' : (stored === 'subagent' ? 'subagent' : 'providers'))
    }, [])
    const selectModelsTab = (id) => {
      setModelsTab(id)
      try { localStorage.setItem('dsh-service-models-tab', id) } catch (_) {}
    }
    const [modelsSnapshot, setModelsSnapshot] = useState(null)
    const reloadModelsSnapshot = () => {
      rpcCall('models2-snapshot', {}).then((res) => {
        if (res.ok === true) setModelsSnapshot(res.value)
      }).catch(() => {})
    }
    useEffect(() => { reloadModelsSnapshot() }, [])
    // 子代理子标签只在 subagentRoute 打开时可见（供应商页始终可用——本页的存在本身由
    // 顶层 modelCatalog 门控决定）。
    const { value: featuresNow } = useFeatures()
    const subagentVisible = featuresNow.subagentRoute !== false
    const items = [
      { id: 'providers', label: tr('tabs.providers') },
      ...(subagentVisible ? [{ id: 'subagent', label: tr('tabs.subagentRoute') }] : []),
    ]
    const active = items.some((item) => item.id === modelsTab) ? modelsTab : 'providers'
    return React.createElement('div', { key: 'models-page', 'data-testid': 'models-page' },
      items.length > 1
        ? React.createElement(SvcTabs, {
            items,
            activeId: active,
            onChange: selectModelsTab,
            testIdPrefix: 'models-tab',
            variant: 'sub',
            ariaLabel: tr('tabs.models'),
          })
        : null,
      active === 'providers'
        ? React.createElement(ProvidersWorkbench, { snapshot: modelsSnapshot, reload: reloadModelsSnapshot })
        : React.createElement(SubagentSection, null))
  }

  return {
    ModelsSection,
    ProvidersWorkbench,
    UndoPanel,
    WorkbenchTaskPage,
    CreateProviderCard,
    ManualEditor,
    RemovePanel,
    mapModelsError,
    formatCapacity,
    formatRelativeTime,
    wbProbeErrorText,
    WB_FIELD_TEXT,
    MODEL_FIELDS,
    WB_KIND_ORDER,
  }
}
