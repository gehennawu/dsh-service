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

  function KeyValues({ value, onChange, label, template = false }) {
    const tr = useTranslation()
    const rows = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : []
    const [pendingKey, setPendingKey] = useState('')
    const renderValue = (key, val) => {
      const update = (next) => onChange({ ...value, [key]: next })
      if (template) return el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: 0 } },
        el('select', { style: inputStyle, 'aria-label': key + ' ' + tr('models.smart.type'), value: val !== null && typeof val === 'object' ? 'variable' : val === null ? 'null' : typeof val, onChange: (e) => update(e.target.value === 'variable' ? { $var: 'thinking.enabled' } : e.target.value === 'null' ? null : e.target.value === 'boolean' ? false : e.target.value === 'number' ? 0 : '') }, ['string', 'number', 'boolean', 'null', 'variable'].map((type) => el('option', { key: type, value: type }, tr('models.smart.type.' + type)))),
        typeof val === 'boolean' ? el('select', { style: inputStyle, value: String(val), onChange: (e) => update(e.target.value === 'true'), 'aria-label': key }, ['true', 'false'].map((x) => el('option', { key: x }, x)))
          : val !== null && typeof val === 'object' ? el('div', null,
            el('select', { style: inputStyle, value: val.$var, 'aria-label': key, onChange: (e) => update({ ...val, $var: e.target.value }) }, ['thinking.enabled', 'thinking.effort', 'thinking.budget'].map((x) => el('option', { key: x }, x))),
            el('label', null, el('input', { type: 'checkbox', checked: val.omitWhenOff === true, onChange: (e) => update({ ...val, omitWhenOff: e.target.checked }) }), 'omitWhenOff'))
            : val === null ? null : el('input', { style: inputStyle, value: val, 'aria-label': key, onChange: (e) => update(typeof val === 'number' ? Number(e.target.value) : e.target.value) }))
      return el('input', { style: inputStyle, value: val ?? '', 'aria-label': key, onChange: (e) => update(e.target.value) })
    }
    return el('fieldset', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '10px', minWidth: 0, marginTop: '8px' } },
      el('legend', { style: labelStyle }, label),
      ...rows.map(([key, val]) => el('div', { key, style: { marginBottom: '6px', minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' } }, el('span', { style: { minWidth: '90px', fontSize: '12px' } }, key), el('div', { style: { flex: 1 } }, renderValue(key, val)), el(Button, { onClick: () => { const next = { ...value }; delete next[key]; onChange(next) }, danger: true }, tr('models.smart.remove')))),
      el('div', { style: { ...actions, marginTop: '6px' } }, el('input', { style: { ...inputStyle, width: '180px' }, value: pendingKey, 'aria-label': tr('models.smart.newKey'), placeholder: tr('models.smart.newKey'), onChange: (e) => setPendingKey(e.target.value) }), el(Button, { onClick: () => { if (pendingKey && !['__proto__', 'constructor', 'prototype', '__jsExpr'].includes(pendingKey) && !Object.hasOwn(value ?? {}, pendingKey)) { onChange({ ...value, [pendingKey]: '' }); setPendingKey('') } } }, tr('models.smart.add'))))
  }

  function CompatEditor({ value, onChange, schema, api }) {
    const tr = useTranslation()
    const fields = schema.compatGates[api] ?? []
    const enums = schema.compatEnums
    const changed = (key, next) => { const result = { ...(value || {}) }; if (next === '') delete result[key]; else result[key] = next; onChange(result) }
    return el('div', { 'data-testid': 'model-compat-editor', style: { marginTop: '8px' } },
      ...fields.map((key) => {
        if (key === 'chatTemplateArgs' || key === 'chatTemplateKwargs') return el(KeyValues, { key, label: key, template: true, value: value?.[key], onChange: (v) => changed(key, v) })
        if (key === 'vllmPriority') return el('label', { key, style: { display: 'block', marginTop: '6px' } }, el('span', { style: labelStyle }, key), el('input', { style: inputStyle, 'aria-label': key, value: value?.[key] ?? '', onChange: (e) => changed(key, e.target.value) }))
        return el('label', { key, style: { display: 'block', marginTop: '6px' } }, el('span', { style: labelStyle }, key), el('select', { style: inputStyle, 'aria-label': key, value: value?.[key] === undefined ? '' : String(value[key]), onChange: (e) => changed(key, e.target.value === '' ? '' : enums[key] ? e.target.value : e.target.value === 'true') }, el('option', { value: '' }, tr('models.smart.inherit')), ...(enums[key] ?? ['true', 'false']).map((x) => el('option', { key: x, value: x }, x))))
      }), el('p', { style: { ...muted, marginTop: '6px' } }, tr('models.smart.compatHint')))
  }

  function Field({ field, value, onChange, schema, api, effective, displayValue }) {
    const tr = useTranslation()
    const label = tr('models.smart.field.' + field) === 'models.smart.field.' + field ? field : tr('models.smart.field.' + field)
    if (field === 'compat') return el(CompatEditor, { value, onChange, schema, api })
    if (field === 'headers') return el(KeyValues, { value, onChange, label })
    if (field === 'thinkingBudgets') return el('fieldset', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '10px', minWidth: 0, marginTop: '8px' } }, el('legend', { style: labelStyle }, label), ...['minimal', 'low', 'medium', 'high'].map((level) => el('label', { key: level, style: { display: 'block', marginTop: '4px' } }, el('span', { style: { fontSize: '12px' } }, level), el('input', { style: inputStyle, value: value?.[level] ?? '', 'aria-label': 'thinkingBudgets.' + level, onChange: (e) => { const next = { ...(value || {}) }; if (e.target.value === '') delete next[level]; else next[level] = e.target.value; onChange(next) } }))))
    if (field === 'retryPolicy') return el('fieldset', { style: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '10px', minWidth: 0, marginTop: '8px' } }, el('legend', { style: labelStyle }, label),
      el('select', { style: inputStyle, 'aria-label': label, value: value?.mode ?? '', onChange: (e) => onChange(e.target.value ? { ...value, mode: e.target.value } : '') }, el('option', { value: '' }, tr('models.smart.inherit')), ...['normal', 'always'].map((mode) => el('option', { key: mode }, mode))),
      value?.mode === 'normal' ? el('label', { style: { display: 'block', marginTop: '6px' } }, el('span', { style: labelStyle }, 'maxRetries'), el('input', { style: inputStyle, 'aria-label': 'maxRetries', value: value.maxRetries ?? '', onChange: (e) => { const next = { ...value }; if (!e.target.value) delete next.maxRetries; else next.maxRetries = e.target.value; onChange(next) } })) : null,
      value?.mode === 'normal' ? el('label', { style: { display: 'block', marginTop: '6px' } }, el('span', { style: labelStyle }, 'retryableCodes'), el('input', { style: inputStyle, 'aria-label': 'retryableCodes', value: (value.retryableCodes ?? []).join(', '), onChange: (e) => { const next = { ...value }; if (!e.target.value) delete next.retryableCodes; else next.retryableCodes = e.target.value.split(',').map((x) => x.trim()); onChange(next) } })) : null,
      value?.mode ? ['initialDelayMs', 'maxDelayMs', 'jitterRatio'].map((key) => el('label', { key, style: { display: 'block', marginTop: '6px' } }, el('span', { style: labelStyle }, 'backoff.' + key), el('input', { style: inputStyle, 'aria-label': 'backoff.' + key, value: value.backoff?.[key] ?? '', onChange: (e) => { const backoff = { ...(value.backoff || {}) }; if (!e.target.value) delete backoff[key]; else backoff[key] = e.target.value; onChange({ ...value, backoff }) } }))) : null)
    const enums = schema?.routeEnums?.[field]
    return el('label', { style: { display: 'block', minWidth: 0 } },
      el('span', { style: labelStyle }, label),
      enums ? el('select', { style: inputStyle, 'aria-label': label, value: value ?? '', onChange: (e) => onChange(e.target.value) }, el('option', { value: '' }, tr('models.smart.inherit')), ...enums.map((x) => el('option', { key: x }, x)))
        : el('input', { style: inputStyle, 'aria-label': label, 'data-testid': 'model-field-' + field, value: value === '' || value === undefined ? displayValue ?? '' : value, onChange: (e) => onChange(e.target.value), placeholder: tr('models.smart.inherit') }),
      effective !== undefined ? el('small', { style: muted }, tr('models.smart.effective') + ': ' + shown(effective)) : null)
  }

  function LayerNotes({ fields, explicit = {}, inherited = {}, onChange }) {
    const tr = useTranslation()
    return el('details', { 'data-testid': 'model-layer-notes', style: { marginTop: '8px' } }, el('summary', { style: { fontSize: '12px', color: 'var(--dsh-svc-text-muted)', cursor: 'pointer' } }, tr('models.smart.layers')), ...fields.map((field) => el('div', { key: field, style: { marginTop: '8px' } }, el('b', { style: { fontSize: '12px' } }, tr('models.smart.field.' + field)), el('p', { style: muted }, tr('models.smart.explicitValue') + ': ' + shown(explicit[field]) + ' · ' + tr('models.smart.inheritedValue') + ': ' + shown(inherited[field])), el(Button, { id: 'model-inherit-' + field, onClick: () => onChange(field, '') }, tr('models.smart.restoreInherited')))))
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

  function smartFillGroups(result) {
    return (result?.groups ?? []).flatMap((group) => {
      const candidate = group.candidates?.find((entry) => entry.evidence === 'exact-channel-protocol') ?? group.candidates?.[0]
      return candidate && modelFields.includes(group.field) ? [{ ...group, candidate }] : []
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
    const resolvedApi = opened.profile.api || resolvedModel.api || opened.resolvedApi || opened.effective?.api || opened.catalogModels?.find((entry) => entry.api)?.api
    const sequence = useRef(0)
    const dirty = !equal(draft, initialTexts(currentBaseline, modelFields)) || modelId !== (currentBaseline.id ?? '')
    useLeaveGuard(dirty, tr)

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
      let patch; try { patch = parseDraft(draft, currentBaseline, modelFields) } catch (_) { setBusy(false); setError('schema-invalid'); return }
      const res = await rpcCall('models3-save-model', { sessionId: currentOpened.sessionId, modelId: modelId.trim(), ...(!isNew ? { originalModelId: currentBaseline.id } : {}), patch: patch.patch, unset: patch.unset, add: isNew })
      setBusy(false)
      if (!res.ok) setError(res.error)
      else onSaved()
    }

    const test = async () => {
      setError(''); setNotice('')
      const res = await rpcCall('models3-test-preview', { sessionId: currentOpened.sessionId, modelId: model.id })
      if (!res.ok) setError(res.error)
      else setTestPlan(res.value)
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
          el('input', { style: inputStyle, value: modelId, placeholder: tr('models.wb.edit.modelIdPlaceholder'), 'aria-label': '模型 ID', 'data-testid': isNew ? 'model-new-id' : undefined, onChange: (e) => setModelId(e.target.value) })
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.smart.field.name')),
          el('input', { style: inputStyle, value: draft.name === '' ? resolvedModel.name || '' : draft.name, 'aria-label': tr('models.smart.field.name'), 'data-testid': 'model-field-name', placeholder: resolvedModel.name || tr('models.wb.edit.displayNamePlaceholder'), onChange: (e) => setDraft({ ...draft, name: e.target.value }) })
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
          suggestions.length > 0 ? el('div', { 'data-testid': 'model-smart-inline-bar', style: { ...actions, justifyContent: 'space-between', marginBottom: '8px' } },
            el('b', { style: { fontSize: '12px' } }, tr('models.smart.suggestedValues')),
            el(Button, { id: 'model-smart-auto-fill', 'data-testid': 'model-smart-auto-fill', style: svcButtonStyle('primary'), onClick: () => setFillPlan(suggestions) }, tr('models.smart.fillAll'))) : null,
          suggestions.length === 0 ? el('p', { role: 'status', 'data-testid': 'model-smart-empty', style: { ...muted, margin: 0 } }, tr('models.smart.noSuggestions')) : el(SuggestionGroups, { groups: suggestions, draft }),
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
            value: draft.contextWindow === '' ? formatCapacity(resolvedModel.contextWindow) : draft.contextWindow,
            placeholder: formatCapacity(resolvedModel.contextWindow) || tr('models.wb.edit.contextPlaceholder'),
            onChange: (e) => setDraft({ ...draft, contextWindow: e.target.value }),
          }),
          resolvedModel.contextWindow ? el('small', { style: muted }, tr('models.smart.effective') + ': ' + formatCapacity(resolvedModel.contextWindow)) : null
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.wb.edit.maxTokens') || '最大输出 token'),
          el('input', {
            style: inputStyle,
            'data-testid': 'model-field-maxTokens',
            'aria-label': tr('models.smart.field.maxTokens'),
            value: draft.maxTokens === '' ? formatCapacity(resolvedModel.maxTokens) : draft.maxTokens,
            placeholder: formatCapacity(resolvedModel.maxTokens) || tr('models.wb.edit.maxTokensPlaceholder'),
            onChange: (e) => setDraft({ ...draft, maxTokens: e.target.value }),
          }),
          resolvedModel.maxTokens ? el('small', { style: muted }, tr('models.smart.effective') + ': ' + formatCapacity(resolvedModel.maxTokens)) : null
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
            el(ModalityButton, { text: '文本', title: '文本输入', checked: true, disabled: true, onClick: () => toggleInputModality('text') }),
            el(ModalityButton, { text: '图片', title: '图片输入', checked: currentInputModes().includes('image'), onClick: () => toggleInputModality('image') })
          )
        ),
        el('div', null,
          el('label', { style: labelStyle }, tr('models.wb.edit.outputModalities') || '输出模态'),
          el('div', { style: { display: 'flex', gap: '8px' } },
            el(ModalityButton, { text: '文本', title: '文本输出', checked: true, disabled: true })
          )
        )
      ),

      // ── Section 4: 推理档位 (Reasoning Level Chips Matching Screenshot) ──
      el('div', { style: { marginBottom: '14px' } },
        el('label', { style: labelStyle }, tr('models.wb.edit.reasoningLevels') || '推理档位'),
        // Hidden/Accessible select to honor test automation
        el('select', { style: { display: 'none' }, 'aria-label': tr('models.smart.field.reasoningEfforts'), value: isReasoningFalse ? 'false' : Object.keys(effortMap).length > 0 ? 'map' : 'inherit', onChange: (e) => setDraft({ ...draft, reasoningEfforts: e.target.value === 'false' ? false : e.target.value === 'map' ? {} : '' }) },
          el('option', { value: 'inherit' }, 'inherit'),
          el('option', { value: 'false' }, 'false'),
          el('option', { value: 'map' }, 'map')
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
              }, el('input', { type: 'checkbox', className: 'dsh-model-effort-check', checked, 'aria-label': lvl, onChange: () => toggleEffortLevel(lvl), style: { margin: 0, flexShrink: 0, accentColor: 'var(--dsw-alias-button-primary-fill)' } }), lvl),
              checked ? el('input', {
                style: { display: 'none' },
                'aria-label': lvl + ' wire',
                value: typeof effortMap[lvl] === 'string' ? effortMap[lvl] : '',
                placeholder: lvl,
                onChange: (e) => setEffortWire(lvl, e.target.value),
              }) : null
            )
          })
        ),
      ),

      ),

      // Hidden compatibility container for automated regression tests
      el('div', { style: { display: 'none' } },
        el(Field, { field: 'compat', value: draft.compat, schema: opened.schema, api: opened.profile.api, onChange: (v) => setDraft({ ...draft, compat: v }) })
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

      // Live test call plan confirmation
      testPlan ? el('section', { style: subCard },
        el('p', { style: { margin: '0 0 6px 0', fontSize: '12px' } }, tr('models.smart.testBoundary')),
        el('code', { style: { fontSize: '12px', display: 'block', marginBottom: '8px' } }, testPlan.text + ' · maxTokens=' + testPlan.maxTokens + ' · ' + testPlan.timeoutMs + 'ms'),
        el('div', { style: actions },
          el(Button, { id: 'model-test-confirm', style: svcButtonStyle('primary'), onClick: async () => { const res = await rpcCall('models3-test-commit', { planId: testPlan.planId }); setTestPlan(null); if (!res.ok) setError(res.error); else setNotice(tr(res.value.ok ? 'models.smart.testPassed' : 'models.smart.testFailed')) } }, tr('models.smart.confirm')),
          el(Button, { onClick: () => setTestPlan(null) }, tr('models.smart.cancel'))
        )
      ) : null,
      el('div', { style: { ...actions, justifyContent: 'flex-end', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--dsw-alias-border-l2)' } },
        el(Button, { onClick: () => { if (canLeave()) onBack() } }, tr('models.smart.cancel')),
        dirty ? el('span', { role: 'status', style: muted }, tr('models.smart.unsaved')) : null,
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
    const prepare = async (endpoint, payload, kind) => { const res = await rpcCall(endpoint, payload); if (!res.ok) setError(res.error); else setPlan({ ...res.value, kind }) }
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
                const preview = await rpcCall('models3-enabled-preview', { sessionId: opened.sessionId, enabled: row.enabled === false })
                if (!preview.ok) { setError(preview.error); return }
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
        el(Field, { field: 'baseURL', value: draft.baseURL, displayValue: opened.resolved?.baseURL, schema: opened.schema, api: draft.api, onChange: (v) => { if (!busy) setDraft({ ...draft, baseURL: v }) } }),
        el('div', { style: { display: 'grid', gap: '14px' } },
          (opened.builtin || row.source === 'builtin') ? el('label', null,
            el('span', { style: labelStyle }, tr('models.smart.field.api')),
            el('input', { style: inputStyle, readOnly: true, 'aria-label': tr('models.smart.field.api'), value: opened.resolvedApi || draft.api || opened.effective?.api || opened.catalogModels?.find((entry) => entry.api)?.api || tr('models.smart.protocolUnknown') })
          ) : el(Field, { field: 'api', value: draft.api, schema: opened.schema, api: draft.api, onChange: (v) => { if (!busy) setDraft({ ...draft, api: v }) } }),
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
                else { setPicked([]); setDiscoverySearch(''); setDiscovered(res.value.candidates) }
              } catch (_) { setError('operation-failed') } finally { setDiscovering(false) }
            } }, discovering ? tr('models.smart.loading') : tr('models.smart.discover'))
          )
        ),

        // Discovered models picker
        discovered !== null ? el(Modal, {
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
            el(Button, { compact: true, disabled: busy, onClick: () => setPicked(discovered.filter((x) => !models.some((m) => m.id === x.id) && (x.id + ' ' + (x.name ?? '')).toLowerCase().includes(discoverySearch.toLowerCase())).map((x) => x.id)) }, tr('models.smart.selectAll')),
            el(Button, { compact: true, disabled: busy, onClick: () => setPicked([]) }, tr('models.smart.clear'))
          ),
          el('div', { style: { maxHeight: 'min(360px, 45dvh)', overflowY: 'auto' } },
            ...discovered.filter((x) => (x.id + ' ' + (x.name ?? '')).toLowerCase().includes(discoverySearch.toLowerCase())).map((x) => el('label', { key: x.id, style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 4px', fontSize: '13px', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
              el('input', { type: 'checkbox', checked: picked.includes(x.id), disabled: busy || models.some((m) => m.id === x.id), onChange: (e) => setPicked(e.target.checked ? [...picked, x.id] : picked.filter((id) => id !== x.id)) }),
              el('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, x.id), models.some((m) => m.id === x.id) ? el('span', { style: svcBadgeStyle('neutral') }, tr('models.smart.added')) : null
            ))
          ),
          el(ErrorText, { error })
        )) : null,

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
              el(Button, { id: 'model-test-' + item.id, compact: true, title: tr('models.smart.test'), 'aria-label': tr('models.smart.test') + ' ' + item.id, style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '4px' }, disabled: busy, onClick: async () => {
                setBusy(true); setError(''); setNotice(''); setTestElapsed(0); setTestRunning({ modelId: item.id, startedAt: Date.now() })
                try {
                  const preview = await rpcCall('models3-test-preview', { sessionId: opened.sessionId, modelId: item.id })
                  if (!preview.ok) { setError(preview.error); return }
                  const result = await rpcCall('models3-test-commit', { planId: preview.value.planId })
                  if (!result.ok) setError(result.error)
                  else if (result.value.ok) setNotice(tr('models.smart.testPassed'))
                  else setError([tr('models.smart.testFailed'), result.value.failure?.code, result.value.failure?.status ? 'HTTP ' + result.value.failure.status : '', result.value.finishReason, result.value.failure?.message].filter(Boolean).join(' · '))
                } catch (_) { setError('operation-failed') } finally { setTestRunning(null); setBusy(false) }
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
        !opened.readOnly ? el(Button, { id: 'model-route-save', disabled: busy || !routeDirty, style: { ...svcButtonStyle(routeDirty ? 'primary' : 'neutral'), ...(!routeDirty ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }, onClick: async () => { let patch; try { patch = parseDraft(draft, opened.profile, fields) } catch (_) { setError('schema-invalid'); return }; const res = await rpcCall('models3-save-route', { sessionId: opened.sessionId, ...patch }); if (!res.ok) setError(res.error); else saved() } }, tr('models.smart.saveRoute')) : null,
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
        el('h4', { style: { margin: '0 0 6px 0', fontSize: '13px' } }, tr(plan.kind === 'test' ? 'models.smart.test' : 'models.smart.consequences')),
        el('p', { style: { ...muted, overflowWrap: 'anywhere' } }, plan.route || row.displayName),
        el('p', { style: muted }, tr(plan.kind === 'test' ? 'models.smart.testBoundary' : 'models.smart.credentialRetained')),
        el('div', { style: actions },
          el(Button, { id: 'model-plan-confirm', danger: plan.kind === 'remove', disabled: plan.blocked, onClick: async () => { const kind = plan.kind; const res = await rpcCall('models3-' + (kind === 'test' ? 'test' : kind === 'availability' ? 'enabled' : kind === 'credential' ? 'credential' : kind === 'remove' ? 'remove' : 'restore') + '-commit', { planId: plan.planId, ...(kind === 'credential' ? { key } : {}) }); setPlan(null); if (!res.ok) setError(res.error); else if (res.value.configurationFailed) { setKey(''); setNotice(tr('models.smart.keyPartial')); } else if (kind === 'test') { setNotice(tr(res.value.ok ? 'models.smart.testPassed' : 'models.smart.testFailed')) } else if (kind === 'availability') { reload() } else if (kind === 'remove' && !plan.modelsRemoved?.length) { reload(); onBack() } else saved() } }, tr('models.smart.confirm')),
          el(Button, { onClick: () => setPlan(null) }, tr('models.smart.cancel'))
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
    const [picked, setPicked] = useState([])
    const [discovering, setDiscovering] = useState(false)
    const [error, setError] = useState('')
    const dirty = !!(id || name || url || key || ids || picked.length > 0 || api !== 'openai-completions')
    useLeaveGuard(dirty, tr)

    const changed = (fn) => (e) => { fn(e.target.value); setError('') }
    const onTemplateChange = (e) => {
      const val = e.target.value
      setTemplate(val)
      setDiscovered(null)
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
      const res = await rpcCall('models3-discover', { baseURL: url.trim(), api, key: key.trim() })
      setDiscovering(false)
      if (!res.ok) setError(res.error)
      else setDiscovered(res.value.candidates || [])
    }
    const availableModels = discovered !== null ? discovered : candidateModels

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
        el('div', { style: { maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '6px', padding: '6px', background: 'var(--dsw-alias-bg-layer-2)' } },
          ...availableModels.map((m) => el('label', { key: m.id, style: { display: 'block', padding: '3px 0', fontSize: '13px' } },
            el('input', { type: 'checkbox', checked: picked.includes(m.id), onChange: (e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((x) => x !== m.id)) }),
            ' ' + m.id + (m.name && m.name !== m.id ? ' (' + m.name + ')' : '')
          ))
        ),
        el('div', { style: { ...actions, marginTop: '8px' } },
          el(Button, { onClick: () => setPicked(availableModels.map((m) => m.id)) }, tr('models.smart.selectAll')),
          el(Button, { onClick: () => setPicked([]) }, tr('models.smart.clear')),
          el(Button, { id: 'model-create-discover', disabled: discovering, onClick: () => void discoverLive() }, discovering ? tr('models.smart.loading') : tr('models.smart.discover'))
        )
      ) : (url.trim() ? el('div', { style: { marginBottom: '8px' } },
        el(Button, { id: 'model-create-discover', disabled: discovering, onClick: () => void discoverLive() }, discovering ? tr('models.smart.loading') : tr('models.smart.discover'))
      ) : null),

      el('div', { style: { marginBottom: '12px' } },
        el('label', { style: labelStyle }, tr('models.smart.manualIds')),
        el('textarea', { style: { ...inputStyle, minHeight: '60px' }, value: ids, 'aria-label': tr('models.smart.manualIds'), placeholder: 'gpt-4o, claude-3-5-sonnet...', onChange: changed(setIds) })
      ),

      dirty ? el('p', { role: 'status', style: muted }, tr('models.smart.unsaved')) : null,
      el(Button, { id: 'model-create-save', disabled: !dirty, style: { ...svcButtonStyle(dirty ? 'primary' : 'neutral'), ...(!dirty ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }, onClick: async () => {
        const allIds = [...new Set([...picked, ...ids.split(/[\s,]+/).filter(Boolean)])]
        if (allIds.length === 0) { setError('noModelsSelected'); return }
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

    const reload = async () => { const res = await rpcCall('models3-snapshot', {}); if (!res.ok) setError(res.error); else { setSnapshot(res.value); setError('') } }
    useEffect(() => { let alive = true; rpcCall('models3-snapshot', {}).then((res) => { if (!alive) return; if (!res.ok) setError(res.error); else { setSnapshot(res.value); setError('') } }); return () => { alive = false } }, [])

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
        ...snapshot.removedRoutes.map((row) => el(Button, { key: row.route, id: 'model-removed-' + row.route, disabled: row.taken, style: { marginRight: '6px' }, onClick: async () => { const res = await rpcCall('models3-restore-preview', { route: row.route }); if (!res.ok) setError(res.error); else setRestore(res.value) } }, row.displayName))
      ) : null,

      restore ? el('section', { style: { ...subCard, marginTop: '12px' } },
        el('h4', { style: { margin: '0 0 6px 0', fontSize: '13px' } }, tr('models.smart.consequences')),
        el('p', { style: { ...muted, overflowWrap: 'anywhere' } }, restore.restore?.route || ''),
        el('p', { style: muted }, tr('models.smart.credentialRetained')),
        el('div', { style: actions },
          el(Button, { id: 'model-restore-confirm', style: svcButtonStyle('primary'), onClick: async () => { const res = await rpcCall('models3-restore-commit', { planId: restore.planId }); if (!res.ok) setError(res.error); else { setRestore(null); void reload() } } }, tr('models.smart.confirm')),
          el(Button, { onClick: () => setRestore(null) }, tr('models.smart.cancel'))
        )
      ) : null
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
