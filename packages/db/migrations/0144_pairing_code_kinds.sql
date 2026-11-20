ALTER TABLE `devices` ADD `install` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text,
	`kind` text DEFAULT 'desktop' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pairing_codes_kind_ck" CHECK("__new_pairing_codes"."kind" IN ('desktop', 'headless'))
);
--> statement-breakpoint
-- Hand-written: the old id was the code's sha256. Each code gets a v4 uuid, made by SQLite.
INSERT INTO `__new_pairing_codes`("id", "code_hash", "user_id", "device_id", "kind", "expires_at", "created_at") SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), "id", "user_id", "device_id", 'desktop', "expires_at", strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `pairing_codes`;--> statement-breakpoint
DROP TABLE `pairing_codes`;--> statement-breakpoint
ALTER TABLE `__new_pairing_codes` RENAME TO `pairing_codes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_codes_hash_uq` ON `pairing_codes` (`code_hash`);