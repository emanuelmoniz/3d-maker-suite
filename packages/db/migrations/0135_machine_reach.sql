ALTER TABLE `devices` ADD `reach_printers` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `reach_spool_libraries` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Nothing in use stops: a machine that already reaches a source of a kind has that switch on
-- (Spoolman is the only spool library on the network; every other source reached this way is a printer).
UPDATE `devices` SET `reach_printers` = 1
WHERE EXISTS (SELECT 1 FROM `integrations` i WHERE i.`device_id` = `devices`.`id` AND i.`adapter_id` <> 'spoolman');--> statement-breakpoint
UPDATE `devices` SET `reach_spool_libraries` = 1
WHERE EXISTS (SELECT 1 FROM `integrations` i WHERE i.`device_id` = `devices`.`id` AND i.`adapter_id` = 'spoolman');
