# Printers and maintenance

A printer's or accessory's usage is its print hours and print count: the prints logged on it (an accessory counts the prints of the printers it was installed on, while it was on them) plus any corrections. Maintenance due dates count from that usage.

## Correcting usage

When the numbers are off, for example a printer bought used, prints made before you started logging, or a counter read off the machine, open the printer or accessory and press **Correct usage**. Type the real totals of hours and prints, with an optional note. The app saves the difference from what it counted as a correction; prints logged later add on top. The dialog lists every correction so far. The totals and maintenance due dates use the corrected usage right away. Maintenance already logged keeps the usage it recorded when it was done.

## Live status

A printer whose source reports live status shows a card on the dashboard and on its page: state (idle, preparing, printing, paused, finished, cancelled, error, offline), progress, time left, layer, temperatures and the filament slots. It updates by itself, every 3 seconds while the printer prepares, prints or is paused and every 15 seconds otherwise. Status is read-only: the app never controls a printer. You see a printer's status if you can see the printer.

Which printers report status depends on the source: Klipper printers through [Moonraker](moonraker.md), Bambu Lab printers through [Bambu LAN](bambu-lan.md). Prusa printers through [PrusaLink](prusalink.md). OctoPrint arrives in the next 6.0.0 pre-release, with its own setup page.

## How prints are recorded

When a printer's job ends (finished, cancelled or failed) the app records it as a print, once, at once. Nothing is held back for you to review first:
- its project is linked by title when one matches, else the print has no project (the Prints list can still link it later);
- a print that was already running when the app started watching is recorded with an estimated duration and its slots count as unsure;
- the app restarting during a print loses nothing, and a printer that reports the same end twice makes one print;
- two sources for the same printer (for example Bambu Cloud and the printer on your network) make one print, not two.

Automatic Bambu Cloud syncs follow the same rule: they record every new print instead of holding back the ones without a spool or a project ([bambu-cloud.md](bambu-cloud.md)). **Review and import** by hand, hand-logged prints and file imports are unchanged.

## Grams and spools

**Grams** come from the first source that has them: the printer, then the slicer totals in the print's file (OrcaSlicer, PrusaSlicer and Bambu Studio), then the slice result of the project plate the print matched. Where none has them, the slot waits in Filament to review. A print that was cancelled or failed gets the file's or plate's total times the share of the material it reached, and the print shows those grams as **estimated**. Each usage shows where its grams came from.

**The spool** is the first that answers: the spool the printer names (its RFID tag or the source's spool id), then the spool **loaded** in that printer slot, then a sure match by material and colour.

A spool learns its **RFID tag** (a Bambu AMS reads it from Bambu spools) the first time a slot with that tag is charged to it: by a sure match, a loaded spool, or the spool you pick or accept in Filament to review. From then on a print that names the tag charges that spool, even when other spools of the same colour would fit. The spool's page shows its tag. If a tag ever lands on the wrong spool, pick the right one in Filament to review or on the print: the tag moves to it. **Forget tag** on the spool's page drops it; the next print charged to a spool teaches it again.

On a printer's page, each filament slot has a **loaded spool**: set, change or clear it. The spool's page says where it is loaded, and archiving a spool takes it out of its slot. A loaded spool is only charged when it was loaded before the print ended. If its material differs from what the printer reported for the slot, or it can't hold the grams, nothing is charged and the slot waits in Filament to review.

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

Print finished, print failed, printer offline and filament to review are alerts. See [alerts.md](alerts.md#printer-alerts).
