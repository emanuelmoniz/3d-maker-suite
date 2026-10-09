ALTER TABLE `integrations` ADD `sync_frequency` text DEFAULT '15m' NOT NULL;--> statement-breakpoint
ALTER TABLE `integrations` ADD `last_prints_sync_at` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `type` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `range_from` text;--> statement-breakpoint
ALTER TABLE `sync_runs` ADD `range_to` text;--> statement-breakpoint
UPDATE `integrations` SET `last_prints_sync_at` = `last_sync_at`;
