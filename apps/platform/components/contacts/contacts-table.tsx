"use client";

// The Contacts table: pick columns, sort by any of them, filter with rules,
// search, page, and act on a selection (lists, export, delete).

import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, ListFilter, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { describe } from "@outreach/core/conditions";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { allColumns, type Sort } from "@outreach/core/contacts-table";
import { changeList, contactLists, deleteContacts, exportContacts, queryContacts, rowValuesOf, type Target } from "@/lib/contacts-api";
import { humanize, shortDate } from "@outreach/core/format";
import { useApp } from "@/lib/store";
import type { ConditionGroup, FieldDef } from "@outreach/core/types";
import { outcomeTone } from "../calls/call-overview";
import { Popover } from "../popover";
import { RulesEditor } from "../rules-editor";
import { Badge } from "../ui";

const COLUMNS_KEY = "forktime-contacts-columns";
const DEFAULT_COLUMNS = ["name", "phone", "email", "lists", "last_outcome", "last_call"];

function useVisibleColumns(defs: FieldDef[]): [string[], (keys: string[]) => void] {
  const fallback = useMemo(() => [...DEFAULT_COLUMNS.slice(0, 4), ...defs.filter((d) => d.key !== "first_name").slice(0, 3).map((d) => d.key), ...DEFAULT_COLUMNS.slice(4)], [defs]);
  const [keys, setKeys] = useState<string[]>(fallback);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? "null");
      if (Array.isArray(saved) && saved.length > 0) setKeys(saved);
    } catch {
      // keep defaults
    }
  }, []);
  const save = (next: string[]) => {
    setKeys(next);
    try {
      window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
    } catch {
      // a per-browser convenience; fine to lose
    }
  };
  return [keys, save];
}

