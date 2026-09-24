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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.14] bg-slate-900/40 px-6 py-16 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.035),inset_0_0_40px_rgba(2,6,23,0.35)]">
      <div className="mb-4 rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.06] p-3 text-cyan-300/75 shadow-[0_10px_26px_-18px_rgba(6,182,212,0.85)]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-10 w-10">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m4-2h2m-2 16h2" />
        </svg>
      </div>
      <p className="text-[15px] font-semibold tracking-[0.01em] text-slate-100">{title}</p>
      {description && <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-slate-400">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
