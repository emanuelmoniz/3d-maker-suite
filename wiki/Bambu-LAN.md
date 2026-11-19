# Bambu LAN

Reads a Bambu Lab printer on your network: its live status, its AMS, and every print it finishes, cancels or fails, recorded the moment it ends. It works with or without [Bambu Cloud](Bambu-Cloud.md). It is read-only: the app never starts, pauses or stops a print, and it changes no setting on the printer.

![The Integrations page with an account card open](../docs/images/wiki-integrations.png)

## Who can use it

Setting it up needs **Set up integrations**. Reading its status needs nothing more. Works the same with or without a hub. With a hub on a server far from the printer, a computer next to the printer can read it for the hub, see [Hub on another network](#hub-on-another-network).

## Before you start

- The printer's **access code**. It is on the printer's screen in the network settings. On the A1 and A1 mini it is under **Settings → LAN Only Mode**, and the code shows there without switching the mode on. On the X1 and P1 it is under **Settings → Network**. Bambu Studio and Bambu Handy know it too.
- The server that runs the app on the **same network** as the printer. It must reach the printer on TCP ports 8883 (status) and 990 (the print's file).
- **No LAN Only mode and no Developer mode.** The printer stays connected to Bambu Cloud, so Bambu Handy and printing from the cloud keep working.

It was checked on an A1 (firmware 01.09.00.00). A printer with LAN Only mode on, and other models, are untried.

## Connect

1. Open **Settings**, then **Integrations**, and press **Add integration**.
2. Pick **Bambu Lab printer (LAN)**.
3. Under **Printer**, pick the printer if you already have it (added by hand, for example), or **New printer from this source**. Pick your Bambu Cloud printer to have one printer with both sources.
4. Enter the **Access code** and the printer's IP. See the fields below.
5. For a new printer, you can type a **Name**. Else it takes the name the printer announces.
6. Press **Test**, then **Add**. Saving asks the printer what it is, as **Test** does. If it doesn't answer, nothing is saved.
7. On the printer's block, switch on **Live status**.

The printer's page then shows where it is read from and whether it answers. See [Connection and monitoring](Printers.md#connection-and-monitoring).

| Field | What it means | Required | Example |
|---|---|---|---|
| **Printer** | The printer this source is, or **New printer from this source** | Yes | New printer from this source |
| **Name** | The name of a new printer. A printer you picked keeps its own name, and has **Rename on the printer page** | No | Workshop A1 |
| **Printer IP (optional when the server is on the same network)** | The printer's address on your network | The IP or the serial | `192.168.1.40` |
| **Serial number (optional when the IP is set)** | On the printer's screen under the device info, or on Bambu Studio's device page | The IP or the serial | `01P00A000000000` |
| **Access code (on the printer's screen)** | The code from the screen. Stored encrypted | Yes | |
| **Reached from** | **This server**, or a computer next to the printer. Only with a hub | No | This server |

You must give the IP, the serial, or both. If neither is filled in, the form says **Enter the printer's IP or its serial number.**

- With the IP, the app reads the serial from the printer and saves it on the printer.
- With the serial alone, the app finds the printer by the broadcast it sends every 10 seconds. That needs the server on the same network segment. A server in Docker on a bridged network doesn't hear it, so give it the IP.
- With both, the IP is where it starts, and the app follows the printer by its serial when its IP changes.
- A printer you picked already has its own serial. The IP is then optional, unless it has none yet. A printer with no serial says **This printer has no serial number yet. Enter its IP.**

The serial number belongs to the printer. Its page shows it, read-only, while Bambu LAN or Bambu Cloud gives it.

One integration is one printer, so add one per Bambu printer. To link it to another printer later, press **Edit** and pick another **Printer**. The one it had stays, unlinked. Removing the integration keeps the printer. The access code is stored encrypted and never logged.

### Hub on another network

A hub on a server can't reach a printer in your workshop. A computer on the printer's network reads it through its connector. Under **Reached from**, pick that computer. It needs **Reach printers** switched on, on its page, whose **Set up in Integrations** opens this form with the computer already picked. **Test** and saving go through that computer, so it must be online. See [Integrations](Integrations.md#reach-through-a-computer) and [Connector setup](Connector-Setup.md).

## With Bambu Cloud, or alone

- **With a Bambu Cloud account** that has the same printer, the two are **one printer** in the app, matched by serial. Bambu LAN gives the live status, Bambu Cloud the history. Each print is recorded once, whichever source sees it first. A print sent through the cloud carries the cloud's task id, and any other print is matched by its start time.
- **Alone**, with no Bambu Cloud account or a printer that isn't on the cloud, Bambu LAN brings in the printer, its AMS, its live status and its prints by itself. There is no history then: a print that ends while the app isn't running is missed. Keep the app running (a server, a NAS) to catch every print.

To stop recording this printer's prints while its live status goes on, switch off **Record prints** on its line in **Prints → Settings → Sources**. The **Prints sources** button on its block opens the line. See [Prints settings](Prints-Settings.md#record-prints). A Bambu Cloud account with the same printer still brings its prints in, until you switch off that account's line too.

## What it reads

The printer pushes each change over its local connection, and the app shows it within about a second: a swapped tray, a print that starts or ends, a connection that drops. The app also reads on a timer, every 3 seconds during a print and every 15 seconds otherwise, in case a report is missed. Through a connector it is the same, plus the time to reach the hub.

| What | How |
|---|---|
| **Live status** | State, progress, time left, layer, nozzle and bed temperatures (and the chamber where the printer has a sensor), and every AMS slot and the spool on the back with its material, colour and RFID tag |
| **Prints** | The title, plate, start and outcome. A print stopped on the screen or in the app is **cancelled**. Any other stop is **failed**, with the printer's error code, such as `0300-8001`, which Bambu's wiki explains |
| **Grams** | The printer reports none. See [Grams](#grams) |
| **Spools** | A Bambu spool's RFID tag is learned by the app's spool the first time that slot is charged to it. After that, a print from that spool charges it for sure |
| **Loaded spools** | See [Loaded spools](#loaded-spools) |

### Grams

The app reads the print's 3MF from the printer once per print, a few hundred KB and a few seconds, and takes the slicer's grams per filament, on the AMS slot each filament was printed from. A cancelled or failed print gets those grams times the share of the layers it reached, marked **estimated**. When the file can't be read, the grams come from the project's plate, or the slot waits in [Filament review](Filament-Review.md).

### Loaded spools

The printer says what is in each tray, also when idle, so the app loads the spools itself. It picks the tagged spool, or the only spool of that material and colour. Where several fit, it suggests one for you to accept. A tray that goes empty unloads the spool the printer loaded there. The spool on the back is the slot **External spool**, and an AMS HT is a **Single-slot unit**. See [Loaded spools](Printers.md#loaded-spools).

## Common tasks

### Get live status for a printer that is on Bambu Cloud

1. Add the printer's [Bambu Cloud](Bambu-Cloud.md) account, if you haven't.
2. Add **Bambu Lab printer (LAN)**. Under **Printer**, pick the printer that came from the cloud.
3. Enter the IP and the **Access code**, press **Test**, then **Add**.
4. Switch on **Live status**.

### Use a new access code

1. On the printer's block, press **⋯**, then **Edit**.
2. Type the new **Access code**, press **Test**, then **Save changes**.

## Related settings

- **Prints → Settings → Sources** holds **Record prints** and the review level for this printer.
- **Printers → Printer page → Loaded spools** lets you set a spool by hand.

## Limits and tips

- It never controls the printer.
- A print that ends while the app is off is missed. Keep the app running.
- Only one integration per printer. Link a second source to the same printer instead of making a copy.
- Keep the access code private. Anyone with it and network access can read the printer.

## Problems and fixes

| What you see | What to do |
|---|---|
| **Sign-in required. Check the credentials.** | The access code is wrong, or the printer made a new one. It does that when LAN Only mode is switched and on a reset. Copy it again from the screen |
| **The vendor service can't be reached.** | Check the IP on the printer's screen and that the server's computer reaches it. In Docker, use the IP and a network the printer can be reached from |
| **Offline** on the dashboard | The printer is off or out of reach. A printer that goes away during a print raises a **Printer offline** alert |
| No grams on a print | The print's file wasn't on the printer, for example a print started from the SD card, or it couldn't be read in time. The grams come from the project's plate, or the slot waits in [Filament review](Filament-Review.md) |
| **Enter the printer's IP or its serial number.** | Fill in one of them |

## Related pages

- [Integrations](Integrations.md)
- [Bambu Cloud](Bambu-Cloud.md)
- [Printers](Printers.md)
- [Filament review](Filament-Review.md)
- [Connector setup](Connector-Setup.md)
