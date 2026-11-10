-- ADR-0021: `presets` takes from `catalog` what concerns presets. It starts at each role's
-- `catalog` level, and a user's `catalog` override gets the same `presets` override, so nobody's
-- rights change.
UPDATE `roles` SET `permissions` = json_set(`permissions`, '$.presets', json_extract(`permissions`, '$.catalog'))
WHERE json_extract(`permissions`, '$.catalog') IS NOT NULL;--> statement-breakpoint
UPDATE `users` SET `permissions` = json_set(`permissions`, '$.presets', json_extract(`permissions`, '$.catalog'))
WHERE json_extract(`permissions`, '$.catalog') IS NOT NULL;
