import { useState } from 'react'
import { ingest, listMappings } from '../api/client'
import type { IngestResponse } from '../api/types'
import { Code } from './Code'
import { ErrorBanner } from './Status'
import { Modal, useToast } from './ui'
import { useAsync } from '../hooks/useAsync'
import { StatusBadge } from './Status'

/** Home quick-parse: paste/drop logs, pick a mapping, see the output,
 *  download it on the spot. Events route straight to the chosen mapping. */
export function QuickParseModal({ onClose }: { onClose: () => void }) {
  const mappings = useAsync(() => listMappings(), [])
  const [raw, setRaw] = useState('')
  const [mappingId, setMappingId] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<IngestResponse | null>(null)
  const { toast } = useToast()

  function onFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setRaw(String(reader.result ?? ''))
    reader.onerror = () => setError('Could not read file')
    reader.readAsText(file)
  }

  async function parse() {
    if (!raw.trim()) {
      setError('Paste logs or drop a file first')
      return
    }
    if (!mappingId) {
      setError('Choose the mapping to parse with')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await ingest({ raw, mappingId: Number(mappingId) })
      setResult(res)
      if (res.status === 'quarantined' || res.status === 'dlq') {
        toast(`Event #${res.stored_event_id} ${res.status} — see Logs`, 'info')
      }
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
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
    <Modal open title="Quick parse" onClose={onClose}>
      <p className="mb-3 text-xs text-slate-400">
        Paste or drop logs, choose a mapping, parse immediately. The event is
        stored and routed straight to the selected mapping.
      </p>
      {error && <ErrorBanner message={error} />}
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={5}
        placeholder="<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
        className="mb-2 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={mappingId}
          onChange={(e) => setMappingId(e.target.value ? Number(e.target.value) : '')}
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
        >
          <option value="">Choose mapping…</option>
          {(mappings.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.source ? `${m.source} · ` : ''}{m.name} (v{m.version}, {m.status})
            </option>
          ))}
        </select>
        <label className="cursor-pointer rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
          Drop a file…
          <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      <div className="mb-3 flex gap-2">
        <button
          onClick={parse}
          disabled={busy || !raw.trim() || !mappingId}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? 'Parsing…' : 'Parse now'}
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
            <span className="text-slate-400">
              event #{result.stored_event_id}
              {result.duplicate ? ' · duplicate' : ''}
            </span>
          </div>
          <Code value={result.output ?? result.normalized} />
          {result.provenance && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-slate-400">Provenance</summary>
              <div className="mt-2">
                <Code value={result.provenance} />
              </div>
            </details>
          )}
        </div>
      )}
    </Modal>
  )
}
