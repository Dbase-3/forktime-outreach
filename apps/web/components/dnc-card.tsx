"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/api";
import { dayAndTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

/** Numbers that are never dialled again, whoever adds them to the queue. */
export function DncCard() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const list = useQuery({ queryKey: ["dnc"], queryFn: client.dnc });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["dnc"] });
  const add = useMutation({
    mutationFn: (value: string) => client.addDnc(value),
    onSuccess: () => {
      setPhone("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (value: string) => client.removeDnc(value), onSuccess: refresh });
  const entries = list.data?.entries ?? [];

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-gray-900">Do-not-call list</h2>
      <p className="mt-1 text-xs text-gray-500">
        These numbers are never dialled. The agent adds a number itself when someone asks not to be called again.
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (phone.trim()) add.mutate(phone);
        }}
      >
        <input className="field" placeholder="Phone number" aria-label="Phone number to never call" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button type="submit" className="btn-secondary whitespace-nowrap" disabled={add.isPending || !phone.trim()}>
          Add number
        </button>
      </form>
      {add.error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {(add.error as Error).message}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No numbers on the list.</p>
      ) : (
        <ul className="mt-4 divide-y divide-gray-100">
          {entries.map((entry) => (
            <li key={entry._id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block text-sm text-gray-900">{formatPhone(entry.phone)}</span>
                <span className="block truncate text-xs text-gray-500">
                  {entry.reason} · {dayAndTime(entry.addedAt)}
                </span>
              </span>
              <button type="button" className="text-xs text-gray-600 underline hover:text-gray-900" disabled={remove.isPending} onClick={() => remove.mutate(entry.phone)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
