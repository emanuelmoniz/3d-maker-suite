ALTER TABLE `maintenance_types` ADD `applies_to_models` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_types` ADD `applies_to_printer_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `maintenance_types` SET `applies_to_models` = json_array(trim(`applies_to_model`)) WHERE trim(coalesce(`applies_to_model`, '')) <> '';--> statement-breakpoint
ALTER TABLE `maintenance_types` DROP COLUMN `applies_to_model`;
