# Farsight

> **AI Research for Founders** — 专为创业者打造的 AI 深度调研工具。输入一个问题，自动完成搜索 → 抓取 → 分析 → 报告全流程。

[English](./README.md) · 中文

---

## 界面预览

![首页 — 场景入口](./docs/screenshot-home.jpg)

![调研报告 — 内联引用 + 来源面板](./docs/screenshot-report.jpg)

---

## 功能特性

- **深度调研** — 自动分解问题、多轮搜索、全文抓取、提取洞察、生成报告
- **竞品分析** — 识别对比意图，自动生成结构化竞品对比矩阵
- **上下文追问** — 基于上次调研结果继续深挖（精炼 / 扩展 / 全新三种模式）
- **内联引用** — 报告中 `[n]` 标注可点击，高亮对应来源
- **历史记录** — SQLite 本地持久化，跨会话保留所有调研历史
- **分享链接** — 一键生成只读分享页 `/r/[id]`
- **导出 Markdown** — 一键下载完整报告（含竞品矩阵、来源列表）

## 架构

```
app/
├── page.tsx              # 主界面（SSE 消费 / 报告渲染 / 历史记录）
├── r/[id]/page.tsx       # 只读分享页（Server Component）
└── api/
    ├── research/         # 调研 SSE 流
    └── history/          # 历史记录 CRUD

lib/
├── engine/
│   ├── planner.ts        # LLM 生成研究计划
│   └── scheduler.ts      # 按阶段并行执行 Skills
├── skills/               # 可插拔技能模块（社区可贡献）
│   ├── web-search.ts     #   Tavily 搜索
│   ├── http-scraper.ts   #   纯 HTTP 抓取（无浏览器依赖）
│   ├── key-extractor.ts  #   洞察提取
│   ├── report-generator.ts
│   └── matrix-builder.ts
├── llm/
│   └── adapter.ts        # MiniMax / Claude 统一接口，含 JSON 解析重试
└── db/
    └── index.ts          # JSON 文件历史持久化
```

执行流水线：`collect` → `parse` → `analyze` → `output`，同阶段任务并行执行。

## 快速开始

### 本地开发

**环境要求：** Node.js 20+、pnpm

```bash
git clone https://github.com/finvfamily/farsight
cd farsight
pnpm install
cp .env.local.example .env.local   # 填入 API Key
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)

### Docker 一键启动

```bash
cp .env.local.example .env.local   # 填入 API Key
docker-compose up
```

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `MINIMAX_API_KEY` | ✅ | 默认 LLM — MiniMax M2.5，[获取](https://platform.minimaxi.com/) |
| `TAVILY_API_KEY` | ✅ | 搜索 API，[获取](https://tavily.com/)（免费 1000次/月） |
| `ANTHROPIC_API_KEY` | 可选 | Claude — 规划与合成质量更高，[获取](https://console.anthropic.com/) |
| `LLM_PROVIDER` | 可选 | 强制指定模型：`minimax` 或 `claude`（不填则按任务类型自动路由） |

## 添加新 Skill

Skills 是系统的核心扩展点，每个 Skill 是一个独立模块：

```typescript
// lib/skills/my-skill.ts
import { buildContext } from '@/lib/engine/skill-runtime'

export default {
  async execute(
    inputs: Record<string, unknown>,
    ctx: ReturnType<typeof buildContext>
  ) {
    // 你的实现
    return { result: '...' }
  },
}
```

在 `lib/engine/scheduler.ts` 的 `SKILL_MAP` 中注册后，Planner 就能自动调度它。

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

## Roadmap

- [x] 创业者场景入口（市场调研 / 竞品分析 / 融资准备）
- [ ] 移动端适配
- [ ] PDF 导出
- [ ] 用户登录 / 多用户历史隔离
- [ ] Skill 扩展：企查查、App Store 评论、36氪 RSS
- [ ] 持续跟踪（赛道动态订阅推送）

## 贡献

欢迎提交 PR！详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

[Apache 2.0](./LICENSE)
