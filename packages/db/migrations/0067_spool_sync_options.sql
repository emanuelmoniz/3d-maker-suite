PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`severity` text NOT NULL,
	`module` text NOT NULL,
	`task` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`detail` text,
	`created_at` text NOT NULL,
	`read_at` text,
	`notified_at` text,
	`snoozed_until` text,
	`dismissed_at` text,
	`resolved_at` text,
	`updated_at` text,
	CONSTRAINT "alerts_kind_ck" CHECK("__new_alerts"."kind" IN ('maintenance_due', 'spool_low', 'spool_no_price', 'spool_no_open_date', 'warranty_ending', 'sync_pending', 'sync_success', 'sync_error', 'slice_setup_changed', 'slice_failed', 'update_available')),
	CONSTRAINT "alerts_severity_ck" CHECK("__new_alerts"."severity" IN ('error', 'warning', 'success')),
	CONSTRAINT "alerts_module_ck" CHECK("__new_alerts"."module" IN ('filament', 'maintenance', 'printers', 'integrations', 'projects', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "kind", "severity", "module", "task", "entity_type", "entity_id", "context", "detail", "created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at", "resolved_at", "updated_at") SELECT "id", "kind", "severity", "module", "task", "entity_type", "entity_id", "context", "detail", "created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at", "resolved_at", "updated_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_open_uq` ON `alerts` (`kind`,`entity_type`,`entity_id`) WHERE "alerts"."resolved_at" IS NULL;--> statement-breakpoint
-- Spools are referenced (weight entries, usages) and the migrator runs in a transaction, where
-- `foreign_keys=OFF` is ignored. So: checks wait for the commit, the rows are kept aside, and they
-- go back into `spools` itself, which settles the children the drop left pointing at nothing.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__old_spools` AS SELECT * FROM `spools`;--> statement-breakpoint
DROP TABLE `spools`;--> statement-breakpoint
CREATE TABLE `spools` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`number` integer,
	`color_hex` text DEFAULT '#808080' NOT NULL,
	`color_name` text,
	`initial_grams` real,
	`remaining_grams` real,
	`empty_weight_grams` real,
	`status` text DEFAULT 'new' NOT NULL,
	`price_paid` integer,
	`purchased_at` text,
	`opened_at` text,
	`location` text,
	`source_spool` text,
	`low_grams` real,
	`low_alert` integer,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `filament_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "spools_status_ck" CHECK("spools"."status" IN ('new', 'in_use', 'empty'))
);
--> statement-breakpoint
INSERT INTO `spools`("id", "profile_id", "number", "color_hex", "color_name", "initial_grams", "remaining_grams", "empty_weight_grams", "status", "price_paid", "purchased_at", "opened_at", "location", "source_spool", "low_grams", "low_alert", "archived_at", "created_at", "updated_at") SELECT "id", "profile_id", "number", "color_hex", "color_name", "initial_grams", "remaining_grams", "empty_weight_grams", "status", "price_paid", "purchased_at", "opened_at", "location", "source_spool", "low_grams", "low_alert", "archived_at", "created_at", "updated_at" FROM `__old_spools`;--> statement-breakpoint
DROP TABLE `__old_spools`;--> statement-breakpoint
CREATE INDEX `spools_profile_idx` ON `spools` (`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `spools_source_uq` ON `spools` (`source_spool`);--> statement-breakpoint
CREATE UNIQUE INDEX `spools_number_uq` ON `spools` (`number`);--> statement-breakpoint
CREATE TABLE `__new_sync_policies` (
	`integration_id` text NOT NULL,
	`type` text NOT NULL,
	`mode` text NOT NULL,
	`frequency` text NOT NULL,
	`last_run_at` text,
	`cursor` text,
	`pending` integer DEFAULT 0 NOT NULL,
	`alert_severities` text,
	`track_usage` integer DEFAULT true NOT NULL,
	`scope` text DEFAULT 'all' NOT NULL,
	`merge` text DEFAULT 'keepEdits' NOT NULL,
	`new_weight` text DEFAULT 'import' NOT NULL,
	`new_opened_at` text DEFAULT 'unset' NOT NULL,
	`at_minute` integer,
	`at_hour` integer,
	`at_weekday` integer,
	`at_day` integer,
	PRIMARY KEY(`integration_id`, `type`),
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_policies_mode_ck" CHECK("__new_sync_policies"."mode" IN ('off', 'manual', 'auto')),
	CONSTRAINT "sync_policies_frequency_ck" CHECK("__new_sync_policies"."frequency" IN ('15m', '1h', '1d', '1w', '1M')),
	CONSTRAINT "sync_policies_scope_ck" CHECK("__new_sync_policies"."scope" IN ('all', 'imported')),
	CONSTRAINT "sync_policies_merge_ck" CHECK("__new_sync_policies"."merge" IN ('overwrite', 'keepEdits', 'review')),
	CONSTRAINT "sync_policies_new_weight_ck" CHECK("__new_sync_policies"."new_weight" IN ('import', 'unset', 'review')),
	CONSTRAINT "sync_policies_new_opened_at_ck" CHECK("__new_sync_policies"."new_opened_at" IN ('import', 'unset', 'review'))
);
--> statement-breakpoint
INSERT INTO `__new_sync_policies`("integration_id", "type", "mode", "frequency", "last_run_at", "cursor", "pending", "alert_severities", "track_usage", "scope", "merge", "at_minute", "at_hour", "at_weekday", "at_day") SELECT "integration_id", "type", "mode", "frequency", "last_run_at", "cursor", "pending", "alert_severities", "track_usage", "scope", "merge", "at_minute", "at_hour", "at_weekday", "at_day" FROM `sync_policies`;--> statement-breakpoint
DROP TABLE `sync_policies`;--> statement-breakpoint
ALTER TABLE `__new_sync_policies` RENAME TO `sync_policies`;