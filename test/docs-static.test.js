import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

function imageTargets(markdown) {
  return [...markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1])
}

function section(markdown, heading) {
  const start = markdown.indexOf(heading)
  assert.notEqual(start, -1, `missing section ${heading}`)
  const next = markdown.indexOf('\n### ', start + heading.length)
  return markdown.slice(start, next === -1 ? markdown.length : next)
}

test('README image references exist and screenshots ship in the npm package', () => {
  for (const path of ['README.md', 'README.en.md', 'screenshots/README.md']) {
    for (const target of imageTargets(read(path))) {
      if (/^[a-z]+:/i.test(target)) continue
      assert.equal(existsSync(resolve(root, dirname(path), target)), true, `${path} references missing image ${target}`)
    }
  }
  const packageJson = JSON.parse(read('package.json'))
  assert.ok(packageJson.files.includes('screenshots'), 'package files must include screenshots used by the READMEs')
})

test('session deletion documentation is archived-only in both languages and the roadmap', () => {
  const zh = section(read('README.md'), '### 会话管理')
  const en = section(read('README.en.md'), '### Session manager')
  const roadmap = section(read('TODO.md'), '## v0.35 会话管理')
  assert.match(zh, /仅已归档会话可删除/)
  assert.doesNotMatch(zh, /非运行中会话可删除/)
  assert.match(en, /Only archived sessions can be deleted/i)
  assert.doesNotMatch(en, /non-running sessions can be deleted/i)
  assert.match(roadmap, /未归档.*拒绝/)
  assert.match(roadmap, /live.*拒绝/i)
})
