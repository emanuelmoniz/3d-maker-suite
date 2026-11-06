-- ADR-0020: a spool describes its filament (brand, material, name) instead of pointing at a
-- profile; a material has the default price per kg; profiles lose their price and cloud columns.
-- The migrator runs in one transaction, where `foreign_keys=OFF` is ignored, so checks wait for
-- the commit and spools go back into `spools` itself, as in 0067.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `filament_materials` ADD `price_per_kg` integer;--> statement-breakpoint
UPDATE `filament_materials` SET `price_per_kg` = (
	SELECT CAST(round(avg(`p`.`price_per_kg`)) AS INTEGER) FROM `filament_profiles` AS `p`
	WHERE `p`.`material_id` = `filament_materials`.`id` AND `p`.`price_per_kg` IS NOT NULL);--> statement-breakpoint
-- Filament with no spool is priced by its material: the profile's, where it had one.
UPDATE `print_filament_usages` SET `material` = coalesce((
	SELECT `m`.`name` FROM `filament_profiles` AS `p` JOIN `filament_materials` AS `m` ON `m`.`id` = `p`.`material_id`
	WHERE `p`.`id` = `print_filament_usages`.`profile_id`), `material`)
WHERE `spool_id` IS NULL AND `profile_id` IS NOT NULL;--> statement-breakpoint
-- The name loses a leading brand name, or the brand's first word ("Bambu PLA Basic" of Bambu Lab
-- is "PLA Basic"); one that is only the material is no name. A spool with no price paid gets
-- what its profile's price made it cost, so its cost stays the same.
CREATE TABLE `__old_spools` AS
SELECT `s`.*, `p`.`brand_id` AS `new_brand_id`, `p`.`material_id` AS `new_material_id`,
	CASE WHEN lower(`n`.`name`) = lower(`m`.`name`) THEN NULL ELSE nullif(`n`.`name`, '') END AS `new_name`,
	coalesce(`s`.`price_paid`, CASE WHEN `s`.`initial_grams` > 0
		THEN CAST(round(`p`.`price_per_kg` * `s`.`initial_grams` / 1000.0) AS INTEGER) END) AS `new_price_paid`
FROM `spools` AS `s`
JOIN `filament_profiles` AS `p` ON `p`.`id` = `s`.`profile_id`
LEFT JOIN `filament_materials` AS `m` ON `m`.`id` = `p`.`material_id`
JOIN (
	SELECT `p`.`id`, trim(CASE
		WHEN lower(substr(`p`.`name`, 1, length(`b`.`name`) + 1)) = lower(`b`.`name`) || ' '
			THEN substr(`p`.`name`, length(`b`.`name`) + 2)
		WHEN instr(`b`.`name`, ' ') > 1
			AND lower(substr(`p`.`name`, 1, instr(`b`.`name`, ' '))) = lower(substr(`b`.`name`, 1, instr(`b`.`name`, ' ')))
			THEN substr(`p`.`name`, instr(`b`.`name`, ' ') + 1)
		ELSE `p`.`name` END) AS `name`
	FROM `filament_profiles` AS `p` LEFT JOIN `filament_brands` AS `b` ON `b`.`id` = `p`.`brand_id`
) AS `n` ON `n`.`id` = `p`.`id`;--> statement-breakpoint
DROP TABLE `spools`;--> statement-breakpoint
CREATE TABLE `spools` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`material_id` text NOT NULL,
	`name` text,
	`number` integer,
	`color_hex` text DEFAULT '#808080' NOT NULL,
	`color_name` text,
	`initial_grams` real,
	`remaining_grams` real,
	`empty_weight_grams` real,
	`status` text DEFAULT 'new' NOT NULL,
	`price_paid` integer,
	`purchased_at` text,
	`opened_at` text,
	`location` text,
	`source_spool` text,
	`low_grams` real,
	`low_alert` integer,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `filament_brands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`material_id`) REFERENCES `filament_materials`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "spools_status_ck" CHECK("spools"."status" IN ('new', 'in_use', 'empty'))
);
--> statement-breakpoint
INSERT INTO `spools`("id", "brand_id", "material_id", "name", "number", "color_hex", "color_name", "initial_grams", "remaining_grams", "empty_weight_grams", "status", "price_paid", "purchased_at", "opened_at", "location", "source_spool", "low_grams", "low_alert", "archived_at", "created_at", "updated_at") SELECT "id", "new_brand_id", "new_material_id", "new_name", "number", "color_hex", "color_name", "initial_grams", "remaining_grams", "empty_weight_grams", "status", "new_price_paid", "purchased_at", "opened_at", "location", "source_spool", "low_grams", "low_alert", "archived_at", "created_at", "updated_at" FROM `__old_spools`;--> statement-breakpoint
DROP TABLE `__old_spools`;--> statement-breakpoint
CREATE INDEX `spools_brand_idx` ON `spools` (`brand_id`);--> statement-breakpoint
CREATE INDEX `spools_material_idx` ON `spools` (`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `spools_source_uq` ON `spools` (`source_spool`);--> statement-breakpoint
CREATE UNIQUE INDEX `spools_number_uq` ON `spools` (`number`);--> statement-breakpoint
CREATE TABLE `__new_print_filament_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`print_id` text NOT NULL,
	`spool_id` text,
	`grams` real NOT NULL,
	`slot` integer,
	`material` text,
	`color_hex` text,
	`dismissed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`print_id`) REFERENCES `prints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spool_id`) REFERENCES `spools`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_print_filament_usages`("id", "print_id", "spool_id", "grams", "slot", "material", "color_hex", "dismissed") SELECT "id", "print_id", "spool_id", "grams", "slot", "material", "color_hex", "dismissed" FROM `print_filament_usages`;--> statement-breakpoint
DROP TABLE `print_filament_usages`;--> statement-breakpoint
ALTER TABLE `__new_print_filament_usages` RENAME TO `print_filament_usages`;--> statement-breakpoint
CREATE INDEX `print_filament_usages_print_idx` ON `print_filament_usages` (`print_id`);--> statement-breakpoint
CREATE INDEX `print_filament_usages_spool_idx` ON `print_filament_usages` (`spool_id`);--> statement-breakpoint
-- Nothing points at a profile by a foreign key any more, so it is rebuilt like any other table.
CREATE TABLE `__new_filament_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text,
	`material_id` text,
	`name` text NOT NULL,
	`diameter_mm` real DEFAULT 1.75 NOT NULL,
	`density_gcm3` real NOT NULL,
	`nozzle_temp_c` integer,
	`bed_temp_c` integer,
	`source_preset` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `filament_brands`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`material_id`) REFERENCES `filament_materials`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_filament_profiles`("id", "brand_id", "material_id", "name", "diameter_mm", "density_gcm3", "nozzle_temp_c", "bed_temp_c", "source_preset", "archived_at", "created_at", "updated_at") SELECT "id", "brand_id", "material_id", "name", "diameter_mm", "density_gcm3", "nozzle_temp_c", "bed_temp_c", "source_preset", "archived_at", "created_at", "updated_at" FROM `filament_profiles`;--> statement-breakpoint
DROP TABLE `filament_profiles`;--> statement-breakpoint
ALTER TABLE `__new_filament_profiles` RENAME TO `filament_profiles`;--> statement-breakpoint
CREATE INDEX `filament_profiles_brand_idx` ON `filament_profiles` (`brand_id`);--> statement-breakpoint
CREATE INDEX `filament_profiles_material_idx` ON `filament_profiles` (`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `filament_profiles_source_uq` ON `filament_profiles` (`source_preset`) WHERE "filament_profiles"."archived_at" IS NULL;
