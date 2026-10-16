import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const manifest = JSON.parse(read('package.json'))

test('plugin display resources are exported and included in the package', () => {
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.ok(manifest.files.includes('icon.svg'))
  assert.ok(manifest.files.includes('locale/*.json'))
  assert.ok(statSync(new URL('../icon.svg', import.meta.url)).size < 256 * 1024)
})

test('plugin metadata provides meaningful Chinese and English display text', () => {
  for (const [language, title] of [['zh', 'DSH 运维面板'], ['en', 'DSH Operations Panel']]) {
    const { meta } = JSON.parse(read(`locale/${language}.json`))
    assert.equal(meta.title, title)
    assert.ok(meta.description.length > 20)
  }
})

test('plugin icon keeps the existing two-server silhouette in blue', () => {
  const svg = read('icon.svg')
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /viewBox="0 0 24 24"/)
  assert.match(svg, /stroke="#4778f5"/)
  assert.equal((svg.match(/<rect\b/g) ?? []).length, 2)
  assert.doesNotMatch(svg, /<script|<foreignObject|\bhref\s*=/i)
})
