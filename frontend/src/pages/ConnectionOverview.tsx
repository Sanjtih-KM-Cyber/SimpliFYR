import { useState } from 'react'
import { Link } from 'react-router-dom'
import { exportLogs } from '../api/client'
import { StatusBadge } from '../components/Status'
import { EmptyState, TBody, TD, TH, THead, TR, Table } from '../components/ui'
import { useToast } from '../components/ui'
import { useConnection } from './connection-context'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="animate-slide-up rounded-lg border border-slate-700/50 p-5 glass-card">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="font-mono text-2xl font-bold text-white">{value}</p>
    </div>
  )
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function ConnectionOverview() {
  const { connection: c } = useConnection()
  const { toast } = useToast()
  const [downloading, setDownloading] = useState(false)

  const stageOrder = ['received', 'parsed', 'normalized', 'output', 'quarantined', 'dlq']

  async function download(format: 'json' | 'ndjson' | 'csv') {
    if (!c) return
    setDownloading(true)
    try {
      await exportLogs({ format, source: c.name })
      toast(`Downloaded ${c.name} logs (${format.toUpperCase()})`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(false)
    }
  }

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

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <Link
          to={`/connections/${encodeURIComponent(c.name)}/live`}
          className="rounded border border-emerald-900/50 bg-emerald-950/30 px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-emerald-400 transition-colors hover:bg-emerald-900/50 shadow-[0_0_10px_rgba(16,185,129,0.15)] animate-pulse"
        >
          ● View Live Stream
        </Link>
        <div className="h-5 w-px bg-slate-800"></div>
        <Link
          to="/logs"
          className="rounded border border-cyan-900/50 text-cyan-500 px-5 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors hover:bg-cyan-950/30"
        >
          Observe Indexed Logs
        </Link>
        <select
          value=""
          disabled={downloading}
          onChange={(e) => {
            if (e.target.value) download(e.target.value as 'json' | 'ndjson' | 'csv')
            e.target.value = ''
          }}
          className="rounded border border-slate-700 bg-slate-950 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-300 outline-none hover:bg-slate-900 disabled:opacity-50"
        >
          <option value="">{downloading ? 'Bundling Payload…' : 'Export Payload…'}</option>
          <option value="json">JSON format</option>
          <option value="ndjson">NDJSON format</option>
          <option value="csv">CSV format</option>
        </select>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start mb-6">
        <section className="animate-slide-up rounded-lg border border-slate-700/50 p-5 glass-card" style={{ animationDelay: '50ms' }}>
          <h3 className="mb-4 text-[12px] font-bold uppercase tracking-widest text-white border-b border-slate-800/80 pb-2">Schema Mapping Status</h3>
          {c.mapping ? (
            <div className="flex items-center gap-3 text-[13px]">
              <span className="font-mono font-bold text-cyan-400">{c.mapping.name}</span>
              <StatusBadge status={c.mapping.status} />
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">v{c.mapping.version}</span>
            </div>
          ) : (
            <div className="rounded border border-amber-900/30 bg-amber-950/10 p-3 leading-relaxed">
              <p className="text-[12px] text-amber-500/80">
                No active schema established — telemetry quarantined until structural context provided.
              </p>
            </div>
          )}
        </section>

        <section className="animate-slide-up rounded-lg border border-slate-700/50 p-5 glass-card" style={{ animationDelay: '100ms' }}>
          <h3 className="mb-4 text-[12px] font-bold uppercase tracking-widest text-white border-b border-slate-800/80 pb-2">Destinations Profile Link</h3>
          {c.output_profile ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
              <span className="text-slate-400">
                Bound deployment endpoint:{' '}
                <span className="font-mono font-bold text-emerald-400">{c.output_profile.name}</span>
              </span>
              <Link
                to={`/connections/${encodeURIComponent(c.name)}/output`}
                className="text-[11px] font-bold uppercase tracking-wider text-cyan-500 hover:text-cyan-400 underline decoration-cyan-900/50 underline-offset-4"
              >
                Manage Link
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-between text-[12px]">
              <p className="text-slate-500">
                No delivery link. Local index only.
              </p>
              <Link
                to={`/connections/${encodeURIComponent(c.name)}/output`}
                className="rounded border border-cyan-900/50 bg-cyan-950/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-500 hover:bg-cyan-900/50"
              >
                Establish Link
              </Link>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-8">
        {c.events_processed > 0 && (
          <section className="animate-slide-up rounded-lg border border-slate-700/50 p-5 glass-card" style={{ animationDelay: '150ms' }}>
            <h3 className="mb-4 text-[12px] font-bold uppercase tracking-widest text-white border-b border-slate-800/80 pb-2">Throughput by Operation</h3>
            <div className="space-y-2">
              {stageOrder
                .filter((k) => (c.events_by_status[k] ?? 0) > 0)
                .map((status) => (
                  <div key={status} className="flex items-center justify-between rounded border border-slate-800/50 bg-slate-900/50 px-3 py-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{status}</span>
                    <span className="font-mono text-[13px] font-bold text-white shadow-[0_0_10px_rgba(255,255,255,0.05)]">{c.events_by_status[status]}</span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {c.drift.length > 0 && (
          <section className="animate-slide-up rounded-lg border border-amber-900/30 bg-amber-950/10 p-5 glass-card" style={{ animationDelay: '200ms' }}>
            <h3 className="mb-4 text-[12px] font-bold uppercase tracking-widest text-amber-500 border-b border-amber-900/50 pb-2">Schema Drift Detentions</h3>
            <div className="space-y-3">
              {c.drift.map((d) => (
                <div key={d.id} className="flex items-center justify-between border-l-2 border-amber-700 pl-3">
                  <span className="text-[11px] font-mono text-amber-500/80">
                    <span className="uppercase tracking-widest text-amber-700/60 font-sans mr-2 text-[9px]">delta_fields:</span>
                    {d.new_fields.join(', ') || '—'}
                  </span>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
            <Link
              to={`/connections/${encodeURIComponent(c.name)}/needs-review`}
              className="mt-4 block rounded bg-amber-900/20 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-amber-500 transition-colors hover:bg-amber-900/40"
            >
              Analyze Queue →
            </Link>
          </section>
        )}
      </div>

      <section className="animate-slide-up rounded-lg border border-slate-700/50 glass-card p-1" style={{ animationDelay: '250ms' }}>
        <div className="px-4 pb-3 pt-4 border-b border-slate-800/50">
          <h3 className="text-[13px] font-bold uppercase tracking-wider text-white">Latest Telemetry Commits</h3>
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
                  <TD className="font-mono text-[11px] text-cyan-600/70">{e.event_id}</TD>
                  <TD>
                    <StatusBadge status={e.status} />
                  </TD>
                  <TD className="text-slate-400">{formatTime(e.received_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </section>
    </div>
  )
}
