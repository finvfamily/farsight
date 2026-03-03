import { z } from 'zod'
import { SkillContext, SkillHandler } from '@/lib/engine/skill-runtime'
import { Document, Insight } from '@/types'

const InsightSchema = z.object({
  insights: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      confidence: z.number().min(0).max(1).catch(0.5),
      evidence_type: z.enum(['confirmed', 'inferred', 'indirect']).catch('inferred'),
      source_urls: z.array(z.string()).catch([]),
    })
  ).catch([]),
})

const keyExtractor: SkillHandler = {
  async execute(inputs, ctx: SkillContext) {
    const documents = inputs.documents as Document[]
    const focus = (inputs.focus as string) ?? 'general insights'

    const allInsights: Insight[] = []

    await Promise.all(
      documents.map(async (doc) => {
        if (!doc.content || doc.content.length < 50) return

        const truncated = doc.content.slice(0, 6000)
        const result = await ctx.llm.extract(
          truncated,
          InsightSchema,
          `从以下内容中提取关于「${focus}」的关键洞察（5-10条），用中文输出。
只输出 JSON，格式严格如下（不要输出任何解释）：
{"insights": [
  {"key": "洞察标题", "value": "具体内容和数据", "confidence": 0.9, "evidence_type": "confirmed", "source_urls": []}
]}
evidence_type 只能是 confirmed / inferred / indirect 之一。`
        )

        const withSources = result.insights.map((i) => ({
          ...i,
          source_urls: i.source_urls.length ? i.source_urls : [doc.url],
        }))
        allInsights.push(...withSources)
        ctx.log.info(`key-extractor: extracted ${withSources.length} insights from ${doc.url}`)
      })
    )

    // 去重：相同 key 只保留 confidence 最高的
    const deduped = Object.values(
      allInsights.reduce<Record<string, Insight>>((acc, insight) => {
        const existing = acc[insight.key]
        if (!existing || insight.confidence > existing.confidence) {
          acc[insight.key] = insight
        }
        return acc
      }, {})
    )

    return { insights: deduped, total: deduped.length }
  },
}

export default keyExtractor
