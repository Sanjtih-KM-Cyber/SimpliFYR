import { NavLink } from 'react-router-dom'

export interface TabItem {
  to: string
  label: string
  end?: boolean
  badge?: number
}

export function TabBar({ tabs }: { tabs: TabItem[] }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-outline-variant bg-surface-container-low/60 p-1.5 shadow-e2">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `flex items-center rounded-lg px-4 py-2 text-label-lg font-semibold transition-all duration-200 ease-emphasized focus-ring ${
              isActive
                ? 'bg-primary text-on-primary shadow-e2'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`
          }
        >
          {t.label}
          {typeof t.badge === 'number' && t.badge > 0 && (
            <span className="ml-2 rounded-full border border-outline-variant bg-surface-container px-2 py-0.5 text-label-sm font-semibold text-on-surface-variant">
              {t.badge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  )
}