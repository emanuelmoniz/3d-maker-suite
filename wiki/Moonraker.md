# Moonraker

Reads a Klipper printer through Moonraker, the service behind Mainsail and Fluidd: its live status, the prints it finishes, cancels or fails, and its print history. That covers Voron, RatRig, Sovol, Qidi, Elegoo Neptune 4, Snapmaker U1, rooted Creality printers and most other Klipper machines. It is read-only: the app never starts, pauses or stops a print.

![The Integrations page with an account card open](../docs/images/wiki-integrations.png)

## Who can use it

Setting it up needs **Set up integrations**. Works the same with or without a hub. With a hub on a server far from the printer, a computer next to the printer can read it for the hub, see [Hub on another network](#hub-on-another-network).

## Before you start

- The printer's address on your network: its IP (`192.168.1.50`) or host name (`voron.local`). The server that runs the app must reach it.
- Mainsail or Fluidd on port 80 works with the address alone. Moonraker on its own port needs the port: `192.168.1.50:7125`. An `https://` address is used as typed.
- An API key, only if Moonraker's `[authorization]` doesn't trust the server's address. Mainsail shows the key under **Settings → Machine → Authorization**. Most setups list the local network in `trusted_clients` and need no key.

## Connect

1. Open **Settings**, then **Integrations**, and press **Add integration**.
2. Pick **Moonraker (Klipper)**.
3. Under **Printer**, pick the printer if you already have it (added by hand, for example), or **New printer from this source**. A printer you pick keeps its own name, model and costs. Rename it on its printer page. With a new printer, **Name** is its name, else Klipper's host name.
4. Enter the **Address**, and the **API key** if you need one.
5. Optional: its **Brand** and **Model**. Without a model the app takes the one your slicer wrote in the newest job file.
6. Press **Test**, then **Add**. Saving asks the printer what it is, as **Test** does. If it doesn't answer, nothing is saved.
7. On the printer's block, switch on **Live status**.

The printer's page then shows where it is read from and whether it answers. See [Connection and monitoring](Printers.md#connection-and-monitoring).

| Field | What it means | Required | Example |
|---|---|---|---|
| **Printer** | The printer this source is, or **New printer from this source** | Yes | New printer from this source |
| **Name** | The name of a new printer | No | Voron 2.4 |
| **Address (IP or host name, with :7125 when Mainsail or Fluidd isn't on port 80)** | Where Moonraker answers | Yes | `192.168.1.50` |
| **Brand** | The printer's brand | No | Voron |
| **Model** | The printer's model | No | 2.4 |
| **API key (only if Moonraker asks for one)** | Stored encrypted | No | |
| **Moonraker reports to another Spoolman than the one set up here** | See [Grams and spools](#grams-and-spools) | No | Off |
| **Reached from** | **This server**, or a computer next to the printer. Only with a hub | No | This server |

One integration is one printer, so add one per Klipper printer. To link it to another printer later, press **Edit** and pick another **Printer**. The one it had stays, unlinked. Removing the integration keeps the printer. The key is stored encrypted and never logged.

### Hub on another network

A hub on a server can't reach a printer in your workshop. A computer on the printer's network reads it through its connector. Under **Reached from**, pick that computer. It needs **Reach printers** switched on, on its page, whose **Set up in Integrations** opens this form with the computer already picked. **Test** and saving go through that computer, so it must be online. See [Integrations](Integrations.md#reach-through-a-computer) and [Connector setup](Connector-Setup.md).

## What it reads

| What | How |
|---|---|
| **Printer** | The one you picked when you added it, or a new one made from what Klipper reports then |
| **Live status** | State, progress, time left, layer, nozzle and bed temperatures, and the filament from the job file. Switch it on with **Live status** on the block. Klipper only knows the layer when the slicer sends it (`SET_PRINT_STATS_INFO`). Otherwise the app works it out from the height and the file's layer heights |
| **Print history** | Jobs that ended while the app was off, from Moonraker's history. A job the app watched live and the same job in the history are one print |

To stop recording one printer's prints while its live status goes on, switch off **Record prints** on its line in **Prints → Settings → Sources**. The **Prints sources** button on its block opens the line. Its history isn't read while it is off, and jobs from that time aren't imported by themselves when you switch it back on. **Review and import** can bring them in. See [Prints settings](Prints-Settings.md#record-prints).

## Grams and spools

- A **finished** print gets the file's totals per tool, as the slicer wrote them.
- A **cancelled** or **failed** print gets what really went out: Moonraker counts the filament extruded, and the app takes that share of the file's totals. These grams are measured, not estimated. On a printer with several tools Moonraker counts them together, so the split between tools is estimated.
- When Moonraker reports to **Spoolman** (its `[spoolman]` section), a job names the Spoolman spool it used, and the print's slot keeps it. If you imported that spool from [Spoolman](Spoolman.md), the slot is charged to your spool for sure. Moonraker already charged the spool in Spoolman itself, so the app never writes that print to Spoolman again. A job that names no Spoolman spool is written back like any other printer's.
- **Moonraker reports to another Spoolman than the one set up here:** tick it when Moonraker's `[spoolman]` points at a different Spoolman than the one set up in the app. The spool a job names is then not one of yours, and the app's Spoolman wasn't charged, so the print is written back to it. It applies to prints recorded after you change it.
- The app's own spool is matched as for any printer, and is always charged. See [Loaded spools](Printers.md#loaded-spools).
- **Loaded spools:** while a job runs, the Spoolman spool it names is loaded in its slot by the printer, when you imported that spool from Spoolman. The job file's material and colour load nothing, because they describe the file, not the spool in the printer. Set any other loaded spool on the printer's page.

## Common tasks

### Add a Klipper printer

1. Press **Add integration**, pick **Moonraker (Klipper)**.
2. Enter the **Address**, press **Test**, then **Add**.
3. Switch on **Live status** on the printer's block.

### Bring in prints that ended while the app was off

1. Open **Prints**, then the gear, then **Sources**.
2. On the printer's line, open **⋯** and press **Review and import**.

## Related settings

- **Prints → Settings → Sources** holds **Record prints** for this printer.
- [Spoolman](Spoolman.md) imports your spools and takes usage back.

## Limits and tips

- It never controls the printer.
- The history only covers what Moonraker keeps. Switching **Record prints** off doesn't bring in the gap by itself.
- A Klipper printer with several tools gets one total from Moonraker, so the split between tools is estimated.

## Problems and fixes

| What you see | What to do |
|---|---|
| **The vendor service can't be reached.** | Open `http://<address>/server/info` in a browser on the server's computer. It answers with JSON. In Docker on a bridged network, use the printer's IP, not a `.local` name |
| **Sign-in required. Check the credentials.** | Moonraker refused the server. Add the API key, or the server's address to `trusted_clients` |
| **Offline** on the dashboard | The printer didn't answer, or Klipper isn't connected to Moonraker. A printer that goes away during a print raises a **Printer offline** alert |

## Related pages

- [Integrations](Integrations.md)
- [Spoolman](Spoolman.md)
- [Printers](Printers.md)
- [Prints settings](Prints-Settings.md)
- [Connector setup](Connector-Setup.md)