export function ContactsTable({ onOpen }: { onOpen: (id: string) => void }) {
  const app = useApp();
  const columns = allColumns(app.fieldDefs);
  const filterable = columns.filter((c) => c.key !== "lists");
  const [visible, setVisible] = useVisibleColumns(app.fieldDefs);
  const [search, setSearch] = useState("");
  const [list, setList] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConditionGroup>({ match: "all", rules: [] });
  const [sort, setSort] = useState<Sort | null>(null); // newest first until a column is picked
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false); // "Select all N" picks everyone the filter matches, on every page
  const queries = useQueryClient();

  // Search waits for a pause in typing; the previous page stays while the next loads.
  const [typed, setTyped] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);
  const activeFilter = { match: filter.match, rules: filter.rules.filter((r) => r.field) };
  const q = { search, list, filter: activeFilter, sort, page, pageSize };
  const listsQuery = useQuery({ queryKey: ["contact-lists", app.workspace.id], queryFn: contactLists });
  const contactsQuery = useQuery({ queryKey: ["contacts", app.workspace.id, q], queryFn: () => queryContacts(q), placeholderData: keepPreviousData });
  const lists = listsQuery.data ?? [];
  const result = { rows: (contactsQuery.data?.rows ?? []).map((contact) => ({ contact, values: rowValuesOf(contact) })), total: contactsQuery.data?.total ?? 0, pages: contactsQuery.data?.pages ?? 1 };
  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ["contacts", app.workspace.id] });
    void queries.invalidateQueries({ queryKey: ["contact-lists", app.workspace.id] });
  };
  const shown = columns.filter((c) => visible.includes(c.key));
  const activeRules = filter.rules.filter((r) => r.field);

  // A new search or filter starts at page 1 and clears the selection.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
  }, [search, list, filter, pageSize]);

  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const pageIds = result.rows.map((r) => r.contact.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const togglePage = () => {
    setAllMatching(false);
    setSelected((s) => (allOnPage ? new Set([...s].filter((id) => !pageIds.includes(id))) : new Set([...s, ...pageIds])));
  };
  const toggleOne = (id: string) => {
    setAllMatching(false);
    setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  };
  const from = result.total === 0 ? 0 : (Math.min(page, result.pages) - 1) * pageSize + 1;
  const to = Math.min(result.total, from + result.rows.length - 1);

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
          <input className="field pl-9" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search name, phone or email" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="field h-9 w-auto py-0" value={list ?? ""} onChange={(e) => setList(e.target.value || null)} aria-label="List">
            <option value="">All contacts</option>
            {lists.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <Popover
            className="w-[min(92vw,620px)]"
            trigger={
              <button type="button" className={clsx("btn-secondary", activeRules.length > 0 && "border-fg/40")}>
                <ListFilter size={15} /> Filter{activeRules.length > 0 && <span className="rounded bg-fg px-1.5 font-mono text-2xs text-background">{activeRules.length}</span>}
              </button>
            }
          >
            <div className="mb-2 text-sm font-medium">Show contacts</div>
            <RulesEditor group={filter} fields={filterable} onChange={setFilter} />
          </Popover>
          <Popover
            align="end"
            className="w-64"
            trigger={
              <button type="button" className="btn-secondary">
                <Columns3 size={15} /> Columns
              </button>
            }
          >
            <div className="mb-1 text-sm font-medium">Columns</div>
            <div className="max-h-80 space-y-0.5 overflow-auto">
              {columns.map((col) => (
                <label key={col.key} className="flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" className="accent-[rgb(var(--fg))]" checked={visible.includes(col.key)} disabled={col.key === "name"} onChange={(e) => setVisible(e.target.checked ? [...visible, col.key] : visible.filter((k) => k !== col.key))} />
                  <span className="flex-1 truncate">{col.label}</span>
                  <span className="font-mono text-2xs text-fg-4">{col.type}</span>
                </label>
              ))}
            </div>
          </Popover>
        </div>
        <span className="text-xs text-fg-3 lg:ml-auto">{contactsQuery.isFetching && <span className="mr-2 text-fg-4">Updating…</span>}{result.total.toLocaleString()} {result.total === 1 ? "contact" : "contacts"}</span>
      </div>

      {activeRules.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {activeRules.map((rule, i) => (
            <span key={i} className="inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface pl-2.5 pr-1 text-xs text-fg-2">
              {i > 0 && <span className="text-fg-4">{filter.match === "all" ? "and" : "or"}</span>}
              {describe(rule, columns.find((c) => c.key === rule.field)?.label ?? rule.field)}
              <button type="button" className="flex h-5 w-5 items-center justify-center rounded-full text-fg-4 hover:bg-muted hover:text-fg" onClick={() => setFilter({ ...filter, rules: filter.rules.filter((r) => r !== rule) })} aria-label="Remove rule">
                <X size={12} />
              </button>
            </span>
          ))}
          <button type="button" className="text-xs text-fg-3 hover:text-fg" onClick={() => setFilter({ match: "all", rules: [] })}>Clear</button>
        </div>
      )}

      {(selected.size > 0 || allMatching) && (
        <BulkBar
          count={allMatching ? result.total : selected.size}
          total={result.total}
          target={allMatching ? { query: { search, list, filter: activeFilter } } : { ids: [...selected] }}
          lists={lists}
          onClear={() => {
            setSelected(new Set());
            setAllMatching(false);
          }}
          onSelectAll={() => setAllMatching(true)}
          onDone={refresh}
        />
      )}

      <div className="card overflow-hidden">
        <div className="max-h-[calc(100dvh-300px)] min-h-64 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="sticky left-0 z-20 w-10 border-b border-line bg-subtle px-3 py-2.5">
                  <input type="checkbox" aria-label="Select this page" className="accent-[rgb(var(--fg))]" checked={allOnPage} onChange={togglePage} />
                </th>
                {shown.map((col, i) => (
                  <th key={col.key} className={clsx("whitespace-nowrap border-b border-line bg-subtle px-3 py-0 text-left font-normal", i === 0 && "sticky left-10 z-20")}>
                    <button type="button" onClick={() => toggleSort(col.key)} className="metric-label inline-flex h-9 items-center gap-1 hover:text-fg">
                      {col.label}
                      {sort?.key === col.key && (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contactsQuery.isLoading &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={`s${i}`}>
                    <td className="border-b border-line px-3 py-3" colSpan={shown.length + 1}><span className="skeleton block h-4 w-2/3 rounded" /></td>
                  </tr>
                ))}
              {result.rows.map(({ contact, values }) => {
                const on = allMatching || selected.has(contact.id);
                return (
                  <tr key={contact.id} onClick={() => onOpen(contact.id)} className="group cursor-pointer">
                    <td className={clsx("sticky left-0 border-b border-line px-3 py-2.5", on ? "bg-[color-mix(in_srgb,rgb(var(--accent))_7%,rgb(var(--surface)))]" : "bg-surface group-hover:bg-subtle")} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${contact.name}`} className="accent-[rgb(var(--fg))]" checked={on} onChange={() => toggleOne(contact.id)} />
                    </td>
                    {shown.map((col, i) => (
                      <td key={col.key} className={clsx("max-w-56 truncate whitespace-nowrap border-b border-line px-3 py-2.5", on ? "bg-[color-mix(in_srgb,rgb(var(--accent))_7%,rgb(var(--surface)))]" : "bg-surface group-hover:bg-subtle", i === 0 && "sticky left-10 font-medium")}>
                        <Cell col={col} value={values[col.key] ?? ""} />
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!contactsQuery.isLoading && result.rows.length === 0 && (
                <tr>
                  <td colSpan={shown.length + 1} className="px-4 py-12 text-center text-sm text-fg-3">No contacts match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-xs text-fg-3">
          <span className="font-mono">{from}–{to} of {result.total}</span>
          <div className="flex items-center gap-2">
            <select className="field h-7 w-auto py-0 text-xs" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">
              {[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
            </select>
            <button type="button" className="btn-icon h-7 w-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
            <span className="font-mono">{Math.min(page, result.pages)} / {result.pages}</span>
            <button type="button" className="btn-icon h-7 w-7" disabled={page >= result.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ col, value }: { col: FieldDef; value: string }) {
  if (!value) return <span className="text-fg-4">—</span>;
  if (col.key === "last_outcome") return <Badge tone={outcomeTone(value)}>{humanize(value)}</Badge>;
  if (col.key === "lists") return <span className="text-fg-2">{value}</span>;
  if (col.type === "date") return <span className="tabular-nums">{shortDate(value)}</span>;
  if (col.type === "number") return <span className="font-mono tabular-nums">{Number(value).toLocaleString()}</span>;
  if (col.type === "phone") return <span className="font-mono text-fg-2">{value}</span>;
  if (col.type === "yesno") return <Badge tone={/^(yes|y|true|1)$/i.test(value) ? "green" : "gray"}>{/^(yes|y|true|1)$/i.test(value) ? "Yes" : "No"}</Badge>;
  if (col.type === "choice") return <Badge>{value}</Badge>;
  return <span>{value}</span>;
}

function BulkBar({ count, total, target, lists, onClear, onSelectAll, onDone }: { count: number; total: number; target: Target; lists: string[]; onClear: () => void; onSelectAll: () => void; onDone: () => void }) {
  const [listName, setListName] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const addToList = (name: string) => {
    if (!name.trim()) return;
    void run(() => changeList(target, name.trim(), true));
    setListName("");
  };
  const removeFromList = (name: string) => void run(() => changeList(target, name, false));
  const remove = () =>
    void run(async () => {
      await deleteContacts(target);
      onClear();
    });

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
      <span className="font-medium">{count.toLocaleString()} selected</span>
      {"ids" in target && count < total && <button type="button" className="text-accent hover:underline" onClick={onSelectAll}>Select all {total.toLocaleString()}</button>}
      <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
      <Popover trigger={<button type="button" className="btn-secondary h-8" disabled={busy}>Add to list</button>} className="w-64">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addToList(listName); }}>
          <input className="field h-8 py-0" value={listName} onChange={(e) => setListName(e.target.value)} placeholder="New list" />
          <button type="submit" className="btn-primary h-8">Add</button>
        </form>
        {lists.length > 0 && <div className="mt-2 space-y-0.5">{lists.map((l) => <button key={l} type="button" onClick={() => addToList(l)} className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted">{l}</button>)}</div>}
      </Popover>
      {lists.length > 0 && (
        <Popover trigger={<button type="button" className="btn-secondary h-8" disabled={busy}>Remove from list</button>} className="w-56">
          {lists.map((l) => <button key={l} type="button" onClick={() => removeFromList(l)} className="flex h-8 w-full items-center rounded-md px-2 text-left text-sm hover:bg-muted">{l}</button>)}
        </Popover>
      )}
      <button type="button" className="btn-secondary h-8" disabled={busy} onClick={() => void run(() => exportContacts(target))}><Download size={14} /> Export</button>
      {confirming ? (
        <span className="flex items-center gap-2">
          <span className="text-rose-700 dark:text-rose-400">Delete {count.toLocaleString()}?</span>
          <button type="button" className="btn h-8 bg-rose-600 text-white hover:bg-rose-700" disabled={busy} onClick={remove}>Delete</button>
          <button type="button" className="btn-ghost h-8" onClick={() => setConfirming(false)}>Cancel</button>
        </span>
      ) : (
        <button type="button" className="btn-ghost h-8 text-rose-600 hover:bg-rose-500/10" onClick={() => setConfirming(true)}><Trash2 size={14} /> Delete</button>
      )}
      {problem && <span className="text-xs text-rose-700 dark:text-rose-400">{problem}</span>}
      <button type="button" className="btn-icon ml-auto h-8 w-8" onClick={onClear} aria-label="Clear selection"><X size={15} /></button>
    </div>
  );
}
