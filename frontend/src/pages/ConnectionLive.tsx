import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getConnection } from '../api/client'
import type { ConnectionSummary, EventStatus } from '../api/types'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { EmptyState, PageHeader } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

interface LiveEvent {
  event_id: string
  source: string | null
  status: EventStatus | string
  received_at: string
  environment: string
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

export default function ConnectionLive() {
  const { sourceName = '' } = useParams()
  const connection = useAsync(() => getConnection(decodeURIComponent(sourceName)), [sourceName])
  const c: ConnectionSummary | null = connection.data

  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    if (!sourceName) return
    let ws: WebSocket | null = null
    let closedByUser = false

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${window.location.host}/api/v1/ws/live?source=${encodeURIComponent(sourceName)}`
      ws = new WebSocket(url)
      ws.onopen = () => setConnected(true)
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'ping' || pausedRef.current) return
          setEvents((prev) => [msg as LiveEvent, ...prev].slice(0, 100))
        } catch {
          return
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closedByUser) setTimeout(connect, 3000)
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closedByUser = true
      ws?.close()
    }
  }, [sourceName])

  return (
    <div>
      <Link to={`/connections/${sourceName}`} className="mb-2 inline-block text-sm text-slate-400 hover:text-white">
        ← Back
      </Link>

      {connection.loading && <Spinner />}
      {connection.error && <p className="text-sm text-red-400">{connection.error}</p>}

      {c && (
        <>
          <PageHeader
            title="Live"
            subtitle={
              <span className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'animate-pulse bg-emerald-500' : 'bg-red-500'}`} />
                <span>{connected ? 'Receiving' : 'Disconnected'}</span>
                <span className="text-slate-500">· {c.name}</span>
              </span>
            }
            actions={
              <button
                onClick={() => setPaused((v) => !v)}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                {paused ? 'Resume' : 'Pause'}
              </button>
            }
          />

          <section>
            {events.length === 0 ? (
              <EmptyState
                title={connected ? 'Waiting for events…' : 'Connecting…'}
                description={`Incoming events for ${c.name} stream here in real time. Send a log via the connection's ingestion channel to see it flow through.`}
              />
            ) : (
              <div className="max-h-[60vh] space-y-1 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-2 font-mono text-xs">
                {events.map((e, i) => (
                  <div
                    key={`${e.event_id}-${i}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-slate-800/60"
                  >
                    <span className="text-slate-300">{e.event_id.slice(0, 8)}…</span>
                    <span className="text-slate-500">{formatTime(e.received_at)}</span>
                    <StatusBadge status={e.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
