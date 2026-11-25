import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: colors.indigo },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
      boxShadow: {
        soft: "0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)",
        lift: "0 12px 32px -8px rgb(16 24 40 / 0.18)",
      },
      keyframes: {
        "sheet-up": { from: { transform: "translateY(100%)" }, to: { transform: "translateY(0)" } },
        "sheet-left": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        "sheet-up": "sheet-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        "sheet-left": "sheet-left 220ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        fade: "fade 160ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
