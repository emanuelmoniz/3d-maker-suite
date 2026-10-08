import { Link, useParams } from "@tanstack/react-router";
import { ImageOff } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { type DateRange, DateRangePicker } from "../../components/DateRangePicker.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { StatCard } from "../../components/StatCard.tsx";
import {
  formatCurrency,
  formatDate,
  formatDuration,
  formatEnergy,
  formatNumber,
} from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import {
  photoUrl,
  usePatchPrinter,
  usePrinter,
  usePrinterStats,
  useRemovePhoto,
  useUploadPhoto,
} from "../../lib/printers.ts";
import { Comments } from "./Comments.tsx";
import { StateBadge } from "./StateBadge.tsx";

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const linkButton =
  "inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";

export function PrinterDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: printer, isError } = usePrinter(id);
  const currency = usePreferences().data?.values.currency ?? "EUR";
  const [period, setPeriod] = useState<DateRange>({});
  const stats = usePrinterStats(id, period);
  const patch = usePatchPrinter(id);
  const upload = useUploadPhoto(id);
  const removePhoto = useRemovePhoto(id);
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("printers:detail.notFound")}
      </p>
    );
  if (!printer) return null;

  const none = t("printers:detail.info.none");
  const s = stats.data;
  const done = s ? s.successCount + s.failedCount + s.cancelledCount : 0;
  const archived = printer.archivedAt !== null;

  return (
    <>
      <PageHeader
        title={printer.name}
        description={`${printer.brand} ${printer.model}`.trim()}
        actions={
          <>
            <Link to="/printers/$id/edit" params={{ id }} className={linkButton}>
              {t("printers:detail.edit")}
            </Link>
            {archived ? (
              <Button onClick={() => patch.mutate({ archived: false })}>
                {t("printers:detail.restore")}
              </Button>
            ) : (
              <Button onClick={() => setConfirmArchive(true)}>
                {t("printers:detail.archive")}
              </Button>
            )}
          </>
        }
      />
      <ConfirmDialog
        open={confirmArchive}
        title={t("printers:detail.archiveTitle")}
        description={t("printers:detail.archiveBody")}
        confirmLabel={t("printers:detail.archive")}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          setConfirmArchive(false);
          patch.mutate({ archived: true });
        }}
      />
      {(patch.isError || upload.isError || removePhoto.isError) && (
        <p role="alert" className="mb-4 text-bad">
          {t("printers:detail.actionError")}
        </p>
      )}

      <div className="grid gap-4">
        <section className="grid gap-5 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[14rem_1fr] sm:p-5">
          <div className="grid content-start gap-2">
            {printer.photoPath ? (
              <img
                src={photoUrl(printer)}
                alt={t("printers:detail.photo.alt", { name: printer.name })}
                className="aspect-square w-full rounded-md border border-border object-cover"
              />
            ) : (
              <div className="grid aspect-square w-full place-items-center rounded-md border border-dashed border-border text-muted">
                <span className="grid justify-items-center gap-1">
                  <ImageOff className="size-6" aria-hidden />
                  {t("printers:detail.photo.empty")}
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <label
                className={`${linkButton} cursor-pointer focus-within:outline focus-within:outline-2`}
              >
                {t("printers:detail.photo.upload")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {printer.photoPath && (
                <Button variant="ghost" onClick={() => removePhoto.mutate()}>
                  {t("printers:detail.photo.remove")}
                </Button>
              )}
            </div>
          </div>
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              {t("printers:detail.info.title")}
              <StateBadge state={printer.state} />
              {archived && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                  {t("printers:detail.archived")}
                </span>
              )}
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Info label={t("printers:detail.info.serial")}>{printer.serial ?? none}</Info>
              <Info label={t("printers:detail.info.power")}>
                {printer.powerW === null
                  ? none
                  : t("printers:detail.info.powerValue", { value: printer.powerW })}
              </Info>
              <Info label={t("printers:detail.info.purchased")}>
                {printer.purchasedAt ? formatDate(printer.purchasedAt) : none}
              </Info>
              <Info label={t("printers:detail.info.price")}>
                {printer.purchasePrice === null
                  ? none
                  : formatCurrency(printer.purchasePrice / 100, currency)}
              </Info>
              <Info label={t("printers:detail.info.warranty")}>
                {printer.warrantyEndsAt ? formatDate(printer.warrantyEndsAt) : none}
              </Info>
              <Info label={t("printers:detail.info.warrantyNotes")}>
                {printer.warrantyNotes ?? none}
              </Info>
            </dl>
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("printers:detail.stats.title")}</h2>
            <DateRangePicker value={period} onChange={setPeriod} />
          </div>
          {stats.isError && (
            <p role="alert" className="text-bad">
              {t("printers:detail.stats.error")}
            </p>
          )}
          {s && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                label={t("printers:detail.stats.prints")}
                value={formatNumber(s.printCount)}
              />
              <StatCard
                label={t("printers:detail.stats.time")}
                value={formatDuration(s.totalSec)}
              />
              <StatCard
                label={t("printers:detail.stats.energy")}
                value={formatEnergy(s.energyWh / 1000)}
              />
              <StatCard
                label={t("printers:detail.stats.successRate")}
                value={done ? formatNumber(s.successCount / done, { style: "percent" }) : none}
                hint={t("printers:detail.stats.successHint", {
                  success: s.successCount,
                  failed: s.failedCount,
                  cancelled: s.cancelledCount,
                })}
              />
            </div>
          )}
        </section>

        <Comments printerId={id} />
      </div>
    </>
  );
}
