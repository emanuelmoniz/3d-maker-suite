ALTER TABLE `spools` ADD `loaded_printer_id` text REFERENCES printers(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `spools` ADD `loaded_slot` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `loaded_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spools_loaded_uq` ON `spools` (`loaded_printer_id`,`loaded_slot`);