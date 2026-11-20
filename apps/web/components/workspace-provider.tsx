"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { client, type WorkspaceJson } from "@/lib/api";

type WorkspaceContextValue = {
  workspaceId: string | null;
  workspaces: WorkspaceJson[];
  selectWorkspace: (id: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const EMPTY_WORKSPACES: WorkspaceJson[] = [];

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["workspaces"], queryFn: client.workspaces, staleTime: 60_000 });
  const workspaces = query.data?.workspaces ?? EMPTY_WORKSPACES;
  const workspaceId = chosen && workspaces.some((workspace) => workspace._id === chosen) ? chosen : workspaces[0]?._id ?? null;

  useEffect(() => {
    const saved = window.localStorage.getItem("forktime-outreach-workspace");
    if (saved) setChosen(saved);
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaceId,
      workspaces,
      selectWorkspace: (id) => {
        setChosen(id);
        window.localStorage.setItem("forktime-outreach-workspace", id);
      },
    }),
    [workspaceId, workspaces],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("WorkspaceProvider is missing");
  return context;
}
