# Printers and maintenance

A printer's or accessory's usage is its print hours and print count: the prints logged on it (an accessory counts the prints of the printers it was installed on, while it was on them) plus any corrections. Maintenance due dates count from that usage.

## Correcting usage

When the numbers are off, for example a printer bought used, prints made before you started logging, or a counter read off the machine, open the printer or accessory and press **Correct usage**. Type the real totals of hours and prints, with an optional note. The app saves the difference from what it counted as a correction; prints logged later add on top. The dialog lists every correction so far. The totals and maintenance due dates use the corrected usage right away. Maintenance already logged keeps the usage it recorded when it was done.

## Live status

A printer whose source reports live status shows a card on the dashboard and on its page: state (idle, preparing, printing, paused, finished, cancelled, error, offline), progress, time left, layer, temperatures and the filament slots. It updates by itself, every 3 seconds while the printer prepares, prints or is paused and every 15 seconds otherwise. Status is read-only: the app never controls a printer. You see a printer's status if you can see the printer.

Which printers report status depends on the source: Klipper printers through [Moonraker](moonraker.md), Bambu Lab printers through [Bambu LAN](bambu-lan.md). Prusa printers through [PrusaLink](prusalink.md), and any printer behind [OctoPrint](octoprint.md).

A printer on the network is one printer, linked when you add its integration: pick the printer you already have (added by hand, or from Bambu Cloud) or **New printer from this source**. Your printer keeps its name, model and costs, and there is no **Printers** sync that could add it twice. The integration's **Edit** page links it to another printer; removing the integration keeps the printer.

The **serial number** belongs to the printer. While a source gives it, Bambu LAN or the Bambu Cloud account that brought the printer in, the printer's edit page shows it read-only with that source's name. Otherwise you edit it there.

A hub on another network, such as a VPS, reaches these printers through the connector of a machine on the printer's network: [printers through a connector](hub.md#printers-through-a-connector). The card then says which machine, and when that machine's connector is offline it says so instead of only "offline".

## Connection and monitoring

The **Printers** list has a **Monitoring** column that says whether the app can see each printer right now. It updates by itself, and it can be sorted and filtered (Not monitored, Synced only, Idle, Printing, Paused, Offline, Machine offline, Source error). Rows never move by themselves: while the list is sorted or filtered by Monitoring and a shown printer's state changes, a hint says so and **Refresh the list** reloads it. The **State** column (working, in repair…) is separate and stays as you set it.

