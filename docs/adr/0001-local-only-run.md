# ADR-0001: Run locally, bound to localhost

- Status: Accepted
- Date: 2026-10-08

## Context
3D Maker Suite manages one maker's printers, filament and projects. The data is personal, the 3MF files sit on the user's disk, and the slicer runs on the same PC. A hosted service or a container setup would add operational work the target user doesn't want.

## Decision
- The app runs as a single Node 22 process started with `pnpm start`. The process serves both the API and the built web app. There's no Docker for now.
- Fastify listens on **127.0.0.1 only**. There is no login in v1, because only the local user can reach the port.
- All state lives in one **data directory**:
  - Windows: `%APPDATA%\3d-maker-suite`
  - macOS: `~/Library/Application Support/3d-maker-suite`
  - Linux: `$XDG_DATA_HOME/3d-maker-suite` (fallback `~/.local/share/3d-maker-suite`)
  - Override: `APP_DATA_DIR`
- The path is resolved with `os.homedir()` and `process.platform`. That's a few lines of stdlib, so there's no `env-paths` dependency.
- The data dir holds `app.sqlite`, `secret.key`, `thumbnails/` and `backups/`. It lives outside the repo, so updating or re-cloning the app keeps the data.

## Consequences
- Setup and support stay simple, and nothing is exposed to the network.
- Phones and other devices on the LAN can't open the app. Allowing that needs a new ADR that adds an opt-in `0.0.0.0` bind **and** authentication (PIN or token).
- Backup is the user's job, using the backup feature (Step 23) or by copying the data dir.
- A future Docker image only has to mount the data dir and set `APP_DATA_DIR`.
