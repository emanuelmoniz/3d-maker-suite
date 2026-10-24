import { Link, useSearch } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { safeNext, useLogin, useSetup } from "../../lib/auth.ts";

// Keys written out in full so `pnpm i18n:check` can see them.
const LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: "users:login.errors.invalid_credentials",
  too_many_attempts: "users:login.errors.too_many_attempts",
  user_disabled: "users:login.errors.user_disabled",
};
const SETUP_ERRORS: Record<string, string> = {
  setup_token: "users:setup.errors.setup_token",
  setup_done: "users:setup.errors.setup_done",
};

/** Centered card without the app shell: nothing behind a login may load. */
function AuthCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5 sm:p-6">
        <div className="mb-5 flex items-center gap-2.5 font-semibold">
          <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
            <Printer className="size-4.5" aria-hidden />
          </span>
          {t("common:appName")}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {hint && <p className="mt-1 text-muted">{hint}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

export function LoginPage() {
  const { t } = useTranslation();
  const next = safeNext(useSearch({ strict: false }).next);
  const login = useLogin(next);
  const code = login.error instanceof ApiError ? login.error.code : undefined;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    login.mutate({ email: field(f, "email"), password: field(f, "password") });
  };
  return (
    <AuthCard title={t("users:login.title")}>
      <form onSubmit={submit} className="grid gap-4">
        <FormField label={t("users:fields.email")}>
          {(p) => (
            <input
              {...p}
              name="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.password")}>
          {(p) => (
            <input
              {...p}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          )}
        </FormField>
        {login.isError && (
          <p role="alert" className="text-bad">
            {t(LOGIN_ERRORS[code ?? ""] ?? "users:login.errors.generic")}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={login.isPending || login.isSuccess}>
          {t("users:login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

/** First run: creates the admin. Open to anyone only while no account exists (the server checks). */
export function SetupPage() {
  const { t } = useTranslation();
  const setup = useSetup();
  const [mismatch, setMismatch] = useState(false);
  const code = setup.error instanceof ApiError ? setup.error.code : undefined;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const bad = field(f, "password") !== field(f, "confirm");
    setMismatch(bad);
    if (bad) return;
    setup.mutate({
      displayName: field(f, "displayName"),
      email: field(f, "email"),
      password: field(f, "password"),
      token: field(f, "token") || undefined,
    });
  };
  return (
    <AuthCard title={t("users:setup.title")} hint={t("users:setup.hint")}>
      <form onSubmit={submit} className="grid gap-4">
        <FormField label={t("users:fields.displayName")}>
          {(p) => (
            <input
              {...p}
              name="displayName"
              autoComplete="name"
              required
              maxLength={100}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.email")}>
          {(p) => (
            <input
              {...p}
              name="email"
              type="email"
              autoComplete="username"
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
        {code === "setup_token" && (
          <FormField label={t("users:setup.token")} hint={t("users:setup.tokenHint")}>
            {(p) => <input {...p} name="token" required className={inputClass} />}
          </FormField>
        )}
        {setup.isError && (
          <p role="alert" className="text-bad">
            {t(SETUP_ERRORS[code ?? ""] ?? "users:setup.errors.generic")}
          </p>
        )}
        {code === "setup_done" && (
          <Link to="/login" className="font-medium text-accent hover:underline">
            {t("users:setup.toLogin")}
          </Link>
        )}
        <Button type="submit" variant="primary" disabled={setup.isPending || setup.isSuccess}>
          {t("users:setup.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
