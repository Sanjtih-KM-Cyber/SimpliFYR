export function Code({ value }: { value: unknown }) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2) ?? String(value)
  return (
    <pre className="overflow-x-auto rounded-2xl border border-white/[0.1] bg-slate-950/85 p-4 font-mono text-xs leading-relaxed text-slate-300 shadow-inner shadow-black/20">
      <code>{text}</code>
    </pre>
  )
}

export function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{message}</p>
}
