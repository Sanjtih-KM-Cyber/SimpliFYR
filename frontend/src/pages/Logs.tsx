import { useEffect, useRef, useState } from 'react'
import { deleteEvent, exportLogs, getEvent, ingest, listConnections, listEvents, retryEvent } from '../api/client'
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

type LogTab = 'all' | 'normalized' | 'review' | 'failed'

const TABS: { key: LogTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'normalized', label: 'Normalized' },
  { key: 'review', label: 'Needs Review' },
  { key: 'failed', label: 'Failed' },
]

const TAB_STATUSES: Record<LogTab, EventStatus[] | null> = {
  all: null,
  normalized: ['normalized', 'output'],
  review: ['quarantined'],
  failed: ['dlq'],
}

function matchesTab(status: EventStatus, tab: LogTab): boolean {
  const statuses = TAB_STATUSES[tab]
  return statuses === null || statuses.includes(status)
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
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
      // Connection select drives the recipe: known sources process
      // automatically, unknown ones quarantine for review.
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
    <div className="mb-6 rounded-lg border border-emerald-900 bg-slate-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-white">Instant ingest</h3>
      <p className="mb-3 text-xs text-slate-500">
        Drop logs, pick the connection they belong to, and they process immediately —
        known sources normalize via their recipe, unknown ones quarantine for review.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
        >
          <option value="">No connection (detect only)…</option>
          {(connections.data ?? []).map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="cursor-pointer rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
          Drop a file…
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
        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
      />
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !raw.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Ingesting…' : 'Ingest now'}
        </button>
        {result && (
          <span className="flex items-center gap-2 text-sm">
            <StatusBadge status={result.status} />
            <span className="text-slate-400">
              event #{result.stored_event_id}
              {result.duplicate ? ' · duplicate' : ''}
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

function Detail({ detail, onChanged, onDeleted }: { detail: EventDetail; onChanged: () => void; onDeleted: () => void }) {
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
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-medium text-white">
          Event #{detail.id} <span className="font-mono text-slate-500">{detail.event_id}</span>
        </h4>
        <StatusBadge status={detail.status} />
      </div>

      {actionable && (
        <div className="mb-3 flex flex-wrap gap-2">
          {detail.status === 'quarantined' && (
            <button
              onClick={() => setOnboarding(true)}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Onboard — new mapping / version / vendor
            </button>
          )}
          <button
            onClick={() => run('retry')}
            disabled={busy !== null}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'retry' ? '…' : 'Retry'}
          </button>
          <button
            onClick={() => run('delete')}
            disabled={busy !== null}
            className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50 disabled:opacity-50"
          >
            {busy === 'delete' ? '…' : 'Delete'}
          </button>
        </div>
      )}
      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h4 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Original</h4>
          <Code value={detail.views.raw} />
        </section>
        <section>
          <h4 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Normalized</h4>
          {detail.views.normalized ? (
            <Code value={detail.views.normalized} />
          ) : (
            <p className="rounded-md border border-amber-800 bg-amber-950/40 p-3 text-xs text-amber-200">
              Not normalized yet — this event needs review.
            </p>
          )}
        </section>
      </div>

      {detail.views.parsed && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-300">Parsed</summary>
          <div className="mt-2">
            <Code value={detail.views.parsed} />
          </div>
        </details>
      )}

      {detail.views.output && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-slate-300">Output</summary>
          <div className="mt-2">
            <Code value={detail.views.output} />
          </div>
        </details>
      )}

      {detail.provenance && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-slate-300">
            Provenance
          </summary>
          <div className="mt-2">
            <Code value={detail.provenance} />
          </div>
        </details>
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

export default function Logs() {
  const [tab, setTab] = useState<LogTab>('all')
  const [ingesting, setIngesting] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const events = useAsync(() => listEvents({ limit: 200 }), [])
  const [selected, setSelected] = useState<number | null>(null)
  const detail = useAsync(
    () => (selected ? getEvent(selected) : Promise.resolve(null)),
    [selected],
  )
  const { toast } = useToast()

  const [downloading, setDownloading] = useState(false)

  async function download(format: 'json' | 'ndjson' | 'csv') {
    setDownloading(true)
    try {
      const statuses = TAB_STATUSES[tab]
      await exportLogs({ format, status: statuses ? statuses.join(',') : undefined })
      toast(`Downloaded logs (${format.toUpperCase()})`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    const focus = () => searchRef.current?.focus()
    window.addEventListener(FOCUS_SEARCH_EVENT, focus)
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, focus)
  }, [])

  useLive({ onEvent: () => events.reload() })

  useEffect(() => {
    const timer = setInterval(() => events.reload(), 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const all = events.data ?? []
  const rows = all
    .filter((e: EventSummary) => matchesTab(e.status, tab))
    .filter((e: EventSummary) => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      return (
        e.event_id.toLowerCase().includes(q) ||
        (e.source_id !== null && String(e.source_id).includes(q))
      )
    })

  return (
    <div>
      <PageHeader
        title="Logs"
        subtitle="The unified output of Simplifyr — search, filter, and inspect every event."
        actions={
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
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key)
                setIngesting(false)
              }}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === t.key && !ingesting
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={() => setIngesting(true)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              ingesting
                ? 'bg-emerald-700 text-white'
                : 'text-emerald-400 hover:bg-slate-800 hover:text-emerald-300'
            }`}
          >
            + Ingest
          </button>
        </div>
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search… (press / to focus)"
          className="w-64 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
        />
      </div>

      {events.loading && <Spinner />}
      {events.error && <p className="text-sm text-red-400">{events.error}</p>}

      {ingesting && (
        <IngestPanel
          onDone={(id) => {
            events.reload()
            setSelected(id)
          }}
        />
      )}

      {!events.loading && !events.error && rows.length === 0 && (
        <EmptyState
          title={all.length === 0 ? 'No logs yet' : 'No logs match'}
          description={
            all.length === 0
              ? 'Ingest or connect live logs and they will appear here.'
              : 'Try a different filter or search term.'
          }
        />
      )}

      {rows.length > 0 && (
        <Table>
          <THead>
            <TR>
              <TH>ID</TH>
              <TH>Status</TH>
              <TH>Received</TH>
              <TH>Event ID</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((e) => (
              <TR key={e.id} onClick={() => setSelected(e.id)}>
                <TD className={selected === e.id ? 'font-semibold text-white' : 'text-slate-200'}>
                  {e.id}
                </TD>
                <TD>
                  <StatusBadge status={e.status} />
                </TD>
                <TD className="text-slate-400">{formatTime(e.received_at)}</TD>
                <TD className="font-mono text-xs text-slate-500">{e.event_id.slice(0, 8)}…</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {selected && detail.data && (
        <Detail
          detail={detail.data}
          onChanged={() => {
            events.reload()
            detail.reload()
          }}
          onDeleted={() => setSelected(null)}
        />
      )}
      {selected && detail.loading && <Spinner />}
    </div>
  )
}
