export interface HealthResponse {
  status: string
  app: string
  version: string
  database: string
}

export type Format =
  | 'syslog'
  | 'json'
  | 'xml'
  | 'csv'
  | 'cef'
  | 'leef'
  | 'raw'
  | 'unknown'

export type EventStatus = 'received' | 'parsed' | 'normalized' | 'output' | 'quarantined' | 'dlq'

export type MappingStatus = 'draft' | 'testing' | 'approved' | 'published' | 'deprecated'

export interface DetectionResult {
  format: Format
  confidence: number
  detail: string
}

export interface Envelope {
  event_id: string
  received_at: string
  ingestion_source: { type: string; address: string | null }
  raw_payload: string
  content_type: string
  metadata: Record<string, unknown>
}

export interface IngestResponse {
  envelope: Envelope
  detection: DetectionResult
  status: EventStatus | string
  parsed: Record<string, unknown> | null
  normalized: Record<string, unknown> | null
  provenance: Record<string, unknown> | null
  output: Record<string, unknown> | null
  stored_event_id: number
  duplicate: boolean
}

export interface EventSummary {
  id: number
  event_id: string
  status: EventStatus
  received_at: string
  source_id: number | null
  source: string | null
  raw_hash: string
  detected_format: string | null
}

export interface EventDetail extends EventSummary {
  raw_ref: string | null
  parsed: Record<string, unknown> | null
  normalized: Record<string, unknown> | null
  provenance: Record<string, unknown> | null
  output: Record<string, unknown> | null
  views: {
    raw: string
    parsed: Record<string, unknown> | null
    normalized: Record<string, unknown> | null
    output: Record<string, unknown> | null
  }
}

export interface MappingField {
  input_field: string
  semantic_field: string
  transformation: Record<string, string> | null
  confidence: number
}

export interface Mapping {
  id: number
  name: string
  source: string | null
  event_family: string
  version: number
  status: MappingStatus
  created_at: string | null
  fields: MappingField[]
}

/** Canonical mapping identity: versions are iterations, and editors often
 *  save "Name v3" next to "Name" — both are the same mapping. */
export function normalizeMappingName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*[-(]?\s*v\s*\d+\s*\)?\s*$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim()
}

/** One row per mapping name (latest version wins): versions are iterations
 *  of the same mapping, so pickers show each name exactly once. */
export function latestMappings(mappings: Mapping[]): Mapping[] {
  const byName = new Map<string, Mapping>()
  for (const m of mappings) {
    const key = normalizeMappingName(m.name)
    const cur = byName.get(key)
    if (!cur || m.version > cur.version || (m.version === cur.version && m.id > cur.id)) {
      byName.set(key, m)
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export interface OutputProfile {
  id: number
  name: string
  description: string
  is_preset: boolean
  profile_schema: {
    include_all: boolean
    fields: { output_field: string; from: string }[]
  }
}

export interface DriftFieldSuggestion {
  input_field: string
  semantic_field: string
  confidence: number
  reason: string
}

export interface DriftProposal {
  new_field_suggestions: DriftFieldSuggestion[]
  renamed_from: Record<string, string>
  explanation: string
  confidence: number
}

export interface DriftSummary {
  id: number
  source: string | null
  status: string
  new_fields: string[]
  missing_fields: string[]
  confidence: number
  created_at: string
}

export interface DriftDetail extends DriftSummary {
  mapping_id: number | null
  proposal: DriftProposal | null
  sample: string | null
  event_ids: string[]
  resolved_at: string | null
}

export interface Stats {
  total_events: number
  events_by_status: Record<string, number>
  events_per_second: number
  sources: number
  mappings: number
  output_profiles: number
  drift_by_status: Record<string, number>
  quarantine_pending: number
}

export interface AuditEntry {
  id: number
  actor: string | null
  action: string
  entity_type: string
  entity_id: number
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}

export interface Config {
  auth_enabled: boolean
  ai_provider: string
  pipeline_workers: number
  pipeline_max_queue: number
  retention_days: number
  raw_retention_days: number
  normalized_retention_days: number
  audit_retention_days: number
  rate_limit_per_minute: number
  syslog_enabled: boolean
  syslog_udp_host: string
  syslog_udp_port: number
  syslog_tcp_enabled: boolean
  syslog_tcp_port: number
  file_watch_enabled: boolean
  kafka_ingress_enabled: boolean
  pipeline_backend: string
  raw_store_backend: string
  cache_backend: string
  delivery_sinks: string[]
}

export interface BatchItemResult {
  index: number
  status: string
  detected_format: string
  stored_event_id: number | null
}

export interface BatchResult {
  total: number
  processed: number
  normalized: number
  output: number
  quarantined: number
  dlq: number
  failed: number
  duration_seconds: number
  events_per_second: number
  avg_latency_ms: number
  results: BatchItemResult[]
}

export interface OnboardingSuggestion {
  input_field: string
  semantic_field: string
  confidence: number
  reason: string
}

export interface OnboardingAnalyze {
  source: string | null
  detected_format: Format
  confidence: number
  suggestions: OnboardingSuggestion[]
}

export interface Onboarding {
  id: number
  status: string
  source_id: number | null
  sample_payload: string
  detected_format: Format
  detected_event_family: string
  detected_vendor: string | null
  detected_product: string | null
  confidence: number
}

export interface OnboardingApproveResult {
  onboarding_id: number
  source_id: number
  mapping_id: number
  mapping_version: number
  recipe_id: number
  reprocessed_events: number
}

export interface AnalyticsEvent {
  id: number
  event_id: string
  source: string | null
  status: string
  received_at: string
  normalized: Record<string, unknown>
}

export interface AggregateRow {
  value: string
  count: number
}

export interface ConnectionMapping {
  id: number
  name: string
  version: number
  status: MappingStatus | string
}

export interface ConnectionProfile {
  id: number
  name: string
}

export type ConnectionHealth = 'healthy' | 'needs_review' | 'idle'

export interface ConnectionSummary {
  id: string
  name: string
  mapping: ConnectionMapping | null
  output_profile: ConnectionProfile | null
  health: ConnectionHealth | string
  events_processed: number
  events_by_status: Record<string, number>
  normalization_rate: number
  needs_review: number
  open_drift: number
  avg_latency_ms: number
  last_event_at: string | null
}

export interface ConnectionEvent {
  id: number
  event_id: string
  status: EventStatus | string
  received_at: string
}

export interface ConnectionDetail extends ConnectionSummary {
  created_at: string | null
  recent_events: ConnectionEvent[]
  drift: DriftSummary[]
}

export interface Recipe {
  id: number
  source: string
  mapping_id: number
  output_profile_id: number | null
  created_at: string
}

export interface Destination {
  id: number
  name: string
  type: 'console' | 'http' | 's3' | 'kafka' | string
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
}

export interface Anomalies {
  high_volume: { source_ip: string; count: number }[]
  scanners: { source_ip: string; distinct_destinations: number }[]
}

export const SEMANTIC_FIELDS = [
  'event.timestamp',
  'event.type',
  'event.severity',
  'event.outcome',
  'source.ip',
  'source.port',
  'source.hostname',
  'source.user',
  'source.mac',
  'destination.ip',
  'destination.port',
  'destination.hostname',
  'network.protocol',
  'network.action',
  'network.transport',
  'identity.user',
  'identity.session_id',
  'device.hostname',
  'device.product',
  'device.vendor',
  'device.version',
  'threat.signature',
  'threat.category',
  'threat.severity',
  'authentication.result',
  'authentication.reason',
]