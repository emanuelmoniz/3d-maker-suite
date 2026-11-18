# PrusaLink setup

The PrusaLink integration reads a Prusa printer through PrusaLink, the web interface built into the MK4/S, Core One, XL and MINI, and into a Raspberry Pi running PrusaLink for an MK3/S: its live status, and every print it finishes, stops or fails, recorded the moment it ends. It is read-only: the app never starts, pauses or stops a print.

> **Not checked on a real Prusa printer yet.** The adapter was written against payloads others published from real printers (a Prusa XL on firmware 6.1.2) and Prusa's API description, not against a printer of ours. Until a tester confirms it, expect rough edges and please report what you see. This note goes when one has.

## What it needs

- The printer's address on your network: its IP (`192.168.1.60`) or host name (`prusa-mk4.local`). The server running the app must reach it.
- The printer's **password**, or its **API key**. On the printer: **Settings → Network → PrusaLink** (the screen shows both). The user is `maker`, unless you changed it.

## Connect

1. Open **Integrations**, press **Add** and choose **PrusaLink (Prusa)**.
2. Enter the address and the password (or the API key).
3. Optional: its model.
4. Under **Printer**, pick the printer if you already have it (added by hand, for example), else **New printer from this source**. A printer you pick keeps its own name, model and costs; rename it on its printer page. With a new printer, **Name** is its name (else its host name).
5. Press **Test**, then **Add**. Saving asks the printer what it is, as Test does: if it doesn't answer, nothing is saved. Then switch on **Live status** on the card. The printer's page shows where it is read from and whether it answers ([Connection and monitoring](printers.md#connection-and-monitoring)).

One integration is one printer, linked when you add it: there is no **Printers** sync for it, so a printer you added by hand never comes back twice. To link it to another printer, open **Edit** on its card and pick another **Printer**; the one it had stays, unlinked. Removing the integration keeps the printer. Add one per Prusa printer. The password and key are stored encrypted on disk ([ADR-0005](adr/0005-secrets-storage.md)) and never logged.

**Hub on another network** (a VPS): the hub can't reach the printer, so a machine on the printer's network reaches it through its connector. Pick that machine under **Reached from** when you add the integration (it needs **Reach printers** on, on its page, whose **Set up in Integrations** opens the add form with the machine picked). Test and saving reach the printer through that machine, so it must be online. See [printers through a connector](hub.md#printers-through-a-connector).

## What it reads

- **Printer:** the one you picked when you added it, or a new one made from what the printer reports then, with its serial number and nozzle size.
- **Live status:** state, progress, time left, nozzle and bed temperatures, the file being printed and the loaded material where the printer says it. PrusaLink doesn't report layers. A printer waiting for you (filament out, a door open) shows as paused.
- **No print history.** PrusaLink keeps none: a print that ends while the app isn't running is missed. Keep the app running (a server, a NAS) to catch every print.
- **To stop recording** one printer's prints while its live status goes on, switch off **Record prints** on its row in **Prints → Settings → Sources** ([prints.md](prints.md#record-prints)). The **Prints sources** button on its card opens the row.

## Grams and spools

PrusaLink never says how much filament a print used, so the grams come from the **print's file**: the app downloads the start and end of it once per print (not the whole file) and reads the totals the slicer wrote (PrusaSlicer, OrcaSlicer, and the binary `.bgcode`). Where the file has none, the slice of the matching project plate is used, else the slot waits in Filament to review.

A **stopped** or **failed** print gets the file's total times the share it reached, marked **estimated**. The printer has no spool tag: set the **loaded spool** on the printer's page so prints charge it ([printers.md](printers.md#grams-and-spools)).

## Troubleshooting

- **Can't be reached:** open `http://<address>/` in a browser on the server's machine. In Docker on a bridged network, use the printer's IP, not a `.local` name.
- **Sign-in required:** the password or key is wrong, or the user isn't `maker`. Re-enter it from the printer's screen.
- **Offline on the dashboard:** the printer didn't answer. A printer that goes away during a print raises a **Printer offline** alert.
- **Grams missing:** the slicer didn't write totals into the file, or the printer wouldn't send it. The slot waits in Filament to review.
