import {
  type Device,
  devicePathIn,
  mayEditMachine,
  type Pick,
  type PickLevel,
  ROOT_HUB,
  type Root,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Server } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { FormDialog } from "../../components/FormDialog.tsx";
import { Menu } from "../../components/Menu.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan, useMe, useRights } from "../../lib/auth.ts";
import { useDeviceActions, useDevices } from "../../lib/hub.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useRoots } from "../../lib/roots.ts";
import { MachineBlock } from "./CatalogSources.tsx";
import { DeviceState } from "./ReceiveSources.tsx";
import { SourcesSection, type StateLine, StateLines } from "./Sources.tsx";

/**
 * Projects settings → Sources (ADR-0021): each machine with Share to the server on, one line per
 * shared folder (its switch pauses it) and Add folder, which browses the machine's whole disk; each
 * machine with Receive from the server on, one line per pick and Add pick.
 */
export function ProjectSources() {
  const { t } = useTranslation();
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const devices = useDevices(hubOn);
  const roots = useRoots();
  if (hubOn && !devices.data) return null;
  const sharing = (devices.data ?? []).filter((d) => d.shareProjects);
  const receiving = (devices.data ?? []).filter((d) => d.receiveProjects);
  if (!hubOn || (!sharing.length && !receiving.length))
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
      {sharing.length > 0 && (
        <SourcesSection direction="share">
          {sharing.map((d) => (
            <MachineFolders key={d.id} device={d} roots={roots} />
          ))}
        </SourcesSection>
      )}
      {receiving.length > 0 && (
        <SourcesSection direction="receive">
          {receiving.map((d) => (
            <MachinePicks key={d.id} device={d} roots={roots} />
          ))}
        </SourcesSection>
      )}
    </div>
  );
}

const LEVELS = {
  read: "settings:sources.picks.levels.read",
  edit: "settings:sources.picks.levels.edit",
} as const;

/** "Models (whole folder)" or "Clients / Acme". */
function usePickName() {
  const { t } = useTranslation();
  return (p: Pick) =>
    p.path
      ? t("settings:sources.picks.inFolder", {
          root: p.rootName,
          path: p.path.replaceAll("/", " / "),
        })
      : t("settings:sources.picks.wholeFolder", { root: p.rootName });
}

