import { useState } from 'react'
import { dedupLogs } from '../api/client'
import type { DedupResponse } from '../api/client'
import { Arrow } from './Arrow'
import { Code } from './Code'
import { Spinner } from './Spinner'
import { ErrorBanner } from './Status'
import { useToast } from './ui'

export function DedupPanel() {
  const [dedupRaw, setDedupRaw] = useState('')
  const [dedup, setDedup] = useState<DedupResponse | null>(null)
  const [deduping, setDeduping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  async function runDedup() {
    if (!dedupRaw.trim()) {
      setError('Paste logs or drop a file first')
      return
    }
    setDeduping(true)
    setError(null)
    try {
      setDedup(await dedupLogs(dedupRaw))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDeduping(false)
    }
  }

  function onDedupFile(file: File | undefined) {
    if (!file) return
    // Hold Deduplicate until the file lands (FileReader is async).
    setDeduping(true)
    const reader = new FileReader()
    reader.onload = () => {
      setDedupRaw(String(reader.result ?? ''))
      setDeduping(false)
    }
    reader.onerror = () => {
      setError('Could not read file')
      setDeduping(false)
    }
    reader.readAsText(file)
  }

  function downloadDeduped() {
    if (!dedup) return
    const blob = new Blob([dedup.patterns.map((p) => p.sample).join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `simplifyr-deduped-${dedup.patterns.length}patterns.txt`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    toast(`Downloaded ${dedup.patterns.length} pattern representatives`, 'success')
  }

  return (
    <section className="surface-panel rounded-2xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant/70">
            Deduplication
          </p>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Paste or drop raw logs - collapses pattern-wise, first log per pattern kept. Nothing is stored.
          </p>
        </div>
        <div className="flex gap-2">
          <label className="btn-secondary cursor-pointer px-3.5 py-2.5 text-body-sm">
            Drop a file…
            <input type="file" className="hidden" onChange={(e) => onDedupFile(e.target.files?.[0])} />
          </label>
          <button
            onClick={runDedup}
            disabled={deduping || !dedupRaw.trim()}
            className="btn-primary"
          >
            {deduping ? <Spinner size="sm" /> : 'Deduplicate'}
          </button>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      <textarea
        value={dedupRaw}
        onChange={(e) => setDedupRaw(e.target.value)}
        rows={4}
        placeholder="<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 action=deny"
        className="input-glass mb-3 w-full px-3.5 py-2.5 font-mono text-mono-sm text-on-surface"
      />
      {deduping && <Spinner />}
      {dedup && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="text-body-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">{dedup.total}</span> lines <Arrow variant="inline" size="sm" /> <span className="font-semibold text-on-surface">{dedup.patterns.length}</span> patterns
            </p>
            <button
              onClick={downloadDeduped}
              className="btn-secondary text-label-sm"
            >
              Download deduped
            </button>
          </div>
          <div className="space-y-2">
            {dedup.patterns.map((p, i) => (
              <div key={i} className="surface-inset rounded-xl p-3 text-body-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="surface-inset rounded px-1.5 py-0.5 font-mono font-bold uppercase text-warning border border-warning/20">
                    {p.format}
                  </span>
                  <span className="surface-inset rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-on-surface-variant">
                    × {p.count}
                  </span>
                  {p.fields.length > 0 && (
                    <span className="font-mono text-on-surface-variant/70">{p.fields.join(', ')}</span>
                  )}
                </div>
                <Code value={p.sample} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
