"use client";

// One call, for review. Modelled on the Forktime dashboard's conversation
// drawer: the recording and the feedback sit ABOVE the tabs (in the drawer's
// fixed subheader), so playback carries on across a tab switch and you can
// read the transcript while you listen.

import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { activeLineAt, hasTimeline } from "@outreach/core/call-review";
import type { AppState, Call } from "@outreach/core/types";
import { AudioPlayer, type PlayerHandle } from "./calls/audio-player";
import { CallFeedbackBar } from "./calls/call-feedback";
import { CallOverview } from "./calls/call-overview";
import { CallTranscript } from "./calls/call-transcript";
import { Badge, Sheet, useLastPresent } from "./ui";

export { outcomeTone } from "./calls/call-overview";

type Tab = "overview" | "transcript";

export function CallSheet({ call: current, app, onClose }: { call: Call | null; app: AppState; onClose: () => void }) {
  const call = useLastPresent(current);
  const contact = call ? app.contacts.find((c) => c.id === call.contactId) : undefined;
  const flow = call ? app.flows.find((f) => f.id === call.flowId) : undefined;
  const latest = call ? app.calls.find((c) => c.id === call.id) ?? call : null; // feedback edits re-render from the store

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
      open={current !== null}
      onClose={onClose}
      title={contact?.name ?? "Unknown caller"}
      titleExtra={call?.live ? <Badge tone="green" dot>Live</Badge> : undefined}
      size="xl"
      subheader={subheader}
    >
      {call && tab === "overview" && <CallOverview call={call} app={app} />}
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
