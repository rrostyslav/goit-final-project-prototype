'use client'

import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import { useI18n } from '@/lib/i18n'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const { t } = useI18n()

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      {/* Click-outside-to-close target. A real <button>, not a div+onClick,
          so it is natively keyboard-operable without any extra a11y wiring;
          it is excluded from the tab order (Escape, handled above, plus the
          visible labelled close button below, are the actual keyboard path
          -- this is purely a mouse convenience layered behind the dialog). */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          // `relative` is load-bearing, not decorative: the backdrop button
          // above is `position: absolute`, so without this the dialog (a
          // plain static-positioned box) paints *underneath* it per normal
          // CSS stacking rules (positioned elements stack above static ones
          // regardless of DOM order) -- silently swallowing every click
          // meant for the dialog's own content, including its own close
          // button. `relative` gives the dialog a position too, so within
          // the shared z-index:auto stacking context the two fall back to
          // DOM order, where the dialog (the later sibling) wins.
          'relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl',
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          {title ? <h2 className="text-lg font-semibold text-fg">{title}</h2> : <span />}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4 4L14 14M14 4L4 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
