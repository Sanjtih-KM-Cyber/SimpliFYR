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

  const history = useAsync(
    () => (c?.name ? listEvents({ source: c.name, limit: 50 }) : Promise.resolve([])),
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

  const { connected } = useLive({
    source: sourceName || undefined,
    enabled: !paused && sourceName !== '',
    onEvent: (msg) => setEvents((prev) => [msg, ...prev].slice(0, 100)),
  })

  return (
    <div className="flex h-full flex-col">
      <Link to={`/connections/${sourceName}`} className="mb-5 inline-flex items-center rounded-lg px-1 text-label-sm font-semibold uppercase tracking-[0.14em] text-on-surface-variant transition-colors hover:text-primary hover:underline focus-ring">
        EXIT STREAM
      </Link>

      {connection.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
      {connection.error && <p className="text-body-md font-medium text-error">{connection.error}</p>}

      {c && (
        <div className="animate-slide-up flex h-full flex-col">
          <PageHeader
            title="Live Telemetry Sink"
            subtitle={`${connected ? '● Live' : '○ Connecting'} — streaming ${c.name} as it arrives`}
            actions={
              <span className="flex gap-2">
                <button
                  onClick={() => setShowConnect(true)}
                  className="btn-secondary"
                >
                  Connect Server
                </button>
                <button
                  onClick={() => setPaused((v) => !v)}
                  className={`btn-glass rounded-xl border px-5 py-2.5 text-label-sm font-bold uppercase tracking-wider ${
                    paused
                      ? 'border-warning/30 bg-warning-container/15 text-warning hover:bg-warning-container/20'
                      : 'border-outline-variant/50 bg-surface-container-low/50 text-on-surface hover:bg-surface-container'
                  }`}
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
              <div className="data-scroll-region h-full max-h-[70vh] space-y-1.5 overflow-y-auto surface-inset rounded-xl p-3">
                {rows.map((e, i) => (
                  <div
                    key={`${e.event_id}-${i}`}
                    className="flex flex-wrap items-center justify-between rounded-xl border border-outline-variant/50 bg-surface-dim/50 px-4 py-3 transition-colors duration-200 ease-standard hover:border-primary/20 hover:bg-primary/5 animate-slide-up"
                    style={{ animationDuration: '0.2s', opacity: paused ? 0.6 : 1 }}
                  >
                    <span className="font-mono text-body-sm text-primary/70">{e.event_id}</span>
                    <span className="font-mono text-mono-sm text-on-surface-variant/70">{formatTime(e.received_at)}</span>
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