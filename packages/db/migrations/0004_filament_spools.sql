CREATE TABLE `spool_weight_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`spool_id` text NOT NULL,
	`kind` text NOT NULL,
	`delta_grams` real NOT NULL,
	`remaining_after` real NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`spool_id`) REFERENCES `spools`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "spool_weight_entries_kind_ck" CHECK("spool_weight_entries"."kind" IN ('manual', 'print', 'correction'))
);
--> statement-breakpoint
CREATE INDEX `spool_weight_entries_spool_idx` ON `spool_weight_entries` (`spool_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `filament_profiles` ADD `nozzle_temp_c` integer;--> statement-breakpoint
ALTER TABLE `filament_profiles` ADD `bed_temp_c` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `empty_weight_grams` real;--> statement-breakpoint
ALTER TABLE `spools` ADD `status` text DEFAULT 'new' NOT NULL CONSTRAINT "spools_status_ck" CHECK(`status` IN ('new', 'in_use', 'empty'));
