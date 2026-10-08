# ADR-0004: Internationalization strategy

- Status: Accepted
- Date: 2026-10-08

## Context
v1 ships in English only, but the code must be ready for more languages without rewrites. Hard-coded strings and sentences built by string concatenation are the usual blockers.

## Decision
- **i18next + react-i18next** in `apps/web`.
- Keys live in `apps/web/src/locales/<lng>/<namespace>.json`, with one namespace per feature (`common`, `printers`, `filament`, …). Components use `t('ns:key')`. The app name is `common:appName`.
- **No user-facing literal strings in components.** Full sentences use interpolation (`{{count}} prints`), never string concatenation.
- **Plurals** use i18next's built-in suffix plurals (`key_one`, `key_other`, …). These are resolved through `Intl.PluralRules`, so every CLDR language gets the right categories without an extra dependency. `i18next-icu` is added only if we need nested select/plural messages.
- **Formatting** is done only with `Intl`:
  - dates and times: `Intl.DateTimeFormat`
  - numbers, currency, units: `Intl.NumberFormat`
  - relative time: `Intl.RelativeTimeFormat`
  - Values are stored in base units (ADR-0002, architecture conventions) and formatted at render time.
- **The API never returns prose.** Errors are `{ code, params }`, and the web side translates `errors:<code>`. Adapter errors use `IntegrationErrorCode` (ADR-0003).
- `pnpm i18n:check` fails CI on missing or unused keys.

## Consequences
- Adding a language means adding a locale folder, with no code changes.
- Server logs stay in English, because they're for developers, not users.
- Translators get flat JSON files that existing tools understand.
- Plural forms with explicit category suffixes are slightly more verbose than ICU syntax.
