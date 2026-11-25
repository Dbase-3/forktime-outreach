"use client";

// Light / dark / follow the device. The choice is a per-browser convenience.

import { useCallback, useEffect, useState } from "react";
import { THEME_KEY as KEY } from "./theme-script";

export type ThemeChoice = "system" | "light" | "dark";

function readChoice(): ThemeChoice {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(readChoice());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => readChoice() === "system" && apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    apply(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Storage refused (private window): the theme still applies for this visit.
    }
  }, []);

  return [choice, set];
}
