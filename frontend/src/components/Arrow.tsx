type ArrowVariant = 'mapping' | 'binding' | 'inline' | 'subtle'
type ArrowSize = 'sm' | 'md' | 'lg'

interface ArrowProps {
  variant?: ArrowVariant
  size?: ArrowSize
  className?: string
}

export function Arrow({ variant = 'mapping', size = 'md', className = '' }: ArrowProps) {
  const baseStyles = 'inline-flex items-center justify-center font-mono antialiased'
  
  const variantStyles: Record<ArrowVariant, string> = {
    mapping: 'text-primary/70',
    binding: 'text-info/80',
    inline: 'text-on-surface-variant/50',
    subtle: 'text-on-surface-variant/40',
  }

  const sizeStyles: Record<ArrowSize, string> = {
    sm: 'text-mono-xs',
    md: 'text-mono-sm',
    lg: 'text-mono-md',
  }

  return (
    <span
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      aria-hidden="true"
    >
      →
    </span>
  )
}

export function MappingArrow({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center font-mono text-primary/70 text-mono-sm ${className}`} aria-hidden="true">
      →
    </span>
  )
}

export function BindingArrow({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center font-mono text-info/80 text-mono-sm ${className}`} aria-hidden="true">
      →
    </span>
  )
}

export function InlineArrow({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center font-mono text-on-surface-variant/50 text-mono-xs ${className}`} aria-hidden="true">
      →
    </span>
  )
}