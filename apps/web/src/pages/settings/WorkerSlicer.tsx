import { type AdapterInfo, type Integration, workerConfigSchema } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { useDevices } from "../../lib/hub.ts";
import {
  useAdapterName,
  useAdapters,
  useCheckSlicer,
  usePatchIntegration,
} from "../../lib/integrations.ts";
import { ManagedSlicer } from "./ManagedSlicer.tsx";

const link = "text-accent hover:underline";
// Literal keys so `pnpm i18n:check` sees them.
const CHECK_ERRORS: Record<string, string> = {
  smoke_failed: "integrations:worker.errors.smoke_failed",
  vcredist_missing: "integrations:worker.errors.vcredist_missing",
  device_offline: "integrations:worker.errors.device_offline",
  device_no_slicer: "integrations:worker.errors.device_no_slicer",
  not_worker: "integrations:worker.errors.not_worker",
  device_outdated: "integrations:worker.errors.device_outdated",
};

/**
 * A worker integration's slicer (ADR-0014), on its device: one installed there (found, or a typed
 * path such as an AppImage), checked with `--help`; or a managed one the hub installs there.
 */
export function WorkerSlicer({
  integration: i,
  adapter,
}: {
  integration: Integration;
  adapter: AdapterInfo;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const adapters = useAdapters().data ?? [];
  const config = workerConfigSchema.safeParse(i.config).data;
  const device = useDevices().data?.find((d) => d.id === config?.deviceId);
  const patch = usePatchIntegration(i.id);
  const check = useCheckSlicer(i.id);
  const [path, setPath] = useState("");
  // The device's slicers of this one's library (Bambu Studio for Bambu Studio (worker)).
  const found =
    device?.slicers.filter(
      (s) => adapters.find((a) => a.id === s.id)?.libraryId === adapter.libraryId,
    ) ?? [];
  const checkError =
    check.error instanceof ApiError && check.error.code && CHECK_ERRORS[check.error.code];

  if (!config) return null;
  return (
    <div className="grid gap-3">
      <p className={device?.sliceWorker && device.online ? undefined : "text-muted"}>
        {!device
          ? t("integrations:worker.noDevice")
          : !device.sliceWorker
            ? t("integrations:worker.notWorker", { name: device.name })
            : device.online
              ? t("integrations:worker.online", { name: device.name })
              : t("integrations:worker.offline", { name: device.name })}{" "}
        {device && !device.sliceWorker && (
          <Link to="/hub" className={link}>
            {t("integrations:worker.toHub")}
          </Link>
        )}
      </p>
      <FormField label={t("integrations:worker.source")}>
        {(p) => (
          <Combobox
            {...p}
            value={config.source}
            disabled={patch.isPending}
            onChange={(v) =>
              (v === "installed" || v === "managed") &&
              v !== config.source &&
              patch.mutate({ config: { ...config, source: v } })
            }
            options={[
              { value: "installed", label: t("integrations:worker.sources.installed") },
              { value: "managed", label: t("integrations:worker.sources.managed") },
            ]}
          />
        )}
      </FormField>

      {config.source === "managed" && adapter.managed ? (
        <ManagedSlicer
          integration={i}
          libraryId={adapter.libraryId}
          managed={adapter.managed}
          onDevice
        />
      ) : (
        <>
          <p className={i.slicerPath ? "wrap-anywhere" : "text-muted"}>
            {i.slicerPath
              ? t("integrations:worker.uses", {
                  version: i.slicerVersion ?? t("integrations:worker.unknownVersion"),
                  path: i.slicerPath,
                })
              : t("integrations:worker.noneYet")}
          </p>
          {found.length > 0 && (
            <ul aria-label={t("integrations:worker.found")} className="grid gap-2">
              {found.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    {s.version
                      ? t("integrations:worker.foundSlicer", {
                          name: adapterName(s.id),
                          version: s.version,
                        })
                      : adapterName(s.id)}
                  </span>
                  <span className="text-muted wrap-anywhere">{s.path}</span>
                  <Button
                    disabled={check.isPending || !device?.online}
                    onClick={() => check.mutate({ slicer: s.id })}
                  >
                    {t("integrations:worker.use")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (path.trim()) check.mutate({ path: path.trim() });
            }}
          >
            <div className="min-w-0 grow sm:max-w-md">
              <FormField
                label={t("integrations:worker.path")}
                hint={t("integrations:worker.pathHint")}
              >
                {(p) => (
                  <input
                    {...p}
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    autoComplete="off"
                    className={inputClass}
                  />
                )}
              </FormField>
            </div>
            <Button type="submit" disabled={check.isPending || !path.trim() || !device?.online}>
              {t("integrations:worker.check")}
            </Button>
          </form>
          {check.isPending && <p role="status">{t("integrations:worker.checking")}</p>}
          {check.isSuccess && (
            <p role="status" className="text-ok">
              {t("integrations:worker.checked")}
            </p>
          )}
          {check.isError && (
            <p role="alert" className="text-bad">
              {t(checkError || "integrations:card.actionError")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
