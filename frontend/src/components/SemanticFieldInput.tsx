import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { listSemanticFields } from '../api/client'
import type { SemanticFieldEntry } from '../api/types'
import { SEMANTIC_FIELDS } from '../api/types'

const CUSTOM = '__custom__'

// Shared across every mounted picker: one fetch per page load, with the
// static catalog as the offline fallback.
let catalogPromise: Promise<SemanticFieldEntry[]> | null = null

function getCatalog(): Promise<SemanticFieldEntry[]> {
  if (!catalogPromise) {
    catalogPromise = listSemanticFields().catch(() =>
      SEMANTIC_FIELDS.map((name, i) => ({
        id: -i - 1,
        name,
        data_type: '',
        description: '',
        is_custom: false,
        created_at: null,
      })),
    )
  }
  return catalogPromise
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Closest existing catalog name by normalized similarity (spell-check grade). */
function closestMatch(value: string, names: string[]): string | null {
  const nv = normalizeName(value)
  if (!nv) return null
  let best: string | null = null
  let bestScore = 0
  for (const name of names) {
    if (name === value) continue
    const nn = normalizeName(name)
    if (!nn) continue
    let score = 0
    if (nn === nv) score = 3
    else if (nn.includes(nv) || nv.includes(nn)) score = 2
    else {
      const known = new Set(nn.split(/(?=[A-Z])|_|\./).filter((t) => t.length > 2))
      const mine = nv.split(/(?=[A-Z])|_|\./).filter((t) => t.length > 2)
      if (mine.some((t) => known.has(t))) score = 1
    }
    if (score > bestScore || (score === bestScore && best !== null && name.length < best.length)) {
      bestScore = score
      best = name
    }
  }
  return bestScore > 0 ? best : null
}

function groupFor(name: string): string {
  const dot = name.indexOf('.')
  if (dot <= 0) return 'Custom'
  const head = name.slice(0, dot)
  return head.charAt(0).toUpperCase() + head.slice(1)
}

interface MenuPosition {
  top?: number
  bottom?: number
  left: number
  width: number
}

const FIELD_GROUPS: Record<string, string[]> = {
  Event: ['event.timestamp', 'event.type', 'event.severity', 'event.outcome'],
  Source: ['source.ip', 'source.port', 'source.hostname', 'source.user', 'source.mac'],
  Destination: ['destination.ip', 'destination.port', 'destination.hostname'],
  Network: ['network.protocol', 'network.action', 'network.transport', 'network.bytes'],
  Identity: ['identity.user', 'identity.session_id'],
  Device: ['device.hostname', 'device.product', 'device.vendor', 'device.version'],
  Observer: ['observer.hostname'],
  Rule: ['rule.id', 'rule.name'],
  Threat: ['threat.signature', 'threat.category', 'threat.severity', 'threat.level'],
  Authentication: ['authentication.result', 'authentication.reason'],
  Log: ['log.original', 'log.format'],
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
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (inputRef.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // The menu portals above ancestor clipping (e.g. modal overflow) and
  // flips upward when there is not enough room below the trigger.
  const updateMenuPos = useCallback(() => {
    const el = wrapperRef.current
    if (!el || typeof window === 'undefined') return
    const GAP = 8
    const rect = el.getBoundingClientRect()
    const width = Math.max(rect.width, 200)
    const maxLeft = window.innerWidth - width - 8
    const left = Math.min(rect.left, Math.max(8, maxLeft))
    const need = 240
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    if (spaceBelow >= need || spaceAbove <= spaceBelow) {
      setMenuPos({ top: rect.bottom + GAP, left, width })
    } else {
      setMenuPos({ bottom: window.innerHeight - rect.top + GAP, left, width })
    }
  }, [])

  useEffect(() => {
    if (open) {
      updateMenuPos()
    } else {
      setMenuPos(null)
    }
  }, [open, updateMenuPos])

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', updateMenuPos)
    window.addEventListener('scroll', updateMenuPos, true)
    return () => {
      window.removeEventListener('resize', updateMenuPos)
      window.removeEventListener('scroll', updateMenuPos, true)
    }
  }, [open, updateMenuPos])

  const [catalog, setCatalog] = useState<SemanticFieldEntry[] | null>(null)

  useEffect(() => {
    let active = true
    getCatalog()
      .then((entries) => {
        if (active) setCatalog(entries)
      })
      .catch(() => {
        /* fallback below already covers failure */
      })
    return () => {
      active = false
    }
  }, [])

  // Registry-backed groups (customs included); static groups until loaded.
  const allGroups = useMemo(() => {
    if (!catalog) return FIELD_GROUPS
    const grouped: Record<string, string[]> = {}
    const order: string[] = []
    for (const entry of catalog) {
      const group = groupFor(entry.name)
      if (!grouped[group]) {
        grouped[group] = []
        order.push(group)
      }
      if (!grouped[group].includes(entry.name)) grouped[group].push(entry.name)
    }
    const known = Object.keys(FIELD_GROUPS)
    order.sort((a, b) => {
      const ai = known.indexOf(a)
      const bi = known.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      if (a === 'Custom') return 1
      if (b === 'Custom') return -1
      return a.localeCompare(b)
    })
    const sorted: Record<string, string[]> = {}
    for (const group of order) {
      sorted[group] = [...grouped[group]].sort()
      // Keep builtin order stable for the known catalog groups.
      if (FIELD_GROUPS[group]) {
        sorted[group] = [
          ...FIELD_GROUPS[group].filter((f) => grouped[group].includes(f)),
          ...sorted[group].filter((f) => !FIELD_GROUPS[group].includes(f)),
        ]
      }
    }
    return sorted
  }, [catalog])

  const allNames = useMemo(() => {
    if (!catalog) return SEMANTIC_FIELDS
    return catalog.map((e) => e.name)
  }, [catalog])

  const filteredGroups = useMemo(() => {
    if (!search) return allGroups
    const lc = search.toLowerCase()
    const filtered: Record<string, string[]> = {}
    for (const [group, fields] of Object.entries(allGroups)) {
      const matches = fields.filter((f) => f.toLowerCase().includes(lc))
      if (matches.length) filtered[group] = matches
    }
    return filtered
  }, [search, allGroups])

  const hint = useMemo(() => {
    if (!customizing && !isCustom) return null
    if (!value.trim()) return null
    if (allNames.includes(value)) return null
    return closestMatch(value, allNames)
  }, [customizing, isCustom, value, allNames])

  function onSelect(v: string) {
    if (v === CUSTOM) {
      setCustomizing(true)
      onChange('')
      setSearch('')
    } else {
      setCustomizing(false)
      onChange(v)
      setOpen(false)
      setSearch('')
    }
  }

  // No match at all: jump straight into a custom value with what was typed.
  function useAsCustom() {
    const name = search.trim()
    if (!name) return
    setCustomizing(true)
    onChange(name)
    setSearch('')
    setOpen(false)
  }

  // Flat visible options (group order) for Enter-to-pick.
  const visibleOptions = useMemo(() => {
    const out: string[] = []
    for (const fields of Object.values(filteredGroups)) out.push(...fields)
    return out
  }, [filteredGroups])

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const exact = visibleOptions.find((f) => f.toLowerCase() === search.trim().toLowerCase())
      if (exact) onSelect(exact)
      else if (visibleOptions.length > 0) onSelect(visibleOptions[0])
      else useAsCustom()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  if (customizing || isCustom) {
    return (
      <span className="flex flex-1 flex-col gap-1.5">
        <span className="flex gap-2">
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
        {hint && (
          <button
            type="button"
            onClick={() => {
              setCustomizing(false)
              onChange(hint)
            }}
            title="Use the closest existing catalog field instead"
            className="self-start rounded-lg px-1 py-0.5 text-left font-mono text-mono-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            Did you mean <span className="text-primary">{hint}</span>? Use instead
          </button>
        )}
      </span>
    )
  }

  return (
    <div ref={wrapperRef} className="relative flex-1" onClick={() => { if (!open) { setSearch(''); setOpen(true) } }}>
      <input
        ref={inputRef}
        type="search"
        value={open ? search : value || search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        onKeyDown={onKeyDown}
        onFocus={() => { setSearch(''); setOpen(true) }}
        placeholder={value ? value : 'Semantic field… (type to filter)'}
        autoComplete="off"
        className="input-glass flex-1 pr-10"
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

      {open && menuPos && typeof document !== 'undefined' && createPortal(
        <ul
          ref={listRef}
          className="fixed z-50 glass-flyout rounded-2xl border border-glass-strong p-1.5 shadow-e4 max-h-80 overflow-auto animate-menu-in"
          style={{
            top: menuPos.top,
            bottom: menuPos.bottom,
            left: menuPos.left,
            width: menuPos.width,
          }}
          role="listbox"
        >
          {search.trim() && visibleOptions.length === 0 && (
            <li>
              <button
                onClick={useAsCustom}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm font-mono text-warning transition-all duration-150 ease-standard hover:bg-warning-container/10"
                role="option"
                aria-selected={false}
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
                Create custom “{search.trim()}”…
              </button>
            </li>
          )}
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
        </ul>,
        document.body,
      )}
    </div>
  )
}