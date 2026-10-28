CREATE TABLE `root_editors` (
	`root_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`root_id`, `user_id`),
	FOREIGN KEY (`root_id`) REFERENCES `roots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `owner_id` text REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_id`);--> statement-breakpoint
ALTER TABLE `roots` ADD `edit_by` text DEFAULT 'roles' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `projects_see_all` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `projects_edit_others` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `edit_other_devices` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Admins keep editing every device's files; editors get it from an admin.
UPDATE `users` SET `edit_other_devices` = 1 WHERE `role` = 'admin';--> statement-breakpoint
-- Existing projects: a device root's user, else the oldest enabled admin (nobody without users).
UPDATE `projects` SET `owner_id` = coalesce(
	(SELECT d.`user_id` FROM `roots` r JOIN `devices` d ON d.`id` = r.`location` WHERE r.`id` = `projects`.`root_id`),
	(SELECT `id` FROM `users` WHERE `role` = 'admin' AND `disabled` = 0 ORDER BY `created_at`, `id` LIMIT 1)
);
