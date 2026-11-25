"use client";

// A small anchored panel (Radix Popover): column pickers, filter builders, menus.

import * as Pop from "@radix-ui/react-popover";
import clsx from "clsx";
import type { ReactNode } from "react";

export function Popover({ trigger, children, align = "start", className, open, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; className?: string; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <Pop.Root open={open} onOpenChange={onOpenChange}>
      <Pop.Trigger asChild>{trigger}</Pop.Trigger>
      <Pop.Portal>
        <Pop.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={clsx("z-50 max-h-[var(--radix-popover-content-available-height)] overflow-auto rounded-xl border border-line bg-surface p-3 shadow-pop outline-none data-[state=open]:animate-pop-in", className)}
        >
          {children}
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}
