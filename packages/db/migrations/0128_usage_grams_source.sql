ALTER TABLE `print_filament_usages` ADD `grams_source` text;--> statement-breakpoint
ALTER TABLE `print_filament_usages` ADD `grams_estimated` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `print_filament_usages` SET `grams_source` = 'printer' WHERE `print_id` IN (SELECT `id` FROM `prints` WHERE `origin` = 'integration');
