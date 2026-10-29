import type { PlateSetupInput, Project } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PlateSlice, plateKey, SliceSetup, usePlateFit } from "../../components/SliceSetup.tsx";
import { useSlicers } from "../../lib/integrations.ts";
import { usePreferences } from "../../lib/preferences.ts";
import {
  projectFileUrl,
  usePatchProject,
  useProjectSlicing,
  useSaveProjectSlicing,
  useSliceProject,
} from "../../lib/projects.ts";
import { useRoots } from "../../lib/roots.ts";

/** The print setup draft, owned by the edit form so its one Save button covers it too. */
export function useSlicingDraft(id: string) {
  const saved = useProjectSlicing(id).data;
  const save = useSaveProjectSlicing(id);
  const [draft, setDraft] = useState<PlateSetupInput[] | null>(null);
  const stored: PlateSetupInput[] = (saved?.plates ?? []).map((p) => ({
    file: p.file,
    plate: p.plate,
    printerId: p.printerId,
    printProfileId: p.printProfileId,
    useDefaultPrintProfile: p.useDefaultPrintProfile,
    filaments: p.filaments,
    spools: p.spools,
    slicerIntegrationId: p.slicerIntegrationId,
  }));
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored);
  /** Saves a changed draft; resolves once it is stored (or at once when nothing changed). */
  const flush = async () => {
    if (!dirty || !draft) return;
    await save.mutateAsync({ plates: draft });
    setDraft(null);
  };
  return { saved, save, stored, draft, setDraft, dirty, flush, value: draft ?? stored };
}
export type SlicingDraft = ReturnType<typeof useSlicingDraft>;

/** Which plates a print of the project takes, with the print profile and filaments per plate. */
export function SlicingSetup({ project, setup }: { project: Project; setup: SlicingDraft }) {
  const { t } = useTranslation();
  const { saved, save, setDraft, dirty, value } = setup;
  const slice = useSliceProject(project.id);
  const busy = slice.isPending || save.isPending;
  const patch = usePatchProject(project.id);
  const slicers = useSlicers();
  const prefs = usePreferences().data?.values;
  const defaultId = prefs?.defaultPrinterId;
  const { misfit } = usePlateFit(defaultId);
  /** A slicer as the project's: its name, and how many plates that use it it can't slice. */
  const slicerLabel = (id: string | undefined, name: string) => {
    const count = value.filter(
      (v) =>
        !slicers.usable(v.slicerIntegrationId) &&
        misfit(project.meta.models.find((m) => m.file === v.file) ?? {}, v, id) !== undefined,
    ).length;
    return count ? t("projects:slicing.slicerMisfitPlates", { name, count }) : name;
  };
  // What "Folder default" means here: on unless the project sits in a root ticked off.
  const rootOn = useRoots().find((r) => r.id === project.rootId)?.autoSlice ?? true;
  if (!project.meta.models.length || !saved) return null;
  const byKey = new Map(saved.plates.map((p) => [plateKey(p), p]));
  const left = saved.plates.filter((p) => p.job && p.job !== "waiting").length;
  const waiting = saved.plates.filter((p) => p.job === "waiting").length;
  const toSlice = saved.plates.filter((p) => p.needsSlicing).length;
  const sliceStatus = !saved.canSlice
    ? t("projects:slicing.noSlicer")
    : left
      ? t("projects:slicing.progress", { count: left })
      : slice.isError
        ? t("projects:slicing.startFailed")
        : waiting
          ? t("projects:slicing.waitingPlates", { count: waiting })
          : saved.plates.length && !toSlice
            ? t("projects:slicing.upToDate")
            : t("projects:slicing.sliceHint");
  return (
    <>
      <p className="mb-2 text-muted">{t("projects:slicing.hint")}</p>
      <div className="mb-3 grid max-w-2xl gap-3 sm:grid-cols-2">
        {slicers.slicers.length > 1 && (
          <FormField label={t("projects:slicing.slicer")} hint={t("projects:slicing.slicerHint")}>
            {(p) => (
              <select
                {...p}
                className={inputClass}
                value={slicers.usable(project.slicerIntegrationId) ?? ""}
                disabled={patch.isPending}
                onChange={(e) => patch.mutate({ slicerIntegrationId: e.target.value || null })}
              >
                <option value="">
                  {t("projects:slicing.slicerDefault", {
                    name: slicerLabel(slicers.resolve([]), slicers.nameOf(slicers.resolve([]))),
                  })}
                </option>
                {slicers.slicers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {slicerLabel(s.id, s.name)}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        <FormField
          label={t("projects:slicing.autoSlice")}
          hint={t("projects:slicing.autoSliceHint")}
        >
          {(p) => (
            <select
              {...p}
              className={inputClass}
              value={project.autoSlice == null ? "" : project.autoSlice ? "on" : "off"}
              disabled={patch.isPending}
              onChange={(e) =>
                patch.mutate({ autoSlice: e.target.value ? e.target.value === "on" : null })
              }
            >
              <option value="">
                {t(
                  rootOn
                    ? "projects:slicing.autoSliceFolderOn"
                    : "projects:slicing.autoSliceFolderOff",
                )}
              </option>
              <option value="on">{t("projects:slicing.autoSliceOn")}</option>
              <option value="off">{t("projects:slicing.autoSliceOff")}</option>
            </select>
          )}
        </FormField>
      </div>
      <SliceSetup
        files={project.meta.models.map((m) => ({
          path: m.file,
          label: m.file,
          plates: m.plates,
          printerModel: m.printerModel,
          nozzleDiameter: m.nozzleDiameter,
          printProfile: m.printProfile,
          thumbnailUrl: (entry) => projectFileUrl(project.id, m.file, entry),
        }))}
        value={value}
        onChange={setDraft}
        states={Object.fromEntries(saved.plates.map((p) => [plateKey(p), p.state]))}
        defaultPrinterId={defaultId}
        projectSlicerId={project.slicerIntegrationId}
        disabled={save.isPending}
        plateInfo={(key) => {
          const p = byKey.get(key);
          return p && <PlateSlice plate={p} />;
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          disabled={!saved.canSlice || !!left || (!dirty && !toSlice) || busy}
          onClick={async () => {
            try {
              await setup.flush();
            } catch {
              return; // save.isError shows below
            }
            slice.mutate({});
          }}
        >
          {t("projects:slicing.slice")}
        </Button>
        {waiting > 0 && saved.canFallback && !left && (
          <Button disabled={busy} onClick={() => slice.mutate({ fallback: true })}>
            {t("projects:slicing.fallback")}
          </Button>
        )}
        <p aria-live="polite" className={slice.isError || save.isError ? "text-bad" : "text-muted"}>
          {save.isError ? t("projects:slicing.saveFailed") : sliceStatus}
        </p>
      </div>
    </>
  );
}
