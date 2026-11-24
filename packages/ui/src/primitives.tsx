/**
 * Shared interface primitives for the web apps.
 *
 * Rules these components enforce so individual screens do not have to:
 *   - Every interactive control is at least 44 px tall and shows a visible
 *     focus ring (WCAG 2.2 AA; most shoppers are on a phone).
 *   - Colour is never the only signal: statuses carry text, errors carry text.
 *   - Form fields are always labelled, and errors are announced.
 * Colours and type come from @yuntera/brand tokens via Tailwind utilities.
 */

import type {
  ButtonHTMLAttributes,
  ComponentProps,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ── Buttons ─────────────────────────────────────────────────────────────────

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-surface-muted",
  ghost: "text-link hover:bg-brand-soft",
  danger: "bg-danger text-white hover:bg-achiote-700",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  // 36 px with a mouse; a full 44 px wherever the pointer is a finger.
  sm: "min-h-9 px-3 text-sm pointer-coarse:min-h-11",
  md: "min-h-11 px-4 text-base",
  lg: "min-h-12 px-6 text-lg",
};

/**
 * A text link that is still a 44 px target for a finger: the back links at
 * the top of a page ("← Pedidos") and a short link at the end of a sentence
 * ("Presente un reclamo"). For a link in text-sm (20 px lines): it is 44 px
 * tall, and its negative margin keeps the line, and so the layout, where it
 * was.
 */
export function touchLinkClass(className?: string): string {
  return cx("inline-flex min-h-11 -my-3 items-center text-link underline", className);
}

/** Class names for anything that should look like a button (a link, for instance). */
export function buttonClass(
  options: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {},
): string {
  const { variant = "primary", size = "md", block = false, className } = options;
  return cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], block && "w-full", className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={buttonClass({ variant, size, block, className })} {...props} />
  );
}

// ── Form fields ─────────────────────────────────────────────────────────────

const CONTROL =
  "block w-full min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base text-ink " +
  "placeholder:text-anil-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus " +
  "aria-invalid:border-danger disabled:bg-surface-muted disabled:text-ink-muted";

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Shown beside the label for optional fields. Required is the default and unmarked. */
  optional?: boolean;
  className?: string;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  className,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {optional ? <span className="ml-1 font-normal text-ink-muted">(opcional)</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint: ReactNode, error?: string | null) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

export function TextField({
  label,
  hint,
  error,
  optional,
  className,
  id: idProp,
  ...props
}: FieldShellProps & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={className}
    >
      <input
        id={id}
        className={CONTROL}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        required={!optional}
        {...props}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  optional,
  className,
  id: idProp,
  children,
  ...props
}: FieldShellProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={className}
    >
      <select
        id={id}
        className={CONTROL}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        required={!optional}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  className,
  id: idProp,
  rows = 3,
  ...props
}: FieldShellProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      optional={optional}
      className={className}
    >
      <textarea
        id={id}
        rows={rows}
        className={cx(CONTROL, "py-2")}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        required={!optional}
        {...props}
      />
    </FieldShell>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────────

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "promo";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-anil-100 text-anil-800",
  info: "bg-celeste-100 text-celeste-900",
  success: "bg-selva-100 text-selva-900",
  warning: "bg-maiz-100 text-maiz-900",
  danger: "bg-achiote-100 text-achiote-900",
  promo: "bg-guaria-100 text-guaria-900",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        BADGE_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

const ALERT_TONE: Record<Exclude<Tone, "neutral" | "promo">, string> = {
  info: "border-celeste-300 bg-celeste-50 text-celeste-950",
  success: "border-selva-300 bg-selva-50 text-selva-900",
  warning: "border-maiz-300 bg-maiz-50 text-maiz-900",
  danger: "border-achiote-300 bg-achiote-50 text-achiote-900",
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Exclude<Tone, "neutral" | "promo">;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      // Errors interrupt; everything else is announced politely.
      role={tone === "danger" ? "alert" : "status"}
      className={cx("rounded-md border px-4 py-3 text-sm", ALERT_TONE[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-lg border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-12 text-center">
      <WheelGlyph className="size-12 text-celeste-300" />
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      {children ? <p className="max-w-md text-ink-muted">{children}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx("animate-pulse rounded-md bg-arena-200", className)} />
  );
}

/**
 * The brand's secondary glyph: a cart wheel with eight spokes, after the
 * painted oxcart wheels of Sarchí. Used for empty states and loading.
 */
export function WheelGlyph({ className, spin = false }: { className?: string; spin?: boolean }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cx(spin && "animate-spin [animation-duration:1.4s]", className)}
    >
      <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" />
      <circle cx="24" cy="24" r="5" fill="currentColor" />
      <path
        d="M24 4v40M4 24h40M9.9 9.9l28.2 28.2M38.1 9.9 9.9 38.1"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Spinner({ label = "Cargando…" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-ink-muted">
      <WheelGlyph spin className="size-5 text-brand" />
      <span>{label}</span>
    </span>
  );
}
