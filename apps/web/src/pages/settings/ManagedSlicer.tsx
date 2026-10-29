import { type AdapterInfo, compareVersions, type Integration } from "@3d-maker-suite/core";
import { Link, type LinkProps } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { FormField } from "../../components/FormField.tsx";
import { formatSize } from "../../lib/format.ts";
import {
  useAdapterName,
  useInstallSlicer,
  useRemoveSlicer,
  useSlicerInstall,
  useSlicerReleases,
} from "../../lib/integrations.ts";
import { useZipSources } from "../../lib/slicerCatalog.ts";
import { DEVICE_INSTALL_ERRORS, INSTALL_ERRORS, INSTALL_PHASES } from "./integrationLabels.ts";

const VC_REDIST = "https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist";
const link = "text-accent hover:underline";
const version = (tag: string) => tag.replace(/^v/i, "");

/**
 * A server integration's slicer (ADR-0013), or a worker's on its device (`onDevice`, ADR-0014):
 * install a version, follow the job, update, remove.
 */
export function ManagedSlicer({
  integration: i,
  libraryId,
  managed,
  onDevice = false,
}: {
  integration: Integration;
  libraryId: string | null;
  managed: NonNullable<AdapterInfo["managed"]>;
  onDevice?: boolean;
}) {
  const { t } = useTranslation();
  const name = useAdapterName()(i.adapterId);
  const installed = i.slicerVersion ?? null;
  const job = useSlicerInstall(i.id).data;
  const install = useInstallSlicer(i.id);
  const remove = useRemoveSlicer(i.id);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Update to the newest release, pre-releases only when one is installed already.
  const newest = useSlicerReleases(i.id, !!installed?.includes("-"), !!installed).data?.[0];
  const update =
    installed && newest && compareVersions(newest.tag, installed) > 0 ? newest : undefined;
  const running = job?.state === "running";

  return (
    <div className="grid gap-3">
      {running ? (
        <div role="status" className="grid gap-1">
          <p>
            {t(INSTALL_PHASES[job.phase ?? "download"], {
              version: version(job.tag ?? ""),
              done: formatSize(job.received),
              total: formatSize(job.total),
            })}
          </p>
          <progress
            className="h-2 w-full accent-accent"
            aria-label={t("integrations:managed.progress")}
            max={job.total || 1}
            // Only the download has a known size; the rest is indeterminate.
            value={job.phase === "download" ? job.received : undefined}
          />
        </div>
      ) : (
        <p className={installed ? undefined : "text-muted"}>
          {installed
            ? t("integrations:managed.installed", { version: installed })
            : t("integrations:managed.notInstalled")}
        </p>
      )}
      {job?.state === "failed" && job.error && (
        <p role="alert" className="text-bad">
          {t((onDevice && DEVICE_INSTALL_ERRORS[job.error]) || INSTALL_ERRORS[job.error], {
            version: version(job.tag ?? ""),
          })}
          {job.detail && ` (${job.detail})`}
          {job.error === "vcredist_missing" && (
            <>
              {" "}
              <a className={link} href={VC_REDIST} target="_blank" rel="noreferrer">
                {t("integrations:managed.vcRedist")}
              </a>
            </>
          )}
        </p>
      )}
      {(install.isError || remove.isError) && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      {!running && (
        <div className="flex flex-wrap gap-2">
          {update && (
            <Button
              variant="primary"
              disabled={install.isPending}
              onClick={() => install.mutate(update.tag)}
            >
              {t("integrations:managed.update", { version: version(update.tag) })}
            </Button>
          )}
          {job?.state === "failed" && job.tag && (
            <Button disabled={install.isPending} onClick={() => install.mutate(job.tag ?? "")}>
              {t("integrations:managed.retry")}
            </Button>
          )}
          <Button variant={installed ? "secondary" : "primary"} onClick={() => setPicking(true)}>
            {installed ? t("integrations:managed.otherVersion") : t("integrations:managed.install")}
          </Button>
          {installed && (
            <Button disabled={remove.isPending} onClick={() => setConfirming(true)}>
              {t("integrations:managed.remove")}
            </Button>
          )}
        </div>
      )}

      {picking && (
        <InstallDialog
          integration={i}
          name={name}
          libraryId={libraryId}
          managed={managed}
          onClose={() => setPicking(false)}
        />
      )}
      <ConfirmDialog
        open={confirming}
        title={t("integrations:managed.removeTitle", { name })}
        description={
          onDevice
            ? t("integrations:managed.removeBodyDevice")
            : t("integrations:managed.removeBody")
        }
        confirmLabel={t("integrations:managed.remove")}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate();
        }}
      />
    </div>
  );
}

