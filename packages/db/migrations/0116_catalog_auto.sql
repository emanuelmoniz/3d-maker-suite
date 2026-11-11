-- A slicer's catalog and system presets follow its files on their own, as its user presets do:
-- their lines on Manual become Automatic. Only slicers have these types; Off stays off.
UPDATE `sync_policies` SET `mode` = 'auto'
WHERE `mode` = 'manual'
  AND `type` IN ('brands', 'printerModels', 'filamentBrands', 'filamentMaterials', 'machinePresets', 'processPresets', 'filamentPresets');
