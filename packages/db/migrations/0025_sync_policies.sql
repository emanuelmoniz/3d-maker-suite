-- Sync policy per integration + type (Step 13) replaces the integration-wide `sync_frequency`,
-- `last_prints_sync_at` and `disabled_features`. A type without a row follows its default.
CREATE TABLE `sync_policies` (
	`integration_id` text NOT NULL,
	`type` text NOT NULL,
	`mode` text NOT NULL,
	`frequency` text NOT NULL,
	`last_run_at` text,
	`cursor` text,
	`pending` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`integration_id`, `type`),
	FOREIGN KEY (`integration_id`) REFERENCES `integrations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_policies_mode_ck" CHECK("sync_policies"."mode" IN ('off', 'manual', 'auto')),
	CONSTRAINT "sync_policies_frequency_ck" CHECK("sync_policies"."frequency" IN ('15m', '1h', '1d', '1w', '1M'))
);
--> statement-breakpoint
-- Printers and prints inherit the integration's one frequency ('off' = manual, at the type's default
-- frequency); prints keep their incremental start.
INSERT INTO `sync_policies` (`integration_id`, `type`, `mode`, `frequency`, `last_run_at`, `cursor`)
SELECT i.`id`, t.`type`,
  CASE WHEN EXISTS (SELECT 1 FROM json_each(i.`disabled_features`) WHERE `value` = t.`type`) THEN 'off'
       WHEN i.`sync_frequency` = 'off' THEN 'manual' ELSE 'auto' END,
  CASE WHEN i.`sync_frequency` = 'off' THEN t.`frequency` ELSE i.`sync_frequency` END,
  CASE t.`type` WHEN 'prints' THEN i.`last_prints_sync_at` ELSE i.`last_sync_at` END,
  CASE t.`type` WHEN 'prints' THEN i.`last_prints_sync_at` END
FROM `integrations` i
JOIN (SELECT 'printers' AS `type`, '1d' AS `frequency` UNION ALL SELECT 'prints', '1h') t;--> statement-breakpoint
-- Every other switched-off feature stays off. Switched-on ones need no row: their default is manual.
INSERT INTO `sync_policies` (`integration_id`, `type`, `mode`, `frequency`)
SELECT i.`id`, f.`value`, 'off', CASE WHEN f.`value` IN ('brands', 'printerModels', 'filamentBrands') THEN '1w' ELSE '1d' END
FROM `integrations` i, json_each(i.`disabled_features`) f
WHERE f.`value` NOT IN ('printers', 'prints');--> statement-breakpoint
ALTER TABLE `integrations` DROP COLUMN `disabled_features`;--> statement-breakpoint
ALTER TABLE `integrations` DROP COLUMN `sync_frequency`;--> statement-breakpoint
ALTER TABLE `integrations` DROP COLUMN `last_prints_sync_at`;