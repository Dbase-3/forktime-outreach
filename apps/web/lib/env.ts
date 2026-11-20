// Every environment value the server reads, in one place. A missing value is
// reported by name where it is needed, never replaced by a guess.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (apps/web/.env.local)`);
  return value;
}

export type DialMode = "live" | "dry";

export const env = {
  mongoUri: () => process.env.MONGODB_URI || "mongodb://127.0.0.1:27027/forktime_outreach",
  sessionSecret: () => required("SESSION_SECRET"),
  adminEmail: () => required("ADMIN_EMAIL"),
  adminPassword: () => required("ADMIN_PASSWORD"),
  /** Shared with the voice agent; it signs every event it posts with this. */
  agentEventsKey: () => required("AGENT_EVENTS_KEY"),

  /**
   * "live" places real phone calls. Anything else is a dry run: the app acts
   * a call out on screen and no phone rings.
   */
  dialMode: (): DialMode => (process.env.DIAL_MODE === "live" ? "live" : "dry"),

  livekit: () => ({
    url: required("LIVEKIT_URL").replace("wss://", "https://").replace("ws://", "http://"),
    apiKey: required("LIVEKIT_API_KEY"),
    apiSecret: required("LIVEKIT_API_SECRET"),
  }),
  agentName: () => process.env.OUTREACH_AGENT_NAME || "outreach-agent",
  /** LiveKit outbound trunk ids. Australian numbers use their own when set. */
  outboundTrunkId: () => required("SIP_OUTBOUND_TRUNK_ID"),
  outboundTrunkIdAu: () => process.env.SIP_OUTBOUND_TRUNK_ID_AU || "",

  telnyxApiKey: () => process.env.TELNYX_API_KEY || "",
  elevenLabsApiKey: () => process.env.ELEVENLABS_API_KEY || "",
  xaiApiKey: () => process.env.XAI_API_KEY || "",
};
