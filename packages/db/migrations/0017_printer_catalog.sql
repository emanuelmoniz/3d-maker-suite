CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text,
	`logo_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_name_uq` ON `brands` ("name" COLLATE NOCASE);--> statement-breakpoint
CREATE TABLE `machine_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`printer_model_id` text NOT NULL,
	`nozzle_diameter_mm` real DEFAULT 0.4 NOT NULL,
	`source_preset` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printer_model_id`) REFERENCES `printer_models`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `machine_profiles_model_idx` ON `machine_profiles` (`printer_model_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `machine_profiles_source_uq` ON `machine_profiles` (`source_preset`);--> statement-breakpoint
CREATE TABLE `printer_models` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`model` text NOT NULL,
	`power_w` integer,
	`image_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printer_models_name_uq` ON `printer_models` (`brand_id`,"model" COLLATE NOCASE);--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `applies_to_model_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `printers` ADD `model_id` text REFERENCES printer_models(id) ON DELETE restrict;--> statement-breakpoint
ALTER TABLE `prints` ADD `machine_profile_id` text REFERENCES machine_profiles(id) ON DELETE restrict;--> statement-breakpoint
-- Backfill (hand-written). Free-text brand/model -> catalog rows, matched trimmed and case-insensitive;
-- empty values become "Unknown". Ids are random v4 UUIDs. 0018 then drops the old columns.
INSERT INTO `brands` (`id`, `name`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	min(coalesce(nullif(trim(`brand`), ''), 'Unknown')), min(`created_at`), min(`created_at`)
FROM `printers`
GROUP BY lower(coalesce(nullif(trim(`brand`), ''), 'Unknown'));--> statement-breakpoint
INSERT INTO `printer_models` (`id`, `brand_id`, `model`, `power_w`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
	b.`id`, min(coalesce(nullif(trim(p.`model`), ''), 'Unknown')), max(p.`power_w`), min(p.`created_at`), min(p.`created_at`)
FROM `printers` p
JOIN `brands` b ON b.`name` = coalesce(nullif(trim(p.`brand`), ''), 'Unknown') COLLATE NOCASE
GROUP BY b.`id`, lower(coalesce(nullif(trim(p.`model`), ''), 'Unknown'));--> statement-breakpoint
UPDATE `printers` SET `model_id` = (
	SELECT m.`id` FROM `printer_models` m JOIN `brands` b ON b.`id` = m.`brand_id`
	WHERE b.`name` = coalesce(nullif(trim(`printers`.`brand`), ''), 'Unknown') COLLATE NOCASE
		AND m.`model` = coalesce(nullif(trim(`printers`.`model`), ''), 'Unknown') COLLATE NOCASE
);--> statement-breakpoint
-- Maintenance types: model names -> every catalog model with that name (any brand, as before).
UPDATE `maintenance_types` SET `applies_to_model_ids` = (
	SELECT json_group_array(DISTINCT m.`id`)
	FROM json_each(`maintenance_types`.`applies_to_models`) j
	JOIN `printer_models` m ON m.`model` = trim(j.`value`) COLLATE NOCASE
);