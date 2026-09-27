import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  approveDrift,
  correctDrift,
  createSynthesisJob,
  getDrift,
  getSynthesisJob,
  listDrift,
  listSynthesisJobs,
  rejectDrift,
} from '../api/client'
import type { DriftDetail, SynthesisJob } from '../api/types'
import { Code } from '../components/Code'
import { SemanticFieldInput } from '../components/SemanticFieldInput'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { Arrow } from '../components/Arrow'
import { EmptyState, Modal, PageHeader } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'

const STATUS_LABELS: Record<string, string> = {
  detected: 'needs review',
  analyzed: 'proposal ready',
  review: 'needs input',
  approved: 'approved',
  rejected: 'rejected',
}

const STATUS_COLORS: Record<string, string> = {
  detected: 'border-warning/30 bg-warning-container/20 text-warning',
  analyzed: 'border-info/30 bg-info-container/20 text-info',
  review: 'border-error/30 bg-error-container/20 text-error',
  approved: 'border-success/30 bg-success-container/20 text-success',
  rejected: 'border-error/30 bg-error-container/20 text-error',
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'border-outline/30 bg-surface-variant text-on-surface-variant'
  return (
    <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-label-sm font-bold uppercase tracking-widest ${color}`}>
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
    <Modal open title="Teach Pattern — Manual Correction" onClose={onClose} width="max-w-xl">
      <p className="mb-4 text-body-sm text-on-surface-variant">
        Your correction becomes a newly published mapping version. Future telemetry from{' '}
        <span className="font-mono text-primary">{detail.source ?? 'this sequence'}</span> will automatically inherit these properties.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="mb-5 space-y-2 surface-inset rounded-xl p-2">
        {rows.map((row, i) => (
          <div key={row.input_field} className="flex items-center gap-3">
            <span className="w-1/3 truncate surface-inset rounded px-3 py-1.5 font-mono text-mono-sm text-warning border border-warning/20">
              {row.input_field}
            </span>
            <span className="text-label-sm text-on-surface-variant/70"><Arrow variant="mapping" size="sm" /></span>
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
          className="btn-secondary text-label-sm"
        >
          Abort
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="btn-primary"
        >
          {busy ? 'Applying…' : 'Apply Manual'}
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
  const [job, setJob] = useState<SynthesisJob | null>(null)

  const resolved = detail.status === 'approved' || detail.status === 'rejected'
  const jobActive = job !== null && (job.status === 'queued' || job.status === 'running')

  // Reconnect: an in-flight synthesis survives navigation because it lives
  // on the backend — reattach to this drift's active job on mount.
  useEffect(() => {
    let cancelled = false
    listSynthesisJobs()
      .then((jobs) => {
        if (cancelled) return
        const active = jobs.find(
          (j) => j.drift_id === detail.id && (j.status === 'queued' || j.status === 'running'),
        )
        if (active) setJob(active)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [detail.id])

  // Follow the attached job until it reaches a terminal state.
  useEffect(() => {
    if (!jobActive || !job) return
    const timer = setInterval(async () => {
      try {
        const next = await getSynthesisJob(job.id)
        setJob(next)
        if (next.status === 'completed') onChanged()
      } catch {
        /* keep last known state; next tick retries */
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [jobActive, job?.id, job, onChanged])

  async function run(action: 'analyze' | 'approve' | 'reject') {
    setBusy(action)
    setError(null)
    try {
      if (action === 'analyze') {
        const started = await createSynthesisJob(detail.id)
        setJob(started)
        if (started.status === 'completed') onChanged()
        return
      } else if (action === 'approve') await approveDrift(detail.id)
      else await rejectDrift(detail.id)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="glass-card rounded-xl p-5 animate-slide-up">
      <div className="mb-3 flex items-center justify-between border-b border-outline-variant/50 pb-3">
        <h3 className="text-body-md font-bold text-on-surface flex items-center gap-2">
          Delta Request
          <span className="surface-inset rounded px-1.5 py-0.5 font-mono text-label-sm text-on-surface-variant">#{detail.id}</span>
          <span className="mx-1 text-on-surface-variant/50">|</span>
          <span className="font-mono text-mono-sm text-primary">{detail.source ?? 'UNTITLED'}</span>
          {(detail.event_ids?.length ?? 0) > 1 && (
            <span className="surface-inset rounded-full border border-warning/30 bg-warning-container/15 px-2 py-0.5 font-mono text-label-sm font-bold text-warning">
              × {detail.event_ids.length} events
            </span>
          )}
        </h3>
        <StatusPill status={detail.status} />
      </div>

      <div className="mb-4 flex flex-wrap gap-4 surface-inset rounded-xl border border-outline-variant/50 p-2">
        <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
          New Fields: <span className="font-mono text-warning/80 bg-warning-container/15 px-1 rounded ml-1 lowercase">{detail.new_fields.join(', ') || '—'}</span>
        </span>
        <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
          Missing: <span className="font-mono text-error bg-error-container/15 px-1 rounded ml-1 lowercase">{detail.missing_fields.join(', ') || '—'}</span>
        </span>
      </div>

      {detail.proposal && (
        <div className="mb-4 surface-inset rounded-xl border border-info/30 bg-info-container/10 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-label-sm font-bold uppercase tracking-widest text-info">Model Inference (Pattern Proposal)</div>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-variant">
                <div
                  className={`h-full ${detail.proposal.confidence > 0.8 ? 'bg-success' : 'bg-warning'}`}
                  style={{ width: `${Math.round(detail.proposal.confidence * 100)}%` }}
                ></div>
              </div>
              <span className="font-mono text-label-sm text-on-surface-variant/70">{Math.round(detail.proposal.confidence * 100)}% Match</span>
            </div>
          </div>

          <div className="mb-3 space-y-1.5 border-l-2 border-info/50 pl-3">
            {detail.proposal.new_field_suggestions.map((s) => (
              <div key={s.input_field} className="flex items-center gap-2 text-body-sm">
                <span className="font-mono text-on-surface bg-surface-container-low px-1 rounded">{s.input_field}</span>
                <Arrow variant="binding" size="sm" />
                <span className={`font-mono font-bold ${s.semantic_field ? 'text-primary' : 'text-on-surface-variant/60'}`}>
                  {s.semantic_field || '(UNCERTAIN)'}
                </span>
                <span className="ml-auto font-mono text-label-sm text-on-surface-variant/70">conf {Math.round(s.confidence * 100)}%</span>
              </div>
            ))}
          </div>
          {detail.proposal.explanation && (
            <p className="text-body-sm leading-relaxed text-on-surface-variant/80 italic">" {detail.proposal.explanation} "</p>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {jobActive && job && (
        <div className="mb-4 surface-inset rounded-xl border border-primary/30 bg-primary-container/10 p-3">
          <div className="flex items-center justify-between gap-3 text-label-sm font-bold uppercase tracking-widest text-primary">
            <span>Synthesis {job.status} · job #{job.id}</span>
            <span className="font-mono normal-case tracking-normal text-on-surface-variant/70">
              {job.stage ?? 'working…'}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-variant">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(4, Math.min(100, job.progress))}%` }}
            />
          </div>
          <p className="mt-1.5 text-body-sm text-on-surface-variant/70">
            Running in the background — safe to navigate away; this card reconnects when you return.
          </p>
        </div>
      )}

      {job?.status === 'failed' && (
        <div className="mb-4 surface-inset rounded-xl border border-error/30 bg-error-container/10 p-3 text-body-sm">
          <span className="font-bold uppercase tracking-widest text-error text-label-sm">Synthesis failed</span>
          <p className="mt-1 text-on-surface-variant">{job.error ?? 'Unknown error.'}</p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-outline-variant/50">
        <button
          onClick={() => run('analyze')}
          disabled={busy !== null || resolved || jobActive}
          className="btn-outlined text-label-sm"
        >
          {busy === 'analyze' ? 'Starting…' : jobActive ? 'Synthesizing…' : job?.status === 'failed' ? 'Retry AI synthesis' : 'AI Synthesizer'}
        </button>
        <button
          onClick={() => run('approve')}
          disabled={busy !== null || resolved}
          className="btn-primary text-label-sm"
        >
          {busy === 'approve' ? 'Authorizing…' : 'Authorize AI'}
        </button>
        <button
          onClick={() => setCorrecting(true)}
          disabled={busy !== null || resolved}
          className="btn-secondary text-label-sm"
        >
          Manual
        </button>
        <div className="flex-1"></div>
        <button
          onClick={() => run('reject')}
          disabled={busy !== null || resolved}
          title="Disagree with the proposal and close it terminally. No mapping change; events stay quarantined."
          className="btn-text text-error text-label-sm"
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
          <summary className="cursor-pointer select-none text-label-sm font-bold uppercase tracking-widest text-on-surface-variant/70 transition-colors group-open:text-on-surface-variant">
            <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Sample Evidence Payload
          </summary>
          <div className="mt-2 border-l border-outline-variant pl-3 opacity-80">
            <Code value={detail.sample} truncate maxLines={15} />
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

  const reloadAll = useCallback(() => {
    drifts.reload()
  }, [drifts])

  useLive({ source: sourceFilter || undefined, onEvent: () => reloadAll() })

  useEffect(() => {
    const timer = setInterval(() => reloadAll(), 15000)
    return () => clearInterval(timer)
  }, [sourceFilter, reloadAll])

  const [view, setView] = useState<'open' | 'resolved'>('open')
  const [resolvedVendor, setResolvedVendor] = useState<string | null>(null)

  const all = (drifts.data ?? []).filter(
    (d) => !sourceFilter || d.source === sourceFilter,
  )
  const open = all.filter((d) => d.status === 'detected' || d.status === 'analyzed' || d.status === 'review')
  const resolved = all.filter((d) => d.status === 'approved' || d.status === 'rejected')

  const openGroups = useMemo(() => {
    const bySource = new Map<string, typeof open>()
    for (const d of open) {
      const key = d.source ?? 'Unassigned origin'
      const g = bySource.get(key)
      if (g) g.push(d)
      else bySource.set(key, [d])
    }
    return [...bySource.entries()]
  }, [open])

  const resolvedVendors = useMemo(() => {
    const bySource = new Map<string, { total: number; approved: number; rejected: number }>()
    for (const d of resolved) {
      const key = d.source ?? 'Unassigned origin'
      const g = bySource.get(key) ?? { total: 0, approved: 0, rejected: 0 }
      g.total += 1
      if (d.status === 'approved') g.approved += 1
      else g.rejected += 1
      bySource.set(key, g)
    }
    return [...bySource.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [resolved])

  const resolvedShown = resolvedVendor ? resolved.filter((d) => (d.source ?? 'Unassigned origin') === resolvedVendor) : []

  const shown = view === 'open' ? open : resolved

  return (
    <div className="h-full flex flex-col">
      {!sourceFilter && (
        <PageHeader
          title="Review Queue"
          subtitle="One decision per new shape: approve the AI names, correct them, or reject as noise."
        />
      )}

      <div className="mb-5 flex items-center gap-1.5">
        {(['open', 'resolved'] as const).map((v) => {
          const n = v === 'open' ? open.length : resolved.length
          return (
            <button
              key={v}
              onClick={() => {
                setView(v)
                setResolvedVendor(null)
              }}
              className={`rounded px-3 py-1.5 text-body-sm font-medium capitalize transition-all ${
                view === v
                  ? 'border border-primary/30 bg-primary-container/10 text-primary shadow-[0_0_10px_var(--color-primary)]'
                  : 'border border-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
              }`}
            >
              {v} ({n})
            </button>
          )
        })}
      </div>

      {drifts.loading && <div className="mt-10 flex justify-center"><Spinner /></div>}
      {drifts.error && <p className="text-body-md font-medium text-error">{drifts.error}</p>}

      {!drifts.loading && !drifts.error && shown.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title={view === 'open' ? (sourceFilter ? 'System Nominal' : 'Nothing awaiting review') : 'No resolved items'}
            description={
              view === 'open'
                ? 'Active parser maps match all incoming telemetry structures. Quarantined payloads live under Logs → Telemetry Inspection.'
                : 'Approved and rejected proposals will appear here.'
            }
          />
        </div>
      )}

      {view === 'open' ? (
        <div className="space-y-8">
          {openGroups.map(([source, items]) => (
            <section key={source}>
              <h3 className="mb-3 flex items-center gap-2 text-label-sm font-bold uppercase tracking-[0.14em] text-on-surface-variant">
                <span className="font-mono text-primary">{source}</span>
                <span className="surface-inset rounded-full border border-warning/30 bg-warning-container/15 px-2 py-0.5 font-mono text-label-sm text-warning">
                  {items.length} open
                </span>
              </h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {items.map((d) => (
                  <ReviewCard key={d.id} detail={d} onChanged={() => reloadAll()} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : resolvedVendor === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {resolvedVendors.map(([source, counts]) => (
            <button
              key={source}
              onClick={() => setResolvedVendor(source)}
              className="glass-card group flex items-center justify-between rounded-xl p-5 text-left transition-all hover:border-primary/30 hover:shadow-e2"
            >
              <div>
                <p className="font-mono text-body-lg font-semibold text-on-surface group-hover:text-primary">{source}</p>
                <p className="mt-1 flex gap-2 font-mono text-label-sm">
                  <span className="text-success">{counts.approved} approved</span>
                  <span className="text-error">{counts.rejected} rejected</span>
                </p>
              </div>
              <span className="flex items-center gap-2">
                <span className="surface-inset rounded-full border border-outline-variant/50 px-2.5 py-0.5 font-mono text-label-sm text-on-surface-variant">
                  {counts.total}
                </span>
                <Arrow variant="inline" size="sm" />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => setResolvedVendor(null)}
              className="btn-secondary text-label-sm"
            >
              Vendors
            </button>
            <h3 className="font-mono text-body-lg font-semibold text-on-surface">{resolvedVendor}</h3>
            <span className="surface-inset rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-label-sm text-on-surface-variant">
              {resolvedShown.length} resolved
            </span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {resolvedShown.map((d) => (
              <ReviewCard key={d.id} detail={d} onChanged={() => reloadAll()} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}