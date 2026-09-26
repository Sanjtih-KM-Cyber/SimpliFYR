import { useState } from 'react'
import {
  aggregateEvents,
  dedupLogs,
  getAnomalies,
  getCorrelations,
  searchEvents,
} from '../api/client'
import type { AggregateRow, Anomalies, AnalyticsEvent } from '../api/types'
import type { DedupResponse } from '../api/client'
import { Arrow } from '../components/Arrow'
import { Code, Empty } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { useToast } from '../components/ui'
import { Dropdown } from '../components/Dropdown'

const GROUP_OPTIONS = ['source.ip', 'destination.ip', 'network.protocol', 'network.action', 'event.type']

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function Analytics() {
  const [sourceIp, setSourceIp] = useState('')
  const [action, setAction] = useState('')
  const [results, setResults] = useState<AnalyticsEvent[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [groupBy, setGroupBy] = useState('source.ip')
  const [aggregation, setAggregation] = useState<AggregateRow[] | null>(null)
  const [aggregating, setAggregating] = useState(false)

  const [anomalies, setAnomalies] = useState<Anomalies | null>(null)
  const [loadingAnomalies, setLoadingAnomalies] = useState(false)
  const [correlations, setCorrelations] = useState<Record<string, unknown>[] | null>(null)
  const [loadingCorrelations, setLoadingCorrelations] = useState(false)
  const [corrRule, setCorrRule] = useState('port_scan')

  const [dedupRaw, setDedupRaw] = useState('')
  const [dedup, setDedup] = useState<DedupResponse | null>(null)
  const [deduping, setDeduping] = useState(false)
  const { toast } = useToast()

  async function runSearch() {
    setSearching(true)
    setError(null)
    try {
      setResults(await searchEvents({ 'source.ip': sourceIp, 'network.action': action }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSearching(false)
    }
  }

  async function runAggregate() {
    setAggregating(true)
    setError(null)
    try {
      setAggregation(await aggregateEvents(groupBy))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAggregating(false)
    }
  }

  async function runAnomalies() {
    setLoadingAnomalies(true)
    setError(null)
    try {
      setAnomalies(await getAnomalies())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingAnomalies(false)
    }
  }

  async function runCorrelations() {
    setLoadingCorrelations(true)
    setError(null)
    try {
      setCorrelations(await getCorrelations(corrRule))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingCorrelations(false)
    }
  }

  async function runDedup() {
    if (!dedupRaw.trim()) {
      setError('Paste logs or drop a file first')
      return
    }
    setDeduping(true)
    setError(null)
    try {
      setDedup(await dedupLogs(dedupRaw))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeduping(false)
    }
  }

  function onDedupFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setDedupRaw(String(reader.result ?? ''))
    reader.onerror = () => setError('Could not read file')
    reader.readAsText(file)
  }

  function downloadDeduped() {
    if (!dedup) return
    const blob = new Blob([dedup.patterns.map((p) => p.sample).join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `simplifyr-deduped-${dedup.patterns.length}patterns.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    toast(`Downloaded ${dedup.patterns.length} pattern representatives`, 'success')
  }

  return (
    <div>
      <header className="mb-7 border-b border-outline-variant/50 pb-5">
        <h2 className="text-headline-sm font-semibold tracking-tight text-on-surface">Analytics</h2>
        <p className="text-body-md text-on-surface-variant">
          Threat hunting, aggregation, anomaly detection, and correlation.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Search */}
        <section className="glass-card rounded-xl p-5 animate-slide-up">
          <h3 className="mb-3 text-label-lg font-semibold text-on-surface">Hunt / Search</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              value={sourceIp}
              onChange={(e) => setSourceIp(e.target.value)}
              placeholder="Source IP (e.g. 10.0.0.1)"
              className="input-glass w-48 px-3.5 py-2.5 text-body-sm text-on-surface"
            />
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Action (deny/allow)"
              className="input-glass w-40 px-3.5 py-2.5 text-body-sm text-on-surface"
            />
            <button
              onClick={runSearch}
              disabled={searching}
              className="btn-primary"
            >
              {searching ? <Spinner size="sm" /> : 'Search'}
            </button>
          </div>
          {results && (
            <div className="space-y-2">
              {results.length === 0 && <Empty message="No matching events." />}
              {results.map((h) => (
                <div key={h.id} className="surface-inset rounded-xl p-3 text-body-sm">
                  <div className="mb-1 text-on-surface-variant">
                    #{h.id} · {formatTime(h.received_at)} · {h.source ?? 'unknown'}
                  </div>
                  <Code value={h.normalized} />
                </div>
              ))}
            </div>
          )}
          {searching && <Spinner />}
        </section>

        {/* Aggregate */}
        <section className="glass-card rounded-xl p-5 animate-slide-up" style={{ animationDelay: '50ms' }}>
          <h3 className="mb-3 text-label-lg font-semibold text-on-surface">Aggregate</h3>
          <div className="mb-3 flex gap-2">
            <Dropdown
              value={groupBy}
              onChange={setGroupBy}
              options={GROUP_OPTIONS.map((g) => ({ value: g, label: g }))}
              placeholder="Group by…"
              className="flex-1"
            />
            <button
              onClick={runAggregate}
              disabled={aggregating}
              className="btn-primary"
            >
              {aggregating ? <Spinner size="sm" /> : 'Aggregate'}
            </button>
          </div>
          {aggregation && (
            <div className="space-y-1 text-body-sm">
              {aggregation.map((r) => (
                <div key={r.value} className="flex justify-between border-b border-outline-variant/50 py-1">
                  <span className="font-mono text-on-surface">{r.value}</span>
                  <span className="font-semibold text-on-surface">{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Anomalies */}
        <section className="glass-card rounded-xl p-5 animate-slide-up" style={{ animationDelay: '100ms' }}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-label-lg font-semibold text-on-surface">Anomalies</h3>
            <button
              onClick={runAnomalies}
              disabled={loadingAnomalies}
              className="btn-warning"
            >
              {loadingAnomalies ? <Spinner size="sm" /> : 'Detect'}
            </button>
          </div>
          {anomalies && (
            <div className="space-y-3 text-body-sm">
              <div>
                <p className="mb-1 text-label-sm uppercase text-on-surface-variant">High volume</p>
                {anomalies.high_volume.length === 0 ? (
                  <p className="text-on-surface-variant/70">None</p>
                ) : (
                  anomalies.high_volume.map((s) => (
                    <div key={s.source_ip} className="flex justify-between border-b border-outline-variant/50 py-1">
                      <span className="font-mono text-warning">{s.source_ip}</span>
                      <span>{s.count} events</span>
                    </div>
                  ))
                )}
              </div>
              <div>
                <p className="mb-1 text-label-sm uppercase text-on-surface-variant">Scanner (many destinations)</p>
                {anomalies.scanners.length === 0 ? (
                  <p className="text-on-surface-variant/70">None</p>
                ) : (
                  anomalies.scanners.map((s) => (
                    <div key={s.source_ip} className="flex justify-between border-b border-outline-variant/50 py-1">
                      <span className="font-mono text-error">{s.source_ip}</span>
                      <span>{s.distinct_destinations} dsts</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        {/* Correlations */}
        <section className="glass-card rounded-xl p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-label-lg font-semibold text-on-surface">Correlations</h3>
            <button
              onClick={runCorrelations}
              disabled={loadingCorrelations}
              className="btn-warning"
            >
              {loadingCorrelations ? <Spinner size="sm" /> : 'Run'}
            </button>
          </div>
          <Dropdown
            value={corrRule}
            onChange={setCorrRule}
            options={[
              { value: 'port_scan', label: 'Port Scan' },
              { value: 'beaconing', label: 'Beaconing' },
            ]}
            placeholder="Rule…"
            className="w-48"
          />
          {correlations && (
            <div className="space-y-1 text-body-sm">
              {correlations.length === 0 ? (
                <p className="text-on-surface-variant/70">No findings.</p>
              ) : (
                correlations.map((c, i) => (
                  <div key={i} className="border-b border-outline-variant/50 py-1">
                    <Code value={c} />
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Deduplicate Logs */}
        <section className="glass-card rounded-xl p-5 animate-slide-up xl:col-span-2" style={{ animationDelay: '200ms' }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-label-lg font-semibold text-on-surface">Deduplicate Logs</h3>
              <p className="mt-0.5 text-body-sm text-on-surface-variant">
                Paste or drop raw logs — collapses pattern-wise, first log per pattern kept. Nothing is stored.
              </p>
            </div>
            <div className="flex gap-2">
              <label className="btn-secondary cursor-pointer px-3.5 py-2.5 text-body-sm">
                Drop a file…
                <input type="file" className="hidden" onChange={(e) => onDedupFile(e.target.files?.[0])} />
              </label>
              <button
                onClick={runDedup}
                disabled={deduping || !dedupRaw.trim()}
                className="btn-primary"
              >
                {deduping ? <Spinner size="sm" /> : 'Deduplicate'}
              </button>
            </div>
          </div>
          <textarea
            value={dedupRaw}
            onChange={(e) => setDedupRaw(e.target.value)}
            rows={4}
            placeholder="<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
            className="input-glass mb-3 w-full px-3.5 py-2.5 font-mono text-mono-sm text-on-surface"
          />
          {deduping && <Spinner />}
          {dedup && (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <p className="text-body-sm text-on-surface-variant">
                  <span className="font-semibold text-on-surface">{dedup.total}</span> lines <Arrow variant="inline" size="sm" /> <span className="font-semibold text-on-surface">{dedup.patterns.length}</span> patterns
                </p>
                <button
                  onClick={downloadDeduped}
                  className="btn-secondary text-label-sm"
                >
                  Download deduped
                </button>
              </div>
              <div className="space-y-2">
                {dedup.patterns.map((p, i) => (
                  <div key={i} className="surface-inset rounded-xl p-3 text-body-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="surface-inset rounded px-1.5 py-0.5 font-mono font-bold uppercase text-warning border border-warning/20">
                        {p.format}
                      </span>
                      <span className="surface-inset rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-on-surface-variant">
                        × {p.count}
                      </span>
                      {p.fields.length > 0 && (
                        <span className="font-mono text-on-surface-variant/70">{p.fields.join(', ')}</span>
                      )}
                    </div>
                    <Code value={p.sample} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}