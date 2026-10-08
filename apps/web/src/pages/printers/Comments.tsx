import type { PrinterComment } from "@3d-maker-suite/core";
import { CircleCheck, Pin, PinOff, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { cx } from "../../lib/cx.ts";
import { formatDateTime } from "../../lib/format.ts";
import {
  useAddComment,
  useComments,
  useDeleteComment,
  usePatchComment,
} from "../../lib/printers.ts";

/** Notes timeline for one printer: pinned first, then newest first (the API orders it). */
export function Comments({ printerId }: { printerId: string }) {
  const { t } = useTranslation();
  const { data } = useComments(printerId);
  const add = useAddComment(printerId);
  const patch = usePatchComment(printerId);
  const remove = useDeleteComment(printerId);
  const failed = add.isError || patch.isError || remove.isError;

  const row = (c: PrinterComment) => {
    const resolved = c.status === "resolved";
    const toggle = (p: { pinned?: boolean; status?: PrinterComment["status"] }) =>
      patch.mutate({ commentId: c.id, patch: p });
    return (
      <li
        key={c.id}
        className="flex items-start gap-3 rounded-md border border-border bg-surface p-3"
      >
        <div className="min-w-0 flex-1">
          <p
            className={cx("whitespace-pre-wrap break-words", resolved && "text-muted line-through")}
          >
            {c.body}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <time dateTime={c.createdAt}>{formatDateTime(c.createdAt)}</time>
            {c.pinned && (
              <span className="inline-flex items-center gap-1">
                <Pin className="size-3" aria-hidden />
                {t("printers:comments.pinned")}
              </span>
            )}
            {resolved && (
              <span className="inline-flex items-center gap-1 text-ok">
                <CircleCheck className="size-3" aria-hidden />
                {t("printers:comments.resolved")}
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            className="size-9 px-0"
            title={c.pinned ? t("printers:comments.unpin") : t("printers:comments.pin")}
            aria-label={c.pinned ? t("printers:comments.unpin") : t("printers:comments.pin")}
            aria-pressed={c.pinned}
            onClick={() => toggle({ pinned: !c.pinned })}
          >
            {c.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            className="size-9 px-0"
            title={resolved ? t("printers:comments.reopen") : t("printers:comments.resolve")}
            aria-label={resolved ? t("printers:comments.reopen") : t("printers:comments.resolve")}
            onClick={() => toggle({ status: resolved ? "open" : "resolved" })}
          >
            {resolved ? <RotateCcw className="size-4" /> : <CircleCheck className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            className="size-9 px-0"
            title={t("printers:comments.delete")}
            aria-label={t("printers:comments.delete")}
            onClick={() => remove.mutate(c.id)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </li>
    );
  };

  return (
    <section className="rounded-lg border border-border bg-surface-2/40 p-4 sm:p-5">
      <h2 className="mb-4 text-base font-semibold">{t("printers:comments.title")}</h2>
      <form
        className="mb-4 grid gap-2 sm:max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const body = String(new FormData(form).get("body") ?? "").trim();
          if (body) add.mutate({ body, pinned: false }, { onSuccess: () => form.reset() });
        }}
      >
        <FormField label={t("printers:comments.label")}>
          {(p) => (
            <textarea
              {...p}
              name="body"
              required
              className={`${inputClass} h-20 py-2`}
              placeholder={t("printers:comments.placeholder")}
            />
          )}
        </FormField>
        <Button type="submit" variant="primary" className="w-fit" disabled={add.isPending}>
          {t("printers:comments.add")}
        </Button>
      </form>
      {failed && (
        <p role="alert" className="mb-3 text-bad">
          {t("printers:comments.error")}
        </p>
      )}
      {data && !data.length ? (
        <p className="text-muted">{t("printers:comments.empty")}</p>
      ) : (
        <ul className="grid gap-2">{data?.map(row)}</ul>
      )}
    </section>
  );
}
