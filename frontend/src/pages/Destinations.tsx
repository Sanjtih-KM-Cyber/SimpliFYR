import { useState } from 'react'
import { createDestination, deleteDestination, listDestinations, patchDestination } from '../api/client'
import type { Destination } from '../api/types'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { EmptyState, TBody, TD, TH, THead, TR, Table, TabBar } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

const TYPES = ['console', 'http', 's3', 'kafka'] as const

function configSummary(d: Destination): string {
  const c = d.config ?? {}
  if (d.type === 'http') return String(c.url ?? '—')
  if (d.type === 's3') return `${c.bucket ?? '—'} / ${c.prefix ?? 'output/'}`
  if (d.type === 'kafka') return String(c.topic ?? '—')
  return 'stdout'
}

export default function Destinations() {
  const destinations = useAsync(() => listDestinations(), [])
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<(typeof TYPES)[number]>('http')
  const [url, setUrl] = useState('')
  const [bucket, setBucket] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function configFor(): Record<string, string> {
    if (type === 'http') return { url }
    if (type === 's3') return { bucket, prefix: 'output/' }
    if (type === 'kafka') return { topic }
    return {}
  }

  function submit() {
    setBusy(true)
    setError(null)
    createDestination({ name: name.trim() || type, type, config: configFor() })
      .then(() => {
        setName('')
        setUrl('')
        setBucket('')
        setTopic('')
        setShowForm(false)
        destinations.reload()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  function toggle(d: Destination) {
    patchDestination(d.id, { enabled: !d.enabled })
      .then(() => destinations.reload())
      .catch((e: Error) => setError(e.message))
  }

  function remove(d: Destination) {
    deleteDestination(d.id)
      .then(() => destinations.reload())
      .catch((e: Error) => setError(e.message))
  }

  const rows = destinations.data ?? []

  return (
    <div>
      <TabBar
        tabs={[
          { to: '/settings', label: 'General' },
          { to: '/settings/audit', label: 'Audit' },
          { to: '/settings/destinations', label: 'Destinations' },
        ]}
      />
      <p className="mb-4 -mt-3 text-sm text-slate-400">
        Configure a destination once and Simplifyr continuously delivers normalized output to it.
      </p>

      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-glass bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(16,185,129,0.8)] hover:bg-emerald-400"
        >
          {showForm ? 'Cancel' : '+ New Destination'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {showForm && (
        <section className="glass-card mb-6 rounded-2xl p-5">
          <h3 className="mb-3 text-sm font-medium text-white">New Destination</h3>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. SIEM HEC)"
              className="input-glass px-3.5 py-2.5 text-sm text-slate-200"
            />
            <select
              value={type}
              onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}
              className="input-glass px-3.5 py-2.5 text-sm text-slate-200"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {type === 'http' && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL (e.g. https://siem.example.com/hpc)"
              className="input-glass mb-3 w-full px-3.5 py-2.5 text-sm text-slate-200"
            />
          )}
          {type === 's3' && (
            <input
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              placeholder="Bucket (e.g. simplifyr-exports)"
              className="input-glass mb-3 w-full px-3.5 py-2.5 text-sm text-slate-200"
            />
          )}
          {type === 'kafka' && (
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic (e.g. simplifyr.output)"
              className="input-glass mb-3 w-full px-3.5 py-2.5 text-sm text-slate-200"
            />
          )}
          {type === 'console' && (
            <p className="mb-3 text-xs text-slate-500">Logs the output to the server console.</p>
          )}
          <button
            onClick={submit}
            disabled={busy}
            className="btn-glass bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(16,185,129,0.8)] hover:bg-emerald-400"
          >
            {busy ? 'Saving…' : 'Save Destination'}
          </button>
        </section>
      )}

      {destinations.loading && <Spinner />}
      {destinations.error && <p className="text-sm text-red-400">{destinations.error}</p>}

      {!destinations.loading && !destinations.error && rows.length === 0 && (
        <EmptyState
          title="No destinations configured"
          description="Add a destination (SIEM, S3, webhook, Kafka) and normalized output is delivered continuously."
        />
      )}

      {rows.length > 0 && (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Type</TH>
              <TH>Target</TH>
              <TH>Enabled</TH>
              <TH></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium text-white">{d.name}</TD>
                <TD>
                  <span className="status-chip text-xs">
                    {d.type}
                  </span>
                </TD>
                <TD className="font-mono text-xs text-slate-400">{configSummary(d)}</TD>
                <TD>
                  <button
                    onClick={() => toggle(d)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      d.enabled
                        ? 'bg-emerald-700 text-emerald-100'
                        : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {d.enabled ? 'enabled' : 'disabled'}
                  </button>
                </TD>
                <TD className="text-right">
                  <button
                    onClick={() => remove(d)}
                    className="btn-glass rounded-xl border border-rose-400/25 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"
                  >
                    Delete
                  </button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
