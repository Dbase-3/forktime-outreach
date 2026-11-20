import { z } from "zod";
import { collections } from "./db";
import { toE164 } from "./phone";
import { DEFAULT_WELCOME, welcomeProblem } from "./opening-line";
import type { QueueState, Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  agentName: "Sara",
  repName: "Adil Khan",
  company: "Forktime",
  topic: "a large booking he'd like to arrange",
  transferNumber: "",
  callbackNumber: "",
  ...DEFAULT_WELCOME,
  voiceProvider: "fishaudio",
  voiceId: "4c2a4dcc3c5e4ed6adaad45299169d2b",
  voiceSpeed: 1.1,
  fromNumber: "",
  timezone: "Australia/Sydney",
  windowStart: "14:00",
  windowEnd: "17:00",
  windowDays: [1, 2, 3, 4, 5],
  enforceWindow: true,
  maxAttempts: 2,
  retryAfterMinutes: 60,
  ringTimeoutSec: 30,
  maxCallMinutes: 5,
  recordCalls: true,
  recordingNotice: true,
  defaultCountry: "AU",
};

const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, like 14:00");

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    // Intl throws on a zone it does not know.
    return false;
  }
}

const settingsShape = z.object({
  agentName: z.string().trim().min(1).max(40),
  repName: z.string().trim().min(1).max(80),
  company: z.string().trim().min(1).max(80),
  topic: z.string().trim().min(3).max(160),
  transferNumber: z.string().trim().max(32),
  callbackNumber: z.string().trim().max(32),
  welcomeOutbound: z.string().trim().min(1, "This message can't be empty.").max(500),
  welcomeCallbackKnown: z.string().trim().min(1, "This message can't be empty.").max(500),
  welcomeCallbackNew: z.string().trim().min(1, "This message can't be empty.").max(500),
  voiceProvider: z.enum(["elevenlabs", "fishaudio"]),
  voiceId: z.string().trim().min(1).max(64),
  voiceSpeed: z.number().min(1, "The slowest is normal speed").max(1.2, "1.2 is the fastest the voice can go"),
  fromNumber: z.string().trim().max(32),
  timezone: z.string().trim().refine(isTimeZone, "Unknown time zone"),
  windowStart: hhmm,
  windowEnd: hhmm,
  windowDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  enforceWindow: z.boolean(),
  maxAttempts: z.number().int().min(1).max(3),
  retryAfterMinutes: z.number().int().min(15).max(24 * 60),
  ringTimeoutSec: z.number().int().min(15).max(60),
  maxCallMinutes: z.number().int().min(1).max(15),
  recordCalls: z.boolean(),
  recordingNotice: z.boolean(),
  defaultCountry: z.string().trim().length(2),
});

export type SettingsError = { field: string; message: string };

/**
 * Check a settings form and put its phone numbers in E.164. A number that
 * can't be read is an error, never saved as typed: the agent dials these.
 */
export function validateSettings(input: unknown): { settings: Settings } | { errors: SettingsError[] } {
  const parsed = settingsShape.safeParse(input);
  if (!parsed.success) {
    return { errors: parsed.error.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })) };
  }
  const settings: Settings = { ...parsed.data, defaultCountry: parsed.data.defaultCountry.toUpperCase() };
  const errors: SettingsError[] = [];
  // A welcome that doesn't say it is an AI is refused here, so a later edit can't remove it by accident.
  for (const key of ["welcomeOutbound", "welcomeCallbackKnown", "welcomeCallbackNew"] as const) {
    const problem = welcomeProblem(settings[key], settings);
    if (problem) errors.push({ field: key, message: problem });
  }
  for (const field of ["transferNumber", "callbackNumber", "fromNumber"] as const) {
    if (!settings[field]) continue;
    const e164 = toE164(settings[field], settings.defaultCountry);
    if (e164) settings[field] = e164;
    else errors.push({ field, message: "This is not a phone number we can dial" });
  }
  const minutes = (value: string) => {
    const [hours, mins] = value.split(":").map(Number);
    return hours * 60 + mins;
  };
  if (minutes(settings.windowStart) >= minutes(settings.windowEnd)) {
    errors.push({ field: "windowEnd", message: "The window must end after it starts" });
  }
  return errors.length ? { errors } : { settings };
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await collections();
  const stored = await settings.findOne({ _id: "app" });
  if (!stored) return { ...DEFAULT_SETTINGS };
  const { _id: _ignored, ...rest } = stored;
  // Settings saved before the voice company was a choice were all ElevenLabs.
  const saved: Partial<Settings> = rest;
  return { ...DEFAULT_SETTINGS, ...rest, voiceProvider: saved.voiceProvider ?? "elevenlabs" };
}

export async function saveSettings(next: Settings): Promise<Settings> {
  const { settings } = await collections();
  await settings.updateOne({ _id: "app" }, { $set: next }, { upsert: true });
  return next;
}

export async function getQueueState(): Promise<QueueState> {
  const { queue } = await collections();
  const stored = await queue.findOne({ _id: "queue" });
  return { running: stored?.running === true };
}

export async function setQueueRunning(running: boolean): Promise<void> {
  const { queue } = await collections();
  await queue.updateOne({ _id: "queue" }, { $set: { running } }, { upsert: true });
}

/** What a real call still needs before the first number is dialled. */
export function missingForCalls(settings: Settings): string[] {
  const missing: string[] = [];
  if (!settings.transferNumber) missing.push("the number to connect an interested owner to");
  if (!settings.callbackNumber) missing.push("the number staff and owners are asked to call back");
  if (!settings.fromNumber) missing.push("the number calls are made from");
  return missing;
}
