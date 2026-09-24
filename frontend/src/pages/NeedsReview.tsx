import { useEffect, useState } from 'react'
import {
  analyzeDrift,
  approveDrift,
  correctDrift,
  deleteEvent,
  getDrift,
  ignoreDrift,
  listDrift,
  listEvents,
  onboardEvent,
  rejectDrift,
  retryEvent,
} from '../api/client'
import type { DriftDetail, EventSummary } from '../api/types'
import { Code } from '../components/Code'
import { SemanticFieldInput } from '../components/SemanticFieldInput'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { EmptyState, Modal, PageHeader, useToast } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'

const STATUS_LABELS: Record<string, string> = {
  detected: 'needs review',
  analyzed: 'proposal ready',
  review: 'needs input',
  approved: 'approved',
  rejected: 'rejected',
  ignored: 'ignored',
}

const STATUS_COLORS: Record<string, string> = {
  detected: 'bg-amber-950/30 text-amber-400 border-amber-900/50',
  analyzed: 'bg-cyan-950/30 text-cyan-400 border-cyan-900/50',
  review: 'bg-rose-950/30 text-rose-400 border-rose-900/50',
  approved: 'bg-emerald-950/30 text-emerald-400 border-emerald-900/50',
  rejected: 'bg-rose-950/30 text-rose-500 border-rose-900/40',
  ignored: 'bg-slate-800/40 text-slate-400 border-slate-700/50',
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-slate-800/40 text-slate-400 border-slate-700/50'
  return (
    <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${color}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function CorrectModal({
  detail,
  onClose,
  onCorrected,
}: {
  detail: DriftDetail
  onClose: () => void
  onCorrected: () => void
}) {
  const [rows, setRows] = useState<{ input_field: string; semantic_field: string }[]>(() => {
    if (detail.proposal && detail.proposal.new_field_suggestions.length > 0) {
      return detail.proposal.new_field_suggestions.map((s) => ({
        input_field: s.input_field,
        semantic_field: s.semantic_field,
      }))
    }
    return detail.new_fields.map((f) => ({ input_field: f, semantic_field: '' }))
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateRow(index: number, semantic_field: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, semantic_field } : r)))
  }

  async function submit() {
    if (rows.every((r) => !r.semantic_field.trim())) {
      setError('Assign at least one semantic field')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await correctDrift(detail.id, rows)
      onCorrected()
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Teach Pattern — Override Interpretation" onClose={onClose}>
      <p className="mb-4 text-[12px] text-slate-400">
        Your correction becomes a newly published mapping version. Future telemetry from{' '}
        <span className="font-mono text-cyan-400">{detail.source ?? 'this sequence'}</span> will automatically inherit these properties.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="mb-5 space-y-2 rounded border border-slate-800 bg-slate-900/50 p-2">
        {rows.map((row, i) => (
          <div key={row.input_field} className="flex items-center gap-3">
            <span className="w-1/3 truncate rounded bg-slate-950 px-3 py-1.5 font-mono text-[11px] text-amber-500/80 border border-amber-900/20">
              {row.input_field}
            </span>
            <span className="text-[10px] text-slate-500">→</span>
            <SemanticFieldInput
              value={row.semantic_field}
              onChange={(v) => updateRow(i, v)}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded border border-slate-700 px-5 py-1.5 text-[12px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
        >
          Abort
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="rounded bg-cyan-600 px-5 py-1.5 text-[12px] font-bold uppercase tracking-wider text-white shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all hover:bg-cyan-500 hover:shadow-[0_0_15px_rgba(6,182,212,0.5)] disabled:opacity-50 disabled:shadow-none"
        >
          {busy ? 'Applying…' : 'Apply Override'}
        </button>
      </div>
    </Modal>
  )
}

function ReviewCard({
  detail,
  onChanged,
}: {
  detail: DriftDetail
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState(false)

  const resolved = detail.status === 'approved' || detail.status === 'rejected' || detail.status === 'ignored'

  async function run(action: 'analyze' | 'approve' | 'reject' | 'ignore') {
    setBusy(action)
    setError(null)
    try {
      if (action === 'analyze') await analyzeDrift(detail.id)
      else if (action === 'approve') await approveDrift(detail.id)
      else if (action === 'ignore') await ignoreDrift(detail.id)
      else await rejectDrift(detail.id)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="animate-slide-up rounded-lg border border-slate-700/50 glass-card p-5">
      <div className="mb-3 flex items-center justify-between border-b border-slate-800/80 pb-3">
        <h3 className="text-[13px] font-bold text-white flex items-center gap-2">
          Delta Request
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">#{detail.id}</span>
          <span className="mx-1 text-slate-600">|</span>
          <span className="font-mono text-[11px] text-cyan-500">{detail.source ?? 'UNTITLED'}</span>
        </h3>
        <StatusPill status={detail.status} />
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-[11px] uppercase tracking-wider font-semibold rounded bg-slate-900 border border-slate-800 p-2">
        <span className="text-slate-500">
          New Fields: <span className="font-mono text-amber-500/80 bg-amber-500/10 px-1 rounded ml-1 lowercase">{detail.new_fields.join(', ') || '—'}</span>
        </span>
        <span className="text-slate-500">
          Missing: <span className="font-mono text-rose-400 bg-rose-500/10 px-1 rounded ml-1 lowercase">{detail.missing_fields.join(', ') || '—'}</span>
        </span>
      </div>

      {detail.proposal && (
        <div className="mb-4 rounded border border-cyan-900/30 bg-cyan-950/10 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-600">Model Inference (Pattern Proposal)</div>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${detail.proposal.confidence > 0.8 ? 'bg-cyan-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.round(detail.proposal.confidence * 100)}%` }}
                ></div>
              </div>
              <span className="font-mono text-[10px] text-slate-400">{Math.round(detail.proposal.confidence * 100)}% Match</span>
            </div>
          </div>

          <div className="mb-3 space-y-1.5 border-l-2 border-cyan-800/50 pl-3">
            {detail.proposal.new_field_suggestions.map((s) => (
              <div key={s.input_field} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-slate-300 bg-slate-900 px-1 rounded">{s.input_field}</span>
                <span className="text-cyan-800">→</span>
                <span className={`font-mono font-bold ${s.semantic_field ? 'text-cyan-400' : 'text-slate-500'}`}>
                  {s.semantic_field || '(UNCERTAIN)'}
                </span>
                <span className="ml-auto font-mono text-[10px] text-slate-600">conf {Math.round(s.confidence * 100)}%</span>
              </div>
            ))}
          </div>
          {detail.proposal.explanation && (
            <p className="text-[11px] leading-relaxed text-slate-400 italic">" {detail.proposal.explanation} "</p>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-slate-800/50">
        <button
          onClick={() => run('analyze')}
          disabled={busy !== null || resolved}
          className="rounded border border-cyan-900 bg-cyan-950/30 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan-400 transition-colors hover:bg-cyan-900/50 disabled:opacity-40"
        >
          {busy === 'analyze' ? 'Computing…' : 'Synthesize AI'}
        </button>
        <button
          onClick={() => run('approve')}
          disabled={busy !== null || resolved}
          className="rounded bg-cyan-600 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-[0_0_10px_rgba(6,182,212,0.2)] transition-colors hover:bg-cyan-500 disabled:opacity-40"
        >
          {busy === 'approve' ? 'Authorizing…' : 'Authorize AI'}
        </button>
        <button
          onClick={() => setCorrecting(true)}
          disabled={busy !== null || resolved}
          className="rounded border border-slate-700 bg-slate-800 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-40"
        >
          Override
        </button>
        <div className="flex-1"></div>
        <button
          onClick={() => run('ignore')}
          disabled={busy !== null || resolved}
          className="rounded border border-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-40"
        >
          {busy === 'ignore' ? '…' : 'Ignore'}
        </button>
        <button
          onClick={() => run('reject')}
          disabled={busy !== null || resolved}
          className="rounded border border-rose-900/40 text-rose-400 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors hover:bg-rose-900/50 disabled:opacity-40"
        >
          {busy === 'reject' ? '…' : 'Reject'}
        </button>
      </div>

      {correcting && (
        <CorrectModal
          detail={detail}
          onClose={() => setCorrecting(false)}
          onCorrected={onChanged}
        />
      )}

      {detail.sample && (
        <details className="mt-4 group">
          <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors group-open:text-slate-400">
            <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Sample Evidence Payload
          </summary>
          <div className="mt-2 border-l border-slate-800 pl-3 opacity-80">
            <Code value={detail.sample} />
          </div>
        </details>
      )}
    </div>
  )
}

export default function NeedsReview({ sourceFilter }: { sourceFilter?: string }) {
  const drifts = useAsync(async () => {
    const list = await listDrift()
    return Promise.all(list.map((d) => getDrift(d.id)))
  }, [])
  const quarantined = useAsync(
    () =>
      listEvents({
        status: 'quarantined',
        limit: 100,
        ...(sourceFilter ? { source: sourceFilter } : {}),
      }),
    [sourceFilter],
  )

  function reloadAll() {
    drifts.reload()
    quarantined.reload()
  }

  // Stay fresh: drift approvals elsewhere (or reprocessing) change both
  // lists. Live events trigger a reload; polling covers missed frames.
  useLive({ source: sourceFilter || undefined, onEvent: () => reloadAll() })

  useEffect(() => {
    const timer = setInterval(() => reloadAll(), 15000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter])

  const rows = (drifts.data ?? []).filter(
    (d) => !sourceFilter || d.source === sourceFilter,
  )
  const stuck = quarantined.data ?? []
  const { toast } = useToast()

  async function actOnEvent(id: number, action: 'onboard' | 'retry' | 'delete') {
    try {
      if (action === 'retry') {
        const updated = await retryEvent(id)
        toast(`Re-executing sequence — now ${updated.status}`, 'success')
      } else if (action === 'delete') {
        if (!window.confirm(`Delete event #${id}?`)) return
        await deleteEvent(id)
        toast(`Purged event #${id}`, 'success')
      } else {
        const res = await onboardEvent(id, {
          connectionName: sourceFilter,
          fields: [],
        })
        toast(`Mapping compiled (v${res.mapping_version}) — event ${res.event_status}`, 'success')
      }
      quarantined.reload()
      drifts.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

  return (
    <div className="h-full flex flex-col">
      {!sourceFilter && (
        <PageHeader
          title="Review Queue"
          subtitle="AI intercepts unmapped telemetry. Provide structural context to refine the parser engine."
        />
      )}

      {drifts.loading && <div className="mt-10 flex justify-center"><Spinner /></div>}
      {drifts.error && <p className="text-[13px] font-medium text-rose-400">{drifts.error}</p>}

      {!drifts.loading && !drifts.error && rows.length === 0 && stuck.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title={sourceFilter ? 'System Nominal' : 'No Anomalies Detected'}
            description="Active parser maps match all incoming telemetry structures."
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((d) => (
          <ReviewCard key={d.id} detail={d} onChanged={() => reloadAll()} />
        ))}
      </div>

      {stuck.length > 0 && (
        <section className={`${rows.length > 0 ? 'mt-10 border-t border-slate-800/50 pt-8' : 'mt-4'}`}>
          <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wider text-white">
            Unmapped Telemetry (Quarantine){sourceFilter ? ` // ${sourceFilter}` : ''}
          </h3>
          <p className="mb-4 text-[12px] text-slate-400 max-w-2xl leading-relaxed">
            These payloads did not match any active AST schemas. They require an initial baseline mapping to proceed.
          </p>
          <div className="data-scroll-region space-y-2">
            {stuck.map((e: EventSummary) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700/50 bg-slate-900/50 p-3 transition-colors hover:bg-slate-800/60 glass-panel animate-slide-up"
              >
                <div className="flex items-center gap-3">
                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500 shadow-[0_0_5px_rgba(245,158,11,0.5)]"></div>
                  <span className="font-mono text-[12px] text-slate-300">
                    <span className="text-slate-500">ID:</span> {(e.id).toString().padStart(5, '0')}
                    <span className="mx-2 text-slate-700">|</span>
                    <span className="text-cyan-600/70">{e.event_id.slice(0, 8)}…</span>
                    <span className="mx-2 text-slate-700">|</span>
                    <span className="text-amber-500/80">{e.source ?? 'UNKNOWN ORIGIN'}</span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => actOnEvent(e.id, 'onboard')}
                    className="rounded bg-cyan-600 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-[0_0_10px_rgba(6,182,212,0.2)] transition-colors hover:bg-cyan-500"
                  >
                    Establish Mapping
                  </button>
                  <button
                    onClick={() => actOnEvent(e.id, 'retry')}
                    className="rounded border border-slate-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    Re-Execute
                  </button>
                  <button
                    onClick={() => actOnEvent(e.id, 'delete')}
                    className="rounded border border-rose-900/40 text-rose-400 px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors hover:bg-rose-900/50"
                  >
                    Purge
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
