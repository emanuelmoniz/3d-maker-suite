ALTER TABLE `alerts` ADD `updated_at` text;
--> statement-breakpoint
UPDATE `alerts` SET `updated_at` = COALESCE(`resolved_at`, `dismissed_at`, `read_at`, `created_at`);
