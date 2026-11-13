CREATE TABLE `usage_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`printer_id` text,
	`accessory_id` text,
	`delta_sec` integer NOT NULL,
	`delta_prints` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`printer_id`) REFERENCES `printers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accessory_id`) REFERENCES `accessories`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "usage_corrections_target_ck" CHECK(("usage_corrections"."printer_id" IS NULL) <> ("usage_corrections"."accessory_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `usage_corrections_printer_idx` ON `usage_corrections` (`printer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `usage_corrections_accessory_idx` ON `usage_corrections` (`accessory_id`,`created_at`);--> statement-breakpoint
-- A printer's offsets become its starting correction, dated from its purchase (else when it was
-- added), so every usage snapshot from then on counts them as before.
INSERT INTO `usage_corrections` (`id`, `printer_id`, `delta_sec`, `delta_prints`, `note`, `created_at`)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  `id`, `runtime_offset_sec`, `prints_offset`, NULL,
  CASE WHEN `purchased_at` IS NOT NULL AND `purchased_at` < `created_at` THEN `purchased_at` ELSE `created_at` END
FROM `printers` WHERE `runtime_offset_sec` <> 0 OR `prints_offset` <> 0;--> statement-breakpoint
ALTER TABLE `printers` DROP COLUMN `runtime_offset_sec`;--> statement-breakpoint
ALTER TABLE `printers` DROP COLUMN `prints_offset`;