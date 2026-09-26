import type { ReactNode } from 'react'

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-outline-variant/50 bg-surface-container/50 px-6 py-16 text-center shadow-e2">
      <div className="mb-4 rounded-2xl border border-primary/15 bg-primary-container/15 p-3 text-primary shadow-[0_10px_26px_-18px_var(--color-primary)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-10 w-10 mx-auto">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m4-2h2m-2 16h2" />
        </svg>
      </div>
      <p className="text-title-md font-semibold text-on-surface">{title}</p>
      {description && <p className="mt-2 max-w-sm text-body-md leading-relaxed text-on-surface-variant">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}