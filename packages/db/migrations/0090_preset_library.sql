CREATE TABLE `slicer_preset_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`preset_id` text NOT NULL,
	`version` integer NOT NULL,
	`json` text NOT NULL,
	`sha256` text NOT NULL,
	`saved_user` text,
	`saved_device` text,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`preset_id`) REFERENCES `slicer_presets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slicer_preset_versions_uq` ON `slicer_preset_versions` (`preset_id`,`version`);--> statement-breakpoint
CREATE TABLE `slicer_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`library` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`json` text NOT NULL,
	`sha256` text NOT NULL,
	`version` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`seq` integer NOT NULL,
	`saved_user` text,
	`saved_device` text,
	`saved_at` text NOT NULL,
	CONSTRAINT "slicer_presets_kind_ck" CHECK("slicer_presets"."kind" IN ('machine', 'process', 'filament'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slicer_presets_name_uq` ON `slicer_presets` (`library`,`kind`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `slicer_presets_seq_uq` ON `slicer_presets` (`seq`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- As in 0081: dropping `alerts` cascades to `alert_states`, so the per-user states are kept aside.
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
	CONSTRAINT "alerts_kind_ck" CHECK("__new_alerts"."kind" IN ('maintenance_due', 'spool_low', 'spool_no_price', 'spool_no_open_date', 'warranty_ending', 'sync_pending', 'sync_success', 'sync_error', 'slice_setup_changed', 'slice_failed', 'update_available', 'slicer_update', 'connector_outdated', 'hub_conflict', 'hub_mass_delete', 'preset_conflict', 'preset_skipped')),
	CONSTRAINT "alerts_severity_ck" CHECK("__new_alerts"."severity" IN ('error', 'warning', 'success')),
	CONSTRAINT "alerts_module_ck" CHECK("__new_alerts"."module" IN ('filament', 'maintenance', 'printers', 'integrations', 'projects', 'system', 'hub'))
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "kind", "severity", "module", "task", "entity_type", "entity_id", "context", "detail", "created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at", "resolved_at", "updated_at") SELECT "id", "kind", "severity", "module", "task", "entity_type", "entity_id", "context", "detail", "created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at", "resolved_at", "updated_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_open_uq` ON `alerts` (`kind`,`entity_type`,`entity_id`) WHERE "alerts"."resolved_at" IS NULL;--> statement-breakpoint
INSERT INTO `alert_states`("alert_id", "user_id", "read_at", "snoozed_until", "dismissed_at", "updated_at", "notified_at") SELECT "alert_id", "user_id", "read_at", "snoozed_until", "dismissed_at", "updated_at", "notified_at" FROM `__keep_alert_states`;--> statement-breakpoint
DROP TABLE `__keep_alert_states`;--> statement-breakpoint
ALTER TABLE `project_slice_plates` ADD `sliced_presets` text;--> statement-breakpoint
-- ADR-0017: presets.manage is on for Admin and Editor, off for Viewer; other roles fail closed (off).
-- The Admin role gets the two new kinds as notify, as 0088 gave it every kind.
UPDATE `roles` SET `permissions` = json_set(`permissions`, '$."presets.manage"', json(CASE WHEN `built_in` IN ('admin', 'editor') THEN 'true' ELSE 'false' END))
WHERE `built_in` IS NOT NULL;--> statement-breakpoint
UPDATE `roles` SET `alert_kinds` = json_set(`alert_kinds`, '$.preset_conflict', 'notify', '$.preset_skipped', 'notify')
WHERE `built_in` = 'admin';