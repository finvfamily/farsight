import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { z } from 'zod'

export type LLMProvider = 'claude' | 'minimax'

export type LLMMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type LLMCallOptions = {
  provider?: LLMProvider
  schema?: z.ZodType
  system?: string
  max_tokens?: number
}

export function selectProvider(taskType: 'planning' | 'extraction' | 'synthesis'): LLMProvider {
  if (process.env.LLM_PROVIDER) {
    return process.env.LLM_PROVIDER as LLMProvider
  }
  if (taskType === 'planning' || taskType === 'synthesis') return 'claude'
  return process.env.MINIMAX_API_KEY ? 'minimax' : 'claude'
}

// 用平衡括号计数法提取响应中第一个完整 JSON 对象/数组
// 比贪婪正则更可靠：不会把多个 JSON 对象合并，也不会被对象后面的说明文字干扰
function extractFirstJSON(text: string): string | null {
  const objIdx = text.indexOf('{')
  const arrIdx = text.indexOf('[')
  if (objIdx === -1 && arrIdx === -1) return null

  let start: number
  let open: string
  let close: string
  // 优先取 {} 对象（schema 通常期望 object），只有无 {} 时才取 []
  if (objIdx !== -1) {
    start = objIdx; open = '{'; close = '}'
  } else {
    start = arrIdx; open = '['; close = ']'
  }

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === open) depth++
    else if (c === close) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

// 带退避的重试，处理网络抖动和限流
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (attempt === retries) throw e
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    }
  }
  throw new Error('unreachable')
}

// 结构化调用：返回 JSON，强制 schema 约束
export async function llmCall<T>(
  messages: LLMMessage[],
  options: LLMCallOptions & { schema: z.ZodType<T> }
): Promise<T>

// 自由文本调用
export async function llmCall(
  messages: LLMMessage[],
  options?: LLMCallOptions & { schema?: undefined }
): Promise<string>

export async function llmCall<T>(
  messages: LLMMessage[],
  options: LLMCallOptions = {}
): Promise<T | string> {
  const provider = options.provider ?? selectProvider('synthesis')

  const systemPrompt = options.schema
    ? `${options.system ?? ''}\n\nYou MUST respond with valid JSON. No explanation, only JSON.`.trim()
    : options.system

  // 将 API 调用 + JSON 解析合并在同一个重试块内
  // 这样 JSON 畸形时可以重新向 LLM 发起请求（而不是重试解析同一段文本）
  const callAndParse = async (): Promise<T | string> => {
    let text: string

    if (provider === 'minimax') {
      const client = new OpenAI({
        apiKey: process.env.MINIMAX_API_KEY!,
        baseURL: 'https://api.minimax.chat/v1',
      })
      const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = []
      if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt })
      msgs.push(...messages.map((m) => ({ role: m.role, content: m.content })))

      const response = await client.chat.completions.create({
        model: 'MiniMax-M2.5',
        max_tokens: options.max_tokens ?? 4096,
        messages: msgs,
      })
      text = response.choices[0]?.message?.content ?? ''
    } else {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: options.max_tokens ?? 4096,
        system: systemPrompt,
        messages,
      })
      text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
    }

    if (!options.schema) return text

    const str = extractFirstJSON(text)
    if (!str) throw new Error(`LLM did not return valid JSON. Response: ${text.slice(0, 200)}`)

    const parsed = JSON.parse(str)

    // 如果 LLM 返回裸数组但 schema 期望对象，尝试用常见 key 包裹后再解析
    if (Array.isArray(parsed)) {
      for (const key of ['insights', 'results', 'sections', 'dimensions', 'items']) {
        const safe = options.schema.safeParse({ [key]: parsed })
        if (safe.success) return safe.data as T
      }
    }

    return options.schema.parse(parsed) as T
  }

  return withRetry(callAndParse)
}
