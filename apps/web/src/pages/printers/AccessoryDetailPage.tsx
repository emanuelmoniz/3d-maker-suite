import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveActions, ArchivedBadge } from "../../components/ArchiveActions.tsx";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { Write } from "../../components/Write.tsx";
import {
  accessoryName,
  accessoryPhotoUrl,
  useAccessory,
  useDeleteInstall,
  useInstalls,
  useRemoveAccessoryPhoto,
  useUploadAccessoryPhoto,
} from "../../lib/accessories.ts";
import { textLink } from "../../lib/cx.ts";
import { formatCurrency, formatDate, formatDuration, formatNumber } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { printerName, usePrinters } from "../../lib/printers.ts";
import { Comments } from "./Comments.tsx";
import { useCostInfo } from "./CostFields.tsx";
import { InstallDialog, RemoveDialog } from "./InstallDialogs.tsx";
import { Info, linkButton, Photo } from "./PrinterDetailPage.tsx";
import { StateBadge } from "./StateBadge.tsx";

export function AccessoryDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: accessory, isError } = useAccessory(id);
  const installs = useInstalls(id).data;
  const currency = usePreferences().data?.values.currency ?? "EUR";
  const remove = useDeleteInstall(id);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const upload = useUploadAccessoryPhoto(id);
  const removePhoto = useRemoveAccessoryPhoto(id);
  const printers = usePrinters({ archived: "all" }).data?.items ?? [];
  const costInfo = useCostInfo(accessory, "accessory");

  if (isError)
    return (
      <p role="alert" className="text-bad">
        {t("printers:accessories.detail.notFound")}
      </p>
    );
  if (!accessory) return null;

  const none = t("printers:detail.info.none");
  const archived = accessory.archivedAt !== null;
  const current = installs?.find((i) => i.removedAt === null);

  return (
    <>
      <PageHeader
        title={accessoryName(t, accessory)}
        backTo={{ to: "/printers" }}
        description={
          <>
            {accessory.type} {archived && <ArchivedBadge />}
          </>
        }
        actions={
          <Write can="printers" level="manage">
            <Link to="/printers/accessories/$id/edit" params={{ id }} className={linkButton}>
              {t("printers:detail.edit")}
            </Link>
            <ArchiveActions
              path={`/api/accessories/${id}`}
              name={accessoryName(t, accessory)}
              archived={archived}
              onDeleted={() => navigate({ to: "/printers" })}
            />
          </Write>
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        destructive
        title={t("printers:accessories.history.deleteTitle")}
        description={t("printers:accessories.history.deleteBody")}
        confirmLabel={t("printers:accessories.history.delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
          setDeleting(null);
        }}
      />
      {(remove.isError || upload.isError || removePhoto.isError) && (
        <p role="alert" className="mb-4 text-bad">
          {t("printers:detail.actionError")}
        </p>
      )}

      <div className="grid gap-4">
        <section className="grid gap-5 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[14rem_1fr] sm:p-5">
          <Photo
            src={accessory.photoPath ? accessoryPhotoUrl(accessory) : null}
            alt={t("printers:detail.photo.alt", { name: accessoryName(t, accessory) })}
            own={accessory.photoPath !== null}
            onUpload={(file) => upload.mutate(file)}
            onRemove={() => removePhoto.mutate()}
          />
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              {t("printers:detail.info.title")}
              <StateBadge state={accessory.state} />
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Info label={t("printers:accessories.detail.printer")}>
                {current ? (
                  <Link to="/printers/$id" params={{ id: current.printerId }} className={textLink}>
                    {current.printerLabel}
                  </Link>
                ) : (
                  t("printers:accessories.detail.notInstalled")
                )}
              </Info>
              <Info label={t("printers:detail.info.serial")}>{accessory.serial ?? none}</Info>
              {/* Usage: the prints of the printers it was on, while it was on them. */}
              <Info label={t("printers:detail.stats.prints")}>
                {formatNumber(accessory.prints)}
              </Info>
              <Info label={t("printers:detail.stats.time")}>
                {formatDuration(accessory.runtimeSec)}
              </Info>
              <Info label={t("printers:detail.info.power")}>
                {accessory.powerW === null
                  ? none
                  : t("printers:detail.info.powerValue", { value: accessory.powerW })}
              </Info>
              <Info label={t("printers:detail.info.purchased")}>
                {accessory.purchasedAt ? formatDate(accessory.purchasedAt) : none}
              </Info>
              <Info label={t("printers:detail.info.price")}>
                {accessory.purchasePrice === null
                  ? none
                  : formatCurrency(accessory.purchasePrice / 100, currency)}
              </Info>
              <Info label={t("printers:detail.info.warranty")}>
                {accessory.warrantyEndsAt ? formatDate(accessory.warrantyEndsAt) : none}
              </Info>
              <Info label={t("printers:detail.info.warrantyNotes")}>
                {accessory.warrantyNotes ?? none}
              </Info>
              {costInfo.map((r) => (
                <Info key={r.label} label={r.label}>
                  {r.value}
                </Info>
              ))}
            </dl>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t("printers:accessories.history.title")}</h2>
            {!archived && (
              <Write can="printers">
                <span className="flex flex-wrap gap-2">
                  {accessory.installId && (
                    <Button onClick={() => setRemoving(true)}>
                      {t("printers:accessories.history.remove")}
                    </Button>
                  )}
                  <Button onClick={() => setAdding(true)}>
                    <Plus className="size-4" aria-hidden />
                    {t("printers:accessories.history.add")}
                  </Button>
                </span>
              </Write>
            )}
          </div>
          {installs && !installs.length ? (
            <p className="text-muted">{t("printers:accessories.history.empty")}</p>
          ) : (
            <ul className="grid gap-2">
              {installs?.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link to="/printers/$id" params={{ id: i.printerId }} className={textLink}>
                        {i.printerLabel}
                      </Link>
                      {printers.find((p) => p.id === i.printerId)?.archivedAt && <ArchivedBadge />}
                    </span>
                    <p className="text-sm text-muted">
                      {t("printers:accessories.history.period", {
                        from: formatDate(i.installedAt),
                        to: i.removedAt
                          ? formatDate(i.removedAt)
                          : t("printers:accessories.history.current"),
                      })}
                    </p>
                  </div>
                  <Write can="printers">
                    <Button
                      variant="ghost"
                      className="size-9 px-0"
                      title={t("printers:accessories.history.delete")}
                      aria-label={t("printers:accessories.history.delete")}
                      onClick={() => setDeleting(i.id)}
                    >
                      <Trash2 className="size-4 text-bad" />
                    </Button>
                  </Write>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Comments base={`/api/accessories/${id}`} />
      </div>
      {adding && (
        <InstallDialog
          accessoryId={id}
          options={printers
            .filter((p) => !p.archivedAt)
            .map((p) => ({ value: p.id, label: printerName(t, p) }))}
          onClose={() => setAdding(false)}
        />
      )}
      {removing && <RemoveDialog accessory={accessory} onClose={() => setRemoving(false)} />}
    </>
  );
}
