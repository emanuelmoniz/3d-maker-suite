-- A printer on the network is one printer, linked when it is saved (ADR-0015): it no longer syncs
-- printers. Its printers line is switched off; the rest of the row stays.
UPDATE `sync_policies` SET `mode` = 'off'
WHERE `type` = 'printers' AND `integration_id` IN (
  SELECT `id` FROM `integrations` WHERE `adapter_id` IN ('moonraker', 'prusalink', 'octoprint', 'bambu-lan')
);--> statement-breakpoint
-- The serial belongs to the printer: Bambu LAN's moves to the printer it is linked to, when that
-- one has none. A source with no printer yet keeps it until one is linked.
UPDATE `printers` SET `serial` = (
  SELECT json_extract(i.`config`, '$.serial') FROM `integrations` i
  WHERE i.`adapter_id` = 'bambu-lan' AND json_extract(i.`config`, '$.serial') <> ''
    AND (i.`id` = `printers`.`integration_id`
      OR i.`id` IN (SELECT ps.`integration_id` FROM `printer_sources` ps WHERE ps.`printer_id` = `printers`.`id`))
  LIMIT 1
)
WHERE (`serial` IS NULL OR trim(`serial`) = '') AND EXISTS (
  SELECT 1 FROM `integrations` i
  WHERE i.`adapter_id` = 'bambu-lan' AND json_extract(i.`config`, '$.serial') <> ''
    AND (i.`id` = `printers`.`integration_id`
      OR i.`id` IN (SELECT ps.`integration_id` FROM `printer_sources` ps WHERE ps.`printer_id` = `printers`.`id`))
);--> statement-breakpoint
UPDATE `integrations` SET `config` = json_remove(`config`, '$.serial')
WHERE `adapter_id` = 'bambu-lan' AND (
  EXISTS (SELECT 1 FROM `printers` p WHERE p.`integration_id` = `integrations`.`id` AND trim(coalesce(p.`serial`, '')) <> '')
  OR EXISTS (
    SELECT 1 FROM `printer_sources` ps JOIN `printers` p ON p.`id` = ps.`printer_id`
    WHERE ps.`integration_id` = `integrations`.`id` AND trim(coalesce(p.`serial`, '')) <> ''
  )
);
