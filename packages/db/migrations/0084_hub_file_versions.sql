CREATE TABLE `hub_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`version` integer NOT NULL,
	`size` integer NOT NULL,
	`user` text,
	`device` text,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `hub_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_file_versions_file_version_uq` ON `hub_file_versions` (`file_id`,`version`);--> statement-breakpoint
ALTER TABLE `hub_files` ADD `saved_user` text;--> statement-breakpoint
ALTER TABLE `hub_files` ADD `saved_device` text;--> statement-breakpoint
ALTER TABLE `hub_files` ADD `saved_at` text;