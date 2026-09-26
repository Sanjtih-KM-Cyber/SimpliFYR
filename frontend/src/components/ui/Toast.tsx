import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastType } from './toast-context'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'border-success/40 bg-success-container/80 text-on-success-container shadow-[0_16px_36px_-20px_var(--color-success)]',
  error: 'border-error/40 bg-error-container/80 text-on-error-container shadow-[0_16px_36px_-20px_var(--color-error)]',
  info: 'border-info/40 bg-info-container/80 text-on-info-container shadow-[0_16px_36px_-20px_var(--color-info)]',
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
      <div className="fixed bottom-5 right-5 z-[100] flex w-80 flex-col gap-2.5">
        {items.map((t) => (
          <div
            key={t.id}
            className={`glass-medium animate-slide-in-right rounded-2xl border px-4 py-3 text-label-md font-medium leading-relaxed ${TYPE_STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}