import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  approveDrift,
  batchDeleteEvents,
  createSynthesisJob,
  getSynthesisJob,
  listSynthesisJobs,
  correctDrift,
  getDrift,
  rejectDrift,
  batchRetryEvents,
  deleteEvent,
  exportLogs,
  getBatchGroups,
  getEvent,
  listBatches,
  listConnections,
  listDrift,
  listEventGroups,
  listEvents,
  listMappings,
  listOutputProfiles,
  retryEvent,
  searchEventsRaw,
} from '../api/client'
import type { BatchGroup, BatchRun, DriftDetail, DriftSummary, EventDetail, EventGroup, EventStatus, EventSummary, SynthesisJob } from '../api/types'
import { Arrow } from '../components/Arrow'
import { Code } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { OnboardModal } from '../components/OnboardModal'
import { EmptyState, Modal, PageHeader, TBody, TD, TH, THead, TR, Table, useToast } from '../components/ui'
import { FOCUS_SEARCH_EVENT } from '../hooks/useKeyboardShortcuts'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'
import { Dropdown } from '../components/Dropdown'
import { SemanticFieldInput } from '../components/SemanticFieldInput'

type LogTab = 'normalized' | 'index-detail' | 'inspection' | 'failed'

const TABS: { key: LogTab; label: string }[] = [
  { key: 'normalized', label: 'Normalized' },
  { key: 'index-detail', label: 'Index Detail' },
  { key: 'inspection', label: 'Review' },
  { key: 'failed', label: 'Failed' },
]

const TAB_STATUSES: Record<LogTab, EventStatus[]> = {
  normalized: ['normalized', 'output'],
  'index-detail': [],
  inspection: ['quarantined'],
  failed: ['dlq'],
}

