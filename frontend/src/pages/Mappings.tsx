import { useState } from 'react'
import { createMapping, listMappings } from '../api/client'
import { SEMANTIC_FIELDS } from '../api/types'
import type { Mapping } from '../api/types'
import { Code } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { ErrorBanner, StatusBadge } from '../components/Status'
import { EmptyState, PageHeader } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

interface Row {
  input_field: string
  semantic_field: string
}

export default function Mappings({ sourceFilter }: { sourceFilter?: string }) {
  const mappings = useAsync(() => listMappings(), [])
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [source, setSource] = useState(sourceFilter ?? '')
  const [rows, setRows] = useState<Row[]>([{ input_field: '', semantic_field: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  async function submit() {
    if (!name.trim()) {
      setError('Mapping name is required')
      return
    }
    const fields = rows.filter((r) => r.input_field.trim() && r.semantic_field.trim())
    if (fields.length === 0) {
      setError('Add at least one field mapping')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await createMapping({
        name: name.trim(),
        source: (sourceFilter ?? source).trim() || undefined,
        fields,
      })
      setName('')
      setSource(sourceFilter ?? '')
      setRows([{ input_field: '', semantic_field: '' }])
      setShowForm(false)
      mappings.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const rows_ = (mappings.data ?? []).filter(
    (m: Mapping) => !sourceFilter || m.source === sourceFilter,
  )

  return (
    <div>
      {!sourceFilter && (
        <PageHeader
          title="Mappings"
          subtitle="Map source fields to canonical semantic fields."
        />
      )}

      <div className={sourceFilter ? 'mb-4' : ''}>
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {showForm ? 'Cancel' : '+ New Mapping'}
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        {showForm && (
          <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-3 text-sm font-medium text-white">New Mapping</h3>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. VendorX Firewall v1 Traffic)"
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
              {sourceFilter ? (
                <input
                  value={sourceFilter}
                  disabled
                  className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-500"
                />
              ) : (
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Source (e.g. VendorX Firewall v1)"
                  className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
              )}
            </div>

            <div className="mb-3 space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={row.input_field}
                    onChange={(e) => updateRow(i, { input_field: e.target.value })}
                    placeholder="Source field"
                    className="w-1/3 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  />
                  <select
                    value={row.semantic_field}
                    onChange={(e) => updateRow(i, { semantic_field: e.target.value })}
                    className="w-1/3 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                  >
                    <option value="">Semantic field…</option>
                    {SEMANTIC_FIELDS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    className="rounded-md border border-slate-700 px-3 text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setRows((prev) => [...prev, { input_field: '', semantic_field: '' }])}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
              >
                + Add field
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save Mapping'}
              </button>
            </div>
          </section>
        )}

        {mappings.loading && <Spinner />}
        {mappings.error && <p className="text-sm text-red-400">{mappings.error}</p>}

        {!mappings.loading && !mappings.error && rows_.length === 0 && (
          <EmptyState
            title={sourceFilter ? 'No mappings for this connection' : 'No mappings yet'}
            description="Create one to start normalizing."
          />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {rows_.map((m: Mapping) => (
            <div key={m.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">{m.name}</h3>
                <StatusBadge status={m.status} />
              </div>
              <p className="mb-3 text-xs text-slate-500">
                {m.source ?? 'No source'} · v{m.version} · {m.event_family}
              </p>
              <div className="max-h-48 overflow-auto">
                <Code
                  value={m.fields.map((f) => `${f.input_field} → ${f.semantic_field}`).join('\n')}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
