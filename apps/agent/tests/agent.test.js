import { EventEmitter } from "node:events";
import { beforeAll, describe, expect, it, vi } from "vitest";
import callAnswer from "../src/callAnswer.js";
import events from "../src/events.js";
import lineCheck from "../src/lineCheck.js";
import opening from "../src/opening.js";
import prompt from "../src/prompt.js";
import recording from "../src/recording.js";
import transfer from "../src/transfer.js";
import wrapup from "../src/wrapup.js";

const meta = {
  kind: "outreach",
  callId: "call-1",
  attempt: 1,
  phone: "+61889411234",
  label: "Rosie's Diner",
  agentName: "Sara",
  repName: "Adil Khan",
  company: "Forktime",
  topic: "how your restaurant takes phone bookings",
  transferNumber: "+61400000001",
  callbackNumberSpoken: "oh four one two, three four five, six seven eight",
  recordCalls: true,
  openingLine:
    "Hi, this is Sara, an AI assistant calling for Adil at Forktime, about how your restaurant takes phone bookings. This call is recorded. Is the owner or manager around?",
};

describe("the opening line", () => {
  it("is spoken as the app wrote it when it says AI and names the company", () => {
    expect(opening.resolveOpeningLine(meta)).toBe(meta.openingLine);
  });

  it("is replaced by the agent's own line when the one handed over hides either", () => {
    for (const line of ["Hi, I'd like to make a large booking. Is the owner around?", "Hi, this is Sara from Forktime.", "", undefined]) {
      const spoken = opening.resolveOpeningLine({ ...meta, openingLine: line });
      expect(spoken).toBe("Hi, this is Sara, an AI assistant calling for Adil at Forktime. This call is recorded. Is the owner or manager around?");
      expect(opening.hasDisclosure(spoken, "Forktime")).toBe(true);
    }
  });
});

describe("the agent's instructions", () => {
  const text = prompt.buildInstructions(meta, meta.openingLine);

  it("say who it is, who it calls for, and that the opening line is already said", () => {
    expect(text).toContain("You are Sara, an AI voice assistant");
    expect(text).toContain("for Adil Khan at Forktime");
    expect(text).toContain(`You have already said, word for word: "${meta.openingLine}"`);
    expect(text).toContain("You are calling: Rosie's Diner.");
  });

  it("never let it pose as a customer or deny being an AI", () => {
    expect(text).toContain("You are not a customer.");
    expect(text).toContain("Never claim or hint that you are a person.");
    expect(text).not.toMatch(/large booking|party of|pretend/i);
  });

  it("teach it to say goodbye through the tool, and what to do with a machine that talks back", () => {
    expect(text).toContain("Another AI assistant or a phone system that answers for the restaurant");
    expect(text).toContain("Your last words go in its goodbye field");
    expect(text).toContain("Never ask staff which number to call");
  });

  it("take a no, and a busy owner, at their word", () => {
    expect(text).toContain("Never ask for the owner again after a no.");
    expect(text).toContain("never offer to connect Adil now");
  });

  it("give staff the call-back number as words, and fall back when none is set", () => {
    expect(text).toContain("on oh four one two, three four five, six seven eight");
    expect(prompt.buildInstructions({ ...meta, callbackNumberSpoken: "" }, meta.openingLine)).toContain("on the number this call came from");
  });
});

describe("the event reporter", () => {
  const response = (status) => ({ ok: status >= 200 && status < 300, status });
  const make = (fetchImpl) =>
    events.createEmitter({ baseUrl: "http://app", key: "k", callId: "call-1", attempt: 2, fetchImpl, log: { warn: () => {} }, delaysMs: [1, 1] });
  const bodies = (fetchImpl) => fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body));

  it("posts reports in the order they were made, signed with the key", async () => {
    const fetchImpl = vi.fn(async () => response(200));
    const emitter = make(fetchImpl);
    emitter.emit("answered");
    emitter.line("callee", "  Rosie's, hello?  ");
    emitter.line("agent", "");
    emitter.line("agent", "Hi there.");
    await emitter.flush();

    expect(fetchImpl.mock.calls[0][0]).toBe("http://app/api/agent/events");
    expect(fetchImpl.mock.calls[0][1].headers["x-agent-key"]).toBe("k");
    expect(bodies(fetchImpl).map((b) => [b.type, b.seq ?? null, b.text ?? null])).toEqual([
      ["answered", null, null],
      ["transcript", 1, "Rosie's, hello?"],
      ["transcript", 2, "Hi there."],
    ]);
    expect(bodies(fetchImpl).every((b) => b.callId === "call-1" && b.attempt === 2)).toBe(true);
  });

  it("tries again when the app is down, and does not retry a report the app refused", async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(response(503)).mockResolvedValue(response(200));
    await make(flaky).emit("answered");
    expect(flaky).toHaveBeenCalledTimes(3);

    const refused = vi.fn(async () => response(400));
    await make(refused).emit("answered");
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("gives up quietly instead of stalling the call", async () => {
    const dead = vi.fn(async () => {
      throw new Error("down");
    });
    const emitter = make(dead);
    await expect(emitter.emit("answered")).resolves.toBe(false);
    expect(dead).toHaveBeenCalledTimes(3);
  });
});

