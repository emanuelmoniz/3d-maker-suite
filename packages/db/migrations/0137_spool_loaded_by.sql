ALTER TABLE `spools` ADD `loaded_by` text;--> statement-breakpoint
-- Every spool loaded before Step 19b was put there by hand.
UPDATE `spools` SET `loaded_by` = 'user' WHERE `loaded_printer_id` IS NOT NULL;
