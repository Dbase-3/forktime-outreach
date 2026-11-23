import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server-core";

// The queue and the agent's reports, end to end against a real (throwaway)
// database. The one thing faked is the dial itself: no phone rings here.

const placeCall = vi.fn(async () => undefined);
const closeRoom = vi.fn(async () => undefined);
vi.mock("@/lib/dialer", async (original) => ({
  ...(await original<typeof import("@/lib/dialer")>()),
  placeCall,
  closeRoom,
}));

let server: MongoMemoryServer;

beforeAll(async () => {
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = `${server.getUri()}outreach_test`;
});

afterAll(async () => {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  await server.stop();
});

beforeEach(async () => {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  await Promise.all(["calls", "transcripts", "settings", "dnc"].map((name) => db.collection(name).deleteMany({})));
  placeCall.mockClear();
  closeRoom.mockClear();
  placeCall.mockImplementation(async () => undefined);
  process.env.DIAL_MODE = "live";
  process.env.AGENT_EVENTS_KEY = "test-agent-key";
});

async function setup(overrides: Record<string, unknown> = {}) {
  const { DEFAULT_SETTINGS, saveSettings, setQueueRunning } = await import("@/lib/settings");
  await saveSettings({
    ...DEFAULT_SETTINGS,
    enforceWindow: false,
    transferNumber: "+61400000001",
    callbackNumber: "+61400000002",
    fromNumber: "+61400000003",
    ...overrides,
  });
  await setQueueRunning(true);
}

async function add(...phones: string[]) {
  const { addCalls } = await import("@/lib/calls-repo");
  return addCalls(phones.map((phone, i) => ({ phone, label: `Place ${i + 1}` })), "+61400000003");
}

const statuses = async () => {
  const { listCalls } = await import("@/lib/calls-repo");
  const calls = await listCalls();
  return Object.fromEntries(calls.map((c) => [c.label, c.outcome ? `${c.status}:${c.outcome}` : c.status]));
};

