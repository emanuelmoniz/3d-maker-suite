# Bambu Cloud setup

The Bambu Cloud integration reads your printers, print history and filament spools from your Bambu account. It is optional. Manual entry always works.

## What it needs

- A Bambu Lab account that already has your printers bound (through Bambu Studio or Bambu Handy)
- An internet connection on the PC running the app

No LAN mode, developer mode or access code is needed.

## Connect

1. Open **Integrations** and choose **Bambu Cloud**.
2. Pick your region: **Global** or **China**.
3. Enter your account email and password. The password is sent to Bambu once and never stored.
4. If Bambu asks for a verification code (email or 2FA), enter it.
5. Click **Test**. You should see your printers listed.

The app stores only the access token, encrypted on disk (see [ADR-0005](adr/0005-secrets-storage.md)).

## What syncs

- **Printers:** new printers are added; existing ones keep your notes and settings.
- **Print history:** finished prints since the last sync. Prints started from the phone app or while the PC was off are included.
- **Spools:** the filament manager's spools, matched to your profiles.

Sync runs every 15 minutes by default (change it per integration on the Integrations page, or switch it off). You can also sync printers or prints on their own, and re-import print history for a date range.

## When it stops working

| Message | Meaning | What to do |
|---|---|---|
| Sign-in expired | Tokens last about 3 months | Sign in again on the Integrations page |
| Rate limited / blocked | Bambu slowed or challenged the requests | Wait an hour; sync pauses automatically |
| API changed | Bambu changed its response format | Update the app; see [CONTRIBUTING.md](../CONTRIBUTING.md) |

Failed syncs raise a **sync failed** alert. The app keeps working without the cloud.

## Notes

The Bambu Cloud API is unofficial and can change without notice. The integration is isolated in `packages/adapters/bambu`, so an upstream change affects only that package.
