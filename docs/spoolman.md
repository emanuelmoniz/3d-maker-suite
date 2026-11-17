# Spoolman setup

The Spoolman integration connects the app to [Spoolman](https://github.com/Donkie/Spoolman), the self-hosted spool inventory. It works both ways:

- **Import:** your Spoolman spools come in as the app's spools, through the usual review.
- **Write usage back:** what each print takes from a spool is written to the Spoolman spool it came from, once.

The app's spool list stays its own: Spoolman is a source and a target, not the master ([ADR-0015](adr/0015-multi-brand-print-tracking.md#spoolman-two-way)). Your spools are charged as always, with or without Spoolman.

## Connect

1. Open **Integrations**, press **Add** and choose **Spoolman**.
2. Enter Spoolman's address: its IP or host name, with its port (`192.168.1.60:7912`). An `https://` address is used as typed.
3. An API key only if a reverse proxy in front of Spoolman asks for one (`x-api-key`). Spoolman itself has no sign-in.
4. Press **Test** to check the address and key before saving, then **Add**.

One Spoolman can be set up. Give it a **Name** (optional) to tell it apart: the card shows it instead of "Spoolman account", and so does the machine's page when Spoolman is reached through it. To change its name, address or key later, open **Edit** on its card: a key left empty keeps the stored one. The key is stored encrypted on disk ([ADR-0005](adr/0005-secrets-storage.md)).

## Import spools

On **Filament → Settings → Sources**, the Spoolman line imports your spools: **Sync now** brings in the new ones, and **Review and import** shows every spool before anything changes. A Spoolman spool becomes a spool with its brand (Spoolman's vendor), material, name (the filament's name) and colour hex, and its weights. Spoolman has no colour name, so that stays empty. Archived Spoolman spools are left out.

### A spool you already have

A spool can be in several libraries at once: Bambu Cloud's filament manager and Spoolman, for example. It is one spool in the app, linked to each of them, so you can use both:

- A Spoolman spool that could be one you already have is never imported as a new spool. If you entered the spool by hand, it is a spool with the same brand, material, name and colour. If another library brought it in, it only needs the same material and colour, because each library names a filament its own way ("Bambu" or "Bambu Lab", "Basic PLA" or "PLA Basic").
- Such a spool waits in the review with **Maybe a spool you have: update links it**. Check it is the same roll, then update it: that links it. Your spool keeps its brand, name and weight. When several of your spools fit, you pick one. When none is the same roll, import it as new.
- Once linked, a re-import from either library finds the spool by its link, and makes no second spool.
- It works the other way round too: a Bambu Cloud spool that is already in the app from Spoolman waits to be linked the same way.

While a Spoolman spool waits to be linked, the app doesn't add your spool to Spoolman a second time.

The spool's page lists each library it is in. **Unlink** lets go of one and keeps the others. After that, the library's spool isn't linked to it again and isn't imported as a new spool: its next import shows it as skipped, and you can still link it or import it in the review. A spool you unlinked from Spoolman isn't added there again.

### Track usage

Leave **Track usage** off on the spools line (the default): the app keeps its own remaining weight, and Spoolman's is what the app writes back. Only one library should set a spool's weight: if two spools lines track usage, the line you edit warns you.

## Write usage back

**Write usage back** on the Spoolman card is on by default. With it on:

- A print charged to a spool linked to Spoolman is written to that Spoolman spool: its used weight goes up by the print's grams. That includes a spool that came from Bambu Cloud first.
- A print on a spool of yours that isn't in Spoolman yet adds it there the first time a print uses it after Spoolman was set up. This includes a spool that is only in Bambu Cloud. The app finds or creates the vendor and the filament (brand, material, name and colour) and adds the spool with its current weights.
- An edit of a print's grams writes the difference, and a print you delete gives its grams back to the Spoolman spool, as it does to yours.
- Prints from before a spool was linked aren't written: Spoolman already has its own history for that spool.
- A print Moonraker already reported to Spoolman is never written again ([moonraker.md](moonraker.md#grams-and-spools)). Every other print is: Bambu, Prusa, OctoPrint, a Klipper printer that doesn't report to Spoolman, or a print you entered by hand.
- A backlog import whose spools were already up to date isn't written either.

When Spoolman can't be reached, the card says how many charges are waiting. They are tried again every minute, and nothing is lost or written twice.

### How a print is written only once

Spoolman's API has no idempotency key, so the app keeps one itself:

- Every print slot has a key, the print's id and its slot. The app remembers what it last confirmed each Spoolman spool holds per key, and sends only the difference. A retry or a restart finds nothing new to send.
- Each write sets the spool's used weight and, in the same request, a field named **3D Maker Suite** on the spool, with the grams it holds per key. So if Spoolman took a write but its answer was lost, the next try reads the field, sees the charge is there, and stops. The app adds the field to Spoolman's spool fields the first time it writes. Leave it as it is.

A write reads the spool, then writes it. So that a report Moonraker sends in between is never lost, a Spoolman spool isn't written while a Klipper printer prints with it, nor in the minute after: its charges wait for the next try. This needs **Live status** on for that Moonraker; a Moonraker the app only reads by its history can't say what it prints. With several tools Moonraker doesn't say which spool each uses, so while it prints, nothing is written to Spoolman at all.

### Spoolman on another network

A hub on a VPS reaches a Spoolman on your LAN through a machine there: pick it under **Reached from** when you add Spoolman ([hub.md](hub.md#spoolman-through-a-connector)). The import and the write-back work as above, with the same keys, so nothing is written twice. While the machine is offline, the charges wait on the hub and go when it is back.

## Troubleshooting

- **Can't be reached:** open `http://<address>/api/v1/info` in a browser on the server's machine (on the machine it is reached through, for a hub on another network); it answers with Spoolman's version. In Docker on a bridged network, use the IP, not a `.local` name.
- **A charge keeps waiting:** the integrations log says why ([logs.md](logs.md)). A Spoolman spool you deleted is skipped, and the log names it.
