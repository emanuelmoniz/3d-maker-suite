# ADR-0023: One Catalog module

- Status: Accepted (2026-11-11, Plan 5.5.0 Step 11f, after the Step 11e review). Amends ADR-0016 (no `presets` level, no `machine.presets` switch), ADR-0021 (the Presets module goes; a receiver's per-kind Receive lines go) and ADR-0022 (a receiver's line is System; one Sources tab).
- Date: 2026-11-11

## Context
Step 11e left Receive from the hub with one **Catalog and system presets** line on two tabs, and Step 11f was to split it into a Catalog line and a System presets line. A slicer's `system/` folder doesn't split that way:

- Bambu Studio and OrcaSlicer keep printer models and printer presets together in `<vendor>/machine/`, behind one vendor index (`<vendor>.json`) that lists every file of every kind. The slicer loads only what the index lists, and a listed file that's missing breaks the vendor. A printer preset can't load without its model.
- OrcaSlicer 2.5+ ships each vendor as one binary `system/<vendor>.opc` holding the models and every preset.

The two modules overlapped too: Catalog has brands, models and materials, Presets has the presets those come from, each has a Sources tab, each has a right, and a machine page has a switch for each.

## Decision

### One module
- **Catalog** has two tabs. **Printers:** Brands, Printer models, Printer presets, Process presets. **Filament:** Filament brands, Materials, Filament presets. A preset table holds system and user presets together, with its Scope column (System or User).
- The **Presets** page, its nav item and its settings go; `/presets/*` lands on the matching Catalog tab and table. The **Preset library** (hub on) is a tab of Catalog settings.

### One Sources tab
- Catalog settings → Sources. Each source's card is one table with the lines it has, of: Printer brands, Printer models, Printer system presets, Process system presets, Filament brands, Filament materials, Filament system presets, Printer user presets, Process user presets, Filament user presets.

### Two Receive switches
- Per receiver (a machine, or This server's own install) and slicer, **System** and **User presets**, each on or off:
  - both: a full copy of the hub's slicer;
  - System only: the hub's `system/` (as `system.receive` and `catalogReceive` write it today, whole), and the slicer's own user presets stay;
  - User presets only: the hub's user presets, all three kinds, and the slicer keeps its own `system/`.
- The per-kind Receive lines go (`presetLibraries[lib].user.receiveKinds`). Share keeps its kinds (`shareKinds`): they are a machine's three user preset lines.
- No split of `system/`, so the connector's `catalog.install` doesn't change.

### One right
- `presets` merges into `catalog`, and `machine.presets` into `machine.catalog`. A machine's Slicers rows: Use as slicer (`machine.slicers`), System and User presets (`machine.catalog`).

## Consequences
- Migration 0117: every role and every user override gets the higher of its `catalog` and `presets` levels, and `machine.catalog` on if either switch was on; then the old keys go. Nobody loses a right; someone with only one of the two gains the other.
- Migration 0117 drops `receiveKinds`: a machine that received only some kinds now receives all three. Nothing it already has is removed.
- A Catalog line can't be turned off for system presets alone on a receiver: who wants the hub's catalog in a slicer gets its system presets with it, as the slicer needs them.
- Plan 5.5.0 Steps 11f (data and rights), 11g (the Catalog page), 11h (the Sources tab), 11i (This server receives user presets, one switch).
