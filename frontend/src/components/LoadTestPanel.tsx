import { useState } from 'react'
import { Link } from 'react-router-dom'
import { exportLogs, listMappings, processBatch } from '../api/client'
import type { BatchResult } from '../api/types'
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
  const [batch, setBatch] = useState(SAMPLE)
  const [mappingId, setMappingId] = useState<number | ''>('')
  const [result, setResult] = useState<BatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const chosen = latestMappings(mappings.data ?? []).find((m) => m.id === mappingId) ?? null

  async function runLoadTest() {
    setBusy(true)
    setError(null)
    try {
      setResult(
        await processBatch({ raw: batch, ...(mappingId === '' ? {} : { mappingId }) }),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function downloadSet() {
    setDownloading(true)
    try {
      await exportLogs({ format: 'json', status: 'normalized,output' })
      toast('Downloaded normalized set (JSON)', 'success')
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
        Process a batch of events (one per line) and measure throughput. Matching
        lines auto-normalize through existing mappings; new shapes can be adopted
        as a mapping or downloaded.
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
              {downloading ? 'Bundling…' : 'Download normalized set'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
