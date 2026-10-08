-- The prints trigger points at `taggings`, which blocks the table rebuild: drop it and recreate it.
DROP TRIGGER `prints_taggings_cleanup`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_taggings` (
	`tag_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`tag_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "taggings_entity_type_ck" CHECK("__new_taggings"."entity_type" IN ('project', 'print', 'spool', 'printer'))
);
--> statement-breakpoint
INSERT INTO `__new_taggings`("tag_id", "entity_type", "entity_id") SELECT "tag_id", "entity_type", "entity_id" FROM `taggings`;--> statement-breakpoint
DROP TABLE `taggings`;--> statement-breakpoint
ALTER TABLE `__new_taggings` RENAME TO `taggings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `taggings_entity_idx` ON `taggings` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TRIGGER `prints_taggings_cleanup` AFTER DELETE ON `prints` BEGIN
	DELETE FROM `taggings` WHERE `entity_type` = 'print' AND `entity_id` = OLD.`id`;
END;
