import fs from 'fs'
import path from 'path'
import { Report } from '@/types'

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'research-history.json')
const MAX_RECORDS = 200

export type HistoryItem = {
  id: string
  query: string
  created_at: string
}

export type HistoryRecord = HistoryItem & { report: Report }

function readAll(): HistoryRecord[] {
  try {
    if (!fs.existsSync(DB_PATH)) return []
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) as HistoryRecord[]
  } catch {
    return []
  }
}

function writeAll(records: HistoryRecord[]) {
  fs.writeFileSync(DB_PATH, JSON.stringify(records), 'utf-8')
}

export function saveHistory(query: string, report: Report): string {
  const records = readAll()
  const id = crypto.randomUUID()
  records.unshift({ id, query, report, created_at: new Date().toISOString() })
  writeAll(records.slice(0, MAX_RECORDS))
  return id
}

export function listHistory(limit = 50): HistoryItem[] {
  return readAll()
    .slice(0, limit)
    .map(({ id, query, created_at }) => ({ id, query, created_at }))
}

export function getHistoryRecord(id: string): HistoryRecord | null {
  return readAll().find((r) => r.id === id) ?? null
}

export function deleteHistory(id: string) {
  writeAll(readAll().filter((r) => r.id !== id))
}
