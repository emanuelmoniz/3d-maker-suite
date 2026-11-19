# Writing the wiki

`wiki/` in this repo is the source of the GitHub wiki. A workflow publishes it, so never edit the wiki on GitHub: the next publish overwrites the change.

## Pages

- Keep all pages directly in `wiki/`, each with a unique name. The file name is the page name, for example `Printers-Settings.md`.
- Give each feature one page. A feature's list, detail and form screens share that page, and its settings get their own.
- Add a new page to `WIKI_PAGES` in `packages/core/src/wikiRoutes.ts` and to `wiki/_Sidebar.md`.
- List a page in the sidebar only once its file exists.

## Checking the wiki

Run `pnpm wiki:check` after any change in `wiki/`. It fails on a broken page link, a missing heading anchor, a missing image, a page that isn't in the sidebar, a sidebar entry with no page, and a route map entry that points at a heading that doesn't exist. A map entry whose page isn't written yet is listed as pending, not an error. `pnpm wiki:check --strict` makes pending an error. CI runs the check.

## Links and images

Write links and images so they also work when browsing the repo. The publish step converts them for the wiki.

| What | Write it as |
|---|---|
| Another page | `[Printer details](Printers.md#printer-details)` |
| A section on the same page | `[Fields](#fields)` |
| An image | `![The printers list](../docs/images/printers.png)` |
| Anything outside the wiki | A full `https://` address |

## Standard page layout

Every feature page uses these sections, in this order. Leave out any that don't apply.

1. What this page is for, in one or two sentences
2. Screenshot
3. Who can use it (rights, and hub or account mode)
4. Before you start
5. One section per screen, covering every card, tab, table column, button and dialog
6. Fields table: what each field means, whether it is required, and an example
7. Common tasks as numbered steps
8. Related settings
9. Limits and tips
10. Problems and fixes
11. Related pages

## Writing a page

- Read the screen's code and its labels in `apps/web/src/locales/en`, and open the screen in the running app. The older guides in `docs/` are a starting point, not the truth.
- Write short sentences and everyday words.
- Put app labels in bold, exactly as they appear on screen.
- Add the page to `wiki/_Sidebar.md`, under the group listed below.
- Check that each of the page's screens in the route map points to a real heading.
- A limitation you find while writing gets a fix or a new plan step, not a documented workaround. Report app bugs and stale labels in the step's summary.

## Sidebar groups

| Group | Pages |
|---|---|
| Get started | Choose-How-to-Run, Install-on-Windows, Install-on-macOS, Install-on-Linux, Install-from-Source, Docker, NAS, Server-and-Remote-Access, First-Run, Use-From-Another-Device, Configuration, Updates, Backups-and-Restore, Move-or-Uninstall, Hub-Setup, Connector-Setup |
| Equipment | Dashboard, Printers, Printers-Settings, Accessories, Maintenance, Filament, Filament-Settings, Catalog, Presets, Catalog-Settings |
| Work | Projects, Projects-Settings, Project-Folders, Prints, Filament-Review, Prints-Settings |
| Accounting | Quotes, Quotes-Settings, Orders, Orders-Settings, Clients |
| Insights | Stats, Alerts, Alerts-Settings |
| Administration | Settings-General, My-Account, Sign-In, Users, Roles, Import-and-Export, Logs, Hub-Management |
| Integrations | Integrations, Bambu-Cloud, Bambu-LAN, Moonraker, OctoPrint, PrusaLink, Spoolman, Slicers |
| Help | Troubleshooting, FAQ, Glossary, Sources-and-Sync, Archive-and-Delete |

## Route map

`WIKI_ROUTES` in `packages/core/src/wikiRoutes.ts` says which wiki page and section explains each address of the app:

```ts
"/printers/$id": { page: "Printers", section: "printer-details" },
```

- The key is the address exactly as written in `apps/web/src/router.tsx`.
- `section` is the anchor GitHub makes from the heading. The heading `## Printer details` becomes `printer-details`.
- The sections in the map are planned names. When a page is written, use those headings, or change the map if a better heading fits.
- A new app page gets its entry in the map, its wiki section and its Help link in the same step.
- Don't rename a page or a heading the map points to without updating the map. A renamed page also leaves a pointer page behind.
- Addresses that only redirect stay out of the map.
- Dialogs have no address, so they are explained in the section of the screen that opens them.
