import { type ReactNode, useId } from "react";

export const inputClass =
  "h-9 w-full rounded-md border border-border bg-surface px-3 aria-[invalid=true]:border-bad";

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": note ? `${id}-note` : undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {note && (
        <p id={`${id}-note`} className={error ? "text-bad" : "text-muted"}>
          {note}
        </p>
      )}
    </div>
  );
}
