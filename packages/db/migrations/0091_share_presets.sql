ALTER TABLE `devices` ADD `share_presets` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `slicer_presets` ADD `removed_on` text DEFAULT '[]' NOT NULL;