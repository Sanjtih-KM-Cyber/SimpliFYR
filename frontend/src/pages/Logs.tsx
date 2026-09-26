import { useEffect, useMemo, useRef, useState } from 'react'
import {
  batchDeleteEvents,
  batchRetryEvents,
  deleteEvent,
  exportLogs,
  getEvent,
  ingest,
  listConnections,
  listEvents,
  listMappings,
  retryEvent,
  searchEventsRaw,
} from '../api/client'
import type { EventDetail, EventStatus, EventSummary, IngestResponse } from '../api/types'
import { Code } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { OnboardModal } from '../components/OnboardModal'
import { EmptyState, PageHeader, TBody, TD, TH, THead, TR, Table } from '../components/ui'
import { useToast } from '../components/ui'
import { FOCUS_SEARCH_EVENT } from '../hooks/useKeyboardShortcuts'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'

type LogTab = 'normalized' | 'index-detail' | 'inspection' | 'failed'

const TABS: { key: LogTab; label: string }[] = [
  { key: 'normalized', label: 'Normalized' },
  { key: 'index-detail', label: 'Index Detail' },
  { key: 'inspection', label: 'Telemetry Inspection' },
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

function matchesId(e: EventSummary, q: string): boolean {
  if (!/^\d+$/.test(q)) return false
  const stripped = q.replace(/^0+/, '')
  if (stripped === '') return padId(e.id).includes(q)
  return String(e.id).includes(stripped) || padId(e.id).includes(q)
}

function formatLabel(fmt: string | null): string {
  return fmt ?? 'unknown'
}

function IngestPanel({ onDone }: { onDone: (id: number) => void }) {
  const connections = useAsync(() => listConnections(), [])
  const [raw, setRaw] = useState('')
  const [source, setSource] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResponse | null>(null)
  const { toast } = useToast()

  async function submit() {
    if (!raw.trim()) {
      setError('Paste logs or drop a file first')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await ingest({ raw, source: source || undefined })
      setResult(res)
      toast(
        res.duplicate
          ? `Duplicate — already stored as event #${res.stored_event_id}`
          : `Ingested as event #${res.stored_event_id} (${res.status})`,
        res.status === 'quarantined' || res.status === 'dlq' ? 'info' : 'success',
      )
      onDone(res.stored_event_id)
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRaw(String(reader.result ?? ''))
    reader.onerror = () => setError('Could not read file')
    reader.readAsText(file)
  }

  return (
    <div className="mb-6 animate-slide-up surface-panel rounded-2xl p-5">
      <h3 className="mb-2 text-label-lg font-bold uppercase tracking-wide text-on-surface">Instant Ingestion Portal</h3>
      <p className="mb-4 max-w-3xl text-body-sm text-on-surface-variant">
        Submit raw telemetry. The system autonomously attempts structural normalization using the global context. Unrecognized signatures will be flagged for review.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="input-glass px-3 py-1.5 text-body-sm text-on-surface"
        >
          <option value="">Auto-detect origin…</option>
          {(connections.data ?? []).map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="btn-secondary cursor-pointer px-3 py-1.5 text-body-sm">
          Upload Context (File)
          <input
            type="file"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      </div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={5}
        placeholder="<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
        className="input-glass w-full px-3 py-2 font-mono text-mono-sm text-on-surface"
      />
      {error && <p className="mt-2 font-medium text-body-sm text-error">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !raw.trim()}
          className="btn-primary"
        >
          {busy ? 'Processing Data…' : 'Execute Ingest'}
        </button>
        {result && (
          <span className="flex items-center gap-2 surface-inset rounded px-2 py-1 text-body-sm">
            <StatusBadge status={result.status} />
            <span className="font-mono text-on-surface-variant">
              EVT-{result.stored_event_id}
              {result.duplicate ? ' · DUPLICATE' : ''}
            </span>
          </span>
        )}
      </div>
    </div>
  )
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
            <Code value={detail.views.raw} />
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {detail.views.parsed && (
          <details className="group">
            <summary className="cursor-pointer select-none text-body-sm font-semibold text-on-surface-variant transition-colors group-open:text-on-surface">
              <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Structural AST (Parsed)
            </summary>
            <div className="mt-2 border-l border-outline-variant pl-4">
              <Code value={detail.views.parsed} />
            </div>
          </details>
        )}

        {detail.views.output && (
          <details className="group">
            <summary className="cursor-pointer select-none text-body-sm font-semibold text-on-surface-variant transition-colors group-open:text-on-surface">
              <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Delivery Payload (Output)
            </summary>
            <div className="mt-2 border-l border-outline-variant pl-4">
              <Code value={detail.views.output} />
            </div>
          </details>
        )}

        {detail.provenance && (
          <details className="group lg:col-span-2">
            <summary className="cursor-pointer select-none text-body-sm font-semibold text-on-surface-variant transition-colors group-open:text-on-surface">
              <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Provenance History
            </summary>
            <div className="mt-2 border-l border-outline-variant pl-4">
              <Code value={detail.provenance} />
            </div>
          </details>
        )}
      </div>

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
  format: string
  source: string | null
  ids: number[]
  repId: number
}

function InspectionCard({
  group,
  rep,
  issue,
  hasMapping,
  busy,
  onApprove,
  onPurge,
}: {
  group: QuarantineGroup
  rep: EventDetail | null
  issue: string
  hasMapping: boolean
  busy: boolean
  onApprove: () => void
  onPurge: () => void
}) {
  return (
    <div className="animate-slide-up glass-card rounded-xl p-5 border-l-4 border-warning">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="surface-inset rounded px-2 py-0.5 font-mono text-body-sm font-bold uppercase tracking-wider text-warning border border-warning/20">
          {group.format}
        </span>
        <span className="text-body-md font-medium text-on-surface">{group.source ?? 'Unassigned origin'}</span>
        <span className="surface-inset rounded-full border border-outline-variant/50 px-2.5 py-0.5 font-mono text-body-sm text-on-surface-variant">
          × {group.ids.length} like this
        </span>
        <span className="ml-auto flex gap-2">
          <button
            onClick={onApprove}
            disabled={busy}
            title={hasMapping ? 'Retry all with the existing mapping' : 'Establish a mapping, then normalize all'}
            className="btn-primary text-label-sm"
          >
            {busy ? 'Working…' : `Approve all (${group.ids.length})`}
          </button>
          <button
            onClick={onPurge}
            disabled={busy}
            title="Delete every log of this type"
            className="btn-text text-error text-label-sm"
          >
            Purge all
          </button>
        </span>
      </div>
      <p className="mb-2 text-body-sm text-on-surface-variant">
        <span className="font-semibold uppercase tracking-wider text-warning/80">Issue — </span>
        {issue}
      </p>
      <div className="surface-inset rounded-xl p-3">
        {rep ? (
          <Code value={rep.views.raw} />
        ) : (
          <p className="font-mono text-mono-sm text-on-surface-variant/50">Loading representative log…</p>
        )}
      </div>
    </div>
  )
}

function IndexExport() {
  const { toast } = useToast()
  const [downloading, setDownloading] = useState<string | null>(null)

  async function download(format: 'json' | 'ndjson' | 'csv') {
    setDownloading(format)
    try {
      const res = await exportLogs({ format, status: 'normalized,output' })
      toast(`Downloaded ${res.total} logs (${res.normalized} normalized)`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 surface-panel rounded-xl px-4 py-3">
      <span className="text-label-sm font-bold uppercase tracking-[0.14em] text-on-surface-variant">
        Download all normalized
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
    </div>
  )
}

export default function Logs({ sourceFilter }: { sourceFilter?: string }) {
  const [tab, setTab] = useState<LogTab>('normalized')
  const [ingesting, setIngesting] = useState(false)
  const [search, setSearch] = useState('')
  const [vendor, setVendor] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const vendors = useAsync(() => listConnections(), [])
  const source = sourceFilter ?? vendor
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
  const { toast } = useToast()

  useEffect(() => {
    if (tab === 'index-detail' && selected === null) setTab('normalized')
  }, [tab, selected])

  async function loadMore() {
    try {
      const more = await listEvents({ limit: 200, offset: all.length, ...(source ? { source } : {}) })
      if (more.length === 0) {
        toast('No older logs — you have the full history', 'info')
        return
      }
      const seen = new Set(all.map((e) => e.id))
      setExtra((prev) => [...prev, ...more.filter((e) => !seen.has(e.id))])
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }

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

  useLive({ source: source || undefined, onEvent: () => { events.reload(); unsourced.reload() } })

  useEffect(() => {
    const timer = setInterval(() => { events.reload(); unsourced.reload() }, 30000)
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

  const unsourced = useAsync(
    () =>
      sourceFilter
        ? listEvents({ status: 'quarantined', limit: 200 })
        : Promise.resolve([] as EventSummary[]),
    [sourceFilter],
  )
  const quarantined = [...all, ...(unsourced.data ?? []).filter((u) => u.source == null)]
    .filter((e, i, arr) => arr.findIndex((x) => x.id === e.id) === i)
    .filter((e) => e.status === 'quarantined')
    .filter(matchesSearch)
    .filter((e) => !scope || (e.source === scope.source && formatLabel(e.detected_format) === formatLabel(scope.detected_format)))

  const groups: QuarantineGroup[] = useMemo(() => {
    const byKey = new Map<string, QuarantineGroup>()
    for (const e of quarantined) {
      const format = formatLabel(e.detected_format)
      const key = `${format}::${e.source ?? ''}`
      const g = byKey.get(key)
      if (g) {
        g.ids.push(e.id)
      } else {
        byKey.set(key, { format, source: e.source, ids: [e.id], repId: e.id })
      }
    }
    return [...byKey.values()]
  }, [quarantined])

  const [reps, setReps] = useState<Record<string, EventDetail>>({})
  useEffect(() => {
    let cancelled = false
    const missing = groups.filter((g) => reps[`${g.format}::${g.source ?? ''}`] === undefined)
    if (missing.length === 0) return
    Promise.all(missing.map((g) => getEvent(g.repId).catch(() => null))).then((details) => {
      if (cancelled) return
      setReps((prev) => {
        const next = { ...prev }
        missing.forEach((g, i) => {
          if (details[i]) next[`${g.format}::${g.source ?? ''}`] = details[i] as EventDetail
        })
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [groups, reps])

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

  async function approveGroup(group: QuarantineGroup) {
    const key = `${group.format}::${group.source ?? ''}`
    if (!mappingFor(group.source)) {
      setOnboarding(group)
      return
    }
    setGroupBusy(key)
    try {
      const res = await batchRetryEvents(group.ids)
      toast(
        res.retried.length > 0
          ? `Approved — ${res.retried.length} normalized${res.skipped && Object.keys(res.skipped).length > 0 ? ` (${Object.keys(res.skipped).length} already resolved)` : ''}`
          : 'Nothing left to approve — all already resolved',
        'success',
      )
      events.reload()
      unsourced.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupBusy(null)
    }
  }

  async function approveAfterOnboard(group: QuarantineGroup) {
    const key = `${group.format}::${group.source ?? ''}`
    setOnboarding(null)
    setGroupBusy(key)
    try {
      const res = await batchRetryEvents(group.ids)
      toast(`Approved — ${res.retried.length} of ${group.ids.length} normalized`, 'success')
      mappings.reload()
      events.reload()
      unsourced.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupBusy(null)
    }
  }

  async function purgeGroup(group: QuarantineGroup) {
    if (!window.confirm(`Purge all ${group.ids.length} ${group.format} logs${group.source ? ` from ${group.source}` : ''}?`)) return
    const key = `${group.format}::${group.source ?? ''}`
    setGroupBusy(key)
    try {
      const res = await batchDeleteEvents(group.ids)
      toast(`Purged ${res.deleted.length} logs`, 'success')
      events.reload()
      unsourced.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setGroupBusy(null)
    }
  }

  const rows = all
    .filter((e: EventSummary) => matchesTab(e.status, tab))
    .filter(matchesSearch)
    .filter((e: EventSummary) => {
      if (!scope || tab === 'normalized' || tab === 'index-detail') return true
      return e.source === scope.source && formatLabel(e.detected_format) === formatLabel(scope.detected_format)
    })

  function selectIndex(e: EventSummary) {
    setSelected(e.id)
    setScope(e)
    setTab('index-detail')
  }

  const siblingCount = useMemo(() => {
    if (!scope) return 0
    return all.filter(
      (e) => e.source === scope.source && formatLabel(e.detected_format) === formatLabel(scope.detected_format),
    ).length
  }, [all, scope])

  const onboardingRep = onboarding ? reps[`${onboarding.format}::${onboarding.source ?? ''}`] : undefined

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
                  setIngesting(false)
                }}
                title={gated ? 'Click an index in Normalized first' : undefined}
                className={`rounded px-3 py-1.5 text-body-sm font-medium transition-all ${
                  gated
                    ? 'cursor-not-allowed border border-transparent text-on-surface-variant/40'
                    : tab === t.key && !ingesting
                    ? 'border border-primary/30 bg-primary-container/10 text-primary shadow-[0_0_10px_var(--color-primary)]'
                    : 'border border-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                {t.label}
              </button>
            )
          })}
          <div className="mx-2 h-5 w-px bg-outline-variant/50"></div>
          <button
            onClick={() => setIngesting(true)}
            className={`rounded px-3 py-1.5 text-body-sm font-bold tracking-wide transition-all ${
              ingesting
                ? 'bg-primary text-on-primary shadow-[0_0_10px_var(--color-primary)]'
                : 'border border-primary/30 text-primary hover:bg-primary-container/10'
            }`}
          >
            + Ingest Payload
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[1em] h-[1em] absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searching ? 'Searching full history…' : 'Search index, id, history…'}
              className="w-64 input-glass pr-10 text-body-sm text-on-surface"
            />
          </div>
          {!sourceFilter && (
            <select
              value={vendor}
              onChange={(e) => {
                setVendor(e.target.value)
                setExtra([])
                setSelected(null)
              }}
              title="Filter by node / connection"
              className="input-glass px-3 py-1.5 text-body-sm text-on-surface"
            >
              <option value="">Global context…</option>
              {(vendors.data ?? []).map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name} ({c.events_processed})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {events.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
      {events.error && <p className="text-body-md font-medium text-error">{events.error}</p>}

      {ingesting && (
        <IngestPanel
          onDone={(id) => {
            events.reload()
            unsourced.reload()
            setSelected(id)
          }}
        />
      )}

      {tab === 'inspection' && (
        <div className="mb-6 space-y-4">
          {scope && (
            <div className="flex items-center gap-3 surface-inset rounded-xl border border-primary/30 bg-primary-container/10 px-4 py-2 text-body-sm text-primary">
              <span>
                Scoped to index <span className="font-mono font-bold">{padId(scope.id)}</span>
                {' '}· {formatLabel(scope.detected_format)} · {scope.source ?? 'Unassigned origin'}
              </span>
              <button
                onClick={() => setScope(null)}
                className="ml-auto btn-text text-error text-label-sm"
              >
                Clear scope (inspection)
              </button>
            </div>
          )}
          {groups.length === 0 && !events.loading && (
            <EmptyState
              title="Nothing awaiting inspection"
              description={scope ? 'No quarantined logs of the scoped type.' : 'Quarantined logs will appear here grouped by type.'}
            />
          )}
          {groups.map((g) => {
            const key = `${g.format}::${g.source ?? ''}`
            return (
              <InspectionCard
                key={key}
                group={g}
                rep={reps[key] ?? null}
                issue={issueFor(g)}
                hasMapping={mappingFor(g.source)}
                busy={groupBusy === key}
                onApprove={() => approveGroup(g)}
                onPurge={() => purgeGroup(g)}
              />
            )
          })}
        </div>
      )}

      {tab !== 'inspection' && tab !== 'index-detail' && !events.loading && !events.error && rows.length === 0 && (
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
              <IndexExport />
              <Detail
                detail={detail.data}
                siblingCount={siblingCount}
                onChanged={() => {
                  events.reload()
                  unsourced.reload()
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

      {(tab === 'normalized' || tab === 'failed') && rows.length > 0 && (
        <div className="data-scroll-region mt-2 surface-panel rounded-xl p-[1px]">
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
              {rows.map((e) => (
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

      {(tab === 'normalized' || tab === 'failed') && rows.length >= 200 && (
        <div className="mt-8 border-t border-outline-variant/50 pt-5 text-center">
          <button
            onClick={loadMore}
            className="btn-secondary text-label-sm"
          >
            Execute Paginate ({all.length} Indexed)
          </button>
        </div>
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