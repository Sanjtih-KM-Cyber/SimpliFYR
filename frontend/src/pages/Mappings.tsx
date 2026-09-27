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

function FieldRows({ fields, limit }: { fields: Mapping['fields']; limit: number }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? fields : fields.slice(0, limit)
  return (
    <div className="surface-inset rounded-xl max-h-48 overflow-auto font-mono text-mono-sm">
      {shown.map((f, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5 text-on-surface-variant">
          <span className="text-warning/80">{f.input_field}</span>
          <Arrow variant="mapping" size="sm" />
          <span className="text-primary">{f.semantic_field}</span>
          {f.transformation && (
            <span className="text-on-surface-variant/60 text-mono-xs">({JSON.stringify(f.transformation)})</span>
          )}
        </div>
      ))}
      {fields.length > limit && (
        <button
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse field list' : 'Show all fields'}
          className="py-0.5 text-on-surface-variant/60 transition-colors hover:text-primary hover:underline"
        >
          {expanded ? 'Show less' : `+${fields.length - limit} more fields…`}
        </button>
      )}
    </div>
  )
}

function VersionCard({
  mapping,
  deleting,
  onDelete,
  isCurrentVersion,
  totalVersions,
  versionIndex,
}: {
  mapping: Mapping
  deleting: number | string | null
  onDelete: () => void
  isCurrentVersion: boolean
  totalVersions: number
  versionIndex: number
}) {
  return (
    <article className="glass-card rounded-xl p-5 animate-slide-up" aria-label={`Mapping ${mapping.name} v${mapping.version}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 flex-wrap items-center gap-2 text-label-lg font-semibold text-on-surface">
          <span className="truncate">{mapping.name}</span>
          <span className="surface-inset rounded px-1.5 py-0.5 font-mono text-label-sm font-bold text-primary">
            v{mapping.version}
          </span>
          <StatusBadge status={mapping.status} />
          {isCurrentVersion && (
            <span className="rounded bg-primary-container/20 px-1.5 py-0.5 text-label-sm font-semibold text-primary">
              current
            </span>
          )}
        </h3>
      </div>
      <p className="mb-3 text-body-sm text-on-surface-variant">
        {mapping.source ?? 'No source'} · {mapping.event_family}
        {totalVersions > 1 && ` · version ${versionIndex + 1} of ${totalVersions}`}
        {mapping.created_at ? ` · saved ${new Date(mapping.created_at).toLocaleDateString()}` : ''}
      </p>
      <FieldRows fields={mapping.fields} limit={5} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={onDelete}
          disabled={deleting === mapping.id}
          title={`Delete "${mapping.name}" v${mapping.version}`}
          className="ml-auto btn-text text-error text-label-sm"
        >
          {deleting === mapping.id ? '…' : 'Delete version'}
        </button>
      </div>
    </article>
  )
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

  // Sort by name, then version descending (newest first), then id descending
  const sortedMappings = useMemo(() => {
    return [...rows_].sort((a, b) => {
      const nameA = normalizeMappingName(a.name).localeCompare(normalizeMappingName(b.name))
      if (nameA !== 0) return nameA
      return b.version - a.version || b.id - a.id
    })
  }, [rows_])

  // Compute version indices per mapping name group for display
  const versionIndices = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of sortedMappings) {
      const key = normalizeMappingName(m.name)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    const result = new Map<number, { index: number; total: number }>()
    for (const m of sortedMappings) {
      const key = normalizeMappingName(m.name)
      const current = seen.get(key) ?? 0
      seen.set(key, current + 1)
      result.set(m.id, { index: current, total: counts.get(key) ?? 1 })
    }
    return result
  }, [sortedMappings])

  const { toast } = useToast()
  const [deleting, setDeleting] = useState<number | string | null>(null)

  async function deleteVersion(id: number, label: string) {
    if (!window.confirm(`Delete ${label}? Bound recipes unbind; drift history detaches.`)) return
    setDeleting(id)
    try {
      await deleteMapping(id)
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

        {!mappings.loading && !mappings.error && sortedMappings.length === 0 && (
          <EmptyState
            title={sourceFilter ? 'No mappings for this connection' : 'No mappings yet'}
            description="Create one to start normalizing."
          />
        )}

        <div className="grid items-start gap-4 lg:grid-cols-2">
          {sortedMappings.map((mapping) => {
            const vInfo = versionIndices.get(mapping.id) ?? { index: 0, total: 1 }
            const isCurrentVersion = vInfo.index === 0
            return (
              <VersionCard
                key={mapping.id}
                mapping={mapping}
                deleting={deleting}
                onDelete={() => deleteVersion(mapping.id, `"${mapping.name}" v${mapping.version}`)}
                isCurrentVersion={isCurrentVersion}
                totalVersions={vInfo.total}
                versionIndex={vInfo.index}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}