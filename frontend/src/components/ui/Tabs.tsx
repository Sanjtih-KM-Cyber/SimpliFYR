import { NavLink } from 'react-router-dom'

export interface TabItem {
  to: string
  label: string
  end?: boolean
  badge?: number
}

export function TabBar({ tabs }: { tabs: TabItem[] }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-slate-800">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-all ${isActive
              ? 'border-cyan-500 text-cyan-500 shadow-[0_1px_10px_-2px_rgba(6,182,212,0.4)]'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`
          }
        >
          {t.label}
          {typeof t.badge === 'number' && t.badge > 0 && (
            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-500 border border-amber-500/30">
              {t.badge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  )
}
