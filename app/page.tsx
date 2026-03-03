'use client'

import { useState, useRef, useEffect } from 'react'
import { SSEEvent, ResearchPlan, Report, FollowUpContext } from '@/types'

type HistoryItem = { id: string; query: string; created_at: string }

type TaskStatus = {
  id: string
  skill: string
  question: string
  status: 'pending' | 'running' | 'done' | 'failed'
  duration_ms?: number
  error?: string
}

const SKILL_LABEL: Record<string, string> = {
  'web-search': '搜索',
  'web-scraper': '抓取',
  'key-extractor': '提取洞察',
  'report-generator': '生成报告',
  'matrix-builder': '构建矩阵',
}

type ScenarioId = 'market' | 'competitor' | 'funding'
type ScenarioField = { key: string; label: string; placeholder: string; required: boolean }

const SCENARIOS: Array<{
  id: ScenarioId
  title: string
  desc: string
  fields: ScenarioField[]
}> = [
  {
    id: 'market',
    title: '市场调研',
    desc: '规模、增速、主要玩家、进入机会',
    fields: [
      { key: 'market', label: '行业 / 市场名称', placeholder: '新能源汽车、AI 写作工具…', required: true },
      { key: 'region', label: '关注地区', placeholder: '中国（不填默认全球）', required: false },
    ],
  },
  {
    id: 'competitor',
    title: '竞品分析',
    desc: '功能矩阵、定价、目标用户对比',
    fields: [
      { key: 'products', label: '产品列表（逗号分隔）', placeholder: 'Notion, 飞书, 语雀', required: true },
      { key: 'dimensions', label: '核心对比维度', placeholder: '功能、定价、用户群（可选）', required: false },
    ],
  },
  {
    id: 'funding',
    title: '融资前调研',
    desc: '融资案例、投资机构、估值参考',
    fields: [
      { key: 'industry', label: '行业 / 赛道', placeholder: 'AI 客服 SaaS、医疗科技…', required: true },
      { key: 'stage', label: '参考融资阶段', placeholder: 'A 轮（可选）', required: false },
    ],
  },
]

function buildScenarioQuery(id: ScenarioId, inputs: Record<string, string>): string {
  if (id === 'market') {
    const region = inputs.region ? `（${inputs.region}）` : ''
    return `深度调研【${inputs.market}】市场${region}，需要覆盖：市场规模（TAM/SAM）与增速趋势、主要玩家及市场份额、核心用户需求与痛点、市场进入机会与壁垒`
  }
  if (id === 'competitor') {
    const dims = inputs.dimensions?.trim() || '产品功能、定价策略、目标用户、核心优劣势'
    return `竞品对比分析：${inputs.products}，重点对比维度：${dims}`
  }
  const stage = inputs.stage ? `（参考 ${inputs.stage}）` : ''
  return `调研【${inputs.industry}】赛道融资情况${stage}，需要覆盖：近期主要融资案例与金额、活跃投资机构及偏好、估值水平参考、投资人关注的核心指标`
}

