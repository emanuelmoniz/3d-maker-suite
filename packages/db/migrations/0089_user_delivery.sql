ALTER TABLE `alert_states` ADD `notified_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `delivery` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- ADR-0016: today's global destinations become the oldest enabled admin's delivery, so nothing
-- stops. Email is on where a recipient was set (its address kept only when it isn't the account
-- email); the ntfy topic and its encrypted token move as they are. The global channels still send
-- only when enabled, as before; their `to` and topic stay for the no-users mode.
UPDATE `users` SET `delivery` = json_patch(json_patch('{}',
	CASE WHEN json_extract((SELECT `value` FROM `settings` WHERE `key` = 'channel:email'), '$.config.to') <> ''
	THEN json_object('email', json('true'), 'emailTo', CASE
		WHEN lower(json_extract((SELECT `value` FROM `settings` WHERE `key` = 'channel:email'), '$.config.to')) = lower(`email`) THEN NULL
		ELSE json_extract((SELECT `value` FROM `settings` WHERE `key` = 'channel:email'), '$.config.to') END)
	ELSE '{}' END),
	CASE WHEN json_extract((SELECT `value` FROM `settings` WHERE `key` = 'channel:ntfy'), '$.config.topic') <> ''
	THEN json_object(
		'ntfyTopic', json_extract((SELECT `value` FROM `settings` WHERE `key` = 'channel:ntfy'), '$.config.topic'),
		'ntfyToken', json(json_extract((SELECT `value` FROM `settings` WHERE `key` = 'channel:ntfy'), '$.secrets')))
	ELSE '{}' END)
WHERE `id` = (SELECT `users`.`id` FROM `users` INNER JOIN `roles` ON `roles`.`id` = `users`.`role_id`
	WHERE `roles`.`built_in` = 'admin' AND `users`.`disabled` = 0 ORDER BY `users`.`created_at`, `users`.`id` LIMIT 1);--> statement-breakpoint
-- What the global channels already sent counts as sent to that admin, so the switch re-sends nothing.
-- A new state row starts from the alert's own columns, like a first PATCH does.
INSERT INTO `alert_states` (`alert_id`, `user_id`, `read_at`, `snoozed_until`, `dismissed_at`, `updated_at`, `notified_at`)
SELECT `alerts`.`id`, `u`.`id`, `alerts`.`read_at`, `alerts`.`snoozed_until`, `alerts`.`dismissed_at`, `alerts`.`updated_at`,
	json_object('email', `alerts`.`notified_at`, 'ntfy', `alerts`.`notified_at`)
FROM `alerts`, (SELECT `users`.`id` FROM `users` INNER JOIN `roles` ON `roles`.`id` = `users`.`role_id`
	WHERE `roles`.`built_in` = 'admin' AND `users`.`disabled` = 0 ORDER BY `users`.`created_at`, `users`.`id` LIMIT 1) AS `u`
WHERE `alerts`.`resolved_at` IS NULL AND `alerts`.`notified_at` IS NOT NULL
ON CONFLICT (`alert_id`, `user_id`) DO UPDATE SET `notified_at` = excluded.`notified_at`;
