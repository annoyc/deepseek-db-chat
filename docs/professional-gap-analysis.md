## DBPilot — 专业级数据库分析能力差距分析

基于对项目全部源码的深入审阅，以下从七个维度分析当前项目与"专业级数据库分析工具"之间的差距，并给出具体的改进方向和优先级建议。

---

### 一、Schema 信息严重不足 — 连表查询的核心瓶颈

这是当前项目最大的短板，直接决定了 AI 能否写出正确的复杂连表 SQL。

**当前状态：** `getTableSchema()` 只返回了字段名、字段类型、是否可空、索引和注释。缺失了以下关键信息：

**外键关系完全缺失。** 没有从 `INFORMATION_SCHEMA.KEY_COLUMN_USAGE` 和 `REFERENTIAL_CONSTRAINTS` 中提取外键关系。对于复杂连表查询，AI 必须知道"表A的哪个字段关联表B的哪个字段"，否则只能靠猜测字段名来写 JOIN 条件。这在生产数据库中几乎不可能猜对。建议新增 `FOREIGN KEY (order_user_id) REFERENCES users(id)` 这样的关系描述。

**表关系图谱缺失。** 专业的做法是构建一张全局的表关系图（ER 图），在 system prompt 中注入。可以是一个 `buildRelationshipMap()` 工具，扫描所有外键后生成类似 `users → orders (users.id = orders.user_id)` 的摘要，让 AI 在写 SQL 前就对整个数据库的关系结构有全局认知。

**没有 ENUM 值域信息。** 当字段类型是 `ENUM('active','inactive','deleted')` 时，当前只返回了 `enum(...)` 这样的原始类型字符串，但没有明确告诉 AI 每个枚举值的业务含义。AI 在生成 `WHERE status = ?` 时经常用错枚举值。

**没有表行数/数据量估算。** 专业的数据库分析工具应该在 schema 中包含每张表的近似行数（`SELECT TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES`），帮助 AI 判断是否需要加 LIMIT，以及选择合适的聚合策略。

**没有表注释。** `INFORMATION_SCHEMA.TABLES` 中的 `TABLE_COMMENT` 包含了表的业务描述，这对 AI 理解表用途至关重要。

**建议新增工具：** `get_database_overview` — 一次性返回整个数据库的表列表、表注释、行数估算、以及表之间的外键关系摘要。这可以作为 AI 的第一步调用，替代当前的 `list_tables` + 多次 `get_table_schema` 模式，大幅减少 token 消耗和调用轮次。

---

### 二、SQL 安全校验不够严谨 — 关键字匹配 vs AST 解析

**当前状态：** `sql-guard.ts` 使用正则表达式做白名单+黑名单的双重校验。

**核心问题：**

**关键字匹配无法处理嵌套场景。** 比如 `SELECT * FROM users WHERE id IN (SELECT id FROM secret_table)` — 首关键字是 SELECT，白名单通过，但子查询中可能引用了不该访问的表。类似地，`SELECT LOAD_FILE('/etc/passwd')` 的首关键字也是 SELECT，但黑名单正则 `LOAD\s+DATA` 不会匹配 `LOAD_FILE`。

**没有 SQL 注入防护。** 虽然当前 AI 生成的 SQL 不太可能恶意注入，但如果 AI 在 WHERE 条件中拼接了用户输入的字符串值（如 `WHERE name = '用户输入'`），没有做转义处理。建议在 `executeQuery()` 层面对字符串值进行基本的转义检查。

**黑名单覆盖不全。** 当前缺失：`EXEC`/`EXECUTE`（存储过程调用）、`SET`（会话变量修改）、`SIGNAL`（触发异常）、`HANDLER`（MySQL handler 语句）、`BENCHMARK()`（计时攻击函数）等。

