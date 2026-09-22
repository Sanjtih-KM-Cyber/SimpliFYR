import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastType } from './toast-context'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'border-emerald-700 bg-emerald-950/90 text-emerald-100',
  error: 'border-red-800 bg-red-950/90 text-red-100',
  info: 'border-slate-700 bg-slate-900/95 text-slate-100',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId.current++
    setItems((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id))
    }, 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-md border px-4 py-3 text-sm shadow-lg ${TYPE_STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
