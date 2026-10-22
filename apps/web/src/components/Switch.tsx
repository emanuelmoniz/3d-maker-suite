import type { InputHTMLAttributes } from "react";

/** A checkbox that reads as a switch. Native input: Space toggles it, screen readers say "switch". */
export function Switch({
  label,
  className = "",
  ...rest
}: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role">) {
  return (
    <label className={`inline-flex min-h-9 cursor-pointer items-center gap-2 ${className}`}>
      {/* biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox exposes its checked state */}
      <input type="checkbox" role="switch" className="peer sr-only" {...rest} />
      <span
        aria-hidden
        className="relative h-5 w-9 shrink-0 rounded-full bg-border transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2 peer-disabled:opacity-50"
      />
      {label}
    </label>
  );
}
