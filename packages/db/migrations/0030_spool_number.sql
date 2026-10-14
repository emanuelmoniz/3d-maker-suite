ALTER TABLE `spools` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `color_name` text;--> statement-breakpoint
-- Backfill (hand-written): every spool, archived ones too, numbered 1..n by creation date.
UPDATE `spools` SET `number` = (
	SELECT r.`n` FROM (SELECT `id`, row_number() OVER (ORDER BY `created_at`, `rowid`) AS `n` FROM `spools`) r
	WHERE r.`id` = `spools`.`id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `spools_number_uq` ON `spools` (`number`);
