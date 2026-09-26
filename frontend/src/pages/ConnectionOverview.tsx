import { Link } from 'react-router-dom'
import { StatusBadge } from '../components/Status'
import { TryItNow } from '../components/TryItNow'
import { EmptyState, TBody, TD, TH, THead, TR, Table } from '../components/ui'
import { useConnection } from './connection-context'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="glass-card rounded-xl p-5 animate-slide-up">
      <p className="mb-2 text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">{label}</p>
      <p className="font-mono text-headline-sm font-bold text-on-surface">{value}</p>
    </div>
  )
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function ConnectionOverview() {
  const { connection: c } = useConnection()

  return (
    <div className="pb-10">
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Events Processed" value={c.events_processed.toLocaleString()} />
        <Stat label="Normalization Rate" value={`${(c.normalization_rate * 100).toFixed(1)}%`} />
        <Stat label="Needs Review" value={c.needs_review} />
        <Stat
          label="Avg Latency"
          value={c.avg_latency_ms > 0 ? `${c.avg_latency_ms.toFixed(1)} ms` : '—'}
        />
      </section>

      <TryItNow sourceName={c.name} />

      <div className="mb-6 grid gap-6 lg:grid-cols-2 lg:items-start">
        <section className="glass-card rounded-xl p-5 animate-slide-up" style={{ animationDelay: '50ms' }}>
          <h3 className="mb-4 text-label-sm font-bold uppercase tracking-widest text-on-surface border-b border-outline-variant/50 pb-2">Schema Mapping Status</h3>
          {c.mapping ? (
            <div className="flex items-center gap-3 text-body-md">
              <span className="font-mono font-bold text-primary">{c.mapping.name}</span>
              <StatusBadge status={c.mapping.status} />
              <span className="surface-inset rounded px-1.5 py-0.5 font-mono text-label-sm text-on-surface-variant">v{c.mapping.version}</span>
            </div>
          ) : (
            <div className="surface-inset rounded-xl p-3 leading-relaxed border-l-4 border-warning">
              <p className="text-body-sm text-warning/90">
                No active schema established — telemetry quarantined until structural context provided.
              </p>
            </div>
          )}
        </section>

        <section className="glass-card rounded-xl p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
          <h3 className="mb-4 text-label-sm font-bold uppercase tracking-widest text-on-surface border-b border-outline-variant/50 pb-2">Output Profile</h3>
          {c.output_profile ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-body-md">
              <span className="text-on-surface-variant">
                Bound delivery endpoint:{' '}
                <span className="font-mono font-bold text-success">{c.output_profile.name}</span>
              </span>
              <a
                href="#try-it"
                className="text-label-sm font-bold uppercase tracking-wider text-primary hover:text-primary/70 underline decoration-primary/30 underline-offset-4"
              >
                Change Below
              </a>
            </div>
          ) : (
            <div className="flex items-center justify-between text-body-sm">
              <p className="text-on-surface-variant">
                No delivery link. Local index only.
              </p>
              <a
                href="#try-it"
                className="btn-outlined text-label-sm"
              >
                Establish Below
              </a>
            </div>
          )}
        </section>

        {c.drift.length > 0 && (
          <section className="glass-card rounded-xl p-5 animate-slide-up border-l-4 border-warning lg:col-span-2" style={{ animationDelay: '150ms' }}>
            <h3 className="mb-4 text-label-sm font-bold uppercase tracking-widest text-warning border-b border-warning/30 pb-2">Schema Drift Detentions</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {c.drift.map((d) => (
                <div key={d.id} className="flex items-center justify-between border-l-2 border-warning pl-3">
                  <span className="text-label-sm font-mono text-warning/80">
                    <span className="uppercase tracking-widest text-warning/50 font-sans mr-2 text-label-sm">delta_fields:</span>
                    {d.new_fields.join(', ') || '—'}
                  </span>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
            <Link
              to="/needs-review"
              className="mt-4 block surface-inset rounded-xl py-2 text-center text-label-sm font-bold uppercase tracking-wider text-warning transition-colors hover:bg-warning-container/10 hover:underline"
            >
              Analyze Queue
            </Link>
          </section>
        )}
      </div>

      <section className="glass-card rounded-xl p-1 animate-slide-up" style={{ animationDelay: '200ms' }}>
        <div className="px-4 pb-3 pt-4 border-b border-outline-variant/50">
          <h3 className="text-label-lg font-bold uppercase tracking-wider text-on-surface">Latest Telemetry Commits</h3>
        </div>
        {c.recent_events.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No events yet"
              description="Events for this connection will appear here."
            />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Global ID</TH>
                <TH>Lifecycle</TH>
                <TH>Commit Time</TH>
              </TR>
            </THead>
            <TBody>
              {c.recent_events.map((e) => (
                <TR key={e.id}>
                  <TD className="font-mono text-mono-sm text-primary/70">{e.event_id}</TD>
                  <TD>
                    <StatusBadge status={e.status} />
                  </TD>
                  <TD className="text-on-surface-variant">{formatTime(e.received_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  )
}