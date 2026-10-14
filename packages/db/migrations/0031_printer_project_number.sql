ALTER TABLE `printers` ADD `number` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `number` integer;--> statement-breakpoint
-- Backfill (hand-written): every printer and project, archived ones too, numbered 1..n by creation date.
UPDATE `printers` SET `number` = (
	SELECT r.`n` FROM (SELECT `id`, row_number() OVER (ORDER BY `created_at`, `rowid`) AS `n` FROM `printers`) r
	WHERE r.`id` = `printers`.`id`
);--> statement-breakpoint
UPDATE `projects` SET `number` = (
	SELECT r.`n` FROM (SELECT `id`, row_number() OVER (ORDER BY `created_at`, `rowid`) AS `n` FROM `projects`) r
	WHERE r.`id` = `projects`.`id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `printers_number_uq` ON `printers` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_number_uq` ON `projects` (`number`);
