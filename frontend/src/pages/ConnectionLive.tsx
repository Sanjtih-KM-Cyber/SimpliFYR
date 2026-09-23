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
    <div className="flex h-full flex-col">
      <Link to={`/connections/${sourceName}`} className="mb-4 inline-block text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-cyan-400">
        ← Exit Stream
      </Link>

      {connection.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
      {connection.error && <p className="text-[13px] font-medium text-rose-400">{connection.error}</p>}

      {c && (
        <div className="animate-slide-up flex h-full flex-col">
          <PageHeader
            title="Live Telemetry Sink"
            subtitle={
              <span className="flex items-center gap-2 mt-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.8)] ${connected ? 'animate-[pulse_1s_ease-in-out_infinite] bg-emerald-500' : 'bg-rose-500 shadow-[0_0_10px_rgba(225,29,72,0.8)]'}`} />
                <span className="font-bold text-[12px] uppercase tracking-wider">{connected ? 'Transmission Active' : 'Disconnected'}</span>
                <span className="text-slate-600 font-bold">///</span>
                <span className="text-slate-400 font-mono text-[10px] uppercase tracking-widest">Pipeline: {c.name}</span>
              </span>
            }
            actions={
              <button
                onClick={() => setPaused((v) => !v)}
                className={`rounded border px-5 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${paused ? 'border-amber-900 bg-amber-950/30 text-amber-500 hover:bg-amber-900/50' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
              >
                {paused ? '▶ Resume Feed' : '‖ Pause Feed'}
              </button>
            }
          />

          <section className="flex-1 min-h-[50vh]">
            {events.length === 0 ? (
              <EmptyState
                title={connected ? 'Listening for transmissions...' : 'Establishing Tunnel...'}
                description={connected ? `Ingestion port open for ${c.name}. Awaiting payload.` : 'Attempting to open WebSocket interface.'}
              />
            ) : (
              <div className="h-full max-h-[70vh] space-y-1.5 overflow-y-auto rounded-lg border border-slate-700/50 glass-card p-3 shadow-inner custom-scrollbar">
                {events.map((e, i) => (
                  <div
                    key={`${e.event_id}-${i}`}
                    className="flex flex-wrap items-center justify-between rounded border border-slate-800/80 bg-slate-900/40 px-4 py-2.5 transition-colors hover:border-cyan-900/50 hover:bg-cyan-950/20 glass-panel animate-slide-up"
                    style={{ animationDuration: '0.2s', opacity: paused ? 0.6 : 1 }}
                  >
                    <span className="font-mono text-[12px] text-cyan-600/80">{e.event_id}</span>
                    <span className="font-mono text-[11px] text-slate-500">{formatTime(e.received_at)}</span>
                    <StatusBadge status={e.status} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
