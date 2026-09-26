import { useEffect, useRef, useState } from 'react'
/* ============================================================
   TYPES
   ============================================================ */

interface DropdownOption<T> {
  value: T
  label: string
  disabled?: boolean
}

interface DropdownProps<T> {
  value: T | undefined
  onChange: (value: T | undefined) => void
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

interface DropdownTriggerProps {
  value: string
  placeholder: string
  disabled?: boolean
  open: boolean
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  className?: string
  allowClear?: boolean
  onClear?: () => void
}

interface DropdownMenuProps<T> {
  options: DropdownOption<T>[]
  value: T | undefined
  search: string
  open: boolean
  onSelect: (value: T | undefined) => void
  onClose: () => void
  searchable?: boolean
  maxHeight?: number
  className?: string
  onSearchChange?: (search: string) => void
}

/* ============================================================
   ICONS
   ============================================================ */

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 shrink-0 text-on-surface-variant/60 transition-transform duration-200 ease-standard ${
        open ? 'rotate-180' : ''
      }`}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0l-4.25-4.51a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 001.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 010 1.42l-7.25 7.25a1 1 0 01-1.42 0l-3.25-3.25a1 1 0 011.42-1.42l2.54 2.54 6.54-6.54a1 1 0 011.42 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/* ============================================================
   DROPDOWN TRIGGER
   ============================================================ */

function DropdownTrigger({
  value,
  placeholder,
  disabled = false,
  open,
  onClick,
  onKeyDown,
  className = '',
  allowClear = false,
  onClear,
}: DropdownTriggerProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`
        relative inline-flex min-w-0 items-center justify-between
        rounded-xl
        border border-outline-variant
        bg-surface-container/80
        px-3.5 py-2.5
        text-left text-body-sm
        text-on-surface
        transition-all duration-200 ease-standard

        hover:border-primary/30
        hover:bg-surface-container
        hover:shadow-e1

        focus-visible:border-primary
        focus-visible:outline-none
        focus-visible:ring-2
        focus-visible:ring-primary/20

        disabled:cursor-not-allowed
        disabled:opacity-50
        disabled:hover:border-outline-variant
        disabled:hover:bg-surface-container/80
        disabled:hover:shadow-none

        ${className}
      `}
    >
      <span
        className={`
          min-w-0 flex-1 truncate
          ${
            value
              ? 'text-on-surface'
              : 'text-on-surface-variant/50'
          }
        `}
      >
        {value || placeholder}
      </span>

      <span className="ml-2 flex shrink-0 items-center gap-1.5">
        {allowClear && value && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear selection"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onClear?.()
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' ||
                event.key === ' '
              ) {
                event.preventDefault()
                event.stopPropagation()
                onClear?.()
              }
            }}
            className="
              rounded-lg
              p-1
              text-on-surface-variant/50
              transition-colors

              hover:bg-surface-container
              hover:text-on-surface

              focus-visible:outline-none
              focus-visible:ring-2
              focus-visible:ring-primary
            "
          >
            <CloseIcon />
          </span>
        )}

        {/* Functional dropdown indicator.
            This is intentionally a chevron rather than a
            decorative navigation arrow. */}
        <ChevronIcon open={open} />
      </span>
    </button>
  )
}

/* ============================================================
   DROPDOWN MENU
   ============================================================ */

function DropdownMenu<T>({
  options,
  value,
  search,
  open,
  onSelect,
  onClose,
  searchable = false,
  maxHeight = 320,
  className = '',
  onSearchChange,
}: DropdownMenuProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  /*
   * Close the menu when clicking outside it.
   */
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node

      if (
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        onClose()
      }
    }

    document.addEventListener(
      'mousedown',
      handleClickOutside,
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        handleClickOutside,
      )
    }
  }, [open, onClose])

  /*
   * Automatically focus search when the menu opens.
   */
  useEffect(() => {
    if (!open || !searchable) return

    const timeout = window.setTimeout(() => {
      searchRef.current?.focus()
    }, 0)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [open, searchable])

  /*
   * Escape closes the dropdown while the menu/search
   * has focus.
   */
  useEffect(() => {
    if (!open) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener(
      'keydown',
      handleEscape,
    )

    return () => {
      document.removeEventListener(
        'keydown',
        handleEscape,
      )
    }
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <div
      ref={listRef}
      className={`
        absolute
        left-0
        top-full
        z-50
        mt-2
        min-w-full
        ${className}
      `}
    >
      <div
        className="
          glass-flyout
          w-max
          min-w-[200px]
          overflow-hidden
          rounded-2xl
          border border-glass-strong
          p-1.5
          shadow-e4
        "
        role="listbox"
        aria-label="Options"
      >
        {searchable && (
          <div
            className="
              sticky
              top-0
              z-10
              mb-1.5
              rounded-xl
              border border-glass-subtle
              bg-surface-container/70
              p-2
            "
          >
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(event) => {
                onSearchChange?.(
                  event.target.value,
                )
              }}
              placeholder="Search options…"
              className="
                w-full
                bg-transparent
                text-body-sm
                text-on-surface
                outline-none
                placeholder:text-on-surface-variant/50
              "
              aria-label="Search options"
            />
          </div>
        )}

        <div
          className="overflow-auto"
          style={{
            maxHeight: searchable
              ? Math.max(maxHeight - 58, 120)
              : maxHeight,
          }}
        >
          {options.length === 0 ? (
            <div
              className="
                px-3
                py-3
                text-body-sm
                text-on-surface-variant
              "
            >
              No options found
            </div>
          ) : (
            <ul className="min-w-[180px]">
              {options.map((option) => {
                const selected = Object.is(
                  value,
                  option.value,
                )

                return (
                  <li
                    key={option.label}
                    className="mb-0.5 last:mb-0"
                  >
                    {option.disabled ? (
                      <span
                        className="
                          flex
                          w-full
                          cursor-not-allowed
                          items-center
                          rounded-xl
                          px-3
                          py-2.5
                          text-body-sm
                          text-on-surface-variant/40
                        "
                      >
                        {option.label}
                      </span>
                    ) : (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onSelect(option.value)
                        }}
                        className={`
                          flex
                          w-full
                          items-center
                          gap-3
                          rounded-xl
                          px-3
                          py-2.5
                          text-left
                          text-body-sm
                          transition-all
                          duration-150
                          ease-standard

