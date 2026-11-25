"use client";

// Iteration 1 keeps the workspace in this browser (localStorage). Pages read it
// with useApp() and change it with update(); the API replaces this later.

import { useSyncExternalStore } from "react";
import { seedState } from "./seed";
import type { AppState } from "./types";

const KEY = "forktime-platform.v1";
const listeners = new Set<() => void>();
let state: AppState | null = null;
let serverState: AppState | null = null;

function load(): AppState {
  if (state) return state;
  state = readSaved() ?? seedState();
  return state;
}

function readSaved(): AppState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function save(next: AppState): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private windows can refuse storage: the app still works for this visit.
  }
}

export function update(fn: (current: AppState) => AppState): void {
  state = fn(load());
  save(state);
  listeners.forEach((listener) => listener());
}

/** Back to the sample workspace. */
export function resetWorkspace(): void {
  update(() => seedState());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getServerSnapshot(): AppState {
  serverState ??= seedState(new Date("2026-01-01T00:00:00Z"));
  return serverState;
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, load, getServerSnapshot);
}

export function nowIso(): string {
  return new Date().toISOString();
}
