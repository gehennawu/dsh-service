// 幂等确保老版本宿主测试资产（0.1.5-rc.2）就位。
// 优先复用本地持久目录 test/fixtures/oldhost/，若缺失则从 npm registry 拉取并解压。
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const FIXTURES_DIR = path.join(ROOT, 'test/fixtures/oldhost')
const CHAT_PKG = path.join(FIXTURES_DIR, 'package/lib/client.js')
const CONV_PKG = path.join(FIXTURES_DIR, 'conv/lib/client.js')

export function ensureOldHostFixtures() {
  if (fs.existsSync(CHAT_PKG) && fs.existsSync(CONV_PKG)) {
    return FIXTURES_DIR
  }

  fs.mkdirSync(FIXTURES_DIR, { recursive: true })
  console.log('[oldhost-fixtures] 准备从 npm 拉取 0.1.5-rc.2 测试资产...')

  const chatTgz = path.join(FIXTURES_DIR, 'deepseek-ai-dsh-client-ui-chat-0.1.5-rc.2.tgz')
  if (!fs.existsSync(chatTgz)) {
    execSync('npm pack @deepseek-ai/dsh-client-ui-chat@0.1.5-rc.2 --cache /tmp/npm-cache-dshsvc', {
      cwd: FIXTURES_DIR,
      stdio: 'inherit',
    })
  }
  if (!fs.existsSync(CHAT_PKG)) {
    execSync(`tar -xzf "${chatTgz}"`, { cwd: FIXTURES_DIR, stdio: 'inherit' })
  }

  const convTgz = path.join(FIXTURES_DIR, 'deepseek-ai-dsh-client-ui-conversation-0.1.5-rc.2.tgz')
  if (!fs.existsSync(convTgz)) {
    execSync('npm pack @deepseek-ai/dsh-client-ui-conversation@0.1.5-rc.2 --cache /tmp/npm-cache-dshsvc', {
      cwd: FIXTURES_DIR,
      stdio: 'inherit',
    })
  }
  if (!fs.existsSync(CONV_PKG)) {
    const convDir = path.join(FIXTURES_DIR, 'conv')
    fs.mkdirSync(convDir, { recursive: true })
    execSync(`tar -xzf "${convTgz}" --strip-components=1 -C "${convDir}"`, { cwd: FIXTURES_DIR, stdio: 'inherit' })
  }

  return FIXTURES_DIR
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = ensureOldHostFixtures()
  console.log('[oldhost-fixtures] 已就绪:', dir)
}
