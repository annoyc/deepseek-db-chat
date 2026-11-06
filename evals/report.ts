import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { formatSummary, summarize, type CaseResult } from './summary'

// Usage: pnpm eval:report <result.json> [<other.json> ...]
// One file prints its summary; several also list the cases whose outcome differs.

const files = process.argv.slice(2)
if (!files.length) throw new Error('Pass one or more result files from evals/results/')
const reports = await Promise.all(files.map(async file => {
  const report = JSON.parse(await readFile(resolve(file), 'utf8')) as { config: { name: string }; results: CaseResult[] }
  return { name: `${report.config.name} (${file.split(/[\\/]/).at(-1)})`, results: report.results }
}))
for (const report of reports) console.log(formatSummary(report.name, summarize(report.results)) + '\n')

if (reports.length > 1) {
  const passRate = (results: CaseResult[], id: string) => {
    const runs = results.filter(r => r.id === id)
    return runs.length ? runs.filter(r => r.pass).length / runs.length : NaN
  }
  const ids = [...new Set(reports.flatMap(r => r.results.map(x => x.id)))].sort()
  const changed = ids.filter(id => new Set(reports.map(r => passRate(r.results, id))).size > 1)
  console.log(`### Cases whose pass rate differs (${changed.length})\n`)
  console.log(`| Case | ${reports.map((_, i) => `#${i + 1}`).join(' | ')} |`)
  console.log(`|---|${reports.map(() => '---').join('|')}|`)
  for (const id of changed) {
    console.log(`| ${id} | ${reports.map(r => { const v = passRate(r.results, id); return Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%` }).join(' | ')} |`)
  }
}