describe("waiting for the pickup", () => {
  const fakeRoom = (participants = []) => {
    const room = new EventEmitter();
    room.remoteParticipants = new Map(participants.map((p) => [p.identity, p]));
    return room;
  };
  const phone = (status) => ({ identity: "callee", attributes: status ? { "sip.callStatus": status } : {} });

  it("reads the call status off the dialled phone", () => {
    expect(callAnswer.callAnswerState([phone("ringing")])).toBeNull();
    expect(callAnswer.callAnswerState([phone("active")])).toBe("answered");
    expect(callAnswer.callAnswerState([phone("hangup")])).toBe("hangup");
  });

  it("resolves the moment the phone is picked up", async () => {
    const callee = phone("ringing");
    const room = fakeRoom([callee]);
    const waiting = callAnswer.waitForCallAnswer(room, 5000);
    callee.attributes["sip.callStatus"] = "active";
    room.emit("participantAttributesChanged");
    await expect(waiting).resolves.toBe("answered");
  });

  it("a hang-up, an empty room or a ring-out is not an answer", async () => {
    const declined = phone("ringing");
    const room = fakeRoom([declined]);
    const waiting = callAnswer.waitForCallAnswer(room, 5000);
    declined.attributes["sip.callStatus"] = "hangup";
    room.emit("participantAttributesChanged");
    await expect(waiting).resolves.toBe("not_answered");

    const left = fakeRoom([phone("ringing")]);
    const leaving = callAnswer.waitForCallAnswer(left, 5000);
    left.remoteParticipants.clear();
    left.emit("participantDisconnected");
    await expect(leaving).resolves.toBe("not_answered");

    await expect(callAnswer.waitForCallAnswer(fakeRoom([phone("ringing")]), 20)).resolves.toBe("not_answered");
  });
});

describe("filing a call that ended on its own", () => {
  const lines = [
    { role: "agent", text: meta.openingLine },
    { role: "callee", text: "She's out. Try after three tomorrow." },
  ];
  const modelSaying = (reply) => ({
    chat: () =>
      (async function* () {
        for (const part of reply.match(/.{1,12}/gs) ?? []) yield { delta: { content: part } };
      })(),
  });
  const ChatContext = { empty: () => ({ addMessage: vi.fn() }) };

  it("reads the model's answer field by field and drops what does not fit", () => {
    expect(
      wrapup.parseWrapUp('Here you go: {"outcome":"call_back_later","summary":"Staff answered.","ownerReached":false,"callbackTime":"After 3 PM tomorrow","interested":"maybe"}'),
    ).toEqual({
      outcome: "call_back_later",
      summary: "Staff answered.",
      ownerReached: false,
      contactName: null,
      callbackTime: "After 3 PM tomorrow",
      bookingSystem: null,
      interested: null,
    });
    expect(wrapup.parseWrapUp('{"outcome":"sold","summary":"x"}').outcome).toBeNull();
    expect(wrapup.parseWrapUp("no json here")).toBeNull();
    expect(wrapup.parseWrapUp("{not json}")).toBeNull();
  });

  it("asks the model once, with the transcript", async () => {
    const filed = await wrapup.wrapUp({
      llmModel: modelSaying('{"outcome":"call_back_later","summary":"Staff answered; owner out.","ownerReached":false}'),
      lines,
      meta,
      ChatContext,
    });
    expect(filed.outcome).toBe("call_back_later");
    expect(wrapup.wrapUpPrompt(lines, meta)).toContain("Them: She's out. Try after three tomorrow.");
  });

  it("files nothing when they never spoke, or when the model fails", async () => {
    expect(await wrapup.wrapUp({ llmModel: modelSaying("{}"), lines: [lines[0]], meta, ChatContext })).toBeNull();
    const broken = { chat: () => { throw new Error("down"); } };
    expect(await wrapup.wrapUp({ llmModel: broken, lines, meta, ChatContext, log: { warn: () => {} } })).toBeNull();
  });
});

