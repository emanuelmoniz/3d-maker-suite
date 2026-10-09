import { Box } from "lucide-react";
import { Component, lazy, type ReactNode, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { usePreferences } from "../../lib/preferences.ts";
import { useProjectPaint } from "../../lib/projects.ts";

// The 3D chunk (three.js) is only fetched when a model small enough is shown.
const ModelViewer = lazy(() => import("./ModelViewer.tsx"));

class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError = () => ({ failed: true });
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const MB = 1024 * 1024;

/** 3D viewer for one model file; the plate thumbnail instead when it is too big or fails. */
export function ModelPreview({
  projectId,
  path,
  url,
  ext,
  size,
  objects,
  partColors,
  thumbnail,
  name,
}: {
  projectId: string;
  path: string;
  url: string;
  ext: string;
  size: number;
  objects: string[];
  partColors: (string | null)[][];
  thumbnail: string | null;
  name: string;
}) {
  const { t } = useTranslation();
  const limit = usePreferences().data?.values.viewerMaxMb;
  const kind = ext === ".3mf" ? "3mf" : ext === ".stl" ? "stl" : null;
  // Painted colors need the mesh files; Bambu files only (they are the ones with partColors).
  const paint = useProjectPaint(projectId, path, kind === "3mf" && partColors.length > 0);

  const still = (note: string) => (
    <div className="grid h-full place-items-center gap-2 p-3 text-center text-muted">
      {thumbnail ? (
        <img src={thumbnail} alt={name} className="max-h-full max-w-full object-contain" />
      ) : (
        <Box className="size-10" aria-hidden />
      )}
      <p role="status">{note}</p>
    </div>
  );
  const box = "aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-surface-2";

  if (limit === undefined || paint.isLoading) return <div className={box} />;
  if (!kind) return <div className={box}>{still(t("projects:viewer.unsupported"))}</div>;
  if (size > limit * MB)
    return (
      <div className={box}>
        {still(
          t("projects:viewer.tooLarge", { size: (size / MB).toFixed(1), limit: Math.round(limit) }),
        )}
      </div>
    );
  const failed = still(t("projects:viewer.failed"));
  return (
    <div className={box}>
      <Boundary fallback={failed} key={url}>
        <Suspense fallback={<p className="p-3 text-muted">{t("projects:viewer.loading")}</p>}>
          <ModelViewer
            url={url}
            kind={kind}
            objects={objects}
            partColors={partColors}
            painted={paint.data}
            label={t("projects:viewer.label", { name })}
          />
        </Suspense>
      </Boundary>
    </div>
  );
}
