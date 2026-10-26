import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "./AddDialog.tsx";
import { Button } from "./Button.tsx";

/** An AddDialog holding a small form: fields, error, then Save and Cancel like a page form. */
export function FormDialog({
  open,
  title,
  error,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  error?: string;
  busy?: boolean;
  /** Default: Save. */
  submitLabel?: string;
  onSubmit: (f: FormData) => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <AddDialog open={open} title={title} onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
        className="grid gap-4"
      >
        {children}
        {error && (
          <p role="alert" className="text-bad">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {submitLabel ?? t("common:actions.save")}
          </Button>
          <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
    </AddDialog>
  );
}
