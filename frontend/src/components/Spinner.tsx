export function Spinner() {
  return (
    <div className="flex justify-center py-8" role="status" aria-label="Loading">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700/80 border-t-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.25)]" />
    </div>
  )
}
