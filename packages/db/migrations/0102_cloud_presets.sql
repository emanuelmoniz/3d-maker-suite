CREATE TABLE `preset_routes` (
	`entity` text NOT NULL,
	`source` text NOT NULL,
	`integration_id` text NOT NULL,
	PRIMARY KEY(`entity`, `source`),
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- Bambu Cloud's new user preset cards start in Manual, like spools: nothing is read until you ask.
-- Without a row they would follow `defaultPolicy`, which runs user presets daily.
INSERT OR IGNORE INTO `sync_policies` (`integration_id`, `type`, `mode`, `frequency`)
SELECT `i`.`id`, `t`.`value`, 'manual', '1d'
FROM `integrations` AS `i`, json_each('["userMachineProfiles","userPrintProfiles","userFilamentProfiles"]') AS `t`
WHERE `i`.`adapter_id` = 'bambu-cloud';
