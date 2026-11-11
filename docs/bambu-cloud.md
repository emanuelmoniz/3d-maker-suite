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
5. Click **Test connection** on the account. You should see your printers listed.

The app stores only the access token, encrypted on disk (see [ADR-0005](adr/0005-secrets-storage.md)).

## Your accounts

The **Bambu Cloud** card on the Integrations page has one block per account, with **Add another account** at the top. Each block shows the account's photo (or its initials), name, email and region, and whether it is signed in. **Sign in again** and **Test connection** sit next to the name. **More actions** turns the account off or deletes it.

The name, email and photo are read from your Bambu profile when you sign in and on each sync. If that read fails, the last values stay and the sync goes on. The server downloads the photo from `public-cdn.bblmw.com` and keeps a copy, so your browser never calls Bambu. On a NAS or server with a firewall, allow that host too, or the card shows initials.

**Allow** has one switch per type: Printers, Prints, Spools and User presets. Next to each switch that is on is a link to that type's settings. Turning one off asks first, stops syncing that type from this account and keeps everything already imported. Turning it on again brings back the default schedule.

Each allowed type is set on that type's **Settings → Sources** tab: **Printers**, **Prints** and **Filament** (spools), and **Presets** for user presets. There, each account has a block with one line per type. The line's switch turns the sync off or on again, and **Edit** opens its settings: when it runs, what and how to sync, new spools, track usage, alerts and what editors may do. The line's **⋯** menu has **Sync now**, **Review and import** (with how many rows wait) and the sync log. For print history, it also has **Review and import a period…**. An editor whose role lets them sync or review a type reaches that tab from the gear on the type's page and sees only those tasks.

## What syncs

- **Printers:** new printers are added; existing ones keep your notes and settings. A printer you added by hand with the same serial number is linked to the cloud one, not duplicated.
- **Print history:** finished prints since the last sync. Prints started from the phone app or while the PC was off are included.
- **Spools:** the filament manager's spools, each with its brand, material, name (`PLA Basic`), colour and colour name. No filament preset is made for them.
- **User presets (optional):** the machine, print and filament presets you saved in Bambu Studio, read from your account and never written back. Each kind has its own card under **User presets**, Manual and daily until you change it. They become the same `bambu-studio:user/<name>` rows as Studio's own, so a preset the app already has from Studio is counted once. An edit in Studio updates the row on the next run and keeps the values you typed, such as a price. A preset you delete in Studio raises a **Sync needs review** alert: **Delete** removes the row when nothing uses it, **Archive** keeps one you edited, and a used one stays with the reason shown. Presets that came from a slicer zip are never touched. On a hub the account's presets reach workers and Install devices like any other ([docs/hub.md](hub.md#bambu-cloud-and-orcacloud)).

Each slot of a print is matched to a spool by material and colour. A match only counts when exactly one active spool fits and it wasn't bought after the print. A print older than the spool's entry in the app gets the spool but takes nothing off it, because the weight you entered already includes it. A print with a slot that matches no single spool is not imported on its own. It waits under "Review and import" for print history, and "Sync now" opens that screen when anything is waiting. Once imported, its open slots go to **Prints → Filament to review**, and they are matched again on every sync.

By default print history syncs every hour and printers every day. **Review and import** opens the review screen with what the integration offers; printers and spools can also be imported that way. To sync one now, use **Sync now** on the type's line in its **Settings → Sources**. Each sync reports its result as an alert: new and updated rows, rows waiting for review, or an error. Spools are imported by hand unless you set them to automatic.

## Spools: why they are off by default

Spools sync is **off** when you add the integration (integrations added earlier keep their setting). Turn it on under **Filament → Settings → Sources** if you want it.

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
| Rate limited | Bambu slowed the requests | Wait an hour; sync pauses automatically |
| Refused this app's request | Bambu's Cloudflare protection rejected the app | If it keeps happening, update the app |
| API changed | Bambu changed its response format | Update the app; see [CONTRIBUTING.md](../CONTRIBUTING.md) |

Failed syncs raise a **sync failed** alert. The app keeps working without the cloud.

## Notes

The Bambu Cloud API is unofficial and can change without notice. The integration is isolated in `packages/adapters/bambu`, so an upstream change affects only that package.
