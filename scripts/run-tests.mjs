import { createRequire } from 'node:module'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Reuse Vite's installed compiler; tests need no browser, database or API keys.
const requireFromVite = createRequire(import.meta.resolve('vite'))
const { build } = requireFromVite('esbuild')
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(resolve(root, 'node_modules/.dbpilot-tests-'))
try {
  const filters = process.argv.slice(2)
  const files = (await readdir(resolve(root, 'tests')))
    .filter((name) => name.endsWith('.test.ts') && (!filters.length || filters.some((filter) => name.includes(filter))))
  if (!files.length) throw new Error('No matching regression tests')
  await build({
    entryPoints: files.map((name) => resolve(root, 'tests', name)),
    outdir: dir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    tsconfig: resolve(root, 'tsconfig.json'),
    logLevel: 'warning',
  })
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['--test', ...files.map((name) => resolve(dir, name.replace(/\.ts$/, '.mjs')))], {
      cwd: root, stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test', LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '', DEEPSEEK_API_KEY: '', BAILIAN_API_KEY: '' },
    })
    child.on('error', reject)
    child.on('exit', (code) => accept(code ?? 1))
  })
  process.exitCode = exitCode
} finally {
  await rm(dir, { recursive: true, force: true })
}
