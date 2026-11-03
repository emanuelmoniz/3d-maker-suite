ALTER TABLE `brands` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `filament_brands` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `filament_materials` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `printer_models` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `prints` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `archived_at` text;