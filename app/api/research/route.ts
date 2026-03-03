import { NextRequest } from 'next/server'
import { plan } from '@/lib/engine/planner'
import { run } from '@/lib/engine/scheduler'
import { SSEEvent, Report, CompareMatrix, FollowUpContext } from '@/types'
import { saveHistory } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 120

function encode(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { query, followUpCtx } = body as { query: string; followUpCtx?: FollowUpContext }

  if (!query?.trim()) {
    return new Response('Missing query', { status: 400 })
  }

  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  const emit = (event: SSEEvent) => {
    writer.write(new TextEncoder().encode(encode(event)))
  }

  ;(async () => {
    try {
      // 1. 生成研究计划（追问时传入上下文）
      const followUpLabel = followUpCtx
        ? { refine: '精炼已有内容', expand: '补充新角度', new: '全新调研' }
        : null
      emit({ type: 'status', data: { message: followUpCtx ? '分析追问意图...' : '正在理解你的研究需求...' } })

      const researchPlan = await plan(query, followUpCtx)

      if (followUpCtx && (researchPlan as { followUpType?: string }).followUpType && followUpLabel) {
        const ft = (researchPlan as { followUpType?: keyof typeof followUpLabel }).followUpType
        if (ft) emit({ type: 'status', data: { message: `追问类型：${followUpLabel[ft]}` } })
      }

      emit({ type: 'plan', data: researchPlan })

      // 2. 执行研究（追问时传入历史 insights/sources）
      emit({ type: 'status', data: { message: '开始执行研究计划...' } })
      const previousCtx = followUpCtx
        ? { insights: followUpCtx.insights, sources: followUpCtx.sources }
        : undefined

      const ctx = await run(researchPlan, query, emit, previousCtx)

      // 3. 取报告
      emit({ type: 'status', data: { message: '正在生成研究报告...' } })
      const reportTask = researchPlan.tasks.find(
        (t) => t.skill_names[0] === 'report-generator' && t.status === 'done'
      )

      if (reportTask?.result) {
        const report = (reportTask.result as { report: Report }).report

        const matrixTask = researchPlan.tasks.find(
          (t) => t.skill_names[0] === 'matrix-builder' && t.status === 'done'
        )
        if (matrixTask?.result) {
          report.compare_matrix = (matrixTask.result as { matrix: CompareMatrix }).matrix
        }

        // 附上本次洞察，供下一次追问使用
        report.insights = ctx.insights

        try { saveHistory(query, report) } catch { /* DB errors don't block the response */ }
        emit({ type: 'report', data: report })
      } else {
        const fallbackReport: Report = {
          title: query,
          summary: `基于 ${ctx.sources.length} 个信息源完成调研，提取 ${ctx.insights.length} 条洞察。`,
          sections: [{
            title: '主要发现',
            content: ctx.insights.slice(0, 5).map((i) => `**${i.key}**：${i.value}`).join('\n\n'),
            evidence: ctx.insights.slice(0, 5),
          }],
          insights: ctx.insights,
          sources: ctx.sources.map((s, i) => ({ index: i + 1, url: s.url, title: s.title })),
          generated_at: new Date().toISOString(),
        }
        try { saveHistory(query, fallbackReport) } catch { /* ignore */ }
        emit({ type: 'report', data: fallbackReport })
      }

      emit({ type: 'done', data: {} })
    } catch (e) {
      emit({ type: 'error', data: { message: (e as Error).message } })
    } finally {
      writer.close()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
