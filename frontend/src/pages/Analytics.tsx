import { useState } from 'react'
import {
  aggregateEvents,
  getAnomalies,
  getCorrelations,
  searchEvents,
} from '../api/client'
import type { AggregateRow, Anomalies, AnalyticsEvent } from '../api/types'
import { Code, Empty } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { Dropdown } from '../components/Dropdown'
import { SemanticFieldInput } from '../components/SemanticFieldInput'

const GROUP_OPTIONS = [
  'source.ip',
  'source.port',
  'destination.ip',
  'destination.port',
  'network.protocol',
  'network.action',
  'event.type',
  'event.severity',
  'identity.user',
]

const THRESHOLD_OPTIONS = [3, 5, 10, 20]

const CORR_RULES = [
  { value: 'port_scan', label: 'Port Scan' },
  { value: 'beaconing', label: 'Beaconing' },
  { value: 'deny_flood', label: 'Deny Flood' },
]

interface FilterRow {
  field: string
  value: string
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function Analytics({ sourceFilter }: { sourceFilter?: string }) {
  const [filters, setFilters] = useState<FilterRow[]>([
    { field: 'source.ip', value: '' },
    { field: 'network.action', value: '' },
  ])
  const [results, setResults] = useState<AnalyticsEvent[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [groupBy, setGroupBy] = useState('source.ip')
  const [aggregation, setAggregation] = useState<AggregateRow[] | null>(null)
  const [aggregating, setAggregating] = useState(false)

  const [threshold, setThreshold] = useState(5)
  const [anomalies, setAnomalies] = useState<Anomalies | null>(null)
  const [loadingAnomalies, setLoadingAnomalies] = useState(false)
  const [correlations, setCorrelations] = useState<Record<string, unknown>[] | null>(null)
  const [loadingCorrelations, setLoadingCorrelations] = useState(false)
  const [corrRule, setCorrRule] = useState('port_scan')
  const [corrThreshold, setCorrThreshold] = useState(5)

  function updateFilter(index: number, patch: Partial<FilterRow>) {
    setFilters((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function runSearch() {
    setSearching(true)
    setError(null)
    try {
      const picked: Record<string, string> = {}
      for (const r of filters) {
        if (r.field.trim() && r.value.trim()) picked[r.field.trim()] = r.value.trim()
      }
      setResults(await searchEvents(picked, sourceFilter))
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
      setAggregation(await aggregateEvents(groupBy, sourceFilter))
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
      setAnomalies(await getAnomalies(threshold, sourceFilter))
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
      setCorrelations(await getCorrelations(corrRule, corrThreshold, sourceFilter))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingCorrelations(false)
    }
  }

  return (
    <div>
      {!sourceFilter && (
        <header className="mb-7 border-b border-outline-variant/50 pb-5">
          <h2 className="text-headline-sm font-semibold tracking-tight text-on-surface">Analytics</h2>
          <p className="text-body-md text-on-surface-variant">
            Threat hunting, aggregation, anomaly detection, and correlation.
          </p>
        </header>
      )}

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Search */}
        <section className="glass-card rounded-xl p-5 animate-slide-up">
          <h3 className="mb-3 text-label-lg font-semibold text-on-surface">Hunt / Search</h3>
          <div className="mb-3 space-y-2">
            {filters.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <div className="min-w-[180px] flex-1">
                  <SemanticFieldInput
                    value={row.field}
                    onChange={(v) => updateFilter(i, { field: v })}
                  />
                </div>
                <input
                  value={row.value}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                  placeholder="value (e.g. 10.0.0.1)"
                  className="input-glass w-40 px-3.5 py-2.5 text-body-sm text-on-surface"
                />
                {filters.length > 1 && (
                  <button
                    onClick={() => setFilters((prev) => prev.filter((_, j) => j !== i))}
                    title="Remove filter"
                    className="control-icon h-9 w-9 shrink-0"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => setFilters((prev) => [...prev, { field: '', value: '' }])}
              className="btn-outlined text-label-sm"
            >
              + Filter
            </button>
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
              onChange={(v) => {
                if (v !== undefined) setGroupBy(v)
              }}
              options={GROUP_OPTIONS.map((g) => ({ value: g, label: g }))}
              placeholder="Group by…"
              searchable
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
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-label-lg font-semibold text-on-surface">Anomalies</h3>
            <div className="flex items-center gap-2">
              <Dropdown<number>
                value={threshold}
                onChange={(v) => {
                  if (v !== undefined) setThreshold(v)
                }}
                options={THRESHOLD_OPTIONS.map((n) => ({ value: n, label: `≥ ${n}` }))}
                className="w-28"
              />
              <button
                onClick={runAnomalies}
                disabled={loadingAnomalies}
                className="btn-warning"
              >
                {loadingAnomalies ? <Spinner size="sm" /> : 'Detect'}
              </button>
            </div>
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
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-label-lg font-semibold text-on-surface">Correlations</h3>
            <button
              onClick={runCorrelations}
              disabled={loadingCorrelations}
              className="btn-warning"
            >
              {loadingCorrelations ? <Spinner size="sm" /> : 'Run'}
            </button>
          </div>
          <div className="mb-3 flex gap-2">
            <Dropdown
              value={corrRule}
              onChange={(v) => {
                if (v !== undefined) setCorrRule(v)
              }}
              options={CORR_RULES.map((r) => ({ value: r.value, label: r.label }))}
              placeholder="Rule…"
              className="w-48"
            />
            <Dropdown<number>
              value={corrThreshold}
              onChange={(v) => {
                if (v !== undefined) setCorrThreshold(v)
              }}
              options={THRESHOLD_OPTIONS.map((n) => ({ value: n, label: `≥ ${n}` }))}
              className="w-28"
            />
          </div>
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
      </div>
    </div>
  )
}
