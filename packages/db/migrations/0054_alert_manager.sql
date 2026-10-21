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
	CONSTRAINT "alerts_kind_ck" CHECK("__new_alerts"."kind" IN ('maintenance_due', 'spool_low', 'warranty_ending', 'sync_pending', 'sync_success', 'sync_error')),
	CONSTRAINT "alerts_severity_ck" CHECK("__new_alerts"."severity" IN ('error', 'warning', 'success')),
	CONSTRAINT "alerts_module_ck" CHECK("__new_alerts"."module" IN ('filament', 'maintenance', 'printers', 'integrations'))
);
--> statement-breakpoint
-- ADR-0008: map the old kinds. Open alerts keep their state, so nothing is sent again.
-- `sync_failed` (before 0038) becomes a resolved `sync_error`; `print_failed` was never raised.
INSERT INTO `__new_alerts`("id", "kind", "severity", "module", "task", "entity_type", "entity_id", "context", "detail", "created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at", "resolved_at")
SELECT "id",
	CASE "kind" WHEN 'sync_failed' THEN 'sync_error' ELSE "kind" END,
	CASE
		WHEN "kind" IN ('sync_error', 'sync_failed') THEN 'error'
		WHEN "kind" = 'maintenance_due' AND json_extract("context", '$.overdue') = 1 THEN 'error'
		WHEN "kind" = 'sync_success' THEN 'success'
		ELSE 'warning'
	END,
	CASE "kind"
		WHEN 'spool_low' THEN 'filament'
		WHEN 'maintenance_due' THEN 'maintenance'
		WHEN 'warranty_ending' THEN 'printers'
		ELSE 'integrations'
	END,
	CASE
		WHEN "kind" IN ('sync_success', 'sync_error') THEN 'sync:' || json_extract("context", '$.integrationId') || ':' || json_extract("context", '$.type')
		WHEN "kind" IN ('sync_pending', 'sync_failed') THEN 'sync:' || "entity_id"
		WHEN "kind" = 'warranty_ending' THEN 'printer:' || "entity_id"
		ELSE "entity_type" || ':' || "entity_id"
	END,
	"entity_type", "entity_id", json_remove("context", '$.overdue'), NULL,
	"created_at", "read_at", "notified_at", "snoozed_until", "dismissed_at",
	CASE WHEN "kind" = 'sync_failed' THEN coalesce("resolved_at", strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ELSE "resolved_at" END
FROM `alerts` WHERE "kind" <> 'print_failed';--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_open_uq` ON `alerts` (`kind`,`entity_type`,`entity_id`) WHERE "alerts"."resolved_at" IS NULL;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `log` text DEFAULT '[]' NOT NULL;
