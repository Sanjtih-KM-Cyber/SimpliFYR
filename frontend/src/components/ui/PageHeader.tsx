import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-7 flex items-start justify-between gap-5 border-b border-white/[0.08] pb-5">
      <div>
        <h2 className="text-xl font-bold tracking-[-0.02em] text-white">{title}</h2>
        {subtitle && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </header>
  )
}
