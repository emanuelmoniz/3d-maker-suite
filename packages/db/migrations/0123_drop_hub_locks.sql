-- Check-out locks are gone (5.6.0): their columns go, so every lock is cleared. Devices get each
-- file's access again on their next full pull, so files read-only only from a lock turn writable.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- As in 0080: dropping `hub_files` cascades to `hub_file_versions`, so the versions are kept aside.
CREATE TABLE `__keep_hub_file_versions` AS SELECT * FROM `hub_file_versions`;--> statement-breakpoint
CREATE TABLE `__new_hub_files` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` real NOT NULL,
	`sha256` text NOT NULL,
	`version` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`seq` integer NOT NULL,
	`saved_user` text,
	`saved_device` text,
	`saved_at` text,
	FOREIGN KEY (`root_id`) REFERENCES `roots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_hub_files`("id", "root_id", "path", "size", "mtime_ms", "sha256", "version", "deleted", "seq", "saved_user", "saved_device", "saved_at") SELECT "id", "root_id", "path", "size", "mtime_ms", "sha256", "version", "deleted", "seq", "saved_user", "saved_device", "saved_at" FROM `hub_files`;--> statement-breakpoint
DROP TABLE `hub_files`;--> statement-breakpoint
ALTER TABLE `__new_hub_files` RENAME TO `hub_files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `hub_files_root_path_uq` ON `hub_files` (`root_id`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `hub_files_seq_uq` ON `hub_files` (`seq`);--> statement-breakpoint
INSERT OR IGNORE INTO `hub_file_versions` SELECT * FROM `__keep_hub_file_versions`;--> statement-breakpoint
DROP TABLE `__keep_hub_file_versions`;--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('hubLocks', 'hubLockIdleMin');
