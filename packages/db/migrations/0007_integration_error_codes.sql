PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`integration_id` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`created` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_runs_trigger_ck" CHECK("__new_sync_runs"."trigger" IN ('manual', 'scheduled')),
	CONSTRAINT "sync_runs_status_ck" CHECK("__new_sync_runs"."status" IN ('ok', 'error')),
	CONSTRAINT "sync_runs_error_code_ck" CHECK("__new_sync_runs"."error_code" IN ('auth_required', 'auth_expired', 'rate_limited', 'unreachable', 'login_failed', 'code_invalid', 'blocked', 'api_changed', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_sync_runs`("id", "integration_id", "trigger", "started_at", "finished_at", "status", "error_code", "created", "skipped") SELECT "id", "integration_id", "trigger", "started_at", "finished_at", "status", "error_code", "created", "skipped" FROM `sync_runs`;--> statement-breakpoint
DROP TABLE `sync_runs`;--> statement-breakpoint
ALTER TABLE `__new_sync_runs` RENAME TO `sync_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `sync_runs_integration_idx` ON `sync_runs` (`integration_id`,`started_at`);