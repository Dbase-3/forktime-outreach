import { env } from "./env";

// Read-only lookups for the two pickers in Settings: the carrier account's
// phone numbers (which one calls are made from) and the voices on offer.

export interface CarrierNumber {
  phone: string;
  /** What the carrier calls the line it is attached to, when it says. */
  connection: string | null;
  status: string | null;
}

export interface VoiceOption {
  voiceId: string;
  name: string;
  detail: string;
  previewUrl: string | null;
}

/** The voices the phone agent already uses, by what they sound like. */
export const HOUSE_VOICES: VoiceOption[] = [
  { voiceId: "kdnRe2koJdOK4Ovxn2DI", name: "American woman, conversational", detail: "House voice", previewUrl: null },
  { voiceId: "g6xIsTj2HwM6VR4iXFCw", name: "American woman, chatty", detail: "House voice", previewUrl: null },
  { voiceId: "OYTbf65OHHFELVut7v2H", name: "American woman, calm", detail: "House voice", previewUrl: null },
  { voiceId: "kIfcKu9kr8RZrbz7H3ox", name: "American man, friendly", detail: "House voice", previewUrl: null },
  { voiceId: "w9rPM8AIZle60Nbpw7nl", name: "Australian woman, calm", detail: "House voice", previewUrl: null },
  { voiceId: "M7ya1YbaeFaPXljg9BpK", name: "Australian woman, upbeat", detail: "House voice", previewUrl: null },
  { voiceId: "DYkrAHD8iwork3YSUBbs", name: "Australian man, casual", detail: "House voice", previewUrl: null },
  { voiceId: "v7AjIzCg6vdhCmXwBrb1", name: "Australian man, articulate", detail: "House voice", previewUrl: null },
  { voiceId: "TgnhEILA8UwUqIMi20rp", name: "Canadian woman, upbeat", detail: "House voice", previewUrl: null },
];

type Cached<T> = { at: number; value: T };
const TTL_MS = 60_000;
const memo: { numbers?: Cached<CarrierNumber[]>; voices?: Cached<VoiceOption[]> } = {};

/** Every number on the Telnyx account, or a reason they can't be listed. */
export async function listCarrierNumbers(now = Date.now()): Promise<{ numbers: CarrierNumber[]; error: string | null }> {
  const apiKey = env.telnyxApiKey();
  if (!apiKey) return { numbers: [], error: "TELNYX_API_KEY is not set, so the account's numbers can't be listed. Type the number instead." };
  if (memo.numbers && now - memo.numbers.at < TTL_MS) return { numbers: memo.numbers.value, error: null };

  const numbers: CarrierNumber[] = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const response = await fetch(`https://api.telnyx.com/v2/phone_numbers?page[size]=250&page[number]=${page}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      });
      if (!response.ok) return { numbers: [], error: `Telnyx answered ${response.status} when asked for the account's numbers.` };
      const body = (await response.json()) as {
        data?: Array<{ phone_number?: string; connection_name?: string | null; status?: string | null }>;
        meta?: { total_pages?: number };
      };
      for (const row of body.data ?? []) {
        if (row.phone_number) numbers.push({ phone: row.phone_number, connection: row.connection_name ?? null, status: row.status ?? null });
      }
      if (page >= (body.meta?.total_pages ?? 1)) break;
    }
  } catch (err) {
    return { numbers: [], error: `Telnyx could not be reached: ${(err as Error).message}` };
  }
  numbers.sort((a, b) => a.phone.localeCompare(b.phone));
  memo.numbers = { at: now, value: numbers };
  return { numbers, error: null };
}

/** The house voices, then the ElevenLabs account's own (with a sample to hear) when a key is set. */
export async function listVoices(now = Date.now()): Promise<VoiceOption[]> {
  const apiKey = env.elevenLabsApiKey();
  if (!apiKey) return HOUSE_VOICES;
  if (memo.voices && now - memo.voices.at < TTL_MS) return memo.voices.value;
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey }, cache: "no-store" });
    if (!response.ok) return HOUSE_VOICES;
    const body = (await response.json()) as {
      voices?: Array<{ voice_id: string; name: string; preview_url?: string | null; labels?: Record<string, string> }>;
    };
    const account = new Map((body.voices ?? []).map((v) => [v.voice_id, v]));
    const house = HOUSE_VOICES.map((voice) => ({ ...voice, previewUrl: account.get(voice.voiceId)?.preview_url ?? null }));
    const houseIds = new Set(HOUSE_VOICES.map((v) => v.voiceId));
    const others = (body.voices ?? [])
      .filter((v) => !houseIds.has(v.voice_id))
      .map((v) => ({
        voiceId: v.voice_id,
        name: v.name,
        detail: [v.labels?.accent, v.labels?.gender, v.labels?.description].filter(Boolean).join(", ") || "ElevenLabs",
        previewUrl: v.preview_url ?? null,
      }));
    const voices = [...house, ...others];
    memo.voices = { at: now, value: voices };
    return voices;
  } catch {
    // ElevenLabs unreachable: the house list still lets a voice be picked.
    return HOUSE_VOICES;
  }
}
