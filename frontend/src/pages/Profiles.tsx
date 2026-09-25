import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createOutputProfile, listMappings, listOutputProfiles } from '../api/client'
import { latestMappings } from '../api/types'
import { Code, Empty } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { ErrorBanner, StatusBadge } from '../components/Status'
import { useAsync } from '../hooks/useAsync'

interface Row {
  output_field: string
  from_semantic: string
}

/** Settings → Profiles: output profile reference (list + custom builder)
 *  plus a read-only mappings reference (bind them per-connection in the
 *  connection Overview → Try it now). */
export default function Profiles() {
  const profiles = useAsync(() => listOutputProfiles(), [])
  const mappings = useAsync(() => listMappings(), [])
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Row[]>([{ output_field: '', from_semantic: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) {
      setError('Profile name is required')
      return
    }
    const fields = rows.filter((r) => r.output_field.trim() && r.from_semantic.trim())
    if (fields.length === 0) {
      setError('Add at least one field')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await createOutputProfile({
        name: name.trim(),
        fields: fields.map((f) => ({ output_field: f.output_field, from_semantic: f.from_semantic })),
      })
      setName('')
      setRows([{ output_field: '', from_semantic: '' }])
      setShowForm(false)
      profiles.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const groups = latestMappings(mappings.data ?? [])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="-mt-3 text-sm text-slate-400">
          Output profiles shape deliveries; mappings are bound per-connection in Try it now.
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
        >
          {showForm ? 'Cancel' : '+ Custom Profile'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {showForm && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">New Custom Profile</h3>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Profile name"
            className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          />
          <div className="mb-3 space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={row.output_field}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, idx) => (idx === i ? { ...r, output_field: e.target.value } : r)),
                    )
                  }
                  placeholder="Output field"
                  className="w-1/2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
                <input
                  value={row.from_semantic}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, idx) => (idx === i ? { ...r, from_semantic: e.target.value } : r)),
                    )
                  }
                  placeholder="Semantic field (e.g. source.ip)"
                  className="w-1/2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
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
              onClick={() => setRows((prev) => [...prev, { output_field: '', from_semantic: '' }])}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              + Add field
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </section>
      )}

      {profiles.loading && <Spinner />}
      {profiles.error && <p className="text-sm text-red-400">{profiles.error}</p>}
      {!profiles.loading && (profiles.data?.length ?? 0) === 0 && <Empty message="No output profiles." />}

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {(profiles.data ?? []).map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">{p.name}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-xs ${
                  p.is_preset ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-700 text-slate-200'
                }`}
              >
                {p.is_preset ? 'preset' : 'custom'}
              </span>
            </div>
            {p.description && <p className="mb-2 text-xs text-slate-500">{p.description}</p>}
            <div className="max-h-48 overflow-auto">
              <Code
                value={
                  p.profile_schema.include_all
                    ? 'emit full normalized event'
                    : p.profile_schema.fields.map((f) => `${f.from} → ${f.output_field}`).join('\n')
                }
              />
            </div>
          </div>
        ))}
      </div>

      <h3 className="mb-3 text-sm font-medium text-white">Mappings reference</h3>
      {mappings.loading && <Spinner />}
      {mappings.error && <p className="text-sm text-red-400">{mappings.error}</p>}
      {!mappings.loading && groups.length === 0 && <Empty message="No mappings yet." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((m) => (
          <div key={m.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                {m.name}
                <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-400">
                  v{m.version}
                </span>
              </h3>
              <StatusBadge status={m.status} />
            </div>
            <p className="mb-2 text-xs text-slate-500">
              {m.source ?? 'No source'} · {m.event_family}
            </p>
            {m.source && (
              <Link
                to={`/connections/${encodeURIComponent(m.source)}/mappings`}
                className="text-[11px] font-bold uppercase tracking-wider text-cyan-500 hover:text-cyan-400 underline decoration-cyan-900/50 underline-offset-4"
              >
                Open in Schema Map →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
