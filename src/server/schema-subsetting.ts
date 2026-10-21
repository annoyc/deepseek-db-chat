/**
 * Schema Subsetting — Relevance-based table scoring for large databases.
 *
 * When a database has many tables, sending the full overview to the model
 * dilutes attention and wastes tokens. This module scores tables by
 * relevance to the user's current query and returns only the top-K,
 * plus relationship-connected tables.
 */

const MAX_OVERVIEW_TABLES = 40

interface TableMeta {
  name: string
  comment: string
  rowCount: number | null
}

interface ForeignKeyEdge {
  from: string
  to: string
}

interface SubsetResult {
  tables: TableMeta[]
  hiddenCount: number
  totalCount: number
}

/**
 * Tokenize a Chinese/English mixed string into searchable terms.
 * Splits on underscores, camelCase boundaries, spaces, and individual CJK characters.
 */
function tokenize(text: string): string[] {
  if (!text) return []
  const parts = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  const cjkChars = text.match(/[\u4e00-\u9fff]/g) || []
  return [...parts, ...cjkChars]
}

/**
 * Score a table's relevance to the user query.
 * Uses keyword overlap between query tokens and table name/comment.
 */
function scoreTable(table: TableMeta, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0

  const nameTokens = tokenize(table.name)
  const commentTokens = tokenize(table.comment)
  const allTableTokens = new Set([...nameTokens, ...commentTokens])

  let matchCount = 0
  for (const qt of queryTokens) {
    for (const tt of allTableTokens) {
      if (tt.includes(qt) || qt.includes(tt)) {
        matchCount++
        break
      }
    }
  }

  return matchCount / queryTokens.length
}

/**
 * Given a full table list, user query, and FK edges, return a subset
 * of relevant tables for the model's context.
 */
export function subsetTables(
  tables: TableMeta[],
  userQuery: string,
  fkEdges: ForeignKeyEdge[],
  seedTables?: string[],
): SubsetResult {
  if (tables.length <= MAX_OVERVIEW_TABLES) {
    return { tables, hiddenCount: 0, totalCount: tables.length }
  }

  const queryTokens = tokenize(userQuery)

  const scored = tables.map(t => ({
    table: t,
    score: scoreTable(t, queryTokens),
  }))

  scored.sort((a, b) => b.score - a.score)

  const selectedSet = new Set<string>()
  const selected: TableMeta[] = []

  // Phase 0: Force-include seed tables (from intent classifier's suggestedTables),
  // matched case-insensitively against real table names. These are guaranteed
  // visible regardless of keyword overlap score.
  if (seedTables && seedTables.length > 0) {
    const seedLower = new Set(seedTables.map(t => t.toLowerCase()))
    for (const t of tables) {
      if (selected.length >= MAX_OVERVIEW_TABLES) break
      if (seedLower.has(t.name.toLowerCase()) && !selectedSet.has(t.name.toLowerCase())) {
        selected.push(t)
        selectedSet.add(t.name.toLowerCase())
      }
    }
  }

  // Reserve up to a quarter of the budget for one-hop join dependencies.
  const relevanceBudget = fkEdges.length > 0 ? MAX_OVERVIEW_TABLES - 10 : MAX_OVERVIEW_TABLES
  for (const { table, score } of scored) {
    if (selectedSet.has(table.name.toLowerCase())) continue
    if (selected.length >= relevanceBudget) break
    if (score <= 0 && selected.length >= MAX_OVERVIEW_TABLES / 2) break
    selected.push(table)
    selectedSet.add(table.name.toLowerCase())
  }

  // Expand from the relevance snapshot only, avoiding order-dependent traversal.
  const roots = new Set(selectedSet)
  const tableByName = new Map(tables.map(t => [t.name.toLowerCase(), t]))
  for (const edge of fkEdges) {
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const target = to.toLowerCase()
      if (selected.length >= MAX_OVERVIEW_TABLES) break
      if (!roots.has(from.toLowerCase()) || selectedSet.has(target)) continue
      const linked = tableByName.get(target)
      if (linked) {
        selected.push(linked)
        selectedSet.add(target)
      }
    }
  }

  // Phase 3: If still have room, fill with highest-row-count tables
  if (selected.length < MAX_OVERVIEW_TABLES) {
    const remaining = tables.filter(t => !selectedSet.has(t.name.toLowerCase()))
    remaining.sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))
    for (const t of remaining) {
      if (selected.length >= MAX_OVERVIEW_TABLES) break
      selected.push(t)
      selectedSet.add(t.name.toLowerCase())
    }
  }

  selected.sort((a, b) => a.name.localeCompare(b.name))

  return {
    tables: selected,
    hiddenCount: tables.length - selected.length,
    totalCount: tables.length,
  }
}
