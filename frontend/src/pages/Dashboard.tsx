import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getStats, listConnections } from '../api/client'
import { LoadTestPanel } from '../components/LoadTestPanel'
import { useToast } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'
import { useTheme } from '../context/ThemeContext'

function Stat({ label, value, loading }: { label: string; value: string | number; loading?: boolean }) {
  return (
    <div className="glass-card rounded-2xl p-5 flex flex-col justify-between">
      <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
      <div className="mt-4">
        {loading ? (
          <div className="h-8 w-16 animate-pulse surface-inset rounded-xl"></div>
        ) : (
          <p className="font-mono text-display-sm font-medium tracking-tight text-on-surface">{value}</p>
        )}
      </div>
    </div>
  )
}

function TacticalBadge({ text, intent }: { text: string; intent: 'success' | 'warning' | 'neutral' }) {
  const styles = {
    success: 'border-success/30 bg-success-container/20 text-success',
    warning: 'border-warning/30 bg-warning-container/20 text-warning',
    neutral: 'border-outline/30 bg-surface-variant text-on-surface-variant',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-sm font-semibold uppercase tracking-wide ${styles[intent]}`}>
      {text}
    </span>
  )
}

export default function Dashboard() {
  const stats = useAsync(() => getStats(), [])
  const connections = useAsync(() => listConnections(), [])
  const { toast } = useToast()
  const { theme, toggleTheme } = useTheme()
  const s = stats.data

  useLive({
    onEvent: (msg) => {
      stats.reload()
      connections.reload()
      if (msg.status === 'quarantined') {
        toast(`Quarantined event from ${msg.source ?? 'unknown source'} — review needed`, 'info')
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
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-outline-variant/50 pb-5">
        <div>
          <h2 className="text-headline-sm font-semibold tracking-tight text-on-surface mb-1.5 flex items-center gap-3">
            System Overview
            {useLive({ enabled: true, onEvent: () => {} }).connected && (
              <span className="flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-label-sm font-semibold uppercase tracking-wide text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></span>
                Live
              </span>
            )}
          </h2>
          <p className="text-body-md text-on-surface-variant">Global telemetry processing status and backend health metrics.</p>
        </div>
        <button
          onClick={toggleTheme}
          className="control-icon"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>
      </header>

      {stats.error && <div className="mb-6 surface-inset rounded-xl border-error/30 bg-error-container/10 p-3 text-body-sm text-error">{stats.error}</div>}

      <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total Processed" value={s?.total_events.toLocaleString() ?? '—'} loading={stats.loading} />
        <Stat label="Throughput (EPS)" value={s?.events_per_second.toLocaleString() ?? '—'} loading={stats.loading} />
        <Stat label="Active Streams" value={connections.data?.length ?? '—'} loading={connections.loading} />
        <Stat label="Needs Review" value={s?.quarantine_pending.toLocaleString() ?? '—'} loading={stats.loading} />
      </section>

      <div className="mb-8">
        <LoadTestPanel />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="glass-card rounded-2xl p-5">
          <div className="mb-4 flex items-center justify-between border-b border-outline-variant/50 pb-4">
            <h3 className="text-label-lg font-semibold uppercase tracking-wide text-on-surface-variant">Connections</h3>
            <Link to="/connections" className="text-body-sm font-medium text-primary hover:text-primary/70 hover:underline transition-colors">
              Manage
            </Link>
          </div>

          <div className="data-scroll-region max-h-[420px] overflow-x-auto overflow-y-auto">
            <table className="w-full text-left font-mono text-body-sm">
              <thead className="sticky top-0 surface-panel text-on-surface-variant">
                <tr>
                  <th className="pb-3 font-medium uppercase tracking-wider px-4">Source</th>
                  <th className="pb-3 font-medium uppercase tracking-wider px-4 text-right">Events</th>
                  <th className="pb-3 font-medium uppercase tracking-wider px-4 text-right">Match</th>
                  <th className="pb-3 font-medium uppercase tracking-wider px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/50">
                {allConnections.map((c) => (
                  <tr key={c.id} className="group hover:bg-primary/5 transition-colors duration-200 ease-standard">
                    <td className="py-3 px-4">
                      <Link to={`/connections/${encodeURIComponent(c.name)}`} className="text-body-md font-semibold text-on-surface group-hover:text-primary transition-colors">
                        {c.name}
                        {c.needs_review > 0 && (
                          <span className="ml-2 rounded-full border border-warning/30 bg-warning-container/20 px-1.5 py-0.5 font-mono text-label-sm text-warning">
                            {c.needs_review}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="py-3 px-4 text-right text-on-surface-variant">{c.events_processed.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right text-on-surface-variant">{(c.normalization_rate * 100).toFixed(1)}%</td>
                    <td className="py-3 px-4 text-right">
                      <TacticalBadge
                        text={c.health === 'needs_review' ? 'attention' : c.health === 'healthy' ? 'active' : 'idle'}
                        intent={c.health === 'needs_review' ? 'warning' : c.health === 'healthy' ? 'success' : 'neutral'}
                      />
                    </td>
                  </tr>
                ))}
                {allConnections.length === 0 && !connections.loading && (
                  <tr><td colSpan={4} className="py-6 text-center text-body-md text-on-surface-variant/70">No connections yet — add one to begin.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="glass-card rounded-2xl p-5 border-l-4 border-warning">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-label-lg font-semibold uppercase tracking-wide text-warning flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              Needs Attention
            </h3>
            <Link to="/needs-review" className="text-body-sm font-medium text-warning hover:text-warning/70 hover:underline transition-colors">
              Review Queue
            </Link>
          </div>
          {attention.length === 0 && !connections.loading ? (
            <div className="rounded-xl border border-success/20 bg-success-container/10 p-4 text-center">
              <p className="text-body-md font-semibold text-success">All clear — every event has a home.</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">New shapes will appear here with one-click approve.</p>
            </div>
          ) : (
            <div className="max-h-[380px] divide-y divide-warning/20 overflow-y-auto">
              {attention.map((c) => {
                const quarantined = Math.max(0, c.needs_review - (c.open_drift ?? 0))
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <Link to={`/connections/${encodeURIComponent(c.name)}/logs`} className="text-body-md font-medium text-warning hover:text-on-surface transition-colors">
                      {c.name}
                    </Link>
                    <span className="flex shrink-0 gap-1.5 font-mono text-label-sm">
                      {(c.open_drift ?? 0) > 0 && (
                        <span className="text-warning bg-warning-container/15 px-2 py-0.5 rounded border border-warning/20">
                          {c.open_drift} drift
                        </span>
                      )}
                      {quarantined > 0 && (
                        <span className="text-on-surface-variant bg-surface-variant px-2 py-0.5 rounded border border-outline-variant/50">
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