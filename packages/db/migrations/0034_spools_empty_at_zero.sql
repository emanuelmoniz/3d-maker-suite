-- A spool with nothing left is empty (from now on the ledger sets it).
UPDATE `spools` SET `status` = 'empty' WHERE `remaining_grams` <= 0 AND `status` <> 'empty';
