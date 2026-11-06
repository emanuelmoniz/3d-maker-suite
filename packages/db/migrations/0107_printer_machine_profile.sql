ALTER TABLE `machine_profiles` ADD `default_print_preset` text;--> statement-breakpoint
ALTER TABLE `print_profiles` ADD `machine_presets` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `printers` ADD `machine_profile_id` text REFERENCES machine_profiles(id) ON DELETE set null;--> statement-breakpoint
-- Each printer takes its machine profile by model and nozzle, as `machineProfileFor`: a system preset
-- first (only those slice, ADR-0007), then by name. The two new preset columns fill on the next catalog read.
UPDATE `printers` SET `machine_profile_id` = (
  SELECT m.`id` FROM `machine_profiles` m
  WHERE m.`printer_model_id` = `printers`.`model_id`
    AND m.`nozzle_diameter_mm` = `printers`.`nozzle_diameter_mm`
    AND m.`archived_at` IS NULL
  ORDER BY m.`source_preset` LIKE '%:system/%' DESC, m.`name`, m.`created_at`
  LIMIT 1
);
