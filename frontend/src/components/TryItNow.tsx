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
import { Arrow } from './Arrow'
import { Code } from './Code'
import { ErrorBanner, StatusBadge } from './Status'
import { useToast } from './ui'
import { useAsync } from '../hooks/useAsync'
import { Spinner } from './Spinner'
import { Dropdown } from './Dropdown'

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
      toast(`Bound ${connectionMapping.name} <Arrow variant="binding" size="sm" /> ${profiles.data?.find((p) => p.id === profileId)?.name}`, 'success')
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
    <section id="try-it" className="mb-6 surface-panel rounded-2xl p-5">
      <h3 className="mb-2 text-title-sm font-semibold text-on-surface">Try it now — ingest, see the output, download it</h3>
      {binding && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
          <span>
            Bound: <span className="font-mono text-on-surface">{connectionMapping?.name ?? `mapping #${binding.mapping_id}`}</span>
            <Arrow variant="binding" size="sm" className="mx-1" />
            <span className="font-mono text-success">{boundProfileName ?? 'no profile'}</span>
          </span>
          <button
            onClick={unbind}
            disabled={bindBusy}
            className="btn-outlined text-label-sm"
          >
            {bindBusy ? <Spinner size="sm" /> : 'Unbind'}
          </button>
        </p>
      )}
      {error && <ErrorBanner message={error} />}
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={4}
        placeholder="<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
        className="mb-2 input-glass w-full px-3.5 py-2.5 font-mono text-mono-sm text-on-surface"
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Dropdown<number>
          value={profileId === '' ? undefined : profileId}
          onChange={(v) => setProfileId(v ?? '')}
          options={(profiles.data ?? []).map((p) => ({
            value: p.id,
            label: p.name,
          }))}
          placeholder="Render with… (bound profile by default)"
          searchable
          allowClear
          className="flex-1 min-w-[200px]"
        />
        <button
          onClick={bind}
          disabled={bindBusy || !profileId || !connectionMapping}
          title={
            connectionMapping
              ? `Bind ${connectionMapping.name} → selected profile`
              : 'This connection has no mapping yet — create one first'
          }
          className="btn-outlined text-label-sm"
        >
          {bindBusy ? <Spinner size="sm" /> : 'Bind profile'}
        </button>
        <label className="btn-text cursor-pointer px-3.5 py-2.5 text-label-sm">
          Drop a file…
          <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <button
          onClick={run}
          disabled={busy || !raw.trim()}
          className="btn-primary"
        >
          {busy ? <Spinner size="sm" /> : `Run via ${sourceName}`}
        </button>
        {result && (result.output || result.normalized) && (
          <button
            onClick={download}
            className="btn-outlined text-label-sm"
          >
            Download output
          </button>
        )}
      </div>
      {result && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-body-sm">
            <StatusBadge status={result.status} />
            <span className="text-on-surface-variant">event #{result.stored_event_id}</span>
          </div>
          <Code value={result.output ?? result.normalized} />
        </div>
      )}
    </section>
  )
}