import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

// Bundles an eval entry point like the regression tests do, then runs it with the given arguments.
// Usage: node scripts/run-evals.mjs <runner|report> [...args]
const requireFromVite = createRequire(import.meta.resolve('vite'))
const { build } = requireFromVite('esbuild')
const root = resolve(import.meta.dirname, '..')
const [entry = 'runner', ...args] = process.argv.slice(2)
if (!['runner', 'report'].includes(entry)) throw new Error(`Unknown eval entry: ${entry}`)
const dir = await mkdtemp(resolve(root, 'node_modules/.dbpilot-evals-'))
try {
  await build({
    entryPoints: [resolve(root, 'evals', `${entry}.ts`)],
    outfile: resolve(dir, `${entry}.mjs`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    tsconfig: resolve(root, 'tsconfig.json'),
    logLevel: 'warning',
  })
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [resolve(dir, `${entry}.mjs`), ...args], {
      cwd: root, stdio: 'inherit',
      // Prompt dates are rendered in local time; the dataset is labelled in Beijing time.
      // Traces stay off unless explicitly requested, so eval runs never mix with production data.
      env: {
        ...process.env,
        TZ: 'Asia/Shanghai',
        ...(process.env.EVAL_LANGFUSE === 'true' ? {} : { LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '' }),
      },
    })
    child.on('error', reject)
    child.on('exit', (code) => accept(code ?? 1))
  })
  process.exitCode = exitCode
} finally {
  await rm(dir, { recursive: true, force: true })
}
