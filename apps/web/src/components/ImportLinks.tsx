import type { Capability } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAdapterName, useCapable } from "../lib/integrations.ts";

const importClass =
  "inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2";

/** One import link per integration that can do `cap`; none = add by hand only. */
export function ImportLinks({
  to,
  cap,
  text,
  params,
}: {
  to: string;
  cap: Capability;
  /** i18n key; gets `{{name}}` = the integration's name. */
  text: string;
  /** Route params besides the integration `id`. */
  params?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  return useCapable(cap).map((i) => (
    <Link key={i.id} to={to} params={{ ...params, id: i.id }} className={importClass}>
      {t(text, { name: adapterName(i.adapterId) })}
    </Link>
  ));
}