describe("the queue, with real calls", () => {
  it("stores the outbound callback details and each service preference from the agent webhook", async () => {
    await setup();
    const [call] = await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { POST } = await import("@/app/api/agent/events/route");
    const { getCall } = await import("@/lib/calls-repo");
    await advanceQueue();
    const details = {
      ownerReached: true,
      contactName: "Raj",
      callbackNumber: "+61889410002",
      callbackTime: "Tomorrow around 2 PM",
      callbackPermission: true,
      takesLargeBookings: true,
      takesCatering: true,
      dietaryOptions: "Vegetarian and gluten-free",
      interestedInBookingInquiries: false,
      interestedInSystem: true,
      bookingSystem: "OpenTable",
    };
    const response = await POST(new Request("http://x/api/agent/events", {
      method: "POST",
      headers: { "x-agent-key": "test-agent-key", "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ended", endReason: "agent_ended", callId: call._id, outcome: "owner_callback", restaurantName: "Raj's Restaurant", ...details }),
    }));
    expect(response.status).toBe(200);
    expect(await getCall(call._id)).toMatchObject({ label: "Raj's Restaurant", outcome: "owner_callback", ...details });

    const { POST: queueCallback } = await import("@/app/api/calls/[id]/retry/route");
    const { addDnc } = await import("@/lib/dnc");
    const at = new Date(Date.now() + 60_000);
    const queue = () => queueCallback(new Request("http://x/api/calls/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ at: at.toISOString() }),
    }), { params: { id: call._id } });
    const confirmed = await queue();
    expect(confirmed.status).toBe(200);
    const { callId } = await confirmed.json();
    expect(await getCall(callId)).toMatchObject({ status: "queued", phone: details.callbackNumber, notBefore: at });
    await addDnc(details.callbackNumber, "Asked not to be called");
    expect((await queue()).status).toBe(409);
  });

  it("keeps queues and call records isolated by workspace", async () => {
    const { DEFAULT_SETTINGS, saveSettings, setQueueRunning } = await import("@/lib/settings");
    const { addCalls, getActiveCall, listCalls } = await import("@/lib/calls-repo");
    const { advanceQueue } = await import("@/lib/queue-runner");

    await setup();
    await saveSettings(
      {
        ...DEFAULT_SETTINGS,
        enforceWindow: false,
        transferNumber: "+61400000011",
        callbackNumber: "+61400000012",
        fromNumber: "+61400000013",
      },
      "other-client",
    );
    await setQueueRunning(true, "other-client");
    await addCalls([{ phone: "+61889410001", label: "Forktime venue" }], "+61400000003");
    await addCalls([{ phone: "+61889410002", label: "Other venue" }], "+61400000013", new Date(), null, "other-client");

    await advanceQueue();
    await advanceQueue(new Date(), "other-client");

    expect((await listCalls()).map((call) => call.label)).toEqual(["Forktime venue"]);
    expect((await listCalls(200, "other-client")).map((call) => call.label)).toEqual(["Other venue"]);
    expect((await getActiveCall())?.workspaceId).toBe("forktime");
    expect((await getActiveCall("other-client"))?.workspaceId).toBe("other-client");
    expect(placeCall).toHaveBeenCalledTimes(2);
  });

  it("dials one number at a time, and the agent's ending starts the next", async () => {
    await setup();
    const [first, second] = await add("+61889410001", "+61889410002");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { applyAgentEvent } = await import("@/lib/agent-events");

    await advanceQueue();
    await advanceQueue();
    expect(placeCall).toHaveBeenCalledTimes(1);
    expect(await statuses()).toEqual({ "Place 1": "dialing", "Place 2": "queued" });

    await applyAgentEvent({ type: "answered", callId: first._id, attempt: 1 });
    await applyAgentEvent({ type: "transcript", callId: first._id, attempt: 1, seq: 1, role: "callee", text: "Rosie's, hello?" });
    await applyAgentEvent({ type: "transcript", callId: first._id, attempt: 1, seq: 1, role: "callee", text: "Rosie's, hello?" });
    expect(await statuses()).toEqual({ "Place 1": "live", "Place 2": "queued" });

    await applyAgentEvent({
      type: "ended",
      callId: first._id,
      attempt: 1,
      outcome: "message_left",
      endReason: "agent_ended",
      summary: "Staff will pass the number on.",
      ownerReached: false,
    });
    expect(await statuses()).toEqual({ "Place 1": "ended:message_left", "Place 2": "dialing" });
    expect(placeCall).toHaveBeenCalledTimes(2);

    const { getTranscript, getCall } = await import("@/lib/calls-repo");
    expect((await getTranscript(first._id)).map((l) => l.text)).toEqual(["Rosie's, hello?"]);
    expect((await getCall(first._id))?.summary).toBe("Staff will pass the number on.");
    expect((await getCall(second._id))?.roomName).toBe(`outreach-${second._id}-1`);
  });

  it("two ticks at the same moment still start one call", async () => {
    await setup();
    await add("+61889410001", "+61889410002");
    const { advanceQueue } = await import("@/lib/queue-runner");
    await Promise.all([advanceQueue(), advanceQueue(), advanceQueue()]);
    expect(Object.values(await statuses()).filter((s) => s === "dialing")).toHaveLength(1);
    expect(placeCall).toHaveBeenCalledTimes(1);
  });

  it("an unanswered call goes back in the queue for later, up to the limit", async () => {
    await setup({ maxAttempts: 2, retryAfterMinutes: 60 });
    const [call] = await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { applyAgentEvent } = await import("@/lib/agent-events");
    const { getCall } = await import("@/lib/calls-repo");
    const t0 = new Date("2026-11-18T04:00:00Z");

    await advanceQueue(t0);
    await applyAgentEvent({ type: "not_answered", callId: call._id, attempt: 1 }, t0);
    const requeued = await getCall(call._id);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.attempt).toBe(2);
    expect(requeued?.notBefore?.toISOString()).toBe("2026-11-18T05:00:00.000Z");

    // Not yet due: nothing is dialled.
    await advanceQueue(new Date("2026-11-18T04:30:00Z"));
    expect(placeCall).toHaveBeenCalledTimes(1);

    const t1 = new Date("2026-11-18T05:01:00Z");
    await advanceQueue(t1);
    expect(placeCall).toHaveBeenCalledTimes(2);
    await applyAgentEvent({ type: "not_answered", callId: call._id, attempt: 2 }, t1);
    expect(await statuses()).toEqual({ "Place 1": "ended:no_answer" });
  });

  it("a report from an earlier try of the same number is ignored", async () => {
    await setup();
    const [call] = await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { applyAgentEvent } = await import("@/lib/agent-events");
    await advanceQueue();
    await applyAgentEvent({ type: "not_answered", callId: call._id, attempt: 1 });
    await applyAgentEvent({ type: "ended", callId: call._id, attempt: 1, endReason: "callee_hung_up" });
    expect(await statuses()).toEqual({ "Place 1": "queued" });
  });

  it("someone who asks not to be called goes on the list and is never dialled again", async () => {
    await setup();
    const [call] = await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { applyAgentEvent } = await import("@/lib/agent-events");
    const { dncPhones } = await import("@/lib/dnc");

    await advanceQueue();
    await applyAgentEvent({ type: "answered", callId: call._id, attempt: 1 });
    await applyAgentEvent({ type: "ended", callId: call._id, attempt: 1, outcome: "do_not_call", endReason: "agent_ended" });
    expect([...(await dncPhones())]).toEqual(["+61889410001"]);

    const { setQueueRunning } = await import("@/lib/settings");
    await add("+61889410001");
    await setQueueRunning(true);
    await advanceQueue();
    expect(placeCall).toHaveBeenCalledTimes(1);
    const { listCalls } = await import("@/lib/calls-repo");
    expect((await listCalls()).map((c) => c.outcome).sort()).toEqual(["do_not_call", "skipped_do_not_call"]);
  });

  it("a call the agent never reported on is closed, so the queue is not stuck", async () => {
    await setup({ ringTimeoutSec: 30 });
    await add("+61889410001", "+61889410002");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const t0 = new Date("2026-11-18T04:00:00Z");
    await advanceQueue(t0);
    await advanceQueue(new Date(t0.getTime() + 60_000));
    expect(await statuses()).toEqual({ "Place 1": "dialing", "Place 2": "queued" });

    await advanceQueue(new Date(t0.getTime() + 80_000));
    expect(await statuses()).toEqual({ "Place 2": "dialing", "Place 1": "ended:failed" });
    expect(closeRoom).toHaveBeenCalledTimes(1);
  });

  it("a dial the carrier refuses is filed as failed and the next number goes out", async () => {
    await setup();
    await add("+61889410001", "+61889410002");
    placeCall.mockImplementationOnce(async () => {
      throw new Error("trunk refused");
    });
    const { advanceQueue } = await import("@/lib/queue-runner");
    await advanceQueue();
    expect(await statuses()).toEqual({ "Place 2": "dialing", "Place 1": "ended:failed" });
  });

  it("nothing is dialled outside the calling window, or while paused", async () => {
    await setup({ enforceWindow: true, timezone: "UTC", windowStart: "09:00", windowEnd: "17:00", windowDays: [1, 2, 3, 4, 5, 6, 7] });
    await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { setQueueRunning } = await import("@/lib/settings");

    expect((await advanceQueue(new Date("2026-11-18T20:00:00Z"))).waiting).toBe("outside_window");
    await setQueueRunning(false);
    expect((await advanceQueue(new Date("2026-11-18T10:00:00Z"))).waiting).toBe("paused");
    expect(placeCall).not.toHaveBeenCalled();

    await setQueueRunning(true);
    expect((await advanceQueue(new Date("2026-11-18T10:00:00Z"))).activeCallId).toBeTruthy();
    expect(placeCall).toHaveBeenCalledTimes(1);
  });

  it("the queue stops itself when it runs dry", async () => {
    await setup();
    const [call] = await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { applyAgentEvent } = await import("@/lib/agent-events");
    await advanceQueue();
    await applyAgentEvent({ type: "answered", callId: call._id, attempt: 1 });
    await applyAgentEvent({ type: "ended", callId: call._id, attempt: 1, endReason: "transferred", transferred: true });
    const snapshot = await advanceQueue();
    expect(snapshot).toMatchObject({ running: false, waiting: "paused", activeCallId: null, queued: 0 });
    expect(await statuses()).toEqual({ "Place 1": "ended:transferred" });
  });
});

