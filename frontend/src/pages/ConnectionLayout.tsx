import { useEffect } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { getConnection } from '../api/client'
import { Spinner } from '../components/Spinner'
import { StatusBadge } from '../components/Status'
import { TabBar } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useLive } from '../hooks/useLive'
import { type ConnectionContext } from './connection-context'

const HEALTH_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  needs_review: 'Needs review',
  idle: 'Idle',
}

export default function ConnectionLayout() {
  const { sourceName = '' } = useParams()
  const connection = useAsync(() => getConnection(sourceName), [sourceName])
  const c = connection.data

  // Live counts: any processed event refreshes this connection so badges
  // and tabs never show yesterday's numbers after an approve/onboard/delete.
  useLive({ source: sourceName || undefined, onEvent: () => connection.reload() })

  useEffect(() => {
    const timer = setInterval(() => connection.reload(), 15000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceName])

  return (
    <div>
      <Link to="/connections" className="mb-2 inline-block text-sm text-slate-400 hover:text-white">
        ← Connections
      </Link>

      {connection.loading && <Spinner />}
      {connection.error && <p className="text-sm text-red-400">{connection.error}</p>}

      {c && (
        <>
          <header className="mb-4">
            <h2 className="flex items-center gap-3 text-2xl font-semibold text-white">
              {c.name}
              <StatusBadge
                status={
                  c.health === 'healthy'
                    ? 'published'
                    : c.health === 'needs_review'
                      ? 'quarantined'
                      : 'draft'
                }
              />
              <span className="text-sm font-normal text-slate-400">
                {HEALTH_LABELS[c.health] ?? c.health}
              </span>
            </h2>
          </header>

          <TabBar
            tabs={[
              { to: `/connections/${sourceName}`, label: 'Overview', end: true },
              { to: `/connections/${sourceName}/mappings`, label: 'Mappings' },
              { to: `/connections/${sourceName}/output`, label: 'Output' },
              { to: `/connections/${sourceName}/learning`, label: 'Learning' },
              {
                to: `/connections/${sourceName}/needs-review`,
                label: 'Needs Review',
                badge: (c.open_drift ?? 0) + (c.events_by_status?.quarantined ?? 0),
              },
            ]}
          />

          <Outlet context={{ connection: c } satisfies ConnectionContext} />
        </>
      )}
    </div>
  )
}
