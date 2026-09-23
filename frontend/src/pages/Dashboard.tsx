import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAnomalies, getHealth, getStats, listConnections } from '../api/client'
import { QuickParseModal } from '../components/QuickParseModal'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'

function Stat({ label, value, loading }: { label: string; value: string | number; loading?: boolean }) {
  return (
    <div className="glass-card rounded-lg p-5 flex flex-col justify-between">
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

function HealthIndicator({ label, ok, version }: { label: string; ok: boolean; version?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/50 py-3 last:border-0 hover:bg-slate-800/20 px-3 -mx-3 rounded transition-colors">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="relative flex h-2.5 w-2.5">
          {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>}
          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${ok ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`}></span>
        </span>
        <span className="font-medium text-slate-300">{label}</span>
      </div>
      <span className="font-mono text-[11px] text-slate-500">{version ?? (ok ? 'OK' : 'ERR')}</span>
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
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${styles[intent]}`}>
      {text}
    </span>
  )
}

export default function Dashboard() {
  const health = useAsync(() => getHealth(), [])
  const stats = useAsync(() => getStats(), [])
  const connections = useAsync(() => listConnections(), [])
  const anomalies = useAsync(() => getAnomalies(), [])
  const { toast } = useToast()
  const [quickParse, setQuickParse] = useState(false)
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

  const attention = (connections.data ?? []).filter((c) => (c.open_drift ?? 0) > 0)
  const topConnections = (connections.data ?? [])
    .filter((c) => c.events_processed > 0)
    .sort((a, b) => b.events_processed - a.events_processed)
    .slice(0, 5)

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
        <button
          onClick={() => setQuickParse(true)}
          className="group relative inline-flex items-center justify-center overflow-hidden rounded-md bg-cyan-600 px-5 py-2 font-medium text-white shadow-[0_0_15px_rgba(6,182,212,0.2)] transition-all hover:bg-cyan-500 hover:shadow-[0_0_20px_rgba(6,182,212,0.4)]"
        >
          <span className="relative text-[13px] tracking-wide">+ Quick Parse</span>
        </button>
      </header>

      {quickParse && <QuickParseModal onClose={() => setQuickParse(false)} />}

      {stats.error && <div className="mb-6 rounded border border-rose-900/50 bg-rose-950/30 p-3 text-[13px] text-rose-400">{stats.error}</div>}

      <section className="mb-8 grid grid-cols-2 gap-5 lg:grid-cols-4">
        <Stat label="Total Processed" value={s?.total_events.toLocaleString() ?? '—'} loading={stats.loading} />
        <Stat label="Throughput (EPS)" value={s?.events_per_second.toLocaleString() ?? '—'} loading={stats.loading} />
        <Stat label="Active Streams" value={connections.data?.length ?? '—'} loading={connections.loading} />
        <Stat label="Needs Review" value={s?.quarantine_pending.toLocaleString() ?? '—'} loading={stats.loading} />
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">

          {attention.length > 0 && (
            <section className="rounded-lg border border-amber-900/50 bg-amber-950/20 backdrop-blur-sm p-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500/50"></div>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                  Action Required
                </h3>
                <Link to="/needs-review" className="text-[12px] font-medium text-amber-400 hover:text-amber-300 transition-colors">Review Queue &rarr;</Link>
              </div>
              <div className="divide-y divide-amber-900/30">
                {attention.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2">
                    <Link to={`/connections/${encodeURIComponent(c.name)}`} className="text-[13px] font-medium text-amber-100 hover:text-white transition-colors">
                      {c.name}
                    </Link>
                    <span className="font-mono text-[11px] text-amber-400/80 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {c.open_drift} signature{c.open_drift === 1 ? '' : 's'} unmatched
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="glass-panel rounded-lg p-5">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800/50 pb-4">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-300">High Volume Connections</h3>
              <Link to="/connections" className="text-[12px] font-medium text-cyan-400 hover:text-cyan-300 transition-colors">View All &rarr;</Link>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[12px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="pb-3 font-medium uppercase tracking-wider">Source</th>
                    <th className="pb-3 font-medium uppercase tracking-wider text-right">Events</th>
                    <th className="pb-3 font-medium uppercase tracking-wider text-right">Parse Rate</th>
                    <th className="pb-3 font-medium uppercase tracking-wider text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {topConnections.map((c) => (
                    <tr key={c.id} className="group hover:bg-slate-800/20 transition-colors">
                      <td className="py-3">
                        <Link to={`/connections/${encodeURIComponent(c.name)}`} className="text-slate-200 font-sans text-[13px] font-medium group-hover:text-cyan-400 transition-colors">
                          {c.name}
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
                  {topConnections.length === 0 && !connections.loading && (
                    <tr><td colSpan={4} className="py-6 text-center text-slate-500 font-sans italic text-[13px]">No active data streams detected.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="space-y-6 lg:col-span-4">
          <section className="glass-panel rounded-lg p-5">
            <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-slate-300 border-b border-slate-800/50 pb-4">Infrastructure Health</h3>
            <div className="flex flex-col">
              {health.loading ? (
                <div className="py-4 flex justify-center"><Spinner /></div>
              ) : (
                <>
                  <HealthIndicator label="REST API Interface" ok={health.data?.status === 'ok'} version={health.data ? `v${health.data.version}` : health.error ?? 'Connection Refused'} />
                  <HealthIndicator label="Storage Engine" ok={health.data?.database === 'ok'} version={health.data?.database} />
                </>
              )}
            </div>
          </section>

          <section className="glass-panel rounded-lg p-5">
            <h3 className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-slate-300 border-b border-slate-800/50 pb-4">Analytics Engine Profile</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded bg-slate-900/50 px-3 py-2 border border-slate-800/50">
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Mapping Rules</p>
                <p className="mt-1 font-mono text-xl text-slate-200">{stats.loading ? '—' : s?.mappings}</p>
              </div>
              <div className="rounded bg-slate-900/50 px-3 py-2 border border-slate-800/50">
                <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Output Sinks</p>
                <p className="mt-1 font-mono text-xl text-slate-200">{stats.loading ? '—' : s?.output_profiles}</p>
              </div>
            </div>

            <div className="mt-4 rounded bg-slate-900/50 p-3 border border-slate-800/50">
              <p className="mb-2 text-[10px] uppercase font-bold tracking-wider text-slate-500">Security Anomalies</p>
              {anomalies.loading ? (
                <div className="h-4 w-24 animate-pulse rounded bg-slate-800"></div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-[12px]">
                    <span className="text-slate-400">Layer 4 Scanners</span>
                    <span className="font-mono text-amber-400">{anomalies.data?.scanners.length ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center text-[12px]">
                    <span className="text-slate-400">High-burst Sources</span>
                    <span className="font-mono text-amber-400">{anomalies.data?.high_volume.length ?? 0}</span>
                  </div>
                </div>
              )}
            </div>
            <Link to="/settings" className="mt-4 block text-center text-[12px] font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
              Manage Framework Specs &rarr;
            </Link>
          </section>
        </div>
      </div>
    </div>
  )
}
