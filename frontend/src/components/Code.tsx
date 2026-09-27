import { useState } from 'react'

const DEFAULT_MAX_LINES = 20

export function Code({
  value,
  inline,
  maxWidth,
  truncate,
  maxLines = DEFAULT_MAX_LINES,
}: { value: unknown; inline?: boolean; maxWidth?: string; truncate?: boolean; maxLines?: number }) {
  const text =
    typeof value === 'string'
      ? value
      : JSON.stringify(value, null, 2) ?? String(value)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const lines = text.split('\n')
  const shouldTruncate = truncate && lines.length > maxLines
  const displayText = shouldTruncate && !expanded ? lines.slice(0, maxLines).join('\n') + '\n…' : text

  if (inline) {
    return (
      <span className="relative inline-flex items-center gap-1.5 max-w-[280px] overflow-hidden">
        <span className="truncate font-mono text-mono-sm text-primary bg-surface-container-low px-1.5 py-0.5 rounded">
          {displayText}
        </span>
        <button
          onClick={handleCopy}
          className="control-icon h-5 w-5 shrink-0 text-on-surface-variant/50 hover:text-primary"
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        >
          {copied ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 001.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 002-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
          )}
        </button>
      </span>
    )
  }

  return (
    <div className="relative overflow-x-auto surface-inset rounded-2xl p-4 font-mono text-mono-sm leading-relaxed text-on-surface" style={{ maxWidth }}>
      <div className="absolute top-3 right-3 flex items-center gap-1.5">
        {shouldTruncate && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="control-icon h-7 w-7 text-on-surface-variant/70 hover:text-primary"
            aria-label={expanded ? 'Show less' : 'Show more'}
            title={expanded ? 'Show less' : 'Show more'}
          >
            {expanded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            )}
          </button>
        )}
        <button
          onClick={handleCopy}
          className="control-icon h-7 w-7 text-on-surface-variant/70"
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        >
          {copied ? (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 001.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 002-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
            </svg>
          )}
        </button>
      </div>
      <pre className="whitespace-pre-wrap"><code>{displayText}</code></pre>
    </div>
  )
}

export function Empty({ message }: { message: string }) {
  return <p className="surface-inset rounded-2xl py-8 text-center text-body-md text-on-surface-variant">{message}</p>
}