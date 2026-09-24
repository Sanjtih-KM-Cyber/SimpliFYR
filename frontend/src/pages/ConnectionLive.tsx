import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getConnection } from '../api/client'
import type { ConnectionSummary } from '../api/types'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { EmptyState, PageHeader } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useLive, type LiveEvent } from '../hooks/useLive'

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
  const [paused, setPaused] = useState(false)

  // Single shared socket implementation: health-gated + retry-capped, so a
  // down backend shows Disconnected instead of spamming handshake errors.
  const { connected } = useLive({
    source: sourceName || undefined,
    enabled: !paused && sourceName !== '',
    onEvent: (msg) => setEvents((prev) => [msg, ...prev].slice(0, 100)),
  })

  return (
    <div className="flex h-full flex-col">
      <Link to={`/connections/${sourceName}`} className="mb-5 inline-flex rounded-lg px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50">
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
                className={`btn-glass rounded-xl border px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider ${paused ? 'border-amber-400/25 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15' : 'border-white/[0.12] bg-white/[0.06] text-slate-200 hover:bg-white/10'}`}
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
              <div className="data-scroll-region h-full max-h-[70vh] space-y-1.5 overflow-y-auto rounded-2xl border border-white/[0.1] bg-slate-900/50 p-3 shadow-inner shadow-black/20 custom-scrollbar">
                {events.map((e, i) => (
                  <div
                    key={`${e.event_id}-${i}`}
                    className="flex flex-wrap items-center justify-between rounded-xl border border-white/[0.08] bg-slate-950/45 px-4 py-3 transition-colors hover:border-cyan-400/20 hover:bg-cyan-400/[0.055] animate-slide-up"
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
