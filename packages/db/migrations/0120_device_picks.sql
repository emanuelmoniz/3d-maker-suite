-- ADR-0021: picks replace `devices.sync_mode` and `device_projects`. `all` becomes a pick per hub
-- root, `selected` a pick per selected hub project; each for the device's user at edit.
-- `sync_mode` sits in a table CHECK, so `devices` is rebuilt. The migrator runs in one transaction,
-- where `foreign_keys=OFF` is a no-op, so dropping `devices` would cascade to hub_events, locks and
-- the rest. As in 0087, the old rows get other ids first, so the drop matches no child row; the
-- deferred check passes once the new `devices` holds the real ids again.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__keep_devices` AS SELECT * FROM `devices`;--> statement-breakpoint
UPDATE `devices` SET `id` = '~' || `id`;--> statement-breakpoint
CREATE TABLE `__new_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`os` text,
	`connector_version` text,
	`update_failed` text,
	`sync_state` text,
	`slicers` text DEFAULT '[]' NOT NULL,
	`slice_worker` integer DEFAULT false NOT NULL,
	`preset_libraries` text DEFAULT '{}' NOT NULL,
	`preset_install` text,
	`catalog_install` text,
	`preset_accounts` text DEFAULT '{}' NOT NULL,
	`system` text,
	`receive_projects` integer DEFAULT true NOT NULL,
	`share_projects` integer DEFAULT true NOT NULL,
	`shared_folders` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `devices`;--> statement-breakpoint
ALTER TABLE `__new_devices` RENAME TO `devices`;--> statement-breakpoint
INSERT INTO `devices`("id", "name", "user_id", "token_hash", "os", "connector_version", "update_failed", "sync_state", "slicers", "slice_worker", "preset_libraries", "preset_install", "catalog_install", "preset_accounts", "system", "receive_projects", "share_projects", "shared_folders", "last_seen_at", "created_at", "updated_at") SELECT "id", "name", "user_id", "token_hash", "os", "connector_version", "update_failed", "sync_state", "slicers", "slice_worker", "preset_libraries", "preset_install", "catalog_install", "preset_accounts", "system", "receive_projects", "share_projects", "shared_folders", "last_seen_at", "created_at", "updated_at" FROM `__keep_devices`;--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_uq` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `device_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`root_id` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`root_id`) REFERENCES `roots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_picks_uq` ON `device_picks` (`device_id`,`root_id`,`path`);--> statement-breakpoint
CREATE TABLE `device_pick_access` (
	`id` text PRIMARY KEY NOT NULL,
	`pick_id` text NOT NULL,
	`user_id` text,
	`role_id` text,
	`level` text NOT NULL,
	FOREIGN KEY (`pick_id`) REFERENCES `device_picks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_pick_access_one_ck" CHECK(("device_pick_access"."user_id" IS NULL) <> ("device_pick_access"."role_id" IS NULL)),
	CONSTRAINT "device_pick_access_level_ck" CHECK("device_pick_access"."level" IN ('read', 'edit'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_pick_access_user_uq` ON `device_pick_access` (`pick_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_pick_access_role_uq` ON `device_pick_access` (`pick_id`,`role_id`);--> statement-breakpoint
CREATE INDEX `device_pick_access_user_idx` ON `device_pick_access` (`user_id`);--> statement-breakpoint
CREATE INDEX `device_pick_access_role_idx` ON `device_pick_access` (`role_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `device_picks` (`id`, `device_id`, `root_id`, `path`, `paused`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
		|| substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	d.`id`, r.`id`, '', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `__keep_devices` d JOIN `roots` r ON r.`location` = 'hub'
WHERE d.`sync_mode` = 'all';--> statement-breakpoint
INSERT OR IGNORE INTO `device_picks` (`id`, `device_id`, `root_id`, `path`, `paused`, `created_at`, `updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
		|| substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	d.`id`, p.`root_id`, p.`folder`, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `__keep_devices` d
JOIN `device_projects` dp ON dp.`device_id` = d.`id`
JOIN `projects` p ON p.`id` = dp.`project_id`
JOIN `roots` r ON r.`id` = p.`root_id` AND r.`location` = 'hub'
WHERE d.`sync_mode` = 'selected' AND p.`folder` IS NOT NULL;--> statement-breakpoint
INSERT INTO `device_pick_access` (`id`, `pick_id`, `user_id`, `role_id`, `level`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-'
		|| substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	k.`id`, d.`user_id`, NULL, 'edit'
FROM `device_picks` k JOIN `devices` d ON d.`id` = k.`device_id`;--> statement-breakpoint
DROP TABLE `device_projects`;--> statement-breakpoint
DROP TABLE `__keep_devices`;
