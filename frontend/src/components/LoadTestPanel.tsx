import { useState } from 'react'
import { Link } from 'react-router-dom'
import { exportLogs, listConnections, listMappings, processBatch, suggestEventMapping } from '../api/client'
import type { BatchResult, Mapping } from '../api/types'
import { latestMappings } from '../api/types'
import { useAsync } from '../hooks/useAsync'
import { ErrorBanner } from './Status'
import { useToast } from './ui'

const SAMPLE = `<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:45 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:46 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:47 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:48 fw01 srcip=10.1.1.5 action=deny`

export const LOADTEST_SAMPLE_KEY = 'simplifyr.loadtest.sample'

/** Throughput probe: paste a batch, measure speed, then adopt or download.
 *
 * After a run the batch is either already covered by a mapping (auto-
 * normalized — just download the set) or new (adopt it into the Add
 * Connection wizard as a new mapping draft, or download and walk away). */
export function LoadTestPanel() {
  const { toast } = useToast()
  const mappings = useAsync(() => listMappings(), [])
  const connections = useAsync(() => listConnections(), [])
  const [batch, setBatch] = useState(SAMPLE)
  const [source, setSource] = useState('')
  const [mappingId, setMappingId] = useState<number | ''>('')
  const [result, setResult] = useState<BatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const chosen = latestMappings(mappings.data ?? []).find((m) => m.id === mappingId) ?? null

  interface Filing {
    mapping: Mapping
    coverage: number
    minConfidence: number
  }
  const [filing, setFiling] = useState<Filing | null>(null)
  const [filingBusy, setFilingBusy] = useState(false)

  /** Ask the AI where a quarantined trial fits: suggest fields for the first
   *  quarantined row, then score every mapping by same input→semantic cover.
   *  Very-high-confidence single winner => one-click file the whole set. */
  async function findFiling() {
    if (!result) return
    const rep = (result.results ?? []).find(
      (r) => r.status === 'quarantined' && r.stored_event_id != null,
    )
    if (!rep?.stored_event_id) {
      setError('No quarantined rows with stored events to inspect')
      return
    }
    setFilingBusy(true)
    setFiling(null)
    setError(null)
    try {
      const sug = await suggestEventMapping(rep.stored_event_id)
      const named = sug.filter((s) => s.input_field.trim() && s.semantic_field.trim())
      if (named.length === 0) {
        setError('AI could not name these fields — adopt as a new mapping instead')
        return
      }
      const minConf = Math.min(...named.map((s) => s.confidence))
      let best: Mapping | null = null
      let bestCover = 0
      for (const m of latestMappings(mappings.data ?? [])) {
        const known = new Map(m.fields.map((f) => [f.input_field, f.semantic_field]))
        const covered = named.filter((s) => known.get(s.input_field) === s.semantic_field).length
        const cover = covered / named.length
        if (cover > bestCover) {
          bestCover = cover
          best = m
        }
      }
      if (!best || bestCover < 0.9 || minConf < 0.8) {
        setError(
          best
            ? `Closest is ${best.name} at ${Math.round(bestCover * 100)}% — below the auto-file bar, adopt or correct it instead`
            : 'No existing mapping covers these fields — adopt as a new mapping instead',
        )
        return
      }
      setFiling({ mapping: best, coverage: bestCover, minConfidence: minConf })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFilingBusy(false)
    }
  }

  async function fileUnder() {
    if (!filing || !result) return
    const count = result.quarantined
    setBusy(true)
    setError(null)
    try {
      setResult(
        await processBatch({
          raw: batch,
          ...(filing.mapping.source ? { source: filing.mapping.source } : {}),
          mappingId: filing.mapping.id,
        }),
      )
      toast(`Filed ${count} lines under ${filing.mapping.name}`, 'success')
      setFiling(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function runLoadTest() {
    setBusy(true)
    setError(null)
    setFiling(null)
    try {
      setResult(
        await processBatch({
          raw: batch,
          ...(source ? { source } : {}),
          ...(mappingId === '' ? {} : { mappingId }),
        }),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function downloadSet() {
    if (!result) return
    // Exactly this trial's rows — never the global pile.
    const ids = (result.results ?? [])
      .filter((r) => (r.status === 'normalized' || r.status === 'output') && r.stored_event_id != null)
      .map((r) => r.stored_event_id as number)
    if (ids.length === 0) {
      toast('This trial produced no normalized rows to download', 'info')
      return
    }
    setDownloading(true)
    try {
      const res = await exportLogs({ format: 'json', ids })
      toast(`Downloaded this trial's ${res.total} logs (${res.normalized} normalized)`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  async function downloadAll() {
    setDownloading(true)
    try {
      const res = await exportLogs({ format: 'json', status: 'normalized,output' })
      toast(`Downloaded all ${res.total} logs (${res.normalized} normalized)`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  function adoptAsMapping() {
    try {
      sessionStorage.setItem(LOADTEST_SAMPLE_KEY, batch)
    } catch {
      /* storage unavailable — wizard still opens with its default sample */
    }
  }

  return (
    <section className="glass-card rounded-2xl p-5">
      <h3 className="mb-2 text-sm font-medium text-white">Trial Run</h3>
      <p className="mb-2 text-xs text-slate-500">
        Process a batch of events (one per line) and measure throughput. Pick
        the connection and its mapping auto-resolves — matching lines
        normalize; new shapes can be adopted as a mapping or downloaded.
      </p>
      <textarea
        value={batch}
        onChange={(e) => setBatch(e.target.value)}
        rows={5}
        className="input-glass w-full px-3.5 py-2.5 font-mono text-xs text-slate-200"
      />
      {error && <ErrorBanner message={error} />}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={runLoadTest}
          disabled={busy}
          className="btn-glass bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(16,185,129,0.9)] hover:bg-emerald-400"
        >
          {busy ? 'Running…' : 'Run trial'}
        </button>
        <select
          value={mappingId}
          onChange={(e) => setMappingId(e.target.value === '' ? '' : Number(e.target.value))}
          title="Run the batch through an existing mapping"
          className="input-glass px-3 py-2.5 text-xs text-slate-200"
        >
          <option value="">Auto-resolve mapping…</option>
          {latestMappings(mappings.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.source ?? 'global'} · {m.status} (v{m.version})
            </option>
          ))}
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          title="Attribute the batch to a connection (its mapping auto-resolves)"
          className="input-glass px-3 py-2.5 text-xs text-slate-200"
        >
          <option value="">No source (unassigned)…</option>
          {(connections.data ?? []).map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {chosen && (
        <p className="mt-2 text-xs text-slate-500">
          Running through <span className="font-semibold text-slate-300">{chosen.name}</span> — lines it
          covers normalize; the rest quarantines for adoption below.
        </p>
      )}
      {result && (
        <div className="surface-inset mt-3 rounded-xl p-3.5 text-xs text-slate-300">
          <p>
            Processed <span className="font-semibold text-white">{result.processed}</span> events
            ({result.normalized} normalized · {result.output} output · {result.quarantined}{' '}
            quarantined · {result.dlq} dlq · {result.failed} failed)
          </p>
          <p className="mt-1">
            <span className="font-semibold text-white">{result.events_per_second}</span> events/sec ·{' '}
            <span className="font-semibold text-white">{result.avg_latency_ms}</span> ms avg latency ·{' '}
            {result.duration_seconds}s
          </p>
          {result.normalized + result.output > 0 && (
            <p className="mt-1 text-emerald-400">
              {result.normalized + result.output} lines matched an existing mapping — auto-normalized.
            </p>
          )}
          {result.quarantined > 0 && (
            <p className="mt-1 text-amber-400">
              {result.quarantined} lines are new — adopt them as a mapping or download the set.
            </p>
          )}
          {result.quarantined > 0 && !filing && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={findFiling}
                disabled={filingBusy || busy}
                className="rounded border border-cyan-900/50 px-4 py-1.5 text-[12px] font-semibold text-cyan-400 transition-colors hover:bg-cyan-950/20 disabled:opacity-50"
              >
                {filingBusy ? 'Asking AI…' : 'AI: find its mapping'}
              </button>
            </div>
          )}
          {filing && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2">
              <span className="text-[12px] text-slate-300">
                AI match: <span className="font-semibold text-white">{filing.mapping.name}</span>{' '}
                <span className="font-mono text-emerald-400">
                  {Math.round(filing.coverage * 100)}% cover · {Math.round(filing.minConfidence * 100)}% conf
                </span>
              </span>
              <button
                onClick={fileUnder}
                disabled={busy}
                className="rounded bg-emerald-600 px-4 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                File all under it
              </button>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {result.quarantined > 0 && (
              <Link
                to="/connections/new"
                onClick={adoptAsMapping}
                className="rounded bg-cyan-600 px-4 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-cyan-500"
              >
                Adopt as new mapping
              </Link>
            )}
            <button
              onClick={downloadSet}
              disabled={downloading}
              className="rounded border border-slate-700 px-4 py-1.5 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {downloading ? 'Bundling…' : 'Download this trial set'}
            </button>
            <button
              onClick={downloadAll}
              disabled={downloading}
              title="Every normalized log in the system, uncapped"
              className="rounded border border-slate-700 px-4 py-1.5 text-[12px] font-semibold text-slate-300 transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              Download all logs
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
