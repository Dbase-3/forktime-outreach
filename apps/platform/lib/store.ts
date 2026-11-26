"use client";

// Iteration 1 keeps the workspace in this browser (localStorage). Pages read it
// with useApp() and change it with update(); the API replaces this later.
// A newer data version keeps edited work (lib/migrations.ts, a backup is taken
// first); a save that fails is reported (useSaveProblem); another tab's saves
// are picked up live.

import { useSyncExternalStore } from "react";
import { migrateState, repairStuck } from "./migrations";
import { SEED_VERSION, seedState } from "./seed";
import type { AppState } from "@outreach/core/types";

const KEY = "forktime-platform.v1";
const BACKUP_KEY = "forktime-platform.backup";
const listeners = new Set<() => void>();
let state: AppState | null = null;
let serverState: AppState | null = null;
let saveProblem: string | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function parse(raw: string | null): AppState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== SEED_VERSION && parsed.edited) {
      // Keep the untouched original before changing it, in case a migration misses something.
      try {
        window.localStorage.setItem(BACKUP_KEY, raw);
      } catch {
        // No room for a backup: carry on with the migration.
      }
    }
    return migrateState(parsed, SEED_VERSION, () => seedState());
  } catch {
    return null;
  }
}

function load(): AppState {
  if (state) return state;
  if (typeof window === "undefined") return getServerSnapshot();
  state = repairStuck(parse(window.localStorage.getItem(KEY)) ?? seedState());
  return state;
}

function save(next: AppState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    if (saveProblem) {
      saveProblem = null;
      notify();
    }
  } catch (err) {
    const full = err instanceof DOMException && (err.name === "QuotaExceededError" || err.code === 22);
    saveProblem = full
      ? "This browser's storage is full, so your latest changes aren't saved. Remove a large knowledge document, then edit anything to save again."
      : "This browser isn't letting the app save (a private window?). Your changes last until you close the tab.";
    notify();
  }
}

export function update(fn: (current: AppState) => AppState): void {
  state = { ...fn(load()), edited: true };
  save(state);
  notify();
}

/** Back to the sample workspace. */
export function resetWorkspace(): void {
  state = seedState();
  save(state);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab saved: take its version, so neither tab overwrites the other's work.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY || event.newValue === null) return;
    const next = parse(event.newValue);
    if (next) {
      state = next;
      notify();
    }
  });
}

function getServerSnapshot(): AppState {
  serverState ??= seedState(new Date("2026-01-01T00:00:00Z"));
  return serverState;
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, load, getServerSnapshot);
}

/** Why the last save failed, or null when saving works. */
export function useSaveProblem(): string | null {
  return useSyncExternalStore(subscribe, () => saveProblem, () => null);
}

export function nowIso(): string {
  return new Date().toISOString();
}
