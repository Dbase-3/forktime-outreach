"use client";

// The frame around every page: a sidebar on desktop, a top bar plus bottom tabs
// on phones. The four most-used pages sit in the tabs; the rest under "More".

import clsx from "clsx";
import {
  AudioLines, CalendarClock, Home, Megaphone, Monitor, Moon, MoreHorizontal, PhoneCall, Plug, Settings, Sun, Users, Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { Sheet } from "./ui";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  tab: boolean;
}

const NAV_GROUPS: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [
      { href: "/", label: "Home", icon: Home, tab: true },
      { href: "/calls", label: "Calls", icon: PhoneCall, tab: true },
    ],
  },
  {
    title: "Build",
    items: [
      { href: "/flows", label: "Flows", icon: Workflow, tab: true },
      { href: "/automations", label: "Automations", icon: CalendarClock, tab: true },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, tab: false },
    ],
  },
  {
    title: "Manage",
    items: [
      { href: "/contacts", label: "Contacts", icon: Users, tab: false },
      { href: "/integrations", label: "Integrations", icon: Plug, tab: false },
      { href: "/settings", label: "Settings", icon: Settings, tab: false },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);
const TABS = ["/", "/flows", "/automations", "/calls"].map((href) => NAV.find((item) => item.href === href) as NavItem);

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  return (
    <div className="min-h-dvh lg:pl-60">
      <Sidebar />
      <MobileTopBar />
      <main className="mx-auto w-full max-w-[1120px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-14 lg:pt-9">{mounted ? children : <PageSkeleton />}</main>
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
      <div className="h-7 w-40 rounded-md bg-muted" />
      <div className="h-28 rounded-xl bg-subtle" />
      <div className="h-28 rounded-xl bg-subtle" />
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-fg text-background">
        <AudioLines size={14} strokeWidth={2.5} />
      </span>
      <span className="text-sm font-semibold tracking-[-0.01em]">Forktime AI</span>
    </Link>
  );
}

function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-background lg:flex">
      <div className="flex h-14 items-center px-5">
        <Brand />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pt-2">
        {NAV_GROUPS.map((group, i) => (
          <div key={group.title ?? i}>
            {group.title && <div className="eyebrow mb-1.5 px-2.5">{group.title}</div>}
            <div className="space-y-px">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
                      active ? "bg-muted font-medium text-fg" : "text-fg-3 hover:bg-subtle hover:text-fg",
                    )}
                  >
                    <Icon size={16} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-fg" : "text-fg-4"} />
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-3 border-t border-line p-3">
        <ThemeSwitch />
        <WorkspaceCard />
      </div>
    </aside>
  );
}

const THEMES: { value: ThemeChoice; icon: LucideIcon; label: string }[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "system", icon: Monitor, label: "Match device" },
  { value: "dark", icon: Moon, label: "Dark" },
];

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex items-center justify-between px-1">
      <span className="text-xs text-fg-3">Theme</span>
      <div className="inline-flex rounded-md border border-line p-0.5">
        {THEMES.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-label={label}
            title={label}
            className={clsx("flex h-6 w-7 items-center justify-center rounded transition-colors", theme === value ? "bg-muted text-fg" : "text-fg-4 hover:text-fg")}
          >
            <Icon size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceCard() {
  const { settings } = useApp();
  return (
    <Link href="/settings" className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-subtle">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-2xs font-semibold text-fg-2">
        {settings.businessName.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{settings.businessName}</span>
        <span className="block truncate font-mono text-2xs text-fg-3">{settings.phoneNumber}</span>
      </span>
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Number active" />
    </Link>
  );
}

function MobileTopBar() {
  const [theme, setTheme] = useTheme();
  const next: Record<ThemeChoice, ThemeChoice> = { system: "dark", dark: "light", light: "system" };
  const Icon = THEMES.find((t) => t.value === theme)?.icon ?? Monitor;
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-background/80 px-4 backdrop-blur-md lg:hidden">
      <Brand />
      <button type="button" className="btn-icon" onClick={() => setTheme(next[theme])} aria-label="Change theme">
        <Icon size={16} />
      </button>
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
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background/85 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href} className={clsx("flex flex-col items-center gap-1 pb-1.5 pt-2 text-2xs font-medium transition-colors", active ? "text-fg" : "text-fg-4")}>
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)} className={clsx("flex flex-col items-center gap-1 pb-1.5 pt-2 text-2xs font-medium", extraActive ? "text-fg" : "text-fg-4")}>
            <MoreHorizontal size={20} />
            More
          </button>
        </div>
      </nav>
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="card divide-y divide-line overflow-hidden">
          {extras.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={clsx("flex h-12 items-center gap-3 px-4 text-base", isActive(pathname, href) ? "bg-subtle font-medium" : "")}>
              <Icon size={17} className="text-fg-3" />
              {label}
            </Link>
          ))}
        </div>
      </Sheet>
    </>
  );
}
