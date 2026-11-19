"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, PhoneOutgoing } from "lucide-react";
import clsx from "clsx";
import { client } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Calls" },
  { href: "/settings", label: "Settings" },
];

export function TopBar() {
  const pathname = usePathname();
  const signOut = async () => {
    await client.logout().catch(() => undefined);
    window.location.href = "/login";
  };

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gray-900 text-white">
            <PhoneOutgoing className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold">Forktime Outreach</span>
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "rounded-md px-3 py-1.5 text-sm font-medium",
                pathname === link.href ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:text-gray-900",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <button type="button" onClick={signOut} className="ml-auto flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </header>
  );
}
