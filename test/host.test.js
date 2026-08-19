import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../index.js'

function createHost(overrides = {}) {
  const handlers = []
  const scheduled = []
  const services = new Map(Object.entries(overrides.services || {}))
  services.set('timer', {
    timeout(callback, delay) {
      scheduled.push({ callback, delay })
      return () => {}
    },
  })

  const ctx = {
    connection: {
      rpc: {
        handle(channel, handler, options) {
          handlers.push({ channel, handler, options })
          return () => {}
        },
      },
    },
    get(service) {
      return services.get(service)
    },
  }

  apply(ctx)
  assert.equal(handlers.length, 1)
  return { handler: handlers[0].handler, scheduled }
}

test('activity RPC reports running agents, jobs, and terminals without duplicates', async () => {
  const runningAgent = { id: 'agent-running', status: 'running' }
  const idleAgent = { id: 'agent-idle', status: 'idle' }
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
      terminals: {
        list(owner) {
          if (owner !== runningAgent) return []
          return [{
            sessionId: 'terminal-1',
            name: 'dev shell',
            type: 'local',
            status: { kind: 'running' },
          }]
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

test('host plugin keeps the dsh-service public identity', () => {
  assert.equal(name, 'dsh-service')
})