**建议方案：** 引入轻量级的 SQL AST 解析器（如 `node-sql-parser`），对 SQL 做语法树级别的校验。这样可以精确地：检测所有子查询中引用的表名是否在白名单内、识别所有函数调用中的危险函数、精确提取 SQL 中涉及的表名用于权限控制。

---

### 三、查询执行层缺乏保护机制

**当前状态：** `executeQuery()` 只有 60 秒超时，没有行数限制。

**核心问题：**

**没有结果行数限制。** 如果 AI 生成了 `SELECT * FROM huge_table`（即使带了 LIMIT 1000），查询可能返回大量数据，消耗内存并导致前端渲染卡死。建议硬编码 `LIMIT 500` 上限，并在 SQL 没有 LIMIT 时自动追加。

**没有 EXPLAIN 预分析。** 专业的做法是在执行查询前，先执行 `EXPLAIN` 分析执行计划。如果发现全表扫描（type=ALL）或潜在的大表操作，可以提前警告用户或拒绝执行。

**连接池缺乏健康管理。** `getPool()` 创建了连接池但没有健康检查机制。如果 MySQL 服务重启或网络中断，旧连接会变成死连接。建议增加 `pool.on('connection')` 健康检测和 `pool.end()` 的超时回收。

**没有查询取消机制。** 一旦开始执行，用户无法中止一个正在运行的慢查询。建议在 `executeQuery()` 中接受 `AbortSignal`，通过 `conn.destroy()` 实现取消。

**BigInt 转换不安全。** 当前使用 `JSON.parse(JSON.stringify(rows, ...))` 处理 BigInt，对于超大数值（超过 `Number.MAX_SAFE_INTEGER`）会丢失精度。建议使用 `String(value)` 保持精度。

---

### 四、Agent 智能和准确性提升

**当前状态：** system prompt 长达约 3000 字，包含大量"禁止"和"规则"，但没有 few-shot 示例。

**核心问题：**

**缺少 few-shot 示例。** 这是提升 SQL 生成准确率最有效的手段之一。建议在 system prompt 或 few-shot 中加入 3-5 个典型的连表查询示例，涵盖：简单聚合（`SELECT COUNT(...)`）、多表 JOIN（`SELECT ... FROM a JOIN b ON ...`）、子查询（`SELECT ... WHERE id IN (SELECT ...)`）、时间范围查询、以及 GROUP BY + HAVING 等场景。

**没有查询规划能力。** 面对复杂问题（如"统计每个部门本月销售额最高的前3个产品"），AI 应该先分解问题、规划多步查询策略，再逐步执行。当前 system prompt 虽然提到了"分步进行"，但没有显式的规划步骤。建议加入一个 `plan_query` 工具或在 prompt 中强制要求输出查询计划。

**缺少 SQL 自纠错机制。** 当 SQL 执行失败后，AI 会收到错误信息并重试，但没有结构化的错误分析流程。建议在 `continueWithSqlError()` 的 prompt 中要求 AI 先分析错误类型（语法错误、字段不存在、表不存在等），再有针对性地修复。

**System prompt 过度膨胀。** 大量"绝对禁止"的规则实际上效果递减。LLM 对过长 system prompt 中的指令遵循率会下降。建议将规则按优先级分层：核心规则（3-5 条）放在最前面并加粗强调，次要规则精简或移除。

**上下文中的执行日志无限增长。** `executionLog` 会随会话不断追加，全部注入 system prompt。长对话中这会消耗大量 token 且稀释关键信息。建议只保留最近 5-10 条执行记录，或做摘要压缩。

---

### 五、数据展示与分析能力不足

**当前状态：** 查询结果通过 `ResultTable` 和 `ResultChart` 展示，支持基本的表格和图表。

**核心问题：**

**结果截断过于简单。** `formatSqlResultForAI()` 中硬编码了 `slice(0, 50)` 行，但传递给 AI 的数据没有做智能摘要。对于 1000 行的结果，AI 只看到了前 50 行就下结论，可能导致分析不准确。建议：对数值列做统计摘要（min/max/avg/sum），对分类列做频次统计，让 AI 基于统计信息做分析。

