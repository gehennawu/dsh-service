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
      function formatCapacity(value) {
        const number = Number(value)
        if (!Number.isFinite(number)) return ''
        if (number >= 1e6) return `${Math.round(number / 1e5) / 10}M`
        if (number >= 1e3) return `${Math.round(number / 1e2) / 10}K`
        return String(number)
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
      function ProvidersWorkbench({ snapshot, reload }) {
        let legacy = false
        try { legacy = localStorage.getItem('dsh-service-models-workbench') === 'legacy' } catch (_) {}
        return React.createElement(legacy ? LegacyProvidersWorkbench : SimpleProvidersWorkbench, { snapshot, reload })
      }

function SimpleProvidersWorkbench({ snapshot, reload }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState } = React
        const [detailRoute, setDetailRoute] = useState(null)
        const [detail, setDetail] = useState(null)
        const [editModels, setEditModels] = useState(null)
        const [suggestions, setSuggestions] = useState({})
        const [expanded, setExpanded] = useState(new Set())
        const [source, setSource] = useState(null)
        const [candidates, setCandidates] = useState([])
        const [selected, setSelected] = useState(null)
        const [detection, setDetection] = useState(null)
        const [plan, setPlan] = useState(null)
        const [editPlan, setEditPlan] = useState(null)
        const [busy, setBusy] = useState(false)
        const [armed, setArmed] = useState(false)
        const [editArmed, setEditArmed] = useState(false)
        const [error, setError] = useState('')
        const [image, setImage] = useState('observed')
        const [reasoning, setReasoning] = useState('observed')
        const [manualContext, setManualContext] = useState('')
        const [manualMaxTokens, setManualMaxTokens] = useState('')
        const [manualName, setManualName] = useState('')
        const [allowUnverified, setAllowUnverified] = useState(false)
        const [savedNotice, setSavedNotice] = useState(false)
        // 联网查证（v0.43）：{ modelId → {busy, sources} }；结果仅参考展示，不自动写入。
        const [verify, setVerify] = useState({})
        const runVerifyOnline = (modelId) => {
          if (detailRoute === null || typeof modelId !== 'string' || modelId === '') return
          setVerify((current) => ({ ...current, [modelId]: { busy: true, sources: [] } }))
          rpcCall('models2-model-verify-online', { route: detailRoute, modelId }).then((res) => {
            setVerify((current) => ({ ...current, [modelId]: {
              busy: false,
              ...(res.ok === true ? { sources: res.value.sources ?? [] } : { error: mapModelsError(translate, res.error) }),
            } }))
          }).catch(() => setVerify((current) => ({ ...current, [modelId]: { busy: false, error: translate('models.wb.verifyOnline.error').replace('{error}', 'network') } })))
        }
        const routes = snapshot?.routes ?? []
        const active = routes.find((row) => row.route === detailRoute)
        const fmtChangeValue = (value) => (typeof value === 'object' && value !== null ? Object.keys(value).join('+') : String(value))
        const resetFlow = (nextSource = null) => {
          setSource(nextSource); setCandidates([]); setSelected(null); setDetection(null); setPlan(null); setArmed(false); setError('')
          setManualContext(''); setManualMaxTokens(''); setManualName(''); setAllowUnverified(false); setVerify({})
        }
        const openDetail = (row) => {
          setDetailRoute(row.route); resetFlow()
          setDetail(null); setEditModels(null); setSuggestions({}); setExpanded(new Set()); setEditPlan(null); setEditArmed(false); setSavedNotice(false)
          rpcCall('models2-route', { route: row.route }).then((res) => {
            if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
            setDetail(res.value)
            const models = (res.value.models ?? []).map((model) => (model !== null && typeof model === 'object' ? { ...model } : model))
            setEditModels(models)
            const ids = models.map((model) => model.id).filter((id) => typeof id === 'string' && id !== '')
            if (ids.length === 0) return
            rpcCall('models2-model-suggestions', { route: row.route, modelIds: ids }).then((sres) => {
              if (sres.ok === true) setSuggestions(sres.value.suggestions ?? {})
            }).catch(() => {})
          }).catch(() => { setError(mapModelsError(translate, 'internal')) })
        }
        const closeDetail = () => { setDetailRoute(null); setDetail(null); setEditModels(null); resetFlow(); setSavedNotice(false) }
        const toggleModel = (index) => setExpanded((current) => {
          const next = new Set(current)
          if (next.has(index)) next.delete(index); else next.add(index)
          return next
        })
        const patchModel = (index, patch) => {
          setEditModels((current) => (current === null ? current : current.map((model, i) => (i === index ? { ...model, ...patch } : model))))
          setEditPlan(null); setEditArmed(false)
        }
        const applySuggestion = (index, field, value) => {
          if (value === undefined || value === null) return
          patchModel(index, { [field]: value })
        }
        const applyEdits = async () => {
          if (editModels === null) return
          setBusy(true); setError(''); setEditPlan(null); setEditArmed(false)
          const res = await rpcCall('models2-edit-prepare', { route: detailRoute, models: editModels })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          if (res.value.noop === true) { setSavedNotice(true); return }
          setEditPlan(res.value)
        }
        const finalCommit = async () => {
          if (editPlan === null) return
          if (!editArmed) { setEditArmed(true); return }
          setBusy(true); setError('')
          const res = await rpcCall('models2-commit', { planId: editPlan.planId })
          setBusy(false)
          if (res.ok !== true) { if (res.error === 'conflict') setEditPlan(null); if (res.error === 'schema-invalid' || String(res.error).startsWith('schema-invalid')) setEditPlan(null); setError(mapModelsError(translate, res.error)); return }
          setSavedNotice(true); setEditPlan(null); setEditArmed(false)
          if (reload !== undefined) reload()
        }
        const loadSource = async (nextSource) => {
          resetFlow(nextSource); setBusy(true)
          const res = await rpcCall('models2-model-options', { route: detailRoute, source: nextSource })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setCandidates(res.value.candidates ?? [])
        }
        const detect = async () => {
          if (selected?.id === undefined || selected.id === '') return
          setBusy(true); setError(''); setDetection(null); setPlan(null); setArmed(false); setAllowUnverified(false)
          const res = await rpcCall('models2-model-detect', { route: detailRoute, modelId: selected.id })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          // 检测成功：一致（agreed）的字段自动预填表单；分叉（split）留给用户逐源选择。
          const fields = res.value?.fields ?? {}
          if (fields.name?.status === 'agreed') setManualName(fields.name.value)
          if (fields.contextWindow?.status === 'agreed') setManualContext(fields.contextWindow.value)
          if (fields.maxTokens?.status === 'agreed') setManualMaxTokens(fields.maxTokens.value)
          setDetection(res.value)
        }
        const prepare = async () => {
          if (selected === null) return
          const abilities = { image, reasoning }
          if (Number.isInteger(manualContext) && manualContext > 0) abilities.contextWindow = manualContext
          if (Number.isInteger(manualMaxTokens) && manualMaxTokens > 0) abilities.maxTokens = manualMaxTokens
          if (typeof manualName === 'string' && manualName.trim() !== '') abilities.name = manualName.trim()
          const item = source === 'builtin' ? { optionHandle: selected.optionHandle, abilities } : { detectionId: detection?.detectionId, abilities, ...(allowUnverified ? { allowUnverified: true } : {}) }
          setBusy(true); setError(''); setPlan(null); setArmed(false)
          const res = await rpcCall('models2-model-prepare', { route: detailRoute, additions: [item] })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); return }
          setPlan(res.value)
        }
        const commit = async () => {
          if (plan === null) return
          if (!armed) { setArmed(true); return }
          setBusy(true)
          const res = await rpcCall('models2-model-commit', { planId: plan.planId })
          setBusy(false)
          if (res.ok !== true) { setError(mapModelsError(translate, res.error)); setPlan(null); setArmed(false); return }
          closeDetail(); if (reload !== undefined) reload()
        }
        if (detailRoute !== null && active !== undefined) {
          const detailTitle = detail?.displayName ?? active.displayName
          const detailBase = detail?.baseURL ?? active.baseURL ?? ''
          const detailApi = detail?.api ?? active.api ?? ''
          const modelList = editModels ?? []
          const suggestionFor = (model) => suggestions[model?.id]?.fields ?? undefined
          const sourceName = (entry) => (entry.source === 'pi-ai' ? 'pi-ai' : entry.source === 'modelparams' ? 'modelparams' : entry.source === 'runtime' ? translate('models.wb.detail.runtime') : entry.source ?? '')
          const adviceButton = (model, field, label, display) => {
            const advice = suggestionFor(model)?.[field]
            if (advice === undefined) return null
            // 协商（agreed）：单按钮，标注来源数量；分叉（split）：展开各来源按钮，不武断给单一值。
            if (advice.status === 'agreed') {
              const value = advice.value
              const applied = (model?.[field] !== undefined && JSON.stringify(model[field]) === JSON.stringify(value))
              return el('button', {
                key: 'advice-' + field, type: 'button', 'data-testid': 'models-advice-' + field + '-' + model.id,
                style: Object.assign({}, svcButtonStyle(applied ? 'primary' : 'neutral'), { padding: '3px 8px', fontSize: '12px' }),
                title: translate('models.wb.detail.adviceSource').replace('{source}', advice.sources.map(sourceName).join(' + ')),
                onClick: () => applySuggestion(modelList.indexOf(model), field, value),
              }, `${translate('models.wb.detail.advice')} ${display(value)}`)
            }
            // split：来源取值不同 — 按取值分组聚合。众数主按钮（点击填入），
            // 其余值折叠展示（≤2 个次要按钮），不再逐源平铺几十个按钮。
            const groups = []
            for (const entry of advice.sources) {
              const key = JSON.stringify(entry.value)
              let group = groups.find((g) => g.key === key)
              if (group === undefined) {
                group = { key, value: entry.value, count: 0, entries: [] }
                groups.push(group)
              }
              group.count += 1
              group.entries.push(entry)
            }
            groups.sort((a, b) => b.count - a.count || groups.indexOf(a) - groups.indexOf(b))
            const total = advice.sources.length
            const lead = groups[0]
            // split：来源取值不同 — 傻瓜式取众数（最多来源同意的值）做主建议，不显示命中数字。
            // 分歧详情收进 title 悬浮提示；不再平铺其他值按钮。
            const differentDists = groups.length - 1
            return el('span', { key: 'advice-' + field, 'data-testid': 'models-advice-split-' + field + '-' + model.id, style: { display: 'inline-flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' } }, [
              el('button', {
                key: 'lead', type: 'button', 'data-testid': 'models-advice-' + field + '-lead-' + model.id,
                style: Object.assign({}, svcButtonStyle('primary'), { padding: '3px 8px', fontSize: '12px' }),
                title: translate('models.wb.detail.hitCount').replace('{count}', String(lead.count)).replace('{total}', String(total)) + (differentDists > 0 ? '\n' + translate('models.wb.detail.othersCount').replace('{n}', String(differentDists)) : ''),
                onClick: () => applySuggestion(modelList.indexOf(model), field, lead.value),
              }, `${translate('models.wb.detail.advice')} ${display(lead.value)}`),
            ])
          }
          const imageSelectValue = (model) => (Array.isArray(model?.input) ? (model.input.includes('image') ? 'yes' : 'no') : 'detected')
          const reasoningSelectValue = (model) => (model?.reasoningEfforts === false ? 'unsupported' : model?.reasoningEfforts !== undefined ? 'yes' : 'detected')
          // 联网查证结果块：厂商文档来源列表（固定名单，仅参考展示）。
          const verifyBlock = (modelId) => {
            const state = verify[modelId] ?? null
            const busy = state?.busy === true
            return el('div', { key: 'verify-' + modelId, 'data-testid': 'models-verify-' + modelId, style: { marginTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: '6px' } }, [
              el('div', { key: 'row', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, [
                el('button', { key: 'btn', type: 'button', 'data-testid': 'models-verify-btn-' + modelId, style: svcButtonStyle('ghost'), disabled: busy, onClick: () => runVerifyOnline(modelId) }, busy ? translate('models.wb.verifyOnline.busy') : translate('models.wb.verifyOnline')),
              ]),
              state?.error !== undefined ? el('p', { key: 'err', 'data-testid': 'models-verify-error-' + modelId, style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, state.error) : null,
              (state?.sources ?? []).length > 0 ? el('div', { key: 'results', 'data-testid': 'models-verify-results-' + modelId, style: { marginTop: '6px' } }, [
                el('p', { key: 'title', style: { margin: '0 0 4px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.verifyOnline.title').replace('{model}', modelId)),
                ...state.sources.map((source, i) => el('div', { key: 'src-' + i, 'data-testid': 'models-verify-src-' + i + '-' + modelId, style: { fontSize: '12px', margin: '4px 0', padding: '6px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)' } }, [
                  el('div', { key: 'head', style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' } }, [
                    el('b', { key: 'name', style: { fontSize: '12px' } }, translate('models.wb.verifyOnline.source').replace('{name}', source.name ?? '')),
                    el('a', { key: 'href', href: source.href ?? source.url, target: '_blank', rel: 'noreferrer', 'data-testid': 'models-verify-open-' + i + '-' + modelId, style: { fontSize: '12px', color: 'var(--dsw-alias-link-primary, var(--dsw-alias-brand-primary))' } }, translate('models.wb.verifyOnline.open')),
                  ]),
                  source.status === 'ok'
                    ? (source.snippets ?? []).map((snippet, j) => el('p', { key: 's-' + j, 'data-testid': 'models-verify-snippet-' + i + '-' + j + '-' + modelId, style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, snippet))
                    : source.status === 'no-match'
                      ? el('p', { key: 'nm', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.verifyOnline.noMatch'))
                      : source.status === 'not-found'
                        ? el('p', { key: 'nf', 'data-testid': 'models-verify-nf-' + modelId, style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.verifyOnline.notFound'))
                        : el('p', { key: 'er', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.verifyOnline.error').replace('{error}', source.error ?? source.status)),
                ])),
                el('p', { key: 'note', style: Object.assign({}, WB_MUTED, { marginTop: '6px' }) }, translate('models.wb.verifyOnline.note')),
              ]) : null,
            ])
          }

          const modelCards = modelList.map((model, index) => {
            const isOpen = expanded.has(index)
            const sug = suggestionFor(model)
            const fieldRow = (children) => el('div', { key: 'row-' + index, style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '3px 0' } }, children)
            const numberInput = (field, testId) => el('input', { key: field, 'data-testid': testId, style: Object.assign({}, WB_INPUT, { width: '110px', padding: '4px 8px', fontSize: '12px' }), type: 'number', min: '1', value: model[field] ?? '', onChange: (event) => patchModel(index, { [field]: event.target.value === '' ? undefined : Number(event.target.value) }) })
            const fmt = (value) => (typeof value === 'object' && value !== null ? Object.keys(value).join('+') : String(value))
            return el('div', { key: model.id ?? 'model-' + index, 'data-testid': 'models-model-card-' + (model.id ?? index), style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', padding: '8px 12px', marginTop: '8px', background: 'var(--dsw-alias-bg-layer-2)' } }, [
              el('div', { key: 'head', 'data-testid': 'models-model-' + (model.id ?? index), style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', cursor: 'pointer' }, onClick: () => toggleModel(index) }, [
                el('code', { key: 'id', style: { fontSize: '13px', fontWeight: 600 } }, model.id ?? ''),
                typeof model?.name === 'string' && model.name !== '' ? el('span', { key: 'name', style: { fontSize: '12px', color: 'var(--dsh-svc-text-muted)' } }, model.name) : null,
                Array.isArray(model?.input) && model.input.includes('image') ? el('span', { key: 'image', style: svcBadgeStyle('info') }, 'Image') : null,
                model?.reasoningEfforts !== undefined ? el('span', { key: 'thinking', style: svcBadgeStyle('neutral') }, translate('models.wb.reasoning')) : null,
                Number.isInteger(model?.contextWindow) && model.contextWindow > 0 ? el('span', { key: 'ctx', style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, `${model.contextWindow}`) : null,
                isOpen ? el('span', { key: 'arrow', style: { marginLeft: 'auto', fontSize: '12px' } }, '▴') : el('span', { key: 'arrow', style: { marginLeft: 'auto', fontSize: '12px' } }, '▾'),
              ]),
              isOpen ? el('div', { key: 'params', 'data-testid': 'models-model-params-' + (model.id ?? index), style: { marginTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: '6px' } }, [
                fieldRow([
                  el('label', { key: 'l', style: { fontSize: '12px', width: '80px' } }, translate('models.wb.detail.context')),
                  numberInput('contextWindow', 'models-edit-context-' + (model.id ?? index)),
                  adviceButton(model, 'contextWindow', 'context', fmt),
                ]),
                fieldRow([
                  el('label', { key: 'l', style: { fontSize: '12px', width: '80px' } }, translate('models.wb.detail.maxTokens')),
                  numberInput('maxTokens', 'models-edit-maxtokens-' + (model.id ?? index)),
                  adviceButton(model, 'maxTokens', 'maxTokens', fmt),
                ]),
                fieldRow([
                  el('label', { key: 'l', style: { fontSize: '12px', width: '80px' } }, translate('models.wb.detail.image')),
                  el('select', { key: 's', 'data-testid': 'models-edit-image-' + (model.id ?? index), style: Object.assign({}, WB_INPUT, { width: 'auto', padding: '4px 8px', fontSize: '12px' }), value: imageSelectValue(model), onChange: (event) => { const v = event.target.value; patchModel(index, { input: v === 'yes' ? ['text', 'image'] : v === 'no' ? ['text'] : undefined }) } }, [
                    el('option', { key: 'detected', value: 'detected' }, translate('models.wb.detail.imageState.detected')),
                    el('option', { key: 'yes', value: 'yes' }, translate('models.wb.detail.imageState.yes')),
                    el('option', { key: 'no', value: 'no' }, translate('models.wb.detail.imageState.no')),
                  ]),
                  adviceButton(model, 'input', 'input', (v) => (Array.isArray(v) && v.includes('image') ? translate('models.wb.detail.imageState.yes') : translate('models.wb.detail.imageState.no'))),
                ]),
                fieldRow([
                  el('label', { key: 'l', style: { fontSize: '12px', width: '80px' } }, translate('models.wb.detail.thinking')),
                  el('select', { key: 's', 'data-testid': 'models-edit-reasoning-' + (model.id ?? index), style: Object.assign({}, WB_INPUT, { width: 'auto', padding: '4px 8px', fontSize: '12px' }), value: reasoningSelectValue(model), onChange: (event) => { const v = event.target.value; patchModel(index, { reasoningEfforts: v === 'unsupported' ? false : v === 'yes' ? (suggestionFor(model)?.reasoningEfforts?.value ?? model.reasoningEfforts) : undefined }) } }, [
                    el('option', { key: 'detected', value: 'detected' }, translate('models.wb.detail.thinkingState.detected')),
                    el('option', { key: 'yes', value: 'yes' }, translate('models.wb.detail.thinkingState.yes')),
                    el('option', { key: 'unsupported', value: 'unsupported' }, translate('models.wb.detail.thinkingState.no')),
                  ]),
                  adviceButton(model, 'reasoningEfforts', 'reasoningEfforts', fmt),
                ]),
                sug !== undefined ? el('div', { key: 'advice-from', style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)', marginTop: '4px' } }, translate('models.wb.detail.adviceSource').replace('{source}', 'pi-ai / modelparams')) : null,
                typeof model?.id === 'string' && model.id !== '' ? verifyBlock(model.id) : null,
              ]) : null,
            ])
          })
          const changedRows = (editPlan?.diff?.changes ?? []).map((change) => el('div', { key: change.modelId + '-' + change.field, 'data-testid': 'models-edit-change-' + change.field + '-' + change.modelId, style: { fontSize: '12px', margin: '2px 0' } }, `${change.modelId} · ${change.field}${change.from !== undefined ? '：' + fmtChangeValue(change.from) : ''} → ${fmtChangeValue(change.to)}`))
          const diffBlock = editPlan !== null ? el('div', { key: 'diff', 'data-testid': 'models-edit-diff', style: WB_CARD }, [
            el('p', { key: 'summary', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.detail.changeSummary').replace('{changes}', String(editPlan.diff.changes.length)).replace('{added}', String(editPlan.diff.added.length)).replace('{removed}', String(editPlan.diff.removed.length))),
            ...changedRows,
            (editPlan.diff.added ?? []).map((id) => el('div', { key: 'added-' + id, 'data-testid': 'models-edit-added-' + id, style: { fontSize: '12px', margin: '2px 0', color: 'var(--dsw-alias-state-success-primary)' } }, `+ ${id}`)),
            (editPlan.diff.removed ?? []).map((id) => el('div', { key: 'removed-' + id, 'data-testid': 'models-edit-removed-' + id, style: { fontSize: '12px', margin: '2px 0', color: 'var(--dsw-alias-state-error-primary)' } }, `- ${id}`)),
            el('p', { key: 'recheck', style: Object.assign({}, WB_MUTED, { marginTop: '6px' }) }, translate('models.wb.detail.recheck')),
            el('div', { key: 'actions', style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [
              el('button', { key: 'back', type: 'button', 'data-testid': 'models-edit-plan-back', style: svcButtonStyle('ghost'), disabled: busy, onClick: () => setEditPlan(null) }, translate('models.wb.create.cancel')),
              el('button', { key: 'confirm', type: 'button', 'data-testid': 'models-edit-confirm', style: svcButtonStyle(editArmed ? 'danger' : 'primary'), disabled: busy, onClick: () => void finalCommit() }, editArmed ? translate('models.plan.confirmArmed') : translate('models.wb.detail.finalConfirm')),
            ]),
          ]) : null
          const addAbilities = selected !== null ? el('div', { key: 'abilities', 'data-testid': 'models-add-abilities', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' } }, [
            source === 'manual' ? el('input', { key: 'name', 'data-testid': 'models-add-name', style: Object.assign({}, WB_INPUT, { width: '180px', padding: '4px 8px', fontSize: '12px' }), placeholder: translate('models.wb.add.probeName'), value: manualName, onChange: (event) => { setManualName(event.target.value); setPlan(null); setArmed(false) } }) : null,
            el('input', { key: 'ctx', 'data-testid': 'models-add-context', style: Object.assign({}, WB_INPUT, { width: '130px', padding: '4px 8px', fontSize: '12px' }), type: 'number', min: '1', placeholder: translate('models.wb.detail.context'), value: manualContext, onChange: (event) => { setManualContext(event.target.value === '' ? '' : Number(event.target.value)); setPlan(null); setArmed(false) } }),
            el('input', { key: 'out', 'data-testid': 'models-add-maxtokens', style: Object.assign({}, WB_INPUT, { width: '130px', padding: '4px 8px', fontSize: '12px' }), type: 'number', min: '1', placeholder: translate('models.wb.detail.maxTokens'), value: manualMaxTokens, onChange: (event) => { setManualMaxTokens(event.target.value === '' ? '' : Number(event.target.value)); setPlan(null); setArmed(false) } }),
            el('select', { key: 'image', 'data-testid': 'models-add-image', style: WB_INPUT, value: image, onChange: (event) => { setImage(event.target.value); setPlan(null); setArmed(false) } }, [el('option', { value: 'observed' }, translate('models.wb.detail.imageState.detected')), el('option', { value: 'image' }, translate('models.wb.detail.imageState.yes')), el('option', { value: 'text' }, translate('models.wb.detail.imageState.no'))]),
            el('select', { key: 'reasoning', 'data-testid': 'models-add-reasoning', style: WB_INPUT, value: reasoning, onChange: (event) => { setReasoning(event.target.value); setPlan(null); setArmed(false) } }, [el('option', { value: 'observed' }, translate('models.wb.detail.thinkingState.detected')), el('option', { value: 'unsupported' }, translate('models.wb.detail.thinkingState.no')), el('option', { value: 'follow' }, translate('models.wb.detail.thinkingState.follow'))]),
            el('button', { key: 'prepare', type: 'button', 'data-testid': 'models-add-prepare', style: svcButtonStyle('primary'), disabled: busy || (source !== 'builtin' && detection === null) || (source !== 'builtin' && detection?.verified !== true && !allowUnverified), onClick: () => void prepare() }, translate('models.wb.add.prepare')),
          ]) : null
          // 手动检测详情卡：检测结果、未验证原因、split 来源选择（按取值聚合，众数主按钮）。
          const splitPicks = (field, setter, emptyLabel) => {
            const advice = (detection?.fields ?? {})[field]
            if (advice?.status !== 'split') return null
            const groups = []
            for (const entry of advice.sources) {
              const key = JSON.stringify(entry.value)
              let group = groups.find((g) => g.key === key)
              if (group === undefined) {
                group = { key, value: entry.value, count: 0, entries: [] }
                groups.push(group)
              }
              group.count += 1
              group.entries.push(entry)
            }
            groups.sort((a, b) => b.count - a.count || groups.indexOf(a) - groups.indexOf(b))
            const total = advice.sources.length
            const lead = groups[0]
            const differentDists = groups.length - 1
            return el('div', { key: 'split-' + field, style: { display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginTop: '6px' } }, [
              el('span', { key: 'label', style: { fontSize: '12px' } }, emptyLabel),
              el('button', {
                key: 'lead', type: 'button', 'data-testid': 'models-add-' + field + '-lead',
                style: Object.assign({}, svcButtonStyle('primary'), { padding: '3px 8px', fontSize: '12px' }),
                title: translate('models.wb.detail.hitCount').replace('{count}', String(lead.count)).replace('{total}', String(total)) + (differentDists > 0 ? '\n' + translate('models.wb.detail.othersCount').replace('{n}', String(differentDists)) : ''),
                onClick: () => { setter(lead.value); setPlan(null); setArmed(false) },
              }, `${translate('models.wb.detail.advice')} ${lead.value}`),
            ])
          }
          const probeCard = source === 'manual' && selected !== null && detection !== null ? el('div', { key: 'probe', 'data-testid': 'models-add-probe', style: Object.assign({}, WB_CARD, { marginTop: '8px' }) }, [
            el('p', { key: 'id', 'data-testid': 'models-add-probe-id', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.add.probeModel').replace('{id}', detection.modelId)),
            detection?.verified === true
              ? el('span', { key: 'ok', 'data-testid': 'models-add-probe-verified', style: svcBadgeStyle('info') }, translate('models.wb.add.detected'))
              : el('span', { key: 'fail', 'data-testid': 'models-add-probe-unverified', style: svcBadgeStyle('neutral') }, translate('models.wb.add.unverified').replace('{error}', detection?.error ?? translate('models.error.unknown').replace('{detail}', detection?.error ?? ''))),
            detection?.error !== undefined && detection?.verified !== true ? el('p', { key: 'why', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.add.unverifiedReason').replace('{error}', detection.error)) : null,
            splitPicks('contextWindow', setManualContext, translate('models.wb.detail.context')),
            splitPicks('maxTokens', setManualMaxTokens, translate('models.wb.detail.maxTokens')),
            splitPicks('name', setManualName, translate('models.wb.add.probeName')),
            verifyBlock(detection.modelId),
            detection?.verified !== true ? el('label', { key: 'unverified', style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px', fontSize: '12px', cursor: 'pointer' } }, [
              el('input', { key: 'box', type: 'checkbox', 'data-testid': 'models-add-allow-unverified', checked: allowUnverified, onChange: (event) => { setAllowUnverified(event.target.checked); setPlan(null); setArmed(false) } }),
              translate('models.wb.add.allowUnverified'),
            ]) : null,
          ]) : null
          return el('div', { 'data-testid': 'models-section' }, [
            el('button', { key: 'back', type: 'button', 'data-testid': 'models-detail-back', style: svcButtonStyle('ghost'), onClick: closeDetail }, translate('models.wb.create.cancel')),
            el('h3', { key: 'title', 'data-testid': 'models-provider-detail-title', style: { margin: '12px 0 4px' } }, detailTitle),
            el('p', { key: 'summary', 'data-testid': 'models-provider-detail-summary', style: WB_MUTED }, [detailBase, detailApi !== '' ? ` · ${detailApi}` : '', ` · ${modelList.length}`]),
            (active.attention ?? []).length > 0 ? el('div', { key: 'todos', 'data-testid': 'models-detail-todos', style: Object.assign({}, WB_CARD, { marginTop: '8px' }) }, [
              el('p', { key: 'head', style: { margin: '0 0 6px', fontSize: '12px', fontWeight: 600 } }, translate('models.wb.detail.todos').replace('{n}', String(active.attention.length))),
              ...(active.attention ?? []).map((flag) => {
              const labelKey = flag === 'dangling-credential' ? 'dangling' : flag === 'invalid-profile' ? 'invalid' : flag === 'validation-failed' ? 'validation' : flag === 'recovery-pending' ? 'recovery' : flag
              return el('div', { key: flag, 'data-testid': 'models-detail-todo-' + flag, style: { fontSize: '12px', margin: '2px 0' } }, [
                el('b', { key: 'label', style: { marginRight: '6px' } }, translate('models.wb.attention.' + labelKey)),
                el('span', { key: 'hint', style: { color: 'var(--dsh-svc-text-muted)' } }, translate('models.wb.attention.' + labelKey + 'Hint')),
              ])
            }),
            ]) : null,
            el('div', { key: 'models', 'data-testid': 'models-provider-models' }, modelList.length === 0 && detail === null ? el('p', { key: 'loading', style: WB_MUTED }, '…') : modelList.length === 0 ? el('p', { key: 'empty', 'data-testid': 'models-provider-models-empty', style: WB_MUTED }, translate('models.wb.detail.empty')) : [el('p', { key: 'hint', style: Object.assign({}, WB_MUTED, { margin: '8px 0 4px' }) }, translate('models.wb.detail.models')), ...modelCards]),
            diffBlock,
            savedNotice === true ? el('div', { key: 'saved', 'data-testid': 'models-edit-saved', style: WB_CARD }, translate('models.wb.detail.saved')) : null,
            error !== '' ? el('p', { key: 'error', 'data-testid': 'models-detail-error', role: 'alert', style: WB_ERROR }, error) : null,
            editPlan === null ? el('div', { key: 'apply-row', style: { display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' } }, [
              el('button', { key: 'apply', type: 'button', 'data-testid': 'models-edit-apply', style: svcButtonStyle('primary'), disabled: busy || editModels === null, onClick: () => void applyEdits() }, translate('models.wb.detail.apply')),
            ]) : null,
            el('div', { key: 'sources', 'data-testid': 'models-add-source', style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' } }, [
              active.source === 'builtin' ? el('button', { key: 'builtin', type: 'button', 'data-testid': 'models-add-source-builtin', style: svcButtonStyle(source === 'builtin' ? 'primary' : 'neutral'), disabled: busy, onClick: () => void loadSource('builtin') }, translate('models.wb.builtin')) : null,
              active.source !== 'builtin' ? el('button', { key: 'online', type: 'button', 'data-testid': 'models-add-source-online', style: svcButtonStyle(source === 'online' ? 'primary' : 'neutral'), disabled: busy, onClick: () => void loadSource('online') }, translate('models.wb.add.online')) : null,
              el('button', { key: 'manual', type: 'button', 'data-testid': 'models-add-source-manual', style: svcButtonStyle(source === 'manual' ? 'primary' : 'neutral'), disabled: busy, onClick: () => resetFlow('manual') }, translate('models.wb.add.manual')),
            ]),
            source !== null ? el('div', { key: 'flow', 'data-testid': 'models-add-flow', style: WB_CARD }, [
              source === 'manual' ? el('div', { key: 'manual-row', style: { display: 'flex', gap: '8px' } }, [
                el('input', { key: 'manual-id', 'data-testid': 'models-add-manual-id', style: WB_INPUT, value: selected?.id ?? '', placeholder: 'model-id', onChange: (event) => { setSelected({ id: event.target.value }); setDetection(null); setPlan(null); setArmed(false); setManualContext(''); setManualMaxTokens(''); setManualName(''); setAllowUnverified(false) }, onKeyDown: (event) => { if (event.key === 'Enter') void detect() } }),
                el('button', { key: 'go', type: 'button', 'data-testid': 'models-add-detect', style: svcButtonStyle('neutral'), disabled: busy || (selected?.id ?? '') === '', onClick: () => void detect() }, translate('models.wb.add.detect')),
              ]) : null,
              source !== 'manual' ? el('select', { key: 'candidate', 'data-testid': 'models-add-candidate', style: WB_INPUT, value: selected?.id ?? '', onChange: (event) => { setSelected(candidates.find((candidate) => candidate.id === event.target.value) ?? null); setPlan(null); setArmed(false); setManualContext(''); setManualMaxTokens(''); setManualName(''); setAllowUnverified(false) } }, [el('option', { key: '', value: '' }, translate('models.wb.add.choose')), ...candidates.map((candidate) => el('option', { key: candidate.id, value: candidate.id }, candidate.name || candidate.id))]) : null,
              source !== 'builtin' && selected !== null ? el('button', { key: 'detect', type: 'button', 'data-testid': 'models-add-detect-alt', style: svcButtonStyle('neutral'), disabled: busy, onClick: () => void detect() }, translate('models.wb.add.detect')) : null,
              detection?.verified === true ? el('span', { key: 'detected', 'data-testid': 'models-add-detected', style: svcBadgeStyle('info') }, translate('models.wb.add.detected')) : null,
              addAbilities,
              probeCard,
              error !== '' ? el('p', { key: 'error', 'data-testid': 'models-add-error', style: WB_ERROR }, error) : null,
              plan !== null ? el('div', { key: 'plan', 'data-testid': 'models-add-plan' }, [
                el('p', { key: 'summary' }, translate('models.wb.add.confirmSummary')),
                ...(plan.warnings?.includes('unverified-model') === true ? [el('p', { key: 'unverified-warn', 'data-testid': 'models-add-plan-unverified', style: Object.assign({}, WB_MUTED, { marginTop: '4px' }) }, translate('models.wb.add.unverified'))] : []),
                el('button', { key: 'commit', type: 'button', 'data-testid': 'models-add-commit', style: svcButtonStyle(armed ? 'danger' : 'primary'), disabled: busy, onClick: () => void commit() }, armed ? translate('models.plan.confirmArmed') : translate('models.wb.add.commit')),
              ]) : null,
            ]) : null,
          ])
        }
        return el('div', { 'data-testid': 'models-section' }, [
          el('div', { key: 'routes', style: WB_CARD }, [
            el('h3', { key: 'title', 'data-testid': 'models-routes-title' }, translate('models.routes.title')),
            el('p', { key: 'legend', 'data-testid': 'models-routes-legend', style: Object.assign({}, WB_MUTED, { margin: '4px 0 0' }) }, translate('models.wb.legend')),
            snapshot === null ? el('p', { key: 'loading', 'data-testid': 'models-routes-loading', style: WB_MUTED }, '…') : routes.length === 0 ? el('p', { key: 'empty', 'data-testid': 'models-routes-empty', style: WB_MUTED }, translate('models.wb.empty')) : routes.map((row) => {
            const badges = []
            if (row.source === 'builtin') badges.push({ key: 'source', label: translate('models.wb.builtinUser') })
            if (row.metaCounts?.inputImage > 0) badges.push({ key: 'image', label: translate('models.wb.seeImage') })
            if (row.metaCounts?.reasoning > 0) badges.push({ key: 'thinking', label: translate('models.wb.canThink') })
            return el('div', { key: row.route, 'data-testid': 'models-route-row-' + row.route, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } }, [
              el('button', { key: 'open', type: 'button', 'data-testid': 'models-route-' + row.route, style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, textAlign: 'left', border: '0', background: 'transparent', color: 'inherit', padding: '0', font: 'inherit', cursor: 'pointer' }, onClick: () => openDetail(row) }, [
                el('b', { key: 'name' }, row.displayName),
                el('span', { key: 'count', style: { marginLeft: '10px', color: 'var(--dsh-svc-text-muted)' } }, String(row.modelCount)),
                ...badges.map((badge) => el('span', { key: badge.key, style: { marginLeft: '8px', color: 'var(--dsh-svc-text-muted)', fontSize: '12px' } }, badge.label)),
              ]),
              (row.attention ?? []).map((flag) => {
            const labelKey = flag === 'dangling-credential' ? 'dangling' : flag === 'invalid-profile' ? 'invalid' : flag === 'validation-failed' ? 'validation' : flag === 'recovery-pending' ? 'recovery' : flag
            return el('span', { key: 'flag-' + flag, 'data-testid': 'models-route-attention-' + flag + '-' + row.route, style: { marginLeft: '8px', color: 'var(--dsh-svc-text-muted)', fontSize: '12px', textDecoration: 'underline dotted' }, title: translate('models.wb.attention.' + labelKey + 'Hint') }, translate('models.wb.attention.' + labelKey))
          }),
            ])
          }),
          ]),
        ])
      }
      function LegacyProvidersWorkbench({ snapshot, reload }) {
        const translate = useTranslation()
        const el = React.createElement
        const { useState, useRef } = React
        const freshKeyRef = useRef('')
        if (freshKeyRef.current === '') freshKeyRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36)
        const [taskRoute, setTaskRoute] = useState(null)
        const [undoRoute, setUndoRoute] = useState(null)
        const [editRoute, setEditRoute] = useState(null)
        const [removeRoute, setRemoveRoute] = useState(null)
        const [securityOpen, setSecurityOpen] = useState(false)
        const [resolveArmedRoute, setResolveArmedRoute] = useState(null)
        const [resolveError, setResolveError] = useState('')
        const routes = snapshot?.routes ?? []
        const activeRow = routes.find((row) => row.route === taskRoute)
        if (taskRoute !== null && activeRow !== undefined) {
          return el('div', { 'data-testid': 'models-section' }, [
            el(WorkbenchTaskPage, { key: taskRoute, row: activeRow, freshKey: freshKeyRef.current, onBack: () => setTaskRoute(null), onChanged: reload }),
          ])
        }
        const routeRow = (row) => {
          const needsResolve = (row.attention ?? []).includes('recovery-pending')
          const resolveFlag = async () => {
            if (resolveArmedRoute !== row.route) { setResolveArmedRoute(row.route); return }
            setResolveArmedRoute(null)
            setResolveError('')
            const res = await rpcCall('models2-recovery-resolve', { route: row.route })
            if (res.ok !== true) { setResolveError(mapModelsError(translate, res.error)); return }
            if (reload !== undefined) reload()
          }
          return el('div', { key: row.route, 'data-testid': 'models-route-' + row.route, style: { borderTop: '1px solid var(--dsw-alias-border-l2)', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '6px' } }, [
          el('div', { key: 'name', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, [
            el('span', { key: 'display', style: { fontWeight: 600, fontSize: '14px' } }, row.displayName),
            row.source === 'builtin' ? el('span', { key: 'src', style: svcBadgeStyle('info') }, translate('models.wb.builtin')) : null,
            el('code', { key: 'url', style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.baseURL || ''),
            el('span', { key: 'api', style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, row.api || ''),
            row.needsAttention === true ? el('span', { key: 'attention', 'data-testid': 'wb-attention-' + row.route, style: svcBadgeStyle('danger') }, translate('models.wb.needsAttention')) : null,
          ]),
          el('div', { key: 'stats', 'data-testid': 'wb-stats-' + row.route, style: { display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--dsh-svc-text-muted)', alignItems: 'center' } }, [
            el('span', { key: 'count' }, translate('models.wb.modelCount').replace('{n}', String(row.modelCount))),
            el('span', { key: 'meta' }, translate('models.wb.meta').replace('{ctx}', String(row.metaCounts?.contextWindow ?? 0)).replace('{vision}', String(row.metaCounts?.inputImage ?? 0)).replace('{reasoning}', String(row.metaCounts?.reasoning ?? 0))),
            row.lastValidation !== undefined && row.lastValidation.ok === false
              ? el('span', { key: 'validation', style: { color: 'var(--dsw-alias-state-warn-label)' } }, translate('models.wb.validationFailed'))
              : row.lastValidation !== undefined
                ? el('span', { key: 'validation' }, translate('models.wb.lastValidated').replace('{time}', formatRelativeTime(translate, row.lastValidation.at)))
                : el('span', { key: 'validation' }, translate('models.wb.neverValidated')),
            row.undoable === true ? el('span', { key: 'undoable', style: svcBadgeStyle('neutral') }, translate('models.wb.undoAvailable')) : null,
          ]),
          row.needsAttention === true ? el('div', { key: 'flags', style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, [
            ...(row.attention ?? []).map((flag) => el('span', { key: flag, 'data-testid': 'wb-flag-' + flag + '-' + row.route, style: svcBadgeStyle('warning') }, translate('models.wb.attention.' + flag))),
            needsResolve ? el('button', { key: 'resolve', type: 'button', 'data-testid': 'wb-resolve-' + row.route, style: svcRowActionStyle({ color: resolveArmedRoute === row.route ? 'var(--dsh-svc-danger)' : 'var(--dsh-svc-text-muted)' }), onClick: () => void resolveFlag() },
              resolveArmedRoute === row.route ? translate('models.plan.confirmArmed') : translate('models.wb.recovery.resolve')) : null,
          ]) : null,
          resolveError !== '' ? el('p', { key: 'resolveError', 'data-testid': 'wb-resolve-error-' + row.route, style: Object.assign({}, WB_ERROR, { margin: 0 }) }, resolveError) : null,
          el('div', { key: 'actions', style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, [
            el('button', { key: 'check', type: 'button', 'data-testid': 'wb-check-' + row.route, style: svcButtonStyle('primary'), onClick: () => { setUndoRoute(null); setTaskRoute(row.route) } }, translate('models.wb.checkFix')),
            el('button', { key: 'edit', type: 'button', 'data-testid': 'wb-edit-' + row.route, style: svcButtonStyle('neutral'), onClick: () => { setUndoRoute(null); setEditRoute(row.route) } }, translate('models.wb.edit.btn')),
            el('button', { key: 'remove', type: 'button', 'data-testid': 'wb-remove-' + row.route, style: svcButtonStyle('dangerGhost'), onClick: () => { setUndoRoute(null); setRemoveRoute(row.route) } }, translate('models.wb.remove.btn')),
            row.undoable === true && undoRoute !== row.route
              ? el('button', { key: 'undo', type: 'button', 'data-testid': 'wb-undo-' + row.route, style: svcButtonStyle('dangerGhost'), onClick: () => setUndoRoute(row.route) }, translate('models.wb.undoWrite'))
              : null,
          ]),
          undoRoute === row.route
            ? el(UndoPanel, { key: 'undo-panel', route: row.route, onUndone: reload, onCancel: () => setUndoRoute(null) })
            : null,
          editRoute === row.route
            ? el(ManualEditor, { key: 'edit-panel', route: row.route, onDone: reload, onCancel: () => setEditRoute(null) })
            : null,
          removeRoute === row.route
            ? el(RemovePanel, { key: 'remove-panel', route: row.route, onDone: reload, onCancel: () => setRemoveRoute(null) })
            : null,
        ])
        }
        return el('div', { 'data-testid': 'models-section' }, [
          el('div', { key: 'security', 'data-testid': 'models-security-card', style: WB_CARD }, [
            el('button', { key: 'toggle', type: 'button', 'data-testid': 'models-security-toggle', 'aria-expanded': String(securityOpen), onClick: () => setSecurityOpen(!securityOpen), style: Object.assign({}, svcButtonStyle('ghost'), { width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }) },
              el('span', { style: { fontWeight: 600 } }, translate('models.security.title')),
              el('span', { 'aria-hidden': 'true' }, securityOpen ? '▾' : '▸')),
            securityOpen ? el('div', { key: 'body', 'data-testid': 'models-security-body', style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, [
              el('div', { key: 'url' }, el('b', null, translate('models.security.urlTitle')), el('p', { style: { margin: '2px 0 0' } }, translate('models.security.urlBody'))),
              el('div', { key: 'key' }, el('b', null, translate('models.security.keyTitle')), el('p', { style: { margin: '2px 0 0' } }, translate('models.security.keyBody'))),
              el('div', { key: 'revert' }, el('b', null, translate('models.security.revertTitle')), el('p', { style: { margin: '2px 0 0' } }, translate('models.security.revertBody'))),
            ]) : null,
          ]),
          el('div', { key: 'routes', style: WB_CARD }, [
            el('div', { key: 'title', 'data-testid': 'models-routes-title', style: { fontSize: '15px', fontWeight: 600, marginBottom: '6px' } }, translate('models.routes.title')),
            snapshot === null
              ? el('p', { key: 'loading', 'data-testid': 'models-routes-loading', style: WB_MUTED }, '…')
              : routes.length === 0
                ? el('p', { key: 'empty', 'data-testid': 'models-routes-empty', style: WB_MUTED }, translate('models.wb.empty'))
                : routes.map(routeRow),
          ]),
          el(CreateProviderCard, { key: 'create', onCreated: reload }),
        ])
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
    LegacyProvidersWorkbench,
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
