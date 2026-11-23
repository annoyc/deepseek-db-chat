# 数问工作台 — 专业级能力差距分析与演进记录

本文档最初在项目早期版本（MVP 阶段）撰写，用于对照「专业级数据库分析与 AI 工程工具」梳理短板。随着架构迭代，原 P0 / P1 及大部分 P2 项已落地；下文保留七大维度的对比基线，并标注各项的**当前状态与对应实现**，便于追溯架构演进与后续规划。

---

## 演进总览

| 优先级 | 核心议题 | 当前状态 | 关键实现 |
|---|---|---|---|
| **P0** | 外键关系提取与表关系图谱 | ✅ 已完成 | `src/server/database.ts`（提取 `KEY_COLUMN_USAGE` 与外键映射） |
| **P0** | `get_database_overview` 全局扫描工具 | ✅ 已完成 | `src/server/tools.ts`（含表注释、行数估算、外键与相关性子集筛选） |
| **P0** | 分层系统提示词 + Few-shot JOIN 示例 | ✅ 已完成 | `src/server/agent.ts`（核心规则 / 元数据直答 / 工作流 / Few-shot / 分析规范） |
| **P1** | SQL 安全校验升级为 AST 语法树解析 | ✅ 已完成 | `src/lib/sql-guard.ts` + `src/server/sql-policy.ts`（`node-sql-parser`，无正则兜底） |
| **P1** | 查询行数硬上限、EXPLAIN 与取消机制 | ✅ 已完成 | `LIMIT 500+1` 哨兵行截断检测、`explain_sql`、`AbortSignal` 中断连接 |
| **P1** | 复杂查询规划、参数澄清与错误自愈 | ✅ 已完成 | `plan_query`、`smart_filter`（`suspend/resume`）、结构化 SQL 错误分类 |
| **P2** | 统计摘要、分页排序、CSV 导出与双轴图 | ✅ 已完成 | `src/lib/result-data.ts`、`ResultTable.tsx`、`ResultChart.tsx`、`DataSummary.tsx` |
| **P2** | SSL/TLS 证书校验与只读演示库隔离 | ✅ 已完成 | `src/server/database-connection.ts`、`src/server/demo-database.ts` |
| **P2** | 离线回归测试 + 量化 Eval 评测体系 | ✅ 已完成 | 200+ 单元测试、Text-to-SQL 评测（含 `/workbench/evals` 报告）、89 题 RAG 检索与忠实度评测 |
| **P2** | 多数据库驱动抽象（PostgreSQL / SQLite） | 🚧 规划中 | 当前聚焦 MySQL 8.x，后续抽象 `DatabaseDialect` 接口并拆分 `database.ts` |
| **P2** | 公网部署加固（SSRF 校验 / 限流 / 连接池 LRU） | 🚧 规划中 | 当前依赖反代限流与部署边界约束（见 `OPERATIONS.md`） |
| **P3** | 前端 ErrorBoundary、Linter 与 Playwright E2E | 🚧 规划中 | 当前已覆盖 SSR 组件断言与核心离线回归，浏览器端到端验收待补齐 |

---

## 一、Schema 信息与连表准确性

- ✅ **外键关系与表关系图谱**：从 `INFORMATION_SCHEMA.KEY_COLUMN_USAGE` 提取外键并在 `get_database_overview` / `get_table_schema` 中输出。
- ✅ **表注释与行数估算**：返回 `TABLE_COMMENT` 与近似行数，并对大库做基于查询词与外键连通性的 Schema 子集裁剪（`src/server/schema-subsetting.ts`）。
- ✅ **枚举与业务字典自动探测**：自动识别 `ENUM(...)` 以及中后台常见字典表（如 `sys_dict_data`），将状态码与中文业务标签映射注入 Schema 上下文。
- ✅ **元数据问题直答**：新增 `list_tables` 精准统计 `BASE TABLE` / `VIEW`，避免为表数量、表清单类问题生成冗余 SQL。

---

## 二、SQL 安全校验与服务端策略

- ✅ **AST 语法树校验（Fail-Closed）**：`src/lib/sql-guard.ts` 使用 `node-sql-parser` 解析单条语句，拒绝多语句、MySQL/MariaDB 可执行注释（`/*!` / `/*M!`）、`SELECT INTO`、锁定读取、会话变量赋值 `:=` 与危险函数（`LOAD_FILE`、`SLEEP`、`BENCHMARK` 等）；无法可靠解析的 SQL 直接拒绝，不再回退关键词匹配。
- ✅ **服务端策略隔离**：`src/server/sql-policy.ts` 强制默认只读；演示库与生产标签始终禁止写入，非生产写入需服务端显式开启 `SQL_WRITE_ENABLED=true` 并命中精确 `SQL_WRITE_ALLOWLIST`。
- ✅ **统一出口脱敏与凭据加密**：模型出口与遥测入口统一执行 PII 脱敏（`src/lib/masking.ts`）；数据库密码与用户 API Key 使用 AES-256-GCM 加密（`src/server/crypto.ts`）。
- 🚧 **待加固项**：自定义模型 `baseURL` 与自定义数据库 `host` 的内网/元数据 IP（SSRF）校验、以及公开站点的应用层 IP 限流。

