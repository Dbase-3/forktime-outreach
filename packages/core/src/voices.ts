// The voices a customer can pick. Only what a person cares about is shown:
// name, accent, tone. Which company makes the voice is ours to change.

export interface Voice {
  id: string;
  name: string;
  gender: "female" | "male";
  accent: string;
  tone: string;
}

export const VOICES: Voice[] = [
  { id: "v_ava", name: "Ava", gender: "female", accent: "American", tone: "Warm and upbeat" },
  { id: "v_noah", name: "Noah", gender: "male", accent: "American", tone: "Calm and clear" },
  { id: "v_mia", name: "Mia", gender: "female", accent: "Australian", tone: "Friendly" },
  { id: "v_jack", name: "Jack", gender: "male", accent: "Australian", tone: "Relaxed" },
  { id: "v_olivia", name: "Olivia", gender: "female", accent: "British", tone: "Polished" },
  { id: "v_george", name: "George", gender: "male", accent: "British", tone: "Confident" },
  { id: "v_chloe", name: "Chloe", gender: "female", accent: "Canadian", tone: "Bright" },
  { id: "v_liam", name: "Liam", gender: "male", accent: "Canadian", tone: "Easy-going" },
  { id: "v_priya", name: "Priya", gender: "female", accent: "Indian", tone: "Professional" },
  { id: "v_arjun", name: "Arjun", gender: "male", accent: "Indian", tone: "Friendly" },
];

export const LANGUAGES = ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Hindi", "Arabic", "Mandarin"];

export const PERSONALITIES = [
  { id: "friendly", label: "Friendly", hint: "Warm, casual, puts people at ease" },
  { id: "professional", label: "Professional", hint: "Polite, to the point" },
  { id: "upbeat", label: "Upbeat", hint: "Energetic, positive" },
  { id: "calm", label: "Calm", hint: "Slow, patient, reassuring" },
] as const;

export function voiceById(id: string): Voice {
  return VOICES.find((voice) => voice.id === id) ?? VOICES[0];
}
