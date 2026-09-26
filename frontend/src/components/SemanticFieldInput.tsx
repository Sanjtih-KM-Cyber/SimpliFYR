import { useState, useRef, useEffect, useMemo } from 'react'
import { SEMANTIC_FIELDS } from '../api/types'

const CUSTOM = '__custom__'

const FIELD_GROUPS: Record<string, string[]> = {
  Event: ['event.timestamp', 'event.type', 'event.severity', 'event.outcome'],
  Source: ['source.ip', 'source.port', 'source.hostname', 'source.user', 'source.mac'],
  Destination: ['destination.ip', 'destination.port', 'destination.hostname'],
  Network: ['network.protocol', 'network.action', 'network.transport'],
  Identity: ['identity.user', 'identity.session_id'],
  Device: ['device.hostname', 'device.product', 'device.vendor', 'device.version'],
  Threat: ['threat.signature', 'threat.category', 'threat.severity'],
  Authentication: ['authentication.result', 'authentication.reason'],
}

export function SemanticFieldInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const isCustom = value !== '' && !SEMANTIC_FIELDS.includes(value)
  const [customizing, setCustomizing] = useState(isCustom)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (inputRef.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredGroups = useMemo(() => {
    if (!search) return FIELD_GROUPS
    const lc = search.toLowerCase()
    const filtered: Record<string, string[]> = {}
    for (const [group, fields] of Object.entries(FIELD_GROUPS)) {
      const matches = fields.filter((f) => f.toLowerCase().includes(lc))
      if (matches.length) filtered[group] = matches
    }
    return filtered
  }, [search])

  function onSelect(v: string) {
    if (v === CUSTOM) {
      setCustomizing(true)
      onChange('')
      setSearch('')
    } else {
      setCustomizing(false)
      onChange(v)
      setOpen(false)
    }
  }

  if (customizing || isCustom) {
    return (
      <span className="flex flex-1 gap-2">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="custom.field (e.g. firewall.rule)"
          className="flex-1 input-glass px-3 py-2 font-mono text-body-sm text-primary placeholder:text-on-surface-variant/50"
          onFocus={() => setOpen(false)}
        />
        <button
          onClick={() => {
            setCustomizing(false)
            onChange('')
          }}
          title="Back to list"
          className="control-icon h-9 w-9"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </span>
    )
  }

  return (
    <div className="relative flex-1" onClick={() => setOpen(!open)}>
      <input
        ref={inputRef}
        type="search"
        value={search || value}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        placeholder={value ? value : 'Semantic field…'}
        className="input-glass flex-1 pr-10"
        readOnly
        onFocus={() => setOpen(true)}
      />
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-4 w-4 absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60 pointer-events-none transition-transform duration-200 ease-standard ${open ? 'rotate-180' : ''}`}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0l-4.25-4.51a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>

      {open && (
        <ul
          ref={listRef}
          className="absolute z-20 top-full left-0 right-0 mt-2 glass-flyout rounded-2xl border border-glass-strong p-1.5 shadow-e4 max-h-80 overflow-auto animate-menu-in"
          role="listbox"
        >
          {Object.entries(filteredGroups).map(([group, fields]) => (
            <li key={group}>
              <p className="px-3 pt-2 pb-1 text-label-sm font-semibold text-on-surface-variant/70 uppercase tracking-wide">{group}</p>
              {fields.map((f) => (
                <button
                  key={f}
                  onClick={() => onSelect(f)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm font-mono transition-all duration-150 ease-standard ${value === f ? 'bg-primary/10 text-primary font-medium' : 'text-on-surface hover:bg-primary/5 hover:text-primary'}`}
                  role="option"
                  aria-selected={value === f}
                >
                  <span className="min-w-0 flex-1 truncate text-left">{f}</span>
                  {value === f && (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0" aria-hidden="true">
                      <path
                        fillRule="evenodd"
                        d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 011.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </li>
          ))}
          <li>
            <hr className="my-1.5 border-outline-variant/50" />
            <button
              onClick={() => onSelect(CUSTOM)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm font-mono text-warning transition-all duration-150 ease-standard hover:bg-warning-container/10"
              role="option"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
              Custom…
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}