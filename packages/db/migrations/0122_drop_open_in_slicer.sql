-- Open in the slicer is gone (5.6.0): its sync policy rows have nothing to set, and the
-- `machine.slicers` right it left guards nothing.
DELETE FROM `sync_policies` WHERE `type` = 'openInSlicer';--> statement-breakpoint
UPDATE `roles` SET `permissions` = json_remove(`permissions`, '$."machine.slicers"');--> statement-breakpoint
UPDATE `users` SET `permissions` = json_remove(`permissions`, '$."machine.slicers"');
