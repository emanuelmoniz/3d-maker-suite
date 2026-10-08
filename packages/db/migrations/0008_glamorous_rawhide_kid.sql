ALTER TABLE `print_filament_usages` ADD `material` text;--> statement-breakpoint
ALTER TABLE `print_filament_usages` ADD `color_hex` text;--> statement-breakpoint
ALTER TABLE `print_filament_usages` ADD `dismissed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `prints` ADD `cover_url` text;--> statement-breakpoint
ALTER TABLE `prints` ADD `source_url` text;