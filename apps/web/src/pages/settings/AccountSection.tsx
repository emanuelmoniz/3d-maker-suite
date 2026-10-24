import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { useMe, useUpdateMe } from "../../lib/auth.ts";

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

/** Your own name and password (`PATCH /api/auth/me`); only while accounts exist. */
export function AccountSection() {
  const { t } = useTranslation();
  const user = useMe();
  const rename = useUpdateMe();
  const change = useUpdateMe();
  const [mismatch, setMismatch] = useState(false);
  if (!user) return null;

  const wrong = change.error instanceof ApiError && change.error.code === "wrong_password";
  const submitName = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    rename.mutate({ displayName: field(new FormData(e.currentTarget), "displayName") });
  };
  const submitPassword = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const bad = field(f, "password") !== field(f, "confirm");
    setMismatch(bad);
    if (bad) return;
    change.mutate(
      { currentPassword: field(f, "currentPassword"), password: field(f, "password") },
      { onSuccess: () => form.reset() },
    );
  };

  return (
    <div className="grid gap-6">
      <form onSubmit={submitName} className="grid gap-4">
        <FormField label={t("users:fields.displayName")}>
          {(p) => (
            <input
              {...p}
              name="displayName"
              key={user.displayName}
              defaultValue={user.displayName}
              autoComplete="name"
              required
              maxLength={100}
              className={inputClass}
            />
          )}
        </FormField>
        {rename.isError && (
          <p role="alert" className="text-bad">
            {t("users:account.error")}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={rename.isPending}
          className="justify-self-start"
        >
          {t("common:actions.save")}
        </Button>
      </form>

      <form onSubmit={submitPassword} className="grid gap-4 border-t border-border pt-5">
        <h3 className="font-medium">{t("users:account.passwordTitle")}</h3>
        <FormField
          label={t("users:account.currentPassword")}
          error={wrong ? t("users:account.wrongPassword") : undefined}
        >
          {(p) => (
            <input
              {...p}
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.newPassword")} hint={t("users:fields.passwordHint")}>
          {(p) => (
            <input
              {...p}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={256}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField
          label={t("users:fields.confirmPassword")}
          error={mismatch ? t("users:fields.mismatch") : undefined}
        >
          {(p) => (
            <input
              {...p}
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className={inputClass}
            />
          )}
        </FormField>
        {change.isError && !wrong && (
          <p role="alert" className="text-bad">
            {t("users:account.error")}
          </p>
        )}
        {change.isSuccess && (
          <p role="status" className="text-muted">
            {t("users:account.passwordChanged")}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={change.isPending}
          className="justify-self-start"
        >
          {t("users:account.changePassword")}
        </Button>
      </form>
    </div>
  );
}
