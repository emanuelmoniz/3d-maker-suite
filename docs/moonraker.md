# Moonraker (Klipper) setup

The Moonraker integration reads a Klipper printer through Moonraker, the API behind Mainsail and Fluidd: its live status, the prints it finishes, cancels or fails, and its print history. That covers Voron, RatRig, Sovol, Qidi, Elegoo Neptune 4, Snapmaker U1, rooted Creality printers and most other Klipper machines. It is read-only: the app never starts, pauses or stops a print.

## What it needs

- The printer's address on your network: its IP (`192.168.1.50`) or host name (`voron.local`). The server running the app must reach it.
- Mainsail or Fluidd on port 80 works with the address alone. Moonraker on its own port needs it: `192.168.1.50:7125`. An `https://` address is used as typed.
- An API key only if Moonraker's `[authorization]` doesn't trust the server's address. Mainsail shows the key under **Settings → Machine → Authorization**; most setups list the local network in `trusted_clients` and need none.

## Connect

1. Open **Integrations**, press **Add** and choose **Moonraker (Klipper)**.
2. Enter the address, and the API key if you need one.
3. Optional: a name for the printer (else Klipper's host name), its brand and its model. Without a model the app takes the one your slicer wrote in the newest job file.
4. Press **Test connection** on the new card.

One integration is one printer. Add one per Klipper printer. The API key is stored encrypted on disk ([ADR-0005](adr/0005-secrets-storage.md)).

## What it reads

- **Printer:** the printer itself, from the **Printers** source.
- **Live status:** state, progress, time left, layer, nozzle and bed temperatures, and the filament from the job file. Switch it on with **Live status** on the card. Klipper only knows the layer when the slicer sends it (`SET_PRINT_STATS_INFO`); otherwise the app works it out from the height and the file's layer heights.
- **Print history:** jobs that ended while the app was off, from Moonraker's history. A job the app watched live and the same job in the history are one print.

## Grams and spools

- A **finished** print gets the file's totals per tool, as the slicer wrote them.
- A **cancelled** or **failed** print gets what really went out: Moonraker counts the filament extruded, and the app takes that share of the file's totals. These grams are measured, not estimated. On a printer with several tools Moonraker counts them together, so the split between tools is estimated.
- When Moonraker reports to **Spoolman** (its `[spoolman]` section), a job names the Spoolman spool it used, and the print's slot keeps it. If you imported that spool from [Spoolman](spoolman.md), the slot is charged to your spool for sure. Moonraker already charged the spool in Spoolman itself, so the app never writes that print to Spoolman again. A job that names no Spoolman spool is written back like any other printer's.
- **Moonraker reports to another Spoolman** (a checkbox in the setup): tick it when Moonraker's `[spoolman]` points at a different Spoolman than the one set up in the app. The spool a job names is then not one of yours, and the app's Spoolman wasn't charged, so the print is written back to it. It applies to prints recorded after you change it.
- The app's own spool is matched as for any printer ([printers.md](printers.md#grams-and-spools)), and is always charged.

## Troubleshooting

- **Can't be reached:** check the address in a browser on the server's machine (`http://<address>/server/info` answers with JSON). In Docker on a bridged network, use the printer's IP, not a `.local` name.
- **Sign-in required:** Moonraker refused the server. Add the API key, or the server's address to `trusted_clients`.
- **Offline on the dashboard:** the printer didn't answer or Klipper isn't connected to Moonraker. A printer that goes away during a print raises a **Printer offline** alert.
