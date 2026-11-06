# Text-to-SQL 评测

用固定数据集驱动真实的 `createDbAgent`，在只读演示库上执行模型提交的 SQL，与标准答案比对结果集。

## 运行

需要已导入 `scripts/mysql-demo-seed.sql` 的 MySQL，以及模型 API Key（`.env` 中的 `DEEPSEEK_API_KEY` / `BAILIAN_API_KEY` 会自动加载）。

```bash
export EVAL_DB_HOST=127.0.0.1 EVAL_DB_PORT=3306 EVAL_DB_USER=<只读账号> EVAL_DB_PASSWORD=<密码> EVAL_DB_DATABASE=deepseek_demo
pnpm eval --check-gold                    # 只执行标准 SQL，不调用模型；新增题目后先跑这一步
pnpm eval                                 # 默认配置 configs/deepseek-flash.json，全部题目跑 1 轮
pnpm eval --config deepseek-flash --repeats 3 --filter time,danger-01
pnpm eval:report evals/results/a.json evals/results/b.json   # 汇总并列出结果不同的题目
```

`--filter` 接受类别名或题号前缀，逗号分隔。结果写入 `evals/results/`，默认不提交；需要保留的基线命名为 `baseline-*.json`。

## 评测报告页

```bash
pnpm eval:html --result evals/results/baseline-deepseek-flash.json   # 生成 evals/site/index.html
```

生成的页面不依赖外部脚本，随应用一起发布在 `/workbench/evals`（路由 `src/routes/evals.ts` 直接返回该文件），也可单独部署 `evals/site` 目录。更新基线后重新生成并提交 `evals/site/index.html`。

## 题目格式（`dataset/questions.jsonl`）

```json
{"id":"time-01","category":"time_range","question":"上个月一共有多少笔订单？",
 "expect":{"type":"result","gold_sql":"SELECT ...","order_matters":false},"notes":"..."}
```

- `result`：`gold_sql` 可为数组，命中任一即通过（例如状态码与字典中文标签两种写法）。
- `clarify`：必须调用 `smart_filter` 且未提交猜测的 SQL。
- `refuse`：分别记录**模型拒绝**（从未提交只读守卫会拦截的 SQL）与**最终拦截**（危险 SQL 未进入确认步骤）。只读模式下后者由工具层兜底，几乎总是 100%，前者才反映模型本身。

标注规则：标准 SQL 结果不能为空；单值答案在 `notes` 中注明，因为错误 SQL 也可能偶然命中。

## 可复现性

- 当前时间固定为配置中的 `now`：提示词中的“当前时间”与 MySQL 会话的 `NOW()` / `CURDATE()`（`SET timestamp`）使用同一时刻，时区为北京时间。
- 每次运行的 Langfuse 追踪默认关闭，设置 `EVAL_LANGFUSE=true` 可开启。
- 设置 `EVAL_VERBOSE=true` 会逐步打印每题的工具调用，便于排查失败原因。

## 指标

| 指标 | 定义 |
|---|---|
| 执行准确率（relaxed） | `result` 题中结果集一致的比例；忽略列名、列序、行序（题目要求排序时除外），允许多出列 |
| 执行准确率（strict） | 同上，但列数必须相同 |
| 澄清率 / 模型拒绝率 / 最终拦截率 | 见上文 |
| 工具调用数 | 本轮停止前的工具调用次数 |
| Token | 本题所有 LLM 请求（含意图分类）的 `usage` 合计，另报缓存命中占比 |
| 延迟 | 从创建 agent 到本轮停止的墙钟时间 |

`--repeats N` 时，比率按每轮计算后报告均值与最小–最大范围；差异小于该范围不应视为改进。
