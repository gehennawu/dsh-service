// [DEBUG-c1ear] throwaway repro helper: forge dsh-auth cookie for 127.0.0.1:3080 and
// either call RPC endpoints via curl-compatible output or print cookie for playwright.
// Usage: node repro-rpc.mjs call <endpoint> <json-payload>
//        node repro-rpc.mjs cookie            -> prints cookie name/value tab-separated
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const ORIGIN = 'http://127.0.0.1:3080'
const AUTHORITY = new URL(ORIGIN).host // 127.0.0.1:3080

const b64u = (buf) => Buffer.from(buf).toString('base64url')

function secret() {
  const raw = readFileSync('/home/node/.dsh/.credentials.yaml', 'utf8')
  const m = raw.match(/client-connection\/browser-session:[\s\S]*?payload:[\s\S]*?secret:\s*(\S+)/)
  if (!m) throw new Error('secret not found')
  return Buffer.from(m[1], 'base64url')
}

function forgeCookie() {
  const name = 'dsh-auth-' + b64u(createHash('sha256').update(AUTHORITY).digest())
  const body = b64u(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: Date.now(), expiresAt: Date.now() + 3600_000 }))
  const sig = createHmac('sha256', secret()).update(body).digest()
  return [name, `v1.${body}.${b64u(sig)}`]
}

const [cmd, endpoint, payload] = process.argv.slice(2)
if (cmd === 'cookie') {
  const [name, value] = forgeCookie()
  console.log(`${name}\t${value}`)
} else if (cmd === 'call') {
  const [name, value] = forgeCookie()
  const res = await fetch(`${ORIGIN}/dsh-service/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cookie': `${name}=${value}` },
    body: JSON.stringify({ type: 'client-request', rpcId: 'repro-1', method: endpoint, payload: payload ? JSON.parse(payload) : {} }),
  })
  const text = await res.text()
  console.log('HTTP', res.status)
  console.log(text.length > 4000 ? text.slice(0, 4000) + `…(+${text.length - 4000}B)` : text)
} else {
  console.error('usage: node repro-rpc.mjs call|cookie [endpoint] [payload]')
  process.exit(2)
}
