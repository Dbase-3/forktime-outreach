import { codeEmail } from "../src/modules/auth/emails";

describe("the sign-in code email", () => {
  it("copies as just the six digits: the gap between the halves is spacing, not a character", () => {
    const { html } = codeEmail({ code: "779737", to: "a@example.com", appUrl: "https://app.example.com" });
    const box = html.match(/font-size:34px[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? "";
    expect(box.replace(/<[^>]+>/g, "")).toBe("779737");
  });
});
