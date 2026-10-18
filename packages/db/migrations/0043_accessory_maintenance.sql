ALTER TABLE `maintenance_types` ADD `target` text DEFAULT 'printer' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `applies_to_accessory_types` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `applies_to_accessory_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Nullable printer + accessory with a one-target CHECK: rebuild. Nothing points at this table.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_maintenance_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text,
	`accessory_id` text,
	`type_id` text NOT NULL,
	`done_at` text NOT NULL,
	`printer_runtime_sec_at` integer NOT NULL,
	`printer_prints_at` integer NOT NULL,
	`notes` text,
	`cost` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`accessory_id`) REFERENCES `accessories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`type_id`) REFERENCES `maintenance_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "maintenance_tasks_target_ck" CHECK(("__new_maintenance_tasks"."printer_id" IS NULL) <> ("__new_maintenance_tasks"."accessory_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_maintenance_tasks`("id", "printer_id", "accessory_id", "type_id", "done_at", "printer_runtime_sec_at", "printer_prints_at", "notes", "cost", "created_at", "updated_at") SELECT "id", "printer_id", NULL, "type_id", "done_at", "printer_runtime_sec_at", "printer_prints_at", "notes", "cost", "created_at", "updated_at" FROM `maintenance_tasks`;--> statement-breakpoint
DROP TABLE `maintenance_tasks`;--> statement-breakpoint
ALTER TABLE `__new_maintenance_tasks` RENAME TO `maintenance_tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `maintenance_tasks_latest_idx` ON `maintenance_tasks` (`printer_id`,`type_id`,`done_at`);--> statement-breakpoint
CREATE INDEX `maintenance_tasks_accessory_idx` ON `maintenance_tasks` (`accessory_id`,`type_id`,`done_at`);
