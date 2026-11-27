// Twenty (open-source CRM), cloud or self-hosted, with an API key. Twenty has
// no fixed API reference (each workspace's REST API is generated from its
// schema), so this uses only the standard objects, as defined in Twenty's
// source (packages/twenty-server/src/modules/{person,note}/standard-objects,
// checked 2026-11-28): people (name {firstName,lastName}, emails {primaryEmail},
// phones {primaryPhoneNumber, primaryPhoneCountryCode, primaryPhoneCallingCode}),
// notes (title, bodyV2 {markdown}) and noteTargets (noteId, targetPersonId;
// `personId` on older servers). Responses are { data: { createPerson | people } },
// filters `field[eq]:'value'` (Twenty's REST integration tests).

import { phoneParts } from "@outreach/core/phone";
import { type ContactInfo, type CrmClient, ProviderError, providerFetch } from "./providers";

type Envelope = { data?: Record<string, unknown>; messages?: string[]; error?: string; message?: string };
const said = (json: unknown) => {
  const j = json as Envelope | null;
  if (!j || j.data) return undefined;
  if (Array.isArray(j.messages) && j.messages.length) return j.messages.join("; ");
  return j.error || j.message ? String(j.message || j.error) : undefined;
};
const quote = (v: string) => `'${v.replace(/'/g, "")}'`;

export class Twenty implements CrmClient {
  constructor(
    private readonly apiKey: string,
    private readonly base: string,
    private readonly guarded: boolean,
  ) {}

  private request(method: "GET" | "POST", path: string, body?: unknown): Promise<Envelope> {
    return providerFetch<Envelope>("Twenty", `${this.base.replace(/\/$/, "")}/rest${path}`, { method, headers: { Authorization: `Bearer ${this.apiKey}` }, body, guarded: this.guarded }, said);
  }

  /** The id of the record a create returned ({ data: { createX: { id } } }). */
  private static created(env: Envelope): string {
    const rec = Object.values(env.data ?? {})[0] as { id?: string } | undefined;
    if (!rec?.id) throw new ProviderError("Twenty didn't return the new record.", 502);
    return rec.id;
  }

  /** Proves the key works (lists one person). */
  async check(): Promise<void> {
    await this.request("GET", "/people?limit=1&fields=id");
  }

  private async findPerson(filter: string): Promise<string | null> {
    try {
      const env = await this.request("GET", `/people?limit=1&fields=id&filter=${encodeURIComponent(filter)}`);
      const people = (env.data?.people ?? []) as { id: string }[];
      return people[0]?.id ?? null;
    } catch {
      return null; // a server that filters differently: create instead
    }
  }

  async upsertContact(c: ContactInfo): Promise<string> {
    const parts = c.phone ? phoneParts(c.phone) : null;
    const existing = (c.email && (await this.findPerson(`emails.primaryEmail[eq]:${quote(c.email)}`))) || (parts && (await this.findPerson(`phones.primaryPhoneNumber[eq]:${quote(parts.national)}`))) || null;
    if (existing) return existing;
    const [firstName = "", ...rest] = (c.name ?? "").trim().split(/\s+/);
    return Twenty.created(
      await this.request("POST", "/people", {
        name: { firstName: firstName || (c.phone ?? c.email ?? "Caller"), lastName: rest.join(" ") },
        ...(c.email ? { emails: { primaryEmail: c.email } } : {}),
        ...(parts ? { phones: { primaryPhoneNumber: parts.national, primaryPhoneCountryCode: parts.country, primaryPhoneCallingCode: parts.callingCode } } : {}),
      }),
    );
  }

  /** A page of people (GET /rest/people, cursor paging with starting_after). */
  async listContacts(after: string | null): Promise<{ contacts: (ContactInfo & { id: string })[]; next: string | null }> {
    const q = new URLSearchParams({ limit: "60", ...(after ? { starting_after: after } : {}) });
    const env = (await this.request("GET", `/people?${q}`)) as Envelope & { pageInfo?: { hasNextPage?: boolean; endCursor?: string } };
    type Person = { id: string; name?: { firstName?: string; lastName?: string }; emails?: { primaryEmail?: string }; phones?: { primaryPhoneNumber?: string; primaryPhoneCallingCode?: string } };
    const people = (env.data?.people ?? []) as Person[];
    const contacts = people.map((p) => {
      const n = p.phones?.primaryPhoneNumber?.replace(/[^\d+]/g, "") ?? "";
      const calling = p.phones?.primaryPhoneCallingCode?.replace(/[^\d+]/g, "") ?? "";
      return { id: p.id, name: [p.name?.firstName, p.name?.lastName].filter(Boolean).join(" ").trim() || undefined, phone: n ? (n.startsWith("+") ? n : `${calling.startsWith("+") ? calling : calling ? `+${calling}` : ""}${n}`) : undefined, email: p.emails?.primaryEmail || undefined };
    });
    return { contacts, next: env.pageInfo?.hasNextPage && env.pageInfo.endCursor ? env.pageInfo.endCursor : null };
  }

  async addNote(personId: string, title: string, body: string): Promise<void> {
    const noteId = Twenty.created(await this.request("POST", "/notes", { title: title.slice(0, 200), bodyV2: { markdown: body.slice(0, 5000) } }));
    try {
      await this.request("POST", "/noteTargets", { noteId, targetPersonId: personId });
    } catch (err) {
      // Older Twenty servers name the link `personId`.
      if (err instanceof ProviderError && err.status === 400) await this.request("POST", "/noteTargets", { noteId, personId });
      else throw err;
    }
  }
}
