-- Taggings are polymorphic (no FK to the tagged row). Prints are the only taggable rows that get
-- hard-deleted (spools and projects are archived), so clean up their taggings here.
CREATE TRIGGER `prints_taggings_cleanup` AFTER DELETE ON `prints` BEGIN
	DELETE FROM `taggings` WHERE `entity_type` = 'print' AND `entity_id` = OLD.`id`;
END;
