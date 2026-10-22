/**
 * The Ledger UI kit: every page is built from these, so the whole app looks consistent and
 * works well on a phone (44px touch targets, readable type, clear money colours).
 * Server components: no "use client" needed. Pass `className` to adjust spacing only.
 */
import Link from "next/link";
import { cloneElement, isValidElement, useId, type ComponentProps, type ReactElement, type ReactNode } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ---- layout ---------------------------------------------------------------

export interface NavItem {
  href: string;
  label: string;
}

/**
 * The frame of every signed-in screen: brand bar, the main navigation, then the page.
 * On a phone the navigation is one row you can swipe sideways, so the header stays two lines tall.
 */
export function AppShell({ brand, subtitle, nav = [], active, actions, children }: { brand: string; subtitle?: string; nav?: NavItem[]; active?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-7 gap-y-2 px-4 pt-3 sm:flex-nowrap sm:px-6 sm:py-3">
          <div className="flex min-w-0 grow items-center gap-2.5">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-base font-bold text-white">
              {brand.trim().charAt(0).toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-base font-bold tracking-tight">{brand}</span>
              {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
            </span>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2 sm:order-last">{actions}</div>}
          {nav.length > 0 && (
            <nav aria-label="Main" className="-mx-4 flex w-[calc(100%+2rem)] gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:overflow-visible sm:p-0">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active === n.href ? "page" : undefined}
                  className={cx("shrink-0 whitespace-nowrap rounded-full px-3.5 py-2.5 text-sm no-underline", active === n.href ? "bg-primary-tint font-semibold text-primary" : "font-medium text-ink-soft hover:bg-primary-tint/60")}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pb-16 pt-8 sm:px-6">{children}</main>
    </div>
  );
}

/** A simple centred frame for public pages (sign-in, a customer's or parent's page). */
export function PublicShell({ brand, children }: { brand?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ground">
      <main className="mx-auto flex max-w-md flex-col gap-5 px-4 py-10">
        {brand && <p className="text-center text-sm font-semibold text-muted">{brand}</p>}
        {children}
      </main>
    </div>
  );
}

/** Page title with an optional small label above and actions on the right. */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        {eyebrow && <span className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">{eyebrow}</span>}
        <h1 className="m-0 text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
        {description && <p className="m-0 text-[15px] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, padded = true }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 px-5 py-4">
          {title && <h2 className="m-0 text-[17px] font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

/**
 * One row in a list inside a Card (padded = false): avatar, name and detail, then a `status`
 * (a Badge), an `amount` (an Amount) and an `action` (a button). On a phone, status and amount
 * share one line under the name and the action sits below them; on wider screens it is one row
 * with the amounts lined up. Anything else can go in `children`.
 */
export function ListRow({ leading, title, detail, status, amount, action, children }: { leading?: ReactNode; title: ReactNode; detail?: ReactNode; status?: ReactNode; amount?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  const indent = leading ? "pl-14 sm:pl-0" : undefined;
  return (
    <div className="flex flex-col gap-3 border-b border-line/70 px-5 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-4">
        {leading}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold">{title}</span>
          {detail && <span className="text-[13px] text-muted">{detail}</span>}
        </div>
      </div>
      {(status || amount) && (
        <div className={cx("flex items-center justify-between gap-3 sm:justify-end", indent)}>
          {status ?? <span />}
          {amount && <span className="sm:w-24 sm:text-right">{amount}</span>}
        </div>
      )}
      {action && <div className={cx("flex flex-wrap gap-2", indent)}>{action}</div>}
      {children && <div className={cx("flex flex-wrap items-center gap-3", indent)}>{children}</div>}
    </div>
  );
}

/** An amount of money, always shown the same way. `tone` colours it: owed red, paid green. */
export function Amount({ value, tone = "neutral", size = "md" }: { value: number; tone?: "neutral" | "owed" | "paid" | "muted"; size?: "md" | "lg" }) {
  return (
    <span className={cx("font-bold tabular-nums", size === "lg" ? "text-[28px] tracking-tight" : "text-base", tone === "owed" && "text-owed", tone === "paid" && "text-paid", tone === "muted" && "text-muted")}>
      {money(value)}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
  return (
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-tint text-sm font-semibold text-primary">
      {initials || "?"}
    </span>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">{children}</div>;
}

/** A headline number. `tone` colours money: owed red, paid green. `progress` (0–100) adds a bar. */
export function Stat({ label, value, hint, tone = "neutral", progress }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "neutral" | "owed" | "paid"; progress?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      <span className={cx("text-[28px] font-bold tabular-nums tracking-tight", tone === "owed" && "text-owed", tone === "paid" && "text-paid")}>{value}</span>
      {progress !== undefined && <Progress value={progress} label={label} />}
      {hint && <span className="text-[13px] text-muted">{hint}</span>}
    </div>
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-primary-tint">
      <div className="h-2 rounded-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  );
}

// ---- actions --------------------------------------------------------------

type Variant = "primary" | "secondary" | "danger" | "ghost";
const buttonClass = (variant: Variant, full?: boolean) =>
  cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-[18px] text-sm no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    variant === "primary" && "border-0 bg-primary font-semibold text-white hover:bg-primary-hover",
    variant === "secondary" && "border border-line-strong bg-surface font-medium text-ink hover:bg-ground",
    variant === "danger" && "border-0 bg-owed-tint font-semibold text-owed hover:brightness-95",
    variant === "ghost" && "border-0 bg-transparent px-3 font-semibold text-primary hover:bg-primary-tint/60",
    full && "w-full",
  );

export function Button({ variant = "primary", full, className, ...props }: ComponentProps<"button"> & { variant?: Variant; full?: boolean }) {
  return <button type="button" {...props} className={cx(buttonClass(variant, full), className)} />;
}

/** A link that looks like a button. */
export function ButtonLink({ variant = "primary", full, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; full?: boolean }) {
  return <Link {...props} className={cx(buttonClass(variant, full), className)} />;
}

// ---- status ---------------------------------------------------------------

export type Tone = "owed" | "partial" | "paid" | "info" | "neutral";
const toneClass: Record<Tone, string> = {
  owed: "bg-owed-tint text-owed",
  partial: "bg-partial-tint text-partial",
  paid: "bg-paid-tint text-paid",
  info: "bg-primary-tint text-primary",
  neutral: "bg-ground text-ink-soft",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold", toneClass[tone])}>{children}</span>;
}

/** A message after an action, a caution before one, or a problem to fix. Errors are announced to screen readers. */
export function Alert({ tone = "info", children }: { tone?: "success" | "error" | "warning" | "info"; children: ReactNode }) {
  const cls = tone === "success" ? "bg-paid-tint text-paid" : tone === "error" ? "bg-owed-tint text-owed" : tone === "warning" ? "bg-partial-tint text-partial" : "bg-primary-tint text-primary";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-[var(--radius-control)] px-3.5 py-3 text-sm font-medium", cls)}>
      {children}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="m-0 text-[15px] font-semibold">{title}</p>
      {children && <p className="m-0 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Format an amount of Taka the same way everywhere: ৳1,500, or ৳62.50 when there are paisa. */
export function money(amount: number): string {
  const whole = Math.abs(amount - Math.round(amount)) < 0.005;
  const text = Math.abs(amount).toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${amount < -0.004 ? "-" : ""}৳${text}`;
}

/** Format a count or measure the same way everywhere: 1,250 or 2.5. */
export function number(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// ---- forms ----------------------------------------------------------------

const controlClass = (invalid?: boolean) =>
  cx("min-h-11 w-full rounded-[var(--radius-control)] bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70", invalid ? "border-2 border-owed" : "border border-line-strong focus:border-primary");

/**
 * A labelled control with an optional hint or error underneath. Put one Input/Select/Textarea inside.
 * The label points at the control by id, so its accessible name is the label alone (not the options).
 */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const auto = useId();
  const child = isValidElement(children) ? (children as ReactElement<{ id?: string; "aria-describedby"?: string }>) : undefined;
  const id = child?.props.id ?? `f${auto.replace(/:/g, "")}`;
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      {child ? cloneElement(child, { id, ...(note ? { "aria-describedby": noteId } : {}) }) : children}
      {note && (
        <span id={noteId} className={cx("text-[13px] font-normal", error ? "text-owed" : "text-muted")}>
          {note}
        </span>
      )}
    </div>
  );
}

export function Input({ invalid, className, ...props }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input aria-invalid={invalid || undefined} {...props} className={cx(controlClass(invalid), className)} />;
}

export function Select({ invalid, className, ...props }: ComponentProps<"select"> & { invalid?: boolean }) {
  return <select aria-invalid={invalid || undefined} {...props} className={cx(controlClass(invalid), "pr-8", className)} />;
}

export function Textarea({ invalid, className, ...props }: ComponentProps<"textarea"> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} {...props} className={cx(controlClass(invalid), "min-h-24 py-2.5", className)} />;
}

/** A form laid out as a column of fields with the actions at the bottom. */
export function FormStack({ children, ...props }: ComponentProps<"form">) {
  return (
    <form {...props} className={cx("flex flex-col gap-4", props.className)}>
      {children}
    </form>
  );
}

// ---- systems: many sections, many roles -------------------------------------

export interface NavGroup {
  /** Optional heading above the group ("Front desk", "Money"). */
  label?: string;
  items: NavItem[];
}

/**
 * The frame for a system with many sections or more than one role: a sidebar on wide screens, a top bar
 * with a Menu button on phones (no JavaScript needed). Pass only the sections this person may use.
 * `user` shows who is signed in; `signOut` is a form with a button (see app/(app)/layout.tsx).
 */
export function SidebarShell({ brand, subtitle, groups, active, user, signOut, children }: { brand: string; subtitle?: string; groups: NavGroup[]; active?: string; user?: { name: string; role: string }; signOut?: ReactNode; children: ReactNode }) {
  const isActive = (href: string) => active === href || (href !== "/" && !!active?.startsWith(`${href}/`));
  const links = (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <div key={g.label ?? i} className="flex flex-col gap-1">
          {g.label && <span className="px-3 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{g.label}</span>}
          {g.items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? "page" : undefined}
              className={cx("flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm no-underline", isActive(n.href) ? "bg-primary-tint font-semibold text-primary" : "font-medium text-ink-soft hover:bg-primary-tint/60")}
            >
              {n.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
  const who = user && (
    <div className="flex items-center gap-3">
      <Avatar name={user.name} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{user.name}</span>
        <span className="text-xs text-muted">{user.role}</span>
      </span>
    </div>
  );
  const mark = (
    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary text-base font-bold text-white">
      {brand.trim().charAt(0).toUpperCase()}
    </span>
  );
  return (
    <div className="min-h-screen bg-ground lg:flex">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center gap-2.5 px-3">
          {mark}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-base font-bold tracking-tight">{brand}</span>
            {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
          </span>
        </div>
        <div className="flex-1">{links}</div>
        {(who || signOut) && (
          <div className="flex flex-col gap-3 border-t border-line px-3 pt-4">
            {who}
            {signOut}
          </div>
        )}
      </aside>
      <header className="sticky top-0 z-10 border-b border-line bg-surface lg:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
            {mark}
            <span className="min-w-0 grow truncate text-base font-bold tracking-tight">{brand}</span>
            <span className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 text-sm font-medium">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </span>
          </summary>
          <div className="flex max-h-[75vh] flex-col gap-5 overflow-y-auto border-t border-line px-3 py-4">
            {links}
            {(who || signOut) && (
              <div className="flex flex-col gap-3 border-t border-line px-3 pt-4">
                {who}
                {signOut}
              </div>
            )}
          </div>
        </details>
      </header>
      <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
    </div>
  );
}

/** Tabs as links (they work without JavaScript): one per view of the same thing. */
export function Tabs({ tabs, active }: { tabs: NavItem[]; active: string }) {
  return (
    <nav aria-label="Views" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={cx("-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm no-underline", active === t.href ? "border-primary font-semibold text-primary" : "border-transparent font-medium text-ink-soft hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** "From" and "To" dates for a report or a filter; submits as `from` and `to` (YYYY-MM-DD). */
export function DateRangeFields({ from, to, fromLabel = "From", toLabel = "To" }: { from?: string; to?: string; fromLabel?: string; toLabel?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={fromLabel}>
        <Input type="date" name="from" defaultValue={from} />
      </Field>
      <Field label={toLabel}>
        <Input type="date" name="to" defaultValue={to} />
      </Field>
    </div>
  );
}

/** A small read-only table (for a detail page or a print-out). For long lists people search and sort, use DataTable. */
export function SimpleTable({ columns, rows }: { columns: { key: string; label: string; align?: "left" | "right" }[]; rows: Record<string, ReactNode>[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx("border-b border-line px-4 py-2.5 text-[13px] font-semibold text-muted", c.align === "right" ? "text-right" : "text-left")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/70 last:border-b-0">
              {columns.map((c) => (
                <td key={c.key} className={cx("px-4 py-3 align-top", c.align === "right" && "text-right tabular-nums")}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- charts (plain SVG, theme colours, a table for screen readers) -------------

/** Series colours in order. Use at most five; group the rest as "Other". */
export const CHART_COLOURS = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];
type Unit = "money" | "number";
const fmt = (v: number, unit: Unit = "number") => (unit === "money" ? money(v) : number(v));

function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}</tr>
        ))}
      </tbody>
    </table>
  );
}

/** Compare amounts across a few named things (takings per doctor, visits per day of the week). Reads well on a phone. */
export function BarChart({ title, data, unit = "number" }: { title: string; data: { label: string; value: number }[]; unit?: Unit }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {data.length === 0 ? (
        <p className="m-0 text-sm text-muted">Nothing to show yet.</p>
      ) : (
        <div aria-hidden="true" className="flex flex-col gap-2.5">
          {data.map((d) => (
            <div key={d.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_1fr_auto]">
              <span className="truncate text-ink-soft">{d.label}</span>
              <span className="h-3 overflow-hidden rounded-full bg-ground">
                <span className="block h-3 rounded-full" style={{ width: `${max > 0 ? Math.max(2, (d.value / max) * 100) : 0}%`, background: CHART_COLOURS[0] }} />
              </span>
              <span className="text-right font-semibold tabular-nums">{fmt(d.value, unit)}</span>
            </div>
          ))}
        </div>
      )}
      <ChartTable caption={title} head={["", "Value"]} rows={data.map((d) => [d.label, fmt(d.value, unit)])} />
    </figure>
  );
}

/** How something changed over time (takings per day). One to five series sharing the same labels. */
export function LineChart({ title, labels, series, unit = "number" }: { title: string; labels: string[]; series: { name: string; values: number[] }[]; unit?: Unit }) {
  const W = 640;
  const H = 220;
  const pad = { l: 8, r: 8, t: 12, b: 28 };
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const x = (i: number) => pad.l + (labels.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const every = Math.max(1, Math.ceil(labels.length / 7));
  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
        {title}
        {series.length > 1 && (
          <span className="flex flex-wrap gap-3 text-xs font-medium text-ink-soft">
            {series.map((s, i) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: CHART_COLOURS[i % 5] }} />
                {s.name}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      {labels.length === 0 ? (
        <p className="m-0 text-sm text-muted">Nothing to show yet.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden="true">
          {[0, 0.5, 1].map((f) => (
            <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-line)" strokeWidth={1} />
          ))}
          {series.map((s, si) => (
            <g key={s.name}>
              <polyline fill="none" stroke={CHART_COLOURS[si % 5]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
              {s.values.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={3} fill={CHART_COLOURS[si % 5]} />
              ))}
            </g>
          ))}
          {labels.map((l, i) =>
            i % every === 0 || i === labels.length - 1 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} fontSize={12} fill="var(--color-muted)">
                {l}
              </text>
            ) : null,
          )}
        </svg>
      )}
      <ChartTable caption={title} head={["", ...series.map((s) => s.name)]} rows={labels.map((l, i) => [l, ...series.map((s) => fmt(s.values[i] ?? 0, unit))])} />
    </figure>
  );
}

/** Parts of a whole (payments by method, patients by doctor). Five parts at most; the legend carries the numbers. */
export function DonutChart({ title, parts, unit = "number" }: { title: string; parts: { label: string; value: number }[]; unit?: Unit }) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="text-sm font-semibold">{title}</figcaption>
      {total === 0 ? (
        <p className="m-0 text-sm text-muted">Nothing to show yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <svg viewBox="0 0 140 140" className="size-36 shrink-0 -rotate-90" aria-hidden="true">
            <circle cx={70} cy={70} r={R} fill="none" stroke="var(--color-ground)" strokeWidth={18} />
            {parts.map((p, i) => {
              const len = (Math.max(0, p.value) / total) * C;
              const el = <circle key={p.label} cx={70} cy={70} r={R} fill="none" stroke={CHART_COLOURS[i % 5]} strokeWidth={18} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} />;
              offset += len;
              return el;
            })}
          </svg>
          <ul aria-hidden="true" className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {parts.map((p, i) => (
              <li key={p.label} className="flex items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHART_COLOURS[i % 5] }} />
                <span className="text-ink-soft">{p.label}</span>
                <span className="font-semibold tabular-nums">{fmt(p.value, unit)}</span>
                <span className="text-muted">({Math.round((Math.max(0, p.value) / total) * 100)}%)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ChartTable caption={title} head={["", "Value", "Share"]} rows={parts.map((p) => [p.label, fmt(p.value, unit), `${total ? Math.round((p.value / total) * 100) : 0}%`])} />
    </figure>
  );
}
