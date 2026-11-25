"use client";

// A crash on any page shows this instead of a blank screen or the dev overlay.

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-base font-semibold">Something went wrong on this page</h1>
      <p className="mt-1 text-sm text-fg-3">Try again. If it keeps happening, reload the page.</p>
      <p className="mt-3 truncate font-mono text-2xs text-fg-4" title={error.message}>{error.message}</p>
      <div className="mt-5 flex justify-center gap-2">
        <button type="button" className="btn-primary" onClick={reset}><RotateCcw size={14} /> Try again</button>
        <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}
