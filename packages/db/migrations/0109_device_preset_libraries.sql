ALTER TABLE `devices` ADD `preset_libraries` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Today's two switches carry over to each slicer the device reports (ADR-0020). A desktop slicer's
-- id is its library's (`bambu-studio`, `orca-slicer`). A device that reports none carries nothing.
UPDATE `devices` SET `preset_libraries` = (
  SELECT json_group_object(
    json_extract(s.value, '$.id'),
    json_object(
      'send', json(iif(`devices`.`share_presets`, 'true', 'false')),
      'install', json(iif(`devices`.`install_presets`, 'true', 'false'))
    )
  )
  FROM json_each(`devices`.`slicers`) s
) WHERE `share_presets` OR `install_presets`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `share_presets`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `install_presets`;
