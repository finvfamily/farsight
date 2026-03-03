// 核心数据类型，Skill 之间通过这些类型传递数据

export type SearchResult = {
  url: string
  title: string
  snippet: string
  source: string
  fetched_at: string
}

export type Document = {
  url: string
  title: string
  content: string
  metadata: Record<string, string>
  word_count: number
}

export type Insight = {
  key: string
  value: string
  confidence: number       // 0-1
  evidence_type: 'confirmed' | 'inferred' | 'indirect'
  source_urls: string[]
}

export type CompareTarget = {
  id: string
  name: string
  documents: Document[]
  insights: Insight[]
}

export type ReportSection = {
  title: string
  content: string
  evidence: Insight[]
}

export type CompareMatrix = {
  dimensions: string[]
  targets: string[]
  cells: Record<string, Record<string, string>>
}

export type Report = {
  title: string
  summary: string
  sections: ReportSection[]
  compare_matrix?: CompareMatrix
  related_questions?: string[]
  insights?: Insight[]          // 保留供追问时传回服务端
  sources: Array<{ index: number; url: string; title: string }>
  generated_at: string
}

// 追问时携带的上下文
export type FollowUpContext = {
  previousQuery: string
  insightKeys: string[]           // 精简摘要供 planner 分类用
  insights: Insight[]             // 完整洞察供 scheduler 预填充
  sources: Array<{ url: string; title: string }>
}

// 研究计划
export type ResearchTask = {
  id: string
  question: string
  skill_names: string[]
  stage: 'collect' | 'parse' | 'analyze' | 'output'
  inputs: Record<string, unknown>
  status: 'pending' | 'running' | 'done' | 'failed'
  result?: unknown
  error?: string
}

export type ResearchPlan = {
  intent: 'topic_research' | 'competitor_analysis'
  level: 'L2' | 'L3'
  tasks: ResearchTask[]
}

export type ResearchSession = {
  id: string
  query: string
  plan?: ResearchPlan
  context: ResearchContext
  status: 'planning' | 'running' | 'done' | 'failed'
  report?: Report
  created_at: string
}

export type ResearchContext = {
  documents: Document[]
  insights: Insight[]
  sources: Array<{ url: string; title: string }>
}

// SSE 事件类型
export type SSEEvent =
  | { type: 'status'; data: { message: string } }
  | { type: 'plan'; data: ResearchPlan }
  | { type: 'task_start'; data: { task_id: string; skill: string; question: string } }
  | { type: 'task_done'; data: { task_id: string; skill: string; duration_ms: number } }
  | { type: 'task_failed'; data: { task_id: string; error: string } }
  | { type: 'question'; data: { message: string; options: string[] } }
  | { type: 'report'; data: Report }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: Record<string, never> }
