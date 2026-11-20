import type { CallJson, DncEntry, Settings, TranscriptLineJson } from "./types";
import type { ImportPreviewEntry } from "./imports";

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

async function formApi<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(path, { method: "POST", body: form, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError((body as { error?: string } | null)?.error || `Request failed (${response.status})`, response.status, body);
  return body as T;
}

const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const scoped = (path: string, workspaceId: string) => `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(workspaceId)}`;

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
export interface WorkspaceJson {
  _id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export const client = {
  login: (email: string, password: string) => post<{ ok: true }>("/api/auth/login", { email, password }),
  logout: () => post<{ ok: true }>("/api/auth/logout"),
  workspaces: () => api<{ workspaces: WorkspaceJson[] }>("/api/workspaces"),
  createWorkspace: (name: string) => post<{ workspace: WorkspaceJson }>("/api/workspaces", { name }),
  queue: (workspaceId: string) => api<QueueSnapshot>(scoped("/api/queue", workspaceId)),
  setQueue: (workspaceId: string, action: "start" | "pause") => post<QueueSnapshot>(scoped("/api/queue", workspaceId), { action }),
  calls: (workspaceId: string) => api<{ calls: CallJson[] }>(scoped("/api/calls", workspaceId)),
  addNumbers: (workspaceId: string, numbers: string) => post<AddResult>(scoped("/api/calls", workspaceId), { numbers }),
  addEntries: (workspaceId: string, entries: Array<{ label: string; phone: string }>) => post<AddResult>(scoped("/api/calls", workspaceId), { entries }),
  parseImport: (workspaceId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return formApi<{ fileName: string; entries: ImportPreviewEntry[] }>(scoped("/api/imports/parse", workspaceId), form);
  },
  call: (workspaceId: string, id: string) => api<{ call: CallJson; transcript: TranscriptLineJson[] }>(scoped(`/api/calls/${id}`, workspaceId)),
  cancelCall: (workspaceId: string, id: string) => post<{ ok: true }>(scoped(`/api/calls/${id}/cancel`, workspaceId)),
  callAgain: (workspaceId: string, id: string, at?: string) => post<{ ok: true; callId: string }>(scoped(`/api/calls/${id}/retry`, workspaceId), at ? { at } : {}),
  settings: (workspaceId: string) => api<SettingsView>(scoped("/api/settings", workspaceId)),
  saveSettings: (workspaceId: string, settings: Settings) => api<SettingsView>(scoped("/api/settings", workspaceId), { method: "PUT", body: JSON.stringify(settings) }),
  carrierNumbers: () => api<{ numbers: CarrierNumber[]; error: string | null }>("/api/telnyx/numbers"),
  voices: () => api<{ voices: VoiceOption[] }>("/api/voices"),
  dnc: (workspaceId: string) => api<{ entries: DncEntryJson[] }>(scoped("/api/dnc", workspaceId)),
  addDnc: (workspaceId: string, phone: string, reason?: string) => post<{ ok: true; phone: string }>(scoped("/api/dnc", workspaceId), { phone, reason }),
  removeDnc: (workspaceId: string, phone: string) => api<{ ok: true }>(scoped("/api/dnc", workspaceId), { method: "DELETE", body: JSON.stringify({ phone }) }),
};
