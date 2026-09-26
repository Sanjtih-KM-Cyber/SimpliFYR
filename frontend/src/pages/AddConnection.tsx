import { useState } from 'react'
import { Link } from 'react-router-dom'
import { analyzeOnboarding, approveOnboarding, createOnboarding, ingest, listOutputProfiles, previewIngest } from '../api/client'
import type { Format, IngestResponse } from '../api/types'
import { Code } from '../components/Code'
import { LOADTEST_SAMPLE_KEY } from '../components/LoadTestPanel'
import { SemanticFieldInput } from '../components/SemanticFieldInput'
import { ErrorBanner } from '../components/Status'
import { PageHeader } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { Spinner } from '../components/Spinner'
import { Dropdown } from '../components/Dropdown'

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
  const [raw, setRaw] = useState(() => {
    try {
      const adopted = sessionStorage.getItem(LOADTEST_SAMPLE_KEY)
      if (adopted) {
        sessionStorage.removeItem(LOADTEST_SAMPLE_KEY)
        return adopted
      }
    } catch {
      /* storage unavailable — fall through to the default sample */
    }
    return SAMPLE
  })
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
      const onboarding = await createOnboarding(raw, connectionName.trim())
      await approveOnboarding(onboarding.id, {
        sourceName: connectionName.trim(),
        mappingName: mappingName.trim() || `${connectionName.trim()} Mapping`,
        fields,
        outputProfileId: profileId ? Number(profileId) : undefined,
      })
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
        <section className="glass-card rounded-2xl p-5 animate-slide-up">
          <div className="mb-4 flex items-center gap-3 border-b border-outline-variant/50 pb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/30 bg-primary-container/20 text-primary text-label-sm font-bold">1</div>
            <h3 className="text-label-lg font-bold uppercase tracking-wider text-on-surface">Connection Identity</h3>
          </div>
          <input
            value={connectionName}
            onChange={(e) => setConnectionName(e.target.value)}
            placeholder="e.g. CrowdStrike Falcon, AWS CloudTrail"
            className="input-glass w-full px-3.5 py-2.5 text-body-md text-on-surface"
          />
        </section>

        <section className="glass-card rounded-2xl p-5 animate-slide-up" style={{ animationDelay: '50ms' }}>
          <div className="mb-4 flex items-center gap-3 border-b border-outline-variant/50 pb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/30 bg-primary-container/20 text-primary text-label-sm font-bold">2</div>
            <h3 className="text-label-lg font-bold uppercase tracking-wider text-on-surface">Telemetry Sample (Raw Context)</h3>
          </div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={4}
            className="input-glass w-full resize-none px-3.5 py-2.5 font-mono text-mono-sm text-on-surface"
          />
          <div className="mt-4 flex justify-end">
            <button
              onClick={analyze}
              disabled={analyzing || !raw.trim()}
              className="btn-primary"
            >
              {analyzing ? <Spinner size="sm" /> : 'Synthesize Schema'}
            </button>
          </div>
        </section>

        {analyzing && <div className="flex justify-center py-4"><Spinner /></div>}

        {analysis && (
          <section className="glass-card rounded-2xl p-5 animate-slide-up border-l-4 border-primary" style={{ animationDelay: '100ms' }}>
            <div className="mb-4 flex items-center justify-between border-b border-primary/20 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-info/30 bg-info-container/20 text-info text-label-sm font-bold">3</div>
                <h3 className="text-label-lg font-bold uppercase tracking-wider text-on-surface">Detection Matrix</h3>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-4 surface-inset rounded-xl p-3">
              <div className="flex flex-col">
                <span className="text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant">Format Detected</span>
                <span className="font-mono text-body-md font-semibold text-on-surface">{analysis.detection.format}</span>
              </div>
              <div className="h-6 w-px bg-outline-variant/50"></div>
              <div className="flex flex-col">
                <span className="text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant">Confidence Model</span>
                <span className="font-mono text-body-md font-semibold text-success">
                  {Math.round(analysis.detection.confidence * 100)}%
                </span>
              </div>
              <div className="h-6 w-px bg-outline-variant/50"></div>
              <div className="flex-1 text-label-sm italic leading-tight text-on-surface-variant">
                " {analysis.detection.detail} "
              </div>
            </div>

            <div className="surface-inset rounded-xl">
              <Code value={analysis.parsed} />
            </div>
          </section>
        )}

        {analysis && (
          <section className="glass-card rounded-2xl p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
            <div className="mb-4 flex items-center justify-between border-b border-outline-variant/50 pb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/30 bg-primary-container/20 text-primary text-label-sm font-bold">4</div>
                <h3 className="text-label-lg font-bold uppercase tracking-wider text-on-surface">AST Map Configuration</h3>
              </div>
            </div>

            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant">Mapping Identifier</label>
                <input
                  value={mappingName}
                  onChange={(e) => setMappingName(e.target.value)}
                  placeholder={`${connectionName || 'Connection'} Mapping (Default)`}
                  className="input-glass w-full px-3.5 py-2.5 text-body-sm text-on-surface"
                />
              </div>
              <div className="flex items-end pb-0.5">
                <button
                  onClick={autoSuggest}
                  disabled={suggesting || !raw.trim()}
                  className="btn-outlined w-full"
                >
                  {suggesting ? <Spinner size="sm" /> : 'Run Autopilot Suggestion'}
                </button>
              </div>
            </div>

            <div className="mb-6 space-y-2 surface-inset rounded-xl p-3 shadow-inner">
              {rows.map((row, i) => (
                <div key={i} className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
                  <span className="w-full truncate surface-inset rounded-xl px-3 py-1.5 font-mono text-mono-sm text-warning border border-warning/20 lg:w-1/3">
                    {row.input_field}
                  </span>
                  <SemanticFieldInput
                    value={row.semantic_field}
                    onChange={(v) => updateRow(i, { semantic_field: v })}
                  />
                  <div className="hidden lg:flex w-1/4 items-center">
                    <span className="text-label-sm text-on-surface-variant/70">{row.semantic_field || '(UNASSIGNED)'}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4 border-t border-outline-variant/50 pt-4">
              <h3 className="mb-2 text-label-lg font-bold uppercase tracking-wider text-on-surface">Delivery Output Link</h3>
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value ? Number(e.target.value) : '')}
                className="input-glass w-full max-w-md px-3.5 py-2.5 text-body-sm font-semibold text-on-surface"
              >
                <option value="">No delivery profile (Log indexing only)…</option>
                {(profiles.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end border-t border-outline-variant/50 pt-4">
              <button
                onClick={previewOutput}
                disabled={previewing || rows.every((r) => !r.semantic_field)}
                className="btn-primary"
              >
                {previewing ? <Spinner size="sm" /> : 'Publish Pipeline Sequence'}
              </button>
            </div>
          </section>
        )}

        {previewing && <div className="flex justify-center py-4"><Spinner /></div>}

        {saved && (
          <div className="glass-card rounded-2xl p-5 animate-slide-up border-l-4 border-success">
            <p className="text-body-md font-semibold text-success">
              Pipeline Established. Structural context compiled. Streams linked to{' '}
              <span className="font-bold text-on-surface">{connectionName.trim()}</span> will auto-index.
            </p>
            <div className="mt-4">
              <Link
                to={`/connections/${encodeURIComponent(connectionName.trim())}`}
                className="btn-success inline-block"
              >
                Monitor Pipeline Sequence
              </Link>
            </div>
          </div>
        )}

        {preview && (
          <div className="animate-slide-up grid gap-4 lg:grid-cols-2 mt-6">
            <section className="glass-card rounded-2xl p-5">
              <div className="mb-3 flex items-center gap-2 border-b border-info/20 pb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-info shadow-[0_0_5px_var(--color-info)]"></div>
                <h3 className="text-label-sm font-bold uppercase tracking-widest text-info">Normalized Intermediary</h3>
              </div>
              <div className="surface-inset rounded-xl">
                <Code value={preview.normalized} />
              </div>
            </section>
            <section className="glass-card rounded-2xl p-5">
              <div className="mb-3 flex items-center gap-2 border-b border-success/20 pb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_5px_var(--color-success)]"></div>
                <h3 className="text-label-sm font-bold uppercase tracking-widest text-success">Delivery Payload Target</h3>
              </div>
              <div className="surface-inset rounded-xl">
                <Code value={preview.output ?? preview.normalized} />
              </div>
              {preview.provenance && (
                <details className="mt-4 group">
                  <summary className="cursor-pointer text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant transition-colors hover:text-on-surface">
                    <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Provenance Trajectory Logs
                  </summary>
                  <div className="mt-2 border-l border-outline-variant pl-3 opacity-80">
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