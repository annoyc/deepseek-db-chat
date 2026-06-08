<p align="center">
  <h1 align="center">DBPilot</h1>
</p>

<p align="center">
  基于 DeepSeek 原生优化的 AI 数据库领航助手 — 自然语言转 SQL，实时思考过程可视化，人工确认安全机制，以及自动数据可视化。
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat&colorA=080f12&colorB=1fa669" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg?style=flat&colorA=080f12&colorB=1fa669" alt="Node">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat&colorA=080f12&colorB=1fa669" alt="TypeScript">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat&colorA=080f12&colorB=1fa669" alt="PRs Welcome">
</p>

<p align="center">
  <b><a href="./README.md">English</a></b> · <b><a href="./docs/getting-started.md">文档</a></b>
</p>

---

## 为什么选择 DBPilot？

通用 AI 数据库工具依赖通用大模型 SDK，无法正确处理 DeepSeek 独有的思考模式和缓存机制。DBPilot 针对 DeepSeek 从底层深度优化，解决了其他工具无法解决的问题。

### 极致成本

基于 DeepSeek 前缀缓存优化，上下文复用降低 API 调用开销。确定性消息构建与零冗余请求体确保缓存命中率最大化，以最低成本获得最佳性能。

### 安全可靠

敏感密码及密钥均使用 AES-256-GCM 加密存储。所有 SQL 查询经过**三重校验** — 正则黑名单快速拦截已知危险模式，`node-sql-parser` AST 深度分析精确提取函数与表名，执行前再由你人工确认，三道关卡确保危险操作（INSERT / UPDATE / DELETE / DROP）无法执行。SELECT 查询自动注入 500 行上限，防止慢查询拖垮数据库。查询结果中的 PII 数据（手机号、身份证、邮箱、银行卡号）在发送给 AI 模型前自动脱敏 — 你的敏感数据始终在你的掌控之中。

### ️过程透明

AI 思考过程与工具调用完全可视化，每一步推理和 SQL 生成都有迹可循、可审计。**AI 想什么，你就看到什么** — 拒绝黑箱操作。

### 隐私无忧

除对话外（敏感数据脱敏后再发送给模型），所有对话记录完全存储在本地，无服务端数据收集。**你的数据始终只属于你**。

---

## 核心特性

-  **极致成本** — DeepSeek 前缀缓存优化，上下文复用，确定性消息构建，最大化缓存命中率
-  **安全可靠** — AES-256 密码加密，SQL 三重校验（正则黑名单 + AST 深度分析 + 人工确认），危险操作多门拦截，PII 数据脱敏后再传输
-  **数据库全景** — 一键扫描全部表结构，含行数统计、表注释和外键关系映射，为 JOIN 查询提供精准依据
-  **外键感知** — Schema 检查自动提取 `INFORMATION_SCHEMA` 中的外键关系，AI 据此生成正确的多表 JOIN
-  **EXPLAIN 预分析** — 执行前可选的查询计划检查，自动预警全表扫描
-  **SQL 自纠正** — 失败时结构化错误分类（未知字段、表不存在、语法错误），引导 AI 智能修正而非盲目重试
- ️ **过程透明** — AI 思考过程与工具调用实时可视化，全程可审计
-  **隐私无忧** — 100% 本地存储，无云端交互，无服务端数据收集
-  **极致美观的数据可视化** — 查询结果自动渲染为交互式表格和图表（柱状图 / 折线图 / 饼图）
-  **弹性执行机制** — 自动重试 + 指数退避 + 可配置超时 + 智能错误恢复
- ️ **多数据库管理** — 从侧边栏添加、切换和管理多个 MySQL 连接
-  **智能 Agent 循环** — 内嵌 few-shot JOIN 示例的多步推理：全景扫描 → 检查表结构 → 生成 SQL → 确认 → 执行 → 出错自纠正
- ️ **默认思考模式** — `reasoning_content` 在多轮工具调用中正确管理，零配置
-  **SSE 流式传输** — 通过 Server-Sent Events 实时推送响应，即时反馈

---

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/annoyc/deepseek-db-chat.git
cd deepseek-db-chat

# 安装依赖
npm install

# 设置环境变量
cp .env.example .env
# 编辑 .env 并填入你的 DeepSeek API Key

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
npm run start
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **框架** | [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) |
| **AI 核心** | DeepSeek Agent Engine（基于 [deepseek-kit](https://github.com/FliPPeDround/deepseek-kit)） |
| **数据库** | [mysql2](https://github.com/sidorares/node-mysql2) |
| **UI** | React 19 + [Tailwind CSS v4](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) |
| **图表** | [Recharts](https://recharts.org/) |
| **Markdown** | [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) |
| **校验** | [Zod](https://zod.dev/) + [node-sql-parser](https://github.com/taozhi8833998/node-sql-parser)（AST SQL 分析） |
| **流式传输** | Server-Sent Events (SSE) |
| **构建** | [Vite](https://vite.dev/) |

---

## 项目结构

```
src/
├── core/               # DeepSeek Agent 引擎
│   ├── agent/          # Agent 创建与执行
│   ├── client/         # HTTP 客户端、SSE 流式请求、重试
│   ├── model/          # DeepSeek 模型封装
│   ├── tool/           # 工具定义与校验
│   ├── generate/       # Agent 循环、流式生成、结构化输出
│   ├── context/        # 上下文压缩
│   └── index.ts        # 公共 API 导出
├── server/             # 服务端逻辑
│   ├── agent.ts        # 数据库 Agent 配置 & 分层系统提示词（核心 + 工作流 + few-shot）
│   ├── tools.ts        # 数据库工具（overview, list_tables, get_schema, explain_sql, execute_sql）
│   ├── database.ts     # MySQL 连接池、外键提取、EXPLAIN、自动 LIMIT
│   └── functions/      # TanStack Server Functions（聊天、连接管理）
├── components/         # React 组件
│   ├── chat/           # 聊天 UI（消息、SQL 确认、图表、思考过程）
│   └── layout/         # 侧边栏、对话框、数据库列表
├── hooks/              # React Hooks（useChat, useDatabase, useSettings）
├── lib/                # 类型、常量、工具函数、PII 脱敏、AST SQL 校验器
├── routes/             # TanStack Router 页面
└── styles/             # 全局 CSS（Tailwind）
```

---


## License

[MIT](./LICENSE) 协议 © [annoyc](https://github.com/annoyc).
