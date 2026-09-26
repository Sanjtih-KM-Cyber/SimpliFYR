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
    <header className="mb-7 flex items-start justify-between gap-5 border-b border-outline-variant/50 pb-5">
      <div>
        <h2 className="text-headline-sm font-semibold tracking-tight text-on-surface">{title}</h2>
        {subtitle && <p className="mt-2 max-w-2xl text-body-md leading-relaxed text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3">{actions}</div>}
    </header>
  )
}