describe("who answered: a person or a recording", () => {
  const modelSaying = (reply) => ({
    chat: () =>
      (async function* () {
        yield { delta: { content: reply } };
      })(),
  });
  const ChatContext = { empty: () => ({ addMessage: vi.fn() }) };

  it("takes the model's one word, and reads anything unclear as a person", () => {
    expect(lineCheck.parseLineKind("voicemail")).toBe("voicemail");
    expect(lineCheck.parseLineKind("Menu.")).toBe("menu");
    expect(lineCheck.parseLineKind("person")).toBe("person");
    expect(lineCheck.parseLineKind("It could be voicemail or a menu")).toBe("person");
    expect(lineCheck.parseLineKind("")).toBe("person");
    expect(lineCheck.parseLineKind("recording")).toBe("person");
  });

  it("never hangs up on doubt: no words, a failed model or a slow one all read as a person", async () => {
    expect(await lineCheck.classifyLine({ llmModel: modelSaying("voicemail"), firstHeard: "", ChatContext })).toBe("person");
    const broken = { chat: () => { throw new Error("down"); } };
    expect(await lineCheck.classifyLine({ llmModel: broken, firstHeard: "Hello?", ChatContext, log: { warn: () => {} } })).toBe("person");
    const slow = { chat: () => (async function* () { await new Promise((r) => setTimeout(r, 200)); yield { delta: { content: "voicemail" } }; })() };
    expect(await lineCheck.classifyLine({ llmModel: slow, firstHeard: "You've reached Rosie's.", ChatContext, timeoutMs: 20 })).toBe("person");
    expect(await lineCheck.classifyLine({ llmModel: modelSaying("voicemail"), firstHeard: "You've reached Rosie's.", ChatContext })).toBe("voicemail");
  });
});

describe("small helpers", () => {
  it("Australian numbers go out on the Australian trunk when there is one", () => {
    expect(transfer.trunkFor("+61400000001", { standard: "T1", au: "T2" })).toBe("T2");
    expect(transfer.trunkFor("+61400000001", { standard: "T1", au: "" })).toBe("T1");
    expect(transfer.trunkFor("+14165550199", { standard: "T1", au: "T2" })).toBe("T1");
  });

  it("each try of a call gets its own recording file", () => {
    expect(recording.recordingPath({ callId: "call-1", attempt: 2 })).toBe("outreach/call-1-2.ogg");
  });
});

describe("the agent's tools and call details", () => {
  let OutreachCall;
  let parseMetadata;
  beforeAll(async () => {
    process.env.AGENT_EVENTS_KEY = "test-key";
    ({ OutreachCall } = (await import("../src/call.js")).default);
    ({ parseMetadata } = (await import("../src/agent.js")).default);
  });

  it("only acts on a room the outreach app set up", () => {
    expect(parseMetadata(JSON.stringify(meta))?.callId).toBe("call-1");
    expect(parseMetadata(JSON.stringify({ outbound: true, demoBrandId: "x" }))).toBeNull();
    expect(parseMetadata("not json")).toBeNull();
    expect(parseMetadata("")).toBeNull();
  });

  it("a tool returns nothing, so the model does not speak again after it; the action waits for the sentence to finish", async () => {
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
    const tools = call.buildTools();
    expect(Object.keys(tools)).toEqual(["transfer_to_rep", "end_call"]);

    expect(await tools.transfer_to_rep.execute({ note: "Owner, uses a paper diary." }, {})).toBeUndefined();
    expect(call.pending).toEqual({ type: "transfer", note: "Owner, uses a paper diary." });

    const filed = { outcome: "not_interested", summary: "The owner said no.", ownerReached: true };
    expect(await tools.end_call.execute({ goodbye: "No worries, thanks for your time.", ...filed }, {})).toBeUndefined();
    expect(call.filed).toEqual(filed);
    expect(call.pending).toEqual({ type: "end", goodbye: "No worries, thanks for your time." });
  });

  it("a no from staff is filed as staff turning the call away, not as the owner's answer", async () => {
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
    await call.buildTools().end_call.execute({ goodbye: "Thanks.", outcome: "not_interested", summary: "Staff said no.", ownerReached: false }, {});
    expect(call.filed.outcome).toBe("refused");
  });

  it("a quiet line is ended when a recording answered, with the message for a voicemail only", async () => {
    const quiet = async (kind) => {
      const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
      call.lineKind = kind;
      return { handled: await call.handleQuietLine(), call };
    };
    const voicemail = await quiet("voicemail");
    expect(voicemail.handled).toBe(true);
    expect(voicemail.call.filed.outcome).toBe("voicemail");
    expect(voicemail.call.pending.goodbye).toBe("Please call Adil from Forktime back on oh four one two, three four five, six seven eight.");

    const menu = await quiet("menu");
    expect(menu.call.filed.outcome).toBe("phone_menu");
    expect(menu.call.pending.goodbye).toBeNull();

    const person = await quiet("person");
    expect(person.handled).toBe(false);
    expect(person.call.pending).toBeNull();
  });
});
