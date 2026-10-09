ALTER TABLE `integrations` ADD `disabled_features` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `integrations` ADD `slicer_config_dir` text;--> statement-breakpoint
ALTER TABLE `integrations` ADD `slicer_path` text;--> statement-breakpoint
-- Slicer settings move from preferences into the Bambu integration (Step 9).
-- No Bambu integration yet, but Bambu Studio was set up or used: create one with the cloud parts off.
INSERT INTO `integrations` (`id`, `adapter_id`, `name`, `enabled`, `config`, `status`, `disabled_features`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
    || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2)
    || '-' || lower(hex(randomblob(6))),
  'bambu-cloud', 'Bambu Studio', 1, '{"region":"global"}', 'new', '["printers","prints","spools"]',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM `integrations` WHERE `adapter_id` = 'bambu-cloud')
  AND (EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'slicerPath' AND json_extract(`value`, '$') <> '')
    OR EXISTS (SELECT 1 FROM `settings` WHERE `key` = 'libraryPaths' AND json_extract(`value`, '$."bambu-studio"') <> '')
    OR EXISTS (SELECT 1 FROM `filament_profiles` WHERE `source_preset` LIKE 'bambu-studio:%'));--> statement-breakpoint
-- The oldest Bambu integration takes the paths (several accounts = the first one).
UPDATE `integrations` SET
  `slicer_path` = NULLIF((SELECT json_extract(`value`, '$') FROM `settings` WHERE `key` = 'slicerPath'), ''),
  `slicer_config_dir` = NULLIF((SELECT json_extract(`value`, '$."bambu-studio"') FROM `settings` WHERE `key` = 'libraryPaths'), '')
WHERE `id` = (SELECT `id` FROM `integrations` WHERE `adapter_id` = 'bambu-cloud' ORDER BY `created_at` LIMIT 1);--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('slicerPath', 'libraryPaths');
