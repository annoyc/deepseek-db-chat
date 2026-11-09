import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Bundles the knowledge-base ingest CLI like the regression tests do, then runs it.
// Usage: node scripts/run-kb.mjs [--embed] [--check] [--corpus dir] [--out file]
const requireFromVite = createRequire(import.meta.resolve('vite'))
const { build } = requireFromVite('esbuild')
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(resolve(root, 'node_modules/.dbpilot-kb-'))
try {
  await build({
    entryPoints: [resolve(root, 'src/server/knowledge/ingest-cli.ts')],
    outfile: resolve(dir, 'ingest.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    tsconfig: resolve(root, 'tsconfig.json'),
    logLevel: 'warning',
  })
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(dir, 'ingest.mjs'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => accept(code ?? 1))
  })
  process.exitCode = exitCode
} finally {
  await rm(dir, { recursive: true, force: true })
}
