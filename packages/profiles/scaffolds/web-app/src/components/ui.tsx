/**
 * The Ledger UI kit: every page is built from these, so the whole app looks consistent and
 * works well on a phone (44px touch targets, readable type, clear money colours).
 * Server components: no "use client" needed. Pass `className` to adjust spacing only.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

// ---- layout ---------------------------------------------------------------

export interface NavItem {
  href: string;
  label: string;
}

/** The frame of every signed-in screen: brand bar with navigation, then the page. */
export function AppShell({ brand, subtitle, nav = [], active, actions, children }: { brand: string; subtitle?: string; nav?: NavItem[]; active?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ground">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-7 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex grow items-center gap-2.5">
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-[10px] bg-primary text-base font-bold text-white">
              {brand.trim().charAt(0).toUpperCase()}
            </span>
            <span className="flex flex-col">
              <span className="text-base font-bold tracking-tight">{brand}</span>
              {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
            </span>
          </div>
          {nav.length > 0 && (
            <nav aria-label="Main" className="flex flex-wrap gap-1">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active === n.href ? "page" : undefined}
                  className={cx("rounded-full px-3.5 py-2.5 text-sm no-underline", active === n.href ? "bg-primary-tint font-semibold text-primary" : "font-medium text-ink-soft hover:bg-primary-tint/60")}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          )}
          {actions}
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

/** A message after an action or a problem to fix. Errors are announced to screen readers. */
export function Alert({ tone = "info", children }: { tone?: "success" | "error" | "info"; children: ReactNode }) {
  const cls = tone === "success" ? "bg-paid-tint text-paid" : tone === "error" ? "bg-owed-tint text-owed" : "bg-primary-tint text-primary";
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

/** Format an amount of Taka the same way everywhere: ৳1,500. */
export function money(amount: number): string {
  return `৳${Math.round(amount).toLocaleString("en-IN")}`;
}

// ---- forms ----------------------------------------------------------------

const controlClass = (invalid?: boolean) =>
  cx("min-h-11 w-full rounded-[var(--radius-control)] bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70", invalid ? "border-2 border-owed" : "border border-line-strong focus:border-primary");

/** A labelled control with an optional hint or error underneath. Put one Input/Select/Textarea inside. */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {error ? <span className="text-[13px] font-normal text-owed">{error}</span> : hint ? <span className="text-[13px] font-normal text-muted">{hint}</span> : null}
    </label>
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
