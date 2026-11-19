# Spoolman

Connects the app to [Spoolman](https://github.com/Donkie/Spoolman), the self-hosted spool inventory. It works both ways:

- **Import:** your Spoolman spools come in as the app's spools, through the usual review.
- **Write usage back:** what each print takes from a spool is written to the Spoolman spool it came from, once.

The app's spool list stays its own. Spoolman is a source and a target, not the master. Your spools are charged as always, with or without Spoolman.

![The Integrations page with an account card open](../docs/images/wiki-integrations.png)

## Who can use it

Setting it up needs **Set up integrations**. Importing and reviewing spools need **Run syncs** and **Review imports**. Works the same with or without a hub. With a hub on a server far from your Spoolman, a computer next to it can reach it for the hub, see [Spoolman on another network](#spoolman-on-another-network).

## Before you start

- Spoolman's address on your network: its IP or host name, with its port, such as `192.168.1.60:7912`. The server that runs the app must reach it.
- An API key only if a reverse proxy in front of Spoolman asks for one. Spoolman itself has no sign-in.

## Connect

1. Open **Settings**, then **Integrations**, and press **Add integration**.
2. Pick **Spoolman**.
3. Enter the **Address**. An `https://` address is used as typed.
4. Optional: a **Name**, and an **API key**.
5. Press **Test** to check the address and the key, then **Add**.

| Field | What it means | Required | Example |
|---|---|---|---|
| **Address (IP or host name, with :7912 or the port Spoolman runs on)** | Where Spoolman answers | Yes | `192.168.1.60:7912` |
| **Name (optional, shown on its card instead of "Spoolman account")** | Tells it apart. The card shows it, and so does the computer's page when Spoolman is reached through it | No | Workshop Spoolman |
| **API key (only for a proxy in front of Spoolman)** | Sent as `x-api-key`. Stored encrypted | No | |
| **Reached from** | **This server**, or a computer on Spoolman's network. Only with a hub | No | This server |

Only one Spoolman can be set up. Once it is, the card has no add button, and the form says **Already set up: find its card on the Integrations page.** To change its name, address or key later, open **Edit** on its block. A key left empty keeps the stored one. The key is stored encrypted.

The card's **⋯** menu has **Remove integration**. It asks first. Imported spools stay, unlinked from Spoolman. Credentials, schedules and the sync log go. **Add integration** sets it up again.

## Import spools

On **Filament**, open the gear, then **Sources**. The Spoolman line imports your spools. **Sync now** brings in the new ones. **Review and import** shows every spool before anything changes. See [Filament settings](Filament-Settings.md#sources) and [Sources and sync](Sources-and-Sync.md).

A Spoolman spool becomes a spool with its brand (Spoolman's vendor), material, name (the filament's name), colour and weights. Spoolman has no colour name, so that stays empty. Archived Spoolman spools are left out.

### A spool you already have

A spool can be in several libraries at once, for example Bambu Cloud's filament manager and Spoolman. It is one spool in the app, linked to each of them, so you can use both.

- A Spoolman spool that could be one you already have is never imported as a new spool. If you entered the spool by hand, it is a spool with the same brand, material, name and colour. If another library brought it in, it only needs the same material and colour, because each library names a filament its own way ("Bambu" or "Bambu Lab", "Basic PLA" or "PLA Basic").
- Such a spool waits in the review with **Maybe a spool you have: update links it**. Check it is the same roll, then update it, and it is linked. Your spool keeps its brand, name and weight. When several of your spools fit, you pick one. When none is the same roll, import it as new.
- Once linked, a re-import from either library finds the spool by its link and makes no second spool.
- It works the other way round too: a Bambu Cloud spool that is already in the app from Spoolman waits to be linked the same way.

While a Spoolman spool waits to be linked, the app doesn't add your spool to Spoolman a second time.

A spool's page lists each library it is in. **Unlink** lets go of one and keeps the others. After that, the library's spool isn't linked to it again and isn't imported as a new spool: its next import shows it as skipped, and you can still link it or import it in the review. A spool you unlinked from Spoolman isn't added there again. See [Filament](Filament.md#unlink-a-spool-from-a-source).

### Track usage

Leave **Track usage** off on the **Spools** line, which is the default. The app then keeps its own remaining weight, and Spoolman's weight is what the app writes back. Only one library should set a spool's weight. If two **Spools** lines track usage, the line you edit warns you: **Another spool library tracks usage too. A spool that is in both gets its weight from both, and each overwrites the other. Track usage on one library only.**

## Write usage back

**Write usage back** is a switch on the Spoolman block. It is on by default. It reads **When active, the filament each print takes from a spool linked to this source is written back to it, and a spool of yours that isn't there yet is added when a print uses it. A print Moonraker already reported to Spoolman isn't written again.** With it on:

- A print charged to a spool linked to Spoolman is written to that Spoolman spool: its used weight goes up by the print's grams. That includes a spool that came from Bambu Cloud first.
- A print on a spool of yours that isn't in Spoolman yet adds it there the first time a print uses it after Spoolman was set up. This includes a spool that is only in Bambu Cloud. The app finds or creates the vendor and the filament (brand, material, name and colour) and adds the spool with its current weights.
- An edit of a print's grams writes the difference, and a print you delete gives its grams back to the Spoolman spool, as it does to yours.
- Prints from before a spool was linked aren't written, because Spoolman already has its own history for that spool.
- A print Moonraker already reported to Spoolman is never written again. See [Moonraker](Moonraker.md#grams-and-spools). Every other print is: Bambu, Prusa, OctoPrint, a Klipper printer that doesn't report to Spoolman, or a print you entered by hand.
- A backlog import whose spools were already up to date isn't written either.

When Spoolman can't be reached, the block says **{n} charges waiting to be written. They are tried again every minute.** Nothing is lost or written twice.

### How a print is written only once

Spoolman has no way to tell a repeated request from a new one, so the app keeps track itself:

- Every print slot has a key, made of the print and its slot. The app remembers what it last confirmed each Spoolman spool holds for each key, and sends only the difference. A retry or a restart finds nothing new to send.
- Each write sets the spool's used weight and, in the same request, a field named **3D Maker Suite** on the spool. The field holds the grams it has for each key. If Spoolman took a write but its answer was lost, the next try reads the field, sees the charge is there, and stops. The app adds this field to Spoolman's spool fields the first time it writes. Leave it as it is.

A write reads the spool and then writes it. So that a report Moonraker sends in between is never lost, a Spoolman spool isn't written while a Klipper printer prints with it, nor in the minute after. Its charges wait for the next try. This needs **Live status** on for that Moonraker. A Moonraker the app only reads by its history can't say what it prints. With several tools, Moonraker doesn't say which spool each uses, so while it prints, nothing is written to Spoolman at all.

### Spoolman on another network

A hub on a server reaches a Spoolman on your home network through a computer there. Pick it under **Reached from** when you add Spoolman. The computer needs **Reach spool libraries** switched on, on its page. The import and the write-back work as above, with the same keys, so nothing is written twice. While the computer is offline, the charges wait on the hub and go when it is back. See [Integrations](Integrations.md#reach-through-a-computer) and [Connector setup](Connector-Setup.md).

## Common tasks

### Bring in your Spoolman spools

1. Add Spoolman, see [Connect](#connect).
2. Open **Filament**, then the gear, then **Sources**.
3. On the Spoolman line, open **⋯** and press **Review and import**.
4. Check the rows, and import them.

### Stop writing usage to Spoolman

1. On the Spoolman block in **Integrations**, switch **Write usage back** off.

## Related settings

- **Filament → Settings → Sources** holds the **Spools** line: when it runs and **Track usage**.
- [Moonraker](Moonraker.md) has a checkbox for a Moonraker that reports to another Spoolman.

## Limits and tips

- Only one Spoolman can be set up, because its spools are keyed by the source.
- Spoolman is never the master. The app's spools stay yours.
- Don't delete or change the **3D Maker Suite** field in Spoolman.

## Problems and fixes

| What you see | What to do |
|---|---|
| **The vendor service can't be reached.** | Open `http://<address>/api/v1/info` in a browser on the server's computer, or on the computer it is reached through. It answers with Spoolman's version. In Docker on a bridged network, use the IP, not a `.local` name |
| A charge keeps waiting | **Settings → Logs** says why. A Spoolman spool you deleted is skipped, and the log names it |
| A spool is not imported as new | It may be one you already have. Look for **Maybe a spool you have: update links it** in the review |

## Related pages

- [Integrations](Integrations.md)
- [Filament settings](Filament-Settings.md)
- [Filament](Filament.md)
- [Bambu Cloud](Bambu-Cloud.md)
- [Moonraker](Moonraker.md)
- [Sources and sync](Sources-and-Sync.md)
