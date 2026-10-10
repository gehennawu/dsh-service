import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

const CONFIG_FILES = Object.freeze(['settings.yaml', 'cordis.patch.yml', 'AGENTS.md', 'dsh-service-config.json'])
// 每个 profile 允许打包/恢复的常规文件白名单（精确匹配文件名，不许通配或子目录）。
// `cordis.patch.yml` 是 0.1.7-alpha.1 起的 Profile 用户配置层：漏掉它会出现「备份成功、
// 恢复后个性化配置全丢」。package.json 承载 bundle 启停清单，两者必须成对。
const PROFILE_FILES = Object.freeze(['package.json', 'cordis.patch.yml'])
// 归档内元数据（备份时的 DSH/插件版本）：唯一一个「读后即丢弃、绝不落盘覆盖」的分区。
// 它必须出现在白名单里，否则 0.1.7 起新插件所出的归档会被判 `backup-entry-unexpected`
// 而全部不可恢复——这是最容易踩的反向兼容坑。
const META_PATH = 'meta/backup.json'
const MAX_META_BYTES = 4096
// 版本串的合法口径与宿主侧备份命名（index.js 的 BACKUP_VERSION_RE）逐字同源：
// semver 形、长度封顶、且**必须含数字**——少了最后一条，未解析出 DSH 包的宿主
// 写下的哨兵值 `unknown` 会被当成真版本显示出来。
const META_VERSION_RE = /^(?=.*[0-9])[0-9A-Za-z][0-9A-Za-z.-]{0,63}$/
// 来源平台/架构：同样是**纯展示**信息，取值只接受 Node 平台串/架构串的字符集。
// 它不参与任何裁决，所以宽松解析（非法即 null）。
const META_PLATFORM_RE = /^[a-z][a-z0-9_-]{0,15}$/
// 跨平台提示：只读告警，绝不让一份可恢复的归档因为「目标平台会麻烦」被拒。
const MAX_NOTICES = 8
// Windows 传统 MAX_PATH（260）留 1 位给结尾 NUL 的保守口径。
const WINDOWS_PATH_LIMIT = 259
const CASE_INSENSITIVE_PLATFORMS = Object.freeze(['win32', 'darwin'])
// 目标 profile 名与备份侧同名规则同口径：单一路径段、长度封顶；`.`/`..` 另判。
const PROFILE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/
const MAX_PROFILE_MAPPINGS = 32
// Windows 上「文件被占用」的 errno 集合：rename/rm 撞到它们时给可操作错误码。
// 其他平台同样的 errno 更可能是权限问题，仍走通用 restore-failed。
const WINDOWS_LOCK_ERROR_CODES = Object.freeze(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'])
const PLAN_TTL_MS = 5 * 60 * 1000
const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
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
  if (/[\uE000-\uF8FF]/.test(raw)) throw domainError('backup-entry-traversal')
  if (raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) throw domainError(raw.startsWith('/') || /^[A-Za-z]:/.test(raw) ? 'backup-entry-absolute' : 'backup-entry-traversal')
  if (raw.split('/').some((part) => /[ .]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part))) throw domainError('backup-entry-platform')
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
    profiles: { items: [], count: 0, bytes: 0, patchFiles: [] },
  }
}

// 归档元数据的解析口径：**纯展示信息，绝不参与完整性裁决**。缺条目、坏 JSON、版本串
// 非法或超限一律回 null（预检显示「未记录」），不让一份附加信息把可恢复的归档判成损坏。
function parseBackupMetadata(data) {
  if (data.length === 0 || data.length > MAX_META_BYTES) return null
  let parsed
  try { parsed = JSON.parse(data.toString('utf8')) } catch (_) { return null }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const version = typeof parsed.dshVersion === 'string' && META_VERSION_RE.test(parsed.dshVersion) ? parsed.dshVersion : null
  const createdAt = typeof parsed.createdAt === 'string' && !Number.isNaN(Date.parse(parsed.createdAt)) ? parsed.createdAt : null
  // 来源平台/架构（本版新增字段）：缺失或非法一律 null，界面对「早于本版的归档」不显示来源。
  const platform = typeof parsed.platform === 'string' && META_PLATFORM_RE.test(parsed.platform) ? parsed.platform : null
  const arch = typeof parsed.arch === 'string' && META_PLATFORM_RE.test(parsed.arch) ? parsed.arch : null
  return { dshVersion: version, createdAt, platform, arch }
}

