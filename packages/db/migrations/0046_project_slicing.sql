CREATE TABLE `print_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`printer_model_id` text,
	`nozzle_diameter_mm` real,
	`layer_height_mm` real,
	`source_preset` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printer_model_id`) REFERENCES `printer_models`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `print_profiles_model_idx` ON `print_profiles` (`printer_model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `print_profiles_source_uq` ON `print_profiles` (`source_preset`) WHERE "print_profiles"."archived_at" IS NULL;--> statement-breakpoint
CREATE TABLE `project_slice_plates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`file` text NOT NULL,
	`plate` integer NOT NULL,
	`print_profile_id` text,
	`filaments` text DEFAULT '[]' NOT NULL,
	`file_size` integer NOT NULL,
	`file_mtime_ms` real NOT NULL,
	`file_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`print_profile_id`) REFERENCES `print_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_slice_plates_uq` ON `project_slice_plates` (`project_id`,`file`,`plate`);--> statement-breakpoint
ALTER TABLE `printers` ADD `print_profile_id` text REFERENCES print_profiles(id) ON DELETE set null;