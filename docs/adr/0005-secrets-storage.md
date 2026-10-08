# ADR-0005: Secrets storage

- Status: Accepted
- Date: 2026-10-08

## Context
Integrations need credentials. Bambu Cloud, for example, needs an access token and a refresh token. The DB file gets copied into backups and may be shared when someone reports a bug, so tokens must not be readable from it. Background sync must work without the user typing anything at startup.

## Decision
- Secrets are encrypted with **AES-256-GCM** using `node:crypto`. There's no extra dependency.
- **Key:** 32 random bytes in `secret.key` in the data dir (ADR-0001). The key is created on first run with user-only permissions (`0600` on POSIX). On Windows the file inherits the user-profile ACL of `%APPDATA%`.
- **Storage:** each `Integration.secrets` value is stored as `{ v: 1, iv, tag, data }` (base64). A new 12-byte IV is generated for every encryption.
- Adapters only see a scoped `SecretStore` (`get`/`set`/`delete`). Plaintext never leaves the server process.
- **Never logged:** pino `redact` covers the secret fields and `authorization` headers.
- **Never returned:** API responses expose only `hasSecrets: boolean`.
- Backups/exports include the DB but **not** `secret.key`.

## Alternatives rejected
- **OS keychain** (`@napi-rs/keyring`): a native dependency, and it breaks on headless Linux.
- **Master passphrase:** background sync can't run until the user unlocks the app.

## Consequences
- A leaked DB or backup doesn't expose tokens.
- This does **not** protect against malware or anyone else who can log in as the user. That's accepted for a localhost app.
- If `secret.key` is lost, the user signs in to each integration again. No other data is lost.
- The `v` field allows a later key rotation or a move to the OS keychain.
