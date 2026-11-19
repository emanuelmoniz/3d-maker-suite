# PrusaLink

Reads a Prusa printer through PrusaLink, the web interface built into the MK4/S, Core One, XL and MINI, and into a Raspberry Pi running PrusaLink for an MK3/S: its live status, and every print it finishes, stops or fails, recorded the moment it ends. It is read-only: the app never starts, pauses or stops a print.

![The Integrations page with an account card open](../docs/images/wiki-integrations.png)

> **Not checked on a real Prusa printer yet.** The adapter was written against payloads that others published from real printers (a Prusa XL on firmware 6.1.2) and Prusa's API description, not against a real printer. Until a tester confirms it, expect rough edges, and please report what you see.

## Who can use it

Setting it up needs **Set up integrations**. Works the same with or without a hub. With a hub on a server far from the printer, a computer next to the printer can read it for the hub, see [Hub on another network](#hub-on-another-network).

## Before you start

- The printer's address on your network: its IP (`192.168.1.60`) or host name (`prusa-mk4.local`). The server that runs the app must reach it.
- The printer's **password**, or its **API key**. On the printer, open **Settings → Network → PrusaLink**. The screen shows both. The user is `maker`, unless you changed it.

## Connect

1. Open **Settings**, then **Integrations**, and press **Add integration**.
2. Pick **PrusaLink (Prusa)**.
3. Under **Printer**, pick the printer if you already have it (added by hand, for example), or **New printer from this source**. A printer you pick keeps its own name, model and costs. Rename it on its printer page. With a new printer, **Name** is its name, else its host name.
4. Enter the **Address** and the **Password** (or the **API key**).
5. Optional: its **Model**.
6. Press **Test**, then **Add**. Saving asks the printer what it is, as **Test** does. If it doesn't answer, nothing is saved.
7. On the printer's block, switch on **Live status**.

The printer's page then shows where it is read from and whether it answers. See [Connection and monitoring](Printers.md#connection-and-monitoring).

| Field | What it means | Required | Example |
|---|---|---|---|
| **Printer** | The printer this source is, or **New printer from this source** | Yes | New printer from this source |
| **Name** | The name of a new printer | No | MK4 |
| **Address (IP or host name of the printer)** | Where PrusaLink answers | Yes | `192.168.1.60` |
| **Model** | The printer's model | No | MK4S |
| **User (maker unless you changed it)** | The PrusaLink user | No | `maker` |
| **Password (on the printer: Settings → Network → PrusaLink)** | Stored encrypted | Password or key | |
| **API key (instead of the password)** | Stored encrypted | Password or key | |
| **Reached from** | **This server**, or a computer next to the printer. Only with a hub | No | This server |

One integration is one printer, so add one per Prusa printer. To link it to another printer later, press **Edit** and pick another **Printer**. The one it had stays, unlinked. Removing the integration keeps the printer. The password and key are stored encrypted and never logged.

### Hub on another network

A hub on a server can't reach a printer in your workshop. A computer on the printer's network reads it through its connector. Under **Reached from**, pick that computer. It needs **Reach printers** switched on, on its page, whose **Set up in Integrations** opens this form with the computer already picked. **Test** and saving go through that computer, so it must be online. See [Integrations](Integrations.md#reach-through-a-computer) and [Connector setup](Connector-Setup.md).

## What it reads

| What | How |
|---|---|
| **Printer** | The one you picked when you added it, or a new one made from what the printer reports then, with its serial number and nozzle size |
| **Live status** | State, progress, time left, nozzle and bed temperatures, the file being printed and the loaded material where the printer says it. PrusaLink doesn't report layers. A printer waiting for you (filament out, a door open) shows as paused |
| **Print history** | None. PrusaLink keeps none. A print that ends while the app isn't running is missed. Keep the app running (a server, a NAS) to catch every print |

To stop recording one printer's prints while its live status goes on, switch off **Record prints** on its line in **Prints → Settings → Sources**. The **Prints sources** button on its block opens the line. See [Prints settings](Prints-Settings.md#record-prints).

## Grams and spools

PrusaLink never says how much filament a print used. So the grams come from the **print's file**: the app downloads the start and end of it once per print (not the whole file) and reads the totals the slicer wrote. It reads files from PrusaSlicer, OrcaSlicer and the binary `.bgcode`. Where the file has none, the slice of the matching project plate is used, else the slot waits in [Filament review](Filament-Review.md).

A **stopped** or **failed** print gets the file's total times the share it reached, marked **estimated**.

The printer has no spool tag. Set the **loaded spool** on the printer's page so prints charge it. See [Loaded spools](Printers.md#loaded-spools).

## Common tasks

### Add a Prusa printer

1. Press **Add integration**, pick **PrusaLink (Prusa)**.
2. Enter the **Address** and the **Password**, press **Test**, then **Add**.
3. Switch on **Live status** on the printer's block.
4. On the printer's page, set the loaded spool.

## Related settings

- **Prints → Settings → Sources** holds **Record prints** for this printer.
- [Prints settings](Prints-Settings.md#review-of-automatic-prints) holds the review level.

## Limits and tips

- It never controls the printer.
- There is no history to read. Keep the app running.
- PrusaLink reports no layers, so the layer view shows the percent.

## Problems and fixes

| What you see | What to do |
|---|---|
| **The vendor service can't be reached.** | Open `http://<address>/` in a browser on the server's computer. In Docker on a bridged network, use the printer's IP, not a `.local` name |
| **Sign-in required. Check the credentials.** | The password or key is wrong, or the user isn't `maker`. Enter it again from the printer's screen |
| **Offline** on the dashboard | The printer didn't answer. A printer that goes away during a print raises a **Printer offline** alert |
| Grams are missing | The slicer didn't write totals into the file, or the printer wouldn't send it. The slot waits in [Filament review](Filament-Review.md) |

## Related pages

- [Integrations](Integrations.md)
- [Printers](Printers.md)
- [Prints settings](Prints-Settings.md)
- [Filament review](Filament-Review.md)
- [Connector setup](Connector-Setup.md)
