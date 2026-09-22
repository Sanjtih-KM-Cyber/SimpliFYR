import { useState } from 'react'
import { Link } from 'react-router-dom'
import { analyzeOnboarding, approveOnboarding, createOnboarding, ingest, listOutputProfiles } from '../api/client'
import { SEMANTIC_FIELDS } from '../api/types'
import type { Format, IngestResponse } from '../api/types'
import { Code } from '../components/Code'
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
      const res = await ingest({ raw })
      setAnalysis(res)
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
    <div>
      <PageHeader
        title="Add Connection"
        subtitle="Provide sample logs, choose a mapping and output — from then on, incoming logs follow the recipe."
      />

      {error && <ErrorBanner message={error} />}

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-white">1 · Connection</h3>
        <input
          value={connectionName}
          onChange={(e) => setConnectionName(e.target.value)}
          placeholder="Connection name (e.g. CrowdStrike Falcon)"
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
        />
      </section>

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-white">2 · Provide sample logs</h3>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200"
        />
        <button
          onClick={analyze}
          disabled={analyzing || !raw.trim()}
          className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </button>
      </section>

      {analyzing && <Spinner />}

      {analysis && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">3 · Detection</h3>
          <div className="mb-2 flex flex-wrap gap-4 text-sm">
            <span className="text-slate-300">
              Format: <span className="font-semibold text-white">{analysis.detection.format}</span>
            </span>
            <span className="text-slate-300">
              Confidence:{' '}
              <span className="font-semibold text-white">
                {Math.round(analysis.detection.confidence * 100)}%
              </span>
            </span>
            <span className="text-slate-500">{analysis.detection.detail}</span>
          </div>
          <Code value={analysis.parsed} />
        </section>
      )}

      {analysis && (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">4 · Choose mapping</h3>
          <input
            value={mappingName}
            onChange={(e) => setMappingName(e.target.value)}
            placeholder={`Mapping name (defaults to "${connectionName || 'Connection'} Mapping")`}
            className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          />
          <button
            onClick={autoSuggest}
            disabled={suggesting || !raw.trim()}
            className="mb-3 rounded-md bg-indigo-700 px-3 py-1.5 text-sm text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {suggesting ? 'Suggesting…' : '✨ Auto-suggest mapping'}
          </button>
          <div className="mb-3 space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <span className="w-1/3 truncate rounded-md bg-slate-950 px-3 py-2 text-sm text-slate-300">
                  {row.input_field}
                </span>
                <select
                  value={row.semantic_field}
                  onChange={(e) => updateRow(i, { semantic_field: e.target.value })}
                  className="w-1/3 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">Semantic field…</option>
                  {SEMANTIC_FIELDS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <span className="w-1/3 text-xs text-slate-600">→ {row.semantic_field}</span>
              </div>
            ))}
          </div>

          <h3 className="mb-2 mt-4 text-sm font-medium text-white">Choose output</h3>
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value ? Number(e.target.value) : '')}
            className="mb-3 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          >
            <option value="">No profile (normalized only)…</option>
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            onClick={previewOutput}
            disabled={previewing || rows.every((r) => !r.semantic_field)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {previewing ? 'Saving…' : 'Save connection'}
          </button>
        </section>
      )}

      {previewing && <Spinner />}

      {saved && (
        <div className="mb-6 rounded-lg border border-emerald-800 bg-emerald-950/50 p-4">
          <p className="text-sm text-emerald-100">
            Connection and recipe saved. Incoming logs for{' '}
            <span className="font-semibold">{connectionName.trim()}</span> will automatically follow
            this recipe — configure once, reuse automatically.
          </p>
          <Link
            to={`/connections/${encodeURIComponent(connectionName.trim())}`}
            className="mt-3 inline-block rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            View connection →
          </Link>
        </div>
      )}

      {preview && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-2 text-sm font-medium text-white">Normalized</h3>
            <Code value={preview.normalized} />
          </section>
          <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h3 className="mb-2 text-sm font-medium text-white">Output</h3>
            <Code value={preview.output ?? preview.normalized} />
            {preview.provenance && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-slate-300">Provenance</summary>
                <div className="mt-2">
                  <Code value={preview.provenance} />
                </div>
              </details>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