function matchesTab(status: EventStatus, tab: LogTab): boolean {
  return TAB_STATUSES[tab].includes(status)
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function padId(id: number): string {
  return id.toString().padStart(6, '0')
}

function pageWindow(current: number, total: number): number[] {
  if (total <= 10) return Array.from({ length: total }, (_, i) => i + 1)
  const start = Math.min(Math.max(1, current - 4), total - 9)
  return Array.from({ length: 10 }, (_, i) => start + i)
}

function matchesId(e: EventSummary, q: string): boolean {
  if (!/^\d+$/.test(q)) return false
  const stripped = q.replace(/^0+/, '')
  if (stripped === '') return padId(e.id).includes(q)
  return String(e.id).includes(stripped) || padId(e.id).includes(q)
}

function formatLabel(fmt: string | null): string {
  return fmt ?? 'unknown'
}

function Detail({
  detail,
  siblingCount,
  onChanged,
  onDeleted,
}: {
  detail: EventDetail
  siblingCount: number
  onChanged: () => void
  onDeleted: () => void
}) {
  const [onboarding, setOnboarding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const actionable = detail.status === 'quarantined' || detail.status === 'dlq'

  async function run(action: 'retry' | 'delete') {
    if (action === 'delete' && !window.confirm(`Delete event #${detail.id} and its raw file?`)) return
    setBusy(action)
    setError(null)
    try {
      if (action === 'retry') {
        const updated = await retryEvent(detail.id)
        toast(`Reprocessed — now ${updated.status}`, 'success')
      } else {
        await deleteEvent(detail.id)
        toast(`Deleted event #${detail.id}`, 'success')
        onDeleted()
      }
      onChanged()
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-4 animate-slide-up glass-card rounded-xl p-5">
      <div className="mb-4 flex items-center justify-between border-b border-outline-variant/50 pb-3">
        <h4 className="flex items-center gap-2 text-label-lg font-bold text-on-surface">
          Index Detail
          <span className="surface-inset rounded px-1.5 py-0.5 font-mono text-label-sm text-primary">{detail.event_id}</span>
        </h4>
        <StatusBadge status={detail.status} />
      </div>

      {actionable && (
        <div className="mb-4 flex flex-wrap gap-2 border-b border-warning/30 pb-4 pt-1">
          <div className="mb-1 w-full font-mono text-label-sm uppercase tracking-widest text-warning/80">Action Required</div>
          {detail.status === 'quarantined' && (
            <button
              onClick={() => setOnboarding(true)}
              className="btn-primary text-label-sm"
            >
              Establish Mapping (Onboard)
            </button>
          )}
          <button
            onClick={() => run('retry')}
            disabled={busy !== null}
            className="btn-secondary text-label-sm"
          >
            {busy === 'retry' ? 'Re-executing…' : 'Re-execute'}
          </button>
          <button
            onClick={() => run('delete')}
            disabled={busy !== null}
            className="btn-text text-error text-label-sm"
          >
            {busy === 'delete' ? 'Purging…' : 'Purge'}
          </button>
        </div>
      )}
      {error && <p className="mb-3 text-body-sm text-error">{error}</p>}

      <div className="grid gap-1 overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-dim lg:grid-cols-2">
        <details open className="surface-inset p-3">
          <summary className="mb-3 flex cursor-pointer select-none items-center gap-2 border-b border-outline-variant/50 pb-1">
            <div className="h-1.5 w-1.5 rounded-full bg-on-surface-variant/30"></div>
            <h4 className="text-label-sm font-bold uppercase tracking-widest text-on-surface-variant">
              Original Telemetry · {siblingCount} ingested
            </h4>
          </summary>
          <div className="opacity-90">
            <Code value={detail.views.raw} truncate maxLines={15} />
          </div>
        </details>
        <section className="surface-inset p-3 lg:border-l lg:border-outline-variant/50">
          <div className="max-w-max relative mb-3 flex items-center gap-2 border-b border-primary/30 pb-1">
            <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_5px_var(--color-primary)]"></div>
            <h4 className="relative text-label-sm font-bold uppercase tracking-widest text-primary">Normalized Context</h4>
          </div>
          {detail.views.normalized ? (
            <Code value={detail.views.normalized} />
          ) : (
            <div className="relative flex min-h-[100px] h-full items-center justify-center overflow-hidden rounded-xl border border-warning/30 bg-warning-container/10 p-4">
              <div className="absolute left-0 top-0 h-[1px] w-full bg-warning/20"></div>
              <p className="text-center font-mono text-label-sm uppercase tracking-widest text-warning/80">
                Unstructured Data
                <br />
                <span className="text-mono-xs text-warning/60">Awaiting schema resolution</span>
              </p>
            </div>
          )}
        </section>
      </div>

      {(detail.views.parsed || detail.views.output || detail.provenance) && (
        <div className="mt-4">
          <details className="group">
            <summary className="cursor-pointer select-none text-body-sm font-semibold text-on-surface-variant transition-colors group-open:text-on-surface">
              <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Details
            </summary>
            <div className="mt-2 space-y-3 border-l border-outline-variant pl-4">
              {detail.views.parsed && (
                <div>
                  <p className="mb-1 text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant/70">Parsed</p>
                  <Code value={detail.views.parsed} truncate maxLines={8} />
                </div>
              )}
              {detail.views.output && (
                <div>
                  <p className="mb-1 text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant/70">Delivery payload</p>
                  <Code value={detail.views.output} truncate maxLines={8} />
                </div>
              )}
              {detail.provenance && (
                <div>
                  <p className="mb-1 text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant/70">Provenance</p>
                  <Code value={detail.provenance} truncate maxLines={8} />
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {onboarding && (
        <OnboardModal
          event={detail}
          onClose={() => setOnboarding(false)}
          onDone={onChanged}
        />
      )}
    </div>
  )
}

interface QuarantineGroup {
  key: string
  format: string
  source: string | null
  ids: number[]
  repId: number
  count: number
  truncated: boolean
  fields: string[]
}

function CorrectModal({
  drift,
  onClose,
  onDone,
}: {
  drift: DriftDetail
  onClose: () => void
  onDone: () => void
}) {
  const [rows, setRows] = useState(() => {
    if (drift.proposal && drift.proposal.new_field_suggestions.length > 0) {
      return drift.proposal.new_field_suggestions.map((s) => ({
        input_field: s.input_field,
        semantic_field: s.semantic_field,
      }))
    }
    return drift.new_fields.map((f) => ({ input_field: f, semantic_field: '' }))
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  async function submit() {
    if (rows.every((r) => !r.semantic_field.trim())) {
      setError('Assign at least one semantic field')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await correctDrift(
        drift.id,
        rows.filter((r) => r.semantic_field.trim()),
      )
      toast(`Corrected \u2014 mapping v${res.new_mapping_version}, ${res.reprocessed_events} logs reprocessed`, 'success')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Teach Pattern \u2014 Manual Correction" onClose={onClose} width="max-w-xl">
      <p className="mb-4 text-body-sm text-on-surface-variant">
        Your correction becomes a newly published mapping version for{' '}
        <span className="font-mono text-primary">{drift.source ?? 'this origin'}</span>.
      </p>
      {error && <p className="mb-3 text-body-sm font-medium text-error">{error}</p>}
      <div className="mb-5 space-y-2 surface-inset rounded-xl p-2">
        {rows.map((row, i) => (
          <div key={row.input_field} className="flex items-center gap-3">
            <span className="w-1/3 truncate surface-inset rounded px-3 py-1.5 font-mono text-mono-sm text-warning border border-warning/20">
              {row.input_field}
            </span>
            <SemanticFieldInput
              value={row.semantic_field}
              onChange={(v) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, semantic_field: v } : r)))}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onClose} disabled={busy} className="btn-secondary text-label-sm">
          Abort
        </button>
        <button onClick={submit} disabled={busy} className="btn-primary">
          {busy ? 'Applying\u2026' : 'Apply Manual'}
        </button>
      </div>
    </Modal>
  )
}

function InspectionCard({
  group,
  rep,
  issue,
  hasMapping,
  busy,
  drift,
  onApprove,
  onReview,
  onCorrect,
  onReject,
  onPurge,
  onDriftChanged,
}: {
  group: QuarantineGroup
  rep: EventDetail | null
  issue: string
  hasMapping: boolean
  busy: boolean
  drift: DriftDetail | null
  onApprove: () => void
  onReview: () => void
  onCorrect: () => void
  onReject: () => void
  onPurge: () => void
  onDriftChanged: () => void
}) {
  const [job, setJob] = useState<SynthesisJob | null>(null)
  const [synthError, setSynthError] = useState<string | null>(null)
  const jobActive = job !== null && (job.status === 'queued' || job.status === 'running')

  useEffect(() => {
    if (!drift) return
    let cancelled = false
    listSynthesisJobs()
      .then((jobs) => {
        if (cancelled) return
        const active = jobs.find(
          (j) => j.drift_id === drift.id && (j.status === 'queued' || j.status === 'running'),
        )
        if (active) setJob(active)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [drift])

  useEffect(() => {
    if (!jobActive || !job) return
    const timer = setInterval(async () => {
      try {
        const next = await getSynthesisJob(job.id)
        setJob(next)
        if (next.status === 'completed') onDriftChanged()
      } catch {
        /* keep last known state; next tick retries */
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [jobActive, job, onDriftChanged])

  async function startSynthesis() {
    if (!drift) return
    setSynthError(null)
    try {
      const started = await createSynthesisJob(drift.id)
      setJob(started)
      if (started.status === 'completed') onDriftChanged()
    } catch (e) {
      setSynthError((e as Error).message)
    }
  }

  const pill = drift ? (
    <span
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-label-sm font-bold uppercase tracking-widest ${drift.status === 'analyzed'
        ? 'border-info/30 bg-info-container/20 text-info'
        : drift.status === 'review'
          ? 'border-error/30 bg-error-container/20 text-error'
          : 'border-warning/30 bg-warning-container/20 text-warning'
        }`}
    >
      {drift.status === 'analyzed' ? 'proposal ready' : drift.status === 'review' ? 'needs input' : 'needs review'}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-sm border border-outline/30 bg-surface-variant px-2 py-0.5 text-label-sm font-bold uppercase tracking-widest text-on-surface-variant">
      held
    </span>
  )

  return (
    <div className="glass-card rounded-xl p-5 animate-slide-up">
      <div className="mb-3 flex items-center justify-between border-b border-outline-variant/50 pb-3">
        <h3 className="text-body-md font-bold text-on-surface flex items-center gap-2">
          {drift ? 'Delta Request' : 'Held Logs'}
          <span className="surface-inset rounded px-1.5 py-0.5 font-mono text-label-sm text-on-surface-variant">#{drift ? drift.id : group.repId}</span>
          <span className="mx-1 text-on-surface-variant/50">|</span>
          <span className="font-mono text-mono-sm text-primary">{group.source ?? 'UNTITLED'}</span>
          <span className="surface-inset rounded-full border border-warning/30 bg-warning-container/15 px-2 py-0.5 font-mono text-label-sm font-bold text-warning">
            \u00d7 {group.count} events
          </span>
        </h3>
        {pill}
      </div>

      {drift && (
        <div className="mb-4 flex flex-wrap gap-4 surface-inset rounded-xl border border-outline-variant/50 p-2">
          <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
            New Fields: <span className="font-mono text-warning/80 bg-warning-container/15 px-1 rounded ml-1 lowercase">{drift.new_fields.join(', ') || '\u2014'}</span>
          </span>
          <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
            Missing: <span className="font-mono text-error bg-error-container/15 px-1 rounded ml-1 lowercase">{drift.missing_fields.join(', ') || '\u2014'}</span>
          </span>
        </div>
      )}
      {!drift && (
        <p className="mb-2 text-body-sm text-on-surface-variant">
          <span className="font-semibold uppercase tracking-wider text-warning/80">Issue \u2014 </span>
          {issue}
        </p>
      )}

      {drift && drift.proposal && (
        <div className="mb-4 surface-inset rounded-xl border border-info/30 bg-info-container/10 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-label-sm font-bold uppercase tracking-widest text-info">Model Inference (Pattern Proposal)</div>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-variant">
                <div
                  className={`h-full ${drift.proposal.confidence > 0.8 ? 'bg-success' : 'bg-warning'}`}
                  style={{ width: `${Math.round(drift.proposal.confidence * 100)}%` }}
                ></div>
              </div>
              <span className="font-mono text-label-sm text-on-surface-variant/70">{Math.round(drift.proposal.confidence * 100)}% Match</span>
            </div>
          </div>

          <div className="mb-3 space-y-1.5 border-l-2 border-info/50 pl-3">
            {drift.proposal.new_field_suggestions.map((s) => (
              <div key={s.input_field} className="flex items-center gap-2 text-body-sm">
                <span className="font-mono text-on-surface bg-surface-container-low px-1 rounded">{s.input_field}</span>
                <span className={`font-mono font-bold ${s.semantic_field ? 'text-primary' : 'text-on-surface-variant/60'}`}>
                  {s.semantic_field || '(UNCERTAIN)'}
                </span>
                <span className="ml-auto font-mono text-label-sm text-on-surface-variant/70">conf {Math.round(s.confidence * 100)}%</span>
              </div>
            ))}
          </div>
          {drift.proposal.explanation && (
            <p className="text-body-sm leading-relaxed text-on-surface-variant/80 italic">" {drift.proposal.explanation} "</p>
          )}
        </div>
      )}

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
      {synthError && <p className="mb-3 text-body-sm font-medium text-error">{synthError}</p>}
      <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-outline-variant/50">
        {drift && (
          <button
            onClick={startSynthesis}
            disabled={busy || jobActive}
            className="btn-outlined text-label-sm"
          >
            {busy ? 'Working…' : jobActive ? 'Synthesizing…' : job?.status === 'failed' ? 'Retry AI synthesis' : 'AI Synthesizer'}
          </button>
        )}
        <button
          onClick={onApprove}
          disabled={busy}
          title={
            group.truncated
              ? 'Group exceeds 10k — approves the first 10k, repeat for the rest'
              : drift
                ? 'Authorize the schema decision and drain these logs'
                : hasMapping ? 'Retry all with the existing mapping' : 'Establish a mapping, then normalize all'
          }
          className="btn-primary text-label-sm"
        >
          {busy ? 'Working…' : drift ? 'Authorize AI' : `Approve all (${group.count})`}
        </button>
        {drift ? (
          <button
            onClick={onCorrect}
            disabled={busy}
            title="Correct the AI proposal manually, then normalize all"
            className="btn-secondary text-label-sm"
          >
            Manual
          </button>
        ) : (
          <button
            onClick={onReview}
            disabled={busy || !rep}
            title="Review and edit field assignments (custom semantic fields supported), then normalize all"
            className="btn-secondary text-label-sm"
          >
            Review fields
          </button>
        )}
        <button
          onClick={onPurge}
          disabled={busy}
          title="Delete every log of this type"
          className="btn-text text-error text-label-sm"
        >
          Purge all
        </button>
        <div className="flex-1"></div>
        {drift && (
          <button
            onClick={onReject}
            disabled={busy}
            title="Disagree with the proposal and close it terminally. No mapping change; events stay quarantined."
            className="btn-text text-error text-label-sm"
          >
            Reject
          </button>
        )}
      </div>

      <details className="mt-4 group">
        <summary className="cursor-pointer select-none text-label-sm font-bold uppercase tracking-widest text-on-surface-variant/70 transition-colors group-open:text-on-surface-variant">
          <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">\u25b6</span> Sample Evidence Payload
        </summary>
        <div className="mt-2 border-l border-outline-variant pl-3 opacity-80">
          {rep ? (
            <Code value={rep.views.raw} truncate maxLines={15} />
          ) : (
            <p className="font-mono text-mono-sm text-on-surface-variant/50">Loading representative log…</p>
          )}
        </div>
      </details>
    </div>
  )
}

function ResolvedCard({ summary }: { summary: DriftSummary }) {
  const [full, setFull] = useState<DriftDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    getDrift(summary.id)
      .then((d) => {
        if (!cancelled) setFull(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [summary.id])

  const proposal = full?.proposal ?? null
  return (
    <div className="glass-card rounded-xl p-5 animate-slide-up">
      <div className="mb-3 flex items-center justify-between border-b border-outline-variant/50 pb-3">
        <h3 className="text-body-md font-bold text-on-surface flex items-center gap-2">
          Delta Request
          <span className="surface-inset rounded px-1.5 py-0.5 font-mono text-label-sm text-on-surface-variant">#{summary.id}</span>
          <span className="mx-1 text-on-surface-variant/50">|</span>
          <span className="font-mono text-mono-sm text-primary">{summary.source ?? 'UNTITLED'}</span>
        </h3>
        <span
          className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-label-sm font-bold uppercase tracking-widest ${
            summary.status === 'approved'
              ? 'border-success/30 bg-success-container/20 text-success'
              : 'border-error/30 bg-error-container/20 text-error'
          }`}
        >
          {summary.status}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 surface-inset rounded-xl border border-outline-variant/50 p-2">
        <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
          New Fields: <span className="font-mono text-warning/80 bg-warning-container/15 px-1 rounded ml-1 lowercase">{summary.new_fields.join(', ') || '\u2014'}</span>
        </span>
        <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
          Missing: <span className="font-mono text-error bg-error-container/15 px-1 rounded ml-1 lowercase">{summary.missing_fields.join(', ') || '\u2014'}</span>
        </span>
      </div>

      {proposal && (
        <div className="mb-4 surface-inset rounded-xl border border-info/30 bg-info-container/10 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-label-sm font-bold uppercase tracking-widest text-info">Model Inference (Pattern Proposal)</div>
            <span className="font-mono text-label-sm text-on-surface-variant/70">{Math.round(proposal.confidence * 100)}% Match</span>
          </div>
          <div className="space-y-1.5 border-l-2 border-info/50 pl-3">
            {proposal.new_field_suggestions.map((s) => (
              <div key={s.input_field} className="flex items-center gap-2 text-body-sm">
                <span className="font-mono text-on-surface bg-surface-container-low px-1 rounded">{s.input_field}</span>
                <span className={`font-mono font-bold ${s.semantic_field ? 'text-primary' : 'text-on-surface-variant/60'}`}>
                  {s.semantic_field || '(UNCERTAIN)'}
                </span>
                <span className="ml-auto font-mono text-label-sm text-on-surface-variant/70">conf {Math.round(s.confidence * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {full?.sample && (
        <details className="mt-4 group">
          <summary className="cursor-pointer select-none text-label-sm font-bold uppercase tracking-widest text-on-surface-variant/70 transition-colors group-open:text-on-surface-variant">
            <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">\u25b6</span> Sample Evidence Payload
          </summary>
          <div className="mt-2 border-l border-outline-variant pl-3 opacity-80">
            <Code value={full.sample} truncate maxLines={15} />
          </div>
        </details>
      )}
    </div>
  )
}

function IndexExport({ source, batchId, ids }: { source?: string; batchId?: number; ids?: number[] }) {
  const { toast } = useToast()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [mappingId, setMappingId] = useState<number | ''>('')
  const [profileId, setProfileId] = useState<number | ''>('')
  const mappings = useAsync(() => listMappings(), [])
  const profiles = useAsync(() => listOutputProfiles(), [])

  const versions = (mappings.data ?? [])
    .filter((m) => !source || m.source === source)
    .sort((a, b) => b.version - a.version || b.id - a.id)

  async function download(format: 'json' | 'ndjson' | 'csv') {
    setDownloading(format)
    try {
      const res = await exportLogs({
        format,
        status: 'normalized,output',
        ...(source ? { source } : {}),
        ...(batchId !== undefined ? { batch_id: batchId } : {}),
        ...(ids?.length ? { ids } : {}),
        ...(mappingId === '' ? {} : { mappingId }),
        ...(profileId === '' ? {} : { outputProfileId: profileId, payload: 'output' as const }),
      })
      toast(`Downloaded ${res.total} logs (${res.normalized} normalized)`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(null)
    }
  }

  const label =
    ids?.length === 1
      ? 'Download this index normalized'
      : ids && ids.length > 1
        ? `Download this set (${ids.length} logs)`
        : batchId !== undefined
          ? `Download batch #${batchId} normalized`
          : 'Download all normalized'

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 surface-panel rounded-xl px-4 py-3">
      <span className="text-label-sm font-bold uppercase tracking-[0.14em] text-on-surface-variant">
        {label}
      </span>
      {(['json', 'ndjson', 'csv'] as const).map((fmt) => (
        <button
          key={fmt}
          onClick={() => download(fmt)}
          disabled={downloading !== null}
          className="btn-secondary text-label-sm"
        >
          {downloading === fmt ? <Spinner size="sm" /> : fmt}
        </button>
      ))}
      <Dropdown<number>
        value={mappingId === '' ? undefined : mappingId}
        onChange={(v) => setMappingId(v ?? '')}
        options={versions.map((m) => ({
          value: m.id,
          label: `${m.name} · v${m.version} · ${m.status}`,
        }))}
        placeholder="Latest version…"
        searchable
        allowClear
        className="w-56 shrink-0"
      />
      <Dropdown<number>
        value={profileId === '' ? undefined : profileId}
        onChange={(v) => setProfileId(v ?? '')}
        options={(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        placeholder="Stored output…"
        searchable
        allowClear
        className="w-56 shrink-0"
      />
    </div>
  )
}

function UploadsSection({
  batches,
  loading,
  onScopeBatch,
  onScopeGroup,
}: {
  batches: BatchRun[]
  loading: boolean
  onScopeBatch: (b: BatchRun) => void
  onScopeGroup: (b: BatchRun, g: BatchGroup, letter: string) => void
}) {
  const { toast } = useToast()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [groups, setGroups] = useState<Record<number, BatchGroup[]>>({})
  const [groupsLoading, setGroupsLoading] = useState<number | null>(null)

  async function toggle(batchId: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
    if (groups[batchId] !== undefined || groupsLoading === batchId) return
    setGroupsLoading(batchId)
    try {
      const fetched = await getBatchGroups(batchId)
      setGroups((prev) => ({ ...prev, [batchId]: fetched }))
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupsLoading(null)
    }
  }

  if (loading) return <div className="mt-8 flex justify-center"><Spinner /></div>
  if (batches.length === 0) return null

  return (
    <div className="mb-6 space-y-4">
      {batches.map((b) => {
        const isOpen = expanded.has(b.id)
        const held = b.live_held
        return (
          <section key={b.id} className="surface-panel rounded-xl p-1">
            <div
              onClick={() => onScopeBatch(b)}
              className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-primary/5"
              title="Open this upload"
            >
              <button
                onClick={(e) => { e.stopPropagation(); toggle(b.id) }}
                className="control-icon h-7 w-7 shrink-0"
                aria-label={isOpen ? 'Collapse types' : 'Expand types'}
                title={isOpen ? 'Collapse types' : 'Expand types'}
              >
                <span className={`inline-block opacity-70 transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
              </button>
              <span className="font-mono text-body-md font-semibold text-primary">Index #{b.id}</span>
              <span className="text-body-sm text-on-surface-variant">{b.source ?? 'unassigned'}</span>
              <span className="font-mono text-body-sm text-on-surface">{b.total.toLocaleString()} logs</span>
              {held > 0 && (
                <span className="rounded-full border border-warning/30 bg-warning-container/20 px-2 py-0.5 font-mono text-label-sm text-warning">
                  {held} held
                </span>
              )}
              <span className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <span className="font-mono text-mono-sm text-on-surface-variant/60">Open to download</span>
              </span>
            </div>
            {isOpen && (
              <div className="border-t border-outline-variant/50 px-4 py-2">
                {groupsLoading === b.id && <div className="flex justify-center py-3"><Spinner size="sm" /></div>}
                {(groups[b.id] ?? []).map((g, i) => {
                  const letter = String.fromCharCode(97 + i)
                  return (
                    <div key={g.key} className="flex flex-wrap items-center gap-3 border-b border-outline-variant/30 py-2.5 last:border-b-0">
                      <button
                        onClick={() => onScopeGroup(b, g, letter)}
                        className="font-mono text-body-md font-semibold text-on-surface hover:text-primary hover:underline"
                        title="Open only this type"
                      >
                        #{b.id}{letter}
                      </button>
                      <span className="font-mono text-mono-sm text-on-surface-variant">{g.format}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-on-surface-variant/70" title={g.fields.join(', ')}>
                        {g.fields.join(', ') || '—'}
                      </span>
                      <span className="font-mono text-body-sm text-on-surface">{g.count.toLocaleString()}</span>
                      {g.held > 0 && (
                        <span className="rounded-full border border-warning/30 bg-warning-container/15 px-2 py-0.5 font-mono text-label-sm text-warning">
                          {g.held} held
                        </span>
                      )}
                      <span className="flex items-center gap-2">
                        <button onClick={() => onScopeGroup(b, g, letter)} className="btn-text text-label-sm">
                          Open
                        </button>
                      </span>
                    </div>
                  )
                })}
                {groups[b.id] !== undefined && groups[b.id].length === 0 && (
                  <p className="py-2 text-body-sm text-on-surface-variant/70">No stored rows for this upload (replays deduplicate).</p>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

export default function Logs({ sourceFilter }: { sourceFilter?: string }) {
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<LogTab>(() => (searchParams.get('tab') === 'review' ? 'inspection' : 'normalized'))
  const [reviewView, setReviewView] = useState<'open' | 'resolved'>('open')
  const [resolvedVendor, setResolvedVendor] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [vendor, setVendor] = useState('')
  const [batchId, setBatchId] = useState<number | ''>('')
  const [groupIds, setGroupIds] = useState<number[] | null>(null)
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [groupLabel, setGroupLabel] = useState<string | null>(null)
  const [clearAllLoading, setClearAllLoading] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const vendors = useAsync(() => listConnections(), [])
  const batches = useAsync(() => listBatches(), [])
  const source = sourceFilter ?? vendor

  useEffect(() => {
    setPage(1)
    setExhausted(false)
  }, [tab, source, batchId, groupIds, search])
  const events = useAsync(
    () => listEvents({ limit: 200, ...(source ? { source } : {}) }),
    [source],
  )
  const [extra, setExtra] = useState<EventSummary[]>([])
  const [serverHits, setServerHits] = useState<EventSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [scope, setScope] = useState<EventSummary | null>(null)
  const detail = useAsync(
    () => (selected ? getEvent(selected) : Promise.resolve(null)),
    [selected],
  )
  const mappings = useAsync(() => listMappings(), [])
  const driftList = useAsync(() => listDrift(), [])
  const { toast } = useToast()

  useEffect(() => {
    if (tab === 'index-detail' && selected === null) setTab('normalized')
  }, [tab, selected])

  async function loadMore() {
    if (loadingMore || exhausted) return
    setLoadingMore(true)
    try {
      const more = await listEvents({ limit: 200, offset: all.length, ...(source ? { source } : {}) })
      if (more.length === 0) {
        setExhausted(true)
        return
      }
      const seen = new Set(all.map((e) => e.id))
      setExtra((prev) => [...prev, ...more.filter((e) => !seen.has(e.id))])
      if (more.length < 200) setExhausted(true)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  // Older logs fetch themselves as you scroll (no button): the sentinel
  // below the pager fires the next 200 the moment it scrolls into view.
  useEffect(() => {
    const el = moreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) loadMore()
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  })

  useEffect(() => {
    const focus = () => searchRef.current?.focus()
    window.addEventListener(FOCUS_SEARCH_EVENT, focus)
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus)
  }, [])

  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setServerHits(null)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      searchEventsRaw(q, source || undefined)
        .then((hits) => setServerHits(hits))
        .catch(() => setServerHits(null))
        .finally(() => setSearching(false))
    }, 400)
    return () => clearTimeout(timer)
  }, [search, source])

  useLive({ source: source || undefined, onEvent: () => { events.reload(); serverGroups.reload(); driftList.reload(); batches.reload() } })

  useEffect(() => {
    const timer = setInterval(() => { events.reload(); serverGroups.reload(); driftList.reload(); batches.reload() }, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const base = useMemo(
    () => [...(events.data ?? []), ...extra],
    [events.data, extra],
  )
  const serverIds = useMemo(() => new Set((serverHits ?? []).map((e) => e.id)), [serverHits])
  const all = useMemo(() => {
    if (!serverHits?.length) return base
    const seen = new Set(base.map((e) => e.id))
    return [...base, ...serverHits.filter((e) => !seen.has(e.id))]
  }, [base, serverHits])

  function matchesSearch(e: EventSummary): boolean {
    const q = search.trim()
    if (!q) return true
    if (serverIds.has(e.id)) return true
    const lq = q.toLowerCase()
    return (
      e.event_id.toLowerCase().includes(lq) ||
      (e.source_id !== null && String(e.source_id).includes(q)) ||
      (e.source ?? '').toLowerCase().includes(lq) ||
      formatLabel(e.detected_format).includes(lq) ||
      matchesId(e, q)
    )
  }

  const inBatch = (e: EventSummary) => batchId === '' || e.batch_id === batchId
  // Shape-exact server groups: one approval resolves one group completely.
  // (Client-side format+source grouping mixed shapes, so each approval only
  // peeled one shape and asked again.)
  const serverGroups = useAsync<EventGroup[]>(
    () =>
      tab === 'inspection'
        ? listEventGroups('quarantined', source || undefined)
        : Promise.resolve([] as EventGroup[]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, source],
  )
  const groups: QuarantineGroup[] = useMemo(() => {
    const rows = (serverGroups.data ?? []).filter(
      (g) => g.rep_id !== null && (!scope || (g.source === scope.source && g.format === formatLabel(scope.detected_format))),
    )
    return rows.map((g) => ({
      key: g.key,
      format: g.format,
      source: g.source,
      ids: g.event_ids,
      repId: g.rep_id as number,
      count: g.count,
      truncated: g.truncated,
      fields: g.fields,
    }))
  }, [serverGroups.data, scope])

  const [driftDetails, setDriftDetails] = useState<Record<number, DriftDetail>>({})
  const [correctTarget, setCorrectTarget] = useState<DriftDetail | null>(null)

  const [reps, setReps] = useState<Record<string, EventDetail>>({})
  useEffect(() => {
    let cancelled = false
    const missing = groups.filter((g) => reps[g.key] === undefined)
    if (missing.length === 0) return
    Promise.all(missing.map((g) => getEvent(g.repId).catch(() => null))).then((details) => {
      if (cancelled) return
      setReps((prev) => {
        const next = { ...prev }
        missing.forEach((g, i) => {
          if (details[i]) next[g.key] = details[i] as EventDetail
        })
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [groups, reps])

  useEffect(() => {
    let cancelled = false
    const ids = groups
      .map((g) => matchOpenDrift(g)?.id)
      .filter((id): id is number => id !== undefined && driftDetails[id] === undefined)
    if (ids.length === 0) return
    Promise.all([...new Set(ids)].map((id) => getDrift(id).catch(() => null))).then((details) => {
      if (cancelled) return
      setDriftDetails((prev) => {
        const next = { ...prev }
        for (const d of details) {
          if (d) next[d.id] = d
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [groups, driftDetails, driftList.data])

  const [groupBusy, setGroupBusy] = useState<string | null>(null)
  const [onboarding, setOnboarding] = useState<QuarantineGroup | null>(null)

  function mappingFor(sourceName: string | null): boolean {
    return (mappings.data ?? []).some(
      (m) => m.source === sourceName && (m.status === 'approved' || m.status === 'published'),
    )
  }

  function issueFor(group: QuarantineGroup): string {
    if (mappingFor(group.source)) {
      return 'Schema drift — these fields no longer match the approved mapping. Approving retries every log of this type through it.'
    }
    return 'No approved mapping resolves this format yet. Approving establishes one and normalizes every log of this type.'
  }

  /** Truthful outcome: a retried event may re-quarantine on new drift, so
   *  report post-retry statuses instead of assuming everything normalized.
   *  Older backends omit `statuses` — then fall back to the retried count. */
  function reportOutcome(group: QuarantineGroup, res: { retried: number[]; skipped?: Record<string, string>; statuses?: Record<string, string> }) {
    const skippedCount = res.skipped ? Object.keys(res.skipped).length : 0
    if (!res.statuses) {
      toast(
        res.retried.length > 0
          ? `Approved — ${res.retried.length} reprocessed${skippedCount > 0 ? ` (${skippedCount} already resolved)` : ''}`
          : 'Nothing left to approve — all already resolved',
        'success',
      )
      return
    }
    const normalized = group.ids.filter((id) => {
      const outcome = res.statuses?.[String(id)]
      return outcome === 'normalized' || outcome === 'output'
    }).length
    const stillPending = group.ids.filter((id) => {
      const outcome = res.statuses?.[String(id)]
      return outcome === 'quarantined' || outcome === 'dlq'
    }).length
    if (normalized > 0 && stillPending === 0) {
      toast(
        `Approved — ${normalized} normalized${skippedCount > 0 ? ` (${skippedCount} already resolved)` : ''}`,
        'success',
      )
    } else if (normalized > 0) {
      toast(
        `Partially approved — ${normalized} normalized, ${stillPending} still need review (new fields not yet mapped)`,
        'info',
      )
    } else if (stillPending > 0) {
      toast(
        `${stillPending} still need review — approve a mapping for their new fields first`,
        'info',
      )
    } else {
      toast('Nothing left to approve — all already resolved', 'success')
    }
  }

  // One approve finishes the job: when an open drift decision matches this
  // shape, authorize it (mapping version bumps AND its logs drain) instead of
  // retrying against the stale mapping and bouncing back into quarantine.
  function matchOpenDrift(group: QuarantineGroup) {
    const open = (driftList.data ?? []).filter(
      (d) =>
        (d.status === 'detected' || d.status === 'analyzed' || d.status === 'review') &&
        (d.source ?? '') === (group.source ?? '') &&
        d.new_fields.every((f) => group.fields.includes(f)),
    )
    open.sort((a, b) => b.confidence - a.confidence)
    return open[0] ?? null
  }

  async function approveGroup(group: QuarantineGroup) {
    const key = group.key
    const drift = matchOpenDrift(group)
    if (drift) {
      setGroupBusy(key)
      try {
        const res = await approveDrift(drift.id)
        toast(`Approved — mapping v${res.new_mapping_version}, ${res.reprocessed_events} logs reprocessed`, 'success')
        mappings.reload()
        events.reload()
        serverGroups.reload()
        driftList.reload()
        batches.reload()
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setGroupBusy(null)
      }
      return
    }
    if (!mappingFor(group.source)) {
      setOnboarding(group)
      return
    }
    setGroupBusy(key)
    try {
      const res = await batchRetryEvents(group.ids)
      reportOutcome(group, res)
      events.reload()
      serverGroups.reload()
      driftList.reload()
      batches.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupBusy(null)
    }
  }

  async function approveAfterOnboard(group: QuarantineGroup) {
    const key = group.key
    setOnboarding(null)
    setGroupBusy(key)
    try {
      const res = await batchRetryEvents(group.ids)
      reportOutcome(group, res)
      mappings.reload()
      events.reload()
      serverGroups.reload()
      driftList.reload()
      batches.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupBusy(null)
    }
  }

  async function purgeGroup(group: QuarantineGroup) {
    if (!window.confirm(`Purge all ${group.ids.length} ${group.format} logs${group.source ? ` from ${group.source}` : ''}?`)) return
    const key = group.key
    setGroupBusy(key)
    try {
      const res = await batchDeleteEvents(group.ids)
      toast(`Purged ${res.deleted.length} logs`, 'success')
      events.reload()
      serverGroups.reload()
      driftList.reload()
      batches.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupBusy(null)
    }
  }

  async function rejectCardDrift(group: QuarantineGroup, d: DriftDetail) {
    setGroupBusy(group.key)
    try {
      await rejectDrift(d.id)
      toast('Rejected \u2014 events stay quarantined', 'success')
      events.reload()
      serverGroups.reload()
      driftList.reload()
      batches.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupBusy(null)
    }
  }

  function refreshDecision(driftId: number) {
    setDriftDetails((prev) => {
      if (!(driftId in prev)) return prev
      const next = { ...prev }
      delete next[driftId]
      return next
    })
    driftList.reload()
    serverGroups.reload()
  }

  function doneCorrecting() {
    setCorrectTarget(null)
    mappings.reload()
    events.reload()
    serverGroups.reload()
    driftList.reload()
    batches.reload()
  }

  const resolvedDrifts = useMemo(
    () =>
      (driftList.data ?? [])
        .filter(
          (d) =>
            (d.status === 'approved' || d.status === 'rejected') &&
            (!source || (d.source ?? '') === source),
        )
        .sort((a, b) => b.id - a.id),
    [driftList.data, source],
  )

  const resolvedVendors = useMemo(() => {
    const bySource = new Map<string, { total: number; approved: number; rejected: number }>()
    for (const d of resolvedDrifts) {
      const key = d.source ?? 'Unassigned origin'
      const g = bySource.get(key) ?? { total: 0, approved: 0, rejected: 0 }
      g.total += 1
      if (d.status === 'approved') g.approved += 1
      else g.rejected += 1
      bySource.set(key, g)
    }
    return [...bySource.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [resolvedDrifts])
  const resolvedShown = resolvedVendor
    ? resolvedDrifts.filter((d) => (d.source ?? 'Unassigned origin') === resolvedVendor)
    : []

  const groupIdSet = useMemo(() => (groupIds ? new Set(groupIds) : null), [groupIds])
  const rows = all
    .filter((e: EventSummary) => matchesTab(e.status, tab))
    .filter(matchesSearch)
    .filter((e: EventSummary) => inBatch(e))
    .filter((e: EventSummary) => !groupIdSet || groupIdSet.has(e.id))
    .filter((e: EventSummary) => {
      if (!scope || tab === 'normalized' || tab === 'index-detail') return true
      return e.source === scope.source && formatLabel(e.detected_format) === formatLabel(scope.detected_format)
    })

  // Row table only opens on a scope (upload/type) or search; uploads-first
  // otherwise. Paged Google-style: size options + numbered buttons.
  const showTable =
    tab === 'failed' ||
    (tab === 'normalized' && (batchId !== '' || groupIds || search.trim().length >= 2))
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize)

  function selectIndex(e: EventSummary) {
    setSelected(e.id)
    setScope(e)
    setTab('index-detail')
  }

  function clearGroup() {
    setGroupIds(null)
    setGroupKey(null)
    setGroupLabel(null)
  }

  function scopeBatch(b: BatchRun) {
    if (batchId === b.id) {
      setBatchId('')
      clearGroup()
      setSelected(null)
      return
    }
    setBatchId(b.id)
    clearGroup()
    setSelected(null)
    setTab('normalized')
  }

  function scopeGroup(b: BatchRun, g: BatchGroup, letter: string) {
    if (groupKey === `${b.id}${letter}`) {
      clearGroup()
      return
    }
    setBatchId(b.id)
    setGroupIds(g.event_ids)
    setGroupKey(`${b.id}${letter}`)
    setGroupLabel(`#${b.id}${letter} · ${g.format} · ${g.count} logs`)
    setSelected(null)
    setTab('normalized')
  }

  async function handleClearAll() {
    const statusFilter = tab === 'normalized' ? 'normalized,output' : tab === 'failed' ? 'failed' : ''
    const confirmed = window.confirm(
      `Delete ALL events matching current filters?\n\n` +
      `Scope: ${source ? `source "${source}"` : 'all sources'}` +
      `${batchId ? `, batch #${batchId}` : ''}` +
      `${statusFilter ? `, status "${statusFilter}"` : ''}` +
      `\n\nThis action is IRREVERSIBLE. Events cannot be recovered.`
    )
    if (!confirmed) return

    setClearAllLoading(true)
    try {
      // Fetch all matching event IDs in chunks and delete
      let deleted = 0
      const CHUNK = 2000
      let offset = 0
      while (true) {
        const chunk = await listEvents({
          limit: CHUNK,
          offset,
          ...(source ? { source } : {}),
          ...(batchId ? { batch_id: batchId } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
        })
        if (chunk.length === 0) break
        const ids = chunk.map((e) => e.id)
        await batchDeleteEvents(ids)
        deleted += ids.length
        if (chunk.length < CHUNK) break
        offset += CHUNK
      }
      toast(`Cleared ${deleted} event${deleted === 1 ? '' : 's'}`, 'success')
      events.reload()
      serverGroups.reload()
      batches.reload()
      setSelected(null)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setClearAllLoading(false)
    }
  }

  const siblingCount = useMemo(() => {
    if (!scope) return 0
    return all.filter(
      (e) => e.source === scope.source && formatLabel(e.detected_format) === formatLabel(scope.detected_format),
    ).length
  }, [all, scope])

  const onboardingRep = onboarding ? reps[onboarding.key] : undefined

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={sourceFilter ? `Logs · ${sourceFilter}` : 'Telemetry Data'}
        subtitle="The unified indexing interface — query, inspect, and trace live stream payloads."
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-outline-variant/50 pb-4">
        <div className="flex items-center gap-1.5">
          {TABS.map((t) => {
            const gated = t.key === 'index-detail' && selected === null
            return (
              <button
                key={t.key}
                disabled={gated}
                onClick={() => {
                  if (gated) return
                  setTab(t.key)
                }}
                title={gated ? 'Click an index in Normalized first' : undefined}
                className={`rounded px-3 py-1.5 text-body-sm font-medium transition-all ${
                  gated
                    ? 'cursor-not-allowed border border-transparent text-on-surface-variant/40'
                    : tab === t.key
                    ? 'border border-primary/30 bg-primary-container/10 text-primary shadow-[0_0_10px_var(--color-primary)]'
                    : 'border border-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3">
          <div className="relative min-w-64 flex-1 search-primary" role="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searching ? 'Searching full history…' : 'Search index, id, history…'}
              className="w-full input-glass pl-12 pr-4 py-2.5 text-body-sm text-on-surface placeholder:text-on-surface-variant/50"
            />
          </div>
{!sourceFilter && (
            <Dropdown
              value={vendor}
              onChange={(v) => {
                setVendor(v ?? '')
                setExtra([])
                setSelected(null)
                setBatchId('')
                clearGroup()
              }}
              options={[
                { value: '', label: 'Global context…' },
                ...(vendors.data ?? []).map((c) => ({ value: c.name, label: `${c.name} (${c.events_processed})` })),
              ]}
              placeholder="Global context…"
              searchable
              className="w-56 shrink-0"
            />
          )}
          <Dropdown<number>
            value={batchId === '' ? undefined : batchId}
            onChange={(v) => { setBatchId(v ?? ''); clearGroup() }}
            options={(batches.data ?? []).map((b) => ({
              value: b.id,
              label: `#${b.id} · ${b.source ?? 'unassigned'} · ${b.total}`,
            }))}
            placeholder="All batches…"
            searchable
            allowClear
            className="w-56 shrink-0"
          />
          <button
            onClick={handleClearAll}
            disabled={clearAllLoading}
            className="btn-text text-error text-label-sm px-3 py-2"
            title="Clear all events matching current filters (requires confirmation)"
          >
            {clearAllLoading ? <Spinner size="sm" /> : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 mr-1.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                Clear all events
              </>
            )}
          </button>
        </div>
      </div>

      {events.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
      {events.error && <p className="text-body-md font-medium text-error">{events.error}</p>}

      {tab === 'inspection' && (
        <div className="mb-6 space-y-4">
          <div className="flex items-center gap-1.5">
            {(['open', 'resolved'] as const).map((v) => {
              const n = v === 'open' ? groups.length : resolvedDrifts.length
              return (
                <button
                  key={v}
                  onClick={() => { setReviewView(v); setResolvedVendor(null) }}
                  className={`rounded px-3 py-1.5 text-body-sm font-medium capitalize transition-all ${
                    reviewView === v
                      ? 'border border-primary/30 bg-primary-container/10 text-primary shadow-[0_0_10px_var(--color-primary)]'
                      : 'border border-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  {v} ({n})
                </button>
              )
            })}
          </div>
          {reviewView === 'resolved' && resolvedVendor === null && (
            <div>
              {resolvedVendors.length === 0 && (
                <p className="py-4 text-center text-body-md text-on-surface-variant/70">No resolved items.</p>
              )}
              <div className="grid gap-4 lg:grid-cols-2">
                {resolvedVendors.map(([vendor, counts]) => (
                  <button
                    key={vendor}
                    onClick={() => setResolvedVendor(vendor)}
                    className="glass-card group flex items-center justify-between rounded-xl p-5 text-left transition-all hover:border-primary/30 hover:shadow-e2"
                  >
                    <div>
                      <p className="font-mono text-body-lg font-semibold text-on-surface group-hover:text-primary">{vendor}</p>
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
            </div>
          )}
          {reviewView === 'resolved' && resolvedVendor !== null && (
            <div className="space-y-2">
              <div className="mb-1 flex items-center gap-3">
                <button onClick={() => setResolvedVendor(null)} className="btn-secondary text-label-sm">
                  Vendors
                </button>
                <h3 className="font-mono text-body-lg font-semibold text-on-surface">{resolvedVendor}</h3>
                <span className="surface-inset rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-label-sm text-on-surface-variant">
                  {resolvedShown.length} resolved
                </span>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {resolvedShown.map((d) => (
                  <ResolvedCard key={d.id} summary={d} />
                ))}
              </div>
            </div>
          )}
          {reviewView === 'open' && scope && (
            <div className="flex items-center gap-3 surface-inset rounded-xl border border-primary/30 bg-primary-container/10 px-4 py-2 text-body-sm text-primary">
              <span>
                Scoped to index <span className="font-mono font-bold">{padId(scope.id)}</span>
                {' '}· {formatLabel(scope.detected_format)} · {scope.source ?? 'Unassigned origin'}
              </span>
              <button
                onClick={() => setScope(null)}
                className="ml-auto btn-text text-error text-label-sm"
              >
                Clear scope (review)
              </button>
            </div>
          )}
          {reviewView === 'open' && groups.length === 0 && !serverGroups.loading && (
            <EmptyState
              title="Nothing awaiting review"
              description={scope ? 'No held logs of the scoped type.' : 'Stuck shapes and their schema decisions will appear here.'}
            />
          )}
          {reviewView === 'open' && groups.map((g) => {
            return (
              <InspectionCard
                key={g.key}
                group={g}
                rep={reps[g.key] ?? null}
                issue={issueFor(g)}
                hasMapping={mappingFor(g.source)}
                busy={groupBusy === g.key}
                drift={(() => { const m = matchOpenDrift(g); return m ? driftDetails[m.id] ?? null : null })()}
                onApprove={() => approveGroup(g)}
                onReview={() => setOnboarding(g)}
                onCorrect={() => {
                  const m = matchOpenDrift(g)
                  if (m && driftDetails[m.id]) setCorrectTarget(driftDetails[m.id])
                }}
                onReject={() => {
                  const m = matchOpenDrift(g)
                  const d = m ? driftDetails[m.id] : undefined
                  if (d) rejectCardDrift(g, d)
                }}
                onDriftChanged={() => {
                  const m = matchOpenDrift(g)
                  if (m) refreshDecision(m.id)
                }}
                onPurge={() => purgeGroup(g)}
              />
            )
          })}
        </div>
      )}
      {tab === 'normalized' && batchId === '' && !groupIds && search.trim().length < 2 && (batches.data ?? []).length === 0 && all.length === 0 && !events.loading && (
        <div className="mt-8">
          <EmptyState
            title="Telemetry Empty"
            description="Awaiting telemetry ingestion. Upload a file via Event processing — each upload becomes one index."
          />
        </div>
      )}

      {showTable && !events.loading && !events.error && rows.length === 0 && (
        <div className="mt-8">
          <EmptyState
            title={all.length === 0 ? 'Telemetry Empty' : 'No Results'}
            description={
              all.length === 0
                ? 'Awaiting telemetry ingestion. Configure a node to transmit logs.'
                : 'Modify active filters.'
            }
          />
        </div>
      )}

      {tab === 'index-detail' && (
        <div>
          {scope && (
            <div className="mb-4 flex items-center gap-3 surface-inset rounded-xl border border-primary/30 bg-primary-container/10 px-4 py-2 text-body-sm text-primary">
              <span>
                Index <span className="font-mono font-bold">{padId(scope.id)}</span>
                {' '}· {formatLabel(scope.detected_format)} · {scope.source ?? 'Unassigned origin'}
              </span>
            </div>
          )}
          {selected && detail.data ? (
            <>
              <IndexExport ids={selected !== null ? [selected] : undefined} />
              <Detail
                detail={detail.data}
                siblingCount={siblingCount}
                onChanged={() => {
                  events.reload()
                  serverGroups.reload()
                  detail.reload()
                }}
                onDeleted={() => setSelected(null)}
              />
            </>
          ) : (
            <div className="mt-8 flex justify-center"><Spinner /></div>
          )}
        </div>
      )}

      {tab === 'normalized' && (
        <UploadsSection
          batches={(batches.data ?? []).filter((b) => !source || (b.source ?? '') === source)}
          loading={batches.loading}
          onScopeBatch={scopeBatch}
          onScopeGroup={scopeGroup}
        />
      )}

      {groupIds && (tab === 'normalized' || tab === 'failed') && (
        <div className="mb-4 flex items-center gap-3 surface-inset rounded-xl border border-primary/30 bg-primary-container/10 px-4 py-2 text-body-sm text-primary">
          <span>
            Scoped to set <span className="font-mono font-bold">{groupLabel}</span>
          </span>
          <button onClick={clearGroup} className="ml-auto btn-text text-error text-label-sm">
            Clear scope
          </button>
        </div>
      )}

      {(tab === 'normalized' || tab === 'failed') && (batchId !== '' || groupIds) && (
        <IndexExport
          source={source || undefined}
          batchId={batchId === '' ? undefined : batchId}
          ids={groupIds ?? undefined}
        />
      )}

      {showTable && rows.length > 0 && (
        <div className="mt-2 surface-panel rounded-xl p-[1px]">
          <Table>
            <THead>
              <TR>
                <TH>Index</TH>
                <TH>Lifecycle</TH>
                <TH>Timestamp</TH>
                <TH>Global ID</TH>
              </TR>
            </THead>
            <TBody>
              {pageRows.map((e) => (
                <TR key={e.id} onClick={tab === 'normalized' ? () => selectIndex(e) : undefined}>
                  <TD className={selected === e.id ? 'bg-primary/10 font-bold text-primary' : 'text-on-surface'}>
                    {padId(e.id)}
                  </TD>
                  <TD className={selected === e.id ? 'bg-primary/10' : ''}>
                    <StatusBadge status={e.status} />
                  </TD>
                  <TD className={`text-on-surface-variant ${selected === e.id ? 'bg-primary/10' : ''}`}>{formatTime(e.received_at)}</TD>
                  <TD className={`font-mono text-mono-sm text-on-surface-variant/60 ${selected === e.id ? 'bg-primary/10 text-primary/70' : ''}`}>{e.event_id}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}

      {showTable && rows.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 surface-panel rounded-xl px-4 py-3">
          <span className="font-mono text-body-sm text-on-surface-variant">
            Showing {(safePage - 1) * pageSize + 1}&ndash;{Math.min(safePage * pageSize, rows.length)} of {rows.length}
          </span>
          <Dropdown<number>
            value={pageSize}
            onChange={(v) => { if (v) { setPageSize(v); setPage(1) } }}
            options={[10, 50, 100].map((n) => ({ value: n, label: `${n} / page` }))}
            className="w-36 shrink-0"
          />
          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="btn-text text-label-sm disabled:opacity-40"
            >
              &lsaquo; Prev
            </button>
            {pageWindow(safePage, totalPages).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`min-w-8 rounded-lg px-2 py-1 font-mono text-body-sm transition-colors ${
                  p === safePage
                    ? 'bg-primary font-semibold text-on-primary'
                    : 'text-primary hover:bg-primary/10'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="btn-text text-label-sm disabled:opacity-40"
            >
              Next &rsaquo;
            </button>
          </span>
        </div>
      )}

      {showTable && rows.length > 0 && (
        <div ref={moreRef} className="mt-4 border-t border-outline-variant/50 pt-4 text-center">
          <p className="font-mono text-body-sm text-on-surface-variant/70">
            {loadingMore ? (
              <span className="inline-flex items-center gap-2"><Spinner size="sm" /> Loading older logs…</span>
            ) : exhausted ? (
              <span>{all.length} indexed — full history</span>
            ) : (
              <span>{all.length} indexed — scroll for older logs</span>
            )}
          </p>
        </div>
      )}

      {correctTarget && (
        <CorrectModal
          drift={correctTarget}
          onClose={() => setCorrectTarget(null)}
          onDone={doneCorrecting}
        />
      )}

      {onboarding && onboardingRep && (
        <OnboardModal
          event={onboardingRep}
          onClose={() => setOnboarding(null)}
          onDone={() => approveAfterOnboard(onboarding)}
        />
      )}
    </div>
  )
}
