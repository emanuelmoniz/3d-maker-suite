import { type Integration, isAction } from "@3d-maker-suite/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Menu } from "../../components/Menu.tsx";
import { Switch } from "../../components/Switch.tsx";
import { useCan } from "../../lib/auth.ts";
import { cx } from "../../lib/cx.ts";
import { formatDateTime, formatRelative } from "../../lib/format.ts";
import {
  sourceNoun,
  sourceTaken,
  useAdapterName,
  useAdapters,
  useDeleteIntegration,
  usePatchIntegration,
  useTestIntegration,
} from "../../lib/integrations.ts";
import { ADD_KEYS, badgeOf, COUNT_KEYS, FoldCard } from "./FoldCard.tsx";
import { ERRORS } from "./integrationLabels.ts";
import { ActionSwitches } from "./PolicyRow.tsx";
import { RemoveIntegration } from "./RemoveIntegration.tsx";
import { SyncSources } from "./Sources.tsx";

/** One card per API (ADR-0021): a block per account, the Add button on the right while open. */
export function AccountsCard({
  adapterId,
  rows,
  reveal,
  scroll,
  via,
}: {
  adapterId: string;
  rows: Integration[];
  reveal: boolean;
  scroll?: string | true;
  /** The machine the page was opened for: the Add form preselects it. */
  via?: string;
}) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const admin = useCan("integrations.manage");
  const adapter = useAdapters().data?.find((a) => a.id === adapterId);
  const noun = sourceNoun(adapter);
  return (
    <FoldCard
      id={adapterId}
      title={adapterName(adapterId)}
      count={t(COUNT_KEYS[noun], { count: rows.length })}
      badge={badgeOf(rows)}
      reveal={reveal}
      scroll={scroll}
      menu={<RemoveIntegration library={adapterId} rows={rows} name={adapterName(adapterId)} />}
      action={
        admin &&
        !sourceTaken(adapter, rows) && (
          <Link
            to="/integrations/new"
            search={{ product: adapterId, ...(via && { via }) }}
            className="inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-md border border-border px-3 font-medium hover:bg-surface-2"
          >
            <Plus aria-hidden className="size-4" />
            {t(ADD_KEYS[noun])}
          </Link>
        )
      }
    >
      <ul className="divide-y divide-border">
        {rows.map((i) => (
          <AccountBlock key={i.id} integration={i} />
        ))}
      </ul>
      {/* For the whole card: every account's types are on the same Sources tabs (ADR-0021). */}
      <SyncSources types={rows.flatMap((i) => i.policies.map((p) => p.type))} />
    </FoldCard>
  );
}

/** Up to two letters of the account's name, or of the email's name part. */
export const initialsOf = (text: string) =>
  text
    .split("@")[0]
    ?.split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase())
    .join("") || "?";

/** The account's photo through the server, else its initials. */
export function Avatar({ integration: i, text }: { integration: Integration; text: string }) {
  const [failed, setFailed] = useState(false);
  return i.account?.avatar && !failed ? (
    <img
      src={`/api/integrations/${i.id}/avatar?v=${encodeURIComponent(i.updatedAt)}`}
      alt=""
      onError={() => setFailed(true)}
      className="size-10 rounded-full border border-border object-cover"
    />
  ) : (
    <span
      aria-hidden
      className="grid size-10 place-items-center rounded-full bg-accent/15 font-semibold text-accent"
    >
      {initialsOf(text)}
    </span>
  );
}

