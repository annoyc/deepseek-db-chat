import test from 'node:test'
import assert from 'node:assert/strict'
import pkg from 'node-sql-parser'
import { prepareSqlForExecution, validateSql } from '@/lib/sql-guard'
import { resolveSqlPermission } from '@/server/sql-policy'

const parser = new pkg.Parser()
const astOf = (sql: string): any => parser.astify(sql, { database: 'MySQL' })

test('SQL guard rejects executable comments, parser failures and multiple statements', () => {
  for (const sql of [
    'SELECT 1 /*!50000 , SLEEP(10) */',
    'SELECT 1 /*M! , SLEEP(10) */',
    "SELECT GET_LOCK('local-test', 1) FOR SHARE",
    'SELECT * FROM',
    'SELECT 1; DELETE FROM users',
    'SELECT 1; SELECT 2',
    'SELECT 1 /* unterminated',
  ]) assert.equal(validateSql(sql).allowed, false, sql)
})

test('dangerous function calls and SELECT side effects are blocked even when nested', () => {
  for (const sql of [
    'SELECT IF(1, SLEEP(1), 0)',
    "SELECT * FROM t WHERE id = (SELECT GET_LOCK('local-test', 1))",
    "SELECT 1 INTO OUTFILE '/tmp/never-written'",
    'SELECT 1 INTO @state',
    'SELECT @state := 1',
    'SELECT * FROM t FOR UPDATE',
    'DROP TABLE t',
    'WITH cte AS (SELECT 1) UPDATE users SET active=0',
  ]) assert.equal(validateSql(sql).allowed, false, sql)
})

test('ordinary comments and SQL keywords inside quoted values do not trigger false blocks', () => {
  for (const sql of [
    "SELECT 'DROP shipment; -- text' AS status",
    "SELECT '/* ! text */' AS note",
    "SELECT 'it''s safe # text' AS note",
    '/* normal comment */ SELECT 1 # trailing comment',
    'SHOW TABLES', 'SHOW INDEX FROM users', 'SHOW CREATE TABLE users',
    'DESCRIBE users', 'EXPLAIN SELECT * FROM users',
  ]) assert.equal(validateSql(sql).allowed, true, sql)
})

test('outer SELECT limit is added despite a string, comment, CTE or nested limit', () => {
  for (const sql of [
    '/* report */ SELECT * FROM orders',
    "SELECT 'LIMIT 1' AS note FROM orders",
    'SELECT * FROM orders WHERE id IN (SELECT id FROM items LIMIT 1)',
    'WITH cte AS (SELECT * FROM orders LIMIT 1) SELECT * FROM cte',
  ]) {
    const prepared = prepareSqlForExecution(sql)
    assert.equal(astOf(prepared.sql).limit.value[0].value, 501, sql)
    assert.equal(prepared.resultLimitApplied, true)
  }
})

test('large limits are clamped with offsets retained; small explicit limits stay unchanged', () => {
  for (const [sql, values] of [
    ['SELECT * FROM t LIMIT 1000000', [501]],
    ['SELECT * FROM t LIMIT 20, 1000000', [20, 501]],
    ['SELECT * FROM t LIMIT 1000000 OFFSET 20', [501, 20]],
    ['SELECT * FROM t LIMIT 0', [0]],
    ['SELECT * FROM t LIMIT 10', [10]],
  ] as const) {
    const prepared = prepareSqlForExecution(sql)
    assert.deepEqual(astOf(prepared.sql).limit.value.map((item: any) => item.value), values)
    assert.equal(prepared.resultLimitApplied, sql.includes('1000000'))
  }
})

test('UNION limits apply to the compound result, preserving branch limits', () => {
  const simple = astOf(prepareSqlForExecution('SELECT * FROM t UNION ALL SELECT * FROM u LIMIT 1000000').sql)
  assert.equal(simple._next.limit.value[0].value, 501)
  const parenthesized = astOf(prepareSqlForExecution('(SELECT * FROM t LIMIT 5) UNION ALL (SELECT * FROM u LIMIT 10)').sql)
  assert.equal(parenthesized.limit.value[0].value, 5)
  assert.equal(parenthesized._next.limit.value[0].value, 10)
  assert.equal(parenthesized._limit.value[0].value, 501)
  const existingOuter = astOf(prepareSqlForExecution('(SELECT * FROM t LIMIT 5) UNION ALL (SELECT * FROM u LIMIT 10) LIMIT 10000').sql)
  assert.equal(existingOuter._limit.value[0].value, 501)
})

test('SHOW and EXPLAIN are preserved without appending invalid LIMIT clauses', () => {
  for (const sql of ['SHOW TABLES', 'SHOW INDEX FROM users', 'DESCRIBE users', 'EXPLAIN SELECT * FROM users']) {
    const prepared = prepareSqlForExecution(sql)
    assert.equal(prepared.isSelect, false)
    assert.equal(prepared.resultLimitApplied, false)
    assert.doesNotMatch(prepared.sql, /LIMIT 501/)
  }
})

test('limiting preserves precise decimal and bigint predicates rather than round-tripping literals', () => {
  const source = "SELECT * FROM users WHERE amount = 1234567890.1234567890 AND id = 9007199254740993 AND note = 'LIMIT 1' LIMIT 99999"
  const prepared = prepareSqlForExecution(source)
  assert.equal(prepared.sql, source.replace(/LIMIT 99999$/, 'LIMIT 501'))
  const write = 'UPDATE balances SET amount = 1234567890.1234567890 WHERE id = 9007199254740993'
  assert.equal(prepareSqlForExecution(write, 'write').sql, write)
})

test('write access requires explicit server enablement AND exact target allowlist; prod is denied', () => {
  const previousEnabled = process.env.SQL_WRITE_ENABLED
  const previousAllowlist = process.env.SQL_WRITE_ALLOWLIST
  const connection = { host: 'db.internal', port: 3306, database: 'sandbox', env: 'dev' as const }
  try {
    delete process.env.SQL_WRITE_ENABLED
    delete process.env.SQL_WRITE_ALLOWLIST
    assert.equal(resolveSqlPermission(connection, 'write'), 'readonly')
    process.env.SQL_WRITE_ENABLED = 'true'
    assert.equal(resolveSqlPermission(connection, 'write'), 'readonly')
    process.env.SQL_WRITE_ALLOWLIST = 'db.internal:3306/sandbox'
    assert.equal(resolveSqlPermission(connection, 'write'), 'write')
    assert.equal(resolveSqlPermission(connection), 'readonly')
    assert.equal(resolveSqlPermission({ ...connection, env: 'prod' }, 'write'), 'readonly')
    assert.equal(resolveSqlPermission({ ...connection, database: 'production' }, 'write'), 'readonly')
    assert.equal(resolveSqlPermission({ ...connection, database: 'SANDBOX' }, 'write'), 'readonly')
    assert.equal(resolveSqlPermission({ ...connection, port: 3307 }, 'write'), 'readonly')
  } finally {
    if (previousEnabled === undefined) delete process.env.SQL_WRITE_ENABLED
    else process.env.SQL_WRITE_ENABLED = previousEnabled
    if (previousAllowlist === undefined) delete process.env.SQL_WRITE_ALLOWLIST
    else process.env.SQL_WRITE_ALLOWLIST = previousAllowlist
  }
})
