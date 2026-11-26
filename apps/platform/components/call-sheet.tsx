"use client";

// One call, for review. Modelled on the Forktime dashboard's conversation
// drawer: the recording and the feedback sit ABOVE the tabs (in the drawer's
// fixed subheader), so playback carries on across a tab switch and you can
// read the transcript while you listen.

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { activeLineAt, hasTimeline } from "@outreach/core/call-review";
import type { Call, Contact } from "@outreach/core/types";
import { ws } from "@/lib/api";
import { useApp } from "@/lib/store";
import { AudioPlayer, type PlayerHandle } from "./calls/audio-player";
import { CallFeedbackBar } from "./calls/call-feedback";
import { CallOverview } from "./calls/call-overview";
import { CallTranscript } from "./calls/call-transcript";
import { Badge, Sheet, useLastPresent } from "./ui";

export { outcomeTone } from "./calls/call-overview";

type Tab = "overview" | "transcript";

export type CallDetail = { call: Call; contact: Contact | null };
export const callKey = (workspaceId: string, id: string | null) => ["call", workspaceId, id] as const;

/** One call in full (transcript included), loaded when opened. A live call refreshes every few seconds. */
export function CallSheet({ callId, onClose }: { callId: string | null; onClose: () => void }) {
  const app = useApp();
  const openId = useLastPresent(callId);
  const detail = useQuery({
    queryKey: callKey(app.workspace.id, openId),
    queryFn: () => ws<CallDetail>(`/calls/${openId}`),
    enabled: Boolean(openId),
    refetchInterval: (q) => (q.state.data?.call.live ? 3000 : false),
  });
  const call = detail.data && detail.data.call.id === openId ? detail.data.call : null;
  const contact = call ? detail.data?.contact ?? undefined : undefined;
  const flow = call ? app.flows.find((f) => f.id === call.flowId) : undefined;
  const latest = call;

  const [tab, setTab] = useState<Tab>("overview");
  const [following, setFollowing] = useState(true);
  const [active, setActive] = useState(-1);
  const player = useRef<PlayerHandle>(null);
  const lines = useRef(call?.transcript ?? []);
  lines.current = call?.transcript ?? [];

  // Each call opens on Overview, following on, nothing lit.
  useEffect(() => {
    setTab("overview");
    setFollowing(true);
    setActive(-1);
  }, [call?.id]);

  // Playback reports ~60×/s; state changes only when the lit line does.
  const onTime = useCallback((t: number) => setActive(activeLineAt(lines.current, t)), []);
  const seek = (sec: number) => {
    player.current?.seek(sec, { play: true });
    setFollowing(true);
  };

  const recorded = Boolean(call?.recording);
  const transcriptText = (call?.transcript ?? [])
    .map((l) => `${l.who === "caller" ? "Caller" : l.who === "agent" ? flow?.agent.name ?? "Agent" : "Action"}: ${l.text}`)
    .join("\n");

  const subheader = call ? (
    <div>
      {call.recording && (
        <AudioPlayer key={call.id} ref={player} callId={call.id} url={call.recording.url} durationSec={call.recording.durationSec} transcriptText={transcriptText} onTime={onTime} />
      )}
      {!call.live && latest && <CallFeedbackBar call={latest} />}
      <div className="mt-3 flex gap-5" role="tablist">
        {(["overview", "transcript"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx("-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors", tab === t ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg")}
          >
            {t === "overview" ? "Overview" : "Transcript"}
            {t === "transcript" && call.transcript.length > 0 && <span className="ml-1.5 font-mono text-xs text-fg-4">{call.transcript.filter((l) => l.who !== "action").length}</span>}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <Sheet
      open={callId !== null}
      onClose={onClose}
      title={call ? contact?.name ?? "Unknown caller" : detail.isError ? "Call" : ""}
      titleExtra={call?.live ? <Badge tone="green" dot>Live</Badge> : undefined}
      size="xl"
      subheader={subheader}
    >
      {detail.isError && <p className="text-sm text-fg-2">{detail.error instanceof Error ? detail.error.message : "Couldn't load this call."}</p>}
      {!call && !detail.isError && <div className="space-y-3">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton block h-12 rounded-lg" />)}</div>}
      {call && tab === "overview" && <CallOverview call={call} app={app} contact={contact} />}
      {call && tab === "transcript" && (
        <CallTranscript
          lines={call.transcript}
          agentName={flow?.agent.name ?? "Agent"}
          activeIndex={recorded ? active : -1}
          following={following}
          onFollowingChange={setFollowing}
          canSeek={recorded && hasTimeline(call.transcript)}
          onSeek={seek}
          live={call.live}
        />
      )}
    </Sheet>
  );
}
