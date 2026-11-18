import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, mkdir, open, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { createBackupIntegrity } from '../backup-integrity.js'
import { createBackupRoutes } from '../backup-routes.js'

const ARCHIVE_NAME = 'dsh-backup-20250101-000000.tar.gz'
const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024

function tarOctal(value, length) {
  const digits = Math.max(1, length - 1)
  return value.toString(8).padStart(digits - 1, '0') + '\0'
}

function tarString(value, length) {
  const bytes = Buffer.alloc(length)
  Buffer.from(value).copy(bytes, 0, 0, length)
  return bytes
}

function tarArchive(entries) {
  const blocks = []
  for (const entry of entries) {
    const type = entry.type ?? '0'
    const data = type === '0' || type === '\0' ? Buffer.from(entry.data ?? '') : Buffer.alloc(0)
    const header = Buffer.alloc(512)
    tarString(entry.name, 100).copy(header, 0)
    tarString(tarOctal(type === '5' ? 0o755 : 0o644, 8), 8).copy(header, 100)
    tarString(tarOctal(0, 8), 8).copy(header, 108)
    tarString(tarOctal(0, 8), 8).copy(header, 116)
    tarString(tarOctal(data.length, 12), 12).copy(header, 124)
    tarString(tarOctal(0, 12), 12).copy(header, 136)
    Buffer.from('        ').copy(header, 148)
    header[156] = type.charCodeAt(0)
    tarString(entry.linkname ?? '', 100).copy(header, 157)
    tarString('ustar\0', 6).copy(header, 257)
    tarString('00', 2).copy(header, 263)
    let checksum = 0
    for (const byte of header) checksum += byte
    tarString(checksum.toString(8).padStart(6, '0') + '\0 ', 8).copy(header, 148)
    blocks.push(header)
    if (data.length > 0) {
      blocks.push(data)
      const padding = (512 - (data.length % 512)) % 512
      if (padding > 0) blocks.push(Buffer.alloc(padding))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function validArchive({ sessionFiles = 1, marker = 'restored' } = {}) {
  const entries = [
    { name: 'sessions/', type: '5' },
    { name: 'sessions/workspace/', type: '5' },
  ]
  for (let index = 1; index <= sessionFiles; index += 1) {
    entries.push({ name: `sessions/workspace/session-${index}.jsonl`, data: `{"type":"${marker}"}\n` })
  }
  entries.push(
    { name: 'config/', type: '5' },
    { name: 'config/settings.yaml', data: 'theme: restored\n' },
    { name: 'profiles/', type: '5' },
    { name: 'profiles/web/', type: '5' },
    { name: 'profiles/web/package.json', data: '{"name":"web-profile","restored":true}\n' },
  )
  return tarArchive(entries)
}

function rpcFailure(error) {
  return { ok: false, error: { code: 'internal', message: error?.message || error?.code || 'internal-error', details: {} } }
}

function fixture(dshHome, sources) {
  const restarts = []
  const integrity = createBackupIntegrity({
    dshHome,
    resolveBackup: async id => sources.get(id),
    getActiveWork: () => ({ hasActive: false, items: [] }),
    isEnabled: () => true,
    runtimeEnv: { manualStartLikely: false, supervisorKind: 'systemd' },
    previousInstanceId: 'instance-test',
    scheduleRestart: () => { restarts.push(Date.now()) },
    platform: 'linux',
    listProfiles: async () => [],
  })
  const routes = createBackupRoutes({ backupIntegrity: integrity, dshHome, rpcFailure })
  return {
    handler: (endpoint, payload) => routes[endpoint].handle(payload),
    restarts,
    dispose: () => integrity.dispose(),
  }
}

function sourceFor(dshHome, id) {
  const path = join(dshHome, 'backups', ARCHIVE_NAME)
  return { id, name: ARCHIVE_NAME, path, sizeBytes: 0, mtimeMs: 0, nameVersion: null }
}

test('backup inspect rejects an oversized archive before opening or reading it', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-oversize-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'backups'), { recursive: true })
  const path = join(dshHome, 'backups', ARCHIVE_NAME)
  const handle = await open(path, 'w')
  await handle.truncate(MAX_COMPRESSED_BYTES + 1)
  await handle.close()
  const routes = fixture(dshHome, new Map([['id-oversize', sourceFor(dshHome, 'id-oversize')]]))
  t.after(() => routes.dispose())

  const originalOpen = fsPromises.open
  const originalReadFile = fsPromises.readFile
  const originalCreateReadStream = fs.createReadStream
  let opens = 0
  let readFiles = 0
  let streams = 0
  fsPromises.open = async () => { opens += 1; throw new Error('oversized archive must not be opened') }
  fsPromises.readFile = async () => { readFiles += 1; throw new Error('oversized archive must not be read') }
  fs.createReadStream = () => { streams += 1; throw new Error('oversized archive must not be streamed') }
  syncBuiltinESMExports()
  try {
    const response = await routes.handler('backup-inspect', { id: 'id-oversize' })
    assert.equal(response.ok, true)
    assert.equal(response.value.validForRestore, false)
    assert.equal(response.value.issues[0].code, 'backup-size-limit')
  } finally {
    fsPromises.open = originalOpen
    fsPromises.readFile = originalReadFile
    fs.createReadStream = originalCreateReadStream
    syncBuiltinESMExports()
  }
  assert.equal(opens, 0, 'size gate must run before open')
  assert.equal(readFiles, 0, 'size gate must run before readFile')
  assert.equal(streams, 0, 'size gate must run before streaming')
})

