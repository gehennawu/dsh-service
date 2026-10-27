// Model editing owns three independent states: saved baseline, draft, suggestions.
// Modern card-based layout matching DSH official UI & workbench specifications.
function createModelConfig({ useTranslation, rpcCall, SvcTabs, useFeatures, modelsNavToggle }) {
  const el = React.createElement
  const { useState, useEffect, useRef } = React
  function Modal(props) {
    const { Modal: ShellModal } = require('@deepseek-ai/dsh-client-ui-primitives')
    return el(ShellModal, props)
  }
  const card = { padding: '16px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px', background: 'var(--dsw-alias-bg-layer-3)', minWidth: 0, overflowWrap: 'anywhere', marginBottom: '12px' }
  const subCard = { padding: '12px 14px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-2)', minWidth: 0, marginBottom: '8px' }
  const inputStyle = { width: '100%', minWidth: 0, boxSizing: 'border-box', minHeight: 'var(--dsh-svc-control-h, 36px)', padding: '6px 10px', borderRadius: 'var(--dsh-svc-radius-control)', border: '1px solid var(--dsh-svc-border-strong)', background: 'var(--dsh-svc-content-bg)', color: 'var(--dsh-svc-text)', font: 'inherit', fontSize: '13px', lineHeight: '20px' }
  const muted = { fontSize: '12px', color: 'var(--dsh-svc-text-muted)' }
  const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', marginBottom: '4px' }
  const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginBottom: '12px' }
  const actions = { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }
  const modelFields = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat']
  // 渠道页只编辑身份与连接；高级渠道参数不再在这里提供入口。
  const routeFields = ['displayName', 'api', 'baseURL']
  const numbers = ['contextWindow', 'maxTokens', 'defaultContextWindow', 'defaultMaxTokens', 'timeoutMs', 'websocketConnectTimeoutMs', 'streamIdleTimeoutMs', 'maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes']
  const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

  const capacity = (text) => {
    if (!String(text).trim()) return undefined
    const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(String(text).trim())
    if (!match) throw new Error('schema-invalid')
    const value = Number(match[1]) * (match[2]?.toLowerCase() === 'm' ? 1e6 : match[2]?.toLowerCase() === 'k' ? 1e3 : 1)
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('schema-invalid')
    return value
  }
  const formatCapacity = (value) => {
    if (!Number.isInteger(value) || value <= 0) return ''
    if (value >= 1e6 && value % 1e5 === 0) return `${value / 1e6}M`
    if (value >= 1e3 && value % 1e2 === 0) return `${value / 1e3}K`
    return String(value)
  }
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const shown = (value) => value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const initialTexts = (value, fields) => Object.fromEntries(fields.map((key) => [key, numbers.includes(key) ? value[key] === undefined ? '' : String(value[key]) : value[key] === undefined ? '' : value[key]]))
  const rebaseUntouched = (draft, before, latest, fields, chosen = {}) => {
    const oldTexts = initialTexts(before, fields); const newTexts = initialTexts(latest, fields)
    return Object.fromEntries(fields.map((field) => [field, !chosen[field] && equal(draft[field], oldTexts[field]) ? newTexts[field] : draft[field]]))
  }
  const numericText = (value) => {
    if (typeof value !== 'string') return value
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('schema-invalid')
    return Number(value)
  }
  const structuredDraft = (field, value) => {
    if (field === 'thinkingBudgets' && value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, number]) => [key, numericText(number)]))
    if (field === 'retryPolicy' && value && typeof value === 'object') return { ...value, ...(value.maxRetries === undefined ? {} : { maxRetries: numericText(value.maxRetries) }), ...(value.backoff === undefined ? {} : { backoff: Object.fromEntries(Object.entries(value.backoff).map(([key, number]) => [key, numericText(number)])) }) }
    if (field === 'compat' && value && typeof value === 'object' && value.vllmPriority !== undefined) return { ...value, vllmPriority: numericText(value.vllmPriority) }
    return value
  }
  const parseDraft = (draft, baseline, fields) => {
    const patch = {}; const unset = []
    for (const key of fields) {
      let value = draft[key]
      if (numbers.includes(key)) {
        if (String(value ?? '').trim() === '') value = undefined
        else if (key === 'timeoutMs' || key === 'websocketConnectTimeoutMs' || key === 'streamIdleTimeoutMs') { value = Number(value); if (!Number.isFinite(value) || value < 0) throw new Error('schema-invalid') }
        else value = capacity(value)
      } else if (value === '') value = undefined
      else value = structuredDraft(key, value)
      if (equal(value, baseline[key])) continue
      if (value === undefined) unset.push(key); else patch[key] = value
    }
    return { patch, unset }
  }

  const dirtyGuards = new Set()
  const canLeave = () => [...dirtyGuards].every((check) => check())
  function useLeaveGuard(dirty, tr) {
    const current = useRef({ dirty, tr }); current.current = { dirty, tr }
    useEffect(() => {
      const check = () => !current.current.dirty || typeof window !== 'undefined' && typeof window.confirm === 'function' && window.confirm(current.current.tr('models.smart.leave'))
      dirtyGuards.add(check)
      const beforeUnload = (event) => { if (current.current.dirty) { event.preventDefault(); event.returnValue = '' } }
      const escape = (event) => { if (event.key === 'Escape' && current.current.dirty && !check()) { event.preventDefault(); event.stopImmediatePropagation?.() } }
      const shellLeave = (event) => {
        if (!current.current.dirty || typeof document === 'undefined') return
        const panel = document.querySelector?.('[role="dialog"][data-shortcut-modal="settings"]')
        const target = event.target?.closest ? event.target : event.target?.parentElement
        if (!panel || !target) return
        const close = target.closest('[class*="_close"]')
        const nav = target.closest('nav button')
        const mask = target.closest('[class*="_mask"]')
        const leaving = close && panel.contains(close) || nav && panel.contains(nav) && !nav.closest('[data-testid="service-panel-root"]') || mask && mask.parentElement === panel.parentElement
        if (leaving && !check()) { event.preventDefault(); event.stopImmediatePropagation?.() }
      }
      if (typeof window !== 'undefined') window.addEventListener?.('beforeunload', beforeUnload)
      if (typeof document !== 'undefined') { document.addEventListener?.('keydown', escape, true); document.addEventListener?.('click', shellLeave, true) }
      return () => { dirtyGuards.delete(check); if (typeof window !== 'undefined') window.removeEventListener?.('beforeunload', beforeUnload); if (typeof document !== 'undefined') { document.removeEventListener?.('keydown', escape, true); document.removeEventListener?.('click', shellLeave, true) } }
    }, [])
  }

  function Button({ id, onClick, children, danger = false, compact = false, disabled = false, style, ...rest }) {
    const baseStyle = compact ? svcRowActionStyle(danger ? { color: 'var(--dsh-svc-danger)', borderColor: 'var(--dsh-svc-danger)' } : {}) : svcButtonStyle(danger ? 'dangerGhost' : 'neutral')
    return el('button', { ...rest, type: 'button', 'data-testid': id, disabled, style: { ...baseStyle, whiteSpace: 'nowrap', flexShrink: 0, ...style }, onClick }, children)
  }
  function RowIcon({ kind }) {
    return el('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      kind === 'test' ? el('g', { transform: 'rotate(-45 12 12)', fill: 'currentColor', stroke: 'none' },
        el('path', { d: 'M1 11h3V8h4v1h3v2H8v2h3v2H8v1H4v-3H1Z' }),
        el('path', { d: 'M23 11h-3V8h-4v1h-3v2h3v2h-3v2h3v1h4v-3h3Z' })) : kind === 'edit' ? el('path', { d: 'm15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z' })
        : el('path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6m4-6v6' }))
  }
  function ReadValues({ value, exclude = [] }) {
    const tr = useTranslation()
    const rows = Object.entries(value ?? {}).filter(([key, entry]) => entry !== undefined && !['apiKeyEnv', 'models', 'maskedHeaders', 'hasModelOverrides', ...exclude].includes(key))
    if (!rows.length) return null
    return el('dl', { style: { ...subCard, marginTop: '12px' } }, ...rows.map(([key, entry]) => el('div', { key, style: { marginBottom: '8px' } },
      el('dt', { style: labelStyle }, tr('models.smart.field.' + key) === 'models.smart.field.' + key ? key : tr('models.smart.field.' + key)),
      el('dd', { style: { margin: 0, fontSize: '13px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, typeof entry === 'object' ? JSON.stringify(entry, null, 2) : String(entry))
    )))
  }
  function ErrorText({ error }) {
    const tr = useTranslation()
    if (!error) return null
    const key = 'models.smart.error.' + error
    return el('p', { role: 'alert', 'data-testid': 'model-config-error', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', margin: '8px 0', overflowWrap: 'anywhere' } }, tr(key) === key ? tr('models.smart.error.generic').replace('{code}', error) : tr(key))
  }

  // 基础调用失败的可见摘要：只列有界、已脱敏的字段，不改写为「成功」。
  function testFailureText(tr, value) {
    return [tr('models.smart.testFailed'), value?.failure?.code, value?.failure?.status ? 'HTTP ' + value.failure.status : '', value?.finishReason, value?.failure?.message]
      .filter(Boolean).join(' · ')
  }

  function Field({ field, value, onChange, schema, testId }) {
    const tr = useTranslation()
    const label = tr('models.smart.field.' + field) === 'models.smart.field.' + field ? field : tr('models.smart.field.' + field)
    const enums = schema?.routeEnums?.[field]
    const control = enums
      ? el('select', { style: inputStyle, 'aria-label': label, 'data-testid': 'model-field-' + field, value: value ?? '', onChange: (e) => onChange(e.target.value) }, ...enums.map((x) => el('option', { key: x }, x)))
      : el('input', { style: inputStyle, 'aria-label': label, 'data-testid': testId ?? 'model-field-' + field, value: value === undefined ? '' : value, onChange: (e) => onChange(e.target.value) })
    return el('div', { style: { minWidth: 0 } }, el('label', { style: { display: 'block' } }, el('span', { style: labelStyle }, label), control))
  }

  function SuggestionGroups({ groups, draft }) {
    const tr = useTranslation()
    return el('div', { 'data-testid': 'model-smart-groups', style: { marginTop: '8px' } },
      ...groups.map((group) => {
        const current = group.path?.length ? group.path.reduce((value, key) => value?.[key], draft) : draft[group.field]
        const fieldLabel = tr('models.smart.field.' + group.field)
        const normalize = (value) => group.field === 'input' && Array.isArray(value) ? [...new Set(value)].sort() : value
        const currentValue = normalize(current)
        const suggestedValue = normalize(group.candidate.value)
        const unchanged = equal(currentValue, suggestedValue) || (typeof currentValue !== 'object' && typeof suggestedValue !== 'object' && String(currentValue) === String(suggestedValue))
        const renderEfforts = (value) => {
          if (value === false) return el('span', { style: muted }, tr('models.smart.reasoning.false'))
          if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return el('span', { style: muted }, tr('models.smart.reasoning.inherit'))
          return el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' } },
            ...REASONING_LEVELS.filter((level) => Object.hasOwn(value, level)).map((level) => el('span', { key: level, style: svcBadgeStyle('neutral') }, level)))
        }
        return el('div', { key: group.key, style: { marginTop: '8px', fontSize: '12px', overflowWrap: 'anywhere' }, 'data-testid': 'model-suggestion-' + group.key },
          el('b', null, group.path?.length > 1 ? group.key : fieldLabel),
          group.field === 'reasoningEfforts' ? el('div', { 'data-testid': 'model-suggestion-diff-' + group.key, style: { marginTop: '6px' } },
            !unchanged ? el('div', { style: { marginBottom: '8px' } }, el('span', { style: muted }, tr('models.smart.currentEfforts')), renderEfforts(currentValue)) : null,
            el('span', { style: muted }, tr('models.smart.suggestedEfforts')), renderEfforts(suggestedValue))
            : el('div', { 'data-testid': 'model-suggestion-diff-' + group.key }, unchanged ? shown(suggestedValue) : shown(currentValue === '' ? undefined : currentValue) + ' → ' + shown(suggestedValue)))
      }))
  }

  // 只有页面可见的字段才进入一键填入；compat 没有编辑器，不能被静默写入。
  const SMART_FILL_FIELDS = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts']
  function smartFillGroups(result) {
    return (result?.groups ?? []).flatMap((group) => {
      const candidate = group.candidates?.find((entry) => entry.evidence === 'exact-channel-protocol') ?? group.candidates?.[0]
      return candidate && SMART_FILL_FIELDS.includes(group.field) ? [{ ...group, candidate }] : []
    })
  }

  function applySmartFill(draft, groups) {
    const next = { ...draft }
    for (const group of groups) {
      const value = group.candidate.value
      if (group.path?.length > 1) {
        next[group.path[0]] = { ...(next[group.path[0]] || {}), [group.path[1]]: value }
      } else {
        next[group.field] = numbers.includes(group.field) ? value === undefined ? '' : String(value) : value === undefined ? '' : value
        if (group.field === 'input' && Array.isArray(value)) next.input = [...new Set(['text', ...value])]
      }
    }
    return next
  }

  // Visual Modality Button (text instead of icon glyphs)
  function ModalityButton({ text, title, checked, disabled = false, onClick }) {
    return el('label', {
      title,
      style: { display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 8px', ...fullRound('8px'), border: '1px solid var(--dsw-alias-border-l2)', background: checked ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)', cursor: disabled ? 'default' : 'pointer', fontSize: '13px' },
    }, el('input', { type: 'checkbox', 'aria-label': title, checked, disabled, onChange: onClick, style: { margin: 0, width: '16px', height: '16px', accentColor: 'var(--dsw-alias-button-primary-fill)' } }), text)
  }

  function ModelDetail({ opened, model, isNew = false, onBack, onSaved }) {
    const tr = useTranslation()
    const baseline = model
    const pageRef = useRef(null)
    useEffect(() => { pageRef.current?.scrollIntoView?.({ block: 'start', behavior: 'instant' }) }, [])
    const [draft, setDraft] = useState(initialTexts(model, modelFields))
    const [modelId, setModelId] = useState(model.id ?? '')
    const [enabled, setEnabled] = useState(false)
    const [smartHelp, setSmartHelp] = useState(null)
    const [maxTokensHelp, setMaxTokensHelp] = useState(null)
    const [result, setResult] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [notice, setNotice] = useState('')
    const [queryRound, setQueryRound] = useState(0)
    const [fillPlan, setFillPlan] = useState(null)
    const suggestions = smartFillGroups(result)
    const [testPlan, setTestPlan] = useState(null)
    const [latestState, setLatestState] = useState(null)
    const [rebased, setRebased] = useState(null)
    const [baselineOverride, setBaselineOverride] = useState(null)
    const [conflictChoices, setConflictChoices] = useState({})
    const currentOpened = rebased ?? opened
    const currentBaseline = baselineOverride ?? baseline
    const catalogModel = currentOpened.catalogModels?.find((entry) => entry.id === modelId && (!model.api || entry.api === model.api)) ?? {}
    const resolvedModel = { ...catalogModel, ...(currentOpened.effective?.models?.find((entry) => entry.id === modelId) ?? {}), ...(currentOpened.resolved?.models?.find((entry) => entry.id === modelId) ?? {}) }
    if (resolvedModel.contextWindow === undefined) resolvedModel.contextWindow = currentOpened.profile.defaultContextWindow
    if (resolvedModel.maxTokens === undefined) resolvedModel.maxTokens = currentOpened.profile.defaultMaxTokens
    if (resolvedModel.input === undefined) resolvedModel.input = currentOpened.profile.defaultInput
    // 继承层条目仍用于压缩预算估算（恢复继承后实际会生效的值）。
    const inheritedModel = currentOpened.inherited?.models?.find((entry) => entry.id === (currentBaseline.id ?? modelId)) ?? {}
    const resolvedApi = opened.profile.api || resolvedModel.api || opened.resolvedApi || opened.effective?.api || opened.catalogModels?.find((entry) => entry.api)?.api
    const sequence = useRef(0)
    const dirty = !equal(draft, initialTexts(currentBaseline, modelFields)) || modelId !== (currentBaseline.id ?? '')
    useLeaveGuard(dirty, tr)

    // maxTokens 语义提示（不自动改值）：route 配置的是**单次请求输出预留**，不是模型能力上限。
    // DSH compaction（装机 0.2.1-rc.2，默认 thresholdRatio 0.8 / headroom 65536 / retainRatio 0.16）：
    //   reserved = 请求头 config.maxTokens（仅模型条目显式配置时物化，否则 0）
    //   threshold = floor(min(窗口×0.8, 窗口 − reserved − 65536))
    //   retain    = floor((窗口 − reserved) × 0.16)
    // 阈值 ≤0 或 retain ≥ threshold 都会抛 TargetPressureConfigError ⇒ 自动压力压缩不可用
    // （只剩请求溢出后的强制压缩与手动压缩）。这里按同一公式做估算，不替用户改值。
    const capacityOr = (text, fallback) => {
      if (text === '' || text === undefined) return fallback
      if (typeof text === 'number') return text
      try { return capacity(text) } catch (_) { return fallback }
    }
    const hintContextWindow = capacityOr(draft.contextWindow, resolvedModel.contextWindow)
    // 预算按「保存这份草稿之后」的状态估算：草稿非空用草稿值；草稿空表示恢复继承/未声明，
    // 此时只有继承层条目会重新生效（渠道/目录默认值不物化进请求头，不能算作预留）。
    const hintExplicitMaxTokens = draft.maxTokens === ''
      ? (Number.isSafeInteger(inheritedModel.maxTokens) ? inheritedModel.maxTokens : undefined)
      : capacityOr(draft.maxTokens, undefined)
    const hintReserved = Number.isInteger(hintExplicitMaxTokens) && hintExplicitMaxTokens > 0 ? hintExplicitMaxTokens : 0
    let hintThreshold
    let hintUnsafe = false
    if (Number.isInteger(hintContextWindow) && hintContextWindow > 0) {
      hintThreshold = Math.floor(Math.min(hintContextWindow * 0.8, hintContextWindow - hintReserved - 65536))
      const hintRetain = Math.floor((hintContextWindow - hintReserved) * 0.16)
      hintUnsafe = hintThreshold <= 0 || hintRetain >= hintThreshold
    }
    const capabilityCeiling = Array.isArray(result?.readonly)
      ? result.readonly.find((entry) => entry?.field === 'maxTokens' && entry?.kind === 'capability-ceiling' && typeof entry.value === 'number')
      : undefined
    // 按上下文窗口给一个可解释的建议值（不是模型能力上限，也不写配置）：
    //   1) 硬安全边界（默认 0.8/65536/0.16）：reserved 必须满足 W − reserved > 65536/(1−0.16) ≈ 78020，
    //      否则 retain ≥ threshold，DSH 会抛 TargetPressureConfigError 禁用自动压缩；
    //   2) 目标「阈值不低于约 60% 窗口」：reserved ≤ 0.4W − 65536，再向下取到 2 的幂档位；
    //   3) 输出预算封顶 64K（更长输出收益低且挤占输入），且不超过目录声明的能力上限；
    //   4) 无法安全预留时明确建议留空（此时显式值必然禁用自动压缩）。
    const recommendMaxTokens = (window, capability) => {
      if (!Number.isInteger(window) || window <= 0) return { kind: 'unknown' }
      const hardMax = window - 78020
      if (hardMax < 2048) return { kind: 'leave-empty' }
      const byThreshold = Math.floor(window * 0.4 - 65536)
      let ladder = 8192
      while (ladder * 2 <= byThreshold && ladder * 2 <= 65536) ladder *= 2
      let value = Math.min(ladder, 65536, hardMax)
      if (Number.isInteger(capability) && capability > 0 && capability < value) value = capability
      if (value < 1024) return { kind: 'leave-empty' }
      if (value % 1024 !== 0) value = Math.floor(value / 1024) * 1024
      return { kind: 'value', value }
    }
    const maxTokensRecommendation = recommendMaxTokens(hintContextWindow, capabilityCeiling?.value)
    // 建议值填入后的阈值（与 DSH 同公式），用于直接展示「影响」。
    const recommendationThreshold = maxTokensRecommendation.kind === 'value'
      ? Math.floor(Math.min(hintContextWindow * 0.8, hintContextWindow - maxTokensRecommendation.value - 65536))
      : undefined
    // 建议值展示用 1024 进制（8K/32K/64K），避免 formatCapacity 的 65.536K 形态。
    const tokenLabel = (value) => value % 1024 === 0 ? (value / 1024) + 'K' : String(value)
    // 最大输出不再单独提供“填入建议值”按钮：开启智能填充后，一键填入按窗口推荐值一起写入草稿。
    const fillSuggestions = (() => {
      if (maxTokensRecommendation.kind !== 'value') return suggestions
      const current = String(capacityOr(draft.maxTokens, currentBaseline.maxTokens ?? '')).trim()
      if (current === String(maxTokensRecommendation.value)) return suggestions
      return [...suggestions, { key: 'maxTokensRecommendation', field: 'maxTokens', path: ['maxTokens'], candidate: { value: maxTokensRecommendation.value, source: 'context-window' }, candidates: [{ id: 'context-window', value: maxTokensRecommendation.value, source: 'context-window' }] }]
    })()

    useEffect(() => {
      const id = ++sequence.current
      if (!enabled || !modelId.trim()) { setResult(null); setLoading(false); return }
      let alive = true
      setResult(null); setFillPlan(null); setLoading(true)
      rpcCall('models3-fill', { route: opened.route, modelId: modelId.trim(), api: resolvedApi }).then((res) => {
        if (!alive || sequence.current !== id) return
        setLoading(false)
        if (!res.ok) { setError(res.error); return }
        setResult(res.value); setError((previous) => previous === 'conflict' || previous === 'schema-invalid' || previous === 'configuration-rejected' ? previous : '')
      }).catch(() => { if (alive && sequence.current === id) { setLoading(false); setError('operation-failed') } })
      return () => { alive = false; sequence.current++ }
    }, [enabled, modelId, opened.route, resolvedApi, queryRound])

    const save = async () => {
      if (!modelId.trim()) { setError('bad-model-id'); return }
      setBusy(true); setError(''); setNotice('')
      try {
        let patch; try { patch = parseDraft(draft, currentBaseline, modelFields) } catch (_) { setError('schema-invalid'); return }
        const res = await rpcCall('models3-save-model', { sessionId: currentOpened.sessionId, modelId: modelId.trim(), ...(!isNew ? { originalModelId: currentBaseline.id } : {}), patch: patch.patch, unset: patch.unset, add: isNew })
        if (!res.ok) setError(res.error)
        else onSaved()
      } catch (_) {
        // 传输层失败（宿主重启 / 断连 / 超时）必须复位并保留草稿，否则按钮永久不可用。
        setError('operation-failed')
      } finally {
        setBusy(false)
      }
    }

    const test = async () => {
      setError(''); setNotice('')
      try {
        const res = await rpcCall('models3-test-preview', { sessionId: currentOpened.sessionId, modelId: model.id })
        if (!res.ok) setError(res.error)
        else setTestPlan(res.value)
      } catch (_) { setError('operation-failed') }
    }

    // Modality handling (Text + Image)
    const currentInputModes = () => {
      const v = draft.input === '' || draft.input === undefined ? resolvedModel.input : draft.input
      if (Array.isArray(v) && v.length > 0) return v
      if (v === 'image') return ['text', 'image']
      if (v === 'image-only') return ['image']
      return ['text']
    }
    const toggleInputModality = (mod) => {
      if (mod === 'text') return
      const cur = [...new Set(['text', ...currentInputModes()])]
      let next
      if (cur.includes(mod)) {
        if (cur.length === 1 && mod === 'text') return // text must stay if lone
        next = cur.filter((x) => x !== mod)
      } else {
        next = [...cur, mod]
      }
      setDraft({ ...draft, input: next })
    }

    // Reasoning efforts handling
    const reasoningEfforts = draft.reasoningEfforts === '' || draft.reasoningEfforts === undefined ? resolvedModel.reasoningEfforts : draft.reasoningEfforts
    const isReasoningFalse = reasoningEfforts === false
    const effortMap = typeof reasoningEfforts === 'object' && reasoningEfforts !== null ? reasoningEfforts : {}
    const isEffortChecked = (lvl) => !isReasoningFalse && Object.hasOwn(effortMap, lvl)
    const toggleEffortLevel = (lvl) => {
      const next = { ...effortMap }
      if (Object.hasOwn(next, lvl)) {
        delete next[lvl]
      } else {
        next[lvl] = lvl === 'off' ? null : lvl
      }
      setDraft({ ...draft, reasoningEfforts: Object.keys(next).length === 0 ? undefined : next })
    }
    const setEffortWire = (lvl, wire) => {
      const next = { ...effortMap, [lvl]: wire }
      setDraft({ ...draft, reasoningEfforts: next })
    }

    return el('article', { ref: pageRef, style: card, 'data-testid': 'model-detail', 'data-model-id': modelId },
      // Top Navigation / Breadcrumb row
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          el(Button, { id: 'model-detail-back', onClick: () => { if (canLeave()) onBack() } }, tr('models.smart.back')),
          el('h3', { style: { margin: 0, fontSize: '16px', fontWeight: 600 } }, tr('models.smart.editTitle'))
        ),
      ),

      fillPlan ? el(Modal, {
        open: true, title: tr('models.smart.fillAll'), closeLabel: tr('models.smart.cancel'), onClose: () => setFillPlan(null),
        footer: el('div', { style: actions },
          el(Button, { onClick: () => setFillPlan(null) }, tr('models.smart.cancel')),
          el(Button, { id: 'model-smart-fill-confirm', style: svcButtonStyle('primary'), onClick: () => { setDraft((current) => applySmartFill(current, fillPlan)); setFillPlan(null) } }, tr('models.smart.confirmFill'))),
      }, el('p', { style: muted }, tr('models.smart.fillConfirmPrompt')), el(SuggestionGroups, { groups: fillPlan, draft })) : null,

      // ── Section 1: 模型基础信息 (Identity Row - 2-Column Grid) ──
      el('div', { style: grid2 },
        el('div', null,
          el('label', { style: labelStyle }, tr('models.wb.edit.modelId') || '模型 ID'),
          el('input', { style: inputStyle, value: modelId, placeholder: tr('models.wb.edit.modelIdPlaceholder'), 'aria-label': tr('models.smart.field.modelId'), 'data-testid': isNew ? 'model-new-id' : undefined, onChange: (e) => setModelId(e.target.value) })
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.smart.field.name')),
          el('input', { style: inputStyle, value: draft.name ?? '', 'aria-label': tr('models.smart.field.name'), 'data-testid': 'model-field-name', placeholder: resolvedModel.name || tr('models.wb.edit.displayNamePlaceholder'), onChange: (e) => setDraft({ ...draft, name: e.target.value }) })
        )
      ),

      el('div', { style: { ...actions, margin: '36px 0 12px' } },
        el('span', { style: { fontSize: '13px' } }, tr('models.smart.title')),
        el('button', {
          type: 'button', role: 'switch', 'aria-checked': enabled, 'data-testid': 'model-smart-toggle', 'aria-label': tr('models.smart.title'),
          'aria-describedby': smartHelp ? 'model-smart-help' : undefined,
          onMouseEnter: (event) => { const rect = event.currentTarget.getBoundingClientRect(); setSmartHelp({ x: rect.left, y: rect.bottom }) },
          onMouseLeave: () => setSmartHelp(null),
          onFocus: (event) => { const rect = event.currentTarget.getBoundingClientRect(); setSmartHelp({ x: rect.left, y: rect.bottom }) },
          onBlur: () => setSmartHelp(null),
          style: { width: '38px', height: '22px', ...fullRound('999px'), border: 0, padding: '2px', display: 'inline-flex', alignItems: 'center', justifyContent: enabled ? 'flex-end' : 'flex-start', background: enabled ? 'var(--dsw-alias-button-primary-fill)' : 'var(--dsw-alias-state-idle-primary)', cursor: 'pointer' },
          onClick: () => setEnabled(!enabled),
        }, el('span', { style: { width: '18px', height: '18px', ...fullRound('50%'), background: 'var(--dsw-alias-bg-layer-3)' } })),
        enabled ? el(Button, { id: 'model-smart-refresh', onClick: () => setQueryRound(queryRound + 1) }, tr('models.smart.refresh')) : null),

      smartHelp ? el('div', { id: 'model-smart-help', role: 'tooltip', style: { position: 'fixed', zIndex: 1000, left: Math.max(12, Math.min(smartHelp.x, window.innerWidth - 312)), top: Math.max(12, Math.min(smartHelp.y + 8, window.innerHeight - 180)), width: '300px', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere', pointerEvents: 'none' } }, tr('models.smart.help')) : null,

      enabled ? el('div', { style: { padding: '8px 12px', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '8px', marginBottom: '14px', border: '1px solid var(--dsw-alias-border-l2)' } },
        loading ? el('p', { role: 'status', 'data-testid': 'model-smart-loading', style: { ...muted, margin: 0 } }, tr('models.smart.loading')) : null,
        result ? el('div', null,
          fillSuggestions.length > 0 ? el('div', { 'data-testid': 'model-smart-inline-bar', style: { ...actions, justifyContent: 'space-between', marginBottom: '8px' } },
            el('b', { style: { fontSize: '12px' } }, tr('models.smart.suggestedValues')),
            el(Button, { id: 'model-smart-auto-fill', 'data-testid': 'model-smart-auto-fill', style: svcButtonStyle('primary'), onClick: () => setFillPlan(fillSuggestions) }, tr('models.smart.fillAll'))) : null,
          fillSuggestions.length === 0 ? el('p', { role: 'status', 'data-testid': 'model-smart-empty', style: { ...muted, margin: 0 } }, tr('models.smart.noSuggestions')) : el(SuggestionGroups, { groups: fillSuggestions, draft }),
          // 别名归一提示：原始 ID 在固定来源无记录、改按规范化别名查询时明示，避免误当成精确身份。
          result.identity?.via === 'alias' ? el('p', { role: 'status', 'data-testid': 'model-smart-alias', style: { ...muted, margin: '10px 0 0', lineHeight: '18px', overflowWrap: 'anywhere' } }, tr('models.smart.aliasIdentity').replace('{requested}', String(result.identity.requestedModelId ?? '')).replace('{matched}', String(result.identity.modelId ?? ''))) : null,
          !suggestions.some((group) => group.field === 'reasoningEfforts') ? el('p', { role: 'status', 'data-testid': 'model-smart-reasoning-empty', style: { ...muted, margin: '10px 0 0' } }, tr(result.reasoningSupported ? 'models.smart.reasoningSupportedNoLevels' : 'models.smart.noReasoningSuggestions')) : null,
        ) : null
      ) : null,

      // ── Section 2: 容量规格 (Capacity Row - 2-Column Grid Matching Screenshot) ──
      el('div', { style: grid2 },
        el('div', null,
          el('label', { style: labelStyle }, tr('models.wb.edit.context') || '上下文窗口'),
          el('input', {
            style: inputStyle,
            'data-testid': 'model-field-contextWindow',
            'aria-label': tr('models.smart.field.contextWindow'),
            // 只显示草稿；占位符与旁注才体现继承/生效值，清空不会被旧值重新填回。
            value: draft.contextWindow,
            placeholder: formatCapacity(resolvedModel.contextWindow) || tr('models.wb.edit.contextPlaceholder'),
            onChange: (e) => setDraft({ ...draft, contextWindow: e.target.value }),
          }),
        ),
        el('div', null,
          el('label', { style: { ...labelStyle, display: 'inline-flex', alignItems: 'center', gap: '5px' } },
            tr('models.wb.edit.maxTokens') || '最大输出 token',
            // 说明收进带圈问号：默认不占版面，悬停或聚焦才展开。
            el('button', {
              type: 'button',
              'data-testid': 'model-maxTokens-help',
              'aria-label': tr('models.smart.maxTokensHelpLabel'),
              'aria-describedby': maxTokensHelp ? 'model-maxTokens-help-popup' : undefined,
              onMouseEnter: (event) => { const rect = event.currentTarget.getBoundingClientRect(); setMaxTokensHelp({ x: rect.left, y: rect.bottom }) },
              onMouseLeave: () => setMaxTokensHelp(null),
              onFocus: (event) => { const rect = event.currentTarget.getBoundingClientRect(); setMaxTokensHelp({ x: rect.left, y: rect.bottom }) },
              onBlur: () => setMaxTokensHelp(null),
              onKeyDown: (event) => { if (event.key === 'Escape') setMaxTokensHelp(null) },
              style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', padding: 0, border: 0, background: 'transparent', color: 'var(--dsh-svc-text-muted)', cursor: 'help' },
            }, el('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true },
              el('circle', { cx: 12, cy: 12, r: 9.2 }),
              el('path', { d: 'M9.7 9.4a2.4 2.4 0 1 1 3.4 2.1c-.7.4-1.1.9-1.1 1.7v.4' }),
              el('circle', { cx: 12, cy: 17.1, r: 0.95, fill: 'currentColor', stroke: 'none' })))
          ),
          el('input', {
            style: inputStyle,
            'data-testid': 'model-field-maxTokens',
            'aria-label': tr('models.smart.field.maxTokens'),
            value: draft.maxTokens,
            placeholder: formatCapacity(resolvedModel.maxTokens) || tr('models.wb.edit.maxTokensPlaceholder'),
            onChange: (e) => setDraft({ ...draft, maxTokens: e.target.value }),
          }),
          maxTokensHelp ? el('div', {
            id: 'model-maxTokens-help-popup',
            role: 'tooltip',
            'data-testid': 'model-maxTokens-help-popup',
            style: { position: 'fixed', zIndex: 1000, width: '320px', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', left: Math.max(12, Math.min(maxTokensHelp.x, window.innerWidth - 332)), top: Math.max(12, Math.min(maxTokensHelp.y + 8, window.innerHeight - 160)), padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere', pointerEvents: 'none' },
          },
            el('p', { 'data-testid': 'model-maxTokens-hint', style: { margin: '0 0 6px' } }, tr('models.smart.maxTokensHint')),
            hintThreshold !== undefined ? el('p', {
              role: 'status',
              'data-testid': 'model-maxTokens-budget',
              style: { margin: '0 0 6px', color: hintUnsafe ? 'var(--dsw-alias-state-error-primary)' : 'inherit' },
            }, hintUnsafe
              ? tr('models.smart.maxTokensUnsafe')
              : tr('models.smart.maxTokensThreshold').replace('{tokens}', String(hintThreshold))) : null,
            maxTokensRecommendation.kind === 'value' ? el('p', { 'data-testid': 'model-maxTokens-recommend', style: { margin: '0 0 6px', color: 'var(--dsw-alias-label-secondary)' } },
              tr('models.smart.maxTokensRecommend').replace('{value}', tokenLabel(maxTokensRecommendation.value)).replace('{window}', String(hintContextWindow)).replace('{threshold}', String(recommendationThreshold))) : null,
            maxTokensRecommendation.kind === 'leave-empty' ? el('p', { 'data-testid': 'model-maxTokens-recommend', style: { margin: '0 0 6px', color: 'var(--dsw-alias-state-warn-primary)' } }, tr('models.smart.maxTokensRecommendEmpty')) : null,
            capabilityCeiling !== undefined ? el('p', { 'data-testid': 'model-maxTokens-capability', style: { margin: 0 } }, tr('models.smart.maxTokensCapability').replace('{value}', tokenLabel(capabilityCeiling.value))) : null
          ) : null
        )
      ),

      el('section', { style: { margin: '18px 0' }, 'data-testid': 'model-advanced-options' },
      el('div', { 'data-testid': 'model-modalities-row', style: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '8px', marginBottom: '18px' } },
        el('div', null,
          el('label', { style: labelStyle }, tr('models.wb.edit.inputModalities') || '输入模态'),
          // Hidden/Accessible select to honor test automation
          el('select', { style: { display: 'none' }, 'aria-label': tr('models.smart.field.input'), value: currentInputModes().includes('image') ? 'image' : 'text', onChange: (e) => setDraft({ ...draft, input: e.target.value === 'image' ? ['text', 'image'] : ['text'] }) },
            el('option', { value: 'text' }, 'text'),
            el('option', { value: 'image' }, 'image')
          ),
          el('div', { style: { display: 'flex', gap: '8px' } },
            el(ModalityButton, { text: tr('models.smart.modality.text'), title: tr('models.smart.modality.textInput'), checked: true, disabled: true, onClick: () => toggleInputModality('text') }),
            el(ModalityButton, { text: tr('models.smart.modality.image'), title: tr('models.smart.modality.imageInput'), checked: currentInputModes().includes('image'), onClick: () => toggleInputModality('image') })
          )
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.wb.edit.outputModalities') || '输出模态'),
          el('div', { style: { display: 'flex', gap: '8px' } },
            el(ModalityButton, { text: tr('models.smart.modality.text'), title: tr('models.smart.modality.textOutput'), checked: true, disabled: true })
          )
        )
      ),

      // ── Section 4: 推理档位 (Reasoning Level Chips Matching Screenshot) ──
      el('div', { style: { marginBottom: '14px' } },
        el('label', { style: labelStyle }, tr('models.wb.edit.reasoningLevels') || '推理档位'),
        // 思考支持状态可见可选：继承/未声明、明确不支持、自定义 wire 映射。
        el('select', { style: { ...inputStyle, marginBottom: '6px' }, 'aria-label': tr('models.smart.field.reasoningEfforts'), 'data-testid': 'model-reasoning-mode', value: isReasoningFalse ? 'false' : Object.keys(effortMap).length > 0 ? 'map' : 'inherit', onChange: (e) => setDraft({ ...draft, reasoningEfforts: e.target.value === 'false' ? false : e.target.value === 'map' ? {} : '' }) },
          el('option', { value: 'inherit' }, tr('models.smart.reasoning.inherit')),
          el('option', { value: 'false' }, tr('models.smart.reasoning.false')),
          el('option', { value: 'map' }, tr('models.smart.reasoning.map'))
        ),
        el('div', { className: 'dsh-model-efforts', 'data-testid': 'model-efforts-row', style: { display: 'flex', flexWrap: 'nowrap', gap: '2px', alignItems: 'stretch', margin: '6px 0', minWidth: 0 } },
          el('style', null, `.dsh-model-efforts { container-type:inline-size; } .dsh-model-efforts .dsh-model-effort-label { width:100%; box-sizing:border-box; justify-content:center; font-size:clamp(6px, 2.7cqw, 14px); gap:clamp(1px, .4cqw, 4px); padding:8px 1px; } .dsh-model-efforts .dsh-model-effort-check { width:clamp(8px, 2.9cqw, 16px); height:clamp(8px, 2.9cqw, 16px); }`),
          REASONING_LEVELS.map((lvl) => {
            const checked = isEffortChecked(lvl)
            return el('span', { key: lvl, style: { display: 'flex', alignItems: 'stretch', minWidth: 0, flex: '1 1 0' } },
              el('label', {
                'data-testid': 'models-effort-' + lvl,
                className: 'dsh-model-effort-label',
                style: {
                  display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', ...fullRound('6px'), cursor: 'pointer',
                  border: '1px solid ' + (checked ? 'var(--dsh-svc-brand, #3b82f6)' : 'var(--dsw-alias-border-l2)'),
                  background: checked ? 'var(--dsw-alias-bg-layer-2)' : 'var(--dsw-alias-bg-layer-3)',
                  color: checked ? 'var(--dsw-alias-label-primary)' : 'var(--dsh-svc-text-muted)',
                  fontWeight: checked ? 600 : 400,
                },
              }, el('input', { type: 'checkbox', className: 'dsh-model-effort-check', checked, 'aria-label': lvl, onChange: () => toggleEffortLevel(lvl), style: { margin: 0, flexShrink: 0, accentColor: 'var(--dsw-alias-button-primary-fill)' } }), lvl)
            )
          })
        ),
        // wire 值默认折叠：普通用户只用档位按钮；协议映射需要展开后再改。
        Object.keys(effortMap).length > 0 ? el('details', { 'data-testid': 'model-reasoning-wire-editor', style: { marginTop: '4px' } },
          el('summary', { style: { cursor: 'pointer', ...muted } }, tr('models.smart.wireEditor')),
          el('div', { 'data-testid': 'model-reasoning-wires', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', margin: '8px 0 6px' } },
            ...REASONING_LEVELS.filter((level) => Object.hasOwn(effortMap, level)).map((level) => el('label', { key: level, style: { minWidth: 0 } },
              el('span', { style: { ...labelStyle, fontSize: '11px' } }, level + ' → ' + tr('models.smart.wireValue')),
              el('input', {
                style: { ...inputStyle, minHeight: '30px', fontSize: '12px' },
                'aria-label': level + ' wire',
                'data-testid': 'model-wire-' + level,
                value: typeof effortMap[level] === 'string' ? effortMap[level] : '',
                placeholder: tr('models.smart.wireRequired'),
                onChange: (e) => setEffortWire(level, e.target.value),
              })))),
          el('small', { style: { ...muted, display: 'block', lineHeight: '17px' } }, tr('models.smart.wireHint'))
        ) : null
      ),

      ),

      isNew ? el('details', { style: { margin: '16px 0' }, 'data-testid': 'model-new-parameters' },
        el('summary', { style: { cursor: 'pointer', ...muted } }, tr('models.smart.parametersJson')),
        el('pre', { style: { padding: '12px', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '8px', fontSize: '12px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, JSON.stringify({ id: modelId, ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== '' && value !== undefined)) }, null, 2))) : null,

      // Error / Status notice
      el(ErrorText, { error }),
      notice ? el('p', { role: 'status', style: { color: notice === tr('models.smart.testFailed') ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)', fontSize: '13px' } }, notice) : null,

      // Conflict comparison card
      error === 'conflict' ? el('section', { style: subCard, 'data-testid': 'model-conflict' },
        el(Button, { id: 'model-conflict-compare', onClick: async () => { const res = await rpcCall('models3-open', { route: opened.route }); if (!res.ok) setError(res.error); else setLatestState(res.value) } }, tr('models.smart.compareLatest')),
        latestState ? el('div', { style: { marginTop: '8px' } },
          ...modelFields.map((field) => el('div', { key: field, style: { marginTop: '6px' } }, el('b', { style: { fontSize: '12px' } }, field), el('p', { style: muted }, tr('models.smart.latest') + ': ' + shown(latestState.profile.models.find((x) => x.id === currentBaseline.id)?.[field]) + ' · ' + tr('models.smart.draft') + ': ' + shown(draft[field])), el(Button, { onClick: () => { const value = latestState.profile.models.find((x) => x.id === currentBaseline.id)?.[field]; setDraft({ ...draft, [field]: numbers.includes(field) ? value === undefined ? '' : String(value) : value === undefined ? '' : value }); setConflictChoices({ ...conflictChoices, [field]: true }) } }, tr('models.smart.useLatest')))),
          el(Button, { id: 'model-conflict-rebase', style: { marginTop: '8px' }, onClick: () => { const value = latestState.profile.models.find((x) => x.id === currentBaseline.id) ?? { id: modelId }; setDraft(rebaseUntouched(draft, currentBaseline, value, modelFields, conflictChoices)); setRebased(latestState); setBaselineOverride(value); setConflictChoices({}); setError(''); setLatestState(null) } }, tr('models.smart.rebaseDraft'))) : null
      ) : null,

      // 真实调用确认：内容、预算、超时与计费边界都先展示，确认后才提交。
      testPlan ? el('section', { style: subCard, 'data-testid': 'model-test-plan' },
        el('p', { style: { margin: '0 0 6px 0', fontSize: '12px' } }, tr('models.smart.testBoundary')),
        el('code', { style: { fontSize: '12px', display: 'block', marginBottom: '4px', overflowWrap: 'anywhere' } }, (testPlan.text ?? 'ping') + ' · maxTokens=' + testPlan.maxTokens + ' · ' + testPlan.timeoutMs + 'ms'),
        testPlan.mayCharge === true ? el('small', { style: { ...muted, display: 'block', marginBottom: '8px' } }, tr('models.smart.testMayCharge')) : null,
        el('div', { style: actions },
          el(Button, { id: 'model-test-confirm', disabled: busy, style: svcButtonStyle('primary'), onClick: async () => {
            setBusy(true)
            try {
              const res = await rpcCall('models3-test-commit', { planId: testPlan.planId })
              setTestPlan(null)
              if (!res.ok) setError(res.error)
              else if (res.value.ok) setNotice(tr('models.smart.testPassed'))
              else setError(testFailureText(tr, res.value))
            } catch (_) { setTestPlan(null); setError('operation-failed') } finally { setBusy(false) }
          } }, tr('models.smart.confirm')),
          el(Button, { onClick: () => setTestPlan(null) }, tr('models.smart.cancel'))
        )
      ) : null,
      el('div', { style: { ...actions, justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2)' } },
        el(Button, { onClick: () => { if (canLeave()) onBack() } }, tr('models.smart.cancel')),
        dirty ? el('span', { role: 'status', style: muted }, tr('models.smart.unsaved')) : null,
        // 测试只针对已保存状态；草稿未保存时给出明确原因而不是静默失败。
        el(Button, { id: 'model-detail-test', disabled: busy || dirty, title: dirty ? tr('models.smart.testNeedsSaved') : tr('models.smart.test'), onClick: () => void test() }, tr('models.smart.test')),
        el(Button, { id: 'model-detail-save', disabled: busy || !dirty, onClick: () => void save(), style: { ...svcButtonStyle(dirty ? 'primary' : 'neutral'), ...(!dirty ? { opacity: 0.5, cursor: 'not-allowed' } : {}) } }, tr('models.smart.save')))
    )
  }

  function ProviderIcon({ row, size = 18 }) {
    const { value: features } = useFeatures()
    return (features.modelProviderIcons !== false && (modelIconNode(row.route, size, { flexShrink: 0 }, 'model-provider-icon-' + row.route)
      || modelIconNode(row.displayName, size, { flexShrink: 0 }, 'model-provider-icon-' + row.route)))
      || el('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true, style: { flexShrink: 0 }, 'data-testid': 'model-provider-fallback-' + row.route },
        el('path', { d: 'M12 3 21 8v10l-9 5-9-5V8l9-5Zm0 10 9-5M12 13 3 8m9 5v10M7.5 5.5l9 5' }))
  }

  function RouteDetail({ row, onBack, reload, onModelsChanged }) {
    const tr = useTranslation()
    const [opened, setOpened] = useState(null)
    const [draft, setDraft] = useState(null)
    const [model, setModel] = useState(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [testRunning, setTestRunning] = useState(null)
    const [testElapsed, setTestElapsed] = useState(0)
    useEffect(() => {
      if (!testRunning) return
      const update = () => setTestElapsed(Math.floor((Date.now() - testRunning.startedAt) / 1000))
      update()
      const timer = window.setInterval(update, 1000)
      return () => window.clearInterval(timer)
    }, [testRunning])
    const [enabledHelp, setEnabledHelp] = useState(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [renaming, setRenaming] = useState(false)
    const [renameValue, setRenameValue] = useState('')
    const [latestRoute, setLatestRoute] = useState(null)
    const [routeConflictChoices, setRouteConflictChoices] = useState({})
    const [busy, setBusy] = useState(false)
    const [search, setSearch] = useState('')
    const [discovered, setDiscovered] = useState(null)
    const [discoverySearch, setDiscoverySearch] = useState('')
    const [discovering, setDiscovering] = useState(false)
    const [picked, setPicked] = useState([])
    const [manual, setManual] = useState('')
    const [plan, setPlan] = useState(null)
    const [key, setKey] = useState('')
    const routeDirty = draft !== null && opened !== null && !equal(draft, initialTexts(opened.profile, routeFields))
    const dirty = routeDirty || key !== '' || manual !== '' || picked.length > 0
    useLeaveGuard(model === null && dirty, tr)

    const load = async () => {
      const res = await rpcCall('models3-open', { route: row.route })
      if (!res.ok) { setError(res.error); return }
      setOpened(res.value); setError('')
      setDraft(initialTexts(res.value.profile, routeFields))
    }
    useEffect(() => { let alive = true; rpcCall('models3-open', { route: row.route }).then((res) => { if (!alive) return; if (!res.ok) { setError(res.error); return }; setOpened(res.value); setDraft(initialTexts(res.value.profile, routeFields)) }); return () => { alive = false } }, [row.route])
    const saved = () => { setModel(null); setDiscovered(null); setPicked([]); setManual(''); setKey(''); setError(''); void load(); reload() }

    if (model && opened) return el(ModelDetail, { key: model.id ?? 'new', opened, model, isNew: model.isNew === true, onBack: () => setModel(null), onSaved: saved })
    if (!opened || !draft) return el('div', { style: card }, el(ErrorText, { error }), tr('models.smart.loading'))
    const fields = routeFields
    const prepare = async (endpoint, payload, kind) => {
      setError('')
      try {
        const res = await rpcCall(endpoint, payload)
        if (!res.ok) setError(res.error)
        else setPlan({ ...res.value, kind })
      } catch (_) { setError('operation-failed') }
    }
    const models = (opened.profile?.models && opened.profile.models.length > 0) ? opened.profile.models : []

    return el('article', { style: { minWidth: 0 }, 'data-testid': 'model-route-detail' },
      // Top Navigation / Breadcrumb row
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          el(ProviderIcon, { row, size: 22 }),
          el('h3', { style: { margin: 0, fontSize: '20px', fontWeight: 700, overflowWrap: 'anywhere' } }, draft.displayName || row.displayName)
        ),
        el('div', { style: { ...actions, position: 'relative' } },
          el('button', { type: 'button', role: 'switch', 'aria-checked': row.enabled !== false, 'aria-label': tr('models.smart.providerEnabled'), 'aria-description': tr('models.smart.enableBoundary'), disabled: busy,
            onMouseEnter: (event) => setEnabledHelp({ x: event.clientX, y: event.clientY }), onMouseMove: (event) => setEnabledHelp({ x: event.clientX, y: event.clientY }), onMouseLeave: () => setEnabledHelp(null),
            onFocus: (event) => { const rect = event.currentTarget.getBoundingClientRect(); setEnabledHelp({ x: rect.right, y: rect.bottom }) }, onBlur: () => setEnabledHelp(null),
            onKeyDown: (event) => { if (event.key === 'Escape') setEnabledHelp(null) },
            onClick: async () => {
              setEnabledHelp(null); setBusy(true); setError('')
              try {
                const nextEnabled = row.enabled === false
                const preview = await rpcCall('models3-enabled-preview', { sessionId: opened.sessionId, enabled: nextEnabled })
                if (!preview.ok) { setError(preview.error); return }
                // 停用会影响主对话/子代理引用：有引用时先展示后果再确认；启用与无引用停用保持一键。
                const references = preview.value.references ?? []
                if (!nextEnabled && references.length > 0) { setPlan({ ...preview.value, kind: 'availability' }); return }
                const result = await rpcCall('models3-enabled-commit', { planId: preview.value.planId })
                if (!result.ok) setError(result.error); else reload()
              } catch (_) { setError('operation-failed') } finally { setBusy(false) }
            }, 'data-testid': 'model-route-enabled', style: { width: '38px', height: '22px', border: 0, ...fullRound('999px'), padding: '2px', background: row.enabled !== false ? 'var(--dsw-alias-button-primary-fill)' : 'var(--dsw-alias-state-idle-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: row.enabled !== false ? 'flex-end' : 'flex-start' } },
            el('span', { style: { width: '18px', height: '18px', ...fullRound('50%'), background: 'var(--dsw-alias-bg-layer-3)' } })),
          enabledHelp ? el('div', { role: 'tooltip', 'data-testid': 'model-route-enabled-help', style: { position: 'fixed', zIndex: 1000, left: Math.max(12, enabledHelp.x - Math.min(300, enabledHelp.x - 12)), top: Math.min(enabledHelp.y + 16, window.innerHeight - 100), width: Math.max(0, Math.min(300, enabledHelp.x - 12)), boxSizing: 'border-box', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', fontSize: '12px', lineHeight: '18px', overflowWrap: 'anywhere', pointerEvents: 'none' } }, tr('models.smart.enableBoundary')) : null,
          el(Button, { id: 'model-route-menu', 'aria-label': tr('models.smart.providerActions'), 'aria-expanded': menuOpen, 'aria-haspopup': 'menu', compact: true, onClick: () => setMenuOpen(!menuOpen) }, '⋯'),
          menuOpen ? el('div', { role: 'menu', style: { position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 2, minWidth: '160px', padding: '4px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', background: 'var(--dsw-alias-bg-overlay)', boxShadow: '0 6px 18px var(--dsw-alias-bg-mask-drop)' }, onKeyDown: (event) => { if (event.key === 'Escape') { event.stopPropagation(); setMenuOpen(false) } }, onBlur: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenuOpen(false) } },
            el(Button, { id: 'model-route-rename', role: 'menuitem', style: { width: '100%', justifyContent: 'flex-start', border: 0 }, onClick: () => { setMenuOpen(false); setRenameValue(draft.displayName || row.displayName); setRenaming(true) } }, tr('models.smart.rename')),
            el(Button, { id: 'model-route-delete', role: 'menuitem', danger: true, style: { width: '100%', justifyContent: 'flex-start', border: 0, borderTop: '1px solid var(--dsw-alias-border-l2)' }, onClick: () => { setMenuOpen(false); void prepare('models3-remove-preview', { sessionId: opened.sessionId }, 'remove') } }, tr('models.smart.deleteRoute'))
          ) : null
        )
      ),

      renaming ? el(Modal, {
        open: true, title: tr('models.smart.rename'), closeLabel: tr('models.smart.cancel'), onClose: () => setRenaming(false),
        footer: el(React.Fragment, null,
          el(Button, { onClick: () => setRenaming(false) }, tr('models.smart.cancel')),
          el(Button, { id: 'model-route-rename-confirm', disabled: !renameValue.trim(), style: svcButtonStyle('primary'), onClick: () => { setDraft({ ...draft, displayName: renameValue.trim() }); setRenaming(false) } }, tr('models.smart.renameApply'))),
      }, el('input', { autoFocus: true, style: inputStyle, value: renameValue, 'aria-label': tr('models.smart.field.displayName'), onChange: (event) => setRenameValue(event.target.value) })) : null,
      el('section', { style: { minWidth: 0, marginBottom: '24px', display: 'grid', gap: '14px' } },
        el(Field, { field: 'baseURL', value: draft.baseURL, schema: opened.schema, onChange: (v) => { if (!busy) setDraft({ ...draft, baseURL: v }) } }),
        el('div', { style: { display: 'grid', gap: '14px' } },
          (opened.builtin || row.source === 'builtin') ? el('label', null,
            el('span', { style: labelStyle }, tr('models.smart.field.api')),
            el('input', { style: inputStyle, readOnly: true, 'aria-label': tr('models.smart.field.api'), value: opened.resolvedApi || draft.api || opened.effective?.api || opened.catalogModels?.find((entry) => entry.api)?.api || tr('models.smart.protocolUnknown') })
          ) : el(Field, { field: 'api', value: draft.api, schema: opened.schema, onChange: (v) => { if (!busy) setDraft({ ...draft, api: v }) } }),
          // 混合协议目录（v2.0.9）：宿主在目录含 ≥2 种 api 时下发 catalogApis，提示路由级协议的覆盖语义。
          Array.isArray(opened.catalogApis) && opened.catalogApis.length > 1 ? el('p', { 'data-testid': 'model-mixed-api-hint', role: 'note', style: { ...muted, margin: 0 } }, tr('models.smart.mixedApiHint').replace('{apis}', opened.catalogApis.join(', '))) : null
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.smart.key')),
          ['missing', 'authorized'].includes(opened.credentialState) ? el('p', { role: 'status', style: { ...muted, margin: '0 0 6px' } }, tr('models.smart.keyState.' + opened.credentialState)) : null,
          el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            el('input', { type: 'password', autoComplete: 'new-password', style: { ...inputStyle, flex: 1, minWidth: '200px' }, 'aria-label': tr('models.smart.key'), value: key, placeholder: tr(opened.credentialState === 'configured' ? 'models.smart.keyConfiguredPlaceholder' : 'models.smart.keyReplacePlaceholder'), onChange: (e) => setKey(e.target.value) }),
            el(Button, { id: 'model-key-preview', disabled: !key.trim(), onClick: () => void prepare('models3-credential-preview', { sessionId: opened.sessionId, shared: false }, 'credential') }, tr('models.smart.updateKey'))
          )
        )
      ),

      el('section', { style: { minWidth: 0, marginBottom: '16px' } },
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' } },
          el('h4', { style: { ...muted, margin: 0, fontSize: '14px', fontWeight: 500 } }, tr('models.smart.modelList')),
          el('div', { style: actions },
            el(Button, { id: 'model-add', onClick: () => { if (canLeave()) setModel({ isNew: true }) } }, '＋ ' + tr('models.smart.newModel')),
            el(Button, { id: 'model-discover', disabled: discovering, onClick: async () => {
              setDiscovering(true); setError('')
              try {
                const res = await rpcCall('models3-discover', { sessionId: opened.sessionId })
                if (!res.ok) setError(res.error)
                // 重新发现不清空已有勾选：新列表之外的选择会以「筛选外」摘要显式呈现。
                else { setDiscoverySearch(''); setDiscovered(res.value.candidates) }
              } catch (_) { setError('operation-failed') } finally { setDiscovering(false) }
            } }, discovering ? tr('models.smart.loading') : tr('models.smart.discover'))
          )
        ),

        // Discovered models picker
        discovered !== null ? (() => {
          const term = discoverySearch.trim().toLowerCase()
          const visible = discovered.filter((x) => (x.id + ' ' + (x.name ?? '')).toLowerCase().includes(term))
          const pickable = visible.filter((x) => !models.some((m) => m.id === x.id)).map((x) => x.id)
          const hiddenPicks = picked.filter((id) => !discovered.some((x) => x.id === id))
          return el(Modal, {
            open: true,
            title: tr('models.smart.discover'),
            closeLabel: tr('models.smart.cancel'),
            onClose: () => { if (!busy) { setDiscovered(null); setPicked([]) } },
            footer: el(React.Fragment, null,
              el(Button, { disabled: busy, onClick: () => { setDiscovered(null); setPicked([]) } }, tr('models.smart.cancel')),
              el(Button, { id: 'model-add-batch', disabled: busy || picked.length === 0, style: svcButtonStyle('primary'), onClick: async () => {
                setBusy(true); setError('')
                try {
                  const res = await rpcCall('models3-add-models', { sessionId: opened.sessionId, modelIds: picked })
                  if (!res.ok) setError(res.error); else saved()
                } catch (_) { setError('operation-failed') } finally { setBusy(false) }
              } }, tr('models.smart.add'))
            ),
          }, el('div', { 'data-testid': 'model-discovery' },
            el('input', { type: 'search', style: { ...inputStyle, marginBottom: '8px' }, 'aria-label': tr('models.smart.search'), value: discoverySearch, placeholder: tr('models.smart.search'), onChange: (e) => setDiscoverySearch(e.target.value) }),
            el('div', { style: { ...actions, marginBottom: '8px' } },
              // 全选只并集当前可见且未添加的候选，不会丢弃搜索前已勾选的项。
              el(Button, { compact: true, disabled: busy, onClick: () => setPicked([...new Set([...picked, ...pickable])]) }, tr('models.smart.selectAll')),
              el(Button, { compact: true, disabled: busy, onClick: () => setPicked([]) }, tr('models.smart.clear'))
            ),
            picked.length > 0 ? el('div', { 'data-testid': 'model-discovery-selected', style: { ...muted, marginBottom: '8px', lineHeight: '18px' } },
              el('span', null, tr('models.smart.selectedCount').replace('{count}', String(picked.length))),
              hiddenPicks.length > 0 ? el('span', null, ' · ', tr('models.smart.hiddenPicks').replace('{count}', String(hiddenPicks.length)),
                el(Button, { id: 'model-discovery-remove-hidden', compact: true, style: { marginLeft: '6px' }, onClick: () => setPicked((current) => current.filter((id) => !hiddenPicks.includes(id))) }, tr('models.smart.removeHiddenPicks'))) : null
            ) : null,
            el('div', { style: { maxHeight: 'min(360px, 45dvh)', overflowY: 'auto' } },
              visible.length === 0 ? el('p', { 'data-testid': 'model-discovery-no-match', role: 'status', style: { ...muted, margin: '2px 0' } }, tr('models.smart.noSearchMatch')) : null,
              ...visible.map((x) => el('label', { key: x.id, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 4px', fontSize: '13px', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
                el('input', { type: 'checkbox', checked: picked.includes(x.id), disabled: busy || models.some((m) => m.id === x.id), onChange: (e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id)) }),
                el('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, x.id), models.some((m) => m.id === x.id) ? el('span', { style: svcBadgeStyle('neutral') }, tr('models.smart.added')) : null
              ))
            ),
            el(ErrorText, { error })
          ))
        })() : null,

        // Models list search
        models.length > 5 ? el('input', { style: { ...inputStyle, marginBottom: '8px' }, 'aria-label': tr('models.smart.search'), value: search, placeholder: tr('models.smart.search'), onChange: (e) => setSearch(e.target.value) }) : null,

        // Models rows (clean and structured)
        ...models.filter((x) => (x.id + ' ' + (x.name ?? '')).toLowerCase().includes(search.toLowerCase())).map((item, index) =>
          el('div', { key: item.id + ':' + (item.api ?? index), style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '10px', alignItems: 'center', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', marginBottom: '6px' } },
            el('div', { className: 'dsh-model-row-copy', style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' } },
              el('span', { className: 'dsh-model-row-name', title: item.id, style: { fontWeight: 700, maxWidth: '100%', '--model-name-length': String(Math.max((item.name?.trim() || item.id).length, 1)) } }, item.name?.trim() || item.id),
              el('div', { className: 'dsh-model-row-capabilities' },
              Array.isArray(item.input) && item.input.includes('image') ? el('span', { style: svcBadgeStyle('neutral') }, tr('models.smart.imageBadge')) : null,
              item.reasoningEfforts !== undefined ? el('span', { style: svcBadgeStyle('neutral') }, tr('models.smart.reasoningBadge')) : null,
              item.contextWindow ? el('span', { style: { fontSize: '11px', color: 'var(--dsh-svc-text-muted)' } }, formatCapacity(item.contextWindow)) : null
              )
            ),
            el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              el(Button, { id: 'model-test-' + item.id, compact: true, title: tr('models.smart.test'), 'aria-label': tr('models.smart.test') + ' ' + item.id, style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '4px' }, disabled: busy, onClick: () => {
                // 可能计费的真实调用：先出确认卡（内容/预算/超时/费用），确认后才提交。
                setError(''); setNotice('')
                void prepare('models3-test-preview', { sessionId: opened.sessionId, modelId: item.id }, 'test')
              } }, el(RowIcon, { kind: 'test' })),
              el(Button, { id: 'model-open-' + item.id, compact: true, title: tr('models.smart.edit'), 'aria-label': tr('models.smart.edit') + ' ' + item.id, style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '4px' }, onClick: () => { if (canLeave()) setModel(item) } }, el(RowIcon, { kind: 'edit' })),
              el(Button, { id: 'model-delete-' + item.id, compact: true, title: tr('models.smart.remove'), 'aria-label': tr('models.smart.remove') + ' ' + item.id, style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '4px' }, onClick: () => void prepare('models3-remove-preview', { sessionId: opened.sessionId, modelIds: [item.id] }, 'remove') }, el(RowIcon, { kind: 'delete' })),
              el('button', { type: 'button', role: 'switch', 'data-testid': 'model-enabled-' + item.id, 'aria-label': tr('models.smart.modelEnabled') + ' ' + item.id, 'aria-checked': opened.modelAvailability?.find((model) => model.id === item.id)?.enabled !== false, disabled: busy,
                onClick: async () => {
                  const expected = opened.modelAvailability?.find((model) => model.id === item.id)?.enabled !== false
                  setBusy(true); setError('')
                  try {
                    const result = await rpcCall('models3-model-enabled', { sessionId: opened.sessionId, modelId: item.id, enabled: !expected, expected })
                    if (!result.ok) setError(result.error)
                    else {
                      setOpened({ ...opened, modelAvailability: [...(opened.modelAvailability ?? []).filter((model) => model.id !== item.id), { id: item.id, enabled: !expected }] })
                      reload()
                    }
                  } catch (_) { setError('operation-failed') } finally { setBusy(false) }
                },
                style: { width: '34px', height: '20px', ...fullRound('999px'), border: 0, padding: '2px', flexShrink: 0, display: 'flex', alignItems: 'center', cursor: 'pointer', justifyContent: opened.modelAvailability?.find((model) => model.id === item.id)?.enabled !== false ? 'flex-end' : 'flex-start', background: opened.modelAvailability?.find((model) => model.id === item.id)?.enabled !== false ? 'var(--dsw-alias-button-primary-fill)' : 'var(--dsw-alias-state-idle-primary)' },
              }, el('span', { style: { width: '16px', height: '16px', ...fullRound('50%'), background: 'var(--dsw-alias-bg-layer-3)' } }))
            )
          )
        ),
        models.length === 0 ? el('p', { style: { ...muted, textAlign: 'center', padding: '8px 0' } }, tr('models.smart.noModels')) : null
      ),

      el('div', { style: { ...actions, marginTop: '12px' } },
        routeDirty ? el('span', { role: 'status', style: muted }, tr('models.smart.unsaved')) : null,
        !opened.readOnly ? el(Button, { id: 'model-route-save', disabled: busy || !routeDirty, style: { ...svcButtonStyle(routeDirty ? 'primary' : 'neutral'), ...(!routeDirty ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }, onClick: async () => {
          setError('')
          let patch
          try { patch = parseDraft(draft, opened.profile, fields) } catch (_) { setError('schema-invalid'); return }
          setBusy(true)
          try {
            const res = await rpcCall('models3-save-route', { sessionId: opened.sessionId, ...patch })
            if (!res.ok) setError(res.error); else saved()
          } catch (_) { setError('operation-failed') } finally { setBusy(false) }
        } }, tr('models.smart.saveRoute')) : null,
      ),

      // Plan execution modal / card
      plan?.kind === 'remove' ? el(Modal, {
        open: true, title: tr(plan.removeRoute ? 'models.smart.deleteRoute' : 'models.smart.deleteModelTitle'), closeLabel: tr('models.smart.cancel'), onClose: () => { if (!busy) setPlan(null) },
        footer: el(React.Fragment, null,
          el(Button, { disabled: busy, onClick: () => setPlan(null) }, tr('models.smart.cancel')),
          el(Button, { id: 'model-plan-confirm', danger: true, disabled: busy || plan.blocked, onClick: async (event) => {
            event?.stopPropagation?.()
            setBusy(true); setError('')
            try {
              const res = await rpcCall('models3-remove-commit', { planId: plan.planId })
              if (!res.ok) { setError(res.error); setPlan(null) }
              else if (plan.removeRoute) { setPlan(null); reload(); onBack() }
               else { setPlan(null); await load(); if (onModelsChanged) onModelsChanged(row); else reload() }
            } catch (_) { setError('operation-failed'); setPlan(null) } finally { setBusy(false) }
          } }, tr('models.smart.remove'))),
      }, el('div', { 'data-testid': 'model-plan' },
        el('p', { style: { fontSize: '14px', margin: '0 0 12px' } }, tr(plan.removeRoute ? 'models.smart.deleteRoutePrompt' : 'models.smart.deleteModelPrompt')),
        plan.removeRoute ? el('code', { style: { display: 'block', marginBottom: '8px', overflowWrap: 'anywhere' } }, plan.route) : null,
        ...(plan.modelsRemoved ?? []).map((id) => el('code', { key: id, style: { display: 'block', fontSize: '13px', overflowWrap: 'anywhere', marginBottom: '8px' } }, id)),
        (plan.references ?? []).length ? el('div', { role: 'alert', 'data-testid': 'model-removal-conflicts', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', overflowWrap: 'anywhere' } },
          el('b', null, tr('models.smart.removalConflicts')),
          el('ul', { style: { margin: '8px 0', paddingLeft: '20px' } }, ...plan.references.map((reference, index) => el('li', { key: index }, tr('models.smart.referenceKind.' + reference.kind) + '：', el('code', null, reference.provider + ' / ' + reference.model)))),
          el('p', { style: { margin: '8px 0' } }, tr('models.smart.resolveRemovalConflicts'))) : null,
        plan.blocked ? el('p', { role: 'alert', style: { ...muted, color: 'var(--dsw-alias-state-error-primary)' } }, tr('models.smart.error.removal-blocked')) : null
      )) : plan ? el('section', { style: { ...subCard, marginTop: '12px' }, 'data-testid': 'model-plan' },
        el('h4', { style: { margin: '0 0 6px 0', fontSize: '13px' } }, tr(plan.kind === 'test' ? 'models.smart.test' : plan.kind === 'availability' ? 'models.smart.disableProvider' : 'models.smart.consequences')),
        el('p', { style: { ...muted, overflowWrap: 'anywhere' } }, plan.route || row.displayName),
        // 停用渠道：宿主已算出主对话/子代理引用，必须逐条展示后再确认。
        plan.kind === 'availability' ? el('div', { 'data-testid': 'model-availability-references' },
          el('p', { style: { ...muted, margin: '0 0 6px' } }, tr('models.smart.disableBoundary')),
          (plan.references ?? []).length > 0 ? el('div', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', overflowWrap: 'anywhere' } },
            el('b', null, tr('models.smart.disableReferences')),
            el('ul', { style: { margin: '8px 0', paddingLeft: '20px' } }, ...(plan.references ?? []).map((reference, index) => el('li', { key: index }, tr('models.smart.referenceKind.' + reference.kind) + '：', el('code', null, reference.provider + ' / ' + reference.model))))) : null,
          el('p', { style: muted }, tr('models.smart.credentialRetained'))) : null,
        // 真实调用：固定内容、token 上限、超时与计费边界。
        plan.kind === 'test' ? el('div', { 'data-testid': 'model-test-details' },
          el('p', { style: { ...muted, margin: '0 0 6px' } }, tr('models.smart.testBoundary')),
          el('code', { style: { fontSize: '12px', display: 'block', marginBottom: '4px', overflowWrap: 'anywhere' } }, (plan.text ?? 'ping') + ' · maxTokens=' + plan.maxTokens + ' · ' + plan.timeoutMs + 'ms'),
          plan.mayCharge === true ? el('small', { style: { ...muted, display: 'block' } }, tr('models.smart.testMayCharge')) : null) : null,
        plan.kind !== 'availability' && plan.kind !== 'test' ? el('p', { style: muted }, tr('models.smart.credentialRetained')) : null,
        el('div', { style: actions },
          el(Button, { id: 'model-plan-confirm', danger: plan.kind === 'remove', disabled: plan.blocked || busy, onClick: async () => {
            const kind = plan.kind
            setBusy(true); setError('')
            if (kind === 'test') { setTestElapsed(0); setTestRunning({ modelId: plan.modelId, startedAt: Date.now() }) }
            try {
              const res = await rpcCall('models3-' + (kind === 'test' ? 'test' : kind === 'availability' ? 'enabled' : kind === 'credential' ? 'credential' : kind === 'remove' ? 'remove' : 'restore') + '-commit', { planId: plan.planId, ...(kind === 'credential' ? { key } : {}) })
              setPlan(null)
              if (!res.ok) setError(res.error)
              else if (res.value.configurationFailed) { setKey(''); setNotice(tr('models.smart.keyPartial')) }
              else if (kind === 'test') { if (res.value.ok) setNotice(tr('models.smart.testPassed')); else setError(testFailureText(tr, res.value)) }
              else if (kind === 'availability') { reload() }
              else if (kind === 'remove' && !plan.modelsRemoved?.length) { reload(); onBack() }
              else saved()
            } catch (_) { setPlan(null); setError('operation-failed') } finally { setTestRunning(null); setBusy(false) }
          } }, tr('models.smart.confirm')),
          el(Button, { disabled: busy, onClick: () => setPlan(null) }, tr('models.smart.cancel'))
        )
      ) : null,

      el(ErrorText, { error }),
      notice ? el('p', { role: 'status', style: { color: notice === tr('models.smart.testFailed') ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)', fontSize: '13px' } }, notice) : null,

      testRunning ? el('p', { role: 'status', 'aria-live': 'polite', 'data-testid': 'model-test-progress', style: { ...muted, fontSize: '13px', overflowWrap: 'anywhere' } }, testRunning.modelId + ' · ' + tr('models.smart.testing').replace('{seconds}', String(testElapsed))) : null,

      // Route conflict section
      error === 'conflict' ? el('section', { style: subCard, 'data-testid': 'model-route-conflict' },
        el(Button, { id: 'model-route-compare', onClick: async () => { const res = await rpcCall('models3-open', { route: row.route }); if (!res.ok) setError(res.error); else setLatestRoute(res.value) } }, tr('models.smart.compareLatest')),
        latestRoute ? el('div', { style: { marginTop: '8px' } },
          ...fields.map((field) => el('div', { key: field, style: { marginTop: '6px' } }, el('b', { style: { fontSize: '12px' } }, field), el('p', { style: muted }, tr('models.smart.latest') + ': ' + shown(latestRoute.profile[field]) + ' · ' + tr('models.smart.draft') + ': ' + shown(draft[field])), el(Button, { onClick: () => { setDraft({ ...draft, [field]: initialTexts(latestRoute.profile, fields)[field] }); setRouteConflictChoices({ ...routeConflictChoices, [field]: true }) } }, tr('models.smart.useLatest')))),
          el(Button, { id: 'model-route-rebase', style: { marginTop: '8px' }, onClick: () => { setDraft(rebaseUntouched(draft, opened.profile, latestRoute.profile, fields, routeConflictChoices)); setOpened(latestRoute); setRouteConflictChoices({}); setLatestRoute(null); setError(''); setPlan(null) } }, tr('models.smart.rebaseDraft'))
        ) : null
      ) : null
    )
  }

  function CreateRoute({ onBack, onCreated, templates = [] }) {
    const tr = useTranslation()
    const [template, setTemplate] = useState('')
    const [id, setId] = useState('')
    const [name, setName] = useState('')
    const [api, setApi] = useState('openai-completions')
    const [url, setURL] = useState('')
    const [key, setKey] = useState('')
    const [ids, setIds] = useState('')
    const [candidateModels, setCandidateModels] = useState([])
    const [discovered, setDiscovered] = useState(null)
    // 渠道模板/在线发现都可能一次带回上百个候选（amazon-bedrock 模板实测 193 个），
    // 单靠 160px 的滚动条无法定位，故候选区带本地搜索（过滤口径见下方 modelSearchTerm）。
    const [modelSearch, setModelSearch] = useState('')
    const [picked, setPicked] = useState([])
    const [discovering, setDiscovering] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const dirty = !!(id || name || url || key || ids || picked.length > 0 || api !== 'openai-completions')
    useLeaveGuard(dirty, tr)

    const changed = (fn) => (e) => { fn(e.target.value); setError('') }
    const onTemplateChange = (e) => {
      const val = e.target.value
      setTemplate(val)
      setDiscovered(null)
      setModelSearch('')
      setPicked([])
      setError('')
      if (val && val !== 'custom') {
        const tmpl = templates.find((t) => t.id === val)
        if (tmpl) {
          setId(tmpl.id)
          setName(tmpl.name)
          setApi(tmpl.api || 'openai-completions')
          setURL(tmpl.baseURL || '')
          setCandidateModels(tmpl.models || [])
          return
        }
      }
      setId('')
      setName('')
      setApi('openai-completions')
      setURL('')
      setCandidateModels([])
    }

    const discoverLive = async () => {
      if (!url.trim()) { setError('schema-invalid'); return }
      setDiscovering(true); setError('')
      try {
        const res = await rpcCall('models3-discover', { baseURL: url.trim(), api, key: key.trim() })
        if (!res.ok) setError(res.error)
        // 重新发现不清空已有勾选：新列表之外的选择会以「筛选外」摘要显式呈现。
        else { setModelSearch(''); setDiscovered(res.value.candidates || []) }
      } catch (_) { setError('operation-failed') } finally { setDiscovering(false) }
    }
    const availableModels = discovered !== null ? discovered : candidateModels
    // 按 ID + 名称过滤，大小写不敏感（对齐渠道详情发现弹窗的口径，并额外 trim 首尾空白）；
    // 空查询不过滤，保持模板/发现的原始顺序。
    const modelSearchTerm = modelSearch.trim().toLowerCase()
    const visibleModels = modelSearchTerm
      ? availableModels.filter((m) => (m.id + ' ' + (m.name ?? '')).toLowerCase().includes(modelSearchTerm))
      : availableModels
    // 与渠道详情统一：全选只并集当前可见项，已勾但不可见的选择单独列出并可整体移除。
    const hiddenPicked = picked.filter((id) => !availableModels.some((m) => m.id === id))

    return el('article', { style: card, 'data-testid': 'model-create-route' },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' } },
        el(Button, { onClick: () => { if (canLeave()) onBack() } }, tr('models.smart.back')),
        el('h3', { style: { margin: 0, fontSize: '14px', fontWeight: 700 } }, tr('models.smart.createRoute'))
      ),

      // Template Selector
      templates.length > 0 ? el('div', { style: { marginBottom: '12px' } },
        el('label', { style: labelStyle }, tr('models.smart.template')),
        el('select', { style: inputStyle, 'aria-label': tr('models.smart.template'), 'data-testid': 'model-create-template', value: template, onChange: onTemplateChange },
          el('option', { value: 'custom' }, tr('models.smart.templateCustom')),
          ...templates.map((t) => el('option', { key: t.id, value: t.id }, t.name + ' (' + t.id + ')'))
        )
      ) : null,

      // 混合协议模板（v2.0.9）：选中目录含多种协议的模板时提示路由级协议的覆盖语义（azure 等）。
      (() => {
        const tmpl = templates.find((t) => t.id === template)
        return tmpl !== undefined && Array.isArray(tmpl.apis) && tmpl.apis.length > 1
          ? el('p', { 'data-testid': 'model-create-mixed-api-hint', role: 'note', style: { ...muted, margin: '-6px 0 12px' } }, tr('models.smart.mixedApiHint').replace('{apis}', tmpl.apis.join(', ')))
          : null
      })(),

      // Identity & URL Grid
      el('div', { style: grid2 },
        el('div', null,
          el('label', { style: labelStyle }, tr('models.smart.routeId')),
          el('input', { style: inputStyle, value: id, 'aria-label': tr('models.smart.routeId'), placeholder: 'deepseek, openai...', onChange: changed(setId) })
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.smart.field.displayName')),
          el('input', { style: inputStyle, value: name, 'aria-label': tr('models.smart.field.displayName'), placeholder: 'DeepSeek, OpenAI...', onChange: changed(setName) })
        )
      ),

      el('div', { style: grid2 },
        el('div', null,
          el('label', { style: labelStyle }, tr('models.smart.field.api')),
          el('select', { style: inputStyle, 'aria-label': tr('models.smart.field.api'), value: api, onChange: changed(setApi) }, ...['openai-completions', 'openai-responses', 'anthropic-messages'].map((x) => el('option', { key: x }, x)))
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.smart.field.baseURL')),
          el('input', { style: inputStyle, value: url, 'aria-label': tr('models.smart.field.baseURL'), placeholder: 'https://api.openai.com/v1', onChange: changed(setURL) })
        )
      ),

      // API Key Field
      el('div', { style: { marginBottom: '12px' } },
        el('label', { style: labelStyle }, tr('models.smart.apiKey')),
        el('input', { type: 'password', autoComplete: 'new-password', style: inputStyle, value: key, placeholder: tr('models.smart.apiKeyPlaceholder'), 'aria-label': tr('models.smart.apiKey'), onChange: changed(setKey) })
      ),

      // Models Selection (Explicit checkboxes, UNCHECKED by default!)
      availableModels.length > 0 ? el('div', { style: { ...subCard, marginTop: '8px' } },
        el('p', { style: { ...labelStyle, margin: '0 0 6px 0' } }, tr('models.smart.selectModelsHint')),
        availableModels.length > 5 ? el('input', { type: 'search', 'data-testid': 'model-create-search', style: { ...inputStyle, marginBottom: '8px' }, 'aria-label': tr('models.smart.search'), value: modelSearch, placeholder: tr('models.smart.search'), onChange: changed(setModelSearch) }) : null,
        el('div', { style: { maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', padding: '6px', background: 'var(--dsw-alias-bg-layer-2)' } },
          visibleModels.length ? visibleModels.map((m) => el('label', { key: m.id, style: { display: 'block', padding: '3px 0', fontSize: '13px' } },
            el('input', { type: 'checkbox', checked: picked.includes(m.id), onChange: (e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id)) }),
            ' ' + m.id + (m.name && m.name !== m.id ? ' (' + m.name + ')' : '')
          )) : el('p', { 'data-testid': 'model-create-no-match', role: 'status', style: { ...muted, margin: '2px 0' } }, tr('models.smart.noSearchMatch'))
        ),
        el('div', { style: { ...actions, marginTop: '8px' } },
          // 只加过滤后仍可见的候选，并保留此前已勾选项——搜索后再点全选不会静默丢弃看不见的选择。
          el(Button, { onClick: () => setPicked([...new Set([...picked, ...visibleModels.map((m) => m.id)])]) }, tr('models.smart.selectAll')),
          el(Button, { onClick: () => setPicked([]) }, tr('models.smart.clear')),
          el(Button, { id: 'model-create-discover', disabled: discovering, onClick: () => void discoverLive() }, discovering ? tr('models.smart.loading') : tr('models.smart.discover'))
        ),
        picked.length > 0 ? el('div', { 'data-testid': 'model-create-selected', style: { ...muted, marginTop: '8px', lineHeight: '18px' } },
          el('span', null, tr('models.smart.selectedCount').replace('{count}', String(picked.length))),
          hiddenPicked.length > 0 ? el('span', null, ' · ', tr('models.smart.hiddenPicks').replace('{count}', String(hiddenPicked.length)),
            el(Button, { id: 'model-create-remove-hidden', compact: true, style: { marginLeft: '6px' }, onClick: () => setPicked((current) => current.filter((value) => !hiddenPicked.includes(value))) }, tr('models.smart.removeHiddenPicks'))) : null) : null
      ) : (url.trim() ? el('div', { style: { marginBottom: '8px' } },
        el(Button, { id: 'model-create-discover', disabled: discovering, onClick: () => void discoverLive() }, discovering ? tr('models.smart.loading') : tr('models.smart.discover'))
      ) : null),

      el('div', { style: { marginBottom: '12px' } },
        el('label', { style: labelStyle }, tr('models.smart.manualIds')),
        el('textarea', { style: { ...inputStyle, minHeight: '60px' }, value: ids, 'aria-label': tr('models.smart.manualIds'), placeholder: 'gpt-4o, claude-3-5-sonnet...', onChange: changed(setIds) })
      ),

      dirty ? el('p', { role: 'status', style: muted }, tr('models.smart.unsaved')) : null,
      el(Button, { id: 'model-create-save', disabled: !dirty || saving, style: { ...svcButtonStyle(dirty ? 'primary' : 'neutral'), ...(!dirty ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }, onClick: async () => {
        const allIds = [...new Set([...picked, ...ids.split(/[\s,]+/).filter(Boolean)])]
        if (allIds.length === 0) { setError('noModelsSelected'); return }
        setSaving(true); setError('')
        try {
          const models = allIds.map((modelId) => ({ id: modelId }))
          const payload = {
            route: id.trim(),
            profile: { displayName: name.trim() || id.trim(), api, baseURL: url.trim(), models },
            ...(key.trim() ? { key: key.trim() } : {}),
          }
          const prepared = await rpcCall('models3-create-preview', payload)
          if (!prepared.ok) { setError(prepared.error); return }
          const res = await rpcCall('models3-create-commit', { planId: prepared.value.planId })
          if (!res.ok) setError(res.error)
          else onCreated(id.trim())
        } catch (_) { setError('operation-failed') } finally { setSaving(false) }
      } }, tr('models.smart.save')),
      el(ErrorText, { error: error === 'noModelsSelected' ? tr('models.smart.noModelsSelected') : error })
    )
  }

  function Providers() {
    const tr = useTranslation()
    const [snapshot, setSnapshot] = useState(null)
    const [error, setError] = useState('')
    const [selected, setSelected] = useState(null)
    const [creating, setCreating] = useState(false)
    const [restore, setRestore] = useState(null)
    const [record, setRecord] = useState(null)
    const [forget, setForget] = useState(null)
    const [forgetBusy, setForgetBusy] = useState(false)
    const [notice, setNotice] = useState('')
    const selection = useRef(0)

    const reload = async () => { const res = await rpcCall('models3-snapshot', {}); if (!res.ok) setError(res.error); else { setSnapshot(res.value); setError('') } }
    useEffect(() => { let alive = true; rpcCall('models3-snapshot', {}).then((res) => { if (!alive) return; if (!res.ok) setError(res.error); else { setSnapshot(res.value); setError('') } }); return () => { alive = false } }, [])

    // 最近删除记录有两种用途：恢复渠道，或只清除这条不可恢复的历史记录。
    // 已占用 ID 时不能预览恢复，但删除记录仍然可用，且不触碰当前渠道与密钥。
    const openRecord = async (row) => {
      selection.current += 1
      const token = selection.current
      setRecord(row); setRestore(null); setForget(null); setNotice(''); setError('')
      if (row.taken) return
      try {
        const res = await rpcCall('models3-restore-preview', { route: row.route })
        if (token !== selection.current) return
        if (!res.ok) setError(res.error); else setRestore(res.value)
      } catch (_) { if (token === selection.current) setError('operation-failed') }
    }
    const startForget = async (row) => {
      selection.current += 1
      const token = selection.current
      setError(''); setForgetBusy(true)
      try {
        const res = await rpcCall('models3-forget-preview', { route: row.route })
        if (token !== selection.current) return
        if (!res.ok) setError(res.error)
        else {
          const value = res.value && typeof res.value === 'object' ? res.value : {}
          setForget({ ...value, route: value.route ?? row.route, displayName: value.displayName ?? row.displayName, taken: row.taken })
        }
      } catch (_) { if (token === selection.current) setError('operation-failed') } finally { setForgetBusy(false) }
    }
    const closeRecord = () => { selection.current += 1; setRecord(null); setRestore(null); setForget(null); setError('') }
    const confirmForget = async () => {
      if (!forget || typeof forget.planId !== 'string' || !forget.planId) { setError('operation-failed'); return }
      setForgetBusy(true); setError('')
      try {
        const res = await rpcCall('models3-forget-commit', { planId: forget.planId })
        if (!res.ok) { setError(res.error); setForget(null) }
        else {
          selection.current += 1
          setForget(null); setRecord(null); setRestore(null); setNotice(tr('models.smart.forgetRecordDone'))
          void reload()
        }
      } catch (_) { setForget(null); setError('operation-failed') } finally { setForgetBusy(false) }
    }

    if (creating) return el(CreateRoute, { onBack: () => setCreating(false), onCreated: (route) => { setCreating(false); setSelected({ route, displayName: route }); void reload() }, templates: snapshot?.templates ?? [] })
    const routes = snapshot?.routes ?? []
    const active = selected ? routes.find((row) => row.route === selected.route) ?? selected : null
    const select = (row) => { if (canLeave()) setSelected(row.route === active?.route ? null : row) }

    return el('section', { style: { minWidth: 0 }, 'data-testid': 'model-providers' },
      el('style', null, `
        .dsh-model-workspace { display:flex; flex-direction:column; gap:16px; min-width:0; }
        .dsh-model-provider-card { min-width:0; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-3); margin-bottom:8px; }
        .dsh-model-content { min-width:0; padding:20px; border-top:1px solid var(--dsw-alias-border-l2); }
        .dsh-model-provider:hover { background:var(--dsw-alias-interactive-bg-hover)!important; }
        .dsh-model-provider:focus-visible { outline:2px solid var(--dsw-focus-ring-color); outline-offset:2px; }
        .dsh-model-row-name { font-size:13px; overflow-wrap:anywhere; }
        .dsh-model-row-capabilities { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        @media(max-width:640px) {
          .dsh-model-content { padding:16px 12px; }
          .dsh-model-row-copy { container-type:inline-size; }
          .dsh-model-row-name { width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; overflow-wrap:normal; font-size:clamp(10px, calc(160cqw / var(--model-name-length)), 13px); }
          .dsh-model-row-capabilities { flex-basis:100%; }
        }
      `),
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' } },
        el('div', { style: { minWidth: 0 } },
          el('h3', { style: { margin: 0, fontSize: '24px', fontWeight: 700 } }, tr('models.smart.homeTitle'))),
        el('div', { style: actions },
          el(Button, { id: 'model-routes-refresh', 'aria-label': tr('models.smart.refreshProviders'), title: tr('models.smart.refreshProviders'), onClick: () => { if (canLeave()) void reload() } }, '↻'),
          el(Button, { id: 'model-route-create', style: svcButtonStyle('primary'), onClick: () => { if (canLeave()) setCreating(true) } }, '＋ ' + tr('models.smart.createRoute'))
        )
      ),

      el(ErrorText, { error }),
      notice ? el('p', { role: 'status', 'data-testid': 'model-config-notice', style: { color: 'var(--dsw-alias-state-success-primary)', fontSize: '13px', margin: '8px 0', overflowWrap: 'anywhere' } }, notice) : null,
      snapshot === null && !error ? el('p', { style: muted }, tr('models.smart.loading')) : null,
      routes.length === 0 && snapshot !== null && !error ? el('p', { style: { ...muted, padding: '16px 0', textAlign: 'center' }, 'data-testid': 'models-empty-notice' }, tr('models.smart.noProviders')) : null,

      routes.length ? el('div', { className: 'dsh-model-workspace', 'data-testid': 'model-workspace' },
        el('div', { 'aria-label': tr('models.smart.providers'), 'data-testid': 'model-provider-list' },
          ...['builtin', 'custom'].map((source) => {
            const group = routes.filter((row) => (row.source === 'builtin' ? 'builtin' : 'custom') === source)
            return group.length ? el('section', { key: source, style: { marginBottom: '18px' } },
              el('h4', { style: { ...muted, margin: '4px 10px 12px', fontWeight: 600 } }, tr(source === 'builtin' ? 'models.smart.builtin' : 'models.smart.customProviders')),
              ...group.map((row) => el('div', { key: row.route, className: 'dsh-model-provider-card' },
                el('button', {
                  type: 'button', className: 'dsh-model-provider', 'data-testid': 'model-route-open-' + row.route,
                  'aria-expanded': active?.route === row.route, onClick: () => select(row),
                  style: { display: 'flex', width: '100%', minWidth: 0, alignItems: 'center', gap: '10px', padding: '14px 16px', borderRadius: '11px', cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--dsw-alias-label-primary)', border: 0, background: 'transparent' },
                },
                  el(ProviderIcon, { row }),
                  el('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '14px', fontWeight: 600 } }, row.displayName),
                  el('span', { title: tr(row.configured ? 'models.smart.configSaved' : 'models.smart.configInherited'), 'aria-label': tr(row.configured ? 'models.smart.configSaved' : 'models.smart.configInherited'), style: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0, background: row.enabled !== false && row.configured ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)' } }),
                  el('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true, style: { flexShrink: 0, transition: 'transform 150ms', transform: active?.route === row.route ? 'rotate(180deg)' : 'none' } }, el('path', { d: 'm6 9 6 6 6-6' }))
                ),
                active?.route === row.route ? el('div', { className: 'dsh-model-content', 'data-testid': 'model-provider-content' }, el(RouteDetail, { key: row.route, row: active, reload: () => void reload(), onModelsChanged: (current) => { setSelected(current); void reload() }, onBack: () => { setSelected(null); void reload() } })) : null
              ))) : null
          })
        )
      ) : null,

      // Removed routes section
      (snapshot?.removedRoutes ?? []).length ? el('section', { 'data-testid': 'model-removed-routes', style: { marginTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: '12px' } },
        el('h4', { style: { margin: '0 0 8px 0', fontSize: '13px' } }, tr('models.smart.deleted')),
        ...snapshot.removedRoutes.map((row) => el(Button, {
          key: row.route, id: 'model-removed-' + row.route, style: { marginRight: '6px' },
          title: row.taken ? tr('models.smart.forgetRecordTaken').replace('{route}', row.route) : undefined,
          onClick: () => void openRecord(row),
        }, row.displayName))
      ) : null,

      record ? el('section', { style: { ...subCard, marginTop: '12px' }, 'data-testid': 'model-removed-record' },
        el('h4', { style: { margin: '0 0 6px 0', fontSize: '13px' } }, tr('models.smart.consequences')),
        el('p', { style: { ...muted, overflowWrap: 'anywhere' } }, record.displayName || record.route),
        el('code', { style: { display: 'block', fontSize: '12px', marginBottom: '8px', overflowWrap: 'anywhere' } }, record.route),
        record.taken ? el('p', { role: 'alert', 'data-testid': 'model-removed-taken', style: { ...muted, color: 'var(--dsw-alias-state-warn-primary)', margin: '0 0 8px' } }, tr('models.smart.forgetRecordTaken').replace('{route}', record.route)) : null,
        restore ? el('p', { style: muted }, tr('models.smart.credentialRetained')) : null,
        el('div', { style: actions },
          restore ? el(Button, { id: 'model-restore-confirm', style: svcButtonStyle('primary'), disabled: forgetBusy, onClick: async () => {
            const res = await rpcCall('models3-restore-commit', { planId: restore.planId })
            if (!res.ok) setError(res.error)
            else { selection.current += 1; setRestore(null); setRecord(null); void reload() }
          } }, tr('models.smart.confirm')) : null,
          el(Button, { id: 'model-forget-open', danger: true, disabled: forgetBusy, onClick: () => void startForget(record) }, tr('models.smart.forgetRecordOpen')),
          el(Button, { disabled: forgetBusy, onClick: closeRecord }, tr('models.smart.cancel'))
        )
      ) : null,

      forget ? el(Modal, {
        open: true,
        title: tr('models.smart.forgetRecordTitle'),
        closeLabel: tr('models.smart.cancel'),
        onClose: () => { if (!forgetBusy) setForget(null) },
        footer: [
          el(Button, { disabled: forgetBusy, onClick: () => setForget(null) }, tr('models.smart.cancel')),
          el(Button, { id: 'model-forget-confirm', danger: true, disabled: forgetBusy, onClick: () => void confirmForget() }, tr('models.smart.forgetRecordConfirm')),
        ],
      }, el('div', { 'data-testid': 'model-forget-dialog' },
        el('p', { style: { margin: '0 0 8px', fontSize: '13px', overflowWrap: 'anywhere' } }, tr('models.smart.forgetRecordPrompt').replace('{name}', forget.displayName || forget.route)),
        el('code', { style: { display: 'block', fontSize: '12px', marginBottom: '8px', overflowWrap: 'anywhere' } }, forget.route),
        el('p', { role: 'alert', style: { ...muted, color: 'var(--dsw-alias-state-error-primary)', margin: '8px 0' } }, tr('models.smart.forgetRecordBoundary')),
        forget.taken ? el('p', { 'data-testid': 'model-forget-taken', style: { ...muted, margin: '8px 0' } }, tr('models.smart.forgetRecordTaken').replace('{route}', forget.route)) : null
      )) : null
    )
  }

  function ModelsSection({ SubagentSection }) {
    const tr = useTranslation()
    const { value: features } = useFeatures()
    const [modelsNav, setModelsNav] = modelsNavToggle ? modelsNavToggle.useEnabled() : [false, () => {}]
    const [tab, setTab] = useState('providers')
    const items = [...(features.modelCatalog !== false ? [{ id: 'providers', label: tr('tabs.providers') }] : []), ...(features.subagentRoute !== false ? [{ id: 'subagent', label: tr('tabs.subagentRoute') }] : [])]
    const active = items.some((x) => x.id === tab) ? tab : items[0]?.id
    const navSwitchRow = modelsNavToggle ? el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', marginBottom: '4px' } },
      el('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } }, tr('models.navToggleHint')),
      el('button', {
        type: 'button',
        role: 'switch',
        'data-testid': 'models-nav-switch',
        'aria-checked': String(modelsNav),
        'aria-label': tr('models.navToggle'),
        title: tr('models.navToggle'),
        onClick: () => setModelsNav(!modelsNav),
        style: { width: '34px', height: '20px', ...fullRound('10px'), padding: 0, flexShrink: 0, position: 'relative', border: `1px solid ${modelsNav ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-border-l2)'}`, background: modelsNav ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-bg-layer-2)', cursor: 'pointer', lineHeight: 0 },
      }, el('span', { style: { position: 'absolute', top: '1px', left: modelsNav ? '15px' : '1px', width: '16px', height: '16px', ...fullRound('50%'), background: modelsNav ? '#fff' : 'var(--dsw-alias-label-tertiary)' } }))
    ) : null
    return el('div', { 'data-testid': 'models-page', 'data-dshsvc-root': '' },
      navSwitchRow,
      items.length > 1 ? el(SvcTabs, { items, activeId: active, onChange: (id) => { if (canLeave()) setTab(id) }, testIdPrefix: 'models-tab', variant: 'sub', ariaLabel: tr('tabs.models') }) : null,
      active === 'providers' ? el(Providers, null) : active === 'subagent' ? el(SubagentSection, null) : null
    )
  }

  return { ModelsSection, canLeave, ModelDetail, RouteDetail, parseDraft, capacity, formatCapacity }
}
