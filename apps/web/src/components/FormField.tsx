import { type ReactNode, useId } from "react";

export const inputClass =
  "h-9 w-full rounded-md border border-border bg-surface px-3 aria-[invalid=true]:border-bad";

/** A long form: fields two by two on a desktop. A `wide` field, or `fullRow`, spans the row. */
export const formGrid = "grid items-start gap-4 lg:grid-cols-2";
export const fullRow = "lg:col-span-2";

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

export function FormField({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** Spans both columns of a `formGrid`. */
  wide?: boolean;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className={wide ? `flex flex-col gap-1.5 ${fullRow}` : "flex flex-col gap-1.5"}>
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
