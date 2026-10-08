CREATE TABLE `printer_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text NOT NULL,
	`body` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "printer_comments_status_ck" CHECK("printer_comments"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX `printer_comments_printer_idx` ON `printer_comments` (`printer_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `printers` ADD `purchased_at` text;--> statement-breakpoint
ALTER TABLE `printers` ADD `purchase_price` integer;--> statement-breakpoint
ALTER TABLE `printers` ADD `warranty_ends_at` text;--> statement-breakpoint
ALTER TABLE `printers` ADD `warranty_notes` text;--> statement-breakpoint
ALTER TABLE `printers` ADD `state` text DEFAULT 'working' NOT NULL;--> statement-breakpoint
ALTER TABLE `printers` ADD `power_w` integer;--> statement-breakpoint
ALTER TABLE `printers` ADD `photo_path` text;