function InstallDialog({
  integration: i,
  name,
  libraryId,
  managed,
  onClose,
}: {
  integration: Integration;
  name: string;
  libraryId: string | null;
  managed: NonNullable<AdapterInfo["managed"]>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [pre, setPre] = useState(false);
  const [tag, setTag] = useState("");
  // The licence is the program's (Bambu Studio), not the card's (Bambu Studio (server)).
  const program = libraryId ? t(`filament:library.sources.${libraryId}`) : name;
  const releases = useSlicerReleases(i.id, pre);
  const install = useInstallSlicer(i.id);
  const list = releases.data ?? [];
  const picked = list.find((r) => r.tag === tag) ?? list[0];

  return (
    <FormDialog
      open
      title={t("integrations:managed.dialogTitle", { name })}
      submitLabel={t("integrations:managed.install")}
      busy={install.isPending || !picked}
      error={install.isError ? t("integrations:card.actionError") : undefined}
      onCancel={onClose}
      onSubmit={() => picked && install.mutate(picked.tag, { onSuccess: onClose })}
    >
      {releases.isError ? (
        <p role="alert" className="text-bad">
          {t("integrations:managed.releasesError")}
        </p>
      ) : picked ? (
        <FormField
          label={t("integrations:managed.version")}
          hint={t("integrations:managed.size", { size: formatSize(picked.size) })}
        >
          {(p) => (
            <Combobox
              {...p}
              value={picked.tag}
              onChange={setTag}
              options={list.map((r) => ({
                value: r.tag,
                label: r.prerelease
                  ? t("integrations:managed.preRelease", { version: version(r.tag) })
                  : version(r.tag),
              }))}
            />
          )}
        </FormField>
      ) : (
        releases.isSuccess && (
          <p className="text-muted">
            {pre ? t("integrations:managed.noneForSystem") : t("integrations:managed.noStable")}
          </p>
        )
      )}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} />
        {t("integrations:managed.showPre")}
      </label>
      <p className="text-muted">
        {t("integrations:managed.licence", { name: program })}{" "}
        <a className={link} href={managed.licenceUrl} target="_blank" rel="noreferrer">
          {t("integrations:managed.licenceLink")}
        </a>
        {picked && (
          <>
            {" · "}
            <a
              className={link}
              href={`https://github.com/${managed.repo}/tree/${picked.tag}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("integrations:managed.source", { version: version(picked.tag) })}
            </a>
          </>
        )}
      </p>
    </FormDialog>
  );
}

/**
 * A server slicer whose download has no readable profiles (OrcaSlicer's binary .opc): how to get
 * its presets from a desktop install as a zip instead.
 */
export function ProfilesFromZip({ libraryId }: { libraryId: string }) {
  const { t } = useTranslation();
  const folders = useZipSources().data?.find((s) => s.id === libraryId)?.folders;
  // The desktop slicer's name (OrcaSlicer), not the card's (OrcaSlicer (server)).
  const name = t(`filament:library.sources.${libraryId}`);
  return (
    <div className="grid gap-2">
      <p>{t("integrations:managed.noProfiles", { name })}</p>
      <ol className="grid list-decimal gap-1 pl-5">
        <li>{t("integrations:managed.zipSteps.install", { name })}</li>
        <li>
          {t("integrations:managed.zipSteps.folder")}
          {folders && (
            <ul className="list-disc pl-5 text-muted">
              <li>{t("import:zip.steps.windows", { folder: folders.windows })}</li>
              <li>{t("import:zip.steps.mac", { folder: folders.mac })}</li>
              <li>{t("import:zip.steps.linux", { folder: folders.linux })}</li>
            </ul>
          )}
        </li>
        <li>{t("integrations:managed.zipSteps.zip")}</li>
        <li>
          <Link
            className={link}
            to={
              `/import/slicer-zip?${new URLSearchParams({ slicer: libraryId })}` as LinkProps["to"]
            }
          >
            {t("import:zip.link")}
          </Link>
        </li>
      </ol>
    </div>
  );
}
