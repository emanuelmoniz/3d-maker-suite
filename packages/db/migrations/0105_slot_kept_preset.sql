-- ADR-0020: per slot, the spool a plate kept its preset for (Keep), so its advice stays hidden.
ALTER TABLE `project_slice_plates` ADD `kept` text DEFAULT '[]' NOT NULL;