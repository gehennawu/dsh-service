import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

const CONFIG_FILES = Object.freeze(['settings.yaml', 'cordis.patch.yml', 'AGENTS.md'])
const PLAN_TTL_MS = 5 * 60 * 1000
const MAX_COMPRESSED_BYTES = 128 * 1024 * 1024
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 200000
const MAX_ISSUES = 20
const JOURNAL_FILE = 'dsh-service-restore-journal.json'
const gunzipArchive = promisify(gunzip)

function domainError(code, detail) {
  const error = new Error(code)
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

function tarText(block, start, length) {
  const field = block.subarray(start, start + length)
  const end = field.indexOf(0)
  const text = field.subarray(0, end < 0 ? field.length : end).toString('utf8')
  if (text.includes('\ufffd')) throw domainError('backup-tar-invalid')
  return text
}

function tarNumber(block, start, length) {
  const field = block.subarray(start, start + length)
  if ((field[0] & 0x80) !== 0) throw domainError('backup-size-limit')
  const text = field.toString('ascii').replace(/\0.*$/s, '').trim()
  if (text === '') return 0
  if (!/^[0-7]+$/.test(text)) throw domainError('backup-tar-invalid')
  const value = Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value) || value < 0) throw domainError('backup-size-limit')
  return value
}

function verifyTarChecksum(block) {
  const expected = tarNumber(block, 148, 8)
  let actual = 0
  for (let index = 0; index < block.length; index += 1) actual += index >= 148 && index < 156 ? 32 : block[index]
  if (actual !== expected) throw domainError('backup-tar-invalid')
}

function parsePax(data) {
  const values = {}
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(32, offset)
    if (space < 0) throw domainError('backup-tar-invalid')
    const lengthText = data.subarray(offset, space).toString('ascii')
    if (!/^\d+$/.test(lengthText)) throw domainError('backup-tar-invalid')
    const length = Number(lengthText)
    if (!Number.isSafeInteger(length) || length <= space - offset + 1 || offset + length > data.length) throw domainError('backup-tar-invalid')
    const record = data.subarray(space + 1, offset + length)
    if (record[record.length - 1] !== 10) throw domainError('backup-tar-invalid')
    const equals = record.indexOf(61)
    if (equals <= 0) throw domainError('backup-tar-invalid')
    const key = record.subarray(0, equals).toString('utf8')
    const value = record.subarray(equals + 1, record.length - 1).toString('utf8')
    if (key.includes('\ufffd') || value.includes('\ufffd') || key.startsWith('GNU.sparse.')) throw domainError('backup-entry-type')
    values[key] = value
    offset += length
  }
  return values
}

function normalizeArchivePath(raw, type) {
  if (typeof raw !== 'string' || raw === '' || /[\0-\x1f\x7f]/.test(raw)) throw domainError('backup-entry-traversal')
  if (raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw domainError(raw.startsWith('/') || /^[A-Za-z]:/.test(raw) ? 'backup-entry-absolute' : 'backup-entry-traversal')
  const trimmed = type === 'directory' ? raw.replace(/\/+$/, '') : raw
  if (trimmed === '') throw domainError('backup-entry-traversal')
  const parts = trimmed.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) throw domainError('backup-entry-traversal')
  return parts.join('/')
}

function issueFrom(error, path) {
  return { code: typeof error?.code === 'string' ? error.code : 'backup-tar-invalid', ...(path ? { path } : {}) }
}

function emptySections() {
  return {
    sessions: { files: 0, dirs: 0, bytes: 0 },
    config: { files: [], missing: [...CONFIG_FILES], bytes: 0 },
    profiles: { items: [], count: 0, bytes: 0 },
  }
}

function validateEntry(path, type, data, state) {
  const sections = state.sections
  const parts = path.split('/')
  const root = parts[0]
  if (!['sessions', 'config', 'profiles'].includes(root)) throw domainError('backup-entry-unexpected')
  if (parts.length === 1 && type !== 'directory') throw domainError('backup-entry-type')

  if (root === 'sessions') {
    state.present.add('sessions')
    if (type === 'file') { sections.sessions.files += 1; sections.sessions.bytes += data.length }
    else sections.sessions.dirs += 1
    return
  }

  if (root === 'config') {
    state.present.add('config')
    if (parts.length === 1) return
    if (parts.length !== 2 || type !== 'file' || !CONFIG_FILES.includes(parts[1])) throw domainError('backup-entry-unexpected')
    sections.config.files.push({ name: parts[1], sizeBytes: data.length })
    sections.config.bytes += data.length
    sections.config.missing = sections.config.missing.filter((name) => name !== parts[1])
    return
  }

  state.present.add('profiles')
  if (parts.length === 1) return
  if (parts[1] === '.' || parts[1] === '..') throw domainError('backup-entry-traversal')
  if (parts.length === 2 && type === 'directory') return
  if (parts.length !== 3 || parts[2] !== 'package.json' || type !== 'file') throw domainError('backup-entry-unexpected')
  let manifest
  try { manifest = JSON.parse(data.toString('utf8')) } catch (_) { throw domainError('backup-profile-invalid') }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw domainError('backup-profile-invalid')
  sections.profiles.items.push({ name: parts[1], sizeBytes: data.length })
  sections.profiles.bytes += data.length
}

