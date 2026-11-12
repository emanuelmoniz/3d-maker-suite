import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";

const variants = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-border bg-surface hover:bg-surface-2",
  ghost: "hover:bg-surface-2",
  danger: "bg-bad text-white hover:opacity-90",
};

export function Button({
  variant = "secondary",
  className,
  busy,
  disabled,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  /** Disables the button and shows a spinner after about 1 s. Only for actions that can be slow. */
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 font-medium transition-colors disabled:opacity-50",
        variants[variant],
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <LoaderCircle aria-hidden className="busy-spinner size-4" />}
      {children}
    </button>
  );
}
