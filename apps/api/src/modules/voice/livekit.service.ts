// The API's side of LiveKit: a room per call, the agent sent into it, and a
// pass for the browser on test calls. The audio itself never touches the API.

import { Inject, Injectable } from "@nestjs/common";
import { AccessToken, AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import { ENV, type Env } from "../../config/env";
import { ApiError } from "../../common/errors";

/** The phone's participant in a call's room; the agent talks to this one and nobody else. */
export const PHONE_IDENTITY = "phone";

@Injectable()
export class LiveKitService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** Throws "voice isn't set up" unless LiveKit and the agent's key are configured. */
  ready(): void {
    this.creds();
  }

  private creds() {
    const { LIVEKIT_URL: url, LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = this.env;
    if (!url || !key || !secret || !this.env.AGENT_RUNTIME_KEY) throw new ApiError(503, "voice_off", "Voice calls aren't set up on this server yet.");
    return { url, host: url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), key, secret };
  }

  /** A room for the call, with the agent sent in. Its metadata only names the call: the agent fetches the rest, signed. */
  async startRoom(room: string, callId: string, o: { phone?: boolean } = {}): Promise<void> {
    const c = this.creds();
    // `phone`: the agent waits for the phone's participant (and its pickup), not the first one to join.
    const meta = JSON.stringify({ kind: "platform", callId, ...(o.phone ? { phone: PHONE_IDENTITY } : {}) });
    await new RoomServiceClient(c.host, c.key, c.secret).createRoom({ name: room, emptyTimeout: 60, departureTimeout: 10, metadata: meta });
    await new AgentDispatchClient(c.host, c.key, c.secret).createDispatch(room, this.env.PLATFORM_AGENT_NAME, { metadata: meta });
  }

  /**
   * Ring a phone into the call's room from `from` (a number on `trunk`). Returns once the
   * call is placed, not answered: the agent waits for the pickup and reports it.
   */
  async dial(room: string, o: { to: string; from: string; trunk: string; name?: string }): Promise<void> {
    const c = this.creds();
    await new SipClient(c.host, c.key, c.secret).createSipParticipant(o.trunk, o.to, room, {
      participantIdentity: PHONE_IDENTITY,
      participantName: o.name || "Phone",
      fromNumber: o.from,
      ringingTimeout: 35,
      waitUntilAnswered: false,
      krispEnabled: true,
    });
  }

  /** A pass to listen in on a phone call from the browser: hears both sides, can't speak. */
  async listenerPass(room: string, identity: string, name: string): Promise<{ url: string; token: string }> {
    const c = this.creds();
    const at = new AccessToken(c.key, c.secret, { identity, name, ttl: 15 * 60 });
    at.addGrant({ room, roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false });
    return { url: c.url, token: await at.toJwt() };
  }

  /** A pass for one person to join one room for 15 minutes, with their microphone. */
  async browserPass(room: string, identity: string, name: string): Promise<{ url: string; token: string }> {
    const c = this.creds();
    const at = new AccessToken(c.key, c.secret, { identity, name, ttl: 15 * 60 });
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
    return { url: c.url, token: await at.toJwt() };
  }

  async closeRoom(room: string): Promise<void> {
    const c = this.creds();
    await new RoomServiceClient(c.host, c.key, c.secret).deleteRoom(room).catch(() => undefined);
  }
}