function parseTar(expanded, options = {}) {
  const entries = []
  const seen = new Map()
  const state = { sections: emptySections(), present: new Set() }
  let pendingLongName
  let pendingPax
  let offset = 0
  let zeroBlocks = 0
  let logicalBytes = 0

  while (offset + 512 <= expanded.length) {
    const block = expanded.subarray(offset, offset + 512)
    offset += 512
    if (block.every((byte) => byte === 0)) {
      zeroBlocks += 1
      if (zeroBlocks >= 2) break
      continue
    }
    if (zeroBlocks > 0) throw domainError('backup-tar-invalid')
    verifyTarChecksum(block)
    const rawName = tarText(block, 0, 100)
    const prefix = tarText(block, 345, 155)
    const headerName = prefix ? `${prefix}/${rawName}` : rawName
    const headerSize = tarNumber(block, 124, 12)
    const typeFlag = String.fromCharCode(block[156] || 48)
    const payloadEnd = offset + headerSize
    if (payloadEnd > expanded.length) throw domainError('backup-tar-invalid')
    const payload = expanded.subarray(offset, payloadEnd)
    offset += Math.ceil(headerSize / 512) * 512
    if (offset > expanded.length) throw domainError('backup-tar-invalid')

    if (typeFlag === 'L') {
      pendingLongName = payload.toString('utf8').replace(/\0.*$/s, '')
      if (pendingLongName.includes('\ufffd')) throw domainError('backup-tar-invalid')
      continue
    }
    if (typeFlag === 'x') {
      pendingPax = parsePax(payload)
      continue
    }
    if (typeFlag === 'g' || typeFlag === 'K') throw domainError('backup-entry-type')

    const effectiveName = pendingPax?.path ?? pendingLongName ?? headerName
    const linkName = pendingPax?.linkpath ?? tarText(block, 157, 100)
    const effectiveSize = pendingPax?.size === undefined ? headerSize : Number(pendingPax.size)
    pendingLongName = undefined
    pendingPax = undefined
    if (!Number.isSafeInteger(effectiveSize) || effectiveSize < 0 || effectiveSize !== headerSize) throw domainError('backup-size-limit')

    let type
    if (typeFlag === '0' || typeFlag === '\0') type = 'file'
    else if (typeFlag === '5') type = 'directory'
    else if (typeFlag === '1' || typeFlag === '2') throw domainError('backup-entry-link', linkName)
    else throw domainError('backup-entry-type')
    const path = normalizeArchivePath(effectiveName, type)
    if (entries.length >= MAX_ARCHIVE_ENTRIES) throw domainError('backup-size-limit')
    logicalBytes += type === 'file' ? headerSize : 0
    if (logicalBytes > MAX_EXPANDED_BYTES) throw domainError('backup-size-limit')

    const parts = path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      if (seen.get(parts.slice(0, index).join('/')) === 'file') throw domainError('backup-entry-conflict')
    }
    if (seen.has(path)) throw domainError('backup-entry-duplicate')
    if (type === 'file') {
      for (const existing of seen.keys()) if (existing.startsWith(path + '/')) throw domainError('backup-entry-conflict')
    }
    seen.set(path, type)
    validateEntry(path, type, payload, state)
    if (options.collectEntries === true) entries.push({ path, type, data: type === 'file' ? Buffer.from(payload) : undefined })
    else entries.push(null)
  }

  if (zeroBlocks < 2 || pendingLongName !== undefined || pendingPax !== undefined) throw domainError('backup-tar-invalid')
  for (const root of ['sessions', 'config', 'profiles']) if (!state.present.has(root)) throw domainError('backup-section-missing', root)
  state.sections.config.files.sort((a, b) => a.name.localeCompare(b.name))
  state.sections.profiles.items.sort((a, b) => a.name.localeCompare(b.name))
  state.sections.profiles.count = state.sections.profiles.items.length
  return { entries, sections: state.sections, logicalBytes, entryCount: entries.length }
}

