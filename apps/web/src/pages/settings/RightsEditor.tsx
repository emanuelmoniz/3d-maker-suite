import {
  type EffectiveRights,
  PERMISSION_LEVELS,
  type PermissionLevel,
  type Permissions,
  type ProjectRights,
} from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { cx } from "../../lib/cx.ts";

export type Rights = { permissions: Permissions; projectRights: ProjectRights };
export type Overrides = {
  permissions: Partial<Permissions>;
  projectRights: Partial<ProjectRights>;
};
type Group = keyof Rights;
type Value = PermissionLevel | boolean;
type Row = {
  group: Group;
  key: string;
  label: string;
  hint: string;
  /** Module levels; none = an on/off right. */
  levels?: readonly PermissionLevel[];
};

const mod = (key: keyof Permissions, label: string, hint: string): Row => ({
  group: "permissions",
  key,
  label,
  hint,
  levels: key === "stats" ? ["none", "read"] : PERMISSION_LEVELS,
});
const on = (group: Group, key: string, label: string, hint: string): Row => ({
  group,
  key,
  label,
  hint,
});

// Written out so `pnpm i18n:check` sees the keys. Order = ADR-0016 catalog.
const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "users:rights.groups.modules",
    rows: [
      mod("printers", "users:rights.printers", "users:rights.printersHint"),
      mod("maintenance", "users:rights.maintenance", "users:rights.maintenanceHint"),
      mod("filament", "users:rights.filament", "users:rights.filamentHint"),
      mod("projects", "users:rights.projects", "users:rights.projectsHint"),
      mod("prints", "users:rights.prints", "users:rights.printsHint"),
      mod("costs", "users:rights.costs", "users:rights.costsHint"),
      mod("stats", "users:rights.stats", "users:rights.statsHint"),
      mod("catalog", "users:rights.catalog", "users:rights.catalogHint"),
      mod("presets", "users:rights.presets", "users:rights.presetsHint"),
    ],
  },
  {
    title: "users:rights.groups.projects",
    rows: [
      on("projectRights", "projects.seeAll", "users:rights.seeAll", "users:rights.seeAllHint"),
      on(
        "projectRights",
        "projects.editOthers",
        "users:rights.editOthers",
        "users:rights.editOthersHint",
      ),
      on(
        "projectRights",
        "projects.editOtherDevices",
        "users:rights.editOtherDevices",
        "users:rights.editOtherDevicesHint",
      ),
    ],
  },
  {
    title: "users:rights.groups.integrations",
    rows: [
      on("permissions", "integrations.sync", "users:rights.sync", "users:rights.syncHint"),
      on("permissions", "integrations.review", "users:rights.review", "users:rights.reviewHint"),
      on(
        "permissions",
        "integrations.manage",
        "users:rights.integrations",
        "users:rights.integrationsHint",
      ),
    ],
  },
  {
    title: "users:rights.groups.admin",
    rows: [
      on("permissions", "hub.manage", "users:rights.hub", "users:rights.hubHint"),
      on("permissions", "settings.server", "users:rights.server", "users:rights.serverHint"),
      on("permissions", "settings.backup", "users:rights.backup", "users:rights.backupHint"),
      on("permissions", "settings.logs", "users:rights.logs", "users:rights.logsHint"),
      on("permissions", "settings.branding", "users:rights.branding", "users:rights.brandingHint"),
      on("permissions", "settings.alerts", "users:rights.alerts", "users:rights.alertsHint"),
      on("permissions", "users.manage", "users:rights.users", "users:rights.usersHint"),
    ],
  },
];

const LEVEL_LABELS = {
  none: "users:rights.levels.none",
  read: "users:rights.levels.read",
  write: "users:rights.levels.write",
  manage: "users:rights.levels.manage",
} as const;

