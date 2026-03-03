import { z } from 'zod'
import { SkillContext, SkillHandler } from '@/lib/engine/skill-runtime'
import { Insight, Report } from '@/types'

const ReportSchema = z.object({
  summary: z.string(),
  sections: z.array(z.object({
    title: z.string(),
    content: z.string(),
  })).catch([]),
  related_questions: z.array(z.string()).catch([]),
})

const reportGenerator: SkillHandler = {
  async execute(inputs, ctx: SkillContext) {
    const insights = inputs.insights as Insight[]
    const query = inputs.query as string
    const sources = (inputs.sources as Array<{ url: string; title: string }>) ?? []

    const insightText = insights
      .map((i, idx) => `[${idx + 1}] ${i.key}: ${i.value}`)
      .join('\n')

    // Detect scenario type from query prefix to guide section structure
    const sectionHint = query.startsWith('深度调研') && query.includes('TAM')
      ? '按市场规模、主要玩家、用户需求、进入机会四个维度各写一节'
      : query.startsWith('竞品对比分析')
      ? '按对比维度逐节展开，每节聚焦一个维度，末节给出综合推荐'
      : query.includes('融资情况')
      ? '按融资案例、投资机构、估值水平、投资人关注点四个维度各写一节'
      : '自然分 3-4 节，每节聚焦一个子话题'

    const result = await ctx.llm.extract(
      insightText || '（请根据主题生成概览）',
      ReportSchema,
      `你是 Perplexity 风格的 AI 研究助手，回答要像在和用户对话，不是写报告。
针对「${query}」生成研究回答（中文）。

要求：
- summary：1-2 段直接回答核心问题，包含关键数据，用 [数字] 标注引用，语气肯定自然
- sections：${sectionHint}，每节标题 5-8 字，内容 100-150 字，自然行文夹 [数字] 引用
- related_questions：3 个相关追问，帮用户继续深入

只输出 JSON，不要解释：
{"summary":"直接回答 [1][2]","sections":[{"title":"小标题","content":"段落 [3]"}],"related_questions":["追问一?","追问二?","追问三?"]}`
    )

    const sourcesWithIndex = sources.map((s, i) => ({ index: i + 1, url: s.url, title: s.title }))

    const report: Report = {
      title: query,
      summary: result.summary,
      sections: result.sections.map((s) => ({
        ...s,
        evidence: insights.filter((i) => s.content.includes(i.key)),
      })),
      related_questions: result.related_questions,
      sources: sourcesWithIndex,
      generated_at: new Date().toISOString(),
    }

    ctx.log.info(`report-generator: summary + ${report.sections.length} sections`)
    return { report }
  },
}

export default reportGenerator
