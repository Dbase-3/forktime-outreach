import type { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { groupHolds } from "@outreach/core/conditions";
import { OPS_FOR } from "@outreach/core/conditions";
import type { Condition, ConditionGroup, FieldType } from "@outreach/core/types";
import { Types, type Model } from "mongoose";
import { startApp, withWorkspace } from "./helpers";

let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => ({ app, stop } = await startApp()));
afterAll(() => stop());

describe("contacts", () => {
  it("one contact per number however it's written; deleting frees it", async () => {
    const { agent, ws } = await withWorkspace(app, "c1@example.com");
    const a = (await agent.post(`${ws}/contacts`).send({ name: "Mia Smith", phone: "0412 555 019", groups: ["Buyers"], fields: {} }).expect(201)).body;
    expect(a.phoneE164).toBe("+61412555019");
    await agent.post(`${ws}/contacts`).send({ name: "Dup", phone: "+61 412 555 019", groups: [], fields: {} }).expect(409);
    await agent.delete(`${ws}/contacts/${a.id}`).expect(200);
    await agent.post(`${ws}/contacts`).send({ name: "Mia again", phone: "+61412555019", groups: [], fields: {} }).expect(201);
  });

  it("stores field values typed and gives them back as text", async () => {
    const { agent, ws } = await withWorkspace(app, "c2@example.com");
    await agent.post(`${ws}/fields`).send({ key: "km", label: "Kilometres", type: "number" });
    await agent.post(`${ws}/fields`).send({ key: "bought", label: "Bought", type: "date" });
    await agent.post(`${ws}/fields`).send({ key: "plan", label: "Service plan", type: "yesno" });
    const c = (await agent.post(`${ws}/contacts`).send({ name: "A", phone: "0412555030", groups: [], fields: { km: "12,400", bought: "03/04/2026", plan: "yes" } })).body;
    expect(c.fields).toEqual({ km: "12400", bought: "2026-04-03", plan: "Yes" });
    const res = (await agent.post(`${ws}/contacts/query`).send({ filter: { match: "all", rules: [{ field: "km", op: "more_than", value: "10000" }, { field: "plan", op: "is_yes" }] } }).expect(201)).body;
    expect(res.total).toBe(1);
  });

  it("pages, searches and sorts with blanks last", async () => {
    const { agent, ws } = await withWorkspace(app, "c3@example.com");
    await agent.post(`${ws}/fields`).send({ key: "km", label: "Kilometres", type: "number" });
    for (const [name, km] of [["Zoe", "900"], ["amy", "90000"], ["Bob", ""], ["Cara", "9000"]]) {
      await agent.post(`${ws}/contacts`).send({ name, phone: `04125550${40 + name.length}${name.charCodeAt(0) % 10}`, groups: [], fields: km ? { km } : {} });
    }
    const asc = (await agent.post(`${ws}/contacts/query`).send({ sort: { key: "km", dir: "asc" } })).body.rows.map((r: { name: string }) => r.name);
    expect(asc).toEqual(["Zoe", "Cara", "amy", "Bob"]);
    const desc = (await agent.post(`${ws}/contacts/query`).send({ sort: { key: "km", dir: "desc" } })).body.rows.map((r: { name: string }) => r.name);
    expect(desc).toEqual(["amy", "Cara", "Zoe", "Bob"]);
    const byName = (await agent.post(`${ws}/contacts/query`).send({ sort: { key: "name", dir: "asc" } })).body.rows.map((r: { name: string }) => r.name);
    expect(byName).toEqual(["amy", "Bob", "Cara", "Zoe"]); // case doesn't change the order
    const page2 = (await agent.post(`${ws}/contacts/query`).send({ sort: { key: "km", dir: "asc" }, page: 2, pageSize: 3 })).body;
    expect(page2.rows.map((r: { name: string }) => r.name)).toEqual(["Bob"]);
    expect(page2.pages).toBe(2);
    expect((await agent.post(`${ws}/contacts/query`).send({ search: "car" })).body.total).toBe(1);
  });

  it("bulk: add to a list for everyone matching a filter, then export them", async () => {
    const { agent, ws } = await withWorkspace(app, "c4@example.com", { sample: true });
    const filter = { match: "all", rules: [{ field: "tier", op: "is", value: "Gold" }] };
    const total = (await agent.post(`${ws}/contacts/query`).send({ filter })).body.total;
    const out = (await agent.post(`${ws}/contacts/bulk`).send({ action: "add_list", list: "VIP", target: { query: { search: "", list: null, filter } } }).expect(201)).body;
    expect(out.changed).toBe(total);
    expect((await agent.get(`${ws}/contacts/lists`)).body).toContain("VIP");
    const csv = await agent.post(`${ws}/contacts/export`).send({ list: "VIP" }).expect(200);
    expect(csv.text.trim().split("\n").length).toBe(total + 1);
  });
});

// ---- The database filter gives the same contacts as the rules engine ----

