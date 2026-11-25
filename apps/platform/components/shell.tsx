"use client";

// The frame around every page. Desktop: sidebar and a breadcrumb bar. Phones: top bar plus bottom tabs.
// ⌘K search works everywhere.

import clsx from "clsx";
import {
  AudioLines, BookOpen, Home, Megaphone, Monitor, Moon, MoreHorizontal, PhoneCall, Plug, Search, Settings, Sun, Users, Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "@/lib/store";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import type { AppState } from "@/lib/types";
import { CommandPalette, useCommandPalette } from "./command-palette";
import { SkeletonFor } from "./skeleton";
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
      { href: "/agents", label: "Agents", icon: Workflow, tab: true },
      { href: "/campaigns", label: "Campaigns", icon: Megaphone, tab: true },
      { href: "/knowledge", label: "Knowledge", icon: BookOpen, tab: false },
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
const TABS = ["/", "/agents", "/campaigns", "/calls"].map((href) => NAV.find((item) => item.href === href) as NavItem);

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useCommandPalette();
  // The agent editor is a full-screen workspace (split screen), not a page.
  const fullBleed = /^\/agents\/[^/]+/.test(pathname);
  return (
    <div className="min-h-dvh lg:pl-60">
      <Sidebar onSearch={() => setSearchOpen(true)} />
      <MobileTopBar onSearch={() => setSearchOpen(true)} />
      {mounted && <Breadcrumbs />}
      <main className={fullBleed ? "w-full" : "mx-auto w-full max-w-[1180px] px-4 pb-28 pt-5 sm:px-6 lg:px-10 lg:pb-14 lg:pt-8"}>{mounted ? children : <SkeletonFor pathname={pathname} />}</main>
      <BottomTabs />
      {mounted && <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} pages={NAV} />}
    </div>
  );
}

/** The workspace lives in this browser, so pages render after mount; until then each page shows its skeleton. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
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

// ---- Desktop sidebar ----

function Sidebar({ onSearch }: { onSearch: () => void }) {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-background lg:flex">
      <div className="flex h-12 items-center border-b border-line px-4">
        <Brand />
      </div>
      <div className="px-3 pt-3">
        <button type="button" onClick={onSearch} className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-sm text-fg-4 transition-colors hover:border-line-strong hover:text-fg-3">
          <Search size={14} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pt-4">
        {NAV_GROUPS.map((group, i) => (
          <div key={group.title ?? i}>
            {group.title && <div className="eyebrow mb-1.5 px-2.5">{group.title}</div>}
            <div className="space-y-px">
              {group.items.map((item) => (
                <div key={item.href}>
                  <NavLink item={item} active={isActive(pathname, item.href)} exact={pathname === item.href} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-2 border-t border-line p-3">
        <ThemeSwitch />
        <WorkspaceCard />
      </div>
    </aside>
  );
}

function NavLink({ item, active, exact }: { item: NavItem; active: boolean; exact: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={clsx(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
        active && exact ? "bg-muted font-medium text-fg" : active ? "font-medium text-fg hover:bg-subtle" : "text-fg-3 hover:bg-subtle hover:text-fg",
      )}
    >
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} className={active ? "text-fg" : "text-fg-4"} />
      {item.label}
    </Link>
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

// ---- Breadcrumb bar (desktop) ----

const SECTION_LABELS: Record<string, string> = Object.fromEntries(NAV.map((n) => [n.href.slice(1), n.label]));

export function crumbsFor(pathname: string, app: Pick<AppState, "flows" | "campaigns" | "settings">): { label: string; href?: string }[] {
  const [section, id] = pathname.split("/").filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [{ label: app.settings.businessName, href: "/" }];
  if (!section) return [...crumbs, { label: "Overview" }];
  crumbs.push({ label: SECTION_LABELS[section] ?? section, href: id ? `/${section}` : undefined });
  if (!id) return crumbs;
  const name = section === "agents" ? app.flows.find((f) => f.id === id)?.name : section === "campaigns" ? app.campaigns.find((c) => c.id === id)?.name : undefined;
  return [...crumbs, { label: name ?? "Not found" }];
}

function Breadcrumbs() {
  const app = useApp();
  const pathname = usePathname();
  const crumbs = crumbsFor(pathname, app);
  const live = app.calls.filter((c) => c.live).length;
  return (
    <div className="sticky top-0 z-20 hidden h-12 items-center justify-between border-b border-line bg-background/80 px-10 backdrop-blur-md lg:flex">
      <nav className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-fg-4">/</span>}
            {crumb.href && i < crumbs.length - 1 ? (
              <Link href={crumb.href} className="truncate text-fg-3 transition-colors hover:text-fg">{crumb.label}</Link>
            ) : (
              <span className="truncate font-medium text-fg">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-4">
        <span className="metric-label">Current status</span>
        <span className="flex items-center gap-1.5 font-mono text-2xs font-medium uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-500" />
          {live > 0 ? `${live} on a call` : "Ready"}
        </span>
      </div>
    </div>
  );
}

// ---- Phones ----

function MobileTopBar({ onSearch }: { onSearch: () => void }) {
  const [theme, setTheme] = useTheme();
  const next: Record<ThemeChoice, ThemeChoice> = { system: "dark", dark: "light", light: "system" };
  const Icon = THEMES.find((t) => t.value === theme)?.icon ?? Monitor;
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-background/80 px-4 backdrop-blur-md lg:hidden">
      <Brand />
      <div className="flex items-center">
        <button type="button" className="btn-icon" onClick={onSearch} aria-label="Search">
          <Search size={16} />
        </button>
        <button type="button" className="btn-icon" onClick={() => setTheme(next[theme])} aria-label="Change theme">
          <Icon size={16} />
        </button>
      </div>
    </header>
  );
}

function BottomTabs() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const extras = NAV.filter((item) => !item.tab);
  const extraActive = extras.some((item) => isActive(pathname, item.href));

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

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
