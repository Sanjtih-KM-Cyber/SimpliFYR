import { useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { deleteConnection, getConfig, listConnections } from '../api/client'
import type { ConnectionSummary } from '../api/types'
import { Spinner } from '../components/Spinner'
import { QuickParseModal } from '../components/QuickParseModal'
import { EmptyState, Modal, PageHeader, useToast } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

function ConnectLiveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useAsync(() => getConfig(), [])
  const c = config.data
  const origin = window.location.origin

  return (
    <Modal open={open} title="Live Log Ingestion" onClose={onClose} width="max-w-2xl">
      <p className="mb-5 text-[13px] leading-relaxed text-slate-400">
        Direct live device logs to the framework exactly once. The ingestion pipeline matches events to configured sources autonomously using vector fingerprinting.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-[12px] font-bold uppercase tracking-wider text-slate-300">Syslog (UDP)</h4>
            <span className={`h-2 w-2 rounded-full ${c?.syslog_enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`}></span>
          </div>
          {c?.syslog_enabled ? (
            <>
              <p className="text-[12px] text-slate-400 mb-2">Endpoint address:</p>
              <div className="flex items-center gap-2 rounded bg-slate-950 p-2 border border-slate-800 font-mono text-[13px] text-emerald-400 select-all">
                {c.syslog_udp_host}:{c.syslog_udp_port}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-slate-500 italic">Syslog daemon disabled in Configuration spec.</p>
          )}
        </section>

        <section className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
          <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-slate-300">HTTP REST</h4>
          <p className="text-[12px] text-slate-400 mb-2">POST payload to:</p>
          <div className="flex items-center gap-2 rounded bg-slate-950 p-2 border border-slate-800 font-mono text-[13px] text-cyan-400 select-all truncate">
            {origin}/api/v1/ingest
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            Requires <code className="bg-slate-900 px-1 rounded">raw</code> and <code className="bg-slate-900 px-1 rounded">source</code> form payload.
          </p>
        </section>
      </div>

      <div className="mt-6 flex justify-end pt-4 border-t border-slate-800">
        <button onClick={onClose} className="text-[13px] font-medium text-slate-400 hover:text-white transition-colors">Close panel</button>
      </div>
    </Modal>
  )
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
    <Link to={`/connections/${encodeURIComponent(c.name)}`} className="group flex flex-col justify-between glass-card rounded-lg p-5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.5)] transition-all">
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight text-white group-hover:text-cyan-400 transition-colors truncate">{c.name}</h3>
            <p className="text-[11px] font-mono text-slate-500 mt-1 uppercase tracking-wider flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              {c.mapping?.name ?? 'No Integration Defined'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={remove}
              disabled={deleting}
              title={`Remove vendor "${c.name}" and all its data`}
              className="rounded p-1 text-slate-600 opacity-0 transition-all hover:bg-rose-950/30 hover:text-rose-400 disabled:opacity-50 group-hover:opacity-100"
            >
              {deleting ? (
                <span className="text-[12px]">…</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0h10" />
                </svg>
              )}
            </button>
            {needsReview ? (
              <span className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                Review
              </span>
            ) : isHealthy ? (
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5 rounded-full border border-slate-600/50 bg-slate-800/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500"></span>
                Idle
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 my-6 py-4 border-y border-slate-700/30">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">Total Throughput</p>
            <p className="font-mono text-xl text-slate-200">{c.events_processed.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mb-1">Index Match</p>
            <p className="font-mono text-xl text-slate-200">{activeRate}%</p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 pt-1">
        {c.needs_review > 0 ? (
          <span className="text-amber-400 font-mono bg-amber-500/10 px-1.5 rounded border border-amber-500/20">{c.needs_review} Exceptions Active</span>
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
  const [showLiveInfo, setShowLiveInfo] = useState(false)
  const [quickParse, setQuickParse] = useState(false)

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Integration Hub"
        subtitle="Universal device configuration matrix. Manage ingestion, mappings, and outbound sinks."
        actions={
          <>
            <button
              onClick={() => setShowLiveInfo(true)}
              className="rounded bg-slate-800 border border-slate-700 px-4 py-2 text-[13px] font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
            >
              Connect Server
            </button>
            <button
              onClick={() => setQuickParse(true)}
              className="rounded bg-cyan-600 px-4 py-2 text-[13px] font-medium text-white shadow-[0_0_10px_rgba(6,182,212,0.3)] hover:bg-cyan-500 hover:shadow-[0_0_15px_rgba(6,182,212,0.5)] transition-all"
            >
              + Quick Parse
            </button>
          </>
        }
      />

      {quickParse && <QuickParseModal onClose={() => setQuickParse(false)} />}

      {connections.loading && <div className="mt-12 flex justify-center"><Spinner /></div>}
      {connections.error && <p className="mt-4 text-[13px] font-medium text-rose-400">{connections.error}</p>}

      {!connections.loading && !connections.error && rows.length === 0 && (
        <div className="mt-12">
          <EmptyState
            title="Ingestion Matrix Empty"
            description="Deploy a new node integration to begin normalizing and indexing telemetry data from external platforms."
            action={<Link to="/connections/new" className="text-cyan-400 hover:text-cyan-300 text-[13px] font-medium underline underline-offset-4">Configure initial source node</Link>}
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

      <ConnectLiveModal open={showLiveInfo} onClose={() => setShowLiveInfo(false)} />
    </div>
  )
}
