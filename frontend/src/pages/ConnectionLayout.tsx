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
    <div className="flex h-full flex-col">
      <Link to="/connections" className="mb-5 inline-flex items-center rounded-lg px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50">
        ← Return Admin Console
      </Link>

      {connection.loading && <div className="mt-8 flex justify-center"><Spinner /></div>}
      {connection.error && <p className="text-[13px] font-medium text-rose-400">{connection.error}</p>}

      {c && (
        <>
          <header className="mb-7 border-b border-white/[0.08] pb-5">
            <h2 className="flex flex-wrap items-center gap-4 text-[20px] font-bold tracking-[-0.02em] text-white">
              {c.name}
              <div className="h-5 w-px bg-white/[0.12]"></div>
              <StatusBadge
                status={
                  c.health === 'healthy'
                    ? 'published'
                    : c.health === 'needs_review'
                      ? 'quarantined'
                      : 'draft'
                }
              />
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                {HEALTH_LABELS[c.health] ?? c.health}
              </span>
            </h2>
          </header>

          <TabBar
            tabs={[
              { to: `/connections/${sourceName}`, label: 'OVERVIEW', end: true },
              { to: `/connections/${sourceName}/mappings`, label: 'SCHEMA MAP' },
              { to: `/connections/${sourceName}/output`, label: 'DESTINATIONS' },
              { to: `/connections/${sourceName}/learning`, label: 'AI KNOWLEDGE' },
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
