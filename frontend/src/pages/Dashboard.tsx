import { Link } from 'react-router-dom'
import { getAnomalies, getHealth, getStats, listConnections } from '../api/client'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { useAsync } from '../hooks/useAsync'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const health = useAsync(() => getHealth(), [])
  const stats = useAsync(() => getStats(), [])
  const connections = useAsync(() => listConnections(), [])
  const anomalies = useAsync(() => getAnomalies(), [])
  const s = stats.data

  const stageOrder = ['received', 'parsed', 'normalized', 'output', 'quarantined', 'dlq']
  const stages = s ? stageOrder.filter((k) => (s.events_by_status[k] ?? 0) > 0) : []

  const attention = (connections.data ?? []).filter((c) => c.health === 'needs_review')
  const topConnections = (connections.data ?? [])
    .filter((c) => c.events_processed > 0)
    .slice(0, 5)

  return (
    <div>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Home</h2>
        <p className="text-sm text-slate-400">
          Quickly determine whether Simplifyr is functioning correctly.
        </p>
      </header>

      {stats.loading && <Spinner />}
      {stats.error && <p className="text-sm text-red-400">{stats.error}</p>}

      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Events Processed" value={s?.total_events ?? '—'} />
        <Stat label="Events / Second" value={s?.events_per_second ?? '—'} />
        <Stat label="Connections" value={connections.data?.length ?? '—'} />
        <Stat label="Needs Review" value={s?.quarantine_pending ?? '—'} />
      </section>

      {attention.length > 0 && (
        <section className="mb-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4">
          <h3 className="mb-3 text-sm font-medium text-amber-200">Needs attention</h3>
          <div className="space-y-2 text-sm">
            {attention.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <Link
                  to={`/connections/${encodeURIComponent(c.name)}`}
                  className="text-amber-100 hover:underline"
                >
                  {c.name}
                </Link>
                <span className="text-amber-300">
                  {c.needs_review} need{c.needs_review === 1 ? '' : 's'} review
                </span>
              </div>
            ))}
          </div>
          <Link to="/needs-review" className="mt-3 inline-block text-sm text-amber-300 hover:text-amber-200">
            Review all changes →
          </Link>
        </section>
      )}

      {topConnections.length > 0 && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Top Connections</h3>
          <div className="space-y-2 text-sm">
            {topConnections.map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <Link
                  to={`/connections/${encodeURIComponent(c.name)}`}
                  className="text-slate-300 hover:underline"
                >
                  {c.name}
                </Link>
                <span className="flex items-center gap-3">
                  <span className="text-slate-500">
                    {c.events_processed.toLocaleString()} events ·{' '}
                    {(c.normalization_rate * 100).toFixed(1)}%
                  </span>
                  <StatusBadge status={c.health === 'needs_review' ? 'quarantined' : c.health === 'healthy' ? 'published' : 'draft'} />
                </span>
              </div>
            ))}
          </div>
          <Link to="/connections" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">
            All connections →
          </Link>
        </section>
      )}

      {s && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">By Pipeline Stage</h3>
          {stages.length === 0 ? (
            <p className="text-sm text-slate-500">No events yet. Run an ingest to get started.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {stages.map((status) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-slate-300">{status}</span>
                  <span className="font-semibold text-white">{s.events_by_status[status]}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Health</h3>
          <div className="flex items-center gap-2 text-sm">
            <span
              className={`h-2 w-2 rounded-full ${health.data?.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`}
            />
            <span className="text-slate-300">API</span>
            <span className="text-slate-500">
              {health.data ? `v${health.data.version}` : health.error ?? 'connecting…'}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span
              className={`h-2 w-2 rounded-full ${health.data?.database === 'ok' ? 'bg-emerald-500' : 'bg-red-500'}`}
            />
            <span className="text-slate-300">Database</span>
            <span className="text-slate-500">{health.data?.database ?? '…'}</span>
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Analytics Digest</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-500">Mappings</p>
              <p className="text-lg font-semibold text-white">{s?.mappings ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Output Profiles</p>
              <p className="text-lg font-semibold text-white">{s?.output_profiles ?? '—'}</p>
            </div>
          </div>
          <div className="mt-3 text-sm">
            <p className="text-xs uppercase text-slate-500">Anomalies</p>
            {anomalies.loading ? (
              <Spinner />
            ) : (
              <p className="text-slate-300">
                {anomalies.data
                  ? `${anomalies.data.high_volume.length} high-volume · ${anomalies.data.scanners.length} scanners`
                  : anomalies.error ?? '—'}
              </p>
            )}
          </div>
          <Link to="/analytics" className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300">
            Full analytics →
          </Link>
        </section>
      </div>
    </div>
  )
}
