import type { ReactNode } from 'react'

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700/50 bg-slate-900/40 shadow-sm backdrop-blur-sm">
      <table className="w-full text-left text-sm whitespace-nowrap">{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-slate-700/50 bg-slate-800/80 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
      {children}
    </thead>
  )
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-700/30">{children}</tbody>
}

export function TR({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <tr onClick={onClick} className={onClick ? 'cursor-pointer hover:bg-slate-800/60 transition-colors' : 'hover:bg-slate-800/40 transition-colors'}>
      {children}
    </tr>
  )
}

export function TH({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-4 py-3 align-middle ${className}`}>{children}</th>
}

export function TD({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-middle text-slate-300 font-mono text-[13px] ${className}`}>{children}</td>
}
