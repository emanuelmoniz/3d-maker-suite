ALTER TABLE `quotes` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `quotes` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `quotes` ADD `client_id` text REFERENCES clients(id) ON DELETE set null;--> statement-breakpoint
-- Backfill (hand-written): existing quotes numbered 1..n by creation date, like 0031.
UPDATE `quotes` SET `number` = (
	SELECT r.`n` FROM (SELECT `id`, row_number() OVER (ORDER BY `created_at`, `rowid`) AS `n` FROM `quotes`) r
	WHERE r.`id` = `quotes`.`id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_number_uq` ON `quotes` (`number`);--> statement-breakpoint
CREATE INDEX `quotes_client_idx` ON `quotes` (`client_id`);
