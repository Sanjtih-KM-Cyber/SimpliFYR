import { useState } from 'react'
import { Link } from 'react-router-dom'
import { createOutputProfile, listMappings, listOutputProfiles } from '../api/client'
import { latestMappings } from '../api/types'
import { Arrow } from '../components/Arrow'
import { Empty } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { ErrorBanner, StatusBadge } from '../components/Status'
import { useAsync } from '../hooks/useAsync'

interface Row {
  output_field: string
  from_semantic: string
}

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
        <p className="-mt-3 text-body-sm text-on-surface-variant">
          Output profiles shape deliveries; mappings are bound per-connection in Try it now.
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="btn-secondary text-body-sm"
        >
          {showForm ? 'Cancel' : '+ Custom Profile'}
        </button>
      </div>

      {error && <ErrorBanner message={error} />}

      {showForm && (
        <section className="glass-card mb-6 rounded-xl p-5 animate-slide-up">
          <h3 className="mb-3 text-label-lg font-semibold text-on-surface">New Custom Profile</h3>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Profile name"
            className="input-glass mb-3 w-full px-3.5 py-2.5 text-body-sm text-on-surface"
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
                  className="w-1/2 input-glass px-3 py-2 text-body-sm text-on-surface"
                />
                <input
                  value={row.from_semantic}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, idx) => (idx === i ? { ...r, from_semantic: e.target.value } : r)),
                    )
                  }
                  placeholder="Semantic field (e.g. source.ip)"
                  className="w-1/2 input-glass px-3 py-2 text-body-sm text-on-surface"
                />
                <button
                  onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                  className="control-icon h-9 w-9"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setRows((prev) => [...prev, { output_field: '', from_semantic: '' }])}
              className="btn-secondary px-3.5 py-2 text-body-sm"
            >
              + Add field
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="btn-primary"
            >
              {submitting ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </section>
      )}

      {profiles.loading && <Spinner />}
      {profiles.error && <p className="text-body-sm text-error">{profiles.error}</p>}
      {!profiles.loading && (profiles.data?.length ?? 0) === 0 && <Empty message="No output profiles." />}

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {(profiles.data ?? []).map((p) => (
          <div key={p.id} className="glass-card rounded-xl p-5 animate-slide-up">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-label-lg font-semibold text-on-surface">{p.name}</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-label-sm ${
                  p.is_preset ? 'border border-info/30 bg-info-container/20 text-info' : 'border border-outline/30 bg-surface-variant text-on-surface-variant'
                }`}
              >
                {p.is_preset ? 'preset' : 'custom'}
              </span>
            </div>
            {p.description && <p className="mb-2 text-body-sm text-on-surface-variant">{p.description}</p>}
            <div className="surface-inset rounded-xl max-h-48 overflow-auto font-mono text-mono-sm">
              {p.profile_schema.include_all ? (
                <div className="text-on-surface-variant/70">emit full normalized event</div>
              ) : (
                p.profile_schema.fields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 py-0.5 text-on-surface-variant">
                    <span className="text-warning/80">{f.from}</span>
                    <Arrow variant="mapping" size="sm" />
                    <span className="text-primary">{f.output_field}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      <h3 className="mb-3 text-label-lg font-semibold text-on-surface">Mappings reference</h3>
      {mappings.loading && <Spinner />}
      {mappings.error && <p className="text-body-sm text-error">{mappings.error}</p>}
      {!mappings.loading && groups.length === 0 && <Empty message="No mappings yet." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((m) => (
          <div key={m.id} className="glass-card rounded-xl p-5 animate-slide-up">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-label-lg font-semibold text-on-surface">
                {m.name}
                <span className="surface-inset rounded border border-primary/30 bg-primary-container/20 px-1.5 py-0.5 font-mono text-label-sm font-bold text-primary">
                  v{m.version}
                </span>
              </h3>
              <StatusBadge status={m.status} />
            </div>
            <p className="mb-2 text-body-sm text-on-surface-variant">
              {m.source ?? 'No source'} · {m.event_family}
            </p>
            {m.source && (
              <Link
                to={`/connections/${encodeURIComponent(m.source)}/mappings`}
                className="text-label-sm font-bold uppercase tracking-wider text-primary hover:text-primary/70 hover:underline transition-colors"
              >
                Open in Schema Map
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}