import type { SelectHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, id, className, children, ...props },
  ref,
) {
  const generatedId = useId()
  const selectId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={selectId} className="text-sm font-medium text-fg-muted">
          {label}
        </label>
      ) : null}
      <select
        ref={ref}
        id={selectId}
        className={cn(
          'h-10 rounded-lg border border-border bg-surface px-3 text-sm text-fg',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </div>
  )
})
