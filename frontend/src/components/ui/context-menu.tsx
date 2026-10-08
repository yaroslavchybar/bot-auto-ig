import type { ComponentPropsWithRef } from 'react'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { cn } from '@/lib/utils'

const ContextMenu = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger

function ContextMenuContent({
  className,
  ...props
}: ComponentPropsWithRef<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          'bg-popover text-popover-foreground border-line z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-[8rem] overflow-y-auto rounded-xl border p-1.5 shadow-xl',
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  ...props
}: ComponentPropsWithRef<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        'focus:bg-panel-hover focus:text-ink relative flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem }
