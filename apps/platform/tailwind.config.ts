import type { Config } from "tailwindcss";

// Colours are theme tokens (app/globals.css), so every class works in light and dark.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: token("background"), // the page
        surface: token("surface"), // cards, panels
        subtle: token("subtle"), // hover rows, quiet fills
        muted: token("muted"), // chips, segmented tracks
        line: token("line"), // hairline borders
        "line-strong": token("line-strong"),
        fg: token("fg"), // main text, primary buttons
        "fg-2": token("fg-2"), // secondary text
        "fg-3": token("fg-3"), // muted text
        "fg-4": token("fg-4"), // faint text, icons
        accent: token("accent"), // selection, focus, live state only
        "series-1": token("series-1"), // charts only
        "series-2": token("series-2"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Readable floor: body 14 px, nothing below 11 px (upper-case labels only).
        "2xs": ["11px", "16px"],
        xs: ["12px", "17px"],
        sm: ["14px", "20px"],
        base: ["15px", "24px"],
      },
      boxShadow: {
        lift: "0 16px 48px -12px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(var(--line))",
        pop: "0 8px 24px -8px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(var(--line))",
      },
      keyframes: {
        "sheet-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "sheet-left": { from: { transform: "translateX(24px)", opacity: "0" }, to: { transform: "translateX(0)", opacity: "1" } },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        "sheet-up": "sheet-up 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        "sheet-left": "sheet-left 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        fade: "fade 150ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
