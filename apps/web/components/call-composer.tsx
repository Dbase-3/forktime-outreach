"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { client, type AddResult, type SettingsView } from "@/lib/api";
import { formatPhone } from "@/lib/phone";

function resultLine(result: AddResult): string {
  const parts = [`${result.added} added to the queue`];
  if (result.duplicates) parts.push(`${result.duplicates} repeated`);
  if (result.onDoNotCallList) parts.push(`${result.onDoNotCallList} on the do-not-call list`);
  if (result.invalid.length) parts.push(`${result.invalid.length} could not be read`);
  return `${parts.join(", ")}.`;
}

/** Paste numbers in, and see who the calls will come from and what the agent opens with. */
export function CallComposer({ view, workspaceId }: { view: SettingsView | undefined; workspaceId: string | null }) {
  const [numbers, setNumbers] = useState("");
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (text: string) => client.addNumbers(workspaceId as string, text),
    onSuccess: (result) => {
      if (result.added) setNumbers(result.invalid.join("\n"));
      queryClient.invalidateQueries({ queryKey: ["calls", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["queue", workspaceId] });
    },
  });

  return (
    <div className="space-y-4">
      <form
        className="card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (numbers.trim() && workspaceId) add.mutate(numbers);
        }}
      >
        <label htmlFor="numbers" className="text-sm font-medium text-gray-900">
          Add numbers
        </label>
        <p className="hint mb-2">{`One per line. A name beside the number is kept, like "Rosie's Diner, 08 8941 1234".`}</p>
        <textarea
          id="numbers"
          rows={7}
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          placeholder={"Rosie's Diner, 08 8941 1234\n+61 8 8941 5678"}
          className="field font-mono text-[13px]"
        />
        <button type="submit" disabled={add.isPending || !numbers.trim() || !workspaceId} className="btn-primary mt-3 w-full">
          <Plus className="h-4 w-4" />
          {add.isPending ? "Adding…" : "Add to queue"}
        </button>
        {add.data && <p className="mt-2 text-xs text-gray-600">{resultLine(add.data)}</p>}
        {add.data && add.data.invalid.length > 0 && (
          <p className="mt-1 text-xs text-amber-700">The lines left in the box are the ones that could not be read as phone numbers.</p>
        )}
        {add.error && (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {(add.error as Error).message}
          </p>
        )}
      </form>

      {view && (
        <div className="card p-4 text-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-gray-900">What the agent opens with</h2>
            <Link href="/settings" className="text-xs text-gray-600 underline">
              Edit
            </Link>
          </div>
          <p className="mt-2 rounded-md bg-gray-50 p-3 text-[13px] leading-relaxed text-gray-800">“{view.openingLine}”</p>
          <dl className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Calls come from</dt>
              <dd className="text-right text-gray-900">{view.settings.fromNumber ? formatPhone(view.settings.fromNumber) : "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Live requests go to</dt>
              <dd className="text-right text-gray-900">{view.settings.transferNumber ? formatPhone(view.settings.transferNumber) : "Not set"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="shrink-0 whitespace-nowrap text-gray-500">Calling hours</dt>
              <dd className="text-right text-gray-900">{view.settings.enforceWindow ? view.window : "Any time"}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
