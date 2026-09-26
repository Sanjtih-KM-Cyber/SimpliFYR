const STATUS_COLORS: Record<string, string> = {
  received: 'border-outline/30 bg-surface-variant text-on-surface-variant',
  parsed: 'border-info/30 bg-info-container/20 text-info',
  normalized: 'border-primary/30 bg-primary-container/20 text-primary',
  output: 'border-success/30 bg-success-container/20 text-success',
  quarantined: 'border-warning/30 bg-warning-container/20 text-warning',
  dlq: 'border-error/30 bg-error-container/20 text-error',
  draft: 'border-outline/30 bg-surface-variant text-on-surface-variant',
  published: 'border-success/30 bg-success-container/20 text-success',
  approved: 'border-info/30 bg-info-container/20 text-info',
  deprecated: 'border-error/40 bg-error-container/20 text-error',
}

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'border-outline/30 bg-surface-variant text-on-surface-variant'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-label-sm font-semibold tracking-wide ${color}`}
    >
      {status}
    </span>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 surface-inset rounded-2xl border-error/30 bg-error-container/15 px-3.5 py-3 text-body-sm leading-relaxed text-error shadow-[0_12px_28px_-22px_var(--color-error)]">
      {message}
    </div>
  )
}