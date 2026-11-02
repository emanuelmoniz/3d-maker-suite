ALTER TABLE `roles` ADD `alert_kinds` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `alert_kinds` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- ADR-0016: the Admin role gets every kind as notify; the other roles keep the catalog defaults (in
-- app where their permissions allow), as they had no own destination. The two spool checks were global
-- switches: where one was on, its kind is on for the Admin role and for every role that reads filament.
UPDATE `roles` SET `alert_kinds` = json_object(
	'maintenance_due', 'notify', 'spool_low', 'notify', 'warranty_ending', 'notify',
	'sync_pending', 'notify', 'sync_success', 'notify', 'sync_error', 'notify',
	'slice_setup_changed', 'notify', 'slice_failed', 'notify', 'update_available', 'notify',
	'slicer_update', 'notify', 'connector_outdated', 'notify', 'hub_conflict', 'notify',
	'hub_mass_delete', 'notify',
	'spool_no_price', CASE WHEN (SELECT `value` FROM `settings` WHERE `key` = 'spoolNoPriceAlert') = 'true' THEN 'notify' ELSE 'off' END,
	'spool_no_open_date', CASE WHEN (SELECT `value` FROM `settings` WHERE `key` = 'spoolNoOpenDateAlert') = 'true' THEN 'notify' ELSE 'off' END)
WHERE `built_in` = 'admin';--> statement-breakpoint
UPDATE `roles` SET `alert_kinds` = json_patch(json_patch('{}',
	CASE WHEN (SELECT `value` FROM `settings` WHERE `key` = 'spoolNoPriceAlert') = 'true' THEN '{"spool_no_price":"app"}' ELSE '{}' END),
	CASE WHEN (SELECT `value` FROM `settings` WHERE `key` = 'spoolNoOpenDateAlert') = 'true' THEN '{"spool_no_open_date":"app"}' ELSE '{}' END)
WHERE `built_in` IS NOT 'admin' AND json_extract(`permissions`, '$.filament') <> 'none';--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('spoolNoPriceAlert', 'spoolNoOpenDateAlert');
