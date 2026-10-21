UPDATE `sync_policies` SET `alert_severities` = '[]' WHERE `alert` = 0;--> statement-breakpoint
ALTER TABLE `sync_policies` DROP COLUMN `alert`;
