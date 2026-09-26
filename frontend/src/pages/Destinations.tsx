import { useState } from 'react'
import { createDestination, deleteDestination, listDestinations, patchDestination } from '../api/client'
import type { Destination } from '../api/types'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { EmptyState, TBody, TD, TH, THead, TR, Table } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { Dropdown } from '../components/Dropdown'

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
      <p className="mb-4 -mt-3 text-body-sm text-on-surface-variant">
        Configure a destination once and Simplifyr continuously delivers normalized output to it.
      </p>

      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-primary"
        >
          {showForm ? 'Cancel' : '+ New Destination'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {showForm && (
        <section className="glass-card mb-6 rounded-xl p-5 animate-slide-up">
          <h3 className="mb-3 text-label-lg font-semibold text-on-surface">New Destination</h3>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. SIEM HEC)"
              className="input-glass px-3.5 py-2.5 text-body-sm text-on-surface"
            />
            <Dropdown
              value={type}
              onChange={(v) => setType(v as (typeof TYPES)[number])}
              options={TYPES.map((t) => ({ value: t, label: t }))}
              placeholder="Type"
              className="w-full"
            />
          </div>
          {type === 'http' && (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL (e.g. https://siem.example.com/hpc)"
              className="input-glass mb-3 w-full px-3.5 py-2.5 text-body-sm text-on-surface"
            />
          )}
          {type === 's3' && (
            <input
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              placeholder="Bucket (e.g. simplifyr-exports)"
              className="input-glass mb-3 w-full px-3.5 py-2.5 text-body-sm text-on-surface"
            />
          )}
          {type === 'kafka' && (
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic (e.g. simplifyr.output)"
              className="input-glass mb-3 w-full px-3.5 py-2.5 text-body-sm text-on-surface"
            />
          )}
          {type === 'console' && (
            <p className="mb-3 text-body-sm text-on-surface-variant/70">Logs the output to the server console.</p>
          )}
          <button
            onClick={submit}
            disabled={busy}
            className="btn-primary"
          >
            {busy ? 'Saving…' : 'Save Destination'}
          </button>
        </section>
      )}

      {destinations.loading && <Spinner />}
      {destinations.error && <p className="text-body-sm text-error">{destinations.error}</p>}

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
                <TD className="font-medium text-on-surface">{d.name}</TD>
                <TD>
                  <span className="surface-inset rounded-full border border-outline-variant/50 px-2.5 py-1 text-label-sm text-on-surface-variant">
                    {d.type}
                  </span>
                </TD>
                <TD className="font-mono text-mono-sm text-on-surface-variant">{configSummary(d)}</TD>
                <TD>
                  <button
                    onClick={() => toggle(d)}
                    className={`rounded-full px-2.5 py-1 text-label-sm font-semibold ${
                      d.enabled
                        ? 'bg-success text-on-success'
                        : 'bg-surface-variant text-on-surface-variant'
                    }`}
                  >
                    {d.enabled ? 'enabled' : 'disabled'}
                  </button>
                </TD>
                <TD className="text-right">
                  <button
                    onClick={() => remove(d)}
                    className="btn-text text-error text-label-sm"
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