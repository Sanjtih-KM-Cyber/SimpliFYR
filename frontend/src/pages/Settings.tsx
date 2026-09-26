import { Outlet } from 'react-router-dom'
import { getConfig, getHealth, getStats } from '../api/client'
import { TabBar } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

/* ============================================================================
   Value formatting — human-readable labels, technically precise values.
   ========================================================================= */

function humanizeBackend(value: string | null | undefined): string {
  if (!value) return '—'
  const known: Record<string, string> = {
    inmemory: 'In-memory',
    filesystem: 'Filesystem',
    redis: 'Redis',
    kafka: 'Kafka',
    s3: 'S3',
    sqlite: 'SQLite',
    postgres: 'PostgreSQL',
    postgresql: 'PostgreSQL',
  }
  return known[value.toLowerCase()] ?? value
}

function formatWorkers(count: number | null | undefined): string {
  if (count == null) return '—'
  return `${count.toLocaleString()} worker${count === 1 ? '' : 's'}`
}

function formatRateLimit(perMinute: number | null | undefined): string {
  if (!perMinute) return 'Unlimited'
  return `${perMinute.toLocaleString()} / min`
}

function formatRetention(c: {
  raw_retention_days?: number | null
  normalized_retention_days?: number | null
  audit_retention_days?: number | null
  retention_days?: number | null
} | null | undefined): { value: string; caption: string | null } {
  if (!c) return { value: '—', caption: null }
  if (c.raw_retention_days || c.normalized_retention_days || c.audit_retention_days) {
    return {
      value: `${c.raw_retention_days ?? 0}d / ${c.normalized_retention_days ?? 0}d / ${c.audit_retention_days ?? 0}d`,
      caption: 'Raw / Normalized / Audit',
    }
  }
  if (c.retention_days) return { value: `${c.retention_days}d`, caption: null }
  return { value: 'Disabled', caption: null }
}

function formatSyslogUdp(c: {
  syslog_enabled?: boolean | null
  syslog_udp_host?: string | null
  syslog_udp_port?: number | null
} | null | undefined): string {
  if (!c?.syslog_enabled) return 'Disabled'
  return `${c.syslog_udp_host ?? '—'}:${c.syslog_udp_port ?? '—'}`
}

function formatSyslogTcp(c: {
  syslog_tcp_enabled?: boolean | null
  syslog_tcp_port?: number | null
} | null | undefined): string {
  if (!c?.syslog_tcp_enabled) return 'Disabled'
  return `TCP :${c.syslog_tcp_port ?? '—'}`
}

function formatFlag(enabled: boolean | null | undefined): string {
  return enabled ? 'Enabled' : 'Disabled'
}

/* ============================================================================
   Presentational pieces — all theme-driven, no new data.
   ========================================================================= */

type Tone = 'ok' | 'warn' | 'muted'

const DOT_TONES: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  muted: 'bg-on-surface-variant/40',
}

function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT_TONES[tone]} ${pulse ? 'animate-pulse-soft' : ''}`}
    />
  )
}

const PILL_TONES: Record<Tone, string> = {
  ok: 'border-success/30 bg-success-container/15 text-success',
  warn: 'border-warning/30 bg-warning-container/15 text-warning',
  muted: 'border-outline-variant bg-surface-variant text-on-surface-variant',
}

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label-sm font-semibold ${PILL_TONES[tone]}`}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant/70">
      {children}
    </p>
  )
}

function Metric({
  label,
  value,
  loading,
  tone = 'default',
}: {
  label: string
  value: string
  loading?: boolean
  tone?: 'default' | 'warn'
}) {
  return (
    <div>
      {loading ? (
        <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-variant" />
      ) : (
        <p
          className={`font-mono text-[26px] font-semibold leading-8 tracking-tight ${
            tone === 'warn' ? 'text-warning' : 'text-on-surface'
          }`}
        >
          {value}
        </p>
      )}
      <p className="mt-1 text-[12px] text-on-surface-variant">{label}</p>
    </div>
  )
}

