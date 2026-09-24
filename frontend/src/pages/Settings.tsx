import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import {
  getAuthToken,
  getConfig,
  getEnvironment,
  getHealth,
  getStats,
  processBatch,
  setAuthToken,
  setEnvironment,
} from '../api/client'
import type { BatchResult } from '../api/types'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { TabBar } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/[0.07] py-2.5 text-sm last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono text-slate-200">{value}</span>
    </div>
  )
}

const SAMPLE = `<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:45 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:46 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:47 fw01 srcip=10.1.1.5 action=deny
<134>Sep 15 10:31:48 fw01 srcip=10.1.1.5 action=deny`

export default function Settings() {
  return (
    <div>
      <TabBar
        tabs={[
          { to: '/settings', label: 'General', end: true },
          { to: '/settings/audit', label: 'Audit' },
          { to: '/settings/destinations', label: 'Destinations' },
        ]}
      />
      <p className="mb-6 -mt-3 text-sm text-slate-400">
        System, security, and pipeline configuration. Power-user controls live here.
      </p>

      <Outlet />
    </div>
  )
}

export function SettingsGeneral() {
  const health = useAsync(() => getHealth(), [])
  const stats = useAsync(() => getStats(), [])
  const config = useAsync(() => getConfig(), [])

  const [batch, setBatch] = useState(SAMPLE)
  const [result, setResult] = useState<BatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState(getAuthToken() ?? '')
  const [environment, setEnvironmentInput] = useState(getEnvironment() ?? '')
  const [savedCreds, setSavedCreds] = useState(false)

  async function runLoadTest() {
    setBusy(true)
    setError(null)
    try {
      setResult(await processBatch({ raw: batch }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function saveCredentials() {
    setAuthToken(token || null)
    setEnvironment(environment || null)
    setSavedCreds(true)
    setTimeout(() => setSavedCreds(false), 2000)
  }

  const c = config.data

  return (
    <div>
        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Runtime</h3>
          {health.loading ? (
            <Spinner />
          ) : (
            <>
              <Row label="Application" value={health.data?.app ?? '—'} />
              <Row label="Version" value={`v${health.data?.version ?? '—'}`} />
              <Row label="API" value={health.data?.status ?? '—'} />
              <Row label="Database" value={health.data?.database ?? '—'} />
            </>
          )}
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Pipeline</h3>
          {stats.loading ? (
            <Spinner />
          ) : (
            <>
              <Row label="Events Processed" value={String(stats.data?.total_events ?? '—')} />
              <Row label="Events / Second" value={String(stats.data?.events_per_second ?? '—')} />
              <Row label="Active Sources" value={String(stats.data?.sources ?? '—')} />
              <Row label="Needs Review Pending" value={String(stats.data?.quarantine_pending ?? '—')} />
            </>
          )}
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Security & Scaling</h3>
          {config.loading ? (
            <Spinner />
          ) : (
            <>
              <Row label="Authentication" value={c?.auth_enabled ? 'enabled' : 'disabled (dev)'} />
              <Row label="Pipeline" value={`${c?.pipeline_backend ?? '—'} · ${c?.pipeline_workers ?? '—'} worker(s)`} />
              <Row label="Raw Store" value={c?.raw_store_backend ?? '—'} />
              <Row label="Cache" value={c?.cache_backend ?? '—'} />
              <Row
                label="Delivery Sinks"
                value={(c?.delivery_sinks?.length ?? 0) > 0 ? c!.delivery_sinks.join(', ') : 'none'}
              />
              <Row label="AI Provider" value={c?.ai_provider ?? '—'} />
              <Row label="Rate Limit / min" value={c?.rate_limit_per_minute ? String(c.rate_limit_per_minute) : 'unlimited'} />
              <Row
                label="Retention (raw/norm/audit)"
                value={
                  c?.raw_retention_days || c?.normalized_retention_days || c?.audit_retention_days
                    ? `${c?.raw_retention_days ?? 0}d / ${c?.normalized_retention_days ?? 0}d / ${c?.audit_retention_days ?? 0}d`
                    : c?.retention_days
                      ? `${c.retention_days}d (legacy)`
                      : 'disabled'
                }
              />
              <Row
                label="Syslog UDP"
                value={c?.syslog_enabled ? `${c.syslog_udp_host}:${c.syslog_udp_port}` : 'disabled'}
              />
            </>
          )}
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Authentication & Environment</h3>
          <p className="mb-2 text-xs text-slate-500">
            Bearer token (sent as Authorization header) and tenant environment (X-Environment
            header). Required when the backend runs with AUTH_ENABLED=true.
          </p>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            placeholder="Bearer token (empty = anonymous)"
            className="input-glass mb-2 w-full px-3.5 py-2.5 font-mono text-xs text-slate-200"
          />
          <input
            value={environment}
            onChange={(e) => setEnvironmentInput(e.target.value)}
            placeholder="Environment (empty = default)"
            className="input-glass mb-3 w-full px-3.5 py-2.5 text-sm text-slate-200"
          />
          <button
            onClick={saveCredentials}
            className="btn-glass bg-violet-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(139,92,246,0.9)] hover:bg-violet-400"
          >
            {savedCreds ? 'Saved ✓' : 'Save'}
          </button>
        </section>

        <section className="glass-card rounded-2xl p-5">
          <h3 className="mb-2 text-sm font-medium text-white">Load Test</h3>
          <p className="mb-2 text-xs text-slate-500">
            Process a batch of events (one per line) and measure throughput.
          </p>
          <textarea
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            rows={5}
            className="input-glass w-full px-3.5 py-2.5 font-mono text-xs text-slate-200"
          />
          {error && <ErrorBanner message={error} />}
          <button
            onClick={runLoadTest}
            disabled={busy}
            className="btn-glass mt-3 bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(16,185,129,0.9)] hover:bg-emerald-400"
          >
            {busy ? 'Running…' : 'Run load test'}
          </button>
          {result && (
            <div className="surface-inset mt-3 rounded-xl p-3.5 text-xs text-slate-300">
              <p>
                Processed <span className="font-semibold text-white">{result.processed}</span> events
                ({result.normalized} normalized · {result.output} output · {result.quarantined}{' '}
                quarantined · {result.dlq} dlq · {result.failed} failed)
              </p>
              <p className="mt-1">
                <span className="font-semibold text-white">{result.events_per_second}</span> events/sec ·{' '}
                <span className="font-semibold text-white">{result.avg_latency_ms}</span> ms avg latency ·
                {result.duration_seconds}s
              </p>
            </div>
          )}
        </section>
      </div>
  )
}
