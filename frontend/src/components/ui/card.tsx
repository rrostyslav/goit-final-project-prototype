import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type CardProps = HTMLAttributes<HTMLDivElement>

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface p-6 shadow-lg shadow-black/20',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
