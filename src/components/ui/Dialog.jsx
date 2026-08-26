import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

import { cn } from '../../lib/cn.js'

/**
 * Modal built on Radix so focus trapping, escape handling and the aria wiring
 * come for free.
 *
 * On phones it sits at the bottom of the screen within thumb reach and grows
 * from there; on wider screens it centres.
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]" />
        <RadixDialog.Content
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden bg-surface text-fg shadow-xl',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl border-t border-line',
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85dvh] sm:w-[min(32rem,calc(100vw-2rem))]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <RadixDialog.Title className="font-display text-lg font-semibold tracking-tight">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-muted">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-1 -mt-1 rounded-lg p-2 text-muted transition-colors hover:bg-surface-raised hover:text-fg"
            >
              <X size={18} aria-hidden="true" />
            </RadixDialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1">{children}</div>

          {footer ? (
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4 pb-safe sm:pb-4">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
