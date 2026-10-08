PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`context` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`notified_at` text,
	`snoozed_until` text,
	`dismissed_at` text,
	`resolved_at` text,
	CONSTRAINT "alerts_kind_ck" CHECK("__new_alerts"."kind" IN ('maintenance_due', 'spool_low', 'sync_failed', 'print_failed', 'warranty_ending'))
);
--> statement-breakpoint
INSERT INTO `__new_alerts`("id", "kind", "entity_type", "entity_id", "created_at", "read_at", "resolved_at") SELECT "id", "kind", "entity_type", "entity_id", "created_at", "read_at", "resolved_at" FROM `alerts`;--> statement-breakpoint
DROP TABLE `alerts`;--> statement-breakpoint
ALTER TABLE `__new_alerts` RENAME TO `alerts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_open_uq` ON `alerts` (`kind`,`entity_type`,`entity_id`) WHERE "alerts"."resolved_at" IS NULL;