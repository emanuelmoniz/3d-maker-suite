-- Colour belongs to the spool, not the profile: a profile is only settings.
ALTER TABLE `spools` ADD `color_hex` text DEFAULT '#808080' NOT NULL;--> statement-breakpoint
UPDATE `spools` SET `color_hex` = (SELECT lower(`p`.`color_hex`) FROM `filament_profiles` `p` WHERE `p`.`id` = `spools`.`profile_id`);--> statement-breakpoint
-- Profiles that only differed by colour are now the same: keep one per brand + material + name
-- (linked to a preset first, then active, then oldest) and repoint everything to it.
UPDATE `spools` SET `profile_id` = (
  SELECT `k`.`id` FROM `filament_profiles` `p` JOIN `filament_profiles` `k`
    ON lower(trim(`k`.`brand`)) = lower(trim(`p`.`brand`))
    AND lower(trim(`k`.`material`)) = lower(trim(`p`.`material`))
    AND lower(trim(`k`.`name`)) = lower(trim(`p`.`name`))
  WHERE `p`.`id` = `spools`.`profile_id`
  ORDER BY `k`.`source_preset` IS NULL, `k`.`archived_at` IS NOT NULL, `k`.`created_at`, `k`.`id` LIMIT 1
);--> statement-breakpoint
UPDATE `print_filament_usages` SET `profile_id` = (
  SELECT `k`.`id` FROM `filament_profiles` `p` JOIN `filament_profiles` `k`
    ON lower(trim(`k`.`brand`)) = lower(trim(`p`.`brand`))
    AND lower(trim(`k`.`material`)) = lower(trim(`p`.`material`))
    AND lower(trim(`k`.`name`)) = lower(trim(`p`.`name`))
  WHERE `p`.`id` = `print_filament_usages`.`profile_id`
  ORDER BY `k`.`source_preset` IS NULL, `k`.`archived_at` IS NOT NULL, `k`.`created_at`, `k`.`id` LIMIT 1
) WHERE `profile_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `filament_profiles` WHERE `id` NOT IN (
  SELECT (
    SELECT `k`.`id` FROM `filament_profiles` `k`
    WHERE lower(trim(`k`.`brand`)) = lower(trim(`p`.`brand`))
      AND lower(trim(`k`.`material`)) = lower(trim(`p`.`material`))
      AND lower(trim(`k`.`name`)) = lower(trim(`p`.`name`))
    ORDER BY `k`.`source_preset` IS NULL, `k`.`archived_at` IS NOT NULL, `k`.`created_at`, `k`.`id` LIMIT 1
  ) FROM `filament_profiles` `p`
);--> statement-breakpoint
ALTER TABLE `filament_profiles` DROP COLUMN `color_hex`;
