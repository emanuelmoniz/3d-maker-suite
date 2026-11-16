CREATE TABLE `spool_usage_links` (
	`integration_id` text NOT NULL,
	`app_spool_id` text NOT NULL,
	`vendor_spool_id` text NOT NULL,
	PRIMARY KEY(`integration_id`, `app_spool_id`),
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `spool_usage_pushes` (
	`integration_id` text NOT NULL,
	`key` text NOT NULL,
	`vendor_spool_id` text NOT NULL,
	`app_spool_id` text NOT NULL,
	`sent_grams` real NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`integration_id`, `key`, `vendor_spool_id`),
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `spool_usage_pushes_app_spool_idx` ON `spool_usage_pushes` (`integration_id`,`app_spool_id`);--> statement-breakpoint
ALTER TABLE `print_filament_usages` ADD `source_spool` text;--> statement-breakpoint
ALTER TABLE `print_filament_usages` ADD `charged_at_source` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `spools` ADD `source_linked_at` text;