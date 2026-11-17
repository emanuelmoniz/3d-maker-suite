# OctoPrint setup

The OctoPrint integration reads a printer through [OctoPrint](https://octoprint.org): its live status, and every print it finishes, cancels or fails, recorded the moment it ends. It is read-only: the app never starts, pauses or stops a print.

> **Not checked on a real printer yet.** The adapter was written and tested against OctoPrint 1.11.8 with its virtual printer, not a printer of ours: the server and its messages are real, the printer is simulated. Until a tester confirms it, expect rough edges and please report what you see. This note goes when one has.

## What it needs

- OctoPrint's address on your network: its IP (`192.168.1.70`) or host name (`octopi.local`), with `https://` and a port if you use them. The server running the app must reach it.
- An **API key**: in OctoPrint, **Settings → API** (the global key), or an application key you create there.

## Connect

1. Open **Integrations**, press **Add** and choose **OctoPrint**.
2. Enter the address and the API key.
3. Optional: a name for the printer (else *OctoPrint*), its brand and model.
4. Under **Printer**, pick the printer if you already have it (added by hand, for example), else **New printer from this source**. A printer you pick keeps its own name, model and costs.
5. Press **Test**, then **Add**. Saving asks the printer what it is, as Test does: if it doesn't answer, nothing is saved. Then switch on **Live status** on the card. The printer's page shows where it is read from and whether it answers ([Connection and monitoring](printers.md#connection-and-monitoring)).

One integration is one printer, linked when you add it: there is no **Printers** sync for it, so a printer you added by hand never comes back twice. To link it to another printer, open **Edit** on its card and pick another **Printer**; the one it had stays, unlinked. Removing the integration keeps the printer. It is the printer OctoPrint is connected to. The key is stored encrypted on disk ([ADR-0005](adr/0005-secrets-storage.md)) and never logged.

**Hub on another network** (a VPS): the hub can't reach the printer, so a machine on the printer's network reaches it through its connector. Pick that machine under **Reached from** when you add the integration (it needs **Reach printers** on, on its page, whose **Set up in Integrations** opens the add form with the machine picked). Test and saving reach the printer through that machine, so it must be online. See [printers through a connector](hub.md#printers-through-a-connector).

## What it reads

- **Live status:** state, progress, time left, nozzle, bed and chamber temperatures and the file being printed. OctoPrint reports no layers. A cancel in progress still shows as printing until OctoPrint says the print is over.
- **Each print's end:** OctoPrint tells the app when a print is done, cancelled or failed, over the same connection the status uses. A cancel raises two messages in OctoPrint; the app records one cancelled print.
- **No print history.** OctoPrint's REST job looks the same after a cancel as before a print, so the app relies on what it hears while it runs: a print that ends while the app isn't running is missed. Keep the app running (a server, a NAS) to catch every print.

## Grams and spools

OctoPrint's own analysis has the filament's length and volume but never grams, so the grams come from the **print's file**: the app downloads the start and end of it once per file (not the whole file) and reads the totals the slicer wrote (PrusaSlicer, OrcaSlicer, Bambu Studio and the binary `.bgcode`). Where the file has none, the slot waits in Filament to review.

A **cancelled** or **failed** print gets the file's total times the share it reached, marked **estimated**. A file stored on the printer's SD card can't be downloaded, so it has no grams. OctoPrint has no spool tag: set the **loaded spool** on the printer's page so prints charge it ([printers.md](printers.md#grams-and-spools)).

## Troubleshooting

- **Can't be reached:** open `http://<address>/` in a browser on the server's machine. In Docker on a bridged network, use the printer's IP, not a `.local` name.
- **Sign-in required:** the API key is wrong or was revoked. Create one in **Settings → API** and re-enter it.
- **Offline on the dashboard:** OctoPrint didn't answer, or it has no printer connected. A printer that goes away during a print raises a **Printer offline** alert.
- **Grams missing:** the slicer didn't write totals into the file, the file is on the SD card, or OctoPrint wouldn't send it. The slot waits in Filament to review.
