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
import { SEMANTIC_FIELDS } from '../api/types'
import { Code } from '../components/Code'
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
  detected: 'bg-amber-700 text-amber-100',
  analyzed: 'bg-sky-700 text-sky-100',
  review: 'bg-red-700 text-red-100',
  approved: 'bg-emerald-700 text-emerald-100',
  rejected: 'bg-red-800 text-red-100',
  ignored: 'bg-slate-700 text-slate-300',
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-slate-700 text-slate-200'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
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
    <Modal open title="Teach Simplifyr — correct the interpretation" onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">
        Your correction becomes a new published mapping version. Future events from{' '}
        {detail.source ?? 'this source'} are recognized automatically.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="mb-4 space-y-2">
        {rows.map((row, i) => (
          <div key={row.input_field} className="flex items-center gap-2">
            <span className="w-1/3 truncate rounded-md bg-slate-950 px-3 py-2 font-mono text-xs text-slate-300">
              {row.input_field}
            </span>
            <span className="text-xs text-slate-500">→</span>
            <select
              value={row.semantic_field}
              onChange={(e) => updateRow(i, e.target.value)}
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">Semantic field…</option>
              {SEMANTIC_FIELDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-md border border-slate-700 px-4 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Applying…' : 'Apply correction'}
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
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Change #{detail.id}{' '}
          <span className="font-normal text-slate-500">· {detail.source ?? 'unknown source'}</span>
        </h3>
        <StatusPill status={detail.status} />
      </div>

      <div className="mb-2 flex flex-wrap gap-4 text-xs">
        <span className="text-slate-400">
          New: <span className="font-mono text-amber-300">{detail.new_fields.join(', ') || '—'}</span>
        </span>
        <span className="text-slate-400">
          Missing: <span className="font-mono text-red-300">{detail.missing_fields.join(', ') || '—'}</span>
        </span>
      </div>

      {detail.proposal && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-slate-400">
            Proposed interpretation (confidence {Math.round(detail.proposal.confidence * 100)}%)
          </div>
          <div className="mb-1 space-y-1">
            {detail.proposal.new_field_suggestions.map((s) => (
              <div key={s.input_field} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-200">{s.input_field}</span>
                <span className="text-slate-500">→</span>
                <span className={`font-mono ${s.semantic_field ? 'text-emerald-300' : 'text-slate-500'}`}>
                  {s.semantic_field || '(needs input)'}
                </span>
                <span className="text-slate-600">conf {Math.round(s.confidence * 100)}%</span>
              </div>
            ))}
          </div>
          {detail.proposal.explanation && (
            <p className="text-xs text-slate-500">{detail.proposal.explanation}</p>
          )}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => run('analyze')}
          disabled={busy !== null || resolved}
          className="rounded-md bg-sky-700 px-3 py-1.5 text-sm text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {busy === 'analyze' ? '…' : 'Analyze'}
        </button>
        <button
          onClick={() => run('approve')}
          disabled={busy !== null || resolved}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {busy === 'approve' ? '…' : 'Approve'}
        </button>
        <button
          onClick={() => setCorrecting(true)}
          disabled={busy !== null || resolved}
          className="rounded-md bg-indigo-700 px-3 py-1.5 text-sm text-white hover:bg-indigo-600 disabled:opacity-40"
        >
          Correct
        </button>
        <button
          onClick={() => run('ignore')}
          disabled={busy !== null || resolved}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {busy === 'ignore' ? '…' : 'Ignore'}
        </button>
        <button
          onClick={() => run('reject')}
          disabled={busy !== null || resolved}
          className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50 disabled:opacity-40"
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
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-slate-400">Sample event</summary>
          <div className="mt-2">
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
        toast(`Reprocessed — now ${updated.status}`, 'success')
      } else if (action === 'delete') {
        if (!window.confirm(`Delete event #${id}?`)) return
        await deleteEvent(id)
        toast(`Deleted event #${id}`, 'success')
      } else {
        const res = await onboardEvent(id, {
          connectionName: sourceFilter,
          fields: [],
        })
        toast(`Mapped (v${res.mapping_version}) — event ${res.event_status}`, 'success')
      }
      quarantined.reload()
      drifts.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  return (
    <div>
      {!sourceFilter && (
        <PageHeader
          title="Needs Review"
          subtitle="AI proposes. Humans teach. The system remembers. Approve, correct, or ignore proposals."
        />
      )}

      {drifts.loading && <Spinner />}
      {drifts.error && <p className="text-sm text-red-400">{drifts.error}</p>}

      {!drifts.loading && !drifts.error && rows.length === 0 && stuck.length === 0 && (
        <EmptyState
          title={sourceFilter ? 'Nothing needs review for this connection' : 'Nothing needs review'}
          description="Approved patterns are handled automatically in the future."
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((d) => (
          <ReviewCard key={d.id} detail={d} onChanged={() => reloadAll()} />
        ))}
      </div>

      {stuck.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-white">
            Quarantined events{sourceFilter ? ` for ${sourceFilter}` : ''} — no mapping yet
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            Onboard publishes a mapping (new version for a known connection, new
            vendor for a new name) and reprocesses the event. Retry re-runs it.
            Delete removes junk.
          </p>
          <div className="space-y-2">
            {stuck.map((e: EventSummary) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-slate-300">
                  #{e.id} · {e.event_id.slice(0, 8)}… · {e.source ?? 'no source'}
                </span>
                <span className="flex gap-2">
                  <button
                    onClick={() => actOnEvent(e.id, 'onboard')}
                    className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    Onboard
                  </button>
                  <button
                    onClick={() => actOnEvent(e.id, 'retry')}
                    className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    Retry
                  </button>
                  <button
                    onClick={() => actOnEvent(e.id, 'delete')}
                    className="rounded-md border border-red-900 px-2.5 py-1 text-xs text-red-300 hover:bg-red-950/50"
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
