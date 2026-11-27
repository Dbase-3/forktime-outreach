import { describe, expect, it } from "vitest";
import { callNote, personOf } from "../src/crm";

describe("who the call was with", () => {
  it("the call's contact comes first", () => {
    expect(personOf({ contact: { name: "Ann Lee", phoneE164: "+61400111222", email: "ann@x.com" }, saved: { contactName: "Someone" }, fromNumber: "+15550001111" })).toEqual({ name: "Ann Lee", phone: "+61400111222", email: "ann@x.com" });
  });

  it("otherwise what they said: a name answer, a phone answer in E.164, an email answer", () => {
    expect(personOf({ saved: { contactName: "Bo Diaz", callbackNumber: "+61 400 222 333", email_address: "bo@x.com", restaurantName: "Luigi's" }, fromNumber: null })).toEqual({ name: "Bo Diaz", phone: "+61400222333", email: "bo@x.com" });
    expect(personOf({ saved: { first_name: "Cy", last_name: "Ng" } }).name).toBe("Cy Ng");
  });

  it("a number they read out that isn't international falls back to the number that called", () => {
    expect(personOf({ saved: { callbackNumber: "0400 222 333", email: "not an email" }, fromNumber: "+61400999888" })).toEqual({ name: undefined, phone: "+61400999888", email: undefined });
  });
});

describe("the note", () => {
  const schema = [{ key: "takesLargeBookings", label: "Takes large bookings" }, { key: "callbackTime", label: "Callback time" }];
  it("says when, which agent, how it ended, the summary and the answers with their labels", () => {
    const n = callNote({ agent: "Sara", when: "Friday 28 November at 10 am", outcome: "owner_callback", summary: "Spoke with the owner.", saved: { takesLargeBookings: "Yes", callbackTime: "Monday 3pm", other: "" }, schema });
    expect(n.title).toBe("Phone call with Sara: owner callback");
    expect(n.body).toBe("Phone call with Sara (AI assistant), Friday 28 November at 10 am.\nOutcome: owner callback\n\nSpoke with the owner.\n\nAnswers:\n- Takes large bookings: Yes\n- Callback time: Monday 3pm");
  });
  it("only the chosen answers when the action names some", () => {
    expect(callNote({ agent: "Sara", when: "now", outcome: "done", summary: "", saved: { takesLargeBookings: "Yes", callbackTime: "Mon" }, schema, keys: ["callbackTime"] }).body).not.toContain("large bookings");
  });
});