**没有结果缓存和分页。** 前端展示大量数据时没有分页，用户无法浏览完整结果。

**缺少数据导出功能。** 专业分析工具应该支持将结果导出为 CSV、Excel 等格式。

**图表类型有限。** 目前只支持 bar/line/pie，缺少散点图、热力图、堆叠图等高级可视化。

**没有多查询结果对比能力。** 当用户先后执行了多个查询后，无法将多个结果集放在一起对比分析。

---

### 六、数据库支持与安全加固

**当前状态：** 仅支持 MySQL，连接信息 AES-256 加密存储。

**核心问题：**

**仅支持 MySQL。** 专业数据库分析工具至少应支持 PostgreSQL、SQLite、SQL Server。建议抽象数据库驱动层为统一接口（`DatabaseDriver` interface），让工具层不依赖特定数据库方言。

**没有 SSL/TLS 连接支持。** 生产环境的数据库连接几乎都需要 SSL。`mysql2` 的 `createPool` 支持 `ssl` 选项但当前未使用。

**没有只读用户验证。** 虽然 SQL guard 做了关键字过滤，但更安全的做法是在数据库连接层面使用只读账号。建议在连接测试时检测当前用户的权限级别。

**表名注入风险。** `getTableSchema()` 中使用 `` SHOW INDEX FROM `${tableName}` `` 拼接表名，如果 tableName 包含恶意字符（如 `` `; DROP TABLE users; -- ``），虽然有 backtick 包裹但没有做表名校验。建议先检查表名是否存在于 `listTables()` 的结果中。

---

### 七、工程质量与可维护性

**缺少测试覆盖。** 项目中没有任何单元测试、集成测试或端到端测试。对于 SQL 生成这样的关键功能，至少应该有：SQL guard 的单元测试（覆盖各种边界情况）、PII masking 的单元测试、Agent 工具调用的集成测试、以及 SQL 生成准确率的评估基准（benchmark）。

**没有评估（Eval）框架。** 专业项目应该有 SQL 生成准确率的量化评估体系。建议建立一套测试用例集（如 Spider 或 BIRD benchmark 的子集），每次迭代后评估准确率变化。

**IndexedDB 没有版本迁移策略。** 当前 `db.ts` 只有 `version(1)`，未来如果需要修改数据结构（如添加索引字段），缺乏平滑迁移机制。

**前端缺少错误边界。** 如果 Agent 返回了异常数据，可能导致整个 React 应用崩溃。建议在关键组件外包裹 `ErrorBoundary`。

**`buildApiHistory()` 的消息构造不够精确。** 执行日志被追加为 `role: 'user'` 的消息，这不符合实际的消息流向。更准确的做法是将其作为 `role: 'system'` 或 `role: 'tool'` 消息注入，避免混淆 AI 对用户消息和历史记录的理解。

---

### 优先级排序（按对连表 SQL 准确率的影响程度）

**P0 — 必须立即解决：**
1. Schema 信息增加外键关系和表关系图谱（直接决定 JOIN 是否正确）
2. 增加 few-shot 示例（最直接提升 SQL 准确率的手段）
3. `get_database_overview` 工具（减少调用轮次，提供全局视图）

**P1 — 近期必须完善：**
4. SQL 安全校验升级为 AST 解析
5. 查询结果行数限制和 EXPLAIN 预分析
6. SQL 自纠错机制优化
7. System prompt 精简和分层

**P2 — 中期增强：**
8. 结果智能摘要（统计信息替代原始行截断）
9. 多数据库支持（PostgreSQL 优先）
10. 评估框架搭建
11. SSL/TLS 连接支持

**P3 — 长期演进：**
12. 数据导出功能
13. 高级图表可视化
14. 查询计划可视化
15. 多查询结果对比
