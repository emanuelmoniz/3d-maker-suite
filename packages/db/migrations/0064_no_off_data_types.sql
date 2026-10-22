-- Data types have no "off" any more (manual is the base, "auto" is a switch); only actions keep it.
-- Spools that were off never opted in to the vendor's weights, so they stay untracked.
UPDATE `sync_policies` SET `track_usage` = 0 WHERE `mode` = 'off' AND `type` = 'spools';--> statement-breakpoint
UPDATE `sync_policies` SET `mode` = 'manual' WHERE `mode` = 'off' AND `type` NOT IN ('openInSlicer', 'slice');
