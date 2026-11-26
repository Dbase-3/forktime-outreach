// The frame for sign-in and first-run screens (LiveKit-style, owner 2026-11-27):
// on the left, everything centred under the logo and a hairline; on the right
// (wide screens only), a live illustration of calls happening.
import { AudioLines } from "lucide-react";
import type { ReactNode } from "react";
import { LivePanel } from "./auth/live-panel";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="flex w-full flex-col items-center px-6 py-10 sm:px-10 lg:w-[480px] lg:shrink-0 lg:border-r lg:border-line xl:w-[540px]">
        <div className="flex w-full flex-1 flex-col items-center justify-center">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-fg text-background">
              <AudioLines size={21} strokeWidth={2.5} />
            </span>
            <span className="text-xl font-semibold tracking-[-0.02em]">Forktime AI</span>
          </div>
          <div className="my-9 h-px w-full max-w-[360px] bg-gradient-to-r from-transparent via-line-strong to-transparent" aria-hidden />

          <div className="w-full max-w-[360px]">
            <h1 className="text-center text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
            {subtitle && <p className="mt-2 text-center text-sm text-fg-3">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-center text-xs leading-relaxed text-fg-3">{footer}</div>}
          </div>
        </div>
        <p className="mt-10 text-xs text-fg-4">© {new Date().getFullYear()} Forktime AI</p>
      </div>

      <div className="sticky top-0 hidden h-dvh min-w-0 flex-1 lg:block">
        <LivePanel />
      </div>
    </div>
  );
}
