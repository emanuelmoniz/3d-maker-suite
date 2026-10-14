ALTER TABLE `prints` ADD `number` integer;--> statement-breakpoint
-- Backfill (hand-written): every print numbered 1..n by when it started.
UPDATE `prints` SET `number` = (
	SELECT r.`n` FROM (SELECT `id`, row_number() OVER (ORDER BY `started_at`, `rowid`) AS `n` FROM `prints`) r
	WHERE r.`id` = `prints`.`id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `prints_number_uq` ON `prints` (`number`);
