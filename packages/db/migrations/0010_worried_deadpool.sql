ALTER TABLE `projects` ADD `description` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `folder_path` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `edited_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_folder_uq` ON `projects` (`folder_path`);