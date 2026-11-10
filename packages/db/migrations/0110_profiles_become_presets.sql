-- ADR-0021: profiles become presets, `print` becomes `process` where it names a preset kind.
-- Hand-written renames instead of drizzle-kit's table rebuilds: the migrator runs in one
-- transaction where `foreign_keys=OFF` is ignored, so dropping `process_presets` or `printers`
-- would fire their `ON DELETE set null` / `restrict`. RENAME rewrites the references in place.
ALTER TABLE `machine_profiles` RENAME TO `machine_presets`;--> statement-breakpoint
ALTER TABLE `print_profiles` RENAME TO `process_presets`;--> statement-breakpoint
ALTER TABLE `filament_profiles` RENAME TO `filament_presets`;--> statement-breakpoint
ALTER TABLE `machine_presets` RENAME COLUMN `default_print_preset` TO `default_process_preset`;--> statement-breakpoint
ALTER TABLE `printers` RENAME COLUMN `print_profile_id` TO `process_preset_id`;--> statement-breakpoint
ALTER TABLE `printers` RENAME COLUMN `machine_profile_id` TO `machine_preset_id`;--> statement-breakpoint
ALTER TABLE `prints` RENAME COLUMN `machine_profile_id` TO `machine_preset_id`;--> statement-breakpoint
ALTER TABLE `project_slice_plates` RENAME COLUMN `machine_profile_id` TO `machine_preset_id`;--> statement-breakpoint
ALTER TABLE `project_slice_plates` RENAME COLUMN `print_profile_id` TO `process_preset_id`;--> statement-breakpoint
ALTER TABLE `project_slice_plates` RENAME COLUMN `use_default_print_profile` TO `use_default_process_preset`;--> statement-breakpoint
ALTER TABLE `project_slice_plates` RENAME COLUMN `sliced_print_profile_id` TO `sliced_process_preset_id`;--> statement-breakpoint
DROP INDEX `machine_profiles_model_idx`;--> statement-breakpoint
DROP INDEX `machine_profiles_source_uq`;--> statement-breakpoint
DROP INDEX `print_profiles_model_idx`;--> statement-breakpoint
DROP INDEX `print_profiles_source_uq`;--> statement-breakpoint
DROP INDEX `filament_profiles_brand_idx`;--> statement-breakpoint
DROP INDEX `filament_profiles_material_idx`;--> statement-breakpoint
DROP INDEX `filament_profiles_source_uq`;--> statement-breakpoint
CREATE INDEX `machine_presets_model_idx` ON `machine_presets` (`printer_model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `machine_presets_source_uq` ON `machine_presets` (`source_preset`) WHERE "machine_presets"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `process_presets_model_idx` ON `process_presets` (`printer_model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `process_presets_source_uq` ON `process_presets` (`source_preset`) WHERE "process_presets"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX `filament_presets_brand_idx` ON `filament_presets` (`brand_id`);--> statement-breakpoint
CREATE INDEX `filament_presets_material_idx` ON `filament_presets` (`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `filament_presets_source_uq` ON `filament_presets` (`source_preset`) WHERE "filament_presets"."archived_at" IS NULL;--> statement-breakpoint
-- Stored sync and import type ids. Case-sensitive, so `machineProfiles` never hits `userMachineProfiles`.
UPDATE `sync_policies` SET `type` = replace(replace(replace(`type`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets') WHERE `type` LIKE '%Profiles';--> statement-breakpoint
UPDATE `sync_runs` SET `type` = replace(replace(replace(`type`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets') WHERE `type` LIKE '%Profiles';--> statement-breakpoint
UPDATE `import_runs` SET `type` = replace(replace(replace(`type`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets') WHERE `type` LIKE '%Profiles';--> statement-breakpoint
UPDATE `import_snapshots` SET `entity` = replace(replace(replace(`entity`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets') WHERE `entity` LIKE '%Profiles';--> statement-breakpoint
UPDATE `deleted_sources` SET `entity` = replace(replace(replace(`entity`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets') WHERE `entity` LIKE '%Profiles';--> statement-breakpoint
UPDATE `preset_routes` SET `entity` = replace(replace(replace(`entity`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets') WHERE `entity` LIKE '%Profiles';--> statement-breakpoint
-- Sync alerts: `sync:<integration>:<type>`, `<integration>:<type>` and `context.type`.
UPDATE `alerts` SET
  `task` = replace(replace(replace(`task`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets'),
  `entity_id` = replace(replace(replace(`entity_id`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets'),
  `context` = replace(replace(replace(`context`, 'achineProfiles', 'achinePresets'), 'rintProfiles', 'rocessPresets'), 'ilamentProfiles', 'ilamentPresets')
  WHERE `kind` LIKE 'sync_%' AND (`task` LIKE '%Profiles' OR `entity_id` LIKE '%Profiles' OR `context` LIKE '%Profiles"%');--> statement-breakpoint
-- JSON keys (JSON.stringify output: a quote inside a value is escaped, so only keys match).
UPDATE `projects` SET `meta` = replace(replace(replace(`meta`, '"printProfile":', '"processPreset":'), '"machineProfile":', '"machinePreset":'), '"profile":', '"preset":') WHERE `meta` LIKE '%Profile"%' OR `meta` LIKE '%"profile"%';--> statement-breakpoint
UPDATE `import_snapshots` SET `values` = replace(`values`, '"defaultPrintProfile":', '"defaultProcessPresetName":') WHERE `entity` = 'machinePresets';--> statement-breakpoint
-- `code` or `code: detail`.
UPDATE `project_slice_plates` SET `slice_error` = 'no_printer_preset' || substr(`slice_error`, 19) WHERE `slice_error` LIKE 'no\_printer\_profile%' ESCAPE '\';
