CREATE TABLE `printer_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `printer_sources_external_uq` ON `printer_sources` (`integration_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `printer_sources_printer_idx` ON `printer_sources` (`printer_id`);--> statement-breakpoint
ALTER TABLE `print_filament_usages` ADD `rfid` text;--> statement-breakpoint
ALTER TABLE `prints` ADD `peer_id` text;--> statement-breakpoint
ALTER TABLE `spools` ADD `rfid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spools_rfid_uq` ON `spools` (`rfid`);