const STATUS_COLORS: Record<string, string> = {
  received: 'bg-slate-700 text-slate-200',
  parsed: 'bg-sky-700 text-sky-100',
  normalized: 'bg-indigo-700 text-indigo-100',
  output: 'bg-emerald-700 text-emerald-100',
  quarantined: 'bg-amber-700 text-amber-100',
  dlq: 'bg-red-700 text-red-100',
  draft: 'bg-slate-700 text-slate-200',
  published: 'bg-emerald-700 text-emerald-100',
  approved: 'bg-teal-700 text-teal-100',
  deprecated: 'bg-red-800 text-red-100',
}

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-slate-700 text-slate-200'
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {status}
    </span>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-200">
      {message}
    </div>
  )
}