describe("the queue, as a dry run", () => {
  it("acts each call out on screen and never dials", async () => {
    delete process.env.DIAL_MODE;
    await setup();
    await add("+61889410001", "+61889410002");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { getTranscript, listCalls } = await import("@/lib/calls-repo");

    const t0 = new Date("2026-11-18T04:00:00Z");
    const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
    expect((await advanceQueue(t0)).mode).toBe("dry");
    await advanceQueue(at(6));
    const [live] = await listCalls();
    expect(live.status).toBe("live");
    expect(live.simulated).toBe(true);
    expect((await getTranscript(live._id)).length).toBeGreaterThan(0);

    for (let s = 10; s <= 120; s += 5) await advanceQueue(at(s));
    const done = await listCalls();
    expect(done.every((c) => c.status === "ended")).toBe(true);
    expect(done.map((c) => c.outcome).sort()).toEqual(["owner_callback", "voicemail"]);
    expect(done.find((c) => c.outcome === "owner_callback")).toMatchObject({ callbackPermission: true, contactName: "Raj" });
    expect(placeCall).not.toHaveBeenCalled();
  });
});

describe("the queue, as a dry run, outside calling hours", () => {
  it("still runs: no phone rings, so the hours do not apply", async () => {
    delete process.env.DIAL_MODE;
    await setup({ enforceWindow: true, timezone: "UTC", windowStart: "09:00", windowEnd: "17:00", windowDays: [1, 2, 3, 4, 5, 6, 7] });
    await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const snapshot = await advanceQueue(new Date("2026-11-18T22:00:00Z"));
    expect(snapshot.activeCallId).toBeTruthy();
    expect(snapshot.waiting).toBe("line_busy");
  });
});

