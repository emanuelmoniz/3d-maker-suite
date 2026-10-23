CREATE TABLE `import_snapshots` (
	`integration_id` text NOT NULL,
	`entity` text NOT NULL,
	`row_id` text NOT NULL,
	`values` text NOT NULL,
	PRIMARY KEY(`integration_id`, `entity`, `row_id`),
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	PRIMARY KEY(`integration_id`, `type`),
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_policies_mode_ck" CHECK("__new_sync_policies"."mode" IN ('off', 'manual', 'auto')),
	CONSTRAINT "sync_policies_frequency_ck" CHECK("__new_sync_policies"."frequency" IN ('15m', '1h', '1d', '1w', '1M')),
	CONSTRAINT "sync_policies_scope_ck" CHECK("__new_sync_policies"."scope" IN ('all', 'imported')),
	CONSTRAINT "sync_policies_merge_ck" CHECK("__new_sync_policies"."merge" IN ('overwrite', 'keepEdits', 'review'))
);
--> statement-breakpoint
INSERT INTO `__new_sync_policies`("integration_id", "type", "mode", "frequency", "last_run_at", "cursor", "pending", "alert_severities", "track_usage", "scope", "merge") SELECT "integration_id", "type", "mode", "frequency", "last_run_at", "cursor", "pending", "alert_severities", "track_usage", 'all', CASE WHEN "type" IN ('printers', 'spools') THEN 'review' ELSE 'keepEdits' END FROM `sync_policies`;--> statement-breakpoint
DROP TABLE `sync_policies`;--> statement-breakpoint
ALTER TABLE `__new_sync_policies` RENAME TO `sync_policies`;--> statement-breakpoint
PRAGMA foreign_keys=ON;