async function inspectArchive(source, options = {}) {
  const base = {
    id: source.id,
    name: source.name,
    format: 'tar.gz',
    source: { name: source.name, sizeBytes: source.sizeBytes, sha256: '', mtimeMs: source.mtimeMs },
    validForRestore: false,
    status: 'error',
    archive: { entryCount: 0, compressedBytes: source.sizeBytes, logicalBytes: 0 },
    sections: emptySections(),
    issues: [],
    issueCount: 0,
    issuesTruncated: false,
    inspectedAt: new Date().toISOString(),
  }
  try {
    const info = await lstat(source.path)
    if (!info.isFile()) throw domainError('backup-not-regular')
    if (info.size <= 0 || info.size > MAX_COMPRESSED_BYTES) throw domainError('backup-size-limit')
    base.source.sizeBytes = info.size
    base.source.mtimeMs = info.mtimeMs
    base.archive.compressedBytes = info.size
    const compressed = await readFile(source.path)
    base.source.sha256 = createHash('sha256').update(compressed).digest('hex')
    let expanded
    try { expanded = await gunzipArchive(compressed, { maxOutputLength: MAX_EXPANDED_BYTES }) } catch (error) {
      throw domainError(error?.code === 'ERR_BUFFER_TOO_LARGE' ? 'backup-size-limit' : 'backup-gzip-invalid')
    }
    const parsed = parseTar(expanded, options)
    return {
      report: {
        ...base,
        validForRestore: true,
        status: 'ok',
        archive: { entryCount: parsed.entryCount, compressedBytes: compressed.length, logicalBytes: parsed.logicalBytes },
        sections: parsed.sections,
      },
      parsed,
    }
  } catch (error) {
    const issue = issueFrom(error, typeof error?.detail === 'string' ? error.detail : undefined)
    base.issues = [issue].slice(0, MAX_ISSUES)
    base.issueCount = 1
    return { report: base, parsed: null }
  }
}

async function hashFile(path) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

async function assertDirectoryOrMissing(path) {
  try {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) throw domainError('restore-target-unsafe')
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function fingerprintNode(path, logical, hash, summary) {
  let info
  try { info = await lstat(path) } catch (error) {
    if (error?.code === 'ENOENT') { hash.update(`M\0${logical}\0`); return }
    throw error
  }
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw domainError('restore-target-unsafe')
  if (info.isDirectory()) {
    hash.update(`D\0${logical}\0`)
    const names = (await readdir(path)).sort()
    for (const name of names) await fingerprintNode(join(path, name), `${logical}/${name}`, hash, summary)
    return
  }
  summary.bytes += info.size
  hash.update(`F\0${logical}\0${info.size}\0${await hashFile(path)}\0`)
}

async function fingerprintTargets(dshHome, profileNames) {
  const hash = createHash('sha256')
  const summary = { bytes: 0 }
  await fingerprintNode(join(dshHome, 'sessions'), 'sessions', hash, summary)
  for (const name of CONFIG_FILES) await fingerprintNode(join(dshHome, name), `config/${name}`, hash, summary)
  const profilesRoot = join(dshHome, 'profiles')
  await assertDirectoryOrMissing(profilesRoot)
  for (const name of profileNames) {
    const profileRoot = join(profilesRoot, name)
    await assertDirectoryOrMissing(profileRoot)
    await fingerprintNode(join(profileRoot, 'package.json'), `profiles/${name}/package.json`, hash, summary)
  }
  return { fingerprint: hash.digest('hex'), bytes: summary.bytes }
}

async function materialize(parsed, staging) {
  await mkdir(staging, { recursive: true, mode: 0o700 })
  for (const entry of parsed.entries) {
    const target = join(staging, ...entry.path.split('/'))
    if (resolve(target) !== staging && !resolve(target).startsWith(resolve(staging) + sep)) throw domainError('backup-entry-traversal')
    if (entry.type === 'directory') await mkdir(target, { recursive: true, mode: 0o700 })
    else {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, entry.data, { mode: 0o600 })
    }
  }
}

async function pathExists(path) {
  try { await lstat(path); return true } catch (error) { if (error?.code === 'ENOENT') return false; throw error }
}

