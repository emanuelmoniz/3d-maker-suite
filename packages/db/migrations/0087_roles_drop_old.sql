-- Rebuilds users without `role` and the ADR-0014 switches (0086 moved them to roles and overrides).
-- The migrator runs in one transaction, where `foreign_keys=OFF` is a no-op, so dropping `users`
-- would cascade to sessions, devices, root_editors and the rest. Instead the old rows get other ids
-- first, so the drop matches no child row; the deferred check passes once the new `users` holds the
-- real ids again (inserted after the rename, so SQLite counts the children as fixed).
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__keep_users` AS SELECT "id", "email", "display_name", "password_hash", "role_id", "disabled", "permissions", "project_rights", "last_login_at", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
UPDATE `users` SET `id` = '~' || `id`;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role_id` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`permissions` text DEFAULT '{}' NOT NULL,
	`project_rights` text DEFAULT '{}' NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
INSERT INTO `users`("id", "email", "display_name", "password_hash", "role_id", "disabled", "permissions", "project_rights", "last_login_at", "created_at", "updated_at") SELECT "id", "email", "display_name", "password_hash", "role_id", "disabled", "permissions", "project_rights", "last_login_at", "created_at", "updated_at" FROM `__keep_users`;--> statement-breakpoint
DROP TABLE `__keep_users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` ("email" COLLATE NOCASE);
