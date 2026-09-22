import { useState } from 'react'
import { Link } from 'react-router-dom'
import { exportLogs } from '../api/client'
import { StatusBadge } from '../components/Status'
import { EmptyState, TBody, TD, TH, THead, TR, Table } from '../components/ui'
import { useToast } from '../components/ui'
import { useConnection } from './connection-context'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
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
    <div>
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Events Processed" value={c.events_processed.toLocaleString()} />
        <Stat label="Normalization Rate" value={`${(c.normalization_rate * 100).toFixed(1)}%`} />
        <Stat label="Needs Review" value={c.needs_review} />
        <Stat
          label="Avg Latency"
          value={c.avg_latency_ms > 0 ? `${c.avg_latency_ms.toFixed(1)} ms` : '—'}
        />
      </section>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link
          to={`/connections/${encodeURIComponent(c.name)}/live`}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          View Live
        </Link>
        <Link
          to="/logs"
          className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Browse all logs
        </Link>
        <select
          value=""
          disabled={downloading}
          onChange={(e) => {
            if (e.target.value) download(e.target.value as 'json' | 'ndjson' | 'csv')
            e.target.value = ''
          }}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
        >
          <option value="">{downloading ? 'Downloading…' : 'Download…'}</option>
          <option value="json">JSON</option>
          <option value="ndjson">NDJSON</option>
          <option value="csv">CSV</option>
        </select>
      </div>

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-white">Mapping</h3>
        {c.mapping ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium text-white">{c.mapping.name}</span>
            <StatusBadge status={c.mapping.status} />
            <span className="text-slate-500">v{c.mapping.version}</span>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No mapping yet — events from this connection are quarantined until one is created.
          </p>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-white">Output</h3>
        {c.output_profile ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">
              Bound output profile:{' '}
              <span className="font-medium text-white">{c.output_profile.name}</span>
            </span>
            <Link
              to={`/connections/${encodeURIComponent(c.name)}/output`}
              className="text-sm text-sky-400 hover:text-sky-300"
            >
              Manage binding →
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No recipe binding yet — outputs apply per-request.{' '}
            <Link
              to={`/connections/${encodeURIComponent(c.name)}/output`}
              className="text-sky-400 hover:text-sky-300"
            >
              Bind a profile →
            </Link>
          </p>
        )}
      </section>

      {c.events_processed > 0 && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">By Pipeline Stage</h3>
          <div className="space-y-2 text-sm">
            {stageOrder
              .filter((k) => (c.events_by_status[k] ?? 0) > 0)
              .map((status) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-slate-300">{status}</span>
                  <span className="font-semibold text-white">{c.events_by_status[status]}</span>
                </div>
              ))}
          </div>
        </section>
      )}

      {c.drift.length > 0 && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Needs Review</h3>
          <div className="space-y-2 text-sm">
            {c.drift.map((d) => (
              <div key={d.id} className="flex items-center justify-between">
                <span className="text-slate-300">
                  New fields: {d.new_fields.join(', ') || '—'}
                </span>
                <StatusBadge status={d.status} />
              </div>
            ))}
          </div>
          <Link
            to={`/connections/${encodeURIComponent(c.name)}/needs-review`}
            className="mt-3 inline-block text-sm text-sky-400 hover:text-sky-300"
          >
            Review changes →
          </Link>
        </section>
      )}

      <section>
        <h3 className="mb-3 text-sm font-medium text-white">Recent Events</h3>
        {c.recent_events.length === 0 ? (
          <EmptyState
            title="No events yet"
            description="Events for this connection will appear here."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Event</TH>
                <TH>Status</TH>
                <TH>Received</TH>
              </TR>
            </THead>
            <TBody>
              {c.recent_events.map((e) => (
                <TR key={e.id}>
                  <TD className="font-mono text-xs text-slate-300">{e.event_id}</TD>
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
