import { useState } from 'react'
import { Link } from 'react-router-dom'
import { analyzeOnboarding, analyzeShapes, approveOnboarding, createOnboarding, ingest, listConnections, listMappings, listOutputProfiles, previewIngest, processBatch } from '../api/client'
import type { BatchResult, Format, IngestResponse, OnboardingShape } from '../api/types'
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
    const header = (parsed.cef ?? {}) as Record<string, unknown>
    return [...Object.keys(header), ...Object.keys(e)]
  }
  if (format === 'csv') {
    const header = (parsed.header ?? []) as unknown[]
    if (Array.isArray(header) && header.length > 0) return header.map(String)
    const rows = (parsed.rows ?? []) as Record<string, unknown>[]
    if (Array.isArray(rows) && rows.length > 0) return Object.keys(rows[0] ?? {})
    return []
  }
  if (format === 'raw') {
    const f = (parsed.fields ?? {}) as Record<string, unknown>
    const keys = Object.keys(f)
    if (keys.length > 0) return keys
    if (typeof parsed.text === 'string') return ['raw_text']
    return []
  }
  return Object.keys(parsed)
}

interface Row {
  input_field: string
  semantic_field: string
}

interface ShapeSection {
  key: string
  format: string
  count: number
  rows: Row[]
  suggestions: Map<string, string>
}

const SAMPLE = '<134>Sep 15 10:31:44 fw01 srcip=10.1.1.5 dstip=8.8.8.8 proto=tcp action=deny'

