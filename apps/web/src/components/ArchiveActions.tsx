import {
  BULK_ITEMS,
  type BulkItemAction,
  type BulkKind,
  type BulkResult,
  type DependentType,
  type InUseDetails,
  type Permission,
  type PermissionLevel,
} from "@3d-maker-suite/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api } from "../lib/api.ts";
import { Button } from "./Button.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import type { Column } from "./DataTable.tsx";
import { SelectionBar } from "./SelectionBar.tsx";
import { Write } from "./Write.tsx";

type Action = "archive" | "restore" | "delete";

// Static keys so `pnpm i18n:check` sees them.
const BUTTONS = {
  archive: {
    Icon: Archive,
    label: "common:archive.actions.archive",
    named: "common:archive.named.archive",
  },
  restore: {
    Icon: ArchiveRestore,
    label: "common:archive.actions.restore",
    named: "common:archive.named.restore",
  },
  delete: {
    Icon: Trash2,
    label: "common:archive.actions.delete",
    named: "common:archive.named.delete",
  },
} as const;

const ERRORS: Record<string, string> = {
  printer_has_accessories: "common:archive.errors.printer_has_accessories",
  accessory_installed: "common:archive.errors.accessory_installed",
  preset_newer_exists: "common:archive.errors.preset_newer_exists",
  folder_has_files: "common:archive.errors.folder_has_files",
  forbidden: "common:archive.errors.forbidden",
  not_found: "common:archive.errors.not_found",
};

const DEPENDENTS: Record<DependentType, { key: string; to: string }> = {
  printerModel: {
    key: "common:archive.dependents.printerModel",
    to: "/printers/models/$id/edit",
  },
  machineProfile: {
    key: "common:archive.dependents.machineProfile",
    to: "/printers/profiles/$id/edit",
  },
  printProfile: {
    key: "common:archive.dependents.printProfile",
    to: "/printers/print-profiles/$id/edit",
  },
  printer: { key: "common:archive.dependents.printer", to: "/printers/$id" },
  accessory: { key: "common:archive.dependents.accessory", to: "/printers/accessories/$id" },
  maintenanceType: {
    key: "common:archive.dependents.maintenanceType",
    to: "/maintenance/types/$id",
  },
  // A logged task has no page of its own.
  maintenanceTask: { key: "common:archive.dependents.maintenanceTask", to: "/maintenance" },
  filamentProfile: {
    key: "common:archive.dependents.filamentProfile",
    to: "/filament/profiles/$id",
  },
  spool: { key: "common:archive.dependents.spool", to: "/filament/spools/$id" },
  print: { key: "common:archive.dependents.print", to: "/prints/$id" },
  order: { key: "common:archive.dependents.order", to: "/orders/$id" },
  quote: { key: "common:archive.dependents.quote", to: "/quotes/$id" },
};

export function ArchivedBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
      {t("common:archive.archived")}
    </span>
  );
}