function AccountBlock({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  const navigate = useNavigate();
  const adapter = useAdapters().data?.find((a) => a.id === i.adapterId);
  const admin = useCan("integrations.manage");
  const patch = usePatchIntegration(i.id);
  const test = useTestIntegration(i.id);
  const remove = useDeleteIntegration(i.id);
  const [deleting, setDeleting] = useState(false);
  const heading = useId();

  const account = i.account;
  const title =
    account?.name ||
    account?.email ||
    t("integrations:account.untitled", { adapter: adapterName(i.adapterId) });
  const region = (i.config as { region?: unknown } | undefined)?.region;
  const signedOut =
    !i.hasSecrets || i.lastError === "auth_expired" || i.lastError === "auth_required";
  const login = admin && i.enabled && adapter?.login;
  const failed = [patch, remove].some((m) => m.isError);

  const state = !i.enabled ? "disabled" : i.status;
  const status =
    state === "disabled" ? (
      t("integrations:account.disabledHint")
    ) : state === "syncing" ? (
      t("integrations:card.syncing")
    ) : state === "error" && i.lastError ? (
      t(ERRORS[i.lastError])
    ) : i.lastSyncAt ? (
      <time dateTime={i.lastSyncAt} title={formatDateTime(i.lastSyncAt)}>
        {t("integrations:card.lastSync", { date: formatRelative(i.lastSyncAt) })}
      </time>
    ) : (
      t("integrations:card.never")
    );

  return (
    <li
      id={`integration-${i.id}`}
      aria-labelledby={heading}
      className="grid scroll-mt-4 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 py-4 first:pt-0 last:pb-0"
    >
      <Avatar integration={i} text={account?.name || account?.email || title} />
      <div className="grid min-w-0 gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={heading} className="min-w-0 wrap-anywhere text-base font-semibold">
              {title}
            </h3>
            {adapter?.login && i.enabled && (
              <span
                className={cx(
                  "inline-block shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                  signedOut ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok",
                )}
              >
                {signedOut ? t("integrations:account.signedOut") : t("integrations:card.signedIn")}
              </span>
            )}
          </div>
          {admin && (
            <div className="flex flex-wrap items-center gap-2">
              {login && (
                <Button
                  variant={signedOut ? "primary" : "secondary"}
                  onClick={() => navigate({ to: "/integrations/$id/login", params: { id: i.id } })}
                >
                  {i.hasSecrets
                    ? t("integrations:card.signInAgain")
                    : t("integrations:card.signIn")}
                </Button>
              )}
              {i.enabled && !signedOut && (
                <Button disabled={test.isPending} onClick={() => test.mutate()}>
                  {t("integrations:card.test")}
                </Button>
              )}
              <Switch
                label={t("integrations:card.enabled")}
                aria-label={t("integrations:account.enabledOf", { name: title })}
                checked={i.enabled}
                disabled={patch.isPending}
                onChange={(e) => patch.mutate({ enabled: e.target.checked })}
              />
              <Menu label={t("integrations:card.menu", { name: title })}>
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => navigate({ to: "/integrations/$id/edit", params: { id: i.id } })}
                >
                  {t("integrations:card.edit")}
                </Button>
                <Button
                  variant="ghost"
                  className="justify-start text-bad"
                  onClick={() => setDeleting(true)}
                >
                  {t("integrations:card.delete")}
                </Button>
              </Menu>
            </div>
          )}
        </div>
        {(account?.name && account.email) || typeof region === "string" ? (
          <p className="wrap-anywhere text-muted">
            {[
              account?.name && account.email,
              typeof region === "string" &&
                t(`integrations:adapters.${i.adapterId}.options.region.${region}`, {
                  defaultValue: "",
                }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {i.viaDeviceName && (
          <p className="wrap-anywhere text-muted">
            {t("integrations:account.through", { machine: i.viaDeviceName })}
          </p>
        )}
        <p
          role={state === "error" ? "alert" : undefined}
          className={cx("flex items-start gap-2", state === "error" ? "text-bad" : "text-muted")}
        >
          <span
            aria-hidden
            className={cx(
              "mt-1.5 size-2 shrink-0 rounded-full",
              state === "error"
                ? "bg-bad"
                : state === "ok"
                  ? "bg-ok"
                  : state === "syncing"
                    ? "bg-accent"
                    : "bg-border",
            )}
          />
          <span>{status}</span>
        </p>
        {test.data && (
          <p role="status" className={test.data.ok ? "text-ok" : "text-bad"}>
            {test.data.ok ? t("integrations:card.testOk") : t(ERRORS[test.data.code])}
          </p>
        )}
        {failed && (
          <p role="alert" className="text-bad">
            {t("integrations:card.actionError")}
          </p>
        )}

        {admin && i.enabled && i.policies.some((p) => isAction(p.type)) && (
          <div className="mt-3 grid gap-3">
            <ActionSwitches integration={i} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleting}
        title={t("integrations:deleteDialog.title", { name: title })}
        description={t("integrations:deleteDialog.body")}
        confirmLabel={t("integrations:card.delete")}
        destructive
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          remove.mutate();
        }}
      />
    </li>
  );
}
