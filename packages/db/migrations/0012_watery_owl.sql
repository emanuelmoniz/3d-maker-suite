ALTER TABLE `spools` ADD `source_spool` text;--> statement-breakpoint
CREATE UNIQUE INDEX `spools_source_uq` ON `spools` (`source_spool`);