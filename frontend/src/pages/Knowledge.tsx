import { listMappings } from '../api/client'
import type { Mapping } from '../api/types'
import { Arrow } from '../components/Arrow'
import { Empty } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { useAsync } from '../hooks/useAsync'
import { useConnection } from './connection-context'

const ACTIVE_STATUSES = new Set(['approved', 'published'])

function LearningCurve({
  learnings,
  lastLearningAt,
  autoRate,
}: {
  learnings: number
  lastLearningAt: string | null
  autoRate: number
}) {
  return (
    <section className="mb-6 grid grid-cols-3 gap-4">
      <div className="glass-card rounded-xl p-5">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Approved Learnings</p>
        <p className="mt-2 text-headline-sm font-semibold text-on-surface">{learnings}</p>
      </div>
      <div className="glass-card rounded-xl p-5">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Last Learning</p>
        <p className="mt-2 text-body-md font-semibold text-on-surface">
          {lastLearningAt ? new Date(lastLearningAt).toLocaleString() : '—'}
        </p>
      </div>
      <div className="glass-card rounded-xl p-5">
        <p className="text-label-sm font-semibold uppercase tracking-wide text-on-surface-variant">Automatically Handled</p>
        <p className="mt-2 text-headline-sm font-semibold text-on-surface">{(autoRate * 100).toFixed(1)}%</p>
      </div>
    </section>
  )
}

export default function Knowledge({ sourceFilter }: { sourceFilter?: string }) {
  const mappings = useAsync(() => listMappings(), [])
  const { connection } = useConnection()

  const bySource = new Map<string, Mapping[]>()
  for (const m of mappings.data ?? []) {
    if (sourceFilter && m.source !== sourceFilter) continue
    const key = m.source ?? m.name
    if (!bySource.has(key)) bySource.set(key, [])
    bySource.get(key)!.push(m)
  }
  for (const list of bySource.values()) list.sort((a, b) => b.version - a.version)

  const activeLearnings = sourceFilter
    ? (mappings.data ?? []).filter(
        (m) => m.source === sourceFilter && ACTIVE_STATUSES.has(m.status),
      ).length
    : 0
  const lastLearningAt = sourceFilter
    ? (mappings.data ?? [])
        .filter((m) => m.source === sourceFilter)
        .map((m) => m.created_at)
        .sort()
        .at(-1) ?? null
    : null

  return (
    <div>
      {!sourceFilter && (
        <header className="mb-6">
          <h2 className="text-headline-sm font-semibold tracking-tight text-on-surface">Knowledge</h2>
          <p className="text-body-md text-on-surface-variant">
            Versioned vendor knowledge. Software updates create new versions; old ones remain.
          </p>
        </header>
      )}

      {sourceFilter && (
        <LearningCurve
          learnings={activeLearnings}
          lastLearningAt={lastLearningAt}
          autoRate={connection.normalization_rate}
        />
      )}

      {mappings.loading && <Spinner />}
      {mappings.error && <p className="text-body-sm text-error">{mappings.error}</p>}
      {!mappings.loading && bySource.size === 0 && (
        <Empty
          message={
            sourceFilter
              ? 'No learnings for this connection yet. Approved corrections appear here.'
              : 'No knowledge configured yet.'
          }
        />
      )}

      <div className="space-y-4">
        {[...bySource.entries()].map(([source, versions]) => (
          <div key={source} className="glass-card rounded-xl p-5 animate-slide-up">
            <h3 className="mb-2 text-label-lg font-semibold text-on-surface">{source}</h3>
            <div className="space-y-2">
              {versions.map((m) => (
                <div key={m.id} className="surface-inset rounded-xl p-3.5 animate-slide-up">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-body-sm text-on-surface">
                      v{m.version} <span className="text-on-surface-variant">· {m.name}</span>
                    </span>
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-body-sm text-on-surface-variant">
                    {m.fields.map((f) => (
                      <span key={`${f.input_field}-${f.semantic_field}`} className="font-mono text-body-sm">
                        {f.input_field}<Arrow variant="mapping" size="sm" />{f.semantic_field}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}