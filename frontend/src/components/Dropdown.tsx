import { useState, useRef, useEffect, useMemo, type ReactNode, type ChangeEvent, type KeyboardEvent } from 'react'
import { Arrow } from './Arrow'

interface DropdownOption<T> {
  value: T
  label: string
  disabled?: boolean
}

interface DropdownProps<T> {
  value: T
  onChange: (value: T) => void
  options: DropdownOption<T>[]
  placeholder?: string
  disabled?: boolean
  className?: string
  searchable?: boolean
  maxHeight?: number
  allowClear?: boolean
  triggerClassName?: string
  menuClassName?: string
}

const CHEVRON_SVG = (
  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M10 5a3 3 0 013 3v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H4a1 1 0 110-2h3V8a3 3 0 013-3z" />
  </svg>
)

const CHECK_SVG = (
  <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
    <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
  </svg>
)

function ChevronIcon({ className = '' }: { className?: string }) {
  return <span className={`inline-flex shrink-0 ${className}`}>{CHEVRON_SVG}</span>
}

function CheckIcon({ className = '' }: { className?: string }) {
  return <span className={`inline-flex shrink-0 ${className}`}>{CHECK_SVG}</span>
}

interface DropdownTriggerProps {
  value: string
  placeholder: string
  disabled?: boolean
  open: boolean
  onClick: () => void
  onKeyDown: (e: KeyboardEvent) => void
  className?: string
  allowClear?: boolean
  onClear?: () => void
}

function DropdownTrigger({
  value,
  placeholder,
  disabled,
  open,
  onClick,
  onKeyDown,
  className,
  allowClear,
  onClear,
}: DropdownTriggerProps) {
  return (
    <div
      className={`relative inline-flex items-center justify-between rounded-xl border border-outline-variant bg-surface-container/80 px-3.5 py-2.5 text-body-sm text-on-surface placeholder:text-on-surface-variant/50 transition-all duration-200 ease-standard hover:border-primary/30 hover:bg-surface-container hover:shadow-e1 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 focus-within:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-outline-variant disabled:hover:bg-surface-container/80 ${className}`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span className={`flex-1 truncate ${value ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
        {value || placeholder}
      </span>
      <span className="flex items-center gap-1.5 ml-2">
        {allowClear && value && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onClear?.() }}
            className="rounded-lg p-1 text-on-surface-variant/50 hover:text-on-surface hover:bg-surface-container transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Clear selection"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 10 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 10 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        )}
        <ChevronIcon className={`text-on-surface-variant/50 transition-transform duration-200 ease-standard ${''}`} />
      </span>
    </div>
  )
}

interface DropdownMenuProps<T> {
  options: DropdownOption<T>[]
  value: T
  search: string
  open: boolean
  onSelect: (value: T) => void
  onClose: () => void
  searchable?: boolean
  maxHeight?: number
  className?: string
  onSearchChange?: (search: string) => void
}

function DropdownMenu<T>({
  options,
  value,
  search,
  open,
  onSelect,
  onClose,
  searchable,
  maxHeight = 320,
  className,
  onSearchChange,
}: DropdownMenuProps<T>) {
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (listRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onClose])

  const filteredOptions = useMemo(() => {
    if (!search) return options
    const lc = search.toLowerCase()
    return options.filter((opt) => opt.label.toLowerCase().includes(lc))
  }, [options, search])

  if (!open) return null

  return (
    <div className="fixed z-50" style={{ pointerEvents: 'none' }}>
      <div
        ref={listRef}
        className={`absolute z-50 glass-flyout rounded-2xl shadow-e4 border border-glass-strong p-2 max-h-[${maxHeight}px] overflow-auto w-auto min-w-[200px] ${className}`}
        style={{ pointerEvents: 'auto' }}
        role="listbox"
        aria-activedescendant=""
      >
        {searchable && (
          <div className="sticky top-0 z-10 mb-2 glass-subtle rounded-xl p-2 border border-glass-subtle">
            <input
              type="search"
              value={search}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder="Search options…"
              className="w-full bg-transparent text-on-surface placeholder:text-on-surface-variant/50 text-body-sm outline-none"
              autoFocus
            />
          </div>
        )}
        <ul className="min-w-[180px]">
          {options.map((option, index) => (
            <li key={option.value} role="option" aria-selected={false}>
              {option.disabled ? (
                <span className="w-full px-3 py-2 text-body-sm text-on-surface-variant/40 cursor-not-allowed">
                  {option.label}
                </span>
              ) : (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onSelect(option.value)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm font-mono transition-all duration-150 ease-standard ${
                    value === option.value
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-on-surface hover:bg-primary/5 hover:text-primary'
                  }`}
                  disabled={option.disabled}
                >
                  <span className="truncate flex-1">{option.label}</span>
                  {value === option.value && <CheckIcon className="text-primary shrink-0" />}
                </button>
              )}
          ))}
        </ul>
      </div>
    </div>
  )
}

export function Dropdown<T>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  className = '',
  searchable = false,
  maxHeight = 320,
  allowClear = false,
  triggerClassName,
  menuClassName,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLDivElement>(null)

  const displayValue = useMemo(() => {
    const opt = options.find((o) => o.value === value)
    return opt?.label ?? ''
  }, [value, options])

  const handleSelect = (newValue: T) => {
    onChange(newValue)
    setOpen(false)
    setSearch('')
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(undefined as T)
    setOpen(false)
  }

  const toggleOpen = () => {
    if (disabled) return
    setOpen((prev) => !prev)
    if (!prev) setSearch('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setSearch('')
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleOpen()
    }
  }

  const handleTriggerClick = () => {
    toggleOpen()
  }

  const handleSearchChange = (newSearch: string) => {
    setSearch(newSearch)
  }

  return (
    <div className={`inline-flex ${className}`}>
      <DropdownTrigger
        ref={triggerRef}
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        open={open}
        onClick={handleTriggerClick}
        onKeyDown={handleKeyDown}
        className={triggerClassName}
        allowClear={allowClear && !!value}
        onClear={handleClear}
      />
      <DropdownMenu
        options={options}
        value={value}
        search={search}
        open={open}
        onSelect={handleSelect}
        onClose={() => setOpen(false)}
        searchable={searchable}
        maxHeight={maxHeight}
        className={menuClassName}
        onSearchChange={handleSearchChange}
      />
    </div>
  )
}

// Re-export for backward compatibility
export { Dropdown as Select }