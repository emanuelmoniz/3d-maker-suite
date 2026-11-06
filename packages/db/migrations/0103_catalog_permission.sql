-- ADR-0020: `catalog` replaces `presets.manage`. manage if printers and filament are both manage,
-- else write if presets.manage is on, else read if both are at least read, else none. Users outside
-- the Admin role (which ignores overrides) convert on their effective values; the rule is here once.
CREATE TABLE `__catalog` AS
WITH `v` AS (
	SELECT 'role' AS `kind`, `id`,
		json_extract(`permissions`, '$.printers') AS `printers`,
		json_extract(`permissions`, '$.filament') AS `filament`,
		json_extract(`permissions`, '$."presets.manage"') AS `presets`
	FROM `roles`
	UNION ALL
	SELECT 'user', `u`.`id`,
		coalesce(json_extract(`u`.`permissions`, '$.printers'), json_extract(`r`.`permissions`, '$.printers')),
		coalesce(json_extract(`u`.`permissions`, '$.filament'), json_extract(`r`.`permissions`, '$.filament')),
		coalesce(json_extract(`u`.`permissions`, '$."presets.manage"'), json_extract(`r`.`permissions`, '$."presets.manage"'))
	FROM `users` AS `u` JOIN `roles` AS `r` ON `r`.`id` = `u`.`role_id`
	WHERE `r`.`built_in` IS NOT 'admin'
)
SELECT `kind`, `id`, CASE
	WHEN `printers` = 'manage' AND `filament` = 'manage' THEN 'manage'
	WHEN `presets` THEN 'write'
	WHEN `printers` IN ('read', 'write', 'manage') AND `filament` IN ('read', 'write', 'manage') THEN 'read'
	ELSE 'none'
END AS `level`
FROM `v`;--> statement-breakpoint
-- A user keeps a `catalog` override only where it differs from the role's.
UPDATE `users` SET `permissions` = json_remove(
	CASE WHEN `c`.`level` IS NOT (SELECT `level` FROM `__catalog` WHERE `kind` = 'role' AND `id` = `users`.`role_id`)
		THEN json_set(`users`.`permissions`, '$.catalog', `c`.`level`)
		ELSE `users`.`permissions` END,
	'$."presets.manage"')
FROM (SELECT `id`, `level` FROM `__catalog` WHERE `kind` = 'user') AS `c`
WHERE `c`.`id` = `users`.`id`;--> statement-breakpoint
-- Admin-role users have no row above; their overrides only lose the old key.
UPDATE `users` SET `permissions` = json_remove(`permissions`, '$."presets.manage"');--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_remove(
	json_set(`permissions`, '$.catalog', (SELECT `level` FROM `__catalog` WHERE `kind` = 'role' AND `id` = `roles`.`id`)),
	'$."presets.manage"');--> statement-breakpoint
DROP TABLE `__catalog`;
