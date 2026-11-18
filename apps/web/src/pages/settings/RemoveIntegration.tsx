import { type Integration, isSlicerKind } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Menu } from "../../components/Menu.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan } from "../../lib/auth.ts";
import {
  useAdapterName,
  useDefaultLibrary,
  useLocationLabel,
  useRemoveIntegration,
} from "../../lib/integrations.ts";

/**
 * The card's top-right menu (admins only): Remove integration takes every row of the card. The
 * dialog names each row and says what stays and what goes; the server refuses while one syncs.
 */
export function RemoveIntegration({
  library,
  rows,
  name,
}: {
  library: string;
  rows: Integration[];
  /** The card's title. */
  name: string;
}) {
  const { t } = useTranslation();
  const admin = useCan("integrations.manage");
  const adapterName = useAdapterName();
  const locationLabel = useLocationLabel();
  const isDefault = useDefaultLibrary() === library;
  const remove = useRemoveIntegration(library);
  const [asking, setAsking] = useState(false);
  if (!admin) return null;
  // An account by its name, a slicer by where it runs, a printer by what it is called.
  const label = (i: Integration) =>
    isSlicerKind(i.kind)
      ? locationLabel(i)
      : i.account?.name ||
        i.account?.email ||
        (i.config as { name?: string } | undefined)?.name ||
        adapterName(i.adapterId);
  const error = remove.error;
  const running = error instanceof ApiError && error.code === "sync_running";
  return (
    <>
      <Menu label={t("integrations:card.menu", { name })}>
        <Button
          variant="ghost"
          className="justify-start text-bad"
          onClick={() => {
            remove.reset();
            setAsking(true);
          }}
        >
          {t("integrations:removeIntegration.menu")}
        </Button>
      </Menu>
      <ConfirmDialog
        open={asking}
        title={t("integrations:removeIntegration.title", { name })}
        description={t("integrations:removeIntegration.body")}
        confirmLabel={t("integrations:removeIntegration.confirm")}
        destructive
        busy={remove.isPending}
        onCancel={() => setAsking(false)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => setAsking(false),
          })
        }
      >
        <ul className="list-disc pl-5">
          {rows.map((i) => (
            <li key={i.id} className="wrap-anywhere">
              {label(i)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-muted">{t("integrations:removeIntegration.stays")}</p>
        <p className="mt-2 text-muted">{t("integrations:removeIntegration.goes")}</p>
        {isDefault && (
          <p className="mt-2 text-warn">{t("integrations:removeIntegration.default")}</p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-bad">
            {t(
              running
                ? "integrations:removeIntegration.running"
                : "integrations:removeIntegration.failed",
            )}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
