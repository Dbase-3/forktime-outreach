"use client";

// Every number in the workspace and the agent using it (one agent per number).
// Get another number here, or from an agent's Config. A number no agent uses
// can be released.

import { Phone, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { relativeTime } from "@outreach/core/format";
import { numberOwner } from "@outreach/core/numbers";
import { releaseNumber } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { GetNumber, describeNumber } from "@/components/numbers/number-picker";
import { Popover } from "@/components/popover";
import { EmptyState, Modal, PageHeader } from "@/components/ui";

export default function NumbersPage() {
  const app = useApp();
  const [getting, setGetting] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);
  const getButton = <button type="button" className="btn-primary" onClick={() => setGetting(true)}><Plus size={15} /> Get a number</button>;
  const free = app.numbers.filter((n) => !numberOwner(app.flows, n.id)).length;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Numbers" subtitle="Each number belongs to one agent: it calls from it and answers calls to it." actions={getButton} />
      {app.numbers.length === 0 ? (
        <EmptyState icon={<Phone size={20} />} title="No numbers yet" body="Get a number so your agents can make and answer calls." action={getButton} />
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-3">{app.numbers.length} {app.numbers.length === 1 ? "number" : "numbers"} · {free} not in use</p>
          <div className="card overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-subtle/60 text-left">
                <tr>
                  <th className="metric-label px-4 py-2.5 font-normal">Number</th>
                  <th className="metric-label px-4 py-2.5 font-normal">Agent</th>
                  <th className="metric-label hidden w-32 px-4 py-2.5 font-normal sm:table-cell">Added</th>
                  <th className="w-14 px-2 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {app.numbers.map((n) => {
                  const owner = numberOwner(app.flows, n.id);
                  return (
                    <tr key={n.id}>
                      <td className="px-4 py-3">
                        <span className="block truncate font-mono font-medium">{n.display}</span>
                        <span className="block truncate text-xs text-fg-3">{describeNumber(n)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {owner ? <Link href={`/agents/${owner.id}`} className="block truncate font-medium hover:underline">{owner.name}</Link> : <span className="text-fg-3">Not in use</span>}
                      </td>
                      <td className="hidden px-4 py-3 text-fg-3 sm:table-cell">{relativeTime(n.addedAt)}</td>
                      <td className="px-2 py-3 text-right">
                        {!owner && (
                          <Popover
                            align="end"
                            className="w-64"
                            open={releasing === n.id}
                            onOpenChange={(o) => setReleasing(o ? n.id : null)}
                            trigger={<button type="button" className="btn-icon h-8 w-8 hover:text-rose-600" aria-label={`Release ${n.display}`}><Trash2 size={15} /></button>}
                          >
                            <div className="text-sm font-medium">Release {n.display}?</div>
                            <p className="mt-1 text-xs text-fg-3">It leaves your workspace and may not be available again.</p>
                            <div className="mt-3 flex justify-end gap-2">
                              <button type="button" className="btn-ghost h-8 px-3 text-sm" onClick={() => setReleasing(null)}>Keep</button>
                              <button
                                type="button"
                                className="btn-primary h-8 px-3 text-sm"
                                onClick={async () => {
                                  try {
                                    await releaseNumber(n.id);
                                  } finally {
                                    setReleasing(null);
                                  }
                                }}
                              >
                                Release
                              </button>
                            </div>
                          </Popover>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Modal open={getting} onClose={() => setGetting(false)} title="Get a number" description="Pick where people will see you calling from.">
        <GetNumber taken={app.numbers.map((n) => n.e164)} onAdded={() => setGetting(false)} />
      </Modal>
    </div>
  );
}
