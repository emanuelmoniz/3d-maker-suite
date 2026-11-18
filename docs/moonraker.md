# Moonraker (Klipper) setup

The Moonraker integration reads a Klipper printer through Moonraker, the API behind Mainsail and Fluidd: its live status, the prints it finishes, cancels or fails, and its print history. That covers Voron, RatRig, Sovol, Qidi, Elegoo Neptune 4, Snapmaker U1, rooted Creality printers and most other Klipper machines. It is read-only: the app never starts, pauses or stops a print.

## What it needs

- The printer's address on your network: its IP (`192.168.1.50`) or host name (`voron.local`). The server running the app must reach it.
- Mainsail or Fluidd on port 80 works with the address alone. Moonraker on its own port needs it: `192.168.1.50:7125`. An `https://` address is used as typed.
- An API key only if Moonraker's `[authorization]` doesn't trust the server's address. Mainsail shows the key under **Settings → Machine → Authorization**; most setups list the local network in `trusted_clients` and need none.

## Connect

1. Open **Integrations**, press **Add** and choose **Moonraker (Klipper)**.
2. Enter the address, and the API key if you need one.
3. Optional: its brand and its model. Without a model the app takes the one your slicer wrote in the newest job file.
4. Under **Printer**, pick the printer if you already have it (added by hand, for example), else **New printer from this source**. A printer you pick keeps its own name, model and costs; rename it on its printer page. With a new printer, **Name** is its name (else Klipper's host name).
5. Press **Test**, then **Add**. Saving asks the printer what it is, as Test does: if it doesn't answer, nothing is saved. Then switch on **Live status** on the card. The printer's page shows where it is read from and whether it answers ([Connection and monitoring](printers.md#connection-and-monitoring)).

One integration is one printer, linked when you add it: there is no **Printers** sync for it, so a printer you added by hand never comes back twice. To link it to another printer, open **Edit** on its card and pick another **Printer**; the one it had stays, unlinked. Removing the integration keeps the printer. Add one per Klipper printer. The API key is stored encrypted on disk ([ADR-0005](adr/0005-secrets-storage.md)).

**Hub on another network** (a VPS): the hub can't reach the printer, so a machine on the printer's network reaches it through its connector. Pick that machine under **Reached from** when you add the integration (it needs **Reach printers** on, on its page, whose **Set up in Integrations** opens the add form with the machine picked). Test and saving reach the printer through that machine, so it must be online. See [printers through a connector](hub.md#printers-through-a-connector).

## What it reads

- **Printer:** the one you picked when you added it, or a new one made from what Klipper reports then.
- **Live status:** state, progress, time left, layer, nozzle and bed temperatures, and the filament from the job file. Switch it on with **Live status** on the card. Klipper only knows the layer when the slicer sends it (`SET_PRINT_STATS_INFO`); otherwise the app works it out from the height and the file's layer heights.
- **Print history:** jobs that ended while the app was off, from Moonraker's history. A job the app watched live and the same job in the history are one print.
- **To stop recording** one printer's prints while its live status goes on, switch off **Record prints** on its row in **Prints → Settings → Sources** ([prints.md](prints.md#record-prints)). The **Prints sources** button on its card opens the row. Its history isn't read while it is off, and jobs from that time aren't imported by themselves when you switch it back on.

## Grams and spools

- A **finished** print gets the file's totals per tool, as the slicer wrote them.
- A **cancelled** or **failed** print gets what really went out: Moonraker counts the filament extruded, and the app takes that share of the file's totals. These grams are measured, not estimated. On a printer with several tools Moonraker counts them together, so the split between tools is estimated.
- When Moonraker reports to **Spoolman** (its `[spoolman]` section), a job names the Spoolman spool it used, and the print's slot keeps it. If you imported that spool from [Spoolman](spoolman.md), the slot is charged to your spool for sure. Moonraker already charged the spool in Spoolman itself, so the app never writes that print to Spoolman again. A job that names no Spoolman spool is written back like any other printer's.
- **Moonraker reports to another Spoolman** (a checkbox in the setup): tick it when Moonraker's `[spoolman]` points at a different Spoolman than the one set up in the app. The spool a job names is then not one of yours, and the app's Spoolman wasn't charged, so the print is written back to it. It applies to prints recorded after you change it.
- The app's own spool is matched as for any printer ([printers.md](printers.md#grams-and-spools)), and is always charged.
- **Loaded spools:** while a job runs, the Spoolman spool it names is loaded in its slot by the printer, when you imported that spool from Spoolman. The job file's material and colour load nothing, because they describe the file, not the spool in the printer. Set any other loaded spool on the printer's page.

## Troubleshooting

- **Can't be reached:** check the address in a browser on the server's machine (`http://<address>/server/info` answers with JSON). In Docker on a bridged network, use the printer's IP, not a `.local` name.
- **Sign-in required:** Moonraker refused the server. Add the API key, or the server's address to `trusted_clients`.
- **Offline on the dashboard:** the printer didn't answer or Klipper isn't connected to Moonraker. A printer that goes away during a print raises a **Printer offline** alert.
