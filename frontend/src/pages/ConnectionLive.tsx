import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getConnection, listEvents } from '../api/client'
import type { ConnectionSummary } from '../api/types'
import { ConnectLiveModal } from '../components/ConnectLiveModal'
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
  const [showConnect, setShowConnect] = useState(false)

  // Seed with recent history so the tail is never an empty mystery: past
  // events load once, live arrivals prepend (dedupe by event_id).
  const history = useAsync(
    () => (c?.name ? listEvents({ source: c.name, limit: 50 }) : Promise.resolve([])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c?.name],
  )
  const seenLive = new Set(events.map((e) => e.event_id))
  const past = (history.data ?? []).filter((e) => !seenLive.has(e.event_id))
  const rows: LiveEvent[] = [
    ...events,
    ...past.map((e) => ({
      event_id: e.event_id,
      source: e.source,
      status: e.status,
      received_at: e.received_at,
      environment: '',
    })),
  ].slice(0, 100)

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
            subtitle={`${connected ? '● Live' : '○ Connecting'} — streaming ${c.name} as it arrives`}
            actions={
              <span className="flex gap-2">
                <button
                  onClick={() => setShowConnect(true)}
                  className="btn-glass rounded-xl border border-white/[0.12] bg-white/[0.06] px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-200 hover:bg-white/10"
                >
                  Connect Server
                </button>
                <button
                  onClick={() => setPaused((v) => !v)}
                  className={`btn-glass rounded-xl border px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider ${paused ? 'border-amber-400/25 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15' : 'border-white/[0.12] bg-white/[0.06] text-slate-200 hover:bg-white/10'}`}
                >
                  {paused ? '▶ Resume Feed' : '‖ Pause Feed'}
                </button>
              </span>
            }
          />

          <ConnectLiveModal open={showConnect} onClose={() => setShowConnect(false)} />

          <section className="flex-1 min-h-[50vh]">
            {rows.length === 0 ? (
              <EmptyState
                title={connected ? 'Listening for transmissions...' : 'Establishing Tunnel...'}
                description={
                  connected
                    ? `No events for ${c.name} yet — point a device at Connect Server or paste into Trial Run.`
                    : 'Attempting to open WebSocket interface.'
                }
              />
            ) : (
              <div className="data-scroll-region h-full max-h-[70vh] space-y-1.5 overflow-y-auto rounded-2xl border border-white/[0.1] bg-slate-900/50 p-3 shadow-inner shadow-black/20 custom-scrollbar">
                {rows.map((e, i) => (
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
