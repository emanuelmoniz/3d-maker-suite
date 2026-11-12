import { ROOT_DEFAULTS, ROOT_EDIT_BY, ROOT_HUB, type Root } from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Box, EyeOff, File, Folder, FolderOpen, Laptop, Server } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PathPicker, type PickSource } from "../../components/PathPicker.tsx";
import { RootStateBadge } from "../../components/RootStateBadge.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useMe } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { useDevices } from "../../lib/hub.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { rootErrorKey, rootsQuery, useChangeRoot } from "../../lib/roots.ts";
import { useUsers } from "../../lib/users.ts";
import { type ExampleName, folderTree, type TreeNode } from "./folderTree.ts";
import { tileClass } from "./IntegrationFormPage.tsx";
import { same } from "./RightsEditor.tsx";
import { SaveBar } from "./RoleEditPage.tsx";

const PROJECT_DEPTHS = [1, 2, 3, 4, 5];
const FILES_DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const EDIT_BY = {
  roles: "settings:folder.editBy.roles",
  admins: "settings:folder.editBy.admins",
  users: "settings:folder.editBy.users",
  none: "settings:folder.editBy.none",
} as const;

const NAMES: Record<ExampleName, string> = {
  designs: "settings:folder.example.names.designs",
  furniture: "settings:folder.example.names.furniture",
  shelves: "settings:folder.example.names.shelves",
  wall: "settings:folder.example.names.wall",
  small: "settings:folder.example.names.small",
  project: "settings:folder.example.names.project",
  sibling: "settings:folder.example.names.sibling",
  model: "settings:folder.example.names.model",
  images: "settings:folder.example.names.images",
  cover: "settings:folder.example.names.cover",
  old: "settings:folder.example.names.old",
  draft: "settings:folder.example.names.draft",
  year: "settings:folder.example.names.year",
  firstTry: "settings:folder.example.names.firstTry",
};

/**
 * Where a project folder can come from: this server, then every online machine that shares
 * folders (ADR-0021), with the folders it shares as the picker's top level.
 */
export function useRootSources() {
  const { t } = useTranslation();
  const hubOn = !!usePreferences().data?.values.hubEnabled;
  const query = useDevices(hubOn);
  const devices = hubOn ? (query.data ?? []) : [];
  const sources: PickSource[] = [
    { id: ROOT_HUB, name: t("settings:projects.locationHub"), canCreate: true },
    ...devices.flatMap((d) => {
      const shared = d.shareProjects ? (d.sharedFolders ?? []).filter((f) => !f.paused) : [];
      return d.online && shared.length
        ? [
            {
              id: d.id,
              name: d.name,
              device: d.id,
              within: shared.map((f) => f.path),
              pickRoots: true,
            },
          ]
        : [];
    }),
  ];
  return { sources, devices };
}

type Draft = Pick<
  Root,
  "location" | "path" | "projectDepth" | "filesDepth" | "autoSlice" | "editBy" | "editorIds"
>;

const draftOf = (r: Root): Draft => ({
  location: r.location,
  path: r.path,
  projectDepth: r.projectDepth,
  filesDepth: r.filesDepth,
  autoSlice: r.autoSlice,
  editBy: r.editBy,
  editorIds: r.editorIds,
});

