import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getStats, listConnections } from '../api/client'
import { LoadTestPanel } from '../components/LoadTestPanel'
import { useToast } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'

function Stat({ label, value, loading }: { label: string; value: string | number; loading?: boolean }) {
  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col justify-between">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-4">
        {loading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-slate-800"></div>
        ) : (
          <p className="font-mono text-3xl font-medium tracking-tight text-white">{value}</p>
        )}
      </div>
    </div>
  )
}

function TacticalBadge({ text, intent }: { text: string; intent: 'success' | 'warning' | 'neutral' }) {
  const styles = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    neutral: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${styles[intent]}`}>
      {text}
    </span>
  )
}

export default function Dashboard() {
  const stats = useAsync(() => getStats(), [])
  const connections = useAsync(() => listConnections(), [])
  const { toast } = useToast()
  const s = stats.data

  useLive({
    onEvent: (msg) => {
      stats.reload()
      connections.reload()
      if (msg.status === 'quarantined') {
        toast(`Quarantined event from ${msg.source ?? 'unknown source'} — review needed`, 'error')
      } else if (msg.status === 'dlq') {
        toast(`Malformed event from ${msg.source ?? 'unknown source'} moved to DLQ`, 'error')
      }
    },
  })

  useEffect(() => {
    const timer = setInterval(() => {
      stats.reload()
      connections.reload()
    }, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const attention = (connections.data ?? []).filter((c) => c.needs_review > 0)
  const allConnections = (connections.data ?? [])
    .filter((c) => c.events_processed > 0)
    .sort((a, b) => b.events_processed - a.events_processed)

  return (
    <div className="max-w-6xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/50 pb-5">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white mb-1.5 flex items-center gap-3">
            System Overview
            {useLive({ enabled: true, onEvent: () => { } }).connected && (
              <span className="flex items-center gap-1.5 rounded-full bg-cyan-950/40 border border-cyan-800/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                Live
              </span>
            )}
          </h2>
          <p className="text-[13px] text-slate-400">Global telemetry processing status and backend health metrics.</p>
        </div>
      </header>

      {stats.error && <div className="mb-6 rounded border border-rose-900/50 bg-rose-950/30 p-3 text-[13px] text-rose-400">{stats.error}</div>}

      <section className="mb-8 grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat label="Total Processed" value={s?.total_events.toLocaleString() ?? '—'} loading={stats.loading} />
        <Stat label="Throughput (EPS)" value={s?.events_per_second.toLocaleString() ?? '—'} loading={stats.loading} />
        <Stat label="Active Streams" value={connections.data?.length ?? '—'} loading={connections.loading} />
        <Stat label="Needs Review" value={s?.quarantine_pending.toLocaleString() ?? '—'} loading={stats.loading} />
      </section>

      <div className="mb-8">
        <LoadTestPanel />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="glass-panel rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between border-b border-slate-800/50 pb-4">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-300">Connections</h3>
            <Link to="/connections" className="group inline-flex items-center gap-1 text-[12px] font-medium text-cyan-400 transition-all duration-300 ease-in-out hover:text-cyan-300">Manage <span className="inline-block transition-transform duration-300 ease-in-out motion-safe:group-hover:translate-x-0.5">&rarr;</span></Link>
          </div>

          <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
            <table className="w-full text-left font-mono text-[12px]">
              <thead className="sticky top-0 bg-slate-900 text-slate-500">
                <tr>
                  <th className="pb-3 font-medium uppercase tracking-wider">Source</th>
                  <th className="pb-3 font-medium uppercase tracking-wider text-right">Events</th>
                  <th className="pb-3 font-medium uppercase tracking-wider text-right">Match</th>
                  <th className="pb-3 font-medium uppercase tracking-wider text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {allConnections.map((c) => (
                  <tr key={c.id} className="group hover:bg-white/5 transition-colors duration-300 ease-in-out">
                    <td className="py-3">
                      <Link to={`/connections/${encodeURIComponent(c.name)}`} className="text-slate-200 font-sans text-[13px] font-medium group-hover:text-cyan-400 transition-colors">
                        {c.name}
                        {c.needs_review > 0 && (
                          <span className="ml-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                            {c.needs_review}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="py-3 text-right text-slate-400">{c.events_processed.toLocaleString()}</td>
                    <td className="py-3 text-right text-slate-400">{(c.normalization_rate * 100).toFixed(1)}%</td>
                    <td className="py-3 text-right">
                      <TacticalBadge
                        text={c.health === 'needs_review' ? 'attention' : c.health === 'healthy' ? 'active' : 'idle'}
                        intent={c.health === 'needs_review' ? 'warning' : c.health === 'healthy' ? 'success' : 'neutral'}
                      />
                    </td>
                  </tr>
                ))}
                {allConnections.length === 0 && !connections.loading && (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-500 font-sans italic text-[13px]">No connections yet — add one to begin.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-900/50 bg-amber-950/20 backdrop-blur-sm p-5 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50"></div>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Needs Attention
            </h3>
            <Link to="/needs-review" className="group inline-flex items-center gap-1 text-[12px] font-medium text-amber-400 transition-all duration-300 ease-in-out hover:text-amber-300">Review Queue <span className="inline-block transition-transform duration-300 ease-in-out motion-safe:group-hover:translate-x-0.5">&rarr;</span></Link>
          </div>
          {attention.length === 0 && !connections.loading ? (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 text-center">
              <p className="text-[13px] font-semibold text-emerald-400">All clear — every event has a home.</p>
              <p className="mt-1 text-[12px] text-slate-500">New shapes will appear here with one-click approve.</p>
            </div>
          ) : (
            <div className="max-h-[380px] divide-y divide-amber-900/30 overflow-y-auto">
              {attention.map((c) => {
                const quarantined = Math.max(0, c.needs_review - (c.open_drift ?? 0))
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link to={`/connections/${encodeURIComponent(c.name)}/logs`} className="text-[13px] font-medium text-amber-100 hover:text-white transition-colors">
                      {c.name}
                    </Link>
                    <span className="flex shrink-0 gap-1.5 font-mono text-[11px]">
                      {(c.open_drift ?? 0) > 0 && (
                        <span className="text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                          {c.open_drift} drift
                        </span>
                      )}
                      {quarantined > 0 && (
                        <span className="text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded border border-slate-700/50">
                          {quarantined} held
                        </span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
