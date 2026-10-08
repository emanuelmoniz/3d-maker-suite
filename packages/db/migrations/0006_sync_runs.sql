CREATE TABLE `sync_runs` (
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
	CONSTRAINT "sync_runs_trigger_ck" CHECK("sync_runs"."trigger" IN ('manual', 'scheduled')),
	CONSTRAINT "sync_runs_status_ck" CHECK("sync_runs"."status" IN ('ok', 'error')),
	CONSTRAINT "sync_runs_error_code_ck" CHECK("sync_runs"."error_code" IN ('auth_required', 'auth_expired', 'rate_limited', 'unreachable', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `sync_runs_integration_idx` ON `sync_runs` (`integration_id`,`started_at`);