async function writeJournal(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function rollbackOperations(operations) {
  for (const operation of [...operations].reverse()) {
    if (operation.started !== true) continue
    const rollbackExists = await pathExists(operation.rollback)
    if (rollbackExists) {
      await rm(operation.target, { recursive: true, force: true })
      await mkdir(dirname(operation.target), { recursive: true, mode: 0o700 })
      await rename(operation.rollback, operation.target)
    } else if (operation.existed === false) {
      await rm(operation.target, { recursive: true, force: true })
    }
  }
}

async function recoverJournal(dshHome) {
  const journalPath = join(dshHome, JOURNAL_FILE)
  try {
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    if (Array.isArray(journal?.operations)) await rollbackOperations(journal.operations)
    if (typeof journal?.rollbackDir === 'string') await rm(journal.rollbackDir, { recursive: true, force: true })
    await unlink(journalPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw domainError('recovery-required')
  }
}

function publicPlan(plan) {
  return {
    planId: plan.planId,
    preparedAt: plan.preparedAt,
    expiresAt: plan.expiresAt,
    source: plan.source,
    reportSummary: plan.reportSummary,
    targets: plan.targets,
    consequences: plan.consequences,
    previousInstanceId: plan.previousInstanceId,
    runtime: plan.runtime,
  }
}

export function createBackupIntegrity(options) {
  const {
    dshHome,
    resolveBackup,
    getActiveWork = () => ({ hasActive: false, items: [] }),
    isEnabled = () => true,
    runtimeEnv = { manualStartLikely: false, supervisorKind: null },
    previousInstanceId,
    scheduleRestart = () => {},
    now = () => Date.now(),
  } = options
  const plans = new Map()
  let recoveryError
  const recovery = recoverJournal(dshHome).catch((error) => { recoveryError = error })
  const ensureRecovered = async () => {
    await recovery
    if (recoveryError !== undefined) throw recoveryError
  }

  async function resolveSource(id) {
    if (typeof id !== 'string' || id === '') return undefined
    const source = await resolveBackup(id)
    if (source === undefined) return undefined
    return source
  }

  async function prunePlans() {
    for (const [id, plan] of plans) {
      if (plan.state === 'planned' && now() > plan.expiresAt) {
        plan.state = 'expired'
        await rm(plan.staging, { recursive: true, force: true })
      }
      if (plan.state !== 'planned' && now() - plan.expiresAt > PLAN_TTL_MS) plans.delete(id)
    }
  }

  async function inspectBackup(id) {
    await ensureRecovered()
    await prunePlans()
    const source = await resolveSource(id)
    if (source === undefined) return undefined
    return (await inspectArchive(source)).report
  }

  async function prepareRestore(id) {
    await ensureRecovered()
    await prunePlans()
    const activity = await getActiveWork()
    if (activity?.hasActive === true) throw domainError('active-work')
    const source = await resolveSource(id)
    if (source === undefined) throw domainError('unknown-backup')
    const inspected = await inspectArchive(source, { collectEntries: true })
    if (!inspected.report.validForRestore || inspected.parsed === null) throw domainError('backup-archive-invalid')
    const profileNames = inspected.report.sections.profiles.items.map((item) => item.name)
    const targetState = await fingerprintTargets(dshHome, profileNames)
    const planId = randomUUID()
    const staging = join(dshHome, 'backups', `.restore-plan-${planId}`)
    await materialize(inspected.parsed, staging)
    const preparedAt = now()
    const configPresent = new Set(inspected.report.sections.config.files.map((item) => item.name))
    const configRemove = []
    for (const name of CONFIG_FILES) if (!configPresent.has(name) && await pathExists(join(dshHome, name))) configRemove.push(name)
    const plan = {
      state: 'planned',
      planId,
      preparedAt,
      expiresAt: preparedAt + PLAN_TTL_MS,
      staging,
      sourcePath: source.path,
      source: { id: source.id, name: source.name, sizeBytes: source.sizeBytes, sha256: inspected.report.source.sha256 },
      sourceFingerprint: inspected.report.source.sha256,
      targetFingerprint: targetState.fingerprint,
      profileNames,
      reportSummary: {
        entryCount: inspected.report.archive.entryCount,
        logicalBytes: inspected.report.archive.logicalBytes,
        sessions: inspected.report.sections.sessions,
        configFiles: inspected.report.sections.config.files.length,
        profiles: profileNames.length,
      },
      targets: {
        sessions: { action: 'replace', currentBytes: targetState.bytes, newBytes: inspected.report.sections.sessions.bytes },
        config: { replace: inspected.report.sections.config.files.map((item) => item.name), remove: configRemove, newBytes: inspected.report.sections.config.bytes },
        profiles: { upsert: profileNames, untouched: true, newBytes: inspected.report.sections.profiles.bytes },
      },
      consequences: ['sessions-replaced', ...(configRemove.length > 0 ? ['config-files-removed'] : []), ...(profileNames.length > 0 ? ['profile-manifests-replaced'] : []), 'service-restart-required'],
      previousInstanceId,
      runtime: { supervisorKind: runtimeEnv?.supervisorKind ?? null, manualStartLikely: runtimeEnv?.manualStartLikely === true },
    }
    plans.set(planId, plan)
    return publicPlan(plan)
  }

  async function commitRestore(planId) {
    await ensureRecovered()
    const plan = typeof planId === 'string' ? plans.get(planId) : undefined
    if (plan === undefined) throw domainError('unknown-restore-plan')
    if (plan.state === 'expired') throw domainError('restore-plan-expired')
    if (plan.state !== 'planned') throw domainError('restore-plan-used')
    if (now() > plan.expiresAt) {
      plan.state = 'used'
      await rm(plan.staging, { recursive: true, force: true })
      throw domainError('restore-plan-expired')
    }
    plan.state = 'used'
    if (isEnabled() !== true) { await rm(plan.staging, { recursive: true, force: true }); throw domainError('feature-disabled') }
    const activity = await getActiveWork()
    if (activity?.hasActive === true) { await rm(plan.staging, { recursive: true, force: true }); throw domainError('active-work') }
    const source = await resolveSource(plan.source.id)
    if (source === undefined) { await rm(plan.staging, { recursive: true, force: true }); throw domainError('restore-source-changed') }
    const inspected = await inspectArchive(source)
    if (!inspected.report.validForRestore || inspected.report.source.sha256 !== plan.sourceFingerprint) {
      await rm(plan.staging, { recursive: true, force: true })
      throw domainError('restore-source-changed')
    }
    const targetState = await fingerprintTargets(dshHome, plan.profileNames)
    if (targetState.fingerprint !== plan.targetFingerprint) {
      await rm(plan.staging, { recursive: true, force: true })
      throw domainError('restore-target-changed')
    }

    const rollbackDir = join(dshHome, 'backups', `.restore-rollback-${plan.planId}`)
    const operations = []
    const addOperation = async (target, staged, logical) => {
      const existed = await pathExists(target)
      operations.push({ target, staged, rollback: join(rollbackDir, ...logical.split('/')), existed })
    }
    await addOperation(join(dshHome, 'sessions'), join(plan.staging, 'sessions'), 'sessions')
    for (const name of CONFIG_FILES) await addOperation(join(dshHome, name), join(plan.staging, 'config', name), `config/${name}`)
    for (const name of plan.profileNames) await addOperation(join(dshHome, 'profiles', name, 'package.json'), join(plan.staging, 'profiles', name, 'package.json'), `profiles/${name}/package.json`)
    const journalPath = join(dshHome, JOURNAL_FILE)
    await mkdir(rollbackDir, { recursive: true, mode: 0o700 })
    await writeJournal(journalPath, { version: 1, rollbackDir, operations })
    try {
      for (const operation of operations) {
        operation.started = true
        await writeJournal(journalPath, { version: 1, rollbackDir, operations })
        if (operation.existed) {
          await mkdir(dirname(operation.rollback), { recursive: true, mode: 0o700 })
          await rename(operation.target, operation.rollback)
        }
        if (await pathExists(operation.staged)) {
          await mkdir(dirname(operation.target), { recursive: true, mode: 0o700 })
          await rename(operation.staged, operation.target)
        }
      }
      await unlink(journalPath)
      await rm(rollbackDir, { recursive: true, force: true })
      await rm(plan.staging, { recursive: true, force: true })
    } catch (error) {
      try {
        await rollbackOperations(operations)
        await rm(rollbackDir, { recursive: true, force: true })
        await rm(plan.staging, { recursive: true, force: true })
        await rm(journalPath, { force: true })
      } catch (_) {
        throw domainError('recovery-required')
      }
      throw domainError('restore-failed')
    }

    const manual = runtimeEnv?.manualStartLikely === true
    if (!manual) scheduleRestart()
    return {
      restoredFrom: plan.source.name,
      previousInstanceId,
      restart: { scheduled: !manual, requiresManualRestart: manual, previousInstanceId },
    }
  }

  async function dispose() {
    for (const plan of plans.values()) await rm(plan.staging, { recursive: true, force: true })
    plans.clear()
  }

  return { inspectBackup, prepareRestore, commitRestore, dispose }
}

export { CONFIG_FILES, PLAN_TTL_MS }
