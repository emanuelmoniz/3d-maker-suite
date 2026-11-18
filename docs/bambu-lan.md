# Bambu LAN setup

The Bambu LAN integration reads a Bambu Lab printer on your network: its live status, its AMS, and every print it finishes, cancels or fails, recorded the moment it ends. It works with or without [Bambu Cloud](bambu-cloud.md). It is read-only: the app never starts, pauses or stops a print, and it changes no setting on the printer.

## What it needs

- The printer's **access code**. It is on the printer's screen in the network settings (on the A1 and A1 mini under **Settings → LAN Only Mode**; the code shows there without switching the mode on). Bambu Studio and Bambu Handy know it too.
- The server running the app on the **same network** as the printer, able to reach it on TCP ports 8883 (status) and 990 (the print's file).
- **No LAN Only mode and no Developer mode.** The printer stays connected to Bambu Cloud, so Bambu Handy and printing from the cloud keep working. Checked on an A1 (firmware 01.09.00.00); a printer with LAN Only mode on, and other models, aren't checked yet.

## Connect

1. Open **Integrations**, press **Add** and choose **Bambu Lab printer (LAN)**.
2. Under **Printer**, pick the printer if you already have it (added by hand, for example), else **New printer from this source**. A printer you pick keeps its own name, model and costs. Pick your Bambu Cloud printer to have one printer with both sources.
3. Enter the access code and the printer's **IP**. A new printer can have its **serial number** (on the screen under the device info, or in Bambu Studio's device page) instead, or both:
   - With the IP, the app reads the serial from the printer and writes it to the printer.
   - With the serial alone, the app finds the printer by the broadcast it sends every 10 seconds. That needs the server on the same network segment; a server in Docker on a bridged network doesn't hear it, so give it the IP.
   - With both, the IP is where it starts, and the app follows the printer by its serial when its IP changes.
   - A printer you picked gives its own serial: the IP is optional then, unless it has none yet.
4. With **New printer from this source**, optionally a **Name** for it (else the name it announces). With a printer you picked there is no Name field: it keeps its own, and you rename it on its printer page.
5. Press **Test**, then **Add**. Saving asks the printer what it is, as Test does: if it doesn't answer, nothing is saved. Then switch on **Live status** on the card. The printer's page shows where it is read from and whether it answers ([Connection and monitoring](printers.md#connection-and-monitoring)).

The serial number belongs to the printer: its page shows it, read-only while Bambu LAN or Bambu Cloud gives it. One integration is one printer, linked when you add it: there is no **Printers** sync for it, so a printer you added by hand never comes back twice. To link it to another printer, open **Edit** on its card and pick another **Printer**; the one it had stays, unlinked. Removing the integration keeps the printer. Add one integration per printer. The access code is stored encrypted on disk ([ADR-0005](adr/0005-secrets-storage.md)) and never logged.

**Hub on another network** (a VPS): the hub can't reach the printer, so a machine on the printer's network reaches it through its connector. Pick that machine under **Reached from** when you add the integration (it needs **Reach printers** on, on its page, whose **Set up in Integrations** opens the add form with the machine picked). Test and saving reach the printer through that machine, so it must be online. See [printers through a connector](hub.md#printers-through-a-connector).

## With Bambu Cloud, or alone

- **With a Bambu Cloud account** that has the same printer, the two are **one printer** in the app, matched by serial: Bambu LAN gives the live status, Bambu Cloud the history. Each print is recorded once, whichever source sees it first: a print sent through the cloud carries the cloud's task id, and any other print is matched by its start time.
- **Alone**, with no Bambu Cloud account or a printer that isn't on the cloud, Bambu LAN brings in the printer, its AMS, live status and prints by itself. There is no history then: a print that ends while the app isn't running is missed. Keep the app running (a server, a NAS) to catch every print.

## What it reads

**How fast it shows:** the printer pushes each change over its local connection, and the app reads it within about a second: a swapped tray, a print that starts or ends, a connection that drops. The app also reads on a timer (every 3 s during a print, 15 s otherwise) in case a report is missed. Through a connector it is the same, plus the time to reach the hub.

- **Live status:** state, progress, time left, layer, nozzle and bed temperatures (and the chamber where the printer has a sensor), and every AMS slot and the spool on the back with its material, colour and RFID tag.
- **Prints:** the title, plate, start (the cloud's own start for a cloud print) and outcome. A print stopped on the screen or in the app is **cancelled**; any other stop is **failed**, with the printer's error code (`0300-8001`), which Bambu's wiki explains.
- **Grams:** the printer reports none. The app reads the print's 3MF from the printer once per print (a few hundred KB, a few seconds) and takes the slicer's grams per filament, on the AMS slot each filament was printed from. A cancelled or failed print gets those grams times the share of the layers it reached, marked **estimated**. When the file can't be read, the grams come from the project's plate or wait in Filament to review ([printers.md](printers.md#grams-and-spools)).
- **Spools:** a Bambu spool's RFID tag is learned by the app's spool the first time that slot is charged to it; after that, a print from that spool charges it for sure ([printers.md](printers.md#grams-and-spools)).
- **Loaded spools:** the printer says what is in each tray, also when idle, so the app loads the spools itself. It picks the tagged spool, or the only spool of that material and colour. Where several fit, it suggests one for you to accept. A tray that goes empty unloads the spool the printer loaded there ([printers.md](printers.md#grams-and-spools)). The spool on the back is the slot **External spool**, and an AMS HT is a **Single-slot unit**.

## Troubleshooting

- **Sign-in required:** the access code is wrong, or the printer made a new one (it does when LAN Only mode is switched, and on a reset). Copy it again from the screen.
- **Can't be reached:** check the IP on the printer's screen and that the server's machine can reach it. In Docker, use the IP and a network the printer can be reached from.
- **Offline on the dashboard:** the printer is off or out of reach. A printer that goes away during a print raises a **Printer offline** alert.
- **No grams on a print:** the print's file wasn't on the printer (a print started from the SD card can have it elsewhere) or couldn't be read in time; the grams then come from the project's plate, or the slot waits in Filament to review.