export default function Home() {
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [plan, setPlan] = useState<ResearchPlan | null>(null)
  const [tasks, setTasks] = useState<TaskStatus[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [savedCtx, setSavedCtx] = useState<FollowUpContext | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [copied, setCopied] = useState(false)
  const [activeScenario, setActiveScenario] = useState<ScenarioId | null>(null)
  const [scenarioInputs, setScenarioInputs] = useState<Record<string, string>>({})
  const abortRef = useRef<AbortController | null>(null)

  const scenarioDef = SCENARIOS.find((s) => s.id === activeScenario)
  const canSubmitScenario = scenarioDef?.fields
    .filter((f) => f.required)
    .every((f) => (scenarioInputs[f.key] ?? '').trim().length > 0) ?? false

  const handleScenarioSubmit = () => {
    if (!activeScenario || !canSubmitScenario) return
    const q = buildScenarioQuery(activeScenario, scenarioInputs)
    setActiveScenario(null)
    setScenarioInputs({})
    startResearch(q)
  }

  const loadHistory = async (): Promise<HistoryItem[]> => {
    try {
      const res = await fetch('/api/history')
      if (res.ok) {
        const data: HistoryItem[] = await res.json()
        setHistory(data)
        return data
      }
    } catch { /* ignore */ }
    return []
  }

  useEffect(() => { loadHistory() }, [])

  const loadHistoryRecord = async (id: string) => {
    try {
      const res = await fetch(`/api/history?id=${id}`)
      if (!res.ok) return
      const record: { id: string; query: string; report: Report } = await res.json()
      setActiveQuery(record.query)
      setReport(record.report)
      setPlan(null)
      setTasks([])
      setError(null)
      setStatusMsg('')
      if (record.report.insights?.length) {
        setSavedCtx({
          previousQuery: record.query,
          insightKeys: record.report.insights.map((i) => i.key),
          insights: record.report.insights,
          sources: record.report.sources.map((s) => ({ url: s.url, title: s.title })),
        })
      }
    } catch { /* ignore */ }
  }

  const handleShare = async () => {
    // history state may not be updated yet — fetch fresh list if needed
    let items = history
    let record = items.find((h) => h.query === activeQuery)
    if (!record) {
      items = await loadHistory()
      record = items.find((h) => h.query === activeQuery)
    }
    if (!record) return
    const url = `${window.location.origin}/r/${record.id}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // clipboard API not available (non-HTTPS / browser restriction)
      prompt('复制分享链接：', url)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const removeHistory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/history?id=${id}`, { method: 'DELETE' })
      setHistory((prev) => prev.filter((h) => h.id !== id))
    } catch { /* ignore */ }
  }

  // ctx 只在从报告界面追问时传入，初始搜索不传
  const startResearch = async (q: string, ctx?: FollowUpContext | null) => {
    if (!q.trim() || isRunning) return

    setActiveQuery(q)
    setIsRunning(true)
    setPlan(null)
    setTasks([])
    setReport(null)
    setError(null)
    setStatusMsg('准备中...')

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, ...(ctx ? { followUpCtx: ctx } : {}) }),
        signal: abortRef.current.signal,
      })

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const event: SSEEvent = JSON.parse(line.slice(6))
          handleEvent(event)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setError((e as Error).message)
      }
    } finally {
      setIsRunning(false)
      setStatusMsg('')
    }
  }

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case 'status':
        setStatusMsg(event.data.message)
        break
      case 'plan':
        setPlan(event.data)
        setTasks(
          event.data.tasks.map((t) => ({
            id: t.id,
            skill: t.skill_names[0],
            question: t.question,
            status: 'pending',
          }))
        )
        break
      case 'task_start':
        setTasks((prev) =>
          prev.map((t) =>
            t.id === event.data.task_id ? { ...t, status: 'running' } : t
          )
        )
        break
      case 'task_done':
        setTasks((prev) =>
          prev.map((t) =>
            t.id === event.data.task_id
              ? { ...t, status: 'done', duration_ms: event.data.duration_ms }
              : t
          )
        )
        break
      case 'task_failed':
        setTasks((prev) =>
          prev.map((t) =>
            t.id === event.data.task_id
              ? { ...t, status: 'failed', error: event.data.error }
              : t
          )
        )
        break
      case 'report':
        setReport(event.data)
        // 保存本次洞察供追问使用
        if (event.data.insights?.length) {
          setSavedCtx({
            previousQuery: activeQuery,
            insightKeys: event.data.insights.map((i) => i.key),
            insights: event.data.insights,
            sources: event.data.sources.map((s) => ({ url: s.url, title: s.title })),
          })
        }
        loadHistory()
        break
      case 'error':
        setError(event.data.message)
        break
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F0F] text-[#F2F2F2] flex flex-col">
      {/* Header */}
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
        <span className="text-xs text-[#555]">AI Research for Founders</span>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── 历史侧栏（报告态 / 运行中） ── */}
        {(report || isRunning) && (
          <aside className="w-44 border-r border-[#1E1E1E] overflow-y-auto shrink-0 py-5 px-3 flex flex-col gap-1">
            <p className="text-[10px] text-[#444] uppercase tracking-widest mb-2 px-1">历史记录</p>
            {history.length === 0 ? (
              <p className="text-xs text-[#333] px-1">暂无记录</p>
            ) : (
              history.map((h) => (
                <div
                  key={h.id}
                  className={`group relative flex items-start gap-1 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
                    activeQuery === h.query && report
                      ? 'bg-[#8B5CF6]/10 text-[#A78BFA]'
                      : 'text-[#666] hover:bg-[#141414] hover:text-[#D4D4D4]'
                  }`}
                  onClick={() => loadHistoryRecord(h.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs truncate leading-snug">{h.query}</p>
                    <p className="text-[10px] text-[#333] mt-0.5">{relativeTime(h.created_at)}</p>
                  </div>
                  <button
                    onClick={(e) => removeHistory(h.id, e)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-[#333] hover:text-red-400 transition-all mt-0.5"
                    title="删除"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </aside>
        )}

        {/* ── 初始态：居中 landing ── */}
        {!report && !isRunning && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 gap-7 overflow-y-auto">

            {activeScenario && scenarioDef ? (
              /* ── 场景表单 ── */
              <div className="w-full max-w-md">
                <button
                  onClick={() => { setActiveScenario(null); setScenarioInputs({}) }}
                  className="flex items-center gap-1.5 text-xs text-[#444] hover:text-[#888] mb-7 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  返回
                </button>

                <div className="flex items-center gap-3 mb-7">
                  <div className="w-10 h-10 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center text-[#8B5CF6]">
                    <ScenarioIcon id={activeScenario} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[#F2F2F2]">{scenarioDef.title}</h2>
                    <p className="text-xs text-[#444] mt-0.5">{scenarioDef.desc}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {scenarioDef.fields.map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs text-[#555] mb-1.5">
                        {f.label}
                        {f.required && <span className="text-[#8B5CF6] ml-0.5">*</span>}
                      </label>
                      <input
                        className="w-full bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8B5CF6]/60 transition-colors placeholder-[#333] text-[#F2F2F2]"
                        placeholder={f.placeholder}
                        value={scenarioInputs[f.key] ?? ''}
                        onChange={(e) => setScenarioInputs((prev) => ({ ...prev, [f.key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter' && canSubmitScenario) handleScenarioSubmit() }}
                        autoFocus={scenarioDef.fields[0].key === f.key}
                      />
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleScenarioSubmit}
                  disabled={!canSubmitScenario}
                  className="mt-6 w-full py-3 rounded-xl bg-[#8B5CF6] text-white text-sm font-medium disabled:opacity-30 hover:bg-[#7C3AED] transition-colors"
                >
                  开始{scenarioDef.title}
                </button>
              </div>

            ) : (
              /* ── 默认 landing ── */
              <>
                <div className="text-center">
                  <h1 className="text-2xl font-semibold mb-2">你想做什么样的调研？</h1>
                  <p className="text-[#555] text-sm">一个人完成分析师团队的深度调研</p>
                </div>

                {/* 场景卡片 */}
                <div className="w-full max-w-2xl grid grid-cols-3 gap-3">
                  {SCENARIOS.map((sc) => (
                    <button
                      key={sc.id}
                      onClick={() => setActiveScenario(sc.id)}
                      className="flex flex-col gap-3 p-5 rounded-xl border border-[#1E1E1E] text-left hover:border-[#8B5CF6]/50 hover:bg-[#8B5CF6]/5 transition-all group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-[#141414] flex items-center justify-center text-[#555] group-hover:text-[#8B5CF6] group-hover:bg-[#8B5CF6]/10 transition-all">
                        <ScenarioIcon id={sc.id} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#D4D4D4] group-hover:text-[#F2F2F2] transition-colors">{sc.title}</p>
                        <p className="text-xs text-[#444] mt-1 leading-relaxed">{sc.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* 分割线 + 通用搜索 */}
                <div className="flex items-center gap-3 w-full max-w-2xl">
                  <div className="flex-1 border-t border-[#1A1A1A]" />
                  <span className="text-xs text-[#2A2A2A]">或直接输入</span>
                  <div className="flex-1 border-t border-[#1A1A1A]" />
                </div>

                <div className="w-full max-w-xl">
                  <SearchBar
                    value={query}
                    onChange={setQuery}
                    onSubmit={() => startResearch(query)}
                    disabled={isRunning}
                  />
                </div>

                {/* 最近调研 */}
                {history.length > 0 && (
                  <div className="w-full max-w-xl">
                    <p className="text-[10px] text-[#444] uppercase tracking-widest mb-2">最近调研</p>
                    <div className="space-y-1">
                      {history.slice(0, 5).map((h) => (
                        <div
                          key={h.id}
                          onClick={() => loadHistoryRecord(h.id)}
                          className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1A1A1A] text-[#666] text-xs hover:border-[#2A2A2A] hover:text-[#A0A0A0] transition-colors cursor-pointer"
                        >
                          <span className="flex-1 truncate">{h.query}</span>
                          <span className="text-[10px] text-[#333] shrink-0">{relativeTime(h.created_at)}</span>
                          <button
                            onClick={(e) => removeHistory(h.id, e)}
                            className="opacity-0 group-hover:opacity-100 text-[#333] hover:text-red-400 transition-all"
                            title="删除"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 运行中：任务进度 ── */}
        {isRunning && !report && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
            <div className="flex items-center gap-3 text-[#A0A0A0]">
              <Spinner />
              <span className="text-sm">{statusMsg || '处理中...'}</span>
              <button
                onClick={() => abortRef.current?.abort()}
                className="text-xs px-2.5 py-1 rounded-lg border border-[#2A2A2A] text-[#444] hover:border-red-900/50 hover:text-red-400 transition-colors"
              >
                停止
              </button>
            </div>
            {tasks.length > 0 && (
              <div className="w-full max-w-md space-y-2">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                      task.status === 'running'
                        ? 'border-[#8B5CF6]/50 bg-[#8B5CF6]/5'
                        : task.status === 'done'
                        ? 'border-[#1E1E1E] bg-[#141414]'
                        : task.status === 'failed'
                        ? 'border-red-900/50 bg-red-950/30'
                        : 'border-[#1E1E1E] bg-[#0F0F0F]'
                    }`}
                  >
                    <span className="shrink-0 w-4 text-center">
                      {task.status === 'pending' && <span className="text-[#333] text-xs">○</span>}
                      {task.status === 'running' && <Spinner size="sm" />}
                      {task.status === 'done' && <span className="text-green-500 text-xs">✓</span>}
                      {task.status === 'failed' && <span className="text-red-400 text-xs">✗</span>}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${task.status === 'pending' ? 'text-[#444]' : 'text-[#D4D4D4]'}`}>
                        {task.question}
                      </p>
                      <p className="text-xs text-[#444] mt-0.5">
                        {SKILL_LABEL[task.skill] ?? task.skill}
                        {task.duration_ms && (
                          <span className="text-[#3A6A3A] ml-1">· {(task.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── 报告态：Perplexity 布局 ── */}
        {report && (
          <>
            {/* 主内容 */}
            <main className="flex-1 overflow-y-auto">
              <div className="max-w-2xl mx-auto px-6 py-8 pb-32">

                {/* 问题标题 + 导出按钮 */}
                <div className="flex items-start justify-between gap-4 mb-5">
                  <h1 className="text-lg font-semibold text-[#F2F2F2] leading-snug flex-1">
                    {activeQuery}
                  </h1>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handleShare}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#2A2A2A] text-[#555] text-xs hover:border-[#8B5CF6]/50 hover:text-[#A0A0A0] transition-colors"
                      title="复制分享链接"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M8 1h3v3M11 1L6 6M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      {copied ? '已复制!' : '分享'}
                    </button>
                    <button
                      onClick={() => downloadMarkdown(report, activeQuery)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#2A2A2A] text-[#555] text-xs hover:border-[#8B5CF6]/50 hover:text-[#A0A0A0] transition-colors"
                      title="导出 Markdown"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M6 1v7M3 5l3 3 3-3M1 10h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      导出 MD
                    </button>
                  </div>
                </div>

                {/* 核心回答 */}
                <div className="mb-6">
                  <AnswerText text={report.summary} />
                </div>

                {/* 展开章节 */}
                {report.sections.map((section, i) => (
                  <div key={i} className="mb-5">
                    <h3 className="text-sm font-semibold text-[#F2F2F2] mb-1.5">{section.title}</h3>
                    <AnswerText text={section.content} />
                  </div>
                ))}

                {/* 竞品矩阵 */}
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

                {/* 相关问题 */}
                {report.related_questions && report.related_questions.length > 0 && (
                  <div className="mt-8">
                    <p className="text-xs text-[#444] uppercase tracking-widest mb-3">相关问题</p>
                    <div className="space-y-2">
                      {report.related_questions.map((q) => (
                        <button
                          key={q}
                          onClick={() => { setQuery(q); startResearch(q, savedCtx) }}
                          disabled={isRunning}
                          className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-[#1E1E1E] text-[#A0A0A0] text-sm hover:border-[#8B5CF6]/50 hover:text-[#D4D4D4] transition-colors group"
                        >
                          <svg className="w-3.5 h-3.5 text-[#444] group-hover:text-[#8B5CF6] shrink-0 transition-colors" fill="none" viewBox="0 0 16 16">
                            <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM7 5h2v4H7V5zm0 5h2v2H7v-2z" fill="currentColor"/>
                          </svg>
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 追问输入框（底部悬浮） */}
              <div className="fixed bottom-0 left-0 right-0 px-6 pb-4 bg-gradient-to-t from-[#0F0F0F] via-[#0F0F0F]/95 to-transparent pointer-events-none">
                <div className="max-w-2xl mx-auto pointer-events-auto" style={{ marginLeft: 'calc(50% - min(512px, 50%) + 0px)' }}>
                  {savedCtx && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className="text-[10px] text-[#444] uppercase tracking-widest">追问上下文已保存</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#8B5CF6]/10 text-[#8B5CF6]">
                        {savedCtx.insightKeys.length} 条洞察
                      </span>
                      <button
                        onClick={() => setSavedCtx(null)}
                        className="text-[10px] text-[#333] hover:text-[#555] transition-colors"
                      >
                        清除
                      </button>
                    </div>
                  )}
                  <SearchBar
                    value={followUp}
                    onChange={setFollowUp}
                    onSubmit={() => { startResearch(followUp, savedCtx); setFollowUp('') }}
                    disabled={isRunning}
                    placeholder={savedCtx ? `继续追问「${savedCtx.previousQuery}」...` : '继续追问...'}
                  />
                </div>
              </div>
            </main>

            {/* 来源面板 */}
            {report.sources.length > 0 && (
              <aside className="w-64 border-l border-[#1E1E1E] overflow-y-auto shrink-0 py-5 px-4">
                <p className="text-xs text-[#444] uppercase tracking-widest mb-4">
                  来源 · {report.sources.length}
                </p>
                <div className="space-y-1">
                  {report.sources.map((s) => (
                    <a
                      key={s.index}
                      id={`source-${s.index}`}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex gap-2.5 p-2 rounded-lg hover:bg-[#141414] transition-colors group"
                    >
                      <span className="text-[10px] text-[#8B5CF6] font-mono mt-0.5 shrink-0 w-4">[{s.index}]</span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#D4D4D4] line-clamp-2 leading-relaxed group-hover:text-[#F2F2F2] transition-colors">
                          {s.title}
                        </p>
                        <p className="text-[11px] text-[#444] mt-0.5 truncate">
                          {safeHostname(s.url)}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </aside>
            )}
          </>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-3 rounded-lg bg-red-950/80 border border-red-900/50 text-red-300 text-sm backdrop-blur-sm">
          {error}
        </div>
      )}
    </div>
  )
}

// ─── 子组件 ────────────────────────────────────────────

function SearchBar({
  value, onChange, onSubmit, disabled, placeholder = '你想调研什么？',
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  disabled: boolean
  placeholder?: string
}) {
  return (
    <div className="flex gap-2 w-full">
      <input
        className="flex-1 bg-[#141414] border border-[#2A2A2A] rounded-xl px-4 py-3 text-sm outline-none focus:border-[#8B5CF6]/60 transition-colors placeholder-[#444] text-[#F2F2F2]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && value.trim() && onSubmit()}
        disabled={disabled}
      />
      <button
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        className="px-4 py-3 rounded-xl bg-[#8B5CF6] text-white text-sm font-medium disabled:opacity-30 hover:bg-[#7C3AED] transition-colors shrink-0"
      >
        调研
      </button>
    </div>
  )
}

function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const cls = size === 'sm'
    ? 'w-3 h-3 border-[1.5px]'
    : 'w-4 h-4 border-2'
  return (
    <span className={`inline-block ${cls} border-[#8B5CF6] border-t-transparent rounded-full animate-spin`} />
  )
}

// 渲染带行内引用 [n] 和 **加粗** 的 markdown 文本
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
        return (
          <p key={i}><InlineTokens text={para} /></p>
        )
      })}
    </div>
  )
}

function InlineTokens({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        const cite = part.match(/^\[(\d+)\]$/)
        if (cite) return <CitationChip key={i} index={parseInt(cite[1])} />
        const bold = part.match(/^\*\*([^*]+)\*\*$/)
        if (bold) return <strong key={i} className="text-[#F2F2F2] font-semibold">{bold[1]}</strong>
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

function CitationChip({ index }: { index: number }) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const el = document.getElementById(`source-${index}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      el.classList.add('source-highlight')
      setTimeout(() => el.classList.remove('source-highlight'), 1200)
    }
  }
  return (
    <sup>
      <button
        onClick={handleClick}
        className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[9px] bg-[#8B5CF6]/15 text-[#A78BFA] rounded cursor-pointer hover:bg-[#8B5CF6]/40 active:bg-[#8B5CF6]/60 transition-colors ml-0.5 select-none"
      >
        {index}
      </button>
    </sup>
  )
}

function buildMarkdown(report: Report, query: string): string {
  const lines: string[] = []

  lines.push(`# ${report.title || query}`, '')
  lines.push(report.summary, '')

  for (const section of report.sections) {
    lines.push(`## ${section.title}`, '')
    lines.push(section.content, '')
  }

  if (report.compare_matrix) {
    const { dimensions, targets, cells } = report.compare_matrix
    lines.push('## 竞品对比矩阵', '')
    lines.push(`| 维度 | ${targets.join(' | ')} |`)
    lines.push(`|------|${targets.map(() => '------').join('|')}|`)
    for (const dim of dimensions) {
      const row = targets.map((t) => cells[dim]?.[t] ?? '—')
      lines.push(`| ${dim} | ${row.join(' | ')} |`)
    }
    lines.push('')
  }

  if (report.related_questions?.length) {
    lines.push('## 相关问题', '')
    for (const q of report.related_questions) lines.push(`- ${q}`)
    lines.push('')
  }

  if (report.sources.length) {
    lines.push('---', '', '## 来源', '')
    for (const s of report.sources) {
      lines.push(`${s.index}. [${s.title}](${s.url})`)
    }
    lines.push('')
  }

  const ts = new Date(report.generated_at).toLocaleString('zh-CN')
  lines.push(`*由 [Farsight](https://github.com/your-org/farsight) 生成 · ${ts}*`)

  return lines.join('\n')
}

function downloadMarkdown(report: Report, query: string) {
  const md = buildMarkdown(report, query)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${query.slice(0, 40).replace(/[/\\?%*:|"<>]/g, '-')}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function ScenarioIcon({ id }: { id: ScenarioId }) {
  if (id === 'market') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="9" width="3" height="6" rx="0.5" fill="currentColor" opacity=".5"/>
      <rect x="6" y="5" width="3" height="10" rx="0.5" fill="currentColor" opacity=".75"/>
      <rect x="11" y="1" width="3" height="14" rx="0.5" fill="currentColor"/>
    </svg>
  )
  if (id === 'competitor') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  )
  // funding
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 12L5 8L9 10L15 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M11 3h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function safeHostname(url: string) {
  try { return new URL(url).hostname } catch { return url }
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}小时前`
  return `${Math.floor(hrs / 24)}天前`
}
