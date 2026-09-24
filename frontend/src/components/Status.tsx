const STATUS_COLORS: Record<string, string> = {
  received: 'border border-slate-500/30 bg-slate-500/10 text-slate-300',
  parsed: 'border border-sky-500/30 bg-sky-500/10 text-sky-300',
  normalized: 'border border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
  output: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  quarantined: 'border border-amber-500/30 bg-amber-500/10 text-amber-300',
  dlq: 'border border-rose-500/30 bg-rose-500/10 text-rose-300',
  draft: 'border border-slate-500/30 bg-slate-500/10 text-slate-300',
  published: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  approved: 'border border-teal-500/30 bg-teal-500/10 text-teal-300',
  deprecated: 'border border-rose-500/40 bg-rose-500/10 text-rose-300',
}

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'border border-slate-500/30 bg-slate-500/10 text-slate-300'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ${color}`}
    >
      {status}
    </span>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 rounded-2xl border border-rose-400/30 bg-rose-950/55 px-3.5 py-3 text-sm leading-relaxed text-rose-100 shadow-[0_12px_28px_-22px_rgba(244,63,94,0.8)]">
      {message}
    </div>
  )
}
