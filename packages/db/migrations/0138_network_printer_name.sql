-- A network printer's name is the printer's (6.1.0 Step 10b): the source no longer stores it.
-- Removed from sources linked to a printer (the printer keeps its name); a source with no
-- printer yet keeps it until it is linked.
UPDATE `integrations` SET `config` = json_remove(`config`, '$.name')
WHERE `adapter_id` IN ('moonraker', 'prusalink', 'octoprint', 'bambu-lan') AND (
  EXISTS (SELECT 1 FROM `printers` p WHERE p.`integration_id` = `integrations`.`id`)
  OR EXISTS (SELECT 1 FROM `printer_sources` ps WHERE ps.`integration_id` = `integrations`.`id`)
);
