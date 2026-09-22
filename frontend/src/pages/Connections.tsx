import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getConfig, listConnections } from '../api/client'
import type { ConnectionSummary } from '../api/types'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { EmptyState, Modal, PageHeader, TBody, TD, TH, THead, TR, Table } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

const HEALTH_STYLES: Record<string, string> = {
  healthy: 'bg-emerald-700 text-emerald-100',
  needs_review: 'bg-amber-700 text-amber-100',
  idle: 'bg-slate-700 text-slate-300',
}

function HealthBadge({ health }: { health: string }) {
  const style = HEALTH_STYLES[health] ?? 'bg-slate-700 text-slate-300'
  const label = health === 'needs_review' ? 'needs review' : health
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  )
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

function ConnectLiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useAsync(() => getConfig(), [])
  const c = config.data
  const origin = window.location.origin

  return (
    <Modal open={open} title="Connect Live Logs" onClose={onClose} width="max-w-xl">
      <p className="mb-4 text-sm text-slate-400">
        Live logs flow through the same pipeline as uploads: Receiving → Processing →
        Normalizing → Storing → Delivering.
      </p>

      <div className="space-y-4">
        <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <h4 className="mb-2 text-sm font-medium text-white">Syslog (UDP)</h4>
          {c?.syslog_enabled ? (
            <>
              <p className="text-xs text-slate-400">
                Point your device at:
              </p>
              <p className="mt-1 font-mono text-sm text-emerald-300">
                {c.syslog_udp_host}:{c.syslog_udp_port}
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Disabled — enable it in Settings (SYSLOG_ENABLED) to receive syslog streams.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <h4 className="mb-2 text-sm font-medium text-white">HTTP</h4>
          <p className="text-xs text-slate-400">POST each event to:</p>
          <p className="mt-1 font-mono text-sm text-emerald-300">{origin}/api/v1/ingest</p>
          <p className="mt-2 text-xs text-slate-500">
            with form fields: <span className="font-mono">raw</span>,{' '}
            <span className="font-mono">source</span>
          </p>
        </section>

        <p className="text-xs text-slate-500">
          Name the <span className="font-mono">source</span> the same as an existing connection and
          its recipe is applied automatically — configure once, reuse automatically.
        </p>

        <Link
          to="/connections/new"
          onClick={onClose}
          className="inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          Create a connection →
        </Link>
      </div>
    </Modal>
  )
}

export default function Connections() {
  const connections = useAsync(() => listConnections(), [])
  const rows = connections.data ?? []
  const [showLiveInfo, setShowLiveInfo] = useState(false)

  const needsAttention = (c: ConnectionSummary) => c.health !== 'idle'

  return (
    <div>
      <PageHeader
        title="Connections"
        subtitle="Every source Simplifyr normalizes for you, in one place."
        actions={
          <>
            <button
              onClick={() => setShowLiveInfo(true)}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Connect Live Logs
            </button>
            <Link
              to="/connections/new"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              + Add Connection
            </Link>
          </>
        }
      />

      {connections.loading && <Spinner />}
      {connections.error && <p className="text-sm text-red-400">{connections.error}</p>}

      {!connections.loading && !connections.error && rows.length === 0 && (
        <EmptyState
          title="No connections yet"
          description="Add a connection to start normalizing logs. Sources appear here automatically once events are processed."
        />
      )}

      {rows.length > 0 && (
        <Table>
          <THead>
            <TR>
              <TH>Connection</TH>
              <TH>Health</TH>
              <TH>Mapping</TH>
              <TH className="text-right">Events</TH>
              <TH className="text-right">Normalized</TH>
              <TH className="text-right">Needs Review</TH>
              <TH>Last Event</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link
                    to={`/connections/${encodeURIComponent(c.name)}`}
                    className="font-medium text-white hover:underline"
                  >
                    {c.name}
                  </Link>
                </TD>
                <TD>
                  <HealthBadge health={c.health} />
                </TD>
                <TD>
                  {c.mapping ? (
                    <span className="flex items-center gap-2">
                      <span className="text-slate-300">{c.mapping.name}</span>
                      <StatusBadge status={c.mapping.status} />
                    </span>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </TD>
                <TD className="text-right text-slate-300">
                  {needsAttention(c) ? c.events_processed.toLocaleString() : '—'}
                </TD>
                <TD className="text-right text-slate-300">
                  {needsAttention(c) ? formatRate(c.normalization_rate) : '—'}
                </TD>
                <TD className="text-right">
                  {c.needs_review > 0 ? (
                    <span className="font-medium text-amber-300">{c.needs_review}</span>
                  ) : (
                    <span className="text-slate-500">0</span>
                  )}
                </TD>
                <TD className="text-slate-400">{formatTime(c.last_event_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <ConnectLiveModal open={showLiveInfo} onClose={() => setShowLiveInfo(false)} />
    </div>
  )
}
