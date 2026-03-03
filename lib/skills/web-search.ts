import { SkillContext, SkillHandler } from '@/lib/engine/skill-runtime'
import { SearchResult } from '@/types'

const webSearch: SkillHandler = {
  async execute(inputs, ctx: SkillContext) {
    const query = inputs.query as string
    const limit = (inputs.max_results as number) ?? 10
    const results: SearchResult[] = await ctx.search(query, { limit })
    ctx.log.info(`web-search: found ${results.length} results for "${query}"`)
    return { results, total_found: results.length }
  },
}

export default webSearch
