CREATE TABLE `device_projects` (
	`device_id` text NOT NULL,
	`project_id` text NOT NULL,
	PRIMARY KEY(`device_id`, `project_id`),
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Added in place, not rebuilt: dropping `devices` would cascade to its queued `hub_events`.
ALTER TABLE `devices` ADD `sync_mode` text DEFAULT 'all' NOT NULL CONSTRAINT "devices_sync_mode_ck" CHECK("sync_mode" IN ('all', 'selected'));--> statement-breakpoint
ALTER TABLE `devices` ADD `slicers` text DEFAULT '[]' NOT NULL;