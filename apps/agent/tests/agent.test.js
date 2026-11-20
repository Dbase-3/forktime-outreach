import { EventEmitter } from "node:events";
import { beforeAll, describe, expect, it, vi } from "vitest";
import callAnswer from "../src/callAnswer.js";
import config from "../src/config.js";
import events from "../src/events.js";
import inbound from "../src/inbound.js";
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
  topic: "a large booking he'd like to arrange",
  transferNumber: "+61400000001",
  callbackNumberSpoken: "oh four one two, three four five, six seven eight",
  recordCalls: true,
  openingLine:
    "Hi, this is Sara calling about a possible large-party booking for a customer. This call is recorded. Is the owner or manager around?",
};

describe("the opening line", () => {
  it("is spoken word for word when the app supplies it", () => {
    expect(opening.resolveOpeningLine(meta)).toBe(meta.openingLine);
  });

  it("keeps an operator-written welcome and falls back only when it is missing", () => {
    for (const line of ["Hi, I'd like to make a large booking. Is the owner around?", "Hi, this is Sara calling for Adil."]) {
      const spoken = opening.resolveOpeningLine({ ...meta, openingLine: line });
      expect(spoken).toBe(line);
    }
    expect(opening.resolveOpeningLine({ ...meta, openingLine: "" })).toBe(
      "Hi, this is Sara, calling about a possible large-party booking for a customer. This call is recorded. Is the owner or manager around?",
    );
  });
});

