import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastType } from './toast-context'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'border-emerald-400/40 bg-emerald-950/85 text-emerald-50 shadow-[0_16px_36px_-20px_rgba(16,185,129,0.8)]',
  error: 'border-rose-400/40 bg-rose-950/85 text-rose-50 shadow-[0_16px_36px_-20px_rgba(244,63,94,0.75)]',
  info: 'border-cyan-400/40 bg-slate-900/90 text-slate-50 shadow-[0_16px_36px_-20px_rgba(6,182,212,0.7)]',
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
            className={`glass-flyout animate-slide-up rounded-2xl border px-4 py-3 text-[13px] font-medium leading-relaxed ${TYPE_STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
