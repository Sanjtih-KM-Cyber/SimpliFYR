export function Code({ value }: { value: unknown }) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2) ?? String(value)
  return (
    <pre className="overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-300">
      <code>{text}</code>
    </pre>
  )
}

export function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{message}</p>
}