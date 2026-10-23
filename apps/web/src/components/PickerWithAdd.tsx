import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button.tsx";

/** A picker with its "+ Add …" button beside it, which opens an AddDialog. */
export function PickerWithAdd({
  label,
  onAdd,
  children,
}: {
  label: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      <Button onClick={onAdd}>
        <Plus className="size-4" aria-hidden />
        {label}
      </Button>
    </div>
  );
}
