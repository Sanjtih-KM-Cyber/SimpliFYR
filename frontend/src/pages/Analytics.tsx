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

  return (
    <div>
      <header className="mb-6">
        <h2 className="text-2xl font-semibold text-white">Analytics</h2>
        <p className="text-sm text-slate-400">
          Threat hunting, aggregation, anomaly detection, and correlation.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Search */}
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Hunt / Search</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              value={sourceIp}
              onChange={(e) => setSourceIp(e.target.value)}
              placeholder="Source IP (e.g. 10.0.0.1)"
              className="w-48 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="Action (deny/allow)"
              className="w-40 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <button
              onClick={runSearch}
              disabled={searching}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {searching ? '…' : 'Search'}
            </button>
          </div>
          {results && (
            <div className="space-y-2">
              {results.length === 0 && <Empty message="No matching events." />}
              {results.map((h) => (
                <div key={h.id} className="rounded-md border border-slate-800 bg-slate-950 p-2 text-xs">
                  <div className="mb-1 text-slate-400">
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
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Aggregate</h3>
          <div className="mb-3 flex gap-2">
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            >
              {GROUP_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <button
              onClick={runAggregate}
              disabled={aggregating}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {aggregating ? '…' : 'Aggregate'}
            </button>
          </div>
          {aggregation && (
            <div className="space-y-1 text-sm">
              {aggregation.map((r) => (
                <div key={r.value} className="flex justify-between border-b border-slate-800 py-1">
                  <span className="font-mono text-slate-200">{r.value}</span>
                  <span className="font-semibold text-white">{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Anomalies */}
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Anomalies</h3>
            <button
              onClick={runAnomalies}
              disabled={loadingAnomalies}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {loadingAnomalies ? '…' : 'Detect'}
            </button>
          </div>
          {anomalies && (
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-xs uppercase text-slate-500">High volume</p>
                {anomalies.high_volume.length === 0 ? (
                  <p className="text-slate-600">None</p>
                ) : (
                  anomalies.high_volume.map((s) => (
                    <div key={s.source_ip} className="flex justify-between border-b border-slate-800 py-1">
                      <span className="font-mono text-amber-300">{s.source_ip}</span>
                      <span>{s.count} events</span>
                    </div>
                  ))
                )}
              </div>
              <div>
                <p className="mb-1 text-xs uppercase text-slate-500">Scanner (many destinations)</p>
                {anomalies.scanners.length === 0 ? (
                  <p className="text-slate-600">None</p>
                ) : (
                  anomalies.scanners.map((s) => (
                    <div key={s.source_ip} className="flex justify-between border-b border-slate-800 py-1">
                      <span className="font-mono text-red-300">{s.source_ip}</span>
                      <span>{s.distinct_destinations} dsts</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </section>

        {/* Correlations */}
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">Correlations</h3>
            <button
              onClick={runCorrelations}
              disabled={loadingCorrelations}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {loadingCorrelations ? '…' : 'Run'}
            </button>
          </div>
          <select
            value={corrRule}
            onChange={(e) => setCorrRule(e.target.value)}
            className="mb-3 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          >
            <option value="port_scan">Port Scan</option>
            <option value="beaconing">Beaconing</option>
          </select>
          {correlations && (
            <div className="space-y-1 text-sm">
              {correlations.length === 0 ? (
                <p className="text-slate-600">No findings.</p>
              ) : (
                correlations.map((c, i) => (
                  <div key={i} className="border-b border-slate-800 py-1">
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