function FieldRow({
  label,
  value,
  mono = false,
  muted = false,
  status,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  muted?: boolean
  status?: Tone | null
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="shrink-0 text-body-sm text-on-surface-variant">{label}</dt>
      <dd
        className={`min-w-0 text-right text-body-sm ${
          mono ? 'font-mono' : ''
        } ${muted ? 'text-on-surface-variant' : 'text-on-surface'}`}
      >
        {status ? (
          <span className="inline-flex items-center gap-1.5">
            <StatusDot tone={status} />
            {value}
          </span>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5">
        <SectionLabel>{title}</SectionLabel>
      </div>
      <dl className="space-y-2.5">{children}</dl>
    </div>
  )
}

function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-4 space-y-2.5" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="h-4 w-24 animate-pulse rounded bg-surface-variant" />
          <div className="h-4 w-32 animate-pulse rounded bg-surface-variant" />
        </div>
      ))}
    </div>
  )
}

/* ============================================================================
   Page shell — header establishes context, tabs stay secondary.
   ========================================================================= */

export default function Settings() {
  const health = useAsync(() => getHealth(), [])
  const h = health.data
  const operational = h != null && h.status === 'ok' && h.database === 'ok'

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-headline-md font-semibold tracking-tight text-on-surface">
            System Settings
          </h1>
          <p className="mt-1.5 max-w-2xl text-body-md text-on-surface-variant">
            Monitor system health and review the configuration powering your ingestion pipeline.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {health.loading || h == null ? (
            <StatusPill tone="muted">Checking…</StatusPill>
          ) : operational ? (
            <StatusPill tone="ok">Operational</StatusPill>
          ) : (
            <StatusPill tone="warn">Degraded</StatusPill>
          )}
          <span className="inline-flex items-center rounded-full border border-outline-variant bg-surface-variant px-2.5 py-1 font-mono text-label-sm text-on-surface-variant">
            v{h?.version ?? '—'}
          </span>
        </div>
      </header>

      <TabBar
        tabs={[
          { to: '/settings', label: 'General', end: true },
          { to: '/settings/profiles', label: 'Profiles' },
          { to: '/settings/destinations', label: 'Destinations' },
        ]}
      />

      <Outlet />
    </div>
  )
}

/* ============================================================================
   General — health overview, pipeline activity, infrastructure detail.
   ========================================================================= */