| Monitoring | Meaning | What to do |
| --- | --- | --- |
| **Not monitored** | No source reads the printer, or its integration is paused. | Add the printer's integration, or resume it in **Settings → Integrations**. |
| **Synced only** | Every enabled source only syncs the printer and its prints on its schedule and gives no live status (Bambu Cloud alone). On the printer's page the source shows **Synced** with its last sync. | Nothing is wrong. For live status, add a source on your network, for a Bambu printer **Bambu LAN**. |
| **Idle**, **Printing 45 %**, **Paused**… | The printer answers; this is what it is doing. | Nothing. |
| **Checking…** | The source has just started and hasn't read the printer yet; it clears in a few seconds. | Nothing. |
| **Offline** | The printer doesn't answer, or its source fails for another reason (not a wrong key). | Check that it is on, on the network, and that the address is right. |
| **Machine offline** | The printer is reached through a machine whose connector is offline. | Start the connector on that machine ([hub.md](hub.md#printers-through-a-connector)). The printer is read again as soon as it is back. |
| **Source error** | The source refuses its access code or API key: it is wrong or has changed, or the account is signed out. | **Edit in Integrations** and enter the access code or key again. |

A printer with several sources, such as Bambu Cloud and Bambu LAN, shows the best one: a source that sees the printer wins over one that doesn't.

A printer's page has a **Connection** section, one block per source: the source, its address, whether a credential is set (for example "Access code: set", never its value), **Reached from** (this server, or the machine with its online state) and the same Monitoring state, with what to do about it. Nothing there is editable. **Edit in Integrations** opens the source's Edit page; you need the **Integrations** right for it, and without it the address and the credentials line are left out.

## How prints are recorded

When a printer's job ends (finished, cancelled or failed) the app records it as a print, once, at once. Nothing is held back for you to review first:
- its project is linked by title when one matches, else the print has no project (the Prints list can still link it later);
- a print that was already running when the app started watching is recorded with an estimated duration and its slots count as unsure;
- the app restarting during a print loses nothing, and a printer that reports the same end twice makes one print;
- two sources for the same printer (for example Bambu Cloud and the printer on your network) make one print, not two.

Automatic Bambu Cloud syncs follow the same rule: they record every new print instead of holding back the ones without a spool or a project ([bambu-cloud.md](bambu-cloud.md)). **Review and import** by hand, hand-logged prints and file imports are unchanged.

## Grams and spools

**Grams** come from the first source that has them: the printer, then the slicer totals in the print's file (OrcaSlicer, PrusaSlicer and Bambu Studio), then the slice result of the project plate the print matched. Where none has them, the slot waits in Filament to review. A print that was cancelled or failed gets the file's or plate's total times the share of the material it reached, and the print shows those grams as **estimated**. Each usage shows where its grams came from.

**The spool** is the first that answers: the spool the printer names (its RFID tag, or the Spoolman spool a Moonraker job names, when you imported it from [Spoolman](spoolman.md)), then the spool **loaded** in that printer slot, then a sure match by material and colour.

A spool learns its **RFID tag** (a Bambu AMS reads it from Bambu spools) the first time a slot with that tag is charged to it: by a sure match, a loaded spool, or the spool you pick or accept in Filament to review. From then on a print that names the tag charges that spool, even when other spools of the same colour would fit. The spool's page shows its tag. If a tag ever lands on the wrong spool, pick the right one in Filament to review or on the print: the tag moves to it. **Forget tag** on the spool's page drops it; the next print charged to a spool teaches it again.

On a printer's page, each filament slot has a **loaded spool**: set, change or clear it. The spool's page says where it is loaded, and archiving a spool takes it out of its slot. A loaded spool is only charged when it was loaded before the print ended. If its material differs from what the printer reported for the slot, or it can't hold the grams, nothing is charged and the slot waits in Filament to review. Slots are named as the printer numbers them: **Slot 1** and up for a spool unit's slots, **Single-slot unit 1** and up for a unit with one slot (Bambu's AMS HT), and **External spool** for the spool outside any unit (Bambu's spool on the back).

**Loaded by the printer.** A printer that reports what is in each slot loads the spools itself, also when idle, with no click. The page marks such a spool **Loaded by the printer**. While the printer is online, for each slot it reports:

- The spool whose RFID tag it reads, or the Spoolman spool it names, is loaded there: moved from any other slot, and replacing what was there, also a spool you picked.
- A spool you picked stays otherwise. If its material doesn't match, the print waits in Filament to review as above.
- When exactly one spool of the slot's material and colour isn't loaded elsewhere, it is loaded. This needs a printer that reads the spool itself ([Bambu LAN](bambu-lan.md)). A colour that comes from the job file ([Moonraker](moonraker.md)) loads nothing.
- When several spools fit, the slot shows the likeliest one: the spool last used in that slot, else the oldest. **Accept** loads it, as your pick.
- When a tray goes empty, a spool the printer loaded there is unloaded. A spool you picked stays.

If you clear a slot the printer filled, it stays empty until the printer reads something else there. This also works for a printer reached [through a connector](hub.md). Each slot reads again whenever the printer's status changes, and after a restart.

## Review level

The **review level** decides which slots wait in **Prints → Filament to review**:

| Slot | Never | When unsure (default) | Always |
|---|---|---|---|
| Sure spool, real grams | charged | charged | waits, spool suggested |
| Sure spool, estimated grams | charged | waits, spool suggested | waits, spool suggested |
| A guess among several spools, or a loaded spool that contradicts the printer | not tracked | waits, guess suggested | waits, guess suggested |
| No spool | not tracked | waits | waits |

Set it in **Prints → Settings → General** for everything, on a source line's **Edit** under **Sources**, or on the printer's form. Each is **Use the default** or a level; the most specific one wins (printer, then source, then global), and each place shows the level in effect and whose it is.

In Filament to review a suggested spool is preselected, and **Accept** charges it. Nothing is charged until you accept, and picking another spool charges only that one. **Accept suggestions** in the bar accepts every row's own suggestion. Estimated grams are marked and can be corrected in the row.

## Printer alerts

Print finished, print failed, printer offline, printer unreachable (its connector is offline) and filament to review are alerts. See [alerts.md](alerts.md#printer-alerts).
