# Job file headers

Sliced 2026-11-14 for ADR-0015 (Plan 6.0.0 Step 1), spike 2: where each slicer writes its filament totals. Scripts on branch `spike/printers`.

| File | Slicer | Model | Totals |
|---|---|---|---|
| `orcaslicer-klipper.gcode` | OrcaSlicer 2.5.0-rc, Voron 2.4 profile | 20 × 20 × 3 mm cube | the **last 253 bytes**: `; filament used [g] = 0.99`, `; total filament used [g] = 0.99` (one value per filament, comma separated). The header block has none. |
| `prusaslicer-klipper.gcode` | PrusaSlicer 2.9.7 | same cube | **11 KB before the end**, followed by the config block: `; filament used [g] = 1.20`, `; total filament used [g] = 1.20` |
| `prusaslicer.bgcode` | PrusaSlicer 2.9.7, binary G-code | same cube | the **Printer metadata block at byte 90**, not compressed: `filament used [g]=1.20` |
| `bambu-studio-1-filament.gcode.head`, `bambu-studio-4-filaments.gcode.head` | Bambu Studio 02.09.01.70 | `single_color.3mf`, `multi_color.3mf` from `../` | the **first 300 bytes**: `; total filament weight [g] : 98.33,10.09,9.70,6.60`. Only the filaments used are listed, so a value's position is not its slot. The legal notice line is cut. |
| `bambu-studio.gcode.3mf` | Bambu Studio 02.09.01.70 | `single_color.3mf` | `Metadata/slice_info.config`: `<filament id="4" … used_g="18.73"/>`, with the slot |

`orcaslicer-klipper.gcode` has one line added (`G28`) so the simulated printer could run it.
