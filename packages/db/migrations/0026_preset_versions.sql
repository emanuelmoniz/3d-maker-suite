DROP INDEX `filament_profiles_source_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `filament_profiles_source_uq` ON `filament_profiles` (`source_preset`) WHERE "filament_profiles"."archived_at" IS NULL;--> statement-breakpoint
DROP INDEX `machine_profiles_source_uq`;--> statement-breakpoint
ALTER TABLE `machine_profiles` ADD `archived_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `machine_profiles_source_uq` ON `machine_profiles` (`source_preset`) WHERE "machine_profiles"."archived_at" IS NULL;