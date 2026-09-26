import { useEffect, useState, type MouseEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { deleteConnection, listConnections } from '../api/client'
import type { ConnectionSummary } from '../api/types'
import { QuickParseModal } from '../components/QuickParseModal'
import { Spinner } from '../components/Spinner'
import { EmptyState, PageHeader, useToast } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

function getInitials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

function ConnectionCard({ c, onDeleted }: { c: ConnectionSummary; onDeleted: () => void }) {
  const needsReview = c.health === 'needs_review'
  const isHealthy = c.health === 'healthy'
  const activeRate = (c.normalization_rate * 100).toFixed(1)
  const [deleting, setDeleting] = useState(false)
  const { toast } = useToast()

  async function remove(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (
      !window.confirm(
        `Remove vendor "${c.name}" and everything under it (events, mappings, recipe, drift)?`,
      )
    )
      return
    setDeleting(true)
    try {
      await deleteConnection(c.name)
      toast(`Removed vendor "${c.name}"`, 'success')
      onDeleted()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Link to={`/connections/${encodeURIComponent(c.name)}`} className="group glass-card rounded-2xl p-5 flex flex-col justify-between transition-all duration-300 ease-emphasized hover:-translate-y-0.5 hover:shadow-e4">
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary font-semibold text-body-md">
                {getInitials(c.name)}
              </div>
              <h3 className="text-title-md font-semibold tracking-tight text-on-surface group-hover:text-primary transition-colors truncate">{c.name}</h3>
            </div>
            <p className="text-body-sm font-mono text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              {c.mapping?.name ?? 'No Integration Defined'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={remove}
              disabled={deleting}
              title={`Remove vendor "${c.name}" and all its data`}
              className="control-icon h-8 w-8"
            >
              {deleting ? (
                <span className="text-label-sm">…</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0h10" />
                </svg>
              )}
            </button>
            {needsReview ? (
              <span className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-container/15 px-2 py-0.5 text-label-sm font-semibold uppercase tracking-wider text-warning">
                <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse"></span>
                Review
              </span>
            ) : isHealthy ? (
              <span className="flex items-center gap-1.5 rounded-full border border-success/30 bg-success-container/15 px-2 py-0.5 text-label-sm font-semibold uppercase tracking-wider text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success"></span>
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full border border-outline/30 bg-surface-variant px-2 py-0.5 text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant/30"></span>
                Idle
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 my-6 py-4 border-y border-outline-variant/50">
          <div>
            <p className="text-label-sm uppercase font-bold tracking-widest text-on-surface-variant mb-1">Total Throughput</p>
            <p className="font-mono text-2xl text-on-surface">{c.events_processed.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-label-sm uppercase font-bold tracking-widest text-on-surface-variant mb-1">Index Match</p>
            <p className="font-mono text-2xl text-on-surface">{activeRate}%</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-label-sm font-medium text-on-surface-variant pt-1">
        {c.needs_review > 0 ? (
          <span className="text-warning font-mono bg-warning-container/15 px-1.5 rounded border border-warning/20">{c.needs_review} Exceptions Active</span>
        ) : (
          <span>Operational</span>
        )}
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10" strokeWidth="2" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6l4 2" /></svg>
          {c.last_event_at ? new Date(c.last_event_at).toLocaleTimeString() : '--:--'}
        </span>
      </div>
    </Link>
  )
}

export default function Connections() {
  const connections = useAsync(() => listConnections(), [])
  const rows = connections.data ?? []
  const [searchParams, setSearchParams] = useSearchParams()
  const [quickParse, setQuickParse] = useState(false)

  // Deep entry: ?new=1 (keyboard N) opens the New Connection flow directly.
  useEffect(() => {
    if (searchParams.get('new') === '1') setQuickParse(true)
  }, [searchParams])

  function closeQuickParse() {
    setQuickParse(false)
    setSearchParams({}, { replace: true })
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Integration Hub"
        subtitle="Universal device configuration matrix. Manage ingestion, mappings, and outbound sinks."
        actions={
          <button
            onClick={() => setQuickParse(true)}
            className="btn-primary"
          >
            + New Connection
          </button>
        }
      />

      {quickParse && <QuickParseModal onClose={closeQuickParse} />}

      {connections.loading && <div className="mt-12 flex justify-center"><Spinner /></div>}
      {connections.error && <p className="mt-4 text-body-md font-medium text-error">{connections.error}</p>}

      {!connections.loading && !connections.error && rows.length === 0 && (
        <div className="mt-12">
          <EmptyState
            title="Ingestion Matrix Empty"
            description="Deploy a new node integration to begin normalizing and indexing telemetry data from external platforms."
            action={<Link to="/connections/new" className="text-primary hover:text-primary/70 text-body-sm font-medium underline underline-offset-4">Configure initial source node</Link>}
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-2 auto-rows-max">
          {rows.map((c) => (
            <ConnectionCard key={c.id} c={c} onDeleted={() => connections.reload()} />
          ))}
        </div>
      )}
    </div>
  )
}