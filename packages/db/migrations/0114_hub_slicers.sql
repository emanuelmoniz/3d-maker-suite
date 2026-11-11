-- ADR-0022: one slicer per slicer type. A machine's switches per library become Use as slicer,
-- Catalog and system presets (Receive only) and User presets: Catalog Share goes, Catalog Receive
-- is `system.receive`, Presets is `user`.
UPDATE `devices` SET `preset_libraries` = (
  SELECT json_group_object(l.key, json_patch(
    json_object(
      'slicer', json('false'),
      'system', json_object('receive', json(iif(json_extract(l.value, '$.catalog.receive'), 'true', 'false'))),
      'user', json(json_extract(l.value, '$.presets'))
    ),
    iif(json_extract(l.value, '$.sentAt') IS NULL, '{}', json_object('sentAt', json_extract(l.value, '$.sentAt')))
  ))
  FROM json_each(`devices`.`preset_libraries`) l
) WHERE `preset_libraries` <> '{}';--> statement-breakpoint
-- Use as slicer is on where the machine's worker row was slicing (enabled, its slice policy not
-- off), and on the picked catalog source machine, which becomes the hub's slicer below. A worker
-- adapter's id is `<library>-worker` (bambu-studio-worker, orca-slicer-worker). A library it had no
-- switches for gets them, the rest off.
WITH `offered` AS (
  SELECT json_extract(i.`config`, '$.deviceId') AS device, substr(i.`adapter_id`, 1, length(i.`adapter_id`) - 7) AS lib
  FROM `integrations` i
  WHERE i.`adapter_id` LIKE '%-worker' AND i.`enabled`
    AND NOT EXISTS (SELECT 1 FROM `sync_policies` p WHERE p.`integration_id` = i.`id` AND p.`type` = 'slice' AND p.`mode` = 'off')
  UNION
  SELECT json_extract(p.value, '$.deviceId'), p.key FROM `settings` s, json_each(s.`value`) p
  WHERE s.`key` = 'catalogSources' AND json_extract(p.value, '$.deviceId') IS NOT NULL
)
UPDATE `devices` SET `preset_libraries` = json_patch(
  json_patch(
    (SELECT json_group_object(o.lib, json('{"slicer":false,"system":{"receive":false},"user":{"receive":false,"share":false,"receiveKinds":["machine","process","filament"],"shareKinds":["machine","process","filament"]}}'))
      FROM `offered` o WHERE o.device = `devices`.`id`),
    `preset_libraries`
  ),
  (SELECT json_group_object(o.lib, json('{"slicer":true}')) FROM `offered` o WHERE o.device = `devices`.`id`)
) WHERE `id` IN (SELECT device FROM `offered`);--> statement-breakpoint
-- The catalog source pick becomes the hub's slicer: a server row as is, a machine its worker row.
-- A library without a pick takes the default (default slicer, else the oldest that can slice).
-- ponytail: an unpicked default catalog source (the oldest readable folder) isn't kept: knowing it
-- needs the file system.
INSERT INTO `settings` (`key`, `value`)
SELECT 'hubSlicers', json_group_object(lib, row) FROM (
  SELECT p.key AS lib, coalesce(json_extract(p.value, '$.integrationId'), (
    SELECT i.`id` FROM `integrations` i
    WHERE i.`adapter_id` = p.key || '-worker'
      AND json_extract(i.`config`, '$.deviceId') = json_extract(p.value, '$.deviceId')
    ORDER BY i.`created_at` LIMIT 1
  )) AS row
  FROM `settings` s, json_each(s.`value`) p
  WHERE s.`key` = 'catalogSources'
) WHERE row IS NOT NULL
HAVING count(*) > 0;--> statement-breakpoint
DELETE FROM `settings` WHERE `key` = 'catalogSources';
