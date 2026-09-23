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
    <div className="flex flex-col items-center justify-center rounded-lg border border-slate-700/50 bg-slate-900/30 backdrop-blur-sm px-6 py-16 text-center shadow-inner">
      <div className="mb-4 text-cyan-500/50">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-10 w-10">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m4-2h2m-2 16h2" />
        </svg>
      </div>
      <p className="text-[15px] font-semibold tracking-wide text-slate-200">{title}</p>
      {description && <p className="mt-2 max-w-sm text-[13px] text-slate-400">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
