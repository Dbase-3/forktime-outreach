"use client";

// The frame around every page: a sidebar on desktop, a top bar plus bottom tabs
// on phones. The four most-used pages sit in the tabs; the rest sit under "More".

import clsx from "clsx";
import {
  AudioLines, CalendarClock, Home, Megaphone, MoreHorizontal, Phone, PhoneCall, Plug, Settings, Users, Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { Sheet } from "./ui";

const NAV = [
  { href: "/", label: "Home", icon: Home, tab: true },
  { href: "/flows", label: "Flows", icon: Workflow, tab: true },
  { href: "/automations", label: "Automations", icon: CalendarClock, tab: true },
  { href: "/calls", label: "Calls", icon: PhoneCall, tab: true },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, tab: false },
  { href: "/contacts", label: "Contacts", icon: Users, tab: false },
  { href: "/integrations", label: "Integrations", icon: Plug, tab: false },
  { href: "/settings", label: "Settings", icon: Settings, tab: false },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  return (
    <div className="min-h-dvh lg:pl-64">
      <Sidebar />
      <MobileTopBar />
      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-4 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        {mounted ? children : <PageSkeleton />}
      </main>
      <BottomTabs />
    </div>
  );
}

/** The workspace lives in this browser, so pages render after mount (no flash of sample data). */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded-lg bg-zinc-200/70" />
      <div className="h-32 rounded-2xl bg-zinc-200/50" />
      <div className="h-32 rounded-2xl bg-zinc-200/50" />
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
        <AudioLines size={17} strokeWidth={2.4} />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Forktime AI</span>
    </Link>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-zinc-200/80 bg-white px-4 py-5 lg:flex">
      <div className="px-2">
        <Brand />
      </div>
      <nav className="mt-8 flex-1 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition",
              isActive(pathname, href) ? "bg-brand-50 text-brand-700" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
            )}
          >
            <Icon size={18} />
            {label}
          </Link>
        ))}
      </nav>
      <WorkspaceCard />
    </aside>
  );
}

function WorkspaceCard() {
  const { settings } = useApp();
  return (
    <Link href="/settings" className="flex items-center gap-3 rounded-2xl border border-zinc-200/80 p-3 transition hover:bg-zinc-50">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
        <Phone size={16} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{settings.businessName}</span>
        <span className="block truncate text-xs text-zinc-500">{settings.phoneNumber}</span>
      </span>
    </Link>
  );
}

function MobileTopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200/70 bg-zinc-50/85 px-4 backdrop-blur lg:hidden">
      <Brand />
      <Link href="/settings" className="btn-icon" aria-label="Settings">
        <Settings size={18} />
      </Link>
    </header>
  );
}

function BottomTabs() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const extras = NAV.filter((item) => !item.tab);
  const extraActive = extras.some((item) => isActive(pathname, item.href));

  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <>
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200/80 bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {NAV.filter((item) => item.tab).map(({ href, label, icon: Icon }) => (
            <TabLink key={href} href={href} label={label} active={isActive(pathname, href)}>
              <Icon size={21} />
            </TabLink>
          ))}
          <button type="button" onClick={() => setMoreOpen(true)} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", extraActive ? "text-brand-600" : "text-zinc-500")}>
            <MoreHorizontal size={21} />
            More
          </button>
        </div>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="grid grid-cols-2 gap-3">
          {extras.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={clsx("card flex items-center gap-3 p-4 text-sm font-medium", isActive(pathname, href) && "border-brand-200 bg-brand-50 text-brand-700")}>
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </div>
      </Sheet>
    </>
  );
}

function TabLink({ href, label, active, children }: { href: string; label: string; active: boolean; children: ReactNode }) {
  return (
    <Link href={href} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition", active ? "text-brand-600" : "text-zinc-500")}>
      {children}
      {label}
    </Link>
  );
}