// 跨设备/跨平台提示（纯函数，便于直接断言）：输入是**目标机上的落盘相对路径**，
// 输出是稳定 code 的只读提示。三条口径：
//   ① 来源平台已知且与目标不同 → 提示（信息级）；
//   ② 目标卷不区分大小写（win32/darwin 默认）时，仅大小写不同的条目会折叠到同一路径；
//   ③ win32 上超长路径（经典 260 上限）会在写入时才炸，提前算出最长值告知。
// 任何一条都不改变 validForRestore——恢复能否进行仍只由完整性裁决。
function collectPlatformNotices(paths, options) {
  const { platform, dshHome, sourcePlatform = null } = options
  const notices = []
  if (typeof sourcePlatform === 'string' && sourcePlatform !== '' && sourcePlatform !== platform) {
    notices.push({ code: 'source-platform-differs', detail: sourcePlatform })
  }
  if (CASE_INSENSITIVE_PLATFORMS.includes(platform)) {
    const folded = new Map()
    for (const relative of paths) {
      const key = relative.toLowerCase()
      const existing = folded.get(key)
      if (existing !== undefined && existing !== relative) {
        notices.push({ code: 'target-case-collision', detail: relative.slice(0, 200) })
        break
      }
      folded.set(key, relative)
    }
  }
  if (platform === 'win32' && typeof dshHome === 'string') {
    let longest = 0
    for (const relative of paths) longest = Math.max(longest, dshHome.length + 1 + relative.length)
    if (longest > WINDOWS_PATH_LIMIT) notices.push({ code: 'target-path-length', detail: String(longest) })
  }
  return notices.slice(0, MAX_NOTICES)
}

// 恢复提交阶段的失败归因：Windows 上 rename/rm 撞到占用类 errno 时给专属码，
// 让客户端能说「关掉占用方再试」，而不是笼统的 restore-failed。
function restoreFailureCode(error, platform) {
  if (platform === 'win32' && WINDOWS_LOCK_ERROR_CODES.includes(error?.code)) return 'restore-files-locked'
  return 'restore-failed'
}

function isSafeProfileName(value) {
  return typeof value === 'string' && PROFILE_NAME_RE.test(value) && value !== '.' && value !== '..'
}

// 把归档里的 profile 路径按映射改写：`profiles/<source>/<file>` → `profiles/<target>/<file>`。
// 只认三段式白名单路径（校验阶段已保证），其余路径原样返回。
function remapProfilePath(path, mapping) {
  if (mapping === undefined || mapping.size === 0) return path
  const parts = path.split('/')
  if (parts.length !== 3 || parts[0] !== 'profiles') return path
  const target = mapping.get(parts[1])
  return target === undefined || target === parts[1] ? path : `profiles/${target}/${parts[2]}`
}

// 请求映射的归一与校验。返回 `{ mapping }` 或 `{ error }`（稳定码，调用方转 domainError）。
// 省略请求即「逐条同名 + 覆盖 manifest」，与本轮之前的行为逐字一致。
function normalizeProfileMapping(requested, archived, localProfiles) {
  const archivedNames = [...new Set(archived)].sort()
  if (requested === undefined || requested === null) {
    return { mapping: archivedNames.map((name) => ({ source: name, target: name, manifest: true })) }
  }
  if (!Array.isArray(requested) || requested.length > MAX_PROFILE_MAPPINGS) return { error: 'restore-mapping-invalid' }
  const local = new Set(Array.isArray(localProfiles) ? localProfiles.filter(isSafeProfileName) : [])
  const archivedSet = new Set(archivedNames)
  const seenSources = new Set()
  const seenTargets = new Set()
  const mapping = []
  for (const entry of requested) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return { error: 'restore-mapping-invalid' }
    const source = entry.source
    const target = entry.target
    if (!archivedSet.has(source) || !isSafeProfileName(target)) return { error: 'restore-mapping-invalid' }
    // 目标名只允许宿主清单内的名字，或与源同名（保持「同名新建」的既有语义）。
    if (target !== source && !local.has(target)) return { error: 'restore-mapping-invalid' }
    if (entry.manifest !== undefined && typeof entry.manifest !== 'boolean') return { error: 'restore-mapping-invalid' }
    if (seenSources.has(source) || seenTargets.has(target)) return { error: 'restore-mapping-invalid' }
    seenSources.add(source)
    seenTargets.add(target)
    mapping.push({ source, target, manifest: entry.manifest === undefined ? source === target : entry.manifest })
  }
  return { mapping }
}

