type SpinnerSize = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<SpinnerSize, string> = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
}

const STROKE_WIDTH: Record<SpinnerSize, number> = {
  sm: 3,
  md: 3,
  lg: 4,
}

export function Spinner({ size = 'md', label = 'Loading…' }: { size?: SpinnerSize; label?: string }) {
  return (
    <span className="inline-flex items-center justify-center" aria-label={label} role="status">
      <svg className={`animate-spin text-primary ${SIZE_CLASS[size]}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH[size]}
        />
        <path
          className="opacity-75"
          fill="none"
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH[size]}
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

export function SpinnerOverlay({ size = 'lg', label = 'Loading…' }: { size?: SpinnerSize; label?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 backdrop-blur-sm">
      <div className="surface-panel rounded-2xl p-6 flex flex-col items-center gap-3">
        <Spinner size={size} label={label} />
        <p className="text-body-md text-on-surface-variant">{label}</p>
      </div>
    </div>
  )
}