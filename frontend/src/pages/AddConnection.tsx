import { useState } from 'react'
import { Link } from 'react-router-dom'
import { analyzeOnboarding, approveOnboarding, createOnboarding, ingest, listOutputProfiles, previewIngest } from '../api/client'
import type { Format, IngestResponse } from '../api/types'
import { Code } from '../components/Code'
import { SemanticFieldInput } from '../components/SemanticFieldInput'
import { Spinner } from '../components/Spinner'
import { ErrorBanner } from '../components/Status'
import { PageHeader } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

function sourceKeys(parsed: Record<string, unknown> | null, format: Format): string[] {
  if (!parsed) return []
  if (format === 'syslog' || format === 'leef') {
    const f = (parsed.fields ?? {}) as Record<string, unknown>
    return Object.keys(f)
  }
  if (format === 'cef') {
    const e = (parsed.extensions ?? {}) as Record<string, unknown>
    return Object.keys(e)
  }
  return Object.keys(parsed)
}

interface Row {
  input_field: string
  semantic_field: string
}

const SAMPLE = '<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny'

export default function AddConnection() {
  const profiles = useAsync(() => listOutputProfiles(), [])
  const [raw, setRaw] = useState(SAMPLE)
  const [connectionName, setConnectionName] = useState('')
  const [analysis, setAnalysis] = useState<IngestResponse | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [mappingName, setMappingName] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [profileId, setProfileId] = useState<number | ''>('')
  const [preview, setPreview] = useState<IngestResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)

  async function analyze() {
    setAnalyzing(true)
    setError(null)
    setPreview(null)
    try {
      // Side-effect-free preview: detects + parses without storing an event,
      // so wizard probing never pollutes connections or review queues.
      const res = await previewIngest(raw)
      setAnalysis({ detection: res.detection, parsed: res.parsed } as IngestResponse)
      const keys = sourceKeys(res.parsed, res.detection.format)
      setRows(keys.map((k) => ({ input_field: k, semantic_field: '' })))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAnalyzing(false)
    }
  }

  async function autoSuggest() {
    setSuggesting(true)
    setError(null)
    try {
      const res = await analyzeOnboarding(raw, connectionName || undefined)
      const suggestions = new Map(res.suggestions.map((s) => [s.input_field, s.semantic_field]))
      setRows(
        [...suggestions.keys()].map((k) => ({ input_field: k, semantic_field: suggestions.get(k) ?? '' })),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSuggesting(false)
    }
  }

  async function previewOutput() {
    if (!analysis) return
    if (!connectionName.trim()) {
      setError('Connection name is required')
      return
    }
    setPreviewing(true)
    setError(null)
    try {
      const fields = rows.filter((r) => r.input_field.trim() && r.semantic_field.trim())
      // Persisted onboarding flow: sample -> analyze -> approve publishes the
      // versioned mapping + recipe (with Approval + audit) in one step.
      const onboarding = await createOnboarding(raw, connectionName.trim())
      await approveOnboarding(onboarding.id, {
        sourceName: connectionName.trim(),
        mappingName: mappingName.trim() || `${connectionName.trim()} Mapping`,
        fields,
        outputProfileId: profileId ? Number(profileId) : undefined,
      })
      // Preview through the recipe just published (source auto-resolves).
      const res = await ingest({
        raw,
        source: connectionName.trim(),
        outputProfileId: profileId ? Number(profileId) : undefined,
      })
      setPreview(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPreviewing(false)
    }
  }

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const saved = preview !== null && connectionName.trim() !== ''

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Pipeline Wizard"
        subtitle="Establish data sequence schema. Provide log samples, compute structural mapping, and assign destination."
      />

      {error && <ErrorBanner message={error} />}

      <div className="mx-auto w-full max-w-4xl space-y-6 pb-20">
        <section className="animate-slide-up rounded-lg border border-slate-700/50 p-5 glass-card">
          <div className="mb-4 flex items-center gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-800 bg-cyan-950/50 text-[11px] font-bold text-cyan-400">1</div>
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-white">Connection Identity</h3>
          </div>
          <input
            value={connectionName}
            onChange={(e) => setConnectionName(e.target.value)}
            placeholder="e.g. CrowdStrike Falcon, AWS CloudTrail"
            className="w-full rounded border border-slate-700 bg-slate-950 px-4 py-2.5 text-[13px] text-slate-200 outline-none transition-colors focus:border-cyan-500/50"
          />
        </section>

        <section className="animate-slide-up rounded-lg border border-slate-700/50 p-5 glass-card" style={{ animationDelay: '50ms' }}>
          <div className="mb-4 flex items-center gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-800 bg-cyan-950/50 text-[11px] font-bold text-cyan-400">2</div>
            <h3 className="text-[13px] font-bold uppercase tracking-wider text-white">Telemetry Sample (Raw Context)</h3>
          </div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            className="w-full resize-none rounded border border-slate-700 bg-slate-950 p-4 font-mono text-[11px] text-slate-300 outline-none transition-colors focus:border-cyan-500/50"
          />
          <div className="mt-4 flex justify-end">
            <button
              onClick={analyze}
              disabled={analyzing || !raw.trim()}
              className="rounded bg-cyan-600 px-6 py-2 text-[12px] font-bold uppercase tracking-wider text-white shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all hover:bg-cyan-500 hover:shadow-[0_0_15px_rgba(6,182,212,0.5)] disabled:opacity-50 disabled:shadow-none"
            >
              {analyzing ? 'Synthesizing…' : 'Synthesize Schema'}
            </button>
          </div>
        </section>

        {analyzing && <div className="flex justify-center py-4"><Spinner /></div>}

        {analysis && (
          <section className="animate-slide-up rounded-lg border border-cyan-900/30 bg-cyan-950/10 p-5 glass-card" style={{ animationDelay: '100ms' }}>
            <div className="mb-4 flex items-center justify-between border-b border-cyan-900/50 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-amber-800 bg-amber-950/50 text-[11px] font-bold text-amber-400">3</div>
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-cyan-400">Detection Matrix</h3>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-4 rounded border border-slate-800 bg-slate-900/80 p-3 shadow-inner">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Format Detected</span>
                <span className="font-mono text-[13px] font-semibold text-white">{analysis.detection.format}</span>
              </div>
              <div className="h-6 w-px bg-slate-700"></div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Confidence Model</span>
                <span className="font-mono text-[13px] font-semibold text-emerald-400">
                  {Math.round(analysis.detection.confidence * 100)}%
                </span>
              </div>
              <div className="h-6 w-px bg-slate-700"></div>
              <div className="flex-1 text-[11px] italic leading-tight text-slate-400">
                " {analysis.detection.detail} "
              </div>
            </div>

            <div className="overflow-hidden rounded border border-cyan-900/30 bg-cyan-950/20">
              <Code value={analysis.parsed} />
            </div>
          </section>
        )}

        {analysis && (
          <section className="animate-slide-up rounded-lg border border-slate-700/50 p-5 glass-card" style={{ animationDelay: '150ms' }}>
            <div className="mb-4 flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-cyan-800 bg-cyan-950/50 text-[11px] font-bold text-cyan-400">4</div>
                <h3 className="text-[13px] font-bold uppercase tracking-wider text-white">AST Map Configuration</h3>
              </div>
            </div>

            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Mapping Identifier</label>
                <input
                  value={mappingName}
                  onChange={(e) => setMappingName(e.target.value)}
                  placeholder={`${connectionName || 'Connection'} Mapping (Default)`}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-[12px] text-slate-200 outline-none focus:border-cyan-500/50"
                />
              </div>
              <div className="flex items-end pb-0.5">
                <button
                  onClick={autoSuggest}
                  disabled={suggesting || !raw.trim()}
                  className="w-full rounded border border-cyan-900 bg-cyan-950/30 px-4 py-2 text-[12px] font-bold uppercase tracking-wider text-cyan-400 transition-colors hover:bg-cyan-900/50 disabled:opacity-50"
                >
                  {suggesting ? 'Initializing Autopilot…' : 'Run Autopilot Suggestion'}
                </button>
              </div>
            </div>

            <div className="mb-6 space-y-2 rounded border border-slate-800 bg-slate-900/50 p-3 shadow-inner">
              {rows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
                  <span className="w-full truncate rounded bg-slate-950 px-3 py-1.5 font-mono text-[11px] text-amber-500/80 border border-amber-900/20 lg:w-1/3">
                    {row.input_field}
                  </span>
                  <SemanticFieldInput
                    value={row.semantic_field}
                    onChange={(v) => updateRow(i, { semantic_field: v })}
                  />
                  <div className="hidden lg:flex w-1/4 items-center">
                    <span className="text-[10px] text-slate-500">→ {row.semantic_field || '(UNASSIGNED)'}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4 border-t border-slate-800/80 pt-4">
              <h3 className="mb-2 text-[13px] font-bold uppercase tracking-wider text-white">Delivery Output Link</h3>
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value ? Number(e.target.value) : '')}
                className="w-full max-w-md rounded border border-slate-700 bg-slate-950 px-4 py-2.5 text-[12px] font-semibold text-slate-200 outline-none focus:border-cyan-500/50"
              >
                <option value="">No delivery profile (Log indexing only)…</option>
                {(profiles.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end border-t border-slate-800/80 pt-4">
              <button
                onClick={previewOutput}
                disabled={previewing || rows.every((r) => !r.semantic_field)}
                className="rounded bg-emerald-600 px-6 py-2.5 text-[12px] font-bold uppercase tracking-wider text-white shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all hover:bg-emerald-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.5)] disabled:opacity-50 disabled:shadow-none"
              >
                {previewing ? 'Committing…' : 'Publish Pipeline Sequence'}
              </button>
            </div>
          </section>
        )}

        {previewing && <div className="flex justify-center py-4"><Spinner /></div>}

        {saved && (
          <div className="animate-slide-up rounded-lg border border-emerald-900/50 bg-emerald-950/30 p-5 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
            <p className="text-[13px] font-semibold text-emerald-400">
              Pipeline Established. Structural context compiled. Streams linked to{' '}
              <span className="font-bold text-white">{connectionName.trim()}</span> will auto-index.
            </p>
            <div className="mt-4">
              <Link
                to={`/connections/${encodeURIComponent(connectionName.trim())}`}
                className="inline-block rounded border border-emerald-700 bg-emerald-900/50 px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-800/80 hover:text-white"
              >
                Monitor Pipeline Sequence →
              </Link>
            </div>
          </div>
        )}

        {preview && (
          <div className="animate-slide-up grid gap-4 lg:grid-cols-2 mt-6">
            <section className="rounded-lg border border-slate-700/50 bg-slate-900 p-4 glass-card">
              <div className="mb-3 flex items-center gap-2 border-b border-cyan-900/50 pb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-cyan-500 shadow-[0_0_5px_rgba(6,182,212,0.8)]"></div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-cyan-500">Normalized Intermediary</h3>
              </div>
              <div className="overflow-hidden rounded border border-slate-800/80 bg-slate-950/80">
                <Code value={preview.normalized} />
              </div>
            </section>
            <section className="rounded-lg border border-slate-700/50 bg-slate-900 p-4 glass-card">
              <div className="mb-3 flex items-center gap-2 border-b border-emerald-900/50 pb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]"></div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Delivery Payload Target</h3>
              </div>
              <div className="overflow-hidden rounded border border-slate-800/80 bg-slate-950/80">
                <Code value={preview.output ?? preview.normalized} />
              </div>
              {preview.provenance && (
                <details className="mt-4 group">
                  <summary className="cursor-pointer select-none text-[10px] font-bold uppercase tracking-widest text-slate-500 transition-colors group-open:text-slate-400">
                    <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Provenance Trajectory Logs
                  </summary>
                  <div className="mt-2 border-l border-slate-800 pl-3 opacity-80">
                    <Code value={preview.provenance} />
                  </div>
                </details>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
