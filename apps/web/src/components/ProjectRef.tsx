import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { projectName, useProjects } from "../lib/projects.ts";

/** A project's name, linked to its page; "Other project" for one the user can't see (ADR-0014). */
export function ProjectRef({
  id,
  className = "hover:underline",
}: {
  id: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const projects = useProjects().data?.items;
  if (!projects) return null;
  const p = projects.find((x) => x.id === id);
  return p ? (
    <Link to="/projects/$id" params={{ id }} className={className}>
      {projectName(t, p)}
    </Link>
  ) : (
    <span className="text-muted">{t("projects:hidden")}</span>
  );
}
