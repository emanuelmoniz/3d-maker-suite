-- ADR-0020: profiles come only from slicer files. Hand-made ones (no source preset) are archived, shown
-- as "By hand (older)". Printers and plates that pointed at one use the 3MF's own settings ("From the
-- file"): a hand-made print profile failed with `no_preset`, a hand-made filament already sliced as none.
UPDATE `printers` SET `print_profile_id` = NULL
  WHERE `print_profile_id` IN (SELECT `id` FROM `print_profiles` WHERE `source_preset` IS NULL);
--> statement-breakpoint
UPDATE `project_slice_plates` SET `print_profile_id` = NULL
  WHERE `print_profile_id` IN (SELECT `id` FROM `print_profiles` WHERE `source_preset` IS NULL);
--> statement-breakpoint
UPDATE `project_slice_plates` SET `filaments` = (
  SELECT json_group_array(CASE WHEN `value` IN (SELECT `id` FROM `filament_profiles` WHERE `source_preset` IS NULL)
    THEN NULL ELSE `value` END)
  FROM (SELECT `value` FROM json_each(`project_slice_plates`.`filaments`) ORDER BY `key`)
) WHERE EXISTS (
  SELECT 1 FROM json_each(`project_slice_plates`.`filaments`)
  WHERE `value` IN (SELECT `id` FROM `filament_profiles` WHERE `source_preset` IS NULL)
);
--> statement-breakpoint
UPDATE `machine_profiles` SET `archived_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `source_preset` IS NULL AND `archived_at` IS NULL;
--> statement-breakpoint
UPDATE `print_profiles` SET `archived_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `source_preset` IS NULL AND `archived_at` IS NULL;
--> statement-breakpoint
UPDATE `filament_profiles` SET `archived_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE `source_preset` IS NULL AND `archived_at` IS NULL;
