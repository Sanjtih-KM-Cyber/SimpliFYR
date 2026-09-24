import { listMappings } from '../api/client'
import type { Mapping } from '../api/types'
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
      <div className="glass-card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-wide text-slate-400">Approved Learnings</p>
        <p className="mt-2 text-2xl font-semibold text-white">{learnings}</p>
      </div>
      <div className="glass-card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-wide text-slate-400">Last Learning</p>
        <p className="mt-2 text-sm font-semibold text-white">
          {lastLearningAt ? new Date(lastLearningAt).toLocaleString() : '—'}
        </p>
      </div>
      <div className="glass-card rounded-2xl p-5">
        <p className="text-xs uppercase tracking-wide text-slate-400">Automatically Handled</p>
        <p className="mt-2 text-2xl font-semibold text-white">{(autoRate * 100).toFixed(1)}%</p>
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
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-white">Knowledge</h2>
          <p className="text-sm text-slate-400">
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
      {mappings.error && <p className="text-sm text-red-400">{mappings.error}</p>}
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
          <div key={source} className="glass-card rounded-2xl p-5">
            <h3 className="mb-2 text-sm font-semibold text-white">{source}</h3>
            <div className="space-y-2">
              {versions.map((m) => (
                <div key={m.id} className="surface-inset rounded-xl p-3.5">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm text-slate-200">
                      v{m.version} <span className="text-slate-500">· {m.name}</span>
                    </span>
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                    {m.fields.map((f) => (
                      <span key={`${f.input_field}-${f.semantic_field}`} className="font-mono">
                        {f.input_field}→{f.semantic_field}
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
