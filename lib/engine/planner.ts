import { z } from 'zod'
import { llmCall, selectProvider } from '@/lib/llm/adapter'
import { ResearchPlan, ResearchTask, FollowUpContext } from '@/types'

const PlanSchema = z.object({
  intent: z.enum(['topic_research', 'competitor_analysis']),
  level: z.enum(['L2', 'L3']),
  sub_questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      skill: z.string(),
      stage: z.enum(['collect', 'parse', 'analyze', 'output']),
    })
  ),
})

const FollowUpPlanSchema = z.object({
  follow_up_type: z.enum(['refine', 'expand', 'new']),
  sub_questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      skill: z.string(),
    })
  ).catch([]),
})

export async function plan(
  query: string,
  followUpCtx?: FollowUpContext
): Promise<ResearchPlan & { followUpType?: 'refine' | 'expand' | 'new' }> {
  // ── 追问模式 ──────────────────────────────────────────────
  if (followUpCtx) {
    const topicSummary = followUpCtx.insightKeys.slice(0, 12).join('、')

    const result = await llmCall(
      [{ role: 'user', content: query }],
      {
        provider: selectProvider('planning'),
        schema: FollowUpPlanSchema,
        system: `用户之前调研了「${followUpCtx.previousQuery}」，涵盖话题：${topicSummary}。
现在用户追问：「${query}」

判断追问类型：
- "refine"：用户希望对已有内容换个说法、总结要点、换语言、变换角度——不需要新搜索
- "expand"：用户问了一个新的子话题或具体细节，需要补充新的信息
- "new"：与上次调研完全无关的全新话题

对于 "refine"：sub_questions = []（直接用已有洞察重新生成报告）
对于 "expand"：sub_questions 只包含 web-search 和 key-extractor 各一条
对于 "new"：sub_questions 包含完整流程

只输出 JSON：
{"follow_up_type":"refine","sub_questions":[]}`,
      }
    )

    if (result.follow_up_type === 'new') {
      // 当作全新请求处理
      return plan(query)
    }

    const tasks = result.sub_questions.map((q) => ({
      id: q.id,
      question: q.question,
      skill_names: [q.skill],
      stage: 'collect' as ResearchTask['stage'],   // SKILL_STAGE_OVERRIDE will fix this
      inputs: {},
      status: 'pending' as const,
    }))

    // 始终注入 report-generator
    tasks.push({
      id: 'report',
      question: `针对「${query}」基于已有调研生成答案`,
      skill_names: ['report-generator'],
      stage: 'output',
      inputs: {},
      status: 'pending',
    })

    return {
      intent: 'topic_research',
      level: 'L2',
      tasks,
      followUpType: result.follow_up_type,
    }
  }

  // ── 全新调研模式 ──────────────────────────────────────────
  const result = await llmCall(
    [{ role: 'user', content: query }],
    {
      provider: selectProvider('planning'),
      schema: PlanSchema,
      system: `You are a research planning assistant. Given a user's research query, create a research plan.

Determine:
- intent: "competitor_analysis" if comparing multiple products/companies, "topic_research" otherwise
- level: "L3" if competitor analysis (needs matrix), "L2" otherwise
- sub_questions: 2-4 research sub-tasks. Each task has EXACTLY ONE skill.

Available skills (one per task):
- web-search: search the web for information
- web-scraper: scrape full content from URLs
- key-extractor: extract structured insights from documents

RULES (strictly enforced by the engine, do not override):
- web-search: stage "collect"
- web-scraper: stage "parse"
- key-extractor: stage "analyze"
- report-generator and matrix-builder are added automatically — do NOT include them

Example L2 plan:
{"intent":"topic_research","level":"L2","sub_questions":[
  {"id":"q1","question":"搜索XX相关信息","skill":"web-search","stage":"collect"},
  {"id":"q2","question":"抓取各网站详情","skill":"web-scraper","stage":"parse"},
  {"id":"q3","question":"提取关键洞察","skill":"key-extractor","stage":"analyze"}
]}

Respond with valid JSON only.`,
    }
  )

  const tasks = result.sub_questions.map((q) => ({
    id: q.id,
    question: q.question,
    skill_names: [q.skill],
    stage: q.stage,
    inputs: {},
    status: 'pending' as const,
  }))

  if (result.level === 'L3') {
    tasks.push({
      id: 'matrix',
      question: `构建${query}竞品对比矩阵`,
      skill_names: ['matrix-builder'],
      stage: 'output',
      inputs: {},
      status: 'pending',
    })
  }
  tasks.push({
    id: 'report',
    question: `生成${query}研究报告`,
    skill_names: ['report-generator'],
    stage: 'output',
    inputs: {},
    status: 'pending',
  })

  return { intent: result.intent, level: result.level, tasks }
}
