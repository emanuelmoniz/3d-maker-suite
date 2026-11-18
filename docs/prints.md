# Prints

The app keeps a history of your prints. You can add a print by hand, import prints from a file ([import.md](import.md)), or let a source bring them in.

## Sources

**Prints → Settings → Sources** lists every source of prints as one row:

| Source | How its prints arrive |
|---|---|
| [Bambu Cloud](bambu-cloud.md) | From the account's history, on the row's schedule |
| [Moonraker](moonraker.md) | Live as each print ends, and from its history on the row's schedule |
| [Bambu LAN](bambu-lan.md), [PrusaLink](prusalink.md), [OctoPrint](octoprint.md) | Live as each print ends. The row says **Recorded live as each print ends** and has no schedule |

**Edit** on a row sets its review level and whether its prints take filament from your spools (**Track usage**).

## Record prints

A printer on your network has a **Record prints** switch on its row. The **Prints sources** button on the printer's card in Integrations opens that row.

With **Record prints** off:

- The printer records no prints. Its live status, its alerts about the printer and the dashboard carry on as before.
- Moonraker's history isn't read either.
- A printer reached through a [connector](hub.md#printers-through-a-connector) needs no change on that machine: the hub drops the prints it sends.

Prints you already have stay. Each printer has its own switch, so your other printers keep recording.

When you switch it back on, recording starts from that moment. Prints that ended while it was off are not brought in by themselves. Moonraker keeps them in its history, so you can still import them with **Review and import a period** in the row's `⋯` menu. PrusaLink, OctoPrint and Bambu LAN keep no history the app can read, so they can't bring those prints back.

**Live status** has to be on for a printer to record live: with it off, the row says so and no print is recorded.

**Bambu Cloud and Bambu LAN on the same printer** are two sources. Switching off **Record prints** for Bambu LAN doesn't stop the cloud account: to stop that printer's prints completely, also switch off the account's row.