test('backup inspect refreshes source metadata on cache hits and invalidates on byte changes', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-cache-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'backups'), { recursive: true })
  const path = join(dshHome, 'backups', ARCHIVE_NAME)
  await writeFile(path, validArchive({ sessionFiles: 1, marker: 'one' }))
  const routes = fixture(dshHome, new Map([['id-cache', sourceFor(dshHome, 'id-cache')]]))
  t.after(() => routes.dispose())

  const t1 = new Date(1_700_000_000_000)
  await utimes(path, t1, t1)
  const first = await routes.handler('backup-inspect', { id: 'id-cache' })
  assert.equal(first.ok, true)
  assert.equal(first.value.validForRestore, true)
  assert.equal(first.value.sections.sessions.files, 1)
  assert.match(first.value.source.sha256, /^[a-f0-9]{64}$/)

  // 同一份字节、不同 mtime：命中缓存，但报告必须用本次 stat 的元数据，不能保留旧 mtime。
  const t2 = new Date(1_700_000_123_000)
  await utimes(path, t2, t2)
  const second = await routes.handler('backup-inspect', { id: 'id-cache' })
  assert.equal(second.value.metadata, first.value.metadata)
  assert.equal(second.value.sections.sessions.files, 1)
  assert.equal(second.value.source.sha256, first.value.source.sha256)
  assert.equal(Math.round(second.value.source.mtimeMs), t2.getTime())

  // 同路径换一份内容：sha 变化必须击穿缓存，报告来自新字节而不是旧报告。
  await writeFile(path, validArchive({ sessionFiles: 2, marker: 'two' }))
  const third = await routes.handler('backup-inspect', { id: 'id-cache' })
  assert.equal(third.value.validForRestore, true)
  assert.equal(third.value.sections.sessions.files, 2)
  assert.notEqual(third.value.source.sha256, first.value.source.sha256)
})

test('restore commit bypasses the inspection cache and verifies the current fingerprint', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-commit-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'backups'), { recursive: true })
  await mkdir(join(dshHome, 'sessions'), { recursive: true })
  await writeFile(join(dshHome, 'sessions', 'current.jsonl'), 'current\n')
  const path = join(dshHome, 'backups', ARCHIVE_NAME)
  await writeFile(path, validArchive({ sessionFiles: 1, marker: 'one' }))
  const routes = fixture(dshHome, new Map([['id-commit', sourceFor(dshHome, 'id-commit')]]))
  t.after(() => routes.dispose())

  // 先喂一次预检缓存，再准备计划；随后替换归档，提交必须重新读取并拒绝。
  assert.equal((await routes.handler('backup-inspect', { id: 'id-commit' })).value.validForRestore, true)
  const prepared = await routes.handler('backup-restore-prepare', { id: 'id-commit' })
  assert.equal(prepared.ok, true)
  await writeFile(path, validArchive({ sessionFiles: 2, marker: 'two' }))
  const committed = await routes.handler('backup-restore-commit', { planId: prepared.value.planId })
  assert.equal(committed.ok, false)
  assert.equal(committed.error.message, 'restore-source-changed')
  assert.deepEqual(routes.restarts, [])
})

test('backup inspect rejects links and directories as non-regular before reading', async (t) => {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-service-backup-regular-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(join(dshHome, 'backups'), { recursive: true })
  const target = join(dshHome, 'backups', 'actual.tar.gz')
  await writeFile(target, validArchive())
  const link = join(dshHome, 'backups', ARCHIVE_NAME)
  await symlink(target, link)
  const routes = fixture(dshHome, new Map([['id-link', sourceFor(dshHome, 'id-link')]]))
  t.after(() => routes.dispose())
  const linked = await routes.handler('backup-inspect', { id: 'id-link' })
  assert.equal(linked.ok, true)
  assert.equal(linked.value.validForRestore, false)
  assert.equal(linked.value.issues[0].code, 'backup-not-regular')

  await rm(link, { force: true })
  await mkdir(link)
  const directory = await routes.handler('backup-inspect', { id: 'id-link' })
  assert.equal(directory.value.validForRestore, false)
  assert.equal(directory.value.issues[0].code, 'backup-not-regular')
})
