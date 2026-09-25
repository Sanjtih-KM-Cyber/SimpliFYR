import { useState } from 'react'
import {
  createRecipe,
  deleteRecipe,
  ingest,
  listMappings,
  listOutputProfiles,
  listRecipes,
} from '../api/client'
import type { IngestResponse, Recipe } from '../api/types'
import { Code } from './Code'
import { ErrorBanner, StatusBadge } from './Status'
import { useToast } from './ui'
import { useAsync } from '../hooks/useAsync'

/** Try-it-now: ingest a sample through this connection, see the output,
 *  download it — and bind a profile so the recipe sticks. */
export function TryItNow({ sourceName }: { sourceName: string }) {
  const profiles = useAsync(() => listOutputProfiles(), [])
  const bindings = useAsync(() => listRecipes(), [])
  const mappings = useAsync(() => listMappings(), [])
  const [raw, setRaw] = useState('')
  const [profileId, setProfileId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [bindBusy, setBindBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResponse | null>(null)
  const { toast } = useToast()

  const binding: Recipe | null =
    (bindings.data ?? []).find((r) => r.source === sourceName) ?? null
  const connectionMapping =
    (mappings.data ?? []).filter((m) => m.source === sourceName).sort((a, b) => b.id - a.id)[0] ?? null
  const boundProfileName =
    (profiles.data ?? []).find((p) => p.id === binding?.output_profile_id)?.name ?? null

  async function bind() {
    if (!profileId || !connectionMapping) return
    setBindBusy(true)
    setError(null)
    try {
      await createRecipe({
        source: sourceName,
        mappingId: connectionMapping.id,
        outputProfileId: Number(profileId),
      })
      toast(`Bound ${connectionMapping.name} → ${profiles.data?.find((p) => p.id === profileId)?.name}`, 'success')
      bindings.reload()
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBindBusy(false)
    }
  }

  async function unbind() {
    if (!binding) return
    setBindBusy(true)
    setError(null)
    try {
      await deleteRecipe(binding.id)
      toast('Recipe unbound', 'success')
      bindings.reload()
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBindBusy(false)
    }
  }

  async function run() {
    if (!raw.trim()) {
      setError('Paste logs or drop a file first')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(
        await ingest({
          raw,
          source: sourceName,
          outputProfileId: profileId ? Number(profileId) : undefined,
        }),
      )
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
    const blob = new Blob([JSON.stringify(result.output ?? result.normalized, null, 2)], {
      type: 'application/json',
    })
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
    <section id="try-it" className="mb-6 rounded-lg border border-emerald-900 bg-slate-900 p-4">
      <h3 className="mb-2 text-sm font-medium text-white">Try it now — ingest, see the output, download it</h3>
      {binding && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
          <span>
            Bound: <span className="font-mono text-slate-200">{connectionMapping?.name ?? `mapping #${binding.mapping_id}`}</span>
            {' → '}
            <span className="font-mono text-emerald-400">{boundProfileName ?? 'no profile'}</span>
          </span>
          <button
            onClick={unbind}
            disabled={bindBusy}
            className="rounded border border-red-800 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950/50 disabled:opacity-50"
          >
            {bindBusy ? '…' : 'Unbind'}
          </button>
        </p>
      )}
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
        <button
          onClick={bind}
          disabled={bindBusy || !profileId || !connectionMapping}
          title={
            connectionMapping
              ? `Bind ${connectionMapping.name} → selected profile`
              : 'This connection has no mapping yet — create one first'
          }
          className="rounded-md border border-cyan-900/50 px-3 py-2 text-sm text-cyan-400 hover:bg-cyan-950/30 disabled:opacity-40"
        >
          {bindBusy ? 'Binding…' : 'Bind profile'}
        </button>
        <label className="cursor-pointer rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
          Drop a file…
          <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button
          onClick={run}
          disabled={busy || !raw.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Running…' : `Run via ${sourceName}`}
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
