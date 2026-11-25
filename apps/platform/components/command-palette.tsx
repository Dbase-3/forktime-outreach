"use client";

// ⌘K / Ctrl+K: jump to any page, agent, automation or contact.

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { CalendarClock, CornerDownLeft, FileText, Search, User, Workflow, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useApp } from "@/lib/store";
import { useFocusReturn } from "./ui";

interface Item {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: LucideIcon;
  group: string;
}

export function useCommandPalette(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((o) => !o);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen];
}

export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: { href: string; label: string; icon: LucideIcon }[] }) {
  const app = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const focus = useFocusReturn(open);

  const items = useMemo<Item[]>(
    () => [
      ...pages.map((p) => ({ id: `page-${p.href}`, label: p.label, hint: "Page", href: p.href, icon: p.icon, group: "Go to" })),
      ...app.flows.map((f) => ({ id: f.id, label: f.name, hint: `${f.agent.name} · ${f.status === "live" ? "Live" : "Draft"}`, href: `/flows/${f.id}`, icon: Workflow, group: "Agents" })),
      ...app.automations.map((a) => ({ id: a.id, label: a.name, hint: a.enabled ? "On" : "Off", href: `/automations/${a.id}`, icon: CalendarClock, group: "Automations" })),
      ...app.contacts.map((c) => ({ id: c.id, label: c.name, hint: c.phone, href: `/contacts?open=${c.id}`, icon: User, group: "Contacts" })),
    ],
    [app, pages],
  );
  const q = query.trim().toLowerCase();
  const shown = (q ? items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(q)) : items.filter((i) => i.group !== "Contacts")).slice(0, 12);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    router.push(item.href);
    onClose();
  };
  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === "ArrowDown") setActive((a) => Math.min(shown.length - 1, a + 1));
    if (event.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    if (event.key === "Enter") go(shown[active]);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/30 data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in dark:bg-black/60" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKey}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
          onCloseAutoFocus={focus.onClose}
          className="fixed left-1/2 top-[12vh] z-[60] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-lift outline-none data-[state=open]:animate-pop-in"
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Search size={15} className="text-fg-4" />
            <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents, automations, contacts…" className="h-12 flex-1 bg-transparent text-[16px] outline-none placeholder:text-fg-4 sm:text-sm" />
            <kbd className="kbd">esc</kbd>
          </div>
          <div className="max-h-[52vh] overflow-y-auto p-1.5">
            {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-fg-3">Nothing matches &ldquo;{query}&rdquo;.</p>}
            {shown.map((item, i) => {
              const Icon = item.icon ?? FileText;
              const newGroup = i === 0 || shown[i - 1].group !== item.group;
              return (
                <div key={item.id}>
                  {newGroup && <div className="eyebrow px-2.5 pb-1 pt-2.5">{item.group}</div>}
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className={clsx("flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm", i === active ? "bg-muted text-fg" : "text-fg-2")}
                  >
                    <Icon size={15} className="text-fg-4" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className="truncate text-xs text-fg-4">{item.hint}</span>
                    {i === active && <CornerDownLeft size={13} className="text-fg-4" />}
                  </button>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
