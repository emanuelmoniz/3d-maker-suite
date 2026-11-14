ALTER TABLE `devices` ADD `use_as_worker` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `receive_catalog` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `share_catalog` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- A machine that is a slice worker already keeps it.
UPDATE `devices` SET `use_as_worker` = 1 WHERE `slice_worker` = 1;