describe("an owner ringing the call-back number", () => {
  it("with no earlier call, it is a fresh inbound call with the general welcome, and it never takes the dialling line", async () => {
    await setup();
    const { startInboundCall } = await import("@/lib/inbound");
    const { getActiveCall, getCall } = await import("@/lib/calls-repo");
    const { callId, meta } = await startInboundCall({ phone: "+61889419999", calledNumber: "+14184313732", roomName: "room-1" });
    expect(meta.direction).toBe("inbound");
    expect(meta.previousNote).toBeNull();
    expect(meta.openingLine).toContain("you've reached Forktime");
    expect(meta.openingLine).toContain("How can I help?");
    const call = await getCall(callId);
    expect(call).toMatchObject({ direction: "inbound", status: "live", phone: "+61889419999", roomName: "room-1" });
    expect(await getActiveCall()).toBeNull();
  });

  it("after an earlier call to that number, it is told what was noted and welcomes them back", async () => {
    await setup();
    const [first] = await add("+61889410001");
    const { advanceQueue } = await import("@/lib/queue-runner");
    const { applyAgentEvent } = await import("@/lib/agent-events");
    await advanceQueue();
    await applyAgentEvent({ type: "answered", callId: first._id, attempt: 1 });
    await applyAgentEvent({
      type: "ended", callId: first._id, attempt: 1, outcome: "call_back_later", endReason: "agent_ended",
      summary: "Staff said the owner is in after five.", ownerReached: false, callbackTime: "after five", takesLargeBookings: null,
    });
    const { startInboundCall } = await import("@/lib/inbound");
    const { meta } = await startInboundCall({ phone: "+61889410001", calledNumber: "+14184313732", roomName: "room-2" });
    expect(meta.openingLine).toContain("thanks for calling back");
    expect(meta.openingLine).toContain("I called earlier");
    expect(meta.previousNote).toContain("you only reached staff");
    expect(meta.previousNote).toContain("the owner is free: after five");
    expect(meta.previousNote).toContain("Place 1");
  });

  it("the earlier answers are carried: large bookings, seats, food, interest", async () => {
    const { previousNoteOf } = await import("@/lib/inbound");
    const note = previousNoteOf({ summary: "Spoke to the owner.", takesLargeBookings: true, seats: 60, capacityNote: null, vegetarianVegan: "plenty", interestedInSystem: true, callbackTime: null, contactName: "Anne", ownerReached: true, label: "Rosie's", endedAt: null });
    expect(note).toBe("the restaurant is Rosie's; owner or manager name recorded: Anne; you reached the owner or manager; takes large bookings: yes; seats: 60; dietary accommodations: plenty; wants to hear about the AI phone assistant: yes; summary: Spoke to the owner.");
  });

  it("the agent's door for it needs the agent key", async () => {
    const { POST } = await import("@/app/api/agent/inbound/route");
    const request = (key?: string) => new Request("http://x/api/agent/inbound", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "x-agent-key": key } : {}) }, body: JSON.stringify({ phone: "+61889410001", calledNumber: "+14184313732", roomName: "r" }) });
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request("wrong"))).status).toBe(401);
  });
});

