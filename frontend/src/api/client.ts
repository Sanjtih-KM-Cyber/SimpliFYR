import type {
  AggregateRow,
  AnalyticsEvent,
  Anomalies,
  AuditEntry,
  BatchResult,
  Config,
  ConnectionDetail,
  ConnectionSummary,
  Destination,
  DriftDetail,
  DriftSummary,
  EventDetail,
  EventStatus,
  EventSummary,
  Format,
  HealthResponse,
  IngestResponse,
  Mapping,
  Onboarding,
  OnboardingAnalyze,
  OnboardingApproveResult,
  OutputProfile,
  Recipe,
  Stats,
} from './types'

const BASE = '/api/v1'

// Auth token + environment, wired so the UI keeps working when the backend
// runs with AUTH_ENABLED=true and multi-tenancy headers (§39-40, §60).
// Persisted to localStorage; Settings page exposes both.
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

let authToken: string | null = loadStored('simplifyr.token');
let activeEnvironment: string | null = loadStored('simplifyr.environment');

export function setAuthToken(token: string | null) {
  authToken = token && token.trim() ? token.trim() : null;
  storeValue('simplifyr.token', authToken);
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setEnvironment(name: string | null) {
  activeEnvironment = name && name.trim() ? name.trim() : null;
  storeValue('simplifyr.environment', activeEnvironment);
}

export function getEnvironment(): string | null {
  return activeEnvironment;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
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
  status?: EventStatus
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
export function searchEventsRaw(query: string, source?: string): Promise<EventSummary[]> {
  const qs = new URLSearchParams({ q: query })
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
  format: 'json' | 'ndjson' | 'csv'
  status?: string
  source?: string
}

export async function exportLogs(params: ExportParams): Promise<void> {
  const qs = new URLSearchParams({ format: params.format })
  if (params.status) qs.set('status', params.status)
  if (params.source) qs.set('source', params.source)
  const res = await fetch(`${BASE}/export?${qs.toString()}`)
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
  const url = URL.createObjectURL(await res.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function getStats(): Promise<Stats> {
  return request(`${BASE}/stats`)
}

export function getConfig(): Promise<Config> {
  return request(`${BASE}/config`)
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

export function ignoreDrift(id: number): Promise<DriftDetail> {
  return request(`${BASE}/drift/${id}/ignore`, { method: 'POST' })
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