---

## 三、查询执行层保护机制

- ✅ **强制结果上限与截断标识**：`prepareSqlForExecution` 自动改写或追加外层 `LIMIT maxRows + 1`（默认 500 行），通过哨兵行精确区分“刚好 500 行”与“被截断”。
- ✅ **EXPLAIN 预分析**：提供 `explain_sql` 工具并在前端展示查询计划预警。
- ✅ **查询取消与超时**：支持 `AbortSignal` 中断已确认 SQL 执行连接，元数据查询与执行查询均有明确超时上限，BigInt 采用 `bigNumberStrings: true` 避免精度丢失。
- 🚧 **待加固项**：`src/server/database.ts` 中的连接池与字典缓存 `Map` 目前无容量上限与空闲自动回收（建议引入 LRU + TTL）。

---

## 四、Agent 编排与准确性

- ✅ **原生 `suspend / resume` 人机协同**：`execute_sql` 与 `smart_filter` 不再依赖硬编码提前中断流，而是通过 `src/core/generate/suspend.ts` 挂起 Agent 状态并在用户确认/修改/取消后无缝恢复。
- ✅ **分层 Prompt 与前缀缓存**：将系统提示词分为静态核心层与动态上下文层，确定性消息构造最大化 DeepSeek 前缀缓存命中率（评测实测命中率 > 85%）。
- ✅ **复杂查询规划与防死循环**：提供 `plan_query`（自动批量拉取相关表 Schema）、`report_analysis`（结构化指标卡片），Agent 循环内置重复工具调用检测与强制收口、上下文自动压缩（`src/core/context/compact.ts`）和首包前流式重试。

---

## 五、数据展示与分析能力

- ✅ **表格增强**：支持全量返回行排序（跨分页不改变原结果）、分页浏览、数值智能格式化与千分位、Markdown 复制和带 UTF-8 BOM 的 CSV 导出（`ResultTable.tsx`）。
- ✅ **可视化升级**：支持柱状图、折线图、饼图、自动双轴量级分离、KPI 卡片与列级统计摘要（`ResultChart.tsx`、`MetricCards.tsx`、`DataSummary.tsx`），并将统计摘要传给模型避免仅看样本行产生偏差。
- 🚧 **后续演进**：更多高阶图表（热力图、散点图）以及多轮查询结果的并排对比。

---

## 六、数据库支持与安全边界

- ✅ **TLS/SSL 校验**：支持 Aiven 自动强制 TLSv1.2+、证书主机名校验、用户导入 PEM CA 证书及部署方按主机名预置 CA（`src/server/database-connection.ts`）。
- ✅ **表名与连接隔离**：Schema 检查严格校验表名存在性；内置演示库凭据始终保留在服务端，浏览器不可见且不可修改。
- 🚧 **后续演进**：抽象 `DatabaseDialect` 接口以扩展 PostgreSQL / SQLite，并按需规划团队化多租户身份认证与字段级权限控制（详见 `OPERATIONS.md`）。

---

## 七、工程质量、测试与评测体系

- ✅ **离线回归与 CI**：覆盖 SQL AST 防护、凭据隔离、PII 脱敏、Agent 生命周期与挂起恢复、RAG 切块/混合检索/引用校验、前端交互与结果展示等 200+ 离线用例，接入 GitHub Actions（`.github/workflows/check.yml`）。
- ✅ **双引擎量化 Eval 体系**：
  - Text-to-SQL：基于固定时钟与只读演示库的自动化评测，输出执行准确率、澄清率、模型自拒 vs 最终拦截率、Token/缓存命中率与静态 HTML 报告页（`/workbench/evals`）。
  - RAG 知识库：89 题电力市场规则评测集，支持离线消融实验、问题改写/混合检索对比、端到端引用准确率与 LLM-as-a-Judge 忠实度评分（`evals/knowledge/`）。
- ✅ **可观测性**：集成 Langfuse + OpenTelemetry，默认仅采集运行元数据，开启正文采集时仍经过脱敏。
- 🚧 **后续演进**：补充 React `ErrorBoundary` / Router `errorComponent`、引入 Biome/ESLint 静态检查、升级多阶段非 root `Dockerfile`，以及补齐 Playwright 浏览器端到端测试。
