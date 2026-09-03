import { cn } from "@/lib/utils";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-fg text-canvas hover:opacity-90 shadow-sm",
  secondary:
    "border border-line text-fg hover:bg-hvr2 hover:border-line-strong",
  ghost: "text-mut hover:text-fg hover:bg-hvr1",
  danger:
    "border border-red-500/25 text-red-400 hover:bg-red-500/[0.08] hover:border-red-500/40",
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium tracking-tight transition-all duration-150 disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98]",
        VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-line bg-transparent px-3.5 py-2.5 text-sm text-fg outline-none transition-colors placeholder:text-dim focus:border-acid/50",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-line bg-transparent px-3.5 py-2.5 text-sm leading-relaxed text-fg outline-none transition-colors resize-y placeholder:text-dim focus:border-acid/50",
        className
      )}
      {...props}
    />
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("rounded-xl border border-line bg-panel p-6", className)}
    >
      {children}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  green: "border-acid/25 bg-acid/[0.07] text-acid",
  red: "border-red-500/25 bg-red-500/[0.07] text-red-400",
  amber: "border-amber-500/25 bg-amber-500/[0.07] text-amber-400",
  blue: "border-sky-500/25 bg-sky-500/[0.07] text-sky-400",
  gray: "border-line text-mut",
};

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]",
        BADGE_TONES[tone]
      )}
    >
      {children}
    </span>
  );
}

export function Overline({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.24em] text-dim",
        className
      )}
    >
      {children}
    </p>
  );
}

export function StatusDot({ tone = "green" }: { tone?: "green" | "red" | "amber" }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        tone === "green" && "bg-acid",
        tone === "red" && "bg-red-500",
        tone === "amber" && "animate-blink bg-amber-400"
      )}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent opacity-70",
        className
      )}
    />
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line px-8 py-16 text-center">
      {icon ? <div className="text-dim">{icon}</div> : null}
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {hint ? (
          <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-dim">
            {hint}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
