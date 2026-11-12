-- ADR-0021 amended: a pick has a level for the machine's user instead of a list of users and roles
-- (a machine acts as one user, so the rest of a list never counted). The level is what the list
-- gave the device's user, directly or through their role (Edit wins); a pick that didn't list them
-- didn't sync, so it stays that way, paused at Read. Nothing references `device_picks` once the
-- lists are gone, so the rebuild cascades nowhere.
CREATE TABLE `__new_device_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`root_id` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'edit' NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`root_id`) REFERENCES `roots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "device_picks_level_ck" CHECK("level" IN ('read', 'edit'))
);
--> statement-breakpoint
INSERT INTO `__new_device_picks`("id", "device_id", "root_id", "path", "level", "paused", "created_at", "updated_at")
SELECT p.`id`, p.`device_id`, p.`root_id`, p.`path`, coalesce(m.`level`, 'read'),
	CASE WHEN m.`level` IS NULL THEN 1 ELSE p.`paused` END, p.`created_at`, p.`updated_at`
FROM `device_picks` p
LEFT JOIN (
	SELECT a.`pick_id`, CASE WHEN max(a.`level` = 'edit') THEN 'edit' ELSE 'read' END AS `level`
	FROM `device_pick_access` a
	JOIN `device_picks` k ON k.`id` = a.`pick_id`
	JOIN `devices` d ON d.`id` = k.`device_id`
	JOIN `users` u ON u.`id` = d.`user_id`
	WHERE a.`user_id` = d.`user_id` OR a.`role_id` = u.`role_id`
	GROUP BY a.`pick_id`
) m ON m.`pick_id` = p.`id`;--> statement-breakpoint
DROP TABLE `device_pick_access`;--> statement-breakpoint
DROP TABLE `device_picks`;--> statement-breakpoint
ALTER TABLE `__new_device_picks` RENAME TO `device_picks`;--> statement-breakpoint
CREATE UNIQUE INDEX `device_picks_uq` ON `device_picks` (`device_id`,`root_id`,`path`);
