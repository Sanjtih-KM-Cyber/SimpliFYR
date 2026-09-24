import { Link } from 'react-router-dom'
import { listAudit } from '../api/client'
import { Code } from '../components/Code'
import { Spinner } from '../components/Spinner'
import { EmptyState, TabBar } from '../components/ui'
import { useAsync } from '../hooks/useAsync'

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function Audit() {
  const audit = useAsync(() => listAudit(), [])

  return (
    <div>
      <TabBar
        tabs={[
          { to: '/settings', label: 'General' },
          { to: '/settings/audit', label: 'Audit' },
          { to: '/settings/destinations', label: 'Destinations' },
        ]}
      />
      <p className="mb-4 -mt-3 text-sm text-slate-400">
        Every configuration-changing action, traceable.{' '}
        <Link to="/connections" className="text-slate-500 hover:text-slate-300">
          Connections
        </Link>{' '}
        and{' '}
        <Link to="/needs-review" className="text-slate-500 hover:text-slate-300">
          Needs Review
        </Link>{' '}
        changes are recorded here.
      </p>

      {audit.loading && <Spinner />}
      {audit.error && <p className="text-sm text-red-400">{audit.error}</p>}
      {!audit.loading && (audit.data?.length ?? 0) === 0 && (
        <EmptyState title="No audit records yet" description="Configuration-changing actions will appear here." />
      )}

      <div className="overflow-hidden rounded-2xl border border-white/[0.1] bg-slate-900/55 shadow-[0_18px_44px_-34px_rgba(0,0,0,0.95)]">
        <table className="w-full text-sm">
          <thead className="border-b border-white/[0.1] bg-white/[0.045] text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06] bg-slate-950/40">
            {(audit.data ?? []).map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 whitespace-nowrap text-slate-400">
                  {formatTime(a.created_at)}
                </td>
                <td className="px-3 py-2">
                  <span className="status-chip text-xs">
                    {a.action}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-300">
                  {a.entity_type} #{a.entity_id}
                </td>
                <td className="px-3 py-2 text-slate-400">{a.actor ?? 'system'}</td>
                <td className="px-3 py-2">
                  {a.before || a.after ? (
                    <Code value={{ before: a.before, after: a.after }} />
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
