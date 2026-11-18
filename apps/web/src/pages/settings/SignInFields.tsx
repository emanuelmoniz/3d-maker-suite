import type { IntegrationErrorCode, LoginChallenge } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ERRORS } from "./integrationLabels.ts";

// Literal keys so `pnpm i18n:check` sees them.
const CHALLENGES: Record<LoginChallenge, string> = {
  email_code: "integrations:login.email_code",
  totp: "integrations:login.totp",
};

/** What a sign-in step sends: email + password, or the code the vendor asked for. */
export const signInValues = (
  form: HTMLFormElement,
  challenge?: LoginChallenge,
): { code: string } | { email: string; password: string } => {
  const f = new FormData(form);
  return challenge
    ? { code: String(f.get("signIn.code") ?? "").trim() }
    : {
        email: String(f.get("signIn.email") ?? "").trim(),
        password: String(f.get("signIn.password") ?? ""),
      };
};

/**
 * An account's sign-in in its own form (6.1.0 Step 10c): email and password, then the code step in
 * place. The Add form and the Edit page's Sign in block.
 */
export function SignInFields({
  challenge,
  failed,
  expired,
  error,
}: {
  challenge?: LoginChallenge;
  /** What the vendor said about the last step. */
  failed?: IntegrationErrorCode;
  /** The code step timed out: back to the password. */
  expired?: boolean;
  /** The request itself failed. */
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4">
      {challenge ? (
        <>
          <p className="text-muted">{t(CHALLENGES[challenge])}</p>
          <FormField label={t("integrations:login.code")}>
            {(p) => (
              <input
                {...p}
                // A new field for the code step, so the browser doesn't fill in the password.
                key="code"
                name="signIn.code"
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                className={inputClass}
              />
            )}
          </FormField>
        </>
      ) : (
        <>
          <FormField label={t("integrations:login.email")}>
            {(p) => (
              <input
                {...p}
                name="signIn.email"
                type="email"
                required
                autoComplete="username"
                className={inputClass}
              />
            )}
          </FormField>
          <FormField
            label={t("integrations:login.password")}
            hint={t("integrations:login.passwordHint")}
          >
            {(p) => (
              <input
                {...p}
                name="signIn.password"
                type="password"
                required
                autoComplete="current-password"
                className={inputClass}
              />
            )}
          </FormField>
        </>
      )}
      {expired && (
        <p role="alert" className="text-bad">
          {t("integrations:login.expired")}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-bad">
          {t(ERRORS[failed])}
        </p>
      )}
      {error && (
        <p role="alert" className="text-bad">
          {t(error)}
        </p>
      )}
    </div>
  );
}
