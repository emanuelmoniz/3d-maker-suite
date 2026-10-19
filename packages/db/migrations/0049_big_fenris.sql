PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text NOT NULL,
	`trigger` text NOT NULL,
	`type` text,
	`range_from` text,
	`range_to` text,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`created` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_runs_trigger_ck" CHECK("__new_sync_runs"."trigger" IN ('manual', 'scheduled')),
	CONSTRAINT "sync_runs_status_ck" CHECK("__new_sync_runs"."status" IN ('ok', 'error')),
	CONSTRAINT "sync_runs_error_code_ck" CHECK("__new_sync_runs"."error_code" IN ('auth_required', 'auth_expired', 'rate_limited', 'unreachable', 'login_failed', 'code_invalid', 'blocked', 'api_changed', 'slice_failed', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_sync_runs`("id", "integration_id", "trigger", "type", "range_from", "range_to", "started_at", "finished_at", "status", "error_code", "created", "skipped") SELECT "id", "integration_id", "trigger", "type", "range_from", "range_to", "started_at", "finished_at", "status", "error_code", "created", "skipped" FROM `sync_runs`;--> statement-breakpoint
DROP TABLE `sync_runs`;--> statement-breakpoint
ALTER TABLE `__new_sync_runs` RENAME TO `sync_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sync_runs_integration_idx` ON `sync_runs` (`integration_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `project_slice_plates` ADD `printer_id` text REFERENCES printers(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `project_slice_plates` ADD `use_default_print_profile` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_slice_plates` ADD `spools` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Saved plates without a print profile meant "the default printer's": keep that meaning.
UPDATE `project_slice_plates` SET `use_default_print_profile` = 1 WHERE `print_profile_id` IS NULL;--> statement-breakpoint
UPDATE `project_slice_plates` SET `printer_id` = (SELECT `id` FROM `printers` WHERE `id` = (SELECT json_extract(`value`, '$') FROM `settings` WHERE `key` = 'defaultPrinterId')) WHERE `printer_id` IS NULL;
