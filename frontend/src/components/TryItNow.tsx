import { useState } from 'react'
import {
  createRecipe,
  deleteRecipe,
  exportLogs,
  ingest,
  listMappings,
  listOutputProfiles,
  listRecipes,
  processBatch,
} from '../api/client'
import type { BatchResult, IngestResponse, Recipe } from '../api/types'
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
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResponse | null>(null)
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const { toast } = useToast()

  const FORMAT_TITLES: Record<string, string> = {
    syslog: 'Key-Value Syslog Logs',
    cef: 'Common Event Format (CEF) Logs',
    leef: 'LEEF Logs',
    json: 'JSON Formatted Logs',
    xml: 'XML Logs',
    csv: 'CSV Logs',
    raw: 'Unstructured / Unparsed Raw Logs',
    unknown: 'Unknown Format Logs',
  }

  function formatTitle(fmt: string): string {
    const key = (fmt || 'unknown').toLowerCase()
    return FORMAT_TITLES[key] ?? `${key.toUpperCase()} Logs`
  }

  function batchGroups(res: BatchResult): { key: string; title: string; count: number }[] {
    const counts = new Map<string, number>()
    for (const r of res.results ?? []) {
      const key = (r.detected_format || 'unknown').toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const order = ['syslog', 'cef', 'leef', 'json', 'xml', 'csv', 'raw', 'unknown']
    return [...counts.entries()]
      .sort(([a], [b]) => {
        const ai = order.indexOf(a)
        const bi = order.indexOf(b)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.localeCompare(b)
      })
      .map(([key, count], i) => ({ key, title: `## ${i + 1}. ${formatTitle(key)}`, count }))
  }

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
    setBatchResult(null)
    try {
      const nonEmpty = raw.split('\n').filter((ln) => ln.trim().length > 0)
      if (nonEmpty.length > 1) {
        // Multi-line input: one log per line, each with its own format.
        // A single /ingest call would detect+parse the whole blob as one
        // event and drop lines — route through the batch pipeline so
        // syslog/CEF/JSON/raw lines each survive with their own format.
        const res = await processBatch({
          raw,
          source: sourceName,
          ...(profileId ? { outputProfileId: Number(profileId) } : {}),
        })
        setBatchResult(res)
        toast(
          `Processed ${res.processed}/${res.total} lines (${res.normalized + res.output} normalized, ${res.quarantined} held, ${res.dlq} dlq)`,
          res.quarantined + res.dlq > 0 ? 'info' : 'success',
        )
      } else {
        setResult(
          await ingest({
            raw,
            source: sourceName,
            outputProfileId: profileId ? Number(profileId) : undefined,
          }),
        )
      }
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
    // Block Run until the file lands in the box: FileReader is async, and
    // a fast click would otherwise ingest the previous one-line sample.
    setBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      setRaw(String(reader.result ?? ''))
      setBusy(false)
    }
    reader.onerror = () => {
      setError('Could not read file')
      setBusy(false)
    }
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

  async function downloadAllNormalized() {
    setDownloading(true)
    try {
      const res = await exportLogs({ format: 'json', status: 'normalized,output' })
      toast(`Downloaded all ${res.total} logs (${res.normalized} normalized)`, 'success')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(false)
    }
  }

  async function downloadBatchSet(segregated: boolean) {
    if (!batchResult?.batch_id) return
    setDownloading(true)
    try {
      if (segregated) {
        const res = await exportLogs({ format: 'markdown', batch_id: batchResult.batch_id })
        toast(`Downloaded segregated set (${res.total} logs, by format)`, 'success')
      } else {
        const res = await exportLogs({ format: 'json', batch_id: batchResult.batch_id, payload: 'output' })
        toast(`Downloaded this run's ${res.total} logs (${res.normalized} normalized)`, 'success')
      }
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setDownloading(false)
    }
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
        <button
          onClick={downloadAllNormalized}
          disabled={downloading}
          title="Every normalized log in the system, uncapped"
          className="btn-outlined text-label-sm"
        >
          {downloading ? <Spinner size="sm" label="Bundling…" /> : 'Download all normalized'}
        </button>
      </div>
      {result && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-body-sm">
            <StatusBadge status={result.status} />
            <span className="text-on-surface-variant">event #{result.stored_event_id}</span>
          </div>
          <Code value={result.output ?? result.normalized} truncate maxLines={15} />
        </div>
      )}
      {batchResult && (
        <div className="surface-inset rounded-xl p-3.5 text-body-sm text-on-surface">
          <p>
            Processed <span className="font-semibold">{batchResult.processed}/{batchResult.total}</span> lines
            ({batchResult.normalized} normalized · {batchResult.output} output · {batchResult.quarantined} held · {batchResult.dlq} dlq)
            {batchResult.batch_id != null && (
              <span className="text-on-surface-variant"> — batch <span className="font-mono font-semibold text-primary">#{batchResult.batch_id}</span></span>
            )}
          </p>
          <div className="mt-3 space-y-1.5">
            {batchGroups(batchResult).map((g) => (
              <p key={g.key} className="font-mono text-mono-sm">
                <span className="font-semibold text-on-surface">{g.title}</span>
                <span className="text-on-surface-variant"> — {g.count} line{g.count === 1 ? '' : 's'} ({g.key})</span>
              </p>
            ))}
          </div>
          {batchResult.quarantined + batchResult.dlq > 0 && (
            <p className="mt-2 text-warning">
              Held lines are preserved (never dropped) — open Review Queue to approve their fields (e.g. ruleid → rule.id, threatlvl → threat.level, sessionbytes → network.bytes), or download the segregated set below.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => downloadBatchSet(false)}
              disabled={downloading || batchResult.batch_id == null}
              className="btn-outlined text-label-sm"
            >
              {downloading ? <Spinner size="sm" label="Bundling…" /> : 'Download this run (JSON)'}
            </button>
            <button
              onClick={() => downloadBatchSet(true)}
              disabled={downloading || batchResult.batch_id == null}
              title="Grouped under ## headings per detected format, nested event/observer/source/destination/network/rule/log JSON, raw fallback for held lines"
              className="btn-outlined text-label-sm"
            >
              {downloading ? <Spinner size="sm" label="Bundling…" /> : 'Download segregated (Markdown)'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}