/** What keeps an item from being deleted, with links. Hidden rows are only counted (ADR-0018). */
function Dependents({ details, onLeave }: { details: InUseDetails; onLeave: () => void }) {
  const { t } = useTranslation();
  return (
    <ul className="grid max-h-72 gap-3 overflow-y-auto">
      {details.dependents.map((d) => (
        <li key={d.type} className="grid gap-1">
          <span className="font-medium">
            {t(DEPENDENTS[d.type].key, { count: d.total })}
            {d.archived > 0 && ` · ${t("common:archive.archivedCount", { count: d.archived })}`}
          </span>
          {d.items.map((i) => (
            <span key={i.id} className="flex flex-wrap items-center gap-2">
              <Link
                to={DEPENDENTS[d.type].to}
                params={{ id: i.id }}
                onClick={onLeave}
                className="underline wrap-anywhere"
              >
                {i.label}
              </Link>
              {i.archived && <ArchivedBadge />}
            </span>
          ))}
          {d.total > d.items.length && (
            <span className="text-muted">
              {t("common:archive.notShown", { count: d.total - d.items.length })}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Archive or Restore, and Delete, for one row of any of the 16 entities (ADR-0018): buttons on its
 * page, icons in a list. A refused delete names what uses the row and offers Archive.
 */
export function ArchiveActions({
  path,
  name,
  archived,
  compact,
  deleteBody,
  onDeleted,
}: {
  /** The row's API path; `PATCH { archived }` and `DELETE` work on it. */
  path: string;
  name: string;
  archived: boolean;
  /** Icon buttons, for a table row. */
  compact?: boolean;
  /** What deleting this one does, when there is more to say. */
  deleteBody?: string;
  /** Leave the row's page; awaited, so the refresh doesn't refetch the deleted row. */
  onDeleted?: () => unknown;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ask, setAsk] = useState<Action | null>(null);
  const run = useMutation({
    mutationFn: async (action: Action) => {
      if (action !== "delete") return api("PATCH", path, { archived: action === "archive" });
      await api("DELETE", path);
      await onDeleted?.();
    },
    onSuccess: () => {
      setAsk(null);
      // Rows of other modules name this one, and archive resolves its alerts. Not awaited: the
      // action is done, and a page's slow queries mustn't hold up the next click.
      void qc.invalidateQueries();
    },
  });
  const start = (action: Action) => {
    run.reset();
    setAsk(action);
  };
  const go = (action: Action) => {
    if (run.isPending) return;
    setAsk(action);
    run.mutate(action);
  };

  const error = run.error instanceof ApiError ? run.error : undefined;
  const blocked = ask && error?.code === "in_use" ? (error.details as InUseDetails) : null;
  const message = run.isError && !blocked && (
    <p role="alert" className="text-bad">
      {t(ERRORS[error?.code ?? ""] ?? "common:archive.errors.generic")}
    </p>
  );
  const cancel = () => setAsk(null);

  const button = (action: Action, onClick: () => void) => {
    const { Icon, label, named } = BUTTONS[action];
    return compact ? (
      <Button
        variant="ghost"
        className="px-2"
        aria-label={t(named, { name })}
        title={t(label)}
        onClick={onClick}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
    ) : (
      <Button onClick={onClick}>{t(label)}</Button>
    );
  };

  return (
    <>
      {archived
        ? button("restore", () => go("restore"))
        : button("archive", () => start("archive"))}
      {button("delete", () => start("delete"))}
      {blocked ? (
        <ConfirmDialog
          open
          title={t("common:archive.blockedTitle", { name })}
          description={t(archived ? "common:archive.blockedArchived" : "common:archive.blocked")}
          confirmLabel={t("common:archive.actions.archive")}
          onCancel={cancel}
          onConfirm={archived ? undefined : () => go("archive")}
        >
          <Dependents details={blocked} onLeave={cancel} />
        </ConfirmDialog>
      ) : ask === "archive" ? (
        <ConfirmDialog
          open
          title={t("common:archive.archiveTitle", { name })}
          description={t("common:archive.archiveBody")}
          confirmLabel={t("common:archive.actions.archive")}
          onCancel={cancel}
          onConfirm={() => go("archive")}
        >
          {message}
        </ConfirmDialog>
      ) : ask === "delete" ? (
        <ConfirmDialog
          open
          destructive
          title={t("common:archive.deleteTitle", { name })}
          description={deleteBody ?? t("common:archive.deleteBody")}
          confirmLabel={t("common:archive.actions.delete")}
          onCancel={cancel}
          onConfirm={() => go("delete")}
        >
          {message}
        </ConfirmDialog>
      ) : (
        ask === "restore" &&
        run.isError && (
          <ConfirmDialog
            open
            title={t("common:archive.restoreTitle", { name })}
            description=""
            onCancel={cancel}
          >
            {message}
          </ConfirmDialog>
        )
      )}
    </>
  );
}

// Static keys so `pnpm i18n:check` sees them.
const BULK_TEXT = {
  archive: {
    button: "common:bulk.actions.archive",
    title: "common:bulk.archiveTitle",
    body: "common:archive.archiveBody",
    result: "common:bulk.archived",
  },
  restore: {
    button: "common:bulk.actions.restore",
    title: "common:bulk.restoreTitle",
    body: "common:bulk.restoreBody",
    result: "common:bulk.restored",
  },
  delete: {
    button: "common:bulk.actions.delete",
    title: "common:bulk.deleteTitle",
    body: "common:bulk.deleteBody",
    result: "common:bulk.deleted",
  },
} as const;

/** What a bulk action needs of a selected row, which may be on another page. */
export type BulkRow = { id: string; name: string; archived: boolean };

/**
 * The bar above a list with selected rows: Archive, Restore or Delete them after a confirm. Rows it
 * couldn't do stay selected and are listed with why (ADR-0018).
 */
export function BulkBar({
  kind,
  rows,
  onClear,
  onDone,
}: {
  kind: BulkKind;
  rows: BulkRow[];
  onClear: () => void;
  /** The ids that are still selected: the blocked ones. */
  onDone: (blocked: string[]) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [ask, setAsk] = useState<BulkItemAction | null>(null);
  const [outcome, setOutcome] = useState<{
    action: BulkItemAction;
    total: number;
    names: Map<string, string>;
    result: BulkResult;
  } | null>(null);
  const targets = (action: BulkItemAction) =>
    action === "delete" ? rows : rows.filter((r) => r.archived === (action === "restore"));
  const run = useMutation({
    mutationFn: (action: BulkItemAction) =>
      api<BulkResult>("POST", `/api/bulk/${kind}`, {
        action,
        ids: targets(action).map((r) => r.id),
      }),
    onSuccess: (result, action) => {
      setAsk(null);
      if (result.blocked.length)
        setOutcome({
          action,
          total: targets(action).length,
          names: new Map(rows.map((r) => [r.id, r.name])),
          result,
        });
      onDone(result.blocked.map((b) => b.id));
      void qc.invalidateQueries();
    },
  });
  const close = () => setOutcome(null);

  return (
    <>
      <SelectionBar count={rows.length} onClear={onClear}>
        {(["archive", "restore", "delete"] as const).map((action) => {
          const count = targets(action).length;
          return count ? (
            <Button
              key={action}
              onClick={() => {
                run.reset();
                setAsk(action);
              }}
            >
              {t(BULK_TEXT[action].button, { count })}
            </Button>
          ) : null;
        })}
      </SelectionBar>
      {ask && (
        <ConfirmDialog
          open
          destructive={ask === "delete"}
          title={t(BULK_TEXT[ask].title, { count: targets(ask).length })}
          description={t(BULK_TEXT[ask].body)}
          confirmLabel={run.isPending ? t("common:bulk.working") : t(BUTTONS[ask].label)}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            if (!run.isPending) run.mutate(ask);
          }}
        >
          {run.isError && (
            <p role="alert" className="text-bad">
              {t("common:archive.errors.generic")}
            </p>
          )}
        </ConfirmDialog>
      )}
      {outcome && (
        <ConfirmDialog
          open
          title={t(BULK_TEXT[outcome.action].result, {
            done: outcome.result.done.length,
            total: outcome.total,
          })}
          description={t("common:bulk.blocked")}
          onCancel={close}
        >
          <ul className="grid max-h-96 gap-3 overflow-y-auto">
            {outcome.result.blocked.map((b) => (
              <li key={b.id} className="grid gap-1">
                <span className="font-medium wrap-anywhere">{outcome.names.get(b.id)}</span>
                {b.details ? (
                  <Dependents details={b.details} onLeave={close} />
                ) : (
                  <span className="text-bad">
                    {t(ERRORS[b.code] ?? "common:archive.errors.generic")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </>
  );
}

/** A list's last column: `ArchiveActions` for the row, to those who may. It also offers selection. */
export const archiveColumn = <T extends { id: string; archivedAt: string | null }>(
  t: TFunction,
  o: {
    kind: BulkKind;
    can: Permission;
    level?: PermissionLevel;
    name: (row: T) => string;
    when?: (row: T) => boolean;
  },
): Column<T> => ({
  id: "actions",
  header: t("common:table.actions"),
  bulk: { kind: o.kind, name: o.name, when: o.when },
  cell: (r) => (
    <Write can={o.can} level={o.level} when={o.when?.(r)}>
      <ArchiveActions
        compact
        path={`${BULK_ITEMS[o.kind].path}/${r.id}`}
        name={o.name(r)}
        archived={r.archivedAt !== null}
      />
    </Write>
  ),
});
