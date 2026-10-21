# Job Workbench Demo

一个本地优先、单用户使用的求职工作台示例。它将岗位收集、人工筛选、简历版本、投递进展、跟进任务与个人笔记集中到同一个页面。

> 这是可公开分享的脱敏副本：不含真实简历、岗位记录、数据库、生成文件、截图、API Key 或本机路径。

## 功能

- 导入岗位：手动录入、粘贴 JSON、解析公开岗位 URL，或采集已配置的 Greenhouse / Lever 来源。
- 统一岗位池：按编号倒序稳定展示；支持搜索、审核状态、来源、企业性质、招聘类型、地点、匹配度、投递阶段、任务和时间筛选。
- 重复消除：链接相同，或标准化后的「公司 + 岗位」相同会识别为重复；内置字节跳动 / ByteDance 等公司别名示例。
- 人工决策优先：岗位先进入待确认队列，确认后才可创建投递记录；可收藏、排除、恢复和彻底删除已排除岗位。
- 简历资产：按岗位生成版本或复用历史版本；每次投递都保存对应的资料快照。
- 安全辅助填表：识别 Greenhouse、Lever 和通用页面，填写明确字段但绝不点击提交、不处理密码或登录页。
- 跟进与笔记：按岗位聚合阶段、任务、投递流水、简历；支持独立笔记的新建、编辑、置顶和删除。

## 快速开始

### 1. 准备环境

- Node.js 20 或更高版本
- SQLite 3 命令行工具（需在 PATH 中）
- Chrome（仅自动填表和端到端测试需要）
- Python 3（仅导出 DOCX / PDF 简历需要；可用 `PYTHON` 环境变量指定解释器）

### 2. 创建私有档案

```powershell
npm install
Copy-Item data/profile.example.yaml data/profile.yaml
```

编辑 `data/profile.yaml`，填写自己的基础资料、教育、经历、项目和技能。该文件已被 `.gitignore` 排除，不能提交到公开仓库。

如果希望把档案放在仓库以外的位置，可在启动前设置 `PROFILE_PATH`：

```powershell
$env:PROFILE_PATH = "C:\Users\you\Documents\job-profile.yaml"
```

### 3. 初始化并启动

```powershell
npm run migrate
npm run server
```

打开 <http://127.0.0.1:4174>。

## 使用流程

1. 在“岗位池”导入岗位，补全公司、职位、企业性质、来源和链接。
2. 每日人工确认待处理岗位；筛选不会改变岗位的编号排序。
3. 为已确认岗位生成或复用简历，并创建投递进展。
4. 需要时打开可见浏览器辅助填写表单；请人工检查后自行提交。
5. 在“岗位进展”维护状态和下一步任务，在“笔记”记录判断与复盘。

## 批量导入格式

可在导入窗口粘贴 JSON 数组。字段可以按需省略，但建议保留公司、职位和岗位链接：

```json
[
  {
    "company": "Example Technology",
    "company_type": "私企",
    "role": "Backend Engineer Intern",
    "location": "Beijing",
    "recruiting_type": "实习",
    "job_url": "https://careers.example.com/jobs/123",
    "application_url": "https://careers.example.com/jobs/123",
    "source_category": "公司官网"
  }
]
```

企业性质为自由文本，常用值包括：私企、国企、央企、外企、合资企业、事业单位和政府机关。

## AI 与公开来源（可选）

默认情况下不会调用任何模型或全网搜索。复制 `.env.example` 为 `.env` 后，再按需填写 OpenAI 环境变量：

```powershell
Copy-Item .env.example .env
```

服务只读取进程环境变量，不会读取 `.env` 文件本身；请通过终端、系统环境变量或安全的本地启动方式注入 Key。详见 [LLM_SETUP.md](LLM_SETUP.md)。

## 安全与隐私

- 不提交 `data/profile.yaml`、`.env`、SQLite 数据库、备份、简历文件、截图或求职信。
- 自动填表不会点击提交、创建账号、填写密码或绕过登录页。
- 仅对你明确提供或公开的岗位页面使用自动化；请遵守网站条款和招聘平台规则。
- 推送前运行 `git status --ignored`，确认没有个人资料和生成文件进入暂存区。

更多边界见 [SECURITY.md](SECURITY.md)，架构和数据流见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 验证

```powershell
npm test
```

测试覆盖岗位判重、笔记 API、本地数据库迁移和常见 ATS 表单填写逻辑。它不会向真实招聘网站提交申请。

## 目录

```text
ats/          ATS 检测与填写适配器
dashboard/    本地工作台界面
data/         公开示例档案；真实档案仅保存在被忽略的 profile.yaml
db/           SQLite schema、迁移与访问层
services/     岗位导入、分析、简历、工作流服务
scripts/      本地服务器、迁移与测试
artifacts/    本地生成的简历、截图和求职信（不提交）
```

## 许可

尚未指定开源许可。公开复用前，请由仓库所有者补充适合的 LICENSE 文件。
