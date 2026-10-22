import { type PlateSetupInput, type Project, rootOf } from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PlateSlice, plateKey, SliceSetup } from "../../components/SliceSetup.tsx";
import { usePreferences } from "../../lib/preferences.ts";
import {
  projectFileUrl,
  usePatchProject,
  useProjectSlicing,
  useSaveProjectSlicing,
  useSliceProject,
} from "../../lib/projects.ts";

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
  const prefs = usePreferences().data?.values;
  const defaultId = prefs?.defaultPrinterId;
  // What "Folder default" means here: on unless the project sits in a root ticked off.
  const rootOn = rootOf(project.folderPath ?? "", prefs?.projectRoots ?? [])?.autoSlice ?? true;
  if (!project.meta.models.length || !saved) return null;
  const byKey = new Map(saved.plates.map((p) => [plateKey(p), p]));
  const left = saved.plates.filter((p) => p.job).length;
  const toSlice = saved.plates.filter((p) => p.needsSlicing).length;
  const sliceStatus = !saved.canSlice
    ? t("projects:slicing.noSlicer")
    : left
      ? t("projects:slicing.progress", { count: left })
      : slice.isError
        ? t("projects:slicing.startFailed")
        : saved.plates.length && !toSlice
          ? t("projects:slicing.upToDate")
          : t("projects:slicing.sliceHint");
  return (
    <>
      <p className="mb-2 text-muted">{t("projects:slicing.hint")}</p>
      <div className="mb-3 max-w-sm">
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
            slice.mutate();
          }}
        >
          {t("projects:slicing.slice")}
        </Button>
        <p aria-live="polite" className={slice.isError || save.isError ? "text-bad" : "text-muted"}>
          {save.isError ? t("projects:slicing.saveFailed") : sliceStatus}
        </p>
      </div>
    </>
  );
}
