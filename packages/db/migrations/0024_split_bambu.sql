-- Bambu splits into Bambu Cloud (account) and Bambu Studio (local) (Step 12).
-- The cloud row keeps its id, so its token, config, sync log, printers and prints stay attached.

-- Slicer-only rows (made by 0019: never signed in, cloud parts all off) simply become Bambu Studio.
UPDATE `integrations` SET `adapter_id` = 'bambu-studio', `config` = '{}', `status` = 'new', `last_error` = NULL
WHERE `adapter_id` = 'bambu-cloud' AND `secrets` IS NULL
  AND (SELECT count(*) FROM json_each(`integrations`.`disabled_features`)
       WHERE `value` IN ('printers', 'prints', 'spools')) = 3;--> statement-breakpoint
-- Every other Bambu row gets a Bambu Studio twin with its folders (same created_at keeps the order).
INSERT INTO `integrations` (`id`, `adapter_id`, `enabled`, `config`, `disabled_features`, `slicer_config_dir`, `slicer_path`, `status`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2)
    || '-' || substr('89ab', 1 + abs(random()) % 4, 1) || substr(lower(hex(randomblob(2))), 2)
    || '-' || lower(hex(randomblob(6))),
  'bambu-studio', `enabled`, '{}', `disabled_features`, `slicer_config_dir`, `slicer_path`, 'new', `created_at`, `updated_at`
FROM `integrations` WHERE `adapter_id` = 'bambu-cloud';--> statement-breakpoint
-- The default slicer follows the local half (a twin shares its cloud row's created_at).
UPDATE `settings` SET `value` = (
  SELECT json_quote(t.`id`) FROM `integrations` c
  JOIN `integrations` t ON t.`adapter_id` = 'bambu-studio' AND t.`created_at` = c.`created_at`
  WHERE c.`adapter_id` = 'bambu-cloud' AND c.`id` = json_extract(`settings`.`value`, '$') LIMIT 1)
WHERE `key` = 'defaultSlicerId'
  AND json_extract(`value`, '$') IN (SELECT `id` FROM `integrations` WHERE `adapter_id` = 'bambu-cloud');--> statement-breakpoint
-- The cloud half drops the folders; each half keeps only its own switches.
UPDATE `integrations` SET `slicer_config_dir` = NULL, `slicer_path` = NULL,
  `disabled_features` = (SELECT json_group_array(`value`) FROM json_each(`integrations`.`disabled_features`)
                         WHERE `value` IN ('printers', 'prints', 'spools'))
WHERE `adapter_id` = 'bambu-cloud';--> statement-breakpoint
UPDATE `integrations` SET
  `disabled_features` = (SELECT json_group_array(`value`) FROM json_each(`integrations`.`disabled_features`)
                         WHERE `value` IN ('filamentProfiles', 'openInSlicer'))
WHERE `adapter_id` = 'bambu-studio';
