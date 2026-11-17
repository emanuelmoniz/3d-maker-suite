CREATE TABLE `spool_sources` (
	`spool_id` text NOT NULL,
	`library` text NOT NULL,
	`source` text NOT NULL,
	`linked_at` text,
	`unlinked_at` text,
	PRIMARY KEY(`spool_id`, `library`),
	FOREIGN KEY (`spool_id`) REFERENCES `spools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `spool_sources_source_uq` ON `spool_sources` (`source`) WHERE "spool_sources"."unlinked_at" IS NULL;--> statement-breakpoint
-- A spool's one link becomes its link to that library (the key's part before its first `:`).
INSERT INTO `spool_sources` (`spool_id`, `library`, `source`, `linked_at`)
SELECT `id`, substr(`source_spool`, 1, instr(`source_spool`, ':') - 1), `source_spool`, `source_linked_at`
FROM `spools` WHERE `source_spool` IS NOT NULL AND instr(`source_spool`, ':') > 1;--> statement-breakpoint
DROP INDEX `spools_source_uq`;--> statement-breakpoint
ALTER TABLE `spools` DROP COLUMN `source_spool`;--> statement-breakpoint
ALTER TABLE `spools` DROP COLUMN `source_linked_at`;