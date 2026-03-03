import { ResearchPlan, ResearchTask, ResearchContext, SSEEvent, Insight } from '@/types'
import { buildContext } from '@/lib/engine/skill-runtime'
import webSearch from '@/lib/skills/web-search'
import webScraper from '@/lib/skills/web-scraper'
import keyExtractor from '@/lib/skills/key-extractor'
import reportGenerator from '@/lib/skills/report-generator'
import matrixBuilder from '@/lib/skills/matrix-builder'

const SKILL_MAP: Record<string, { execute: (inputs: Record<string, unknown>, ctx: ReturnType<typeof buildContext>) => Promise<unknown> }> = {
  'web-search': webSearch,
  'web-scraper': webScraper,
  'key-extractor': keyExtractor,
  'report-generator': reportGenerator,
  'matrix-builder': matrixBuilder,
}

// Enforce correct stage for each skill regardless of planner output
const SKILL_STAGE_OVERRIDE: Record<string, ResearchTask['stage']> = {
  'web-search': 'collect',
  'web-scraper': 'parse',
  'key-extractor': 'analyze',
  'matrix-builder': 'output',
  'report-generator': 'output',
}

export type PreviousContext = {
  insights: Insight[]
  sources: Array<{ url: string; title: string }>
}

export async function run(
  plan: ResearchPlan,
  query: string,
  emit: (event: SSEEvent) => void,
  previousCtx?: PreviousContext
): Promise<ResearchContext> {
  const ctx: ResearchContext = { documents: [], insights: [], sources: [] }

  // 追问时用上一次的洞察和来源预填充 ctx
  if (previousCtx) {
    ctx.insights = [...previousCtx.insights]
    ctx.sources = [...previousCtx.sources]
  }
  // 记录旧来源数量，确保 web-scraper 只抓本次新增的 URL
  const prevSourceCount = ctx.sources.length

  // Override stages to guarantee correct dependency order
  for (const task of plan.tasks) {
    const override = SKILL_STAGE_OVERRIDE[task.skill_names[0]]
    if (override) task.stage = override
  }

  const stages: Array<ResearchTask['stage']> = ['collect', 'parse', 'analyze', 'output']

  for (const stage of stages) {
    const stageTasks = plan.tasks.filter((t) => t.stage === stage)
    if (stageTasks.length === 0) continue

    // 同 stage 并行执行
    await Promise.all(
      stageTasks.map(async (task) => {
        task.status = 'running'
        const start = Date.now()

        emit({
          type: 'task_start',
          data: { task_id: task.id, skill: task.skill_names[0], question: task.question },
        })

        const skillCtx = buildContext((level, msg) => {
          console.log(`[${level}] ${msg}`)
        })

        try {
          const inputs = buildInputs(task, ctx, query, prevSourceCount)
          const result = await SKILL_MAP[task.skill_names[0]].execute(inputs, skillCtx)
          task.result = result
          task.status = 'done'

          mergeResult(task.skill_names[0], result, ctx)

          emit({
            type: 'task_done',
            data: { task_id: task.id, skill: task.skill_names[0], duration_ms: Date.now() - start },
          })
        } catch (e) {
          task.status = 'failed'
          task.error = (e as Error).message
          emit({
            type: 'task_failed',
            data: { task_id: task.id, error: task.error },
          })
        }
      })
    )
  }

  return ctx
}

// 根据当前 context 为 skill 构建 inputs
// prevSourceCount: 追问时旧来源数量，web-scraper 只抓新增 URL
function buildInputs(
  task: ResearchTask,
  ctx: ResearchContext,
  query: string,
  prevSourceCount = 0
): Record<string, unknown> {
  const skill = task.skill_names[0]

  if (skill === 'web-search') {
    return { query: task.question, max_results: 8 }
  }

  if (skill === 'web-scraper') {
    const urls = ctx.sources.slice(prevSourceCount, prevSourceCount + 5).map((s) => s.url)
    return { urls }
  }

  if (skill === 'key-extractor') {
    return { documents: ctx.documents, focus: query }
  }

  if (skill === 'matrix-builder') {
    // 将 documents 按来源域名分组为 CompareTarget
    const grouped: Record<string, typeof ctx.documents> = {}
    for (const doc of ctx.documents) {
      const domain = new URL(doc.url).hostname
      grouped[domain] = grouped[domain] ?? []
      grouped[domain].push(doc)
    }
    const targets = Object.entries(grouped).map(([domain, docs]) => ({
      id: domain,
      name: domain,
      documents: docs,
      insights: ctx.insights.filter((i) => i.source_urls.some((u) => u.includes(domain))),
    }))
    return { targets, query }
  }

  if (skill === 'report-generator') {
    return { insights: ctx.insights, query, sources: ctx.sources }
  }

  return {}
}

// 将 skill 结果合并进 context
function mergeResult(skill: string, result: unknown, ctx: ResearchContext) {
  const r = result as Record<string, unknown>

  if (skill === 'web-search') {
    const results = r.results as Array<{ url: string; title: string; snippet?: string }>
    for (const sr of results) {
      if (!ctx.sources.find((s) => s.url === sr.url)) {
        ctx.sources.push({ url: sr.url, title: sr.title })
      }
      // 将 Tavily snippet 存为兜底文档，保证即使 Playwright 全部失败 key-extractor 仍有内容
      if (sr.snippet && sr.snippet.length > 30 && !ctx.documents.find((d) => d.url === sr.url)) {
        ctx.documents.push({
          url: sr.url,
          title: sr.title,
          content: sr.snippet,
          metadata: { source: 'tavily-snippet' },
          word_count: sr.snippet.split(/\s+/).filter(Boolean).length,
        })
      }
    }
  }

  if (skill === 'web-scraper') {
    const docs = r.documents as typeof ctx.documents
    // 用完整抓取内容替换 snippet 兜底文档
    for (const doc of docs) {
      const idx = ctx.documents.findIndex((d) => d.url === doc.url)
      if (idx >= 0) {
        ctx.documents[idx] = doc
      } else {
        ctx.documents.push(doc)
      }
    }
  }

  if (skill === 'key-extractor') {
    const insights = r.insights as typeof ctx.insights
    ctx.insights.push(...insights)
  }
}
