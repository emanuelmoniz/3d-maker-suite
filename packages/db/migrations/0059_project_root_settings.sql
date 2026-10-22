-- Project depth and auto slice move onto each project root (Step 5). Files depth starts at "all" (null).
UPDATE `settings` SET `value` = (
  SELECT json_group_array(json_object(
    'path', r.`value`,
    'projectDepth', coalesce((SELECT json_extract(`value`, '$') FROM `settings` WHERE `key` = 'projectScanDepth'), 1),
    'filesDepth', NULL,
    'autoSlice', json(CASE WHEN EXISTS (
      SELECT 1 FROM `settings` o, json_each(o.`value`) x
      WHERE o.`key` = 'autoSliceOffRoots' AND x.`value` = r.`value`) THEN 'false' ELSE 'true' END)
  )) FROM json_each(`settings`.`value`) r
) WHERE `key` = 'projectRoots';--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('projectScanDepth', 'autoSliceOffRoots');
