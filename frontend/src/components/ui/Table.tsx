import type { ReactNode } from 'react'

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="data-scroll-region overflow-x-auto rounded-2xl border border-white/[0.1] bg-slate-900/55 shadow-[0_18px_44px_-34px_rgba(0,0,0,0.95)]">
      <table className="w-full whitespace-nowrap text-left text-sm">{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-white/[0.1] bg-white/[0.045] text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
      {children}
    </thead>
  )
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-white/[0.06]">{children}</tbody>
}

export function TR({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <tr onClick={onClick} className={onClick ? 'cursor-pointer transition-colors duration-300 ease-in-out hover:bg-cyan-400/[0.055]' : 'transition-colors duration-300 ease-in-out hover:bg-white/[0.035]'}>
      {children}
    </tr>
  )
}

export function TH({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-4 py-3.5 align-middle ${className}`}>{children}</th>
}

export function TD({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle font-mono text-[13px] text-slate-300 ${className}`}>{children}</td>
}
