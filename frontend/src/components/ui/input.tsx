'use client'

import type { InputHTMLAttributes } from 'react'
import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-fg-muted">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'h-10 rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-fg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          error ? 'border-danger' : null,
          className,
        )}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  )
})
