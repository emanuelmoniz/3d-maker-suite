-- ADR-0023: one Catalog module. `presets` merges into `catalog` and `machine.presets` into
-- `machine.catalog`: everyone keeps the higher of the two. Users first, against their role's old
-- values: an override stays only where it differs from the role's merged value.
UPDATE `users` SET `permissions` = coalesce((
  SELECT CASE WHEN m.eff IS m.base
    THEN json_remove(`users`.`permissions`, '$.catalog', '$.presets')
    ELSE json_remove(json_set(`users`.`permissions`, '$.catalog', m.eff), '$.presets') END
  FROM (
    SELECT
      CASE WHEN (CASE v.ep WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'manage' THEN 3 ELSE 0 END)
              > (CASE v.ec WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'manage' THEN 3 ELSE 0 END)
        THEN v.ep ELSE coalesce(v.ec, v.ep) END AS eff,
      CASE WHEN (CASE v.rp WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'manage' THEN 3 ELSE 0 END)
              > (CASE v.rc WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'manage' THEN 3 ELSE 0 END)
        THEN v.rp ELSE coalesce(v.rc, v.rp) END AS base
    FROM (
      SELECT
        coalesce(json_extract(`users`.`permissions`, '$.catalog'), json_extract(r.`permissions`, '$.catalog')) AS ec,
        coalesce(json_extract(`users`.`permissions`, '$.presets'), json_extract(r.`permissions`, '$.presets')) AS ep,
        json_extract(r.`permissions`, '$.catalog') AS rc,
        json_extract(r.`permissions`, '$.presets') AS rp
      FROM `roles` r WHERE r.`id` = `users`.`role_id`
    ) v
  ) m
), json_remove(`permissions`, '$.presets'))
WHERE json_extract(`permissions`, '$.catalog') IS NOT NULL
   OR json_extract(`permissions`, '$.presets') IS NOT NULL;--> statement-breakpoint
UPDATE `users` SET `permissions` = coalesce((
  SELECT CASE WHEN m.eff = m.base
    THEN json_remove(`users`.`permissions`, '$."machine.catalog"', '$."machine.presets"')
    ELSE json_remove(json_set(`users`.`permissions`, '$."machine.catalog"', json(iif(m.eff, 'true', 'false'))), '$."machine.presets"') END
  FROM (
    SELECT
      (coalesce(json_extract(`users`.`permissions`, '$."machine.catalog"'), json_extract(r.`permissions`, '$."machine.catalog"'), 0)
        OR coalesce(json_extract(`users`.`permissions`, '$."machine.presets"'), json_extract(r.`permissions`, '$."machine.presets"'), 0)) AS eff,
      (coalesce(json_extract(r.`permissions`, '$."machine.catalog"'), 0)
        OR coalesce(json_extract(r.`permissions`, '$."machine.presets"'), 0)) AS base
    FROM `roles` r WHERE r.`id` = `users`.`role_id`
  ) m
), json_remove(`permissions`, '$."machine.presets"'))
WHERE json_extract(`permissions`, '$."machine.catalog"') IS NOT NULL
   OR json_extract(`permissions`, '$."machine.presets"') IS NOT NULL;--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_set(`permissions`, '$.catalog', json_extract(`permissions`, '$.presets'))
WHERE (CASE json_extract(`permissions`, '$.presets') WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'manage' THEN 3 ELSE 0 END)
    > (CASE json_extract(`permissions`, '$.catalog') WHEN 'read' THEN 1 WHEN 'write' THEN 2 WHEN 'manage' THEN 3 ELSE 0 END)
   OR (json_extract(`permissions`, '$.catalog') IS NULL AND json_extract(`permissions`, '$.presets') IS NOT NULL);--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_set(`permissions`, '$."machine.catalog"', json('true'))
WHERE json_extract(`permissions`, '$."machine.presets"') = 1;--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_remove(`permissions`, '$.presets', '$."machine.presets"');--> statement-breakpoint
-- A receiver's User presets switch takes every kind: the per-kind Receive lines go.
UPDATE `devices` SET `preset_libraries` = (
  SELECT json_group_object(l.key, json(json_remove(l.value, '$.user.receiveKinds')))
  FROM json_each(`devices`.`preset_libraries`) l
)
WHERE `preset_libraries` <> '{}';