export function SettingsGeneral() {
  const health = useAsync(() => getHealth(), [])
  const stats = useAsync(() => getStats(), [])
  const config = useAsync(() => getConfig(), [])

  const h = health.data
  const s = stats.data
  const c = config.data

  const operational = h != null && h.status === 'ok' && h.database === 'ok'
  const healthKnown = h != null
  const apiOk = h?.status === 'ok'
  const dbOk = h?.database === 'ok'
  const pendingReview = s?.quarantine_pending ?? 0
  const retention = formatRetention(c)

  return (
    <div className="max-w-[1400px] space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* System health */}
        <section className="surface-panel animate-slide-up rounded-2xl p-5">
          <SectionLabel>System health</SectionLabel>
          {health.loading || !healthKnown ? (
            <CardSkeleton rows={4} />
          ) : (
            <>
              <div className="mt-3.5 flex items-center gap-3">
                <StatusDot tone={operational ? 'ok' : 'warn'} pulse={operational} />
                <div>
                  <p className="text-title-lg font-semibold text-on-surface">
                    {operational ? 'Operational' : 'Degraded'}
                  </p>
                  <p className="mt-0.5 text-body-sm text-on-surface-variant">
                    {h?.app ?? 'Simplifyr'} · v{h?.version ?? '—'}
                  </p>
                </div>
              </div>
              <dl className="mt-3 space-y-2.5">
                <FieldRow
                  label="API"
                  value={apiOk ? 'Operational' : (h?.status ?? '—')}
                  status={apiOk ? 'ok' : 'warn'}
                  muted={!apiOk && h?.status == null}
                />
                <FieldRow
                  label="Database"
                  value={dbOk ? 'Operational' : (h?.database ?? '—')}
                  status={dbOk ? 'ok' : 'warn'}
                  muted={!dbOk && h?.database == null}
                />
              </dl>
            </>
          )}
        </section>

        {/* Pipeline activity */}
        <section className="surface-panel animate-slide-up rounded-2xl p-5" style={{ animationDelay: '50ms' }}>
          <SectionLabel>Pipeline activity</SectionLabel>
          <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-5">
            <Metric
              label="Events processed"
              value={(s?.total_events ?? 0).toLocaleString()}
              loading={stats.loading}
            />
            <Metric
              label="Throughput"
              value={s != null ? `${s.events_per_second.toLocaleString()} / sec` : '—'}
              loading={stats.loading}
            />
            <Metric
              label="Active sources"
              value={String(s?.sources ?? 0)}
              loading={stats.loading}
            />
            <Metric
              label="Pending review"
              value={pendingReview.toLocaleString()}
              loading={stats.loading}
              tone={pendingReview > 0 ? 'warn' : 'default'}
            />
          </div>
        </section>
      </div>

      {/* Infrastructure & configuration — one panel per concern, each sized to its content */}
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <section className="surface-panel animate-slide-up rounded-2xl p-5" style={{ animationDelay: '100ms' }}>
          <Group title="Infrastructure">
            {config.loading || c == null ? (
              <CardSkeleton rows={4} />
            ) : (
              <>
                <FieldRow
                  label="Pipeline runtime"
                  value={`${humanizeBackend(c.pipeline_backend)} · ${formatWorkers(c.pipeline_workers)}`}
                />
                <FieldRow
                  label="Queue depth"
                  value={(c.pipeline_max_queue ?? 0).toLocaleString()}
                  mono
                />
                <FieldRow label="Raw storage" value={humanizeBackend(c.raw_store_backend)} />
                <FieldRow label="Cache" value={humanizeBackend(c.cache_backend)} />
              </>
            )}
          </Group>
        </section>

        <section className="surface-panel animate-slide-up rounded-2xl p-5" style={{ animationDelay: '150ms' }}>
          <Group title="AI processing">
            {config.loading || c == null ? (
              <CardSkeleton rows={2} />
            ) : (
              <>
                <FieldRow label="AI provider" value={c.ai_provider ?? '—'} mono />
                <FieldRow label="Rate limit" value={formatRateLimit(c.rate_limit_per_minute)} mono />
              </>
            )}
          </Group>
        </section>

        <section className="surface-panel animate-slide-up rounded-2xl p-5" style={{ animationDelay: '200ms' }}>
          <Group title="Delivery">
            {config.loading || c == null ? (
              <CardSkeleton rows={1} />
            ) : (
              <FieldRow
                label="Delivery destinations"
                value={
                  (c.delivery_sinks?.length ?? 0) > 0
                    ? c.delivery_sinks.join(', ')
                    : 'None configured'
                }
                mono={(c.delivery_sinks?.length ?? 0) > 0}
                muted={(c.delivery_sinks?.length ?? 0) === 0}
              />
            )}
          </Group>
        </section>

        <section className="surface-panel animate-slide-up rounded-2xl p-5" style={{ animationDelay: '250ms' }}>
          <Group title="Retention & logging">
            {config.loading || c == null ? (
              <CardSkeleton rows={5} />
            ) : (
              <>
                <div>
                  <FieldRow
                    label="Event retention"
                    value={retention.value}
                    mono
                    muted={retention.value === 'Disabled'}
                  />
                  {retention.caption && (
                    <p className="mt-0.5 text-right font-mono text-[11px] text-on-surface-variant/70">
                      {retention.caption}
                    </p>
                  )}
                </div>
                <FieldRow
                  label="Syslog endpoint"
                  value={formatSyslogUdp(c)}
                  mono
                  muted={!c.syslog_enabled}
                />
                <FieldRow
                  label="Syslog endpoint (TCP)"
                  value={formatSyslogTcp(c)}
                  mono
                  muted={!c.syslog_tcp_enabled}
                />
                <FieldRow
                  label="File watch"
                  value={formatFlag(c.file_watch_enabled)}
                  muted={!c.file_watch_enabled}
                />
                <FieldRow
                  label="Kafka ingress"
                  value={formatFlag(c.kafka_ingress_enabled)}
                  muted={!c.kafka_ingress_enabled}
                />
              </>
            )}
          </Group>
        </section>
      </div>
    </div>
  )
}
