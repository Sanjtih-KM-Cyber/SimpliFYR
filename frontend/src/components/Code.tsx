import { useState } from 'react'

export function Code({ value }: { value: unknown }) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2) ?? String(value)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="relative overflow-x-auto surface-inset rounded-2xl p-4 font-mono text-mono-sm leading-relaxed text-on-surface">
      <div className="absolute top-3 right-3">
        <button
          onClick={handleCopy}
          className="control-icon h-7 w-7 text-on-surface-variant/70"
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        >
          {copied ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
          )}
        </button>
      </div>
      <pre className="whitespace-pre-wrap"><code>{text}</code></pre>
    </div>
  )
}

export function Empty({ message }: { message: string }) {
  return <p className="surface-inset rounded-2xl py-8 text-center text-body-md text-on-surface-variant">{message}</p>
}