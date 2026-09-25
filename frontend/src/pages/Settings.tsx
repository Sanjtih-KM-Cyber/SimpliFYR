import { Outlet } from 'react-router-dom'
import { getConfig, getHealth, getStats } from '../api/client'
import { Spinner } from '../components/Spinner'
import { TabBar } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.07] py-2.5 text-sm last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-200">{value}</span>
    </div>
  )
}

export default function Settings() {
  return (
    <div>
      <TabBar
        tabs={[
          { to: '/settings', label: 'General', end: true },
          { to: '/settings/profiles', label: 'Profiles' },
          { to: '/settings/destinations', label: 'Destinations' },
        ]}
      />
      <p className="mb-6 -mt-3 text-sm text-slate-400">
        System, security, and pipeline configuration. Power-user controls live here.
      </p>

      <Outlet />
    </div>
  )
}

export function SettingsGeneral() {
  const health = useAsync(() => getHealth(), [])
  const stats = useAsync(() => getStats(), [])
  const config = useAsync(() => getConfig(), [])

  const c = config.data

  return (
    <div>
        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Runtime</h3>
          {health.loading ? (
            <Spinner />
          ) : (
            <>
              <Row label="Application" value={health.data?.app ?? '—'} />
              <Row label="Version" value={`v${health.data?.version ?? '—'}`} />
              <Row label="API" value={health.data?.status ?? '—'} />
              <Row label="Database" value={health.data?.database ?? '—'} />
            </>
          )}
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Pipeline</h3>
          {stats.loading ? (
            <Spinner />
          ) : (
            <>
              <Row label="Events Processed" value={String(stats.data?.total_events ?? '—')} />
              <Row label="Events / Second" value={String(stats.data?.events_per_second ?? '—')} />
              <Row label="Active Sources" value={String(stats.data?.sources ?? '—')} />
              <Row label="Needs Review Pending" value={String(stats.data?.quarantine_pending ?? '—')} />
            </>
          )}
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Scaling</h3>
          {config.loading ? (
            <Spinner />
          ) : (
            <>
              <Row label="Pipeline" value={`${c?.pipeline_backend ?? '—'} · ${c?.pipeline_workers ?? '—'} worker(s)`} />
              <Row label="Raw Store" value={c?.raw_store_backend ?? '—'} />
              <Row label="Cache" value={c?.cache_backend ?? '—'} />
              <Row
                label="Delivery Sinks"
                value={(c?.delivery_sinks?.length ?? 0) > 0 ? c!.delivery_sinks.join(', ') : 'none'}
              />
              <Row label="AI Provider" value={c?.ai_provider ?? '—'} />
              <Row label="Rate Limit / min" value={c?.rate_limit_per_minute ? String(c.rate_limit_per_minute) : 'unlimited'} />
              <Row
                label="Retention (raw/norm/audit)"
                value={
                  c?.raw_retention_days || c?.normalized_retention_days || c?.audit_retention_days
                    ? `${c?.raw_retention_days ?? 0}d / ${c?.normalized_retention_days ?? 0}d / ${c?.audit_retention_days ?? 0}d`
                    : c?.retention_days
                      ? `${c.retention_days}d (legacy)`
                      : 'disabled'
                }
              />
              <Row
                label="Syslog UDP"
                value={c?.syslog_enabled ? `${c.syslog_udp_host}:${c.syslog_udp_port}` : 'disabled'}
              />
            </>
          )}
        </section>
      </div>
  )
}
