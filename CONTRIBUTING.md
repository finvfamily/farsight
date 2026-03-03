# Contributing Guide

感谢你的贡献！这份指南帮助你快速上手。

---

## 项目结构速览

最值得关注的两个扩展点：

| 目录 | 作用 |
|------|------|
| `lib/skills/` | 添加新的数据源或分析能力 |
| `lib/engine/planner.ts` | 修改 LLM 如何拆解研究任务 |

---

## 如何添加一个新 Skill

添加 Skill 是最常见的贡献方式，不需要理解整个系统。

### 1. 新建 Skill 文件

```typescript
// lib/skills/crunchbase-search.ts
import { buildContext } from '@/lib/engine/skill-runtime'

export default {
  async execute(
    inputs: Record<string, unknown>,
    ctx: ReturnType<typeof buildContext>
  ): Promise<{ companies: Company[] }> {
    const query = inputs.query as string

    // 你的实现...
    const companies = await fetchCrunchbase(query)

    return { companies }
  },
}
```

**Skill 契约：**
- `inputs` — 由 Planner 或 Scheduler 注入，内容取决于 skill 阶段
- 返回值会存入 `task.result`，由 `scheduler.ts` 的 `mergeResult` 写入共享 context
- 抛出异常时任务标记为 `failed`，不影响其他任务

### 2. 在 Scheduler 注册

打开 `lib/engine/scheduler.ts`，在 `SKILL_MAP` 中加一行：

```typescript
import crunchbaseSearch from '@/lib/skills/crunchbase-search'

const SKILL_MAP = {
  'web-search': webSearch,
  'web-scraper': webScraper,
  // ...
  'crunchbase-search': crunchbaseSearch,  // 新增
}
```

如果新 Skill 有固定的执行阶段，在 `SKILL_STAGE_OVERRIDE` 中声明：

```typescript
const SKILL_STAGE_OVERRIDE = {
  'web-search': 'collect',
  // ...
  'crunchbase-search': 'collect',  // 新增
}
```

### 3. 在 Planner prompt 中描述它

打开 `lib/engine/planner.ts`，在系统 prompt 的 `Available skills` 列表里加上描述：

```
- crunchbase-search: search Crunchbase for company funding and investor data
```

Planner（LLM）会根据用户意图自动决定是否调用它。

### 4. 测试

```bash
pnpm dev
# 在界面输入包含该 skill 场景的问题，观察任务列表中是否出现新 skill
```

---

## 开发流程

```bash
# 安装依赖
pnpm install
pnpm playwright install chromium

# 配置环境变量
cp .env.local.example .env.local

# 启动开发服务器
pnpm dev

# 类型检查
npx tsc --noEmit
```

---

## PR 规范

- 一个 PR 专注一件事
- Skill 类 PR 请在描述中说明：数据来源、所需 API Key、输出格式
- 不要提交 `.env.local` 或 `research.db`
- 标题格式：`feat: add crunchbase-search skill` / `fix: ...` / `docs: ...`

---

## 代码风格

- TypeScript，strict 模式
- 新增 Skill 无需写注释，接口命名自解释即可
- LLM 调用统一走 `lib/llm/adapter.ts` 的 `llmCall`，不要直接调 SDK

---

有问题请开 Issue，欢迎讨论！
