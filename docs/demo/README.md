# 演示录制说明

三段 GIF 均录制于线上工作台（[数问 · 数据与知识工作台](https://deepseek-db-chat.vercel.app/workbench/dbpilot)），使用真实 **DeepSeek V4.1 Flash** 流式推理、内置只读 MySQL 演示库（数据来自仓库的 [合成电商数据脚本](../../scripts/mysql-demo-seed.sql)，不含真实客户数据）与内置全国电力市场规则语料。

| 文件 | 真实操作流程 |
| --- | --- |
| [schema-exploration.gif](./schema-exploration.gif) | 在 `/workbench/dbpilot` 免配置就绪状态下提问「当前数据库有多少张表？列出表名。」，元数据工具 `list_tables` 直接读取并返回 8 张基础表清单与结构说明。 |
| [sql-analysis.gif](./sql-analysis.gif) | 提问「按月统计 2026 年订单数与应付总额」，检查表结构后生成 SQL 并挂起等待确认；点击「确认执行」后在右侧数据面板联动查看自动双轴柱状图、切换双轴折线图，并查看表格与 KPI 分析摘要。 |
| [knowledge-rag.gif](./knowledge-rag.gif) | 在 `/workbench/knowledge` 提问「电力市场的构成是什么？」，依次完成脱敏检查、问题改写与拆解、RRF 检索与引用校验，输出带 `[n]` 条款出处与文件过有效期提示的回答，并展开右侧证据面板核查工具链与原文条款。 |

为便于阅读，动画在 `1440×900` 桌面布局（浅色主题、松石青配色）下截取真实交互关键帧，等比编码为 `1024×640` 并压缩了等待时间。分析文字由模型实时生成，查询结果来自只读 MySQL 实际执行的 SQL：2026 年 1–10 月 `orders` 表共返回 10 个月、累计 120 笔订单、应付总额 192,954.50 元（10 月样本截至 10 月 14 日，不覆盖整月）。

## 重新录制

1. 打开已配置内置只读演示库与服务端模型的工作台（或在隔离的本地环境导入合成数据并配置模型服务）。录制前清空当前浏览器的测试对话历史，录制时避开设置和连接凭据弹窗。
2. 在统一的桌面视口（如 `1440×900`）下操作真实控件，将同尺寸 PNG 关键帧与清单保存在被 Git 忽略的 `.demo-recording.local/` 目录中，不要提交密钥、密码或原始连接配置。
3. 安装 Pillow 后，使用 [GIF 编码脚本](../../scripts/build-demo-gifs.py) 输出动画：

   ```bash
   python -m pip install Pillow
   python scripts/build-demo-gifs.py .demo-recording.local/manifest.json
   ```

清单路径以清单文件所在目录为基准，`duration` 单位为毫秒。例如：

```json
{
  "width": 1024,
  "outputs": [{
    "output": "../docs/demo/schema-exploration.gif",
    "frames": [
      { "path": "frames/v2/schema-01-ready.png", "duration": 1600 },
      { "path": "frames/v2/schema-02-question.png", "duration": 2200 },
      { "path": "frames/v2/schema-05-answer.png", "duration": 5000 }
    ]
  }]
}
```

编码脚本只进行等比缩放、共享调色板压缩和帧时长设置，并在保存前逐帧解码校验像素与总时长；不会生成、改写或叠加界面内容。