export default function AddConnection() {
  const profiles = useAsync(() => listOutputProfiles(), [])
  const connections = useAsync(() => listConnections(), [])
  const mappings = useAsync(() => listMappings(), [])
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
  const [sections, setSections] = useState<ShapeSection[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [profileId, setProfileId] = useState<number | ''>('')
  const [preview, setPreview] = useState<IngestResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [reprocessed, setReprocessed] = useState(0)
  const [batchSummary, setBatchSummary] = useState<BatchResult | null>(null)

  function onFile(file: File | undefined) {
    if (!file) return
    // Hold the action buttons until the file lands: FileReader is async and
    // a fast click would otherwise analyze the previous one-line sample.
    setAnalyzing(true)
    const reader = new FileReader()
    reader.onload = () => {
      setRaw(String(reader.result ?? ''))
      setAnalyzing(false)
    }
    reader.onerror = () => {
      setError('Could not read file')
      setAnalyzing(false)
    }
    reader.readAsText(file)
  }

  // Multi-shape samples: every pasted line belongs to exactly one shape, and
  // the wizard maps them all — one section per shape, one union publish.
  // Single-line samples keep the original one-section path.
  function firstLine(text: string): string {
    const line = text.split('\n').find((ln) => ln.trim().length > 0)
    return (line ?? text).trim()
  }

  function toSection(shape: OnboardingShape): ShapeSection {
    return {
      key: shape.key,
      format: shape.format,
      count: shape.count,
      rows: shape.fields.map((f) => ({ input_field: f, semantic_field: '' })),
      suggestions: new Map(shape.suggestions.map((s) => [s.input_field, s.semantic_field])),
    }
  }

  const pastedLines = raw.split('\n').filter((ln) => ln.trim().length > 0).length

  async function analyze() {
    setAnalyzing(true)
    setError(null)
    setPreview(null)
    setReprocessed(0)
    setBatchSummary(null)
    setReprocessed(0)
    try {
      if (pastedLines > 1) {
        const matrix = await previewIngest(firstLine(raw))
        setAnalysis({ detection: matrix.detection, parsed: matrix.parsed } as IngestResponse)
        const res = await analyzeShapes(raw, connectionName || undefined)
        setSections(res.shapes.map(toSection))
      } else {
        const res = await previewIngest(firstLine(raw))
        setAnalysis({ detection: res.detection, parsed: res.parsed } as IngestResponse)
        const keys = sourceKeys(res.parsed, res.detection.format)
        setSections([{
          key: 'single',
          format: res.detection.format,
          count: 1,
          rows: keys.map((k) => ({ input_field: k, semantic_field: '' })),
          suggestions: new Map(),
        }])
      }
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
      if (sections.length > 1 || pastedLines > 1) {
        const res = await analyzeShapes(raw, connectionName || undefined)
        const byKey = new Map(res.shapes.map((s) => [s.key, s]))
        setSections((prev) =>
          prev.map((sec) => {
            const shape = byKey.get(sec.key)
            if (!shape) return sec
            const suggestions = new Map(shape.suggestions.map((s) => [s.input_field, s.semantic_field]))
            return {
              ...sec,
              suggestions,
              rows: [...suggestions.keys()].map((k) => ({ input_field: k, semantic_field: suggestions.get(k) ?? '' })),
            }
          }),
        )
      } else {
        const res = await analyzeOnboarding(firstLine(raw), connectionName || undefined)
        const suggestions = new Map(res.suggestions.map((s) => [s.input_field, s.semantic_field]))
        setSections((prev) => {
          if (prev.length === 0) {
            return [{
              key: 'single',
              format: 'syslog',
              count: 1,
              rows: [...suggestions.keys()].map((k) => ({ input_field: k, semantic_field: suggestions.get(k) ?? '' })),
              suggestions,
            }]
          }
          return prev.map((sec) => ({
            ...sec,
            suggestions,
            rows: [...suggestions.keys()].map((k) => ({ input_field: k, semantic_field: suggestions.get(k) ?? '' })),
          }))
        })
      }
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
    if (connectionName.trim().toLowerCase() === 'new') {
      setError('“new” is a reserved word (it clashes with the wizard address) — pick another connection name')
      return
    }
    setPreviewing(true)
    setError(null)
    try {
      // Union publish: every shape's assignments, first shape wins on conflict.
      const seen = new Set<string>()
      const fields: Row[] = []
      for (const sec of sections) {
        for (const r of sec.rows) {
          if (!r.input_field.trim() || !r.semantic_field.trim() || seen.has(r.input_field)) continue
          seen.add(r.input_field)
          fields.push({ input_field: r.input_field, semantic_field: r.semantic_field })
        }
      }
      const sample = firstLine(raw)
      const onboarding = await createOnboarding(sample, connectionName.trim())
      const approved = await approveOnboarding(onboarding.id, {
        sourceName: connectionName.trim(),
        mappingName: mappingName.trim() || `${connectionName.trim()} Mapping`,
        fields,
        outputProfileId: profileId ? Number(profileId) : undefined,
      })
      setReprocessed(approved.reprocessed_events ?? 0)
      const res = await ingest({
        raw: sample,
        source: connectionName.trim(),
        outputProfileId: profileId ? Number(profileId) : undefined,
      })
      setPreview(res)
      // Whole file goes with it: Publish ingests the full pasted content
      // through the just-published mapping (explicit mapping id, so even a
      // cold cache resolves it). One place, finished.
      if (pastedLines > 1) {
        setBatchSummary(
          await processBatch({
            raw,
            source: connectionName.trim(),
            mappingId: approved.mapping_id,
            ...(profileId ? { outputProfileId: Number(profileId) } : {}),
          }),
        )
      } else {
        setBatchSummary(null)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPreviewing(false)
    }
  }

  function updateRow(sectionKey: string, index: number, patch: Partial<Row>) {
    setSections((prev) =>
      prev.map((sec) =>
        sec.key !== sectionKey
          ? sec
          : { ...sec, rows: sec.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)) },
      ),
    )
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
          {(() => {
            const name = connectionName.trim()
            if (!name) return null
            const clashConnection = (connections.data ?? []).find(
              (c) => c.name.toLowerCase() === name.toLowerCase(),
            )
            const clashMapping = (mappings.data ?? []).find(
              (m) => (m.name || '').toLowerCase() === (mappingName.trim() || `${name} Mapping`).toLowerCase(),
            )
            if (!clashConnection && !clashMapping) return null
            return (
              <p className="mt-2 rounded-xl border border-warning/30 bg-warning-container/10 px-3.5 py-2 text-body-sm text-warning">
                {clashConnection
                  ? `“${clashConnection.name}” already exists — publishing adds a new version under it instead of a new card.`
                  : ''}
                {clashConnection && clashMapping ? ' ' : ''}
                {clashMapping
                  ? `Mapping name “${clashMapping.name}” already exists (v${clashMapping.version}) — publishing versions it up.`
                  : ''}
              </p>
            )
          })()}
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
          {pastedLines > 1 && sections.length > 1 && (
            <p className="mt-1.5 text-label-sm text-on-surface-variant/70">
              {pastedLines} lines pasted — {sections.length} shapes found; one publish covers them all.
            </p>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            <label className="btn-text cursor-pointer px-3.5 py-2.5 text-label-sm">
              Drop a file…
              <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
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

            <details className="surface-inset rounded-xl px-3 py-2">
              <summary className="cursor-pointer text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant transition-colors hover:text-on-surface">
                Parsed sample (collapsed)
              </summary>
              <div className="mt-2">
                <Code value={analysis.parsed} truncate maxLines={8} />
              </div>
            </details>
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
                  disabled={suggesting || analyzing || !raw.trim()}
                  className="btn-outlined w-full"
                >
                  {suggesting ? <Spinner size="sm" /> : 'Run Autopilot Suggestion'}
                </button>
              </div>
            </div>

            <div className="mb-6 space-y-4">
              {sections.map((sec, si) => (
                <div key={sec.key} className="surface-inset rounded-xl p-3 shadow-inner">
                  {sections.length > 1 && (
                    <p className="mb-2 font-mono text-mono-sm text-on-surface-variant">
                      <span className="font-semibold text-primary">Shape {si + 1}</span>
                      {' '}· {sec.format} · {sec.count} {sec.count === 1 ? 'line' : 'lines'}
                    </p>
                  )}
                  <div className="space-y-2">
                    {sec.rows.map((row, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
                        <span className="w-full truncate surface-inset rounded-xl px-3 py-1.5 font-mono text-mono-sm text-warning border border-warning/20 lg:w-1/3">
                          {row.input_field}
                        </span>
                        <SemanticFieldInput
                          value={row.semantic_field}
                          onChange={(v) => updateRow(sec.key, i, { semantic_field: v })}
                        />
                        <div className="hidden lg:flex w-1/4 items-center">
                          <span className="text-label-sm text-on-surface-variant/70">{row.semantic_field || '(UNASSIGNED)'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-4 border-t border-outline-variant/50 pt-4">
              <h3 className="mb-2 text-label-lg font-bold uppercase tracking-wider text-on-surface">Delivery Output Link</h3>
              <Dropdown
                value={profileId}
                onChange={(v) => setProfileId(v ? Number(v) : '')}
                options={[
                  { value: '', label: 'No delivery profile (Log indexing only)…' },
                  ...(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name })),
                ]}
                placeholder="No delivery profile (Log indexing only)…"
                searchable
                className="w-full max-w-md"
              />
            </div>

            <div className="flex justify-end border-t border-outline-variant/50 pt-4">
              <button
                onClick={previewOutput}
                disabled={previewing || sections.every((sec) => sec.rows.every((r) => !r.semantic_field))}
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
              {reprocessed > 0 && (
                <span className="mt-1 block text-body-sm">
                  {reprocessed} waiting {reprocessed === 1 ? 'log' : 'logs'} normalized automatically on publish.
                </span>
              )}
            </p>
            {batchSummary && (
              <p className="mt-2 text-body-md text-on-surface">
                Whole file ingested here: {batchSummary.processed}/{batchSummary.total} lines
                ({batchSummary.normalized + batchSummary.output} normalized · {batchSummary.quarantined} held · {batchSummary.dlq} dlq)
                in {batchSummary.duration_seconds}s{batchSummary.batch_id != null ? ` — batch #${batchSummary.batch_id}` : ''}.
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                to={`/connections/${encodeURIComponent(connectionName.trim())}`}
                className="btn-success inline-block"
              >
                Monitor Pipeline Sequence
              </Link>
              {batchSummary?.batch_id != null && (
                <Link
                  to={`/connections/${encodeURIComponent(connectionName.trim())}/logs`}
                  className="btn-outlined inline-block"
                >
                  Open these logs
                </Link>
              )}
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
                <Code value={preview.normalized} truncate maxLines={8} />
              </div>
            </section>
            <section className="glass-card rounded-2xl p-5">
              <div className="mb-3 flex items-center gap-2 border-b border-success/20 pb-2">
                <div className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_5px_var(--color-success)]"></div>
                <h3 className="text-label-sm font-bold uppercase tracking-widest text-success">Delivery Payload Target</h3>
              </div>
              <div className="surface-inset rounded-xl">
                <Code value={preview.output ?? preview.normalized} truncate maxLines={8} />
              </div>
              {preview.provenance && (
                <details className="mt-4 group">
                  <summary className="cursor-pointer text-label-sm font-semibold uppercase tracking-widest text-on-surface-variant transition-colors hover:text-on-surface">
                    <span className="mr-1 inline-block opacity-50 transition-transform group-open:rotate-90">▶</span> Provenance Trajectory Logs
                  </summary>
                  <div className="mt-2 border-l border-outline-variant pl-3 opacity-80">
                    <Code value={preview.provenance} truncate maxLines={8} />
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