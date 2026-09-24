import { NavLink } from 'react-router-dom'

export interface TabItem {
  to: string
  label: string
  end?: boolean
  badge?: number
}

export function TabBar({ tabs }: { tabs: TabItem[] }) {
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-2xl border border-white/[0.1] bg-slate-900/65 p-1.5 shadow-[0_14px_35px_-28px_rgba(0,0,0,0.95)]">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `flex items-center rounded-xl px-4 py-2 text-[13px] font-semibold transition-all duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${isActive
              ? 'bg-cyan-400/[0.14] text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_20px_-16px_rgba(6,182,212,0.95)]'
              : 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-100'
            }`
          }
        >
          {t.label}
          {typeof t.badge === 'number' && t.badge > 0 && (
            <span className="ml-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
              {t.badge}
            </span>
          )}
        </NavLink>
      ))}
    </div>
  )
}
