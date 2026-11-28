"use client";

// Small shared pieces every page uses. Colours are theme tokens (globals.css),
// so everything here works in light and dark.

import clsx from "clsx";
import { X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-fg-3">{icon}</div>
      <h3 className="text-base font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-fg-3">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-muted text-fg-2",
  green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "bg-amber-500/10 text-amber-800 dark:text-amber-400",
  red: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  brand: "bg-accent/10 text-accent",
  blue: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "gray", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={clsx("chip", TONES[tone])}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/30",
        checked ? "bg-fg" : "bg-line-strong",
      )}
    >
      <span className={clsx("inline-block h-4 w-4 rounded-full bg-background transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (next: T) => void }) {
  return (
    <div className="inline-flex w-full rounded-lg bg-muted p-0.5 sm:w-auto">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            "h-7 flex-1 rounded-md px-3 text-sm font-medium transition sm:flex-none",
            value === option.value ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_rgb(var(--line))]" : "text-fg-3 hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The app's one panel component (Radix Dialog underneath: focus stays inside,
 * Esc and a tap outside close it, focus returns to what opened it).
 * Phones: a bottom sheet with dimmed space above it to tap away.
 * Larger screens: a true side drawer, full height and flush to the right edge.
 */
export function Sheet({ open, onClose, title, children, footer, wide, size, subheader, titleExtra }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  size?: "md" | "lg" | "xl"; // 440 / 560 / 680 px from sm up; `wide` = "lg"
  /** Fixed between the title and the scrolling body: stays put while the body scrolls and survives tab switches (a recording keeps playing). */
  subheader?: ReactNode;
  titleExtra?: ReactNode; // beside the title, e.g. a status badge
}) {
  const focus = useFocusReturn(open);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in dark:bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={focus.onOpen}
          onCloseAutoFocus={focus.onClose}
          className={clsx(
            "fixed z-50 flex flex-col bg-surface outline-none motion-reduce:!animate-none",
            // phone: bottom sheet
            "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl border-t border-line shadow-lift data-[state=closed]:animate-sheet-down data-[state=open]:animate-sheet-up",
            // tablet / desktop: side drawer
            "sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-dvh sm:max-h-none sm:w-full sm:rounded-none sm:border-l sm:border-t-0 sm:shadow-drawer sm:data-[state=closed]:animate-drawer-out sm:data-[state=open]:animate-drawer-in",
            { md: "sm:max-w-[440px]", lg: "sm:max-w-[560px]", xl: "sm:max-w-[680px]" }[size ?? (wide ? "lg" : "md")],
          )}
        >
          <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:h-14 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <Dialog.Title className="truncate text-base font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {titleExtra}
            </div>
            <Dialog.Close className="btn-icon -mr-1.5" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          {subheader && <div className="shrink-0 border-b border-line bg-subtle/60 px-4 pt-4 sm:px-6">{subheader}</div>}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{children}</div>
          {footer && <div className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Focus for panels opened from code (no Radix Trigger): on open, a field that
 * asked for autoFocus keeps it, otherwise the panel itself takes focus (no
 * ring jumping onto ✕); on close, focus goes back to what had it before.
 */
export function useFocusReturn(open: boolean) {
  const before = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== "undefined") before.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  return {
    onOpen: (event: Event) => {
      event.preventDefault();
      const panel = event.currentTarget as HTMLElement;
      if (!panel.contains(document.activeElement)) panel.focus();
    },
    onClose: (event: Event) => {
      event.preventDefault();
      before.current?.focus?.();
    },
  };
}

/** The last non-null value, so a closing drawer keeps showing its content while it slides away. */
export function useLastPresent<T>(value: T | null | undefined): T | null {
  const last = useRef<T | null>(null);
  if (value != null) last.current = value;
  return last.current;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint block">{hint}</span>}
    </label>
  );
}

/** Numbers in one bordered strip with hairline dividers. */
export function StatStrip({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="card grid grid-cols-2 overflow-hidden lg:grid-cols-4">
      {items.map((item, i) => (
        <div key={item.label} className={clsx("p-4 sm:p-5", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line lg:border-t-0", i === 2 && "lg:border-l")}>
          <div className="text-xs text-fg-3">{item.label}</div>
          <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-[-0.03em]">{item.value}</div>
          {item.sub && <div className="mt-0.5 text-xs text-fg-4">{item.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={clsx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-muted text-2xs font-medium text-fg-2", className)}>
      {initials}
    </span>
  );
}

/**
 * A centred dialog for short, focused choices (naming a new agent, getting a
 * number). Bottom-aligned on phones so thumbs reach the buttons. Use Sheet for
 * anything longer or for editing.
 */
export function Modal({ open, onClose, title, description, children, footer }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  const focus = useFocusReturn(open);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in dark:bg-black/60" />
        <Dialog.Content
          onCloseAutoFocus={focus.onClose}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-line bg-surface shadow-lift outline-none data-[state=open]:animate-sheet-up sm:top-0 sm:m-auto sm:h-fit sm:max-h-[80vh] sm:w-[calc(100%-2rem)] sm:max-w-lg sm:rounded-xl sm:data-[state=open]:animate-pop-in"
        >
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-fg-3">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="btn-icon -mr-2 -mt-1 h-8 w-8 focus-visible:ring-0" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="border-t border-line px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-4">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