describe("filters in the database match the rules engine (parity)", () => {
  const FIELDS: { key: string; type: FieldType; gen: (r: () => number) => string }[] = [
    { key: "tier", type: "choice", gen: (r) => ["Gold", "Standard", "Platinum", ""][Math.floor(r() * 4)] },
    { key: "km", type: "number", gen: (r) => (r() < 0.15 ? "" : String(Math.floor(r() * 100000))) },
    { key: "bought", type: "date", gen: (r) => (r() < 0.15 ? "" : new Date(Date.UTC(2026, 10, 26) + Math.floor((r() - 0.5) * 400) * 86400000).toISOString().slice(0, 10)) },
    { key: "plan", type: "yesno", gen: (r) => ["Yes", "No", ""][Math.floor(r() * 3)] },
    { key: "suburb", type: "text", gen: (r) => ["Northside", "Riverview", "Hillcrest", "north bay", ""][Math.floor(r() * 5)] },
  ];
  const VALUES: Record<string, string[]> = {
    tier: ["Gold", "gold", "Platinum,Gold", "Silver"],
    km: ["50000", "0", "99999", "12,000"],
    bought: ["2026-11-26", "2026-06-01", "30", "7", "365"],
    plan: [""],
    suburb: ["north", "Northside", "Riverview, Hillcrest", "z"],
  };

  it("agrees on 300 random rules over 400 contacts", async () => {
    const { agent, ws, id } = await withWorkspace(app, "parity@example.com");
    for (const f of FIELDS) await agent.post(`${ws}/fields`).send({ key: f.key, label: f.key, type: f.type });
    let seed = 42;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const people = Array.from({ length: 400 }, (_, i) => ({ name: `P${i}`, phone: `+614${String(10000000 + i).slice(0, 8)}`, groups: [], fields: Object.fromEntries(FIELDS.map((f) => [f.key, f.gen(r)]).filter(([, v]) => v)) }));
    for (const p of people) await agent.post(`${ws}/contacts`).send(p).expect(201);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    await agent.patch(`${ws}/settings`).send({ version: 1, settings: { businessName: "P", timezone, callingDays: [1], callingStart: 9, callingEnd: 17, doNotCall: [] } }).expect(200);

    const mismatches: string[] = [];
    for (let i = 0; i < 300; i++) {
      const make = (): Condition => {
        const f = FIELDS[Math.floor(r() * FIELDS.length)];
        const ops = OPS_FOR[f.type];
        const op = ops[Math.floor(r() * ops.length)];
        const vals = VALUES[f.key];
        return { field: f.key, op, value: vals[Math.floor(r() * vals.length)], value2: f.type === "number" ? "70000" : f.type === "date" ? "2026-12-31" : undefined };
      };
      const group: ConditionGroup = { match: r() < 0.5 ? "all" : "any", rules: Array.from({ length: 1 + Math.floor(r() * 2) }, make) };
      const want = people.filter((p) => groupHolds(group, { ...p.fields, name: p.name, phone: p.phone }, new Date())).map((p) => p.name).sort();
      const got = (await agent.post(`${ws}/contacts/query`).send({ filter: group, pageSize: 200 })).body;
      const all = [...got.rows];
      for (let page = 2; page <= got.pages; page++) all.push(...(await agent.post(`${ws}/contacts/query`).send({ filter: group, pageSize: 200, page })).body.rows);
      const names = all.map((x: { name: string }) => x.name).sort();
      if (JSON.stringify(names) !== JSON.stringify(want)) mismatches.push(`${JSON.stringify(group)}: engine ${want.length}, database ${names.length}`);
    }
    expect(mismatches).toEqual([]);
    void id;
  });
});

// ---- Speed: the roadmap's exit test ----

describe("100k contacts", () => {
  it("filters, sorts and pages in well under the 300 ms target", async () => {
    const { agent, ws, id } = await withWorkspace(app, "big@example.com");
    await agent.post(`${ws}/fields`).send({ key: "km", label: "Kilometres", type: "number" });
    await agent.post(`${ws}/fields`).send({ key: "tier", label: "Tier", type: "choice" });
    const contacts: Model<unknown> = app.get(getModelToken("Contact"));
    const workspaceId = new Types.ObjectId(id);
    const TIERS = ["Gold", "Standard", "Platinum"];
    for (let b = 0; b < 100; b++) {
      await contacts.insertMany(
        Array.from({ length: 1000 }, (_, i) => {
          const n = b * 1000 + i;
          return { workspaceId, name: `Person ${n}`, phone: `+6140${String(n).padStart(7, "0")}`, phoneE164: `+6140${String(n).padStart(7, "0")}`, groups: n % 3 ? ["Buyers"] : ["Web"], fields: { km: (n * 7919) % 150000, tier: TIERS[n % 3] }, createdAt: new Date(Date.now() - n * 1000) };
        }),
        { ordered: false, lean: true },
      );
    }
    // Best of three: the query's own cost, not whatever else the machine is doing at that moment.
    const timed = async (body: object) => {
      let best = { ms: Infinity, total: 0 };
      for (let i = 0; i < 3; i++) {
        const t = Date.now();
        const res = await agent.post(`${ws}/contacts/query`).send(body).expect(201);
        best = Date.now() - t < best.ms ? { ms: Date.now() - t, total: res.body.total } : best;
      }
      return best;
    };
    await timed({}); // warm up
    const plain = await timed({ page: 50 });
    const filtered = await timed({ list: "Buyers", filter: { match: "all", rules: [{ field: "km", op: "more_than", value: "100000" }, { field: "tier", op: "any_of", value: "Gold,Platinum" }] } });
    const sorted = await timed({ sort: { key: "km", dir: "desc" }, page: 3 });
    const byName = await timed({ sort: { key: "name", dir: "asc" }, page: 2 });
    // eslint-disable-next-line no-console
    console.log(`100k contacts: plain ${plain.ms} ms, filtered ${filtered.ms} ms (${filtered.total}), sorted ${sorted.ms} ms, by name ${byName.ms} ms`);
    expect(plain.total).toBe(100000);
    expect(plain.ms).toBeLessThan(300);
    expect(filtered.ms).toBeLessThan(300);
    expect(sorted.ms).toBeLessThan(300);
    expect(byName.ms).toBeLessThan(300);
  }, 120000);
});
