import { useMemo, useState } from 'react'
import { createMapping, deleteMapping, listMappings } from '../api/client'
import { normalizeMappingName } from '../api/types'
import type { Mapping } from '../api/types'
import { Arrow } from '../components/Arrow'
import { SemanticFieldInput } from '../components/SemanticFieldInput'
import { Spinner } from '../components/Spinner'
import { ErrorBanner, StatusBadge } from '../components/Status'
import { EmptyState, PageHeader, useToast } from '../components/ui'
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

  const groups = useMemo(() => {
    const byKey = new Map<string, Mapping[]>()
    for (const m of rows_) {
      const key = normalizeMappingName(m.name)
      const g = byKey.get(key)
      if (g) g.push(m)
      else byKey.set(key, [m])
    }
    return [...byKey.values()].map((versions) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version || b.id - a.id)
      return { key: normalizeMappingName(sorted[0].name), latest: sorted[0], versions: sorted }
    })
  }, [rows_])

  const { toast } = useToast()
  const [deleting, setDeleting] = useState<number | string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function deleteVersions(key: string | number, ids: number[], label: string) {
    if (!window.confirm(`Delete ${label}? Bound recipes unbind; drift history detaches.`)) return
    setDeleting(key)
    try {
      for (const id of ids) await deleteMapping(id)
      toast(`Deleted ${label}`, 'success')
      mappings.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDeleting(null)
    }
  }

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
            className="btn-primary"
          >
            {showForm ? 'Cancel' : '+ New Mapping'}
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        {showForm && (
          <section className="glass-card mb-6 rounded-xl p-5 animate-slide-up">
            <h3 className="mb-3 text-label-lg font-semibold text-on-surface">New Mapping</h3>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. VendorX Firewall v1 Traffic)"
                className="input-glass px-3.5 py-2.5 text-body-sm text-on-surface"
              />
              {sourceFilter ? (
                <input
                  value={sourceFilter}
                  disabled
                  className="input-glass px-3.5 py-2.5 text-body-sm text-on-surface-variant/60"
                />
              ) : (
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Source (e.g. VendorX Firewall v1)"
                  className="input-glass px-3.5 py-2.5 text-body-sm text-on-surface"
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
                    className="input-glass w-1/3 px-3.5 py-2.5 text-body-sm text-on-surface"
                  />
                  <SemanticFieldInput
                    value={row.semantic_field}
                    onChange={(v) => updateRow(i, { semantic_field: v })}
                  />
                  <button
                    onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                    className="control-icon h-auto rounded-xl px-3"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setRows((prev) => [...prev, { input_field: '', semantic_field: '' }])}
                className="btn-secondary px-3.5 py-2"
              >
                + Add field
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="btn-primary"
              >
                {submitting ? 'Saving…' : 'Save Mapping'}
              </button>
            </div>
          </section>
        )}

        {mappings.loading && <Spinner />}
        {mappings.error && <p className="text-body-sm text-error">{mappings.error}</p>}

        {!mappings.loading && !mappings.error && groups.length === 0 && (
          <EmptyState
            title={sourceFilter ? 'No mappings for this connection' : 'No mappings yet'}
            description="Create one to start normalizing."
          />
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((g) => {
            const m = g.latest
            const key = g.key
            const open = expanded === key
            return (
              <div key={key} className="glass-card rounded-xl p-5 animate-slide-up">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-label-lg font-semibold text-on-surface">
                    {m.name}
                    <span className="surface-inset rounded px-1.5 py-0.5 font-mono text-label-sm font-bold text-primary">
                      v{m.version}
                    </span>
                    {g.versions.length > 1 && (
                      <button
                        onClick={() => setExpanded(open ? null : key)}
                        title={open ? 'Hide version history' : 'Show all versions'}
                        className="surface-inset rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-label-sm text-on-surface-variant hover:border-primary/30 hover:text-primary"
                      >
                        {g.versions.length} versions {open ? '▾' : '▸'}
                      </button>
                    )}
                  </h3>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={m.status} />
                    <button
                      onClick={() =>
                        deleteVersions(key, g.versions.map((v) => v.id), `mapping "${m.name}" and all ${g.versions.length} version(s)`)
                      }
                      disabled={deleting === key}
                      title={`Delete "${m.name}" and all its versions`}
                      className="btn-text text-error text-label-sm"
                    >
                      {deleting === key ? '…' : 'Delete'}
                    </button>
                  </span>
                </div>
                <p className="mb-3 text-body-sm text-on-surface-variant">
                  {m.source ?? 'No source'} · v{m.version} · {m.event_family}
                </p>
                <div className="surface-inset rounded-xl max-h-48 overflow-auto font-mono text-mono-sm">
                    {m.fields.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 py-0.5 text-on-surface-variant">
                        <span className="text-warning/80">{f.input_field}</span>
                        <Arrow variant="mapping" size="sm" />
                        <span className="text-primary">{f.semantic_field}</span>
                        {f.transformation && (
                          <span className="text-on-surface-variant/60 text-mono-xs">({JSON.stringify(f.transformation)})</span>
                        )}
                      </div>
                    ))}
                  </div>
                {open && (
                  <div className="mt-3 space-y-2 border-t border-outline-variant/50 pt-3">
                    {g.versions.map((v) => (
                      <details key={v.id} className="surface-inset rounded-xl p-3 animate-slide-up">
                        <summary className="flex cursor-pointer select-none items-center gap-2 text-body-sm">
                          <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span>
                          <span className="font-mono font-bold text-on-surface">{v.name}</span>
                          <span className="surface-inset rounded px-1 py-0.5 font-mono text-label-sm font-bold text-primary">
                            v{v.version}
                          </span>
                          <StatusBadge status={v.status} />
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              deleteVersions(v.id, [v.id], `"${v.name}" (v${v.version})`)
                            }}
                            disabled={deleting === v.id}
                            title={`Delete "${v.name}" only`}
                            className="ml-auto btn-text text-error text-label-sm"
                          >
                            {deleting === v.id ? '…' : 'Delete this version'}
                          </button>
                        </summary>
                        <div className="mt-2 surface-inset rounded-xl max-h-40 overflow-auto border-l border-outline-variant/50 pl-3 font-mono text-mono-sm">
                      {v.fields.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 py-0.5 text-on-surface-variant">
                          <span className="text-warning/80">{f.input_field}</span>
                          <Arrow variant="mapping" size="sm" />
                          <span className="text-primary">{f.semantic_field}</span>
                          {f.transformation && (
                            <span className="text-on-surface-variant/60 text-mono-xs">({JSON.stringify(f.transformation)})</span>
                          )}
                        </div>
                      ))}
                    </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}