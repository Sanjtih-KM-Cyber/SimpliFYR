import { useMemo, useState } from 'react'
import { createMapping, deleteMapping, listMappings } from '../api/client'
import { normalizeMappingName } from '../api/types'
import type { Mapping } from '../api/types'
import { Code } from '../components/Code'
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

  /** One card per mapping lineage (name ignoring v-suffixes, latest first). */
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
            className="btn-glass bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(16,185,129,0.8)] hover:bg-emerald-400"
          >
            {showForm ? 'Cancel' : '+ New Mapping'}
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        {showForm && (
          <section className="glass-card mb-6 rounded-2xl p-5">
            <h3 className="mb-3 text-sm font-medium text-white">New Mapping</h3>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. VendorX Firewall v1 Traffic)"
                className="input-glass px-3.5 py-2.5 text-sm text-slate-200"
              />
              {sourceFilter ? (
                <input
                  value={sourceFilter}
                  disabled
                  className="input-glass px-3.5 py-2.5 text-sm text-slate-500"
                />
              ) : (
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Source (e.g. VendorX Firewall v1)"
                  className="input-glass px-3.5 py-2.5 text-sm text-slate-200"
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
                    className="input-glass w-1/3 px-3.5 py-2.5 text-sm text-slate-200"
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
                className="btn-glass bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-[0_12px_24px_-12px_rgba(16,185,129,0.8)] hover:bg-emerald-400"
              >
                {submitting ? 'Saving…' : 'Save Mapping'}
              </button>
            </div>
          </section>
        )}

        {mappings.loading && <Spinner />}
        {mappings.error && <p className="text-sm text-red-400">{mappings.error}</p>}

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
              <div key={key} className="glass-card rounded-2xl p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    {m.name}
                    <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-cyan-400">
                      v{m.version}
                    </span>
                    {g.versions.length > 1 && (
                      <button
                        onClick={() => setExpanded(open ? null : key)}
                        title={open ? 'Hide version history' : 'Show all versions'}
                        className="rounded-full border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-400 hover:border-cyan-900/50 hover:text-cyan-300"
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
                      className="rounded border border-rose-900/50 bg-rose-950/20 px-2 py-0.5 text-[11px] font-semibold text-rose-400 transition-colors hover:bg-rose-900/50 disabled:opacity-50"
                    >
                      {deleting === key ? '…' : 'Delete'}
                    </button>
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  {m.source ?? 'No source'} · v{m.version} · {m.event_family}
                </p>
                <div className="max-h-48 overflow-auto">
                  <Code
                    value={m.fields.map((f) => `${f.input_field} → ${f.semantic_field}`).join('\n')}
                  />
                </div>
                {open && (
                  <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                    {g.versions.map((v) => (
                      <details key={v.id} className="group rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                        <summary className="flex cursor-pointer select-none items-center gap-2 text-[12px]">
                          <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span>
                          <span className="font-mono font-bold text-slate-200">{v.name}</span>
                          <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1 py-0.5 font-mono text-[10px] font-bold text-cyan-400">
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
                            className="ml-auto rounded border border-rose-900/50 bg-rose-950/20 px-2 py-0.5 text-[10px] font-semibold text-rose-400 transition-colors hover:bg-rose-900/50 disabled:opacity-50"
                          >
                            {deleting === v.id ? '…' : 'Delete this version'}
                          </button>
                        </summary>
                        <div className="mt-2 max-h-40 overflow-auto border-l border-slate-800 pl-3">
                          <Code
                            value={v.fields.map((f) => `${f.input_field} → ${f.semantic_field}`).join('\n')}
                          />
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
