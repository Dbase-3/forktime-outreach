import { describe, expect, it } from "vitest";
import { analyzeCsv, planImport, rowValues, runQuery, toCsv, type TableQuery } from "@/lib/contacts-table";
import { seedState } from "@/lib/seed";
import type { Contact, FieldDef } from "@/lib/types";

const now = new Date("2026-11-26T12:00:00");
const defs: FieldDef[] = [{ key: "km", label: "Kilometres", type: "number" }, { key: "bought", label: "Bought", type: "date" }];
const contact = (id: string, name: string, fields: Record<string, string>, groups = ["A"]): Contact => ({ id, name, phone: `+6140000000${id}`, groups, fields, createdAt: "2026-01-01" });
const contacts = [
  contact("1", "Zoe Lee", { km: "900", bought: "2026-10-01" }),
  contact("2", "adam Smith", { km: "12000", bought: "2026-11-20" }, ["A", "B"]),
  contact("3", "Mia King", { km: "", bought: "" }, ["B"]),
];
const base: TableQuery = { search: "", list: null, filter: { match: "all", rules: [] }, sort: { key: "name", dir: "asc" }, page: 1, pageSize: 2 };
const names = (q: Partial<TableQuery>) => runQuery(contacts, [], defs, { ...base, ...q }, now).matching.map((r) => r.contact.name);

describe("sorting", () => {
  it("sorts names without caring about case", () => {
    expect(names({})).toEqual(["adam Smith", "Mia King", "Zoe Lee"]);
  });

  it("sorts numbers as numbers and keeps blanks last both ways", () => {
    expect(names({ sort: { key: "km", dir: "asc" } })).toEqual(["Zoe Lee", "adam Smith", "Mia King"]);
    expect(names({ sort: { key: "km", dir: "desc" } })).toEqual(["adam Smith", "Zoe Lee", "Mia King"]);
  });

  it("sorts dates as dates", () => {
    expect(names({ sort: { key: "bought", dir: "desc" } })).toEqual(["adam Smith", "Zoe Lee", "Mia King"]);
  });
});

describe("finding contacts", () => {
  it("searches name, phone and email", () => {
    expect(names({ search: "smi" })).toEqual(["adam Smith"]);
    expect(names({ search: "00003" })).toEqual(["Mia King"]);
  });

  it("filters by list and by rules", () => {
    expect(names({ list: "B" })).toEqual(["adam Smith", "Mia King"]);
    expect(names({ filter: { match: "all", rules: [{ field: "km", op: "more_than", value: "1000" }] } })).toEqual(["adam Smith"]);
    expect(names({ filter: { match: "any", rules: [{ field: "km", op: "is_empty" }, { field: "bought", op: "less_than_days_ago", value: "10" }] } })).toEqual(["adam Smith", "Mia King"]);
  });

  it("pages, keeping the page in range", () => {
    const result = runQuery(contacts, [], defs, { ...base, page: 9 }, now);
    expect(result.total).toBe(3);
    expect(result.pages).toBe(2);
    expect(result.rows.map((r) => r.contact.name)).toEqual(["Zoe Lee"]);
  });
});

describe("rows and export", () => {
  it("adds the last call and its outcome to a contact's values", () => {
    const seed = seedState(now);
    const priya = seed.contacts.find((c) => c.name === "Priya Patel")!;
    expect(rowValues(priya, seed.calls)).toMatchObject({ last_outcome: "service_booked", lists: "Buyers 2026" });
  });

  it("writes a CSV with quoted cells", () => {
    const rows = runQuery([contact("9", 'Lee, "Jo"', { km: "5" })], [], defs, base, now).rows;
    expect(toCsv(rows, [{ key: "name", label: "Name", type: "text" }, { key: "km", label: "Kilometres", type: "number" }])).toBe('Name,Kilometres\n"Lee, ""Jo""",5');
  });
});

describe("importing a CSV", () => {
  const csv = "First name,Surname,Mobile,Email,Rego,Last service,Spend\nSam,Lee,0412 555 000,sam@x.com,ABC123,2026-05-01,1200\nJo,Ng,,jo@x.com,XYZ9,2026-06-02,80\nAl,Bo,0413 555 111,,QQ1,2026-07-03,40";

  it("suggests where each column goes and guesses its type", () => {
    const { columns } = analyzeCsv(csv, []);
    expect(columns.map((c) => [c.name, c.target, c.type])).toEqual([
      ["First name", "first_name", "text"],
      ["Surname", "last_name", "text"],
      ["Mobile", "phone", "phone"],
      ["Email", "email", "email"],
      ["Rego", "field:rego", "text"],
      ["Last service", "field:last_service", "date"],
      ["Spend", "field:spend", "number"],
    ]);
    expect(columns[0].samples).toEqual(["Sam", "Jo", "Al"]);
  });

  it("builds contacts from the chosen columns, skips rows with no phone and adds new fields once", () => {
    const { columns, rows } = analyzeCsv(csv, []);
    columns[4].target = "skip";
    const plan = planImport(columns, rows, "Service list", [], "src_x");
    expect(plan.skipped).toBe(1);
    expect(plan.contacts).toHaveLength(2);
    expect(plan.contacts[0]).toMatchObject({ name: "Sam Lee", phone: "0412 555 000", email: "sam@x.com", groups: ["Service list"], fields: { first_name: "Sam", last_service: "2026-05-01", spend: "1200" } });
    expect(plan.contacts[0].fields.rego).toBeUndefined();
    expect(plan.newFields.map((f) => [f.key, f.type])).toEqual([["last_service", "date"], ["spend", "number"]]);
  });

  it("reuses an existing field's type instead of re-guessing", () => {
    const { columns } = analyzeCsv("Phone,Spend\n0400111222,12", [{ key: "spend", label: "Spend", type: "text" }]);
    expect(columns[1].type).toBe("text");
  });
});

describe("import: dates and duplicates (B18, audit)", () => {
  it("stores dates as YYYY-MM-DD read the way the column shows, and doesn't add a number twice", async () => {
    const { planImport } = await import("@/lib/contacts-table");
    const columns = [
      { index: 0, name: "Phone", label: "Phone", target: "phone" as const, type: "phone" as const },
      { index: 1, name: "Bought", label: "Bought", target: "field:bought" as const, type: "date" as const },
    ];
    const rows = [["0412 555 019", "03/04/2026"], ["+61 412 555 020", "25/12/2025"], ["0412555020", "01/01/2026"], ["0412 555 021", "1/2/2026"]];
    const plan = planImport(columns as never, rows, "List", [], "src", [{ phone: "+61412555021" }], "AU");
    expect(plan.contacts.map((c) => c.fields.bought)).toEqual(["2026-04-03", "2025-12-25"]);
    expect(plan.duplicates).toBe(2);
  });

  it("reads month/day when the column shows it", async () => {
    const { dateOrderOf, toIsoDate } = await import("@/lib/conditions");
    expect(dateOrderOf(["03/04/2026", "12/25/2025"])).toBe("mdy");
    expect(toIsoDate("03/04/2026", "mdy")).toBe("2026-03-04");
    expect(toIsoDate("31/02/2026", "dmy")).toBeNull();
  });
});