describe("settings", () => {
  it("the voice speed stays between normal and 1.2, and rides to the agent with the call", async () => {
    const { DEFAULT_SETTINGS, validateSettings } = await import("@/lib/settings");
    const { callMetadata } = await import("@/lib/dialer");
    expect("settings" in validateSettings({ ...DEFAULT_SETTINGS, voiceSpeed: 1.2 })).toBe(true);
    for (const voiceSpeed of [0.9, 1.5]) {
      const result = validateSettings({ ...DEFAULT_SETTINGS, voiceSpeed });
      expect("errors" in result && result.errors[0].field).toBe("voiceSpeed");
    }
    const [call] = await add("+61889410001");
    const meta = callMetadata(call, { ...DEFAULT_SETTINGS, voiceSpeed: 1.2 });
    expect(meta.voiceSpeed).toBe(1.2);
    expect(meta.voiceProvider).toBe("fishaudio");
  });

  it("an edited booking welcome reaches the agent", async () => {
    const { DEFAULT_SETTINGS, validateSettings } = await import("@/lib/settings");
    const { callMetadata } = await import("@/lib/dialer");
    const edited = { ...DEFAULT_SETTINGS, welcomeOutbound: "Hello, {agent} here about {topic}. Is the owner in?" };
    expect("settings" in validateSettings(edited)).toBe(true);
    const [call] = await add("+61889410001");
    expect(callMetadata(call, edited).openingLine).toBe("Hello, Sara here about potential group reservations and catering inquiries. Is the owner in?");
  });

  it("settings saved before a field existed read back with that field's default", async () => {
    const { collections } = await import("@/lib/db");
    const { DEFAULT_SETTINGS, getSettings } = await import("@/lib/settings");
    const { voiceSpeed: _speed, voiceProvider: _provider, welcomeOutbound: _welcome, ...older } = DEFAULT_SETTINGS;
    await (await collections()).settings.updateOne({ _id: "app" }, { $set: { ...older, agentName: "Mia" } }, { upsert: true });
    const read = await getSettings();
    expect(read.agentName).toBe("Mia");
    expect(read.voiceSpeed).toBe(1.1);
    expect(read.welcomeOutbound).toBe(DEFAULT_SETTINGS.welcomeOutbound);
    // Saved before the voice company was a choice: it was ElevenLabs, and stays so.
    expect(read.voiceProvider).toBe("elevenlabs");
  });

  it("replaces the legacy default opener on saved workspaces and keeps custom wording", async () => {
    const { PREVIOUS_OUTBOUND_WELCOME } = await import("@/lib/opening-line");
    const { DEFAULT_SETTINGS, getSettings, saveSettings } = await import("@/lib/settings");
    await saveSettings({ ...DEFAULT_SETTINGS, welcomeOutbound: PREVIOUS_OUTBOUND_WELCOME }, "other-client");
    expect((await getSettings("other-client")).welcomeOutbound).toBe(DEFAULT_SETTINGS.welcomeOutbound);
    await saveSettings({ ...DEFAULT_SETTINGS, welcomeOutbound: "Hello, how are you?" }, "other-client");
    expect((await getSettings("other-client")).welcomeOutbound).toBe("Hello, how are you?");
  });
});

describe("outcomeOfEnding", () => {
  it("files a call under what happened", async () => {
    const { outcomeOfEnding } = await import("@/lib/agent-events");
    const ended = (extra: object) => ({ type: "ended" as const, callId: "c", endReason: "agent_ended" as const, ...extra });
    expect(outcomeOfEnding(ended({ outcome: "not_interested" }))).toBe("not_interested");
    expect(outcomeOfEnding(ended({ outcome: "owner_callback", transferred: true }))).toBe("transferred");
    expect(outcomeOfEnding(ended({ endReason: "callee_hung_up" }))).toBe("hung_up");
    expect(outcomeOfEnding(ended({ endReason: "error" }))).toBe("failed");
    expect(outcomeOfEnding(ended({}))).toBe("other");
  });
});
