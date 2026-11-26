// Lisna's mark (owner 2026-11-27): a looped lowercase ℓ drawn in one continuous
// line, its loop the curve of an ear. The letter itself is listening ("Lisna"
// = listen), and one unbroken stroke is one conversation. One colour
// (currentColor), legible at 16 px. The favicon is app/icon.svg (same path).

export const MARK_PATH = "M14 50 C 26 45, 36 36, 38 23 C 40 10, 25 4, 21 15 C 17 27, 21 45, 30 52 C 36 57, 44 56, 50 50";

export function LisnaMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={MARK_PATH} />
    </svg>
  );
}

/** The mark on its tile, with the wordmark. `size` is the tile's side in px. */
export function LisnaLogo({ size = 24, wordmark = true, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <span className="flex shrink-0 items-center justify-center rounded-[28%] bg-fg text-background" style={{ width: size, height: size }}>
        <LisnaMark size={Math.round(size * 0.68)} />
      </span>
      {wordmark && (
        <span className="font-semibold leading-none tracking-[-0.04em]" style={{ fontSize: Math.round(size * 0.72) }}>
          lisna
        </span>
      )}
    </span>
  );
}
