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
            `-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'border-white text-white'
                : 'border-transparent text-slate-400 hover:text-white'
            }`
          }
        >
          {t.label}
          {typeof t.badge === 'number' && t.badge > 0 && (
            <span className="ml-1.5 rounded-full bg-amber-700 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {t.badge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  )
}
