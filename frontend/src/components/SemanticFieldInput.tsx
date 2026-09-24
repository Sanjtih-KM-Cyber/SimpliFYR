import { useState } from 'react'
import { SEMANTIC_FIELDS } from '../api/types'

const CUSTOM = '__custom__'

/** Semantic field picker: curated list plus free-typed custom values.
 *  Custom entries should stay dotted (`group.name`); anything non-empty
 *  is accepted — the backend stores it verbatim and future exports learn it. */
export function SemanticFieldInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const isCustom = value !== '' && !SEMANTIC_FIELDS.includes(value)
  const [customizing, setCustomizing] = useState(isCustom)

  function onSelect(v: string) {
    if (v === CUSTOM) {
      setCustomizing(true)
      onChange('')
    } else {
      setCustomizing(false)
      onChange(v)
    }
  }

  if (customizing || isCustom) {
    return (
      <span className="flex flex-1 gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="custom.field (e.g. firewall.rule)"
          className="flex-1 rounded-md border border-purple-500/40 bg-slate-950 px-3 py-2 font-mono text-sm text-purple-200 placeholder:text-slate-600"
        />
        <button
          onClick={() => {
            setCustomizing(false)
            onChange('')
          }}
          title="Back to list"
          className="rounded-md border border-slate-700 px-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          ✕
        </button>
      </span>
    )
  }

  return (
    <select
      value={value}
      onChange={(e) => onSelect(e.target.value)}
      className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
    >
      <option value="">Semantic field…</option>
      {SEMANTIC_FIELDS.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
      <option value={CUSTOM}>✎ Custom…</option>
    </select>
  )
}
