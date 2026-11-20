import type { CallJson, DncEntry, Settings, TranscriptLineJson } from "./types";

// The browser's calls to this app's own server routes.

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
    cache: "no-store",
  });
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    window.location.href = "/login";
    throw new ApiError("Not signed in", 401, null);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError((body as { error?: string } | null)?.error || `Request failed (${response.status})`, response.status, body);
  return body as T;
}

const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export type WaitReason = "paused" | "line_busy" | "empty" | "outside_window" | "retry_pending";

export interface QueueSnapshot {
  running: boolean;
  waiting: WaitReason | null;
  activeCallId: string | null;
  queued: number;
  mode: "live" | "dry";
}

export interface SettingsView {
  settings: Settings;
  openingLine: string;
  window: string;
  missing: string[];
}

export interface AddResult {
  added: number;
  invalid: string[];
  duplicates: number;
  onDoNotCallList: number;
}

export interface CarrierNumber {
  phone: string;
  connection: string | null;
  status: string | null;
}

export interface VoiceOption {
  provider: "elevenlabs" | "fishaudio";
  voiceId: string;
  name: string;
  detail: string;
  previewUrl: string | null;
}

export type DncEntryJson = Omit<DncEntry, "addedAt"> & { addedAt: string };

export const client = {
  login: (email: string, password: string) => post<{ ok: true }>("/api/auth/login", { email, password }),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  queue: () => api<QueueSnapshot>("/api/queue"),
  setQueue: (action: "start" | "pause") => post<QueueSnapshot>("/api/queue", { action }),
  calls: () => api<{ calls: CallJson[] }>("/api/calls"),
  addNumbers: (numbers: string) => post<AddResult>("/api/calls", { numbers }),
  call: (id: string) => api<{ call: CallJson; transcript: TranscriptLineJson[] }>(`/api/calls/${id}`),
  cancelCall: (id: string) => post<{ ok: true }>(`/api/calls/${id}/cancel`),
  callAgain: (id: string, at?: string) => post<{ ok: true; callId: string }>(`/api/calls/${id}/retry`, at ? { at } : {}),
  settings: () => api<SettingsView>("/api/settings"),
  saveSettings: (settings: Settings) => api<SettingsView>("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  carrierNumbers: () => api<{ numbers: CarrierNumber[]; error: string | null }>("/api/telnyx/numbers"),
  voices: () => api<{ voices: VoiceOption[] }>("/api/voices"),
  dnc: () => api<{ entries: DncEntryJson[] }>("/api/dnc"),
  addDnc: (phone: string, reason?: string) => post<{ ok: true; phone: string }>("/api/dnc", { phone, reason }),
  removeDnc: (phone: string) => api<{ ok: true }>("/api/dnc", { method: "DELETE", body: JSON.stringify({ phone }) }),
};
