// Phone numbers (owner 2026-11-26): a workspace has numbers; each agent uses
// one, and a number belongs to one agent at a time. Getting another number is
// a search by country, type and area. Iteration 1 offers numbers from the
// fictional ranges set aside for drama and examples, so nothing real is shown;
// the backend will list the carrier's real stock. Pure.

import type { Flow, PhoneNumber } from "./types";

export type NumberKind = PhoneNumber["kind"];

export interface Country {
  code: string;
  label: string;
  kinds: NumberKind[];
  areas: { id: string; label: string }[];
}

export const COUNTRIES: Country[] = [
  { code: "AU", label: "Australia", kinds: ["local", "mobile", "tollfree"], areas: [{ id: "2", label: "Sydney (02)" }, { id: "3", label: "Melbourne (03)" }, { id: "7", label: "Brisbane (07)" }, { id: "8", label: "Perth and Adelaide (08)" }] },
  { code: "NZ", label: "New Zealand", kinds: ["local", "mobile"], areas: [{ id: "9", label: "Auckland (09)" }, { id: "4", label: "Wellington (04)" }, { id: "3", label: "Christchurch (03)" }] },
  { code: "US", label: "United States", kinds: ["local", "tollfree"], areas: [{ id: "415", label: "San Francisco (415)" }, { id: "212", label: "New York (212)" }, { id: "312", label: "Chicago (312)" }, { id: "512", label: "Austin (512)" }] },
  { code: "CA", label: "Canada", kinds: ["local", "tollfree"], areas: [{ id: "416", label: "Toronto (416)" }, { id: "604", label: "Vancouver (604)" }] },
  { code: "GB", label: "United Kingdom", kinds: ["local", "mobile"], areas: [{ id: "20", label: "London (020)" }, { id: "161", label: "Manchester (0161)" }] },
];

export const KIND_LABEL: Record<NumberKind, string> = { local: "Local", mobile: "Mobile", tollfree: "Toll-free" };

export function countryOf(code: string): Country {
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

/** The agent this number belongs to, other than `exceptFlowId`. */
export function numberOwner(flows: Pick<Flow, "id" | "name" | "numberId">[], numberId: string | undefined, exceptFlowId?: string) {
  if (!numberId) return undefined;
  return flows.find((f) => f.numberId === numberId && f.id !== exceptFlowId);
}

/** Numbers no agent uses yet. */
export function freeNumbers(numbers: PhoneNumber[], flows: Pick<Flow, "id" | "name" | "numberId">[], exceptFlowId?: string): PhoneNumber[] {
  return numbers.filter((n) => !numberOwner(flows, n.id, exceptFlowId));
}

function digits(seed: number, count: number): string {
  let x = seed;
  let out = "";
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += String(Math.floor((x / 2147483648) * 10));
  }
  return out;
}

function hash(text: string): number {
  let h = 7;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 2147483647;
  return h;
}

/** One number in a fictional range, as [E.164, how it's written locally]. */
function make(country: string, kind: NumberKind, area: string, seed: number): [string, string] {
  const d = digits(seed, 4);
  const two = d.slice(2);
  if (country === "AU") {
    if (kind === "mobile") return [`+61491570${d.slice(1)}`, `0491 570 ${d.slice(1)}`];
    if (kind === "tollfree") return [`+611800160${d.slice(1)}`, `1800 160 ${d.slice(1)}`];
    return [`+61${area}5550${d}`, `(0${area}) 5550 ${d}`];
  }
  if (country === "NZ") {
    if (kind === "mobile") return [`+64215550${d.slice(1)}`, `021 555 0${d.slice(1)}`];
    return [`+64${area}5550${d.slice(1)}`, `(0${area}) 555 0${d.slice(1)}`];
  }
  if (country === "US" || country === "CA") {
    const code = kind === "tollfree" ? "800" : area;
    return [`+1${code}55501${two}`, `(${code}) 555-01${two}`];
  }
  if (kind === "mobile") return [`+4477009000${two}`, `07700 9000${two}`];
  return area === "20" ? [`+442079460${d.slice(1)}`, `020 7946 0${d.slice(1)}`] : [`+441614960${d.slice(1)}`, `0161 496 0${d.slice(1)}`];
}

export interface Offer {
  e164: string;
  display: string;
  country: string;
  kind: NumberKind;
  area?: string;
}

/** Numbers you could add right now, skipping ones the workspace already has. */
export function availableNumbers(country: string, kind: NumberKind, area: string, taken: string[], count = 5): Offer[] {
  const offers: Offer[] = [];
  const seen = new Set(taken);
  for (let i = 0; offers.length < count && i < 60; i++) {
    const [e164, display] = make(country, kind, area, hash(`${country}${kind}${area}${i}`));
    if (seen.has(e164)) continue;
    seen.add(e164);
    offers.push({ e164, display, country, kind, ...(kind === "local" ? { area } : {}) });
  }
  return offers;
}

const ADJECTIVES = ["Bright", "Calm", "Swift", "Clever", "Sunny", "Steady", "Bold", "Quiet", "Lucky", "Golden", "Nimble", "Gentle"];
const NOUNS = ["Falcon", "Harbor", "Maple", "Comet", "Otter", "River", "Summit", "Willow", "Pebble", "Beacon", "Fox", "Meadow"];

/** A friendly starter name for a new agent, not one already taken. */
export function randomAgentName(taken: string[], rand: () => number = Math.random): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  for (let i = 0; i < 40; i++) {
    const name = `${ADJECTIVES[Math.floor(rand() * ADJECTIVES.length)]} ${NOUNS[Math.floor(rand() * NOUNS.length)]}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `Agent ${taken.length + 1}`;
}
