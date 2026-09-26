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

  useLive({ source: sourceName || undefined, onEvent: () => connection.reload() })

  useEffect(() => {
    const timer = setInterval(() => connection.reload(), 15000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceName])

  return (
    <div className="flex h-full flex-col">
      <Link to="/connections" className="mb-5 inline-flex items-center rounded-lg px-1 text-label-sm font-semibold uppercase tracking-[0.14em] text-on-surface-variant transition-colors hover:text-primary hover:underline focus-ring">
        ADMIN CONSOLE
      </Link>

      {connection.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
      {connection.error && <p className="text-body-md font-medium text-error">{connection.error}</p>}

      {c && (
        <>
          <header className="mb-7 border-b border-outline-variant/50 pb-5">
            <h2 className="flex flex-wrap items-center gap-4 text-headline-sm font-semibold tracking-tight text-on-surface">
              {c.name}
              <div className="h-5 w-px bg-outline-variant/50"></div>
              <StatusBadge
                status={
                  c.health === 'healthy'
                    ? 'published'
                    : c.health === 'needs_review'
                    ? 'quarantined'
                    : 'draft'
                }
              />
              <span className="text-label-sm font-bold uppercase tracking-[0.14em] text-on-surface-variant">
                {HEALTH_LABELS[c.health] ?? c.health}
              </span>
            </h2>
          </header>

          <TabBar
            tabs={[
              { to: `/connections/${sourceName}`, label: 'OVERVIEW', end: true },
              { to: `/connections/${sourceName}/mappings`, label: 'SCHEMA MAP' },
              { to: `/connections/${sourceName}/learning`, label: 'AI KNOWLEDGE' },
              { to: `/connections/${sourceName}/live`, label: 'LIVE LOGS' },
              { to: `/connections/${sourceName}/logs`, label: 'LOGS' },
            ]}
          />

          <div className="mt-6 flex-1">
            <Outlet context={{ connection: c } satisfies ConnectionContext} />
          </div>
        </>
      )}
    </div>
  )
}