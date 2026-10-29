# 演示录制说明

两段 GIF 均录制于本地工作台，使用真实 DeepSeek API 和 MySQL 查询流程。界面使用 DeepSeek V4 Flash；演示数据库来自仓库的 [合成电商数据脚本](../../scripts/mysql-demo-seed.sql)，不包含真实客户数据。

| 文件 | 真实操作流程 |
| --- | --- |
| [schema-exploration.gif](./schema-exploration.gif) | 选择演示连接，提问表数量与表名，工具读取元数据，模型直接回答 8 张基础表。 |
| [sql-analysis.gif](./sql-analysis.gif) | 提问 2026 年 1–10 月成功收款、退款与净实收，检查模型生成的 SQL，人工确认后执行，查看结果表、折线图和统计摘要。 |

为便于阅读，动画保留真实交互中的关键帧，并缩短等待时间。分析文字由模型生成，查询数据来自实际执行的 SQL。

月度分析基于 `payments` 的成功资金事件，按 `occurred_at` 汇总：成功收款 131,089.90 元、成功退款 17,187.40 元、净实收 113,902.50 元。10 月样本不覆盖整月，不能直接与完整月份比较。

## 重新录制

1. 在隔离的 MySQL 演示库中导入合成数据，使用只读账号连接工作台。
2. 在设置中配置自己的模型服务，依次提出上述问题并操作真实控件。录制时避开设置和连接凭据页面。
3. 把关键页面保存为同尺寸 PNG。原始帧和清单放在被 Git 忽略的 `.demo-recording.local/`，不要提交密钥、密码或原始连接配置。
4. 安装 Pillow 后，使用 [GIF 编码脚本](../../scripts/build-demo-gifs.py) 输出动画：

   ```bash
   python -m pip install Pillow
   python scripts/build-demo-gifs.py .demo-recording.local/manifest.json
   ```

清单路径以清单文件所在目录为基准，`duration` 单位为毫秒。例如：

```json
{
  "width": 1280,
  "outputs": [{
    "output": "../docs/demo/schema-exploration.gif",
    "frames": [
      { "path": "frames/ready.png", "duration": 1500 },
      { "path": "frames/question.png", "duration": 2000 },
      { "path": "frames/answer.png", "duration": 4500 }
    ]
  }]
}
```

编码脚本只进行等比缩放、调色板压缩和帧时长设置，并在保存后解码校验总时长；不会生成、改写或叠加界面内容。
