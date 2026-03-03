import { NextRequest } from 'next/server'
import { listHistory, getHistoryRecord, deleteHistory } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const record = getHistoryRecord(id)
    if (!record) return new Response('Not found', { status: 404 })
    return Response.json(record)
  }
  return Response.json(listHistory())
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return new Response('Missing id', { status: 400 })
  deleteHistory(id)
  return new Response(null, { status: 204 })
}
