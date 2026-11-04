import { cn } from '#/lib/utils'

export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-busy="true"
      aria-live="polite"
      className={cn(className)}
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
