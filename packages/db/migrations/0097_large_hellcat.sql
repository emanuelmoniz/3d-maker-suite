ALTER TABLE `integrations` ADD `user_presets_fingerprint` text;--> statement-breakpoint
ALTER TABLE `integrations` ADD `user_presets_to_catalog` integer DEFAULT true NOT NULL;