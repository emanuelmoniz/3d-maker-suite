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

Each slot of a print is matched to a spool by material and colour. A match only counts when exactly one active spool fits and it wasn't bought after the print. A print older than the spool's entry in the app gets the spool but takes nothing off it, because the weight you entered already includes it. A print with a slot that matches no single spool is not imported on its own. It waits under "Review and import" for print history, and "Sync now" opens that screen when anything is waiting. Once imported, its open slots go to **Prints → Filament to review**, and they are matched again on every sync.

By default print history syncs every hour and printers every day. On the Integrations page each type has its own mode (off, manual, automatic) and frequency, a "Sync now" button, and for print history a date range to re-import. The Printers, Prints and Filament pages each have a **Sync from Bambu Cloud** button for their own type. Each sync reports its result as an alert: new and updated rows, rows waiting for review, or an error. Spools are imported by hand unless you set them to automatic; then only spools with exactly one matching filament profile are imported and the rest waits for you under "Review and import".

## Spools: why they are off by default

Spools sync is **off** when you add the integration (integrations added earlier keep their setting). Turn it on under **Integrations → Sync** if you want it.

The remaining weight Bambu reports is an estimate, not a measurement:

- The AMS has no scale. It counts the filament it feeds out and the turns of the spool, and works out the rest from the spool's size ([how the printer knows](https://forum.bambulab.com/t/how-does-the-printer-know-how-much-filament-is-left-on-the-spool/18200?page=3), [estimation guidelines](https://forum.bambulab.com/t/ams-filament-estimation-guide-lines/238750)).
- It is only close for Bambu spools. Third-party spools differ in diameter, width and winding, and have no RFID tag ([non-Bambu filament](https://forum.bambulab.com/t/ams-estimate-remaining-filament-for-non-bambu-filaments/2404), [calculating the remains](https://forum.bambulab.com/t/calculating-the-remains-on-a-spool/123429)).
- The Filament Manager sometimes stops updating, or goes back to 1000 g, also with Bambu spools ([AMS 2 Pro not updating](https://forum.bambulab.com/t/filament-manager-recognising-but-not-updating-ams2-pro/255257), [Filament Manager problem](https://forum.bambulab.com/t/problem-with-filament-manager-at-bambu-lab-studio/256589)).
- Studio's local copy can differ from the cloud (BambuStudio#10766).
- Tools like [SimplyPrint](https://simplyprint.io/features/filament-management/nfc/bambu-lab) take usage from the prints for spools without RFID.

**Track usage on spools** (on by default once spools sync is on) replaces the weight of spools you already have with Bambu's. Switch it off to keep the weight your prints took off: spools sync then only adds and links spools. Tracking usage from both prints and spools at the same time is not recommended. The weight is overwritten or counted twice, and the Integrations page warns you.

## When it stops working

| Message | Meaning | What to do |
|---|---|---|
| Sign-in expired | Tokens last about 3 months | Sign in again on the Integrations page |
| Rate limited / blocked | Bambu slowed or challenged the requests | Wait an hour; sync pauses automatically |
| API changed | Bambu changed its response format | Update the app; see [CONTRIBUTING.md](../CONTRIBUTING.md) |

Failed syncs raise a **sync failed** alert. The app keeps working without the cloud.

## Notes

The Bambu Cloud API is unofficial and can change without notice. The integration is isolated in `packages/adapters/bambu`, so an upstream change affects only that package.