/** One machine's card in Receive from the server: its picks, each at Read or Edit, Add pick. */
function MachinePicks({ device: d, roots }: { device: Device; roots: Root[] }) {
  const { t } = useTranslation();
  const name = usePickName();
  // hub.manage or projects manage (ADR-0021); the server checks the same.
  const edit = useCan("hub.manage") || useCan("projects", "manage");
  const { picks } = useDeviceActions();
  const [editing, setEditing] = useState<Pick | "new" | null>(null);
  const [removing, setRemoving] = useState<Pick | null>(null);
  const rows: StateLine[] = d.picks.map((p) => ({
    key: p.id,
    item: name(p),
    on: {
      checked: !p.paused,
      label: t("settings:sources.picks.on", { pick: name(p), machine: d.name }),
      disabled: !edit || picks.isPending,
      set: (on) => picks.mutate({ id: d.id, method: "PATCH", pickId: p.id, paused: !on }),
    },
    state: t(LEVELS[p.level]),
    menu: edit && (
      <span className="flex items-center justify-end gap-1">
        <Button
          aria-label={t("settings:sources.picks.editOf", { pick: name(p) })}
          onClick={() => setEditing(p)}
        >
          {t("settings:sources.edit")}
        </Button>
        <Menu label={t("settings:sources.picks.menu", { pick: name(p) })}>
          <Button variant="ghost" className="justify-start" onClick={() => setRemoving(p)}>
            {t("settings:sources.picks.remove")}
          </Button>
        </Menu>
      </span>
    ),
  }));
  return (
    <MachineBlock id={d.id} name={d.name} subtitle={d.userName} receive>
      <DeviceState device={d} />
      {rows.length > 0 ? (
        <StateLines
          label={t("settings:sources.picks.lines", { machine: d.name })}
          stateHeader={t("settings:sources.picks.level")}
          rows={rows}
        />
      ) : (
        <p className="text-muted">{t("settings:sources.picks.none")}</p>
      )}
      {edit && (
        <div>
          <Button onClick={() => setEditing("new")}>{t("settings:sources.picks.add")}</Button>
        </div>
      )}
      {picks.isError && !editing && (
        <p role="alert" className="text-bad">
          {t("settings:saveError")}
        </p>
      )}
      {editing && (
        <PickDialog
          device={d}
          pick={editing === "new" ? null : editing}
          roots={roots}
          onClose={() => {
            picks.reset();
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        destructive
        title={t("settings:sources.picks.removeConfirmTitle", {
          pick: removing && name(removing),
          machine: d.name,
        })}
        description={t("settings:sources.picks.removeConfirm", { machine: d.name })}
        confirmLabel={t("settings:sources.picks.remove")}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          picks.mutate(
            { id: d.id, method: "DELETE", pickId: removing.id },
            { onSettled: () => setRemoving(null) },
          )
        }
      />
    </MachineBlock>
  );
}

/** The path inside a root, `/`-separated; "" = the root itself. */
const insideRoot = (root: string, path: string) => {
  const base = root.replace(/[\\/]+$/, "");
  return path.length <= base.length ? "" : path.slice(base.length + 1).replace(/\\/g, "/");
};

/** Add pick (a hub root, optionally a folder inside it, and its level) or Edit (its level). */
function PickDialog({
  device: d,
  pick,
  roots,
  onClose,
}: {
  device: Device;
  pick: Pick | null;
  roots: Root[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = usePickName();
  const { picks } = useDeviceActions();
  const hubRoots = roots.filter((r) => r.location === ROOT_HUB);
  const [rootId, setRootId] = useState(pick?.rootId ?? hubRoots[0]?.id ?? "");
  const [path, setPath] = useState(pick?.path ?? "");
  const [level, setLevel] = useState<PickLevel>(pick?.level ?? "edit");
  const root = hubRoots.find((r) => r.id === rootId);
  const code = picks.error instanceof ApiError ? picks.error.code : undefined;
  return (
    <FormDialog
      open
      title={
        pick
          ? t("settings:sources.picks.editTitle", { pick: name(pick), machine: d.name })
          : t("settings:sources.picks.addTitle", { machine: d.name })
      }
      busy={picks.isPending}
      error={
        picks.isError
          ? t(code === "pick_exists" ? "settings:sources.picks.exists" : "settings:saveError")
          : undefined
      }
      onCancel={onClose}
      onSubmit={() =>
        picks.mutate(
          pick
            ? { id: d.id, method: "PATCH", pickId: pick.id, level }
            : { id: d.id, method: "POST", rootId, path, level },
          { onSuccess: onClose },
        )
      }
    >
      {!pick && (
        <>
          <label className="grid gap-1">
            <span>{t("settings:sources.picks.root")}</span>
            <Combobox
              value={rootId}
              required
              onChange={(v) => {
                setRootId(v);
                setPath("");
              }}
              options={hubRoots.map((r) => ({ value: r.id, label: r.name }))}
            />
          </label>
          <div className="grid gap-1">
            <span>{t("settings:sources.picks.folder")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="wrap-anywhere">{path || t("settings:sources.picks.wholeRoot")}</span>
              {root && (
                <PathPicker
                  label={t("settings:sources.picks.folderIn", { root: root.name })}
                  mode="folder"
                  within={[root.path]}
                  pickRoots
                  onPick={(p) => setPath(insideRoot(root.path, p))}
                >
                  {t("settings:sources.picks.chooseFolder")}
                </PathPicker>
              )}
            </div>
          </div>
        </>
      )}
      <label className="grid gap-1">
        <span>{t("settings:sources.picks.level")}</span>
        <Combobox
          value={level}
          required
          onChange={(v) => (v === "read" || v === "edit") && setLevel(v)}
          options={(["edit", "read"] as const).map((l) => ({ value: l, label: t(LEVELS[l]) }))}
        />
      </label>
      <p className="text-muted">
        {t("settings:sources.picks.hint", { machine: d.name, user: d.userName })}
      </p>
    </FormDialog>
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
