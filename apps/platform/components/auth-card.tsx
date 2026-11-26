// The frame for sign-in and first-run screens: the form on the left, a live
// illustration of calls happening on the right (wide screens only).
import { AudioLines } from "lucide-react";
import type { ReactNode } from "react";
import { LivePanel } from "./auth/live-panel";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="flex w-full flex-col px-6 py-8 sm:px-10 lg:w-[480px] lg:shrink-0 lg:border-r lg:border-line xl:w-[540px]">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fg text-background">
            <AudioLines size={15} strokeWidth={2.5} />
          </span>
          <span className="text-base font-semibold tracking-[-0.01em]">Forktime AI</span>
        </div>

        <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-fg-3">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>

        <p className="text-xs text-fg-4">© {new Date().getFullYear()} Forktime AI</p>
      </div>

      <div className="sticky top-0 hidden h-dvh min-w-0 flex-1 lg:block">
        <LivePanel />
      </div>
    </div>
  );
}
