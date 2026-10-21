ALTER TABLE `projects` ADD `gallery` text DEFAULT '{"folders":[],"images":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `cover_file` text;