function validateEntry(path, type, data, state) {
  const sections = state.sections
  const parts = path.split('/')
  const root = parts[0]
  if (!['sessions', 'config', 'profiles', 'meta'].includes(root)) throw domainError('backup-entry-unexpected')
  if (parts.length === 1 && type !== 'directory') throw domainError('backup-entry-type')

  if (root === 'sessions') {
    state.present.add('sessions')
    if (type === 'file') { sections.sessions.files += 1; sections.sessions.bytes += data.length }
    else sections.sessions.dirs += 1
    return
  }

  // meta 分区只容忍 `meta/` 目录本身与唯一一个 `meta/backup.json`：出现别的条目（别名、
  // 子目录、重复）即拒，免得这层「读后即弃」的例外变成绕过条目白名单的后门。
  if (root === 'meta') {
    if (path === 'meta' && type === 'directory') return
    if (path !== META_PATH || type !== 'file') throw domainError('backup-entry-unexpected')
    state.metaSeen = (state.metaSeen ?? 0) + 1
    if (state.metaSeen > 1) throw domainError('backup-entry-duplicate')
    state.metadata = parseBackupMetadata(data)
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
  if (parts.length !== 3 || type !== 'file' || !PROFILE_FILES.includes(parts[2])) throw domainError('backup-entry-unexpected')
  if (parts[2] === 'package.json') {
    let manifest
    try { manifest = JSON.parse(data.toString('utf8')) } catch (_) { throw domainError('backup-profile-invalid') }
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw domainError('backup-profile-invalid')
    sections.profiles.items.push({ name: parts[1], sizeBytes: data.length })
    sections.profiles.bytes += data.length
    return
  }
  // Profile 补丁：内容是用户手写的 YAML patch 层，此处只记清单与字节，不做语义校验
  // （解析失败应仍可恢复——恢复的是「用户当时的文件」，不是「合法的 patch」）。
  sections.profiles.patchFiles.push({ name: parts[1], sizeBytes: data.length })
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
      if (zeroBlocks >= 2) {
        if (expanded.subarray(offset).some((byte) => byte !== 0)) throw domainError('backup-tar-invalid')
        offset = expanded.length
        break
      }
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
    else if (options.digestEntries === true) entries.push(type === 'file' ? { path, type, size: headerSize, sha256: createHash('sha256').update(payload).digest('hex') } : { path, type })
    // 只取路径的轻量模式：跨平台提示要逐条目算目标路径，但不需要 payload。
    else if (options.collectPaths === true) entries.push({ path, type })
    else entries.push(null)
  }

  if (zeroBlocks < 2 || pendingLongName !== undefined || pendingPax !== undefined) throw domainError('backup-tar-invalid')
  if (offset % 512 !== 0 || expanded.length % 512 !== 0) throw domainError('backup-tar-invalid')
  for (const root of ['sessions', 'config', 'profiles']) if (!state.present.has(root)) throw domainError('backup-section-missing', root)
  state.sections.config.files.sort((a, b) => a.name.localeCompare(b.name))
  state.sections.profiles.items.sort((a, b) => a.name.localeCompare(b.name))
  state.sections.profiles.patchFiles.sort((a, b) => a.name.localeCompare(b.name))
  state.sections.profiles.count = state.sections.profiles.items.length
  // 归档格式标签：v1 = 不含 Profile 补丁（0.1.7-alpha.1 之前的插件所出）；v2 = 含补丁层。
  // 恢复旧归档时据此给出「未包含项」提示而不判损坏。
  const archiveFormat = state.sections.profiles.patchFiles.length > 0 ? 'v2' : 'v1'
  // 备份时版本信息：`metadata` 为 null 表示该归档未记录（旧插件所出，或元数据非法）。
  // 文件名里的版本段由调用方（index.js 的 backupVersionFromName）解析后随 source 带入，
  // 两层信息在报告里并列，客户端优先信元数据。
  return { entries, sections: state.sections, logicalBytes, entryCount: entries.length, archiveFormat, metadata: state.metadata ?? null }
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
    archiveFormat: 'v1',
    // 文件名里的版本段（老归档为 null）与归档内记录的版本（缺 meta 为 null）分开报，
    // 界面优先显示后者；前者是廉价但可能与内容不符的镜像。
    nameVersion: typeof source.nameVersion === 'string' ? source.nameVersion : null,
    metadata: null,
    // 形状恒定：坏归档也给 null / 空数组，客户端不必按存在性写防御分支。
    sourcePlatform: null,
    sourceArch: null,
    notices: [],
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
    const compressed = await readFile(source.path)
    if (compressed.length === 0 || compressed.length > MAX_COMPRESSED_BYTES) throw domainError('backup-size-limit')
    base.archive.compressedBytes = compressed.length
    base.source.sizeBytes = compressed.length
    base.source.sha256 = createHash('sha256').update(compressed).digest('hex')
    let expanded
    try { expanded = await gunzipArchive(compressed, { maxOutputLength: MAX_EXPANDED_BYTES }) } catch (error) {
      throw domainError(error?.code === 'ERR_BUFFER_TOO_LARGE' ? 'backup-size-limit' : 'backup-gzip-invalid')
    }
    const parsed = parseTar(expanded, { ...options, collectPaths: true })
    return {
      report: {
        ...base,
        validForRestore: true,
        status: 'ok',
        archive: { entryCount: parsed.entryCount, compressedBytes: compressed.length, logicalBytes: parsed.logicalBytes },
        archiveFormat: parsed.archiveFormat,
        // 元数据非法/缺席时退回文件名里的版本段，保证「只要有一处记了版本」就看得见。
        metadata: parsed.metadata ?? null,
        dshVersion: parsed.metadata?.dshVersion ?? (typeof source.nameVersion === 'string' ? source.nameVersion : null),
        // 来源平台/架构只做展示与提示；旧归档缺字段即 null。
        sourcePlatform: parsed.metadata?.platform ?? null,
        sourceArch: parsed.metadata?.arch ?? null,
        // 跨平台提示（只读，不影响 validForRestore）。计划阶段会按映射后的目标路径重算。
        notices: collectPlatformNotices(parsed.entries.map((entry) => entry.path), {
          platform: options.platform ?? process.platform,
          dshHome: options.dshHome,
          sourcePlatform: parsed.metadata?.platform ?? null,
        }),
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

// 归档与暂存树逐条目比对（仅 tar 报「读取期间有变化」时启用）。
// 退出码 1 只说明 tar 认为某个文件不是精确副本、不说明是哪个文件、更不说明归档是否完整；
// 唯一可靠的裁决是拿归档内容回头核对它打包的那棵树：条目集合、文件大小、文件 sha256
// 三者全等才算数，任何差异一律判为不完整归档并拒绝发布。
async function digestTree(root) {
  const files = new Map()
  const dirs = new Set()
  const walk = async (dir, logical) => {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const child = join(dir, entry.name)
      const childLogical = logical === '' ? entry.name : `${logical}/${entry.name}`
      const info = await lstat(child)
      if (info.isSymbolicLink()) throw domainError('backup-source-unsafe', childLogical)
      if (info.isDirectory()) {
        dirs.add(childLogical)
        await walk(child, childLogical)
        continue
      }
      if (!info.isFile()) throw domainError('backup-source-unsafe', childLogical)
      files.set(childLogical, { size: info.size, sha256: await hashFile(child) })
    }
  }
  await walk(root, '')
  return { files, dirs }
}

async function compareEntriesToTree(entries, root) {
  const archivedFiles = new Map()
  const archivedDirs = new Set()
  for (const entry of entries) {
    if (entry === null) continue
    if (entry.type === 'directory') archivedDirs.add(entry.path)
    else archivedFiles.set(entry.path, { size: entry.size, sha256: entry.sha256 })
  }
  const tree = await digestTree(root)
  for (const [path, archived] of archivedFiles) {
    const staged = tree.files.get(path)
    if (staged === undefined) throw domainError('backup-archive-incomplete', path)
    if (staged.size !== archived.size || staged.sha256 !== archived.sha256) throw domainError('backup-archive-incomplete', path)
  }
  for (const path of tree.files.keys()) if (!archivedFiles.has(path)) throw domainError('backup-archive-incomplete', path)
  for (const path of archivedDirs) if (!tree.dirs.has(path)) throw domainError('backup-archive-incomplete', path)
  for (const path of tree.dirs) if (!archivedDirs.has(path)) throw domainError('backup-archive-incomplete', path)
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
    // 目标指纹覆盖白名单里的每个文件：漏掉补丁会让「恢复期间用户改了配置」检测不到
    // （指纹相同 → 覆盖写，用户的新改动被旧快照悄悄顶掉）。
    for (const file of PROFILE_FILES) await fingerprintNode(join(profileRoot, file), `profiles/${name}/${file}`, hash, summary)
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

// 目标机会话目录的**只读诊断**探测：建临时文件 → 改名 → 删除。失败最可能的原因是
// 目标平台上有进程占用着会话目录（Windows 上宿主自身/同步盘/杀毒都可能持句柄），
// 也可能是权限不足；两种情况都值得在确认前告诉用户。sessions/ 不存在时跳过探测
// ——恢复本来就会新建它，此时「不可写」无从谈起。探测文件在返回前一定清理干净，
// 否则会污染紧随其后计算的目标指纹。
async function probeSessionsWritable(dshHome) {
  const dir = join(dshHome, 'sessions')
  if (!(await pathExists(dir))) return null
  const probe = join(dir, `.dsh-service-probe-${randomUUID()}`)
  const renamed = `${probe}.renamed`
  try {
    await writeFile(probe, '', { mode: 0o600 })
    await rename(probe, renamed)
    await unlink(renamed)
    return null
  } catch (error) {
    await rm(probe, { force: true }).catch(() => {})
    await rm(renamed, { force: true }).catch(() => {})
    return typeof error?.code === 'string' ? error.code : 'probe-failed'
  }
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
    // 跨平台提示（计划阶段按映射后路径重算）：与报告同名同形，客户端优先用计划里的。
    notices: plan.notices ?? [],
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
    // 目标平台：必须是「恢复实际发生的那台机器」的事实，默认取宿主进程平台。
    // 只驱动只读提示与错误措辞，绝不参与归档裁决。
    platform = process.platform,
    // 目标机可选的 profile 名清单（宿主侧 readdir 结果）；映射的目标必须落在其中
    // 或与源同名（同名新建是既有语义）。
    listProfiles = async () => [],
  } = options
  const plans = new Map()
  let recoveryError
  let operation = Promise.resolve()
  const withLock = (task) => {
    const current = operation.then(task, task)
    operation = current.catch(() => {})
    return current
  }
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
    return (await inspectArchive(source, { platform, dshHome })).report
  }

  // tar 报「读取期间有变化」时的完整性兜底：解析归档并把它逐条目核对回暂存树。
  // 只有归档是暂存树的完整精确副本时才返回 true；任何缺失、截断或内容差异都判为不可发布。
  async function verifyArchivedTree(source, root) {
    await ensureRecovered()
    const inspected = await inspectArchive(source, { digestEntries: true, platform, dshHome })
    if (!inspected.report.validForRestore || inspected.parsed === null) {
      const issue = inspected.report.issues?.[0]?.code
      throw domainError(issue || 'backup-archive-invalid')
    }
    await compareEntriesToTree(inspected.parsed.entries, root)
    return true
  }

  async function prepareRestore(id, requestedProfiles) {
    return withLock(async () => {
      await ensureRecovered()
    await prunePlans()
    const activity = await getActiveWork()
    if (activity?.hasActive === true) throw domainError('active-work')
    const source = await resolveSource(id)
    if (source === undefined) throw domainError('unknown-backup')
    const inspected = await inspectArchive(source, { collectEntries: true, platform, dshHome })
    if (!inspected.report.validForRestore || inspected.parsed === null) throw domainError('backup-archive-invalid')
    // 归档可能带补丁而不带 manifest（外部工具所出）：指纹与恢复操作都按并集处理，
    // 否则「只改了补丁的 profile」在 target 变更检测里是盲区。
    const archivedNames = [...new Set([
      ...inspected.report.sections.profiles.items.map((item) => item.name),
      ...inspected.report.sections.profiles.patchFiles.map((item) => item.name),
    ])].sort()
    const manifestSources = new Set(inspected.report.sections.profiles.items.map((item) => item.name))
    const patchSources = new Set(inspected.report.sections.profiles.patchFiles.map((item) => item.name))
    const localProfiles = await listProfiles().catch(() => [])
    const normalized = normalizeProfileMapping(requestedProfiles, archivedNames, localProfiles)
    if (normalized.error !== undefined) throw domainError(normalized.error)
    // 「恢复什么」最终由归档决定：没带 manifest 的源不会有 manifest 操作，补丁同理。
    const mapping = normalized.mapping.map((entry) => ({
      source: entry.source,
      target: entry.target,
      manifest: entry.manifest === true && manifestSources.has(entry.source),
      patch: patchSources.has(entry.source),
    }))
    const targetProfiles = [...new Set(mapping.map((entry) => entry.target))]
    const remap = new Map(mapping.map((entry) => [entry.source, entry.target]))
    // 同一份备份重复 prepare（用户改映射）时释放上一份计划：staging 是整棵归档树的
    // 副本，不释放会随每次改选堆积磁盘。
    for (const [existingId, existing] of [...plans]) {
      if (existing.state === 'planned' && existing.source.id === source.id) {
        existing.state = 'expired'
        plans.delete(existingId)
        await rm(existing.staging, { recursive: true, force: true })
      }
    }
    const targetState = await fingerprintTargets(dshHome, targetProfiles)
    const planId = randomUUID()
    const staging = join(dshHome, 'backups', `.restore-plan-${planId}`)
    await materialize(inspected.parsed, staging)
    // 跨平台提示按**映射后**的目标路径重算，再补一条会话目录可写探测（占用/权限）。
    const notices = collectPlatformNotices(inspected.parsed.entries.map((entry) => remapProfilePath(entry.path, remap)), {
      platform,
      dshHome,
      sourcePlatform: inspected.report.sourcePlatform ?? null,
    })
    const probeDetail = await probeSessionsWritable(dshHome)
    if (probeDetail !== null) notices.push({ code: 'target-sessions-unwritable', detail: probeDetail })
    const preparedAt = now()
    const configPresent = new Set(inspected.report.sections.config.files.map((item) => item.name))
    const configRemove = []
    for (const name of CONFIG_FILES) if (!configPresent.has(name) && await pathExists(join(dshHome, name))) configRemove.push(name)
    const manifestsReplaced = mapping.filter((entry) => entry.manifest).map((entry) => entry.target)
    const patchesReplaced = mapping.filter((entry) => entry.patch).map((entry) => entry.target)
    const crossName = mapping.filter((entry) => entry.source !== entry.target)
    const manifestSkipped = crossName.filter((entry) => entry.manifest !== true && manifestSources.has(entry.source))
    const plan = {
      state: 'planned',
      planId,
      preparedAt,
      expiresAt: preparedAt + PLAN_TTL_MS,
      staging,
      sourcePath: source.path,
      source: { id: source.id, name: source.name, sizeBytes: source.sizeBytes, sha256: inspected.report.source.sha256, dshVersion: inspected.report.dshVersion ?? null },
      sourceFingerprint: inspected.report.source.sha256,
      targetFingerprint: targetState.fingerprint,
      mapping,
      targetProfiles,
      notices: notices.slice(0, MAX_NOTICES),
      reportSummary: {
        entryCount: inspected.report.archive.entryCount,
        logicalBytes: inspected.report.archive.logicalBytes,
        sessions: inspected.report.sections.sessions,
        configFiles: inspected.report.sections.config.files.length,
        profiles: archivedNames.length,
        profilePatches: patchSources.size,
        archiveFormat: inspected.report.archiveFormat,
        // 备份时的 DSH 版本随计划下发：恢复是不可逆动作，确认前必须让用户看清
        // 「这份快照来自哪个版本」——降级恢复读不动新格式会话，写清楚才不至于误点。
        dshVersion: inspected.report.dshVersion ?? null,
        sourcePlatform: inspected.report.sourcePlatform ?? null,
        metadata: inspected.report.metadata ?? null,
      },
      targets: {
        sessions: { action: 'replace', currentBytes: targetState.bytes, newBytes: inspected.report.sections.sessions.bytes },
        config: { replace: inspected.report.sections.config.files.map((item) => item.name), remove: configRemove, newBytes: inspected.report.sections.config.bytes },
        // mapping 是恢复行为的唯一事实源；upsert/patches 是它的两个投影，供既有界面直接计数。
        profiles: { mapping, upsert: manifestsReplaced, patches: patchesReplaced, untouched: true, newBytes: inspected.report.sections.profiles.bytes },
      },
      // 旧归档（v1，不含补丁层）恢复时显式告知「哪些文件没带」，不判损坏、不阻断。
      consequences: [
        'sessions-replaced',
        ...(configRemove.length > 0 ? ['config-files-removed'] : []),
        ...(manifestsReplaced.length > 0 ? ['profile-manifests-replaced'] : []),
        ...(crossName.length > 0 ? ['profile-mapped'] : []),
        ...(manifestSkipped.length > 0 ? ['profile-manifest-skipped'] : []),
        ...(patchesReplaced.length > 0 ? ['profile-patches-replaced'] : ['profile-patches-absent']),
        'service-restart-required',
      ],
      previousInstanceId,
      runtime: { supervisorKind: runtimeEnv?.supervisorKind ?? null, manualStartLikely: runtimeEnv?.manualStartLikely === true },
    }
    plans.set(planId, plan)
    return publicPlan(plan)
    })
  }

  async function commitRestore(planId) {
    return withLock(async () => {
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
    const inspected = await inspectArchive(source, { platform, dshHome })
    if (!inspected.report.validForRestore || inspected.report.source.sha256 !== plan.sourceFingerprint) {
      await rm(plan.staging, { recursive: true, force: true })
      throw domainError('restore-source-changed')
    }
    const targetState = await fingerprintTargets(dshHome, plan.targetProfiles)
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
    // profile 操作完全由计划的 mapping 派生：源决定读哪份暂存文件，目标决定写到哪里。
    for (const entry of plan.mapping ?? []) {
      if (entry.manifest === true) {
        await addOperation(join(dshHome, 'profiles', entry.target, 'package.json'), join(plan.staging, 'profiles', entry.source, 'package.json'), `profiles/${entry.target}/package.json`)
      }
      // 补丁层白名单恢复。归档没带（旧版 v1 所出）时**不登记**这一步：登记了就代表
      // 「按快照覆盖」，operation 循环会先把目标侧 patch 挪走、再因 staged 缺席而不回填，
      // 等于用一份对配置毫无意见的旧归档静默删掉用户当前配置。缺席只记入计划报告
      // （consequences: profile-patches-absent），不改成删除。
      if (entry.patch === true) {
        await addOperation(join(dshHome, 'profiles', entry.target, 'cordis.patch.yml'), join(plan.staging, 'profiles', entry.source, 'cordis.patch.yml'), `profiles/${entry.target}/cordis.patch.yml`)
      }
    }
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
      throw domainError(restoreFailureCode(error, platform))
    }

    // 桌面端（electronShell）与终端手动启动同理：没有东西会把 Host 拉起来，恢复完成后不调度
    // exit(42)（桌面端退出会被壳判为崩溃并弹原生恢复对话框），改由客户端示「重启应用」指引。
    const manual = runtimeEnv?.manualStartLikely === true || runtimeEnv?.electronShell === true
    if (!manual) scheduleRestart()
    return {
      restoredFrom: plan.source.name,
      previousInstanceId,
      restart: { scheduled: !manual, requiresManualRestart: manual, previousInstanceId },
    }
    })
  }

  async function dispose() {
    for (const plan of plans.values()) await rm(plan.staging, { recursive: true, force: true })
    plans.clear()
  }

  return { inspectBackup, verifyArchivedTree, prepareRestore, commitRestore, dispose }
}

export { CONFIG_FILES, PLAN_TTL_MS, collectPlatformNotices, normalizeProfileMapping, restoreFailureCode }
