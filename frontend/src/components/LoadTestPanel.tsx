import { useState } from 'react'
import { Link } from 'react-router-dom'
import { exportLogs, listConnections, listMappings, processBatch, suggestEventMapping } from '../api/client'
import type { BatchResult, Mapping } from '../api/types'
import { latestMappings } from '../api/types'
import { useAsync } from '../hooks/useAsync'
import { ErrorBanner } from './Status'
import { useToast } from './ui'
import { Spinner } from './Spinner'
import { Dropdown } from './Dropdown'

const SAMPLE = `<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:45 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:46 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:47 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:48 fw01 srcip=10.1.1.5 action=deny`

export const LOADTEST_SAMPLE_KEY = 'simplifyr.loadtest.sample'

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
    <section className="surface-panel rounded-2xl p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant/70">
        Event processing
      </p>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        Process a batch of events and measure throughput.
      </p>
      <label
        htmlFor="trial-input"
        className="mb-1.5 mt-4 block text-label-sm font-medium text-on-surface-variant"
      >
        Input
      </label>
      <textarea
        id="trial-input"
        value={batch}
        onChange={(e) => setBatch(e.target.value)}
        rows={6}
        spellCheck={false}
        className="input-glass w-full px-3.5 py-2.5 font-mono text-mono-sm leading-relaxed text-on-surface"
      />
      {error && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
      <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="min-w-0">
          <label className="mb-1.5 block text-label-sm font-medium text-on-surface-variant">
            Connection
          </label>
          <Dropdown<string>
            value={source === '' ? undefined : source}
            onChange={(v) => setSource(v ?? '')}
            options={(connections.data ?? []).map((c) => ({
              value: c.name,
              label: c.name,
            }))}
            placeholder="No source (unassigned)…"
            searchable
            allowClear
            className="w-full"
            triggerClassName="flex-1"
          />
        </div>
        <div className="min-w-0">
          <label className="mb-1.5 block text-label-sm font-medium text-on-surface-variant">
            Mapping
          </label>
          <Dropdown<number>
            value={mappingId === '' ? undefined : mappingId}
            onChange={(v) => setMappingId(v ?? '')}
            options={latestMappings(mappings.data ?? []).map((m) => ({
              value: m.id,
              label: `${m.name} · ${m.source ?? 'global'} · ${m.status} (v${m.version})`,
            }))}
            placeholder="Auto-resolve mapping…"
            searchable
            allowClear
            className="w-full"
            triggerClassName="flex-1"
          />
        </div>
        <button
          onClick={runLoadTest}
          disabled={busy}
          className="btn-primary w-full sm:w-auto"
        >
          {busy ? <Spinner size="sm" label="Running…" /> : 'Run trial'}
        </button>
      </div>
      {chosen && (
        <p className="mt-2 text-body-sm text-on-surface-variant">
          Running through <span className="font-semibold text-on-surface">{chosen.name}</span> — lines it
          covers normalize; the rest quarantines for adoption below.
        </p>
      )}
      {result && (
        <div className="surface-inset mt-3 rounded-xl p-3.5 text-body-sm text-on-surface">
          <p>
            Processed <span className="font-semibold text-on-surface">{result.processed}</span> events
            ({result.normalized} normalized · {result.output} output · {result.quarantined}{' '}
            quarantined · {result.dlq} dlq · {result.failed} failed)
          </p>
          <p className="mt-1">
            <span className="font-semibold text-on-surface">{result.events_per_second}</span> events/sec ·{' '}
            <span className="font-semibold text-on-surface">{result.avg_latency_ms}</span> ms avg latency ·{' '}
            {result.duration_seconds}s
          </p>
          {result.normalized + result.output > 0 && (
            <p className="mt-1 text-success">
              {result.normalized + result.output} lines matched an existing mapping — auto-normalized.
            </p>
          )}
          {result.quarantined > 0 && (
            <p className="mt-1 text-warning">
              {result.quarantined} lines are new — adopt them as a mapping or download the set.
            </p>
          )}
          {result.quarantined > 0 && !filing && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={findFiling}
                disabled={filingBusy || busy}
                className="btn-outlined"
              >
                {filingBusy ? <Spinner size="sm" label="Asking AI…" /> : 'AI: find its mapping'}
              </button>
            </div>
          )}
          {filing && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border-success/30 bg-success-container/10 px-3 py-2">
              <span className="text-body-sm text-on-surface">
                AI match: <span className="font-semibold text-on-surface">{filing.mapping.name}</span>{' '}
                <span className="font-mono text-success">
                  {Math.round(filing.coverage * 100)}% cover · {Math.round(filing.minConfidence * 100)}% conf
                </span>
              </span>
              <button
                onClick={fileUnder}
                disabled={busy}
                className="btn-primary text-label-sm"
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
                className="btn-primary text-label-sm"
              >
                Adopt as new mapping
              </Link>
            )}
            <button
              onClick={downloadSet}
              disabled={downloading}
              className="btn-outlined text-label-sm"
            >
              {downloading ? <Spinner size="sm" label="Bundling…" /> : 'Download this trial set'}
            </button>
            <button
              onClick={downloadAll}
              disabled={downloading}
              title="Every normalized log in the system, uncapped"
              className="btn-outlined text-label-sm"
            >
              Download all logs
            </button>
          </div>
        </div>
      )}
    </section>
  )
}