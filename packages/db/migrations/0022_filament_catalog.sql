CREATE TABLE `filament_brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`logo_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filament_brands_name_uq` ON `filament_brands` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `filament_materials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`nozzle_temp_c` integer,
	`bed_temp_c` integer,
	`density_gcm3` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filament_materials_name_uq` ON `filament_materials` ("name" COLLATE NOCASE);--> statement-breakpoint
ALTER TABLE `filament_profiles` ADD `brand_id` text REFERENCES filament_brands(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `filament_profiles` ADD `material_id` text REFERENCES filament_materials(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `filament_profiles_brand_idx` ON `filament_profiles` (`brand_id`);--> statement-breakpoint
CREATE INDEX `filament_profiles_material_idx` ON `filament_profiles` (`material_id`);--> statement-breakpoint
-- Backfill (hand-written). Free-text brand/material -> catalog rows, matched trimmed and case-insensitive.
-- An empty brand stays null (it was optional); an empty material becomes "Unknown". Ids are random v4 UUIDs.
-- 0023 then drops the old columns.
INSERT INTO `filament_brands` (`id`, `name`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	min(trim(`brand`)), min(`created_at`), min(`created_at`)
FROM `filament_profiles`
WHERE trim(`brand`) <> ''
GROUP BY lower(trim(`brand`));--> statement-breakpoint
INSERT INTO `filament_materials` (`id`, `name`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	min(coalesce(nullif(trim(`material`), ''), 'Unknown')), min(`created_at`), min(`created_at`)
FROM `filament_profiles`
GROUP BY lower(coalesce(nullif(trim(`material`), ''), 'Unknown'));--> statement-breakpoint
UPDATE `filament_profiles` SET
	`brand_id` = (SELECT b.`id` FROM `filament_brands` b WHERE b.`name` = trim(`filament_profiles`.`brand`) COLLATE NOCASE),
	`material_id` = (SELECT m.`id` FROM `filament_materials` m
		WHERE m.`name` = coalesce(nullif(trim(`filament_profiles`.`material`), ''), 'Unknown') COLLATE NOCASE);
