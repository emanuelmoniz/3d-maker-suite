-- Added in place, not rebuilt; drizzle-kit leaves out the ON DELETE of an added column.
ALTER TABLE `hub_files` ADD `lock_device_id` text REFERENCES devices(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `hub_files` ADD `locked_at` text;--> statement-breakpoint
ALTER TABLE `hub_files` ADD `lock_touched_at` text;