const canon = (v: unknown): string =>
  v && typeof v === "object"
    ? `{${Object.keys(v)
        .sort()
        .map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`)
        .join(",")}}`
    : JSON.stringify(v);

/** Whether a form still holds what is stored, whatever order the server keeps the keys in. */
export const same = (a: object, b: object) => canon(a) === canon(b);

const rank = (v: Value) =>
  typeof v === "boolean" ? Number(v) : PERMISSION_LEVELS.indexOf(v as PermissionLevel);

const step =
  "relative flex h-8 min-w-14 flex-1 cursor-pointer items-center justify-center px-2.5 text-sm " +
  "has-disabled:cursor-not-allowed has-disabled:opacity-50 " +
  "has-focus-visible:z-10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent";

/**
 * One right as a ladder: each step includes the ones before, so everything up to the value is
 * filled. Native radios, so arrow keys move along it. With `role`, a first "Same as role" step
 * shows the role's value in a lighter fill; picking a step overrides it.
 */
function Ladder({
  row,
  base,
  override,
  user,
  locked,
  above,
  onChange,
}: {
  row: Row;
  base: Value;
  override: Value | undefined;
  user: boolean;
  locked: boolean;
  /** Whether a value is above what the editing user has (ADR-0016: no escalation). */
  above: (v: Value) => boolean;
  onChange: (v: Value | undefined) => void;
}) {
  const { t } = useTranslation();
  const steps: { value: Value; label: string }[] = row.levels
    ? row.levels.map((l) => ({ value: l, label: t(LEVEL_LABELS[l]) }))
    : [
        { value: false, label: t(user ? "users:rights.deny" : "users:rights.off") },
        { value: true, label: t(user ? "users:rights.allow" : "users:rights.on") },
      ];
  const effective = override ?? base;
  const inherited = user && override === undefined;
  const name = `${row.group}:${row.key}`;
  const labelOf = (v: Value) => steps.find((s) => s.value === v)?.label ?? "";
  const legendId = `${name}-legend`;

  return (
    <fieldset
      aria-labelledby={legendId}
      className="grid gap-x-6 gap-y-2 border-t border-border py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="min-w-0">
        <span id={legendId} className="flex items-center gap-2 font-medium">
          {t(row.label)}
          {user && !inherited && (
            <span className="rounded-sm bg-accent-soft px-1.5 text-xs font-normal text-accent">
              {t("users:rights.changed")}
            </span>
          )}
        </span>
        <span className="block text-muted">{t(row.hint)}</span>
      </div>
      <div className="grid gap-1 md:justify-items-end">
        <div className="flex gap-2">
          {user && (
            <label
              className={cx(
                step,
                "flex-none rounded-md border",
                inherited ? "border-accent text-accent" : "border-border text-muted hover:text-fg",
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={inherited}
                disabled={locked}
                onChange={() => onChange(undefined)}
              />
              {t("users:rights.sameAsRole")}
            </label>
          )}
          <div className="flex flex-1 overflow-hidden rounded-md border border-border md:w-72 md:flex-none">
            {steps.map((s, i) => {
              // The first step (none, off) is the empty ladder.
              const filled = i > 0 && rank(s.value) <= rank(effective);
              return (
                <label
                  key={String(s.value)}
                  className={cx(
                    step,
                    i > 0 && "border-l border-border",
                    filled
                      ? inherited
                        ? "bg-accent-soft text-accent"
                        : "bg-accent text-accent-fg"
                      : "text-muted hover:bg-surface-2 hover:text-fg",
                    s.value === effective && "font-semibold",
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    className="sr-only"
                    checked={!inherited && s.value === effective}
                    disabled={locked || above(s.value)}
                    onChange={() => onChange(s.value)}
                  />
                  {s.label}
                </label>
              );
            })}
          </div>
        </div>
        {user && (
          <span className={cx("text-sm", inherited ? "text-muted" : "text-accent")}>
            {inherited
              ? t("users:rights.fromRole", { value: labelOf(base) })
              : t("users:rights.overridesRole", { value: labelOf(base) })}
          </span>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Every permission and project right of a role (`overrides` absent) or of one user on top of
 * their role. `own` is the editing user's rights: outside the Admin role, nothing above them can
 * be picked. `editable` locks single rows (an Admin-role user takes only the device files one).
 */
export function RightsEditor({
  base,
  overrides,
  own,
  disabled = false,
  editable = () => true,
  onChange,
}: {
  base: Rights;
  overrides?: Overrides;
  own: EffectiveRights | undefined;
  disabled?: boolean;
  editable?: (key: string) => boolean;
  onChange: (group: Group, key: string, v: Value | undefined) => void;
}) {
  const { t } = useTranslation();
  const above = (group: Group, key: string) => (v: Value) => {
    if (!own || own.admin) return false;
    const mine = (own[group] as Record<string, Value>)[key] ?? false;
    return rank(v) > rank(mine);
  };
  return (
    <div className="grid gap-4">
      {GROUPS.map((g) => (
        <section
          key={g.title}
          aria-label={t(g.title)}
          className="rounded-lg border border-border bg-surface px-4 py-2 sm:px-5"
        >
          <h2 className="pt-2 pb-1 text-base font-semibold">{t(g.title)}</h2>
          {g.rows.map((row) => (
            <Ladder
              key={row.key}
              row={row}
              base={(base[row.group] as Record<string, Value>)[row.key] ?? false}
              override={
                overrides && (overrides[row.group] as Record<string, Value | undefined>)[row.key]
              }
              user={!!overrides}
              locked={disabled || !editable(row.key)}
              above={above(row.group, row.key)}
              onChange={(v) => onChange(row.group, row.key, v)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
