// [DEBUG-cpa9f] throwaway probe: compare CPA auth-files embedded quota snapshots vs live
// api-call upstream values, exactly the endpoints quota-adapters.js hits. Secrets stay
// in-process; output is redacted. Usage: node scripts/repro-cpa-upstream.mjs
import { readFileSync } from 'node:fs'

const raw = readFileSync('/home/node/.dsh/.credentials.yaml', 'utf8')
const key = raw.match(/CPA_MANAGEMENT_KEY:\s*(\S+)/)?.[1]
if (!key) { console.error('management key not found'); process.exit(1) }
const AUTH = `Bearer ${key}`
const ORIGIN = 'https://cli.woodyair.dpdns.org'

const filesRes = await fetch(`${ORIGIN}/v0/management/auth-files`, { headers: { authorization: AUTH } })
console.log('auth-files HTTP', filesRes.status)
const filesJson = await filesRes.json()
const files = Array.isArray(filesJson?.files) ? filesJson.files : []
console.log('accounts:', files.length)
for (const [i, f] of files.entries()) {
  console.log(`#${i}`, JSON.stringify({
    provider: f.provider ?? f.type,
    email: f.email,
    name: f.name,
    project_id: f.project_id,
    disabled: f.disabled,
    unavailable: f.unavailable,
    auth_index: typeof f.auth_index === 'string' ? `<${f.auth_index.length}ch>` : undefined,
  }))
  if (f.quota && typeof f.quota === 'object') {
    const sig = f.quota.signals ?? {}
    const interesting = {}
    for (const [k, v] of Object.entries(sig)) {
      if (/percent|reset|window|time/i.test(k)) interesting[k] = v
    }
    console.log('   embedded quota.signals:', JSON.stringify(interesting))
    if (f.quota.fetched_at ?? f.quota.updatedAt ?? f.quota.timestamp) console.log('   embedded quota ts:', f.quota.fetched_at ?? f.quota.updatedAt ?? f.quota.timestamp)
  } else {
    console.log('   embedded quota: none')
  }
}

// live api-call per supported account (same plans as buildCliproxyAccountPlan)
const SUPPORTED = new Set(['codex', 'antigravity', 'gemini', 'gemini-cli'])
let calls = 0
for (const [i, f] of files.entries()) {
  if (calls >= 5) { console.log('call budget reached'); break }
  const provider = String(f.provider ?? f.type ?? '').toLowerCase()
  if (!SUPPORTED.has(provider)) continue
  let planCalls
  if (provider === 'codex') planCalls = [{ method: 'GET', url: 'https://chatgpt.com/backend-api/wham/usage', data: '' }]
  else if (provider === 'antigravity') planCalls = [{ method: 'POST', url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels', data: '{}' }]
  else {
    const project = typeof f.project_id === 'string' && f.project_id.trim() !== '' ? f.project_id.trim() : ''
    if (project === '') continue
    planCalls = [{ method: 'POST', url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota', data: JSON.stringify({ project }) }]
  }
  for (const call of planCalls) {
    if (calls >= 5) break
    calls += 1
    const res = await fetch(`${ORIGIN}/v0/management/api-call`, {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ auth_index: f.auth_index, method: call.method, url: call.url, header: { Authorization: 'Bearer $TOKEN$', 'Content-Type': 'application/json' }, data: call.data }),
    })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch {}
    const payload = typeof body?.body === 'string' ? (() => { try { return JSON.parse(body.body) } catch { return null } })() : body?.body ?? null
    console.log(`api-call #${i} ${provider} ${call.url.split('/').pop()} -> HTTP ${res.status} status_code=${body?.status_code}`)
    if (payload?.rate_limit) {
      const rl = payload.rate_limit
      console.log('   rate_limit:', JSON.stringify({
        allowed: rl.allowed, limit_reached: rl.limit_reached,
        primary: rl.primary_window ? { used_percent: rl.primary_window.used_percent, reset_at: rl.primary_window.reset_at, seconds: rl.primary_window.limit_window_seconds } : rl.primary_window,
        secondary: rl.secondary_window ? { used_percent: rl.secondary_window.used_percent, reset_at: rl.secondary_window.reset_at, seconds: rl.secondary_window.limit_window_seconds } : rl.secondary_window,
      }))
    } else if (Array.isArray(payload?.buckets)) {
      console.log('   buckets:', JSON.stringify(payload.buckets.map((b) => ({ modelId: b.modelId, remainingFraction: b.remainingFraction, resetTime: b.resetTime }))))
    } else if (payload?.models && typeof payload.models === 'object') {
      const q = {}
      for (const [m, info] of Object.entries(payload.models).slice(0, 12)) {
        const qi = info?.quotaInfo ?? info?.quota_info ?? info
        if (qi && typeof qi === 'object' && qi.remainingFraction !== undefined) q[m] = { remainingFraction: qi.remainingFraction, resetTime: qi.resetTime ?? qi.reset_time }
      }
      console.log('   models quota:', JSON.stringify(q))
    } else {
      console.log('   payload(400B):', text.slice(0, 400).replace(new RegExp(key.slice(8), 'g'), '<REDACTED>'))
    }
  }
}
console.log('api-calls used:', calls)