describe("the agent's instructions", () => {
  const text = prompt.buildInstructions(meta, meta.openingLine);

  it("keeps the customer unnamed and knows the opening line is already said", () => {
    expect(text).toContain("The enquiry is for an unnamed customer.");
    expect(text).not.toContain("on behalf of Adil Khan");
    expect(text).toContain(`You have already said, word for word: "${meta.openingLine}"`);
    expect(text).toContain("You are talking to: Rosie's Diner.");
  });

  it("keeps customer details confidential, and answers directly when asked about AI", () => {
    expect(text).toContain("you have no date, party size or budget");
    expect(text).toContain("customer's details are confidential");
    expect(text).toContain("I'm an AI assistant with Forktime");
    expect(text).not.toContain("Adil is looking for");
  });

  it("teach it to say goodbye through the tool, and what to do with a machine that talks back", () => {
    expect(text).toContain("Another AI assistant or a phone system that answers for the restaurant");
    expect(text).toContain("Your last words go in its goodbye field");
  });

  it("take a no, and a busy owner, at their word", () => {
    expect(text).toContain("Never ask again after a no.");
    expect(text).toContain("never offer to connect anyone now");
  });

  it("carry what they said at pickup, when it is known", () => {
    expect(text).not.toContain("When they picked up");
    expect(prompt.buildInstructions(meta, meta.openingLine, { firstHeard: "Luigi's, owner speaking." })).toContain(
      'When they picked up, before you spoke, they said: "Luigi\'s, owner speaking."',
    );
  });

  it("captures the owner's name, asks the three questions, then makes the Forktime mention", () => {
    expect(text).toContain('First ask their name, once: "May I ask who I\'m speaking with?"');
    expect(text).toContain("Save their answer as contactName");
    expect(text).toContain('"Do you take large bookings?"');
    expect(text).toContain('"Roughly how many people can you seat?"');
    expect(text).toContain('"And do you have vegetarian or vegan options?"');
    expect(text).toContain("outcome not_a_fit");
    expect(text).toContain("I'm an AI assistant from Forktime");
    expect(text).toContain("Clearly yes, or they ask to talk to someone from Forktime: call transfer_to_rep");
  });

  it("say the call-back number slowly and offer to repeat it, never hang up on it", () => {
    expect(text).toContain("I'll say it slowly");
    expect(text).toContain("Would you like me to say that again?");
    expect(text).toContain("Only then end the call");
  });

  it("an inbound call-back says so, confirms who it is, and carries what was noted before", () => {
    const inbound = prompt.buildInstructions({ ...meta, direction: "inbound" }, "Thanks for calling back.", { previous: "Owner of Rosie's seats 40 and takes large bookings." });
    expect(inbound).toContain("Someone is calling back about a previous booking enquiry");
    expect(inbound).toContain('Confirm it: "Am I speaking with the owner?"');
    expect(inbound).toContain("Owner of Rosie's seats 40 and takes large bookings.");
    expect(inbound).toContain("Do not ask again anything already answered");
    expect(text).not.toContain("Someone is calling you back");
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
      takesLargeBookings: null,
      seats: null,
      vegetarianVegan: null,
      interestedInSystem: null,
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
    const transferred = wrapup.wrapUpPrompt([...lines, { role: "system", text: "Connected to Adil Khan." }], meta);
    expect(transferred).toContain("(Call note): Connected to Adil Khan.");
    expect(transferred).toContain("if one says they were connected to Adil Khan, the summary says so");
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

describe("the voice for a speaking speed", () => {
  it("normal speed is the natural model, which only takes stability", () => {
    for (const speed of [1, undefined, null, "fast", 0.8]) {
      expect(config.ttsOptions(speed)).toEqual({ encoding: "pcm_16000", model: "eleven_v4_turbo", voiceSettings: { stability: 0.6 } });
    }
  });

  it("faster is the model that takes a speed, never past its limit", () => {
    expect(config.ttsOptions(1.2)).toEqual({
      encoding: "pcm_16000",
      model: "eleven_flash_v2_5",
      voiceSettings: { stability: 0.6, similarity_boost: 0.75, style: 0, use_speaker_boost: false, speed: 1.2 },
    });
    expect(config.ttsOptions(1.1).voiceSettings.speed).toBe(1.1);
    expect(config.ttsOptions(3).voiceSettings.speed).toBe(1.2);
  });
});

describe("which voice company speaks", () => {
  it("Fish Audio takes the speed itself, within normal to 1.2, on its best model", () => {
    process.env.FISH_API_KEY = "fish-key";
    const fish = config.voiceSetup({ provider: "fishaudio", voiceId: "abc", voiceSpeed: 1.1 });
    expect(fish).toEqual({
      provider: "fishaudio",
      options: { apiKey: "fish-key", voiceId: "abc", model: "s2.1-pro", sampleRate: 16000, latencyMode: "low", speed: 1.1, temperature: 0.6, topP: 0.7 },
    });
    expect(config.voiceSetup({ provider: "fishaudio", voiceId: "abc", voiceSpeed: 3 }).options.speed).toBe(1.2);
    expect(config.voiceSetup({ provider: "fishaudio", voiceId: "abc", voiceSpeed: 0.5 }).options.speed).toBe(1);
  });

  it("anything else is ElevenLabs, with its own model rules", () => {
    const eleven = config.voiceSetup({ provider: undefined, voiceId: "xyz", voiceSpeed: 1.2 });
    expect(eleven.provider).toBe("elevenlabs");
    expect(eleven.options).toMatchObject({ voiceId: "xyz", model: "eleven_flash_v2_5" });
    expect(eleven.options.voiceSettings.speed).toBe(1.2);
  });
});

describe("an inbound call-back", () => {
  it("reads who rang and which number they rang from the phone participant", () => {
    expect(inbound.inboundNumbers({ attributes: { "sip.phoneNumber": "+923131083726", "sip.trunkPhoneNumber": "+14184313732" } })).toEqual({
      phone: "+923131083726",
      calledNumber: "+14184313732",
    });
    expect(inbound.inboundNumbers({ attributes: { "sip.trunkPhoneNumber": "+14184313732" } })).toEqual({ phone: "", calledNumber: "+14184313732" });
    expect(inbound.inboundNumbers({ attributes: {} })).toBeNull();
    expect(inbound.inboundNumbers(undefined)).toBeNull();
  });

  it("asks the app with the agent key, sends a hidden number as unknown, and gives up quietly", async () => {
    const ok = vi.fn(async () => ({ ok: true, json: async () => ({ callId: "c1", meta: { callId: "c1" } }) }));
    const found = await inbound.fetchInbound({ baseUrl: "http://app", key: "k", phone: "", calledNumber: "+1418", roomName: "r", fetchImpl: ok });
    expect(found).toEqual({ callId: "c1", meta: { callId: "c1" } });
    expect(ok.mock.calls[0][0]).toBe("http://app/api/agent/inbound");
    expect(ok.mock.calls[0][1].headers["x-agent-key"]).toBe("k");
    expect(JSON.parse(ok.mock.calls[0][1].body)).toEqual({ phone: "unknown", calledNumber: "+1418", roomName: "r" });

    const log = { warn: () => {} };
    const refused = vi.fn(async () => ({ ok: false, status: 401 }));
    expect(await inbound.fetchInbound({ baseUrl: "http://app", key: "k", phone: "+1", roomName: "r", fetchImpl: refused, log })).toBeNull();
    const down = vi.fn(async () => { throw new Error("down"); });
    expect(await inbound.fetchInbound({ baseUrl: "http://app", key: "k", phone: "+1", roomName: "r", fetchImpl: down, log })).toBeNull();
  });
});

describe("small helpers", () => {
  it("Australian numbers go out on the Australian trunk when there is one", () => {
    expect(transfer.trunkFor("+61400000001", { standard: "T1", au: "T2" })).toBe("T2");
    expect(transfer.trunkFor("+61400000001", { standard: "T1", au: "" })).toBe("T1");
    expect(transfer.trunkFor("+14165550199", { standard: "T1", au: "T2" })).toBe("T1");
  });

  it("each try of a call gets its own recording file, with a known address", () => {
    expect(recording.recordingPath({ callId: "call-1", attempt: 2 })).toBe("outreach/call-1-2.ogg");
    expect(recording.recordingUrl({ callId: "call-1", attempt: 2 }, "https://files.example")).toBe("https://files.example/outreach/call-1-2.ogg");
    expect(recording.recordingUrl({ callId: "call-1", attempt: 2 }, "")).toBeNull();
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

  it("what they say before the opening line is kept, judged once and never answered by the model", async () => {
    const said = [];
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
    call.emitter = { line: (role, text) => said.push(`${role}: ${text}`) };
    call.llm = { chat: () => (async function* () { yield { delta: { content: "person" } }; })() };
    const updated = [];
    call.agent = { updateInstructions: async (text) => updated.push(text) };
    call.session = { say: vi.fn(() => ({ waitForPlayout: () => new Promise(() => {}) })) };

    call.onEarlyWords("Hello?");
    call.onEarlyWords("  Hello, who is this? ");
    call.onEarlyWords("");

    expect(said).toEqual(["callee: Hello?", "callee: Hello, who is this?"]);
    expect(call.firstHeard).toBe("Hello?");
    expect(await call.lineCheck).toBe("person");
    expect(updated).toHaveLength(1);
    expect(updated[0]).toContain('they said: "Hello?"');
    // The opening line is said once, however many times they say hello.
    expect(call.session.say).toHaveBeenCalledTimes(1);
    expect(call.session.say.mock.calls[0][0]).toBe(meta.openingLine);
    expect(call.session.say.mock.calls[0][1]).toMatchObject({ allowInterruptions: false, addToChatCtx: true });
  });

  it("an inbound caller is told apart from the dialled phone by who leaves", () => {
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta: { ...meta, direction: "inbound", previousNote: "seats: 60" }, vad: null });
    call.calleeIdentity = "sip_+923131083726";
    const finalize = vi.spyOn(call, "finalize").mockImplementation(() => {});
    call.onParticipantLeft({ identity: "callee" });
    expect(finalize).not.toHaveBeenCalled();
    call.onParticipantLeft({ identity: "sip_+923131083726" });
    expect(finalize).toHaveBeenCalledWith("callee_hung_up");
    expect(call.previousNote).toBe("seats: 60");
  });

  it("the opening line uses the audio made while it rang, when there is some", async () => {
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
    call.session = { say: vi.fn(() => ({ waitForPlayout: () => new Promise(() => {}) })) };
    call.openingFrames = [{ frame: 1 }, { frame: 2 }];
    call.sayOpening();
    const { audio } = call.session.say.mock.calls[0][1];
    const reader = audio.getReader();
    expect((await reader.read()).value).toEqual({ frame: 1 });
    expect((await reader.read()).value).toEqual({ frame: 2 });
    expect((await reader.read()).done).toBe(true);
  });

  it("a no from staff is filed as staff turning the call away, not as the owner's answer", async () => {
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
    await call.buildTools().end_call.execute({ goodbye: "Thanks.", outcome: "not_interested", summary: "Staff said no.", ownerReached: false }, {});
    expect(call.filed.outcome).toBe("refused");
  });

  it("an owner callback is only filed when an owner was reached", async () => {
    const file = async (ownerReached) => {
      const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
      await call.buildTools().end_call.execute({ goodbye: "Thanks.", outcome: "owner_callback", summary: "x", ownerReached }, {});
      return call.filed.outcome;
    };
    expect(await file(false)).toBe("call_back_later");
    expect(await file(true)).toBe("owner_callback");
    const later = new OutreachCall({ ctx: { room: { name: "room" } }, meta, vad: null });
    await later.buildTools().end_call.execute({ goodbye: "Thanks.", outcome: "call_back_later", summary: "x", ownerReached: true }, {});
    expect(later.filed.outcome).toBe("owner_callback");
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
    expect(voicemail.call.pending.goodbye).toBe("This is Sara calling about a possible large-party booking. Please call us back when you can. Thank you.");

    const menu = await quiet("menu");
    expect(menu.call.filed.outcome).toBe("phone_menu");
    expect(menu.call.pending.goodbye).toBeNull();

    const person = await quiet("person");
    expect(person.handled).toBe(false);
    expect(person.call.pending).toBeNull();
  });
});
