import { type Device, devicePathIn, mayEditMachine, type Root } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Server } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { Menu } from "../../components/Menu.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMe, useRights } from "../../lib/auth.ts";
import { useDeviceActions, useDevices } from "../../lib/hub.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useRoots } from "../../lib/roots.ts";
import { MachineBlock } from "./CatalogSources.tsx";
import { DeviceState } from "./ReceiveSources.tsx";
import { SourcesSection, type StateLine, StateLines } from "./Sources.tsx";

/**
 * Projects settings → Sources (ADR-0021): each machine with Share to the server on, one line per
 * shared folder (its switch pauses it) and Add folder, which browses the machine's whole disk.
 */
export function ProjectSources() {
  const { t } = useTranslation();
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const devices = useDevices(hubOn);
  const roots = useRoots();
  if (hubOn && !devices.data) return null;
  const sharing = (devices.data ?? []).filter((d) => d.shareProjects);
  if (!hubOn || !sharing.length)
    return (
      <EmptyState
        icon={Server}
        title={t("settings:sources.emptyTitle")}
        description={t("settings:sources.folders.empty")}
        action={
          <Link
            to="/hub"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 font-medium transition-colors hover:bg-surface-2"
          >
            <Server className="size-4" aria-hidden="true" />
            {t("settings:sources.hub")}
          </Link>
        }
      />
    );
  return (
    <div className="grid gap-10">
      <SourcesSection direction="share">
        {sharing.map((d) => (
          <MachineFolders key={d.id} device={d} roots={roots} />
        ))}
      </SourcesSection>
    </div>
  );
}

/** One machine's card: its shared folders, the project folders in each, Add folder. */
function MachineFolders({ device: d, roots }: { device: Device; roots: Root[] }) {
  const { t } = useTranslation();
  const rights = useRights();
  const me = useMe();
  const edit = !!rights && mayEditMachine(rights, me?.id, d, "projects");
  const { folders } = useDeviceActions();
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const code = folders.error instanceof ApiError ? folders.error.code : undefined;
  const rows: StateLine[] = (d.sharedFolders ?? []).map((f) => {
    const inside = roots.filter((r) => r.location === d.id && devicePathIn(f.path, r.path));
    return {
      key: f.path,
      item: f.path,
      on: {
        checked: !f.paused,
        label: t("settings:sources.folders.on", { path: f.path }),
        disabled: !edit || folders.isPending,
        set: (on) => folders.mutate({ id: d.id, method: "PATCH", path: f.path, paused: !on }),
      },
      state: inside.length
        ? inside.map((r) => r.name).join(", ")
        : t("settings:sources.folders.noProjectFolder"),
      menu: edit && (
        <Menu label={t("settings:sources.folders.menu", { path: f.path })}>
          <Button variant="ghost" className="justify-start" onClick={() => setRemoving(f.path)}>
            {t("settings:sources.folders.remove")}
          </Button>
        </Menu>
      ),
    };
  });
  return (
    <MachineBlock id={d.id} name={d.name} subtitle={d.userName}>
      <DeviceState device={d} />
      {d.sharedFolders === null ? (
        // An older connector keeps them itself; its list comes on its first connect after the update.
        <p className="text-warn">{t("settings:sources.folders.notReported")}</p>
      ) : (
        <>
          {rows.length > 0 ? (
            <StateLines
              label={t("settings:sources.folders.lines", { machine: d.name })}
              stateHeader={t("settings:sources.columns.projectFolder")}
              rows={rows}
            />
          ) : (
            <p className="text-muted">{t("settings:sources.folders.none")}</p>
          )}
          {edit && (
            <div>
              <PathPicker
                label={t("settings:sources.folders.addTitle", { machine: d.name })}
                mode="folder"
                device={d.id}
                onPick={setAdding}
              >
                {t("settings:sources.folders.add")}
              </PathPicker>
            </div>
          )}
        </>
      )}
      {folders.isError && (
        <p role="alert" className="text-bad">
          {t(
            code === "folder_covered"
              ? "settings:sources.folders.covered"
              : code === "device_outdated"
                ? "settings:sources.folders.notReported"
                : "settings:saveError",
          )}
        </p>
      )}
      <ConfirmDialog
        open={adding !== null}
        title={t("settings:sources.folders.addConfirmTitle", { path: adding, machine: d.name })}
        description={t("settings:sources.folders.addConfirm", { machine: d.name })}
        confirmLabel={t("settings:sources.folders.share")}
        onCancel={() => setAdding(null)}
        onConfirm={() =>
          adding &&
          folders.mutate(
            { id: d.id, method: "POST", path: adding },
            { onSettled: () => setAdding(null) },
          )
        }
      />
      <ConfirmDialog
        open={removing !== null}
        destructive
        title={t("settings:sources.folders.removeConfirmTitle", {
          path: removing,
          machine: d.name,
        })}
        description={t("settings:sources.folders.removeConfirm")}
        confirmLabel={t("settings:sources.folders.remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          folders.mutate(
            { id: d.id, method: "DELETE", path: removing },
            { onSettled: () => setRemoving(null) },
          )
        }
      />
    </MachineBlock>
  );
}
