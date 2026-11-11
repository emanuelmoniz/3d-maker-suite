ALTER TABLE `devices` ADD `receive_projects` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `share_projects` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- ADR-0021: each library's switches become Catalog and Presets, Receive and Share. Send is
-- Presets Share and Install Presets Receive, each with all three kinds; Catalog starts off.
UPDATE `devices` SET `preset_libraries` = (
  SELECT json_group_object(l.key, json_patch(
    json_object(
      'catalog', json('{"receive":false,"share":false}'),
      'presets', json_object(
        'receive', json(iif(json_extract(l.value, '$.install'), 'true', 'false')),
        'share', json(iif(json_extract(l.value, '$.send'), 'true', 'false')),
        'receiveKinds', json('["machine","process","filament"]'),
        'shareKinds', json('["machine","process","filament"]')
      )
    ),
    iif(json_extract(l.value, '$.sentAt') IS NULL, '{}', json_object('sentAt', json_extract(l.value, '$.sentAt')))
  ))
  FROM json_each(`devices`.`preset_libraries`) l
) WHERE `preset_libraries` <> '{}';--> statement-breakpoint
-- A library's picked catalog source machine gets Catalog Share (a library it had no switches for
-- gets them, the rest off). A default source is covered by the server: the source's Share is on.
UPDATE `devices` SET `preset_libraries` = json_patch(
  json_patch(
    (SELECT json_group_object(p.key, json('{"catalog":{"receive":false,"share":false},"presets":{"receive":false,"share":false,"receiveKinds":["machine","process","filament"],"shareKinds":["machine","process","filament"]}}'))
      FROM `settings` s, json_each(s.`value`) p
      WHERE s.`key` = 'catalogSources' AND json_extract(p.value, '$.deviceId') = `devices`.`id`),
    `preset_libraries`
  ),
  (SELECT json_group_object(p.key, json('{"catalog":{"share":true}}'))
    FROM `settings` s, json_each(s.`value`) p
    WHERE s.`key` = 'catalogSources' AND json_extract(p.value, '$.deviceId') = `devices`.`id`)
) WHERE `id` IN (
  SELECT json_extract(p.value, '$.deviceId') FROM `settings` s, json_each(s.`value`) p
  WHERE s.`key` = 'catalogSources'
);--> statement-breakpoint
-- Share to the hub: a machine shares when the hub has a project folder on it (its connector's own
-- folder list reaches the hub in Step 14). Receive stays on: every machine syncs something today.
UPDATE `devices` SET `share_projects` = EXISTS (SELECT 1 FROM `roots` WHERE `roots`.`location` = `devices`.`id`);--> statement-breakpoint
-- The machine page switches (ADR-0021): Admin has them, Editor and Viewer don't (core's
-- BUILT_IN_RIGHTS). Custom roles and users go without: a missing key is off.
UPDATE `roles` SET `permissions` = json_set(`permissions`,
  '$."machine.connection"', json(iif(`built_in` = 'admin', 'true', 'false')),
  '$."machine.slicers"', json(iif(`built_in` = 'admin', 'true', 'false')),
  '$."machine.catalog"', json(iif(`built_in` = 'admin', 'true', 'false')),
  '$."machine.presets"', json(iif(`built_in` = 'admin', 'true', 'false')),
  '$."machine.projects"', json(iif(`built_in` = 'admin', 'true', 'false'))
) WHERE `built_in` IS NOT NULL;
