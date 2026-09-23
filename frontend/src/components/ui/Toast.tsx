import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastType } from './toast-context'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

const TYPE_STYLES: Record<ToastType, string> = {
  success: 'border-emerald-500/50 bg-emerald-950/80 text-emerald-100 tactical-glow shadow-emerald-500/10',
  error: 'border-rose-500/50 bg-rose-950/80 text-rose-100 shadow-rose-500/10',
  info: 'border-cyan-500/50 bg-slate-900/90 text-slate-100 shadow-[0_0_15px_rgba(6,182,212,0.1)]',
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
      <div className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-md border px-4 py-3 text-[13px] font-medium backdrop-blur-md animate-slide-up ${TYPE_STYLES[t.type]}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
