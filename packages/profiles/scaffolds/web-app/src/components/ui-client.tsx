"use client";
/**
 * The interactive parts of the Ledger kit. Import them from "@/components/ui-client" in any page;
 * pass plain data (strings, numbers), never functions, from a server page.
 */
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Badge, Button, EmptyState, Input, Select, money, number, type Tone } from "./ui";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export type Cell = string | number | null;

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  /** How the value is shown. Dates are YYYY-MM-DD strings or millisecond timestamps. */
  format?: "text" | "money" | "number" | "date" | "datetime";
  /** Offer a filter with each distinct value of this column. */
  filter?: boolean;
  /** Show the value as a Badge with the tone given for that value. */
  badge?: Record<string, Tone>;
  /** Set false for columns that make no sense to sort. */
  sortable?: boolean;
}

function show(value: Cell, c: Column): ReactNode {
  if (value === null || value === "") return <span className="text-muted">—</span>;
  if (c.badge) return <Badge tone={c.badge[String(value)] ?? "neutral"}>{value}</Badge>;
  switch (c.format) {
    case "money":
      return <span className="font-semibold tabular-nums">{money(Number(value))}</span>;
    case "number":
      return <span className="tabular-nums">{number(Number(value))}</span>;
    case "date":
    case "datetime": {
      const d = typeof value === "number" ? new Date(value) : new Date(String(value).length === 10 ? `${value}T00:00:00` : String(value));
      if (Number.isNaN(d.getTime())) return String(value);
      return d.toLocaleString("en-GB", c.format === "date" ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    }
    default:
      return String(value);
  }
}

/**
 * A list people search, filter, sort and page through. Rows open a page when `rowHref` names the
 * row field holding its link. On a phone each row is a small card; on wider screens, a table.
 */
export function DataTable({
  columns,
  rows,
  rowHref,
  searchLabel = "Search",
  pageSize = 20,
  emptyTitle = "Nothing here yet",
  emptyText,
}: {
  columns: Column[];
  rows: Record<string, Cell>[];
  rowHref?: string;
  searchLabel?: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | undefined>();
  const [page, setPage] = useState(0);

  const filterable = columns.filter((c) => c.filter);
  const options = useMemo(() => Object.fromEntries(filterable.map((c) => [c.key, [...new Set(rows.map((r) => r[c.key]).filter((v) => v !== null && v !== "").map(String))].sort()])), [rows, filterable]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows.filter((r) => (!q || columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q))) && Object.entries(filters).every(([k, v]) => !v || String(r[k] ?? "") === v));
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (x === y) return 0;
        if (x === null || x === "") return 1;
        if (y === null || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
      });
    }
    return out;
  }, [rows, columns, query, filters, sort]);

  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = shown.slice(current * pageSize, current * pageSize + pageSize);
  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : undefined));
  };

  if (rows.length === 0) return <EmptyState title={emptyTitle}>{emptyText}</EmptyState>;

  const open = (r: Record<string, Cell>) => (rowHref && r[rowHref] ? String(r[rowHref]) : undefined);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-end gap-3 border-b border-line/70 px-5 py-4">
        <label className="flex w-full flex-col gap-1.5 text-sm font-medium sm:w-auto sm:min-w-48 sm:flex-1">
          <span aria-hidden="true">{searchLabel}</span>
          <Input
            type="search"
            aria-label={searchLabel}
            value={query}
            placeholder="Type to search"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </label>
        {filterable.map((c) => (
          <label key={c.key} className="flex min-w-[8.5rem] flex-1 flex-col gap-1.5 text-sm font-medium sm:max-w-56 sm:flex-none sm:basis-40">
            <span aria-hidden="true">{c.label}</span>
            <Select
              aria-label={`Show only this ${c.label.toLowerCase()}`}
              value={filters[c.key] ?? ""}
              onChange={(e) => {
                setFilters((f) => ({ ...f, [c.key]: e.target.value }));
                setPage(0);
              }}
            >
              <option value="">All</option>
              {options[c.key]?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="No matches">Try fewer words, or clear a filter.</EmptyState>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col p-0 sm:hidden">
            {slice.map((r, i) => {
              const href = open(r);
              const body = (
                <div className="flex flex-col gap-1 px-5 py-3.5">
                  <span className="text-[15px] font-semibold">{show(r[columns[0]!.key] ?? null, { ...columns[0]!, badge: undefined })}</span>
                  {columns.slice(1).map((c) => (
                    <span key={c.key} className="flex justify-between gap-3 text-sm">
                      <span className="text-muted">{c.label}</span>
                      <span className="text-right">{show(r[c.key] ?? null, c)}</span>
                    </span>
                  ))}
                </div>
              );
              return (
                <li key={i} className="border-b border-line/70 last:border-b-0">
                  {href ? (
                    <Link href={href} className="block text-ink no-underline hover:bg-ground">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined} className={cx("border-b border-line px-5 py-2.5 text-[13px] font-semibold text-muted", c.align === "right" ? "text-right" : "text-left")}>
                      {c.sortable === false ? (
                        c.label
                      ) : (
                        <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex min-h-8 items-center gap-1 border-0 bg-transparent p-0 font-semibold text-muted hover:text-ink">
                          {c.label}
                          <span aria-hidden="true" className="text-[10px]">{sort?.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r, i) => {
                  const href = open(r);
                  return (
                    <tr key={i} className={cx("border-b border-line/70 last:border-b-0", href && "relative hover:bg-ground")}>
                      {columns.map((c, j) => (
                        <td key={c.key} className={cx("px-5 py-3 align-middle", c.align === "right" && "text-right")}>
                          {j === 0 && href ? (
                            <Link href={href} className="font-semibold text-ink no-underline after:absolute after:inset-0">
                              {show(r[c.key] ?? null, c)}
                            </Link>
                          ) : (
                            show(r[c.key] ?? null, c)
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 px-5 py-3 text-sm text-muted">
        <span>
          {shown.length === rows.length ? `${rows.length} in all` : `${shown.length} of ${rows.length}`}
          {pages > 1 && ` · page ${current + 1} of ${pages}`}
        </span>
        {pages > 1 && (
          <span className="flex gap-2">
            <Button variant="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>
              Previous
            </Button>
            <Button variant="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
              Next
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

/** A button that opens a dialog (a short form or a confirmation) over the page. */
export function Dialog({ trigger, title, children, variant = "secondary" }: { trigger: string; title: string; children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant={variant} onClick={() => ref.current?.showModal()}>
        {trigger}
      </Button>
      <dialog ref={ref} aria-label={title} className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink backdrop:bg-ink/40">
        <div className="flex items-center justify-between gap-3 border-b border-line/70 px-5 py-4">
          <h2 className="m-0 text-[17px] font-semibold">{title}</h2>
          <Button variant="ghost" onClick={() => ref.current?.close()}>
            Close
          </Button>
        </div>
        <div className="p-5">{children}</div>
      </dialog>
    </>
  );
}

/** A link someone must pass on (an invitation), with a Copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** The submit button of a form: disabled with a "working" label while the form is being sent. */
export function SubmitButton({ children, pending = "Saving…", variant = "primary", full }: { children: ReactNode; pending?: string; variant?: "primary" | "secondary" | "danger"; full?: boolean }) {
  const status = useFormStatus();
  return (
    <Button type="submit" variant={variant} full={full} disabled={status.pending} aria-disabled={status.pending}>
      {status.pending ? pending : children}
    </Button>
  );
}
