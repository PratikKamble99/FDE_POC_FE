import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full border border-rule bg-surface px-3 py-1 text-sm text-ink',
        'placeholder:text-slate/60 disabled:cursor-not-allowed disabled:opacity-50',
        'file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-notary',
        'aria-invalid:border-state-expired',
        className,
      )}
      {...props}
    />
  )
}
