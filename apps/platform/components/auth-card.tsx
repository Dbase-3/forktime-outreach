// The frame for sign-in and first-run screens: centred, brand on top, no sidebar.
import { AudioLines } from "lucide-react";
import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-background px-4 pt-[12vh]">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fg text-background">
            <AudioLines size={15} strokeWidth={2.5} />
          </span>
          <span className="text-base font-semibold tracking-[-0.01em]">Forktime AI</span>
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-3">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
