# 可选的 AI 配置

本项目不需要模型即可运行：岗位管理、人工筛选、任务、笔记和本地规则分析均可离线使用。

配置 OpenAI API Key 后，才会启用两项增强能力：岗位匹配分析与公开网页岗位发现。

## 临时设置（PowerShell）

```powershell
$env:OPENAI_API_KEY = "你的 API Key"
$env:OPENAI_MODEL = "gpt-4o-mini"
$env:OPENAI_SEARCH_MODEL = "gpt-5"
$env:ENABLE_WEB_DISCOVERY = "true"
npm run server
```

不要把 Key 写入代码、README、截图或 Git 提交。`.env` 已被忽略，但本项目不会自动加载 `.env`；请使用系统环境变量或自己的安全启动工具注入变量。

## 行为边界

- 模型结果只是建议，岗位是否保留、简历是否使用、申请是否提交均由用户确认。
- 公开岗位发现仅请求公开网页；返回结果仍先进入待人工确认队列。
- 未设置 `OPENAI_API_KEY` 时，岗位分析自动退回本地规则，网页发现功能保持关闭。
