import { Link, useMatches, useNavigate } from "@tanstack/react-router";
import { ShieldX } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../components/EmptyState.tsx";
import { secondaryLink } from "../components/ItemMissing.tsx";
import { type SettingsModule, useSettingsAccess } from "../components/SettingsLink.tsx";
import { notifyDenied } from "../lib/api.ts";
import { useRights } from "../lib/auth.ts";
import { type CfgAccess, cfgModule, type RouteAccess, verdict } from "../lib/routeAccess.ts";

/** A module or admin area the person has no right to at all (6.2.0 Step 3f). */
export function CantOpen() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={ShieldX}
      title={t("common:rights.cantOpen.title")}
      description={t("common:rights.cantOpen.body")}
      action={
        <Link to="/" className={secondaryLink}>
          {t("common:rights.cantOpen.home")}
        </Link>
      }
    />
  );
}

/** Off a page the person may not use: to `to`, saying why when `notice` ("Your role can't change this."). */
export function Away({ to, params, notice }: { to: string; params: object; notice: boolean }) {
  const navigate = useNavigate();
  const key = `${to}${JSON.stringify(params)}`;
  // Once per target, not per render: the guard re-renders on every location change.
  useEffect(() => {
    if (notice) notifyDenied("common:rights.cantChange");
    void navigate({ to, params, replace: true } as never);
  }, [key]);
  return null;
}

type Target = { id: string; access: RouteAccess; params: object };

function Decide({
  target,
  cfg,
  children,
}: {
  target: Target;
  cfg?: CfgAccess;
  children: ReactNode;
}) {
  const rights = useRights();
  if (!rights) return null;
  const v = verdict(target.access, { rights, cfg });
  if (v === "allow") return children;
  if (v === "cantOpen") return <CantOpen />;
  return <Away to={v.to} params={target.params} notice={v.notice} />;
}

/** A module settings page's access needs its lists first: a task or a machine can't be told from none. */
function WithCfg({
  module,
  target,
  children,
}: {
  module: SettingsModule;
  target: Target;
  children: ReactNode;
}) {
  const { settings, sources, loading } = useSettingsAccess(module);
  if (loading) return null;
  return (
    <Decide target={target} cfg={{ settings, sources }}>
      {children}
    </Decide>
  );
}

/**
 * The one place a page's right is checked: the deepest matched route's `staticData.access`
 * (`lib/routeAccess.ts`). Nothing shows until the caller's rights are in.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const matches = useMatches();
  const m = matches.findLast((x) => x.staticData?.access);
  if (!m?.staticData.access) return children;
  const target: Target = { id: m.routeId, access: m.staticData.access, params: m.params };
  const module = cfgModule(target.access);
  return module ? (
    <WithCfg key={target.id} module={module} target={target}>
      {children}
    </WithCfg>
  ) : (
    <Decide key={target.id} target={target}>
      {children}
    </Decide>
  );
}
