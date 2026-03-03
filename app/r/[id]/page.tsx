import { notFound } from 'next/navigation'
import { getHistoryRecord } from '@/lib/db'
import { Report } from '@/types'

export const runtime = 'nodejs'

function safeHostname(url: string) {
  try { return new URL(url).hostname } catch { return url }
}

// Render inline tokens: [n] citations and **bold**
function InlineTokens({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        const cite = part.match(/^\[(\d+)\]$/)
        if (cite) return (
          <sup key={i}>
            <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[9px] bg-[#8B5CF6]/15 text-[#A78BFA] rounded ml-0.5">
              {cite[1]}
            </span>
          </sup>
        )
        const bold = part.match(/^\*\*([^*]+)\*\*$/)
        if (bold) return <strong key={i} className="text-[#F2F2F2] font-semibold">{bold[1]}</strong>
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

function AnswerText({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/).filter(Boolean)
  return (
    <div className="space-y-3 text-[#C4C4C4] text-sm leading-7">
      {paragraphs.map((para, i) => {
        if (/^[-•]/.test(para.trim())) {
          const items = para.split('\n').filter((l) => l.trim())
          return (
            <ul key={i} className="space-y-1.5">
              {items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="text-[#444] mt-1.5 shrink-0">·</span>
                  <span><InlineTokens text={item.replace(/^[\s\-•]+/, '')} /></span>
                </li>
              ))}
            </ul>
          )
        }
        return <p key={i}><InlineTokens text={para} /></p>
      })}
    </div>
  )
}

function ReportView({ query, report }: { query: string; report: Report }) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">
          <h1 className="text-lg font-semibold text-[#F2F2F2] mb-5 leading-snug">{query}</h1>

          <div className="mb-6">
            <AnswerText text={report.summary} />
          </div>

          {report.sections.map((section, i) => (
            <div key={i} className="mb-5">
              <h3 className="text-sm font-semibold text-[#F2F2F2] mb-1.5">{section.title}</h3>
              <AnswerText text={section.content} />
            </div>
          ))}

          {report.compare_matrix && (
            <div className="mb-8 mt-2">
              <h3 className="text-sm font-semibold text-[#F2F2F2] mb-3">竞品对比矩阵</h3>
              <div className="overflow-x-auto rounded-lg border border-[#1E1E1E]">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#141414]">
                      <th className="text-left px-3 py-2 text-[#555] font-medium border-b border-[#1E1E1E]">维度</th>
                      {report.compare_matrix.targets.map((t) => (
                        <th key={t} className="text-left px-3 py-2 text-[#A0A0A0] font-medium border-b border-[#1E1E1E]">{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.compare_matrix.dimensions.map((dim, i) => (
                      <tr key={dim} className={i % 2 === 0 ? 'bg-[#0F0F0F]' : 'bg-[#0A0A0A]'}>
                        <td className="px-3 py-2 text-[#555] font-medium border-b border-[#1A1A1A]">{dim}</td>
                        {report.compare_matrix!.targets.map((target) => (
                          <td key={target} className="px-3 py-2 text-[#D4D4D4] border-b border-[#1A1A1A]">
                            {report.compare_matrix!.cells[dim]?.[target] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.related_questions && report.related_questions.length > 0 && (
            <div className="mt-8">
              <p className="text-xs text-[#444] uppercase tracking-widest mb-3">相关问题</p>
              <div className="space-y-2">
                {report.related_questions.map((q) => (
                  <div key={q} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[#1E1E1E] text-[#555] text-sm">
                    {q}
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[#333] mt-10">
            由 <a href="/" className="text-[#8B5CF6] hover:underline">Farsight</a> 生成 ·{' '}
            {new Date(report.generated_at).toLocaleString('zh-CN')}
          </p>
        </div>
      </main>

      {/* Sources panel */}
      {report.sources.length > 0 && (
        <aside className="w-64 border-l border-[#1E1E1E] overflow-y-auto shrink-0 py-5 px-4">
          <p className="text-xs text-[#444] uppercase tracking-widest mb-4">
            来源 · {report.sources.length}
          </p>
          <div className="space-y-1">
            {report.sources.map((s) => (
              <a
                key={s.index}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-2.5 p-2 rounded-lg hover:bg-[#141414] transition-colors group"
              >
                <span className="text-[10px] text-[#8B5CF6] font-mono mt-0.5 shrink-0 w-4">[{s.index}]</span>
                <div className="min-w-0">
                  <p className="text-xs text-[#D4D4D4] line-clamp-2 leading-relaxed group-hover:text-[#F2F2F2]">
                    {s.title}
                  </p>
                  <p className="text-[11px] text-[#444] mt-0.5 truncate">{safeHostname(s.url)}</p>
                </div>
              </a>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}

export default async function SharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const record = getHistoryRecord(id)
  if (!record) notFound()

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-[#F2F2F2] flex flex-col">
      {/* Banner */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-[#1E1E1E] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-[#8B5CF6] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5" stroke="white" strokeWidth="1.5"/>
              <path d="M7 4v3l2 2" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-sm font-semibold tracking-tight">Farsight</span>
        </div>
        <a
          href="/"
          className="text-xs px-3 py-1.5 rounded-lg border border-[#2A2A2A] text-[#555] hover:border-[#8B5CF6]/50 hover:text-[#A0A0A0] transition-colors"
        >
          开始调研 →
        </a>
      </header>

      <ReportView query={record.query} report={record.report} />
    </div>
  )
}
