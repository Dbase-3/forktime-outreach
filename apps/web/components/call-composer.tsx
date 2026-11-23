"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { client, type AddResult, type SettingsView } from "@/lib/api";
import { formatPhone } from "@/lib/phone";
import type { ImportPreviewEntry } from "@/lib/imports";

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
  const [preview, setPreview] = useState<ImportPreviewEntry[] | null>(null);
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (text: string) => client.addNumbers(workspaceId as string, text),
    onSuccess: (result) => {
      if (result.added) setNumbers(result.invalid.join("\n"));
      queryClient.invalidateQueries({ queryKey: ["calls", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["queue", workspaceId] });
    },
  });
  const parseFile = useMutation({
    mutationFn: (file: File) => client.parseImport(workspaceId as string, file),
    onSuccess: (result) => setPreview(result.entries),
  });
  const addReviewed = useMutation({
    mutationFn: (entries: Array<{ label: string; phone: string }>) => client.addEntries(workspaceId as string, entries),
    onSuccess: () => {
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ["calls", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["queue", workspaceId] });
    },
  });
  const ready = preview?.filter((entry) => entry.valid) ?? [];
  const editPreview = (index: number, patch: Partial<ImportPreviewEntry>) => {
    setPreview((current) => current?.map((entry, row) => (row === index ? { ...entry, ...patch, valid: true, problem: null } : entry)) ?? null);
  };
  const removePreview = (index: number) => setPreview((current) => current?.filter((_, row) => row !== index) ?? null);

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

      <section className="card p-4">
        <label htmlFor="restaurant-file" className="text-sm font-medium text-gray-900">
          Import a restaurant file
        </label>
        <p className="hint mb-3">Drop in a PDF, Word document, spreadsheet, image, CSV, or text file. Grok extracts the restaurant names and numbers; you review them before they are added.</p>
        <label className="btn-secondary flex w-full cursor-pointer justify-center" htmlFor="restaurant-file">
          <FileUp className="h-4 w-4" />
          {parseFile.isPending ? "Reading file with Grok…" : "Choose a file"}
        </label>
        <input
          id="restaurant-file"
          type="file"
          className="sr-only"
          disabled={!workspaceId || parseFile.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file && workspaceId) parseFile.mutate(file);
            event.currentTarget.value = "";
          }}
        />
        <p className="mt-2 text-xs text-gray-500">Files are processed for this import only and deleted afterwards. Maximum 4 MB.</p>
        {parseFile.error && <p role="alert" className="mt-2 text-xs text-red-700">{(parseFile.error as Error).message}</p>}

        {preview && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium text-gray-900">Review imported contacts</h2>
              <span className="text-xs text-gray-500">{ready.length} ready</span>
            </div>
            {preview.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No restaurant contacts were found. Try a clearer file or paste the numbers instead.</p>
            ) : (
              <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
                {preview.map((entry, index) => (
                  <div key={`${entry.phone}-${index}`} className="rounded-md border border-gray-200 p-2">
                    <div className="flex gap-2">
                      <input aria-label="Restaurant name" className="field min-w-0 flex-1 py-1.5 text-xs" value={entry.label} placeholder="Restaurant name" onChange={(event) => editPreview(index, { label: event.target.value })} />
                      <button type="button" className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Remove imported row" onClick={() => removePreview(index)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <input aria-label="Phone number" className="field mt-1 py-1.5 font-mono text-xs" value={entry.phone} onChange={(event) => editPreview(index, { phone: event.target.value })} />
                    {entry.problem && <p className="mt-1 text-xs text-amber-700">{entry.problem} — edit or remove this row.</p>}
                  </div>
                ))}
              </div>
            )}
            <button type="button" className="btn-primary mt-3 w-full" disabled={!ready.length || addReviewed.isPending || !workspaceId} onClick={() => addReviewed.mutate(ready.map(({ label, phone }) => ({ label, phone })))}>
              <Plus className="h-4 w-4" />
              {addReviewed.isPending ? "Adding reviewed contacts…" : `Add ${ready.length} reviewed contact${ready.length === 1 ? "" : "s"}`}
            </button>
            {addReviewed.data && <p className="mt-2 text-xs text-gray-600">{resultLine(addReviewed.data)}</p>}
            {addReviewed.error && <p role="alert" className="mt-2 text-xs text-red-700">{(addReviewed.error as Error).message}</p>}
          </div>
        )}
      </section>

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
              <dt className="shrink-0 whitespace-nowrap text-gray-500">Calling hours</dt>
              <dd className="text-right text-gray-900">{view.settings.enforceWindow ? view.window : "Any time"}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
