import type { ReactNode } from 'react'

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="data-scroll-region overflow-x-auto rounded-2xl border border-outline-variant bg-surface-container/60 shadow-e3">
      <table className="w-full whitespace-nowrap text-body-sm">{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-outline-variant bg-surface-container-low/80 text-label-sm font-semibold text-on-surface-variant">
      {children}
    </thead>
  )
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-outline-variant/50">{children}</tbody>
}

export function TR({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  return (
    <tr
      onClick={onClick}
      className={onClick
        ? 'cursor-pointer transition-colors duration-200 ease-standard hover:bg-primary/5'
        : 'transition-colors duration-200 ease-standard hover:bg-surface-container-low/50'}
    >
      {children}
    </tr>
  )
}

export function TH({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-4 py-3.5 align-middle ${className}`}>{children}</th>
}

export function TD({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle font-mono text-body-sm text-on-surface ${className}`}>{children}</td>
}