import type {
  AggregateRow,
  AnalyticsEvent,
  Anomalies,
  AuditEntry,
  BatchGroup,
  BatchResult,
  BatchRun,
  EventGroup,
  Config,
  ConnectionDetail,
  ConnectionSummary,
  Destination,
  DriftDetail,
  DriftSummary,
  EventDetail,
  EventSummary,
  Format,
  HealthResponse,
  IngestResponse,
  Mapping,
  Onboarding,
  OnboardingAnalyze,
  OnboardingApproveResult,
  OnboardingShapes,
  OutputProfile,
  Recipe,
  SemanticFieldEntry,
  Stats,
  SynthesisJob,
} from './types'

/** API root: relative in dev/docker (same-origin / Vite proxy / nginx),
 *  absolute when the UI is hosted apart from the API (e.g. Vercel):
 *  set VITE_API_URL=https://api.example.com/api/v1 at build time. */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined ?? '/api/v1').replace(/\/$/, '')

const BASE = API_BASE

/** WebSocket root mirroring API_BASE (http→ws, https→wss). */
export function wsBase(): string {
  if (API_BASE.startsWith('http')) {
    const u = new URL(API_BASE)
    const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${u.host}${u.pathname.replace(/\/$/, '')}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/api/v1`
}

// Tenant environment header (multi-tenancy; defaults server-side).
// Persisted to localStorage for sticky tenant selection.
function loadStored(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable (private mode, SSR) — keep in-memory only */
  }
}

let activeEnvironment: string | null = loadStored('simplifyr.environment');

export function setEnvironment(name: string | null) {
  activeEnvironment = name && name.trim() ? name.trim() : null;
  storeValue('simplifyr.environment', activeEnvironment);
}

export function getEnvironment(): string | null {
  return activeEnvironment;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (activeEnvironment && !headers.has('X-Environment')) {
    headers.set('X-Environment', activeEnvironment);
  }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    let detail = `Request failed: ${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
      else if (Array.isArray(body?.detail)) detail = body.detail.map((d: any) => d.msg).join('; ')
    } catch {
      /* ignore parse errors */
    }
    throw new Error(detail)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export function getHealth(): Promise<HealthResponse> {
  return request(`${BASE}/health`)
}

export interface IngestInput {
  raw?: string
  source?: string
  hint?: string
  mappingId?: number
  outputProfileId?: number
}

export function ingest(input: IngestInput): Promise<IngestResponse> {
  const body = new FormData()
  if (input.raw !== undefined) body.append('raw', input.raw)
  if (input.source) body.append('source', input.source)
  if (input.hint) body.append('hint', input.hint)
  if (input.mappingId) body.append('mapping_id', String(input.mappingId))
  if (input.outputProfileId) body.append('output_profile_id', String(input.outputProfileId))
  return request(`${BASE}/ingest`, { method: 'POST', body })
}

export interface PreviewResult {
  detection: { format: Format; confidence: number; detail: string }
  parsed: Record<string, unknown> | null
}

/** Side-effect-free detection + parse (stores nothing). */
export function previewIngest(raw: string, hint?: string): Promise<PreviewResult> {
  const body = new FormData()
  body.append('raw', raw)
  if (hint) body.append('hint', hint)
  return request(`${BASE}/ingest/preview`, { method: 'POST', body })
}

export function listMappings(): Promise<Mapping[]> {
  return request(`${BASE}/mappings`)
}

export interface MappingInput {
  name: string
  source?: string
  event_family?: string
  fields: { input_field: string; semantic_field: string; transformation?: Record<string, string> | null; confidence?: number }[]
}

export function createMapping(payload: MappingInput): Promise<Mapping> {
  return request(`${BASE}/mappings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteMapping(id: number): Promise<void> {
  await request(`${BASE}/mappings/${id}`, { method: 'DELETE' })
}

export function listOutputProfiles(): Promise<OutputProfile[]> {
  return request(`${BASE}/output-profiles`)
}

export interface OutputProfileInput {
  name: string
  description?: string
  include_all?: boolean
  fields: { output_field: string; from_semantic: string }[]
}

export function createOutputProfile(payload: OutputProfileInput): Promise<OutputProfile> {
  return request(`${BASE}/output-profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export interface ListEventsParams {
  status?: string
  limit?: number
  offset?: number
  source?: string
}

export function listEvents(params: ListEventsParams = {}): Promise<EventSummary[]> {
  const qs = new URLSearchParams()
  if (params.status) qs.set('status', params.status)
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.offset) qs.set('offset', String(params.offset))
  if (params.source) qs.set('source', params.source)
  const query = qs.toString()
  return request(`${BASE}/events${query ? `?${query}` : ''}`)
}

/** Server-side full-text hunt over raw payloads (trigram-ranked on Postgres). */
export function searchEventsRaw(query: string, source?: string, limit = 500): Promise<EventSummary[]> {
  const qs = new URLSearchParams({ q: query, limit: String(limit) })
  if (source) qs.set('source', source)
  return request(`${BASE}/events/search?${qs.toString()}`)
}

export function getEvent(id: number): Promise<EventDetail> {
  return request(`${BASE}/events/${id}`)
}

export async function deleteEvent(id: number): Promise<void> {
  await request(`${BASE}/events/${id}`, { method: 'DELETE' })
}

export function retryEvent(id: number): Promise<EventDetail> {
  return request(`${BASE}/events/${id}/retry`, { method: 'POST' })
}

export interface BatchRetryResult {
  retried: number[]
  skipped: Record<string, string>
  /** Post-retry outcome per retried id. Absent on older backends. */
  statuses?: Record<string, string>
}

export function batchRetryEvents(ids: number[]): Promise<BatchRetryResult> {
  return request(`${BASE}/events/batch-retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
}

export interface BatchDeleteResult {
  deleted: number[]
}

export function batchDeleteEvents(ids: number[]): Promise<BatchDeleteResult> {
  return request(`${BASE}/events/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
}

export interface EventSuggestion {
  input_field: string
  semantic_field: string
  confidence: number
  reason: string
}

export function suggestEventMapping(id: number): Promise<EventSuggestion[]> {
  return request(`${BASE}/events/${id}/suggest`)
}

export interface OnboardEventInput {
  connectionName?: string
  mappingName?: string
  outputProfileId?: number
  fields: { input_field: string; semantic_field: string }[]
}

export interface OnboardEventResult {
  event_id: number
  source_id: number | null
  mapping_id: number
  mapping_version: number
  recipe_id: number
  event_status: string
}

export function onboardEvent(id: number, input: OnboardEventInput): Promise<OnboardEventResult> {
  return request(`${BASE}/events/${id}/onboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connection_name: input.connectionName ?? null,
      mapping_name: input.mappingName ?? null,
      output_profile_id: input.outputProfileId ?? null,
      fields: input.fields,
    }),
  })
}

export async function getEventRaw(id: number): Promise<string> {
  const res = await fetch(`${BASE}/events/${id}/raw`)
  if (!res.ok) throw new Error(`Failed to load raw event: ${res.status}`)
  return res.text()
}

export function listConnections(): Promise<ConnectionSummary[]> {
  return request(`${BASE}/connections`)
}

export function getConnection(name: string): Promise<ConnectionDetail> {
  return request(`${BASE}/connections/${encodeURIComponent(name)}`)
}

export async function deleteConnection(name: string): Promise<void> {
  await request(`${BASE}/connections/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export function listRecipes(): Promise<Recipe[]> {
  return request(`${BASE}/recipes`)
}

export interface RecipeInput {
  source: string
  mappingId: number
  outputProfileId?: number
}

export function createRecipe(payload: RecipeInput): Promise<Recipe> {
  return request(`${BASE}/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: payload.source,
      mapping_id: payload.mappingId,
      output_profile_id: payload.outputProfileId ?? null,
    }),
  })
}

export async function deleteRecipe(id: number): Promise<void> {
  await request(`${BASE}/recipes/${id}`, { method: 'DELETE' })
}

export function listDestinations(): Promise<Destination[]> {
  return request(`${BASE}/destinations`)
}

export interface DestinationInput {
  name: string
  type: 'console' | 'http' | 's3' | 'kafka'
  config: Record<string, string>
  enabled?: boolean
}

export function createDestination(payload: DestinationInput): Promise<Destination> {
  return request(`${BASE}/destinations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function patchDestination(
  id: number,
  patch: { enabled?: boolean; name?: string; config?: Record<string, string> },
): Promise<Destination> {
  return request(`${BASE}/destinations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export async function deleteDestination(id: number): Promise<void> {
  await request(`${BASE}/destinations/${id}`, { method: 'DELETE' })
}

export interface ExportParams {
  format: 'json' | 'ndjson' | 'csv' | 'markdown' | 'md'
  status?: string
  source?: string
  batch_id?: number
  limit?: number
  ids?: number[]
  payload?: 'normalized' | 'output'
  mappingId?: number
  outputProfileId?: number
}

export interface ExportResult {
  filename: string
  total: number
  normalized: number
}

export async function exportLogs(params: ExportParams): Promise<ExportResult> {
  // POST with a JSON body: id sets ride in the payload, never the URL
  // (thousands of ids in a query string blow past header limits -> 431).
  const res = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      format: params.format,
      ...(params.status ? { status: params.status } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.batch_id !== undefined ? { batch_id: params.batch_id } : {}),
      ...(params.payload ? { payload: params.payload } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
      ...(params.ids?.length ? { ids: params.ids } : {}),
      ...(params.mappingId !== undefined ? { mapping_id: params.mappingId } : {}),
      ...(params.outputProfileId !== undefined ? { output_profile_id: params.outputProfileId } : {}),
    }),
  })
  if (!res.ok) {
    let detail = `Download failed: ${res.status}`
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') detail = body.detail
    } catch {
      /* ignore parse errors */
    }
    throw new Error(detail)
  }
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="([^"]+)"/)
  const filename = match ? match[1] : `simplifyr-events.${params.format}`
  const total = Number(res.headers.get('X-Export-Total') ?? '0')
  const normalized = Number(res.headers.get('X-Export-Normalized') ?? '0')
  const url = URL.createObjectURL(await res.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return { filename, total, normalized }
}

export function getStats(): Promise<Stats> {
  return request(`${BASE}/stats`)
}

export function getConfig(): Promise<Config> {
  return request(`${BASE}/config`)
}

export interface PipelinePressure {
  queue_depth: number
  dropped_total: number
}

/** Live pipeline pressure from the Prometheus text endpoint (no backend change). */
export async function getPipelinePressure(): Promise<PipelinePressure> {
  const res = await fetch(`${BASE}/metrics`)
  if (!res.ok) throw new Error(`Metrics unavailable: ${res.status}`)
  const text = await res.text()
  const depth = text.match(/^simplifyr_queue_depth\s+([0-9.]+)/m)
  const dropped = text.match(/^simplifyr_queue_dropped_total\s+([0-9.]+)/m)
  return {
    queue_depth: depth ? Number(depth[1]) : 0,
    dropped_total: dropped ? Number(dropped[1]) : 0,
  }
}

export interface BatchInput {
  raw: string
  source?: string
  mappingId?: number
  outputProfileId?: number
}

export function processBatch(input: BatchInput): Promise<BatchResult> {
  const body = new FormData()
  body.append('raw', input.raw)
  if (input.source) body.append('source', input.source)
  if (input.mappingId) body.append('mapping_id', String(input.mappingId))
  if (input.outputProfileId) body.append('output_profile_id', String(input.outputProfileId))
  return request(`${BASE}/process/batch`, { method: 'POST', body })
}

export function listBatches(limit = 50): Promise<BatchRun[]> {
  return request(`${BASE}/process/batches?limit=${limit}`)
}

export function getBatchGroups(batchId: number): Promise<BatchGroup[]> {
  return request(`${BASE}/process/batches/${batchId}/groups`)
}

export function listEventGroups(status = 'quarantined', source?: string): Promise<EventGroup[]> {
  const qs = new URLSearchParams({ status })
  if (source) qs.set('source', source)
  return request(`${BASE}/events/groups?${qs.toString()}`)
}

export function listSemanticFields(): Promise<SemanticFieldEntry[]> {
  return request(`${BASE}/semantic-fields`)
}

export function proposeSemanticField(name: string): Promise<SemanticFieldEntry> {
  return request(`${BASE}/semantic-fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function listAudit(): Promise<AuditEntry[]> {
  return request(`${BASE}/audit`)
}

export function patchMappingStatus(id: number, status: string): Promise<Mapping> {
  return request(`${BASE}/mappings/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

export function listDrift(): Promise<DriftSummary[]> {
  return request(`${BASE}/drift`)
}

export function getDrift(id: number): Promise<DriftDetail> {
  return request(`${BASE}/drift/${id}`)
}

export function analyzeDrift(id: number): Promise<DriftDetail> {
  return request(`${BASE}/drift/${id}/analyze`, { method: 'POST' })
}

export function createSynthesisJob(drift_id: number): Promise<SynthesisJob> {
  return request(`${BASE}/synthesis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drift_id }),
  })
}

export function getSynthesisJob(id: number): Promise<SynthesisJob> {
  return request(`${BASE}/synthesis/${id}`)
}

export function listSynthesisJobs(): Promise<SynthesisJob[]> {
  return request(`${BASE}/synthesis`)
}

export interface ApproveResult {
  drift_id: number
  new_mapping_id: number
  new_mapping_version: number
  reprocessed_events: number
}

export function approveDrift(id: number): Promise<ApproveResult> {
  return request(`${BASE}/drift/${id}/approve`, { method: 'POST' })
}

export function correctDrift(
  id: number,
  fields: { input_field: string; semantic_field: string }[],
): Promise<ApproveResult> {
  return request(`${BASE}/drift/${id}/correct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
}

export function rejectDrift(id: number): Promise<DriftDetail> {
  return request(`${BASE}/drift/${id}/reject`, { method: 'POST' })
}

export function analyzeOnboarding(
  raw: string,
  source?: string,
): Promise<OnboardingAnalyze> {
  const body = new FormData()
  body.append('raw', raw)
  if (source) body.append('source', source)
  return request(`${BASE}/onboarding/analyze`, { method: 'POST', body })
}

export function createOnboarding(sample: string, sourceName?: string): Promise<Onboarding> {
  return request(`${BASE}/onboarding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sample, source_name: sourceName ?? null }),
  })
}

export function analyzeOnboardingById(id: number): Promise<OnboardingAnalyze> {
  return request(`${BASE}/onboarding/${id}/analyze`, { method: 'POST' })
}

export function analyzeShapes(raw: string, source?: string): Promise<OnboardingShapes> {
  return request(`${BASE}/onboarding/shapes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, source_name: source ?? null }),
  })
}

export interface OnboardingApproveInput {
  sourceName: string
  mappingName?: string
  fields: { input_field: string; semantic_field: string }[]
  outputProfileId?: number
}

export function approveOnboarding(id: number, input: OnboardingApproveInput): Promise<OnboardingApproveResult> {
  return request(`${BASE}/onboarding/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_name: input.sourceName,
      mapping_name: input.mappingName ?? null,
      fields: input.fields,
      output_profile_id: input.outputProfileId ?? null,
    }),
  })
}

export function searchEvents(filters: Record<string, string>): Promise<AnalyticsEvent[]> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) {
    if (v) params.append('filter', `${k}=${v}`)
  }
  const qs = params.toString()
  return request(`${BASE}/analytics/search${qs ? `?${qs}` : ''}`)
}

export function aggregateEvents(groupBy: string): Promise<AggregateRow[]> {
  return request(`${BASE}/analytics/aggregate?group_by=${encodeURIComponent(groupBy)}`)
}

export function getAnomalies(threshold = 3): Promise<Anomalies> {
  return request(`${BASE}/analytics/anomalies?threshold=${threshold}`)
}

export function getCorrelations(rule: string, threshold = 5): Promise<Record<string, unknown>[]> {
  return request(`${BASE}/analytics/correlations?rule=${rule}&threshold=${threshold}`)
}

export interface DedupPattern {
  format: string
  fields: string[]
  count: number
  sample: string
}

export interface DedupResponse {
  total: number
  patterns: DedupPattern[]
}

export function dedupLogs(raw: string): Promise<DedupResponse> {
  return request(`${BASE}/analytics/dedup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
}