import { useState } from 'react'
import { ingest, listMappings } from '../api/client'
import type { IngestResponse } from '../api/types'
import { latestMappings } from '../api/types'
import { Code } from './Code'
import { ErrorBanner } from './Status'
import { Modal, useToast } from './ui'
import { useAsync } from '../hooks/useAsync'
import { StatusBadge } from './Status'
import { Spinner } from './Spinner'
import { Dropdown } from './Dropdown'

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
    <Modal open title="Quick parse" onClose={onClose} width="max-w-xl">
      <p className="mb-4 text-body-sm text-on-surface-variant">
        Paste or drop logs, choose a mapping, parse immediately. The event is
        stored and routed straight to the selected mapping.
      </p>
      {error && <ErrorBanner message={error} />}
      <div className="mb-4">
        <label className="mb-1.5 block text-label-sm font-medium text-on-surface-variant">Raw logs</label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={5}
          placeholder="<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny"
          className="input-glass w-full px-3.5 py-2.5 font-mono text-mono-sm text-on-surface"
        />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1.5 block text-label-sm font-medium text-on-surface-variant">Mapping</label>
          <Dropdown
            value={mappingId}
            onChange={(v) => setMappingId(v ? Number(v) : '')}
            options={[
              { value: '', label: 'Choose mapping…' },
              ...latestMappings(mappings.data ?? []).map((m) => ({
                value: m.id,
                label: `${m.source ? `${m.source} · ` : ''}${m.name} (v{m.version}, {m.status})`,
              })),
            ]}
            placeholder="Choose mapping…"
            searchable
            className="w-full"
          />
        </div>
        <label className="btn-secondary cursor-pointer flex items-center justify-center gap-2 h-full min-h-[42px] px-3.5 py-2.5 text-label-sm">
          <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 mr-1.5"><path d="M4 4a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4z" /><path fillRule="evenodd" d="M10 12a2 2 0 100-4 2 2 0 000 4zm-6-2a1 1 0 112 0 1 1 0 01-2 0zM10 7a1 1 0 012 0v5a1 1 0 11-2 0V7z" clipRule="evenodd" /></svg>
          Drop a file…
        </label>
      </div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={parse}
          disabled={busy || !raw.trim() || !mappingId}
          className="btn-primary"
        >
          {busy ? <Spinner size="sm" /> : 'Parse now'}
        </button>
        {result && (result.output || result.normalized) && (
          <button
            onClick={download}
            className="btn-secondary"
          >
            Download output
          </button>
        )}
      </div>
      {result && (
        <div>
          <div className="mb-3 flex items-center gap-2 text-body-sm">
            <StatusBadge status={result.status} />
            <span className="text-on-surface-variant">
              event #{result.stored_event_id}
              {result.duplicate ? ' · duplicate' : ''}
            </span>
          </div>
          <Code value={result.output ?? result.normalized} />
          {result.provenance && (
            <details className="mt-3 surface-inset rounded-xl p-2.5">
              <summary className="cursor-pointer text-label-sm font-semibold text-on-surface-variant transition-colors hover:text-on-surface">Provenance</summary>
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