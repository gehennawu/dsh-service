import { readFile, writeFile } from 'node:fs/promises'
import { minify } from 'terser'

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
const result = await minify(source, {
  compress: {
    defaults: true,
    passes: 2,
  },
  mangle: true,
  ecma: 2022,
  format: {
    comments: false,
  },
})
if (typeof result.code !== 'string' || result.code === '') throw new Error('terser produced no client artifact')
const target = new URL('../client.js', import.meta.url)
await writeFile(target, result.code + '\n')
