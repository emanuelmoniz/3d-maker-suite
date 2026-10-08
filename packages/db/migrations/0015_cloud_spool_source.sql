-- Spools now come from Bambu Cloud; Studio's local inventory used the same spool ids.
UPDATE `spools` SET `source_spool` = 'bambu-cloud:' || substr(`source_spool`, 14) WHERE `source_spool` LIKE 'bambu-studio:%';
