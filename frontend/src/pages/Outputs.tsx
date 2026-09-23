import { useState } from 'react'
import {
  createOutputProfile,
  createRecipe,
  deleteRecipe,
  ingest,
  listMappings,
  listOutputProfiles,
  listRecipes,
} from '../api/client'
import type { IngestResponse, Recipe } from '../api/types'
import { Code, Empty } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { ErrorBanner, StatusBadge } from '../components/Status'
import { useAsync } from '../hooks/useAsync'
import { useToast } from '../components/ui'

interface Row {
  output_field: string
  from_semantic: string
}

function BindingCard({
  sourceName,
  binding,
  mappingName,
  mappingStatus,
  profileName,
  onUnbind,
  onReload,
}: {
  sourceName: string
  binding: Recipe | null
  mappingName: string | null
  mappingStatus: string | null
  profileName: string | null
  onUnbind: () => Promise<void>
  onReload: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function unbind() {
    if (!binding) return
    setBusy(true)
    setError(null)
    try {
      await onUnbind()
      onReload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <h3 className="mb-3 text-sm font-medium text-white">Recipe Binding</h3>
      {error && <ErrorBanner message={error} />}
      {binding ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-slate-300">
            <span className="font-medium text-white">{sourceName}</span>
            <span className="text-slate-500"> → </span>
            {mappingName ?? `mapping #${binding.mapping_id}`}
            {mappingStatus && (
              <span className="ml-2 inline-block align-middle">
                <StatusBadge status={mappingStatus} />
              </span>
            )}
            <span className="text-slate-500"> → </span>
            {profileName ?? (binding.output_profile_id ? `profile #${binding.output_profile_id}` : 'no profile')}
          </span>
          <button
            onClick={unbind}
            disabled={busy}
            className="rounded-md border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50 disabled:opacity-50"
          >
            {busy ? 'Unbinding…' : 'Unbind recipe'}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No recipe binding yet — outputs apply per-request. Bind a profile below to configure
          this connection once.
        </p>
      )}
    </section>
  )
}

function TryItPanel({ sourceName }: { sourceName?: string }) {
  const profiles = useAsync(() => listOutputProfiles(), [])
  const [raw, setRaw] = useState('')
  const [profileId, setProfileId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResponse | null>(null)
  const { toast } = useToast()

  async function run() {
    if (!raw.trim()) {
      setError('Paste logs or drop a file first')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await ingest({
        raw,
        source: sourceName,
        outputProfileId: profileId ? Number(profileId) : undefined,
      })
      setResult(res)
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRaw(String(reader.result ?? ''))
    reader.onerror = () => setError('Could not read file')
    reader.readAsText(file)
  }

  function download() {
    if (!result?.output && !result?.normalized) return
    const blob = new Blob(
      [JSON.stringify(result.output ?? result.normalized, null, 2)],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `simplifyr-event-${result.stored_event_id}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="mb-6 rounded-lg border border-emerald-900 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-medium text-white">Try it now — ingest, see the output, download it</h3>
      {error && <ErrorBanner message={error} />}
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={4}
        placeholder="<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
        className="mb-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value ? Number(e.target.value) : '')}
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
        >
          <option value="">Render with… (bound profile by default)</option>
          {(profiles.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="cursor-pointer rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
          Drop a file…
          <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button
          onClick={run}
          disabled={busy || !raw.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Running…' : sourceName ? `Run via ${sourceName}` : 'Run'}
        </button>
        {result && (result.output || result.normalized) && (
          <button
            onClick={download}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Download output
          </button>
        )}
      </div>
      {result && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm">
            <StatusBadge status={result.status} />
            <span className="text-slate-400">event #{result.stored_event_id}</span>
          </div>
          <Code value={result.output ?? result.normalized} />
        </div>
      )}
    </section>
  )
}

export default function Outputs({
  embedded,
  sourceName,
}: {
  embedded?: boolean
  sourceName?: string
}) {
  const profiles = useAsync(() => listOutputProfiles(), [])
  const bindings = useAsync(
    () => (sourceName ? listRecipes() : Promise.resolve<Recipe[] | null>(null)),
    [sourceName],
  )
  const mappings = useAsync(
    () => (sourceName ? listMappings() : Promise.resolve<null>(null)),
    [sourceName],
  )
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [rows, setRows] = useState<Row[]>([{ output_field: '', from_semantic: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bindBusy, setBindBusy] = useState<number | null>(null)

  const binding = sourceName
    ? (bindings.data ?? []).find((r) => r.source === sourceName) ?? null
    : null
  const boundProfileId = binding?.output_profile_id ?? null
  const boundProfileName =
    (profiles.data ?? []).find((p) => p.id === boundProfileId)?.name ?? null

  const connectionMapping = sourceName
    ? (mappings.data ?? [])
        .filter((m) => m.source === sourceName)
        .sort((a, b) => b.id - a.id)[0] ?? null
    : null

  function submit() {
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
    createOutputProfile({
      name: name.trim(),
      fields: fields.map((f) => ({ output_field: f.output_field, from_semantic: f.from_semantic })),
    })
      .then(() => {
        setName('')
        setRows([{ output_field: '', from_semantic: '' }])
        setShowForm(false)
        profiles.reload()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSubmitting(false))
  }

  async function bind(profileId: number) {
    if (!sourceName || !connectionMapping) return
    setBindBusy(profileId)
    setError(null)
    try {
      await createRecipe({
        source: sourceName,
        mappingId: connectionMapping.id,
        outputProfileId: profileId,
      })
      bindings.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBindBusy(null)
    }
  }

  async function unbind() {
    if (!binding) return
    await deleteRecipe(binding.id)
  }

  return (
    <div>
      {!embedded && (
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-white">Output Profiles</h2>
            <p className="text-sm text-slate-400">
              Choose how normalized events are represented.
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {showForm ? 'Cancel' : '+ Custom Profile'}
          </button>
        </header>
      )}

      {embedded && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Bind a profile to configure this connection once — incoming logs follow the recipe.
          </p>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {showForm ? 'Cancel' : '+ Custom Profile'}
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {sourceName && (
        <BindingCard
          sourceName={sourceName}
          binding={binding}
          mappingName={connectionMapping?.name ?? null}
          mappingStatus={connectionMapping?.status ?? null}
          profileName={boundProfileName}
          onUnbind={unbind}
          onReload={() => bindings.reload()}
        />
      )}

      {sourceName && <TryItPanel sourceName={sourceName} />}

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
                      prev.map((r, idx) =>
                        idx === i ? { ...r, output_field: e.target.value } : r,
                      ),
                    )
                  }
                  placeholder="Output field"
                  className="w-1/2 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                />
                <input
                  value={row.from_semantic}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r, idx) =>
                        idx === i ? { ...r, from_semantic: e.target.value } : r,
                      ),
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
              onClick={() =>
                setRows((prev) => [...prev, { output_field: '', from_semantic: '' }])
              }
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
      {!profiles.loading && (profiles.data?.length ?? 0) === 0 && (
        <Empty message="No output profiles." />
      )}

      <details>
        <summary className="cursor-pointer text-sm text-slate-400 hover:text-white">
          Profile reference ({(profiles.data ?? []).length})
        </summary>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {(profiles.data ?? []).map((p) => {
          const isBound = boundProfileId === p.id
          return (
            <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <div className="mb-1 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                  {p.name}
                  {isBound && (
                    <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-xs font-medium text-emerald-100">
                      bound
                    </span>
                  )}
                </h3>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    p.is_preset
                      ? 'bg-indigo-700 text-indigo-100'
                      : 'bg-slate-700 text-slate-200'
                  }`}
                >
                  {p.is_preset ? 'preset' : 'custom'}
                </span>
              </div>
              {p.description && (
                <p className="mb-2 text-xs text-slate-500">{p.description}</p>
              )}
              <div className="max-h-48 overflow-auto">
                <Code
                  value={
                    p.profile_schema.include_all
                      ? 'emit full normalized event'
                      : p.profile_schema.fields
                          .map((f) => `${f.from} → ${f.output_field}`)
                          .join('\n')
                  }
                />
              </div>
              {sourceName && !isBound && (
                <button
                  onClick={() => bind(p.id)}
                  disabled={bindBusy !== null || !connectionMapping}
                  title={
                    connectionMapping
                      ? undefined
                      : 'This connection has no mapping yet — create one first'
                  }
                  className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                >
                  {bindBusy === p.id ? 'Binding…' : 'Bind to this connection'}
                </button>
              )}
            </div>
          )
        })}
        </div>
      </details>
    </div>
  )
}
