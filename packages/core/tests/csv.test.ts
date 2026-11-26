import { describe, expect, it } from "vitest";
import { importContacts, parseCsv } from "../src/csv";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, commas inside quotes and CRLF", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });

  it("drops blank lines and keeps a last line with no newline", () => {
    expect(parseCsv("a\n\n b \nc")).toEqual([["a"], [" b "], ["c"]]);
  });
});

describe("importContacts", () => {
  it("finds name, phone and email, and turns other columns into fields", () => {
    const csv = "Name,Mobile,Email,Car model,Purchase date\nSarah Chen,+61412555019,sarah@x.com,RAV4,2026-10-01\n";
    const result = importContacts(csv);
    expect(result.contacts).toEqual([
      { name: "Sarah Chen", phone: "+61412555019", email: "sarah@x.com", fields: { first_name: "Sarah", car_model: "RAV4", purchase_date: "2026-10-01" } },
    ]);
    expect(result.newFields).toEqual([{ key: "car_model", label: "Car model" }, { key: "purchase_date", label: "Purchase date" }]);
  });

  it("joins first and last name columns", () => {
    const result = importContacts("First name,Last name,Phone\nTom,Nguyen,0415555047");
    expect(result.contacts[0]).toMatchObject({ name: "Tom Nguyen", fields: { first_name: "Tom" } });
  });

  it("skips rows with no phone and counts them", () => {
    const result = importContacts("Name,Phone\nA,\nB,123");
    expect(result.contacts.map((c) => c.name)).toEqual(["B"]);
    expect(result.skipped).toBe(1);
  });

  it("does not mistake an invoice number for the phone", () => {
    const result = importContacts("Name,Invoice number,Mobile\nA,INV-9,0400111222");
    expect(result.contacts[0]).toMatchObject({ phone: "0400111222", fields: { invoice_number: "INV-9" } });
  });

  it("returns nothing for an empty file", () => {
    expect(importContacts("")).toEqual({ contacts: [], newFields: [], skipped: 0 });
  });
});
