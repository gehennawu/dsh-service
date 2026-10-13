// Editable vocabulary for pi-ai Profile configuration, not a projection of defaults.
export const MODEL_FIELDS = ['name', 'contextWindow', 'maxTokens', 'input', 'reasoningEfforts', 'compat']
export const ROUTE_FIELDS = ['displayName', 'api', 'baseURL', 'apiKeyEnv', 'defaultContextWindow', 'defaultMaxTokens', 'defaultInput', 'compat', 'headers', 'reasoning', 'thinkingBudgets', 'cacheRetention', 'transport', 'timeoutMs', 'websocketConnectTimeoutMs', 'streamIdleTimeoutMs', 'maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes', 'retryPolicy']
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages']
const completions = ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason', 'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages', 'thinkingFormat', 'chatTemplateKwargs', 'chatTemplateArgs', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField', 'vllmPriority', 'supportsStrictMode', 'cacheControlFormat', 'supportsLongCacheRetention']
const responses = ['supportsDeveloperRole', 'supportsMaxOutputTokens', 'supportsStrictMode', 'supportsLongCacheRetention']
export const COMPAT_GATES = {
  'openai-completions': completions,
  'openai-responses': responses,
  'azure-openai-responses': responses,
  'openai-codex-responses': responses,
  'anthropic-messages': ['supportsEagerToolInputStreaming', 'supportsLongCacheRetention', 'supportsCacheControlOnTools', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools'],
  'bedrock-converse-stream': ['supportsStrictMode'],
}
export const COMPAT_ENUMS = {
  maxTokensField: ['max_completion_tokens', 'max_tokens'],
  thinkingFormat: ['openai', 'deepseek', 'openrouter', 'together', 'baseten', 'zai', 'qwen', 'chat-template', 'qwen-chat-template', 'string-thinking', 'ant-ling'],
  thinkingTokenBudgetField: ['thinking_token_budget', 'thinking_budget', 'thinking_budget_tokens'],
  cacheControlFormat: ['anthropic'],
}
export const ROUTE_ENUMS = { api: PROTOCOLS, reasoning: LEVELS, cacheRetention: ['none', 'short', 'long'], transport: ['sse', 'websocket', 'websocket-cached', 'auto'] }
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
const reserved = new Set(['__proto__', 'prototype', 'constructor', '__jsExpr'])
const fail = (code = 'schema-invalid') => { throw new Error(code) }
const positive = (n) => Number.isSafeInteger(n) && n > 0
const timer = (n) => Number.isFinite(n) && n > 0 && n <= 2147483647

// Header names use the RFC token alphabet. Normalize punctuation as well as case
// so credential-like variants cannot evade masking by spelling differences.
export function sensitiveHeader(name) {
  const normalized = String(name).toLowerCase().replace(/[^a-z0-9]/g, '')
  return /authorization|cookie|apikey|token|secret|credential|password|signature/.test(normalized)
}
export function safeHeaderName(name) {
  return typeof name === 'string' && /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) && !reserved.has(name)
}
export function containsSensitive(value) {
  if (Array.isArray(value)) return value.some(containsSensitive)
  if (!object(value)) return false
  return Object.entries(value).some(([key, child]) => reserved.has(key) || (key !== 'apiKeyEnv' && /secret|password|credential|authorization|cookie|token|apikey/i.test(key) && !['maxTokens', 'defaultMaxTokens', 'maxTokensField', 'supportsMaxOutputTokens', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField'].includes(key) && !(/^(input|output|maxOutput|prompt|completion|cached|total)Tokens$/i.test(key) && typeof child === 'number' && Number.isFinite(child))) || (key === 'headers' && object(child) && Object.keys(child).some(sensitiveHeader)) || containsSensitive(child))
}
export function displayProfile(raw) {
  if (!object(raw)) return {}
  const result = {}
  for (const key of ROUTE_FIELDS) {
    if (raw[key] === undefined) continue
    if (key === 'headers') {
      result.headers = Object.fromEntries(Object.entries(raw.headers ?? {}).filter(([name]) => safeHeaderName(name) && !sensitiveHeader(name)))
      result.maskedHeaders = Object.keys(raw.headers ?? {}).filter(sensitiveHeader).map(() => '••••')
    } else if (key === 'compat' || key === 'thinkingBudgets' || key === 'retryPolicy') {
      result[key] = containsSensitive(raw[key]) ? {} : structuredClone(raw[key])
    } else result[key] = structuredClone(raw[key])
  }
  result.models = (Array.isArray(raw.models) ? raw.models : []).map((model) => {
    const row = { id: model.id }
    for (const key of MODEL_FIELDS) if (model[key] !== undefined && !containsSensitive(model[key])) row[key] = structuredClone(model[key])
    return row
  })
  result.hasModelOverrides = object(raw.modelOverrides) && Object.keys(raw.modelOverrides).length > 0
  return result
}
function validateTemplate(values) {
  if (!object(values)) fail()
  for (const [key, value] of Object.entries(values)) {
    if (reserved.has(key) || key.length > 128) fail()
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) continue
    if (!object(value) || Object.keys(value).some((k) => !['$var', 'omitWhenOff'].includes(k)) || !['thinking.enabled', 'thinking.effort', 'thinking.budget'].includes(value.$var) || value.omitWhenOff !== undefined && typeof value.omitWhenOff !== 'boolean') fail()
  }
}
export function validateCompat(value, api, previous = {}) {
  if (!object(value)) fail()
  for (const [key, val] of Object.entries(value)) {
    // Untouched unknown keys remain available in the raw baseline, never editors.
    if (JSON.stringify(previous?.[key]) === JSON.stringify(val)) continue
    if (!(COMPAT_GATES[api] ?? []).includes(key)) fail('compat-not-offered')
    if (COMPAT_ENUMS[key]) { if (!COMPAT_ENUMS[key].includes(val)) fail(); continue }
    if (key === 'vllmPriority') { if (!Number.isSafeInteger(val)) fail(); continue }
    if (key === 'chatTemplateArgs' || key === 'chatTemplateKwargs') { validateTemplate(val); continue }
    if (typeof val !== 'boolean') fail()
  }
}
export function validateField(field, value, { api, previous } = {}) {
  if (value === undefined) return
  if (ROUTE_ENUMS[field]) { if (!ROUTE_ENUMS[field].includes(value)) fail(); return }
  if (field === 'name' || field === 'displayName') { if (typeof value !== 'string' || value.trim() === '' || value.length > 128) fail(); return }
  if (field === 'baseURL') {
    if (typeof value !== 'string' || value.length > 2048) fail('bad-base-url')
    let url; try { url = new URL(value) } catch (_) { fail('bad-base-url') }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) fail('bad-base-url')
    return
  }
  if (field === 'apiKeyEnv') { if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(value)) fail('bad-key-ref'); return }
  if (['contextWindow', 'maxTokens', 'defaultContextWindow', 'defaultMaxTokens', 'maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes'].includes(field)) { if (!positive(value)) fail(); return }
  if (field === 'timeoutMs' || field === 'websocketConnectTimeoutMs') { if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) fail(); return }
  if (field === 'streamIdleTimeoutMs') { if (!timer(value)) fail(); return }
  if (field === 'input' || field === 'defaultInput') { if (!Array.isArray(value) || value.length === 0 || value.some((x) => !['text', 'image'].includes(x)) || new Set(value).size !== value.length) fail(); return }
  if (field === 'reasoningEfforts') {
    if (value === false) return
    if (!object(value) || Object.keys(value).some((k) => !LEVELS.includes(k)) || Object.entries(value).some(([k, v]) => !(k === 'off' && (v === null || v === '') || typeof v === 'string' && v.length > 0 && v.length <= 128)) || !Object.entries(value).some(([k, v]) => k !== 'off' && typeof v === 'string' && v.length > 0)) fail()
    return
  }
  if (field === 'compat') { validateCompat(value, api, previous); return }
  if (field === 'headers') {
    if (!object(value) || Object.entries(value).some(([k, v]) => !safeHeaderName(k) || sensitiveHeader(k) || typeof v !== 'string' || v.length > 4096 || /[\r\n\0]/.test(v))) fail('sensitive-header')
    return
  }
  if (field === 'thinkingBudgets') { if (!object(value) || Object.entries(value).some(([k, v]) => !['minimal', 'low', 'medium', 'high'].includes(k) || !Number.isFinite(v) || v < 0)) fail(); return }
  if (field === 'retryPolicy') {
    if (!object(value) || !['normal', 'always'].includes(value.mode) || Object.keys(value).some((k) => !['mode', 'maxRetries', 'retryableCodes', 'backoff'].includes(k))) fail()
    if (value.maxRetries !== undefined && (!Number.isSafeInteger(value.maxRetries) || value.maxRetries < 0)) fail()
    if (value.retryableCodes !== undefined && (!Array.isArray(value.retryableCodes) || !value.retryableCodes.length || new Set(value.retryableCodes).size !== value.retryableCodes.length || value.retryableCodes.some((x) => typeof x !== 'string' || !x || x.length > 128))) fail()
    if (value.backoff !== undefined) {
      const backoff = value.backoff
      if (!object(backoff) || Object.keys(backoff).some((k) => !['initialDelayMs', 'maxDelayMs', 'jitterRatio'].includes(k)) || backoff.initialDelayMs !== undefined && !timer(backoff.initialDelayMs) || backoff.maxDelayMs !== undefined && !timer(backoff.maxDelayMs) || backoff.jitterRatio !== undefined && (!Number.isFinite(backoff.jitterRatio) || backoff.jitterRatio < 0 || backoff.jitterRatio > 1) || (backoff.initialDelayMs ?? 500) > (backoff.maxDelayMs ?? 10000)) fail()
    }
    return
  }
  fail('unknown-field')
}
export function patchFields(raw, patch, unset, fields, api) {
  if (!object(patch) || !Array.isArray(unset) || unset.some((k) => !fields.includes(k)) || Object.keys(patch).some((k) => !fields.includes(k)) || unset.some((k) => Object.hasOwn(patch, k))) fail('unknown-field')
  const next = structuredClone(raw)
  for (const field of unset) delete next[field]
  for (const [field, value] of Object.entries(patch)) {
    validateField(field, value, { api, previous: raw[field] })
    if (value === undefined) fail('schema-invalid')
    next[field] = structuredClone(value)
  }
  return next
}
export const schemaVocabulary = () => ({ modelFields: MODEL_FIELDS, routeFields: ROUTE_FIELDS, levels: LEVELS, protocols: PROTOCOLS, compatGates: COMPAT_GATES, compatEnums: COMPAT_ENUMS, routeEnums: ROUTE_ENUMS })
