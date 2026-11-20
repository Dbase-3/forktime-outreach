import { z } from "zod";
import { toE164 } from "./phone";

const extractedSchema = z.object({
  entries: z.array(
    z.object({
      label: z.string().trim().max(160),
      phone: z.string().trim().max(80),
    }),
  ).max(500),
});

export type ImportPreviewEntry = {
  label: string;
  phone: string;
  valid: boolean;
  problem: string | null;
};

type XaiFile = { id: string };
type XaiResponse = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

const extractionPrompt = [
  "Extract restaurant or venue contact rows from the attached file.",
  "Return only the JSON object requested. Every entry needs the restaurant or venue name as label and its phone number as phone.",
  "Do not invent names or numbers. Ignore headings, personal contacts, duplicates, and rows with no phone number.",
  "Keep phone numbers exactly as shown, including any country code.",
].join(" ");

function outputText(response: XaiResponse): string {
  const text = response.output
    ?.flatMap((message) => message.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Grok did not return any contacts from this file.");
  // Models normally respect the JSON instruction. This also handles a harmless
  // markdown code fence without accepting surrounding explanatory prose.
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return json;
}

/** Convert Grok's raw extraction into rows that an operator can review. */
export function reviewImportEntries(raw: Array<{ label: string; phone: string }>, country: string): ImportPreviewEntry[] {
  const seen = new Set<string>();
  return raw.map((entry) => {
    const phone = toE164(entry.phone, country);
    const label = entry.label.trim();
    if (!phone) return { label, phone: entry.phone.trim(), valid: false, problem: "Could not read this phone number" };
    if (seen.has(phone)) return { label, phone, valid: false, problem: "Duplicate number in this file" };
    seen.add(phone);
    return { label, phone, valid: true, problem: null };
  });
}

/** Upload a private file, ask Grok for structured contacts, then discard it. */
export async function extractImportWithGrok(file: File, apiKey: string, country: string): Promise<ImportPreviewEntry[]> {
  if (!apiKey) throw new Error("XAI_API_KEY is not configured for this deployment.");

  const form = new FormData();
  // xAI requires this field to come before the file; it also guarantees the
  // source disappears if a network failure prevents the final delete.
  form.append("expires_after", "3600");
  form.append("purpose", "assistants");
  form.append("file", file, file.name || "restaurant-list");

  const upload = await fetch("https://api.x.ai/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const uploaded = (await upload.json().catch(() => null)) as XaiFile | { error?: { message?: string } } | null;
  if (!upload.ok || !uploaded || !("id" in uploaded)) {
    throw new Error((uploaded && "error" in uploaded && uploaded.error?.message) || "Grok could not accept this file.");
  }

  try {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4.7",
        store: false,
        input: [{ role: "user", content: [{ type: "input_text", text: extractionPrompt }, { type: "input_file", file_id: uploaded.id }] }],
        text: { format: { type: "json_object" } },
      }),
    });
    const data = (await response.json().catch(() => null)) as XaiResponse | { error?: { message?: string } } | null;
    if (!response.ok || !data || !("output" in data)) {
      throw new Error((data && "error" in data && data.error?.message) || "Grok could not read this file.");
    }
    const parsed = extractedSchema.safeParse(JSON.parse(outputText(data)));
    if (!parsed.success) throw new Error("Grok returned contacts in an unexpected format. Please try the file again.");
    return reviewImportEntries(parsed.data.entries, country);
  } finally {
    // Do not retain customer files after this one-off extraction.
    await fetch(`https://api.x.ai/v1/files/${uploaded.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }).catch(() => undefined);
  }
}
