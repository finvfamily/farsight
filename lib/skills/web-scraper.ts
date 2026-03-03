import { chromium } from 'playwright'
import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { SkillHandler } from '@/lib/engine/skill-runtime'
import { Document } from '@/types'

// 用 Playwright + Readability 自实现网页抓取
// 处理 JS 渲染页面，提取干净正文，无需第三方 API
async function scrapeUrl(url: string): Promise<Document> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  })
  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })

    // 等待主要内容加载（最多 3 秒）
    await page.waitForTimeout(1500)

    const html = await page.content()
    const title = await page.title()

    // 用 Readability 提取正文（Firefox 同款算法）
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    const content = article?.textContent?.trim() ?? ''
    const cleanContent = content.replace(/\s+/g, ' ').trim()

    return {
      url,
      title: article?.title || title || url,
      content: cleanContent,
      metadata: {
        siteName: article?.siteName ?? '',
        byline: article?.byline ?? '',
      },
      word_count: cleanContent.split(/\s+/).filter(Boolean).length,
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

const webScraper: SkillHandler = {
  async execute(inputs) {
    const urls = inputs.urls as string[]
    const docs: Document[] = []
    const errors: string[] = []

    // 串行抓取，避免并发太多浏览器实例撑爆内存
    for (const url of urls) {
      try {
        const doc = await scrapeUrl(url)
        if (doc.word_count > 50) {
          docs.push(doc)
          console.log(`[web-scraper] ✓ ${url} (${doc.word_count} words)`)
        } else {
          console.warn(`[web-scraper] ⚠ ${url} — 内容过少，跳过`)
        }
      } catch (e) {
        const msg = (e as Error).message
        errors.push(`${url}: ${msg}`)
        console.warn(`[web-scraper] ✗ ${url} — ${msg}`)
      }
    }

    return {
      documents: docs,
      fetched: docs.length,
      failed: urls.length - docs.length,
      errors,
    }
  },
}

export default webScraper