/** One line of the example tree, and its children as a nested list. */
function TreeItem({ node }: { node: TreeNode }) {
  const { t } = useTranslation();
  const Icon = !node.listed
    ? EyeOff
    : node.kind === "file"
      ? File
      : node.kind === "project"
        ? Box
        : node.children.length
          ? FolderOpen
          : Folder;
  const tag = !node.listed
    ? t("settings:folder.example.notListed")
    : node.kind === "project"
      ? t("settings:folder.example.project")
      : node.kind === "group"
        ? t("settings:folder.example.group")
        : null;
  const project = node.kind === "project";
  return (
    <li>
      <div
        className={cx(
          "flex min-h-8 items-center gap-2 rounded-r-md border-l-2 px-2",
          project ? "border-accent bg-accent-soft font-medium" : "border-transparent",
          (node.kind === "group" || !node.listed) && "text-muted",
        )}
      >
        <Icon className={cx("size-4 shrink-0", project && "text-accent")} aria-hidden />
        <span className="min-w-0 truncate">{node.text ?? t(NAMES[node.name])}</span>
        {tag && (
          <span className={cx("ml-auto shrink-0 text-xs", project ? "text-accent" : "text-muted")}>
            {tag}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="ml-3.5 border-l border-border pl-1.5">
          {node.children.map((c) => (
            <TreeItem key={c.name} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The page's example: a folder as these settings read it, in a list a screen reader can walk. */
function FolderTree({ draft, className }: { draft: Draft; className?: string }) {
  const { t } = useTranslation();
  const id = useId();
  const rootName = draft.path.split(/[\\/]/).filter(Boolean).at(-1);
  const folder = rootName ?? t(NAMES.designs);
  const { projectDepth: depth, filesDepth: files } = draft;
  return (
    <section
      aria-labelledby={id}
      className={cx("rounded-lg border border-border bg-surface p-4 sm:p-5", className)}
    >
      <h2 id={id} className="text-base font-semibold">
        {t("settings:folder.example.title")}
      </h2>
      <p className="mb-3 text-muted">{t("settings:folder.example.hint")}</p>
      <ul className="text-sm">
        <TreeItem node={folderTree({ projectDepth: depth, filesDepth: files, rootName })} />
      </ul>
      <p className="mt-3 text-muted">
        {depth === 1
          ? t("settings:folder.example.layoutFlat", { folder })
          : t("settings:folder.example.layoutDeep", { count: depth, folder })}{" "}
        {files == null
          ? t("settings:folder.example.filesAll")
          : files === 0
            ? t("settings:folder.example.filesNone")
            : t("settings:folder.example.filesLevels", { count: files })}
      </p>
    </section>
  );
}

const sectionClass = "grid gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5";
const optionClass = cx(tileClass, "items-center py-2");

function FolderForm({ root }: { root: Root | null }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const name = useId();
  const { sources, devices } = useRootSources();
  const editors = useUsers(!!useMe()).data ?? [];
  const save = useChangeRoot();
  const initial: Draft = root ? draftOf(root) : { location: ROOT_HUB, path: "", ...ROOT_DEFAULTS };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const dirty = root ? !same(draft, initial) : !!draft.path.trim();
  const onDevice = draft.location !== ROOT_HUB;
  const source = sources.find((s) => s.id === draft.location);
  const deviceUser = devices.find((d) => d.id === draft.location)?.userName;
  const picked = new Set(draft.editorIds);

  return (
    <form
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        if (root) {
          // Only what changed: picked editors that stay aren't checked again.
          const { location: _, path: __, ...settings } = draft;
          const patch = Object.fromEntries(
            Object.entries(settings).filter(
              ([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k as keyof Draft]),
            ),
          );
          save.mutate({ id: root.id, patch }, { onSuccess: () => setSaved(true) });
        } else
          save.mutate(
            { add: { ...draft, path: draft.path.trim() } },
            {
              onSuccess: (r) =>
                r &&
                navigate({
                  to: "/projects/settings/folders/$id",
                  params: { id: r.id },
                  replace: true,
                }),
            },
          );
      }}
    >
      <section className={sectionClass}>
        <h2 className="text-base font-semibold">{t("settings:folder.where")}</h2>
        {root ? (
          <FormField label={t("settings:folder.source")}>
            {(p) => (
              <input
                {...p}
                readOnly
                className={inputClass}
                value={root.deviceName ?? t("settings:projects.locationHub")}
              />
            )}
          </FormField>
        ) : (
          sources.length > 1 && (
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 font-medium">{t("settings:folder.source")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {sources.map((s) => (
                  <label key={s.id} className={optionClass}>
                    <input
                      type="radio"
                      name={`${name}-source`}
                      checked={draft.location === s.id}
                      onChange={() => set({ location: s.id, path: "" })}
                    />
                    {s.device ? (
                      <Laptop className="size-4 shrink-0 text-muted" aria-hidden />
                    ) : (
                      <Server className="size-4 shrink-0 text-muted" aria-hidden />
                    )}
                    <span className="min-w-0 wrap-anywhere">{s.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-muted">{t("settings:folder.sourceHint")}</p>
            </fieldset>
          )
        )}
        <FormField
          label={t("settings:folder.path")}
          hint={t(
            root
              ? "settings:folder.pathFixed"
              : onDevice
                ? "settings:folder.pathDevice"
                : "settings:folder.pathHub",
          )}
        >
          {(p) =>
            root ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  {...p}
                  readOnly
                  className={`${inputClass} min-w-0 flex-1`}
                  value={root.path}
                />
                <RootStateBadge state={root.state} />
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  {...p}
                  required
                  className={`${inputClass} min-w-0 flex-1`}
                  value={draft.path}
                  onChange={(e) => set({ path: e.target.value })}
                />
                <PathPicker
                  label={t("settings:folder.path")}
                  mode="folder"
                  initial={draft.path.trim() || undefined}
                  device={source?.device}
                  within={source?.within}
                  pickRoots={source?.pickRoots}
                  canCreate={source?.canCreate}
                  onPick={(path) => set({ path })}
                />
              </div>
            )
          }
        </FormField>
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold">{t("settings:folder.layoutTitle")}</h2>
        <fieldset className="grid gap-2">
          <legend className="mb-1.5 font-medium">{t("settings:folder.layout")}</legend>
          {PROJECT_DEPTHS.map((n) => (
            <label key={n} className={optionClass}>
              <input
                type="radio"
                name={`${name}-layout`}
                checked={draft.projectDepth === n}
                onChange={() => set({ projectDepth: n })}
              />
              {n === 1
                ? t("settings:folder.layoutFlat")
                : t("settings:folder.layoutGroups", { count: n - 1 })}
            </label>
          ))}
          <p className="text-muted">{t("settings:folder.layoutHint")}</p>
          {root && draft.projectDepth !== root.projectDepth && (
            <p className="text-warn">
              {t(
                onDevice ? "settings:folder.depthChangedDevice" : "settings:folder.depthChangedHub",
              )}
            </p>
          )}
        </fieldset>
        <FormField label={t("settings:folder.files")} hint={t("settings:folder.filesHint")}>
          {(p) => (
            <select
              {...p}
              className={`${inputClass} sm:max-w-xs`}
              value={draft.filesDepth ?? ""}
              onChange={(e) =>
                set({ filesDepth: e.target.value === "" ? null : Number(e.target.value) })
              }
            >
              <option value="">{t("settings:folder.filesAll")}</option>
              <option value={0}>{t("settings:folder.filesNone")}</option>
              {FILES_DEPTHS.map((n) => (
                <option key={n} value={n}>
                  {t("settings:folder.filesLevels", { count: n })}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {root && draft.filesDepth !== root.filesDepth && (
          <p className="text-warn">
            {t(onDevice ? "settings:folder.filesChangedDevice" : "settings:folder.filesChangedHub")}
          </p>
        )}
      </section>

      {/* Next to the fields it explains on a phone; beside the whole form on a wide screen. */}
      <FolderTree
        draft={draft}
        className="lg:sticky lg:top-4 lg:col-start-2 lg:row-span-4 lg:row-start-1"
      />

      <section className={sectionClass}>
        <h2 className="text-base font-semibold">{t("settings:folder.autoSliceTitle")}</h2>
        <div>
          <Switch
            label={t("settings:projects.autoSlice")}
            checked={draft.autoSlice}
            onChange={(e) => set({ autoSlice: e.target.checked })}
          />
          <p className="text-muted">{t("settings:projects.autoSliceHint")}</p>
        </div>
      </section>

      <section className={sectionClass}>
        <fieldset className="grid gap-2">
          <legend className="mb-3 text-base font-semibold">
            {t("settings:folder.editByTitle")}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROOT_EDIT_BY.map((v) => (
              <label key={v} className={optionClass}>
                <input
                  type="radio"
                  name={`${name}-editBy`}
                  checked={draft.editBy === v}
                  onChange={() => set({ editBy: v })}
                />
                {t(EDIT_BY[v])}
              </label>
            ))}
          </div>
          <p className="text-muted">
            {onDevice
              ? deviceUser
                ? t("settings:folder.editByDevice", { user: deviceUser })
                : t("settings:projects.editByDevice")
              : t("settings:folder.editByHub")}
          </p>
        </fieldset>
        {draft.editBy === "users" && (
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="mb-1.5 font-medium">{t("settings:folder.editors")}</legend>
            {editors.map((u) => (
              <label key={u.id} className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(u.id)}
                  onChange={(e) =>
                    set({
                      editorIds: e.target.checked
                        ? [...picked, u.id]
                        : [...picked].filter((id) => id !== u.id),
                    })
                  }
                />
                {u.displayName}
              </label>
            ))}
          </fieldset>
        )}
      </section>

      <div className="lg:col-span-2">
        <SaveBar
          dirty={dirty}
          busy={save.isPending}
          status={
            save.isError ? (
              <span className="text-bad">{t(rootErrorKey(save.error, draft.location))}</span>
            ) : saved && !dirty ? (
              t("settings:folder.saved")
            ) : undefined
          }
        />
      </div>
    </form>
  );
}

/** A project folder's source, path, layout, files levels, auto slice and editors; `/new` adds one. */
export function ProjectFolderPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id?: string };
  const roots = useQuery(rootsQuery);
  const root = id ? roots.data?.find((r) => r.id === id) : null;
  const title = root
    ? root.name
    : id
      ? t("settings:folder.titleFallback")
      : t("settings:folder.addTitle");

  return (
    <>
      <PageHeader
        title={title}
        description={root ? (root.deviceName ?? t("settings:projects.locationHub")) : undefined}
        backTo={{ to: "/projects/settings" }}
      />
      {roots.isError && (
        <p role="alert" className="text-bad">
          {t("settings:loadError")}
        </p>
      )}
      {/* Just added: the list is read again before the new folder is in it. */}
      {roots.data && root === undefined && !roots.isFetching && (
        <p className="text-muted">{t("settings:folder.notFound")}</p>
      )}
      {roots.data && root !== undefined && (
        // Re-mounted per folder, so the form starts from what is stored.
        <FolderForm key={root?.id ?? "new"} root={root} />
      )}
    </>
  );
}
