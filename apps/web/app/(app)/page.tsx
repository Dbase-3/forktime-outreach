"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CallComposer } from "@/components/call-composer";
import { CallDetail } from "@/components/call-detail";
import { CallList } from "@/components/call-list";
import { QueueBar } from "@/components/queue-bar";
import { client } from "@/lib/api";
import { firstName } from "@/lib/opening-line";
import { useWorkspace } from "@/components/workspace-provider";

export default function CallsPage() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reading the queue also moves it along, so this screen keeps the calls going.
  const queue = useQuery({
    queryKey: ["queue", workspaceId],
    queryFn: () => client.queue(workspaceId as string),
    enabled: !!workspaceId,
    refetchInterval: (query) => (query.state.data?.running || query.state.data?.activeCallId ? 2500 : 10_000),
  });
  const busy = !!queue.data?.running || !!queue.data?.activeCallId;
  const calls = useQuery({ queryKey: ["calls", workspaceId], queryFn: () => client.calls(workspaceId as string), enabled: !!workspaceId, refetchInterval: busy ? 2500 : 10_000 });
  const settings = useQuery({ queryKey: ["settings", workspaceId], queryFn: () => client.settings(workspaceId as string), enabled: !!workspaceId });

  const toggle = useMutation({
    mutationFn: (action: "start" | "pause") => client.setQueue(workspaceId as string, action),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(["queue", workspaceId], snapshot);
      queryClient.invalidateQueries({ queryKey: ["calls", workspaceId] });
    },
  });

  // Follow the call on the line until the operator picks another one.
  const activeId = queue.data?.activeCallId ?? null;
  const [followLive, setFollowLive] = useState(true);
  useEffect(() => {
    setSelectedId(null);
    setFollowLive(true);
  }, [workspaceId]);
  useEffect(() => {
    if (followLive && activeId) setSelectedId(activeId);
  }, [activeId, followLive]);

  const select = (id: string) => {
    setSelectedId(id);
    setFollowLive(id === activeId);
  };

  const repFirstName = firstName(settings.data?.settings.repName ?? "the rep");

  return (
    <div className="space-y-4">
      <QueueBar
        queue={queue.data}
        windowText={settings.data?.window ?? ""}
        error={toggle.error ? (toggle.error as Error).message : null}
        busy={toggle.isPending}
        onToggle={(action) => {
          if (action === "start") setFollowLive(true);
          toggle.mutate(action);
        }}
      />
      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_minmax(0,1.15fr)]">
        <CallComposer view={settings.data} workspaceId={workspaceId} />
        <CallList calls={calls.data?.calls} selectedId={selectedId} repFirstName={repFirstName} onSelect={select} />
        <div className="lg:col-span-2 xl:col-span-1">
          <CallDetail
            callId={selectedId}
            repFirstName={repFirstName}
            agentName={settings.data?.settings.agentName ?? "Agent"}
            workspaceId={workspaceId}
            onSelect={select}
          />
        </div>
      </div>
    </div>
  );
}
