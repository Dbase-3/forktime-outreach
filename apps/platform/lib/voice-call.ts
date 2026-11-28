"use client";

// A real voice call with an agent, from the browser: the API files a test call
// and sends the agent into a LiveKit room; we join it with the microphone.
// The orb follows the agent's own state, captions come from LiveKit's live
// transcription, and the call record (saved answers, the step it's on) is read
// from the API while the call runs.

import { useQuery } from "@tanstack/react-query";
import { ConnectionState, ParticipantKind, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Call } from "@outreach/core/types";
import { ApiError, currentWorkspace, ws } from "./api";
import { flush } from "./store";

export type VoicePhase = "idle" | "connecting" | "waiting" | "listening" | "thinking" | "speaking" | "ended";
export type Caption = { who: "agent" | "you"; text: string; final: boolean };

type Started = { callId: string; url: string; token: string };

const AGENT_STATE: Record<string, VoicePhase> = { initializing: "waiting", idle: "listening", listening: "listening", thinking: "thinking", speaking: "speaking" };

export function useVoiceCall(agentId: string) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const room = useRef<Room | null>(null);
  const audio = useRef<HTMLDivElement | null>(null);
  const segments = useRef(new Map<string, number>()); // transcription segment → caption index

  const wsId = currentWorkspace();
  const record = useQuery({
    // Its own key: the call drawer caches { call, contact } under ["call", …], this keeps the bare Call (sharing
    // one key crashed the drawer for a just-made test call, 2026-11-28).
    queryKey: ["test-call", wsId, callId],
    queryFn: () => ws<{ call: Call }>(`/calls/${callId}`).then((r) => r.call),
    enabled: Boolean(callId),
    // Fast while talking; after hanging up, until the agent has filed it.
    refetchInterval: (q) => (phase !== "ended" && phase !== "idle" ? 1500 : q.state.data?.live ? 1000 : false),
  });

  const leave = useCallback(async (next: VoicePhase) => {
    const r = room.current;
    room.current = null;
    if (r) await r.disconnect().catch(() => undefined);
    if (audio.current) audio.current.innerHTML = "";
    setPhase(next);
  }, []);

  const start = useCallback(
    async (contactId: string | null) => {
      setError(null);
      setCaptions([]);
      segments.current.clear();
      setMuted(false);
      setPhase("connecting");
      try {
        await flush(); // the call runs the draft as saved: send any edits first
        const s = await ws<Started>(`/agents/${agentId}/test-call`, { body: { contactId } });
        setCallId(s.callId);
        const r = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        room.current = r;
        r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind !== Track.Kind.Audio || !audio.current) return;
          const el = track.attach();
          audio.current.appendChild(el);
        });
        r.on(RoomEvent.ParticipantAttributesChanged, (_changed, p) => {
          if (p.kind !== ParticipantKind.AGENT) return;
          const state = p.attributes["lk.agent.state"];
          if (state && AGENT_STATE[state]) setPhase(AGENT_STATE[state]);
        });
        r.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
          if (p.kind === ParticipantKind.AGENT) void leave("ended");
        });
        r.on(RoomEvent.Disconnected, () => setPhase((cur) => (cur === "idle" ? cur : "ended")));
        r.registerTextStreamHandler("lk.transcription", async (reader, from) => {
          const who: Caption["who"] = from.identity === r.localParticipant.identity ? "you" : "agent";
          const id = reader.info.attributes?.["lk.segment_id"] ?? reader.info.id;
          let text = "";
          for await (const chunk of reader) {
            text += chunk;
            const final = reader.info.attributes?.["lk.transcription_final"] === "true";
            setCaptions((list) => {
              const at = segments.current.get(id);
              const next = [...list];
              if (at === undefined) {
                segments.current.set(id, next.length);
                next.push({ who, text, final });
              } else next[at] = { who, text, final };
              return next;
            });
          }
        });
        await r.connect(s.url, s.token);
        await r.localParticipant.setMicrophoneEnabled(true);
        if (r.state === ConnectionState.Connected) setPhase((cur) => (cur === "connecting" ? "waiting" : cur));
      } catch (err) {
        await leave("idle");
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error && /permission|notallowed/i.test(err.name + err.message)
              ? "The microphone is blocked. Allow it in the address bar, then try again."
              : "Couldn't start the call. Check your connection and try again.",
        );
      }
    },
    [agentId, leave],
  );

  const end = useCallback(async () => {
    const id = callId;
    await leave("ended");
    if (id) await ws(`/calls/${id}/hang-up`, { method: "POST" }).catch(() => undefined);
  }, [callId, leave]);

  const toggleMute = useCallback(async () => {
    const r = room.current;
    if (!r) return;
    const next = !muted;
    await r.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const reset = useCallback(() => {
    void leave("idle");
    setCallId(null);
    setCaptions([]);
  }, [leave]);

  useEffect(() => () => void room.current?.disconnect(), []);

  return { phase, callId, call: record.data ?? null, error, muted, captions, start, end, toggleMute, reset, audioRef: audio };
}
