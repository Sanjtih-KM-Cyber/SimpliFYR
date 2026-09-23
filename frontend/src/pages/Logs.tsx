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
    <div className="mb-6 animate-slide-up rounded-lg border border-slate-700/50 bg-slate-900/40 p-4 shadow-xl backdrop-blur-sm">
      <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wide text-white">Instant Ingestion Portal</h3>
      <p className="mb-4 max-w-3xl text-[12px] text-slate-400">
        Submit raw telemetry. The system autonomously attempts structural normalization using the global context. Unrecognized signatures will be flagged for review.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-[13px] text-slate-200 outline-none transition-colors focus:border-cyan-500/50"
        >
          <option value="">Auto-detect origin…</option>
          {(connections.data ?? []).map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="cursor-pointer rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-[13px] font-medium text-slate-300 transition-colors hover:bg-slate-800">
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
        className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-300 outline-none transition-colors placeholder:text-slate-700 focus:border-cyan-500/50"
      />
      {error && <p className="mt-2 font-medium text-[12px] text-rose-400">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy || !raw.trim()}
          className="rounded bg-cyan-600 px-5 py-1.5 text-[13px] font-bold tracking-wide text-white shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all hover:bg-cyan-500 hover:shadow-[0_0_15px_rgba(6,182,212,0.5)] disabled:shadow-none disabled:opacity-50"
        >
          {busy ? 'Processing Data…' : 'Execute Ingest'}
        </button>
        {result && (
          <span className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/80 px-2 py-1 text-[12px]">
            <StatusBadge status={result.status} />
            <span className="font-mono text-slate-400">
              EVT-{result.stored_event_id}
              {result.duplicate ? ' · DUPLICATE' : ''}
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

  function downloadSingle() {
    const payload = detail.output ?? detail.normalized
    if (!payload) return
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `simplifyr-event-${detail.id}-normalized.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    toast(`Downloaded normalized log for event #${detail.id}`, 'success')
  }

  return (
    <div className="mt-4 animate-slide-up rounded-lg border border-slate-700/50 glass-card p-5">
      <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-3">
        <h4 className="flex items-center gap-2 text-[14px] font-bold text-white">
          Telemetry Inspection
          <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[11px] text-cyan-500">{detail.event_id}</span>
        </h4>
        <span className="flex items-center gap-3">
          <StatusBadge status={detail.status} />
          {(detail.output || detail.normalized) && (
            <button
              onClick={downloadSingle}
              title="Download the normalized log (JSON)"
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-400 transition-colors hover:bg-slate-700 hover:text-cyan-300"
            >
              Export JSON
            </button>
          )}
        </span>
      </div>

      {actionable && (
        <div className="mb-4 flex flex-wrap gap-2 border-b border-amber-900/30 pb-4 pt-1">
          <div className="mb-1 w-full font-mono text-[11px] uppercase tracking-widest text-amber-500/80">Action Required</div>
          {detail.status === 'quarantined' && (
            <button
              onClick={() => setOnboarding(true)}
              className="rounded bg-cyan-600 px-4 py-1.5 text-[12px] font-bold text-white shadow-[0_0_10px_rgba(6,182,212,0.2)] transition-colors hover:bg-cyan-500"
            >
              Establish Mapping (Onboard)
            </button>
          )}
          <button
            onClick={() => run('retry')}
            disabled={busy !== null}
            className="rounded border border-slate-700 px-4 py-1.5 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'retry' ? 'Re-executing…' : 'Re-execute'}
          </button>
          <button
            onClick={() => run('delete')}
            disabled={busy !== null}
            className="rounded border border-rose-900/50 bg-rose-950/20 px-4 py-1.5 text-[12px] font-semibold text-rose-400 transition-colors hover:bg-rose-900/50 disabled:opacity-50"
          >
            {busy === 'delete' ? 'Purging…' : 'Purge'}
          </button>
        </div>
      )}
      {error && <p className="mb-3 text-[12px] font-medium text-rose-400">{error}</p>}

      <div className="grid gap-1 overflow-hidden rounded border border-slate-700/50 bg-slate-950 lg:grid-cols-2">
        <section className="bg-slate-900 p-3">
          <div className="max-w-max mb-3 flex items-center gap-2 border-b border-slate-700/50 pb-1">
            <div className="h-1.5 w-1.5 rounded-full bg-slate-500"></div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Original Telemetry</h4>
          </div>
          <div className="opacity-90">
            <Code value={detail.views.raw} />
          </div>
        </section>
        <section className="mt-1 bg-slate-900 p-3 lg:mt-0 lg:border-l lg:border-slate-700/50">
          <div className="max-w-max relative mb-3 flex items-center gap-2 border-b border-cyan-900/50 pb-1">
            <div className="h-1.5 w-1.5 rounded-full bg-cyan-500 shadow-[0_0_5px_rgba(6,182,212,0.8)]"></div>
            <h4 className="relative text-[10px] font-bold uppercase tracking-widest text-cyan-500">Normalized Context</h4>
          </div>
          {detail.views.normalized ? (
            <Code value={detail.views.normalized} />
          ) : (
            <div className="relative flex min-h-[100px] h-full items-center justify-center overflow-hidden rounded border border-amber-900/50 bg-amber-950/20 p-4">
              <div className="absolute left-0 top-0 h-[1px] w-full bg-amber-500/20"></div>
              <p className="text-center font-mono text-[11px] uppercase tracking-widest text-amber-500/80">
                Unstructured Data
                <br />
                <span className="text-[10px] text-amber-600/70">Awaiting schema resolution</span>
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {detail.views.parsed && (
          <details className="group">
            <summary className="cursor-pointer select-none text-[12px] font-semibold text-slate-400 transition-colors group-open:text-slate-300">
              <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Structural AST (Parsed)
            </summary>
            <div className="mt-2 border-l border-slate-800 pl-4">
              <Code value={detail.views.parsed} />
            </div>
          </details>
        )}

        {detail.views.output && (
          <details className="group">
            <summary className="cursor-pointer select-none text-[12px] font-semibold text-slate-400 transition-colors group-open:text-slate-300">
              <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Delivery Payload (Output)
            </summary>
            <div className="mt-2 border-l border-slate-800 pl-4">
              <Code value={detail.views.output} />
            </div>
          </details>
        )}

        {detail.provenance && (
          <details className="group lg:col-span-2">
            <summary className="cursor-pointer select-none text-[12px] font-semibold text-slate-400 transition-colors group-open:text-slate-300">
              <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Provenance History
            </summary>
            <div className="mt-2 border-l border-slate-800 pl-4">
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

export default function Logs() {
  const [tab, setTab] = useState<LogTab>('all')
  const [ingesting, setIngesting] = useState(false)
  const [search, setSearch] = useState('')
  const [vendor, setVendor] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const vendors = useAsync(() => listConnections(), [])
  const events = useAsync(() => listEvents({ limit: 200, ...(vendor ? { source: vendor } : {}) }), [vendor])
  const [extra, setExtra] = useState<EventSummary[]>([])
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
      await exportLogs({
        format,
        status: statuses ? statuses.join(',') : undefined,
        source: vendor || undefined,
      })
      toast(`Downloaded logs (${format.toUpperCase()})`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  async function loadMore() {
    try {
      const more = await listEvents({ limit: 200, offset: all.length, ...(vendor ? { source: vendor } : {}) })
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

  useLive({ onEvent: () => events.reload() })

  useEffect(() => {
    const timer = setInterval(() => events.reload(), 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const all = [...(events.data ?? []), ...extra]
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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Telemetry Data"
        subtitle="The unified indexing interface — query, inspect, and trace live stream payloads."
        actions={
          <select
            value=""
            disabled={downloading}
            onChange={(e) => {
              if (e.target.value) download(e.target.value as 'json' | 'ndjson' | 'csv')
              e.target.value = ''
            }}
            className="rounded border border-slate-700 bg-slate-900 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-slate-300 outline-none disabled:opacity-50"
          >
            <option value="">{downloading ? 'Bundling…' : 'Export Logs…'}</option>
            <option value="json">JSON format</option>
            <option value="ndjson">NDJSON format</option>
            <option value="csv">CSV format</option>
          </select>
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/50 pb-4">
        <div className="flex items-center gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setTab(t.key)
                setIngesting(false)
              }}
              className={`rounded px-3 py-1.5 text-[13px] font-medium transition-all ${tab === t.key && !ingesting
                  ? 'border border-slate-700 bg-slate-800 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.15)]'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
            >
              {t.label}
            </button>
          ))}
          <div className="mx-2 h-5 w-px bg-slate-800"></div>
          <button
            onClick={() => setIngesting(true)}
            className={`rounded px-3 py-1.5 text-[13px] font-bold tracking-wide transition-all ${ingesting
                ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                : 'border border-cyan-900/50 text-cyan-500 hover:bg-cyan-950/20'
              }`}
          >
            + Ingest Payload
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-[1em] h-[1em] absolute left-3 top-1/2 w-6 -translate-y-1/2 border-r border-slate-700 pr-1 text-slate-500"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Query payload... ( / )"
              className="w-64 rounded border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-[13px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-cyan-500/50"
            />
          </div>
          <select
            value={vendor}
            onChange={(e) => {
              setVendor(e.target.value)
              setExtra([])
              setSelected(null)
            }}
            title="Filter by node / connection"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-[13px] text-slate-300 outline-none focus:border-cyan-500/50"
          >
            <option value="">Global context…</option>
            {(vendors.data ?? []).map((c) => (
              <option key={c.id} value={c.name}>
                {c.name} ({c.events_processed})
              </option>
            ))}
          </select>
        </div>
      </div>

      {events.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
      {events.error && <p className="text-[13px] font-medium text-rose-400">{events.error}</p>}

      {ingesting && (
        <IngestPanel
          onDone={(id) => {
            events.reload()
            setSelected(id)
          }}
        />
      )}

      {!events.loading && !events.error && rows.length === 0 && (
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

      {rows.length > 0 && (
        <div className="glass-panel mt-2 rounded-lg p-[1px]">
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
                <TR key={e.id} onClick={() => setSelected(e.id)}>
                  <TD className={selected === e.id ? 'bg-cyan-950/20 font-bold text-cyan-400' : 'text-slate-300'}>
                    {(e.id).toString().padStart(6, '0')}
                  </TD>
                  <TD className={selected === e.id ? 'bg-cyan-950/20' : ''}>
                    <StatusBadge status={e.status} />
                  </TD>
                  <TD className={`text-slate-400 ${selected === e.id ? 'bg-cyan-950/20' : ''}`}>{formatTime(e.received_at)}</TD>
                  <TD className={`font-mono text-[11px] text-slate-500 ${selected === e.id ? 'bg-cyan-950/20 text-cyan-600/70' : ''}`}>{e.event_id}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
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

      {rows.length >= 200 && (
        <div className="mt-8 border-t border-slate-800/50 pt-5 text-center">
          <button
            onClick={loadMore}
            className="rounded border border-slate-700 bg-slate-900 px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Execute Paginate ({all.length} Indexed)
          </button>
        </div>
      )}
      {selected && detail.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
    </div>
  )
}
