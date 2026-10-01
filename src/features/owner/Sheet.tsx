import type { ReactNode } from 'react';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { X } from '@phosphor-icons/react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useVisualViewportHeight } from '@/features/booking/useVisualViewport';

/** Bottom sheet used by the owner cabinet (same shadcn Drawer as the client flow). */
export function Sheet({ open, onClose, title, description, children }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode }) {
  const vvh = useVisualViewportHeight();
  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()} showSwipeHandle>
      <DrawerContent
        className="mx-auto w-full max-w-[640px]"
        style={vvh ? ({ '--drawer-content-max-height': `${Math.max(320, vvh - 24)}px` } as React.CSSProperties) : undefined}
      >
        <DrawerHeader>
          <HStack gap={2} vAlign="center">
            <DrawerTitle className="flex-1 text-xl">{title}</DrawerTitle>
            <IconButton variant="ghost" label="Закрыть" icon={<X size={20} />} onClick={onClose} />
          </HStack>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