                          ${
                            selected
                              ? `
                                bg-primary/10
                                font-medium
                                text-primary
                              `
                              : `
                                text-on-surface
                                hover:bg-primary/5
                                hover:text-primary
                              `
                          }
                        `}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>

                        {selected && (
                          <span className="text-primary">
                            <CheckIcon />
                          </span>
                        )}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============================================================
   DROPDOWN
   ============================================================ */

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

  const wrapperRef = useRef<HTMLDivElement>(null)

  /*
   * Find the currently selected option.
   *
   * Object.is is used rather than === so that the comparison
   * behaves correctly for values such as NaN.
   */
  const selectedOption = options.find((option) =>
    Object.is(option.value, value),
  )

  const displayValue =
    selectedOption?.label ?? ''

  /*
   * Search filtering.
   *
   * The actual selected value is never changed by searching.
   * Search only determines which options are displayed.
   */
  const filteredOptions = searchable
    ? options.filter((option) =>
        option.label
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : options

  /*
   * Close dropdown and clear temporary search state.
   */
  const closeDropdown = () => {
    setOpen(false)
    setSearch('')
  }

  /*
   * Open / close dropdown.
   */
  const toggleOpen = () => {
    if (disabled) return

    setOpen((currentOpen) => {
      if (currentOpen) {
        setSearch('')
      }

      return !currentOpen
    })
  }

  /*
   * Keyboard support for the trigger.
   */
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDropdown()
      return
    }

    if (
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault()
      toggleOpen()
    }
  }

  /*
   * Close when clicking anywhere outside the complete
   * dropdown component.
   */
  useEffect(() => {
    if (!open) return

    const handleOutsidePointerDown = (
      event: MouseEvent,
    ) => {
      const target = event.target as Node

      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(target)
      ) {
        closeDropdown()
      }
    }

    document.addEventListener(
      'mousedown',
      handleOutsidePointerDown,
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        handleOutsidePointerDown,
      )
    }
  }, [open])

  /*
   * Reset search when dropdown becomes disabled.
   */
  useEffect(() => {
    if (disabled) {
      setOpen(false)
      setSearch('')
    }
  }, [disabled])

  return (
    <div
      ref={wrapperRef}
      className={`
        relative
        inline-flex
        min-w-0
        ${className}
      `}
    >
      <DropdownTrigger
        value={displayValue}
        placeholder={placeholder}
        disabled={disabled}
        open={open}
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        className={triggerClassName}
        allowClear={
          allowClear &&
          value !== undefined
        }
        onClear={() => {
          onChange(undefined)
          closeDropdown()
        }}
      />

      <DropdownMenu
        options={filteredOptions}
        value={value}
        search={search}
        open={open}
        onSelect={(selectedValue) => {
          onChange(selectedValue)
          closeDropdown()
        }}
        onClose={closeDropdown}
        searchable={searchable}
        maxHeight={maxHeight}
        className={menuClassName}
        onSearchChange={setSearch}
      />
    </div>
  )
}

/* ============================================================
   SELECT ALIAS
   ============================================================ */

export { Dropdown as Select }
