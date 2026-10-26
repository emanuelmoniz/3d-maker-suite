PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- The migrator runs in a transaction, where the pragma is a no-op: dropping `alerts` cascades to
-- `alert_states`, so the per-user states are kept aside and put back.
CREATE TABLE `__keep_alert_states` AS SELECT * FROM `alert_states`;--> statement-breakpoint
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
	CONSTRAINT "alerts_kind_ck" CHECK("__new_alerts"."kind" IN ('maintenance_due', 'spool_low', 'spool_no_price', 'spool_no_open_date', 'warranty_ending', 'sync_pending', 'sync_success', 'sync_error', 'slice_setup_changed', 'slice_failed', 'update_available', 'slicer_update')),
	CONSTRAINT "alerts_severity_ck" CHECK("__new_alerts"."severity" IN ('error', 'warning', 'success')),
	CONSTRAINT "alerts_module_ck" CHECK("__new_alerts"."module" IN ('filament', 'maintenance', 'printers', 'integrations', 'projects', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "kind", "severity", "module", "task", "entity_type", "entity_id", "context", "detail", "created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at", "resolved_at", "updated_at") SELECT "id", "kind", "severity", "module", "task", "entity_type", "entity_id", "context", "detail", "created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at", "resolved_at", "updated_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_open_uq` ON `alerts` (`kind`,`entity_type`,`entity_id`) WHERE "alerts"."resolved_at" IS NULL;--> statement-breakpoint
INSERT INTO `alert_states`("alert_id", "user_id", "read_at", "snoozed_until", "dismissed_at", "updated_at") SELECT "alert_id", "user_id", "read_at", "snoozed_until", "dismissed_at", "updated_at" FROM `__keep_alert_states`;--> statement-breakpoint
DROP TABLE `__keep_alert_states`;--> statement-breakpoint
ALTER TABLE `project_slice_plates` ADD `sliced_slicer_version` text;