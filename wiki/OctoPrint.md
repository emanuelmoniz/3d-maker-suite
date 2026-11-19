# OctoPrint

Reads a printer through [OctoPrint](https://octoprint.org): its live status, and every print it finishes, cancels or fails, recorded the moment it ends. It is read-only: the app never starts, pauses or stops a print.

![The Integrations page with an account card open](../docs/images/wiki-integrations.png)

> **Not checked on a real printer yet.** The adapter was written and tested against OctoPrint 1.11.8 with its virtual printer, not a real printer. The server and its messages are real, the printer is simulated. Until a tester confirms it, expect rough edges, and please report what you see.

## Who can use it

Setting it up needs **Set up integrations**. Works the same with or without a hub. With a hub on a server far from the printer, a computer next to the printer can read it for the hub, see [Hub on another network](#hub-on-another-network).

## Before you start

- OctoPrint's address on your network: its IP (`192.168.1.70`) or host name (`octopi.local`), with `https://` and a port if you use them. The server that runs the app must reach it.
- An **API key**. In OctoPrint, open **Settings → API** and copy the global key, or create an application key there.

## Connect

1. Open **Settings**, then **Integrations**, and press **Add integration**.
2. Pick **OctoPrint**.
3. Under **Printer**, pick the printer if you already have it (added by hand, for example), or **New printer from this source**. A printer you pick keeps its own name, model and costs. Rename it on its printer page. With a new printer, **Name** is its name, else *OctoPrint*.
4. Enter the **Address** and the **API key**.
5. Optional: its **Brand** and **Model**.
6. Press **Test**, then **Add**. Saving asks the printer what it is, as **Test** does. If it doesn't answer, nothing is saved.
7. On the printer's block, switch on **Live status**.

The printer's page then shows where it is read from and whether it answers. See [Connection and monitoring](Printers.md#connection-and-monitoring).

| Field | What it means | Required | Example |
|---|---|---|---|
| **Printer** | The printer this source is, or **New printer from this source** | Yes | New printer from this source |
| **Name** | The name of a new printer | No | Ender 3 |
| **Address (IP or host name of OctoPrint)** | Where OctoPrint answers | Yes | `192.168.1.70` |
| **Brand**, **Model** | What to call the printer | No | Creality, Ender 3 |
| **API key (OctoPrint: Settings → API)** | Stored encrypted | Yes | |
| **Reached from** | **This server**, or a computer next to the printer. Only with a hub | No | This server |

One integration is one printer: the one OctoPrint is connected to. To link it to another printer later, press **Edit** and pick another **Printer**. The one it had stays, unlinked. Removing the integration keeps the printer. The key is stored encrypted and never logged.

### Hub on another network

A hub on a server can't reach a printer in your workshop. A computer on the printer's network reads it through its connector. Under **Reached from**, pick that computer. It needs **Reach printers** switched on, on its page, whose **Set up in Integrations** opens this form with the computer already picked. **Test** and saving go through that computer, so it must be online. See [Integrations](Integrations.md#reach-through-a-computer) and [Connector setup](Connector-Setup.md).

## What it reads

| What | How |
|---|---|
| **Live status** | State, progress, time left, nozzle, bed and chamber temperatures and the file being printed. OctoPrint reports no layers. A cancel in progress still shows as printing until OctoPrint says the print is over |
| **Each print's end** | OctoPrint tells the app when a print is done, cancelled or failed, over the same connection the status uses. A cancel raises two messages in OctoPrint. The app records one cancelled print |
| **Print history** | None. OctoPrint's job looks the same after a cancel as before a print, so the app relies on what it hears while it runs. A print that ends while the app isn't running is missed. Keep the app running (a server, a NAS) to catch every print |

To stop recording one printer's prints while its live status goes on, switch off **Record prints** on its line in **Prints → Settings → Sources**. The **Prints sources** button on its block opens the line. See [Prints settings](Prints-Settings.md#record-prints).

## Grams and spools

OctoPrint's own analysis has the filament's length and volume but never grams. So the grams come from the **print's file**: the app downloads the start and end of it once per file (not the whole file) and reads the totals the slicer wrote. It reads files from PrusaSlicer, OrcaSlicer, Bambu Studio and the binary `.bgcode`. Where the file has none, the slot waits in [Filament review](Filament-Review.md).

A **cancelled** or **failed** print gets the file's total times the share it reached, marked **estimated**. A file stored on the printer's SD card can't be downloaded, so it has no grams.

OctoPrint has no spool tag. Set the **loaded spool** on the printer's page so prints charge it. See [Loaded spools](Printers.md#loaded-spools).

## Common tasks

### Add a printer behind OctoPrint

1. Press **Add integration**, pick **OctoPrint**.
2. Enter the **Address** and the **API key**, press **Test**, then **Add**.
3. Switch on **Live status** on the printer's block.
4. On the printer's page, set the loaded spool.

## Related settings

- **Prints → Settings → Sources** holds **Record prints** for this printer.
- [Prints settings](Prints-Settings.md#review-of-automatic-prints) holds the review level.

## Limits and tips

- It never controls the printer.
- There is no history to read. Keep the app running.
- A file on the printer's SD card has no grams.

## Problems and fixes

| What you see | What to do |
|---|---|
| **The vendor service can't be reached.** | Open `http://<address>/` in a browser on the server's computer. In Docker on a bridged network, use the printer's IP, not a `.local` name |
| **Sign-in required. Check the credentials.** | The API key is wrong or was revoked. Create one in **Settings → API** and enter it again |
| **Offline** on the dashboard | OctoPrint didn't answer, or it has no printer connected. A printer that goes away during a print raises a **Printer offline** alert |
| Grams are missing | The slicer didn't write totals into the file, the file is on the SD card, or OctoPrint wouldn't send it. The slot waits in [Filament review](Filament-Review.md) |

## Related pages

- [Integrations](Integrations.md)
- [Printers](Printers.md)
- [Prints settings](Prints-Settings.md)
- [Filament review](Filament-Review.md)
- [Connector setup](Connector-Setup.md)
