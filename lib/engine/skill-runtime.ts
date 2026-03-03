import { chromium } from 'playwright'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { Document, SearchResult } from '@/types'
import { llmCall, selectProvider } from '@/lib/llm/adapter'
// context 注入给每个 Skill 的能力
export type SkillContext = {
  search: (query: string, opts?: { limit?: number }) => Promise<SearchResult[]>
  fetch: (url: string) => Promise<Document>
  llm: {
    call: (prompt: string, system?: string) => Promise<string>
    extract: <T>(content: string, schema: import('zod').ZodType<T>, instructions: string) => Promise<T>
  }
  log: {
    info: (msg: string) => void
    warn: (msg: string) => void
    error: (msg: string) => void
  }
}

export type SkillHandler = {
  execute: (inputs: Record<string, unknown>, context: SkillContext) => Promise<unknown>
}

// 构建注入 context，按 skill permissions 范围提供能力
export function buildContext(onLog?: (level: string, msg: string) => void): SkillContext {
  return {
    async search(query, opts = {}) {
      const limit = opts.limit ?? 10
      const apiKey = process.env.TAVILY_API_KEY
      if (!apiKey) throw new Error('TAVILY_API_KEY not set')

      // 网络抖动时最多重试 2 次
      let lastErr: Error = new Error('search failed')
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          const res = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: apiKey, query, max_results: limit }),
          })
          if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`)
          const data = await res.json()
          return (data.results ?? []).map((r: Record<string, string>) => ({
            url: r.url,
            title: r.title,
            snippet: r.content,
            source: new URL(r.url).hostname,
            fetched_at: new Date().toISOString(),
          })) as SearchResult[]
        } catch (e) {
          lastErr = e as Error
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        }
      }
      throw lastErr
    },

    async fetch(url) {
      const browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'zh-CN',
      })
      const page = await context.newPage()
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        await page.waitForTimeout(1500)
        const html = await page.content()
        const title = await page.title()
        const dom = new JSDOM(html, { url })
        const reader = new Readability(dom.window.document)
        const article = reader.parse()
        const content = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
        return {
          url,
          title: article?.title || title || url,
          content,
          metadata: { siteName: article?.siteName ?? '', byline: article?.byline ?? '' },
          word_count: content.split(/\s+/).filter(Boolean).length,
        } as Document
      } finally {
        await context.close()
        await browser.close()
      }
    },

    llm: {
      async call(prompt, system) {
        return llmCall(
          [{ role: 'user', content: prompt }],
          { system, provider: selectProvider('extraction') }
        )
      },
      async extract<T>(content: string, schema: import('zod').ZodType<T>, instructions: string) {
        return llmCall(
          [{ role: 'user', content: `${instructions}\n\nContent:\n${content}` }],
          { schema, provider: selectProvider('extraction') }
        )
      },
    },

    log: {
      info: (msg) => onLog?.('info', msg),
      warn: (msg) => onLog?.('warn', msg),
      error: (msg) => onLog?.('error', msg),
    },
  }
}
